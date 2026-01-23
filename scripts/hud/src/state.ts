import { readFile, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { RalphState, UltraworkState, RalphVerification, TodosState, TodoItem } from './types.js';

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
 * Extract todos from content that could be either:
 * - Direct array: TodoItem[]
 * - Wrapper object: { todos: TodoItem[] }
 *
 * This handles the schema mismatch between HUD's expected format
 * and Claude Code TaskCreate's direct array format.
 */
function extractTodos(content: unknown): TodoItem[] {
  if (Array.isArray(content)) {
    return content as TodoItem[];
  }
  if (content && typeof content === 'object' && 'todos' in content) {
    const wrapper = content as TodosState;
    return wrapper.todos || [];
  }
  return [];
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

export async function readRalphState(cwd: string): Promise<RalphState | null> {
  return findStateFile<RalphState>(cwd, 'ralph-state.json');
}

export async function readUltraworkState(cwd: string): Promise<UltraworkState | null> {
  return findStateFile<UltraworkState>(cwd, 'ultrawork-state.json');
}

export async function readRalphVerification(cwd: string): Promise<RalphVerification | null> {
  const verification = await findStateFile<RalphVerification>(cwd, 'ralph-verification.json');

  // Check if stale (>24h)
  if (verification?.created_at) {
    const createdAt = new Date(verification.created_at).getTime();
    const now = Date.now();
    const hours24 = 24 * 60 * 60 * 1000;
    if (now - createdAt > hours24) {
      return null; // Treat as inactive
    }
  }

  return verification;
}

export async function readTodos(cwd: string): Promise<{ completed: number; total: number } | null> {
  const allTodos: TodoItem[] = [];

  // Priority 1: Project-local sisyphus todos
  const sisyphusPath = join(cwd, '.claude', 'sisyphus', 'todos.json');
  const sisyphusContent = await readJsonFile<TodosState | TodoItem[]>(sisyphusPath);
  allTodos.push(...extractTodos(sisyphusContent));

  // Priority 2: Project-local claude todos
  const localPath = join(cwd, '.claude', 'todos.json');
  const localContent = await readJsonFile<TodosState | TodoItem[]>(localPath);
  allTodos.push(...extractTodos(localContent));

  // Priority 3: Global todos directory
  const globalTodosDir = join(homedir(), '.claude', 'todos');
  try {
    const files = await readdir(globalTodosDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const fileContent = await readJsonFile<TodosState | TodoItem[]>(join(globalTodosDir, file));
        allTodos.push(...extractTodos(fileContent));
      }
    }
  } catch {
    // Directory doesn't exist, skip
  }

  if (allTodos.length === 0) return null;

  const completed = allTodos.filter(t => t.status === 'completed').length;
  return { completed, total: allTodos.length };
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

// Get the in-progress todo's activeForm (truncated)
export async function getInProgressTodo(cwd: string): Promise<string | null> {
  // Reuse existing readTodos logic but look for in_progress status
  const allTodos: Array<{ content: string; status: string; activeForm?: string }> = [];

  // Read from same locations as readTodos
  const sisyphusPath = join(cwd, '.claude', 'sisyphus', 'todos.json');
  const sisyphusContent = await readJsonFile<TodosState | TodoItem[]>(sisyphusPath);
  allTodos.push(...extractTodos(sisyphusContent));

  const localPath = join(cwd, '.claude', 'todos.json');
  const localContent = await readJsonFile<TodosState | TodoItem[]>(localPath);
  allTodos.push(...extractTodos(localContent));

  // Find first in_progress todo
  const inProgress = allTodos.find(t => t.status === 'in_progress');
  if (!inProgress) return null;

  // Return activeForm or content (prefer activeForm)
  const text = inProgress.activeForm || inProgress.content;
  // Truncate to 25 chars
  return text.length > 25 ? text.substring(0, 25) + '...' : text;
}

// Check if extended thinking is enabled (from stdin model or settings)
export async function isThinkingEnabled(): Promise<boolean> {
  // For now, return false as thinking detection requires runtime data
  // This can be enhanced later when thinking mode is detectable
  return false;
}
