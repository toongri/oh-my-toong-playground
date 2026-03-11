import { jest, describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as credentialsMod from './credentials.ts';
import * as cacheMod from './cache.ts';
import { formatResetTime, fetchRateLimits, acquireLock, releaseLock } from './usage-api.ts';

describe('formatResetTime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns empty string for null input', () => {
    const result = formatResetTime(null);
    expect(result).toBe('');
  });

  it('returns "0m" for past time', () => {
    const now = new Date('2024-01-15T10:00:00Z');
    jest.setSystemTime(now);

    const pastTime = '2024-01-15T09:00:00Z';
    const result = formatResetTime(pastTime);
    expect(result).toBe('0m');
  });

  it('formats minutes only', () => {
    const now = new Date('2024-01-15T10:00:00Z');
    jest.setSystemTime(now);

    const futureTime = '2024-01-15T10:45:00Z';
    const result = formatResetTime(futureTime);
    expect(result).toBe('45m');
  });

  it('formats hours and minutes', () => {
    const now = new Date('2024-01-15T10:00:00Z');
    jest.setSystemTime(now);

    const futureTime = '2024-01-15T12:30:00Z';
    const result = formatResetTime(futureTime);
    expect(result).toBe('2h30m');
  });

  it('formats hours only when no minutes', () => {
    const now = new Date('2024-01-15T10:00:00Z');
    jest.setSystemTime(now);

    const futureTime = '2024-01-15T13:00:00Z';
    const result = formatResetTime(futureTime);
    expect(result).toBe('3h');
  });

  it('formats days and hours', () => {
    const now = new Date('2024-01-15T10:00:00Z');
    jest.setSystemTime(now);

    const futureTime = '2024-01-17T15:00:00Z';
    const result = formatResetTime(futureTime);
    expect(result).toBe('2d5h');
  });

  it('formats days only when no hours', () => {
    const now = new Date('2024-01-15T10:00:00Z');
    jest.setSystemTime(now);

    const futureTime = '2024-01-18T10:00:00Z';
    const result = formatResetTime(futureTime);
    expect(result).toBe('3d');
  });
});

describe('acquireLock', () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hud-lock-test-'));
    lockPath = join(tempDir, 'test.lock');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns "acquired" when lock file does not exist', () => {
    const result = acquireLock(lockPath);
    expect(result).toBe('acquired');
    expect(existsSync(lockPath)).toBe(true);
  });

  it('returns "busy" when lock file already exists', () => {
    writeFileSync(lockPath, String(Date.now()), 'utf8');
    const result = acquireLock(lockPath);
    expect(result).toBe('busy');
  });

  it('returns "acquired" and removes stale lock older than 30 seconds', () => {
    const staleTimestamp = Date.now() - 31_000;
    writeFileSync(lockPath, String(staleTimestamp), 'utf8');

    const result = acquireLock(lockPath);
    expect(result).toBe('acquired');
    expect(existsSync(lockPath)).toBe(true);
  });

  it('returns "busy" for fresh lock less than 30 seconds old', () => {
    const freshTimestamp = Date.now() - 5_000;
    writeFileSync(lockPath, String(freshTimestamp), 'utf8');

    const result = acquireLock(lockPath);
    expect(result).toBe('busy');
  });

  it('캐시 디렉토리가 없다가 mkdirSync 후 lock 획득 가능 (P1: ENOENT)', () => {
    // Simulate fresh install: cache dir does not exist yet
    const missingDir = join(tempDir, 'nonexistent');
    const lockInMissing = join(missingDir, 'test.lock');

    // Before mkdir: acquireLock fails (ENOENT → busy)
    expect(acquireLock(lockInMissing)).toBe('busy');

    // After mkdirSync (as fetchRateLimits now does): acquireLock succeeds
    mkdirSync(missingDir, { recursive: true });
    const result = acquireLock(lockInMissing);
    expect(result).toBe('acquired');
    expect(existsSync(lockInMissing)).toBe(true);
  });

  it('NaN 타임스탬프 lock 파일을 stale로 판정하여 acquired 반환 (P2: corrupt lock)', () => {
    writeFileSync(lockPath, 'not-a-number', 'utf8');

    const result = acquireLock(lockPath);
    expect(result).toBe('acquired');
    expect(existsSync(lockPath)).toBe(true);
  });
});

describe('releaseLock', () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hud-lock-test-'));
    lockPath = join(tempDir, 'test.lock');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes lock file', () => {
    writeFileSync(lockPath, String(Date.now()), 'utf8');
    releaseLock(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('does not throw when lock file does not exist', () => {
    expect(() => releaseLock(lockPath)).not.toThrow();
  });
});

describe('fetchRateLimits', () => {
  let mockGetOAuthToken: ReturnType<typeof spyOn>;
  let mockGetCached: ReturnType<typeof spyOn>;
  let mockSetCache: ReturnType<typeof spyOn>;
  let mockGetCacheDir: ReturnType<typeof spyOn>;
  let tempDir: string;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    tempDir = mkdtempSync(join(tmpdir(), 'hud-usage-test-'));
    mockGetOAuthToken = spyOn(credentialsMod, 'getOAuthToken');
    mockGetCached = spyOn(cacheMod, 'getCached');
    mockSetCache = spyOn(cacheMod, 'setCache').mockImplementation(() => {});
    mockGetCacheDir = spyOn(cacheMod, 'getCacheDir').mockReturnValue(tempDir);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockGetOAuthToken.mockRestore();
    mockGetCached.mockRestore();
    mockSetCache.mockRestore();
    mockGetCacheDir.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('when no OAuth token', () => {
    it('returns null when getOAuthToken returns null', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue(null);

      const result = await fetchRateLimits();

      expect(result).toBeNull();
      expect(mockGetOAuthToken).toHaveBeenCalled();
    });
  });

  describe('when cached data exists', () => {
    it('returns cached data without calling API', async () => {
      const cachedData = {
        fiveHour: { percent: 50, resetIn: '2h30m' },
        sevenDay: { percent: 20, resetIn: '3d' },
      };
      mockGetCached.mockImplementation((key: string) => {
        if (key === 'oauth-usage') return cachedData;
        return null;
      });

      const result = await fetchRateLimits();

      expect(result).toEqual(cachedData);
      expect(mockGetOAuthToken).not.toHaveBeenCalled();
    });
  });

  describe('negative cache', () => {
    it('returns null immediately when failure cache is hit, skipping API call', async () => {
      mockGetCached.mockImplementation((key: string) => {
        if (key === 'oauth-usage') return null;
        if (key === 'oauth-usage-failure') return { error: 'http-500' };
        return null;
      });
      mockGetOAuthToken.mockResolvedValue('test-token');
      const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);
      global.fetch = fetchMock;

      const result = await fetchRateLimits();

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('caches failure with 15s TTL on HTTP error response', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: (_: string) => null },
      } as unknown as Response);

      await fetchRateLimits();

      expect(mockSetCache).toHaveBeenCalledWith(
        'oauth-usage-failure',
        { error: 'http-500' },
        15_000,
      );
    });

    it('caches failure with 15s TTL on network error', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('Network error'));

      await fetchRateLimits();

      expect(mockSetCache).toHaveBeenCalledWith(
        'oauth-usage-failure',
        { error: 'network' },
        15_000,
      );
    });

    it('caches failure with 15s TTL on timeout', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      await fetchRateLimits();

      expect(mockSetCache).toHaveBeenCalledWith(
        'oauth-usage-failure',
        { error: 'timeout' },
        15_000,
      );
    });
  });

  describe('retry-after header parsing', () => {
    it('uses retry-after header value (in seconds) as failure TTL when > 0', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (name: string) => name === 'retry-after' ? '60' : null },
      } as unknown as Response);

      await fetchRateLimits();

      // retry-after=60s → 60*1000=60000ms, max(60000, 15000) = 60000
      expect(mockSetCache).toHaveBeenCalledWith(
        'oauth-usage-failure',
        { error: 'http-429' },
        60_000,
      );
    });

    it('uses 15s default when retry-after header is absent', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (_: string) => null },
      } as unknown as Response);

      await fetchRateLimits();

      expect(mockSetCache).toHaveBeenCalledWith(
        'oauth-usage-failure',
        { error: 'http-429' },
        15_000,
      );
    });

    it('uses 15s minimum when retry-after value is 0', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: (name: string) => name === 'retry-after' ? '0' : null },
      } as unknown as Response);

      await fetchRateLimits();

      // retry-after=0 → 0ms, max(0, 15000) = 15000
      expect(mockSetCache).toHaveBeenCalledWith(
        'oauth-usage-failure',
        { error: 'http-429' },
        15_000,
      );
    });
  });

  describe('User-Agent header', () => {
    it('sends claude-code/2.1 as User-Agent', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      let capturedHeaders: Record<string, string> = {};
      global.fetch = jest.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        capturedHeaders = init?.headers as Record<string, string> ?? {};
        return {
          ok: true,
          json: async () => ({
            five_hour: null,
            seven_day: null,
            seven_day_oauth_apps: null,
            seven_day_opus: null,
          }),
          headers: { get: (_: string) => null },
        } as unknown as Response;
      });

      await fetchRateLimits();

      expect(capturedHeaders['User-Agent']).toBe('claude-code/2.1');
    });
  });

  describe('file lock — busy path', () => {
    it('returns null when lock is busy and no cache becomes available', async () => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({ five_hour: null, seven_day: null }),
        headers: { get: (_: string) => null },
      } as unknown as Response);
      global.fetch = fetchMock;

      // Use initCache to ensure fetchRateLimits uses our tempDir for lock path
      const { initCache } = await import('./cache.ts');
      initCache(tempDir);

      // Create a fresh (non-stale) lock file to simulate another process holding it
      const lockPath = join(tempDir, 'hud-usage.lock');
      writeFileSync(lockPath, String(Date.now()), 'utf8');

      const result = await fetchRateLimits();

      // Lock is busy → wait for cache → no cache appears → return null
      expect(result).toBeNull();
      // fetch was NOT called because lock was busy (another process is doing the work)
      expect(fetchMock).not.toHaveBeenCalled();
    }, 10000);

    it('returns cached data that appears during wait when lock is busy', async () => {
      const cachedData = { fiveHour: { percent: 42, resetIn: '1h' }, sevenDay: null };
      let pollCount = 0;
      mockGetCached.mockImplementation((key: string) => {
        // First 2 calls are cache checks before lock (return null)
        // Subsequent calls are polls during wait
        pollCount++;
        if (key === 'oauth-usage' && pollCount > 2) return cachedData;
        return null;
      });
      mockGetOAuthToken.mockResolvedValue('test-token');

      // Use initCache to ensure fetchRateLimits uses our tempDir for lock path
      const { initCache } = await import('./cache.ts');
      initCache(tempDir);

      // Create a fresh lock file at the known path
      const lockPath = join(tempDir, 'hud-usage.lock');
      writeFileSync(lockPath, String(Date.now()), 'utf8');

      const result = await fetchRateLimits();

      // Cache appeared during poll → should return it
      expect(result).toEqual(cachedData);
    }, 10000);
  });

  describe('when API returns valid data', () => {
    beforeEach(() => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T10:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('uses utilization value directly as percentage', async () => {
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({
          five_hour: { utilization: 75.0, resets_at: '2024-01-15T12:30:00Z' },
          seven_day: { utilization: 25.0, resets_at: '2024-01-17T15:00:00Z' },
          seven_day_oauth_apps: null,
          seven_day_opus: null,
        }),
        headers: { get: (_: string) => null },
      } as unknown as Response);

      const result = await fetchRateLimits();

      expect(result).not.toBeNull();
      expect(result!.fiveHour!.percent).toBe(75);
      expect(result!.sevenDay!.percent).toBe(25);
      expect(result!.fiveHour!.resetIn).toBe('2h30m');
      expect(result!.sevenDay!.resetIn).toBe('2d5h');
      expect(mockSetCache).toHaveBeenCalledWith('oauth-usage', expect.anything(), 30_000);
    });
  });

  describe('when API errors occur', () => {
    beforeEach(() => {
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
    });

    it('returns null on HTTP error response', async () => {
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 500,
        headers: { get: (_: string) => null },
      } as unknown as Response);

      const result = await fetchRateLimits();

      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('Network error'));

      const result = await fetchRateLimits();

      expect(result).toBeNull();
    });

    it('returns null on timeout', async () => {
      global.fetch = jest.fn<typeof fetch>().mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      const result = await fetchRateLimits();

      expect(result).toBeNull();
    });
  });
});
