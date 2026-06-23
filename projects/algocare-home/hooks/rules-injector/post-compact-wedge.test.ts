import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	claimPostCompactPending,
	completePostCompactRecovery,
	isPostCompactRecoveryInProgress,
} from "./persistent-cache.js";
import { shouldSkipPostCompactClaim } from "./post-compact-claim.js";

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
