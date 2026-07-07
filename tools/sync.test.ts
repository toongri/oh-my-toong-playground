import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "fs/promises";
import fs2 from "fs";
import path from "path";
import os from "os";
const parseYaml = Bun.YAML.parse;

import {
	syncCategory,
	syncPlatformConfigs,
	syncDocs,
	processYaml,
	syncLib,
	rewritePlatformPaths,
	rewriteLibAliases,
	createContext,
	parseCliArgs,
	printUsage,
	resolveProjectFilter,
	runProjectsLoop,
	allTargetsProcessed,
	isFatalSyncError,
	deploysToClaudeDotDir,
	type AdapterMap,
	type LibSourceRoots,
} from "./sync.ts";
import type { SyncContext, Platform, Category, SyncYaml } from "./lib/types.ts";
import type { PlatformAdapter } from "./adapters/types.ts";
import { _resetConfigCache } from "./lib/config.ts";
import { ProjectKeyError, deriveClaudeProjectKey } from "./lib/git-key.ts";
import { DeployTargetsError } from "./lib/resolve-deploy-targets.ts";
import { ClaudeAdapter } from "./adapters/claude.ts";
import { cleanupOldBackups } from "./lib/backup.ts";
import { execFileSync } from "child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeFile(filePath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, "utf8");
}

async function readFile(filePath: string): Promise<string> {
	return fs.readFile(filePath, "utf8");
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Build a minimal mock adapter that records calls.
 */
function makeMockAdapter(platform: Platform): PlatformAdapter & {
	calls: Array<{ method: string; args: unknown[] }>;
} {
	const calls: Array<{ method: string; args: unknown[] }> = [];

	const record =
		(method: string) =>
		async (...args: unknown[]) => {
			calls.push({ method, args });
		};

	return {
		platform,
		configDir: `.${platform}`,
		contextFile: "CONTEXT.md",
		syncAgentsDirect: record("syncAgentsDirect") as PlatformAdapter["syncAgentsDirect"],
		syncCommandsDirect: record("syncCommandsDirect") as PlatformAdapter["syncCommandsDirect"],
		syncSkillsDirect: record("syncSkillsDirect") as PlatformAdapter["syncSkillsDirect"],
		syncScriptsDirect: record("syncScriptsDirect") as PlatformAdapter["syncScriptsDirect"],
		syncRulesDirect: record("syncRulesDirect") as PlatformAdapter["syncRulesDirect"],
		syncHooksDirect: record("syncHooksDirect") as PlatformAdapter["syncHooksDirect"],
		syncPlatformYaml: async (_targetPath, _yaml, _dryRun) => {
			calls.push({ method: "syncPlatformYaml", args: [_targetPath, _yaml, _dryRun] });
			return { processedSections: [], modelMap: undefined };
		},
		calls,
	};
}

/**
 * Build a mock adapter map with the given platforms.
 */
function makeAdapterMap(platforms: Platform[]): AdapterMap & {
	getAdapter(p: Platform): ReturnType<typeof makeMockAdapter> | undefined;
} {
	const mockAdapters = new Map<Platform, ReturnType<typeof makeMockAdapter>>();
	for (const p of platforms) {
		mockAdapters.set(p, makeMockAdapter(p));
	}

	const adapterMap = mockAdapters as unknown as AdapterMap & {
		getAdapter(p: Platform): ReturnType<typeof makeMockAdapter> | undefined;
	};
	adapterMap.getAdapter = (p: Platform) => mockAdapters.get(p);
	return adapterMap;
}

function makeContext(overrides?: Partial<SyncContext>): SyncContext {
	return {
		dryRun: false,
		projectName: "",
		projectDir: "",
		isRootYaml: true,
		backupSession: "test-session",
		modelMaps: new Map(),
		processedPaths: new Set(),
		platformYamlSections: new Map(),
		backupRoots: new Set(),
		failedTargets: [],
		...overrides,
	};
}

/**
 * Build a LibSourceRoots map mapping the given source paths to one platform.
 * syncLib scans these SOURCE roots (which carry raw @lib/) for lib deps — the
 * deployed tree no longer does, since aliases are rewritten at copy time.
 */
function libRoots(platform: Platform, ...sourcePaths: string[]): LibSourceRoots {
	return new Map([[platform, new Set(sourcePaths)]]);
}

// ---------------------------------------------------------------------------
// Suite: deploysToClaudeDotDir
// ---------------------------------------------------------------------------

describe("deploysToClaudeDotDir", () => {
	// Regression: the caller only ever passes `PlatformYaml | null` today, but the
	// predicate must defensively tolerate `undefined` too (e.g. a future caller
	// that omits the arg) instead of throwing on `Object.keys(undefined)`.
	it("returns false for undefined parsedClaudeYaml instead of throwing (regression)", () => {
		expect(() =>
			deploysToClaudeDotDir({}, undefined as unknown as Record<string, unknown> | null),
		).not.toThrow();
		expect(deploysToClaudeDotDir({}, undefined as unknown as Record<string, unknown> | null)).toBe(
			false,
		);
	});

	it("returns false for null parsedClaudeYaml and no component sections", () => {
		expect(deploysToClaudeDotDir({}, null)).toBe(false);
	});

	it("returns true when a component section has items", () => {
		expect(deploysToClaudeDotDir({ skills: { items: ["oracle"] } }, null)).toBe(true);
	});

	it("returns true when parsedClaudeYaml has a key other than mcps", () => {
		expect(deploysToClaudeDotDir({}, { config: { theme: "dark" } })).toBe(true);
	});

	it("returns false when parsedClaudeYaml has only mcps", () => {
		expect(deploysToClaudeDotDir({}, { mcps: {} })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suite: syncCategory
// ---------------------------------------------------------------------------

describe("syncCategory", () => {
	let tmpDir: string;
	let rootDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-category-test-"));
		rootDir = path.join(tmpDir, "root");
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(rootDir, { recursive: true });
		await fs.mkdir(targetPath, { recursive: true });
		// Create a minimal config.yaml
		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	it("dispatches to the correct adapter for claude via `syncCategory`", async () => {
		// Create a skill component directory
		const skillDir = path.join(rootDir, "skills", "oracle");
		await fs.mkdir(skillDir, { recursive: true });
		await writeFile(path.join(skillDir, "SKILL.md"), "# Oracle\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			skills: {
				platforms: ["claude"],
				items: ["oracle"],
			},
		};

		const adapters = makeAdapterMap(["claude", "gemini"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "skills", syncYaml, adapters, rootDir, targetPath);

		const claudeCalls = adapters.getAdapter("claude")!.calls;
		expect(claudeCalls.some((c) => c.method === "syncSkillsDirect")).toBe(true);

		const geminiCalls = adapters.getAdapter("gemini")!.calls;
		expect(geminiCalls.filter((c) => c.method === "syncSkillsDirect")).toHaveLength(0);
	});

	it("dispatches only to gemini when item-level platforms override is set", async () => {
		const commandFile = path.join(rootDir, "commands", "my-cmd.md");
		await writeFile(commandFile, "# My Command\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			commands: {
				platforms: ["claude"],
				items: [{ component: "my-cmd", platforms: ["gemini"] }],
			},
		};

		const adapters = makeAdapterMap(["claude", "gemini"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "commands", syncYaml, adapters, rootDir, targetPath);

		expect(
			adapters.getAdapter("gemini")!.calls.some((c) => c.method === "syncCommandsDirect"),
		).toBe(true);
		expect(
			adapters.getAdapter("claude")!.calls.filter((c) => c.method === "syncCommandsDirect"),
		).toHaveLength(0);
	});

	it("calls `syncAgentsDirect` for agents category", async () => {
		const agentFile = path.join(rootDir, "agents", "oracle.md");
		await writeFile(agentFile, "---\nname: oracle\n---\n# Oracle\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			agents: {
				platforms: ["claude"],
				items: ["oracle"],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "agents", syncYaml, adapters, rootDir, targetPath);

		const calls = adapters.getAdapter("claude")!.calls;
		expect(calls.some((c) => c.method === "syncAgentsDirect")).toBe(true);
	});

	it("skips items with empty component", async () => {
		const syncYaml: SyncYaml = {
			path: targetPath,
			rules: {
				platforms: ["claude"],
				items: [{ component: "" } as never],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		// Should not throw
		await syncCategory(context, "rules", syncYaml, adapters, rootDir, targetPath);
		expect(
			adapters.getAdapter("claude")!.calls.filter((c) => c.method === "syncRulesDirect"),
		).toHaveLength(0);
	});

	it("does nothing when items array is absent", async () => {
		const syncYaml: SyncYaml = {
			path: targetPath,
			scripts: {},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "scripts", syncYaml, adapters, rootDir, targetPath);
		expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
	});

	it("does not call adapter write methods in dry-run mode", async () => {
		const agentFile = path.join(rootDir, "agents", "oracle.md");
		await writeFile(agentFile, "# Oracle\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			agents: {
				platforms: ["claude"],
				items: ["oracle"],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: true });

		await syncCategory(context, "agents", syncYaml, adapters, rootDir, targetPath);

		// Adapter syncAgentsDirect should NOT be called in dry-run
		const calls = adapters.getAdapter("claude")!.calls;
		expect(calls.filter((c) => c.method === "syncAgentsDirect")).toHaveLength(0);
	});

	it("removes orphan files after sync (P1-3)", async () => {
		// Create a skill component in rootDir
		const skillDir = path.join(rootDir, "skills", "oracle");
		await fs.mkdir(skillDir, { recursive: true });
		await writeFile(path.join(skillDir, "SKILL.md"), "# Oracle\n");

		// Pre-populate target with an orphan agent file
		const claudeAgentsDir = path.join(targetPath, ".claude", "agents");
		await fs.mkdir(claudeAgentsDir, { recursive: true });
		await writeFile(path.join(claudeAgentsDir, "orphan-agent.md"), "# Orphan\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			agents: {
				platforms: ["claude"],
				items: ["oracle"],
			},
		};

		// Ensure source file exists so resolveComponentPath succeeds
		await writeFile(path.join(rootDir, "agents", "oracle.md"), "# Oracle\n");

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "agents", syncYaml, adapters, rootDir, targetPath);

		// Orphan should be gone: wipe+recreate cleared the dir before writing
		expect(await exists(path.join(claudeAgentsDir, "orphan-agent.md"))).toBe(false);
	});

	it("resolves add-hooks component and attaches source_path and display_name for agents category", async () => {
		// Create agent source file
		const agentFile = path.join(rootDir, "agents", "oracle.md");
		await writeFile(agentFile, "---\nname: oracle\n---\n# Oracle\n");

		// Create hook source file
		const hookFile = path.join(rootDir, "hooks", "keyword-detector.sh");
		await writeFile(hookFile, "#!/bin/bash\necho hi\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			agents: {
				platforms: ["claude"],
				items: [
					{
						component: "oracle",
						"add-hooks": [
							{
								component: "keyword-detector.sh",
								event: "UserPromptSubmit",
								timeout: 10,
							},
						],
					} as never,
				],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "agents", syncYaml, adapters, rootDir, targetPath);

		const calls = adapters.getAdapter("claude")!.calls;
		const agentCall = calls.find((c) => c.method === "syncAgentsDirect");
		expect(agentCall).toBeDefined();
		// addHooks (5th arg, index 4) should contain a resolved hook with source_path and display_name
		const addHooks = agentCall!.args[4] as Array<Record<string, unknown>> | undefined;
		expect(addHooks).toBeDefined();
		expect(addHooks!.length).toBeGreaterThan(0);
		expect(addHooks![0]["source_path"]).toBe(hookFile);
		expect(addHooks![0]["display_name"]).toBe("keyword-detector.sh");
	});

	it("skips missing add-hooks component with a warning", async () => {
		const agentFile = path.join(rootDir, "agents", "oracle.md");
		await writeFile(agentFile, "---\nname: oracle\n---\n# Oracle\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			agents: {
				platforms: ["claude"],
				items: [
					{
						component: "oracle",
						"add-hooks": [
							{
								component: "nonexistent-hook.sh",
								event: "UserPromptSubmit",
								timeout: 10,
							},
						],
					} as never,
				],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		// Should not throw
		await syncCategory(context, "agents", syncYaml, adapters, rootDir, targetPath);

		const calls = adapters.getAdapter("claude")!.calls;
		const agentCall = calls.find((c) => c.method === "syncAgentsDirect");
		expect(agentCall).toBeDefined();
		// addHooks should be undefined since the only hook failed to resolve
		const addHooks = agentCall!.args[4] as unknown[] | undefined;
		expect(addHooks === null || addHooks === undefined || addHooks.length === 0).toBe(true);
	});

	it("warns and skips add-skills when value is a scalar string (P2-7)", async () => {
		const agentFile = path.join(rootDir, "agents", "oracle.md");
		await writeFile(agentFile, "---\nname: oracle\n---\n# Oracle\n");

		const syncYaml = {
			path: targetPath,
			agents: {
				platforms: ["claude"],
				items: [
					{
						component: "oracle",
						"add-skills": "my-skill",
					},
				],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		// Should not throw
		await syncCategory(context, "agents", syncYaml as never, adapters, rootDir, targetPath);

		const calls = adapters.getAdapter("claude")!.calls;
		const agentCall = calls.find((c) => c.method === "syncAgentsDirect");
		expect(agentCall).toBeDefined();
		// addSkills (4th arg, index 3) should be absent since scalar was skipped
		const addSkills = agentCall!.args[3] as string[] | undefined;
		expect(addSkills === null || addSkills === undefined || addSkills.length === 0).toBe(true);
	});

	it("warns and skips add-hooks when value is a scalar string (P2-7)", async () => {
		const agentFile = path.join(rootDir, "agents", "oracle.md");
		await writeFile(agentFile, "---\nname: oracle\n---\n# Oracle\n");

		const syncYaml = {
			path: targetPath,
			agents: {
				platforms: ["claude"],
				items: [
					{
						component: "oracle",
						"add-hooks": "my-hook",
					},
				],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		// Should not throw
		await syncCategory(context, "agents", syncYaml as never, adapters, rootDir, targetPath);

		const calls = adapters.getAdapter("claude")!.calls;
		const agentCall = calls.find((c) => c.method === "syncAgentsDirect");
		expect(agentCall).toBeDefined();
		// addHooks (5th arg, index 4) should be absent since scalar was skipped
		const addHooks = agentCall!.args[4] as unknown[] | undefined;
		expect(addHooks === null || addHooks === undefined || addHooks.length === 0).toBe(true);
	});

	it("does not wipe the rules directory (P1-3)", async () => {
		// Create a rule component in rootDir
		await writeFile(path.join(rootDir, "rules", "my-rule.md"), "# My Rule\n");

		// Pre-populate target with a manual rule file
		const claudeRulesDir = path.join(targetPath, ".claude", "rules");
		await fs.mkdir(claudeRulesDir, { recursive: true });
		await writeFile(path.join(claudeRulesDir, "manual-rule.md"), "# Manual\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			rules: {
				platforms: ["claude"],
				items: ["my-rule"],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "rules", syncYaml, adapters, rootDir, targetPath);

		// manual-rule.md must still exist — rules dir is never wiped
		expect(await exists(path.join(claudeRulesDir, "manual-rule.md"))).toBe(true);
	});

	it("does not wipe target directory for unsupported platform×category combo (codex+agents)", async () => {
		// Pre-populate target codex agents dir with a file
		const codexAgentsDir = path.join(targetPath, ".codex", "agents");
		await fs.mkdir(codexAgentsDir, { recursive: true });
		await writeFile(path.join(codexAgentsDir, "existing-agent.md"), "# Existing\n");

		const agentFile = path.join(rootDir, "agents", "oracle.md");
		await writeFile(agentFile, "---\nname: oracle\n---\n# Oracle\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			agents: {
				platforms: ["codex"],
				items: ["oracle"],
			},
		};

		const adapters = makeAdapterMap(["codex"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "agents", syncYaml, adapters, rootDir, targetPath);

		// File must survive — codex does not support agents, so no wipe occurred
		expect(await exists(path.join(codexAgentsDir, "existing-agent.md"))).toBe(true);
		// Adapter must not have been called
		expect(
			adapters.getAdapter("codex")!.calls.filter((c) => c.method === "syncAgentsDirect"),
		).toHaveLength(0);
	});

	it("proceeds with backup+wipe+dispatch for supported platform×category combo (claude+agents)", async () => {
		// Pre-populate target claude agents dir with an orphan file
		const claudeAgentsDir = path.join(targetPath, ".claude", "agents");
		await fs.mkdir(claudeAgentsDir, { recursive: true });
		await writeFile(path.join(claudeAgentsDir, "orphan.md"), "# Orphan\n");

		const agentFile = path.join(rootDir, "agents", "oracle.md");
		await writeFile(agentFile, "---\nname: oracle\n---\n# Oracle\n");

		const syncYaml: SyncYaml = {
			path: targetPath,
			agents: {
				platforms: ["claude"],
				items: ["oracle"],
			},
		};

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		await syncCategory(context, "agents", syncYaml, adapters, rootDir, targetPath);

		// Orphan wiped — claude supports agents
		expect(await exists(path.join(claudeAgentsDir, "orphan.md"))).toBe(false);
		// Adapter called
		expect(adapters.getAdapter("claude")!.calls.some((c) => c.method === "syncAgentsDirect")).toBe(
			true,
		);
	});

	it("SUPPORTED_CATEGORIES covers all 4 platforms with correct categories", async () => {
		// Import the map indirectly by verifying behavior for each platform×category.
		// Supported: claude=all5, opencode=all5, gemini=commands/skills/scripts, codex=skills/scripts
		const expectedSupported: Record<string, Category[]> = {
			claude: ["agents", "commands", "skills", "scripts", "rules"],
			opencode: ["agents", "commands", "skills", "scripts", "rules"],
			gemini: ["commands", "skills", "scripts"],
			codex: ["skills", "scripts"],
		};

		const expectedUnsupported: Record<string, Category[]> = {
			gemini: ["agents", "rules"],
			codex: ["agents", "commands", "rules"],
		};

		for (const [platform, supported] of Object.entries(expectedSupported)) {
			for (const category of supported) {
				// Create a minimal component file for the category
				const componentName = "test-component";
				if (category === "agents" || category === "commands" || category === "rules") {
					await writeFile(
						path.join(rootDir, category, `${componentName}.md`),
						`# ${componentName}\n`,
					);
				} else if (category === "skills") {
					await writeFile(
						path.join(rootDir, "skills", componentName, "SKILL.md"),
						`# ${componentName}\n`,
					);
				} else if (category === "scripts") {
					await writeFile(
						path.join(rootDir, "scripts", componentName, "index.ts"),
						`// ${componentName}\n`,
					);
				}

				const syncYaml: SyncYaml = {
					path: targetPath,
					[category]: { platforms: [platform as Platform], items: [componentName] },
				};

				const adapters = makeAdapterMap([platform as Platform]);
				const context = makeContext({ dryRun: false });

				await syncCategory(context, category as Category, syncYaml, adapters, rootDir, targetPath);

				const methodMap: Record<Category, string> = {
					agents: "syncAgentsDirect",
					commands: "syncCommandsDirect",
					skills: "syncSkillsDirect",
					scripts: "syncScriptsDirect",
					rules: "syncRulesDirect",
				};
				const calls = adapters.getAdapter(platform as Platform)!.calls;
				expect(
					calls.some((c) => c.method === methodMap[category as Category]),
					`${platform}+${category} should be supported`,
				).toBe(true);
			}
		}

		for (const [platform, unsupported] of Object.entries(expectedUnsupported)) {
			for (const category of unsupported) {
				const componentName = "test-component";
				const syncYaml: SyncYaml = {
					path: targetPath,
					[category]: { platforms: [platform as Platform], items: [componentName] },
				};

				const adapters = makeAdapterMap([platform as Platform]);
				const context = makeContext({ dryRun: false });

				await syncCategory(context, category as Category, syncYaml, adapters, rootDir, targetPath);

				const methodMap: Record<Category, string> = {
					agents: "syncAgentsDirect",
					commands: "syncCommandsDirect",
					skills: "syncSkillsDirect",
					scripts: "syncScriptsDirect",
					rules: "syncRulesDirect",
				};
				const calls = adapters.getAdapter(platform as Platform)!.calls;
				expect(
					calls.filter((c) => c.method === methodMap[category as Category]).length,
					`${platform}+${category} should NOT be supported`,
				).toBe(0);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Suite: syncPlatformConfigs
// ---------------------------------------------------------------------------

describe("syncPlatformConfigs", () => {
	let tmpDir: string;
	let rootDir: string;
	let yamlDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-platform-configs-test-"));
		rootDir = path.join(tmpDir, "root");
		yamlDir = path.join(tmpDir, "yamldir");
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(rootDir, { recursive: true });
		await fs.mkdir(yamlDir, { recursive: true });
		await fs.mkdir(targetPath, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("calls `syncPlatformYaml` on claude adapter when claude.yaml is found", async () => {
		await writeFile(path.join(yamlDir, "claude.yaml"), "config:\n  theme: dark\n");

		const adapters = makeAdapterMap(["claude", "gemini"]);
		const context = makeContext();

		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		const calls = adapters.getAdapter("claude")!.calls;
		expect(calls.some((c) => c.method === "syncPlatformYaml")).toBe(true);
		// gemini adapter not called (no gemini.yaml)
		expect(
			adapters.getAdapter("gemini")!.calls.filter((c) => c.method === "syncPlatformYaml"),
		).toHaveLength(0);
	});

	it("rethrows ProjectKeyError instead of swallowing it (local MCP key-derivation must fail loudly)", async () => {
		await writeFile(
			path.join(yamlDir, "claude.yaml"),
			"mcps:\n  notion:\n    url: https://example.com\n",
		);

		const claudeAdapter = makeMockAdapter("claude");
		// Simulate deriveClaudeProjectKey failing inside syncMcpsMerge (branch d).
		claudeAdapter.syncPlatformYaml = async () => {
			throw new ProjectKeyError("/some/target", new Error("dubious ownership"));
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => undefined;

		const context = makeContext();

		// Must NOT be swallowed: the key-derivation failure has to escape the catch.
		await expect(
			syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir),
		).rejects.toBeInstanceOf(ProjectKeyError);
	});

	it("rethrows non-ProjectKeyError per-platform config errors so the worktree is recorded as failed", async () => {
		await writeFile(path.join(yamlDir, "claude.yaml"), "config:\n  theme: dark\n");

		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async () => {
			throw new Error("config write failed");
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => undefined;

		const context = makeContext();

		// A config/hooks/plugins write failure must escape (no longer swallowed) so
		// the per-worktree catch records the deploy root and the CLI exits non-zero.
		await expect(
			syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir),
		).rejects.toThrow("config write failed");
	});

	it("stores model-map in context.modelMaps (P2-1)", async () => {
		await writeFile(path.join(yamlDir, "codex.yaml"), "model-map:\n  claude-3: o3\n");

		const codexAdapter = makeMockAdapter("codex");
		// Override syncPlatformYaml to return a model map
		codexAdapter.syncPlatformYaml = async (_t, _y, _d) => ({
			processedSections: ["model-map"],
			modelMap: { "claude-3": "o3" },
		});

		const adapters = new Map<Platform, PlatformAdapter>([["codex", codexAdapter]]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => undefined;

		const context = makeContext();

		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		expect(context.modelMaps.get("codex")).toEqual({ "claude-3": "o3" });
	});

	it("stores processedSections in context.platformYamlSections", async () => {
		await writeFile(path.join(yamlDir, "gemini.yaml"), "config:\n  key: val\n");

		const geminiAdapter = makeMockAdapter("gemini");
		geminiAdapter.syncPlatformYaml = async (_t, _y, _d) => ({
			processedSections: ["config", "mcps"],
			modelMap: undefined,
		});

		const adapters = new Map<Platform, PlatformAdapter>([
			["gemini", geminiAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => undefined;

		const context = makeContext();

		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		expect(context.platformYamlSections.get("gemini")).toEqual(["config", "mcps"]);
	});

	it("does nothing when no platform YAML files are present", async () => {
		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();

		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
		expect(context.platformYamlSections.size).toBe(0);
	});

	it("resolves hooks component to absolute path before passing to adapter", async () => {
		// Create a real hook file in rootDir
		const hookFile = path.join(rootDir, "hooks", "keyword-detector.sh");
		await writeFile(hookFile, "#!/bin/bash\necho hi\n");

		await writeFile(
			path.join(yamlDir, "claude.yaml"),
			"hooks:\n  UserPromptSubmit:\n    - component: keyword-detector.sh\n      timeout: 10\n",
		);

		const receivedYamls: Record<string, unknown>[] = [];
		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async (_t, yaml, _d) => {
			receivedYamls.push(yaml);
			return { processedSections: ["hooks"], modelMap: undefined };
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => claudeAdapter;

		const context = makeContext();
		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		// The adapter should have received the resolved absolute path
		expect(receivedYamls.length).toBe(1);
		const hooksMap = (receivedYamls[0] as Record<string, unknown>)["hooks"] as Record<
			string,
			Array<Record<string, unknown>>
		>;
		const items = hooksMap["UserPromptSubmit"];
		expect(items).toBeDefined();
		expect(items[0]["component"]).toBe(hookFile);
	});

	it("skips missing hook component with a warning", async () => {
		await writeFile(
			path.join(yamlDir, "claude.yaml"),
			"hooks:\n  UserPromptSubmit:\n    - component: nonexistent-hook.sh\n      timeout: 10\n",
		);

		const receivedYamls: Record<string, unknown>[] = [];
		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async (_t, yaml, _d) => {
			receivedYamls.push(yaml);
			return { processedSections: ["hooks"], modelMap: undefined };
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => claudeAdapter;

		const context = makeContext();
		// Should not throw
		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		// The adapter is still called, but hooks item is removed
		expect(receivedYamls.length).toBe(1);
		const hooksMap = (receivedYamls[0] as Record<string, unknown>)["hooks"] as Record<
			string,
			Array<Record<string, unknown>>
		>;
		const items = hooksMap["UserPromptSubmit"];
		expect(items).toHaveLength(0);
	});

	it("skips empty platform YAML without crashing (P1-2)", async () => {
		// Empty file — parseYaml returns null
		await writeFile(path.join(yamlDir, "claude.yaml"), "");

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();

		// Should not throw
		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		// adapter never called because file was skipped
		expect(
			adapters.getAdapter("claude")!.calls.filter((c) => c.method === "syncPlatformYaml"),
		).toHaveLength(0);
	});

	it("passes 'user' scope for root yaml", async () => {
		await writeFile(path.join(yamlDir, "claude.yaml"), "config:\n  theme: dark\n");

		const receivedScopes: Array<string | undefined> = [];
		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async (_t, _y, _d, scope) => {
			receivedScopes.push(scope);
			return { processedSections: ["config"], modelMap: undefined };
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => claudeAdapter;

		const context = makeContext({ isRootYaml: true });
		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		expect(receivedScopes).toEqual(["user"]);
	});

	it("passes 'project' scope for project yaml", async () => {
		await writeFile(path.join(yamlDir, "claude.yaml"), "config:\n  theme: dark\n");

		const receivedScopes: Array<string | undefined> = [];
		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async (_t, _y, _d, scope) => {
			receivedScopes.push(scope);
			return { processedSections: ["config"], modelMap: undefined };
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => claudeAdapter;

		const context = makeContext({ isRootYaml: false });
		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		expect(receivedScopes).toEqual(["project"]);
	});

	it("claude.local.yaml가 claude.yaml과 병합되어 어댑터에 전달된다", async () => {
		await writeFile(path.join(yamlDir, "claude.yaml"), "config:\n  theme: dark\n  lang: en\n");
		await writeFile(path.join(yamlDir, "claude.local.yaml"), "config:\n  theme: light\n");

		const receivedYamls: Record<string, unknown>[] = [];
		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async (_t, yaml, _d) => {
			receivedYamls.push(yaml as Record<string, unknown>);
			return { processedSections: ["config"], modelMap: undefined };
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => claudeAdapter;

		const context = makeContext();
		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		expect(receivedYamls).toHaveLength(1);
		expect(receivedYamls[0]).toEqual({ config: { theme: "light", lang: "en" } });
	});

	it("local 파일만 있어도 어댑터가 정상 호출된다", async () => {
		await writeFile(path.join(yamlDir, "gemini.local.yaml"), "config:\n  key: val\n");

		const receivedYamls: Record<string, unknown>[] = [];
		const geminiAdapter = makeMockAdapter("gemini");
		geminiAdapter.syncPlatformYaml = async (_t, yaml, _d) => {
			receivedYamls.push(yaml as Record<string, unknown>);
			return { processedSections: ["config"], modelMap: undefined };
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["gemini", geminiAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => geminiAdapter;

		const context = makeContext();
		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		expect(receivedYamls).toHaveLength(1);
		expect(receivedYamls[0]).toEqual({ config: { key: "val" } });
	});

	it("어댑터는 병합된 값으로 단 한 번만 호출된다 — base만으로 별도 호출 없음", async () => {
		await writeFile(path.join(yamlDir, "claude.yaml"), "config:\n  theme: dark\n");
		await writeFile(path.join(yamlDir, "claude.local.yaml"), "config:\n  theme: light\n");

		const receivedYamls: Record<string, unknown>[] = [];
		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async (_t, yaml, _d) => {
			receivedYamls.push(yaml as Record<string, unknown>);
			return { processedSections: ["config"], modelMap: undefined };
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => claudeAdapter;

		const context = makeContext();
		await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

		expect(receivedYamls).toHaveLength(1);
		expect(receivedYamls[0]).toMatchObject({ config: { theme: "light" } });
	});

	it("프로젝트 스코프와 루트 스코프가 독립적으로 병합된다 — 크로스 스코프 오염 없음", async () => {
		const rootYamlDir = path.join(tmpDir, "root-yaml");
		const projectYamlDir = path.join(tmpDir, "project-yaml");
		await fs.mkdir(rootYamlDir, { recursive: true });
		await fs.mkdir(projectYamlDir, { recursive: true });

		await writeFile(path.join(rootYamlDir, "claude.yaml"), "config:\n  source: root-base\n");
		await writeFile(path.join(rootYamlDir, "claude.local.yaml"), "config:\n  rootLocal: true\n");
		await writeFile(path.join(projectYamlDir, "claude.yaml"), "config:\n  source: project-base\n");
		await writeFile(
			path.join(projectYamlDir, "claude.local.yaml"),
			"config:\n  projectLocal: true\n",
		);

		const rootReceived: Record<string, unknown>[] = [];
		const projectReceived: Record<string, unknown>[] = [];

		const rootClaudeAdapter = makeMockAdapter("claude");
		rootClaudeAdapter.syncPlatformYaml = async (_t, yaml, _d) => {
			rootReceived.push(yaml as Record<string, unknown>);
			return { processedSections: ["config"], modelMap: undefined };
		};

		const projectClaudeAdapter = makeMockAdapter("claude");
		projectClaudeAdapter.syncPlatformYaml = async (_t, yaml, _d) => {
			projectReceived.push(yaml as Record<string, unknown>);
			return { processedSections: ["config"], modelMap: undefined };
		};

		const rootAdapters = new Map<Platform, PlatformAdapter>([
			["claude", rootClaudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		rootAdapters.getAdapter = (_p: Platform) => rootClaudeAdapter;

		const projectAdapters = new Map<Platform, PlatformAdapter>([
			["claude", projectClaudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		projectAdapters.getAdapter = (_p: Platform) => projectClaudeAdapter;

		const rootContext = makeContext({ isRootYaml: true });
		await syncPlatformConfigs(rootContext, targetPath, rootYamlDir, rootAdapters, rootDir);

		const projectContext = makeContext({ isRootYaml: false });
		await syncPlatformConfigs(projectContext, targetPath, projectYamlDir, projectAdapters, rootDir);

		expect(rootReceived).toHaveLength(1);
		expect(rootReceived[0]).toEqual({ config: { source: "root-base", rootLocal: true } });
		expect(
			(rootReceived[0] as Record<string, Record<string, unknown>>)["config"]["projectLocal"],
		).toBeUndefined();

		expect(projectReceived).toHaveLength(1);
		expect(projectReceived[0]).toEqual({ config: { source: "project-base", projectLocal: true } });
		expect(
			(projectReceived[0] as Record<string, Record<string, unknown>>)["config"]["rootLocal"],
		).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Suite: processYaml
// ---------------------------------------------------------------------------

describe("processYaml", () => {
	let tmpDir: string;
	let rootDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "process-yaml-test-"));
		rootDir = path.join(tmpDir, "root");
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(path.join(rootDir, "skills"), { recursive: true });
		await fs.mkdir(targetPath, { recursive: true });
		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	it("calls `syncPlatformConfigs` first then processes all categories", async () => {
		// Create a claude.yaml to trigger syncPlatformConfigs
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(syncYamlPath, `path: ${targetPath}\n`);
		await writeFile(path.join(rootDir, "claude.yaml"), "config:\n  theme: dark\n");

		const claudeAdapter = makeMockAdapter("claude");
		const platformYamlCalls: string[] = [];
		claudeAdapter.syncPlatformYaml = async (_t, _y, _d) => {
			platformYamlCalls.push("syncPlatformYaml");
			return { processedSections: ["config"], modelMap: undefined };
		};

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => claudeAdapter;

		const context = makeContext();

		await processYaml(context, syncYamlPath, adapters, rootDir);

		// syncPlatformConfigs should have been called (claude.yaml exists)
		expect(platformYamlCalls.length).toBeGreaterThan(0);
	});

	it("does not process config/hooks/mcps/plugins sections in sync.yaml (P2-3)", async () => {
		// sync.yaml with config/hooks/mcps/plugins sections (should all be ignored)
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		const yamlContent = `path: ${targetPath}\nconfig:\n  theme: dark\nhooks:\n  items: []\nmcps:\n  items: []\nplugins:\n  items: []\n`;
		await writeFile(syncYamlPath, yamlContent);

		const claudeAdapter = makeMockAdapter("claude");
		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", claudeAdapter],
		]) as AdapterMap & {
			getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
		};
		adapters.getAdapter = (_p: Platform) => claudeAdapter;

		const context = makeContext();

		// Should not throw
		await processYaml(context, syncYamlPath, adapters, rootDir);

		// No calls related to config/hooks/mcps/plugins processing
		const calls = claudeAdapter.calls;
		expect(calls.filter((c) => c.method === "syncHooksDirect")).toHaveLength(0);
	});

	it("skips sync.yaml without path field with a warning", async () => {
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(syncYamlPath, "agents:\n  items: [oracle]\n");

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();

		// Should not throw
		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
	});

	it("skips nonexistent sync.yaml with a warning", async () => {
		const missingPath = path.join(rootDir, "nonexistent.yaml");

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();

		await processYaml(context, missingPath, adapters, rootDir);

		expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
	});

	it("syncs skill items to the correct adapter", async () => {
		const skillDir = path.join(rootDir, "skills", "oracle");
		await fs.mkdir(skillDir, { recursive: true });
		await writeFile(path.join(skillDir, "SKILL.md"), "# Oracle\n");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${targetPath}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const claudeAdapter = makeMockAdapter("claude");
		const adapters = new Map<Platform, PlatformAdapter>([["claude", claudeAdapter]]) as AdapterMap;

		const context = makeContext();

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(claudeAdapter.calls.some((c) => c.method === "syncSkillsDirect")).toBe(true);
	});

	it("returns without crashing on empty sync.yaml (P1-1)", async () => {
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		// Empty file — parseYaml returns null
		await writeFile(syncYamlPath, "");

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();

		// Should not throw
		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
	});

	it("returns without crashing on comment-only sync.yaml (P1-1)", async () => {
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		// Comment-only file — parseYaml returns null
		await writeFile(syncYamlPath, "# just a comment\n");

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();

		// Should not throw
		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
	});

	it("`~/relative` 형태의 path를 homedir 기반 절대경로로 expand하여 처리한다", async () => {
		const originalHome = process.env.HOME;
		const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "omt-fake-home-"));
		process.env.HOME = fakeHome;
		try {
			// Create target directory inside fakeHome so tilde form is meaningful
			const homeTmpDir = await fs.mkdtemp(path.join(fakeHome, "omt-tilde-test-"));
			try {
				// Write sync.yaml using tilde form of the target path, with a skill
				// so that processYaml deploys into .claude/ — confirming tilde expansion.
				const relativePart = path.relative(os.homedir(), homeTmpDir);
				const tildePath = `~/${relativePart}`;

				// Create a skill source so the component section is non-empty
				const skillDir = path.join(rootDir, "skills", "oracle");
				await fs.mkdir(skillDir, { recursive: true });
				await writeFile(path.join(skillDir, "SKILL.md"), "# Oracle\n");

				const syncYamlPath = path.join(rootDir, "sync.yaml");
				await writeFile(
					syncYamlPath,
					`path: "${tildePath}"\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
				);

				const adapters = makeAdapterMap(["claude"]);
				const context = makeContext();

				await processYaml(context, syncYamlPath, adapters, rootDir);

				// processYaml creates .claude/ inside the expanded target path when not dry-run
				const claudeDir = path.join(homeTmpDir, ".claude");
				expect(await exists(claudeDir)).toBe(true);
			} finally {
				await fs.rm(homeTmpDir, { recursive: true, force: true });
			}
		} finally {
			if (originalHome === undefined) delete process.env.HOME;
			else process.env.HOME = originalHome;
			await fs.rm(fakeHome, { recursive: true, force: true });
		}
	});

	it("`~/relative` path를 가진 sync.yaml의 skill이 syncCategory 내부에서도 expanded path로 dispatch된다", async () => {
		const originalHome = process.env.HOME;
		const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "omt-fake-home-"));
		process.env.HOME = fakeHome;
		try {
			const homeTmpDir = await fs.mkdtemp(path.join(fakeHome, "omt-tilde-skill-test-"));
			try {
				const relativePart = path.relative(os.homedir(), homeTmpDir);
				const tildePath = `~/${relativePart}`;

				// Create a skill source
				const skillDir = path.join(rootDir, "skills", "oracle");
				await fs.mkdir(skillDir, { recursive: true });
				await writeFile(path.join(skillDir, "SKILL.md"), "# Oracle\n");

				const syncYamlPath = path.join(rootDir, "sync.yaml");
				await writeFile(
					syncYamlPath,
					`path: "${tildePath}"\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
				);

				const claudeAdapter = makeMockAdapter("claude");
				const adapters = new Map<Platform, PlatformAdapter>([
					["claude", claudeAdapter],
				]) as AdapterMap & {
					getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
				};
				adapters.getAdapter = (_p: Platform) => claudeAdapter;

				const context = makeContext();
				await processYaml(context, syncYamlPath, adapters, rootDir);

				// syncSkillsDirect must have been called with the expanded (absolute) path, not the tilde path
				const skillCalls = claudeAdapter.calls.filter((c) => c.method === "syncSkillsDirect");
				expect(skillCalls.length).toBeGreaterThan(0);
				const calledWithPath = skillCalls[0]!.args[0] as string;
				expect(calledWithPath).toBe(homeTmpDir);
				expect(calledWithPath.startsWith("~")).toBe(false);
			} finally {
				await fs.rm(homeTmpDir, { recursive: true, force: true });
			}
		} finally {
			if (originalHome === undefined) delete process.env.HOME;
			else process.env.HOME = originalHome;
			await fs.rm(fakeHome, { recursive: true, force: true });
		}
	});

	it("mcp-only skips claude dir", async () => {
		// --- MCP-only fixture: claude.yaml has only `mcps`, sync.yaml has no component sections ---
		const mcpOnlyTargetPath = path.join(tmpDir, "mcp-only-target");
		await fs.mkdir(mcpOnlyTargetPath, { recursive: true });

		const mcpOnlyRootDir = path.join(tmpDir, "mcp-only-root");
		await fs.mkdir(mcpOnlyRootDir, { recursive: true });
		await writeFile(path.join(mcpOnlyRootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
		// sync.yaml lives in mcpOnlyRootDir so yamlDir = mcpOnlyRootDir — place claude.yaml there
		await writeFile(
			path.join(mcpOnlyRootDir, "claude.yaml"),
			"mcps:\n  my-server:\n    type: stdio\n    command: my-mcp\n",
		);
		const mcpOnlySyncYaml = path.join(mcpOnlyRootDir, "sync.yaml");
		await writeFile(mcpOnlySyncYaml, `path: ${mcpOnlyTargetPath}\n`);

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: false });

		await processYaml(context, mcpOnlySyncYaml, adapters, mcpOnlyRootDir);

		// .claude/ must NOT be created for MCP-only project (nothing deploys into it)
		expect(await exists(path.join(mcpOnlyTargetPath, ".claude"))).toBe(false);

		// --- Component-bearing fixture: regression guard — .claude/ must still be created ---
		const compTargetPath = path.join(tmpDir, "comp-target");
		await fs.mkdir(compTargetPath, { recursive: true });
		const compRootDir = path.join(tmpDir, "comp-root");
		await fs.mkdir(compRootDir, { recursive: true });
		await writeFile(path.join(compRootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
		const skillDir = path.join(compRootDir, "skills", "oracle");
		await fs.mkdir(skillDir, { recursive: true });
		await writeFile(path.join(skillDir, "SKILL.md"), "# Oracle\n");
		const compSyncYaml = path.join(compRootDir, "sync.yaml");
		await writeFile(
			compSyncYaml,
			`path: ${compTargetPath}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters2 = makeAdapterMap(["claude"]);
		const context2 = makeContext({ dryRun: false });

		await processYaml(context2, compSyncYaml, adapters2, compRootDir);

		// .claude/ must be created when component items are present
		expect(await exists(path.join(compTargetPath, ".claude"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Suite: 처리 순서 (projects first, root second, Set dedup)
// ---------------------------------------------------------------------------

describe("처리 순서 및 중복 제거", () => {
	it("processedPaths Set prevents duplicate processing", async () => {
		// Simulate Set dedup: same path in both projects and root
		const context = makeContext();
		const targetPath = "/some/target/path";

		context.processedPaths.add(targetPath);

		// processedPaths.has should detect the duplicate
		expect(context.processedPaths.has(targetPath)).toBe(true);
	});

	it("`createContext` initializes with empty processedPaths", () => {
		const context = createContext(false);
		expect(context.processedPaths.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: 프로젝트별 오류 격리 (P1-5)
// ---------------------------------------------------------------------------

describe("프로젝트별 오류 격리", () => {
	let tmpDir: string;
	let rootDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-isolation-test-"));
		rootDir = path.join(tmpDir, "root");
		await fs.mkdir(path.join(rootDir, "projects", "proj-a"), { recursive: true });
		await fs.mkdir(path.join(rootDir, "projects", "proj-b"), { recursive: true });
		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	it("continues processing remaining projects when one project fails (P1-5)", async () => {
		const targetA = path.join(tmpDir, "target-a");
		const targetB = path.join(tmpDir, "target-b");
		await fs.mkdir(targetA, { recursive: true });
		await fs.mkdir(targetB, { recursive: true });

		// proj-a: valid sync.yaml pointing to targetA
		await writeFile(path.join(rootDir, "projects", "proj-a", "sync.yaml"), `path: ${targetA}\n`);
		// proj-b: valid sync.yaml pointing to targetB
		await writeFile(path.join(rootDir, "projects", "proj-b", "sync.yaml"), `path: ${targetB}\n`);

		// Track processYaml calls by intercepting via a spy on processedPaths
		const processedTargets: string[] = [];
		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();

		// Monkey-patch processedPaths.add to record targets
		const originalAdd = context.processedPaths.add.bind(context.processedPaths);
		context.processedPaths.add = (value: string) => {
			processedTargets.push(value);
			return originalAdd(value);
		};

		// Simulate the CLI projects loop with per-project try/catch
		const projectsDir = path.join(rootDir, "projects");
		const { existsSync: existsSyncReal } = await import("fs");
		const projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });

		for (const entry of projectEntries) {
			if (!entry.isDirectory()) continue;
			const projectSyncYaml = path.join(projectsDir, entry.name, "sync.yaml");
			if (!existsSyncReal(projectSyncYaml)) continue;

			let syncYaml: SyncYaml;
			try {
				const text = await fs.readFile(projectSyncYaml, "utf8");
				const parsed = parseYaml(text);
				if (parsed === null || parsed === undefined || typeof parsed !== "object") continue;
				syncYaml = parsed as SyncYaml;
			} catch {
				continue;
			}

			const targetPath = syncYaml.path;
			if (!targetPath) continue;

			try {
				await processYaml(context, projectSyncYaml, adapters, rootDir);
				context.processedPaths.add(targetPath);
			} catch {
				// per-project isolation: continue to next project
			}
		}

		// Both projects should have been processed despite any individual failure
		expect(processedTargets).toContain(targetA);
		expect(processedTargets).toContain(targetB);
	});
});

// ---------------------------------------------------------------------------
// Suite: modelMaps 크로스 프로젝트 누수 방지 (P1-A)
// ---------------------------------------------------------------------------

describe("modelMaps 크로스 프로젝트 누수 방지", () => {
	let tmpDir: string;
	let rootDir: string;
	let target1: string;
	let target2: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "model-maps-leak-test-"));
		rootDir = path.join(tmpDir, "root");
		target1 = path.join(tmpDir, "target1");
		target2 = path.join(tmpDir, "target2");
		await fs.mkdir(rootDir, { recursive: true });
		await fs.mkdir(target1, { recursive: true });
		await fs.mkdir(target2, { recursive: true });
		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	it("does not leak modelMap from first `processYaml` call into second call", async () => {
		// First sync.yaml: has a claude.yaml with model-map
		const syncYaml1Dir = path.join(tmpDir, "yaml1");
		await fs.mkdir(syncYaml1Dir, { recursive: true });
		const syncYaml1Path = path.join(syncYaml1Dir, "sync.yaml");
		await writeFile(syncYaml1Path, `path: ${target1}\n`);

		// Second sync.yaml: no claude.yaml (no model-map)
		const syncYaml2Dir = path.join(tmpDir, "yaml2");
		await fs.mkdir(syncYaml2Dir, { recursive: true });
		const syncYaml2Path = path.join(syncYaml2Dir, "sync.yaml");
		await writeFile(syncYaml2Path, `path: ${target2}\n`);

		// Mock claude adapter: first call returns model-map, second returns nothing
		let callCount = 0;
		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async (_t, _y, _d) => {
			callCount++;
			if (callCount === 1) {
				return { processedSections: ["model-map"], modelMap: { "claude-3": "o3" } };
			}
			return { processedSections: [], modelMap: undefined };
		};

		// Place a claude.yaml only in yaml1Dir
		await writeFile(path.join(syncYaml1Dir, "claude.yaml"), "model-map:\n  claude-3: o3\n");

		const adapters = new Map<Platform, PlatformAdapter>([["claude", claudeAdapter]]) as AdapterMap;

		const context = makeContext();

		// First processYaml: populates modelMaps
		await processYaml(context, syncYaml1Path, adapters, rootDir);
		expect(context.modelMaps.get("claude")).toEqual({ "claude-3": "o3" });

		// Second processYaml: no claude.yaml → should clear modelMaps
		await processYaml(context, syncYaml2Path, adapters, rootDir);
		expect(context.modelMaps.get("claude")).toBeUndefined();
		expect(context.modelMaps.size).toBe(0);
	});

	it("does not leak platformYamlSections from first `processYaml` call into second call", async () => {
		const syncYaml1Dir = path.join(tmpDir, "yaml1");
		await fs.mkdir(syncYaml1Dir, { recursive: true });
		const syncYaml1Path = path.join(syncYaml1Dir, "sync.yaml");
		await writeFile(syncYaml1Path, `path: ${target1}\n`);

		const syncYaml2Dir = path.join(tmpDir, "yaml2");
		await fs.mkdir(syncYaml2Dir, { recursive: true });
		const syncYaml2Path = path.join(syncYaml2Dir, "sync.yaml");
		await writeFile(syncYaml2Path, `path: ${target2}\n`);

		let callCount = 0;
		const claudeAdapter = makeMockAdapter("claude");
		claudeAdapter.syncPlatformYaml = async (_t, _y, _d) => {
			callCount++;
			if (callCount === 1) {
				return { processedSections: ["config", "mcps"], modelMap: undefined };
			}
			return { processedSections: [], modelMap: undefined };
		};

		await writeFile(path.join(syncYaml1Dir, "claude.yaml"), "config:\n  theme: dark\n");

		const adapters = new Map<Platform, PlatformAdapter>([["claude", claudeAdapter]]) as AdapterMap;
		const context = makeContext();

		await processYaml(context, syncYaml1Path, adapters, rootDir);
		expect(context.platformYamlSections.get("claude")).toEqual(["config", "mcps"]);

		await processYaml(context, syncYaml2Path, adapters, rootDir);
		expect(context.platformYamlSections.get("claude")).toBeUndefined();
		expect(context.platformYamlSections.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: 루트 sync.yaml processedPaths 추가 (P1-B)
// ---------------------------------------------------------------------------

describe("루트 sync.yaml processedPaths 추가", () => {
	let tmpDir: string;
	let rootDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "processed-paths-root-test-"));
		rootDir = path.join(tmpDir, "root");
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(rootDir, { recursive: true });
		await fs.mkdir(targetPath, { recursive: true });
		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	it("dedup works when caller adds targetPath to processedPaths after `processYaml`", async () => {
		// This test mirrors the CLI pattern: processYaml runs, then caller adds targetPath.
		// Verifies the fix: root sync.yaml targetPath is tracked in processedPaths.
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(syncYamlPath, `path: ${targetPath}\n`);

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();

		// CLI pattern: processYaml then add targetPath to processedPaths
		await processYaml(context, syncYamlPath, adapters, rootDir);
		context.processedPaths.add(targetPath);

		// After the fix, root targetPath is now in processedPaths
		expect(context.processedPaths.has(targetPath)).toBe(true);
		// Cleanup loop would now include this path
		expect(context.processedPaths.size).toBe(1);
	});

	it("backup cleanup loop does not run when processedPaths is empty", async () => {
		// Before fix: processedPaths was empty after root sync.yaml processing
		// This test documents the pre-fix state (empty set)
		const context = makeContext();
		expect(context.processedPaths.size).toBe(0);
		// No cleanup targets — correct behavior after fix is non-empty
	});
});

// ---------------------------------------------------------------------------
// Suite: syncLib
// ---------------------------------------------------------------------------

describe("syncLib", () => {
	let tmpDir: string;
	let rootDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-lib-test-"));
		rootDir = path.join(tmpDir, "root");
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(rootDir, { recursive: true });
		await fs.mkdir(targetPath, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("does nothing when lib/ directory does not exist", async () => {
		const context = makeContext();

		await syncLib(context, targetPath, rootDir, ["claude"]);

		// No .claude/lib created
		expect(await exists(path.join(targetPath, ".claude", "lib"))).toBe(false);
	});

	it("deploys only required lib modules to platform target via `syncLib`", async () => {
		const libSrc = path.join(rootDir, "lib");
		await fs.mkdir(libSrc, { recursive: true });
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");
		await writeFile(path.join(libSrc, "unused.ts"), "export const y = 2;\n");

		// A SOURCE component .ts that imports @lib/helper. syncLib scans source
		// roots (production deployed .ts no longer carries raw @lib/).
		const sourceTs = path.join(rootDir, "skills", "oracle", "run.ts");
		await writeFile(sourceTs, "import { x } from '@lib/helper';\n");

		const context = makeContext();

		await syncLib(context, targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		// helper.ts should be copied (imported by the source component)
		expect(await exists(path.join(targetPath, ".claude", "lib", "helper.ts"))).toBe(true);
		// unused.ts should NOT be copied (not imported anywhere)
		expect(await exists(path.join(targetPath, ".claude", "lib", "unused.ts"))).toBe(false);
	});

	it("skips lib/ copy entirely when no @lib/ imports exist in platform dir", async () => {
		const libSrc = path.join(rootDir, "lib");
		await fs.mkdir(libSrc, { recursive: true });
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

		// A SOURCE component .ts with NO @lib/ imports
		const sourceTs = path.join(rootDir, "skills", "simple", "run.ts");
		await writeFile(sourceTs, "export const hello = 'world';\n");

		const context = makeContext();

		await syncLib(context, targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		// lib/ directory should NOT be created
		expect(await exists(path.join(targetPath, ".claude", "lib"))).toBe(false);
	});

	it("removes stale lib/ directory when no @lib/ imports exist after previous sync", async () => {
		const libSrc = path.join(rootDir, "lib");
		await fs.mkdir(libSrc, { recursive: true });
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

		// Simulate stale lib from a previous sync
		const staleDest = path.join(targetPath, ".claude", "lib");
		await fs.mkdir(staleDest, { recursive: true });
		await writeFile(path.join(staleDest, "helper.ts"), "export const x = 1;\n");

		// A SOURCE component .ts with NO @lib/ imports
		const sourceTs = path.join(rootDir, "skills", "simple", "run.ts");
		await writeFile(sourceTs, "export const hello = 'world';\n");

		const context = makeContext();

		await syncLib(context, targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		// Stale lib/ directory should be removed
		expect(await exists(path.join(targetPath, ".claude", "lib"))).toBe(false);
	});

	it("excludes *.test.ts files from lib deployment", async () => {
		const libSrc = path.join(rootDir, "lib");
		await fs.mkdir(libSrc, { recursive: true });
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");
		await writeFile(path.join(libSrc, "helper.test.ts"), "// test file\n");

		// A SOURCE component that imports helper
		const sourceTs = path.join(rootDir, "skills", "oracle", "run.ts");
		await writeFile(sourceTs, "import { x } from '@lib/helper';\n");

		const context = makeContext();

		await syncLib(context, targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		const testFile = path.join(targetPath, ".claude", "lib", "helper.test.ts");
		expect(await exists(testFile)).toBe(false);
	});

	it("does not copy files in dry-run mode", async () => {
		const libSrc = path.join(rootDir, "lib");
		await fs.mkdir(libSrc, { recursive: true });
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

		// A SOURCE component .ts with @lib/ import so requiredModules is non-empty
		// and the dry-run logDry branch is exercised.
		const sourceTs = path.join(rootDir, "scripts", "test-script", "run.ts");
		await writeFile(sourceTs, "import { x } from '@lib/helper';\n");

		const context = makeContext({ dryRun: true });

		await syncLib(context, targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		// dry-run: lib file must NOT have been copied
		expect(await exists(path.join(targetPath, ".claude", "lib", "helper.ts"))).toBe(false);
	});

	it("`processYaml` uses syncYaml.platforms cascade to determine `syncLib` platforms (P2-4)", async () => {
		// syncYaml.platforms = [gemini] → resolvePlatforms level-3 cascade picks gemini
		const libSrc = path.join(rootDir, "lib");
		await fs.mkdir(libSrc, { recursive: true });
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

		// A SOURCE skill that bundles a .ts importing @lib/helper. Because the skill
		// is synced to [gemini], processYaml records its source under gemini only,
		// so syncLib deploys lib to .gemini/ (cascade), not .claude/.
		await writeFile(
			path.join(rootDir, "skills", "oracle", "SKILL.md"),
			"---\nname: oracle\ndescription: t\n---\nbody\n",
		);
		await writeFile(
			path.join(rootDir, "skills", "oracle", "run.ts"),
			"import { x } from '@lib/helper';\n",
		);

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		// Top-level platforms: [gemini] — cascade level 3 should override the old hardcoded ["claude"]
		await writeFile(
			syncYamlPath,
			`path: ${targetPath}\nplatforms: [gemini]\nskills:\n  items:\n    - oracle\n`,
		);

		const adapters = makeAdapterMap(["claude", "gemini"]);
		const context = makeContext();

		await processYaml(context, syncYamlPath, adapters, rootDir);

		// lib should be deployed to gemini (syncYaml.platforms cascade), not claude
		expect(await exists(path.join(targetPath, ".gemini", "lib", "helper.ts"))).toBe(true);
		expect(await exists(path.join(targetPath, ".claude", "lib", "helper.ts"))).toBe(false);
	});

	it("deploys traced static data files (import.meta.dir) but not unreferenced ones via `syncLib`", async () => {
		const libSrc = path.join(rootDir, "lib");
		// A lib module that statically references a sibling data file via import.meta.dir.
		await writeFile(
			path.join(libSrc, "foo", "x.ts"),
			'import { join } from "path";\nconst P = join(import.meta.dir, "data.yaml");\nexport const x = P;\n',
		);
		// The referenced data file (should deploy) and an unreferenced sibling (should not).
		await writeFile(path.join(libSrc, "foo", "data.yaml"), "key: value\n");
		await writeFile(path.join(libSrc, "foo", "other.yaml"), "key: other\n");

		// A SOURCE component that imports the lib module, so it is collected for deployment.
		const sourceTs = path.join(rootDir, "skills", "oracle", "run.ts");
		await writeFile(sourceTs, "import { x } from '@lib/foo/x';\n");

		const context = makeContext();

		await syncLib(context, targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		const libDest = path.join(targetPath, ".claude", "lib");
		// The .ts module deploys (existing behavior, structure preserved).
		expect(await exists(path.join(libDest, "foo", "x.ts"))).toBe(true);
		// The referenced data file deploys, preserving directory structure.
		expect(await exists(path.join(libDest, "foo", "data.yaml"))).toBe(true);
		// The unreferenced data file does NOT deploy (no directory sweep).
		expect(await exists(path.join(libDest, "foo", "other.yaml"))).toBe(false);
	});

	it("skips lib entirely in dry-run when no @lib/ imports exist, even if data files exist in lib source tree", async () => {
		const libSrc = path.join(rootDir, "lib");
		// A lib module that statically references a sibling data file via import.meta.dir,
		// plus the data file itself. This is traced from the SOURCE tree, independent of
		// whatever the deployed .claude/ tree imports.
		await writeFile(
			path.join(libSrc, "pins", "store.ts"),
			'import { join } from "path";\nexport const P = join(import.meta.dir, "tbox.yaml");\n',
		);
		await writeFile(path.join(libSrc, "pins", "tbox.yaml"), "schema: 1\n");

		// The component sources have NO @lib/ imports → requiredModules is empty.
		// With zero modules, data files have no consumer — the whole lib deploy is
		// skipped (requiredModules === 0 takes the skip path regardless of dataFiles).
		const sourceTs = path.join(rootDir, "skills", "plain", "run.ts");
		await writeFile(sourceTs, "export const hello = 'world';\n");

		const lines: string[] = [];
		const origStderr = process.stderr.write.bind(process.stderr);
		process.stderr.write = (chunk: string | Uint8Array) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		};
		const context = makeContext({ dryRun: true });
		try {
			await syncLib(context, targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));
		} finally {
			process.stderr.write = origStderr;
		}

		// Zero modules → skip path taken: no "Deploy lib modules" line and no tbox.yaml
		// listed in the dry-run output. The skip-path logInfo line is the only output.
		expect(lines.some((l) => l.includes("Deploy lib modules"))).toBe(false);
		expect(lines.some((l) => l.includes(path.join("pins", "tbox.yaml")))).toBe(false);
		expect(lines.some((l) => l.includes("skipping lib deployment"))).toBe(true);
	});

	it("rewrites @lib/* import aliases to relative paths via `syncLib`", async () => {
		const libSrc = path.join(rootDir, "lib");
		await fs.mkdir(libSrc, { recursive: true });
		await writeFile(path.join(libSrc, "types.ts"), "export type X = string;\n");

		// A SOURCE component drives lib collection so the build+rewrite phase runs.
		const sourceTs = path.join(rootDir, "skills", "oracle", "run.ts");
		await writeFile(sourceTs, "import { X } from '@lib/types.ts';\n");

		// Plant a deployed .ts still carrying raw @lib/ (e.g. not rewritten at copy
		// time) — the rewriteLibAliases post-pass must rewrite it in place.
		const agentsDir = path.join(targetPath, ".claude", "agents");
		await fs.mkdir(agentsDir, { recursive: true });
		await writeFile(path.join(agentsDir, "oracle.ts"), "import { X } from '@lib/types.ts';\n");

		const context = makeContext();

		await syncLib(context, targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		const rewritten = await readFile(path.join(agentsDir, "oracle.ts"));
		// agents/ is one level deep, so prefix should be ../
		expect(rewritten).toContain("../lib/types.ts");
		expect(rewritten).not.toContain("@lib/");
	});

	it("leaves original lib intact when mid-build copy fails (atomic swap)", async () => {
		// Arrange: a pre-existing deployed lib with known content.
		const libSrc = path.join(rootDir, "lib");
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

		// A SOURCE component imports @lib/helper — drives collection for both syncs.
		const sourceTs = path.join(rootDir, "skills", "oracle", "run.ts");
		await writeFile(sourceTs, "import { x } from '@lib/helper';\n");
		const roots = libRoots("claude", sourceTs);

		// First sync: establishes the deployed lib.
		await syncLib(makeContext(), targetPath, rootDir, ["claude"], roots);
		const libDest = path.join(targetPath, ".claude", "lib");
		expect(await exists(path.join(libDest, "helper.ts"))).toBe(true);
		const originalContent = await readFile(path.join(libDest, "helper.ts"));

		// Sabotage: replace source file with a directory so fs.copyFile throws EISDIR.
		await fs.rm(path.join(libSrc, "helper.ts"));
		await fs.mkdir(path.join(libSrc, "helper.ts")); // directory masquerading as file

		// Act: second sync will fail during the temp-dir build phase.
		let threw = false;
		try {
			await syncLib(makeContext(), targetPath, rootDir, ["claude"], roots);
		} catch {
			threw = true;
		}

		// The build should have thrown (copy-to-temp fails on EISDIR).
		expect(threw).toBe(true);

		// Assert: the deployed lib at its FINAL path still has the original module.
		// On pre-fix code this fails because the wipe happened before the copy attempt.
		expect(await exists(libDest)).toBe(true);
		expect(await exists(path.join(libDest, "helper.ts"))).toBe(true);
		const contentAfter = await readFile(path.join(libDest, "helper.ts"));
		expect(contentAfter).toBe(originalContent);
	});

	it("cleans up lib.tmp-* sibling on successful sync (no temp dir residue)", async () => {
		const libSrc = path.join(rootDir, "lib");
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

		const sourceTs = path.join(rootDir, "skills", "oracle", "run.ts");
		await writeFile(sourceTs, "import { x } from '@lib/helper';\n");

		await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		// No lib.tmp-* directories should remain next to the deployed lib.
		const platformDir = path.join(targetPath, ".claude");
		const entries = await fs.readdir(platformDir);
		const tempLeftovers = entries.filter((e) => e.startsWith("lib.tmp-"));
		expect(tempLeftovers).toHaveLength(0);
	});

	// Regression (a): zero-module target → no lib dir, no tbox.yaml
	it("제로 @lib 모듈 타겟: lib 디렉토리와 tbox.yaml 모두 배포하지 않음 via `syncLib`", async () => {
		const libSrc = path.join(rootDir, "lib");
		// tbox.yaml exists in lib source tree (it would be a data file if any module imported it)
		await writeFile(
			path.join(libSrc, "pins", "store.ts"),
			'import { join } from "path";\nexport const P = join(import.meta.dir, "tbox.yaml");\n',
		);
		await writeFile(path.join(libSrc, "pins", "tbox.yaml"), "schema: 1\n");

		// Component has NO @lib/ imports → requiredModules will be empty
		const sourceTs = path.join(rootDir, "skills", "no-lib", "run.ts");
		await writeFile(sourceTs, "export const hello = 'world';\n");

		await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		// Zero modules → skip path: no lib directory created at all
		const libDest = path.join(targetPath, ".claude", "lib");
		expect(await exists(libDest)).toBe(false);
		// tbox.yaml has no consumer → must not be deployed
		expect(await exists(path.join(libDest, "pins", "tbox.yaml"))).toBe(false);
	});

	// Regression (b): module-bearing target → lib deploys INCLUDING tbox.yaml
	it("@lib 모듈 보유 타겟: lib 배포 시 tbox.yaml 데이터 파일도 함께 배포 via `syncLib`", async () => {
		const libSrc = path.join(rootDir, "lib");
		// A lib module that references tbox.yaml as a data file
		await writeFile(
			path.join(libSrc, "pins", "store.ts"),
			'import { join } from "path";\nexport const P = join(import.meta.dir, "tbox.yaml");\n',
		);
		await writeFile(path.join(libSrc, "pins", "tbox.yaml"), "schema: 1\n");

		// Component DOES import the lib module → requiredModules is non-empty
		const sourceTs = path.join(rootDir, "skills", "pin-user", "run.ts");
		await writeFile(sourceTs, "import { P } from '@lib/pins/store';\n");

		await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		const libDest = path.join(targetPath, ".claude", "lib");
		// The module deploys
		expect(await exists(path.join(libDest, "pins", "store.ts"))).toBe(true);
		// tbox.yaml rides along with its module
		expect(await exists(path.join(libDest, "pins", "tbox.yaml"))).toBe(true);
	});

	// Regression (c): hook-only @lib usage → requiredModules > 0 → lib deploys
	it("훅 소스만으로도 @lib 임포트가 있으면 lib 배포됨 via `syncLib`", async () => {
		const libSrc = path.join(rootDir, "lib");
		// A lib module referenced only by a hook (not a skill/agent component)
		await writeFile(path.join(libSrc, "omt-dir.ts"), "export const OMT_DIR = '/tmp';\n");
		await writeFile(
			path.join(libSrc, "pins", "store.ts"),
			'import { join } from "path";\nexport const P = join(import.meta.dir, "tbox.yaml");\n',
		);
		await writeFile(path.join(libSrc, "pins", "tbox.yaml"), "schema: 1\n");

		// The hook source (simulating pin-session-start/index.ts) imports @lib/
		const hookSource = path.join(rootDir, "hooks", "pin-session-start", "index.ts");
		await writeFile(
			hookSource,
			"import { OMT_DIR } from '@lib/omt-dir';\nimport { P } from '@lib/pins/store';\n",
		);

		// No component imports @lib/ — ONLY the hook does.
		// libRoots constructed with the hook source (mirrors how syncPlatformConfigs
		// calls addLibSourceRoot for hook sources at tools/sync.ts:236-241).
		const hookRoots = libRoots("claude", hookSource);

		await syncLib(makeContext(), targetPath, rootDir, ["claude"], hookRoots);

		// Hook-only @lib → requiredModules > 0 → lib deploys
		const libDest = path.join(targetPath, ".claude", "lib");
		expect(await exists(path.join(libDest, "omt-dir.ts"))).toBe(true);
		expect(await exists(path.join(libDest, "pins", "store.ts"))).toBe(true);
		// tbox.yaml also deploys (data file for the hook's lib module)
		expect(await exists(path.join(libDest, "pins", "tbox.yaml"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Suite: syncLib — sync-time bare-import vendoring
//
// These exercise the real `bun build <pkg> --target=node` bundler inside
// syncLib. The bundler runs with cwd=rootDir, so the temp rootDir must resolve
// picomatch: it gets a package.json declaring picomatch and a node_modules
// symlink to the real repo's installed copy.
// ---------------------------------------------------------------------------

describe("syncLib — sync-time bare-import vendoring", () => {
	// Repo root = parent of the tools/ dir this test file lives in.
	const repoRoot = path.dirname(import.meta.dir);
	const repoNodeModules = path.join(repoRoot, "node_modules");

	let tmpDir: string;
	let rootDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-vendor-test-"));
		rootDir = path.join(tmpDir, "root");
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(rootDir, { recursive: true });
		await fs.mkdir(targetPath, { recursive: true });
		// syncLib early-returns unless rootDir/lib exists. A bare-only target needs
		// no .ts lib modules, but the lib source dir must be present for the deploy
		// (and the vendored bundle written under lib/vendor/) to proceed.
		await fs.mkdir(path.join(rootDir, "lib"), { recursive: true });
		// Declare picomatch so readPackageJsonDeps(rootDir) marks it eligible.
		await writeFile(
			path.join(rootDir, "package.json"),
			JSON.stringify({ devDependencies: { picomatch: "4.0.4" } }),
		);
		// Symlink the real installed node_modules so `bun build picomatch` resolves.
		await fs.symlink(repoNodeModules, path.join(rootDir, "node_modules"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("bare-only platform (zero @lib/): vendors picomatch.js and rewrites the deployed import to a relative path", async () => {
		// A component source that imports ONLY a bare package — no @lib/ at all.
		const sourceTs = path.join(rootDir, "skills", "matcher", "run.ts");
		await writeFile(
			sourceTs,
			"import picomatch from 'picomatch';\nexport const m = picomatch('*.js');\n",
		);

		await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		// The vendored bundle is deployed.
		const vendoredJs = path.join(targetPath, ".claude", "lib", "vendor", "picomatch.js");
		expect(await exists(vendoredJs)).toBe(true);

		// Plant a deployed copy of the component still carrying the raw bare specifier;
		// the post-pass rewrite must repoint it at the relative vendored path.
		// (syncLib's rewriteLibAliases scans the platform dir.)
		const deployedSkill = path.join(targetPath, ".claude", "skills", "matcher", "run.ts");
		await writeFile(
			deployedSkill,
			"import picomatch from 'picomatch';\nexport const m = picomatch('*.js');\n",
		);
		await rewriteLibAliases(path.join(targetPath, ".claude"), new Set(["picomatch"]));

		const rewritten = await readFile(deployedSkill);
		// skills/matcher/run.ts is two levels deep → ../../lib/vendor/picomatch.js
		expect(rewritten).toContain("../../lib/vendor/picomatch.js");
		// Raw bare 'picomatch' specifier is gone.
		expect(rewritten).not.toContain("'picomatch'");
	});

	it("lib module's bare import is vendored AND the deployed lib module's specifier is rewritten (transitive @lib/ pull)", async () => {
		// A lib MODULE (not a component) carries the bare import. It is pulled into
		// the deploy transitively: a component imports it via @lib/, so it lands in
		// requiredModules — NOT in sourceRoots. The bare specifier therefore traces
		// through no sourceRoot, exercising the discovery + rewrite coverage gaps.
		const libModule = path.join(rootDir, "lib", "matcher-helper.ts");
		await writeFile(
			libModule,
			"import picomatch from 'picomatch';\nexport const m = picomatch('*.js');\n",
		);
		// Component sits OUTSIDE lib/ and reaches the lib module only via @lib/.
		const sourceTs = path.join(rootDir, "skills", "matcher", "run.ts");
		await writeFile(
			sourceTs,
			"import { m } from '@lib/matcher-helper';\nexport const matcher = m;\n",
		);

		await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));

		// (a) The lib module's bare import is discovered and vendored.
		const vendoredJs = path.join(targetPath, ".claude", "lib", "vendor", "picomatch.js");
		expect(await exists(vendoredJs)).toBe(true);

		// (b) The DEPLOYED lib module's specifier is rewritten to the relative
		// vendored path — lib/matcher-helper.ts is one level under the platform root,
		// so the prefix is ../lib/vendor/picomatch.js. No raw bare specifier remains.
		const deployedLibModule = path.join(targetPath, ".claude", "lib", "matcher-helper.ts");
		const deployed = await readFile(deployedLibModule);
		expect(deployed).toContain("../lib/vendor/picomatch.js");
		expect(deployed).not.toContain("'picomatch'");
	});

	it("does not mutate OMT source: git status --porcelain is byte-identical before vs after a sync into an out-of-repo target", async () => {
		// Source under the temp rootDir (OUTSIDE the OMT repo). We assert the OMT
		// repo working tree is unchanged by the sync.
		const sourceTs = path.join(rootDir, "skills", "matcher", "run.ts");
		await writeFile(
			sourceTs,
			"import picomatch from 'picomatch';\nexport const m = picomatch('*.js');\n",
		);

		const porcelain = () =>
			execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });

		const before = porcelain();
		await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));
		const after = porcelain();

		expect(after).toBe(before);
	});

	it("build failure aborts clean: declared-but-uninstalled package → throws and the target lib/ is unchanged (atomicity)", async () => {
		// Declare a package that is NOT installed in node_modules → bun build fails.
		await writeFile(
			path.join(rootDir, "package.json"),
			JSON.stringify({ devDependencies: { "definitely-not-installed-xyz": "1.0.0" } }),
		);
		const sourceTs = path.join(rootDir, "skills", "matcher", "run.ts");
		await writeFile(
			sourceTs,
			"import x from 'definitely-not-installed-xyz';\nexport const m = x;\n",
		);

		// Establish a known pre-sync lib/ state on the target.
		const libDest = path.join(targetPath, ".claude", "lib");
		await fs.mkdir(libDest, { recursive: true });
		await writeFile(path.join(libDest, "sentinel.ts"), "export const SENTINEL = 1;\n");
		const preState = await fs.readdir(libDest);
		const preContent = await readFile(path.join(libDest, "sentinel.ts"));

		let threw = false;
		try {
			await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));
		} catch {
			threw = true;
		}

		// Build failure must surface as a non-zero exit (thrown error).
		expect(threw).toBe(true);
		// The target lib/ equals its pre-sync state — no partial swap.
		expect(await fs.readdir(libDest)).toEqual(preState);
		expect(await readFile(path.join(libDest, "sentinel.ts"))).toBe(preContent);
	});

	it("restores the original lib when the second swap rename fails after the old lib was moved aside", async () => {
		// F3: the swap is two renames — move old lib aside (libDest → libOld), then
		// move the freshly built tree in (libTmp → libDest). If the SECOND rename
		// fails after the first succeeded, the catch must restore the moved-aside old
		// lib, or the target is left with NO live lib/ at all.
		const sourceTs = path.join(rootDir, "skills", "matcher", "run.ts");
		await writeFile(
			sourceTs,
			"import picomatch from 'picomatch';\nexport const m = picomatch('*.js');\n",
		);

		// Establish a known pre-sync lib/ state so we can prove it survives.
		const libDest = path.join(targetPath, ".claude", "lib");
		await fs.mkdir(libDest, { recursive: true });
		await writeFile(path.join(libDest, "sentinel.ts"), "export const SENTINEL = 1;\n");
		const preState = await fs.readdir(libDest);
		const preContent = await readFile(path.join(libDest, "sentinel.ts"));

		// Fail ONLY the second rename (the one whose source is the lib.tmp tree).
		const realRename = fs.rename.bind(fs);
		const renameSpy = spyOn(fs, "rename").mockImplementation(
			async (from: fs2.PathLike, to: fs2.PathLike) => {
				if (String(from).includes("lib.tmp-")) {
					throw new Error("simulated second-rename failure");
				}
				return realRename(from as string, to as string);
			},
		);

		let threw = false;
		try {
			await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("claude", sourceTs));
		} catch {
			threw = true;
		} finally {
			renameSpy.mockRestore();
		}

		// The failure must surface.
		expect(threw).toBe(true);
		// The original lib must have been restored — not left missing.
		expect(await exists(libDest)).toBe(true);
		expect(await fs.readdir(libDest)).toEqual(preState);
		expect(await readFile(path.join(libDest, "sentinel.ts"))).toBe(preContent);
	});

	it("vendors to a NON-claude platform that received the component even when libPlatforms is the claude-only default (F3)", async () => {
		// Reproduces F3: with no feature-platforms.lib configured, the resolved
		// libPlatforms cascades to ["claude"]. But the component (and its bare
		// bundled import) deployed to codex — recorded in libSourceRoots under
		// "codex". syncLib must iterate the UNION of libPlatforms and the platforms
		// that actually received components, or codex gets the rewritten source with
		// NO matching vendor bundle → ERR_MODULE_NOT_FOUND at runtime under node.
		const sourceTs = path.join(rootDir, "skills", "matcher", "run.ts");
		await writeFile(
			sourceTs,
			"import picomatch from 'picomatch';\nexport const m = picomatch('*.js');\n",
		);

		// libPlatforms = ["claude"] (the cascade default), but the component landed
		// on codex only — so libSourceRoots is keyed under "codex", not "claude".
		await syncLib(makeContext(), targetPath, rootDir, ["claude"], libRoots("codex", sourceTs));

		// The vendored bundle must exist under .codex/, the platform that got the component.
		const codexVendoredJs = path.join(targetPath, ".codex", "lib", "vendor", "picomatch.js");
		expect(await exists(codexVendoredJs)).toBe(true);

		// The deployed component's bare import on .codex/ is rewritten to the relative
		// vendored path. (Plant the deployed copy, then run the post-pass rewrite the
		// way syncLib does for the platform dir.)
		const deployedSkill = path.join(targetPath, ".codex", "skills", "matcher", "run.ts");
		await writeFile(
			deployedSkill,
			"import picomatch from 'picomatch';\nexport const m = picomatch('*.js');\n",
		);
		await rewriteLibAliases(path.join(targetPath, ".codex"), new Set(["picomatch"]));

		const rewritten = await readFile(deployedSkill);
		expect(rewritten).toContain("../../lib/vendor/picomatch.js");
		expect(rewritten).not.toContain("'picomatch'");
	});
});

// ---------------------------------------------------------------------------
// Suite: processYaml — bare-import vendoring for hook-only (non-claude) projects
//
// F1 regression: a codex/gemini-hook-only project (sync.yaml with no component
// items, sibling codex.yaml carrying a hook that imports a bare package) deploys
// its hook via syncPlatformConfigs and records the hook source in libSourceRoots,
// but shouldMkdirClaude is false. The lib-vendoring gate in processYaml must run
// whenever a deploy target received deployable source (libSourceRoots non-empty),
// not only when shouldMkdirClaude — otherwise the deployed hook's bare import is
// never vendored → ERR_MODULE_NOT_FOUND under node at runtime.
// ---------------------------------------------------------------------------

describe("processYaml — hook-only bare-import vendoring (F1)", () => {
	const repoRoot = path.dirname(import.meta.dir);
	const repoNodeModules = path.join(repoRoot, "node_modules");

	let tmpDir: string;
	let rootDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "process-yaml-vendor-test-"));
		rootDir = path.join(tmpDir, "root");
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(rootDir, { recursive: true });
		await fs.mkdir(targetPath, { recursive: true });
		// syncLib early-returns unless rootDir/lib exists; the vendored bundle also
		// lands under <platform>/lib/vendor/, so the lib source dir must be present.
		await fs.mkdir(path.join(rootDir, "lib"), { recursive: true });
		// Declared so readPackageJsonDeps(rootDir) marks picomatch eligible to bundle.
		await writeFile(
			path.join(rootDir, "package.json"),
			JSON.stringify({ devDependencies: { picomatch: "4.0.4" } }),
		);
		// config.yaml is read by processYaml's config cascade.
		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [codex]\n");
		_resetConfigCache();
		// Symlink the real installed node_modules so `bun build picomatch` resolves.
		await fs.symlink(repoNodeModules, path.join(rootDir, "node_modules"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	it("vendors a codex-hook-only project's bare import even though shouldMkdirClaude is false", async () => {
		// A hook component (resolves to a directory) whose .ts source imports a bare
		// package. syncPlatformConfigs records this dir in libSourceRoots under codex.
		const hookDir = path.join(rootDir, "hooks", "matcher-hook");
		await writeFile(
			path.join(hookDir, "run.ts"),
			"import picomatch from 'picomatch';\nexport const m = picomatch('*.js');\n",
		);

		// sync.yaml has NO component sections → shouldMkdirClaude is false.
		// sibling codex.yaml carries the hook that pulls the bare import in.
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(syncYamlPath, `path: ${targetPath}\n`);
		await writeFile(
			path.join(rootDir, "codex.yaml"),
			"hooks:\n  PreToolUse:\n    - component: matcher-hook\n",
		);

		const adapters = makeAdapterMap(["codex"]);
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		// The bare import must be vendored under .codex/ even though no .claude/ was
		// created (this is the hook-only, non-claude deploy shape).
		const codexVendoredJs = path.join(targetPath, ".codex", "lib", "vendor", "picomatch.js");
		expect(await exists(codexVendoredJs)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Suite: rewriteLibAliases
// ---------------------------------------------------------------------------

describe("rewriteLibAliases", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rewrite-lib-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("rewrites @lib/ to ./lib/ for root-level files via `rewriteLibAliases`", async () => {
		await writeFile(
			path.join(tmpDir, "index.ts"),
			`import { X } from '@lib/types.ts';\nimport { Y } from "@lib/other.ts";\n`,
		);

		await rewriteLibAliases(tmpDir, new Set());

		const content = await readFile(path.join(tmpDir, "index.ts"));
		expect(content).toContain("'./lib/types.ts'");
		expect(content).toContain('"./lib/other.ts"');
	});

	it("rewrites @lib/ to ../lib/ for one-level-deep files via `rewriteLibAliases`", async () => {
		await writeFile(
			path.join(tmpDir, "agents", "oracle.ts"),
			"import { X } from '@lib/types.ts';\n",
		);

		await rewriteLibAliases(tmpDir, new Set());

		const content = await readFile(path.join(tmpDir, "agents", "oracle.ts"));
		expect(content).toContain("'../lib/types.ts'");
	});

	it("rewrites @lib/ to ../../lib/ for two-levels-deep files via `rewriteLibAliases`", async () => {
		await writeFile(
			path.join(tmpDir, "a", "b", "deep.ts"),
			"import type { X } from '@lib/types.ts';\n",
		);

		await rewriteLibAliases(tmpDir, new Set());

		const content = await readFile(path.join(tmpDir, "a", "b", "deep.ts"));
		expect(content).toContain("'../../lib/types.ts'");
	});

	it("does not modify files without @lib/ imports", async () => {
		const original = "import { X } from './local.ts';\n";
		await writeFile(path.join(tmpDir, "no-alias.ts"), original);

		await rewriteLibAliases(tmpDir, new Set());

		const content = await readFile(path.join(tmpDir, "no-alias.ts"));
		expect(content).toBe(original);
	});

	it("does not touch *.test.ts files", async () => {
		const original = "import { X } from '@lib/types.ts';\n";
		await writeFile(path.join(tmpDir, "helper.test.ts"), original);

		await rewriteLibAliases(tmpDir, new Set());

		const content = await readFile(path.join(tmpDir, "helper.test.ts"));
		expect(content).toBe(original);
	});

	it("does not rewrite files inside lib/ directory", async () => {
		const original = "import { X } from '@lib/types.ts';\n";
		await writeFile(path.join(tmpDir, "lib", "internal.ts"), original);

		await rewriteLibAliases(tmpDir, new Set());

		const content = await readFile(path.join(tmpDir, "lib", "internal.ts"));
		expect(content).toBe(original);
	});
});

// ---------------------------------------------------------------------------
// Suite: rewritePlatformPaths
// ---------------------------------------------------------------------------

describe("rewritePlatformPaths", () => {
	let tmpDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rewrite-platform-test-"));
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(targetPath, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("rewrites .claude/ to .gemini/ for gemini platform via `rewritePlatformPaths`", async () => {
		const geminiDir = path.join(targetPath, ".gemini", "agents");
		await fs.mkdir(geminiDir, { recursive: true });
		await writeFile(path.join(geminiDir, "oracle.md"), "Look in .claude/skills/ for more\n");

		await rewritePlatformPaths(targetPath, "gemini");

		const content = await readFile(path.join(geminiDir, "oracle.md"));
		expect(content).toContain(".gemini/skills/");
		expect(content).not.toContain(".claude/");
	});

	it("rewrites .claude/ to .codex/ for codex platform via `rewritePlatformPaths`", async () => {
		const codexDir = path.join(targetPath, ".codex", "rules");
		await fs.mkdir(codexDir, { recursive: true });
		await writeFile(path.join(codexDir, "rule.md"), "See .claude/agents/ directory\n");

		await rewritePlatformPaths(targetPath, "codex");

		const content = await readFile(path.join(codexDir, "rule.md"));
		expect(content).toContain(".codex/agents/");
		expect(content).not.toContain(".claude/");
	});

	it("rewrites .claude/ to .opencode/ for opencode platform via `rewritePlatformPaths`", async () => {
		const opencodeDir = path.join(targetPath, ".opencode", "skills");
		await fs.mkdir(opencodeDir, { recursive: true });
		await writeFile(
			path.join(opencodeDir, "skill.md"),
			"Reference: .claude/hooks/ and .claude/lib/\n",
		);

		await rewritePlatformPaths(targetPath, "opencode");

		const content = await readFile(path.join(opencodeDir, "skill.md"));
		expect(content).toContain(".opencode/hooks/");
		expect(content).toContain(".opencode/lib/");
		expect(content).not.toContain(".claude/");
	});

	it("does nothing for claude platform via `rewritePlatformPaths`", async () => {
		const claudeDir = path.join(targetPath, ".claude", "agents");
		await fs.mkdir(claudeDir, { recursive: true });
		const original = "Look in .claude/skills/ for more\n";
		await writeFile(path.join(claudeDir, "oracle.md"), original);

		await rewritePlatformPaths(targetPath, "claude");

		const content = await readFile(path.join(claudeDir, "oracle.md"));
		expect(content).toBe(original);
	});

	it("does not modify files without .claude/ references", async () => {
		const geminiDir = path.join(targetPath, ".gemini");
		await fs.mkdir(geminiDir, { recursive: true });
		const original = "No platform path references here.\n";
		await writeFile(path.join(geminiDir, "doc.md"), original);

		await rewritePlatformPaths(targetPath, "gemini");

		const content = await readFile(path.join(geminiDir, "doc.md"));
		expect(content).toBe(original);
	});
});

// ---------------------------------------------------------------------------
// Suite: dry-run
// ---------------------------------------------------------------------------

describe("dry-run", () => {
	let tmpDir: string;
	let rootDir: string;
	let targetPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dry-run-test-"));
		rootDir = path.join(tmpDir, "root");
		targetPath = path.join(tmpDir, "target");
		await fs.mkdir(path.join(rootDir, "skills"), { recursive: true });
		await fs.mkdir(targetPath, { recursive: true });
		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	it("`processYaml` does not create .claude directory in dry-run mode", async () => {
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(syncYamlPath, `path: ${targetPath}\n`);

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext({ dryRun: true });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		// .claude should not be created in dry-run
		expect(await exists(path.join(targetPath, ".claude"))).toBe(false);
	});

	it("`syncLib` does not copy files in dry-run mode", async () => {
		const libSrc = path.join(rootDir, "lib");
		await fs.mkdir(libSrc, { recursive: true });
		await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

		const context = makeContext({ dryRun: true });

		await syncLib(context, targetPath, rootDir, ["claude"]);

		expect(await exists(path.join(targetPath, ".claude", "lib"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suite: config.yaml 정리
// ---------------------------------------------------------------------------

describe("config.yaml feature-platforms 정리", () => {
	it("feature-platforms contains only skills", async () => {
		// Read the actual config.yaml from the repo
		const configPath = path.join(import.meta.dir, "..", "config.yaml");

		const text = await fs.readFile(configPath, "utf8");
		const config = parseYaml(text) as Record<string, unknown>;
		const featurePlatforms = config["feature-platforms"] as Record<string, unknown> | undefined;

		expect(featurePlatforms).toBeDefined();
		expect(Object.keys(featurePlatforms!)).toEqual(["skills"]);
		// config, mcps, plugins should be absent
		expect(featurePlatforms!["config"]).toBeUndefined();
		expect(featurePlatforms!["mcps"]).toBeUndefined();
		expect(featurePlatforms!["plugins"]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Suite: createContext
// ---------------------------------------------------------------------------

describe("createContext", () => {
	it("creates context with dryRun=false via `createContext`", () => {
		const ctx = createContext(false);
		expect(ctx.dryRun).toBe(false);
		expect(ctx.processedPaths).toBeInstanceOf(Set);
		expect(ctx.modelMaps).toBeInstanceOf(Map);
		expect(ctx.platformYamlSections).toBeInstanceOf(Map);
		expect(typeof ctx.backupSession).toBe("string");
		expect(ctx.backupSession.length).toBeGreaterThan(0);
	});

	it("creates context with dryRun=true via `createContext`", () => {
		const ctx = createContext(true);
		expect(ctx.dryRun).toBe(true);
	});

	it("generates unique backupSession on each `createContext` call", () => {
		const ctx1 = createContext(false);
		const ctx2 = createContext(false);
		expect(ctx1.backupSession).not.toBe(ctx2.backupSession);
	});
});

// ---------------------------------------------------------------------------
// Suite: parseCliArgs
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
	it("returns defaults when no args passed via `parseCliArgs`", () => {
		const result = parseCliArgs([]);
		expect(result.dryRun).toBe(false);
		expect(result.verbose).toBe(false);
		expect(result.projectFilter.size).toBe(0);
	});

	it("sets dryRun=true for --dry-run via `parseCliArgs`", () => {
		const result = parseCliArgs(["--dry-run"]);
		expect(result.dryRun).toBe(true);
	});

	it("sets verbose=true for --verbose via `parseCliArgs`", () => {
		const result = parseCliArgs(["--verbose"]);
		expect(result.verbose).toBe(true);
	});

	it("parses single project from --projects via `parseCliArgs`", () => {
		const result = parseCliArgs(["--projects", "foo"]);
		expect(result.projectFilter).toEqual(new Set(["foo"]));
	});

	it("parses comma-separated projects from --projects via `parseCliArgs`", () => {
		const result = parseCliArgs(["--projects", "foo,bar,baz"]);
		expect(result.projectFilter).toEqual(new Set(["foo", "bar", "baz"]));
	});

	it("trims whitespace in comma-separated --projects values via `parseCliArgs`", () => {
		const result = parseCliArgs(["--projects", " foo , bar "]);
		expect(result.projectFilter.has("foo")).toBe(true);
		expect(result.projectFilter.has("bar")).toBe(true);
	});

	it("parses combined flags correctly via `parseCliArgs`", () => {
		const result = parseCliArgs(["--dry-run", "--verbose", "--projects", "alpha,beta"]);
		expect(result.dryRun).toBe(true);
		expect(result.verbose).toBe(true);
		expect(result.projectFilter).toEqual(new Set(["alpha", "beta"]));
	});

	it("emits logWarn for unknown flags via `parseCliArgs`", () => {
		const warns: string[] = [];
		const origStderr = process.stderr.write.bind(process.stderr);
		process.stderr.write = (chunk: string | Uint8Array) => {
			if (typeof chunk === "string") warns.push(chunk);
			return true;
		};
		try {
			parseCliArgs(["--unknown-flag"]);
		} finally {
			process.stderr.write = origStderr;
		}
		expect(warns.some((w) => w.includes("--unknown-flag"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Suite: printUsage
// ---------------------------------------------------------------------------

describe("printUsage", () => {
	it("writes usage text containing --verbose and --projects via `printUsage`", () => {
		const lines: string[] = [];
		const origStderr = process.stderr.write.bind(process.stderr);
		process.stderr.write = (chunk: string | Uint8Array) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		};
		try {
			printUsage();
		} finally {
			process.stderr.write = origStderr;
		}
		const output = lines.join("");
		expect(output).toContain("--verbose");
		expect(output).toContain("--projects");
		expect(output).toContain("--dry-run");
		expect(output).toContain("--help");
	});
});

// ---------------------------------------------------------------------------
// Suite: resolveProjectFilter (enabled-projects 화이트리스트)
// ---------------------------------------------------------------------------

describe("resolveProjectFilter", () => {
	it("CLI projectFilter가 있으면 그대로 반환 (config 무시)", () => {
		const cliFilter = new Set(["proj-b"]);
		const result = resolveProjectFilter(cliFilter, ["proj-a"]);
		expect(result).toEqual(new Set(["proj-b"]));
	});

	it("CLI가 비어있고 config enabled-projects 있으면 Set으로 반환", () => {
		const cliFilter = new Set<string>();
		const result = resolveProjectFilter(cliFilter, ["proj-a", "proj-b"]);
		expect(result).toEqual(new Set(["proj-a", "proj-b"]));
	});

	it("CLI/config 둘 다 없으면 undefined 반환 (전부 활성)", () => {
		const cliFilter = new Set<string>();
		const result = resolveProjectFilter(cliFilter, undefined);
		expect(result).toBeUndefined();
	});

	it("CLI가 비어있고 config도 undefined면 undefined 반환", () => {
		const result = resolveProjectFilter(new Set(), undefined);
		expect(result).toBeUndefined();
	});

	it("CLI projectFilter가 config보다 우선 — 빈 Set이 아닌 경우", () => {
		const cliFilter = new Set(["only-this"]);
		const result = resolveProjectFilter(cliFilter, ["proj-a", "proj-b", "proj-c"]);
		expect(result).toEqual(new Set(["only-this"]));
		expect(result!.has("proj-a")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suite: enabled-projects 화이트리스트 — projects 루프 통합
// ---------------------------------------------------------------------------

describe("enabled-projects 화이트리스트 — projects 루프 통합", () => {
	let tmpDir: string;
	let rootDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "enabled-projects-test-"));
		rootDir = path.join(tmpDir, "root");
		await fs.mkdir(path.join(rootDir, "projects", "proj-a"), { recursive: true });
		await fs.mkdir(path.join(rootDir, "projects", "proj-b"), { recursive: true });
		_resetConfigCache();
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	it("config enabled-projects 선언 시 비활성 프로젝트는 processYaml 호출 안 됨", async () => {
		const targetA = path.join(tmpDir, "target-a");
		const targetB = path.join(tmpDir, "target-b");
		await fs.mkdir(targetA, { recursive: true });
		await fs.mkdir(targetB, { recursive: true });

		await writeFile(
			path.join(rootDir, "config.yaml"),
			"use-platforms: [claude]\nenabled-projects:\n  - proj-a\n",
		);
		await writeFile(path.join(rootDir, "projects", "proj-a", "sync.yaml"), `path: ${targetA}\n`);
		await writeFile(path.join(rootDir, "projects", "proj-b", "sync.yaml"), `path: ${targetB}\n`);

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();
		const effectiveFilter = resolveProjectFilter(new Set(), ["proj-a"]);

		await runProjectsLoop(rootDir, adapters, context, effectiveFilter, false);

		expect(context.processedPaths.has(targetA)).toBe(true);
		expect(context.processedPaths.has(targetB)).toBe(false);
	});

	it("CLI projectFilter가 config enabled-projects를 override", async () => {
		const targetA = path.join(tmpDir, "target-a");
		const targetB = path.join(tmpDir, "target-b");
		await fs.mkdir(targetA, { recursive: true });
		await fs.mkdir(targetB, { recursive: true });

		await writeFile(
			path.join(rootDir, "config.yaml"),
			"use-platforms: [claude]\nenabled-projects:\n  - proj-a\n",
		);
		await writeFile(path.join(rootDir, "projects", "proj-a", "sync.yaml"), `path: ${targetA}\n`);
		await writeFile(path.join(rootDir, "projects", "proj-b", "sync.yaml"), `path: ${targetB}\n`);

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();
		const effectiveFilter = resolveProjectFilter(new Set(["proj-b"]), ["proj-a"]);

		await runProjectsLoop(rootDir, adapters, context, effectiveFilter, false);

		expect(context.processedPaths.has(targetB)).toBe(true);
		expect(context.processedPaths.has(targetA)).toBe(false);
	});

	it("CLI/config 둘 다 없으면 모든 프로젝트 처리 (기존 동작)", async () => {
		const targetA = path.join(tmpDir, "target-a");
		const targetB = path.join(tmpDir, "target-b");
		await fs.mkdir(targetA, { recursive: true });
		await fs.mkdir(targetB, { recursive: true });

		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		await writeFile(path.join(rootDir, "projects", "proj-a", "sync.yaml"), `path: ${targetA}\n`);
		await writeFile(path.join(rootDir, "projects", "proj-b", "sync.yaml"), `path: ${targetB}\n`);

		const adapters = makeAdapterMap(["claude"]);
		const context = makeContext();
		const effectiveFilter = resolveProjectFilter(new Set(), undefined);

		await runProjectsLoop(rootDir, adapters, context, effectiveFilter, false);

		expect(context.processedPaths.has(targetA)).toBe(true);
		expect(context.processedPaths.has(targetB)).toBe(true);
	});

	it("config에 명시된 프로젝트 디렉토리가 없으면 warn 출력 후 skip (실패 아님)", async () => {
		await writeFile(
			path.join(rootDir, "config.yaml"),
			"use-platforms: [claude]\nenabled-projects:\n  - does-not-exist\n",
		);

		const warns: string[] = [];
		const origStderr = process.stderr.write.bind(process.stderr);
		process.stderr.write = (chunk: string | Uint8Array) => {
			if (typeof chunk === "string") warns.push(chunk);
			return true;
		};

		let threw = false;
		try {
			const adapters = makeAdapterMap(["claude"]);
			const context = makeContext();
			const effectiveFilter = resolveProjectFilter(new Set(), ["does-not-exist"]);
			await runProjectsLoop(rootDir, adapters, context, effectiveFilter, false);
		} catch {
			threw = true;
		} finally {
			process.stderr.write = origStderr;
		}

		expect(threw).toBe(false);
		expect(warns.some((w) => w.includes("does-not-exist"))).toBe(true);
	});

	it("ProjectKeyError escapes the projects loop (not isolated) so it reaches a non-zero exit", async () => {
		const targetA = path.join(tmpDir, "target-a");
		await fs.mkdir(targetA, { recursive: true });

		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		await writeFile(path.join(rootDir, "projects", "proj-a", "sync.yaml"), `path: ${targetA}\n`);
		// claude.yaml present → syncPlatformConfigs invokes the adapter.
		await writeFile(
			path.join(rootDir, "projects", "proj-a", "claude.yaml"),
			"mcps:\n  notion:\n    url: https://example.com\n",
		);

		const adapters = makeAdapterMap(["claude"]);
		adapters.getAdapter("claude")!.syncPlatformYaml = async () => {
			throw new ProjectKeyError(targetA, new Error("dubious ownership"));
		};

		const context = makeContext();
		const effectiveFilter = resolveProjectFilter(new Set(), undefined);

		// The per-project isolation catch must NOT swallow a ProjectKeyError.
		await expect(
			runProjectsLoop(rootDir, adapters, context, effectiveFilter, false),
		).rejects.toBeInstanceOf(ProjectKeyError);
	});

	it("generic project errors stay isolated (loop continues, no throw)", async () => {
		const targetA = path.join(tmpDir, "target-a");
		await fs.mkdir(targetA, { recursive: true });

		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		await writeFile(path.join(rootDir, "projects", "proj-a", "sync.yaml"), `path: ${targetA}\n`);
		await writeFile(
			path.join(rootDir, "projects", "proj-a", "claude.yaml"),
			"mcps:\n  notion:\n    url: https://example.com\n",
		);

		const adapters = makeAdapterMap(["claude"]);
		adapters.getAdapter("claude")!.syncPlatformYaml = async () => {
			throw new Error("generic adapter failure");
		};

		const context = makeContext();
		const effectiveFilter = resolveProjectFilter(new Set(), undefined);

		// Non-ProjectKeyError keeps per-project isolation: loop does not throw.
		await expect(
			runProjectsLoop(rootDir, adapters, context, effectiveFilter, false),
		).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Suite: isFatalSyncError
// ---------------------------------------------------------------------------

describe("isFatalSyncError", () => {
	it("returns true for ProjectKeyError", () => {
		const err = new ProjectKeyError("/target", new Error("key failure"));
		expect(isFatalSyncError(err)).toBe(true);
	});

	it("returns true for DeployTargetsError", () => {
		const err = new DeployTargetsError("/target", "zero worktrees");
		expect(isFatalSyncError(err)).toBe(true);
	});

	it("returns false for generic Error", () => {
		expect(isFatalSyncError(new Error("boom"))).toBe(false);
	});

	it("returns false for non-Error values", () => {
		expect(isFatalSyncError("string error")).toBe(false);
		expect(isFatalSyncError(42)).toBe(false);
		expect(isFatalSyncError(null)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suite: component fan-out (bare-structure → every worktree's .claude/)
// ---------------------------------------------------------------------------

describe("component fan-out", () => {
	let tmpDir: string;
	let rootDir: string;

	const GIT_ENV = {
		...process.env,
		GIT_AUTHOR_NAME: "T",
		GIT_AUTHOR_EMAIL: "t@t.com",
		GIT_COMMITTER_NAME: "T",
		GIT_COMMITTER_EMAIL: "t@t.com",
	};

	/**
	 * Seeds an empty commit into a bare repo via a throwaway orphan worktree.
	 * (Adapted from tools/lib/git-key.test.ts:seedBareRepo.)
	 */
	function seedBareRepo(bareDir: string): void {
		const tmpWt = fs2.mkdtempSync(path.join(os.tmpdir(), "fanout-seed-"));
		try {
			execFileSync(
				"git",
				["--git-dir", bareDir, "worktree", "add", "--orphan", "-b", "main", tmpWt],
				{
					stdio: "pipe",
					env: GIT_ENV,
				},
			);
			execFileSync("git", ["-C", tmpWt, "commit", "--allow-empty", "-m", "init"], {
				stdio: "pipe",
				env: GIT_ENV,
			});
			fs2.rmSync(tmpWt, { recursive: true, force: true });
			execFileSync("git", ["--git-dir", bareDir, "worktree", "prune"], { stdio: "pipe" });
		} catch {
			fs2.rmSync(tmpWt, { recursive: true, force: true });
			throw new Error("Failed to seed bare repo");
		}
	}

	/**
	 * Builds a real bare-structure container with N worktrees.
	 * Layout: <container>/.bare (bare repo) + <container>/wt1, wt2, ... (worktrees)
	 * Returns the container path and the worktree absolute paths.
	 */
	function makeBareTopology(
		containerName: string,
		worktreeNames: string[],
	): {
		container: string;
		worktrees: string[];
	} {
		const container = path.join(tmpDir, containerName);
		fs2.mkdirSync(container, { recursive: true });
		const bareDir = path.join(container, ".bare");
		execFileSync("git", ["init", "--bare", bareDir], { stdio: "pipe", env: GIT_ENV });
		seedBareRepo(bareDir);

		const worktrees: string[] = [];
		for (const name of worktreeNames) {
			const wtDir = path.join(container, name);
			execFileSync("git", ["--git-dir", bareDir, "worktree", "add", wtDir], {
				stdio: "pipe",
				env: GIT_ENV,
			});
			// git worktree add canonicalizes; capture the path git itself reports so
			// assertions byte-match resolveDeployTargets output.
			worktrees.push(fs2.realpathSync(wtDir));
		}
		return { container, worktrees };
	}

	/** Writes a single skill source under rootDir so a non-empty components section deploys. */
	async function seedSkill(name: string): Promise<void> {
		const skillDir = path.join(rootDir, "skills", name);
		await fs.mkdir(skillDir, { recursive: true });
		await writeFile(path.join(skillDir, "SKILL.md"), `# ${name}\n`);
	}

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fanout-test-"));
		rootDir = path.join(tmpDir, "root");
		await fs.mkdir(path.join(rootDir, "skills"), { recursive: true });
		await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
		_resetConfigCache();
	});

	afterEach(async () => {
		// Restore modes that an unwritable-worktree test may have left (chmod 555)
		// so the recursive rm can traverse and delete every directory.
		async function chmodTree(dir: string): Promise<void> {
			await fs.chmod(dir, 0o755).catch(() => {});
			let entries: import("fs").Dirent[];
			try {
				entries = (await fs.readdir(dir, { withFileTypes: true })) as import("fs").Dirent[];
			} catch {
				return;
			}
			for (const e of entries) {
				if (e.isDirectory()) await chmodTree(path.join(dir, e.name));
			}
		}
		await chmodTree(tmpDir);
		await fs.rm(tmpDir, { recursive: true, force: true });
		_resetConfigCache();
	});

	// AC2.1 — every worktree receives the component
	it("AC2.1: fans the skill out to wt1's .claude/", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(await exists(path.join(worktrees[0]!, ".claude", "skills", "oracle", "SKILL.md"))).toBe(
			true,
		);
	});

	it("AC2.1: fans the skill out to wt2's .claude/ (separate assertion)", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(await exists(path.join(worktrees[1]!, ".claude", "skills", "oracle", "SKILL.md"))).toBe(
			true,
		);
	});

	// AC2.2 — container itself must NOT receive .claude/
	it("AC2.2: the bare container never gets a .claude/ directory", async () => {
		const { container } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(await exists(path.join(container, ".claude"))).toBe(false);
	});

	// AC2.3 — non-bare path keeps today's single-target behavior
	it("AC2.3 (regression): a plain non-bare path deploys to <path>/.claude/", async () => {
		const plainTarget = path.join(tmpDir, "plain-target");
		await fs.mkdir(plainTarget, { recursive: true });
		await seedSkill("oracle");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${plainTarget}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(await exists(path.join(plainTarget, ".claude", "skills", "oracle", "SKILL.md"))).toBe(
			true,
		);
	});

	// AC3a — one unwritable worktree does not block the others
	it("AC3a: one unwritable worktree does not block deployment to the writable one", async () => {
		const { worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		// Make wt2 unwritable (read+execute, no write): git can still enumerate it
		// (it reads the worktree's .git file), but the deploy's .claude mkdir is denied.
		// chmod 000 would strip execute too → git reports the worktree prunable and it
		// is excluded from enumeration before deploy, which is NOT the failure under test.
		await fs.chmod(worktrees[1]!, 0o555);

		const container = path.dirname(worktrees[0]!);
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		// wt1 still got the skill despite wt2 failing.
		expect(await exists(path.join(worktrees[0]!, ".claude", "skills", "oracle", "SKILL.md"))).toBe(
			true,
		);

		// restore so afterEach cleanup works
		await fs.chmod(worktrees[1]!, 0o755);
	});

	// AC3b — failure is recorded with the worktree path and drives a non-zero exit
	it("AC3b: a failing worktree is recorded in context.failedTargets", async () => {
		const { worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		// read+execute, no write — enumerable by git, unwritable by the deploy (see AC3a).
		await fs.chmod(worktrees[1]!, 0o555);

		const container = path.dirname(worktrees[0]!);
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		// failedTargets is the mechanism the CLI uses to force a non-zero exit.
		expect(context.failedTargets).toContain(worktrees[1]);

		await fs.chmod(worktrees[1]!, 0o755);
	});

	// Bug (1): a config-write failure in a worktree must reach failedTargets so the
	// CLI exits non-zero. The .claude dir is read-only (0o555) but the worktree
	// itself stays writable, so the line-760 mkdir on the pre-existing .claude is a
	// no-op and the failure is isolated to the claude.yaml config write inside
	// syncPlatformConfigs — exactly the error class that used to be swallowed.
	it("Bug1: a worktree whose claude.yaml config write fails is recorded in failedTargets", async () => {
		const { worktrees } = makeBareTopology("repo", ["wt1"]);

		// Pre-create .claude while the worktree is fully writable, then make ONLY
		// .claude read-only. config writes (settings.local.json) into it then fail.
		const claudeDir = path.join(worktrees[0]!, ".claude");
		await fs.mkdir(claudeDir, { recursive: true });
		await fs.chmod(claudeDir, 0o555);

		const container = path.dirname(worktrees[0]!);
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		// config-only claude.yaml (no component sections) → deploysToClaudeDotDir=true.
		await writeFile(syncYamlPath, `path: ${container}\n`);
		await writeFile(path.join(rootDir, "claude.yaml"), "config:\n  theme: dark\n");

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		// The config-write failure must surface as a failed worktree, not be swallowed.
		expect(context.failedTargets).toContain(worktrees[0]);
		// This is the exact expression the CLI uses to choose its exit code.
		expect(context.failedTargets.length > 0 ? 1 : 0).toBe(1);

		await fs.chmod(claudeDir, 0o755);
	});

	// Bug (2): a worktree that fails mid-deploy must NOT be registered as a backup
	// root, so retention cleanup does not prune its last good backup. backupRoots
	// is the success-only invariant: only worktrees that completed all sync steps
	// belong in it.
	it("Bug2: a worktree failing mid-deploy keeps its prior backup and is not a backup root", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1"]);
		await seedSkill("oracle");

		// A prior good backup session already present in the worktree.
		const priorBackup = path.join(worktrees[0]!, ".sync-backup", "good-session", "marker");
		await writeFile(priorBackup, "keep me\n");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		// Adapter that throws during dispatch — AFTER syncCategory's backup+wipe ran,
		// i.e. partway through the per-worktree deploy.
		class FailingAdapter extends ClaudeAdapter {
			override async syncSkillsDirect(): Promise<void> {
				throw new Error("boom during skills dispatch");
			}
		}
		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new FailingAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false, backupSession: "new-session" });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		// The worktree failed, so it is recorded as failed and NOT as a backup root.
		expect(context.failedTargets).toContain(worktrees[0]);
		expect(context.backupRoots.has(worktrees[0]!)).toBe(false);

		// Retention cleanup over the production union (processedPaths ∪ backupRoots)
		// with retentionDays=0 must leave the failed worktree's prior backup intact.
		const cleanupTargets = new Set<string>([...context.processedPaths, ...context.backupRoots]);
		await Promise.all([...cleanupTargets].map((t) => cleanupOldBackups(t, 0).catch(() => {})));

		expect(await exists(path.join(worktrees[0]!, ".sync-backup", "good-session"))).toBe(true);
	});

	// Bug (3): a container sync.yaml and a sync.yaml pointing directly at one of its
	// worktrees must resolve to the same .claude and deploy it exactly once. The
	// dedup key is the RESOLVED deploy target, not the raw container path.
	it("Bug3: a worktree already deployed via its container is recognized as processed (no double deploy)", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1"]);
		await seedSkill("oracle");

		// proj-a points at the bare container.
		const projDir = path.join(rootDir, "projects", "proj-a");
		await fs.mkdir(projDir, { recursive: true });
		await writeFile(
			path.join(projDir, "sync.yaml"),
			`path: ${container}\nname: proj-a\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });
		const effectiveFilter = resolveProjectFilter(new Set(), undefined);

		// Projects phase: deploys the container's worktree.
		await runProjectsLoop(rootDir, adapters, context, effectiveFilter, false);

		// The RESOLVED worktree path (not the raw container) is what dedup must track.
		expect(context.processedPaths.has(worktrees[0]!)).toBe(true);

		// Root phase dedup: a sync.yaml whose path is the worktree itself resolves to
		// [wt1], which is already processed → the CLI must skip it (single deploy).
		expect(allTargetsProcessed(worktrees[0]!, context.processedPaths)).toBe(true);
	});

	// AC5.1 — deriveClaudeProjectKey has EXACTLY ONE call site
	it("AC5.1: deriveClaudeProjectKey has exactly one production call site", () => {
		const claudeSrc = fs2.readFileSync(path.join(import.meta.dir, "adapters", "claude.ts"), "utf8");
		// Count only the call (the import line is `import { deriveClaudeProjectKey }`).
		const callMatches = claudeSrc.match(/deriveClaudeProjectKey\(/g) ?? [];
		expect(callMatches.length).toBe(1);

		// Repo-wide: no other production file calls it.
		const syncSrc = fs2.readFileSync(path.join(import.meta.dir, "sync.ts"), "utf8");
		expect(syncSrc.includes("deriveClaudeProjectKey(")).toBe(false);
	});

	// AC5.2 — MCP keying collapses N worktree writes into ONE ~/.claude.json entry
	it("AC5.2: a fan-out MCP sync writes exactly one projects[key] entry, keyed by the shared .bare", async () => {
		const originalHome = process.env.HOME;
		const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "fanout-fake-home-"));
		process.env.HOME = fakeHome;
		try {
			const { container, worktrees } = makeBareTopology("mcp-repo", ["wt1", "wt2"]);

			// Every worktree resolves to the SAME .bare common-dir key — that shared key
			// is why N per-worktree MCP writes collapse into one ~/.claude.json entry.
			// (The container is never deployed-to, AC2.2, so its key is irrelevant.)
			const k1 = deriveClaudeProjectKey(worktrees[0]!);
			const k2 = deriveClaudeProjectKey(worktrees[1]!);
			expect(k1).toBe(k2);

			// Project-scoped sync.yaml so claude.yaml mcps deploy with scope=local.
			const projDir = path.join(rootDir, "projects", "mcp-proj");
			await fs.mkdir(projDir, { recursive: true });
			const syncYamlPath = path.join(projDir, "sync.yaml");
			await writeFile(syncYamlPath, `path: ${container}\nname: mcp-proj\n`);
			await writeFile(
				path.join(projDir, "claude.yaml"),
				"mcps:\n  my-server:\n    type: stdio\n    command: my-mcp\n",
			);

			const adapters = new Map<Platform, PlatformAdapter>([
				["claude", new ClaudeAdapter()],
			]) as AdapterMap;
			const context = makeContext({ dryRun: false, isRootYaml: false });

			await processYaml(context, syncYamlPath, adapters, rootDir);

			const claudeJson = JSON.parse(
				await fs.readFile(path.join(fakeHome, ".claude.json"), "utf8"),
			) as { projects?: Record<string, unknown> };
			const projects = claudeJson.projects ?? {};
			// N worktree writes collapse to exactly one entry, keyed by the shared .bare.
			expect(Object.keys(projects).length).toBe(1);
			expect(projects[k1]).toBeDefined();
		} finally {
			if (originalHome === undefined) delete process.env.HOME;
			else process.env.HOME = originalHome;
			await fs.rm(fakeHome, { recursive: true, force: true });
		}
	});

	// AC6.1 — dry-run lists each worktree, never the container, writes nothing
	it("AC6.1: dry-run lists each worktree absolute path, not the container, and writes nothing", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: true });

		const lines: string[] = [];
		const origStderr = process.stderr.write.bind(process.stderr);
		process.stderr.write = (chunk: string | Uint8Array) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		};
		try {
			await processYaml(context, syncYamlPath, adapters, rootDir);
		} finally {
			process.stderr.write = origStderr;
		}

		const out = lines.join("");
		// Each worktree absolute path appears as a deploy target line.
		expect(out).toContain(worktrees[0]!);
		expect(out).toContain(worktrees[1]!);
		// No files written in dry-run.
		expect(await exists(path.join(worktrees[0]!, ".claude"))).toBe(false);
		expect(await exists(path.join(worktrees[1]!, ".claude"))).toBe(false);
		expect(await exists(path.join(container, ".claude"))).toBe(false);
	});

	// AC6.2 — pre-placed rule survives the wipe (rules exempt)
	it("AC6.2: a pre-placed rule under wt1 survives the fan-out wipe", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		// Pre-place a user rule in wt1/.claude/rules.
		const rulePath = path.join(worktrees[0]!, ".claude", "rules", "x.md");
		await writeFile(rulePath, "# user rule\n");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(await exists(rulePath)).toBe(true);
	});

	// AC6.3 — per-worktree backup of replaced category lands under each worktree
	it("AC6.3: replacing the skills category backs the old skill up under wt1's .sync-backup", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		// Pre-place an old skill in wt1 that the wipe will replace.
		const oldSkill = path.join(worktrees[0]!, ".claude", "skills", "old", "SKILL.md");
		await writeFile(oldSkill, "# old\n");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false, backupSession: "sess-ac63" });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		const backupCopy = path.join(
			worktrees[0]!,
			".sync-backup",
			"sess-ac63",
			"claude",
			"skills",
			"old",
			"SKILL.md",
		);
		expect(await exists(backupCopy)).toBe(true);
	});

	// AC6.4 — fanned-out worktree backups are retention-pruned
	it("AC6.4: retention cleanup removes stale backup sessions from each worktree's .sync-backup", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await seedSkill("oracle");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(
			syncYamlPath,
			`path: ${container}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;

		// Pre-place old content in both worktrees so cycle 1 has something to back up.
		await writeFile(path.join(worktrees[0]!, ".claude", "skills", "old", "SKILL.md"), "# old\n");
		await writeFile(path.join(worktrees[1]!, ".claude", "skills", "old", "SKILL.md"), "# old\n");

		// Cycle 1: backs up the pre-placed content into "old-session" in each worktree.
		const context1 = makeContext({ dryRun: false, backupSession: "old-session" });
		await processYaml(context1, syncYamlPath, adapters, rootDir);

		// Confirm old-session backup exists in both worktrees before cleanup.
		const oldBk0 = path.join(worktrees[0]!, ".sync-backup", "old-session");
		const oldBk1 = path.join(worktrees[1]!, ".sync-backup", "old-session");
		expect(await exists(oldBk0)).toBe(true);
		expect(await exists(oldBk1)).toBe(true);

		// Verify the OLD behavior (processedPaths-only) does NOT reach the worktree backups:
		// processedPaths holds only the container path for bare structures.
		await Promise.all(
			[...context1.processedPaths].map((t) => cleanupOldBackups(t, 0).catch(() => {})),
		);
		expect(await exists(oldBk0)).toBe(true); // still present — container-only cleanup misses worktrees
		expect(await exists(oldBk1)).toBe(true);

		// Cycle 2: oracle is now present in each worktree, so it gets backed up as "new-session".
		const context2 = makeContext({ dryRun: false, backupSession: "new-session" });
		await processYaml(context2, syncYamlPath, adapters, rootDir);

		// Run cleanup on the union of processedPaths + backupRoots (retention=0 prunes all sessions).
		// This mirrors the production loop after the TODO-3 fix.
		const cleanupTargets = new Set<string>([...context2.processedPaths, ...context2.backupRoots]);
		await Promise.all([...cleanupTargets].map((t) => cleanupOldBackups(t, 0).catch(() => {})));

		// Both worktrees' old-session dirs must now be removed.
		expect(await exists(oldBk0)).toBe(false);
		expect(await exists(oldBk1)).toBe(false);
	});

	// DeployTargetsError escapes the per-project catch (re-throw, like ProjectKeyError)
	it("DeployTargetsError escapes the per-project isolation catch so it reaches a non-zero exit", async () => {
		// Bare-structure with ZERO worktrees → resolveDeployTargets throws DeployTargetsError.
		const container = path.join(tmpDir, "empty-bare");
		await fs.mkdir(container, { recursive: true });
		const bareDir = path.join(container, ".bare");
		execFileSync("git", ["init", "--bare", bareDir], { stdio: "pipe", env: GIT_ENV });
		seedBareRepo(bareDir);
		// no worktree added → resolveDeployTargets throws

		await seedSkill("oracle");
		const projDir = path.join(rootDir, "projects", "empty-proj");
		await fs.mkdir(projDir, { recursive: true });
		await writeFile(
			path.join(projDir, "sync.yaml"),
			`path: ${container}\nname: empty-proj\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });
		const effectiveFilter = resolveProjectFilter(new Set(), undefined);

		await expect(
			runProjectsLoop(rootDir, adapters, context, effectiveFilter, false),
		).rejects.toBeInstanceOf(DeployTargetsError);
	});

	// ---------------------------------------------------------------------
	// TODO 11 — syncDocs wired into processYaml's per-deployRoot fan-out
	// ---------------------------------------------------------------------

	// AC2.6 (part 1) — docs fans out to every resolved worktree, same as any
	// other component type.
	it("docs fan-out: deploys the doc into every worktree", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1", "wt2"]);
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(syncYamlPath, `path: ${container}\ndocs:\n  items:\n    - intro\n`);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(await readFile(path.join(worktrees[0]!, "docs", "intro.md"))).toBe("# Intro\n");
		expect(await readFile(path.join(worktrees[1]!, "docs", "intro.md"))).toBe("# Intro\n");
	});

	// AC2.6 (part 2) — a project sync.yaml and the root sync.yaml resolving to
	// the same worktree must deploy the doc exactly once. syncDocs adds no
	// dedup of its own; it inherits the existing processedPaths mechanism for
	// free because it runs inside processYaml's per-deployRoot loop, same as
	// every other component type (mirrors the "Bug3" dedup test above).
	it("docs fan-out: a project sync.yaml and root sync.yaml resolving to the same worktree deploy the doc once", async () => {
		const { container, worktrees } = makeBareTopology("repo", ["wt1"]);
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");

		const projDir = path.join(rootDir, "projects", "proj-a");
		await fs.mkdir(projDir, { recursive: true });
		await writeFile(
			path.join(projDir, "sync.yaml"),
			`path: ${container}\nname: proj-a\ndocs:\n  items:\n    - intro\n`,
		);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });
		const effectiveFilter = resolveProjectFilter(new Set(), undefined);

		// Projects phase: deploys the doc into the container's worktree.
		await runProjectsLoop(rootDir, adapters, context, effectiveFilter, false);

		expect(await readFile(path.join(worktrees[0]!, "docs", "intro.md"))).toBe("# Intro\n");

		// Root phase dedup: a sync.yaml whose path resolves to the same worktree
		// is already processed, so the CLI skips calling processYaml (and thus
		// syncDocs) again for it — single deploy.
		expect(allTargetsProcessed(worktrees[0]!, context.processedPaths)).toBe(true);
	});

	// AC2.2 — a docs-only sync.yaml (no agents/skills/etc.) still deploys its
	// docs: proves the call site is NOT gated behind shouldMkdirClaude.
	it("docs-only deploys: a sync.yaml with only a docs section still deploys, with no .claude gate", async () => {
		const plainTarget = path.join(tmpDir, "docs-only-target");
		await fs.mkdir(plainTarget, { recursive: true });
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");

		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(syncYamlPath, `path: ${plainTarget}\ndocs:\n  items:\n    - intro\n`);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(await readFile(path.join(plainTarget, "docs", "intro.md"))).toBe("# Intro\n");
		// No component sections and no claude.yaml → shouldMkdirClaude is false;
		// docs must still deploy without a .claude/ directory ever appearing.
		expect(await exists(path.join(plainTarget, ".claude"))).toBe(false);
	});

	// AC2.1 — a syncDocs throw routes the whole worktree to failedTargets, same
	// as any other deploy-step failure in the per-deployRoot try/catch.
	it("docs failure routes failedTargets: a syncDocs throw records the worktree as failed", async () => {
		const { worktrees } = makeBareTopology("repo", ["wt1"]);

		// Two items resolving to the identical real leaf trip syncDocs's
		// pre-flight collision guard — a clean, deterministic way to force a
		// docs failure without touching fs modes. The collision check now keys
		// off the REAL leaf (post-extension), so the source must actually exist
		// for both items to resolve and collide.
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");
		const container = path.dirname(worktrees[0]!);
		const syncYamlPath = path.join(rootDir, "sync.yaml");
		await writeFile(syncYamlPath, `path: ${container}\ndocs:\n  items:\n    - intro\n    - intro\n`);

		const adapters = new Map<Platform, PlatformAdapter>([
			["claude", new ClaudeAdapter()],
		]) as AdapterMap;
		const context = makeContext({ dryRun: false });

		await processYaml(context, syncYamlPath, adapters, rootDir);

		expect(context.failedTargets).toContain(worktrees[0]);
	});
});

// ---------------------------------------------------------------------------
// Suite: syncDocs
// ---------------------------------------------------------------------------

describe("syncDocs", () => {
	let tmpDir: string;
	let rootDir: string;
	let deployRoot: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-docs-test-"));
		rootDir = path.join(tmpDir, "root");
		deployRoot = path.join(tmpDir, "deploy");
		await fs.mkdir(rootDir, { recursive: true });
		await fs.mkdir(deployRoot, { recursive: true });
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("is a no-op when the docs section is absent", async () => {
		const syncYaml: SyncYaml = { path: deployRoot };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await exists(path.join(deployRoot, "docs"))).toBe(false);
	});

	it("is a no-op when docs.items is empty", async () => {
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: [] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await exists(path.join(deployRoot, "docs"))).toBe(false);
	});

	// --- AC2.3: docs path/as resolution ---

	it("docs path/as resolution: deploys under the default 'docs' base for a plain string item", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["intro"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "intro.md"))).toBe("# Intro\n");
	});

	it("docs path/as resolution: item `path` can walk back out of the section base while staying under deployRoot", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "intro", path: "../top-level.md" }] },
		};
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "top-level.md"))).toBe("# Intro\n");
		expect(await exists(path.join(deployRoot, "docs", "intro.md"))).toBe(false);
	});

	it("docs path/as resolution: `as` renames the final file segment", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "intro", as: "README" }] },
		};
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "README.md"))).toBe("# Intro\n");
	});

	it("docs path/as resolution: `as` renames a dir-form target directory", async () => {
		await writeFile(path.join(rootDir, "docs", "guide", "a.md"), "# A\n");
		await writeFile(path.join(rootDir, "docs", "guide", "b.md"), "# B\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "guide", as: "renamed-guide" }] },
		};
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "renamed-guide", "a.md"))).toBe("# A\n");
		expect(await readFile(path.join(deployRoot, "docs", "renamed-guide", "b.md"))).toBe("# B\n");
		expect(await exists(path.join(deployRoot, "docs", "guide"))).toBe(false);
	});

	// --- AC2.4: nested component name ---

	it("docs nested name: component 'skills/authoring' deploys to docs/skills/authoring.md", async () => {
		await writeFile(path.join(rootDir, "docs", "skills", "authoring.md"), "# Authoring\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["skills/authoring"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "skills", "authoring.md"))).toBe(
			"# Authoring\n",
		);
	});

	// F5: `path.extname` on a DOTTED stem like "api.v2" reports ".v2" as an
	// extension already present, wrongly suppressing the real source extension
	// append — the fix compares against the SOURCE's own extension instead.
	it("docs dotted stem: a dotted component name still gets the source's extension appended", async () => {
		await writeFile(path.join(rootDir, "docs", "api.v2.md"), "# API v2\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["api.v2"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "api.v2.md"))).toBe("# API v2\n");
		expect(await exists(path.join(deployRoot, "docs", "api.v2"))).toBe(false);
	});

	// --- AC2.5: hybrid form ---

	it("docs hybrid form: a file-form source deploys as a single file", async () => {
		await writeFile(path.join(rootDir, "docs", "single.md"), "# Single\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["single"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "single.md"))).toBe("# Single\n");
	});

	it("docs hybrid form: a dir-form source deploys additively", async () => {
		await writeFile(path.join(rootDir, "docs", "bundle", "one.md"), "# One\n");
		await writeFile(path.join(rootDir, "docs", "bundle", "sub", "two.md"), "# Two\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["bundle"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "bundle", "one.md"))).toBe("# One\n");
		expect(await readFile(path.join(deployRoot, "docs", "bundle", "sub", "two.md"))).toBe("# Two\n");
	});

	// --- AC3.1: overwrite ---

	it("docs overwrite: a declared item overwrites the existing target unconditionally", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# New\n");
		await writeFile(path.join(deployRoot, "docs", "intro.md"), "# Old\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["intro"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "intro.md"))).toBe("# New\n");
	});

	// --- AC3.2: delete idempotent ---

	it("docs delete idempotent: delete:true removes an existing target", async () => {
		await writeFile(path.join(deployRoot, "docs", "old.md"), "# Old\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "old", as: "old.md", delete: true }] },
		};
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await exists(path.join(deployRoot, "docs", "old.md"))).toBe(false);
	});

	it("docs delete idempotent: delete:true is a no-op when the target is already absent", async () => {
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "missing", delete: true }] },
		};
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).resolves.toBeUndefined();
	});

	// F2: a delete item has no source, so resolveDocsTarget only gives its bare,
	// pre-extension stem ("docs/intro") — the real on-disk leaf ("docs/intro.md")
	// must be discovered by basename, not assumed to equal the bare stem.
	it("docs delete real leaf: delete:true with a bare component name removes the real extensioned leaf on disk", async () => {
		await writeFile(path.join(deployRoot, "docs", "intro.md"), "# Old\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "intro", delete: true }] },
		};
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await exists(path.join(deployRoot, "docs", "intro.md"))).toBe(false);

		// Idempotent: a second run against the now-absent leaf is a no-op.
		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).resolves.toBeUndefined();
	});

	it("docs delete real leaf: a similarly-named file is never treated as a tombstone candidate", async () => {
		await writeFile(path.join(deployRoot, "docs", "introduction.md"), "keep me\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "intro", delete: true }] },
		};
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "introduction.md"))).toBe("keep me\n");
	});

	// The extension-branch match (`${base}.` prefix) must require a FILE: a
	// human DIRECTORY sharing that dot-prefix (e.g. "intro.assets/" for stem
	// "intro") is not a file-form candidate for the "intro" tombstone and must
	// never be resolved — let alone recursively removed — by delete:true.
	it("docs delete candidate: a human directory sharing the stem's dot-prefix is never a delete candidate", async () => {
		await writeFile(path.join(deployRoot, "docs", "intro.assets", "diagram.png"), "binary\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "intro", delete: true }] },
		};
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await exists(path.join(deployRoot, "docs", "intro.assets", "diagram.png"))).toBe(true);
	});

	it("docs delete candidate control: a real intro.md file-form leaf is still removed by delete:true", async () => {
		await writeFile(path.join(deployRoot, "docs", "intro.md"), "# Old\n");
		await writeFile(path.join(deployRoot, "docs", "intro.assets", "diagram.png"), "binary\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "intro", delete: true }] },
		};
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await exists(path.join(deployRoot, "docs", "intro.md"))).toBe(false);
		expect(await exists(path.join(deployRoot, "docs", "intro.assets", "diagram.png"))).toBe(true);
	});

	it("docs delete ambiguous tombstone: a file-form AND a dir-form candidate matching the same stem throws and touches neither", async () => {
		await writeFile(path.join(deployRoot, "docs", "intro.md"), "# Old\n");
		await writeFile(path.join(deployRoot, "docs", "intro", "nested.md"), "stale\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "intro", delete: true }] },
		};
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow(/ambiguous tombstone/);
		expect(await readFile(path.join(deployRoot, "docs", "intro.md"))).toBe("# Old\n");
		expect(await readFile(path.join(deployRoot, "docs", "intro", "nested.md"))).toBe("stale\n");
	});

	// --- AC3.3: anti-wipe ---

	it("docs anti-wipe: an undeclared sibling file survives a sync", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");
		await writeFile(path.join(deployRoot, "docs", "human-note.md"), "human content\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["intro"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "human-note.md"))).toBe("human content\n");
	});

	it("docs anti-wipe: an undeclared file inside a dir-form target survives", async () => {
		await writeFile(path.join(rootDir, "docs", "foo", "a.md"), "# A\n");
		await writeFile(path.join(deployRoot, "docs", "foo", "human.md"), "human content\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["foo"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "foo", "human.md"))).toBe(
			"human content\n",
		);
		expect(await readFile(path.join(deployRoot, "docs", "foo", "a.md"))).toBe("# A\n");
	});

	// --- AC3.4 vs anti-wipe: form-morph never recursively wipes a directory ---
	//
	// F4 reconciliation: a file-form item's real write leaf carries an appended
	// extension (docs/foo.md), so a pre-existing DIRECTORY sitting at the bare,
	// pre-extension stem (docs/foo/) never actually collides with it on disk —
	// anti-wipe wins, and that directory (however "stale"-looking) survives.

	it("docs form-morph: a file-form deploy coexists with a stale dir-form entry at the bare stem (anti-wipe wins)", async () => {
		await writeFile(path.join(rootDir, "docs", "foo.md"), "# Foo\n");
		await writeFile(path.join(deployRoot, "docs", "foo", "old.md"), "stale\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["foo"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "foo", "old.md"))).toBe("stale\n");
		expect(await readFile(path.join(deployRoot, "docs", "foo.md"))).toBe("# Foo\n");
	});

	it("docs form-morph: a dir-form deploy removes a single stale squatting FILE at its exact target, never a directory", async () => {
		await writeFile(path.join(rootDir, "docs", "bundle", "one.md"), "# One\n");
		await writeFile(path.join(deployRoot, "docs", "bundle"), "stale file\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["bundle"] } };
		const context = makeContext({ backupSession: "form-morph-sess" });

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "bundle", "one.md"))).toBe("# One\n");
		const backupFile = path.join(
			deployRoot,
			".sync-backup",
			"form-morph-sess",
			"docs",
			"docs",
			"bundle",
		);
		expect(await readFile(backupFile)).toBe("stale file\n");
	});

	it("docs form-morph: a different sibling target is untouched by a flip", async () => {
		await writeFile(path.join(rootDir, "docs", "foo.md"), "# Foo\n");
		await writeFile(path.join(deployRoot, "docs", "foo", "old.md"), "stale\n");
		await writeFile(path.join(deployRoot, "docs", "bar", "keep.md"), "keep me\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["foo"] } };
		const context = makeContext();

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		expect(await readFile(path.join(deployRoot, "docs", "bar", "keep.md"))).toBe("keep me\n");
	});

	// --- AC4.3/4.4: pre-flight collision rejection ---

	it("docs duplicate target: two items resolving to the same target throws before mutating anything", async () => {
		await writeFile(path.join(rootDir, "docs", "a.md"), "# A\n");
		await writeFile(path.join(rootDir, "docs", "b.md"), "# B\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: {
				items: [
					{ component: "a", as: "same" },
					{ component: "b", as: "same" },
				],
			},
		};
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await exists(path.join(deployRoot, "docs"))).toBe(false);
	});

	it("docs case collision: two items differing only by case throws before mutating anything", async () => {
		await writeFile(path.join(rootDir, "docs", "a.md"), "# A\n");
		await writeFile(path.join(rootDir, "docs", "b.md"), "# B\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: {
				items: [
					{ component: "a", as: "Same" },
					{ component: "b", as: "same" },
				],
			},
		};
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await exists(path.join(deployRoot, "docs"))).toBe(false);
	});

	// F3: a collision that only appears AFTER extension resolution — the bare
	// stems ("docs/intro" vs "docs/intro.md") differ lexically, so a
	// pre-extension check would miss this, but both resolve to the identical
	// real write leaf "docs/intro.md" once each source's extension is applied.
	it("docs post-extension collision: two items whose bare stems differ but whose real leaves match throws before mutating anything", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");
		await writeFile(path.join(rootDir, "docs", "guide.md"), "# Guide\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: ["intro", { component: "guide", as: "intro.md" }] },
		};
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await exists(path.join(deployRoot, "docs"))).toBe(false);
	});

	// finding6 (defensive): an item resolving to the docs base directory itself
	// would let a single item treat the ENTIRE shared docs folder as one
	// write/delete target — e.g. {component: '.', delete: true} would otherwise
	// resolve to the bare stem "docs" and, discovered as a lone on-disk
	// candidate, recursively wipe every human file already under it.
	it("docs base-wipe guard: an item resolving to the docs base directory throws instead of wiping the folder", async () => {
		await writeFile(path.join(deployRoot, "docs", "human-note.md"), "human content\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: ".", delete: true }] },
		};
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await readFile(path.join(deployRoot, "docs", "human-note.md"))).toBe("human content\n");
	});

	// A trailing slash on section.path must not bypass the base-wipe guard: the
	// guard compares a normalized base against the item's bare stem, and
	// path.posix.normalize preserves a trailing slash while resolveDocsTarget's
	// bare stem never carries one — a naive string `===` would then miss this
	// and let a schema-valid `{path: "docs/"}` config recursively wipe docs/.
	it("docs base-wipe guard: a trailing slash on section.path still triggers the guard instead of wiping the folder", async () => {
		await writeFile(path.join(deployRoot, "docs", "human-note.md"), "human content\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { path: "docs/", items: [{ component: ".", delete: true }] },
		};
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await readFile(path.join(deployRoot, "docs", "human-note.md"))).toBe("human content\n");
	});

	// --- AC4.1/4.2: FS-level symlink-escape guards (runtime, beyond lexical containment) ---
	//
	// `docs` is NO-WIPE and human-co-authored, so it can preserve a human-planted
	// symlink that a plain cp/rm would follow straight out of the docs tree.
	// Lexical containment (resolveDocsTarget) cannot see a symlinked directory —
	// these guards are the actual escape-prevention layer at runtime.

	it("docs traversal runtime: an item path escaping deployRoot is rejected before mutating anything", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: [{ component: "intro", path: "../../outside.md" }] },
		};
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await exists(path.join(deployRoot, "docs"))).toBe(false);
	});

	it("docs source symlink: a symlinked source file is rejected and nothing is deployed", async () => {
		const externalFile = path.join(tmpDir, "external.md");
		await writeFile(externalFile, "external content\n");
		await fs.mkdir(path.join(rootDir, "docs"), { recursive: true });
		await fs.symlink(externalFile, path.join(rootDir, "docs", "linked.md"));
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["linked"] } };
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await exists(path.join(deployRoot, "docs", "linked.md"))).toBe(false);
	});

	it("docs source symlink: a symlinked file inside a dir-form source is rejected and nothing is deployed", async () => {
		await writeFile(path.join(rootDir, "docs", "bundle", "one.md"), "# One\n");
		const externalFile = path.join(tmpDir, "external-two.md");
		await writeFile(externalFile, "external content\n");
		await fs.symlink(externalFile, path.join(rootDir, "docs", "bundle", "two.md"));
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["bundle"] } };
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await exists(path.join(deployRoot, "docs", "bundle"))).toBe(false);
	});

	it("docs target symlink: a pre-existing leaf symlink to an external file is not followed on overwrite", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# New\n");
		const externalFile = path.join(tmpDir, "external-leaf.md");
		await writeFile(externalFile, "external content\n");
		await fs.mkdir(path.join(deployRoot, "docs"), { recursive: true });
		await fs.symlink(externalFile, path.join(deployRoot, "docs", "intro.md"));
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["intro"] } };
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await readFile(externalFile)).toBe("external content\n");
	});

	it("docs intermediate symlink: a symlinked intermediate target directory refuses the write", async () => {
		await writeFile(path.join(rootDir, "docs", "api", "x.md"), "# X\n");
		const externalDir = path.join(tmpDir, "external-dir");
		await fs.mkdir(externalDir, { recursive: true });
		await fs.mkdir(path.join(deployRoot, "docs"), { recursive: true });
		await fs.symlink(externalDir, path.join(deployRoot, "docs", "api"));
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["api"] } };
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await fs.readdir(externalDir)).toEqual([]);
	});

	// F1: the coarse guard above only reaches the item's own bare stem
	// (deployRoot/docs/foo); a dir-form deploy also writes NESTED files below
	// that stem (deployRoot/docs/foo/sub/x.md), and a symlink planted at that
	// deeper intermediate segment is a write-escape the coarse guard cannot see.
	it("docs nested intermediate symlink: a symlink under a dir-form target's own subdirectory refuses the write", async () => {
		await writeFile(path.join(rootDir, "docs", "foo", "sub", "x.md"), "# X\n");
		const externalDir = path.join(tmpDir, "external-sub-dir");
		await fs.mkdir(externalDir, { recursive: true });
		await fs.mkdir(path.join(deployRoot, "docs", "foo"), { recursive: true });
		await fs.symlink(externalDir, path.join(deployRoot, "docs", "foo", "sub"));
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["foo"] } };
		const context = makeContext();

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await fs.readdir(externalDir)).toEqual([]);
	});

	// --- Backup evidence: every mutation is recoverable ---

	it("backs up the pre-existing file before an overwrite", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# New\n");
		await writeFile(path.join(deployRoot, "docs", "intro.md"), "# Old\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["intro"] } };
		const context = makeContext({ backupSession: "sess1" });

		await syncDocs(context, syncYaml, rootDir, deployRoot);

		// backupDocs preserves the FULL deployRoot-relative path (including the
		// docs section's own "docs/" segment) under the fixed .sync-backup/<session>/docs/
		// namespace — so a target already living at deployRoot/docs/intro.md backs
		// up to .sync-backup/sess1/docs/docs/intro.md (see lib/backup.ts:backupDocs).
		const backupFile = path.join(deployRoot, ".sync-backup", "sess1", "docs", "docs", "intro.md");
		expect(await readFile(backupFile)).toBe("# Old\n");
	});

	// --- AC5.2: dry-run preview branch ---

	it("docs dry run: previews write/delete plans and an advisory list, and writes nothing to disk", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# Intro\n");
		await writeFile(path.join(deployRoot, "docs", "old.md"), "# Old\n");
		await writeFile(path.join(deployRoot, "docs", "human-note.md"), "human content\n");
		const syncYaml: SyncYaml = {
			path: deployRoot,
			docs: { items: ["intro", { component: "old", as: "old.md", delete: true }] },
		};
		const context = makeContext({ dryRun: true });

		const lines: string[] = [];
		const origStderr = process.stderr.write.bind(process.stderr);
		process.stderr.write = (chunk: string | Uint8Array) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		};
		try {
			await syncDocs(context, syncYaml, rootDir, deployRoot);
		} finally {
			process.stderr.write = origStderr;
		}

		// AC5.2a: write plan for the declared (non-delete) item.
		const writeLines = lines.filter((l) => l.includes("write"));
		expect(writeLines.some((l) => l.includes(path.join(deployRoot, "docs", "intro.md")))).toBe(
			true,
		);

		// AC5.2b: delete plan for the delete:true item.
		const removeLines = lines.filter((l) => l.includes("remove"));
		expect(removeLines.some((l) => l.includes(path.join(deployRoot, "docs", "old.md")))).toBe(true);

		// AC5.2c: advisory line for the undeclared file — but NOT for the
		// delete:true item's own target (its removal is already reported above;
		// it must not also read as unmanaged drift).
		const advisoryLines = lines.filter((l) => l.includes("advisory"));
		expect(
			advisoryLines.some((l) => l.includes(path.join(deployRoot, "docs", "human-note.md"))),
		).toBe(true);
		expect(advisoryLines.some((l) => l.includes("old.md"))).toBe(false);

		// AC5.2d: write nothing — filesystem is byte-identical to before.
		expect(await exists(path.join(deployRoot, "docs", "intro.md"))).toBe(false);
		expect(await readFile(path.join(deployRoot, "docs", "old.md"))).toBe("# Old\n");
		expect(await readFile(path.join(deployRoot, "docs", "human-note.md"))).toBe(
			"human content\n",
		);
		expect(await exists(path.join(deployRoot, ".sync-backup"))).toBe(false);
	});

	it("docs dry run: dir-form item previews each source file's destination", async () => {
		await writeFile(path.join(rootDir, "docs", "bundle", "one.md"), "# One\n");
		await writeFile(path.join(rootDir, "docs", "bundle", "sub", "two.md"), "# Two\n");
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["bundle"] } };
		const context = makeContext({ dryRun: true });

		const lines: string[] = [];
		const origStderr = process.stderr.write.bind(process.stderr);
		process.stderr.write = (chunk: string | Uint8Array) => {
			if (typeof chunk === "string") lines.push(chunk);
			return true;
		};
		try {
			await syncDocs(context, syncYaml, rootDir, deployRoot);
		} finally {
			process.stderr.write = origStderr;
		}

		const output = lines.join("");
		expect(output).toContain(path.join(deployRoot, "docs", "bundle", "one.md"));
		expect(output).toContain(path.join(deployRoot, "docs", "bundle", "sub", "two.md"));
		expect(await exists(path.join(deployRoot, "docs", "bundle"))).toBe(false);
	});

	it("docs dry guards: a pre-existing leaf symlink target is rejected in preview, never previewed as a successful write", async () => {
		await writeFile(path.join(rootDir, "docs", "intro.md"), "# New\n");
		const externalFile = path.join(tmpDir, "external-leaf.md");
		await writeFile(externalFile, "external content\n");
		await fs.mkdir(path.join(deployRoot, "docs"), { recursive: true });
		await fs.symlink(externalFile, path.join(deployRoot, "docs", "intro.md"));
		const syncYaml: SyncYaml = { path: deployRoot, docs: { items: ["intro"] } };
		const context = makeContext({ dryRun: true });

		await expect(syncDocs(context, syncYaml, rootDir, deployRoot)).rejects.toThrow();
		expect(await readFile(externalFile)).toBe("external content\n");
	});
});
