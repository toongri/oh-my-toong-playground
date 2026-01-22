import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock dependencies before importing the module
const mockGetOAuthToken = jest.fn<() => Promise<string | null>>();
const mockGetCached = jest.fn<() => unknown>();
const mockSetCache = jest.fn<(key: string, data: unknown, ttlMs: number) => void>();

jest.unstable_mockModule('./credentials.js', () => ({
  getOAuthToken: mockGetOAuthToken,
}));

jest.unstable_mockModule('./cache.js', () => ({
  getCached: mockGetCached,
  setCache: mockSetCache,
}));

// Import the module under test after mocking
const { formatResetTime, fetchRateLimits } = await import('./usage-api.js');

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

describe('fetchRateLimits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      mockGetCached.mockReturnValue(cachedData);

      const result = await fetchRateLimits();

      expect(result).toEqual(cachedData);
      expect(mockGetOAuthToken).not.toHaveBeenCalled();
    });
  });

  describe('when API errors occur', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      mockGetCached.mockReturnValue(null);
      mockGetOAuthToken.mockResolvedValue('test-token');
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns null on HTTP error response', async () => {
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

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
