/**
 * fc-feedback pure domain module.
 *
 * Holds only rules that do not touch the filesystem or the network: the
 * roster/taxonomy schema, the position tree, similarity scoring, URL
 * normalization, and the reference-id/link-check helpers (plan §3, §4-C..F).
 * LLM-authored JSON validators (checkPlan, checkNotes, ...) are a separate,
 * later module — this file intentionally does not define them.
 */
import { createHash } from "node:crypto";

// ── Patterns (plan §3) ──────────────────────────────────────────────────────

/** YouTube video id: exactly 11 URL-safe base64-ish characters. */
export const VID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Session id: `<upload_date YYYYMMDD>-<first video id>`. */
export const SID_PATTERN = /^\d{8}-[A-Za-z0-9_-]{11}$/;

/** Unit id: `<SID>#u<3 digits>`, e.g. `20240104-NUzEChn9EyI#u001`. */
export const UID_PATTERN = /^\d{8}-[A-Za-z0-9_-]{11}#u\d{3}$/;

/** Roster member id: lowercase alnum, starting with a letter/digit, `-` allowed after. */
export const MEMBER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** A topic/position tag: 1–20 characters, no `|` separator, no leading/trailing whitespace. */
export function isValidTag(tag: string): boolean {
	return tag.length >= 1 && tag.length <= 20 && !tag.includes("|") && tag.trim() === tag;
}

// ── Shared types ─────────────────────────────────────────────────────────────

export interface ValidationError {
	path: string;
	message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: ValidationError[] };

export type MemberRole = "coach";

export interface Member {
	id: string;
	name: string;
	gamertag: string;
	positions: string[];
	aliases: string[];
	role?: MemberRole;
}

export interface Roster {
	members: Member[];
}

export interface Taxonomy {
	version: 1;
	topics: string[];
}

// ── Position tree (plan §4-C) ────────────────────────────────────────────────

const ROOT_POSITIONS = ["GK", "DF", "MF", "FW"];

/** child -> parent edges of the position tree. Roots (GK/DF/MF/FW) have no entry. Left/right is not a position: feedback never targets a side. */
export const PARENT: Readonly<Record<string, string | undefined>> = {
	CB: "DF",
	FB: "DF",
	WB: "DF",
	CDM: "MF",
	CM: "MF",
	CAM: "MF",
	SM: "MF",
	WF: "FW",
	ST: "FW",
};

/**
 * The retired left/right position codes and the side-agnostic code each one became. Only `positionFromLegacyCode`
 * reads this table: clients that cannot be forced to update (roster YAML files, already-published data.json,
 * archive index.json) still carry these codes. New writes (plan.json, notes) never accept them.
 */
export const LEGACY_POSITION_CODES: Readonly<Record<string, string>> = {
	LB: "FB",
	RB: "FB",
	LWB: "WB",
	RWB: "WB",
	LM: "SM",
	RM: "SM",
	LW: "WF",
	RW: "WF",
	LF: "WF",
	RF: "WF",
	CF: "ST",
};

const POSITION_LIST: string[] = [...ROOT_POSITIONS, ...Object.keys(PARENT)];

/** Every valid position tag in the tree (roots + all leaves/branches). */
export const POSITIONS: ReadonlySet<string> = new Set(POSITION_LIST);

/**
 * The single legacy conversion for position codes: a retired left/right code maps to its side-agnostic code, a code
 * already in the tree maps to itself, anything else is `null`. Readers of old persisted artifacts call this, never
 * `LEGACY_POSITION_CODES` directly.
 */
export function positionFromLegacyCode(code: string): string | null {
	if (POSITIONS.has(code)) return code;
	return Object.hasOwn(LEGACY_POSITION_CODES, code) ? (LEGACY_POSITION_CODES[code] ?? null) : null;
}

/** Position tags read from an old persisted artifact: each goes through `positionFromLegacyCode`, duplicates after conversion collapse, an unknown value stays as written (it is never silently dropped). */
export function positionTagsFromLegacy(tags: readonly string[]): string[] {
	return [...new Set(tags.map((tag) => positionFromLegacyCode(tag) ?? tag))];
}

/** Message for a position value a new write may not use: names the replacement when the value is a retired code. */
function invalidPositionMessage(position: unknown, fallback: string): string {
	if (typeof position === "string" && Object.hasOwn(LEGACY_POSITION_CODES, position)) {
		return `${position}는 더 이상 쓰지 않는 포지션 코드다 — ${LEGACY_POSITION_CODES[position]}로 쓴다(좌우를 가리지 않는다)`;
	}
	return fallback;
}

/** `{position} ∪ ancestors`, walking up to the root. */
export function anc(position: string): string[] {
	const chain: string[] = [];
	let current: string | undefined = position;
	while (current !== undefined) {
		chain.push(current);
		current = PARENT[current];
	}
	return chain;
}

/** `{position} ∪ descendants`: every known position whose ancestor chain includes it. */
export function desc(position: string): string[] {
	return POSITION_LIST.filter((candidate) => anc(candidate).includes(position));
}

/** True when `a` and `b` are the same node, or one is an ancestor of the other. */
export function related(a: string, b: string): boolean {
	return anc(a).includes(b) || anc(b).includes(a);
}

/** Union of ancestors and descendants for every tag — the `data-pos` closure. */
export function posClosure(tags: readonly string[]): string[] {
	const union = new Set<string>();
	for (const tag of tags) {
		for (const a of anc(tag)) union.add(a);
		for (const d of desc(tag)) union.add(d);
	}
	return [...union].sort();
}

/**
 * Members related to a feedback unit, in roster order: mentioned directly
 * (`member_ids`), or related through the position tree (some unit position
 * tag is related to a position the member played in the unit's match — see `positionsPlayed`).
 */
export function relatedMembers(
	unit: { member_ids: readonly string[]; position_tags: readonly string[] },
	roster: Roster,
	lineup: Lineup | null,
): Member[] {
	return roster.members.filter(
		(member) =>
			unit.member_ids.includes(member.id) ||
			unit.position_tags.some((tag) => positionsPlayed(member, lineup).some((position) => related(tag, position))),
	);
}

/**
 * Members of the unit's unnamed group (`group_positions`), in roster order: those who played a related position in the
 * match (see `positionsPlayed`), fixers (`member_ids`) included.
 */
export function groupMembers(unit: { group_positions: readonly string[] }, roster: Roster, lineup: Lineup | null): Member[] {
	return roster.members.filter((member) =>
		unit.group_positions.some((group) => positionsPlayed(member, lineup).some((position) => related(group, position))),
	);
}

/**
 * Members the unit addresses as part of its unnamed group (`group_positions`), in roster order: the `groupMembers`
 * minus the unit's `member_ids`.
 */
export function positionTargetMembers(
	unit: { member_ids: readonly string[]; group_positions: readonly string[] },
	roster: Roster,
	lineup: Lineup | null,
): Member[] {
	return groupMembers(unit, roster, lineup).filter((member) => !unit.member_ids.includes(member.id));
}

/**
 * A match's lineup: roster member id → the position code that member played in that match. Only members
 * the writer confirmed (name tag, source text, caption) are listed.
 */
export type Lineup = Record<string, string>;

/**
 * The positions `member` played in the match: its `lineup` position, none when the lineup omits the
 * member. `lineup` null means the match's lineup is unknown (a plan validated before `lineup` existed),
 * and then the member's roster positions stand in.
 */
function positionsPlayed(member: Member, lineup: Lineup | null): readonly string[] {
	if (lineup === null) return member.positions;
	const position = lineup[member.id];
	return position === undefined ? [] : [position];
}

// ── unknown-narrowing helpers ────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function describeUnknown(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function parseYaml(yamlText: string): ParseResult<unknown> {
	try {
		return { ok: true, value: Bun.YAML.parse(yamlText) };
	} catch (error) {
		return { ok: false, errors: [{ path: "", message: `YAML 파싱 실패: ${errorMessage(error)}` }] };
	}
}

// ── roster.yaml (plan §3) ────────────────────────────────────────────────────

export function parseRoster(yamlText: string): ParseResult<Roster> {
	const parsed = parseYaml(yamlText);
	if (!parsed.ok) {
		return parsed;
	}
	const raw = parsed.value;
	if (!isRecord(raw)) {
		return { ok: false, errors: [{ path: "", message: "roster.yaml은 객체여야 합니다" }] };
	}

	const membersRaw = raw.members;
	if (!Array.isArray(membersRaw) || membersRaw.length === 0) {
		return { ok: false, errors: [{ path: "members", message: "members는 최소 1명 이상이어야 합니다" }] };
	}

	const errors: ValidationError[] = [];
	const members: Member[] = [];
	const seenIds = new Set<string>();
	const seenGamertags = new Set<string>();

	membersRaw.forEach((entry, index) => {
		const path = `members[${index}]`;
		if (!isRecord(entry)) {
			errors.push({ path, message: "멤버 항목은 객체여야 합니다" });
			return;
		}

		const idRaw = entry.id;
		let id = "";
		if (typeof idRaw !== "string" || !MEMBER_ID_PATTERN.test(idRaw)) {
			errors.push({ path: `${path}.id`, message: `id는 ${MEMBER_ID_PATTERN.source} 패턴이어야 합니다` });
		} else if (seenIds.has(idRaw)) {
			errors.push({ path: `${path}.id`, message: `id가 중복됩니다: ${idRaw}` });
		} else {
			seenIds.add(idRaw);
			id = idRaw;
		}

		const nameRaw = entry.name;
		const name = typeof nameRaw === "string" ? nameRaw : "";
		if (typeof nameRaw !== "string" || nameRaw.trim() === "") {
			errors.push({ path: `${path}.name`, message: "name은 비어 있을 수 없습니다" });
		}

		const gamertagRaw = entry.gamertag;
		const gamertag = typeof gamertagRaw === "string" ? gamertagRaw : "";
		if (typeof gamertagRaw !== "string" || gamertagRaw.trim() === "") {
			errors.push({ path: `${path}.gamertag`, message: "gamertag는 비어 있을 수 없습니다" });
		} else {
			const key = gamertagRaw.toLowerCase();
			if (seenGamertags.has(key)) {
				errors.push({
					path: `${path}.gamertag`,
					message: `gamertag가 중복됩니다(대소문자 무시): ${gamertagRaw}`,
				});
			} else {
				seenGamertags.add(key);
			}
		}

		const positions: string[] = [];
		const positionsRaw = entry.positions;
		if (!Array.isArray(positionsRaw) || positionsRaw.length === 0) {
			errors.push({ path: `${path}.positions`, message: "positions는 최소 1개 이상이어야 합니다" });
		} else {
			positionsRaw.forEach((position, positionIndex) => {
				const current = typeof position === "string" ? positionFromLegacyCode(position) : null;
				if (current === null) {
					errors.push({
						path: `${path}.positions[${positionIndex}]`,
						message: `포지션 트리에 없는 태그입니다: ${describeUnknown(position)}`,
					});
					return;
				}
				if (!positions.includes(current)) positions.push(current);
			});
		}

		const aliases: string[] = [];
		const aliasesRaw = entry.aliases;
		if (aliasesRaw !== undefined) {
			if (!Array.isArray(aliasesRaw)) {
				errors.push({ path: `${path}.aliases`, message: "aliases는 배열이어야 합니다" });
			} else {
				aliasesRaw.forEach((alias, aliasIndex) => {
					if (typeof alias !== "string" || alias.trim() === "") {
						errors.push({
							path: `${path}.aliases[${aliasIndex}]`,
							message: "alias는 비어 있지 않은 문자열이어야 합니다",
						});
						return;
					}
					aliases.push(alias);
				});
			}
		}

		let role: MemberRole | undefined;
		const roleRaw = entry.role;
		if (roleRaw !== undefined) {
			if (roleRaw !== "coach") {
				errors.push({ path: `${path}.role`, message: 'role은 "coach"만 허용됩니다' });
			} else {
				role = roleRaw;
			}
		}

		const member: Member = { id, name, gamertag, positions, aliases };
		if (role !== undefined) {
			member.role = role;
		}
		members.push(member);
	});

	// No alias may equal another member's alias or name (plan §3).
	members.forEach((member, index) => {
		member.aliases.forEach((alias, aliasIndex) => {
			members.forEach((other, otherIndex) => {
				if (otherIndex === index) {
					return;
				}
				if (alias === other.name || other.aliases.includes(alias)) {
					errors.push({
						path: `members[${index}].aliases[${aliasIndex}]`,
						message: `alias가 다른 멤버의 이름/alias와 충돌합니다: ${alias}`,
					});
				}
			});
		});
	});

	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, value: { members } };
}

// ── taxonomy.yaml (plan §3) ──────────────────────────────────────────────────

export function parseTaxonomy(yamlText: string): ParseResult<Taxonomy> {
	const parsed = parseYaml(yamlText);
	if (!parsed.ok) {
		return parsed;
	}
	const raw = parsed.value;
	if (!isRecord(raw)) {
		return { ok: false, errors: [{ path: "", message: "taxonomy.yaml은 객체여야 합니다" }] };
	}

	const errors: ValidationError[] = [];
	if (raw.version !== 1) {
		errors.push({ path: "version", message: "version은 1이어야 합니다" });
	}

	const topics: string[] = [];
	const topicsRaw = raw.topics;
	if (!Array.isArray(topicsRaw)) {
		errors.push({ path: "topics", message: "topics는 배열이어야 합니다" });
	} else {
		const seen = new Set<string>();
		topicsRaw.forEach((topic, index) => {
			if (typeof topic !== "string" || !isValidTag(topic)) {
				errors.push({ path: `topics[${index}]`, message: `유효하지 않은 태그입니다: ${describeUnknown(topic)}` });
				return;
			}
			if (seen.has(topic)) {
				errors.push({ path: `topics[${index}]`, message: `topics가 중복됩니다: ${topic}` });
				return;
			}
			seen.add(topic);
			topics.push(topic);
		});
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, value: { version: 1, topics } };
}

// ── similarity (plan §4-D) ───────────────────────────────────────────────────

export interface UnitTagSet {
	topic_tags: string[];
	position_tags: string[];
	member_ids: string[];
}

/** A feedback unit from the session currently being drafted (no full UID yet). */
export interface CurrentUnit extends UnitTagSet {
	id: string;
	session: string;
}

/** A previously published feedback unit, as carried by the archive index. */
export interface PastUnit extends UnitTagSet {
	uid: string;
	session: string;
	title: string;
	date: string;
}

export interface SimilarCandidate {
	uid: string;
	score: number;
	title: string;
	date: string;
	topic_tags: string[];
	position_tags: string[];
}

export type SimilarCandidatesResult = Record<string, SimilarCandidate[]>;

const SIMILARITY_THRESHOLD = 0.2;
const MAX_SIMILAR_CANDIDATES = 5;

function jaccard(a: readonly string[], b: readonly string[]): number {
	const setA = new Set(a);
	const setB = new Set(b);
	if (setA.size === 0 && setB.size === 0) {
		return 0;
	}
	let intersection = 0;
	for (const value of setA) {
		if (setB.has(value)) {
			intersection += 1;
		}
	}
	const union = setA.size + setB.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function positionClosureSet(tags: readonly string[]): string[] {
	const union = new Set<string>();
	for (const tag of tags) {
		for (const a of anc(tag)) {
			union.add(a);
		}
	}
	return [...union];
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * Top-5 similar past units for every current unit: score ≥ 0.2, from a
 * different session, sharing at least one topic tag. Sorted score desc, then
 * date desc, then uid asc.
 */
export function similarCandidates(
	currentUnits: readonly CurrentUnit[],
	pastUnits: readonly PastUnit[],
): SimilarCandidatesResult {
	const result: SimilarCandidatesResult = {};

	for (const current of currentUnits) {
		const currentPositionClosure = positionClosureSet(current.position_tags);
		const scored: Array<{ past: PastUnit; candidate: SimilarCandidate }> = [];

		for (const past of pastUnits) {
			if (past.session === current.session) {
				continue;
			}
			const sharesTopic = current.topic_tags.some((tag) => past.topic_tags.includes(tag));
			if (!sharesTopic) {
				continue;
			}

			const topicScore = jaccard(current.topic_tags, past.topic_tags);
			const positionScore = jaccard(currentPositionClosure, positionClosureSet(past.position_tags));
			const memberScore = jaccard(current.member_ids, past.member_ids);
			const score = 0.5 * topicScore + 0.3 * positionScore + 0.2 * memberScore;
			if (score < SIMILARITY_THRESHOLD) {
				continue;
			}

			scored.push({
				past,
				candidate: {
					uid: past.uid,
					score: round3(score),
					title: past.title,
					date: past.date,
					topic_tags: past.topic_tags,
					position_tags: past.position_tags,
				},
			});
		}

		scored.sort((left, right) => {
			if (right.candidate.score !== left.candidate.score) {
				return right.candidate.score - left.candidate.score;
			}
			if (left.past.date !== right.past.date) {
				return left.past.date < right.past.date ? 1 : -1; // date desc
			}
			if (left.past.uid < right.past.uid) {
				return -1; // uid asc
			}
			return left.past.uid > right.past.uid ? 1 : 0;
		});

		result[current.id] = scored.slice(0, MAX_SIMILAR_CANDIDATES).map((entry) => entry.candidate);
	}

	return result;
}

// ── URL normalization + ref id (plan §4-E) ──────────────────────────────────

const TRACKING_PARAM_PATTERN = /^utm_/;
const TRACKING_PARAM_NAMES = new Set(["fbclid", "gclid"]);

function isTrackingParam(name: string): boolean {
	return TRACKING_PARAM_PATTERN.test(name) || TRACKING_PARAM_NAMES.has(name);
}

export function extractYoutubeVideoId(url: URL): string | null {
	const host = url.hostname.replace(/^www\./, "");
	if (host === "youtu.be") {
		const id = url.pathname.slice(1).split("/")[0];
		return id !== undefined && id !== "" ? id : null;
	}
	if (host === "youtube.com" || host === "m.youtube.com") {
		if (url.pathname === "/watch") {
			return url.searchParams.get("v");
		}
		if (url.pathname.startsWith("/shorts/")) {
			const id = url.pathname.slice("/shorts/".length).split("/")[0];
			return id !== undefined && id !== "" ? id : null;
		}
	}
	return null;
}

/**
 * Canonicalizes a URL: lowercases scheme/host, drops the fragment and
 * tracking params, strips a trailing `/` (except the root path), and folds
 * every YouTube watch/short/`youtu.be` form into `.../watch?v=ID`. Rejects
 * anything that is not http(s) (e.g. `javascript:`).
 */
export function normalizeUrl(input: string): string {
	const url = new URL(input);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`http(s)가 아닌 URL은 허용되지 않습니다: ${url.protocol}`);
	}
	url.hash = "";
	url.hostname = url.hostname.toLowerCase();

	const videoId = extractYoutubeVideoId(url);
	if (videoId !== null) {
		return `https://www.youtube.com/watch?v=${videoId}`;
	}

	for (const name of [...url.searchParams.keys()]) {
		if (isTrackingParam(name)) {
			url.searchParams.delete(name);
		}
	}
	if (url.pathname !== "/" && url.pathname.endsWith("/")) {
		url.pathname = url.pathname.replace(/\/+$/, "");
	}
	return url.toString();
}

/** `r-<first 10 hex chars of sha256(normalized url)>`. */
export function refId(url: string): string {
	const normalized = normalizeUrl(url);
	const digest = createHash("sha256").update(normalized).digest("hex");
	return `r-${digest.slice(0, 10)}`;
}

// ── link check (plan §4-F) ───────────────────────────────────────────────────

const HREF_OR_SRC_ATTR_PATTERN = /\b(?:href|src)\s*=\s*"([^"]*)"/g;

function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

/**
 * Every `href`/`src` value in `html` that is not an http(s) URL: relative
 * paths to check for existence on disk, and same-page `#uNNN` fragments to
 * check against the archive index's UIDs.
 */
export function localLinks(html: string): string[] {
	const links: string[] = [];
	for (const match of html.matchAll(HREF_OR_SRC_ATTR_PATTERN)) {
		const value = match[1];
		if (value === undefined || isHttpUrl(value)) {
			continue;
		}
		links.push(value);
	}
	return links;
}

// ── webp dimensions (plan §0-11: no ffprobe, so width/height for the card's
// `<img>` must come from the file itself) ────────────────────────────────────

function fourCc(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] + bytes[offset + 1] * 256;
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
}

/**
 * Width/height of a WebP file (RIFF/WEBP container). Supports the three
 * sub-formats ffmpeg's `-c:v libwebp` can emit: simple lossy (`VP8 `), simple
 * lossless (`VP8L`), and extended (`VP8X`).
 */
export function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
	if (bytes.length < 30 || fourCc(bytes, 0) !== "RIFF" || fourCc(bytes, 8) !== "WEBP") {
		throw new Error("webp 파일이 아닙니다");
	}
	const format = fourCc(bytes, 12);
	if (format === "VP8X") {
		return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
	}
	if (format === "VP8L") {
		if (bytes[20] !== 0x2f) {
			throw new Error("VP8L 시그니처가 올바르지 않습니다");
		}
		const bits = bytes[21] + bytes[22] * 256 + bytes[23] * 65536 + bytes[24] * 16777216;
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (format === "VP8 ") {
		if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
			throw new Error("VP8 시작 코드가 올바르지 않습니다");
		}
		return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
	}
	throw new Error(`지원하지 않는 webp 하위 포맷입니다: ${format}`);
}

// ── LLM/JSON check helpers (plan §3, §7 T3) ─────────────────────────────────
//
// `checkX` functions validate a JSON artifact that a script or an LLM writes
// during the fc-feedback pipeline (session.json .. refs-draft.json). Unlike
// `parseRoster`/`parseTaxonomy` above (which return an ok/value union), every
// `checkX` function always returns its best-effort parsed `value` alongside
// `errors` — callers must treat `value` as meaningful only when `errors` is
// empty (mirrors how the CLI's `check plan|notes|similar|refs` commands use
// exit codes: 0 valid, 1 invalid, and — plan only — 2 pending).

/** A `checkX` result: best-effort parsed `value`, meaningful only when `errors` is empty. */
export interface CheckResult<T> {
	errors: ValidationError[];
	value: T;
}

/** A `checkX` result that reports no parsed value, only pass/fail. */
export interface ErrorsResult {
	errors: ValidationError[];
}

function isNonBlank(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function requireNonBlank(raw: unknown, path: string, errors: ValidationError[], message: string): string {
	if (isNonBlank(raw)) {
		return raw;
	}
	errors.push({ path, message });
	return "";
}

function requireNullableNonBlank(
	raw: unknown,
	path: string,
	errors: ValidationError[],
	message: string,
): string | null {
	if (raw === null || raw === undefined) {
		return null;
	}
	if (isNonBlank(raw)) {
		return raw;
	}
	errors.push({ path, message });
	return null;
}

function requirePositiveNumber(raw: unknown, path: string, errors: ValidationError[], message: string): number {
	if (isFiniteNumber(raw) && raw > 0) {
		return raw;
	}
	errors.push({ path, message });
	return 0;
}

function requireNonNegativeNumber(raw: unknown, path: string, errors: ValidationError[], message: string): number {
	if (isFiniteNumber(raw) && raw >= 0) {
		return raw;
	}
	errors.push({ path, message });
	return 0;
}

function requireBoolean(raw: unknown, path: string, errors: ValidationError[], message: string): boolean {
	if (typeof raw === "boolean") {
		return raw;
	}
	errors.push({ path, message });
	return false;
}

function requirePattern(
	raw: unknown,
	pattern: RegExp,
	path: string,
	errors: ValidationError[],
	message: string,
): string {
	if (typeof raw === "string" && pattern.test(raw)) {
		return raw;
	}
	errors.push({ path, message });
	return "";
}

function requireStringArray(raw: unknown, path: string, errors: ValidationError[], message: string): string[] {
	if (!Array.isArray(raw)) {
		errors.push({ path, message });
		return [];
	}
	const values: string[] = [];
	raw.forEach((item, index) => {
		if (typeof item !== "string") {
			errors.push({ path: `${path}[${index}]`, message: "문자열이어야 합니다" });
			return;
		}
		values.push(item);
	});
	return values;
}

// ── session.json (plan §3) ───────────────────────────────────────────────────

export interface VideoFiles {
	audio: string;
	video: string;
	captions: string | null;
	captions_format: "json3" | "vtt" | null;
	wav: string | null;
}

export interface Video {
	id: string;
	url: string;
	part: number;
	title: string;
	channel: string;
	upload_date: string;
	duration: number;
	embeddable: boolean;
	width: number;
	height: number;
	files: VideoFiles;
}

export interface Session {
	version: 1;
	session_id: string;
	created_at: string;
	videos: Video[];
}

const UPLOAD_DATE_PATTERN = /^\d{8}$/;

function checkVideoFiles(raw: unknown, path: string, errors: ValidationError[]): VideoFiles {
	if (!isRecord(raw)) {
		errors.push({ path, message: "files는 객체여야 합니다" });
		return { audio: "", video: "", captions: null, captions_format: null, wav: null };
	}
	const audio = requireNonBlank(raw.audio, `${path}.audio`, errors, "audio는 비어 있지 않은 문자열이어야 합니다");
	const video = requireNonBlank(raw.video, `${path}.video`, errors, "video는 비어 있지 않은 문자열이어야 합니다");
	const captions = requireNullableNonBlank(
		raw.captions,
		`${path}.captions`,
		errors,
		"captions는 null이거나 비어 있지 않은 문자열이어야 합니다",
	);
	const wav = requireNullableNonBlank(
		raw.wav,
		`${path}.wav`,
		errors,
		"wav는 null이거나 비어 있지 않은 문자열이어야 합니다",
	);
	let captions_format: "json3" | "vtt" | null = null;
	if (raw.captions_format !== null && raw.captions_format !== undefined) {
		if (raw.captions_format === "json3" || raw.captions_format === "vtt") {
			captions_format = raw.captions_format;
		} else {
			errors.push({
				path: `${path}.captions_format`,
				message: 'captions_format은 null, "json3", "vtt" 중 하나여야 합니다',
			});
		}
	}
	return { audio, video, captions, captions_format, wav };
}

/** Validates session.json (plan §3): patterns, required fields, and per-video `part` = URL order. */
export function checkSession(json: unknown): CheckResult<Session> {
	const errors: ValidationError[] = [];
	if (!isRecord(json)) {
		errors.push({ path: "", message: "session.json은 객체여야 합니다" });
		return { errors, value: { version: 1, session_id: "", created_at: "", videos: [] } };
	}

	if (json.version !== 1) {
		errors.push({ path: "version", message: "version은 1이어야 합니다" });
	}
	const session_id = requirePattern(
		json.session_id,
		SID_PATTERN,
		"session_id",
		errors,
		`session_id는 ${SID_PATTERN.source} 패턴이어야 합니다`,
	);
	const created_at = requireNonBlank(
		json.created_at,
		"created_at",
		errors,
		"created_at은 비어 있지 않은 문자열이어야 합니다",
	);

	const videos: Video[] = [];
	if (!Array.isArray(json.videos) || json.videos.length === 0) {
		errors.push({ path: "videos", message: "videos는 최소 1개 이상이어야 합니다" });
	} else {
		json.videos.forEach((entry, index) => {
			const path = `videos[${index}]`;
			if (!isRecord(entry)) {
				errors.push({ path, message: "video 항목은 객체여야 합니다" });
				return;
			}
			const id = requirePattern(
				entry.id,
				VID_PATTERN,
				`${path}.id`,
				errors,
				`id는 ${VID_PATTERN.source} 패턴이어야 합니다`,
			);
			const url = requireNonBlank(entry.url, `${path}.url`, errors, "url은 비어 있지 않은 문자열이어야 합니다");
			if (entry.part !== index + 1) {
				errors.push({ path: `${path}.part`, message: `part는 URL 순서(${index + 1})와 일치해야 합니다` });
			}
			const title = requireNonBlank(entry.title, `${path}.title`, errors, "title은 비어 있지 않은 문자열이어야 합니다");
			const channel = requireNonBlank(
				entry.channel,
				`${path}.channel`,
				errors,
				"channel은 비어 있지 않은 문자열이어야 합니다",
			);
			const upload_date = requirePattern(
				entry.upload_date,
				UPLOAD_DATE_PATTERN,
				`${path}.upload_date`,
				errors,
				"upload_date는 YYYYMMDD 형태여야 합니다",
			);
			const duration = requirePositiveNumber(entry.duration, `${path}.duration`, errors, "duration은 양수여야 합니다");
			const embeddable = requireBoolean(
				entry.embeddable,
				`${path}.embeddable`,
				errors,
				"embeddable은 boolean이어야 합니다",
			);
			const width = requirePositiveNumber(entry.width, `${path}.width`, errors, "width는 양수여야 합니다");
			const height = requirePositiveNumber(entry.height, `${path}.height`, errors, "height는 양수여야 합니다");
			const files = checkVideoFiles(entry.files, `${path}.files`, errors);

			videos.push({
				id,
				url,
				part: typeof entry.part === "number" ? entry.part : index + 1,
				title,
				channel,
				upload_date,
				duration,
				embeddable,
				width,
				height,
				files,
			});
		});
	}

	return { errors, value: { version: 1, session_id, created_at, videos } };
}

// ── lines.json (plan §3) ─────────────────────────────────────────────────────

/** A narrated (ASR/caption) line, or one timestamped item of a YouTube comment and its writer's handle. */
export type Line =
	| { i: number; video: string; start: number; end: number; text: string; source: "speech" }
	| { i: number; video: string; start: number; end: number; text: string; source: "comment"; author: string };

/**
 * Validates lines.json against `session`: `i` contiguous from 0, lines grouped
 * by video in the session's part order and sorted by `start` within a group,
 * `0 ≤ start < end ≤ duration+1`, non-blank `text`, and `source` "speech" or
 * "comment" (a comment line also needs a non-blank `author`). A line without
 * `source` predates comment feedback, when every line was speech, so it reads
 * as `source: "speech"`.
 */
export function checkLines(json: unknown, session: Session): CheckResult<Line[]> {
	const errors: ValidationError[] = [];
	if (!Array.isArray(json)) {
		errors.push({ path: "", message: "lines.json은 배열이어야 합니다" });
		return { errors, value: [] };
	}

	const videoRank = new Map<string, number>();
	const videoDuration = new Map<string, number>();
	session.videos.forEach((video, index) => {
		videoRank.set(video.id, index);
		videoDuration.set(video.id, video.duration);
	});

	const lines: Line[] = [];
	let currentRank = -1;
	const finishedRanks = new Set<number>();
	let groupMaxStart = -Infinity;

	json.forEach((entry, index) => {
		const path = `[${index}]`;
		if (!isRecord(entry)) {
			errors.push({ path, message: "line 항목은 객체여야 합니다" });
			return;
		}

		if (entry.i !== index) {
			errors.push({ path: `${path}.i`, message: `i는 0부터 연속된 인덱스(${index})여야 합니다` });
		}
		const video = requireNonBlank(entry.video, `${path}.video`, errors, "video는 비어 있지 않은 문자열이어야 합니다");
		const text = requireNonBlank(entry.text, `${path}.text`, errors, "text는 비어 있지 않아야 합니다");

		let start = 0;
		if (isFiniteNumber(entry.start)) {
			start = entry.start;
		} else {
			errors.push({ path: `${path}.start`, message: "start는 숫자여야 합니다" });
		}
		let end = 0;
		if (isFiniteNumber(entry.end)) {
			end = entry.end;
		} else {
			errors.push({ path: `${path}.end`, message: "end는 숫자여야 합니다" });
		}
		if (start < 0) {
			errors.push({ path: `${path}.start`, message: "start는 0 이상이어야 합니다" });
		}
		if (start >= end) {
			errors.push({ path: `${path}.end`, message: "end는 start보다 커야 합니다" });
		}

		const rank = video === "" ? undefined : videoRank.get(video);
		if (video !== "" && rank === undefined) {
			errors.push({ path: `${path}.video`, message: `session에 없는 video입니다: ${video}` });
		} else if (rank !== undefined) {
			if (rank !== currentRank) {
				if (rank < currentRank || finishedRanks.has(rank)) {
					errors.push({
						path: `${path}.video`,
						message: "video는 session의 파트 순서대로 그룹화되어야 합니다",
					});
				} else {
					if (currentRank !== -1) {
						finishedRanks.add(currentRank);
					}
					currentRank = rank;
					groupMaxStart = -Infinity;
				}
			}
			const duration = videoDuration.get(video);
			if (duration !== undefined && end > duration + 1) {
				errors.push({
					path: `${path}.end`,
					message: `end는 duration+1(${duration + 1}) 이하이어야 합니다`,
				});
			}
		}

		if (start < groupMaxStart) {
			errors.push({ path: `${path}.start`, message: "같은 video 그룹 내에서 start 오름차순이어야 합니다" });
		} else {
			groupMaxStart = start;
		}

		const i = typeof entry.i === "number" ? entry.i : index;
		if (entry.source === "comment") {
			const author = requireNonBlank(entry.author, `${path}.author`, errors, "댓글 줄의 author는 비어 있지 않아야 합니다");
			lines.push({ i, video, start, end, text, source: "comment", author });
		} else {
			if (entry.source !== undefined && entry.source !== "speech") {
				errors.push({ path: `${path}.source`, message: 'source는 "speech" 또는 "comment"여야 합니다' });
			}
			lines.push({ i, video, start, end, text, source: "speech" });
		}
	});

	return { errors, value: lines };
}

// ── candidates.json (plan §3) ────────────────────────────────────────────────

export interface Candidate {
	id: string;
	video: string;
	t: number;
	/** `range`: a frame `scan-range` pulled at a fixed step inside a unit's window to prove the window was looked at. */
	kind: "comment" | "silence" | "scene" | "interval" | "manual" | "range";
	dur?: number;
}

const CANDIDATE_ID_PATTERN = /^c\d{3}$/;

function isCandidateKind(value: unknown): value is Candidate["kind"] {
	return value === "comment" || value === "silence" || value === "scene" || value === "interval" || value === "manual" || value === "range";
}

/**
 * Validates candidates.json: `c###` ids (unique), a known `kind`, `dur` only
 * on `kind: "silence"`, and entries grouped by `video` with ascending `t`
 * within each group (plan §3's `(part, t)` order, approximated without a
 * `session` — a full part-order check happens via the unit's own video in
 * `checkPlan`).
 */
export function checkCandidates(json: unknown): CheckResult<Candidate[]> {
	const errors: ValidationError[] = [];
	if (!Array.isArray(json)) {
		errors.push({ path: "", message: "candidates.json은 배열이어야 합니다" });
		return { errors, value: [] };
	}

	const seenIds = new Set<string>();
	const candidates: Candidate[] = [];
	let currentVideo: string | null = null;
	const finishedVideos = new Set<string>();
	let groupMaxT = -Infinity;

	json.forEach((entry, index) => {
		const path = `[${index}]`;
		if (!isRecord(entry)) {
			errors.push({ path, message: "candidate 항목은 객체여야 합니다" });
			return;
		}

		const id = requirePattern(
			entry.id,
			CANDIDATE_ID_PATTERN,
			`${path}.id`,
			errors,
			`id는 ${CANDIDATE_ID_PATTERN.source} 패턴이어야 합니다`,
		);
		if (id !== "") {
			if (seenIds.has(id)) {
				errors.push({ path: `${path}.id`, message: `id가 중복됩니다: ${id}` });
			} else {
				seenIds.add(id);
			}
		}
		const video = requireNonBlank(entry.video, `${path}.video`, errors, "video는 비어 있지 않은 문자열이어야 합니다");
		const t = requireNonNegativeNumber(entry.t, `${path}.t`, errors, "t는 0 이상의 숫자여야 합니다");

		let kind: Candidate["kind"] = "manual";
		if (isCandidateKind(entry.kind)) {
			kind = entry.kind;
		} else {
			errors.push({
				path: `${path}.kind`,
				message: 'kind는 "comment" | "silence" | "scene" | "interval" | "manual" | "range" 중 하나여야 합니다',
			});
		}

		let dur: number | undefined;
		if (entry.dur !== undefined) {
			if (kind !== "silence") {
				errors.push({ path: `${path}.dur`, message: "dur는 kind가 silence일 때만 사용할 수 있습니다" });
			} else if (isFiniteNumber(entry.dur) && entry.dur > 0) {
				dur = entry.dur;
			} else {
				errors.push({ path: `${path}.dur`, message: "dur는 양수여야 합니다" });
			}
		}

		if (video !== "" && video !== currentVideo) {
			if (finishedVideos.has(video)) {
				errors.push({ path: `${path}.video`, message: "candidates는 video별로 그룹화되어야 합니다" });
			} else {
				if (currentVideo !== null) {
					finishedVideos.add(currentVideo);
				}
				currentVideo = video;
				groupMaxT = -Infinity;
			}
		}
		if (t < groupMaxT) {
			errors.push({ path: `${path}.t`, message: "같은 video 그룹 내에서 t 오름차순이어야 합니다" });
		} else {
			groupMaxT = t;
		}

		const candidate: Candidate = { id, video, t, kind };
		if (dur !== undefined) {
			candidate.dur = dur;
		}
		candidates.push(candidate);
	});

	return { errors, value: candidates };
}

// ── time formatting (DESIGN.md §4, plan §13.2-5) ────────────────────────────

/** `m:ss` below 1 hour (e.g. `12:34`, `59:59`), `h:mm:ss` at/above it (e.g. `1:00:00`). */
export function formatTime(seconds: number): string {
	const total = Math.floor(seconds);
	const s = total % 60;
	const totalMinutes = Math.floor(total / 60);
	if (total < 3600) {
		return `${totalMinutes}:${String(s).padStart(2, "0")}`;
	}
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── plan.json / plan.validated.json (plan §3, §7 T3) ────────────────────────

export interface ValidatedUnit {
	id: string;
	match_id: string;
	topic_id: string;
	video: string;
	start: number;
	end: number;
	title: string;
	position_tags: string[];
	topic_tags: string[];
	/** Players the feedback asks to change behaviour (criticized or instructed) — written by the plan author. */
	member_ids: string[];
	/** Roster members whose name/alias/gamertag occurs in the unit's source lines — computed by the script (`namedMemberIds`), never written by the plan author. */
	named_member_ids: string[];
	/** The subset of `member_ids` whose role as actor was inferred because the source sentence has no subject ("~했을 때" clause, a return pass's receiver); `[]` when none. */
	inferred_member_ids: string[];
	key_frame_candidate_ids: string[];
	addressed_to_all: boolean;
	/** Positions of the unnamed group the title addresses as an actor ("수비 라인" → DF); each is also in `position_tags`. */
	group_positions: string[];
	/** YouTube handles of the comment lines in this unit's line range, first-seen order, no duplicates. */
	comment_authors: string[];
}

export interface ValidatedTopic {
	id: string;
	title: string;
	summary: string;
	unit_ids: string[];
}

export interface ValidatedMatch {
	id: string;
	title: string;
	topics: ValidatedTopic[];
	/** Who played which position in this match; null when the session has no roster. */
	lineup: Lineup | null;
}

/** A problem that repeats across the session: `unit_ids` are the units (document order) that each hit it once. */
export interface ValidatedRecurring {
	label: string;
	unit_ids: string[];
	/** Roster ids whose repeated behaviour the label names; `[]` when the label names a team unit or position. */
	member_ids: string[];
}

export interface ValidatedPlan {
	version: 1;
	session_title: string;
	matches: ValidatedMatch[];
	units: ValidatedUnit[];
	recurring: ValidatedRecurring[];
	/** Titles of matches the session videos contain but that have no feedback unit (e.g. "2경기 · LVT 대 AL"); `[]` when every match has feedback. */
	matches_without_feedback: string[];
}

export interface ProposedTag {
	tag: string;
	reason: string;
}

export interface CheckPlanContext {
	lines: Line[];
	candidates: Candidate[];
	taxonomy: Taxonomy;
	roster: Roster | null;
}

export interface CheckPlanResult {
	errors: ValidationError[];
	pending: boolean;
	validated: ValidatedPlan;
	tableMd: string;
	proposed: ProposedTag[];
}

const TITLE_MAX_LENGTH = 80;
const RECURRING_LABEL_MAX_LENGTH = 40;
const RECURRING_MIN_LINES = 2;
export const KEY_FRAME_TOLERANCE_SECONDS = 5;

function checkTitle(raw: unknown, path: string, errors: ValidationError[]): string {
	const title = requireNonBlank(raw, path, errors, "title은 비어 있지 않아야 합니다");
	if (title.length > TITLE_MAX_LENGTH) {
		errors.push({ path, message: `title은 ${TITLE_MAX_LENGTH}자 이하여야 합니다` });
	}
	return title;
}

function escapeTableCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function memberDisplayName(memberId: string, roster: Roster | null): string {
	const member = roster?.members.find((candidate) => candidate.id === memberId);
	return member?.name ?? memberId;
}

/**
 * Roster members (roster order) whose `name`, any `aliases` entry, or `gamertag` occurs in the `text`
 * of the unit's source lines — substring match, case-insensitive for Latin letters, so a Korean
 * particle after the name ("동그리와") still matches. A comment's `author` is not read. Empty without
 * a roster (disabled mode).
 */
export function namedMemberIds(unitLines: readonly { text: string }[], roster: Roster | null): string[] {
	if (roster === null) return [];
	const haystack = unitLines.map((line) => line.text).join("\n");
	return roster.members.filter((member) => mentionsMember(haystack, member)).map((member) => member.id);
}

/** Whether `text` contains the member's `name`, an `aliases` entry, or `gamertag` (substring, case-insensitive for Latin letters). */
export function mentionsMember(text: string, member: Member): boolean {
	const haystack = text.toLowerCase();
	return memberLabels(member).some((label) => haystack.includes(label.toLowerCase()));
}

/** The non-empty, trimmed labels a text can call the member by: `name`, `aliases`, `gamertag`. */
function memberLabels(member: Member): string[] {
	return [member.name, ...member.aliases, member.gamertag].map((label) => label.trim()).filter((label) => label !== "");
}

function commentAuthorsInRange(lines: readonly Line[], startLine: number, endLine: number): string[] {
	const authors: string[] = [];
	for (const line of lines.slice(startLine, endLine + 1)) {
		if (line.source === "comment" && !authors.includes(line.author)) authors.push(line.author);
	}
	return authors;
}

/**
 * The display name of a comment writer: the roster member whose name/gamertag/alias matches the
 * handle (without "@", case-insensitive), also when YouTube appended a "-xxx" disambiguator to it;
 * otherwise the handle without "@".
 */
export function commentAuthorName(handle: string, roster: Roster | null): string {
	return commentAuthorMember(handle, roster)?.name ?? handle.replace(/^@/, "");
}

/** The roster member a comment writer's YouTube handle belongs to (matching rule of `commentAuthorName`); null when no roster or no match. */
export function commentAuthorMember(handle: string, roster: Roster | null): Member | null {
	const lower = handle.replace(/^@/, "").toLowerCase();
	return (
		roster?.members.find((candidate) =>
			[candidate.name, candidate.gamertag, ...candidate.aliases].some((label) => {
				const key = label.toLowerCase();
				return lower === key || lower.startsWith(`${key}-`);
			}),
		) ?? null
	);
}

/**
 * Roster ids (in `memberIds` order) that the unit asks to fix and that are also the writer of one of the unit's
 * comments - a self-critique, which the card marks so it does not read as someone else blaming the member.
 */
export function selfCritiqueMemberIds(memberIds: readonly string[], commentAuthors: readonly string[], roster: Roster | null): string[] {
	const authorIds = new Set(commentAuthors.map((handle) => commentAuthorMember(handle, roster)?.id));
	return memberIds.filter((id) => authorIds.has(id));
}

/** A plan unit's `start_line..end_line` (inclusive) — recorded only for units whose lines validated. */
interface UnitLineRange {
	id: string;
	startLine: number;
	endLine: number;
}

/**
 * Validates plan.json `recurring` (required; `[]` when nothing repeats — the validator cannot know
 * that). Each entry's `lines` must land in pairwise-distinct plan units; the result lists those
 * units in document order.
 */
/**
 * A unit title is the card's first line, read as either the action to take or the fault stated:
 * each " / "-joined segment is `행위자: 행동` whose action ends in the to-do form "~기" ("더 벌리기",
 * "무리하게 가로채지 않기") or in a Hangul syllable with final consonant ㅁ, the nominal that names
 * a fault ("첫판부터 정신 놓음", "뒷공간을 내줌"). One trailing parenthetical hedge ("뒤로 빼기(아직까진)")
 * is stripped before the ending is checked. Returns one message per malformed segment for the caller
 * to attach at the title path; an empty title is already reported by `checkTitle`.
 */
export function unitTitleFormErrors(title: string): string[] {
	if (title.trim() === "") {
		return [];
	}
	return title
		.split(" / ")
		.filter((segment) => !isUnitTitleSegment(segment.trim()))
		.map(
			(segment) =>
				`제목 조각 "${segment.trim()}"은 "행위자: 행동" 꼴이어야 하고 행동은 할 일이면 "~기"(예 "뎁스차저: 더 벌리기"), 지적이면 -ㅁ 명사형(예 "뎁스차저: 첫판부터 정신 놓음")으로 끝나야 합니다(끝 괄호 유보는 뗀 뒤 봅니다)`,
		);
}

const UNIT_TITLE_SEGMENT = /^[^:\s][^:]*: (\S.*)$/u;
const UNIT_TITLE_TRAILING_HEDGE = /\([^()]*\)$/u;
const HANGUL_SYLLABLE_BASE = 0xac00;
const HANGUL_SYLLABLE_LAST = 0xd7a3;
const JONGSEONG_MIEUM_INDEX = 16;

/** The action text of a title segment (`행위자: 행동`) with one trailing parenthetical hedge stripped; undefined when the segment is not that shape or the action is 1 char. */
function unitTitleSegmentAction(segment: string): string | undefined {
	const action = UNIT_TITLE_SEGMENT.exec(segment)?.[1]?.replace(UNIT_TITLE_TRAILING_HEDGE, "").trimEnd();
	return action === undefined || action.length < 2 ? undefined : action;
}

/** A well-formed title segment whose action ends in a Hangul syllable with final consonant ㅁ — the fault ("-ㅁ 지적") form. */
export function isFaultTitleSegment(segment: string): boolean {
	const action = unitTitleSegmentAction(segment);
	if (action === undefined) {
		return false;
	}
	const last = action.charCodeAt(action.length - 1);
	return last >= HANGUL_SYLLABLE_BASE && last <= HANGUL_SYLLABLE_LAST && (last - HANGUL_SYLLABLE_BASE) % 28 === JONGSEONG_MIEUM_INDEX;
}

function isUnitTitleSegment(segment: string): boolean {
	const action = unitTitleSegmentAction(segment);
	return action !== undefined && (action.endsWith("기") || isFaultTitleSegment(segment));
}

/** Whether at least one " / "-joined segment of the title is in the fault (-ㅁ) form — the same predicate `unitTitleFormErrors` uses to accept a segment. */
export function unitTitleHasFaultSegment(title: string): boolean {
	return title.split(" / ").some((segment) => isFaultTitleSegment(segment.trim()));
}

function checkRecurring(
	raw: unknown,
	ranges: readonly UnitLineRange[],
	lineCount: number,
	units: readonly ValidatedUnit[],
	roster: Roster | null,
	errors: ValidationError[],
): ValidatedRecurring[] {
	if (!Array.isArray(raw)) {
		errors.push({
			path: "recurring",
			message: 'recurring은 배열이어야 합니다 — 반복되는 지적이 없으면 "recurring": []를 추가하세요',
		});
		return [];
	}
	const result: ValidatedRecurring[] = [];
	const seenLabels = new Set<string>();
	raw.forEach((entry, index) => {
		const entryPath = `recurring[${index}]`;
		if (!isRecord(entry)) {
			errors.push({ path: entryPath, message: "recurring 항목은 객체여야 합니다" });
			return;
		}
		const labelPath = `${entryPath}.label`;
		const label = requireNonBlank(entry.label, labelPath, errors, "label은 비어 있지 않아야 합니다");
		if (label !== "") {
			if (/[\r\n]/.test(label)) {
				errors.push({ path: labelPath, message: "label은 한 줄이어야 합니다" });
			}
			if (label.length > RECURRING_LABEL_MAX_LENGTH) {
				errors.push({ path: labelPath, message: `label은 ${RECURRING_LABEL_MAX_LENGTH}자 이하여야 합니다` });
			}
			if (seenLabels.has(label)) {
				errors.push({ path: labelPath, message: `plan 안에서 label이 중복됩니다: ${label}` });
			}
			seenLabels.add(label);
		}
		const linesPath = `${entryPath}.lines`;
		if (!Array.isArray(entry.lines) || entry.lines.length < RECURRING_MIN_LINES) {
			errors.push({ path: linesPath, message: `lines는 정수 ${RECURRING_MIN_LINES}개 이상의 배열이어야 합니다` });
			return;
		}
		const hitIndexes: number[] = [];
		entry.lines.forEach((lineIndex, i) => {
			const linePath = `${linesPath}[${i}]`;
			if (!isNonNegativeInt(lineIndex) || lineIndex >= lineCount) {
				errors.push({ path: linePath, message: `0 이상 lines.length(${lineCount}) 미만의 정수여야 합니다` });
				return;
			}
			const unitIndex = ranges.findIndex((range) => lineIndex >= range.startLine && lineIndex <= range.endLine);
			if (unitIndex === -1) {
				errors.push({ path: linePath, message: `어떤 unit의 start_line..end_line에도 속하지 않는 줄입니다: ${lineIndex}` });
				return;
			}
			if (hitIndexes.includes(unitIndex)) {
				errors.push({ path: linePath, message: `같은 항목의 다른 줄과 같은 unit(${ranges[unitIndex].id})에 속합니다` });
				return;
			}
			hitIndexes.push(unitIndex);
		});
		const unitIds = [...hitIndexes].sort((a, b) => a - b).map((unitIndex) => ranges[unitIndex].id);
		const memberIds = checkRecurringMembers(entry.member_ids, unitIds, units, roster, `${entryPath}.member_ids`, errors);
		if (label !== "") {
			checkRecurringOwnersCoverRosterTitles(label, memberIds, unitIds, units, roster, `${entryPath}.member_ids`, errors);
			checkRecurringOwnersCoverSegmentCoActors(label, memberIds, unitIds, units, roster, `${entryPath}.member_ids`, errors);
		}
		result.push({ label, unit_ids: unitIds, member_ids: memberIds });
	});
	return result;
}

/** Korean subject particle for a name: "이" after a final consonant (홍길동), "가" otherwise (뎁스차저, Latin names). */
function subjectParticle(name: string): string {
	const last = name.charCodeAt(name.length - 1);
	return last >= HANGUL_SYLLABLE_BASE && last <= HANGUL_SYLLABLE_LAST && (last - HANGUL_SYLLABLE_BASE) % 28 !== 0 ? "이" : "가";
}

/**
 * A unit of a recurring item whose title names only roster members as actors (no "수비진"/"수비 라인"/"전원") and that
 * has fixers (`member_ids`) blames those people, so the item's `member_ids` must list at least one of them — else the
 * label would read as a team fault while its chips blame a person. Units with a non-roster title actor, no title
 * actor at all, or no fixers are exempt. Actors match a roster name, alias, or gamertag exactly (case-insensitive).
 */
function checkRecurringOwnersCoverRosterTitles(
	label: string,
	ownerIds: readonly string[],
	unitIds: readonly string[],
	units: readonly ValidatedUnit[],
	roster: Roster | null,
	path: string,
	errors: ValidationError[],
): void {
	if (roster === null) return;
	const isRosterActor = (actor: string) => roster.members.some((member) => memberLabels(member).some((memberLabel) => memberLabel.toLowerCase() === actor.toLowerCase()));
	for (const unitId of unitIds) {
		const unit = units.find((candidate) => candidate.id === unitId);
		if (unit === undefined || unit.member_ids.length === 0) continue;
		const actors = titleSegmentContent(unit.title).flatMap((segment) => segment.actors);
		if (actors.length === 0 || !actors.every(isRosterActor) || unit.member_ids.some((id) => ownerIds.includes(id))) continue;
		const names = unit.member_ids.map((id) => memberDisplayName(id, roster)).join(", ");
		errors.push({ path, message: `recurring '${label}': ${unitId}의 고칠 사람 ${names}${subjectParticle(names)} member_ids에 없다` });
	}
}

/**
 * A title segment shares one action between its actors ("뎁스차저·우사: 슈퍼 캔슬로 서로 위치 조정하기"). When one roster member in that
 * segment's actors is an owner of the recurring item (in its `member_ids`), every other roster member in the same segment's actors
 * must be an owner too — else the item blames half of a joint action. Segments with no owner, and non-roster actors, are exempt.
 */
function checkRecurringOwnersCoverSegmentCoActors(
	label: string,
	ownerIds: readonly string[],
	unitIds: readonly string[],
	units: readonly ValidatedUnit[],
	roster: Roster | null,
	path: string,
	errors: ValidationError[],
): void {
	if (roster === null) return;
	const memberOfActor = (actor: string): Member | undefined =>
		roster.members.find((member) => memberLabels(member).some((memberLabel) => memberLabel.toLowerCase() === actor.toLowerCase()));
	const reported = new Set<string>();
	for (const unitId of unitIds) {
		const unit = units.find((candidate) => candidate.id === unitId);
		if (unit === undefined) continue;
		for (const { actors } of titleSegmentContent(unit.title)) {
			const members = actors.flatMap((actor) => memberOfActor(actor) ?? []);
			if (!members.some((member) => ownerIds.includes(member.id))) continue;
			for (const member of members.filter((candidate) => !ownerIds.includes(candidate.id))) {
				const key = `${unitId}\u0000${actors.join(TITLE_ACTOR_SEPARATOR)}\u0000${member.id}`;
				if (reported.has(key)) continue;
				reported.add(key);
				errors.push({
					path,
					message: `recurring '${label}': ${unitId}의 제목 조각 "${actors.join(TITLE_ACTOR_SEPARATOR)}"에서 함께 묶인 ${member.name}${subjectParticle(member.name)} member_ids에 없다`,
				});
			}
		}
	}
}

/**
 * `recurring[].member_ids`: the roster ids whose repeated behaviour the label names ("동그리가 더
 * 올라가지 않음" → 동그리; "리턴 패스를 하지 않음" by different players → each of them), `[]` when the label
 * names a team unit or position ("수비 라인이 맞지 않음"). Each id must be someone at least one of the
 * entry's units tells to change (`member_ids`), and the list must be empty without a roster.
 */
function checkRecurringMembers(
	raw: unknown,
	unitIds: readonly string[],
	units: readonly ValidatedUnit[],
	roster: Roster | null,
	path: string,
	errors: ValidationError[],
): string[] {
	if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
		errors.push({
			path,
			message: 'member_ids는 문자열 배열이어야 합니다 — label이 말하는 반복 행동의 주인(명단 id), 특정인이 아니라 단위·포지션이면 []',
		});
		return [];
	}
	if (roster === null && raw.length > 0) {
		errors.push({ path, message: "명단이 없는(disabled) 모드에서는 member_ids가 빈 배열이어야 합니다" });
		return [];
	}
	for (const memberId of raw) {
		const owns = unitIds.some((unitId) => units.find((unit) => unit.id === unitId)?.member_ids.includes(memberId));
		if (!owns) {
			errors.push({ path, message: `${memberId}는 묶인 유닛(${unitIds.join(", ")}) 어디의 member_ids에도 없습니다 — 반복 행동의 주인은 그 행동을 한 유닛에서 고칠 사람이어야 합니다` });
		}
	}
	return raw;
}

/**
 * Validates plan.json (Claude-authored index) against the session's `lines`,
 * `candidates`, `taxonomy`, and `roster` (plan §3, all rules). On success,
 * `validated` assigns `m1…`/`m1-t1…`/`u001…` ids in document order and adds
 * each unit's `start`/`end` (seconds, from `lines`) and `video`; `tableMd` is
 * the human review-gate table with any proposed tags listed below it.
 */
/**
 * `matches[].lineup`: required with a roster (an object; `{}` when the writer confirmed nobody), each key a
 * roster member id and each value a position in the tree. Without a roster it must be absent or `{}` (→ null).
 */
function checkLineup(raw: unknown, roster: Roster | null, path: string, errors: ValidationError[]): Lineup | null {
	if (roster === null) {
		if (raw !== undefined && !(isRecord(raw) && Object.keys(raw).length === 0)) {
			errors.push({ path, message: "명단(roster)이 없으면 lineup은 생략하거나 {}여야 합니다" });
		}
		return null;
	}
	if (!isRecord(raw)) {
		errors.push({
			path,
			message: "lineup은 그 경기에 뛴 팀원 id → 그 경기 포지션 객체여야 합니다 — 이름표·원문·캡션으로 확인한 팀원만 적고, 없으면 {}",
		});
		return {};
	}
	const lineup: Lineup = {};
	for (const [memberId, position] of Object.entries(raw)) {
		if (!roster.members.some((member) => member.id === memberId)) {
			errors.push({ path: `${path}.${memberId}`, message: "명단에 없는 member id입니다" });
		} else if (typeof position !== "string" || !POSITIONS.has(position)) {
			errors.push({
				path: `${path}.${memberId}`,
				message: invalidPositionMessage(position, `포지션 트리에 없는 값입니다: ${describeUnknown(position)}`),
			});
		} else {
			lineup[memberId] = position;
		}
	}
	return lineup;
}

/**
 * Validates plan.json `matches_without_feedback` (required; `[]` when every match has feedback - the validator
 * cannot know that): each entry is a nonblank match title of at most `TITLE_MAX_LENGTH` characters.
 */
function checkMatchesWithoutFeedback(raw: unknown, errors: ValidationError[]): string[] {
	if (!Array.isArray(raw)) {
		errors.push({
			path: "matches_without_feedback",
			message: 'matches_without_feedback는 배열이어야 합니다 — 피드백이 없는 경기가 없으면 "matches_without_feedback": []를 추가하세요',
		});
		return [];
	}
	const titles: string[] = [];
	raw.forEach((entry, index) => {
		const title = requireNonBlank(entry, `matches_without_feedback[${index}]`, errors, "경기 제목은 비어 있지 않은 문자열이어야 합니다");
		if (title.length > TITLE_MAX_LENGTH) {
			errors.push({ path: `matches_without_feedback[${index}]`, message: `경기 제목은 ${TITLE_MAX_LENGTH}자 이하여야 합니다` });
		}
		titles.push(title);
	});
	return titles;
}

/**
 * Unit ids in time order: u001 is the unit with the smallest `start_line`, whichever topic holds it (a topic may
 * group units that are not adjacent in time). Keyed by the raw unit object; a unit without a valid `start_line`
 * (already a `checkPlan` error) sorts last, in document order.
 */
function timeOrderedUnitIds(matchesRaw: unknown): Map<object, string> {
	const rawUnits: Array<{ raw: Record<string, unknown>; start: number }> = [];
	for (const matchRaw of Array.isArray(matchesRaw) ? matchesRaw : []) {
		for (const topicRaw of isRecord(matchRaw) && Array.isArray(matchRaw.topics) ? matchRaw.topics : []) {
			for (const unitRaw of isRecord(topicRaw) && Array.isArray(topicRaw.units) ? topicRaw.units : []) {
				if (isRecord(unitRaw)) rawUnits.push({ raw: unitRaw, start: isNonNegativeInt(unitRaw.start_line) ? unitRaw.start_line : Infinity });
			}
		}
	}
	// Array#sort is stable, so equal starts keep document order.
	rawUnits.sort((a, b) => (a.start === b.start ? 0 : a.start < b.start ? -1 : 1));
	return new Map(rawUnits.map(({ raw }, index) => [raw, `u${String(index + 1).padStart(3, "0")}`]));
}

/**
 * `inferred_member_ids` (optional; absent = no inference): the people of `member_ids` whose role as actor the writer inferred because the
 * source sentence names no subject. A string array that is a subset of the unit's `member_ids`.
 */
function checkInferredMemberIds(raw: unknown, memberIds: readonly string[], path: string, errors: ValidationError[]): string[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
		errors.push({ path, message: "inferred_member_ids는 member id 문자열 배열이어야 합니다 — 원문에 주어가 없어 행위자를 추정한 사람(member_ids의 부분집합), 없으면 필드를 생략" });
		return [];
	}
	raw.forEach((memberId, index) => {
		if (!memberIds.includes(memberId)) {
			errors.push({ path: `${path}[${index}]`, message: `member_ids에 없는 id입니다: ${memberId} — 추정한 행위자는 그 유닛의 고칠 사람(member_ids)이어야 합니다` });
		}
	});
	return raw;
}

export function checkPlan(plan: unknown, context: CheckPlanContext): CheckPlanResult {
	const { lines, candidates, taxonomy, roster } = context;
	const errors: ValidationError[] = [];
	const emptyValidated: ValidatedPlan = { version: 1, session_title: "", matches: [], units: [], recurring: [], matches_without_feedback: [] };
	if (!isRecord(plan)) {
		errors.push({ path: "", message: "plan.json은 객체여야 합니다" });
		return { errors, pending: false, validated: emptyValidated, tableMd: "", proposed: [] };
	}

	const session_title = checkTitle(plan.session_title, "session_title", errors);

	// proposed_tags is validated before scanning units, so unit topic_tags can reference it.
	const proposed: ProposedTag[] = [];
	const validProposedTagNames = new Set<string>();
	if (plan.proposed_tags !== undefined) {
		if (!Array.isArray(plan.proposed_tags)) {
			errors.push({ path: "proposed_tags", message: "proposed_tags는 배열이어야 합니다" });
		} else {
			plan.proposed_tags.forEach((entry, index) => {
				if (!isRecord(entry)) {
					errors.push({ path: `proposed_tags[${index}]`, message: "proposed_tags 항목은 객체여야 합니다" });
					return;
				}
				const tagPath = `proposed_tags[${index}].tag`;
				const tag = typeof entry.tag === "string" ? entry.tag : "";
				const reason = typeof entry.reason === "string" ? entry.reason : "";
				if (!isValidTag(tag)) {
					errors.push({ path: tagPath, message: `유효하지 않은 태그입니다: ${describeUnknown(entry.tag)}` });
					return;
				}
				if (taxonomy.topics.includes(tag)) {
					errors.push({ path: tagPath, message: `이미 taxonomy에 있는 태그입니다: ${tag}` });
					return;
				}
				validProposedTagNames.add(tag);
				proposed.push({ tag, reason });
			});
		}
	}

	const matches: ValidatedMatch[] = [];
	const units: ValidatedUnit[] = [];
	const unitRanges: UnitLineRange[] = [];
	const rows: string[] = [];
	let usedProposedTag = false;
	const unitIds = timeOrderedUnitIds(plan.matches);
	/** Every unit with valid lines, for the cross-topic overlap check once all topics are read. */
	const placedUnits: Array<{ path: string; video: string; startLine: number; endLine: number }> = [];

	if (!Array.isArray(plan.matches) || plan.matches.length === 0) {
		errors.push({ path: "matches", message: "matches는 최소 1개 이상이어야 합니다" });
	} else {
		plan.matches.forEach((matchRaw, matchIndex) => {
			const matchPath = `matches[${matchIndex}]`;
			const matchId = `m${matchIndex + 1}`;
			if (!isRecord(matchRaw)) {
				errors.push({ path: matchPath, message: "match 항목은 객체여야 합니다" });
				return;
			}
			const matchTitle = checkTitle(matchRaw.title, `${matchPath}.title`, errors);
			const lineup = checkLineup(matchRaw.lineup, roster, `${matchPath}.lineup`, errors);

			const validatedTopics: ValidatedTopic[] = [];
			if (!Array.isArray(matchRaw.topics) || matchRaw.topics.length === 0) {
				errors.push({ path: `${matchPath}.topics`, message: "topics는 최소 1개 이상이어야 합니다" });
			} else {
				matchRaw.topics.forEach((topicRaw, topicIndex) => {
					const topicPath = `${matchPath}.topics[${topicIndex}]`;
					const topicId = `${matchId}-t${topicIndex + 1}`;
					if (!isRecord(topicRaw)) {
						errors.push({ path: topicPath, message: "topic 항목은 객체여야 합니다" });
						return;
					}
					const topicTitle = checkTitle(topicRaw.title, `${topicPath}.title`, errors);
					const summary = requireNonBlank(
						topicRaw.summary,
						`${topicPath}.summary`,
						errors,
						"summary는 비어 있지 않아야 합니다",
					);

					const topicUnitIds: string[] = [];
					let previousStartLine = -1;
					if (!Array.isArray(topicRaw.units) || topicRaw.units.length === 0) {
						errors.push({ path: `${topicPath}.units`, message: "units는 최소 1개 이상이어야 합니다" });
					} else {
						topicRaw.units.forEach((unitRaw, unitIndex) => {
							const unitPath = `${topicPath}.units[${unitIndex}]`;
							if (!isRecord(unitRaw)) {
								errors.push({ path: unitPath, message: "unit 항목은 객체여야 합니다" });
								return;
							}
							const unitId = unitIds.get(unitRaw) ?? "";
							const unitTitle = checkTitle(unitRaw.title, `${unitPath}.title`, errors);
							for (const message of unitTitleFormErrors(unitTitle)) {
								errors.push({ path: `${unitPath}.title`, message });
							}

							const startLine = isNonNegativeInt(unitRaw.start_line) ? unitRaw.start_line : -1;
							if (startLine === -1) {
								errors.push({ path: `${unitPath}.start_line`, message: "0 이상의 정수여야 합니다" });
							}
							const endLine =
								isNonNegativeInt(unitRaw.end_line) && unitRaw.end_line < lines.length ? unitRaw.end_line : -1;
							if (endLine === -1) {
								errors.push({
									path: `${unitPath}.end_line`,
									message: `0 이상 lines.length(${lines.length}) 미만의 정수여야 합니다`,
								});
							}

							let linesValid = false;
							let unitVideo = "";
							let unitStart = 0;
							let unitEnd = 0;
							if (startLine !== -1 && endLine !== -1) {
								if (startLine > endLine) {
									errors.push({
										path: `${unitPath}.end_line`,
										message: "end_line은 start_line 이상이어야 합니다",
									});
								} else if (lines[startLine].video !== lines[endLine].video) {
									errors.push({
										path: `${unitPath}.end_line`,
										message: "start_line과 end_line은 같은 video여야 합니다",
									});
								} else {
									linesValid = true;
									unitVideo = lines[startLine].video;
									unitStart = lines[startLine].start;
									unitEnd = lines[endLine].end;
								}
							}

							if (linesValid) {
								if (startLine <= previousStartLine) {
									errors.push({
										path: `${unitPath}.start_line`,
										message: "한 topic 안의 unit은 이전 unit보다 뒤(오름차순)여야 합니다",
									});
								}
								previousStartLine = startLine;
								placedUnits.push({ path: `${unitPath}.start_line`, video: unitVideo, startLine, endLine });
							}

							const position_tags = requireStringArray(
								unitRaw.position_tags,
								`${unitPath}.position_tags`,
								errors,
								"position_tags는 배열이어야 합니다",
							);
							position_tags.forEach((tag, tagIndex) => {
								if (!POSITIONS.has(tag)) {
									errors.push({
										path: `${unitPath}.position_tags[${tagIndex}]`,
										message: invalidPositionMessage(tag, `포지션 트리에 없는 태그입니다: ${tag}`),
									});
								}
							});

							const topicTagsIsArray = Array.isArray(unitRaw.topic_tags);
							const topic_tags = requireStringArray(
								unitRaw.topic_tags,
								`${unitPath}.topic_tags`,
								errors,
								"topic_tags는 배열이어야 합니다",
							);
							if (topicTagsIsArray && topic_tags.length === 0) {
								errors.push({ path: `${unitPath}.topic_tags`, message: "topic_tags는 최소 1개 이상이어야 합니다" });
							}
							topic_tags.forEach((tag, tagIndex) => {
								const tagPath = `${unitPath}.topic_tags[${tagIndex}]`;
								if (!isValidTag(tag)) {
									errors.push({ path: tagPath, message: `유효하지 않은 태그입니다: ${tag}` });
									return;
								}
								if (taxonomy.topics.includes(tag)) {
									return;
								}
								if (validProposedTagNames.has(tag)) {
									usedProposedTag = true;
									return;
								}
								errors.push({
									path: tagPath,
									message: `taxonomy에도 proposed_tags에도 없는 태그입니다: ${tag}`,
								});
							});

							const member_ids = requireStringArray(
								unitRaw.member_ids,
								`${unitPath}.member_ids`,
								errors,
								"member_ids는 배열이어야 합니다",
							);
							member_ids.forEach((memberId, memberIndex) => {
								const memberPath = `${unitPath}.member_ids[${memberIndex}]`;
								if (roster === null) {
									errors.push({
										path: memberPath,
										message: "명단이 없는(disabled) 모드에서는 member_ids가 비어 있어야 합니다",
									});
								} else if (!roster.members.some((member) => member.id === memberId)) {
									errors.push({ path: memberPath, message: `로스터에 없는 멤버입니다: ${memberId}` });
								} else if (lineup !== null && lineup[memberId] === undefined) {
									errors.push({
										path: memberPath,
										message: `고칠 사람은 그 경기에 뛰었으므로 ${matchPath}.lineup에 그 경기 포지션과 함께 있어야 합니다: ${memberId}`,
									});
								}
							});

							const inferred_member_ids = checkInferredMemberIds(unitRaw.inferred_member_ids, member_ids, `${unitPath}.inferred_member_ids`, errors);

							// addressed_to_all: 예전 plan.json 호환 — 필드가 없으면(옛 plan) false로 취급한다.
							let addressed_to_all = false;
							const addressedToAllRaw = unitRaw.addressed_to_all;
							if (addressedToAllRaw !== undefined) {
								if (typeof addressedToAllRaw !== "boolean") {
									errors.push({
										path: `${unitPath}.addressed_to_all`,
										message: "addressed_to_all은 boolean이어야 합니다",
									});
								} else {
									addressed_to_all = addressedToAllRaw;
								}
							}

							const group_positions = requireStringArray(
								unitRaw.group_positions,
								`${unitPath}.group_positions`,
								errors,
								'group_positions는 배열이어야 합니다 — 제목이 이름 없는 단위("수비 라인", "수비진")를 행위자로 부르면 그 포지션(["DF"]), 아니면 []',
							);
							group_positions.forEach((position, positionIndex) => {
								if (!position_tags.includes(position)) {
									errors.push({
										path: `${unitPath}.group_positions[${positionIndex}]`,
										message: invalidPositionMessage(position, `position_tags에 없는 포지션입니다: ${position}`),
									});
								}
							});

							if (addressed_to_all && group_positions.length > 0) {
								errors.push({
									path: `${unitPath}.group_positions`,
									message: `fc-feedback: 유닛 ${unitId}: 전원 대상(addressed_to_all) 유닛은 group_positions가 비어야 합니다 — 전원에게 하는 말은 포지션 단위로 나누지 않습니다`,
								});
							}

							if (member_ids.length === 0 && position_tags.length === 0 && !addressed_to_all) {
								errors.push({
									path: unitPath,
									message:
										"대상이 없습니다 — member_ids·position_tags·addressed_to_all 중 하나는 있어야 합니다(이름 없는 단위 지적은 그 포지션을 position_tags로)",
								});
							}

							const key_frame_candidate_ids = requireStringArray(
								unitRaw.key_frame_candidate_ids,
								`${unitPath}.key_frame_candidate_ids`,
								errors,
								"key_frame_candidate_ids는 배열이어야 합니다",
							);
							key_frame_candidate_ids.forEach((candId, candIndex) => {
								const candPath = `${unitPath}.key_frame_candidate_ids[${candIndex}]`;
								const candidate = candidates.find((c) => c.id === candId);
								if (candidate === undefined) {
									errors.push({ path: candPath, message: `존재하지 않는 후보입니다: ${candId}` });
									return;
								}
								if (linesValid && candidate.video !== unitVideo) {
									errors.push({ path: candPath, message: "unit과 다른 video의 후보입니다" });
									return;
								}
								if (
									linesValid &&
									(candidate.t < unitStart - KEY_FRAME_TOLERANCE_SECONDS ||
										candidate.t > unitEnd + KEY_FRAME_TOLERANCE_SECONDS)
								) {
									errors.push({
										path: candPath,
										message: `허용 범위(unit ±${KEY_FRAME_TOLERANCE_SECONDS}초)를 벗어난 시각입니다: ${candidate.t}`,
									});
								}
							});

							topicUnitIds.push(unitId);
							if (linesValid) unitRanges.push({ id: unitId, startLine, endLine });
							units.push({
								id: unitId,
								match_id: matchId,
								topic_id: topicId,
								video: unitVideo,
								start: unitStart,
								end: unitEnd,
								title: unitTitle,
								position_tags,
								topic_tags,
								member_ids,
								named_member_ids: linesValid ? namedMemberIds(lines.slice(startLine, endLine + 1), roster) : [],
								inferred_member_ids,
								key_frame_candidate_ids,
								addressed_to_all,
								group_positions,
								comment_authors: linesValid ? commentAuthorsInRange(lines, startLine, endLine) : [],
							});

							const memberNames = member_ids.map((id) => memberDisplayName(id, roster));
							const memberCell = addressed_to_all
								? escapeTableCell(memberNames.length > 0 ? `전원 + ${memberNames.join(", ")}` : "전원")
								: memberNames.length > 0
									? escapeTableCell(memberNames.join(", "))
									: "-";
							rows.push(
								`| ${escapeTableCell(matchTitle)} | ${formatTime(unitStart)} | ${escapeTableCell(unitTitle)} | ${
									position_tags.length > 0 ? escapeTableCell(position_tags.join(", ")) : "-"
								} | ${topic_tags.length > 0 ? escapeTableCell(topic_tags.join(", ")) : "-"} | ${memberCell} |`,
							);
						});
					}

					validatedTopics.push({ id: topicId, title: topicTitle, summary, unit_ids: topicUnitIds });
				});
			}

			matches.push({ id: matchId, title: matchTitle, topics: validatedTopics, lineup });
		});
	}

	// Units may sit in any topic, so overlap is checked over each video's units sorted by start, not per topic.
	const lastEndLineByVideo = new Map<string, number>();
	for (const placed of [...placedUnits].sort((x, y) => x.startLine - y.startLine)) {
		const previousEndLine = lastEndLineByVideo.get(placed.video);
		if (previousEndLine !== undefined && placed.startLine <= previousEndLine) {
			errors.push({ path: placed.path, message: "같은 video 내에서 다른 unit과 겹치지 않아야 합니다" });
		}
		lastEndLineByVideo.set(placed.video, Math.max(placed.endLine, previousEndLine ?? -1));
	}
	// `units` and `unitRanges` are in time order (id order), not plan order.
	units.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
	unitRanges.sort((x, y) => x.startLine - y.startLine);

	const recurring = checkRecurring(plan.recurring, unitRanges, lines.length, units, roster, errors);
	const matches_without_feedback = checkMatchesWithoutFeedback(plan.matches_without_feedback, errors);

	const pending = errors.length === 0 && usedProposedTag;
	const validated: ValidatedPlan = { version: 1, session_title, matches, units, recurring, matches_without_feedback };

	const tableLines = ["| 경기 | 시간 | 제목 | 포지션 | 주제 | 팀원 |", "|---|---|---|---|---|---|", ...rows];
	if (recurring.length > 0) {
		const startById = new Map(units.map((unit) => [unit.id, unit.start]));
		tableLines.push(
			"",
			"반복 지적:",
			...recurring.map(
				(entry) =>
					`- ${entry.label} ×${entry.unit_ids.length} (${entry.unit_ids.map((id) => formatTime(startById.get(id) ?? 0)).join(", ")})`,
			),
		);
	}
	if (matches_without_feedback.length > 0) {
		tableLines.push("", "피드백 없는 경기:", ...matches_without_feedback.map((title) => `- ${title}`));
	}
	if (proposed.length > 0) {
		tableLines.push("", "제안 태그:", ...proposed.map((entry) => `- ${entry.tag} (${entry.reason})`));
	}

	return { errors, pending, validated, tableMd: tableLines.join("\n"), proposed };
}

const TITLE_ACTOR_SEPARATOR = "·";
/** Trailing particles stripped from a title word, longest first so "이나" wins over "나". */
const TITLE_WORD_PARTICLES = ["으로", "이나", "에게", "나", "을", "를", "이", "가", "은", "는", "에", "의", "와", "과", "로", "도", "만"];
/** Generic title words that say nothing about which fault it is. */
const TITLE_WORD_STOPLIST: ReadonlySet<string> = new Set(["하기", "않기", "말고", "더", "빠르게", "무리하게", "공을", "패스", "패스하기"]);

/**
 * A condition-clause word ("잡으면", "받으면", "하면", "할때", "했을" of "했을 때"): it says when, not which fault. A noun that merely ends in 면
 * ("측면", "화면") is not one: -면 counts only from three syllables or after a verb stem of 하/되/보/오/가/서/나.
 */
function isConditionClauseWord(word: string): boolean {
	return (word.endsWith("면") && (word.length >= 3 || /^(?:하|되|보|오|가|서|나)면$/u.test(word))) || word.endsWith("때") || /[았었했겠갔왔있없]을$/u.test(word);
}

function contentWords(action: string, rosterLabels: readonly string[]): Set<string> {
	const words = new Set<string>();
	for (const [raw] of action.matchAll(/[가-힣]+/gu)) {
		const particle = TITLE_WORD_PARTICLES.find((candidate) => raw.endsWith(candidate));
		const word = particle !== undefined && raw.length - particle.length >= 2 ? raw.slice(0, -particle.length) : raw;
		if (word.length >= 2 && !TITLE_WORD_STOPLIST.has(word) && !isConditionClauseWord(raw) && !rosterLabels.some((label) => word.includes(label))) words.add(word);
	}
	return words;
}

/** Each `행위자: 행동` segment of a unit title as individual actor names ("A·B" split) and the content words of the action. */
function titleSegmentContent(title: string, rosterLabels: readonly string[] = []): Array<{ actors: string[]; words: Set<string> }> {
	return title.split(" / ").flatMap((segment) => {
		const match = UNIT_TITLE_SEGMENT.exec(segment.trim());
		if (match === null) return [];
		const actors = segment.slice(0, segment.indexOf(":")).split(TITLE_ACTOR_SEPARATOR).map((actor) => actor.trim());
		return [{ actors, words: contentWords(match[1].replace(UNIT_TITLE_TRAILING_HEDGE, ""), rosterLabels) }];
	});
}

/**
 * Non-blocking `check plan` warnings: two units whose titles have a segment by the same actor with a shared content
 * word (Hangul word, one trailing particle stripped; 1-syllable words, generic words, condition-clause words (-면/-때) and
 * `roster` names/aliases/gamertags ignored) that are not both in one `recurring` item may be the same fault told twice.
 * One line per unit pair (document order), naming the first actor (sorted) and all its shared words, sorted.
 */
export function recurringCandidateWarnings(validated: ValidatedPlan, roster: Roster | null = null): string[] {
	const rosterLabels = (roster?.members ?? []).flatMap((member) => memberLabels(member)).filter((label) => label.length >= 2);
	const segments = validated.units.map((unit) => titleSegmentContent(unit.title, rosterLabels));
	const warnings: string[] = [];
	for (let i = 0; i < validated.units.length; i++) {
		for (let j = i + 1; j < validated.units.length; j++) {
			const [a, b] = [validated.units[i], validated.units[j]];
			if (validated.recurring.some((entry) => entry.unit_ids.includes(a.id) && entry.unit_ids.includes(b.id))) continue;
			const shared = new Map<string, string[]>();
			for (const left of segments[i]) {
				for (const right of segments[j]) {
					const words = [...left.words].filter((word) => right.words.has(word));
					for (const actor of left.actors.filter((name) => right.actors.includes(name))) {
						shared.set(actor, [...(shared.get(actor) ?? []), ...words]);
					}
				}
			}
			const hits = [...shared].filter(([, words]) => words.length > 0).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
			if (hits.length === 0) continue;
			const [actor, words] = hits[0];
			warnings.push(
				`fc-feedback: 경고 반복 지적 후보 ${a.id}·${b.id} "${actor}" 공통어 ${[...new Set(words)].sort().map((word) => `"${word}"`).join(", ")} — 같은 잘못이면 recurring에 묶는다`,
			);
		}
	}
	return warnings;
}

/**
 * Non-blocking `check plan` warnings: a `recurring` entry whose `member_ids` holds a member that a linked unit lists in `inferred_member_ids`
 * (the title names no actor, the script guessed one) — the repeated fault is pinned on a person nobody named. One line per entry, member and unit.
 */
export function recurringInferredActorWarnings(validated: ValidatedPlan, roster: Roster | null = null): string[] {
	return validated.recurring.flatMap((entry) =>
		entry.unit_ids.flatMap((unitId) => {
			const inferred = validated.units.find((unit) => unit.id === unitId)?.inferred_member_ids ?? [];
			return entry.member_ids
				.filter((memberId) => inferred.includes(memberId))
				.map((memberId) => `fc-feedback: 경고 반복 지적 ${entry.label}: ${roster?.members.find((member) => member.id === memberId)?.name ?? memberId}는 ${unitId}에서 추정한 행위자다`);
		}),
	);
}

/** A line that starts within this many seconds after a unit's end, yet is in no unit, is flagged by `trailingUnassignedLineWarnings`. */
export const TRAILING_LINE_WINDOW_SECONDS = 5;

/**
 * Non-blocking `check plan` warnings: a line of no unit (no unit of its video contains it by time) that starts at most
 * `TRAILING_LINE_WINDOW_SECONDS` after a unit's end — often the result of the play or the instruction the unit led up to
 * ("새로 패널티"). Speech has filler between units, so only lines this close are shown. One line per unit with hits.
 */
export function trailingUnassignedLineWarnings(validated: ValidatedPlan, lines: readonly Line[]): string[] {
	const unassigned = lines.filter((line) => !validated.units.some((unit) => unit.video === line.video && unit.start <= line.start && line.end <= unit.end));
	return validated.units.flatMap((unit) => {
		const hits = unassigned.filter((line) => line.video === unit.video && line.start - unit.end >= 0 && line.start - unit.end <= TRAILING_LINE_WINDOW_SECONDS);
		if (hits.length === 0) return [];
		return [
			`fc-feedback: 경고 ${unit.id} 끝 직후 어느 유닛에도 없는 줄: ${hits.map((line) => `${line.i}(${formatTime(line.start)}) "${line.text}"`).join(", ")} — 그 장면의 결과나 지시면 유닛 범위에 넣는다`,
		];
	});
}

// ── notes.json v2 (plan §16-1) ───────────────────────────────────────────────

export interface NoteTextBlock {
	type: "text";
	text: string;
}

export interface NoteFrameBlock {
	type: "frame";
	candidate_id: string;
	caption: string;
	/** Horizontal position (0..1, left to right) of the caption's subject in the frame; omitted when unknown. */
	focus_x?: number;
}

export type NoteBlock = NoteTextBlock | NoteFrameBlock;

export interface NotesV2 {
	version: 2;
	/**
	 * `unidentified_member_ids`: people to fix whom no frame of the unit lets the writer identify; omitted when none.
	 * `look_at`: where in the card's photos to look instead; required exactly when `unidentified_member_ids` is non-empty.
	 * `direction_check_ko` (optional): one sentence saying the source's left/right and the unit's frames disagree; the card shows it as "방향 확인 필요 · …".
	 * `marker_unresolved_ko` (optional): per member of `unidentified_member_ids`, why the unit's frames could not point at that person by marker colour; never rendered.
	 * `fault_scene`: how the fault looked in the unit's frames (who stood where, how the shape split); required exactly when the unit's title has a -ㅁ (fault) segment. */
	units: Record<string, { blocks: NoteBlock[]; unidentified_member_ids?: string[]; look_at?: string; fault_scene?: string; direction_check_ko?: string; marker_unresolved_ko?: Record<string, string> }>;
	/** Per match, the triangle colour above each human-controlled player (see `checkMarkerColors`); the card shows it as a colour legend. */
	marker_colors?: { match: number; member_id: string; color: string; evidence_candidate_id: string }[];
	/** Per match, name tags seen on a player that match no roster member (see `checkUnmatchedNameTags`); the card's colour legend lists them as "명단에 없음". */
	unmatched_name_tags?: { match: number; tag: string; color?: string; evidence_candidate_id: string }[];
}

const NOTES_V1_REJECTED_MESSAGE = "notes v1 형식은 더 이상 지원하지 않습니다 — v2 blocks 형식으로 작성";
const BLOCKS_MIN = 1;
const BLOCKS_MAX = 20;
const TEXT_MIN_LENGTH = 1;
const TEXT_MAX_LENGTH = 800;
const FRAME_CAPTION_MIN_LENGTH = 1;
/** A caption that opens with a clock or score ("34:12", "0:30, 1-0") duplicates the video-time chip printed beside it. */
const FRAME_CAPTION_CLOCK_PATTERN = /^\s*\d{1,2}:\d{2}/;
const FRAME_CAPTION_MAX_LENGTH = 120;
const LOOK_AT_MIN_LENGTH = 1;
const LOOK_AT_MAX_LENGTH = 60;
const DIRECTION_CHECK_MIN_LENGTH = 1;
const DIRECTION_CHECK_MAX_LENGTH = 100;
const FAULT_SCENE_MIN_LENGTH = 1;
const FAULT_SCENE_MAX_LENGTH = 120;
/** "원문" is the writer's process vocabulary for the source transcript; the card reader never sees a source document. */
const PROCESS_WORD_SOURCE_TEXT = "원문";
/**
 * Subject/locative forms that make a card sentence talk about the comment itself ("댓글은 좌측이라고 했다"); the card states the scene
 * or the coach's advice, not what a comment said. Applies to text blocks, frame captions, `fault_scene` and `look_at`. The one place that may
 * say it is `direction_check_ko` ("댓글은 좌측, 사진에서 몰린 쪽은 화면 위쪽"), the field for a source direction that disagrees with the frames.
 */
const COMMENT_SELF_REFERENCES = ["댓글은", "댓글이", "댓글에"];
/** Frame-caption phrases that report the writer's own difficulty identifying someone ("가려내기 어렵다"); a caption states what the frame shows, or that it does not show the person. */
const CAPTION_PROCESS_PHRASES = ["가려내기 어렵", "알아보기 어렵"];
const MAX_FRAMES_PER_UNIT = 6;

function requireTrimmedBoundedLength(
	raw: unknown,
	min: number,
	max: number,
	path: string,
	errors: ValidationError[],
	message: string,
): void {
	if (typeof raw !== "string" || raw.trim().length < min || raw.trim().length > max) {
		errors.push({ path, message });
	}
}

function requireNoNewline(raw: unknown, path: string, errors: ValidationError[], message: string): void {
	if (typeof raw === "string" && /[\r\n]/.test(raw)) {
		errors.push({ path, message });
	}
}

/** Even count of `**` markers, each enclosed span non-empty/non-whitespace-only (no nesting by construction). */
function requireBalancedBold(raw: unknown, path: string, errors: ValidationError[]): void {
	if (typeof raw !== "string") {
		return;
	}
	const segments = raw.split("**");
	if (segments.length % 2 !== 1) {
		errors.push({ path, message: "**는 짝을 이루어야 합니다" });
		return;
	}
	segments.forEach((segment, index) => {
		if (index % 2 === 1 && segment.trim() === "") {
			errors.push({ path, message: "**로 감싼 내용은 비어 있지 않아야 합니다" });
		}
	});
}

/**
 * Splits a validated text block (balanced, non-nested `**bold**` markers) into
 * plain/bold segments in order, for `render.ts`/`fc.ts` to turn into markup.
 */
export function boldSpans(text: string): Array<{ bold: boolean; text: string }> {
	const spans: Array<{ bold: boolean; text: string }> = [];
	text.split("**").forEach((segment, index) => {
		if (segment === "") {
			return;
		}
		spans.push({ bold: index % 2 === 1, text: segment });
	});
	return spans;
}

function isNotesV1Shape(entry: Record<string, unknown>): boolean {
	return "problem" in entry || "who" in entry || "instead" in entry || "key_frames" in entry;
}

function requireNoProcessWord(raw: unknown, path: string, unitId: string, blockName: string, errors: ValidationError[]): void {
	if (typeof raw === "string" && raw.includes(PROCESS_WORD_SOURCE_TEXT)) {
		errors.push({
			path,
			message: `유닛 ${unitId}의 ${blockName}에 "${PROCESS_WORD_SOURCE_TEXT}"이라는 말을 쓸 수 없습니다 — 작업 과정의 말이라 카드를 읽는 사람에게는 뜻이 없습니다. 코치가 한 말이면 "코치는", 장면이면 장면을 직접 쓰세요`,
		});
	}
}

function requireNoCaptionProcessPhrase(raw: unknown, path: string, unitId: string, errors: ValidationError[]): void {
	const phrase = typeof raw === "string" ? CAPTION_PROCESS_PHRASES.find((candidate) => raw.includes(candidate)) : undefined;
	if (phrase !== undefined) {
		errors.push({
			path,
			message: `${unitId}: 캡션에 작업 과정의 말 "${phrase}"을 쓸 수 없습니다 — 캡션은 프레임에 보이는 것만 쓰고, 사람이 안 보이면 "<이름>는 이 프레임에 보이지 않는다"로 밝힙니다`,
		});
	}
}

/** A caption that explains why the marker colour cannot point at someone — a work note the reader of the card has no use for. */
const MARKER_WORK_NOTE_PATTERNS: readonly RegExp[] = [/색으로\s*(사람을\s*)?가리키지\s*않/, /삼각형이\s*(함께|같이)\s*(있어|보여)/];

function requireNoMarkerWorkNote(raw: unknown, path: string, unitId: string, errors: ValidationError[]): void {
	if (typeof raw === "string" && MARKER_WORK_NOTE_PATTERNS.some((pattern) => pattern.test(raw))) {
		errors.push({
			path,
			message: `${unitId}: 캡션에 색 삼각형으로 가리킬 수 없는 이유를 쓸 수 없습니다 — 읽는 사람에게는 작업 메모입니다. 그 이유는 notes 유닛의 marker_unresolved_ko에 적고(카드에는 보이지 않는다), 캡션에는 프레임에 보이는 것만 쓰세요`,
		});
	}
}

function requireNoCommentSelfReference(raw: unknown, path: string, unitId: string, errors: ValidationError[]): void {
	if (typeof raw === "string" && COMMENT_SELF_REFERENCES.some((phrase) => raw.includes(phrase))) {
		errors.push({
			path,
			message: `${unitId}: 카드에 '댓글은 …' 꼴로 댓글 자체를 말하지 않는다 — 방향이 어긋나면 notes 유닛의 direction_check_ko에 한 문장으로 적는다`,
		});
	}
}

function checkNoteTextBlock(blockRaw: Record<string, unknown>, path: string, unitId: string, errors: ValidationError[]): void {
	const textPath = `${path}.text`;
	requireNoProcessWord(blockRaw.text, textPath, unitId, "text 블록", errors);
	requireNoCommentSelfReference(blockRaw.text, textPath, unitId, errors);
	requireTrimmedBoundedLength(
		blockRaw.text,
		TEXT_MIN_LENGTH,
		TEXT_MAX_LENGTH,
		textPath,
		errors,
		`text는 trim 후 ${TEXT_MIN_LENGTH}~${TEXT_MAX_LENGTH}자여야 합니다`,
	);
	requireNoNewline(blockRaw.text, textPath, errors, "text에는 개행 문자를 포함할 수 없습니다(블록=문단)");
	requireBalancedBold(blockRaw.text, textPath, errors);
}

function checkNoteUnit(
	entryRaw: unknown,
	unit: ValidatedUnit,
	candidates: readonly Candidate[],
	roster: Roster | null,
	path: string,
	errors: ValidationError[],
): void {
	if (!isRecord(entryRaw)) {
		errors.push({ path, message: "노트 항목은 객체여야 합니다" });
		return;
	}
	if (!("blocks" in entryRaw) && isNotesV1Shape(entryRaw)) {
		errors.push({ path, message: NOTES_V1_REJECTED_MESSAGE });
		return;
	}
	if (!Array.isArray(entryRaw.blocks)) {
		errors.push({ path: `${path}.blocks`, message: "blocks는 배열이어야 합니다" });
		return;
	}

	const blocks = entryRaw.blocks;
	if (blocks.length < BLOCKS_MIN || blocks.length > BLOCKS_MAX) {
		errors.push({ path: `${path}.blocks`, message: `blocks는 ${BLOCKS_MIN}~${BLOCKS_MAX}개여야 합니다` });
	}
	if (isRecord(blocks[0]) && blocks[0].type === "frame") {
		errors.push({ path: `${path}.blocks[0]`, message: `${unit.id}: 첫 블록은 본문(text)이어야 한다 — 카드는 할 행동을 담은 본문 문단을 사진보다 먼저 보인다` });
	}

	const seenCandidateIds = new Set<string>();
	let hasTextBlock = false;
	let frameCount = 0;
	let lastFrameT = -Infinity;
	const captions: string[] = [];
	const texts: string[] = [];

	blocks.forEach((blockRaw, index) => {
		const blockPath = `${path}.blocks[${index}]`;
		if (!isRecord(blockRaw)) {
			errors.push({ path: blockPath, message: "block 항목은 객체여야 합니다" });
			return;
		}

		if (blockRaw.type === "text") {
			hasTextBlock = true;
			checkNoteTextBlock(blockRaw, blockPath, unit.id, errors);
			if (typeof blockRaw.text === "string") texts.push(blockRaw.text);
			return;
		}

		if (blockRaw.type !== "frame") {
			errors.push({ path: `${blockPath}.type`, message: 'type은 "text" 또는 "frame"이어야 합니다' });
			return;
		}

		frameCount += 1;
		const candidateId = typeof blockRaw.candidate_id === "string" ? blockRaw.candidate_id : "";
		const candidatePath = `${blockPath}.candidate_id`;
		const candidate = candidates.find((c) => c.id === candidateId);
		if (candidate === undefined) {
			errors.push({ path: candidatePath, message: `존재하지 않는 후보입니다: ${candidateId}` });
		} else {
			if (candidate.video !== unit.video) {
				errors.push({ path: candidatePath, message: "unit과 다른 video의 후보입니다" });
			}
			if (
				candidate.t < unit.start - KEY_FRAME_TOLERANCE_SECONDS ||
				candidate.t > unit.end + KEY_FRAME_TOLERANCE_SECONDS
			) {
				errors.push({
					path: candidatePath,
					message: `허용 범위(unit ±${KEY_FRAME_TOLERANCE_SECONDS}초)를 벗어난 시각입니다: ${candidate.t}`,
				});
			}
			if (seenCandidateIds.has(candidateId)) {
				errors.push({ path: candidatePath, message: `unit 내에서 후보가 중복됩니다: ${candidateId}` });
			} else {
				seenCandidateIds.add(candidateId);
			}
			if (candidate.t < lastFrameT) {
				errors.push({ path: candidatePath, message: "frame은 블록 순서대로 시각이 비감소해야 합니다" });
			} else {
				lastFrameT = candidate.t;
			}
		}

		const captionPath = `${blockPath}.caption`;
		requireTrimmedBoundedLength(
			blockRaw.caption,
			FRAME_CAPTION_MIN_LENGTH,
			FRAME_CAPTION_MAX_LENGTH,
			captionPath,
			errors,
			`caption은 trim 후 ${FRAME_CAPTION_MIN_LENGTH}~${FRAME_CAPTION_MAX_LENGTH}자여야 합니다`,
		);
		requireNoNewline(blockRaw.caption, captionPath, errors, "caption에는 개행 문자를 포함할 수 없습니다");
		requireNoProcessWord(blockRaw.caption, captionPath, unit.id, "frame 캡션", errors);
		requireNoCaptionProcessPhrase(blockRaw.caption, captionPath, unit.id, errors);
		requireNoMarkerWorkNote(blockRaw.caption, captionPath, unit.id, errors);
		requireCaptionDiffersFromFaultScene(blockRaw.caption, entryRaw.fault_scene, captionPath, unit.id, errors);
		requireNoCommentSelfReference(blockRaw.caption, captionPath, unit.id, errors);
		if (blockRaw.focus_x !== undefined && !(isFiniteNumber(blockRaw.focus_x) && blockRaw.focus_x >= 0 && blockRaw.focus_x <= 1)) {
			errors.push({ path: `${blockPath}.focus_x`, message: "focus_x는 0 이상 1 이하의 숫자여야 합니다(프레임 왼쪽 끝 0, 오른쪽 끝 1)" });
		}
		if (typeof blockRaw.caption === "string") captions.push(blockRaw.caption);
		if (typeof blockRaw.caption === "string" && FRAME_CAPTION_CLOCK_PATTERN.test(blockRaw.caption)) {
			errors.push({
				path: captionPath,
				message:
					'caption은 시계·점수 표기(예 "34:12", "0:30 1-0")로 시작할 수 없습니다 — 카드가 캡션 바로 옆에 영상 시각 칩을 이미 보여 주므로 시각이 둘이면 독자가 헷갈립니다. 경기 시간은 "경기 34분"처럼 말로 쓰세요',
			});
		}
	});

	if (!hasTextBlock) {
		errors.push({ path: `${path}.blocks`, message: "text 블록이 최소 1개 이상 있어야 합니다" });
	}
	// A card without a captioned frame leaves the reader a bare wide shot with no pointer to the
	// player or the ball, so at least one frame is a structural requirement, not a warning.
	if (frameCount === 0) {
		errors.push({
			path: `${path}.blocks`,
			message: "frame 블록이 최소 1개 이상 있어야 합니다 — 지적한 장면의 프레임을 캡션과 함께 넣으세요(후보에 없으면 add-frame)",
		});
	}
	if (frameCount > MAX_FRAMES_PER_UNIT) {
		errors.push({
			path: `${path}.blocks`,
			message: `frame 블록은 unit당 최대 ${MAX_FRAMES_PER_UNIT}개까지 허용됩니다`,
		});
	}
	checkBoldInFirstParagraph(texts, unit.id, path, errors);
	const rangeScanned = candidates.some((candidate) => isRangeScanOfUnit(candidate, unit));
	checkTitleReceiversCaptioned(captions, unit, roster, rangeScanned, path, errors);
	checkPassCardNamesBall(captions, unit, roster, path, errors);
	checkMembersCaptioned(entryRaw.unidentified_member_ids, captions, unit, roster, path, errors);
	checkUnidentifiedRangeScanned(entryRaw.unidentified_member_ids, unit, rangeScanned, path, errors);
	checkLookAt(entryRaw.look_at, entryRaw.unidentified_member_ids, hasNotVisibleReceiver(captions, unit, roster), unit.id, path, errors);
	checkDirectionCheck(entryRaw.direction_check_ko, unit.id, path, errors);
	checkMarkerUnresolved(entryRaw.marker_unresolved_ko, entryRaw.unidentified_member_ids, unit.id, path, errors);
	checkFaultScene(entryRaw.fault_scene, entryRaw.direction_check_ko !== undefined, unit, path, errors);
	requireNoCommentSelfReference(entryRaw.fault_scene, `${path}.fault_scene`, unit.id, errors);
	requireNoCommentSelfReference(entryRaw.look_at, `${path}.look_at`, unit.id, errors);
}

/** The bold (the action to take) must open the card: a `**` in a later text block while the first text block has none means the reader meets the action only after the story. */
function checkBoldInFirstParagraph(texts: readonly string[], unitId: string, path: string, errors: ValidationError[]): void {
	if (texts.length > 1 && !texts[0].includes("**") && texts.slice(1).some((text) => text.includes("**"))) {
		errors.push({ path: `${path}.blocks`, message: `${unitId}: 볼드(할 행동)가 첫 문단에 없고 뒤 문단에만 있다 — 행위자와 교정 행동을 첫 문단에 쓴다` });
	}
}

/** A `scan-range` frame of the same video inside the window frame blocks may use (`unit.start - 5` .. `unit.end + 5`). */
export function isRangeScanOfUnit(candidate: Candidate, unit: ValidatedUnit): boolean {
	return (
		candidate.kind === "range" &&
		candidate.video === unit.video &&
		candidate.t >= unit.start - KEY_FRAME_TOLERANCE_SECONDS &&
		candidate.t <= unit.end + KEY_FRAME_TOLERANCE_SECONDS
	);
}

/** A caption that says the person is not in the frame ("우사는 이 프레임에 보이지 않는다", "우사는 이 프레임에서 이름표로 확인되지 않는다"). */
const CAPTION_NOT_VISIBLE = "보이지 않는다";
const CAPTION_NOT_VISIBLE_PHRASES = [CAPTION_NOT_VISIBLE, "확인되지 않는다", "알아볼 수 없다"] as const;
function saysNotVisible(caption: string): boolean {
	return CAPTION_NOT_VISIBLE_PHRASES.some((phrase) => caption.includes(phrase));
}

/** Roster members the unit's title sends the ball or the gaze to: name, alias, or gamertag directly followed by "에게" or " 쪽". */
function titleReceivers(unit: ValidatedUnit, roster: Roster | null): Member[] {
	const title = unit.title.toLowerCase();
	return (roster?.members ?? []).filter((member) => memberLabels(member).some((label) => title.includes(`${label.toLowerCase()}에게`) || title.includes(`${label.toLowerCase()} 쪽`)));
}

/** Whether some title receiver is named by captions that all say "보이지 않는다" — the card's frames do not show where the receiver is. */
function hasNotVisibleReceiver(captions: readonly string[], unit: ValidatedUnit, roster: Roster | null): boolean {
	return titleReceivers(unit, roster).some((member) => {
		const naming = captions.filter((caption) => mentionsMember(caption, member));
		return naming.length > 0 && naming.every(saysNotVisible);
	});
}

/**
 * A title segment that sends the ball or the gaze to a roster member ("게임메이커: 김철수에게 짧게 패스하기", "용딘: 우사 쪽 바라보기":
 * name, alias, or gamertag directly followed by "에게" or " 쪽") needs that receiver in at least one frame caption — the caption says
 * where they stand, or that the frame does not show them. Same name matching as `checkMembersCaptioned`. When every caption that names
 * the receiver says "보이지 않는다", the unit's window must also have been scanned with `scan-range` (a `range` candidate inside it),
 * else "not visible" was claimed after looking at one or two frames.
 */
function checkTitleReceiversCaptioned(captions: readonly string[], unit: ValidatedUnit, roster: Roster | null, rangeScanned: boolean, path: string, errors: ValidationError[]): void {
	for (const member of titleReceivers(unit, roster)) {
		const naming = captions.filter((caption) => mentionsMember(caption, member));
		if (naming.length === 0) {
			errors.push({
				path: `${path}.blocks`,
				message: `${unit.id}: 제목의 받는 사람 ${member.name}가 어느 캡션에도 없다 — 받는 사람 위치를 캡션에 쓰거나, 프레임에 안 보이면 '${member.name}는 이 프레임에 보이지 않는다'처럼 밝힌다`,
			});
		} else if (naming.every(saysNotVisible) && !rangeScanned) {
			errors.push({
				path: `${path}.blocks`,
				message: `${unit.id}: 받는 사람 ${member.name}를 사진에서 못 찾았다고 했지만 이 유닛 범위를 scan-range로 훑은 기록이 없다`,
			});
		}
	}
}

/** The word "공" (the ball) in a caption, with an optional particle — not 공격/공간/공중. */
const BALL_WORD_PATTERN = /(^|[\s(“‘"'])공(이|을|은|의|과|도|에|으로|만|까지)?(?=[\s,.)”’"']|$)/u;

/** A title segment that passes the ball: it says "패스" or sends the ball to a roster member ("<이름>에게"). */
function titlePassesBall(unit: ValidatedUnit, roster: Roster | null): boolean {
	const title = unit.title.toLowerCase();
	return title.includes("패스") || (roster?.members ?? []).some((member) => memberLabels(member).some((label) => title.includes(`${label.toLowerCase()}에게`)));
}

/** A pass card needs at least one frame caption that says where the ball is (the word "공"); a pass without the ball in view cannot be read. */
function checkPassCardNamesBall(captions: readonly string[], unit: ValidatedUnit, roster: Roster | null, path: string, errors: ValidationError[]): void {
	if (titlePassesBall(unit, roster) && !captions.some((caption) => BALL_WORD_PATTERN.test(caption))) {
		errors.push({
			path: `${path}.blocks`,
			message: `${unit.id}: 제목이 패스(또는 받는 사람)를 말하는데 어느 캡션에도 공이 없다 — 공이 어디 있는지 캡션에 '공'이라는 말로 쓴다(공이 안 보이면 그렇게 쓴다)`,
		});
	}
}

/** `unidentified_member_ids` says no frame of the unit's window shows the person — that claim needs the window scanned with `scan-range`. */
function checkUnidentifiedRangeScanned(raw: unknown, unit: ValidatedUnit, rangeScanned: boolean, path: string, errors: ValidationError[]): void {
	if (Array.isArray(raw) && raw.length > 0 && !rangeScanned) {
		errors.push({
			path: `${path}.unidentified_member_ids`,
			message: `${unit.id}: 고칠 사람을 사진에서 못 찾았다고 했지만 이 유닛 범위를 scan-range로 훑은 기록이 없다`,
		});
	}
}

/** A caption that repeats `fault_scene` word for word adds nothing under the title's scene line; the caption says what the frame shows more of. */
function requireCaptionDiffersFromFaultScene(caption: unknown, faultScene: unknown, path: string, unitId: string, errors: ValidationError[]): void {
	if (typeof caption === "string" && typeof faultScene === "string" && faultScene.trim() !== "" && caption.trim() === faultScene.trim()) {
		errors.push({ path, message: `${unitId}: 캡션이 fault_scene과 같다 — 캡션은 그 프레임에서 더 보이는 것을 쓴다` });
	}
}

/**
 * `fault_scene` is the one-line scene sentence under a fault card's title (1–120 chars, one line): required exactly
 * when the unit's title has a -ㅁ (fault) segment (`unitTitleHasFaultSegment`), an error otherwise. A unit with `direction_check_ko`
 * (`hasDirectionCheck`: the source's left/right and the frames disagree) cannot state the scene the source describes, so it may not
 * carry `fault_scene` and is exempt from the requirement.
 */
function checkFaultScene(raw: unknown, hasDirectionCheck: boolean, unit: ValidatedUnit, path: string, errors: ValidationError[]): void {
	const faultScenePath = `${path}.fault_scene`;
	if (!unitTitleHasFaultSegment(unit.title)) {
		if (raw !== undefined) {
			errors.push({ path: faultScenePath, message: `유닛 ${unit.id}: 제목에 -ㅁ 지적 조각이 없으면 fault_scene을 쓸 수 없습니다(삭제하세요)` });
		}
		return;
	}
	if (hasDirectionCheck) {
		if (raw !== undefined) {
			errors.push({ path: faultScenePath, message: `유닛 ${unit.id}: direction_check_ko가 있으면 fault_scene을 쓸 수 없습니다 — 원문 방향과 프레임이 어긋난 카드는 장면 줄 대신 방향 확인 줄을 보여 줍니다(fault_scene을 삭제하세요)` });
		}
		return;
	}
	if (raw === undefined) {
		errors.push({
			path: faultScenePath,
			message: `유닛 ${unit.id}: 제목에 -ㅁ 지적 조각이 있으면 fault_scene이 필요합니다 — 그 잘못이 프레임에서 어떻게 보였는지(누가 어디에 섰는지, 대형이 어떻게 갈렸는지) 한 문장으로 쓰세요`,
		});
		return;
	}
	requireTrimmedBoundedLength(raw, FAULT_SCENE_MIN_LENGTH, FAULT_SCENE_MAX_LENGTH, faultScenePath, errors, `fault_scene은 trim 후 ${FAULT_SCENE_MIN_LENGTH}~${FAULT_SCENE_MAX_LENGTH}자 문자열이어야 합니다`);
	requireNoNewline(raw, faultScenePath, errors, "fault_scene에는 개행 문자를 포함할 수 없습니다");
}

/**
 * `look_at` tells the reader where in the photos to look when the card's frames cannot show the person or place the title points at:
 * required (1–60 chars, one line) exactly when `unidentified_member_ids` is non-empty or a caption says the title's receiver is not
 * visible (`receiverNotVisible`), an error otherwise.
 */
function checkLookAt(raw: unknown, unidentifiedRaw: unknown, receiverNotVisible: boolean, unitId: string, path: string, errors: ValidationError[]): void {
	const lookAtPath = `${path}.look_at`;
	const hasUnidentified = Array.isArray(unidentifiedRaw) && unidentifiedRaw.length > 0;
	if (!hasUnidentified && !receiverNotVisible) {
		if (raw !== undefined) {
			errors.push({ path: lookAtPath, message: `유닛 ${unitId}: unidentified_member_ids가 비어 있고 받는 사람이 안 보인다는 캡션도 없으면 look_at을 쓸 수 없습니다(삭제하세요)` });
		}
		return;
	}
	if (raw === undefined) {
		errors.push({
			path: lookAtPath,
			message: hasUnidentified
				? `유닛 ${unitId}: unidentified_member_ids가 있으면 look_at이 필요합니다 — 사람을 못 알아볼 때 사진 어디를 보면 되는지 한 줄로 쓰세요(예 "화면 위쪽 마크 없는 RONALDO")`
				: `유닛 ${unitId}: 캡션이 받는 사람이 "${CAPTION_NOT_VISIBLE}"고 하면 look_at이 필요합니다 — 받는 사람이 안 보이는 카드에서 사진 어디를 보면 되는지 한 줄로 쓰세요(예 "화면 아래쪽 공을 받을 빈 공간")`,
		});
		return;
	}
	requireTrimmedBoundedLength(raw, LOOK_AT_MIN_LENGTH, LOOK_AT_MAX_LENGTH, lookAtPath, errors, `look_at은 trim 후 ${LOOK_AT_MIN_LENGTH}~${LOOK_AT_MAX_LENGTH}자 문자열이어야 합니다`);
	requireNoNewline(raw, lookAtPath, errors, "look_at에는 개행 문자를 포함할 수 없습니다");
	if (typeof raw === "string" && (raw.includes(":") || raw.includes(" / "))) {
		errors.push({ path: lookAtPath, message: `유닛 ${unitId}: look_at은 볼 곳 한 문장입니다 — 콜론(:)과 " / " 없이 쓰세요(여러 사람이면 한 문장으로 잇기)` });
	}
}

const MARKER_UNRESOLVED_MIN_LENGTH = 1;
const MARKER_UNRESOLVED_MAX_LENGTH = 80;

/** `marker_unresolved_ko` (optional): `{ <member_id>: reason }` with a 1–80 char one-line reason; each key is a member of the unit's `unidentified_member_ids`. */
function checkMarkerUnresolved(raw: unknown, unidentifiedRaw: unknown, unitId: string, path: string, errors: ValidationError[]): void {
	if (raw === undefined) {
		return;
	}
	const fieldPath = `${path}.marker_unresolved_ko`;
	if (!isRecord(raw)) {
		errors.push({ path: fieldPath, message: `유닛 ${unitId}: marker_unresolved_ko는 { <member_id>: 이유 } 객체여야 합니다` });
		return;
	}
	const unidentified = Array.isArray(unidentifiedRaw) ? unidentifiedRaw : [];
	for (const [memberId, reason] of Object.entries(raw)) {
		const reasonPath = `${fieldPath}.${memberId}`;
		if (!unidentified.includes(memberId)) {
			errors.push({ path: reasonPath, message: `유닛 ${unitId}: marker_unresolved_ko의 ${memberId}는 이 유닛의 unidentified_member_ids에 없는 사람입니다` });
		}
		requireTrimmedBoundedLength(reason, MARKER_UNRESOLVED_MIN_LENGTH, MARKER_UNRESOLVED_MAX_LENGTH, reasonPath, errors, `유닛 ${unitId}: marker_unresolved_ko의 이유는 trim 후 ${MARKER_UNRESOLVED_MIN_LENGTH}~${MARKER_UNRESOLVED_MAX_LENGTH}자 문자열이어야 합니다`);
		requireNoNewline(reason, reasonPath, errors, `유닛 ${unitId}: marker_unresolved_ko의 이유에는 개행 문자를 포함할 수 없습니다`);
	}
}

/** `direction_check_ko` (optional): one line (1–100 chars) that the source's left/right and the unit's frames disagree; no process word. */
function checkDirectionCheck(raw: unknown, unitId: string, path: string, errors: ValidationError[]): void {
	if (raw === undefined) {
		return;
	}
	const directionPath = `${path}.direction_check_ko`;
	requireTrimmedBoundedLength(raw, DIRECTION_CHECK_MIN_LENGTH, DIRECTION_CHECK_MAX_LENGTH, directionPath, errors, `유닛 ${unitId}: direction_check_ko는 trim 후 ${DIRECTION_CHECK_MIN_LENGTH}~${DIRECTION_CHECK_MAX_LENGTH}자 문자열이어야 합니다`);
	requireNoNewline(raw, directionPath, errors, `유닛 ${unitId}: direction_check_ko에는 개행 문자를 포함할 수 없습니다`);
	requireNoProcessWord(raw, directionPath, unitId, "direction_check_ko", errors);
}

/**
 * The card's photo must show the reader where each person told to change (`member_ids`) is: some frame
 * caption names them (roster name, alias, or gamertag), or `unidentified_member_ids` lists them — the
 * people no frame inside the unit window lets the writer identify. A listed id must be one of
 * `member_ids` and must not also be named by a caption.
 */
function checkMembersCaptioned(
	raw: unknown,
	captions: readonly string[],
	unit: ValidatedUnit,
	roster: Roster | null,
	path: string,
	errors: ValidationError[],
): void {
	const listPath = `${path}.unidentified_member_ids`;
	if (raw !== undefined && (!Array.isArray(raw) || !raw.every((id) => typeof id === "string"))) {
		errors.push({ path: listPath, message: "unidentified_member_ids는 member id 문자열 배열이어야 합니다" });
		return;
	}
	const unidentified: readonly string[] = raw ?? [];
	// A clause that names the person only to say the frame does not show them ("우사는 이 프레임에서 알아볼 수 없다") does not point at them.
	const captioned = (memberId: string): boolean => {
		const member = roster?.members.find((candidate) => candidate.id === memberId);
		return member !== undefined && captions.some((caption) => caption.split(/[,.—]/).some((clause) => mentionsMember(clause, member) && !saysNotVisible(clause)));
	};
	for (const memberId of unidentified) {
		if (!unit.member_ids.includes(memberId)) {
			errors.push({ path: listPath, message: `member_ids에 없는 id입니다: ${memberId}` });
		} else if (captioned(memberId)) {
			errors.push({ path: listPath, message: `캡션이 이미 이름을 짚은 사람입니다(목록에서 빼세요): ${memberId}` });
		}
	}
	for (const memberId of unit.member_ids) {
		if (!captioned(memberId) && !unidentified.includes(memberId)) {
			errors.push({
				path: `${path}.blocks`,
				message: `고칠 사람 ${memberId}의 이름(명단 이름·별칭·게이머태그)을 짚은 캡션이 없습니다 — 그 사람의 이름표가 보이는 프레임(없으면 유닛 시간 범위 안에서 add-frame)을 넣고 캡션에 이름과 화면 위치를 쓰세요. 범위 안 어느 프레임에서도 식별할 수 없을 때만 unidentified_member_ids에 넣으세요`,
			});
		}
	}
}

const MARKER_COLOR_PATTERN = /^[가-힣]{1,10}$/u;

/** Whether `candidate` lies in match `matchNumber`: its video has units of that match and its time is inside their span (`KEY_FRAME_TOLERANCE_SECONDS` each side). */
function candidateInMatch(candidate: Candidate, matchNumber: number, validated: ValidatedPlan): boolean {
	const matchUnits = validated.units.filter((unit) => unit.match_id === `m${matchNumber}` && unit.video === candidate.video);
	return (
		matchUnits.length > 0 &&
		candidate.t >= Math.min(...matchUnits.map((unit) => unit.start)) - KEY_FRAME_TOLERANCE_SECONDS &&
		candidate.t <= Math.max(...matchUnits.map((unit) => unit.end)) + KEY_FRAME_TOLERANCE_SECONDS
	);
}

/**
 * notes `marker_colors` (optional): per match, the colour of the triangle above each human-controlled player, so captions can point at a
 * person by colour in frames without a name tag. Each entry is `{ match, member_id, color, evidence_candidate_id }`: `match` the 1-based
 * match number, `member_id` a roster id, `color` a 1–10 syllable Korean colour word, `evidence_candidate_id` a candidate whose video and
 * time lie inside that match (its units' time span per video, `KEY_FRAME_TOLERANCE_SECONDS` each side). Within one match no colour and no
 * member repeats. The card does not render it; it is the evidence behind the captions' colour pointers.
 */
function checkMarkerColors(raw: unknown, validated: ValidatedPlan, candidates: readonly Candidate[], roster: Roster | null, errors: ValidationError[]): void {
	if (raw === undefined) return;
	if (!Array.isArray(raw)) {
		errors.push({ path: "marker_colors", message: "marker_colors는 배열이어야 합니다 — 각 항목은 { match, member_id, color, evidence_candidate_id }" });
		return;
	}
	if (roster === null && raw.length > 0) {
		errors.push({ path: "marker_colors", message: "명단이 없는(disabled) 모드에서는 marker_colors를 쓸 수 없습니다" });
		return;
	}
	const seenColors = new Set<string>();
	const seenMembers = new Set<string>();
	raw.forEach((entry, index) => {
		const path = `marker_colors[${index}]`;
		if (!isRecord(entry)) {
			errors.push({ path, message: "marker_colors 항목은 { match, member_id, color, evidence_candidate_id } 객체여야 합니다" });
			return;
		}
		const matchNumber = entry.match;
		const matchOk = typeof matchNumber === "number" && Number.isInteger(matchNumber) && matchNumber >= 1 && matchNumber <= validated.matches.length;
		if (!matchOk) {
			errors.push({ path: `${path}.match`, message: `match는 1 이상 ${validated.matches.length} 이하의 경기 번호(정수)여야 합니다` });
		}
		const memberId = typeof entry.member_id === "string" ? entry.member_id : "";
		if (!roster?.members.some((member) => member.id === memberId)) {
			errors.push({ path: `${path}.member_id`, message: `명단에 없는 member id입니다: ${describeUnknown(entry.member_id)}` });
		}
		const color = typeof entry.color === "string" ? entry.color : "";
		if (!MARKER_COLOR_PATTERN.test(color)) {
			errors.push({ path: `${path}.color`, message: `color는 한글 색 이름 1~10자여야 합니다(예 "분홍"): ${describeUnknown(entry.color)}` });
		}
		const candidateId = typeof entry.evidence_candidate_id === "string" ? entry.evidence_candidate_id : "";
		const candidate = candidates.find((c) => c.id === candidateId);
		if (candidate === undefined) {
			errors.push({ path: `${path}.evidence_candidate_id`, message: `존재하지 않는 후보입니다: ${describeUnknown(entry.evidence_candidate_id)}` });
		} else if (matchOk && !candidateInMatch(candidate, matchNumber, validated)) {
			errors.push({ path: `${path}.evidence_candidate_id`, message: `증거 후보 ${candidateId}가 ${matchNumber}경기의 시간 범위 밖이거나 다른 영상입니다` });
		}
		if (matchOk && MARKER_COLOR_PATTERN.test(color)) {
			if (seenColors.has(`${matchNumber}\u0000${color}`)) {
				errors.push({ path: `${path}.color`, message: `${matchNumber}경기에서 색이 겹칩니다: ${color} — 한 경기 안에서 색 하나는 한 사람입니다` });
			}
			seenColors.add(`${matchNumber}\u0000${color}`);
		}
		if (matchOk && memberId !== "") {
			if (seenMembers.has(`${matchNumber}\u0000${memberId}`)) {
				errors.push({ path: `${path}.member_id`, message: `${matchNumber}경기에서 같은 사람이 두 번 나옵니다: ${memberId}` });
			}
			seenMembers.add(`${matchNumber}\u0000${memberId}`);
		}
	});
}

/** The frame captions of a raw notes unit; non-string captions and malformed blocks are skipped (they are errors elsewhere). */
export function rawFrameCaptions(entryRaw: unknown): string[] {
	const blocks = isRecord(entryRaw) && Array.isArray(entryRaw.blocks) ? entryRaw.blocks : [];
	return blocks.flatMap((block) => (isRecord(block) && block.type === "frame" && typeof block.caption === "string" ? [block.caption] : []));
}

/** A caption that identifies the person by the name tag above their head, as opposed to one that says the tag did not identify them. */
const NAME_TAG_WORD = "이름표";

/** The shape of the marker over a human-controlled player's head; a caption that looks for the colour says "<색> 삼각형". */
const MARKER_SHAPE_WORD = "삼각형";

/**
 * A unit lists member M in `unidentified_member_ids` ("no frame of this unit's window shows M") although another unit of the same match
 * identified M by name tag in a caption: the person was found in that match, so the colour of the triangle over M's head in that frame
 * is the way to find M in this unit's frames. Error unless `marker_colors` holds an entry for {match, M}, i.e. the colour was tried.
 * A caption that says "보이지 않는다"/"확인되지 않는다" does not identify anyone and is not a name-tag identification.
 */
function checkMarkerColorsTried(unitsRaw: Record<string, unknown>, markerColorsRaw: unknown, validated: ValidatedPlan, roster: Roster | null, errors: ValidationError[]): void {
	if (roster === null) return;
	const markers = Array.isArray(markerColorsRaw) ? markerColorsRaw.filter(isRecord) : [];
	for (const unit of validated.units) {
		const entry = unitsRaw[unit.id];
		const ids = isRecord(entry) && Array.isArray(entry.unidentified_member_ids) ? entry.unidentified_member_ids : [];
		for (const member of roster.members.filter((candidate) => ids.includes(candidate.id))) {
			if (markers.some((marker) => `m${String(marker.match)}` === unit.match_id && marker.member_id === member.id)) continue;
			const namingUnit = validated.units.find(
				(other) =>
					other.id !== unit.id &&
					other.match_id === unit.match_id &&
					rawFrameCaptions(unitsRaw[other.id]).some((caption) => mentionsMember(caption, member) && caption.includes(NAME_TAG_WORD) && !saysNotVisible(caption)),
			);
			if (namingUnit !== undefined) {
				errors.push({
					path: `units.${unit.id}.unidentified_member_ids`,
					message: `${unit.id}: ${member.name}는 같은 경기 ${namingUnit.id} 캡션에서 이름표로 짚혔다 — 그 프레임에서 머리 위 색 삼각형을 marker_colors에 적고, 이 유닛 프레임에서 그 색으로 찾아본다`,
				});
			}
		}
	}
}

/**
 * A unit lists member M in `unidentified_member_ids` while `marker_colors` records M's triangle colour C for that unit's match: the colour
 * was found elsewhere, so this unit's frames must be searched for it. Either some caption of the unit names "C 삼각형" (pointing at M by
 * colour), or the unit's `marker_unresolved_ko[M]` says why it could not (a note the card does not render).
 */
function checkMarkerColorsLooked(unitsRaw: Record<string, unknown>, markerColorsRaw: unknown, validated: ValidatedPlan, roster: Roster | null, errors: ValidationError[]): void {
	if (roster === null) return;
	const markers = Array.isArray(markerColorsRaw) ? markerColorsRaw.filter(isRecord) : [];
	for (const unit of validated.units) {
		const entry = unitsRaw[unit.id];
		const ids = isRecord(entry) && Array.isArray(entry.unidentified_member_ids) ? entry.unidentified_member_ids : [];
		const unresolved = isRecord(entry) && isRecord(entry.marker_unresolved_ko) ? entry.marker_unresolved_ko : {};
		const captions = rawFrameCaptions(entry);
		for (const member of roster.members.filter((candidate) => ids.includes(candidate.id))) {
			if (Object.hasOwn(unresolved, member.id)) continue;
			for (const marker of markers.filter((m) => `m${String(m.match)}` === unit.match_id && m.member_id === member.id)) {
				const color = typeof marker.color === "string" ? marker.color : "";
				if (color === "" || captions.some((caption) => caption.includes(color) && caption.includes(MARKER_SHAPE_WORD))) continue;
				errors.push({
					path: `units.${unit.id}.unidentified_member_ids`,
					message: `${unit.id}: ${member.name}의 색(${color} ${MARKER_SHAPE_WORD})이 marker_colors에 있다 — 이 유닛 프레임에서 그 색으로 짚는 캡션을 쓰거나, 짚지 못한 이유를 notes 유닛의 marker_unresolved_ko에 적는다(카드에는 보이지 않는다)`,
				});
			}
		}
	}
}

const UNMATCHED_TAG_MIN_LENGTH = 1;
const UNMATCHED_TAG_MAX_LENGTH = 30;
/** A caption's "<TAG> 이름표": TAG is a Latin/digit/_- token directly before the word 이름표 (one optional space between). */
const NAME_TAG_MENTION_PATTERN = /([A-Za-z0-9_-]+)\s?이름표/g;
/** The word that marks the other team in a caption; a name tag or colour mentioned after it in the same comma clause belongs to an opponent. */
const OPPONENT_WORD = "상대";

/** Whether a comma-separated clause of `text` says "상대" before position `index`: the mention at `index` is then about the other team. */
function opponentBefore(text: string, index: number): boolean {
	const start = Math.max(text.lastIndexOf(",", index - 1), text.lastIndexOf("，", index - 1)) + 1;
	return text.slice(start, index).includes(OPPONENT_WORD);
}

/**
 * Whether a name tag is the member's: it holds the member's name/alias/gamertag (`mentionsMember`; a club prefix/suffix like "CEF_" rides along),
 * or a Latin run of it typed on a Korean keyboard reads as one of those labels ("CEF_ghdrlfehd313" → 홍길동).
 */
function nameTagIsMember(tag: string, member: Member): boolean {
	return mentionsMember(tag, member) || dubeolsikReading(tag).some((reading) => memberLabels(member).includes(reading));
}

/**
 * Whether the name tag at `tagIndex` of `caption` belongs to a roster member: the tag itself is the member's
 * (`nameTagIsMember`), or the tag sits in a parenthetical right after a member's label ("동그리(TOONG 이름표, …)": the tag is a shortened in-game name).
 */
function nameTagBelongsToRoster(tag: string, caption: string, tagIndex: number, roster: Roster): boolean {
	if (roster.members.some((member) => nameTagIsMember(tag, member))) return true;
	const open = caption.lastIndexOf("(", tagIndex);
	if (open < 0 || caption.slice(open, tagIndex).includes(")")) return false;
	const before = caption.slice(0, open).toLowerCase();
	return roster.members.some((member) => memberLabels(member).some((label) => before.endsWith(label.toLowerCase())));
}

/**
 * notes `unmatched_name_tags` (optional): per match, a name tag seen above a player that is in no roster member's name/alias/gamertag — the
 * person's tag cannot be read as a roster name, so the card's legend says so instead of leaving the reader to guess. Each entry is
 * `{ match, tag, color?, evidence_candidate_id }`: `tag` 1–30 characters as seen, `color` the marker colour seen with it (1–10 syllable Korean
 * colour word, not the colour of a `marker_colors` entry of the same match), `evidence_candidate_id` a candidate of that match's video and time
 * range where tag and colour show together. A tag that DOES resolve to the roster is an error; so is a tag listed twice in one match.
 *
 * A frame caption that writes "<TAG> 이름표" for a TAG that resolves to no roster member (see `nameTagBelongsToRoster`) must have a matching
 * entry for that unit's match. A tag written after "상대" in the same comma clause is an opponent's and is not checked.
 */
function checkUnmatchedNameTags(unitsRaw: Record<string, unknown>, raw: unknown, markerColorsRaw: unknown, validated: ValidatedPlan, candidates: readonly Candidate[], roster: Roster | null, errors: ValidationError[]): void {
	const listed = new Set<string>();
	if (raw !== undefined) {
		if (!Array.isArray(raw)) {
			errors.push({ path: "unmatched_name_tags", message: "unmatched_name_tags는 배열이어야 합니다 — 각 항목은 { match, tag, color?, evidence_candidate_id }" });
			return;
		}
		if (roster === null && raw.length > 0) {
			errors.push({ path: "unmatched_name_tags", message: "명단이 없는(disabled) 모드에서는 unmatched_name_tags를 쓸 수 없습니다" });
			return;
		}
		const markerColorKeys = new Set(Array.isArray(markerColorsRaw) ? markerColorsRaw.filter(isRecord).map((marker) => `${String(marker.match)}\u0000${String(marker.color)}`) : []);
		raw.forEach((entry, index) => {
			const path = `unmatched_name_tags[${index}]`;
			if (!isRecord(entry)) {
				errors.push({ path, message: "unmatched_name_tags 항목은 { match, tag, color?, evidence_candidate_id } 객체여야 합니다" });
				return;
			}
			const matchNumber = entry.match;
			const matchOk = typeof matchNumber === "number" && Number.isInteger(matchNumber) && matchNumber >= 1 && matchNumber <= validated.matches.length;
			if (!matchOk) {
				errors.push({ path: `${path}.match`, message: `match는 1 이상 ${validated.matches.length} 이하의 경기 번호(정수)여야 합니다` });
			}
			const tag = typeof entry.tag === "string" ? entry.tag.trim() : "";
			if (tag.length < UNMATCHED_TAG_MIN_LENGTH || tag.length > UNMATCHED_TAG_MAX_LENGTH || /[\r\n]/.test(tag)) {
				errors.push({ path: `${path}.tag`, message: `tag는 화면에 보이는 이름표 ${UNMATCHED_TAG_MIN_LENGTH}~${UNMATCHED_TAG_MAX_LENGTH}자(한 줄)여야 합니다: ${describeUnknown(entry.tag)}` });
			} else if (roster?.members.some((member) => nameTagIsMember(tag, member))) {
				errors.push({ path: `${path}.tag`, message: `이름표 ${tag}는 명단 멤버의 이름·별칭·게이머태그와 같다 — unmatched_name_tags가 아니라 그 멤버의 marker_colors로 적는다` });
			} else if (matchOk) {
				if (listed.has(`${matchNumber}\u0000${tag.toLowerCase()}`)) {
					errors.push({ path: `${path}.tag`, message: `${matchNumber}경기에서 같은 이름표가 두 번 나옵니다: ${tag}` });
				}
				listed.add(`${matchNumber}\u0000${tag.toLowerCase()}`);
			}
			if (entry.color !== undefined) {
				if (typeof entry.color !== "string" || !MARKER_COLOR_PATTERN.test(entry.color)) {
					errors.push({ path: `${path}.color`, message: `color는 한글 색 이름 1~10자여야 합니다(예 "자홍"): ${describeUnknown(entry.color)}` });
				} else if (matchOk && markerColorKeys.has(`${matchNumber}\u0000${entry.color}`)) {
					errors.push({ path: `${path}.color`, message: `${matchNumber}경기에서 색이 겹칩니다: ${entry.color} — marker_colors에 이미 있는 색입니다` });
				}
			}
			const candidateId = typeof entry.evidence_candidate_id === "string" ? entry.evidence_candidate_id : "";
			const candidate = candidates.find((c) => c.id === candidateId);
			if (candidate === undefined) {
				errors.push({ path: `${path}.evidence_candidate_id`, message: `존재하지 않는 후보입니다: ${describeUnknown(entry.evidence_candidate_id)}` });
			} else if (matchOk && !candidateInMatch(candidate, matchNumber, validated)) {
				errors.push({ path: `${path}.evidence_candidate_id`, message: `증거 후보 ${candidateId}가 ${matchNumber}경기의 시간 범위 밖이거나 다른 영상입니다` });
			}
		});
	}
	if (roster === null) return;
	for (const unit of validated.units) {
		const matchNumber = unit.match_id.slice(1);
		for (const caption of rawFrameCaptions(unitsRaw[unit.id])) {
			for (const found of caption.matchAll(NAME_TAG_MENTION_PATTERN)) {
				const tag = found[1];
				if (opponentBefore(caption, found.index)) continue;
				if (nameTagBelongsToRoster(tag, caption, found.index, roster) || listed.has(`${matchNumber}\u0000${tag.toLowerCase()}`)) continue;
				errors.push({
					path: "unmatched_name_tags",
					message: `${unit.id}: ${tag} 이름표는 명단 멤버의 이름·별칭·게이머태그가 아니다 — unmatched_name_tags에 { match: ${matchNumber}, tag: "${tag}", color?, evidence_candidate_id }로 기록한다`,
				});
			}
		}
	}
}

/** The text fields of a unit where a reader meets a colour pointer: frame captions, `fault_scene`, `look_at`, `direction_check_ko`. */
function rawColourPointerTexts(entryRaw: unknown): string[] {
	const fields = isRecord(entryRaw) ? [entryRaw.fault_scene, entryRaw.look_at, entryRaw.direction_check_ko] : [];
	return [...rawFrameCaptions(entryRaw), ...fields.filter((value): value is string => typeof value === "string")];
}

/** "<색> 삼각형": a Hangul colour word, an optional space, then the marker shape word. */
const COLOUR_TRIANGLE_PATTERN = new RegExp(`([가-힣]{1,10})\\s?${MARKER_SHAPE_WORD}`, "gu");

/**
 * A "<색> 삼각형" written in a unit's captions, `fault_scene`, `look_at` or `direction_check_ko` must name a colour of that match's legend:
 * a `marker_colors` colour or an `unmatched_name_tags` colour of the match. The card's legend lists only those, so another colour points
 * at nobody the reader can look up. A mention written after "상대" in the same comma clause is about an opponent and is not checked.
 */
function checkColourMentionsInLegend(unitsRaw: Record<string, unknown>, markerColorsRaw: unknown, unmatchedRaw: unknown, validated: ValidatedPlan, errors: ValidationError[]): void {
	const legend = new Set<string>();
	for (const entry of [...(Array.isArray(markerColorsRaw) ? markerColorsRaw : []), ...(Array.isArray(unmatchedRaw) ? unmatchedRaw : [])]) {
		if (isRecord(entry) && typeof entry.color === "string") legend.add(`m${String(entry.match)}\u0000${entry.color}`);
	}
	for (const unit of validated.units) {
		const reported = new Set<string>();
		for (const text of rawColourPointerTexts(unitsRaw[unit.id])) {
			for (const found of text.matchAll(COLOUR_TRIANGLE_PATTERN)) {
				const color = found[1];
				if (legend.has(`${unit.match_id}\u0000${color}`) || reported.has(color) || opponentBefore(text, found.index)) continue;
				reported.add(color);
				errors.push({
					path: `units.${unit.id}`,
					message: `${unit.id}: ${color} ${MARKER_SHAPE_WORD}은 ${unit.match_id.slice(1)}경기 범례에 없다 — marker_colors/unmatched_name_tags에 기록하거나 위치로만 쓴다`,
				});
			}
		}
	}
}

/**
 * Validates notes.json v2 against `validated` (the plan's validated units)
 * and `candidates` (candidates.json): the note key set must equal the unit id
 * set exactly, each unit's `blocks` has 1–20 entries with at least one `text`
 * block, a `text` block is 1–800 characters after trim with no newlines and
 * balanced non-empty `**bold**` markers, and a `frame` block (at most 6 per
 * unit, no duplicate `candidate_id`, `t` non-decreasing in block order)
 * references a same-video candidate within `[unit.start-5, unit.end+5]` and
 * has a 1–120 character `caption` after trim with no newlines, and every
 * `member_ids` person is named by some caption or listed in the unit's
 * `unidentified_member_ids` (see `checkMembersCaptioned`). notes v1
 * (`problem`/`who`/`instead`/`key_frames`) is rejected explicitly.
 */
export function checkNotes(
	notes: unknown,
	validated: ValidatedPlan,
	candidates: readonly Candidate[],
	roster: Roster | null,
): ErrorsResult {
	const errors: ValidationError[] = [];
	if (!isRecord(notes)) {
		errors.push({ path: "", message: "notes.json은 객체여야 합니다" });
		return { errors };
	}

	if (notes.version === 1) {
		errors.push({ path: "version", message: NOTES_V1_REJECTED_MESSAGE });
		return { errors };
	}
	if (notes.version !== 2) {
		errors.push({ path: "version", message: "version은 2여야 합니다" });
	}

	if (!isRecord(notes.units)) {
		errors.push({ path: "units", message: "units는 객체여야 합니다" });
		return { errors };
	}
	const unitsRaw = notes.units;

	const unitById = new Map<string, ValidatedUnit>();
	for (const unit of validated.units) {
		unitById.set(unit.id, unit);
	}
	const actualIds = new Set(Object.keys(unitsRaw));

	for (const id of unitById.keys()) {
		if (!actualIds.has(id)) {
			errors.push({ path: `units.${id}`, message: "검증된 unit에 대응하는 노트가 없습니다" });
		}
	}

	for (const id of actualIds) {
		const unit = unitById.get(id);
		if (unit === undefined) {
			errors.push({ path: `units.${id}`, message: "검증된 plan에 없는 unit id입니다" });
			continue;
		}
		checkNoteUnit(unitsRaw[id], unit, candidates, roster, `units.${id}`, errors);
	}
	checkMarkerColors(notes.marker_colors, validated, candidates, roster, errors);
	checkMarkerColorsTried(unitsRaw, notes.marker_colors, validated, roster, errors);
	checkMarkerColorsLooked(unitsRaw, notes.marker_colors, validated, roster, errors);
	checkUnmatchedNameTags(unitsRaw, notes.unmatched_name_tags, notes.marker_colors, validated, candidates, roster, errors);
	checkColourMentionsInLegend(unitsRaw, notes.marker_colors, notes.unmatched_name_tags, validated, errors);

	return { errors };
}

/** A frame caption that names a side of the screen ("화면 왼쪽", "오른쪽 끝"); lazy: the short list the reviewers hit, extend with real captions. */
const SCREEN_SIDE_PATTERN = /화면\s*(?:왼쪽|오른쪽|좌측|우측)|(?:왼쪽|오른쪽)\s*끝/;

/** Jongseong index of ㅆ in a composed Hangul syllable: `(code - 0xAC00) % 28`. */
const SSANG_SIOS_JONGSEONG = 20;

/** True when a bold span ends in a past-tense form: the last Hangul syllable before an optional final 다/고 has the jongseong ㅆ (했다, 붙었다, 놓쳤고) and is not the present-tense 있 ("가까이 있고"). */
function endsInPastTense(span: string): boolean {
	const trimmed = span.trim();
	const stem = trimmed.endsWith("다") || trimmed.endsWith("고") ? trimmed.slice(0, -1) : trimmed;
	const code = stem.codePointAt(stem.length - 1) ?? 0;
	return code !== "있".codePointAt(0) && code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === SSANG_SIOS_JONGSEONG;
}

/** One `unmatched_name_tags` entry of notes.json. */
export type UnmatchedNameTag = NonNullable<NotesV2["unmatched_name_tags"]>[number];

/** Korean 2-set (두벌식) keyboard: the jamo each Latin key types. Shift only changes Q W E R T O P; every other capital types its lowercase jamo. */
const DUBEOLSIK_KEYS: Readonly<Record<string, string>> = {
	q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ", y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", p: "ㅔ",
	a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ", h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
	z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ",
	Q: "ㅃ", W: "ㅉ", E: "ㄸ", R: "ㄲ", T: "ㅆ", O: "ㅒ", P: "ㅖ",
};
const HANGUL_INITIALS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const HANGUL_MEDIALS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
/** Index 0 is "no final"; the rest follow the Unicode Hangul syllable order. */
const HANGUL_FINALS = ["", ..."ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];
const COMPOUND_VOWELS: Readonly<Record<string, string>> = { ㅗㅏ: "ㅘ", ㅗㅐ: "ㅙ", ㅗㅣ: "ㅚ", ㅜㅓ: "ㅝ", ㅜㅔ: "ㅞ", ㅜㅣ: "ㅟ", ㅡㅣ: "ㅢ" };
const COMPOUND_FINALS: Readonly<Record<string, string>> = {
	ㄱㅅ: "ㄳ", ㄴㅈ: "ㄵ", ㄴㅎ: "ㄶ", ㄹㄱ: "ㄺ", ㄹㅁ: "ㄻ", ㄹㅂ: "ㄼ", ㄹㅅ: "ㄽ", ㄹㅌ: "ㄾ", ㄹㅍ: "ㄿ", ㄹㅎ: "ㅀ", ㅂㅅ: "ㅄ",
};

const isHangulVowel = (jamo: string | undefined): boolean => jamo !== undefined && HANGUL_MEDIALS.includes(jamo);

/** Composes jamo into syllables the way the 2-set IME does; null when a lone jamo is left over. */
function composeHangul(jamo: readonly string[]): string | null {
	let out = "";
	let at = 0;
	while (at < jamo.length) {
		const initial = HANGUL_INITIALS.indexOf(jamo[at]);
		if (initial < 0 || !isHangulVowel(jamo[at + 1])) return null;
		let medial = jamo[at + 1];
		at += 2;
		if (isHangulVowel(jamo[at]) && COMPOUND_VOWELS[medial + jamo[at]] !== undefined) {
			medial = COMPOUND_VOWELS[medial + jamo[at]];
			at += 1;
		}
		let final = "";
		if (at < jamo.length && !isHangulVowel(jamo[at]) && !isHangulVowel(jamo[at + 1])) {
			// A lone consonant before a non-vowel is a final; two may form a compound final unless a vowel follows the second.
			const pair = COMPOUND_FINALS[jamo[at] + (jamo[at + 1] ?? "")];
			if (pair !== undefined && !isHangulVowel(jamo[at + 2])) {
				final = pair;
				at += 2;
			} else {
				final = jamo[at];
				at += 1;
			}
		}
		const finalIndex = HANGUL_FINALS.indexOf(final);
		if (finalIndex < 0) return null;
		out += String.fromCharCode(0xac00 + (initial * 21 + HANGUL_MEDIALS.indexOf(medial)) * 28 + finalIndex);
	}
	return out;
}

/**
 * The Hangul a Latin text reads as when typed on a Korean 2-set keyboard with the IME off ("dnjswo" → "원재"): each run of ASCII
 * letters is mapped key by key and composed; only runs that compose entirely into complete syllables, at least two, are returned.
 */
export function dubeolsikReading(text: string): string[] {
	return (text.match(/[A-Za-z]+/g) ?? []).flatMap((run) => {
		const composed = composeHangul([...run].map((letter) => DUBEOLSIK_KEYS[letter] ?? DUBEOLSIK_KEYS[letter.toLowerCase()]));
		return composed !== null && composed.length >= 2 ? [composed] : [];
	});
}

/** Choseong (initial consonant) index 0..18 of a composed Hangul syllable, or `null` for any other character. */
function choseongIndex(char: string): number | null {
	const code = char.charCodeAt(0) - 0xac00;
	return char.length === 1 && code >= 0 && code <= 11171 ? Math.floor(code / 588) : null;
}

/** Whether two Hangul words have the same syllable count (>= 2), differ in exactly one syllable, and those two syllables share the choseong. */
function oneSyllableApart(a: string, b: string): boolean {
	const left = [...a];
	const right = [...b];
	if (left.length < 2 || left.length !== right.length) return false;
	const differing = left.map((char, index) => index).filter((index) => left[index] !== right[index]);
	if (differing.length !== 1) return false;
	const [index] = differing;
	const leftInitial = choseongIndex(left[index]);
	return leftInitial !== null && leftInitial === choseongIndex(right[index]);
}

/** Names joined by "·" with the particle 과/와 that fits the last name's final consonant ("원전" → "원전과", "윈재" → "윈재와"). */
export function joinWithWaGwa(names: readonly string[]): string {
	const last = names[names.length - 1]?.slice(-1) ?? "";
	return `${names.join("·")}${(last.charCodeAt(0) - 0xac00) % 28 !== 0 ? "과" : "와"}`;
}

/**
 * Roster member names a name tag might be, in roster order: some Korean-keyboard reading of the tag (`dubeolsikReading`)
 * is not a roster name/alias but is one syllable apart from it (`oneSyllableApart`: "원재" vs "원전"). Never an assignment —
 * an exact reading match is `nameTagIsMember`'s job, and this only hints at a near miss.
 */
export function closeRosterNames(tag: string, roster: Roster | null): string[] {
	const readings = dubeolsikReading(tag);
	return (roster?.members ?? [])
		.filter((member) => readings.some((reading) => [member.name, ...member.aliases].some((label) => oneSyllableApart(reading, label.trim()))))
		.map((member) => member.name);
}

/**
 * Non-blocking notes warnings: a name tag that matches no roster member but reads as Hangul on a Korean keyboard
 * (a player typed their name with the IME off): the writer may call that player by the reading. One line per distinct tag.
 * When the reading is one syllable off a roster name (`closeRosterNames`) the line also names that member as a possible match.
 */
export function unmatchedTagReadingWarnings(tags: readonly UnmatchedNameTag[], roster: Roster | null): string[] {
	return [...new Set(tags.map((entry) => entry.tag))].flatMap((tag) => {
		const readings = dubeolsikReading(tag);
		if (readings.length === 0) return [];
		const near = closeRosterNames(tag, roster);
		const nearHint = near.length === 0 ? "" : ` — 명단의 ${joinWithWaGwa(near)} 같은 사람일 수 있다: 같은 사람이면 그 팀원으로 쓰고, 모르면 그대로 둔다`;
		return [`fc-feedback: 경고 이름표 ${tag}는 한글 자판으로 "${readings.join(", ")}"로 읽힌다 — 명단에 없는 사람이면 본문·캡션에서 "${readings[0]}(${tag} 이름표)"처럼 그 이름으로 부른다${nearHint}`];
	});
}

/**
 * Non-blocking content-quality warnings for a structurally valid notes.json
 * v2 (`checkNotes` must have already passed): a unit whose text blocks carry
 * no `**bold**` pair (a source with only fault/state/result legitimately has none; a source that asks for an
 * action should bold it in the first paragraph; a speech-only span may belong merged into a neighboring unit).
 * A unit with no `frame` block is a `checkNotes` error, not a warning.
 * Also: a bold span that ends in a past-tense form (bold marks only the action the source asks for), a
 * frame caption that names a side of the screen while the block has no `focus_x`, and a roster member named in the
 * unit's text blocks (same name/alias/gamertag match as `named_member_ids`) whom no frame caption names and
 * `unidentified_member_ids` does not list.
 */
export function noteWarnings(notes: NotesV2, roster: Roster | null): string[] {
	const warnings: string[] = [];
	for (const [unitId, unit] of Object.entries(notes.units)) {
		for (const block of unit.blocks) {
			if (block.type === "frame" && block.focus_x === undefined && SCREEN_SIDE_PATTERN.test(block.caption)) {
				warnings.push(
					`fc-feedback: 경고 ${unitId}: 프레임 ${block.candidate_id}의 캡션이 화면 왼쪽/오른쪽을 가리키는데 focus_x가 없음 — 초광각 프레임은 가운데에서 시작하므로 가리키는 대상의 가로 위치(0 왼쪽 끝 ~ 1 오른쪽 끝)를 focus_x로 적는다`,
				);
			}
		}
		const text = unit.blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
		const captions = unit.blocks.flatMap((block) => (block.type === "frame" ? [block.caption] : []));
		for (const member of roster?.members ?? []) {
			if (mentionsMember(text, member) && !captions.some((caption) => mentionsMember(caption, member)) && !(unit.unidentified_member_ids ?? []).includes(member.id)) {
				warnings.push(
					`fc-feedback: 경고 ${unitId}: 본문에 나온 ${member.name}이(가) 어느 캡션에도 없음 — 패스 받을 사람·간격 상대면 둘이 함께 보이는 프레임을 고르고 캡션에 둘의 위치를 쓴다`,
				);
			}
		}
		const boldTexts = unit.blocks.flatMap((block) =>
			block.type === "text" ? boldSpans(block.text).filter((span) => span.bold).map((span) => span.text) : [],
		);
		for (const span of boldTexts) {
			if (endsInPastTense(span)) {
				warnings.push(
					`fc-feedback: 경고 유닛 ${unitId} 볼드 "${span}"가 과거형입니다 — 볼드는 원문이 요청한 할 행동만 짚습니다(잘못한 행동·결과는 볼드하지 않음)`,
				);
			}
		}
		if (boldTexts.length === 0) {
			warnings.push(
				`fc-feedback: 경고 ${unitId}: 볼드 행동 없음 — 원문이 할 행동을 요청하면 첫 문단에 그 행동을 볼드로 쓰고, 원문에 잘못·상태·결과만 있으면 볼드 없이 둔다. 지시·평가가 없는 음성 구간이면 인접 유닛에 합칠지 확인(댓글 유닛은 합치지 않는다)`,
			);
		}
	}
	return warnings;
}

// ── similar-choices.json (plan §3) ──────────────────────────────────────────

const MAX_SIMILAR_CHOICES_PER_UNIT = 3;

/**
 * Validates similar-choices.json against `candidatesFile` (the machine-
 * generated similar-candidates.json content): each chosen uid must be in
 * that unit's own candidate list, at most 3 per unit, no duplicates.
 */
export function checkSimilarChoices(choices: unknown, candidatesFile: SimilarCandidatesResult): ErrorsResult {
	const errors: ValidationError[] = [];
	if (!isRecord(choices)) {
		errors.push({ path: "", message: "similar-choices.json은 객체여야 합니다" });
		return { errors };
	}
	if (!isRecord(choices.units)) {
		errors.push({ path: "units", message: "units는 객체여야 합니다" });
		return { errors };
	}

	for (const [unitId, entry] of Object.entries(choices.units)) {
		const path = `units.${unitId}`;
		if (!Array.isArray(entry)) {
			errors.push({ path, message: "선택 목록은 배열이어야 합니다" });
			continue;
		}
		if (!(unitId in candidatesFile)) {
			errors.push({ path, message: "similar-candidates.json에 없는 unit입니다" });
			continue;
		}
		const allowedUids = new Set(candidatesFile[unitId].map((candidate) => candidate.uid));
		if (entry.length > MAX_SIMILAR_CHOICES_PER_UNIT) {
			errors.push({ path, message: `unit당 최대 ${MAX_SIMILAR_CHOICES_PER_UNIT}개까지 선택할 수 있습니다` });
		}
		const seen = new Set<string>();
		entry.forEach((uid, index) => {
			const uidPath = `${path}[${index}]`;
			if (typeof uid !== "string") {
				errors.push({ path: uidPath, message: "uid는 문자열이어야 합니다" });
				return;
			}
			if (!allowedUids.has(uid)) {
				errors.push({ path: uidPath, message: `해당 unit의 후보 목록에 없는 uid입니다: ${uid}` });
			}
			if (seen.has(uid)) {
				errors.push({ path: uidPath, message: `중복된 uid입니다: ${uid}` });
			} else {
				seen.add(uid);
			}
		});
	}

	return { errors };
}

// ── refs-draft.json (plan §3) ────────────────────────────────────────────────

const LANG_PATTERN = /^[a-z]{2}$/;
const MAX_TRANSLATIONS = 5;
const MAX_REFS_PER_UNIT = 3;

const MAX_RELEVANCE_LENGTH = 120;
/** An eafc ref's own game version as its material states it: "FC 25", "FIFA 23". */
const REF_GAME_VERSION_PATTERN = /^(FC|FIFA) \d{2}$/;
/** The year-month an eafc ref's material was published ("2023-01"), required when it states no version. */
const REF_PUBLISHED_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function isRefKind(value: unknown): value is "eafc" | "tactics" {
	return value === "eafc" || value === "tactics";
}

/** `m:ss` or `h:mm:ss` → seconds; anything else (including a bare number) → null. */
export function clockSeconds(value: string): number | null {
	const match = value.match(/^(?:(\d+):)?(\d{1,2}):([0-5]\d)$/);
	if (match === null) return null;
	const minutes = Number(match[2]);
	if (match[1] !== undefined && minutes > 59) return null;
	return (match[1] === undefined ? 0 : Number(match[1]) * 3600) + minutes * 60 + Number(match[3]);
}

const MAX_LESSON_LENGTH = 80;

/** `lesson_ko` of one draft ref (optional): unit id → the action the material itself recommends, 1–80 chars on one line, keys within the ref's `unit_ids`. Valid keys are added to `lessonUnitIds`. */
function checkLessons(raw: unknown, refUnitIds: readonly string[], path: string, refLabel: string, lessonUnitIds: Set<string>, errors: ValidationError[]): void {
	if (raw === undefined) return;
	if (!isRecord(raw)) {
		errors.push({ path, message: "lesson_ko는 unit id → 자료가 권하는 행동 문장 객체여야 합니다" });
		return;
	}
	for (const [unitId, lesson] of Object.entries(raw)) {
		if (!refUnitIds.includes(unitId)) {
			errors.push({ path: `${path}.${unitId}`, message: "unit_ids에 없는 유닛입니다" });
		} else if (typeof lesson !== "string" || lesson.trim() === "" || lesson.trim().length > MAX_LESSON_LENGTH || /[\r\n]/.test(lesson)) {
			errors.push({ path: `${path}.${unitId}`, message: `lesson_ko 값은 1–${MAX_LESSON_LENGTH}자 한 줄이어야 합니다` });
		} else {
			lessonUnitIds.add(unitId);
			const concession = relevanceConcession(lesson);
			if (concession !== undefined) {
				errors.push({ path: `${path}.${unitId}`, message: `${refLabel} ${unitId}: lesson_ko가 상황 차이를 양보한다('${concession}') — 상황이 다른 구간은 붙이지 않는다` });
			}
			errors.push(...internalWordErrors(lesson, `${path}.${unitId}`));
		}
	}
}

/**
 * Validates refs-draft.json against `validated`: urls are http(s) and
 * normalizable, `lang` is a 2-letter code, `kind` is `eafc`/`tactics`,
 * `format` is `video`/`article`, a non-`ko` lang requires `summary_ko` + at
 * least one `key_points_ko`, `translations` has at most 5 entries, `unit_ids`
 * has at least 1 entry (each must exist), `relevance_ko` holds exactly one
 * 1–120 character single-line sentence per `unit_ids` entry, `video_starts`
 * (video only) maps `unit_ids` entries to `m:ss`/`h:mm:ss`, `recurring_labels` lists only plan
 * `recurring` labels that share a unit with the ref, no two units of one ref share a relevance
 * sentence, `recurring_unfound` and `units_unfound` record every uncovered label/unit with its tried queries and
 * `subtitle_terms`, an `eafc` ref states `game_version` ("FC 25" or null when its material states none, then
 * with `published` "YYYY-MM") and `pro_clubs` while a `tactics` ref has none of them, at most 3 refs per unit across the whole draft,
 * and — for a unit with refs whose title has a -ㅁ (fault) segment — a `lesson_ko` (unit id → 1–80 character action the material
 * itself recommends, keys within `unit_ids`) from at least one of its refs.
 */
export function checkRefsDraft(draft: unknown, validated: ValidatedPlan, roster: Roster | null = null): ErrorsResult {
	const errors: ValidationError[] = [];
	if (!isRecord(draft)) {
		errors.push({ path: "", message: "refs-draft.json은 객체여야 합니다" });
		return { errors };
	}
	if (!Array.isArray(draft.refs)) {
		errors.push({ path: "refs", message: "refs는 배열이어야 합니다" });
		return { errors };
	}

	const validUnitIds = new Set(validated.units.map((unit) => unit.id));
	const unitRefIndices = new Map<string, number[]>();
	const recurringUnits = new Map(validated.recurring.map((entry) => [entry.label, entry.unit_ids]));
	const labelledLabels = new Set<string>();
	const lessonUnitIds = new Set<string>();

	draft.refs.forEach((refRaw, index) => {
		const path = `refs[${index}]`;
		if (!isRecord(refRaw)) {
			errors.push({ path, message: "ref 항목은 객체여야 합니다" });
			return;
		}

		const url = typeof refRaw.url === "string" ? refRaw.url : "";
		let normalizable = true;
		try {
			normalizeUrl(url);
		} catch {
			normalizable = false;
		}
		if (!normalizable) {
			errors.push({ path: `${path}.url`, message: "http(s)이고 정규화 가능한 URL이어야 합니다" });
		}

		const lang = requirePattern(
			refRaw.lang,
			LANG_PATTERN,
			`${path}.lang`,
			errors,
			`lang은 ${LANG_PATTERN.source} 패턴이어야 합니다`,
		);

		if (!isRefKind(refRaw.kind)) {
			errors.push({ path: `${path}.kind`, message: 'kind는 "eafc" 또는 "tactics"여야 합니다' });
		}

		if (refRaw.format !== "video" && refRaw.format !== "article") {
			errors.push({ path: `${path}.format`, message: 'format은 "video" 또는 "article"이어야 합니다' });
		}
		if (refRaw.kind === "eafc") {
			if (refRaw.game_version !== null && !(typeof refRaw.game_version === "string" && REF_GAME_VERSION_PATTERN.test(refRaw.game_version))) {
				errors.push({
					path: `${path}.game_version`,
					message: 'eafc 자료는 game_version이 필요합니다 — 자료의 제목·설명·화면에 적힌 버전("FC 25", "FIFA 23"), 적혀 있지 않으면 null',
				});
			}
			if (refRaw.game_version === null && !(typeof refRaw.published === "string" && REF_PUBLISHED_PATTERN.test(refRaw.published))) {
				errors.push({
					path: `${path}.published`,
					message: 'game_version이 null인 eafc 자료는 published가 필요합니다 — 자료를 올린 연월("2023-01")',
				});
			}
			if (typeof refRaw.pro_clubs !== "boolean") {
				errors.push({
					path: `${path}.pro_clubs`,
					message: "eafc 자료는 pro_clubs(true/false)가 필요합니다 — 자료가 프로클럽(한 사람이 한 선수만 조작하는 모드)을 다루면 true",
				});
			}
		} else if (refRaw.kind === "tactics" && (refRaw.game_version !== undefined || refRaw.pro_clubs !== undefined || refRaw.published !== undefined)) {
			errors.push({ path, message: "tactics 자료에는 game_version·pro_clubs·published를 쓰지 않습니다" });
		}

		const refUnitIds = Array.isArray(refRaw.unit_ids) ? refRaw.unit_ids.filter((id): id is string => typeof id === "string") : [];
		if (refRaw.video_start !== undefined) {
			errors.push({
				path: `${path}.video_start`,
				message: "video_start는 쓰지 않습니다 — video_starts에 유닛 id → 그 유닛 장면을 다루는 구간 시작(m:ss)을 적으세요",
			});
		}
		if (refRaw.video_starts !== undefined) {
			if (refRaw.format !== "video") {
				errors.push({ path: `${path}.video_starts`, message: "video_starts는 format이 video일 때만 쓸 수 있습니다" });
			} else if (!isRecord(refRaw.video_starts)) {
				errors.push({ path: `${path}.video_starts`, message: "video_starts는 unit id → m:ss 객체여야 합니다" });
			} else {
				for (const [unitId, start] of Object.entries(refRaw.video_starts)) {
					if (!refUnitIds.includes(unitId)) {
						errors.push({ path: `${path}.video_starts.${unitId}`, message: "unit_ids에 없는 유닛입니다" });
					} else if (typeof start !== "string" || clockSeconds(start) === null) {
						errors.push({ path: `${path}.video_starts.${unitId}`, message: "video_starts 값은 m:ss 또는 h:mm:ss여야 합니다" });
					}
				}
			}
		}
		if (!Array.isArray(refRaw.recurring_labels)) {
			errors.push({
				path: `${path}.recurring_labels`,
				message: 'recurring_labels는 배열이어야 합니다 — 이 자료가 직접 다루는 plan recurring label을 적고, 없으면 []',
			});
		} else {
			refRaw.recurring_labels.forEach((label, labelIndex) => {
				const labelPath = `${path}.recurring_labels[${labelIndex}]`;
				const labelUnits = typeof label === "string" ? recurringUnits.get(label) : undefined;
				if (typeof label !== "string" || labelUnits === undefined) {
					errors.push({ path: labelPath, message: `plan의 recurring에 없는 label입니다: ${describeUnknown(label)}` });
				} else if (!labelUnits.some((id) => refUnitIds.includes(id))) {
					errors.push({
						path: labelPath,
						message: `이 자료의 unit_ids가 반복 지적 "${label}"의 유닛(${labelUnits.join(", ")})을 하나도 포함하지 않습니다`,
					});
				} else {
					labelledLabels.add(label);
				}
			});
		}
		if (!isRecord(refRaw.relevance_ko)) {
			errors.push({ path: `${path}.relevance_ko`, message: "relevance_ko는 unit id → 관련성 문장 객체여야 합니다" });
		} else {
			const relevance = refRaw.relevance_ko;
			for (const unitId of refUnitIds) {
				const sentence = relevance[unitId];
				if (typeof sentence !== "string" || sentence.trim() === "" || sentence.trim().length > MAX_RELEVANCE_LENGTH || /[\r\n]/.test(sentence)) {
					errors.push({
						path: `${path}.relevance_ko.${unitId}`,
						message: `unit_ids의 유닛마다 1–${MAX_RELEVANCE_LENGTH}자 한 줄 관련성 문장이 필요합니다`,
					});
				}
			}
			for (const unitId of Object.keys(relevance)) {
				if (!refUnitIds.includes(unitId)) {
					errors.push({ path: `${path}.relevance_ko.${unitId}`, message: "unit_ids에 없는 유닛입니다" });
				}
			}
			const unitBySentence = new Map<string, string>();
			for (const unitId of refUnitIds) {
				const sentence = relevance[unitId];
				if (typeof sentence !== "string") continue;
				const concession = relevanceConcession(sentence);
				if (concession !== undefined) {
					errors.push({
						path: `${path}.relevance_ko.${unitId}`,
						message: `${typeof refRaw.title === "string" ? refRaw.title : path} ${unitId}: relevance_ko가 상황 차이를 양보한다('${concession}') — 상황이 다른 구간은 붙이지 않는다`,
					});
				}
				errors.push(...internalWordErrors(sentence, `${path}.relevance_ko.${unitId}`));
				const firstUnitId = unitBySentence.get(sentence.trim());
				if (firstUnitId === undefined) {
					unitBySentence.set(sentence.trim(), unitId);
				} else {
					errors.push({
						path: `${path}.relevance_ko.${unitId}`,
						message: `${firstUnitId}와 같은 문장입니다 — 유닛마다 그 장면에 붙인 구간이 실제로 말하는 내용을 따로 적으세요`,
					});
				}
			}
		}

		checkLessons(refRaw.lesson_ko, refUnitIds, `${path}.lesson_ko`, typeof refRaw.title === "string" ? refRaw.title : path, lessonUnitIds, errors);

		if (lang !== "" && lang !== "ko") {
			if (!isNonBlank(refRaw.summary_ko)) {
				errors.push({ path: `${path}.summary_ko`, message: "lang이 ko가 아니면 summary_ko가 필요합니다" });
			}
			if (!Array.isArray(refRaw.key_points_ko) || refRaw.key_points_ko.length === 0) {
				errors.push({
					path: `${path}.key_points_ko`,
					message: "lang이 ko가 아니면 key_points_ko가 최소 1개 필요합니다",
				});
			}
		}

		if (refRaw.translations !== undefined) {
			if (!Array.isArray(refRaw.translations)) {
				errors.push({ path: `${path}.translations`, message: "translations는 배열이어야 합니다" });
			} else {
				if (refRaw.translations.length > MAX_TRANSLATIONS) {
					errors.push({
						path: `${path}.translations`,
						message: `translations는 최대 ${MAX_TRANSLATIONS}개까지 허용됩니다`,
					});
				}
				refRaw.translations.forEach((translation, translationIndex) => {
					if (!isRecord(translation) || typeof translation.orig !== "string" || typeof translation.ko !== "string") {
						errors.push({
							path: `${path}.translations[${translationIndex}]`,
							message: "orig/ko 문자열 쌍이어야 합니다",
						});
					}
				});
			}
		}

		if (!Array.isArray(refRaw.unit_ids) || refRaw.unit_ids.length === 0) {
			errors.push({ path: `${path}.unit_ids`, message: "unit_ids는 최소 1개 이상이어야 합니다" });
		} else {
			refRaw.unit_ids.forEach((unitId, unitIndex) => {
				const unitIdPath = `${path}.unit_ids[${unitIndex}]`;
				if (typeof unitId !== "string" || !validUnitIds.has(unitId)) {
					errors.push({
						path: unitIdPath,
						message: `검증된 plan에 없는 unit id입니다: ${describeUnknown(unitId)}`,
					});
					return;
				}
				const indices = unitRefIndices.get(unitId) ?? [];
				indices.push(index);
				unitRefIndices.set(unitId, indices);
			});
		}
	});

	for (const [unitId, indices] of unitRefIndices) {
		indices.slice(MAX_REFS_PER_UNIT).forEach((refIndex) => {
			errors.push({
				path: `refs[${refIndex}].unit_ids`,
				message: `unit ${unitId}에 대한 참고자료가 ${MAX_REFS_PER_UNIT}개를 초과합니다`,
			});
		});
	}

	for (const unit of validated.units) {
		if (unitRefIndices.has(unit.id) && unitTitleHasFaultSegment(unit.title) && !lessonUnitIds.has(unit.id)) {
			errors.push({
				path: "refs",
				message: `${unit.id}: 제목에 -ㅁ(지적) 조각이 있고 자료가 붙었는데 어느 자료도 lesson_ko를 주지 않는다 — 붙인 자료가 그 잘못에 권하는 행동을 자료의 말로 1–${MAX_LESSON_LENGTH}자 한 줄로 쓴다(예 "포백이 한 줄로 서서 한 덩어리로 움직인다")`,
			});
		}
	}

	checkRecurringCoverage(draft.recurring_unfound, labelledLabels, validated, errors);
	checkUnitsUnfound(draft.units_unfound, new Set(unitRefIndices.keys()), validated, errors);
	checkUnfoundSearchesAreReal(draft.recurring_unfound, draft.units_unfound, roster, errors);

	return { errors };
}

/**
 * Non-blocking warnings for `check refs`: a plan `recurring` entry whose labelled refs (refs that list
 * the label in `recurring_labels`) sit on part of its `unit_ids` but not all, one line per entry naming
 * the units without such a ref. Call it only on a draft that `checkRefsDraft` accepted. An entry with no
 * labelled ref at all is the blocking coverage error instead.
 */
export function recurringPartialCoverageWarnings(draft: unknown, validated: ValidatedPlan): string[] {
	const refs = isRecord(draft) && Array.isArray(draft.refs) ? draft.refs : [];
	const warnings: string[] = [];
	for (const entry of validated.recurring) {
		const covered = new Set<string>();
		for (const ref of refs) {
			if (isRecord(ref) && Array.isArray(ref.unit_ids) && Array.isArray(ref.recurring_labels) && ref.recurring_labels.includes(entry.label)) {
				for (const id of ref.unit_ids) {
					covered.add(String(id));
				}
			}
		}
		const uncovered = entry.unit_ids.filter((id) => !covered.has(id));
		if (uncovered.length > 0 && uncovered.length < entry.unit_ids.length) {
			warnings.push(`fc-feedback: 경고 반복 지적 "${entry.label}": 자료 없는 유닛 ${uncovered.join(", ")}`);
		}
		if (covered.size === 0) {
			const attached = refs.flatMap((ref, refIndex) =>
				isRecord(ref) && Array.isArray(ref.unit_ids)
					? ref.unit_ids.filter((id) => entry.unit_ids.includes(String(id))).map((id) => `자료 ${refIndex + 1}(${String(id)})`)
					: [],
			);
			if (attached.length > 0) {
				warnings.push(
					`fc-feedback: 경고 반복 지적 "${entry.label}"을 덮은 자료가 없지만 그 유닛에 ${attached.join(", ")}가 붙어 있습니다 — 그 자료가 이 잘못을 다루면 recurring_labels에 적고 나머지 유닛에도 붙입니다`,
				);
			}
		}
	}
	return warnings;
}

/**
 * Non-blocking warning for `check refs`: the recurring label with the most units (the first one on a tie) has no ref that lists the
 * label in `recurring_labels` and has `pro_clubs: true`, so the most repeated fault is explained only by material that may not apply to
 * Pro Clubs. Call it only on a draft that `checkRefsDraft` accepted.
 */
export function recurringProClubsWarnings(draft: unknown, validated: ValidatedPlan): string[] {
	const refs = isRecord(draft) && Array.isArray(draft.refs) ? draft.refs : [];
	const top = validated.recurring.reduce<ValidatedRecurring | null>((best, entry) => (best === null || entry.unit_ids.length > best.unit_ids.length ? entry : best), null);
	if (top === null) return [];
	const covered = refs.some((ref) => isRecord(ref) && ref.pro_clubs === true && Array.isArray(ref.recurring_labels) && ref.recurring_labels.includes(top.label));
	return covered ? [] : [`fc-feedback: 경고 가장 많이 반복된 '${top.label}'에 프로클럽 자료가 없다 — 프로클럽 수비전술 강좌·같은 채널 label 핵심어로 더 찾는다`];
}

const GAME_VERSION_PATTERN = /(?<![A-Za-z])(?:EA\s?)?(FC|FIFA)\s?(\d{2})(?!\d)/gi;
const MATCH_VERSION_CLAIM_PATTERN = /이번 경기[^.\n]{0,15}?(FC|FIFA)\s?(\d{2})(?!\d)/gi;

const gameVersionName = (family: string, number: string): string => `${family.toUpperCase()} ${number}`;

/**
 * Badge text for an eafc ref's version: its own `game_version` ("FC 25"), marked "이전 버전" when older than
 * `matchVersion` (`matchGameVersion` of the session's video titles). `null` when the material states no version (no badge;
 * its upload month shows alone, see `publishedBadge`).
 */
export function refVersionBadge(refVersion: string | null, matchVersion: string | null): string | null {
	if (refVersion === null) return null;
	const releaseNumber = (version: string): number => Number(version.slice(-2));
	return matchVersion !== null && releaseNumber(refVersion) < releaseNumber(matchVersion) ? `${refVersion} · 이전 버전` : refVersion;
}

/** Badge text for a material's `published` year-month ("2023-01" → "2023년 1월"). */
export function publishedBadge(published: string): string {
	const [year, month] = published.split("-");
	return `${year}년 ${Number(month)}월`;
}

/**
 * The match's game version ("FC 26") as named in its video titles, or null when no title names one or
 * the titles disagree. Only the titles decide it — a release-date guess is not evidence.
 */
export function matchGameVersion(videoTitles: readonly string[]): string | null {
	const versions = new Set<string>();
	for (const title of videoTitles) {
		for (const match of title.matchAll(GAME_VERSION_PATTERN)) {
			versions.add(gameVersionName(match[1], match[2]));
		}
	}
	return versions.size === 1 ? [...versions][0] : null;
}

/**
 * Errors for ref prose (`summary_ko`, `key_points_ko`, `relevance_ko`) that states this match's version
 * ("이번 경기(FC 27)") differently from `gameVersion` (`matchGameVersion` of the session's video
 * titles), or states one at all when `gameVersion` is null.
 */
export function refsMatchVersionErrors(draft: unknown, gameVersion: string | null): ValidationError[] {
	const errors: ValidationError[] = [];
	const refs = isRecord(draft) && Array.isArray(draft.refs) ? draft.refs : [];
	refs.forEach((ref, index) => {
		if (!isRecord(ref)) return;
		const texts: [string, unknown][] = [
			[`refs[${index}].summary_ko`, ref.summary_ko],
			...(Array.isArray(ref.key_points_ko) ? ref.key_points_ko.map((point, i): [string, unknown] => [`refs[${index}].key_points_ko[${i}]`, point]) : []),
			...(isRecord(ref.relevance_ko) ? Object.entries(ref.relevance_ko).map(([id, text]): [string, unknown] => [`refs[${index}].relevance_ko.${id}`, text]) : []),
		];
		for (const [path, text] of texts) {
			if (typeof text !== "string") continue;
			for (const claim of text.matchAll(MATCH_VERSION_CLAIM_PATTERN)) {
				const claimed = gameVersionName(claim[1], claim[2]);
				if (claimed !== gameVersion) {
					errors.push({
						path,
						message:
							gameVersion === null
								? `경기 영상 제목에 게임 버전이 없어 이번 경기 버전(${claimed})을 적을 수 없습니다 — 날짜로 추정하지 말고 빼세요`
								: `이번 경기 버전은 경기 영상 제목의 ${gameVersion}입니다(${claimed} 아님)`,
					});
				}
			}
		}
	});
	return errors;
}

/** Phrases by which a `relevance_ko` sentence concedes that the ref's situation differs from the card's — such a section is not attached at all. */
const RELEVANCE_CONCESSION_PHRASES = ["예시지만", "예시이지만", "예시에서는", "상황은 다르지만", "상황이 다르지만"];
/** Stems of the same concession whose endings vary ("상황과는 다르다", "우리 숫자가 적은 상황 기준이다"); the literals above stay for their own wording. */
const RELEVANCE_CONCESSION_PATTERNS = [/상황(?:이|은|과는?|과도)\s*다르/, /상황\s*기준이/];

/** The matched text of the first concession a `relevance_ko`/`lesson_ko` sentence makes (literal phrase or stem pattern), or `undefined`. */
function relevanceConcession(sentence: string): string | undefined {
	return RELEVANCE_CONCESSION_PHRASES.find((phrase) => sentence.includes(phrase)) ?? RELEVANCE_CONCESSION_PATTERNS.map((pattern) => pattern.exec(sentence)?.[0]).find((hit) => hit !== undefined);
}

/** Words of our own pipeline ("카드" = a unit's card in the viewer, "유닛" = a feedback unit) that a football reader misreads or never sees; matched as substrings of ref sentences shown to the reader. */
const INTERNAL_READER_WORDS = ["카드 장면", "이 카드", "카드의", "유닛"];
/** Real football cards; removed before `INTERNAL_READER_WORDS` are searched so "옐로 카드의" is not flagged. */
const FOOTBALL_CARD_PATTERN = /(?:옐로|레드|경고)\s?카드/g;

/** Errors for each internal word (`INTERNAL_READER_WORDS`) a reader-visible ref sentence at `path` contains. */
function internalWordErrors(sentence: string, path: string): ValidationError[] {
	const text = sentence.replace(FOOTBALL_CARD_PATTERN, "");
	return INTERNAL_READER_WORDS.filter((word) => text.includes(word)).map((word) => ({
		path,
		message: `${path}: 독자에게 보이는 문장에 내부 용어 "${word}"가 있다 — 장면은 "이 장면"으로 쓴다`,
	}));
}

const MIN_UNFOUND_QUERIES = 2;
const MIN_SUBTITLE_TERMS = 1;

/** The `subtitle_terms` of an unfound item at `path`: pushes an error unless it holds at least one non-blank string. */
function checkSubtitleTerms(item: Record<string, unknown>, path: string, errors: ValidationError[]): void {
	const terms = Array.isArray(item.subtitle_terms) ? item.subtitle_terms.filter(isNonBlank) : [];
	if (terms.length < MIN_SUBTITLE_TERMS) {
		errors.push({
			path: `${path}.subtitle_terms`,
			message: `subtitle_terms는 refsubs/ 자막에 나오는 표기의 검색어를 ${MIN_SUBTITLE_TERMS}개 이상(비어 있지 않게) 적어야 합니다`,
		});
	}
}

/**
 * Every plan `recurring` entry needs a reference or a recorded failed search: some ref lists the label
 * in `recurring_labels` (`coveredLabels`), or `recurring_unfound` holds an item with exactly that label
 * and at least 2 non-empty `queries` (the searches tried). A ref that merely sits on one of the entry's
 * units for another problem does not cover it. An item for a label that is not in the plan, or one that
 * a ref already covers, is an error — the list must say only what is true.
 */
function checkRecurringCoverage(
	raw: unknown,
	coveredLabels: ReadonlySet<string>,
	validated: ValidatedPlan,
	errors: ValidationError[],
): void {
	if (!Array.isArray(raw)) {
		errors.push({
			path: "recurring_unfound",
			message: 'recurring_unfound는 배열이어야 합니다 — 찾지 못한 반복 지적이 없으면 "recurring_unfound": []를 추가하세요',
		});
		return;
	}
	const planLabels = new Set(validated.recurring.map((entry) => entry.label));
	const searchedLabels = new Set<string>();
	raw.forEach((item, index) => {
		const path = `recurring_unfound[${index}]`;
		if (!isRecord(item) || typeof item.label !== "string") {
			errors.push({ path, message: "recurring_unfound 항목은 { label, queries, subtitle_terms } 객체여야 합니다" });
			return;
		}
		if (!planLabels.has(item.label)) {
			errors.push({ path: `${path}.label`, message: `plan의 recurring에 없는 label입니다: ${item.label}` });
			return;
		}
		if (coveredLabels.has(item.label)) {
			errors.push({ path: `${path}.label`, message: `이미 참고자료가 연결된 반복 지적입니다(recurring_unfound에서 빼세요): ${item.label}` });
			return;
		}
		const queries = Array.isArray(item.queries) ? item.queries.filter(isNonBlank) : [];
		if (queries.length < MIN_UNFOUND_QUERIES) {
			errors.push({
				path: `${path}.queries`,
				message: `queries는 시도한 검색어를 ${MIN_UNFOUND_QUERIES}개 이상(비어 있지 않게) 적어야 합니다`,
			});
			return;
		}
		searchedLabels.add(item.label);
		checkSubtitleTerms(item, path, errors);
	});
	for (const entry of validated.recurring) {
		if (!coveredLabels.has(entry.label) && !searchedLabels.has(entry.label)) {
			errors.push({
				path: "recurring_unfound",
				message: `반복 지적 "${entry.label}"을 recurring_labels에 적은 참고자료가 없습니다 — 그 문제를 직접 다루는 자료의 recurring_labels에 label을 적거나, recurring_unfound에 { "label": "${entry.label}", "queries": [시도한 검색어 2개 이상], "subtitle_terms": [자막 속 표기의 검색어 1개 이상] }를 적으세요`,
			});
		}
	}
}

const MAX_UNFOUND_SHARED_ENTRIES = 2;

function normalizedSearchText(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Game words of a search query: "fc"/"fifa"/"eafc"/"ea fc"/"pro clubs" as whole Latin words (not "fcb"), or 피파/프로클럽 anywhere. */
const GAME_TERM_PATTERN = /(?<![a-z])(?:fc|fifa|eafc|ea\s*fc|pro\s*clubs?)(?![a-z])|피파|프로클럽/i;

/**
 * The `queries`/`subtitle_terms` of `recurring_unfound` and `units_unfound` items must record real, per-item searches:
 * - a `recurring_unfound` item whose queries all contain a game term (`GAME_TERM_PATTERN`) is an error — a repeated fault is explained in real-football
 *   lessons too, so at least one query must be free of game words;
 * - a query containing a roster member's name, alias, or gamertag (case-insensitive) is an error — the member's name is in no video title or subtitle;
 *   skipped when the roster is absent;
 * - the same query string (trimmed, case-insensitive) in more than 2 items, or the same `subtitle_terms` set (order-insensitive) in more than 2 items,
 *   is an error — a copied record is not a search of that label/unit. One error per repeated string/set, at its first item.
 */
/** The first roster name, alias, or gamertag (case-insensitive) that `text` contains, or `undefined` (also when there is no roster). */
export function rosterLabelIn(text: string, roster: Roster | null): string | undefined {
	return (roster?.members ?? []).flatMap(memberLabels).find((candidate) => normalizedSearchText(text).includes(candidate.toLowerCase()));
}

/**
 * The words of `text` worth searching for: split on whitespace, drop words that hold a roster name/alias/gamertag (`rosterLabelIn`), drop
 * condition-clause words (`isConditionClauseWord`), trim one trailing particle (only when 2+ syllables remain), drop words shorter than 2 chars.
 */
export function searchKeywordWords(text: string, roster: Roster | null): string[] {
	return text
		.split(/\s+/)
		.filter((raw) => raw !== "" && rosterLabelIn(raw, roster) === undefined && !isConditionClauseWord(raw))
		.map((raw) => {
			const particle = TITLE_WORD_PARTICLES.find((candidate) => raw.endsWith(candidate));
			return particle !== undefined && raw.length - particle.length >= 2 ? raw.slice(0, -particle.length) : raw;
		})
		.filter((word) => word.length >= 2);
}

function checkUnfoundSearchesAreReal(recurringRaw: unknown, unitsRaw: unknown, roster: Roster | null, errors: ValidationError[]): void {
	const items: Array<{ path: string; id: string; queries: string[]; terms: string[] }> = [];
	const collect = (raw: unknown, listName: string, idKey: "label" | "unit_id"): void => {
		(Array.isArray(raw) ? raw : []).forEach((item, index) => {
			if (!isRecord(item) || typeof item[idKey] !== "string") return;
			items.push({
				path: `${listName}[${index}]`,
				id: String(item[idKey]),
				queries: (Array.isArray(item.queries) ? item.queries : []).filter(isNonBlank),
				terms: (Array.isArray(item.subtitle_terms) ? item.subtitle_terms : []).filter(isNonBlank),
			});
		});
	};
	collect(recurringRaw, "recurring_unfound", "label");
	collect(unitsRaw, "units_unfound", "unit_id");

	for (const item of items) {
		if (item.path.startsWith("recurring_unfound") && item.queries.length > 0 && item.queries.every((query) => GAME_TERM_PATTERN.test(query))) {
			errors.push({
				path: `${item.path}.queries`,
				message: `${item.id}: 검색어가 모두 게임 용어(fc·fifa·피파·프로클럽·pro clubs·eafc)를 담고 있다 — 반복 지적은 실제 축구 강의·전술 영상에도 같은 설명이 있으니 게임 용어 없는 검색어를 하나 이상 적는다`,
			});
		}
		for (const query of item.queries) {
			const label = rosterLabelIn(query, roster);
			if (label !== undefined) {
				errors.push({ path: `${item.path}.queries`, message: `${item.id}: 검색어 "${query}"에 팀원 이름 "${label}"이 들어 있다 — 팀원 이름은 영상 제목·자막에 없다. 장면의 동작·용어로 검색한다` });
			}
		}
	}
	const repeated = (keyOf: (item: (typeof items)[number]) => string[], describe: (key: string, ids: string[]) => string, pathSuffix: string): void => {
		const holders = new Map<string, typeof items>();
		for (const item of items) {
			for (const key of new Set(keyOf(item))) holders.set(key, [...(holders.get(key) ?? []), item]);
		}
		for (const [key, holding] of holders) {
			if (holding.length > MAX_UNFOUND_SHARED_ENTRIES) {
				errors.push({ path: `${holding[0].path}.${pathSuffix}`, message: describe(key, holding.map((item) => item.id)) });
			}
		}
	};
	repeated(
		(item) => item.queries.map(normalizedSearchText),
		(query, ids) => `같은 검색어 "${query}"가 unfound 항목 ${ids.length}개(${ids.join(", ")})에 있다 — 항목마다 그 label/유닛의 장면에 맞춰 직접 검색한 검색어를 적는다`,
		"queries",
	);
	repeated(
		(item) => (item.terms.length === 0 ? [] : [[...new Set(item.terms.map(normalizedSearchText))].sort().join("\u0000")]),
		(key, ids) => `같은 subtitle_terms [${key.split("\u0000").join(", ")}]가 unfound 항목 ${ids.length}개(${ids.join(", ")})에 있다 — 항목마다 그 장면의 자막 표기로 검색어를 적는다`,
		"subtitle_terms",
	);
}

/**
 * Every plan unit that no ref is attached to (`attachedUnitIds`) needs exactly one `units_unfound` item
 * `{unit_id, queries (>= 2), subtitle_terms (>= 1)}` recording the failed search. An item for an unknown
 * unit, a unit that has a ref, or a unit already listed is an error — the list must say only what is true.
 */
function checkUnitsUnfound(
	raw: unknown,
	attachedUnitIds: ReadonlySet<string>,
	validated: ValidatedPlan,
	errors: ValidationError[],
): void {
	if (!Array.isArray(raw)) {
		errors.push({
			path: "units_unfound",
			message: 'units_unfound는 배열이어야 합니다 — 자료가 하나도 붙지 않은 유닛이 없으면 "units_unfound": []를 추가하세요',
		});
		return;
	}
	const planUnitIds = new Set(validated.units.map((unit) => unit.id));
	const listedUnitIds = new Set<string>();
	raw.forEach((item, index) => {
		const path = `units_unfound[${index}]`;
		if (!isRecord(item) || typeof item.unit_id !== "string") {
			errors.push({ path, message: "units_unfound 항목은 { unit_id, queries, subtitle_terms } 객체여야 합니다" });
			return;
		}
		if (!planUnitIds.has(item.unit_id)) {
			errors.push({ path: `${path}.unit_id`, message: `검증된 plan에 없는 unit id입니다: ${item.unit_id}` });
			return;
		}
		if (attachedUnitIds.has(item.unit_id)) {
			errors.push({ path: `${path}.unit_id`, message: `이미 참고자료가 붙은 유닛입니다(units_unfound에서 빼세요): ${item.unit_id}` });
			return;
		}
		if (listedUnitIds.has(item.unit_id)) {
			errors.push({ path: `${path}.unit_id`, message: `units_unfound에 중복된 unit_id입니다: ${item.unit_id}` });
			return;
		}
		listedUnitIds.add(item.unit_id);
		const queries = Array.isArray(item.queries) ? item.queries.filter(isNonBlank) : [];
		if (queries.length < MIN_UNFOUND_QUERIES) {
			errors.push({
				path: `${path}.queries`,
				message: `queries는 시도한 검색어를 ${MIN_UNFOUND_QUERIES}개 이상(비어 있지 않게) 적어야 합니다`,
			});
		}
		checkSubtitleTerms(item, path, errors);
	});
	for (const unit of validated.units) {
		if (!attachedUnitIds.has(unit.id) && !listedUnitIds.has(unit.id)) {
			errors.push({
				path: "units_unfound",
				message: `유닛 ${unit.id}에 붙은 참고자료가 없습니다 — 자료를 붙이거나, units_unfound에 { "unit_id": "${unit.id}", "queries": [시도한 검색어 2개 이상], "subtitle_terms": [자막 속 표기의 검색어 1개 이상] }를 적으세요`,
			});
		}
	}
}
