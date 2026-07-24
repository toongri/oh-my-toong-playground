/**
 * Hermetic control tests for the codex-probe CLI — this is AC2's verification
 * surface: pass -> exit 0, fail -> exit 1, unmeasurable -> exit 2 (both the
 * missing/version-mismatched-binary path and the timeout path).
 *
 * Every case here spawns the REAL CLI binary against a STUBBED `codex` on a
 * temp PATH — never the real codex binary (per the plan's "control tests
 * must not spawn real codex repeatedly" constraint). The stub for
 * pass/fail emits byte-exact real captured fixture content (see
 * fixtures/PROVENANCE.md), so these tests exercise the real parsing path
 * against real-shaped bytes, not a hand-typed approximation of it.
 */

import { describe, it, expect, afterEach, spyOn } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

// Aliased: this file already defines its own local `runCli` helper below
// (spawns the CLI as a real subprocess) — `runCliInProcess` is the actual
// exported function, called in-process for the two arms that need to control
// module-level state (Bun.file, Bun.spawn) a child process can't observe.
import { loadProbeSpecFromFile, runCli as runCliInProcess } from "./cli.ts";
import { _resetConfigCache, getRootDir } from "../lib/config.ts";

const CLI_PATH = path.join(import.meta.dirname, "cli.ts");
const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

type Cleanup = () => void;
const cleanups: Cleanup[] = [];

afterEach(() => {
	while (cleanups.length > 0) cleanups.pop()!();
});

function mkdtemp(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/**
 * Builds a stub `codex` binary on a fresh temp dir that: answers `--version`
 * with an allowlisted version, and for `exec --json ...` prints the given
 * fixture's stdout bytes verbatim and exits 0. Also seeds a fake
 * `<codexHome>/sessions/**` rollout file (copied from the fixture pair) so
 * runner.ts's rollout correlation succeeds against the stubbed thread id.
 */
function stubCodexEnvironment(stdoutFixture: string, rolloutFixture: string, threadId: string) {
	const stubDir = mkdtemp("codex-probe-cli-stub-");
	const stdoutPath = path.join(FIXTURES_DIR, stdoutFixture);
	const stubScript = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 0.144.5"
  exit 0
fi
cat "${stdoutPath}"
`;
	fs.writeFileSync(path.join(stubDir, "codex"), stubScript);
	fs.chmodSync(path.join(stubDir, "codex"), 0o755);

	const codexHome = mkdtemp("codex-probe-cli-home-");
	const sessionsDir = path.join(codexHome, "sessions", "2026", "07", "23");
	fs.mkdirSync(sessionsDir, { recursive: true });
	fs.copyFileSync(
		path.join(FIXTURES_DIR, rolloutFixture),
		path.join(sessionsDir, `rollout-2026-07-23T00-00-00-${threadId}.jsonl`),
	);

	return { stubDir, codexHome };
}

function writeSpec(spec: Record<string, unknown>): string {
	const dir = mkdtemp("codex-probe-cli-spec-");
	const specPath = path.join(dir, "spec.json");
	fs.writeFileSync(specPath, JSON.stringify(spec));
	return specPath;
}

async function runCliArgs(args: string[], pathEnv: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	// process.execPath (not the bare word "bun"): a test PATH override for the
	// CHILD's `codex` lookup must not also break the parent's own ability to
	// find the `bun` binary it's about to spawn.
	const proc = Bun.spawn([process.execPath, "run", CLI_PATH, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, PATH: pathEnv },
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout, stderr };
}

function runCli(specPath: string, pathEnv: string) {
	return runCliArgs([specPath], pathEnv);
}

const PONG_THREAD_ID = "019f8d9b-5c62-71d1-a116-90d367ff4213";

// ---------------------------------------------------------------------------
// positive control: pass -> exit 0
// ---------------------------------------------------------------------------

describe("codex-probe CLI / pass", () => {
	// Also serves as arm 4 (positive control) for the "never throws" fix below:
	// a spec with an explicit allowedVersions never reaches the measurement-leg
	// try/catch's throw path, so this must stay exit 0 unmodified by that fix.
	it("exits 0 when the sentinel is observed in a real (stubbed) captured session", async () => {
		const { stubDir, codexHome } = stubCodexEnvironment("pong-stdout.jsonl", "pong-rollout.jsonl", PONG_THREAD_ID);
		const specPath = writeSpec({
			prompt: "irrelevant (stubbed)",
			cwd: os.tmpdir(),
			codexHome,
			allowedVersions: ["0.144.5"],
			sentinel: "PONG",
		});

		const { exitCode, stdout } = await runCli(specPath, `${stubDir}:${process.env.PATH}`);
		expect(exitCode).toBe(0);
		expect(stdout).toContain('"exitCode":0');
	});
});

// ---------------------------------------------------------------------------
// negative control: fail -> exit 1
// ---------------------------------------------------------------------------

describe("codex-probe CLI / fail", () => {
	// Also serves as arm 3 (negative control) for the "never throws" fix below:
	// a genuinely MEASURED negative must stay exit 1, not get swept into the
	// new exit-2 catch — otherwise the fix would be indistinguishable from
	// "route everything to 2".
	it("exits 1 when the sentinel is measured but NOT observed", async () => {
		const { stubDir, codexHome } = stubCodexEnvironment("pong-stdout.jsonl", "pong-rollout.jsonl", PONG_THREAD_ID);
		const specPath = writeSpec({
			prompt: "irrelevant (stubbed)",
			cwd: os.tmpdir(),
			codexHome,
			allowedVersions: ["0.144.5"],
			sentinel: "this text never appears in the fixture",
		});

		const { exitCode, stdout } = await runCli(specPath, `${stubDir}:${process.env.PATH}`);
		expect(exitCode).toBe(1);
		expect(stdout).toContain('"exitCode":1');
	});
});

// ---------------------------------------------------------------------------
// unmeasurable control: exit 2, two distinct routes
// ---------------------------------------------------------------------------

describe("codex-probe CLI / unmeasurable", () => {
	it("exits 2 when codex is absent from PATH", async () => {
		const emptyDir = mkdtemp("codex-probe-cli-empty-path-");
		const specPath = writeSpec({
			prompt: "irrelevant",
			cwd: os.tmpdir(),
			sentinel: "PONG",
		});

		const { exitCode, stdout } = await runCli(specPath, emptyDir);
		expect(exitCode).toBe(2);
		expect(stdout).toContain('"exitCode":2');
		expect(stdout).toContain("codex-binary-missing");
	});

	it("exits 2 on timeout, with an extremely short timeoutMs against a stubbed hanging codex", async () => {
		const stubDir = mkdtemp("codex-probe-cli-hang-");
		// `exec sleep` (not a bare `sleep` line): the shell replaces itself with
		// sleep instead of forking it, so killing the codex process actually
		// terminates the hang instead of leaving an orphaned sleep holding
		// stdout open — see runner.test.ts's identical note.
		fs.writeFileSync(
			path.join(stubDir, "codex"),
			`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 0.144.5"
  exit 0
fi
exec sleep 30
`,
		);
		fs.chmodSync(path.join(stubDir, "codex"), 0o755);

		const specPath = writeSpec({
			prompt: "irrelevant",
			cwd: os.tmpdir(),
			allowedVersions: ["0.144.5"],
			timeoutMs: 200,
			sentinel: "PONG",
		});

		const { exitCode, stdout } = await runCli(specPath, `${stubDir}:${process.env.PATH}`);
		expect(exitCode).toBe(2);
		expect(stdout).toContain("timeout");
	}, 10_000);
});

// ---------------------------------------------------------------------------
// spec validation — a malformed spec is also unmeasurable, not a crash.
// ---------------------------------------------------------------------------

describe("codex-probe CLI / spec validation", () => {
	it("exits 2 with a usage message when no spec path is given", async () => {
		const { exitCode, stderr } = await runCliArgs([], process.env.PATH ?? "");
		expect(exitCode).toBe(2);
		expect(stderr.length).toBeGreaterThan(0);
	});

	it("exits 2 when neither sentinel nor absent is present in the spec", async () => {
		const specPath = writeSpec({ prompt: "x", cwd: os.tmpdir() });
		const { exitCode, stderr } = await runCli(specPath, process.env.PATH ?? "");
		expect(exitCode).toBe(2);
		expect(stderr.length).toBeGreaterThan(0);
	});

	// CONFIRMED defect (code-review): an empty-string sentinel, an empty
	// absent array, or an empty fields array each make the judgment vacuously
	// true regardless of session content (`"".includes("")` is always true;
	// `[].some(...)` is always false; joining zero fields yields "" as the
	// search text) — a typo'd spec must be rejected upstream, not silently
	// produce an always-passing probe.
	describe("CONFIRMED defect — an empty sentinel/absent/fields spec must be rejected, not silently vacuous", () => {
		it("rejects an empty-string sentinel", () => {
			const specPath = writeSpec({ prompt: "x", cwd: os.tmpdir(), sentinel: "" });
			expect(() => loadProbeSpecFromFile(specPath)).toThrow(/sentinel/);
		});

		it("rejects an empty absent array", () => {
			const specPath = writeSpec({ prompt: "x", cwd: os.tmpdir(), absent: [] });
			expect(() => loadProbeSpecFromFile(specPath)).toThrow(/absent/);
		});

		it("rejects an empty fields array even when sentinel/absent are themselves valid", () => {
			const specPath = writeSpec({ prompt: "x", cwd: os.tmpdir(), sentinel: "PONG", fields: [] });
			expect(() => loadProbeSpecFromFile(specPath)).toThrow(/fields/);
		});

		it("still accepts a non-empty sentinel/absent/fields (no false-positive rejection)", () => {
			const sentinelSpec = writeSpec({ prompt: "x", cwd: os.tmpdir(), sentinel: "PONG", fields: ["finalMessage"] });
			expect(() => loadProbeSpecFromFile(sentinelSpec)).not.toThrow();
			const absentSpec = writeSpec({ prompt: "x", cwd: os.tmpdir(), absent: ["X"] });
			expect(() => loadProbeSpecFromFile(absentSpec)).not.toThrow();
		});

		it("the CLI process itself exits 2 (not 0) for an empty-sentinel spec", async () => {
			const specPath = writeSpec({ prompt: "x", cwd: os.tmpdir(), sentinel: "" });
			const { exitCode, stderr } = await runCli(specPath, process.env.PATH ?? "");
			expect(exitCode).toBe(2);
			expect(stderr).toContain("sentinel");
		});
	});

	it("accepts `stderr` in spec.fields (types.ts's ObservationField union member the CLI's own duplicate list previously omitted)", () => {
		const specPath = writeSpec({
			prompt: "x",
			cwd: os.tmpdir(),
			fields: ["stderr"],
			absent: ["missing YAML frontmatter delimited by ---"],
		});

		const { spec } = loadProbeSpecFromFile(specPath);
		if (spec.judgment.kind !== "absent") throw new Error("expected an absent judgment");
		expect(spec.judgment.fields).toEqual(["stderr"]);
	});
});

// ---------------------------------------------------------------------------
// measurement-leg exception routing — runCli's docstring says "never throws",
// but the try around runProbe() used to stop at spec-loading: an exception
// raised while actually MEASURING (config load, spawn, stream read) escaped
// uncaught, producing bun's default unhandled-rejection exit 1 instead of the
// documented exit 2. Both arms below call the real exported `runCli`
// in-process (not the subprocess helper `runCli` above) because they need to
// control module-level state (Bun.file / Bun.spawn) that a spawned child
// process, running its own separate module instance, could never observe.
// ---------------------------------------------------------------------------

describe("codex-probe CLI / measurement-leg exceptions never escape runCli", () => {
	afterEach(() => {
		_resetConfigCache();
	});

	// arm 1 — reproduces the reviewer's exact real repro: allowedVersions
	// omitted from the spec (the documented default path) forces runProbe to
	// call getCodexVersions() -> loadConfig(), which throws on malformed YAML.
	it("exits 2 (not the uncaught-throw exit 1) when allowedVersions is omitted and config.yaml/config.local.yaml is malformed", async () => {
		const specPath = writeSpec({
			prompt: "irrelevant — never reached, the config-load throw fires first",
			cwd: os.tmpdir(),
			sentinel: "PONG",
			// allowedVersions intentionally omitted.
		});

		// Path-aware, not a blanket mockReturnValue: Bun.file is also used
		// internally (e.g. process.stderr's own lazy stream setup calls
		// `Bun.file(fd)`), so an unconditional replacement corrupts unrelated
		// machinery for the rest of this test run. Only the real config.yaml
		// path is intercepted; everything else falls through to the real Bun.file.
		const rootDir = getRootDir();
		if (rootDir === null) throw new Error("test setup: could not resolve the real repo root via config.ts's own getRootDir()");
		const configPath = path.join(rootDir, "config.yaml");
		const originalFile = Bun.file.bind(Bun);
		const spy = spyOn(Bun, "file").mockImplementation(((p: unknown) => {
			if (typeof p === "string" && p === configPath) {
				return { size: 1, text: async () => "{{ not: valid: yaml: [" } as ReturnType<typeof Bun.file>;
			}
			return originalFile(p as never);
		}) as typeof Bun.file);
		_resetConfigCache();

		try {
			const exitCode = await runCliInProcess([specPath]);
			expect(exitCode).toBe(2);
		} finally {
			spy.mockRestore();
			_resetConfigCache();
		}
	});

	// arm 2 — reproduces runner.ts's try{}finally{} (no catch) around the
	// Promise.all reading the spawned process's stdout/stderr/exited: a
	// stream-read failure there used to escape runSession -> runProbe ->
	// runCli uncaught. allowedVersions is supplied explicitly so this arm is
	// isolated from arm 1's config-load throw.
	it("exits 2 (not the uncaught-throw exit 1) when reading the spawned codex process's output streams throws", async () => {
		const specPath = writeSpec({
			prompt: "irrelevant — stdout is never actually read, the mock throws first",
			cwd: os.tmpdir(),
			allowedVersions: ["0.144.5"],
			sentinel: "PONG",
		});

		const spy = spyOn(Bun, "spawn").mockImplementation(((argv: unknown) => {
			const args = argv as string[];
			if (args[1] === "--version") {
				// Environment gate must pass cleanly so the throw below is
				// attributable to runSession's own stream read, not the gate.
				return { stdout: "codex-cli 0.144.5\n", stderr: "", exited: Promise.resolve(0), kill: () => {} } as unknown as Bun.ReadableSubprocess;
			}
			return {
				get stdout(): never {
					throw new Error("stream read exploded (test-injected)");
				},
				stderr: "",
				exited: Promise.resolve(0),
				kill: () => {},
			} as unknown as Bun.ReadableSubprocess;
		}) as typeof Bun.spawn);

		try {
			const exitCode = await runCliInProcess([specPath]);
			expect(exitCode).toBe(2);
		} finally {
			spy.mockRestore();
		}
	});
});
