import { RuleFrontmatterParseError } from "./errors.js";
import type { RuleFrontmatter } from "./types.js";

type ParsedGlobValue = {
	readonly values: readonly string[];
	readonly consumed: number;
};

export function parseYamlFrontmatter(yamlContent: string): RuleFrontmatter {
	const lines = yamlContent.replace(/\r\n/g, "\n").split("\n");
	const frontmatter: RuleFrontmatter = {};
	const globValues: string[] = [];
	const seenGlobs = new Set<string>();
	let lineIndex = 0;

	while (lineIndex < lines.length) {
		const rawLine = lines[lineIndex];
		if (rawLine === undefined) break;

		const line = stripComment(rawLine).trim();
		if (line.length === 0) {
			lineIndex += 1;
			continue;
		}

		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) {
			throw new RuleFrontmatterParseError(`Expected key-value pair on line ${lineIndex + 1}`);
		}

		const key = line.slice(0, colonIndex).trim();
		const rawValue = line.slice(colonIndex + 1).trim();

		if (key === "description") {
			frontmatter.description = parseStringValue(rawValue);
			lineIndex += 1;
			continue;
		}

		if (key === "alwaysApply") {
			frontmatter.alwaysApply = parseBooleanValue(rawValue, lineIndex + 1);
			lineIndex += 1;
			continue;
		}

		if (key === "globs" || key === "paths" || key === "applyTo") {
			const parsed = parseGlobValue(rawValue, lines, lineIndex);
			for (const glob of parsed.values) {
				if (!seenGlobs.has(glob)) {
					seenGlobs.add(glob);
					globValues.push(glob);
				}
			}
			lineIndex += parsed.consumed;
			continue;
		}

		lineIndex += 1;
	}

	const singleGlob = globValues[0];
	if (globValues.length === 1 && singleGlob !== undefined) {
		frontmatter.globs = singleGlob;
	} else if (globValues.length > 1) {
		frontmatter.globs = globValues;
	}

	return frontmatter;
}

function parseBooleanValue(value: string, lineNumber: number): boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	throw new RuleFrontmatterParseError(`Expected boolean on line ${lineNumber}`);
}

function parseGlobValue(
	rawValue: string,
	lines: readonly string[],
	lineIndex: number,
): ParsedGlobValue {
	if (rawValue.startsWith("[")) {
		return { values: parseInlineArray(rawValue), consumed: 1 };
	}

	if (rawValue.length === 0) {
		return parseMultilineArray(lines, lineIndex);
	}

	const quotedScalar = isQuotedScalar(rawValue);
	const value = parseStringValue(rawValue);
	if (!quotedScalar && value.includes(",")) {
		// Split on top-level commas only — commas inside brace expansions (*.{ts,js})
		// must not produce a spurious split. We reuse splitCommaSeparated which already
		// tracks brace depth.
		const parts = splitCommaSeparated(value);
		if (parts.length > 1) {
			return { values: parts, consumed: 1 };
		}
	}

	return { values: [value], consumed: 1 };
}

function isQuotedScalar(value: string): boolean {
	return value.startsWith('"') || value.startsWith("'");
}

function parseMultilineArray(lines: readonly string[], lineIndex: number): ParsedGlobValue {
	const values: string[] = [];
	let consumed = 1;

	for (let index = lineIndex + 1; index < lines.length; index += 1) {
		const rawLine = lines[index];
		if (rawLine === undefined) break;

		const lineWithoutComment = stripComment(rawLine);
		if (lineWithoutComment.trim().length === 0) {
			consumed += 1;
			continue;
		}

		const arrayItem = lineWithoutComment.match(/^\s+-\s*(.*)$/);
		if (arrayItem === null) break;

		values.push(parseStringValue((arrayItem[1] ?? "").trimEnd()));
		consumed += 1;
	}

	return { values: values.filter(Boolean), consumed };
}

function parseInlineArray(value: string): string[] {
	const closingBracketIndex = findClosingBracket(value);
	if (closingBracketIndex === -1) {
		throw new RuleFrontmatterParseError("Unclosed inline array");
	}

	const trailing = value.slice(closingBracketIndex + 1).trim();
	if (trailing.length > 0) {
		throw new RuleFrontmatterParseError("Unexpected content after inline array");
	}

	const content = value.slice(1, closingBracketIndex).trim();
	if (content.length === 0) return [];

	return splitCommaSeparated(content).map(parseStringValue).filter(Boolean);
}

function findClosingBracket(value: string): number {
	let quote: string | null = null;
	let escaped = false;
	// depth starts at 1 for the opening [ that the caller has already consumed.
	// We return when depth drops back to 0 (i.e. the matching outer ]).
	// Inner [] (POSIX char-classes) are tracked so their closing delimiters
	// are never mistaken for the outer array's closing bracket.
	let bracketDepth = 1;

	for (let index = 1; index < value.length; index += 1) {
		const character = value[index];
		if (character === undefined) continue;

		if (escaped) {
			escaped = false;
			continue;
		}

		if (quote !== null && character === "\\") {
			escaped = true;
			continue;
		}

		if (character === '"' || character === "'") {
			const prev = value[index - 1];
			const atBoundary =
				index === 0 || prev === "[" || prev === "," || prev === " " || prev === "\t";
			if (quote === null && atBoundary) quote = character;
			else if (quote !== null && quote === character) quote = null;
			continue;
		}

		if (quote === null) {
			if (character === "[") {
				bracketDepth += 1;
			} else if (character === "]") {
				bracketDepth -= 1;
				if (bracketDepth === 0) return index;
			}
		}
	}

	return -1;
}

function splitCommaSeparated(value: string): string[] {
	const values: string[] = [];
	let current = "";
	let quote: string | null = null;
	let escaped = false;
	// Track brace depth so commas inside *.{ts,js} do not produce a spurious split.
	// Bracket depth ([]) is not needed here: splitCommaSeparated only operates on the
	// content already extracted from the outer array, so [] chars are glob char-classes.
	// We do NOT split on commas inside char-classes either — they are semantically part
	// of the glob token — but POSIX char-classes rarely contain commas, and the outer
	// findClosingBracket already handles the bracket-depth tracking before we are called.
	let braceDepth = 0;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character === undefined) continue;

		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}

		if (quote !== null && character === "\\") {
			current += character;
			escaped = true;
			continue;
		}

		if (character === '"' || character === "'") {
			const prev = value[index - 1];
			const atBoundary = index === 0 || prev === "," || prev === " " || prev === "\t";
			if (quote === null && atBoundary) quote = character;
			else if (quote !== null && quote === character) quote = null;
			current += character;
			continue;
		}

		if (quote === null) {
			if (character === "{") {
				braceDepth += 1;
				current += character;
				continue;
			}
			if (character === "}") {
				braceDepth -= 1;
				current += character;
				continue;
			}
			if (character === "," && braceDepth === 0) {
				values.push(current.trim());
				current = "";
				continue;
			}
		}

		current += character;
	}

	if (quote !== null) {
		throw new RuleFrontmatterParseError("Unclosed quoted value");
	}

	values.push(current.trim());
	return values.filter(Boolean);
}

function parseStringValue(value: string): string {
	if (value.length === 0) return "";
	if (value.startsWith('"')) return parseJsonString(value);
	if (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
		return value.slice(1, -1).replace(/''/g, "'");
	if (value.startsWith("'")) throw new RuleFrontmatterParseError("Unclosed quoted value");
	return value;
}

function parseJsonString(value: string): string {
	try {
		const parsedValue: unknown = JSON.parse(value);
		if (typeof parsedValue !== "string") {
			throw new RuleFrontmatterParseError("Expected JSON-quoted string");
		}
		return parsedValue;
	} catch (error) {
		if (error instanceof RuleFrontmatterParseError) throw error;
		throw new RuleFrontmatterParseError("Invalid JSON-quoted string");
	}
}

function stripComment(line: string): string {
	let quote: string | null = null;
	let escaped = false;

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === undefined) continue;

		if (escaped) {
			escaped = false;
			continue;
		}

		if (quote !== null && character === "\\") {
			escaped = true;
			continue;
		}

		if (character === '"' || character === "'") {
			const prev = line[index - 1];
			const atBoundary =
				index === 0 ||
				prev === " " ||
				prev === "\t" ||
				prev === ":" ||
				prev === "[" ||
				prev === ",";
			if (quote === null && atBoundary) quote = character;
			else if (quote !== null && quote === character) quote = null;
			continue;
		}

		if (quote === null && character === "#") {
			const prev = line[index - 1];
			if (index === 0 || prev === " " || prev === "\t") return line.slice(0, index);
		}
	}

	return line;
}
