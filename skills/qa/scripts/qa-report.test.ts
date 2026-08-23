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

	test("falls back to narrative acceptance criteria when none are recorded", () => {
		const html = renderQaReport(baseView(), { acceptanceCriteria: ["narrative-only AC"] }, fakeReader)!;
		expect(html).toContain("narrative-only AC");
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

	test("skips embedding and links by path when a file exceeds the embed size cap", () => {
		const bigReader: EvidenceReader = (path) => ({ kind: "too-large", path, size: 5 * 1024 * 1024 });
		const html = renderQaReport(baseView(), {}, bigReader)!;
		expect(html).not.toContain("base64");
		expect(html).toContain("/evidence/action.png");
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
