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
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import { getOmtDir } from "@lib/omt-dir.ts";
import { resolveSessionIdOrThrow } from "@lib/state-core.ts";

import { parseRoster, SID_PATTERN, VID_PATTERN } from "./core.ts";
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
import { configureFc, disableFc, getFcStatus, type FcStatus } from "./manifest.ts";

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
