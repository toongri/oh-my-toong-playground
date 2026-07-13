import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	readdir,
	stat,
	chmod,
	symlink,
	utimes,
} from "node:fs/promises";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	generateBackupSessionId,
	backupCategory,
	backupConfigFile,
	backupDocs,
	cleanupOldBackups,
	isSafeBackupRoot,
} from "./backup.ts";

/** Sets a directory's mtime far enough in the past to clear any retention window used in these tests. */
async function ageDir(dirPath: string): Promise<void> {
	const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
	await utimes(dirPath, past, past);
}

/** Captures process.stderr.write output for the duration of `fn`, restoring it afterward. */
async function captureStderr(fn: () => Promise<void>): Promise<string> {
	const original = process.stderr.write.bind(process.stderr);
	let captured = "";
	process.stderr.write = ((chunk: string | Uint8Array) => {
		captured += chunk.toString();
		return true;
	}) as typeof process.stderr.write;
	try {
		await fn();
	} finally {
		process.stderr.write = original;
	}
	return captured;
}

describe("backup 모듈", () => {
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "omt-backup-test-"));
	});

	afterAll(async () => {
		const { rm } = await import("node:fs/promises");
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("generateBackupSessionId", () => {
		it("returns a 16-character hex string", () => {
			const id = generateBackupSessionId();
			expect(id).toMatch(/^[0-9a-f]{16}$/);
		});

		it("generates a unique value on each call", () => {
			const ids = new Set(Array.from({ length: 20 }, () => generateBackupSessionId()));
			expect(ids.size).toBe(20);
		});
	});

	describe("isSafeBackupRoot", () => {
		it("isSafeBackupRoot rejects non-absolute, root, and homedir bases", () => {
			expect(isSafeBackupRoot("./x")).toBe(false);
			expect(isSafeBackupRoot("/")).toBe(false);
			expect(isSafeBackupRoot(os.homedir())).toBe(false);
			expect(isSafeBackupRoot("/tmp/omt-xyz")).toBe(true);
		});
	});

	describe("backupCategory", () => {
		it("copies source directory to {backupDest}/{platform}/{category}/", async () => {
			const targetPath = join(tmpDir, "backup-category-basic");
			const platform = "claude";
			const category = "agents";
			const backupDest = join(tmpDir, "backup-category-basic-dest");

			// Create source files
			const sourceDir = join(targetPath, `.${platform}`, category);
			await mkdir(sourceDir, { recursive: true });
			await writeFile(join(sourceDir, "oracle.md"), "# Oracle");
			await writeFile(join(sourceDir, "sisyphus.md"), "# Sisyphus");

			await backupCategory(targetPath, platform, category, backupDest);

			const destDir = join(backupDest, platform, category);
			const files = await readdir(destDir);
			expect(files).toContain("oracle.md");
			expect(files).toContain("sisyphus.md");
		});

		it("does nothing when source directory is missing", async () => {
			const targetPath = join(tmpDir, "backup-category-missing");
			await mkdir(targetPath, { recursive: true });
			const backupDest = join(tmpDir, "backup-category-missing-dest");

			// Should not throw
			await backupCategory(targetPath, "claude", "skills", backupDest);

			// No backup destination directory should be created
			let exists = true;
			try {
				await stat(backupDest);
			} catch {
				exists = false;
			}
			expect(exists).toBe(false);
		});

		it("creates destination even when intermediate directories are absent", async () => {
			const targetPath = join(tmpDir, "backup-category-deep");
			const platform = "gemini";
			const category = "commands";
			const backupDest = join(tmpDir, "backup-category-deep-dest");

			const sourceDir = join(targetPath, `.${platform}`, category);
			await mkdir(sourceDir, { recursive: true });
			await writeFile(join(sourceDir, "cmd.md"), "# cmd");

			await backupCategory(targetPath, platform, category, backupDest);

			const destDir = join(backupDest, platform, category);
			const files = await readdir(destDir);
			expect(files).toContain("cmd.md");
		});

		it("selects the correct dot-directory for each platform", async () => {
			const targetPath = join(tmpDir, "backup-category-platform");
			const backupDest = join(tmpDir, "backup-category-platform-dest");

			for (const platform of ["claude", "gemini", "codex"]) {
				const sourceDir = join(targetPath, `.${platform}`, "skills");
				await mkdir(sourceDir, { recursive: true });
				await writeFile(join(sourceDir, `${platform}.md`), `# ${platform}`);

				await backupCategory(targetPath, platform, "skills", backupDest);

				const destDir = join(backupDest, platform, "skills");
				const files = await readdir(destDir);
				expect(files).toContain(`${platform}.md`);
			}
		});

		it("propagates non-ENOENT stat errors (e.g., EACCES)", async () => {
			const targetPath = join(tmpDir, "backup-category-eacces");
			const platformDir = join(targetPath, ".claude");
			await mkdir(platformDir, { recursive: true });
			const backupDest = join(tmpDir, "backup-category-eacces-dest");

			// Remove execute permission on the platform directory so stat of its
			// children returns EACCES (code !== "ENOENT") → must rethrow
			await chmod(platformDir, 0o000);

			try {
				await expect(
					backupCategory(targetPath, "claude", "agents", backupDest),
				).rejects.toThrow();
			} finally {
				await chmod(platformDir, 0o755);
			}
		});
	});

	describe("backupConfigFile", () => {
		it("copies file into the backup directory", async () => {
			const targetPath = join(tmpDir, "backup-file-basic");
			const backupDir = join(targetPath, ".sync-backup", "sess01", "claude");

			const srcFile = join(targetPath, "settings.json");
			await mkdir(targetPath, { recursive: true });
			await writeFile(srcFile, '{"key": "value"}');

			await backupConfigFile(srcFile, backupDir);

			const destFile = join(backupDir, "settings.json");
			const stats = await stat(destFile);
			expect(stats.isFile()).toBe(true);
		});

		it("does nothing when file does not exist", async () => {
			const missingFile = join(tmpDir, "nonexistent", "settings.json");
			const backupDir = join(tmpDir, "backup-file-missing");

			// Should not throw
			await backupConfigFile(missingFile, backupDir);

			// backupDir should not be created
			let exists = true;
			try {
				await stat(backupDir);
			} catch {
				exists = false;
			}
			expect(exists).toBe(false);
		});

		it("auto-creates the backup directory when it does not exist", async () => {
			const targetPath = join(tmpDir, "backup-file-mkdir");
			const backupDir = join(targetPath, "deep", "nested", "dir");

			await mkdir(targetPath, { recursive: true });
			const srcFile = join(targetPath, "config.toml");
			await writeFile(srcFile, '[config]\nkey = "val"');

			await backupConfigFile(srcFile, backupDir);

			const destFile = join(backupDir, "config.toml");
			const stats = await stat(destFile);
			expect(stats.isFile()).toBe(true);
		});

		it("propagates non-ENOENT stat errors (e.g., EACCES)", async () => {
			const targetPath = join(tmpDir, "backup-file-eacces");
			await mkdir(targetPath, { recursive: true });

			// Remove execute permission on the parent directory so stat of a child
			// file returns EACCES (code !== "ENOENT") → must rethrow
			await chmod(targetPath, 0o000);

			try {
				await expect(
					backupConfigFile(
						join(targetPath, "settings.json"),
						join(tmpDir, "backup-file-eacces-dest"),
					),
				).rejects.toThrow();
			} finally {
				await chmod(targetPath, 0o755);
			}
		});
	});

	describe("backupDocs", () => {
		it("docs backup before mutate: copies the target file into {backupDest}/docs/<relpath> preserving subdirectories", async () => {
			const deployRoot = join(tmpDir, "docs-backup-basic");
			const backupDest = join(tmpDir, "docs-backup-basic-dest");
			const relPath = join("skills", "prometheus", "SKILL.md");
			const targetFilePath = join(deployRoot, relPath);

			await mkdir(join(deployRoot, "skills", "prometheus"), { recursive: true });
			await writeFile(targetFilePath, "# Original content");

			await backupDocs(targetFilePath, deployRoot, backupDest);

			const backedUpFile = join(backupDest, "docs", relPath);
			const content = await readFile(backedUpFile, "utf-8");
			expect(content).toBe("# Original content");
		});

		it("does nothing when the target file does not exist yet", async () => {
			const deployRoot = join(tmpDir, "docs-backup-missing");
			await mkdir(deployRoot, { recursive: true });
			const targetFilePath = join(deployRoot, "docs", "new-file.md");
			const backupDest = join(tmpDir, "docs-backup-missing-dest");

			// Should not throw
			await backupDocs(targetFilePath, deployRoot, backupDest);

			// No backup destination directory should be created
			let exists = true;
			try {
				await stat(backupDest);
			} catch {
				exists = false;
			}
			expect(exists).toBe(false);
		});

		it("docs backup retention: cleanupOldBackups(deployRoot, 0) removes the docs session dir", async () => {
			// cleanupOldBackups now prunes the dotless <base>/sync-backup/ root
			// (see cleanupOldBackups's own repointing). backupDocs itself still
			// writes to the dotted .sync-backup/ (that writer relocation is a
			// later story) so this test plants directly under the new root
			// instead of relying on backupDocs's output — that is the new
			// contract the pruner is tested against.
			const deployRoot = join(tmpDir, "docs-backup-retention");
			const sessionId = "docs-sess-retention";

			const sessDocsDir = join(deployRoot, "sync-backup", sessionId, "docs");
			await mkdir(sessDocsDir, { recursive: true });
			await writeFile(join(sessDocsDir, "readme.md"), "content");

			await cleanupOldBackups(deployRoot, 0);

			const remaining = await readdir(join(deployRoot, "sync-backup"));
			expect(remaining).toHaveLength(0);
		});
	});

	describe("cleanupOldBackups", () => {
		it("does nothing when sync-backup directory does not exist", async () => {
			const targetPath = join(tmpDir, "cleanup-no-dir");
			await mkdir(targetPath, { recursive: true });

			// Should not throw
			await cleanupOldBackups(targetPath, 7);
		});

		it("deletes all session directories when retentionDays is 0", async () => {
			const targetPath = join(tmpDir, "cleanup-zero");
			const backupDir = join(targetPath, "sync-backup");

			for (const session of ["sess-a", "sess-b", "sess-c"]) {
				await mkdir(join(backupDir, session), { recursive: true });
				await writeFile(join(backupDir, session, "file.txt"), "data");
			}

			await cleanupOldBackups(targetPath, 0);

			const remaining = await readdir(backupDir);
			expect(remaining).toHaveLength(0);
		});

		it("preserves sessions within retentionDays", async () => {
			const targetPath = join(tmpDir, "cleanup-retain");
			const backupDir = join(targetPath, "sync-backup");

			// Create a session directory (mtime = now)
			const recentSession = join(backupDir, "recent-sess");
			await mkdir(recentSession, { recursive: true });

			await cleanupOldBackups(targetPath, 7);

			// Recent session should survive
			const remaining = await readdir(backupDir);
			expect(remaining).toContain("recent-sess");
		});

		it("leaves plain files (non-directories) untouched", async () => {
			const targetPath = join(tmpDir, "cleanup-files");
			const backupDir = join(targetPath, "sync-backup");
			await mkdir(backupDir, { recursive: true });

			// Place a plain file in sync-backup (not a directory)
			const orphanFile = join(backupDir, "orphan.txt");
			await writeFile(orphanFile, "stray");

			await cleanupOldBackups(targetPath, 0);

			// Plain file should remain untouched
			const s = await stat(orphanFile);
			expect(s.isFile()).toBe(true);
		});

		it("does not throw and processes all entries when rm() fails on some", async () => {
			const targetPath = join(tmpDir, "cleanup-rm-fail");
			const backupDir = join(targetPath, "sync-backup");

			// Create three session directories to delete (retentionDays=0)
			for (const name of ["sess-rm-a", "sess-rm-b", "sess-rm-c"]) {
				const sessDir = join(backupDir, name);
				await mkdir(sessDir, { recursive: true });
				await writeFile(join(sessDir, "file.txt"), "data");
			}

			// Remove write permission from sync-backup so all rm() calls fail
			// (deleting a child entry requires write on the parent directory)
			await chmod(backupDir, 0o555);

			try {
				// Key invariant: does not throw even though rm() fails for every entry
				await cleanupOldBackups(targetPath, 0);
			} finally {
				await chmod(backupDir, 0o755);
			}

			// All three entries survive (rm failed for each), confirming the loop
			// ran through all entries without aborting on the first failure
			const remaining = await readdir(backupDir);
			expect(remaining).toHaveLength(3);
		});

		it("cleanupOldBackups prunes the backup root by age", async () => {
			const base = join(tmpDir, "cleanup-age-prune-dotless");
			const backupDir = join(base, "sync-backup");

			const agedDir = join(backupDir, "aged-sess");
			await mkdir(agedDir, { recursive: true });
			await ageDir(agedDir);

			const freshDir = join(backupDir, "fresh-sess");
			await mkdir(freshDir, { recursive: true });

			await cleanupOldBackups(base, 3);

			const remaining = await readdir(backupDir);
			expect(remaining).not.toContain("aged-sess");
			expect(remaining).toContain("fresh-sess");
		});

		it("cleanupOldBackups no-ops when root absent", async () => {
			const base = join(tmpDir, "cleanup-root-absent-dotless");
			await mkdir(base, { recursive: true });

			await expect(cleanupOldBackups(base, 7)).resolves.toBeUndefined();
		});

		it("cleanupOldBackups refuses a relative base and deletes nothing", async () => {
			const cwdBefore = process.cwd();
			const relTmpParent = await mkdtemp(join(tmpdir(), "omt-backup-relbase-"));
			process.chdir(relTmpParent);
			try {
				const agedDir = join(".", "x", "sync-backup", "aged-sess");
				await mkdir(agedDir, { recursive: true });
				const sentinel = join(agedDir, "sentinel.txt");
				await writeFile(sentinel, "precious");
				await ageDir(agedDir);

				await cleanupOldBackups("./x", 3);

				const dirStats = await stat(agedDir);
				expect(dirStats.isDirectory()).toBe(true);
				const fileStats = await stat(sentinel);
				expect(fileStats.isFile()).toBe(true);
			} finally {
				process.chdir(cwdBefore);
			}
		});

		it("cleanupOldBackups refuses a homedir base and deletes nothing", async () => {
			const fakeHome = await mkdtemp(join(tmpdir(), "omt-backup-homedir-"));
			const homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
			try {
				const agedDir = join(fakeHome, "sync-backup", "aged-sess");
				await mkdir(agedDir, { recursive: true });
				const sentinel = join(agedDir, "sentinel.txt");
				await writeFile(sentinel, "precious");
				await ageDir(agedDir);

				await cleanupOldBackups(fakeHome, 3);

				const dirStats = await stat(agedDir);
				expect(dirStats.isDirectory()).toBe(true);
				const fileStats = await stat(sentinel);
				expect(fileStats.isFile()).toBe(true);
			} finally {
				homedirSpy.mockRestore();
			}
		});

		it("unsafe backup root emits logError", async () => {
			const refusedBase = "./relative-unsafe-base";
			const captured = await captureStderr(async () => {
				await cleanupOldBackups(refusedBase, 3);
			});

			expect(captured).toContain(refusedBase);
			expect(captured.toLowerCase()).toContain("error");
		});

		it("cleanupOldBackups refuses a symlinked backup root and deletes nothing", async () => {
			const base = await mkdtemp(join(tmpdir(), "omt-backup-symlink-base-"));
			const victim = await mkdtemp(join(tmpdir(), "omt-backup-symlink-victim-"));
			const agedDir = join(victim, "aged");
			await mkdir(agedDir, { recursive: true });
			const precious = join(agedDir, "PRECIOUS.txt");
			await writeFile(precious, "do not delete");
			await ageDir(agedDir);

			await symlink(victim, join(base, "sync-backup"));

			const captured = await captureStderr(async () => {
				await cleanupOldBackups(base, 3);
			});

			const preciousStats = await stat(precious);
			expect(preciousStats.isFile()).toBe(true);
			expect(captured).toContain(join(base, "sync-backup"));
		});
	});
});
