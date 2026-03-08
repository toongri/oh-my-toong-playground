import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  };
}

export async function getOAuthToken(): Promise<string | null> {
  // Try macOS Keychain first
  try {
    const { stdout } = await execAsync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { timeout: 5000 }
    );
    const creds = JSON.parse(stdout.trim()) as ClaudeCredentials;
    if (creds.claudeAiOauth?.accessToken) {
      return creds.claudeAiOauth.accessToken;
    }
  } catch {
    // Keychain access failed, try file fallback
  }

  // Fallback: ~/.claude/.credentials.json
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    const content = await readFile(credPath, 'utf8');
    const creds = JSON.parse(content) as ClaudeCredentials;
    if (creds.claudeAiOauth?.accessToken) {
      return creds.claudeAiOauth.accessToken;
    }
  } catch {
    // File not found or invalid
  }

  return null;
}
