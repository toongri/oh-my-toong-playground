/**
 * Machine-wide worker concurrency cap.
 *
 * code-review's conductor dispatches up to 4 members per chunk-review
 * job (job.ts's spawnWorkers), and the orchestrator itself may run several
 * chunk-review jobs at once — each spawned worker.ts then runs a heavy CLI
 * child (`codex exec` and friends) via runOneTurn/resumeOneTurn. The cap this
 * module enforces is deliberately NOT per-job: 8 jobs x 4 members with no
 * shared limit is exactly what drove load average to 40 on a 10-core box
 * (measured: 15 concurrent `codex exec` processes). A slot pool rooted at
 * $HOME/.omt/worker-slots/v2 is the one thing every worker.ts process on this
 * machine shares, regardless of which job or which conductor spawned it.
 *
 * Slot claim uses a directory lock with a UUID owner record. The directory's
 * mkdir is the atomic no-replace acquisition step, and a dead- or reused-pid
 * owner is reclaimed via the same pid + pidStartedAt witness
 * getProcessStartedAt already provides. Live owners heartbeat their unique
 * record every second; occupied polling uses kill-0 plus that heartbeat and
 * only consults the ps-backed witness when the heartbeat is stale. A matching
 * stale owner is re-heartbeated after the witness check so multiple waiters do
 * not repeat ps work in the same stale window.
 */

import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { ensureDir, sleepMs } from "@lib/job-utils";
import { getProcessStartedAt } from "@lib/generic-job";

export interface WorkerSlot {
	slotPath: string;
	ownerRecordPath: string;
}

export interface AcquireWorkerSlotOptions {
	/** Slot pool directory. Defaults to $HOME/.omt/worker-slots/v2 (machine-wide). */
	dir?: string;
	/** Pool size. Defaults to resolveSlotCount(). */
	slotCount?: number;
	/** Poll interval while every slot is occupied. Defaults to 1500ms (spec: 1-2s). */
	pollMs?: number;
}

const DEFAULT_POLL_MS = 1500;
const HEARTBEAT_INTERVAL_MS = 1000;
const HEARTBEAT_STALE_MS = 5000;

const heartbeatTimers = new WeakMap<WorkerSlot, ReturnType<typeof setInterval>>();

/** Best-effort mtime heartbeat for one owner generation. */
function touchOwnerRecord(ownerRecordPath: string): void {
	try {
		const now = new Date();
		fs.utimesSync(ownerRecordPath, now, now);
	} catch {
		// A released or externally reclaimed record no longer needs heartbeats.
	}
}

/** Start the owner-generation heartbeat without keeping the process alive. */
function startOwnerHeartbeat(ownerRecordPath: string): ReturnType<typeof setInterval> {
	const timer = setInterval(() => touchOwnerRecord(ownerRecordPath), HEARTBEAT_INTERVAL_MS);
	timer.unref();
	return timer;
}

/**
 * A slot directory that exists but carries no readable/valid owner pid is either
 * genuinely corrupt, or caught in the sub-millisecond window between its
 * owner's openSync(wx) and writeFileSync (see writeOwnerRecord) — or, worse,
 * its owner was SIGKILLed/panicked/OOM'd in exactly that window and will
 * never complete the write. Only reclaim past this staleness bound, mirroring
 * acquireIdentityClaim's identical fallback for a lock file with no usable
 * owner PID (job.ts).
 */
const CORRUPT_SLOT_STALE_MS = 60_000;

const DEFAULT_SLOT_COUNT = 12;

export function resolveSlotCount(): number {
	const raw = process.env.OMT_WORKER_SLOTS;
	if (raw !== undefined && raw.trim() !== "") {
		const n = Number(raw);
		if (Number.isFinite(n) && Number.isInteger(n) && n > 0) return n;
	}
	return DEFAULT_SLOT_COUNT;
}

export function slotsDir(): string {
	return path.join(os.homedir(), ".omt", "worker-slots", "v2");
}

function ownerRecord(): string {
	return JSON.stringify({ pid: process.pid, pidStartedAt: getProcessStartedAt(process.pid) });
}

const OWNER_RECORD_NAME = /^owner-[0-9a-f-]+\.json$/i;

type DeadSlot = { ownerRecordPath: string | null };

/**
 * Atomically reserve the slot directory with mkdir before doing the one
 * owner-witness lookup. The completed owner record is prepared in a private
 * sibling directory and moved into the reserved slot, so a contender can
 * never replace a live slot directory with a late rename. Reserving first
 * also keeps the one-time ps-backed witness lookup off the occupied-slot path.
 */
function claimFreshSlot(slotPath: string): string | null {
	const claimPath = path.join(path.dirname(slotPath), `.${path.basename(slotPath)}.claim-${randomUUID()}`);
	const ownerName = `owner-${randomUUID()}.json`;
	const temporaryOwnerPath = path.join(claimPath, ownerName);
	const ownerRecordPath = path.join(slotPath, ownerName);
	let slotCreated = false;
	let claimCreated = false;
	let ownerInstalled = false;

	try {
		fs.mkdirSync(slotPath);
		slotCreated = true;
		fs.mkdirSync(claimPath);
		claimCreated = true;
		fs.writeFileSync(temporaryOwnerPath, ownerRecord(), { flag: "wx" });
		fs.renameSync(temporaryOwnerPath, ownerRecordPath);
		ownerInstalled = true;
		return ownerRecordPath;
	} catch {
		return null;
	} finally {
		if (!ownerInstalled) {
			try {
				fs.unlinkSync(temporaryOwnerPath);
			} catch {
				// Best-effort cleanup of this claim's private owner record.
			}
		}
		if (claimCreated) {
			try {
				fs.rmdirSync(claimPath);
			} catch {
				// Best-effort cleanup; never recursively remove a claim directory.
			}
		}
		if (slotCreated && !ownerInstalled) {
			try {
				fs.rmdirSync(slotPath);
			} catch {
				// Only an empty directory can be removed here.
			}
		}
	}
}

interface SlotOwner {
	pid?: unknown;
	pidStartedAt?: unknown;
}

/** Judge whether slotPath's observed owner is gone, returning that exact
 * owner record path for the caller's conditional cleanup. */
function ownerIsDead(slotPath: string): DeadSlot | null {
	let ownerRecordPath: string;
	let slotMtimeMs: number;
	let ownerRecordMtimeMs: number;
	try {
		const slotStat = fs.lstatSync(slotPath);
		if (!slotStat.isDirectory() || slotStat.isSymbolicLink()) return null;
		slotMtimeMs = slotStat.mtimeMs;
		const entries = fs.readdirSync(slotPath);
		if (entries.length === 0) {
			return Date.now() - slotMtimeMs > CORRUPT_SLOT_STALE_MS ? { ownerRecordPath: null } : null;
		}
		if (entries.length !== 1 || !OWNER_RECORD_NAME.test(entries[0])) return null;
		ownerRecordPath = path.join(slotPath, entries[0]);
		const ownerStat = fs.lstatSync(ownerRecordPath);
		if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) return null;
		ownerRecordMtimeMs = ownerStat.mtimeMs;
	} catch {
		return null;
	}
	const observedOwnerRecordPath = ownerRecordPath;

	let owner: SlotOwner | null;
	try {
		owner = JSON.parse(fs.readFileSync(observedOwnerRecordPath, "utf8"));
	} catch {
		owner = null;
	}
	if (owner === null || typeof owner.pid !== "number" || !Number.isFinite(owner.pid)) {
		return Date.now() - slotMtimeMs > CORRUPT_SLOT_STALE_MS
			? { ownerRecordPath: observedOwnerRecordPath }
			: null;
	}

	const pid = owner.pid;
	try {
		process.kill(pid, 0);
	} catch (error) {
		// Same idiom as job.ts's acquireIdentityClaim: only ESRCH is proof of
		// death; any other outcome (e.g. EPERM) is inconclusive, not dead.
		return error instanceof Error && "code" in error && error.code === "ESRCH"
			? { ownerRecordPath: observedOwnerRecordPath }
			: null;
	}
	// A live pid with a fresh owner heartbeat is occupied. The heartbeat avoids
	// running the synchronous ps-backed witness lookup on every poll.
	if (Date.now() - ownerRecordMtimeMs <= HEARTBEAT_STALE_MS) return null;

	// The heartbeat is stale — is this still OUR owner, or has the OS handed
	// this number to an unrelated process since the record was written?
	const storedStartedAt = typeof owner.pidStartedAt === "string" ? owner.pidStartedAt : null;
	if (storedStartedAt === null) return null;
	const currentStartedAt = getProcessStartedAt(pid);
	if (currentStartedAt === null) return null;
	if (storedStartedAt !== currentStartedAt) return { ownerRecordPath: observedOwnerRecordPath };

	// The stale check proved that this is still the same owner. Refreshing the
	// exact record path coalesces later waiters' stale checks into this heartbeat
	// window without ever touching another generation's record.
	touchOwnerRecord(observedOwnerRecordPath);
	return null;
}

/** Claim slotPath, reclaiming a dead/reused-pid owner's abandoned slot first. */
function tryClaimSlot(slotPath: string): string | null {
	const freshOwnerRecordPath = claimFreshSlot(slotPath);
	if (freshOwnerRecordPath !== null) return freshOwnerRecordPath;
	const deadSlot = ownerIsDead(slotPath);
	if (deadSlot === null) return null;

	if (deadSlot.ownerRecordPath !== null) {
		try {
			fs.unlinkSync(deadSlot.ownerRecordPath);
		} catch {
			// Another contender may have reclaimed this exact owner record first.
		}
	}
	try {
		fs.rmdirSync(slotPath);
	} catch {
		// A new owner record or another directory entry keeps this generation live.
	}
	return claimFreshSlot(slotPath);
}

/**
 * Acquire one machine-wide worker slot, polling while the pool is full.
 * Resolves only once a slot is actually claimed — callers spawn their heavy
 * child process (e.g. `codex exec`) only after this resolves, never before.
 */
export async function acquireWorkerSlot(options: AcquireWorkerSlotOptions = {}): Promise<WorkerSlot> {
	const dir = options.dir ?? slotsDir();
	ensureDir(dir);
	const slotCount = options.slotCount ?? resolveSlotCount();
	const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

	for (;;) {
		for (let i = 0; i < slotCount; i++) {
			const slotPath = path.join(dir, `slot-${i}`);
			const ownerRecordPath = tryClaimSlot(slotPath);
			if (ownerRecordPath !== null) {
				const slot = { slotPath, ownerRecordPath };
				heartbeatTimers.set(slot, startOwnerHeartbeat(ownerRecordPath));
				return slot;
			}
		}
		await sleepMs(pollMs);
	}
}

/** Release a previously-acquired slot by stopping this generation's heartbeat,
 * removing only its owner record, then removing the slot directory only if it
 * is empty. Safe to call even if the slot was already reclaimed (double
 * release or a late release). */
export function releaseWorkerSlot(slot: WorkerSlot): void {
	const heartbeatTimer = heartbeatTimers.get(slot);
	if (heartbeatTimer !== undefined) {
		clearInterval(heartbeatTimer);
		heartbeatTimers.delete(slot);
	}
	try {
		fs.unlinkSync(slot.ownerRecordPath);
	} catch {
		// This generation's owner record is already gone — fine either way.
	}
	try {
		fs.rmdirSync(slot.slotPath);
	} catch {
		// A different generation's owner record keeps the slot live.
	}
}
