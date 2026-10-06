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
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, extname, join, resolve } from "path";
import { getOmtDir } from "@lib/omt-dir";
import { RISK_AXES, scenarioNeedsVisualProof, evidenceReviewComplete, type QaActor, type QaBaseline, type QaResult, type QaRunCheck, type QaScenario, type QaStory } from "@lib/qa-chain-core";
import { CODE_IDENTIFIER, readQaView, recordRenderedReport, stateProbe, type QaView } from "./qa-state.ts";

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
	 * screenshots beside it. Required for every verified (pass/fail) scenario that
	 * has no screenshot; its absence there renders a loud gap.
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
	/** Structured current-cycle scenario selectors; prose-only or cell-era mappings fail closed. */
	scenarioRefs?: Array<{
		story: string;
		scenario: string;
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
 * The subjective half of the report — never persisted to qa-state. Scenario
 * narratives are keyed by `${story}:${scenario id}`.
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

export function scenarioKey(scenario: { story: string; id: string }): string {
	return `${scenario.story}:${scenario.id}`;
}

function currentCycle(view: QaView): number {
	return typeof view.cycle === "number" ? view.cycle : 0;
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

function actorFor(view: QaView, story: QaStory): QaActor | undefined {
	const id = story.actor ?? story.actor_id;
	return (view.actors ?? []).find((actor) => actor.id === id);
}

function scenariosForStory(view: QaView, storyId: string): QaScenario[] {
	return (view.scenarios ?? []).filter((scenario) => scenario.story === storyId);
}

const STATUS_LABEL: Record<string, string> = { pass: "통과", fail: "실패", blocked: "검증 불가", unverified: "근거 미검증", unrecorded: "미실행" };

function statusBadge(status: QaScenario["status"]): string {
	const label = status ?? "unrecorded";
	return `<span class="badge badge-${escapeHtml(String(label))}">${escapeHtml(STATUS_LABEL[label] ?? String(label))}</span>`;
}

interface EvidenceRenderContext {
	strictVisualEvidence?: boolean;
	embeddedBytes: number;
	renderedPaths: Set<string>;
}

function embeddedByteLength(embed: EvidenceEmbed): number {
	if (embed.kind === "image") return Buffer.byteLength(embed.dataUri, "utf8");
	if (embed.kind === "text") return Buffer.byteLength(embed.content, "utf8");
	return 0;
}

function hasValidImageSignature(dataUri: string): boolean {
	const match = /^data:image\/(png|jpeg|webp|gif);base64,(.*)$/.exec(dataUri);
	if (!match) return false;
	const bytes = Buffer.from(match[2], "base64");
	if (bytes.length < 24) return false;
	return (
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
		(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
		/^GIF8[79]a/.test(bytes.toString("ascii", 0, 6)) ||
		(bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
	);
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
	// shared by two scenarios must show on BOTH cards, so image display is
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
		if (context.strictVisualEvidence) throw new Error(`visual evidence cannot be embedded: ${path}; reduce the capture size and render again`);
		// The screenshot EXISTS but is too big to inline — show a placeholder with the
		// path so the card does not misread as "no evidence recorded" (a false gap).
		const mib = (embed.size / (1024 * 1024)).toFixed(1);
		return evidenceSlotHtml(label, path, `<p class="evidence-note">스크린샷이 너무 커서 임베드하지 않음 (${escapeHtml(mib)} MiB) — 아래 경로로 확인</p>`);
	}
	if (embed.kind !== "image") return ""; // text/missing → audit, not the reader
	const embedBytes = embeddedByteLength(embed);
	if (embedBytes > 0 && context.embeddedBytes + embedBytes > MAX_TOTAL_EMBED_BYTES) {
		if (context.strictVisualEvidence) throw new Error("visual evidence exceeds the total embed budget; optimize captures and render again");
		// Over budget: keep the reference visible rather than dropping it into a false gap.
		return evidenceSlotHtml(label, path, `<p class="evidence-note">임베드 예산 초과 — 아래 경로로 확인</p>`);
	}
	context.embeddedBytes += embedBytes;
	return evidenceSlotHtml(label, path, `<details class="image-view"><summary>원본 크기로 확대</summary></details><div class="image-frame" tabindex="0" role="group" aria-label="${escapeHtml(label)}"><img src="${escapeHtml(embed.dataUri)}" alt="${escapeHtml(label)} evidence"></div>`);
}

/** A visible marker for a required presentation slot the author left unwritten. */
function gap(what: string): string {
	return `<p class="gap">${escapeHtml(what)}</p>`;
}

/** A block of author prose, escaped; or a gap marker when it is absent. */
function proseOrGap(prose: string | undefined, whatMissing: string): string {
	return prose?.trim() ? `<p>${escapeHtml(prose)}</p>` : gap(whatMissing);
}

function renderBigPicture(
	presentation: QaReportPresentation | undefined,
	renderMermaid: MermaidRenderer,
	onMermaidRenderError?: (error: unknown) => void,
): string {
	const source = presentation?.bigPicture;
	if (!source) return `<h2>큰 그림</h2>${gap("큰 그림 다이어그램이 없습니다")}`;
	const caption = presentation?.bigPictureCaption;
	let figure: string;
	try {
		figure = `<figure class="diagram">${normalizeSvgWidth(renderMermaid(source, 0))}` +
			(caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "") +
			`</figure>`;
	} catch (e) {
			onMermaidRenderError?.(e);
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
	unverified: "미검증 — 검증 불가 시나리오에 걸림",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ValidAcMapping = Omit<QaReportAcMapping, "satisfied" | "scenarioRefs"> & {
	satisfied: NonNullable<QaReportAcMapping["satisfied"]>;
	scenarioRefs: NonNullable<QaReportAcMapping["scenarioRefs"]>;
};

function validateAcMapping(view: QaView, value: unknown): ValidAcMapping | null {
	if (!isRecord(value)) return null;
	const satisfied = value.satisfied;
	if (satisfied !== "yes" && satisfied !== "no" && satisfied !== "partial" && satisfied !== "unverified") return null;
	if (!Array.isArray(value.scenarioRefs) || value.scenarioRefs.length === 0) return null;
	const refs: NonNullable<QaReportAcMapping["scenarioRefs"]> = [];
	const seen = new Set<string>();
	const statuses: string[] = [];
	for (const ref of value.scenarioRefs) {
		if (!isRecord(ref) || typeof ref.story !== "string" || ref.story.trim() === "" || typeof ref.scenario !== "string" || ref.scenario.trim() === "") return null;
		const key = scenarioKey({ story: ref.story, id: ref.scenario });
		if (seen.has(key)) return null;
		seen.add(key);
		const matches = (view.scenarios ?? []).filter((scenario) => scenario.story === ref.story && scenario.id === ref.scenario && scenario.cycle === view.cycle);
		if (matches.length !== 1) return null;
		const status = matches[0].status;
		if (status !== "pass" && status !== "fail" && status !== "blocked") return null;
		refs.push({ story: ref.story, scenario: ref.scenario });
		statuses.push(status);
	}
	const validStatus =
		(satisfied === "yes" && statuses.every((status) => status === "pass")) ||
		(satisfied === "no" && statuses.every((status) => status === "fail")) ||
		(satisfied === "partial" && !statuses.includes("blocked") && statuses.includes("pass") && statuses.includes("fail")) ||
		(satisfied === "unverified" && statuses.includes("blocked"));
	if (!validStatus) return null;
	return { satisfied, scenarioRefs: refs, ...(typeof value.evidence === "string" ? { evidence: value.evidence } : {}) };
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
const CLIENT_IMPACT_LABEL: Record<string, string> = {
	none: "클라이언트 영향 없음 — 이 변경을 읽어 화면에 그리는 클라이언트가 없음",
	contract: "클라이언트가 받는 값이 바뀜 — 클라이언트 화면 코드는 그대로",
	render: "클라이언트 화면이 바뀜 — 기기 프로필마다 화면으로 확인",
};

function profileLabel(view: QaView, id: string): string {
	const profile = (view.device_profiles ?? []).find((candidate) => candidate.id === id);
	return profile ? `${profile.label} (${profile.width}×${profile.height})` : id;
}

function renderActors(view: QaView, narrative: QaReportNarrative): string {
	const p = narrative.presentation;
	const blocks = (view.actors ?? [])
		.map((actor) => {
			const r = String(actor.reachable ?? "");
			const reach = r === "yes" ? ` <span class="badge badge-pass">도달함</span>` : r ? ` <span class="badge badge-fail">도달 막힘: ${escapeHtml(r)}</span>` : "";
			const impact = actor.client_impact
				? `<p class="client-impact"><strong>${escapeHtml(CLIENT_IMPACT_LABEL[actor.client_impact] ?? actor.client_impact)}</strong>${actor.client_impact_reason ? ` · ${escapeHtml(actor.client_impact_reason)}` : ""}</p>`
				: gap("이 유저의 클라이언트 영향 판단이 기록되지 않았습니다");
			const profiles = actor.profiles?.length ? `<p class="evidence-note">확인할 기기: ${actor.profiles.map((id) => escapeHtml(profileLabel(view, id))).join(" · ")}</p>` : "";
			return (
				`<div class="affected-user"><h3>${escapeHtml(actor.name ?? actor.id)}${reach}</h3>` +
				`${proseOrGap(p?.affectedUsers?.[actor.id], "이 유저의 사용·영향 서사가 없습니다")}${impact}${profiles}</div>`
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
function renderRequirementFulfillment(view: QaView, narrative: QaReportNarrative, unverified: Set<string>): string {
	const p = narrative.presentation;
	const acItems = view.acceptance_criteria ?? [];
	const acRows = acItems
		.map((criterion, i) => {
			const m = p?.requirementMapping?.[String(i)];
			const valid = validateAcMapping(view, m);
			if (valid?.scenarioRefs.some((ref) => unverified.has(scenarioKey({ story: ref.story, id: ref.scenario })))) return `<div class="ac-map"><h3><span class="badge satisfied-unverified">미검증</span> ${escapeHtml(criterion)}</h3>${gap("근거 미검증 — 연결된 시나리오의 주장 검토가 없거나 부족하거나 오래되었습니다")}</div>`;
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
		`<h2>요구사항(AC) 충족 현황</h2>` +
		(acRows || `<p class="evidence-note">기록된 요구사항이 없습니다</p>`)
	);
}

// The six adversarial axes, in plain reader language. Source of truth for the
// axes: skills/qa/scenario-authoring.md. The reader sees the name, never a number.
const RISK_LABEL: Record<number, string> = {
	1: "실패 경로",
	2: "입력 경계·잘못된 입력",
	3: "주입",
	4: "중단·동시 실행",
	5: "가짜 성공 방지",
	6: "중복 실행",
};

function riskTags(scenario: QaScenario): string {
	const risks = scenario.risks ?? [];
	return risks.length
		? `<p class="sc-risks">다룬 위험: ${risks.map((axis) => escapeHtml(RISK_LABEL[axis] ?? String(axis))).join(" · ")}</p>`
		: `<p class="sc-risks">정상 흐름</p>`;
}

/** One reader card for one user scenario: what the user did, what they should see, what QA saw. */
function renderScenarioCard(view: QaView, scenario: QaScenario, actor: QaActor | undefined, narrative: QaReportNarrative, readEvidence: EvidenceReader, context: EvidenceRenderContext, unverified: Set<string>): string {
	const key = scenarioKey(scenario);
	const evidenceGap = unverified.has(key);
	const status = evidenceGap ? "unverified" : String(scenario.status ?? "unrecorded");
	const profile = scenario.profile ? `<span class="sc-profile">${escapeHtml(profileLabel(view, scenario.profile))}</span>` : "";
	const head =
		`<div class="sc-head"><span class="sc-title">${escapeHtml(scenario.title ?? scenario.id)}</span>` +
		`<span class="sc-meta">${profile}<span class="cov cov-${escapeHtml(status)}">${escapeHtml(STATUS_LABEL[status] ?? status)}</span></span></div>`;
	const plan =
		`<p class="sc-expected"><strong>기대 결과</strong> ${escapeHtml(scenario.expected ?? "")}</p>` +
		`<details class="sc-steps"><summary>전제와 단계</summary><p>${escapeHtml(scenario.preconditions ?? "")}</p>` +
		`<ol>${(scenario.steps ?? []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></details>` +
		riskTags(scenario);
	const observed = narrative.scenarios?.[key]?.observed;
	if (scenario.status === "blocked") {
		return `<div class="scenario-card sc-blocked">${head}<div class="sc-body">${plan}<p class="gap">${escapeHtml(`검증 불가 — ${scenario.blocked?.obstacle ?? ""}`)}</p>` +
			`<p class="sc-observed">확인한 가장 깊은 지점: ${escapeHtml(scenario.blocked?.deepest_reachable ?? "")}</p>` +
			(observed?.trim() ? `<p class="sc-observed">${escapeHtml(observed)}</p>` : "") +
			`</div></div>`;
	}
	if (scenario.status !== "pass" && scenario.status !== "fail") {
		return `<div class="scenario-card sc-unrecorded">${head}<div class="sc-body">${plan}${gap("아직 실행 결과가 기록되지 않은 시나리오입니다")}</div></div>`;
	}
	const observedBlock = observed?.trim() ? `<p class="sc-observed">${evidenceGap ? "검토 전 실행자 서술: " : ""}${escapeHtml(observed)}</p>` : "";
	const e = scenario.evidence;
	// De-dupe evidence paths WITHIN this one card so the same file is not
	// rendered — and budget-counted — twice. A screenshot shared by a DIFFERENT
	// card still renders there (imageSlot is per-card, not de-duped globally).
	const claims = scenarioNeedsVisualProof(scenario, actor?.driver) ? scenario.evidence_review?.claims : undefined;
	const beforeBlock = imageSlot("행동 전 화면", e?.before, readEvidence, context);
	const primaryPaths = new Set([e?.before, e?.action, e?.after, e?.path]);
	const claimImage = (path: string, label: string): string => {
		if (primaryPaths.has(path)) return "";
		primaryPaths.add(path);
		return imageSlot(label, path, readEvidence, context);
	};
	const claimBlocks = Array.isArray(claims) ? claims.map((claim) => `<div class="evidence-slot"><p><strong>${escapeHtml(claim.claim)}</strong> · ${escapeHtml(claim.verdict === "supported" && !evidenceGap ? "입증" : "근거 미검증")}</p><p>${escapeHtml(claim.observation)}</p>${claim.gap ? gap(claim.gap) : ""}${(claim.sources ?? []).map((source) => `<p>${escapeHtml(source.location)}</p>${claimImage(source.path, `${claim.claim} — ${source.location}`)}`).join("")}</div>`).join("") : "";
	const shots = e
		? [...new Set([e.action, e.after, e.path])].filter((path) => path !== e.before).map((path) => imageSlot(path === e.after ? "행동 후 화면" : "행동 기록", path, readEvidence, context)).filter(Boolean).join("")
		: "";
	const shotBlock = (shots ? `<div class="sc-shots">${shots}</div>` : "") + claimBlocks;
	const body =
		beforeBlock || observedBlock || shotBlock
			? beforeBlock + observedBlock + shotBlock
			: gap("이 시나리오의 실제 소프트웨어 관찰 근거가 없습니다 — qa는 검증 시나리오에 근거를 필수로 요구합니다 (raw 로그만으로는 리더 근거가 되지 않습니다)");
	return `<div class="scenario-card sc-${escapeHtml(status)}">${head}<div class="sc-body">${plan}${evidenceGap ? gap("근거 미검증 — 제품 실패나 미실행을 뜻하지 않습니다. 주장별 근거를 보완하고 다시 검토해야 합니다.") : ""}${body}</div></div>`;
}

/** For a story whose screen changed: one line per device profile with the worst scenario result on it. */
function renderProfileCoverage(view: QaView, actor: QaActor | undefined, scenarios: QaScenario[], unverified: Set<string>): string {
	if (actor?.client_impact !== "render" || !actor.profiles?.length) return "";
	const rank = ["fail", "unverified", "blocked", "unrecorded", "pass"];
	const items = actor.profiles.map((id) => {
		const statuses = scenarios.filter((scenario) => scenario.profile === id).map((scenario) => (unverified.has(scenarioKey(scenario)) ? "unverified" : String(scenario.status ?? "unrecorded")));
		const worst = rank.find((status) => statuses.includes(status)) ?? "unrecorded";
		return `<li><span class="cov cov-${escapeHtml(worst)}">${escapeHtml(profileLabel(view, id))} — ${escapeHtml(STATUS_LABEL[worst] ?? worst)}</span></li>`;
	});
	return `<div class="profile-coverage"><p><strong>기기별 확인</strong></p><ul>${items.join("")}</ul></div>`;
}

/** Adversarial axes nobody can exercise in this change, folded so they never read as unfinished work. */
function renderRiskNotApplicable(view: QaView): string {
	const entries = (view.risk_not_applicable ?? []).filter((entry) => entry.cycle === currentCycle(view)).sort((a, b) => a.axis - b.axis);
	const covered = RISK_AXES.filter((axis) => (view.scenarios ?? []).some((scenario) => (scenario.risks ?? []).includes(axis)));
	const coveredLine = covered.length ? `<p class="coverage">시나리오가 다룬 위험: ${covered.map((axis) => escapeHtml(RISK_LABEL[axis])).join(" · ")}</p>` : "";
	if (!entries.length) return coveredLine;
	return coveredLine + `<details class="risk-na"><summary>이 변경에 해당하지 않는 위험 ${entries.length}가지 — 펼쳐 보기</summary><ul>` +
		entries.map((entry) => `<li><strong>${escapeHtml(RISK_LABEL[entry.axis] ?? String(entry.axis))}</strong> — ${escapeHtml(entry.reason)}</li>`).join("") +
		`</ul></details>`;
}

/**
 * The reader-facing scenario section. Per story it shows the actor, the story's
 * goal, a short overview (`scenarioFlows`), then ONE card per user scenario —
 * title, expected outcome, the authored real-software observation and/or its own
 * screenshots, and the risks it exercises. Implementation-flavored fields
 * (`driven_at`, `why_needed`, the boundary code path) stay in the audit below.
 */
function renderScenarios(view: QaView, narrative: QaReportNarrative, readEvidence: EvidenceReader, context: EvidenceRenderContext, unverified: Set<string>): string {
	const p = narrative.presentation;
	const stories = (view.stories ?? [])
		.map((story) => {
			const actor = actorFor(view, story);
			const heading = `<h3>${escapeHtml(actor?.name ?? actor?.id ?? story.id)}</h3>`;
			const goal = story.contract?.goal ? `<p class="story-goal"><strong>목표</strong> ${escapeHtml(story.contract.goal)}</p>` : "";
			const flow = `<div class="scenario-flow">${proseOrGap(p?.scenarioFlows?.[story.id], "이 스토리에서 어떤 시나리오들을 검증했는지에 대한 개요 서사가 없습니다")}</div>`;
			const scenarios = scenariosForStory(view, story.id);
			const cards = scenarios.map((scenario) => renderScenarioCard(view, scenario, actor, narrative, readEvidence, context, unverified)).join("");
			return `<div class="story-block">${heading}${goal}${flow}${cards ? `<div class="scenarios">${cards}</div>` : ""}${renderProfileCoverage(view, actor, scenarios, unverified)}</div>`;
		})
		.join("");
	const inert = view.inert?.declared && (view.inert.cycle === undefined || view.inert.cycle === currentCycle(view))
		? `<p class="evidence-note">동작이 바뀌지 않는 변경으로 선언됨: ${escapeHtml(view.inert.reason ?? "")}</p>`
		: "";
	return `<h2>유저 시나리오 · 근거</h2>` + inert + (stories || `<p class="evidence-note">기록된 story 없음</p>`) + renderRiskNotApplicable(view);
}

/**
 * The record-faithful audit of every scenario — the technical trail a QA
 * engineer or reviewer traces: the risks it exercises, why it exists, where and
 * with what tool it was driven (`driven_at` + evidence surface), the result with
 * blocked detail / expected-vs-actual / oracle diagnosis, and evidence paths.
 */
function renderScenarioAudit(view: QaView, narrative: QaReportNarrative, readEvidence: EvidenceReader, context: EvidenceRenderContext): string {
	const scenarios = (view.stories ?? []).flatMap((story) => scenariosForStory(view, story.id));
	const storyAnchors = new Set<string>();
	const rows = scenarios
		.map((scenario) => {
			const n = narrative.scenarios?.[scenarioKey(scenario)];
			const e = scenario.evidence;
			const story = (view.stories ?? []).find((candidate) => candidate.id === scenario.story);
			const actor = story ? actorFor(view, story) : undefined;
			const boundary = scenario.driven_at ?? actor?.boundary;
			const driver = e?.surface ?? actor?.driver;
			const paths = e ? [...new Set([e.before, e.action, e.after, e.path].filter((p): p is string => Boolean(p)))] : [];
			const result =
				statusBadge(scenario.status) +
				(scenario.blocked
					? `<br><span class="audit-note">obstacle: ${escapeHtml(scenario.blocked.obstacle)}</span>` +
						`<br><span class="audit-note">attempts: ${scenario.blocked.attempts.map((attempt) => escapeHtml(attempt)).join(" / ")}</span>` +
						`<br><span class="audit-note">deepest reachable: ${escapeHtml(scenario.blocked.deepest_reachable)}</span>` +
						`<br><span class="audit-note">attempt log: <code>${escapeHtml(scenario.blocked.attempt_log)}</code></span>`
					: "") +
				(n?.expectedVsActual ? `<br><span class="audit-note">${escapeHtml(n.expectedVsActual)}</span>` : "") +
				(n?.oracleDiagnosis ? `<br><span class="audit-note">${escapeHtml(n.oracleDiagnosis)}</span>` : "");
			const storyAnchor = storyAnchors.has(scenario.story) ? "" : ` id="audit-story-${escapeHtml(scenario.story)}"`;
			storyAnchors.add(scenario.story);
			const risks = (scenario.risks ?? []).map((axis) => `${axis} ${RISK_LABEL[axis] ?? ""}`).join(", ") || "정상 흐름";
			return (
				`<tr${storyAnchor}><td class="audit-story"><code>${escapeHtml(scenario.story)}</code><br><code>${escapeHtml(scenario.id)}</code>${scenario.profile ? `<br><span class="audit-note">${escapeHtml(scenario.profile)}</span>` : ""}</td>` +
				`<td class="audit-coverage">${escapeHtml(scenario.priority ?? "")} · ${escapeHtml(risks)}</td>` +
				`<td>${escapeHtml(scenario.title ?? "")}${scenario.why_needed ? `<br><span class="audit-note">${escapeHtml(scenario.why_needed)}</span>` : ""}</td>` +
				`<td class="audit-boundary">${escapeHtml(boundary ?? "")}${driver ? `<br><span class="audit-note">${escapeHtml(driver)}</span>` : ""}</td>` +
				// Evidence paths sit under the result: a sixth column would overflow the reading width and hide behind an invisible scrollbar.
				`<td>${result}${paths.length ? `<span class="audit-evidence">${paths.map((pth) => `<code>${escapeHtml(pth)}</code>`).join("")}</span>` : ""}</td></tr>`
			);
		})
		.join("");
	const table = rows
		? `<table tabindex="0"><thead><tr><th class="audit-story">story / scenario</th><th class="audit-coverage">priority · risks</th><th>scenario · why needed</th><th class="audit-boundary">driven at</th><th>result · evidence</th></tr></thead><tbody>${rows}</tbody></table>`
		: `<p class="evidence-note">기록된 시나리오 없음</p>`;
	return `<h2>시나리오 상세 기록 (감사)</h2>${table}${renderStoryProvenance(view, storyAnchors)}${renderRawEvidence(scenarios, readEvidence, context)}${renderBaselineAudit(view, readEvidence, context)}`;
}

/**
 * Renders recorded story-to-code context without presenting it as execution
 * evidence. A provenance record is current-cycle context only when its cycle
 * matches the report cycle; stale records and history remain visibly labelled
 * as previous-cycle context and never receive a result/pass treatment.
 */
function renderStoryProvenance(view: QaView, storyAnchors: Set<string>): string {
	const cycle = currentCycle(view);
	const records = (view.stories ?? []).map((story) => {
		const current = story.provenance?.cycle === cycle ? story.provenance : undefined;
		const previous = [
			...(story.provenance && story.provenance.cycle !== cycle ? [story.provenance] : []),
			...(story.provenance_history ?? []),
		];
		const storyLink = storyAnchors.has(story.id)
			? ` <a class="audit-story-link" href="#audit-story-${escapeHtml(story.id)}" aria-label="story ${escapeHtml(story.id)} 기존 기록으로 이동">기존 기록으로 이동</a>`
			: "";
		const renderRecord = (record: NonNullable<typeof story.provenance>, label: string): string => {
			const features = record.features.length
				? `<ul>${record.features.map((feature) => `<li><code>${escapeHtml(feature.id)}</code> · revision <code>${escapeHtml(feature.revision)}</code> · planned entrypoints: ${escapeHtml(feature.entrypoints.join(", ") || "—")} · planned states: ${escapeHtml(feature.states.join(", ") || "—")}</li>`).join("")}</ul>`
				: `<p class="evidence-note">기록된 feature 없음</p>`;
			return `<details class="raw-evidence"><summary>${escapeHtml(label)} · cycle ${escapeHtml(String(record.cycle))}</summary><p><strong>code_ref</strong>: <code>${escapeHtml(record.code_ref)}</code></p>${features}</details>`;
		};
		const body = current
			? renderRecord(current, "현재")
			: `<p class="evidence-note">provenance 기록 없음 — 현재 cycle ${escapeHtml(String(cycle))}과 일치하는 기록이 없습니다</p>`;
		const history = previous.map((record) => renderRecord(record, "이전 기록")).join("");
		return `<div class="provenance-record"><p><strong>story <code>${escapeHtml(story.id)}</code></strong>${storyLink}</p>${body}${history}</div>`;
	}).join("");
	return `<h3>Story provenance (감사 맥락)</h3><p class="evidence-note">provenance는 실행 증거가 아닌 계획 맥락입니다. 진입 경로·상태는 이번 QA의 계획 항목이며 지도에 등록된 항목임을 뜻하지 않습니다.</p>${records || `<p class="evidence-note">기록된 story 없음</p>`}`;
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
 * budget-capped via the shared context). Missing and unembeddable text evidence
 * stays in the audit as an explicit placeholder rather than disappearing.
 * `label` prefixes the summary (e.g. a baseline story id).
 */
function embedTextEvidence(path: string | undefined, label: string, readEvidence: EvidenceReader, context: EvidenceRenderContext, requiredClaim = false): string | null {
	if (!path || context.renderedPaths.has(path)) return null;
	const embed = readEvidence(path);
	const summary = `${label ? `${escapeHtml(label)} — ` : ""}<code>${escapeHtml(path)}</code>`;
	if (embed.kind === "missing") {
		context.renderedPaths.add(path);
		return `<details class="raw-evidence raw-evidence-placeholder"><summary>${summary}</summary>` +
			`<p class="evidence-note">읽을 수 없음 — 원문 미포함</p></details>`;
	}
	if (embed.kind === "too-large") {
		// An absent media tag is an older injected reader's oversized image result;
		// images remain reader-facing and are not duplicated in the audit.
		if (embed.media !== "text") return null;
		context.renderedPaths.add(path);
		return `<details class="raw-evidence raw-evidence-placeholder"><summary>${summary}</summary>` +
			`<p class="evidence-note">텍스트 증거가 개별 제한 2 MiB를 초과함 (실제 크기: ${escapeHtml(String(embed.size))} bytes) — 원문 미포함</p></details>`;
	}
	if (embed.kind !== "text") return null; // images live in the reader
	const embedBytes = embeddedByteLength(embed);
	if (embedBytes > 0 && context.embeddedBytes + embedBytes > MAX_TOTAL_EMBED_BYTES) {
		if (requiredClaim && context.strictVisualEvidence) throw new Error(`claim evidence exceeds total embed budget: ${path}; record a bounded source and review again`);
		context.renderedPaths.add(path);
		return `<details class="raw-evidence raw-evidence-placeholder"><summary>${summary}</summary>` +
			`<p class="evidence-note">누적 텍스트 임베드 예산 초과 — 원문 미포함</p></details>`;
	}
	context.renderedPaths.add(path);
	context.embeddedBytes += embedBytes;
	return (
		`<details class="raw-evidence"><summary>${summary}</summary>` +
		`<pre>${escapeHtml(embed.content)}</pre></details>`
	);
}

function renderRawEvidence(scenarios: QaScenario[], readEvidence: EvidenceReader, context: EvidenceRenderContext): string {
	const blocks: string[] = [];
	const requiredPaths = new Set(scenarios.flatMap((scenario) => scenario.evidence_review?.claims.flatMap((claim) => claim.sources.map((source) => source.path)) ?? []));
	for (const scenario of scenarios) {
		const e = scenario.evidence;
		if (!e) continue;
		for (const path of [e.before, e.action, e.after, e.path, ...(scenario.evidence_review?.claims.flatMap((claim) => claim.sources.map((source) => source.path)) ?? [])]) {
			const block = embedTextEvidence(path, "", readEvidence, context, path !== undefined && requiredPaths.has(path));
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
	const cellRows = (view.scenarios ?? [])
		.filter((scenario) => scenario.status === "fail")
		.map((scenario) => `<li><code>${escapeHtml(scenario.story)}/${escapeHtml(scenario.id)}</code> — ${escapeHtml(scenario.title ?? "")}</li>`)
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
			: `<p class="evidence-note">이번 사이클에 기록된 실패나 불일치가 없습니다</p>`;
	return `<h2>실패 · 불일치</h2>${body}`;
}

// A verdict that passed with scenarios nobody could execute reads differently,
// so the reader sees blocked scenarios before any finding.
function renderBlockedBanner(view: QaView): string {
	const blocked = (view.scenarios ?? []).filter((scenario) => scenario.cycle === currentCycle(view) && scenario.status === "blocked");
	if (!blocked.length) return "";
	return `<p class="gap waive-banner">검증 불가 시나리오 ${blocked.length}건 — 변경 밖의 한계로 실행하지 못했습니다. 판정은 이 시나리오들을 검증하지 않은 채 내려졌습니다: ${blocked.map((scenario) => escapeHtml(scenario.title ?? scenario.id)).join(" · ")}</p>`;
}

const VERDICT_LABEL: Record<string, string> = { APPROVE: "승인 (APPROVE)", COMMENT: "의견과 함께 승인 (COMMENT)", REQUEST_CHANGES: "수정 요청 (REQUEST_CHANGES)" };

/** The one-line answer a PO reads first: the verdict and what it rests on. */
function renderVerdictSummary(view: QaView, unverified: Set<string>): string {
	const scenarios = view.scenarios ?? [];
	const count = (status: string) => scenarios.filter((scenario) => (unverified.has(scenarioKey(scenario)) ? "unverified" : String(scenario.status ?? "unrecorded")) === status).length;
	const parts = [["pass", "통과"], ["fail", "실패"], ["blocked", "검증 불가"], ["unverified", "근거 미검증"], ["unrecorded", "미실행"]]
		.map(([status, label]) => [label, count(status)] as const)
		.filter(([, n]) => n > 0)
		.map(([label, n]) => `${label} ${n}`);
	const verdict = unverified.size ? "판정 보류 — 근거 미검증 시나리오가 있음" : VERDICT_LABEL[view.verdict ?? ""] ?? "판정 전";
	return `<p class="verdict-summary"><strong>${escapeHtml(verdict)}</strong> · 유저 시나리오 ${scenarios.length}개${parts.length ? ` (${escapeHtml(parts.join(" · "))})` : ""}</p>`;
}

function renderVerdict(view: QaView): string {
	const report = view.verdict_report;
	const inert = report?.inert?.declared ? `<p class="evidence-note">declared inert: ${escapeHtml(report.inert.reason ?? "")}</p>` : "";
	return `<h2>판정</h2><p class="verdict">${escapeHtml(view.verdict ?? "—")}</p>` + inert;
}

function collectEvidencePaths(view: QaView): string[] {
	const paths = new Set<string>();
	for (const story of view.stories ?? []) {
		const baseline = story.baseline?.evidence;
		if (baseline?.path) paths.add(baseline.path);
	}
	for (const scenario of view.scenarios ?? []) {
		const e = scenario.evidence;
		if (!e) continue;
		for (const p of [e.path, e.before, e.action, e.after, ...(scenario.evidence_review?.claims.flatMap((claim) => claim.sources.map((source) => source.path)) ?? [])]) if (p) paths.add(p);
	}
	return [...paths];
}

function renderEvidenceFiles(view: QaView): string {
	const paths = collectEvidencePaths(view);
	const body = paths.length
		? `<ul>${paths.map((p) => `<li><code>${escapeHtml(p)}</code></li>`).join("")}</ul>`
		: `<p class="evidence-note">기록된 증거 파일이 없습니다</p>`;
	return `<h2>증거 파일</h2>${body}`;
}

/**
 * English words in the reader-facing prose, for the author and the presentation
 * reviewer to check. Device and product names are fine; a CSS property, setting
 * value or code word ("overflow", "fixed", "fetch") is not. Advisory only: the
 * identifier shapes are already refused.
 */
export function readerEnglishWords(view: QaView, narrative: QaReportNarrative): string[] {
	const p = narrative.presentation;
	const texts = [
		p?.overview,
		...Object.values(p?.requirementMapping ?? {}).map((entry) => entry.evidence),
		...Object.values(p?.affectedUsers ?? {}),
		...Object.values(p?.scenarioFlows ?? {}),
		...Object.values(narrative.scenarios ?? {}).map((entry) => entry.observed),
		...(view.scenarios ?? []).flatMap((scenario) => [
			scenario.title,
			scenario.expected,
			...(scenario.evidence_review?.claims ?? []).flatMap((claim) => [claim.claim, claim.observation]),
		]),
	];
	const words = new Set<string>();
	for (const text of texts) for (const word of text?.match(/[A-Za-z][A-Za-z-]*[A-Za-z]/g) ?? []) words.add(word);
	return [...words].sort();
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
	onMermaidRenderError?: (error: unknown) => void,
	strictVisualEvidence = false,
): string | null {
	if ((view.actors ?? []).length === 0) return null;
	const unverified = new Set<string>();
	const probe = readEvidence === defaultEvidenceReader ? stateProbe : (path: string) => {
		const embed = readEvidence(path);
		const bytes = embed.kind === "image" ? Buffer.from(embed.dataUri.split(",")[1] ?? "", "base64") : embed.kind === "text" ? Buffer.from(embed.content) : Buffer.alloc(0);
		return { exists: bytes.length > 0, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
	};
	for (const story of view.stories ?? []) {
		const actor = actorFor(view, story);
		for (const scenario of scenariosForStory(view, story.id)) {
			if (!scenarioNeedsVisualProof(scenario, actor?.driver)) continue;
			if ((scenario.status === "pass" || scenario.status === "fail") && !evidenceReviewComplete(scenario, probe)) unverified.add(scenarioKey(scenario));
		}
	}
	if (strictVisualEvidence) {
		// The summary line, banner and AC board render the QA result; the overview describes the change itself.
		const overviewResult = narrative.presentation?.overview?.match(/APPROVE|COMMENT|REQUEST_CHANGES|QA|판정|검증 불가|미검증|신뢰도/);
		if (overviewResult) throw new Error(`기능 개요 (presentation.overview) must describe the change, not the QA result ("${overviewResult[0]}"); the summary line, banner and AC board already show it`);
		// Reader prose names what the user sees; file and code names belong to the audit section.
		const p = narrative.presentation;
		const readerProse: [string, string | undefined][] = [
			["presentation.overview", p?.overview],
			...Object.entries(p?.requirementMapping ?? {}).map(([index, entry]): [string, string | undefined] => [`presentation.requirementMapping.${index}.evidence`, entry.evidence]),
			...Object.entries(p?.affectedUsers ?? {}).map(([id, text]): [string, string | undefined] => [`presentation.affectedUsers.${id}`, text]),
			...Object.entries(p?.scenarioFlows ?? {}).map(([id, text]): [string, string | undefined] => [`presentation.scenarioFlows.${id}`, text]),
			...Object.entries(narrative.scenarios ?? {}).map(([key, entry]): [string, string | undefined] => [`scenarios.${key}.observed`, entry.observed]),
		];
		for (const [field, text] of readerProse) {
			const identifier = text?.match(CODE_IDENTIFIER);
			if (identifier) throw new Error(`${field} names the code identifier "${identifier[0]}"; write what the reader sees (a test is "보유분 표 화면 테스트", not its file name)`);
		}
		for (const story of view.stories ?? []) {
			const actor = actorFor(view, story);
			for (const scenario of scenariosForStory(view, story.id)) {
				if (scenario.status !== "pass" && scenario.status !== "fail") continue;
				if (!scenarioNeedsVisualProof(scenario, actor?.driver)) continue;
				const key = scenarioKey(scenario);
				for (const source of scenario.evidence_review?.claims.flatMap((claim) => claim.sources) ?? []) {
					const embed = readEvidence(source.path);
					if (embed.kind === "missing" || embed.kind === "too-large") throw new Error(`visual claim evidence not embeddable for ${key}: ${source.path}; record a bounded source and review again`);
					if (embed.kind === "image" && !hasValidImageSignature(embed.dataUri)) throw new Error(`visual claim evidence not embeddable for ${key}: ${source.path}; record a bounded source and review again`);
				}
				for (const path of [scenario.evidence?.before, scenario.evidence?.after]) {
					const embed = path ? readEvidence(path) : undefined;
					if (embed?.kind !== "image" || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(embed.dataUri)) {
						throw new Error(`visual evidence missing or not embeddable for ${key}: ${path ?? "missing before/after screenshot"}`);
					}
				}
				if (!narrative.scenarios?.[key]?.observed?.trim()) throw new Error(`visual observation required for ${key}`);
			}
		}
	}
	const title = `QA 보고서 — ${view.target || view.phase}`;
	const evidenceContext: EvidenceRenderContext = { embeddedBytes: 0, renderedPaths: new Set(), strictVisualEvidence };
	const body = [
		`<h1>${escapeHtml(title)}</h1>`,
		`<ul class="doc-meta"><li><strong>검증 대상</strong> ${escapeHtml(view.target)}</li>` +
			`<li><strong>사이클</strong> ${escapeHtml(String(view.cycle))}</li>` +
			`<li><strong>생성 시각</strong> ${escapeHtml(view.last_touched_at)}</li></ul>`,
		renderVerdictSummary(view, unverified),
		// Reader-first order: what was asked (overview + AC·충족), how it flows (큰
		// 그림), who is affected (액터), what we observed per scenario (시나리오·근거) —
		// then the record-faithful audit below (per-cell detail, technical roster,
		// failures, verdict, evidence files).
		renderBlockedBanner(view),
		renderOverview(narrative),
			renderRequirementFulfillment(view, narrative, unverified),
		renderBigPicture(narrative.presentation, renderMermaid, onMermaidRenderError),
		renderActors(view, narrative),
			renderScenarios(view, narrative, readEvidence, evidenceContext, unverified),
		renderScenarioAudit(view, narrative, readEvidence, evidenceContext),
		renderFailures(view, narrative),
			unverified.size ? gap("검증 미완료 — 근거 미검증 시나리오가 있어 기존 판정을 승인 근거로 사용할 수 없습니다") : renderVerdict(view),
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
h1, h2, h3 { line-height: 1.3; margin: 2.25rem 0 0.75rem; word-break: keep-all; overflow-wrap: break-word; }
h1 { font-size: 1.75rem; margin-top: 0; }
h2 { font-size: 1.3rem; border-bottom: 1px solid var(--rule); padding-bottom: 0.35rem; }
h3 { font-size: 1.05rem; }
p, li, figcaption { word-break: keep-all; overflow-wrap: break-word; }
code, pre { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
pre { background: var(--code-bg); padding: 0.7rem 0.85rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; white-space: pre-wrap; }
code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.94rem; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--rule); padding: 0.45rem 0.6rem; text-align: left; min-width: 8rem; word-break: keep-all; }
th { background: var(--code-bg); }
img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--rule); }
.image-view summary { cursor: pointer; color: var(--accent); font-size: 0.85rem; }
.image-frame { overflow: auto; }
.image-view[open] + .image-frame img { max-width: none; }
.doc-meta { display: flex; flex-wrap: wrap; gap: 0.4rem 1.5rem; list-style: none; margin: 0 0 1.5rem; padding: 0.8rem 1.1rem; background: var(--code-bg); border-radius: 8px; font-size: 0.9rem; color: var(--muted); }
.doc-meta strong { color: var(--fg); font-weight: 600; }
.evidence-note { color: var(--muted); font-size: 0.92rem; }
.badge { display: inline-block; padding: 0.1em 0.55em; border-radius: 999px; font-size: 0.8rem; border: 1px solid var(--rule); background: var(--code-bg); }
.badge-pass { color: var(--pass); border-color: var(--pass); }
.badge-fail { color: var(--fail); border-color: var(--fail); }
.badge-blocked { color: var(--fail); border-color: var(--fail); }
.coverage { font-size: 0.88rem; color: var(--muted); margin: 0.75rem 0 0; }
.cov { display: inline-block; margin: 0.15rem 0; }
.cov::after { content: ""; }
.cov-pass { color: var(--pass); }
.cov-fail { color: var(--fail); font-weight: 600; }
.cov-unverified { color: var(--fail); font-weight: 600; }
.cov-blocked { color: var(--fail); font-weight: 600; }
.cov-unrecorded { color: var(--fail); font-weight: 600; }
.audit-note { color: var(--muted); font-size: 0.85rem; }
.story-block { margin: 1.75rem 0; }
.story-block > h3 { border-bottom: 1px solid var(--rule); padding-bottom: 0.3rem; }
.scenarios { display: flex; flex-direction: column; gap: 0.85rem; margin: 0.85rem 0; }
.scenario-card { border: 1px solid var(--rule); border-left: 3px solid var(--rule); border-radius: 10px; padding: 0.75rem 0.9rem; }
.scenario-card.sc-pass { border-left-color: var(--pass); }
.scenario-card.sc-fail { border-left-color: var(--fail); }
.scenario-card.sc-unverified { border-left-color: var(--fail); }
.scenario-card.sc-blocked { border-left-color: var(--fail); }
.scenario-card.sc-unrecorded { border-left-color: var(--fail); }
.sc-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.3rem 0.6rem; margin-bottom: 0.5rem; }
.sc-title { font-weight: 600; word-break: keep-all; overflow-wrap: break-word; }
.sc-meta { display: inline-flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; }
.sc-profile { font-size: 0.8rem; color: var(--muted); }
.sc-expected { margin: 0 0 0.4rem; }
.sc-steps summary, .risk-na summary { cursor: pointer; color: var(--accent); font-size: 0.88rem; }
.sc-risks { font-size: 0.85rem; color: var(--muted); margin: 0.3rem 0 0.6rem; }
.story-goal { margin: 0.4rem 0; }
.profile-coverage { font-size: 0.9rem; }
.profile-coverage ul { margin: 0.2rem 0; padding-left: 1.2rem; }
.risk-na { margin: 0.75rem 0; border: 1px solid var(--rule); border-radius: 8px; padding: 0.5rem 0.75rem; }
.client-impact { font-size: 0.92rem; }
.verdict-summary { font-size: 1.05rem; padding: 0.7rem 1rem; border: 1px solid var(--rule); border-radius: 8px; }
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
.audit-story { min-width: 6rem; }
.audit-story code { white-space: normal; overflow-wrap: anywhere; }
.audit-coverage { min-width: 8rem; word-break: keep-all; overflow-wrap: normal; }
.audit-boundary { min-width: 12rem; word-break: keep-all; overflow-wrap: anywhere; }
.audit-evidence { display: block; margin-top: 0.4rem; font-size: 0.8rem; }
.audit-evidence code { display: block; word-break: break-all; margin-top: 0.2rem; }
.audit-story-link { color: var(--accent); text-decoration: underline; }
.audit-story-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.affected-user, .scenario-flow, .ac-map { margin: 1rem 0; padding: 0.85rem 1rem; border: 1px solid var(--rule); border-radius: 10px; }
.affected-user h3, .scenario-flow h3, .ac-map h3 { margin-top: 0; }
.satisfied-yes { color: var(--pass); border-color: var(--pass); }
.satisfied-no { color: var(--fail); border-color: var(--fail); }
.satisfied-partial { color: var(--na); border-color: var(--na); }
/* unverified = the user boundary was never driven; render it LOUD, never quiet — a PO must read it as "not done", not as a mild partial */
.satisfied-unverified { color: var(--bg); background: var(--fail); border-color: var(--fail); font-weight: 700; }
/* Mermaid draws with its light theme; a fixed light panel keeps arrows and edge labels legible in dark mode too. */
.diagram { margin: 1rem 0; overflow-x: auto; background: #ffffff; color-scheme: light; border: 1px solid var(--rule); border-radius: 10px; padding: 1rem; }
.diagram svg { max-width: none; height: auto; }
.diagram figcaption { color: #4a4a4a; font-size: 0.88rem; margin-top: 0.4rem; }
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
	let mermaidRenderFailed = false;
	let mermaidRenderError: unknown;
	const html = renderQaReport(view, narrative, defaultEvidenceReader, mmdcRenderSvg, (error) => {
		mermaidRenderFailed = true;
		mermaidRenderError = error;
	}, true);
	if (mermaidRenderFailed) {
		process.stderr.write(`qa-report: Mermaid rendering failed — ${String(mermaidRenderError)}\n`);
		process.exit(1);
	}
	if (html === null) {
		process.stdout.write("qa-report: no roster recorded this cycle — report not generated (PRE-FLIGHT fail-fast)\n");
		return;
	}
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, html, "utf8");
	if (!view.report_source_snapshot) throw new Error("qa-report: missing source snapshot");
	recordRenderedReport(session, out, view.report_source_snapshot);
	process.stdout.write(`${out}\n`);
	const english = readerEnglishWords(view, narrative);
	if (english.length > 0) process.stdout.write(`English words in reader prose (keep device and product names; replace any code or setting word a PO would not know): ${english.join(", ")}\n`);
}

if (import.meta.main) {
	main();
}
