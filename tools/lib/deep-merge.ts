/**
 * Returns true if `v` is a plain object (not null, not an array).
 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep merge two objects. Values from `override` win on conflict.
 * Non-plain-object values (arrays, primitives) are replaced, not merged.
 * A `null` value in `override` deletes the corresponding key from the result
 * (RFC 7386 JSON Merge Patch semantics), recursing into nested objects.
 */
export function deepMerge(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...base };
	for (const [key, val] of Object.entries(override)) {
		if (val === null) {
			delete result[key];
			continue;
		}
		const baseVal = result[key];
		if (isPlainObject(baseVal) && isPlainObject(val)) {
			result[key] = deepMerge(baseVal, val);
		} else {
			result[key] = val;
		}
	}
	return result;
}
