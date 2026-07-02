import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeDurableSink } from "./durable-sink";

// ---------------------------------------------------------------------------
// 듀러블 싱크 테스트 — CLI/파싱 경계 및 파일 기록 검증
//
// 세 가지 속성을 보장한다:
//   1. 경로 결정성: 싱크가 정확히 ${OMT_DIR}/code-review/<runId>/ 에 기록
//   2. 필드 완전성: candidates.json에 `found`, `deduped`, `dispatched` 각각 검증
//   3. D=0 불변 조건: 토출 수가 0인 리뷰에도 candidates.json 기록
//
// runId는 외부 주입(`writeDurableSink` 내부에서 생성 금지)으로 테스트 결정성 보장.
// `getOmtDir()`는 호출 시점에 OMT_DIR을 읽으므로, 헤르메틱 임시 디렉터리로 라우팅.
// ---------------------------------------------------------------------------

/** CLI 서브프로세스 테스트용 스크립트 경로 */
const SCRIPT_PATH = join(import.meta.dir, "durable-sink.ts");

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;

/** 경로 결정성 테스트용 고정 runId */
const KNOWN_RUN_ID = "test-run-abc123";

/** CLI를 서브프로세스로 실행하고 `exitCode`, `stdout`, `stderr`를 반환한다 */
function runCLI(args: string[]) {
	const result = Bun.spawnSync(["bun", SCRIPT_PATH, ...args], {
		env: { ...process.env, OMT_DIR: tmpDir },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stderr: result.stderr.toString(),
		stdout: result.stdout.toString(),
	};
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "durable-sink-test-"));
	process.env.OMT_DIR = tmpDir;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalOmtDir !== undefined) {
		process.env.OMT_DIR = originalOmtDir;
	} else {
		delete process.env.OMT_DIR;
	}
});

// ---------------------------------------------------------------------------
// AC 1: 경로 결정성 — ${OMT_DIR}/code-review/<runId>/ 에 기록
// ---------------------------------------------------------------------------
describe("F4: 싱크 경로 결정성", () => {
	test("`candidates.json` 경로가 ${OMT_DIR}/code-review/<runId>/candidates.json으로 결정된다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 5, deduped: 3, dispatched: 3 });

		const expectedPath = join(tmpDir, "code-review", KNOWN_RUN_ID, "candidates.json");
		expect(existsSync(expectedPath)).toBe(true);
	});

	test("`usage-summary.json` 경로가 ${OMT_DIR}/code-review/<runId>/usage-summary.json으로 결정된다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 5, deduped: 3, dispatched: 3 });

		const expectedPath = join(tmpDir, "code-review", KNOWN_RUN_ID, "usage-summary.json");
		expect(existsSync(expectedPath)).toBe(true);
	});

	test("runId가 다르면 서로 다른 하위 디렉터리에 기록된다 (크로스-런 충돌 없음)", () => {
		writeDurableSink({ runId: "run-alpha", found: 2, deduped: 1, dispatched: 1 });
		writeDurableSink({ runId: "run-beta", found: 3, deduped: 2, dispatched: 2 });

		expect(existsSync(join(tmpDir, "code-review", "run-alpha", "candidates.json"))).toBe(true);
		expect(existsSync(join(tmpDir, "code-review", "run-beta", "candidates.json"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// AC 2: candidates.json 필드 완전성 — found, deduped, dispatched 각각 검증
//        (부분 쓰기 감지)
// ---------------------------------------------------------------------------
describe("F4: `candidates.json` 필드 완전성", () => {
	test("`candidates.json`에 `found` 필드가 존재한다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 7, deduped: 4, dispatched: 4 });

		const raw = readFileSync(join(tmpDir, "code-review", KNOWN_RUN_ID, "candidates.json"), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.found).toBe(7);
	});

	test("`candidates.json`에 `deduped` 필드가 존재한다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 7, deduped: 4, dispatched: 4 });

		const raw = readFileSync(join(tmpDir, "code-review", KNOWN_RUN_ID, "candidates.json"), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.deduped).toBe(4);
	});

	test("`candidates.json`에 `dispatched` 필드가 존재한다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 7, deduped: 4, dispatched: 4 });

		const raw = readFileSync(join(tmpDir, "code-review", KNOWN_RUN_ID, "candidates.json"), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.dispatched).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// AC 3: D=0 불변 조건 — 토출 수가 0인 리뷰에도 candidates.json 기록
//        (결과가 없는 리뷰에도 측정 아티팩트 필요)
// ---------------------------------------------------------------------------
describe("F4: D=0 불변 조건", () => {
	test("D=0: `candidates.json`이 found=0으로 기록된다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 0, deduped: 0, dispatched: 0 });

		const expectedPath = join(tmpDir, "code-review", KNOWN_RUN_ID, "candidates.json");
		expect(existsSync(expectedPath)).toBe(true);

		const parsed = JSON.parse(readFileSync(expectedPath, "utf8"));
		expect(parsed.found).toBe(0);
	});

	test("D=0: `candidates.json`의 `deduped` 필드가 0이다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 0, deduped: 0, dispatched: 0 });

		const parsed = JSON.parse(
			readFileSync(join(tmpDir, "code-review", KNOWN_RUN_ID, "candidates.json"), "utf8"),
		);
		expect(parsed.deduped).toBe(0);
	});

	test("D=0: `candidates.json`의 `dispatched` 필드가 0이다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 0, deduped: 0, dispatched: 0 });

		const parsed = JSON.parse(
			readFileSync(join(tmpDir, "code-review", KNOWN_RUN_ID, "candidates.json"), "utf8"),
		);
		expect(parsed.dispatched).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// AC 4: usage-summary.json — findTokenUsage 기록 (선택 필드)
//        findTokenUsage가 없어도 싱크 쓰기를 차단하지 않는다.
// ---------------------------------------------------------------------------
describe("F4: `usage-summary.json`", () => {
	test("`findTokenUsage`가 제공되면 `usage-summary.json`에 기록된다", () => {
		const tokenData = { memberCount: 4, usage: { input_tokens: 1200, output_tokens: 800 } };
		writeDurableSink({
			runId: KNOWN_RUN_ID,
			found: 3,
			deduped: 2,
			dispatched: 2,
			findTokenUsage: tokenData,
		});

		const raw = readFileSync(
			join(tmpDir, "code-review", KNOWN_RUN_ID, "usage-summary.json"),
			"utf8",
		);
		const parsed = JSON.parse(raw);
		expect(parsed.findTokenUsage).toEqual(tokenData);
	});

	test("`findTokenUsage`가 없어도 싱크 쓰기를 차단하지 않는다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 2, deduped: 1, dispatched: 1 });

		const expectedPath = join(tmpDir, "code-review", KNOWN_RUN_ID, "usage-summary.json");
		expect(existsSync(expectedPath)).toBe(true);
	});

	test("`findTokenUsage`가 없으면 `usage-summary.json`에 null로 기록된다", () => {
		writeDurableSink({ runId: KNOWN_RUN_ID, found: 2, deduped: 1, dispatched: 1 });

		const parsed = JSON.parse(
			readFileSync(join(tmpDir, "code-review", KNOWN_RUN_ID, "usage-summary.json"), "utf8"),
		);
		expect(parsed.findTokenUsage).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// C-4: writeDurableSink에 빈 runId 전달 시 에러를 던진다
// ---------------------------------------------------------------------------
describe("C-4: `writeDurableSink` 빈 runId 검증", () => {
	test("runId가 빈 문자열이면 에러를 던진다", () => {
		expect(() => {
			writeDurableSink({ runId: "", found: 0, deduped: 0, dispatched: 0 });
		}).toThrow("writeDurableSink: runId must be non-empty");
	});
});

// ---------------------------------------------------------------------------
// C-2: CLI 숫자 인자 검증 — 빈 문자열과 비정수 소수점은 exit 1
// ---------------------------------------------------------------------------
describe("C-2: CLI 숫자 인자 검증", () => {
	test("빈 문자열 `found` 인자는 exit 1을 반환한다", () => {
		const { exitCode } = runCLI(["run-id", "", "3", "3"]);
		expect(exitCode).toBe(1);
	});

	test("소수점 `found` 인자는 exit 1을 반환한다", () => {
		const { exitCode } = runCLI(["run-id", "2.5", "3", "3"]);
		expect(exitCode).toBe(1);
	});

	test("빈 문자열 `deduped` 인자는 exit 1을 반환한다", () => {
		const { exitCode } = runCLI(["run-id", "5", "", "3"]);
		expect(exitCode).toBe(1);
	});

	test("빈 문자열 `dispatched` 인자는 exit 1을 반환한다", () => {
		const { exitCode } = runCLI(["run-id", "5", "3", ""]);
		expect(exitCode).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// C-3: findTokenUsageJson이 유효한 JSON이지만 객체가 아닐 때 null로 기록
// ---------------------------------------------------------------------------
describe("C-3: 비객체 JSON은 `findTokenUsage`를 null로 기록한다", () => {
	test("숫자 JSON은 `findTokenUsage`를 null로 기록하고 exit 0을 반환한다", () => {
		const r = runCLI(["run-id", "5", "3", "3", "42"]);
		expect(r.exitCode).toBe(0);
		const usagePath = join(tmpDir, "code-review", "run-id", "usage-summary.json");
		const parsed = JSON.parse(readFileSync(usagePath, "utf8"));
		expect(parsed.findTokenUsage).toBeNull();
	});

	test("배열 JSON은 `findTokenUsage`를 null로 기록하고 exit 0을 반환한다", () => {
		const r = runCLI(["run-id", "5", "3", "3", "[1,2,3]"]);
		expect(r.exitCode).toBe(0);
		const usagePath = join(tmpDir, "code-review", "run-id", "usage-summary.json");
		const parsed = JSON.parse(readFileSync(usagePath, "utf8"));
		expect(parsed.findTokenUsage).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// C-5: 잘못된 JSON — exit 0으로 fall-through, null 기록, stderr 경고
//   (round-2 exit(2)는 plan TODO-7 "persist what is available" 위반이었으므로 제거)
// ---------------------------------------------------------------------------
describe("C-5: malformed findTokenUsageJson은 null로 기록하고 exit 0을 반환한다", () => {
	test("malformed JSON은 exit 0을 반환한다", () => {
		const { exitCode } = runCLI(["run-id", "5", "3", "3", "{bad json}"]);
		expect(exitCode).toBe(0);
	});

	test("malformed JSON이어도 candidates.json이 기록된다", () => {
		runCLI(["run-id", "5", "3", "3", "{bad json}"]);
		const candidatesPath = join(tmpDir, "code-review", "run-id", "candidates.json");
		expect(existsSync(candidatesPath)).toBe(true);
	});

	test("malformed JSON이면 usage-summary.json의 findTokenUsage가 null로 기록된다", () => {
		runCLI(["run-id", "5", "3", "3", "{bad json}"]);
		const usagePath = join(tmpDir, "code-review", "run-id", "usage-summary.json");
		const parsed = JSON.parse(readFileSync(usagePath, "utf8"));
		expect(parsed.findTokenUsage).toBeNull();
	});

	test("malformed JSON은 stderr에 경고 메시지를 출력한다", () => {
		const { stderr } = runCLI(["run-id", "5", "3", "3", "{bad json}"]);
		expect(stderr).toContain("invalid findTokenUsageJson");
	});
});

// ---------------------------------------------------------------------------
// C-2b: 음수 인자 — exit 1 (non-negative 보장)
// ---------------------------------------------------------------------------
describe("C-2b: 음수 인자는 exit 1을 반환한다", () => {
	test("음수 `found` 인자는 exit 1을 반환하고 파일을 기록하지 않는다", () => {
		const { exitCode } = runCLI(["run-id", "-3", "3", "3"]);
		expect(exitCode).toBe(1);
		const candidatesPath = join(tmpDir, "code-review", "run-id", "candidates.json");
		expect(existsSync(candidatesPath)).toBe(false);
	});

	test("음수 `deduped` 인자는 exit 1을 반환한다", () => {
		const { exitCode } = runCLI(["run-id", "5", "-1", "3"]);
		expect(exitCode).toBe(1);
	});

	test("음수 `dispatched` 인자는 exit 1을 반환한다", () => {
		const { exitCode } = runCLI(["run-id", "5", "3", "-2"]);
		expect(exitCode).toBe(1);
	});
});
