import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';

// State containers for mocked behaviors — mutated per test via beforeEach
const state = {
  execBehavior: (
    _cmd: string,
    _opts: unknown,
    cb: (err: Error | null, result: { stdout: string; stderr: string }) => void
  ) => cb(null, { stdout: '{}', stderr: '' }),

  existsSyncBehavior: (_path: string) => false,
  readFileSyncBehavior: (_path: string, _enc: string) => '',
  writeFileSyncCalls: [] as Array<{ path: string; data: string }>,
  mkdirSyncCalls: [] as Array<{ path: string }>,

  readFileBehavior: (_path: string, _enc: string): Promise<string> => Promise.resolve('{}'),
};

// Stable mock functions that delegate to state — these references never change,
// so mock.module captures them permanently.
const stableExec = mock(
  (cmd: string, opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) =>
    state.execBehavior(cmd, opts, cb)
);

const stableExistsSync = mock((_path: string) => state.existsSyncBehavior(_path));
const stableReadFileSync = mock((_path: string, _enc: string) => state.readFileSyncBehavior(_path, _enc));
const stableWriteFileSync = mock((_path: string, data: string) => {
  state.writeFileSyncCalls.push({ path: _path, data });
});
const stableMkdirSync = mock((_path: string, _opts: unknown) => {
  state.mkdirSyncCalls.push({ path: _path });
});
const stableReadFile = mock((_path: string, _enc: string) => state.readFileBehavior(_path, _enc));

mock.module('child_process', () => ({ exec: stableExec }));
mock.module('fs', () => ({
  existsSync: stableExistsSync,
  readFileSync: stableReadFileSync,
  writeFileSync: stableWriteFileSync,
  mkdirSync: stableMkdirSync,
}));
mock.module('fs/promises', () => ({ readFile: stableReadFile }));

import {
  getOAuthToken,
  isKeychainBackoff,
  recordKeychainBackoff,
  isMissingKeychainItemError,
  getTokenFromFile,
  KEYCHAIN_BACKOFF_MS,
} from './credentials.ts';

const VALID_CREDS = JSON.stringify({
  claudeAiOauth: { accessToken: 'test-token-123' },
});

const MISSING_ITEM_ERROR = Object.assign(new Error('The specified item could not be found in the keychain.'), {
  code: 44,
});

const PERMISSION_ERROR = Object.assign(new Error('User interaction is not allowed.'), {
  code: 36,
});

function resetState() {
  state.execBehavior = (_cmd, _opts, cb) => cb(null, { stdout: '{}', stderr: '' });
  state.existsSyncBehavior = (_path) => false;
  state.readFileSyncBehavior = (_path, _enc) => '';
  state.writeFileSyncCalls = [];
  state.mkdirSyncCalls = [];
  state.readFileBehavior = (_path, _enc) => Promise.resolve('{}');
}

beforeEach(() => {
  resetState();
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
    state.existsSyncBehavior = (_path) => false;
    expect(isKeychainBackoff()).toBe(false);
  });

  it('returns true when backoff was recorded within 60 seconds', () => {
    const recentTimestamp = String(Date.now() - 30_000);
    state.existsSyncBehavior = (_path) => true;
    state.readFileSyncBehavior = (_path, _enc) => recentTimestamp;
    expect(isKeychainBackoff()).toBe(true);
  });

  it('returns false when backoff was recorded more than 60 seconds ago', () => {
    const oldTimestamp = String(Date.now() - 61_000);
    state.existsSyncBehavior = (_path) => true;
    state.readFileSyncBehavior = (_path, _enc) => oldTimestamp;
    expect(isKeychainBackoff()).toBe(false);
  });

  it('returns false when backoff file contains invalid content', () => {
    state.existsSyncBehavior = (_path) => true;
    state.readFileSyncBehavior = (_path, _enc) => 'not-a-number';
    expect(isKeychainBackoff()).toBe(false);
  });
});

describe('recordKeychainBackoff', () => {
  it('writes current timestamp to the backoff file', () => {
    const before = Date.now();
    recordKeychainBackoff();
    const after = Date.now();

    expect(state.writeFileSyncCalls.length).toBe(1);
    const ts = Number(state.writeFileSyncCalls[0].data);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('creates the cache directory before writing', () => {
    recordKeychainBackoff();
    expect(state.mkdirSyncCalls.length).toBeGreaterThan(0);
  });
});

describe('getTokenFromFile', () => {
  it('returns access token when credentials file contains valid token', async () => {
    state.readFileBehavior = (_path, _enc) => Promise.resolve(VALID_CREDS);
    const result = await getTokenFromFile();
    expect(result).toBe('test-token-123');
  });

  it('returns null when credentials file does not exist', async () => {
    state.readFileBehavior = (_path, _enc) => Promise.reject(new Error('ENOENT'));
    const result = await getTokenFromFile();
    expect(result).toBeNull();
  });

  it('returns null when credentials file has no accessToken', async () => {
    state.readFileBehavior = (_path, _enc) =>
      Promise.resolve(JSON.stringify({ claudeAiOauth: {} }));
    const result = await getTokenFromFile();
    expect(result).toBeNull();
  });
});

describe('getOAuthToken', () => {
  it('keychain succeeds — returns token without recording backoff', async () => {
    state.existsSyncBehavior = (_path) => false;
    state.execBehavior = (_cmd, _opts, cb) => cb(null, { stdout: VALID_CREDS, stderr: '' });

    const result = await getOAuthToken();
    expect(result).toBe('test-token-123');
    expect(state.writeFileSyncCalls.length).toBe(0);
  });

  it('keychain missing-item error — no backoff recorded, falls through to file', async () => {
    state.existsSyncBehavior = (_path) => false;
    state.execBehavior = (_cmd, _opts, cb) => cb(MISSING_ITEM_ERROR, { stdout: '', stderr: '' });
    state.readFileBehavior = (_path, _enc) => Promise.resolve(VALID_CREDS);

    const result = await getOAuthToken();
    expect(result).toBe('test-token-123');
    expect(state.writeFileSyncCalls.length).toBe(0);
  });

  it('keychain other error — backoff recorded, falls through to file', async () => {
    state.existsSyncBehavior = (_path) => false;
    state.execBehavior = (_cmd, _opts, cb) => cb(PERMISSION_ERROR, { stdout: '', stderr: '' });
    state.readFileBehavior = (_path, _enc) => Promise.resolve(VALID_CREDS);

    const result = await getOAuthToken();
    expect(result).toBe('test-token-123');
    expect(state.writeFileSyncCalls.length).toBe(1);
  });

  it('during backoff — skips keychain, reads from file directly', async () => {
    const recentTimestamp = String(Date.now() - 10_000);
    state.existsSyncBehavior = (_path) => true;
    state.readFileSyncBehavior = (_path, _enc) => recentTimestamp;
    state.readFileBehavior = (_path, _enc) => Promise.resolve(VALID_CREDS);

    let execCalled = false;
    state.execBehavior = (_cmd, _opts, cb) => {
      execCalled = true;
      cb(null, { stdout: VALID_CREDS, stderr: '' });
    };

    const result = await getOAuthToken();
    expect(result).toBe('test-token-123');
    expect(execCalled).toBe(false);
  });

  it('backoff expired — tries keychain again', async () => {
    const oldTimestamp = String(Date.now() - 61_000);
    state.existsSyncBehavior = (_path) => true;
    state.readFileSyncBehavior = (_path, _enc) => oldTimestamp;

    let execCalled = false;
    state.execBehavior = (_cmd, _opts, cb) => {
      execCalled = true;
      cb(null, { stdout: VALID_CREDS, stderr: '' });
    };

    const result = await getOAuthToken();
    expect(result).toBe('test-token-123');
    expect(execCalled).toBe(true);
  });

  it('file fallback succeeds when keychain returns no token', async () => {
    state.existsSyncBehavior = (_path) => false;
    state.execBehavior = (_cmd, _opts, cb) =>
      cb(null, { stdout: JSON.stringify({ claudeAiOauth: {} }), stderr: '' });
    state.readFileBehavior = (_path, _enc) => Promise.resolve(VALID_CREDS);

    const result = await getOAuthToken();
    expect(result).toBe('test-token-123');
  });

  it('both keychain and file fail — returns null', async () => {
    state.existsSyncBehavior = (_path) => false;
    state.execBehavior = (_cmd, _opts, cb) => cb(MISSING_ITEM_ERROR, { stdout: '', stderr: '' });
    state.readFileBehavior = (_path, _enc) => Promise.reject(new Error('ENOENT'));

    const result = await getOAuthToken();
    expect(result).toBeNull();
  });
});
