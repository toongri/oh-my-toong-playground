import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { GeminiAdapter } from "./gemini.ts";
import type { ExtensionInstaller, CommandRunner } from "./gemini.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function writeFile(filePath: string, content: string, mode?: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  if (mode !== undefined) {
    await fs.chmod(filePath, mode);
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let targetPath: string;
let adapter: GeminiAdapter;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-adapter-test-"));
  targetPath = path.join(tmpDir, "target");
  await fs.mkdir(targetPath, { recursive: true });
  adapter = new GeminiAdapter();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PlatformAdapter fields
// ---------------------------------------------------------------------------

describe("PlatformAdapter 기본 필드", () => {
  it("returns 'gemini' for platform field", () => {
    expect(adapter.platform).toBe("gemini");
  });

  it("returns '.gemini' for configDir field", () => {
    expect(adapter.configDir).toBe(".gemini");
  });

  it("returns 'GEMINI.md' for contextFile field", () => {
    expect(adapter.contextFile).toBe("GEMINI.md");
  });
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — skip with warning
// ---------------------------------------------------------------------------

describe("syncAgentsDirect", () => {
  it("does not create files because agents are not supported via `syncAgentsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "# Oracle Agent\n");

    await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile);

    const targetDir = path.join(targetPath, ".gemini", "agents");
    const created = await exists(targetDir);
    expect(created).toBe(false);
  });

  it("logs unsupported warning and returns without error via `syncAgentsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "# Oracle Agent\n");

    // Should not throw
    await expect(
      adapter.syncAgentsDirect(targetPath, "oracle", sourceFile),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// syncCommandsDirect — generate .toml from .md
// ---------------------------------------------------------------------------

describe("syncCommandsDirect", () => {
  it("generates .toml with frontmatter description via `syncCommandsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "commands", "prometheus.md");
    await writeFile(
      sourceFile,
      `---\ndescription: Strategic planning consultant\n---\n\n# Prometheus\n`,
    );

    await adapter.syncCommandsDirect(targetPath, "prometheus", sourceFile);

    const tomlFile = path.join(targetPath, ".gemini", "commands", "prometheus.toml");
    const content = await fs.readFile(tomlFile, "utf8");
    expect(content).toContain("[extension]");
    expect(content).toContain('name = "prometheus"');
    expect(content).toContain('description = "Strategic planning consultant"');
  });

  it("converts .md to .toml and saves to .gemini/commands/ via `syncCommandsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "commands", "git-master.md");
    await writeFile(
      sourceFile,
      `---\ndescription: Git conventions helper\n---\n\n# Git Master\n`,
    );

    await adapter.syncCommandsDirect(targetPath, "git-master", sourceFile);

    const tomlFile = path.join(targetPath, ".gemini", "commands", "git-master.toml");
    expect(await exists(tomlFile)).toBe(true);
    // .md 파일은 생성되지 않아야 한다
    const mdFile = path.join(targetPath, ".gemini", "commands", "git-master.md");
    expect(await exists(mdFile)).toBe(false);
  });

  it("generates .toml with empty description when frontmatter is absent via `syncCommandsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "commands", "simple.md");
    await writeFile(sourceFile, "# Simple Command\nNo frontmatter here.\n");

    await adapter.syncCommandsDirect(targetPath, "simple", sourceFile);

    const tomlFile = path.join(targetPath, ".gemini", "commands", "simple.toml");
    const content = await fs.readFile(tomlFile, "utf8");
    expect(content).toContain('name = "simple"');
    expect(content).toContain('description = ""');
  });

  it("skips file creation in dry-run mode via `syncCommandsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "commands", "prometheus.md");
    await writeFile(sourceFile, `---\ndescription: Test\n---\n`);

    await adapter.syncCommandsDirect(targetPath, "prometheus", sourceFile, true);

    const tomlFile = path.join(targetPath, ".gemini", "commands", "prometheus.toml");
    expect(await exists(tomlFile)).toBe(false);
  });

  it("returns without error when source file is missing via `syncCommandsDirect`", async () => {
    const missingFile = path.join(tmpDir, "commands", "nonexistent.md");

    await expect(
      adapter.syncCommandsDirect(targetPath, "nonexistent", missingFile),
    ).resolves.toBeUndefined();
  });

  it("generates valid TOML when description contains quotes via `syncCommandsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "commands", "tricky.md");
    await writeFile(
      sourceFile,
      `---\ndescription: Say "hello" and it's done\n---\n\n# Tricky\n`,
    );

    await adapter.syncCommandsDirect(targetPath, "tricky", sourceFile);

    const tomlFile = path.join(targetPath, ".gemini", "commands", "tricky.toml");
    const content = await fs.readFile(tomlFile, "utf8");
    // Must contain extension table and both fields without broken TOML
    expect(content).toContain("[extension]");
    // Parsed TOML should round-trip correctly
    const { parse: tomlParse } = await import("smol-toml");
    const parsed = tomlParse(content) as { extension: { name: string; description: string } };
    expect(parsed.extension.name).toBe("tricky");
    expect(parsed.extension.description).toBe(`Say "hello" and it's done`);
  });

  it("logs warning and skips file creation when frontmatter is invalid via `syncCommandsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "commands", "broken.md");
    // Invalid YAML: tab indentation causes parse error in strict YAML parsers
    await writeFile(
      sourceFile,
      `---\n: bad: yaml: [\n---\n\n# Broken\n`,
    );

    await expect(
      adapter.syncCommandsDirect(targetPath, "broken", sourceFile),
    ).resolves.toBeUndefined();

    const tomlFile = path.join(targetPath, ".gemini", "commands", "broken.toml");
    expect(await exists(tomlFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncHooksDirect — copy file + chmod +x
// ---------------------------------------------------------------------------

describe("syncHooksDirect", () => {
  it("copies hook file to .gemini/hooks/ and grants execute permission via `syncHooksDirect`", async () => {
    const sourceFile = path.join(tmpDir, "hooks", "test-hook.sh");
    await writeFile(sourceFile, "#!/bin/bash\necho test\n", 0o644);

    await adapter.syncHooksDirect(targetPath, "test-hook.sh", sourceFile);

    const targetFile = path.join(targetPath, ".gemini", "hooks", "test-hook.sh");
    expect(await exists(targetFile)).toBe(true);
    const stat = await fs.stat(targetFile);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it("syncs hook directory to .gemini/hooks/{name}/ via `syncHooksDirect`", async () => {
    const sourceDir = path.join(tmpDir, "hooks", "persistent-mode");
    await writeFile(path.join(sourceDir, "index.ts"), "export {};\n");
    await writeFile(path.join(sourceDir, "index.sh"), "#!/bin/bash\n");

    await adapter.syncHooksDirect(targetPath, "persistent-mode", sourceDir);

    const targetIndexTs = path.join(
      targetPath,
      ".gemini",
      "hooks",
      "persistent-mode",
      "index.ts",
    );
    expect(await exists(targetIndexTs)).toBe(true);
  });

  it("skips file copy in dry-run mode via `syncHooksDirect`", async () => {
    const sourceFile = path.join(tmpDir, "hooks", "test.sh");
    await writeFile(sourceFile, "#!/bin/bash\n");

    await adapter.syncHooksDirect(targetPath, "test.sh", sourceFile, true);

    const targetFile = path.join(targetPath, ".gemini", "hooks", "test.sh");
    expect(await exists(targetFile)).toBe(false);
  });

  it("returns without error when source is missing via `syncHooksDirect`", async () => {
    const missingFile = path.join(tmpDir, "hooks", "nonexistent.sh");

    await expect(
      adapter.syncHooksDirect(targetPath, "nonexistent.sh", missingFile),
    ).resolves.toBeUndefined();
  });

  it("파일 훅의 shell 의존성을 target에 복사한다", async () => {
    // hooks/ 구조: my-hook.sh (source 문 포함) + lib/shared.sh
    const hooksDir = path.join(tmpDir, "hooks");
    await writeFile(
      path.join(hooksDir, "my-hook.sh"),
      '#!/bin/bash\nsource "$HOOKS_DIR/lib/shared.sh"\necho hook\n',
      0o644,
    );
    await writeFile(path.join(hooksDir, "lib", "shared.sh"), "#!/bin/bash\necho shared\n", 0o644);

    await adapter.syncHooksDirect(targetPath, "my-hook.sh", path.join(hooksDir, "my-hook.sh"));

    const targetLib = path.join(targetPath, ".gemini", "hooks", "lib", "shared.sh");
    expect(await exists(targetLib)).toBe(true);
  });

  it("디렉토리 훅의 외부 의존성을 base dir 기반으로 resolve한다", async () => {
    // hooks/ 구조: my-dir-hook/entry.sh (hooks/ 루트 기준 source) + lib/shared.sh
    // hooksSourceDir = path.dirname(dirHookDir) = hooks/
    // syncShellDepsForDir copies deps into targetHookDir = .gemini/hooks/my-dir-hook/
    const hooksDir = path.join(tmpDir, "hooks");
    const dirHookDir = path.join(hooksDir, "my-dir-hook");
    await writeFile(
      path.join(dirHookDir, "entry.sh"),
      '#!/bin/bash\nsource "$HOOKS_DIR/lib/shared.sh"\necho entry\n',
      0o644,
    );
    await writeFile(path.join(hooksDir, "lib", "shared.sh"), "#!/bin/bash\necho shared\n", 0o644);

    await adapter.syncHooksDirect(targetPath, "my-dir-hook", dirHookDir);

    // deps are copied into the targetHookDir, not the parent hooks/ dir
    const targetLib = path.join(targetPath, ".gemini", "hooks", "my-dir-hook", "lib", "shared.sh");
    expect(await exists(targetLib)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// syncSkillsDirect — syncDirectory
// ---------------------------------------------------------------------------

describe("syncSkillsDirect", () => {
  it("copies skill directory to .gemini/skills/{name}/ via `syncSkillsDirect`", async () => {
    const sourceDir = path.join(tmpDir, "skills", "prometheus");
    await writeFile(path.join(sourceDir, "SKILL.md"), "# Prometheus\n");
    await writeFile(path.join(sourceDir, "README.md"), "# Readme\n");

    await adapter.syncSkillsDirect(targetPath, "prometheus", sourceDir);

    const skillMd = path.join(targetPath, ".gemini", "skills", "prometheus", "SKILL.md");
    const readmeMd = path.join(targetPath, ".gemini", "skills", "prometheus", "README.md");
    expect(await exists(skillMd)).toBe(true);
    expect(await exists(readmeMd)).toBe(true);
  });

  it("skips directory creation in dry-run mode via `syncSkillsDirect`", async () => {
    const sourceDir = path.join(tmpDir, "skills", "prometheus");
    await writeFile(path.join(sourceDir, "SKILL.md"), "# Prometheus\n");

    await adapter.syncSkillsDirect(targetPath, "prometheus", sourceDir, true);

    const targetSkillDir = path.join(targetPath, ".gemini", "skills", "prometheus");
    expect(await exists(targetSkillDir)).toBe(false);
  });

  it("returns without error when source directory is missing via `syncSkillsDirect`", async () => {
    const missingDir = path.join(tmpDir, "skills", "nonexistent");

    await expect(
      adapter.syncSkillsDirect(targetPath, "nonexistent", missingDir),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// syncScriptsDirect — syncDirectory
// ---------------------------------------------------------------------------

describe("syncScriptsDirect", () => {
  it("copies script directory to .gemini/scripts/{name}/ via `syncScriptsDirect`", async () => {
    const sourceDir = path.join(tmpDir, "scripts", "hud");
    await writeFile(path.join(sourceDir, "index.ts"), "export {};\n");

    await adapter.syncScriptsDirect(targetPath, "hud", sourceDir);

    const targetFile = path.join(targetPath, ".gemini", "scripts", "hud", "index.ts");
    expect(await exists(targetFile)).toBe(true);
  });

  it("copies single script file to .gemini/scripts/ via `syncScriptsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "scripts", "deploy.sh");
    await writeFile(sourceFile, "#!/bin/bash\n");

    await adapter.syncScriptsDirect(targetPath, "deploy.sh", sourceFile);

    const targetFile = path.join(targetPath, ".gemini", "scripts", "deploy.sh");
    expect(await exists(targetFile)).toBe(true);
  });

  it("skips file copy in dry-run mode via `syncScriptsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "scripts", "deploy.sh");
    await writeFile(sourceFile, "#!/bin/bash\n");

    await adapter.syncScriptsDirect(targetPath, "deploy.sh", sourceFile, true);

    const targetFile = path.join(targetPath, ".gemini", "scripts", "deploy.sh");
    expect(await exists(targetFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncRulesDirect — skip with warning
// ---------------------------------------------------------------------------

describe("syncRulesDirect", () => {
  it("does not create files because rules are not supported via `syncRulesDirect`", async () => {
    const sourceFile = path.join(tmpDir, "rules", "coding-discipline.md");
    await writeFile(sourceFile, "# Coding Discipline\n");

    await adapter.syncRulesDirect(targetPath, "coding-discipline", sourceFile);

    const targetDir = path.join(targetPath, ".gemini", "rules");
    expect(await exists(targetDir)).toBe(false);
  });

  it("logs unsupported warning and returns without error via `syncRulesDirect`", async () => {
    const sourceFile = path.join(tmpDir, "rules", "work-principles.md");
    await writeFile(sourceFile, "# Work Principles\n");

    await expect(
      adapter.syncRulesDirect(targetPath, "work-principles", sourceFile),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildHookEntry
// ---------------------------------------------------------------------------

describe("buildHookEntry", () => {
  it("builds a 'command' type hook entry via `buildHookEntry`", () => {
    const entry = adapter.buildHookEntry(
      "PreToolUse",
      "*",
      "command",
      10,
      ".gemini/hooks/test.sh",
    );

    expect(entry["PreToolUse"]).toBeArray();
    const group = (entry["PreToolUse"] as Record<string, unknown>[])[0];
    expect(group["matcher"]).toBe("*");
    const hooks = group["hooks"] as Record<string, unknown>[];
    expect(hooks[0]["type"]).toBe("command");
    expect(hooks[0]["command"]).toBe(".gemini/hooks/test.sh");
    expect(hooks[0]["timeout"]).toBe(10);
  });

  it("builds a 'prompt' type hook entry via `buildHookEntry`", () => {
    const entry = adapter.buildHookEntry(
      "Stop",
      "*",
      "prompt",
      5,
      "Are you sure?",
    );

    const group = (entry["Stop"] as Record<string, unknown>[])[0];
    const hooks = group["hooks"] as Record<string, unknown>[];
    expect(hooks[0]["type"]).toBe("prompt");
    expect(hooks[0]["prompt"]).toBe("Are you sure?");
    expect(hooks[0]["timeout"]).toBe(5);
  });

  it("replaces ${component} placeholder with displayName via `buildHookEntry`", () => {
    const entry = adapter.buildHookEntry(
      "PreToolUse",
      "*",
      "command",
      10,
      ".gemini/hooks/${component}",
      "my-hook.sh",
    );

    const hooks = (entry["PreToolUse"] as Record<string, unknown>[])[0][
      "hooks"
    ] as Record<string, unknown>[];
    expect(hooks[0]["command"]).toBe(".gemini/hooks/my-hook.sh");
  });

  it("includes matcher in the hook group via `buildHookEntry`", () => {
    const entry = adapter.buildHookEntry(
      "PreToolUse",
      "Bash",
      "command",
      5,
      "/path/to/cmd",
    );

    const group = (entry["PreToolUse"] as Record<string, unknown>[])[0];
    expect(group["matcher"]).toBe("Bash");
  });
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe("updateSettings", () => {
  it("writes hooks to settings.json via `updateSettings`", async () => {
    const hooksEntries = {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: ".gemini/hooks/test.sh", timeout: 10 }] }],
    };

    await adapter.updateSettings(targetPath, hooksEntries);

    const settings = await readJsonFile(path.join(targetPath, ".gemini", "settings.json"));
    expect(settings["PreToolUse"]).toBeDefined();
  });

  it("merges hooks into existing settings.json via `updateSettings`", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(settingsFile, JSON.stringify({ existingKey: "existingValue" }));

    const hooksEntries = {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: ".gemini/hooks/test.sh", timeout: 10 }] }],
    };

    await adapter.updateSettings(targetPath, hooksEntries);

    const settings = await readJsonFile(settingsFile);
    expect(settings["existingKey"]).toBe("existingValue");
    expect(settings["PreToolUse"]).toBeDefined();
  });

  it("skips file creation in dry-run mode via `updateSettings`", async () => {
    const hooksEntries = {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: ".gemini/hooks/test.sh", timeout: 10 }] }],
    };

    await adapter.updateSettings(targetPath, hooksEntries, true);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(false);
  });

  it("removes old hook events not present in new hooksEntries (atomic replacement) via `updateSettings`", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(
      settingsFile,
      JSON.stringify({
        customInstructions: "keep me",
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: ".gemini/hooks/old.sh", timeout: 10 }] }],
      }),
    );

    const hooksEntries = {
      UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: ".gemini/hooks/new.sh", timeout: 10 }] }],
    };

    await adapter.updateSettings(targetPath, hooksEntries);

    const settings = await readJsonFile(settingsFile);
    expect(settings["Stop"]).toBeUndefined();
    expect(settings["UserPromptSubmit"]).toBeDefined();
    expect(settings["customInstructions"]).toBe("keep me");
  });
});

// ---------------------------------------------------------------------------
// syncConfig
// ---------------------------------------------------------------------------

describe("syncConfig", () => {
  it("deep merges config into settings.json via `syncConfig`", async () => {
    await adapter.syncConfig(targetPath, { model: "gemini-2.0-flash" });

    const settings = await readJsonFile(
      path.join(targetPath, ".gemini", "settings.json"),
    );
    expect(settings["model"]).toBe("gemini-2.0-flash");
  });

  it("deep merges with existing settings.json via `syncConfig`", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(settingsFile, JSON.stringify({ existing: "value" }));

    await adapter.syncConfig(targetPath, { model: "gemini-2.0-flash" });

    const settings = await readJsonFile(settingsFile);
    expect(settings["existing"]).toBe("value");
    expect(settings["model"]).toBe("gemini-2.0-flash");
  });

  it("skips file creation in dry-run mode via `syncConfig`", async () => {
    await adapter.syncConfig(targetPath, { model: "gemini-2.0-flash" }, true);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncMcpsMerge
// ---------------------------------------------------------------------------

describe("syncMcpsMerge", () => {
  it("writes MCP server to mcpServers in settings.json via `syncMcpsMerge`", async () => {
    const serverJson = { command: "npx", args: ["-y", "@upstash/context7-mcp"] };

    await adapter.syncMcpsMerge(targetPath, { context7: serverJson });

    const settings = await readJsonFile(
      path.join(targetPath, ".gemini", "settings.json"),
    );
    const mcpServers = settings["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["context7"]).toEqual(serverJson);
  });

  it("replaces existing servers with only yaml-defined servers in mcpServers via `syncMcpsMerge`", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(
      settingsFile,
      JSON.stringify({ mcpServers: { existing: { command: "existing" } } }),
    );

    await adapter.syncMcpsMerge(targetPath, { context7: { command: "npx" } });

    const settings = await readJsonFile(settingsFile);
    const mcpServers = settings["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["existing"]).toBeUndefined();
    expect(mcpServers["context7"]).toBeDefined();
  });

  it("skips file modification in dry-run mode via `syncMcpsMerge`", async () => {
    await adapter.syncMcpsMerge(targetPath, { context7: { command: "npx" } }, true);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(false);
  });

  it("removes server from settings.json when removed from yaml via `syncMcpsMerge`", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(
      settingsFile,
      JSON.stringify({ mcpServers: { removed: { command: "old" }, kept: { command: "keep" } } }),
    );

    await adapter.syncMcpsMerge(targetPath, { kept: { command: "keep" } });

    const settings = await readJsonFile(settingsFile);
    const mcpServers = settings["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["removed"]).toBeUndefined();
    expect(mcpServers["kept"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// readJsonFile (via updateSettings) — error handling
// ---------------------------------------------------------------------------

describe("readJsonFile 오류 처리", () => {
  it("throws when settings.json contains corrupt JSON via `updateSettings`", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(settingsFile, "{ invalid json !!!");

    await expect(
      adapter.updateSettings(targetPath, { PreToolUse: [] }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// syncPlatformYaml
// ---------------------------------------------------------------------------

describe("syncPlatformYaml", () => {
  it("processes config section and includes it in processedSections via `syncPlatformYaml`", async () => {
    const yaml = { config: { model: "gemini-2.0-flash" } };

    const result = await adapter.syncPlatformYaml(targetPath, yaml, false);

    expect(result.processedSections).toContain("config");
    expect(result.modelMap).toBeUndefined();

    const settings = await readJsonFile(
      path.join(targetPath, ".gemini", "settings.json"),
    );
    expect(settings["model"]).toBe("gemini-2.0-flash");
  });

  it("processes mcps section and includes it in processedSections via `syncPlatformYaml`", async () => {
    const yaml = {
      mcps: {
        context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      },
    };

    const result = await adapter.syncPlatformYaml(targetPath, yaml, false);

    expect(result.processedSections).toContain("mcps");

    const settings = await readJsonFile(
      path.join(targetPath, ".gemini", "settings.json"),
    );
    const mcpServers = settings["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["context7"]).toBeDefined();
  });

  it("processes hooks section and includes it in processedSections via `syncPlatformYaml`", async () => {
    const yaml = {
      hooks: {
        PreToolUse: [
          {
            command: ".gemini/hooks/test.sh",
            timeout: 10,
            matcher: "*",
            type: "command",
          },
        ],
      },
    };

    const result = await adapter.syncPlatformYaml(targetPath, yaml, false);

    expect(result.processedSections).toContain("hooks");
  });

  it("returns empty processedSections when no sections are present via `syncPlatformYaml`", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {}, false);

    expect(result.processedSections).toHaveLength(0);
    expect(result.modelMap).toBeUndefined();
  });

  it("returns undefined for modelMap because model-map is not supported via `syncPlatformYaml`", async () => {
    const yaml = { config: { model: "gemini-2.0-flash" } };

    const result = await adapter.syncPlatformYaml(targetPath, yaml, false);

    expect(result.modelMap).toBeUndefined();
  });

  it("writes prompt type hook to settings.json via `syncPlatformYaml`", async () => {
    const yaml = {
      hooks: {
        Stop: [
          {
            type: "prompt",
            prompt: "Please summarize what you did.",
            timeout: 30,
            matcher: "*",
          },
        ],
      },
    };

    await adapter.syncPlatformYaml(targetPath, yaml, false);

    const settings = await readJsonFile(
      path.join(targetPath, ".gemini", "settings.json"),
    );
    const stopHooks = settings["Stop"] as Array<Record<string, unknown>>;
    expect(stopHooks).toBeDefined();
    const hookDef = (stopHooks[0]["hooks"] as Array<Record<string, unknown>>)[0];
    expect(hookDef["type"]).toBe("prompt");
    expect(hookDef["prompt"]).toBe("Please summarize what you did.");
  });

  it("skips settings.json creation in dry-run mode via `syncPlatformYaml`", async () => {
    const yaml = {
      config: { model: "gemini-2.0-flash" },
      mcps: { context7: { command: "npx" } },
    };

    await adapter.syncPlatformYaml(targetPath, yaml, true);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(false);
  });

  it("processes multiple sections at once and includes all in processedSections via `syncPlatformYaml`", async () => {
    const yaml = {
      config: { model: "gemini-2.0-flash" },
      mcps: { context7: { command: "npx" } },
      hooks: {
        PreToolUse: [
          { command: ".gemini/hooks/test.sh", timeout: 10, matcher: "*" },
        ],
      },
    };

    const result = await adapter.syncPlatformYaml(targetPath, yaml, false);

    expect(result.processedSections).toContain("config");
    expect(result.processedSections).toContain("mcps");
    expect(result.processedSections).toContain("hooks");
  });

  it("updates settings.json even when hooks section has no entries via `syncPlatformYaml`", async () => {
    // Without the hasHooks guard, updateSettings is called unconditionally.
    // Even with an empty hooks map, settings.json must be created/touched.
    await adapter.syncPlatformYaml(targetPath, { hooks: {} }, false);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(true);
  });

  it("removes old hook event from settings.json when not in new YAML (hook-removal regression) via `syncPlatformYaml`", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(
      settingsFile,
      JSON.stringify({
        customInstructions: "keep me",
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: ".gemini/hooks/old.sh", timeout: 10 }] }],
      }),
    );

    const yaml = {
      hooks: {
        UserPromptSubmit: [
          { command: ".gemini/hooks/new.sh", timeout: 10, matcher: "*", type: "command" },
        ],
      },
    };

    await adapter.syncPlatformYaml(targetPath, yaml, false);

    const settings = await readJsonFile(settingsFile);
    expect(settings["Stop"]).toBeUndefined();
    expect(settings["UserPromptSubmit"]).toBeDefined();
    expect(settings["customInstructions"]).toBe("keep me");
  });

  it("processes plugins section with string item and includes it in processedSections via `syncPlatformYaml`", async () => {
    const installed: string[] = [];
    const installer: ExtensionInstaller = async (name) => { installed.push(name); };
    const adapterWithDI = new GeminiAdapter(installer);

    const yaml = { plugins: { items: ["github.com/user/my-extension"] } };
    const result = await adapterWithDI.syncPlatformYaml(targetPath, yaml, false);

    expect(result.processedSections).toContain("plugins");
    expect(installed).toEqual(["github.com/user/my-extension"]);
  });

  it("logs dry-run message for string plugin item without installing via `syncPlatformYaml`", async () => {
    const installed: string[] = [];
    const installer: ExtensionInstaller = async (name) => { installed.push(name); };
    const adapterWithDI = new GeminiAdapter(installer);

    const yaml = { plugins: { items: ["github.com/user/my-extension"] } };
    await adapterWithDI.syncPlatformYaml(targetPath, yaml, true);

    expect(installed).toHaveLength(0);
  });

  it("skips install when check exits 0 for object plugin item via `syncPlatformYaml`", async () => {
    const installed: string[] = [];
    const installer: ExtensionInstaller = async (name) => { installed.push(name); };
    const runner: CommandRunner = async () => ({ exitCode: 0 });
    const adapterWithDI = new GeminiAdapter(installer, runner);

    const yaml = {
      plugins: {
        items: [{ name: "github.com/user/ext", check: "gemini extensions list | grep ext" }],
      },
    };
    await adapterWithDI.syncPlatformYaml(targetPath, yaml, false);

    expect(installed).toHaveLength(0);
  });

  it("installs when check exits non-zero for object plugin item via `syncPlatformYaml`", async () => {
    const installed: string[] = [];
    const installer: ExtensionInstaller = async (name) => { installed.push(name); };
    const runner: CommandRunner = async () => ({ exitCode: 1 });
    const adapterWithDI = new GeminiAdapter(installer, runner);

    const yaml = {
      plugins: {
        items: [{ name: "github.com/user/ext", check: "gemini extensions list | grep ext" }],
      },
    };
    await adapterWithDI.syncPlatformYaml(targetPath, yaml, false);

    expect(installed).toEqual(["github.com/user/ext"]);
  });

  it("runs pre-commands before install for object plugin item via `syncPlatformYaml`", async () => {
    const calls: string[] = [];
    const installer: ExtensionInstaller = async (name) => { calls.push(`install:${name}`); };
    const runner: CommandRunner = async (cmd) => { calls.push(`run:${cmd}`); return { exitCode: 1 }; };
    const adapterWithDI = new GeminiAdapter(installer, runner);

    const yaml = {
      plugins: {
        items: [{
          name: "github.com/user/ext",
          check: "check-cmd",
          "pre-commands": ["setup-cmd"],
        }],
      },
    };
    await adapterWithDI.syncPlatformYaml(targetPath, yaml, false);

    // check runs first, then pre-commands, then install
    expect(calls[0]).toBe("run:check-cmd");
    expect(calls[1]).toBe("run:setup-cmd");
    expect(calls[2]).toBe("install:github.com/user/ext");
  });

  it("logs warning and continues when install fails for string plugin item via `syncPlatformYaml`", async () => {
    const installer: ExtensionInstaller = async () => { throw new Error("install failed"); };
    const adapterWithDI = new GeminiAdapter(installer);

    const yaml = { plugins: { items: ["github.com/user/ext"] } };

    await expect(
      adapterWithDI.syncPlatformYaml(targetPath, yaml, false),
    ).resolves.toBeDefined();
  });

  it("skips object plugin item with no name and continues via `syncPlatformYaml`", async () => {
    const installed: string[] = [];
    const installer: ExtensionInstaller = async (name) => { installed.push(name); };
    const adapterWithDI = new GeminiAdapter(installer);

    const yaml = { plugins: { items: [{ check: "some-check" }] } };
    const result = await adapterWithDI.syncPlatformYaml(targetPath, yaml, false);

    expect(result.processedSections).toContain("plugins");
    expect(installed).toHaveLength(0);
  });

  it("logs dry-run message for object plugin item without installing via `syncPlatformYaml`", async () => {
    const installed: string[] = [];
    const installer: ExtensionInstaller = async (name) => { installed.push(name); };
    const adapterWithDI = new GeminiAdapter(installer);

    const yaml = {
      plugins: { items: [{ name: "github.com/user/ext", check: "check-cmd" }] },
    };
    await adapterWithDI.syncPlatformYaml(targetPath, yaml, true);

    expect(installed).toHaveLength(0);
  });

  it("extracts displayName via `path.basename()` from absolute component path and copies hook via `syncPlatformYaml`", async () => {
    // Create a real hook file at an absolute path (simulates pre-resolved path from orchestrator)
    const hookFile = path.join(tmpDir, "keyword-detector.sh");
    await writeFile(hookFile, "#!/bin/bash\necho hi\n", 0o644);

    const result = await adapter.syncPlatformYaml(targetPath, {
      hooks: {
        UserPromptSubmit: [
          {
            component: hookFile,
            timeout: 10,
            matcher: "*",
          },
        ],
      },
    }, false);

    expect(result.processedSections).toContain("hooks");

    // Hook should be copied under its basename, not full path or colon-split name
    const hookDest = path.join(targetPath, ".gemini", "hooks", "keyword-detector.sh");
    expect(await exists(hookDest)).toBe(true);
  });
});
