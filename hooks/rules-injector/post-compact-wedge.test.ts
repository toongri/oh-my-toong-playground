import { test, expect, beforeEach, afterEach } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	claimPostCompactPending,
	clearSessionState,
	completePostCompactRecovery,
	isPostCompactRecoveryInProgress,
} from "./persistent-cache.js";
import { shouldSkipPostCompactClaim } from "./post-compact-claim.js";
import { SESSION_STATE_LOCK_CONTENDED, withSessionStateLock } from "./session-state-lock.js";

// HERMETIC: each test gets a fresh scratch dir holding the session-state JSON so
// no real ~/.omt is touched. cachePath points at a file inside it.
let scratchDir = "";
let cachePath = "";

const STATE_VERSION = 1;

beforeEach(() => {
	scratchDir = mkdtempSync(join(tmpdir(), "rules-injector-wedge-"));
	cachePath = join(scratchDir, "session.json");
});

afterEach(() => {
	if (scratchDir.length > 0) rmSync(scratchDir, { recursive: true, force: true });
});

// Write a session-state JSON directly, simulating a process that died mid-recovery:
// the kind has already moved out of `pending` and into `recovering`, and no
// further write (completePostCompactRecovery) ever happened.
function writeRawState(state: Record<string, unknown>): void {
	mkdirSync(scratchDir, { recursive: true });
	writeFileSync(cachePath, `${JSON.stringify({ version: STATE_VERSION, ...state })}\n`);
}

function readRawState(): Record<string, unknown> {
	return JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>;
}

// Find a PID that is not currently alive so a lease can simulate a dead owner.
// process.kill(pid, 0) throws ESRCH when no such process exists.
function unusedPid(): number {
	for (let candidate = 999_000; candidate < 999_500; candidate += 1) {
		try {
			process.kill(candidate, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") {
				return candidate;
			}
		}
	}
	throw new Error("could not find an unused pid for the test");
}

test("고아 recovering 상태는 후속 claim에서 재claim되어 wedge가 해소된다", () => {
	// A prior hook claimed `static` (pending -> recovering), then crashed before
	// completing. Disk has recovering but no pending, and no lock is held.
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactRecovering: { static: true },
	});

	const result = claimPostCompactPending(cachePath, "static");

	// Without the wedge fix this returns "not-pending" and the hook skips forever.
	expect(result).toBe("claimed");
});

test("재claim 후 wedge 게이트가 더 이상 스킵을 강제하지 않는다", () => {
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactRecovering: { static: true },
	});

	const result = claimPostCompactPending(cachePath, "static");
	const recoveryInProgress = isPostCompactRecoveryInProgress(cachePath, "static");

	// The wedge gate is `not-pending && recoveryInProgress`. After a successful
	// re-claim the result is "claimed", so the gate must not force a skip.
	expect(shouldSkipPostCompactClaim(result, recoveryInProgress)).toBe(false);
});

test("고아 recovering 재claim은 dynamic 채널에도 독립적으로 적용된다", () => {
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactRecovering: { dynamic: true },
	});

	expect(claimPostCompactPending(cachePath, "dynamic")).toBe("claimed");
	// static was never recovering and never pending: it must stay not-pending.
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactRecovering: { dynamic: true },
	});
	expect(claimPostCompactPending(cachePath, "static")).toBe("not-pending");
});

test("재claim 후 정상 완료 경로가 recovering을 비운다", () => {
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactRecovering: { static: true },
	});

	expect(claimPostCompactPending(cachePath, "static")).toBe("claimed");
	completePostCompactRecovery(cachePath, "static");

	expect(isPostCompactRecoveryInProgress(cachePath, "static")).toBe(false);
	const state = readRawState();
	expect(state["postCompactRecovering"]).toBeUndefined();
});

test("살아있는 owner의 신선한 lease를 가진 recovering은 lock 없이도 재claim이 거부된다", () => {
	// A recovery is genuinely in flight in ANOTHER process: that process moved the
	// kind pending->recovering and stamped a lease {ownerPid, startedAt, leaseTTL}.
	// It does NOT hold the session lock (recovery work runs OUTSIDE the lock, by
	// design). A second hook racing in here must NOT re-claim — the boolean marker
	// alone cannot distinguish this in-flight recovery from a dead orphan, so the
	// lease is the discriminator. The owner PID is THIS process (alive) and the
	// lease is fresh, so the claim must be refused, not re-claimed.
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactRecovering: { static: true },
		recoveryLease: {
			static: { ownerPid: process.pid, startedAt: Date.now(), leaseTTL: 60_000 },
		},
	});

	// No lock dir present.
	expect(existsSync(`${cachePath}.lock`)).toBe(false);

	const result = claimPostCompactPending(cachePath, "static");

	// Live owner + fresh lease => refuse the second claim (mapped to a skip).
	expect(result).toBe("contended");
	expect(shouldSkipPostCompactClaim(result, true)).toBe(true);
	// Disk must be untouched: still recovering, lease intact, no pending.
	const state = readRawState();
	expect(state["postCompactRecovering"]).toEqual({ static: true });
	expect(state["postCompactPending"]).toBeUndefined();
});

test("죽은 owner의 lease를 가진 recovering은 재claim되어 wedge가 해소된다", () => {
	// The recovering process died (PID no longer alive) before completing. A bare
	// boolean cannot tell this apart from an in-flight recovery, but the lease can:
	// the owner PID is dead AND the lease is stale, so re-claim is safe.
	const deadPid = unusedPid();
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactRecovering: { static: true },
		recoveryLease: {
			static: { ownerPid: deadPid, startedAt: Date.now() - 10 * 60_000, leaseTTL: 60_000 },
		},
	});

	const result = claimPostCompactPending(cachePath, "static");

	expect(result).toBe("claimed");
});

test("락이 보유된 채 진행 중인 정상 복구는 재claim되지 않고 contended로 막힌다", () => {
	// Simulate a recovery genuinely in flight RIGHT NOW: the lock dir exists
	// (a claim/complete callback is mid-execution) and the kind is recovering.
	// A second hook racing in must NOT re-claim — that would be double recovery.
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactRecovering: { static: true },
	});
	const lockPath = `${cachePath}.lock`;
	mkdirSync(lockPath);
	try {
		const result = claimPostCompactPending(cachePath, "static");
		// Lock held by another operation -> claim cannot acquire -> contended.
		expect(result).toBe("contended");
		// Disk must be untouched: still recovering, still no pending.
		const state = readRawState();
		expect(state["postCompactRecovering"]).toEqual({ static: true });
		expect(state["postCompactPending"]).toBeUndefined();
	} finally {
		rmSync(lockPath, { recursive: true, force: true });
	}
});

test("pending이 살아있는 정상 claim은 기존대로 동작한다 (회귀 가드)", () => {
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
		postCompactPending: { static: true, dynamic: true },
	});

	expect(claimPostCompactPending(cachePath, "static")).toBe("claimed");
	const state = readRawState();
	// static moved pending -> recovering; dynamic still pending.
	expect(state["postCompactRecovering"]).toEqual({ static: true });
	expect(state["postCompactPending"]).toEqual({ dynamic: true });
});

test("recovering도 pending도 아닌 kind는 not-pending으로 남는다 (회귀 가드)", () => {
	writeRawState({
		staticDedup: [],
		dynamicDedup: {},
	});

	expect(claimPostCompactPending(cachePath, "static")).toBe("not-pending");
	expect(existsSync(cachePath)).toBe(true);
});

// --- session-state-lock: stale .lock self-heal (#14) ---

test("죽은 holder PID가 남긴 .lock은 EEXIST에서 탈취되어 콜백이 실행된다", () => {
	// A process took the lock, wrote its pid, then was killed before rmSync ran,
	// leaving an orphan .lock dir. A boolean "exists" check would block forever;
	// the dead-PID signal lets the next caller steal the lock instead of wedging.
	mkdirSync(scratchDir, { recursive: true });
	const lockPath = `${cachePath}.lock`;
	mkdirSync(lockPath);
	writeFileSync(join(lockPath, "pid"), String(unusedPid()));

	let ran = false;
	const result = withSessionStateLock(cachePath, () => {
		ran = true;
		return "ok";
	});

	expect(ran).toBe(true);
	expect(result).toBe("ok");
});

test("TTL을 초과해 오래된 .lock은 holder 판단 불가여도 탈취된다", () => {
	// PID reuse makes a dead owner's PID look alive, so dead-PID alone is not enough.
	// An mtime older than the stale TTL is the backstop: no legitimate lock hold lasts
	// that long (the lock only wraps in-memory RMW), so an old dir is provably leaked.
	mkdirSync(scratchDir, { recursive: true });
	const lockPath = `${cachePath}.lock`;
	mkdirSync(lockPath);
	// No pid file -> holder unknown. Age the dir far past any plausible TTL.
	const longAgo = Date.now() / 1000 - 24 * 60 * 60;
	utimesSync(lockPath, longAgo, longAgo);

	let ran = false;
	const result = withSessionStateLock(cachePath, () => {
		ran = true;
		return "ok";
	});

	expect(ran).toBe(true);
	expect(result).toBe("ok");
});

test("살아있는 holder의 신선한 .lock은 탈취되지 않고 contended를 반환한다", () => {
	// A genuinely held lock (this live test process, just stamped) must NOT be stolen.
	mkdirSync(scratchDir, { recursive: true });
	const lockPath = `${cachePath}.lock`;
	mkdirSync(lockPath);
	writeFileSync(join(lockPath, "pid"), String(process.pid));

	let ran = false;
	const result = withSessionStateLock(cachePath, () => {
		ran = true;
		return "ok";
	});

	// Live + fresh holder -> retries exhaust -> contended, callback never runs.
	expect(ran).toBe(false);
	expect(result).toBe(SESSION_STATE_LOCK_CONTENDED);
	rmSync(lockPath, { recursive: true, force: true });
});

test("clearSessionState는 누수된 .lock 디렉터리도 함께 제거한다", () => {
	mkdirSync(scratchDir, { recursive: true });
	writeFileSync(cachePath, "{}\n");
	const lockPath = `${cachePath}.lock`;
	mkdirSync(lockPath);

	clearSessionState(cachePath);

	expect(existsSync(cachePath)).toBe(false);
	expect(existsSync(lockPath)).toBe(false);
});
