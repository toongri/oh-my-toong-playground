import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeUrl, refId } from "./core.ts";
import { COMMANDS, rangeFrameTimes, rangeSheetArgs, toValidatedPlan } from "./fc.ts";

const FC_PATH = join(import.meta.dir, "fc.ts");
const TAXONOMY_DEFAULT_PATH = join(import.meta.dir, "taxonomy.default.yaml");
const QA_FIXTURES_DIR = join(import.meta.dir, "__fixtures__", "qa");

const roots: string[] = [];
function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "fc-feedback-cli-"));
	roots.push(root);
	return realpathSync(root);
}
function repo(name = "repo"): string {
	const root = join(tempDir(), name);
	mkdirSync(root);
	execFileSync("git", ["init", "-q", root]);
	return root;
}
function rosterFile(content = "members:\n  - id: hong\n    name: 홍길동\n    gamertag: HongGD\n    positions: [CB]\n"): string {
	const path = join(tempDir(), "roster.yaml");
	writeFileSync(path, content);
	return path;
}
/** Copies a QA fixture work dir's static JSON files (no img/, no *.validated.json) into `destDir`. */
function copyQaWorkFiles(srcDir: string, destDir: string): void {
	for (const name of [
		"session.json",
		"lines.json",
		"candidates.json",
		"plan.json",
		"notes.json",
		"similar-choices.json",
		"refs-draft.json",
		"refs.verified.json",
	]) {
		writeFileSync(join(destDir, name), readFileSync(join(srcDir, name)));
	}
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/** `true` stands in for `uvx yt-dlp` (FC_FEEDBACK_YTDLP_BIN), so no test of refs-bundle reaches YouTube. */
const NO_NETWORK_YTDLP = "true";

function run(args: string[], options: { cwd: string; home: string; env?: Record<string, string> }): RunResult {
	const result = Bun.spawnSync(["bun", FC_PATH, ...args], {
		cwd: options.cwd,
		env: { ...process.env, FC_FEEDBACK_YTDLP_BIN: NO_NETWORK_YTDLP, ...options.env, HOME: options.home },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		stdout: result.stdout.toString("utf8"),
		stderr: result.stderr.toString("utf8"),
		exitCode: result.exitCode ?? 1,
	};
}

/**
 * Non-blocking variant of `run`, for a command whose subprocess calls back
 * into a `Bun.serve` running in this same test process (verify-refs). A
 * `Bun.spawnSync` here would block this process's single JS thread until the
 * child exits, so the in-process server could never service the child's
 * request — a self-deadlock. `Bun.spawn` + `await proc.exited` keeps the
 * event loop free to run the server's `fetch` handler concurrently.
 */
async function runAsync(args: string[], options: { cwd: string; home: string }): Promise<RunResult> {
	const proc = Bun.spawn(["bun", FC_PATH, ...args], {
		cwd: options.cwd,
		env: { ...process.env, HOME: options.home },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("fc-feedback CLI", () => {
	test("--help는 COMMANDS의 모든 이름을 나열한다", () => {
		const cwd = repo();
		const home = tempDir();
		const result = run(["--help"], { cwd, home });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout.trim());
		const names: string[] = parsed.commands.map((command: { name: string }) => command.name);
		for (const command of COMMANDS) {
			expect(names).toContain(command.name);
		}
	});

	test("인자 없이 실행해도 --help와 동일하게 명령 목록을 출력한다", () => {
		const cwd = repo();
		const home = tempDir();
		const result = run([], { cwd, home });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout.trim());
		expect(Array.isArray(parsed.commands)).toBe(true);
		expect(parsed.commands.length).toBe(COMMANDS.length);
	});

	test("config status는 레포 밖 임시 git에서도 unconfigured를 보고한다(@lib 경로 해석 증명)", () => {
		const cwd = repo();
		const home = tempDir();
		const result = run(["config", "status"], { cwd, home });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout.trim());
		expect(parsed.mode).toBe("unconfigured");
		expect(parsed.tools).toHaveProperty("ffmpeg");
		expect(parsed.tools).toHaveProperty("uvx");
		expect(parsed.tools).toHaveProperty("git");
		expect(parsed.tools).toHaveProperty("deno");
	});

	test("config는 status(unconfigured) → set(configured) → disable(disabled)로 왕복한다", () => {
		const cwd = repo();
		const home = tempDir();

		const before = run(["config", "status"], { cwd, home });
		expect(JSON.parse(before.stdout.trim()).mode).toBe("unconfigured");

		const archive = repo("archive");
		const roster = rosterFile();
		const set = run(
			["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.github.io/team/"],
			{ cwd, home },
		);
		expect(set.exitCode).toBe(0);
		const setParsed = JSON.parse(set.stdout.trim());
		expect(setParsed.mode).toBe("configured");
		expect(setParsed.archive_repo_path).toBe(archive);
		expect(setParsed.roster_path).toBe(roster);
		expect(setParsed.pages_base_url).toBe("https://example.github.io/team/");

		const after = run(["config", "status"], { cwd, home });
		expect(JSON.parse(after.stdout.trim()).mode).toBe("configured");

		const disable = run(["config", "disable"], { cwd, home });
		expect(disable.exitCode).toBe(0);
		const disableParsed = JSON.parse(disable.stdout.trim());
		expect(disableParsed.mode).toBe("disabled");
		// disable은 기존 경로를 유지한다(manifest.ts carryPaths).
		expect(disableParsed.archive_repo_path).toBe(archive);

		const finalStatus = run(["config", "status"], { cwd, home });
		expect(JSON.parse(finalStatus.stdout.trim()).mode).toBe("disabled");
	});

	test("config set에 필수 옵션이 없으면 0이 아닌 종료코드와 stderr 메시지를 낸다", () => {
		const cwd = repo();
		const home = tempDir();
		const result = run(["config", "set", "--archive", "/tmp/whatever"], { cwd, home });
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("--roster");
	});

	test("init-archive는 없는 파일만 생성하고 기존 파일을 덮어쓰지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = tempDir();
		const customGitignore = "# 내 커스텀 gitignore\nnode_modules/\n";
		writeFileSync(join(archive, ".gitignore"), customGitignore);

		const result = run(["init-archive", "--archive", archive], { cwd, home });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout.trim());
		expect(parsed.created.sort()).toEqual(["index.html", "index.json", "roster.yaml", "taxonomy.yaml"].sort());
		expect(parsed.skipped).toEqual([".gitignore"]);

		expect(readFileSync(join(archive, ".gitignore"), "utf8")).toBe(customGitignore);
		expect(readFileSync(join(archive, "taxonomy.yaml"), "utf8")).toBe(readFileSync(TAXONOMY_DEFAULT_PATH, "utf8"));
		expect(JSON.parse(readFileSync(join(archive, "index.json"), "utf8"))).toMatchObject({
			version: 1,
			sessions: [],
			units: [],
			refs: [],
		});
		expect(readFileSync(join(archive, "index.html"), "utf8")).toContain("noindex");

		// robots.txt는 절대 만들지 않는다(plan §12-14, GitHub Pages 하위 경로에 효과 없음).
		expect(() => readFileSync(join(archive, "robots.txt"), "utf8")).toThrow();
	});

	test("init-archive의 빈 index.html은 renderIndex로 렌더되어 footer 안내문과 viewport meta를 가진다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = tempDir();

		const result = run(["init-archive", "--archive", archive], { cwd, home });
		expect(result.exitCode).toBe(0);

		const indexHtml = readFileSync(join(archive, "index.html"), "utf8");
		expect(indexHtml).toContain("팀 내부 피드백용 비공식 정리 문서입니다");
		expect(indexHtml).toContain('name="viewport"');
	});

	test("init-archive를 두 번 실행하면 두 번째는 전부 skipped로 멱등이다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = tempDir();

		run(["init-archive", "--archive", archive], { cwd, home });
		const second = run(["init-archive", "--archive", archive], { cwd, home });
		expect(second.exitCode).toBe(0);
		const parsed = JSON.parse(second.stdout.trim());
		expect(parsed.created).toEqual([]);
		expect(parsed.skipped.sort()).toEqual([".gitignore", "index.html", "index.json", "roster.yaml", "taxonomy.yaml"].sort());
	});

	test("disabled 모드에서 work-dir 명령은 첫 사용 시 taxonomy.default.yaml을 작업 디렉터리에 복사한다", () => {
		const cwd = repo();
		const home = tempDir();
		run(["config", "disable"], { cwd, home });

		const work = tempDir();
		// session.json이 없어 scan 자체는 실패하지만, taxonomy 복사는 그보다 먼저 일어난다.
		const result = run(["scan", "--work", work], { cwd, home });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("session.json");

		const copied = readFileSync(join(work, "taxonomy.yaml"), "utf8");
		expect(copied).toBe(readFileSync(TAXONOMY_DEFAULT_PATH, "utf8"));
	});

	test("configured 모드에서는 work-dir 명령이 taxonomy.yaml을 작업 디렉터리에 만들지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const roster = rosterFile();
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		const result = run(["scan", "--work", work], { cwd, home });
		expect(result.exitCode).not.toBe(0);
		expect(() => readFileSync(join(work, "taxonomy.yaml"), "utf8")).toThrow();
	});

	test("transcribe --no-speech는 음성 없이 댓글 타임스탬프로 lines.json을 만들고 명단 별칭을 적용한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const roster = rosterFile(
			"members:\n  - id: depscharger\n    name: 뎁스차저\n    gamertag: Depscharger\n    positions: [CB]\n    aliases: [켐벨]\n",
		);
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		mkdirSync(join(work, "media", "comments"), { recursive: true });
		const comments = [
			{ id: "a", parent: "root", author: "@석상용-h2t", text: "07:48 수비 라인 안 맞음\n13:44 켐벨 빠르게 안 벌리고 서있음" },
			{ id: "b", parent: "root", author: "@maker654", text: "7:45\n8:15" },
		];
		writeFileSync(join(work, "media", "comments", "fs51yGV4Fxo.json"), JSON.stringify(comments));
		const files = { audio: "media/audio/x.webm", video: "media/video/x.webm", captions: null, captions_format: null, wav: null };
		const video = { id: "fs51yGV4Fxo", url: "https://youtu.be/fs51yGV4Fxo", part: 1, title: "t", channel: "c", upload_date: "20261002", duration: 7899, embeddable: true, width: 854, height: 480 };
		writeFileSync(
			join(work, "session.json"),
			JSON.stringify({ version: 1, session_id: "20261002-fs51yGV4Fxo", created_at: "2026-10-03T00:00:00Z", videos: [{ ...video, files: { ...files, comments: "media/comments/fs51yGV4Fxo.json" } }] }),
		);

		const result = run(["transcribe", "--no-speech", "--work", work], { cwd, home });
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout).comments).toEqual({ lines: 2, empty: 2, untimed: 0, out_of_range: 0 });
		const lines = JSON.parse(readFileSync(join(work, "lines.json"), "utf8"));
		expect(lines.map((line: { start: number; text: string; source: string; author: string }) => [line.start, line.text, line.source, line.author])).toEqual([
			[468, "수비 라인 안 맞음", "comment", "@석상용-h2t"],
			[824, "뎁스차저 빠르게 안 벌리고 서있음", "comment", "@석상용-h2t"],
		]);
	});

	test("fetch에 URL이 없으면 실패한다", () => {
		const cwd = repo();
		const home = tempDir();
		const work = tempDir();
		const result = run(["fetch", "--work", work], { cwd, home });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("URL");
	});

	test("add-frame은 session.json이 없으면 실패한다", () => {
		const cwd = repo();
		const home = tempDir();
		const work = tempDir();
		const result = run(["add-frame", "--work", work, "--video", "NUzEChn9EyI", "--t", "12.5"], { cwd, home });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("session.json");
	});

	// ── scan-range ───────────────────────────────────────────────────────────

	describe("scan-range", () => {
		const VIDEO_ID = "NUzEChn9EyI";

		/** `--work` 디렉터리에 합성 영상(testsrc, 8초)과 그 영상 하나짜리 session.json을 만든다. ffmpeg가 있어야 한다. */
		function workWithVideo(): { cwd: string; home: string; work: string } {
			const cwd = repo();
			const home = tempDir();
			const work = tempDir();
			mkdirSync(join(work, "media", "video"), { recursive: true });
			execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10:duration=8", "-pix_fmt", "yuv420p", join(work, "media", "video", `${VIDEO_ID}.mp4`)], { stdio: "ignore" });
			writeFileSync(
				join(work, "session.json"),
				JSON.stringify({
					version: 1,
					session_id: `20240104-${VIDEO_ID}`,
					created_at: "2024-01-05T00:00:00.000Z",
					videos: [
						{
							id: VIDEO_ID,
							url: `https://youtu.be/${VIDEO_ID}`,
							part: 1,
							title: "테스트 영상",
							channel: "채널",
							upload_date: "20240104",
							duration: 8,
							embeddable: true,
							width: 160,
							height: 90,
							files: { audio: "media/audio/a.m4a", video: `media/video/${VIDEO_ID}.mp4`, captions: null, captions_format: null, wav: null },
						},
					],
				}),
			);
			return { cwd, home, work };
		}
		const ffmpegInstalled = Bun.spawnSync(["ffmpeg", "-version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

		test("COMMANDS가 add-frame과 같은 꼴의 usage·description으로 scan-range를 등록한다", () => {
			const spec = COMMANDS.find((command) => command.name === "scan-range");
			expect(spec?.usage).toBe("fc scan-range --video <VID> --from <sec> --to <sec> [--step 2]");
			expect(spec?.description).toContain("range");
			expect(spec?.description).toContain("컨택트시트");
		});

		test("rangeFrameTimes는 from부터 step 간격으로 to 이하까지 시각을 낸다(to가 간격에 안 맞으면 마지막 간격 전까지)", () => {
			expect(rangeFrameTimes(10, 16, 2)).toEqual([10, 12, 14, 16]);
			expect(rangeFrameTimes(10, 15, 2)).toEqual([10, 12, 14]);
			expect(rangeFrameTimes(3, 3, 2)).toEqual([3]);
			expect(rangeFrameTimes(0, 0.3, 0.1)).toEqual([0, 0.1, 0.2, 0.3]);
		});

		test("rangeFrameTimes는 잘못된 구간·간격·너무 많은 프레임을 거부한다", () => {
			expect(() => rangeFrameTimes(5, 4, 2)).toThrow("--to");
			expect(() => rangeFrameTimes(-1, 4, 2)).toThrow("--from");
			expect(() => rangeFrameTimes(0, 4, 0)).toThrow("--step");
			expect(() => rangeFrameTimes(0, 4, Number.NaN)).toThrow("--step");
			expect(() => rangeFrameTimes(0, 100, 2)).toThrow("--step");
		});

		test("rangeSheetArgs는 구간 시작으로 이동해 step 간격 프레임을 한 장에 타일링한다", () => {
			const args = rangeSheetArgs("/v.mp4", 10, 16, 2, "/out.jpg");
			expect(args.slice(0, 3)).toEqual(["ffmpeg", "-y", "-ss"]);
			expect(args[args.indexOf("-ss") + 1]).toBe("10");
			expect(args[args.indexOf("-i") + 1]).toBe("/v.mp4");
			const filter = args[args.indexOf("-vf") + 1];
			expect(filter).toContain("fps=1/2");
			expect(filter).toContain("tile=4x1");
			expect(args).toContain("-frames:v");
			expect(args[args.length - 1]).toBe("/out.jpg");
		});

		test("--video·--from·--to가 없으면 실패한다", () => {
			const cwd = repo();
			const home = tempDir();
			const work = tempDir();
			for (const [args, flag] of [
				[["--from", "1", "--to", "5"], "--video"],
				[["--video", VIDEO_ID, "--to", "5"], "--from"],
				[["--video", VIDEO_ID, "--from", "1"], "--to"],
			] as const) {
				const result = run(["scan-range", "--work", work, ...args], { cwd, home });
				expect(result.exitCode).not.toBe(0);
				expect(result.stderr).toContain(flag);
			}
		});

		test("session.json이 없으면 실패한다", () => {
			const cwd = repo();
			const home = tempDir();
			const work = tempDir();
			const result = run(["scan-range", "--work", work, "--video", VIDEO_ID, "--from", "1", "--to", "5"], { cwd, home });
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("session.json");
		});

		test.skipIf(!ffmpegInstalled)("session에 없는 video id는 실패한다", () => {
			const { cwd, home, work } = workWithVideo();
			const result = run(["scan-range", "--work", work, "--video", "AAAAAAAAAAA", "--from", "1", "--to", "5"], { cwd, home });
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("session.json에 없는 video id");
		});

		test.skipIf(!ffmpegInstalled)("--to가 영상 길이를 넘으면 실패한다", () => {
			const { cwd, home, work } = workWithVideo();
			const result = run(["scan-range", "--work", work, "--video", VIDEO_ID, "--from", "1", "--to", "99", "--step", "50"], { cwd, home });
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr).toContain("영상 길이");
		});

		test.skipIf(!ffmpegInstalled)("구간 프레임을 kind range 후보로 더하고 미리보기 jpg와 컨택트시트 한 장을 만든다", () => {
			const { cwd, home, work } = workWithVideo();
			writeFileSync(join(work, "candidates.json"), JSON.stringify([{ id: "c001", video: VIDEO_ID, t: 1, kind: "scene" }]));
			const result = run(["scan-range", "--work", work, "--video", VIDEO_ID, "--from", "2", "--to", "6", "--step", "2"], { cwd, home });
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout.trim());
			expect(parsed.candidates).toEqual([
				{ id: "c002", t: 2 },
				{ id: "c003", t: 4 },
				{ id: "c004", t: 6 },
			]);
			expect(parsed.sheet).toBe(join("sheets", `${VIDEO_ID}-range-2-6.jpg`));
			expect(readdirSync(join(work, "cand")).sort()).toEqual(["c002.jpg", "c003.jpg", "c004.jpg"]);
			expect(readFileSync(join(work, parsed.sheet)).length).toBeGreaterThan(0);
			const stored = JSON.parse(readFileSync(join(work, "candidates.json"), "utf8"));
			expect(stored).toEqual([
				{ id: "c001", video: VIDEO_ID, t: 1, kind: "scene" },
				{ id: "c002", video: VIDEO_ID, t: 2, kind: "range" },
				{ id: "c003", video: VIDEO_ID, t: 4, kind: "range" },
				{ id: "c004", video: VIDEO_ID, t: 6, kind: "range" },
			]);
		});

		test.skipIf(!ffmpegInstalled)("같은 구간을 다시 훑어도 range 후보를 중복해서 더하지 않는다", () => {
			const { cwd, home, work } = workWithVideo();
			const args = ["scan-range", "--work", work, "--video", VIDEO_ID, "--from", "2", "--to", "6", "--step", "2"];
			expect(run(args, { cwd, home }).exitCode).toBe(0);
			const again = run(args, { cwd, home });
			expect(again.exitCode).toBe(0);
			expect(JSON.parse(again.stdout.trim()).candidates.map((c: { id: string }) => c.id)).toEqual(["c001", "c002", "c003"]);
			expect(JSON.parse(readFileSync(join(work, "candidates.json"), "utf8"))).toHaveLength(3);
		});
	});

	test("알 수 없는 명령은 실패한다", () => {
		const cwd = repo();
		const home = tempDir();
		const result = run(["not-a-real-command"], { cwd, home });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("알 수 없는 명령");
	});

	// ── check plan ───────────────────────────────────────────────────────────

	function planFixture(topicTag: string, memberIds: string[] = []): string {
		return JSON.stringify({
			session_title: "테스트 세션",
			recurring: [],
			matches_without_feedback: [],
			matches: [
				{
					title: "1경기",
					lineup: Object.fromEntries(memberIds.map((id) => [id, "CB"])),
					topics: [
						{
							title: "빌드업 주제",
							summary: "빌드업 상황 정리",
							units: [
								{
									title: "센터백: 볼 빨리 내주기",
									start_line: 0,
									end_line: 0,
									position_tags: ["CB"],
									topic_tags: [topicTag],
									member_ids: memberIds,
									key_frame_candidate_ids: [],
									group_positions: [],
								},
							],
						},
					],
				},
			],
		});
	}

	function linesFixture(): string {
		return JSON.stringify([{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "테스트 대사" }]);
	}

	test("check plan은 유효한 plan.json에서 exit 0과 plan.validated.json을 만든다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		const roster = rosterFile();
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		writeFileSync(join(work, "lines.json"), linesFixture());
		writeFileSync(join(work, "plan.json"), planFixture("빌드업"));

		const result = run(["check", "plan", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout.trim());
		expect(parsed.ok).toBe(true);
		expect(parsed.pending).toBe(false);
		expect(parsed.tableMd).toContain("센터백: 볼 빨리 내주기");

		const validated = JSON.parse(readFileSync(join(work, "plan.validated.json"), "utf8"));
		expect(validated.units).toHaveLength(1);
		expect(validated.units[0].id).toBe("u001");
	});

	test("check plan은 unit 줄에 이름이 나온 로스터 멤버를 named_member_ids로 계산해 담는다(member_ids와 별개)", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		run(["config", "set", "--archive", archive, "--roster", rosterFile(), "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		writeFileSync(join(work, "lines.json"), JSON.stringify([{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "홍길동과 거리가 벌어짐" }]));
		writeFileSync(join(work, "plan.json"), planFixture("빌드업"));

		expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
		const validated = JSON.parse(readFileSync(join(work, "plan.validated.json"), "utf8"));
		expect(validated.units[0].member_ids).toEqual([]);
		expect(validated.units[0].named_member_ids).toEqual(["hong"]);
	});

	test("named_member_ids가 없는 옛 plan.validated.json은 member_ids(옛 의미: 불린 이름)를 named로 읽는다", () => {
		const legacyUnit = { id: "u001", match_id: "m1", topic_id: "m1-t1", video: "NUzEChn9EyI", start: 0, end: 5, title: "유닛", position_tags: [], topic_tags: [], member_ids: ["hong"], key_frame_candidate_ids: [] };
		const plan = toValidatedPlan({ version: 1, session_title: "t", matches: [], units: [legacyUnit] });
		expect(plan.units[0].member_ids).toEqual(["hong"]);
		expect(plan.units[0].named_member_ids).toEqual(["hong"]);
		const current = toValidatedPlan({ version: 1, session_title: "t", matches: [], units: [{ ...legacyUnit, named_member_ids: [] }] });
		expect(current.units[0].named_member_ids).toEqual([]);
	});

	test("member_ids가 없는 옛 recurring 항목은 주인 없음([])으로 읽는다", () => {
		const legacy = toValidatedPlan({ version: 1, session_title: "t", matches: [], units: [], recurring: [{ label: "라벨", unit_ids: ["u001", "u002"] }] });
		expect(legacy.recurring).toEqual([{ label: "라벨", unit_ids: ["u001", "u002"], member_ids: [] }]);
		const current = toValidatedPlan({ version: 1, session_title: "t", matches: [], units: [], recurring: [{ label: "라벨", unit_ids: ["u001"], member_ids: ["hong"] }] });
		expect(current.recurring[0].member_ids).toEqual(["hong"]);
	});

	test("좌우 포지션 코드를 쓴 옛 plan.validated.json은 position_tags·group_positions·lineup을 새 코드로 읽는다", () => {
		const legacyUnit = { id: "u001", match_id: "m1", topic_id: "m1-t1", video: "NUzEChn9EyI", start: 0, end: 5, title: "유닛", position_tags: ["LB", "RB", "CF"], group_positions: ["RB"], topic_tags: [], member_ids: [], key_frame_candidate_ids: [] };
		const plan = toValidatedPlan({ version: 1, session_title: "t", matches: [{ id: "m1", title: "1경기", topics: [], lineup: { hong: "LWB", kim: "CB" } }], units: [legacyUnit] });
		expect(plan.units[0].position_tags).toEqual(["FB", "ST"]);
		expect(plan.units[0].group_positions).toEqual(["FB"]);
		expect(plan.matches[0].lineup).toEqual({ hong: "WB", kim: "CB" });
		// group_positions가 없던 더 옛 파일은 position_tags를 그대로 대상으로 읽되, 그 값도 새 코드다.
		const { group_positions: _omit, ...older } = legacyUnit;
		expect(toValidatedPlan({ version: 1, session_title: "t", matches: [], units: [older] }).units[0].group_positions).toEqual(["FB", "ST"]);
	});

	test("matches_without_feedback이 없는 옛 plan.validated.json은 []로 읽는다", () => {
		expect(toValidatedPlan({ version: 1, session_title: "t", matches: [], units: [] }).matches_without_feedback).toEqual([]);
		const current = toValidatedPlan({ version: 1, session_title: "t", matches: [], units: [], matches_without_feedback: ["2경기 · LVT 대 AL"] });
		expect(current.matches_without_feedback).toEqual(["2경기 · LVT 대 AL"]);
	});

	test("check plan은 recurring을 plan.validated.json에 label과 unit_ids로 담는다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		run(["config", "set", "--archive", archive, "--roster", rosterFile(), "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		writeFileSync(
			join(work, "lines.json"),
			JSON.stringify([
				{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "라인이 안 맞음" },
				{ i: 1, video: "NUzEChn9EyI", start: 10, end: 15, text: "또 라인이 안 맞음" },
			]),
		);
		const plan = JSON.parse(planFixture("빌드업"));
		const unit = plan.matches[0].topics[0].units[0];
		plan.matches[0].topics[0].units = [
			{ ...unit, start_line: 0, end_line: 0 },
			{ ...unit, title: "센터백: 공 오래 끌지 않기", start_line: 1, end_line: 1 },
		];
		plan.recurring = [{ label: "수비 라인이 맞지 않음", lines: [1, 0], member_ids: [] }];
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));

		const result = run(["check", "plan", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		const validated = JSON.parse(readFileSync(join(work, "plan.validated.json"), "utf8"));
		expect(validated.recurring).toEqual([{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u002"], member_ids: [] }]);
	});

	test("check plan은 반복 지적 후보를 stderr 경고로 내고 exit 0을 유지한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		run(["config", "set", "--archive", archive, "--roster", rosterFile(), "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		writeFileSync(
			join(work, "lines.json"),
			JSON.stringify([
				{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "반대편을 봐야" },
				{ i: 1, video: "NUzEChn9EyI", start: 10, end: 15, text: "반대편이나 두두를 봐야" },
			]),
		);
		const plan = JSON.parse(planFixture("빌드업"));
		const unit = plan.matches[0].topics[0].units[0];
		plan.matches[0].topics[0].units = [
			{ ...unit, title: "뎁스차저: 뒤로 끌거나 반대편 보기", start_line: 0, end_line: 0 },
			{ ...unit, title: "뎁스차저: 반대편이나 두두 보기", start_line: 1, end_line: 1 },
		];
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));

		const result = run(["check", "plan", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain('fc-feedback: 경고 반복 지적 후보 u001·u002 "뎁스차저" 공통어 "반대편", "보기" — 같은 잘못이면 recurring에 묶는다');
	});

	test("check plan은 lineup 누락 팀원과 유닛 끝 직후 미배정 줄을 stderr 경고로 내고 exit 0과 plan.validated.json을 유지한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		run(["config", "set", "--archive", archive, "--roster", rosterFile(), "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		writeFileSync(
			join(work, "lines.json"),
			JSON.stringify([
				{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "홍길동 뒤로 빼세요" },
				{ i: 1, video: "NUzEChn9EyI", start: 6.5, end: 8, text: "새로 패널티" },
			]),
		);
		writeFileSync(join(work, "plan.json"), planFixture("빌드업"));

		const result = run(["check", "plan", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain('fc-feedback: 경고 u001 끝 직후 어느 유닛에도 없는 줄: 1(0:06) "새로 패널티" — 그 장면의 결과나 지시면 유닛 범위에 넣는다');
		expect(existsSync(join(work, "plan.validated.json"))).toBe(true);
	});

	test("check plan은 proposed_tags를 사용하면 exit 2로 보류한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		const roster = rosterFile();
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		writeFileSync(join(work, "lines.json"), linesFixture());
		const plan = JSON.parse(planFixture("신규태그"));
		plan.proposed_tags = [{ tag: "신규태그", reason: "새로운 유형" }];
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));

		const result = run(["check", "plan", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(2);
		const parsed = JSON.parse(result.stdout.trim());
		expect(parsed.pending).toBe(true);
		expect(parsed.proposed).toEqual([{ tag: "신규태그", reason: "새로운 유형" }]);
		expect(() => readFileSync(join(work, "plan.validated.json"), "utf8")).toThrow();
	});

	test("check plan은 무효한 plan.json에서 exit 1과 stderr JSON 오류를 낸다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		const roster = rosterFile();
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		writeFileSync(join(work, "lines.json"), linesFixture());
		const plan = JSON.parse(planFixture("빌드업"));
		delete plan.session_title;
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));

		const result = run(["check", "plan", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		const errors = JSON.parse(result.stderr.trim());
		expect(Array.isArray(errors)).toBe(true);
		expect(errors.some((error: { path: string }) => error.path === "session_title")).toBe(true);
	});

	// ── check notes ──────────────────────────────────────────────────────────

	function checkNotesWorkDir(cwd: string, home: string, archive: string): string {
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		const roster = rosterFile();
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });
		const work = tempDir();
		writeFileSync(join(work, "lines.json"), linesFixture());
		writeFileSync(join(work, "plan.json"), planFixture("빌드업"));
		expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
		return work;
	}

	test("check notes는 볼드 없는 unit에서 exit 0을 유지하며 stderr에 볼드 경고를 낸다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const work = checkNotesWorkDir(cwd, home, archive);
		writeFileSync(join(work, "candidates.json"), JSON.stringify([{ id: "c001", video: "NUzEChn9EyI", t: 2, kind: "manual" }]));
		writeFileSync(
			join(work, "notes.json"),
			JSON.stringify({
				version: 2,
				units: {
					u001: {
						blocks: [
							{ type: "text", text: "볼드가 없는 문장입니다" },
							{ type: "frame", candidate_id: "c001", caption: "장면" },
						],
					},
				},
			}),
		);

		const result = run(["check", "notes", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toEqual({ ok: true });
		expect(result.stderr).toContain(
			"fc-feedback: 경고 u001: 볼드 행동 없음 — 원문이 할 행동을 요청하면 첫 문단에 그 행동을 볼드로 쓰고, 원문에 잘못·상태·결과만 있으면 볼드 없이 둔다. 지시·평가가 없는 음성 구간이면 인접 유닛에 합칠지 확인(댓글 유닛은 합치지 않는다)",
		);
	});

	test("check notes는 명단 멤버가 본문에만 나오면 stderr에 캡션 누락 경고를 낸다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const work = checkNotesWorkDir(cwd, home, archive);
		writeFileSync(join(work, "candidates.json"), JSON.stringify([{ id: "c001", video: "NUzEChn9EyI", t: 2, kind: "manual" }]));
		writeFileSync(
			join(work, "notes.json"),
			JSON.stringify({
				version: 2,
				units: { u001: { blocks: [{ type: "text", text: "**패스**를 홍길동에게 줬어야 한다" }, { type: "frame", candidate_id: "c001", caption: "장면" }] } },
			}),
		);
		const result = run(["check", "notes", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain("fc-feedback: 경고 u001: 본문에 나온 홍길동이(가) 어느 캡션에도 없음");
	});

	test("check notes는 볼드와 frame이 모두 있는 unit에서 경고를 내지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const work = checkNotesWorkDir(cwd, home, archive);
		writeFileSync(join(work, "candidates.json"), JSON.stringify([{ id: "c001", video: "NUzEChn9EyI", t: 2, kind: "manual" }]));
		writeFileSync(
			join(work, "notes.json"),
			JSON.stringify({
				version: 2,
				units: {
					u001: {
						blocks: [
							{ type: "text", text: "**볼드** 문장입니다" },
							{ type: "frame", candidate_id: "c001", caption: "장면" },
						],
					},
				},
			}),
		);

		const result = run(["check", "notes", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.trim())).toEqual({ ok: true });
		expect(result.stderr).toBe("");
	});

	test("check notes는 unidentified_member_ids에 scan-range가 만든 range 후보(candidates.json의 kind range)를 요구한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		run(["config", "set", "--archive", archive, "--roster", rosterFile(), "--pages-url", "https://example.com/"], { cwd, home });
		const work = tempDir();
		writeFileSync(join(work, "lines.json"), linesFixture());
		writeFileSync(join(work, "plan.json"), planFixture("빌드업", ["hong"]));
		expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
		writeFileSync(
			join(work, "notes.json"),
			JSON.stringify({
				version: 2,
				units: {
					u001: {
						blocks: [
							{ type: "text", text: "**패스하기**가 맞습니다" },
							{ type: "frame", candidate_id: "c001", caption: "장면" },
						],
						unidentified_member_ids: ["hong"],
						look_at: "화면 위쪽 마크 없는 선수",
					},
				},
			}),
		);

		writeFileSync(join(work, "candidates.json"), JSON.stringify([{ id: "c001", video: "NUzEChn9EyI", t: 2, kind: "manual" }]));
		const without = run(["check", "notes", "--work", work], { cwd, home });
		expect(without.exitCode).toBe(1);
		expect(without.stderr).toContain("u001: 고칠 사람을 사진에서 못 찾았다고 했지만 이 유닛 범위 전체를 scan-range로 훑은 기록이 없다");

		writeFileSync(
			join(work, "candidates.json"),
			JSON.stringify([
				{ id: "c001", video: "NUzEChn9EyI", t: 2, kind: "manual" },
				{ id: "c002", video: "NUzEChn9EyI", t: 4, kind: "range" },
			]),
		);
		// range 후보 한 장은 유닛 범위(0~5초) 전체를 훑은 기록이 아니다.
		expect(run(["check", "notes", "--work", work], { cwd, home }).stderr).toContain("이 유닛 범위 전체를 scan-range로 훑은 기록이 없다");

		writeFileSync(
			join(work, "candidates.json"),
			JSON.stringify([
				{ id: "c001", video: "NUzEChn9EyI", t: 2, kind: "manual" },
				{ id: "c002", video: "NUzEChn9EyI", t: 4, kind: "range" },
				{ id: "c003", video: "NUzEChn9EyI", t: 0, kind: "range" },
				{ id: "c004", video: "NUzEChn9EyI", t: 2, kind: "range" },
			]),
		);
		expect(run(["check", "notes", "--work", work], { cwd, home }).exitCode).toBe(0);
	});

	test("check refs는 가장 많이 반복된 label에 pro_clubs 자료가 없으면 stderr 경고를 내고 exit 0을 유지한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		run(["config", "set", "--archive", archive, "--roster", rosterFile(), "--pages-url", "https://example.com/"], { cwd, home });
		const work = tempDir();
		writeFileSync(
			join(work, "lines.json"),
			JSON.stringify([
				{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "첫째 대사" },
				{ i: 1, video: "NUzEChn9EyI", start: 10, end: 15, text: "둘째 대사" },
			]),
		);
		const plan = JSON.parse(planFixture("빌드업"));
		const unit = plan.matches[0].topics[0].units[0];
		plan.matches[0].topics[0].units = [
			{ ...unit, start_line: 0, end_line: 0 },
			{ ...unit, title: "센터백: 라인 올리기", start_line: 1, end_line: 1 },
		];
		plan.recurring = [{ label: "수비 라인이 맞지 않음", lines: [0, 1], member_ids: [] }];
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
		expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
		writeFileSync(
			join(work, "session.json"),
			JSON.stringify({
				version: 1,
				session_id: "20240104-NUzEChn9EyI",
				created_at: "2024-01-05T00:00:00.000Z",
				videos: [
					{
						id: "NUzEChn9EyI", url: "https://youtu.be/NUzEChn9EyI", part: 1, title: "경기 영상", channel: "c", upload_date: "20240104",
						duration: 100, embeddable: true, width: 640, height: 480,
						files: { audio: "a", video: "v", captions: null, captions_format: null, wav: null },
					},
				],
			}),
		);
		writeFileSync(
			join(work, "refs-draft.json"),
			JSON.stringify({
				version: 1,
				recurring_unfound: [],
				units_unfound: [],
				refs: [
					{
						url: "https://example.com/tactics",
						title: "전술",
						source_name: "예시",
						lang: "ko",
						kind: "tactics",
						unit_ids: ["u001", "u002"],
						format: "article",
						recurring_labels: ["수비 라인이 맞지 않음"],
						relevance_ko: { u001: "첫 장면의 라인 간격을 다룬다", u002: "둘째 장면의 라인 높이를 다룬다" },
					},
				],
			}),
		);

		const result = run(["check", "refs", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain("fc-feedback: 경고 가장 많이 반복된 '수비 라인이 맞지 않음'에 프로클럽 자료가 없다 — 프로클럽 수비전술 강좌·같은 채널 label 핵심어로 더 찾는다");
	});

	// ── taxonomy add ─────────────────────────────────────────────────────────

	test("taxonomy add는 이미 있는 태그를 다시 추가해도 멱등이다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		const roster = rosterFile();
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });
		const work = tempDir();

		const first = run(["taxonomy", "add", "빌드업", "새태그", "--work", work], { cwd, home });
		expect(first.exitCode).toBe(0);
		const firstParsed = JSON.parse(first.stdout.trim());
		expect(firstParsed.added).toEqual(["새태그"]);
		expect(firstParsed.already_present).toEqual(["빌드업"]);

		const second = run(["taxonomy", "add", "빌드업", "새태그", "--work", work], { cwd, home });
		expect(second.exitCode).toBe(0);
		const secondParsed = JSON.parse(second.stdout.trim());
		expect(secondParsed.added).toEqual([]);
		expect(secondParsed.already_present.sort()).toEqual(["빌드업", "새태그"].sort());

		const finalTaxonomy = Bun.YAML.parse(readFileSync(join(archive, "taxonomy.yaml"), "utf8")) as { topics: string[] };
		expect(finalTaxonomy.topics.sort()).toEqual(["빌드업", "새태그"].sort());
	});

	test("disabled에서 taxonomy add 후 check plan은 exit 0이다", () => {
		const cwd = repo();
		const home = tempDir();
		run(["config", "disable"], { cwd, home });
		const work = tempDir();

		const add = run(["taxonomy", "add", "신규태그", "--work", work], { cwd, home });
		expect(add.exitCode).toBe(0);

		writeFileSync(join(work, "lines.json"), linesFixture());
		writeFileSync(join(work, "plan.json"), planFixture("신규태그"));

		const check = run(["check", "plan", "--work", work], { cwd, home });
		expect(check.exitCode).toBe(0);
		expect(readFileSync(join(work, "plan.validated.json"), "utf8")).toContain("신규태그");
	});

	test("번들 taxonomy.default.yaml의 sha256은 taxonomy add 후에도 변하지 않는다", () => {
		const before = createHash("sha256").update(readFileSync(TAXONOMY_DEFAULT_PATH)).digest("hex");
		const cwd = repo();
		const home = tempDir();
		run(["config", "disable"], { cwd, home });
		const work = tempDir();
		run(["taxonomy", "add", "임시태그", "--work", work], { cwd, home });
		const after = createHash("sha256").update(readFileSync(TAXONOMY_DEFAULT_PATH)).digest("hex");
		expect(after).toBe(before);
	});

	test("disabled 모드에서 명단 없이 member_ids가 비어있지 않으면 check plan은 exit 1이다", () => {
		const cwd = repo();
		const home = tempDir();
		run(["config", "disable"], { cwd, home });
		const work = tempDir();

		writeFileSync(join(work, "lines.json"), linesFixture());
		writeFileSync(join(work, "plan.json"), planFixture("빌드업", ["ghost"]));

		const result = run(["check", "plan", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(1);
		const errors = JSON.parse(result.stderr.trim());
		expect(errors.some((error: { path: string }) => error.path.includes("member_ids"))).toBe(true);
	});

	// ── frames ───────────────────────────────────────────────────────────────

	test("frames는 plan.validated.json이 없으면 실패한다", () => {
		const cwd = repo();
		const home = tempDir();
		const work = tempDir();
		const result = run(["frames", "--work", work], { cwd, home });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("plan.validated.json");
	});

	// ── similar ──────────────────────────────────────────────────────────────

	test("similar는 손으로 만든 index.json으로 similar-candidates.json을 만든다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const roster = rosterFile();
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });

		writeFileSync(
			join(archive, "index.json"),
			JSON.stringify({
				version: 1,
				updated_at: new Date().toISOString(),
				sessions: [],
				units: [
					{
						uid: "20230101-AAAAAAAAAAA#u001",
						session: "20230101-AAAAAAAAAAA",
						title: "과거 유닛",
						date: "2023-01-01",
						topic_tags: ["빌드업"],
						position_tags: ["CB"],
						member_ids: [],
						href: "sessions/20230101-AAAAAAAAAAA/index.html#u001",
					},
				],
				refs: [],
			}),
		);

		const work = tempDir();
		writeFileSync(
			join(work, "session.json"),
			JSON.stringify({
				version: 1,
				session_id: "20240104-NUzEChn9EyI",
				created_at: new Date().toISOString(),
				videos: [
					{
						id: "NUzEChn9EyI",
						url: "https://youtu.be/NUzEChn9EyI",
						part: 1,
						title: "t",
						channel: "c",
						upload_date: "20240104",
						duration: 100,
						embeddable: true,
						width: 640,
						height: 480,
						files: { audio: "a", video: "v", captions: null, captions_format: null, wav: null },
					},
				],
			}),
		);
		writeFileSync(
			join(work, "plan.validated.json"),
			JSON.stringify({
				version: 1,
				session_title: "현재 세션",
				matches: [{ id: "m1", title: "1경기", topics: [{ id: "m1-t1", title: "주제", summary: "요약", unit_ids: ["u001"] }] }],
				units: [
					{
						id: "u001",
						match_id: "m1",
						topic_id: "m1-t1",
						video: "NUzEChn9EyI",
						start: 0,
						end: 5,
						title: "유닛1",
						position_tags: ["CB"],
						topic_tags: ["빌드업"],
						member_ids: [],
						key_frame_candidate_ids: [],
						group_positions: [],
					},
				],
			}),
		);

		const result = run(["similar", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		const written = JSON.parse(readFileSync(join(work, "similar-candidates.json"), "utf8"));
		expect(written.session_id).toBe("20240104-NUzEChn9EyI");
		expect(written.units.u001).toHaveLength(1);
		expect(written.units.u001[0].uid).toBe("20230101-AAAAAAAAAAA#u001");
	});

	test("similar는 좌우 코드를 쓴 옛 index.json의 position_tags를 새 코드로 읽어 후보에 싣는다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		run(["config", "set", "--archive", archive, "--roster", rosterFile(), "--pages-url", "https://example.com/"], { cwd, home });
		writeFileSync(
			join(archive, "index.json"),
			JSON.stringify({
				version: 1,
				updated_at: new Date().toISOString(),
				sessions: [],
				units: [
					{
						uid: "20230101-AAAAAAAAAAA#u001",
						session: "20230101-AAAAAAAAAAA",
						title: "과거 유닛",
						date: "2023-01-01",
						topic_tags: ["빌드업"],
						position_tags: ["LB", "RB", "LW"],
						member_ids: [],
						href: "sessions/20230101-AAAAAAAAAAA/index.html#u001",
					},
				],
				refs: [],
			}),
		);
		const work = tempDir();
		writeFileSync(
			join(work, "session.json"),
			JSON.stringify({
				version: 1,
				session_id: "20240104-NUzEChn9EyI",
				created_at: new Date().toISOString(),
				videos: [{ id: "NUzEChn9EyI", url: "https://youtu.be/NUzEChn9EyI", part: 1, title: "t", channel: "c", upload_date: "20240104", duration: 100, embeddable: true, width: 640, height: 480, files: { audio: "a", video: "v", captions: null, captions_format: null, wav: null } }],
			}),
		);
		writeFileSync(
			join(work, "plan.validated.json"),
			JSON.stringify({
				version: 1,
				session_title: "현재 세션",
				matches: [{ id: "m1", title: "1경기", topics: [{ id: "m1-t1", title: "주제", summary: "요약", unit_ids: ["u001"] }] }],
				units: [{ id: "u001", match_id: "m1", topic_id: "m1-t1", video: "NUzEChn9EyI", start: 0, end: 5, title: "유닛1", position_tags: ["FB"], topic_tags: ["빌드업"], member_ids: [], key_frame_candidate_ids: [], group_positions: [] }],
			}),
		);
		expect(run(["similar", "--work", work], { cwd, home }).exitCode).toBe(0);
		const written = JSON.parse(readFileSync(join(work, "similar-candidates.json"), "utf8"));
		expect(written.units.u001[0].position_tags).toEqual(["FB", "WF"]);
	});

	test("disabled 모드의 similar는 index.json 없이 빈 결과를 쓴다", () => {
		const cwd = repo();
		const home = tempDir();
		run(["config", "disable"], { cwd, home });
		const work = tempDir();
		writeFileSync(
			join(work, "session.json"),
			JSON.stringify({
				version: 1,
				session_id: "20240104-NUzEChn9EyI",
				created_at: new Date().toISOString(),
				videos: [
					{
						id: "NUzEChn9EyI",
						url: "https://youtu.be/NUzEChn9EyI",
						part: 1,
						title: "t",
						channel: "c",
						upload_date: "20240104",
						duration: 100,
						embeddable: true,
						width: 640,
						height: 480,
						files: { audio: "a", video: "v", captions: null, captions_format: null, wav: null },
					},
				],
			}),
		);

		const result = run(["similar", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		const written = JSON.parse(readFileSync(join(work, "similar-candidates.json"), "utf8"));
		expect(written).toEqual({ version: 1, session_id: "20240104-NUzEChn9EyI", units: {} });
	});

	// ── verify-refs ──────────────────────────────────────────────────────────

	test("verify-refs는 200을 유지하고 301 체인을 따라가며 HEAD만 404인 페이지는 GET으로 살리고 404는 제외하며 index.json의 참고자료는 재요청하지 않는다", async () => {
		const hits: Record<string, number> = {};
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
				if (url.pathname === "/ok") return new Response("ok", { status: 200 });
				if (url.pathname === "/redirect1") return new Response(null, { status: 301, headers: { Location: "/redirect2" } });
				if (url.pathname === "/redirect2") return new Response(null, { status: 301, headers: { Location: "/final" } });
				if (url.pathname === "/final") return new Response("final", { status: 200 });
				if (url.pathname === "/missing") return new Response("missing", { status: 404 });
				if (url.pathname === "/reused") return new Response("reused", { status: 200 });
				if (url.pathname === "/head404") return new Response("page", { status: request.method === "HEAD" ? 404 : 200 });
				return new Response("not found", { status: 404 });
			},
		});

		try {
			const base = `http://127.0.0.1:${server.port}`;
			const cwd = repo();
			const home = tempDir();
			const archive = repo("archive");
			const roster = rosterFile();
			run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });

			const reusedUrl = `${base}/reused`;
			writeFileSync(
				join(archive, "index.json"),
				JSON.stringify({
					version: 1,
					updated_at: new Date().toISOString(),
					sessions: [],
					units: [],
					refs: [
						{
							id: refId(reusedUrl),
							url: normalizeUrl(reusedUrl),
							title: "재사용 문서",
							lang: "ko",
							kind: "tactics",
							page: null,
							first_session: "20230101-AAAAAAAAAAA",
						},
					],
				}),
			);

			const work = tempDir();
			writeFileSync(
				join(work, "refs-draft.json"),
				JSON.stringify({
					version: 1,
					refs: [
						{ url: `${base}/ok`, title: "OK 문서", source_name: "테스트", lang: "ko", kind: "tactics", unit_ids: ["u001"], format: "article", recurring_labels: [], relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" }, lesson_ko: { u001: "포백이 한 줄로 선다" } },
						{
							url: `${base}/redirect1`,
							title: "리다이렉트 문서",
							source_name: "테스트",
							lang: "ko",
							kind: "tactics",
							unit_ids: ["u001"], format: "article", recurring_labels: [], relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" },
						},
						{
							url: `${base}/missing`,
							title: "없는 문서",
							source_name: "테스트",
							lang: "ko",
							kind: "tactics",
							unit_ids: ["u001"], format: "article", recurring_labels: [], relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" },
						},
						{ url: reusedUrl, title: "재사용 문서", source_name: "테스트", lang: "ko", kind: "tactics", unit_ids: ["u001"], format: "article", recurring_labels: [], relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" } },
						{ url: `${base}/head404`, title: "HEAD 미지원 문서", source_name: "테스트", lang: "ko", kind: "tactics", unit_ids: ["u001"], format: "article", recurring_labels: [], relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" } },
					],
				}),
			);

			const result = await runAsync(["verify-refs", "--work", work], { cwd, home });
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout.trim());
			expect(parsed.kept).toBe(4);
			expect(parsed.dropped).toBe(1);

			const verified = JSON.parse(readFileSync(join(work, "refs.verified.json"), "utf8"));
			const byUrl = new Map(verified.refs.map((ref: { url: string }) => [ref.url, ref]));

			const ok = byUrl.get(normalizeUrl(`${base}/ok`)) as
				| { http_status: number; final_url: string; format: string; relevance_ko: Record<string, string> }
				| undefined;
			expect(ok?.http_status).toBe(200);
			expect([ok?.format, ok?.relevance_ko]).toEqual(["article", { u001: "이 장면의 빌드업 문제를 다룬다" }]);
			expect(ok?.final_url).toBe(normalizeUrl(`${base}/ok`));
			expect((ok as { lesson_ko?: Record<string, string> } | undefined)?.lesson_ko).toEqual({ u001: "포백이 한 줄로 선다" });
			expect("lesson_ko" in ((byUrl.get(normalizeUrl(`${base}/redirect1`)) as object) ?? {})).toBe(false);

			const redirected = byUrl.get(normalizeUrl(`${base}/redirect1`)) as { final_url: string } | undefined;
			expect(redirected?.final_url).toBe(normalizeUrl(`${base}/final`));

			const reused = byUrl.get(normalizeUrl(reusedUrl)) as { reused: boolean; page: string | null } | undefined;
			expect(reused?.reused).toBe(true);
			expect(reused?.page).toBeNull();
			expect(hits["/reused"]).toBeUndefined();

			expect((byUrl.get(normalizeUrl(`${base}/head404`)) as { http_status: number } | undefined)?.http_status).toBe(200);
			expect(verified.dropped).toEqual([{ url: `${base}/missing`, reason: "HTTP 404" }]);
		} finally {
			server.stop(true);
		}
	});

	// ── render / publish-prep ────────────────────────────────────────────────

	const GIT_IDENTITY_ENV = {
		GIT_AUTHOR_NAME: "테스트",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "테스트",
		GIT_COMMITTER_EMAIL: "test@example.com",
	};

	/** 1x1 lossy(`VP8 `) webp — RIFF/WEBP 헤더 + VP8 프레임 태그/시작 코드/width=1/height=1. */
	function tinyWebp(): Buffer {
		return Buffer.from([
			0x52, 0x49, 0x46, 0x46, // RIFF
			26, 0, 0, 0, // file size (LE)
			0x57, 0x45, 0x42, 0x50, // WEBP
			0x56, 0x50, 0x38, 0x20, // "VP8 "
			14, 0, 0, 0, // chunk size (LE)
			0x50, 0x01, 0x00, // frame tag
			0x9d, 0x01, 0x2a, // start code
			0x01, 0x00, // width=1
			0x01, 0x00, // height=1
			0x00, 0x00, 0x00, 0x00, // padding
		]);
	}

	function hashDir(dir: string): string {
		const hash = createHash("sha256");
		function walk(sub: string): void {
			const entries = readdirSync(join(dir, sub), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
			for (const entry of entries) {
				if (entry.name === ".git") {
					continue;
				}
				const relPath = join(sub, entry.name);
				if (entry.isDirectory()) {
					walk(relPath);
				} else {
					hash.update(relPath);
					hash.update(readFileSync(join(dir, relPath)));
				}
			}
		}
		walk(".");
		return hash.digest("hex");
	}

	function withoutUpdatedAt(indexJsonText: string): unknown {
		const parsed = JSON.parse(indexJsonText);
		delete parsed.updated_at;
		return parsed;
	}

	function buildRenderedFixture(): { cwd: string; home: string; archive: string; work: string; sessionId: string } {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		run(["init-archive", "--archive", archive], { cwd, home });
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		execFileSync("git", ["-C", archive, "add", "-A"]);
		execFileSync("git", ["-C", archive, "commit", "-q", "-m", "init"], { env: { ...process.env, ...GIT_IDENTITY_ENV } });

		const roster = rosterFile();
		run(["config", "set", "--archive", archive, "--roster", roster, "--pages-url", "https://example.com/"], { cwd, home });

		const work = tempDir();
		const sessionId = "20240104-NUzEChn9EyI";
		writeFileSync(
			join(work, "session.json"),
			JSON.stringify({
				version: 1,
				session_id: sessionId,
				created_at: new Date().toISOString(),
				videos: [
					{
						id: "NUzEChn9EyI",
						url: "https://youtu.be/NUzEChn9EyI",
						part: 1,
						title: "t",
						channel: "c",
						upload_date: "20240104",
						duration: 100,
						embeddable: true,
						width: 640,
						height: 480,
						files: { audio: "a", video: "v", captions: null, captions_format: null, wav: null },
					},
				],
			}),
		);
		writeFileSync(join(work, "lines.json"), linesFixture());
		writeFileSync(join(work, "candidates.json"), JSON.stringify([{ id: "c001", video: "NUzEChn9EyI", t: 2, kind: "manual" }]));
		const plan = JSON.parse(planFixture("빌드업"));
		plan.matches[0].topics[0].units[0].key_frame_candidate_ids = ["c001"];
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
		writeFileSync(
			join(work, "notes.json"),
			JSON.stringify({
				version: 2,
				units: {
					u001: {
						blocks: [
							{ type: "text", text: "문제는 누구 때문이며 대신 이렇게 해야 함" },
							{ type: "frame", candidate_id: "c001", caption: "캡션" },
						],
					},
				},
			}),
		);
		writeFileSync(
			join(work, "similar-candidates.json"),
			JSON.stringify({ version: 1, session_id: sessionId, units: { u001: [] } }),
		);
		writeFileSync(join(work, "similar-choices.json"), JSON.stringify({ version: 1, units: { u001: [] } }));
		writeFileSync(join(work, "refs-draft.json"), JSON.stringify({ version: 1, refs: [], recurring_unfound: [], units_unfound: [{ unit_id: "u001", queries: ["검색어 하나", "검색어 둘"], subtitle_terms: ["용어"] }] }));
		writeFileSync(join(work, "refs.verified.json"), JSON.stringify({ version: 1, refs: [], dropped: [] }));

		const imgDir = join(work, "img");
		mkdirSync(imgDir, { recursive: true });
		writeFileSync(join(imgDir, "u001-start.webp"), tinyWebp());
		writeFileSync(join(imgDir, "u001-c001.webp"), tinyWebp());

		return { cwd, home, archive, work, sessionId };
	}

	test("render은 최소 fixture로 세션을 아카이브에 렌더한다(broken_links 0)", () => {
		const { cwd, home, archive, work, sessionId } = buildRenderedFixture();

		const result = run(["render", "--work", work], { cwd, home });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout.trim());
		expect(parsed.ok).toBe(true);
		expect(parsed.output).toBe("archive");
		expect(parsed.units).toBe(1);
		expect(parsed.broken_links).toBe(0);

		const sessionDir = join(archive, "sessions", sessionId);
		const sessionHtml = readFileSync(join(sessionDir, "index.html"), "utf8");
		expect(sessionHtml).toContain("테스트 세션");

		const dataJson = JSON.parse(readFileSync(join(sessionDir, "data.json"), "utf8"));
		expect(dataJson.units).toHaveLength(1);
		expect(dataJson.units[0].images.start).toEqual({ src: "img/u001-start.webp", width: 1, height: 1 });
		expect(dataJson.units[0].body).toEqual([
			{ type: "text", text: "문제는 누구 때문이며 대신 이렇게 해야 함" },
			{ type: "frame", src: "img/u001-c001.webp", width: 1, height: 1, t: 2, caption: "캡션" },
		]);
		expect(dataJson.units[0].named_member_ids).toEqual([]);
		expect(dataJson.units[0].uid).toBe(`${sessionId}#u001`);
		expect(dataJson.units[0].watch_url).toBe("https://youtu.be/NUzEChn9EyI?t=0");

		const index = JSON.parse(readFileSync(join(archive, "index.json"), "utf8"));
		expect(index.sessions).toHaveLength(1);
		expect(index.sessions[0].id).toBe(sessionId);
		expect(index.units).toHaveLength(1);
		expect(index.units[0].href).toBe(`sessions/${sessionId}/index.html#u001`);
	});

	test("render은 notes 프레임 블록의 focus_x를 data.json body 프레임에 그대로 싣고, 없으면 필드를 만들지 않는다", () => {
		const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
		const notesPath = join(work, "notes.json");
		const notes = JSON.parse(readFileSync(notesPath, "utf8"));
		notes.units.u001.blocks[1].focus_x = 0.8;
		writeFileSync(notesPath, JSON.stringify(notes));
		expect(run(["render", "--work", work], { cwd, home }).exitCode).toBe(0);
		const dataPath = join(archive, "sessions", sessionId, "data.json");
		expect(JSON.parse(readFileSync(dataPath, "utf8")).units[0].body[1].focus_x).toBe(0.8);

		delete notes.units.u001.blocks[1].focus_x;
		writeFileSync(notesPath, JSON.stringify(notes));
		expect(run(["render", "--work", work], { cwd, home }).exitCode).toBe(0);
		expect("focus_x" in JSON.parse(readFileSync(dataPath, "utf8")).units[0].body[1]).toBe(false);
	});

	test("render은 참고자료 영상 링크를 그 유닛의 video_starts 시각으로, 옛 video_start는 모든 유닛 시각으로 연다", () => {
		const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
		const draftRef = {
			url, title: "영상", source_name: "테스트", lang: "ko", kind: "tactics", unit_ids: ["u001"], format: "video",
			recurring_labels: [], relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" }, video_starts: { u001: "1:09" },
		};
		const verifiedRef = {
			id: refId(url), url, final_url: url, http_status: 200, checked_at: "2026-10-04T00:00:00Z", reused: false, page: null,
			title: "영상", source_name: "테스트", lang: "ko", kind: "tactics", unit_ids: ["u001"], format: "video",
			relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" },
		};
		const startOf = (verified: Record<string, unknown>): unknown => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			writeFileSync(join(work, "refs-draft.json"), JSON.stringify({ version: 1, refs: [draftRef], recurring_unfound: [], units_unfound: [] }));
			writeFileSync(join(work, "refs.verified.json"), JSON.stringify({ version: 1, refs: [{ ...verifiedRef, ...verified }], dropped: [] }));
			expect(run(["render", "--work", work], { cwd, home }).exitCode).toBe(0);
			return JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).units[0].refs[0].start_seconds;
		};
		expect(startOf({ video_starts: { u001: "1:09" } })).toBe(69);
		expect(startOf({ video_start: "0:10" })).toBe(10);
	});

	test("render은 refs.verified.json의 lesson_ko를 그 유닛 참고자료의 lesson_ko와 source_name으로 싣고, lesson_ko가 없는 옛 항목은 null로 읽는다", () => {
		const url = "https://example.com/article";
		const verifiedRef = {
			id: refId(url), url, final_url: url, http_status: 200, checked_at: "2026-10-04T00:00:00Z", reused: false, page: null,
			title: "문서", source_name: "테스트 채널", lang: "ko", kind: "tactics", unit_ids: ["u001"], format: "article",
			relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" },
		};
		const refOf = (verified: Record<string, unknown>): { lesson_ko: unknown; source_name: unknown } => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			writeFileSync(join(work, "refs-draft.json"), JSON.stringify({ version: 1, refs: [{ ...verifiedRef, recurring_labels: [] }], recurring_unfound: [], units_unfound: [] }));
			writeFileSync(join(work, "refs.verified.json"), JSON.stringify({ version: 1, refs: [{ ...verifiedRef, ...verified }], dropped: [] }));
			expect(run(["render", "--work", work], { cwd, home }).exitCode).toBe(0);
			const ref = JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).units[0].refs[0];
			return { lesson_ko: ref.lesson_ko, source_name: ref.source_name };
		};
		expect(refOf({ lesson_ko: { u001: "포백이 한 줄로 선다" } })).toEqual({ lesson_ko: "포백이 한 줄로 선다", source_name: "테스트 채널" });
		expect(refOf({})).toEqual({ lesson_ko: null, source_name: "테스트 채널" });
	});

	test("render은 참고자료 페이지에 인용한 유닛의 시작이 모두 같을 때만 시각을 싣고, 다르면 시각 없는 원문 링크를 싣는다", () => {
		const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
		const pageLink = (starts: Record<string, string>): string | null | undefined => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			writeFileSync(
				join(work, "lines.json"),
				JSON.stringify([
					{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "테스트 대사" },
					{ i: 1, video: "NUzEChn9EyI", start: 6, end: 10, text: "또 같은 대사" },
				]),
			);
			const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
			plan.matches[0].topics[0].units[0].key_frame_candidate_ids = ["c001"];
			plan.matches[0].topics[0].units.push({ ...plan.matches[0].topics[0].units[0], start_line: 1, end_line: 1 });
			writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
			const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
			notes.units.u002 = notes.units.u001;
			writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
			writeFileSync(join(work, "similar-candidates.json"), JSON.stringify({ version: 1, session_id: sessionId, units: { u001: [], u002: [] } }));
			writeFileSync(join(work, "similar-choices.json"), JSON.stringify({ version: 1, units: { u001: [], u002: [] } }));
			copyFileSync(join(work, "img", "u001-start.webp"), join(work, "img", "u002-start.webp"));
			copyFileSync(join(work, "img", "u001-c001.webp"), join(work, "img", "u002-c001.webp"));
			const common = {
				url, title: "영상", source_name: "테스트", lang: "en", kind: "tactics", unit_ids: ["u001", "u002"], format: "video",
				summary_ko: "요약", key_points_ko: ["포인트"], relevance_ko: { u001: "첫째 장면의 빌드업을 다룬다", u002: "둘째 장면의 빌드업을 다룬다" },
				video_starts: starts,
			};
			writeFileSync(join(work, "refs-draft.json"), JSON.stringify({ version: 1, refs: [{ ...common, recurring_labels: [] }], recurring_unfound: [], units_unfound: [] }));
			const id = refId(url);
			writeFileSync(
				join(work, "refs.verified.json"),
				JSON.stringify({ version: 1, refs: [{ ...common, id, final_url: url, http_status: 200, checked_at: "2026-10-04T00:00:00Z", reused: false, page: `refs/${id}.html` }], dropped: [] }),
			);
			expect(run(["render", "--work", work], { cwd, home }).exitCode).toBe(0);
			const html = readFileSync(join(archive, "refs", `${id}.html`), "utf8");
			return html.match(/<a class="ref-link"[^>]*>([^<]*)<\/a>/)?.[1];
		};
		expect(pageLink({ u001: "1:09", u002: "1:09" })).toBe("자료 영상 1:09부터 ↗");
		expect(pageLink({ u001: "1:09", u002: "1:31" })).toBe("원문 ↗");
		expect(pageLink({ u001: "1:09" })).toBe("원문 ↗");
	});

	test("render은 eafc 참고자료의 버전 배지·프로클럽 여부와 notes의 위치 미확인 인물을 data.json에 싣는다", () => {
		const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
		const base = {
			url, title: "영상", source_name: "테스트", lang: "ko", kind: "eafc", unit_ids: ["u001"], format: "video",
			relevance_ko: { u001: "이 장면의 빌드업 문제를 다룬다" },
		};
		const verifiedBase = { ...base, id: refId(url), final_url: url, http_status: 200, checked_at: "2026-10-04T00:00:00Z", reused: false, page: null };
		const rendered = (verifiedGame: Record<string, unknown>, unidentified?: string[]): { ref: unknown; unit: Record<string, unknown> } => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			const session = JSON.parse(readFileSync(join(work, "session.json"), "utf8"));
			session.videos[0].title = "FC26 프로클럽 경기";
			writeFileSync(join(work, "session.json"), JSON.stringify(session));
			const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
			if (unidentified !== undefined) {
				notes.units.u001.unidentified_member_ids = unidentified;
				notes.units.u001.look_at = "화면 위쪽 마크 없는 홍길동";
				// 위치 미확인은 유닛 범위 전체를 scan-range로 훑은 기록(kind range 후보)이 있어야 통과한다.
				writeFileSync(
					join(work, "candidates.json"),
					JSON.stringify([
						{ id: "c001", video: "NUzEChn9EyI", t: 2, kind: "manual" },
						{ id: "c002", video: "NUzEChn9EyI", t: 4, kind: "range" },
						{ id: "c003", video: "NUzEChn9EyI", t: 0, kind: "range" },
						{ id: "c004", video: "NUzEChn9EyI", t: 2, kind: "range" },
					]),
				);
				const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
				plan.matches[0].topics[0].units[0].member_ids = unidentified;
				plan.matches[0].lineup = Object.fromEntries(unidentified.map((id) => [id, "CB"]));
				writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
			}
			writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
			writeFileSync(
				join(work, "refs-draft.json"),
				JSON.stringify({ version: 1, refs: [{ ...base, recurring_labels: [], game_version: "FC 25", pro_clubs: true }], recurring_unfound: [], units_unfound: [] }),
			);
			writeFileSync(join(work, "refs.verified.json"), JSON.stringify({ version: 1, refs: [{ ...verifiedBase, ...verifiedGame }], dropped: [] }));
			const result = run(["render", "--work", work], { cwd, home });
			expect(result.stderr).toBe("");
			const unit = JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).units[0];
			const ref = unit.refs[0];
			return { ref: { version_badge: ref.version_badge, published_badge: ref.published_badge, pro_clubs: ref.pro_clubs }, unit };
		};
		const current = rendered({ game_version: "FC 25", pro_clubs: true }, ["hong"]);
		expect(current.ref).toEqual({ version_badge: "FC 25 · 이전 버전", published_badge: null, pro_clubs: true });
		expect(current.unit.unidentified_member_ids).toEqual(["hong"]);
		expect(current.unit.look_at).toBe("화면 위쪽 마크 없는 홍길동");
		const unstated = rendered({ game_version: null, published: "2023-01", pro_clubs: false });
		expect(unstated.ref).toEqual({ version_badge: null, published_badge: "2023년 1월", pro_clubs: false });
		expect(unstated.unit.unidentified_member_ids).toEqual([]);
		expect(unstated.unit.look_at).toBeNull();
		// 이 필드가 생기기 전에 검증된 항목: 배지 없음
		expect(rendered({}).ref).toEqual({ version_badge: null, published_badge: null, pro_clubs: false });
		// 버전을 안 밝히고 업로드 연월도 모르는 자료: 배지 없음
		expect(rendered({ game_version: null }).ref).toEqual({ version_badge: null, published_badge: null, pro_clubs: false });
	});

	test("render은 notes의 direction_check_ko를 data.json units[].direction_check_ko에 싣고, 없는 유닛은 null로 싣는다", () => {
		const unitOf = (withField: boolean): Record<string, unknown> => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			if (withField) {
				const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
				notes.units.u001.direction_check_ko = "댓글은 좌측, 사진에서 몰린 쪽은 화면 위쪽";
				writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
			}
			const result = run(["render", "--work", work], { cwd, home });
			expect(result.stderr).toBe("");
			return JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).units[0];
		};
		expect(unitOf(true).direction_check_ko).toBe("댓글은 좌측, 사진에서 몰린 쪽은 화면 위쪽");
		expect(unitOf(false).direction_check_ko).toBeNull();
	});

	test("render은 notes의 marker_colors를 data.json matches[].marker_legend에 싣고, 없으면 []로 싣는다", () => {
		const legendOf = (withColors: boolean): unknown => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			if (withColors) {
				const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
				notes.marker_colors = [{ match: 1, member_id: "hong", color: "분홍", evidence_candidate_id: "c001" }];
				writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
			}
			const result = run(["render", "--work", work], { cwd, home });
			expect(result.stderr).toBe("");
			return JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).matches[0].marker_legend;
		};
		expect(legendOf(true)).toEqual([{ member_id: "hong", color: "분홍" }]);
		expect(legendOf(false)).toEqual([]);
	});

	test("render은 notes의 unmatched_name_tags를 data.json matches[].unmatched_name_tags에 {tag, color?}로 싣고, 없으면 []로 싣는다", () => {
		const tagsOf = (entries: unknown[] | null): unknown => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			if (entries !== null) {
				const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
				notes.unmatched_name_tags = entries;
				writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
			}
			const result = run(["render", "--work", work], { cwd, home });
			expect(result.stderr).toBe("");
			return JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).matches[0].unmatched_name_tags;
		};
		expect(
			tagsOf([
				{ match: 1, tag: "SAMBA", color: "자홍", evidence_candidate_id: "c001" },
				{ match: 1, tag: "ANG", evidence_candidate_id: "c001" },
			]),
		).toEqual([{ tag: "SAMBA", color: "자홍" }, { tag: "ANG" }]);
		expect(tagsOf(null)).toEqual([]);
	});

	test("render은 notes의 fault_scene을 data.json units[].fault_scene에 싣고, -ㅁ 조각이 없는 유닛은 null로 싣는다", () => {
		const unitOf = (faultTitle: boolean): Record<string, unknown> => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			if (faultTitle) {
				const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
				plan.matches[0].topics[0].units[0].title = "홍길동: 첫판부터 정신 놓음";
				writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
				const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
				notes.units.u001.fault_scene = "홍길동이 아크 근처에서 상대 둘 사이에 서 있다";
				writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
			}
			const result = run(["render", "--work", work], { cwd, home });
			expect(result.stderr).toBe("");
			return JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).units[0];
		};
		expect(unitOf(true).fault_scene).toBe("홍길동이 아크 근처에서 상대 둘 사이에 서 있다");
		expect(unitOf(false).fault_scene).toBeNull();
	});

	test("render은 group_positions 단위 대상을 그 경기 lineup 출전자로 계산해 position_target_ids에 싣는다", () => {
		const targetsWith = (lineup: Record<string, string>): unknown => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
			plan.matches[0].lineup = lineup;
			Object.assign(plan.matches[0].topics[0].units[0], { member_ids: [], position_tags: ["DF", "CB"], group_positions: ["DF"] });
			writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
			const result = run(["render", "--work", work], { cwd, home });
			expect(result.stderr).toBe("");
			return JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).units[0].position_target_ids;
		};
		expect(targetsWith({ hong: "CB" })).toEqual(["hong"]);
		// 명단 CB여도 이 경기에 뛰지 않았으면 대상이 아니다
		expect(targetsWith({})).toEqual([]);
	});

	test("render은 group_member_ids에 group_positions 단위 출전자를 고칠 사람까지 포함해 싣고, position_target_ids 뜻은 그대로 둔다", () => {
		const unitWith = (memberIds: string[]): { group_member_ids: string[]; position_target_ids: string[] } => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
			plan.matches[0].lineup = { hong: "CB" };
			Object.assign(plan.matches[0].topics[0].units[0], { member_ids: memberIds, position_tags: ["DF", "CB"], group_positions: ["DF"] });
			writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
			const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
			if (memberIds.length > 0) notes.units.u001.blocks[1].caption = "홍길동이 라인 뒤에 선 순간";
			writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
			const result = run(["render", "--work", work], { cwd, home });
			expect(result.stderr).toBe("");
			return JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).units[0];
		};
		expect(unitWith([])).toMatchObject({ group_member_ids: ["hong"], position_target_ids: ["hong"] });
		// 고칠 사람이어도 group_member_ids에는 들고, position_target_ids는 고칠 사람을 뺀다.
		expect(unitWith(["hong"])).toMatchObject({ group_member_ids: ["hong"], position_target_ids: [] });
	});

	test("render은 plan의 matches_without_feedback을 data.json과 세션 페이지에 싣는다", () => {
		const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
		const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
		plan.matches_without_feedback = ["2경기 · LVT 대 AL"];
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
		expect(run(["render", "--work", work], { cwd, home }).exitCode).toBe(0);
		const sessionDir = join(archive, "sessions", sessionId);
		expect(JSON.parse(readFileSync(join(sessionDir, "data.json"), "utf8")).matches_without_feedback).toEqual(["2경기 · LVT 대 AL"]);
		expect(readFileSync(join(sessionDir, "index.html"), "utf8").replaceAll("\u00a0", " ").replaceAll("\u2060", "")).toContain("2경기 · LVT 대 AL — 피드백 없음");
	});

	test("render은 plan 유닛의 inferred_member_ids를 data.json에 싣는다", () => {
		const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
		const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
		Object.assign(plan.matches[0].lineup, { hong: "CB" });
		Object.assign(plan.matches[0].topics[0].units[0], { member_ids: ["hong"], inferred_member_ids: ["hong"] });
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
		const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
		notes.units.u001.blocks[1].caption = "화면 가운데 홍길동이 공을 받음";
		writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
		expect(run(["render", "--work", work], { cwd, home }).exitCode).toBe(0);
		const dataPath = join(archive, "sessions", sessionId, "data.json");
		expect(JSON.parse(readFileSync(dataPath, "utf8")).units[0].inferred_member_ids).toEqual(["hong"]);
	});

	test("render은 유닛 댓글 작성자가 고칠 사람이면 self_critique_member_ids에 싣는다(별칭 handle도 명단 멤버로 풀어서)", () => {
		const selfCritiqueIds = (author: string): unknown => {
			const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
			writeFileSync(
				join(work, "lines.json"),
				JSON.stringify([{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "테스트 댓글", source: "comment", author }]),
			);
			const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
			Object.assign(plan.matches[0].lineup, { hong: "CB" });
			Object.assign(plan.matches[0].topics[0].units[0], { member_ids: ["hong"] });
			writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
			const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
			notes.units.u001.blocks[1].caption = "화면 가운데 홍길동이 공을 받음";
			writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
			const result = run(["render", "--work", work], { cwd, home });
			expect(result.stderr).toBe("");
			return JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8")).units[0].self_critique_member_ids;
		};
		expect(selfCritiqueIds("@HongGD-x1y")).toEqual(["hong"]);
		expect(selfCritiqueIds("@someone-else")).toEqual([]);
	});

	test("render은 refs-draft의 recurring_unfound에 든 반복 지적에 refs_unfound: true를 싣는다", () => {
		const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
		writeFileSync(
			join(work, "lines.json"),
			JSON.stringify([
				{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "테스트 대사" },
				{ i: 1, video: "NUzEChn9EyI", start: 6, end: 10, text: "또 같은 대사" },
			]),
		);
		const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
		const second = { ...plan.matches[0].topics[0].units[0], start_line: 1, end_line: 1 };
		plan.matches[0].topics[0].units[0].key_frame_candidate_ids = ["c001"];
		plan.matches[0].topics[0].units.push(second);
		plan.recurring = [
			{ label: "패스를 늦게 냄", lines: [0, 1], member_ids: [] },
		];
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
		const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8"));
		notes.units.u002 = notes.units.u001;
		writeFileSync(join(work, "notes.json"), JSON.stringify(notes));
		writeFileSync(join(work, "similar-candidates.json"), JSON.stringify({ version: 1, session_id: sessionId, units: { u001: [], u002: [] } }));
		writeFileSync(join(work, "similar-choices.json"), JSON.stringify({ version: 1, units: { u001: [], u002: [] } }));
		copyFileSync(join(work, "img", "u001-start.webp"), join(work, "img", "u002-start.webp"));
		copyFileSync(join(work, "img", "u001-c001.webp"), join(work, "img", "u002-c001.webp"));
		const draftWith = (unfound: unknown[]) =>
			writeFileSync(join(work, "refs-draft.json"), JSON.stringify({ version: 1, refs: [], recurring_unfound: unfound, units_unfound: [{ unit_id: "u001", queries: ["검색어 하나", "검색어 둘"], subtitle_terms: ["용어"] }, { unit_id: "u002", queries: ["검색어 하나", "검색어 둘"], subtitle_terms: ["용어"] }] }));
		draftWith([{ label: "패스를 늦게 냄", queries: ["pro clubs pass timing", "패스 타이밍 전술"], subtitle_terms: ["타이밍"] }]);
		const result = run(["render", "--work", work], { cwd, home });
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		const data = JSON.parse(readFileSync(join(archive, "sessions", sessionId, "data.json"), "utf8"));
		expect(data.recurring).toEqual([{ label: "패스를 늦게 냄", unit_ids: ["u001", "u002"], member_ids: [], refs_unfound: true }]);
	});

	test("refs-bundle은 자료 없는 유닛·못 찾은 label의 검색어와 subtitle_terms 적중 자막 줄을 영상 id·시각 순으로 싣는다", () => {
		const { cwd, home, work, sessionId } = buildRenderedFixture();
		writeFileSync(
			join(work, "lines.json"),
			JSON.stringify([
				{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "테스트 대사" },
				{ i: 1, video: "NUzEChn9EyI", start: 6, end: 10, text: "또 같은 대사" },
			]),
		);
		const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
		plan.matches[0].topics[0].units.push({ ...plan.matches[0].topics[0].units[0], start_line: 1, end_line: 1 });
		plan.recurring = [{ label: "패스를 늦게 냄", lines: [0, 1], member_ids: [] }];
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
		expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
		writeFileSync(
			join(work, "refs-draft.json"),
			JSON.stringify({
				version: 1,
				refs: [],
				recurring_unfound: [{ label: "패스를 늦게 냄", queries: ["pass timing a", "pass timing b"], subtitle_terms: ["TIMING", "타이밍"] }],
				units_unfound: [
					{ unit_id: "u001", queries: ["offside a", "offside b"], subtitle_terms: ["offside"] },
					{ unit_id: "u002", queries: ["nothing a", "nothing b"], subtitle_terms: ["zzz"] },
				],
			}),
		);
		const cue = (t: string, text: string) => `${t} --> ${t.replace(/\.000$/, ".900")}\n${text}\n`;
		mkdirSync(join(work, "refsubs"));
		writeFileSync(
			join(work, "refsubs", "BBBBBBBBBBB.en.vtt"),
			["WEBVTT\n", cue("00:00:05.000", "<c>Offside</c> trap"), cue("00:00:09.000", "the Offside trap\n<00:00:09.500><c>passing timing</c>")].join("\n"),
		);
		writeFileSync(
			join(work, "refsubs", "AAAAAAAAAAA.ko.vtt"),
			["WEBVTT\n", cue("00:01:30.000", "offside line"), cue("00:01:32.000", "offside line"), cue("00:01:40.000", "타이밍이 중요합니다")].join("\n"),
		);
		expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
		const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
		const unitsSection = bundle.slice(bundle.indexOf("## 자료 없는 유닛"), bundle.indexOf("## 붙이지 않은 자막"));
		expect(unitsSection).toContain("offside a | offside b");
		expect(unitsSection).toContain("subtitle_terms: offside");
		// 영상 id 순(A 먼저), 같은 영상은 시각 순, 롤링 반복 줄은 한 번만, 태그는 제거
		expect(unitsSection.match(/^ *> .*$/gm)?.map((line) => line.trim())).toEqual([
			"> AAAAAAAAAAA 1:30 offside line",
			"> BBBBBBBBBBB 0:05 Offside trap",
			"> BBBBBBBBBBB 0:09 the Offside trap",
		]);
		expect(unitsSection).toMatch(/u002[\s\S]*자막 적중 없음/);
		const recurringSection = bundle.slice(bundle.indexOf("## 반복 지적"), bundle.indexOf("## 자료 없는 유닛"));
		expect(recurringSection).toContain("pass timing a | pass timing b");
		expect(recurringSection.match(/^ *> .*$/gm)?.map((line) => line.trim())).toEqual(["> AAAAAAAAAAA 1:40 타이밍이 중요합니다", "> BBBBBBBBBBB 0:09 passing timing"]);
		void sessionId;
	});

	test("refs-bundle의 자막 적중은 항목당 40줄까지만 싣고 나머지는 '… N줄 더'로 알리며, refsubs/가 없으면 자막 적중 없음이다", () => {
		const { cwd, home, work } = buildRenderedFixture();
		expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
		writeFileSync(
			join(work, "refs-draft.json"),
			JSON.stringify({ version: 1, refs: [], recurring_unfound: [], units_unfound: [{ unit_id: "u001", queries: ["a b", "c d"], subtitle_terms: ["hit"] }] }),
		);
		expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
		expect(readFileSync(join(work, "refs-review.md"), "utf8")).toContain("자막 적중 없음");
		mkdirSync(join(work, "refsubs"));
		const cues = Array.from({ length: 45 }, (_, i) => {
			const t = `00:${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}.000`;
			return `${t} --> ${t.replace(/\.000$/, ".900")}\nhit number ${i}\n`;
		});
		writeFileSync(join(work, "refsubs", "AAAAAAAAAAA.en.vtt"), ["WEBVTT\n", ...cues].join("\n"));
		expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
		const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
		expect(bundle.match(/^ *> AAAAAAAAAAA /gm)).toHaveLength(40);
		expect(bundle).toContain("… 5줄 더");
		expect(bundle).not.toContain("hit number 44");
	});

	test("refs-bundle의 자막 적중은 같은 영상·시각·글의 중복 줄을 한 번만 싣고, 이미 유닛에 붙은 영상의 줄은 붙은 유닛·시작 시각 표시와 함께 먼저 싣는다", () => {
		const { cwd, home, work } = buildRenderedFixture();
		writeFileSync(
			join(work, "lines.json"),
			JSON.stringify([
				{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "테스트 대사" },
				{ i: 1, video: "NUzEChn9EyI", start: 6, end: 10, text: "또 같은 대사" },
			]),
		);
		const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
		plan.matches[0].topics[0].units.push({ ...plan.matches[0].topics[0].units[0], start_line: 1, end_line: 1 });
		writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
		expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
		writeFileSync(
			join(work, "refs-draft.json"),
			JSON.stringify({
				version: 1,
				refs: [
					{
						url: "https://www.youtube.com/watch?v=BBBBBBBBBBB",
						title: "붙은 영상",
						source_name: "채널",
						lang: "en",
						kind: "tactics",
						format: "video",
						unit_ids: ["u001"],
						relevance_ko: { u001: "관련" },
						video_starts: { u001: "18:13" },
					},
				],
				recurring_unfound: [],
				units_unfound: [{ unit_id: "u002", queries: ["a b", "c d"], subtitle_terms: ["return"] }],
			}),
		);
		const cue = (t: string, text: string) => `${t} --> ${t.replace(/\.000$/, ".900")}\n${text}\n`;
		mkdirSync(join(work, "refsubs"));
		// 같은 영상의 두 자막 파일(en, en-US)이 같은 줄을 각각 가진다.
		writeFileSync(join(work, "refsubs", "BBBBBBBBBBB.en.vtt"), ["WEBVTT\n", cue("00:18:21.000", "물론 다시 돌려주고 return")].join("\n"));
		writeFileSync(join(work, "refsubs", "BBBBBBBBBBB.en-US.vtt"), ["WEBVTT\n", cue("00:18:21.000", "물론 다시 돌려주고 return")].join("\n"));
		writeFileSync(join(work, "refsubs", "AAAAAAAAAAA.en.vtt"), ["WEBVTT\n", cue("00:00:05.000", "a return ball")].join("\n"));
		expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
		const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
		const unitsSection = bundle.slice(bundle.indexOf("## 자료 없는 유닛"), bundle.indexOf("## 붙이지 않은 자막"));
		expect(unitsSection.match(/^ *> .*$/gm)?.map((line) => line.trim())).toEqual([
			"> BBBBBBBBBBB 18:21 물론 다시 돌려주고 return [이미 붙은 자료: u001 18:13]",
			"> AAAAAAAAAAA 0:05 a return ball",
		]);
	});

	describe("자막 줄바꿈을 건너 찾는 subtitle_terms", () => {
		const cue = (t: string, text: string) => `${t} --> ${t.replace(/\.000$/, ".900")}\n${text}\n`;
		/** u001에 영상 BBBBBBBBBBB가 붙고, u002는 자료 없음(subtitle_terms ["receives the ball"]). 자막은 한 문장이 두 줄로 쪼개져 있다. */
		function splitCueFixture() {
			const { cwd, home, work } = buildRenderedFixture();
			writeFileSync(
				join(work, "lines.json"),
				JSON.stringify([
					{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "테스트 대사" },
					{ i: 1, video: "NUzEChn9EyI", start: 6, end: 10, text: "또 같은 대사" },
				]),
			);
			const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
			plan.matches[0].topics[0].units.push({ ...plan.matches[0].topics[0].units[0], start_line: 1, end_line: 1 });
			writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
			expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
			writeFileSync(
				join(work, "refs-draft.json"),
				JSON.stringify({
					version: 1,
					refs: [
						{
							url: "https://www.youtube.com/watch?v=BBBBBBBBBBB", title: "붙은 영상", source_name: "채널", lang: "ko", kind: "tactics", format: "video", recurring_labels: [],
							unit_ids: ["u001"], relevance_ko: { u001: "관련" }, video_starts: { u001: "0:30" },
						},
					],
					recurring_unfound: [],
					units_unfound: [{ unit_id: "u002", queries: ["a b", "c d"], subtitle_terms: ["receives the ball"] }],
				}),
			);
			mkdirSync(join(work, "refsubs"));
			writeFileSync(
				join(work, "refsubs", "BBBBBBBBBBB.en.vtt"),
				["WEBVTT\n", cue("00:01:50.000", "the build up"), cue("00:01:56.000", "center back receives the"), cue("00:01:58.000", "ball and turns")].join("\n"),
			);
			return { cwd, home, work };
		}

		test("refs-bundle은 두 줄에 걸친 subtitle_terms를 시작 줄의 시각으로 싣는다", () => {
			const { cwd, home, work } = splitCueFixture();
			expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
			const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
			const section = bundle.slice(bundle.indexOf("## 자료 없는 유닛"), bundle.indexOf("## 붙이지 않은 자막"));
			expect(section.match(/^ *> .*$/gm)?.map((line) => line.trim())).toEqual(["> BBBBBBBBBBB 1:56 center back receives the ball and turns [이미 붙은 자료: u001 0:30]"]);
		});

		test("check refs는 unfound 항목의 용어가 이미 붙은 자료의 자막에 있으면 '보유 자료 재확인' 경고를 내고 exit 0을 유지한다", () => {
			const { cwd, home, work } = splitCueFixture();
			const result = run(["check", "refs", "--work", work], { cwd, home });
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("fc-feedback: 경고 보유 자료 재확인: receives the ball — BBBBBBBBBBB 1:56");
			writeFileSync(join(work, "refsubs", "BBBBBBBBBBB.en.vtt"), ["WEBVTT\n", cue("00:01:50.000", "the build up")].join("\n"));
			expect(run(["check", "refs", "--work", work], { cwd, home }).stderr).not.toContain("보유 자료 재확인");
		});

		test("check refs의 '보유 자료 재확인'은 두 단어 이상 용어만 본다 — 한 단어 용어는 아무 자막에나 걸린다", () => {
			const { cwd, home, work } = splitCueFixture();
			const draft = JSON.parse(readFileSync(join(work, "refs-draft.json"), "utf8"));
			draft.units_unfound[0].subtitle_terms = ["ball"];
			writeFileSync(join(work, "refs-draft.json"), JSON.stringify(draft));
			expect(run(["check", "refs", "--work", work], { cwd, home }).stderr).not.toContain("보유 자료 재확인");
		});
	});

	describe("refs-bundle — '하지 않기' 단서와 프로클럽 자막 자동 적중", () => {
		/** u001 "센터백: 볼 빨리 내주기"(줄 0), u002 "센터백: 코너 수비 때 상대 마크 놓치지 않기"(줄 1). */
		function twoUnitBundleFixture(draftRefs: unknown[]): { cwd: string; home: string; work: string } {
			const { cwd, home, work } = buildRenderedFixture();
			writeFileSync(
				join(work, "lines.json"),
				JSON.stringify([
					{ i: 0, video: "NUzEChn9EyI", start: 0, end: 5, text: "테스트 대사" },
					{ i: 1, video: "NUzEChn9EyI", start: 6, end: 10, text: "또 같은 대사" },
				]),
			);
			const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
			plan.matches[0].topics[0].units.push({ ...plan.matches[0].topics[0].units[0], title: "센터백: 코너 수비 때 상대 마크 놓치지 않기", start_line: 1, end_line: 1 });
			writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
			expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
			writeFileSync(join(work, "refs-draft.json"), JSON.stringify({ version: 1, refs: draftRefs, recurring_unfound: [], units_unfound: [] }));
			return { cwd, home, work };
		}
		const videoRef = (id: string, unitIds: string[], proClubs: boolean) => ({
			url: `https://www.youtube.com/watch?v=${id}`,
			title: `영상 ${id}`,
			source_name: "채널",
			lang: "ko",
			kind: "eafc",
			format: "video",
			pro_clubs: proClubs,
			unit_ids: unitIds,
			relevance_ko: Object.fromEntries(unitIds.map((unitId) => [unitId, "관련"])),
			video_starts: Object.fromEntries(unitIds.map((unitId) => [unitId, "0:10"])),
		});
		const cue = (t: string, text: string) => `${t} --> ${t.replace(/\.000$/, ".900")}\n${text}\n`;
		const writeSubs = (work: string, video: string, text: string) => {
			mkdirSync(join(work, "refsubs"), { recursive: true });
			writeFileSync(join(work, "refsubs", `${video}.ko.vtt`), ["WEBVTT\n", cue("00:00:10.000", text)].join("\n"));
		};

		test("제목에 '지 않기'가 있는 유닛에는 구간이 참는 쪽을 말하는지 확인하라는 단서를 붙은 자료 아래와 자료 없는 유닛 목록에 싣는다", () => {
			const { cwd, home, work } = twoUnitBundleFixture([videoRef("BBBBBBBBBBB", ["u001", "u002"], true)]);
			expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
			const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
			const cueLine = "이 유닛은 '하지 않기' — 구간이 참는 쪽을 말하는지 확인";
			expect(bundle).toMatch(new RegExp(`### u002 · [^\\n]*\\n[\\s\\S]*?${cueLine}`));
			expect(bundle.match(new RegExp(cueLine, "g"))).toHaveLength(1);
			expect(bundle.slice(bundle.indexOf("### u001"), bundle.indexOf("### u002"))).not.toContain(cueLine);
			// 자료가 안 붙은 '하지 않기' 유닛에도 같은 단서가 나온다.
			const bare = twoUnitBundleFixture([videoRef("BBBBBBBBBBB", ["u001"], true)]);
			expect(run(["refs-bundle", "--work", bare.work], { cwd: bare.cwd, home: bare.home }).exitCode).toBe(0);
			const bareBundle = readFileSync(join(bare.work, "refs-review.md"), "utf8");
			expect(bareBundle.slice(bareBundle.indexOf("## 자료 없는 유닛"))).toContain(cueLine);
		});

		test("자막 파일 전체를 유닛 제목 핵심어로 훑어, 그 유닛에 안 붙은 프로클럽 영상의 적중 줄을 '이미 붙은 자료' 표시와 함께 유닛별로 싣는다", () => {
			const { cwd, home, work } = twoUnitBundleFixture([videoRef("BBBBBBBBBBB", ["u001"], true), videoRef("DDDDDDDDDDD", ["u002"], true), videoRef("EEEEEEEEEEE", ["u001"], false)]);
			writeSubs(work, "BBBBBBBBBBB", "코너킥 올라올 때도 마찬가지예요");
			writeSubs(work, "DDDDDDDDDDD", "코너킥 수비는 이렇게 합니다");
			writeSubs(work, "EEEEEEEEEEE", "코너킥 일반 축구 자료");
			writeSubs(work, "CCCCCCCCCCC", "코너킥 자료가 draft에 없는 영상");
			expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
			const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
			const section = bundle.slice(bundle.indexOf("## 유닛별 프로클럽 자막 적중"), bundle.indexOf("## 붙이지 않은 자막"));
			expect(section).toContain("- u002 · 센터백: 코너 수비 때 상대 마크 놓치지 않기");
			expect(section.match(/^ *> .*$/gm)?.map((line) => line.trim())).toEqual(["> BBBBBBBBBBB 0:10 코너킥 올라올 때도 마찬가지예요 [이미 붙은 자료: u001 0:10]"]);
			expect(section).not.toContain("- u001");
		});

		describe("제목 핵심어의 용어 동의어 확장과 조사성 불용어", () => {
			/** u002 제목을 바꾼 뒤 u001에 붙은 프로클럽 영상 DDDDDDDDDDD의 자막(cueText)으로 refs-bundle을 돌려, 유닛별 적중 절을 돌려준다. */
			function hitSection(u002Title: string, cueText: string): string {
				const { cwd, home, work } = twoUnitBundleFixture([videoRef("DDDDDDDDDDD", ["u001"], true)]);
				const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
				plan.matches[0].topics[0].units[1].title = u002Title;
				writeFileSync(join(work, "plan.json"), JSON.stringify(plan));
				expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
				writeSubs(work, "DDDDDDDDDDD", cueText);
				expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
				const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
				return bundle.slice(bundle.indexOf("## 유닛별 프로클럽 자막 적중"), bundle.indexOf("## 같은 채널 후보"));
			}
			const TITLE = "센터백: 혼자 오프사이드 트랩 걸지 말고 뒤로 빼기";

			test("제목의 '오프사이드'는 자막의 '옵사'·'offside'도 찾는다", () => {
				expect(hitSection(TITLE, "옵사라인 올려야 합니다")).toContain("옵사라인 올려야 합니다");
				expect(hitSection(TITLE, "the offside line is high")).toContain("the offside line is high");
			});

			test("제목의 '슈퍼 캔슬로'는 '슈캔'·'super cancel'을, '크로스'는 'cross'를, '헤딩'은 'header'를 찾는다", () => {
				expect(hitSection("센터백: 슈퍼 캔슬로 라인 올리기", "슈캔 쓰세요")).toContain("슈캔 쓰세요");
				expect(hitSection("센터백: 슈퍼 캔슬로 라인 올리기", "use super cancel here")).toContain("use super cancel here");
				expect(hitSection("센터백: 크로스 올 때 자리 지키기", "a low cross comes in")).toContain("a low cross comes in");
				expect(hitSection("센터백: 헤딩 경합 피하기", "win the header first")).toContain("win the header first");
			});

			test("'혼자·말고·대신·보다·계속·너무·바로·하지'만 겹치는 자막은 적중이 아니다", () => {
				const words = "혼자 말고 대신 보다 계속 너무 바로 하지";
				expect(hitSection(`센터백: ${words} 라인 올리기`, `${words} 하는 건 좋지 않아요`)).toContain("- 없음");
			});

			test("동의어 표에 없는 단어는 그대로 앞 두 음절로 찾는다(코너킥 자막이 '코너 수비' 제목에 적중)", () => {
				expect(hitSection("센터백: 코너 수비 때 상대 마크 놓치지 않기", "코너킥 올라올 때")).toContain("코너킥 올라올 때");
			});
		});

		describe("같은 채널 후보(ytsearch)", () => {
			/** 인자(첫 인자가 검색식)를 args.log에 남기고 stubBody를 실행하는 가짜 yt-dlp. */
			function stubYtDlp(stubBody: string): { bin: string; log: string } {
				const dir = tempDir();
				const log = join(dir, "args.log");
				const bin = join(dir, "yt-dlp-stub.sh");
				writeFileSync(bin, `#!/bin/sh\necho "$1" >> "${log}"\n${stubBody}\n`);
				chmodSync(bin, 0o755);
				return { bin, log };
			}
			const withUnfound = (draftRefs: unknown[], unitsUnfound: unknown[], recurringUnfound: unknown[] = []) => {
				const fixture = twoUnitBundleFixture(draftRefs);
				writeFileSync(join(fixture.work, "refs-draft.json"), JSON.stringify({ version: 1, refs: draftRefs, recurring_unfound: recurringUnfound, units_unfound: unitsUnfound }));
				return fixture;
			};
			const unfoundUnit = (unitId: string) => ({ unit_id: unitId, queries: ["a", "b"], subtitle_terms: ["c"] });
			/** 검색 호출만(채널 URL 조회 호출은 뺌): 전체 검색은 'ytsearch10:' 뒤 검색식, 채널 안 검색은 '<채널 URL>/search?query=' 전체. */
			const searchedQueries = (log: string): string[] =>
				readFileSync(log, "utf8").trim().split("\n").filter((line) => line.startsWith("ytsearch10:") || line.includes("/search?query=")).map((line) => line.replace("ytsearch10:", ""));

			test("붙은 YouTube 자료의 채널마다 자료 없는 유닛 제목의 행동 키워드로 검색하고, 이미 붙은 id는 표시해 '같은 채널 후보' 절에 싣는다", () => {
				const { cwd, home, work } = withUnfound([videoRef("BBBBBBBBBBB", ["u001"], true)], [unfoundUnit("u002")]);
				const stub = stubYtDlp(`echo "BBBBBBBBBBB 이미 붙인 영상"\necho "VYRAwKX9Sek 풀백 코너 수비"`);
				expect(run(["refs-bundle", "--work", work], { cwd, home, env: { FC_FEEDBACK_YTDLP_BIN: stub.bin } }).exitCode).toBe(0);
				const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
				const section = bundle.slice(bundle.indexOf("## 같은 채널 후보"), bundle.indexOf("## 붙이지 않은 자막"));
				expect(section).toContain("### 채널 × 코너 수비");
				expect(section).toContain("- BBBBBBBBBBB 이미 붙인 영상 [이미 붙은 자료: u001 0:10]");
				expect(section).toContain("- VYRAwKX9Sek 풀백 코너 수비");
				expect(searchedQueries(stub.log)).toEqual(["채널 코너 수비 축구"]);
			});

			test("recurring_unfound의 label도 키워드로 검색한다(조사·조건절을 떼고, 채널을 돌아가며 label·유닛 키워드 순)", () => {
				const refs = ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC", "DDDDDDDDDDD"].map((id, index) => ({ ...videoRef(id, ["u001"], true), source_name: `채널${index}` }));
				const { cwd, home, work } = withUnfound(refs, [unfoundUnit("u002")], [{ label: "수비 라인이 안 맞음", queries: ["a", "b"], subtitle_terms: ["c"] }]);
				const stub = stubYtDlp("true");
				expect(run(["refs-bundle", "--work", work], { cwd, home, env: { FC_FEEDBACK_YTDLP_BIN: stub.bin } }).exitCode).toBe(0);
				expect(searchedQueries(stub.log)).toEqual([
					"채널0 수비 라인 맞음 축구",
					"채널1 수비 라인 맞음 축구",
					"채널2 수비 라인 맞음 축구",
					"채널3 수비 라인 맞음 축구",
					"채널0 코너 수비 축구",
					"채널1 코너 수비 축구",
					"채널2 코너 수비 축구",
					"채널3 코너 수비 축구",
				]);
				expect(readFileSync(join(work, "refs-review.md"), "utf8")).not.toContain("생략한 검색");
			});

			const channelRef = (id: string, channel: string, unitIds: string[], overrides: Record<string, unknown> = {}) => ({ ...videoRef(id, unitIds, true), source_name: channel, ...overrides });
			const run2 = (fixture: { cwd: string; home: string; work: string }, stub: { bin: string }) =>
				expect(run(["refs-bundle", "--work", fixture.work], { cwd: fixture.cwd, home: fixture.home, env: { FC_FEEDBACK_YTDLP_BIN: stub.bin } }).exitCode).toBe(0);

			test("채널은 붙은 자료가 덮는 유닛 수가 많은 순으로, 같으면 프로클럽 자료가 있는 채널이 먼저다", () => {
				const refs = [
					channelRef("AAAAAAAAAAA", "한유닛채널", ["u001"], { pro_clubs: false }),
					channelRef("BBBBBBBBBBB", "두유닛채널", ["u001", "u002"], { pro_clubs: false }),
					channelRef("CCCCCCCCCCC", "프로채널", ["u001"], { pro_clubs: true }),
				];
				const fixture = withUnfound(refs, [], [{ label: "수비 라인이 안 맞음", queries: ["a", "b"], subtitle_terms: ["c"] }]);
				const stub = stubYtDlp("true");
				run2(fixture, stub);
				expect(searchedQueries(stub.log)).toEqual(["두유닛채널 수비 라인 맞음 축구", "프로채널 수비 라인 맞음 축구", "한유닛채널 수비 라인 맞음 축구"]);
			});

			test("상한 12개는 채널을 돌아가며 나눠 쓴다(한 채널이 다 쓰지 않는다)", () => {
				const refs = [channelRef("AAAAAAAAAAA", "큰채널", ["u001", "u002"]), channelRef("BBBBBBBBBBB", "작은채널", ["u001"])];
				const recurring = Array.from({ length: 8 }, (_, index) => ({ label: `수비 문제${index}번 반복`, queries: ["a", "b"], subtitle_terms: ["c"] }));
				const fixture = withUnfound(refs, [], recurring);
				const stub = stubYtDlp("true");
				run2(fixture, stub);
				const queries = searchedQueries(stub.log);
				expect(queries).toHaveLength(12);
				expect(queries.filter((query) => query.startsWith("큰채널 "))).toHaveLength(6);
				expect(queries.filter((query) => query.startsWith("작은채널 "))).toHaveLength(6);
				expect(queries.slice(0, 4)).toEqual(["큰채널 수비 문제0번 반복 축구", "작은채널 수비 문제0번 반복 축구", "큰채널 수비 문제1번 반복 축구", "작은채널 수비 문제1번 반복 축구"]);
				expect(readFileSync(join(fixture.work, "refs-review.md"), "utf8")).toContain("생략한 검색 4개(상한 12개)");
			});

			test("검색어에서 명단 이름·게이머태그·조건절·조사를 뗀다", () => {
				const fixture = withUnfound(
					[channelRef("AAAAAAAAAAA", "채널", ["u001"])],
					[],
					[{ label: "홍길동이 잡으면 HongGD 라인을 올리지 않음", queries: ["a", "b"], subtitle_terms: ["c"] }],
				);
				const stub = stubYtDlp("true");
				run2(fixture, stub);
				expect(searchedQueries(stub.log)).toEqual(["채널 라인 올리지 않음 축구"]);
			});

			test("자료 없는 유닛은 제목 행동 키워드와 subtitle_terms로, 명단 이름이 든 용어는 뺀다", () => {
				const fixture = withUnfound([channelRef("AAAAAAAAAAA", "채널", ["u001"])], [{ unit_id: "u002", queries: ["a", "b"], subtitle_terms: ["코너 마킹", "홍길동 수비"] }]);
				const stub = stubYtDlp("true");
				run2(fixture, stub);
				expect(searchedQueries(stub.log)).toEqual(["채널 코너 수비 축구", "채널 코너 마킹 수비 축구"]);
			});

			test("영어 채널(자료 lang이 ko가 아님)은 라틴 subtitle_terms를 우선하고, 없으면 한국어 키워드를 쓴다", () => {
				const english = channelRef("AAAAAAAAAAA", "EN Channel", ["u001"], { lang: "en" });
				const fixture = withUnfound(
					[english],
					[],
					[
						{ label: "수비 라인이 안 맞음", queries: ["a", "b"], subtitle_terms: ["라인", "defending line", "back four"] },
						{ label: "코너 마크가 어긋남", queries: ["a", "b"], subtitle_terms: ["코너"] },
					],
				);
				const stub = stubYtDlp("true");
				run2(fixture, stub);
				expect(searchedQueries(stub.log)).toEqual(["EN Channel defending line football", "EN Channel 코너 마크 어긋남 football"]);
			});

			test("붙은 자료 제목에 시리즈 표시(pt.N·Part N·#N)가 있으면 표시를 뗀 제목으로 같은 채널의 다른 편도 검색한다(채널의 첫 검색)", () => {
				const refs = [
					channelRef("AAAAAAAAAAA", "WhiteGamer7", ["u001"], { title: "EAFC 26 Pro Clubs: Defending Guide & Tips pt.4", lang: "en" }),
					channelRef("BBBBBBBBBBB", "다른채널", ["u001"], { title: "수비 강좌 Part 2" }),
					channelRef("CCCCCCCCCCC", "세번째채널", ["u001"], { title: "라인 강좌 #3" }),
				];
				const fixture = withUnfound(refs, [], []);
				const stub = stubYtDlp("true");
				run2(fixture, stub);
				expect(searchedQueries(stub.log)).toEqual(["WhiteGamer7 EAFC 26 Pro Clubs: Defending Guide & Tips football", "다른채널 수비 강좌 축구", "세번째채널 라인 강좌 축구"]);
			});

			test("검색 쌍이 상한 12개를 넘으면 앞에서 12개만 검색하고 생략한 개수를 쓴다", () => {
				const refs = Array.from({ length: 7 }, (_, index) => ({ ...videoRef(`${String(index).repeat(11)}`, ["u001"], true), source_name: `채널${index}` }));
				const { cwd, home, work } = withUnfound(refs, [unfoundUnit("u002")], [{ label: "수비 라인이 안 맞음", queries: ["a", "b"], subtitle_terms: ["c"] }]);
				const stub = stubYtDlp("true");
				expect(run(["refs-bundle", "--work", work], { cwd, home, env: { FC_FEEDBACK_YTDLP_BIN: stub.bin } }).exitCode).toBe(0);
				expect(searchedQueries(stub.log)).toHaveLength(12);
				expect(readFileSync(join(work, "refs-review.md"), "utf8")).toContain("생략한 검색 2개(상한 12개)");
			});

			/** channel_url 조회에는 채널 URL을 돌려주고, 그 URL 안 검색에는 stubBody 결과를 돌려주는 가짜 yt-dlp. */
			const stubWithChannelUrl = (channelSearchBody: string) => stubYtDlp(`case " $* " in *" channel_url "*) echo "https://www.youtube.com/@egil"; exit 0;; esac\n${channelSearchBody}`);

			test("채널 URL을 채널마다 한 번만 조회하고 '<채널 URL>/search?query=<키워드>'로 채널 안에서 검색한다(전체 검색·축구 단어 없음)", () => {
				const refs = [channelRef("AAAAAAAAAAA", "E GIL", ["u001"])];
				const fixture = withUnfound(refs, [unfoundUnit("u002")], [{ label: "수비 라인이 안 맞음", queries: ["a", "b"], subtitle_terms: ["c"] }]);
				const stub = stubWithChannelUrl(`echo "CCCCCCCCCCC 채널 안 영상"`);
				run2(fixture, stub);
				const log = readFileSync(stub.log, "utf8").trim().split("\n");
				expect(log.filter((line) => line.includes("watch?v=AAAAAAAAAAA"))).toHaveLength(1);
				expect(searchedQueries(stub.log)).toEqual([
					`https://www.youtube.com/@egil/search?query=${encodeURIComponent("수비 라인 맞음")}`,
					`https://www.youtube.com/@egil/search?query=${encodeURIComponent("코너 수비")}`,
				]);
				expect(readFileSync(join(fixture.work, "refs-review.md"), "utf8")).toContain("- CCCCCCCCCCC 채널 안 영상");
			});

			test("채널 안 검색이 실패하면 전체 검색에 축구 단어를 붙여 대신한다", () => {
				const fixture = withUnfound([channelRef("AAAAAAAAAAA", "E GIL", ["u001"])], [unfoundUnit("u002")]);
				const stub = stubWithChannelUrl(`case "$1" in *"/search?query="*) echo "ERROR: 404" >&2; exit 1;; esac\necho "VYRAwKX9Sek 전체 검색 결과"`);
				run2(fixture, stub);
				expect(searchedQueries(stub.log)).toEqual([`https://www.youtube.com/@egil/search?query=${encodeURIComponent("코너 수비")}`, "E GIL 코너 수비 축구"]);
				const bundle = readFileSync(join(fixture.work, "refs-review.md"), "utf8");
				expect(bundle).toContain("- VYRAwKX9Sek 전체 검색 결과");
				expect(bundle).toContain("채널 안 검색 불가 — 전체 검색으로 대신함");
			});

			test("--no-search면 검색하지 않는다", () => {
				const { cwd, home, work } = withUnfound([videoRef("BBBBBBBBBBB", ["u001"], true)], [unfoundUnit("u002")]);
				const stub = stubYtDlp("true");
				expect(run(["refs-bundle", "--work", work, "--no-search"], { cwd, home, env: { FC_FEEDBACK_YTDLP_BIN: stub.bin } }).exitCode).toBe(0);
				expect(existsSync(stub.log)).toBe(false);
				expect(readFileSync(join(work, "refs-review.md"), "utf8")).toContain("검색 안 함(--no-search)");
			});

			test("검색이 실패하면 '검색 실패: 이유'를 싣고 명령은 성공한다", () => {
				const { cwd, home, work } = withUnfound([videoRef("BBBBBBBBBBB", ["u001"], true)], [unfoundUnit("u002")]);
				const stub = stubYtDlp(`echo "ERROR: network down" >&2\nexit 3`);
				const result = run(["refs-bundle", "--work", work], { cwd, home, env: { FC_FEEDBACK_YTDLP_BIN: stub.bin } });
				expect(result.exitCode).toBe(0);
				expect(readFileSync(join(work, "refs-review.md"), "utf8")).toContain("- 검색 실패: ERROR: network down");
			});

			test("붙은 YouTube 영상이 없거나 unfound 기록이 없으면 검색하지 않는다", () => {
				const none = withUnfound([], [unfoundUnit("u001"), unfoundUnit("u002")]);
				const stub = stubYtDlp("true");
				expect(run(["refs-bundle", "--work", none.work], { cwd: none.cwd, home: none.home, env: { FC_FEEDBACK_YTDLP_BIN: stub.bin } }).exitCode).toBe(0);
				const noUnfound = withUnfound([videoRef("BBBBBBBBBBB", ["u001", "u002"], true)], []);
				expect(run(["refs-bundle", "--work", noUnfound.work], { cwd: noUnfound.cwd, home: noUnfound.home, env: { FC_FEEDBACK_YTDLP_BIN: stub.bin } }).exitCode).toBe(0);
				expect(existsSync(stub.log)).toBe(false);
			});
		});

		test("inferred_member_ids를 모르는 옛 plan.validated.json도 refs-bundle이 읽는다(추정 없음)", () => {
			const { cwd, home, work } = twoUnitBundleFixture([videoRef("BBBBBBBBBBB", ["u001"], true)]);
			const validatedPath = join(work, "plan.validated.json");
			const validated = JSON.parse(readFileSync(validatedPath, "utf8"));
			for (const unit of validated.units) delete unit.inferred_member_ids;
			writeFileSync(validatedPath, JSON.stringify(validated));
			expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
		});

		test("적중이 하나도 없으면 섹션에 없음을 쓴다", () => {
			const { cwd, home, work } = twoUnitBundleFixture([videoRef("BBBBBBBBBBB", ["u001"], true)]);
			writeSubs(work, "BBBBBBBBBBB", "전혀 상관없는 이야기");
			expect(run(["refs-bundle", "--work", work], { cwd, home }).exitCode).toBe(0);
			const bundle = readFileSync(join(work, "refs-review.md"), "utf8");
			expect(bundle.slice(bundle.indexOf("## 유닛별 프로클럽 자막 적중"), bundle.indexOf("## 붙이지 않은 자막"))).toContain("- 없음");
		});
	});

	test("같은 세션을 재렌더하면 index.json이(updated_at 제외) 동일하다", () => {
		const { cwd, home, archive, work } = buildRenderedFixture();

		const first = run(["render", "--work", work], { cwd, home });
		expect(first.exitCode).toBe(0);
		const before = withoutUpdatedAt(readFileSync(join(archive, "index.json"), "utf8"));

		const second = run(["render", "--work", work], { cwd, home });
		expect(second.exitCode).toBe(0);
		const after = withoutUpdatedAt(readFileSync(join(archive, "index.json"), "utf8"));

		expect(after).toEqual(before);
	});

	test("아카이브 이미지가 사라지면 publish-prep의 링크 검사가 깨진 링크로 실패한다", () => {
		const { cwd, home, archive, work, sessionId } = buildRenderedFixture();
		const rendered = run(["render", "--work", work], { cwd, home });
		expect(rendered.exitCode).toBe(0);

		rmSync(join(archive, "sessions", sessionId, "img", "u001-c001.webp"));

		const result = run(["publish-prep"], { cwd, home });
		expect(result.exitCode).not.toBe(0);
		const broken = JSON.parse(result.stderr.trim());
		expect(Array.isArray(broken)).toBe(true);
		expect(broken.length).toBeGreaterThan(0);
	});

	test("disabled 모드의 render --site-only는 아카이브를 건드리지 않는다(해시 불변)", () => {
		const { cwd, home, archive, work } = buildRenderedFixture();
		const before = hashDir(archive);

		const disable = run(["config", "disable"], { cwd, home });
		expect(disable.exitCode).toBe(0);

		const result = run(["render", "--work", work, "--site-only"], { cwd, home });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout.trim());
		expect(parsed.ok).toBe(true);
		expect(parsed.output).toBe("site");

		const siteData = JSON.parse(readFileSync(join(work, "site", "sessions", parsed.session_id, "data.json"), "utf8"));
		expect(siteData.units).toHaveLength(1);

		const after = hashDir(archive);
		expect(after).toBe(before);
	});

	test("publish-prep은 커밋을 만들지 않는다", () => {
		const { cwd, home, archive, work } = buildRenderedFixture();
		const rendered = run(["render", "--work", work], { cwd, home });
		expect(rendered.exitCode).toBe(0);

		const logBefore = execFileSync("git", ["-C", archive, "log", "--oneline"], { encoding: "utf8" });

		const result = run(["publish-prep"], { cwd, home });
		expect(result.exitCode).toBe(0);
		const parsed = JSON.parse(result.stdout.trim());
		expect(parsed.ok).toBe(true);
		expect(parsed.broken_links).toBe(0);
		expect(parsed.suggested_commands.length).toBeGreaterThan(0);
		expect(parsed.git_status).toContain("index.json");

		const logAfter = execFileSync("git", ["-C", archive, "log", "--oneline"], { encoding: "utf8" });
		expect(logAfter).toBe(logBefore);
	});

	// ── QA 픽스처(__fixtures__/qa) ───────────────────────────────────────────
	//
	// build.sh (visual-qa 캡처용, 네트워크·ffmpeg 필요)의 검증 단계만 여기서도
	// 반복한다: check plan/notes/similar/refs가 고정 fixture에 대해 exit 0을
	// 내는지, similar-candidates.json이 similar-candidates.expected.json과
	// 정확히 일치하는지. 이미지는 tinyWebp() 1x1로 대체해 네트워크 없이 빠르게 돈다.

	/** Stand-in for `frames`: one 1x1 webp per notes.json frame block, named as `frames` names it. */
	function writeNoteFrameImages(work: string, imgDir: string): void {
		const notes = JSON.parse(readFileSync(join(work, "notes.json"), "utf8")) as {
			units: Record<string, { blocks: { type: string; candidate_id?: string }[] }>;
		};
		for (const [unitId, entry] of Object.entries(notes.units)) {
			for (const block of entry.blocks) {
				if (block.type === "frame" && block.candidate_id !== undefined) {
					writeFileSync(join(imgDir, `${unitId}-${block.candidate_id}.webp`), tinyWebp());
				}
			}
		}
	}

	test("QA 픽스처는 check plan/notes/similar/refs를 모두 통과한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		run(["init-archive", "--archive", archive], { cwd, home });
		writeFileSync(join(archive, "taxonomy.yaml"), readFileSync(join(QA_FIXTURES_DIR, "archive-seed", "taxonomy.yaml")));
		const rosterPath = join(archive, "roster.yaml");
		writeFileSync(rosterPath, readFileSync(join(QA_FIXTURES_DIR, "archive-seed", "roster.yaml")));

		const configured = run(
			["config", "set", "--archive", archive, "--roster", rosterPath, "--pages-url", "https://example.com/"],
			{ cwd, home },
		);
		expect(configured.exitCode).toBe(0);

		// past: 단일 파트 세션, 아카이브에 먼저 렌더되어 similar의 비교 대상이 된다.
		const workPast = tempDir();
		copyQaWorkFiles(join(QA_FIXTURES_DIR, "work-past"), workPast);
		expect(run(["check", "plan", "--work", workPast], { cwd, home }).exitCode).toBe(0);
		expect(run(["check", "notes", "--work", workPast], { cwd, home }).exitCode).toBe(0);
		expect(run(["similar", "--work", workPast], { cwd, home }).exitCode).toBe(0);
		expect(run(["check", "similar", "--work", workPast], { cwd, home }).exitCode).toBe(0);
		expect(run(["check", "refs", "--work", workPast], { cwd, home }).exitCode).toBe(0);

		const pastPlan = JSON.parse(readFileSync(join(workPast, "plan.validated.json"), "utf8"));
		const pastImgDir = join(workPast, "img");
		mkdirSync(pastImgDir, { recursive: true });
		for (const unit of pastPlan.units as { id: string }[]) {
			writeFileSync(join(pastImgDir, `${unit.id}-start.webp`), tinyWebp());
		}
		writeNoteFrameImages(workPast, pastImgDir);
		const pastRendered = run(["render", "--work", workPast], { cwd, home });
		expect(pastRendered.exitCode).toBe(0);

		// current: 2파트 세션. "세트피스"는 archive-seed taxonomy에 없으므로
		// taxonomy add로 먼저 승인한 뒤 check plan을 돌린다(pending 게이트를 타지 않음).
		const workCurrent = tempDir();
		copyQaWorkFiles(join(QA_FIXTURES_DIR, "work-current"), workCurrent);
		expect(run(["taxonomy", "add", "세트피스", "--work", workCurrent], { cwd, home }).exitCode).toBe(0);
		expect(run(["check", "plan", "--work", workCurrent], { cwd, home }).exitCode).toBe(0);
		expect(run(["check", "notes", "--work", workCurrent], { cwd, home }).exitCode).toBe(0);
		expect(run(["similar", "--work", workCurrent], { cwd, home }).exitCode).toBe(0);

		const expectedSimilar = JSON.parse(readFileSync(join(QA_FIXTURES_DIR, "similar-candidates.expected.json"), "utf8"));
		const actualSimilar = JSON.parse(readFileSync(join(workCurrent, "similar-candidates.json"), "utf8"));
		expect(actualSimilar).toEqual(expectedSimilar);

		expect(run(["check", "similar", "--work", workCurrent], { cwd, home }).exitCode).toBe(0);
		expect(run(["check", "refs", "--work", workCurrent], { cwd, home }).exitCode).toBe(0);

		// refs-bundle: 유튜브 영상 자료는 video_starts 앞뒤 90초 자막만, 안 쓴 자막 파일은 끝에 목록으로.
		const bundleDraft = JSON.parse(readFileSync(join(workCurrent, "refs-draft.json"), "utf8"));
		bundleDraft.refs[1].url = "https://www.youtube.com/watch?v=AAAAAAAAAAA";
		bundleDraft.refs[1].lesson_ko = { u004: "풀백이 안쪽으로 좁혀 선다" };
		writeFileSync(join(workCurrent, "refs-draft.json"), JSON.stringify(bundleDraft));
		mkdirSync(join(workCurrent, "refsubs"));
		const cue = (t: string, text: string) => `${t} --> ${t.replace(/\.000$/, ".900")}\n${text}\n`;
		writeFileSync(
			join(workCurrent, "refsubs", "AAAAAAAAAAA.en.vtt"),
			["WEBVTT\n", cue("00:00:30.000", "too early"), cue("00:01:00.000", "overlap from the full back"), cue("00:03:41.000", "too late")].join("\n"),
		);
		writeFileSync(join(workCurrent, "refsubs", "BBBBBBBBBBB.en.vtt"), "WEBVTT\n");
		expect(run(["refs-bundle", "--work", workCurrent], { cwd, home }).exitCode).toBe(0);
		const bundle = readFileSync(join(workCurrent, "refs-review.md"), "utf8");
		expect(bundle).toContain("> [1:00] overlap from the full back");
		expect(bundle).not.toContain("too early");
		expect(bundle).not.toContain("too late");
		expect(bundle).toContain(`relevance_ko: ${bundleDraft.refs[1].relevance_ko.u004}`);
		// 리뷰어가 카드의 "자료가 권하는 것" 줄도 자막과 대조할 수 있게 lesson_ko를 함께 싣는다.
		expect(bundle).toContain("lesson_ko: 풀백이 안쪽으로 좁혀 선다");
		expect(bundle).toContain("- refsubs/BBBBBBBBBBB.en.vtt");
		expect(bundle).toContain("## 자료 없는 유닛");
		expect(bundle).not.toMatch(/## 자료 없는 유닛[\s\S]*- u004 ·/);
		expect(bundle).not.toContain("- refsubs/AAAAAAAAAAA.en.vtt\n");

		const currentPlan = JSON.parse(readFileSync(join(workCurrent, "plan.validated.json"), "utf8"));
		expect(currentPlan.units.length).toBeGreaterThanOrEqual(14);
		expect(currentPlan.matches.length).toBeGreaterThanOrEqual(3);

		const currentImgDir = join(workCurrent, "img");
		mkdirSync(currentImgDir, { recursive: true });
		for (const unit of currentPlan.units as { id: string }[]) {
			writeFileSync(join(currentImgDir, `${unit.id}-start.webp`), tinyWebp());
		}
		writeNoteFrameImages(workCurrent, currentImgDir);

		const currentRendered = run(["render", "--work", workCurrent], { cwd, home });
		expect(currentRendered.exitCode).toBe(0);
		const currentParsed = JSON.parse(currentRendered.stdout.trim());
		expect(currentParsed.broken_links).toBe(0);
	});
});

// ── notes next / submit (유닛 단위 작성 루프) ──────────────────────────────

describe("fc-feedback notes next/submit", () => {
	const VIDEO = "NUzEChn9EyI";

	/** 유닛 3개(u001 0–5초, u002 10–15초, u003 20–25초)와 유닛마다 후보 1개를 가진 작업 폴더. */
	function loopWork(rosterYaml?: string): { cwd: string; home: string; work: string } {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		writeFileSync(join(archive, "taxonomy.yaml"), "version: 1\ntopics: [빌드업]\n");
		run(["config", "set", "--archive", archive, "--roster", rosterFile(rosterYaml), "--pages-url", "https://example.com/"], { cwd, home });
		const work = tempDir();
		writeFileSync(
			join(work, "lines.json"),
			JSON.stringify([
				{ i: 0, video: VIDEO, start: 0, end: 5, text: "첫째 대사" },
				{ i: 1, video: VIDEO, start: 10, end: 15, text: "둘째 대사", source: "comment", author: "@뎁스차저" },
				{ i: 2, video: VIDEO, start: 20, end: 25, text: "셋째 대사" },
			]),
		);
		const unit = (title: string, line: number) => ({
			title,
			start_line: line,
			end_line: line,
			position_tags: ["CB"],
			topic_tags: ["빌드업"],
			member_ids: [],
			key_frame_candidate_ids: [],
			group_positions: [],
		});
		writeFileSync(
			join(work, "plan.json"),
			JSON.stringify({
				session_title: "테스트 세션",
				recurring: [],
				matches_without_feedback: [],
				matches: [
					{
						title: "1경기",
						lineup: {},
						topics: [{ title: "빌드업 주제", summary: "빌드업 상황 정리", units: [unit("센터백: 첫째 하기", 0), unit("센터백: 둘째 하기", 1), unit("센터백: 셋째 하기", 2)] }],
					},
				],
			}),
		);
		writeFileSync(
			join(work, "candidates.json"),
			JSON.stringify([
				{ id: "c001", video: VIDEO, t: 2, kind: "manual" },
				{ id: "c002", video: VIDEO, t: 12, kind: "manual" },
				{ id: "c003", video: VIDEO, t: 22, kind: "manual" },
			]),
		);
		expect(run(["check", "plan", "--work", work], { cwd, home }).exitCode).toBe(0);
		return { cwd, home, work };
	}

	function unitNote(candidateId: string, caption = "장면") {
		return {
			blocks: [
				{ type: "text", text: "**볼드** 문장입니다" },
				{ type: "frame", candidate_id: candidateId, caption },
			],
		};
	}

	function submit(ctx: { cwd: string; home: string; work: string }, unitId: string, body: unknown): RunResult {
		mkdirSync(join(ctx.work, "notes-units"), { recursive: true });
		const file = join(ctx.work, "notes-units", `${unitId}.json`);
		writeFileSync(file, JSON.stringify(body));
		return run(["notes", "submit", unitId, "--file", file, "--work", ctx.work], ctx);
	}

	test("notes next는 notes.json이 없으면 첫 유닛의 브리프를 낸다", () => {
		const ctx = loopWork();
		const result = run(["notes", "next", "--work", ctx.work], ctx);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("u001");
		expect(result.stdout).toContain("1/3");
		expect(result.stdout).toContain("센터백: 첫째 하기");
		expect(result.stdout).toContain("0:00–0:05");
		expect(result.stdout).toContain("첫째 대사");
		expect(result.stdout).toContain("cand/c001.jpg");
		expect(result.stdout).toContain(`notes submit u001 --file ${ctx.work}/notes-units/u001.json`);
		expect(result.stdout).not.toContain("둘째 대사");
		expect(existsSync(join(ctx.work, "notes.json"))).toBe(false);
	});

	test("notes next는 plan.validated.json이 없으면 exit 1", () => {
		const result = run(["notes", "next", "--work", tempDir()], { cwd: repo(), home: tempDir() });
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("plan.validated.json");
	});

	test("notes submit은 유효한 유닛을 notes.json에 쓰고 다음 유닛의 브리프를 낸다", () => {
		const ctx = loopWork();
		const result = submit(ctx, "u001", { unit: unitNote("c001") });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("u002");
		expect(result.stdout).toContain("2/3");
		expect(result.stdout).toContain("[댓글 뎁스차저] 둘째 대사");
		const notes = JSON.parse(readFileSync(join(ctx.work, "notes.json"), "utf8"));
		expect(notes.version).toBe(2);
		expect(Object.keys(notes.units)).toEqual(["u001"]);
		expect(notes.units.u001.blocks).toHaveLength(2);
	});

	test("notes submit은 무효한 유닛(첫 블록이 frame)이면 exit 1이고 notes.json을 바꾸지 않는다", () => {
		const ctx = loopWork();
		const bad = { unit: { blocks: [...unitNote("c001").blocks].reverse() } };
		const rejected = submit(ctx, "u001", bad);
		expect(rejected.exitCode).toBe(1);
		expect(rejected.stderr).toContain("units.u001.blocks[0]");
		expect(existsSync(join(ctx.work, "notes.json"))).toBe(false);

		expect(submit(ctx, "u001", { unit: unitNote("c001") }).exitCode).toBe(0);
		const before = readFileSync(join(ctx.work, "notes.json"), "utf8");
		expect(submit(ctx, "u001", bad).exitCode).toBe(1);
		expect(readFileSync(join(ctx.work, "notes.json"), "utf8")).toBe(before);
	});

	test("notes submit을 다시 하면 같은 경기·같은 사람의 marker_colors와 같은 경기·같은 이름표의 unmatched_name_tags는 덧붙지 않고 바뀐다", () => {
		const ctx = loopWork();
		const marker = (color: string) => ({ match: 1, member_id: "hong", color, evidence_candidate_id: "c001" });
		const tag = (color: string) => ({ match: 1, tag: "SAMBA", color, evidence_candidate_id: "c001" });
		expect(submit(ctx, "u001", { unit: unitNote("c001"), marker_colors: [marker("분홍")], unmatched_name_tags: [tag("자홍")] }).exitCode).toBe(0);
		const again = submit(ctx, "u001", { unit: unitNote("c001"), marker_colors: [marker("하늘")], unmatched_name_tags: [tag("노랑")] });
		expect(again.stderr).toBe("");
		expect(again.exitCode).toBe(0);
		const notes = JSON.parse(readFileSync(join(ctx.work, "notes.json"), "utf8"));
		expect(notes.marker_colors).toEqual([marker("하늘")]);
		expect(notes.unmatched_name_tags).toEqual([tag("노랑")]);
	});

	test("notes submit은 알 수 없는 유닛 id와 깨진 파일을 exit 1로 거부한다", () => {
		const ctx = loopWork();
		const unknown = submit(ctx, "u099", { unit: unitNote("c001") });
		expect(unknown.exitCode).toBe(1);
		expect(unknown.stderr).toContain("검증된 plan에 없는 unit id입니다: u099");
		const noUnit = submit(ctx, "u001", { blocks: [] });
		expect(noUnit.exitCode).toBe(1);
		expect(noUnit.stderr).toContain("unit 객체");
		const file = join(ctx.work, "notes-units", "u001.json");
		writeFileSync(file, "{not json");
		expect(run(["notes", "submit", "u001", "--file", file, "--work", ctx.work], ctx).exitCode).toBe(1);
		expect(existsSync(join(ctx.work, "notes.json"))).toBe(false);
	});

	test("다른 유닛의 오류는 이 유닛의 submit을 막지 않는다", () => {
		const ctx = loopWork();
		const broken = { blocks: [{ type: "text", text: "**볼드** 프레임이 없는 유닛" }] };
		writeFileSync(join(ctx.work, "notes.json"), JSON.stringify({ version: 2, units: { u002: broken } }));
		const result = submit(ctx, "u001", { unit: unitNote("c001") });
		expect(result.exitCode).toBe(0);
		const notes = JSON.parse(readFileSync(join(ctx.work, "notes.json"), "utf8"));
		expect(notes.units.u002).toEqual(broken);
		expect(notes.units.u001.blocks).toHaveLength(2);
	});

	test("모든 유닛이 있지만 전체 검증이 실패하면 notes next는 오류가 있는 첫 유닛을 오류와 함께 낸다", () => {
		const ctx = loopWork();
		const broken = { blocks: [{ type: "text", text: "**볼드** 프레임이 없는 유닛" }] };
		writeFileSync(
			join(ctx.work, "notes.json"),
			JSON.stringify({ version: 2, units: { u001: unitNote("c001"), u002: broken, u003: unitNote("c003") } }),
		);
		const result = run(["notes", "next", "--work", ctx.work], ctx);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("u002");
		expect(result.stdout).toContain("2/3");
		expect(result.stdout).toContain("frame 블록이 최소 1개 이상 있어야 합니다");
		expect(result.stdout.indexOf("frame 블록이 최소 1개")).toBeLessThan(result.stdout.indexOf("원문"));
	});

	test("유닛에 매이지 않는 오류는 submit의 match 수준 필드로 고치라고 알린다", () => {
		const ctx = loopWork();
		writeFileSync(
			join(ctx.work, "notes.json"),
			JSON.stringify({
				version: 2,
				units: { u001: unitNote("c001"), u002: unitNote("c002"), u003: unitNote("c003") },
				marker_colors: [{ match: 1, member_id: "hong", color: "", evidence_candidate_id: "c001" }],
			}),
		);
		const result = run(["notes", "next", "--work", ctx.work], ctx);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("marker_colors[0].color");
		expect(result.stdout).toContain("marker_colors");
		expect(result.stdout).toContain("notes submit");
	});

	test("모든 유닛이 있고 검증이 통과하면 notes next는 완료와 다음 단계를 알린다", () => {
		const ctx = loopWork();
		expect(submit(ctx, "u001", { unit: unitNote("c001") }).exitCode).toBe(0);
		expect(submit(ctx, "u002", { unit: unitNote("c002") }).exitCode).toBe(0);
		const last = submit(ctx, "u003", { unit: unitNote("c003") });
		expect(last.exitCode).toBe(0);
		expect(last.stdout).toContain("SOURCE REVIEW");
		const next = run(["notes", "next", "--work", ctx.work], ctx);
		expect(next.exitCode).toBe(0);
		expect(next.stdout).toContain("SOURCE REVIEW");
		expect(next.stdout).not.toContain("원문 줄");
	});

	test("브리프는 marker_colors submit 뒤 이 경기의 색 범례와 이미 짚은 사람을 보여 준다", () => {
		const ctx = loopWork();
		const before = run(["notes", "next", "--work", ctx.work], ctx);
		expect(before.stdout).toMatch(/범례[^\n]*\n[^\n]*없음/);
		const result = submit(ctx, "u001", {
			unit: unitNote("c001", "홍길동(화면 가운데)이 공을 잡는 장면"),
			marker_colors: [{ match: 1, member_id: "hong", color: "분홍", evidence_candidate_id: "c001" }],
			unmatched_name_tags: [{ match: 1, tag: "SAMBA", color: "자홍", evidence_candidate_id: "c001" }],
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("홍길동 분홍 삼각형");
		expect(result.stdout).toContain("SAMBA 이름표(명단에 없음) 자홍 삼각형");
		expect(result.stdout).toMatch(/이미 짚은 사람[^\n]*\n[^\n]*홍길동/);
		const notes = JSON.parse(readFileSync(join(ctx.work, "notes.json"), "utf8"));
		expect(notes.marker_colors).toHaveLength(1);
		expect(notes.unmatched_name_tags).toHaveLength(1);
	});

	test("한글 자판으로 읽히는 이름표는 submit·check notes가 stderr 경고로 읽기를 보이고 브리프 범례에도 싣는다", () => {
		const ctx = loopWork();
		const tag = { match: 1, tag: "CEF_dnjswo313", color: "자홍", evidence_candidate_id: "c001" };
		const first = submit(ctx, "u001", { unit: unitNote("c001"), unmatched_name_tags: [tag] });
		expect(first.exitCode).toBe(0);
		const warning = 'fc-feedback: 경고 이름표 CEF_dnjswo313는 한글 자판으로 "원재"로 읽힌다 — 명단에 없는 사람이면 본문·캡션에서 "원재(CEF_dnjswo313 이름표)"처럼 그 이름으로 부른다';
		expect(first.stderr).toContain(warning);
		expect(first.stdout).toContain('CEF_dnjswo313 이름표(명단에 없음; 한글 자판 "원재") 자홍 삼각형');
		expect(submit(ctx, "u002", { unit: unitNote("c002") }).stderr).not.toContain("한글 자판");
		expect(submit(ctx, "u003", { unit: unitNote("c003") }).exitCode).toBe(0);
		const checked = run(["check", "notes", "--work", ctx.work], ctx);
		expect(checked.exitCode).toBe(0);
		expect(checked.stderr).toContain(warning);
	});

	test("읽기가 명단 이름과 한 글자 차이(초성 같음)면 submit·check notes 경고와 브리프 범례가 그 팀원을 후보로 보이되 배정하지 않는다", () => {
		const ctx = loopWork("members:\n  - id: hong\n    name: 홍길동\n    gamertag: HongGD\n    positions: [CB]\n  - id: wonjeon\n    name: 원전\n    gamertag: WonJeon\n    positions: [CB]\n");
		const tag = { match: 1, tag: "CEF_dnjswo313", color: "자홍", evidence_candidate_id: "c001" };
		const first = submit(ctx, "u001", { unit: unitNote("c001"), unmatched_name_tags: [tag] });
		expect(first.exitCode).toBe(0);
		const warning =
			'fc-feedback: 경고 이름표 CEF_dnjswo313는 한글 자판으로 "원재"로 읽힌다 — 명단에 없는 사람이면 본문·캡션에서 "원재(CEF_dnjswo313 이름표)"처럼 그 이름으로 부른다 — 명단의 원전과 같은 사람일 수 있다: 같은 사람이면 그 팀원으로 쓰고, 모르면 그대로 둔다';
		expect(first.stderr).toContain(warning);
		expect(first.stdout).toContain('CEF_dnjswo313 이름표(명단에 없음; 한글 자판 "원재", 명단 원전과 비슷) 자홍 삼각형');
		expect(submit(ctx, "u002", { unit: unitNote("c002") }).exitCode).toBe(0);
		expect(submit(ctx, "u003", { unit: unitNote("c003") }).exitCode).toBe(0);
		const checked = run(["check", "notes", "--work", ctx.work], ctx);
		expect(checked.exitCode).toBe(0);
		expect(checked.stderr).toContain(warning);
		const notes = JSON.parse(readFileSync(join(ctx.work, "notes.json"), "utf8"));
		expect(notes.unmatched_name_tags).toHaveLength(1);
		expect(JSON.stringify(notes)).not.toContain("wonjeon");
	});

	test("브리프는 range 후보가 유닛 범위 전체를 덮지 않으면 scan-range 명령을, 덮으면 생략한다", () => {
		const ctx = loopWork();
		const command = `bun \${CLAUDE_SKILL_DIR}/scripts/fc.ts scan-range --video ${VIDEO} --from 0 --to 5 --work ${ctx.work}`;
		expect(run(["notes", "next", "--work", ctx.work], ctx).stdout).toContain(command);
		const withCandidates = (rangeTimes: number[]) => {
			writeFileSync(
				join(ctx.work, "candidates.json"),
				JSON.stringify([{ id: "c001", video: VIDEO, t: 2, kind: "manual" }, ...rangeTimes.map((t, k) => ({ id: `c${101 + k}`, video: VIDEO, t, kind: "range" }))]),
			);
			return run(["notes", "next", "--work", ctx.work], ctx).stdout;
		};
		expect(withCandidates([4])).toContain(command);
		const covered = withCandidates([0, 2, 4]);
		expect(covered).not.toContain("scan-range --video");
		expect(covered).toContain("구간 훑기: range 후보가 유닛 범위 전체를 덮음");
	});

	test("브리프는 프레임 후보를 20개로 줄이고 생략한 개수를 알린다", () => {
		const ctx = loopWork();
		writeFileSync(
			join(ctx.work, "candidates.json"),
			JSON.stringify(Array.from({ length: 25 }, (_, k) => ({ id: `c${String(k + 1).padStart(3, "0")}`, video: VIDEO, t: k * 0.4, kind: "manual" }))),
		);
		const result = run(["notes", "next", "--work", ctx.work], ctx);
		expect(result.stdout.match(/cand\/c\d{3}\.jpg/g)).toHaveLength(20);
		expect(result.stdout).toContain("5개 생략");
	});
});
