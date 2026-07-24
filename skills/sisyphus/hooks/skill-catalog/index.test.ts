import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { parseInput, main, detectHarness } from "./index.ts";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("parseInput", () => {
	it("유효한 JSON에서 cwd와 sessionId를 파싱한다", () => {
		const result = parseInput('{"sessionId": "abc123", "cwd": "/tmp/project"}');
		expect(result.sessionId).toBe("abc123");
		expect(result.cwd).toBe("/tmp/project");
		expect(result.hookEventName).toBe("UserPromptSubmit");
	});

	it("유효하지 않은 JSON이면 기본값으로 폴백한다", () => {
		const result = parseInput("not-json");
		expect(result.sessionId).toBe("default");
		expect(result.cwd).toBe(process.cwd());
		expect(result.hookEventName).toBe("UserPromptSubmit");
	});

	it("snake_case session_id를 처리한다", () => {
		const result = parseInput('{"session_id": "snake123"}');
		expect(result.sessionId).toBe("snake123");
	});

	it("session_id보다 sessionId를 우선한다", () => {
		const result = parseInput('{"sessionId": "camel", "session_id": "snake"}');
		expect(result.sessionId).toBe("camel");
	});

	it("hook_event_name이 전달되면 해당 값을 사용한다", () => {
		const result = parseInput('{"hook_event_name": "TestEvent"}');
		expect(result.hookEventName).toBe("TestEvent");
	});
});

describe("detectHarness", () => {
	let originalCodexThreadId: string | undefined;
	let originalOmtSessionId: string | undefined;

	beforeEach(() => {
		originalCodexThreadId = process.env.CODEX_THREAD_ID;
		originalOmtSessionId = process.env.OMT_SESSION_ID;
	});

	afterEach(() => {
		if (originalCodexThreadId === undefined) {
			delete process.env.CODEX_THREAD_ID;
		} else {
			process.env.CODEX_THREAD_ID = originalCodexThreadId;
		}
		if (originalOmtSessionId === undefined) {
			delete process.env.OMT_SESSION_ID;
		} else {
			process.env.OMT_SESSION_ID = originalOmtSessionId;
		}
	});

	it("CODEX_THREAD_ID 미설정 시 claude를 반환한다 (기본값)", () => {
		delete process.env.CODEX_THREAD_ID;
		delete process.env.OMT_SESSION_ID;
		expect(detectHarness()).toBe("claude");
	});

	it("CODEX_THREAD_ID 설정 시 codex를 반환한다", () => {
		delete process.env.OMT_SESSION_ID;
		process.env.CODEX_THREAD_ID = "fake-codex-thread-1";
		expect(detectHarness()).toBe("codex");
	});

	it("OMT_SESSION_ID와 CODEX_THREAD_ID가 둘 다 설정돼 있으면 OMT_SESSION_ID가 우선해 claude를 반환한다 (결함 2 회귀 fixture)", () => {
		// Regression fixture for the confirmed leak: launching Claude Code from
		// inside a Codex shell lets CODEX_THREAD_ID survive into Claude's
		// inherited env while OMT_SESSION_ID is freshly set by the actual
		// current (Claude) session. Pre-fix, testing CODEX_THREAD_ID's mere
		// presence misread this as a Codex session and scanned .agents/skills,
		// silently dropping every platforms:[claude] skill from the catalog.
		process.env.OMT_SESSION_ID = "claude-session-1";
		process.env.CODEX_THREAD_ID = "codex-thread-leaked-from-parent";
		expect(detectHarness()).toBe("claude");
	});

	it("OMT_SESSION_ID만 설정돼 있으면 claude를 반환한다 (무회귀)", () => {
		process.env.OMT_SESSION_ID = "claude-session-1";
		delete process.env.CODEX_THREAD_ID;
		expect(detectHarness()).toBe("claude");
	});
});

describe("main (통합)", () => {
	let tempDir: string;
	let originalHome: string | undefined;
	let originalCodexThreadId: string | undefined;
	let originalOmtSessionId: string | undefined;
	let originalCwd: string | undefined;
	let consoleOutput: string[];
	let originalLog: typeof console.log;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skill-catalog-integration-"));
		originalHome = process.env.HOME;
		originalCodexThreadId = process.env.CODEX_THREAD_ID;
		originalOmtSessionId = process.env.OMT_SESSION_ID;
		originalCwd = process.cwd();
		delete process.env.CODEX_THREAD_ID;
		// detectHarness() now checks OMT_SESSION_ID first (결함 2 fix) — clear it
		// here so a real OMT_SESSION_ID leaked from the outer test-runner's own
		// Claude Code session (this repo's own agent env) never masks a test's
		// CODEX_THREAD_ID simulation below.
		delete process.env.OMT_SESSION_ID;
		// eslint-disable-next-line no-console -- 카탈로그 stdout 캡처용 모킹
		originalLog = console.log;
		consoleOutput = [];
		// eslint-disable-next-line no-console -- 카탈로그 stdout 캡처용 모킹
		console.log = (...args: unknown[]) => {
			consoleOutput.push(args.map(String).join(" "));
		};
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		if (originalCodexThreadId === undefined) {
			delete process.env.CODEX_THREAD_ID;
		} else {
			process.env.CODEX_THREAD_ID = originalCodexThreadId;
		}
		if (originalOmtSessionId === undefined) {
			delete process.env.OMT_SESSION_ID;
		} else {
			process.env.OMT_SESSION_ID = originalOmtSessionId;
		}
		if (originalCwd) {
			process.chdir(originalCwd);
		}
		// eslint-disable-next-line no-console -- 카탈로그 stdout 캡처용 모킹 원복
		console.log = originalLog;
		await rm(tempDir, { recursive: true, force: true });
	});

	it("플러그인 활성화 시 plain-text 카탈로그를 출력한다", async () => {
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await writeFile(
			join(fakeHome, ".claude", "settings.json"),
			JSON.stringify({ enabledPlugins: { "frontend-design@claude-plugins-official": true } }),
		);
		process.env.HOME = fakeHome;

		await main();

		expect(consoleOutput.length).toBeGreaterThan(0);
		const joined = consoleOutput.join("\n");
		expect(joined).toContain("<skill-catalog>");
		expect(joined).toContain("</skill-catalog>");
		expect(joined).toContain("frontend-design");
	});

	it("플러그인 활성화 시 스킬 디렉토리 없어도 plugin 스킬 포함", async () => {
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await writeFile(
			join(fakeHome, ".claude", "settings.json"),
			JSON.stringify({ enabledPlugins: { "frontend-design@claude-plugins-official": true } }),
		);
		process.env.HOME = fakeHome;

		await main();

		expect(consoleOutput.length).toBeGreaterThan(0);
		const joined = consoleOutput.join("\n");
		expect(joined).toContain("frontend-design");
	});

	it("plain-text 출력에 Load Skills 헤더가 포함된다", async () => {
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await writeFile(
			join(fakeHome, ".claude", "settings.json"),
			JSON.stringify({ enabledPlugins: { "frontend-design@claude-plugins-official": true } }),
		);
		process.env.HOME = fakeHome;

		await main();

		const joined = consoleOutput.join("\n");
		expect(joined).toContain("## Load Skills");
	});

	it("stdin 미패치 상태에서도 hang 없이 카탈로그를 출력한다", async () => {
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await writeFile(
			join(fakeHome, ".claude", "settings.json"),
			JSON.stringify({ enabledPlugins: { "frontend-design@claude-plugins-official": true } }),
		);
		process.env.HOME = fakeHome;

		// stdin을 전혀 패치하지 않음 — 이전 구현은 stdin 'end' 이벤트를 기다리며 hang
		await main();

		expect(consoleOutput.length).toBeGreaterThan(0);
		const joined = consoleOutput.join("\n");
		expect(joined).toContain("<skill-catalog>");
		expect(joined).toContain("</skill-catalog>");
	});

	it("main stdout is byte-identical across two consecutive invocations (AC1c)", async () => {
		// Controls: fake HOME with two enabled plugins (frontend-design maps to a
		// catalog skill; other-plugin@vendor is an unmapped enabled plugin that still
		// exercises enabledPlugins Set ordering) + no skill dirs, so both invocations
		// see identical environment/filesystem state.
		// This test documents the guarantee that Set/Map iteration order in
		// readEnabledPlugins / buildCatalog never introduces session-to-session variance.
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(join(fakeHome, ".claude"), { recursive: true });
		await writeFile(
			join(fakeHome, ".claude", "settings.json"),
			JSON.stringify({
				enabledPlugins: {
					"frontend-design@claude-plugins-official": true,
					"other-plugin@vendor": true,
				},
			}),
		);
		process.env.HOME = fakeHome;

		// First invocation — consoleOutput is captured via the shared beforeEach console.log patch
		consoleOutput = [];
		await main();
		const first = [...consoleOutput];

		// Second invocation
		consoleOutput = [];
		await main();
		const second = [...consoleOutput];

		expect(first.length).toBeGreaterThan(0);
		expect(first).toEqual(second);
	});

	it("Codex 세션(CODEX_THREAD_ID)에서 .agents/skills(Codex 배포 형태)만 있어도 스킬을 발견하고 $name mention sigil로 안내한다", async () => {
		// End-to-end regression fixture for the original bug: a Codex-shaped
		// deploy tree (only .agents/skills populated) previously found zero
		// skills and, even if it had, would have emitted an unusable
		// Skill(skill: "...") call — a tool Codex does not have.
		const projectDir = join(tempDir, "project");
		await mkdir(join(projectDir, ".agents", "skills", "my-discovered-skill"), {
			recursive: true,
		});
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;
		process.env.CODEX_THREAD_ID = "fake-codex-thread-1";
		process.chdir(projectDir);

		await main();

		const joined = consoleOutput.join("\n");
		expect(joined).toContain("my-discovered-skill");
		expect(joined).toContain("$my-discovered-skill");
		expect(joined).not.toContain("Skill(skill:");
	});

	it("Codex 세션(CODEX_THREAD_ID)은 .claude/skills 전용 스킬(예: hud)을 카탈로그에 노출하지 않는다 (harness-gating 회귀 fixture)", async () => {
		// End-to-end regression fixture for the confirmed defect: a
		// platforms:[claude]-gated skill (e.g. hud) landed only under
		// .claude/skills, never under .agents/skills. Pre-fix, main() scanned
		// both roots unconditionally and surfaced it as an invokable `$hud`
		// catalog entry in a Codex session, which fails on call since Codex has
		// no landing copy for it.
		const projectDir = join(tempDir, "project");
		await mkdir(join(projectDir, ".claude", "skills", "hud"), { recursive: true });
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;
		process.env.CODEX_THREAD_ID = "fake-codex-thread-1";
		process.chdir(projectDir);

		await main();

		const joined = consoleOutput.join("\n");
		expect(joined).not.toContain("hud");
	});

	it("Claude 세션은 .agents/skills 지원 추가 후에도 .claude/skills만으로 동일하게 동작한다 (무회귀)", async () => {
		const projectDir = join(tempDir, "project");
		await mkdir(join(projectDir, ".claude", "skills", "my-discovered-skill"), {
			recursive: true,
		});
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;
		delete process.env.CODEX_THREAD_ID;
		process.chdir(projectDir);

		await main();

		const joined = consoleOutput.join("\n");
		expect(joined).toContain("my-discovered-skill");
		expect(joined).toContain('Skill(skill: "my-discovered-skill")');
	});
});
