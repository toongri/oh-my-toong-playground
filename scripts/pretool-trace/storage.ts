import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolveOmtDir } from "@lib/omt-dir";
import { join } from "node:path";

const LIMIT = 1024 * 1024;
const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
	return typeof value === "object" && value !== null && "code" in value;
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

/** Return the per-locator 32-byte key, creating it atomically on first use. */
export function getSessionKey(locator: string): Uint8Array {
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
					const existing = readFileSync(file);
					return existing.byteLength === 32 ? new Uint8Array(existing) : new Uint8Array(0);
				}
			} finally { closeSync(fd); }
		} catch (error) {
			if (!isErrnoException(error) || error.code !== "EEXIST") throw error;
			const existing = readFileSync(file);
			return existing.byteLength === 32 ? new Uint8Array(existing) : new Uint8Array(0);
		} finally {
			try { unlinkSync(temporary); } catch { /* already linked or failed */ }
		}
	} catch {
		return new Uint8Array(0);
	}
}

function rotate(paths: StoragePaths): void {
	for (let generation = 3; generation >= 1; generation--) {
		const source = generation === 1 ? paths.events : `${paths.events}.${generation - 1}`;
		const target = `${paths.events}.${generation}`;
		if (existsSync(target)) unlinkSync(target);
		if (existsSync(source)) renameSync(source, target);
	}
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
		mkdirSync(paths.lock, { mode: PRIVATE_DIR });
		try {
			chmodSync(paths.lock, PRIVATE_DIR);
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
			try { rmdirSync(paths.lock); } catch { /* fail-open cleanup */ }
		}
	} catch {
		return false;
	}
}

export const appendJsonLine = appendEvent;
