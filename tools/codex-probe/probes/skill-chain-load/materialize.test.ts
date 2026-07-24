/**
 * Hermetic tests for materializeCodexSkills — no `codex` spawn, no `make
 * sync`. Uses synthetic source skills (not the repo's real skills/) so the
 * assertions are pinned to the exact tokens under test, not to whatever the
 * real skill bodies happen to say today.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { materializeCodexSkills } from "./materialize.ts";

describe("materializeCodexSkills", () => {
	let tmpDir: string;
	let repoRoot: string;
	let deployRoot: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "materialize-test-"));
		repoRoot = path.join(tmpDir, "repo");
		deployRoot = path.join(tmpDir, "deploy");
		await fs.mkdir(path.join(repoRoot, "skills", "alpha"), { recursive: true });
		await fs.mkdir(path.join(repoRoot, "skills", "beta"), { recursive: true });
		await fs.writeFile(
			path.join(repoRoot, "skills", "alpha", "SKILL.md"),
			'Dispatch: `Skill(skill: "beta")`. Read `${CLAUDE_SKILL_DIR}/scripts/x.ts` first.\n',
		);
		await fs.writeFile(path.join(repoRoot, "skills", "beta", "SKILL.md"), "beta body\n");
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("rewrites `Skill(skill: \"beta\")` to the codex mention sigil `$beta` via the real rewrite table", async () => {
		await materializeCodexSkills(repoRoot, deployRoot, ["alpha", "beta"]);
		const content = await fs.readFile(path.join(deployRoot, ".agents", "skills", "alpha", "SKILL.md"), "utf8");
		expect(content).toContain("$beta");
		expect(content).not.toContain("Skill(");
	});

	it("bakes ${CLAUDE_SKILL_DIR} to the deployed skill's own absolute path", async () => {
		await materializeCodexSkills(repoRoot, deployRoot, ["alpha", "beta"]);
		const skillDir = path.join(deployRoot, ".agents", "skills", "alpha");
		const content = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
		expect(content).toContain(path.join(skillDir, "scripts", "x.ts"));
		expect(content).not.toContain("${CLAUDE_SKILL_DIR}");
	});

	it("returns the deployed .agents/skills root", async () => {
		const result = await materializeCodexSkills(repoRoot, deployRoot, ["alpha", "beta"]);
		expect(result).toBe(path.join(deployRoot, ".agents", "skills"));
	});

	it("negative control: skipRewrite leaves the pre-6a prose form untouched (literal Skill(...), unbaked token)", async () => {
		await materializeCodexSkills(repoRoot, deployRoot, ["alpha", "beta"], {
			skipRewrite: new Set(["alpha"]),
		});
		const content = await fs.readFile(path.join(deployRoot, ".agents", "skills", "alpha", "SKILL.md"), "utf8");
		expect(content).toContain('Skill(skill: "beta")');
		expect(content).toContain("${CLAUDE_SKILL_DIR}");
		expect(content).not.toContain("$beta");
	});

	it("skipRewrite is per-skill: an un-skipped sibling still gets rewritten in the same call", async () => {
		await fs.writeFile(
			path.join(repoRoot, "skills", "beta", "SKILL.md"),
			'Dispatch: `Skill(skill: "alpha")`\n',
		);
		await materializeCodexSkills(repoRoot, deployRoot, ["alpha", "beta"], {
			skipRewrite: new Set(["alpha"]),
		});
		const betaContent = await fs.readFile(path.join(deployRoot, ".agents", "skills", "beta", "SKILL.md"), "utf8");
		expect(betaContent).toContain("$alpha");
	});
});
