import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const STATE_LOCK_RETRIES = 100;
const STATE_LOCK_RETRY_MS = 5;
const STATE_LOCK_SLEEP = new Int32Array(new SharedArrayBuffer(4));
const STATE_LOCK_STALE_TTL_MS = 30_000;
const STATE_LOCK_OWNER_FILE = "owner.json";

type StateLockOwner = { ownerPid: number; token: string; startedAt: number };

/**
 * Minimal mkdir lock for every read-modify-write of an ultragoal state file. A
 * contention timeout fails closed; callers never fall back to an unlocked write.
 */
export function withStateLock<T>(stateFilePath: string, callback: () => T): T {
	const lockPath = `${stateFilePath}.lock`;
	for (let attempt = 0; attempt < STATE_LOCK_RETRIES; attempt += 1) {
		const token = randomUUID();
		try {
			mkdirSync(lockPath);
			writeFileSync(
				join(lockPath, STATE_LOCK_OWNER_FILE),
				JSON.stringify({
					ownerPid: process.pid,
					token,
					startedAt: Date.now(),
				} satisfies StateLockOwner),
			);
			try {
				return callback();
			} finally {
				releaseStateLock(lockPath, token);
			}
		} catch (err) {
			if (isErrnoException(err) && err.code === "EEXIST") {
				if (!recoverStaleStateLock(lockPath)) {
					Atomics.wait(STATE_LOCK_SLEEP, 0, 0, STATE_LOCK_RETRY_MS);
				}
				continue;
			}
			throw err;
		}
	}
	throw new Error("ultragoal-state: state lock contended; refusing unlocked write");
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStateLockOwner(lockPath: string): StateLockOwner | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(join(lockPath, STATE_LOCK_OWNER_FILE), "utf8"));
		if (
			isRecord(value) &&
			typeof value.ownerPid === "number" &&
			Number.isInteger(value.ownerPid) &&
			value.ownerPid > 0 &&
			typeof value.token === "string" &&
			value.token.length > 0 &&
			typeof value.startedAt === "number"
		) {
			return { ownerPid: value.ownerPid, token: value.token, startedAt: value.startedAt };
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function isStateLockStale(lockPath: string): boolean {
	const owner = readStateLockOwner(lockPath);
	if (owner !== undefined && !isPidAlive(owner.ownerPid)) return true;
	try {
		return statSync(lockPath).mtimeMs + STATE_LOCK_STALE_TTL_MS < Date.now();
	} catch {
		return true;
	}
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return isErrnoException(err) && err.code === "EPERM";
	}
}

/** Serializes stale recovery so a second observer cannot rename a successor lock. */
function recoverStaleStateLock(lockPath: string): boolean {
	let recovered = false;
	if (
		!withStateLockRecoveryGuard(lockPath, () => {
			if (!isStateLockStale(lockPath)) return;
			isolateAndRemoveStaleLock(lockPath);
			recovered = true;
		})
	) {
		return false;
	}
	return recovered;
}

/** Prevents stale recovery from racing a token-checked holder release. */
function withStateLockRecoveryGuard(lockPath: string, callback: () => void): boolean {
	const recoveryPath = `${lockPath}.recovery`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			mkdirSync(recoveryPath);
		} catch (err) {
			if (!(isErrnoException(err) && err.code === "EEXIST")) throw err;
			if (!isStateLockStale(recoveryPath)) return false;
			isolateAndRemoveStaleLock(recoveryPath);
			continue;
		}
		try {
			callback();
			return true;
		} finally {
			rmSync(recoveryPath, { recursive: true, force: true });
		}
	}
	return false;
}

function isolateAndRemoveStaleLock(lockPath: string): void {
	const stalePath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
	try {
		renameSync(lockPath, stalePath);
	} catch (err) {
		if (isErrnoException(err) && (err.code === "ENOENT" || err.code === "EEXIST")) return;
		throw err;
	}
	rmSync(stalePath, { recursive: true, force: true });
}

function releaseStateLock(lockPath: string, token: string): void {
	// Keep waiting until the recovery guard is acquired; abandoned guards are
	// reclaimed by withStateLockRecoveryGuard's existing stale-TTL path.
	while (true) {
		if (
			withStateLockRecoveryGuard(lockPath, () => {
				if (readStateLockOwner(lockPath)?.token === token) {
					rmSync(lockPath, { recursive: true, force: true });
				}
			})
		) {
			return;
		}
		// A fresh recovery guard may belong to a concurrent stale-lock observer;
		// wait for it rather than leaving our own primary lock behind.
		Atomics.wait(STATE_LOCK_SLEEP, 0, 0, STATE_LOCK_RETRY_MS);
	}
}
