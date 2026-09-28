/**
 * fc-feedback pure media module.
 *
 * Parses YouTube captions (json3 / vtt), mlx-whisper ASR segments, and ffmpeg
 * stderr output (silencedetect / showinfo), builds the transcript line list
 * (plan §4-A), merges frame candidates (plan §4-B), computes sheet frame
 * times, and builds exact argv arrays for the external tools this skill
 * shells out to (yt-dlp, mlx-whisper, ffmpeg). No I/O — fc.ts is the thin
 * shell that reads/writes files and runs these argv arrays as subprocesses.
 */

// ── Captions ──────────────────────────────────────────────────────────────

export interface CaptionWord {
	t: number;
	text: string;
}

export interface CaptionLine {
	start: number;
	end: number;
	text: string;
}

export interface ParsedCaptions {
	words: CaptionWord[];
	lines: CaptionLine[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `[음악]`-style bracket markers (YouTube's non-speech annotation convention). */
function isBracketToken(text: string): boolean {
	return /^\[.*\]$/.test(text.trim());
}

interface Json3Seg {
	utf8: string;
	tOffsetMs?: number;
}

interface Json3Event {
	tStartMs?: number;
	dDurationMs?: number;
	segs?: Json3Seg[];
}

function toJson3Seg(value: unknown): Json3Seg {
	if (!isRecord(value)) throw new Error("fc-feedback: invalid json3 seg");
	const utf8 = typeof value.utf8 === "string" ? value.utf8 : "";
	const tOffsetMs = typeof value.tOffsetMs === "number" ? value.tOffsetMs : undefined;
	return { utf8, tOffsetMs };
}

function toJson3Event(value: unknown): Json3Event {
	if (!isRecord(value)) throw new Error("fc-feedback: invalid json3 event");
	const tStartMs = typeof value.tStartMs === "number" ? value.tStartMs : undefined;
	const dDurationMs = typeof value.dDurationMs === "number" ? value.dDurationMs : undefined;
	const segs = Array.isArray(value.segs) ? value.segs.map(toJson3Seg) : undefined;
	return { tStartMs, dDurationMs, segs };
}

/**
 * Parses a YouTube json3 auto-caption document. Words drop bracket markers
 * (`[음악]`) and whitespace-only tokens; word time = (tStartMs + tOffsetMs)/1000.
 * Lines are one per event that has `segs` (unfiltered — callers that need
 * "real speech only" filter bracket/blank text themselves, since a caller
 * may legitimately want the raw event boundaries).
 */
export function parseJson3(json: string): ParsedCaptions {
	const parsed: unknown = JSON.parse(json);
	if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
		throw new Error("fc-feedback: invalid json3 caption document");
	}
	const events = parsed.events.map(toJson3Event);

	const words: CaptionWord[] = [];
	const lines: CaptionLine[] = [];
	for (const event of events) {
		if (event.segs === undefined || event.tStartMs === undefined) continue;
		const start = event.tStartMs / 1000;
		const end =
			event.dDurationMs !== undefined ? (event.tStartMs + event.dDurationMs) / 1000 : start;
		let lineText = "";
		for (const seg of event.segs) {
			lineText += seg.utf8;
			const word = seg.utf8.trim();
			if (word === "" || isBracketToken(word)) continue;
			words.push({ t: (event.tStartMs + (seg.tOffsetMs ?? 0)) / 1000, text: word });
		}
		lines.push({ start, end, text: lineText.trim() });
	}
	return { words, lines };
}

function parseVttTimestamp(value: string): number {
	const match = value.match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/);
	if (match === null) throw new Error(`fc-feedback: invalid vtt timestamp: ${value}`);
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	const millis = Number(match[4]);
	return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/** Splits a raw (tag-bearing) cue line into timed words on its inline `<HH:MM:SS.mmm>` tags. */
function extractVttWords(rawLine: string, cueStart: number): CaptionWord[] {
	const tagPattern = /<(\d+:\d{2}:\d{2}\.\d{3})>/g;
	const segments: { time: number; text: string }[] = [];
	let lastIndex = 0;
	let time = cueStart;
	let match: RegExpExecArray | null;
	while ((match = tagPattern.exec(rawLine)) !== null) {
		segments.push({ time, text: rawLine.slice(lastIndex, match.index) });
		time = parseVttTimestamp(match[1]);
		lastIndex = tagPattern.lastIndex;
	}
	segments.push({ time, text: rawLine.slice(lastIndex) });

	const words: CaptionWord[] = [];
	for (const segment of segments) {
		const clean = segment.text.replace(/<[^>]*>/g, "");
		for (const token of clean.split(/\s+/)) {
			const text = token.trim();
			if (text === "" || isBracketToken(text)) continue;
			words.push({ t: segment.time, text });
		}
	}
	return words;
}

/**
 * Parses a WebVTT auto-caption track. YouTube's vtt rolls each cue's text
 * down as a new word arrives, so a cue's first line is usually a verbatim
 * repeat of the previous cue's last line. A line counts as new only when it
 * was not one of the immediately preceding cue's lines — that is the
 * dedupe rule, checked against the *unfiltered* previous lines so a
 * repeated bracket marker or blank line is recognized as a repeat too.
 */
export function parseVtt(text: string): ParsedCaptions {
	const blocks = text
		.replace(/\r\n/g, "\n")
		.split(/\n\n+/)
		.map((block) => block.trim())
		.filter((block) => block !== "" && block.includes("-->"));

	const words: CaptionWord[] = [];
	const lines: CaptionLine[] = [];
	let previousLineSet = new Set<string>();

	for (const block of blocks) {
		const blockLines = block.split("\n");
		const timingMatch = blockLines[0].match(
			/^(\d+:\d{2}:\d{2}\.\d{3}) --> (\d+:\d{2}:\d{2}\.\d{3})/,
		);
		if (timingMatch === null) continue;
		const cueStart = parseVttTimestamp(timingMatch[1]);
		const cueEnd = parseVttTimestamp(timingMatch[2]);

		const rawTextLines = blockLines.slice(1);
		const strippedLines = rawTextLines.map((line) => line.replace(/<[^>]*>/g, "").trim());

		for (let i = 0; i < rawTextLines.length; i++) {
			const stripped = strippedLines[i];
			if (stripped === "" || isBracketToken(stripped) || previousLineSet.has(stripped)) continue;
			lines.push({ start: cueStart, end: cueEnd, text: stripped });
			words.push(...extractVttWords(rawTextLines[i], cueStart));
		}
		previousLineSet = new Set(strippedLines);
	}
	return { words, lines };
}

// ── Transcript line building (plan §4-A) ────────────────────────────────

export interface WhisperSegment {
	start: number;
	end: number;
	text: string;
	compression_ratio: number;
}

export interface VideoInput {
	id: string;
	part: number;
	whisperSegments: WhisperSegment[] | null;
	captions: ParsedCaptions | null;
}

export interface AliasRule {
	alias: string;
	name: string;
}

export interface Line {
	i: number;
	video: string;
	start: number;
	end: number;
	text: string;
}

export interface LoopStat {
	video: string;
	from: number;
	to: number;
	replaced: boolean;
}

export interface RemovedStats {
	cr: number;
	phrase: number;
	unsupported: number;
	empty: number;
}

export interface BuildLinesStats {
	removed: RemovedStats;
	loops: LoopStat[];
	replaced_by_caption: number;
	lines: number;
	mode: "asr" | "captions";
}

export interface BuildLinesResult {
	lines: Line[];
	stats: BuildLinesStats;
}

type BuildLineCandidate =
	| { kind: "asr"; start: number; end: number; text: string; compressionRatio: number }
	| { kind: "caption"; start: number; end: number; text: string };

function isDroppedPhrase(text: string): boolean {
	return text === "감사합니다." || text === "." || /다음 영상|시청|구독/.test(text);
}

function hasNearbyCaptionWord(captions: ParsedCaptions, start: number, end: number): boolean {
	const lo = start - MEDIA_CONSTANTS.captionProximitySeconds;
	const hi = end + MEDIA_CONSTANTS.captionProximitySeconds;
	return captions.words.some((word) => word.t >= lo && word.t <= hi);
}

interface LoopExpansion {
	candidates: BuildLineCandidate[];
	loops: LoopStat[];
	replacedCount: number;
}

/** Filter step 1: a run of 3+ identical consecutive non-empty texts is a loop window. */
function expandLoopWindows(video: VideoInput, segments: WhisperSegment[]): LoopExpansion {
	const candidates: BuildLineCandidate[] = [];
	const loops: LoopStat[] = [];
	let replacedCount = 0;
	let index = 0;

	while (index < segments.length) {
		const text = segments[index].text.trim();
		if (text === "") {
			candidates.push({
				kind: "asr",
				start: segments[index].start,
				end: segments[index].end,
				text: "",
				compressionRatio: segments[index].compression_ratio,
			});
			index++;
			continue;
		}
		let end = index + 1;
		while (end < segments.length && segments[end].text.trim() === text) end++;
		const runLength = end - index;

		if (runLength >= MEDIA_CONSTANTS.loopMinRun) {
			const windowStart = segments[index].start;
			const windowEnd = segments[end - 1].end;
			if (video.captions !== null) {
				const replacements = video.captions.lines.filter((line) => {
					const lineText = line.text.trim();
					return (
						lineText !== "" &&
						!isBracketToken(lineText) &&
						line.start >= windowStart &&
						line.start <= windowEnd
					);
				});
				for (const line of replacements)
					candidates.push({ kind: "caption", start: line.start, end: line.end, text: line.text });
				loops.push({ video: video.id, from: windowStart, to: windowEnd, replaced: true });
				replacedCount += runLength;
			} else {
				loops.push({ video: video.id, from: windowStart, to: windowEnd, replaced: false });
			}
		} else {
			for (let i = index; i < end; i++) {
				candidates.push({
					kind: "asr",
					start: segments[i].start,
					end: segments[i].end,
					text: segments[i].text,
					compressionRatio: segments[i].compression_ratio,
				});
			}
		}
		index = end;
	}
	return { candidates, loops, replacedCount };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces every alias with its member's name in one pass, so a replacement
 * is never re-scanned by a shorter alias (e.g. name "파인드" + alias "파인"
 * must not turn an already-correct "파인드" into "파인드드"). Each member's
 * own name is added as a self-mapping alongside its aliases so, once
 * patterns are tried longest-first, the full name matches before a shorter
 * alias that happens to be its prefix.
 */
function applyAliases(text: string, aliases: AliasRule[]): string {
	if (aliases.length === 0) return text;
	const replacement = new Map<string, string>();
	for (const rule of aliases) replacement.set(rule.alias, rule.name);
	for (const rule of aliases) replacement.set(rule.name, rule.name);
	const pattern = [...replacement.keys()]
		.sort((a, b) => b.length - a.length)
		.map((key) => escapeRegExp(key))
		.join("|");
	return text.replace(new RegExp(pattern, "g"), (match) => replacement.get(match) ?? match);
}

interface CollectedLine {
	video: string;
	part: number;
	start: number;
	end: number;
	text: string;
}

/**
 * Builds the final transcript line list across all videos (plan §4-A):
 * loop-window collapse → compression_ratio>2.4 drop → greeting/empty-phrase
 * drop → (asr mode, when captions exist) caption-proximity drop → alias
 * normalization → sort by (part, start) → sequential `i`.
 */
export function buildLines(input: {
	videos: VideoInput[];
	aliases: AliasRule[];
	mode: "asr" | "captions";
}): BuildLinesResult {
	const removed: RemovedStats = { cr: 0, phrase: 0, unsupported: 0, empty: 0 };
	const loops: LoopStat[] = [];
	let replacedByCaption = 0;
	const collected: CollectedLine[] = [];

	for (const video of input.videos) {
		if (input.mode === "asr") {
			const expansion = expandLoopWindows(video, video.whisperSegments ?? []);
			loops.push(...expansion.loops);
			replacedByCaption += expansion.replacedCount;

			for (const candidate of expansion.candidates) {
				const text = candidate.text.trim();
				if (text === "") {
					removed.empty++;
					continue;
				}
				if (
					candidate.kind === "asr" &&
					candidate.compressionRatio > MEDIA_CONSTANTS.maxCompressionRatio
				) {
					removed.cr++;
					continue;
				}
				if (isDroppedPhrase(text)) {
					removed.phrase++;
					continue;
				}
				if (
					candidate.kind === "asr" &&
					video.captions !== null &&
					!hasNearbyCaptionWord(video.captions, candidate.start, candidate.end)
				) {
					removed.unsupported++;
					continue;
				}
				collected.push({
					video: video.id,
					part: video.part,
					start: candidate.start,
					end: candidate.end,
					text,
				});
			}
		} else {
			for (const line of video.captions?.lines ?? []) {
				const text = line.text.trim();
				if (text === "" || isBracketToken(text)) {
					removed.empty++;
					continue;
				}
				if (isDroppedPhrase(text)) {
					removed.phrase++;
					continue;
				}
				collected.push({
					video: video.id,
					part: video.part,
					start: line.start,
					end: line.end,
					text,
				});
			}
		}
	}

	const aliased = collected.map((line) => ({
		...line,
		text: applyAliases(line.text, input.aliases),
	}));
	aliased.sort((a, b) => a.part - b.part || a.start - b.start);
	const lines: Line[] = aliased.map((line, i) => ({
		i,
		video: line.video,
		start: line.start,
		end: line.end,
		text: line.text,
	}));

	if (lines.length === 0) throw new Error("전사 결과가 비어 있습니다");

	return {
		lines,
		stats: {
			removed,
			loops,
			replaced_by_caption: replacedByCaption,
			lines: lines.length,
			mode: input.mode,
		},
	};
}

// ── ffmpeg stderr parsing (plan §4-B) ───────────────────────────────────

export interface Silence {
	start: number;
	end: number;
	dur: number;
}

export function parseSilencedetect(stderr: string): Silence[] {
	const starts = [...stderr.matchAll(/silence_start:\s*(-?[0-9.]+)/g)];
	const ends = [
		...stderr.matchAll(/silence_end:\s*(-?[0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g),
	];
	const count = Math.min(starts.length, ends.length);
	const result: Silence[] = [];
	for (let i = 0; i < count; i++) {
		result.push({ start: Number(starts[i][1]), end: Number(ends[i][1]), dur: Number(ends[i][2]) });
	}
	return result;
}

export function parseShowinfo(stderr: string): number[] {
	return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]));
}

// ── Frame candidates (plan §4-B) ────────────────────────────────────────

export type CandidateKind = "silence" | "scene" | "interval" | "manual";

export interface Candidate {
	id: string;
	video: string;
	t: number;
	kind: CandidateKind;
	dur?: number;
}

const CANDIDATE_PRIORITY: Record<"silence" | "scene" | "interval", number> = {
	silence: 0,
	scene: 1,
	interval: 2,
};

interface RawCandidate {
	t: number;
	kind: "silence" | "scene" | "interval";
	dur?: number;
}

function collapseCandidates(raw: RawCandidate[]): RawCandidate[] {
	const sorted = [...raw].sort((a, b) => a.t - b.t);
	const groups: RawCandidate[][] = [];
	for (const item of sorted) {
		const lastGroup = groups[groups.length - 1];
		if (
			lastGroup !== undefined &&
			item.t - lastGroup[lastGroup.length - 1].t <= MEDIA_CONSTANTS.candidateMergeWindowSeconds
		) {
			lastGroup.push(item);
		} else {
			groups.push([item]);
		}
	}
	return groups.map((group) =>
		group.reduce((best, item) =>
			CANDIDATE_PRIORITY[item.kind] < CANDIDATE_PRIORITY[best.kind] ? item : best,
		),
	);
}

function assignCandidateIds(video: string, items: RawCandidate[]): Candidate[] {
	return items.map((item, i) => ({
		id: `c${String(i + 1).padStart(3, "0")}`,
		video,
		t: item.t,
		kind: item.kind,
		...(item.dur !== undefined ? { dur: item.dur } : {}),
	}));
}

/**
 * Merges silence/scene/interval frame candidates for one video: silence
 * t = max(start, end-1); candidates within 3s collapse to one, keeping the
 * highest-priority kind (silence > scene > interval); ids are c001… in
 * ascending t order.
 */
export function mergeCandidates(
	input: { silences: Silence[]; scenes: number[]; duration: number; interval: number },
	video: string,
): Candidate[] {
	const raw: RawCandidate[] = [];
	for (const silence of input.silences)
		raw.push({ t: Math.max(silence.start, silence.end - 1), kind: "silence", dur: silence.dur });
	for (const t of input.scenes) raw.push({ t, kind: "scene" });
	for (let t = 0; t <= input.duration; t += input.interval) raw.push({ t, kind: "interval" });
	return assignCandidateIds(video, collapseCandidates(raw));
}

/** Renumbers already-merged per-video candidates into one global id sequence, ordered by (part, t). */
export function renumberCandidatesAcrossVideos(
	entries: { video: string; part: number; candidates: Candidate[] }[],
): Candidate[] {
	const flattened = entries.flatMap((entry) =>
		entry.candidates.map((candidate) => ({ ...candidate, part: entry.part })),
	);
	flattened.sort((a, b) => a.part - b.part || a.t - b.t);
	return flattened.map((candidate, i) => ({
		id: `c${String(i + 1).padStart(3, "0")}`,
		video: candidate.video,
		t: candidate.t,
		kind: candidate.kind,
		...(candidate.dur !== undefined ? { dur: candidate.dur } : {}),
	}));
}

/** Row-major frame times per contact sheet: frames every `interval`s, chunked into cols*rows-sized sheets. */
export function sheetTimes(
	duration: number,
	interval: number,
	cols: number,
	rows: number,
): number[][] {
	const perSheet = cols * rows;
	const frameCount = Math.floor(duration / interval) + 1;
	const times: number[] = [];
	for (let k = 0; k < frameCount; k++) times.push(k * interval);
	const sheets: number[][] = [];
	for (let i = 0; i < times.length; i += perSheet) sheets.push(times.slice(i, i + perSheet));
	return sheets;
}

// ── Tunable constants ────────────────────────────────────────────────────

export const MEDIA_CONSTANTS = {
	maxCompressionRatio: 2.4,
	loopMinRun: 3,
	captionProximitySeconds: 5,
	silenceNoiseDb: -50,
	silenceMinDurationSeconds: 3,
	sceneThreshold: 0.35,
	candidateMergeWindowSeconds: 3,
	previewSeekBackSeconds: 3,
	sheet: {
		grid: { fps: "1/30", scale: "320:-2", tile: "4x4" },
		hud: {
			fps: "1/30",
			cropWidthFraction: 0.3,
			cropHeightFraction: 0.14,
			scale: "iw*2:-2",
			tile: "4x6",
		},
	},
	yt: { videoFormat: "bv*[height<=480]" },
	whisper: {
		default: "mlx-community/whisper-large-v3-turbo",
		hq: "mlx-community/whisper-large-v3-mlx",
		hallucinationSilenceThreshold: 2,
	},
} as const;

// ── Argument builders ────────────────────────────────────────────────────

function assertNever(value: never): never {
	throw new Error(`fc-feedback: unexpected value: ${JSON.stringify(value)}`);
}

/** yt-dlp argv. Captions try json3 first, falling back to vtt; video caps at 480p height. */
export function ytDlpArgs(
	kind: "meta" | "captions" | "audio" | "video",
	url: string,
	dir: string,
	cookies: boolean,
): string[] {
	const cookieArgs = cookies ? ["--cookies-from-browser", "chrome"] : [];
	switch (kind) {
		case "meta":
			return [
				"uvx",
				"yt-dlp",
				"--skip-download",
				"--dump-single-json",
				"--no-warnings",
				...cookieArgs,
				url,
			];
		case "captions":
			return [
				"uvx",
				"yt-dlp",
				"--skip-download",
				"--write-subs",
				"--write-auto-subs",
				"--sub-langs",
				"ko-orig,ko",
				"--sub-format",
				"json3/vtt",
				...cookieArgs,
				"-P",
				dir,
				"-o",
				"%(id)s.%(ext)s",
				url,
			];
		case "audio":
			return [
				"uvx",
				"yt-dlp",
				"-f",
				"bestaudio",
				...cookieArgs,
				"-P",
				dir,
				"-o",
				"%(id)s.%(ext)s",
				url,
			];
		case "video":
			return [
				"uvx",
				"yt-dlp",
				"-f",
				MEDIA_CONSTANTS.yt.videoFormat,
				...cookieArgs,
				"-P",
				dir,
				"-o",
				"%(id)s.%(ext)s",
				url,
			];
		default:
			return assertNever(kind);
	}
}

/** mlx-whisper argv (plan §4-A). No `--initial-prompt` — condition-on-previous-text is off instead. */
export function whisperArgs(wav: string, outDir: string, name: string, hq: boolean): string[] {
	const model = hq ? MEDIA_CONSTANTS.whisper.hq : MEDIA_CONSTANTS.whisper.default;
	return [
		"uvx",
		"--from",
		"mlx-whisper",
		"mlx_whisper",
		wav,
		"--model",
		model,
		"--language",
		"ko",
		"--word-timestamps",
		"True",
		"--condition-on-previous-text",
		"False",
		"--hallucination-silence-threshold",
		String(MEDIA_CONSTANTS.whisper.hallucinationSilenceThreshold),
		"--output-dir",
		outDir,
		"--output-name",
		name,
		"--output-format",
		"json",
		"--verbose",
		"False",
	];
}

/** Converts source audio to 16kHz mono wav for whisper. */
export function ffmpegWavArgs(input: string, output: string): string[] {
	return ["ffmpeg", "-y", "-i", input, "-ac", "1", "-ar", "16000", output];
}

/** Hybrid seek (coarse `-ss` before `-i`, fine `-ss` after) for a fast, accurate single-frame grab. */
export function ffmpegFrameArgs(video: string, t: number, out: string): string[] {
	const seek0 = Math.max(0, t - MEDIA_CONSTANTS.previewSeekBackSeconds);
	const args = [
		"ffmpeg",
		"-y",
		"-ss",
		String(seek0),
		"-i",
		video,
		"-ss",
		String(t - seek0),
		"-frames:v",
		"1",
	];
	if (out.endsWith(".webp")) args.push("-c:v", "libwebp");
	args.push(out);
	return args;
}

/** Contact-sheet argv: grid = plain tile, hud = cropped to the top-left HUD region before tiling. */
export function ffmpegSheetArgs(video: string, kind: "grid" | "hud", out: string): string[] {
	const filter =
		kind === "grid"
			? `fps=${MEDIA_CONSTANTS.sheet.grid.fps},scale=${MEDIA_CONSTANTS.sheet.grid.scale},tile=${MEDIA_CONSTANTS.sheet.grid.tile}`
			: `fps=${MEDIA_CONSTANTS.sheet.hud.fps},crop=iw*${MEDIA_CONSTANTS.sheet.hud.cropWidthFraction}:ih*${MEDIA_CONSTANTS.sheet.hud.cropHeightFraction}:0:0,scale=${MEDIA_CONSTANTS.sheet.hud.scale},tile=${MEDIA_CONSTANTS.sheet.hud.tile}`;
	return ["ffmpeg", "-y", "-i", video, "-vf", filter, out];
}

export function silencedetectArgs(input: string): string[] {
	return [
		"ffmpeg",
		"-i",
		input,
		"-af",
		`silencedetect=noise=${MEDIA_CONSTANTS.silenceNoiseDb}dB:d=${MEDIA_CONSTANTS.silenceMinDurationSeconds}`,
		"-f",
		"null",
		"-",
	];
}

export function sceneArgs(input: string): string[] {
	return [
		"ffmpeg",
		"-i",
		input,
		"-vf",
		`select='gt(scene,${MEDIA_CONSTANTS.sceneThreshold})',showinfo`,
		"-an",
		"-f",
		"null",
		"-",
	];
}
