import { test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sweepStaleSessionStates } from "./persistent-cache.js";

// Absolute path to this module, for the subprocess probe below (bun's os.homedir()
// resolves once at process start and ignores a runtime-mutated process.env.HOME, so
// asserting on the writeErrorBreadcrumb sink requires setting HOME before spawn —
// same reason cli.ts's breadcrumb path is only ever tested via spawnSync elsewhere
// in this suite, e.g. fidelity-and-lanes.test.ts's "C1" test).
const PERSISTENT_CACHE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "persistent-cache.ts");

// HERMETIC HOME: sweepStaleSessionStates records forced-fault errors via
// writeErrorBreadcrumb, which appends to $HOME/.omt/rules-injector/error.log. A
// fresh HOME per test keeps that sink (and any real ~/.omt) untouched.
let tempHome = "";
let realHome: string | undefined;
let scratchDir = "";

beforeEach(() => {
	realHome = process.env["HOME"];
	tempHome = mkdtempSync(join(tmpdir(), "rules-injector-gc-home-"));
	process.env["HOME"] = tempHome;
	scratchDir = mkdtempSync(join(tmpdir(), "rules-injector-gc-"));
});

afterEach(() => {
	if (realHome === undefined) {
		delete process.env["HOME"];
	} else {
		process.env["HOME"] = realHome;
	}
	rmSync(tempHome, { recursive: true, force: true });
	rmSync(scratchDir, { recursive: true, force: true });
});

const TTL_MS = 1_000;

// Ages a file's mtime to `ageMs` in the past, well beyond any TTL used in these tests.
function age(path: string, ageMs: number): void {
	const seconds = (Date.now() - ageMs) / 1000;
	utimesSync(path, seconds, seconds);
}

test("sweeps stale sibling json and lock", () => {
	const ownCachePath = join(scratchDir, "own.json");
	writeFileSync(ownCachePath, "{}");

	const siblingPath = join(scratchDir, "sibling.json");
	writeFileSync(siblingPath, "{}");
	age(siblingPath, 10_000);
	const lockPath = `${siblingPath}.lock`;
	mkdirSync(lockPath);

	sweepStaleSessionStates(scratchDir, TTL_MS, ownCachePath);

	expect(existsSync(siblingPath)).toBe(false);
	expect(existsSync(lockPath)).toBe(false);
	expect(existsSync(ownCachePath)).toBe(true);
});

test("preserves fresh sibling", () => {
	const ownCachePath = join(scratchDir, "own.json");
	writeFileSync(ownCachePath, "{}");

	const freshSiblingPath = join(scratchDir, "fresh-sibling.json");
	writeFileSync(freshSiblingPath, "{}");

	sweepStaleSessionStates(scratchDir, TTL_MS, ownCachePath);

	expect(existsSync(freshSiblingPath)).toBe(true);
});

test("preserves current session on stale-mtime resume", () => {
	const ownCachePath = join(scratchDir, "own.json");
	writeFileSync(ownCachePath, "{}");
	age(ownCachePath, 10_000);

	sweepStaleSessionStates(scratchDir, TTL_MS, ownCachePath);

	expect(existsSync(ownCachePath)).toBe(true);
});

test("ignores non-session files and respects 24h throttle", () => {
	const ownCachePath = join(scratchDir, "own.json");
	writeFileSync(ownCachePath, "{}");

	const errorLogPath = join(scratchDir, "error.log");
	writeFileSync(errorLogPath, "boom\n");
	age(errorLogPath, 10_000);

	const firstSiblingPath = join(scratchDir, "sibling-a.json");
	writeFileSync(firstSiblingPath, "{}");
	age(firstSiblingPath, 10_000);

	sweepStaleSessionStates(scratchDir, TTL_MS, ownCachePath);

	// non-.json file never swept, even though it is stale
	expect(existsSync(errorLogPath)).toBe(true);
	// stale sibling swept on the (unthrottled) first run
	expect(existsSync(firstSiblingPath)).toBe(false);

	const secondSiblingPath = join(scratchDir, "sibling-b.json");
	writeFileSync(secondSiblingPath, "{}");
	age(secondSiblingPath, 10_000);

	sweepStaleSessionStates(scratchDir, TTL_MS, ownCachePath);

	// second run happens within the 24h throttle window: no-op, so the new
	// stale sibling survives even though it would otherwise qualify.
	expect(existsSync(secondSiblingPath)).toBe(true);
});

test("sweep error is swallowed", () => {
	// Pass a `dir` that is actually a regular file, not a directory, so every fs op
	// inside the sweep (marker stat/write, readdir) fails with ENOTDIR/EEXIST.
	const notADirPath = join(scratchDir, "not-a-dir");
	writeFileSync(notADirPath, "not a directory");

	// In-process, direct calls can't verify the breadcrumb sink (HOME override is
	// ineffective post-start), so this runs in a subprocess with HOME set at spawn
	// time — both to confirm the fault never throws (a non-zero exit / stderr would
	// mean it did) and that the error was recorded, not silently dropped.
	const probeScriptPath = join(scratchDir, "sweep-fault-probe.mjs");
	writeFileSync(
		probeScriptPath,
		[
			`import { sweepStaleSessionStates } from ${JSON.stringify(PERSISTENT_CACHE_PATH)};`,
			`sweepStaleSessionStates(${JSON.stringify(notADirPath)}, ${TTL_MS}, ${JSON.stringify(join(notADirPath, "own.json"))});`,
		].join("\n"),
	);

	const result = spawnSync("bun", ["run", probeScriptPath], {
		env: { ...process.env, HOME: tempHome },
		encoding: "utf8",
	});

	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");

	const errorLogPath = join(tempHome, ".omt", "rules-injector", "error.log");
	expect(existsSync(errorLogPath)).toBe(true);
	expect(readFileSync(errorLogPath, "utf8")).toContain("sweepStaleSessionStates");
});

// ── TODO5 / D-6: SessionStart wiring end-to-end ──────────────────────────────
//
// Exercises the real CLI (not the in-process sweep function) so it proves the
// GC pre-step is actually reachable from runSessionStartHook: an aged sibling
// <sid>.json under the resolved cachePath dir is swept, an oversized error.log
// is truncated, and the normal additionalContext injection is unaffected.

const CLI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "cli.ts");

test("SessionStart hook runs sweep and rotate", () => {
	const pluginDataDir = join(tempHome, ".omt");
	mkdirSync(pluginDataDir, { recursive: true });

	// Aged sibling session-state file: must be swept given the 1-day TTL override below.
	const staleSiblingPath = join(pluginDataDir, "stale-sibling.json");
	writeFileSync(staleSiblingPath, "{}");
	age(staleSiblingPath, 2 * 24 * 60 * 60 * 1000);

	// Oversized error.log: rotateErrorLog derives its sink from homedir() directly
	// (ignores PLUGIN_DATA), so it always lives at HOME/.omt/rules-injector/error.log.
	const errorLogPath = join(tempHome, ".omt", "rules-injector", "error.log");
	mkdirSync(dirname(errorLogPath), { recursive: true });
	writeFileSync(errorLogPath, "x".repeat(50));

	const projectDir = mkdtempSync(join(tmpdir(), "rules-injector-gc-proj-"));
	try {
		mkdirSync(join(projectDir, ".claude", "rules"), { recursive: true });
		writeFileSync(join(projectDir, "package.json"), '{"name":"ri-gc-fixture"}\n');
		writeFileSync(
			join(projectDir, ".claude", "rules", "always.md"),
			"---\nalwaysApply: true\n---\nGC_SESSION_START_MARKER\n",
		);

		const result = spawnSync("bun", ["run", CLI_PATH, "hook", "session-start"], {
			input: JSON.stringify({
				hook_event_name: "SessionStart",
				session_id: "gc-e2e-session",
				transcript_path: null,
				cwd: projectDir,
				model: "gpt-5",
				permission_mode: "default",
				source: "startup",
			}),
			env: {
				...process.env,
				HOME: tempHome,
				PI_RULES_DISABLE_BUNDLED: "1",
				PLUGIN_DATA: pluginDataDir,
				PI_RULES_SESSION_STATE_TTL_DAYS: "1",
				PI_RULES_ERROR_LOG_MAX_BYTES: "10",
			},
			encoding: "utf8",
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const stdout = result.stdout.trim();
		const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
		expect(parsed.hookSpecificOutput?.additionalContext ?? "").toContain("GC_SESSION_START_MARKER");

		expect(existsSync(staleSiblingPath)).toBe(false);
		expect(statSync(errorLogPath).size).toBe(0);
	} finally {
		rmSync(projectDir, { recursive: true, force: true });
	}
});

// ── Fix-round T1-AC5: GC pre-step must not perturb compact recovery ──────────
//
// Combines a post-compact SessionStart (source: "compact", the real recovery
// path) with GC-triggering conditions (an aged sibling <sid>.json + an
// oversized error.log) in the same hermetic HOME. Proves the D-6 GC pre-step
// (own-mtime touch -> sweep -> rotate) coexists with recovery without
// altering it: both the GC side effects AND the unchanged recovery
// additionalContext must be observed from the same hook run.

test("SessionStart compact-source recovery is unchanged by GC pre-step", () => {
	const pluginDataDir = join(tempHome, ".omt");
	mkdirSync(pluginDataDir, { recursive: true });

	const projectDir = mkdtempSync(join(tmpdir(), "rules-injector-gc-recovery-proj-"));
	try {
		const rulesDir = join(projectDir, ".claude", "rules");
		mkdirSync(rulesDir, { recursive: true });
		const rulePath = join(rulesDir, "recovery.md");
		writeFileSync(join(projectDir, "package.json"), '{"name":"ri-gc-recovery-fixture"}\n');
		writeFileSync(rulePath, "---\nalwaysApply: true\n---\nGC_RECOVERY_MARKER\n");

		const sessionId = "gc-recovery-session";
		const baseEnv = {
			...process.env,
			HOME: tempHome,
			PI_RULES_DISABLE_BUNDLED: "1",
			PLUGIN_DATA: pluginDataDir,
		};

		// 1. Normal startup SessionStart injects the rule and records staticDedup.
		//    No GC-triggering conditions exist yet, so this run is a plain baseline
		//    that seeds the state the compact-source recovery below depends on.
		const first = spawnSync("bun", ["run", CLI_PATH, "hook", "session-start"], {
			input: JSON.stringify({
				hook_event_name: "SessionStart",
				session_id: sessionId,
				transcript_path: null,
				cwd: projectDir,
				model: "gpt-5",
				permission_mode: "default",
				source: "startup",
			}),
			env: baseEnv,
			encoding: "utf8",
		});
		expect(first.status).toBe(0);
		expect(first.stderr).toBe("");
		const firstParsed = JSON.parse(first.stdout.trim()) as {
			hookSpecificOutput?: { additionalContext?: string };
		};
		expect(firstParsed.hookSpecificOutput?.additionalContext ?? "").toContain("GC_RECOVERY_MARKER");

		// 2. Seed GC-triggering conditions: an aged sibling session-state file (must
		//    be swept given the 1-day TTL override below) and an oversized error.log
		//    (rotateErrorLog derives its sink from homedir() directly, ignoring
		//    PLUGIN_DATA, so it always lives at HOME/.omt/rules-injector/error.log).
		// The GC pre-step in step 1 already touched pluginDataDir's own 24h sweep
		// throttle marker (it runs unconditionally on every SessionStart, even with
		// nothing to sweep), so age that marker back out of the throttle window —
		// otherwise step 3's sweep would be silently skipped and this test would
		// prove nothing about the sweep actually running on the compact-source call.
		age(join(pluginDataDir, "last-swept"), 2 * 24 * 60 * 60 * 1000);

		const staleSiblingPath = join(pluginDataDir, "stale-sibling.json");
		writeFileSync(staleSiblingPath, "{}");
		age(staleSiblingPath, 2 * 24 * 60 * 60 * 1000);

		const errorLogPath = join(tempHome, ".omt", "rules-injector", "error.log");
		mkdirSync(dirname(errorLogPath), { recursive: true });
		writeFileSync(errorLogPath, "x".repeat(50));

		// 3. SessionStart source="compact": no PostCompact ran for this session, so
		//    this takes the arrival-order inversion fallback (staticDedup is still
		//    populated from step 1) and recovers the rule — the real post-compact
		//    recovery path this AC guards. The GC pre-step runs first on this same
		//    call, so this is the exact combination the requirement gap named.
		const recovery = spawnSync("bun", ["run", CLI_PATH, "hook", "session-start"], {
			input: JSON.stringify({
				hook_event_name: "SessionStart",
				session_id: sessionId,
				transcript_path: null,
				cwd: projectDir,
				model: "gpt-5",
				permission_mode: "default",
				source: "compact",
			}),
			env: {
				...baseEnv,
				PI_RULES_SESSION_STATE_TTL_DAYS: "1",
				PI_RULES_ERROR_LOG_MAX_BYTES: "10",
			},
			encoding: "utf8",
		});

		expect(recovery.status).toBe(0);
		expect(recovery.stderr).toBe("");
		const recoveredParsed = JSON.parse(recovery.stdout.trim()) as {
			hookSpecificOutput?: { additionalContext?: string };
		};
		const recoveredContext = recoveredParsed.hookSpecificOutput?.additionalContext ?? "";

		// GC pre-step effects landed: aged sibling swept, oversized error.log
		// truncated.
		expect(existsSync(staleSiblingPath)).toBe(false);
		expect(statSync(errorLogPath).size).toBe(0);

		// Recovery output present and unchanged by the GC pre-step running first.
		expect(recoveredContext).toContain("POST-COMPACTION RULE RECOVERY");
		expect(recoveredContext).toContain(rulePath);
	} finally {
		rmSync(projectDir, { recursive: true, force: true });
	}
});
