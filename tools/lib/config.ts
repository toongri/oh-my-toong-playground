/**
 * Config loader for oh-my-toong.
 * Reads config.yaml from the project root and exposes platform default helpers.
 * Mirrors the bash functions get_default_platforms() and get_feature_platforms()
 * in tools/lib/common.sh.
 */

import { parse } from "yaml";
import { join, dirname } from "path";
import type { Platform } from "./types.ts";

type ConfigYaml = {
  "use-platforms"?: Platform[];
  "feature-platforms"?: Record<string, Platform[]>;
  backup_retention_days?: number;
};

// Module-level cache
let cachedRootDir: string | null = null;
let cachedConfig: ConfigYaml | null = null;
let cachePopulated = false;

/**
 * Find the project root by walking up from __dirname until config.yaml is found.
 * Returns null if config.yaml is not found.
 */
export function getRootDir(): string | null {
  if (cachedRootDir !== null) return cachedRootDir;

  let dir = dirname(new URL(import.meta.url).pathname);

  // Walk up a reasonable number of levels
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "config.yaml");
    if (Bun.file(candidate).size > 0) {
      cachedRootDir = dir;
      return cachedRootDir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  return null;
}

/**
 * Parse and cache config.yaml from the project root.
 * Returns null if config.yaml is not found or cannot be parsed.
 */
export async function loadConfig(): Promise<ConfigYaml | null> {
  if (cachePopulated) return cachedConfig;

  const rootDir = getRootDir();
  if (rootDir === null) {
    cachePopulated = true;
    cachedConfig = null;
    return null;
  }

  const configPath = join(rootDir, "config.yaml");
  const file = Bun.file(configPath);

  try {
    const text = await file.text();
    cachedConfig = parse(text) as ConfigYaml;
  } catch {
    cachedConfig = null;
  }

  cachePopulated = true;
  return cachedConfig;
}

/**
 * Return the global default platforms from config.yaml `use-platforms`.
 * Falls back to ["claude"] if the field is missing or config.yaml is unavailable.
 */
export async function getDefaultPlatforms(): Promise<Platform[]> {
  const config = await loadConfig();
  const platforms = config?.["use-platforms"];
  if (Array.isArray(platforms) && platforms.length > 0) {
    return platforms;
  }
  return ["claude"];
}

/**
 * Return feature-specific platforms from config.yaml `feature-platforms[category]`.
 * Falls back to getDefaultPlatforms() if the category is not defined.
 */
export async function getFeaturePlatforms(category: string): Promise<Platform[]> {
  const config = await loadConfig();
  const featurePlatforms = config?.["feature-platforms"];
  if (featurePlatforms && Array.isArray(featurePlatforms[category]) && featurePlatforms[category].length > 0) {
    return featurePlatforms[category];
  }
  return getDefaultPlatforms();
}

/**
 * Return the backup retention days from config.yaml `backup_retention_days`.
 * Defaults to 3 if the field is missing or config.yaml is unavailable.
 */
export async function getBackupRetentionDays(): Promise<number> {
  const config = await loadConfig();
  const days = config?.backup_retention_days;
  if (typeof days === "number" && days > 0) {
    return days;
  }
  return 3;
}

/**
 * Reset the internal cache. Used in tests to isolate test cases.
 */
export function _resetConfigCache(): void {
  cachedRootDir = null;
  cachedConfig = null;
  cachePopulated = false;
}
