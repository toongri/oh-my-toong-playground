import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import { GeminiAdapter } from "./gemini.ts";

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
  it("platform이 gemini이다", () => {
    expect(adapter.platform).toBe("gemini");
  });

  it("configDir가 .gemini이다", () => {
    expect(adapter.configDir).toBe(".gemini");
  });

  it("contextFile이 GEMINI.md이다", () => {
    expect(adapter.contextFile).toBe("GEMINI.md");
  });
});

// ---------------------------------------------------------------------------
// syncAgentsDirect — skip with warning
// ---------------------------------------------------------------------------

describe("syncAgentsDirect", () => {
  it("agents를 지원하지 않으므로 파일을 생성하지 않는다", async () => {
    const sourceFile = path.join(tmpDir, "oracle.md");
    await writeFile(sourceFile, "# Oracle Agent\n");

    await adapter.syncAgentsDirect(targetPath, "oracle", sourceFile);

    const targetDir = path.join(targetPath, ".gemini", "agents");
    const created = await exists(targetDir);
    expect(created).toBe(false);
  });

  it("agents 지원 안 함 경고를 출력하고 에러 없이 반환된다", async () => {
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
  it("frontmatter description을 포함한 .toml을 생성한다", async () => {
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

  it(".md를 .toml로 변환하고 .gemini/commands/ 에 저장한다", async () => {
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

  it("frontmatter가 없을 때 description이 빈 문자열인 .toml을 생성한다", async () => {
    const sourceFile = path.join(tmpDir, "commands", "simple.md");
    await writeFile(sourceFile, "# Simple Command\nNo frontmatter here.\n");

    await adapter.syncCommandsDirect(targetPath, "simple", sourceFile);

    const tomlFile = path.join(targetPath, ".gemini", "commands", "simple.toml");
    const content = await fs.readFile(tomlFile, "utf8");
    expect(content).toContain('name = "simple"');
    expect(content).toContain('description = ""');
  });

  it("dry-run 모드에서는 파일을 생성하지 않는다", async () => {
    const sourceFile = path.join(tmpDir, "commands", "prometheus.md");
    await writeFile(sourceFile, `---\ndescription: Test\n---\n`);

    await adapter.syncCommandsDirect(targetPath, "prometheus", sourceFile, true);

    const tomlFile = path.join(targetPath, ".gemini", "commands", "prometheus.toml");
    expect(await exists(tomlFile)).toBe(false);
  });

  it("소스 파일이 없으면 에러 없이 반환된다", async () => {
    const missingFile = path.join(tmpDir, "commands", "nonexistent.md");

    await expect(
      adapter.syncCommandsDirect(targetPath, "nonexistent", missingFile),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// syncHooksDirect — copy file + chmod +x
// ---------------------------------------------------------------------------

describe("syncHooksDirect", () => {
  it("훅 파일을 .gemini/hooks/ 에 복사하고 실행 권한을 부여한다", async () => {
    const sourceFile = path.join(tmpDir, "hooks", "test-hook.sh");
    await writeFile(sourceFile, "#!/bin/bash\necho test\n", 0o644);

    await adapter.syncHooksDirect(targetPath, "test-hook.sh", sourceFile);

    const targetFile = path.join(targetPath, ".gemini", "hooks", "test-hook.sh");
    expect(await exists(targetFile)).toBe(true);
    const stat = await fs.stat(targetFile);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it("훅 디렉토리를 .gemini/hooks/{name}/ 에 동기화한다", async () => {
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

  it("dry-run 모드에서는 파일을 복사하지 않는다", async () => {
    const sourceFile = path.join(tmpDir, "hooks", "test.sh");
    await writeFile(sourceFile, "#!/bin/bash\n");

    await adapter.syncHooksDirect(targetPath, "test.sh", sourceFile, true);

    const targetFile = path.join(targetPath, ".gemini", "hooks", "test.sh");
    expect(await exists(targetFile)).toBe(false);
  });

  it("소스가 없으면 에러 없이 반환된다", async () => {
    const missingFile = path.join(tmpDir, "hooks", "nonexistent.sh");

    await expect(
      adapter.syncHooksDirect(targetPath, "nonexistent.sh", missingFile),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// syncSkillsDirect — syncDirectory
// ---------------------------------------------------------------------------

describe("syncSkillsDirect", () => {
  it("스킬 디렉토리를 .gemini/skills/{name}/ 에 복사한다", async () => {
    const sourceDir = path.join(tmpDir, "skills", "prometheus");
    await writeFile(path.join(sourceDir, "SKILL.md"), "# Prometheus\n");
    await writeFile(path.join(sourceDir, "README.md"), "# Readme\n");

    await adapter.syncSkillsDirect(targetPath, "prometheus", sourceDir);

    const skillMd = path.join(targetPath, ".gemini", "skills", "prometheus", "SKILL.md");
    const readmeMd = path.join(targetPath, ".gemini", "skills", "prometheus", "README.md");
    expect(await exists(skillMd)).toBe(true);
    expect(await exists(readmeMd)).toBe(true);
  });

  it("dry-run 모드에서는 디렉토리를 생성하지 않는다", async () => {
    const sourceDir = path.join(tmpDir, "skills", "prometheus");
    await writeFile(path.join(sourceDir, "SKILL.md"), "# Prometheus\n");

    await adapter.syncSkillsDirect(targetPath, "prometheus", sourceDir, true);

    const targetSkillDir = path.join(targetPath, ".gemini", "skills", "prometheus");
    expect(await exists(targetSkillDir)).toBe(false);
  });

  it("소스 디렉토리가 없으면 에러 없이 반환된다", async () => {
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
  it("스크립트 디렉토리를 .gemini/scripts/{name}/ 에 복사한다", async () => {
    const sourceDir = path.join(tmpDir, "scripts", "hud");
    await writeFile(path.join(sourceDir, "index.ts"), "export {};\n");

    await adapter.syncScriptsDirect(targetPath, "hud", sourceDir);

    const targetFile = path.join(targetPath, ".gemini", "scripts", "hud", "index.ts");
    expect(await exists(targetFile)).toBe(true);
  });

  it("스크립트 단일 파일을 .gemini/scripts/ 에 복사한다", async () => {
    const sourceFile = path.join(tmpDir, "scripts", "deploy.sh");
    await writeFile(sourceFile, "#!/bin/bash\n");

    await adapter.syncScriptsDirect(targetPath, "deploy.sh", sourceFile);

    const targetFile = path.join(targetPath, ".gemini", "scripts", "deploy.sh");
    expect(await exists(targetFile)).toBe(true);
  });

  it("dry-run 모드에서는 파일을 복사하지 않는다", async () => {
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
  it("rules를 지원하지 않으므로 파일을 생성하지 않는다", async () => {
    const sourceFile = path.join(tmpDir, "rules", "coding-discipline.md");
    await writeFile(sourceFile, "# Coding Discipline\n");

    await adapter.syncRulesDirect(targetPath, "coding-discipline", sourceFile);

    const targetDir = path.join(targetPath, ".gemini", "rules");
    expect(await exists(targetDir)).toBe(false);
  });

  it("rules 지원 안 함 경고를 출력하고 에러 없이 반환된다", async () => {
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
  it("command 타입 훅 엔트리를 생성한다", () => {
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

  it("prompt 타입 훅 엔트리를 생성한다", () => {
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

  it("${component} 플레이스홀더를 displayName으로 치환한다", () => {
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

  it("matcher를 훅 그룹에 포함한다", () => {
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
  it("hooks를 settings.json에 저장한다", async () => {
    const hooksEntries = {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: ".gemini/hooks/test.sh", timeout: 10 }] }],
    };

    await adapter.updateSettings(targetPath, hooksEntries);

    const settings = await readJsonFile(path.join(targetPath, ".gemini", "settings.json"));
    expect(settings["PreToolUse"]).toBeDefined();
  });

  it("기존 settings.json에 훅을 병합한다", async () => {
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

  it("dry-run 모드에서는 파일을 생성하지 않는다", async () => {
    const hooksEntries = {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: ".gemini/hooks/test.sh", timeout: 10 }] }],
    };

    await adapter.updateSettings(targetPath, hooksEntries, true);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncConfig
// ---------------------------------------------------------------------------

describe("syncConfig", () => {
  it("설정값을 settings.json에 deep merge한다", async () => {
    await adapter.syncConfig(targetPath, { model: "gemini-2.0-flash" });

    const settings = await readJsonFile(
      path.join(targetPath, ".gemini", "settings.json"),
    );
    expect(settings["model"]).toBe("gemini-2.0-flash");
  });

  it("기존 settings.json과 deep merge한다", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(settingsFile, JSON.stringify({ existing: "value" }));

    await adapter.syncConfig(targetPath, { model: "gemini-2.0-flash" });

    const settings = await readJsonFile(settingsFile);
    expect(settings["existing"]).toBe("value");
    expect(settings["model"]).toBe("gemini-2.0-flash");
  });

  it("dry-run 모드에서는 파일을 생성하지 않는다", async () => {
    await adapter.syncConfig(targetPath, { model: "gemini-2.0-flash" }, true);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncMcpsMerge
// ---------------------------------------------------------------------------

describe("syncMcpsMerge", () => {
  it("MCP 서버를 settings.json mcpServers에 추가한다", async () => {
    const serverJson = { command: "npx", args: ["-y", "@upstash/context7-mcp"] };

    await adapter.syncMcpsMerge(targetPath, "context7", serverJson);

    const settings = await readJsonFile(
      path.join(targetPath, ".gemini", "settings.json"),
    );
    const mcpServers = settings["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["context7"]).toEqual(serverJson);
  });

  it("기존 mcpServers를 보존하면서 새 서버를 추가한다", async () => {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    await writeFile(
      settingsFile,
      JSON.stringify({ mcpServers: { existing: { command: "existing" } } }),
    );

    await adapter.syncMcpsMerge(targetPath, "context7", { command: "npx" });

    const settings = await readJsonFile(settingsFile);
    const mcpServers = settings["mcpServers"] as Record<string, unknown>;
    expect(mcpServers["existing"]).toBeDefined();
    expect(mcpServers["context7"]).toBeDefined();
  });

  it("dry-run 모드에서는 파일을 수정하지 않는다", async () => {
    await adapter.syncMcpsMerge(targetPath, "context7", { command: "npx" }, true);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syncPlatformYaml
// ---------------------------------------------------------------------------

describe("syncPlatformYaml", () => {
  it("config 섹션을 처리하고 processedSections에 포함한다", async () => {
    const yaml = { config: { model: "gemini-2.0-flash" } };

    const result = await adapter.syncPlatformYaml(targetPath, yaml, false);

    expect(result.processedSections).toContain("config");
    expect(result.modelMap).toBeUndefined();

    const settings = await readJsonFile(
      path.join(targetPath, ".gemini", "settings.json"),
    );
    expect(settings["model"]).toBe("gemini-2.0-flash");
  });

  it("mcps 섹션을 처리하고 processedSections에 포함한다", async () => {
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

  it("hooks 섹션을 처리하고 processedSections에 포함한다", async () => {
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

  it("모든 섹션이 없으면 processedSections가 비어있다", async () => {
    const result = await adapter.syncPlatformYaml(targetPath, {}, false);

    expect(result.processedSections).toHaveLength(0);
    expect(result.modelMap).toBeUndefined();
  });

  it("model-map은 지원하지 않으므로 modelMap이 undefined이다", async () => {
    const yaml = { config: { model: "gemini-2.0-flash" } };

    const result = await adapter.syncPlatformYaml(targetPath, yaml, false);

    expect(result.modelMap).toBeUndefined();
  });

  it("prompt 타입 훅을 settings.json에 저장한다", async () => {
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

  it("dry-run 모드에서는 settings.json을 생성하지 않는다", async () => {
    const yaml = {
      config: { model: "gemini-2.0-flash" },
      mcps: { context7: { command: "npx" } },
    };

    await adapter.syncPlatformYaml(targetPath, yaml, true);

    const settingsFile = path.join(targetPath, ".gemini", "settings.json");
    expect(await exists(settingsFile)).toBe(false);
  });

  it("여러 섹션을 한 번에 처리하고 모두 processedSections에 포함된다", async () => {
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
});
