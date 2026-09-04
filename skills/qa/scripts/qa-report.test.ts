import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
	renderQaReport,
	defaultEvidenceReader,
	MAX_EMBED_BYTES,
	MAX_TOTAL_EMBED_BYTES,
	type EvidenceReader,
	type QaReportNarrative,
	type MermaidRenderer,
} from "./qa-report.ts";
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

	test("renders every section in the pinned reader-first order: 기능 개요 -> AC·충족 -> 큰 그림 -> 액터 -> 시나리오·근거 -> 상세 기록(감사) -> Failures -> Verdict -> Evidence Files", () => {
		const html = renderQaReport(baseView({ acceptance_criteria: ["v2 screen visible when flag ON"] }), {}, fakeReader);
		expect(html).not.toBeNull();
		const order = [
			"기능 개요",
			"Acceptance Criteria",
			"큰 그림",
			"액터",
			"유저 시나리오 · 근거",
			"시나리오 상세 기록",
			"Failures",
			"Verdict",
			"Evidence Files",
		].map((needle) => html!.indexOf(needle));
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
		const acceptanceSection = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("큰 그림"));
		expect(acceptanceSection).not.toContain("narrative-only AC");
		expect(acceptanceSection).toContain("no acceptance-criteria recorded");
	});

	test("keeps the reader scenario section clean: coverage axes by plain name, NO cls/attack_point/driven_at leakage", () => {
		const view = baseView();
		view.cells![0].driven_at = "CustomerLabelService.softDelete via PGlite";
		view.actors![0].boundary = "tRPC customerLabelAdmin.delete mutation";
		const html = renderQaReport(view, {}, fakeReader)!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		// coverage axes shown by plain name, never the cls number
		expect(reader).toContain("핵심·실패 경로");
		expect(reader).toContain("입력 경계·악성 입력");
		expect(reader).not.toContain("cls 1");
		expect(reader).not.toContain("cls 2");
		// audit-layer / implementation fields never reach the reader view
		expect(reader).not.toContain("CustomerLabelService.softDelete");
		expect(reader).not.toContain("tRPC customerLabelAdmin.delete");
		expect(reader).not.toContain("flag-ON stock screen"); // attack_point is audit-only
	});

	test("moves attack_point / driven_at / cls to the record-faithful audit section", () => {
		const view = baseView();
		view.cells![0].driven_at = "CustomerLabelService.softDelete via PGlite";
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = html.slice(html.indexOf("시나리오 상세 기록"));
		expect(audit).toContain("flag-ON stock screen");
		// the injection-shaped attack_point is escaped, not executed
		expect(audit).toContain("&lt;script&gt;alert(1)&lt;/script&gt; boundary probe");
		expect(audit).toContain("CustomerLabelService.softDelete via PGlite");
		expect(audit).toContain("cls 1");
		expect(audit).toContain("cls 2");
	});

	test("renders each actor once (reader 액터 block: name + reachable); driver + per-cell boundary live in the audit, no separate roster table", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		// the actor's name appears in the merged reader 액터 section
		const actorSection = html.slice(html.indexOf("액터"), html.indexOf("유저 시나리오 · 근거"));
		expect(actorSection).toContain("Household Owner");
		expect(actorSection).toContain("도달 yes"); // reachable badge
		// there is no standalone Actor Roster table anymore
		expect(html).not.toContain("Actor Roster");
		// the driver (evidence surface) and the concrete per-cell boundary live in the audit
		const audit = html.slice(html.indexOf("시나리오 상세 기록"));
		expect(audit).toContain("agent-device"); // driver via evidence surface
		expect(audit).toContain("app 재고 화면"); // per-cell driven_at boundary
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

	test("raw TEXT evidence never appears in the reader; it lives in the audit as de-duped collapsibles", () => {
		const view = baseView({
			cells: [
				{
					...baseView().cells![0],
					evidence: {
						path: "/evidence/action.log",
						surface: "agent-device",
						before: "/evidence/before.log",
						action: "/evidence/action.log",
						after: "/evidence/after.log",
					},
				},
			],
		});
		const html = renderQaReport(view, {}, () => ({ kind: "text", content: "RAW CURL PROOF" }))!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		const audit = html.slice(html.indexOf("시나리오 상세 기록"));
		// a PO must NOT meet a raw curl/HTTP dump in the reader view
		expect(reader).not.toContain("RAW CURL PROOF");
		// the raw bytes are preserved in the audit as collapsible details, de-duped
		expect(audit).toContain("RAW CURL PROOF");
		expect(audit).toContain('class="raw-evidence"');
		const occ = (v: string): number => audit.split(v).length - 1;
		// each distinct text file is embedded once; action.log is both a supplementary
		// slot and the recorded path, so it de-dupes to a single embed → 3 total
		expect(occ("<pre>RAW CURL PROOF</pre>")).toBe(3); // before, action(=path), after
	});

	test("surfaces a loud gap (not a muted note) for a story whose verified scenarios have no evidence — qa mandates evidence", () => {
		// a story with a single fail cell and no evidence at all is a contract violation
		const view = baseView({
			cells: [{ story: "story-1", cls: 1, attack_point: "핵심 경로", priority: "H", status: "fail", cycle: 0 }],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const scenarios = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		expect(scenarios).toContain('class="gap"');
		expect(scenarios).toContain("근거를 필수로 요구");
		expect(scenarios).not.toContain("기록된 근거 없음");
	});

	test("does not gap a story whose only scenarios are na: na is the one evidence-free status, justified in the audit", () => {
		const view = baseView({
			cells: [{ story: "story-1", cls: 1, attack_point: "핵심 경로", priority: "M", status: "na", na_reason: "이 조건에서는 해당 화면이 노출되지 않음", cycle: 0 }],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const scenarios = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		// the na story must not raise the "no evidence" gap in the reader view
		expect(scenarios).not.toContain("근거를 필수로 요구");
		expect(scenarios).toContain("해당없음"); // coverage summary shows the na axis
		// the na_reason lives in the audit section, not the reader view
		expect(scenarios).not.toContain("이 조건에서는 해당 화면이 노출되지 않음");
		expect(html.slice(html.indexOf("시나리오 상세 기록"))).toContain("이 조건에서는 해당 화면이 노출되지 않음");
	});

	test("evidence 없는 na 시나리오의 감사 기록은 actor의 boundary와 driver를 fallback으로 보존한다", () => {
		const view = baseView({
			actors: [{ ...baseView().actors![0], reachable: "unknown" }],
			cells: [{ story: "story-1", cls: 1, priority: "M", status: "na", na_reason: "유저 경계에 도달하지 못함", cycle: 0 }],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = html.slice(html.indexOf("시나리오 상세 기록"));
		expect(audit).toContain("Home App 재고 화면");
		expect(audit).toContain("agent-device");
	});

	test("a text-only evidence.path is carried in the audit, never dumped in the reader", () => {
		const view = baseView();
		view.cells![0].evidence = { path: "/evidence/required.log", surface: "agent-device" };
		const html = renderQaReport(view, {}, fakeReader)!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		const audit = html.slice(html.indexOf("시나리오 상세 기록"));
		expect(reader).not.toContain("contents of /evidence/required.log");
		expect(audit).toContain("contents of /evidence/required.log");
	});

	test("screenshots render in the reader; a sibling text evidence.path stays in the audit", () => {
		const view = baseView();
		view.cells![0].evidence = {
			path: "/evidence/required.log", // text
			surface: "agent-device",
			before: "/evidence/before.png", // image
		};
		const html = renderQaReport(view, {}, fakeReader)!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		const audit = html.slice(html.indexOf("시나리오 상세 기록"));
		// the screenshot is reader-facing (a PO can read it)
		expect(reader).toContain("data:image/png;base64,AAAA");
		// the text log is not dumped in the reader; it lives in the audit
		expect(reader).not.toContain("contents of /evidence/required.log");
		expect(audit).toContain("contents of /evidence/required.log");
	});

	test("skips embedding and links by path when a file exceeds the embed size cap", () => {
		const bigReader: EvidenceReader = (path) => ({ kind: "too-large", path, size: 5 * 1024 * 1024 });
		const html = renderQaReport(baseView(), {}, bigReader)!;
		expect(html).not.toContain("base64");
		expect(html).toContain("/evidence/action.png");
	});

	test("once the embed budget is spent, a later screenshot is dropped from the reader but its path stays in the audit", () => {
		const nearBudget = "A".repeat(16 * 1024 * 1024 - 40);
		// reader renders images in order before → action → after → recorded path; the
		// action screenshot (rendered first) nearly fills the budget, so the later
		// recorded-path screenshot is not embedded — its path remains in the audit.
		const budgetReader: EvidenceReader = (path) =>
			path.endsWith("action.png")
				? { kind: "image", dataUri: `data:image/png;base64,${nearBudget}` }
				: { kind: "image", dataUri: "data:image/png;base64,BBBB" };
		const view = baseView({
			cells: [
				{
					...baseView().cells![0],
					evidence: {
						path: "/evidence/recorded.png",
						surface: "agent-device",
						action: "/evidence/action.png",
					},
				},
			],
		});
		const html = renderQaReport(view, {}, budgetReader)!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		expect(reader).toContain("data:image/png;base64,AAAA"); // action screenshot embedded
		expect(reader).not.toContain("data:image/png;base64,BBBB"); // recorded screenshot dropped (over budget)
		expect(html.slice(html.indexOf("시나리오 상세 기록"))).toContain("/evidence/recorded.png"); // path still audited
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

	test("baseline build/test evidence never appears in the reader scenario section (it is not a user-boundary observation)", () => {
		const view = baseView({
			stories: [
				{
					id: "story-1",
					actor: "actor-1",
					baseline: {
						result: "pass",
						cycle: 0,
						evidence: { path: "/evidence/baseline.log", surface: "bash" },
					},
				},
			],
		});
		const html = renderQaReport(view, {}, () => ({ kind: "text", content: "vitest 72 passed" }))!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		// a build/test log must never be shown to a PO as scenario evidence
		expect(reader).not.toContain("vitest 72 passed");
		expect(reader).not.toContain("변경 전 기준선");
	});

	test("current-cycle baseline evidence is embedded in the audit (self-contained build/test/lint proof), not merely path-listed", () => {
		const view = baseView({
			stories: [
				{
					id: "story-1",
					actor: "actor-1",
					baseline: {
						result: "pass",
						cycle: 0,
						evidence: { path: "/evidence/baseline.log", surface: "bash" },
					},
				},
			],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		// The audit layer embeds the actual baseline log content, so a recipient
		// holding only the HTML can audit the build/test/lint proof.
		const audit = html.slice(html.indexOf("시나리오 상세 기록"), html.indexOf("Evidence Files"));
		expect(audit).toContain("contents of /evidence/baseline.log");
		// But the reader scenario section stays clean of it (not a boundary observation).
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		expect(reader).not.toContain("contents of /evidence/baseline.log");
	});

	test("current-cycle passing baseline audit preserves its recorded result, note, and evidence", () => {
		const view = baseView({
			stories: [
				{
					id: "story-1",
					actor: "actor-1",
					baseline: {
						result: "pass",
						note: 'distinctive baseline note <keep> & "quoted"',
						cycle: 0,
						evidence: { path: "/evidence/passing-baseline.log", surface: "bash" },
					},
				},
			],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = html.slice(html.indexOf("시나리오 상세 기록"), html.indexOf("Evidence Files"));
		expect(audit).toContain("<code>story-1 / baseline</code> — pass");
		expect(audit).toContain("distinctive baseline note &lt;keep&gt; &amp; &quot;quoted&quot;");
		expect(audit).toContain("contents of /evidence/passing-baseline.log");
	});

	test("a green AC verdict with zero passing cells in the run renders a loud contradiction warning", () => {
		const view = baseView({
			acceptance_criteria: ["재고가 임계치 아래로 떨어지면 알림이 뜬다"],
			cells: [
				{ story: "story-1", cls: 1, attack_point: "a", priority: "H", status: "fail", cycle: 0, source: "self-authored", evidence: { path: "/evidence/x.png", surface: "agent-device" } },
				{ story: "story-1", cls: 2, attack_point: "b", priority: "L", status: "na", cycle: 0, na_reason: "n/a", source: "self-authored" },
			],
		});
		const html = renderQaReport(
			view,
			{
				presentation: {
					requirementMapping: {
						"0": { satisfied: "yes", cellRefs: [{ story: "story-1", cls: 1 }], evidence: "동작 확인됨" },
					},
				},
			},
			fakeReader,
		)!;
		const ac = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("큰 그림"));
		expect(ac).toContain("미판정");
		expect(ac).toContain('class="gap"');
		expect(ac).not.toContain("satisfied-yes");
	});

	test("an oversized (too-large) screenshot renders a placeholder in its card, not a false 'no evidence' gap", () => {
		const reader: EvidenceReader = (path) => ({ kind: "too-large", path, size: 5 * 1024 * 1024 });
		const html = renderQaReport(baseView(), {}, reader)!;
		const scen = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		expect(scen).not.toContain("실제 소프트웨어 관찰 근거가 없습니다");
		expect(scen).toContain("너무 커서");
		expect(scen).toContain("/evidence/action.png");
	});

	test("a screenshot shared by two scenario cells renders on BOTH cards (no false gap on the second)", () => {
		const shared = "/evidence/shared.png";
		const view = baseView({
			cells: [
				{ story: "story-1", cls: 1, attack_point: "a", priority: "H", status: "pass", cycle: 0, source: "self-authored", evidence: { path: shared, surface: "agent-device" } },
				{ story: "story-1", cls: 2, attack_point: "b", priority: "L", status: "pass", cycle: 0, source: "self-authored", evidence: { path: shared, surface: "agent-device" } },
			],
		});
		const reader: EvidenceReader = (path) =>
			path.endsWith(".png") ? { kind: "image", dataUri: "data:image/png;base64,AAAA" } : { kind: "text", content: "x" };
		const html = renderQaReport(view, {}, reader)!;
		const scen = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		const imgCount = (scen.match(/<img /g) ?? []).length;
		expect(imgCount).toBeGreaterThanOrEqual(2);
		expect(scen).not.toContain("실제 소프트웨어 관찰 근거가 없습니다");
	});

	// Regression (PR #291): the size cap in `defaultEvidenceReader` was applied
	// BEFORE the image/text branch, so an oversized non-image evidence file (a
	// large curl/API transcript, not a screenshot) came back as `too-large` —
	// the same shape a real oversized screenshot returns — and `imageSlot` then
	// rendered it as a screenshot placeholder. That falsely satisfied the
	// reader-facing visual evidence slot for a scenario with no screenshot at
	// all, silently swallowing the required real-software-observation gap.
	test("초과 크기 텍스트/API/CLI 증거 파일은 defaultEvidenceReader로 읽어도 스크린샷 placeholder를 렌더하지 않고, 시나리오 카드는 실제 소프트웨어 관찰 갭을 유지한다", () => {
		const dir = mkdtempSync(join(tmpdir(), "qa-report-oversized-text-"));
		const bigTextPath = join(dir, "api-response.log");
		try {
			writeFileSync(bigTextPath, "x".repeat(MAX_EMBED_BYTES + 1024));
			const view = baseView();
			view.cells![0].evidence = { path: bigTextPath, surface: "curl" }; // text-only boundary, no screenshot
			view.cells![1].status = "na"; // isolate to the one oversized-text cell
			const html = renderQaReport(view, {}, defaultEvidenceReader)!;
			const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
			// must NOT satisfy the reader-facing visual evidence slot with a fake
			// "screenshot too large" placeholder — this evidence was never an image
			expect(reader).not.toContain("너무 커서");
			expect(reader).not.toContain('class="evidence-slot"');
			// the scenario card must retain the required real-software-observation gap
			expect(reader).toContain('class="gap"');
			expect(reader).toContain("실제 소프트웨어 관찰");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// Regression (PR #291): `imageSlot` is called once per evidence field
	// (before/action/after/path) with no per-card path dedup. When a scenario
	// records `evidence.action === evidence.path` (the common CLI/API shape
	// with no separate before/after), the SAME image is embedded twice within
	// one card. A single image whose data URI nearly fills the total embed
	// budget then trips the budget guard on its second (duplicate) occurrence,
	// showing a false "budget exceeded" note that exists only because of the
	// duplicate slot, not because two distinct images were embedded.
	test("evidence.action === evidence.path인 시나리오에서 예산에 거의 꽉 차는 이미지는 카드에 정확히 한 번만 임베드되고, 중복 경로로 인한 예산 초과 안내를 보여주지 않는다", () => {
		const nearBudget = "A".repeat(MAX_TOTAL_EMBED_BYTES - 40);
		const dupPath = "/evidence/dup.png";
		const needle = `data:image/png;base64,${nearBudget}`;
		const reader: EvidenceReader = (path) => (path === dupPath ? { kind: "image", dataUri: needle } : { kind: "text", content: "x" });
		const view = baseView({
			cells: [
				{ ...baseView().cells![0], evidence: { path: dupPath, action: dupPath, surface: "agent-device" } },
				{ ...baseView().cells![1], status: "na" },
			],
		});
		const html = renderQaReport(view, {}, reader)!;
		const scen = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		const occurrences = scen.split(needle).length - 1;
		expect(occurrences).toBe(1); // embedded exactly once, not once-per-duplicate-field
		expect(scen).not.toContain("임베드 예산 초과"); // no false over-budget note from the duplicate
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

// ---------------------------------------------------------------------------
// Presentation layer: the reader-facing, product/user-centric narrative a
// context-free PO reads first. Anchored to recorded facts (actors/stories/ACs);
// only prose + the big-picture diagram flow in through --narrative. A required
// slot with no narrative renders a visible gap marker (the forcing function).
// ---------------------------------------------------------------------------

// A fake mermaid renderer so tests exercise the diagram wrapping without mmdc.
const fakeMermaid: MermaidRenderer = (source, index) =>
	`<svg viewBox="0 0 300 100" width="100%" data-block="${index}">${source}</svg>`;

describe("qa-report presentation layer", () => {
	const fullPresentation = (): QaReportNarrative => ({
		presentation: {
			overview: "flag-ON일 때 재고 화면을 v2로 교체하는 변경",
			affectedUsers: { "actor-1": "가구 소유자는 매일 재고 화면을 열어 잔량을 확인한다" },
			scenarioFlows: { "story-1": "소유자가 재고 화면에 진입하면 8슬롯 v2 화면이 보인다" },
			requirementMapping: {
				"0": {
					satisfied: "yes",
					cellRefs: [{ story: "story-1", cls: 1 }],
					evidence: "story-1 cls1 통과 — before/after 캡처",
				},
			},
			bigPicture: "flowchart LR\n  Owner --> StockScreen",
			bigPictureCaption: "소유자 재고 확인 흐름",
		},
	});

	test("renders the presentation layer ABOVE the verification-log sections", () => {
		const view = baseView({ acceptance_criteria: ["flag ON이면 v2 재고 화면"] });
		const html = renderQaReport(view, fullPresentation(), fakeReader, fakeMermaid)!;
		expect(html).not.toBeNull();
		expect(html.indexOf("기능 개요")).toBeGreaterThanOrEqual(0);
		// the reader layer (개요 -> AC·충족 -> 큰 그림 -> 액터 -> 시나리오) all precedes
		// the record-faithful audit's first section (시나리오 상세 기록)
		expect(html.indexOf("기능 개요")).toBeLessThan(html.indexOf("Acceptance Criteria"));
		expect(html.indexOf("Acceptance Criteria")).toBeLessThan(html.indexOf("큰 그림"));
		expect(html.indexOf("유저 시나리오 · 근거")).toBeLessThan(html.indexOf("시나리오 상세 기록"));
	});

	test("renders the feature overview prose", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		expect(html).toContain("flag-ON일 때 재고 화면을 v2로 교체하는 변경");
	});

	test("renders a visible gap marker for each required slot when no presentation is supplied", () => {
		const view = baseView({ acceptance_criteria: ["flag ON이면 v2 재고 화면"] });
		const html = renderQaReport(view, {}, fakeReader, fakeMermaid)!;
		// the reader layer spans overview -> AC·충족 -> 큰 그림 -> 액터 -> 시나리오,
		// ending at the audit's first section; each required slot left unwritten gaps
		const presentation = html.slice(0, html.indexOf("시나리오 상세 기록"));
		// gap markers carry a dedicated class so the reader sees what was skipped
		expect(presentation).toContain('class="gap"');
		expect((presentation.match(/class="gap"/g) ?? []).length).toBeGreaterThanOrEqual(4);
	});

	test("anchors affected-users to the recorded roster: renders prose keyed by actor id", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		const affected = html.slice(html.indexOf("액터"), html.indexOf("유저 시나리오 · 근거"));
		expect(affected).toContain("Household Owner");
		expect(affected).toContain("가구 소유자는 매일 재고 화면을 열어 잔량을 확인한다");
	});

	test("ignores affected-user prose for an actor id absent from the recorded roster (no invention)", () => {
		const narrative: QaReportNarrative = {
			presentation: { affectedUsers: { "ghost-actor": "존재하지 않는 유저 서사" } },
		};
		const html = renderQaReport(baseView(), narrative, fakeReader, fakeMermaid)!;
		expect(html).not.toContain("존재하지 않는 유저 서사");
	});

	test("renders a gap marker for a rostered actor whose prose is missing", () => {
		const view = baseView({
			actors: [
				{ id: "actor-1", name: "Household Owner", boundary: "Home App", driver: "agent-device", reachable: "yes" },
				{ id: "actor-2", name: "Admin", boundary: "Admin Console", driver: "agent-browser", reachable: "yes" },
			],
		});
		const narrative: QaReportNarrative = { presentation: { affectedUsers: { "actor-1": "소유자 서사" } } };
		const html = renderQaReport(view, narrative, fakeReader, fakeMermaid)!;
		const affected = html.slice(html.indexOf("액터"), html.indexOf("유저 시나리오 · 근거"));
		expect(affected).toContain("소유자 서사");
		expect(affected).toContain("Admin");
		expect(affected).toContain('class="gap"'); // actor-2 has no prose -> gap
	});

	test("anchors each story's flow narrative inline in the reader scenario section, beside its evidence", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		const scenarios = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		// the story is headed by its actor's name (not the internal story id), with its
		// authored user-boundary flow and its evidence in the same block
		expect(scenarios).toContain("Household Owner");
		expect(scenarios).toContain("소유자가 재고 화면에 진입하면 8슬롯 v2 화면이 보인다");
		expect(scenarios).toContain("data:image/png;base64,AAAA"); // its evidence
		expect(scenarios).toContain("확인한 관점:"); // plain coverage summary
	});

	test("maps each recorded acceptance criterion to a satisfaction badge and evidence prose", () => {
		const view = baseView({ acceptance_criteria: ["flag ON이면 v2 재고 화면"] });
		const html = renderQaReport(view, fullPresentation(), fakeReader, fakeMermaid)!;
		const mapping = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("큰 그림"));
		expect(mapping).toContain("flag ON이면 v2 재고 화면");
		expect(mapping).toContain("story-1 cls1 통과 — before/after 캡처");
		expect(mapping).toContain("satisfied-yes");
	});

	test("accepts yes, no, partial, and unverified mappings when their current-cycle refs match the claimed status", () => {
		const cell = (status: "pass" | "fail" | "na", cls: number) => ({
			story: "story-1",
			cls,
			priority: "M" as const,
			status,
			cycle: 0,
			...(status === "na" ? { na_reason: "유저 경계에 도달하지 못함" } : {}),
		});
		const cases = [
			{ satisfied: "yes" as const, cells: [cell("pass", 1)], refs: [{ story: "story-1", cls: 1 }] },
			{ satisfied: "no" as const, cells: [cell("fail", 1)], refs: [{ story: "story-1", cls: 1 }] },
			{
				satisfied: "partial" as const,
				cells: [cell("pass", 1), cell("fail", 2)],
				refs: [{ story: "story-1", cls: 1 }, { story: "story-1", cls: 2 }],
			},
			{ satisfied: "unverified" as const, cells: [cell("na", 1)], refs: [{ story: "story-1", cls: 1 }] },
		];

		for (const candidate of cases) {
			const view = baseView({ acceptance_criteria: [candidate.satisfied], cells: candidate.cells });
			const narrative = {
				presentation: {
					requirementMapping: {
						"0": { satisfied: candidate.satisfied, cellRefs: candidate.refs, evidence: "상태에 맞는 설명" },
					},
				},
			} as unknown as QaReportNarrative;
			const html = renderQaReport(view, narrative, fakeReader, fakeMermaid)!;
			const mapping = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("큰 그림"));
			expect(mapping).toContain(`satisfied-${candidate.satisfied}`);
		}
	});

	test("does not let a pass from another story satisfy an AC mapped to a failing story", () => {
		const view = baseView({
			acceptance_criteria: ["story-1 경로가 성공한다"],
			actors: [
				...baseView().actors!,
				{ id: "actor-2", name: "Admin", boundary: "Admin Console", driver: "agent-browser", reachable: "yes" },
			],
			stories: [
				{ id: "story-1", actor: "actor-1" },
				{ id: "story-2", actor: "actor-2" },
			],
			cells: [
				{ story: "story-1", cls: 1, priority: "H", status: "fail", cycle: 0 },
				{ story: "story-2", cls: 1, priority: "H", status: "pass", cycle: 0 },
			],
		});
		const narrative = {
			presentation: {
				requirementMapping: {
					"0": { satisfied: "yes", cellRefs: [{ story: "story-1", cls: 1 }], evidence: "다른 story의 통과 설명" },
				},
			},
		} as unknown as QaReportNarrative;
		const html = renderQaReport(view, narrative, fakeReader, fakeMermaid)!;
		const mapping = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("큰 그림"));
		expect(mapping).toContain("미판정");
		expect(mapping).toContain('class="gap"');
		expect(mapping).not.toContain("satisfied-yes");
	});

	test("fails closed for legacy, missing, malformed, duplicate, stale-cycle, unknown-story, invalid-selector, and ineligible refs", () => {
		const passCell = { story: "story-1", cls: 1, priority: "H" as const, status: "pass" as const, cycle: 0 };
		const failCell = { story: "story-1", cls: 1, priority: "H" as const, status: "fail" as const, cycle: 0 };
		const staleCell = { ...passCell, cycle: 1 };
		const naCell = { story: "story-1", cls: 1, priority: "H" as const, status: "na" as const, cycle: 0 };
		const naWithReasonCell = { ...naCell, cls: 3, na_reason: "유저 경계에 도달하지 못함" };
		const cases: Array<{ label: string; view: QaView; mapping: unknown }> = [
			{
				label: "legacy",
				view: baseView({ acceptance_criteria: ["legacy"] }),
				mapping: { satisfied: "yes", evidence: "prose only" },
			},
			{
				label: "missing refs",
				view: baseView({ acceptance_criteria: ["missing"] }),
				mapping: { satisfied: "yes", cellRefs: [], evidence: "empty refs" },
			},
			{
				label: "malformed ref",
				view: baseView({ acceptance_criteria: ["malformed"], cells: [passCell] }),
				mapping: { satisfied: "yes", cellRefs: [{ story: "story-1", cls: "1" }], evidence: "wrong cls type" },
			},
			{
				label: "duplicate ref",
				view: baseView({ acceptance_criteria: ["duplicate"], cells: [passCell] }),
				mapping: {
					satisfied: "yes",
					cellRefs: [{ story: "story-1", cls: 1 }, { story: "story-1", cls: 1 }],
					evidence: "duplicate",
				},
			},
			{
				label: "stale cycle",
				view: baseView({ acceptance_criteria: ["stale"], cells: [staleCell] }),
				mapping: { satisfied: "yes", cellRefs: [{ story: "story-1", cls: 1 }], evidence: "stale" },
			},
			{
				label: "unknown story",
				view: baseView({ acceptance_criteria: ["unknown"] }),
				mapping: { satisfied: "yes", cellRefs: [{ story: "ghost", cls: 1 }], evidence: "unknown" },
			},
			{
				label: "invalid selector",
				view: baseView({ acceptance_criteria: ["selector"], cells: [passCell] }),
				mapping: { satisfied: "yes", cellRefs: [{ story: "story-1", cls: 2, sub: "hang-timeout" }], evidence: "wrong sub" },
			},
			{
				label: "status ineligible",
				view: baseView({ acceptance_criteria: ["ineligible"], cells: [failCell] }),
				mapping: { satisfied: "yes", cellRefs: [{ story: "story-1", cls: 1 }], evidence: "fail is not yes" },
			},
			{
				label: "partial includes na",
				view: baseView({
					acceptance_criteria: ["partial includes na"],
					cells: [passCell, { ...failCell, cls: 2 }, naWithReasonCell],
				}),
				mapping: {
					satisfied: "partial",
					cellRefs: [{ story: "story-1", cls: 1 }, { story: "story-1", cls: 2 }, { story: "story-1", cls: 3 }],
					evidence: "na must not make partial valid",
				},
			},
			{
				label: "unverified without reason",
				view: baseView({ acceptance_criteria: ["unverified"], cells: [naCell] }),
				mapping: { satisfied: "unverified", cellRefs: [{ story: "story-1", cls: 1 }], evidence: "missing na reason" },
			},
		];

		for (const candidate of cases) {
			const narrative = { presentation: { requirementMapping: { "0": candidate.mapping } } } as unknown as QaReportNarrative;
			const html = renderQaReport(candidate.view, narrative, fakeReader, fakeMermaid)!;
			const mapping = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("큰 그림"));
			if (!mapping.includes("미판정") || !mapping.includes('class="gap"') || /satisfied-(yes|no|partial|unverified)/.test(mapping)) {
				throw new Error(`${candidate.label}: expected a neutral fail-closed AC mapping`);
			}
		}
	});

	test("renders an unverified requirement LOUDLY (미검증 — 유저 경계 미구동), never as a quiet partial", () => {
		const view = baseView({
			acceptance_criteria: ["flag ON이면 v2 재고 화면"],
			cells: [
				...baseView().cells!,
				{ story: "story-1", cls: 3, priority: "L", status: "na", na_reason: "어드민 화면이 부팅되지 않음", cycle: 0 },
			],
		});
		const narrative: QaReportNarrative = {
			presentation: {
				requirementMapping: {
					"0": {
						satisfied: "unverified",
						cellRefs: [{ story: "story-1", cls: 3 }],
						evidence: "어드민 화면이 부팅되지 않아 유저 경계를 구동하지 못함 — NOT-RUN",
					},
				},
			},
		};
		const html = renderQaReport(view, narrative, fakeReader, fakeMermaid)!;
		const mapping = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("큰 그림"));
		expect(mapping).toContain("satisfied-unverified");
		expect(mapping).toContain("미검증 — 유저 경계 미구동");
		expect(mapping).not.toContain("충족</span>"); // never rendered as met/partial
	});

	test("renders a gap marker for a recorded AC that has no satisfaction mapping", () => {
		const view = baseView({ acceptance_criteria: ["매핑된 AC", "매핑 안 된 AC"] });
		const narrative: QaReportNarrative = {
			presentation: {
				requirementMapping: {
					"0": { satisfied: "yes", cellRefs: [{ story: "story-1", cls: 1 }], evidence: "근거" },
				},
			},
		};
		const html = renderQaReport(view, narrative, fakeReader, fakeMermaid)!;
		const mapping = html.slice(html.indexOf("Acceptance Criteria"), html.indexOf("큰 그림"));
		expect(mapping).toContain("매핑된 AC");
		expect(mapping).toContain("매핑 안 된 AC");
		expect(mapping).toContain('class="gap"');
	});

	test("bakes the big-picture mermaid source to an inline SVG via the injected renderer", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		const big = html.slice(html.indexOf("큰 그림"), html.indexOf("유저 시나리오 · 근거"));
		expect(big).toContain("<svg");
		expect(big).toContain("소유자 재고 확인 흐름"); // caption
		// width="100%" is normalized to the viewBox pixel width so labels stay legible
		expect(big).toContain('width="300"');
		expect(big).not.toContain('width="100%"');
	});

	test("degrades gracefully to the mermaid source when the renderer throws (report never aborts)", () => {
		const throwingMermaid: MermaidRenderer = () => {
			throw new Error("mmdc 가 없습니다");
		};
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, throwingMermaid)!;
		expect(html).not.toBeNull();
		const big = html.slice(html.indexOf("큰 그림"), html.indexOf("유저 시나리오 · 근거"));
		// the raw source survives so the reader still sees the intended structure
		expect(big).toContain("flowchart LR");
		expect(big).toContain("다이어그램 렌더 실패");
	});

	test("renders a gap marker when no big-picture diagram is supplied", () => {
		const narrative: QaReportNarrative = { presentation: { overview: "개요만 있음" } };
		const html = renderQaReport(baseView(), narrative, fakeReader, fakeMermaid)!;
		const big = html.slice(html.indexOf("큰 그림"), html.indexOf("유저 시나리오 · 근거"));
		expect(big).toContain('class="gap"');
	});

	test("escapes hostile presentation prose instead of injecting it raw", () => {
		const narrative: QaReportNarrative = {
			presentation: { overview: "<script>alert(1)</script>" },
		};
		const html = renderQaReport(baseView(), narrative, fakeReader, fakeMermaid)!;
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	test("keeps the report self-contained even with a baked diagram (no runtime script, no external ref)", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		expect(html.match(/<script/g)).toBeNull();
		expect(html).not.toMatch(/https?:\/\//);
	});
});

// ---------------------------------------------------------------------------
// Per-scenario evidence (reader restructure): every VERIFIED scenario must carry
// its own reader-visible real-software record — an authored observation (the
// reader form of an API/CLI transcript, whose raw bytes stay in the audit) OR a
// screenshot — inside its own scenario card, never a merged evidence wall and
// never a silent hole. This is the "왜 evidence가 전 시나리오에 없나" fix.
// ---------------------------------------------------------------------------
describe("qa-report per-scenario evidence", () => {
	test("리더는 검증된 시나리오마다 독립 카드를 렌더한다 (병합된 근거 벽이 아니라)", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		// baseView: cls1 pass + cls2 fail → 2 scenario cards
		expect((reader.match(/class="scenario-card/g) ?? []).length).toBe(2);
	});

	test("각 시나리오의 스크린샷은 그 시나리오 카드 안에 묶여 렌더된다", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		const cards = reader.split('class="scenario-card').slice(1);
		expect(cards.length).toBe(2);
		expect(cards[0]).toContain("data:image/png;base64,AAAA"); // cls1's own captures
		expect(cards[1]).toContain("data:image/png;base64,AAAA"); // cls2's own capture
	});

	test("API/CLI 텍스트 경계 시나리오는 저자가 쓴 관찰 자연어를 리더에 보여준다 (raw transcript는 감사에만)", () => {
		const view = baseView();
		view.cells![0].evidence = { path: "/evidence/api.log", surface: "curl" }; // text-only boundary
		view.cells![1].status = "na"; // isolate to the one API cell
		const narrative: QaReportNarrative = {
			scenarios: { "story-1:1:": { observed: "로그인 없이 요청하니 서버가 401을 돌려주며 게이트 모달이 유지됐다" } },
		};
		const html = renderQaReport(view, narrative, () => ({ kind: "text", content: "HTTP/1.1 401 RAW" }))!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		const audit = html.slice(html.indexOf("시나리오 상세 기록"));
		expect(reader).toContain("로그인 없이 요청하니 서버가 401을 돌려주며 게이트 모달이 유지됐다");
		expect(reader).not.toContain("HTTP/1.1 401 RAW"); // raw transcript never in the reader
		expect(audit).toContain("HTTP/1.1 401 RAW"); // preserved in the audit
	});

	test("스크린샷도 관찰 자연어도 없는 검증 시나리오는 리더에 크게 갭을 낸다 (raw 로그만으로는 리더 근거가 아님)", () => {
		const view = baseView();
		view.cells![0].evidence = { path: "/evidence/api.log", surface: "curl" }; // text-only, NO authored observation
		view.cells![1].status = "na";
		const html = renderQaReport(view, {}, () => ({ kind: "text", content: "raw" }))!;
		const reader = html.slice(html.indexOf("유저 시나리오 · 근거"), html.indexOf("시나리오 상세 기록"));
		expect(reader).toContain('class="gap"');
		expect(reader).toContain("실제 소프트웨어 관찰");
	});
});

describe("defaultEvidenceReader", () => {
	test("returns missing for a nonexistent path", () => {
		expect(defaultEvidenceReader("/definitely/not/here.png").kind).toBe("missing");
	});

	test("returns missing when an evidence path is readable by stat but not by read", () => {
		const root = mkdtempSync(join(tmpdir(), "qa-report-unreadable-"));
		const directoryPath = join(root, "evidence");
		mkdirSync(directoryPath);
		try {
			expect(defaultEvidenceReader(directoryPath)).toEqual({ kind: "missing", path: directoryPath });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
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
