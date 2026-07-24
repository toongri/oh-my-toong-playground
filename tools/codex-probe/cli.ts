#!/usr/bin/env bun
/**
 * codex-probe CLI — the process-boundary entry point over probe.ts.
 *
 * Usage: bun run cli.ts <spec.json>
 *
 * The spec JSON expresses the sentinel/absent judgment kinds only (the
 * predicate kind carries a function, which JSON can't encode — a follow-up
 * story wanting a predicate judgment imports probe.ts's runProbe() directly
 * from a small TS script instead of going through this CLI).
 *
 * Exit codes (plan AC3): 0 pass, 1 fail (measured, judgment false),
 * 2 unmeasurable — including a malformed spec or missing argv, which are
 * just as much "the probe could not be run" as a missing codex binary.
 */

import fs from "fs";

import { runProbe } from "./probe.ts";
import type { ProbeOptions, ProbeOutcome, ProbeSpec } from "./probe.ts";
import { ALL_OBSERVATION_FIELDS } from "./types.ts";
import type { Judgment, ObservationField, SandboxMode } from "./types.ts";

type RawSpec = {
	prompt?: unknown;
	cwd?: unknown;
	sandbox?: unknown;
	timeoutMs?: unknown;
	extraArgs?: unknown;
	codexHome?: unknown;
	allowedVersions?: unknown;
	fields?: unknown;
	attempts?: unknown;
	sentinel?: unknown;
	absent?: unknown;
};

function isSandboxMode(value: unknown): value is SandboxMode {
	return value === "read-only" || value === "workspace-write" || value === "danger-full-access";
}

function isObservationField(value: unknown): value is ObservationField {
	return typeof value === "string" && ALL_OBSERVATION_FIELDS.some((field) => field === value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isObservationFieldArray(value: unknown): value is ObservationField[] {
	return Array.isArray(value) && value.every(isObservationField);
}

/** Validates `value` as an optional field of a given type, or throws a human-readable message. */
function parseOptional<T>(value: unknown, field: string, expected: string, isType: (v: unknown) => v is T): T | undefined {
	if (value === undefined) return undefined;
	if (isType(value)) return value;
	throw new Error(`spec.${field} must be ${expected}`);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isNumber(value: unknown): value is number {
	return typeof value === "number";
}

/** Parses and validates a probe spec JSON file into a {spec, attempts} pair. Throws with a human-readable message on any shape violation. */
export function loadProbeSpecFromFile(specPath: string): { spec: ProbeSpec; attempts?: number } {
	const raw: RawSpec = JSON.parse(fs.readFileSync(specPath, "utf-8"));

	if (typeof raw.prompt !== "string" || raw.prompt.length === 0) {
		throw new Error("spec.prompt must be a non-empty string");
	}
	if (typeof raw.cwd !== "string" || raw.cwd.length === 0) {
		throw new Error("spec.cwd must be a non-empty string");
	}
	const sandbox = parseOptional(raw.sandbox, "sandbox", "one of read-only, workspace-write, danger-full-access", isSandboxMode);
	const timeoutMs = parseOptional(raw.timeoutMs, "timeoutMs", "a number", isNumber);
	const extraArgs = parseOptional(raw.extraArgs, "extraArgs", "a string array", isStringArray);
	const codexHome = parseOptional(raw.codexHome, "codexHome", "a string", isString);
	const allowedVersions = parseOptional(raw.allowedVersions, "allowedVersions", "a string array", isStringArray);
	const fields = parseOptional(raw.fields, "fields", `an array drawn from ${ALL_OBSERVATION_FIELDS.join(", ")}`, isObservationFieldArray);
	const attempts = parseOptional(raw.attempts, "attempts", "a number", isNumber);

	// CONFIRMED defect (code-review): an empty-string sentinel or an empty
	// absent array is not a valid spec — it's a vacuous one. `"".includes("")`
	// (evaluate.ts's sentinel case) is always true, and `[].some(...)`
	// (evaluate.ts's absent case) is always false, so either shape passes
	// (exit 0) regardless of what the session actually observed — the exact
	// failure mode this validation gate exists to reject upstream, before a
	// typo'd/malformed spec ever reaches measurement. An empty `fields` array
	// is the same defect one level down: evaluate.ts's searchText joins zero
	// fields into "", making the search text always empty and the judgment
	// above vacuous the same way regardless of `sentinel`/`absent`'s own
	// non-emptiness.
	if (fields !== undefined && fields.length === 0) {
		throw new Error("spec.fields, if present, must be a non-empty array — an empty array makes the search text always empty (vacuous judgment)");
	}

	const hasSentinel = raw.sentinel !== undefined;
	const hasAbsent = raw.absent !== undefined;
	if (hasSentinel === hasAbsent) {
		throw new Error("spec must set exactly one of `sentinel` (string) or `absent` (string array)");
	}

	let judgment: Judgment;
	if (hasSentinel) {
		if (typeof raw.sentinel !== "string" || raw.sentinel.length === 0) throw new Error("spec.sentinel must be a non-empty string");
		judgment = { kind: "sentinel", text: raw.sentinel, fields };
	} else {
		if (!isStringArray(raw.absent) || raw.absent.length === 0) throw new Error("spec.absent must be a non-empty string array");
		judgment = { kind: "absent", literals: raw.absent, fields };
	}

	const spec: ProbeSpec = {
		session: { prompt: raw.prompt, cwd: raw.cwd, sandbox, timeoutMs, extraArgs },
		judgment,
		allowedVersions,
		codexHome,
	};
	return { spec, attempts };
}

/** Runs the CLI and returns the process exit code — never throws. */
export async function runCli(argv: string[]): Promise<number> {
	const specPath = argv[0];
	if (!specPath) {
		process.stderr.write("usage: codex-probe <spec.json>\n");
		return 2;
	}

	let loaded: { spec: ProbeSpec; attempts?: number };
	try {
		loaded = loadProbeSpecFromFile(specPath);
	} catch (err) {
		process.stderr.write(`invalid probe spec: ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}

	const opts: ProbeOptions = loaded.attempts === undefined ? {} : { attempts: loaded.attempts };

	// The measurement leg itself can throw (e.g. spec.allowedVersions is
	// omitted, so runProbe falls through to getCodexVersions() -> loadConfig(),
	// which throws on a malformed config.yaml/config.local.yaml — see
	// tools/lib/config.ts's loadConfig docstring). An uncaught throw here means
	// the probe could not be measured, not that it measured a negative, so it
	// must map to exit 2 — not the uncaught-throw exit 1 bun would otherwise
	// produce for an unhandled rejection at import.meta.main. Mirrors
	// probes/*/index.ts's runEntry, which wraps its own measurement leg the
	// same way for the same reason.
	let outcome: ProbeOutcome;
	try {
		outcome = await runProbe(loaded.spec, opts);
	} catch (err) {
		process.stderr.write(`codex-probe: unmeasurable — ${err instanceof Error ? err.message : String(err)}\n`);
		return 2;
	}

	if (outcome.exitCode === 2) {
		process.stdout.write(JSON.stringify({ exitCode: 2, reason: outcome.reason, detail: outcome.detail }) + "\n");
	} else {
		process.stdout.write(
			JSON.stringify({
				exitCode: outcome.exitCode,
				finalMessage: outcome.observation.finalMessage,
				toolCallCount: outcome.observation.toolCalls.length,
			}) + "\n",
		);
	}
	return outcome.exitCode;
}

if (import.meta.main) {
	const code = await runCli(process.argv.slice(2));
	process.exit(code);
}
