import { randomBytes } from "node:crypto";
import { cp, mkdir, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Generates a random hex session ID for backup directories.
 * Uses 8 random bytes → 16 hex characters.
 */
export function generateBackupSessionId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Backs up a single category directory from a platform's dot-directory.
 * Source: {targetPath}/.{platform}/{category}/
 * Destination: {targetPath}/.sync-backup/{sessionId}/{platform}/{category}/
 * Skips silently if the source directory does not exist.
 */
export async function backupCategory(
  targetPath: string,
  platform: string,
  category: string,
  sessionId: string
): Promise<void> {
  const sourceDir = join(targetPath, `.${platform}`, category);

  try {
    await stat(sourceDir);
  } catch {
    // Source does not exist — skip
    return;
  }

  const destDir = join(
    targetPath,
    ".sync-backup",
    sessionId,
    platform,
    category
  );

  await mkdir(destDir, { recursive: true });
  await cp(sourceDir, destDir, { recursive: true });
}

/**
 * Backs up a single config file to the given backup directory.
 * Skips silently if the file does not exist.
 */
export async function backupConfigFile(
  filePath: string,
  backupDir: string
): Promise<void> {
  try {
    await stat(filePath);
  } catch {
    // File does not exist — skip
    return;
  }

  await mkdir(backupDir, { recursive: true });

  const fileName = filePath.split("/").at(-1) ?? filePath;
  const destFile = join(backupDir, fileName);

  await cp(filePath, destFile);
}

/**
 * Removes session directories under {targetPath}/.sync-backup/ that are
 * older than retentionDays based on directory modification time.
 * If retentionDays is 0, all session directories are removed.
 */
export async function cleanupOldBackups(
  targetPath: string,
  retentionDays: number
): Promise<void> {
  const backupDir = join(targetPath, ".sync-backup");

  try {
    await stat(backupDir);
  } catch {
    // Backup directory does not exist — nothing to clean
    return;
  }

  const entries = await readdir(backupDir);
  const now = Date.now();
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    const entryPath = join(backupDir, entry);

    let entryStats;
    try {
      entryStats = await stat(entryPath);
    } catch {
      continue;
    }

    if (!entryStats.isDirectory()) {
      continue;
    }

    if (retentionDays === 0) {
      await rm(entryPath, { recursive: true, force: true });
    } else {
      const ageMs = now - entryStats.mtimeMs;
      if (ageMs > retentionMs) {
        await rm(entryPath, { recursive: true, force: true });
      }
    }
  }
}
