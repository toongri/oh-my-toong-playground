const BASH_ERROR_PATTERNS: RegExp[] = [
  /error:/i,
  /failed/i,
  /cannot/i,
  /permission denied/i,
  /command not found/i,
  /no such file/i,
  /exit code: [1-9]/i,
  /exit status [1-9]/i,
  /fatal:/i,
  /abort/i,
];

const WRITE_ERROR_PATTERNS: RegExp[] = [
  /error/i,
  /failed/i,
  /permission denied/i,
  /read-only/i,
  /not found/i,
];

export function detectBashFailure(output: string): boolean {
  return BASH_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}

export function detectWriteFailure(output: string): boolean {
  return WRITE_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}
