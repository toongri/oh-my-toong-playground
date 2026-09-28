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
import { execFileSync } from "node:child_process";
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
	checkPlan,
	checkRefsDraft,
	checkSimilarChoices,
	isValidTag,
	localLinks,
	normalizeUrl,
	parseRoster,
	parseTaxonomy,
	refId,
	relatedMembers,
	similarCandidates,
	webpDimensions,
	SID_PATTERN,
	VID_PATTERN,
	type CurrentUnit,
	type Line,
	type PastUnit,
	type Roster,
	type SimilarCandidate,
	type SimilarCandidatesResult,
	type Taxonomy,
	type ValidatedMatch,
	type ValidatedPlan,
	type ValidatedTopic,
	type ValidatedUnit,
} from "./core.ts";
import {
	MEDIA_CONSTANTS,
	buildLines,
	ffmpegFrameArgs,
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
	type AliasRule,
	type Candidate,
	type ParsedCaptions,
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
	type UnitKeyImage,
	type UnitNote,
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
	{ name: "fetch", usage: "fc fetch <url...> [--cookies]", description: "yt-dlp로 영상/오디오/자막을 내려받고 session.json을 쓴다" },
	{ name: "transcribe", usage: "fc transcribe [--hq] [--captions-only]", description: "오디오를 wav로 변환하고 whisper/자막으로 lines.json을 만든다" },
	{ name: "scan", usage: "fc scan", description: "무음/장면 후보를 병합하고 미리보기·컨택트시트를 만든다" },
	{ name: "add-frame", usage: "fc add-frame --video <VID> --t <sec>", description: "수동 프레임 후보를 candidates.json에 추가하고 미리보기를 뽑는다" },
	{ name: "check plan", usage: "fc check plan", description: "plan.json을 검증한다(exit 0 유효+plan.validated.json 생성, 2 보류, 1 무효)" },
	{ name: "check notes", usage: "fc check notes", description: "notes.json을 plan.validated.json 기준으로 검증한다(exit 0/1)" },
	{ name: "check similar", usage: "fc check similar", description: "similar-choices.json을 similar-candidates.json 기준으로 검증한다(exit 0/1)" },
	{ name: "check refs", usage: "fc check refs", description: "refs-draft.json을 plan.validated.json 기준으로 검증한다(exit 0/1)" },
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

function toolAvailability(): { ffmpeg: boolean; uvx: boolean; git: boolean; deno: boolean } {
	return {
		ffmpeg: Bun.which("ffmpeg") !== null,
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

const INDEX_HTML_PLACEHOLDER = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>fc-feedback</title>
</head>
<body>
<p>아직 발행된 세션이 없어요.</p>
</body>
</html>
`;

const ROSTER_TEMPLATE = `# fc-feedback roster.yaml
# members: 각 항목은 id(소문자/숫자/하이픈 시작), name, gamertag(대소문자 무시 유일),
# positions(최소 1개, 포지션 트리 태그: GK/DF/MF/FW 또는
# CB/FB/LB/RB/LWB/RWB/CDM/CM/CAM/LM/RM/ST/CF/LW/RW/LF/RF),
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
		{ name: "index.html", content: () => INDEX_HTML_PLACEHOLDER },
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
	return {
		audio: str(raw.audio, "files.audio"),
		video: str(raw.video, "files.video"),
		captions: captions === null || captions === undefined ? null : str(captions, "files.captions"),
		captions_format: captionsFormat,
		wav: wav === null || wav === undefined ? null : str(wav, "files.wav"),
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

/** The width/height of the best video-only stream at or below 480p (plan: "480p 스트림의 width/height"). */
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
		if (height > 480) {
			continue;
		}
		if (best === undefined || height > best.height) {
			best = { width, height };
		}
	}
	if (best === undefined) {
		throw new Error("fc-feedback: metadata에서 480p 이하 비디오 스트림을 찾을 수 없습니다");
	}
	return best;
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
	for (const dir of [videoDir, audioDir, capDir]) {
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
	options: { hq: boolean; captionsOnly: boolean },
	workDir: string,
	status: FcStatus,
): Promise<unknown> {
	ensureWorkDir(workDir, status);
	const session = readSessionFile(workDir);

	// darwin/arm64만 whisper를 실행한다(plan §4-A) — 그 외는 자막 전용 모드로 내려간다.
	const isDarwinArm64 = process.platform === "darwin" && process.arch === "arm64";
	const runWhisper = !options.captionsOnly && isDarwinArm64;
	const mode: "asr" | "captions" = runWhisper ? "asr" : "captions";

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

		videos.push({ id: video.id, part: video.part, whisperSegments, captions });
		updatedVideos.push({ ...video, files: { ...video.files, wav: relative(workDir, wavPath) } });
	}

	const built = buildLines({ videos, aliases, mode });

	writeFileSync(join(workDir, "lines.json"), `${JSON.stringify(built.lines, null, 2)}\n`);
	writeSessionFile(workDir, { ...session, videos: updatedVideos });

	return built.stats;
}

async function handleTranscribe(rest: readonly string[], workDir: string, status: FcStatus): Promise<unknown> {
	const { value: hq, rest: r1 } = takeFlag(rest, "--hq");
	const { value: captionsOnly } = takeFlag(r1, "--captions-only");
	return cmdTranscribe({ hq, captionsOnly }, workDir, status);
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

	const perVideo: { video: string; part: number; candidates: Candidate[] }[] = [];

	for (const video of session.videos) {
		const videoPath = join(workDir, video.files.video);
		const silenceResult = await runCommand(silencedetectArgs(videoPath));
		const silences = parseSilencedetect(silenceResult.stderr);
		const sceneResult = await runCommand(sceneArgs(videoPath));
		const scenes = parseShowinfo(sceneResult.stderr);
		const candidates = mergeCandidates(
			{ silences, scenes, duration: video.duration, interval: CANDIDATE_INTERVAL_SECONDS },
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
	if (kind !== "silence" && kind !== "scene" && kind !== "interval" && kind !== "manual") {
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
	return {
		i: num(raw.i, "line.i"),
		video: str(raw.video, "line.video"),
		start: num(raw.start, "line.start"),
		end: num(raw.end, "line.end"),
		text: str(raw.text, "line.text"),
	};
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
	options: { video: string; t: number },
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
		kind: "manual",
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
	return cmdAddFrame({ video: videoId, t }, workDir, status);
}

// ── plan.validated.json reading (plan §3) ───────────────────────────────
//
// plan.validated.json is our own output (written by `check plan`), but it is
// still read back from disk as `unknown` — these are structural I/O readers,
// not a `core.checkPlan` re-validation.

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
		position_tags: toStringArray(raw.position_tags, "unit.position_tags"),
		topic_tags: toStringArray(raw.topic_tags, "unit.topic_tags"),
		member_ids: toStringArray(raw.member_ids, "unit.member_ids"),
		key_frame_candidate_ids: toStringArray(raw.key_frame_candidate_ids, "unit.key_frame_candidate_ids"),
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

function toValidatedMatch(raw: unknown): ValidatedMatch {
	if (!isRecord(raw) || !Array.isArray(raw.topics)) {
		throw new Error("fc-feedback: plan.validated.json의 match가 올바르지 않습니다");
	}
	return {
		id: str(raw.id, "match.id"),
		title: str(raw.title, "match.title"),
		topics: raw.topics.map(toValidatedTopic),
	};
}

function toValidatedPlan(raw: unknown): ValidatedPlan {
	if (!isRecord(raw) || !Array.isArray(raw.matches) || !Array.isArray(raw.units)) {
		throw new Error("fc-feedback: plan.validated.json 형식이 올바르지 않습니다");
	}
	return {
		version: 1,
		session_title: str(raw.session_title, "session_title"),
		matches: raw.matches.map(toValidatedMatch),
		units: raw.units.map(toValidatedUnit),
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
	const notes = readJsonFile(join(workDir, "notes.json"), "notes.json");
	const result = checkNotes(notes, validated);
	if (result.errors.length > 0) {
		throw new Error(JSON.stringify(result.errors));
	}
	printJson({ ok: true });
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
		position_tags: toStringArray(raw.position_tags, "candidate.position_tags"),
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
	const result = checkRefsDraft(draft, validated);
	if (result.errors.length > 0) {
		throw new Error(JSON.stringify(result.errors));
	}
	printJson({ ok: true });
	return 0;
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

// ── frames (plan §7 T6) ───────────────────────────────────────────────────
//
// One start frame per validated unit, plus one frame per notes.json key_frame
// candidate — extracted via media.ffmpegFrameArgs into work dir img/. The
// job list (planFrameJobs) is pure so it stays testable without ffmpeg.

interface NoteKeyFrame {
	candidate_id: string;
	caption: string;
}

// note 항목은 candidate_id만 쓰는 cmdFrames와, problem/who/instead/detail까지 쓰는
// cmdRender가 함께 읽는다(같은 notes.json을 두 번 다르게 파싱하지 않기 위해 한 타입으로 통합).
interface NoteEntry {
	problem: string;
	who: string;
	instead: string;
	detail?: string;
	key_frames: NoteKeyFrame[];
}

interface NotesFile {
	units: Record<string, NoteEntry>;
}

function toNoteKeyFrame(raw: unknown): NoteKeyFrame {
	if (!isRecord(raw)) {
		throw new Error("fc-feedback: notes.json의 key_frames 항목이 올바르지 않습니다");
	}
	return {
		candidate_id: str(raw.candidate_id, "key_frame.candidate_id"),
		caption: typeof raw.caption === "string" ? raw.caption : "",
	};
}

function toNoteEntry(raw: unknown, unitId: string): NoteEntry {
	if (!isRecord(raw)) {
		throw new Error(`fc-feedback: notes.json의 units.${unitId}가 올바르지 않습니다`);
	}
	const detail = raw.detail;
	return {
		problem: str(raw.problem, `units.${unitId}.problem`),
		who: str(raw.who, `units.${unitId}.who`),
		instead: str(raw.instead, `units.${unitId}.instead`),
		...(typeof detail === "string" ? { detail } : {}),
		key_frames: Array.isArray(raw.key_frames) ? raw.key_frames.map(toNoteKeyFrame) : [],
	};
}

function readNotes(workDir: string): NotesFile {
	const raw = readJsonFile(join(workDir, "notes.json"), "notes.json");
	if (!isRecord(raw) || !isRecord(raw.units)) {
		throw new Error("fc-feedback: notes.json 형식이 올바르지 않습니다");
	}
	const units: NotesFile["units"] = {};
	for (const [unitId, entry] of Object.entries(raw.units)) {
		units[unitId] = toNoteEntry(entry, unitId);
	}
	return { units };
}

interface FrameJob {
	id: string;
	video: string;
	t: number;
}

/** Pure job planner: one start-frame job per unit, plus one per notes.json key_frame whose candidate resolves. */
function planFrameJobs(validated: ValidatedPlan, notes: NotesFile, candidates: readonly Candidate[]): FrameJob[] {
	const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const jobs: FrameJob[] = [];
	for (const unit of validated.units) {
		jobs.push({ id: `${unit.id}-start`, video: unit.video, t: unit.start });
		for (const frame of notes.units[unit.id]?.key_frames ?? []) {
			const candidate = candidateById.get(frame.candidate_id);
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

	for (const job of jobs) {
		const video = session.videos.find((entry) => entry.id === job.video);
		if (video === undefined) {
			throw new Error(`fc-feedback: session.json에 없는 video id입니다: ${job.video}`);
		}
		const videoPath = join(workDir, video.files.video);
		const out = join(imgDir, `${job.id}.webp`);
		const frameResult = await runCommand(ffmpegFrameArgs(videoPath, job.t, out));
		if (frameResult.exitCode !== 0) {
			throw new Error(`fc-feedback: 프레임 추출 실패(${job.id}): ${frameResult.stderr.trim()}`);
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
		position_tags: toStringArray(raw.position_tags, "unit.position_tags"),
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

/** §4-E: YouTube verifies via oembed 200; everything else HEAD (GET on 403/405), redirects followed, 10s timeout. */
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
	if (response.status === 405 || response.status === 403) {
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
	summary_ko?: string;
	key_points_ko?: string[];
	translations?: Translation[];
}

interface DroppedRef {
	url: string;
	reason: string;
}

function draftMetadata(draft: RefDraftEntry): Pick<VerifiedRef, "summary_ko" | "key_points_ko" | "translations"> {
	return {
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
		unit_ids: toStringArray(raw.unit_ids, "ref.unit_ids"),
		...(typeof summaryKo === "string" ? { summary_ko: summaryKo } : {}),
		...(Array.isArray(keyPointsKo) ? { key_points_ko: toStringArray(keyPointsKo, "ref.key_points_ko") } : {}),
		...(Array.isArray(translations) ? { translations: translations.map(toTranslation) } : {}),
	};
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
		position_tags: toStringArray(raw.position_tags, "unit.position_tags"),
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
	notes: NotesFile;
	candidates: readonly Candidate[];
	similarChoices: Record<string, string[]>;
	indexUnitByUid: Map<string, IndexUnitEntry>;
	refsVerified: readonly VerifiedRef[];
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

	const keyImages: UnitKeyImage[] = note.key_frames.map((frame) => {
		const candidate = candidateById.get(frame.candidate_id);
		if (candidate === undefined) {
			throw new Error(`fc-feedback: notes.json의 key_frame이 candidates.json에 없습니다: ${frame.candidate_id}`);
		}
		return { src: `img/${unit.id}-${candidate.id}.webp`, caption: frame.caption, t: candidate.t };
	});

	const noteOut: UnitNote = {
		problem: note.problem,
		who: note.who,
		instead: note.instead,
		...(note.detail !== undefined ? { detail: note.detail } : {}),
	};

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
		}));

	const relatedIds = ctx.roster !== null ? relatedMembers(unit, ctx.roster).map((member) => member.id) : [];

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
		related_member_ids: relatedIds,
		note: noteOut,
		images: { start: startImage, key: keyImages },
		similar,
		refs,
		watch_url: `https://youtu.be/${unit.video}?t=${Math.floor(unit.start)}`,
	};
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
	const notesCheck = checkNotes(notesRaw, validated);
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
	const refsCheck = checkRefsDraft(refsDraftRaw, validated);
	if (refsCheck.errors.length > 0) {
		throw new Error(JSON.stringify(refsCheck.errors));
	}
	const refsVerified = readVerifiedRefs(workDir);

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
		matches: validated.matches,
		units,
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

/** Writes a `refs/<id>.html` page per non-`ko` ref (skipping already-archived reused ones when `skipReused`). */
function writeRefPages(root: string, refsVerified: readonly VerifiedRef[], skipReused: boolean): void {
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
			url: ref.final_url,
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
	writeRefPages(archiveDir, refsVerified, true);
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
	writeRefPages(siteDir, refsVerified, false);

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
