import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeUrl, refId } from "./core.ts";
import { COMMANDS } from "./fc.ts";

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

function run(args: string[], options: { cwd: string; home: string }): RunResult {
	const result = Bun.spawnSync(["bun", FC_PATH, ...args], {
		cwd: options.cwd,
		env: { ...process.env, HOME: options.home },
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
			matches: [
				{
					title: "1경기",
					topics: [
						{
							title: "빌드업 주제",
							summary: "빌드업 상황 정리",
							units: [
								{
									title: "유닛1",
									start_line: 0,
									end_line: 0,
									position_tags: [],
									topic_tags: [topicTag],
									member_ids: memberIds,
									key_frame_candidate_ids: [],
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
		expect(parsed.tableMd).toContain("유닛1");

		const validated = JSON.parse(readFileSync(join(work, "plan.validated.json"), "utf8"));
		expect(validated.units).toHaveLength(1);
		expect(validated.units[0].id).toBe("u001");
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

	test("verify-refs는 200을 유지하고 301 체인을 따라가며 404는 제외하고 index.json의 참고자료는 재요청하지 않는다", async () => {
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
						{ url: `${base}/ok`, title: "OK 문서", source_name: "테스트", lang: "ko", kind: "tactics", unit_ids: ["u001"] },
						{
							url: `${base}/redirect1`,
							title: "리다이렉트 문서",
							source_name: "테스트",
							lang: "ko",
							kind: "tactics",
							unit_ids: ["u001"],
						},
						{
							url: `${base}/missing`,
							title: "없는 문서",
							source_name: "테스트",
							lang: "ko",
							kind: "tactics",
							unit_ids: ["u001"],
						},
						{ url: reusedUrl, title: "재사용 문서", source_name: "테스트", lang: "ko", kind: "tactics", unit_ids: ["u001"] },
					],
				}),
			);

			const result = await runAsync(["verify-refs", "--work", work], { cwd, home });
			expect(result.exitCode).toBe(0);
			const parsed = JSON.parse(result.stdout.trim());
			expect(parsed.kept).toBe(3);
			expect(parsed.dropped).toBe(1);

			const verified = JSON.parse(readFileSync(join(work, "refs.verified.json"), "utf8"));
			const byUrl = new Map(verified.refs.map((ref: { url: string }) => [ref.url, ref]));

			const ok = byUrl.get(normalizeUrl(`${base}/ok`)) as { http_status: number; final_url: string } | undefined;
			expect(ok?.http_status).toBe(200);
			expect(ok?.final_url).toBe(normalizeUrl(`${base}/ok`));

			const redirected = byUrl.get(normalizeUrl(`${base}/redirect1`)) as { final_url: string } | undefined;
			expect(redirected?.final_url).toBe(normalizeUrl(`${base}/final`));

			const reused = byUrl.get(normalizeUrl(reusedUrl)) as { reused: boolean; page: string | null } | undefined;
			expect(reused?.reused).toBe(true);
			expect(reused?.page).toBeNull();
			expect(hits["/reused"]).toBeUndefined();

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
				version: 1,
				units: {
					u001: { problem: "문제", who: "누구", instead: "대신", key_frames: [{ candidate_id: "c001", caption: "캡션" }] },
				},
			}),
		);
		writeFileSync(
			join(work, "similar-candidates.json"),
			JSON.stringify({ version: 1, session_id: sessionId, units: { u001: [] } }),
		);
		writeFileSync(join(work, "similar-choices.json"), JSON.stringify({ version: 1, units: { u001: [] } }));
		writeFileSync(join(work, "refs-draft.json"), JSON.stringify({ version: 1, refs: [] }));
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
		expect(dataJson.units[0].images.key).toEqual([{ src: "img/u001-c001.webp", caption: "캡션", t: 2 }]);
		expect(dataJson.units[0].uid).toBe(`${sessionId}#u001`);
		expect(dataJson.units[0].watch_url).toBe("https://youtu.be/NUzEChn9EyI?t=0");

		const index = JSON.parse(readFileSync(join(archive, "index.json"), "utf8"));
		expect(index.sessions).toHaveLength(1);
		expect(index.sessions[0].id).toBe(sessionId);
		expect(index.units).toHaveLength(1);
		expect(index.units[0].href).toBe(`sessions/${sessionId}/index.html#u001`);
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

		rmSync(join(archive, "sessions", sessionId, "img", "u001-start.webp"));

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

		const currentPlan = JSON.parse(readFileSync(join(workCurrent, "plan.validated.json"), "utf8"));
		expect(currentPlan.units.length).toBeGreaterThanOrEqual(14);
		expect(currentPlan.matches.length).toBeGreaterThanOrEqual(3);

		const currentImgDir = join(workCurrent, "img");
		mkdirSync(currentImgDir, { recursive: true });
		for (const unit of currentPlan.units as { id: string }[]) {
			writeFileSync(join(currentImgDir, `${unit.id}-start.webp`), tinyWebp());
		}
		const notes = JSON.parse(readFileSync(join(workCurrent, "notes.json"), "utf8")) as {
			units: Record<string, { key_frames: { candidate_id: string }[] }>;
		};
		for (const [unitId, entry] of Object.entries(notes.units)) {
			for (const frame of entry.key_frames) {
				writeFileSync(join(currentImgDir, `${unitId}-${frame.candidate_id}.webp`), tinyWebp());
			}
		}

		const currentRendered = run(["render", "--work", workCurrent], { cwd, home });
		expect(currentRendered.exitCode).toBe(0);
		const currentParsed = JSON.parse(currentRendered.stdout.trim());
		expect(currentParsed.broken_links).toBe(0);
	});
});
