/**
 * claudeDriver fixture-replay and unit tests.
 *
 * Fixtures: lib/agent-drivers/__fixtures__/claude-*.json
 * DisplayNames: Korean, method names: English in backticks
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// Import the driver (registers itself on module load)
import { claudeDriver } from "./claudecode";

const FIXTURES_DIR = join(import.meta.dir, "__fixtures__");

function readFixture(name: string): string {
	return readFileSync(join(FIXTURES_DIR, name), "utf8").trim();
}

// ---------------------------------------------------------------------------
// parseStdout — fixture-based
// ---------------------------------------------------------------------------

describe("`parseStdout` — 픽스처 기반 파싱", () => {
	test("`end_turn` with sentinel → stop (AC-A4)", () => {
		const raw = readFixture("claude-end-turn-with-sentinel.json");
		const result = claudeDriver.parseStdout(raw);
		expect(result).not.toBeNull();
		expect(result!.terminal).toBe("stop");
		expect(result!.sessionID).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(result!.text).toContain("## Verdict");
	});

	test("`end_turn` without sentinel → stop, text verbatim", () => {
		const raw = readFixture("claude-end-turn.json");
		const parsed = JSON.parse(raw);
		const result = claudeDriver.parseStdout(raw);
		expect(result).not.toBeNull();
		expect(result!.terminal).toBe("stop");
		expect(result!.sessionID).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(result!.text).toBe(parsed.result);
	});

	test("`tool_use` → tool-calls 분류 (AC-A5)", () => {
		const raw = readFixture("claude-tool-use.json");
		const parsed = JSON.parse(raw);
		const result = claudeDriver.parseStdout(raw);
		expect(result).not.toBeNull();
		expect(result!.terminal).toBe("tool-calls");
		expect(result!.sessionID).toBe(parsed.session_id);
	});
});

// ---------------------------------------------------------------------------
// parseStdout — inline synthetic cases
// ---------------------------------------------------------------------------

describe("`parseStdout` — 인라인 합성 케이스", () => {
	function syntheticRaw(stop_reason: string): string {
		return JSON.stringify({
			stop_reason,
			session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
			result: "some text",
		});
	}

	test("`pause_turn` → pause_turn 분류", () => {
		const result = claudeDriver.parseStdout(syntheticRaw("pause_turn"));
		expect(result).not.toBeNull();
		expect(result!.terminal).toBe("pause_turn");
		expect(result!.sessionID).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
	});

	test("`refusal` → error 분류", () => {
		const result = claudeDriver.parseStdout(syntheticRaw("refusal"));
		expect(result).not.toBeNull();
		expect(result!.terminal).toBe("error");
	});

	test("알 수 없는 stop_reason → unknown_pause 분류 (`max_tokens`)", () => {
		const result = claudeDriver.parseStdout(syntheticRaw("max_tokens"));
		expect(result).not.toBeNull();
		expect(result!.terminal).toBe("unknown_pause");
	});

	test("알 수 없는 stop_reason → unknown_pause 분류 (임의 값)", () => {
		const result = claudeDriver.parseStdout(syntheticRaw("completely_made_up_reason"));
		expect(result).not.toBeNull();
		expect(result!.terminal).toBe("unknown_pause");
	});
});

// ---------------------------------------------------------------------------
// parseStdout — malformed input
// ---------------------------------------------------------------------------

describe("`parseStdout` — 잘못된 입력 처리", () => {
	test("잘못된 JSON → null 반환", () => {
		const result = claudeDriver.parseStdout("not valid json {{{");
		expect(result).toBeNull();
	});

	test("빈 문자열 → null 반환", () => {
		const result = claudeDriver.parseStdout("");
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// parseStdout — rawEvents
// ---------------------------------------------------------------------------

describe("`parseStdout` — rawEvents 구조", () => {
	test("rawEvents는 파싱된 단일 객체를 담는 배열", () => {
		const raw = readFixture("claude-end-turn.json");
		const parsed = JSON.parse(raw);
		const result = claudeDriver.parseStdout(raw);
		expect(result).not.toBeNull();
		expect(result!.rawEvents).toHaveLength(1);
		expect(result!.rawEvents[0]).toEqual(parsed);
	});
});

// ---------------------------------------------------------------------------
// initialCommand
// ---------------------------------------------------------------------------

describe("`initialCommand` — 기본 커맨드 빌드", () => {
	test("baseCommand와 baseArgs를 그대로 전달", () => {
		const result = claudeDriver.initialCommand({
			prompt: "hello",
			baseCommand: "claude",
			baseArgs: ["-p", "--output-format", "json"],
			workerEnv: { CLAUDECODE: "", CLAUDE_CODE_EFFORT_LEVEL: "high" },
		});
		expect(result.program).toBe("claude");
		expect(result.args).toEqual(["-p", "--output-format", "json"]);
		expect(result.env).toEqual({ CLAUDECODE: "", CLAUDE_CODE_EFFORT_LEVEL: "high" });
	});
});

// ---------------------------------------------------------------------------
// initialCommand — contract tests (driver invariant: always produces JSON-parseable output)
// ---------------------------------------------------------------------------

describe("`initialCommand` — output-format json 불변식 계약", () => {
	test("baseArgs에 --output-format 없으면 json 플래그 추가", () => {
		const result = claudeDriver.initialCommand({
			prompt: "hello",
			baseCommand: "claude",
			baseArgs: ["-p"],
			workerEnv: {},
		});
		const ofIdx = result.args.indexOf("--output-format");
		expect(ofIdx).toBeGreaterThanOrEqual(0);
		expect(result.args[ofIdx + 1]).toBe("json");
	});

	test("baseArgs에 --output-format text 있으면 json으로 대체 (text 잔재 없음)", () => {
		const result = claudeDriver.initialCommand({
			prompt: "hello",
			baseCommand: "claude",
			baseArgs: ["-p", "--output-format", "text"],
			workerEnv: {},
		});
		// exactly one --output-format flag
		const count = result.args.filter((a) => a === "--output-format").length;
		expect(count).toBe(1);
		const ofIdx = result.args.indexOf("--output-format");
		expect(result.args[ofIdx + 1]).toBe("json");
		expect(result.args).not.toContain("text");
	});

	test("다른 플래그(--model) 보존하면서 --output-format json 추가", () => {
		const result = claudeDriver.initialCommand({
			prompt: "hello",
			baseCommand: "claude",
			baseArgs: ["-p", "--model", "claude-opus-4-7"],
			workerEnv: {},
		});
		expect(result.args).toContain("--model");
		const modelIdx = result.args.indexOf("--model");
		expect(result.args[modelIdx + 1]).toBe("claude-opus-4-7");
		const ofIdx = result.args.indexOf("--output-format");
		expect(ofIdx).toBeGreaterThanOrEqual(0);
		expect(result.args[ofIdx + 1]).toBe("json");
	});
});

// ---------------------------------------------------------------------------
// resumeCommand
// ---------------------------------------------------------------------------

describe("`resumeCommand` — 재개 커맨드 빌드", () => {
	test("--resume와 --output-format json 주입", () => {
		const result = claudeDriver.resumeCommand({
			sessionID: "test-uuid-1234",
			prompt: "continue",
			baseCommand: "claude",
			baseArgs: ["-p"],
			workerEnv: { CLAUDECODE: "" },
		});
		expect(result.args).toContain("--resume");
		expect(result.args).toContain("test-uuid-1234");
		expect(result.args).toContain("--output-format");
		expect(result.args).toContain("json");
		// --resume uuid must be adjacent
		const resumeIdx = result.args.indexOf("--resume");
		expect(result.args[resumeIdx + 1]).toBe("test-uuid-1234");
	});

	test('CLAUDECODE="" 환경변수 보존', () => {
		const result = claudeDriver.resumeCommand({
			sessionID: "uuid-abc",
			prompt: "continue",
			baseCommand: "claude",
			baseArgs: ["-p"],
			workerEnv: { CLAUDECODE: "", OTHER: "x" },
		});
		expect(result.env.CLAUDECODE).toBe("");
		expect(result.env.OTHER).toBe("x");
	});

	test("기존 --resume 쌍 교체", () => {
		const result = claudeDriver.resumeCommand({
			sessionID: "new-uuid",
			prompt: "continue",
			baseCommand: "claude",
			baseArgs: ["-p", "--resume", "old-uuid", "--output-format", "json"],
			workerEnv: { CLAUDECODE: "" },
		});
		expect(result.args).not.toContain("old-uuid");
		expect(result.args).toContain("new-uuid");
		// only one --resume
		const count = result.args.filter((a) => a === "--resume").length;
		expect(count).toBe(1);
	});
});
