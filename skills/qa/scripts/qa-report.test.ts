import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { renderQaReport, defaultEvidenceReader, type EvidenceReader, type QaReportNarrative } from "./qa-report.ts";
import type { QaView } from "./qa-state.ts";

// ---------------------------------------------------------------------------
// Unit tests: renderQaReport is a pure function of (QaView, narrative, evidence
// reader) — no filesystem access unless the injected reader does it, mirroring
// explain-diff/scripts/render.ts's renderSvg-injection pattern for testability.
// ---------------------------------------------------------------------------

function baseView(overrides: Partial<QaView> = {}): QaView {
	return {
		active: true,
		phase: "STATE",
		cycle: 0,
		max_cycles: 5,
		same_failure_key: "",
		same_failure_count: 0,
		fix_head_before: "",
		user_dirty_set: [],
		target: "verify v2 stock screen",
		started_at: "2026-08-22T10:00:00",
		last_touched_at: "2026-08-22T10:05:00",
		actors: [{ id: "actor-1", name: "Household Owner", boundary: "Home App 재고 화면", driver: "agent-device", reachable: "yes" }],
		stories: [{ id: "story-1", actor: "actor-1" }],
		cells: [
			{
				story: "story-1",
				cls: 1,
				attack_point: "flag-ON stock screen",
				priority: "H",
				status: "pass",
				cycle: 0,
				driven_at: "app 재고 화면",
				why_needed: "covers the flag-ON happy path",
				source: "self-authored",
				evidence: {
					path: "/evidence/action.png",
					surface: "agent-device",
					before: "/evidence/before.png",
					action: "/evidence/action.png",
					after: "/evidence/after.png",
				},
			},
			{
				story: "story-1",
				cls: 2,
				attack_point: "<script>alert(1)</script> boundary probe",
				priority: "M",
				status: "fail",
				cycle: 0,
				driven_at: "app 재고 화면",
				why_needed: "rejects malformed input at the boundary",
				source: "self-authored",
				evidence: { path: "/evidence/fail-after.png", surface: "agent-device", after: "/evidence/fail-after.png" },
			},
		],
		run_checks: {
			stale_state: { result: "pass", cycle: 0 },
			dirty_worktree: { result: "pass", cycle: 0 },
			flaky_rerun: { result: "pass", cycle: 0 },
		},
		waives: [],
		verdict: "COMMENT",
		derived: {},
		prior_cycle_cells: [],
		prior_cycle_waives: [],
		verdict_report: { verdict: "COMMENT", cycle: 0, waives: [] },
		...overrides,
	};
}

const fakeReader: EvidenceReader = (path) =>
	path.endsWith(".png") ? { kind: "image", dataUri: "data:image/png;base64,AAAA" } : { kind: "text", content: `contents of ${path}` };

describe("qa-report renderer", () => {
	test("renders null (no-op) when the roster is empty — PRE-FLIGHT fail-fast has no report", () => {
		expect(renderQaReport(baseView({ actors: [] }), {}, fakeReader)).toBeNull();
	});

	test("renders every section in the pinned AC order: AC -> Actor Roster -> Story tree -> Scenario Evidence -> Failures -> Verdict -> Evidence Files", () => {
		const html = renderQaReport(baseView(), { acceptanceCriteria: ["v2 screen visible when flag ON"] }, fakeReader);
		expect(html).not.toBeNull();
		const order = ["Acceptance Criteria", "Actor Roster", "Story", "Scenario Evidence", "Failures", "Verdict", "Evidence Files"].map((needle) =>
			html!.indexOf(needle),
		);
		for (let i = 1; i < order.length; i++) {
			expect(order[i - 1]).toBeGreaterThanOrEqual(0);
			expect(order[i]).toBeGreaterThan(order[i - 1]);
		}
	});

	test("renders Acceptance Criteria from recorded state, and records win over narrative", () => {
		const view = baseView({ acceptance_criteria: ["recorded: V2 read is category-only"] });
		const html = renderQaReport(view, { acceptanceCriteria: ["narrative: should be overridden"] }, fakeReader)!;
		expect(html).toContain("recorded: V2 read is category-only");
		expect(html).not.toContain("narrative: should be overridden");
	});

	test("기록되지 않은 narrative acceptance criteria를 렌더하지 않음", () => {
		const html = renderQaReport(baseView(), { acceptanceCriteria: ["narrative-only AC"] }, fakeReader)!;
		const acceptanceSection = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("Actor Roster"));
		expect(acceptanceSection).not.toContain("narrative-only AC");
		expect(acceptanceSection).toContain("no acceptance-criteria recorded");
	});

	test("renders each scenario's attack_point in the Scenario Evidence section", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		const evidenceSection = html.slice(html.indexOf("Scenario Evidence"));
		expect(evidenceSection).toContain("flag-ON stock screen");
		// the injection-shaped attack_point is escaped, not executed
		expect(evidenceSection).toContain("&lt;script&gt;alert(1)&lt;/script&gt; boundary probe");
	});

	test("renders the recorded actor roster from state", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		expect(html).toContain("Household Owner");
		expect(html).toContain("Home App 재고 화면");
		expect(html).toContain("agent-device");
	});

	test("renders recorded PASS/FAIL and evidence paths verbatim from state, not re-narrated", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		expect(html).toContain("/evidence/before.png");
		expect(html).toContain("/evidence/action.png");
		expect(html).toContain("/evidence/after.png");
		expect(html).toContain("/evidence/fail-after.png");
		expect(html).toContain("pass");
		expect(html).toContain("fail");
	});

	test("embeds image evidence as a base64 data URI and shows non-image evidence as escaped text", () => {
		const mixedReader: EvidenceReader = (path) =>
			path.endsWith(".png") ? { kind: "image", dataUri: "data:image/png;base64,AAAA" } : { kind: "text", content: "curl status 200" };
		const view = baseView();
		view.cells![0].evidence!.action = "/evidence/action.log";
		const html = renderQaReport(view, {}, mixedReader)!;
		expect(html).toContain("data:image/png;base64,AAAA");
		expect(html).toContain("curl status 200");
	});

	test("renders required evidence.path when supplementary slots are absent", () => {
		const view = baseView();
		view.cells![0].evidence = { path: "/evidence/required.log", surface: "agent-device" };
		const html = renderQaReport(view, {}, fakeReader)!;
		const scenarioEvidence = html.slice(html.indexOf("Scenario Evidence"), html.indexOf("Failures &amp; Mismatches"));
		expect(scenarioEvidence).toContain("contents of /evidence/required.log");
	});

	test("부분 supplementary 슬롯이 있어도 필수 evidence.path를 함께 렌더함", () => {
		const view = baseView();
		view.cells![0].evidence = {
			path: "/evidence/required.log",
			surface: "agent-device",
			before: "/evidence/before.png",
		};
		const html = renderQaReport(view, {}, fakeReader)!;
		const scenarioEvidence = html.slice(html.indexOf("Scenario Evidence"), html.indexOf("Failures &amp; Mismatches"));
		expect(scenarioEvidence).toContain("contents of /evidence/required.log");
		expect(scenarioEvidence).toContain("data:image/png;base64,AAAA");
	});

	test("skips embedding and links by path when a file exceeds the embed size cap", () => {
		const bigReader: EvidenceReader = (path) => ({ kind: "too-large", path, size: 5 * 1024 * 1024 });
		const html = renderQaReport(baseView(), {}, bigReader)!;
		expect(html).not.toContain("base64");
		expect(html).toContain("/evidence/action.png");
	});

	test("누적 evidence 임베드 예산을 초과하면 이후 파일을 경로로 남김", () => {
		const nearBudget = "A".repeat(16 * 1024 * 1024 - 40);
		const budgetReader: EvidenceReader = (path) =>
			path.endsWith("first.png")
				? { kind: "image", dataUri: `data:image/png;base64,${nearBudget}` }
				: { kind: "image", dataUri: "data:image/png;base64,BBBB" };
		const view = baseView({
			cells: [
				{
					...baseView().cells![0],
					evidence: {
						path: "/evidence/first.png",
						surface: "agent-device",
						action: "/evidence/second.png",
					},
				},
			],
		});
		const html = renderQaReport(view, {}, budgetReader)!;
		expect(html).toContain("data:image/png;base64,AAAA");
		expect(html).toContain("embedding budget exhausted");
		expect(html).toContain("/evidence/second.png");
	});

	test("renders expected-vs-actual narrative supplied at render time, keyed per scenario", () => {
		const narrative: QaReportNarrative = { scenarios: { "story-1:1:": { expectedVsActual: "matched: 8-slot screen rendered as expected" } } };
		const html = renderQaReport(baseView(), narrative, fakeReader)!;
		expect(html).toContain("matched: 8-slot screen rendered as expected");
	});

	test("renders the Failures/Mismatches section from narrative issues plus FAIL cells", () => {
		const narrative: QaReportNarrative = { issues: [{ severity: "LOW", description: "minor timing flake", location: "app.ts:12" }] };
		const html = renderQaReport(baseView(), narrative, fakeReader)!;
		expect(html).toContain("minor timing flake");
		expect(html).toContain("app.ts:12");
	});

	test("renders recorded baseline and per-run failures even when all scenario cells pass", () => {
		const passingCells = baseView().cells!.map((cell) => ({ ...cell, status: "pass" as const }));
		const view = baseView({
			cells: passingCells,
			stories: [{ id: "story-1", actor: "actor-1", baseline: { result: "fail", note: "server did not start", cycle: 0 } }],
			run_checks: {
				stale_state: { result: "pass", cycle: 0 },
				dirty_worktree: { result: "fail", note: "verifier install changed package.json", cycle: 0 },
				flaky_rerun: { result: "pass", cycle: 0 },
			},
			verdict: "REQUEST_CHANGES",
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const failures = html.slice(html.indexOf("Failures &amp; Mismatches"), html.indexOf("<h2>Verdict"));
		expect(failures).toContain("story-1 / baseline");
		expect(failures).toContain("server did not start");
		expect(failures).toContain("dirty-worktree");
		expect(failures).toContain("verifier install changed package.json");
		expect(failures).not.toContain("no failures or mismatches recorded this cycle");
	});

	test("renders the waived sub-scenario in the verdict identifier", () => {
		const html = renderQaReport(
			baseView({
				verdict_report: {
					verdict: "COMMENT",
					cycle: 0,
					waives: [{ story: "story-1", cls: 1, sub: "hang-timeout", reason: "known harness limit" }],
				},
			}),
			{},
			fakeReader,
		)!;
		const verdict = html.slice(html.indexOf("<h2>Verdict"));
		expect(verdict).toContain("story-1/1/hang-timeout");
	});

	test("renders the verdict from state", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		expect(html).toContain("COMMENT");
	});

	test("lists every recorded evidence path in the Evidence Files section", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		const evidenceSection = html.slice(html.indexOf("Evidence Files"));
		expect(evidenceSection).toContain("/evidence/before.png");
		expect(evidenceSection).toContain("/evidence/fail-after.png");
	});

	test("escapes a hostile string from state instead of injecting it raw", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	test("has zero external CSS/JS/font/image references and zero runtime script", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		expect(html).not.toMatch(/https?:\/\//);
		expect(html).not.toContain("<script");
		expect(html).not.toMatch(/<link[^>]+href=/);
	});

	test("is fully self-contained: has an inline <style> block, no <script> tag at all", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		expect(html).toContain("<style>");
		expect(html.match(/<script/g)).toBeNull();
	});
});

describe("defaultEvidenceReader", () => {
	test("returns missing for a nonexistent path", () => {
		expect(defaultEvidenceReader("/definitely/not/here.png").kind).toBe("missing");
	});
});

// ---------------------------------------------------------------------------
// CLI end-to-end: proves the qa-state -> qa-report pipeline, not just the pure
// render function.
// ---------------------------------------------------------------------------

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const S = "test-report-session";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "qa-report-test-"));
	process.env.OMT_DIR = tmpDir;
	process.env.OMT_SESSION_ID = S;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalOmtDir !== undefined) process.env.OMT_DIR = originalOmtDir;
	else delete process.env.OMT_DIR;
	if (originalSessionId !== undefined) process.env.OMT_SESSION_ID = originalSessionId;
	else delete process.env.OMT_SESSION_ID;
});

describe("qa-report CLI", () => {
	const stateScript = join(import.meta.dir, "qa-state.ts");
	const reportScript = join(import.meta.dir, "qa-report.ts");
	const runState = (cmd: string) => execSync(`bun ${stateScript} ${cmd}`, { encoding: "utf8", env: process.env });

	test("writes a self-contained HTML file for a session with a recorded roster", () => {
		runState("set --phase PLAN");
		runState('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes');
		runState("add-story --id story-1 --actor actor-1");
		runState('author-cell --story story-1 --cls 1 --attack-point "attack" --priority H');
		runState(
			"record-cell --story story-1 --cls 1 --status pass " +
				"--evidence-path skills/qa/scripts/qa-report.test.ts --evidence-surface bash " +
				"--evidence-before skills/qa/scripts/qa-report.test.ts " +
				"--evidence-action skills/qa/scripts/qa-report.test.ts " +
				"--evidence-after skills/qa/scripts/qa-report.test.ts",
		);
		const out = join(tmpDir, "report.html");
		const stdout = execSync(`bun ${reportScript} --session ${S} --out ${out}`, { encoding: "utf8", env: process.env });
		expect(stdout.trim()).toBe(out);
		expect(existsSync(out)).toBe(true);
		const html = readFileSync(out, "utf8");
		expect(html).toContain("<style>");
		expect(html).toContain("User");
		expect(html).not.toContain("<script");
	});

	test("is a no-op (writes nothing, reports so) when the roster is empty", () => {
		runState("set --phase PRE-FLIGHT");
		const out = join(tmpDir, "report.html");
		const stdout = execSync(`bun ${reportScript} --session ${S} --out ${out}`, { encoding: "utf8", env: process.env });
		expect(stdout).toContain("no roster");
		expect(existsSync(out)).toBe(false);
	});
});
