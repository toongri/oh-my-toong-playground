/**
 * Task Reader Module
 * Reads Claude Code task files from ~/.claude/tasks/{session_id}/
 */
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
/**
 * Reads task JSON files from the specified directory
 * @param directoryPath - The path to the tasks directory
 * @returns Array of Task objects
 */
export async function readTasksFromDirectory(directoryPath) {
    let files;
    try {
        files = await readdir(directoryPath);
    }
    catch {
        // Directory not found - return empty array
        return [];
    }
    const tasks = [];
    for (const file of files) {
        if (!file.endsWith('.json'))
            continue;
        const filePath = join(directoryPath, file);
        try {
            const content = await readFile(filePath, 'utf-8');
            const task = JSON.parse(content);
            tasks.push(task);
        }
        catch {
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
export function countIncompleteTasks(tasks) {
    return tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress').length;
}
/**
 * Gets the first in_progress task
 * @param tasks - Array of Task objects
 * @returns First in_progress task or null if none found
 */
export function getInProgressTask(tasks) {
    return tasks.find((task) => task.status === 'in_progress') ?? null;
}
