#!/usr/bin/env bun
/**
 * CLI wrapper for lib/pins/record — reads an Entity from stdin, validates,
 * and writes a canonical .md file to the manifest-resolved location.
 *
 * Usage:
 *   printf '%s' "$ENTITY_JSON" | bun "${CLAUDE_SKILL_DIR}/scripts/record.ts"
 *
 * Stdin:
 *   A JSON-serialized Entity object { frontmatter: Frontmatter, body: string }.
 *   Malformed input writes to stderr and exits non-zero (D6/AC9).
 *
 * Stdout (on success):
 *   A single JSON line: { "id": "<id>", "status": "recorded" | "escaped" }
 *
 * Exit codes:
 *   0 — success, or manifest absent (prints the absent message)
 *   1 — malformed stdin, or engine error
 */

import { record } from "@lib/pins/record";
import { requireManifest, readEntityFromStdin, failEngine } from "@lib/pin-cli/io";
import { existsSync, statSync } from "fs";
import { join } from "path";

if (import.meta.main) {
	const entity = await readEntityFromStdin();
	const manifest = await requireManifest();

	const escapePath = join(manifest.location, ".escape.jsonl");
	const escapeSizeBefore = existsSync(escapePath) ? statSync(escapePath).size : 0;

	try {
		await record(entity, { location: manifest.location });
	} catch (err) {
		failEngine(err instanceof Error ? err.message : String(err));
	}

	const id = entity.frontmatter.id;
	const escapeSizeAfter = existsSync(escapePath) ? statSync(escapePath).size : 0;
	const status = escapeSizeAfter > escapeSizeBefore ? "escaped" : "recorded";

	process.stdout.write(JSON.stringify({ id, status }) + "\n");
}
