import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
	type WhisperSegment,
} from "./media.ts";

const FIXTURES = join(import.meta.dir, "__fixtures__/media");
function fixture(name: string): string {
	return readFileSync(join(FIXTURES, name), "utf8");
}

interface RawWhisperSegment {
	start: number;
	end: number;
	text: string;
	compression_ratio: number;
}

function loadWhisperSegments(): WhisperSegment[] {
	const raw: { segments: RawWhisperSegment[] } = JSON.parse(fixture("whisper.json"));
	return raw.segments.map((s) => ({
		start: s.start,
		end: s.end,
		text: s.text,
		compression_ratio: s.compression_ratio,
	}));
}

describe("parseJson3", () => {
	test("json3는 tStartMs와 tOffsetMs를 더해 단어 시각을 계산한다", () => {
		const captions = parseJson3(fixture("cap.json3"));
		// event {tStartMs:11759, segs:[{utf8:"수님"},{utf8:" 보실",tOffsetMs:721},...]}
		const word = captions.words.find((w) => w.text === "보실");
		expect(word).toEqual({ t: (11759 + 721) / 1000, text: "보실" });
	});

	test("json3는 [음악] 같은 대괄호 토큰과 공백만 있는 토큰을 단어에서 제외한다", () => {
		const captions = parseJson3(fixture("cap.json3"));
		expect(captions.words.some((w) => w.text === "[음악]")).toBe(false);
		expect(captions.words.some((w) => w.text.trim() === "")).toBe(false);
	});

	test("json3는 segs가 있는 이벤트마다 캡션 줄을 하나씩 반환한다", () => {
		const captions = parseJson3(fixture("cap.json3"));
		const doc: { events: { segs?: unknown[] }[] } = JSON.parse(fixture("cap.json3"));
		const expectedCount = doc.events.filter((e) => e.segs !== undefined).length;
		expect(captions.lines.length).toBe(expectedCount);
	});
});

describe("parseVtt", () => {
	test("vtt는 인라인 태그를 제거하고 이전 큐와 겹치는 줄은 중복 제거한다", () => {
		const captions = parseVtt(fixture("cap.vtt"));
		// "돼요게" is echoed as the rolling top line of the next cue — must appear once.
		const occurrences = captions.lines.filter((l) => l.text === "돼요게");
		expect(occurrences.length).toBe(1);
		// no line keeps its <...> tags
		expect(captions.lines.every((l) => !l.text.includes("<"))).toBe(true);
	});

	test("vtt는 인라인 타임스탬프 태그로 단어별 시각을 추출한다", () => {
		const captions = parseVtt(fixture("cap.vtt"));
		// cue "되면은<00:00:20.119><c> 맞춰야</c><00:00:20.519><c> 되는</c>" (cue starts 00:00:19.119)
		const first = captions.words.find((w) => w.text === "되면은");
		const second = captions.words.find((w) => w.text === "맞춰야");
		expect(first).toEqual({ t: 19.119, text: "되면은" });
		expect(second).toEqual({ t: 20.119, text: "맞춰야" });
	});

	test("vtt는 [음악] 대괄호 토큰을 줄과 단어에서 제외한다", () => {
		const captions = parseVtt(fixture("cap.vtt"));
		expect(captions.lines.some((l) => l.text === "[음악]")).toBe(false);
		expect(captions.words.some((w) => w.text === "[음악]")).toBe(false);
	});
});

describe("buildLines — 픽스처 필터 통계", () => {
	test("주입된 케이스가 각각 올바른 사유로 제거되거나 자막 줄로 교체된다", () => {
		const segments = loadWhisperSegments();
		const captions = parseJson3(fixture("cap.json3"));
		const result = buildLines({
			videos: [{ id: "NUzEChn9EyI", part: 1, whisperSegments: segments, captions }],
			aliases: [],
			mode: "asr",
		});

		expect(result.stats.removed).toEqual({ cr: 1, phrase: 2, unsupported: 1, empty: 1 });
		expect(result.stats.loops).toEqual([
			{ video: "NUzEChn9EyI", from: 236, to: 240, replaced: true },
		]);
		expect(result.stats.replaced_by_caption).toBe(4);
		expect(result.stats.lines).toBe(result.lines.length);
		expect(result.stats.mode).toBe("asr");
		expect(result.lines.length).toBe(25);

		const texts = result.lines.map((l) => l.text);
		expect(texts).not.toContain("괜찮아요"); // loop text itself never survives
		expect(texts).toContain("강조하거나"); // loop window replaced by the caption line inside it
		expect(texts).not.toContain("감사합니다."); // exact-phrase drop
		expect(texts).not.toContain("시청해주셔서 감사합니다"); // regex phrase drop (/시청/)
		expect(texts.some((t) => t.includes("반복반복"))).toBe(false); // compression_ratio > 2.4 drop
		expect(texts).not.toContain("테스트 문장입니다"); // no caption word within ±5s

		expect(result.lines.map((l) => l.i)).toEqual([...result.lines.keys()]);
		expect(result.lines.every((l) => l.video === "NUzEChn9EyI")).toBe(true);
	});
});

describe("buildLines — 자막 없는 루프", () => {
	test("자막이 없는 루프 구간은 삭제되고 replaced는 false로 기록된다", () => {
		const segments: WhisperSegment[] = [
			{ start: 0, end: 1, text: "괜찮아요", compression_ratio: 1 },
			{ start: 1, end: 2, text: "괜찮아요", compression_ratio: 1 },
			{ start: 2, end: 3, text: "괜찮아요", compression_ratio: 1 },
			{ start: 10, end: 12, text: "정상적인 발화입니다", compression_ratio: 1 },
		];
		const result = buildLines({
			videos: [{ id: "V1", part: 1, whisperSegments: segments, captions: null }],
			aliases: [],
			mode: "asr",
		});
		expect(result.stats.loops).toEqual([{ video: "V1", from: 0, to: 3, replaced: false }]);
		expect(result.stats.replaced_by_caption).toBe(0);
		expect(result.lines).toEqual([
			{ i: 0, video: "V1", start: 10, end: 12, text: "정상적인 발화입니다" },
		]);
	});
});

describe("buildLines — 빈 결과", () => {
	test("모든 줄이 걸러지면 전사 결과가 비어 있다는 에러를 던진다", () => {
		const segments: WhisperSegment[] = [
			{ start: 0, end: 1, text: "감사합니다.", compression_ratio: 1 },
		];
		expect(() =>
			buildLines({
				videos: [{ id: "V1", part: 1, whisperSegments: segments, captions: null }],
				aliases: [],
				mode: "asr",
			}),
		).toThrow("전사 결과가 비어 있습니다");
	});
});

describe("buildLines — 별칭 정규화", () => {
	test("긴 별칭을 먼저 적용해 짧은 별칭이 부분 문자열을 깨지 않는다", () => {
		const segments: WhisperSegment[] = [
			{ start: 0, end: 2, text: "씨이에프 화이팅", compression_ratio: 1 },
		];
		const result = buildLines({
			videos: [{ id: "V1", part: 1, whisperSegments: segments, captions: null }],
			aliases: [
				{ alias: "씨이", name: "짧은" },
				{ alias: "씨이에프", name: "C.E.F." },
			],
			mode: "asr",
		});
		expect(result.lines[0].text).toBe("C.E.F. 화이팅");
	});

	test("별칭이 이름의 접두사여도 이미 이름인 텍스트를 다시 치환하지 않는다", () => {
		const segments: WhisperSegment[] = [
			{ start: 0, end: 2, text: "파인드님 파인님", compression_ratio: 1 },
		];
		const result = buildLines({
			videos: [{ id: "V1", part: 1, whisperSegments: segments, captions: null }],
			aliases: [{ alias: "파인", name: "파인드" }],
			mode: "asr",
		});
		expect(result.lines[0].text).toBe("파인드님 파인드님");
	});

	test("치환 결과가 다른 별칭에 다시 걸리지 않는다", () => {
		const segments: WhisperSegment[] = [
			{ start: 0, end: 2, text: "라마 나다", compression_ratio: 1 },
		];
		const result = buildLines({
			videos: [{ id: "V1", part: 1, whisperSegments: segments, captions: null }],
			aliases: [
				{ alias: "라마", name: "가나다" },
				{ alias: "나다", name: "확정" },
			],
			mode: "asr",
		});
		expect(result.lines[0].text).toBe("가나다 확정");
	});
});

describe("buildLines — 여러 영상 정렬", () => {
	test("줄은 (part, start) 순으로 정렬되고 i가 0부터 매겨진다", () => {
		const videoB: WhisperSegment[] = [
			{ start: 5, end: 6, text: "두번째 파트 발화", compression_ratio: 1 },
		];
		const videoA: WhisperSegment[] = [
			{ start: 20, end: 21, text: "첫 파트 나중 발화", compression_ratio: 1 },
			{ start: 1, end: 2, text: "첫 파트 첫 발화", compression_ratio: 1 },
		];
		const result = buildLines({
			videos: [
				{ id: "B", part: 2, whisperSegments: videoB, captions: null },
				{ id: "A", part: 1, whisperSegments: videoA, captions: null },
			],
			aliases: [],
			mode: "asr",
		});
		expect(result.lines.map((l) => ({ i: l.i, video: l.video, text: l.text }))).toEqual([
			{ i: 0, video: "A", text: "첫 파트 첫 발화" },
			{ i: 1, video: "A", text: "첫 파트 나중 발화" },
			{ i: 2, video: "B", text: "두번째 파트 발화" },
		]);
	});
});

describe("buildLines — captions 모드", () => {
	test("captions 모드는 자막 줄을 직접 사용하고 인사/빈 문구는 걸러낸다", () => {
		const captions = parseJson3(
			JSON.stringify({
				events: [
					{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "정상 발화" }] },
					{ tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "감사합니다." }] },
					{ tStartMs: 2000, dDurationMs: 500, segs: [{ utf8: "\n" }] },
				],
			}),
		);
		const result = buildLines({
			videos: [{ id: "V1", part: 1, whisperSegments: null, captions }],
			aliases: [],
			mode: "captions",
		});
		expect(result.lines).toEqual([{ i: 0, video: "V1", start: 0, end: 1, text: "정상 발화" }]);
		expect(result.stats.removed).toEqual({ cr: 0, phrase: 1, unsupported: 0, empty: 1 });
	});
});

describe("parseSilencedetect / parseShowinfo — ffmpeg 출력 파싱", () => {
	test("parseSilencedetect는 ffmpeg stderr에서 무음 구간 시작/끝/길이를 파싱한다", () => {
		const silences = parseSilencedetect(fixture("silencedetect.txt"));
		expect(silences.length).toBe(8);
		expect(silences[0]).toEqual({ start: 1.19613, end: 9.56038, dur: 8.36425 });
		expect(silences[silences.length - 1]).toEqual({ start: 103.357, end: 146.948, dur: 43.5913 });
	});

	test("parseShowinfo는 pts_time 값을 순서대로 추출한다", () => {
		const times = parseShowinfo(fixture("showinfo.txt"));
		expect(times).toEqual([720.167, 720.767, 731.8, 768.167, 1118.3, 1118.8, 1119.37, 1119.63]);
	});
});

describe("mergeCandidates", () => {
	test("3초 이내 후보는 병합되며 무음 > 장면 > 간격 순으로 우선한다", () => {
		const candidates = mergeCandidates(
			{
				silences: [{ start: 10, end: 12, dur: 3 }], // t = max(10, 12-1) = 11
				scenes: [12.5, 61.0],
				duration: 100,
				interval: 30, // interval candidates at 0, 30, 60, 90
			},
			"V1",
		);
		expect(candidates).toEqual([
			{ id: "c001", video: "V1", t: 0, kind: "interval" },
			{ id: "c002", video: "V1", t: 11, kind: "silence", dur: 3 },
			{ id: "c003", video: "V1", t: 30, kind: "interval" },
			{ id: "c004", video: "V1", t: 61, kind: "scene" },
			{ id: "c005", video: "V1", t: 90, kind: "interval" },
		]);
	});
});

describe("renumberCandidatesAcrossVideos", () => {
	test("여러 영상의 후보를 (part, t) 순으로 재정렬해 전역 id를 매긴다", () => {
		const result = renumberCandidatesAcrossVideos([
			{
				video: "B",
				part: 2,
				candidates: [{ id: "c001", video: "B", t: 5, kind: "scene" }],
			},
			{
				video: "A",
				part: 1,
				candidates: [
					{ id: "c001", video: "A", t: 20, kind: "interval" },
					{ id: "c002", video: "A", t: 2, kind: "silence", dur: 4 },
				],
			},
		]);
		expect(result).toEqual([
			{ id: "c001", video: "A", t: 2, kind: "silence", dur: 4 },
			{ id: "c002", video: "A", t: 20, kind: "interval" },
			{ id: "c003", video: "B", t: 5, kind: "scene" },
		]);
	});
});

describe("sheetTimes", () => {
	test("한 장에 다 들어가면 시트가 하나다", () => {
		expect(sheetTimes(100, 30, 2, 2)).toEqual([[0, 30, 60, 90]]);
	});

	test("칸 수를 넘으면 다음 시트로 이어지며 마지막 시트는 부분적으로 채워진다", () => {
		expect(sheetTimes(200, 30, 2, 2)).toEqual([
			[0, 30, 60, 90],
			[120, 150, 180],
		]);
	});
});

describe("ytDlpArgs", () => {
	test("meta는 다운로드 없이 단일 json을 덤프한다", () => {
		expect(ytDlpArgs("meta", "https://youtu.be/abc", "/tmp/work", false)).toEqual([
			"uvx",
			"yt-dlp",
			"--skip-download",
			"--dump-single-json",
			"--no-warnings",
			"https://youtu.be/abc",
		]);
	});

	test("captions는 json3를 우선하고 vtt로 폴백하며 ko-orig,ko만 받는다", () => {
		expect(ytDlpArgs("captions", "https://youtu.be/abc", "/tmp/work", false)).toEqual([
			"uvx",
			"yt-dlp",
			"--skip-download",
			"--write-subs",
			"--write-auto-subs",
			"--sub-langs",
			"ko-orig,ko",
			"--sub-format",
			"json3/vtt",
			"-P",
			"/tmp/work",
			"-o",
			"%(id)s.%(ext)s",
			"https://youtu.be/abc",
		]);
	});

	test("video는 480p 이하로 제한한다", () => {
		expect(ytDlpArgs("video", "https://youtu.be/abc", "/tmp/work", false)).toEqual([
			"uvx",
			"yt-dlp",
			"-f",
			"bv*[height<=480]",
			"-P",
			"/tmp/work",
			"-o",
			"%(id)s.%(ext)s",
			"https://youtu.be/abc",
		]);
	});

	test("cookies가 true면 --cookies-from-browser chrome이 추가된다", () => {
		const args = ytDlpArgs("audio", "https://youtu.be/abc", "/tmp/work", true);
		expect(args).toContain("--cookies-from-browser");
		expect(args[args.indexOf("--cookies-from-browser") + 1]).toBe("chrome");
	});
});

describe("whisperArgs", () => {
	test("기본 모델·플래그를 정확한 순서로 내보내고 --initial-prompt는 없다", () => {
		const args = whisperArgs("/tmp/work/VID.wav", "/tmp/work/asr", "VID", false);
		expect(args).toEqual([
			"uvx",
			"--from",
			"mlx-whisper",
			"mlx_whisper",
			"/tmp/work/VID.wav",
			"--model",
			"mlx-community/whisper-large-v3-turbo",
			"--language",
			"ko",
			"--word-timestamps",
			"True",
			"--condition-on-previous-text",
			"False",
			"--hallucination-silence-threshold",
			"2",
			"--output-dir",
			"/tmp/work/asr",
			"--output-name",
			"VID",
			"--output-format",
			"json",
			"--verbose",
			"False",
		]);
		expect(args).not.toContain("--initial-prompt");
	});

	test("hq는 large-v3-mlx 모델을 사용한다", () => {
		const args = whisperArgs("/tmp/work/VID.wav", "/tmp/work/asr", "VID", true);
		expect(args[args.indexOf("--model") + 1]).toBe("mlx-community/whisper-large-v3-mlx");
	});
});

describe("ffmpeg argv", () => {
	test("ffmpegWavArgs는 16kHz 모노로 변환한다", () => {
		expect(ffmpegWavArgs("in.webm", "out.wav")).toEqual([
			"ffmpeg",
			"-y",
			"-i",
			"in.webm",
			"-ac",
			"1",
			"-ar",
			"16000",
			"out.wav",
		]);
	});

	test("ffmpegFrameArgs는 -i 앞뒤로 -ss를 하이브리드 시크한다", () => {
		const args = ffmpegFrameArgs("video.webm", 100, "out.jpg");
		expect(args).toEqual([
			"ffmpeg",
			"-y",
			"-ss",
			"97",
			"-i",
			"video.webm",
			"-ss",
			"3",
			"-frames:v",
			"1",
			"out.jpg",
		]);
		const firstSs = args.indexOf("-ss");
		const secondSs = args.indexOf("-ss", firstSs + 1);
		const iIndex = args.indexOf("-i");
		expect(firstSs).toBeLessThan(iIndex);
		expect(secondSs).toBeGreaterThan(iIndex);
	});

	test("ffmpegFrameArgs는 t가 시크백 구간보다 작으면 0부터 시크한다", () => {
		const args = ffmpegFrameArgs("video.webm", 1, "out.jpg");
		expect(args).toEqual([
			"ffmpeg",
			"-y",
			"-ss",
			"0",
			"-i",
			"video.webm",
			"-ss",
			"1",
			"-frames:v",
			"1",
			"out.jpg",
		]);
	});

	test("ffmpegFrameArgs는 .webp 출력에 libwebp 인코더를 지정한다", () => {
		const args = ffmpegFrameArgs("video.webm", 10, "out.webp");
		expect(args).toEqual([
			"ffmpeg",
			"-y",
			"-ss",
			"7",
			"-i",
			"video.webm",
			"-ss",
			"3",
			"-frames:v",
			"1",
			"-c:v",
			"libwebp",
			"out.webp",
		]);
	});

	test("ffmpegSheetArgs grid는 4x4 타일로 만든다", () => {
		expect(ffmpegSheetArgs("video.webm", "grid", "sheet.jpg")).toEqual([
			"ffmpeg",
			"-y",
			"-i",
			"video.webm",
			"-vf",
			"fps=1/30,scale=320:-2,tile=4x4",
			"-start_number",
			"0",
			"sheet.jpg",
		]);
	});

	test("ffmpegSheetArgs hud는 좌상단을 잘라 4x6 타일로 만든다", () => {
		expect(ffmpegSheetArgs("video.webm", "hud", "sheet.jpg")).toEqual([
			"ffmpeg",
			"-y",
			"-i",
			"video.webm",
			"-vf",
			"fps=1/30,crop=iw*0.3:ih*0.14:0:0,scale=iw*2:-2,tile=4x6",
			"-start_number",
			"0",
			"sheet.jpg",
		]);
	});

	test("ffmpegSheetArgs는 image2 muxer 기본 start_number=1을 0으로 덮어써 sheets.json의 000 기준 파일명과 맞춘다", () => {
		const args = ffmpegSheetArgs("video.webm", "grid", "sheet-%03d.jpg");
		const outIndex = args.indexOf("sheet-%03d.jpg");
		expect(args[outIndex - 2]).toBe("-start_number");
		expect(args[outIndex - 1]).toBe("0");
	});

	test("silencedetectArgs는 MEDIA_CONSTANTS 임계값을 사용한다", () => {
		expect(silencedetectArgs("audio.wav")).toEqual([
			"ffmpeg",
			"-i",
			"audio.wav",
			"-af",
			`silencedetect=noise=${MEDIA_CONSTANTS.silenceNoiseDb}dB:d=${MEDIA_CONSTANTS.silenceMinDurationSeconds}`,
			"-f",
			"null",
			"-",
		]);
	});

	test("sceneArgs는 MEDIA_CONSTANTS 임계값을 사용한다", () => {
		expect(sceneArgs("video.webm")).toEqual([
			"ffmpeg",
			"-i",
			"video.webm",
			"-vf",
			`select='gt(scene,${MEDIA_CONSTANTS.sceneThreshold})',showinfo`,
			"-an",
			"-f",
			"null",
			"-",
		]);
	});
});
