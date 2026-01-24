import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { RalphState, UltraworkState } from './types.js';

/**
 * Maximum age for state files to be considered "active".
 * Files older than this are treated as stale/abandoned sessions.
 */
const MAX_STATE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Check if a state file is stale based on file modification time (mtime).
 * Stale files are from abandoned sessions that didn't clean up.
 */
async function isStateFileStale(path: string): Promise<boolean> {
  try {
    const fileStat = await stat(path);
    const age = Date.now() - fileStat.mtimeMs;
    return age > MAX_STATE_AGE_MS;
  } catch {
    return true; // Treat errors as stale
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Find and read a state file from project-local path only.
 * Returns null if file doesn't exist or is stale (>2 hours old).
 *
 * Note: Global fallback (~/.claude/) was removed to prevent
 * state leakage between projects and parallel sessions.
 */
async function findStateFile<T>(cwd: string, filename: string): Promise<T | null> {
  // Project-local only (with stale check)
  const localPath = join(cwd, '.claude', 'sisyphus', filename);
  if (!await isStateFileStale(localPath)) {
    return readJsonFile<T>(localPath);
  }

  return null;
}

export async function readRalphState(cwd: string, sessionId: string = 'default'): Promise<RalphState | null> {
  return findStateFile<RalphState>(cwd, `ralph-state-${sessionId}.json`);
}

export async function readUltraworkState(cwd: string, sessionId: string = 'default'): Promise<UltraworkState | null> {
  return findStateFile<UltraworkState>(cwd, `ultrawork-state-${sessionId}.json`);
}

export async function readBackgroundTasks(): Promise<number> {
  const tasksDir = join(homedir(), '.claude', 'background-tasks');
  try {
    const files = await readdir(tasksDir);
    return files.filter(f => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

// Calculate session duration in minutes from start time
export function calculateSessionDuration(startedAt: Date | null): number | null {
  if (!startedAt) return null;
  const now = new Date();
  return Math.floor((now.getTime() - startedAt.getTime()) / 60000);
}

// Check if extended thinking is enabled (from stdin model or settings)
export async function isThinkingEnabled(): Promise<boolean> {
  // For now, return false as thinking detection requires runtime data
  // This can be enhanced later when thinking mode is detectable
  return false;
}
