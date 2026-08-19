import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { parse } from "smol-toml";
import {
	CodexAdapter,
	insertManagedBlock,
	buildMcpTomlContent,
	resolveCodexAgentModel,
	cleanupCodexSkillsFossil,
	codexSkillsDir,
} from "./codex.ts";
import { planCategoryDestinationPaths } from "./destinations.ts";
import type { ModelMap } from "../lib/types.ts";
import type { DeployMutationHooks } from "../lib/deploy-transaction.ts";

function plannedCodexPath(targetPath: string, category: "hooks" | "scripts", displayName: string): string {
	return path.join(targetPath, planCategoryDestinationPaths("codex", category, displayName)[0]);
}

// =============================================================================
// insertManagedBlock
// =============================================================================

describe("insertManagedBlock", () => {
	it("creates a block in empty content via `insertManagedBlock`", () => {
		const result = insertManagedBlock("", "config", 'key = "value"\n');
		expect(result).toBe(`# --- omt:config ---\nkey = "value"\n# --- end omt:config ---\n`);
	});

	it("replaces existing block content via `insertManagedBlock`", () => {
		const existing = `# --- omt:config ---\nold = "data"\n# --- end omt:config ---\n`;
		const result = insertManagedBlock(existing, "config", `new = "data"\n`);
		expect(result).toBe(`# --- omt:config ---\nnew = "data"\n# --- end omt:config ---\n`);
	});

	it("preserves user content outside managed block via `insertManagedBlock`", () => {
		const existing = `# user config\nsome_setting = true\n\n# --- omt:config ---\nold = "data"\n# --- end omt:config ---\n\n# trailing comment\n`;
		const result = insertManagedBlock(existing, "config", `new = "data"\n`);
		expect(result).toContain("some_setting = true");
		expect(result).toContain("# trailing comment");
		expect(result).toContain(`new = "data"`);
		expect(result).not.toContain(`old = "data"`);
	});

	it("preserves managed blocks with different names via `insertManagedBlock`", () => {
		const existing = `# --- omt:mcp ---\nmcp_data = true\n# --- end omt:mcp ---\n`;
		const result = insertManagedBlock(existing, "config", `config_data = true\n`);
		// mcp block preserved
		expect(result).toContain("# --- omt:mcp ---");
		expect(result).toContain("mcp_data = true");
		// new config block appended
		expect(result).toContain("# --- omt:config ---");
		expect(result).toContain("config_data = true");
	});

	it("creates block with markers when content is empty via `insertManagedBlock`", () => {
		const result = insertManagedBlock("", "mcp", `server = "test"\n`);
		expect(result).toContain("# --- omt:mcp ---");
		expect(result).toContain("# --- end omt:mcp ---");
		expect(result).toContain(`server = "test"`);
	});
});

// =============================================================================
// buildMcpTomlContent
// =============================================================================

describe("buildMcpTomlContent", () => {
	it("builds a single TOML block from 3 servers via `buildMcpTomlContent`", () => {
		const servers = {
			"server-a": { command: "npx", args: ["-y", "a"] },
			"server-b": { command: "node", args: ["b.js"] },
			"server-c": { command: "python", args: ["c.py"] },
		};
		const toml = buildMcpTomlContent(servers);
		expect(toml).toContain("server-a");
		expect(toml).toContain("server-b");
		expect(toml).toContain("server-c");
		expect(toml).toContain("mcp_servers");
	});

	it("returns empty TOML for empty server list via `buildMcpTomlContent`", () => {
		const toml = buildMcpTomlContent({});
		// smol-toml stringify on { mcp_servers: {} } should produce minimal output
		expect(typeof toml).toBe("string");
	});
});

// =============================================================================
// CodexAdapter — filesystem integration tests
// =============================================================================

describe("CodexAdapter", () => {
	let tmpDir: string;
	let adapter: CodexAdapter;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-adapter-test-"));
		adapter = new CodexAdapter();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("preserves relative target semantics for the planner-backed skills root", () => {
		expect(codexSkillsDir("relative-target")).toBe(path.join("relative-target", ".agents", "skills"));
	});

	// ---------------------------------------------------------------------------
	// syncAgentsDirect — md → toml translator
	// ---------------------------------------------------------------------------

	describe("syncAgentsDirect", () => {
		it("generated TOML is guarded by mutation hooks before writing", async () => {
			const sourceFile = path.join(tmpDir, "guarded-agent.md");
			await fs.writeFile(sourceFile, "---\nname: guarded-agent\ndescription: guarded\n---\n\nInstructions\n");
			const targetBase = path.join(tmpDir, "guarded-agent-target");
			const targetFile = path.join(targetBase, ".codex", "agents", "guarded-agent.toml");
			await fs.mkdir(path.dirname(targetFile), { recursive: true });
			await fs.writeFile(targetFile, "external-agent\n");
			const calls: string[] = [];
			const state = { operationCalled: false };
			const mutationHooks: DeployMutationHooks = {
				mutate: async (targetPath, operation) => {
					calls.push(targetPath);
					void operation;
					throw new Error("Deploy transaction conflict");
				},
			};
			await expect(
				adapter.syncAgentsDirect(targetBase, "guarded-agent", sourceFile, [], [], false, undefined, mutationHooks),
			).rejects.toThrow("Deploy transaction conflict");
			expect(calls).toEqual([targetFile]);
			expect(state.operationCalled).toBe(false);
			expect(await fs.readFile(targetFile, "utf-8")).toBe("external-agent\n");
		});
		it("skips with warning and creates no files via `syncAgentsDirect`", async () => {
			// Should not throw, should not create any files
			await adapter.syncAgentsDirect(tmpDir, "oracle", "/nonexistent/oracle.md");
			const codexDir = path.join(tmpDir, ".codex");
			const exists = await fs
				.stat(codexDir)
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("skips in dry-run mode via `syncAgentsDirect`", async () => {
			await adapter.syncAgentsDirect(tmpDir, "oracle", "/nonexistent/oracle.md", [], [], true);
			const exists = await fs
				.stat(path.join(tmpDir, ".codex"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("emits exactly the allowlist keys and parses with smol-toml via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "oracle.md");
			await fs.writeFile(
				sourceFile,
				[
					"---",
					"name: oracle",
					"description: Use when delegating architecture analysis or debugging diagnosis",
					"model: opus",
					"---",
					"",
					"You are the Oracle agent. Follow the diagnose skill exactly.",
					"",
				].join("\n"),
			);
			const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(targetBase, "oracle", sourceFile, [], [], false, modelMap);

			const targetFile = path.join(targetBase, ".codex", "agents", "oracle.toml");
			const content = await fs.readFile(targetFile, "utf-8");
			const parsed = parse(content) as Record<string, unknown>;

			expect(Object.keys(parsed).sort()).toEqual(
				["description", "developer_instructions", "model", "model_reasoning_effort", "name"].sort(),
			);
			expect(parsed.name).toBe("oracle");
			expect(parsed.description).toBe(
				"Use when delegating architecture analysis or debugging diagnosis",
			);
			expect(parsed.developer_instructions).toBe(
				"You are the Oracle agent. Follow the diagnose skill exactly.",
			);
			expect(parsed.model).toBe("gpt-5.6-sol");
			expect(parsed.model_reasoning_effort).toBe("high");
		});

		it("drops Claude-only frontmatter keys (add-skills/subagent_type/tools/skills) via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "sisyphus-junior.md");
			await fs.writeFile(
				sourceFile,
				[
					"---",
					"name: sisyphus-junior",
					"description: Focused executor for multi-step implementation tasks",
					"model: sonnet",
					"add-skills:",
					"  - testing",
					"subagent_type: general-purpose",
					"tools: Bash, Read",
					"skills: diagnose",
					"---",
					"",
					"Execute tasks directly.",
					"",
				].join("\n"),
			);
			const modelMap: ModelMap = { tiers: { sonnet: { model: "gpt-5.6-sol", effort: "medium" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(
				targetBase,
				"sisyphus-junior",
				sourceFile,
				[],
				[],
				false,
				modelMap,
			);

			const targetFile = path.join(targetBase, ".codex", "agents", "sisyphus-junior.toml");
			const content = await fs.readFile(targetFile, "utf-8");
			const parsed = parse(content) as Record<string, unknown>;

			expect(Object.keys(parsed).sort()).toEqual(
				["description", "developer_instructions", "model", "model_reasoning_effort", "name"].sort(),
			);
			expect(parsed).not.toHaveProperty("add-skills");
			expect(parsed).not.toHaveProperty("subagent_type");
			expect(parsed).not.toHaveProperty("tools");
			expect(parsed).not.toHaveProperty("skills");
		});

		it("injects the leaf guard into developer_instructions when frontmatter denies the Agent tool via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "explore.md");
			await fs.writeFile(
				sourceFile,
				[
					"---",
					"name: explore",
					"description: Fast codebase search",
					"model: sonnet",
					"disallowedTools: Agent",
					"---",
					"",
					"You are Explorer. Find files and patterns.",
					"",
				].join("\n"),
			);
			const modelMap: ModelMap = { tiers: { sonnet: { model: "gpt-5.6-sol", effort: "medium" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(targetBase, "explore", sourceFile, [], [], false, modelMap);

			const targetFile = path.join(targetBase, ".codex", "agents", "explore.toml");
			const parsed = parse(await fs.readFile(targetFile, "utf-8")) as Record<string, unknown>;

			// The emit-allowlist is unchanged — the guard rides inside developer_instructions, not a new key.
			expect(Object.keys(parsed).sort()).toEqual(
				["description", "developer_instructions", "model", "model_reasoning_effort", "name"].sort(),
			);
			expect(parsed.developer_instructions).toContain("<native_subagent_leaf_guard>");
			expect(parsed.developer_instructions).toContain(
				"do not call Task, Agent, spawn_agent, or native child agents",
			);
			// The original body survives ahead of the appended guard.
			expect(parsed.developer_instructions).toContain("You are Explorer. Find files and patterns.");
		});

		it("injects the leaf guard when a tools allowlist omits the Agent tool via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "metis.md");
			await fs.writeFile(
				sourceFile,
				[
					"---",
					"name: metis",
					"description: Plan reviewer",
					"model: opus",
					"tools: Read, Glob, Grep, Bash",
					"---",
					"",
					"You are Metis.",
					"",
				].join("\n"),
			);
			const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(targetBase, "metis", sourceFile, [], [], false, modelMap);

			const targetFile = path.join(targetBase, ".codex", "agents", "metis.toml");
			const parsed = parse(await fs.readFile(targetFile, "utf-8")) as Record<string, unknown>;
			expect(parsed.developer_instructions).toContain("<native_subagent_leaf_guard>");
		});

		it("reflects the source frontmatter `tools` allowlist in the leaf guard text via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "chunk-reviewer.md");
			await fs.writeFile(
				sourceFile,
				[
					"---",
					"name: chunk-reviewer",
					"description: Chunk reviewer",
					"model: sonnet",
					"tools: Bash, Read",
					"---",
					"",
					"You are the chunk-reviewer agent.",
					"",
				].join("\n"),
			);
			const modelMap: ModelMap = { tiers: { sonnet: { model: "gpt-5.6-sol", effort: "medium" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(
				targetBase,
				"chunk-reviewer",
				sourceFile,
				[],
				[],
				false,
				modelMap,
			);

			const targetFile = path.join(targetBase, ".codex", "agents", "chunk-reviewer.toml");
			const parsed = parse(await fs.readFile(targetFile, "utf-8")) as Record<string, unknown>;

			// The guard names the actual tools list from frontmatter (Bash, Read) —
			// not a generic static string that ignores it.
			expect(parsed.developer_instructions).toContain("Bash");
			expect(parsed.developer_instructions).toContain("Read");
			// AC5: the restriction must read as a soft prompt-level guard, not a
			// hard runtime guarantee — Codex has no per-agent tool-withholding field.
			expect(parsed.developer_instructions).toMatch(/soft/i);
		});

		it("does NOT claim a tool restriction when frontmatter has no `tools` allowlist (disallowedTools-only leaf) via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "explore-no-tools.md");
			await fs.writeFile(
				sourceFile,
				[
					"---",
					"name: explore-no-tools",
					"description: Fast codebase search",
					"model: sonnet",
					"disallowedTools: Agent",
					"---",
					"",
					"You are Explorer.",
					"",
				].join("\n"),
			);
			const modelMap: ModelMap = { tiers: { sonnet: { model: "gpt-5.6-sol", effort: "medium" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(
				targetBase,
				"explore-no-tools",
				sourceFile,
				[],
				[],
				false,
				modelMap,
			);

			const targetFile = path.join(targetBase, ".codex", "agents", "explore-no-tools.toml");
			const parsed = parse(await fs.readFile(targetFile, "utf-8")) as Record<string, unknown>;

			// Negative control: no `tools:` allowlist in source frontmatter means no
			// tool-restriction claim should appear — the guard must not fabricate one.
			expect(parsed.developer_instructions).not.toContain("Tool restriction");
		});

		it("omits the leaf guard for a delegation-allowed agent with no spawn restriction via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "code-reviewer.md");
			await fs.writeFile(
				sourceFile,
				[
					"---",
					"name: code-reviewer",
					"description: Review orchestrator",
					"model: opus",
					"---",
					"",
					"You are the code-reviewer. Fan out chunk-reviewer and verifiers.",
					"",
				].join("\n"),
			);
			const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(targetBase, "code-reviewer", sourceFile, [], [], false, modelMap);

			const targetFile = path.join(targetBase, ".codex", "agents", "code-reviewer.toml");
			const parsed = parse(await fs.readFile(targetFile, "utf-8")) as Record<string, unknown>;
			expect(parsed.developer_instructions).not.toContain("native_subagent_leaf_guard");
			expect(parsed.developer_instructions).toBe(
				"You are the code-reviewer. Fan out chunk-reviewer and verifiers.",
			);
		});

		it("rewrites Claude vocabulary in description/developer_instructions via PLATFORM_REWRITE_RULES.codex before TOML serialization (TODO 4) — name/model/model_reasoning_effort untouched", async () => {
			// Real carrier shape: agent bodies invoke skills and reference
			// subagent_type in prose (e.g. agents/sisyphus-junior.md:102-103).
			// These TOML files are generated (not walked as .md by
			// rewritePlatformPaths), so the rewrite happens here, at generation
			// time, instead.
			const sourceFile = path.join(tmpDir, "sisyphus-junior.md");
			await fs.writeFile(
				sourceFile,
				[
					"---",
					"name: sisyphus-junior",
					"description: Focused executor for multi-step implementation tasks",
					"model: sonnet",
					"---",
					"",
					'Invoke Skill(skill: "prometheus") first. Never spawn via subagent_type directly.',
					"",
				].join("\n"),
			);
			const modelMap: ModelMap = { tiers: { sonnet: { model: "gpt-5.6-sol", effort: "medium" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(
				targetBase,
				"sisyphus-junior",
				sourceFile,
				[],
				[],
				false,
				modelMap,
			);

			const targetFile = path.join(targetBase, ".codex", "agents", "sisyphus-junior.toml");
			const content = await fs.readFile(targetFile, "utf-8");

			// Rewritten to Codex vocabulary.
			expect(content).toContain("$prometheus");
			expect(content).toContain("agent_type");

			// grep -c 'Skill(' on the emitted file is 0.
			expect((content.match(/Skill\(/g) ?? []).length).toBe(0);

			// Still valid TOML, and the untouched fields are exactly untouched.
			const parsed = parse(content) as Record<string, unknown>;
			expect(parsed.name).toBe("sisyphus-junior");
			expect(parsed.model).toBe("gpt-5.6-sol");
			expect(parsed.model_reasoning_effort).toBe("medium");
			expect(parsed.developer_instructions).toContain("$prometheus");
			expect(parsed.developer_instructions).toContain("agent_type");
		});

		it("resolves an opus-tier agent to gpt-5.6-sol + high effort via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "oracle.md");
			await fs.writeFile(
				sourceFile,
				"---\nname: oracle\ndescription: Diagnose things\nmodel: opus\n---\n\nBody text.\n",
			);
			const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } } };
			const targetBase = path.join(tmpDir, "target");

			await adapter.syncAgentsDirect(targetBase, "oracle", sourceFile, [], [], false, modelMap);

			const content = await fs.readFile(
				path.join(targetBase, ".codex", "agents", "oracle.toml"),
				"utf-8",
			);
			const parsed = parse(content) as Record<string, unknown>;
			expect(parsed.model).toBe("gpt-5.6-sol");
			expect(parsed.model_reasoning_effort).toBe("high");
		});

		it("throws naming sourcePath when frontmatter description is blank via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "blank-description.md");
			await fs.writeFile(
				sourceFile,
				'---\nname: blank-description\ndescription: ""\nmodel: opus\n---\n\nBody text.\n',
			);
			const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } } };
			const targetBase = path.join(tmpDir, "target");

			await expect(
				adapter.syncAgentsDirect(
					targetBase,
					"blank-description",
					sourceFile,
					[],
					[],
					false,
					modelMap,
				),
			).rejects.toThrow(sourceFile);
		});

		it("throws naming sourcePath when the body is blank via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "blank-body.md");
			await fs.writeFile(
				sourceFile,
				"---\nname: blank-body\ndescription: Has a description\nmodel: opus\n---\n\n   \n",
			);
			const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } } };
			const targetBase = path.join(tmpDir, "target");

			await expect(
				adapter.syncAgentsDirect(targetBase, "blank-body", sourceFile, [], [], false, modelMap),
			).rejects.toThrow(sourceFile);
		});

		it("throws naming sourcePath and tier when a tier is declared but no model-map is reachable via `syncAgentsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "no-map.md");
			await fs.writeFile(
				sourceFile,
				"---\nname: no-map\ndescription: Has a description\nmodel: opus\n---\n\nBody text.\n",
			);
			const targetBase = path.join(tmpDir, "target");

			await expect(
				adapter.syncAgentsDirect(targetBase, "no-map", sourceFile, [], [], false, undefined),
			).rejects.toThrow(/opus/);
		});
	});

	// ---------------------------------------------------------------------------
	// syncRulesDirect — copies rule .md into .codex/rules/ (rules is now a
	// supported codex category; the rewrite pass then de-Claude-ifies these
	// bytes via rewritePlatformPaths, mirroring how syncSkillsDirect/
	// syncScriptsDirect land plain copies for their own later rewrite).
	// ---------------------------------------------------------------------------

	describe("syncRulesDirect", () => {
		it("rule copy is guarded by mutation hooks before writing", async () => {
			const sourceFile = path.join(tmpDir, "guarded-rule.md");
			await fs.writeFile(sourceFile, "# guarded\n");
			const targetBase = path.join(tmpDir, "guarded-rule-target");
			const targetFile = path.join(targetBase, ".codex", "rules", "guarded-rule.md");
			await fs.mkdir(path.dirname(targetFile), { recursive: true });
			await fs.writeFile(targetFile, "external-rule\n");
			const state = { operationCalled: false };
			let observerCalled = false;
			const mutationHooks: DeployMutationHooks = {
				mutate: async (_targetPath, operation) => {
					void operation;
					throw new Error("Deploy transaction conflict");
				},
			};
			await expect(
				adapter.syncRulesDirect(targetBase, "guarded-rule", sourceFile, false, () => {
					observerCalled = true;
				}, mutationHooks),
			).rejects.toThrow("Deploy transaction conflict");
			expect(state.operationCalled).toBe(false);
			expect(observerCalled).toBe(false);
			expect(await fs.readFile(targetFile, "utf-8")).toBe("external-rule\n");
		});
		it("copies a rule file to .codex/rules/<name>.md via `syncRulesDirect`", async () => {
			const sourceFile = path.join(tmpDir, "communication-style.md");
			await fs.writeFile(sourceFile, "# Communication Style\n\nSee .claude/rules/ for more.\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncRulesDirect(targetBase, "communication-style", sourceFile, false);

			const targetFile = path.join(targetBase, ".codex", "rules", "communication-style.md");
			const content = await fs.readFile(targetFile, "utf-8");
			expect(content).toBe("# Communication Style\n\nSee .claude/rules/ for more.\n");
		});

		it("skips copy in dry-run mode via `syncRulesDirect`", async () => {
			const sourceFile = path.join(tmpDir, "communication-style.md");
			await fs.writeFile(sourceFile, "# Communication Style\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncRulesDirect(targetBase, "communication-style", sourceFile, true);

			const exists = await fs
				.stat(path.join(targetBase, ".codex", "rules", "communication-style.md"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("logs warning for missing source and creates no files via `syncRulesDirect`", async () => {
			await adapter.syncRulesDirect(tmpDir, "my-rule", "/nonexistent/rule.md");
			const exists = await fs
				.stat(path.join(tmpDir, ".codex"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// syncConfig — TOML managed block
	// ---------------------------------------------------------------------------

	describe("syncConfig", () => {
		it("writes config as TOML managed block in config.toml via `syncConfig`", async () => {
			await adapter.syncConfig(tmpDir, { model: "o4-mini", temperature: 0.7 }, false);
			const configFile = path.join(tmpDir, ".codex", "config.toml");
			const content = await fs.readFile(configFile, "utf-8");
			expect(content).toContain("# --- omt:config ---");
			expect(content).toContain("# --- end omt:config ---");
			expect(content).toContain("model");
			expect(content).toContain("o4-mini");
		});

		it("replaces managed block on re-call while preserving existing content via `syncConfig`", async () => {
			// Write initial user content
			const configFile = path.join(tmpDir, ".codex", "config.toml");
			await fs.mkdir(path.join(tmpDir, ".codex"), { recursive: true });
			await fs.writeFile(configFile, `# user config\nsome_setting = true\n`, "utf-8");

			await adapter.syncConfig(tmpDir, { model: "o4-mini" }, false);
			const content = await fs.readFile(configFile, "utf-8");

			expect(content).toContain("some_setting = true");
			expect(content).toContain("# --- omt:config ---");
			expect(content).toContain("o4-mini");
		});

		it("skips config.toml creation in dry-run mode via `syncConfig`", async () => {
			await adapter.syncConfig(tmpDir, { model: "o4-mini" }, true);
			const exists = await fs
				.stat(path.join(tmpDir, ".codex", "config.toml"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("serializes a nested map as a dotted TOML table header via `syncConfig`", async () => {
			await adapter.syncConfig(
				tmpDir,
				{ features: { multi_agent_v2: { max_concurrent_threads_per_session: 20 } } },
				false,
			);
			const configFile = path.join(tmpDir, ".codex", "config.toml");
			const content = await fs.readFile(configFile, "utf-8");
			expect(content).toContain("[features.multi_agent_v2]");
			expect(content).toContain("max_concurrent_threads_per_session = 20");
		});
	});

	// ---------------------------------------------------------------------------
	// MCP accumulator: 3 servers → single managed block
	// ---------------------------------------------------------------------------

	describe("MCP accumulator", () => {
		it("accumulates 3 servers into a single omt:mcp managed block via `flushMcpBlock`", async () => {
			adapter.resetMcpAccumulator();
			adapter.accumulateMcp("server-a", { command: "npx", args: ["-y", "a"] });
			adapter.accumulateMcp("server-b", { command: "node", args: ["b.js"] });
			adapter.accumulateMcp("server-c", { command: "python", args: ["c.py"] });
			await adapter.flushMcpBlock(tmpDir, false);

			const configFile = path.join(tmpDir, ".codex", "config.toml");
			const content = await fs.readFile(configFile, "utf-8");

			expect(content).toContain("# --- omt:mcp ---");
			expect(content).toContain("# --- end omt:mcp ---");
			// All 3 servers appear in single block
			const startIdx = content.indexOf("# --- omt:mcp ---");
			const endIdx = content.indexOf("# --- end omt:mcp ---");
			expect(startIdx).toBeGreaterThanOrEqual(0);
			expect(endIdx).toBeGreaterThan(startIdx);
			const blockContent = content.slice(startIdx, endIdx);
			expect(blockContent).toContain("server-a");
			expect(blockContent).toContain("server-b");
			expect(blockContent).toContain("server-c");
		});

		it("replaces existing omt:mcp block and preserves content outside it via `flushMcpBlock`", async () => {
			const configFile = path.join(tmpDir, ".codex", "config.toml");
			await fs.mkdir(path.join(tmpDir, ".codex"), { recursive: true });
			await fs.writeFile(
				configFile,
				`model = "o4-mini"\n\n# --- omt:mcp ---\nold_server = {}\n# --- end omt:mcp ---\n`,
				"utf-8",
			);

			adapter.resetMcpAccumulator();
			adapter.accumulateMcp("new-server", { command: "npx" });
			await adapter.flushMcpBlock(tmpDir, false);

			const content = await fs.readFile(configFile, "utf-8");
			expect(content).toContain(`model = "o4-mini"`);
			expect(content).not.toContain("old_server");
			expect(content).toContain("new-server");
		});

		it("does not create config.toml when accumulator is empty via `flushMcpBlock`", async () => {
			adapter.resetMcpAccumulator();
			// flushMcpBlock with 0 servers should not create file
			await adapter.flushMcpBlock(tmpDir, false);
			const exists = await fs
				.stat(path.join(tmpDir, ".codex", "config.toml"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("replaces existing omt:mcp block with empty block when accumulator is empty via `flushMcpBlock`", async () => {
			const configFile = path.join(tmpDir, ".codex", "config.toml");
			await fs.mkdir(path.join(tmpDir, ".codex"), { recursive: true });
			await fs.writeFile(
				configFile,
				`model = "o4-mini"\n\n# --- omt:mcp ---\n[mcp_servers.old-server]\ncommand = "npx"\n# --- end omt:mcp ---\n`,
				"utf-8",
			);

			adapter.resetMcpAccumulator();
			await adapter.flushMcpBlock(tmpDir, false);

			const content = await fs.readFile(configFile, "utf-8");
			// Markers must still be present
			expect(content).toContain("# --- omt:mcp ---");
			expect(content).toContain("# --- end omt:mcp ---");
			// Old server must be removed
			expect(content).not.toContain("old-server");
			// Empty comment inside block
			expect(content).toContain("# No MCP servers configured");
			// User content outside block preserved
			expect(content).toContain(`model = "o4-mini"`);
		});
	});

	// ---------------------------------------------------------------------------
	// syncPlatformYaml
	// ---------------------------------------------------------------------------

	describe("syncPlatformYaml", () => {
		it("returns model-map in result via `syncPlatformYaml`", async () => {
			const yaml = {
				"model-map": {
					tiers: {
						sonnet: { model: "o4-mini" },
						haiku: { model: "o3-mini" },
					},
				},
			};
			const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
			expect(result.processedSections).toContain("model-map");
			expect(result.modelMap).toEqual({
				tiers: {
					sonnet: { model: "o4-mini" },
					haiku: { model: "o3-mini" },
				},
			});
		});

		it("includes 'config' in processedSections after processing via `syncPlatformYaml`", async () => {
			const yaml = { config: { model: "o4-mini" } };
			const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
			expect(result.processedSections).toContain("config");
		});

		it("includes 'mcps' in processedSections and creates managed block via `syncPlatformYaml`", async () => {
			const yaml = {
				mcps: {
					"my-server": { command: "npx", args: ["-y", "my-server"] },
					"other-server": { command: "node", args: ["server.js"] },
				},
			};
			const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
			expect(result.processedSections).toContain("mcps");

			const configFile = path.join(tmpDir, ".codex", "config.toml");
			const content = await fs.readFile(configFile, "utf-8");
			expect(content).toContain("# --- omt:mcp ---");
			expect(content).toContain("my-server");
			expect(content).toContain("other-server");
		});

		it("skips a server whose overlay value is null via `syncPlatformYaml`", async () => {
			const yaml = {
				mcps: {
					"keep-server": { command: "npx", args: ["-y", "keep"] },
					"drop-server": null,
				},
			};
			const result = await adapter.syncPlatformYaml(
				tmpDir,
				yaml as unknown as Parameters<typeof adapter.syncPlatformYaml>[1],
				false,
			);
			expect(result.processedSections).toContain("mcps");

			const configFile = path.join(tmpDir, ".codex", "config.toml");
			const content = await fs.readFile(configFile, "utf-8");
			expect(content).toContain("keep-server");
			expect(content).not.toContain("drop-server");
		});

		it("processes config, mcps, and model-map sections together via `syncPlatformYaml`", async () => {
			const yaml = {
				config: { model: "o4-mini" },
				mcps: { srv: { command: "npx" } },
				"model-map": { tiers: { sonnet: { model: "o4-mini" } } },
			};
			const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
			expect(result.processedSections).toContain("config");
			expect(result.processedSections).toContain("mcps");
			expect(result.processedSections).toContain("model-map");
			expect(result.modelMap).toBeDefined();
		});

		it("skips config.toml creation in dry-run mode via `syncPlatformYaml`", async () => {
			const yaml = {
				config: { model: "o4-mini" },
				mcps: { srv: { command: "npx" } },
			};
			await adapter.syncPlatformYaml(tmpDir, yaml, true);
			const exists = await fs
				.stat(path.join(tmpDir, ".codex", "config.toml"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("accumulates MCP servers in dry-run mode so preview is correct via `syncPlatformYaml`", async () => {
			// Create existing config.toml so flushMcpBlock can log a meaningful dry-run preview
			const configDir = path.join(tmpDir, ".codex");
			await fs.mkdir(configDir, { recursive: true });
			const configFile = path.join(configDir, "config.toml");
			await fs.writeFile(configFile, `model = "o4-mini"\n`, "utf-8");

			const yaml = {
				mcps: {
					"server-alpha": { command: "npx", args: ["-y", "alpha"] },
					"server-beta": { command: "node", args: ["beta.js"] },
				},
			};

			await adapter.syncPlatformYaml(tmpDir, yaml, true);

			// Accumulator must be populated — flushMcpBlock dry-run path uses it to build preview
			// Verify by calling flushMcpBlock in non-dry-run mode and confirming servers are written
			await adapter.flushMcpBlock(tmpDir, false);
			const content = await fs.readFile(configFile, "utf-8");
			expect(content).toContain("server-alpha");
			expect(content).toContain("server-beta");
			expect(content).toContain("# --- omt:mcp ---");
		});

		it("returns undefined for modelMap when model-map is absent via `syncPlatformYaml`", async () => {
			const yaml = { config: { model: "o4-mini" } };
			const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
			expect(result.modelMap).toBeUndefined();
		});

		it("removes existing managed block and includes 'mcps' in processedSections when mcps: {} via `syncPlatformYaml`", async () => {
			// Setup: write a config.toml with an existing omt:mcp managed block
			const configDir = path.join(tmpDir, ".codex");
			await fs.mkdir(configDir, { recursive: true });
			const configFile = path.join(configDir, "config.toml");
			const existingContent =
				[
					`# --- omt:mcp ---`,
					`[mcp.servers.old-server]`,
					`command = "old-cmd"`,
					`# --- end omt:mcp ---`,
				].join("\n") + "\n";
			await fs.writeFile(configFile, existingContent, "utf-8");

			const result = await adapter.syncPlatformYaml(tmpDir, { mcps: {} }, false);

			expect(result.processedSections).toContain("mcps");
			const content = await fs.readFile(configFile, "utf-8");
			expect(content).not.toContain("old-server");
		});
	});

	// ---------------------------------------------------------------------------
	// syncSkillsDirect
	// ---------------------------------------------------------------------------

	describe("syncSkillsDirect", () => {
		it("forwards mutation hooks to each skill directory leaf", async () => {
			const sourceSkill = path.join(tmpDir, "guarded-skill");
			await fs.mkdir(sourceSkill, { recursive: true });
			await fs.writeFile(path.join(sourceSkill, "SKILL.md"), "# skill\n");
			const targetBase = path.join(tmpDir, "guarded-skill-target");
			const targetFile = path.join(targetBase, ".agents", "skills", "guarded-skill", "SKILL.md");
			const calls: string[] = [];
			const mutationHooks: DeployMutationHooks = {
				mutate: async (targetPath, operation) => {
					calls.push(targetPath);
					await operation();
				},
			};
			await adapter.syncSkillsDirect(targetBase, "guarded-skill", sourceSkill, false, mutationHooks);
			expect(calls).toContain(targetFile);
		});

		it("dry-run does not invoke skill mutation hooks", async () => {
			const sourceSkill = path.join(tmpDir, "dry-skill");
			await fs.mkdir(sourceSkill, { recursive: true });
			await fs.writeFile(path.join(sourceSkill, "SKILL.md"), "# skill\n");
			let mutateCount = 0;
			const mutationHooks: DeployMutationHooks = {
				mutate: async (_targetPath, operation) => {
					mutateCount += 1;
					await operation();
				},
			};
			await adapter.syncSkillsDirect(tmpDir, "dry-skill", sourceSkill, true, mutationHooks);
			expect(mutateCount).toBe(0);
		});

		it("skill pre-CAS conflict preserves the resident file", async () => {
			const sourceSkill = path.join(tmpDir, "resident-skill");
			await fs.mkdir(sourceSkill, { recursive: true });
			await fs.writeFile(path.join(sourceSkill, "SKILL.md"), "new\n");
			const targetBase = path.join(tmpDir, "resident-skill-target");
			const targetFile = path.join(targetBase, ".agents", "skills", "resident-skill", "SKILL.md");
			await fs.mkdir(path.dirname(targetFile), { recursive: true });
			await fs.writeFile(targetFile, "external\n");
			const mutationHooks: DeployMutationHooks = {
				mutate: async () => {
					throw new Error("Deploy transaction conflict");
				},
			};
			await expect(adapter.syncSkillsDirect(targetBase, "resident-skill", sourceSkill, false, mutationHooks)).rejects.toThrow(
				"Deploy transaction conflict",
			);
			expect(await fs.readFile(targetFile, "utf-8")).toBe("external\n");
		});
		it("copies skill directory to <target>/.agents/skills via `syncSkillsDirect`", async () => {
			// Create a source skill directory
			const sourceSkill = path.join(tmpDir, "source-skills", "prometheus");
			await fs.mkdir(sourceSkill, { recursive: true });
			await fs.writeFile(path.join(sourceSkill, "SKILL.md"), "# Prometheus\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncSkillsDirect(targetBase, "prometheus", sourceSkill, false);

			const targetFile = path.join(targetBase, ".agents", "skills", "prometheus", "SKILL.md");
			const content = await fs.readFile(targetFile, "utf-8");
			expect(content).toBe("# Prometheus\n");
		});

		it("creates no <target>/.codex/skills directory via `syncSkillsDirect`", async () => {
			// Codex 0.144.1 deprecates .codex/skills in favor of .agents/skills — this
			// write path must never create the old location.
			const sourceSkill = path.join(tmpDir, "source-skills", "prometheus");
			await fs.mkdir(sourceSkill, { recursive: true });
			await fs.writeFile(path.join(sourceSkill, "SKILL.md"), "# Prometheus\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncSkillsDirect(targetBase, "prometheus", sourceSkill, false);

			const oldSkillsDir = path.join(targetBase, ".codex", "skills");
			const exists = await fs
				.stat(oldSkillsDir)
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("logs warning and creates no files when source is missing via `syncSkillsDirect`", async () => {
			const targetBase = path.join(tmpDir, "target");
			await adapter.syncSkillsDirect(
				targetBase,
				"prometheus",
				path.join(tmpDir, "nonexistent"),
				false,
			);
			const exists = await fs
				.stat(path.join(targetBase, ".codex"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// syncScriptsDirect
	// ---------------------------------------------------------------------------

	describe("syncScriptsDirect", () => {
		it("guards a single script copy with mutation hooks", async () => {
			const sourceFile = path.join(tmpDir, "guarded-script.sh");
			await fs.writeFile(sourceFile, "echo guarded\n");
			const targetBase = path.join(tmpDir, "guarded-script-target");
			const targetFile = plannedCodexPath(targetBase, "scripts", "guarded-script.sh");
			await fs.mkdir(path.dirname(targetFile), { recursive: true });
			await fs.writeFile(targetFile, "external-script\n");
			const state = { operationCalled: false };
			const mutationHooks: DeployMutationHooks = {
				mutate: async (_targetPath, operation) => {
					void operation;
					throw new Error("Deploy transaction conflict");
				},
			};
			await expect(adapter.syncScriptsDirect(targetBase, "guarded-script.sh", sourceFile, false, mutationHooks)).rejects.toThrow(
				"Deploy transaction conflict",
			);
			expect(state.operationCalled).toBe(false);
			expect(await fs.readFile(targetFile, "utf-8")).toBe("external-script\n");
		});
		it("copies a single script file to target via `syncScriptsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "hud.sh");
			await fs.writeFile(sourceFile, "#!/bin/bash\necho hud\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncScriptsDirect(targetBase, "hud.sh", sourceFile, false);

			const targetFile = plannedCodexPath(targetBase, "scripts", "hud.sh");
			const content = await fs.readFile(targetFile, "utf-8");
			expect(content).toBe("#!/bin/bash\necho hud\n");
		});

		it("syncs a script directory to target via `syncScriptsDirect`", async () => {
			const sourceDir = path.join(tmpDir, "source-scripts", "hud");
			await fs.mkdir(sourceDir, { recursive: true });
			await fs.writeFile(path.join(sourceDir, "index.sh"), "#!/bin/bash\necho index\n");
			await fs.writeFile(path.join(sourceDir, "helper.sh"), "#!/bin/bash\necho helper\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncScriptsDirect(targetBase, "hud", sourceDir, false);

			const targetDir = plannedCodexPath(targetBase, "scripts", "hud");
			const indexContent = await fs.readFile(path.join(targetDir, "index.sh"), "utf-8");
			const helperContent = await fs.readFile(path.join(targetDir, "helper.sh"), "utf-8");
			expect(indexContent).toContain("echo index");
			expect(helperContent).toContain("echo helper");
		});

		it("rewrites @lib imports relative to the deployed Codex platform root", async () => {
			const sourceDir = path.join(tmpDir, "source-scripts", "trace");
			await fs.mkdir(sourceDir, { recursive: true });
			await fs.writeFile(path.join(sourceDir, "index.ts"), 'import { deriveProjectName } from "@lib/omt-dir";\nconsole.log(typeof deriveProjectName);\n');
			const targetBase = path.join(tmpDir, "target");
			await adapter.syncScriptsDirect(targetBase, "trace", sourceDir, false);
			const deployed = await fs.readFile(path.join(plannedCodexPath(targetBase, "scripts", "trace"), "index.ts"), "utf8");
			expect(deployed).not.toContain('"@lib/omt-dir"');
			expect(deployed).toContain("../../lib/omt-dir");
		});

		it("skips copy in dry-run mode via `syncScriptsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "hud.sh");
			await fs.writeFile(sourceFile, "#!/bin/bash\necho hud\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncScriptsDirect(targetBase, "hud.sh", sourceFile, true);

			const exists = await fs
				.stat(path.join(targetBase, ".codex", "scripts", "hud.sh"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("logs warning for missing source and does not throw via `syncScriptsDirect`", async () => {
			const targetBase = path.join(tmpDir, "target");
			// Must not throw
			await adapter.syncScriptsDirect(
				targetBase,
				"hud.sh",
				path.join(tmpDir, "nonexistent.sh"),
				false,
			);
			const exists = await fs
				.stat(path.join(targetBase, ".codex"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// syncHooksDirect
	// ---------------------------------------------------------------------------

	describe("syncHooksDirect", () => {
		it("copies hook file and sets chmod +x via `syncHooksDirect`", async () => {
			const hookFile = path.join(tmpDir, "notify.sh");
			await fs.writeFile(hookFile, "#!/bin/bash\necho notify\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncHooksDirect(targetBase, "notify.sh", hookFile, false);

			const targetFile = plannedCodexPath(targetBase, "hooks", "notify.sh");
			const content = await fs.readFile(targetFile, "utf-8");
			expect(content).toContain("notify");

			const stat = await fs.stat(targetFile);
			expect(stat.mode & 0o111).toBeGreaterThan(0);
		});

		it("logs warning and creates no files when hook source is missing via `syncHooksDirect`", async () => {
			const targetBase = path.join(tmpDir, "target");
			await adapter.syncHooksDirect(
				targetBase,
				"notify.sh",
				path.join(tmpDir, "nonexistent.sh"),
				false,
			);
			const exists = await fs
				.stat(path.join(targetBase, ".codex"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it("파일 훅의 shell 의존성을 target에 복사한다", async () => {
			// hooks/ 구조: my-hook.sh (source 문 포함) + lib/shared.sh
			const hooksDir = path.join(tmpDir, "hooks");
			const libDir = path.join(hooksDir, "lib");
			await fs.mkdir(hooksDir, { recursive: true });
			await fs.mkdir(libDir, { recursive: true });
			await fs.writeFile(
				path.join(hooksDir, "my-hook.sh"),
				'#!/bin/bash\nsource "$HOOKS_DIR/lib/shared.sh"\necho hook\n',
				"utf-8",
			);
			await fs.writeFile(path.join(libDir, "shared.sh"), "#!/bin/bash\necho shared\n", "utf-8");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncHooksDirect(
				targetBase,
				"my-hook.sh",
				path.join(hooksDir, "my-hook.sh"),
				false,
			);

			const targetLib = path.join(targetBase, ".codex", "hooks", "lib", "shared.sh");
			const libExists = await fs
				.stat(targetLib)
				.then(() => true)
				.catch(() => false);
			expect(libExists).toBe(true);
		});

		it("파일 훅은 main mutate·observer 뒤 dependency mutate·observer 순서를 보장한다", async () => {
			const hooksDir = path.join(tmpDir, "ordered-hooks");
			await fs.mkdir(path.join(hooksDir, "lib"), { recursive: true });
			const sourceFile = path.join(hooksDir, "main.sh");
			await fs.writeFile(sourceFile, 'source "$HOOKS_DIR/lib/shared.sh"\necho main\n');
			await fs.writeFile(path.join(hooksDir, "lib", "shared.sh"), "echo shared\n");
			const targetBase = path.join(tmpDir, "ordered-target");
			const targetMain = plannedCodexPath(targetBase, "hooks", "main.sh");
			const targetDependency = path.join(targetBase, ".codex", "hooks", "lib", "shared.sh");
			const events: string[] = [];
			const mutationHooks: DeployMutationHooks = {
				mutate: async (targetPath, operation) => {
					events.push(`mutate:${targetPath}`);
					await operation();
				},
			};
			await adapter.syncHooksDirect(
				targetBase,
				"main.sh",
				sourceFile,
				false,
				async (writtenPath) => {
					events.push(`observe:${writtenPath}`);
				},
				mutationHooks,
			);
			expect(events).toEqual([
				`mutate:${targetMain}`,
				`observe:${targetMain}`,
				`mutate:${targetDependency}`,
				`observe:${targetDependency}`,
			]);
		});

		it("파일 훅 main mutation conflict는 실제 복사·dependency·observer를 모두 차단한다", async () => {
			const sourceFile = path.join(tmpDir, "conflict.sh");
			await fs.writeFile(sourceFile, "echo conflict\n");
			const targetBase = path.join(tmpDir, "conflict-target");
			const calls: string[] = [];
			const mutationHooks: DeployMutationHooks = {
				mutate: async (targetPath) => {
					calls.push(targetPath);
					throw new Error("Deploy transaction conflict");
				},
			};
			await expect(
				adapter.syncHooksDirect(targetBase, "conflict.sh", sourceFile, false, () => undefined, mutationHooks),
			).rejects.toThrow("Deploy transaction conflict");
			expect(calls).toEqual([plannedCodexPath(targetBase, "hooks", "conflict.sh")]);
			expect(
				await fs.stat(plannedCodexPath(targetBase, "hooks", "conflict.sh")).then(() => true).catch(() => false),
			).toBe(false);
		});

		it("디렉토리 훅의 외부 의존성을 base dir 기반으로 resolve한다", async () => {
			// hooks/ 구조: my-dir-hook/entry.sh (hooks/ 루트 기준 source) + lib/shared.sh
			// hooksSourceDir = path.dirname(dirHookDir) = hooks/
			// syncShellDepsForDir copies deps into targetHookDir = .codex/hooks/my-dir-hook/
			const hooksDir = path.join(tmpDir, "hooks");
			const dirHookDir = path.join(hooksDir, "my-dir-hook");
			const libDir = path.join(hooksDir, "lib");
			await fs.mkdir(dirHookDir, { recursive: true });
			await fs.mkdir(libDir, { recursive: true });
			await fs.writeFile(
				path.join(dirHookDir, "entry.sh"),
				'#!/bin/bash\nsource "$HOOKS_DIR/lib/shared.sh"\necho entry\n',
				"utf-8",
			);
			await fs.writeFile(path.join(libDir, "shared.sh"), "#!/bin/bash\necho shared\n", "utf-8");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncHooksDirect(targetBase, "my-dir-hook", dirHookDir, false);

			// deps are copied into the targetHookDir, not the parent hooks/ dir
			const targetLib = path.join(plannedCodexPath(targetBase, "hooks", "my-dir-hook"), "lib", "shared.sh");
			const libExists = await fs
				.stat(targetLib)
				.then(() => true)
				.catch(() => false);
			expect(libExists).toBe(true);
		});

		it("디렉터리 훅 observer가 root 배포 직후 호출되고 dependency가 뒤따른다", async () => {
			const hooksDir = path.join(tmpDir, "hooks");
			const dirHookDir = path.join(hooksDir, "my-dir-hook");
			const libDir = path.join(hooksDir, "lib");
			await fs.mkdir(dirHookDir, { recursive: true });
			await fs.mkdir(libDir, { recursive: true });
			await fs.writeFile(
				path.join(dirHookDir, "entry.sh"),
				'#!/bin/bash\nsource "$HOOKS_DIR/lib/shared.sh"\necho entry\n',
				"utf-8",
			);
			await fs.writeFile(path.join(libDir, "shared.sh"), "#!/bin/bash\necho shared\n", "utf-8");

			const targetBase = path.join(tmpDir, "target");
			const targetHookRoot = plannedCodexPath(targetBase, "hooks", "my-dir-hook");
			const targetLib = path.join(targetHookRoot, "lib", "shared.sh");
			const observed: string[] = [];
			await adapter.syncHooksDirect(targetBase, "my-dir-hook", dirHookDir, false, async (writtenPath) => {
				observed.push(writtenPath);
				expect(await fs.stat(writtenPath)).toBeTruthy();
			});

			expect(observed).toEqual([targetHookRoot, targetLib]);
			expect(await fs.readFile(targetLib, "utf-8")).toContain("shared");
		});

		it("디렉터리 훅은 root mutation·observer와 dependency mutation을 전달한다", async () => {
			const hooksDir = path.join(tmpDir, "forward-hooks");
			const dirHookDir = path.join(hooksDir, "bundle");
			await fs.mkdir(dirHookDir, { recursive: true });
			await fs.mkdir(path.join(hooksDir, "lib"), { recursive: true });
			await fs.writeFile(path.join(dirHookDir, "entry.sh"), 'source "$HOOKS_DIR/lib/shared.sh"\n');
			await fs.writeFile(path.join(hooksDir, "lib", "shared.sh"), "echo shared\n");
			const targetBase = path.join(tmpDir, "forward-target");
			const root = plannedCodexPath(targetBase, "hooks", "bundle");
			const dependency = path.join(root, "lib", "shared.sh");
			const mutations: string[] = [];
			const observations: string[] = [];
			const mutationHooks: DeployMutationHooks = {
				mutate: async (targetPath, operation) => {
					mutations.push(targetPath);
					await operation();
				},
			};
			await adapter.syncHooksDirect(
				targetBase,
				"bundle",
				dirHookDir,
				false,
				async (writtenPath) => {
					observations.push(writtenPath);
				},
				mutationHooks,
			);
			expect(mutations).toEqual([path.join(root, "entry.sh"), dependency]);
			expect(observations).toEqual([dependency]);
		});

		it("dry-run에서는 mutation hook과 observer를 호출하지 않는다", async () => {
			const sourceFile = path.join(tmpDir, "dry.sh");
			await fs.writeFile(sourceFile, "echo dry\n");
			let mutateCount = 0;
			let observeCount = 0;
			const mutationHooks: DeployMutationHooks = {
				mutate: async (_targetPath, operation) => {
					mutateCount += 1;
					await operation();
				},
			};
			await adapter.syncHooksDirect(
				path.join(tmpDir, "dry-target"),
				"dry.sh",
				sourceFile,
				true,
				() => {
					observeCount += 1;
				},
				mutationHooks,
			);
			expect(mutateCount).toBe(0);
			expect(observeCount).toBe(0);
		});

		it("의존성 복사 실패 뒤에도 이미 완료된 디렉터리 훅 observer만 유지한다", async () => {
			const hooksDir = path.join(tmpDir, "hooks");
			const dirHookDir = path.join(hooksDir, "my-dir-hook");
			const libDir = path.join(hooksDir, "lib");
			await fs.mkdir(dirHookDir, { recursive: true });
			await fs.mkdir(path.join(libDir, "shared.sh"), { recursive: true });
			await fs.writeFile(
				path.join(dirHookDir, "entry.sh"),
				'#!/bin/bash\nsource "$HOOKS_DIR/lib/shared.sh"\necho entry\n',
				"utf-8",
			);

			const observed: string[] = [];
			await expect(
				adapter.syncHooksDirect(
					path.join(tmpDir, "target"),
					"my-dir-hook",
					dirHookDir,
					false,
					(writtenPath) => {
						observed.push(writtenPath);
					},
				),
			).rejects.toThrow();
			expect(observed).toEqual([plannedCodexPath(path.join(tmpDir, "target"), "hooks", "my-dir-hook")]);
		});

		it("디렉토리 훅의 @lib/ import를 배포 시 상대 경로로 재작성한다", async () => {
			// Source dir: hooks/rules-injector/cli.ts with @lib/ import
			const hookSrcDir = path.join(tmpDir, "hooks", "rules-injector");
			await fs.mkdir(hookSrcDir, { recursive: true });
			await fs.writeFile(
				path.join(hookSrcDir, "cli.ts"),
				'import { foo } from "@lib/utils.ts";\nconsole.log("hi");\n',
			);

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncHooksDirect(targetBase, "rules-injector", hookSrcDir, false);

			// Deployed file must have @lib/ rewritten to a relative path (../../lib/)
			// .codex/hooks/rules-injector/cli.ts is 2 dirs deep under platformRoot (.codex)
			const deployedFile = path.join(plannedCodexPath(targetBase, "hooks", "rules-injector"), "cli.ts");
			const content = await fs.readFile(deployedFile, "utf-8");
			expect(content).not.toContain("@lib/");
			expect(content).toContain("../../lib/");
		});

		it("machine-local config.local.yaml in target survives sync as an orphan-deletion exclude via `syncHooksDirect`", async () => {
			// Source dir: hooks/rules-injector/config.yaml (the committed base config)
			const hookSrcDir = path.join(tmpDir, "hooks", "rules-injector");
			await fs.mkdir(hookSrcDir, { recursive: true });
			await fs.writeFile(path.join(hookSrcDir, "config.yaml"), "exclude:\n  - foo\n");

			// Pre-seed a machine-local override in the TARGET dir only (not in source) —
			// simulates a user-created ~/.codex/hooks/rules-injector/config.local.yaml
			const targetBase = path.join(tmpDir, "target");
			const targetHookDir = path.join(targetBase, ".codex", "hooks", "rules-injector");
			await fs.mkdir(targetHookDir, { recursive: true });
			await fs.writeFile(path.join(targetHookDir, "config.local.yaml"), "exclude:\n  - bar\n");

			await adapter.syncHooksDirect(targetBase, "rules-injector", hookSrcDir, false);

			// config.local.yaml is target-only (not in source) — must NOT be orphan-deleted
			const localConfig = await fs.readFile(path.join(targetHookDir, "config.local.yaml"), "utf-8");
			expect(localConfig).toBe("exclude:\n  - bar\n");
		});
	});

	// ---------------------------------------------------------------------------
	// syncCommandsDirect — skip with warning
	// ---------------------------------------------------------------------------

	describe("syncCommandsDirect", () => {
		it("skips with warning via `syncCommandsDirect`", async () => {
			await adapter.syncCommandsDirect(tmpDir, "my-command", "/nonexistent.md");
			const exists = await fs
				.stat(path.join(tmpDir, ".codex"))
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// updateSettings — writes .codex/hooks.json
	// ---------------------------------------------------------------------------

	describe("updateSettings", () => {
		it("updateSettings writes hooks.json", async () => {
			const hooksEntries: Record<string, unknown> = {
				PostToolUse: [{ hooks: [{ command: "echo post-tool-use" }] }],
			};

			await adapter.updateSettings(tmpDir, hooksEntries, false);

			const hooksFile = path.join(tmpDir, ".codex", "hooks.json");
			const raw = await fs.readFile(hooksFile, "utf-8");
			const parsed = JSON.parse(raw) as {
				hooks?: { PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
			};
			expect(parsed.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toBe("echo post-tool-use");
		});

		it("updateSettings preserves marked foreign hooks", async () => {
			// Seed: one FOREIGN block tagged preserve.command-contains AND one untagged OMT block
			const hooksDir = path.join(tmpDir, ".codex");
			await fs.mkdir(hooksDir, { recursive: true });
			const hooksFile = path.join(hooksDir, "hooks.json");
			const seed = {
				hooks: {
					PostToolUse: [
						// Foreign block — tagged with preserve marker
						{ hooks: [{ command: "/opt/foreign/notify.sh" }] },
						// Untagged OMT block — must be replaced
						{ hooks: [{ command: "omt-old-command" }] },
					],
				},
			};
			await fs.writeFile(hooksFile, JSON.stringify(seed, null, 2) + "\n", "utf-8");

			const freshEntries: Record<string, unknown> = {
				PostToolUse: [{ hooks: [{ command: "omt-new-command" }] }],
			};

			await adapter.updateSettings(tmpDir, freshEntries, false, {
				"command-contains": ["/opt/foreign/"],
			});

			const raw = await fs.readFile(hooksFile, "utf-8");
			const parsed = JSON.parse(raw) as {
				hooks?: { PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
			};
			const commands = (parsed.hooks?.PostToolUse ?? []).flatMap((block) =>
				(block.hooks ?? []).map((h) => h.command ?? ""),
			);

			// Foreign block with marker survives
			expect(commands).toContain("/opt/foreign/notify.sh");
			// Fresh OMT entry is present
			expect(commands).toContain("omt-new-command");
			// Untagged old OMT entry is gone
			expect(commands).not.toContain("omt-old-command");
		});
	});

	// ---------------------------------------------------------------------------
	// updateSettings — throws when source-had-items but all were skipped
	// ---------------------------------------------------------------------------

	describe("updateSettings skip-to-empty guard", () => {
		it("throws when syncPlatformYaml hook event had source items but all were skipped", async () => {
			// Stage a hook dir with no index.ts or index.sh — triggers the continue/skip branch
			const emptyHookDir = path.join(tmpDir, "source-hooks", "no-entry-hook");
			await fs.mkdir(emptyHookDir, { recursive: true });
			await fs.writeFile(path.join(emptyHookDir, "readme.txt"), "no entrypoint here\n");

			const targetBase = path.join(tmpDir, "target-skip-guard");

			const yaml = {
				hooks: {
					PostToolUse: [
						{
							component: emptyHookDir,
							matcher: "*",
							timeout: 10,
						},
					],
				},
			};

			await expect(adapter.syncPlatformYaml(targetBase, yaml as never, false)).rejects.toThrow(
				/PostToolUse/,
			);
		});
	});

	// ---------------------------------------------------------------------------
	// syncPlatformYaml — hooks: deploys bundle + relative command
	// ---------------------------------------------------------------------------

	describe("syncPlatformYaml hooks", () => {
		it("hook bundle mutation conflict prevents the later hooks.json write", async () => {
			const sourceHook = path.join(tmpDir, "conflicting-platform-hook.sh");
			await fs.writeFile(sourceHook, "echo hook\n");
			const targetBase = path.join(tmpDir, "platform-conflict");
			const mutationHooks: DeployMutationHooks = {
				mutate: async () => {
					throw new Error("Deploy transaction conflict");
				},
			};
			await expect(
				adapter.syncPlatformYaml(
					targetBase,
					{ hooks: { Notification: [{ component: sourceHook }] } } as never,
					false,
					undefined,
					undefined,
					mutationHooks,
				),
			).rejects.toThrow("Deploy transaction conflict");
			expect(
				await fs.stat(path.join(targetBase, ".codex", "hooks.json")).then(() => true).catch(() => false),
			).toBe(false);
		});
		it("notifies after each successful OMT-owned config, MCP, hook bundle, and hooks.json write via `syncPlatformYaml`", async () => {
			const sourceHookDir = path.join(tmpDir, "external-hook");
			await fs.mkdir(sourceHookDir, { recursive: true });
			await fs.writeFile(path.join(sourceHookDir, "index.ts"), "console.log('hook');\n");
			const yaml = {
				config: { model: "o4-mini" },
				mcps: { "server-a": { command: "npx" } },
				"model-map": { tiers: { sonnet: { model: "gpt-5.6-sol" } } },
				hooks: { Notification: [{ component: sourceHookDir }] },
			};
			const writes: string[] = [];
			const observer = async (writtenPath: string) => {
				writes.push(writtenPath);
				await fs.stat(writtenPath);
			};

			await adapter.syncPlatformYaml(tmpDir, yaml as never, false, undefined, observer);

			const configFile = path.join(tmpDir, ".codex", "config.toml");
			const hookDir = path.join(tmpDir, ".codex", "hooks", path.basename(sourceHookDir));
			const hooksFile = path.join(tmpDir, ".codex", "hooks.json");
			expect(writes).toEqual([configFile, configFile, hookDir, hooksFile]);
		});

		it("does not notify for dry-run or sections that perform no writes via `syncPlatformYaml`", async () => {
			const writes: string[] = [];
			const observer = (writtenPath: string) => {
				writes.push(writtenPath);
			};
			await adapter.syncPlatformYaml(
				tmpDir,
				{
					config: { model: "o4-mini" },
					mcps: { "server-a": { command: "npx" } },
					"model-map": { tiers: { sonnet: { model: "gpt-5.6-sol" } } },
					plugins: { absent: { state: "absent" } },
				} as never,
				true,
				undefined,
				observer,
			);
			await adapter.syncPlatformYaml(tmpDir, { "model-map": { tiers: {} } } as never, false, undefined, observer);
			await adapter.syncPlatformYaml(tmpDir, { plugins: { absent: { state: "absent" } } } as never, false, undefined, observer);
			expect(writes).toEqual([]);
		});

		it("PreToolUse trace wrapper coverage", async () => {
			const componentDir = path.join(tmpDir, "source-hooks", "component-hook");
			await fs.mkdir(componentDir, { recursive: true });
			await fs.writeFile(path.join(componentDir, "index.ts"), "// hook\n");
			const rawCommand = ": .codex/raw-marker; printf '%s|%s|%s\\n' 'quote' \"$HOME\" `printf tick`; printf '%s\\n' marker; printf '%s\\n' marker >> \"$OMT_DIR/sentinel\"\\n";
			const yaml = {
				hooks: {
					PreToolUse: [
						{ component: componentDir, matcher: "Bash", timeout: 17 },
						{ command: rawCommand, "trace-id": "raw-hook", matcher: "Read", timeout: 23 },
					],
					SessionStart: [{ command: "echo session", matcher: "*", timeout: 4 }],
				},
			};

			const preview = await adapter.previewPreToolUseCommands(tmpDir, yaml as never);
			await adapter.syncPlatformYaml(tmpDir, yaml as never, false);
			const parsed = JSON.parse(await fs.readFile(path.join(tmpDir, ".codex", "hooks.json"), "utf-8"));
			const pre = parsed.hooks.PreToolUse;
			expect(pre).toHaveLength(2);
			const fakeBin = path.join(tmpDir, "fake-bin");
			await fs.mkdir(fakeBin, { recursive: true });
			const fakeBun = path.join(fakeBin, "bun");
			await fs.writeFile(fakeBun, "#!/bin/sh\nprintf '%s\\0' \"$@\"\n");
			await fs.chmod(fakeBun, 0o755);
			const captureArgv = (command: string) => {
				const result = Bun.spawnSync(["sh", "-c", command], {
					env: { ...process.env, PATH: `${fakeBin}:/bin:/usr/bin` },
				});
				return new TextDecoder().decode(result.stdout).split("\0").slice(0, -1);
			};
			const componentArgv = captureArgv(pre[0].hooks[0].command);
			const rawArgv = captureArgv(pre[1].hooks[0].command);
			const absoluteRawCommand = rawCommand.replaceAll(".codex/", `${path.join(tmpDir, ".codex")}/`);
			expect(pre.map((entry: any) => entry.hooks[0].command)).toEqual(preview.map((item) => item.wrappedCommand));
			expect(pre[0].hooks[0].command.match(/pretool-trace/g)?.length).toBe(1);
			expect(pre[1].hooks[0].command.match(/pretool-trace/g)?.length).toBe(1);
			expect(componentArgv).toEqual([
				path.join(tmpDir, ".codex/scripts/pretool-trace/index.ts"),
				"codex",
				"component-hook",
				`bun run ${path.join(tmpDir, ".codex/hooks/component-hook/index.ts")}`,
			]);
			expect(rawArgv).toEqual([path.join(tmpDir, ".codex/scripts/pretool-trace/index.ts"), "codex", "raw-hook", absoluteRawCommand]);
			const baselineDir = path.join(tmpDir, "baseline");
			const wrappedDir = path.join(tmpDir, "wrapped");
			await fs.mkdir(path.join(baselineDir, ".codex"), { recursive: true });
			await fs.mkdir(path.join(wrappedDir, ".codex"), { recursive: true });
			await fs.mkdir(path.join(baselineDir, "omt"), { recursive: true });
			await fs.mkdir(path.join(wrappedDir, "omt"), { recursive: true });
			const executableBun = "#!/bin/sh\nexec /bin/sh -c \"$4\"\n";
			await fs.writeFile(fakeBun, executableBun);
			const run = (cwd: string, command: string) =>
				Bun.spawnSync(["sh", "-c", command], {
					cwd,
				env: { ...process.env, PATH: `${fakeBin}:/bin:/usr/bin`, HOME: path.join(tmpDir, "controlled-home"), OMT_DIR: path.join(cwd, "omt") },
				});
			const baseline = run(baselineDir, rawCommand);
			const wrapped = run(wrappedDir, pre[1].hooks[0].command);
			expect(wrapped.exitCode).toBe(baseline.exitCode);
			expect(new TextDecoder().decode(wrapped.stdout)).toBe(new TextDecoder().decode(baseline.stdout));
			expect(new TextDecoder().decode(wrapped.stderr)).toBe(new TextDecoder().decode(baseline.stderr));
			expect(new TextDecoder().decode(wrapped.stdout).match(/marker/g)?.length).toBe(1);
			expect(pre[0].hooks[0].timeout).toBe(17);
			expect(pre[0].matcher).toBe("Bash");
			expect(pre[1].hooks[0].timeout).toBe(23);
			expect(pre[1].matcher).toBe("Read");
			expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("echo session");
		});

		it("raw PreToolUse trace id", async () => {
			const target = path.join(tmpDir, "raw-invalid");
			await fs.mkdir(path.join(target, ".codex"), { recursive: true });
			await fs.writeFile(path.join(target, ".codex", "hooks.json"), "hooks-sentinel");
			await fs.writeFile(path.join(target, ".codex", "config.toml"), "config-sentinel");
			const snapshot = async () => {
				const files = await fs.readdir(target, { recursive: true });
				const regularFiles = [];
				for (const file of files) {
					if ((await fs.stat(path.join(target, file))).isFile()) regularFiles.push(file);
				}
				return Promise.all(regularFiles.map(async (file) => [file, await fs.readFile(path.join(target, file))] as const));
			};
			for (const item of [{ command: "echo raw" }, { command: "echo raw", "trace-id": "unsafe id" }]) {
				const before = await snapshot();
				await expect(adapter.syncPlatformYaml(target, { hooks: { PreToolUse: [item] } } as never, false)).rejects.toThrow(/trace-id/);
				expect(await snapshot()).toEqual(before);
			}
		});

		it("PreToolUse trace pure preview", async () => {
			const componentDir = path.join(tmpDir, "source-hooks", "preview-hook");
			await fs.mkdir(componentDir, { recursive: true });
			await fs.writeFile(path.join(componentDir, "index.sh"), "#!/bin/sh\n");
			const yaml = {
				hooks: {
					PreToolUse: [
						{ component: componentDir, matcher: "Bash", timeout: 31 },
						{ command: "printf '%s' \"$HOME\"", "trace-id": "raw-preview", matcher: "*", timeout: 32 },
					],
				},
			};
			const before = await fs.readdir(tmpDir);
			const preview = await adapter.previewPreToolUseCommands(tmpDir, yaml as never);
			expect(await fs.readdir(tmpDir)).toEqual(before);
			expect(preview).toHaveLength(2);
			expect(preview[0]).toMatchObject({
				hookId: "preview-hook",
				originalCommand: `bash ${path.join(tmpDir, ".codex/hooks/preview-hook/index.sh")}`,
				wrapperDeploymentPath: path.join(tmpDir, ".codex/scripts/pretool-trace/index.ts"),
				matcher: "Bash",
				timeout: 31,
				scope: "project",
			});
			expect(preview[1]).toMatchObject({ hookId: "raw-preview", originalCommand: "printf '%s' \"$HOME\"", timeout: 32 });
			await adapter.syncPlatformYaml(tmpDir, yaml as never, false);
			const parsed = JSON.parse(await fs.readFile(path.join(tmpDir, ".codex", "hooks.json"), "utf-8"));
			expect(parsed.hooks.PreToolUse.map((entry: any) => entry.hooks[0].command)).toEqual(
				preview.map((item) => item.wrappedCommand),
			);
			const globalPreview = await adapter.previewPreToolUseCommands(os.homedir(), {
				hooks: { PreToolUse: [{ command: "echo global", "trace-id": "global-hook", matcher: "*", timeout: 41 }] },
			} as never);
			expect(globalPreview[0]).toMatchObject({
				scope: "global",
				wrapperDeploymentPath: path.join(os.homedir(), ".codex/scripts/pretool-trace/index.ts"),
				matcher: "*",
				timeout: 41,
			});
			const relativeTarget = path.relative(process.cwd(), tmpDir);
			const relativePreview = await adapter.previewPreToolUseCommands(relativeTarget, {
				hooks: { PreToolUse: [{ command: "echo relative", "trace-id": "relative-hook" }] },
			} as never);
			await adapter.syncPlatformYaml(relativeTarget, { hooks: { PreToolUse: [{ command: "echo relative", "trace-id": "relative-hook" }] } } as never, false);
			const relativeParsed = JSON.parse(await fs.readFile(path.join(tmpDir, ".codex/hooks.json"), "utf-8"));
			expect(relativeParsed.hooks.PreToolUse[0].hooks[0].command).toBe(relativePreview[0].wrappedCommand);
			const missingComponent = path.join(tmpDir, "missing-component");
			await fs.mkdir(missingComponent);
			await expect(adapter.previewPreToolUseCommands(tmpDir, { hooks: { PreToolUse: [{ component: missingComponent }] } } as never)).rejects.toThrow(/item 0/);
		});

		it("deploys rules-injector bundle + relative command", async () => {
			// Stage a synthetic rules-injector hook dir with index.ts and a test file
			const hookSrcDir = path.join(tmpDir, "source-hooks", "rules-injector");
			await fs.mkdir(hookSrcDir, { recursive: true });
			await fs.writeFile(path.join(hookSrcDir, "index.ts"), "// hook entry\n");
			await fs.writeFile(path.join(hookSrcDir, "helper.ts"), "// helper\n");
			await fs.writeFile(path.join(hookSrcDir, "helper.test.ts"), "// test — must NOT deploy\n");

			const targetBase = path.join(tmpDir, "target");

			const yaml = {
				hooks: {
					PostToolUse: [
						{
							component: hookSrcDir,
							matcher: "*",
							timeout: 10,
						},
					],
				},
			};

			await adapter.syncPlatformYaml(targetBase, yaml as never, false);

			// 1. Bundle deployed: index.ts and helper.ts must exist
			const deployedDir = path.join(targetBase, ".codex", "hooks", "rules-injector");
			const indexExists = await fs
				.stat(path.join(deployedDir, "index.ts"))
				.then(() => true)
				.catch(() => false);
			const helperExists = await fs
				.stat(path.join(deployedDir, "helper.ts"))
				.then(() => true)
				.catch(() => false);
			expect(indexExists).toBe(true);
			expect(helperExists).toBe(true);

			// 2. *.test.ts must NOT be deployed
			const testFileExists = await fs
				.stat(path.join(deployedDir, "helper.test.ts"))
				.then(() => true)
				.catch(() => false);
			expect(testFileExists).toBe(false);

			// 3. Generated command uses the absolute path rooted at targetBase — no $-variable
			const hooksFile = path.join(targetBase, ".codex", "hooks.json");
			const raw = await fs.readFile(hooksFile, "utf-8");
			const parsed = JSON.parse(raw) as {
				hooks?: {
					PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }>;
				};
			};
			const command = parsed.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command ?? "";
			expect(command).not.toMatch(/\$/);
			expect(command.startsWith("bun ")).toBe(true);
			expect(command).toContain(targetBase);
			expect(command).toBe(
				`bun run ${path.join(targetBase, ".codex/hooks/rules-injector/index.ts")}`,
			);
		});

		it("rewrites custom command to absolute path", async () => {
			const targetBase = path.join(tmpDir, "target-custom");

			const yaml = {
				hooks: {
					SessionStart: [
						{
							command: "bun run .codex/hooks/rules-injector/cli.ts hook session-start",
							matcher: "*",
							timeout: 10,
						},
					],
				},
			};

			await adapter.syncPlatformYaml(targetBase, yaml as never, false);

			const hooksFile = path.join(targetBase, ".codex", "hooks.json");
			const raw = await fs.readFile(hooksFile, "utf-8");
			const parsed = JSON.parse(raw) as {
				hooks?: {
					SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>;
				};
			};
			const command = parsed.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ?? "";
			expect(command).not.toMatch(/\$/);
			expect(command).toContain(targetBase);
			expect(command).toBe(
				`bun run ${path.join(targetBase, ".codex/hooks/rules-injector/cli.ts")} hook session-start`,
			);
		});
	});
});

// =============================================================================
// resolveCodexAgentModel
// =============================================================================

describe("resolveCodexAgentModel", () => {
	it("resolves a tier to {model, model_reasoning_effort} via `resolveCodexAgentModel`", () => {
		const modelMap: ModelMap = {
			tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } },
		};
		const result = resolveCodexAgentModel(modelMap, "opus", "oracle.md");
		expect(result).toEqual({ model: "gpt-5.6-sol", model_reasoning_effort: "high" });
	});

	it("omits model_reasoning_effort when the tier entry has no effort via `resolveCodexAgentModel`", () => {
		const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol" } } };
		const result = resolveCodexAgentModel(modelMap, "opus", "oracle.md");
		expect(result).toEqual({ model: "gpt-5.6-sol" });
	});

	it("prefers a per-agent override over the tier default via `resolveCodexAgentModel`", () => {
		const modelMap: ModelMap = {
			tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } },
			agents: { oracle: { model: "gpt-5.6-sol-special", effort: "low" } },
		};
		const result = resolveCodexAgentModel(modelMap, "opus", "oracle.md", "oracle");
		expect(result).toEqual({ model: "gpt-5.6-sol-special", model_reasoning_effort: "low" });
	});

	it("leaves a sibling agent without an override on the tier default via `resolveCodexAgentModel`", () => {
		const modelMap: ModelMap = {
			tiers: { opus: { model: "gpt-5.6-sol", effort: "high" } },
			agents: { oracle: { model: "gpt-5.6-sol-special", effort: "low" } },
		};
		const result = resolveCodexAgentModel(modelMap, "opus", "sisyphus.md", "sisyphus");
		expect(result).toEqual({ model: "gpt-5.6-sol", model_reasoning_effort: "high" });
	});

	it("throws naming the agent file and tier when the tier is unmapped via `resolveCodexAgentModel`", () => {
		const modelMap: ModelMap = { tiers: { opus: { model: "gpt-5.6-sol" } } };
		expect(() => resolveCodexAgentModel(modelMap, "sonnet", "oracle.md")).toThrow(
			/oracle\.md.*sonnet|sonnet.*oracle\.md/,
		);
	});
});

// =============================================================================
// cleanupCodexSkillsFossil
//
// `.codex/skills` is the pre-b9908fbc deploy location; skills now deploy to
// `.agents/skills` (codexSkillsDir). Codex 0.144.1 reads BOTH roots, so an
// unremoved fossil duplicates every skill in the session prompt. These tests
// exercise the removal exclusively against tmp dirs — never $HOME.
// =============================================================================

describe("cleanupCodexSkillsFossil", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-fossil-cleanup-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function fossilPath(...segments: string[]): string {
		return path.join(tmpDir, ".codex", "skills", ...segments);
	}

	function newPath(...segments: string[]): string {
		return path.join(tmpDir, ".agents", "skills", ...segments);
	}

	// Absolute per-test backup destination under the new backupCategory
	// contract, which now assembles join(backupDest, platform, category)
	// directly (no session-id join happens inside the writer). Each test
	// passes its own label so backups land in distinct, inspectable dirs.
	function backupDest(...segments: string[]): string {
		return path.join(tmpDir, "backup", ...segments);
	}

	async function pathExists(p: string): Promise<boolean> {
		return fs
			.stat(p)
			.then(() => true)
			.catch(() => false);
	}

	it("backs up then removes an owned fossil entry, removes the now-empty fossilDir, and leaves .codex/config.toml untouched", async () => {
		await fs.mkdir(fossilPath("skill-a"), { recursive: true });
		await fs.writeFile(fossilPath("skill-a", "SKILL.md"), "# skill-a\n");
		await fs.mkdir(newPath("skill-a"), { recursive: true });
		await fs.writeFile(newPath("skill-a", "SKILL.md"), "# skill-a\n");
		await fs.writeFile(path.join(tmpDir, ".codex", "config.toml"), 'model = "o3"\n');

		await cleanupCodexSkillsFossil(tmpDir, backupDest("happy"), false, new Set(["skill-a"]));

		expect(await pathExists(fossilPath("skill-a"))).toBe(false);
		expect(await pathExists(path.join(tmpDir, ".codex", "skills"))).toBe(false);
		expect(await fs.readFile(path.join(tmpDir, ".codex", "config.toml"), "utf-8")).toBe(
			'model = "o3"\n',
		);
		const backedUp = path.join(backupDest("happy"), "codex", "skills", "skill-a", "SKILL.md");
		expect(await fs.readFile(backedUp, "utf-8")).toBe("# skill-a\n");
	});

	it("removes a fossil entry that is a prior '.codex/'-rewrite of the current raw source, given name-provenance ownership", async () => {
		// Realistic fossil drift: the fossil holds rewrite_old(source) — the
		// source with ".claude/" rewritten to ".codex/" by a since-removed
		// rewritePlatformPaths pass — while .agents/skills holds the raw,
		// un-rewritten source. Byte-identity between them is structurally
		// impossible; ownership must be decided by name-provenance
		// (ownedSkillNames), not byte comparison.
		await fs.mkdir(fossilPath("foo"), { recursive: true });
		await fs.writeFile(fossilPath("foo", "SKILL.md"), "See .codex/scripts/run.sh for details.\n");
		await fs.mkdir(newPath("foo"), { recursive: true });
		await fs.writeFile(newPath("foo", "SKILL.md"), "See .claude/scripts/run.sh for details.\n");

		await cleanupCodexSkillsFossil(tmpDir, backupDest("drift"), false, new Set(["foo"]));

		expect(await pathExists(fossilPath("foo"))).toBe(false);
	});

	it("keeps a dotfile foreign resident (.system) untouched and leaves fossilDir in place", async () => {
		await fs.mkdir(fossilPath(".system"), { recursive: true });
		await fs.writeFile(fossilPath(".system", "note.txt"), "not OMT-managed\n");
		await fs.mkdir(newPath(), { recursive: true });

		// Positive control: prove the fixture actually exists before the call.
		expect(await pathExists(fossilPath(".system"))).toBe(true);

		await cleanupCodexSkillsFossil(tmpDir, backupDest("foreign"), false, new Set());

		expect(await pathExists(fossilPath(".system"))).toBe(true);
		expect(await fs.readFile(fossilPath(".system", "note.txt"), "utf-8")).toBe("not OMT-managed\n");
		expect(await pathExists(path.join(tmpDir, ".codex", "skills"))).toBe(true);
	});

	it("keeps a foreign resident by name even when it also exists on disk under .agents/skills — ownership is name-provenance, not on-disk listing", async () => {
		// plannotator-compound stands in for a real, never-deployed-by-OMT
		// directory that happens to also exist on disk under .agents/skills
		// (a foreign resident there too, with identical bytes on both sides).
		// The old implementation derived ownership from `fs.readdir(newDir)`
		// — an on-disk listing that includes foreign residents — so it would
		// have treated this name collision as OMT-owned, found the bytes
		// identical, and deleted it. ownedSkillNames excludes it, so under
		// name-provenance ownership it must survive untouched.
		await fs.mkdir(fossilPath(".system"), { recursive: true });
		await fs.writeFile(fossilPath(".system", "note.txt"), "not OMT-managed\n");
		await fs.mkdir(fossilPath("plannotator-compound"), { recursive: true });
		await fs.writeFile(fossilPath("plannotator-compound", "SKILL.md"), "not OMT-managed either\n");
		await fs.mkdir(newPath("plannotator-compound"), { recursive: true });
		await fs.writeFile(newPath("plannotator-compound", "SKILL.md"), "not OMT-managed either\n");

		await cleanupCodexSkillsFossil(tmpDir, backupDest("foreign-by-name"), false, new Set());

		expect(await pathExists(fossilPath(".system"))).toBe(true);
		expect(await pathExists(fossilPath("plannotator-compound"))).toBe(true);
		expect(await pathExists(backupDest("foreign-by-name"))).toBe(false);
	});

	it("ownedSkillNames empty: nothing removed, no backup written, no throw", async () => {
		// skill-j exists identically on both sides — under the old on-disk-
		// listing ownership rule this name collision alone would make it
		// OMT-owned and byte-identical, hence deleted. With an empty
		// ownedSkillNames it must be treated as a foreign resident instead.
		await fs.mkdir(fossilPath("skill-j"), { recursive: true });
		await fs.writeFile(fossilPath("skill-j", "SKILL.md"), "j\n");
		await fs.mkdir(newPath("skill-j"), { recursive: true });
		await fs.writeFile(newPath("skill-j", "SKILL.md"), "j\n");

		await cleanupCodexSkillsFossil(tmpDir, backupDest("empty-owned"), false, new Set());

		expect(await pathExists(fossilPath("skill-j"))).toBe(true);
		expect(await pathExists(backupDest("empty-owned"))).toBe(false);
		expect(await pathExists(path.join(tmpDir, ".codex", "skills"))).toBe(true);
	});

	it("throws naming both paths and leaves the fossil untouched when .agents/skills is absent (dryRun: false)", async () => {
		await fs.mkdir(fossilPath("skill-d"), { recursive: true });
		await fs.writeFile(fossilPath("skill-d", "SKILL.md"), "d\n");
		// .agents/skills intentionally never created.

		await expect(
			cleanupCodexSkillsFossil(tmpDir, backupDest("no-newdir"), false, new Set(["skill-d"])),
		).rejects.toThrow(/\.agents.*skills.*\.codex.*skills|\.codex.*skills.*\.agents.*skills/s);

		expect(await pathExists(fossilPath("skill-d"))).toBe(true);
	});

	it("does NOT throw on a dry-run first preview when .agents/skills does not exist yet, and deletes nothing", async () => {
		await fs.mkdir(fossilPath("skill-g"), { recursive: true });
		await fs.writeFile(fossilPath("skill-g", "SKILL.md"), "g\n");
		// .agents/skills intentionally never created — this is the fresh-target
		// first-dry-run scenario: dry-run writes nothing, so it can never exist yet.

		await cleanupCodexSkillsFossil(tmpDir, backupDest("dry-no-newdir"), true, new Set(["skill-g"]));

		expect(await pathExists(fossilPath("skill-g"))).toBe(true);
		expect(await fs.readFile(fossilPath("skill-g", "SKILL.md"), "utf-8")).toBe("g\n");
		expect(await pathExists(backupDest("dry-no-newdir"))).toBe(false);
	});

	it("does NOT throw in dry-run when .agents/skills exists but only holds a foreign resident, leaving the owned fossil entry untouched", async () => {
		// Reproduces the dry-run-only false failure: newDir exists (because a
		// foreign resident lives there), so the first "newDir missing" guard
		// is bypassed, but no .agents/skills/skill-x counterpart has ever been
		// written (dry-run writes nothing) — the counterpart-existence check
		// must not run in dry-run.
		await fs.mkdir(fossilPath("skill-x"), { recursive: true });
		await fs.writeFile(fossilPath("skill-x", "SKILL.md"), "x\n");
		await fs.mkdir(fossilPath("plannotator-compound"), { recursive: true });
		await fs.writeFile(fossilPath("plannotator-compound", "SKILL.md"), "not OMT-managed\n");
		await fs.mkdir(newPath("plannotator-compound"), { recursive: true });
		await fs.writeFile(newPath("plannotator-compound", "SKILL.md"), "not OMT-managed\n");
		// newPath("skill-x") intentionally never created.

		await cleanupCodexSkillsFossil(
			tmpDir,
			backupDest("dry-newdir-exists"),
			true,
			new Set(["skill-x"]),
		);

		expect(await pathExists(fossilPath("skill-x"))).toBe(true);
		expect(await fs.readFile(fossilPath("skill-x", "SKILL.md"), "utf-8")).toBe("x\n");
		expect(await pathExists(fossilPath("plannotator-compound"))).toBe(true);
		expect(await pathExists(backupDest("dry-newdir-exists"))).toBe(false);
	});

	it("throws naming the entry, deletes nothing, and writes no backup when an owned entry has no counterpart under .agents/skills", async () => {
		await fs.mkdir(fossilPath("skill-h"), { recursive: true });
		await fs.writeFile(fossilPath("skill-h", "SKILL.md"), "h\n");
		await fs.mkdir(newPath(), { recursive: true });
		// newPath("skill-h") intentionally never created — "skill-h" is
		// declared owned this run (deployed-but-missing anomaly) even though
		// no such directory actually exists under .agents/skills.

		await expect(
			cleanupCodexSkillsFossil(
				tmpDir,
				backupDest("missing-counterpart"),
				false,
				new Set(["skill-h"]),
			),
		).rejects.toThrow(/skill-h/);

		expect(await pathExists(fossilPath("skill-h"))).toBe(true);
		expect(await pathExists(backupDest("missing-counterpart"))).toBe(false);
	});

	it("does NOT throw under dry-run when an owned entry has no counterpart under .agents/skills — the counterpart check is real-run-only", async () => {
		// newDir exists (unlike sid-dry-no-newdir) but has no skill-i
		// counterpart. In dry-run nothing has ever been written, so a missing
		// counterpart is expected, not a deployed-but-missing anomaly — the
		// counterpart-existence check must not run in dry-run.
		await fs.mkdir(fossilPath("skill-i"), { recursive: true });
		await fs.writeFile(fossilPath("skill-i", "SKILL.md"), "i\n");
		await fs.mkdir(newPath(), { recursive: true });
		// newPath("skill-i") intentionally never created.

		await cleanupCodexSkillsFossil(
			tmpDir,
			backupDest("dry-missing-counterpart"),
			true,
			new Set(["skill-i"]),
		);

		expect(await pathExists(fossilPath("skill-i"))).toBe(true);
		expect(await pathExists(backupDest("dry-missing-counterpart"))).toBe(false);
	});

	it("dry-run deletes nothing and writes no backup", async () => {
		await fs.mkdir(fossilPath("skill-e"), { recursive: true });
		await fs.writeFile(fossilPath("skill-e", "SKILL.md"), "e\n");
		await fs.mkdir(newPath("skill-e"), { recursive: true });
		await fs.writeFile(newPath("skill-e", "SKILL.md"), "e\n");

		await cleanupCodexSkillsFossil(tmpDir, backupDest("dry"), true, new Set(["skill-e"]));

		expect(await pathExists(fossilPath("skill-e"))).toBe(true);
		expect(await pathExists(backupDest("dry"))).toBe(false);
	});

	it("returns silently (no throw) when the fossil directory is absent, and is idempotent on a repeat call", async () => {
		// No .codex/skills at all, and no .agents/skills either — must still
		// short-circuit BEFORE the newDir-must-exist check.
		await cleanupCodexSkillsFossil(tmpDir, backupDest("absent-1"), false, new Set());
		await cleanupCodexSkillsFossil(tmpDir, backupDest("absent-2"), false, new Set());

		expect(await pathExists(path.join(tmpDir, ".codex"))).toBe(false);
	});

	it("is idempotent: a second call after a successful cleanup is a no-op", async () => {
		await fs.mkdir(fossilPath("skill-f"), { recursive: true });
		await fs.writeFile(fossilPath("skill-f", "SKILL.md"), "f\n");
		await fs.mkdir(newPath("skill-f"), { recursive: true });
		await fs.writeFile(newPath("skill-f", "SKILL.md"), "f\n");

		await cleanupCodexSkillsFossil(tmpDir, backupDest("idem-1"), false, new Set(["skill-f"]));
		expect(await pathExists(path.join(tmpDir, ".codex", "skills"))).toBe(false);

		// Second call: fossilDir is gone, so this must return silently.
		await cleanupCodexSkillsFossil(tmpDir, backupDest("idem-2"), false, new Set(["skill-f"]));
		expect(await pathExists(path.join(tmpDir, ".codex", "skills"))).toBe(false);
	});
});
