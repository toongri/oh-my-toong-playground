import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { syncPlatformConfigs, processYaml, createContext, runProjectsLoop, resolveProjectFilter, type AdapterMap } from "./sync.ts";
import type { Platform, PlatformConfigResult, PlatformYaml, PluginScope } from "./lib/types.ts";
import type { PlatformAdapter } from "./adapters/types.ts";
import { ClaudeAdapter } from "./adapters/claude.ts";
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
// Suite: enabled-projects 화이트리스트 E2E
// ---------------------------------------------------------------------------

describe("enabled-projects 화이트리스트 E2E", () => {
  let tmpDir: string;
  let rootDir: string;
  let targetA: string;
  let targetB: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omt-e2e-enabled-"));
    rootDir = path.join(tmpDir, "root");
    targetA = path.join(tmpDir, "target-a");
    targetB = path.join(tmpDir, "target-b");

    await fs.mkdir(path.join(rootDir, "projects", "proj-a"), { recursive: true });
    await fs.mkdir(path.join(rootDir, "projects", "proj-b"), { recursive: true });
    await fs.mkdir(targetA, { recursive: true });
    await fs.mkdir(targetB, { recursive: true });

    // 각 프로젝트에 sync.yaml + claude.yaml 배치
    await writeFile(
      path.join(rootDir, "projects", "proj-a", "sync.yaml"),
      `path: ${targetA}\n`,
    );
    await writeFile(
      path.join(rootDir, "projects", "proj-a", "claude.yaml"),
      "config:\n  model: claude-opus-4\n",
    );
    await writeFile(
      path.join(rootDir, "projects", "proj-b", "sync.yaml"),
      `path: ${targetB}\n`,
    );
    await writeFile(
      path.join(rootDir, "projects", "proj-b", "claude.yaml"),
      "config:\n  model: claude-sonnet-4-5\n",
    );

    _resetConfigCache();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    _resetConfigCache();
  });

  it("config enabled-projects: [proj-a] 설정 시 proj-b 어댑터는 호출되지 않음", async () => {
    const effectiveFilter = resolveProjectFilter(new Set(), ["proj-a"]);
    const adapters = makeSpyAdapterMap(["claude"]);
    const context = createContext(true);

    await runProjectsLoop(rootDir, adapters, context, effectiveFilter, false);

    const spy = adapters.getSpy("claude")!;
    const calledPaths = spy.spyCalls.map((c) => c.targetPath);
    expect(calledPaths).toContain(targetA);
    expect(calledPaths).not.toContain(targetB);
  });

  it("missing 프로젝트 이름은 warn + skip (어댑터 호출 없음)", async () => {
    // proj-missing은 디렉토리가 없음 — warn하고 스킵해야 함
    const effectiveFilter = resolveProjectFilter(new Set(), ["proj-a", "proj-missing"]);
    const adapters = makeSpyAdapterMap(["claude"]);
    const context = createContext(true);

    await runProjectsLoop(rootDir, adapters, context, effectiveFilter, false);

    const spy = adapters.getSpy("claude")!;
    const calledPaths = spy.spyCalls.map((c) => c.targetPath);
    expect(calledPaths).toContain(targetA);
    // proj-missing은 어댑터 호출 없음 (targetB도 없음 — filter에 없으므로)
    expect(calledPaths).not.toContain(targetB);
    expect(calledPaths).toHaveLength(1);
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

  it("claude adapter는 global path에서 .claude/settings.json에 기록하며 .claude/settings.local.json에는 기록하지 않음", async () => {
    const fakeHome = targetPath;
    const homeSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);

    try {
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
      const globalTarget = os.homedir(); // = fakeHome (mocked)

      await syncPlatformConfigs(context, globalTarget, yamlDir, adapters, rootDir);

      const settingsFile = path.join(globalTarget, ".claude", "settings.json");
      const localSettingsFile = path.join(globalTarget, ".claude", "settings.local.json");

      const settingsExists = await fs.stat(settingsFile).then(() => true).catch(() => false);
      expect(settingsExists).toBe(true);

      const content = JSON.parse(await fs.readFile(settingsFile, "utf8"));
      expect(content["model"]).toBe("claude-opus-4");

      const localExists = await fs.stat(localSettingsFile).then(() => true).catch(() => false);
      expect(localExists).toBe(false);
    } finally {
      homeSpy.mockRestore();
    }
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

// ---------------------------------------------------------------------------
// Suite: lib deployment is complete after copy-time @lib/ rewrite (regression)
//
// Regression guard for the incident where 106aaf3's copy-time @lib/ rewrite
// left the deployed tree with zero raw `@lib/` specifiers, so the lib-dependency
// collector — which used to scan the DEPLOYED platform dir — found nothing and
// deployed an EMPTY lib/. SessionStart hooks then crashed at runtime with
// "Cannot find module '../../lib/pins/manifest'". This suite runs the REAL
// orchestrator end-to-end (real ClaudeAdapter, dryRun=false) and asserts the
// deployed lib is complete AND that bun resolves the rewritten import.
// ---------------------------------------------------------------------------

describe("lib deployment complete after copy-time @lib/ rewrite (regression)", () => {
  let tmpDir: string;
  let rootDir: string;
  let targetPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omt-e2e-libdeploy-"));
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

  it("deploys all @lib/-referenced modules + transitive deps + data files, prunes unused, and the deployed hook resolves at runtime", async () => {
    // --- Source lib tree (rootDir/lib) ---
    const libSrc = path.join(rootDir, "lib");
    // manifest.ts imports a lib-internal transitive dep via a relative import.
    await writeFile(
      path.join(libSrc, "pins", "manifest.ts"),
      [
        'import { TAG } from "./parser.ts";',
        "export const manifest = { tag: TAG };",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(libSrc, "pins", "parser.ts"),
      'export const TAG = "parsed";\n',
    );
    // tbox-loader.ts statically references a sibling data file via import.meta.dir.
    await writeFile(
      path.join(libSrc, "pins", "tbox-loader.ts"),
      [
        'import { join } from "path";',
        'export const TBOX_PATH = join(import.meta.dir, "tbox.yaml");',
        "",
      ].join("\n"),
    );
    await writeFile(path.join(libSrc, "pins", "tbox.yaml"), "schema: 1\n");
    // A lib module that nothing imports — must be pruned.
    await writeFile(path.join(libSrc, "unused.ts"), "export const dead = true;\n");

    // --- Component: a skill bundling a .ts that imports @lib/pins/manifest.ts ---
    const skillDir = path.join(rootDir, "skills", "pin-thing");
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: pin-thing\ndescription: test skill\n---\n\nbody\n",
    );
    await writeFile(
      path.join(skillDir, "run.ts"),
      [
        'import { manifest } from "@lib/pins/manifest.ts";',
        'import { TBOX_PATH } from "@lib/pins/tbox-loader.ts";',
        "export const out = { manifest, TBOX_PATH };",
        "",
      ].join("\n"),
    );

    // --- Component: a SessionStart hook (directory) wired via claude.yaml ---
    const hookDir = path.join(rootDir, "hooks", "pin-session-start");
    await writeFile(
      path.join(hookDir, "index.ts"),
      [
        'import { manifest } from "@lib/pins/manifest.ts";',
        "// Minimal SessionStart hook: read stdin, emit nothing, exit 0.",
        "await new Response(Bun.stdin.stream()).text();",
        "if (!manifest) process.exit(1);",
        "process.exit(0);",
        "",
      ].join("\n"),
    );

    // --- sync.yaml + claude.yaml in rootDir (yamlDir = dirname(syncYaml)) ---
    const syncYamlPath = path.join(rootDir, "sync.yaml");
    await writeFile(
      syncYamlPath,
      [
        `path: ${targetPath}`,
        "platforms: [claude]",
        "skills:",
        "  items:",
        "    - pin-thing",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(rootDir, "claude.yaml"),
      [
        "hooks:",
        "  SessionStart:",
        "    - component: pin-session-start",
        "",
      ].join("\n"),
    );

    // --- Run the REAL orchestrator (real ClaudeAdapter, dryRun=false) ---
    const adapters: AdapterMap = new Map<Platform, PlatformAdapter>();
    adapters.set("claude", new ClaudeAdapter(async () => {}, async () => ({ exitCode: 0 })));
    const context = createContext(false);

    await processYaml(context, syncYamlPath, adapters, rootDir);

    const claudeDir = path.join(targetPath, ".claude");
    const libDest = path.join(claudeDir, "lib");

    // The deployed component .ts has NO raw @lib/ and a depth-correct relative import.
    const deployedSkillTs = await fs.readFile(path.join(claudeDir, "skills", "pin-thing", "run.ts"), "utf8");
    expect(deployedSkillTs).not.toContain("@lib/");
    // skills/pin-thing/run.ts is two levels deep → ../../lib/
    expect(deployedSkillTs).toContain("../../lib/pins/manifest.ts");

    const deployedHookTs = await fs.readFile(path.join(claudeDir, "hooks", "pin-session-start", "index.ts"), "utf8");
    expect(deployedHookTs).not.toContain("@lib/");
    expect(deployedHookTs).toContain("../../lib/pins/manifest.ts");

    // The regression: the @lib/-referenced module must be deployed.
    expect(await fs.stat(path.join(libDest, "pins", "manifest.ts")).then(() => true).catch(() => false)).toBe(true);
    // Transitive lib-internal dep deploys.
    expect(await fs.stat(path.join(libDest, "pins", "parser.ts")).then(() => true).catch(() => false)).toBe(true);
    // The data-file loader and its data file both deploy.
    expect(await fs.stat(path.join(libDest, "pins", "tbox-loader.ts")).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.stat(path.join(libDest, "pins", "tbox.yaml")).then(() => true).catch(() => false)).toBe(true);
    // Unused lib module is pruned.
    expect(await fs.stat(path.join(libDest, "unused.ts")).then(() => true).catch(() => false)).toBe(false);

    // Runtime resolution: bun must resolve the rewritten relative import against
    // the deployed lib. Spawn the deployed hook with minimal SessionStart stdin.
    const proc = Bun.spawn(["bun", "run", path.join(claudeDir, "hooks", "pin-session-start", "index.ts")], {
      stdin: new TextEncoder().encode('{"hook_event_name":"SessionStart","session_id":"e2e"}\n'),
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect({ exitCode: proc.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  });
});
