import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { existsSync } from "fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  syncCategory,
  syncPlatformConfigs,
  processYaml,
  syncLib,
  rewritePlatformPaths,
  rewriteLibAliases,
  createContext,
  type AdapterMap,
} from "./sync.ts";
import type { SyncContext, Platform, Category, SyncYaml } from "./lib/types.ts";
import type { PlatformAdapter } from "./adapters/types.ts";
import { _resetConfigCache } from "./lib/config.ts";

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

  const record = (method: string) =>
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
    ...overrides,
  };
}

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

  it("올바른 어댑터에 dispatch한다 (claude)", async () => {
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

    await syncCategory(context, "skills", syncYaml, adapters, rootDir);

    const claudeCalls = adapters.getAdapter("claude")!.calls;
    expect(claudeCalls.some((c) => c.method === "syncSkillsDirect")).toBe(true);

    const geminiCalls = adapters.getAdapter("gemini")!.calls;
    expect(geminiCalls.filter((c) => c.method === "syncSkillsDirect")).toHaveLength(0);
  });

  it("item-level platforms override로 gemini에만 dispatch한다", async () => {
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

    await syncCategory(context, "commands", syncYaml, adapters, rootDir);

    expect(adapters.getAdapter("gemini")!.calls.some((c) => c.method === "syncCommandsDirect")).toBe(true);
    expect(adapters.getAdapter("claude")!.calls.filter((c) => c.method === "syncCommandsDirect")).toHaveLength(0);
  });

  it("agents 카테고리에서 syncAgentsDirect를 호출한다", async () => {
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

    await syncCategory(context, "agents", syncYaml, adapters, rootDir);

    const calls = adapters.getAdapter("claude")!.calls;
    expect(calls.some((c) => c.method === "syncAgentsDirect")).toBe(true);
  });

  it("component가 없는 항목을 스킵한다", async () => {
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
    await syncCategory(context, "rules", syncYaml, adapters, rootDir);
    expect(adapters.getAdapter("claude")!.calls.filter((c) => c.method === "syncRulesDirect")).toHaveLength(0);
  });

  it("items 배열이 없으면 아무것도 하지 않는다", async () => {
    const syncYaml: SyncYaml = {
      path: targetPath,
      scripts: {},
    };

    const adapters = makeAdapterMap(["claude"]);
    const context = makeContext({ dryRun: false });

    await syncCategory(context, "scripts", syncYaml, adapters, rootDir);
    expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
  });

  it("dry-run 시 파일 쓰기 없이 logDry만 호출한다", async () => {
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

    await syncCategory(context, "agents", syncYaml, adapters, rootDir);

    // Adapter syncAgentsDirect should NOT be called in dry-run
    const calls = adapters.getAdapter("claude")!.calls;
    expect(calls.filter((c) => c.method === "syncAgentsDirect")).toHaveLength(0);
  });

  it("sync 후 orphan 파일이 삭제된다 (P1-3)", async () => {
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

    await syncCategory(context, "agents", syncYaml, adapters, rootDir);

    // Orphan should be gone: wipe+recreate cleared the dir before writing
    expect(await exists(path.join(claudeAgentsDir, "orphan-agent.md"))).toBe(false);
  });

  it("agents 카테고리에서 add-hooks component를 해석해 source_path와 display_name을 첨부한다", async () => {
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

    await syncCategory(context, "agents", syncYaml, adapters, rootDir);

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

  it("add-hooks에서 존재하지 않는 component는 경고 후 스킵된다", async () => {
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
    await syncCategory(context, "agents", syncYaml, adapters, rootDir);

    const calls = adapters.getAdapter("claude")!.calls;
    const agentCall = calls.find((c) => c.method === "syncAgentsDirect");
    expect(agentCall).toBeDefined();
    // addHooks should be undefined since the only hook failed to resolve
    const addHooks = agentCall!.args[4] as unknown[] | undefined;
    expect(addHooks == null || addHooks.length === 0).toBe(true);
  });

  it("rules 카테고리는 디렉토리를 초기화하지 않는다 (P1-3)", async () => {
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

    await syncCategory(context, "rules", syncYaml, adapters, rootDir);

    // manual-rule.md must still exist — rules dir is never wiped
    expect(await exists(path.join(claudeRulesDir, "manual-rule.md"))).toBe(true);
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

  it("claude.yaml 발견 시 claude 어댑터의 syncPlatformYaml을 호출한다", async () => {
    await writeFile(
      path.join(yamlDir, "claude.yaml"),
      "config:\n  theme: dark\n",
    );

    const adapters = makeAdapterMap(["claude", "gemini"]);
    const context = makeContext();

    await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

    const calls = adapters.getAdapter("claude")!.calls;
    expect(calls.some((c) => c.method === "syncPlatformYaml")).toBe(true);
    // gemini adapter not called (no gemini.yaml)
    expect(adapters.getAdapter("gemini")!.calls.filter((c) => c.method === "syncPlatformYaml")).toHaveLength(0);
  });

  it("model-map이 context.modelMaps에 저장된다 (P2-1)", async () => {
    await writeFile(
      path.join(yamlDir, "codex.yaml"),
      "model-map:\n  claude-3: o3\n",
    );

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

  it("processedSections이 context.platformYamlSections에 저장된다", async () => {
    await writeFile(
      path.join(yamlDir, "gemini.yaml"),
      "config:\n  key: val\n",
    );

    const geminiAdapter = makeMockAdapter("gemini");
    geminiAdapter.syncPlatformYaml = async (_t, _y, _d) => ({
      processedSections: ["config", "mcps"],
      modelMap: undefined,
    });

    const adapters = new Map<Platform, PlatformAdapter>([["gemini", geminiAdapter]]) as AdapterMap & {
      getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
    };
    adapters.getAdapter = (_p: Platform) => undefined;

    const context = makeContext();

    await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

    expect(context.platformYamlSections.get("gemini")).toEqual(["config", "mcps"]);
  });

  it("platform YAML 없으면 아무것도 하지 않는다", async () => {
    const adapters = makeAdapterMap(["claude"]);
    const context = makeContext();

    await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

    expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
    expect(context.platformYamlSections.size).toBe(0);
  });

  it("hooks component를 절대 경로로 변환해 어댑터에 전달한다", async () => {
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

    const adapters = new Map<Platform, PlatformAdapter>([["claude", claudeAdapter]]) as AdapterMap & {
      getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
    };
    adapters.getAdapter = (_p: Platform) => claudeAdapter;

    const context = makeContext();
    await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

    // The adapter should have received the resolved absolute path
    expect(receivedYamls.length).toBe(1);
    const hooksMap = (receivedYamls[0] as Record<string, unknown>)["hooks"] as Record<string, Array<Record<string, unknown>>>;
    const items = hooksMap["UserPromptSubmit"];
    expect(items).toBeDefined();
    expect(items[0]["component"]).toBe(hookFile);
  });

  it("존재하지 않는 hook component는 경고 후 스킵된다", async () => {
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

    const adapters = new Map<Platform, PlatformAdapter>([["claude", claudeAdapter]]) as AdapterMap & {
      getAdapter: (p: Platform) => ReturnType<typeof makeMockAdapter> | undefined;
    };
    adapters.getAdapter = (_p: Platform) => claudeAdapter;

    const context = makeContext();
    // Should not throw
    await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

    // The adapter is still called, but hooks item is removed
    expect(receivedYamls.length).toBe(1);
    const hooksMap = (receivedYamls[0] as Record<string, unknown>)["hooks"] as Record<string, Array<Record<string, unknown>>>;
    const items = hooksMap["UserPromptSubmit"];
    expect(items).toHaveLength(0);
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

  it("syncPlatformConfigs 먼저 호출 후 5개 카테고리 처리한다", async () => {
    // Create a claude.yaml to trigger syncPlatformConfigs
    const syncYamlPath = path.join(rootDir, "sync.yaml");
    await writeFile(syncYamlPath, `path: ${targetPath}\n`);
    await writeFile(
      path.join(rootDir, "claude.yaml"),
      "config:\n  theme: dark\n",
    );

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

  it("config/hooks/mcps/plugins 섹션을 처리하지 않는다 (P2-3)", async () => {
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

  it("path 없는 sync.yaml을 경고와 함께 스킵한다", async () => {
    const syncYamlPath = path.join(rootDir, "sync.yaml");
    await writeFile(syncYamlPath, "agents:\n  items: [oracle]\n");

    const adapters = makeAdapterMap(["claude"]);
    const context = makeContext();

    // Should not throw
    await processYaml(context, syncYamlPath, adapters, rootDir);

    expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
  });

  it("존재하지 않는 sync.yaml을 경고와 함께 스킵한다", async () => {
    const missingPath = path.join(rootDir, "nonexistent.yaml");

    const adapters = makeAdapterMap(["claude"]);
    const context = makeContext();

    await processYaml(context, missingPath, adapters, rootDir);

    expect(adapters.getAdapter("claude")!.calls).toHaveLength(0);
  });

  it("skill 항목을 올바른 어댑터로 동기화한다", async () => {
    const skillDir = path.join(rootDir, "skills", "oracle");
    await fs.mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# Oracle\n");

    const syncYamlPath = path.join(rootDir, "sync.yaml");
    await writeFile(syncYamlPath, `path: ${targetPath}\nskills:\n  platforms: [claude]\n  items:\n    - oracle\n`);

    const claudeAdapter = makeMockAdapter("claude");
    const adapters = new Map<Platform, PlatformAdapter>([
      ["claude", claudeAdapter],
    ]) as AdapterMap;

    const context = makeContext();

    await processYaml(context, syncYamlPath, adapters, rootDir);

    expect(claudeAdapter.calls.some((c) => c.method === "syncSkillsDirect")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: 처리 순서 (projects first, root second, Set dedup)
// ---------------------------------------------------------------------------

describe("처리 순서 및 중복 제거", () => {
  it("processedPaths Set이 중복 처리를 방지한다", async () => {
    // Simulate Set dedup: same path in both projects and root
    const context = makeContext();
    const targetPath = "/some/target/path";

    context.processedPaths.add(targetPath);

    // processedPaths.has should detect the duplicate
    expect(context.processedPaths.has(targetPath)).toBe(true);
  });

  it("createContext가 빈 processedPaths로 초기화된다", () => {
    const context = createContext(false);
    expect(context.processedPaths.size).toBe(0);
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

  it("lib/ 디렉토리가 없으면 아무것도 하지 않는다", async () => {
    const context = makeContext();

    await syncLib(context, targetPath, rootDir, ["claude"]);

    // No .claude/lib created
    expect(await exists(path.join(targetPath, ".claude", "lib"))).toBe(false);
  });

  it("lib/ 디렉토리를 각 플랫폼 대상에 배포한다", async () => {
    const libSrc = path.join(rootDir, "lib");
    await fs.mkdir(libSrc, { recursive: true });
    await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

    const context = makeContext();

    await syncLib(context, targetPath, rootDir, ["claude"]);

    const destFile = path.join(targetPath, ".claude", "lib", "helper.ts");
    expect(await exists(destFile)).toBe(true);
  });

  it("*.test.ts 파일을 제외한다", async () => {
    const libSrc = path.join(rootDir, "lib");
    await fs.mkdir(libSrc, { recursive: true });
    await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");
    await writeFile(path.join(libSrc, "helper.test.ts"), "// test file\n");

    const context = makeContext();

    await syncLib(context, targetPath, rootDir, ["claude"]);

    const testFile = path.join(targetPath, ".claude", "lib", "helper.test.ts");
    expect(await exists(testFile)).toBe(false);
  });

  it("dry-run 시 파일을 복사하지 않는다", async () => {
    const libSrc = path.join(rootDir, "lib");
    await fs.mkdir(libSrc, { recursive: true });
    await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

    const context = makeContext({ dryRun: true });

    await syncLib(context, targetPath, rootDir, ["claude"]);

    expect(await exists(path.join(targetPath, ".claude", "lib", "helper.ts"))).toBe(false);
  });

  it("processYaml이 syncYaml.platforms cascade를 사용해 syncLib 플랫폼을 결정한다 (P2-4)", async () => {
    // syncYaml.platforms = [gemini] → resolvePlatforms level-3 cascade picks gemini
    const libSrc = path.join(rootDir, "lib");
    await fs.mkdir(libSrc, { recursive: true });
    await writeFile(path.join(libSrc, "helper.ts"), "export const x = 1;\n");

    const syncYamlPath = path.join(rootDir, "sync.yaml");
    // Top-level platforms: [gemini] — cascade level 3 should override the old hardcoded ["claude"]
    await writeFile(syncYamlPath, `path: ${targetPath}\nplatforms: [gemini]\n`);

    const adapters = makeAdapterMap(["claude", "gemini"]);
    const context = makeContext();

    await processYaml(context, syncYamlPath, adapters, rootDir);

    // lib should be deployed to gemini (syncYaml.platforms cascade), not claude
    expect(await exists(path.join(targetPath, ".gemini", "lib", "helper.ts"))).toBe(true);
    expect(await exists(path.join(targetPath, ".claude", "lib", "helper.ts"))).toBe(false);
  });

  it("@lib/* import alias를 상대 경로로 재작성한다", async () => {
    const libSrc = path.join(rootDir, "lib");
    await fs.mkdir(libSrc, { recursive: true });
    await writeFile(path.join(libSrc, "types.ts"), "export type X = string;\n");

    // Place a file that uses @lib/ import
    const agentsDir = path.join(targetPath, ".claude", "agents");
    await fs.mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "oracle.ts"),
      "import { X } from '@lib/types.ts';\n",
    );

    const context = makeContext();

    await syncLib(context, targetPath, rootDir, ["claude"]);

    const rewritten = await readFile(path.join(agentsDir, "oracle.ts"));
    // agents/ is one level deep, so prefix should be ../
    expect(rewritten).toContain("../lib/types.ts");
    expect(rewritten).not.toContain("@lib/");
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

  it("루트 레벨 파일의 @lib/ -> ./lib/로 재작성한다", async () => {
    await writeFile(
      path.join(tmpDir, "index.ts"),
      `import { X } from '@lib/types.ts';\nimport { Y } from "@lib/other.ts";\n`,
    );

    await rewriteLibAliases(tmpDir);

    const content = await readFile(path.join(tmpDir, "index.ts"));
    expect(content).toContain("'./lib/types.ts'");
    expect(content).toContain('"./lib/other.ts"');
  });

  it("1단계 깊이 파일의 @lib/ -> ../lib/로 재작성한다", async () => {
    await writeFile(
      path.join(tmpDir, "agents", "oracle.ts"),
      "import { X } from '@lib/types.ts';\n",
    );

    await rewriteLibAliases(tmpDir);

    const content = await readFile(path.join(tmpDir, "agents", "oracle.ts"));
    expect(content).toContain("'../lib/types.ts'");
  });

  it("2단계 깊이 파일의 @lib/ -> ../../lib/로 재작성한다", async () => {
    await writeFile(
      path.join(tmpDir, "a", "b", "deep.ts"),
      "import type { X } from '@lib/types.ts';\n",
    );

    await rewriteLibAliases(tmpDir);

    const content = await readFile(path.join(tmpDir, "a", "b", "deep.ts"));
    expect(content).toContain("'../../lib/types.ts'");
  });

  it("@lib/ 없는 파일은 변경하지 않는다", async () => {
    const original = "import { X } from './local.ts';\n";
    await writeFile(path.join(tmpDir, "no-alias.ts"), original);

    await rewriteLibAliases(tmpDir);

    const content = await readFile(path.join(tmpDir, "no-alias.ts"));
    expect(content).toBe(original);
  });

  it("*.test.ts 파일은 건드리지 않는다", async () => {
    const original = "import { X } from '@lib/types.ts';\n";
    await writeFile(path.join(tmpDir, "helper.test.ts"), original);

    await rewriteLibAliases(tmpDir);

    const content = await readFile(path.join(tmpDir, "helper.test.ts"));
    expect(content).toBe(original);
  });

  it("lib/ 내부 파일은 재작성하지 않는다", async () => {
    const original = "import { X } from '@lib/types.ts';\n";
    await writeFile(path.join(tmpDir, "lib", "internal.ts"), original);

    await rewriteLibAliases(tmpDir);

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

  it("gemini 플랫폼: .claude/ -> .gemini/ 로 재작성한다", async () => {
    const geminiDir = path.join(targetPath, ".gemini", "agents");
    await fs.mkdir(geminiDir, { recursive: true });
    await writeFile(
      path.join(geminiDir, "oracle.md"),
      "Look in .claude/skills/ for more\n",
    );

    await rewritePlatformPaths(targetPath, "gemini");

    const content = await readFile(path.join(geminiDir, "oracle.md"));
    expect(content).toContain(".gemini/skills/");
    expect(content).not.toContain(".claude/");
  });

  it("codex 플랫폼: .claude/ -> .codex/ 로 재작성한다", async () => {
    const codexDir = path.join(targetPath, ".codex", "rules");
    await fs.mkdir(codexDir, { recursive: true });
    await writeFile(
      path.join(codexDir, "rule.md"),
      "See .claude/agents/ directory\n",
    );

    await rewritePlatformPaths(targetPath, "codex");

    const content = await readFile(path.join(codexDir, "rule.md"));
    expect(content).toContain(".codex/agents/");
    expect(content).not.toContain(".claude/");
  });

  it("opencode 플랫폼: .claude/ -> .opencode/ 로 재작성한다", async () => {
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

  it("claude 플랫폼은 아무것도 하지 않는다", async () => {
    const claudeDir = path.join(targetPath, ".claude", "agents");
    await fs.mkdir(claudeDir, { recursive: true });
    const original = "Look in .claude/skills/ for more\n";
    await writeFile(path.join(claudeDir, "oracle.md"), original);

    await rewritePlatformPaths(targetPath, "claude");

    const content = await readFile(path.join(claudeDir, "oracle.md"));
    expect(content).toBe(original);
  });

  it(".claude/ 없는 파일은 변경하지 않는다", async () => {
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

  it("processYaml dry-run: .claude 디렉토리를 생성하지 않는다", async () => {
    const syncYamlPath = path.join(rootDir, "sync.yaml");
    await writeFile(syncYamlPath, `path: ${targetPath}\n`);

    const adapters = makeAdapterMap(["claude"]);
    const context = makeContext({ dryRun: true });

    await processYaml(context, syncYamlPath, adapters, rootDir);

    // .claude should not be created in dry-run
    expect(await exists(path.join(targetPath, ".claude"))).toBe(false);
  });

  it("syncLib dry-run: 파일을 복사하지 않는다", async () => {
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
  it("feature-platforms에 skills만 남아있다", async () => {
    // Read the actual config.yaml from the repo
    const configPath = path.join(
      import.meta.dir,
      "..",
      "config.yaml",
    );

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
  it("dryRun=false 컨텍스트를 생성한다", () => {
    const ctx = createContext(false);
    expect(ctx.dryRun).toBe(false);
    expect(ctx.processedPaths).toBeInstanceOf(Set);
    expect(ctx.modelMaps).toBeInstanceOf(Map);
    expect(ctx.platformYamlSections).toBeInstanceOf(Map);
    expect(typeof ctx.backupSession).toBe("string");
    expect(ctx.backupSession.length).toBeGreaterThan(0);
  });

  it("dryRun=true 컨텍스트를 생성한다", () => {
    const ctx = createContext(true);
    expect(ctx.dryRun).toBe(true);
  });

  it("각 호출마다 고유한 backupSession을 생성한다", () => {
    const ctx1 = createContext(false);
    const ctx2 = createContext(false);
    expect(ctx1.backupSession).not.toBe(ctx2.backupSession);
  });
});
