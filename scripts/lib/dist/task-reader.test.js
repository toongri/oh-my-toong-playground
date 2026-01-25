import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { jest } from '@jest/globals';
import { readTasksFromDirectory, countIncompleteTasks, getInProgressTask } from './task-reader.js';
describe('task-reader module', () => {
    const testDir = join(tmpdir(), 'task-reader-test-' + Date.now());
    beforeAll(async () => {
        await mkdir(testDir, { recursive: true });
    });
    afterAll(async () => {
        await rm(testDir, { recursive: true, force: true });
    });
    describe('readTasksFromDirectory', () => {
        it('should read task JSON files from directory', async () => {
            const sessionDir = join(testDir, 'session1');
            await mkdir(sessionDir, { recursive: true });
            const task = {
                id: 'task-1',
                subject: 'Test task',
                status: 'pending',
            };
            await writeFile(join(sessionDir, 'task-1.json'), JSON.stringify(task));
            const tasks = await readTasksFromDirectory(sessionDir);
            expect(tasks).toHaveLength(1);
            expect(tasks[0]).toEqual(task);
        });
        it('should return empty array when directory does not exist', async () => {
            const nonExistentDir = join(testDir, 'non-existent-session');
            const tasks = await readTasksFromDirectory(nonExistentDir);
            expect(tasks).toEqual([]);
        });
        it('should skip invalid JSON files and log warning', async () => {
            const sessionDir = join(testDir, 'session-invalid-json');
            await mkdir(sessionDir, { recursive: true });
            const validTask = {
                id: 'valid-1',
                subject: 'Valid task',
                status: 'pending',
            };
            await writeFile(join(sessionDir, 'valid.json'), JSON.stringify(validTask));
            await writeFile(join(sessionDir, 'invalid.json'), 'not valid json {{{');
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
            const tasks = await readTasksFromDirectory(sessionDir);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].id).toBe('valid-1');
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('invalid.json'));
            consoleErrorSpy.mockRestore();
        });
        it('should ignore .lock files', async () => {
            const sessionDir = join(testDir, 'session-lock');
            await mkdir(sessionDir, { recursive: true });
            const task = {
                id: 'task-1',
                subject: 'Test task',
                status: 'pending',
            };
            await writeFile(join(sessionDir, 'task-1.json'), JSON.stringify(task));
            await writeFile(join(sessionDir, '.lock'), 'lock content');
            const tasks = await readTasksFromDirectory(sessionDir);
            expect(tasks).toHaveLength(1);
            expect(tasks[0].id).toBe('task-1');
        });
    });
    describe('countIncompleteTasks', () => {
        it('should count pending and in_progress tasks', () => {
            const tasks = [
                { id: '1', subject: 'Pending', status: 'pending' },
                { id: '2', subject: 'In Progress', status: 'in_progress' },
                { id: '3', subject: 'Completed', status: 'completed' },
                { id: '4', subject: 'Another Pending', status: 'pending' },
            ];
            const count = countIncompleteTasks(tasks);
            expect(count).toBe(3);
        });
        it('should return 0 for empty array', () => {
            const count = countIncompleteTasks([]);
            expect(count).toBe(0);
        });
        it('should return 0 when all tasks are completed', () => {
            const tasks = [
                { id: '1', subject: 'Done', status: 'completed' },
                { id: '2', subject: 'Also Done', status: 'completed' },
            ];
            const count = countIncompleteTasks(tasks);
            expect(count).toBe(0);
        });
    });
    describe('getInProgressTask', () => {
        it('should return first in_progress task', () => {
            const tasks = [
                { id: '1', subject: 'Pending', status: 'pending' },
                { id: '2', subject: 'In Progress', status: 'in_progress' },
                { id: '3', subject: 'Another In Progress', status: 'in_progress' },
            ];
            const task = getInProgressTask(tasks);
            expect(task).not.toBeNull();
            expect(task?.id).toBe('2');
        });
        it('should return null when no in_progress task exists', () => {
            const tasks = [
                { id: '1', subject: 'Pending', status: 'pending' },
                { id: '2', subject: 'Completed', status: 'completed' },
            ];
            const task = getInProgressTask(tasks);
            expect(task).toBeNull();
        });
        it('should return null for empty array', () => {
            const task = getInProgressTask([]);
            expect(task).toBeNull();
        });
    });
});
