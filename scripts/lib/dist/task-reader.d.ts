/**
 * Task Reader Module
 * Reads Claude Code task files from ~/.claude/tasks/{session_id}/
 */
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
export declare function readTasksFromDirectory(directoryPath: string): Promise<Task[]>;
/**
 * Counts incomplete tasks (pending or in_progress)
 * @param tasks - Array of Task objects
 * @returns Number of incomplete tasks
 */
export declare function countIncompleteTasks(tasks: Task[]): number;
/**
 * Gets the first in_progress task
 * @param tasks - Array of Task objects
 * @returns First in_progress task or null if none found
 */
export declare function getInProgressTask(tasks: Task[]): Task | null;
