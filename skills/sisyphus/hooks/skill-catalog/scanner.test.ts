import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { scanSkillDirectories, readEnabledPlugins } from "./scanner.ts";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("scanSkillDirectories", () => {
	let tempDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "skill-catalog-test-"));
		originalHome = process.env.HOME;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await rm(tempDir, { recursive: true, force: true });
	});

	it("scans project .claude/skills/ directory (claude harness)", async () => {
		const projectDir = join(tempDir, "project");
		const skillsDir = join(projectDir, ".claude", "skills");
		await mkdir(join(skillsDir, "prometheus"), { recursive: true });
		await mkdir(join(skillsDir, "oracle"), { recursive: true });

		// Set HOME to a dir with no skills
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "claude");
		expect(skills).toContain("prometheus");
		expect(skills).toContain("oracle");
		expect(skills).toHaveLength(2);
	});

	it("scans user ~/.claude/skills/ directory (claude harness)", async () => {
		const projectDir = join(tempDir, "project");
		await mkdir(projectDir, { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		const userSkillsDir = join(fakeHome, ".claude", "skills");
		await mkdir(join(userSkillsDir, "git-master"), { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "claude");
		expect(skills).toContain("git-master");
		expect(skills).toHaveLength(1);
	});

	it("scans both directories and deduplicates (claude harness)", async () => {
		const projectDir = join(tempDir, "project");
		const projectSkillsDir = join(projectDir, ".claude", "skills");
		await mkdir(join(projectSkillsDir, "shared-skill"), { recursive: true });
		await mkdir(join(projectSkillsDir, "project-only"), { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		const userSkillsDir = join(fakeHome, ".claude", "skills");
		await mkdir(join(userSkillsDir, "shared-skill"), { recursive: true });
		await mkdir(join(userSkillsDir, "user-only"), { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "claude");
		expect(skills).toContain("shared-skill");
		expect(skills).toContain("project-only");
		expect(skills).toContain("user-only");
		// shared-skill appears only once
		expect(skills.filter((s) => s === "shared-skill")).toHaveLength(1);
		expect(skills).toHaveLength(3);
	});

	it("returns empty array when directories do not exist", async () => {
		const nonexistentDir = join(tempDir, "nonexistent");
		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(nonexistentDir, "claude");
		expect(skills).toEqual([]);
	});

	it("ignores files (only returns directories)", async () => {
		const projectDir = join(tempDir, "project");
		const skillsDir = join(projectDir, ".claude", "skills");
		await mkdir(join(skillsDir, "real-skill"), { recursive: true });
		await mkdir(skillsDir, { recursive: true });
		await writeFile(join(skillsDir, "not-a-skill.txt"), "ignored");

		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "claude");
		expect(skills).toEqual(["real-skill"]);
	});

	it("returns skills in alphabetical order regardless of creation order", async () => {
		const projectDir = join(tempDir, "project");
		const skillsDir = join(projectDir, ".claude", "skills");

		// Create in reverse alphabetical order to expose unsorted readdir
		await mkdir(join(skillsDir, "zebra-skill"), { recursive: true });
		await mkdir(join(skillsDir, "aardvark-skill"), { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "claude");
		expect(skills[0]).toBe("aardvark-skill");
	});

	it("scans project .agents/skills/ directory (Codex landing dir, tools/adapters/codex.ts codexSkillsDir; codex harness)", async () => {
		const projectDir = join(tempDir, "project");
		const skillsDir = join(projectDir, ".agents", "skills");
		await mkdir(join(skillsDir, "prometheus"), { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "codex");
		expect(skills).toEqual(["prometheus"]);
	});

	it("scans user ~/.agents/skills/ directory (Codex home landing dir; codex harness)", async () => {
		const projectDir = join(tempDir, "project");
		await mkdir(projectDir, { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		const userSkillsDir = join(fakeHome, ".agents", "skills");
		await mkdir(join(userSkillsDir, "oracle"), { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "codex");
		expect(skills).toEqual(["oracle"]);
	});

	it("Codex 배포 형태(.agents/skills, project+home)에서 codex 하네스로 스캔하면 동일하게 발견한다", async () => {
		// Regression fixture for the original zero-skills bug: a Codex-shaped
		// deploy tree (only .agents/skills populated, no .claude/skills) must
		// still be found under the codex harness.
		const projectDir = join(tempDir, "project");
		await mkdir(join(projectDir, ".agents", "skills", "oracle"), { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		await mkdir(join(fakeHome, ".agents", "skills", "prometheus"), { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "codex");
		expect(skills).toEqual(["oracle", "prometheus"]);
	});

	it("codex 하네스는 .claude/skills 전용 스킬을 카탈로그에서 발견하지 못한다 (harness-gating RED fixture)", async () => {
		// Regression fixture for the confirmed defect: pre-fix, scanSkillDirectories
		// scanned all four roots unconditionally regardless of harness, so a
		// Claude-only skill (e.g. `hud`, platforms: [claude]) leaked into a Codex
		// session's catalog as an invokable `$hud` entry that fails on call.
		const projectDir = join(tempDir, "project");
		await mkdir(join(projectDir, ".claude", "skills", "hud"), { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "codex");
		expect(skills).not.toContain("hud");
		expect(skills).toEqual([]);
	});

	it("claude 하네스는 동일한 .claude/skills 전용 스킬을 여전히 발견한다 (symmetric arm, 무회귀)", async () => {
		// Symmetric arm for the harness-gating fixture above: guards against a
		// fix that closes the Codex leak by breaking Claude's own discovery.
		const projectDir = join(tempDir, "project");
		await mkdir(join(projectDir, ".claude", "skills", "hud"), { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "claude");
		expect(skills).toContain("hud");
	});

	it("Claude 전용 배포 형태(.claude/skills만 존재)는 .agents/skills 추가 후에도 동일하게 동작한다 (무회귀)", async () => {
		const projectDir = join(tempDir, "project");
		await mkdir(join(projectDir, ".claude", "skills", "oracle"), { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		await mkdir(join(fakeHome, ".claude", "skills", "prometheus"), { recursive: true });
		process.env.HOME = fakeHome;

		const skills = await scanSkillDirectories(projectDir, "claude");
		expect(skills).toEqual(["oracle", "prometheus"]);
	});

	it("returns identical arrays on repeated calls (stable output)", async () => {
		const projectDir = join(tempDir, "project");
		const skillsDir = join(projectDir, ".claude", "skills");
		// Create in non-alphabetical order to expose unsorted readdir
		await mkdir(join(skillsDir, "zeta"), { recursive: true });
		await mkdir(join(skillsDir, "alpha"), { recursive: true });
		await mkdir(join(skillsDir, "mu"), { recursive: true });

		const fakeHome = join(tempDir, "fakehome");
		await mkdir(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const first = await scanSkillDirectories(projectDir, "claude");
		const second = await scanSkillDirectories(projectDir, "claude");
		expect(first).toEqual(second);
	});
});

describe("readEnabledPlugins", () => {
	let tempDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "enabled-plugins-test-"));
		originalHome = process.env.HOME;
	});

	afterEach(async () => {
		process.env.HOME = originalHome;
		await rm(tempDir, { recursive: true, force: true });
	});

	it("settings.json 없을 때 빈 Set 반환", () => {
		const fakeHome = join(tempDir, "fakehome");
		mkdirSync(fakeHome, { recursive: true });
		process.env.HOME = fakeHome;

		const result = readEnabledPlugins("claude");
		expect(result.size).toBe(0);
	});

	it("enabledPlugins 키 없을 때 빈 Set 반환", () => {
		const fakeHome = join(tempDir, "fakehome");
		const claudeDir = join(fakeHome, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ otherKey: true }));
		process.env.HOME = fakeHome;

		const result = readEnabledPlugins("claude");
		expect(result.size).toBe(0);
	});

	it("정상 케이스: 활성화된 플러그인 ID Set 반환", () => {
		const fakeHome = join(tempDir, "fakehome");
		const claudeDir = join(fakeHome, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(
			join(claudeDir, "settings.json"),
			JSON.stringify({
				enabledPlugins: {
					"frontend-design@claude-plugins-official": true,
					"other-plugin@vendor": true,
				},
			}),
		);
		process.env.HOME = fakeHome;

		const result = readEnabledPlugins("claude");
		expect(result.size).toBe(2);
		expect(result.has("frontend-design@claude-plugins-official")).toBe(true);
		expect(result.has("other-plugin@vendor")).toBe(true);
	});

	it("비활성화(false) 플러그인은 제외", () => {
		const fakeHome = join(tempDir, "fakehome");
		const claudeDir = join(fakeHome, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(
			join(claudeDir, "settings.json"),
			JSON.stringify({
				enabledPlugins: {
					"frontend-design@claude-plugins-official": true,
					"disabled-plugin@vendor": false,
				},
			}),
		);
		process.env.HOME = fakeHome;

		const result = readEnabledPlugins("claude");
		expect(result.size).toBe(1);
		expect(result.has("frontend-design@claude-plugins-official")).toBe(true);
		expect(result.has("disabled-plugin@vendor")).toBe(false);
	});

	it("codex 하네스에서는 ~/.claude/settings.json에 enabledPlugins가 있어도 빈 Set 반환 — Codex는 플러그인 미지원(tools/adapters/codex.ts:862)", () => {
		// Regression fixture for the bug: the same machine may also run Claude
		// Code, leaving a real ~/.claude/settings.json with enabledPlugins on
		// disk. Under a Codex session that file must not leak plugin-gated
		// catalog entries the Codex deploy can never actually reach. `harness`
		// is now an explicit caller-supplied argument (index.ts's detectHarness()
		// resolves it once) rather than this function independently re-checking
		// CODEX_THREAD_ID — a second, independent check here could disagree with
		// detectHarness()'s OMT_SESSION_ID-aware priority (결함 2) whenever both
		// env vars were present.
		const fakeHome = join(tempDir, "fakehome");
		const claudeDir = join(fakeHome, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(
			join(claudeDir, "settings.json"),
			JSON.stringify({
				enabledPlugins: { "frontend-design@claude-plugins-official": true },
			}),
		);
		process.env.HOME = fakeHome;

		const result = readEnabledPlugins("codex");
		expect(result.size).toBe(0);
	});

	it("claude 하네스는 codex 가드 추가 후에도 동일하게 동작한다 (무회귀)", () => {
		const fakeHome = join(tempDir, "fakehome");
		const claudeDir = join(fakeHome, ".claude");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(
			join(claudeDir, "settings.json"),
			JSON.stringify({
				enabledPlugins: { "frontend-design@claude-plugins-official": true },
			}),
		);
		process.env.HOME = fakeHome;

		const result = readEnabledPlugins("claude");
		expect(result.size).toBe(1);
		expect(result.has("frontend-design@claude-plugins-official")).toBe(true);
	});
});
