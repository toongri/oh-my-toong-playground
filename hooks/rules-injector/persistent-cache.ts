import { type Dirent, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { writeErrorBreadcrumb } from "./debug-log.js";
import {
	type PostCompactPendingKind,
	type PostCompactPendingState,
	postCompactKindState,
	postCompactPendingKinds,
	postCompactRecoveringKinds,
} from "./post-compact-state.js";
import {
	type RecoveryLease,
	isPidAlive,
	isRecoveryLease,
	isRecoveryLeaseActive,
	newRecoveryLease,
} from "./recovery-lease.js";
import type { Engine } from "./rules/index.js";
import {
	readLockHolderPid,
	SESSION_STATE_LOCK_CONTENDED,
	type SessionStateLockResult,
	withSessionStateLock,
} from "./session-state-lock.js";

export type PostCompactClaimResult = "claimed" | "not-pending" | "contended";

const STATE_VERSION = 1;

type RecoveryLeaseRecord = Partial<Record<PostCompactPendingKind, RecoveryLease>>;

interface SerializedSessionState {
	version?: number;
	staticDedup: string[];
	dynamicDedup: Record<string, string[]>;
	postCompactPending?: PostCompactPendingState;
	postCompactRecovering?: PostCompactPendingState;
	recoveryLease?: RecoveryLeaseRecord;
	compacted?: boolean;
}

export function hydrateEngineState(engine: Engine, cachePath: string): void {
	const state = readSessionState(cachePath);
	engine.state.staticDedup.clear();
	engine.state.dynamicDedup.clear();

	for (const key of state.staticDedup) {
		engine.state.staticDedup.add(key);
	}
	for (const [scope, keys] of Object.entries(state.dynamicDedup)) {
		engine.state.dynamicDedup.set(scope, new Set(keys));
	}
}

export function persistEngineState(
	engine: Engine,
	cachePath: string,
	completedPostCompactKind?: PostCompactPendingKind,
): void {
	// #7: read-modify-write the shared <sid>.json under the lock. PostCompact and an
	// in-flight PostToolUse are different events with no shared mutex, so an unlocked
	// read-then-write here loses cross-event updates in BOTH directions (a dropped
	// postCompactPending recovery marker AND a dropped dynamic dedup key). Atomic
	// temp-rename would only prevent torn writes, not lost updates — only the lock does.
	updateSessionState(cachePath, (currentState) => {
		const dynamicDedup: Record<string, string[]> = {};
		for (const [scope, keys] of engine.state.dynamicDedup.entries()) {
			dynamicDedup[scope] = [...keys];
		}

		const postCompactPending = nextPostCompactPending(currentState, completedPostCompactKind);
		const postCompactRecovering = nextPostCompactRecovering(currentState, completedPostCompactKind);
		const recoveryLease = nextRecoveryLease(currentState, completedPostCompactKind);
		return {
			staticDedup: [...engine.state.staticDedup],
			dynamicDedup,
			...(postCompactPending === undefined ? {} : { postCompactPending }),
			...(postCompactRecovering === undefined ? {} : { postCompactRecovering }),
			...(recoveryLease === undefined ? {} : { recoveryLease }),
		};
	});
}

export function clearSessionState(cachePath: string): void {
	rmSync(cachePath, { force: true });
	// Drop any leaked lock dir alongside the state file so a killed holder cannot
	// wedge the fresh session that reuses this path (#14).
	rmSync(`${cachePath}.lock`, { recursive: true, force: true });
}

export function markSessionCompacted(cachePath: string): void {
	// #7: same locked read-modify-write as persistEngineState — preserves a concurrent
	// PostToolUse's dynamicDedup writes instead of clobbering them.
	updateSessionState(cachePath, (state) => ({
		// Compaction drops injected static rule bodies, so pre-compaction static
		// dedup marks must not suppress the post-compact recovery directive.
		// Dynamic dedup survives: those rules are recovered as read-directive paths.
		staticDedup: [],
		dynamicDedup: state.dynamicDedup,
		postCompactPending: { static: true, dynamic: true },
	}));
}

// Locked read-modify-write over the shared session-state file. On the rare event of
// lock contention (all retries exhausted) it falls back to a single unlocked RMW so a
// write is never silently dropped — no worse than the pre-lock behavior, but the
// common path is now serialized.
function updateSessionState(cachePath: string, fn: (state: SerializedSessionState) => SerializedSessionState): void {
	const result = withSessionStateLock(cachePath, () => {
		writeSessionState(cachePath, fn(readSessionState(cachePath)));
	});
	if (result === SESSION_STATE_LOCK_CONTENDED) {
		writeSessionState(cachePath, fn(readSessionState(cachePath)));
	}
}

export function hasPostCompactPending(cachePath: string): boolean {
	const state = readSessionState(cachePath);
	return postCompactPendingKinds(state).size > 0 || postCompactRecoveringKinds(state).size > 0;
}

export function isPostCompactPending(cachePath: string, kind: PostCompactPendingKind): boolean {
	return postCompactPendingKinds(readSessionState(cachePath)).has(kind);
}

export function claimPostCompactPending(cachePath: string, kind: PostCompactPendingKind): PostCompactClaimResult {
	const result = withSessionStateLock(cachePath, (): SessionStateLockResult<PostCompactClaimResult> => {
		const state = readSessionState(cachePath);
		const pendingKinds = postCompactPendingKinds(state);
		const recoveringKinds = postCompactRecoveringKinds(state);
		const leaseRecord = recoveryLeaseRecord(state);

		if (!pendingKinds.has(kind) && !recoveringKinds.has(kind)) {
			return "not-pending";
		}

		// Orphaned recovery: the kind is recovering but no longer pending — a prior hook
		// moved it pending->recovering, and either completed (cleared) or died mid-flight.
		// A boolean marker alone cannot tell an in-flight recovery from a dead orphan
		// (#8/#14), so consult the lease the owner stamped on its claim. If the lease is
		// still ACTIVE (owner alive OR not yet expired), a genuine recovery is in flight —
		// refuse, surfaced as "contended" so the wedge gate skips this turn. Only when the
		// lease is absent/stale do we re-claim, healing a session that would otherwise
		// wedge forever waiting on a dead recoverer.
		if (!pendingKinds.has(kind)) {
			const lease = leaseRecord[kind];
			if (lease !== undefined && isRecoveryLeaseActive(lease)) {
				return SESSION_STATE_LOCK_CONTENDED;
			}
		}

		pendingKinds.delete(kind);
		recoveringKinds.add(kind);
		// Stamp a fresh lease: THIS hook now owns recovery of this kind, so a later
		// racing hook can detect the in-flight work and refuse to double-recover.
		const nextLease: RecoveryLeaseRecord = { ...leaseRecord, [kind]: newRecoveryLease() };
		writeSessionState(cachePath, stateWithPostCompactKinds(state, pendingKinds, recoveringKinds, nextLease));
		return "claimed";
	});
	return result === SESSION_STATE_LOCK_CONTENDED ? "contended" : result;
}

export function isPostCompactRecoveryInProgress(cachePath: string, kind: PostCompactPendingKind): boolean {
	return postCompactRecoveringKinds(readSessionState(cachePath)).has(kind);
}

export function completePostCompactRecovery(cachePath: string, kind: PostCompactPendingKind): void {
	updateSessionState(cachePath, (state) => {
		const pendingKinds = postCompactPendingKinds(state);
		const recoveringKinds = postCompactRecoveringKinds(state);
		recoveringKinds.delete(kind);
		// Recovery is done: drop this kind's lease so the slot is free again.
		const nextLease: RecoveryLeaseRecord = { ...recoveryLeaseRecord(state) };
		delete nextLease[kind];
		return stateWithPostCompactKinds(state, pendingKinds, recoveringKinds, nextLease);
	});
}

export function sessionCachePath(sessionId: string, pluginDataRoot?: string): string {
	const root = pluginDataRoot ?? join(homedir(), ".omt", "rules-injector");
	return join(root, `${safePathSegment(sessionId)}.json`);
}

// Reused as the leaked-directory backstop below: no legitimate lock hold lasts a
// full day (the lock only wraps in-memory RMW), so this also doubles as the sweep
// throttle window — at most once per `dir` per day, bounding the readdir+stat cost
// on the pathological thousands-of-files dir this sweep targets.
const STALE_SESSION_SWEEP_THROTTLE_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort GC: deletes sibling `<sid>.json` session-state files (plus their
 * `.lock` dir, via `clearSessionState`) whose mtime is older than `ttlMs`, except
 * `ownCachePath` (self-preservation — a stale-mtime resume must never delete its
 * own pending recovery state) and any sibling whose `.lock/pid` names a live
 * process (never break mutual exclusion out from under an active holder).
 * Throttled by a `last-swept` marker file so it runs at most once per 24h per
 * `dir`. Every fs op is wrapped; on error it records a breadcrumb and continues.
 * Never throws.
 */
export function sweepStaleSessionStates(dir: string, ttlMs: number, ownCachePath: string): void {
	try {
		if (isSweepThrottled(dir)) {
			return;
		}
		touchSweepMarker(dir);

		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch (error) {
			writeErrorBreadcrumb("sweepStaleSessionStates:readdir", error);
			return;
		}

		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) {
				continue;
			}
			const siblingPath = join(dir, entry.name);
			if (siblingPath === ownCachePath) {
				continue;
			}
			try {
				if (!isStale(siblingPath, ttlMs) || !isSessionStateFile(siblingPath) || hasLiveLockHolder(siblingPath)) {
					continue;
				}
				clearSessionState(siblingPath);
			} catch (error) {
				writeErrorBreadcrumb("sweepStaleSessionStates:entry", error);
			}
		}
	} catch (error) {
		writeErrorBreadcrumb("sweepStaleSessionStates", error);
	}
}

function sweepMarkerPath(dir: string): string {
	return join(dir, "last-swept");
}

function isSweepThrottled(dir: string): boolean {
	try {
		return Date.now() - statSync(sweepMarkerPath(dir)).mtimeMs < STALE_SESSION_SWEEP_THROTTLE_MS;
	} catch {
		// No marker yet (or unreadable): not throttled.
		return false;
	}
}

function touchSweepMarker(dir: string): void {
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(sweepMarkerPath(dir), "");
	} catch (error) {
		writeErrorBreadcrumb("sweepStaleSessionStates:marker", error);
	}
}

function isStale(path: string, ttlMs: number): boolean {
	return statSync(path).mtimeMs + ttlMs < Date.now();
}

// A sibling whose `.lock/pid` names a still-running process is being actively
// recovered and must not be reaped out from under it.
function hasLiveLockHolder(cachePath: string): boolean {
	const pid = readLockHolderPid(`${cachePath}.lock`);
	return pid !== undefined && isPidAlive(pid);
}

// Positively identify one of our own <sid>.json records before deleting. When
// pluginDataRoot points at a directory shared with unrelated JSON (a config or
// package.json), a stale `.json` sibling that is NOT a session-state record must
// never be reaped. Mirrors readSessionState's discriminator (version + shape);
// a corrupt/foreign file fails it and is left untouched rather than deleted.
function isSessionStateFile(path: string): boolean {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) && parsed["version"] === STATE_VERSION && isSerializedSessionState(parsed);
	} catch {
		return false;
	}
}

function readSessionState(cachePath: string): SerializedSessionState {
	try {
		const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
		if (!isRecord(parsed) || parsed["version"] !== STATE_VERSION) return emptyState();
		if (!isSerializedSessionState(parsed)) return emptyState();
		return parsed;
	} catch {
		return emptyState();
	}
}

function writeSessionState(cachePath: string, state: SerializedSessionState): void {
	mkdirSync(dirname(cachePath), { recursive: true });
	writeFileSync(cachePath, `${JSON.stringify({ version: STATE_VERSION, ...state })}\n`);
}

function emptyState(): SerializedSessionState {
	return { staticDedup: [], dynamicDedup: {} };
}

function nextPostCompactPending(
	state: SerializedSessionState,
	completedKind: PostCompactPendingKind | undefined,
): PostCompactPendingState | undefined {
	const pendingKinds = postCompactPendingKinds(state);
	if (completedKind !== undefined) {
		pendingKinds.delete(completedKind);
	}

	if (pendingKinds.size === 0) {
		return undefined;
	}

	return {
		...(pendingKinds.has("static") ? { static: true } : {}),
		...(pendingKinds.has("dynamic") ? { dynamic: true } : {}),
	};
}

function nextPostCompactRecovering(
	state: SerializedSessionState,
	completedKind: PostCompactPendingKind | undefined,
): PostCompactPendingState | undefined {
	const recoveringKinds = postCompactRecoveringKinds(state);
	if (completedKind !== undefined) {
		recoveringKinds.delete(completedKind);
	}

	return postCompactKindState(recoveringKinds);
}

// A persisted write completing `completedKind` also frees that kind's lease; every
// other kind's lease carries forward unchanged.
function nextRecoveryLease(
	state: SerializedSessionState,
	completedKind: PostCompactPendingKind | undefined,
): RecoveryLeaseRecord | undefined {
	const leases: RecoveryLeaseRecord = { ...recoveryLeaseRecord(state) };
	if (completedKind !== undefined) {
		delete leases[completedKind];
	}
	return pruneLeasesToRecovering(leases, postCompactRecoveringKinds(state), completedKind);
}

function recoveryLeaseRecord(state: SerializedSessionState): RecoveryLeaseRecord {
	return state.recoveryLease ?? {};
}

// Keep only leases for kinds that remain recovering, so a completed/cleared kind never
// leaves a dangling lease behind that a future claim would misread as in-flight.
function pruneLeasesToRecovering(
	leases: RecoveryLeaseRecord,
	recoveringKinds: ReadonlySet<PostCompactPendingKind>,
	completedKind: PostCompactPendingKind | undefined,
): RecoveryLeaseRecord | undefined {
	const pruned: RecoveryLeaseRecord = {};
	for (const kind of ["static", "dynamic"] as const) {
		const lease = leases[kind];
		const stillRecovering = recoveringKinds.has(kind) && kind !== completedKind;
		if (lease !== undefined && stillRecovering) {
			pruned[kind] = lease;
		}
	}
	return Object.keys(pruned).length === 0 ? undefined : pruned;
}

function stateWithPostCompactKinds(
	state: SerializedSessionState,
	pendingKinds: ReadonlySet<PostCompactPendingKind>,
	recoveringKinds: ReadonlySet<PostCompactPendingKind>,
	leaseRecord: RecoveryLeaseRecord = recoveryLeaseRecord(state),
): SerializedSessionState {
	const postCompactPending = postCompactKindState(pendingKinds);
	const postCompactRecovering = postCompactKindState(recoveringKinds);
	const recoveryLease = pruneLeasesToRecovering(leaseRecord, recoveringKinds, undefined);
	return {
		staticDedup: state.staticDedup,
		dynamicDedup: state.dynamicDedup,
		...(postCompactPending === undefined ? {} : { postCompactPending }),
		...(postCompactRecovering === undefined ? {} : { postCompactRecovering }),
		...(recoveryLease === undefined ? {} : { recoveryLease }),
	};
}

function safePathSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown-session";
}

function isSerializedSessionState(value: unknown): value is SerializedSessionState {
	if (!isRecord(value) || !Array.isArray(value["staticDedup"]) || !isRecord(value["dynamicDedup"])) {
		return false;
	}
	const staticDedup = value["staticDedup"];
	const dynamicDedup = value["dynamicDedup"];
	const postCompactPending = value["postCompactPending"];
	const postCompactRecovering = value["postCompactRecovering"];
	const recoveryLease = value["recoveryLease"];
	const compacted = value["compacted"];
	return (
		staticDedup.every((item) => typeof item === "string") &&
		Object.values(dynamicDedup).every(
			(item) => Array.isArray(item) && item.every((nestedItem) => typeof nestedItem === "string"),
		) &&
		(postCompactPending === undefined || isPostCompactPendingState(postCompactPending)) &&
		(postCompactRecovering === undefined || isPostCompactPendingState(postCompactRecovering)) &&
		(recoveryLease === undefined || isRecoveryLeaseRecord(recoveryLease)) &&
		(compacted === undefined || typeof compacted === "boolean")
	);
}

function isRecoveryLeaseRecord(value: unknown): value is RecoveryLeaseRecord {
	return (
		isRecord(value) &&
		Object.entries(value).every(
			([key, lease]) => (key === "static" || key === "dynamic") && isRecoveryLease(lease),
		)
	);
}

function isPostCompactPendingState(value: unknown): value is PostCompactPendingState {
	return (
		isRecord(value) &&
		(value["static"] === undefined || typeof value["static"] === "boolean") &&
		(value["dynamic"] === undefined || typeof value["dynamic"] === "boolean")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
