/**
 * Derived index builder for $OMT_DIR/pins/ .md files.
 *
 * buildIndex(pinsDir) scans all .md files (excluding .bak siblings),
 * parses each via entity.ts:parse, and returns an index keyed by frontmatter id.
 *
 * The result is a DERIVED CACHE only — never a source of truth.
 * Rebuilding from the same .md set always yields an identical output.
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { parse } from "./entity.ts";
import type { Frontmatter } from "./types.ts";

export interface IndexEntry {
	id: string;
	file: string;
	frontmatter: Frontmatter;
}

export interface SkippedEntry {
	file: string;
	reason: string;
}

export interface PinsIndex {
	entries: Record<string, IndexEntry>;
	skipped: SkippedEntry[];
}

/**
 * Build a derived index from all valid .md files in pinsDir.
 *
 * Rules:
 * - Files ending in .bak are excluded from scan entirely.
 * - Files that fail parse() or have no id are skipped with a reason.
 * - Duplicate ids: first file (alphabetical order) wins; subsequent are skipped.
 */
export function buildIndex(pinsDir: string): PinsIndex {
	const entries: Record<string, IndexEntry> = {};
	const skipped: SkippedEntry[] = [];

	let files: string[];
	try {
		files = readdirSync(pinsDir)
			.filter((f) => f.endsWith(".md") && !f.endsWith(".bak") && !f.startsWith("."))
			.sort(); // deterministic order
	} catch {
		// Unreadable directory — return empty index
		return { entries, skipped };
	}

	for (const file of files) {
		const filePath = join(pinsDir, file);
		let content: string;
		try {
			content = readFileSync(filePath, "utf8");
		} catch (err) {
			skipped.push({ file, reason: `Could not read file: ${String(err)}` });
			continue;
		}

		let entity;
		try {
			entity = parse(content);
		} catch (err) {
			skipped.push({ file, reason: `Parse error: ${String(err)}` });
			continue;
		}

		const id = entity.frontmatter.id;
		if (!id) {
			skipped.push({ file, reason: "Missing id in frontmatter" });
			continue;
		}

		if (entries[id]) {
			skipped.push({ file, reason: `Duplicate id: ${id} (already seen in ${entries[id].file})` });
			continue;
		}

		entries[id] = { id, file, frontmatter: entity.frontmatter };
	}

	return { entries, skipped };
}
