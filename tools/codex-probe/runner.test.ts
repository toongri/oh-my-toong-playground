import { describe, it, expect, afterEach, spyOn } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import {
	parseStdoutEvents,
	extractToolCalls,
	extractFinalMessage,
	extractThreadId,
	parseBaseInstructions,
	parseInjectedContext,
	checkCodexEnvironment,
	findRolloutFile,
	runSession,
} from "./runner.ts";
import { getCodexVersions } from "../lib/config.ts";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");
const PONG_STDOUT = fs.readFileSync(path.join(FIXTURES_DIR, "pong-stdout.jsonl"), "utf-8");
const PONG_ROLLOUT = fs.readFileSync(path.join(FIXTURES_DIR, "pong-rollout.jsonl"), "utf-8");
const TOOLCALL_STDOUT = fs.readFileSync(path.join(FIXTURES_DIR, "toolcall-stdout.jsonl"), "utf-8");
const TOOLCALL_ROLLOUT = fs.readFileSync(path.join(FIXTURES_DIR, "toolcall-rollout.jsonl"), "utf-8");

// ---------------------------------------------------------------------------
// parseStdoutEvents — pure JSONL parsing of real captured `codex exec --json`
// stdout (see fixtures/PROVENANCE.md for exact capture commands).
// ---------------------------------------------------------------------------

describe("parseStdoutEvents", () => {
	it("parses every line of a real text-only-response stdout capture into an event object", () => {
		const events = parseStdoutEvents(PONG_STDOUT);
		expect(events).not.toBeNull();
		expect(events!.length).toBe(4);
		expect(events![0]).toMatchObject({ type: "thread.started" });
	});

	it("returns null when a line is not valid JSON (measurement-unable signal, not a throw)", () => {
		expect(parseStdoutEvents('{"type":"thread.started"}\nnot json\n')).toBeNull();
	});

	it("skips blank lines", () => {
		const events = parseStdoutEvents('{"type":"a"}\n\n{"type":"b"}\n');
		expect(events).toEqual([{ type: "a" }, { type: "b" }]);
	});
});

// ---------------------------------------------------------------------------
// extractThreadId
// ---------------------------------------------------------------------------

describe("extractThreadId", () => {
	it("extracts the thread id from a real `thread.started` event", () => {
		const events = parseStdoutEvents(PONG_STDOUT)!;
		expect(extractThreadId(events)).toBe("019f8d9b-5c62-71d1-a116-90d367ff4213");
	});

	it("returns null when no thread.started event is present", () => {
		expect(extractThreadId([{ type: "turn.started" }])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// extractFinalMessage
// ---------------------------------------------------------------------------

describe("extractFinalMessage", () => {
	it("extracts the agent's final message text from a real text-only-response capture", () => {
		const events = parseStdoutEvents(PONG_STDOUT)!;
		expect(extractFinalMessage(events)).toBe("PONG");
	});

	it("extracts the LAST agent_message when a tool call produced an earlier one (real multi-message capture)", () => {
		const events = parseStdoutEvents(TOOLCALL_STDOUT)!;
		expect(extractFinalMessage(events)).toContain("hello world");
	});

	it("returns null when no agent_message item is present", () => {
		expect(extractFinalMessage([{ type: "turn.started" }])).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// extractToolCalls
// ---------------------------------------------------------------------------

describe("extractToolCalls", () => {
	it("extracts zero tool calls from a real text-only-response capture", () => {
		const events = parseStdoutEvents(PONG_STDOUT)!;
		expect(extractToolCalls(events)).toEqual([]);
	});

	it("extracts the real command_execution item from a real tool-call capture, with its command argument intact", () => {
		const events = parseStdoutEvents(TOOLCALL_STDOUT)!;
		const toolCalls = extractToolCalls(events);
		expect(toolCalls.length).toBeGreaterThan(0);
		const commandCall = toolCalls.find((t) => t.itemType === "command_execution");
		expect(commandCall).toBeDefined();
		expect(String(commandCall!.item.command)).toContain("sample.txt");
	});

	it("does not classify agent_message items as tool calls", () => {
		const events = parseStdoutEvents(TOOLCALL_STDOUT)!;
		const toolCalls = extractToolCalls(events);
		expect(toolCalls.every((t) => t.itemType !== "agent_message")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// parseBaseInstructions — the channel story 5's probe needs (injected bytes,
// not model output).
// ---------------------------------------------------------------------------

describe("parseBaseInstructions", () => {
	it("extracts the real injected base_instructions text from a real rollout file", () => {
		const text = parseBaseInstructions(PONG_ROLLOUT);
		expect(text).not.toBeNull();
		expect(text).toContain("Codex");
	});

	it("extracts base_instructions from the tool-call rollout fixture too", () => {
		const text = parseBaseInstructions(TOOLCALL_ROLLOUT);
		expect(text).not.toBeNull();
	});

	it("returns null when no session_meta record is present", () => {
		expect(parseBaseInstructions('{"type":"event_msg","payload":{}}\n')).toBeNull();
	});

	it("returns null when session_meta is present but base_instructions.text is missing", () => {
		expect(parseBaseInstructions('{"type":"session_meta","payload":{}}\n')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// parseInjectedContext — CONFIRMED-defect fix: base_instructions alone
// cannot see per-session injected content (project rules, AGENTS.md), which
// only ever appears as a `response_item` message with role "developer" or
// "user". See evaluate.test.ts's "catches a literal that leaked into the
// injected developer/user context" regression test for the exit-code-level
// consequence.
// ---------------------------------------------------------------------------

describe("parseInjectedContext", () => {
	it("extracts developer-role response_item text from a real rollout — this repo's own injected coding-discipline rules, verified present via `grep -c TaskCreate fixtures/toolcall-rollout.jsonl` -> 1", () => {
		const text = parseInjectedContext(TOOLCALL_ROLLOUT);
		expect(text).toContain("TaskCreate");
		expect(text).toContain("TaskOutput");
		expect(text).toContain("subagent_type");
	});

	it("extracts user-role response_item text too (AGENTS.md content is injected as a user-role message, verified in the real fixture)", () => {
		const text = parseInjectedContext(TOOLCALL_ROLLOUT);
		expect(text).toContain("AGENTS.md instructions");
	});

	it("does NOT include assistant-role response_item text (the model's own output, not injected content)", () => {
		// The real final agent_message text from toolcall-stdout.jsonl's last
		// item — must not leak in via the assistant's own response_item echo.
		const text = parseInjectedContext(TOOLCALL_ROLLOUT);
		expect(text).not.toContain("정확한 내용은 다음과 같습니다");
	});

	it("returns the real leaked literal from the pong fixture too (trivial text-only session still carries developer-injected rules)", () => {
		const text = parseInjectedContext(PONG_ROLLOUT);
		expect(text).toContain("TaskCreate");
	});

	it("returns an empty string (not null) when no session_meta/response_item is present", () => {
		expect(parseInjectedContext('{"type":"event_msg","payload":{}}\n')).toBe("");
	});

	it("skips a response_item whose role is neither developer nor user (e.g. assistant, reasoning)", () => {
		const raw = `${JSON.stringify({ type: "response_item", payload: { role: "assistant", content: [{ type: "output_text", text: "MODEL_OWN_TEXT" }] } })}\n`;
		expect(parseInjectedContext(raw)).toBe("");
	});
});

// ---------------------------------------------------------------------------
// checkCodexEnvironment — the environment gate (AC: exit 2 on missing/
// disallowed binary). Hermetic via a temp-PATH stub, mirroring
// tools/lib/codex-version.test.ts's established negative-control technique.
// ---------------------------------------------------------------------------

describe("checkCodexEnvironment", () => {
	const originalPath = process.env.PATH;

	afterEach(() => {
		process.env.PATH = originalPath;
	});

	it("positive control: the real installed codex passes against the real config.yaml allowlist", async () => {
		// No hardcoded version list: reads config.yaml's real `codex-versions`
		// via the same getCodexVersions() the production path
		// (assertCodexVersionIfTargeted) uses, so this test tracks the real
		// allowlist instead of going stale as codex auto-upgrades.
		const allowedVersions = await getCodexVersions();
		const result = await checkCodexEnvironment(allowedVersions);
		expect(result).toEqual({ ok: true });
	});

	it("reports codex-version-not-allowlisted for a stubbed codex outside the allowlist", async () => {
		const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-env-test-"));
		const stubPath = path.join(stubDir, "codex");
		fs.writeFileSync(stubPath, "#!/bin/sh\necho 'codex-cli 9.9.9'\n");
		fs.chmodSync(stubPath, 0o755);
		process.env.PATH = `${stubDir}:${originalPath}`;

		const result = await checkCodexEnvironment(["0.144.1"]);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("codex-version-not-allowlisted");
			expect(result.detail).toContain("9.9.9");
		}
		fs.rmSync(stubDir, { recursive: true, force: true });
	});

	it("reports codex-binary-missing when codex is not on PATH", async () => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-empty-path-"));
		process.env.PATH = emptyDir;

		const result = await checkCodexEnvironment(["0.144.1"]);
		expect(result).toEqual({
			ok: false,
			reason: "codex-binary-missing",
			detail: expect.any(String),
		});
		fs.rmSync(emptyDir, { recursive: true, force: true });
	});

	// Reproduces the sibling defect to runSession's own try{}finally{}-without-
	// catch (below): checkCodexEnvironment's `--version` stream read used to
	// sit outside its own try, so a read failure escaped as an uncaught throw
	// instead of the EnvironmentCheckResult this function's return type
	// promises. Hermetic via a Bun.spawn mock — a broken pipe on a real
	// process isn't reproducible on demand.
	it("returns codex-binary-missing (not a throw) when reading the spawned process's stdout fails", async () => {
		const spy = spyOn(Bun, "spawn").mockImplementation((() => {
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
			const result = await checkCodexEnvironment(["0.144.1"]);
			expect(result).toEqual({
				ok: false,
				reason: "codex-binary-missing",
				detail: expect.any(String),
			});
		} finally {
			spy.mockRestore();
		}
	});
});

// ---------------------------------------------------------------------------
// findRolloutFile — correlates a thread_id to its rollout file under
// <codexHome>/sessions/**, hermetic against a temp codexHome fixture tree.
// ---------------------------------------------------------------------------

describe("findRolloutFile", () => {
	it("finds a rollout file nested under a date-partitioned temp codexHome by thread id suffix", async () => {
		const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-home-"));
		const sessionsDir = path.join(codexHome, "sessions", "2026", "07", "23");
		fs.mkdirSync(sessionsDir, { recursive: true });
		const target = path.join(sessionsDir, "rollout-2026-07-23T00-00-00-abc-123.jsonl");
		fs.writeFileSync(target, "{}\n");

		const found = await findRolloutFile("abc-123", codexHome);
		expect(found).toBe(target);
		fs.rmSync(codexHome, { recursive: true, force: true });
	});

	it("returns null when no rollout file matches the thread id", async () => {
		const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-home-empty-"));
		fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });

		const found = await findRolloutFile("nonexistent-thread-id", codexHome);
		expect(found).toBeNull();
		fs.rmSync(codexHome, { recursive: true, force: true });
	});
});

// ---------------------------------------------------------------------------
// runSession — full orchestration. Hermetic control cases (timeout, missing
// binary) via a temp-PATH stub; the real-codex leg is proven separately by
// the fixture captures documented in fixtures/PROVENANCE.md, not re-run here
// (AC: control tests must not spawn real codex repeatedly).
// ---------------------------------------------------------------------------

describe("runSession", () => {
	const originalPath = process.env.PATH;

	afterEach(() => {
		process.env.PATH = originalPath;
	});

	it("returns codex-binary-missing without spawning anything when codex is absent from PATH", async () => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-runsession-nobin-"));
		process.env.PATH = emptyDir;

		const result = await runSession(
			{ prompt: "irrelevant", cwd: os.tmpdir() },
			{ allowedVersions: ["0.144.1"] },
		);
		expect(result).toEqual({
			ok: false,
			reason: "codex-binary-missing",
			detail: expect.any(String),
		});
		fs.rmSync(emptyDir, { recursive: true, force: true });
	});

	it("returns timeout when the codex process does not exit within timeoutMs (hermetic via a stubbed sleeping codex)", async () => {
		const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-runsession-timeout-"));
		const stubPath = path.join(stubDir, "codex");
		// `exec sleep` (not a bare `sleep` line) so the shell replaces itself
		// with sleep instead of forking it as a child — a bare fork would leave
		// an orphaned `sleep` holding the stdout pipe open after proc.kill()
		// terminates only the shell, hanging the test even though the runner's
		// own timeout logic fired correctly. Real codex is a single process
		// (no shell-fork wrapper), so this mirrors what kill() actually faces.
		fs.writeFileSync(
			stubPath,
			`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 0.144.1"
  exit 0
fi
exec sleep 30
`,
		);
		fs.chmodSync(stubPath, 0o755);
		process.env.PATH = `${stubDir}:${originalPath}`;

		const result = await runSession(
			{ prompt: "irrelevant", cwd: os.tmpdir(), timeoutMs: 200 },
			{ allowedVersions: ["0.144.1"] },
		);
		expect(result).toEqual({ ok: false, reason: "timeout", detail: expect.any(String) });
		fs.rmSync(stubDir, { recursive: true, force: true });
	}, 10_000);

	it("captures stderr text into the Observation (hermetic stub — proves the piped stderr fd is actually consumed, not just spawned)", async () => {
		const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-runsession-stderr-"));
		const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-runsession-stderr-home-"));
		const threadId = "stub-thread-id-stderr";
		fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
		fs.writeFileSync(
			path.join(codexHome, "sessions", `${threadId}.jsonl`),
			`${JSON.stringify({ type: "session_meta", payload: { base_instructions: { text: "stub instructions" } } })}\n`,
		);

		const stubPath = path.join(stubDir, "codex");
		fs.writeFileSync(
			stubPath,
			`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 0.144.1"
  exit 0
fi
echo '{"type":"thread.started","thread_id":"${threadId}"}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}'
echo "diagnostic: missing YAML frontmatter delimited by ---" >&2
exit 0
`,
		);
		fs.chmodSync(stubPath, 0o755);
		process.env.PATH = `${stubDir}:${originalPath}`;

		const result = await runSession(
			{ prompt: "irrelevant", cwd: os.tmpdir() },
			{ allowedVersions: ["0.144.1"], codexHome },
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.observation.stderr).toContain("missing YAML frontmatter delimited by ---");
		}
		fs.rmSync(stubDir, { recursive: true, force: true });
		fs.rmSync(codexHome, { recursive: true, force: true });
	});

	// config.env (SessionConfig.env): merges onto process.env for the spawned
	// process rather than replacing it — a probe isolating HOME/CODEX_HOME
	// (see probes/ultrawork-keyword-injection, probes/rules-runtime-leak-absence)
	// still needs PATH to resolve the `codex` binary via the SAME PATH lookup
	// checkCodexEnvironment already used. Hermetic stub: the codex stub reads
	// a custom env var and echoes it into the agent_message, so the assertion
	// proves the child process actually RECEIVED the merged var — not just
	// that config.env was accepted without error.
	it("merges config.env onto process.env for the spawned process (custom var reaches the child; PATH from process.env still resolves the stub)", async () => {
		const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-runsession-env-"));
		const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-runsession-env-home-"));
		const threadId = "stub-thread-id-env";
		fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
		fs.writeFileSync(
			path.join(codexHome, "sessions", `${threadId}.jsonl`),
			`${JSON.stringify({ type: "session_meta", payload: { base_instructions: { text: "stub instructions" } } })}\n`,
		);

		const stubPath = path.join(stubDir, "codex");
		fs.writeFileSync(
			stubPath,
			`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 0.144.1"
  exit 0
fi
echo '{"type":"thread.started","thread_id":"${threadId}"}'
echo "{\\"type\\":\\"item.completed\\",\\"item\\":{\\"type\\":\\"agent_message\\",\\"text\\":\\"saw:$CODEX_PROBE_TEST_VAR\\"}}"
exit 0
`,
		);
		fs.chmodSync(stubPath, 0o755);
		process.env.PATH = `${stubDir}:${originalPath}`;

		const result = await runSession(
			{ prompt: "irrelevant", cwd: os.tmpdir(), env: { CODEX_PROBE_TEST_VAR: "isolated-value" } },
			{ allowedVersions: ["0.144.1"], codexHome },
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.observation.finalMessage).toBe("saw:isolated-value");
		}
		fs.rmSync(stubDir, { recursive: true, force: true });
		fs.rmSync(codexHome, { recursive: true, force: true });
	});

	// CONFIRMED defect (code-review): config.env used to be layered ON TOP of a
	// full `...process.env` spread, so a probe requesting HOME/CODEX_HOME
	// isolation (config.env: {HOME, CODEX_HOME}) still silently inherited every
	// OTHER ambient var from this developer machine's shell — env vars the
	// isolation was specifically meant to strip (CODEX_RULES_ENABLED_SOURCES,
	// CODEX_RULES_MAX_RULE_CHARS, OMT_DIR, XDG_*, CLAUDE_CONFIG_DIR, ...). Fix:
	// when config.env is set, spawnEnv is built from an explicit allowlist
	// (PATH, TMPDIR) plus config.env, not the full process.env. Hermetic stub:
	// the codex stub echoes an AMBIENT (non-allowlisted, non-config.env) var
	// into the agent_message, proving whether the child actually received it.
	it("does NOT leak an arbitrary ambient process.env var through to the spawned process when config.env is set (allowlist, not full inheritance)", async () => {
		const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-runsession-envleak-"));
		const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-probe-runsession-envleak-home-"));
		const threadId = "stub-thread-id-envleak";
		fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
		fs.writeFileSync(
			path.join(codexHome, "sessions", `${threadId}.jsonl`),
			`${JSON.stringify({ type: "session_meta", payload: { base_instructions: { text: "stub instructions" } } })}\n`,
		);

		const stubPath = path.join(stubDir, "codex");
		fs.writeFileSync(
			stubPath,
			`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 0.144.1"
  exit 0
fi
echo '{"type":"thread.started","thread_id":"${threadId}"}'
echo "{\\"type\\":\\"item.completed\\",\\"item\\":{\\"type\\":\\"agent_message\\",\\"text\\":\\"leaked:$CODEX_PROBE_AMBIENT_LEAK_VAR\\"}}"
exit 0
`,
		);
		fs.chmodSync(stubPath, 0o755);
		process.env.PATH = `${stubDir}:${originalPath}`;
		process.env.CODEX_PROBE_AMBIENT_LEAK_VAR = "should-not-reach-child";

		try {
			const result = await runSession(
				{ prompt: "irrelevant", cwd: os.tmpdir(), env: { HOME: "/isolated/fake/home" } },
				{ allowedVersions: ["0.144.1"], codexHome },
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.observation.finalMessage).toBe("leaked:");
			}
		} finally {
			delete process.env.CODEX_PROBE_AMBIENT_LEAK_VAR;
			fs.rmSync(stubDir, { recursive: true, force: true });
			fs.rmSync(codexHome, { recursive: true, force: true });
		}
	});

	// Reproduces the CONFIRMED defect: the try{}finally{} around this
	// function's own Promise.all (reading the `exec` process's stdout/stderr/
	// exited) had no catch, so a stream-read failure escaped as an uncaught
	// throw instead of the RunResult this function's return type promises.
	// Hermetic via a Bun.spawn mock: the version-check spawn succeeds cleanly
	// (isolating this from checkCodexEnvironment's own, separately-tested,
	// stream-read guard) and only the `exec` spawn's stdout throws on access.
	it("returns spawn-failed (not a throw) when reading the exec process's output streams throws", async () => {
		const spy = spyOn(Bun, "spawn").mockImplementation(((argv: unknown) => {
			const args = argv as string[];
			if (args[1] === "--version") {
				return { stdout: "codex-cli 0.144.1\n", stderr: "", exited: Promise.resolve(0), kill: () => {} } as unknown as Bun.ReadableSubprocess;
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
			const result = await runSession({ prompt: "irrelevant", cwd: os.tmpdir() }, { allowedVersions: ["0.144.1"] });
			expect(result).toEqual({ ok: false, reason: "spawn-failed", detail: expect.any(String) });
		} finally {
			spy.mockRestore();
		}
	});
});
