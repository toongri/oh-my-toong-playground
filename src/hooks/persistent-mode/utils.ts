import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname } from 'path';

export function getProjectRoot(directory: string): string {
  // Strip .omt suffix if present
  let dir = directory.replace(/\/.omt$/, '').replace(/\/.claude$/, '');

  // Look for project root markers
  while (dir !== '/' && dir !== '.' && dir) {
    if (existsSync(`${dir}/.git`) || existsSync(`${dir}/CLAUDE.md`) || existsSync(`${dir}/package.json`)) {
      return dir;
    }
    dir = dirname(dir);
  }

  // Fallback
  return directory.replace(/\/.omt$/, '');
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function writeFileSafe(path: string, content: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, content, 'utf8');
}

export function deleteFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Ignore if file doesn't exist
  }
}

export function generateAttemptId(sessionId: string, directory: string): string {
  if (sessionId && sessionId !== 'default') {
    return sessionId;
  }
  // Simple hash fallback
  let hash = 0;
  for (const char of directory) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 8);
}
