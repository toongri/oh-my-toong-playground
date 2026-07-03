/**
 * Shared I/O orchestration helper for the pin-* skill scripts.
 *
 * This module is pure plumbing over the FROZEN pins engine (lib/pins/**). It
 * centralizes the three cross-cutting concerns that would otherwise be hand-
 * written in each of the five pin scripts (pin-audit, pin-query, pin-record,
 * pin-wrap-up, and the absent/exit path shared by all):
 *
 *   1. Manifest resolution with the manifest-absent UX contract (D7).
 *   2. stdin read + JSON-parse with fail-loud on malformed input (D6).
 *   3. A small, explicit exit-code map.
 *
 * It imports the engine via relative paths (`../pins/...`) rather than the
 * `@lib/` alias because this module lives under `lib/` and the sync
 * alias-rewriter skips `lib/**` files — a deployed `@lib/` alias here would
 * never be rewritten and would crash at import. Relative imports match the
 * intra-`lib/` convention, and `make sync`'s dependency collector follows them
 * to deploy the engine alongside this helper. It reimplements NO engine logic —
 * validation, recording, querying, and parsing all stay in lib/pins/.
 */

import { resolveManifest, type PinsManifest } from "../pins/manifest";
import type { Entity } from "../pins/types";

/**
 * Process exit codes for the pin scripts.
 *
 *   SUCCESS (0) — the script completed, OR the manifest was absent and the
 *                 clean-absent UX path ran (D7). Absent is not an error.
 *   MALFORMED_INPUT (1) — stdin could not be parsed or lacked required keys (D6).
 *   ENGINE_ERROR (1) — an engine call (validation, record, query, ...) threw.
 */
export const EXIT = {
	SUCCESS: 0,
	MALFORMED_INPUT: 1,
	ENGINE_ERROR: 1,
} as const;

/** Exact STDOUT line shown when no pins manifest exists in the project (D7). */
export const ABSENT_MESSAGE = "No pins manifest in this project — run pin-setup to initialize.";

/**
 * Resolve the pins manifest or take the clean-absent exit path (D7).
 *
 * On `{ kind: 'resolved' }` → returns the manifest so the caller proceeds.
 * On `{ kind: 'absent' }`   → prints {@link ABSENT_MESSAGE} to STDOUT and exits 0.
 *
 * Because the absent branch terminates the process, the return type is narrowed
 * to `PinsManifest`: callers can use the result directly without a kind check.
 *
 * `options` are forwarded verbatim to `resolveManifest` (projectRoot/userRoot
 * default to the engine's git-root-then-$OMT_DIR search).
 */
export async function requireManifest(
	options?: Parameters<typeof resolveManifest>[0],
): Promise<PinsManifest> {
	const result = await resolveManifest(options);

	if (result.kind === "absent") {
		// Caller-facing, not a diagnostic: stdout + clean exit 0.
		process.stdout.write(`${ABSENT_MESSAGE}\n`);
		process.exit(EXIT.SUCCESS);
	}

	return result.manifest;
}

/** Read all of STDIN to a string. */
function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", reject);
	});
}

/** Whether `value` has the structural shape of an {@link Entity}. */
function isEntityShape(value: unknown): value is Entity {
	if (value === null || typeof value !== "object") return false;
	if (!("frontmatter" in value) || !("body" in value)) return false;
	return (
		typeof value.frontmatter === "object" &&
		value.frontmatter !== null &&
		typeof value.body === "string"
	);
}

/**
 * Read an {@link Entity} from STDIN, failing LOUD on bad input (D6).
 *
 * Reads ALL of stdin, then `JSON.parse` inside try/catch. On a parse failure OR
 * a payload missing the required `frontmatter` / `body` keys, writes a clear
 * message to STDERR and exits with {@link EXIT.MALFORMED_INPUT}. Malformed input
 * is NEVER silently coerced into an empty entity or a no-op.
 *
 * This validates only the transport-level Entity SHAPE. Field-level validation
 * (id/type/source/...) stays in the engine's record path.
 */
export async function readEntityFromStdin(): Promise<Entity> {
	const raw = await readStdin();

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		return failMalformed(`stdin is not valid JSON: ${detail}`);
	}

	if (!isEntityShape(parsed)) {
		return failMalformed(
			"stdin JSON is missing required Entity keys 'frontmatter' (object) and 'body' (string)",
		);
	}

	// C11: normalize missing relations to [] so the engine's relation iteration
	// never throws a TypeError. The disk-read path (entity.ts:parse) already
	// applies `?? []`; stdin bypasses that, so we do it here instead.
	if (parsed.frontmatter.relations === undefined) {
		parsed.frontmatter.relations = [];
	}

	return parsed;
}

/**
 * Write a malformed-input diagnostic to STDERR and exit non-zero (D6).
 *
 * Return type is `never` so callers can `return failMalformed(...)` inside a
 * function that must otherwise produce a value.
 */
function failMalformed(message: string): never {
	process.stderr.write(`[pin] malformed input: ${message}\n`);
	process.exit(EXIT.MALFORMED_INPUT);
}

/**
 * Write an engine-error diagnostic to STDERR and exit non-zero.
 *
 * Use at a script's top-level catch around engine calls so failures surface
 * with a clear message and a non-zero status instead of an unhandled rejection.
 */
export function failEngine(message: string): never {
	process.stderr.write(`[pin] engine error: ${message}\n`);
	process.exit(EXIT.ENGINE_ERROR);
}
