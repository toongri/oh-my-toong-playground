import { parse, stringify, TomlDate } from "smol-toml";

export type KeyPath = string[];
export type Edit =
	{ path: KeyPath; kind: "set"; value: unknown } | { path: KeyPath; kind: "delete" };
export type ConfigState = {
	version: 1;
	target: ".codex/config.toml";
	entries: { path: KeyPath; valueToml: string }[];
};
export type ConfigPlan = {
	edits: Edit[];
	nextState: ConfigState;
	conflicts: { path: KeyPath; reason: string }[];
};

export function isConfigTable(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
	);
}
export function configPathId(path: KeyPath): string {
	return JSON.stringify(path);
}
export function isConfigPathPrefix(parent: KeyPath, child: KeyPath): boolean {
	return parent.length <= child.length && parent.every((part, index) => part === child[index]);
}
export function readConfigPath(
	root: Record<string, unknown>,
	path: KeyPath,
): { exists: boolean; value?: unknown; blocked: boolean } {
	let value: unknown = root;
	for (const part of path) {
		if (!isConfigTable(value)) return { exists: false, blocked: true };
		if (!Object.hasOwn(value, part)) return { exists: false, blocked: false };
		value = value[part];
	}
	return { exists: true, value, blocked: false };
}
/** Tables are namespaces; arrays (including arrays of tables) are atomic values. */
export function flattenConfig(
	value: Record<string, unknown>,
	prefix: KeyPath = [],
): { path: KeyPath; value: unknown }[] {
	return Object.keys(value)
		.sort()
		.flatMap((key) => {
			const child = value[key];
			const path = [...prefix, key];
			return isConfigTable(child) ? flattenConfig(child, path) : [{ path, value: child }];
		});
}
export function configValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	// A small bigint and a safe integer represent the same TOML integer.
	if (typeof left === "bigint" && typeof right === "number" && Number.isSafeInteger(right))
		return left === BigInt(right);
	if (typeof right === "bigint" && typeof left === "number" && Number.isSafeInteger(left))
		return right === BigInt(left);
	if (left instanceof Date && right instanceof Date) {
		const dateKind = (value: Date) =>
			value instanceof TomlDate
				? [value.isDate(), value.isTime(), value.isLocal()].join(":")
				: "false:false:false";
		return dateKind(left) === dateKind(right) && left.getTime() === right.getTime();
	}
	if (Array.isArray(left) && Array.isArray(right))
		return (
			left.length === right.length &&
			left.every((value, index) => configValuesEqual(value, right[index]))
		);
	if (isConfigTable(left) && isConfigTable(right)) {
		const keys = Object.keys(left);
		return (
			keys.length === Object.keys(right).length &&
			keys.every((key) => Object.hasOwn(right, key) && configValuesEqual(left[key], right[key]))
		);
	}
	return false;
}
export function parseConfigValue(valueToml: string): unknown {
	try {
		const parsed = parse(valueToml, { integersAsBigInt: "asNeeded" });
		if (
			Object.keys(parsed).length !== 1 ||
			!Object.hasOwn(parsed, "value") ||
			isConfigTable(parsed.value)
		)
			throw new Error();
		return parsed.value;
	} catch {
		throw new Error("Invalid config ownership value");
	}
}
export function serializeConfigValue(value: unknown): string {
	try {
		const text = stringify({ value });
		if (!configValuesEqual(parseConfigValue(text), value)) throw new Error();
		return text;
	} catch {
		throw new Error("Unsupported config ownership value");
	}
}
function validateState(input: unknown): ConfigState {
	if (
		!isConfigTable(input) ||
		input.version !== 1 ||
		input.target !== ".codex/config.toml" ||
		!Array.isArray(input.entries)
	)
		throw new Error("Invalid config ownership state");
	const entries: ConfigState["entries"] = [];
	for (const entry of input.entries) {
		if (
			!isConfigTable(entry) ||
			!Array.isArray(entry.path) ||
			entry.path.length === 0 ||
			!entry.path.every((part) => typeof part === "string") ||
			typeof entry.valueToml !== "string"
		)
			throw new Error("Invalid config ownership entry");
		const path = entry.path.filter((part): part is string => typeof part === "string");
		if (
			entries.some(
				(previous) =>
					isConfigPathPrefix(previous.path, path) || isConfigPathPrefix(path, previous.path),
			)
		)
			throw new Error("Overlapping config ownership paths");
		parseConfigValue(entry.valueToml);
		entries.push({ path, valueToml: entry.valueToml });
	}
	return { version: 1, target: ".codex/config.toml", entries };
}
export function parseConfigState(text: string): ConfigState {
	let input: unknown;
	try {
		input = JSON.parse(text);
	} catch {
		throw new Error("Invalid config ownership state JSON");
	}
	return validateState(input);
}
export function serializeConfigState(state: ConfigState): string {
	const checked = validateState(state);
	checked.entries.sort((a, b) => configPathId(a.path).localeCompare(configPathId(b.path), "en"));
	return `${JSON.stringify(checked, null, 2)}\n`;
}

/** Plans independent leaf edits; conflicts retain their prior ownership snapshots. */
export function planConfig(
	current: Record<string, unknown>,
	desired: Record<string, unknown>,
	state?: ConfigState,
): ConfigPlan {
	const nextState =
		state === undefined
			? { version: 1 as const, target: ".codex/config.toml" as const, entries: [] }
			: validateState(state);
	const entries = new Map(nextState.entries.map((entry) => [configPathId(entry.path), entry]));
	const edits: Edit[] = [];
	const conflicts: ConfigPlan["conflicts"] = [];
	for (const { path, value } of flattenConfig(desired)) {
		const id = configPathId(path);
		const previous = entries.get(id);
		const present = readConfigPath(current, path);
		const conflict = (reason: string) => conflicts.push({ path, reason });
		// Parent/child ownership changes need a separate explicit migration. A leaf
		// planner must never replace a table that may contain user-owned descendants.
		if (
			present.blocked ||
			[...entries.values()].some(
				(entry) =>
					configPathId(entry.path) !== id &&
					(isConfigPathPrefix(path, entry.path) || isConfigPathPrefix(entry.path, path)),
			)
		) {
			conflict("unsupported-parent-transition");
			continue;
		}
		if (!previous) {
			if (present.exists) {
				conflict("adoption-required");
				continue;
			}
			if (value === null) continue;
		} else if (value === null && !present.exists) {
			entries.delete(id);
			continue;
		} else if (
			!present.exists ||
			(!configValuesEqual(present.value, value) &&
				!configValuesEqual(present.value, parseConfigValue(previous.valueToml)))
		) {
			conflict("owned-key-drift");
			continue;
		}
		if (isConfigTable(present.value)) {
			conflict("unsupported-table-transition");
			continue;
		}
		if (value === null) {
			edits.push({ path, kind: "delete" });
			entries.delete(id);
		} else {
			const valueToml = serializeConfigValue(value);
			if (!present.exists || !configValuesEqual(present.value, value))
				edits.push({ path, kind: "set", value });
			entries.set(id, { path, valueToml });
		}
	}
	nextState.entries = [...entries.values()];
	return { edits, nextState, conflicts };
}
