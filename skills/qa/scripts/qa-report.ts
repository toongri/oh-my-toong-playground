#!/usr/bin/env bun
/**
 * qa-report — renders a self-contained HTML report from a `qa-state get`
 * (QaView) snapshot.
 *
 * Forks skills/explain-diff/scripts/render.ts's mechanics (inline <style>,
 * zero runtime <script>, escapeHtml on every interpolated value, no external
 * CSS/JS/font/image reference) without a runtime import from that skill — the
 * two skills stay independent; only the technique is reused.
 *
 * The report's AC/actor/story/scenario/evidence/verdict facts come from the
 * recorded QaView only — this file never re-derives or re-judges them. The
 * caller may additionally supply a `narrative` object carrying the parts that
 * are never persisted to qa-state: issue descriptions, expected-vs-actual
 * prose, and oracle diagnosis. See skills/qa/SKILL.md "HTML Report".
 */
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, extname, join, resolve } from "path";
import { getOmtDir } from "@lib/omt-dir";
import { requiredCells, type QaBaseline, type QaCell, type QaResult, type QaRunCheck, type QaStory } from "@lib/qa-chain-core";
import { readQaView, type QaView } from "./qa-state.ts";

// Keep individual evidence files small enough to inspect, and cap the total
// embedded payload so a full scenario matrix cannot produce an impractical
// self-contained document.
export const MAX_EMBED_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_EMBED_BYTES = 16 * 1024 * 1024;

export type EvidenceEmbed =
	| { kind: "image"; dataUri: string }
	| { kind: "text"; content: string }
	| { kind: "missing"; path: string }
	// `media` records whether the oversized file was an image or plain text, so
	// `imageSlot` can tell a too-large screenshot (still shows the placeholder)
	// from too-large text/API/CLI evidence (never a screenshot placeholder).
	// Absent (existing injected test readers) behaves as before: image.
	| { kind: "too-large"; path: string; size: number; media?: "image" | "text" };

export type EvidenceReader = (path: string) => EvidenceEmbed;

const IMAGE_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

/** Reads evidence off disk: images embed as base64 data URIs (capped), everything else renders as text. */
export function defaultEvidenceReader(path: string): EvidenceEmbed {
	const absolute = resolve(path);
	try {
		const size = statSync(absolute).size;
		const mime = IMAGE_MIME[extname(absolute).toLowerCase()];
		if (size > MAX_EMBED_BYTES) return { kind: "too-large", path, size, media: mime ? "image" : "text" };
		if (mime) {
			const data = readFileSync(absolute);
			return { kind: "image", dataUri: `data:${mime};base64,${data.toString("base64")}` };
		}
		return { kind: "text", content: readFileSync(absolute, "utf8") };
	} catch {
		return { kind: "missing", path };
	}
}

export interface QaReportNarrativeIssue {
	severity: "CRITICAL" | "LOW";
	description: string;
	location?: string;
	what?: string;
}

export interface QaReportScenarioNarrative {
	/**
	 * Reader-facing: what was done at this scenario's user boundary and what the
	 * real software rendered, in plain language. This IS the reader evidence for a
	 * scenario verified at a non-visual boundary (API/CLI) — it stands in for the
	 * raw transcript, which stays in the audit. For a UI scenario it narrates the
	 * screenshots beside it. Required for every verified (pass/fail) cell that has
	 * no screenshot; its absence there renders a loud gap.
	 */
	observed?: string;
	expectedVsActual?: string;
	oracleDiagnosis?: string;
}

/**
 * One recorded acceptance criterion's satisfaction judgment (render-time).
 * `unverified` is distinct from `no`: the requirement was NOT driven at its user
 * boundary (unreachable environment / NOT-RUN scenarios), so it is neither proven
 * met nor proven broken — it reads loudly as "미검증", never as a quiet partial.
 */
export interface QaReportAcMapping {
	satisfied?: "yes" | "no" | "partial" | "unverified";
	/** Structured current-cycle cell selectors; legacy prose-only mappings fail closed. */
	cellRefs?: Array<{
		story: string;
		cls: number;
		sub?: "hang-timeout" | "flaky-green";
	}>;
	/** Which stories/scenarios/evidence prove (or fail) this criterion, in prose. */
	evidence?: string;
}

/**
 * The reader-facing presentation layer — the product/user-centric narrative a
 * context-free PO/designer reads first to judge whether the change met the
 * requirements, without opening code or the verification log below it.
 *
 * It is NOT a code-diff summary. Every part is anchored to a recorded fact so
 * the layer cannot drift from what qa actually ran:
 * - `affectedUsers` is keyed by recorded actor id (roster is authoritative);
 *   prose for an id absent from the roster is ignored, never invented onto the page.
 * - `scenarioFlows` is keyed by recorded story id.
 * - `requirementMapping` is keyed by the recorded acceptance-criterion index
 *   (as a string); the criterion text itself always comes from qa-state records.
 * Only the prose and the big-picture diagram originate here. A required slot with
 * no narrative renders a visible gap marker instead of silently vanishing.
 */
export interface QaReportPresentation {
	/** 기능 개요 — what the change is and why, at the product level. */
	overview?: string;
	/** actor id → how this user uses the product + how the change affects them. */
	affectedUsers?: Record<string, string>;
	/** story id → the rich, user-boundary flow the reader should expect. */
	scenarioFlows?: Record<string, string>;
	/** AC index (as string) → its satisfaction judgment. */
	requirementMapping?: Record<string, QaReportAcMapping>;
	/** A big-picture mermaid source, baked to inline SVG at render time. */
	bigPicture?: string;
	bigPictureCaption?: string;
}

/**
 * The subjective half of the report — never persisted to qa-state. Keyed by
 * `${story}:${cls}:${sub ?? ""}` (matching qa-chain-core's cell key shape).
 */
export interface QaReportNarrative {
	/**
	 * Legacy input kept for JSON compatibility. Acceptance criteria are only
	 * authoritative when recorded in QaView and this value is ignored.
	 */
	acceptanceCriteria?: string[];
	issues?: QaReportNarrativeIssue[];
	scenarios?: Record<string, QaReportScenarioNarrative>;
	presentation?: QaReportPresentation;
}

/** Renders one mermaid source to an SVG string. Injected so tests skip mmdc. */
export type MermaidRenderer = (source: string, index: number) => string;

function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function cellKey(cell: Pick<QaCell, "story" | "cls" | "sub">): string {
	return `${cell.story}:${cell.cls}:${cell.sub ?? ""}`;
}

function currentCycle(view: QaView): number {
	return typeof view.cycle === "number" ? view.cycle : 0;
}

function isQuietInertNaRun(view: QaView): boolean {
	if (view.inert?.declared !== true) return false;
	const cycle = currentCycle(view);
	if (view.inert.cycle !== undefined && view.inert.cycle !== cycle) return false;
	const cells = view.cells ?? [];
	const required = requiredCells(view);
	return (
		required.length > 0 &&
		required.every((requiredCell) =>
			cells.find((cell) => cell.cycle === cycle && cellKey(cell) === cellKey(requiredCell))?.status === "na",
		)
	);
}

/**
 * Rewrites a mermaid SVG's `width="100%"` root attribute to its viewBox pixel
 * width so a wide diagram renders at natural size and its figure scrolls, rather
 * than shrinking to the column and collapsing its labels to a few illegible
 * pixels. Forked from explain-diff/scripts/render.ts — technique reused, no
 * runtime dependency on that skill.
 */
export function normalizeSvgWidth(svg: string): string {
	const viewBox = svg.match(/viewBox="0 0 ([\d.]+) [\d.]+"/);
	if (!viewBox) return svg;
	const width = Math.ceil(Number(viewBox[1]));
	if (!Number.isFinite(width) || width <= 0) return svg;
	return svg.replace(/(<svg\b[^>]*?)\swidth="100%"/, `$1 width="${width}"`);
}

/**
 * Renders one mermaid source to SVG through mmdc (real mermaid inside headless
 * Chromium — the same engine the mermaid-render-gate hook uses). Forked from
 * explain-diff/scripts/render.ts. The `my-svg` id mmdc mints is de-duplicated
 * per block so two diagrams on one page do not style each other.
 */
export function mmdcRenderSvg(source: string, index: number): string {
	const dir = mkdtempSync(join(tmpdir(), "qa-report-mmd-"));
	try {
		const src = join(dir, "block.mmd");
		const out = join(dir, "block.svg");
		writeFileSync(src, source, "utf8");
		execFileSync("mmdc", ["-i", src, "-o", out, "-b", "transparent", "-q"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		return readFileSync(out, "utf8").replaceAll("my-svg", `mmd-${index}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

type RecordedCheck = QaBaseline | QaRunCheck | QaResult | null | undefined;

function recordedResult(value: RecordedCheck): QaResult | null {
	if (typeof value === "string") return value;
	return value?.result ?? value?.status ?? null;
}

function recordedNote(value: RecordedCheck): string | undefined {
	return typeof value === "string" || value === null || value === undefined ? undefined : value.note;
}

function actorFor(view: QaView, story: QaStory): { id: string; name?: string; boundary?: string; driver?: string } | undefined {
	const id = story.actor ?? story.actor_id;
	return (view.actors ?? []).find((actor) => actor.id === id);
}

function cellsForStory(view: QaView, storyId: string): QaCell[] {
	return (view.cells ?? [])
		.filter((cell) => cell.story === storyId)
		.sort((a, b) => a.cls - b.cls || (a.sub ?? "").localeCompare(b.sub ?? ""));
}

function statusBadge(status: QaCell["status"]): string {
	const label = status ?? "unrecorded";
	return `<span class="badge badge-${escapeHtml(String(label))}">${escapeHtml(String(label))}</span>`;
}

interface EvidenceRenderContext {
	embeddedBytes: number;
	renderedPaths: Set<string>;
}

function embeddedByteLength(embed: EvidenceEmbed): number {
	if (embed.kind === "image") return Buffer.byteLength(embed.dataUri, "utf8");
	if (embed.kind === "text") return Buffer.byteLength(embed.content, "utf8");
	return 0;
}

/**
 * A reader-facing evidence slot — IMAGES ONLY. A screenshot / rendered screen is
 * something a PO or designer can read directly, so it belongs in the reader view.
 * Raw TEXT evidence (a curl transcript, an HTTP/JSON dump, a build/test log) is
 * NOT rendered here: a context-free reader cannot read `HTTP=404` or
 * `{"error":{"code":"NOT_FOUND"}}` as "the requirement works". Text evidence is
 * conveyed by the natural-language scenario narrative in the reader, and its raw
 * bytes live in the audit section (`renderRawEvidence`). Non-image evidence
 * returns "" and is left unconsumed so the audit can still render it.
 */
function evidenceSlotHtml(label: string, path: string, inner: string): string {
	return (
		`<div class="evidence-slot"><div class="evidence-slot-label">${escapeHtml(label)}</div>${inner}` +
		`<div class="evidence-slot-path"><code>${escapeHtml(path)}</code></div></div>`
	);
}

function imageSlot(label: string, path: string | undefined, readEvidence: EvidenceReader, context: EvidenceRenderContext): string {
	if (!path) return "";
	// Images are NOT de-duped against `renderedPaths`: a screenshot legitimately
	// shared by two scenario cells must show on BOTH cards, so image display is
	// per-card. (Text evidence still de-dupes via renderRawEvidence; images never
	// enter the audit, so there is no reader/audit collision to guard here.)
	const embed = readEvidence(path);
	if (embed.kind === "too-large") {
		// Oversized TEXT evidence (a large curl/API transcript, not a screenshot)
		// is not a screenshot placeholder candidate — fall through to the
		// text/missing branch below so the card keeps its real-observation gap
		// instead of a false "screenshot too large" claim. `media` absent (older
		// injected test readers) behaves as before: treated as an image.
		if (embed.media === "text") return "";
		// The screenshot EXISTS but is too big to inline — show a placeholder with the
		// path so the card does not misread as "no evidence recorded" (a false gap).
		const mib = (embed.size / (1024 * 1024)).toFixed(1);
		return evidenceSlotHtml(label, path, `<p class="evidence-note">스크린샷이 너무 커서 임베드하지 않음 (${escapeHtml(mib)} MiB) — 아래 경로로 확인</p>`);
	}
	if (embed.kind !== "image") return ""; // text/missing → audit, not the reader
	const embedBytes = embeddedByteLength(embed);
	if (embedBytes > 0 && context.embeddedBytes + embedBytes > MAX_TOTAL_EMBED_BYTES) {
		// Over budget: keep the reference visible rather than dropping it into a false gap.
		return evidenceSlotHtml(label, path, `<p class="evidence-note">임베드 예산 초과 — 아래 경로로 확인</p>`);
	}
	context.embeddedBytes += embedBytes;
	return evidenceSlotHtml(label, path, `<img src="${escapeHtml(embed.dataUri)}" alt="${escapeHtml(label)} evidence">`);
}

/** A visible marker for a required presentation slot the author left unwritten. */
function gap(what: string): string {
	return `<p class="gap">${escapeHtml(what)} — presentation.md 참조</p>`;
}

/** A block of author prose, escaped; or a gap marker when it is absent. */
function proseOrGap(prose: string | undefined, whatMissing: string): string {
	return prose ? `<p>${escapeHtml(prose)}</p>` : gap(whatMissing);
}

function renderBigPicture(presentation: QaReportPresentation | undefined, renderMermaid: MermaidRenderer): string {
	const source = presentation?.bigPicture;
	if (!source) return `<h2>큰 그림</h2>${gap("큰 그림 다이어그램이 없습니다")}`;
	const caption = presentation?.bigPictureCaption;
	let figure: string;
	try {
		figure = `<figure class="diagram">${normalizeSvgWidth(renderMermaid(source, 0))}` +
			(caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "") +
			`</figure>`;
	} catch (e) {
		// Never abort the terminal report over a diagram: keep the raw source so
		// the reader still sees the intended structure, and name the failure.
		figure =
			`<p class="evidence-note">다이어그램 렌더 실패 (${escapeHtml(String(e))})</p>` +
			`<pre>${escapeHtml(source)}</pre>`;
	}
	return `<h2>큰 그림</h2>${figure}`;
}

const SATISFIED_LABEL: Record<string, string> = {
	yes: "충족",
	no: "미충족",
	partial: "부분 충족",
	unverified: "미검증 — 유저 경계 미구동",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ValidAcMapping = Omit<QaReportAcMapping, "satisfied" | "cellRefs"> & {
	satisfied: NonNullable<QaReportAcMapping["satisfied"]>;
	cellRefs: NonNullable<QaReportAcMapping["cellRefs"]>;
};

function validateAcMapping(view: QaView, value: unknown): ValidAcMapping | null {
	if (!isRecord(value)) return null;
	const mapping = value;
	const satisfied = mapping.satisfied;
	if (satisfied !== "yes" && satisfied !== "no" && satisfied !== "partial" && satisfied !== "unverified") return null;
	if (!Array.isArray(mapping.cellRefs) || mapping.cellRefs.length === 0) return null;

	const refs: NonNullable<QaReportAcMapping["cellRefs"]> = [];
	const seen = new Set<string>();
	const cells: QaCell[] = [];
	for (const value of mapping.cellRefs) {
		if (!isRecord(value)) return null;
		const ref = value;
		const story = ref.story;
		const cls = ref.cls;
		const sub = ref.sub;
		if (
			typeof story !== "string" ||
			story.trim() === "" ||
			typeof cls !== "number" ||
			!Number.isInteger(cls) ||
			cls < 1 ||
			cls > 6 ||
			(sub !== undefined && sub !== "hang-timeout" && sub !== "flaky-green") ||
			(sub === "hang-timeout" && cls !== 1) ||
			(sub === "flaky-green" && cls !== 5)
		) {
			return null;
		}
		const key = `${story}:${cls}:${sub ?? ""}`;
		if (seen.has(key)) return null;
		seen.add(key);
		const stories = (view.stories ?? []).filter((candidate) => candidate.id === story);
		if (stories.length !== 1) return null;
		const matches = (view.cells ?? []).filter(
			(cell) => cell.story === story && cell.cls === cls && cell.sub === sub && cell.cycle === view.cycle,
		);
		if (matches.length !== 1) return null;
		const cell = matches[0];
		if (cell.status !== "pass" && cell.status !== "fail" && cell.status !== "na") return null;
		if (cell.status === "na" && (typeof cell.na_reason !== "string" || cell.na_reason.trim() === "")) return null;
		refs.push({ story, cls, ...(sub !== undefined ? { sub } : {}) });
		cells.push(cell);
	}

	const statuses = cells.map((cell) => cell.status);
	const validStatus =
		(satisfied === "yes" && statuses.every((status) => status === "pass")) ||
		(satisfied === "no" && statuses.every((status) => status === "fail")) ||
		(satisfied === "partial" && !statuses.includes("na") && statuses.includes("pass") && statuses.includes("fail")) ||
		(satisfied === "unverified" && statuses.includes("na"));
	if (!validStatus) return null;

	return {
		satisfied,
		cellRefs: refs,
		...(typeof mapping.evidence === "string" ? { evidence: mapping.evidence } : {}),
	};
}

/**
 * The reader-facing head: feature overview, affected users (anchored to the
 * roster), and the big-picture diagram — the "what / why / who / picture" a
 * context-free PO reads first. Scenario flows live with their evidence in the
 * merged Scenarios section; requirement verdicts have their own section. Facts
 * (actor list) come from records; only prose and the diagram come from
 * `narrative.presentation`.
 */
function renderOverview(narrative: QaReportNarrative): string {
	return `<h2>기능 개요</h2>${proseOrGap(narrative.presentation?.overview, "기능 개요 서사가 없습니다")}`;
}

/**
 * The reader-facing actor section — ONE block per recorded actor, merging the
 * roster and the affected-user narrative (they are the SAME actors, keyed by the
 * same id, so listing them twice is the redundancy this merge removes). Shows the
 * actor's name, how this user uses the product and how the change affects them
 * (`affectedUsers` prose), and whether their boundary was reachable (a
 * verification-status signal a PO needs — an unreachable actor is unverified).
 * It deliberately omits the raw `boundary` string and `driver`: those are
 * QA-technical / implementation-flavored (URLs, tRPC procedures, service methods)
 * and live in the record-faithful Actor Roster audit table below.
 */
function renderActors(view: QaView, narrative: QaReportNarrative): string {
	const p = narrative.presentation;
	const blocks = (view.actors ?? [])
		.map((actor) => {
			const r = String(actor.reachable ?? "");
			const reach = r ? ` <span class="badge ${r === "yes" ? "badge-pass" : "badge-fail"}">도달 ${escapeHtml(r)}</span>` : "";
			return (
				`<div class="affected-user"><h3>${escapeHtml(actor.name ?? actor.id)}${reach}</h3>` +
				`${proseOrGap(p?.affectedUsers?.[actor.id], "이 유저의 사용·영향 서사가 없습니다")}</div>`
			);
		})
		.join("");
	return `<h2>액터 · 영향받는 유저</h2>` + (blocks || `<p class="evidence-note">기록된 actor 없음</p>`);
}

/**
 * Acceptance Criteria + fulfillment, MERGED into one board near the top: each
 * recorded acceptance criterion shown with its satisfaction verdict
 * (yes/no/partial/unverified) and the backing evidence prose. Criterion text is
 * authoritative from `qa-state` records; the verdict and its backing come from
 * `narrative.presentation.requirementMapping`, keyed by AC index. This is the
 * PO's at-a-glance "were the requirements met?" answer — the AC text alone (no
 * verdict) is no longer a separate section.
 */
function renderRequirementFulfillment(view: QaView, narrative: QaReportNarrative): string {
	const p = narrative.presentation;
	const acItems = view.acceptance_criteria ?? [];
	const acRows = acItems
		.map((criterion, i) => {
			const m = p?.requirementMapping?.[String(i)];
			const valid = validateAcMapping(view, m);
			const badge = valid
				? `<span class="badge satisfied-${escapeHtml(valid.satisfied)}">${escapeHtml(SATISFIED_LABEL[valid.satisfied])}</span>`
				: `<span class="badge">미판정</span>`;
			const body = valid
				? proseOrGap(valid.evidence, "충족 근거 서사가 없습니다")
				: gap(m ? "이 요구사항의 시나리오 근거 매핑을 검증할 수 없습니다" : "이 요구사항의 충족 판정이 없습니다");
			return `<div class="ac-map"><h3>${badge} ${escapeHtml(criterion)}</h3>${body}</div>`;
		})
		.join("");
	return (
		`<h2>Acceptance Criteria · 충족 현황</h2>` +
		(acRows || `<p class="evidence-note">no acceptance-criteria recorded in qa-state</p>`)
	);
}

// The six adversarial coverage axes, in plain reader language. The renderer
// shows the axis NAME, never the internal `cls` number — a PO reads "입력 경계"
// not "cls 2". Source of truth for the axes: skills/qa/scenario-authoring.md.
const CLS_LABEL: Record<number, string> = {
	1: "핵심·실패 경로",
	2: "입력 경계·악성 입력",
	3: "주입",
	4: "중단·재개",
	5: "오도된 성공 방지",
	6: "멱등성",
};

const COVERAGE_MARK: Record<string, string> = { pass: "확인", fail: "실패", na: "해당없음", unverified: "미검증" };
const NOT_RUN_LABEL = "미검증 — 유저 경계 미구동 (NOT-RUN)";

/**
 * The reader-facing scenario section. Per story (a story is the user scenario;
 * cells are QA coverage axes against it) it shows the actor's name, a short
 * "which scenarios were checked" intro (`scenarioFlows`), then ONE card per
 * scenario (cell) — each with its coverage axis, its result, its authored
 * real-software observation and/or its own screenshots — and a plain-language
 * coverage summary (axis name + result, never the `cls` number). Every verified
 * scenario card is forced to carry a reader-visible record: an observation or a
 * screenshot, else a loud gap. This is what lets a PO see, per scenario, whether
 * the software drew the UX correctly and whether every requirement was met.
 *
 * It deliberately renders NONE of the cell record's implementation-flavored
 * fields — `driven_at`, `why_needed`, `na_reason`, `attack_point`, the boundary
 * code path — because those are audit-layer facts the QA engineer writes
 * technically on purpose; surfacing them here would leak implementation into a
 * view meant for a context-free PO. The full per-cell record lives in the
 * record-faithful "시나리오 상세 기록" audit section below.
 */
function renderScenarios(view: QaView, narrative: QaReportNarrative, readEvidence: EvidenceReader, context: EvidenceRenderContext): string {
	const p = narrative.presentation;
	const quietInertNaRun = isQuietInertNaRun(view);
	const stories = (view.stories ?? [])
		.map((story) => {
			const actor = actorFor(view, story);
			const heading = `<h3>${escapeHtml(actor?.name ?? actor?.id ?? story.id)}</h3>`;
			// The intro is now a short "who + which scenarios" overview, not the whole
			// account — each scenario's own observation lives on its card below.
			const flow = `<div class="scenario-flow">${proseOrGap(p?.scenarioFlows?.[story.id], "이 액터가 어떤 시나리오들을 검증했는지에 대한 개요 서사가 없습니다")}</div>`;
			const cells = cellsForStory(view, story.id);

			// One card PER scenario (cell), each carrying its own reader-visible
			// real-software record tied to that scenario — never a merged evidence wall.
			// A verified (pass/fail) scenario MUST show an authored observation (the
			// reader form of an API/CLI transcript, whose raw bytes stay in the audit)
			// OR a screenshot; neither → a loud gap, never a silent hole. `na` is the
			// one evidence-free status. Raw text (curl/HTTP/JSON/logs) and baseline
			// build/test logs never appear here — they are audit-only.
			const cards = cells
				.map((cell) => {
					const st = String(cell.status ?? "");
					const readerStatus = st === "na" && !quietInertNaRun ? "unverified" : st;
					const axis = escapeHtml(CLS_LABEL[cell.cls] ?? `축 ${cell.cls}`) + (cell.sub ? ` · ${escapeHtml(cell.sub)}` : "");
					const head =
						`<div class="sc-head"><span class="sc-axis">${axis}</span>` +
						`<span class="cov cov-${escapeHtml(readerStatus)}">${escapeHtml(COVERAGE_MARK[readerStatus] ?? readerStatus)}</span></div>`;
					if (st === "na") {
						if (quietInertNaRun) return `<div class="scenario-card sc-na">${head}<div class="sc-body sc-muted">해당없음</div></div>`;
						return `<div class="scenario-card sc-unverified">${head}<div class="sc-body">${gap(NOT_RUN_LABEL)}</div></div>`;
					}
					const observed = narrative.scenarios?.[cellKey(cell)]?.observed;
					const observedBlock = observed ? `<p class="sc-observed">${escapeHtml(observed)}</p>` : "";
					const e = cell.evidence;
					// De-dupe evidence paths WITHIN this one card (e.g. evidence.action ===
					// evidence.path for CLI/API scenarios with no separate before/after) so
					// the same file is not rendered — and budget-counted — twice on one
					// card. Card-local only: the same screenshot shared by a DIFFERENT card
					// still renders there (imageSlot is per-card, not de-duped globally).
					const shots = e
						? [...new Set([e.before, e.action, e.after, e.path])].map((path) => imageSlot("화면", path, readEvidence, context)).filter(Boolean).join("")
						: "";
					const shotBlock = shots ? `<div class="sc-shots">${shots}</div>` : "";
					const body =
						observedBlock || shotBlock
							? observedBlock + shotBlock
							: gap("이 시나리오의 실제 소프트웨어 관찰 근거가 없습니다 — qa는 검증 시나리오에 근거를 필수로 요구합니다 (raw 로그만으로는 리더 근거가 되지 않습니다)");
					return `<div class="scenario-card sc-${escapeHtml(st)}">${head}<div class="sc-body">${body}</div></div>`;
				})
				.join("");
			const evidenceBlock = cards ? `<div class="scenarios">${cards}</div>` : "";

			// Plain coverage summary: one entry per distinct axis, its result the worst
			// across that axis's cells (fail > unverified > pass > quiet 해당없음).
			const axes = [...new Set(cells.map((cell) => cell.cls))].sort((a, b) => a - b);
			const worst = (cl: number): string => {
				const ss = cells.filter((cell) => cell.cls === cl).map((cell) => cell.status);
				const pick = ss.includes("fail")
					? "fail"
					: ss.includes("na") && !quietInertNaRun
						? "unverified"
						: ss.includes("pass")
							? "pass"
							: (ss.find((s) => s) ?? "na");
				return String(pick);
			};
			const coverage = axes.length
				? `<p class="coverage">확인한 관점: ` +
					axes
						.map((cl) => {
							const st = worst(cl);
							return `<span class="cov cov-${escapeHtml(st)}">${escapeHtml(CLS_LABEL[cl] ?? `축 ${cl}`)} ${escapeHtml(COVERAGE_MARK[st] ?? st)}</span>`;
						})
						.join(" · ") +
					`</p>`
				: "";

			return `<div class="story-block">${heading}${flow}${evidenceBlock}${coverage}</div>`;
		})
		.join("");
	return `<h2>유저 시나리오 · 근거</h2>` + (stories || `<p class="evidence-note">기록된 story 없음</p>`);
}

/**
 * The record-faithful audit of every scenario cell — the technical trail a QA
 * engineer or reviewer traces: coverage axis (`cls`), the hostile probe
 * (`attack_point`), where and with what tool it was driven (`driven_at` + the
 * evidence `surface`, i.e. the driver), the result with any na-reason /
 * expected-vs-actual / oracle diagnosis, and the recorded evidence paths. This is
 * the one place `cls` and implementation-level fields belong (including the
 * per-scenario boundary + driver — there is no separate actor-roster table); the
 * reader-facing section above stays clean of them.
 */
function renderScenarioAudit(view: QaView, narrative: QaReportNarrative, readEvidence: EvidenceReader, context: EvidenceRenderContext): string {
	const cells = (view.stories ?? []).flatMap((story) => cellsForStory(view, story.id));
	const rows = cells
		.map((cell) => {
			const n = narrative.scenarios?.[cellKey(cell)];
			const e = cell.evidence;
			const story = (view.stories ?? []).find((candidate) => candidate.id === cell.story);
			const actor = story ? actorFor(view, story) : undefined;
			const boundary = cell.driven_at ?? actor?.boundary;
			const driver = e?.surface ?? actor?.driver;
			const paths = e ? [e.path, e.before, e.action, e.after].filter((p): p is string => Boolean(p)) : [];
			const result =
				statusBadge(cell.status) +
				(cell.na_reason ? `<br><span class="audit-note">${escapeHtml(cell.na_reason)}</span>` : "") +
				(n?.expectedVsActual ? `<br><span class="audit-note">${escapeHtml(n.expectedVsActual)}</span>` : "") +
				(n?.oracleDiagnosis ? `<br><span class="audit-note">${escapeHtml(n.oracleDiagnosis)}</span>` : "");
			return (
					`<tr><td><code>${escapeHtml(cell.story)}</code></td>` +
					`<td>cls ${escapeHtml(String(cell.cls))}${cell.sub ? `/${escapeHtml(cell.sub)}` : ""} — ${escapeHtml(CLS_LABEL[cell.cls] ?? "")}</td>` +
					`<td>${escapeHtml(cell.attack_point ?? "")}${cell.why_needed ? `<br><span class="audit-note">${escapeHtml(cell.why_needed)}</span>` : ""}</td>` +
					`<td>${escapeHtml(boundary ?? "")}${driver ? `<br><span class="audit-note">${escapeHtml(driver)}</span>` : ""}</td>` +
				`<td>${result}</td>` +
				`<td>${paths.map((pth) => `<code>${escapeHtml(pth)}</code>`).join("<br>") || "—"}</td></tr>`
			);
		})
		.join("");
	const table = rows
		? `<table><thead><tr><th>story</th><th>coverage (cls)</th><th>attack point</th><th>driven at</th><th>result</th><th>evidence</th></tr></thead><tbody>${rows}</tbody></table>`
		: `<p class="evidence-note">기록된 시나리오 셀 없음</p>`;
	return `<h2>시나리오 상세 기록 (감사)</h2>${table}${renderRawEvidence(cells, readEvidence, context)}${renderBaselineAudit(view, readEvidence, context)}`;
}

/**
 * Raw text evidence (curl transcripts, HTTP/JSON dumps, terminal output),
 * embedded as collapsed `<details>` blocks at the audit layer only — self-contained
 * traceability that never intrudes on the reader view. Image evidence has already
 * been rendered in the reader, so it is skipped here (de-duped via the shared
 * context). No JS: `<details>` is native HTML.
 */
/**
 * Embeds one text evidence file as a collapsed `<details>` block (de-duped and
 * budget-capped via the shared context); returns null for a missing path, an
 * already-embedded path, a non-text (image/too-large) embed, or a budget
 * overflow. `label` prefixes the summary (e.g. a baseline story id).
 */
function embedTextEvidence(path: string | undefined, label: string, readEvidence: EvidenceReader, context: EvidenceRenderContext): string | null {
	if (!path || context.renderedPaths.has(path)) return null;
	const embed = readEvidence(path);
	if (embed.kind !== "text") return null; // images live in the reader; skip missing/too-large
	const embedBytes = embeddedByteLength(embed);
	if (embedBytes > 0 && context.embeddedBytes + embedBytes > MAX_TOTAL_EMBED_BYTES) return null;
	context.renderedPaths.add(path);
	context.embeddedBytes += embedBytes;
	return (
		`<details class="raw-evidence"><summary>${label ? `${escapeHtml(label)} — ` : ""}<code>${escapeHtml(path)}</code></summary>` +
		`<pre>${escapeHtml(embed.content)}</pre></details>`
	);
}

function renderRawEvidence(cells: QaCell[], readEvidence: EvidenceReader, context: EvidenceRenderContext): string {
	const blocks: string[] = [];
	for (const cell of cells) {
		const e = cell.evidence;
		if (!e) continue;
		for (const path of [e.before, e.action, e.after, e.path]) {
			const block = embedTextEvidence(path, "", readEvidence, context);
			if (block) blocks.push(block);
		}
	}
	return blocks.length ? `<h3>원본 관찰 로그 (감사용)</h3>${blocks.join("")}` : "";
}

/**
 * Embeds current-cycle BASELINE evidence (build/test/lint proof) into the audit
 * layer as collapsed `<details>`. It never enters the reader view — a test log is
 * not a user-boundary observation — but a recipient holding only the self-contained
 * HTML must still be able to audit the baseline, so its content is embedded here.
 */
function renderBaselineAudit(view: QaView, readEvidence: EvidenceReader, context: EvidenceRenderContext): string {
	const blocks: string[] = [];
	for (const story of view.stories ?? []) {
		const baseline = story.baseline;
		if (!baseline || baseline.cycle !== view.cycle) continue;
		const result = recordedResult(baseline);
		const note = recordedNote(baseline);
		blocks.push(
			`<p><code>${escapeHtml(story.id)} / baseline</code> — ${escapeHtml(result ?? "unrecorded")}` +
			(note ? ` — ${escapeHtml(note)}` : "") +
			`</p>`,
		);
		const e = baseline.evidence;
		if (!e) continue;
		for (const path of [e.before, e.action, e.after, e.path]) {
			const block = embedTextEvidence(path, `${story.id} / baseline`, readEvidence, context);
			if (block) blocks.push(block);
		}
	}
	return blocks.length ? `<h3>BASELINE 증빙 (build/test/lint · 감사용)</h3>${blocks.join("")}` : "";
}

function renderFailures(view: QaView, narrative: QaReportNarrative): string {
	const failedCells = (view.cells ?? []).filter((cell) => cell.status === "fail");
	const cellRows = failedCells
		.map(
			(cell) =>
				`<li><code>${escapeHtml(cell.story)}</code> — ${escapeHtml(cell.attack_point ?? "")}</li>`,
		)
		.join("");
	const baselineRows = (view.stories ?? [])
		.map((story) => {
			const baseline = story.baseline;
			if (recordedResult(baseline) !== "fail") return "";
			const note = recordedNote(baseline);
			return `<li><code>${escapeHtml(story.id)} / baseline</code> — fail${note ? ` — ${escapeHtml(note)}` : ""}</li>`;
		})
		.join("");
	const runCheckRows = ([
		["stale-state", view.run_checks?.stale_state],
		["dirty-worktree", view.run_checks?.dirty_worktree],
		["flaky-rerun", view.run_checks?.flaky_rerun],
	] as const)
		.map(([name, check]) => {
			if (recordedResult(check) !== "fail") return "";
			const note = recordedNote(check);
			return `<li><code>run-check / ${escapeHtml(name)}</code> — fail${note ? ` — ${escapeHtml(note)}` : ""}</li>`;
		})
		.join("");
	const issueRows = (narrative.issues ?? [])
		.map(
			(issue) =>
				`<li class="issue issue-${escapeHtml(issue.severity)}"><strong>[${escapeHtml(issue.severity)}]</strong> ${escapeHtml(issue.description)}` +
				(issue.location ? ` — <code>${escapeHtml(issue.location)}</code>` : "") +
				(issue.what ? `<br>${escapeHtml(issue.what)}` : "") +
				`</li>`,
		)
		.join("");
	const body =
		cellRows || baselineRows || runCheckRows || issueRows
			? `<ul>${cellRows}${baselineRows}${runCheckRows}${issueRows}</ul>`
			: `<p class="evidence-note">no failures or mismatches recorded this cycle</p>`;
	return `<h2>Failures &amp; Mismatches</h2>${body}`;
}

function renderVerdict(view: QaView): string {
	const report = view.verdict_report;
	const waives = (report?.waives ?? [])
		.map(
			(waive) =>
				`<li><code>${escapeHtml(waive.story)}/${escapeHtml(String(waive.cls))}${waive.sub ? `/${escapeHtml(waive.sub)}` : ""}</code> — ${escapeHtml(waive.reason ?? "")}</li>`,
		)
		.join("");
	const inert = report?.inert?.declared ? `<p class="evidence-note">declared inert: ${escapeHtml(report.inert.reason ?? "")}</p>` : "";
	return (
		`<h2>Verdict</h2><p class="verdict">${escapeHtml(view.verdict ?? "—")}</p>` +
		inert +
		(waives ? `<h3>Waives</h3><ul>${waives}</ul>` : "")
	);
}

function collectEvidencePaths(view: QaView): string[] {
	const paths = new Set<string>();
	for (const story of view.stories ?? []) {
		const baseline = story.baseline?.evidence;
		if (baseline?.path) paths.add(baseline.path);
	}
	for (const cell of view.cells ?? []) {
		const e = cell.evidence;
		if (!e) continue;
		for (const p of [e.path, e.before, e.action, e.after]) if (p) paths.add(p);
	}
	return [...paths];
}

function renderEvidenceFiles(view: QaView): string {
	const paths = collectEvidencePaths(view);
	const body = paths.length
		? `<ul>${paths.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join("")}</ul>`
		: `<p class="evidence-note">no evidence files recorded</p>`;
	return `<h2>Evidence Files</h2>${body}`;
}

/**
 * Renders the full report, or `null` when the cycle never reached a roster
 * (PRE-FLIGHT fail-fast) — a no-op, not an empty document.
 */
export function renderQaReport(
	view: QaView,
	narrative: QaReportNarrative = {},
	readEvidence: EvidenceReader = defaultEvidenceReader,
	renderMermaid: MermaidRenderer = mmdcRenderSvg,
): string | null {
	if ((view.actors ?? []).length === 0) return null;
	const title = `QA Report — ${view.target || view.phase}`;
	const evidenceContext: EvidenceRenderContext = { embeddedBytes: 0, renderedPaths: new Set() };
	const body = [
		`<h1>${escapeHtml(title)}</h1>`,
		`<ul class="doc-meta"><li><strong>Target</strong> ${escapeHtml(view.target)}</li>` +
			`<li><strong>Cycle</strong> ${escapeHtml(String(view.cycle))}</li>` +
			`<li><strong>Generated</strong> ${escapeHtml(view.last_touched_at)}</li></ul>`,
		// Reader-first order: what was asked (overview + AC·충족), how it flows (큰
		// 그림), who is affected (액터), what we observed per scenario (시나리오·근거) —
		// then the record-faithful audit below (per-cell detail, technical roster,
		// failures, verdict, evidence files).
		renderOverview(narrative),
		renderRequirementFulfillment(view, narrative),
		renderBigPicture(narrative.presentation, renderMermaid),
		renderActors(view, narrative),
		renderScenarios(view, narrative, readEvidence, evidenceContext),
		renderScenarioAudit(view, narrative, readEvidence, evidenceContext),
		renderFailures(view, narrative),
		renderVerdict(view),
		renderEvidenceFiles(view),
	].join("\n");
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

// One page, no external references, readable in either theme — same design
// contract as explain-diff's renderer, a fresh instance so qa carries no
// runtime dependency on that skill.
const STYLE = `
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #666; --rule: #e3e3e3;
  --code-bg: #f6f6f4; --accent: #2b5fa8;
  --pass: #2e7d4f; --fail: #b0563a; --na: #9a8a2e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181c; --fg: #e6e6e6; --muted: #9aa0a6; --rule: #2e3238;
    --code-bg: #1e2126; --accent: #7aa7e6;
    --pass: #7ec99a; --fail: #e0937a; --na: #d8c874;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 6rem; }
h1, h2, h3 { line-height: 1.3; margin: 2.25rem 0 0.75rem; }
h1 { font-size: 1.75rem; margin-top: 0; }
h2 { font-size: 1.3rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.35rem; }
h3 { font-size: 1.05rem; }
p, li { overflow-wrap: anywhere; }
code, pre { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
pre { background: var(--code-bg); padding: 0.7rem 0.85rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; white-space: pre-wrap; }
code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.94rem; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--rule); padding: 0.45rem 0.6rem; text-align: left; }
th { background: var(--code-bg); }
img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--rule); }
.doc-meta { display: flex; flex-wrap: wrap; gap: 0.4rem 1.5rem; list-style: none; margin: 0 0 1.5rem; padding: 0.8rem 1.1rem; background: var(--code-bg); border-radius: 8px; font-size: 0.9rem; color: var(--muted); }
.doc-meta strong { color: var(--fg); font-weight: 600; }
.evidence-note { color: var(--muted); font-size: 0.92rem; }
.badge { display: inline-block; padding: 0.1em 0.55em; border-radius: 999px; font-size: 0.8rem; border: 1px solid var(--rule); background: var(--code-bg); }
.badge-pass { color: var(--pass); border-color: var(--pass); }
.badge-fail { color: var(--fail); border-color: var(--fail); }
.badge-na { color: var(--na); border-color: var(--na); }
.coverage { font-size: 0.88rem; color: var(--muted); margin: 0.75rem 0 0; }
.cov { display: inline-block; margin: 0.15rem 0; }
.cov::after { content: ""; }
.cov-pass { color: var(--pass); }
.cov-fail { color: var(--fail); font-weight: 600; }
.cov-unverified { color: var(--fail); font-weight: 600; }
.cov-na { color: var(--muted); }
.audit-note { color: var(--muted); font-size: 0.85rem; }
.story-block { margin: 1.75rem 0; }
.story-block > h3 { border-bottom: 1px solid var(--rule); padding-bottom: 0.3rem; }
.scenarios { display: flex; flex-direction: column; gap: 0.85rem; margin: 0.85rem 0; }
.scenario-card { border: 1px solid var(--rule); border-left: 3px solid var(--rule); border-radius: 10px; padding: 0.75rem 0.9rem; }
.scenario-card.sc-pass { border-left-color: var(--pass); }
.scenario-card.sc-fail { border-left-color: var(--fail); }
.scenario-card.sc-unverified { border-left-color: var(--fail); }
.scenario-card.sc-na { border-left-color: var(--na); opacity: 0.75; }
.sc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.5rem; }
.sc-axis { font-weight: 600; }
.sc-body { }
.sc-observed { margin: 0 0 0.6rem; }
.sc-muted { color: var(--muted); font-size: 0.9rem; }
.sc-shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.75rem; }
.evidence-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.75rem; margin: 0.75rem 0; }
.evidence-slot { border: 1px solid var(--rule); border-radius: 8px; padding: 0.5rem; }
.evidence-slot-label { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.03em; color: var(--muted); margin-bottom: 0.35rem; }
.evidence-slot-path { font-size: 0.72rem; color: var(--muted); margin-top: 0.35rem; word-break: break-all; }
.raw-evidence { margin: 0.4rem 0; border: 1px solid var(--rule); border-radius: 6px; padding: 0.35rem 0.6rem; }
.raw-evidence summary { cursor: pointer; font-size: 0.75rem; color: var(--muted); word-break: break-all; }
.raw-evidence pre { margin-top: 0.5rem; }
.verdict { font-size: 1.2rem; font-weight: 700; }
.issue-CRITICAL { color: var(--fail); }
.issue-LOW { color: var(--na); }
.presentation { margin-bottom: 1rem; }
.gap { color: var(--fail); background: var(--code-bg); border: 1px dashed var(--fail); border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.92rem; }
.affected-user, .scenario-flow, .ac-map { margin: 1rem 0; padding: 0.85rem 1rem; border: 1px solid var(--rule); border-radius: 10px; }
.affected-user h3, .scenario-flow h3, .ac-map h3 { margin-top: 0; }
.satisfied-yes { color: var(--pass); border-color: var(--pass); }
.satisfied-no { color: var(--fail); border-color: var(--fail); }
.satisfied-partial { color: var(--na); border-color: var(--na); }
/* unverified = the user boundary was never driven; render it LOUD, never quiet — a PO must read it as "not done", not as a mild partial */
.satisfied-unverified { color: #fff; background: var(--fail); border-color: var(--fail); font-weight: 700; }
.diagram { margin: 1rem 0; overflow-x: auto; }
.diagram svg { max-width: none; height: auto; }
.diagram figcaption { color: var(--muted); font-size: 0.88rem; margin-top: 0.4rem; }
`;

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
	const argv = process.argv.slice(2);
	const get = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const session = get("session");
	if (!session) {
		process.stderr.write("Usage: qa-report.ts --session <id> [--out <path>] [--narrative <json-file>]\n");
		process.exit(1);
	}
	const out = get("out") ?? `${getOmtDir()}/evidence/qa-report-${session}.html`;
	const narrativePath = get("narrative");
	const narrative: QaReportNarrative = narrativePath ? JSON.parse(readFileSync(narrativePath, "utf8")) : {};
	const view = readQaView(session);
	if (!view) {
		process.stderr.write(`qa-report: no state found for session "${session}"\n`);
		process.exit(1);
	}
	const html = renderQaReport(view, narrative);
	if (html === null) {
		process.stdout.write("qa-report: no roster recorded this cycle — report not generated (PRE-FLIGHT fail-fast)\n");
		return;
	}
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, html, "utf8");
	process.stdout.write(`${out}\n`);
}

if (import.meta.main) {
	main();
}
