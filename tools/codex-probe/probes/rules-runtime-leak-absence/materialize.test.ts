/**
 * Hermetic tests for materializeCodexRule — no `codex` spawn, no `make
 * sync`. Uses the real writeSyntheticRuleSource fixture so assertions are
 * pinned to this probe's own known literal set, not to whatever a real
 * rules/*.md file happens to say today.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { FORBIDDEN_LITERALS, RULE_NAME, RULE_SENTINEL, writeSyntheticRuleSource } from "./fixture.ts";
import { materializeCodexRule } from "./materialize.ts";

describe("materializeCodexRule", () => {
	let tmpDir: string;
	let sourceRoot: string;
	let deployRoot: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "materialize-rule-test-"));
		sourceRoot = path.join(tmpDir, "source");
		deployRoot = path.join(tmpDir, "deploy");
		await writeSyntheticRuleSource(sourceRoot);
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("copies the rule to <deployRoot>/.codex/rules/<name>.md and rewrites every forbidden literal by default", async () => {
		const deployedPath = await materializeCodexRule(sourceRoot, deployRoot, RULE_NAME);
		expect(deployedPath).toBe(path.join(deployRoot, ".codex", "rules", `${RULE_NAME}.md`));
		const content = await fs.readFile(deployedPath, "utf8");
		expect(content).toContain(RULE_SENTINEL);
		for (const literal of FORBIDDEN_LITERALS) {
			expect(content).not.toContain(literal);
		}
	});

	it("rewrites AskUserQuestion to request_user_input, TaskOutput/TaskCreate/subagent_type to their real codex targets", async () => {
		const deployedPath = await materializeCodexRule(sourceRoot, deployRoot, RULE_NAME);
		const content = await fs.readFile(deployedPath, "utf8");
		expect(content).toContain("request_user_input");
		expect(content).toContain("subagent transcript read");
		expect(content).toContain("update_plan");
		expect(content).toContain("agent_type");
	});

	it("negative control: skipRewrite leaves every forbidden literal untouched (pre-rewrite Claude vocabulary)", async () => {
		const deployedPath = await materializeCodexRule(sourceRoot, deployRoot, RULE_NAME, { skipRewrite: true });
		const content = await fs.readFile(deployedPath, "utf8");
		expect(content).toContain(RULE_SENTINEL);
		for (const literal of FORBIDDEN_LITERALS) {
			expect(content).toContain(literal);
		}
	});

	it("writes a package.json project marker at deployRoot", async () => {
		await materializeCodexRule(sourceRoot, deployRoot, RULE_NAME);
		const marker = await fs.readFile(path.join(deployRoot, "package.json"), "utf8");
		expect(() => JSON.parse(marker)).not.toThrow();
	});
});
