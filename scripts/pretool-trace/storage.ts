import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { resolveOmtDir } from "@lib/omt-dir";
import { join } from "node:path";

const LIMIT = 1024 * 1024;
const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;
const LOCK_INIT_GRACE_MS = 1000;
const KEY_LEASE_LOCK_SUFFIX = ".lease-lock";

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
	return typeof value === "object" && value !== null && "code" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type StoragePaths = { dir: string; events: string; lock: string; keys: string };

export function storagePaths(cwd: string = process.cwd()): StoragePaths {
	const base = resolveOmtDir(cwd);
	const dir = join(base, "pretool-trace");
	return { dir, events: join(dir, "events.jsonl"), lock: join(dir, ".append.lock"), keys: join(dir, "keys") };
}

function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true, mode: PRIVATE_DIR });
	chmodSync(path, PRIVATE_DIR);
}

function ensureLayout(paths: StoragePaths): void {
	ensureDir(paths.dir);
	ensureDir(paths.keys);
}

function recoverLeaseLock(lock: string): boolean {
	try {
		const lockStat = lstatSync(lock);
		if (!lockStat.isDirectory() || lockStat.isSymbolicLink()) return false;
		const entries = readdirSync(lock);
		const owners = entries.filter((entry) => /^owner-[0-9]+-[0-9a-f]+$/.test(entry));
		if (owners.length === 1 && entries.length === 1) {
			const owner = owners[0];
			const ownerStat = lstatSync(join(lock, owner));
			if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) return false;
			const match = /^owner-([0-9]+)-([0-9a-f]+)$/.exec(owner);
			if (!match) return false;
			if (readFileSync(join(lock, owner)).byteLength !== 0) return false;
			try { process.kill(Number(match[1]), 0); return false; }
			catch (error) {
				if (!isErrnoException(error) || error.code !== "ESRCH") return false;
				try { unlinkSync(join(lock, owner)); rmdirSync(lock); return true; } catch { return false; }
			}
		}
		if (entries.length === 0 && Date.now() - lockStat.mtimeMs > LOCK_INIT_GRACE_MS) {
			try { rmdirSync(lock); return true; } catch { return false; }
		}
		return false;
	} catch { return false; }
}

function acquireLeaseLock(lock: string): string | null {
	for (let attempt = 0; attempt < 20; attempt++) {
		let created = false;
		let owner: string | null = null;
		try {
			mkdirSync(lock, { mode: PRIVATE_DIR });
			created = true;
			const nonce = randomBytes(8).toString("hex");
			owner = join(lock, `owner-${process.pid}-${nonce}`);
			const fd = openSync(owner, "wx", PRIVATE_FILE);
			try { chmodSync(owner, PRIVATE_FILE); }
			finally { closeSync(fd); }
			chmodSync(lock, PRIVATE_DIR);
			return owner;
		} catch (error) {
			if (created) { if (owner !== null) try { unlinkSync(owner); } catch { /* cleanup */ } try { rmdirSync(lock); } catch { /* cleanup */ } }
			if (!isErrnoException(error) || error.code !== "EEXIST") return null;
			if (recoverLeaseLock(lock)) continue;
			if (attempt === 19) return null;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
		}
	}
	return null;
}

function readExistingKey(file: string): Uint8Array {
	const leaseLock = `${file}${KEY_LEASE_LOCK_SUFFIX}`;
	const owner = acquireLeaseLock(leaseLock);
	if (owner === null) return new Uint8Array(0);
		try {
			const fileStat = lstatSync(file);
			if (!fileStat.isFile() || fileStat.isSymbolicLink()) return new Uint8Array(0);
			const existing = readFileSync(file);
			if (existing.byteLength !== 32) return new Uint8Array(0);
			const now = new Date();
			utimesSync(file, now, now);
			return new Uint8Array(existing);
		} catch {
			return new Uint8Array(0);
		} finally {
			try { unlinkSync(owner); } catch { /* fail-open cleanup */ }
			try { rmdirSync(leaseLock); } catch { /* fail-open cleanup */ }
		}
}

/** Return the per-locator 32-byte key, creating it atomically on first use. */
function getSessionKeyOnce(locator: string): Uint8Array {
	try {
		if (typeof locator !== "string" || !/^[0-9a-f]{64}$/.test(locator)) return new Uint8Array(0);
		const paths = storagePaths();
		ensureLayout(paths);
		const name = `${locator}.key`;
		const file = join(paths.keys, name);
		const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
		try {
			const fd = openSync(temporary, "wx", PRIVATE_FILE);
			try {
				const key = randomBytes(32);
				writeFileSync(fd, key);
				chmodSync(temporary, PRIVATE_FILE);
				try {
					linkSync(temporary, file);
					return new Uint8Array(key);
					} catch (linkError) {
						if (!isErrnoException(linkError) || linkError.code !== "EEXIST") throw linkError;
					return readExistingKey(file);
					}
			} finally { closeSync(fd); }
		} catch (error) {
			if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
			return readExistingKey(file);
		} finally {
			try { unlinkSync(temporary); } catch { /* already linked or failed */ }
		}
	} catch {
		return new Uint8Array(0);
	}
}

export function getSessionKey(locator: string): Uint8Array {
	for (let attempt = 0; attempt < 3; attempt++) {
		const key = getSessionKeyOnce(locator);
		if (key.byteLength === 32) return key;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
	}
	return new Uint8Array(0);
}

function rotate(paths: StoragePaths): void {
	for (let generation = 3; generation >= 1; generation--) {
		const source = generation === 1 ? paths.events : `${paths.events}.${generation - 1}`;
		const target = `${paths.events}.${generation}`;
		if (existsSync(target)) unlinkSync(target);
		if (existsSync(source)) renameSync(source, target);
	}
}

type AppendLock = { owner: string };

function inspectAndRecoverLock(lock: string): boolean {
	try {
		const lockStat = lstatSync(lock);
		if (!lockStat.isDirectory() || lockStat.isSymbolicLink()) return false;
		const entries = readdirSync(lock);
		const owners = entries.filter((entry) => /^owner-[0-9]+-[0-9a-f]+$/.test(entry));
		if (owners.length === 1 && entries.length === 1) {
			const owner = owners[0];
			const ownerStat = lstatSync(join(lock, owner));
			if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) return false;
			const metadata: unknown = JSON.parse(readFileSync(join(lock, owner), "utf8"));
			if (!isRecord(metadata)) return false;
			const record = metadata;
			if (Object.keys(record).length !== 2 || typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0 || typeof record.nonce !== "string") return false;
			const match = /^owner-([0-9]+)-([0-9a-f]+)$/.exec(owner);
			if (!match || Number(match[1]) !== record.pid || match[2] !== record.nonce) return false;
			try {
				process.kill(record.pid, 0);
				return false;
			} catch (error) {
				if (!isErrnoException(error) || error.code !== "ESRCH") return false;
				try {
					unlinkSync(join(lock, owner));
					rmdirSync(lock);
					return true;
				} catch { return false; }
			}
		}
		if (entries.length === 0 && Date.now() - lockStat.mtimeMs > LOCK_INIT_GRACE_MS) {
			try { rmdirSync(lock); return true; } catch { return false; }
		}
		return false;
	} catch { return false; }
}

function acquireAppendLock(lock: string): AppendLock | null {
	for (let attempt = 0; attempt < 2; attempt++) {
		let created = false;
		let owner: string | null = null;
		try {
			mkdirSync(lock, { mode: PRIVATE_DIR });
			created = true;
			const nonce = randomBytes(8).toString("hex");
			owner = join(lock, `owner-${process.pid}-${nonce}`);
			const fd = openSync(owner, "wx", PRIVATE_FILE);
			try {
				writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce }));
				chmodSync(owner, PRIVATE_FILE);
			} finally { closeSync(fd); }
			chmodSync(lock, PRIVATE_DIR);
			return { owner };
		} catch (error) {
			if (created) {
				if (owner !== null) try { unlinkSync(owner); } catch { /* partial owner cleanup */ }
				try { rmdirSync(lock); } catch { /* partial lock cleanup */ }
			}
			if (!isErrnoException(error) || error.code !== "EEXIST" || attempt !== 0 || !inspectAndRecoverLock(lock)) return null;
		}
	}
	return null;
}

/** Append one JSON line. Any contention or filesystem error is deliberately dropped. */
export function appendEvent(value: unknown): boolean {
	let paths: StoragePaths;
	try {
		paths = storagePaths();
		const serialized = JSON.stringify(value);
		if (serialized === undefined) return false;
		const line = `${serialized}\n`;
		if (Buffer.byteLength(line) > LIMIT) return false;
		ensureLayout(paths);
		const lock = acquireAppendLock(paths.lock);
		if (lock === null) return false;
		try {
			let size = 0;
			try { size = statSync(paths.events).size; } catch (error) {
				if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
			}
			if (size + Buffer.byteLength(line) > LIMIT) rotate(paths);
			const fd = openSync(paths.events, "a", PRIVATE_FILE);
			try { writeFileSync(fd, line, { encoding: "utf8" }); } finally { closeSync(fd); }
			chmodSync(paths.events, PRIVATE_FILE);
			return true;
		} finally {
			try { unlinkSync(lock.owner); } catch { /* fail-open cleanup */ }
			try { rmdirSync(paths.lock); } catch { /* fail-open cleanup */ }
		}
	} catch {
		return false;
	}
}

export const appendJsonLine = appendEvent;
