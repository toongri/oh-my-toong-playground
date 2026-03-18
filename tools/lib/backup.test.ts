import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateBackupSessionId,
  backupCategory,
  backupConfigFile,
  cleanupOldBackups,
} from "./backup.ts";

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

  describe("backupCategory", () => {
    it("copies source directory to .sync-backup/{sessionId}/{platform}/{category}/", async () => {
      const targetPath = join(tmpDir, "backup-category-basic");
      const platform = "claude";
      const category = "agents";
      const sessionId = "test-session-01";

      // Create source files
      const sourceDir = join(targetPath, `.${platform}`, category);
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, "oracle.md"), "# Oracle");
      await writeFile(join(sourceDir, "sisyphus.md"), "# Sisyphus");

      await backupCategory(targetPath, platform, category, sessionId);

      const destDir = join(targetPath, ".sync-backup", sessionId, platform, category);
      const files = await readdir(destDir);
      expect(files).toContain("oracle.md");
      expect(files).toContain("sisyphus.md");
    });

    it("does nothing when source directory is missing", async () => {
      const targetPath = join(tmpDir, "backup-category-missing");
      await mkdir(targetPath, { recursive: true });

      // Should not throw
      await backupCategory(targetPath, "claude", "skills", "sess-missing");

      // No .sync-backup directory should be created
      let exists = true;
      try {
        await stat(join(targetPath, ".sync-backup"));
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    });

    it("creates destination even when intermediate directories are absent", async () => {
      const targetPath = join(tmpDir, "backup-category-deep");
      const platform = "gemini";
      const category = "commands";
      const sessionId = "deep-sess";

      const sourceDir = join(targetPath, `.${platform}`, category);
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, "cmd.md"), "# cmd");

      await backupCategory(targetPath, platform, category, sessionId);

      const destDir = join(targetPath, ".sync-backup", sessionId, platform, category);
      const files = await readdir(destDir);
      expect(files).toContain("cmd.md");
    });

    it("selects the correct dot-directory for each platform", async () => {
      const targetPath = join(tmpDir, "backup-category-platform");
      const sessionId = "platform-sess";

      for (const platform of ["claude", "gemini", "codex"]) {
        const sourceDir = join(targetPath, `.${platform}`, "skills");
        await mkdir(sourceDir, { recursive: true });
        await writeFile(join(sourceDir, `${platform}.md`), `# ${platform}`);

        await backupCategory(targetPath, platform, "skills", sessionId);

        const destDir = join(targetPath, ".sync-backup", sessionId, platform, "skills");
        const files = await readdir(destDir);
        expect(files).toContain(`${platform}.md`);
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
  });

  describe("cleanupOldBackups", () => {
    it("does nothing when .sync-backup directory does not exist", async () => {
      const targetPath = join(tmpDir, "cleanup-no-dir");
      await mkdir(targetPath, { recursive: true });

      // Should not throw
      await cleanupOldBackups(targetPath, 7);
    });

    it("deletes all session directories when retentionDays is 0", async () => {
      const targetPath = join(tmpDir, "cleanup-zero");
      const backupDir = join(targetPath, ".sync-backup");

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
      const backupDir = join(targetPath, ".sync-backup");

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
      const backupDir = join(targetPath, ".sync-backup");
      await mkdir(backupDir, { recursive: true });

      // Place a plain file in .sync-backup (not a directory)
      const orphanFile = join(backupDir, "orphan.txt");
      await writeFile(orphanFile, "stray");

      await cleanupOldBackups(targetPath, 0);

      // Plain file should remain untouched
      const s = await stat(orphanFile);
      expect(s.isFile()).toBe(true);
    });
  });
});
