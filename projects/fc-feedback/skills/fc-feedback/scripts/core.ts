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
