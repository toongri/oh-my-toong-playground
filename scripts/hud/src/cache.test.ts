import { jest } from '@jest/globals';
import { getCached, setCache } from './cache.js';

describe('getCached', () => {
  it('returns null for non-existent key', () => {
    const result = getCached<string>('non-existent-key');
    expect(result).toBeNull();
  });
});

describe('setCache and getCached', () => {
  it('stores and retrieves data', () => {
    setCache('test-key', 'test-value', 60000);
    const result = getCached<string>('test-key');
    expect(result).toBe('test-value');
  });
});

describe('TTL expiration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
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
});
