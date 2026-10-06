import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runQaCase } from "@lib/qa-case-run.ts";
import { configureQaCaseStore, getQaCase, saveQaCase, type QaCaseRecord } from "@lib/qa-case-store.ts";
import { addActor, addStory, authorScenario, completeQa, readQaState, recordCase, recordScenario, registerQaCaseRunReceipt, setAcceptance, setQaState } from "./qa-state.ts";

let root: string;
let home: string;
const oldOmt = process.env.OMT_DIR;
const oldSid = process.env.OMT_SESSION_ID;
const sid = "record-case-test";

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "qa-case-record-")));
	execFileSync("git", ["init", "-q", root]);
	home = join(root, "home");
	mkdirSync(home);
	process.env.OMT_DIR = join(root, "omt");
	process.env.OMT_SESSION_ID = sid;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (oldOmt === undefined) delete process.env.OMT_DIR; else process.env.OMT_DIR = oldOmt;
	if (oldSid === undefined) delete process.env.OMT_SESSION_ID; else process.env.OMT_SESSION_ID = oldSid;
});

const store = () => ({ cwd: root, home });
const scenarioOf = () => readQaState(sid)?.scenarios?.find((scenario) => scenario.story === "story" && scenario.id === "s1");

/** Authors one H scenario, saves a case in the store, replays it, and records the scenario as pass. */
async function fixture(opts: { exitCode?: number; register?: boolean; markPass?: boolean } = {}) {
	const { exitCode = 0, register = true, markPass = true } = opts;
	setQaState(sid, { phase: "PLAN" });
	setAcceptance(sid, ["runner result observed"]);
	addActor(sid, { id: "actor", name: "User", boundary: "terminal", driver: "bash", reachable: "yes", clientImpact: "none", clientImpactReason: "terminal output only; no client renders it" });
	addStory(sid, { id: "story", actor: "actor", contract: { goal: "run", given: ["case exists"], when: ["run"], then: ["result observed"], acceptance_criteria: [0] } });
	authorScenario(sid, { story: "story", id: "s1", title: "run the case", preconditions: "case exists", steps: ["run the runner"], expected: "result observed", whyNeeded: "covers the runner boundary", priority: "H", risks: [1] });
	const configured = configureQaCaseStore(join(root, "store"), { ...store(), allowProjectStorage: true });
	if (configured.status !== "configured") throw new Error("store not configured");
	const record: QaCaseRecord = { id: "case", title: "case", goal: "run", given: ["case exists"], when: ["run"], then: ["result observed"], feature_refs: ["checkout"], surface: "bash", runner: [process.execPath, "-e", `require('fs').writeFileSync(process.env.QA_ARTIFACTS_DIR + '/boundary.txt', 'observed'); process.exitCode=${exitCode}`], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset" };
	const saved = saveQaCase({ record, expectedRevision: null }, store());
	if (saved.status !== "ok" || !("path" in saved)) throw new Error("case not saved");
	const storyHash = createHash("sha256").update(JSON.stringify(readQaState(sid)!.stories![0]!.contract)).digest("hex");
	const result = await runQaCase(record, { casePath: saved.path, caseRevision: saved.revision, projectRoot: root, storeLocation: configured.location, codeRef: "code", resetConfirmed: "reset", sessionId: sid, storyId: "story", actorId: "actor", actorBoundary: "terminal", scenarioId: "s1", cycle: 0, storyContractSha256: storyHash });
	if (register) registerQaCaseRunReceipt(sid, result.receipt.artifact_paths.receipt, result.receipt.attempt_id, result.receiptSha256);
	const boundary = join(result.runDirectory, "boundary.txt");
	if (markPass) recordScenario(sid, { story: "story", scenario: "s1", status: "pass", evidencePath: boundary, evidenceSurface: "bash" });
	return { result, savedPath: saved.path, savedRevision: saved.revision, boundary, record };
}
const link = (extra: Record<string, unknown> = {}) => recordCase(sid, { story: "story", scenario: "s1", caseId: "case", store: store(), ...extra });

test("재생된 case를 pass 시나리오에 saved로 연결한다", async () => {
	const fx = await fixture();
	link();
	expect(scenarioOf()?.case).toEqual({ kind: "saved", id: "case", revision: fx.savedRevision, receipt_path: fx.result.receipt.artifact_paths.receipt, attempt_id: fx.result.receipt.attempt_id });
});

test("--none은 사유를 none으로 저장하고 빈 사유는 거부한다", async () => {
	await fixture();
	expect(() => recordCase(sid, { story: "story", scenario: "s1", none: "   ", store: store() })).toThrow("record-case: --none requires a nonblank reason");
	recordCase(sid, { story: "story", scenario: "s1", none: "일회성 데이터라 재생할 수 없음", store: store() });
	expect(scenarioOf()?.case).toEqual({ kind: "none", reason: "일회성 데이터라 재생할 수 없음" });
});

test("--case와 --none은 정확히 하나만 받는다", async () => {
	await fixture();
	const message = "record-case: exactly one of --case or --none is required";
	expect(() => recordCase(sid, { story: "story", scenario: "s1", store: store() })).toThrow(message);
	expect(() => recordCase(sid, { story: "story", scenario: "s1", caseId: "case", none: "x", store: store() })).toThrow(message);
});

test("pass가 아닌 시나리오와 이번 사이클에 없는 시나리오는 거부한다", async () => {
	await fixture({ markPass: false });
	expect(() => link()).toThrow('record-case: scenario story/s1 must be pass (current status: unrecorded)');
	expect(() => recordCase(sid, { story: "story", scenario: "nope", none: "x", store: store() })).toThrow("record-case: scenario story/nope is not authored in the current cycle");
});

test("저장소에 없는 case는 거부한다", async () => {
	await fixture();
	expect(() => link({ caseId: "missing" })).toThrow('record-case: case "missing" is not in the case store');
});

test("재생한 적 없으면 거부한다", async () => {
	await fixture({ register: false });
	expect(() => link()).toThrow(/no trusted replay receipt for case "case"/);
});

test("재생 뒤 case가 바뀌면 현재 revision의 receipt가 없어 거부한다", async () => {
	const fx = await fixture();
	const current = getQaCase("case", store());
	if (current.status !== "ok" || !("record" in current)) throw new Error("case missing");
	saveQaCase({ record: { ...current.record, title: "edited" }, expectedRevision: fx.savedRevision }, store());
	expect(() => link()).toThrow(/no trusted replay receipt for case "case" at its current revision/);
});

test("종료 상태가 깨끗하지 않은 재생은 거부한다", async () => {
	await fixture({ exitCode: 3 });
	expect(() => link()).toThrow(/did not exit cleanly/);
});

test("등록 뒤 receipt 바이트가 바뀌면 거부한다", async () => {
	const fx = await fixture();
	const path = fx.result.receipt.artifact_paths.receipt;
	writeFileSync(path, `${readFileSync(path, "utf8")} `);
	expect(() => link()).toThrow(/receipt bytes changed since registration/);
});

test("record-scenario를 다시 기록하면 case 연결이 지워진다", async () => {
	const fx = await fixture();
	link();
	recordScenario(sid, { story: "story", scenario: "s1", status: "pass", evidencePath: fx.boundary, evidenceSurface: "bash" });
	expect(scenarioOf()?.case).toBeUndefined();
});

test("complete는 case도 사유도 없는 H pass 시나리오를 명령 형태와 함께 거부한다", async () => {
	await fixture();
	expect(() => completeQa(sid)).toThrow('record-case --story story --scenario s1 (--case <id> | --none "<reason>")');
	recordCase(sid, { story: "story", scenario: "s1", none: "일회성 데이터", store: store() });
	expect(() => completeQa(sid)).not.toThrow(/record-case/);
});
