/**
 * Task Reader Module
 * Reads Claude Code task files from ~/.claude/tasks/{session_id}/
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

export interface Task {
  id: string;
  subject: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Reads task JSON files from the specified directory
 * @param directoryPath - The path to the tasks directory
 * @returns Array of Task objects
 */
export async function readTasksFromDirectory(directoryPath: string): Promise<Task[]> {
  let files: string[];
  try {
    files = await readdir(directoryPath);
  } catch {
    // Directory not found - return empty array
    return [];
  }

  const tasks: Task[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = join(directoryPath, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const task = JSON.parse(content) as Task;
      tasks.push(task);
    } catch {
      console.error(`Warning: Failed to parse task file: ${file}`);
    }
  }

  return tasks;
}

/**
 * Counts incomplete tasks (pending or in_progress)
 * @param tasks - Array of Task objects
 * @returns Number of incomplete tasks
 */
export function countIncompleteTasks(tasks: Task[]): number {
  return tasks.filter(
    (task) => task.status === 'pending' || task.status === 'in_progress'
  ).length;
}

/**
 * Gets the first in_progress task
 * @param tasks - Array of Task objects
 * @returns First in_progress task or null if none found
 */
export function getInProgressTask(tasks: Task[]): Task | null {
  return tasks.find((task) => task.status === 'in_progress') ?? null;
}
