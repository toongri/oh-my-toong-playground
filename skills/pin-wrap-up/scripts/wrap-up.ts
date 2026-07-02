#!/usr/bin/env bun
/**
 * CLI wrapper for the validate+record pair used by pin-wrap-up.
 *
 * Reads an Entity from stdin, validates it against the T-Box schema, and
 * records it only on a PASS (D5). A FAIL is reported as structured JSON and
 * the script stops — record() is NEVER called for an invalid entity.
 *
 * Usage:
 *   printf '%s' "$ENTITY_JSON" | bun "${CLAUDE_SKILL_DIR}/scripts/wrap-up.ts"
 *
 * Stdin:
 *   A JSON-serialized Entity object { frontmatter: Frontmatter, body: string }.
 *   Malformed input writes to stderr and exits non-zero (D6).
 *
 * Stdout:
 *   On validation FAIL: { "valid": false, "reason": "...", "message": "..." }
 *   On validation PASS: { "id": "<id>", "status": "recorded" }
 *
 * Exit codes:
 *   0 — recorded successfully, or manifest absent (prints the absent message)
 *   1 — malformed stdin, validation failure, or engine error
 */

import { validate } from "@lib/pins/validator";
import { record } from "@lib/pins/record";
import { requireManifest, readEntityFromStdin, failEngine } from "@lib/pin-cli/io";

if (import.meta.main) {
	const entity = await readEntityFromStdin();
	const manifest = await requireManifest();

	let result;
	try {
		result = await validate(entity);
	} catch (err) {
		failEngine(err instanceof Error ? err.message : String(err));
	}

	if (!result.valid) {
		// D5: report and stop — do NOT call record()
		process.stdout.write(
			JSON.stringify({ valid: false, reason: result.reason, message: result.message }) + "\n",
		);
		process.exit(1);
	}

	try {
		await record(entity, { location: manifest.location });
	} catch (err) {
		failEngine(err instanceof Error ? err.message : String(err));
	}

	process.stdout.write(JSON.stringify({ id: entity.frontmatter.id, status: "recorded" }) + "\n");
}
