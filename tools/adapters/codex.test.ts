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
} from "./codex.ts";
import type { ModelMap } from "../lib/types.ts";

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

	// ---------------------------------------------------------------------------
	// syncAgentsDirect — md → toml translator
	// ---------------------------------------------------------------------------

	describe("syncAgentsDirect", () => {
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
			expect(content).toContain("the prometheus skill");
			expect(content).toContain("agent_type");

			// grep -c 'Skill(' on the emitted file is 0.
			expect((content.match(/Skill\(/g) ?? []).length).toBe(0);

			// Still valid TOML, and the untouched fields are exactly untouched.
			const parsed = parse(content) as Record<string, unknown>;
			expect(parsed.name).toBe("sisyphus-junior");
			expect(parsed.model).toBe("gpt-5.6-sol");
			expect(parsed.model_reasoning_effort).toBe("medium");
			expect(parsed.developer_instructions).toContain("the prometheus skill");
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
	// syncRulesDirect — skip with warning
	// ---------------------------------------------------------------------------

	describe("syncRulesDirect", () => {
		it("skips with warning and creates no files via `syncRulesDirect`", async () => {
			await adapter.syncRulesDirect(tmpDir, "my-rule.md", "/nonexistent/rule.md");
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
		it("copies a single script file to target via `syncScriptsDirect`", async () => {
			const sourceFile = path.join(tmpDir, "hud.sh");
			await fs.writeFile(sourceFile, "#!/bin/bash\necho hud\n");

			const targetBase = path.join(tmpDir, "target");
			await adapter.syncScriptsDirect(targetBase, "hud.sh", sourceFile, false);

			const targetFile = path.join(targetBase, ".codex", "scripts", "hud.sh");
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

			const targetDir = path.join(targetBase, ".codex", "scripts", "hud");
			const indexContent = await fs.readFile(path.join(targetDir, "index.sh"), "utf-8");
			const helperContent = await fs.readFile(path.join(targetDir, "helper.sh"), "utf-8");
			expect(indexContent).toContain("echo index");
			expect(helperContent).toContain("echo helper");
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

			const targetFile = path.join(targetBase, ".codex", "hooks", "notify.sh");
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
			const targetLib = path.join(targetBase, ".codex", "hooks", "my-dir-hook", "lib", "shared.sh");
			const libExists = await fs
				.stat(targetLib)
				.then(() => true)
				.catch(() => false);
			expect(libExists).toBe(true);
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
			const deployedFile = path.join(targetBase, ".codex", "hooks", "rules-injector", "cli.ts");
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
