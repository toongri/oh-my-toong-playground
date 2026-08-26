/**
 * Machine-wide worker concurrency cap.
 *
 * orchestrate-review's conductor dispatches up to 4 members per chunk-review
 * job (job.ts's spawnWorkers), and the orchestrator itself may run several
 * chunk-review jobs at once — each spawned worker.ts then runs a heavy CLI
 * child (`codex exec` and friends) via runOneTurn/resumeOneTurn. The cap this
 * module enforces is deliberately NOT per-job: 8 jobs x 4 members with no
 * shared limit is exactly what drove load average to 40 on a 10-core box
 * (measured: 15 concurrent `codex exec` processes). A slot pool rooted at
 * $OMT_DIR is the one thing every worker.ts process on this machine shares,
 * regardless of which job or which conductor spawned it.
 *
 * Slot claim primitive mirrors job.ts's acquireIdentityClaim (same file,
 * `cmdStart`): O_EXCL create is the atomic acquisition step, and a dead- or
 * reused-pid owner is reclaimed via the same pid + pidStartedAt witness
 * getProcessStartedAt already provides — the exact "kill -0 equivalent, but
 * pid-reuse-safe" liveness check this codebase already established for
 * workerPgid liveness (see judgePgidSignal in generic-job.ts) and reuses here
 * rather than inventing a second liveness mechanism.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { ensureDir, sleepMs } from "@lib/job-utils";
import { getOmtDir } from "@lib/omt-dir";
import { getProcessStartedAt } from "@lib/generic-job";

export interface WorkerSlot {
	slotPath: string;
}

export interface AcquireWorkerSlotOptions {
	/** Slot pool directory. Defaults to $OMT_DIR/worker-slots (machine-wide). */
	dir?: string;
	/** Pool size. Defaults to resolveSlotCount(). */
	slotCount?: number;
	/** Poll interval while every slot is occupied. Defaults to 1500ms (spec: 1-2s). */
	pollMs?: number;
}

const DEFAULT_POLL_MS = 1500;

/**
 * A slot file that exists but carries no readable/valid owner pid is either
 * genuinely corrupt, or caught in the sub-millisecond window between its
 * owner's openSync(wx) and writeFileSync (see writeOwnerRecord) — or, worse,
 * its owner was SIGKILLed/panicked/OOM'd in exactly that window and will
 * never complete the write. Only reclaim past this staleness bound, mirroring
 * acquireIdentityClaim's identical fallback for a lock file with no usable
 * owner PID (job.ts).
 */
const CORRUPT_SLOT_STALE_MS = 60_000;

export function resolveSlotCount(): number {
	const raw = process.env.OMT_WORKER_SLOTS;
	if (raw !== undefined && raw.trim() !== "") {
		const n = Number(raw);
		if (Number.isFinite(n) && Number.isInteger(n) && n > 0) return n;
	}
	const cpuCount = os.cpus().length || 1;
	return Math.max(1, cpuCount - 2);
}

export function slotsDir(): string {
	return path.join(getOmtDir(), "worker-slots");
}

function ownerRecord(): string {
	return JSON.stringify({ pid: process.pid, pidStartedAt: getProcessStartedAt(process.pid) });
}

/** Atomic create-if-absent: true iff this call is the one that created slotPath. */
function claimFreshSlot(slotPath: string): boolean {
	let fd: number;
	try {
		fd = fs.openSync(slotPath, "wx");
	} catch {
		return false;
	}
	try {
		fs.writeFileSync(fd, ownerRecord());
	} finally {
		fs.closeSync(fd);
	}
	return true;
}

interface SlotOwner {
	pid?: unknown;
	pidStartedAt?: unknown;
}

/** Judge whether slotPath's current owner is gone, reusing generic-job.ts's
 *  pid+pidStartedAt reused-pid witness rather than a bare `kill -0`. */
function ownerIsDead(slotPath: string): boolean {
	let owner: SlotOwner | null;
	try {
		owner = JSON.parse(fs.readFileSync(slotPath, "utf8"));
	} catch {
		owner = null;
	}

	if (owner === null || typeof owner.pid !== "number" || !Number.isFinite(owner.pid)) {
		try {
			return Date.now() - fs.statSync(slotPath).mtimeMs > CORRUPT_SLOT_STALE_MS;
		} catch {
			return false; // vanished mid-check — treat as still contended, retry later
		}
	}

	const pid = owner.pid;
	try {
		process.kill(pid, 0);
	} catch (error) {
		// Same idiom as job.ts's acquireIdentityClaim: only ESRCH is proof of
		// death; any other outcome (e.g. EPERM) is inconclusive, not dead.
		return error instanceof Error && "code" in error && error.code === "ESRCH";
	}
	// pid is alive — but is it still OUR owner, or has the OS handed this
	// number to an unrelated process since the record was written?
	const storedStartedAt = typeof owner.pidStartedAt === "string" ? owner.pidStartedAt : null;
	const currentStartedAt = getProcessStartedAt(pid);
	return storedStartedAt !== null && currentStartedAt !== null && storedStartedAt !== currentStartedAt;
}

/** Claim slotPath, reclaiming a dead/reused-pid owner's abandoned slot first. */
function tryClaimSlot(slotPath: string): boolean {
	if (claimFreshSlot(slotPath)) return true;
	if (!ownerIsDead(slotPath)) return false;

	try {
		fs.unlinkSync(slotPath);
	} catch {
		// Another contender may have reclaimed it first — fall through and retry.
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
			if (tryClaimSlot(slotPath)) {
				return { slotPath };
			}
		}
		await sleepMs(pollMs);
	}
}

/** Release a previously-acquired slot. Safe to call even if the slot file was
 *  already reclaimed by another contender's dead-owner sweep (double release,
 *  or a false-positive dead judgment racing this same release). */
export function releaseWorkerSlot(slot: WorkerSlot): void {
	try {
		fs.unlinkSync(slot.slotPath);
	} catch {
		// Already gone — fine either way.
	}
}
