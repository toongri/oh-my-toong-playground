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

/** child -> parent edges of the position tree. Roots (GK/DF/MF/FW) have no entry. */
export const PARENT: Readonly<Record<string, string | undefined>> = {
	CB: "DF",
	FB: "DF",
	LB: "FB",
	RB: "FB",
	LWB: "FB",
	RWB: "FB",
	CDM: "MF",
	CM: "MF",
	CAM: "MF",
	LM: "MF",
	RM: "MF",
	ST: "FW",
	CF: "FW",
	LW: "FW",
	RW: "FW",
	LF: "FW",
	RF: "FW",
};

const POSITION_LIST: string[] = [...ROOT_POSITIONS, ...Object.keys(PARENT)];

/** Every valid position tag in the tree (roots + all leaves/branches). */
export const POSITIONS: ReadonlySet<string> = new Set(POSITION_LIST);

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
 * tag is related to some position of the member).
 */
export function relatedMembers(
	unit: { member_ids: readonly string[]; position_tags: readonly string[] },
	roster: Roster,
): Member[] {
	return roster.members.filter(
		(member) =>
			unit.member_ids.includes(member.id) ||
			unit.position_tags.some((tag) => member.positions.some((position) => related(tag, position))),
	);
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
				if (typeof position !== "string" || !POSITIONS.has(position)) {
					errors.push({
						path: `${path}.positions[${positionIndex}]`,
						message: `포지션 트리에 없는 태그입니다: ${describeUnknown(position)}`,
					});
					return;
				}
				positions.push(position);
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

function extractYoutubeVideoId(url: URL): string | null {
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

export interface Line {
	i: number;
	video: string;
	start: number;
	end: number;
	text: string;
}

/**
 * Validates lines.json against `session`: `i` contiguous from 0, lines grouped
 * by video in the session's part order and sorted by `start` within a group,
 * `0 ≤ start < end ≤ duration+1`, and non-blank `text`.
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

		lines.push({ i: typeof entry.i === "number" ? entry.i : index, video, start, end, text });
	});

	return { errors, value: lines };
}

// ── candidates.json (plan §3) ────────────────────────────────────────────────

export interface Candidate {
	id: string;
	video: string;
	t: number;
	kind: "silence" | "scene" | "interval" | "manual";
	dur?: number;
}

const CANDIDATE_ID_PATTERN = /^c\d{3}$/;

function isCandidateKind(value: unknown): value is Candidate["kind"] {
	return value === "silence" || value === "scene" || value === "interval" || value === "manual";
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
				message: 'kind는 "silence" | "scene" | "interval" | "manual" 중 하나여야 합니다',
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
	member_ids: string[];
	key_frame_candidate_ids: string[];
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
}

export interface ValidatedPlan {
	version: 1;
	session_title: string;
	matches: ValidatedMatch[];
	units: ValidatedUnit[];
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
const KEY_FRAME_TOLERANCE_SECONDS = 5;

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
 * Validates plan.json (Claude-authored index) against the session's `lines`,
 * `candidates`, `taxonomy`, and `roster` (plan §3, all rules). On success,
 * `validated` assigns `m1…`/`m1-t1…`/`u001…` ids in document order and adds
 * each unit's `start`/`end` (seconds, from `lines`) and `video`; `tableMd` is
 * the human review-gate table with any proposed tags listed below it.
 */
export function checkPlan(plan: unknown, context: CheckPlanContext): CheckPlanResult {
	const { lines, candidates, taxonomy, roster } = context;
	const errors: ValidationError[] = [];
	const emptyValidated: ValidatedPlan = { version: 1, session_title: "", matches: [], units: [] };
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
	const rows: string[] = [];
	let usedProposedTag = false;
	let unitSeq = 0;
	const lastUnitByVideo = new Map<string, number>();

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

					const unitIds: string[] = [];
					if (!Array.isArray(topicRaw.units) || topicRaw.units.length === 0) {
						errors.push({ path: `${topicPath}.units`, message: "units는 최소 1개 이상이어야 합니다" });
					} else {
						topicRaw.units.forEach((unitRaw, unitIndex) => {
							const unitPath = `${topicPath}.units[${unitIndex}]`;
							if (!isRecord(unitRaw)) {
								errors.push({ path: unitPath, message: "unit 항목은 객체여야 합니다" });
								return;
							}
							unitSeq += 1;
							const unitId = `u${String(unitSeq).padStart(3, "0")}`;
							const unitTitle = checkTitle(unitRaw.title, `${unitPath}.title`, errors);

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
								const previousEndLine = lastUnitByVideo.get(unitVideo);
								if (previousEndLine !== undefined && startLine <= previousEndLine) {
									errors.push({
										path: `${unitPath}.start_line`,
										message: "같은 video 내에서 이전 unit과 겹치지 않고 오름차순이어야 합니다",
									});
								}
								lastUnitByVideo.set(unitVideo, endLine);
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
										message: `포지션 트리에 없는 태그입니다: ${tag}`,
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
								}
							});

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

							unitIds.push(unitId);
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
								key_frame_candidate_ids,
							});

							const memberCell =
								member_ids.length > 0
									? escapeTableCell(member_ids.map((id) => memberDisplayName(id, roster)).join(", "))
									: "-";
							rows.push(
								`| ${escapeTableCell(matchTitle)} | ${formatTime(unitStart)} | ${escapeTableCell(unitTitle)} | ${
									position_tags.length > 0 ? escapeTableCell(position_tags.join(", ")) : "-"
								} | ${topic_tags.length > 0 ? escapeTableCell(topic_tags.join(", ")) : "-"} | ${memberCell} |`,
							);
						});
					}

					validatedTopics.push({ id: topicId, title: topicTitle, summary, unit_ids: unitIds });
				});
			}

			matches.push({ id: matchId, title: matchTitle, topics: validatedTopics });
		});
	}

	const pending = errors.length === 0 && usedProposedTag;
	const validated: ValidatedPlan = { version: 1, session_title, matches, units };

	const tableLines = ["| 경기 | 시간 | 제목 | 포지션 | 주제 | 팀원 |", "|---|---|---|---|---|---|", ...rows];
	if (proposed.length > 0) {
		tableLines.push("", "제안 태그:", ...proposed.map((entry) => `- ${entry.tag} (${entry.reason})`));
	}

	return { errors, pending, validated, tableMd: tableLines.join("\n"), proposed };
}

// ── notes.json (plan §3) ─────────────────────────────────────────────────────

const NOTE_FIELD_MIN_LENGTH = 1;
const NOTE_FIELD_MAX_LENGTH = 1200;
const CAPTION_MAX_LENGTH = 120;
const MAX_KEY_FRAMES_PER_UNIT = 4;

function requireBoundedLength(
	raw: unknown,
	min: number,
	max: number,
	path: string,
	errors: ValidationError[],
	message: string,
): string {
	if (typeof raw === "string" && raw.length >= min && raw.length <= max) {
		return raw;
	}
	errors.push({ path, message });
	return "";
}

/**
 * Validates notes.json against `validated` (the plan's validated units):
 * the note key set must equal the unit id set exactly, `problem`/`who`/
 * `instead` are 1–1200 characters, `detail` is optional, and `key_frames`
 * has at most 4 entries whose `candidate_id` is one of that unit's own
 * `key_frame_candidate_ids` and whose `caption` is at most 120 characters.
 */
export function checkNotes(notes: unknown, validated: ValidatedPlan): ErrorsResult {
	const errors: ValidationError[] = [];
	if (!isRecord(notes)) {
		errors.push({ path: "", message: "notes.json은 객체여야 합니다" });
		return { errors };
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
		const path = `units.${id}`;
		const entry = unitsRaw[id];
		if (!isRecord(entry)) {
			errors.push({ path, message: "노트 항목은 객체여야 합니다" });
			continue;
		}

		requireBoundedLength(
			entry.problem,
			NOTE_FIELD_MIN_LENGTH,
			NOTE_FIELD_MAX_LENGTH,
			`${path}.problem`,
			errors,
			`problem은 ${NOTE_FIELD_MIN_LENGTH}~${NOTE_FIELD_MAX_LENGTH}자여야 합니다`,
		);
		requireBoundedLength(
			entry.who,
			NOTE_FIELD_MIN_LENGTH,
			NOTE_FIELD_MAX_LENGTH,
			`${path}.who`,
			errors,
			`who는 ${NOTE_FIELD_MIN_LENGTH}~${NOTE_FIELD_MAX_LENGTH}자여야 합니다`,
		);
		requireBoundedLength(
			entry.instead,
			NOTE_FIELD_MIN_LENGTH,
			NOTE_FIELD_MAX_LENGTH,
			`${path}.instead`,
			errors,
			`instead는 ${NOTE_FIELD_MIN_LENGTH}~${NOTE_FIELD_MAX_LENGTH}자여야 합니다`,
		);
		if (entry.detail !== undefined && typeof entry.detail !== "string") {
			errors.push({ path: `${path}.detail`, message: "detail은 문자열이어야 합니다" });
		}

		const allowedCandidateIds = new Set(unit.key_frame_candidate_ids);
		if (!Array.isArray(entry.key_frames)) {
			errors.push({ path: `${path}.key_frames`, message: "key_frames는 배열이어야 합니다" });
			continue;
		}
		if (entry.key_frames.length > MAX_KEY_FRAMES_PER_UNIT) {
			errors.push({
				path: `${path}.key_frames`,
				message: `key_frames는 최대 ${MAX_KEY_FRAMES_PER_UNIT}개까지 허용됩니다`,
			});
		}
		entry.key_frames.forEach((frameRaw, frameIndex) => {
			const framePath = `${path}.key_frames[${frameIndex}]`;
			if (!isRecord(frameRaw)) {
				errors.push({ path: framePath, message: "key_frames 항목은 객체여야 합니다" });
				return;
			}
			const candidateId = typeof frameRaw.candidate_id === "string" ? frameRaw.candidate_id : "";
			if (!allowedCandidateIds.has(candidateId)) {
				errors.push({
					path: `${framePath}.candidate_id`,
					message: `unit의 key_frame_candidate_ids에 없는 후보입니다: ${candidateId}`,
				});
			}
			if (typeof frameRaw.caption !== "string" || frameRaw.caption.length > CAPTION_MAX_LENGTH) {
				errors.push({
					path: `${framePath}.caption`,
					message: `caption은 ${CAPTION_MAX_LENGTH}자 이하의 문자열이어야 합니다`,
				});
			}
		});
	}

	return { errors };
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

function isRefKind(value: unknown): value is "eafc" | "tactics" {
	return value === "eafc" || value === "tactics";
}

/**
 * Validates refs-draft.json against `validated`: urls are http(s) and
 * normalizable, `lang` is a 2-letter code, `kind` is `eafc`/`tactics`, a
 * non-`ko` lang requires `summary_ko` + at least one `key_points_ko`,
 * `translations` has at most 5 entries, `unit_ids` has at least 1 entry
 * (each must exist), and at most 3 refs per unit across the whole draft.
 */
export function checkRefsDraft(draft: unknown, validated: ValidatedPlan): ErrorsResult {
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

	return { errors };
}
