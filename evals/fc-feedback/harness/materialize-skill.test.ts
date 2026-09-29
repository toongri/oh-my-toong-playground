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
		expect(parsed.model).toBe("gpt-6-sol");
		expect(parsed.model_reasoning_effort).toBe("high");
		expect(typeof parsed.developer_instructions).toBe("string");
		expect((parsed.developer_instructions as string).length).toBeGreaterThan(0);
	});
});
