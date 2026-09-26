import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { QaCaseRunReceipt } from "@lib/qa-case-run.ts";
import { configureQaCaseStore, disableQaCaseStore, saveQaCase, type QaCaseRecord } from "@lib/qa-case-store.ts";
import { replayFromCli } from "./qa-replay.ts";
import { addActor, addStory, authorCell, incCycle, readQaState, recordCell, setAcceptance, setQaState } from "./qa-state.ts";

const roots: string[] = [];
const manifestDirs: string[] = [];
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	for (const path of manifestDirs.splice(0)) rmSync(path, { recursive: true, force: true });
	if (originalOmtDir === undefined) delete process.env.OMT_DIR; else process.env.OMT_DIR = originalOmtDir;
	if (originalSessionId === undefined) delete process.env.OMT_SESSION_ID; else process.env.OMT_SESSION_ID = originalSessionId;
});

function readyChain(session: string): void {
	setQaState(session, { phase: "PLAN" });
	setAcceptance(session, ["The runner boundary is observed"]);
	addActor(session, { id: "actor", name: "User", boundary: "terminal", driver: "bash", reachable: "yes" });
	addStory(session, { id: "story", actor: "actor", contract: { goal: "Run the boundary", given: ["The case exists"], when: ["The user runs it"], then: ["The result is observed"], acceptance_criteria: [0] } });
	incCycle(session);
	for (const cls of [1, 2, 3, 4, 5, 6] as const) authorCell(session, { story: "story", cls, attackPoint: `attack ${cls}`, priority: cls === 1 ? "H" : "M" });
	authorCell(session, { story: "story", cls: 1, sub: "hang-timeout", attackPoint: "hang", priority: "M" });
	authorCell(session, { story: "story", cls: 5, sub: "flaky-green", attackPoint: "flaky", priority: "M" });
}

function saveCase(root: string, record: QaCaseRecord, home: string): void {
	const result = saveQaCase({ record, expectedRevision: null }, { cwd: root, home });
	if (result.status !== "ok") throw new Error("case fixture was not saved");
}

function runCli(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync("bun", ["skills/qa/scripts/qa-replay.ts", ...args], { encoding: "utf8", env });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("qa replay CLI", () => {
	test("도움말에 chain gate와 비샌드박스 경고를 표시한다", () => {
		const output = execFileSync("bun", ["skills/qa/scripts/qa-replay.ts", "--help"], { encoding: "utf8" });
		expect(output).toContain("actor→story→cell");
		expect(output).toContain("not sandboxed");
		expect(output).toContain("--timeout-ms N");
		expect(output).toContain("--max-buffer N");
	});

	test("CLI exit wrapper는 lookup 상태를 실패로 전달하고 help/null은 성공으로 둔다", () => {
		const script = "import { replayExitCode } from './skills/qa/scripts/qa-replay.ts'; const value = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify(value)+'\\n'); process.exit(replayExitCode(value));";
		for (const status of ["unconfigured", "disabled", "not_found"]) {
			const value = JSON.stringify({ status });
			expect(() => execFileSync("bun", ["-e", script, value], { encoding: "utf8", cwd: process.cwd() })).toThrow();
		}
		const help = execFileSync("bun", ["-e", script, "null"], { encoding: "utf8", cwd: process.cwd() });
		expect(help.trim()).toBe("null");
	});

	test("불완전 chain에서는 native runner를 실행하지 않는다", async () => {
		const root = mkdtempSync(join(tmpdir(), "qa-replay-cli-"));
		roots.push(root);
		const session = "replay-cli-session";
		process.env.OMT_DIR = join(root, "omt");
		process.env.OMT_SESSION_ID = session;
		await expect(replayFromCli(["--case", "cli-case", "--story", "story", "--cls", "1", "--project", process.cwd(), "--code-ref", "code", "--reset-confirmed", "reset"])).rejects.toThrow(/active QA state|chainComplete/);
	});

	test("잘못된 timeout과 buffer 제한값은 case lookup 전에 거부한다", async () => {
		const rawRoot = mkdtempSync(join(tmpdir(), "qa-replay-cli-invalid-limits-")); roots.push(rawRoot);
		const root = realpathSync(rawRoot);
		const session = "cli-invalid-limits-session";
		process.env.OMT_DIR = join(root, "omt"); process.env.OMT_SESSION_ID = session;
		readyChain(session); setQaState(session, { phase: "BASELINE" });
		const baseArgs = ["--case", "missing-case", "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset"];
		await expect(replayFromCli([...baseArgs, "--timeout-ms", "0"])).rejects.toThrow("--timeout-ms must be a finite positive number");
		await expect(replayFromCli([...baseArgs, "--max-buffer", "Infinity"])).rejects.toThrow("--max-buffer must be a finite positive number");
	});

	test("PLAN 단계에서는 replay를 막고 BASELINE부터 허용한다", async () => {
		const rawRoot = mkdtempSync(join(tmpdir(), "qa-replay-phase-guard-")); roots.push(rawRoot);
		const root = realpathSync(rawRoot);
		const store = join(root, "store");
		const session = "phase-guard-session";
		process.env.OMT_DIR = join(root, "omt"); process.env.OMT_SESSION_ID = session;
		const home = join(root, "home");
		mkdirSync(home, { recursive: true });
		const configured = configureQaCaseStore(store, { cwd: root, home, allowProjectStorage: true });
		manifestDirs.push(join(configured.manifestPath, ".."));
		readyChain(session);
		const record: QaCaseRecord = { id: "phase-guard-case", title: "CLI", goal: "run", given: ["case exists"], when: ["run"], then: ["observed"], acceptance_criteria: ["The runner boundary is observed"], surface: "bash", runner: [process.execPath, "-e", "process.stdout.write('ok')"], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset" };
		saveCase(root, record, home);

		await expect(replayFromCli(["--case", record.id, "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset"], { home })).rejects.toThrow(/left PLAN|BASELINE/);
		setQaState(session, { phase: "BASELINE" });
		const receipt = await replayFromCli(["--case", record.id, "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset"], { home });
		expect((receipt as { qa_result: string }).qa_result).toBe("not-recorded");
	});

	test("완전한 CLI chain에서 case를 실행하고 receipt를 반환한다", async () => {
		const rawRoot = mkdtempSync(join(tmpdir(), "qa-replay-valid-")); roots.push(rawRoot);
		const root = realpathSync(rawRoot);
		const store = join(root, "store");
		process.env.OMT_DIR = join(root, "omt"); process.env.OMT_SESSION_ID = "valid-session";
		const home = join(root, "home");
		mkdirSync(home, { recursive: true });
		const configured = configureQaCaseStore(store, { cwd: root, home, allowProjectStorage: true });
		manifestDirs.push(join(configured.manifestPath, ".."));
		readyChain("valid-session");
		setQaState("valid-session", { phase: "BASELINE" });
		const record: QaCaseRecord = { id: "cli-case", title: "CLI", goal: "run", given: ["case exists"], when: ["run"], then: ["observed"], acceptance_criteria: ["The runner boundary is observed"], surface: "bash", runner: [process.execPath, "-e", "process.stdout.write('ok')"], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset" };
		saveCase(root, record, home);
		const receipt = await replayFromCli(["--case", "cli-case", "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset"], { home });
		expect((receipt as { qa_result: string }).qa_result).toBe("not-recorded");
		expect((receipt as { actor_id: string }).actor_id).toBe("actor");
		expect((receipt as { actor_boundary: string }).actor_boundary).toBe("terminal");
	});

	test("CLI의 --timeout-ms가 timedout receipt를 기록한다", () => {
		const rawRoot = mkdtempSync(join(tmpdir(), "qa-replay-cli-timeout-")); roots.push(rawRoot);
		const root = realpathSync(rawRoot);
		const store = join(root, "store");
		const session = "cli-timeout-session";
		const home = join(root, "home");
		process.env.OMT_DIR = join(root, "omt"); process.env.OMT_SESSION_ID = session;
		mkdirSync(home, { recursive: true });
		const configured = configureQaCaseStore(store, { cwd: root, home, allowProjectStorage: true });
		manifestDirs.push(join(configured.manifestPath, ".."));
		readyChain(session); setQaState(session, { phase: "BASELINE" });
		const record: QaCaseRecord = {
			id: "cli-timeout-case", title: "CLI timeout", goal: "run", given: ["case exists"], when: ["run"], then: ["timed out"],
			acceptance_criteria: ["The runner boundary is observed"], surface: "bash",
			runner: [process.execPath, "-e", "setTimeout(() => {}, 1000)"], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset",
		};
		saveCase(root, record, home);
		const result = runCli(["--case", record.id, "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset", "--timeout-ms", "25"], { ...process.env, HOME: home });
		expect(result.status).toBe(1);
		const receipt = JSON.parse(result.stdout) as QaCaseRunReceipt;
		expect(receipt.exit_status.timedout).toBe(true);
	});

	test("CLI의 --max-buffer가 max_buffer_exceeded receipt를 기록한다", () => {
		const rawRoot = mkdtempSync(join(tmpdir(), "qa-replay-cli-buffer-")); roots.push(rawRoot);
		const root = realpathSync(rawRoot);
		const store = join(root, "store");
		const session = "cli-buffer-session";
		const home = join(root, "home");
		process.env.OMT_DIR = join(root, "omt"); process.env.OMT_SESSION_ID = session;
		mkdirSync(home, { recursive: true });
		const configured = configureQaCaseStore(store, { cwd: root, home, allowProjectStorage: true });
		manifestDirs.push(join(configured.manifestPath, ".."));
		readyChain(session); setQaState(session, { phase: "BASELINE" });
		const record: QaCaseRecord = {
			id: "cli-buffer-case", title: "CLI buffer", goal: "run", given: ["case exists"], when: ["run"], then: ["buffer exceeded"],
			acceptance_criteria: ["The runner boundary is observed"], surface: "bash",
			runner: [process.execPath, "-e", "process.stdout.write('x'.repeat(1024))"], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset",
		};
		saveCase(root, record, home);
		const result = runCli(["--case", record.id, "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset", "--max-buffer", "128"], { ...process.env, HOME: home });
		expect(result.status).toBe(1);
		const receipt = JSON.parse(result.stdout) as QaCaseRunReceipt;
		expect(receipt.exit_status.max_buffer_exceeded).toBe(true);
	});

	test("CLI replay가 runner 원본 receipt digest를 등록하고 변조 receipt의 PASS 바인딩을 거부한다", async () => {
		const rawRoot = mkdtempSync(join(tmpdir(), "qa-replay-trusted-receipt-")); roots.push(rawRoot);
		const root = realpathSync(rawRoot);
		const store = join(root, "store");
		const session = "trusted-receipt-session";
		process.env.OMT_DIR = join(root, "omt"); process.env.OMT_SESSION_ID = session;
		const home = join(root, "home");
		mkdirSync(home, { recursive: true });
		const configured = configureQaCaseStore(store, { cwd: root, home, allowProjectStorage: true });
		manifestDirs.push(join(configured.manifestPath, ".."));
		readyChain(session);
		setQaState(session, { phase: "BASELINE" });
		const record: QaCaseRecord = {
			id: "trusted-receipt-case", title: "CLI", goal: "run", given: ["case exists"], when: ["run"], then: ["observed"],
			acceptance_criteria: ["The runner boundary is observed"], surface: "bash",
			runner: [process.execPath, "-e", "require('fs').writeFileSync(process.env.QA_ARTIFACTS_DIR + '/boundary.txt', 'observed'); process.exit(19)"],
			execution_cwd: "{artifacts}", native_files: [], reset_description: "reset",
		};
		saveCase(root, record, home);

		const receipt = await replayFromCli(["--case", record.id, "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset"], { home }) as QaCaseRunReceipt;
		const state = readQaState(session)!;
		const trusted = state.trusted_receipts?.find((entry) => entry.attempt_id === receipt.attempt_id);
		expect(trusted).toEqual({ attempt_id: receipt.attempt_id, receipt_path: receipt.artifact_paths.receipt, sha256: expect.any(String) });
		expect(trusted?.sha256).toBe(createHash("sha256").update(readFileSync(receipt.artifact_paths.receipt)).digest("hex"));
		expect(receipt.qa_result).toBe("not-recorded");
		expect(receipt.exit_status.code).toBe(19);

		const mutated = JSON.parse(readFileSync(receipt.artifact_paths.receipt, "utf8")) as QaCaseRunReceipt;
		mutated.exit_status = { code: 0, signal: null, timedout: false, max_buffer_exceeded: false };
		delete mutated.start_error;
		writeFileSync(receipt.artifact_paths.receipt, JSON.stringify(mutated));
		const boundary = join(dirname(receipt.artifact_paths.receipt), "boundary.txt");
		expect(() => recordCell(session, { story: "story", cls: 1, status: "pass", evidencePath: boundary, evidenceSurface: "bash", caseRun: receipt.artifact_paths.receipt })).toThrow(/digest does not match trusted registration/);
		expect(readQaState(session)?.cells?.find((cell) => cell.story === "story" && cell.cls === 1)?.status).toBeUndefined();
	});

	test("surface와 AC mismatch는 runner 실행 전에 거부하고 disabled store는 실행하지 않는다", async () => {
		const rawRoot = mkdtempSync(join(tmpdir(), "qa-replay-gates-")); roots.push(rawRoot);
		const root = realpathSync(rawRoot);
		const store = join(root, "store");
		process.env.OMT_DIR = join(root, "omt"); process.env.OMT_SESSION_ID = "gate-session";
		const home = join(root, "home");
		mkdirSync(home, { recursive: true });
		const configured = configureQaCaseStore(store, { cwd: root, home, allowProjectStorage: true });
		manifestDirs.push(join(configured.manifestPath, "..")); readyChain("gate-session");
		setQaState("gate-session", { phase: "BASELINE" });
		const base: QaCaseRecord = { id: "gate-case", title: "CLI", goal: "run", given: ["case exists"], when: ["run"], then: ["observed"], acceptance_criteria: ["wrong AC"], surface: "curl", runner: [process.execPath, "-e", "process.exit(99)"], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset" };
		saveCase(root, base, home);
		await expect(replayFromCli(["--case", "gate-case", "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset"], { home })).rejects.toThrow(/surface/);
		const acRecord = { ...base, id: "ac-case", surface: "bash" as const };
		saveQaCase({ record: acRecord, expectedRevision: null }, { cwd: root, home });
		await expect(replayFromCli(["--case", "ac-case", "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset"], { home })).rejects.toThrow(/acceptance/);
		disableQaCaseStore({ cwd: root, home });
		const disabled = await replayFromCli(["--case", "gate-case", "--story", "story", "--cls", "1", "--project", root, "--code-ref", "code", "--reset-confirmed", "reset"], { home });
		expect(disabled).toMatchObject({ status: "disabled" });
	});
});
