import { isPlainObject } from "./deep-merge.ts";
import { hasRegistry, getIdentityKey } from "./overlay-keys.ts";

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function mergeArrays(base: unknown[], local: unknown[], path: string): unknown[] {
  if (!hasRegistry(path)) {
    const seen = new Set<unknown>();
    const result: unknown[] = [];
    for (const item of [...base, ...local]) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
    return result;
  }

  const result: unknown[] = [...base];
  const baseIndexByKey = new Map<string, number>();
  for (let i = 0; i < base.length; i++) {
    baseIndexByKey.set(getIdentityKey(path, base[i]), i);
  }

  for (const localEntry of local) {
    const key = getIdentityKey(path, localEntry);
    if (baseIndexByKey.has(key)) {
      result[baseIndexByKey.get(key)!] = localEntry;
    } else {
      result.push(localEntry);
    }
  }
  return result;
}

export function deepMergeOverlay(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  path = "root",
): Record<string, unknown> {
  if (local == null || (isPlainObject(local) && Object.keys(local).length === 0)) {
    return deepClone(base ?? {});
  }
  if (base == null) {
    return deepClone(local);
  }

  const result: Record<string, unknown> = deepClone(base);

  for (const [key, localVal] of Object.entries(local)) {
    const baseVal = result[key];
    const childPath = path === "root" ? key : `${path}.${key}`;

    if (Array.isArray(baseVal) && Array.isArray(localVal)) {
      result[key] = mergeArrays(baseVal, localVal, childPath);
    } else if (isPlainObject(baseVal) && isPlainObject(localVal)) {
      result[key] = deepMergeOverlay(
        baseVal as Record<string, unknown>,
        localVal as Record<string, unknown>,
        childPath,
      );
    } else {
      result[key] = deepClone(localVal);
    }
  }

  return result;
}
