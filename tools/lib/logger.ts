/**
 * Colored terminal logging for the oh-my-toong sync tool.
 * All output goes to stderr; stdout is reserved for data output.
 */

const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

export function logInfo(msg: string): void {
  process.stderr.write(`${BLUE}[SYNC]${RESET} ${msg}\n`);
}

export function logSuccess(msg: string): void {
  process.stderr.write(`${GREEN}[SYNC]${RESET} ${msg}\n`);
}

export function logWarn(msg: string): void {
  process.stderr.write(`${YELLOW}[WARN]${RESET} ${msg}\n`);
}

export function logError(msg: string): void {
  process.stderr.write(`${RED}[ERROR]${RESET} ${msg}\n`);
}

export function logDry(msg: string): void {
  process.stderr.write(`${CYAN}[DRY]${RESET} ${msg}\n`);
}
