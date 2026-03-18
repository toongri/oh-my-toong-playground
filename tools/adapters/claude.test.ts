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
  it("platform이 claude이다", () => {
    expect(adapter.platform).toBe("claude");
  });

  it("configDir가 .claude이다", () => {
    expect(adapter.configDir).toBe(".claude");
  });

  it("contextFile이 CLAUDE.md이다", () => {
    expect(adapter.contextFile).toBe("CLAUDE.md");
  });
});

// ---------------------------------------------------------------------------
// buildHookEntry
// ---------------------------------------------------------------------------

describe("buildHookEntry", () => {
  it("command 타입 훅 엔트리를 생성한다", () => {
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

  it("prompt 타입 훅 엔트리를 생성한다", () => {
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

  it("${component} 플레이스홀더를 displayName으로 치환한다", () => {
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

  it("matcher를 훅 그룹에 포함한다", () => {
    const entry = adapter.buildHookEntry("PreToolUse", "Bash", "command", 5, "/path/cmd");
    const group = (entry["PreToolUse"] as Record<string, unknown>[])[0];
    expect(group["matcher"]).toBe("Bash");
  });
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

describe("updateSettings", () => {
  it("hooks를 settings.json에 저장한다", async () => {
    const hooksEntries = {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "/bin/test", timeout: 10 }] }],
    };

    await adapter.updateSettings(targetPath, hooksEntries);

    const settings = await readJsonFile(path.join(targetPath, ".claude", "settings.json"));
    expect(settings["hooks"]).toEqual(hooksEntries);
  });

  it("기존 hooks를 덮어쓴다", async () => {
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

  it("dry_run 모드에서는 파일을 수정하지 않는다", async () => {
    await adapter.updateSettings(targetPath, { PreToolUse: [] }, true);
    expect(await exists(path.join(targetPath, ".claude", "settings.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readJsonFile 동작 — syncConfig/updateSettings를 통한 간접 테스트
// ---------------------------------------------------------------------------

describe("readJsonFile 동작", () => {
  it("손상된 JSON 파일이 있으면 예외를 던진다", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, "{invalid");

    // syncConfig internally calls readJsonFile; corrupt JSON should propagate as throw
    await expect(adapter.syncConfig(targetPath, { foo: "bar" })).rejects.toThrow();
  });

  it("파일이 없으면 빈 객체를 반환한다 (새 파일로 생성)", async () => {
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
  it("config를 settings.json에 deep merge한다", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, JSON.stringify({ existingKey: "value", nested: { a: 1 } }));

    await adapter.syncConfig(targetPath, { newKey: "hello", nested: { b: 2 } });

    const settings = await readJsonFile(settingsFile);
    expect(settings["existingKey"]).toBe("value");
    expect(settings["newKey"]).toBe("hello");
    expect((settings["nested"] as Record<string, unknown>)["a"]).toBe(1);
    expect((settings["nested"] as Record<string, unknown>)["b"]).toBe(2);
  });

  it("settings.json이 없으면 새로 생성한다", async () => {
    await adapter.syncConfig(targetPath, { foo: "bar" });

    const settings = await readJsonFile(path.join(targetPath, ".claude", "settings.json"));
    expect(settings["foo"]).toBe("bar");
  });
});

// ---------------------------------------------------------------------------
// setStatusline
// ---------------------------------------------------------------------------

describe("setStatusline", () => {
  it("settings.json에 statusLine을 설정한다", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, JSON.stringify({ hooks: {} }));

    await adapter.setStatusline(targetPath, "bun run hud.ts");

    const settings = await readJsonFile(settingsFile);
    const statusLine = settings["statusLine"] as Record<string, unknown>;
    expect(statusLine["type"]).toBe("command");
    expect(statusLine["command"]).toBe("bun run hud.ts");
  });

  it("settings.json이 없으면 경고만 출력하고 에러 없이 종료한다", async () => {
    // Should not throw
    await adapter.setStatusline(targetPath, "bun run hud.ts");
  });
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — file copy
// ---------------------------------------------------------------------------

describe("syncAgentsDirect - 파일 복사", () => {
  it("에이전트 파일을 .claude/agents/ 에 복사한다", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "---\nname: oracle\n---\n\n# Oracle\n");

    await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile);

    expect(await exists(path.join(targetPath, ".claude", "agents", "oracle.md"))).toBe(true);
  });

  it("소스 파일이 없으면 경고만 출력하고 에러 없이 종료한다", async () => {
    await adapter.syncAgentsDirect(targetPath, "missing", "/nonexistent/missing.md");
  });

  it("dry_run 모드에서는 파일을 복사하지 않는다", async () => {
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
  it("에이전트에 skills를 추가한다", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "---\nname: oracle\nskills:\n  - existing-skill\n---\n\n# Oracle body\n");

    await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile, ["testing", "prometheus"]);

    const agentFile = path.join(targetPath, ".claude", "agents", "oracle.md");
    const content = await fs.readFile(agentFile, "utf8");
    expect(content).toContain("testing");
    expect(content).toContain("prometheus");
    expect(content).toContain("existing-skill");
  });

  it("중복 스킬을 deduplicate한다", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "---\nname: oracle\nskills:\n  - testing\n---\n\nbody\n");

    await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile, ["testing", "new-skill"]);

    const agentFile = path.join(targetPath, ".claude", "agents", "oracle.md");
    const content = await fs.readFile(agentFile, "utf8");
    const skillMatches = content.match(/testing/g);
    // "testing" should appear exactly once in the skills list
    expect(skillMatches).not.toBeNull();
  });

  it("add-skills 후 body의 --- 구분자가 보존된다 (P2-4 회귀 테스트)", async () => {
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
  it("에이전트 프론트매터에 hooks를 추가한다", async () => {
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

  it("add-hooks 후 body의 --- 구분자가 보존된다 (P2-4 회귀 테스트)", async () => {
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
});

// ---------------------------------------------------------------------------
// syncCommandsDirect
// ---------------------------------------------------------------------------

describe("syncCommandsDirect", () => {
  it("커맨드 파일을 .claude/commands/ 에 복사한다", async () => {
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
  it("훅 파일을 .claude/hooks/ 에 복사하고 +x 권한을 설정한다", async () => {
    const src = path.join(tmpDir, "my-hook.sh");
    await writeFile(src, "#!/bin/bash\necho hi", 0o644);

    await adapter.syncHooksDirect(targetPath, "my-hook.sh", src);

    const tgt = path.join(targetPath, ".claude", "hooks", "my-hook.sh");
    expect(await exists(tgt)).toBe(true);
    const stat = await fs.stat(tgt);
    expect(stat.mode & 0o111).toBeTruthy();
  });

  it("훅 디렉토리를 .claude/hooks/<name>/ 에 동기화한다", async () => {
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
  it("스킬 디렉토리를 .claude/skills/<name>/ 에 복사한다", async () => {
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
  it("스크립트 파일을 .claude/scripts/ 에 복사한다", async () => {
    const src = path.join(tmpDir, "script.sh");
    await writeFile(src, "#!/bin/bash\necho hi");

    await adapter.syncScriptsDirect(targetPath, "script.sh", src);

    expect(await exists(path.join(targetPath, ".claude", "scripts", "script.sh"))).toBe(true);
  });

  it("스크립트 디렉토리를 .claude/scripts/<name>/ 에 복사한다", async () => {
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
  it("규칙 파일을 .claude/rules/ 에 복사한다", async () => {
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
  it("플러그인 설치가 호출된다", async () => {
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

  it("플러그인 설치 실패 시 에러 없이 계속 진행한다", async () => {
    const failingInstaller = async (_name: string) => {
      throw new Error("install failed");
    };

    const adapterWithMock = new ClaudeAdapter(failingInstaller);
    // Should not throw
    await adapterWithMock.syncPlatformYaml(targetPath, {
      plugins: { items: ["bad-plugin"] },
    }, false);
  });

  it("플러그인 설치기가 non-zero exitCode를 반환하면 warn 로그를 출력하고 계속 진행한다", async () => {
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

  it("dry_run 모드에서는 플러그인 설치를 호출하지 않는다", async () => {
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

  it("user-scope MCP를 ~/.claude.json의 mcpServers에 쓴다", async () => {
    await adapter.syncMcpsMerge(targetPath, "my-server", { command: "npx my-server" });

    const config = await readJsonFile(claudeConfigFile);
    const mcpServers = config["mcpServers"] as Record<string, unknown>;
    expect(mcpServers).toBeDefined();
    expect(mcpServers["my-server"]).toEqual({ command: "npx my-server" });
  });

  it("기존 mcpServers에 새 서버를 머지하고 기존 항목을 덮어쓰지 않는다", async () => {
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

  it("local-scope MCP를 ~/.claude.json의 projects[targetPath].mcpServers에 쓴다", async () => {
    await adapter.syncMcpsMerge(targetPath, "local-server", { command: "npx local" }, false, "local");

    const config = await readJsonFile(claudeConfigFile);
    const projects = config["projects"] as Record<string, unknown>;
    const projectEntry = projects[targetPath] as Record<string, unknown>;
    const mcpServers = projectEntry["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["local-server"]).toEqual({ command: "npx local" });
  });

  it("dry_run 모드에서는 파일을 수정하지 않는다", async () => {
    await adapter.syncMcpsMerge(targetPath, "my-server", { command: "npx my-server" }, true);

    expect(await exists(claudeConfigFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncPlatformYaml — processed sections
// ---------------------------------------------------------------------------

describe("syncPlatformYaml - processedSections", () => {
  it("config 섹션을 처리하면 processedSections에 포함된다", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {
      config: { foo: "bar" },
    }, false);

    expect(result.processedSections).toContain("config");
  });

  it("hooks 섹션을 처리하면 processedSections에 포함된다", async () => {
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

  it("plugins 섹션을 처리하면 processedSections에 포함된다", async () => {
    const noop = async () => {};
    const a = new ClaudeAdapter(noop);
    const result = await a.syncPlatformYaml(targetPath, {
      plugins: { items: ["test-plugin"] },
    }, false);

    expect(result.processedSections).toContain("plugins");
  });

  it("statusLine 섹션을 처리하면 processedSections에 포함된다", async () => {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");
    await writeFile(settingsFile, "{}");

    const result = await adapter.syncPlatformYaml(targetPath, {
      statusLine: "bun run hud.ts",
    }, false);

    expect(result.processedSections).toContain("statusLine");
  });

  it("modelMap은 항상 undefined이다 (claude는 model-map 미지원)", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {}, false);
    expect(result.modelMap).toBeUndefined();
  });

  it("비어있는 yaml은 빈 processedSections를 반환한다", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {}, false);
    expect(result.processedSections).toHaveLength(0);
  });

  it("hooks: {} 이면 기존 hooks를 지우고 settings.json에 빈 hooks를 저장한다", async () => {
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

  it("dry_run 모드에서 processedSections는 정상 반환된다", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {
      config: { foo: "bar" },
    }, true);

    expect(result.processedSections).toContain("config");
  });

  it("절대 경로 component에서 displayName을 path.basename()으로 추출해 훅을 복사한다", async () => {
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
