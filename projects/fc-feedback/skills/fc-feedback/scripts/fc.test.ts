import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS } from "./fc.ts";

const FC_PATH = join(import.meta.dir, "fc.ts");
const TAXONOMY_DEFAULT_PATH = join(import.meta.dir, "taxonomy.default.yaml");

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
});
