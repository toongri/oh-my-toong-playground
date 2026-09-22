import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { runQaCase, readQaCaseRunReceipt, validateQaCaseRunReceipt, type QaCaseRunContext } from "@lib/qa-case-run.ts";
import type { QaCaseRecord } from "@lib/qa-case-store.ts";

const roots: string[] = [];
function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "qa-case-run-"));
	roots.push(root);
	return root;
}
function record(root: string, runner: string[]): QaCaseRecord {
	const native = join(root, "fixture.txt");
	writeFileSync(native, "before\n");
	const value = {
		id: "native-replay",
		title: "Native replay",
		goal: "exercise a fixture",
		given: ["fixture exists"],
		when: ["runner starts"],
		then: ["receipt is written"],
		acceptance_criteria: ["receipt exists"],
		surface: "bash" as const,
		runner,
		execution_cwd: "{artifacts}",
		native_files: [native],
		reset_description: "Reset fixture to before",
	};
	writeFileSync(join(root, "case.json"), `${JSON.stringify(value)}\n`);
	return value;
}
function context(root: string, overrides: Partial<QaCaseRunContext> = {}): QaCaseRunContext {
	const bytes = readFileSync(join(root, "case.json"));
	return {
		casePath: join(root, "case.json"),
		caseRevision: createHash("sha256").update(bytes).digest("hex"),
		projectRoot: root,
		storeLocation: root,
		codeRef: "fixture-code",
		resetConfirmed: "Reset fixture to before",
		cycle: 1,
		...overrides,
	};
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("qa case native replay", () => {
	test("셸 재해석 없이 argv를 실행하고 영수증을 저장한다", async () => {
		const root = tempDir();
		const result = await runQaCase(record(root, [process.execPath, "-e", "process.stdout.write(process.argv[1])", "a;echo-no-shell"]), context(root));
		expect(result.receipt.exit_status.code).toBe(0);
		expect(readFileSync(result.receipt.artifact_paths.stdout, "utf8")).toBe("a;echo-no-shell");
		expect(result.receipt.surface).toBe("bash");
		expect(result.receipt.native_files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(readQaCaseRunReceipt(result.receipt.artifact_paths.receipt)).toEqual(result.receipt);
	});

	test("실패를 QA 통과로 변환하지 않고 기록한다", async () => {
		const root = tempDir();
		const result = await runQaCase(record(root, [process.execPath, "-e", "process.stderr.write('bad'); process.exit(7)"]), context(root));
		expect(result.receipt.exit_status.code).toBe(7);
		expect(result.receipt.qa_result).toBe("not-recorded");
		expect(readFileSync(result.receipt.artifact_paths.stderr, "utf8")).toBe("bad");
	});

	test("artifacts cwd와 argv 토큰을 외부 실행 디렉터리로 확장한다", async () => {
		const root = tempDir();
		const result = await runQaCase(record(root, [process.execPath, "-e", "const fs=require('fs'); fs.writeFileSync(process.argv[1], process.cwd())", "{artifacts}/created.txt"]), context(root));
		expect(result.receipt.cwd).toBe(result.runDirectory);
		expect(result.receipt.argv.at(-1)).toBe(join(result.runDirectory, "created.txt"));
		expect(readFileSync(join(result.runDirectory, "created.txt"), "utf8")).toBe(result.runDirectory);
	});

	test("명시적 opt-in 없는 제품 cwd를 거부한다", async () => {
		const root = tempDir();
		await expect(runQaCase({ ...record(root, [process.execPath, "-e", "0"]), execution_cwd: root }, context(root))).rejects.toThrow(/allow-project-cwd/);
	});

	test("실행 중 변경된 native 파일을 거부한다", async () => {
		const root = tempDir();
		const native = join(root, "fixture.txt");
		const promise = runQaCase(record(root, [process.execPath, "-e", "setTimeout(() => {}, 80)"]), context(root));
		setTimeout(() => writeFileSync(native, "changed\n"), 20);
		await expect(promise).rejects.toThrow(/native file changed/);
	});

	test("정확한 reset 확인을 요구하고 정지 runner를 제한한다", async () => {
		const root = tempDir();
		await expect(runQaCase(record(root, [process.execPath, "-e", "setTimeout(() => {}, 500)"]), context(root, { resetConfirmed: "guessed" }))).rejects.toThrow(/reset confirmation/);
		const result = await runQaCase(record(root, [process.execPath, "-e", "setTimeout(() => {}, 500)"]), context(root, { timeoutMs: 30 }));
		expect(result.receipt.exit_status.timedout).toBe(true);
		expect(result.receipt.exit_status.code).not.toBe(0);
	});

	test("artifacts cwd suffix를 보존하고 canonical symlink escape를 거부한다", async () => {
		const root = tempDir();
		const recordValue = record(root, [process.execPath, "-e", "process.stdout.write(process.cwd())"]);
		const sub = join(root, "sub");
		mkdirSync(sub);
		await expect(runQaCase({ ...recordValue, execution_cwd: "{artifacts}/sub" }, context(root))).rejects.toThrow(/cwd/);
		const outside = tempDir();
		const link = join(root, "link-out");
		symlinkSync(outside, link);
		await expect(runQaCase({ ...recordValue, execution_cwd: link }, context(root, { allowProjectCwd: true }))).rejects.toThrow(/outside|product cwd|symlink/);
		await expect(runQaCase({ ...recordValue, execution_cwd: "{artifacts}/../../../" }, context(root, { allowProjectCwd: true }))).rejects.toThrow(/escapes artifacts/);
	});

	test("유효하지 않은 timeout/maxBuffer와 cycle은 spawn 전에 거부한다", async () => {
		const root = tempDir();
		for (const overrides of [{ timeoutMs: 0 }, { timeoutMs: Number.NaN }, { timeoutMs: Number.POSITIVE_INFINITY }, { maxBuffer: 0 }, { maxBuffer: Number.NaN }, { cycle: -1 }]) {
			await expect(runQaCase(record(root, [process.execPath, "-e", "process.exit(99)"]), context(root, overrides))).rejects.toThrow(/timeoutMs|maxBuffer|cycle/);
		}
	});

	test("SIGTERM을 무시하는 runner도 bounded timeout으로 종료한다", async () => {
		const root = tempDir();
		const started = Date.now();
		const result = await runQaCase(record(root, [process.execPath, "-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"]), context(root, { timeoutMs: 25 }));
		expect(result.receipt.exit_status.timedout).toBe(true);
		expect(Date.now() - started).toBeLessThan(1500);
	});

	test("receipt validator가 필수 중첩 필드를 검증한다", () => {
		expect(() => validateQaCaseRunReceipt({ version: 1, case_id: "x", artifact_paths: {} })).toThrow(/invalid run receipt/);
	});

	test("receipt 소비 시 stdout/stderr artifact hash를 검증한다", async () => {
		const root = tempDir();
		const result = await runQaCase(record(root, [process.execPath, "-e", "process.stdout.write('ok')"]), context(root));
		writeFileSync(result.receipt.artifact_paths.stdout, "tampered");
		expect(() => readQaCaseRunReceipt(result.receipt.artifact_paths.receipt)).toThrow(/artifact hash/);
	});

	test("비 UTF-8 stdout도 원본 바이트 hash와 함께 receipt를 검증한다", async () => {
		const root = tempDir();
		const result = await runQaCase(record(root, [process.execPath, "-e", "process.stdout.write(Buffer.from([255,0,1]))"]), context(root));
		expect(readFileSync(result.receipt.artifact_paths.stdout)).toEqual(Buffer.from([255, 0, 1]));
		expect(readQaCaseRunReceipt(result.receipt.artifact_paths.receipt)).toEqual(result.receipt);
	});

	test("runner 시작 실패도 로그와 start_error receipt를 남긴다", async () => {
		const root = tempDir();
		const result = await runQaCase(record(root, [join(root, "missing-runner")]), context(root, { actorId: "actor-1", actorBoundary: "terminal" }));
		expect(result.receipt.exit_status.code).toBeNull();
		expect(result.receipt.start_error?.message).toContain("ENOENT");
		expect(result.receipt.actor_id).toBe("actor-1");
		expect(result.receipt.actor_boundary).toBe("terminal");
		expect(readQaCaseRunReceipt(result.receipt.artifact_paths.receipt).start_error?.code).toBe("ENOENT");
		expect(readFileSync(result.receipt.artifact_paths.stdout)).toEqual(Buffer.alloc(0));
		expect(readFileSync(result.receipt.artifact_paths.stderr)).toEqual(Buffer.alloc(0));
	});
});
