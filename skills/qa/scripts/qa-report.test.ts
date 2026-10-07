import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execSync, spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { evidenceReviewSnapshot, type QaScenario } from "@lib/qa-chain-core";

import {
	renderQaReport,
	readerEnglishWords,
	defaultEvidenceReader,
	scenarioKey,
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

/** Binds a complete evidence review (one supported claim) to every scenario that carries evidence. */
function attachReviews(view: QaView): void {
	for (const scenario of view.scenarios ?? []) {
		if (!scenario.evidence) continue;
		const e = scenario.evidence;
		const paths = [e.path, e.before, e.action, e.after].filter((path): path is string => !!path);
		scenario.evidence_review = {
			cell_snapshot: evidenceReviewSnapshot(scenario),
			claims: [{ claim: "결과 화면 확인", observation: "화면 결과가 기대와 일치", verdict: "supported", gap: "", sources: [{ path: e.after ?? e.path, location: "결과 영역" }] }],
			files: Object.fromEntries(paths.map((path) => [path, createHash("sha256").update(path.endsWith(".png") ? Buffer.from("AAAA", "base64") : Buffer.from(`contents of ${path}`)).digest("hex")])),
		};
	}
}

function scenario(overrides: Partial<QaScenario> & Pick<QaScenario, "id">): QaScenario {
	return {
		story: "story-1",
		title: overrides.id,
		preconditions: "앱에 로그인한 상태",
		steps: ["재고 화면을 연다"],
		expected: "재고가 보인다",
		why_needed: "핵심 경로",
		priority: "M",
		risks: [],
		status: "pass",
		cycle: 0,
		source: "self-authored",
		...overrides,
	};
}

const PROFILES = [
	{ id: "iphone-15", label: "iPhone 15", platform: "ios" as const, width: 393, height: 852 },
	{ id: "web-1280", label: "웹 데스크톱", platform: "web" as const, width: 1280, height: 800 },
];

function baseView(overrides: Partial<QaView> = {}): QaView {
	const view: QaView = {
		active: true,
		phase: "STATE",
		cycle: 0,
		max_cycles: 5,
		target: "verify v2 stock screen",
		started_at: "2026-08-22T10:00:00",
		last_touched_at: "2026-08-22T10:05:00",
		actors: [{ id: "actor-1", name: "Household Owner", boundary: "Home App 재고 화면", driver: "agent-device", reachable: "yes", client_impact: "contract", client_impact_reason: "화면 코드는 그대로이고 요청만 바뀜" }],
		stories: [{ id: "story-1", actor: "actor-1" }],
		scenarios: [
			scenario({
				id: "sc-1",
				title: "재고 화면 진입",
				risks: [1],
				priority: "H",
				driven_at: "app 재고 화면",
				why_needed: "covers the flag-ON happy path",
				evidence: { path: "/evidence/action.png", surface: "agent-device", before: "/evidence/before.png", action: "/evidence/action.png", after: "/evidence/after.png" },
			}),
			scenario({
				id: "sc-2",
				title: "<script>alert(1)</script> 경계 입력",
				risks: [2],
				status: "fail",
				driven_at: "app 재고 화면",
				why_needed: "rejects malformed input at the boundary",
				evidence: { path: "/evidence/fail-after.png", surface: "agent-device", after: "/evidence/fail-after.png" },
			}),
		],
		risk_not_applicable: [],
		device_profiles: [],
		run_checks: {
			stale_state: { result: "pass", cycle: 0 },
			dirty_worktree: { result: "pass", cycle: 0 },
			flaky_rerun: { result: "pass", cycle: 0 },
		},
		verdict: "COMMENT",
		derived: {},
		prior_cycle_scenarios: [],
		verdict_report: { verdict: "COMMENT", cycle: 0 },
		...overrides,
	};
	attachReviews(view);
	return view;
}

const fakeReader: EvidenceReader = (path) =>
	path.endsWith(".png") ? { kind: "image", dataUri: "data:image/png;base64,AAAA" } : { kind: "text", content: `contents of ${path}` };
const validImageReader: EvidenceReader = (path) =>
	path.endsWith(".png") ? { kind: "image", dataUri: "data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAA" } : { kind: "text", content: `contents of ${path}` };

const READER_START = "유저 시나리오 · 근거";
const AUDIT_START = "시나리오 상세 기록";
const readerSection = (html: string): string => html.slice(html.indexOf(READER_START), html.indexOf(AUDIT_START));
const auditSection = (html: string): string => html.slice(html.indexOf(AUDIT_START));

describe("qa-report renderer", () => {
	test("현재 cycle provenance를 감사 기록으로 렌더하고 계획 맥락임을 명시함", () => {
		const view = baseView({
			cycle: 3,
			stories: [{
				id: "story-1",
				actor: "actor-1",
				provenance: {
					cycle: 3,
					code_ref: "commit-abc + dirty diff",
					features: [{ id: "stock-view", revision: "rev-7", entrypoints: ["Home App"], states: ["empty", "ready"] }],
				},
			}],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = auditSection(html);
		expect(audit).toContain("provenance");
		expect(audit).toContain("현재 · cycle 3");
		expect(audit).toContain("stock-view");
		expect(audit).toContain("rev-7");
		expect(audit).toContain("Home App");
		expect(audit).toContain("empty, ready");
		expect(audit).toContain("commit-abc + dirty diff");
		expect(audit).toContain("실행 증거가 아닌 계획 맥락");
		expect(audit).toContain("진입 경로·상태는 이번 QA의 계획 항목이며 지도에 등록된 항목임을 뜻하지 않습니다.");
		expect(audit).toContain('href="#audit-story-story-1"');
		expect(audit.match(/href="#audit-story-story-1"/g)?.length).toBe(1);
		expect(audit).toContain('aria-label="story story-1 기존 기록으로 이동"');
		expect(audit).not.toContain("<summary>현재 cycle provenance");
	});

	test("provenance가 없거나 stale이면 기록되지 않음으로 표시하고 previous cycle을 통과로 표시하지 않음", () => {
		const view = baseView({
			cycle: 3,
			stories: [
				{ id: "story-1", actor: "actor-1", provenance: { cycle: 2, code_ref: "old", features: [{ id: "old-feature", revision: "old-rev", entrypoints: [], states: [] }] }, provenance_history: [{ cycle: 3, code_ref: "same-cycle-before-baseline", features: [] }, { cycle: 1, code_ref: "older", features: [] }] },
				{ id: "story-2", actor: "actor-1" },
			],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = auditSection(html);
		expect(audit).toContain("provenance 기록 없음");
		expect(audit).toContain("이전 기록");
		expect(audit).toContain("cycle 3");
		expect(audit).not.toContain("previous cycle provenance");
		expect(audit).toContain("old-feature");
		const provenance = audit.slice(audit.indexOf("Story provenance"), audit.indexOf("<h2>실패 · 불일치"));
		expect(provenance).not.toContain("badge-pass");
	});

	test("provenance 텍스트와 story 링크 대상을 HTML escape함", () => {
		const view = baseView({
			cycle: 1,
			stories: [{ id: "story<1>", actor: "actor-1", provenance: { cycle: 1, code_ref: 'ref"><script>alert(1)</script>', features: [{ id: "<feature>", revision: "<rev>", entrypoints: ["<entry>"], states: ["<state>"] }] } }],
			scenarios: [{ ...baseView().scenarios![0], story: "story<1>", cycle: 1 }],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		expect(html).toContain("&lt;feature&gt;");
		expect(html).toContain("ref&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toContain("<script>alert(1)</script>");
		expect(html).toContain('href="#audit-story-story&lt;1&gt;"');
	});

	test("여러 주장이 같은 보조 이미지를 인용하면 한 번만 표시한다", () => {
		const view = baseView();
		view.scenarios = view.scenarios!.slice(0, 1);
		const original = view.scenarios[0].evidence_review!.claims[0];
		view.scenarios[0].evidence_review!.claims = ["실패 안내", "화면 유지"].map((claim) => ({ ...original, claim, sources: [{ path: "/extra.png", location: claim }] }));
		const html = renderQaReport(view, {}, fakeReader)!;
		expect(html.match(/<img /g)?.length).toBe(4);
		expect(html).toContain("실패 안내</strong>");
		expect(html).toContain("화면 유지</strong>");
	});

	test("주장이 행동 이미지를 인용해도 행동은 결과 화면보다 먼저 나온다", () => {
		const view = baseView();
		view.scenarios = view.scenarios!.slice(0, 1);
		view.scenarios[0].evidence_review!.claims[0].sources = [{ path: "/evidence/action.png", location: "클릭 순간" }];
		const html = renderQaReport(view, {}, fakeReader)!;
		expect(html.indexOf("/evidence/action.png")).toBeLessThan(html.indexOf("/evidence/after.png"));
		expect(html.match(/<img /g)?.length).toBe(3);
	});

	test("주장 로그는 누적 예산 초과 시에도 최종 보고서에서 누락할 수 없다", () => {
		const view = baseView();
		view.scenarios = view.scenarios!.slice(0, 1);
		view.scenarios[0].evidence_review!.claims[0].sources = Array.from({ length: 9 }, (_, i) => ({ path: `/timing-${i}.log`, location: "시각" }));
		const reader: EvidenceReader = (path) => path.endsWith(".log") ? { kind: "text", content: "x".repeat(MAX_EMBED_BYTES) } : fakeReader(path);
		expect(() => renderQaReport(view, { scenarios: { "story-1:sc-1": { observed: "시간 확인" } } }, reader, undefined, undefined, true)).toThrow("claim evidence exceeds total");
	});

	test("큰 주장 로그의 유효성과 첨부 가능 여부를 구분하고 최종 제출은 막는다", () => {
		const dir = mkdtempSync(join(tmpdir(), "qa-large-claim-"));
		try {
			const view = baseView();
			view.scenarios = view.scenarios!.slice(0, 1);
			const sc = view.scenarios[0];
			const log = join(dir, "timing.log");
			writeFileSync(log, "x".repeat(MAX_EMBED_BYTES + 1));
			for (const slot of ["path", "before", "action", "after"] as const) {
				const path = join(dir, `${slot}.png`);
				writeFileSync(path, Buffer.from("AAAA", "base64"));
				sc.evidence![slot] = path;
			}
			sc.evidence_review = { cell_snapshot: evidenceReviewSnapshot(sc), claims: [{ claim: "3초 제한", observation: "요청 시간차 3000ms", verdict: "supported", gap: "", sources: [{ path: log, location: "요청과 응답 시각" }] }], files: Object.fromEntries([...Object.values(sc.evidence!).filter((p) => p.startsWith(dir)), log].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])) };
			const narrative = { scenarios: { "story-1:sc-1": { observed: "3초 후 실패 안내" } } };
			const html = renderQaReport(view, narrative)!;
			expect(html).not.toContain("근거 미검증 — 제품 실패");
			expect(() => renderQaReport(view, narrative, undefined, undefined, undefined, true)).toThrow("claim evidence not embeddable");
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});

	test("엄격한 보고서는 PNG 확장자의 손상된 주장 이미지를 거부한다", () => {
		const dir = mkdtempSync(join(tmpdir(), "qa-corrupt-claim-image-"));
		try {
			const view = baseView();
			view.scenarios = view.scenarios!.slice(0, 1);
			const sc = view.scenarios[0];
			const validImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
			for (const slot of ["before", "action", "after"] as const) {
				const path = join(dir, `${slot}.png`);
				writeFileSync(path, validImage);
				sc.evidence![slot] = path;
			}
			const corrupt = join(dir, "claim.png");
			writeFileSync(corrupt, "not an image");
			sc.evidence_review!.claims[0].sources = [{ path: corrupt, location: "결과 영역" }];
			const narrative = { scenarios: { "story-1:sc-1": { observed: "결과 화면 확인" } } };

			expect(() => renderQaReport(view, narrative, undefined, undefined, undefined, true)).toThrow("claim evidence not embeddable");
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});

	test("좁은 화면에서도 근거를 읽도록 원본 크기 확대를 제공함", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		expect(html).toContain("원본 크기로 확대");
		expect(html).toContain(".image-view[open] + .image-frame img");
	});

	test("행동 전 화면은 검토한 결과보다 먼저 나오고 추가 주장 로그도 감사에 포함됨", () => {
		const view = baseView();
		view.scenarios![0].evidence_review!.claims[0].sources.push({ path: "/evidence/timing.txt", location: "요청과 응답 시각" });
		const html = renderQaReport(view, {}, fakeReader)!;
		expect(html.indexOf("행동 전 화면")).toBeLessThan(html.indexOf("결과 화면 확인</strong>"));
		expect(html).toContain("contents of /evidence/timing.txt");
	});

	test("주장 검토 없는 사진은 확인 배지가 아니라 근거 미검증으로 표시함", () => {
		const view = baseView();
		view.scenarios = view.scenarios!.slice(0, 1);
		delete view.scenarios[0].evidence_review;
		const html = renderQaReport(view, { scenarios: { "story-1:sc-1": { observed: "실패 안내가 나타났다" } } }, fakeReader)!;
		const cards = html.slice(html.indexOf('<div class="scenarios">'), html.indexOf("시나리오 상세 기록 (감사)</h2>"));
		expect(cards).toContain("근거 미검증");
		expect(cards).not.toContain("cov-pass");
	});

	test("최종 화면 보고서는 관찰 설명으로 누락 이미지를 대신할 수 없음", () => {
		const view = baseView();
		const narrative = { scenarios: { "story-1:sc-1": { observed: "내보내기 완료를 확인했다." } } };
		expect(() => renderQaReport(view, narrative, () => ({ kind: "text", content: "HTTP 200" }), undefined, undefined, true)).toThrow("visual");
	});

	test("최종 화면 보고서는 큰 이미지를 경로로만 남기지 않음", () => {
		const view = baseView();
		const reader: EvidenceReader = () => ({ kind: "too-large", path: "/capture.png", size: MAX_EMBED_BYTES + 1, media: "image" });
		expect(() => renderQaReport(view, {}, reader, undefined, undefined, true)).toThrow("visual");
	});

	test("최종 화면 보고서에 전후 이미지와 관찰을 함께 표시함", () => {
		const view = baseView();
		view.scenarios = view.scenarios!.slice(0, 1);
		const narrative = { scenarios: { "story-1:sc-1": { observed: "연속 클릭 후에도 완료 화면은 한 번 표시됐다." } } };
		const html = renderQaReport(view, narrative, validImageReader, undefined, undefined, true)!;
		expect(html).toContain("연속 클릭 후에도 완료 화면은 한 번 표시됐다.");
		expect(html.match(/<img /g)?.length).toBe(3);
	});

	test("최종 화면 보고서는 누적 이미지 예산 초과를 거부함", () => {
		const view = baseView();
		view.scenarios = view.scenarios!.slice(0, 1);
		const narrative = { scenarios: { "story-1:sc-1": { observed: "결과 화면 확인" } } };
		const dataUri = "data:image/png;base64,iVBORw0KGgo" + "A".repeat(MAX_TOTAL_EMBED_BYTES / 2);
		expect(() => renderQaReport(view, narrative, () => ({ kind: "image", dataUri }), undefined, undefined, true)).toThrow("budget");
	});

	test("최종 화면 보고서는 이미지가 있어도 관찰 설명 누락을 거부함", () => {
		const view = baseView();
		view.scenarios = view.scenarios!.slice(0, 1);
		expect(() => renderQaReport(view, {}, validImageReader, undefined, undefined, true)).toThrow("visual observation");
	});

	test("renders null (no-op) when the roster is empty — PRE-FLIGHT fail-fast has no report", () => {
		expect(renderQaReport(baseView({ actors: [] }), {}, fakeReader)).toBeNull();
	});

	test("머리말에 검증 대상, 사이클, 생성 시각을 한국어 라벨로 보여줌", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		const meta = html.slice(html.indexOf('<ul class="doc-meta">'), html.indexOf("</ul>"));
		expect(meta).toContain("<strong>검증 대상</strong> verify v2 stock screen");
		expect(meta).toContain("<strong>사이클</strong> 0");
		expect(meta).toContain("<strong>생성 시각</strong> 2026-08-22T10:05:00");
	});

	test("renders every section in the pinned reader-first order: 기능 개요 -> AC·충족 -> 큰 그림 -> 액터 -> 시나리오·근거 -> 상세 기록(감사) -> 실패·불일치 -> 판정 -> 증거 파일", () => {
		const html = renderQaReport(baseView({ acceptance_criteria: ["v2 screen visible when flag ON"] }), {}, fakeReader);
		expect(html).not.toBeNull();
		const order = [
			"기능 개요",
			"요구사항(AC) 충족 현황",
			"큰 그림",
			"<h2>액터",
			"유저 시나리오 · 근거",
			"시나리오 상세 기록",
			"<h2>실패 · 불일치",
			"<h2>판정",
			"<h2>증거 파일",
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
		const acceptanceSection = html.slice(html.indexOf("요구사항(AC) 충족 현황"), html.indexOf("큰 그림"));
		expect(acceptanceSection).not.toContain("narrative-only AC");
		expect(acceptanceSection).toContain("기록된 요구사항이 없습니다");
	});

	test("keeps the reader scenario section clean: risk axes by plain name, NO axis number/why_needed/driven_at leakage", () => {
		const view = baseView();
		view.scenarios![0].driven_at = "CustomerLabelService.softDelete via PGlite";
		view.actors![0].boundary = "tRPC customerLabelAdmin.delete mutation";
		const html = renderQaReport(view, {}, fakeReader)!;
		const reader = readerSection(html);
		expect(reader).toContain("다룬 위험: 실패 경로");
		expect(reader).toContain("다룬 위험: 입력 경계·잘못된 입력");
		expect(reader).not.toContain("1 실패 경로");
		// audit-layer / implementation fields never reach the reader view
		expect(reader).not.toContain("CustomerLabelService.softDelete");
		expect(reader).not.toContain("tRPC customerLabelAdmin.delete");
		expect(reader).not.toContain("covers the flag-ON happy path"); // why_needed is audit-only
	});

	test("정상 흐름 시나리오(위험 축 없음)는 '정상 흐름'으로 표시함", () => {
		const view = baseView({ scenarios: [scenario({ id: "sc-1", evidence: { path: "/evidence/api.log", surface: "curl" } })] });
		const reader = readerSection(renderQaReport(view, {}, fakeReader)!);
		expect(reader).toContain('<p class="sc-risks">정상 흐름</p>');
	});

	test("moves why_needed / driven_at / risk axis numbers to the record-faithful audit section", () => {
		const view = baseView();
		view.scenarios![0].driven_at = "CustomerLabelService.softDelete via PGlite";
		attachReviews(view);
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = auditSection(html);
		expect(audit).toContain("covers the flag-ON happy path");
		// the injection-shaped title is escaped, not executed
		expect(audit).toContain("&lt;script&gt;alert(1)&lt;/script&gt; 경계 입력");
		expect(audit).toContain("CustomerLabelService.softDelete via PGlite");
		expect(audit).toContain("1 실패 경로");
		expect(audit).toContain("2 입력 경계·잘못된 입력");
	});

	test("renders each actor once (reader 액터 block: name + reachable); driver + per-scenario boundary live in the audit, no separate roster table", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		const actorSection = html.slice(html.indexOf("<h2>액터"), html.indexOf(READER_START));
		expect(actorSection).toContain("Household Owner");
		expect(actorSection).toContain("도달함"); // reachable badge
		expect(html).not.toContain("Actor Roster");
		const audit = auditSection(html);
		expect(audit).toContain("agent-device"); // driver via evidence surface
		expect(audit).toContain("app 재고 화면"); // per-scenario driven_at boundary
	});

	test("도달이 막힌 액터는 막힌 사유를 배지로 보여줌", () => {
		const view = baseView({ actors: [{ ...baseView().actors![0], reachable: "unknown" }] });
		const html = renderQaReport(view, {}, fakeReader)!;
		expect(html.slice(html.indexOf("<h2>액터"), html.indexOf(READER_START))).toContain("도달 막힘: unknown");
	});

	test("renders recorded PASS/FAIL and evidence paths verbatim from state, not re-narrated", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		expect(html).toContain("/evidence/before.png");
		expect(html).toContain("/evidence/action.png");
		expect(html).toContain("/evidence/after.png");
		expect(html).toContain("/evidence/fail-after.png");
		expect(readerSection(html)).toContain("cov-pass");
		expect(readerSection(html)).toContain("cov-fail");
		expect(html).toContain("badge-pass");
		expect(html).toContain("badge-fail");
	});

	test("embeds image evidence as a base64 data URI and shows non-image evidence as escaped text", () => {
		const mixedReader: EvidenceReader = (path) =>
			path.endsWith(".png") ? { kind: "image", dataUri: "data:image/png;base64,AAAA" } : { kind: "text", content: "curl status 200" };
		const view = baseView();
		view.scenarios![0].evidence!.action = "/evidence/action.log";
		const html = renderQaReport(view, {}, mixedReader)!;
		expect(html).toContain("data:image/png;base64,AAAA");
		expect(html).toContain("curl status 200");
	});

	test("raw TEXT evidence never appears in the reader; it lives in the audit as de-duped collapsibles", () => {
		const view = baseView({
			scenarios: [
				scenario({
					id: "sc-1",
					evidence: {
						path: "/evidence/action.log",
						surface: "curl",
						before: "/evidence/before.log",
						action: "/evidence/action.log",
						after: "/evidence/after.log",
					},
				}),
			],
		});
		const html = renderQaReport(view, {}, () => ({ kind: "text", content: "RAW CURL PROOF" }))!;
		const reader = readerSection(html);
		const audit = auditSection(html);
		expect(reader).not.toContain("RAW CURL PROOF");
		expect(audit).toContain("RAW CURL PROOF");
		expect(audit).toContain('class="raw-evidence"');
		const occ = (v: string): number => audit.split(v).length - 1;
		// each distinct text file is embedded once; action.log is both a supplementary
		// slot and the recorded path, so it de-dupes to a single embed → 3 total
		expect(occ("<pre>RAW CURL PROOF</pre>")).toBe(3); // before, action(=path), after
	});

	test("surfaces a loud gap (not a muted note) for a verified scenario with no evidence — qa mandates evidence", () => {
		const view = baseView({ scenarios: [scenario({ id: "sc-1", status: "fail", risks: [1] })] });
		const scenarios = readerSection(renderQaReport(view, {}, fakeReader)!);
		expect(scenarios).toContain('class="gap"');
		expect(scenarios).toContain("근거를 필수로 요구");
		expect(scenarios).not.toContain("기록된 근거 없음");
	});

	test("아직 기록되지 않은 시나리오는 미실행 gap 카드로 렌더하고 감사에는 actor의 boundary와 driver를 fallback으로 보존한다", () => {
		const view = baseView({ scenarios: [scenario({ id: "sc-1", title: "아직 안 돌린 시나리오", status: undefined })] });
		const html = renderQaReport(view, {}, fakeReader)!;
		const scenarios = readerSection(html);
		expect(scenarios).toContain('class="scenario-card sc-unrecorded"');
		expect(scenarios).toContain("아직 실행 결과가 기록되지 않은 시나리오입니다");
		const audit = auditSection(html);
		expect(audit).toContain("Home App 재고 화면");
		expect(audit).toContain("agent-device");
	});

	test("gap 참조 문구를 하나의 non-breaking span으로 렌더한다", () => {
		const html = renderQaReport(baseView({ scenarios: [scenario({ id: "sc-1", status: "fail" })] }), {}, fakeReader)!;

		expect(html).not.toContain("presentation.md 참조");
	});

	test("감사 표의 story 식별자와 coverage/boundary 셀은 CJK 의미 단위 wrapping 계약을 갖고 가로 overflow를 유지한다", () => {
		const view = baseView();
		view.scenarios![0].driven_at = "브라우저 경계 미구동";
		attachReviews(view);
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = auditSection(html);

		expect(audit).toContain('<td class="audit-story" data-label="story / scenario"><code>story-1</code><br><code>sc-1</code></td>');
		expect(audit).toContain('<td class="audit-coverage" data-label="priority · risks">H · 1 실패 경로</td>');
		expect(audit).toContain('<td class="audit-boundary" data-label="driven at">브라우저 경계 미구동<br>');
		expect(html).toContain("table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.94rem; display: block; overflow-x: auto; }");
		expect(html).toContain(".audit-story { min-width: 6rem; }");
		expect(html).toContain(".audit-story code { white-space: normal; overflow-wrap: anywhere; }");
		expect(html).toContain(".audit-coverage { min-width: 8rem; word-break: keep-all; overflow-wrap: normal; }");
		expect(html).toContain(".audit-boundary { min-width: 12rem; word-break: keep-all; overflow-wrap: anywhere; }");
	});

	test("좁은 화면에서는 감사 표의 행을 열 이름이 붙은 카드로 쌓는다", () => {
		const view = baseView();
		attachReviews(view);
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = auditSection(html);

		expect(audit).toContain('<table class="audit-table" tabindex="0">');
		for (const label of ["story / scenario", "priority · risks", "scenario · why needed", "driven at", "result · evidence"]) expect(audit).toContain(`data-label="${label}"`);
		expect(html).toMatch(/@media \(max-width: 40rem\) \{[^}]*\.audit-table tr \{ display: block;/);
	});

	test("동작이 바뀌지 않는 변경으로 선언된 inert는 시나리오 섹션 머리에 안내로 표시함", () => {
		const view = baseView({ inert: { declared: true, reason: "문서만 바뀐 변경", cycle: 0 } });
		expect(readerSection(renderQaReport(view, {}, fakeReader)!)).toContain("동작이 바뀌지 않는 변경으로 선언됨: 문서만 바뀐 변경");
		const stale = baseView({ inert: { declared: true, reason: "이전 사이클 선언", cycle: 1 } });
		expect(readerSection(renderQaReport(stale, {}, fakeReader)!)).not.toContain("동작이 바뀌지 않는 변경으로 선언됨");
	});

	test("검증 불가 시나리오는 한계와 도달 지점을 리더에 보이고 시도 내역은 감사에 남기며 상단 배너로 알린다", () => {
		const view = baseView({
			scenarios: [
				baseView().scenarios![0],
				scenario({
					id: "sc-3",
					title: "동시 접속 처리",
					risks: [4],
					status: "blocked",
					blocked: { obstacle: "PGlite는 연결이 하나뿐임", attempts: ["docker compose up → daemon 없음"], deepest_reachable: "PGlite 단일 연결", attempt_log: "/evidence/attempts.txt" },
				}),
			],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const scenarios = html.slice(html.indexOf("<h2>유저 시나리오 · 근거"), html.indexOf("<h2>시나리오 상세 기록"));
		expect(scenarios).toContain('class="scenario-card sc-blocked"');
		expect(scenarios).toContain("검증 불가 — PGlite는 연결이 하나뿐임");
		expect(scenarios.slice(scenarios.indexOf('class="scenario-card sc-blocked"'))).not.toContain("presentation.md 참조");
		expect(scenarios).toContain("확인한 가장 깊은 지점: PGlite 단일 연결");
		expect(scenarios).toContain("다룬 위험: 중단·동시 실행");
		expect(scenarios).not.toContain("docker compose up");
		const audit = html.slice(html.indexOf("<h2>시나리오 상세 기록"));
		expect(audit).toContain("docker compose up → daemon 없음");
		expect(audit).toContain("/evidence/attempts.txt");
		expect(html.indexOf("검증 불가 시나리오 1건")).toBeGreaterThan(-1);
		expect(html.indexOf("검증 불가 시나리오 1건")).toBeLessThan(html.indexOf("<h2>판정"));
		expect(html.indexOf("검증 불가 시나리오 1건")).toBeLessThan(html.indexOf("<h2>기능 개요"));
	});

	test("막힌 반복 검사는 상단 배너에 막힌 이유와 함께 나온다", () => {
		const view = baseView();
		view.run_checks = { ...view.run_checks, flaky_rerun: { result: "blocked", cycle: view.cycle, blocked: { obstacle: "에뮬레이터가 부팅하지 못함", attempts: ["a"], deepest_reachable: "d", attempt_log: "/l.txt" } } };
		const html = renderQaReport(view, {}, fakeReader)!;
		expect(html).toContain("반복 검사 검증 불가 — 에뮬레이터가 부팅하지 못함");
		expect(html.indexOf("반복 검사 검증 불가")).toBeLessThan(html.indexOf("<h2>판정"));
	});

	test("검증 불가 배너는 현재 사이클의 blocked 시나리오가 있을 때만, 개수와 제목과 함께 나온다", () => {
		const blocked = (id: string, cycle: number) => scenario({ id, title: `막힌 ${id}`, status: "blocked", cycle, blocked: { obstacle: "o", attempts: ["a"], deepest_reachable: "d", attempt_log: "/l.txt" } });
		const two = renderQaReport(baseView({ scenarios: [blocked("sc-a", 0), blocked("sc-b", 0), blocked("sc-old", 1)] }), {}, fakeReader)!;
		expect(two).toContain("검증 불가 시나리오 2건");
		expect(two).toContain("막힌 sc-a · 막힌 sc-b");
		expect(two).not.toContain("검증 불가 시나리오 3건");
		expect(renderQaReport(baseView(), {}, fakeReader)!).not.toContain("검증 불가 시나리오");
	});

	test("verdict summary strip은 판정과 상태별 시나리오 개수를 머리말 다음에 보여줌", () => {
		const view = baseView({
			scenarios: [
				...baseView().scenarios!,
				scenario({ id: "sc-3", status: "blocked", blocked: { obstacle: "o", attempts: ["a"], deepest_reachable: "d", attempt_log: "/l.txt" } }),
				scenario({ id: "sc-4", status: undefined }),
			],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const strip = html.match(/<p class="verdict-summary">.*?<\/p>/)![0];
		expect(strip).toContain("의견과 함께 승인 (COMMENT)");
		expect(strip).toContain("유저 시나리오 4개");
		expect(strip).toContain("통과 1 · 실패 1 · 검증 불가 1 · 미실행 1");
		expect(html.indexOf('class="verdict-summary"')).toBeGreaterThan(html.indexOf('class="doc-meta"'));
		expect(html.indexOf('class="verdict-summary"')).toBeLessThan(html.indexOf("<h2>기능 개요"));
	});

	test("verdict summary strip은 verdict가 없으면 '판정 전'으로, 근거 미검증 시나리오가 있으면 판정 보류로 표시함", () => {
		const none = renderQaReport(baseView({ verdict: null }), {}, fakeReader)!;
		expect(none).toContain("<strong>판정 전</strong>");
		const view = baseView();
		delete view.scenarios![0].evidence_review;
		const html = renderQaReport(view, {}, fakeReader)!;
		expect(html).toContain("<strong>판정 보류 — 근거 미검증 시나리오가 있음</strong>");
		expect(html).toContain("근거 미검증 1");
		// 기존 판정을 승인 근거로 쓰지 못하도록 판정 섹션 대신 gap을 렌더함
		expect(html).not.toContain("<h2>판정");
		expect(html).toContain("검증 미완료");
	});

	test("N/A 위험 축은 시나리오 카드가 아니라 접힌 <details class=\"risk-na\"> 안에 이유와 함께 렌더함", () => {
		const view = baseView({
			risk_not_applicable: [
				{ axis: 6, reason: "재시도 경로가 없는 읽기 전용 화면임", cycle: 0 },
				{ axis: 3, reason: "요청에 자유 입력 문자열이 없음", cycle: 0 },
				{ axis: 5, reason: "이전 사이클에만 해당한 이유", cycle: 1 },
			],
		});
		const reader = readerSection(renderQaReport(view, {}, fakeReader)!);
		const start = reader.indexOf('<details class="risk-na">');
		expect(start).toBeGreaterThan(-1);
		expect(reader.slice(start)).not.toContain("<details open");
		const folded = reader.slice(start, reader.indexOf("</details>", start));
		expect(folded).toContain("이 변경에 해당하지 않는 위험 2가지");
		expect(folded).toContain("<strong>주입</strong> — 요청에 자유 입력 문자열이 없음");
		expect(folded).toContain("<strong>중복 실행</strong> — 재시도 경로가 없는 읽기 전용 화면임");
		// 축 번호 순으로 정렬되고, 다른 사이클의 항목은 나오지 않음
		expect(folded.indexOf("주입")).toBeLessThan(folded.indexOf("중복 실행"));
		expect(reader).not.toContain("이전 사이클에만 해당한 이유");
		// 시나리오 카드는 실제 시나리오 수만큼이고 N/A 이유는 카드 안에 없음
		const cards = reader.slice(0, reader.indexOf('<p class="coverage">')).split('class="scenario-card').slice(1);
		expect(cards.length).toBe(2);
		for (const card of cards) {
			expect(card).not.toContain("요청에 자유 입력 문자열이 없음");
			expect(card).not.toContain("재시도 경로가 없는 읽기 전용 화면임");
		}
		expect(reader).not.toContain("sc-not_applicable");
		expect(reader).not.toContain("미실행");
	});

	test("N/A 위험 축이 없으면 risk-na details를 렌더하지 않고, 시나리오가 다룬 위험만 한 줄로 보여줌", () => {
		const reader = readerSection(renderQaReport(baseView(), {}, fakeReader)!);
		expect(reader).not.toContain('<details class="risk-na">');
		expect(reader).toContain('<p class="coverage">시나리오가 다룬 위험: 실패 경로 · 입력 경계·잘못된 입력</p>');
	});

	test("a text-only evidence.path is carried in the audit, never dumped in the reader", () => {
		const view = baseView({ scenarios: [scenario({ id: "sc-1", evidence: { path: "/evidence/required.log", surface: "curl" } })] });
		const html = renderQaReport(view, {}, fakeReader)!;
		expect(readerSection(html)).not.toContain("contents of /evidence/required.log");
		expect(auditSection(html)).toContain("contents of /evidence/required.log");
	});

	test("missing and oversized text evidence remain explicit audit placeholders", () => {
		const missingPath = "/evidence/<missing>.log";
		const oversizedPath = "/evidence/<oversized>.log";
		const oversizedBytes = MAX_EMBED_BYTES + 123;
		const view = baseView({
			scenarios: [
				{ ...baseView().scenarios![0], evidence: { path: missingPath, surface: "curl" } },
				baseView().scenarios![1],
			],
		});
		const reader: EvidenceReader = (path) =>
			path === missingPath
				? { kind: "missing", path }
				: path === oversizedPath
					? { kind: "too-large", path, size: oversizedBytes, media: "text" }
					: { kind: "image", dataUri: "data:image/png;base64,AAAA" };
		view.stories![0].baseline = {
			result: "pass",
			cycle: 0,
			evidence: { path: oversizedPath, surface: "bash" },
		};
		const html = renderQaReport(view, {}, reader)!;
		const audit = auditSection(html);

		expect(readerSection(html)).not.toContain("스크린샷이 너무 커서");
		expect(audit).toContain("&lt;missing&gt;");
		expect(audit).toContain("읽을 수 없음");
		expect(audit).toContain("원문 미포함");
		expect(audit).toContain("&lt;oversized&gt;");
		expect(audit).toContain(String(oversizedBytes));
		expect(audit).toContain("2 MiB");
		expect(audit).not.toContain("스크린샷이 너무 커서");
	});

	test("text evidence over the cumulative embed budget remains an audit placeholder", () => {
		const firstPath = "/evidence/first.log";
		const overBudgetPath = "/evidence/over-budget.log";
		const view = baseView({
			scenarios: [
				{ ...baseView().scenarios![0], evidence: { path: firstPath, surface: "curl" } },
				{ ...baseView().scenarios![1], evidence: { path: overBudgetPath, surface: "curl" } },
			],
		});
		const reader: EvidenceReader = (path) =>
			path === firstPath
				? { kind: "text", content: "A".repeat(MAX_TOTAL_EMBED_BYTES) }
				: { kind: "text", content: "must not be embedded" };
		const audit = auditSection(renderQaReport(view, {}, reader)!);

		expect(audit).toContain("/evidence/first.log");
		expect(audit).toContain("/evidence/over-budget.log");
		expect(audit).toContain("누적 텍스트 임베드 예산 초과");
		expect(audit).toContain("원문 미포함");
		expect(audit).not.toContain("must not be embedded");
	});

	test("an audit placeholder is de-duplicated across duplicate fields, scenarios, and baseline", () => {
		const missingPath = "/evidence/shared-missing.log";
		const view = baseView({
			scenarios: [
				{ ...baseView().scenarios![0], evidence: { path: missingPath, action: missingPath, surface: "curl" } },
				{ ...baseView().scenarios![1], evidence: { path: missingPath, surface: "curl" } },
			],
		});
		view.stories![0].baseline = { result: "pass", cycle: 0, evidence: { path: missingPath, surface: "bash" } };
		const reader: EvidenceReader = (path) =>
			path === missingPath ? { kind: "missing", path } : { kind: "image", dataUri: "data:image/png;base64,AAAA" };
		const audit = auditSection(renderQaReport(view, {}, reader)!);

		expect((audit.match(/읽을 수 없음/g) ?? []).length).toBe(1);
	});

	test("screenshots render in the reader; a sibling text evidence.path stays in the audit", () => {
		const view = baseView();
		view.scenarios![0].evidence = {
			path: "/evidence/required.log", // text
			surface: "agent-device",
			before: "/evidence/before.png", // image
		};
		attachReviews(view);
		const html = renderQaReport(view, {}, fakeReader)!;
		const reader = readerSection(html);
		const audit = auditSection(html);
		expect(reader).toContain("data:image/png;base64,AAAA");
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
			scenarios: [
				{
					...baseView().scenarios![0],
					evidence: {
						path: "/evidence/recorded.png",
						surface: "agent-device",
						action: "/evidence/action.png",
					},
				},
			],
		});
		for (const sc of view.scenarios ?? []) delete sc.evidence_review;
		const html = renderQaReport(view, {}, budgetReader)!;
		const reader = readerSection(html);
		expect(reader).toContain("data:image/png;base64,AAAA"); // action screenshot embedded
		expect(reader).not.toContain("data:image/png;base64,BBBB"); // recorded screenshot dropped (over budget)
		expect(auditSection(html)).toContain("/evidence/recorded.png"); // path still audited
	});

	test("renders expected-vs-actual narrative supplied at render time, keyed per scenario", () => {
		const narrative: QaReportNarrative = { scenarios: { [scenarioKey({ story: "story-1", id: "sc-1" })]: { expectedVsActual: "matched: 8-slot screen rendered as expected" } } };
		const html = renderQaReport(baseView(), narrative, fakeReader)!;
		expect(html).toContain("matched: 8-slot screen rendered as expected");
	});

	test("scenarioKey는 story와 scenario id를 ':'로 잇는다", () => {
		expect(scenarioKey({ story: "story-1", id: "sc-2" })).toBe("story-1:sc-2");
	});

	test("renders the 실패 · 불일치 section from narrative issues plus failed scenarios", () => {
		const narrative: QaReportNarrative = { issues: [{ severity: "LOW", description: "minor timing flake", location: "app.ts:12" }] };
		const html = renderQaReport(baseView(), narrative, fakeReader)!;
		const failures = html.slice(html.indexOf("<h2>실패 · 불일치"), html.indexOf("<h2>판정"));
		expect(failures).toContain("minor timing flake");
		expect(failures).toContain("app.ts:12");
		expect(failures).toContain("<code>story-1/sc-2</code>");
	});

	test("실패가 하나도 없으면 실패 섹션은 없음을 명시함", () => {
		const view = baseView({ scenarios: [baseView().scenarios![0]] });
		expect(renderQaReport(view, {}, fakeReader)!).toContain("이번 사이클에 기록된 실패나 불일치가 없습니다");
	});

	test("renders recorded baseline and per-run failures even when all scenarios pass", () => {
		const passing = baseView().scenarios!.map((sc) => ({ ...sc, status: "pass" as const }));
		const view = baseView({
			scenarios: passing,
			stories: [{ id: "story-1", actor: "actor-1", baseline: { result: "fail", note: "server did not start", cycle: 0 } }],
			run_checks: {
				stale_state: { result: "pass", cycle: 0 },
				dirty_worktree: { result: "fail", note: "verifier install changed package.json", cycle: 0 },
				flaky_rerun: { result: "pass", cycle: 0 },
			},
			verdict: "REQUEST_CHANGES",
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const failures = html.slice(html.indexOf("<h2>실패 · 불일치"), html.indexOf("<h2>판정"));
		expect(failures).toContain("story-1 / baseline");
		expect(failures).toContain("server did not start");
		expect(failures).toContain("dirty-worktree");
		expect(failures).toContain("verifier install changed package.json");
		expect(failures).not.toContain("이번 사이클에 기록된 실패나 불일치가 없습니다");
	});

	test("baseline build/test evidence never appears in the reader scenario section (it is not a user-boundary observation)", () => {
		const view = baseView({
			stories: [{ id: "story-1", actor: "actor-1", baseline: { result: "pass", cycle: 0, evidence: { path: "/evidence/baseline.log", surface: "bash" } } }],
		});
		const html = renderQaReport(view, {}, () => ({ kind: "text", content: "vitest 72 passed" }))!;
		const reader = readerSection(html);
		expect(reader).not.toContain("vitest 72 passed");
		expect(reader).not.toContain("변경 전 기준선");
	});

	test("current-cycle baseline evidence is embedded in the audit (self-contained build/test/lint proof), not merely path-listed", () => {
		const view = baseView({
			stories: [{ id: "story-1", actor: "actor-1", baseline: { result: "pass", cycle: 0, evidence: { path: "/evidence/baseline.log", surface: "bash" } } }],
		});
		const html = renderQaReport(view, {}, fakeReader)!;
		const audit = html.slice(html.indexOf(AUDIT_START), html.indexOf("<h2>증거 파일"));
		expect(audit).toContain("contents of /evidence/baseline.log");
		expect(readerSection(html)).not.toContain("contents of /evidence/baseline.log");
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
		const audit = html.slice(html.indexOf(AUDIT_START), html.indexOf("<h2>증거 파일"));
		expect(audit).toContain("<code>story-1 / baseline</code> — pass");
		expect(audit).toContain("distinctive baseline note &lt;keep&gt; &amp; &quot;quoted&quot;");
		expect(audit).toContain("contents of /evidence/passing-baseline.log");
	});

	test("an oversized (too-large) screenshot renders a placeholder in its card, not a false 'no evidence' gap", () => {
		const reader: EvidenceReader = (path) => ({ kind: "too-large", path, size: 5 * 1024 * 1024 });
		const scen = readerSection(renderQaReport(baseView(), {}, reader)!);
		expect(scen).not.toContain("실제 소프트웨어 관찰 근거가 없습니다");
		expect(scen).toContain("너무 커서");
		expect(scen).toContain("/evidence/action.png");
	});

	test("a screenshot shared by two scenario cards renders on BOTH cards (no false gap on the second)", () => {
		const shared = "/evidence/shared.png";
		const view = baseView({
			scenarios: [
				scenario({ id: "sc-1", evidence: { path: shared, surface: "agent-device" } }),
				scenario({ id: "sc-2", evidence: { path: shared, surface: "agent-device" } }),
			],
		});
		const reader: EvidenceReader = (path) =>
			path.endsWith(".png") ? { kind: "image", dataUri: "data:image/png;base64,AAAA" } : { kind: "text", content: "x" };
		const scen = readerSection(renderQaReport(view, {}, reader)!);
		expect((scen.match(/<img /g) ?? []).length).toBeGreaterThanOrEqual(2);
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
			view.scenarios = [{ ...view.scenarios![0], evidence: { path: bigTextPath, surface: "curl" } }]; // text-only boundary, no screenshot
			delete view.scenarios[0].evidence_review;
			const reader = readerSection(renderQaReport(view, {}, defaultEvidenceReader)!);
			expect(reader).not.toContain("너무 커서");
			expect(reader).not.toContain('class="evidence-slot"');
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
			scenarios: [{ ...baseView().scenarios![0], evidence: { path: dupPath, action: dupPath, surface: "agent-device" } }],
		});
		const scen = readerSection(renderQaReport(view, {}, reader)!);
		expect(scen.split(needle).length - 1).toBe(1); // embedded exactly once, not once-per-duplicate-field
		expect(scen).not.toContain("임베드 예산 초과");
	});

	test("renders the verdict from state", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		const verdict = html.slice(html.indexOf("<h2>판정"));
		expect(verdict).toContain('<p class="verdict">COMMENT</p>');
	});

	test("lists every recorded evidence path in the 증거 파일 section", () => {
		const html = renderQaReport(baseView(), {}, fakeReader)!;
		const evidenceSection = html.slice(html.indexOf("<h2>증거 파일"));
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
// Client impact + device profiles: each actor says whether a client renders its
// result, and a `render` actor is proven on every device profile it names.
// ---------------------------------------------------------------------------

describe("qa-report client impact and device profiles", () => {
	const actorsSection = (html: string): string => html.slice(html.indexOf("<h2>액터"), html.indexOf(READER_START));

	test("actor마다 client-impact 한 줄을 판단 근거와 함께 렌더함 (none · contract · render)", () => {
		const view = baseView({
			device_profiles: PROFILES,
			actors: [
				{ id: "actor-1", name: "Owner", boundary: "Home App", driver: "agent-device", reachable: "yes", client_impact: "render", client_impact_reason: "재고 카드 레이아웃이 바뀜", profiles: ["iphone-15", "web-1280"] },
				{ id: "actor-2", name: "Admin", boundary: "Admin API", driver: "curl", reachable: "yes", client_impact: "contract", client_impact_reason: "어드민 화면 코드는 그대로임" },
				{ id: "actor-3", name: "Nightly Job", boundary: "cron", driver: "bash", reachable: "yes", client_impact: "none", client_impact_reason: "결과를 그리는 클라이언트가 없음" },
			],
			stories: [{ id: "story-1", actor: "actor-1" }],
			scenarios: [],
		});
		const section = actorsSection(renderQaReport(view, {}, fakeReader)!);
		const lines = section.match(/<p class="client-impact">.*?<\/p>/g)!;
		expect(lines.length).toBe(3);
		expect(lines[0]).toContain("클라이언트 화면이 바뀜 — 기기 프로필마다 화면으로 확인");
		expect(lines[0]).toContain("재고 카드 레이아웃이 바뀜");
		expect(lines[1]).toContain("클라이언트가 받는 값이 바뀜 — 클라이언트 화면 코드는 그대로");
		expect(lines[1]).toContain("어드민 화면 코드는 그대로임");
		expect(lines[2]).toContain("클라이언트 영향 없음 — 이 변경을 읽어 화면에 그리는 클라이언트가 없음");
		expect(lines[2]).toContain("결과를 그리는 클라이언트가 없음");
	});

	test("render actor는 확인할 기기 목록을 라벨과 해상도로 보여주고, 다른 actor에는 기기 줄이 없음", () => {
		const view = baseView({
			device_profiles: PROFILES,
			actors: [
				{ id: "actor-1", name: "Owner", boundary: "Home App", driver: "agent-device", reachable: "yes", client_impact: "render", client_impact_reason: "r", profiles: ["iphone-15", "web-1280"] },
				{ id: "actor-2", name: "Admin", boundary: "Admin API", driver: "curl", reachable: "yes", client_impact: "contract", client_impact_reason: "c" },
			],
			scenarios: [],
		});
		const section = actorsSection(renderQaReport(view, {}, fakeReader)!);
		expect(section.match(/확인할 기기:/g)?.length).toBe(1);
		expect(section).toContain("확인할 기기: iPhone 15 (393×852) · 웹 데스크톱 (1280×800)");
	});

	test("client-impact 판단이 기록되지 않은 actor는 gap으로 표시함", () => {
		const view = baseView({ actors: [{ id: "actor-1", name: "Owner", boundary: "b", driver: "curl", reachable: "yes" }], scenarios: [] });
		const section = actorsSection(renderQaReport(view, {}, fakeReader)!);
		expect(section).toContain("이 유저의 클라이언트 영향 판단이 기록되지 않았습니다");
		expect(section).not.toContain('class="client-impact"');
	});

	test("client-impact 사유는 HTML escape함", () => {
		const view = baseView({ actors: [{ ...baseView().actors![0], client_impact_reason: "<b>bold</b>" }] });
		const section = actorsSection(renderQaReport(view, {}, fakeReader)!);
		expect(section).toContain("&lt;b&gt;bold&lt;/b&gt;");
		expect(section).not.toContain("<b>bold</b>");
	});

	const renderActorView = (scenarios: QaScenario[], profiles = ["iphone-15", "web-1280"]): QaView =>
		baseView({
			device_profiles: PROFILES,
			actors: [{ id: "actor-1", name: "Owner", boundary: "Home App", driver: "agent-device", reachable: "yes", client_impact: "render", client_impact_reason: "화면이 바뀜", profiles }],
			scenarios,
		});
	const shot = { path: "/evidence/after.png", surface: "agent-device", before: "/evidence/before.png", action: "/evidence/action.png", after: "/evidence/after.png" };

	test("기기별 확인은 actor의 profile마다 한 줄씩 결과를 보여주고, 시나리오가 없는 profile은 미실행으로 표시함", () => {
		const view = renderActorView([scenario({ id: "sc-1", profile: "iphone-15", evidence: shot })]);
		const html = renderQaReport(view, {}, fakeReader)!;
		const coverage = readerSection(html).match(/<div class="profile-coverage">.*?<\/ul><\/div>/)![0];
		expect(coverage).toContain("<strong>기기별 확인</strong>");
		expect(coverage).toContain('<span class="cov cov-pass">iPhone 15 (393×852) — 통과</span>');
		expect(coverage).toContain('<span class="cov cov-unrecorded">웹 데스크톱 (1280×800) — 미실행</span>');
		expect(coverage.match(/<li>/g)?.length).toBe(2);
		// 시나리오 카드에는 실행한 기기 라벨이 붙음
		expect(readerSection(html)).toContain('<span class="sc-profile">iPhone 15 (393×852)</span>');
	});

	test("기기별 확인은 같은 profile의 시나리오 중 가장 나쁜 결과를 보여줌 (실패 > 근거 미검증 > 검증 불가 > 미실행 > 통과)", () => {
		const blocked = { obstacle: "o", attempts: ["a"], deepest_reachable: "d", attempt_log: "/l.txt" };
		const view = renderActorView([
			scenario({ id: "sc-1", profile: "iphone-15", evidence: shot }),
			scenario({ id: "sc-2", profile: "iphone-15", status: "fail", evidence: shot }),
			scenario({ id: "sc-3", profile: "web-1280", evidence: shot }),
			scenario({ id: "sc-4", profile: "web-1280", status: "blocked", blocked }),
		]);
		const coverage = readerSection(renderQaReport(view, {}, fakeReader)!).match(/<div class="profile-coverage">.*?<\/ul><\/div>/)![0];
		expect(coverage).toContain("iPhone 15 (393×852) — 실패");
		expect(coverage).toContain("웹 데스크톱 (1280×800) — 검증 불가");
		expect(coverage).not.toContain("— 통과");
	});

	test("주장 검토가 없는 profile 시나리오는 기기별 확인에서 근거 미검증으로 표시함", () => {
		const view = renderActorView([
			scenario({ id: "sc-1", profile: "iphone-15", evidence: shot }),
			scenario({ id: "sc-2", profile: "web-1280", evidence: shot }),
		]);
		delete view.scenarios![1].evidence_review;
		const coverage = readerSection(renderQaReport(view, {}, fakeReader)!).match(/<div class="profile-coverage">.*?<\/ul><\/div>/)![0];
		expect(coverage).toContain("iPhone 15 (393×852) — 통과");
		expect(coverage).toContain('<span class="cov cov-unverified">웹 데스크톱 (1280×800) — 근거 미검증</span>');
	});

	test("render가 아닌 actor의 story에는 기기별 확인을 렌더하지 않음", () => {
		const reader = readerSection(renderQaReport(baseView(), {}, fakeReader)!);
		expect(reader).not.toContain("profile-coverage");
		expect(reader).not.toContain("기기별 확인");
	});

	test("profile이 있는 시나리오는 비시각 driver여도 전후 화면과 검토가 필요하다: 기본은 근거 미검증, 엄격 모드는 예외", () => {
		const view = baseView({
			device_profiles: PROFILES,
			actors: [{ id: "actor-1", name: "Owner", boundary: "Home App", driver: "bash", reachable: "yes", client_impact: "contract", client_impact_reason: "c" }],
			scenarios: [scenario({ id: "sc-1", profile: "iphone-15", evidence: { path: "/evidence/run.log", surface: "bash" } })],
		});
		delete view.scenarios![0].evidence_review; // a log is no screenshot review
		const html = renderQaReport(view, { scenarios: { "story-1:sc-1": { observed: "화면 확인" } } }, fakeReader)!;
		expect(readerSection(html)).toContain('class="scenario-card sc-unverified"');
		expect(html).toContain("판정 보류 — 근거 미검증 시나리오가 있음");
		expect(() => renderQaReport(view, { scenarios: { "story-1:sc-1": { observed: "화면 확인" } } }, fakeReader, undefined, undefined, true)).toThrow("visual evidence missing");
	});

	test("profile이 없고 evidence surface가 test인 시나리오는 시각 증거를 요구하지 않음", () => {
		const view = baseView({ scenarios: [scenario({ id: "sc-1", evidence: { path: "/evidence/unit.log", surface: "test" } })] });
		const html = renderQaReport(view, { scenarios: { "story-1:sc-1": { observed: "테스트가 통과함" } } }, fakeReader, undefined, undefined, true)!;
		expect(readerSection(html)).toContain('class="scenario-card sc-pass"');
		expect(html).not.toContain("판정 보류");
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
	const AC_START = "요구사항(AC) 충족 현황";
	const acSection = (html: string): string => html.slice(html.indexOf(AC_START), html.indexOf("큰 그림"));
	const fullPresentation = (): QaReportNarrative => ({
		presentation: {
			overview: "flag-ON일 때 재고 화면을 v2로 교체하는 변경",
			affectedUsers: { "actor-1": "가구 소유자는 매일 재고 화면을 열어 잔량을 확인한다" },
			scenarioFlows: { "story-1": "소유자가 재고 화면에 진입하면 8슬롯 v2 화면이 보인다" },
			requirementMapping: {
				"0": {
					satisfied: "yes",
					scenarioRefs: [{ story: "story-1", scenario: "sc-1" }],
					evidence: "재고 화면 진입 시나리오 통과 — before/after 캡처",
				},
			},
			bigPicture: "flowchart LR\n  Owner --> StockScreen",
			bigPictureCaption: "소유자 재고 확인 흐름",
		},
	});

	test("renders the presentation layer ABOVE the verification-log sections", () => {
		const view = baseView({ acceptance_criteria: ["flag ON이면 v2 재고 화면"] });
		const html = renderQaReport(view, fullPresentation(), fakeReader, fakeMermaid)!;
		expect(html.indexOf("기능 개요")).toBeGreaterThanOrEqual(0);
		expect(html.indexOf("기능 개요")).toBeLessThan(html.indexOf(AC_START));
		expect(html.indexOf(AC_START)).toBeLessThan(html.indexOf("큰 그림"));
		expect(html.indexOf(READER_START)).toBeLessThan(html.indexOf(AUDIT_START));
	});

	test("renders the feature overview prose", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		expect(html).toContain("flag-ON일 때 재고 화면을 v2로 교체하는 변경");
	});

	test("최종 보고서의 기능 개요에 QA 결과를 쓰면 렌더를 거부한다", () => {
		for (const overview of ["판정은 의견과 함께 승인(COMMENT)입니다. 예약을 지웠다.", "운영 로그는 검증 불가였다.", "신뢰도 70/100 LOW 의견이 있다.", "이번 QA는 예약 제거만 확인했다."]) {
			expect(() => renderQaReport(baseView(), { presentation: { overview } }, fakeReader, fakeMermaid, undefined, true)).toThrow(/기능 개요/);
		}
		expect(() => renderQaReport(baseView(), { presentation: { overview: "운영자는 매일 새벽 자동 대조 작업에 기대지 않고 필요할 때 직접 실행한다." } }, fakeReader, fakeMermaid, undefined, true)).not.toThrow(/기능 개요/);
	});

	test("독자용 문장의 영어 단어를 중복 없이 정렬해 알려준다", () => {
		const view = baseView();
		const narrative = { presentation: { overview: "iPhone SE에서 overflow가 hidden으로 바뀐다." }, scenarios: { "s/x": { observed: "iPhone 화면에서 interactive-widget 값이 fixed다." } } };
		const words = readerEnglishWords(view, narrative);
		for (const word of ["SE", "fixed", "hidden", "iPhone", "interactive-widget", "overflow"]) expect(words).toContain(word);
		expect(words.filter((word) => word === "iPhone")).toHaveLength(1);
		expect([...words].sort()).toEqual(words);
	});

	test("최종 보고서의 독자용 문장에 코드 이름을 쓰면 렌더를 거부한다", () => {
		const reject = [
			{ presentation: { requirementMapping: { "0": { satisfied: "yes" as const, scenarioRefs: [], evidence: "SelfIntakeSections.test.tsx 검증이 번호 표시를 확인한다." } } } },
			{ presentation: { affectedUsers: { a: "운영자는 supplementCategories 맵을 본다." } } },
			{ scenarios: { "s/x": { observed: "localStorage의 실행 표시가 비어 있었다." } } },
		];
		for (const narrative of reject) {
			expect(() => renderQaReport(baseView(), narrative, fakeReader, fakeMermaid, undefined, true)).toThrow(/names the code identifier/);
		}
		const plain = { presentation: { requirementMapping: { "0": { satisfied: "yes" as const, scenarioRefs: [], evidence: "보유분 표 화면 테스트가 번호 표시를 확인한다." } } } };
		expect(() => renderQaReport(baseView(), plain, fakeReader, fakeMermaid, undefined, true)).not.toThrow(/names the code identifier/);
	});

	test("공백만 있는 기능 개요 서사는 누락 gap으로 렌더한다", () => {
		const html = renderQaReport(baseView(), { presentation: { overview: " \t\n " } }, fakeReader, fakeMermaid)!;
		const overview = html.slice(html.indexOf("기능 개요"), html.indexOf(AC_START));
		expect(overview).toContain('class="gap"');
		expect(overview).toContain("기능 개요 서사가 없습니다");
	});

	test("renders a visible gap marker for each required slot when no presentation is supplied", () => {
		const view = baseView({ acceptance_criteria: ["flag ON이면 v2 재고 화면"] });
		const html = renderQaReport(view, {}, fakeReader, fakeMermaid)!;
		const presentation = html.slice(0, html.indexOf(AUDIT_START));
		expect(presentation).toContain('class="gap"');
		expect((presentation.match(/class="gap"/g) ?? []).length).toBeGreaterThanOrEqual(4);
	});

	test("anchors affected-users to the recorded roster: renders prose keyed by actor id", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		const affected = html.slice(html.indexOf("<h2>액터"), html.indexOf(READER_START));
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
				{ id: "actor-1", name: "Household Owner", boundary: "Home App", driver: "agent-device", reachable: "yes", client_impact: "contract", client_impact_reason: "c" },
				{ id: "actor-2", name: "Admin", boundary: "Admin Console", driver: "agent-browser", reachable: "yes", client_impact: "contract", client_impact_reason: "c" },
			],
		});
		const narrative: QaReportNarrative = { presentation: { affectedUsers: { "actor-1": "소유자 서사" } } };
		const html = renderQaReport(view, narrative, fakeReader, fakeMermaid)!;
		const affected = html.slice(html.indexOf("<h2>액터"), html.indexOf(READER_START));
		expect(affected).toContain("소유자 서사");
		expect(affected).toContain("Admin");
		expect(affected).toContain("이 유저의 사용·영향 서사가 없습니다"); // actor-2 has no prose -> gap
	});

	test("공백만 있는 기록된 액터의 사용·영향 서사는 누락 gap으로 렌더한다", () => {
		const narrative: QaReportNarrative = { presentation: { affectedUsers: { "actor-1": " \t\n " } } };
		const html = renderQaReport(baseView(), narrative, fakeReader, fakeMermaid)!;
		const affected = html.slice(html.indexOf("<h2>액터"), html.indexOf(READER_START));
		expect(affected).toContain('class="gap"');
		expect(affected).toContain("이 유저의 사용·영향 서사가 없습니다");
	});

	test("anchors each story's flow narrative inline in the reader scenario section, beside its evidence and its goal", () => {
		const view = baseView({ stories: [{ id: "story-1", actor: "actor-1", contract: { goal: "재고를 한눈에 확인한다", given: ["g"], when: ["w"], then: ["t"], acceptance_criteria: [0] } }], acceptance_criteria: ["ac"] });
		const html = renderQaReport(view, fullPresentation(), fakeReader, fakeMermaid)!;
		const scenarios = readerSection(html);
		expect(scenarios).toContain("<h3>Household Owner</h3>");
		expect(scenarios).toContain("소유자가 재고 화면에 진입하면 8슬롯 v2 화면이 보인다");
		expect(scenarios).toContain("<strong>목표</strong> 재고를 한눈에 확인한다");
		expect(scenarios).toContain("data:image/png;base64,AAAA"); // its evidence
	});

	test("시나리오 카드는 제목, 기대 결과, 전제와 단계를 보여줌", () => {
		const view = baseView({ scenarios: [scenario({ id: "sc-1", title: "재고 화면 진입", preconditions: "로그인한 소유자", steps: ["홈을 연다", "재고 탭을 누른다"], expected: "8슬롯이 보인다", evidence: { path: "/evidence/api.log", surface: "curl" } })] });
		const scenarios = readerSection(renderQaReport(view, {}, fakeReader)!);
		expect(scenarios).toContain('<span class="sc-title">재고 화면 진입</span>');
		expect(scenarios).toContain("<strong>기대 결과</strong> 8슬롯이 보인다");
		expect(scenarios).toContain("<summary>전제와 단계</summary><p>로그인한 소유자</p>");
		expect(scenarios).toContain("<li>홈을 연다</li><li>재고 탭을 누른다</li>");
	});

	test("공백만 있는 시나리오 흐름 서사는 누락 gap으로 렌더한다", () => {
		const narrative: QaReportNarrative = { presentation: { scenarioFlows: { "story-1": " \t\n " } } };
		const html = renderQaReport(baseView(), narrative, fakeReader, fakeMermaid)!;
		const scenarios = readerSection(html);
		expect(scenarios).toContain('class="gap"');
		expect(scenarios).toContain("이 스토리에서 어떤 시나리오들을 검증했는지에 대한 개요 서사가 없습니다");
	});

	test("maps each recorded acceptance criterion to a satisfaction badge and evidence prose", () => {
		const view = baseView({ acceptance_criteria: ["flag ON이면 v2 재고 화면"] });
		const html = renderQaReport(view, fullPresentation(), fakeReader, fakeMermaid)!;
		const mapping = acSection(html);
		expect(mapping).toContain("flag ON이면 v2 재고 화면");
		expect(mapping).toContain("재고 화면 진입 시나리오 통과 — before/after 캡처");
		expect(mapping).toContain("satisfied-yes");
		expect(mapping).toContain(">충족</span>");
	});

	test("공백만 있는 요구사항 충족 근거는 누락 gap으로 렌더한다", () => {
		const view = baseView({ acceptance_criteria: ["flag ON이면 v2 재고 화면"] });
		const narrative: QaReportNarrative = {
			presentation: {
				requirementMapping: {
					"0": { satisfied: "yes", scenarioRefs: [{ story: "story-1", scenario: "sc-1" }], evidence: " \t\n " },
				},
			},
		};
		const mapping = acSection(renderQaReport(view, narrative, fakeReader, fakeMermaid)!);
		expect(mapping).toContain('class="gap"');
		expect(mapping).toContain("충족 근거 서사가 없습니다");
	});

	const blockedScenario = (id: string): QaScenario =>
		scenario({ id, status: "blocked", blocked: { obstacle: "단일 연결", attempts: ["docker 없음"], deepest_reachable: "PGlite", attempt_log: "/evidence/attempts.txt" } });
	const passScenario = (id: string): QaScenario => scenario({ id, evidence: { path: "/evidence/after.png", surface: "agent-device", after: "/evidence/after.png" } });
	const failScenario = (id: string): QaScenario => scenario({ id, status: "fail", evidence: { path: "/evidence/after.png", surface: "agent-device", after: "/evidence/after.png" } });
	const ref = (id: string) => ({ story: "story-1", scenario: id });

	test("accepts yes, no, partial, and unverified mappings when their current-cycle scenario refs match the claimed status", () => {
		const cases = [
			{ satisfied: "yes" as const, scenarios: [passScenario("sc-1")], refs: [ref("sc-1")] },
			{ satisfied: "no" as const, scenarios: [failScenario("sc-1")], refs: [ref("sc-1")] },
			{ satisfied: "partial" as const, scenarios: [passScenario("sc-1"), failScenario("sc-2")], refs: [ref("sc-1"), ref("sc-2")] },
			{ satisfied: "unverified" as const, scenarios: [blockedScenario("sc-1")], refs: [ref("sc-1")] },
			{ satisfied: "unverified" as const, scenarios: [passScenario("sc-1"), blockedScenario("sc-2")], refs: [ref("sc-1"), ref("sc-2")] },
		];

		for (const candidate of cases) {
			const view = baseView({ acceptance_criteria: [candidate.satisfied], scenarios: candidate.scenarios });
			const narrative: QaReportNarrative = {
				presentation: { requirementMapping: { "0": { satisfied: candidate.satisfied, scenarioRefs: candidate.refs, evidence: "상태에 맞는 설명" } } },
			};
			const mapping = acSection(renderQaReport(view, narrative, fakeReader, fakeMermaid)!);
			expect(mapping).toContain(`satisfied-${candidate.satisfied}`);
			expect(mapping).not.toContain("미판정");
		}
	});

	test("does not let a pass from another story satisfy an AC mapped to a failing story", () => {
		const view = baseView({
			acceptance_criteria: ["story-1 경로가 성공한다"],
			actors: [
				...baseView().actors!,
				{ id: "actor-2", name: "Admin", boundary: "Admin Console", driver: "agent-browser", reachable: "yes", client_impact: "contract", client_impact_reason: "c" },
			],
			stories: [
				{ id: "story-1", actor: "actor-1" },
				{ id: "story-2", actor: "actor-2" },
			],
			scenarios: [failScenario("sc-1"), { ...passScenario("sc-1"), story: "story-2" }],
		});
		const narrative = {
			presentation: { requirementMapping: { "0": { satisfied: "yes", scenarioRefs: [ref("sc-1")], evidence: "다른 story의 통과 설명" } } },
		} as QaReportNarrative;
		const mapping = acSection(renderQaReport(view, narrative, fakeReader, fakeMermaid)!);
		expect(mapping).toContain("미판정");
		expect(mapping).toContain('class="gap"');
		expect(mapping).not.toContain("satisfied-yes");
	});

	test("fails closed for legacy, cell-era, missing, malformed, duplicate, stale-cycle, unknown-story, unknown-scenario, and ineligible refs", () => {
		const cases: Array<{ label: string; view: QaView; mapping: unknown }> = [
			{ label: "legacy prose only", view: baseView({ acceptance_criteria: ["legacy"] }), mapping: { satisfied: "yes", evidence: "prose only" } },
			{ label: "cell-era cellRefs", view: baseView({ acceptance_criteria: ["cells"], scenarios: [passScenario("sc-1")] }), mapping: { satisfied: "yes", cellRefs: [{ story: "story-1", cls: 1 }], evidence: "retired selector" } },
			{ label: "missing refs", view: baseView({ acceptance_criteria: ["missing"] }), mapping: { satisfied: "yes", scenarioRefs: [], evidence: "empty refs" } },
			{ label: "malformed ref", view: baseView({ acceptance_criteria: ["malformed"], scenarios: [passScenario("sc-1")] }), mapping: { satisfied: "yes", scenarioRefs: [{ story: "story-1", scenario: 1 }], evidence: "wrong scenario type" } },
			{ label: "blank ref", view: baseView({ acceptance_criteria: ["blank"], scenarios: [passScenario("sc-1")] }), mapping: { satisfied: "yes", scenarioRefs: [{ story: "story-1", scenario: " " }], evidence: "blank id" } },
			{ label: "duplicate ref", view: baseView({ acceptance_criteria: ["duplicate"], scenarios: [passScenario("sc-1")] }), mapping: { satisfied: "yes", scenarioRefs: [ref("sc-1"), ref("sc-1")], evidence: "duplicate" } },
			{ label: "stale cycle", view: baseView({ acceptance_criteria: ["stale"], scenarios: [{ ...passScenario("sc-1"), cycle: 1 }] }), mapping: { satisfied: "yes", scenarioRefs: [ref("sc-1")], evidence: "stale" } },
			{ label: "unknown story", view: baseView({ acceptance_criteria: ["unknown"], scenarios: [passScenario("sc-1")] }), mapping: { satisfied: "yes", scenarioRefs: [{ story: "ghost", scenario: "sc-1" }], evidence: "unknown" } },
			{ label: "unknown scenario", view: baseView({ acceptance_criteria: ["selector"], scenarios: [passScenario("sc-1")] }), mapping: { satisfied: "yes", scenarioRefs: [ref("sc-9")], evidence: "no such scenario" } },
			{ label: "status ineligible", view: baseView({ acceptance_criteria: ["ineligible"], scenarios: [failScenario("sc-1")] }), mapping: { satisfied: "yes", scenarioRefs: [ref("sc-1")], evidence: "fail is not yes" } },
			{ label: "unrecorded scenario", view: baseView({ acceptance_criteria: ["unrecorded"], scenarios: [scenario({ id: "sc-1", status: undefined })] }), mapping: { satisfied: "yes", scenarioRefs: [ref("sc-1")], evidence: "not run" } },
			{
				label: "partial includes blocked",
				view: baseView({ acceptance_criteria: ["partial includes blocked"], scenarios: [passScenario("sc-1"), failScenario("sc-2"), blockedScenario("sc-3")] }),
				mapping: { satisfied: "partial", scenarioRefs: [ref("sc-1"), ref("sc-2"), ref("sc-3")], evidence: "blocked must not make partial valid" },
			},
			{
				label: "unverified without a blocked scenario",
				view: baseView({ acceptance_criteria: ["unverified"], scenarios: [passScenario("sc-1"), failScenario("sc-2")] }),
				mapping: { satisfied: "unverified", scenarioRefs: [ref("sc-1"), ref("sc-2")], evidence: "no blocked scenario backs this" },
			},
		];

		for (const candidate of cases) {
			const narrative = { presentation: { requirementMapping: { "0": candidate.mapping } } } as QaReportNarrative;
			const mapping = acSection(renderQaReport(candidate.view, narrative, fakeReader, fakeMermaid)!);
			if (!mapping.includes("미판정") || !mapping.includes('class="gap"') || /satisfied-(yes|no|partial|unverified)/.test(mapping)) {
				throw new Error(`${candidate.label}: expected a neutral fail-closed AC mapping`);
			}
		}
	});

	test("매핑이 있으나 검증할 수 없으면 미충족 판정 없이 '시나리오 근거 매핑을 검증할 수 없습니다'를, 매핑이 없으면 '충족 판정이 없습니다'를 구분해 보여줌", () => {
		const view = baseView({ acceptance_criteria: ["a", "b"] });
		const narrative: QaReportNarrative = { presentation: { requirementMapping: { "0": { satisfied: "yes", scenarioRefs: [ref("sc-9")], evidence: "x" } } } };
		const mapping = acSection(renderQaReport(view, narrative, fakeReader, fakeMermaid)!);
		expect(mapping).toContain("이 요구사항의 시나리오 근거 매핑을 검증할 수 없습니다");
		expect(mapping).toContain("이 요구사항의 충족 판정이 없습니다");
	});

	test("renders an unverified requirement LOUDLY (미검증 — 검증 불가 시나리오에 걸림), never as a quiet partial", () => {
		const view = baseView({
			acceptance_criteria: ["flag ON이면 v2 재고 화면"],
			scenarios: [...baseView().scenarios!, blockedScenario("sc-3")],
		});
		const narrative: QaReportNarrative = {
			presentation: {
				requirementMapping: {
					"0": { satisfied: "unverified", scenarioRefs: [ref("sc-3")], evidence: "어드민 화면이 부팅되지 않아 유저 경계를 구동하지 못함" },
				},
			},
		};
		const mapping = acSection(renderQaReport(view, narrative, fakeReader, fakeMermaid)!);
		expect(mapping).toContain("satisfied-unverified");
		expect(mapping).toContain("미검증 — 검증 불가 시나리오에 걸림");
		expect(mapping).not.toContain("충족</span>"); // never rendered as met/partial
	});

	test("연결된 시나리오의 주장 검토가 없으면 매핑이 유효해도 AC는 근거 미검증 gap으로 렌더함", () => {
		const view = baseView({ acceptance_criteria: ["ac"], scenarios: [passScenario("sc-1")] });
		delete view.scenarios![0].evidence_review;
		const narrative: QaReportNarrative = { presentation: { requirementMapping: { "0": { satisfied: "yes", scenarioRefs: [ref("sc-1")], evidence: "통과" } } } };
		const mapping = acSection(renderQaReport(view, narrative, fakeReader, fakeMermaid)!);
		expect(mapping).toContain("satisfied-unverified");
		expect(mapping).toContain("근거 미검증 — 연결된 시나리오의 주장 검토가 없거나 부족하거나 오래되었습니다");
		expect(mapping).not.toContain("satisfied-yes");
	});

	test("renders a gap marker for a recorded AC that has no satisfaction mapping", () => {
		const view = baseView({ acceptance_criteria: ["매핑된 AC", "매핑 안 된 AC"] });
		const narrative: QaReportNarrative = {
			presentation: { requirementMapping: { "0": { satisfied: "yes", scenarioRefs: [ref("sc-1")], evidence: "근거" } } },
		};
		const mapping = acSection(renderQaReport(view, narrative, fakeReader, fakeMermaid)!);
		expect(mapping).toContain("매핑된 AC");
		expect(mapping).toContain("매핑 안 된 AC");
		expect(mapping).toContain('class="gap"');
	});

	test("bakes the big-picture mermaid source to an inline SVG via the injected renderer", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		const big = html.slice(html.indexOf("큰 그림"), html.indexOf("<h2>액터"));
		expect(big).toContain("<svg");
		expect(big).toContain("소유자 재고 확인 흐름"); // caption
		// width="100%" is normalized to the viewBox pixel width so labels stay legible
		expect(big).toContain('width="300"');
		expect(big).not.toContain('width="100%"');
	});

	test(".diagram은 다크 모드에서도 화살표와 라벨이 읽히도록 흰색 고정 배경 패널이다", () => {
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, fakeMermaid)!;
		const rule = html.match(/\.diagram \{([^}]*)\}/)![1];
		expect(rule).toContain("background: #ffffff");
		expect(rule).toContain("color-scheme: light");
		expect(html).toContain('<figure class="diagram">');
		// 캡션도 흰 패널 위에서 읽히도록 어두운 고정색을 씀
		expect(html).toMatch(/\.diagram figcaption \{[^}]*color: #4a4a4a/);
	});

	test("degrades gracefully to the mermaid source when the renderer throws (report never aborts)", () => {
		const throwingMermaid: MermaidRenderer = () => {
			throw new Error("mmdc 가 없습니다");
		};
		const html = renderQaReport(baseView(), fullPresentation(), fakeReader, throwingMermaid)!;
		expect(html).not.toBeNull();
		const big = html.slice(html.indexOf("큰 그림"), html.indexOf("<h2>액터"));
		expect(big).toContain("flowchart LR");
		expect(big).toContain("다이어그램 렌더 실패");
	});

	test("renders a gap marker when no big-picture diagram is supplied", () => {
		const narrative: QaReportNarrative = { presentation: { overview: "개요만 있음" } };
		const html = renderQaReport(baseView(), narrative, fakeReader, fakeMermaid)!;
		const big = html.slice(html.indexOf("큰 그림"), html.indexOf("<h2>액터"));
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
// never a silent hole.
// ---------------------------------------------------------------------------
describe("qa-report per-scenario evidence", () => {
	const apiView = (): QaView => {
		const view = baseView();
		view.scenarios = [{ ...view.scenarios![0], evidence: { path: "/evidence/api.log", surface: "curl" } }]; // text-only boundary
		delete view.scenarios[0].evidence_review;
		return view;
	};

	test("리더는 검증된 시나리오마다 독립 카드를 렌더한다 (병합된 근거 벽이 아니라)", () => {
		const reader = readerSection(renderQaReport(baseView(), {}, fakeReader)!);
		// baseView: sc-1 pass + sc-2 fail → 2 scenario cards
		expect((reader.match(/class="scenario-card/g) ?? []).length).toBe(2);
	});

	test("각 시나리오의 스크린샷은 그 시나리오 카드 안에 묶여 렌더된다", () => {
		const reader = readerSection(renderQaReport(baseView(), {}, fakeReader)!);
		const cards = reader.split('class="scenario-card').slice(1);
		expect(cards.length).toBe(2);
		expect(cards[0]).toContain("data:image/png;base64,AAAA"); // sc-1's own captures
		expect(cards[1]).toContain("data:image/png;base64,AAAA"); // sc-2's own capture
	});

	test("API/CLI 텍스트 경계 시나리오는 저자가 쓴 관찰 자연어를 리더에 보여준다 (raw transcript는 감사에만)", () => {
		const narrative: QaReportNarrative = {
			scenarios: { "story-1:sc-1": { observed: "로그인 없이 요청하니 서버가 401을 돌려주며 게이트 모달이 유지됐다" } },
		};
		const html = renderQaReport(apiView(), narrative, () => ({ kind: "text", content: "HTTP/1.1 401 RAW" }))!;
		expect(readerSection(html)).toContain("로그인 없이 요청하니 서버가 401을 돌려주며 게이트 모달이 유지됐다");
		expect(readerSection(html)).not.toContain("HTTP/1.1 401 RAW"); // raw transcript never in the reader
		expect(auditSection(html)).toContain("HTTP/1.1 401 RAW"); // preserved in the audit
	});

	test("스크린샷도 관찰 자연어도 없는 검증 시나리오는 리더에 크게 갭을 낸다 (raw 로그만으로는 리더 근거가 아님)", () => {
		const reader = readerSection(renderQaReport(apiView(), {}, () => ({ kind: "text", content: "raw" }))!);
		expect(reader).toContain('class="gap"');
		expect(reader).toContain("실제 소프트웨어 관찰");
	});

	test("공백·탭·개행만 있는 관찰은 리더 근거로 취급하지 않고 missing-observation gap을 렌더한다", () => {
		const narrative: QaReportNarrative = { scenarios: { "story-1:sc-1": { observed: " \t\n  " } } };
		const reader = readerSection(renderQaReport(apiView(), narrative, () => ({ kind: "text", content: "raw" }))!);
		const firstCard = reader.split('class="scenario-card').slice(1)[0];
		expect(firstCard).toContain('class="gap"');
		expect(firstCard).toContain("실제 소프트웨어 관찰");
		expect(firstCard).not.toContain('class="sc-observed"');
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
	const addNoClientActor = () =>
		runState('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes --client-impact none --client-impact-reason "결과를 그리는 클라이언트가 없음"');

	test("writes a self-contained HTML file for a session with a recorded roster", () => {
		runState("set --phase PLAN");
		runState("set-acceptance --json '[\"The home boundary shows the requested result\"]'");
		addNoClientActor();
		runState("add-story --id story-1 --actor actor-1 --goal 'Verify home result' --given '[\"The program exists\"]' --when '[\"The user opens home\"]' --then '[\"The requested result is shown\"]' --acceptance-criteria '[0]'");
		runState("author-scenario --story story-1 --id sc-1 --title '홈 결과 확인' --preconditions '프로그램이 있음' --steps '[\"홈을 연다\"]' --expected '요청한 결과가 보인다' --why-needed '핵심 경로' --priority H --risks '[1]'");
		runState(
			"record-scenario --story story-1 --scenario sc-1 --status pass " +
				"--evidence-path skills/qa/scripts/qa-report.test.ts --evidence-surface bash",
		);
		const out = join(tmpDir, "report.html");
		const stdout = execSync(`bun ${reportScript} --session ${S} --out ${out}`, { encoding: "utf8", env: process.env });
		expect(stdout.trim()).toBe(out);
		expect(existsSync(out)).toBe(true);
		const html = readFileSync(out, "utf8");
		expect(html).toContain("<style>");
		expect(html).toContain("User");
		expect(html).toContain("홈 결과 확인");
		expect(html).toContain("통과 1");
		expect(html).not.toContain("<script");
	});

	test("Mermaid 렌더링 실패 시 필수 CLI는 실패하고 보고서를 성공 생성하지 않는다", () => {
		runState("set --phase PLAN");
		addNoClientActor();

		const binDir = join(tmpDir, "bin");
		mkdirSync(binDir);
		writeFileSync(join(binDir, "mmdc"), "#!/bin/sh\nprintf '%s\\n' 'forced mmdc failure' >&2\nexit 17\n", {
			mode: 0o755,
		});
		const narrative = join(tmpDir, "narrative.json");
		writeFileSync(narrative, JSON.stringify({ presentation: { bigPicture: "flowchart LR\n  A --> B" } }));
		const out = join(tmpDir, "report.html");
		const result = spawnSync(
			process.execPath,
			[reportScript, "--session", S, "--out", out, "--narrative", narrative],
			{
				encoding: "utf8",
				env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
			},
		);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("qa-report: Mermaid rendering failed");
		expect(result.stderr).toContain("forced mmdc failure");
		expect(result.stdout).not.toContain(out);
		expect(existsSync(out)).toBe(false);
	});

	test("is a no-op (writes nothing, reports so) when the roster is empty", () => {
		runState("set --phase PRE-FLIGHT");
		const out = join(tmpDir, "report.html");
		const stdout = execSync(`bun ${reportScript} --session ${S} --out ${out}`, { encoding: "utf8", env: process.env });
		expect(stdout).toContain("no roster");
		expect(existsSync(out)).toBe(false);
	});
});
