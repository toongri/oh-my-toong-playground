import { jest, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initCache, getCached, setCache } from './cache.ts';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'hud-cache-test-'));
  initCache(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  jest.useRealTimers();
});

describe('initCache', () => {
  it('accepts custom cache directory path', () => {
    const customDir = mkdtempSync(join(tmpdir(), 'hud-cache-custom-'));
    try {
      initCache(customDir);
      setCache('init-test', 'value', 60000);
      expect(existsSync(join(customDir, 'hud-usage.json'))).toBe(true);
    } finally {
      rmSync(customDir, { recursive: true, force: true });
    }
  });
});

describe('getCached', () => {
  it('returns null for non-existent key', () => {
    const result = getCached<string>('non-existent-key');
    expect(result).toBeNull();
  });

  it('returns null when cache file does not exist', () => {
    const result = getCached<string>('anything');
    expect(result).toBeNull();
  });
});

describe('setCache and getCached', () => {
  it('stores and retrieves data with file persistence', () => {
    setCache('test-key', 'test-value', 60000);
    const result = getCached<string>('test-key');
    expect(result).toBe('test-value');

    // Verify file actually exists on disk
    const cachePath = join(tempDir, 'hud-usage.json');
    expect(existsSync(cachePath)).toBe(true);

    const raw = JSON.parse(readFileSync(cachePath, 'utf8'));
    expect(raw['test-key'].data).toBe('test-value');
    expect(typeof raw['test-key'].expiresAt).toBe('number');
  });

  it('stores complex objects', () => {
    const data = { fiveHour: { percent: 50, resetIn: '2h30m' }, sevenDay: null };
    setCache('complex', data, 60000);
    const result = getCached<typeof data>('complex');
    expect(result).toEqual(data);
  });

  it('overwrites existing key', () => {
    setCache('key', 'first', 60000);
    setCache('key', 'second', 60000);
    expect(getCached<string>('key')).toBe('second');
  });

  it('supports multiple keys in same file', () => {
    setCache('a', 1, 60000);
    setCache('b', 2, 60000);
    expect(getCached<number>('a')).toBe(1);
    expect(getCached<number>('b')).toBe(2);
  });
});

describe('TTL expiration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('returns null after TTL expires', () => {
    setCache('expiring-key', 'value', 1000);

    // Before expiration
    expect(getCached<string>('expiring-key')).toBe('value');

    // Advance time past TTL
    jest.advanceTimersByTime(1001);

    // After expiration
    expect(getCached<string>('expiring-key')).toBeNull();
  });

  it('removes expired entry from file on read', () => {
    setCache('expires', 'val', 500);
    jest.advanceTimersByTime(501);

    getCached<string>('expires');

    const raw = JSON.parse(readFileSync(join(tempDir, 'hud-usage.json'), 'utf8'));
    expect(raw['expires']).toBeUndefined();
  });
});

describe('corrupt cache handling', () => {
  it('returns null for corrupt JSON and deletes file', () => {
    const cachePath = join(tempDir, 'hud-usage.json');
    writeFileSync(cachePath, '{invalid json!!!', 'utf8');

    const result = getCached<string>('any-key');
    expect(result).toBeNull();
    expect(existsSync(cachePath)).toBe(false);
  });

  it('returns null for non-object JSON', () => {
    const cachePath = join(tempDir, 'hud-usage.json');
    writeFileSync(cachePath, '"just a string"', 'utf8');

    const result = getCached<string>('any-key');
    expect(result).toBeNull();
    expect(existsSync(cachePath)).toBe(false);
  });

  it('returns null for array JSON', () => {
    const cachePath = join(tempDir, 'hud-usage.json');
    writeFileSync(cachePath, '[1,2,3]', 'utf8');

    const result = getCached<string>('any-key');
    expect(result).toBeNull();
    expect(existsSync(cachePath)).toBe(false);
  });
});

describe('missing cache directory', () => {
  it('creates cache directory on first write', () => {
    const nestedDir = join(tempDir, 'nested', 'deep', 'cache');
    initCache(nestedDir);

    setCache('first-write', 'data', 60000);

    expect(existsSync(nestedDir)).toBe(true);
    expect(getCached<string>('first-write')).toBe('data');
  });
});

describe('atomic write', () => {
  it('writes via temp file (no partial writes on read)', () => {
    // Write data and verify it's readable and valid JSON
    setCache('atomic-key', 'atomic-value', 60000);

    const cachePath = join(tempDir, 'hud-usage.json');
    const raw = readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed['atomic-key'].data).toBe('atomic-value');
  });

  it('concurrent setCache calls do not corrupt file', () => {
    // Simulate rapid sequential writes (sync operations, so they serialize)
    for (let i = 0; i < 20; i++) {
      setCache(`key-${i}`, `value-${i}`, 60000);
    }

    // All keys should be readable
    for (let i = 0; i < 20; i++) {
      expect(getCached<string>(`key-${i}`)).toBe(`value-${i}`);
    }

    // File should be valid JSON
    const cachePath = join(tempDir, 'hud-usage.json');
    const raw = readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed)).toHaveLength(20);
  });
});
