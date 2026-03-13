import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  };
}

export const KEYCHAIN_BACKOFF_MS = 60_000;

let config = {
  backoffFile: join(homedir(), '.omt', 'cache', 'keychain-backoff'),
  backoffDir: join(homedir(), '.omt', 'cache'),
  credentialsPath: join(homedir(), '.claude', '.credentials.json'),
};

export function initCredentials(overrides: Partial<typeof config>): void {
  Object.assign(config, overrides);
}

export function isMissingKeychainItemError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException & { code?: number }).code;
  if (code === 44) return true;
  return error.message.includes('could not be found in the keychain');
}

export function isKeychainBackoff(): boolean {
  try {
    if (!existsSync(config.backoffFile)) return false;
    const ts = Number(readFileSync(config.backoffFile, 'utf8').trim());
    if (isNaN(ts)) return false;
    return Date.now() - ts < KEYCHAIN_BACKOFF_MS;
  } catch {
    return false;
  }
}

export function recordKeychainBackoff(): void {
  try {
    mkdirSync(config.backoffDir, { recursive: true });
    writeFileSync(config.backoffFile, String(Date.now()));
  } catch {
    // Best-effort — ignore write failures
  }
}

export async function getTokenFromFile(): Promise<string | null> {
  try {
    const content = await readFile(config.credentialsPath, 'utf8');
    const creds = JSON.parse(content) as ClaudeCredentials;
    if (creds.claudeAiOauth?.accessToken) {
      return creds.claudeAiOauth.accessToken;
    }
  } catch {
    // File not found or invalid
  }
  return null;
}

export async function readKeychainCredentials(): Promise<string> {
  const { exec } = await import('child_process');
  const execAsync = promisify(exec);
  const { stdout } = await execAsync(
    'security find-generic-password -s "Claude Code-credentials" -w',
    { timeout: 5000 }
  );
  return stdout;
}

export async function getOAuthToken(): Promise<string | null> {
  // Check backoff first — skip keychain if we recently failed
  if (isKeychainBackoff()) {
    return getTokenFromFile();
  }

  // Try macOS Keychain
  try {
    const stdout = await readKeychainCredentials();
    const creds = JSON.parse(stdout.trim()) as ClaudeCredentials;
    if (creds.claudeAiOauth?.accessToken) {
      return creds.claudeAiOauth.accessToken;
    }
  } catch (error) {
    if (!isMissingKeychainItemError(error)) {
      recordKeychainBackoff();
    }
  }

  // Fallback to file
  return getTokenFromFile();
}
