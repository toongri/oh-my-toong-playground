import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isPidAlive, recoveryLeaseTtlMs } from "./recovery-lease.js";

export const SESSION_STATE_LOCK_CONTENDED = Symbol("session-state-lock-contended");

export type SessionStateLockResult<T> = T | typeof SESSION_STATE_LOCK_CONTENDED;

const LOCK_RETRY_COUNT = 20;
const LOCK_RETRY_DELAY_MS = 5;
const LOCK_SLEEP_VIEW = new Int32Array(new SharedArrayBuffer(4));
// A .lock dir only ever wraps in-memory read-modify-write callbacks (sub-millisecond),
// so a dir older than the recovery lease TTL — the longest anchored duration in this
// subsystem — is provably leaked, not legitimately held. Reusing that TTL avoids a
// second magic constant; it is far longer than any real hold, so the PID-liveness
// check is the fast path and the TTL is only the PID-reuse backstop.
const LOCK_STALE_TTL_MS = recoveryLeaseTtlMs();

export function withSessionStateLock<T>(cachePath: string, callback: () => T): SessionStateLockResult<T> {
	const lockPath = `${cachePath}.lock`;
	mkdirSync(dirname(cachePath), { recursive: true });
	for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
		try {
			mkdirSync(lockPath);
			writeLockHolderPid(lockPath);
			try {
				return callback();
			} finally {
				rmSync(lockPath, { recursive: true, force: true });
			}
		} catch (error) {
			if (errorCode(error) === "EEXIST") {
				// A holder is present. Steal it if it is provably dead (its PID is gone) or
				// stale (older than any legitimate hold could last); otherwise wait and retry.
				if (isLockStealable(lockPath)) {
					rmSync(lockPath, { recursive: true, force: true });
					continue;
				}
				sleepSync(LOCK_RETRY_DELAY_MS);
				continue;
			}
			throw error;
		}
	}
	return SESSION_STATE_LOCK_CONTENDED;
}

function writeLockHolderPid(lockPath: string): void {
	try {
		writeFileSync(join(lockPath, "pid"), String(process.pid));
	} catch {
		// Best-effort: a missing pid file just falls back to the mtime-TTL check.
	}
}

function isLockStealable(lockPath: string): boolean {
	const holderPid = readLockHolderPid(lockPath);
	if (holderPid !== undefined && !isPidAlive(holderPid)) {
		return true;
	}
	return lockMtimeMs(lockPath) + LOCK_STALE_TTL_MS < Date.now();
}

function readLockHolderPid(lockPath: string): number | undefined {
	try {
		const pid = Number.parseInt(readFileSync(join(lockPath, "pid"), "utf8").trim(), 10);
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

function lockMtimeMs(lockPath: string): number {
	try {
		return statSync(lockPath).mtimeMs;
	} catch {
		// Dir vanished between EEXIST and stat: treat as immediately stealable.
		return 0;
	}
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

function sleepSync(milliseconds: number): void {
	Atomics.wait(LOCK_SLEEP_VIEW, 0, 0, milliseconds);
}
