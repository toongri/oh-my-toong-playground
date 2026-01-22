import { getOAuthToken } from './credentials.js';
import { getCached, setCache } from './cache.js';
import type { UsageResponse, RateLimitData } from './types.js';

const CACHE_KEY = 'oauth-usage';
const CACHE_TTL_MS = 30_000;  // 30 seconds
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

export async function fetchRateLimits(): Promise<RateLimitData | null> {
  // Check cache first
  const cached = getCached<RateLimitData>(CACHE_KEY);
  if (cached) return cached;

  const token = await getOAuthToken();
  if (!token) return null;

  try {
    const response = await fetch(API_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'omt-hud/1.0.0',
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

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
  } catch {
    return null;
  }
}
