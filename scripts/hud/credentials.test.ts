import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as credentialsMod from './credentials.ts';
import {
  getOAuthToken,
  isKeychainBackoff,
  recordKeychainBackoff,
  isMissingKeychainItemError,
  getTokenFromFile,
  KEYCHAIN_BACKOFF_MS,
  initCredentials,
} from './credentials.ts';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'credentials-test-'));
  initCredentials({
    backoffFile: join(tempDir, 'keychain-backoff'),
    backoffDir: tempDir,
    credentialsPath: join(tempDir, '.credentials.json'),
  });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const VALID_CREDS = JSON.stringify({
  claudeAiOauth: { accessToken: 'test-token-123' },
});

const MISSING_ITEM_ERROR = Object.assign(new Error('The specified item could not be found in the keychain.'), {
  code: 44,
});

const PERMISSION_ERROR = Object.assign(new Error('User interaction is not allowed.'), {
  code: 36,
});

describe('KEYCHAIN_BACKOFF_MS', () => {
  it('is 60000', () => {
    expect(KEYCHAIN_BACKOFF_MS).toBe(60_000);
  });
});

describe('isMissingKeychainItemError', () => {
  it('returns true for status-44 error', () => {
    expect(isMissingKeychainItemError(MISSING_ITEM_ERROR)).toBe(true);
  });

  it('returns true for error message containing "could not be found in the keychain"', () => {
    const err = new Error('The specified item could not be found in the keychain.');
    expect(isMissingKeychainItemError(err)).toBe(true);
  });

  it('returns false for permission error', () => {
    expect(isMissingKeychainItemError(PERMISSION_ERROR)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isMissingKeychainItemError('some string')).toBe(false);
    expect(isMissingKeychainItemError(null)).toBe(false);
  });
});

describe('isKeychainBackoff', () => {
  it('returns false when backoff file does not exist', () => {
    expect(isKeychainBackoff()).toBe(false);
  });

  it('returns true when backoff was recorded within 60 seconds', () => {
    const recentTimestamp = String(Date.now() - 30_000);
    writeFileSync(join(tempDir, 'keychain-backoff'), recentTimestamp);
    expect(isKeychainBackoff()).toBe(true);
  });

  it('returns false when backoff was recorded more than 60 seconds ago', () => {
    const oldTimestamp = String(Date.now() - 61_000);
    writeFileSync(join(tempDir, 'keychain-backoff'), oldTimestamp);
    expect(isKeychainBackoff()).toBe(false);
  });

  it('returns false when backoff file contains invalid content', () => {
    writeFileSync(join(tempDir, 'keychain-backoff'), 'not-a-number');
    expect(isKeychainBackoff()).toBe(false);
  });
});

describe('recordKeychainBackoff', () => {
  it('writes current timestamp to the backoff file', () => {
    const before = Date.now();
    recordKeychainBackoff();
    const after = Date.now();

    const backoffFile = join(tempDir, 'keychain-backoff');
    const ts = Number(readFileSync(backoffFile, 'utf8').trim());
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('creates the cache directory before writing', () => {
    const nestedDir = join(tempDir, 'nested', 'backoff-dir');
    initCredentials({
      backoffDir: nestedDir,
      backoffFile: join(nestedDir, 'keychain-backoff'),
    });
    recordKeychainBackoff();
    expect(existsSync(nestedDir)).toBe(true);
  });
});

describe('getTokenFromFile', () => {
  it('returns access token when credentials file contains valid token', async () => {
    writeFileSync(join(tempDir, '.credentials.json'), VALID_CREDS);
    const result = await getTokenFromFile();
    expect(result).toBe('test-token-123');
  });

  it('returns null when credentials file does not exist', async () => {
    const result = await getTokenFromFile();
    expect(result).toBeNull();
  });

  it('returns null when credentials file has no accessToken', async () => {
    writeFileSync(join(tempDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: {} }));
    const result = await getTokenFromFile();
    expect(result).toBeNull();
  });
});

describe('getOAuthToken', () => {
  it('keychain succeeds — returns token without recording backoff', async () => {
    const spy = spyOn(credentialsMod, 'readKeychainCredentials').mockResolvedValue(VALID_CREDS);
    try {
      const result = await getOAuthToken();
      expect(result).toBe('test-token-123');
      expect(existsSync(join(tempDir, 'keychain-backoff'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('keychain missing-item error — no backoff recorded, falls through to file', async () => {
    const spy = spyOn(credentialsMod, 'readKeychainCredentials').mockRejectedValue(MISSING_ITEM_ERROR);
    writeFileSync(join(tempDir, '.credentials.json'), VALID_CREDS);
    try {
      const result = await getOAuthToken();
      expect(result).toBe('test-token-123');
      expect(existsSync(join(tempDir, 'keychain-backoff'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('keychain other error — backoff recorded, falls through to file', async () => {
    const spy = spyOn(credentialsMod, 'readKeychainCredentials').mockRejectedValue(PERMISSION_ERROR);
    writeFileSync(join(tempDir, '.credentials.json'), VALID_CREDS);
    try {
      const result = await getOAuthToken();
      expect(result).toBe('test-token-123');
      expect(existsSync(join(tempDir, 'keychain-backoff'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('during backoff — skips keychain, reads from file directly', async () => {
    const recentTimestamp = String(Date.now() - 10_000);
    writeFileSync(join(tempDir, 'keychain-backoff'), recentTimestamp);
    writeFileSync(join(tempDir, '.credentials.json'), VALID_CREDS);

    const spy = spyOn(credentialsMod, 'readKeychainCredentials');
    try {
      const result = await getOAuthToken();
      expect(result).toBe('test-token-123');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('backoff expired — tries keychain again', async () => {
    const oldTimestamp = String(Date.now() - 61_000);
    writeFileSync(join(tempDir, 'keychain-backoff'), oldTimestamp);

    const spy = spyOn(credentialsMod, 'readKeychainCredentials').mockResolvedValue(VALID_CREDS);
    try {
      const result = await getOAuthToken();
      expect(result).toBe('test-token-123');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('file fallback succeeds when keychain returns no token', async () => {
    const spy = spyOn(credentialsMod, 'readKeychainCredentials').mockResolvedValue(
      JSON.stringify({ claudeAiOauth: {} })
    );
    writeFileSync(join(tempDir, '.credentials.json'), VALID_CREDS);
    try {
      const result = await getOAuthToken();
      expect(result).toBe('test-token-123');
    } finally {
      spy.mockRestore();
    }
  });

  it('both keychain and file fail — returns null', async () => {
    const spy = spyOn(credentialsMod, 'readKeychainCredentials').mockRejectedValue(MISSING_ITEM_ERROR);
    try {
      const result = await getOAuthToken();
      expect(result).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
