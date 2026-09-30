import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

import { materializeAgent, materializeSkill } from "./materialize-skill.ts";

const REPO_ROOT = realpathSync(join(import.meta.dir, "..", "..", ".."));
const SKILL_SOURCE_DIR = join(REPO_ROOT, "projects", "fc-feedback", "skills", "fc-feedback");
const PRESENTATION_REVIEWER_SOURCE = join(REPO_ROOT, "agents", "presentation-reviewer.md");

const roots: string[] = [];
function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "fc-feedback-materialize-"));
	roots.push(root);
	return realpathSync(root);
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("materializeSkill", () => {
	test("copies scripts (minus tests/fixtures) and rewrites @lib/ aliases to a sibling lib/", async () => {
		const runDir = tempDir();

		const result = await materializeSkill({
			runDir,
			repoRoot: REPO_ROOT,
			skillSourceDir: SKILL_SOURCE_DIR,
			skillName: "fc-feedback",
		});

		expect(result.skillDir).toBe(join(runDir, ".agents", "skills", "fc-feedback"));

		const fcTs = await Bun.file(join(result.skillDir, "scripts", "fc.ts")).text();
		expect(fcTs).not.toContain("@lib/");
		expect(fcTs).toContain("../../../lib/omt-dir.ts");

		// test/fixture exclusion (DEFAULT_EXCLUDE in tools/lib/sync-directory.ts)
		expect(await Bun.file(join(result.skillDir, "scripts", "fc.test.ts")).exists()).toBe(false);
		expect(await Bun.file(join(result.skillDir, "scripts", "__fixtures__")).exists()).toBe(false);

		// transitive @lib/ closure resolved: state-core.ts's siblings, feature-map's
		// persistent-mode-core dependency, and the omt-dir.ts direct import.
		const libDir = join(runDir, ".agents", "lib");
		for (const rel of [
			"omt-dir.ts",
			"state-core.ts",
			"qa-chain-core.ts",
			"explain-diff-core.ts",
			join("feature-map", "manifest.ts"),
			join("persistent-mode-core", "state-lock.ts"),
		]) {
			expect(await Bun.file(join(libDir, rel)).exists()).toBe(true);
		}

		// bare npm import ("yaml", used by fc.ts/manifest.ts) is vendored, not left bare.
		expect(await Bun.file(join(libDir, "vendor", "yaml.js")).exists()).toBe(true);
	});

	test("materialized fc.ts runs `--help` and `config status` from the run-dir with an isolated manifest root", async () => {
		const runDir = tempDir();
		const manifestRoot = join(runDir, "fc-manifests");

		const { skillDir } = await materializeSkill({
			runDir,
			repoRoot: REPO_ROOT,
			skillSourceDir: SKILL_SOURCE_DIR,
			skillName: "fc-feedback",
		});
		const fcTs = join(skillDir, "scripts", "fc.ts");

		const help = Bun.spawnSync(["bun", fcTs, "--help"], {
			cwd: runDir,
			env: { ...process.env, FC_FEEDBACK_MANIFEST_ROOT: manifestRoot },
		});
		expect(help.exitCode).toBe(0);
		expect(JSON.parse(help.stdout.toString()).commands.length).toBeGreaterThan(0);

		const status = Bun.spawnSync(["bun", fcTs, "config", "status"], {
			cwd: runDir,
			env: { ...process.env, FC_FEEDBACK_MANIFEST_ROOT: manifestRoot },
		});
		expect(status.exitCode).toBe(0);
		const parsed = JSON.parse(status.stdout.toString());
		expect(parsed.status).toBe("unconfigured");
		// The manifest path must resolve under the isolated root, never under the
		// real $HOME/.fc-feedback.
		expect(parsed.manifestPath.startsWith(manifestRoot)).toBe(true);
	});
});

describe("materializeSkill (platform: claude)", () => {
	test("스킬을 .claude/skills/fc-feedback에 배치하고 @lib/ 별칭을 형제 .claude/lib/로 재작성한다", async () => {
		const runDir = tempDir();

		const result = await materializeSkill({
			runDir,
			repoRoot: REPO_ROOT,
			skillSourceDir: SKILL_SOURCE_DIR,
			skillName: "fc-feedback",
			platform: "claude",
		});

		expect(result.skillDir).toBe(join(runDir, ".claude", "skills", "fc-feedback"));

		const fcTs = await Bun.file(join(result.skillDir, "scripts", "fc.ts")).text();
		expect(fcTs).not.toContain("@lib/");
		expect(fcTs).toContain("../../../lib/omt-dir.ts");

		// test/fixture exclusion (DEFAULT_EXCLUDE in tools/lib/sync-directory.ts)
		expect(await Bun.file(join(result.skillDir, "scripts", "fc.test.ts")).exists()).toBe(false);

		// codex 배치("agents" 버킷)와 달리 claude는 자체 ".claude" 버킷에 lib를 둔다.
		const libDir = join(runDir, ".claude", "lib");
		for (const rel of ["omt-dir.ts", "state-core.ts", join("feature-map", "manifest.ts")]) {
			expect(await Bun.file(join(libDir, rel)).exists()).toBe(true);
		}
		expect(await Bun.file(join(libDir, "vendor", "yaml.js")).exists()).toBe(true);

		// codex 전용 .agents/ 트리는 생성되지 않는다.
		expect(await Bun.file(join(runDir, ".agents", "skills", "fc-feedback")).exists()).toBe(false);
	});

	test("materialized fc.ts는 claude 배치에서도 run-dir 기준으로 --help를 실행할 수 있다", async () => {
		const runDir = tempDir();
		const manifestRoot = join(runDir, "fc-manifests");

		const { skillDir } = await materializeSkill({
			runDir,
			repoRoot: REPO_ROOT,
			skillSourceDir: SKILL_SOURCE_DIR,
			skillName: "fc-feedback",
			platform: "claude",
		});
		const fcTs = join(skillDir, "scripts", "fc.ts");

		const help = Bun.spawnSync(["bun", fcTs, "--help"], {
			cwd: runDir,
			env: { ...process.env, FC_FEEDBACK_MANIFEST_ROOT: manifestRoot },
		});
		expect(help.exitCode).toBe(0);
		expect(JSON.parse(help.stdout.toString()).commands.length).toBeGreaterThan(0);
	});
});

describe("materializeAgent", () => {
	test("translates presentation-reviewer.md into <run-dir>/.codex/agents/presentation-reviewer.toml with the tier's model resolved", async () => {
		const runDir = tempDir();

		const result = await materializeAgent({
			runDir,
			repoRoot: REPO_ROOT,
			agentSourcePath: PRESENTATION_REVIEWER_SOURCE,
			agentName: "presentation-reviewer",
		});

		expect(result.agentFile).toBe(join(runDir, ".codex", "agents", "presentation-reviewer.toml"));

		const tomlText = await Bun.file(result.agentFile).text();
		const parsed = parseToml(tomlText) as Record<string, unknown>;

		expect(parsed.name).toBe("presentation-reviewer");
		// codex.yaml model-map.tiers.opus (agents/presentation-reviewer.md's frontmatter
		// `model: opus`), not a per-agent override — presentation-reviewer has none.
		expect(parsed.model).toBe("gpt-6.1-sol");
		expect(parsed.model_reasoning_effort).toBe("high");
		expect(typeof parsed.developer_instructions).toBe("string");
		expect((parsed.developer_instructions as string).length).toBeGreaterThan(0);
	});

	test("platform: claude일 때 presentation-reviewer.md를 <run-dir>/.claude/agents/presentation-reviewer.md에 그대로 복사한다", async () => {
		const runDir = tempDir();

		const result = await materializeAgent({
			runDir,
			repoRoot: REPO_ROOT,
			agentSourcePath: PRESENTATION_REVIEWER_SOURCE,
			agentName: "presentation-reviewer",
			platform: "claude",
		});

		expect(result.agentFile).toBe(join(runDir, ".claude", "agents", "presentation-reviewer.md"));

		// Claude agents are copied verbatim (no md->toml translation, no model-tier
		// resolution), so the deployed file matches the source byte-for-byte.
		const deployed = await Bun.file(result.agentFile).text();
		const source = await Bun.file(PRESENTATION_REVIEWER_SOURCE).text();
		expect(deployed).toBe(source);
	});
});
