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
import { anc, boldSpans, formatTime, isFaultTitleSegment, PARENT, positionFromLegacyCode, positionTagsFromLegacy, posClosure } from "./core.ts";

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
	/** Horizontal position (0..1, left to right) of the caption's subject in the frame; absent when the notes gave none. */
	focus_x?: number;
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
	format: "video" | "article";
	/** Why this reference matters for this unit's scene — one sentence. */
	relevance_ko: string;
	/** Where to start watching a video reference, in seconds; null for an article or a whole-video reference. */
	start_seconds: number | null;
	/** Ready-to-show version text ("FC 25 · 이전 버전", "FC 26"); null = show no version badge (non-game material, or a game material that states no version). */
	version_badge: string | null;
	/** Ready-to-show upload year-month ("2023년 1월") of a game material that states no version; null = show no date badge. */
	published_badge: string | null;
	/** The material is about Pro Clubs (one player, one position). */
	pro_clubs: boolean;
	/** Who published the material (channel or site name); names the reference that gives `lesson_ko`. */
	source_name: string;
	/** The action this material itself recommends for the unit's fault; `null` when it gives none for this unit. */
	lesson_ko: string | null;
}

/** A ref as read from a data.json that may predate `version_badge`/`published_badge`/`pro_clubs`/`source_name`/`lesson_ko` (see `versionBadgeFromLegacyData`, `publishedBadgeFromLegacyData`, `proClubsFromLegacyData`, `sourceNameFromLegacyData`, `lessonFromLegacyData`). */
export type UnitRefInput = Omit<UnitRef, "version_badge" | "published_badge" | "pro_clubs" | "source_name" | "lesson_ko"> & {
	version_badge?: string | null;
	published_badge?: string | null;
	pro_clubs?: boolean;
	source_name?: string;
	lesson_ko?: string | null;
};

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
	/** Players the feedback asks to change behaviour (criticized or instructed). */
	member_ids: string[];
	/** Roster members whose name/alias/gamertag occurs in the unit's source lines (script-derived); may overlap `member_ids`. */
	named_member_ids: string[];
	related_member_ids: string[];
	/** Members the unit addresses as part of its unnamed group (`group_positions`) by the position they played in the match; never overlaps `member_ids`. */
	position_target_ids: string[];
	/** Members who played a position of the unit's unnamed group (`group_positions`) in the match, fixers (`member_ids`) included; a superset of `position_target_ids`. */
	group_member_ids: string[];
	addressed_to_all: boolean;
	/** Display names of the YouTube comment writers whose timestamped comments this unit is built from; empty for narrated feedback. */
	comment_author_names: string[];
	/** Roster ids of people to fix whom no photo of the card lets the writer identify. */
	unidentified_member_ids: string[];
	/** Where in the card's photos to look instead when the people to fix cannot be identified or a caption says the title's receiver is not visible; `null` otherwise. */
	look_at: string | null;
	/** How the fault looked in the card's frames (who stood where, how the shape split); `null` when the title has no -ㅁ (fault) segment. */
	fault_scene: string | null;
	/** One sentence saying the source's left/right and the card's frames disagree (notes `direction_check_ko`); `null` when they do not or the direction is unknown. */
	direction_check_ko: string | null;
	/** Members in `member_ids` who are also the writer of one of the unit's comments (self-critique); a subset of `member_ids`. */
	self_critique_member_ids: string[];
	/** Members in `member_ids` whose role as actor was inferred because the source sentence has no subject; a subset of `member_ids`. */
	inferred_member_ids: string[];
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

/**
 * A problem that repeats across the session: the label and the units (document order) that each hit it once.
 * `member_ids` are the roster ids whose own repeated behaviour the label names; `[]` means the label names a
 * team unit or position, not specific people.
 */
export interface SessionRecurring {
	label: string;
	unit_ids: string[];
	member_ids: string[];
	/** The reference search for this label found nothing (the refs-draft lists it in `recurring_unfound`). */
	refs_unfound: boolean;
}

/** A recurring entry as read from a data.json that may predate `member_ids`/`refs_unfound` (see `recurringFromLegacyData`, `refsUnfoundFromLegacyData`). */
export type SessionRecurringInput = Omit<SessionRecurring, "member_ids" | "refs_unfound"> & { member_ids?: string[]; refs_unfound?: boolean };

export interface SessionMatch {
	id: string;
	title: string;
	topics: SessionTopic[];
	/** Member id → the position that member played in this match; `null`/absent = the lineup is unknown (see `lineupFromLegacyData`). */
	lineup?: Record<string, string> | null;
	/** Triangle colour above each human-controlled player in this match, in notes order; absent in a data.json written before it existed (see `markerLegendFromLegacyData`). */
	marker_legend?: SessionMarkerLegendEntry[];
	/** Name tags seen in this match that match no roster member, in notes order; absent in a data.json written before it existed (see `unmatchedNameTagsFromLegacyData`). Never a roster `member_id`. */
	unmatched_name_tags?: SessionUnmatchedNameTag[];
}

export interface SessionUnmatchedNameTag {
	/** The name tag as seen, e.g. "SAMBA". */
	tag: string;
	/** Korean colour word of the marker seen with that tag, e.g. "자홍"; absent when no colour was seen. */
	color?: string;
}

export interface SessionMarkerLegendEntry {
	member_id: string;
	/** Korean colour word, e.g. "분홍". */
	color: string;
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
	recurring: SessionRecurring[];
	/** Titles of matches in the videos that have no feedback unit, e.g. "2경기 · LVT 대 AL". */
	matches_without_feedback: string[];
}

/**
 * Legacy conversion: a data.json written before `recurring` existed has no such field; it reads as "nothing
 * repeats". An entry written before `member_ids` existed gets `member_ids: []`: no named owner, so
 * "내가 고칠 것 k" (DESIGN §6a) counts nothing for it and only "내 포지션 대상" applies.
 */
export function recurringFromLegacyData(data: { recurring?: SessionRecurringInput[] }): SessionRecurring[] {
	return (data.recurring ?? []).map((entry) => ({ ...entry, member_ids: entry.member_ids ?? [], refs_unfound: refsUnfoundFromLegacyData(entry) }));
}

/** Legacy conversion: a recurring entry written before `refs_unfound` existed reads as `false` (no "추천 자료 없음" marker). */
export function refsUnfoundFromLegacyData(entry: { refs_unfound?: boolean }): boolean {
	return entry.refs_unfound ?? false;
}

/** Legacy conversion: a data.json written before `matches_without_feedback` existed reads as `[]` (every match has feedback). */
export function matchesWithoutFeedbackFromLegacyData(data: { matches_without_feedback?: string[] }): string[] {
	return data.matches_without_feedback ?? [];
}

/** Legacy conversion: a match written before `marker_legend` existed reads as `[]` (no colour legend). */
export function markerLegendFromLegacyData(match: { marker_legend?: SessionMarkerLegendEntry[] }): SessionMarkerLegendEntry[] {
	return match.marker_legend ?? [];
}

/** Legacy conversion: a match written before `unmatched_name_tags` existed reads as `[]` (no name tag outside the roster). */
export function unmatchedNameTagsFromLegacyData(match: { unmatched_name_tags?: SessionUnmatchedNameTag[] }): SessionUnmatchedNameTag[] {
	return match.unmatched_name_tags ?? [];
}

/**
 * Legacy conversion: a match written before `lineup` existed (or validated without one) has no lineup; it reads as
 * `null` = unknown, and then an `addressed_to_all` unit of that match reaches every roster member. A lineup written
 * with the retired left/right position codes reads with the side-agnostic code (`positionFromLegacyCode`).
 */
export function lineupFromLegacyData(match: { lineup?: Record<string, string> | null }): Record<string, string> | null {
	if (match.lineup === undefined || match.lineup === null) return null;
	return Object.fromEntries(Object.entries(match.lineup).map(([memberId, position]) => [memberId, positionFromLegacyCode(position) ?? position]));
}

/** Legacy conversion: a unit written before the side-agnostic position tree carries retired left/right codes (LB, RW, CF, ...); they read as the current codes, duplicates collapsed. */
export function positionTagsFromLegacyData(unit: { position_tags: string[] }): string[] {
	return positionTagsFromLegacy(unit.position_tags);
}

/**
 * The roster members an `addressed_to_all` unit reaches: those who played its match — in the match's lineup, or named
 * in the source of any unit of that match (`matchNamedIds`; a player heard in the match whose position is unknown is
 * not in the lineup) — or every member when that lineup is unknown (`null`). A unit that is not `addressed_to_all`
 * reaches nobody this way.
 */
function addressedMemberIds(unit: SessionUnit, lineup: Record<string, string> | null, matchNamedIds: ReadonlySet<string>, members: readonly SessionMemberInfo[]): string[] {
	if (!unit.addressed_to_all) {
		return [];
	}
	return members.filter((member) => lineup === null || Object.hasOwn(lineup, member.id) || matchNamedIds.has(member.id)).map((member) => member.id);
}

/** Legacy conversion: a unit written before `self_critique_member_ids` existed reads as `[]` (no self-critique marker). */
/** Legacy conversion: a unit written before `inferred_member_ids` existed inferred no actor. */
export function inferredMemberIdsFromLegacyData(unit: { inferred_member_ids?: string[] }): string[] {
	return unit.inferred_member_ids ?? [];
}

export function selfCritiqueMemberIdsFromLegacyData(unit: { self_critique_member_ids?: string[] }): string[] {
	return unit.self_critique_member_ids ?? [];
}

/**
 * Legacy conversion: a data.json written before `named_member_ids` existed has no such field. In that
 * older data `member_ids` meant "names called in the source", which is what `named_member_ids` means
 * now, so the older `member_ids` is the named list.
 */
export function namedMemberIdsFromLegacyData(unit: { member_ids: string[]; named_member_ids?: string[] }): string[] {
	return unit.named_member_ids === undefined ? unit.member_ids : unit.named_member_ids;
}

/** The closing words of the `version_badge` an older render wrote for a game material that states no version ("버전 미표기", or "2023년 1월 · 버전 미표기" when the upload month was known). */
const LEGACY_UNSTATED_VERSION_TEXT = "버전 미표기";
const LEGACY_UNSTATED_VERSION_SUFFIX = ` · ${LEGACY_UNSTATED_VERSION_TEXT}`;

/**
 * Legacy conversion: a ref written before `version_badge` existed reads as `null` (show no version badge); so does one whose older
 * `version_badge` only said the version was not stated ("버전 미표기", "2023년 1월 · 버전 미표기") — that text is not a version.
 */
export function versionBadgeFromLegacyData(ref: { version_badge?: string | null }): string | null {
	const text = ref.version_badge ?? null;
	return text !== null && text.endsWith(LEGACY_UNSTATED_VERSION_TEXT) ? null : text;
}

/**
 * Legacy conversion: a ref written before `published_badge` existed reads its upload month out of an older `version_badge` of the form
 * "2023년 1월 · 버전 미표기" ("2023년 1월"); any other older `version_badge` carries no date (`null`). A `published_badge` already in the data wins.
 */
export function publishedBadgeFromLegacyData(ref: { version_badge?: string | null; published_badge?: string | null }): string | null {
	if (ref.published_badge !== undefined) {
		return ref.published_badge;
	}
	const text = ref.version_badge ?? null;
	return text !== null && text.endsWith(LEGACY_UNSTATED_VERSION_SUFFIX) ? text.slice(0, -LEGACY_UNSTATED_VERSION_SUFFIX.length) : null;
}

/** Legacy conversion: a ref written before `pro_clubs` existed reads as `false` (not about Pro Clubs). */
export function proClubsFromLegacyData(ref: { pro_clubs?: boolean }): boolean {
	return ref.pro_clubs ?? false;
}

/** Legacy conversion: a ref written before `lesson_ko` existed gives no lesson (`null`, no "자료가 권하는 것" line). */
export function lessonFromLegacyData(ref: { lesson_ko?: string | null }): string | null {
	return ref.lesson_ko ?? null;
}

/** Legacy conversion: a ref written before `source_name` existed names its source by its own title. */
export function sourceNameFromLegacyData(ref: { title: string; source_name?: string }): string {
	return ref.source_name ?? ref.title;
}

/**
 * Legacy conversion: a unit written before `position_target_ids` existed addressed its whole position unit exactly
 * when it named nobody to fix (`member_ids` empty), and then `related_member_ids` held those members.
 */
export function positionTargetIdsFromLegacyData(unit: { member_ids: string[]; related_member_ids: string[]; position_target_ids?: string[] }): string[] {
	return unit.position_target_ids ?? (unit.member_ids.length === 0 ? unit.related_member_ids : []);
}

/**
 * Legacy conversion: a unit written before `group_member_ids` existed has no record of which fixers played in its group,
 * so its group members are exactly the (legacy-read) position targets.
 */
export function groupMemberIdsFromLegacyData(unit: { member_ids: string[]; related_member_ids: string[]; position_target_ids?: string[]; group_member_ids?: string[] }): string[] {
	return unit.group_member_ids ?? positionTargetIdsFromLegacyData(unit);
}

/** Legacy conversion: a unit written before `look_at` existed reads as `null` (no pointer to where to look). */
export function lookAtFromLegacyData(unit: { look_at?: string | null }): string | null {
	return unit.look_at ?? null;
}

/** Legacy conversion: a unit written before `direction_check_ko` existed reads as `null` (no "방향 확인 필요" line). */
export function directionCheckFromLegacyData(unit: { direction_check_ko?: string | null }): string | null {
	return unit.direction_check_ko ?? null;
}

/** Legacy conversion: a unit written before `fault_scene` existed reads as `null` (no scene line under the title). */
export function faultSceneFromLegacyData(unit: { fault_scene?: string | null }): string | null {
	return unit.fault_scene ?? null;
}

/** Legacy conversion: a unit written before `unidentified_member_ids` existed reads as `[]` (nobody unidentified). */
export function unidentifiedMemberIdsFromLegacyData(unit: { unidentified_member_ids?: string[] }): string[] {
	return unit.unidentified_member_ids ?? [];
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
	format: "video" | "article";
	url: string;
	/** Where to start a video reference, in seconds; null for an article or a whole-video reference. */
	start_seconds: number | null;
	/** Ready-to-show version text; null = show no version badge. */
	version_badge: string | null;
	/** Ready-to-show upload year-month; null = show no date badge. */
	published_badge: string | null;
	/** The material is about Pro Clubs. */
	pro_clubs: boolean;
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
 * (DESIGN §10). Used by `titleHtml` below, so every site that goes through that shared
 * pipeline gets it, not just headings; takes already-escaped text, since escaping never
 * touches the parentheses this matches on.
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

/** Native-Korean numeral words this file glues to a following counter (item 6, round-6 CJK review), alongside plain Arabic digits. */
const NATIVE_NUMERAL_WORDS = "반|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|두세|서너|몇|여러";

/** Counters a numeral glues to (round-6/round-7 CJK review) - a trailing particle on the counter (e.g. "걸음씩") is untouched: only the space before the counter needs gluing. */
const COUNTER_WORDS =
	"걸음|번|명|개|초|분|칸|발|미터|m|차례|경기|세트|골|골대|포인트|점|박자|발짝|뼘|터치|번째|바퀴|야드|라인|줄";

/**
 * Matches each bound Korean grammatical construction this file glues (DESIGN §10/§15-1):
 * negation (-지 못/않) and the prohibitive (-지 말고/말아/말라/말자), -기(도/만) 전/시작/위해/때문, -다 보니/보면, -을/를/(ㄹ batchim) 수 있/없
 * (both spaces), -고 있/싶, -아/어 주/보/버리/놓, dependent noun 것/게/거/걸/건/겁(것이/것/것을/
 * 것은의 축약형) after -는/은/을/(ㄴ or ㄹ batchim), and a numeral(숫자 또는 한/두/세... 고유어
 * 수사) glued to its counter(초/분/번/명/개/걸음/... ), and the standalone 양 glued to the noun after it (양 팀). `\S*` is bounded by whitespace on both
 * sides, so it never crosses into a neighboring word - an ordinary inter-word space between two
 * independent words (e.g. "수비 전환") matches none of these and stays breakable. An optional
 * `\*{0,2}` on EITHER side of the glued space tolerates a bold span's marker landing exactly at
 * the construction boundary, whether the marker closes just before the space (e.g. "**하는**
 * 것") or opens just after it (e.g. "하는 **것**") - the one run-boundary case this can still
 * catch by running on the raw text before `boldSpans()` splits on "**" - see `glueKorean`'s own
 * comment for the reason that ordering, not per-span application, is used.
 */
const GLUE_PATTERNS: readonly RegExp[] = [
	/\S*지\*{0,2} \*{0,2}(?:못|않|말(?:고|아|라|자))/g,
	/\S*기(?:도|만)?\*{0,2} \*{0,2}(?:전|시작|위해|때문)/g,
	/\S*다\*{0,2} \*{0,2}(?:보니|보면)/g,
	new RegExp(`\\S*(?:을|를|[${RIEUL_BATCHIM}])\\*{0,2} \\*{0,2}수 \\*{0,2}(?:있|없)`, "g"),
	/\S*고\*{0,2} \*{0,2}(?:있|싶)/g,
	/\S*[아어]\*{0,2} \*{0,2}(?:주|보|버리|놓)/g,
	new RegExp(`\\S*(?:는|은|을|[${RIEUL_BATCHIM}${NIEUN_BATCHIM}])\\*{0,2} \\*{0,2}(?:것|게|거|걸|건|겁)`, "g"),
	// adnominal ending + 때 ("가졌을 때", "받을 때", "있는 때"); 때리-/때려-/때렸- (hit) is a verb, not 때(time).
	new RegExp(`\\S*(?:는|은|을|[${RIEUL_BATCHIM}${NIEUN_BATCHIM}])\\*{0,2} \\*{0,2}때(?!리|릴|려|렸)`, "g"),
	new RegExp(`(?:\\d+|${NATIVE_NUMERAL_WORDS})\\*{0,2} \\*{0,2}(?:${COUNTER_WORDS})`, "g"),
	// "양 팀"/"양 쪽": the standalone prefix 양(both) + the Hangul noun it modifies (DESIGN §10).
	/(?<![\uAC00-\uD7A3])양\*{0,2} \*{0,2}(?=[\uAC00-\uD7A3])/g,
	// short negation "안"/"못" (a standalone word) + the verb after it ("안 된다며", "못 했다"); "안쪽"/"못지않게" are not standalone, so they never match.
	/(?<![\uAC00-\uD7A3])(?:안|못)\*{0,2} \*{0,2}(?=[\uAC00-\uD7A3])/g,
	// "서 있"(standing: "떨어져 서 있고"): the standalone verb 서 + 있; "에서 있"/"서로" are not standalone 서, so they never match.
	/(?<![\uAC00-\uD7A3])서\*{0,2} \*{0,2}있/g,
	// a standalone 쪽 stays with the word it follows ("우사 쪽", "좌측 쪽"); "위쪽"/"쪽지" are not standalone, so they never match.
	/\S+\*{0,2} \*{0,2}쪽(?![\uAC00-\uD7A3])/g,
	// a date "10월 2일" stays together (DESIGN §10).
	/\d{1,2}월\*{0,2} \*{0,2}\d{1,2}일/g,
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
/** Longest run of capitalised Latin words `glueTitle` joins; a longer run stays breakable at its spaces, because one unbreakable chunk wider than the 390px column gets cut mid-word by `overflow-wrap: anywhere`. */
const MAX_LATIN_GLUE_WORDS = 3;
/** U+2060 WORD JOINER: forbids a line break at its position without adding a visible space (used before a spaceless "·"). */
const WORD_JOINER = "\u2060";

/** A ")" immediately followed by a Korean particle (longest first); the particle must end there so ")이름" (a noun starting with 이) is untouched. Matches only the ")" itself. */
const PAREN_THEN_PARTICLE = /\)(?=(?:에서|으로|까지|부터|처럼|보다|이|가|은|는|을|를|의|에|로|와|과|도|만)(?![\uAC00-\uD7A3]))/g;

/**
 * `**` bold markers never render as glyphs (`boldSpans()` strips them into a `<strong>`
 * boundary), so they must not count toward the 14-syllable cap - counting them made an
 * over-long RAW run trigger a cap-split it didn't visually need, or land the split at the
 * wrong spot (round-6 CJK review). NBSP counts as one ordinary character here, same as any
 * other glyph - it already renders as a single space-width character.
 */
function displayLength(text: string): number {
	return text.replace(/\*/g, "").length;
}

/** Un-glues the earliest joint that keeps `run`'s displayed length within `MAX_GLUE_RUN`, recursing on the remainder - pure, called only by `capGlueRunLength`. */
function capGlueRun(run: string): string {
	if (displayLength(run) <= MAX_GLUE_RUN) {
		return run;
	}
	let breakAt = -1;
	let shownBefore = 0; // displayLength(run.slice(0, i)) - the display count BEFORE position i
	for (let i = 0; i < run.length; i++) {
		if (run[i] === NBSP && shownBefore < MAX_GLUE_RUN) {
			breakAt = i;
		}
		if (run[i] !== "*") {
			shownBefore++;
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
	return capGlueRunLength(glued)
		.replace(/([\uAC00-\uD7A3])\(/g, `$1${WORD_JOINER}(`)
		.replace(PAREN_THEN_PARTICLE, `)${WORD_JOINER}`)
		.replace(/(\d)([\u2013-])(?=\d)/g, `$1${WORD_JOINER}$2${WORD_JOINER}`)
		.replace(/([\uAC00-\uD7A3])·(?=[\uAC00-\uD7A3])/g, `$1·${WORD_JOINER}`);
}

/** The "행위자: " opening a card-title segment (at most 20 characters before the first colon): the colon is bound to the first word after it, so the actor never stands alone at a line end. */
const TITLE_ACTOR_COLON = /^([^:\s][^:]{0,19}:) (?=\S)/;

/** A one-syllable determiner or adverb (한/이/그/각/더 + space + the next word): a line must not end after it, leaving "한" alone at a line end. */
const ONE_SYLLABLE_DETERMINER = /(?<![\uAC00-\uD7A3])([한이그각더]) (?=[\uAC00-\uD7A3A-Za-z0-9])/g;

/** A parenthesis closing a title fragment (optionally followed by the clause's " /"), e.g. "(필요해 보임)": the preceding word is bound to it so the hedge never stands alone on a line. */
const TRAILING_PAREN = /(\S) (\([^()]*\))(?= \/$|$)/;

/** A parenthetical of at most 12 characters closing a title fragment, e.g. "(찬스가 있었을 듯)": its inner spaces are NBSP so a line never breaks inside it. */
const SHORT_TRAILING_PAREN = /\(([^()]{1,12})\)(?= \/$|$)/;

/**
 * Title-only gluing on top of `glueKorean` (DESIGN §10): runs of 2-3 consecutive capitalised Latin words (a proper
 * noun such as "Los Veteranos"; longer runs stay breakable) are joined with NBSP, and a " ·" separator is glued to the word before it
 * so a line never starts with "·"; a parenthesis ending the fragment ("(필요해 보임)") is bound to the word before it; a "·" with no space before it gets a U+2060 WORD JOINER in front for the same reason. A game-version
 * name ("FC 26", "FIFA 23" - family + number) is bound with NBSP so a line never breaks inside the version. Spaces inside parentheses stay
 * breakable: gluing them made "이름(NAME 이름표)가" one chunk wider than a 390px caption column, which overflow-wrap cut mid-chunk. Runs after `glueKorean` so its `MAX_GLUE_RUN` cap cannot undo these joints.
 */
function glueTitle(text: string): string {
	return glueKorean(text)
		.replace(ONE_SYLLABLE_DETERMINER, `$1${NBSP}`)
		.replace(/(\S) & (?=\S)(?![^()]*\))/g, `$1${NBSP}&${NBSP}`)
		.replace(/슈퍼 캔슬/g, `슈퍼${NBSP}캔슬`)
		.replace(/(?<![A-Za-z])[A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)+/g, (run) =>
			run.split(" ").length <= MAX_LATIN_GLUE_WORDS ? run.replaceAll(" ", NBSP) : run,
		)
		.replace(/(?<![A-Za-z])(FC|FIFA) (\d+)/g, `$1${NBSP}$2`)
		.replace(TRAILING_PAREN, `$1${NBSP}$2`)
		.replace(SHORT_TRAILING_PAREN, (_paren, inner: string) => `(${inner.replaceAll(" ", NBSP)})`)
		.replace(/(\S) ·/g, `$1${NBSP}·`)
		.replace(/(?<=\S)·/g, `${WORD_JOINER}·`);
}

/**
 * The one shared pipeline for rendering Korean display text (DESIGN §5/§8/§10/§12): glue bound
 * constructions, escape, then wrap "한글(영문)"-shaped tokens. Every title/heading/label and
 * every prose field (ref summary/key points/translation cells) routes through this single
 * helper — not a per-site ad hoc `escapeHtml(text)` — so none of them can silently fall back to
 * the untreated CJK line-break hazard (round-7 review: several call sites had).
 * `partPrefixHtml` returns markup placed before a " / "-joined part (the card title's "지적" label); it defaults to none.
 * `glueActor` (card title only) binds each part's "행위자:" to the word after it with NBSP.
 */
function titleHtml(text: string, partPrefixHtml: (part: string) => string = () => "", glueActor = false): string {
	const bindActor = (part: string): string => (glueActor ? part.replace(TITLE_ACTOR_COLON, `$1${NBSP}`) : part);
	const parts = text.split(" / ");
	if (parts.length === 1) {
		return partPrefixHtml(text) + wrapNobr(escapeHtml(glueTitle(glueShortFinalEojeol(bindActor(text)))));
	}
	// A " / " title is a list of clauses: each clause is an inline-block so a line break lands between
	// clauses, never inside one, and the slash stays at the end of the clause before it (never opens a
	// line). Only the last clause has no slash.
	return parts
		.map((part, index) => {
			const clause = index < parts.length - 1 ? `${bindActor(part)} /` : glueShortFinalEojeol(bindActor(part));
			return `<span class="title-part">${partPrefixHtml(part)}${wrapNobr(escapeHtml(glueTitle(clause)))}</span>`;
		})
		.join(" ");
}

const HANGUL_WORD = /^[\uAC00-\uD7A3]+$/;

/**
 * Keeps a short closing predicate on the line of the word before it (DESIGN §10, §15-1): a final eojeol of
 * at most 2 Hangul syllables ("놓침", "넓힘", "명을") is joined to the eojeol before it with NBSP, and
 * when that eojeol is itself a single syllable ("한" in "상대 한 명을") the join continues one eojeol
 * further. Runs before `glueKorean`, whose `MAX_GLUE_RUN` cap still bounds the joined run.
 */
function glueShortFinalEojeol(text: string): string {
	const words = text.split(" ");
	const last = words[words.length - 1] ?? "";
	if (words.length < 2 || !HANGUL_WORD.test(last) || last.length > 2) {
		return text;
	}
	let from = words.length - 2;
	while (from > 0 && HANGUL_WORD.test(words[from]) && words[from].length === 1) {
		from -= 1;
	}
	return [...words.slice(0, from), words.slice(from).join(NBSP)].join(" ");
}

// ── position tree display order (DESIGN.md §7) ──────────────────────────────
//
// core.ts's `PARENT` map already lists each parent's children in the exact
// order DESIGN.md §7 implies (CB,FB,WB / CDM,CM,CAM,SM / WF,ST) — this only adds the root ordering, which `PARENT` does
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

// `chip()` renders both ASCII-only labels (time/part chips) and free-form Korean ones (topic
// tags, §7/§12) through the same helper, so the label goes through titleHtml (glue->escape->nobr)
// rather than a bare escapeHtml -- titleHtml is a no-op past `escapeHtml` on pure-ASCII input, so
// the ASCII call sites are unaffected (round-8 review: this call site had bypassed titleHtml).
function chip(className: string, label: string): string {
	return `<span class="chip ${className}">${titleHtml(label)}</span>`;
}

/** The "(n)" count inside a facet chip, in its own span so VIEWER_JS can update it live (§7 live facet counts) without rebuilding the whole button. */
function chipCount(count: number): string {
	return `<span class="chip-count">(${count})</span>`;
}

function youtubeAt(video: string, seconds: number): string {
	return `https://youtu.be/${video}?t=${Math.floor(seconds)}`;
}

/**
 * A keyboard-reachable seek control (DESIGN §5/§13): renders the time label as a real
 * `<button>` instead of a decorative `<span>` so seeking works without a mouse, while the
 * card/frame area itself stays clickable too — `onCardListClick` reads `data-seek-t` first.
 */
function seekTimeButton(seconds: number, linkVideo: string | null): string {
	const label = formatTime(seconds);
	if (linkVideo !== null) {
		// Link-only session (no video is embeddable, DESIGN §9): the chip is a real new-tab link, not a seek.
		return (
			`<a class="chip chip-time seek-btn" href="${escapeHtml(youtubeAt(linkVideo, seconds))}" target="_blank" rel="noopener" ` +
			`aria-label="${escapeHtml(label)}부터 유튜브에서 보기">${escapeHtml(label)} ↗</a>`
		);
	}
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

// ── facet counts, session-wide build-time pass (DESIGN.md §7) ──────────────
//
// Every count below is computed once from the full session at build time,
// with no other group selected — this is what decides which options exist in
// the DOM at all (an option with 0 here is never rendered) and what each
// option's label shows before the visitor picks anything. Once a selection
// exists, VIEWER_JS recomputes each OTHER option's count live against the
// currently active conditions (§7's live faceted counts) and writes it into
// that option's `.chip-count` span — this build-time pass only ever produces
// the initial numbers.

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

/** The ids in a unit's "이름이 나온 선수" facet: asked to change behaviour (`member_ids`) ∪ named in the source (`named_member_ids`), no duplicates. */
function mentionIds(unit: SessionUnit): string[] {
	return [...new Set([...unit.member_ids, ...unit.named_member_ids])];
}

function countMentionMembers(data: SessionData): Map<string, number> {
	const counts = new Map<string, number>();
	for (const unit of data.units) {
		for (const id of mentionIds(unit)) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return counts;
}

/** `addressedMemberIds` of every unit, keyed by unit id. */
function addressedMemberIdsByUnit(data: SessionData): Map<string, string[]> {
	const lineupByMatch = new Map(data.matches.map((match) => [match.id, lineupFromLegacyData(match)]));
	const namedByMatch = new Map(data.matches.map((match) => [match.id, new Set(data.units.filter((unit) => unit.match_id === match.id).flatMap((unit) => unit.named_member_ids))]));
	return new Map(
		data.units.map((unit) => [unit.id, addressedMemberIds(unit, lineupByMatch.get(unit.match_id) ?? null, namedByMatch.get(unit.match_id) ?? new Set(), data.members)]),
	);
}

interface MineCount {
	/** Units where the member is asked to change behaviour (`member_ids`). */
	fix: number;
	/** Units addressed to the member's position group ("내 포지션 대상", `position_target_ids`). */
	positionTarget: number;
	/** Units addressed to everyone (`addressed_to_all`) that are neither of the above; they apply to the members in the unit's match lineup. */
	addressedToAll: number;
	/** Units that reach the member only by name (`named_member_ids`) or through another person's position-related correction. */
	reference: number;
}

/**
 * Per-member "내 피드백" pill counts (DESIGN §6): `fix` = units with the member in `member_ids`,
 * `positionTarget` = units addressed to the member's position unit, `addressedToAll` = the remaining
 * `addressed_to_all` units of a match the member played — in its lineup or named in its source (any member when that
 * lineup is unknown, see `addressedMemberIds`) (the pill's main number is `fix + positionTarget + addressedToAll`: everything the
 * member must act on), `reference` = the remaining units the member's selection would show (named in the
 * source, or another person's position-related correction). A member gets a pill when the four sum to >= 1 -
 * the same set the selection keeps, so main + reference add up to the selection's visible count when no
 * other filter is active.
 */
function countMineBreakdown(data: SessionData): Map<string, MineCount> {
	const counts = new Map<string, MineCount>();
	const addressedByUnit = addressedMemberIdsByUnit(data);
	for (const member of data.members) {
		const count: MineCount = { fix: 0, positionTarget: 0, addressedToAll: 0, reference: 0 };
		for (const unit of data.units) {
			if (unit.member_ids.includes(member.id)) count.fix += 1;
			else if (unit.position_target_ids.includes(member.id)) count.positionTarget += 1;
			else if (addressedByUnit.get(unit.id)?.includes(member.id)) count.addressedToAll += 1;
			else if (mentionIds(unit).includes(member.id) || unit.related_member_ids.includes(member.id)) count.reference += 1;
		}
		counts.set(member.id, count);
	}
	return counts;
}

// ── 내 피드백 (DESIGN.md §6) ─────────────────────────────────────────────

/** Tooltip on each "내 피드백" pill: which unit groups the main number and the "참고" number count (same groups as `countMineBreakdown`). */
const MINE_PILL_TITLE = "숫자: 내가 고칠 점 / 팀: 내 포지션 대상 + 전원 대상 / 참고: 이름이 나온 장면 + 같은 포지션 참고";

/** Visible legend under the pill row (a phone has no hover for `MINE_PILL_TITLE`): the same two groups, short. */
const MINE_PILL_LEGEND = "숫자: 내가 고칠 점 / 팀: 내 포지션 대상 · 전원 대상 / 참고: 이름이 나온 장면 · 같은 포지션 지적";

function renderMyFeedbackNav(data: SessionData): string {
	if (data.members.length === 0) {
		return "";
	}
	const counts = countMineBreakdown(data);
	const eligible = data.members.filter((member) => {
		const count = counts.get(member.id);
		return count !== undefined && count.fix + count.positionTarget + count.addressedToAll + count.reference > 0;
	});
	if (eligible.length === 0) {
		return "";
	}
	const pills = eligible
		.map((member) => {
			const count = counts.get(member.id) ?? { fix: 0, positionTarget: 0, addressedToAll: 0, reference: 0 };
			const teamCount = count.positionTarget + count.addressedToAll;
			const teamHtml = teamCount > 0 ? `<span class="count-team">· 팀 ${teamCount}</span>` : "";
			const referenceHtml = count.reference > 0 ? `<span class="count-ref">· 참고 ${count.reference}</span>` : "";
			// `role="listitem"` sits on this wrapper, not the button itself (DESIGN §6/§13):
			// an interactive control cannot also carry a structural list-item role.
			return (
				`<div role="listitem"><button type="button" class="pill pill-mine" title="${MINE_PILL_TITLE}" data-group="mine" data-value="${escapeHtml(member.id)}" data-label="${escapeHtml(member.name)}" aria-pressed="false">` +
				`${titleHtml(member.name)} <span class="count">${count.fix}</span>${teamHtml}${referenceHtml}</button></div>`
			);
		})
		.join("");
	return (
		`<nav class="my-feedback" aria-label="내 피드백">` +
		`<span class="my-feedback-label">내 피드백</span>` +
		`<div class="my-feedback-row" role="list">${pills}</div>` +
		`<p class="my-feedback-legend">${titleHtml(MINE_PILL_LEGEND)}</p>` +
		`</nav>`
	);
}

// ── 필터 바 (DESIGN.md §7) ───────────────────────────────────────────────

/**
 * `isRoot` marks GK/DF/MF/FW with `.chip-pos-root` (DESIGN §15-5/§15-10) so the tree's two
 * levels read differently at a glance — children (recursive calls below) never get it. A node
 * with children renders as `.pos-node--branch`: its own chip in a fixed left column, its
 * children wrapping in the row to the right (DESIGN §7) — the same two-column rule at every
 * depth is what keeps a nested branch (should the tree ever grow one) visually consistent with a root
 * branch instead of every chip at every depth flowing into one mixed row. A childless node
 * stays a plain `.pos-node` span (no row split needed).
 */
function renderPositionNode(tag: string, counts: Map<string, number>, tagged: ReadonlySet<string>, isRoot: boolean): string {
	// `counts` is the closure count (an FW-tagged card also counts for ST), so it cannot decide whether a node
	// exists: only a tag some unit carries, or an ancestor of one, renders (DESIGN §7).
	if (!tagged.has(tag)) {
		return "";
	}
	const count = counts.get(tag) ?? 0;
	const childHtml = childrenOf(tag)
		.map((child) => renderPositionNode(child, counts, tagged, false))
		.join("");
	const rootClass = isRoot ? " chip-pos-root" : "";
	// Display label stays on escapeHtml, not titleHtml: `tag` is a position code (GK/DF/.../FB/CB/
	// ...), a fixed ASCII vocabulary from core.ts's PARENT map -- it can never contain Hangul, so
	// glue/nobr treatment has nothing to do (round-8 CJK pipeline review).
	const button =
		`<button type="button" class="chip chip-filter${rootClass}" data-group="position" data-value="${escapeHtml(tag)}" aria-pressed="false">` +
		`${escapeHtml(tag)} ${chipCount(count)}</button>`;
	return childHtml
		? `<div class="pos-node pos-node--branch">${button}<div class="pos-children">${childHtml}</div></div>`
		: `<span class="pos-node">${button}</span>`;
}

function renderPositionFacetGroup(data: SessionData): string {
	const counts = countPositionNodes(data);
	const tagged = new Set(data.units.flatMap((unit) => unit.position_tags.flatMap((tag) => anc(tag))));
	const roots = POSITION_ROOTS.map((root) => renderPositionNode(root, counts, tagged, true)).join("");
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
			// data-value stays on escapeHtml (attribute); the visible label is free-form Korean
			// (core.ts's isValidTag allows arbitrary text with spaces), so it goes through titleHtml
			// (round-8 CJK pipeline review).
			return (
				`<button type="button" class="chip chip-filter" data-group="topic" data-value="${escapeHtml(tag)}" aria-pressed="false">` +
				`${titleHtml(tag)} ${chipCount(count)}</button>`
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
			// data-value/data-label stay on escapeHtml (attributes); the visible name goes through
			// titleHtml like every other displayed member name (round-8 CJK pipeline review).
			return (
				`<button type="button" class="chip chip-filter" data-group="mention" data-value="${escapeHtml(member.id)}" data-label="${escapeHtml(member.name)}" aria-pressed="false">` +
				`${titleHtml(member.name)} ${chipCount(count)}</button>`
			);
		})
		.join("");
	return `<div class="filter-group" data-role="filter-mention"><span class="filter-group-label">이름이 나온 선수</span>${chips}</div>`;
}

function renderFilterBar(data: SessionData): string {
	const groups = [renderPositionFacetGroup(data), renderTopicFacetGroup(data), renderMentionFacetGroup(data)]
		.filter((html) => html !== "")
		.join("");
	return (
		`<details class="filter-bar">` +
		`<summary><span class="filter-summary-label">필터 (<span id="filter-count-label">0</span>)<span class="filter-summary-detail"></span></span></summary>` +
		`<div class="filter-groups">${groups}</div>` +
		`<button type="button" class="filter-reset">전체 해제</button>` +
		`</details>`
	);
}

// ── TOC tabs (DESIGN.md §8) ──────────────────────────────────────────────

/** TOC item label: time chip (non-interactive, TOC click never seeks — DESIGN §8) + title. */
function tocItemLabel(unit: SessionUnit): string {
	return `${chip("chip-time", formatTime(unit.start))}<span class="toc-title">${titleHtml(unit.title)}</span>`;
}

/** The match ordinal ("2경기 · LVT 대 AL" → 2) a title opens with, or `null` when it does not (match titles are free text; the skill numbers them in video order, missing matches included). */
function matchOrdinal(title: string): number | null {
	const hit = /^\s*(\d+)\s*경기/.exec(title);
	return hit === null ? null : Number(hit[1]);
}

/**
 * Where each `matches_without_feedback` title stands among the matches that have feedback, in video order: `before` maps a feedback match id to the
 * titles whose ordinal is below that match's (and not below an earlier feedback match's), sorted by ordinal; `tail` holds the rest in input order —
 * ordinals above every feedback match's, and titles with no ordinal, which have no known place.
 */
function placeMatchesWithoutFeedback(data: SessionData): { before: Map<string, string[]>; tail: string[] } {
	const before = new Map<string, string[]>();
	const tail: string[] = [];
	for (const title of data.matches_without_feedback) {
		const ordinal = matchOrdinal(title);
		const next = ordinal === null ? undefined : data.matches.find((match) => (matchOrdinal(match.title) ?? -Infinity) > ordinal);
		if (next === undefined) {
			tail.push(title);
		} else {
			before.set(next.id, [...(before.get(next.id) ?? []), title]);
		}
	}
	for (const [matchId, titles] of before) {
		before.set(matchId, [...titles].sort((a, b) => (matchOrdinal(a) ?? 0) - (matchOrdinal(b) ?? 0)));
	}
	return { before, tail };
}

const noFeedbackText = (title: string): string => `${titleHtml(title)} — 피드백 없음`;
const noFeedbackLine = (title: string): string => `<p class="match-no-feedback">${noFeedbackText(title)}</p>`;

function renderTabMatch(data: SessionData): string {
	const placement = placeMatchesWithoutFeedback(data);
	const noFeedbackRows = (titles: readonly string[]): string => titles.map((title) => `<p class="toc-no-feedback">${noFeedbackText(title)}</p>`).join("");
	const unitById = new Map(data.units.map((unit) => [unit.id, unit]));
	const groups = data.matches
		.map((match) => {
			// A topic may group units that are not adjacent in time, so topics list by their earliest unit
			// (`data.units` is in time order) and a topic's own units by the same order.
			const timeIndex = (unitId: string): number => data.units.findIndex((unit) => unit.id === unitId);
			const earliest = (topic: SessionTopic): number => Math.min(...topic.unit_ids.map(timeIndex).filter((index) => index >= 0));
			const topics = [...match.topics]
				.sort((a, b) => earliest(a) - earliest(b))
				.map((topic) => {
					const items = [...topic.unit_ids]
						.sort((a, b) => timeIndex(a) - timeIndex(b))
						.map((unitId) => unitById.get(unitId))
						.filter((unit): unit is SessionUnit => unit !== undefined)
						.map(
							(unit) =>
								`<li><a class="toc-item" href="#${escapeHtml(unit.id)}" data-target="${escapeHtml(unit.id)}">${tocItemLabel(unit)}</a></li>`,
						)
						.join("");
					return (
						`<div class="toc-topic-group"><h3>${titleHtml(topic.title)}</h3>` +
						`<p class="toc-summary">${titleHtml(topic.summary)}</p>` +
						`<ul>${items}</ul></div>`
					);
				})
				.join("");
			return noFeedbackRows(placement.before.get(match.id) ?? []) + `<div class="toc-match-group"><h2>${titleHtml(match.title)}</h2>${topics}</div>`;
		})
		.join("");
	return `<div role="tabpanel" id="panel-match" aria-labelledby="tab-match">${groups}${noFeedbackRows(placement.tail)}</div>`;
}

function renderTabTopic(data: SessionData): string {
	// Largest group first (DESIGN §8); Array#sort is stable, so ties keep first-appearance order.
	const groupedTags = firstAppearanceTags(data.units)
		.map((tag) => ({ tag, units: data.units.filter((unit) => unit.topic_tags.includes(tag)) }))
		.sort((a, b) => b.units.length - a.units.length);
	const groups = groupedTags
		.map(({ tag, units }) => {
			const items = units
				.map(
					(unit) =>
						`<li><a class="toc-item" href="#${escapeHtml(unit.id)}" data-target="${escapeHtml(unit.id)}">${tocItemLabel(unit)}</a></li>`,
				)
				.join("");
			return (
				`<div class="toc-tag-group"><h2>${titleHtml(tag)} (<span class="toc-group-count">${units.length}</span>)</h2>` + `<ul>${items}</ul></div>`
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
		`</div>` +
		`<div class="player-toolbar">` +
		`<span class="player-mini-bar-text">▶ ${escapeHtml(miniBarPrefix)}0:00</span>` +
		`<button type="button" class="player-collapse" aria-expanded="true" aria-controls="player-media">플레이어 접기</button>` +
		`</div>` +
		`</div>`
	);
}

/** True when no video of the session can be embedded: the page has no player, only links out (DESIGN §4/§9). */
function isLinkOnly(data: SessionData): boolean {
	return data.videos.length > 0 && data.videos.every((video) => !video.embeddable);
}

/** Small non-sticky bar replacing the player in a link-only session — one "유튜브에서 시청 ↗" link per part. */
function renderWatchBar(data: SessionData): string {
	const multiPart = data.videos.length > 1;
	const links = data.videos
		.map(
			(video) =>
				`<a class="watch-bar-link" href="${escapeHtml(youtubeAt(video.id, 0))}" target="_blank" rel="noopener">${multiPart ? `Part ${video.part} ` : ""}유튜브에서 시청 ↗</a>`,
		)
		.join("");
	return `<div class="watch-bar">${links}<span class="watch-bar-note">시간을 누르면 유튜브에서 그 장면부터 열립니다</span></div>`;
}

function renderPartSwitch(data: SessionData): string {
	if (data.videos.length <= 1 || isLinkOnly(data)) {
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
	/** Link-only session: time chips are YouTube links and cards never seek (DESIGN §9). */
	linkOnly: boolean;
	members: SessionMemberInfo[];
	/** `sharedCommentAuthor` of the session: when non-null the header also names the writer (cards keep their own line). */
	sharedAuthor: string | null;
	/** `addressedMemberIds` of every unit, keyed by unit id. */
	addressedByUnit: Map<string, string[]>;
}

/**
 * The card's title line. A " / "-joined segment in the fault (-ㅁ) form (`isFaultTitleSegment`, the classifier `check plan` uses) gets a small
 * "지적" label before it, so the reader sees the line states a fault, not an action to take.
 */
function renderCardTitle(title: string): string {
	return titleHtml(title, (part) => (isFaultTitleSegment(part.trim()) ? `<span class="title-fault-label">지적</span> ` : ""), true);
}

function renderCardHead(unit: SessionUnit, ctx: CardContext): string {
	const video = ctx.videoById.get(unit.video);
	const partChip = ctx.multiPart && video !== undefined ? chip("chip-part", `P${video.part}`) : "";
	const match = ctx.matchById.get(unit.match_id);
	const topic = ctx.topicById.get(unit.topic_id);
	const path = match !== undefined && topic !== undefined ? `${titleHtml(match.title)} <span class="breadcrumb-topic"><span aria-hidden="true">›${NBSP}</span>${titleHtml(topic.title)}</span>` : "";
	const breadcrumb = path === "" && unit.comment_author_names.length === 0 ? "" : `<span class="breadcrumb">${path}${path !== "" && unit.comment_author_names.length > 0 ? " " : ""}${renderCardSource(unit, path !== "")}</span>`;
	return `<div class="card-head">` + seekTimeButton(unit.start, ctx.linkOnly ? unit.video : null) + partChip + breadcrumb + `</div>`;
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
	// data-member-id stays on escapeHtml (attribute); the visible name goes through titleHtml
	// (round-8 CJK pipeline review).
	return `<mark class="member-name" data-member-id="${escapeHtml(id)}">${titleHtml(name)}</mark>`;
}

/** "(추정 — 문장에 주어 없음)" right after the name of a fixer whose role as actor was inferred (`inferred_member_ids`); "" otherwise. */
function inferredMark(unit: SessionUnit, id: string): string {
	return unit.inferred_member_ids.includes(id) ? `<span class="inferred-mark">(추정 — 문장에 주어 없음)</span>` : "";
}

/**
 * "고칠 사람": the players the feedback asks to change behaviour (`member_ids`) — DESIGN §5 item 6. A player who
 * also wrote the unit's comment (`self_critique_member_ids`) carries a muted "(작성자 본인)" right after the name, so
 * the card does not read as someone else blaming them. The mark opens with NBSP and is `nowrap`: it never breaks from the name or inside itself.
 */
function renderMentionedLine(unit: SessionUnit, members: readonly SessionMemberInfo[], positionTargetPart = ""): string {
	if (unit.member_ids.length === 0) {
		return "";
	}
	const names = unit.member_ids
		.map((id) => renderMemberNameMark(id, memberName(members, id)) + inferredMark(unit, id) + (unit.self_critique_member_ids.includes(id) ? `<span class="self-critique-mark">${NBSP}(작성자 본인)</span>` : ""))
		.join(", ");
	return `<p class="mentioned-members">고칠 사람: ${names}${positionTargetPart}</p>`;
}

/**
 * "고칠 사람" and "대상(포지션)" lines (DESIGN §5 item 6). When the card has both and the 대상 names fit inline (at most `MAX_RELATED_INLINE`), they are one
 * line, "고칠 사람: … · 대상(DF): …", so the card's top meta takes one row on a phone; otherwise (no fixer, or a 대상 list that collapses into a
 * `<details>`) the lines stay separate. The "·" opens the 대상 part, never ends the fixer part's line.
 */
function renderFixerAndPositionTargetLines(unit: SessionUnit, members: readonly SessionMemberInfo[]): string {
	const targets = unit.position_target_ids;
	if (unit.member_ids.length === 0 || targets.length === 0 || targets.length > MAX_RELATED_INLINE) {
		return renderMentionedLine(unit, members) + renderPositionTargetLine(unit, members);
	}
	const positions = unit.position_tags.length > 0 ? `(${unit.position_tags.join(", ")})` : "";
	const names = targets.map((id) => renderMemberNameMark(id, memberName(members, id))).join(", ");
	return renderMentionedLine(unit, members, ` <span class="position-target-part">·${NBSP}대상${positions}: ${names}</span>`);
}

/** The ids named in the source that no earlier line of the card shows: `named_member_ids \ member_ids \ position_target_ids` (the "고칠 사람" and "대상(포지션)" lines already carry those names). */
function namedOnlyIds(unit: SessionUnit): string[] {
	return unit.named_member_ids.filter((id) => !unit.member_ids.includes(id) && !unit.position_target_ids.includes(id));
}

/** "언급": players whose name appears in the source without being asked to change behaviour and without being shown as a position target — DESIGN §5 item 6. */
function renderNamedLine(unit: SessionUnit, members: readonly SessionMemberInfo[]): string {
	const ids = namedOnlyIds(unit);
	if (ids.length === 0) {
		return "";
	}
	const names = ids.map((id) => renderMemberNameMark(id, memberName(members, id))).join(", ");
	return `<p class="mentioned-members named-members">언급: ${names}</p>`;
}

/** The "대상" label of an `addressed_to_all` unit: the title's actor (text before the first ":"), or "전원" when the title has no ":" or an empty actor. */
function addressedActor(title: string): string {
	const colon = title.indexOf(":");
	const actor = colon === -1 ? "" : title.slice(0, colon).trim();
	return actor === "" ? "전원" : actor;
}

/**
 * "대상" 표시(DESIGN §5 item 6): 이름을 부르지 않고 모두에게 하는 원칙 유닛에는 "대상: 전원"(제목 앞 행위자가
 * "전원"이 아니면 그 문구, 예 "대상: 키 작은 선수")을, 그 외 유닛에는 포지션이 있을 때 "대상: <포지션>"을 렌더한다.
 * 포지션만 말하는 이 줄은 바로 위 태그 행의 포지션 칩과 같은 말이라, 이미 대상을 말하는 줄이 있으면 생략한다:
 * "고칠 사람" 줄이 보이거나 "대상(포지션): 이름" 줄이 보이고(`hasNamedTargets`), 포지션이 모두 태그 행에 보일 때
 * (`MAX_CHIP_ROW_TAGS` 이하). roster 유무와 무관하게(disabled 모드에서도) 렌더하며 "언급:" 줄과 독립이다.
 */
function renderTargetLine(unit: SessionUnit, hasNamedTargets: boolean): string {
	if (unit.addressed_to_all) {
		return `<p class="mentioned-members addressed-all-line">${chip("chip-addressed-all", `대상: ${addressedActor(unit.title)}`)}</p>`;
	}
	const tagRowShowsAllPositions = unit.position_tags.length <= MAX_CHIP_ROW_TAGS;
	const targetsAlreadyShown = hasNamedTargets && tagRowShowsAllPositions;
	if (unit.position_tags.length > 0 && !targetsAlreadyShown) {
		return `<p class="target-position-line">${chip("chip-target-position", `대상: ${unit.position_tags.join(", ")}`)}</p>`;
	}
	return "";
}

function feedbackSourceLine(names: readonly string[]): string {
	return `<p class="feedback-source">댓글 작성 · ${names.map((name) => titleHtml(name)).join(", ")}</p>`;
}

/**
 * Comment-sourced feedback names its writer(s) on the card's header row, after the breadcrumb ("1경기 › 수비 조직 · 댓글 작성 뎁스차저"),
 * on every such card (even when the session header names the same single writer) so a reader who opens one card can tell whose written
 * review it is; narrated feedback renders nothing. The separator sits inside the inline-block span so a line break never leaves "·" at a line end.
 */
function renderCardSource(unit: SessionUnit, afterPath: boolean): string {
	if (unit.comment_author_names.length === 0) {
		return "";
	}
	const separator = afterPath ? `<span aria-hidden="true">· </span>` : "";
	return `<span class="card-source">${separator}댓글 작성 ${unit.comment_author_names.map((name) => titleHtml(name)).join(", ")}</span>`;
}

/** The single writer when every unit is comment feedback by that same one person (DESIGN §5 item 2: also named once in the session header); otherwise null. */
function sharedCommentAuthor(units: readonly SessionUnit[]): string | null {
	const first = units[0]?.comment_author_names;
	if (first === undefined || first.length !== 1) {
		return null;
	}
	return units.every((unit) => unit.comment_author_names.length === 1 && unit.comment_author_names[0] === first[0]) ? first[0] : null;
}

/** The label of a card's 장면/자료 줄: the same "<label> ·" shape and `.line-label` styling for both lines. */
function lineLabel(label: string): string {
	return `<span class="line-label">${label} ·</span>`;
}

/** "장면 · …" under the lesson line of a fault (-ㅁ) card: how the fault looked in the frames; "" when the unit has none. */
function renderFaultSceneLine(unit: SessionUnit): string {
	return unit.fault_scene === null ? "" : `<p class="fault-scene">${lineLabel("장면")} ${titleHtml(unit.fault_scene)}</p>`;
}

/**
 * A fault card whose every title segment is a fault (-ㅁ) and to which no ref gives a lesson states no action to take: say so under the
 * title instead of leaving the reader to look for one. It points to the 장면 line only when the card has one (a card with a
 * `direction_check_ko` has none); "" when any segment is a to-do (-기) or a ref gives a lesson.
 */
function renderNoActionLine(unit: SessionUnit): string {
	if (!unit.title.split(" / ").every((segment) => isFaultTitleSegment(segment.trim())) || unit.refs.some((ref) => ref.lesson_ko !== null)) {
		return "";
	}
	return `<p class="no-action">${titleHtml(unit.fault_scene === null ? "피드백에 고칠 행동은 적혀 있지 않다" : "피드백에 고칠 행동은 적혀 있지 않다 — 장면 줄 참고")}</p>`;
}

/** "방향 확인 필요 · …" right after the 장면 line (or where it would be): the source's left/right disagrees with the card's frames; "" when the unit has none. */
function renderDirectionCheckLine(unit: SessionUnit): string {
	return unit.direction_check_ko === null ? "" : `<p class="direction-check">${lineLabel("방향 확인 필요")} ${titleHtml(unit.direction_check_ko)}</p>`;
}

/** Element id of a ref's entry in a card's reference list (the target of the lesson line's source link). */
function refEntryId(unitId: string, refId: string): string {
	return `${unitId}-ref-${refId}`;
}

/** "자료가 권하는 것 · 교훈 (출처)" directly under the card title (the action comes first, before the 장면 line): the first ref of the unit that gives a lesson, attributed to that reference (never to the commenter) and linked to its entry in the card's reference list; "" when none does. */
function renderRefLessonLine(unit: SessionUnit): string {
	const ref = unit.refs.find((candidate) => candidate.lesson_ko !== null);
	if (ref === undefined || ref.lesson_ko === null) {
		return "";
	}
	return `<p class="ref-lesson">${lineLabel("자료가 권하는 것")} ${titleHtml(ref.lesson_ko)} <span class="ref-lesson-cite">(<a class="ref-lesson-source" href="#${escapeHtml(refEntryId(unit.id, ref.id))}">${escapeHtml(ref.source_name)}</a>)</span></p>`;
}

/**
 * "머리 위 표시: 홍길동 분홍 삼각형 · SAMBA 이름표(명단에 없음) 자홍 삼각형 · …" — the colour legend of a match's `marker_legend`, then its
 * `unmatched_name_tags` (the colour part is left out when the tag was seen without one); "" when the match has neither.
 */
function renderMarkerLegend(match: SessionMatch, members: readonly SessionMemberInfo[]): string {
	const entries = markerLegendFromLegacyData(match);
	const unmatched = unmatchedNameTagsFromLegacyData(match);
	if (entries.length === 0 && unmatched.length === 0) {
		return "";
	}
	const items = [
		...entries.map((entry) => `${memberName(members, entry.member_id)}${NBSP}${entry.color}${NBSP}삼각형`),
		...unmatched.map((entry) => `${entry.tag}${NBSP}이름표(명단에${NBSP}없음)${entry.color === undefined ? "" : `${NBSP}${entry.color}${NBSP}삼각형`}`),
	]
		.map((item) => titleHtml(item))
		.join(" · ");
	return `<span class="marker-legend">머리 위 표시: ${items}</span>`;
}

/** The `look_at` line's label, glued with NBSP so it never breaks across lines. */
const LOOK_AT_LABEL = `사진에서${NBSP}볼${NBSP}곳`;

/**
 * "사진에서 위치를 확인하지 못한 사람": roster ids to fix whom no photo of the card lets the writer identify, then the `look_at` line
 * (where in the photos to look instead). `look_at` also stands alone when a caption says the title's receiver is not visible and
 * nobody is unidentified; "" when there is neither.
 */
function renderUnidentifiedLine(unit: SessionUnit, members: readonly SessionMemberInfo[]): string {
	const lookAt = unit.look_at === null ? "" : `<p class="look-at">${LOOK_AT_LABEL}: ${titleHtml(unit.look_at)}</p>`;
	if (unit.unidentified_member_ids.length === 0) {
		return lookAt;
	}
	const names = unit.unidentified_member_ids.map((id) => titleHtml(memberName(members, id))).join(", ");
	return `<p class="unidentified-members">사진에서 위치를 확인하지 못한 사람: ${names}</p>${lookAt}`;
}

/** Above this many related members, `renderRelatedLine` collapses into a `<details>` (mobile readability — 13–14-name rows were unreadable). */
const MAX_RELATED_INLINE = 5;

/** How many names stay visible in the collapsed `<summary>` before "외 N명". */
const RELATED_SUMMARY_SHOWN = 4;

/** `position_target_ids` as the "대상(포지션): 이름" line (DESIGN §5 item 6): members the unit's unnamed position group makes responsible, next to "고칠 사람"; "" when there are none. */
function renderPositionTargetLine(unit: SessionUnit, members: readonly SessionMemberInfo[]): string {
	const positions = unit.position_tags.length > 0 ? `(${unit.position_tags.join(", ")})` : "";
	return renderNameList(unit.position_target_ids, members, `대상${positions}:`, "related-members position-target-members");
}

/** `relatedMembers(unit) \ member_ids \ named_member_ids \ position_target_ids` — the set difference DESIGN §5 item 8 requires (names already shown on the "고칠 사람"/"대상"/"언급" lines aren't repeated). */
function renderRelatedLine(unit: SessionUnit, members: readonly SessionMemberInfo[]): string {
	const ids = unit.related_member_ids.filter(
		(id) => !unit.member_ids.includes(id) && !unit.named_member_ids.includes(id) && !unit.position_target_ids.includes(id),
	);
	return renderNameList(ids, members, "같은 포지션:", "related-members");
}

/** A labelled name list: at most `MAX_RELATED_INLINE` names renders as the plain `<p>` line; more collapses into a native `<details>` (no JS needed) showing the first `RELATED_SUMMARY_SHOWN` names + "외 N명", with the rest revealed on expand. "" for no ids. */
function renderNameList(ids: readonly string[], members: readonly SessionMemberInfo[], label: string, className: string): string {
	if (ids.length === 0) {
		return "";
	}
	if (ids.length <= MAX_RELATED_INLINE) {
		const names = ids.map((id) => renderMemberNameMark(id, memberName(members, id))).join(", ");
		return `<p class="${className}">${label} ${names}</p>`;
	}
	const shownIds = ids.slice(0, RELATED_SUMMARY_SHOWN);
	const restIds = ids.slice(RELATED_SUMMARY_SHOWN);
	const shownNames = shownIds.map((id) => renderMemberNameMark(id, memberName(members, id))).join(", ");
	const restNames = restIds.map((id) => renderMemberNameMark(id, memberName(members, id))).join(", ");
	return (
		`<details class="${className}">` +
		`<summary>${label} ${shownNames}<span class="related-more"> 외 ${restIds.length}명</span></summary>` +
		`<span class="related-rest">${restNames}</span>` +
		`</details>`
	);
}

/** Frames wider than this width/height ratio get the phone pan box (DESIGN §5 item 4a). */
const ULTRAWIDE_RATIO = 2;

/**
 * The one conversion from a notes frame's optional `focus_x` to the point of the image (0..1 of its
 * width) that the pan box shows at its horizontal center on first paint. Absent focus means "no known
 * subject", so the box starts centered (0.5); the default lives here and nowhere is it stored as data.
 */
export function panCenterFromFocus(focusX: number | undefined): number {
	return focusX ?? 0.5;
}

/**
 * A frame `<img>`; an ultrawide one (width/height > 2) is wrapped in a pan box at every width: a fixed
 * readable height with a horizontal scroll inside the box only, plus a hint. VIEWER_JS scrolls the box
 * so `data-pan-center` (see `panCenterFromFocus`) sits at its horizontal center.
 */
function frameImage(
	image: { src: string; width: number; height: number },
	extraAttrs: string,
	linkHref: string | null = null,
	focusX: number | undefined = undefined,
): string {
	const bare = `<img src="${escapeHtml(image.src)}" width="${image.width}" height="${image.height}" ${extraAttrs}>`;
	const img =
		linkHref === null ? bare : `<a class="frame-link" href="${escapeHtml(linkHref)}" target="_blank" rel="noopener">${bare}</a>`;
	if (!isUltrawide(image)) {
		return img;
	}
	return `<div class="frame-pan"><div class="frame-pan-scroll" data-pan-center="${panCenterFromFocus(focusX)}">${img}</div><p class="frame-pan-hint" hidden>좌우로 밀어 보기</p></div>`;
}

/**
 * A body text block: glue bound constructions, escape, then turn only `boldSpans` bold segments
 * into `<strong>` (DESIGN §5 item 7/§10). Deliberately left off the shared `titleHtml()` pipeline
 * (round-8 CJK pipeline review): titleHtml's single-string signature has no way to split a bold
 * span, so it already re-implements glue+escape by hand per span here; adding wrapNobr's
 * "한글(영문)" nobr-wrap on top is not required either -- §10 excludes ordinary body-paragraph
 * word-wrap from the CJK check, and titleHtml's required-call-site list (§10) never names body
 * prose.
 */
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
function zoomLink(src: string, seconds: number): string {
	return `<a href="${escapeHtml(src)}" target="_blank" rel="noopener" class="zoom-link" aria-label="확대: ${escapeHtml(formatTime(seconds))} 프레임 원본">확대</a>`;
}

/** `unitStart`: a frame at the card's own start second (same m:ss) shows no time chip — the card header's chip and the watch link already give that time. */
function renderBodyFrame(block: UnitBodyFrameBlock, video: string, linkOnly: boolean, unitStart: number): string {
	// `alt` is an attribute -- a titleHtml() <span> inside it would just show as literal text, so
	// it stays on glueKorean+escapeHtml (glue only, no nobr). The visible figcaption span has no
	// such constraint, so it goes through the full titleHtml pipeline on the RAW caption (not the
	// already-glued `caption` above -- glueKorean is idempotent in practice, but there is no
	// reason to run it twice, round-8 CJK pipeline review).
	const caption = glueKorean(block.caption);
	const atUnitStart = formatTime(block.t) === formatTime(unitStart);
	return (
		`<figure class="body-frame${atUnitStart ? " no-time-chip" : ""}" data-frame-t="${block.t}">` +
		frameImage(block, `loading="lazy" alt="${escapeHtml(caption)}"`, linkOnly ? youtubeAt(video, block.t) : null, block.focus_x) +
		`<figcaption>${atUnitStart ? "" : seekTimeButton(block.t, linkOnly ? video : null)}<span class="body-frame-caption">${titleHtml(block.caption)}</span>` +
		zoomLink(block.src, block.t) + `</figcaption>` +
		`</figure>`
	);
}

function renderBody(body: UnitBodyBlock[], video: string, linkOnly: boolean, unitStart: number): string {
	const blocks = body
		.map((block) => (block.type === "text" ? renderBodyText(block.text) : renderBodyFrame(block, video, linkOnly, unitStart)))
		.join("");
	return `<div class="card-body">${blocks}</div>`;
}

function renderSimilarList(similar: UnitSimilar[]): string {
	if (similar.length === 0) {
		return "";
	}
	// href is an attribute (escapeHtml); date is an ISO date string, pure ASCII (escapeHtml);
	// title is the past session's Korean title, so it goes through titleHtml (round-8 CJK
	// pipeline review).
	const items = similar
		.map(
			(entry) =>
				`<li><a href="${escapeHtml(entry.href)}">${titleHtml(entry.title)}</a> · <span class="similar-date">${escapeHtml(entry.date)}</span></li>`,
		)
		.join("");
	return `<ul class="similar-list">${items}</ul>`;
}

/** A YouTube link opens at `start_seconds` via `t=`; other hosts have no portable start parameter, so the label alone carries the time. */
function refOpenLink(ref: Pick<UnitRef, "orig_url" | "start_seconds">): string {
	if (ref.start_seconds === null || ref.start_seconds === 0) {
		return `<a class="ref-link" href="${escapeHtml(ref.orig_url)}" target="_blank" rel="noopener">원문 ↗</a>`;
	}
	let href = ref.orig_url;
	try {
		const url = new URL(ref.orig_url);
		if (/(^|\.)youtube\.com$/.test(url.hostname)) {
			url.searchParams.set("t", `${ref.start_seconds}s`);
			href = url.toString();
		}
	} catch {
		// unparsable orig_url: open it as-is
	}
	return `<a class="ref-link" href="${escapeHtml(href)}" target="_blank" rel="noopener">자료 영상 ${escapeHtml(formatTime(ref.start_seconds))}부터 ↗</a>`;
}

/** Korean display name of a reference `kind` enum value. */
function refKindLabel(kind: UnitRef["kind"]): string {
	switch (kind) {
		case "eafc":
			return "EA FC";
		case "tactics":
			return "축구 전술";
	}
}

/** Badge row contents shared by the card's ref list and the ref page: format, kind, [프로클럽], [version], [upload month], [language unless "ko" — the page's own language]. */
function renderRefBadges(ref: Pick<UnitRef, "format" | "kind" | "lang" | "pro_clubs" | "version_badge" | "published_badge">): string {
	return (
		`<span class="badge ref-format">${ref.format === "video" ? "영상" : "글"}</span>` +
		`<span class="badge">${escapeHtml(refKindLabel(ref.kind))}</span>` +
		(ref.pro_clubs ? `<span class="badge badge-pro-clubs">프로클럽</span>` : "") +
		(ref.version_badge !== null ? `<span class="badge badge-version">${escapeHtml(ref.version_badge)}</span>` : "") +
		(ref.published_badge !== null ? `<span class="badge badge-published">${escapeHtml(ref.published_badge)}</span>` : "") +
		(ref.lang !== "ko" ? `<span class="badge">${escapeHtml(ref.lang.toUpperCase())}</span>` : "")
	);
}

function renderRefsList(unitId: string, refs: UnitRef[]): string {
	if (refs.length === 0) {
		return "";
	}
	const items = refs
		.map((ref) => {
			const summaryLink =
				ref.lang !== "ko" && ref.href !== null ? `<a class="ref-link" href="${escapeHtml(ref.href)}" target="_blank" rel="noopener">요약</a><span class="ref-sep" aria-hidden="true">·</span>` : "";
			// refKindLabel(ref.kind) is a fixed Korean label and ref.lang.toUpperCase() ("KO"/"EN") a fixed ASCII
			// enum (escapeHtml); ref.title and ref.relevance_ko are Korean display text, so they go
			// through titleHtml (round-8 CJK pipeline review).
			return (
				`<li id="${escapeHtml(refEntryId(unitId, ref.id))}"><span class="ref-title">${titleHtml(ref.title)}</span>` +
				`<span class="ref-badges">${renderRefBadges(ref)}</span>` +
				`<span class="ref-relevance">${titleHtml(ref.relevance_ko)}</span>` +
				`<span class="ref-links">${summaryLink}${refOpenLink(ref)}</span>` +
				`</li>`
			);
		})
		.join("");
	return `<p class="refs-label">참고자료</p><ul class="refs-list">${items}</ul>`;
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
function renderStartImage(image: UnitStartImage, startSeconds: number, tagsHtml: string): string {
	return (
		`<figure class="card-image">` +
		frameImage(image, `alt=""`) +
		`<figcaption>${tagsHtml}` +
		zoomLink(image.src, startSeconds) + `</figcaption>` +
		`</figure>`
	);
}

/** Groups similar/refs (items 9/10) as one visually-separated metadata block below the body (item 6) — "" when both are empty, so no bare separator renders. */
function renderMetaBlock(unit: SessionUnit): string {
	const similar = renderSimilarList(unit.similar);
	const refs = renderRefsList(unit.id, unit.refs);
	if (similar === "" && refs === "") {
		return "";
	}
	return `<div class="card-meta">${similar}${refs}</div>`;
}

/** Whether a frame image is ultrawide (`frameImage` wraps it in a pan box). */
function isUltrawide(image: { width: number; height: number }): boolean {
	return image.width / image.height > ULTRAWIDE_RATIO;
}

/** A card with any captioned body frame shows no separate (caption-less) start image (DESIGN §5 item 4). */
function hasBodyFrame(unit: SessionUnit): boolean {
	return unit.body.some((block) => block.type === "frame");
}

/** Card field order per DESIGN §5: header → title → 자료 교훈 → 장면 → mention badge → image → tag row → 고칠 사람/언급 → body → 위치 미확인 인물 → 같은 포지션 → similar → refs → watch link. */
function renderCard(unit: SessionUnit, ctx: CardContext, legendHtml = ""): string {
	const video = ctx.videoById.get(unit.video);
	const hasRoster = ctx.members.length > 0;
	return (
		`<article class="card" id="${escapeHtml(unit.id)}" ` +
		`data-video="${escapeHtml(unit.video)}" data-start="${unit.start}" ` +
		`data-pos="${escapeHtml(posClosure(unit.position_tags).join("|"))}" ` +
		`data-topics="${escapeHtml(unit.topic_tags.join("|"))}" ` +
		`data-member-ids="${escapeHtml(unit.member_ids.join("|"))}" ` +
		`data-named-ids="${escapeHtml(unit.named_member_ids.join("|"))}" ` +
		`data-mention-ids="${escapeHtml(mentionIds(unit).join("|"))}" ` +
		`data-related-ids="${escapeHtml(unit.related_member_ids.join("|"))}" ` +
		`data-position-target-ids="${escapeHtml(unit.position_target_ids.join("|"))}" ` +
		`data-group-member-ids="${escapeHtml(unit.group_member_ids.join("|"))}" ` +
		`data-addressed-to-all="${unit.addressed_to_all ? "true" : "false"}" ` +
		`data-addressed-member-ids="${escapeHtml((ctx.addressedByUnit.get(unit.id) ?? []).join("|"))}" ` +
		`data-embeddable="${(video?.embeddable ?? true) ? "true" : "false"}">` +
		renderCardHead(unit, ctx) +
		`<h3>${renderCardTitle(unit.title)}</h3>` +
		(legendHtml === "" ? "" : `<p class="match-legend">${legendHtml}</p>`) +
		renderRefLessonLine(unit) +
		renderNoActionLine(unit) +
		renderFaultSceneLine(unit) +
		renderDirectionCheckLine(unit) +
		(hasRoster ? `<p class="mention-badge" hidden></p>` : "") +
		(hasBodyFrame(unit)
			? renderChipRow(unit)
			: renderStartImage(unit.images.start, unit.start, renderChipRow(unit))) +
		(hasRoster
			? renderFixerAndPositionTargetLines(unit, ctx.members) + renderNamedLine(unit, ctx.members)
			: "") +
		renderTargetLine(unit, hasRoster && (unit.member_ids.length > 0 || unit.position_target_ids.length > 0)) +
		renderBody(unit.body, unit.video, ctx.linkOnly, unit.start) +
		renderUnidentifiedLine(unit, ctx.members) +
		(hasRoster ? renderRelatedLine(unit, ctx.members) : "") +
		renderMetaBlock(unit) +
		`<a class="watch-link" href="${escapeHtml(unit.watch_url)}" target="_blank" rel="noopener">경기 영상 ${formatTime(unit.start)}부터 보기 ↗</a>` +
		`</article>`
	);
}

// ── shared page shell ────────────────────────────────────────────────────

function pageShell(title: string, bodyAttrs: string, bodyHtml: string, scripts: string): string {
	// title stays on escapeHtml, never titleHtml: <title> is RCDATA -- the <span class="nobr">
	// wrapNobr() would insert renders as literal text instead of being parsed as an element, and
	// a browser tab title is never line-wrapped in the first place, so glueKorean's whole reason
	// to exist (protecting a bound construction from a mid-word line break) does not apply here
	// either (round-8 CJK pipeline review: a structural exception, not a bypass).
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

// ── 반복 지적 (DESIGN.md §6a) ─────────────────────────────────────────────

/**
 * Who a recurring time chip blames for its unit. `fixer_ids` = the unit's fixers (`member_ids`) who are also owners of the
 * label; `name` = their names when there are any, otherwise the actors of the unit title's " / " segments ("수비진",
 * "수비 라인", "전원") that are not roster members — a title naming only a team unit must not read as a person's fault.
 * When the label names nobody (`labelOwnerIds` empty) and the title has no such non-roster actor either, `name` is the unit's
 * fixers' names (with `fixer_ids` still []). `name` is "" when none of these exists. Only `fixer_ids` can make the chip "내가 고칠 것" for a member (DESIGN §6a).
 * `team_owned` = the name is a team unit's ("수비 라인"): such a chip is "내 포지션 대상" for every member of the unit's group (`group_member_ids`), fixers included.
 */
function recurringChipOwner(unit: SessionUnit, labelOwnerIds: readonly string[], members: readonly SessionMemberInfo[]): { fixer_ids: string[]; name: string; team_owned: boolean } {
	const fixerIds = unit.member_ids.filter((id) => labelOwnerIds.includes(id));
	if (fixerIds.length > 0) {
		return { fixer_ids: fixerIds, name: fixerIds.map((id) => memberName(members, id)).join("·"), team_owned: false };
	}
	const rosterLabels = new Set(members.flatMap((member) => [member.name, member.gamertag]).map((label) => label.trim().toLowerCase()));
	const actors = unit.title.split(" / ").flatMap((segment) => {
		const colon = segment.indexOf(": ");
		return colon <= 0 ? [] : segment.slice(0, colon).split("·").map((actor) => actor.trim());
	});
	const teamActors = [...new Set(actors.filter((actor) => actor !== "" && !rosterLabels.has(actor.toLowerCase())))];
	if (teamActors.length === 0 && labelOwnerIds.length === 0) {
		// The title names only roster members and the label names nobody: the chip still says whom the unit asks to change, but it is not "내가 고칠 것" (fixer_ids stays []).
		return { fixer_ids: [], name: unit.member_ids.map((id) => memberName(members, id)).join("·"), team_owned: false };
	}
	return { fixer_ids: [], name: teamActors.join("·"), team_owned: teamActors.length > 0 };
}

/**
 * "반복 지적" block above the card list: one row per repeated problem, most-repeated first (stable, so
 * ties keep plan order), each with its unit time chips as in-page anchors (same scroll+highlight as a
 * TOC click, never a seek). "" when nothing repeats.
 */
function renderRecurring(data: SessionData): string {
	const unitById = new Map(data.units.map((unit) => [unit.id, unit]));
	const items = data.recurring
		.map((entry) => ({
			label: entry.label,
			member_ids: entry.member_ids,
			refs_unfound: entry.refs_unfound,
			units: entry.unit_ids.map((id) => unitById.get(id)).filter((unit): unit is SessionUnit => unit !== undefined),
		}))
		.filter((entry) => entry.units.length > 0)
		.sort((a, b) => b.units.length - a.units.length)
		.map((entry) => {
			const chipOwners = entry.units.map((unit) => ({ unit, ...recurringChipOwner(unit, entry.member_ids, data.members) }));
			// "Mine" for a row is decided per chip: a chip's fixers, plus — for a chip owned by a team unit or an entry that names nobody — the members
			// who played the unit's group positions (`group_member_ids`). `entry.member_ids` alone would hide a team-unit chip from its own group.
			const isGroupChip = (chip: { team_owned: boolean }) => chip.team_owned || entry.member_ids.length === 0;
			const ownerIds = [...new Set(chipOwners.flatMap((chip) => [...chip.fixer_ids, ...(isGroupChip(chip) ? chip.unit.group_member_ids : [])]))];
			const chips = chipOwners
				.map(({ unit, fixer_ids: fixerIds, name: owner, team_owned: teamOwned }) => {
					const time = escapeHtml(formatTime(unit.start));
					const label = owner === "" ? `${time} ${escapeHtml(unit.title)}` : `${time} ${escapeHtml(owner)} — ${escapeHtml(unit.title)}`;
					return `<a class="chip chip-time recurring-unit" href="#${escapeHtml(unit.id)}" data-target="${escapeHtml(unit.id)}" data-fixer-ids="${escapeHtml(fixerIds.join("|"))}"${teamOwned ? ` data-team-owner="true"` : ""} aria-label="${label}">${time}${owner === "" ? "" : ` <span class="recurring-unit-owner">${escapeHtml(owner)}</span>`}</a>`;
				})
				.join("");
			return (
				`<li class="recurring-item" data-owner-ids="${escapeHtml(ownerIds.join("|"))}" data-label-owner-ids="${escapeHtml(entry.member_ids.join("|"))}"><span class="recurring-label">${titleHtml(entry.label)}</span>` +
				`<span class="recurring-meta"><span class="recurring-count" data-total="${entry.units.length}">×${entry.units.length}</span>` +
				(entry.refs_unfound ? `<span class="recurring-unfound">추천 자료 없음</span>` : "") +
				`</span><span class="recurring-units">${chips}</span></li>`
			);
		})
		.join("");
	if (items === "") {
		return "";
	}
	return `<section class="recurring" aria-labelledby="recurring-title"><h2 class="recurring-title" id="recurring-title">반복 지적</h2><p class="recurring-summary" hidden></p><ul class="recurring-list">${items}</ul><button type="button" class="recurring-more" aria-expanded="false" hidden></button></section>`;
}

/**
 * One muted line per match that has no feedback ("2경기 · LVT 대 AL — 피드백 없음", DESIGN §4), so the page does not
 * seem to skip a match. plan.json carries only the title, not the match's place among the others, so the lines follow the
 * card list instead of standing between cards. "" when every match has feedback.
 */
function renderMatchesWithoutFeedback(tail: readonly string[]): string {
	if (tail.length === 0) {
		return "";
	}
	const lines = tail.map((title) => noFeedbackLine(title)).join("");
	return `<div class="matches-without-feedback">${lines}</div>`;
}

// ── renderSession (DESIGN.md §4–§11) ──────────────────────────────────────

/** `SessionData` as read from a data.json that may predate `named_member_ids` (see `namedMemberIdsFromLegacyData`). */
export type SessionDataInput = Omit<SessionData, "units" | "recurring" | "matches_without_feedback"> & {
	recurring?: SessionRecurringInput[];
	matches_without_feedback?: string[];
	units: Array<
		Omit<SessionUnit, "named_member_ids" | "unidentified_member_ids" | "look_at" | "fault_scene" | "direction_check_ko" | "self_critique_member_ids" | "inferred_member_ids" | "position_target_ids" | "group_member_ids" | "refs"> & {
			named_member_ids?: string[];
			position_target_ids?: string[];
			group_member_ids?: string[];
			unidentified_member_ids?: string[];
			look_at?: string | null;
			fault_scene?: string | null;
			direction_check_ko?: string | null;
			self_critique_member_ids?: string[];
			inferred_member_ids?: string[];
			refs: UnitRefInput[];
		}
	>;
};

export function renderSession(input: SessionDataInput): string {
	const data: SessionData = {
		...input,
		recurring: recurringFromLegacyData(input),
		matches_without_feedback: matchesWithoutFeedbackFromLegacyData(input),
		members: input.members.map((member) => ({ ...member, positions: positionTagsFromLegacy(member.positions) })),
		matches: input.matches.map((match) => ({ ...match, lineup: lineupFromLegacyData(match) })),
		units: input.units.map((unit) => ({
			...unit,
			position_tags: positionTagsFromLegacyData(unit),
			named_member_ids: namedMemberIdsFromLegacyData(unit),
			unidentified_member_ids: unidentifiedMemberIdsFromLegacyData(unit),
			look_at: lookAtFromLegacyData(unit),
			fault_scene: faultSceneFromLegacyData(unit),
			direction_check_ko: directionCheckFromLegacyData(unit),
			self_critique_member_ids: selfCritiqueMemberIdsFromLegacyData(unit),
			inferred_member_ids: inferredMemberIdsFromLegacyData(unit),
			position_target_ids: positionTargetIdsFromLegacyData(unit),
			group_member_ids: groupMemberIdsFromLegacyData(unit),
			refs: unit.refs.map((ref) => ({ ...ref, version_badge: versionBadgeFromLegacyData(ref), published_badge: publishedBadgeFromLegacyData(ref), pro_clubs: proClubsFromLegacyData(ref), source_name: sourceNameFromLegacyData(ref), lesson_ko: lessonFromLegacyData(ref) })),
		})),
	};
	const matchById = new Map(data.matches.map((match) => [match.id, match]));
	const topicById = new Map(data.matches.flatMap((match) => match.topics.map((topic) => [topic.id, topic])));
	const videoById = new Map(data.videos.map((video) => [video.id, video]));
	const linkOnly = isLinkOnly(data);
	const ctx: CardContext = {
		matchById,
		topicById,
		videoById,
		multiPart: data.videos.length > 1,
		linkOnly,
		members: data.members,
		sharedAuthor: sharedCommentAuthor(data.units),
		addressedByUnit: addressedMemberIdsByUnit(data),
	};

	const total = data.units.length;
	const placement = placeMatchesWithoutFeedback(data);
	const cards = data.units
		.map((unit, index) => {
			const previous = data.units[index - 1];
			const startsMatch = previous === undefined || previous.match_id !== unit.match_id;
			const match = previous !== undefined && startsMatch ? matchById.get(unit.match_id) : undefined;
			const noFeedback = startsMatch ? (placement.before.get(unit.match_id) ?? []).map(noFeedbackLine).join("") : "";
			const dividerLegend = match === undefined ? "" : renderMarkerLegend(match, data.members);
			// The first match has no divider: its legend stands on the first card.
			const firstCardMatch = previous === undefined ? matchById.get(unit.match_id) : undefined;
			const cardLegend = firstCardMatch === undefined ? "" : renderMarkerLegend(firstCardMatch, data.members);
			return noFeedback + (match === undefined ? "" : `<h2 class="match-divider">${titleHtml(match.title)}${dividerLegend}</h2>`) + renderCard(unit, ctx, cardLegend);
		})
		.join("");

	const sideCol =
		`<div class="side-col">` +
		(linkOnly ? renderWatchBar(data) : renderPlayerWrapper(data)) +
		`<aside class="side">${renderPartSwitch(data)}<div class="toc-scroll">${renderToc(data)}</div></aside>` +
		`</div>`;

	const main =
		`<div class="main">` +
		renderMyFeedbackNav(data) +
		renderFilterBar(data) +
		`<div class="active-filters" hidden></div>` +
		`<p class="result-count">피드백 <span id="visible-count">${total}</span>/<span id="total-count">${total}</span></p>` +
		renderRecurring(data) +
		`<div class="card-list">${cards}</div>` +
		renderMatchesWithoutFeedback(placement.tail) +
		`<p class="empty-state" hidden>조건에 맞는 피드백이 없어요 <button type="button" class="filter-reset">전체 해제</button></p>` +
		`</div>`;

	const body =
		`<header class="header"><h1>${titleHtml(data.title)}</h1><p class="date">영상 업로드 ${escapeHtml(data.date)}</p>${ctx.sharedAuthor !== null ? feedbackSourceLine([ctx.sharedAuthor]) : ""}</header>` +
		`<div class="layout">${sideCol}${main}</div>` +
		`<footer class="footer"><p>${titleHtml(FOOTER_NOTICE)}</p></footer>`;

	const scripts =
		`<script>${VIEWER_JS}</script>\n` + `<script src="https://www.youtube.com/iframe_api" async></script>\n`;

	const bodyAttrs = ` data-video="${escapeHtml(data.videos[0]?.id ?? "")}"${linkOnly ? ' data-link-only="true"' : ""}`;
	return pageShell(data.title, bodyAttrs, body, scripts);
}

// ── renderIndex (DESIGN.md §12) ──────────────────────────────────────────

function renderSessionCard(entry: IndexSessionEntry): string {
	const tags = entry.topic_tags.map((tag) => chip("chip-topic", tag)).join("");
	return (
		`<a class="session-card" href="${escapeHtml(entry.href)}">` +
		`<p class="date">영상 업로드 ${escapeHtml(entry.date)}</p>` +
		`<h2>${titleHtml(entry.title)}</h2>` +
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
				.map((unit) => `<li><a class="toc-item" href="${escapeHtml(unit.href)}"><span class="toc-title">${titleHtml(unit.title)}</span></a></li>`)
				.join("");
			return `<div class="toc-tag-group"><h3>${titleHtml(tag)} (${units.length})</h3><ul>${items}</ul></div>`;
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
		`<footer class="footer"><p>${titleHtml(FOOTER_NOTICE)}</p></footer>` +
		`</main>`;

	return pageShell("fc-feedback 아카이브", "", html, "");
}

// ── renderRef (DESIGN.md §12) ─────────────────────────────────────────────

const MAX_TRANSLATION_ROWS = 5;

/** `RefPageData` as read from a refs.verified.json that may predate `version_badge`/`published_badge`/`pro_clubs`. */
export type RefPageInput = Omit<RefPageData, "version_badge" | "published_badge" | "pro_clubs"> & { version_badge?: string | null; published_badge?: string | null; pro_clubs?: boolean };

export function renderRef(input: RefPageInput): string {
	const ref: RefPageData = { ...input, version_badge: versionBadgeFromLegacyData(input), published_badge: publishedBadgeFromLegacyData(input), pro_clubs: proClubsFromLegacyData(input) };
	const keyPoints = ref.key_points_ko.map((point) => `<li>${titleHtml(point)}</li>`).join("");
	// row.orig is the foreign-language original sentence (DESIGN §10/§12: excluded from the CJK
	// glue treatment, since it isn't Korean); row.ko is the Korean translation and goes through
	// the same pipeline as every other Korean display field.
	const rows = ref.translations
		.slice(0, MAX_TRANSLATION_ROWS)
		.map(
			(row) =>
				`<tr><td data-label="원문">${escapeHtml(row.orig)}</td><td data-label="한국어">${titleHtml(row.ko)}</td></tr>`,
		)
		.join("");

	const html =
		`<main class="ref-main">` +
		`<h1>${titleHtml(ref.title)}</h1>` +
		`<p class="ref-badges">${renderRefBadges(ref)}</p>` +
		`<p class="plain-link">${refOpenLink({ orig_url: ref.url, start_seconds: ref.start_seconds })}</p>` +
		`<p class="summary-ko">${titleHtml(ref.summary_ko)}</p>` +
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
p, dd, li, figcaption, .translations-table td { text-wrap: pretty; word-break: keep-all; overflow-wrap: anywhere; line-break: strict; }
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
/* Thin row below the video, never overlaid on the iframe (DESIGN §4, round-7 visual QA) —
   hidden at ≥1024px alongside .player-collapse, where the collapse feature doesn't exist. */
.player-toolbar { display: none; }
.player-mini-bar-text { display: none; }
.player-collapse { display: none; }

/* Link-only session (DESIGN §4/§9): no player, a small non-sticky bar of "유튜브에서 시청 ↗" links. */
.watch-bar { flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--space-4); padding: 0 var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); font-size: 0.8125rem; font-weight: 600; }
.watch-bar-link { display: inline-flex; align-items: center; min-height: 44px; }
.watch-bar-note { flex-basis: 100%; padding-bottom: var(--space-2); color: var(--muted); font-size: 0.8125rem; font-weight: 400; }

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
.toc-no-feedback { font-size: 0.8125rem; color: var(--muted); margin: var(--space-6) 0 0; }
.toc-summary { font-size: 0.875rem; color: var(--muted); margin: var(--space-1) 0 var(--space-2); }
/* Shared with the archive's #by-topic list (DESIGN §12), which has no .toc ancestor of its own
   but reuses the same group/list classes and needs the same reset — without it the bare <ul>
   fell through to the browser default (bullets, ~40px indent). */
.toc ul, #by-topic ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.toc-item { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: var(--space-2); align-items: start; min-height: 44px; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); font-size: 0.875rem; color: var(--muted); text-decoration: none; }
.toc-item .chip-time { min-width: 8ch; justify-content: center; font-variant-numeric: tabular-nums; }
.toc-item > .toc-title:first-child { grid-column: 1 / -1; }
.toc-item .toc-title { text-decoration: inherit; }
.title-part { display: inline-block; text-decoration: inherit; }
/* A card title's slash-separated clauses are block lines (each clause starts a line), and the title wraps with pretty, not balance: balancing cut each clause into near-equal halves mid-phrase. */
.card h3 { text-wrap: pretty; }
.card h3 .title-part { display: block; }
.toc-item:hover, .toc-item:focus-visible, .toc-item.is-current { color: var(--accent); text-decoration: underline; }
.toc-item[hidden] { display: none; }
/* Archive topic list (DESIGN §12): items read as links (accent + underline), hairline-divided, with a fixed vertical padding so wrapped titles keep the rhythm. */
#by-topic ul { gap: 0; }
#by-topic li { border-bottom: 1px solid var(--line); }
#by-topic li:last-child { border-bottom: 0; }
#by-topic .toc-item { color: var(--accent); text-decoration: underline; padding: var(--space-3) var(--space-2); }
#by-topic .toc-item:hover, #by-topic .toc-item:focus-visible { color: var(--accent-hover); }

.main { flex: 1 1 auto; min-width: 0; max-width: var(--measure); display: flex; flex-direction: column; gap: var(--space-8); }

.my-feedback { display: flex; flex-direction: column; gap: var(--space-2); }
.my-feedback-label { font-size: 0.8125rem; font-weight: 700; }
.my-feedback-legend { margin: 0; font-size: 0.8125rem; line-height: 1.5; color: var(--muted); }
.my-feedback-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
/* Below 1024px the pill strip scrolls sideways: a right-edge alpha-mask fade (theme-independent) hints at it, and the end padding keeps the last pill clear of the fade. */
@media (max-width: 1023.98px) {
  .my-feedback-row { flex-wrap: nowrap; overflow-x: auto; white-space: nowrap; padding-bottom: var(--space-1); padding-right: var(--space-6); mask-image: linear-gradient(to right, #000 calc(100% - var(--space-6)), transparent); -webkit-mask-image: linear-gradient(to right, #000 calc(100% - var(--space-6)), transparent); }
}
/* role="listitem" wrapper (DESIGN §6/§13) — display:contents would drop the box
   these tests inspect, so it stays an ordinary inline-flex item instead. */
.my-feedback-row [role="listitem"] { display: inline-flex; flex-shrink: 0; }
.pill { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 44px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--bg); font-size: 0.8125rem; font-weight: 600; cursor: pointer; flex-shrink: 0; }
.pill .count { color: var(--muted); }
.pill .count-team { color: var(--ink); font-weight: 600; }
.pill .count-ref { color: var(--muted); font-weight: 400; }
.pill[aria-pressed="true"] { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.pill[aria-pressed="true"] .count, .pill[aria-pressed="true"] .count-team, .pill[aria-pressed="true"] .count-ref { color: var(--bg); }

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
/* Live count of 0 (§7): muted + not-allowed instead of removed, so the option keeps its slot
   (no layout jump) but reads and behaves as unpressable — never true for an already-selected
   option, which this same selector can't match since aria-pressed="true" never pairs with
   disabled (VIEWER_JS's applyFacetCounts). */
.chip-filter:disabled { cursor: not-allowed; opacity: 0.45; }
/* Position tree root (GK/DF/MF/FW) vs. child (DESIGN §15-5/§15-10 "구분 안 되는 트리"):
   bolder weight + the same neutral fill used elsewhere for a filled-but-inactive chip
   (--surface-sunken, §2) reads as "this is a group", not a second accent color — the
   pressed rule above still wins on specificity so an active state looks the same either way. */
.chip-pos-root { font-weight: 700; background: var(--surface-sunken); }
/* Nested position nodes wrap within the viewport instead of forcing a fixed-width single
   line off-screen (DESIGN §7/§15-5); chip margin is reset per node since the tree's own
   gap already spaces siblings — keeping both would double the gap (DESIGN §2). */
/* Each root is its own row — .pos-tree stacks branches in a column instead of letting every
   root/child chip wrap into one mixed flow ("MF-CDM-CM-FW-WF-ST" reading as a single line
   at 1440px). */
.pos-tree { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; max-width: 100%; }
.pos-node { display: inline-flex; align-items: center; min-width: 0; max-width: 100%; }
.pos-node .chip { margin: 0; }
/* Two-column row: the branch's own chip in a fixed-width left column, its children wrapping in
   the right column — applied identically at every nesting depth, so a nested branch (should
   the tree grow one) reads with the same rule and indent as a root branch, not a special case. */
.pos-node--branch { display: grid; grid-template-columns: minmax(64px, max-content) minmax(0, 1fr); align-items: start; gap: var(--space-2); width: 100%; }
.pos-children { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); min-width: 0; max-width: 100%; }
@media (max-width: 640px) {
  /* Narrow screens have no room for the indent column: children sit in their own row under the parent chip, indented by one step. */
  .pos-node--branch { grid-template-columns: minmax(0, 1fr); }
  /* One-column grid would stretch the branch chip to full width; keep it at its content width and indent the children one step. */
  .pos-node--branch > .chip { justify-self: start; }
  .pos-children { padding-left: var(--space-4); }
}
.chip-overflow { color: var(--muted); }
.filter-reset { min-height: 44px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--bg); font-size: 0.8125rem; font-weight: 600; cursor: pointer; margin-top: var(--space-3); }

.active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.active-filters[hidden] { display: none; }
.active-filters .filter-reset { margin-top: 0; }
.chip-active { gap: var(--space-1); }
.chip-remove { font-size: 0.875rem; line-height: 1; cursor: pointer; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }

.result-count { font-size: 0.8125rem; color: var(--muted); margin: 0; }

/* 반복 지적 (DESIGN §6a): label + ×N + time-chip anchors, one row per repeated problem. */
.recurring { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); }
.recurring[hidden], .recurring-item[hidden], .recurring-unit[hidden] { display: none; }
.recurring-title { margin: 0 0 var(--space-2); font-size: 0.8125rem; line-height: 1.4; font-weight: 700; }
.recurring-summary { margin: 0 0 var(--space-2); font-size: 0.875rem; line-height: 1.5; font-weight: 600; color: var(--muted); }
.recurring-summary[hidden] { display: none; }
.recurring-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.recurring-item { font-size: 0.875rem; }
.recurring-label { display: block; font-weight: 600; }
.recurring-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--space-2); }
.recurring-units { display: flex; flex-wrap: wrap; }
.recurring-count { color: var(--muted); font-weight: 600; }
/* Count text is split into parts, each starting with its own "·" so a line break never leaves a "·" at a line end. */
.recurring-count { display: flex; flex-wrap: wrap; column-gap: var(--space-2); }
.recurring-count-part { white-space: nowrap; }
.recurring-unfound { display: inline-block; padding: 0 var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-full); color: var(--muted); font-size: 0.8125rem; }
/* gap: .chip is inline-flex, so the whitespace text node between the time and the owner is dropped; the gap keeps "1:02:23 4백" from reading "1:02:234백". */
.recurring-unit { margin: var(--space-1) var(--space-1) var(--space-1) 0; min-height: 44px; max-width: 100%; white-space: normal; gap: var(--space-1); }
.recurring-unit-owner { min-width: 0; overflow-wrap: anywhere; }
.recurring-unit.is-mine { background: var(--mine-tint); }
@media (max-width: 640px) {
  /* Chips are 44px tall hit areas; the 4px right/bottom-only margin halves the gap so a row of time chips wraps in fewer lines. */
  .recurring-unit { margin: 0 var(--space-1) var(--space-1) 0; }
}
.recurring-more { display: none; min-height: 44px; margin-top: var(--space-2); padding: var(--space-2) var(--space-4); border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--bg); font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.recurring-more:not([hidden]) { display: inline-flex; align-items: center; }
.recurring:not(.is-expanded) .recurring-extra { display: none; }

.card-list { display: flex; flex-direction: column; gap: var(--space-6); }
.matches-without-feedback { display: flex; flex-direction: column; gap: var(--space-1); }
.match-no-feedback { margin: 0; font-size: 0.8125rem; color: var(--muted); }
/* Without this, [hidden]'s UA display:none loses to this file's own explicit display:flex
   above (author styles always beat the UA sheet) — the empty card list kept its flex slot at
   0 results, doubling the gap above .empty-state (round-6 CJK review). */
.card-list[hidden] { display: none; }
/* 30-second criterion (DESIGN §6): VIEWER_JS regroups the real DOM under these headings
   (direct → all → position), so keyboard and screen-reader order match the visual order. */
.mine-group-heading { margin: 0; font-size: 0.875rem; line-height: 1.4; font-weight: 700; color: var(--muted); }
.card { background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-4); cursor: pointer; scroll-margin-top: var(--space-4); }
body[data-link-only] .card, body[data-link-only] .card-body .body-frame { cursor: auto; }
.card[hidden] { display: none; }
.card--highlighted { border-color: var(--accent); border-width: 2px; }
.card-head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2); }
.chip-time, .chip-part { background: var(--surface-sunken); }
/* Keyboard-reachable seek control (DESIGN §5/§13): keeps the chip's small visual
   footprint while expanding its hit area to the 44px minimum via an invisible
   centered pseudo-element, instead of inflating the compact header row's own size. */
.seek-btn { cursor: pointer; position: relative; }
a.chip-time { color: var(--ink); text-decoration: none; }
.seek-btn::after { content: ""; position: absolute; top: 50%; left: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%); }
.breadcrumb { color: var(--muted); font-size: 0.8125rem; text-wrap: balance; }
/* The topic phrase moves to the next line whole instead of breaking mid-phrase ("› 무리한 / 가로채기와 패스"); its leading "›" travels with it, so no line ends with "›". */
.breadcrumb-topic { display: inline-block; }
@media (max-width: 640px) {
  /* A long breadcrumb gets its own full row so the time chip is not left alone and the phrase does not wrap mid-way. */
  .breadcrumb { flex-basis: 100%; }
}
.card-image { margin: var(--space-3) 0 0; }
.card-image img { width: 100%; height: auto; border: 1px solid var(--line); }
/* Tags (left) + 확대 (right) share one row instead of stacking on two — the tag box wraps
   within its own space; 확대 keeps its fixed width via .zoom-link's own flex-shrink:0 below. */
.card-image figcaption { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); font-size: 0.875rem; font-weight: 500; color: var(--muted); margin-top: var(--space-2); }
.card-image figcaption .chip-row { margin: 0; min-width: 0; }
.mention-badge { display: inline-block; margin: var(--space-2) 0 0; padding: var(--space-1) var(--space-3); border-radius: var(--radius-full); font-size: 0.8125rem; font-weight: 600; }
.mention-badge[hidden] { display: none; }
.mention-badge.mention-direct { background: var(--accent); color: var(--bg); }
.mention-badge.mention-named, .mention-badge.mention-position-target { background: var(--mine-tint); color: var(--ink); }
.mention-badge.mention-related, .mention-badge.mention-all { background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
.chip-addressed-all, .chip-target-position { background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
.chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) 0; }
.chip-pos-gk { background: var(--pos-gk-bg); color: var(--pos-gk-fg); }
.chip-pos-df { background: var(--pos-df-bg); color: var(--pos-df-fg); }
.chip-pos-mf { background: var(--pos-mf-bg); color: var(--pos-mf-fg); }
.chip-pos-fw { background: var(--pos-fw-bg); color: var(--pos-fw-fg); }
.mentioned-members, .related-members, .target-position-line, .unidentified-members, .look-at { font-size: 0.8125rem; color: var(--muted); margin: var(--space-2) 0 0; }
.self-critique-mark { color: var(--muted); font-weight: 400; white-space: nowrap; }
.marker-legend { display: block; margin-top: var(--space-1); font-size: 0.8125rem; line-height: 1.5; font-weight: 400; color: var(--muted); overflow-wrap: anywhere; }
.match-legend { margin: var(--space-1) 0 0; }
.inferred-mark { color: var(--muted); font-weight: 400; white-space: nowrap; }
/* The 대상 part of the merged "고칠 사람 · 대상" line moves whole to the next line (its leading "·" never ends a line); a long name list still wraps inside it. */
.position-target-part { display: inline-block; max-width: 100%; }
/* "지적" label after a fault (-ㅁ) title segment: a small outlined tag so the line reads as a stated fault, not an action to take. */
.title-fault-label { display: inline-block; padding: 0 var(--space-1); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); color: var(--muted); font-size: 0.8125rem; font-weight: 600; line-height: 1.4; vertical-align: middle; white-space: nowrap; }
/* Match header between consecutive cards of different matches; hidden when none of its match's cards is visible or a member is selected. */
.match-divider { margin: var(--space-4) 0 0; padding-bottom: var(--space-1); border-bottom: 1px solid var(--line-strong); font-size: 1rem; line-height: 1.4; font-weight: 700; overflow-wrap: anywhere; }
.match-divider[hidden] { display: none; }
.fault-scene { font-size: 0.875rem; line-height: 1.7; color: var(--muted); margin: var(--space-2) 0 0; }
.no-action { font-size: 0.875rem; line-height: 1.7; color: var(--muted); margin: var(--space-2) 0 0; }
.direction-check { font-size: 0.875rem; line-height: 1.7; color: var(--ink); margin: var(--space-1) 0 0; }
/* Warning tone from the existing amber token pair; the label carries it so the sentence itself stays in --ink. */
.direction-check .line-label { color: var(--pos-gk-fg); }
.ref-lesson { font-size: 0.875rem; line-height: 1.7; color: var(--ink); margin: var(--space-1) 0 0; }
/* Same label for 장면 and 자료가 권하는 것 (DESIGN §5 item 2). */
.line-label { font-weight: 600; color: var(--ink); white-space: nowrap; }
/* "(출처)" moves as one unit so "(" never ends a line; max-width keeps a long source name wrapping inside it. */
.ref-lesson-cite { display: inline-block; max-width: 100%; }
/* 44px hit area via ::after (DESIGN §13), like .ref-link — no min-height, so the paragraph keeps its own line height. */
.ref-lesson-source { position: relative; }
.ref-lesson-source::after { content: ""; position: absolute; top: 50%; left: 50%; width: max(100%, 44px); height: 44px; transform: translate(-50%, -50%); }
p.feedback-source { font-size: 0.8125rem; color: var(--muted); margin: var(--space-1) 0 0; }
/* Comment writer on the card's header row, after the breadcrumb: one unbreakable-from-its-separator piece. */
.card-source { display: inline-block; }
/* 접힘 요약(summary)의 탭 영역 최소 44px(DESIGN §13/§5 item 8) — .seek-btn(위)과 같은 기법으로
   보이지 않는 ::before 확장 영역을 쓴다. summary 자체는 한 줄 텍스트로 남아 흐름 안 공간을
   차지하지 않으므로, 펼친 뒤 나머지 줄(.related-rest)과 빈틈 없이 붙어 한 목록으로 읽힌다.
   펼치면 나머지 이름 줄이 summary 바로 아래 붙으므로, 아래쪽 확장을 없애 그 줄 탭이
   카드 seek(onCardListClick)로 가게 한다. */
.related-members summary { cursor: pointer; list-style: none; position: relative; }
.related-members summary::before { content: ""; position: absolute; left: 0; right: 0; top: -11px; bottom: -11px; }
.related-members[open] summary::before { bottom: 0; }
.related-members summary::-webkit-details-marker { display: none; }
/* "외 N명"은 한 덩어리로 줄바꿈되지 않아야 하고(DESIGN §10 CJK), 펼칠 수 있다는 단서로
   .filter-bar summary와 같은 규칙의 ▾를 붙인다 — 열리면 이 span 자체가 숨어 ▴는 필요 없다.
   ::after를 inline-block으로 둬 부모 span의 점선 밑줄이 ▾로 전파되지 않게 막는다. */
.related-more { text-decoration: underline dotted; white-space: nowrap; }
.related-more::after { content: "▾"; color: var(--muted); text-decoration: none; display: inline-block; margin-left: 0.25em; }
.related-members[open] .related-more { display: none; }
.related-members[open] summary::after { content: ","; }
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
.card-body .body-frame .frame-link { display: block; }
/* Grid, not flex-wrap: a flex row let the caption text node be the
   only wrap point, so depending on caption length the time chip / text / 확대 scattered across
   1-4 lines. The fixed edge columns (time chip left, 확대 right) never wrap — only the middle
   column does, via .body-frame-caption's own min-width:0 — so both controls stay pinned to the
   row's edges at any caption length, top-aligned (align-items:start) even across wrapped lines. */
.card-body .body-frame figcaption { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: var(--space-2); font-size: 0.875rem; font-weight: 500; color: var(--muted); margin-top: var(--space-2); }
.body-frame-caption { min-width: 0; }
/* A frame at the card's own start second has no time chip: caption | 확대 only. */
.card-body .body-frame.no-time-chip figcaption { grid-template-columns: minmax(0, 1fr) auto; }
.zoom-link { font-weight: 600; white-space: nowrap; flex-shrink: 0; position: relative; }
/* 44px hit area via ::after (DESIGN §13), like .seek-btn/.ref-link. */
.zoom-link::after { content: ""; position: absolute; top: 50%; left: 50%; width: max(100%, 44px); height: 44px; transform: translate(-50%, -50%); }
@media (max-width: 640px) {
  /* Narrow screens: time chip + 확대 share the first row, the caption gets its own full-width row below. */
  .card-body .body-frame figcaption { grid-template-columns: auto 1fr; align-items: center; }
  .body-frame-caption { grid-column: 1 / -1; grid-row: 2; }
  .card-body .body-frame .zoom-link { grid-column: 2; grid-row: 1; justify-self: end; }
  .card-body .body-frame.no-time-chip figcaption { grid-template-columns: minmax(0, 1fr) auto; align-items: start; }
  .card-body .body-frame.no-time-chip .body-frame-caption { grid-column: 1; grid-row: 1; }
}

/* Ultrawide frames (width/height > 2, DESIGN §5 item 4a): at every width the image gets a fixed readable
   height and pans horizontally inside its own box only (the page never scrolls sideways). VIEWER_JS
   scrolls the box to its data-pan-center. */
.frame-pan-scroll { overflow-x: auto; overflow-y: hidden; border-radius: var(--radius-sm); }
.card-image .frame-pan-scroll img, .card-body .body-frame .frame-pan-scroll img { width: auto; max-width: none; height: 100%; }
.card-body .body-frame .frame-pan-scroll .frame-link { height: 100%; }
.frame-pan .frame-pan-hint { display: block; margin: var(--space-1) 0 0; font-size: 0.8125rem; color: var(--muted); text-align: center; }
.frame-pan .frame-pan-hint[hidden] { display: none; }
/* A mouse drags a cropped box (VIEWER_JS marks it data-pannable and adds .is-dragging while dragging); touch keeps its native swipe. */
@media (pointer: fine) {
  .frame-pan-scroll[data-pannable] { cursor: grab; }
  .frame-pan-scroll[data-pannable] .frame-link { cursor: inherit; }
  .frame-pan-scroll.is-dragging { cursor: grabbing; user-select: none; }
}
@media (max-width: 640px) {
  .frame-pan-scroll { height: 280px; }
}
@media (min-width: 641px) {
  .frame-pan-scroll { height: 300px; }
}
/* A frame that would render at least 280px tall at its box width (VIEWER_JS adds .frame-pan--full) is shown whole: no box height, no sideways scroll.
   Every other ultrawide frame keeps the pan box at every width — the card is never widened to fit it. */
.frame-pan--full .frame-pan-scroll { overflow: visible; height: auto; }
.card-image .frame-pan--full .frame-pan-scroll img, .card-body .body-frame .frame-pan--full .frame-pan-scroll img { width: 100%; max-width: 100%; height: auto; }
.card-body .body-frame .frame-pan--full .frame-pan-scroll .frame-link { height: auto; }

/* Groups similar/refs as one metadata block, separated from the body above by a hairline
   (DESIGN §5 items 9/10, §15-10 "160px 넘는 빈 공백" is the opposite failure this guards
   against — this is a small, deliberate gap, not a blank run). */
.card-meta { margin-top: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: var(--space-2); }
.similar-list, .refs-list { font-size: 0.875rem; margin: 0; }
.refs-label { font-size: 0.875rem; font-weight: 700; color: var(--muted); margin: 0; }
.refs-list li + li { margin-top: var(--space-3); }
.ref-title { font-weight: 600; }
.ref-relevance { display: block; margin: var(--space-1) 0; color: var(--muted); }
/* Ref links (요약 · 원문 ↗ · 자료 영상 m:ss부터 ↗) keep their text size and get a >=44px hit area via ::after (DESIGN §13), like .seek-btn. */
.ref-links { display: flex; flex-wrap: wrap; align-items: center; gap: 0 var(--space-3); }
.ref-sep { color: var(--muted); }
.ref-link { position: relative; display: inline-block; }
.ref-link::after { content: ""; position: absolute; top: 50%; left: 50%; width: max(100%, 44px); height: 44px; transform: translate(-50%, -50%); }
.ref-badges { display: flex; flex-wrap: wrap; gap: var(--space-1); margin: var(--space-1) 0; }
.badge.ref-format { background: var(--surface-sunken); color: var(--ink); font-weight: 700; }
.badge { display: inline-block; background: var(--surface-sunken); color: var(--muted); font-size: 0.875rem; font-weight: 500; padding: var(--space-1) var(--space-2); border-radius: var(--radius-full); }
.similar-date { color: var(--muted); font-size: 0.875rem; }
/* margin-top (not conditional on .card-meta) reads as the card's own end block whether the
   previous sibling is .card-meta or .card-body directly — without it the link ran on right
   after the last paragraph as if it were part of it. */
.watch-link { display: inline-block; position: relative; font-weight: 600; font-size: 0.8125rem; margin-top: var(--space-4); }
.watch-link::after { content: ""; position: absolute; top: 50%; left: 50%; width: max(100%, 44px); height: 44px; transform: translate(-50%, -50%); }
.empty-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); text-align: center; font-size: 1.0625rem; color: var(--muted); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); padding: var(--space-8) var(--space-6); }
.empty-state[hidden] { display: none; }
.empty-state .filter-reset { margin-top: 0; }

/* Desktop (≥1024px): TOC stays always visible in the left column, ignoring the mobile
   toggle's [hidden] attribute — an ordinary author rule safely beats the UA's plain
   [hidden] display:none (unlike details, this has no content-visibility lock). */
@media (min-width: 1024px) {
  .toc-toggle { display: none; }
  .toc-panel[hidden] { display: block; }
  /* Scrolling .toc-scroll must not scroll the 경기별/주제별 tablist away (DESIGN §8). */
  .toc [role="tablist"] { position: sticky; top: 0; z-index: 1; background: var(--bg); }
  /* A cut-off last line reads as "more below": the bottom 28px fades out; the same padding keeps the final line clear of the fade at the end of the scroll. */
  .toc-scroll { padding-bottom: 28px; -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent); }
}

@media (max-width: 1023.98px) {
  .layout { flex-direction: column; align-items: stretch; padding: var(--space-4); gap: var(--space-4); }
  .header, .footer { padding-left: var(--space-4); padding-right: var(--space-4); }
  .side-col { display: contents; }
  .side { display: contents; }
  .main { display: contents; }
  /* No control overlays the iframe (DESIGN §4, round-7 visual QA): .player-wrapper stacks
     the video and a thin toolbar row as separate flex children instead of absolutely
     positioning the collapse button on top of the video. */
  .player-wrapper { order: 1; position: sticky; top: 0; z-index: 10; aspect-ratio: auto; height: auto;
    display: flex; flex-direction: column; }
  .player-media { position: relative; inset: auto; flex-shrink: 0; height: min(56.25vw, 200px); }
  .player-wrapper.is-collapsed .player-media { height: 0; overflow: hidden; }
  /* A non-embeddable part's placeholder is taller than the 44px collapsed bar; it must not cover the 펼치기 button. */
  .player-wrapper.is-collapsed .player-placeholder { display: none; }
  .watch-bar { order: 1; }
  .player-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2);
    flex-shrink: 0; min-height: 44px; padding: 0 var(--space-3); background: var(--ink); }
  .player-mini-bar-text { margin-right: auto; color: var(--bg); font-size: 0.8125rem; font-weight: 600; }
  .player-wrapper.is-collapsed .player-mini-bar-text { display: block; }
  .player-collapse { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    min-width: 44px; min-height: 44px; padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-full); border: 1px solid var(--line-strong); background: var(--player-control-bg); color: var(--ink); font-size: 0.8125rem; font-weight: 600; }
  .part-switch { order: 2; }
  .my-feedback { order: 3; }
  .filter-bar { order: 4; }
  .toc-scroll { order: 5; flex: 0 1 auto; overflow-y: visible; }
  .active-filters { order: 6; }
  .result-count { order: 7; }
  .recurring { order: 8; }
  .card-list { order: 9; }
  .empty-state { order: 10; }
  .matches-without-feedback { order: 11; }
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
.summary-ko { font-size: 1.0625rem; line-height: 1.7; max-width: var(--measure); }
.key-points { font-size: 1.0625rem; line-height: 1.7; margin: var(--space-4) 0; }
.translations-table { width: 100%; border-collapse: collapse; margin: var(--space-4) 0; }
.translations-table th { font-size: 0.875rem; font-weight: 700; text-align: left; vertical-align: top; padding: var(--space-3); border: 0; border-bottom: 1px solid var(--line); }
.translations-table td { font-size: 1.0625rem; line-height: 1.7; text-align: left; vertical-align: top; padding: var(--space-3); border: 0; border-bottom: 1px solid var(--line); }
/* <1024px (round-6 CJK review): a full English sentence in the narrow 원문 column has nowhere
   to wrap but mid-word — stack 원문/한국어 as labeled blocks instead of columns so each gets
   the full content width. Desktop keeps the 2-column table untouched. */
@media (max-width: 1023.98px) {
  .translations-table thead { display: none; }
  .translations-table, .translations-table tbody, .translations-table tr, .translations-table td { display: block; width: 100%; }
  .translations-table tr { margin-bottom: var(--space-4); }
  .translations-table td { border-bottom: 0; padding: var(--space-2) 0; }
  .translations-table td:first-child { border-bottom: 1px solid var(--line); padding-bottom: var(--space-3); margin-bottom: var(--space-2); }
  .translations-table td::before { content: attr(data-label); display: block; font-size: 0.875rem; font-weight: 700; color: var(--muted); margin-bottom: var(--space-1); }
}
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

  // "exceptGroup" leaves that one group's own condition out of the check — the basis for both
  // ordinary card matching (exceptGroup null, all four conditions apply) and live facet counts
  // (§7: a group's own selection never restricts its own options' counts).
  function elementMatchesExcept(el, exceptGroup) {
    var pos = el.getAttribute("data-pos") || "";
    var topics = el.getAttribute("data-topics") || "";
    var mentionIds = el.getAttribute("data-mention-ids") || "";
    var namedIds = el.getAttribute("data-named-ids") || "";
    var relatedIds = el.getAttribute("data-related-ids") || "";
    var addressedIds = el.getAttribute("data-addressed-member-ids") || "";
    if (exceptGroup !== "position" && selected.position && !hasToken(pos, selected.position)) return false;
    if (exceptGroup !== "topic" && selected.topic.length > 0 && !anyToken(topics, selected.topic)) return false;
    if (exceptGroup !== "mention" && selected.mention && !hasToken(mentionIds, selected.mention)) return false;
    if (exceptGroup !== "mine" && selected.mine && !hasToken(addressedIds, selected.mine) && !hasToken(relatedIds, selected.mine) && !hasToken(namedIds, selected.mine)) return false;
    return true;
  }

  function elementMatches(el) {
    return elementMatchesExcept(el, null);
  }

  // ── live facet counts (§7: recomputed against every OTHER active condition on each
  // selection change; a group's own selection never restricts its own options' counts) ──────

  function computeFacetCounts(attr, group) {
    // A tag or member id equal to "constructor"/"__proto__" etc. must never read back a
    // prototype value through a plain {} lookup -- Object.create(null) has no prototype chain
    // to leak through (REAL BUG, round-7 review, regression-tested below).
    var counts = Object.create(null);
    var cards = document.querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!elementMatchesExcept(card, group)) continue;
      var raw = card.getAttribute(attr) || "";
      if (raw === "") continue;
      var parts = raw.split("|");
      for (var j = 0; j < parts.length; j++) {
        counts[parts[j]] = (counts[parts[j]] || 0) + 1;
      }
    }
    return counts;
  }

  function isChipSelected(group, value) {
    if (group === "topic") return selected.topic.indexOf(value) !== -1;
    return selected[group] === value;
  }

  // A live count of 0 disables the option (disabled attribute + aria-disabled, muted style)
  // instead of removing it — no layout jump, and it stops being clickable (§7's "can't reach 0
  // results via facet chips alone"). An already-selected option is never disabled, so it can
  // still be deselected once other selections push its own count to 0.
  function applyFacetCounts(group, attr) {
    var counts = computeFacetCounts(attr, group);
    var chips = document.querySelectorAll('.chip-filter[data-group="' + group + '"]');
    for (var i = 0; i < chips.length; i++) {
      var chipEl = chips[i];
      var value = chipEl.getAttribute("data-value");
      var count = counts[value] || 0;
      var countEl = chipEl.querySelector(".chip-count");
      if (countEl) countEl.textContent = "(" + count + ")";
      var disable = count === 0 && !isChipSelected(group, value);
      if (disable) {
        chipEl.setAttribute("disabled", "");
        chipEl.setAttribute("aria-disabled", "true");
      } else {
        chipEl.removeAttribute("disabled");
        chipEl.removeAttribute("aria-disabled");
      }
    }
  }

  function updateFacetCounts() {
    applyFacetCounts("position", "data-pos");
    applyFacetCounts("topic", "data-topics");
    applyFacetCounts("mention", "data-mention-ids");
  }

  // Finds a chip by (group, value) via iteration + getAttribute comparison, never a
  // concatenated CSS-attribute-selector string -- a tag or member id containing a double quote
  // would otherwise break out of the ["..."] selector and throw (REAL BUG, round-7 review,
  // regression-tested below). setSinglePressed above already uses this same safe pattern.
  function findChipByValue(group, value) {
    var chips = document.querySelectorAll('.chip-filter[data-group="' + group + '"]');
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].getAttribute("data-value") === value) return chips[i];
    }
    return null;
  }

  function mentionLabel(id) {
    var chipEl = findChipByValue("mention", id);
    return chipEl ? chipEl.getAttribute("data-label") || id : id;
  }

  // Same safe iteration as findChipByValue above, over the "내 피드백" pills instead of the
  // filter-bar chips -- pills live in .pill-mine, not .chip-filter, so they need their own finder.
  function findPillByValue(value) {
    var pills = document.querySelectorAll(".pill-mine");
    for (var i = 0; i < pills.length; i++) {
      if (pills[i].getAttribute("data-value") === value) return pills[i];
    }
    return null;
  }

  function mineLabel(id) {
    var pillEl = findPillByValue(id);
    return pillEl ? pillEl.getAttribute("data-label") || id : id;
  }

  // Shared by onMinePillClick and removeFilter("mine", ...) so the active-filter chip's × always
  // leaves pill aria-pressed in the exact same state as re-clicking the selected pill would.
  function setMinePressed(value) {
    var pills = document.querySelectorAll(".pill-mine");
    for (var i = 0; i < pills.length; i++) {
      pills[i].setAttribute("aria-pressed", pills[i].getAttribute("data-value") === value ? "true" : "false");
    }
  }

  function removeFilter(group, value) {
    if (group === "position") {
      selected.position = null;
      setSinglePressed("position", null);
    } else if (group === "topic") {
      var idx = selected.topic.indexOf(value);
      if (idx !== -1) selected.topic.splice(idx, 1);
      var chipEl = findChipByValue("topic", value);
      if (chipEl) chipEl.setAttribute("aria-pressed", "false");
    } else if (group === "mention") {
      selected.mention = null;
      setSinglePressed("mention", null);
    } else if (group === "mine") {
      selected.mine = null;
      setMinePressed(null);
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
    // Mine goes first (DESIGN §6/§7): an empty AND-result can only happen through a combination
    // with the "내 피드백" pill (facet chips alone can't reach 0, §7's live counts), so surfacing
    // this cause ahead of the facet chips is what lets a reader spot it instead of just the "조건에
    // 맞는 피드백이 없어요" empty state.
    if (selected.mine) {
      appendActiveChip(container, "mine", selected.mine, "내 피드백: " + mineLabel(selected.mine));
      hasAny = true;
    }
    if (selected.position) {
      appendActiveChip(container, "position", selected.position, "포지션: " + selected.position);
      hasAny = true;
    }
    for (var i = 0; i < selected.topic.length; i++) {
      appendActiveChip(container, "topic", selected.topic[i], "주제: " + selected.topic[i]);
      hasAny = true;
    }
    if (selected.mention) {
      appendActiveChip(container, "mention", selected.mention, "이름이 나온 선수: " + mentionLabel(selected.mention));
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
      parts.push("이름이 나온 선수 " + mentionLabel(selected.mention));
    }
    if (countLabel) countLabel.textContent = String(n);
    if (detail) detail.textContent = parts.length > 0 ? " · " + parts.join(", ") : "";
  }

  // ── "내 피드백" grouping (DESIGN §6): the real DOM is regrouped under headings, so keyboard and
  // screen-reader order equal the visual order. Cards keep their original time order inside a
  // group; deselecting puts every card back in the original order and drops the headings.
  var allCards = Array.prototype.slice.call(document.querySelectorAll(".card"));
  // Cards and the match dividers (h2.match-divider) between them, in the original order — deselecting restores this whole sequence.
  var allListItems = Array.prototype.slice.call((document.querySelector(".card-list") || { children: [] }).children);
  var cardsArranged = false;
  var MINE_GROUPS = [
    { key: "fix", label: "고칠 점" },
    { key: "named", label: "이름이 나온 장면" },
    { key: "positionTarget", label: "내 포지션 대상" },
    { key: "all", label: "전원 대상" },
    { key: "position", label: "같은 포지션 참고" }
  ];

  function mineGroupOf(card) {
    if (hasToken(card.getAttribute("data-member-ids") || "", selected.mine)) return "fix";
    if (hasToken(card.getAttribute("data-position-target-ids") || "", selected.mine)) return "positionTarget";
    if (hasToken(card.getAttribute("data-addressed-member-ids") || "", selected.mine)) return "all";
    if (hasToken(card.getAttribute("data-named-ids") || "", selected.mine)) return "named";
    return "position";
  }

  function arrangeCards() {
    var cardList = document.querySelector(".card-list");
    if (!cardList) return;
    if (!selected.mine && !cardsArranged) return;
    var oldHeadings = cardList.querySelectorAll(".mine-group-heading");
    for (var h = 0; h < oldHeadings.length; h++) oldHeadings[h].parentNode.removeChild(oldHeadings[h]);
    var i;
    if (!selected.mine) {
      for (i = 0; i < allListItems.length; i++) cardList.appendChild(allListItems[i]);
      cardsArranged = false;
      return;
    }
    var buckets = { fix: [], positionTarget: [], all: [], named: [], position: [] };
    var hiddenCards = [];
    for (i = 0; i < allCards.length; i++) {
      if (allCards[i].hasAttribute("hidden")) hiddenCards.push(allCards[i]);
      else buckets[mineGroupOf(allCards[i])].push(allCards[i]);
    }
    for (var g = 0; g < MINE_GROUPS.length; g++) {
      var group = buckets[MINE_GROUPS[g].key];
      if (group.length === 0) continue;
      var heading = document.createElement("h2");
      heading.className = "mine-group-heading";
      heading.textContent = MINE_GROUPS[g].label + " " + group.length;
      cardList.appendChild(heading);
      for (i = 0; i < group.length; i++) cardList.appendChild(group[i]);
    }
    for (i = 0; i < hiddenCards.length; i++) cardList.appendChild(hiddenCards[i]);
    cardsArranged = true;
  }

  var RECURRING_VISIBLE_ROWS = 3;
  // The rows in their original (most-repeated first) order: choosing a member moves that member's own rows to the front; deselecting restores this order.
  var allRecurringRows = Array.prototype.slice.call(document.querySelectorAll(".recurring-item"));

  // 반복 지적 (DESIGN §6a): a time chip whose card the filters hid is hidden with it (an anchor to a
  // hidden card does nothing); a row with no visible chip, and the block with no visible row, hide too.
  function updateRecurring() {
    var block = document.querySelector(".recurring");
    if (!block) return;
    var rows = allRecurringRows;
    var anyRow = false;
    var rowOwned = [];
    var rowFix = [];
    var rowVisibleFix = [];
    var rowVisiblePosition = [];
    for (var i = 0; i < rows.length; i++) {
      var chips = rows[i].querySelectorAll(".recurring-unit");
      var anyChip = false;
      var visibleChips = 0;
      // "내가 고칠 것" = the entry's chips whose owner is the selected member (data-fixer-ids: the unit's fixers who own the label);
      // a chip owned by a team unit ("수비 라인") never counts, nor does someone else's repeated behaviour.
      // A chip also counts as a separate "내 포지션 대상" when its owner is a team unit ("수비 라인", data-team-owner) or its entry has no owners:
      // the member played a position of the unit's group in that match (data-group-member-ids, fixers included), and is not the chip's fixer.
      // data-owner-ids = the row's owners decided per chip (fixers + group members of group-owned chips); data-label-owner-ids = the label's own owners.
      var noOwners = (rows[i].getAttribute("data-label-owner-ids") || "") === "";
      var mineUnits = 0; // filters do not change it
      var positionUnits = 0;
      var visibleMineUnits = 0; // the "그중" counts: mine among the visible chips
      var visiblePositionUnits = 0;
      for (var j = 0; j < chips.length; j++) {
        var target = document.getElementById(chips[j].getAttribute("data-target") || "");
        var isFixChip = selected.mine && hasToken(chips[j].getAttribute("data-fixer-ids") || "", selected.mine);
        var isTeamChip = chips[j].getAttribute("data-team-owner") === "true";
        var isPositionChip = !isFixChip && (noOwners || isTeamChip) && target !== null && selected.mine && hasToken(target.getAttribute("data-group-member-ids") || "", selected.mine);
        var isMineChip = isFixChip || isPositionChip;
        if (isFixChip) mineUnits = mineUnits + 1;
        if (isPositionChip) positionUnits = positionUnits + 1;
        chips[j].classList.toggle("is-mine", !!isMineChip);
        var shown = target !== null && !target.hasAttribute("hidden");
        if (shown) {
          chips[j].removeAttribute("hidden");
          anyChip = true;
          visibleChips = visibleChips + 1;
          if (isFixChip) visibleMineUnits = visibleMineUnits + 1;
          if (isPositionChip) visiblePositionUnits = visiblePositionUnits + 1;
        } else {
          chips[j].setAttribute("hidden", "");
        }
      }
      rowOwned.push(!!selected.mine && hasToken(rows[i].getAttribute("data-owner-ids") || "", selected.mine));
      rowFix.push(mineUnits > 0);
      rowVisibleFix.push(visibleMineUnits > 0);
      rowVisiblePosition.push(visiblePositionUnits > 0);
      var countEl = rows[i].querySelector(".recurring-count");
      if (countEl) {
        var total = countEl.getAttribute("data-total");
        var someHidden = visibleChips < Number(total);
        var mineText = function (fix, position) {
          var parts = [];
          if (fix > 0) parts.push("내가 고칠 것 " + fix);
          if (position > 0) parts.push("내 포지션 대상 " + position);
          return parts.join(" · ");
        };
        // Parts carry no outer spaces: the flex gap spaces them, and a plain space text node between them (ignored by flex layout) keeps textContent readable.
        // A part starts with "·" or "(" so a "·" always begins the next line, never ends one.
        var countParts = ["×" + total];
        if (someHidden) {
          var shownText = "· 보이는 카드 " + visibleChips;
          var visibleMine = mineText(visibleMineUnits, visiblePositionUnits);
          countParts.push(shownText);
          if (visibleMine !== "") {
            var mineSplit = visibleMine.split(" · ");
            for (var m = 0; m < mineSplit.length; m++) countParts.push((m === 0 ? "(그중 " : "· ") + mineSplit[m] + (m === mineSplit.length - 1 ? ")" : ""));
          }
        } else if (mineText(mineUnits, positionUnits) !== "") {
          var mineAll = mineText(mineUnits, positionUnits).split(" · ");
          for (var n = 0; n < mineAll.length; n++) countParts.push("· " + mineAll[n]);
        }
        countEl.textContent = "";
        for (var q = 0; q < countParts.length; q++) {
          var partEl = document.createElement("span");
          partEl.className = "recurring-count-part";
          partEl.textContent = countParts[q];
          if (q > 0) countEl.appendChild(document.createTextNode(" "));
          countEl.appendChild(partEl);
        }
      }
      if (anyChip) {
        rows[i].removeAttribute("hidden");
        anyRow = true;
      } else {
        rows[i].setAttribute("hidden", "");
      }
    }
    if (anyRow) block.removeAttribute("hidden");
    else block.setAttribute("hidden", "");
    // With a member selected the rows the member owns come first — rows with the member's own "내가 고칠 것" chips, then rows that reach the
    // member only through a position chip ("내 포지션 대상") — each group keeping the original count order. A one-line summary counts
    // both kinds among the rows with a visible chip of the member's; without a selection the original order returns and the summary hides.
    var list = block.querySelector(".recurring-list");
    var summary = block.querySelector(".recurring-summary");
    var ordered = [];
    var orderedOwned = []; // parallel to ordered: the row holds a chip of the selected member (a fix chip or a position/team chip)
    var fixRows = 0;
    var positionRows = 0;
    for (var o = 0; o < rows.length; o++) {
      if (rowOwned[o] && rowFix[o]) {
        ordered.push(rows[o]);
        orderedOwned.push(true);
        if (rowVisibleFix[o]) fixRows = fixRows + 1;
      }
    }
    for (var q2 = 0; q2 < rows.length; q2++) {
      if (rowOwned[q2] && !rowFix[q2]) {
        ordered.push(rows[q2]);
        orderedOwned.push(true);
        if (rowVisiblePosition[q2]) positionRows = positionRows + 1;
      }
    }
    for (var p = 0; p < rows.length; p++) {
      if (!rowOwned[p]) {
        ordered.push(rows[p]);
        orderedOwned.push(false);
      }
    }
    if (list) for (var a = 0; a < ordered.length; a++) list.appendChild(ordered[a]);
    if (summary) {
      if (selected.mine) {
        summary.textContent = "내가 고칠 반복 " + fixRows + (positionRows > 0 ? " · 내 포지션 대상 " + positionRows : "");
        summary.removeAttribute("hidden");
      } else {
        summary.textContent = "";
        summary.setAttribute("hidden", "");
      }
    }
    rows = ordered;
    // CSS shows only the first RECURRING_VISIBLE_ROWS visible rows until expanded (every width). A row that holds a chip of the selected member is never
    // folded, however far down it sits; only the rows unrelated to the member fold.
    var shownRows = 0;
    var extraRows = 0;
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].hasAttribute("hidden")) continue;
      shownRows = shownRows + 1;
      var folded = shownRows > RECURRING_VISIBLE_ROWS && !orderedOwned[r];
      rows[r].classList.toggle("recurring-extra", folded);
      if (folded) extraRows = extraRows + 1;
    }
    var more = block.querySelector(".recurring-more");
    if (more) {
      if (extraRows > 0) {
        more.removeAttribute("hidden");
        more.textContent = block.classList.contains("is-expanded") ? "접기" : "더 보기 (" + extraRows + ")";
      } else {
        more.setAttribute("hidden", "");
      }
    }
  }

  function initRecurringMore() {
    var block = document.querySelector(".recurring");
    var more = block ? block.querySelector(".recurring-more") : null;
    if (!block || !more) return;
    more.addEventListener("click", function () {
      var expanded = block.classList.toggle("is-expanded");
      more.setAttribute("aria-expanded", expanded ? "true" : "false");
      updateRecurring();
    });
  }

  // Toggles .is-direct on each card (the direct-mention marker, DESIGN §6) and applies the badges
  // and name highlights for the selected member; mine falsy clears them all.
  function updateMentionBadgesAndMarks() {
    var mine = selected.mine;
    var cards = document.querySelectorAll(".card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var isDirect = mine !== null && hasToken(card.getAttribute("data-member-ids") || "", mine);
      card.classList.toggle("is-direct", isDirect);
      var badge = card.querySelector(".mention-badge");
      if (badge) {
        var isAddressedToAll = mine !== null && hasToken(card.getAttribute("data-addressed-member-ids") || "", mine);
        // Named in the source on top of the primary relation: shown as a suffix so the badge does not hide it.
        var isNamed = mine !== null && hasToken(card.getAttribute("data-named-ids") || "", mine);
        if (isDirect) {
          badge.textContent = "고칠 점";
          badge.className = "mention-badge mention-direct";
          badge.removeAttribute("hidden");
        } else if (mine && hasToken(card.getAttribute("data-position-target-ids") || "", mine)) {
          badge.textContent = isNamed ? "내 포지션 대상 · 이름 나옴" : "내 포지션 대상";
          badge.className = "mention-badge mention-position-target";
          badge.removeAttribute("hidden");
        } else if (mine && isAddressedToAll) {
          badge.textContent = isNamed ? "전원 대상 · 이름 나옴" : "전원 대상";
          badge.className = "mention-badge mention-all";
          badge.removeAttribute("hidden");
        } else if (mine && isNamed) {
          badge.textContent = "이름이 나온 장면";
          badge.className = "mention-badge mention-named";
          badge.removeAttribute("hidden");
        } else if (mine && hasToken(card.getAttribute("data-related-ids") || "", mine)) {
          badge.textContent = "같은 포지션 참고";
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
      // A collapsed "관련" <details> hides its .mine highlight, so open it once the
      // selected member's mark lands inside it (never re-closed on deselect — minimal fix).
      var relatedDetails = card.querySelectorAll("details.related-members");
      for (var k = 0; k < relatedDetails.length; k++) {
        if (relatedDetails[k].querySelector(".member-name.mine")) {
          relatedDetails[k].setAttribute("open", "");
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
      var visibleItems = groups[i].querySelectorAll(".toc-item:not([hidden])").length;
      var hasVisible = visibleItems > 0;
      var countEl = groups[i].querySelector(".toc-group-count");
      if (countEl) countEl.textContent = String(visibleItems);
      if (hasVisible) {
        groups[i].removeAttribute("hidden");
      } else {
        groups[i].setAttribute("hidden", "");
      }
    }
  }

  // A match divider shows only while some card of its match (the cards after it up to the next divider) is visible; with a member selected the
  // cards are regrouped by relation, not by match, so every divider hides.
  function updateMatchDividers() {
    var dividers = document.querySelectorAll(".match-divider");
    for (var d = 0; d < dividers.length; d++) {
      var anyVisible = false;
      var el = dividers[d].nextElementSibling;
      while (el && !el.classList.contains("match-divider")) {
        if (el.classList.contains("card") && !el.hasAttribute("hidden")) anyVisible = true;
        el = el.nextElementSibling;
      }
      if (anyVisible && !selected.mine) dividers[d].removeAttribute("hidden");
      else dividers[d].setAttribute("hidden", "");
    }
    // The "피드백 없음" rows standing among the dividers lose their place with the dividers when a member is selected.
    var noFeedbackRows = document.querySelectorAll(".card-list .match-no-feedback");
    for (var n = 0; n < noFeedbackRows.length; n++) {
      if (selected.mine) noFeedbackRows[n].setAttribute("hidden", "");
      else noFeedbackRows[n].removeAttribute("hidden");
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
      // A TOC item (side TOC and mobile TOC are the same list) is hidden exactly when its card is.
      var tocCard = document.getElementById(tocItems[j].getAttribute("data-target") || "");
      if (tocCard !== null && !tocCard.hasAttribute("hidden")) {
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
    arrangeCards();
    updateMatchDividers();
    updateCurrentToc();
    updateRecurring();
    updateMentionBadgesAndMarks();
    updateFacetCounts();
    renderActiveFilters();
    updateFilterSummary();
    refreshPanBoxes();
  }

  function setSinglePressed(group, value) {
    var chips = document.querySelectorAll('.chip-filter[data-group="' + group + '"]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute("aria-pressed", chips[i].getAttribute("data-value") === value ? "true" : "false");
    }
  }

  function onChipClick(event) {
    var chipEl = event.currentTarget;
    if (chipEl.hasAttribute("disabled")) return; // guard alongside the native disabled semantics, not instead of them
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
    setMinePressed(next);
    applyFilters();
    // The pill row scrolls sideways below 1024px: bring a selected pill that was scrolled out back into view.
    if (next && typeof pillEl.scrollIntoView === "function") pillEl.scrollIntoView({ block: "nearest", inline: "nearest" });
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
      updateCurrentToc();
    }, 600);
  }

  // The TOC entry (every panel's copy) of the card that holds the top of the viewport is marked is-current + aria-current="true": the last visible
  // card whose top edge is within CURRENT_CARD_VIEWPORT_SHARE of the viewport height from the top, or the first visible card when all start lower.
  var CURRENT_CARD_VIEWPORT_SHARE = 0.3;
  function updateCurrentToc() {
    var cards = document.querySelectorAll(".card:not([hidden])");
    var limit = (window.innerHeight || 800) * CURRENT_CARD_VIEWPORT_SHARE;
    var current = cards.length > 0 ? cards[0] : null;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getBoundingClientRect().top <= limit) current = cards[i];
    }
    var items = document.querySelectorAll(".toc-item[data-target]");
    for (var j = 0; j < items.length; j++) {
      var isCurrent = current !== null && items[j].getAttribute("data-target") === current.id;
      if (isCurrent) {
        items[j].classList.add("is-current");
        items[j].setAttribute("aria-current", "true");
      } else {
        items[j].classList.remove("is-current");
        items[j].removeAttribute("aria-current");
      }
    }
  }

  var currentTocQueued = false;
  function queueCurrentToc() {
    if (typeof window.requestAnimationFrame !== "function") {
      updateCurrentToc();
      return;
    }
    if (currentTocQueued) return;
    currentTocQueued = true;
    window.requestAnimationFrame(function () {
      currentTocQueued = false;
      updateCurrentToc();
    });
  }

  function initToc() {
    var items = document.querySelectorAll(".toc-item, .recurring-unit");
    for (var i = 0; i < items.length; i++) items[i].addEventListener("click", onTocItemClick);
    document.addEventListener("scroll", queueCurrentToc);
  }

  // ── video player (DESIGN.md §9) ──────────────────────────────────────

  var playerEl = document.getElementById("yt-player");
  var initialEmbeddable = playerEl ? playerEl.getAttribute("data-embeddable") === "true" : false;
  var currentVideo = document.body.dataset.video || null;
  var currentEmbeddable = initialEmbeddable;
  var playerReady = false;
  var playerCreated = false;
  // The desired {videoId, start} once ready — a single slot each pre-ready click REPLACES
  // wholesale, never a queue of past clicks. Two pre-ready clicks on different parts (e.g. a
  // Part1 card at 180s, then a Part2 button at 0s) must leave only the SECOND click's target
  // to apply once ready; a queue that appended both would flush the stale first seekTo(180)
  // right after the player loads Part2 (REAL BUG, round-7 review, regression-tested below).
  var pendingAction = null;

  function onPlayerReady(event) {
    playerReady = true;
    window.fcPlayer = event.target;
    var action = pendingAction;
    pendingAction = null;
    if (!action) return;
    // The player may have been constructed with an EARLIER click's video (construction only
    // ever runs once) while a LATER pre-ready click retargeted pendingAction to a different
    // video -- only that case needs an actual load; the common case (constructed with this
    // exact video already) just needs a seek, and only when a non-zero start was requested.
    if (action.videoId === window.fcPlayer.getVideoData().video_id) {
      // Always play, even when start is 0 (e.g. a pre-ready Part-button click, always
      // start=0 via onPartButtonClick -> switchTo) -- seekTo alone never starts playback, so
      // without this call the player sits idle after onReady (REAL BUG, round-8 review,
      // regression-tested below).
      if (action.start > 0) window.fcPlayer.seekTo(action.start, true);
      window.fcPlayer.playVideo();
    } else {
      window.fcPlayer.loadVideoById({ videoId: action.videoId, startSeconds: action.start }); // already starts playback
    }
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
      pendingAction = { videoId: videoId, start: start }; // playerCreated was just false, so playerReady can't be true yet either.
      updateMiniBar();
      return;
    }
    if (playerReady && window.fcPlayer) {
      if (videoId === currentVideo) {
        window.fcPlayer.seekTo(start, true);
        window.fcPlayer.playVideo();
      } else {
        currentVideo = videoId;
        window.fcPlayer.loadVideoById({ videoId: videoId, startSeconds: start });
      }
    } else {
      currentVideo = videoId;
      pendingAction = { videoId: videoId, start: start };
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
    // Link-only session (no embeddable video, DESIGN §9): time chips are real links, the card area never seeks.
    if (document.body.hasAttribute("data-link-only")) return;
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

  // Ultrawide frames in their pan box start with the caption's subject (data-pan-center, 0..1 of the
  // image width) at the box center, clamped to the scroll range (DESIGN §5 item 4a). A box that does
  // not overflow has scrollWidth === clientWidth, so this is a no-op there. Re-run when an
  // image loads (scrollWidth was 0 before) and when filtering shows a card again (a hidden card's box
  // has no width); a box the user has scrolled (its scroll event left the position we set) is never moved.
  // A frame in a pan box shows whole (class frame-pan--full) only where it would render at least FULL_FRAME_MIN_HEIGHT px tall at the box's own width;
  // otherwise it keeps the pan box at every width, so an ultrawide frame never shrinks to a strip too small to read. The box width does not depend on the
  // class, so the decision is stable; it re-runs on resize.
  var FULL_FRAME_MIN_HEIGHT = 280;
  function fitPanBoxes() {
    var pans = document.querySelectorAll(".frame-pan");
    for (var i = 0; i < pans.length; i++) {
      var img = pans[i].querySelector("img");
      var width = Number(img ? img.getAttribute("width") : 0);
      var height = Number(img ? img.getAttribute("height") : 0);
      var full = width > 0 && height > 0 && pans[i].clientWidth * height / width >= FULL_FRAME_MIN_HEIGHT;
      pans[i].classList.toggle("frame-pan--full", full);
    }
  }

  // The hint and the grab cursor show only for a box whose frame is actually cropped: more than 1px of overflow (sub-pixel rounding is not a crop)
  // and not a whole-frame box (frame-pan--full). A fine pointer (mouse) cannot swipe, so its hint says to drag; the drag itself is initPanBoxes.
  function finePointer() {
    return typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
  }

  function centerPanBoxes() {
    var boxes = document.querySelectorAll(".frame-pan-scroll");
    var hintedCards = [];
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      var pan = box.parentNode;
      var cropped = box.scrollWidth - box.clientWidth > 1 && !(pan && pan.classList.contains("frame-pan--full"));
      if (cropped) box.setAttribute("data-pannable", "");
      else box.removeAttribute("data-pannable");
      // The pan hint shows once per card, under the first frame whose image is cropped.
      var hint = pan ? pan.querySelector(".frame-pan-hint") : null;
      if (hint) {
        var card = box.closest ? box.closest(".card") : null;
        var showHint = cropped && hintedCards.indexOf(card) === -1;
        if (showHint) hintedCards.push(card);
        if (showHint) hint.removeAttribute("hidden");
        else hint.setAttribute("hidden", "");
        hint.textContent = finePointer() ? "끌어서 좌우로 보기" : "좌우로 밀어 보기";
      }
      if (box.fcUserScrolled) continue;
      var center = parseFloat(box.getAttribute("data-pan-center"));
      box.scrollLeft = Math.min(Math.max(0, center * box.scrollWidth - box.clientWidth / 2), Math.max(0, box.scrollWidth - box.clientWidth));
      box.fcAutoScrollLeft = box.scrollLeft;
    }
  }

  function refreshPanBoxes() {
    fitPanBoxes();
    centerPanBoxes();
  }

  // A mouse drags a cropped box sideways (a fine pointer has no swipe and the box shows no scrollbar). Listeners are on the document, not
  // pointer capture: a captured pointer would retarget the click away from the frame's link, so a plain click would stop opening it. A drag
  // past PAN_DRAG_THRESHOLD swallows the click that ends it; a plain click is left alone.
  var PAN_DRAG_THRESHOLD = 4;
  var panDrag = null;

  function initPanDrag() {
    document.addEventListener("pointermove", function (event) {
      if (!panDrag) return;
      var dx = event.clientX - panDrag.x;
      if (!panDrag.box.fcDragged && Math.abs(dx) < PAN_DRAG_THRESHOLD) return;
      panDrag.box.fcDragged = true;
      panDrag.box.classList.add("is-dragging");
      panDrag.box.scrollLeft = panDrag.left - dx;
    });
    function endPanDrag() {
      if (!panDrag) return;
      var box = panDrag.box;
      panDrag = null;
      box.classList.remove("is-dragging");
      setTimeout(function () { box.fcDragged = false; }, 0);
    }
    document.addEventListener("pointerup", endPanDrag);
    document.addEventListener("pointercancel", endPanDrag);
  }

  function initPanBoxes() {
    var boxes = document.querySelectorAll(".frame-pan-scroll");
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      box.addEventListener("scroll", function (event) {
        var el = event.currentTarget;
        if (el.scrollLeft !== el.fcAutoScrollLeft) el.fcUserScrolled = true;
      });
      box.addEventListener("pointerdown", function (event) {
        var el = event.currentTarget;
        el.fcDragged = false;
        if (event.pointerType !== "mouse" || event.button !== 0 || !finePointer() || !el.hasAttribute("data-pannable")) return;
        panDrag = { box: el, x: event.clientX, left: el.scrollLeft };
      });
      box.addEventListener("dragstart", function (event) { event.preventDefault(); });
      box.addEventListener("click", function (event) {
        var el = event.currentTarget;
        if (!el.fcDragged) return;
        el.fcDragged = false;
        event.preventDefault();
        event.stopPropagation();
      }, true);
      var img = box.querySelector("img");
      if (img) img.addEventListener("load", refreshPanBoxes);
    }
    initPanDrag();
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
  initPanBoxes();
  initRecurringMore();
  applyFilters();
  refreshPanBoxes();
  if (typeof window.addEventListener === "function") window.addEventListener("resize", function () {
    refreshPanBoxes();
    queueCurrentToc();
  });
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
