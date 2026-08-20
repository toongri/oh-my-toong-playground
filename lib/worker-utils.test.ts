import { describe, it, test, expect, beforeEach, afterEach } from "bun:test";
import {
	mkdirSync,
	rmSync,
	readFileSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	writeFileSync,
	appendFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EventEmitter } from "events";
import { spawn as spawnChild, execSync } from "child_process";
// reapOwnProcessGroup는 여기서 직접 import하지 않는다 — 자기 프로세스 그룹을
// 대상으로 동작해 인프로세스 호출이 불가능하므로, 하단 "reapOwnProcessGroup"
// describe 블록이 절대 경로(WORKER_UTILS_ABS_PATH)로 별도 스크립트에서 import해
// 자식 프로세스 하니스로 검증한다.
import {
	splitCommand,
	atomicWriteJson,
	assemblePrompt,
	runOnce,
	runOneTurn,
	resumeOneTurn,
	type RunOnceOpts,
	type RunOneTurnOpts,
} from "./worker-utils.ts";
import type { AgentDriver, ParseResult, CliType } from "./agent-drivers/types.ts";

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "worker-utils-test-"));
}

function sleepMsAsync(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// 실제 프로세스를 띄우는 테스트들의 시간 상한. 이 값들은 "얼마나 기다렸다가
// 실패를 선언하는가"만 정하며 단언을 전혀 완화하지 않는다 — 마커가 끝내 안
// 나타나거나 프로세스가 끝내 안 죽으면 그대로 실패한다. 상한을 넉넉히 두는
// 이유는 여기서 기다리는 대상이 bun 프로세스 기동이고, 전체 스위트를 돌릴 때
// 워커들이 코어를 다투면서 단일 테스트가 5.8초까지 늘어난 것이 실측됐기 때문
// 이다. 3~4초짜리 상한은 그 부하 아래에서 결함이 아니라 부하 때문에 터진다.
const SPAWN_MARKER_DEADLINE_MS = 30_000;
const REAP_OBSERVE_DEADLINE_MS = 30_000;
const PROCESS_GROUP_TEST_TIMEOUT_MS = 120_000;

describe("splitCommand", () => {
	test("splits a simple command", () => {
		expect(splitCommand("echo hello world")).toEqual(["echo", "hello", "world"]);
	});

	test("handles single-quoted arguments", () => {
		expect(splitCommand("echo 'hello world'")).toEqual(["echo", "hello world"]);
	});

	test("handles double-quoted arguments", () => {
		expect(splitCommand('echo "hello world"')).toEqual(["echo", "hello world"]);
	});

	test("handles escaped characters", () => {
		expect(splitCommand("echo hello\\ world")).toEqual(["echo", "hello world"]);
	});

	test("returns null for unmatched single quote", () => {
		expect(splitCommand("echo 'hello")).toBe(null);
	});

	test("returns null for unmatched double quote", () => {
		expect(splitCommand('echo "hello')).toBe(null);
	});

	test("returns empty array for empty string", () => {
		expect(splitCommand("")).toEqual([]);
	});

	test("returns empty array for null/undefined", () => {
		expect(splitCommand(null as any)).toEqual([]);
		expect(splitCommand(undefined as any)).toEqual([]);
	});

	test("handles multiple spaces between tokens", () => {
		expect(splitCommand("a   b   c")).toEqual(["a", "b", "c"]);
	});
});

// ---------------------------------------------------------------------------
// atomicWriteJson
// ---------------------------------------------------------------------------

describe("atomicWriteJson", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("writes valid JSON to the target path", () => {
		const fp = join(tmpDir, "test.json");
		const payload = { member: "gpt-4", state: "done" };
		atomicWriteJson(fp, payload);
		const result = JSON.parse(readFileSync(fp, "utf8"));
		expect(result).toEqual(payload);
	});

	test("overwrites existing file", () => {
		const fp = join(tmpDir, "test.json");
		atomicWriteJson(fp, { v: 1 });
		atomicWriteJson(fp, { v: 2 });
		const result = JSON.parse(readFileSync(fp, "utf8"));
		expect(result.v).toBe(2);
	});

	test("leaves no tmp files behind", () => {
		const fp = join(tmpDir, "test.json");
		atomicWriteJson(fp, { ok: true });
		const files = readdirSync(tmpDir);
		expect(files).toEqual(["test.json"]);
	});
});

// ---------------------------------------------------------------------------
// sleepMsAsync
// ---------------------------------------------------------------------------

describe("assemblePrompt", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("returns structured prompt with REVIEW CONTENT when role file exists and reviewContent provided", () => {
		const roleContent = "# Claude Role\nYou are a helpful assistant.";
		writeFileSync(join(tmpDir, "claude.md"), roleContent, "utf8");

		const result = assemblePrompt({
			promptsDir: tmpDir,
			entityName: "claude",
			rawPrompt: "Analyze the code",
			reviewContent: "function foo() { return 42; }",
		});

		expect(result.isStructured).toBe(true);
		expect(result.assembled.includes("<system-instructions>")).toBe(true);
		expect(result.assembled.includes(roleContent)).toBe(true);
		expect(result.assembled.includes("--- REVIEW CONTENT ---")).toBe(true);
		expect(result.assembled.includes("function foo() { return 42; }")).toBe(true);
		expect(result.assembled.includes("--- END REVIEW CONTENT ---")).toBe(true);
		expect(result.assembled.includes("[HEADLESS SESSION]")).toBe(true);
		expect(result.assembled.includes("Analyze the code")).toBe(true);
	});

	test("returns structured prompt without REVIEW CONTENT when role file exists and no reviewContent", () => {
		const roleContent = "# Codex Role\nYou are an expert reviewer.";
		writeFileSync(join(tmpDir, "codex.md"), roleContent, "utf8");

		const result = assemblePrompt({
			promptsDir: tmpDir,
			entityName: "codex",
			rawPrompt: "Review this PR",
		});

		expect(result.isStructured).toBe(true);
		expect(result.assembled.includes("<system-instructions>")).toBe(true);
		expect(result.assembled.includes(roleContent)).toBe(true);
		expect(!result.assembled.includes("--- REVIEW CONTENT ---")).toBe(true);
		expect(result.assembled.includes("[HEADLESS SESSION]")).toBe(true);
		expect(result.assembled.includes("Review this PR")).toBe(true);
	});

	test("returns unstructured fallback when role file is absent", () => {
		// No role file created in tmpDir
		const result = assemblePrompt({
			promptsDir: tmpDir,
			entityName: "nonexistent",
			rawPrompt: "Just do the thing",
		});

		expect(result.isStructured).toBe(false);
		expect(result.assembled).toBe("Just do the thing");
	});

	test("returns unstructured fallback when role file is absent even with reviewContent", () => {
		// No role file, but reviewContent provided - still falls back
		const result = assemblePrompt({
			promptsDir: tmpDir,
			entityName: "missing-model",
			rawPrompt: "Analyze it",
			reviewContent: "some review content",
		});

		expect(result.isStructured).toBe(false);
		expect(result.assembled).toBe("Analyze it");
	});

	test("uses prompts/default.md as framework default when fallbackFile is not specified", () => {
		// default.md exists, no per-member file, no explicit fallbackFile → framework default applies
		const defaultContent = "# Default Role\nYou are a default assistant.";
		writeFileSync(join(tmpDir, "default.md"), defaultContent, "utf8");

		const result = assemblePrompt({
			promptsDir: tmpDir,
			entityName: "nonexistent-member",
			rawPrompt: "Do something",
		});

		expect(result.isStructured).toBe(true);
		expect(result.assembled.includes(defaultContent)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

describe("runOnce heartbeat", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "worker-heartbeat-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeRunOnceOpts(overrides: Partial<RunOnceOpts> = {}): RunOnceOpts {
		const memberDir = join(tmpDir, "member");
		mkdirSync(memberDir, { recursive: true });
		return {
			program: "/bin/sh",
			args: ["-c", "sleep 1"],
			prompt: "test prompt",
			member: "test-member",
			memberDir,
			command: '/bin/sh -c "sleep 1"',
			timeoutSec: 10,
			attempt: 0,
			heartbeatIntervalMs: 50,
			...overrides,
		};
	}

	test("실행 중에 status.json에 lastHeartbeat을 기록함", async () => {
		const opts = makeRunOnceOpts();
		const statusPath = join(opts.memberDir, "status.json");

		const promise = runOnce(opts);

		// Wait for at least 2 heartbeat cycles to fire
		await sleepMsAsync(200);

		const status = JSON.parse(readFileSync(statusPath, "utf8"));
		expect(status.lastHeartbeat).toBeDefined();
		// lastHeartbeat should be a valid ISO8601 timestamp
		expect(() => new Date(status.lastHeartbeat as string).toISOString()).not.toThrow();
		// Other fields should still be present
		expect(status.member).toBe("test-member");
		expect(status.state).toBe("running");

		await promise;
	});

	// RED (pre-fix): `finalize` wrote the terminal state straight to status.json, so a reader
	// polling in the window between "child died" and "executeOneTurn parsed output.txt and
	// wrote its own final status" (buildManifest's isReadable check, cmdCollect, cmdStop) saw
	// state:"done" while output.txt still held the raw, unparsed stdout.
	// GREEN (post-fix): `finalize`'s resolved value (runResult, consumed by executeOneTurn)
	// still carries the real terminal state, but the disk write during this window stays
	// state:"running" — a state generic-job.ts's computeStatus already knows how to reclaim
	// via heartbeat staleness if the caller crashes before its own final write.
	test("`finalize` 직후 status.json은 running — 파싱 전 terminal 노출 안 됨", async () => {
		const opts = makeRunOnceOpts({
			args: ["-c", "exit 0"],
			command: '/bin/sh -c "exit 0"',
		});
		const statusPath = join(opts.memberDir, "status.json");

		const result = await runOnce(opts);

		// runOnce's resolved value (what executeOneTurn reads as runResult.state) is unchanged.
		expect(result.state).toBe("done");

		// The disk write `finalize` just performed must NOT be terminal yet.
		const statusAfterFinalize = JSON.parse(readFileSync(statusPath, "utf8"));
		expect(statusAfterFinalize.state).not.toBe("done");
		expect(statusAfterFinalize.state).toBe("running");

		// Wait for multiple heartbeat cycles that would fire if interval leaked
		await sleepMsAsync(200);

		// status.json should still not have lastHeartbeat (heartbeat interval was cleared by finalize)
		const statusAfterWait = JSON.parse(readFileSync(statusPath, "utf8"));
		expect(statusAfterWait.lastHeartbeat).toBeUndefined();
		expect(statusAfterWait.state).toBe("running");
	});

	test("state가 running이 아닌 경우 heartbeat가 status.json을 덮어쓰지 않음", async () => {
		const opts = makeRunOnceOpts({
			args: ["-c", "sleep 0.5"],
			command: '/bin/sh -c "sleep 0.5"',
		});
		const statusPath = join(opts.memberDir, "status.json");

		const promise = runOnce(opts);

		// Wait for heartbeat to start writing
		await sleepMsAsync(150);

		// Manually overwrite status.json with a terminal state (simulating external finalize)
		const terminalPayload = { member: "test-member", state: "done", exitCode: 0 };
		writeFileSync(statusPath, JSON.stringify(terminalPayload));

		// Wait for additional heartbeat cycles
		await sleepMsAsync(200);

		// status.json should remain the terminal state — heartbeat guard skipped the write
		const statusAfterWait = JSON.parse(readFileSync(statusPath, "utf8"));
		expect(statusAfterWait.state).toBe("done");
		expect(statusAfterWait.lastHeartbeat).toBeUndefined();

		await promise;
	});
});

// ---------------------------------------------------------------------------
// runOnce 환경 변수 전파
// ---------------------------------------------------------------------------

function createCapturingSpawnFn() {
	const captured: { env?: Record<string, string> } = {};
	const mockSpawn = (_program: string, _args: string[], options: any) => {
		captured.env = options?.env;
		const child = new EventEmitter();
		const stdin = { write: () => true, end: () => {}, on: () => stdin } as any;
		(child as any).stdin = stdin;
		(child as any).stdout = null;
		(child as any).stderr = null;
		(child as any).pid = 12345;
		process.nextTick(() => {
			child.emit("exit", 0, null);
			process.nextTick(() => child.emit("close", 0, null));
		});
		return child as any;
	};
	return { mockSpawn, captured };
}

describe("runOnce 환경 변수 전파", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "worker-env-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeEnvTestOpts(overrides: Partial<RunOnceOpts> = {}): RunOnceOpts {
		const memberDir = join(tmpDir, "member");
		mkdirSync(memberDir, { recursive: true });
		return {
			program: "/bin/sh",
			args: ["-c", "exit 0"],
			prompt: "test prompt",
			member: "test-member",
			memberDir,
			command: '/bin/sh -c "exit 0"',
			timeoutSec: 10,
			attempt: 0,
			...overrides,
		};
	}

	it("NO_COLOR=1 전파 확인", async () => {
		const { mockSpawn, captured } = createCapturingSpawnFn();
		const opts = makeEnvTestOpts({ spawnFn: mockSpawn as any });
		await runOnce(opts);
		expect(captured.env?.NO_COLOR).toBe("1");
	});

	it("TERM=dumb 전파 확인", async () => {
		const { mockSpawn, captured } = createCapturingSpawnFn();
		const opts = makeEnvTestOpts({ spawnFn: mockSpawn as any });
		await runOnce(opts);
		expect(captured.env?.TERM).toBe("dumb");
	});

	it("FORCE_COLOR=0 전파 확인", async () => {
		const { mockSpawn, captured } = createCapturingSpawnFn();
		const opts = makeEnvTestOpts({ spawnFn: mockSpawn as any });
		await runOnce(opts);
		expect(captured.env?.FORCE_COLOR).toBe("0");
	});

	it("workerEnv가 NO_COLOR override 가능", async () => {
		const { mockSpawn, captured } = createCapturingSpawnFn();
		const opts = makeEnvTestOpts({ spawnFn: mockSpawn as any, workerEnv: { NO_COLOR: "" } });
		await runOnce(opts);
		expect(captured.env?.NO_COLOR).toBe("");
	});
});

// ---------------------------------------------------------------------------
// retry 시 output 정제
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// runOneTurn / resumeOneTurn helpers
// ---------------------------------------------------------------------------

function makeOneTurnMockRunOnce(rawStdout: string, exitCode: number = 0) {
	const fn = async (opts: RunOnceOpts): Promise<Record<string, unknown>> => {
		writeFileSync(join(opts.memberDir, "output.txt"), rawStdout);
		writeFileSync(join(opts.memberDir, "error.txt"), "");
		const state = exitCode === 0 ? "done" : "error";
		return { state, exitCode, member: opts.member, command: opts.command, attempt: 0 };
	};
	return fn;
}

function makeOneTurnMockDriver(parseResult: ParseResult | null): AgentDriver & {
	spy: { calls: import("./agent-drivers/types.ts").ResumeCommandOpts[][] };
} {
	const spy = { calls: [] as import("./agent-drivers/types.ts").ResumeCommandOpts[][] };
	return {
		cli: "opencode",
		parseStdout: (_stdout: string) => parseResult,
		initialCommand: (opts) => ({
			program: opts.baseCommand,
			args: opts.baseArgs,
			env: opts.workerEnv,
		}),
		resumeCommand: (opts) => {
			spy.calls.push([opts]);
			return {
				program: opts.baseCommand,
				args: [...opts.baseArgs, "--resume", opts.sessionID],
				env: opts.workerEnv,
			};
		},
		spy,
	};
}

function makeOneTurnOpts(
	memberDir: string,
	overrides: Partial<RunOneTurnOpts> = {},
): RunOneTurnOpts {
	return {
		program: "opencode",
		args: ["--format", "json"],
		prompt: "test prompt",
		member: "test-member",
		memberDir,
		command: "opencode --format json",
		timeoutSec: 10,
		cliType: "opencode" as CliType,
		workerEnv: {},
		...overrides,
	};
}

describe("runOneTurn / resumeOneTurn — caller-judgment single-turn pump", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "one-turn-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// AC-A1: state='done' on exit 0
	test("runOneTurn state done", async () => {
		const memberDir = join(tmpDir, "a1");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_a1",
			terminal: "stop",
			text: "parsed body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw stdout", 0);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).toBe("done");
	});

	// AC-A2: state='error' on exit non-zero (driver did not report error terminal)
	test("runOneTurn state error", async () => {
		const memberDir = join(tmpDir, "a2");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_a2",
			terminal: "unknown_pause",
			text: "",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 1);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).toBe("error");
	});

	// P1-5: driver-reported terminal='error' elevates state to non_retryable regardless of exitCode
	test("runOneTurn state non_retryable when driver terminal=error", async () => {
		const memberDir = join(tmpDir, "a2b");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_a2b",
			terminal: "error",
			text: "",
			rawEvents: [],
		});
		// exitCode 0 — driver detected error in stdout (opencode exit-0 pattern)
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).toBe("non_retryable");
	});

	// AC-A3: sessionID extracted from driver.parseStdout
	test("runOneTurn sessionID", async () => {
		const memberDir = join(tmpDir, "a3");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_xyz",
			terminal: "stop",
			text: "body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.sessionID).toBe("ses_xyz");
	});

	// AC-A4: forwards parsed text
	test("runOneTurn text", async () => {
		const memberDir = join(tmpDir, "a4");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_a4",
			terminal: "stop",
			text: "parsed body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw stdout", 0);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.text).toBe("parsed body");
	});

	// AC-A5: forwards CLI exitCode
	test("runOneTurn exitCode", async () => {
		const memberDir = join(tmpDir, "a5");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_a5",
			terminal: "stop",
			text: "body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.exitCode).toBe(0);
	});

	// AC-A6a+A6b: output.txt overwrite (not append), no _turn-N/ subdir
	test("runOneTurn output overwrite no _turn-N subdir", async () => {
		const memberDir = join(tmpDir, "a6");
		mkdirSync(memberDir, { recursive: true });

		// Pre-populate output.txt with 'OLD'
		writeFileSync(join(memberDir, "output.txt"), "OLD");

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_a6",
			terminal: "stop",
			text: "NEW",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		// AC-A6a: output.txt contains exactly 'NEW'
		const content = readFileSync(join(memberDir, "output.txt"), "utf8");
		expect(content).toBe("NEW");

		// AC-A6b: no _turn-0 or _turn-1 subdirs created
		expect(existsSync(join(memberDir, "_turn-0"))).toBe(false);
		expect(existsSync(join(memberDir, "_turn-1"))).toBe(false);
	});

	// AC-B1: driver.resumeCommand called with sessionID
	test("resumeOneTurn spy", async () => {
		const memberDir = join(tmpDir, "b1");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_resume",
			terminal: "stop",
			text: "body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		await resumeOneTurn(
			"ses_target",
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(mockDriver.spy.calls.length).toBeGreaterThan(0);
		expect(mockDriver.spy.calls[0][0].sessionID).toBe("ses_target");
	});

	// AC-B2: resumeOneTurn returns non-empty sessionID
	test("resumeOneTurn sessionID non-empty", async () => {
		const memberDir = join(tmpDir, "b2");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_b2_result",
			terminal: "stop",
			text: "body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		const result = await resumeOneTurn(
			"ses_input",
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.sessionID).toBeTruthy();
	});

	// AC-C1: status.json contains sessionID
	test("runOneTurn sessionID atomicWriteJson", async () => {
		const memberDir = join(tmpDir, "c1");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_xyz",
			terminal: "stop",
			text: "body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.sessionID).toBe("ses_xyz");
	});

	// parseStdout가 던져도 터미널 상태가 status.json에 남아야 한다. finalize()는 파싱
	// 완료 전까지 디스크에 state:"running"을 의도적으로 남기므로, 예외가 밖으로 새면
	// 멤버가 heartbeat staleness로 회수될 때까지 running으로 고착되고 실제 종료 상태가
	// "Worker stale" 로 대체된다. 실제 도달 경로: opencode 드라이버가 NDJSON 한 줄
	// `null` 을 JSON.parse 성공으로 events에 넣은 뒤 `ev.type` 을 읽어 TypeError.
	test("runOneTurn: parseStdout가 예외를 던져도 status.json은 running이 아닌 터미널 상태다", async () => {
		const memberDir = join(tmpDir, "parse-throw");
		mkdirSync(memberDir, { recursive: true });

		const throwingDriver = makeOneTurnMockDriver(null);
		throwingDriver.parseStdout = () => {
			throw new TypeError("Cannot read properties of null (reading 'type')");
		};
		// exit 0 — 프로세스 자체는 정상 종료했고 파싱만 실패한 경우.
		const mockRunOnce = makeOneTurnMockRunOnce("null\n", 0);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => throwingDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		// 드라이버는 있는데 파싱이 실패한 경로와 동일하게 취급된다.
		expect(result.state).toBe("error");
		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("error");
		expect(status.state).not.toBe("running");
	});

	// AC-C2: initial resume_count === 0
	test("runOneTurn resume_count zero init", async () => {
		const memberDir = join(tmpDir, "c2");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_c2",
			terminal: "stop",
			text: "body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.resume_count).toBe(0);
	});

	// AC-C6: atomicWriteJson uses pid+crypto tmpfile+rename (not partial write)
	test("atomicWriteJson tmpfile rename atomicity", async () => {
		const memberDir = join(tmpDir, "c6");
		mkdirSync(memberDir, { recursive: true });

		// Verify atomicWriteJson uses a crypto-suffixed tmpfile that is renamed.
		// We spy by checking that no .tmp files remain after the call.
		const statusPath = join(memberDir, "status.json");
		atomicWriteJson(statusPath, { state: "done", sessionID: "ses_c6" });

		// No tmp files remain — atomicity via rename
		const files = readdirSync(memberDir);
		const tmpFiles = files.filter((f) => f.includes(".tmp"));
		expect(tmpFiles).toHaveLength(0);

		// The written file parses as valid JSON with the expected content
		const parsed = JSON.parse(readFileSync(statusPath, "utf8"));
		expect(parsed.state).toBe("done");
		expect(parsed.sessionID).toBe("ses_c6");
	});

	// AC-C7: legacy status.json (no resume_count field) auto-initializes to 0
	test("runOneTurn legacy status.json resume_count auto-init", async () => {
		const memberDir = join(tmpDir, "c7");
		mkdirSync(memberDir, { recursive: true });

		// Pre-populate legacy status.json with no resume_count field
		writeFileSync(
			join(memberDir, "status.json"),
			JSON.stringify({
				member: "x",
				state: "done",
				command: "opencode run ...",
			}),
		);

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_c7",
			terminal: "stop",
			text: "body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw", 0);

		// Must not throw despite missing resume_count
		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.resume_count).toBe(0);
	});

	// QA Scenario: happy path end-to-end
	test("runOneTurn end-to-end opencode", async () => {
		const memberDir = join(tmpDir, "qa-happy");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_xyz",
			terminal: "stop",
			text: "parsed body",
			rawEvents: [],
		});
		const mockRunOnce = makeOneTurnMockRunOnce("raw ndjson stdout", 0);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).toBe("done");
		expect(result.sessionID).toBe("ses_xyz");
		expect(result.text).toBe("parsed body");
		expect(result.exitCode).toBe(0);

		// output.txt overwritten with parsed text
		const outputContent = readFileSync(join(memberDir, "output.txt"), "utf8");
		expect(outputContent).toBe("parsed body");

		// status.json's final on-disk state is terminal together with the parsed output —
		// the two must land as one observable snapshot, not disk-terminal-before-parsed-text.
		const finalStatus = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(finalStatus.state).toBe("done");

		// No _turn-0 subdir
		expect(existsSync(join(memberDir, "_turn-0"))).toBe(false);
	});

	// QA Scenario: parse failure → state='error', output.txt = raw stdout
	test("runOneTurn parse failure", async () => {
		const memberDir = join(tmpDir, "qa-parse-fail");
		mkdirSync(memberDir, { recursive: true });

		// Driver parseStdout returns null = parse failure
		const mockDriver = makeOneTurnMockDriver(null);
		const mockRunOnce = makeOneTurnMockRunOnce("raw unparseable stdout", 0);

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		// Parse failure → state='error'
		expect(result.state).toBe("error");

		// output.txt = raw stdout (no transformation)
		const outputContent = readFileSync(join(memberDir, "output.txt"), "utf8");
		expect(outputContent).toBe("raw unparseable stdout");

		// No _turn-N subdir
		expect(existsSync(join(memberDir, "_turn-0"))).toBe(false);
	});

	// P1-1 regression: stale output.txt content must NOT be seen by driver
	// The bug: executeOneTurn passed attempt:0 → runOnce opened output.txt with 'a' flag
	// → on resume turns, stale content remained → driver saw stale+new merged content.
	test("runOneTurn does not pass stale output.txt content to driver on resume", async () => {
		const memberDir = join(tmpDir, "p1-1-stale");
		mkdirSync(memberDir, { recursive: true });

		// Pre-populate output.txt with stale content from a previous turn
		writeFileSync(join(memberDir, "output.txt"), "stale-content\n", "utf8");

		// Track what parseStdout receives
		let receivedStdout = "";
		const spyDriver: AgentDriver = {
			cli: "opencode",
			parseStdout: (stdout: string) => {
				receivedStdout = stdout;
				return { sessionID: "ses-new", terminal: "stop", text: "new body", rawEvents: [] };
			},
			initialCommand: (opts) => ({
				program: opts.baseCommand,
				args: opts.baseArgs,
				env: opts.workerEnv,
			}),
			resumeCommand: (opts) => ({
				program: opts.baseCommand,
				args: opts.baseArgs,
				env: opts.workerEnv,
			}),
		};

		// Mock runOnceFn that APPENDS (mirrors production behavior: attempt=0 → flags='a')
		const appendingRunOnceFn = async (opts: RunOnceOpts): Promise<Record<string, unknown>> => {
			appendFileSync(join(opts.memberDir, "output.txt"), "new-content\n", "utf8");
			return { state: "done", exitCode: 0, member: opts.member, command: opts.command, attempt: 0 };
		};

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => spyDriver,
				runOnceFn: appendingRunOnceFn,
			}),
		);

		// Driver must receive ONLY the new content — no stale prefix
		expect(receivedStdout).toBe("new-content\n");
		expect(receivedStdout.includes("stale-content")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// executeOneTurn state/message/workerEnv regression tests
// ---------------------------------------------------------------------------

function makeFlexibleMockRunOnce(rawStdout: string, runResult: Record<string, unknown>) {
	return async (opts: RunOnceOpts): Promise<Record<string, unknown>> => {
		writeFileSync(join(opts.memberDir, "output.txt"), rawStdout);
		writeFileSync(join(opts.memberDir, "error.txt"), "");
		return { member: opts.member, command: opts.command, attempt: 0, ...runResult };
	};
}

describe("executeOneTurn state/message/workerEnv regression", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "execute-one-turn-reg-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// T1-1: timed_out state preserved when driver returns non-error terminal and exitCode===null
	test("timed_out state preserved in status.json when exitCode is null", async () => {
		const memberDir = join(tmpDir, "timed-out");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "sX",
			terminal: "stop",
			text: "partial",
			rawEvents: [],
		});
		const mockRunOnce = makeFlexibleMockRunOnce("partial", {
			state: "timed_out",
			message: "Timed out after 600s",
			finishedAt: "2026-01-01T00:00:00.000Z",
			exitCode: null,
		});

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("timed_out");
		expect(status.message).toBe("Timed out after 600s");
		expect(status.exitCode).toBe(null);
	});

	// T1-2: missing_cli state preserved when driver returns non-null parsed result and exitCode===null
	test("missing_cli state preserved in status.json when exitCode is null", async () => {
		const memberDir = join(tmpDir, "missing-cli");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: null,
			terminal: "stop",
			text: "",
			rawEvents: [],
		});
		const mockRunOnce = makeFlexibleMockRunOnce("", {
			state: "missing_cli",
			message: "spawn claude ENOENT",
			exitCode: null,
		});

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("missing_cli");
		expect(status.message).toBe("spawn claude ENOENT");
	});

	// T1-3: canceled state preserved when driver returns non-null parsed result and exitCode===null
	test("canceled state preserved in status.json when exitCode is null", async () => {
		const memberDir = join(tmpDir, "canceled");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: null,
			terminal: "stop",
			text: "",
			rawEvents: [],
		});
		const mockRunOnce = makeFlexibleMockRunOnce("", {
			state: "canceled",
			message: "Canceled",
			exitCode: null,
		});

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("canceled");
		expect(status.message).toBe("Canceled");
	});

	// T1-4: builtCmd.env saved as workerEnv in status.json
	test("workerEnv from initialCommand env is saved in status.json", async () => {
		const memberDir = join(tmpDir, "worker-env");
		mkdirSync(memberDir, { recursive: true });

		const expectedEnv = { CLAUDECODE: "", CLAUDE_CODE_EFFORT_LEVEL: "low", FOO: "bar" };
		// Driver.initialCommand returns the expectedEnv — this becomes builtCmd.env
		const mockDriver: AgentDriver & { spy: { calls: any[][] } } = {
			cli: "claude",
			parseStdout: (_stdout: string) => ({
				sessionID: "ses_env",
				terminal: "stop",
				text: "body",
				rawEvents: [],
			}),
			initialCommand: (opts) => ({
				program: opts.baseCommand,
				args: opts.baseArgs,
				env: expectedEnv,
			}),
			resumeCommand: (opts) => ({
				program: opts.baseCommand,
				args: opts.baseArgs,
				env: opts.workerEnv,
			}),
			spy: { calls: [] },
		};
		const mockRunOnce = makeFlexibleMockRunOnce("body", {
			state: "done",
			exitCode: 0,
		});

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				cliType: "claude",
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.workerEnv).toEqual(expectedEnv);
	});

	// T1-5: message is explicitly null (not undefined) when runOnce returns no message
	test("message field is null (not undefined) when runOnce provides no message", async () => {
		const memberDir = join(tmpDir, "null-message");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_nm",
			terminal: "stop",
			text: "body",
			rawEvents: [],
		});
		const mockRunOnce = makeFlexibleMockRunOnce("body", {
			state: "done",
			exitCode: 0,
			// no message field
		});

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		// JSON.parse of null gives null, undefined key gives undefined — must be null
		expect(status.message).toBe(null);
	});

	// F2: usage from ParseResult is written into status.json
	test("`ParseResult`의 usage 필드가 status.json에 기록됨", async () => {
		const memberDir = join(tmpDir, "f2-usage");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_f2",
			terminal: "stop",
			text: "body",
			rawEvents: [],
			usage: { input_tokens: 12345, output_tokens: 42 },
		});
		const mockRunOnce = makeFlexibleMockRunOnce("body", { state: "done", exitCode: 0 });

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.usage.input_tokens).toBe(12345);
	});

	// F2: usage is null (not {}) when driver returns no usage
	test("driver가 usage를 반환하지 않을 때 status.json의 usage가 null임", async () => {
		const memberDir = join(tmpDir, "f2-no-usage");
		mkdirSync(memberDir, { recursive: true });

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_f2b",
			terminal: "stop",
			text: "body",
			rawEvents: [],
			// no usage field
		});
		const mockRunOnce = makeFlexibleMockRunOnce("body", { state: "done", exitCode: 0 });

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.usage).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// P1-1 regression: parsed===null AND driverInstance!==null → state must be preserved
// makeOneTurnMockDriver always returns non-null, bypassing the else branch.
// These tests use a null-parse driver to exercise the actual buggy path.
// ---------------------------------------------------------------------------

function makeNullParseDriver(): AgentDriver {
	return {
		cli: "opencode",
		parseStdout: (_stdout: string) => null,
		initialCommand: (opts) => ({
			program: opts.baseCommand,
			args: opts.baseArgs,
			env: opts.workerEnv,
		}),
		resumeCommand: (opts) => ({
			program: opts.baseCommand,
			args: opts.baseArgs,
			env: opts.workerEnv,
		}),
	};
}

// ---------------------------------------------------------------------------
// P2 regression: resume turns must accumulate usage across turns
// ---------------------------------------------------------------------------

describe("resumeOneTurn usage 누적", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "usage-accum-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// P2-main: two-turn flow — final status.json usage is the per-key sum of both turns
	test("두 턴에 걸친 usage가 최종 status.json에 합산됨", async () => {
		const memberDir = join(tmpDir, "two-turns");
		mkdirSync(memberDir, { recursive: true });

		// Turn 1: initial runOneTurn with output_tokens=100, input_tokens=1000
		const turn1Driver = makeOneTurnMockDriver({
			sessionID: "ses_accum",
			terminal: "stop",
			text: "turn1",
			rawEvents: [],
			usage: { output_tokens: 100, input_tokens: 1000 },
		});
		const turn1RunOnce = makeFlexibleMockRunOnce("turn1", { state: "done", exitCode: 0 });

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => turn1Driver,
				runOnceFn: turn1RunOnce,
			}),
		);

		// Verify turn 1 wrote usage correctly
		const statusAfterTurn1 = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(statusAfterTurn1.usage.output_tokens).toBe(100);

		// Simulate cmdResumeMember: increment resume_count before calling resumeOneTurn
		writeFileSync(
			join(memberDir, "status.json"),
			JSON.stringify({ ...statusAfterTurn1, resume_count: 1 }),
		);

		// Turn 2: resumeOneTurn with output_tokens=50, input_tokens=2000
		const turn2Driver = makeOneTurnMockDriver({
			sessionID: "ses_accum",
			terminal: "stop",
			text: "turn2",
			rawEvents: [],
			usage: { output_tokens: 50, input_tokens: 2000 },
		});
		const turn2RunOnce = makeFlexibleMockRunOnce("turn2", { state: "done", exitCode: 0 });

		await resumeOneTurn(
			"ses_accum",
			makeOneTurnOpts(memberDir, {
				driverFactory: () => turn2Driver,
				runOnceFn: turn2RunOnce,
			}),
		);

		const finalStatus = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		// Must be sum of both turns
		expect(finalStatus.usage.output_tokens).toBe(150);
		expect(finalStatus.usage.input_tokens).toBe(3000);
	});

	// P2-carry: resume turn whose current usage is undefined carries prior usage forward
	test("현재 턴의 usage가 없을 때 이전 usage를 유지함 (null로 초기화 금지)", async () => {
		const memberDir = join(tmpDir, "carry-forward");
		mkdirSync(memberDir, { recursive: true });

		// Turn 1: initial runOneTurn with usage
		const turn1Driver = makeOneTurnMockDriver({
			sessionID: "ses_carry",
			terminal: "stop",
			text: "turn1",
			rawEvents: [],
			usage: { output_tokens: 77, input_tokens: 500 },
		});
		const turn1RunOnce = makeFlexibleMockRunOnce("turn1", { state: "done", exitCode: 0 });

		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => turn1Driver,
				runOnceFn: turn1RunOnce,
			}),
		);

		const statusAfterTurn1 = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		// Simulate cmdResumeMember increment
		writeFileSync(
			join(memberDir, "status.json"),
			JSON.stringify({ ...statusAfterTurn1, resume_count: 1 }),
		);

		// Turn 2: resume turn with NO usage (e.g. turn.failed with no turn.completed)
		const turn2Driver = makeOneTurnMockDriver({
			sessionID: "ses_carry",
			terminal: "stop",
			text: "turn2",
			rawEvents: [],
			// no usage field
		});
		const turn2RunOnce = makeFlexibleMockRunOnce("turn2", { state: "done", exitCode: 0 });

		await resumeOneTurn(
			"ses_carry",
			makeOneTurnOpts(memberDir, {
				driverFactory: () => turn2Driver,
				runOnceFn: turn2RunOnce,
			}),
		);

		const finalStatus = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		// Prior usage must be preserved, not replaced with null
		expect(finalStatus.usage).not.toBe(null);
		expect(finalStatus.usage.output_tokens).toBe(77);
	});

	// P2-initial: initial (non-resume) turn still uses last-write-wins — no accumulation
	test("초기 턴(비재개)은 기존 status.json의 usage를 누적하지 않음", async () => {
		const memberDir = join(tmpDir, "initial-no-accum");
		mkdirSync(memberDir, { recursive: true });

		// Pre-populate status.json with some usage from a completely different unrelated run
		writeFileSync(
			join(memberDir, "status.json"),
			JSON.stringify({
				member: "x",
				state: "done",
				resume_count: 0,
				usage: { output_tokens: 9999, input_tokens: 9999 },
			}),
		);

		const mockDriver = makeOneTurnMockDriver({
			sessionID: "ses_init",
			terminal: "stop",
			text: "body",
			rawEvents: [],
			usage: { output_tokens: 10, input_tokens: 20 },
		});
		const mockRunOnce = makeFlexibleMockRunOnce("body", { state: "done", exitCode: 0 });

		// runOneTurn = initial turn: must NOT add 9999 to 10
		await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => mockDriver,
				runOnceFn: mockRunOnce,
			}),
		);

		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		// Must be exactly the current turn's usage — no 9999 double-count
		expect(status.usage.output_tokens).toBe(10);
		expect(status.usage.input_tokens).toBe(20);
	});
});

describe("executeOneTurn parsed===null with driver — process state preservation (P1-1)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "p1-1-null-parse-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// Regression: missing_cli must not be flattened to 'error' when parseStdout returns null
	test("missing_cli state preserved when driver parseStdout returns null", async () => {
		const memberDir = join(tmpDir, "missing-cli");
		mkdirSync(memberDir, { recursive: true });

		const mockRunOnce = makeFlexibleMockRunOnce("", {
			state: "missing_cli",
			message: "spawn opencode ENOENT",
			exitCode: null,
		});

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => makeNullParseDriver(),
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).toBe("missing_cli");
		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("missing_cli");
	});

	// Regression: timed_out must not be flattened to 'error' when parseStdout returns null
	test("timed_out state preserved when driver parseStdout returns null", async () => {
		const memberDir = join(tmpDir, "timed-out");
		mkdirSync(memberDir, { recursive: true });

		const mockRunOnce = makeFlexibleMockRunOnce("", {
			state: "timed_out",
			message: "Timed out after 600s",
			exitCode: null,
		});

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => makeNullParseDriver(),
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).toBe("timed_out");
		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("timed_out");
	});

	// Regression: canceled must not be flattened to 'error' when parseStdout returns null
	test("canceled state preserved when driver parseStdout returns null", async () => {
		const memberDir = join(tmpDir, "canceled");
		mkdirSync(memberDir, { recursive: true });

		const mockRunOnce = makeFlexibleMockRunOnce("", {
			state: "canceled",
			message: "Canceled",
			exitCode: null,
		});

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => makeNullParseDriver(),
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).toBe("canceled");
		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("canceled");
	});
});

describe("runOneTurn real-spawn integration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "one-turn-real-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// P2-4: call runOneTurn with REAL runOnce (no runOnceFn override).
	// This gap was exactly why the append bug escaped the test suite.
	test("runOneTurn with real runOnce and claude driver parses JSON stdout", async () => {
		const memberDir = join(tmpDir, "real-spawn");
		mkdirSync(memberDir, { recursive: true });

		const payload = JSON.stringify({ result: "hi", session_id: "s1", stop_reason: "end_turn" });

		const result = await runOneTurn({
			program: "/bin/sh",
			args: ["-c", `echo '${payload}'`],
			prompt: "ignored",
			member: "test-member",
			memberDir,
			command: "/bin/sh echo",
			timeoutSec: 10,
			cliType: "claude",
		});

		expect(result.state).toBe("done");
		expect(result.sessionID).toBe("s1");
		expect(result.text).toBe("hi");
	});
});

// ---------------------------------------------------------------------------
// P1-2 regression: parsed truthy + non-final terminal signal → state must NOT be 'done'
// When parsed.terminal ∈ {'tool-calls', 'pause_turn', 'unknown_pause'} and
// runResult.state === 'done' (exit 0), the final state must be 'awaiting_resume'.
// ---------------------------------------------------------------------------

function makeNonFinalTerminalDriver(terminal: ParseResult["terminal"]): AgentDriver {
	return {
		cli: "opencode",
		parseStdout: (_stdout: string) => ({
			sessionID: "ses_nf",
			terminal,
			text: "partial",
			rawEvents: [],
		}),
		initialCommand: (opts) => ({
			program: opts.baseCommand,
			args: opts.baseArgs,
			env: opts.workerEnv,
		}),
		resumeCommand: (opts) => ({
			program: opts.baseCommand,
			args: opts.baseArgs,
			env: opts.workerEnv,
		}),
	};
}

describe("executeOneTurn parsed truthy non-final terminal — state preservation (P1-2)", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "p1-2-nonfinal-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// tool-calls: mid-step signal from codex/opencode must not report done
	test("tool-calls terminal with exit 0 yields state !== done", async () => {
		const memberDir = join(tmpDir, "tool-calls");
		mkdirSync(memberDir, { recursive: true });

		const mockRunOnce = makeFlexibleMockRunOnce("partial", { state: "done", exitCode: 0 });

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => makeNonFinalTerminalDriver("tool-calls"),
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).not.toBe("done");
		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).not.toBe("done");
	});

	// pause_turn: claude server-tool loop cap must not report done
	test("pause_turn terminal with exit 0 yields state !== done", async () => {
		const memberDir = join(tmpDir, "pause-turn");
		mkdirSync(memberDir, { recursive: true });

		const mockRunOnce = makeFlexibleMockRunOnce("partial", { state: "done", exitCode: 0 });

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => makeNonFinalTerminalDriver("pause_turn"),
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).not.toBe("done");
		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).not.toBe("done");
	});

	// unknown_pause: heuristic fallback must not report done
	test("unknown_pause terminal with exit 0 yields state !== done", async () => {
		const memberDir = join(tmpDir, "unknown-pause");
		mkdirSync(memberDir, { recursive: true });

		const mockRunOnce = makeFlexibleMockRunOnce("partial", { state: "done", exitCode: 0 });

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => makeNonFinalTerminalDriver("unknown_pause"),
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).not.toBe("done");
		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).not.toBe("done");
	});

	// Regression guard: stop terminal with exit 0 must remain 'done'
	test("stop terminal with exit 0 yields state === done (regression guard)", async () => {
		const memberDir = join(tmpDir, "stop");
		mkdirSync(memberDir, { recursive: true });

		const mockRunOnce = makeFlexibleMockRunOnce("result text", { state: "done", exitCode: 0 });

		const result = await runOneTurn(
			makeOneTurnOpts(memberDir, {
				driverFactory: () => makeNonFinalTerminalDriver("stop"),
				runOnceFn: mockRunOnce,
			}),
		);

		expect(result.state).toBe("done");
		const status = JSON.parse(readFileSync(join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("done");
	});
});

// ---------------------------------------------------------------------------
// reapOwnProcessGroup — 워커 자가 프로세스 그룹 회수
//
// reapOwnProcessGroup은 호출한 프로세스 자신을 대상으로 동작하므로 이 테스트
// 프로세스 안에서 직접 부르면 bun 테스트 러너 자신이 죽는다. 대신 실제
// lib/worker-utils.ts의 reapOwnProcessGroup을 import하는 별도 스크립트를 만들어
// detached 자식 프로세스로 실행하는 자식 프로세스 하니스로 검증한다.
// ---------------------------------------------------------------------------

const WORKER_UTILS_ABS_PATH = new URL("./worker-utils.ts", import.meta.url).pathname;

describe("reapOwnProcessGroup", () => {
	let tmpDir: string;
	let spawnedPgids: number[];

	function isPgidAlive(pgid: number): boolean {
		try {
			const out = execSync("ps -o pgid= -A", { encoding: "utf8" });
			return out
				.split("\n")
				.map((l) => Number(l.trim()))
				.some((n) => n === pgid);
		} catch {
			return false;
		}
	}

	function isPidAlive(pid: number): boolean {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "reap-own-pgroup-"));
		spawnedPgids = [];
	});

	afterEach(() => {
		for (const pgid of spawnedPgids) {
			try {
				process.kill(-pgid, "SIGKILL");
			} catch {
				// 이미 회수됨 — 정리할 것 없음
			}
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// 그룹 SIGTERM → 5초 대기 → 그룹 SIGKILL 에스컬레이션이 sleep 자손까지
	// 포함한 프로세스 그룹 전체를 회수하는지 검증 (하니스 스크립트가 실제
	// reapOwnProcessGroup을 import해서 호출).
	test(
		"자손 프로세스를 포함한 프로세스 그룹 전체를 회수해 잔여 프로세스를 0개로 만듦",
		async () => {
			const scriptPath = join(tmpDir, "reap-script.ts");
			const spawnedMarkerPath = join(tmpDir, "sleep-spawned.txt");
			writeFileSync(
				scriptPath,
				[
					`import { spawn } from "child_process";`,
					`import fs from "fs";`,
					`import { reapOwnProcessGroup } from ${JSON.stringify(WORKER_UTILS_ABS_PATH)};`,
					``,
					`const markerPath = process.argv[2];`,
					`const sleepChild = spawn("sleep", ["30"], { stdio: "ignore" });`,
					`fs.writeFileSync(markerPath, String(sleepChild.pid));`,
					``,
					`reapOwnProcessGroup().then(() => process.exit(0));`,
					``,
				].join("\n"),
				"utf8",
			);

			const harness = spawnChild(process.execPath, [scriptPath, spawnedMarkerPath], {
				detached: true,
				stdio: "ignore",
			});
			const pgid = harness.pid;
			if (pgid === undefined) throw new Error("spawn failed to produce a pid");
			spawnedPgids.push(pgid);

			// sleep 자손이 실제로 떴는지 먼저 확인 — 스크립트가 import 단계에서
			// 죽으면(예: reapOwnProcessGroup 미구현) 이 마커가 끝까지 나타나지
			// 않아 아래 단언에서 실패한다. 이게 없으면 "회수 전 대상이 하나도
			// 없어서 우연히 0개"인 거짓 통과를 걸러내지 못한다.
			const spawnDeadline = Date.now() + SPAWN_MARKER_DEADLINE_MS;
			while (!existsSync(spawnedMarkerPath) && Date.now() < spawnDeadline) {
				await sleepMsAsync(50);
			}
			expect(existsSync(spawnedMarkerPath)).toBe(true);
			const sleepPid = Number(readFileSync(spawnedMarkerPath, "utf8").trim());
			expect(Number.isInteger(sleepPid)).toBe(true);

			await new Promise<void>((resolve) => {
				harness.on("exit", () => resolve());
			});

			// 그룹 전체 SIGKILL 이후 OS가 좀비를 회수하기를 기다린다. 고정 500ms
			// 관찰창은 부하 걸린 머신에서 회수가 늦어지면 그대로 거짓 실패가 된다
			// — 폴링은 빨리 끝나면 즉시 통과하고, 끝내 비지 않으면 여전히 실패한다.
			const livePgidLines = (): string[] =>
				execSync("ps -o pgid=,pid= -A", { encoding: "utf8" })
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0)
					.filter((line) => Number(line.split(/\s+/)[0]) === pgid);
			const reapDeadline = Date.now() + REAP_OBSERVE_DEADLINE_MS;
			while (livePgidLines().length > 0 && Date.now() < reapDeadline) {
				await sleepMsAsync(50);
			}

			expect(livePgidLines()).toHaveLength(0);
		},
		PROCESS_GROUP_TEST_TIMEOUT_MS,
	);

	// AC1 이행 증거: 그룹 전체 SIGTERM을 보내기 "전에" 무시 핸들러를 설치해야
	// 워커 자신이 자기가 보낸 시그널에 죽지 않는다. 5초 SIGKILL 에스컬레이션
	// 유예 구간 한가운데(2초 지점)에서 스크립트가 여전히 살아서 완료 표식을
	// 남기는지로 이를 검증한다.
	test(
		"워커 자신은 자기가 그룹에 보낸 SIGTERM으로 죽지 않고 계속 실행됨",
		async () => {
			const scriptPath = join(tmpDir, "survive-script.ts");
			const markerPath = join(tmpDir, "alive-after-sigterm.txt");
			writeFileSync(
				scriptPath,
				[
					`import fs from "fs";`,
					`import { reapOwnProcessGroup } from ${JSON.stringify(WORKER_UTILS_ABS_PATH)};`,
					``,
					`const markerPath = process.argv[2];`,
					`setTimeout(() => {`,
					`	fs.writeFileSync(markerPath, "alive-after-own-sigterm");`,
					`}, 2000);`,
					``,
					`reapOwnProcessGroup();`,
					``,
				].join("\n"),
				"utf8",
			);

			const harness = spawnChild(process.execPath, [scriptPath, markerPath], {
				detached: true,
				stdio: "ignore",
			});
			const pgid = harness.pid;
			if (pgid === undefined) throw new Error("spawn failed to produce a pid");
			spawnedPgids.push(pgid);

			// 고정 sleep 대신 폴링 — 스케줄링 지연에 덜 취약함
			const deadline = Date.now() + SPAWN_MARKER_DEADLINE_MS;
			while (!existsSync(markerPath) && Date.now() < deadline) {
				await sleepMsAsync(100);
			}

			expect(existsSync(markerPath)).toBe(true);
			expect(readFileSync(markerPath, "utf8")).toBe("alive-after-own-sigterm");
		},
		PROCESS_GROUP_TEST_TIMEOUT_MS,
	);

	// 오살 방지 증명: reapOwnProcessGroup은 process.kill(-pgid, ...)로 그룹
	// "전체"에 신호를 보내므로, 대상 범위가 의도치 않게 넓어지는 것(예: 잘못된
	// pgid 계산으로 남의 그룹까지 건드리는 회귀)이 바로 이 방관자가 잡아내는
	// 회귀 클래스다. lib/generic-job.test.ts:3115-3130의 방관자 패턴과 같은 결.
	test(
		"회수 대상과 무관한 방관자 프로세스 그룹은 하니스 실행 전후 모두 살아남는다",
		async () => {
			const bystander = spawnChild("sleep", ["30"], { detached: true, stdio: "ignore" });
			const bystanderPgid = bystander.pid;
			if (bystanderPgid === undefined) throw new Error("spawn failed to produce a pid");
			spawnedPgids.push(bystanderPgid);

			// 선행 단언: 하니스 실행 전에 방관자가 실제로 살아있음을 먼저 확인한다
			// — 없으면 사후 단언이 "애초에 살아있지 않았다"와 구분되지 않는다.
			expect(isPgidAlive(bystanderPgid)).toBe(true);

			const scriptPath = join(tmpDir, "reap-bystander-script.ts");
			const markerPath = join(tmpDir, "sleep-spawned-bystander.txt");
			writeFileSync(
				scriptPath,
				[
					`import { spawn } from "child_process";`,
					`import fs from "fs";`,
					`import { reapOwnProcessGroup } from ${JSON.stringify(WORKER_UTILS_ABS_PATH)};`,
					``,
					`const markerPath = process.argv[2];`,
					`const sleepChild = spawn("sleep", ["30"], { stdio: "ignore" });`,
					`fs.writeFileSync(markerPath, String(sleepChild.pid));`,
					``,
					`reapOwnProcessGroup().then(() => process.exit(0));`,
					``,
				].join("\n"),
				"utf8",
			);

			const harness = spawnChild(process.execPath, [scriptPath, markerPath], {
				detached: true,
				stdio: "ignore",
			});
			const pgid = harness.pid;
			if (pgid === undefined) throw new Error("spawn failed to produce a pid");
			spawnedPgids.push(pgid);

			const spawnDeadline = Date.now() + SPAWN_MARKER_DEADLINE_MS;
			while (!existsSync(markerPath) && Date.now() < spawnDeadline) {
				await sleepMsAsync(50);
			}
			expect(existsSync(markerPath)).toBe(true);

			await new Promise<void>((resolve) => {
				harness.on("exit", () => resolve());
			});

			// 그룹 전체 SIGKILL 이후 OS가 좀비를 회수할 여유 시간
			await sleepMsAsync(500);

			// 오살 방지 음성 대조군: 이 하니스와 무관한 프로세스 그룹은 살아남아야 한다.
			expect(isPgidAlive(bystanderPgid)).toBe(true);
		},
		PROCESS_GROUP_TEST_TIMEOUT_MS,
	);

	// SIGKILL 에스컬레이션 증거: 계층 1 픽스처의 자손이 전부 평범한 sleep이면
	// 첫 SIGTERM에 죽어버려 5초 유예 뒤의 SIGKILL 단계가 한 번도 실행되지
	// 않는다. SIGTERM을 무시하는 자손(`trap "" TERM; exec sleep 30` — exec로
	// 이미지가 교체돼도 SIG_IGN 디스포지션은 exec를 넘어 보존된다는 POSIX
	// 시그널 규약을 이용)을 넣어야 SIGKILL 단계가 비로소 load-bearing해진다.
	test(
		"SIGTERM을 무시하는 자손은 첫 SIGTERM에 살아남고 5초 뒤 SIGKILL로 결국 죽는다",
		async () => {
			const scriptPath = join(tmpDir, "reap-trap-script.ts");
			const trapPidPath = join(tmpDir, "trap-child-pid.txt");
			const trapReadyPath = join(tmpDir, "trap-child-ready.txt");
			const midGraceMarkerPath = join(tmpDir, "trap-child-mid-grace.txt");
			writeFileSync(
				scriptPath,
				[
					`import { spawn } from "child_process";`,
					`import fs from "fs";`,
					`import { reapOwnProcessGroup } from ${JSON.stringify(WORKER_UTILS_ABS_PATH)};`,
					``,
					`const trapPidPath = process.argv[2];`,
					`const trapReadyPath = process.argv[3];`,
					`const midMarkerPath = process.argv[4];`,
					// trap ""로 SIGTERM을 SIG_IGN 처리한 뒤 ready 마커를 touch하고 나서야
					// exec으로 sleep에 자기 자신을 교체한다 — SIG_IGN 디스포지션은 exec를
					// 넘어 보존되므로 이 시점 이후로는 신호 유예가 확정된다. ready 마커가
					// 나타나기 전에 SIGTERM을 보내면, bash가 아직 trap을 설치하기 전이라
					// 기본 동작(종료)으로 죽어버리는 경합이 생긴다 — 그 경합을 이 동기화로
					// 닫는다.
					`const trapChild = spawn(`,
					`	"bash",`,
					`	["-c", 'trap "" TERM; touch "$1"; exec sleep 30', "_", trapReadyPath],`,
					`	{ stdio: "ignore" },`,
					`);`,
					`fs.writeFileSync(trapPidPath, String(trapChild.pid));`,
					``,
					`function waitReadyThenReap() {`,
					`	if (!fs.existsSync(trapReadyPath)) {`,
					`		setTimeout(waitReadyThenReap, 10);`,
					`		return;`,
					`	}`,
					`	setTimeout(() => {`,
					`		let alive = true;`,
					`		try {`,
					`			process.kill(trapChild.pid, 0);`,
					`		} catch {`,
					`			alive = false;`,
					`		}`,
					`		fs.writeFileSync(midMarkerPath, alive ? "alive" : "dead");`,
					`	}, 2000);`,
					`	reapOwnProcessGroup().then(() => process.exit(0));`,
					`}`,
					`waitReadyThenReap();`,
					``,
				].join("\n"),
				"utf8",
			);

			const harness = spawnChild(
				process.execPath,
				[scriptPath, trapPidPath, trapReadyPath, midGraceMarkerPath],
				{
					detached: true,
					stdio: "ignore",
				},
			);
			const pgid = harness.pid;
			if (pgid === undefined) throw new Error("spawn failed to produce a pid");
			spawnedPgids.push(pgid);

			const spawnDeadline = Date.now() + SPAWN_MARKER_DEADLINE_MS;
			while (!existsSync(trapPidPath) && Date.now() < spawnDeadline) {
				await sleepMsAsync(50);
			}
			expect(existsSync(trapPidPath)).toBe(true);
			const trapPid = Number(readFileSync(trapPidPath, "utf8").trim());
			expect(Number.isInteger(trapPid)).toBe(true);

			// 선행 단언: 그룹 SIGTERM 이후에도(스크립트 자체 타이머로 2초 지점 —
			// 아직 5초 SIGKILL 전) SIGTERM을 무시하는 이 자손이 여전히 살아있음을
			// 확인한다 — 없으면 뒤의 "결국 죽음" 단언이 SIGKILL 에스컬레이션의
			// 효과인지, 애초에 살아있지 않았던 건지 구분할 수 없다.
			const midDeadline = Date.now() + SPAWN_MARKER_DEADLINE_MS;
			while (!existsSync(midGraceMarkerPath) && Date.now() < midDeadline) {
				await sleepMsAsync(50);
			}
			expect(existsSync(midGraceMarkerPath)).toBe(true);
			expect(readFileSync(midGraceMarkerPath, "utf8")).toBe("alive");

			await new Promise<void>((resolve) => {
				harness.on("exit", () => resolve());
			});

			// 5초 유예 종료 + SIGKILL 전파/좀비 회수를 기다린다. 고정 500ms 관찰창은
			// 전파가 그보다 늦어지는 순간 거짓 실패가 된다 — 폴링은 죽는 즉시
			// 통과하고, 끝내 살아 있으면 여전히 실패한다.
			const deathDeadline = Date.now() + REAP_OBSERVE_DEADLINE_MS;
			while (isPidAlive(trapPid) && Date.now() < deathDeadline) {
				await sleepMsAsync(50);
			}

			expect(isPidAlive(trapPid)).toBe(false);
		},
		PROCESS_GROUP_TEST_TIMEOUT_MS,
	);
});
