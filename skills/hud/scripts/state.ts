import { readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { readTasksFromDirectory, countIncompleteTasks, getInProgressTask } from '@lib/task-reader';

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

/**
 * Read task stats from the task directory
 * @param sessionId - The session ID
 * @returns Object with completed and total counts, or null if no tasks
 */
export async function readTasks(sessionId: string): Promise<{ completed: number; total: number } | null> {
  const tasksDir = join(homedir(), '.claude', 'tasks', sessionId);
  const tasks = await readTasksFromDirectory(tasksDir);

  if (tasks.length === 0) {
    return null;
  }

  const incomplete = countIncompleteTasks(tasks);
  return {
    completed: tasks.length - incomplete,
    total: tasks.length
  };
}

/**
 * Get the activeForm of the first in-progress task
 * @param sessionId - The session ID
 * @returns The activeForm string (truncated to 25 chars) or null
 */
export async function getActiveTaskForm(sessionId: string): Promise<string | null> {
  const tasksDir = join(homedir(), '.claude', 'tasks', sessionId);
  const tasks = await readTasksFromDirectory(tasksDir);
  const inProgressTask = getInProgressTask(tasks);

  if (!inProgressTask || !inProgressTask.activeForm) {
    return null;
  }

  const form = inProgressTask.activeForm;
  if (form.length > 25) {
    return form.slice(0, 25) + '...';
  }
  return form;
}
