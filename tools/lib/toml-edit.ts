import { parse, stringify } from "smol-toml";
import { configValuesEqual } from "./codex-config-ownership";
import type { Edit } from "./codex-config-ownership";

type Table = Record<string, unknown>;
type Span = {
	start: number;
	end: number;
	contentEnd: number;
	equals: number;
	comment: number;
	path: string[];
	header: boolean;
	array: boolean;
};

function read(source: string): Table {
	try {
		return parse(source, { integersAsBigInt: "asNeeded" });
	} catch {
		throw new Error("Invalid TOML document");
	}
}

function isTable(value: unknown): value is Table {
	return (
		value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
	);
}

function keyPath(key: string): string[] {
	let value: unknown = read(`${key} = 0`);
	const path: string[] = [];
	while (value !== 0) {
		if (!isTable(value)) throw new Error("Unsupported TOML key");
		const entries = Object.entries(value);
		if (entries.length !== 1 || !entries[0]) throw new Error("Unsupported TOML key");
		path.push(entries[0][0]);
		value = entries[0][1];
	}
	return path;
}

// Walk complete statements, ignoring syntax characters inside strings/comments.
function scan(source: string): Span[] {
	const spans: Span[] = [];
	let context: string[] = [];
	let arrayContext = false;
	let cursor = 0;
	while (cursor < source.length) {
		const start = cursor;
		while (source[cursor] === " " || source[cursor] === "\t" || source[cursor] === "\r") cursor++;
		if (source[cursor] === "#" || source[cursor] === "\n") {
			const next = source.indexOf("\n", cursor);
			cursor = next < 0 ? source.length : next + 1;
			continue;
		}
		if (cursor >= source.length) break;
		const header = source[cursor] === "[";
		const array = header && source[cursor + 1] === "[";
		let quote = "";
		let multiline = false;
		let depth = 0;
		let equals = -1;
		let comment = -1;
		let contentEnd = cursor;
		for (; cursor < source.length; cursor++) {
			const char = source.charAt(cursor);
			if (quote) {
				if (quote === '"' && char === "\\") {
					cursor++;
					continue;
				}
				if (char === quote) {
					if (!multiline) quote = "";
					else if (source.slice(cursor, cursor + 3) === quote.repeat(3)) {
						while (source[cursor + 1] === quote) cursor++;
						quote = "";
					}
				}
				contentEnd = cursor + 1;
				continue;
			}
			if (char === '"' || char === "'") {
				quote = char;
				multiline = source.slice(cursor, cursor + 3) === char.repeat(3);
				if (multiline) cursor += 2;
			} else if (char === "#") {
				const newline = source.indexOf("\n", cursor);
				if (depth === 0) {
					comment = cursor;
					cursor = newline < 0 ? source.length : newline;
					break;
				}
				cursor = newline < 0 ? source.length : newline;
				continue;
			} else if (char === "\n" && depth === 0) break;
			else if (char === "[" || char === "{") depth++;
			else if (char === "]" || char === "}") depth--;
			else if (char === "=" && equals < 0) equals = cursor;
			if (!/\s/.test(char)) contentEnd = cursor + 1;
		}
		if (source[cursor] === "\n") cursor++;
		let path: string[];
		if (header) {
			const raw = source.slice(start, contentEnd).trim();
			context = keyPath(raw.slice(array ? 2 : 1, array ? -2 : -1));
			arrayContext = array;
			path = context;
		} else {
			if (equals < 0) throw new Error("Unsupported TOML statement");
			path = [...context, ...keyPath(source.slice(start, equals).trim())];
		}
		spans.push({
			start,
			end: cursor,
			contentEnd,
			equals,
			comment,
			path,
			header,
			array: arrayContext,
		});
	}
	return spans;
}

function prefix(parent: string[], child: string[]): boolean {
	return parent.length <= child.length && parent.every((key, i) => key === child[i]);
}

function encode(value: unknown): string {
	if (value === undefined || value === null) throw new Error("Unsupported TOML value");
	if (Array.isArray(value)) return `[${value.map(encode).join(", ")}]`;
	if (typeof value === "object" && !(value instanceof Date)) {
		if (
			Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null
		) {
			throw new Error("Unsupported TOML value");
		}
		return `{ ${Object.entries(value)
			.map(([key, item]) => `${JSON.stringify(key)} = ${encode(item)}`)
			.join(", ")} }`;
	}
	try {
		const encoded = stringify({ value }).trim();
		const result = encoded.slice(encoded.indexOf("=") + 1).trim();
		if (!result || !configValuesEqual(read(`value = ${result}`).value, value)) {
			throw new Error("Unsupported TOML value");
		}
		return result;
	} catch {
		throw new Error("Unsupported TOML value");
	}
}

function parentOf(document: Table, path: string[], create: boolean): Table | undefined {
	let parent = document;
	for (const key of path.slice(0, -1)) {
		if (!Object.hasOwn(parent, key)) {
			if (!create) return undefined;
			Object.defineProperty(parent, key, {
				value: {},
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		const next = parent[key];
		if (!isTable(next)) {
			throw new Error("Unsupported TOML parent path");
		}
		parent = next;
	}
	return parent;
}

/** Preserve untouched bytes; reject edits that cannot be represented unambiguously. */
export function applyTomlEdits(source: string, edits: Edit[]): string {
	let result = source;
	const expected = read(source);
	for (const edit of edits) {
		if (!edit.path.length || edit.path.some((key) => typeof key !== "string"))
			throw new Error("Invalid TOML edit path");
		const spans = scan(result);
		const exact = spans.find(
			(span) =>
				!span.header && prefix(span.path, edit.path) && span.path.length === edit.path.length,
		);
		if (
			spans.some(
				(span) =>
					(span.array && prefix(span.path, edit.path)) ||
					(!span.header && span.path.length < edit.path.length && prefix(span.path, edit.path)),
			)
		) {
			throw new Error("Unsupported TOML inline-table or array descendant edit");
		}
		const parent = parentOf(expected, edit.path, edit.kind === "set");
		const key = edit.path.at(-1);
		if (key === undefined) throw new Error("Invalid TOML edit path");
		const exists = !!parent && Object.hasOwn(parent, key);
		if (edit.kind === "delete" && !exists) continue;
		if (!parent) throw new Error("Unsupported TOML parent path");
		if (edit.kind === "set" && exists && configValuesEqual(parent[key], edit.value)) continue;
		if (!exact && exists) throw new Error("Unsupported TOML table replacement");
		const encoded = edit.kind === "set" ? encode(edit.value) : "";
		if (exact) {
			if (edit.kind === "delete") {
				const suffix = exact.comment < 0 ? "" : result.slice(exact.comment, exact.end);
				result = result.slice(0, exact.start) + suffix + result.slice(exact.end);
			} else {
				let valueStart = exact.equals + 1;
				while (result[valueStart] === " " || result[valueStart] === "\t") valueStart++;
				result = result.slice(0, valueStart) + encoded + result.slice(exact.contentEnd);
			}
		} else {
			// Use the deepest existing ordinary table, or the root before any header.
			const headers = spans.filter(
				(span) =>
					span.header &&
					!span.array &&
					span.path.length < edit.path.length &&
					prefix(span.path, edit.path),
			);
			const table = headers.sort((a, b) => b.path.length - a.path.length)[0];
			const nextHeader = spans.find((span) => span.header && (!table || span.start > table.start));
			const offset = nextHeader?.start ?? result.length;
			const relative = edit.path
				.slice(table?.path.length ?? 0)
				.map((key) => JSON.stringify(key))
				.join(".");
			const newline = result.includes("\r\n") ? "\r\n" : "\n";
			const separator = offset > 0 && result[offset - 1] !== "\n" ? newline : "";
			result =
				result.slice(0, offset) +
				separator +
				`${relative} = ${encoded}${newline}` +
				result.slice(offset);
		}
		if (edit.kind === "delete") {
			delete parent[key];
			// Deleting the last dotted assignment also erases its implicit tables.
			// Preserve the planned empty parent with one deepest explicit header.
			if (
				edit.path.length > 1 &&
				Object.keys(parent).length === 0 &&
				!parentOf(read(result), edit.path, false)
			) {
				const newline = source.includes("\r\n") ? "\r\n" : "\n";
				const separator = result.length > 0 && !result.endsWith("\n") ? newline : "";
				const header = edit.path
					.slice(0, -1)
					.map((key) => JSON.stringify(key))
					.join(".");
				result += `${separator}[${header}]${newline}`;
			}
		} else
			Object.defineProperty(parent, key, {
				value: read(`value = ${encoded}`).value,
				enumerable: true,
				writable: true,
				configurable: true,
			});
		if (!configValuesEqual(read(result), expected))
			throw new Error("TOML edit changed unrelated configuration");
	}
	return result;
}
