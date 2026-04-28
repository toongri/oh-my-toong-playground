import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { syncPlatformConfigs, createContext, type AdapterMap } from "./sync.ts";
import type { Platform, PlatformConfigResult, PlatformYaml, PluginScope } from "./lib/types.ts";
import type { PlatformAdapter } from "./adapters/types.ts";
import { _resetConfigCache } from "./lib/config.ts";

// ---------------------------------------------------------------------------
// Spy adapter that captures the merged PlatformYaml passed to syncPlatformYaml
// ---------------------------------------------------------------------------

type SpyCall = {
  targetPath: string;
  yaml: PlatformYaml;
  dryRun: boolean;
};

function makeSpyAdapter(platform: Platform): PlatformAdapter & { spyCalls: SpyCall[] } {
  const spyCalls: SpyCall[] = [];

  const noop = async () => {};

  return {
    platform,
    configDir: `.${platform}`,
    contextFile: "CONTEXT.md",
    syncAgentsDirect: noop as PlatformAdapter["syncAgentsDirect"],
    syncCommandsDirect: noop as PlatformAdapter["syncCommandsDirect"],
    syncSkillsDirect: noop as PlatformAdapter["syncSkillsDirect"],
    syncScriptsDirect: noop as PlatformAdapter["syncScriptsDirect"],
    syncRulesDirect: noop as PlatformAdapter["syncRulesDirect"],
    syncHooksDirect: noop as PlatformAdapter["syncHooksDirect"],
    async syncPlatformYaml(
      targetPath: string,
      yaml: PlatformYaml,
      dryRun: boolean,
      _scope?: PluginScope,
    ): Promise<PlatformConfigResult> {
      spyCalls.push({ targetPath, yaml, dryRun });
      return { processedSections: ["config"], modelMap: undefined };
    },
    spyCalls,
  };
}

function makeSpyAdapterMap(platforms: Platform[]): AdapterMap & {
  getSpy(p: Platform): (PlatformAdapter & { spyCalls: SpyCall[] }) | undefined;
} {
  const spies = new Map<Platform, PlatformAdapter & { spyCalls: SpyCall[] }>();
  for (const p of platforms) {
    spies.set(p, makeSpyAdapter(p));
  }

  const map = spies as unknown as AdapterMap & {
    getSpy(p: Platform): (PlatformAdapter & { spyCalls: SpyCall[] }) | undefined;
  };
  map.getSpy = (p: Platform) => spies.get(p);
  return map;
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

// ---------------------------------------------------------------------------
// Fixture factory
//
// Each platform gets:
//   base  : one scalar, one nested object, one array
//   local : scalar override, object deep-merge addition, array append+dedup
// ---------------------------------------------------------------------------

type PlatformFixture = {
  base: string;
  local: string;
};

const PLATFORMS = ["claude", "gemini", "codex", "opencode"] as const;

function buildFixtures(targetPath: string): Record<string, PlatformFixture> {
  return {
    claude: {
      base: [
        "config:",
        "  model: claude-3-5-sonnet",
        "  theme: dark",
        "  permissions:",
        "    allow:",
        "      - Bash(git:*)",
      ].join("\n") + "\n",
      local: [
        "config:",
        "  model: claude-opus-4",
        "  permissions:",
        "    allow:",
        "      - Bash(git:*)",
        "      - Bash(npm:*)",
      ].join("\n") + "\n",
    },
    gemini: {
      base: [
        "config:",
        "  model: gemini-2.0-flash",
        "  checkpointing: false",
        "  extensions:",
        "    - ext-a",
      ].join("\n") + "\n",
      local: [
        "config:",
        "  model: gemini-2.5-pro",
        "  extensions:",
        "    - ext-a",
        "    - ext-b",
      ].join("\n") + "\n",
    },
    codex: {
      base: [
        "config:",
        "  model: o4-mini",
        "  cwd: /tmp",
        "  notify:",
        "    events:",
        "      - task-complete",
      ].join("\n") + "\n",
      local: [
        "config:",
        "  model: o3",
        "  notify:",
        "    events:",
        "      - task-complete",
        "      - task-failed",
      ].join("\n") + "\n",
    },
    opencode: {
      base: [
        "config:",
        `  model: claude-3-5-sonnet-20241022`,
        "  autoshare: false",
        "  providers:",
        "    - anthropic",
      ].join("\n") + "\n",
      local: [
        "config:",
        `  model: claude-opus-4-5`,
        "  providers:",
        "    - anthropic",
        "    - openai",
      ].join("\n") + "\n",
    },
  };
}

// ---------------------------------------------------------------------------
// Suite: 4-platform overlay E2E
// ---------------------------------------------------------------------------

describe("4-platform overlay E2E", () => {
  let tmpDir: string;
  let targetPath: string;
  let yamlDir: string;
  let rootDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omt-e2e-overlay-"));
    targetPath = path.join(tmpDir, "target");
    yamlDir = path.join(tmpDir, "yaml");
    rootDir = path.join(tmpDir, "root");

    await fs.mkdir(targetPath, { recursive: true });
    await fs.mkdir(yamlDir, { recursive: true });
    await fs.mkdir(rootDir, { recursive: true });

    await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude, gemini, codex, opencode]\n");
    _resetConfigCache();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    _resetConfigCache();
  });

  it("모든 플랫폼에 병합된 config가 전달됨 — scalar override, object deep-merge, array concat+dedup", async () => {
    const fixtures = buildFixtures(targetPath);

    for (const platform of PLATFORMS) {
      await writeFile(path.join(yamlDir, `${platform}.yaml`), fixtures[platform].base);
      await writeFile(path.join(yamlDir, `${platform}.local.yaml`), fixtures[platform].local);
    }

    const context = createContext(true);
    const adapters = makeSpyAdapterMap([...PLATFORMS]);

    await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

    for (const platform of PLATFORMS) {
      const spy = adapters.getSpy(platform)!;
      expect(spy.spyCalls).toHaveLength(1);
    }

    const claudeYaml = adapters.getSpy("claude")!.spyCalls[0].yaml;
    expect((claudeYaml.config as Record<string, unknown>)["model"]).toBe("claude-opus-4");
    expect((claudeYaml.config as Record<string, unknown>)["theme"]).toBe("dark");
    const claudeAllow = (claudeYaml.config as Record<string, unknown>)["permissions"] as Record<string, unknown>;
    expect(claudeAllow["allow"]).toContain("Bash(git:*)");
    expect(claudeAllow["allow"]).toContain("Bash(npm:*)");
    const claudeAllowArr = claudeAllow["allow"] as string[];
    expect(claudeAllowArr.filter((v) => v === "Bash(git:*)")).toHaveLength(1);

    const geminiYaml = adapters.getSpy("gemini")!.spyCalls[0].yaml;
    expect((geminiYaml.config as Record<string, unknown>)["model"]).toBe("gemini-2.5-pro");
    expect((geminiYaml.config as Record<string, unknown>)["checkpointing"]).toBe(false);
    const geminiExt = (geminiYaml.config as Record<string, unknown>)["extensions"] as string[];
    expect(geminiExt).toContain("ext-a");
    expect(geminiExt).toContain("ext-b");
    expect(geminiExt.filter((v) => v === "ext-a")).toHaveLength(1);

    const codexYaml = adapters.getSpy("codex")!.spyCalls[0].yaml;
    expect((codexYaml.config as Record<string, unknown>)["model"]).toBe("o3");
    expect((codexYaml.config as Record<string, unknown>)["cwd"]).toBe("/tmp");
    const codexNotify = (codexYaml.config as Record<string, unknown>)["notify"] as Record<string, unknown>;
    const codexEvents = codexNotify["events"] as string[];
    expect(codexEvents).toContain("task-complete");
    expect(codexEvents).toContain("task-failed");
    expect(codexEvents.filter((v) => v === "task-complete")).toHaveLength(1);

    const opencodeYaml = adapters.getSpy("opencode")!.spyCalls[0].yaml;
    expect((opencodeYaml.config as Record<string, unknown>)["model"]).toBe("claude-opus-4-5");
    expect((opencodeYaml.config as Record<string, unknown>)["autoshare"]).toBe(false);
    const opencodeProviders = (opencodeYaml.config as Record<string, unknown>)["providers"] as string[];
    expect(opencodeProviders).toContain("anthropic");
    expect(opencodeProviders).toContain("openai");
    expect(opencodeProviders.filter((v) => v === "anthropic")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: Phase 1 destinations unchanged
// ---------------------------------------------------------------------------

describe("Phase 1 destinations unchanged", () => {
  let tmpDir: string;
  let targetPath: string;
  let yamlDir: string;
  let rootDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omt-e2e-dest-"));
    targetPath = path.join(tmpDir, "target");
    yamlDir = path.join(tmpDir, "yaml");
    rootDir = path.join(tmpDir, "root");

    await fs.mkdir(targetPath, { recursive: true });
    await fs.mkdir(yamlDir, { recursive: true });
    await fs.mkdir(rootDir, { recursive: true });

    await writeFile(path.join(rootDir, "config.yaml"), "use-platforms: [claude]\n");
    _resetConfigCache();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    _resetConfigCache();
  });

  it("claude adapter는 .claude/settings.local.json에 기록하며 .claude/settings.json에는 기록하지 않음", async () => {
    const configYaml = [
      "config:",
      "  model: claude-opus-4",
      "  theme: dark",
    ].join("\n") + "\n";

    await writeFile(path.join(yamlDir, "claude.yaml"), configYaml);

    const { ClaudeAdapter } = await import("./adapters/claude.ts");

    const claudeAdapter = new ClaudeAdapter(
      async () => {},
      async () => ({ exitCode: 0 }),
    );

    const adapters: AdapterMap = new Map<Platform, PlatformAdapter>();
    adapters.set("claude", claudeAdapter);

    const context = createContext(false);

    await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

    const localSettingsFile = path.join(targetPath, ".claude", "settings.local.json");
    const settingsFile = path.join(targetPath, ".claude", "settings.json");

    const localExists = await fs.stat(localSettingsFile).then(() => true).catch(() => false);
    expect(localExists).toBe(true);

    const content = JSON.parse(await fs.readFile(localSettingsFile, "utf8"));
    expect(content["model"]).toBe("claude-opus-4");

    const settingsExists = await fs.stat(settingsFile).then(() => true).catch(() => false);
    expect(settingsExists).toBe(false);
  });
});
