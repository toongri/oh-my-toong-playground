/**
 * Shared validation utilities for sync.yaml validators.
 * Used by tools/validators/schema.ts and tools/validators/components.ts.
 */

import { parse } from "yaml";
import { readFileSync } from "fs";
import { basename } from "path";

// ---------------------------------------------------------------------------
// Result accumulator
// ---------------------------------------------------------------------------

export type ValidationResult = {
  errors: string[];
  warnings: string[];
};

export function makeResult(): ValidationResult {
  return { errors: [], warnings: [] };
}

export function mergeResult(target: ValidationResult, source: ValidationResult): void {
  target.errors.push(...source.errors);
  target.warnings.push(...source.warnings);
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

// ---------------------------------------------------------------------------
// YAML parsing
// ---------------------------------------------------------------------------

export function parseYaml(
  filePath: string,
  errorPrefix = "YAML 파싱 오류",
): { data: unknown; error?: undefined } | { data?: undefined; error: string } {
  try {
    const text = readFileSync(filePath, "utf-8");
    const data = parse(text);
    return { data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `${errorPrefix} (${basename(filePath)}): ${msg}` };
  }
}
