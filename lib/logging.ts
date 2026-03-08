/**
 * oh-my-toong TypeScript Logging Module
 * Provides structured logging for TypeScript hooks and scripts
 *
 * Mirrors the behavior of hooks/lib/logging.sh
 */

import { mkdirSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

// Log level constants
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// State variables
let initialized = false;
let logFile = '';
let componentName = '';

/**
 * Parse log level from environment variable
 */
function getLogLevel(): LogLevel {
  const levelStr = process.env.OMT_LOG_LEVEL?.toUpperCase();
  switch (levelStr) {
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO; // Default to INFO
  }
}

/**
 * Check if a message at the given level should be logged
 */
function shouldLog(level: LogLevel): boolean {
  return level >= getLogLevel();
}

/**
 * Get level name from level enum
 */
function levelName(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG:
      return 'DEBUG';
    case LogLevel.INFO:
      return 'INFO';
    case LogLevel.WARN:
      return 'WARN';
    case LogLevel.ERROR:
      return 'ERROR';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Get current timestamp in ISO format
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Sanitize session ID for use in filename
 * Replaces non-alphanumeric characters with hyphens
 */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Core log function
 */
function log(level: LogLevel, message: string): void {
  // Check if initialized
  if (!initialized || !logFile) {
    return;
  }

  // Check if this level should be logged
  if (!shouldLog(level)) {
    return;
  }

  // Ensure directory exists
  const logDir = dirname(logFile);
  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Format and write log entry
    const ts = timestamp();
    const lvl = levelName(level);
    const entry = `[${ts}] [${lvl}] [${componentName}] ${message}\n`;

    appendFileSync(logFile, entry, 'utf-8');
  } catch {
    // Silent fail on disk errors
  }
}

/**
 * Initialize logging for a component
 *
 * @param component - Name of the component (used in log messages and filename)
 * @param projectRoot - Project root directory (where .omt/logs will be created)
 * @param sessionId - Optional session ID (defaults to 'default')
 */
export function initLogger(component: string, projectRoot: string, sessionId?: string): void {
  // Skip logging silently if projectRoot is missing
  if (!projectRoot) {
    initialized = false;
    return;
  }

  componentName = component;
  const sanitizedSession = sanitizeSessionId(sessionId || 'default');

  // Set log file path: .omt/logs/{component}-{sessionId}.log
  const logDir = join(projectRoot, '.omt', 'logs');
  logFile = join(logDir, `${component}-${sanitizedSession}.log`);

  initialized = true;
}

/**
 * Log at DEBUG level
 */
export function logDebug(message: string): void {
  log(LogLevel.DEBUG, message);
}

/**
 * Log at INFO level
 */
export function logInfo(message: string): void {
  log(LogLevel.INFO, message);
}

/**
 * Log at WARN level
 */
export function logWarn(message: string): void {
  log(LogLevel.WARN, message);
}

/**
 * Log at ERROR level
 */
export function logError(message: string): void {
  log(LogLevel.ERROR, message);
}

/**
 * Log start marker
 */
export function logStart(): void {
  logInfo('========== START ==========');
}

/**
 * Log end marker
 */
export function logEnd(): void {
  logInfo('========== END ==========');
}
