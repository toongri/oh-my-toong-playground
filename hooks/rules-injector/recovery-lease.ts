// A post-compact recovery lease records WHO is recovering a kind and WHEN they
// started, so a second hook racing in can tell an in-flight recovery (refuse the
// re-claim) from a dead orphan (safe to steal). A bare boolean marker cannot make
// that distinction — #8/#14. The discriminator pairs ownerPid with startedAt +
// a TTL ceiling: ownerPid ALONE is unsafe because the OS reuses PIDs after death,
// so a fresh process could falsely look like the original recoverer.

export interface RecoveryLease {
	readonly ownerPid: number;
	readonly startedAt: number;
	readonly leaseTTL: number;
}

// Worst-case recovery is bounded by a full transcript read+scan. The transcript is
// capped by the model context window the post-compact budget targets (the largest
// configured window is 272k tokens; the unknown-model fallback is 200k), at roughly
// 3 transcript chars per token. We size the lease TTL to comfortably EXCEED the time
// to read+scan that worst-case transcript on a slow disk, with margin for scheduler
// pauses — a too-short TTL would let a second hook steal an actively-recovering kind
// and re-run recovery (double recovery), which is exactly what the lease prevents.
const WORST_CASE_CONTEXT_WINDOW_TOKENS = 272_000;
const ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN = 3;
const WORST_CASE_TRANSCRIPT_BYTES =
	WORST_CASE_CONTEXT_WINDOW_TOKENS * ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN;
// Conservative effective throughput for read + JSON-line scan + string allocation on
// a cold/contended disk. Deliberately pessimistic (~0.25 MB/s) so the derived TTL is
// an upper bound, not a typical-case estimate.
const CONSERVATIVE_RECOVERY_BYTES_PER_MS = 256;
// Floor so a tiny transcript still grants enough headroom for GC / scheduler stalls.
const MIN_RECOVERY_LEASE_TTL_MS = 30_000;

export function recoveryLeaseTtlMs(): number {
	const derived = Math.ceil(WORST_CASE_TRANSCRIPT_BYTES / CONSERVATIVE_RECOVERY_BYTES_PER_MS);
	return Math.max(MIN_RECOVERY_LEASE_TTL_MS, derived);
}

export function newRecoveryLease(
	now: number = Date.now(),
	ownerPid: number = process.pid,
): RecoveryLease {
	return { ownerPid, startedAt: now, leaseTTL: recoveryLeaseTtlMs() };
}

// A lease is ACTIVE — and the kind must NOT be re-claimed — when its owner is still
// alive OR the lease has not yet expired. Both halves matter: a live owner may have a
// stale clock, and a dead owner may have left a fresh-looking lease behind. Refuse
// only while at least one signal says "still in flight".
export function isRecoveryLeaseActive(lease: RecoveryLease, now: number = Date.now()): boolean {
	if (isPidAlive(lease.ownerPid)) {
		return true;
	}
	return now - lease.startedAt < lease.leaseTTL;
}

export function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		// Signal 0 performs existence/permission checks without delivering a signal.
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// ESRCH => no such process (dead). EPERM => process exists but is owned by
		// another user — still alive, so treat as alive.
		return errorCode(error) === "EPERM";
	}
}

export function isRecoveryLease(value: unknown): value is RecoveryLease {
	return (
		isRecord(value) &&
		typeof value["ownerPid"] === "number" &&
		typeof value["startedAt"] === "number" &&
		typeof value["leaseTTL"] === "number"
	);
}

function errorCode(error: unknown): unknown {
	if (!isRecord(error)) {
		return undefined;
	}
	return Reflect.get(error, "code");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
