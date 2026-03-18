import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { CodexAdapter, insertManagedBlock, buildMcpTomlContent } from "./codex.ts";

// =============================================================================
// insertManagedBlock
// =============================================================================

describe("insertManagedBlock", () => {
  test("빈 content에 블록 생성", () => {
    const result = insertManagedBlock("", "config", "key = \"value\"\n");
    expect(result).toBe(
      `# --- omt:config ---\nkey = "value"\n# --- end omt:config ---\n`
    );
  });

  test("기존 블록 교체 (content 사이 내용 대체)", () => {
    const existing =
      `# --- omt:config ---\nold = "data"\n# --- end omt:config ---\n`;
    const result = insertManagedBlock(existing, "config", `new = "data"\n`);
    expect(result).toBe(
      `# --- omt:config ---\nnew = "data"\n# --- end omt:config ---\n`
    );
  });

  test("managed block 외부 사용자 content 보존", () => {
    const existing =
      `# user config\nsome_setting = true\n\n# --- omt:config ---\nold = "data"\n# --- end omt:config ---\n\n# trailing comment\n`;
    const result = insertManagedBlock(existing, "config", `new = "data"\n`);
    expect(result).toContain("some_setting = true");
    expect(result).toContain("# trailing comment");
    expect(result).toContain(`new = "data"`);
    expect(result).not.toContain(`old = "data"`);
  });

  test("다른 이름의 managed block은 그대로 유지", () => {
    const existing =
      `# --- omt:mcp ---\nmcp_data = true\n# --- end omt:mcp ---\n`;
    const result = insertManagedBlock(existing, "config", `config_data = true\n`);
    // mcp block preserved
    expect(result).toContain("# --- omt:mcp ---");
    expect(result).toContain("mcp_data = true");
    // new config block appended
    expect(result).toContain("# --- omt:config ---");
    expect(result).toContain("config_data = true");
  });

  test("existing content 없을 때 markers 포함 블록 생성", () => {
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
  test("서버 3개 → 단일 TOML 블록", () => {
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

  test("빈 서버 목록 → 빈 TOML", () => {
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
  // syncAgentsDirect — skip with warning
  // ---------------------------------------------------------------------------

  describe("syncAgentsDirect", () => {
    test("agents skip with warning (no files created)", async () => {
      // Should not throw, should not create any files
      await adapter.syncAgentsDirect(tmpDir, "oracle", "/nonexistent/oracle.md");
      const codexDir = path.join(tmpDir, ".codex");
      const exists = await fs
        .stat(codexDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    test("dryRun도 skip", async () => {
      await adapter.syncAgentsDirect(tmpDir, "oracle", "/nonexistent/oracle.md", [], [], true);
      const exists = await fs
        .stat(path.join(tmpDir, ".codex"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // syncRulesDirect — skip with warning
  // ---------------------------------------------------------------------------

  describe("syncRulesDirect", () => {
    test("rules skip with warning (no files created)", async () => {
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
    test("config → TOML managed block in config.toml", async () => {
      await adapter.syncConfig(
        tmpDir,
        { model: "o4-mini", temperature: 0.7 },
        false
      );
      const configFile = path.join(tmpDir, ".codex", "config.toml");
      const content = await fs.readFile(configFile, "utf-8");
      expect(content).toContain("# --- omt:config ---");
      expect(content).toContain("# --- end omt:config ---");
      expect(content).toContain("model");
      expect(content).toContain("o4-mini");
    });

    test("config 재호출 시 managed block 교체 (기존 content 보존)", async () => {
      // Write initial user content
      const configFile = path.join(tmpDir, ".codex", "config.toml");
      await fs.mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await fs.writeFile(
        configFile,
        `# user config\nsome_setting = true\n`,
        "utf-8"
      );

      await adapter.syncConfig(tmpDir, { model: "o4-mini" }, false);
      const content = await fs.readFile(configFile, "utf-8");

      expect(content).toContain("some_setting = true");
      expect(content).toContain("# --- omt:config ---");
      expect(content).toContain("o4-mini");
    });

    test("dryRun: config.toml 미생성", async () => {
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
    test("3개 서버 accumulate → 단일 omt:mcp managed block", async () => {
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

    test("기존 omt:mcp block 교체 + 외부 content 보존", async () => {
      const configFile = path.join(tmpDir, ".codex", "config.toml");
      await fs.mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await fs.writeFile(
        configFile,
        `model = "o4-mini"\n\n# --- omt:mcp ---\nold_server = {}\n# --- end omt:mcp ---\n`,
        "utf-8"
      );

      adapter.resetMcpAccumulator();
      adapter.accumulateMcp("new-server", { command: "npx" });
      await adapter.flushMcpBlock(tmpDir, false);

      const content = await fs.readFile(configFile, "utf-8");
      expect(content).toContain(`model = "o4-mini"`);
      expect(content).not.toContain("old_server");
      expect(content).toContain("new-server");
    });

    test("빈 accumulator → config.toml 변경 없음", async () => {
      adapter.resetMcpAccumulator();
      // flushMcpBlock with 0 servers should not create file
      await adapter.flushMcpBlock(tmpDir, false);
      const exists = await fs
        .stat(path.join(tmpDir, ".codex", "config.toml"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    test("빈 accumulator + 기존 omt:mcp 블록 존재 → 빈 블록으로 교체", async () => {
      const configFile = path.join(tmpDir, ".codex", "config.toml");
      await fs.mkdir(path.join(tmpDir, ".codex"), { recursive: true });
      await fs.writeFile(
        configFile,
        `model = "o4-mini"\n\n# --- omt:mcp ---\n[mcp_servers.old-server]\ncommand = "npx"\n# --- end omt:mcp ---\n`,
        "utf-8"
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
    test("model-map 반환", async () => {
      const yaml = {
        "model-map": {
          "claude-3-5-sonnet": "o4-mini",
          "claude-3-haiku": "o3-mini",
        },
      };
      const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
      expect(result.processedSections).toContain("model-map");
      expect(result.modelMap).toEqual({
        "claude-3-5-sonnet": "o4-mini",
        "claude-3-haiku": "o3-mini",
      });
    });

    test("config 처리 → processedSections에 포함", async () => {
      const yaml = { config: { model: "o4-mini" } };
      const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
      expect(result.processedSections).toContain("config");
    });

    test("mcps 처리 → processedSections에 포함 + managed block 생성", async () => {
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

    test("config+mcps+model-map 모두 처리", async () => {
      const yaml = {
        config: { model: "o4-mini" },
        mcps: { "srv": { command: "npx" } },
        "model-map": { "claude-3-5-sonnet": "o4-mini" },
      };
      const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
      expect(result.processedSections).toContain("config");
      expect(result.processedSections).toContain("mcps");
      expect(result.processedSections).toContain("model-map");
      expect(result.modelMap).toBeDefined();
    });

    test("dryRun: config.toml 미생성", async () => {
      const yaml = {
        config: { model: "o4-mini" },
        mcps: { "srv": { command: "npx" } },
      };
      await adapter.syncPlatformYaml(tmpDir, yaml, true);
      const exists = await fs
        .stat(path.join(tmpDir, ".codex", "config.toml"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    test("model-map 없으면 modelMap은 undefined", async () => {
      const yaml = { config: { model: "o4-mini" } };
      const result = await adapter.syncPlatformYaml(tmpDir, yaml, false);
      expect(result.modelMap).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // syncSkillsDirect
  // ---------------------------------------------------------------------------

  describe("syncSkillsDirect", () => {
    test("skill 디렉토리 복사", async () => {
      // Create a source skill directory
      const sourceSkill = path.join(tmpDir, "source-skills", "prometheus");
      await fs.mkdir(sourceSkill, { recursive: true });
      await fs.writeFile(path.join(sourceSkill, "SKILL.md"), "# Prometheus\n");

      const targetBase = path.join(tmpDir, "target");
      await adapter.syncSkillsDirect(targetBase, "prometheus", sourceSkill, false);

      const targetFile = path.join(targetBase, ".codex", "skills", "prometheus", "SKILL.md");
      const content = await fs.readFile(targetFile, "utf-8");
      expect(content).toBe("# Prometheus\n");
    });

    test("존재하지 않는 소스 → warn, 파일 미생성", async () => {
      const targetBase = path.join(tmpDir, "target");
      await adapter.syncSkillsDirect(
        targetBase,
        "prometheus",
        path.join(tmpDir, "nonexistent"),
        false
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
    test("hook 파일 복사 + chmod +x", async () => {
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

    test("존재하지 않는 hook → warn, 파일 미생성", async () => {
      const targetBase = path.join(tmpDir, "target");
      await adapter.syncHooksDirect(
        targetBase,
        "notify.sh",
        path.join(tmpDir, "nonexistent.sh"),
        false
      );
      const exists = await fs
        .stat(path.join(targetBase, ".codex"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // syncCommandsDirect — skip with warning
  // ---------------------------------------------------------------------------

  describe("syncCommandsDirect", () => {
    test("commands skip with warning", async () => {
      await adapter.syncCommandsDirect(tmpDir, "my-command", "/nonexistent.md");
      const exists = await fs
        .stat(path.join(tmpDir, ".codex"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // updateSettings — hooks not supported
  // ---------------------------------------------------------------------------

  describe("updateSettings", () => {
    test("hooks 미지원 경고 출력 + config.toml 미생성", async () => {
      const stderrChunks: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return originalWrite(chunk, ...(args as Parameters<typeof originalWrite> extends [unknown, ...infer R] ? R : []));
      };

      try {
        await adapter.updateSettings(tmpDir, [{ event: "Stop", command: "echo done" }], false);
      } finally {
        process.stderr.write = originalWrite;
      }

      const output = stderrChunks.join("");
      expect(output).toContain("Codex does not support hooks");

      // Must not create any files
      const exists = await fs
        .stat(path.join(tmpDir, ".codex", "config.toml"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });

    test("dryRun도 hooks 미지원 경고 출력 + config.toml 미생성", async () => {
      const stderrChunks: string[] = [];
      const originalWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return originalWrite(chunk, ...(args as Parameters<typeof originalWrite> extends [unknown, ...infer R] ? R : []));
      };

      try {
        await adapter.updateSettings(tmpDir, [], true);
      } finally {
        process.stderr.write = originalWrite;
      }

      const output = stderrChunks.join("");
      expect(output).toContain("Codex does not support hooks");

      const exists = await fs
        .stat(path.join(tmpDir, ".codex", "config.toml"))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    });
  });
});
