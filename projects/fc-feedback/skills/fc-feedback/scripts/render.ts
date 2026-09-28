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
			return (
				`<button type="button" class="pill pill-mine" data-group="mine" data-value="${escapeHtml(member.id)}" aria-pressed="false" role="listitem">` +
				`${escapeHtml(member.name)} <span class="count">${count}</span></button>`
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

function renderPositionNode(tag: string, counts: Map<string, number>): string {
	const count = counts.get(tag) ?? 0;
	if (count === 0) {
		return "";
	}
	const childHtml = childrenOf(tag)
		.map((child) => renderPositionNode(child, counts))
		.join("");
	const button =
		`<button type="button" class="chip chip-filter" data-group="position" data-value="${escapeHtml(tag)}" aria-pressed="false">` +
		`${escapeHtml(tag)} (${count})</button>`;
	return childHtml
		? `<span class="pos-node">${button}<span class="pos-children">${childHtml}</span></span>`
		: `<span class="pos-node">${button}</span>`;
}

function renderPositionFacetGroup(data: SessionData): string {
	const counts = countPositionNodes(data);
	const roots = POSITION_ROOTS.map((root) => renderPositionNode(root, counts)).join("");
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
		`<details class="filter-bar" open>` +
		`<summary>필터 (<span id="filter-count-label">0</span>)<span class="filter-summary-detail"></span></summary>` +
		`<div class="filter-groups">${groups}</div>` +
		`<button type="button" class="filter-reset">초기화</button>` +
		`</details>`
	);
}

// ── TOC tabs (DESIGN.md §8) ──────────────────────────────────────────────

function tocItemAttrs(unit: SessionUnit): string {
	return (
		`data-target="${escapeHtml(unit.id)}" ` +
		`data-pos="${escapeHtml(posClosure(unit.position_tags).join(" "))}" ` +
		`data-topics="${escapeHtml(unit.topic_tags.join(" "))}" ` +
		`data-member-ids="${escapeHtml(unit.member_ids.join(" "))}" ` +
		`data-related-ids="${escapeHtml(unit.related_member_ids.join(" "))}"`
	);
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
								`<li><a class="toc-item" href="#${escapeHtml(unit.id)}" ${tocItemAttrs(unit)}>${escapeHtml(unit.title)}</a></li>`,
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
						`<li><a class="toc-item" href="#${escapeHtml(unit.id)}" ${tocItemAttrs(unit)}>${escapeHtml(unit.title)}</a></li>`,
				)
				.join("");
			return (
				`<div class="toc-tag-group"><h2>${escapeHtml(tag)} (${units.length})</h2>` + `<ul>${items}</ul></div>`
			);
		})
		.join("");
	return `<div role="tabpanel" id="panel-topic" aria-labelledby="tab-topic" hidden>${groups}</div>`;
}

function renderToc(data: SessionData): string {
	return (
		`<div class="toc">` +
		`<div role="tablist">` +
		`<button type="button" role="tab" id="tab-match" aria-selected="true" aria-controls="panel-match">경기별</button>` +
		`<button type="button" role="tab" id="tab-topic" aria-selected="false" aria-controls="panel-topic">주제별</button>` +
		`</div>` +
		renderTabMatch(data) +
		renderTabTopic(data) +
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
	return `<div class="card-head">` + chip("chip-time", formatTime(unit.start)) + partChip + breadcrumb + `</div>`;
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

/** A body text block: escape first, then turn only `boldSpans` bold segments into `<strong>` (DESIGN §5 item 7). */
function renderBodyText(text: string): string {
	const html = boldSpans(text)
		.map((span) => (span.bold ? `<strong>${escapeHtml(span.text)}</strong>` : escapeHtml(span.text)))
		.join("");
	return `<p>${html}</p>`;
}

/** A body frame: figure+figcaption with a time chip and a "확대" new-tab link, `data-frame-t` read by VIEWER_JS's click-to-seek (DESIGN §5 item 7). */
function renderBodyFrame(block: UnitBodyFrameBlock): string {
	return (
		`<figure class="body-frame" data-frame-t="${block.t}">` +
		`<img src="${escapeHtml(block.src)}" width="${block.width}" height="${block.height}" loading="lazy" alt="${escapeHtml(block.caption)}">` +
		`<figcaption>${chip("chip-time", formatTime(block.t))}${escapeHtml(block.caption)} ` +
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

/** Card field order per DESIGN §5: header → title → mention badge → image → tag row → mentioned members → body → related members → similar → refs → watch link. */
function renderCard(unit: SessionUnit, ctx: CardContext): string {
	const video = ctx.videoById.get(unit.video);
	const startImage = unit.images.start;
	const hasRoster = ctx.members.length > 0;
	return (
		`<article class="card" id="${escapeHtml(unit.id)}" ` +
		`data-video="${escapeHtml(unit.video)}" data-start="${unit.start}" ` +
		`data-pos="${escapeHtml(posClosure(unit.position_tags).join(" "))}" ` +
		`data-topics="${escapeHtml(unit.topic_tags.join(" "))}" ` +
		`data-member-ids="${escapeHtml(unit.member_ids.join(" "))}" ` +
		`data-related-ids="${escapeHtml(unit.related_member_ids.join(" "))}" ` +
		`data-embeddable="${(video?.embeddable ?? true) ? "true" : "false"}">` +
		renderCardHead(unit, ctx) +
		`<h3>${escapeHtml(unit.title)}</h3>` +
		(hasRoster ? `<p class="mention-badge" hidden></p>` : "") +
		`<img src="${escapeHtml(startImage.src)}" width="${startImage.width}" height="${startImage.height}" alt="">` +
		renderChipRow(unit) +
		(hasRoster ? renderMentionedLine(unit, ctx.members) : "") +
		renderBody(unit.body) +
		(hasRoster ? renderRelatedLine(unit, ctx.members) : "") +
		renderSimilarList(unit.similar) +
		renderRefsList(unit.refs) +
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

const FOOTER_NOTICE = "팀 내부 피드백용 비공식 정리 문서입니다. 영상 저작권은 원 게시자에게 있습니다.";

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
		`<header class="header"><h1>${escapeHtml(data.title)}</h1><p class="date">${escapeHtml(data.date)}</p></header>` +
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
		`<h2>${escapeHtml(entry.title)}</h2>` +
		`<p class="meta">${entry.videos}파트 · 피드백 ${entry.unit_count}개</p>` +
		`<div class="topic-tags">${tags}</div>` +
		`</a>`
	);
}

function renderIndexByTopic(index: ArchiveIndex): string {
	if (index.units.length === 0) {
		return "";
	}
	const tags = firstAppearanceTags(index.units);
	const groups = tags
		.map((tag) => {
			const units = index.units.filter((unit) => unit.topic_tags.includes(tag));
			const items = units
				.map((unit) => `<li><a href="${escapeHtml(unit.href)}">${escapeHtml(unit.title)}</a></li>`)
				.join("");
			return `<div class="toc-tag-group"><h2>${escapeHtml(tag)} (${units.length})</h2><ul>${items}</ul></div>`;
		})
		.join("");
	return `<section id="by-topic"><h2>주제별 전체 피드백</h2>${groups}</section>`;
}

export function renderIndex(index: ArchiveIndex): string {
	const body =
		index.sessions.length === 0
			? `<p class="empty-state">아직 발행된 세션이 없어요.</p>`
			: `<div class="session-grid">${index.sessions.map(renderSessionCard).join("")}</div>` +
				`<p><a href="#by-topic">주제별 전체 피드백</a></p>` +
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
		`<h1>${escapeHtml(ref.title)}</h1>` +
		`<p class="ref-badges"><span class="badge">${escapeHtml(ref.kind)}</span>` +
		`<span class="badge">${escapeHtml(ref.lang.toUpperCase())}</span></p>` +
		`<p><a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener">원문 ↗</a></p>` +
		`<p class="summary-ko">${escapeHtml(ref.summary_ko)}</p>` +
		(keyPoints ? `<ul class="key-points">${keyPoints}</ul>` : "") +
		(rows
			? `<table class="translations-table"><thead><tr><th>원문</th><th>한국어</th></tr></thead><tbody>${rows}</tbody></table>`
			: "") +
		`<p><a href="../index.html">아카이브로 돌아가기</a></p>` +
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
  --measure: 660px;
  --sticky-player-h: 0px;
}
* { box-sizing: border-box; }
html, body { background: var(--bg); color: var(--ink); }
body {
  margin: 0;
  font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
  font-size: 1rem; line-height: 1.6;
  word-break: keep-all; overflow-wrap: anywhere; line-break: strict;
}
h1, h2, h3 { text-wrap: balance; word-break: keep-all; overflow-wrap: anywhere; line-break: strict; margin: 0 0 var(--space-2); font-weight: 700; }
p, dd, li, figcaption { text-wrap: pretty; word-break: keep-all; overflow-wrap: anywhere; line-break: strict; }
h1 { font-size: 1.75rem; line-height: 1.3; }
h2 { font-size: 1.375rem; line-height: 1.35; }
h3 { font-size: 1.25rem; line-height: 1.4; }
a { color: var(--accent); }
a:hover { color: var(--accent-hover); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
button { font: inherit; color: inherit; background: none; border: none; }
img { display: block; max-width: 100%; height: auto; border-radius: var(--radius-sm); }

.header, .footer { max-width: 1440px; margin: 0 auto; padding-left: var(--space-6); padding-right: var(--space-6); }
.header { padding-top: var(--space-6); }
.header .date { color: var(--muted); font-size: 0.8125rem; margin: 0; }
.footer { padding: var(--space-8) var(--space-6); color: var(--muted); font-size: 0.8125rem; }

.layout { display: flex; align-items: flex-start; gap: var(--space-6); max-width: 1440px; margin: 0 auto; padding: var(--space-6); }

.side-col { flex: 0 0 min(420px, 40%); position: sticky; top: var(--space-6);
  max-height: calc(100dvh - var(--space-6) * 2);
  display: flex; flex-direction: column; gap: var(--space-4); }
.player-wrapper { flex-shrink: 0; width: 100%; aspect-ratio: 16 / 9; position: relative;
  background: var(--ink); border-radius: var(--radius-sm); overflow: hidden;
  box-shadow: 0 2px 8px rgba(20,24,28,0.08); }
.player-media { position: absolute; inset: 0; }
#yt-player, .player-media iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
#yt-player[hidden] { display: none; }
.player-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2); color: #fff; text-align: center; padding: var(--space-4); }
.player-placeholder[hidden] { display: none; }
.player-mini-bar { position: absolute; inset: 0; display: none; align-items: center; padding: 0 var(--space-3); color: #fff; font-size: 0.8125rem; font-weight: 600; background: var(--ink); }
.player-collapse { display: none; }

.side { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--space-4); }
.part-switch { flex-shrink: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
.part-btn { min-height: 44px; padding: var(--space-2) var(--space-3); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--surface); font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.part-btn[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }

.toc-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.toc [role="tablist"] { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--line); }
.toc [role="tab"] { min-height: 44px; padding: var(--space-2) var(--space-3); font-size: 0.8125rem; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
.toc [role="tab"][aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.toc [role="tabpanel"][hidden] { display: none; }
.toc-topic-group, .toc-tag-group, .toc-match-group { margin: var(--space-6) 0 0; }
.toc-summary { font-size: 0.875rem; color: var(--muted); margin: var(--space-1) 0 var(--space-2); }
.toc ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.toc-item { display: block; min-height: 44px; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); font-size: 0.875rem; }
.toc-item[hidden] { display: none; }

.main { flex: 1 1 auto; min-width: 0; max-width: var(--measure); display: flex; flex-direction: column; gap: var(--space-8); }

.my-feedback { display: flex; flex-direction: column; gap: var(--space-2); }
.my-feedback-label { font-size: 0.8125rem; font-weight: 700; }
.my-feedback-row { display: flex; gap: var(--space-2); overflow-x: auto; white-space: nowrap; padding-bottom: var(--space-1); }
.pill { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 44px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--bg); font-size: 0.8125rem; font-weight: 600; cursor: pointer; flex-shrink: 0; }
.pill .count { color: var(--muted); }
.pill[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.pill[aria-pressed="true"] .count { color: #fff; }

.filter-bar { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-4); }
.filter-bar summary { cursor: pointer; font-size: 0.8125rem; font-weight: 600; min-height: 44px; display: flex; align-items: center; list-style: none; }
.filter-bar summary::-webkit-details-marker { display: none; }
.filter-summary-detail { color: var(--muted); font-weight: 400; margin-left: var(--space-1); }
.filter-bar[open] summary { margin-bottom: var(--space-2); }
.filter-groups { display: flex; flex-direction: column; gap: var(--space-3); }
.filter-group-label { display: block; font-size: 0.8125rem; font-weight: 600; color: var(--muted); margin-bottom: var(--space-2); }
.chip { display: inline-flex; align-items: center; padding: var(--space-1) var(--space-3); margin: 2px; border-radius: var(--radius-full); font-size: 0.8125rem; font-weight: 600; color: var(--ink); background: var(--surface-sunken); }
.chip-filter { min-height: 44px; border: 1px solid var(--line-strong); cursor: pointer; background: var(--bg); }
.chip-filter[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.pos-node { display: inline-flex; align-items: center; }
.pos-children { margin-left: var(--space-3); display: inline-flex; flex-wrap: wrap; }
.chip-overflow { color: var(--muted); }
.filter-reset { min-height: 44px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--bg); font-weight: 600; cursor: pointer; margin-top: var(--space-3); }

.active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.active-filters[hidden] { display: none; }
.chip-active { gap: var(--space-1); }
.chip-remove { font-size: 0.875rem; line-height: 1; cursor: pointer; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }

.result-count { font-size: 0.8125rem; color: var(--muted); }

.card-list { display: flex; flex-direction: column; gap: var(--space-6); }
.card { background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-4); cursor: pointer; scroll-margin-top: var(--space-4); }
.card[hidden] { display: none; }
.card--highlighted { border-color: var(--accent); border-width: 2px; }
.card-head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2); }
.chip-time, .chip-part { background: var(--surface-sunken); }
.breadcrumb { color: var(--muted); font-size: 0.8125rem; }
.card > img { margin-top: var(--space-3); border: 1px solid var(--line); }
.mention-badge { display: inline-block; margin: var(--space-2) 0 0; padding: var(--space-1) var(--space-3); border-radius: var(--radius-full); font-size: 0.8125rem; font-weight: 600; }
.mention-badge[hidden] { display: none; }
.mention-badge.mention-direct { background: var(--accent); color: #fff; }
.mention-badge.mention-related { background: var(--surface-sunken); color: var(--muted); }
.chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0; }
.chip-pos-gk { background: var(--pos-gk-bg); color: var(--pos-gk-fg); }
.chip-pos-df { background: var(--pos-df-bg); color: var(--pos-df-fg); }
.chip-pos-mf { background: var(--pos-mf-bg); color: var(--pos-mf-fg); }
.chip-pos-fw { background: var(--pos-fw-bg); color: var(--pos-fw-fg); }
.mentioned-members, .related-members { font-size: 0.8125rem; color: var(--muted); margin: var(--space-2) 0 0; }
.member-name { background: none; color: inherit; padding: 0; border-radius: 0; font-weight: inherit; }
.member-name.mine { background: var(--mine-tint); border-radius: var(--radius-sm); padding: 0 var(--space-1); font-weight: 600; }

.card-body { margin-top: var(--space-3); display: flex; flex-direction: column; }
.card-body > * + * { margin-top: var(--space-4); }
.card-body > * + .body-frame { margin-top: var(--space-6); }
.card-body p { margin: 0; font-size: 1.0625rem; line-height: 1.7; }
.card-body p strong { font-weight: 700; color: inherit; }
.card-body .body-frame { margin: 0; cursor: pointer; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-2); }
.card-body .body-frame img { border-radius: var(--radius-sm); }
.card-body .body-frame figcaption { display: flex; align-items: center; gap: var(--space-2); font-size: 0.875rem; font-weight: 500; color: var(--muted); margin-top: var(--space-2); }
.zoom-link { font-weight: 600; }

.similar-list, .refs-list { font-size: 0.9375rem; margin: 0; padding-left: 1.1rem; }
.ref-badges { display: inline-flex; gap: var(--space-1); }
.badge { display: inline-block; background: var(--surface-sunken); color: var(--muted); font-size: 0.875rem; font-weight: 500; padding: 2px var(--space-2); border-radius: var(--radius-full); }
.similar-date { color: var(--muted); font-size: 0.875rem; }
.watch-link { display: inline-block; font-weight: 600; }
.empty-state { text-align: center; color: var(--muted); padding: var(--space-8) 0; }
.empty-state[hidden] { display: none; }

@media (max-width: 1023.98px) {
  .layout { flex-direction: column; padding: var(--space-4); gap: var(--space-4); }
  .side-col { display: contents; }
  .side { position: static; max-height: none; display: block; }
  .player-wrapper { position: sticky; top: 0; z-index: 10; aspect-ratio: auto; height: min(56.25vw, 200px); }
  .player-wrapper.is-collapsed { height: 44px; }
  .player-wrapper.is-collapsed .player-mini-bar { display: flex; }
  .player-collapse { display: block; position: absolute; right: var(--space-2); bottom: var(--space-2); z-index: 1;
    min-width: 44px; min-height: 44px; padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: rgba(255,255,255,0.9); color: var(--ink); font-size: 0.8125rem; font-weight: 600; }
  .player-wrapper.is-collapsed .player-collapse { position: static; margin-left: auto; background: none; border: none; color: #fff; }
  .toc-scroll { overflow-y: visible; }
  .main { max-width: none; }
  .card { scroll-margin-top: calc(var(--sticky-player-h) + var(--space-4)); }
}

.archive-main, .ref-main { max-width: 960px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
.session-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-6); margin: var(--space-6) 0; }
.session-card { display: block; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-4); }
.session-card .meta { color: var(--muted); font-size: 0.8125rem; }
.topic-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-2); }
.summary-ko { font-size: 1.0625rem; line-height: 1.7; }
.translations-table { width: 100%; border-collapse: collapse; margin: var(--space-4) 0; }
.translations-table th, .translations-table td { border: 1px solid var(--line); padding: var(--space-2); vertical-align: top; font-size: 0.9375rem; text-align: left; }
`;

// ── VIEWER_JS (DESIGN.md §5–§9) ──────────────────────────────────────────
//
// Static string, no interpolation. Reads only server-rendered `data-*`
// attributes. Session page loads this BEFORE the `iframe_api` script; init
// runs immediately when `window.YT && YT.loaded`, else it registers
// `window.onYouTubeIframeAPIReady` (DESIGN §9).

export const VIEWER_JS = `(function () {
  "use strict";

  function hasToken(value, token) {
    if (!value) return false;
    var parts = value.split(" ");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === token) return true;
    }
    return false;
  }

  function anyToken(value, tokens) {
    if (!value) return false;
    var parts = value.split(" ");
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

  function updateMentionBadgesAndMarks() {
    var mine = selected.mine;
    var cards = document.querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var badge = card.querySelector(".mention-badge");
      if (badge) {
        if (mine && hasToken(card.getAttribute("data-member-ids") || "", mine)) {
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
    var targetId = event.currentTarget.getAttribute("data-target");
    var targetCard = targetId ? document.getElementById(targetId) : null;
    if (!targetCard) return;
    if (typeof targetCard.scrollIntoView === "function") targetCard.scrollIntoView({ block: "start" });
    targetCard.classList.add("card--highlighted");
    setTimeout(function () {
      targetCard.classList.remove("card--highlighted");
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

  function ensurePlayer(videoId) {
    if (playerCreated) return;
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

  function initPlayer() {
    if (initialEmbeddable && currentVideo) {
      ensurePlayer(currentVideo);
    } else if (currentVideo) {
      showPlaceholder(currentVideo, 0);
    }
    syncPartButtons();
  }

  function onCardListClick(event) {
    var selectionText = typeof window.getSelection === "function" ? window.getSelection().toString() : "";
    if (selectionText !== "") return;
    var interactive = event.target.closest ? event.target.closest("a, button, summary") : null;
    if (interactive) return;
    var card = event.target.closest ? event.target.closest(".card") : null;
    if (!card) return;
    var video = card.getAttribute("data-video");
    if (!video) return;
    var frame = event.target.closest ? event.target.closest(".body-frame") : null;
    var start = frame
      ? Number(frame.getAttribute("data-frame-t") || "0")
      : Number(card.getAttribute("data-start") || "0");
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

  function initPlayerCollapse() {
    var btn = document.querySelector(".player-collapse");
    var wrapper = document.querySelector(".player-wrapper");
    if (!btn || !wrapper) return;
    btn.addEventListener("click", function () {
      var collapsed = wrapper.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.textContent = collapsed ? "펼치기" : "플레이어 접기";
      if (collapsed) updateMiniBar();
      syncPlayerHeight();
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
