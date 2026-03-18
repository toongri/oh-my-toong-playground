import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { CodexAdapter, insertManagedBlock, buildMcpTomlContent } from "./codex.ts";

// =============================================================================
// insertManagedBlock
// =============================================================================

describe("insertManagedBlock", () => {
  it("creates a block in empty content via `insertManagedBlock`", () => {
    const result = insertManagedBlock("", "config", "key = \"value\"\n");
    expect(result).toBe(
      `# --- omt:config ---\nkey = "value"\n# --- end omt:config ---\n`
    );
  });

  it("replaces existing block content via `insertManagedBlock`", () => {
    const existing =
      `# --- omt:config ---\nold = "data"\n# --- end omt:config ---\n`;
    const result = insertManagedBlock(existing, "config", `new = "data"\n`);
    expect(result).toBe(
      `# --- omt:config ---\nnew = "data"\n# --- end omt:config ---\n`
    );
  });

  it("preserves user content outside managed block via `insertManagedBlock`", () => {
    const existing =
      `# user config\nsome_setting = true\n\n# --- omt:config ---\nold = "data"\n# --- end omt:config ---\n\n# trailing comment\n`;
    const result = insertManagedBlock(existing, "config", `new = "data"\n`);
    expect(result).toContain("some_setting = true");
    expect(result).toContain("# trailing comment");
    expect(result).toContain(`new = "data"`);
    expect(result).not.toContain(`old = "data"`);
  });

  it("preserves managed blocks with different names via `insertManagedBlock`", () => {
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
  // syncAgentsDirect — skip with warning
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

    it("replaces managed block on re-call while preserving existing content via `syncConfig`", async () => {
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
    it("returns model-map in result via `syncPlatformYaml`", async () => {
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

    it("processes config, mcps, and model-map sections together via `syncPlatformYaml`", async () => {
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

    it("skips config.toml creation in dry-run mode via `syncPlatformYaml`", async () => {
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
      const existingContent = [
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
    it("copies skill directory to target via `syncSkillsDirect`", async () => {
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

    it("logs warning and creates no files when source is missing via `syncSkillsDirect`", async () => {
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
  // updateSettings — hooks not supported
  // ---------------------------------------------------------------------------

  describe("updateSettings", () => {
    it("logs hooks-unsupported warning and creates no config.toml via `updateSettings`", async () => {
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

    it("logs hooks-unsupported warning and creates no config.toml in dry-run mode via `updateSettings`", async () => {
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
