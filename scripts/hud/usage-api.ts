import { openSync, unlinkSync, closeSync, writeSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getOAuthToken } from './credentials.ts';
import { getCached, setCache, getCacheDir } from './cache.ts';
import type { UsageResponse, RateLimitData } from './types.ts';

const CACHE_KEY = 'oauth-usage';
const FAILURE_CACHE_KEY = 'oauth-usage-failure';
const CACHE_TTL_MS = 30_000;      // 30 seconds
const FAILURE_TTL_MS = 15_000;    // 15 seconds default
const LOCK_STALE_MS = 30_000;     // 30 seconds
const LOCK_WAIT_MS = 2_000;       // 2 seconds max wait
const LOCK_POLL_MS = 50;          // 50ms polling interval
const API_URL = 'https://api.anthropic.com/api/oauth/usage';

export function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return '';

  const resetDate = new Date(resetsAt);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();

  if (diffMs <= 0) return '0m';

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function acquireLock(lockPath: string): 'acquired' | 'busy' {
  // Check if existing lock is stale
  if (existsSync(lockPath)) {
    try {
      const content = readFileSync(lockPath, 'utf8');
      const timestamp = parseInt(content, 10);
      if (!isNaN(timestamp) && Date.now() - timestamp > LOCK_STALE_MS) {
        unlinkSync(lockPath);
      } else {
        return 'busy';
      }
    } catch {
      return 'busy';
    }
  }

  // Try atomic exclusive create
  try {
    const fd = openSync(lockPath, 'wx');
    const buf = Buffer.from(String(Date.now()), 'utf8');
    writeSync(fd, buf);
    closeSync(fd);
    return 'acquired';
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      return 'busy';
    }
    return 'busy';
  }
}

export function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // ignore — lock may already be gone
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchRateLimits(): Promise<RateLimitData | null> {
  // 1. Check success cache
  const cached = getCached<RateLimitData>(CACHE_KEY);
  if (cached) return cached;

  // 2. Check failure cache → skip API call if hit
  const failure = getCached<{ error: string }>(FAILURE_CACHE_KEY);
  if (failure) return null;

  // 3. Get OAuth token
  const token = await getOAuthToken();
  if (!token) return null;

  // 4. Try to acquire lock
  const lockPath = join(getCacheDir(), 'hud-usage.lock');
  const lockResult = acquireLock(lockPath);

  if (lockResult === 'busy') {
    // Wait for another process to populate cache
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(LOCK_POLL_MS);
      const freshData = getCached<RateLimitData>(CACHE_KEY);
      if (freshData) return freshData;
      const freshFailure = getCached<{ error: string }>(FAILURE_CACHE_KEY);
      if (freshFailure) return null;
    }
    return null;
  }

  // 5. Make API call with lock held
  try {
    const response = await fetch(API_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-code/2.1',
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
      const failureTtl = Math.max(
        isNaN(retryAfterSec) ? 0 : retryAfterSec * 1000,
        FAILURE_TTL_MS,
      );
      setCache(FAILURE_CACHE_KEY, { error: `http-${response.status}` }, failureTtl);
      return null;
    }

    const data = await response.json() as UsageResponse;

    const result: RateLimitData = {
      fiveHour: data.five_hour ? {
        percent: Math.round(data.five_hour.utilization),
        resetIn: formatResetTime(data.five_hour.resets_at),
      } : null,
      sevenDay: data.seven_day ? {
        percent: Math.round(data.seven_day.utilization),
        resetIn: formatResetTime(data.seven_day.resets_at),
      } : null,
    };

    setCache(CACHE_KEY, result, CACHE_TTL_MS);
    return result;
  } catch (err: unknown) {
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    setCache(FAILURE_CACHE_KEY, { error: isTimeout ? 'timeout' : 'network' }, FAILURE_TTL_MS);
    return null;
  } finally {
    releaseLock(lockPath);
  }
}
