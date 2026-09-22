import { expect, test, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runQaCase } from "@lib/qa-case-run.ts";
import { caseRunBindingComplete } from "@lib/qa-chain-core.ts";
import type { QaCaseRecord } from "@lib/qa-case-store.ts";
import { addActor, addStory, authorCell, readQaState, recordCell, setAcceptance, setQaState } from "./qa-state.ts";

let root: string;
const oldOmt = process.env.OMT_DIR;
const oldSid = process.env.OMT_SESSION_ID;
const sid = "binding-test";

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "qa-case-binding-"));
	process.env.OMT_DIR = join(root, "omt");
	process.env.OMT_SESSION_ID = sid;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (oldOmt === undefined) delete process.env.OMT_DIR; else process.env.OMT_DIR = oldOmt;
	if (oldSid === undefined) delete process.env.OMT_SESSION_ID; else process.env.OMT_SESSION_ID = oldSid;
});

test("실행 receipt를 현재 셀에 boundary evidence와 함께 바인딩한다", async () => {
	setQaState(sid, { phase: "PLAN" });
	setAcceptance(sid, ["runner result observed"]);
	addActor(sid, { id: "actor", name: "User", boundary: "terminal", driver: "bash", reachable: "yes" });
	addStory(sid, { id: "story", actor: "actor", contract: { goal: "run", given: ["case exists"], when: ["run"], then: ["result observed"], acceptance_criteria: [0] } });
	authorCell(sid, { story: "story", cls: 1, attackPoint: "run", priority: "H" });
	const casePath = join(root, "case.json");
	const record: QaCaseRecord = { id: "case", title: "case", goal: "run", given: ["case exists"], when: ["run"], then: ["result observed"], acceptance_criteria: ["runner result observed"], surface: "bash", runner: [process.execPath, "-e", "require('fs').writeFileSync(process.env.QA_ARTIFACTS_DIR + '/boundary.txt', 'observed')"], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset" };
	writeFileSync(casePath, JSON.stringify(record));
	const state = JSON.parse(readFileSync(join(process.env.OMT_DIR!, `qa-state-${sid}.json`), "utf8"));
	const storyHash = createHash("sha256").update(JSON.stringify(state.stories[0].contract)).digest("hex");
	const bytes = readFileSync(casePath);
	mkdirSync(join(root, "store"), { recursive: true });
	const result = await runQaCase(record, { casePath, caseRevision: createHash("sha256").update(bytes).digest("hex"), projectRoot: root, storeLocation: join(root, "store"), codeRef: "code", resetConfirmed: "reset", sessionId: sid, storyId: "story", cellClass: 1, cycle: 0, storyContractSha256: storyHash });
	const boundary = join(result.runDirectory, "boundary.txt");
	recordCell(sid, { story: "story", cls: 1, status: "pass", evidencePath: boundary, evidenceSurface: "bash", caseRun: result.receipt.artifact_paths.receipt });
	const persisted = readQaState(sid)?.cells?.find((cell) => cell.story === "story" && cell.cls === 1);
	expect(persisted?.status).toBe("pass");
	expect(persisted?.case_run?.case_id).toBe("case");
	expect(persisted?.case_run?.receipt_path).toBe(result.receipt.artifact_paths.receipt);
	expect(persisted?.case_run?.evidence_paths).toContain(boundary);
	expect(result.receipt.qa_result).toBe("not-recorded");
	const probe = (path: string) => { try { const bytes = readFileSync(path); return { exists: true, size: statSync(path).size, sha256: createHash("sha256").update(bytes).digest("hex") }; } catch { return { exists: false, size: 0, sha256: "" }; } };
	expect(caseRunBindingComplete(persisted!, probe)).toBe(true);
	writeFileSync(boundary, "changed after record");
	expect(caseRunBindingComplete(persisted!, probe)).toBe(false);
});

async function bindingFixture() {
	setQaState(sid, { phase: "PLAN" });
	setAcceptance(sid, ["runner result observed"]);
	addActor(sid, { id: "actor", name: "User", boundary: "terminal", driver: "bash", reachable: "yes" });
	addStory(sid, { id: "story", actor: "actor", contract: { goal: "run", given: ["case exists"], when: ["run"], then: ["result observed"], acceptance_criteria: [0] } });
	authorCell(sid, { story: "story", cls: 1, attackPoint: "run", priority: "H" });
	const casePath = join(root, "case.json");
	const nativePath = join(root, "native.txt"); writeFileSync(nativePath, "native");
	const record: QaCaseRecord = { id: "case", title: "case", goal: "run", given: ["case exists"], when: ["run"], then: ["result observed"], acceptance_criteria: ["runner result observed"], surface: "bash", runner: [process.execPath, "-e", "require('fs').writeFileSync(process.env.QA_ARTIFACTS_DIR + '/boundary.txt', 'observed')"], execution_cwd: "{artifacts}", native_files: [nativePath], reset_description: "reset" };
	writeFileSync(casePath, JSON.stringify(record));
	const state = readQaState(sid)!;
	const storyHash = createHash("sha256").update(JSON.stringify(state.stories![0]!.contract)).digest("hex");
	const bytes = readFileSync(casePath);
	const store = join(root, "store"); mkdirSync(store, { recursive: true });
	const result = await runQaCase(record, { casePath, caseRevision: createHash("sha256").update(bytes).digest("hex"), projectRoot: root, storeLocation: store, codeRef: "code", resetConfirmed: "reset", sessionId: sid, storyId: "story", cellClass: 1, cycle: 0, storyContractSha256: storyHash });
	const receiptPath = result.receipt.artifact_paths.receipt;
	return { result, receiptPath, boundary: join(result.runDirectory, "boundary.txt"), casePath, nativePath };
}

test("receipt metadata mismatch and failed execution cannot bind", async () => {
	const fields: Array<[string, (receipt: Record<string, unknown>) => void, RegExp]> = [
		["session", (r) => { r.session_id = "other"; }, /current session\/story\/cell\/cycle/],
		["story", (r) => { r.story_id = "other"; }, /current session\/story\/cell\/cycle/],
		["cell", (r) => { r.cell = { cls: 2 }; }, /current session\/story\/cell\/cycle/],
		["cycle", (r) => { r.cycle = 1; }, /current session\/story\/cell\/cycle/],
		["contract", (r) => { r.story_contract_sha256 = "a".repeat(64); }, /story contract/],
		["surface", (r) => { r.surface = "curl"; }, /identity or surface/],
		["case", (r) => { r.case_id = "other"; }, /identity or surface/],
		["native-list", (r) => { r.native_files = [{ path: "/tmp/native", sha256: "a".repeat(64) }]; }, /native file list/],
		["exit", (r) => { r.exit_status = { code: 1, signal: null, timedout: false, max_buffer_exceeded: false }; }, /zero, non-timeout/],
		["timeout", (r) => { r.exit_status = { code: null, signal: "SIGKILL", timedout: true, max_buffer_exceeded: false }; }, /zero, non-timeout/],
	];
	for (const [, mutate, expected] of fields) {
		const fixture = await bindingFixture();
		const receipt = JSON.parse(readFileSync(fixture.receiptPath, "utf8")) as Record<string, unknown>;
		mutate(receipt); writeFileSync(fixture.receiptPath, JSON.stringify(receipt));
		expect(() => recordCell(sid, { story: "story", cls: 1, status: "pass", evidencePath: fixture.boundary, evidenceSurface: "bash", caseRun: fixture.receiptPath })).toThrow(expected);
		// isolate each table row from the next row's state files
		rmSync(root, { recursive: true, force: true });
		root = mkdtempSync(join(tmpdir(), "qa-case-binding-")); process.env.OMT_DIR = join(root, "omt");
	}
});

test("case와 native asset가 receipt 이후 변경되면 binding을 거부한다", async () => {
	for (const field of ["case", "native"] as const) {
		const fixture = await bindingFixture();
		writeFileSync(field === "case" ? fixture.casePath : fixture.nativePath, "changed before bind");
		expect(() => recordCell(sid, { story: "story", cls: 1, status: "pass", evidencePath: fixture.boundary, evidenceSurface: "bash", caseRun: fixture.receiptPath })).toThrow(field === "case" ? /case metadata revision/ : /native file hash/);
		rmSync(root, { recursive: true, force: true });
		root = mkdtempSync(join(tmpdir(), "qa-case-binding-")); process.env.OMT_DIR = join(root, "omt");
	}
});

test("현재 acceptance criteria가 바뀌면 receipt binding을 거부한다", async () => {
	const fixture = await bindingFixture();
	setAcceptance(sid, ["different criterion"]);
	expect(() => recordCell(sid, { story: "story", cls: 1, status: "pass", evidencePath: fixture.boundary, evidenceSurface: "bash", caseRun: fixture.receiptPath })).toThrow(/acceptance criteria/);
});

test("receipt artifact path가 run 밖을 가리키면 binding을 거부한다", async () => {
	const fixture = await bindingFixture();
	const receipt = JSON.parse(readFileSync(fixture.receiptPath, "utf8")) as Record<string, unknown>;
	receipt.artifact_paths = { ...(receipt.artifact_paths as Record<string, unknown>), stdout: join(root, "outside.log") };
	writeFileSync(fixture.receiptPath, JSON.stringify(receipt));
	expect(() => recordCell(sid, { story: "story", cls: 1, status: "pass", evidencePath: fixture.boundary, evidenceSurface: "bash", caseRun: fixture.receiptPath })).toThrow(/outside its run directory/);
});
