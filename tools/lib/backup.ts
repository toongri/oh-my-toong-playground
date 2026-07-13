import { randomBytes } from "node:crypto";
import { cp, mkdir, rm, readdir, stat, lstat } from "node:fs/promises";
// `os` is imported as a namespace (not `{ homedir }`) so tests can
// `spyOn(os, "homedir")` and have the override observed here — a named
// import binds the value at import time and a spy on the module's own
// export would not be seen through this module's binding.
import * as os from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { logError, logWarn } from "./logger.ts";

/**
 * Generates a random hex session ID for backup directories.
 * Uses 8 random bytes → 16 hex characters.
 */
export function generateBackupSessionId(): string {
	return randomBytes(8).toString("hex");
}

/**
 * Returns true if `err` is a Node.js errno exception (has a `code` field).
 */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err;
}

/**
 * Backs up a single category directory from a platform's dot-directory.
 * Source: {targetPath}/.{platform}/{category}/
 * Destination: {backupDest}/{platform}/{category}/
 * Skips silently if the source directory does not exist.
 */
export async function backupCategory(
	targetPath: string,
	platform: string,
	category: string,
	backupDest: string,
): Promise<void> {
	const sourceDir = join(targetPath, `.${platform}`, category);

	try {
		await stat(sourceDir);
	} catch (err) {
		if (isErrnoException(err) && err.code === "ENOENT") {
			return;
		}
		throw err;
	}

	const destDir = join(backupDest, platform, category);

	await mkdir(destDir, { recursive: true });
	await cp(sourceDir, destDir, { recursive: true });
}

/**
 * Backs up a single config file to the given backup directory.
 * Skips silently if the file does not exist.
 */
export async function backupConfigFile(filePath: string, backupDir: string): Promise<void> {
	try {
		await stat(filePath);
	} catch (err) {
		if (isErrnoException(err) && err.code === "ENOENT") {
			return;
		}
		throw err;
	}

	await mkdir(backupDir, { recursive: true });

	const fileName = filePath.split("/").at(-1) ?? filePath;
	const destFile = join(backupDir, fileName);

	await cp(filePath, destFile);
}

/**
 * Backs up a single docs target file before it is overwritten or deleted.
 * Source: targetFilePath
 * Destination: {backupDest}/docs/<relpath>
 *   where <relpath> is targetFilePath's path relative to deployRoot
 *   (subdirectory structure preserved).
 * Per-file only (never a directory copy), reusing backupConfigFile.
 * Skips silently if the target file does not exist yet.
 */
export async function backupDocs(
	targetFilePath: string,
	deployRoot: string,
	backupDest: string,
): Promise<void> {
	const relPath = relative(deployRoot, targetFilePath);
	const backupDir = join(backupDest, "docs", dirname(relPath));

	await backupConfigFile(targetFilePath, backupDir);
}

/**
 * Pure predicate for cleanupOldBackups: false iff `base` is a degenerate
 * root that would make the recursive prune below far more destructive than
 * intended (a relative path resolved against an unexpected cwd, "/", or the
 * user's home directory). Bases merely *near* home (e.g. "/Users",
 * "$HOME/Documents") are deliberately NOT rejected — this targets only the
 * three degenerate cases, since OMT_DIR is a user-owned value.
 * No fs access, no env reads, no logging — pure string/path logic only.
 */
export function isSafeBackupRoot(base: string): boolean {
	if (!isAbsolute(base)) {
		return false;
	}
	const resolved = resolve(base);
	if (resolved === "/" || resolved === os.homedir()) {
		return false;
	}
	return true;
}

/**
 * Removes session directories under {base}/sync-backup/ that are
 * older than retentionDays based on directory modification time.
 * If retentionDays is 0, all session directories are removed.
 */
export async function cleanupOldBackups(base: string, retentionDays: number): Promise<void> {
	const backupDir = join(base, "sync-backup");

	// Both guards below MUST log-and-return, never throw. The sole caller
	// (tools/sync.ts:2083) wraps this call in `.catch(() => {})`, so a thrown
	// error here would be silently swallowed in production — the guard would
	// be disarmed at exactly the moment it matters, while a test asserting on
	// a rejection would stay green and hide the regression. logError + return
	// keeps the refusal visible on stderr in both environments. Do not "fix"
	// this asymmetry by switching to throw.
	if (!isSafeBackupRoot(base)) {
		logError(`안전하지 않은 백업 루트, 정리를 건너뜁니다: ${base}`);
		return;
	}

	try {
		const backupDirLstat = await lstat(backupDir);
		if (backupDirLstat.isSymbolicLink()) {
			logError(`백업 루트가 심볼릭 링크입니다, 정리를 건너뜁니다: ${backupDir}`);
			return;
		}
	} catch (err) {
		if (!isErrnoException(err) || err.code !== "ENOENT") {
			throw err;
		}
		// No sync-backup dir yet — not a symlink. Fall through; the stat()
		// below hits the same ENOENT and no-ops as before.
	}

	try {
		await stat(backupDir);
	} catch (err) {
		if (isErrnoException(err) && err.code === "ENOENT") {
			return;
		}
		throw err;
	}

	const entries = await readdir(backupDir);
	const now = Date.now();
	const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

	for (const entry of entries) {
		const entryPath = join(backupDir, entry);

		let entryStats;
		try {
			entryStats = await stat(entryPath);
		} catch (err) {
			if (isErrnoException(err) && err.code === "ENOENT") {
				continue;
			}
			throw err;
		}

		if (!entryStats.isDirectory()) {
			continue;
		}

		if (retentionDays === 0) {
			try {
				await rm(entryPath, { recursive: true, force: true });
			} catch (err) {
				logWarn(
					`백업 디렉토리 삭제 실패, 건너뜀: ${entryPath}: ${err instanceof Error ? err.message : err}`,
				);
			}
		} else {
			const ageMs = now - entryStats.mtimeMs;
			if (ageMs > retentionMs) {
				try {
					await rm(entryPath, { recursive: true, force: true });
				} catch (err) {
					logWarn(
						`백업 디렉토리 삭제 실패, 건너뜀: ${entryPath}: ${err instanceof Error ? err.message : err}`,
					);
				}
			}
		}
	}
}
