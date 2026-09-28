/**
 * fc-feedback HTML renderer — session viewer, archive index page, reference
 * page (plan §1, §5; DESIGN.md is the design-intent contract this file
 * implements literally).
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
 * - `UnitSimilar` adds `date`: DESIGN.md §4 item 8 requires showing the past
 *   session's date next to a similar-feedback link, and core.ts's own
 *   `SimilarCandidate` already carries `date` — the plan's abbreviated
 *   `similar[{uid,title,href}]` text omitted a field the sibling module and
 *   the design both need.
 * - The card root carries `data-related-ids` and `data-embeddable` in
 *   addition to DESIGN.md §4's listed `data-video data-start data-pos
 *   data-topics data-member-ids`: the "팀원 관련" filter (§6) and the
 *   per-video embeddable-placeholder switch (§7) are both explicit,
 *   already-specified behaviors that have no other data hook to read from.
 */
import { anc, formatTime, PARENT, posClosure } from "./core.ts";

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

export interface UnitKeyImage {
	src: string;
	caption: string;
	t: number;
}

export interface UnitImages {
	start: UnitStartImage;
	key: UnitKeyImage[];
}

export interface UnitNote {
	problem: string;
	who: string;
	instead: string;
	detail?: string;
}

/** `similar[{uid,title,href}]` plus `date` — see the module doc's gap-fill note. */
export interface UnitSimilar {
	uid: string;
	title: string;
	date: string;
	href: string;
}

/** `href` is `null` for a `lang: "ko"` ref (no summary page is generated, plan §3/§4). */
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
	note: UnitNote;
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

/** A `refs.verified.json` entry for a non-`ko` ref, the input to `renderRef` (plan §3, DESIGN §10). */
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

/** Escapes, then turns `\n` into `<br>` (DESIGN.md §4 item 6: plain text, escape first). */
function escapeMultiline(value: string): string {
	return escapeHtml(value).replace(/\n/g, "<br>");
}

// ── position tree display order (DESIGN.md §6) ──────────────────────────────
//
// core.ts's `PARENT` map already lists each parent's children in the exact
// order DESIGN.md §6 specifies (CB,FB / LB,RB,LWB,RWB / CDM,CM,CAM,LM,RM /
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

function memberGamertag(members: readonly SessionMemberInfo[], id: string): string {
	return members.find((member) => member.id === id)?.gamertag ?? id;
}

// ── position filter tree (DESIGN.md §6) ─────────────────────────────────────

function renderPositionNode(tag: string): string {
	const children = childrenOf(tag);
	const button = `<button type="button" class="chip chip-filter" data-group="position" data-value="${escapeHtml(tag)}" aria-pressed="false">${escapeHtml(tag)}</button>`;
	if (children.length === 0) {
		return `<span class="pos-node">${button}</span>`;
	}
	return `<span class="pos-node">${button}<span class="pos-children">${children.map(renderPositionNode).join("")}</span></span>`;
}

function renderPositionFilterGroup(): string {
	return (
		`<div class="filter-group" data-role="filter-position">` +
		`<span class="filter-group-label">포지션</span>` +
		`<div class="pos-tree">${POSITION_ROOTS.map(renderPositionNode).join("")}</div>` +
		`</div>`
	);
}

function renderTopicFilterGroup(data: SessionData): string {
	const tags: string[] = [];
	for (const unit of data.units) {
		for (const tag of unit.topic_tags) {
			if (!tags.includes(tag)) tags.push(tag);
		}
	}
	const chips = tags
		.map(
			(tag) =>
				`<button type="button" class="chip chip-filter" data-group="topic" data-value="${escapeHtml(tag)}" aria-pressed="false">${escapeHtml(tag)}</button>`,
		)
		.join("");
	return `<div class="filter-group" data-role="filter-topic"><span class="filter-group-label">주제</span>${chips}</div>`;
}

function renderMemberFilterGroup(
	data: SessionData,
	group: "mention" | "related",
	label: string,
): string {
	if (data.members.length === 0) {
		return "";
	}
	const chips = data.members
		.map(
			(member) =>
				`<button type="button" class="chip chip-filter" data-group="${group}" data-value="${escapeHtml(member.id)}" aria-pressed="false">${escapeHtml(member.name)}</button>`,
		)
		.join("");
	return `<div class="filter-group" data-role="filter-${group}"><span class="filter-group-label">${escapeHtml(label)}</span>${chips}</div>`;
}

function renderFilterBar(data: SessionData): string {
	return (
		`<details class="filter-bar" open>` +
		`<summary>필터 (<span id="filter-count-label">0</span>)</summary>` +
		renderPositionFilterGroup() +
		renderTopicFilterGroup(data) +
		renderMemberFilterGroup(data, "mention", "언급 선수") +
		renderMemberFilterGroup(data, "related", "팀원 관련") +
		`<button type="button" class="filter-reset">초기화</button>` +
		`</details>`
	);
}

// ── TOC tabs (DESIGN.md §5) ──────────────────────────────────────────────

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
	const tags: string[] = [];
	for (const unit of data.units) {
		for (const tag of unit.topic_tags) {
			if (!tags.includes(tag)) tags.push(tag);
		}
	}
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
				`<div class="toc-tag-group"><h2>${escapeHtml(tag)} (${units.length})</h2>` +
				`<ul>${items}</ul></div>`
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

// ── player + part switch (DESIGN.md §3, §7) ──────────────────────────────

function renderPlayerWrapper(data: SessionData): string {
	const initial = data.videos[0];
	const initialId = initial?.id ?? "";
	const initialEmbeddable = initial?.embeddable ?? false;
	return (
		`<div class="player-wrapper">` +
		`<div id="yt-player" data-video="${escapeHtml(initialId)}" data-embeddable="${initialEmbeddable ? "true" : "false"}"${initialEmbeddable ? "" : " hidden"}></div>` +
		`<div class="player-placeholder"${initialEmbeddable ? " hidden" : ""}>` +
		`<p>이 영상은 임베드를 지원하지 않습니다.</p>` +
		`<a class="player-placeholder-link" href="https://youtu.be/${escapeHtml(initialId)}?t=0" target="_blank" rel="noopener">유튜브에서 시청 ↗</a>` +
		`</div>` +
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

// ── card (DESIGN.md §4) ──────────────────────────────────────────────────

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
	return (
		`<div class="card-head">` +
		chip("chip-time", formatTime(unit.start)) +
		partChip +
		breadcrumb +
		`</div>`
	);
}

function renderChipRow(unit: SessionUnit): string {
	const positionChips = unit.position_tags.map((tag) => chip(positionChipClass(tag), tag)).join("");
	const topicChips = unit.topic_tags.map((tag) => chip("chip-topic", tag)).join("");
	const mentionChips = unit.member_ids.map((id) => chip("chip-mention", `@${id}`)).join("");
	return `<div class="chip-row">${positionChips}${topicChips}${mentionChips}</div>`;
}

function renderMentionChips(unit: SessionUnit, members: readonly SessionMemberInfo[]): string {
	return unit.member_ids
		.map((id) => chip("chip-mention", `@${memberGamertag(members, id)}`))
		.join("");
}

function renderNoteDl(note: UnitNote): string {
	const detail =
		note.detail !== undefined ? `<dt>상세</dt><dd>${escapeMultiline(note.detail)}</dd>` : "";
	return (
		`<dl class="note-dl">` +
		`<dt>문제</dt><dd>${escapeMultiline(note.problem)}</dd>` +
		`<dt>누구</dt><dd>${escapeMultiline(note.who)}</dd>` +
		`<dt>대신</dt><dd>${escapeMultiline(note.instead)}</dd>` +
		detail +
		`</dl>`
	);
}

function renderKeyImages(images: UnitKeyImage[]): string {
	if (images.length === 0) {
		return "";
	}
	const figures = images
		.map(
			(image) =>
				`<figure><img src="${escapeHtml(image.src)}" alt=""><figcaption>${escapeHtml(image.caption)}</figcaption></figure>`,
		)
		.join("");
	return `<div class="key-images">${figures}</div>`;
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

function renderCard(unit: SessionUnit, ctx: CardContext): string {
	const video = ctx.videoById.get(unit.video);
	const startImage = unit.images.start;
	const relatedNames = unit.related_member_ids.map((id) => memberName(ctx.members, id));
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
		`<img src="${escapeHtml(startImage.src)}" width="${startImage.width}" height="${startImage.height}" alt="">` +
		renderChipRow(unit) +
		renderMentionChips(unit, ctx.members) +
		(relatedNames.length > 0
			? `<p class="related-members">관련 팀원: ${relatedNames.map((name) => escapeHtml(name)).join(", ")}</p>`
			: "") +
		renderNoteDl(unit.note) +
		renderKeyImages(unit.images.key) +
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

const FOOTER_NOTICE =
	"팀 내부 피드백용 비공식 정리 문서입니다. 영상 저작권은 원 게시자에게 있습니다.";

// ── renderSession (DESIGN.md §3–§9) ──────────────────────────────────────

export function renderSession(data: SessionData): string {
	const matchById = new Map(data.matches.map((match) => [match.id, match]));
	const topicById = new Map(
		data.matches.flatMap((match) => match.topics.map((topic) => [topic.id, topic])),
	);
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

	const body =
		`<div class="layout">` +
		`<header class="header"><h1>${escapeHtml(data.title)}</h1><p class="date">${escapeHtml(data.date)}</p></header>` +
		`<div class="side">${renderPlayerWrapper(data)}${renderPartSwitch(data)}${renderToc(data)}</div>` +
		renderFilterBar(data) +
		`<p class="result-count">피드백 <span id="visible-count">${total}</span>/<span id="total-count">${total}</span></p>` +
		`<div class="card-list">${cards}</div>` +
		`<p class="empty-state" hidden>조건에 맞는 피드백이 없어요 <button type="button" class="filter-reset">초기화</button></p>` +
		`<footer class="footer"><p>${escapeHtml(FOOTER_NOTICE)}</p></footer>` +
		`</div>`;

	const scripts =
		`<script>${VIEWER_JS}</script>\n` +
		`<script src="https://www.youtube.com/iframe_api" async></script>\n`;

	return pageShell(
		data.title,
		` data-video="${escapeHtml(data.videos[0]?.id ?? "")}"`,
		body,
		scripts,
	);
}

// ── renderIndex (DESIGN.md §10) ──────────────────────────────────────────

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
	const tags: string[] = [];
	for (const unit of index.units) {
		for (const tag of unit.topic_tags) {
			if (!tags.includes(tag)) tags.push(tag);
		}
	}
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

// ── renderRef (DESIGN.md §10) ─────────────────────────────────────────────

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

// ── STYLE (DESIGN.md §1 tokens, §2 breakpoints, §3 layout, §11 a11y) ────────

export const STYLE = `
:root {
  --bg: #FFFFFF; --surface: #F6F8F7; --surface-sunken: #EFF2F0;
  --ink: #14181C; --muted: #57606A; --line: #E3E6E8;
  --accent: #1E7A46; --accent-hover: #145C34; --focus: #1E7A46;
  --pos-gk-bg: #FDF1D8; --pos-gk-fg: #8A5A00;
  --pos-df-bg: #E4EEFC; --pos-df-fg: #1451B0;
  --pos-mf-bg: #E7F0EE; --pos-mf-fg: #0F6B5C;
  --pos-fw-bg: #FBE7E4; --pos-fw-fg: #B23A2E;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px;
  --radius-sm: 8px; --radius-md: 12px; --radius-full: 9999px;
  --sticky-player-h: 0px;
}
* { box-sizing: border-box; }
html, body { background: var(--bg); color: var(--ink); }
body {
  margin: 0;
  font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
  font-size: 15px; line-height: 1.6;
  word-break: keep-all; overflow-wrap: anywhere; line-break: strict;
}
h1, h2, h3 { text-wrap: balance; word-break: keep-all; overflow-wrap: anywhere; line-break: strict; margin: 0 0 var(--space-2); }
p, dd, li, figcaption { text-wrap: pretty; word-break: keep-all; overflow-wrap: anywhere; line-break: strict; }
h1 { font-size: 1.75rem; font-weight: 700; line-height: 1.3; }
h2 { font-size: 1.25rem; font-weight: 600; line-height: 1.4; }
h3 { font-size: 1.125rem; font-weight: 600; line-height: 1.45; }
a { color: var(--accent); }
a:hover { color: var(--accent-hover); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
button { font: inherit; color: inherit; background: none; border: none; }
img { display: block; max-width: 100%; height: auto; border-radius: var(--radius-sm); }

.layout { display: grid; grid-template-columns: minmax(420px, 44%) 1fr; gap: var(--space-6); padding: var(--space-6); max-width: 1440px; margin: 0 auto; }
.side { grid-column: 1; grid-row: 1 / -1; position: sticky; top: 0; height: 100dvh; overflow: auto; display: flex; flex-direction: column; gap: var(--space-4); }
.header, .filter-bar, .result-count, .card-list, .empty-state, .footer { grid-column: 2; }

.player-wrapper { position: relative; aspect-ratio: 16 / 9; background: var(--ink); border-radius: var(--radius-sm); overflow: hidden; box-shadow: 0 2px 8px rgba(20,24,28,0.08); }
#yt-player, .player-wrapper iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
#yt-player[hidden] { display: none; }
.player-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2); color: #fff; text-align: center; padding: var(--space-4); }
.player-placeholder[hidden] { display: none; }

.part-switch { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.part-btn { min-height: 44px; padding: var(--space-2) var(--space-3); border-radius: var(--radius-full); border: 1px solid var(--line); background: var(--surface); font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.part-btn[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }

.toc [role="tablist"] { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--line); }
.toc [role="tab"] { min-height: 44px; padding: var(--space-2) var(--space-3); font-size: 0.8125rem; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
.toc [role="tab"][aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.toc [role="tabpanel"][hidden] { display: none; }
.toc-topic-group, .toc-tag-group, .toc-match-group { margin: var(--space-4) 0; }
.toc-summary { font-size: 0.9375rem; color: var(--muted); margin: var(--space-1) 0 var(--space-2); }
.toc ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.toc-item { display: block; min-height: 44px; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); }
.toc-item[hidden] { display: none; }

.header { padding-top: var(--space-6); }
.header .date { color: var(--muted); font-size: 0.8125rem; margin: 0; }

.filter-bar { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-4); margin: var(--space-4) 0; }
.filter-bar summary { cursor: pointer; font-size: 0.8125rem; font-weight: 600; min-height: 44px; display: flex; align-items: center; }
.filter-group { margin: var(--space-3) 0; }
.filter-group-label { display: block; font-size: 0.8125rem; font-weight: 600; color: var(--muted); margin-bottom: var(--space-2); }
.chip { display: inline-flex; align-items: center; padding: var(--space-1) var(--space-3); margin: 2px; border-radius: var(--radius-full); font-size: 0.8125rem; font-weight: 600; color: var(--ink); background: var(--surface-sunken); }
.chip-filter { min-height: 44px; border: 1px solid var(--line); cursor: pointer; }
.chip-filter[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.pos-node { display: inline-flex; align-items: center; }
.pos-children { margin-left: var(--space-3); display: inline-flex; flex-wrap: wrap; }
.filter-reset { min-height: 44px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); border: 1px solid var(--line); background: var(--bg); font-weight: 600; cursor: pointer; }
.result-count { font-size: 0.8125rem; color: var(--muted); }

.card-list { display: flex; flex-direction: column; gap: var(--space-6); }
.card { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-4); cursor: pointer; scroll-margin-top: calc(var(--sticky-player-h) + var(--space-4)); }
.card[hidden] { display: none; }
.card--highlighted { border-color: var(--accent); border-width: 2px; }
.card-head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2); }
.chip-time, .chip-part { background: var(--surface-sunken); }
.breadcrumb { color: var(--muted); font-size: 0.8125rem; }
.chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-2) 0; }
.chip-pos-gk { background: var(--pos-gk-bg); color: var(--pos-gk-fg); }
.chip-pos-df { background: var(--pos-df-bg); color: var(--pos-df-fg); }
.chip-pos-mf { background: var(--pos-mf-bg); color: var(--pos-mf-fg); }
.chip-pos-fw { background: var(--pos-fw-bg); color: var(--pos-fw-fg); }
.related-members { font-size: 0.8125rem; color: var(--muted); }
.note-dl { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3); font-size: 1rem; line-height: 1.7; margin: var(--space-4) 0; }
.note-dl dt { font-weight: 600; color: var(--muted); }
.note-dl dd { margin: 0; }
.key-images { display: grid; grid-template-columns: 1fr; gap: var(--space-4); margin: var(--space-4) 0; }
.key-images figure { margin: 0; }
.key-images figcaption { font-size: 0.75rem; color: var(--muted); margin-top: var(--space-1); }
.similar-list, .refs-list { font-size: 0.9375rem; margin: var(--space-4) 0; padding-left: 1.1rem; }
.ref-badges { display: inline-flex; gap: var(--space-1); }
.badge { display: inline-block; background: var(--surface-sunken); color: var(--muted); font-size: 0.75rem; font-weight: 500; padding: 2px var(--space-2); border-radius: var(--radius-full); }
.watch-link { display: inline-block; margin-top: var(--space-2); font-weight: 600; }
.empty-state { text-align: center; color: var(--muted); padding: var(--space-8) 0; }
.empty-state[hidden] { display: none; }
.footer { padding: var(--space-8) 0; color: var(--muted); font-size: 0.8125rem; }

@media (min-width: 1024px) {
  .key-images { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 1023.98px) {
  .layout { display: flex; flex-direction: column; padding: var(--space-4); }
  .side { display: contents; }
  .header { order: 0; }
  .part-switch { order: 1; }
  .player-wrapper { order: 2; position: sticky; top: 0; z-index: 10; }
  .toc { order: 3; }
  .filter-bar { order: 4; }
  .result-count { order: 5; }
  .card-list { order: 6; }
  .empty-state { order: 6; }
  .footer { order: 7; }
}

.archive-main, .ref-main { max-width: 960px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
.session-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-6); margin: var(--space-6) 0; }
.session-card { display: block; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-4); }
.session-card .meta { color: var(--muted); font-size: 0.8125rem; }
.topic-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-2); }
.translations-table { width: 100%; border-collapse: collapse; margin: var(--space-4) 0; }
.translations-table th, .translations-table td { border: 1px solid var(--line); padding: var(--space-2); vertical-align: top; font-size: 0.9375rem; text-align: left; }
`;

// ── VIEWER_JS (DESIGN.md §5–§7) ──────────────────────────────────────────
//
// Static string, no interpolation. Reads only server-rendered `data-*`
// attributes (plan §1/§7 item 8/9). Session page loads this BEFORE the
// `iframe_api` script; init runs immediately when `window.YT && YT.loaded`,
// else it registers `window.onYouTubeIframeAPIReady` (plan §7/§12 item 8).

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

  var selected = { position: null, topic: [], mention: null, related: null };

  function activeFilterCount() {
    var n = 0;
    if (selected.position) n = n + 1;
    if (selected.topic.length > 0) n = n + 1;
    if (selected.mention) n = n + 1;
    if (selected.related) n = n + 1;
    return n;
  }

  function elementMatches(el) {
    var pos = el.getAttribute("data-pos") || "";
    var topics = el.getAttribute("data-topics") || "";
    var memberIds = el.getAttribute("data-member-ids") || "";
    var relatedIds = el.getAttribute("data-related-ids") || "";
    if (selected.position && !hasToken(pos, selected.position)) return false;
    if (selected.topic.length > 0 && !anyToken(topics, selected.topic)) return false;
    if (selected.mention && !hasToken(memberIds, selected.mention)) return false;
    if (selected.related && !hasToken(relatedIds, selected.related)) return false;
    return true;
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
    var filterCountLabel = document.getElementById("filter-count-label");
    if (filterCountLabel) filterCountLabel.textContent = String(activeFilterCount());
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

  function resetFilters() {
    selected = { position: null, topic: [], mention: null, related: null };
    var chips = document.querySelectorAll(".chip-filter[data-group]");
    for (var i = 0; i < chips.length; i++) chips[i].setAttribute("aria-pressed", "false");
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

  // ── video player (DESIGN.md §7) ──────────────────────────────────────

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
    window.fcPlayer = new YT.Player("yt-player", {
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

  function switchTo(videoId, start, embeddable) {
    document.body.dataset.video = videoId;
    if (!embeddable) {
      currentVideo = videoId;
      syncPartButtons();
      showPlaceholder(videoId, start);
      return;
    }
    showPlayer();
    if (!playerCreated) {
      currentVideo = videoId;
      syncPartButtons();
      ensurePlayer(videoId);
      if (start > 0) enqueueOrRun(function (player) { player.seekTo(start, true); });
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
    var interactive = event.target.closest ? event.target.closest("a, button, summary") : null;
    if (interactive) return;
    var card = event.target.closest ? event.target.closest(".card") : null;
    if (!card) return;
    var video = card.getAttribute("data-video");
    if (!video) return;
    var start = Number(card.getAttribute("data-start") || "0");
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

  initChips();
  initReset();
  initTabs();
  initToc();
  initCardClicks();
  initPartButtons();
  applyFilters();
  syncPlayerHeight();
  if (typeof ResizeObserver !== "undefined") {
    var playerWrapperEl = document.querySelector(".player-wrapper");
    if (playerWrapperEl) new ResizeObserver(syncPlayerHeight).observe(playerWrapperEl);
  }

  if (YT && YT.loaded) {
    initPlayer();
  } else {
    window.onYouTubeIframeAPIReady = initPlayer;
  }
})();`;
