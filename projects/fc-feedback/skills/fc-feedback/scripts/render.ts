/**
 * fc-feedback HTML renderer — session viewer, archive index page, reference
 * page. `DESIGN.md`(v2) is the design-intent contract this file implements
 * literally; each render function's header comment names the section(s) it
 * carries out.
 *
 * Every interpolated string goes through `escapeHtml`, every attribute is
 * double-quoted, styling is one inline `<style>` (STYLE) with no external
 * CSS/font/image reference, and the session page carries exactly two
 * `<script>` tags: the static `VIEWER_JS` (no interpolation, reads only
 * server-rendered `data-*` attributes, no JSON embedded) followed by the
 * YouTube `iframe_api` loader. Mechanics forked from skills/qa/scripts/qa-report.ts
 * (inline style, escapeHtml-everywhere discipline) — no runtime import from
 * that skill, only the technique is reused.
 *
 * Two documented gap-fills beyond the plan §3 data.json text (flagged in the
 * implementer's report, not silent deviations):
 * - `UnitSimilar` adds `date`: DESIGN.md §5 item 9 requires showing the past
 *   session's date next to a similar-feedback link, and core.ts's own
 *   `SimilarCandidate` already carries `date` — the plan's abbreviated
 *   `similar[{uid,title,href}]` text omitted a field the sibling module and
 *   the design both need.
 * - The card root carries `data-embeddable` in addition to DESIGN.md §5's
 *   listed `data-video data-start data-pos data-topics data-member-ids
 *   data-related-ids`: the per-video embeddable-placeholder switch (§9) has
 *   no other data hook to read from.
 */
import { anc, boldSpans, formatTime, PARENT, posClosure } from "./core.ts";

// ── input types (plan §3) ────────────────────────────────────────────────

/** data.json `videos[]` entry — only the fields the viewer needs. */
export interface SessionVideoInfo {
	id: string;
	part: number;
	embeddable: boolean;
}

/** data.json `members[]` entry — only the fields the viewer needs. */
export interface SessionMemberInfo {
	id: string;
	name: string;
	gamertag: string;
	positions: string[];
}

export interface UnitStartImage {
	src: string;
	width: number;
	height: number;
}

export interface UnitImages {
	start: UnitStartImage;
}

/** A body paragraph (DESIGN §5 item 7): text is escaped, `**bold**` spans become `<strong>`. */
export interface UnitBodyTextBlock {
	type: "text";
	text: string;
}

/** A body frame (DESIGN §5 item 7): clicking it seeks the card's video to `t`. */
export interface UnitBodyFrameBlock {
	type: "frame";
	src: string;
	width: number;
	height: number;
	t: number;
	caption: string;
}

export type UnitBodyBlock = UnitBodyTextBlock | UnitBodyFrameBlock;

/** `similar[{uid,title,href}]` plus `date` — see the module doc's gap-fill note. */
export interface UnitSimilar {
	uid: string;
	title: string;
	date: string;
	href: string;
}

/** `href` is `null` for a `lang: "ko"` ref (no summary page is generated, DESIGN §5/§12). */
export interface UnitRef {
	id: string;
	title: string;
	lang: string;
	kind: "eafc" | "tactics";
	href: string | null;
	orig_url: string;
}

export interface SessionUnit {
	id: string;
	uid: string;
	match_id: string;
	topic_id: string;
	video: string;
	start: number;
	end: number;
	title: string;
	position_tags: string[];
	topic_tags: string[];
	member_ids: string[];
	related_member_ids: string[];
	body: UnitBodyBlock[];
	images: UnitImages;
	similar: UnitSimilar[];
	refs: UnitRef[];
	watch_url: string;
}

export interface SessionTopic {
	id: string;
	title: string;
	summary: string;
	unit_ids: string[];
}

export interface SessionMatch {
	id: string;
	title: string;
	topics: SessionTopic[];
}

/** data.json (sessions/<sid>/data.json), plan §3. */
export interface SessionData {
	version: 1;
	session_id: string;
	title: string;
	date: string;
	generated_at: string;
	pages_base_url: string;
	videos: SessionVideoInfo[];
	members: SessionMemberInfo[];
	matches: SessionMatch[];
	units: SessionUnit[];
}

export interface IndexSessionEntry {
	id: string;
	title: string;
	date: string;
	videos: number;
	unit_count: number;
	topic_tags: string[];
	href: string;
}

export interface IndexUnitEntry {
	uid: string;
	session: string;
	title: string;
	date: string;
	position_tags: string[];
	topic_tags: string[];
	member_ids: string[];
	href: string;
}

export interface IndexRefEntry {
	id: string;
	url: string;
	title: string;
	lang: string;
	kind: "eafc" | "tactics";
	page: string | null;
	first_session: string;
}

/** index.json (archive root), plan §3. Sessions/units are trusted pre-sorted by the builder. */
export interface ArchiveIndex {
	version: 1;
	updated_at: string;
	sessions: IndexSessionEntry[];
	units: IndexUnitEntry[];
	refs: IndexRefEntry[];
}

export interface RefTranslation {
	orig: string;
	ko: string;
}

/** A `refs.verified.json` entry for a non-`ko` ref, the input to `renderRef` (plan §3, DESIGN §12). */
export interface RefPageData {
	id: string;
	title: string;
	lang: string;
	kind: "eafc" | "tactics";
	url: string;
	summary_ko: string;
	key_points_ko: string[];
	translations: RefTranslation[];
}

// ── escaping (matches skills/qa/scripts/qa-report.ts's escapeHtml) ─────────

function escapeHtml(value: string): string {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Wraps each "한글단어(영문...)"-shaped token — e.g. "비활성(disabled)" — in
 * `<span class="nobr">` so `word-break: keep-all` can't still split it right before the "("
 * (DESIGN §10). Titles only (h1/card title/TOC/archive card title); takes already-escaped
 * text, since escaping never touches the parentheses this matches on.
 */
function wrapNobr(escaped: string): string {
	return escaped.replace(/\S+\([^)\s]{1,20}\)/g, (match) => `<span class="nobr">${match}</span>`);
}

/**
 * Every precomposed Hangul syllable (U+AC00-U+D7A3) encodes its final consonant (batchim) as
 * (code - 0xAC00) % 28 - 0 is "no batchim", 4 is ㄴ, 8 is ㄹ (KS X 1001 batchim order). Real text
 * glues via a fused syllable carrying that batchim ("앞당겨질" ends in 질 = ㄹ, "만든" ends in
 * 든 = ㄴ) - the bare compatibility jamo ㄹ/ㄴ characters this replaced never occur standalone in
 * prose, which was the bug (DESIGN §15-1 fix log). `hangulSyllablesWithFinal` expands the 19x21
 * syllables sharing one batchim into a regex character class once, at module load.
 */
function hangulSyllablesWithFinal(finalIndex: number): string {
	let chars = "";
	for (let block = 0; block < 19 * 21; block++) {
		chars += String.fromCodePoint(0xac00 + block * 28 + finalIndex);
	}
	return chars;
}

const RIEUL_BATCHIM = hangulSyllablesWithFinal(8); // ㄹ batchim, e.g. 할/질/올
const NIEUN_BATCHIM = hangulSyllablesWithFinal(4); // ㄴ batchim, e.g. 든/간/본

/**
 * Matches each bound Korean grammatical construction this file glues (DESIGN §10/§15-1):
 * negation (-지 못/않), -기(도/만) 전/시작/위해/때문, -다 보니/보면, -을/를/(ㄹ batchim) 수 있/없
 * (both spaces), -고 있/싶, -아/어 주/보/버리/놓, dependent noun 것 after -는/은/을/(ㄴ or ㄹ
 * batchim), and a number glued to its counter (초/분/번/명/개/m/골). `\S*` is bounded by
 * whitespace on both sides, so it never crosses into a neighboring word - an ordinary
 * inter-word space between two independent words (e.g. "수비 전환") matches none of these and
 * stays breakable. An optional `\*{0,2}` after the trigger character tolerates a bold span's
 * closing "**" landing exactly at the construction boundary (e.g. "**...하는**" 것"), the one
 * run-boundary case this can still catch by running on the raw text before `boldSpans()` splits
 * on "**" - see `glueKorean`'s own comment for the reason that ordering, not per-span
 * application, is used.
 */
const GLUE_PATTERNS: readonly RegExp[] = [
	/\S*지\*{0,2} (?:못|않)/g,
	/\S*기(?:도|만)?\*{0,2} (?:전|시작|위해|때문)/g,
	/\S*다\*{0,2} (?:보니|보면)/g,
	new RegExp(`\\S*(?:을|를|[${RIEUL_BATCHIM}])\\*{0,2} 수 (?:있|없)`, "g"),
	/\S*고\*{0,2} (?:있|싶)/g,
	/\S*[아어]\*{0,2} (?:주|보|버리|놓)/g,
	new RegExp(`\\S*(?:는|은|을|[${RIEUL_BATCHIM}${NIEUN_BATCHIM}])\\*{0,2} 것`, "g"),
	/\d+ (?:초|분|번|명|개|m|골)/g,
];

// A chained construction ("찾기 시작하다 보니", "-지 못하고 있는 것") can glue several
// adjacent spaces in one pass, producing one unbreakable run long enough to blow past the
// 390px column and force a mid-word overflow-wrap break instead (DESIGN §10/§15-1's own
// "anywhere" fallback). MAX_GLUE_RUN caps how many characters (Korean syllables, counted at
// the 17px Body size, DESIGN §2) a single NBSP-joined run may reach before this file gives one
// of its internal joints back its ordinary breakable space - chosen so a run at the cap still
// fits the 390px viewport's content column at Body size. lazy: fixed constant tuned for the
// current type scale; revisit if §2's Body size or --measure changes.
const MAX_GLUE_RUN = 14;
const NBSP = "\u00a0";

/** Un-glues the earliest joint that keeps `run` within `MAX_GLUE_RUN`, recursing on the remainder - pure, called only by `capGlueRunLength`. */
function capGlueRun(run: string): string {
	if (run.length <= MAX_GLUE_RUN) {
		return run;
	}
	let breakAt = -1;
	for (let i = Math.min(MAX_GLUE_RUN, run.length - 1); i >= 1; i--) {
		if (run[i - 1] === NBSP) {
			breakAt = i - 1;
			break;
		}
	}
	if (breakAt === -1) {
		breakAt = run.indexOf(NBSP);
	}
	if (breakAt === -1) {
		return run; // no internal joint at all - an already-unbreakable single word, leave it
	}
	return run.slice(0, breakAt) + " " + capGlueRun(run.slice(breakAt + 1));
}

/** Splits on the real (breakable) spaces `glueKorean`'s patterns left untouched, then caps each NBSP-joined run (§15-1's chaining hazard) independently. */
function capGlueRunLength(text: string): string {
	return text
		.split(" ")
		.map((run) => capGlueRun(run))
		.join(" ");
}

/**
 * Replaces the ASCII space inside a bound grammatical construction with U+00A0 so
 * `word-break: keep-all`/`text-wrap: pretty` can't still split the pair mid-construction
 * (DESIGN §10/§15-1) - U+00A0 passes through `escapeHtml` untouched. Pure; run it on the RAW
 * note text/caption/title BEFORE `boldSpans()` splits on "**", not per resulting span: "**"
 * markers are non-space and never block a match, so a construction whose boundary falls right
 * at a bold-span edge (e.g. "**하는** 것") is still glued - splitting first would lose that
 * cross-boundary case entirely (documented limitation avoided by ordering, not accepted). The
 * result then passes through `capGlueRunLength` once, since chained constructions can glue
 * several patterns' spaces back to back into one over-long run (DESIGN §15-1).
 */
export function glueKorean(text: string): string {
	const glued = GLUE_PATTERNS.reduce(
		(acc, pattern) => acc.replace(pattern, (match) => match.replace(/ /g, NBSP)),
		text,
	);
	return capGlueRunLength(glued);
}

/** Card title / TOC label shared pipeline: glue bound constructions, then the existing escape+nobr treatment (DESIGN §5/§8/§10). */
function unitTitleHtml(title: string): string {
	return wrapNobr(escapeHtml(glueKorean(title)));
}

// ── position tree display order (DESIGN.md §7) ──────────────────────────────
//
// core.ts's `PARENT` map already lists each parent's children in the exact
// order DESIGN.md §7 implies (CB,FB / LB,RB,LWB,RWB / CDM,CM,CAM,LM,RM /
// ST,CF,LW,RW,LF,RF) — this only adds the root ordering, which `PARENT` does
// not carry (roots have no parent entry).

const POSITION_ROOTS = ["GK", "DF", "MF", "FW"] as const;

function childrenOf(tag: string): string[] {
	return Object.keys(PARENT).filter((child) => PARENT[child] === tag);
}

/** `{root} ∪ ancestors`'s last element is always the tree root (GK/DF/MF/FW). */
function positionRoot(tag: string): string {
	const chain = anc(tag);
	return chain[chain.length - 1] ?? tag;
}

// ── small render helpers ─────────────────────────────────────────────────

function chip(className: string, label: string): string {
	return `<span class="chip ${className}">${escapeHtml(label)}</span>`;
}

/**
 * A keyboard-reachable seek control (DESIGN §5/§13): renders the time label as a real
 * `<button>` instead of a decorative `<span>` so seeking works without a mouse, while the
 * card/frame area itself stays clickable too — `onCardListClick` reads `data-seek-t` first.
 */
function seekTimeButton(seconds: number): string {
	const label = formatTime(seconds);
	return (
		`<button type="button" class="chip chip-time seek-btn" data-seek-t="${seconds}" ` +
		`aria-label="${escapeHtml(label)}부터 재생">${escapeHtml(label)}</button>`
	);
}

function positionChipClass(tag: string): string {
	const root = positionRoot(tag);
	if (root === "GK") return "chip-pos-gk";
	if (root === "DF") return "chip-pos-df";
	if (root === "MF") return "chip-pos-mf";
	return "chip-pos-fw";
}

function memberName(members: readonly SessionMemberInfo[], id: string): string {
	return members.find((member) => member.id === id)?.name ?? id;
}

/** First-appearance order of `topic_tags` across a list of units/index entries (used by the topic facet, TOC "주제별" tab, and the archive's topic index — DESIGN §7/§8/§12). */
function firstAppearanceTags(items: ReadonlyArray<{ topic_tags: readonly string[] }>): string[] {
	const tags: string[] = [];
	for (const item of items) {
		for (const tag of item.topic_tags) {
			if (!tags.includes(tag)) tags.push(tag);
		}
	}
	return tags;
}

// ── facet counts, computed once at build time (DESIGN.md §7) ───────────────
//
// Every count below is fixed from the full session at build time — it never
// depends on what else is selected, and it never changes at runtime. That is
// what lets the client hide zero-result options up front and keep a selected
// option visible even if an AND with another group drops it to zero results.

/** Per-position-tag count = number of units whose `posClosure(position_tags)` contains that tag (ancestors+descendants both count, DESIGN §7). */
function countPositionNodes(data: SessionData): Map<string, number> {
	const counts = new Map<string, number>();
	for (const unit of data.units) {
		for (const tag of posClosure(unit.position_tags)) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return counts;
}

function countTopicTags(data: SessionData): Map<string, number> {
	const counts = new Map<string, number>();
	for (const unit of data.units) {
		for (const tag of unit.topic_tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return counts;
}

function countMentionMembers(data: SessionData): Map<string, number> {
	const counts = new Map<string, number>();
	for (const unit of data.units) {
		for (const id of unit.member_ids) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return counts;
}

/** `relatedMembers(unit)` occurrence count per member — the basis for both the "내 피드백" pill count (§6) and pill eligibility (only members with ≥1 count get a pill). */
function countRelatedMembers(data: SessionData): Map<string, number> {
	const counts = new Map<string, number>();
	for (const unit of data.units) {
		for (const id of unit.related_member_ids) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return counts;
}

// ── 내 피드백 (DESIGN.md §6) ─────────────────────────────────────────────

function renderMyFeedbackNav(data: SessionData): string {
	if (data.members.length === 0) {
		return "";
	}
	const counts = countRelatedMembers(data);
	const eligible = data.members.filter((member) => (counts.get(member.id) ?? 0) > 0);
	if (eligible.length === 0) {
		return "";
	}
	const pills = eligible
		.map((member) => {
			const count = counts.get(member.id) ?? 0;
			// `role="listitem"` sits on this wrapper, not the button itself (DESIGN §6/§13):
			// an interactive control cannot also carry a structural list-item role.
			return (
				`<div role="listitem"><button type="button" class="pill pill-mine" data-group="mine" data-value="${escapeHtml(member.id)}" aria-pressed="false">` +
				`${escapeHtml(member.name)} <span class="count">${count}</span></button></div>`
			);
		})
		.join("");
	return (
		`<nav class="my-feedback" aria-label="내 피드백">` +
		`<span class="my-feedback-label">내 피드백</span>` +
		`<div class="my-feedback-row" role="list">${pills}</div>` +
		`</nav>`
	);
}

// ── 필터 바 (DESIGN.md §7) ───────────────────────────────────────────────

/**
 * `isRoot` marks GK/DF/MF/FW with `.chip-pos-root` (DESIGN §15-5/§15-10) so the tree's two
 * levels read differently at a glance — children (recursive calls below) never get it. A node
 * with children renders as `.pos-node--branch`: its own chip in a fixed left column, its
 * children wrapping in the row to the right (DESIGN §7) — the same two-column rule at every
 * depth is what keeps a nested branch (FB > LB/RB/LWB/RWB) visually consistent with a root
 * branch instead of every chip at every depth flowing into one mixed row. A childless node
 * stays a plain `.pos-node` span (no row split needed).
 */
function renderPositionNode(tag: string, counts: Map<string, number>, isRoot: boolean): string {
	const count = counts.get(tag) ?? 0;
	if (count === 0) {
		return "";
	}
	const childHtml = childrenOf(tag)
		.map((child) => renderPositionNode(child, counts, false))
		.join("");
	const rootClass = isRoot ? " chip-pos-root" : "";
	const button =
		`<button type="button" class="chip chip-filter${rootClass}" data-group="position" data-value="${escapeHtml(tag)}" aria-pressed="false">` +
		`${escapeHtml(tag)} (${count})</button>`;
	return childHtml
		? `<div class="pos-node pos-node--branch">${button}<div class="pos-children">${childHtml}</div></div>`
		: `<span class="pos-node">${button}</span>`;
}

function renderPositionFacetGroup(data: SessionData): string {
	const counts = countPositionNodes(data);
	const roots = POSITION_ROOTS.map((root) => renderPositionNode(root, counts, true)).join("");
	if (roots === "") {
		return "";
	}
	return (
		`<div class="filter-group" data-role="filter-position">` +
		`<span class="filter-group-label">포지션</span>` +
		`<div class="pos-tree">${roots}</div>` +
		`</div>`
	);
}

function renderTopicFacetGroup(data: SessionData): string {
	const counts = countTopicTags(data);
	const tags = firstAppearanceTags(data.units);
	if (tags.length === 0) {
		return "";
	}
	const chips = tags
		.map((tag) => {
			const count = counts.get(tag) ?? 0;
			return (
				`<button type="button" class="chip chip-filter" data-group="topic" data-value="${escapeHtml(tag)}" aria-pressed="false">` +
				`${escapeHtml(tag)} (${count})</button>`
			);
		})
		.join("");
	return `<div class="filter-group" data-role="filter-topic"><span class="filter-group-label">주제</span>${chips}</div>`;
}

function renderMentionFacetGroup(data: SessionData): string {
	if (data.members.length === 0) {
		return "";
	}
	const counts = countMentionMembers(data);
	const eligible = data.members.filter((member) => (counts.get(member.id) ?? 0) > 0);
	if (eligible.length === 0) {
		return "";
	}
	const chips = eligible
		.map((member) => {
			const count = counts.get(member.id) ?? 0;
			return (
				`<button type="button" class="chip chip-filter" data-group="mention" data-value="${escapeHtml(member.id)}" data-label="${escapeHtml(member.name)}" aria-pressed="false">` +
				`${escapeHtml(member.name)} (${count})</button>`
			);
		})
		.join("");
	return `<div class="filter-group" data-role="filter-mention"><span class="filter-group-label">언급 선수</span>${chips}</div>`;
}

function renderFilterBar(data: SessionData): string {
	const groups = [renderPositionFacetGroup(data), renderTopicFacetGroup(data), renderMentionFacetGroup(data)]
		.filter((html) => html !== "")
		.join("");
	return (
		`<details class="filter-bar">` +
		`<summary><span class="filter-summary-label">필터 (<span id="filter-count-label">0</span>)<span class="filter-summary-detail"></span></span></summary>` +
		`<div class="filter-groups">${groups}</div>` +
		`<button type="button" class="filter-reset">초기화</button>` +
		`</details>`
	);
}

// ── TOC tabs (DESIGN.md §8) ──────────────────────────────────────────────

function tocItemAttrs(unit: SessionUnit): string {
	return (
		`data-target="${escapeHtml(unit.id)}" ` +
		`data-pos="${escapeHtml(posClosure(unit.position_tags).join("|"))}" ` +
		`data-topics="${escapeHtml(unit.topic_tags.join("|"))}" ` +
		`data-member-ids="${escapeHtml(unit.member_ids.join("|"))}" ` +
		`data-related-ids="${escapeHtml(unit.related_member_ids.join("|"))}"`
	);
}

/** TOC item label: time chip (non-interactive, TOC click never seeks — DESIGN §8) + title. */
function tocItemLabel(unit: SessionUnit): string {
	return `${chip("chip-time", formatTime(unit.start))} ${unitTitleHtml(unit.title)}`;
}

function renderTabMatch(data: SessionData): string {
	const unitById = new Map(data.units.map((unit) => [unit.id, unit]));
	const groups = data.matches
		.map((match) => {
			const topics = match.topics
				.map((topic) => {
					const items = topic.unit_ids
						.map((unitId) => unitById.get(unitId))
						.filter((unit): unit is SessionUnit => unit !== undefined)
						.map(
							(unit) =>
								`<li><a class="toc-item" href="#${escapeHtml(unit.id)}" ${tocItemAttrs(unit)}>${tocItemLabel(unit)}</a></li>`,
						)
						.join("");
					return (
						`<div class="toc-topic-group"><h3>${escapeHtml(topic.title)}</h3>` +
						`<p class="toc-summary">${escapeHtml(topic.summary)}</p>` +
						`<ul>${items}</ul></div>`
					);
				})
				.join("");
			return `<div class="toc-match-group"><h2>${escapeHtml(match.title)}</h2>${topics}</div>`;
		})
		.join("");
	return `<div role="tabpanel" id="panel-match" aria-labelledby="tab-match">${groups}</div>`;
}

function renderTabTopic(data: SessionData): string {
	const tags = firstAppearanceTags(data.units);
	const groups = tags
		.map((tag) => {
			const units = data.units.filter((unit) => unit.topic_tags.includes(tag));
			const items = units
				.map(
					(unit) =>
						`<li><a class="toc-item" href="#${escapeHtml(unit.id)}" ${tocItemAttrs(unit)}>${tocItemLabel(unit)}</a></li>`,
				)
				.join("");
			return (
				`<div class="toc-tag-group"><h2>${escapeHtml(tag)} (${units.length})</h2>` + `<ul>${items}</ul></div>`
			);
		})
		.join("");
	return `<div role="tabpanel" id="panel-topic" aria-labelledby="tab-topic" hidden>${groups}</div>`;
}

/**
 * Wrapped in a JS-driven toggle (not `<details>`) so mobile can collapse it below "내 피드백"
 * (DESIGN §4) while desktop always shows it. `<details>` was tried first, but Chromium hides a
 * closed `<details>`'s content via an internal `content-visibility: hidden` that author CSS
 * cannot re-show on its children — so a desktop-always-open override via CSS alone leaves the
 * tabs unclickable (real layout rect, but not hit-testable). `[hidden]` has no such lock: it is
 * plain `display: none` in the UA sheet, safely overridden by an ordinary author rule.
 */
function renderToc(data: SessionData): string {
	const toc =
		`<div class="toc">` +
		`<div role="tablist">` +
		`<button type="button" role="tab" id="tab-match" aria-selected="true" aria-controls="panel-match">경기별</button>` +
		`<button type="button" role="tab" id="tab-topic" aria-selected="false" aria-controls="panel-topic">주제별</button>` +
		`</div>` +
		renderTabMatch(data) +
		renderTabTopic(data) +
		`</div>`;
	return (
		`<div class="toc-collapsible">` +
		`<button type="button" class="toc-toggle" aria-expanded="false" aria-controls="toc-panel">목차</button>` +
		`<div class="toc-panel" id="toc-panel" hidden>${toc}</div>` +
		`</div>`
	);
}

// ── player + part switch (DESIGN.md §4, §9) ──────────────────────────────

function renderPlayerWrapper(data: SessionData): string {
	const initial = data.videos[0];
	const initialId = initial?.id ?? "";
	const initialEmbeddable = initial?.embeddable ?? false;
	const multiPart = data.videos.length > 1;
	const miniBarPrefix = multiPart && initial !== undefined ? `Part ${initial.part} · ` : "";
	return (
		`<div class="player-wrapper">` +
		`<div class="player-media" id="player-media">` +
		`<div id="yt-player" data-video="${escapeHtml(initialId)}" data-embeddable="${initialEmbeddable ? "true" : "false"}"${initialEmbeddable ? "" : " hidden"}></div>` +
		`<div class="player-placeholder"${initialEmbeddable ? " hidden" : ""}>` +
		`<p>이 영상은 임베드를 지원하지 않습니다.</p>` +
		`<a class="player-placeholder-link" href="https://youtu.be/${escapeHtml(initialId)}?t=0" target="_blank" rel="noopener">유튜브에서 시청 ↗</a>` +
		`</div>` +
		`<div class="player-mini-bar"><span class="player-mini-bar-text">▶ ${escapeHtml(miniBarPrefix)}0:00</span></div>` +
		`</div>` +
		`<button type="button" class="player-collapse" aria-expanded="true" aria-controls="player-media">플레이어 접기</button>` +
		`</div>`
	);
}

function renderPartSwitch(data: SessionData): string {
	if (data.videos.length <= 1) {
		return "";
	}
	const buttons = data.videos
		.map(
			(video, index) =>
				`<button type="button" class="part-btn" data-video="${escapeHtml(video.id)}" data-embeddable="${video.embeddable ? "true" : "false"}" aria-pressed="${index === 0 ? "true" : "false"}">Part ${video.part}</button>`,
		)
		.join("");
	return `<div class="part-switch">${buttons}</div>`;
}

// ── card (DESIGN.md §5) ──────────────────────────────────────────────────

interface CardContext {
	matchById: Map<string, SessionMatch>;
	topicById: Map<string, SessionTopic>;
	videoById: Map<string, SessionVideoInfo>;
	multiPart: boolean;
	members: SessionMemberInfo[];
}

function renderCardHead(unit: SessionUnit, ctx: CardContext): string {
	const video = ctx.videoById.get(unit.video);
	const partChip = ctx.multiPart && video !== undefined ? chip("chip-part", `P${video.part}`) : "";
	const match = ctx.matchById.get(unit.match_id);
	const topic = ctx.topicById.get(unit.topic_id);
	const breadcrumb =
		match !== undefined && topic !== undefined
			? `<span class="breadcrumb">${escapeHtml(match.title)}<span aria-hidden="true"> › </span>${escapeHtml(topic.title)}</span>`
			: "";
	return `<div class="card-head">` + seekTimeButton(unit.start) + partChip + breadcrumb + `</div>`;
}

const MAX_CHIP_ROW_TAGS = 6;

/** Position + topic chips only, capped at 6 with a "+N" overflow chip — `@멘션` moved to its own line (DESIGN §5 item 5/6). */
function renderChipRow(unit: SessionUnit): string {
	const tags = [
		...unit.position_tags.map((tag) => ({ cls: positionChipClass(tag), label: tag })),
		...unit.topic_tags.map((tag) => ({ cls: "chip-topic", label: tag })),
	];
	const shown = tags.slice(0, MAX_CHIP_ROW_TAGS);
	const overflow = tags.length - shown.length;
	const chips = shown.map((tag) => chip(tag.cls, tag.label)).join("");
	const overflowChip =
		overflow > 0
			? `<span class="chip chip-overflow" aria-label="추가 태그 ${overflow}개">+${overflow}</span>`
			: "";
	return `<div class="chip-row">${chips}${overflowChip}</div>`;
}

/** A member name wrapped for the "내 피드백" name highlight (DESIGN §5 "내 피드백 상태의 이름 강조") — unstyled by default, `.mine` is toggled by VIEWER_JS. */
function renderMemberNameMark(id: string, name: string): string {
	return `<mark class="member-name" data-member-id="${escapeHtml(id)}">${escapeHtml(name)}</mark>`;
}

function renderMentionedLine(unit: SessionUnit, members: readonly SessionMemberInfo[]): string {
	if (unit.member_ids.length === 0) {
		return "";
	}
	const names = unit.member_ids.map((id) => renderMemberNameMark(id, memberName(members, id))).join(", ");
	return `<p class="mentioned-members">언급: ${names}</p>`;
}

/** `relatedMembers(unit) \ member_ids` — the set difference DESIGN §5 item 8 requires (already-shown mentions aren't repeated). */
function renderRelatedLine(unit: SessionUnit, members: readonly SessionMemberInfo[]): string {
	const ids = unit.related_member_ids.filter((id) => !unit.member_ids.includes(id));
	if (ids.length === 0) {
		return "";
	}
	const names = ids.map((id) => renderMemberNameMark(id, memberName(members, id))).join(", ");
	return `<p class="related-members">관련: ${names}</p>`;
}

/** A body text block: glue bound constructions, escape, then turn only `boldSpans` bold segments into `<strong>` (DESIGN §5 item 7/§10). */
function renderBodyText(text: string): string {
	const html = boldSpans(glueKorean(text))
		.map((span) => (span.bold ? `<strong>${escapeHtml(span.text)}</strong>` : escapeHtml(span.text)))
		.join("");
	return `<p>${html}</p>`;
}

/**
 * A body frame: figure+figcaption with a time chip and a "확대" new-tab link, `data-frame-t`
 * read by VIEWER_JS's click-to-seek (DESIGN §5 item 7). The caption text sits in its own
 * `.body-frame-caption` span so the figcaption's grid (time chip | caption | 확대, §15-10) can
 * size and wrap the middle column independently — without it, a long caption's own text node
 * would be the layout's only wrappable unit and could push the time chip or "확대" onto their
 * own lines instead of staying pinned to the row's edges.
 */
function renderBodyFrame(block: UnitBodyFrameBlock): string {
	const caption = glueKorean(block.caption);
	return (
		`<figure class="body-frame" data-frame-t="${block.t}">` +
		`<img src="${escapeHtml(block.src)}" width="${block.width}" height="${block.height}" loading="lazy" alt="${escapeHtml(caption)}">` +
		`<figcaption>${seekTimeButton(block.t)}<span class="body-frame-caption">${escapeHtml(caption)}</span>` +
		`<a href="${escapeHtml(block.src)}" target="_blank" rel="noopener" class="zoom-link" aria-label="이미지 원본 크게 보기">확대</a></figcaption>` +
		`</figure>`
	);
}

function renderBody(body: UnitBodyBlock[]): string {
	const blocks = body
		.map((block) => (block.type === "text" ? renderBodyText(block.text) : renderBodyFrame(block)))
		.join("");
	return `<div class="card-body">${blocks}</div>`;
}

function renderSimilarList(similar: UnitSimilar[]): string {
	if (similar.length === 0) {
		return "";
	}
	const items = similar
		.map(
			(entry) =>
				`<li><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.title)}</a> · <span class="similar-date">${escapeHtml(entry.date)}</span></li>`,
		)
		.join("");
	return `<ul class="similar-list">${items}</ul>`;
}

function renderRefsList(refs: UnitRef[]): string {
	if (refs.length === 0) {
		return "";
	}
	const items = refs
		.map((ref) => {
			const summaryLink =
				ref.lang !== "ko" && ref.href !== null ? `<a href="${escapeHtml(ref.href)}">요약</a> ` : "";
			return (
				`<li>${escapeHtml(ref.title)} ` +
				`<span class="ref-badges"><span class="badge">${escapeHtml(ref.kind)}</span>` +
				`<span class="badge">${escapeHtml(ref.lang.toUpperCase())}</span></span> ` +
				summaryLink +
				`<a href="${escapeHtml(ref.orig_url)}" target="_blank" rel="noopener">원문 ↗</a>` +
				`</li>`
			);
		})
		.join("");
	return `<ul class="refs-list">${items}</ul>`;
}

/**
 * Representative start image (DESIGN §5 item 4): same "확대" new-tab-to-source affordance as a
 * body frame (item 7), excluded from seek by the existing `interactive`/`a` guard in
 * `onCardListClick` — no VIEWER_JS change needed. Clicking the image itself still seeks to the
 * card's start time (no `.body-frame`/`data-frame-t` on this figure). `tagsHtml` (the tag row,
 * item 5) shares this figure's caption row with "확대" — tags left, link right — instead of
 * sitting on its own line below: the two were previously two stacked rows with the link alone
 * above the tags.
 */
function renderStartImage(image: UnitStartImage, tagsHtml: string): string {
	return (
		`<figure class="card-image">` +
		`<img src="${escapeHtml(image.src)}" width="${image.width}" height="${image.height}" alt="">` +
		`<figcaption>${tagsHtml}` +
		`<a href="${escapeHtml(image.src)}" target="_blank" rel="noopener" class="zoom-link" aria-label="이미지 원본 크게 보기">확대</a></figcaption>` +
		`</figure>`
	);
}

/** Groups similar/refs (items 9/10) as one visually-separated metadata block below the body (item 6) — "" when both are empty, so no bare separator renders. */
function renderMetaBlock(unit: SessionUnit): string {
	const similar = renderSimilarList(unit.similar);
	const refs = renderRefsList(unit.refs);
	if (similar === "" && refs === "") {
		return "";
	}
	return `<div class="card-meta">${similar}${refs}</div>`;
}

/** Card field order per DESIGN §5: header → title → mention badge → image → tag row → mentioned members → body → related members → similar → refs → watch link. */
function renderCard(unit: SessionUnit, ctx: CardContext): string {
	const video = ctx.videoById.get(unit.video);
	const hasRoster = ctx.members.length > 0;
	return (
		`<article class="card" id="${escapeHtml(unit.id)}" ` +
		`data-video="${escapeHtml(unit.video)}" data-start="${unit.start}" ` +
		`data-pos="${escapeHtml(posClosure(unit.position_tags).join("|"))}" ` +
		`data-topics="${escapeHtml(unit.topic_tags.join("|"))}" ` +
		`data-member-ids="${escapeHtml(unit.member_ids.join("|"))}" ` +
		`data-related-ids="${escapeHtml(unit.related_member_ids.join("|"))}" ` +
		`data-embeddable="${(video?.embeddable ?? true) ? "true" : "false"}">` +
		renderCardHead(unit, ctx) +
		`<h3>${unitTitleHtml(unit.title)}</h3>` +
		(hasRoster ? `<p class="mention-badge" hidden></p>` : "") +
		renderStartImage(unit.images.start, renderChipRow(unit)) +
		(hasRoster ? renderMentionedLine(unit, ctx.members) : "") +
		renderBody(unit.body) +
		(hasRoster ? renderRelatedLine(unit, ctx.members) : "") +
		renderMetaBlock(unit) +
		`<a class="watch-link" href="${escapeHtml(unit.watch_url)}" target="_blank" rel="noopener">유튜브에서 보기 ↗</a>` +
		`</article>`
	);
}

// ── shared page shell ────────────────────────────────────────────────────

function pageShell(title: string, bodyAttrs: string, bodyHtml: string, scripts: string): string {
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body${bodyAttrs}>
${bodyHtml}
${scripts}</body>
</html>
`;
}

const FOOTER_NOTICE = "팀 내부 피드백용 비공식 정리 문서입니다. 영상 저작권은 원게시자에게 있습니다.";

// ── renderSession (DESIGN.md §4–§11) ──────────────────────────────────────

export function renderSession(data: SessionData): string {
	const matchById = new Map(data.matches.map((match) => [match.id, match]));
	const topicById = new Map(data.matches.flatMap((match) => match.topics.map((topic) => [topic.id, topic])));
	const videoById = new Map(data.videos.map((video) => [video.id, video]));
	const ctx: CardContext = {
		matchById,
		topicById,
		videoById,
		multiPart: data.videos.length > 1,
		members: data.members,
	};

	const total = data.units.length;
	const cards = data.units.map((unit) => renderCard(unit, ctx)).join("");

	const sideCol =
		`<div class="side-col">` +
		renderPlayerWrapper(data) +
		`<aside class="side">${renderPartSwitch(data)}<div class="toc-scroll">${renderToc(data)}</div></aside>` +
		`</div>`;

	const main =
		`<div class="main">` +
		renderMyFeedbackNav(data) +
		renderFilterBar(data) +
		`<div class="active-filters" hidden></div>` +
		`<p class="result-count">피드백 <span id="visible-count">${total}</span>/<span id="total-count">${total}</span></p>` +
		`<div class="card-list">${cards}</div>` +
		`<p class="empty-state" hidden>조건에 맞는 피드백이 없어요 <button type="button" class="filter-reset">초기화</button></p>` +
		`</div>`;

	const body =
		`<header class="header"><h1>${wrapNobr(escapeHtml(data.title))}</h1><p class="date">${escapeHtml(data.date)}</p></header>` +
		`<div class="layout">${sideCol}${main}</div>` +
		`<footer class="footer"><p>${escapeHtml(FOOTER_NOTICE)}</p></footer>`;

	const scripts =
		`<script>${VIEWER_JS}</script>\n` + `<script src="https://www.youtube.com/iframe_api" async></script>\n`;

	return pageShell(data.title, ` data-video="${escapeHtml(data.videos[0]?.id ?? "")}"`, body, scripts);
}

// ── renderIndex (DESIGN.md §12) ──────────────────────────────────────────

function renderSessionCard(entry: IndexSessionEntry): string {
	const tags = entry.topic_tags.map((tag) => chip("chip-topic", tag)).join("");
	return (
		`<a class="session-card" href="${escapeHtml(entry.href)}">` +
		`<p class="date">${escapeHtml(entry.date)}</p>` +
		`<h2>${wrapNobr(escapeHtml(entry.title))}</h2>` +
		`<p class="meta">${entry.videos}파트 · 피드백 ${entry.unit_count}개</p>` +
		`<div class="topic-tags">${tags}</div>` +
		`</a>`
	);
}

/**
 * Group headings render at the H3 scale (DESIGN §2), one level below this section's own H2 —
 * previously both were `<h2>`, so a group title read with the same weight as the section title
 * right above it. `#by-topic ul` gets the session TOC's own list language (no bullets,
 * `.toc-item`'s muted/no-underline styling, `--space-1` row gap) — the bare `<ul>` had no
 * ancestor `.toc` to pick up `.toc ul`'s reset, so it fell through to the browser default
 * (bullets, ~40px indent), which is what read as unstyled default HTML.
 */
function renderIndexByTopic(index: ArchiveIndex): string {
	if (index.units.length === 0) {
		return "";
	}
	const tags = firstAppearanceTags(index.units);
	const groups = tags
		.map((tag) => {
			const units = index.units.filter((unit) => unit.topic_tags.includes(tag));
			const items = units
				.map((unit) => `<li><a class="toc-item" href="${escapeHtml(unit.href)}">${escapeHtml(unit.title)}</a></li>`)
				.join("");
			return `<div class="toc-tag-group"><h3>${escapeHtml(tag)} (${units.length})</h3><ul>${items}</ul></div>`;
		})
		.join("");
	return `<section id="by-topic"><h2>주제별 전체 피드백</h2>${groups}</section>`;
}

export function renderIndex(index: ArchiveIndex): string {
	// The jump link sits above the session grid, not directly over `#by-topic`'s own H2 of the
	// same text — the two used to sit back to back and read as one heading repeated twice;
	// separated by the whole session grid, the link now reads as ordinary top-of-page
	// navigation and the section below keeps its own landmark heading.
	const body =
		index.sessions.length === 0
			? `<p class="empty-state">아직 발행된 세션이 없어요.</p>`
			: `<p class="plain-link"><a href="#by-topic">주제별 전체 피드백</a></p>` +
				`<div class="session-grid">${index.sessions.map(renderSessionCard).join("")}</div>` +
				renderIndexByTopic(index);

	const html =
		`<main class="archive-main">` +
		`<h1>fc-feedback 아카이브</h1>` +
		body +
		`<footer class="footer"><p>${escapeHtml(FOOTER_NOTICE)}</p></footer>` +
		`</main>`;

	return pageShell("fc-feedback 아카이브", "", html, "");
}

// ── renderRef (DESIGN.md §12) ─────────────────────────────────────────────

const MAX_TRANSLATION_ROWS = 5;

export function renderRef(ref: RefPageData): string {
	const keyPoints = ref.key_points_ko.map((point) => `<li>${escapeHtml(point)}</li>`).join("");
	const rows = ref.translations
		.slice(0, MAX_TRANSLATION_ROWS)
		.map((row) => `<tr><td>${escapeHtml(row.orig)}</td><td>${escapeHtml(row.ko)}</td></tr>`)
		.join("");

	const html =
		`<main class="ref-main">` +
		`<h1>${wrapNobr(escapeHtml(ref.title))}</h1>` +
		`<p class="ref-badges"><span class="badge">${escapeHtml(ref.kind)}</span>` +
		`<span class="badge">${escapeHtml(ref.lang.toUpperCase())}</span></p>` +
		`<p class="plain-link"><a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener">원문 ↗</a></p>` +
		`<p class="summary-ko">${escapeHtml(ref.summary_ko)}</p>` +
		(keyPoints ? `<ul class="key-points">${keyPoints}</ul>` : "") +
		(rows
			? `<table class="translations-table"><thead><tr><th>원문</th><th>한국어</th></tr></thead><tbody>${rows}</tbody></table>`
			: "") +
		`<p class="plain-link"><a href="../index.html">아카이브로 돌아가기</a></p>` +
		`</main>`;

	return pageShell(ref.title, "", html, "");
}

// ── STYLE (DESIGN.md §2 tokens, §3 breakpoints, §4 layout, §13 a11y) ────────

export const STYLE = `
:root {
  --bg: #FFFFFF; --surface: #F6F8F7; --surface-sunken: #EFF2F0;
  --ink: #14181C; --muted: #57606A;
  --line: #E3E6E8; --line-strong: #838B93;
  --accent: #1E7A46; --accent-hover: #145C34; --mine-tint: #E3F3E9; --focus: #1E7A46;
  --pos-gk-bg: #FDF1D8; --pos-gk-fg: #8A5A00;
  --pos-df-bg: #E4EEFC; --pos-df-fg: #1451B0;
  --pos-mf-bg: #E7F0EE; --pos-mf-fg: #0F6B5C;
  --pos-fw-bg: #FBE7E4; --pos-fw-fg: #B23A2E;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px;
  --radius-sm: 8px; --radius-md: 12px; --radius-full: 9999px;
  --measure: 660px; --archive-measure: 960px;
  --content-max: calc(420px + var(--space-6) + var(--measure));
  --player-control-bg: rgba(255,255,255,0.9);
  --sticky-player-h: 0px;
}
* { box-sizing: border-box; }
html, body { background: var(--bg); color: var(--ink); }
/* Body token (§2) as the page default, not just .card-body p's own rule below — so any
   selector this file forgets to size explicitly computes to a real §2 value instead of the
   untokened UA default (§15-2), verified by grepping STYLE for every rendered class. */
body {
  margin: 0;
  font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
  font-size: 1.0625rem;
  line-height: 1.7;
  word-break: keep-all; overflow-wrap: anywhere; line-break: strict;
}
h1, h2, h3 { text-wrap: balance; word-break: keep-all; overflow-wrap: anywhere; line-break: strict; margin: 0 0 var(--space-2); font-weight: 700; }
.nobr { white-space: nowrap; }
p, dd, li, figcaption { text-wrap: pretty; word-break: keep-all; overflow-wrap: anywhere; line-break: strict; }
h1 { font-size: 1.75rem; line-height: 1.3; }
h2 { font-size: 1.375rem; line-height: 1.35; }
h3 { font-size: 1.25rem; line-height: 1.4; }
a { color: var(--accent); }
a:hover { color: var(--accent-hover); }
/* Caption (§2), matching .toc-item — ref page's plain nav links and the archive's
   "주제별 전체 피드백" link would otherwise inherit the Body default above (§15-2). */
.plain-link { font-size: 0.875rem; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
button { font: inherit; color: inherit; background: none; border: none; }
img { display: block; max-width: 100%; height: auto; border-radius: var(--radius-sm); }

.header, .footer { max-width: var(--content-max); margin: 0 auto; padding-left: var(--space-6); padding-right: var(--space-6); }
.header { padding-top: var(--space-6); }
.header .date { color: var(--muted); font-size: 0.8125rem; margin: 0; }
.footer { padding: var(--space-8) var(--space-6); color: var(--muted); font-size: 0.8125rem; }
.archive-main > .footer { padding: var(--space-8) 0 0; }

.layout { display: flex; align-items: flex-start; gap: var(--space-6); max-width: var(--content-max); margin: 0 auto; padding: var(--space-6); }

.side-col { flex: 0 0 min(420px, 40%); position: sticky; top: var(--space-6);
  max-height: calc(100dvh - var(--space-6) * 2);
  display: flex; flex-direction: column; gap: var(--space-4); }
.player-wrapper { flex-shrink: 0; width: 100%; aspect-ratio: 16 / 9; position: relative;
  background: var(--ink); border-radius: var(--radius-sm); overflow: hidden;
  box-shadow: 0 2px 8px rgba(20,24,28,0.08); }
.player-media { position: absolute; inset: 0; }
#yt-player, .player-media iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
#yt-player[hidden] { display: none; }
.player-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2); color: var(--bg); text-align: center; padding: var(--space-4); }
.player-placeholder[hidden] { display: none; }
/* The generic a{color:var(--accent)} rule fails contrast on this dark background
   (DESIGN §15-9) — --bg is already documented for white text over ink/accent (§2). */
.player-placeholder-link { color: var(--bg); font-weight: 600; text-decoration: underline; }
.player-mini-bar { position: absolute; inset: 0; display: none; align-items: center; padding: 0 var(--space-3); color: var(--bg); font-size: 0.8125rem; font-weight: 600; background: var(--ink); }
.player-collapse { display: none; }

.side { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--space-4); }
.part-switch { flex-shrink: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
.part-btn { min-height: 44px; padding: var(--space-2) var(--space-3); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--surface); font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.part-btn[aria-pressed="true"] { background: var(--accent); color: var(--bg); border-color: var(--accent); }

.toc-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
/* Full-width row matching the closed filter bar's row (DESIGN §7/§8/§13) — only ever
   visible below 1024px (the ≥1024px override further down hides it), so this rule needs
   no separate mobile-only copy of its own. */
.toc-toggle { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
  width: 100%; min-height: 44px; padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md); border: 1px solid var(--line-strong); background: var(--surface);
  font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.toc-toggle::after { content: "▾"; color: var(--muted); flex-shrink: 0; }
.toc-toggle[aria-expanded="true"]::after { content: "▴"; }
.toc [role="tablist"] { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--line); }
.toc [role="tab"] { min-height: 44px; padding: var(--space-2) var(--space-3); font-size: 0.8125rem; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 1px solid transparent; }
.toc [role="tab"][aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.toc [role="tabpanel"][hidden] { display: none; }
.toc-topic-group, .toc-tag-group, .toc-match-group { margin: var(--space-6) 0 0; }
.toc-topic-group[hidden], .toc-tag-group[hidden], .toc-match-group[hidden] { display: none; }
.toc-summary { font-size: 0.875rem; color: var(--muted); margin: var(--space-1) 0 var(--space-2); }
/* Shared with the archive's #by-topic list (DESIGN §12), which has no .toc ancestor of its own
   but reuses the same group/list classes and needs the same reset — without it the bare <ul>
   fell through to the browser default (bullets, ~40px indent). */
.toc ul, #by-topic ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.toc-item { display: block; min-height: 44px; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); font-size: 0.875rem; color: var(--muted); text-decoration: none; }
.toc-item .chip-time { margin-right: var(--space-2); }
.toc-item:hover, .toc-item:focus-visible, .toc-item.is-current { color: var(--accent); text-decoration: underline; }
.toc-item[hidden] { display: none; }

.main { flex: 1 1 auto; min-width: 0; max-width: var(--measure); display: flex; flex-direction: column; gap: var(--space-8); }

.my-feedback { display: flex; flex-direction: column; gap: var(--space-2); }
.my-feedback-label { font-size: 0.8125rem; font-weight: 700; }
.my-feedback-row { display: flex; gap: var(--space-2); overflow-x: auto; white-space: nowrap; padding-bottom: var(--space-1); }
/* role="listitem" wrapper (DESIGN §6/§13) — display:contents would drop the box
   these tests inspect, so it stays an ordinary inline-flex item instead. */
.my-feedback-row [role="listitem"] { display: inline-flex; flex-shrink: 0; }
.pill { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 44px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--bg); font-size: 0.8125rem; font-weight: 600; cursor: pointer; flex-shrink: 0; }
.pill .count { color: var(--muted); }
.pill[aria-pressed="true"] { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.pill[aria-pressed="true"] .count { color: var(--bg); }

/* Padding lives on the summary (both states) and only on .filter-groups/.filter-reset
   when open (DESIGN §7) — a closed filter bar is a single compact row on every width. */
.filter-bar { background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius-md); }
.filter-bar summary { cursor: pointer; font-size: 0.8125rem; font-weight: 600; min-height: 44px;
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
  list-style: none; padding: var(--space-3) var(--space-4); }
.filter-bar summary::-webkit-details-marker { display: none; }
.filter-bar summary::after { content: "▾"; color: var(--muted); flex-shrink: 0; }
.filter-bar[open] summary::after { content: "▴"; }
.filter-summary-detail { color: var(--muted); font-weight: 400; margin-left: var(--space-1); }
.filter-bar[open] { padding: 0 var(--space-4) var(--space-4); }
.filter-groups { display: flex; flex-direction: column; gap: var(--space-3); }
.filter-group-label { display: block; font-size: 0.8125rem; font-weight: 600; color: var(--muted); margin-bottom: var(--space-2); }
.chip { display: inline-flex; align-items: center; padding: var(--space-1) var(--space-3); margin: var(--space-1); border-radius: var(--radius-full); font-size: 0.8125rem; font-weight: 600; color: var(--ink); background: var(--surface-sunken); white-space: nowrap; flex-shrink: 0; }
.chip-filter { min-height: 44px; border: 1px solid var(--line-strong); cursor: pointer; background: var(--bg); }
.chip-filter[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); }
/* Position tree root (GK/DF/MF/FW) vs. child (DESIGN §15-5/§15-10 "구분 안 되는 트리"):
   bolder weight + the same neutral fill used elsewhere for a filled-but-inactive chip
   (--surface-sunken, §2) reads as "this is a group", not a second accent color — the
   pressed rule above still wins on specificity so an active state looks the same either way. */
.chip-pos-root { font-weight: 700; background: var(--surface-sunken); }
/* Nested position nodes wrap within the viewport instead of forcing a fixed-width single
   line off-screen (DESIGN §7/§15-5); chip margin is reset per node since the tree's own
   gap already spaces siblings — keeping both would double the gap (DESIGN §2). */
/* Each root is its own row — .pos-tree stacks branches in a column instead of letting every
   root/child chip wrap into one mixed flow ("MF-CDM-CM-FW-ST-CF-LW" reading as a single line
   at 1440px). */
.pos-tree { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; max-width: 100%; }
.pos-node { display: inline-flex; align-items: center; min-width: 0; max-width: 100%; }
.pos-node .chip { margin: 0; }
/* Two-column row: the branch's own chip in a fixed-width left column, its children wrapping in
   the right column — applied identically at every nesting depth, so a nested branch (e.g. FB's
   own LB/RB/LWB/RWB row inside DF's children) reads with the same rule and indent as a root
   branch, not a special case. */
.pos-node--branch { display: grid; grid-template-columns: minmax(64px, max-content) minmax(0, 1fr); align-items: start; gap: var(--space-2); width: 100%; }
.pos-children { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); min-width: 0; max-width: 100%; }
.chip-overflow { color: var(--muted); }
.filter-reset { min-height: 44px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--bg); font-size: 0.8125rem; font-weight: 600; cursor: pointer; margin-top: var(--space-3); }

.active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.active-filters[hidden] { display: none; }
.active-filters .filter-reset { margin-top: 0; }
.chip-active { gap: var(--space-1); }
.chip-remove { font-size: 0.875rem; line-height: 1; cursor: pointer; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }

.result-count { font-size: 0.8125rem; color: var(--muted); margin: 0; }

.card-list { display: flex; flex-direction: column; gap: var(--space-6); }
/* 30-second criterion (DESIGN §6): direct-mention cards float above position-related ones
   via flex order, not DOM reordering; flex's sort is stable so each group stays in its
   original chronological order. */
.card-list.mine-active .card:not(.is-direct) { order: 1; }
.card { background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-4); cursor: pointer; scroll-margin-top: var(--space-4); }
.card[hidden] { display: none; }
.card--highlighted { border-color: var(--accent); border-width: 2px; }
.card-head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2); }
.chip-time, .chip-part { background: var(--surface-sunken); }
/* Keyboard-reachable seek control (DESIGN §5/§13): keeps the chip's small visual
   footprint while expanding its hit area to the 44px minimum via an invisible
   centered pseudo-element, instead of inflating the compact header row's own size. */
.seek-btn { cursor: pointer; position: relative; }
.seek-btn::after { content: ""; position: absolute; top: 50%; left: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
.breadcrumb { color: var(--muted); font-size: 0.8125rem; }
.card-image { margin: var(--space-3) 0 0; }
.card-image img { width: 100%; height: auto; border: 1px solid var(--line); }
/* Tags (left) + 확대 (right) share one row instead of stacking on two — the tag box wraps
   within its own space; 확대 keeps its fixed width via .zoom-link's own flex-shrink:0 below. */
.card-image figcaption { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); font-size: 0.875rem; font-weight: 500; color: var(--muted); margin-top: var(--space-2); }
.card-image figcaption .chip-row { margin: 0; min-width: 0; }
.mention-badge { display: inline-block; margin: var(--space-2) 0 0; padding: var(--space-1) var(--space-3); border-radius: var(--radius-full); font-size: 0.8125rem; font-weight: 600; }
.mention-badge[hidden] { display: none; }
.mention-badge.mention-direct { background: var(--accent); color: var(--bg); }
.mention-badge.mention-related { background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
.chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0; }
.chip-pos-gk { background: var(--pos-gk-bg); color: var(--pos-gk-fg); }
.chip-pos-df { background: var(--pos-df-bg); color: var(--pos-df-fg); }
.chip-pos-mf { background: var(--pos-mf-bg); color: var(--pos-mf-fg); }
.chip-pos-fw { background: var(--pos-fw-bg); color: var(--pos-fw-fg); }
.mentioned-members, .related-members { font-size: 0.8125rem; color: var(--muted); margin: var(--space-2) 0 0; }
.member-name { background: none; color: inherit; padding: 0; border-radius: 0; font-weight: inherit; }
.member-name.mine { background: var(--mine-tint); border-radius: var(--radius-sm); padding: 0 var(--space-1); font-weight: 600; }

/* Resets first, spacing second (DESIGN §5 "본문 간격"): .card-body > p + p / > * +
   .body-frame / > .body-frame + * each carry a class or element more than the reset
   selectors they must beat, so the cascade wins by specificity, not by source order —
   except the two .body-frame rules below, which are equal-specificity and so do rely
   on appearing after their own reset (paragraph-to-paragraph 16px, anything-to-frame 24px). */
.card-body { margin-top: var(--space-3); display: flex; flex-direction: column; }
.card-body > p, .card-body > .body-frame { margin: 0; }
.card-body p { font-size: 1.0625rem; line-height: 1.7; }
.card-body p strong { font-weight: 700; color: inherit; }
.card-body > p + p { margin-top: var(--space-4); }
.card-body > * + .body-frame { margin-top: var(--space-6); }
.card-body > .body-frame + * { margin-top: var(--space-6); }
.card-body .body-frame { cursor: pointer; border-radius: var(--radius-sm); }
.card-body .body-frame img { width: 100%; height: auto; border-radius: var(--radius-sm); }
/* Grid, not flex-wrap: a flex row let the caption text node be the
   only wrap point, so depending on caption length the time chip / text / 확대 scattered across
   1-4 lines. The fixed edge columns (time chip left, 확대 right) never wrap — only the middle
   column does, via .body-frame-caption's own min-width:0 — so both controls stay pinned to the
   row's edges at any caption length, top-aligned (align-items:start) even across wrapped lines. */
.card-body .body-frame figcaption { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: var(--space-2); font-size: 0.875rem; font-weight: 500; color: var(--muted); margin-top: var(--space-2); }
.body-frame-caption { min-width: 0; }
.zoom-link { font-weight: 600; white-space: nowrap; flex-shrink: 0; }

/* Groups similar/refs as one metadata block, separated from the body above by a hairline
   (DESIGN §5 items 9/10, §15-10 "160px 넘는 빈 공백" is the opposite failure this guards
   against — this is a small, deliberate gap, not a blank run). */
.card-meta { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: var(--space-2); }
.similar-list, .refs-list { font-size: 0.875rem; margin: 0; }
.ref-badges { display: inline-flex; gap: var(--space-1); }
.badge { display: inline-block; background: var(--surface-sunken); color: var(--muted); font-size: 0.875rem; font-weight: 500; padding: var(--space-1) var(--space-2); border-radius: var(--radius-full); }
.similar-date { color: var(--muted); font-size: 0.875rem; }
/* margin-top (not conditional on .card-meta) reads as the card's own end block whether the
   previous sibling is .card-meta or .card-body directly — without it the link ran on right
   after the last paragraph as if it were part of it. */
.watch-link { display: inline-block; font-weight: 600; font-size: 0.8125rem; margin-top: var(--space-4); }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); text-align: center; font-size: 1.0625rem; color: var(--muted); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-8) var(--space-6); }
.empty-state[hidden] { display: none; }
.empty-state .filter-reset { margin-top: 0; }

/* Desktop (≥1024px): TOC stays always visible in the left column, ignoring the mobile
   toggle's [hidden] attribute — an ordinary author rule safely beats the UA's plain
   [hidden] display:none (unlike details, this has no content-visibility lock). */
@media (min-width: 1024px) {
  .toc-toggle { display: none; }
  .toc-panel[hidden] { display: block; }
}

@media (max-width: 1023.98px) {
  .layout { flex-direction: column; align-items: stretch; padding: var(--space-4); gap: var(--space-4); }
  .header, .footer { padding-left: var(--space-4); padding-right: var(--space-4); }
  .side-col { display: contents; }
  .side { display: contents; }
  .main { display: contents; }
  .player-wrapper { order: 1; position: sticky; top: 0; z-index: 10; aspect-ratio: auto; height: min(56.25vw, 200px); }
  .player-wrapper.is-collapsed { height: 44px; }
  .player-wrapper.is-collapsed .player-mini-bar { display: flex; }
  .player-collapse { display: block; position: absolute; right: var(--space-2); bottom: var(--space-2); z-index: 1;
    min-width: 44px; min-height: 44px; padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--player-control-bg); color: var(--ink); font-size: 0.8125rem; font-weight: 600; }
  .player-wrapper.is-collapsed .player-collapse { position: static; margin-left: auto; background: none; border: none; color: var(--bg); }
  .part-switch { order: 2; }
  .my-feedback { order: 3; }
  .filter-bar { order: 4; }
  .active-filters { order: 5; }
  .result-count { order: 6; }
  .card-list { order: 7; }
  .empty-state { order: 8; }
  .toc-scroll { order: 9; flex: 0 1 auto; overflow-y: visible; }
  .card { scroll-margin-top: calc(var(--sticky-player-h) + var(--space-4)); }
}

.archive-main, .ref-main { max-width: var(--archive-measure); margin: 0 auto; padding: var(--space-6) var(--space-4); }
.session-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-6); margin: var(--space-6) 0; }
/* The whole card is the link (DESIGN §5-style "카드 전체가 클릭 타깃"); accent/underline
   is reserved for the title on hover/focus so the card doesn't read as underlined body
   text everywhere (§15-10). */
.session-card { display: block; background: var(--bg); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); padding: var(--space-4); color: var(--ink); text-decoration: none; }
.session-card .date { color: var(--muted); font-size: 0.8125rem; margin: 0; }
.session-card .meta { color: var(--muted); font-size: 0.8125rem; }
.session-card h2 { text-decoration: none; }
.session-card:hover h2, .session-card:focus-visible h2 { color: var(--accent); text-decoration: underline; }
.topic-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-2); }
.summary-ko { font-size: 1.0625rem; line-height: 1.7; }
.key-points { font-size: 1.0625rem; line-height: 1.7; margin: var(--space-4) 0; }
.translations-table { width: 100%; border-collapse: collapse; margin: var(--space-4) 0; }
.translations-table th { font-size: 0.875rem; font-weight: 700; text-align: left; vertical-align: top; padding: var(--space-3); border: 0; border-bottom: 1px solid var(--line); }
.translations-table td { font-size: 1.0625rem; line-height: 1.7; text-align: left; vertical-align: top; padding: var(--space-3); border: 0; border-bottom: 1px solid var(--line); }
`;

// ── VIEWER_JS (DESIGN.md §5–§9) ──────────────────────────────────────────
//
// Static string, no interpolation. Reads only server-rendered `data-*`
// attributes. Session page loads this BEFORE the `iframe_api` script; init
// runs immediately when `window.YT && YT.loaded`, else it registers
// `window.onYouTubeIframeAPIReady` (DESIGN §9).

export const VIEWER_JS = `(function () {
  "use strict";

  // Tags may contain spaces (core.ts's isValidTag only forbids "|"), so the id/tag lists in
  // data-pos/data-topics/data-member-ids/data-related-ids are "|"-joined, not space-joined.
  function hasToken(value, token) {
    if (!value) return false;
    var parts = value.split("|");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === token) return true;
    }
    return false;
  }

  function anyToken(value, tokens) {
    if (!value) return false;
    var parts = value.split("|");
    for (var i = 0; i < parts.length; i++) {
      if (tokens.indexOf(parts[i]) !== -1) return true;
    }
    return false;
  }

  var selected = { position: null, topic: [], mention: null, mine: null };

  function elementMatches(el) {
    var pos = el.getAttribute("data-pos") || "";
    var topics = el.getAttribute("data-topics") || "";
    var memberIds = el.getAttribute("data-member-ids") || "";
    var relatedIds = el.getAttribute("data-related-ids") || "";
    if (selected.position && !hasToken(pos, selected.position)) return false;
    if (selected.topic.length > 0 && !anyToken(topics, selected.topic)) return false;
    if (selected.mention && !hasToken(memberIds, selected.mention)) return false;
    if (selected.mine && !hasToken(relatedIds, selected.mine)) return false;
    return true;
  }

  function mentionLabel(id) {
    var chipEl = document.querySelector('.chip-filter[data-group="mention"][data-value="' + id + '"]');
    return chipEl ? chipEl.getAttribute("data-label") || id : id;
  }

  function removeFilter(group, value) {
    if (group === "position") {
      selected.position = null;
      setSinglePressed("position", null);
    } else if (group === "topic") {
      var idx = selected.topic.indexOf(value);
      if (idx !== -1) selected.topic.splice(idx, 1);
      var chipEl = document.querySelector('.chip-filter[data-group="topic"][data-value="' + value + '"]');
      if (chipEl) chipEl.setAttribute("aria-pressed", "false");
    } else if (group === "mention") {
      selected.mention = null;
      setSinglePressed("mention", null);
    }
    applyFilters();
  }

  function appendActiveChip(container, group, value, label) {
    var span = document.createElement("span");
    span.className = "chip chip-active";
    span.appendChild(document.createTextNode(label));
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-remove";
    btn.setAttribute("aria-label", "필터 해제: " + label);
    btn.textContent = "\\u00D7";
    btn.addEventListener("click", function () {
      removeFilter(group, value);
    });
    span.appendChild(btn);
    container.appendChild(span);
  }

  function renderActiveFilters() {
    var container = document.querySelector(".active-filters");
    if (!container) return;
    container.textContent = "";
    var hasAny = false;
    if (selected.position) {
      appendActiveChip(container, "position", selected.position, "포지션: " + selected.position);
      hasAny = true;
    }
    for (var i = 0; i < selected.topic.length; i++) {
      appendActiveChip(container, "topic", selected.topic[i], "주제: " + selected.topic[i]);
      hasAny = true;
    }
    if (selected.mention) {
      appendActiveChip(container, "mention", selected.mention, "언급 선수: " + mentionLabel(selected.mention));
      hasAny = true;
    }
    if (hasAny) {
      var resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "filter-reset";
      resetBtn.textContent = "전체 해제";
      resetBtn.addEventListener("click", resetFilters);
      container.appendChild(resetBtn);
      container.removeAttribute("hidden");
    } else {
      container.setAttribute("hidden", "");
    }
  }

  function updateFilterSummary() {
    var countLabel = document.getElementById("filter-count-label");
    var detail = document.querySelector(".filter-summary-detail");
    var n = 0;
    var parts = [];
    if (selected.position) {
      n = n + 1;
      parts.push("포지션 " + selected.position);
    }
    if (selected.topic.length > 0) {
      n = n + 1;
      parts.push("주제 " + selected.topic.join(", "));
    }
    if (selected.mention) {
      n = n + 1;
      parts.push("언급 선수 " + mentionLabel(selected.mention));
    }
    if (countLabel) countLabel.textContent = String(n);
    if (detail) detail.textContent = parts.length > 0 ? " · " + parts.join(", ") : "";
  }

  // Also toggles .is-direct on each card and .mine-active on .card-list (DESIGN §6's
  // 30-second criterion): CSS order then floats direct-mention cards above position-related
  // ones while flex's stable sort keeps each group in its original chronological (DOM) order
  // — no DOM reordering. Clears both on deselect (mine falsy skips every classList.add call).
  function updateMentionBadgesAndMarks() {
    var mine = selected.mine;
    var cardList = document.querySelector(".card-list");
    if (cardList) {
      if (mine) cardList.classList.add("mine-active");
      else cardList.classList.remove("mine-active");
    }
    var cards = document.querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var isDirect = mine !== null && hasToken(card.getAttribute("data-member-ids") || "", mine);
      card.classList.toggle("is-direct", isDirect);
      var badge = card.querySelector(".mention-badge");
      if (badge) {
        if (isDirect) {
          badge.textContent = "직접 언급";
          badge.className = "mention-badge mention-direct";
          badge.removeAttribute("hidden");
        } else if (mine && hasToken(card.getAttribute("data-related-ids") || "", mine)) {
          badge.textContent = "포지션 관련(참고)";
          badge.className = "mention-badge mention-related";
          badge.removeAttribute("hidden");
        } else {
          badge.textContent = "";
          badge.className = "mention-badge";
          badge.setAttribute("hidden", "");
        }
      }
      var marks = card.querySelectorAll(".member-name");
      for (var j = 0; j < marks.length; j++) {
        if (mine && marks[j].getAttribute("data-member-id") === mine) {
          marks[j].classList.add("mine");
        } else {
          marks[j].classList.remove("mine");
        }
      }
    }
  }

  // Hides a TOC group heading (match/topic/tag) once none of its .toc-item children are
  // visible (DESIGN §8) — computed here rather than left to a CSS :has() selector so it
  // works the same regardless of :has() support.
  function hideEmptyTocGroups() {
    var groups = document.querySelectorAll(".toc-match-group, .toc-topic-group, .toc-tag-group");
    for (var i = 0; i < groups.length; i++) {
      var hasVisible = groups[i].querySelector(".toc-item:not([hidden])") !== null;
      if (hasVisible) {
        groups[i].removeAttribute("hidden");
      } else {
        groups[i].setAttribute("hidden", "");
      }
    }
  }

  function applyFilters() {
    var cards = document.querySelectorAll(".card");
    var visible = 0;
    for (var i = 0; i < cards.length; i++) {
      if (elementMatches(cards[i])) {
        cards[i].removeAttribute("hidden");
        visible = visible + 1;
      } else {
        cards[i].setAttribute("hidden", "");
      }
    }
    var tocItems = document.querySelectorAll(".toc-item");
    for (var j = 0; j < tocItems.length; j++) {
      if (elementMatches(tocItems[j])) {
        tocItems[j].removeAttribute("hidden");
      } else {
        tocItems[j].setAttribute("hidden", "");
      }
    }
    hideEmptyTocGroups();
    var visibleCountEl = document.getElementById("visible-count");
    if (visibleCountEl) visibleCountEl.textContent = String(visible);
    var cardList = document.querySelector(".card-list");
    var toc = document.querySelector(".toc");
    var emptyState = document.querySelector(".empty-state");
    var resultCount = document.querySelector(".result-count");
    if (visible === 0) {
      if (cardList) cardList.setAttribute("hidden", "");
      if (toc) toc.setAttribute("hidden", "");
      if (resultCount) resultCount.setAttribute("hidden", "");
      if (emptyState) emptyState.removeAttribute("hidden");
    } else {
      if (cardList) cardList.removeAttribute("hidden");
      if (toc) toc.removeAttribute("hidden");
      if (resultCount) resultCount.removeAttribute("hidden");
      if (emptyState) emptyState.setAttribute("hidden", "");
    }
    updateMentionBadgesAndMarks();
    renderActiveFilters();
    updateFilterSummary();
  }

  function setSinglePressed(group, value) {
    var chips = document.querySelectorAll('.chip-filter[data-group="' + group + '"]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", chips[i].getAttribute("data-value") === value ? "true" : "false");
    }
  }

  function onChipClick(event) {
    var chipEl = event.currentTarget;
    var group = chipEl.getAttribute("data-group");
    var value = chipEl.getAttribute("data-value");
    if (group === "topic") {
      var idx = selected.topic.indexOf(value);
      if (idx === -1) {
        selected.topic.push(value);
        chipEl.setAttribute("aria-pressed", "true");
      } else {
        selected.topic.splice(idx, 1);
        chipEl.setAttribute("aria-pressed", "false");
      }
    } else {
      var next = selected[group] === value ? null : value;
      selected[group] = next;
      setSinglePressed(group, next);
    }
    applyFilters();
  }

  function initChips() {
    var chips = document.querySelectorAll(".chip-filter[data-group]");
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", onChipClick);
    }
  }

  function onMinePillClick(event) {
    var pillEl = event.currentTarget;
    var value = pillEl.getAttribute("data-value");
    var next = selected.mine === value ? null : value;
    selected.mine = next;
    var pills = document.querySelectorAll(".pill-mine");
    for (var i = 0; i < pills.length; i++) {
      pills[i].setAttribute("aria-pressed", pills[i].getAttribute("data-value") === next ? "true" : "false");
    }
    applyFilters();
  }

  function initMyFeedback() {
    var pills = document.querySelectorAll(".pill-mine");
    for (var i = 0; i < pills.length; i++) pills[i].addEventListener("click", onMinePillClick);
  }

  function resetFilters() {
    selected = { position: null, topic: [], mention: null, mine: null };
    var chips = document.querySelectorAll(".chip-filter[data-group]");
    for (var i = 0; i < chips.length; i++) chips[i].setAttribute("aria-pressed", "false");
    var pills = document.querySelectorAll(".pill-mine");
    for (var j = 0; j < pills.length; j++) pills[j].setAttribute("aria-pressed", "false");
    applyFilters();
  }

  function initReset() {
    var buttons = document.querySelectorAll(".filter-reset");
    for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener("click", resetFilters);
  }

  function onTabClick(event) {
    var tab = event.currentTarget;
    var all = document.querySelectorAll('.toc [role="tab"]');
    for (var j = 0; j < all.length; j++) {
      all[j].setAttribute("aria-selected", all[j] === tab ? "true" : "false");
    }
    var panels = document.querySelectorAll('.toc [role="tabpanel"]');
    for (var k = 0; k < panels.length; k++) {
      if (panels[k].id === tab.getAttribute("aria-controls")) {
        panels[k].removeAttribute("hidden");
      } else {
        panels[k].setAttribute("hidden", "");
      }
    }
  }

  function initTabs() {
    var tabs = document.querySelectorAll('.toc [role="tab"]');
    for (var i = 0; i < tabs.length; i++) tabs[i].addEventListener("click", onTabClick);
  }

  function onTocItemClick(event) {
    event.preventDefault();
    var tocItem = event.currentTarget;
    var targetId = tocItem.getAttribute("data-target");
    var targetCard = targetId ? document.getElementById(targetId) : null;
    if (!targetCard) return;
    if (typeof targetCard.scrollIntoView === "function") targetCard.scrollIntoView({ block: "start" });
    targetCard.classList.add("card--highlighted");
    tocItem.classList.add("is-current");
    setTimeout(function () {
      targetCard.classList.remove("card--highlighted");
      tocItem.classList.remove("is-current");
    }, 600);
  }

  function initToc() {
    var items = document.querySelectorAll(".toc-item");
    for (var i = 0; i < items.length; i++) items[i].addEventListener("click", onTocItemClick);
  }

  // ── video player (DESIGN.md §9) ──────────────────────────────────────

  var playerEl = document.getElementById("yt-player");
  var initialEmbeddable = playerEl ? playerEl.getAttribute("data-embeddable") === "true" : false;
  var currentVideo = document.body.dataset.video || null;
  var currentEmbeddable = initialEmbeddable;
  var playerReady = false;
  var playerCreated = false;
  var pendingQueue = [];

  function enqueueOrRun(action) {
    if (playerReady && window.fcPlayer) {
      action(window.fcPlayer);
    } else {
      pendingQueue.push(action);
    }
  }

  function onPlayerReady(event) {
    playerReady = true;
    window.fcPlayer = event.target;
    var queue = pendingQueue;
    pendingQueue = [];
    for (var i = 0; i < queue.length; i++) queue[i](window.fcPlayer);
  }

  function canCreatePlayer() {
    return typeof window.YT !== "undefined" && window.YT && typeof window.YT.Player === "function";
  }

  // playerCreated flips to true only once construction actually runs — flipping it
  // beforehand (as a naive re-entrancy guard would) means a click that arrives before the
  // iframe_api script has loaded a bare window.YT permanently skips player creation,
  // because the later onYouTubeIframeAPIReady -> initPlayer() call sees the guard already
  // set and never retries (REAL BUG, DESIGN §9 cold-load hazard).
  function ensurePlayer(videoId) {
    if (playerCreated || !canCreatePlayer()) return;
    playerCreated = true;
    window.fcPlayer = new window.YT.Player("yt-player", {
      videoId: videoId,
      host: "https://www.youtube-nocookie.com",
      events: { onReady: onPlayerReady },
    });
  }

  function showPlayer() {
    var placeholder = document.querySelector(".player-placeholder");
    if (placeholder) placeholder.setAttribute("hidden", "");
    if (playerEl) playerEl.removeAttribute("hidden");
  }

  function showPlaceholder(videoId, start) {
    if (playerEl) playerEl.setAttribute("hidden", "");
    var placeholder = document.querySelector(".player-placeholder");
    if (!placeholder) return;
    placeholder.removeAttribute("hidden");
    var link = placeholder.querySelector(".player-placeholder-link");
    if (link) link.setAttribute("href", "https://youtu.be/" + videoId + "?t=" + Math.floor(start));
  }

  function syncPartButtons() {
    var buttons = document.querySelectorAll(".part-btn");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-video") === currentVideo ? "true" : "false");
    }
  }

  function clientFormatTime(seconds) {
    var total = Math.floor(seconds);
    var s = total % 60;
    var totalMinutes = Math.floor(total / 60);
    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    if (total < 3600) return totalMinutes + ":" + pad(s);
    var h = Math.floor(totalMinutes / 60);
    var m = totalMinutes % 60;
    return h + ":" + pad(m) + ":" + pad(s);
  }

  function updateMiniBar() {
    var textEl = document.querySelector(".player-mini-bar-text");
    if (!textEl) return;
    var time = window.fcPlayer && typeof window.fcPlayer.getCurrentTime === "function" ? window.fcPlayer.getCurrentTime() : 0;
    var partBtn = document.querySelector('.part-btn[aria-pressed="true"]');
    var partLabel = partBtn ? partBtn.textContent : "";
    textEl.textContent = "\\u25B6 " + (partLabel ? partLabel + " · " : "") + clientFormatTime(time);
  }

  function switchTo(videoId, start, embeddable) {
    document.body.dataset.video = videoId;
    currentEmbeddable = embeddable;
    if (!embeddable) {
      currentVideo = videoId;
      syncPartButtons();
      showPlaceholder(videoId, start);
      updateMiniBar();
      return;
    }
    showPlayer();
    if (!playerCreated) {
      currentVideo = videoId;
      syncPartButtons();
      ensurePlayer(videoId);
      if (start > 0) enqueueOrRun(function (player) { player.seekTo(start, true); });
      updateMiniBar();
      return;
    }
    if (videoId === currentVideo) {
      enqueueOrRun(function (player) {
        player.seekTo(start, true);
        player.playVideo();
      });
    } else {
      currentVideo = videoId;
      enqueueOrRun(function (player) {
        player.loadVideoById({ videoId: videoId, startSeconds: start });
      });
    }
    syncPartButtons();
    updateMiniBar();
  }

  // Re-run on every onYouTubeIframeAPIReady call this session can reach (only once for a
  // normal cold load, but also from the "no YT at all yet" regression test/hazard above) —
  // it must create the player for whatever video is CURRENT now, not the page's initial one,
  // since a pre-ready click may already have switched currentVideo/currentEmbeddable.
  function initPlayer() {
    if (currentEmbeddable && currentVideo) {
      ensurePlayer(currentVideo);
    } else if (currentVideo) {
      showPlaceholder(currentVideo, 0);
    }
    syncPartButtons();
  }

  function onCardListClick(event) {
    var selectionText = typeof window.getSelection === "function" ? window.getSelection().toString() : "";
    if (selectionText !== "") return;
    var seekBtn = event.target.closest ? event.target.closest(".seek-btn") : null;
    var interactive = event.target.closest ? event.target.closest("a, button, summary") : null;
    if (interactive && !seekBtn) return; // other interactive elements (e.g. 확대 link) opt out
    var card = event.target.closest ? event.target.closest(".card") : null;
    if (!card) return;
    var video = card.getAttribute("data-video");
    if (!video) return;
    var start;
    if (seekBtn) {
      start = Number(seekBtn.getAttribute("data-seek-t") || "0");
    } else {
      var frame = event.target.closest ? event.target.closest(".body-frame") : null;
      start = frame
        ? Number(frame.getAttribute("data-frame-t") || "0")
        : Number(card.getAttribute("data-start") || "0");
    }
    var embeddable = card.getAttribute("data-embeddable") === "true";
    switchTo(video, start, embeddable);
  }

  function initCardClicks() {
    var cardList = document.querySelector(".card-list");
    if (cardList) cardList.addEventListener("click", onCardListClick);
  }

  function onPartButtonClick(event) {
    var video = event.currentTarget.getAttribute("data-video");
    if (!video) return;
    var embeddable = event.currentTarget.getAttribute("data-embeddable") === "true";
    switchTo(video, 0, embeddable);
  }

  function initPartButtons() {
    var buttons = document.querySelectorAll(".part-btn");
    for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener("click", onPartButtonClick);
  }

  function syncPlayerHeight() {
    var wrapper = document.querySelector(".player-wrapper");
    if (!wrapper) return;
    document.documentElement.style.setProperty("--sticky-player-h", wrapper.offsetHeight + "px");
  }

  var miniBarInterval = null;

  function initPlayerCollapse() {
    var btn = document.querySelector(".player-collapse");
    var wrapper = document.querySelector(".player-wrapper");
    if (!btn || !wrapper) return;
    btn.addEventListener("click", function () {
      var collapsed = wrapper.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.textContent = collapsed ? "펼치기" : "플레이어 접기";
      if (miniBarInterval !== null) {
        clearInterval(miniBarInterval);
        miniBarInterval = null;
      }
      if (collapsed) {
        updateMiniBar();
        // The mini bar's time otherwise never advances during playback (DESIGN §4's "▶
        // 현재 파트 + 현재 재생 시각" implies a live clock) — only ticks while collapsed.
        miniBarInterval = setInterval(updateMiniBar, 1000);
        // Node/Bun timers (unlike a browser's numeric id) support unref(); this only
        // keeps a test process's event loop from waiting on a collapsed-and-forgotten mock.
        if (miniBarInterval && typeof miniBarInterval.unref === "function") miniBarInterval.unref();
      }
      syncPlayerHeight();
    });
  }

  function initTocToggle() {
    var btn = document.querySelector(".toc-toggle");
    var panel = document.querySelector(".toc-panel");
    if (!btn || !panel) return;
    btn.addEventListener("click", function () {
      var expanded = btn.getAttribute("aria-expanded") === "true";
      panel.hidden = expanded;
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    });
  }

  initChips();
  initReset();
  initMyFeedback();
  initTabs();
  initToc();
  initCardClicks();
  initPartButtons();
  initPlayerCollapse();
  initTocToggle();
  applyFilters();
  syncPlayerHeight();
  if (typeof ResizeObserver !== "undefined") {
    var playerWrapperEl = document.querySelector(".player-wrapper");
    if (playerWrapperEl) new ResizeObserver(syncPlayerHeight).observe(playerWrapperEl);
  }

  if (window.YT && window.YT.loaded) {
    initPlayer();
  } else {
    window.onYouTubeIframeAPIReady = initPlayer;
  }
})();`;
