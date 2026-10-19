/**
 * qa-narrative — the contract of the model-written report narrative and every
 * content check on it, in one place.
 *
 * qa-report.ts renders facts and layout; this module decides whether the
 * narrative may be rendered at all. Both the renderer and the
 * `qa-state.ts validate-narrative` command call `validateNarrative`, so the two
 * can never disagree about what a valid narrative is. Nothing here renders HTML
 * except the sanitized big-picture SVG, which is a trust boundary.
 *
 * Satisfaction of an acceptance criterion is DERIVED here from the recorded
 * results of the scenarios it references (`resolveAcMapping`); the narrative can
 * no longer state it.
 */
import { readFileSync, statSync } from "fs";
import { extname, resolve } from "path";
import { scenarioNeedsVisualProof, type QaActor, type QaScenario, type QaStory } from "@lib/qa-chain-core";
import type { QaView } from "./qa-state.ts";

/**
 * camelCase (`displayName`), snake_case (`deep_link_value`) or a three-part PascalCase
 * component name (`JoinStepLayout`) — a code name, not something a reader sees.
 * Two-part brand names (AlgoCare, OneLink) stay allowed.
 */
export const CODE_IDENTIFIER = /\b(?:[a-z]{2,}[A-Z][a-z]\w*|[a-z]+_[a-z]\w*|[A-Z][a-z]+(?:[A-Z][a-z]+){2,})/;

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

export const IMAGE_MIME: Record<string, string> = {
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
/**
 * True when the text is an SVG document: after an optional BOM, whitespace, XML declaration, processing
 * instructions, comments and a no-subset DOCTYPE, the root is a lowercase `<svg` start tag (XML is case-sensitive),
 * and the document ends with `</svg>` (or the root is self-closing), ignoring trailing whitespace and comments.
 * A DOCTYPE with an internal subset `[...]` cannot be skipped, so it is rejected. This is a shape check, not an XML parser.
 */
function isSvgDocument(text: string): boolean {
	let rest = text.replace(/^\uFEFF/, "");
	for (;;) {
		const trimmed = rest.trimStart();
		const prefix = /^(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*>)/.exec(trimmed);
		if (!prefix) {
			rest = trimmed;
			break;
		}
		rest = trimmed.slice(prefix[0].length);
	}
	if (!/^<svg(?=[\s>/])/.test(rest)) return false;
	let end = rest.trimEnd();
	for (let m = /<!--[\s\S]*?-->$/.exec(end); m; m = /<!--[\s\S]*?-->$/.exec(end)) end = end.slice(0, m.index).trimEnd();
	return end.endsWith("</svg>") || /^<svg(?:"[^"]*"|'[^']*'|[^>"'])*\/>$/.test(end);
}

/**
 * True when a base64 image data URI holds a real image: raster formats (png/jpeg/webp/gif) by magic bytes,
 * SVG by its document shape (SVG is text and has no magic bytes; see isSvgDocument).
 */
export function hasValidImageSignature(dataUri: string): boolean {
	const svg = /^data:image\/svg\+xml;base64,(.*)$/.exec(dataUri);
	if (svg) return isSvgDocument(Buffer.from(svg[1], "base64").toString("utf8"));
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
export function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
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
 * One recorded acceptance criterion's backing: which scenarios prove or fail it
 * and the prose that explains it. The satisfaction itself is NOT a narrative
 * field: `resolveAcMapping` derives it from the referenced scenarios' recorded
 * results, and a narrative that still supplies `satisfied` is refused.
 */
export interface QaReportAcMapping {
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
	/** AC index (as string) → the scenarios behind it and the prose explaining them. */
	requirementMapping?: Record<string, QaReportAcMapping>;
	/**
	 * The big-picture diagram: ONE model-authored inline <svg> element, drawn with
	 * the class vocabulary in `SVG_CLASSES`. It is sanitized (see `sanitizeBigPictureSvg`)
	 * and rejected, never repaired, on any disallowed construct.
	 */
	bigPictureSvg?: string;
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

/** A narrative the report refuses to render; the message tells the author what to change. */
export class NarrativeError extends Error {}

export function scenarioKey(scenario: { story: string; id: string }): string {
	return `${scenario.story}:${scenario.id}`;
}

export function actorFor(view: QaView, story: QaStory): QaActor | undefined {
	const id = story.actor ?? story.actor_id;
	return (view.actors ?? []).find((actor) => actor.id === id);
}

export function scenariosForStory(view: QaView, storyId: string): QaScenario[] {
	return (view.scenarios ?? []).filter((scenario) => scenario.story === storyId);
}

/** A big-picture diagram the renderer refuses (fail closed): the message names the offending construct. */
export class BigPictureSvgError extends NarrativeError {}

// The SVG is a trust boundary: it comes from the model and lands in the report
// verbatim-looking. So it is parsed with a small strict tokenizer, checked
// against allowlists, and re-serialized from the parsed tokens — the original
// string is never echoed. Anything outside the allowlists throws.
const SVG_ELEMENTS = new Set(["svg", "g", "defs", "marker", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse", "text", "tspan", "title", "desc"]);
const SVG_TEXT_ELEMENTS = new Set(["text", "tspan", "title", "desc"]);
const SVG_ELEMENT_HINTS: Record<string, string> = {
	script: "scripts can run code",
	foreignobject: "embedded HTML does not scale or theme",
	style: "colors come from the report's class vocabulary",
	image: "external or embedded bitmaps are not allowed",
	a: "links are not allowed",
	use: "references can pull in external content",
	animate: "animation is not allowed",
	set: "animation is not allowed",
	animatetransform: "animation is not allowed",
	iframe: "embedding is not allowed",
};
/** Classes the renderer's CSS themes (light + dark); the only way an author colors a shape. */
export const SVG_CLASSES = ["box", "box-focal", "zone", "edge", "edge-pass", "edge-fail", "edge-dash", "mk", "mk-pass", "mk-fail", "t-b", "t-s", "lbl", "stop"] as const;
const NUM = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i;
const NUM_LIST = /^[-0-9.,\s]+$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
const TRANSFORM = /^\s*((translate|scale|rotate)\([-0-9.,\s]+\)\s*)+$/;
const COLOR = /^(none|currentColor|var\(--[a-z-]+\))$/;
const URL_FRAGMENT = /^url\(#([A-Za-z][\w-]*)\)$/;
const ENUM = (...values: string[]) => (v: string) => values.includes(v);
const ATTRIBUTE_RULES: Record<string, (value: string) => boolean> = {
	id: (v) => /^[A-Za-z][\w-]*$/.test(v),
	class: (v) => v.trim().split(/\s+/).every((c) => SVG_CLASSES.some((known) => known === c)),
	viewBox: (v) => { const p = v.trim().split(/[\s,]+/); return p.length === 4 && p.every((n) => NUM.test(n)) && Number(p[2]) > 0 && Number(p[3]) > 0; },
	x: (v) => NUM.test(v), y: (v) => NUM.test(v), x1: (v) => NUM.test(v), y1: (v) => NUM.test(v), x2: (v) => NUM.test(v), y2: (v) => NUM.test(v),
	cx: (v) => NUM.test(v), cy: (v) => NUM.test(v), r: (v) => NUM.test(v), rx: (v) => NUM.test(v), ry: (v) => NUM.test(v),
	width: (v) => NUM.test(v), height: (v) => NUM.test(v), refX: (v) => NUM.test(v), refY: (v) => NUM.test(v),
	markerWidth: (v) => NUM.test(v), markerHeight: (v) => NUM.test(v),
	"stroke-width": (v) => NUM.test(v), opacity: (v) => NUM.test(v), "fill-opacity": (v) => NUM.test(v), "stroke-opacity": (v) => NUM.test(v),
	"stroke-dasharray": (v) => NUM_LIST.test(v),
	d: (v) => PATH_DATA.test(v), points: (v) => NUM_LIST.test(v), transform: (v) => TRANSFORM.test(v),
	fill: (v) => COLOR.test(v), stroke: (v) => COLOR.test(v),
	"marker-start": (v) => URL_FRAGMENT.test(v), "marker-mid": (v) => URL_FRAGMENT.test(v), "marker-end": (v) => URL_FRAGMENT.test(v),
	"text-anchor": ENUM("start", "middle", "end"),
	"font-weight": ENUM("normal", "bold", "500", "600", "700"),
	"stroke-linecap": ENUM("butt", "round", "square"), "stroke-linejoin": ENUM("miter", "round", "bevel"),
	"fill-rule": ENUM("nonzero", "evenodd"),
	orient: (v) => v === "auto" || v === "auto-start-reverse" || NUM.test(v),
	markerUnits: ENUM("strokeWidth", "userSpaceOnUse"),
	preserveAspectRatio: ENUM("xMidYMid meet", "none"),
	"aria-label": (v) => v.trim() !== "", "aria-labelledby": (v) => /^[A-Za-z][\w-]*( [A-Za-z][\w-]*)*$/.test(v),
	"aria-hidden": ENUM("true"),
	role: ENUM("img"),
	xmlns: ENUM("http://www.w3.org/2000/svg"),
};
const ROOT_ONLY_ATTRIBUTES = new Set(["xmlns", "role", "aria-label", "aria-labelledby"]);
const SVG_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function svgFail(message: string): never {
	throw new BigPictureSvgError(`presentation.bigPictureSvg rejected: ${message}`);
}

function decodeSvgText(raw: string, where: string): string {
	return raw.replace(/&([^;\s&]*);?/g, (whole, name: string) => {
		if (!whole.endsWith(";") || !Object.hasOwn(SVG_ENTITIES, name)) svgFail(`${where} contains the entity "${whole}" (only &amp; &lt; &gt; &quot; &apos; are allowed)`);
		return SVG_ENTITIES[name];
	});
}

/**
 * Validates one model-authored `<svg>` and returns a re-serialized, renderer-
 * owned copy. The root keeps only its viewBox; the renderer adds role="img" and
 * sizing. Throws {@link BigPictureSvgError} naming the first offending construct.
 */
export function sanitizeBigPictureSvg(source: string): { svg: string; viewBoxWidth: number } {
	const tokenizer = /<!--|<!|<\?|<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>|<|[^<]+/g;
	const out: string[] = [];
	const stack: string[] = [];
	const ids = new Set<string>();
	const references: string[] = [];
	let rootSeen = false;
	let viewBoxWidth = 0;
	let rootLabel = "";
	const trimmed = source.trim();
	for (let token = tokenizer.exec(trimmed); token; token = tokenizer.exec(trimmed)) {
		const text = token[0];
		if (text.startsWith("<!--") || text.startsWith("<!") || text.startsWith("<?")) svgFail(`"${text}" (comments, CDATA, doctype and processing instructions are not allowed)`);
		if (text.startsWith("<") && token[2] === undefined) svgFail(`malformed markup near "${text.slice(0, 30)}"`);
		if (!text.startsWith("<")) {
			const whole = decodeSvgText(text, "text");
			if (stack.length === 0) { if (whole.trim() !== "") svgFail("text outside the <svg> root"); continue; }
			if (!SVG_TEXT_ELEMENTS.has(stack[stack.length - 1])) { if (whole.trim() !== "") svgFail(`text inside <${stack[stack.length - 1]}> (text belongs in <text>, <tspan>, <title> or <desc>)`); continue; }
			out.push(escapeHtml(whole));
			continue;
		}
		const closing = token[1] === "/";
		const name = token[2];
		if (!SVG_ELEMENTS.has(name)) svgFail(`<${name}> is not allowed${SVG_ELEMENT_HINTS[name.toLowerCase()] ? ` (${SVG_ELEMENT_HINTS[name.toLowerCase()]})` : ""}`);
		if (closing) {
			if (stack.pop() !== name) svgFail(`unbalanced </${name}>`);
			out.push(`</${name}>`);
			continue;
		}
		if (stack.length === 0) { if (rootSeen) svgFail("more than one root element (exactly one <svg> is allowed)"); if (name !== "svg") svgFail(`root must be <svg>, got <${name}>`); rootSeen = true; }
		else if (name === "svg") svgFail("nested <svg> is not allowed");
		const attrs: string[] = [];
		const seenAttrs = new Set<string>();
		for (const match of (token[3] ?? "").matchAll(/([^\s=>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
			const attr = match[1];
			if (/^on/i.test(attr)) svgFail(`event handler attribute "${attr}" on <${name}>`);
			if (/^style$/i.test(attr)) svgFail(`style="" attribute on <${name}> (use the class vocabulary)`);
			if (/(^|:)href$/i.test(attr)) svgFail(`"${attr}" attribute on <${name}> (external references are not allowed)`);
			const rule = ATTRIBUTE_RULES[attr];
			if (!rule) svgFail(`attribute "${attr}" on <${name}> is not in the allowlist`);
			if (match[2] === undefined && match[3] === undefined) svgFail(`attribute "${attr}" on <${name}> needs a quoted value`);
			if (seenAttrs.has(attr)) svgFail(`duplicate attribute "${attr}" on <${name}>`);
			seenAttrs.add(attr);
			if (ROOT_ONLY_ATTRIBUTES.has(attr) && name !== "svg") svgFail(`attribute "${attr}" is only allowed on the <svg> root, found on <${name}>`);
			if (attr === "viewBox" && name !== "svg" && name !== "marker") svgFail(`attribute "viewBox" on <${name}>`);
			if (attr === "width" || attr === "height") { if (name === "svg") svgFail(`attribute "${attr}" on the <svg> root (the renderer sizes it from viewBox)`); }
			const value = decodeSvgText(match[2] ?? match[3] ?? "", `attribute "${attr}"`);
			if (/url\(/i.test(value) && !URL_FRAGMENT.test(value)) svgFail(`attribute "${attr}" on <${name}> uses url(...) other than a same-document #id`);
			if (!rule(value)) svgFail(`attribute "${attr}="${value.slice(0, 40)}"" on <${name}> is not a permitted value`);
			if (attr === "id") ids.add(value);
			const ref = URL_FRAGMENT.exec(value);
			if (ref) references.push(ref[1]);
			if (name === "svg" && attr === "viewBox") viewBoxWidth = Number(value.trim().split(/[\s,]+/)[2]);
			if (name === "svg" && attr === "aria-label") rootLabel = value;
			if (name !== "svg" || !ROOT_ONLY_ATTRIBUTES.has(attr)) attrs.push(`${attr}="${escapeHtml(value)}"`);
		}
		if (name === "svg") {
			if (!seenAttrs.has("viewBox")) svgFail("the <svg> root needs a viewBox");
			if (!rootLabel.trim()) svgFail('the <svg> root needs a non-empty aria-label (a one-sentence statement of what the diagram shows)');
		}
		const selfClosing = token[4] === "/";
		if (name === "svg") attrs.push(`role="img"`, `aria-label="${escapeHtml(rootLabel)}"`);
		out.push(`<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}${selfClosing ? "/" : ""}>`);
		if (!selfClosing) stack.push(name);
	}
	if (!rootSeen) svgFail("no <svg> root element found");
	if (stack.length) svgFail(`unclosed <${stack[stack.length - 1]}>`);
	for (const ref of references) if (!ids.has(ref)) svgFail(`url(#${ref}) points at an id that is not defined inside the <svg>`);
	return { svg: out.join(""), viewBoxWidth };
}

/** The pre-rename field name; kept only to refuse it loudly. */
const LEGACY_BIG_PICTURE_FIELD = "bigPicture";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AcSatisfaction = "yes" | "no" | "partial" | "unverified";

export type AcResolution =
	| { ok: true; satisfied: AcSatisfaction; scenarioRefs: NonNullable<QaReportAcMapping["scenarioRefs"]>; evidence?: string }
	| { ok: false; reason: string };

/**
 * Resolves one acceptance criterion's mapping and DERIVES its satisfaction from
 * the recorded results of the scenarios it references. Every ref must point at
 * exactly one current-cycle scenario of a story that links this criterion, and
 * that scenario must have a recorded result (pass, fail or blocked); any other
 * mapping cannot be derived and is `ok: false` (the report shows it as 미판정).
 *
 * - all referenced scenarios pass            → yes
 * - all fail                                 → no
 * - at least one blocked                     → unverified
 * - otherwise (a mix of pass and fail)       → partial
 */
export function resolveAcMapping(view: QaView, value: unknown, acIndex: number): AcResolution {
	if (!isRecord(value)) return { ok: false, reason: "the mapping is not an object" };
	if (!Array.isArray(value.scenarioRefs) || value.scenarioRefs.length === 0) return { ok: false, reason: "scenarioRefs must be a non-empty array of {story, scenario}" };
	const refs: NonNullable<QaReportAcMapping["scenarioRefs"]> = [];
	const seen = new Set<string>();
	const statuses: string[] = [];
	for (const ref of value.scenarioRefs) {
		if (!isRecord(ref) || typeof ref.story !== "string" || ref.story.trim() === "" || typeof ref.scenario !== "string" || ref.scenario.trim() === "") return { ok: false, reason: "every scenarioRefs item needs a non-empty story and scenario string" };
		const key = scenarioKey({ story: ref.story, id: ref.scenario });
		if (seen.has(key)) return { ok: false, reason: `scenarioRefs lists ${key} twice` };
		seen.add(key);
		const matches = (view.scenarios ?? []).filter((scenario) => scenario.story === ref.story && scenario.id === ref.scenario && scenario.cycle === view.cycle);
		if (matches.length !== 1) return { ok: false, reason: `${key} is not a scenario recorded in the current cycle` };
		const story = (view.stories ?? []).find((s) => s.id === ref.story);
		if (!story?.contract?.acceptance_criteria?.includes(acIndex)) return { ok: false, reason: `story ${ref.story} does not link acceptance criterion ${acIndex}` };
		const status = matches[0].status;
		if (status !== "pass" && status !== "fail" && status !== "blocked") return { ok: false, reason: `${key} has no recorded result yet (pass, fail or blocked); run and record it first` };
		refs.push({ story: ref.story, scenario: ref.scenario });
		statuses.push(status);
	}
	const satisfied: AcSatisfaction = statuses.includes("blocked") ? "unverified" : statuses.every((s) => s === "pass") ? "yes" : statuses.every((s) => s === "fail") ? "no" : "partial";
	return { ok: true, satisfied, scenarioRefs: refs, ...(typeof value.evidence === "string" ? { evidence: value.evidence } : {}) };
}

/**
 * `contract`: the narrative breaks the field contract; the renderer always refuses it.
 * `content`: reader prose or evidence the final report must not carry; the strict (final) render refuses it.
 * `gap`: a slot left unwritten; the renderer shows a visible gap marker instead of refusing.
 */
export interface NarrativeProblem {
	kind: "contract" | "content" | "gap";
	message: string;
}

/**
 * Every content check on a narrative, collected rather than thrown. With
 * `content: false` the content checks (which read evidence files) are skipped,
 * the way a non-final render skips them. `qa-state.ts validate-narrative` runs
 * with `content: true`; the strict renderer refuses on the same list.
 */
export function validateNarrative(view: QaView, narrative: QaReportNarrative, readEvidence: EvidenceReader, options: { content: boolean }): NarrativeProblem[] {
	const problems: NarrativeProblem[] = [];
	const add = (kind: NarrativeProblem["kind"], message: string): void => { problems.push({ kind, message }); };
	const p = narrative.presentation;

	// Contract: retired fields and the diagram's trust boundary.
	if (p && LEGACY_BIG_PICTURE_FIELD in p) add("contract", `presentation.${LEGACY_BIG_PICTURE_FIELD} is no longer supported (it held Mermaid source). Provide presentation.bigPictureSvg: one inline <svg> element authored per skills/qa/presentation.md`);
	if (p?.bigPictureSvg?.trim()) {
		try { sanitizeBigPictureSvg(p.bigPictureSvg); } catch (error) { if (!(error instanceof BigPictureSvgError)) throw error; add("contract", error.message); }
	} else add("gap", "presentation.bigPictureSvg is empty; the 큰 그림 section renders a gap marker");
	for (const [index, entry] of Object.entries(p?.requirementMapping ?? {})) {
		if (isRecord(entry) && "satisfied" in entry) add("contract", `presentation.requirementMapping.${index}.satisfied is no longer supported: the satisfaction is derived from the recorded results of the referenced scenarios (all pass → 충족, all fail → 미충족, any blocked → 미검증, a mix of pass and fail → 부분 충족). Remove the field and keep scenarioRefs and evidence`);
	}

	// Gaps: required slots the author left unwritten.
	if (!p?.overview?.trim()) add("gap", "presentation.overview is empty; the 기능 개요 section renders a gap marker");
	for (const actor of view.actors ?? []) if (!p?.affectedUsers?.[actor.id]?.trim()) add("gap", `presentation.affectedUsers.${actor.id} is empty; the actor block renders a gap marker`);
	for (const story of view.stories ?? []) if (!p?.scenarioFlows?.[story.id]?.trim()) add("gap", `presentation.scenarioFlows.${story.id} is empty; the story block renders a gap marker`);
	(view.acceptance_criteria ?? []).forEach((_, index) => {
		const field = `presentation.requirementMapping.${index}`;
		const entry = p?.requirementMapping?.[String(index)];
		if (entry === undefined) { add("gap", `${field} is missing; the requirement renders as 미판정`); return; }
		const resolved = resolveAcMapping(view, entry, index);
		if (!resolved.ok) add("gap", `${field} cannot be resolved (${resolved.reason}); the requirement renders as 미판정`);
		else if (!resolved.evidence?.trim()) add("gap", `${field}.evidence is empty; the requirement renders a gap marker`);
	});

	if (!options.content) return problems;

	// Content: the summary line, banner and AC board already show the QA result; the overview describes the change itself.
	const overviewResult = p?.overview?.match(/APPROVE|COMMENT|REQUEST_CHANGES|QA|판정|검증 불가|미검증|신뢰도/);
	if (overviewResult) add("content", `기능 개요 (presentation.overview) must describe the change, not the QA result ("${overviewResult[0]}"); the summary line, banner and AC board already show it`);
	// Reader prose names what the user sees; file and code names belong to the audit section.
	const readerProse: [string, string | undefined][] = [
		["presentation.overview", p?.overview],
		...Object.entries(p?.requirementMapping ?? {}).map(([index, entry]): [string, string | undefined] => [`presentation.requirementMapping.${index}.evidence`, entry.evidence]),
		...Object.entries(p?.affectedUsers ?? {}).map(([id, text]): [string, string | undefined] => [`presentation.affectedUsers.${id}`, text]),
		...Object.entries(p?.scenarioFlows ?? {}).map(([id, text]): [string, string | undefined] => [`presentation.scenarioFlows.${id}`, text]),
		...Object.entries(narrative.scenarios ?? {}).map(([key, entry]): [string, string | undefined] => [`scenarios.${key}.observed`, entry.observed]),
	];
	for (const [field, text] of readerProse) {
		const identifier = text?.match(CODE_IDENTIFIER);
		if (identifier) add("content", `${field} names the code identifier "${identifier[0]}"; write what the reader sees (a test is "보유분 표 화면 테스트", not its file name)`);
	}
	const embeddableScreenshot = (path: string | undefined): boolean => {
		const embed = path ? readEvidence(path) : undefined;
		return embed?.kind === "image" && hasValidImageSignature(embed.dataUri);
	};
	for (const story of view.stories ?? []) {
		const actor = actorFor(view, story);
		for (const scenario of scenariosForStory(view, story.id)) {
			if (scenario.status !== "pass" && scenario.status !== "fail" && scenario.status !== "blocked") continue;
			const key = scenarioKey(scenario);
			const observed = narrative.scenarios?.[key]?.observed?.trim();
			if (scenario.status === "blocked") {
				if (!observed) add("content", `observation required for ${key}`);
				// Captures are optional for blocked, but a recorded one must still render.
				for (const path of [scenario.evidence?.before, scenario.evidence?.after]) {
					if (path && !embeddableScreenshot(path)) add("content", `visual evidence missing or not embeddable for ${key}: ${path}`);
				}
				continue;
			}
			if (!scenarioNeedsVisualProof(scenario, actor?.driver)) {
				if (!observed) add("content", `observation required for ${key}`);
				continue;
			}
			for (const source of scenario.evidence_review?.claims.flatMap((claim) => claim.sources) ?? []) {
				const embed = readEvidence(source.path);
				if (embed.kind === "missing" || embed.kind === "too-large" || (embed.kind === "image" && !hasValidImageSignature(embed.dataUri))) add("content", `visual claim evidence not embeddable for ${key}: ${source.path}; record a bounded source and review again`);
			}
			for (const path of [scenario.evidence?.before, scenario.evidence?.after]) {
				if (!embeddableScreenshot(path)) add("content", `visual evidence missing or not embeddable for ${key}: ${path ?? "missing before/after screenshot"}`);
			}
			if (!observed) add("content", `visual observation required for ${key}`);
		}
	}
	return problems;
}

/** Throws a {@link NarrativeError} listing every problem the renderer must refuse; `strict` is the final-report render. */
export function assertRenderable(problems: NarrativeProblem[], strict: boolean): void {
	const fatal = problems.filter((problem) => problem.kind === "contract" || (strict && problem.kind === "content"));
	if (fatal.length) throw new NarrativeError(fatal.map((problem) => problem.message).join("\n"));
}
