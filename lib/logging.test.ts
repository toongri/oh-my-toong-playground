import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdir, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  initLogger,
  logDebug,
  logInfo,
  logWarn,
  logError,
  logStart,
  logEnd,
  LogLevel,
} from './logging.ts';

describe('logging module', () => {
  const testDir = join(tmpdir(), 'logging-test-' + Date.now());
  const originalEnv = process.env.OMT_LOG_LEVEL;

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    // Restore original environment
    if (originalEnv !== undefined) {
      process.env.OMT_LOG_LEVEL = originalEnv;
    } else {
      delete process.env.OMT_LOG_LEVEL;
    }
  });

  beforeEach(() => {
    // Reset log level to default before each test
    delete process.env.OMT_LOG_LEVEL;
  });

  describe('initLogger', () => {
    it('should create log directory and file path', () => {
      const projectRoot = join(testDir, 'project1');

      initLogger('test-component', projectRoot, 'session-123');

      // Directory should exist after first log
      logInfo('test message');
      const logDir = join(projectRoot, '.omt', 'logs');
      expect(existsSync(logDir)).toBe(true);
    });

    it('should use default when sessionId is not provided', async () => {
      const projectRoot = join(testDir, 'project2');

      initLogger('my-component', projectRoot);
      logInfo('test');

      const logPath = join(projectRoot, '.omt', 'logs', 'my-component-default.log');
      expect(existsSync(logPath)).toBe(true);
    });

    it('should sanitize sessionId with special characters', async () => {
      const projectRoot = join(testDir, 'project3');

      initLogger('comp', projectRoot, 'session/with:special*chars?');
      logInfo('test');

      const logPath = join(projectRoot, '.omt', 'logs', 'comp-session-with-special-chars-.log');
      expect(existsSync(logPath)).toBe(true);
    });

    it('should not log when projectRoot is missing', async () => {
      // @ts-expect-error - testing with undefined projectRoot
      initLogger('orphan', undefined);
      logInfo('should not be written');

      // Should not throw and should silently skip
      expect(true).toBe(true);
    });

    it('should not log when projectRoot is empty string', async () => {
      initLogger('orphan', '');
      logInfo('should not be written');

      // Should not throw and should silently skip
      expect(true).toBe(true);
    });
  });

  describe('log format', () => {
    it('should write logs in correct format: [timestamp] [LEVEL] [component] message', async () => {
      const projectRoot = join(testDir, 'format-test');

      initLogger('format-comp', projectRoot, 'fmt-session');
      logInfo('test message');

      const logPath = join(projectRoot, '.omt', 'logs', 'format-comp-fmt-session.log');
      const content = await readFile(logPath, 'utf-8');

      // Should match format: [2024-01-15T10:30:00.000Z] [INFO] [format-comp] test message
      expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[format-comp\] test message\n$/);
    });
  });

  describe('log levels', () => {
    it('should have correct log level values', () => {
      expect(LogLevel.DEBUG).toBe(0);
      expect(LogLevel.INFO).toBe(1);
      expect(LogLevel.WARN).toBe(2);
      expect(LogLevel.ERROR).toBe(3);
    });

    it('should default to INFO level', async () => {
      const projectRoot = join(testDir, 'level-default');

      initLogger('level-comp', projectRoot, 'level-session');
      logDebug('debug message');
      logInfo('info message');

      const logPath = join(projectRoot, '.omt', 'logs', 'level-comp-level-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).not.toContain('debug message');
      expect(content).toContain('info message');
    });

    it('should respect OMT_LOG_LEVEL environment variable', async () => {
      process.env.OMT_LOG_LEVEL = 'DEBUG';
      const projectRoot = join(testDir, 'level-env');

      initLogger('env-comp', projectRoot, 'env-session');
      logDebug('debug message');

      const logPath = join(projectRoot, '.omt', 'logs', 'env-comp-env-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).toContain('[DEBUG]');
      expect(content).toContain('debug message');
    });

    it('should filter messages below configured level', async () => {
      process.env.OMT_LOG_LEVEL = 'WARN';
      const projectRoot = join(testDir, 'level-filter');

      initLogger('filter-comp', projectRoot, 'filter-session');
      logDebug('debug');
      logInfo('info');
      logWarn('warn');
      logError('error');

      const logPath = join(projectRoot, '.omt', 'logs', 'filter-comp-filter-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).not.toContain('[DEBUG]');
      expect(content).not.toContain('[INFO]');
      expect(content).toContain('[WARN]');
      expect(content).toContain('[ERROR]');
    });
  });

  describe('log functions', () => {
    it('logDebug should write DEBUG level message', async () => {
      process.env.OMT_LOG_LEVEL = 'DEBUG';
      const projectRoot = join(testDir, 'log-debug');

      initLogger('debug-test', projectRoot, 'session');
      logDebug('debug message');

      const logPath = join(projectRoot, '.omt', 'logs', 'debug-test-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).toContain('[DEBUG]');
    });

    it('logInfo should write INFO level message', async () => {
      const projectRoot = join(testDir, 'log-info');

      initLogger('info-test', projectRoot, 'session');
      logInfo('info message');

      const logPath = join(projectRoot, '.omt', 'logs', 'info-test-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).toContain('[INFO]');
    });

    it('logWarn should write WARN level message', async () => {
      const projectRoot = join(testDir, 'log-warn');

      initLogger('warn-test', projectRoot, 'session');
      logWarn('warn message');

      const logPath = join(projectRoot, '.omt', 'logs', 'warn-test-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).toContain('[WARN]');
    });

    it('logError should write ERROR level message', async () => {
      const projectRoot = join(testDir, 'log-error');

      initLogger('error-test', projectRoot, 'session');
      logError('error message');

      const logPath = join(projectRoot, '.omt', 'logs', 'error-test-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).toContain('[ERROR]');
    });
  });

  describe('logStart and logEnd', () => {
    it('logStart should write START marker', async () => {
      const projectRoot = join(testDir, 'log-start');

      initLogger('start-test', projectRoot, 'session');
      logStart();

      const logPath = join(projectRoot, '.omt', 'logs', 'start-test-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).toContain('========== START ==========');
    });

    it('logEnd should write END marker', async () => {
      const projectRoot = join(testDir, 'log-end');

      initLogger('end-test', projectRoot, 'session');
      logEnd();

      const logPath = join(projectRoot, '.omt', 'logs', 'end-test-session.log');
      const content = await readFile(logPath, 'utf-8');

      expect(content).toContain('========== END ==========');
    });
  });

  describe('error handling', () => {
    it('should silently handle disk write errors', () => {
      // Use an invalid path that will cause write errors
      const invalidPath = '/nonexistent/path/that/should/fail';

      initLogger('error-comp', invalidPath, 'session');

      // Should not throw
      expect(() => logInfo('test')).not.toThrow();
    });
  });
});
