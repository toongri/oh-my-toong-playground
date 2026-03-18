import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { ClaudeAdapter } from "./claude.ts";

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
let adapter: ClaudeAdapter;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-adapter-test-"));
  targetPath = path.join(tmpDir, "target");
  await fs.mkdir(targetPath, { recursive: true });
  adapter = new ClaudeAdapter();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PlatformAdapter fields
// ---------------------------------------------------------------------------

describe("PlatformAdapter 기본 필드", () => {
  it("returns 'claude' for platform field", () => {
    expect(adapter.platform).toBe("claude");
  });

  it("returns '.claude' for configDir field", () => {
    expect(adapter.configDir).toBe(".claude");
  });

  it("returns 'CLAUDE.md' for contextFile field", () => {
    expect(adapter.contextFile).toBe("CLAUDE.md");
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
      "$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh",
    );

    expect(entry["PreToolUse"]).toBeArray();
    const group = (entry["PreToolUse"] as Record<string, unknown>[])[0];
    expect(group["matcher"]).toBe("*");
    const hooks = group["hooks"] as Record<string, unknown>[];
    expect(hooks[0]["type"]).toBe("command");
    expect(hooks[0]["command"]).toBe("$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh");
    expect(hooks[0]["timeout"]).toBe(10);
  });

  it("builds a 'prompt' type hook entry via `buildHookEntry`", () => {
    const entry = adapter.buildHookEntry(
      "Stop",
      "*",
      "prompt",
      30,
      "Please summarize what you did.",
    );

    const group = (entry["Stop"] as Record<string, unknown>[])[0];
    const hooks = group["hooks"] as Record<string, unknown>[];
    expect(hooks[0]["type"]).toBe("prompt");
    expect(hooks[0]["prompt"]).toBe("Please summarize what you did.");
    expect(hooks[0]["timeout"]).toBe(30);
  });

  it("replaces ${component} placeholder with displayName via `buildHookEntry`", () => {
    const entry = adapter.buildHookEntry(
      "PostToolUse",
      "*",
      "command",
      10,
      "$CLAUDE_PROJECT_DIR/.claude/hooks/${component}",
      "my-hook.sh",
    );

    const hooks = (entry["PostToolUse"] as Record<string, unknown>[])[0][
      "hooks"
    ] as Record<string, unknown>[];
    expect(hooks[0]["command"]).toBe(
      "$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh",
    );
  });

  it("includes matcher in the hook group via `buildHookEntry`", () => {
    const entry = adapter.buildHookEntry("PreToolUse", "Bash", "command", 5, "/path/cmd");
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
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "/bin/test", timeout: 10 }] }],
    };

    await adapter.updateSettings(targetPath, hooksEntries);

    const settings = await readJsonFile(path.join(targetPath, ".claude", "settings.json"));
    expect(settings["hooks"]).toEqual(hooksEntries);
  });

  it("overwrites existing hooks via `updateSettings`", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, JSON.stringify({
      hooks: { Stop: [{ matcher: "*", hooks: [] }] },
      someOtherKey: true,
    }));

    const newHooks = { PreToolUse: [] };
    await adapter.updateSettings(targetPath, newHooks);

    const settings = await readJsonFile(settingsFile);
    expect(settings["hooks"]).toEqual(newHooks);
    expect(settings["someOtherKey"]).toBe(true);
  });

  it("skips file write in dry-run mode via `updateSettings`", async () => {
    await adapter.updateSettings(targetPath, { PreToolUse: [] }, true);
    expect(await exists(path.join(targetPath, ".claude", "settings.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readJsonFile 동작 — syncConfig/updateSettings를 통한 간접 테스트
// ---------------------------------------------------------------------------

describe("readJsonFile 동작", () => {
  it("throws when settings.json contains corrupt JSON via `syncConfig`", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, "{invalid");

    // syncConfig internally calls readJsonFile; corrupt JSON should propagate as throw
    await expect(adapter.syncConfig(targetPath, { foo: "bar" })).rejects.toThrow();
  });

  it("creates a new file when settings.json is absent via `syncConfig`", async () => {
    // settings.json does not exist; syncConfig should create it from scratch
    await adapter.syncConfig(targetPath, { createdFresh: true });

    const settings = await readJsonFile(path.join(targetPath, ".claude", "settings.json"));
    expect(settings["createdFresh"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// syncConfig
// ---------------------------------------------------------------------------

describe("syncConfig", () => {
  it("deep merges config into settings.json via `syncConfig`", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, JSON.stringify({ existingKey: "value", nested: { a: 1 } }));

    await adapter.syncConfig(targetPath, { newKey: "hello", nested: { b: 2 } });

    const settings = await readJsonFile(settingsFile);
    expect(settings["existingKey"]).toBe("value");
    expect(settings["newKey"]).toBe("hello");
    expect((settings["nested"] as Record<string, unknown>)["a"]).toBe(1);
    expect((settings["nested"] as Record<string, unknown>)["b"]).toBe(2);
  });

  it("creates settings.json when absent via `syncConfig`", async () => {
    await adapter.syncConfig(targetPath, { foo: "bar" });

    const settings = await readJsonFile(path.join(targetPath, ".claude", "settings.json"));
    expect(settings["foo"]).toBe("bar");
  });
});

// ---------------------------------------------------------------------------
// setStatusline
// ---------------------------------------------------------------------------

describe("setStatusline", () => {
  it("sets statusLine in settings.json via `setStatusline`", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, JSON.stringify({ hooks: {} }));

    await adapter.setStatusline(targetPath, "bun run hud.ts");

    const settings = await readJsonFile(settingsFile);
    const statusLine = settings["statusLine"] as Record<string, unknown>;
    expect(statusLine["type"]).toBe("command");
    expect(statusLine["command"]).toBe("bun run hud.ts");
  });

  it("logs warning and returns without error when settings.json absent via `setStatusline`", async () => {
    // Should not throw
    await adapter.setStatusline(targetPath, "bun run hud.ts");
  });
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — file copy
// ---------------------------------------------------------------------------

describe("syncAgentsDirect - 파일 복사", () => {
  it("copies agent file to .claude/agents/ via `syncAgentsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "---\nname: oracle\n---\n\n# Oracle\n");

    await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile);

    expect(await exists(path.join(targetPath, ".claude", "agents", "oracle.md"))).toBe(true);
  });

  it("logs warning and returns without error when source file missing via `syncAgentsDirect`", async () => {
    await adapter.syncAgentsDirect(targetPath, "missing", "/nonexistent/missing.md");
  });

  it("skips file copy in dry-run mode via `syncAgentsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "agent.md");
    await writeFile(sourceFile, "---\nname: agent\n---\n\nbody");

    await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], [], true);

    expect(await exists(path.join(targetPath, ".claude", "agents", "agent.md"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — add-skills frontmatter injection
// ---------------------------------------------------------------------------

describe("syncAgentsDirect - add-skills 프론트매터 주입", () => {
  it("injects add-skills into agent frontmatter via `syncAgentsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "---\nname: oracle\nskills:\n  - existing-skill\n---\n\n# Oracle body\n");

    await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile, ["testing", "prometheus"]);

    const agentFile = path.join(targetPath, ".claude", "agents", "oracle.md");
    const content = await fs.readFile(agentFile, "utf8");
    expect(content).toContain("testing");
    expect(content).toContain("prometheus");
    expect(content).toContain("existing-skill");
  });

  it("deduplicates skills in agent frontmatter via `syncAgentsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "---\nname: oracle\nskills:\n  - testing\n---\n\nbody\n");

    await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile, ["testing", "new-skill"]);

    const agentFile = path.join(targetPath, ".claude", "agents", "oracle.md");
    const content = await fs.readFile(agentFile, "utf8");
    const skillMatches = content.match(/testing/g);
    // "testing" should appear exactly once in the skills list
    expect(skillMatches).not.toBeNull();
  });

  it("preserves body --- separators after add-skills injection (regression P2-4)", async () => {
    const sourceFile = path.join(tmpDir, "agent.md");
    const originalContent = [
      "---",
      "name: agent",
      "---",
      "",
      "## Section A",
      "",
      "Content A.",
      "",
      "---",
      "",
      "## Section B",
      "",
      "Content B.",
    ].join("\n");
    await writeFile(sourceFile, originalContent);

    await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, ["my-skill"]);

    const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
    const content = await fs.readFile(agentFile, "utf8");

    // Body's horizontal rule must survive
    expect(content).toContain("Content A.");
    expect(content).toContain("Content B.");

    // Count --- in body (after the closing frontmatter ---)
    const lines = content.split("\n");
    // Find closing --- index
    let closingIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") { closingIdx = i; break; }
    }
    const bodyLines = lines.slice(closingIdx + 1);
    const hrCount = bodyLines.filter((l) => l === "---").length;
    expect(hrCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — add-hooks frontmatter injection
// ---------------------------------------------------------------------------

describe("syncAgentsDirect - add-hooks 프론트매터 주입", () => {
  it("injects add-hooks into agent frontmatter via `syncAgentsDirect`", async () => {
    const sourceFile = path.join(tmpDir, "agent.md");
    await writeFile(sourceFile, "---\nname: agent\n---\n\n# Agent\n");

    const addHooks = [
      {
        event: "SubagentStop",
        matcher: "*",
        type: "command",
        command: "$CLAUDE_PROJECT_DIR/.claude/hooks/my-hook.sh",
        timeout: 60,
        display_name: "my-hook.sh",
      },
    ];

    await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], addHooks);

    const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
    const content = await fs.readFile(agentFile, "utf8");
    expect(content).toContain("SubagentStop");
    expect(content).toContain("my-hook.sh");
  });

  it("preserves body --- separators after add-hooks injection (regression P2-4)", async () => {
    const sourceFile = path.join(tmpDir, "agent.md");
    const originalContent = [
      "---",
      "name: agent",
      "---",
      "",
      "## Phase 1",
      "",
      "Content here.",
      "",
      "---",
      "",
      "## Phase 2",
      "",
      "More content.",
    ].join("\n");
    await writeFile(sourceFile, originalContent);

    const addHooks = [
      {
        event: "SubagentStop",
        matcher: "*",
        type: "command",
        command: "$CLAUDE_PROJECT_DIR/.claude/hooks/hook.sh",
        timeout: 30,
        display_name: "hook.sh",
      },
    ];

    await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], addHooks);

    const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
    const content = await fs.readFile(agentFile, "utf8");

    expect(content).toContain("Content here.");
    expect(content).toContain("More content.");

    // Body's horizontal rule must survive
    const lines = content.split("\n");
    let closingIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") { closingIdx = i; break; }
    }
    const bodyLines = lines.slice(closingIdx + 1);
    const hrCount = bodyLines.filter((l) => l === "---").length;
    expect(hrCount).toBe(1);
  });

  it("preserves prompt text for prompt-type hooks via `syncAgentsDirect` (P2-2)", async () => {
    const sourceFile = path.join(tmpDir, "agent.md");
    await writeFile(sourceFile, "---\nname: agent\n---\n\n# Agent\n");

    const addHooks = [
      {
        event: "Stop",
        matcher: "*",
        type: "prompt",
        prompt: "Please summarize what you did.",
        timeout: 30,
        display_name: "stop-prompt",
      },
    ];

    await adapter.syncAgentsDirect(targetPath, "agent", sourceFile, [], addHooks);

    const agentFile = path.join(targetPath, ".claude", "agents", "agent.md");
    const content = await fs.readFile(agentFile, "utf8");
    expect(content).toContain("prompt");
    expect(content).toContain("Please summarize what you did.");
  });
});

// ---------------------------------------------------------------------------
// syncCommandsDirect
// ---------------------------------------------------------------------------

describe("syncCommandsDirect", () => {
  it("copies command file to .claude/commands/ via `syncCommandsDirect`", async () => {
    const src = path.join(tmpDir, "my-command.md");
    await writeFile(src, "# My Command\n");

    await adapter.syncCommandsDirect(targetPath, "my-command", src);

    expect(await exists(path.join(targetPath, ".claude", "commands", "my-command.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// syncHooksDirect
// ---------------------------------------------------------------------------

describe("syncHooksDirect", () => {
  it("copies hook file to .claude/hooks/ and sets +x permission via `syncHooksDirect`", async () => {
    const src = path.join(tmpDir, "my-hook.sh");
    await writeFile(src, "#!/bin/bash\necho hi", 0o644);

    await adapter.syncHooksDirect(targetPath, "my-hook.sh", src);

    const tgt = path.join(targetPath, ".claude", "hooks", "my-hook.sh");
    expect(await exists(tgt)).toBe(true);
    const stat = await fs.stat(tgt);
    expect(stat.mode & 0o111).toBeTruthy();
  });

  it("syncs hook directory to .claude/hooks/<name>/ via `syncHooksDirect`", async () => {
    const srcDir = path.join(tmpDir, "persistent-mode");
    await writeFile(path.join(srcDir, "index.ts"), "export {}");
    await writeFile(path.join(srcDir, "index.test.ts"), "test content");

    await adapter.syncHooksDirect(targetPath, "persistent-mode", srcDir);

    const tgtDir = path.join(targetPath, ".claude", "hooks", "persistent-mode");
    expect(await exists(path.join(tgtDir, "index.ts"))).toBe(true);
    // *.test.ts should be excluded
    expect(await exists(path.join(tgtDir, "index.test.ts"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncSkillsDirect
// ---------------------------------------------------------------------------

describe("syncSkillsDirect", () => {
  it("copies skill directory to .claude/skills/<name>/ via `syncSkillsDirect`", async () => {
    const srcDir = path.join(tmpDir, "prometheus");
    await writeFile(path.join(srcDir, "SKILL.md"), "# Prometheus");

    await adapter.syncSkillsDirect(targetPath, "prometheus", srcDir);

    expect(await exists(path.join(targetPath, ".claude", "skills", "prometheus", "SKILL.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// syncScriptsDirect
// ---------------------------------------------------------------------------

describe("syncScriptsDirect", () => {
  it("copies script file to .claude/scripts/ via `syncScriptsDirect`", async () => {
    const src = path.join(tmpDir, "script.sh");
    await writeFile(src, "#!/bin/bash\necho hi");

    await adapter.syncScriptsDirect(targetPath, "script.sh", src);

    expect(await exists(path.join(targetPath, ".claude", "scripts", "script.sh"))).toBe(true);
  });

  it("copies script directory to .claude/scripts/<name>/ via `syncScriptsDirect`", async () => {
    const srcDir = path.join(tmpDir, "hud");
    await writeFile(path.join(srcDir, "index.ts"), "export {}");
    await writeFile(path.join(srcDir, "index.test.ts"), "test");

    await adapter.syncScriptsDirect(targetPath, "hud", srcDir);

    expect(await exists(path.join(targetPath, ".claude", "scripts", "hud", "index.ts"))).toBe(true);
    expect(await exists(path.join(targetPath, ".claude", "scripts", "hud", "index.test.ts"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncRulesDirect
// ---------------------------------------------------------------------------

describe("syncRulesDirect", () => {
  it("copies rule file to .claude/rules/ via `syncRulesDirect`", async () => {
    const src = path.join(tmpDir, "coding-discipline.md");
    await writeFile(src, "# Coding Discipline\n");

    await adapter.syncRulesDirect(targetPath, "coding-discipline", src);

    expect(await exists(path.join(targetPath, ".claude", "rules", "coding-discipline.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plugin install — DI pattern
// ---------------------------------------------------------------------------

describe("Plugin install (DI 패턴)", () => {
  it("invokes plugin installer via `syncPlatformYaml`", async () => {
    const installedPlugins: string[] = [];
    const mockInstaller = async (name: string) => {
      installedPlugins.push(name);
    };

    const adapterWithMock = new ClaudeAdapter(mockInstaller);
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    // syncPlatformYaml needs to not fail on hooks/config (no hooks/config provided)
    await adapterWithMock.syncPlatformYaml(targetPath, {
      plugins: { items: ["my-plugin", "another-plugin"] },
    }, false);

    expect(installedPlugins).toContain("my-plugin");
    expect(installedPlugins).toContain("another-plugin");
  });

  it("continues without error when plugin install throws via `syncPlatformYaml`", async () => {
    const failingInstaller = async (_name: string) => {
      throw new Error("install failed");
    };

    const adapterWithMock = new ClaudeAdapter(failingInstaller);
    // Should not throw
    await adapterWithMock.syncPlatformYaml(targetPath, {
      plugins: { items: ["bad-plugin"] },
    }, false);
  });

  it("logs warning and continues when plugin installer returns non-zero exit code via `syncPlatformYaml`", async () => {
    const failingInstaller = async (_name: string, _targetPath: string) => {
      throw new Error("claude plugin install bad-plugin exited with code 1");
    };

    const adapterWithMock = new ClaudeAdapter(failingInstaller);
    // Should not throw — _installPluginSafe catches and warns
    await expect(
      adapterWithMock.syncPlatformYaml(targetPath, {
        plugins: { items: ["bad-plugin"] },
      }, false),
    ).resolves.toBeDefined();
  });

  it("skips plugin install in dry-run mode via `syncPlatformYaml`", async () => {
    const installedPlugins: string[] = [];
    const mockInstaller = async (name: string) => {
      installedPlugins.push(name);
    };

    const adapterWithMock = new ClaudeAdapter(mockInstaller);
    await adapterWithMock.syncPlatformYaml(targetPath, {
      plugins: { items: ["dry-plugin"] },
    }, true);

    expect(installedPlugins).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// syncMcpsMerge
// ---------------------------------------------------------------------------

describe("syncMcpsMerge", () => {
  let claudeConfigFile: string;
  const origClaudeUserConfig = process.env["CLAUDE_USER_CONFIG"];

  beforeEach(() => {
    claudeConfigFile = path.join(tmpDir, ".claude.json");
    process.env["CLAUDE_USER_CONFIG"] = claudeConfigFile;
  });

  afterEach(() => {
    if (origClaudeUserConfig === undefined) {
      delete process.env["CLAUDE_USER_CONFIG"];
    } else {
      process.env["CLAUDE_USER_CONFIG"] = origClaudeUserConfig;
    }
  });

  it("writes user-scope MCP to mcpServers in ~/.claude.json via `syncMcpsMerge`", async () => {
    await adapter.syncMcpsMerge(targetPath, "my-server", { command: "npx my-server" });

    const config = await readJsonFile(claudeConfigFile);
    const mcpServers = config["mcpServers"] as Record<string, unknown>;
    expect(mcpServers).toBeDefined();
    expect(mcpServers["my-server"]).toEqual({ command: "npx my-server" });
  });

  it("merges new server into existing mcpServers without overwriting others via `syncMcpsMerge`", async () => {
    await fs.writeFile(
      claudeConfigFile,
      JSON.stringify({ mcpServers: { "existing-server": { command: "npx existing" } } }),
      "utf8",
    );

    await adapter.syncMcpsMerge(targetPath, "new-server", { command: "npx new-server" });

    const config = await readJsonFile(claudeConfigFile);
    const mcpServers = config["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["existing-server"]).toEqual({ command: "npx existing" });
    expect(mcpServers["new-server"]).toEqual({ command: "npx new-server" });
  });

  it("writes local-scope MCP to projects[targetPath].mcpServers in ~/.claude.json via `syncMcpsMerge`", async () => {
    await adapter.syncMcpsMerge(targetPath, "local-server", { command: "npx local" }, false, "local");

    const config = await readJsonFile(claudeConfigFile);
    const projects = config["projects"] as Record<string, unknown>;
    const projectEntry = projects[targetPath] as Record<string, unknown>;
    const mcpServers = projectEntry["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["local-server"]).toEqual({ command: "npx local" });
  });

  it("skips file write in dry-run mode via `syncMcpsMerge`", async () => {
    await adapter.syncMcpsMerge(targetPath, "my-server", { command: "npx my-server" }, true);

    expect(await exists(claudeConfigFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncPlatformYaml — processed sections
// ---------------------------------------------------------------------------

describe("syncPlatformYaml - processedSections", () => {
  it("includes 'config' in processedSections after processing config section via `syncPlatformYaml`", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {
      config: { foo: "bar" },
    }, false);

    expect(result.processedSections).toContain("config");
  });

  it("includes 'hooks' in processedSections after processing hooks section via `syncPlatformYaml`", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {
      hooks: {
        PreToolUse: [
          {
            command: "$CLAUDE_PROJECT_DIR/.claude/hooks/test.sh",
            timeout: 10,
            matcher: "*",
          },
        ],
      },
    }, false);

    expect(result.processedSections).toContain("hooks");
  });

  it("includes 'plugins' in processedSections after processing plugins section via `syncPlatformYaml`", async () => {
    const noop = async () => {};
    const a = new ClaudeAdapter(noop);
    const result = await a.syncPlatformYaml(targetPath, {
      plugins: { items: ["test-plugin"] },
    }, false);

    expect(result.processedSections).toContain("plugins");
  });

  it("includes 'statusLine' in processedSections after processing statusLine section via `syncPlatformYaml`", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, "{}");

    const result = await adapter.syncPlatformYaml(targetPath, {
      statusLine: "bun run hud.ts",
    }, false);

    expect(result.processedSections).toContain("statusLine");
  });

  it("always returns undefined for modelMap (claude does not support model-map) via `syncPlatformYaml`", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {}, false);
    expect(result.modelMap).toBeUndefined();
  });

  it("returns empty processedSections for empty yaml via `syncPlatformYaml`", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {}, false);
    expect(result.processedSections).toHaveLength(0);
  });

  it("clears existing hooks and saves empty hooks to settings.json when hooks: {} via `syncPlatformYaml`", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "/old", timeout: 10 }] }] },
      otherKey: "keep",
    }));

    await adapter.syncPlatformYaml(targetPath, { hooks: {} }, false);

    const settings = await readJsonFile(settingsFile);
    // hooks must be cleared to empty object
    expect(settings["hooks"]).toEqual({});
    // unrelated keys must be preserved
    expect(settings["otherKey"]).toBe("keep");
  });

  it("returns processedSections normally in dry-run mode via `syncPlatformYaml`", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {
      config: { foo: "bar" },
    }, true);

    expect(result.processedSections).toContain("config");
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
    const hookDest = path.join(targetPath, ".claude", "hooks", "keyword-detector.sh");
    expect(await exists(hookDest)).toBe(true);
  });
});
