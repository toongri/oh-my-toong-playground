import { test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
