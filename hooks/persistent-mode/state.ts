import { RalphState } from './types.ts';
import { readFileOrNull, writeFileSafe, deleteFile, ensureDir } from './utils.ts';
import { join } from 'path';
import { getOmtDir } from '@lib/omt-dir';

const MAX_BLOCK_COUNT = 5;

export function readRalphState(sessionId: string): RalphState | null {
  const path = join(getOmtDir(), `ralph-state-${sessionId}.json`);
  const content = readFileOrNull(path);
  if (!content) return null;

  try {
    const state = JSON.parse(content) as RalphState;
    return state.active ? state : null;
  } catch {
    return null;
  }
}

export function updateRalphState(sessionId: string, state: RalphState): void {
  const path = join(getOmtDir(), `ralph-state-${sessionId}.json`);
  writeFileSafe(path, JSON.stringify(state, null, 2));
}

export function cleanupRalphState(sessionId: string): void {
  deleteFile(join(getOmtDir(), `ralph-state-${sessionId}.json`));
}

// Block counting for stuck agent escape hatch
export function getBlockCount(stateDir: string, attemptId: string): number {
  const content = readFileOrNull(`${stateDir}/block-count-${attemptId}`);
  return content ? parseInt(content, 10) || 0 : 0;
}

export function incrementBlockCount(stateDir: string, attemptId: string): void {
  const current = getBlockCount(stateDir, attemptId);
  ensureDir(stateDir);
  writeFileSafe(`${stateDir}/block-count-${attemptId}`, String(current + 1));
}

export function cleanupBlockCountFiles(stateDir: string, attemptId: string): void {
  deleteFile(`${stateDir}/block-count-${attemptId}`);
}

export { MAX_BLOCK_COUNT };
