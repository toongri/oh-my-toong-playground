import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// HERMETIC HOME: rotateErrorLog derives its sink from node:os homedir(), which
// under Bun is resolved once at process start and does NOT follow a mutation
// of process.env.HOME within the same process (unlike Node). So each test
// spawns a fresh `bun` subprocess with HOME pinned to a temp dir at spawn
// time — the only way to make homedir() observe the override — keeping the
// real ~/.omt/rules-injector/error.log untouched.
const DEBUG_LOG_URL = pathToFileURL(
	join(dirname(fileURLToPath(import.meta.url)), "debug-log.ts"),
).href;

function sinkFor(home: string): string {
	return join(home, ".omt", "rules-injector", "error.log");
}

function runRotate(home: string, maxBytes: number): void {
	const result = spawnSync(
		"bun",
		[
			"-e",
			`const { rotateErrorLog } = await import(${JSON.stringify(DEBUG_LOG_URL)}); rotateErrorLog(${maxBytes});`,
		],
		{ env: { ...process.env, HOME: home }, encoding: "utf-8" },
	);
	if (result.status !== 0) {
		throw new Error(`rotateErrorLog subprocess failed: ${result.stderr}`);
	}
}

test("truncates oversized error.log", () => {
	const home = mkdtempSync(join(tmpdir(), "ri-error-log-"));
	const sink = sinkFor(home);
	mkdirSync(dirname(sink), { recursive: true });
	writeFileSync(sink, "x".repeat(100));
	expect(statSync(sink).size).toBe(100);

	runRotate(home, 10);

	expect(statSync(sink).size).toBe(0);
});

test("rotate leaves under-cap log untouched", () => {
	const home = mkdtempSync(join(tmpdir(), "ri-error-log-"));
	const sink = sinkFor(home);
	mkdirSync(dirname(sink), { recursive: true });
	writeFileSync(sink, "x".repeat(5));
	expect(statSync(sink).size).toBe(5);

	runRotate(home, 10);

	expect(statSync(sink).size).toBe(5);
});

test("rotate error is swallowed", () => {
	// Force a genuine fault: make the sink path itself a directory. statSync
	// succeeds (non-zero size), the size check passes, but writeFileSync on a
	// directory throws EISDIR — rotateErrorLog must swallow it and never throw
	// (the subprocess must still exit 0).
	const home = mkdtempSync(join(tmpdir(), "ri-error-log-"));
	const sink = sinkFor(home);
	mkdirSync(sink, { recursive: true });

	expect(() => runRotate(home, 0)).not.toThrow();
});
