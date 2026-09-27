import { recordResource, releaseResource, unreleasedResources } from "@lib/session-resources";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

import {
	readQaState,
	setQaState,
	advancePhase,
	incCycle,
	completeQa,
	forceCompleteQa,
	startQa,
	setVerdict,
	setAwaitingUser,
	resolveStatePath,
	type QaState,
} from "./qa-state.ts";
import { chainComplete, approveOk } from "@lib/qa-chain-core";

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const S = "test-session";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "qa-state-test-"));
	process.env.OMT_DIR = tmpDir;
	process.env.OMT_SESSION_ID = S;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalOmtDir !== undefined) {
		process.env.OMT_DIR = originalOmtDir;
	} else {
		delete process.env.OMT_DIR;
	}
	if (originalSessionId !== undefined) {
		process.env.OMT_SESSION_ID = originalSessionId;
	} else {
		delete process.env.OMT_SESSION_ID;
	}
});

function rawState(sid: string = S): any {
	return JSON.parse(readFileSync(resolveStatePath(sid), "utf8"));
}

describe("qa state: seed shape", () => {
	// Switch-exhaustiveness proxy: seeding via the CLI (any writer) must produce the
	// qa-specific seed shape — not a default/other-skill shape (goal's outcome/iteration,
	// or deep-interview's bare active/started_at/last_touched_at).
	test("seeding via a writer produces the qa-specific seed shape, not a default/other-skill shape", () => {
		const fresh = "fresh-qa-session";
		expect(existsSync(resolveStatePath(fresh))).toBe(false);
		setQaState(fresh, { phase: "PRE-FLIGHT" });
		const raw = rawState(fresh);
		expect(raw).toMatchObject({
			active: true,
			phase: "PRE-FLIGHT",
			cycle: 0,
			max_cycles: 5,
			target: "",
		});
		expect(raw).toHaveProperty("started_at");
		expect(raw).toHaveProperty("last_touched_at");
		// Not goal's shape
		expect(raw).not.toHaveProperty("outcome");
		expect(raw).not.toHaveProperty("iteration");
		// Not deep-interview's bare shape (would lack phase/cycle entirely if that arm fired)
		expect(raw).toHaveProperty("phase");
		expect(raw).toHaveProperty("cycle");
	});

	// (self-heal-qa) qa CLI seeds the pristine skeleton when the state file is absent —
	// mirrors goal-state.ts's ensureSeed self-heal pattern (slash-command hook-miss path).
	test("(self-heal-qa) setQaState seeds then succeeds when state file is absent", () => {
		const absentSid = "absent-qa-session";
		expect(existsSync(resolveStatePath(absentSid))).toBe(false);
		expect(() => setQaState(absentSid, { phase: "PRE-FLIGHT" })).not.toThrow();
		expect(existsSync(resolveStatePath(absentSid))).toBe(true);
		expect(readQaState(absentSid)!.phase).toBe("PRE-FLIGHT");
	});

	test("schema enumerates all required fields", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		const s = rawState();
		expect(s).toHaveProperty("active");
		expect(s).toHaveProperty("phase");
		expect(s).toHaveProperty("cycle");
		expect(s).toHaveProperty("max_cycles");
		expect(s).toHaveProperty("target");
		expect(s).toHaveProperty("started_at");
		expect(s).toHaveProperty("last_touched_at");
	});
});

describe("qa state: phase/target round-trip", () => {
	test("legacy story without contract remains readable but cannot become execution-ready", () => {
		setQaState(S, { phase: "PLAN" });
		const legacy = rawState();
		legacy.acceptance_criteria = undefined;
		legacy.actors = [{ id: "actor", name: "User", boundary: "home", driver: "bash", reachable: "yes" }];
		legacy.stories = [{ id: "story", actor: "actor" }];
		writeFileSync(resolveStatePath(S), JSON.stringify(legacy));
		const readable = readQaState(S)!;
		expect(readable.stories?.[0]?.contract).toBeUndefined();
		expect(chainComplete(readable)).toBe(false);
		expect(approveOk(readable, () => ({ exists: false, size: 0 }))).toBe(false);
		incCycle(S);
		expect(chainComplete(readQaState(S)!)).toBe(false);
	});

	test("set then get round-trips phase and target; cycle stays 0", () => {
		setQaState(S, { phase: "PLAN", target: "verify feature X" });
		const state = readQaState(S)!;
		expect(state.phase).toBe("PLAN");
		expect(state.target).toBe("verify feature X");
		expect(state.cycle).toBe(0);
	});

	test("set preserves prior target when omitted; started_at seeded once", () => {
		setQaState(S, { phase: "PRE-FLIGHT", target: "feature Y" });
		const first = readQaState(S)!;
		setQaState(S, { phase: "PLAN" });
		const second = readQaState(S)!;
		expect(second.phase).toBe("PLAN");
		expect(second.target).toBe("feature Y");
		expect(second.started_at).toBe(first.started_at);
	});

	test("set rejects an out-of-enum phase", () => {
		expect(() => setQaState(S, { phase: "BOGUS-PHASE" })).toThrow();
	});

	test("set rejects ROLLBACK as a removed phase", () => {
		expect(() => setQaState(S, { phase: "ROLLBACK" })).toThrow(/phase must be one of/);
	});

	test("advance-phase writes phase without touching target", () => {
		setQaState(S, { phase: "PRE-FLIGHT", target: "feature Z" });
		advancePhase(S, "PLAN");
		const state = readQaState(S)!;
		expect(state.phase).toBe("PLAN");
		expect(state.target).toBe("feature Z");
	});

	test("advance-phase rejects an out-of-enum phase", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		expect(() => advancePhase(S, "NOT-A-PHASE")).toThrow();
	});

	test("advance-phase rejects ROLLBACK as a removed phase", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		expect(() => advancePhase(S, "ROLLBACK")).toThrow(/phase must be one of/);
	});
});

describe("qa state: cycle counting", () => {
	test("inc-cycle increments; terminate signaled at cycle===max_cycles(5)", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		let last: { cycle: number; terminate: boolean } | undefined;
		for (let i = 1; i <= 5; i++) {
			last = incCycle(S);
			expect(last.cycle).toBe(i);
			expect(last.terminate).toBe(i === 5);
		}
		expect(readQaState(S)!.cycle).toBe(5);
	});

	test("inc-cycle refuses to increment past max_cycles once terminate is reached", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		for (let i = 0; i < 5; i++) incCycle(S);
		expect(() => incCycle(S)).toThrow();
		// state unchanged at the cap
		expect(readQaState(S)!.cycle).toBe(5);
	});
});

describe("qa state: terminal completion (P2 finding 1 — no active:false resurrection)", () => {
	test("completeQa marks active:false so readQaState no longer restores the session", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		advancePhase(S, "PLAN");
		expect(readQaState(S)).not.toBeNull();
		setVerdict(S, "REQUEST_CHANGES");
		completeQa(S);
		expect(readQaState(S)).toBeNull();
		// but the underlying file still exists (inactive, not deleted)
		expect(existsSync(resolveStatePath(S))).toBe(true);
		expect(rawState().active).toBe(false);
	});
});

describe("qa state: background resource gate", () => {
	test("complete refuses while a recorded resource is unreleased, then succeeds after release", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		advancePhase(S, "PLAN");
		setVerdict(S, "REQUEST_CHANGES");
		recordResource(S, { id: "emulator-5554", kind: "emulator", stop: "true" });
		expect(() => completeQa(S)).toThrow("qa-state.ts release-resource --id emulator-5554");
		expect(rawState().active).not.toBe(false);
		releaseResource(S, "emulator-5554");
		completeQa(S);
		expect(rawState().active).toBe(false);
	});
});

describe("qa state: user-only force-complete", () => {
	test("ends an ungated cycle inactive and records the reason", () => {
		setQaState(S, { phase: "PLAN", target: "stuck" });
		forceCompleteQa(S, "  gates keep failing on a harness limit  ");
		const raw = rawState();
		expect(raw.active).toBe(false);
		expect(raw.forced_complete).toBe(true);
		expect(raw.forced_reason).toBe("gates keep failing on a harness limit");
	});

	test("refuses without a reason, and on an inactive cycle", () => {
		setQaState(S, { phase: "PLAN" });
		expect(() => forceCompleteQa(S, "  ")).toThrow("--reason is required");
		forceCompleteQa(S, "done");
		expect(() => forceCompleteQa(S, "again")).toThrow("no active qa cycle");
	});

	test("releases resources it can, and returns the ones whose stop command failed without blocking", () => {
		setQaState(S, { phase: "PLAN" });
		recordResource(S, { id: "sim-ok", kind: "simulator", stop: "true" });
		recordResource(S, { id: "emu-stuck", kind: "emulator", stop: "exit 3" });
		const failed = forceCompleteQa(S, "user ended the cycle");
		expect(failed.map((f) => f.id)).toEqual(["emu-stuck"]);
		expect(unreleasedResources(S).map((r) => r.id)).toEqual(["emu-stuck"]);
		expect(rawState().active).toBe(false);
	});

	test("a start that lands while resources are being released keeps its new cycle active", () => {
		setQaState(S, { phase: "PLAN" });
		const script = join(import.meta.dir, "qa-state.ts");
		// The stop command itself opens the next cycle, the way a concurrent
		// session would during a slow release. The stop shell does not inherit
		// this test's process.env edits, so the isolated OMT_DIR/session are
		// passed explicitly — otherwise it writes to the developer's real session.
		const env = `OMT_DIR='${tmpDir}' OMT_SESSION_ID='${S}'`;
		recordResource(S, { id: "sim-racing", kind: "simulator", stop: `${env} bun ${script} start --target next-cycle >/dev/null` });
		expect(forceCompleteQa(S, "user ended the cycle")).toEqual([]);
		const raw = rawState();
		expect(raw.active).toBe(true);
		expect(raw.target).toBe("next-cycle");
		expect(raw.forced_complete).toBeUndefined();
	});

	test("a fresh start clears the forced marker", () => {
		setQaState(S, { phase: "PLAN" });
		forceCompleteQa(S, "done");
		startQa(S, "next target");
		const raw = rawState();
		expect(raw.active).toBe(true);
		expect(raw.forced_complete).toBeUndefined();
		expect(raw.forced_reason).toBeUndefined();
	});
});

describe("qa state: awaiting_user pause (human-gate yield)", () => {
	test("setAwaitingUser sets awaiting_user=true on a live cycle", () => {
		setQaState(S, { phase: "PLAN" });
		setAwaitingUser(S);
		expect(rawState().awaiting_user).toBe(true);
	});

	test("any later progress write auto-clears awaiting_user", () => {
		setQaState(S, { phase: "PLAN" });
		setAwaitingUser(S);
		expect(rawState().awaiting_user).toBe(true);
		advancePhase(S, "PLAN");
		expect(rawState().awaiting_user).toBe(false);
	});

	test("setAwaitingUser refuses when no active cycle exists", () => {
		expect(() => setAwaitingUser("no-such-session")).toThrow(/no active QA cycle/);
	});
});

// ---------------------------------------------------------------------------
// CLI end-to-end: proves parseArgs + subcommand wiring, not just the TS API.
// ---------------------------------------------------------------------------

describe("qa-state CLI wiring", () => {
	const script = join(import.meta.dir, "qa-state.ts");
	const run = (cmd: string) => execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });
	const authorCompleteChain = () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`author-cell --story story-1 --cls ${cls}${suffix} --attack-point "attack ${cls} ${sub}" --priority ${cls === 1 ? "H" : "L"}`);
		}
	};

	test("새 CLI story는 구조화 계약과 AC 링크가 없으면 거부한다", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		expect(() => run('add-story --id story-1 --actor actor-1')).toThrow();
		run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		expect(rawState().stories[0].contract).toEqual({
			goal: "Check supplements",
			given: ["program exists"],
			when: ["open home"],
			then: ["today supplements are shown"],
			acceptance_criteria: [0],
		});
	});

	test("이미 증거가 있는 story의 계약 변경은 현재 cycle에서 거부한다", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		run('author-cell --story story-1 --cls 1 --attack-point "attack" --priority H');
		run('record-baseline --story story-1 --result fail --note "observed"');
		expect(() => run("add-story --id story-1 --actor actor-1 --goal 'Changed intent' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'"),).toThrow(/cannot change an evidenced story contract/);
	});

	test("현재 cycle evidence 이후 참조된 AC 텍스트 변경은 거부한다", () => {
		authorCompleteChain();
		run('record-baseline --story story-1 --result fail --note "observed"');
		expect(() => run("set-acceptance --json '[\"rewritten AC\"]'")).toThrow(/cannot change referenced acceptance criteria/);
		expect(rawState().acceptance_criteria).toEqual(["home shows today supplements"]);
	});

	test("화면 액터는 텍스트 근거만으로 성공을 기록할 수 없음", () => {
		authorCompleteChain();
		run('add-actor --id actor-1 --driver agent-browser --reachable yes');
		const evidence = join(tmpDir, "observation.log");
		writeFileSync(evidence, "Clicked export; received HTTP 200; screen showed success.");
		expect(() => run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${evidence} --evidence-surface agent-browser`)).toThrow();
		const before = join(tmpDir, "before.png");
		const after = join(tmpDir, "after.png");
		const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dAAAAABJRU5ErkJggg==", "base64");
		writeFileSync(before, png);
		writeFileSync(after, png);
		expect(() => run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${after} --evidence-surface agent-browser --evidence-before ${before} --evidence-action ${evidence} --evidence-after ${after}`)).not.toThrow();
		const reviewFile = join(tmpDir, "review.json");
		writeFileSync(reviewFile, JSON.stringify([{ claim: "오류 안내 표시", verdict: "insufficient", observation: "단색 픽셀만 보임", gap: "실제 실패 안내 화면을 다시 캡처", sources: [{ path: after, location: "전체 이미지" }] }]));
		expect(() => run(`review-evidence --story story-1 --cls 1 --json-file ${reviewFile}`)).not.toThrow();
		expect(rawState().cells[0].evidence_review.claims[0].verdict).toBe("insufficient");
		expect(rawState().derived.record_complete).toBe(false);
		const savedReview = rawState().cells[0].evidence_review;
		expect(savedReview.files[after]).toMatch(/^[a-f0-9]{64}$/);
		expect(savedReview.cell_snapshot).toContain("story-1");
		run('add-actor --id actor-1 --boundary "another user boundary" --reachable yes');
		expect(rawState().cells[0].evidence_review).toBeUndefined();
		expect(() => run(`review-evidence --story story-1 --cls 1 --json-file ${reviewFile}`)).toThrow(/executed current-cycle cell with evidence/);
		run('add-actor --id actor-2 --name "Other" --boundary "other home" --driver agent-browser --reachable yes');
		run("add-story --id story-1 --actor actor-2 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		expect(rawState().cells[0].evidence_review).toBeUndefined();
		writeFileSync(reviewFile, JSON.stringify([{ claim: "오류 안내 표시", verdict: "supported", observation: "보임", gap: "", sources: [] }]));
		expect(() => run(`review-evidence --story story-1 --cls 1 --json-file ${reviewFile}`)).toThrow();
		writeFileSync(after, "This is a text log renamed as an image, not a screenshot.");
		expect(() => run(`record-cell --story story-1 --cls 2 --status fail --evidence-before ${before} --evidence-action ${evidence} --evidence-after ${after}`)).toThrow();
	});

	// An automated test run (unit/integration/component/e2e) that exercises the
	// scenario now counts as that cell's evidence when recorded under the
	// explicit `test` evidence surface — efficient QA in place of always driving
	// a UI/emulator. Fragments are concatenated at runtime so the assembled FILE
	// matches real test-runner output, while THIS source file does not.
	const VITEST_LOG =
		" RUN  v" + "3.2.4 /Users/toong/repos/algocare-home/apps/backend\n\n" +
		" ok test/domains/customer-label/delete-guard (7 tests)\n\n" +
		" Test Fil" + "es  1 passed (1)\n      Test" + "s  1 passed | 6 skipped (7)\n   Duration  1.95s\nexit=0\n";
	const QUIET_PYTEST_PASS = "1 pass" + "ed in 0.04s\n";
	const JUNIT_REPORT = '<?xml version="1.0"?><testsuite tests="1" failures="0"><testcase /></testsuite>';

	const AUTOMATED_TEST_REPORTS: Record<string, string> = {
		vitest: VITEST_LOG,
		pytest: QUIET_PYTEST_PASS,
		junit: JUNIT_REPORT,
	};

	for (const [name, report] of Object.entries(AUTOMATED_TEST_REPORTS)) {
		test(`record-cell ACCEPTS a ${name} report as pass evidence via evidence-surface test`, () => {
			authorCompleteChain();
			const logPath = join(tmpDir, `cls1-${name}-test-evidence.txt`);
			writeFileSync(logPath, report);
			expect(() =>
				run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${logPath} --evidence-surface test`),
			).not.toThrow();
			const cell = rawState().cells.find((c: any) => c.story === "story-1" && c.cls === 1 && c.cycle === 0);
			expect(cell.evidence.surface).toBe("test");
		});

		// A test log under the actor driver's surface would read as that driver's
		// observation (e.g. "observed via curl"); the surface must name the medium.
		test(`record-cell REJECTS a ${name} report under the actor driver's surface`, () => {
			authorCompleteChain();
			const logPath = join(tmpDir, `cls1-${name}-driver-surface.txt`);
			writeFileSync(logPath, report);
			expect(() =>
				run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${logPath} --evidence-surface bash`),
			).toThrow(/--evidence-surface test/);
		});
	}

	test("record-cell REJECTS an evidence-surface that matches neither the actor driver nor \"test\"", () => {
		authorCompleteChain();
		const logPath = join(tmpDir, "cls1-mismatched-surface.txt");
		writeFileSync(logPath, "HTTP/1.1 200 OK\n\n{\"ok\":true}\n");
		expect(() =>
			run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${logPath} --evidence-surface curl`),
		).toThrow(/evidence-surface must match actor driver/);
	});

	test("agent-device test-surface evidence needs no before/after or evidence review; recordComplete/approveOk accept it", () => {
		authorCompleteChain();
		run('add-actor --id actor-1 --driver agent-device --reachable yes');
		run(`record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface test`);
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface test`);
		}
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result pass");
		run("record-run-check --check flaky-rerun --result pass");
		const cell = rawState().cells.find((c: any) => c.story === "story-1" && c.cls === 1 && !c.sub && c.cycle === 0);
		expect(cell.evidence.before).toBeUndefined();
		expect(cell.evidence_review).toBeUndefined();
		expect(rawState().derived.record_complete).toBe(true);
		expect(rawState().derived.approve_ok).toBe(true);
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
	});

	test("agent-device actor still requires before/after screenshots when evidence-surface is its own driver", () => {
		authorCompleteChain();
		run('add-actor --id actor-1 --driver agent-device --reachable yes');
		const logPath = join(tmpDir, "cls1-device-plain.txt");
		writeFileSync(logPath, "device screen text dump");
		expect(() =>
			run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${logPath} --evidence-surface agent-device`),
		).toThrow();
	});

	test("record-cell ACCEPTS a real boundary observation (client-received response, no test-runner signature)", () => {
		authorCompleteChain();
		const apiPath = join(tmpDir, "cls1-response.txt");
		writeFileSync(apiPath, "HTTP/1.1 409 Conflict\n\n{\"error\":\"label in use by 1 bundle\",\"deleted\":false}\n");
		expect(() =>
			run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${apiPath} --evidence-surface bash`),
		).not.toThrow();
	});

	test("record-baseline is EXEMPT: build/test/lint logs are its expected evidence", () => {
		authorCompleteChain();
		const logPath = join(tmpDir, "baseline-tests.txt");
		writeFileSync(logPath, VITEST_LOG);
		expect(() =>
			run(`record-baseline --story story-1 --result pass --evidence-path ${logPath} --evidence-surface bash`),
		).not.toThrow();
	});

	test("CLI set/get round-trip", () => {
		run('set --phase PLAN --target "cli target"');
		expect(rawState().phase).toBe("PLAN");
		expect(rawState().target).toBe("cli target");
		const out = run("get");
		const parsed = JSON.parse(out);
		expect(parsed.phase).toBe("PLAN");
		expect(parsed.target).toBe("cli target");
	});

	test("CLI inc-cycle prints cycle+terminate JSON", () => {
		run("set --phase PRE-FLIGHT");
		const out = run("inc-cycle");
		const parsed = JSON.parse(out);
		expect(parsed.cycle).toBe(1);
		expect(parsed.terminate).toBe(false);
	});

	test("CLI complete deactivates the session; get then reports absent", () => {
		run("set --phase PRE-FLIGHT");
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		expect(rawState().active).toBe(false);
		const out = run("get").trim();
		expect(out).toBe("null");
	});

	test("set-verdict refuses APPROVE with a fail cell, then accepts after a waiver", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash`);
		}
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result pass");
		run("record-cell --story story-1 --cls 1 --status fail --na-reason ignored");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("set-verdict APPROVE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		run('waive --story story-1 --cls 1 --reason "not applicable"');
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
	});

	test("start resets a completed cycle and refuses to launder active work", () => {
		run("set-acceptance --json '[\"first cycle AC\"]'");
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		const completed = rawState();
		completed.report = { path: "/old.html", sha256: "a".repeat(64), state_snapshot: "old", reviewed: true };
		completed.trusted_receipts = [{ attempt_id: "old-attempt", receipt_path: "/old/receipt.json", sha256: "b".repeat(64) }];
		writeFileSync(resolveStatePath(S), JSON.stringify(completed));
		run('start --target "second cycle"');
		const reset = rawState();
		expect(reset.active).toBe(true);
		expect(reset.derived.chain_complete).toBe(false);
		expect(reset.derived.driver_gate_armed).toBe(true);
		expect(reset.verdict).toBeNull();
		expect(reset.phase_max).toBe(0);
		expect(reset.cycle).toBe(0);
		expect(reset.acceptance_criteria).toEqual([]);
		expect(reset.report).toBeUndefined();
		expect(reset.trusted_receipts).toEqual([]);
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run('start --target "launder"')).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
	});

	test("complete is gated and accepts the four normative arms", () => {
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		// Re-enter, author a complete but failing chain, and close with RC.
		run('start --target "recorded failure"');
		authorCompleteChain();
		run("record-baseline --story story-1 --result fail --note broken");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status fail --na-reason failure`);
		}
		run("record-run-check --check stale-state --result fail --note stale");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result fail --note flaky");
		run("set-verdict REQUEST_CHANGES");
		expect(() => run("complete")).toThrow("report");
		const report = join(tmpDir, "report.html");
		execSync(`bun ${join(import.meta.dir, "qa-report.ts")} --session ${S} --out ${report}`, { env: process.env });
		expect(() => run("complete")).toThrow("report");
		run(`review-report --path ${report}`);
		writeFileSync(report, readFileSync(report, "utf8") + "<!-- changed -->");
		expect(() => run("complete")).toThrow("report");
		expect(() => run(`review-report --path ${report}`)).toThrow("current report");
		execSync(`bun ${join(import.meta.dir, "qa-report.ts")} --session ${S} --out ${report}`, { env: process.env });
		run(`review-report --path ${report}`);
		run("complete");
		expect(rawState().active).toBe(false);
	});

	test("waive and declare-inert require reasons and are surfaced in get report", () => {
		authorCompleteChain();
		expect(() => run("waive --story story-1 --cls 1")).toThrow();
		run('waive --story story-1 --cls 1 --reason "user approved exception"');
		expect(() => run("declare-inert")).toThrow();
		run('declare-inert --reason "refactor has no reachable risk surface"');
		const view = JSON.parse(run("get"));
		expect(view.verdict_report.waives[0].reason).toBe("user approved exception");
		expect(view.verdict_report.inert.reason).toContain("no reachable");
	});
	test("이전 사이클 기록이 있어도 현재 보고서 제출이 가능함", () => {
		authorCompleteChain();
		run("record-cell --story story-1 --cls 1 --status na --na-reason setup");
		run("inc-cycle");
		const report = join(tmpDir, "next-cycle.html");
		expect(() => execSync(`bun ${join(import.meta.dir, "qa-report.ts")} --session ${S} --out ${report}`, { env: process.env })).not.toThrow();
		expect(rawState().report.path).toBe(report);
	});

	test("declare-inert all-na arm permits APPROVE but mixed pass/H-na does not", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status na --na-reason "no risk surface"`);
		}
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result pass");
		run('declare-inert --reason "nothing reachable"');
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
		const report = join(tmpDir, "inert-report.html");
		execSync(`bun ${join(import.meta.dir, "qa-report.ts")} --session ${S} --out ${report}`, { env: process.env });
		run(`review-report --path ${report}`);
		run("complete");
		run('start --target "mixed inert"');
		authorCompleteChain();
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		for (const [cls, sub] of [[1, ""], [2, ""], [3, ""], [4, ""], [5, ""], [6, ""], [1, "hang-timeout"], [5, "flaky-green"]] as const) {
			const suffix = sub ? ` --sub ${sub}` : "";
			const status = cls === 2 && !sub ? "pass" : "na";
			const evidence = status === "pass" ? " --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash" : " --na-reason \"no risk surface\"";
			run(`record-cell --story story-1 --cls ${cls}${suffix} --status ${status}${evidence}`);
		}
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result pass");
		run('declare-inert --reason "mixed should fail"');
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("set-verdict APPROVE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
	});

	test("lock serializes concurrent waive and record-cell writes", () => {
		authorCompleteChain();
		const scriptPath = join(import.meta.dir, "qa-state.ts");
		execSync(
			`(bun ${scriptPath} waive --story story-1 --cls 1 --reason "parallel waiver" & bun ${scriptPath} record-cell --story story-1 --cls 2 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash & wait)`,
			{ encoding: "utf8", env: process.env, shell: "/bin/sh" },
		);
		const state = rawState();
		expect(state.waives).toEqual([expect.objectContaining({ story: "story-1", cls: 1, reason: "parallel waiver" })]);
		expect(state.cells.find((cell: any) => cell.story === "story-1" && cell.cls === 2).status).toBe("pass");
	});

	test("get separates prior-cycle cell records from the current-cycle view", () => {
		authorCompleteChain();
		run("record-cell --story story-1 --cls 1 --status na --na-reason first-cycle");
		run("inc-cycle");
		run("author-cell --story story-1 --cls 1 --attack-point corrected --priority H");
		const view = JSON.parse(run("get"));
		expect(view.cycle).toBe(1);
		expect(view.cells.some((cell: any) => cell.cls === 1 && cell.cycle === 1)).toBe(true);
		expect(view.prior_cycle_cells.some((cell: any) => cell.cls === 1 && cell.cycle === 0)).toBe(true);
	});

	test("get excludes prior-cycle baseline and run-check records from the current view", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result fail --note first-cycle");
		run("record-run-check --check stale-state --result fail --note first-cycle");
		run("record-run-check --check dirty-worktree --result pass");
		run("record-run-check --check flaky-rerun --result pass");
		run("inc-cycle");

		const view = JSON.parse(run("get"));
		expect(view.stories[0].baseline).toBeNull();
		expect(view.run_checks.stale_state).toBeNull();
		expect(view.run_checks.dirty_worktree).toBeNull();
		expect(view.run_checks.flaky_rerun).toBeNull();
	});

	test("inc-cycle invalidates chain completion until current-cycle cells are authored", () => {
		authorCompleteChain();
		expect(rawState().derived.chain_complete).toBe(true);
		run("inc-cycle");
		expect(rawState().derived.chain_complete).toBe(false);
	});

	test("byte-identical: unknown actor and invalid authoring are refused before write", () => {
		run("set --phase PLAN");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("add-story --id story-1 --actor missing")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		const beforeCell = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("author-cell --story missing --cls 1 --attack-point x --priority H")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(beforeCell);
	});

	test("phase gate: both phase writers refuse BASELINE until the chain is complete", () => {
		run("set --phase PLAN");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("advance-phase BASELINE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		expect(() => run("set --phase BASELINE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		authorCompleteChain();
		expect(() => run("advance-phase BASELINE")).not.toThrow();
	});

	test("phase_max: high-water mark is not lowered by a backward set", () => {
		authorCompleteChain();
		run('advance-phase "ADVERSARIAL E2E"');
		expect(rawState().phase_max).toBe(3);
		run("set --phase PLAN");
		expect(rawState().phase).toBe("PLAN");
		expect(rawState().phase_max).toBe(3);
	});

	test("re-record: current-cycle records replace while prior-cycle records remain", () => {
		authorCompleteChain();
		run("record-cell --story story-1 --cls 1 --status fail");
		run("record-cell --story story-1 --cls 1 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		const firstCycle = rawState();
		const current = firstCycle.cells.find((cell: any) => cell.story === "story-1" && cell.cls === 1 && !cell.sub);
		expect(current.status).toBe("pass");
		run("inc-cycle");
		run("author-cell --story story-1 --cls 1 --attack-point corrected --priority H");
		run("record-cell --story story-1 --cls 1 --status fail");
		const second = rawState();
		const records = second.cells.filter((cell: any) => cell.story === "story-1" && cell.cls === 1 && !cell.sub);
		expect(records).toHaveLength(2);
		expect(records[0].cycle).toBe(0);
		expect(records[0].status).toBe("pass");
		expect(records[1].cycle).toBe(1);
		expect(records[1].status).toBe("fail");
	});

	test("re-recorded baseline and run-check history survive later writes", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result fail --note first");
		run("inc-cycle");
		run("record-baseline --story story-1 --result fail --note second");
		run("record-run-check --check stale-state --result fail --note first");
		run("inc-cycle");
		run("record-run-check --check stale-state --result fail --note second");
		const state = rawState();
		expect(state.stories[0].baseline_history).toEqual([
			expect.objectContaining({ result: "fail", note: "first", cycle: 0 }),
		]);
		expect(state.run_checks_history["stale-state"]).toEqual([
			expect.objectContaining({ result: "fail", note: "first", cycle: 1 }),
		]);
	});

	test("derived: every successful chain write persists recomputed flags", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		const afterActor = rawState();
		expect(afterActor.derived).toMatchObject({ chain_complete: false, driver_gate_armed: true });
		run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		expect(rawState()).toHaveProperty("derived.chain_complete");
	});

	test("funnel: exported phase writers share the BASELINE gate", () => {
		setQaState(S, { phase: "PLAN" });
		expect(() => advancePhase(S, "BASELINE")).toThrow();
		expect(() => setQaState(S, { phase: "BASELINE" })).toThrow();
	});

	test("(B2) CLI exits non-zero when no session identifier is available", () => {
		const env: NodeJS.ProcessEnv = { ...process.env, OMT_SESSION_ID: "" };
		delete env.CODEX_THREAD_ID;
		expect(() =>
			execSync(`bun ${script} set --phase PLAN`, { encoding: "utf8", env }),
		).toThrow();
		const defaultPath = `${tmpDir}/qa-state-default.json`;
		expect(existsSync(defaultPath)).toBe(false);
	});

	// -------------------------------------------------------------------------
	// Report-rendering schema extension: author-cell/record-cell round-trip the
	// new optional structured scenario fields and 3-slot evidence.
	// -------------------------------------------------------------------------

	test("author-cell records the optional structured scenario fields", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		run(
			'author-cell --story story-1 --cls 1 --attack-point "attack" --priority H ' +
				'--why-needed "covers gap" --source self-authored',
		);
		const cell = rawState().cells.find((c: any) => c.story === "story-1" && c.cls === 1 && !c.sub);
		expect(cell.why_needed).toBe("covers gap");
		expect(cell.source).toBe("self-authored");
	});

	test("set-acceptance records the acceptance criteria (full-replace)", () => {
		run("set --phase PLAN");
		run(`set-acceptance --json '["V2 read returns category-only DTO","Unauthenticated request yields 401"]'`);
		expect(rawState().acceptance_criteria).toEqual([
			"V2 read returns category-only DTO",
			"Unauthenticated request yields 401",
		]);
		run(`set-acceptance --json '["only this one now"]'`);
		expect(rawState().acceptance_criteria).toEqual(["only this one now"]);
	});

	test("set-acceptance rejects non-string criteria instead of stringifying them", () => {
		run("set --phase PLAN");
		expect(() => run(`set-acceptance --json '[42]'`)).toThrow();
	});

	test("record-cell round-trips driven-at, scenario fields, and 3-slot evidence", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		run('author-cell --story story-1 --cls 1 --attack-point "attack" --priority H');
		run(
			"record-cell --story story-1 --cls 1 --status pass " +
				"--evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash " +
				'--driven-at "app screen" ' +
				'--why-needed "covers gap" --source self-authored ' +
				"--evidence-before skills/qa/scripts/qa-state.test.ts " +
				"--evidence-action skills/qa/scripts/qa-state.test.ts " +
				"--evidence-after skills/qa/scripts/qa-state.test.ts",
		);
		const cell = rawState().cells.find((c: any) => c.story === "story-1" && c.cls === 1 && !c.sub);
		expect(cell.driven_at).toBe("app screen");
		expect(cell.why_needed).toBe("covers gap");
		expect(cell.source).toBe("self-authored");
		expect(cell.evidence.before).toContain("qa-state.test.ts");
		expect(cell.evidence.action).toContain("qa-state.test.ts");
		expect(cell.evidence.after).toContain("qa-state.test.ts");
		// existing pass-evidence contract (path/surface) stays intact alongside the 3-slot addition
		expect(cell.evidence.path).toContain("qa-state.test.ts");
		expect(cell.evidence.surface).toBe("bash");
	});

	test("record-cell records the 3-slot evidence on a FAIL cell too (no pass-evidence required)", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		run('author-cell --story story-1 --cls 1 --attack-point "attack" --priority H');
		run(
			"record-cell --story story-1 --cls 1 --status fail --na-reason ignored " +
				"--evidence-before skills/qa/scripts/qa-state.test.ts " +
				"--evidence-after skills/qa/scripts/qa-state.test.ts",
		);
		const cell = rawState().cells.find((c: any) => c.story === "story-1" && c.cls === 1 && !c.sub);
		expect(cell.status).toBe("fail");
		expect(cell.evidence.before).toContain("qa-state.test.ts");
		expect(cell.evidence.after).toContain("qa-state.test.ts");
	});

	test("record-cell rejects an invalid --source value", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		run('author-cell --story story-1 --cls 1 --attack-point "attack" --priority H');
		expect(() => run("record-cell --story story-1 --cls 1 --status fail --na-reason x --source bogus")).toThrow();
	});
});

describe("help subcommand", () => {
	// help renders this CLI's roster via the shared lib/cli-help.ts renderer, grouped by
	// authority. This pins the qa-specific wiring (roster tags), not the renderer's own
	// formatting — that's covered by lib/cli-help.test.ts.
	const script = join(import.meta.dir, "qa-state.ts");
	const run = (cmd: string, env?: Record<string, string>) =>
		execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: { ...process.env, ...env } });

	test("waive is AI-usable and force-complete is the only user-only command", () => {
		const out = run("help");
		const aiSection = out.slice(out.indexOf("AI-USABLE"), out.indexOf("USER-ONLY"));
		const userSection = out.slice(out.indexOf("USER-ONLY"));
		expect(aiSection).toContain("waive —");
		expect(aiSection).not.toContain("force-complete —");
		expect(userSection.trim().split("\n").filter((line) => line.startsWith("  "))).toEqual([
			expect.stringContaining("force-complete —"),
		]);
	});

	test("set and get are listed under AI-USABLE", () => {
		const out = run("help");
		const aiSection = out.slice(out.indexOf("AI-USABLE"), out.indexOf("SYSTEM-ONLY"));
		expect(aiSection).toContain("set —");
		expect(aiSection).toContain("get —");
	});

	test("Usage fallback lists help plus every roster command", () => {
		expect(() => run("bogus-subcommand")).toThrow();
		try {
			run("bogus-subcommand");
		} catch (e: any) {
			expect(e.stderr.toString()).toContain("help|set|");
		}
	});

	// help is a discovery command — it must not require resolveSessionIdOrThrow's
	// precondition. What breaks if this regresses: help runs after the session-id
	// resolution again and throws with no session id set.
	test("prints without a session id set (session-independent discovery)", () => {
		const out = run("help", { OMT_SESSION_ID: "", CODEX_THREAD_ID: "" });
		expect(out).toContain("qa-state commands:");
	});

	test("JUnit XML is cell evidence only under evidence-surface test, never under the actor driver", () => {
		const authorCompleteChain = () => { run("set --phase PLAN"); run("set-acceptance --json '[\"home shows today supplements\"]'"); run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes'); run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'"); for (const cls of [1, 2, 3, 4, 5, 6]) run(`author-cell --story story-1 --cls ${cls} --attack-point "attack ${cls}" --priority ${cls === 1 ? "H" : "L"}`); };
		authorCompleteChain();
		const junit = join(tmpDir, "junit.xml");
		writeFileSync(junit, '<?xml version="1.0"?><testsuite tests="1" failures="0"><testcase /></testsuite>');
		expect(() => run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${junit} --evidence-surface bash`)).toThrow(/--evidence-surface test/);
		run("inc-cycle");
		run("author-cell --story story-1 --cls 1 --attack-point 'current attack' --priority H");
		expect(() => run(`record-cell --story story-1 --cls 1 --status pass --evidence-path ${junit} --evidence-surface test`)).not.toThrow();
	});

	test("actor change only invalidates current-cycle execution and keeps history", () => {
		const authorCompleteChain = () => { run("set --phase PLAN"); run("set-acceptance --json '[\"home shows today supplements\"]'"); run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes'); run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'"); for (const cls of [1, 2, 3, 4, 5, 6]) run(`author-cell --story story-1 --cls ${cls} --attack-point "attack ${cls}" --priority ${cls === 1 ? "H" : "L"}`); };
	authorCompleteChain();
	run("record-cell --story story-1 --cls 1 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
	run("inc-cycle");
	run("author-cell --story story-1 --cls 1 --attack-point 'current attack' --priority H");
	run("record-cell --story story-1 --cls 1 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
	run('add-actor --id actor-2 --name "Other" --boundary "other home" --driver bash --reachable yes');
	run("add-story --id story-1 --actor actor-2 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
	const cells = rawState().cells.filter((cell: any) => cell.story === "story-1" && cell.cls === 1);
	expect(cells.find((cell: any) => cell.cycle === 0)?.status).toBe("pass");
	expect(cells.find((cell: any) => cell.cycle === 1)?.status).toBeUndefined();
	});

	test("actor change invalidates current-cycle execution while retaining authored cell", () => {
		const authorCompleteChain = () => { run("set --phase PLAN"); run("set-acceptance --json '[\"home shows today supplements\"]'"); run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes'); run("add-story --id story-1 --actor actor-1 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'"); for (const cls of [1, 2, 3, 4, 5, 6]) run(`author-cell --story story-1 --cls ${cls} --attack-point "attack ${cls}" --priority ${cls === 1 ? "H" : "L"}`); };
		authorCompleteChain();
		run("record-cell --story story-1 --cls 1 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		const before = rawState().cells.find((cell: any) => cell.story === "story-1" && cell.cls === 1);
		run('add-actor --id actor-2 --name "Other" --boundary "other home" --driver bash --reachable yes');
		run("add-story --id story-1 --actor actor-2 --goal 'Check supplements' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'");
		const after = rawState().cells.find((cell: any) => cell.story === "story-1" && cell.cls === 1);
		expect(after.attack_point).toBe(before.attack_point);
		expect(after.priority).toBe(before.priority);
		expect(after.status).toBeUndefined();
		expect(after.evidence).toBeUndefined();
		expect(after.evidence_review).toBeUndefined();
		expect(after.case_run).toBeUndefined();
	});
});

// Type-only compile-time smoke: ensures QaState shape is exported and usable.
const _typeCheck: QaState = {
	active: true,
	phase: "PRE-FLIGHT",
	cycle: 0,
	max_cycles: 5,
	target: "",
	started_at: "2026-01-01T00:00:00",
	last_touched_at: "2026-01-01T00:00:00",
};
void _typeCheck;
