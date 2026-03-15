import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, tmpdir } from 'os';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

type CacheStore = Record<string, CacheEntry<unknown>>;

let cacheDir = join(homedir(), '.omt', 'cache');
const CACHE_FILE = 'hud-usage.json';

function getCachePath(): string {
  return join(cacheDir, CACHE_FILE);
}

export function initCache(dir: string): void {
  cacheDir = dir;
}

export function getCacheDir(): string {
  return cacheDir;
}

function readStore(): CacheStore {
  const path = getCachePath();
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid cache format');
    }
    return parsed as CacheStore;
  } catch (err) {
    if (existsSync(path)) {
      console.warn(`[cache] Corrupt cache file, deleting: ${path}`);
      try { unlinkSync(path); } catch { /* ignore */ }
    }
    return {};
  }
}

function writeStore(store: CacheStore): void {
  const path = getCachePath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tempPath = join(tmpdir(), `hud-cache-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
  renameSync(tempPath, path);
}

export function getCached<T>(key: string): T | null {
  const store = readStore();
  const entry = store[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete store[key];
    writeStore(store);
    return null;
  }
  return entry.data as T;
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  const store = readStore();
  store[key] = {
    data,
    expiresAt: Date.now() + ttlMs,
  };
  writeStore(store);
}
