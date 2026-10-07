#!/usr/bin/env bun
/**
 * fc-feedback CLI shell.
 *
 * Single entry point for the fc-feedback skill: config/init-archive (this
 * file), fetch/transcribe/scan/add-frame (this file, part 1), and the
 * check/taxonomy/similar/refs/render/publish-prep commands (part 2, not yet
 * implemented). Pure logic stays in manifest.ts (external manifest),
 * core.ts (domain rules) and media.ts (caption/ASR/ffmpeg parsing + argv
 * builders) — this file only does I/O: parsing argv, running subprocesses,
 * and reading/writing the work directory's JSON files.
 *
 * Output contract: exactly one JSON line on stdout per invocation (never
 * console.log — process.stdout.write only), diagnostics on stderr, and a
 * non-zero exit code on failure.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, posix, relative, resolve } from "node:path";

import { stringify } from "yaml";

import { getOmtDir } from "@lib/omt-dir.ts";
import { resolveSessionIdOrThrow } from "@lib/state-core.ts";

import {
	checkNotes,
	isRangeScanOfUnit,
	unitLines,
	mentionsMember,
	rawFrameCaptions,
	KEY_FRAME_TOLERANCE_SECONDS,
	checkPlan,
	checkRefsDraft,
	checkSimilarChoices,
	clockSeconds,
	closeRosterNames,
	joinWithWaGwa,
	extractYoutubeVideoId,
	dubeolsikReading,
	formatTime,
	commentAuthorName,
	selfCritiqueMemberIds,
	isValidTag,
	localLinks,
	matchGameVersion,
	refVersionBadge,
	publishedBadge,
	normalizeUrl,
	noteWarnings,
	trailingUnassignedLineWarnings,
	unmatchedTagReadingWarnings,
	recurringCandidateWarnings,
	recurringInferredActorWarnings,
	searchKeywordWords,
	parseRoster,
	parseTaxonomy,
	recurringPartialCoverageWarnings,
	recurringProClubsWarnings,
	refsMatchVersionErrors,
	refId,
	positionFromLegacyCode,
	positionTagsFromLegacy,
	positionTargetMembers,
	groupMembers,
	relatedMembers,
	similarCandidates,
	webpDimensions,
	SID_PATTERN,
	VID_PATTERN,
	type Candidate,
	type CurrentUnit,
	type Line,
	type NoteBlock,
	type Lineup,
	type NotesV2,
	type PastUnit,
	type Roster,
	type SimilarCandidate,
	type SimilarCandidatesResult,
	type Taxonomy,
	type ValidatedMatch,
	type ValidatedPlan,
	type ValidatedRecurring,
	type ValidatedTopic,
	type ValidatedUnit,
	type ValidationError,
} from "./core.ts";
import {
	MEDIA_CONSTANTS,
	buildLines,
	cwebpArgs,
	ffmpegFrameArgs,
	hasLibwebpEncoder,
	ffmpegSheetArgs,
	ffmpegWavArgs,
	mergeCandidates,
	parseJson3,
	parseShowinfo,
	parseSilencedetect,
	parseVtt,
	renumberCandidatesAcrossVideos,
	sceneArgs,
	sheetTimes,
	silencedetectArgs,
	whisperArgs,
	ytDlpArgs,
	ytChannelSearchArgs,
	ytChannelUrlArgs,
	ytSearchArgs,
	type AliasRule,
	type Candidate as ScannedCandidate,
	type ParsedCaptions,
	type SpeechMode,
	type VideoComment,
	type VideoInput,
	type WhisperSegment,
} from "./media.ts";
import { configureFc, disableFc, getFcStatus, requireConfigured, type FcStatus } from "./manifest.ts";
import {
	renderIndex,
	renderRef,
	renderSession,
	type ArchiveIndex,
	type IndexRefEntry,
	type IndexSessionEntry,
	type IndexUnitEntry,
	type RefPageData,
	type SessionData,
	type SessionMemberInfo,
	type SessionUnit,
	type UnitBodyBlock,
	type UnitRef,
	type UnitSimilar,
	type UnitStartImage,
} from "./render.ts";

// ── CLI command table ───────────────────────────────────────────────────

export interface CommandSpec {
	name: string;
	usage: string;
	description: string;
}

export const COMMANDS: readonly CommandSpec[] = [
	{ name: "config status", usage: "fc config status", description: "manifest 상태와 ffmpeg/uvx/git/deno 설치 여부를 보고한다" },
	{ name: "config set", usage: "fc config set --archive <dir> --roster <file> --pages-url <https://.../>", description: "아카이브/명단/공개 URL을 설정해 configured 모드로 전환한다" },
	{ name: "config disable", usage: "fc config disable", description: "$OMT_DIR에만 렌더하는 disabled 모드로 전환한다(기존 경로는 유지)" },
	{ name: "init-archive", usage: "fc init-archive [--archive <dir>]", description: "아카이브에 없는 파일만 생성한다(index.html/index.json/taxonomy.yaml/roster.yaml/.gitignore)" },
	{ name: "fetch", usage: "fc fetch <url...> [--cookies]", description: "yt-dlp로 영상/오디오/자막/댓글을 내려받고 session.json을 쓴다" },
	{ name: "transcribe", usage: "fc transcribe [--hq] [--captions-only] [--no-speech]", description: "whisper/자막(음성)과 타임스탬프 댓글로 lines.json을 만든다(--no-speech는 음성을 건너뛰고 댓글만)" },
	{ name: "scan", usage: "fc scan", description: "무음/장면 후보를 병합하고 미리보기·컨택트시트를 만든다" },
	{ name: "add-frame", usage: "fc add-frame --video <VID> --t <sec>", description: "수동 프레임 후보를 candidates.json에 추가하고 미리보기를 뽑는다" },
	{
		name: "scan-range",
		usage: "fc scan-range --video <VID> --from <sec> --to <sec> [--step 2]",
		description: "구간을 step초마다 훑어 kind range 후보로 candidates.json에 추가하고 미리보기와 컨택트시트 한 장을 만든다",
	},
	{ name: "check plan", usage: "fc check plan", description: "plan.json을 검증한다(exit 0 유효+plan.validated.json 생성, 2 보류, 1 무효)" },
	{ name: "check notes", usage: "fc check notes", description: "notes.json을 plan.validated.json 기준으로 검증한다(exit 0/1)" },
	{
		name: "notes next",
		usage: "fc notes next",
		description: "notes.json을 읽기만 해 다음 할 일(첫 미작성 유닛 또는 오류 유닛의 브리프, 끝났으면 완료 안내)을 낸다(exit 0, plan.validated.json 없으면 1)",
	},
	{
		name: "notes submit",
		usage: "fc notes submit <unit-id> --file <path>",
		description: "한 유닛({ unit, marker_colors?, unmatched_name_tags? })을 검증해 notes.json에 쓰고 다음 브리프를 낸다(그 유닛·match 수준 오류만 exit 1로 막고 쓰지 않는다)",
	},
	{ name: "check similar", usage: "fc check similar", description: "similar-choices.json을 similar-candidates.json 기준으로 검증한다(exit 0/1)" },
	{ name: "check refs", usage: "fc check refs", description: "refs-draft.json을 plan.validated.json 기준으로 검증한다(exit 0/1)" },
	{
		name: "refs-bundle",
		usage: "fc refs-bundle [--no-search]",
		description: "참고자료 리뷰용 refs-review.md를 쓴다(자료×유닛마다 원문 줄·relevance_ko·lesson_ko·video_starts 앞뒤 90초 자막, 붙은 채널의 같은 채널 후보 검색은 --no-search로 끈다)",
	},
	{ name: "taxonomy add", usage: "fc taxonomy add <tag...>", description: "taxonomy에 태그를 append-only·멱등으로 추가한다" },
	{ name: "frames", usage: "fc frames", description: "검증된 유닛마다 시작 프레임과 notes의 핵심 프레임을 webp로 추출한다" },
	{ name: "similar", usage: "fc similar", description: "아카이브 index.json을 기준으로 similar-candidates.json을 만든다" },
	{ name: "verify-refs", usage: "fc verify-refs", description: "refs-draft.json의 URL을 정규화·검증해 refs.verified.json을 쓴다" },
	{
		name: "render",
		usage: "fc render [--site-only]",
		description: "plan/notes/similar/refs를 재검증한 뒤 세션을 렌더한다(configured면 아카이브+index.json, disabled/--site-only면 <work>/site/)",
	},
	{
		name: "publish-prep",
		usage: "fc publish-prep",
		description: "링크 검사와 git status --porcelain을 보고하고 커밋/푸시 명령을 제안한다(commit/push는 하지 않는다)",
	},
];

// ── unknown-narrowing + small validators ────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`fc-feedback: ${field}은(는) 비어 있지 않은 문자열이어야 합니다`);
	}
	return value;
}

function num(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`fc-feedback: ${field}은(는) 숫자여야 합니다`);
	}
	return value;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`fc-feedback: ${field}은(는) 배열이어야 합니다`);
	}
	return value.map((item, index) => str(item, `${field}[${index}]`));
}

function readJsonFile(path: string, label: string): unknown {
	if (!existsSync(path)) {
		throw new Error(`fc-feedback: ${label}이(가) 없습니다: ${path}`);
	}
	return JSON.parse(readFileSync(path, "utf8"));
}

// ── argv parsing ─────────────────────────────────────────────────────────

function takeFlag(args: readonly string[], flag: string): { value: boolean; rest: string[] } {
	const rest: string[] = [];
	let value = false;
	for (const arg of args) {
		if (arg === flag) {
			value = true;
			continue;
		}
		rest.push(arg);
	}
	return { value, rest };
}

function takeOption(args: readonly string[], flag: string): { value: string | undefined; rest: string[] } {
	const rest: string[] = [];
	let value: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === flag) {
			value = args[i + 1];
			i++;
			continue;
		}
		rest.push(args[i]);
	}
	return { value, rest };
}

function matchCommand(tokens: readonly string[]): { name: string; rest: string[] } | undefined {
	const two = tokens.slice(0, 2).join(" ");
	if (COMMANDS.some((command) => command.name === two)) {
		return { name: two, rest: tokens.slice(2) };
	}
	const one = tokens[0];
	if (one !== undefined && COMMANDS.some((command) => command.name === one)) {
		return { name: one, rest: tokens.slice(1) };
	}
	return undefined;
}

function printJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

// ── tool availability (config status) ───────────────────────────────────

function toolAvailability(): { ffmpeg: boolean; cwebp: boolean; uvx: boolean; git: boolean; deno: boolean } {
	return {
		ffmpeg: Bun.which("ffmpeg") !== null,
		// frames가 ffmpeg에 libwebp 인코더가 없을 때 쓰는 대체 인코더
		cwebp: Bun.which("cwebp") !== null,
		uvx: Bun.which("uvx") !== null,
		git: Bun.which("git") !== null,
		deno: Bun.which("deno") !== null,
	};
}

// ── work dir + disabled-mode taxonomy seed (plan §13.1-2) ───────────────

const TAXONOMY_DEFAULT_PATH = join(import.meta.dir, "taxonomy.default.yaml");

function resolveWorkDir(explicit: string | undefined): string {
	if (explicit !== undefined) {
		return resolve(explicit);
	}
	return join(getOmtDir(), "fc-feedback", resolveSessionIdOrThrow());
}

function resolveArchiveDir(explicit: string | undefined, status: FcStatus): string {
	if (explicit !== undefined) {
		return resolve(explicit);
	}
	if (status.status === "configured") {
		return status.archive_repo_path;
	}
	if (status.status === "disabled" && status.archive_repo_path !== undefined) {
		return status.archive_repo_path;
	}
	throw new Error("fc-feedback: --archive를 지정하거나 config set으로 아카이브 경로를 설정하세요");
}

/** Disabled mode copies the bundled default taxonomy into the work dir on first touch (plan §13.1-2). */
function ensureWorkDir(workDir: string, status: FcStatus): void {
	mkdirSync(workDir, { recursive: true });
	if (status.mode === "disabled") {
		const dest = join(workDir, "taxonomy.yaml");
		if (!existsSync(dest)) {
			copyFileSync(TAXONOMY_DEFAULT_PATH, dest);
		}
	}
}

// ── taxonomy/roster data sources (plan §12-2, §13.1-2) ───────────────────
//
// configured mode reads/writes the archive's taxonomy.yaml; every other mode
// (disabled, unconfigured) reads/writes the work dir's own copy (seeded from
// the bundled default by ensureWorkDir, never the bundled file itself).
// roster comes from manifest.roster_path when set, otherwise there is no
// roster (member_ids must then be empty — enforced by core.checkPlan).

function taxonomyPath(workDir: string, status: FcStatus): string {
	return status.mode === "configured" ? join(status.archive_repo_path, "taxonomy.yaml") : join(workDir, "taxonomy.yaml");
}

function loadTaxonomy(workDir: string, status: FcStatus): Taxonomy {
	const path = taxonomyPath(workDir, status);
	if (!existsSync(path)) {
		throw new Error(`fc-feedback: taxonomy.yaml이 없습니다: ${path}`);
	}
	const parsed = parseTaxonomy(readFileSync(path, "utf8"));
	if (!parsed.ok) {
		throw new Error(
			`fc-feedback: taxonomy.yaml이 유효하지 않습니다: ${parsed.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`,
		);
	}
	return parsed.value;
}

function loadRoster(status: FcStatus): Roster | null {
	const rosterPath = status.mode === "configured" || status.mode === "disabled" ? status.roster_path : undefined;
	if (rosterPath === undefined) {
		return null;
	}
	const parsed = parseRoster(readFileSync(rosterPath, "utf8"));
	if (!parsed.ok) {
		throw new Error(
			`fc-feedback: roster.yaml이 유효하지 않습니다: ${parsed.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`,
		);
	}
	return parsed.value;
}

// ── config commands ──────────────────────────────────────────────────────

function handleConfigSet(rest: readonly string[]): FcStatus {
	const { value: archive, rest: r1 } = takeOption(rest, "--archive");
	const { value: roster, rest: r2 } = takeOption(r1, "--roster");
	const { value: pagesUrl } = takeOption(r2, "--pages-url");
	if (archive === undefined) {
		throw new Error("fc-feedback: config set에는 --archive가 필요합니다");
	}
	if (roster === undefined) {
		throw new Error("fc-feedback: config set에는 --roster가 필요합니다");
	}
	if (pagesUrl === undefined) {
		throw new Error("fc-feedback: config set에는 --pages-url이 필요합니다");
	}
	return configureFc({ archive, roster, pagesUrl });
}

// ── init-archive ──────────────────────────────────────────────────────────

function emptyIndexHtml(): string {
	return renderIndex({ version: 1, updated_at: new Date().toISOString(), sessions: [], units: [], refs: [] });
}

const ROSTER_TEMPLATE = `# fc-feedback roster.yaml
# members: 각 항목은 id(소문자/숫자/하이픈 시작), name, gamertag(대소문자 무시 유일),
# positions(최소 1개, 포지션 트리 태그: GK/DF/MF/FW 또는
# CB/FB/WB/CDM/CM/CAM/SM/WF/ST — 좌우는 가리지 않는다),
# aliases(옵션, 다른 멤버의 name/alias와 겹치면 안 됨)로 구성됩니다.
#
# 예시:
# members:
#   - id: hong-gildong
#     name: 홍길동
#     gamertag: HongGD
#     positions: [CB]
#     aliases: [길동]
members: []
`;

interface InitArchiveResult {
	archive: string;
	created: string[];
	skipped: string[];
}

function cmdInitArchive(archiveDir: string): InitArchiveResult {
	mkdirSync(archiveDir, { recursive: true });
	const created: string[] = [];
	const skipped: string[] = [];

	const files: { name: string; content: () => string }[] = [
		{ name: "index.html", content: emptyIndexHtml },
		{
			name: "index.json",
			content: () =>
				`${JSON.stringify({ version: 1, updated_at: new Date().toISOString(), sessions: [], units: [], refs: [] }, null, 2)}\n`,
		},
		{ name: "taxonomy.yaml", content: () => readFileSync(TAXONOMY_DEFAULT_PATH, "utf8") },
		{ name: "roster.yaml", content: () => ROSTER_TEMPLATE },
		{ name: ".gitignore", content: () => ".claude/\n.omt/\n" },
	];

	for (const file of files) {
		const path = join(archiveDir, file.name);
		if (existsSync(path)) {
			skipped.push(file.name);
			continue;
		}
		writeFileSync(path, file.content());
		created.push(file.name);
	}

	// robots.txt is deliberately never created: a robots.txt under a GitHub
	// Pages project subpath has no effect (plan §12-14). noindex meta suffices.
	return { archive: archiveDir, created, skipped };
}

// ── subprocess runner ────────────────────────────────────────────────────

interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

async function runCommand(argv: readonly string[]): Promise<RunResult> {
	const proc = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

function looksLikeBotCheck(stderr: string): boolean {
	return /sign in to confirm/i.test(stderr);
}

/** Runs one yt-dlp argv, retrying once with cookies if the first attempt looks like a bot check. */
async function runYtDlpWithRetry(
	kind: "meta" | "captions" | "audio" | "video",
	url: string,
	dir: string,
	cookies: boolean,
): Promise<{ result: RunResult; usedCookies: boolean }> {
	let usedCookies = cookies;
	let result = await runCommand(ytDlpArgs(kind, url, dir, usedCookies));
	if (result.exitCode !== 0 && !usedCookies && looksLikeBotCheck(result.stderr)) {
		usedCookies = true;
		result = await runCommand(ytDlpArgs(kind, url, dir, usedCookies));
	}
	return { result, usedCookies };
}

// ── session.json shape (plan §3) ─────────────────────────────────────────

interface VideoFiles {
	audio: string;
	video: string;
	captions: string | null;
	captions_format: "json3" | "vtt" | null;
	wav: string | null;
	comments: string | null;
}

interface SessionVideo {
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

interface SessionFile {
	version: 1;
	session_id: string;
	created_at: string;
	videos: SessionVideo[];
}

function toVideoFiles(raw: unknown): VideoFiles {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: session.json의 files가 올바르지 않습니다");
	}
	const captionsFormat = raw.captions_format;
	if (captionsFormat !== null && captionsFormat !== "json3" && captionsFormat !== "vtt") {
		throw new Error("fc-feedback: session.json의 files.captions_format이 올바르지 않습니다");
	}
	const captions = raw.captions;
	const wav = raw.wav;
	// session.json written before comment support has no `comments` key: no comments file was fetched.
	const comments = raw.comments;
	return {
		audio: str(raw.audio, "files.audio"),
		video: str(raw.video, "files.video"),
		captions: captions === null || captions === undefined ? null : str(captions, "files.captions"),
		captions_format: captionsFormat,
		wav: wav === null || wav === undefined ? null : str(wav, "files.wav"),
		comments: comments === null || comments === undefined ? null : str(comments, "files.comments"),
	};
}

function toSessionVideo(raw: unknown): SessionVideo {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: session.json의 videos 항목이 올바르지 않습니다");
	}
	return {
		id: str(raw.id, "video.id"),
		url: str(raw.url, "video.url"),
		part: num(raw.part, "video.part"),
		title: str(raw.title, "video.title"),
		channel: typeof raw.channel === "string" ? raw.channel : "",
		upload_date: str(raw.upload_date, "video.upload_date"),
		duration: num(raw.duration, "video.duration"),
		embeddable: optionalBool(raw.embeddable, true),
		width: num(raw.width, "video.width"),
		height: num(raw.height, "video.height"),
		files: toVideoFiles(raw.files),
	};
}

function readSessionFile(workDir: string): SessionFile {
	const path = join(workDir, "session.json");
	if (!existsSync(path)) {
		throw new Error("fc-feedback: session.json이 없습니다 — 먼저 fetch를 실행하세요");
	}
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isRecord(raw) || !Array.isArray(raw.videos)) {
		throw new Error("fc-feedback: session.json 형식이 올바르지 않습니다");
	}
	return {
		version: 1,
		session_id: str(raw.session_id, "session_id"),
		created_at: str(raw.created_at, "created_at"),
		videos: raw.videos.map(toSessionVideo),
	};
}

function writeSessionFile(workDir: string, session: SessionFile): void {
	writeFileSync(join(workDir, "session.json"), `${JSON.stringify(session, null, 2)}\n`);
}

// ── fetch ─────────────────────────────────────────────────────────────────

function parseYtDlpMeta(stdout: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(stdout);
	if (!isRecord(parsed)) {
		throw new Error("fc-feedback: yt-dlp metadata가 JSON 객체가 아닙니다");
	}
	return parsed;
}

/** The width/height of the best video-only stream at or below `MEDIA_CONSTANTS.yt.maxVideoHeight` — the stream `fetch` downloads. */
function pickVideoDims(meta: Record<string, unknown>): { width: number; height: number } {
	const formats = Array.isArray(meta.formats) ? meta.formats : [];
	let best: { width: number; height: number } | undefined;
	for (const entry of formats) {
		if (!isRecord(entry)) {
			continue;
		}
		const height = entry.height;
		const width = entry.width;
		if (typeof height !== "number" || typeof width !== "number") {
			continue;
		}
		if (height > MEDIA_CONSTANTS.yt.maxVideoHeight) {
			continue;
		}
		if (best === undefined || height > best.height) {
			best = { width, height };
		}
	}
	if (best === undefined) {
		throw new Error(`fc-feedback: metadata에서 ${MEDIA_CONSTANTS.yt.maxVideoHeight}p 이하 비디오 스트림을 찾을 수 없습니다`);
	}
	return best;
}

function toVideoComment(raw: unknown): VideoComment {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: yt-dlp 댓글 항목이 올바르지 않습니다");
	}
	return {
		id: str(raw.id, "comment.id"),
		parent: typeof raw.parent === "string" ? raw.parent : "root",
		author: typeof raw.author === "string" ? raw.author : "",
		text: typeof raw.text === "string" ? raw.text : "",
	};
}

function readComments(workDir: string, file: string | null): VideoComment[] {
	if (file === null) {
		return [];
	}
	const raw: unknown = JSON.parse(readFileSync(join(workDir, file), "utf8"));
	if (!Array.isArray(raw)) {
		throw new Error(`fc-feedback: 댓글 파일 형식이 올바르지 않습니다: ${file}`);
	}
	return raw.map(toVideoComment);
}

function findMediaFile(dir: string, id: string): string | null {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return null;
	}
	const match = entries.find((name) => name.startsWith(`${id}.`));
	return match !== undefined ? join(dir, match) : null;
}

function findCaptionFile(dir: string, id: string): { path: string; format: "json3" | "vtt" } | null {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return null;
	}
	const matches = entries.filter((name) => name.startsWith(`${id}.`));
	const json3 = matches.find((name) => name.endsWith(".json3"));
	if (json3 !== undefined) {
		return { path: join(dir, json3), format: "json3" };
	}
	const vtt = matches.find((name) => name.endsWith(".vtt"));
	if (vtt !== undefined) {
		return { path: join(dir, vtt), format: "vtt" };
	}
	return null;
}

async function cmdFetch(
	urls: readonly string[],
	options: { cookies: boolean },
	workDir: string,
	status: FcStatus,
): Promise<{ session_id: string; videos: number; work: string }> {
	if (urls.length === 0) {
		throw new Error("fc-feedback: fetch에는 URL이 최소 1개 필요합니다");
	}
	ensureWorkDir(workDir, status);

	const mediaDir = join(workDir, "media");
	const videoDir = join(mediaDir, "video");
	const audioDir = join(mediaDir, "audio");
	const capDir = join(mediaDir, "captions");
	const commentsDir = join(mediaDir, "comments");
	for (const dir of [videoDir, audioDir, capDir, commentsDir]) {
		mkdirSync(dir, { recursive: true });
	}

	const videos: SessionVideo[] = [];
	let firstId: string | undefined;
	let uploadDate: string | undefined;

	for (let index = 0; index < urls.length; index++) {
		const url = urls[index];
		const part = index + 1;
		let cookies = options.cookies;

		const metaRun = await runYtDlpWithRetry("meta", url, mediaDir, cookies);
		if (metaRun.result.exitCode !== 0) {
			throw new Error(`fc-feedback: yt-dlp meta 실패(${url}): ${metaRun.result.stderr.trim()}`);
		}
		cookies = metaRun.usedCookies;
		const meta = parseYtDlpMeta(metaRun.result.stdout);
		const comments = (Array.isArray(meta.comments) ? meta.comments : []).map(toVideoComment);

		const id = str(meta.id, "id");
		if (!VID_PATTERN.test(id)) {
			throw new Error(`fc-feedback: 비디오 id 형식이 아닙니다: ${id}`);
		}
		const videoUploadDate = str(meta.upload_date, "upload_date");
		if (part === 1) {
			firstId = id;
			uploadDate = videoUploadDate;
		}

		const captionsRun = await runYtDlpWithRetry("captions", url, capDir, cookies);
		if (captionsRun.result.exitCode !== 0) {
			throw new Error(`fc-feedback: yt-dlp captions 실패(${url}): ${captionsRun.result.stderr.trim()}`);
		}
		cookies = captionsRun.usedCookies;

		const audioRun = await runYtDlpWithRetry("audio", url, audioDir, cookies);
		if (audioRun.result.exitCode !== 0) {
			throw new Error(`fc-feedback: yt-dlp audio 실패(${url}): ${audioRun.result.stderr.trim()}`);
		}
		cookies = audioRun.usedCookies;

		const videoRun = await runYtDlpWithRetry("video", url, videoDir, cookies);
		if (videoRun.result.exitCode !== 0) {
			throw new Error(`fc-feedback: yt-dlp video 실패(${url}): ${videoRun.result.stderr.trim()}`);
		}

		const captionFile = findCaptionFile(capDir, id);
		const audioFile = findMediaFile(audioDir, id);
		const videoFile = findMediaFile(videoDir, id);
		if (audioFile === null) {
			throw new Error(`fc-feedback: 오디오 파일을 찾을 수 없습니다: ${id}`);
		}
		if (videoFile === null) {
			throw new Error(`fc-feedback: 비디오 파일을 찾을 수 없습니다: ${id}`);
		}

		const dims = pickVideoDims(meta);
		const commentsFile = join(commentsDir, `${id}.json`);
		writeFileSync(commentsFile, `${JSON.stringify(comments, null, 2)}\n`);

		videos.push({
			id,
			url,
			part,
			title: str(meta.title, "title"),
			channel: optionalString(meta.channel) ?? optionalString(meta.uploader) ?? "",
			upload_date: videoUploadDate,
			duration: num(meta.duration, "duration"),
			embeddable: optionalBool(meta.playable_in_embed, true),
			width: dims.width,
			height: dims.height,
			files: {
				audio: relative(workDir, audioFile),
				video: relative(workDir, videoFile),
				captions: captionFile !== null ? relative(workDir, captionFile.path) : null,
				captions_format: captionFile !== null ? captionFile.format : null,
				wav: null,
				comments: relative(workDir, commentsFile),
			},
		});
	}

	if (firstId === undefined || uploadDate === undefined) {
		throw new Error("fc-feedback: 첫 번째 영상 정보를 확인할 수 없습니다");
	}
	const sessionId = `${uploadDate}-${firstId}`;
	if (!SID_PATTERN.test(sessionId)) {
		throw new Error(`fc-feedback: session id 형식이 아닙니다: ${sessionId}`);
	}

	writeSessionFile(workDir, { version: 1, session_id: sessionId, created_at: new Date().toISOString(), videos });

	return { session_id: sessionId, videos: videos.length, work: workDir };
}

async function handleFetch(rest: readonly string[], workDir: string, status: FcStatus): Promise<unknown> {
	const { value: cookies, rest: urls } = takeFlag(rest, "--cookies");
	return cmdFetch(urls, { cookies }, workDir, status);
}

// ── transcribe ────────────────────────────────────────────────────────────

function loadAliases(rosterPath: string): AliasRule[] {
	const parsed = parseRoster(readFileSync(rosterPath, "utf8"));
	if (!parsed.ok) {
		throw new Error(`fc-feedback: roster.yaml이 유효하지 않습니다: ${parsed.errors.map((error) => error.message).join("; ")}`);
	}
	const aliases: AliasRule[] = [];
	for (const member of parsed.value.members) {
		for (const alias of member.aliases) {
			aliases.push({ alias, name: member.name });
		}
	}
	return aliases;
}

function toWhisperSegment(raw: unknown): WhisperSegment {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: whisper 세그먼트 형식이 올바르지 않습니다");
	}
	return {
		start: num(raw.start, "segment.start"),
		end: num(raw.end, "segment.end"),
		text: typeof raw.text === "string" ? raw.text : "",
		compression_ratio: num(raw.compression_ratio, "segment.compression_ratio"),
	};
}

function readWhisperSegments(path: string): WhisperSegment[] {
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isRecord(raw) || !Array.isArray(raw.segments)) {
		throw new Error("fc-feedback: whisper 출력 형식이 올바르지 않습니다");
	}
	return raw.segments.map(toWhisperSegment);
}

async function cmdTranscribe(
	options: { hq: boolean; captionsOnly: boolean; noSpeech: boolean },
	workDir: string,
	status: FcStatus,
): Promise<unknown> {
	ensureWorkDir(workDir, status);
	if (options.noSpeech && (options.hq || options.captionsOnly)) {
		throw new Error("fc-feedback: --no-speech는 음성을 건너뛰므로 --hq/--captions-only와 함께 쓸 수 없습니다");
	}
	const session = readSessionFile(workDir);

	// darwin/arm64만 whisper를 실행한다(plan §4-A) — 그 외는 자막 전용 모드로 내려간다.
	// --no-speech는 해설 음성이 없는 영상용이다: wav/whisper/자막을 모두 건너뛰고 댓글 줄만 만든다.
	const isDarwinArm64 = process.platform === "darwin" && process.arch === "arm64";
	const runWhisper = !options.noSpeech && !options.captionsOnly && isDarwinArm64;
	const mode: SpeechMode = options.noSpeech ? "none" : runWhisper ? "asr" : "captions";

	const wavDir = join(workDir, "media", "wav");
	mkdirSync(wavDir, { recursive: true });
	const asrDir = join(workDir, "asr");
	if (runWhisper) {
		mkdirSync(asrDir, { recursive: true });
	}

	// disabled 모드 또는 명단이 없으면 alias 정규화를 생략한다(plan §12-2).
	const aliases = status.mode === "configured" ? loadAliases(status.roster_path) : [];

	const videos: VideoInput[] = [];
	const updatedVideos: SessionVideo[] = [];

	for (const video of session.videos) {
		const comments = readComments(workDir, video.files.comments);
		if (mode === "none") {
			videos.push({ id: video.id, part: video.part, duration: video.duration, whisperSegments: null, captions: null, comments });
			updatedVideos.push(video);
			continue;
		}
		const audioPath = join(workDir, video.files.audio);
		const wavPath = join(wavDir, `${video.id}.wav`);
		const wavResult = await runCommand(ffmpegWavArgs(audioPath, wavPath));
		if (wavResult.exitCode !== 0) {
			throw new Error(`fc-feedback: ffmpeg wav 변환 실패(${video.id}): ${wavResult.stderr.trim()}`);
		}

		let whisperSegments: WhisperSegment[] | null = null;
		if (runWhisper) {
			const whisperResult = await runCommand(whisperArgs(wavPath, asrDir, video.id, options.hq));
			if (whisperResult.exitCode !== 0) {
				throw new Error(`fc-feedback: whisper 실패(${video.id}): ${whisperResult.stderr.trim()}`);
			}
			whisperSegments = readWhisperSegments(join(asrDir, `${video.id}.json`));
		}

		let captions: ParsedCaptions | null = null;
		if (video.files.captions !== null && video.files.captions_format !== null) {
			const captionText = readFileSync(join(workDir, video.files.captions), "utf8");
			captions = video.files.captions_format === "json3" ? parseJson3(captionText) : parseVtt(captionText);
		}

		videos.push({ id: video.id, part: video.part, duration: video.duration, whisperSegments, captions, comments });
		updatedVideos.push({ ...video, files: { ...video.files, wav: relative(workDir, wavPath) } });
	}

	const built = buildLines({ videos, aliases, mode });

	writeFileSync(join(workDir, "lines.json"), `${JSON.stringify(built.lines, null, 2)}\n`);
	writeSessionFile(workDir, { ...session, videos: updatedVideos });

	return built.stats;
}

async function handleTranscribe(rest: readonly string[], workDir: string, status: FcStatus): Promise<unknown> {
	const { value: hq, rest: r1 } = takeFlag(rest, "--hq");
	const { value: captionsOnly, rest: r2 } = takeFlag(r1, "--captions-only");
	const { value: noSpeech } = takeFlag(r2, "--no-speech");
	return cmdTranscribe({ hq, captionsOnly, noSpeech }, workDir, status);
}

// ── scan ──────────────────────────────────────────────────────────────────

// 후보/컨택트시트 프레임 간격(plan §4-B "30s 간격"). media.ts의 알고리즘 상수가 아니라
// scan 오케스트레이션 고유 값이라 여기 둔다.
const CANDIDATE_INTERVAL_SECONDS = 30;

function parseTile(tile: string): { cols: number; rows: number } {
	const match = tile.match(/^(\d+)x(\d+)$/);
	if (match === null) {
		throw new Error(`fc-feedback: tile 형식이 올바르지 않습니다: ${tile}`);
	}
	return { cols: Number(match[1]), rows: Number(match[2]) };
}

interface SheetEntry {
	file: string;
	video: string;
	kind: "grid" | "hud";
	cols: number;
	rows: number;
	times: number[];
}

async function cmdScan(workDir: string, status: FcStatus): Promise<{ candidates: number; sheets: number }> {
	ensureWorkDir(workDir, status);
	const session = readSessionFile(workDir);

	const candDir = join(workDir, "cand");
	const sheetsDir = join(workDir, "sheets");
	mkdirSync(candDir, { recursive: true });
	mkdirSync(sheetsDir, { recursive: true });

	const perVideo: { video: string; part: number; candidates: ScannedCandidate[] }[] = [];
	// 댓글 시각마다 그 순간의 프레임 후보를 둔다 — transcribe 전이면(lines.json 없음) 댓글 후보는 없다.
	const lines = existsSync(join(workDir, "lines.json")) ? readLines(workDir) : [];

	for (const video of session.videos) {
		const videoPath = join(workDir, video.files.video);
		const silenceResult = await runCommand(silencedetectArgs(videoPath));
		const silences = parseSilencedetect(silenceResult.stderr);
		const sceneResult = await runCommand(sceneArgs(videoPath));
		const scenes = parseShowinfo(sceneResult.stderr);
		const comments = lines.filter((line) => line.video === video.id && line.source === "comment").map((line) => line.start);
		const candidates = mergeCandidates(
			{ silences, scenes, comments, duration: video.duration, interval: CANDIDATE_INTERVAL_SECONDS },
			video.id,
		);
		perVideo.push({ video: video.id, part: video.part, candidates });
	}

	const allCandidates = renumberCandidatesAcrossVideos(perVideo);
	writeFileSync(join(workDir, "candidates.json"), `${JSON.stringify(allCandidates, null, 2)}\n`);

	for (const candidate of allCandidates) {
		const video = session.videos.find((entry) => entry.id === candidate.video);
		if (video === undefined) {
			continue;
		}
		const videoPath = join(workDir, video.files.video);
		const out = join(candDir, `${candidate.id}.jpg`);
		const frameResult = await runCommand(ffmpegFrameArgs(videoPath, candidate.t, out));
		if (frameResult.exitCode !== 0) {
			throw new Error(`fc-feedback: 프레임 추출 실패(${candidate.id}): ${frameResult.stderr.trim()}`);
		}
	}

	const sheets: SheetEntry[] = [];
	for (const video of session.videos) {
		const videoPath = join(workDir, video.files.video);
		for (const kind of ["grid", "hud"] as const) {
			const { cols, rows } = parseTile(MEDIA_CONSTANTS.sheet[kind].tile);
			const times = sheetTimes(video.duration, CANDIDATE_INTERVAL_SECONDS, cols, rows);
			const pattern = join(sheetsDir, `${video.id}-${kind}-%03d.jpg`);
			const sheetResult = await runCommand(ffmpegSheetArgs(videoPath, kind, pattern));
			if (sheetResult.exitCode !== 0) {
				throw new Error(`fc-feedback: 시트 생성 실패(${video.id}/${kind}): ${sheetResult.stderr.trim()}`);
			}
			times.forEach((frameTimes, index) => {
				sheets.push({
					file: `${video.id}-${kind}-${String(index).padStart(3, "0")}.jpg`,
					video: video.id,
					kind,
					cols,
					rows,
					times: frameTimes,
				});
			});
		}
	}

	writeFileSync(join(workDir, "sheets.json"), `${JSON.stringify({ version: 1, sheets }, null, 2)}\n`);

	return { candidates: allCandidates.length, sheets: sheets.length };
}

// ── add-frame ────────────────────────────────────────────────────────────

function toCandidate(raw: unknown): Candidate {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: candidates.json 항목이 올바르지 않습니다");
	}
	const kind = raw.kind;
	if (kind !== "comment" && kind !== "silence" && kind !== "scene" && kind !== "interval" && kind !== "manual" && kind !== "range") {
		throw new Error("fc-feedback: candidates.json의 kind가 올바르지 않습니다");
	}
	const dur = raw.dur;
	return {
		id: str(raw.id, "candidate.id"),
		video: str(raw.video, "candidate.video"),
		t: num(raw.t, "candidate.t"),
		kind,
		...(typeof dur === "number" ? { dur } : {}),
	};
}

function toLine(raw: unknown): Line {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: lines.json 항목이 올바르지 않습니다");
	}
	const base = {
		i: num(raw.i, "line.i"),
		video: str(raw.video, "line.video"),
		start: num(raw.start, "line.start"),
		end: num(raw.end, "line.end"),
		text: str(raw.text, "line.text"),
	};
	// lines.json written before comment support has no `source`: every line then was speech.
	return raw.source === "comment" ? { ...base, source: "comment", author: str(raw.author, "line.author") } : { ...base, source: "speech" };
}

/** lines.json is script-generated (transcribe) — this is structural coercion, not core.checkLines revalidation. */
function readLines(workDir: string): Line[] {
	const path = join(workDir, "lines.json");
	if (!existsSync(path)) {
		throw new Error("fc-feedback: lines.json이 없습니다 — 먼저 transcribe를 실행하세요");
	}
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!Array.isArray(raw)) {
		throw new Error("fc-feedback: lines.json 형식이 올바르지 않습니다");
	}
	return raw.map(toLine);
}

function readCandidates(workDir: string): Candidate[] {
	const path = join(workDir, "candidates.json");
	if (!existsSync(path)) {
		return [];
	}
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!Array.isArray(raw)) {
		throw new Error("fc-feedback: candidates.json 형식이 올바르지 않습니다");
	}
	return raw.map(toCandidate);
}

async function cmdAddFrame(
	options: { video: string; t: number; kind: "manual" | "range" },
	workDir: string,
	status: FcStatus,
): Promise<Candidate> {
	ensureWorkDir(workDir, status);
	if (!VID_PATTERN.test(options.video)) {
		throw new Error(`fc-feedback: video id 형식이 아닙니다: ${options.video}`);
	}
	if (!Number.isFinite(options.t) || options.t < 0) {
		throw new Error("fc-feedback: --t는 0 이상의 숫자여야 합니다");
	}

	const session = readSessionFile(workDir);
	const video = session.videos.find((entry) => entry.id === options.video);
	if (video === undefined) {
		throw new Error(`fc-feedback: session.json에 없는 video id입니다: ${options.video}`);
	}

	const existing = readCandidates(workDir);
	const candidate: Candidate = {
		id: `c${String(existing.length + 1).padStart(3, "0")}`,
		video: options.video,
		t: options.t,
		kind: options.kind,
	};
	writeFileSync(join(workDir, "candidates.json"), `${JSON.stringify([...existing, candidate], null, 2)}\n`);

	const candDir = join(workDir, "cand");
	mkdirSync(candDir, { recursive: true });
	const out = join(candDir, `${candidate.id}.jpg`);
	const videoPath = join(workDir, video.files.video);
	const frameResult = await runCommand(ffmpegFrameArgs(videoPath, options.t, out));
	if (frameResult.exitCode !== 0) {
		throw new Error(`fc-feedback: 프레임 추출 실패(${candidate.id}): ${frameResult.stderr.trim()}`);
	}

	return candidate;
}

async function handleAddFrame(rest: readonly string[], workDir: string, status: FcStatus): Promise<unknown> {
	const { value: videoId, rest: r1 } = takeOption(rest, "--video");
	const { value: tRaw } = takeOption(r1, "--t");
	if (videoId === undefined) {
		throw new Error("fc-feedback: add-frame에는 --video가 필요합니다");
	}
	if (tRaw === undefined) {
		throw new Error("fc-feedback: add-frame에는 --t가 필요합니다");
	}
	const t = Number(tRaw);
	if (!Number.isFinite(t)) {
		throw new Error(`fc-feedback: --t는 숫자여야 합니다: ${tRaw}`);
	}
	return cmdAddFrame({ video: videoId, t, kind: "manual" }, workDir, status);
}

// ── scan-range ───────────────────────────────────────────────────────────
//
// `check notes` accepts "no frame shows this person" only when the unit's window was scanned: scan-range
// pulls a frame every `step` seconds over [from, to] as `kind: "range"` candidates (the same extraction
// as add-frame) and tiles the whole range into one contact sheet so an agent sees every frame at once.

const MAX_RANGE_FRAMES = 36;
const MAX_RANGE_SHEET_COLS = 6;
const DEFAULT_RANGE_STEP_SECONDS = 2;

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/** Frame times `from, from+step, …` that do not pass `to`. Throws on a bad range/step or more than `MAX_RANGE_FRAMES` frames. */
export function rangeFrameTimes(from: number, to: number, step: number): number[] {
	if (!Number.isFinite(from) || from < 0) {
		throw new Error("fc-feedback: --from은 0 이상의 숫자여야 합니다");
	}
	if (!Number.isFinite(to) || to < from) {
		throw new Error("fc-feedback: --to는 --from 이상의 숫자여야 합니다");
	}
	if (!Number.isFinite(step) || step <= 0) {
		throw new Error("fc-feedback: --step은 0보다 큰 숫자여야 합니다");
	}
	const count = Math.floor((to - from) / step + 1e-9) + 1;
	if (count > MAX_RANGE_FRAMES) {
		throw new Error(`fc-feedback: 프레임이 ${count}장이라 한 장에 담을 수 없습니다(최대 ${MAX_RANGE_FRAMES}장) — --step을 키우거나 구간을 나눠 훑으세요`);
	}
	return Array.from({ length: count }, (_, k) => round3(from + k * step));
}

function rangeSheetLayout(count: number): { cols: number; rows: number } {
	const cols = Math.min(count, MAX_RANGE_SHEET_COLS);
	return { cols, rows: Math.ceil(count / cols) };
}

/** Contact-sheet argv for one range: seek to `from`, take a frame every `step` seconds, scale like the grid sheet, tile into one image. */
export function rangeSheetArgs(video: string, from: number, to: number, step: number, out: string): string[] {
	const { cols, rows } = rangeSheetLayout(rangeFrameTimes(from, to, step).length);
	const filter = `fps=1/${step},scale=${MEDIA_CONSTANTS.sheet.grid.scale},tile=${cols}x${rows}`;
	// `-t` runs half a step past `to` so a frame landing exactly on `to` is kept and the next one is not.
	return ["ffmpeg", "-y", "-ss", String(from), "-t", String(round3(to - from + step / 2)), "-i", video, "-vf", filter, "-frames:v", "1", out];
}

async function cmdScanRange(
	options: { video: string; from: number; to: number; step: number },
	workDir: string,
	status: FcStatus,
): Promise<{ video: string; from: number; to: number; step: number; candidates: { id: string; t: number }[]; sheet: string; cols: number; rows: number }> {
	ensureWorkDir(workDir, status);
	if (!VID_PATTERN.test(options.video)) {
		throw new Error(`fc-feedback: video id 형식이 아닙니다: ${options.video}`);
	}
	const times = rangeFrameTimes(options.from, options.to, options.step);
	const session = readSessionFile(workDir);
	const video = session.videos.find((entry) => entry.id === options.video);
	if (video === undefined) {
		throw new Error(`fc-feedback: session.json에 없는 video id입니다: ${options.video}`);
	}
	if (options.to > video.duration) {
		throw new Error(`fc-feedback: --to ${options.to}초가 영상 길이(${video.duration}초)를 넘습니다`);
	}

	const candidates: { id: string; t: number }[] = [];
	for (const t of times) {
		// A range candidate already at this time (an earlier scan-range over an overlapping range) is reused, not added twice.
		const known = readCandidates(workDir).find((candidate) => candidate.kind === "range" && candidate.video === video.id && candidate.t === t);
		const candidate = known ?? (await cmdAddFrame({ video: video.id, t, kind: "range" }, workDir, status));
		candidates.push({ id: candidate.id, t });
	}

	const sheetsDir = join(workDir, "sheets");
	mkdirSync(sheetsDir, { recursive: true });
	const sheetName = `${video.id}-range-${options.from}-${options.to}.jpg`;
	const sheetResult = await runCommand(rangeSheetArgs(join(workDir, video.files.video), options.from, options.to, options.step, join(sheetsDir, sheetName)));
	if (sheetResult.exitCode !== 0) {
		throw new Error(`fc-feedback: 시트 생성 실패(${video.id}/range): ${sheetResult.stderr.trim()}`);
	}
	return { video: video.id, from: options.from, to: options.to, step: options.step, candidates, sheet: join("sheets", sheetName), ...rangeSheetLayout(times.length) };
}

async function handleScanRange(rest: readonly string[], workDir: string, status: FcStatus): Promise<unknown> {
	const { value: videoId, rest: r1 } = takeOption(rest, "--video");
	const { value: fromRaw, rest: r2 } = takeOption(r1, "--from");
	const { value: toRaw, rest: r3 } = takeOption(r2, "--to");
	const { value: stepRaw } = takeOption(r3, "--step");
	if (videoId === undefined) {
		throw new Error("fc-feedback: scan-range에는 --video가 필요합니다");
	}
	if (fromRaw === undefined) {
		throw new Error("fc-feedback: scan-range에는 --from이 필요합니다");
	}
	if (toRaw === undefined) {
		throw new Error("fc-feedback: scan-range에는 --to가 필요합니다");
	}
	return cmdScanRange(
		{ video: videoId, from: Number(fromRaw), to: Number(toRaw), step: stepRaw === undefined ? DEFAULT_RANGE_STEP_SECONDS : Number(stepRaw) },
		workDir,
		status,
	);
}

// ── plan.validated.json reading (plan §3) ───────────────────────────────
//
// plan.validated.json is our own output (written by `check plan`), but it is
// still read back from disk as `unknown` — these are structural I/O readers,
// not a `core.checkPlan` re-validation.

/**
 * Legacy conversion: a plan.validated.json written before `named_member_ids` existed has no such
 * field. In that older data `member_ids` meant "names called in the source" (every named player),
 * which is exactly what `named_member_ids` means now, so the older `member_ids` is the named list.
 */
function namedMemberIdsFromLegacyValidated(raw: Record<string, unknown>): string[] {
	return raw.named_member_ids === undefined
		? toStringArray(raw.member_ids, "unit.member_ids")
		: toStringArray(raw.named_member_ids, "unit.named_member_ids");
}

/** Legacy conversion: a plan.validated.json written before `inferred_member_ids` existed has no such field; its units inferred no actor. */
function inferredMemberIdsFromLegacyValidated(raw: Record<string, unknown>): string[] {
	return raw.inferred_member_ids === undefined ? [] : toStringArray(raw.inferred_member_ids, "unit.inferred_member_ids");
}

/** Legacy conversion: a plan.validated.json written before `line_range` existed has no such field; `unitLines` then falls back to time containment. */
function lineRangeFromLegacyValidated(raw: Record<string, unknown>): ValidatedUnit["line_range"] {
	if (raw.line_range === undefined || raw.line_range === null) return null;
	if (!isRecord(raw.line_range)) throw new Error("fc-feedback: plan.validated.json의 unit.line_range가 올바르지 않습니다");
	return { start_line: num(raw.line_range.start_line, "unit.line_range.start_line"), end_line: num(raw.line_range.end_line, "unit.line_range.end_line") };
}

function toValidatedUnit(raw: unknown): ValidatedUnit {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: plan.validated.json의 unit이 올바르지 않습니다");
	}
	return {
		id: str(raw.id, "unit.id"),
		match_id: str(raw.match_id, "unit.match_id"),
		topic_id: str(raw.topic_id, "unit.topic_id"),
		video: str(raw.video, "unit.video"),
		start: num(raw.start, "unit.start"),
		end: num(raw.end, "unit.end"),
		title: str(raw.title, "unit.title"),
		position_tags: positionTagsFromLegacy(toStringArray(raw.position_tags, "unit.position_tags")),
		topic_tags: toStringArray(raw.topic_tags, "unit.topic_tags"),
		member_ids: toStringArray(raw.member_ids, "unit.member_ids"),
		named_member_ids: namedMemberIdsFromLegacyValidated(raw),
		inferred_member_ids: inferredMemberIdsFromLegacyValidated(raw),
		key_frame_candidate_ids: toStringArray(raw.key_frame_candidate_ids, "unit.key_frame_candidate_ids"),
		addressed_to_all: optionalBool(raw.addressed_to_all, false),
		group_positions: groupPositionsFromLegacyValidated(raw),
		// plan.validated.json written before comment support has no `comment_authors`: its units held speech lines only.
		comment_authors: raw.comment_authors === undefined ? [] : toStringArray(raw.comment_authors, "unit.comment_authors"),
		line_range: lineRangeFromLegacyValidated(raw),
	};
}

function toValidatedTopic(raw: unknown): ValidatedTopic {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: plan.validated.json의 topic이 올바르지 않습니다");
	}
	return {
		id: str(raw.id, "topic.id"),
		title: str(raw.title, "topic.title"),
		summary: str(raw.summary, "topic.summary"),
		unit_ids: toStringArray(raw.unit_ids, "topic.unit_ids"),
	};
}

/**
 * Legacy conversion: a unit validated before `group_positions` existed addressed its whole `position_tags`
 * as a group exactly when it named nobody to fix (`member_ids` empty) — the rule the viewer used then.
 */
function groupPositionsFromLegacyValidated(raw: Record<string, unknown>): string[] {
	if (raw.group_positions !== undefined) return positionTagsFromLegacy(toStringArray(raw.group_positions, "unit.group_positions"));
	const memberIds = raw.member_ids === undefined ? [] : toStringArray(raw.member_ids, "unit.member_ids");
	return memberIds.length === 0 && raw.position_tags !== undefined ? positionTagsFromLegacy(toStringArray(raw.position_tags, "unit.position_tags")) : [];
}

function toValidatedMatch(raw: unknown): ValidatedMatch {
	if (!isRecord(raw) || !Array.isArray(raw.topics)) {
		throw new Error("fc-feedback: plan.validated.json의 match가 올바르지 않습니다");
	}
	return {
		id: str(raw.id, "match.id"),
		title: str(raw.title, "match.title"),
		topics: raw.topics.map(toValidatedTopic),
		lineup: lineupFromLegacyValidated(raw),
	};
}

/**
 * Legacy conversion: a match validated before `lineup` existed has no such field; its lineup reads as unknown (null).
 * A lineup validated with the retired left/right position codes reads with the current codes (`positionFromLegacyCode`).
 */
function lineupFromLegacyValidated(raw: Record<string, unknown>): Lineup | null {
	if (raw.lineup === undefined || raw.lineup === null) return null;
	const lineup = toStringRecord(raw.lineup, "match.lineup");
	return Object.fromEntries(Object.entries(lineup).map(([memberId, position]) => [memberId, positionFromLegacyCode(position) ?? position]));
}

function toValidatedRecurring(raw: unknown): ValidatedRecurring {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: plan.validated.json의 recurring이 올바르지 않습니다");
	}
	return {
		label: str(raw.label, "recurring.label"),
		unit_ids: toStringArray(raw.unit_ids, "recurring.unit_ids"),
		member_ids: recurringMembersFromLegacyValidated(raw),
	};
}

/**
 * Legacy conversion: a recurring entry written before `member_ids` existed names no owner, so it reads as
 * `[]` — "the label names a team unit" — which keeps the viewer's old per-card "내가 고칠 것" count.
 */
function recurringMembersFromLegacyValidated(raw: Record<string, unknown>): string[] {
	return raw.member_ids === undefined ? [] : toStringArray(raw.member_ids, "recurring.member_ids");
}

/** Legacy conversion: a plan.validated.json written before `recurring` existed has no such field; it reads as "nothing repeats". */
function recurringFromLegacyValidated(raw: Record<string, unknown>): ValidatedRecurring[] {
	return raw.recurring === undefined ? [] : toRecurringArray(raw.recurring);
}

function toRecurringArray(raw: unknown): ValidatedRecurring[] {
	if (!Array.isArray(raw)) {
		throw new Error("fc-feedback: plan.validated.json의 recurring은 배열이어야 합니다");
	}
	return raw.map(toValidatedRecurring);
}

/** Legacy conversion: a plan.validated.json written before `matches_without_feedback` existed has no such field; it reads as "every match has feedback". */
function matchesWithoutFeedbackFromLegacyValidated(raw: Record<string, unknown>): string[] {
	return raw.matches_without_feedback === undefined ? [] : toStringArray(raw.matches_without_feedback, "matches_without_feedback");
}

export function toValidatedPlan(raw: unknown): ValidatedPlan {
	if (!isRecord(raw) || !Array.isArray(raw.matches) || !Array.isArray(raw.units)) {
		throw new Error("fc-feedback: plan.validated.json 형식이 올바르지 않습니다");
	}
	return {
		version: 1,
		session_title: str(raw.session_title, "session_title"),
		matches: raw.matches.map(toValidatedMatch),
		units: raw.units.map(toValidatedUnit),
		recurring: recurringFromLegacyValidated(raw),
		matches_without_feedback: matchesWithoutFeedbackFromLegacyValidated(raw),
	};
}

// ── check plan|notes|similar|refs (plan §3, §7 T6) ──────────────────────
//
// Each `check` command validates one script/LLM-authored JSON artifact
// against core.ts's `checkX` validators. Exit 0 = valid, 1 = invalid (errors
// printed as JSON on stderr), and — plan only — 2 = pending (proposed tags
// used, review gate must not proceed). Success prints one JSON line on
// stdout; invalid never prints to stdout (contract: errors stay on stderr).

function handleCheckPlan(workDir: string, status: FcStatus): number {
	ensureWorkDir(workDir, status);
	const plan = readJsonFile(join(workDir, "plan.json"), "plan.json");
	const lines = readLines(workDir);
	const candidates = readCandidates(workDir);
	const taxonomy = loadTaxonomy(workDir, status);
	const roster = loadRoster(status);
	const result = checkPlan(plan, { lines, candidates, taxonomy, roster });
	if (result.errors.length > 0) {
		throw new Error(JSON.stringify(result.errors));
	}
	for (const warning of [
		...recurringCandidateWarnings(result.validated, roster),
		...recurringInferredActorWarnings(result.validated, roster),
		...trailingUnassignedLineWarnings(result.validated, lines),
	]) {
		process.stderr.write(`${warning}\n`);
	}
	if (result.pending) {
		printJson({ ok: true, pending: true, tableMd: result.tableMd, proposed: result.proposed });
		return 2;
	}
	writeFileSync(join(workDir, "plan.validated.json"), `${JSON.stringify(result.validated, null, 2)}\n`);
	printJson({ ok: true, pending: false, tableMd: result.tableMd, proposed: result.proposed });
	return 0;
}

function handleCheckNotes(workDir: string, status: FcStatus): number {
	ensureWorkDir(workDir, status);
	const validated = toValidatedPlan(readJsonFile(join(workDir, "plan.validated.json"), "plan.validated.json"));
	const candidates = readCandidates(workDir);
	const notes = readJsonFile(join(workDir, "notes.json"), "notes.json");
	const roster = loadRoster(status);
	const result = checkNotes(notes, validated, candidates, roster);
	if (result.errors.length > 0) {
		throw new Error(JSON.stringify(result.errors));
	}
	const checkedNotes = readNotes(workDir);
	for (const warning of [...noteWarnings(checkedNotes, roster), ...unmatchedTagReadingWarnings(checkedNotes.unmatched_name_tags ?? [], roster)]) {
		process.stderr.write(`${warning}\n`);
	}
	printJson({ ok: true });
	return 0;
}

// ── notes next | submit (유닛 단위 작성 루프) ────────────────────────────────
//
// notes.json 하나가 상태이자 산출물이다. `notes next`가 다음에 할 일을 정하고(브리프), `notes submit`이 한 유닛을
// 전체 `checkNotes`로 검증한 뒤 그 유닛(과 match 수준 항목) 오류만 막는다. 다른 유닛의 오류는 `notes next`가 나중에 알린다.

const FC_COMMAND = "bun ${CLAUDE_SKILL_DIR}/scripts/fc.ts";
const BRIEF_MAX_CANDIDATES = 20;
const NOTES_DONE_MESSAGE = "모든 유닛 노트가 작성됐고 `check notes`를 통과했습니다. 다음은 SOURCE REVIEW(원문 대조 리뷰)입니다.";

type NotesDoc = Record<string, unknown> & { units: Record<string, unknown> };

interface NotesLoop {
	workDir: string;
	validated: ValidatedPlan;
	candidates: Candidate[];
	lines: Line[];
	roster: Roster | null;
}

function loadNotesLoop(workDir: string, status: FcStatus): NotesLoop {
	ensureWorkDir(workDir, status);
	return {
		workDir,
		validated: toValidatedPlan(readJsonFile(join(workDir, "plan.validated.json"), "plan.validated.json")),
		candidates: readCandidates(workDir),
		lines: readLines(workDir),
		roster: loadRoster(status),
	};
}

/** notes.json as raw JSON (so submit keeps every field it does not touch); absent means no units written yet. */
function readNotesDoc(workDir: string): NotesDoc {
	if (!existsSync(join(workDir, "notes.json"))) {
		return { version: 2, units: {} };
	}
	const raw = readJsonFile(join(workDir, "notes.json"), "notes.json");
	if (!isRecord(raw) || !isRecord(raw.units)) {
		throw new Error("fc-feedback: notes.json 형식이 올바르지 않습니다");
	}
	return { ...raw, units: raw.units };
}

function isUnitErrorPath(path: string, unitId: string): boolean {
	return path === `units.${unitId}` || path.startsWith(`units.${unitId}.`);
}

function isMatchLevelErrorPath(path: string): boolean {
	return /^(marker_colors|unmatched_name_tags)(\[|$)/.test(path);
}

function formatErrors(errors: readonly ValidationError[]): string[] {
	return errors.map((error) => `- ${error.path}: ${error.message}`);
}

/** The writer's whole context for one unit: only this unit's lines, people, legend and frames. */
function notesBrief(unit: ValidatedUnit, loop: NotesLoop, notes: NotesDoc, errors: readonly ValidationError[]): string {
	const { validated, roster, workDir } = loop;
	const nameOf = (memberId: string): string => roster?.members.find((member) => member.id === memberId)?.name ?? memberId;
	const matchNumber = Number(unit.match_id.slice(1));
	const matchTitle = validated.matches.find((match) => match.id === unit.match_id)?.title ?? unit.match_id;
	const index = validated.units.findIndex((candidate) => candidate.id === unit.id);
	const out: string[] = [];

	if (errors.length > 0) {
		out.push("## 먼저 고칠 오류", ...formatErrors(errors), "");
	}
	out.push(`## ${unit.id} · ${unit.title} · ${matchTitle} · ${formatTime(unit.start)}–${formatTime(unit.end)} · ${index + 1}/${validated.units.length}`, "");

	const fixers = unit.member_ids.map((id) => `${nameOf(id)}(${id})${unit.inferred_member_ids.includes(id) ? " 추정" : ""}`);
	out.push(`고칠 사람: ${fixers.length > 0 ? fixers.join(", ") : "없음"}`);
	const recurring = validated.recurring.filter((entry) => entry.unit_ids.includes(unit.id)).map((entry) => entry.label);
	if (recurring.length > 0) {
		out.push(`반복 지적: ${recurring.join(" / ")}`);
	}

	out.push("", "### 원문 줄");
	for (const line of unitLines(unit, loop.lines)) {
		out.push(`- ${formatTime(line.start)} ${line.source === "comment" ? `[댓글 ${commentAuthorName(line.author, roster)}] ` : ""}${line.text}`);
	}

	const legend = [
		...toMarkerColors(notes.marker_colors).filter((entry) => entry.match === matchNumber).map((entry) => `${nameOf(entry.member_id)} ${entry.color} 삼각형`),
		...toUnmatchedNameTags(notes.unmatched_name_tags)
			.filter((entry) => entry.match === matchNumber)
			.map((entry) => {
				const readings = dubeolsikReading(entry.tag);
				const near = closeRosterNames(entry.tag, roster);
				return `${entry.tag} 이름표(명단에 없음${readings.length === 0 ? "" : `; 한글 자판 "${readings.join(", ")}"`}${near.length === 0 ? "" : `, 명단 ${joinWithWaGwa(near)} 비슷`})${entry.color === undefined ? "" : ` ${entry.color} 삼각형`}`;
			}),
	];
	out.push("", "### 이 경기 색 범례", ...(legend.length > 0 ? legend.map((entry) => `- ${entry}`) : ["없음"]));

	const pointed = new Map<string, string[]>();
	for (const other of validated.units.filter((candidate) => candidate.match_id === unit.match_id && candidate.id !== unit.id && candidate.id in notes.units)) {
		const captions = rawFrameCaptions(notes.units[other.id]);
		for (const member of roster?.members ?? []) {
			if (captions.some((caption) => mentionsMember(caption, member))) {
				pointed.set(member.name, [...(pointed.get(member.name) ?? []), other.id]);
			}
		}
	}
	out.push("", "### 같은 경기에서 이미 짚은 사람", ...(pointed.size > 0 ? [...pointed].map(([name, unitIds]) => `- ${name} (${unitIds.join(", ")})`) : ["없음"]));

	const center = (unit.start + unit.end) / 2;
	const inWindow = loop.candidates.filter(
		(candidate) => candidate.video === unit.video && candidate.t >= unit.start - KEY_FRAME_TOLERANCE_SECONDS && candidate.t <= unit.end + KEY_FRAME_TOLERANCE_SECONDS,
	);
	const shown = [...inWindow].sort((a, b) => Math.abs(a.t - center) - Math.abs(b.t - center)).slice(0, BRIEF_MAX_CANDIDATES).sort((a, b) => a.t - b.t);
	out.push("", `### 프레임 후보 (${formatTime(Math.max(0, unit.start - KEY_FRAME_TOLERANCE_SECONDS))}~${formatTime(unit.end + KEY_FRAME_TOLERANCE_SECONDS)})`);
	out.push(...shown.map((candidate) => `- ${candidate.id} ${formatTime(candidate.t)} ${candidate.kind} cand/${candidate.id}.jpg`));
	if (inWindow.length > shown.length) {
		out.push(`- ${inWindow.length - shown.length}개 생략 (유닛 가운데 시각에서 먼 후보)`);
	}
	if (inWindow.some((candidate) => isRangeScanOfUnit(candidate, unit))) {
		out.push("", "구간 훑기: range 후보가 이미 있음");
	} else {
		const step = Math.max(DEFAULT_RANGE_STEP_SECONDS, Math.ceil((unit.end - unit.start) / (MAX_RANGE_FRAMES - 1)));
		const stepFlag = step === DEFAULT_RANGE_STEP_SECONDS ? "" : ` --step ${step}`;
		out.push("", "구간 훑기: range 후보 없음 — 사람을 못 찾았다고 쓰려면 먼저 실행", `${FC_COMMAND} scan-range --video ${unit.video} --from ${unit.start} --to ${unit.end}${stepFlag} --work ${workDir}`);
	}

	out.push("", "### 다음", `${FC_COMMAND} notes submit ${unit.id} --file ${workDir}/notes-units/${unit.id}.json --work ${workDir}`, "파일을 직접 만든다. 형식은 references/contracts.md의 notes submit 절.");
	return out.join("\n");
}

/** What to do now: brief of the first unit with no note, else of the first unit with check errors, else done. */
function notesNextOutput(loop: NotesLoop, notes: NotesDoc): string {
	const missing = loop.validated.units.find((unit) => !(unit.id in notes.units));
	if (missing !== undefined) {
		return notesBrief(missing, loop, notes, []);
	}
	const { errors } = checkNotes(notes, loop.validated, loop.candidates, loop.roster);
	if (errors.length === 0) {
		return NOTES_DONE_MESSAGE;
	}
	const failing = loop.validated.units.find((unit) => errors.some((error) => isUnitErrorPath(error.path, unit.id)));
	const unitErrors = failing === undefined ? [] : errors.filter((error) => isUnitErrorPath(error.path, failing.id));
	const otherErrors = errors.filter((error) => !unitErrors.includes(error));
	const otherBlock =
		otherErrors.length === 0
			? []
			: [
					"## 유닛에 매이지 않은 오류",
					...formatErrors(otherErrors),
					"marker_colors·unmatched_name_tags 오류는 notes submit의 같은 이름 필드로 고친다 — 같은 경기·같은 사람(이름표)의 항목은 새 항목으로 바뀐다.",
					"",
				];
	return [...otherBlock, ...(failing === undefined ? [] : [notesBrief(failing, loop, notes, unitErrors)])].join("\n");
}

function handleNotesNext(workDir: string, status: FcStatus): number {
	const loop = loadNotesLoop(workDir, status);
	process.stdout.write(`${notesNextOutput(loop, readNotesDoc(workDir))}\n`);
	return 0;
}

function handleNotesSubmit(rest: readonly string[], workDir: string, status: FcStatus): number {
	const { value: file, rest: positional } = takeOption(rest, "--file");
	const unitId = positional[0];
	if (unitId === undefined || file === undefined) {
		throw new Error("fc-feedback: notes submit에는 <unit-id>와 --file이 필요합니다");
	}
	const loop = loadNotesLoop(workDir, status);
	if (!loop.validated.units.some((unit) => unit.id === unitId)) {
		throw new Error(`fc-feedback: 검증된 plan에 없는 unit id입니다: ${unitId}`);
	}
	const body = readJsonFile(file, "--file");
	if (!isRecord(body) || !isRecord(body.unit)) {
		throw new Error('fc-feedback: --file은 { "unit": { … } } 꼴의 JSON이어야 합니다(unit 객체가 없습니다)');
	}
	const current = readNotesDoc(workDir);
	const appended: Record<string, unknown[]> = {};
	for (const field of ["marker_colors", "unmatched_name_tags"] as const) {
		const added = body[field];
		if (added === undefined) continue;
		if (!Array.isArray(added)) {
			throw new Error(`fc-feedback: ${field}은(는) 배열이어야 합니다`);
		}
		// A submitted entry replaces the one for the same match and person (marker_colors) or tag (unmatched_name_tags), so a resubmit does not duplicate it.
		const sameEntry = (old: unknown, fresh: unknown): boolean =>
			isRecord(old) &&
			isRecord(fresh) &&
			old.match === fresh.match &&
			(field === "marker_colors" ? old.member_id === fresh.member_id : String(old.tag).toLowerCase() === String(fresh.tag).toLowerCase());
		const existing = Array.isArray(current[field]) ? current[field] : [];
		appended[field] = [...existing.filter((old) => !added.some((fresh) => sameEntry(old, fresh))), ...added];
	}
	const next: NotesDoc = { ...current, units: { ...current.units, [unitId]: body.unit }, ...appended };

	const errors = checkNotes(next, loop.validated, loop.candidates, loop.roster).errors.filter((error) => isUnitErrorPath(error.path, unitId) || isMatchLevelErrorPath(error.path));
	if (errors.length > 0) {
		throw new Error(JSON.stringify(errors));
	}
	writeFileSync(join(workDir, "notes.json"), `${JSON.stringify(next, null, 2)}\n`);
	const submittedTags = toUnmatchedNameTags(body.unmatched_name_tags);
	for (const warning of [...noteWarnings({ version: 2, units: { [unitId]: toNoteUnit(body.unit, unitId) } }, loop.roster), ...unmatchedTagReadingWarnings(submittedTags, loop.roster)]) {
		process.stderr.write(`${warning}\n`);
	}
	process.stdout.write(`${notesNextOutput(loop, next)}\n`);
	return 0;
}

function toSimilarCandidate(raw: unknown): SimilarCandidate {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: similar-candidates.json 항목이 올바르지 않습니다");
	}
	return {
		uid: str(raw.uid, "candidate.uid"),
		score: num(raw.score, "candidate.score"),
		title: str(raw.title, "candidate.title"),
		date: str(raw.date, "candidate.date"),
		topic_tags: toStringArray(raw.topic_tags, "candidate.topic_tags"),
		position_tags: positionTagsFromLegacy(toStringArray(raw.position_tags, "candidate.position_tags")),
	};
}

function toSimilarCandidatesResult(raw: unknown): SimilarCandidatesResult {
	if (!isRecord(raw) || !isRecord(raw.units)) {
		throw new Error("fc-feedback: similar-candidates.json 형식이 올바르지 않습니다");
	}
	const result: SimilarCandidatesResult = {};
	for (const [unitId, list] of Object.entries(raw.units)) {
		if (!Array.isArray(list)) {
			throw new Error(`fc-feedback: similar-candidates.json의 units.${unitId}가 배열이 아닙니다`);
		}
		result[unitId] = list.map(toSimilarCandidate);
	}
	return result;
}

function handleCheckSimilar(workDir: string, status: FcStatus): number {
	ensureWorkDir(workDir, status);
	const candidatesFile = toSimilarCandidatesResult(
		readJsonFile(join(workDir, "similar-candidates.json"), "similar-candidates.json"),
	);
	const choices = readJsonFile(join(workDir, "similar-choices.json"), "similar-choices.json");
	const result = checkSimilarChoices(choices, candidatesFile);
	if (result.errors.length > 0) {
		throw new Error(JSON.stringify(result.errors));
	}
	printJson({ ok: true });
	return 0;
}

function handleCheckRefs(workDir: string, status: FcStatus): number {
	ensureWorkDir(workDir, status);
	const validated = toValidatedPlan(readJsonFile(join(workDir, "plan.validated.json"), "plan.validated.json"));
	const draft = readJsonFile(join(workDir, "refs-draft.json"), "refs-draft.json");
	const gameVersion = sessionMatchVersion(workDir);
	const errors = [...checkRefsDraft(draft, validated, loadRoster(status)).errors, ...refsMatchVersionErrors(draft, gameVersion)];
	if (errors.length > 0) {
		throw new Error(JSON.stringify(errors));
	}
	const refsubsDir = join(workDir, "refsubs");
	const recheckWarnings = attachedSubtitleRecheckWarnings(draft, existsSync(refsubsDir) ? readdirSync(refsubsDir) : [], (name) => readFileSync(join(refsubsDir, name), "utf8"));
	for (const warning of [...recurringPartialCoverageWarnings(draft, validated), ...recurringProClubsWarnings(draft, validated), ...recheckWarnings]) {
		process.stderr.write(`${warning}\n`);
	}
	printJson({ ok: true });
	return 0;
}

// ── refs-bundle: the REFS REVIEW reviewer's input ──────────────────────────
//
// refs-review.md puts, for every ref × attached unit, the unit's source lines next to the ref's
// relevance_ko and the subtitles within ±REFS_REVIEW_WINDOW_SECONDS of its video_starts, so an
// independent reviewer can check each claim against the material without parsing VTT timestamps.

const REFS_REVIEW_WINDOW_SECONDS = 90;

/** Subtitle file names under refsubs/ for one YouTube id (`<id>.<lang>.vtt`), sorted. */
function refSubtitleFiles(refsubsFiles: readonly string[], videoId: string): string[] {
	return refsubsFiles.filter((name) => name.startsWith(`${videoId}.`) && name.endsWith(".vtt")).sort();
}

const NO_SUBTITLE_HIT = "자막 적중 없음";

/** Most subtitle hit lines the bundle prints per unit or label; the rest is counted ("… N줄 더"). */
const MAX_SUBTITLE_HIT_LINES = 40;

interface SubtitleCue {
	video: string;
	t: number;
	text: string;
	/** Texts of the next `CUE_LOOKAHEAD` cues of the same subtitle file, so a phrase broken over a caption line break is still found. */
	following: string[];
}

/** How many following cues a phrase may run into after the cue it starts in. lazy: a term spanning more than four caption lines is not found; raise if real terms need it. */
const CUE_LOOKAHEAD = 3;

/**
 * The text of the cues a hit of `needle` (lowercase, single spaces) spans, or null. A hit is searched in the cue text joined with the following
 * cues by single spaces and counts for the cue it STARTS in, so it is reported at that cue's start time. The result is the whole text of the
 * cues the match touches (own cue first).
 */
function cueHitText(cue: SubtitleCue, needle: string): string | null {
	const texts = [cue.text, ...cue.following];
	const lowered = texts.map((text) => text.toLowerCase());
	const at = lowered.join(" ").indexOf(needle);
	if (at === -1 || at >= lowered[0].length) return null;
	const end = at + needle.length;
	let covered = 0;
	for (let i = 0; i < lowered.length; i++) {
		covered += lowered[i].length + 1;
		if (end <= covered - 1) return texts.slice(0, i + 1).join(" ");
	}
	return texts.join(" ");
}

/** Every cue of every `refsubs/*.vtt` file: tags stripped and rolling repeats collapsed (`parseVtt`), then consecutive identical texts collapsed. */
function allSubtitleCues(refsubsFiles: readonly string[], readSubtitle: (name: string) => string): SubtitleCue[] {
	const cues: SubtitleCue[] = [];
	for (const name of refsubsFiles.filter((file) => file.endsWith(".vtt")).sort()) {
		const video = name.split(".")[0];
		const lines: { t: number; text: string }[] = [];
		for (const line of parseVtt(readSubtitle(name)).lines) {
			if (line.text === lines[lines.length - 1]?.text) continue;
			lines.push({ t: line.start, text: line.text });
		}
		lines.forEach((line, index) => {
			cues.push({ video, t: line.t, text: line.text, following: lines.slice(index + 1, index + 1 + CUE_LOOKAHEAD).map((next) => next.text) });
		});
	}
	return cues;
}

/**
 * The bundle lines for one unit/label's `subtitle_terms`: cues where a term starts (case-insensitive, also across cue line breaks, `cueHitText`), capped; "자막 적중 없음" when none.
 * A cue repeated with the same video, time and text (two .vtt files of one video) prints once. A cue whose video is already
 * attached to a unit (`attachedByVideo`: video id → "u029 18:13, …") ends with "[이미 붙은 자료: …]" and sorts before the
 * others; each group is ordered by video id then time.
 */
function subtitleHitLines(terms: readonly string[], cues: readonly SubtitleCue[], attachedByVideo: ReadonlyMap<string, string>): string[] {
	const needles = terms.map((term) => term.toLowerCase().replace(/\s+/g, " ").trim());
	const seen = new Set<string>();
	const hits = cues
		.flatMap((cue) => {
			const text = needles.map((needle) => cueHitText(cue, needle)).find((hit) => hit !== null);
			return text === undefined || text === null ? [] : [{ video: cue.video, t: cue.t, text }];
		})
		.filter((cue) => {
			const key = JSON.stringify([cue.video, cue.t, cue.text]);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => Number(attachedByVideo.has(b.video)) - Number(attachedByVideo.has(a.video)) || (a.video < b.video ? -1 : a.video > b.video ? 1 : a.t - b.t));
	if (hits.length === 0) return [NO_SUBTITLE_HIT];
	const lines = hits.slice(0, MAX_SUBTITLE_HIT_LINES).map((cue) => {
		const attached = attachedByVideo.get(cue.video);
		return `> ${cue.video} ${formatTime(cue.t)} ${cue.text}${attached === undefined ? "" : ` [이미 붙은 자료: ${attached}]`}`;
	});
	if (hits.length > MAX_SUBTITLE_HIT_LINES) lines.push(`… ${hits.length - MAX_SUBTITLE_HIT_LINES}줄 더`);
	return lines;
}

/**
 * `check refs` warning for each `recurring_unfound`/`units_unfound` `subtitle_terms` term found in a subtitle file of a video ref that is already attached:
 * the material the writer holds may already cover the item. One warning per term and attached video, at the earliest hit.
 */
function attachedSubtitleRecheckWarnings(draft: unknown, refsubsFiles: readonly string[], readSubtitle: (name: string) => string): string[] {
	if (!isRecord(draft) || !Array.isArray(draft.refs)) return [];
	const videos = [...new Set(draft.refs.map(toRefDraftEntry).flatMap((ref) => (ref.format === "video" ? [extractYoutubeVideoId(new URL(ref.url))] : [])).filter((id): id is string => id !== null))].sort();
	const cues = allSubtitleCues(videos.flatMap((video) => refSubtitleFiles(refsubsFiles, video)), readSubtitle);
	const unfound = [...(Array.isArray(draft.recurring_unfound) ? draft.recurring_unfound : []), ...(Array.isArray(draft.units_unfound) ? draft.units_unfound : [])];
	const terms = [...new Set(unfound.flatMap((entry: unknown) => unfoundStrings(entry, "subtitle_terms")))];
	return terms.flatMap((term) => {
		const needle = term.toLowerCase().replace(/\s+/g, " ").trim();
		// A one-word term ("press", "압박") hits nearly every attached video; only a phrase points at a segment worth rechecking.
		if (!needle.includes(" ")) return [];
		return videos.flatMap((video) => {
			const hits = cues.filter((cue) => cue.video === video && cueHitText(cue, needle) !== null).map((cue) => cue.t);
			return hits.length === 0 ? [] : [`fc-feedback: 경고 보유 자료 재확인: ${term} — ${video} ${formatTime(Math.min(...hits))}`];
		});
	});
}

/** Video id → "u029 18:13, u031 2:00": the units each attached video ref sits on and the start time it was attached at (unit id alone when the ref has no readable `video_starts` entry). */
function attachedVideoUnits(refs: readonly RefDraftEntry[]): Map<string, string> {
	const byVideo = new Map<string, string[]>();
	for (const ref of refs) {
		if (ref.format !== "video") continue;
		const videoId = extractYoutubeVideoId(new URL(ref.url));
		if (videoId === null) continue;
		for (const unitId of ref.unit_ids) {
			const start = ref.video_starts?.[unitId];
			const seconds = start === undefined ? null : clockSeconds(start);
			byVideo.set(videoId, [...(byVideo.get(videoId) ?? []), seconds === null ? unitId : `${unitId} ${formatTime(seconds)}`]);
		}
	}
	return new Map([...byVideo].map(([videoId, entries]) => [videoId, entries.join(", ")]));
}

/** The cue printed next to a unit whose title asks for a "하지 않기" (negated to-do): a ref segment that teaches the opposite action must not be attached. */
const NEGATED_TODO_CUE = "이 유닛은 '하지 않기' — 구간이 참는 쪽을 말하는지 확인";

function negatedTodoCueLines(unit: ValidatedUnit): string[] {
	return unit.title.includes("지 않기") ? [NEGATED_TODO_CUE] : [];
}

/** Words too generic to find a subtitle segment: the to-do/negation endings every title carries, and Hangul function words ("혼자", "말고") that say nothing about the topic. */
const TITLE_KEYWORD_STOPS = new Set(["않기", "하기", "않는", "않고", "말고", "혼자", "대신", "보다", "계속", "너무", "바로", "하지"]);

/**
 * Game terms that coaches and subtitles spell differently ("오프사이드" / "옵사라인" / "offside"). A title that holds one spelling also searches the
 * others, whole; the group only adds keywords — the stem of the title word is still searched as before.
 */
const GAME_TERM_SYNONYMS: readonly (readonly string[])[] = [
	["오프사이드", "옵사", "offside"],
	["슈퍼 캔슬", "슈캔", "super cancel"],
	["크로스", "cross"],
	["헤딩", "header"],
	["프리킥", "free kick"],
	["코너킥", "corner kick"],
];

/** The other spellings of every `GAME_TERM_SYNONYMS` group that has a spelling in `title` (lowercase compare); none when the title holds no such term. */
function gameTermSynonyms(title: string): string[] {
	const lower = title.toLowerCase();
	return GAME_TERM_SYNONYMS.filter((group) => group.some((term) => lower.includes(term))).flat();
}

/**
 * Search words of a unit title for `unitSubtitleHits`: the action text after each segment's "행위자: " (the actor names are people, not
 * the topic), parenthetical hedge dropped, split on spaces and "·". A Hangul word of 3+ syllables keeps its first two syllables (the stem:
 * "캔슬로" → "캔슬", "조정하기" → "조정") so the particle or ending does not hide a hit; a 2-syllable Hangul word and a Latin word of 3+
 * letters stay whole; shorter words are dropped. Every spelling of a `GAME_TERM_SYNONYMS` group the action text holds is added whole.
 */
function titleKeywords(title: string): string[] {
	const actions = title.split(" / ").map((segment) => {
		const colon = segment.indexOf(": ");
		return (colon === -1 ? segment : segment.slice(colon + 2)).replace(/\([^()]*\)/g, " ");
	});
	const words = actions.flatMap((action) => action.split(/[\s·]+/));
	const keywords = words.flatMap((word) => {
		const hangul = /^[가-힣]+$/u.test(word);
		const keyword = hangul ? word.slice(0, 2) : /^[A-Za-z]{3,}$/.test(word) ? word.toLowerCase() : "";
		return keyword.length >= 2 && !TITLE_KEYWORD_STOPS.has(word) && !TITLE_KEYWORD_STOPS.has(keyword) ? [keyword] : [];
	});
	return [...new Set([...keywords, ...gameTermSynonyms(actions.join(" "))])];
}

/** A title keyword that occurs in more than this share of the pro_clubs cues (min `MIN_KEYWORD_CUE_ALLOWANCE` cues) is generic ("수비", "상대") and finds nothing. */
const MAX_KEYWORD_CUE_SHARE = 0.01;
const MIN_KEYWORD_CUE_ALLOWANCE = 3;
/** Most cues listed per unit by `unitSubtitleHitLines`, best score first. */
const UNIT_SUBTITLE_HIT_LIMIT = 10;

/**
 * For each plan unit, the subtitle cues (all `refsubs/` files) of a `pro_clubs: true` video ref that is NOT attached to that unit and that contain
 * a title keyword of the unit (`titleKeywords`) — material the writer may have missed. A keyword found in more than `MAX_KEYWORD_CUE_SHARE` of the
 * pro_clubs cues is generic and dropped; a cue scores the sum of 1/frequency of the keywords it holds, so a rare word ("코너") outranks a common one,
 * and the best `UNIT_SUBTITLE_HIT_LIMIT` cues are printed. Output: "- <unit> · <title>" followed by the `subtitleHitLines` of those cues; a unit with
 * no such hit is omitted, and "- 없음" stands when no unit has one.
 */
function unitSubtitleHitLines(plan: ValidatedPlan, refs: readonly RefDraftEntry[], cues: readonly SubtitleCue[], attachedByVideo: ReadonlyMap<string, string>): string[] {
	const attachedUnitsByVideo = new Map<string, Set<string>>();
	const proClubsVideos = new Set<string>();
	for (const ref of refs) {
		const videoId = ref.format === "video" ? extractYoutubeVideoId(new URL(ref.url)) : null;
		if (videoId === null) continue;
		if (ref.pro_clubs === true) proClubsVideos.add(videoId);
		attachedUnitsByVideo.set(videoId, new Set([...(attachedUnitsByVideo.get(videoId) ?? []), ...ref.unit_ids]));
	}
	const seen = new Set<string>();
	const corpus = cues
		.filter((cue) => proClubsVideos.has(cue.video))
		.filter((cue) => {
			const key = JSON.stringify([cue.video, cue.t, cue.text]);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.map((cue) => ({ cue, text: cue.text.toLowerCase() }));
	const maxFrequency = Math.max(MIN_KEYWORD_CUE_ALLOWANCE, Math.floor(corpus.length * MAX_KEYWORD_CUE_SHARE));
	const frequencies = new Map<string, number>();
	const frequency = (keyword: string): number => {
		if (!frequencies.has(keyword)) frequencies.set(keyword, corpus.filter((entry) => entry.text.includes(keyword)).length);
		return frequencies.get(keyword) ?? 0;
	};
	const out: string[] = [];
	for (const unit of plan.units) {
		const keywords = titleKeywords(unit.title).filter((keyword) => frequency(keyword) <= maxFrequency);
		const scored = corpus
			.filter((entry) => !attachedUnitsByVideo.get(entry.cue.video)?.has(unit.id))
			.map((entry) => ({ cue: entry.cue, score: keywords.filter((keyword) => entry.text.includes(keyword)).reduce((sum, keyword) => sum + 1 / frequency(keyword), 0) }))
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, UNIT_SUBTITLE_HIT_LIMIT);
		if (scored.length === 0) continue;
		out.push(`- ${unit.id} · ${unit.title}`, ...subtitleHitLines(keywords, scored.map((entry) => entry.cue), attachedByVideo).map((hit) => `  ${hit}`));
	}
	return out.length === 0 ? ["- 없음"] : out;
}

/** The non-blank strings of `value[field]` (queries / subtitle_terms of an unfound entry); `[]` when it is not an array. */
function unfoundStrings(entry: unknown, field: string): string[] {
	return isRecord(entry) && Array.isArray(entry[field]) ? entry[field].filter((item: unknown): item is string => typeof item === "string" && item.trim() !== "") : [];
}

/** One YouTube search: its "<id> <title>" results, or why it failed. */
type YtSearchResult = { ok: true; results: Array<{ id: string; title: string }> } | { ok: false; reason: string };

/** The yt-dlp calls a refs-bundle makes: one video's channel URL (`null` when unavailable) and one flat search from a ready argv. */
interface YtSearchRunner {
	channelUrl: (videoUrl: string) => string | null;
	search: (argv: readonly string[]) => YtSearchResult;
}

/** Most same-channel searches one refs-bundle runs; the rest is counted ("생략한 검색 N개"). */
const MAX_CHANNEL_SEARCHES = 12;
const YT_SEARCH_TIMEOUT_MS = 60_000;

/**
 * Runs a yt-dlp argv (`uvx yt-dlp ...`). `FC_FEEDBACK_YTDLP_BIN` replaces the `uvx yt-dlp` prefix with that executable (the test seam: no test reaches
 * YouTube). A non-zero exit, a timeout, or a missing executable is a failure, never a thrown error — the bundle is still written.
 */
function runYtDlp(argv: readonly string[]): { ok: true; stdout: string } | { ok: false; reason: string } {
	const override = process.env.FC_FEEDBACK_YTDLP_BIN;
	const command = override === undefined || override === "" ? argv : [override, ...argv.slice(2)];
	const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", timeout: YT_SEARCH_TIMEOUT_MS });
	if (result.error !== undefined) {
		return { ok: false, reason: "code" in result.error && result.error.code === "ETIMEDOUT" ? "시간 초과" : result.error.message };
	}
	if (result.status !== 0) {
		const firstStderrLine = result.stderr.split("\n").find((line) => line.trim() !== "");
		return { ok: false, reason: firstStderrLine?.trim() ?? `종료 코드 ${String(result.status)}` };
	}
	return { ok: true, stdout: result.stdout };
}

const ytSearchRunner: YtSearchRunner = {
	channelUrl: (videoUrl) => {
		const result = runYtDlp(ytChannelUrlArgs(videoUrl));
		const first = result.ok ? (result.stdout.split("\n").find((line) => line.trim() !== "")?.trim() ?? "") : "";
		return /^https?:\/\/\S+$/.test(first) ? first.replace(/\/+$/, "") : null;
	},
	search: (argv) => {
		const result = runYtDlp(argv);
		if (!result.ok) return result;
		const results = result.stdout
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => {
				const space = line.indexOf(" ");
				return space === -1 ? { id: line.trim(), title: "" } : { id: line.slice(0, space), title: line.slice(space + 1).trim() };
			});
		return { ok: true, results };
	},
};

/** Most words of one search keyword (a label): more words make the YouTube search too narrow. */
const MAX_KEYWORD_WORDS = 3;

/** The unit title's first segment action (after "행위자: ", parenthetical dropped), cleaned by `searchKeywordWords`, its first two words. */
function unitActionKeyword(title: string, roster: Roster | null): string {
	const segment = title.split(" / ")[0];
	const colon = segment.indexOf(": ");
	return searchKeywordWords((colon === -1 ? segment : segment.slice(colon + 2)).replace(/\([^()]*\)/g, " "), roster).slice(0, 2).join(" ");
}

/** A material title with its series marker ("pt.4", "Part 2", "#3") removed — it names every part of the series; `null` when the title has no marker. */
function seriesTitle(title: string): string | null {
	const marker = /\b(?:pt|part)\.?\s*\d+\b|#\d+/gi;
	if (!marker.test(title)) return null;
	const stripped = title.replace(marker, " ").replace(/\s{2,}/g, " ").trim().replace(/[\s:|\-–—,.([]+$/u, "");
	return stripped === "" ? null : stripped;
}

const isLatinTerm = (term: string): boolean => /^[\x20-\x7e]+$/.test(term);

/**
 * The search keywords one unfound record yields for a channel. A `recurring_unfound` record: its label. A `units_unfound` record: its unit's title
 * action, then its `subtitle_terms` (first two, cleaned, as one keyword). Roster names, condition-clause words and particles are removed
 * (`searchKeywordWords`). An English channel prefers the record's first Latin `subtitle_terms` entry and falls back to the Korean keywords.
 */
function unfoundKeywords(record: { label?: string; title?: string; terms: readonly string[] }, english: boolean, roster: Roster | null): string[] {
	const latin = record.terms.find(isLatinTerm);
	if (english && latin !== undefined) {
		const keyword = searchKeywordWords(latin, roster).join(" ");
		if (keyword !== "") return [keyword];
	}
	const keywords =
		record.label !== undefined
			? [searchKeywordWords(record.label, roster).slice(0, MAX_KEYWORD_WORDS).join(" ")]
			: [unitActionKeyword(record.title ?? "", roster), record.terms.slice(0, 2).flatMap((term) => searchKeywordWords(term, roster)).join(" ")];
	return keywords.filter((keyword) => keyword !== "");
}

/**
 * "## 같은 채널 후보": for each channel (`source_name`) of an attached YouTube video ref, flat searches `"<channel> <keyword>"`. Channels are ordered by
 * how many units their attached refs cover (most first), then channels with a `pro_clubs` ref first, then document order. A channel's own queries
 * run in this order: a series-title search per attached ref title with a series marker (`seriesTitle`: surfaces the other parts), then the keywords of
 * every unfound record (`unfoundKeywords`: `recurring_unfound` labels, then `units_unfound` units). The `MAX_CHANNEL_SEARCHES` cap is spent round-robin
 * over the channels (each channel's first query, then each second query, ...) and the rest is counted. Each result prints "<id> <title>", with the
 * ref's attachment marked when that video is already attached. `search === null` (`--no-search`) prints that nothing was searched.
 * A search runs inside the channel (`<channel URL>/search?query=<keyword>`; the channel URL is fetched once per channel from its first attached ref). When
 * the channel URL or the in-channel search fails, a global search `"<channel> <keyword> <football word>"` stands in ("축구" for a Korean channel, "football" otherwise).
 */
function channelCandidateLines(draft: { recurring_unfound?: unknown; units_unfound?: unknown }, plan: ValidatedPlan, refs: readonly RefDraftEntry[], roster: Roster | null, attachedByVideo: ReadonlyMap<string, string>, search: YtSearchRunner | null): string[] {
	const out = ["## 같은 채널 후보", "", "붙은 YouTube 자료의 채널에서 못 찾은 label·유닛의 키워드로 다시 검색한 결과 — 이미 붙은 영상은 표시한다. 같은 행동을 다루는 영상이 있으면 붙이는 것을 검토한다.", ""];
	if (search === null) {
		return [...out, "- 검색 안 함(--no-search)", ""];
	}
	const records = [
		...(Array.isArray(draft.recurring_unfound) ? draft.recurring_unfound : []).flatMap((entry: unknown) =>
			isRecord(entry) && typeof entry.label === "string" ? [{ label: entry.label, terms: unfoundStrings(entry, "subtitle_terms") }] : [],
		),
		...(Array.isArray(draft.units_unfound) ? draft.units_unfound : []).flatMap((entry: unknown) => {
			const unit = isRecord(entry) ? plan.units.find((candidate) => candidate.id === entry.unit_id) : undefined;
			return unit === undefined ? [] : [{ title: unit.title, terms: unfoundStrings(entry, "subtitle_terms") }];
		}),
	];
	const videoRefs = refs.filter((ref) => ref.format === "video" && extractYoutubeVideoId(new URL(ref.url)) !== null);
	const channels = [...new Set(videoRefs.map((ref) => ref.source_name))]
		.map((channel, order) => {
			const own = videoRefs.filter((ref) => ref.source_name === channel);
			return { channel, order, own, covered: new Set(own.flatMap((ref) => ref.unit_ids)).size, proClubs: own.some((ref) => ref.pro_clubs === true) };
		})
		.sort((a, b) => b.covered - a.covered || Number(b.proClubs) - Number(a.proClubs) || a.order - b.order);
	const queriesByChannel = channels.map(({ channel, own }) => {
		const english = own.every((ref) => ref.lang !== "ko");
		const keywords = [...own.flatMap((ref) => seriesTitle(ref.title) ?? []), ...records.flatMap((record) => unfoundKeywords(record, english, roster))];
		return [...new Set(keywords)].map((keyword) => ({ channel, keyword, english, videoUrl: own[0].url }));
	});
	const channelUrls = new Map<string, string | null>();
	const pairs = Array.from({ length: Math.max(0, ...queriesByChannel.map((queries) => queries.length)) }, (_, index) => queriesByChannel.flatMap((queries) => (index < queries.length ? [queries[index]] : []))).flat();
	if (pairs.length === 0) {
		return [...out, "- 없음", ""];
	}
	for (const { channel, keyword, english, videoUrl } of pairs.slice(0, MAX_CHANNEL_SEARCHES)) {
		out.push(`### ${channel} × ${keyword}`);
		if (!channelUrls.has(channel)) channelUrls.set(channel, search.channelUrl(videoUrl));
		const channelUrl = channelUrls.get(channel) ?? null;
		let found = channelUrl === null ? null : search.search(ytChannelSearchArgs(channelUrl, keyword));
		if (found === null || !found.ok) {
			out.push("- 채널 안 검색 불가 — 전체 검색으로 대신함");
			found = search.search(ytSearchArgs(`${channel} ${keyword} ${english ? "football" : "축구"}`));
		}
		if (!found.ok) {
			out.push(`- 검색 실패: ${found.reason}`);
		} else if (found.results.length === 0) {
			out.push("- 결과 없음");
		} else {
			for (const result of found.results) {
				const attached = attachedByVideo.get(result.id);
				out.push(`- ${result.id} ${result.title}${attached === undefined ? "" : ` [이미 붙은 자료: ${attached}]`}`);
			}
		}
		out.push("");
	}
	if (pairs.length > MAX_CHANNEL_SEARCHES) {
		out.push(`생략한 검색 ${pairs.length - MAX_CHANNEL_SEARCHES}개(상한 ${MAX_CHANNEL_SEARCHES}개)`, "");
	}
	return out;
}

function refsReviewBundle(input: {
	draft: unknown;
	plan: ValidatedPlan;
	lines: readonly Line[];
	refsubsFiles: readonly string[];
	readSubtitle: (name: string) => string;
	roster: Roster | null;
	search: YtSearchRunner | null;
}): string {
	const { draft, plan, lines, refsubsFiles, readSubtitle, roster, search } = input;
	if (!isRecord(draft) || !Array.isArray(draft.refs)) {
		throw new Error("fc-feedback: refs-draft.json 형식이 올바르지 않습니다");
	}
	const unitsById = new Map(plan.units.map((unit) => [unit.id, unit]));
	const usedSubtitles = new Set<string>();
	const out: string[] = ["# 참고자료 리뷰 번들", ""];
	let cueCache: SubtitleCue[] | null = null;
	const subtitleCues = (): SubtitleCue[] => (cueCache ??= allSubtitleCues(refsubsFiles, readSubtitle));
	const attachedByVideo = attachedVideoUnits(draft.refs.map(toRefDraftEntry));

	draft.refs.forEach((rawRef: unknown, refIndex) => {
		const ref = toRefDraftEntry(rawRef);
		const labels = isRecord(rawRef) && Array.isArray(rawRef.recurring_labels) ? toStringArray(rawRef.recurring_labels, "ref.recurring_labels") : [];
		const videoId = ref.format === "video" ? extractYoutubeVideoId(new URL(ref.url)) : null;
		const subtitleFiles = videoId === null ? [] : refSubtitleFiles(refsubsFiles, videoId);
		for (const name of subtitleFiles) usedSubtitles.add(name);
		const captions = subtitleFiles.length === 0 ? null : parseVtt(readSubtitle(subtitleFiles[0]));

		out.push(`## 자료 ${refIndex + 1}: ${ref.title}`, "", `- url: ${ref.url}`, `- kind: ${ref.kind} · format: ${ref.format} · lang: ${ref.lang}`);
		if (ref.kind === "eafc") {
			out.push(`- game_version: ${ref.game_version ?? "null"} · published: ${ref.published ?? "없음"} · pro_clubs: ${String(ref.pro_clubs ?? false)}`);
		}
		if (ref.summary_ko !== undefined) out.push(`- summary_ko: ${ref.summary_ko}`);
		for (const point of ref.key_points_ko ?? []) out.push(`- key_point: ${point}`);
		out.push(`- recurring_labels: ${labels.length === 0 ? "[]" : labels.join(" | ")}`);
		if (ref.format === "video") {
			out.push(`- 자막: ${subtitleFiles.length === 0 ? "자막 없음" : subtitleFiles.map((name) => `refsubs/${name}`).join(", ")}`);
		}
		out.push("");

		for (const unitId of ref.unit_ids) {
			const unit = unitsById.get(unitId);
			if (unit === undefined) throw new Error(`fc-feedback: refs-draft.json의 unit id가 plan에 없습니다: ${unitId}`);
			out.push(`### ${unitId} · ${unit.title}`, "", ...negatedTodoCueLines(unit).flatMap((cueLine) => [cueLine, ""]), "원문:");
			for (const line of unitLines(unit, lines)) {
				out.push(`> [${formatTime(line.start)}]${line.source === "comment" ? ` (댓글 · ${line.author})` : ""} ${line.text}`);
			}
			out.push("", `relevance_ko: ${ref.relevance_ko[unitId] ?? ""}`);
			const lesson = ref.lesson_ko?.[unitId];
			if (lesson !== undefined) out.push(`lesson_ko: ${lesson}`);
			const start = ref.video_starts?.[unitId];
			if (start !== undefined) {
				const seconds = clockSeconds(start);
				out.push(`video_starts: ${start}`);
				if (captions !== null && seconds !== null) {
					const from = Math.max(0, seconds - REFS_REVIEW_WINDOW_SECONDS);
					const to = seconds + REFS_REVIEW_WINDOW_SECONDS;
					out.push(`자막 ${formatTime(from)}–${formatTime(to)}:`);
					for (const caption of captions.lines) {
						if (caption.start >= from && caption.start <= to) out.push(`> [${formatTime(caption.start)}] ${caption.text}`);
					}
				}
			}
			out.push("");
		}
	});

	out.push("## 반복 지적", "");
	const unfound = isRecord(draft) && Array.isArray(draft.recurring_unfound) ? draft.recurring_unfound : [];
	for (const item of plan.recurring) {
		const covering = draft.refs
			.map((rawRef: unknown, refIndex) => ({ rawRef, refIndex }))
			.filter(({ rawRef }) => isRecord(rawRef) && Array.isArray(rawRef.recurring_labels) && rawRef.recurring_labels.includes(item.label))
			.map(({ refIndex }) => `자료 ${refIndex + 1}`);
		const unfoundEntry = unfound.find((entry: unknown) => isRecord(entry) && entry.label === item.label);
		const queries = unfoundStrings(unfoundEntry, "queries");
		const attachedOnUnits = draft.refs.flatMap((rawRef: unknown, refIndex) =>
			isRecord(rawRef) && Array.isArray(rawRef.unit_ids)
				? rawRef.unit_ids.filter((id: unknown) => item.unit_ids.includes(String(id))).map((id: unknown) => `자료 ${refIndex + 1}(${String(id)})`)
				: [],
		);
		const coverage =
			covering.length > 0
				? covering.join(", ")
				: `못 찾음 — 검색어: ${queries.join(" | ")}${attachedOnUnits.length > 0 ? ` — 이 label 유닛에 붙은 자료: ${attachedOnUnits.join(", ")}` : ""}`;
		out.push(`- ${item.label} (${item.unit_ids.join(", ")}): ${coverage}`);
		if (covering.length === 0) {
			const terms = unfoundStrings(unfoundEntry, "subtitle_terms");
			out.push(`  - subtitle_terms: ${terms.join(", ")}`);
			for (const hit of subtitleHitLines(terms, subtitleCues(), attachedByVideo)) out.push(`  ${hit}`);
		}
	}
	if (plan.recurring.length === 0) out.push("- 없음");

	const attachedUnitIds = new Set(
		draft.refs.flatMap((rawRef: unknown) => (isRecord(rawRef) && Array.isArray(rawRef.unit_ids) ? rawRef.unit_ids.map(String) : [])),
	);
	const bare = plan.units.filter((unit) => !attachedUnitIds.has(unit.id));
	out.push("", "## 자료 없는 유닛", "");
	const unitsUnfound = Array.isArray(draft.units_unfound) ? draft.units_unfound : [];
	for (const unit of bare) {
		out.push(`- ${unit.id} · ${unit.title}`, ...negatedTodoCueLines(unit).map((cueLine) => `  - ${cueLine}`));
		const entry = unitsUnfound.find((candidate: unknown) => isRecord(candidate) && candidate.unit_id === unit.id);
		const terms = unfoundStrings(entry, "subtitle_terms");
		out.push(`  - queries: ${unfoundStrings(entry, "queries").join(" | ")}`, `  - subtitle_terms: ${terms.join(", ")}`);
		for (const hit of subtitleHitLines(terms, subtitleCues(), attachedByVideo)) out.push(`  ${hit}`);
	}
	if (bare.length === 0) out.push("- 없음");

	out.push("", "## 유닛별 프로클럽 자막 적중", "", "유닛 제목 핵심어로 refsubs/ 전체를 훑은 결과 — 그 유닛에 안 붙은 pro_clubs 영상의 구간만, 흔한 낱말은 빼고 유닛마다 점수 상위 10줄까지 싣는다. 같은 행동을 다루면 그 유닛에 붙이는 것을 검토한다.", "");
	out.push(...unitSubtitleHitLines(plan, draft.refs.map(toRefDraftEntry), subtitleCues(), attachedByVideo));

	out.push("", ...channelCandidateLines(draft, plan, draft.refs.map(toRefDraftEntry), roster, attachedByVideo, search));

	const unused = refsubsFiles.filter((name) => name.endsWith(".vtt") && !usedSubtitles.has(name)).sort();
	out.push("## 붙이지 않은 자막", "");
	for (const name of unused) out.push(`- refsubs/${name}`);
	if (unused.length === 0) out.push("- 없음");
	return `${out.join("\n")}\n`;
}

function handleRefsBundle(workDir: string, status: FcStatus, searchChannels: boolean): { path: string } {
	ensureWorkDir(workDir, status);
	const plan = toValidatedPlan(readJsonFile(join(workDir, "plan.validated.json"), "plan.validated.json"));
	const draft = readJsonFile(join(workDir, "refs-draft.json"), "refs-draft.json");
	const refsubsDir = join(workDir, "refsubs");
	const refsubsFiles = existsSync(refsubsDir) ? readdirSync(refsubsDir) : [];
	const path = join(workDir, "refs-review.md");
	writeFileSync(
		path,
		refsReviewBundle({
			draft,
			plan,
			lines: readLines(workDir),
			refsubsFiles,
			readSubtitle: (name) => readFileSync(join(refsubsDir, name), "utf8"),
			roster: loadRoster(status),
			search: searchChannels ? ytSearchRunner : null,
		}),
	);
	return { path };
}

// ── taxonomy add (plan §13.1-2) ──────────────────────────────────────────

interface TaxonomyAddResult {
	path: string;
	added: string[];
	already_present: string[];
}

function handleTaxonomyAdd(tags: readonly string[], workDir: string, status: FcStatus): TaxonomyAddResult {
	if (tags.length === 0) {
		throw new Error("fc-feedback: taxonomy add에는 태그가 최소 1개 필요합니다");
	}
	ensureWorkDir(workDir, status);
	const path = taxonomyPath(workDir, status);
	const current = loadTaxonomy(workDir, status);
	const topics = [...current.topics];
	const added: string[] = [];
	const alreadyPresent: string[] = [];
	for (const tag of tags) {
		if (!isValidTag(tag)) {
			throw new Error(`fc-feedback: 유효하지 않은 태그입니다: ${tag}`);
		}
		if (topics.includes(tag)) {
			alreadyPresent.push(tag);
			continue;
		}
		topics.push(tag);
		added.push(tag);
	}
	writeFileSync(path, stringify({ version: 1, topics }));
	return { path, added, already_present: alreadyPresent };
}

// ── frames (plan §7 T6, notes v2 plan §16-1) ────────────────────────────────
//
// One start frame per validated unit, plus one frame per notes.json v2 frame
// block — extracted via media.ffmpegFrameArgs into work dir img/. The job
// list (planFrameJobs) is pure so it stays testable without ffmpeg.

// blocks는 candidate_id만 쓰는 cmdFrames와, text/caption까지 쓰는 cmdRender가 함께
// 읽는다(같은 notes.json을 두 번 다르게 파싱하지 않기 위해 core.ts의 NotesV2 모양을 그대로 쓴다).
function toNoteBlock(raw: unknown, unitId: string, index: number): NoteBlock {
	const path = `units.${unitId}.blocks[${index}]`;
	if (!isRecord(raw)) {
		throw new Error(`fc-feedback: notes.json의 ${path}가 올바르지 않습니다`);
	}
	if (raw.type === "text") {
		return { type: "text", text: str(raw.text, `${path}.text`) };
	}
	if (raw.type === "frame") {
		return {
			type: "frame",
			candidate_id: str(raw.candidate_id, `${path}.candidate_id`),
			caption: str(raw.caption, `${path}.caption`),
			...(raw.focus_x !== undefined ? { focus_x: num(raw.focus_x, `${path}.focus_x`) } : {}),
		};
	}
	throw new Error(`fc-feedback: notes.json의 ${path}.type이 올바르지 않습니다`);
}

function toNoteUnit(raw: unknown, unitId: string): NotesV2["units"][string] {
	if (!isRecord(raw) || !Array.isArray(raw.blocks)) {
		throw new Error(`fc-feedback: notes.json의 units.${unitId}가 올바르지 않습니다`);
	}
	return {
		blocks: raw.blocks.map((block, index) => toNoteBlock(block, unitId, index)),
		...(raw.unidentified_member_ids !== undefined
			? { unidentified_member_ids: toStringArray(raw.unidentified_member_ids, `units.${unitId}.unidentified_member_ids`) }
			: {}),
		...(raw.look_at !== undefined ? { look_at: str(raw.look_at, `units.${unitId}.look_at`) } : {}),
		...(raw.fault_scene !== undefined ? { fault_scene: str(raw.fault_scene, `units.${unitId}.fault_scene`) } : {}),
		...(raw.direction_check_ko !== undefined ? { direction_check_ko: str(raw.direction_check_ko, `units.${unitId}.direction_check_ko`) } : {}),
	};
}

/** The `marker_colors` of a notes.json that already passed `checkNotes`; absent when the file has none. */
function toMarkerColors(raw: unknown): NonNullable<NotesV2["marker_colors"]> {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.map((entry, index) => {
		const path = `marker_colors[${index}]`;
		if (!isRecord(entry)) {
			throw new Error(`fc-feedback: notes.json의 ${path}가 올바르지 않습니다`);
		}
		return {
			match: num(entry.match, `${path}.match`),
			member_id: str(entry.member_id, `${path}.member_id`),
			color: str(entry.color, `${path}.color`),
			evidence_candidate_id: str(entry.evidence_candidate_id, `${path}.evidence_candidate_id`),
		};
	});
}

/** The `unmatched_name_tags` of a notes.json that already passed `checkNotes`; `[]` when the file has none. */
function toUnmatchedNameTags(raw: unknown): NonNullable<NotesV2["unmatched_name_tags"]> {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.map((entry, index) => {
		const path = `unmatched_name_tags[${index}]`;
		if (!isRecord(entry)) {
			throw new Error(`fc-feedback: notes.json의 ${path}가 올바르지 않습니다`);
		}
		return {
			match: num(entry.match, `${path}.match`),
			tag: str(entry.tag, `${path}.tag`).trim(),
			...(entry.color !== undefined ? { color: str(entry.color, `${path}.color`) } : {}),
			evidence_candidate_id: str(entry.evidence_candidate_id, `${path}.evidence_candidate_id`),
		};
	});
}

function readNotes(workDir: string): NotesV2 {
	const raw = readJsonFile(join(workDir, "notes.json"), "notes.json");
	if (!isRecord(raw) || !isRecord(raw.units)) {
		throw new Error("fc-feedback: notes.json 형식이 올바르지 않습니다");
	}
	const units: NotesV2["units"] = {};
	for (const [unitId, entry] of Object.entries(raw.units)) {
		units[unitId] = toNoteUnit(entry, unitId);
	}
	return { version: 2, units, marker_colors: toMarkerColors(raw.marker_colors), unmatched_name_tags: toUnmatchedNameTags(raw.unmatched_name_tags) };
}

interface FrameJob {
	id: string;
	video: string;
	t: number;
}

/** Pure job planner: one start-frame job per unit, plus one per notes.json frame block whose candidate resolves. */
function planFrameJobs(validated: ValidatedPlan, notes: NotesV2, candidates: readonly Candidate[]): FrameJob[] {
	const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const jobs: FrameJob[] = [];
	for (const unit of validated.units) {
		jobs.push({ id: `${unit.id}-start`, video: unit.video, t: unit.start });
		for (const block of notes.units[unit.id]?.blocks ?? []) {
			if (block.type !== "frame") {
				continue;
			}
			const candidate = candidateById.get(block.candidate_id);
			if (candidate !== undefined) {
				jobs.push({ id: `${unit.id}-${candidate.id}`, video: candidate.video, t: candidate.t });
			}
		}
	}
	return jobs;
}

async function cmdFrames(workDir: string, status: FcStatus): Promise<{ frames: number }> {
	ensureWorkDir(workDir, status);
	const validated = toValidatedPlan(readJsonFile(join(workDir, "plan.validated.json"), "plan.validated.json"));
	const notes = readNotes(workDir);
	const candidates = readCandidates(workDir);
	const session = readSessionFile(workDir);
	const jobs = planFrameJobs(validated, notes, candidates);

	const imgDir = join(workDir, "img");
	mkdirSync(imgDir, { recursive: true });
	// ffmpeg에 libwebp 인코더가 없으면(Homebrew ffmpeg 9 bottle) png로 뽑아 cwebp로 바꾼다.
	const viaCwebp = !hasLibwebpEncoder((await runCommand(["ffmpeg", "-hide_banner", "-encoders"])).stdout);
	if (viaCwebp && Bun.which("cwebp") === null) {
		throw new Error("fc-feedback: ffmpeg에 libwebp 인코더가 없고 cwebp도 없습니다 — `brew install webp`로 cwebp를 설치하세요");
	}

	for (const job of jobs) {
		const video = session.videos.find((entry) => entry.id === job.video);
		if (video === undefined) {
			throw new Error(`fc-feedback: session.json에 없는 video id입니다: ${job.video}`);
		}
		const videoPath = join(workDir, video.files.video);
		const out = join(imgDir, `${job.id}.webp`);
		const grab = viaCwebp ? join(imgDir, `${job.id}.png`) : out;
		const frameResult = await runCommand(ffmpegFrameArgs(videoPath, job.t, grab));
		if (frameResult.exitCode !== 0) {
			throw new Error(`fc-feedback: 프레임 추출 실패(${job.id}): ${frameResult.stderr.trim()}`);
		}
		if (viaCwebp) {
			const encodeResult = await runCommand(cwebpArgs(grab, out));
			rmSync(grab, { force: true });
			if (encodeResult.exitCode !== 0) {
				throw new Error(`fc-feedback: webp 변환 실패(${job.id}): ${encodeResult.stderr.trim()}`);
			}
		}
	}

	return { frames: jobs.length };
}

// ── similar (plan §4-D, §12-2) ───────────────────────────────────────────

function toPastUnit(raw: unknown): PastUnit {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: index.json의 unit 항목이 올바르지 않습니다");
	}
	return {
		uid: str(raw.uid, "unit.uid"),
		session: str(raw.session, "unit.session"),
		title: str(raw.title, "unit.title"),
		date: str(raw.date, "unit.date"),
		topic_tags: toStringArray(raw.topic_tags, "unit.topic_tags"),
		position_tags: positionTagsFromLegacy(toStringArray(raw.position_tags, "unit.position_tags")),
		member_ids: toStringArray(raw.member_ids, "unit.member_ids"),
	};
}

function readPastUnitsFromIndex(archiveDir: string): PastUnit[] {
	const path = join(archiveDir, "index.json");
	if (!existsSync(path)) {
		return [];
	}
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isRecord(raw) || !Array.isArray(raw.units)) {
		return [];
	}
	return raw.units.map(toPastUnit);
}

/** Disabled mode (or a configured archive with no index.json yet) skips similarity entirely (plan §12-2). */
function cmdSimilar(workDir: string, status: FcStatus): { units: number; total_candidates: number } {
	ensureWorkDir(workDir, status);
	const session = readSessionFile(workDir);
	let units: SimilarCandidatesResult = {};

	if (status.mode === "configured" && existsSync(join(status.archive_repo_path, "index.json"))) {
		const validated = toValidatedPlan(readJsonFile(join(workDir, "plan.validated.json"), "plan.validated.json"));
		const currentUnits: CurrentUnit[] = validated.units.map((unit) => ({
			id: unit.id,
			session: session.session_id,
			topic_tags: unit.topic_tags,
			position_tags: unit.position_tags,
			member_ids: unit.member_ids,
		}));
		units = similarCandidates(currentUnits, readPastUnitsFromIndex(status.archive_repo_path));
	}

	writeFileSync(
		join(workDir, "similar-candidates.json"),
		`${JSON.stringify({ version: 1, session_id: session.session_id, units }, null, 2)}\n`,
	);
	const totalCandidates = Object.values(units).reduce((sum, list) => sum + list.length, 0);
	return { units: Object.keys(units).length, total_candidates: totalCandidates };
}

// ── verify-refs (plan §4-E) ───────────────────────────────────────────────

interface Translation {
	orig: string;
	ko: string;
}

interface RefDraftEntry {
	url: string;
	title: string;
	source_name: string;
	lang: string;
	kind: "eafc" | "tactics";
	unit_ids: string[];
	format: "video" | "article";
	relevance_ko: Record<string, string>;
	/** unit id → `m:ss` start of the segment that covers that unit's scene. */
	video_starts?: Record<string, string>;
	/** unit id → the action this material itself recommends for that unit's fault. Absent when the material gives none (and on entries written before this field). */
	lesson_ko?: Record<string, string>;
	/** eafc only: the version its material states ("FC 25"), or null when it states none. Absent on tactics refs and on verified entries written before this field. */
	game_version?: string | null;
	/** eafc only: the material covers Pro Clubs. Absent on tactics refs and on verified entries written before this field. */
	pro_clubs?: boolean;
	/** eafc only, when `game_version` is null: the year-month ("2023-01") the material was published. */
	published?: string;
	summary_ko?: string;
	key_points_ko?: string[];
	translations?: Translation[];
}

function toRefKind(value: unknown, path: string): "eafc" | "tactics" {
	if (value !== "eafc" && value !== "tactics") {
		throw new Error(`fc-feedback: ${path}는 "eafc" 또는 "tactics"여야 합니다`);
	}
	return value;
}

function toRefFormat(value: unknown, path: string): "video" | "article" {
	if (value !== "video" && value !== "article") {
		throw new Error(`fc-feedback: ${path}는 "video" 또는 "article"이어야 합니다`);
	}
	return value;
}

function toStringRecord(value: unknown, path: string): Record<string, string> {
	if (!isRecord(value)) {
		throw new Error(`fc-feedback: ${path}는 객체여야 합니다`);
	}
	return Object.fromEntries(Object.entries(value).map(([unitId, sentence]) => [unitId, str(sentence, `${path}.${unitId}`)]));
}

function toTranslation(raw: unknown): Translation {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: translations 항목이 올바르지 않습니다");
	}
	return { orig: str(raw.orig, "translation.orig"), ko: str(raw.ko, "translation.ko") };
}

function toRefDraftEntry(raw: unknown): RefDraftEntry {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: refs-draft.json 항목이 올바르지 않습니다");
	}
	const summaryKo = raw.summary_ko;
	const keyPointsKo = raw.key_points_ko;
	const translations = raw.translations;
	return {
		url: str(raw.url, "ref.url"),
		title: str(raw.title, "ref.title"),
		source_name: str(raw.source_name, "ref.source_name"),
		lang: str(raw.lang, "ref.lang"),
		kind: toRefKind(raw.kind, "ref.kind"),
		unit_ids: toStringArray(raw.unit_ids, "ref.unit_ids"),
		format: toRefFormat(raw.format, "ref.format"),
		relevance_ko: toStringRecord(raw.relevance_ko, "ref.relevance_ko"),
		...(isRecord(raw.video_starts) ? { video_starts: toStringRecord(raw.video_starts, "ref.video_starts") } : {}),
		...(isRecord(raw.lesson_ko) ? { lesson_ko: toStringRecord(raw.lesson_ko, "ref.lesson_ko") } : {}),
		...refGameFields(raw),
		...(typeof summaryKo === "string" ? { summary_ko: summaryKo } : {}),
		...(Array.isArray(keyPointsKo) ? { key_points_ko: toStringArray(keyPointsKo, "ref.key_points_ko") } : {}),
		...(Array.isArray(translations) ? { translations: translations.map(toTranslation) } : {}),
	};
}

function readRefsDraft(workDir: string): RefDraftEntry[] {
	const raw = readJsonFile(join(workDir, "refs-draft.json"), "refs-draft.json");
	if (!isRecord(raw) || !Array.isArray(raw.refs)) {
		throw new Error("fc-feedback: refs-draft.json 형식이 올바르지 않습니다");
	}
	return raw.refs.map(toRefDraftEntry);
}

// render.ts의 전체 IndexRefEntry 모양으로 파싱한다: cmdVerifyRefs는 id/page만 쓰고,
// cmdRender(readArchiveIndex)는 전체를 쓰지만 같은 index.json을 두 번 다르게 파싱하지 않는다.
function toIndexRefEntry(raw: unknown): IndexRefEntry {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: index.json의 ref 항목이 올바르지 않습니다");
	}
	const page = raw.page;
	return {
		id: str(raw.id, "ref.id"),
		url: str(raw.url, "ref.url"),
		title: str(raw.title, "ref.title"),
		lang: str(raw.lang, "ref.lang"),
		kind: toRefKind(raw.kind, "ref.kind"),
		page: page === null || page === undefined ? null : str(page, "ref.page"),
		first_session: str(raw.first_session, "ref.first_session"),
	};
}

function readIndexRefs(archiveDir: string): IndexRefEntry[] {
	const path = join(archiveDir, "index.json");
	if (!existsSync(path)) {
		return [];
	}
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isRecord(raw) || !Array.isArray(raw.refs)) {
		return [];
	}
	return raw.refs.map(toIndexRefEntry);
}

const HTTP_VERIFY_TIMEOUT_MS = 10_000;

function isYoutubeWatchUrl(normalizedUrl: string): boolean {
	return new URL(normalizedUrl).hostname === "www.youtube.com";
}

/** §4-E: YouTube verifies via oembed 200; everything else HEAD, then GET whenever HEAD is not 2xx/3xx (some servers answer HEAD 404/403/405 for pages GET serves), redirects followed, 10s timeout. */
async function verifyRefUrl(normalizedUrl: string): Promise<{ status: number; finalUrl: string }> {
	if (isYoutubeWatchUrl(normalizedUrl)) {
		const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalizedUrl)}&format=json`;
		const response = await fetch(oembedUrl, { signal: AbortSignal.timeout(HTTP_VERIFY_TIMEOUT_MS) });
		return { status: response.status, finalUrl: normalizedUrl };
	}
	let response = await fetch(normalizedUrl, {
		method: "HEAD",
		redirect: "follow",
		signal: AbortSignal.timeout(HTTP_VERIFY_TIMEOUT_MS),
	});
	if (!isVerifiedStatus(response.status, false)) {
		response = await fetch(normalizedUrl, {
			method: "GET",
			redirect: "follow",
			signal: AbortSignal.timeout(HTTP_VERIFY_TIMEOUT_MS),
		});
	}
	return { status: response.status, finalUrl: response.url };
}

function isVerifiedStatus(status: number, youtube: boolean): boolean {
	return youtube ? status === 200 : status >= 200 && status <= 399;
}

interface VerifiedRef {
	id: string;
	url: string;
	final_url: string;
	http_status: number;
	checked_at: string;
	reused: boolean;
	page: string | null;
	title: string;
	source_name: string;
	lang: string;
	kind: "eafc" | "tactics";
	unit_ids: string[];
	format: "video" | "article";
	relevance_ko: Record<string, string>;
	/** unit id → `m:ss` start of the segment that covers that unit's scene. */
	video_starts?: Record<string, string>;
	/** unit id → the action this material itself recommends for that unit's fault. Absent when the material gives none (and on entries written before this field). */
	lesson_ko?: Record<string, string>;
	/** eafc only: the version its material states ("FC 25"), or null when it states none. Absent on tactics refs and on verified entries written before this field. */
	game_version?: string | null;
	/** eafc only: the material covers Pro Clubs. Absent on tactics refs and on verified entries written before this field. */
	pro_clubs?: boolean;
	/** eafc only, when `game_version` is null: the year-month ("2023-01") the material was published. */
	published?: string;
	summary_ko?: string;
	key_points_ko?: string[];
	translations?: Translation[];
}

interface DroppedRef {
	url: string;
	reason: string;
}

function draftMetadata(
	draft: RefDraftEntry,
): Pick<VerifiedRef, "format" | "relevance_ko" | "video_starts" | "lesson_ko" | "game_version" | "pro_clubs" | "published" | "summary_ko" | "key_points_ko" | "translations"> {
	return {
		format: draft.format,
		relevance_ko: draft.relevance_ko,
		...(draft.video_starts !== undefined ? { video_starts: draft.video_starts } : {}),
		...(draft.lesson_ko !== undefined ? { lesson_ko: draft.lesson_ko } : {}),
		...refGameFields(draft),
		...(draft.summary_ko !== undefined ? { summary_ko: draft.summary_ko } : {}),
		...(draft.key_points_ko !== undefined ? { key_points_ko: draft.key_points_ko } : {}),
		...(draft.translations !== undefined ? { translations: draft.translations } : {}),
	};
}

async function cmdVerifyRefs(workDir: string, status: FcStatus): Promise<{ kept: number; dropped: number }> {
	ensureWorkDir(workDir, status);
	const drafts = readRefsDraft(workDir);
	const indexRefs = status.mode === "configured" ? readIndexRefs(status.archive_repo_path) : [];

	const refs: VerifiedRef[] = [];
	const dropped: DroppedRef[] = [];

	for (const draft of drafts) {
		let normalized: string;
		try {
			normalized = normalizeUrl(draft.url);
		} catch (error) {
			dropped.push({ url: draft.url, reason: errorMessage(error) });
			continue;
		}
		const id = refId(normalized);
		const checkedAt = new Date().toISOString();
		const existing = indexRefs.find((entry) => entry.id === id);

		if (existing !== undefined) {
			refs.push({
				id,
				url: normalized,
				final_url: normalized,
				http_status: 200,
				checked_at: checkedAt,
				reused: true,
				page: existing.page,
				title: draft.title,
				source_name: draft.source_name,
				lang: draft.lang,
				kind: draft.kind,
				unit_ids: draft.unit_ids,
				...draftMetadata(draft),
			});
			continue;
		}

		try {
			const { status: httpStatus, finalUrl } = await verifyRefUrl(normalized);
			if (!isVerifiedStatus(httpStatus, isYoutubeWatchUrl(normalized))) {
				dropped.push({ url: draft.url, reason: `HTTP ${httpStatus}` });
				continue;
			}
			refs.push({
				id,
				url: normalized,
				final_url: finalUrl,
				http_status: httpStatus,
				checked_at: checkedAt,
				reused: false,
				page: draft.lang === "ko" ? null : `refs/${id}.html`,
				title: draft.title,
				source_name: draft.source_name,
				lang: draft.lang,
				kind: draft.kind,
				unit_ids: draft.unit_ids,
				...draftMetadata(draft),
			});
		} catch (error) {
			dropped.push({ url: draft.url, reason: errorMessage(error) });
		}
	}

	writeFileSync(join(workDir, "refs.verified.json"), `${JSON.stringify({ version: 1, refs, dropped }, null, 2)}\n`);
	return { kept: refs.length, dropped: dropped.length };
}

// ── refs.verified.json reading (plan §3, T9) ────────────────────────────────
//
// Read back render's own verify-refs output as `unknown` — structural I/O,
// not a `core.checkX` revalidation (there is no checkRefsVerified: the
// LLM-authored artifact is refs-draft.json, already revalidated below).

function toVerifiedRef(raw: unknown): VerifiedRef {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: refs.verified.json 항목이 올바르지 않습니다");
	}
	const summaryKo = raw.summary_ko;
	const keyPointsKo = raw.key_points_ko;
	const translations = raw.translations;
	const unitIds = toStringArray(raw.unit_ids, "ref.unit_ids");
	return {
		id: str(raw.id, "ref.id"),
		url: str(raw.url, "ref.url"),
		final_url: str(raw.final_url, "ref.final_url"),
		http_status: num(raw.http_status, "ref.http_status"),
		checked_at: str(raw.checked_at, "ref.checked_at"),
		reused: typeof raw.reused === "boolean" ? raw.reused : false,
		page: raw.page === null || raw.page === undefined ? null : str(raw.page, "ref.page"),
		title: str(raw.title, "ref.title"),
		source_name: str(raw.source_name, "ref.source_name"),
		lang: str(raw.lang, "ref.lang"),
		kind: toRefKind(raw.kind, "ref.kind"),
		unit_ids: unitIds,
		format: toRefFormat(raw.format, "ref.format"),
		relevance_ko: toStringRecord(raw.relevance_ko, "ref.relevance_ko"),
		...verifiedVideoStarts(raw, unitIds),
		...(isRecord(raw.lesson_ko) ? { lesson_ko: toStringRecord(raw.lesson_ko, "ref.lesson_ko") } : {}),
		...refGameFields(raw),
		...(typeof summaryKo === "string" ? { summary_ko: summaryKo } : {}),
		...(Array.isArray(keyPointsKo) ? { key_points_ko: toStringArray(keyPointsKo, "ref.key_points_ko") } : {}),
		...(Array.isArray(translations) ? { translations: translations.map(toTranslation) } : {}),
	};
}

/**
 * `video_starts` of a refs.verified.json entry. Legacy conversion: an entry written before per-unit
 * starts holds one `video_start` that every listed unit's link opened at, so it becomes that same start
 * for each of `unitIds`.
 */
function verifiedVideoStarts(raw: Record<string, unknown>, unitIds: readonly string[]): Pick<VerifiedRef, "video_starts"> {
	if (isRecord(raw.video_starts)) {
		return { video_starts: toStringRecord(raw.video_starts, "ref.video_starts") };
	}
	if (typeof raw.video_start === "string") {
		const legacyStart = raw.video_start;
		return { video_starts: Object.fromEntries(unitIds.map((unitId) => [unitId, legacyStart])) };
	}
	return {};
}

/** `game_version`/`pro_clubs`/`published` of a draft or verified entry, each carried only when it holds its contract type. */
function refGameFields(raw: { game_version?: unknown; pro_clubs?: unknown; published?: unknown }): Pick<VerifiedRef, "game_version" | "pro_clubs" | "published"> {
	return {
		...(raw.game_version === null || typeof raw.game_version === "string" ? { game_version: raw.game_version } : {}),
		...(typeof raw.pro_clubs === "boolean" ? { pro_clubs: raw.pro_clubs } : {}),
		...(typeof raw.published === "string" ? { published: raw.published } : {}),
	};
}

/**
 * Display fields for a ref's game badges. A tactics ref, or an eafc entry verified before `game_version`
 * existed, has no version badge and no Pro Clubs badge. An eafc entry that states no version (`game_version: null`) has no version
 * badge either; its upload month, when known, shows alone as `published_badge`.
 */
function refGameBadges(ref: VerifiedRef, matchVersion: string | null): { version_badge: string | null; published_badge: string | null; pro_clubs: boolean } {
	return {
		version_badge: ref.game_version === undefined ? null : refVersionBadge(ref.game_version, matchVersion),
		published_badge: ref.game_version === null && ref.published !== undefined ? publishedBadge(ref.published) : null,
		pro_clubs: ref.pro_clubs ?? false,
	};
}

const clockSecondsOrNull = (value: string | undefined): number | null => (value === undefined ? null : clockSeconds(value));

/**
 * A ref page serves every unit the ref is attached to, and each unit's card opens the video at its own start. The
 * page shows "m:ss부터 보기" only when all those units start at the same second; otherwise it has no single
 * start to name and returns null (a plain link to the video).
 */
function refPageStartSeconds(ref: VerifiedRef): number | null {
	const starts = new Set(ref.unit_ids.map((unitId) => clockSecondsOrNull(ref.video_starts?.[unitId])));
	const [only] = starts;
	return starts.size === 1 && only !== undefined ? only : null;
}

function readVerifiedRefs(workDir: string): VerifiedRef[] {
	const raw = readJsonFile(join(workDir, "refs.verified.json"), "refs.verified.json");
	if (!isRecord(raw) || !Array.isArray(raw.refs)) {
		throw new Error("fc-feedback: refs.verified.json 형식이 올바르지 않습니다");
	}
	return raw.refs.map(toVerifiedRef);
}

// ── similar-choices.json reading (plan §3, T9) ──────────────────────────────

function toSimilarChoicesUnits(raw: unknown): Record<string, string[]> {
	if (!isRecord(raw) || !isRecord(raw.units)) {
		throw new Error("fc-feedback: similar-choices.json 형식이 올바르지 않습니다");
	}
	const result: Record<string, string[]> = {};
	for (const [unitId, list] of Object.entries(raw.units)) {
		result[unitId] = toStringArray(list, `units.${unitId}`);
	}
	return result;
}

// ── archive index.json reading (full shape, plan §3, T9) ───────────────────
//
// Distinct from `readIndexRefs`/`readPastUnitsFromIndex` above: those are
// narrow, graceful (return [] when index.json is absent) readers for
// `verify-refs`/`similar`. render/publish-prep need the whole file and
// require it to already exist (a configured archive always has one, written
// by init-archive) — so this throws instead of defaulting to empty.

function toIndexSessionEntry(raw: unknown): IndexSessionEntry {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: index.json의 session 항목이 올바르지 않습니다");
	}
	return {
		id: str(raw.id, "session.id"),
		title: str(raw.title, "session.title"),
		date: str(raw.date, "session.date"),
		videos: num(raw.videos, "session.videos"),
		unit_count: num(raw.unit_count, "session.unit_count"),
		topic_tags: toStringArray(raw.topic_tags, "session.topic_tags"),
		href: str(raw.href, "session.href"),
	};
}

function toIndexUnitEntry(raw: unknown): IndexUnitEntry {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: index.json의 unit 항목이 올바르지 않습니다");
	}
	return {
		uid: str(raw.uid, "unit.uid"),
		session: str(raw.session, "unit.session"),
		title: str(raw.title, "unit.title"),
		date: str(raw.date, "unit.date"),
		position_tags: positionTagsFromLegacy(toStringArray(raw.position_tags, "unit.position_tags")),
		topic_tags: toStringArray(raw.topic_tags, "unit.topic_tags"),
		member_ids: toStringArray(raw.member_ids, "unit.member_ids"),
		href: str(raw.href, "unit.href"),
	};
}

function readArchiveIndex(archiveDir: string): ArchiveIndex {
	const raw = readJsonFile(join(archiveDir, "index.json"), "index.json");
	if (!isRecord(raw) || !Array.isArray(raw.sessions) || !Array.isArray(raw.units) || !Array.isArray(raw.refs)) {
		throw new Error("fc-feedback: index.json 형식이 올바르지 않습니다");
	}
	return {
		version: 1,
		updated_at: str(raw.updated_at, "updated_at"),
		sessions: raw.sessions.map(toIndexSessionEntry),
		units: raw.units.map(toIndexUnitEntry),
		refs: raw.refs.map(toIndexRefEntry),
	};
}

// ── render (plan §1, §3, §4-F, §7 T9) ───────────────────────────────────────

function formatSessionDate(uploadDate: string): string {
	if (!/^\d{8}$/.test(uploadDate)) {
		throw new Error(`fc-feedback: upload_date 형식이 아닙니다: ${uploadDate}`);
	}
	return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

/**
 * `rootRelativeHref` (e.g. `sessions/<sid>/index.html#u001` or `refs/<id>.html`,
 * both archive-root-relative, plan §3) rewritten relative to the *current*
 * session's own page at `sessions/<sessionId>/index.html` — used for both the
 * similar-feedback cross-session link and the reference summary-page link, so
 * neither needs its own ad hoc "../" counting.
 */
function sessionRelativeHref(sessionId: string, rootRelativeHref: string): string {
	const hashIndex = rootRelativeHref.indexOf("#");
	const pathPart = hashIndex === -1 ? rootRelativeHref : rootRelativeHref.slice(0, hashIndex);
	const fragment = hashIndex === -1 ? "" : rootRelativeHref.slice(hashIndex);
	const fromDir = posix.join("sessions", sessionId);
	return `${posix.relative(fromDir, pathPart)}${fragment}`;
}

interface BuildUnitContext {
	workDir: string;
	sessionId: string;
	roster: Roster | null;
	notes: NotesV2;
	candidates: readonly Candidate[];
	similarChoices: Record<string, string[]>;
	indexUnitByUid: Map<string, IndexUnitEntry>;
	refsVerified: readonly VerifiedRef[];
	matches: readonly ValidatedMatch[];
	/** `matchGameVersion` of the session's video titles. */
	matchVersion: string | null;
}

/** check refs guarantees one relevance sentence per listed unit; a missing one means refs.verified.json is stale against refs-draft.json. */
function requireRelevance(ref: VerifiedRef, unitId: string): string {
	const sentence = ref.relevance_ko[unitId];
	if (sentence === undefined) {
		throw new Error(`fc-feedback: refs.verified.json의 ${ref.id}에 ${unitId} 관련성 문장이 없습니다 — verify-refs를 다시 실행하세요`);
	}
	return sentence;
}

function buildSessionUnit(unit: ValidatedUnit, ctx: BuildUnitContext): SessionUnit {
	const note = ctx.notes.units[unit.id];
	if (note === undefined) {
		throw new Error(`fc-feedback: notes.json에 없는 unit입니다: ${unit.id}`);
	}
	const candidateById = new Map(ctx.candidates.map((candidate) => [candidate.id, candidate]));

	const startPath = join(ctx.workDir, "img", `${unit.id}-start.webp`);
	if (!existsSync(startPath)) {
		throw new Error(`fc-feedback: 시작 프레임 이미지가 없습니다(frames를 먼저 실행하세요): ${startPath}`);
	}
	const startDims = webpDimensions(readFileSync(startPath));
	const startImage: UnitStartImage = { src: `img/${unit.id}-start.webp`, width: startDims.width, height: startDims.height };

	const body: UnitBodyBlock[] = note.blocks.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: block.text };
		}
		const candidate = candidateById.get(block.candidate_id);
		if (candidate === undefined) {
			throw new Error(`fc-feedback: notes.json의 frame이 candidates.json에 없습니다: ${block.candidate_id}`);
		}
		const framePath = join(ctx.workDir, "img", `${unit.id}-${candidate.id}.webp`);
		const frameDims = webpDimensions(readFileSync(framePath));
		return {
			type: "frame",
			src: `img/${unit.id}-${candidate.id}.webp`,
			width: frameDims.width,
			height: frameDims.height,
			t: candidate.t,
			caption: block.caption,
			...(block.focus_x !== undefined ? { focus_x: block.focus_x } : {}),
		};
	});

	const similar: UnitSimilar[] = (ctx.similarChoices[unit.id] ?? []).map((uid) => {
		const entry = ctx.indexUnitByUid.get(uid);
		if (entry === undefined) {
			throw new Error(`fc-feedback: similar-choices.json의 uid가 index.json에 없습니다: ${uid}`);
		}
		return { uid: entry.uid, title: entry.title, date: entry.date, href: sessionRelativeHref(ctx.sessionId, entry.href) };
	});

	const refs: UnitRef[] = ctx.refsVerified
		.filter((ref) => ref.unit_ids.includes(unit.id))
		.map((ref) => ({
			id: ref.id,
			title: ref.title,
			lang: ref.lang,
			kind: ref.kind,
			href: ref.page === null ? null : sessionRelativeHref(ctx.sessionId, ref.page),
			orig_url: ref.final_url,
			format: ref.format,
			relevance_ko: requireRelevance(ref, unit.id),
			start_seconds: clockSecondsOrNull(ref.video_starts?.[unit.id]),
			source_name: ref.source_name,
			lesson_ko: ref.lesson_ko?.[unit.id] ?? null,
			...refGameBadges(ref, ctx.matchVersion),
		}));

	const lineup = ctx.matches.find((match) => match.id === unit.match_id)?.lineup ?? null;
	const relatedIds = ctx.roster !== null ? relatedMembers(unit, ctx.roster, lineup).map((member) => member.id) : [];
	const positionTargetIds = ctx.roster !== null ? positionTargetMembers(unit, ctx.roster, lineup).map((member) => member.id) : [];
	const groupMemberIds = ctx.roster !== null ? groupMembers(unit, ctx.roster, lineup).map((member) => member.id) : [];

	return {
		id: unit.id,
		uid: `${ctx.sessionId}#${unit.id}`,
		match_id: unit.match_id,
		topic_id: unit.topic_id,
		video: unit.video,
		start: unit.start,
		end: unit.end,
		title: unit.title,
		position_tags: unit.position_tags,
		topic_tags: unit.topic_tags,
		member_ids: unit.member_ids,
		inferred_member_ids: unit.inferred_member_ids,
		named_member_ids: unit.named_member_ids,
		related_member_ids: relatedIds,
		position_target_ids: positionTargetIds,
		group_member_ids: groupMemberIds,
		addressed_to_all: unit.addressed_to_all,
		comment_author_names: [...new Set(unit.comment_authors.map((handle) => commentAuthorName(handle, ctx.roster)))],
		self_critique_member_ids: selfCritiqueMemberIds(unit.member_ids, unit.comment_authors, ctx.roster),
		body,
		unidentified_member_ids: note.unidentified_member_ids ?? [],
		look_at: note.look_at ?? null,
		fault_scene: note.fault_scene ?? null,
		direction_check_ko: note.direction_check_ko ?? null,
		images: { start: startImage },
		similar,
		refs,
		watch_url: `https://youtu.be/${unit.video}?t=${Math.floor(unit.start)}`,
	};
}

/** Labels of the plan `recurring` entries whose reference search found nothing (`recurring_unfound[].label` of a refs-draft that passed `checkRefsDraft`). */
function unfoundRecurringLabels(draft: unknown): Set<string> {
	const entries = isRecord(draft) && Array.isArray(draft.recurring_unfound) ? draft.recurring_unfound : [];
	return new Set(entries.flatMap((entry: unknown) => (isRecord(entry) && typeof entry.label === "string" ? [entry.label] : [])));
}

/** Re-validates plan/notes/similar-choices/refs-draft (throws on the first invalid one) and builds `SessionData`. */
function buildSessionData(workDir: string, status: FcStatus): SessionData {
	const taxonomy = loadTaxonomy(workDir, status);
	const roster = loadRoster(status);
	const lines = readLines(workDir);
	const candidates = readCandidates(workDir);

	const planRaw = readJsonFile(join(workDir, "plan.json"), "plan.json");
	const planResult = checkPlan(planRaw, { lines, candidates, taxonomy, roster });
	if (planResult.errors.length > 0) {
		throw new Error(JSON.stringify(planResult.errors));
	}
	if (planResult.pending) {
		throw new Error("fc-feedback: plan.json에 미승인 proposed_tags가 남아있습니다 — taxonomy add 후 다시 check plan을 실행하세요");
	}
	const validated = planResult.validated;

	const notesRaw = readJsonFile(join(workDir, "notes.json"), "notes.json");
	const notesCheck = checkNotes(notesRaw, validated, candidates, roster);
	if (notesCheck.errors.length > 0) {
		throw new Error(JSON.stringify(notesCheck.errors));
	}
	const notes = readNotes(workDir);

	const similarCandidatesFile = toSimilarCandidatesResult(
		readJsonFile(join(workDir, "similar-candidates.json"), "similar-candidates.json"),
	);
	const similarChoicesRaw = readJsonFile(join(workDir, "similar-choices.json"), "similar-choices.json");
	const similarCheck = checkSimilarChoices(similarChoicesRaw, similarCandidatesFile);
	if (similarCheck.errors.length > 0) {
		throw new Error(JSON.stringify(similarCheck.errors));
	}
	const similarChoices = toSimilarChoicesUnits(similarChoicesRaw);

	const refsDraftRaw = readJsonFile(join(workDir, "refs-draft.json"), "refs-draft.json");
	const refsCheck = checkRefsDraft(refsDraftRaw, validated, roster);
	if (refsCheck.errors.length > 0) {
		throw new Error(JSON.stringify(refsCheck.errors));
	}
	const refsVerified = readVerifiedRefs(workDir);
	const unfoundLabels = unfoundRecurringLabels(refsDraftRaw);

	const session = readSessionFile(workDir);

	const indexUnitByUid =
		status.mode === "configured" && existsSync(join(status.archive_repo_path, "index.json"))
			? new Map(readArchiveIndex(status.archive_repo_path).units.map((entry) => [entry.uid, entry]))
			: new Map<string, IndexUnitEntry>();

	const membersInfo: SessionMemberInfo[] =
		roster !== null ? roster.members.map((member) => ({ id: member.id, name: member.name, gamertag: member.gamertag, positions: member.positions })) : [];

	const ctx: BuildUnitContext = {
		workDir,
		sessionId: session.session_id,
		roster,
		notes,
		candidates,
		similarChoices,
		indexUnitByUid,
		refsVerified,
		matches: validated.matches,
		matchVersion: matchGameVersion(session.videos.map((video) => video.title)),
	};
	const units = validated.units.map((unit) => buildSessionUnit(unit, ctx));

	return {
		version: 1,
		session_id: session.session_id,
		title: validated.session_title,
		date: formatSessionDate(session.videos[0]?.upload_date ?? ""),
		generated_at: new Date().toISOString(),
		pages_base_url: status.mode === "configured" ? status.pages_base_url : "",
		videos: session.videos.map((video) => ({ id: video.id, part: video.part, embeddable: video.embeddable })),
		members: membersInfo,
		matches: validated.matches.map((match) => ({
			...match,
			marker_legend: (notes.marker_colors ?? []).filter((entry) => `m${entry.match}` === match.id).map((entry) => ({ member_id: entry.member_id, color: entry.color })),
			unmatched_name_tags: (notes.unmatched_name_tags ?? []).filter((entry) => `m${entry.match}` === match.id).map((entry) => ({ tag: entry.tag, ...(entry.color !== undefined ? { color: entry.color } : {}) })),
		})),
		units,
		recurring: validated.recurring.map((entry) => ({ ...entry, refs_unfound: unfoundLabels.has(entry.label) })),
		matches_without_feedback: validated.matches_without_feedback,
	};
}

function copyWebpFiles(sourceDir: string, destDir: string): void {
	mkdirSync(destDir, { recursive: true });
	let entries: string[];
	try {
		entries = readdirSync(sourceDir);
	} catch {
		entries = [];
	}
	for (const name of entries) {
		if (name.endsWith(".webp")) {
			copyFileSync(join(sourceDir, name), join(destDir, name));
		}
	}
}

/** Builds the session's tree in a temp dir, then atomically swaps it into `<root>/sessions/<sessionId>/`. */
function writeSessionDirAtomic(root: string, sessionId: string, build: (dir: string) => void): void {
	const sessionsDir = join(root, "sessions");
	mkdirSync(sessionsDir, { recursive: true });
	const tmpDir = join(sessionsDir, `.tmp-${sessionId}-${randomUUID()}`);
	mkdirSync(tmpDir, { recursive: true });
	build(tmpDir);

	const finalDir = join(sessionsDir, sessionId);
	if (existsSync(finalDir)) {
		const backupDir = join(sessionsDir, `.old-${sessionId}-${randomUUID()}`);
		renameSync(finalDir, backupDir);
		renameSync(tmpDir, finalDir);
		rmSync(backupDir, { recursive: true, force: true });
	} else {
		renameSync(tmpDir, finalDir);
	}
}

const sessionMatchVersion = (workDir: string): string | null => matchGameVersion(readSessionFile(workDir).videos.map((video) => video.title));

/** Writes a `refs/<id>.html` page per non-`ko` ref (skipping already-archived reused ones when `skipReused`). */
function writeRefPages(root: string, refsVerified: readonly VerifiedRef[], matchVersion: string | null, skipReused: boolean): void {
	const nonKo = refsVerified.filter((ref) => ref.lang !== "ko" && !(skipReused && ref.reused));
	if (nonKo.length === 0) {
		return;
	}
	const refsDir = join(root, "refs");
	mkdirSync(refsDir, { recursive: true });
	for (const ref of nonKo) {
		const page: RefPageData = {
			id: ref.id,
			title: ref.title,
			lang: ref.lang,
			kind: ref.kind,
			format: ref.format,
			url: ref.final_url,
			start_seconds: refPageStartSeconds(ref),
			...refGameBadges(ref, matchVersion),
			summary_ko: ref.summary_ko ?? "",
			key_points_ko: ref.key_points_ko ?? [],
			translations: ref.translations ?? [],
		};
		writeFileSync(join(refsDir, `${ref.id}.html`), renderRef(page));
	}
}

/** Replaces this session's entries in-place (idempotent) and additively merges refs (plan §3). */
function rewriteArchiveIndex(archiveDir: string, sessionData: SessionData, refsVerified: readonly VerifiedRef[]): ArchiveIndex {
	const existing = readArchiveIndex(archiveDir);
	const sessionId = sessionData.session_id;

	const keptSessions = existing.sessions.filter((entry) => entry.id !== sessionId);
	const keptUnits = existing.units.filter((entry) => entry.session !== sessionId);

	const topicTags: string[] = [];
	for (const unit of sessionData.units) {
		for (const tag of unit.topic_tags) {
			if (!topicTags.includes(tag)) {
				topicTags.push(tag);
			}
		}
	}

	const newSession: IndexSessionEntry = {
		id: sessionId,
		title: sessionData.title,
		date: sessionData.date,
		videos: sessionData.videos.length,
		unit_count: sessionData.units.length,
		topic_tags: topicTags,
		href: `sessions/${sessionId}/index.html`,
	};
	const newUnits: IndexUnitEntry[] = sessionData.units.map((unit) => ({
		uid: unit.uid,
		session: sessionId,
		title: unit.title,
		date: sessionData.date,
		position_tags: unit.position_tags,
		topic_tags: unit.topic_tags,
		member_ids: unit.member_ids,
		href: `sessions/${sessionId}/index.html#${unit.id}`,
	}));

	const sessions = [...keptSessions, newSession].sort((a, b) => {
		if (a.date !== b.date) {
			return a.date < b.date ? 1 : -1; // date desc
		}
		if (a.id !== b.id) {
			return a.id < b.id ? -1 : 1; // id asc
		}
		return 0;
	});
	const units = [...keptUnits, ...newUnits];

	const existingRefIds = new Set(existing.refs.map((ref) => ref.id));
	const newRefs: IndexRefEntry[] = refsVerified
		.filter((ref) => !existingRefIds.has(ref.id))
		.map((ref) => ({
			id: ref.id,
			url: ref.url,
			title: ref.title,
			lang: ref.lang,
			kind: ref.kind,
			page: ref.page,
			first_session: sessionId,
		}));
	const refs = [...existing.refs, ...newRefs];

	const index: ArchiveIndex = { version: 1, updated_at: new Date().toISOString(), sessions, units, refs };
	writeFileSync(join(archiveDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
	writeFileSync(join(archiveDir, "index.html"), renderIndex(index));
	return index;
}

interface BrokenLink {
	page: string;
	href: string;
	reason: string;
}

function collectArchiveHtmlPages(archiveDir: string): string[] {
	const pages: string[] = [];
	if (existsSync(join(archiveDir, "index.html"))) {
		pages.push("index.html");
	}
	const sessionsDir = join(archiveDir, "sessions");
	if (existsSync(sessionsDir)) {
		for (const name of readdirSync(sessionsDir)) {
			if (name.startsWith(".")) {
				continue;
			}
			if (existsSync(join(sessionsDir, name, "index.html"))) {
				pages.push(posix.join("sessions", name, "index.html"));
			}
		}
	}
	const refsDir = join(archiveDir, "refs");
	if (existsSync(refsDir)) {
		for (const name of readdirSync(refsDir)) {
			if (name.endsWith(".html")) {
				pages.push(posix.join("refs", name));
			}
		}
	}
	return pages;
}

/** Plan §4-F: every relative href/src exists on disk; every `#uNNN` fragment resolves to a real index.json UID. */
function escapeIdForRegExp(id: string): string {
	return id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A fragment (`#u001`, `#by-topic`, …) is resolved against the *target*
 * page's own markup — every anchor a page renders (TOC self-links, the
 * similar-feedback cross-session link, the archive index's "주제별" anchor)
 * points at some element carrying that id, e.g. `renderCard`'s
 * `id="${unit.id}"` — not specifically at a unit UID, so index.json's unit
 * list is not the right membership check here.
 */
function checkArchiveLinks(archiveDir: string): BrokenLink[] {
	const broken: BrokenLink[] = [];
	const htmlCache = new Map<string, string | null>();

	function readPageHtml(relPath: string): string | null {
		const cached = htmlCache.get(relPath);
		if (cached !== undefined) {
			return cached;
		}
		const absPath = join(archiveDir, relPath);
		const html = existsSync(absPath) ? readFileSync(absPath, "utf8") : null;
		htmlCache.set(relPath, html);
		return html;
	}

	function hasElementId(html: string, id: string): boolean {
		return new RegExp(`\\bid="${escapeIdForRegExp(id)}"`).test(html);
	}

	for (const pageRelPath of collectArchiveHtmlPages(archiveDir)) {
		const html = readPageHtml(pageRelPath);
		if (html === null) {
			continue;
		}
		const pageDir = posix.dirname(pageRelPath);

		for (const link of localLinks(html)) {
			if (link.startsWith("#")) {
				if (!hasElementId(html, link.slice(1))) {
					broken.push({ page: pageRelPath, href: link, reason: "알 수 없는 조각입니다" });
				}
				continue;
			}

			const hashIndex = link.indexOf("#");
			const pathPart = hashIndex === -1 ? link : link.slice(0, hashIndex);
			const fragment = hashIndex === -1 ? null : link.slice(hashIndex + 1);
			const resolved = posix.normalize(posix.join(pageDir, pathPart));
			if (!existsSync(join(archiveDir, resolved))) {
				broken.push({ page: pageRelPath, href: link, reason: "파일이 없습니다" });
				continue;
			}
			if (fragment !== null) {
				const targetHtml = readPageHtml(resolved);
				if (targetHtml === null || !hasElementId(targetHtml, fragment)) {
					broken.push({ page: pageRelPath, href: link, reason: "알 수 없는 조각입니다" });
				}
			}
		}
	}
	return broken;
}

interface RenderResult {
	ok: true;
	session_id: string;
	units: number;
	output: "archive" | "site";
	path: string;
	broken_links: number;
}

function renderToArchive(
	status: Extract<FcStatus, { status: "configured" }>,
	workDir: string,
	sessionData: SessionData,
	sessionHtml: string,
): RenderResult {
	const archiveDir = status.archive_repo_path;
	const refsVerified = readVerifiedRefs(workDir);

	writeSessionDirAtomic(archiveDir, sessionData.session_id, (dir) => {
		writeFileSync(join(dir, "data.json"), `${JSON.stringify(sessionData, null, 2)}\n`);
		writeFileSync(join(dir, "index.html"), sessionHtml);
		copyWebpFiles(join(workDir, "img"), join(dir, "img"));
	});
	writeRefPages(archiveDir, refsVerified, sessionMatchVersion(workDir), true);
	rewriteArchiveIndex(archiveDir, sessionData, refsVerified);

	const broken = checkArchiveLinks(archiveDir);
	if (broken.length > 0) {
		throw new Error(JSON.stringify(broken));
	}

	return {
		ok: true,
		session_id: sessionData.session_id,
		units: sessionData.units.length,
		output: "archive",
		path: join(archiveDir, "sessions", sessionData.session_id),
		broken_links: 0,
	};
}

/** Disabled mode or `--site-only`: a self-contained preview under `<work>/site/`, never the archive/index.json. */
function renderSiteOnly(workDir: string, sessionData: SessionData, sessionHtml: string): RenderResult {
	const siteDir = join(workDir, "site");
	rmSync(siteDir, { recursive: true, force: true });
	const refsVerified = readVerifiedRefs(workDir);

	const sessionDir = join(siteDir, "sessions", sessionData.session_id);
	mkdirSync(sessionDir, { recursive: true });
	writeFileSync(join(sessionDir, "data.json"), `${JSON.stringify(sessionData, null, 2)}\n`);
	writeFileSync(join(sessionDir, "index.html"), sessionHtml);
	copyWebpFiles(join(workDir, "img"), join(sessionDir, "img"));
	writeRefPages(siteDir, refsVerified, sessionMatchVersion(workDir), false);

	return {
		ok: true,
		session_id: sessionData.session_id,
		units: sessionData.units.length,
		output: "site",
		path: sessionDir,
		broken_links: 0,
	};
}

async function cmdRender(options: { siteOnly: boolean }, workDir: string, status: FcStatus): Promise<RenderResult> {
	ensureWorkDir(workDir, status);
	const sessionData = buildSessionData(workDir, status);
	const sessionHtml = renderSession(sessionData);

	if (options.siteOnly || status.status !== "configured") {
		return renderSiteOnly(workDir, sessionData, sessionHtml);
	}
	return renderToArchive(status, workDir, sessionData, sessionHtml);
}

// ── publish-prep (plan §7 T9) ────────────────────────────────────────────────
//
// Read-only reporting: link check + `git status --porcelain` + suggested
// commands as text. Never runs `git commit`/`git push` — that stays a human
// decision behind the SKILL.md publish gate.

interface PublishPrepResult {
	ok: true;
	broken_links: number;
	git_status: string;
	suggested_commands: string[];
}

function cmdPublishPrep(status: Extract<FcStatus, { status: "configured" }>): PublishPrepResult {
	const archiveDir = status.archive_repo_path;
	const broken = checkArchiveLinks(archiveDir);
	if (broken.length > 0) {
		throw new Error(JSON.stringify(broken));
	}

	const gitStatus = execFileSync("git", ["-C", archiveDir, "status", "--porcelain"], { encoding: "utf8" });
	return {
		ok: true,
		broken_links: 0,
		git_status: gitStatus,
		suggested_commands: [
			`git -C ${archiveDir} add -A`,
			`git -C ${archiveDir} commit -m "fc-feedback: 세션 발행"`,
			`git -C ${archiveDir} push`,
		],
	};
}

// ── dispatch ──────────────────────────────────────────────────────────────

async function main(argv: readonly string[]): Promise<number> {
	const { value: helpRequested, rest: withoutHelp } = takeFlag(argv, "--help");
	if (helpRequested || withoutHelp.length === 0) {
		printJson({ commands: COMMANDS });
		return 0;
	}

	const matched = matchCommand(withoutHelp);
	if (matched === undefined) {
		throw new Error(`fc-feedback: 알 수 없는 명령입니다: ${withoutHelp.join(" ")}`);
	}

	// --work/--archive are parsed per-command (not stripped globally first): "config set"
	// has its own --archive <dir> value flag, which a global pre-strip would otherwise steal.
	switch (matched.name) {
		case "config status": {
			printJson({ ...getFcStatus(), tools: toolAvailability() });
			return 0;
		}
		case "config set": {
			printJson(handleConfigSet(matched.rest));
			return 0;
		}
		case "config disable": {
			printJson(disableFc());
			return 0;
		}
		case "init-archive": {
			const { value: archiveOverride } = takeOption(matched.rest, "--archive");
			const status = getFcStatus();
			printJson(cmdInitArchive(resolveArchiveDir(archiveOverride, status)));
			return 0;
		}
		case "fetch": {
			const { value: workOverride, rest } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(await handleFetch(rest, workDir, status));
			return 0;
		}
		case "transcribe": {
			const { value: workOverride, rest } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(await handleTranscribe(rest, workDir, status));
			return 0;
		}
		case "scan": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(await cmdScan(workDir, status));
			return 0;
		}
		case "add-frame": {
			const { value: workOverride, rest } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(await handleAddFrame(rest, workDir, status));
			return 0;
		}
		case "scan-range": {
			const { value: workOverride, rest } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(await handleScanRange(rest, workDir, status));
			return 0;
		}
		case "check plan": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			return handleCheckPlan(resolveWorkDir(workOverride), status);
		}
		case "check notes": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			return handleCheckNotes(resolveWorkDir(workOverride), status);
		}
		case "notes next": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			return handleNotesNext(resolveWorkDir(workOverride), status);
		}
		case "notes submit": {
			const { value: workOverride, rest } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			return handleNotesSubmit(rest, resolveWorkDir(workOverride), status);
		}
		case "check similar": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			return handleCheckSimilar(resolveWorkDir(workOverride), status);
		}
		case "check refs": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			return handleCheckRefs(resolveWorkDir(workOverride), status);
		}
		case "refs-bundle": {
			const { value: noSearch, rest } = takeFlag(matched.rest, "--no-search");
			const { value: workOverride } = takeOption(rest, "--work");
			const status = getFcStatus();
			printJson(handleRefsBundle(resolveWorkDir(workOverride), status, !noSearch));
			return 0;
		}
		case "taxonomy add": {
			const { value: workOverride, rest } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(handleTaxonomyAdd(rest, workDir, status));
			return 0;
		}
		case "frames": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(await cmdFrames(workDir, status));
			return 0;
		}
		case "similar": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(cmdSimilar(workDir, status));
			return 0;
		}
		case "verify-refs": {
			const { value: workOverride } = takeOption(matched.rest, "--work");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(await cmdVerifyRefs(workDir, status));
			return 0;
		}
		case "render": {
			const { value: workOverride, rest: r1 } = takeOption(matched.rest, "--work");
			const { value: siteOnly } = takeFlag(r1, "--site-only");
			const status = getFcStatus();
			const workDir = resolveWorkDir(workOverride);
			printJson(await cmdRender({ siteOnly }, workDir, status));
			return 0;
		}
		case "publish-prep": {
			printJson(cmdPublishPrep(requireConfigured()));
			return 0;
		}
		default: {
			throw new Error(`fc-feedback: 알 수 없는 명령입니다: ${matched.name}`);
		}
	}
}

if (import.meta.main) {
	main(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error: unknown) => {
			process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
			process.exitCode = 1;
		});
}
