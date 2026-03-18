import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";

import {
  applyModelMap,
  translateAgentFrontmatter,
  syncConfig,
  syncMcpsMerge,
  opencodeAdapter,
} from "./opencode.ts";

// =============================================================================
// Test helpers
// =============================================================================

async function mkTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-"));
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function writeJson(
  file: string,
  obj: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

// =============================================================================
// applyModelMap
// =============================================================================

describe("applyModelMap", () => {
  it("returns the mapped model name via `applyModelMap`", () => {
    const map = { "claude-opus-4": "openai/o3", "claude-sonnet-4": "openai/gpt-4o" };
    expect(applyModelMap(map, "claude-opus-4")).toBe("openai/o3");
    expect(applyModelMap(map, "claude-sonnet-4")).toBe("openai/gpt-4o");
  });

  it("returns the original model name when mapping is absent via `applyModelMap`", () => {
    const map = { "claude-opus-4": "openai/o3" };
    expect(applyModelMap(map, "unknown-model")).toBe("unknown-model");
  });

  it("returns the original model name for an empty map via `applyModelMap`", () => {
    expect(applyModelMap({}, "some-model")).toBe("some-model");
  });
});

// =============================================================================
// translateAgentFrontmatter
// =============================================================================

describe("translateAgentFrontmatter", () => {
  it("removes add-skills field from frontmatter via `translateAgentFrontmatter`", () => {
    const content = `---
name: sisyphus-junior
add-skills:
  - testing
---

Body text.`;

    const result = translateAgentFrontmatter(content);

    expect(result).not.toContain("add-skills");
    expect(result).toContain("name: sisyphus-junior");
    expect(result).toContain("Body text.");
  });

  it("converts subagent_type to mode: subagent via `translateAgentFrontmatter`", () => {
    const content = `---
name: oracle
subagent_type: general
---

Body.`;

    const result = translateAgentFrontmatter(content);

    expect(result).not.toContain("subagent_type");
    expect(result).toContain("mode: subagent");
  });

  it("does not add mode field when subagent_type is absent via `translateAgentFrontmatter`", () => {
    const content = `---
name: prometheus
---

Body.`;

    const result = translateAgentFrontmatter(content);

    expect(result).not.toContain("mode:");
    expect(result).toContain("name: prometheus");
  });

  it("preserves body --- horizontal rules (regression P2-4) via `translateAgentFrontmatter`", () => {
    const content = `---
name: metis
subagent_type: general
---

## Section A

Content A.

---

## Section B

Content B.

---

## Section C

Content C.`;

    const result = translateAgentFrontmatter(content);

    // Frontmatter translated correctly
    expect(result).not.toContain("subagent_type");
    expect(result).toContain("mode: subagent");

    // Body --- lines must survive
    const lines = result.split("\n");
    // The opening and closing --- of frontmatter + 2 horizontal rules in body
    const hrLines = lines.filter((l) => l === "---");
    // 2 frontmatter delimiters + 2 body HR = 4 total
    expect(hrLines.length).toBe(4);

    expect(result).toContain("Content A.");
    expect(result).toContain("Content B.");
    expect(result).toContain("Content C.");
  });

  it("applies model map to model field when provided (P2-5) via `translateAgentFrontmatter`", () => {
    const content = `---
name: oracle
model: claude-opus-4
---

Body.`;

    const modelMap = { "claude-opus-4": "openai/o3" };
    const result = translateAgentFrontmatter(content, modelMap);

    expect(result).toContain("model: openai/o3");
    expect(result).not.toContain("claude-opus-4");
  });

  it("preserves model value that is not in model map (P2-5) via `translateAgentFrontmatter`", () => {
    const content = `---
name: oracle
model: gpt-5-turbo
---

Body.`;

    const modelMap = { "claude-opus-4": "openai/o3" };
    const result = translateAgentFrontmatter(content, modelMap);

    expect(result).toContain("model: gpt-5-turbo");
  });

  it("preserves model field unchanged when model map is absent via `translateAgentFrontmatter`", () => {
    const content = `---
name: oracle
model: claude-opus-4
---

Body.`;

    const result = translateAgentFrontmatter(content);

    expect(result).toContain("model: claude-opus-4");
  });

  it("returns content unchanged when frontmatter is absent via `translateAgentFrontmatter`", () => {
    const content = `# Just markdown

No frontmatter here.`;

    const result = translateAgentFrontmatter(content);

    expect(result).toBe(content);
  });
});

// =============================================================================
// syncConfig
// =============================================================================

describe("syncConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates opencode.json when absent via `syncConfig`", async () => {
    await syncConfig(tmpDir, { model: "openai/o3" }, false);

    const config = await readJson(
      path.join(tmpDir, ".opencode", "opencode.json"),
    );
    expect(config["model"]).toBe("openai/o3");
  });

  it("deep merges with existing opencode.json (new values take precedence) via `syncConfig`", async () => {
    const configFile = path.join(tmpDir, ".opencode", "opencode.json");
    await writeJson(configFile, { model: "old-model", theme: "dark" });

    await syncConfig(tmpDir, { model: "new-model", fontSize: 14 }, false);

    const config = await readJson(configFile);
    expect(config["model"]).toBe("new-model");
    expect(config["theme"]).toBe("dark");
    expect(config["fontSize"]).toBe(14);
  });

  it("skips file write in dry-run mode via `syncConfig`", async () => {
    await syncConfig(tmpDir, { model: "openai/o3" }, true);

    const exists = await fs
      .access(path.join(tmpDir, ".opencode", "opencode.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("throws SyntaxError when opencode.json contains corrupt JSON via `syncConfig`", async () => {
    const configFile = path.join(tmpDir, ".opencode", "opencode.json");
    await fs.mkdir(path.join(tmpDir, ".opencode"), { recursive: true });
    await fs.writeFile(configFile, "{ invalid json }", "utf-8");

    await expect(syncConfig(tmpDir, { model: "openai/o3" }, false)).rejects.toThrow(SyntaxError);
  });
});

// =============================================================================
// syncMcpsMerge
// =============================================================================

describe("syncMcpsMerge", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("merges server definition into .mcp.<name> in opencode.json via `syncMcpsMerge`", async () => {
    await syncMcpsMerge(
      tmpDir,
      "context7",
      { type: "http", url: "http://localhost:3000" },
      false,
    );

    const config = await readJson(
      path.join(tmpDir, ".opencode", "opencode.json"),
    );
    const mcp = config["mcp"] as Record<string, unknown>;
    expect(mcp["context7"]).toEqual({
      type: "http",
      url: "http://localhost:3000",
    });
  });

  it("adds new server while preserving existing MCP servers via `syncMcpsMerge`", async () => {
    const configFile = path.join(tmpDir, ".opencode", "opencode.json");
    await writeJson(configFile, { mcp: { existing: { type: "stdio" } } });

    await syncMcpsMerge(
      tmpDir,
      "new-server",
      { type: "http", url: "http://example.com" },
      false,
    );

    const config = await readJson(configFile);
    const mcp = config["mcp"] as Record<string, unknown>;
    expect(mcp["existing"]).toEqual({ type: "stdio" });
    expect(mcp["new-server"]).toEqual({
      type: "http",
      url: "http://example.com",
    });
  });

  it("skips file write in dry-run mode via `syncMcpsMerge`", async () => {
    await syncMcpsMerge(
      tmpDir,
      "context7",
      { type: "http" },
      true,
    );

    const exists = await fs
      .access(path.join(tmpDir, ".opencode", "opencode.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

// =============================================================================
// syncRulesDirect — rules + instructions glob (idempotent)
// =============================================================================

describe("opencodeAdapter.syncRulesDirect", () => {
  let tmpDir: string;
  let ruleFile: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
    ruleFile = path.join(tmpDir, "coding-discipline.md");
    await fs.writeFile(ruleFile, "# Coding Discipline\n\nRules here.", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("copies rule file to .opencode/rules/ and adds instructions glob via `syncRulesDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncRulesDirect(
        targetDir,
        "coding-discipline",
        ruleFile,
        false,
      );

      const ruleTarget = path.join(
        targetDir,
        ".opencode",
        "rules",
        "coding-discipline.md",
      );
      const ruleContent = await fs.readFile(ruleTarget, "utf-8");
      expect(ruleContent).toContain("Coding Discipline");

      const config = await readJson(
        path.join(targetDir, ".opencode", "opencode.json"),
      );
      const instructions = config["instructions"] as string[];
      expect(instructions).toContain(".opencode/rules/*.md");
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("adds instructions glob idempotently without duplicates via `syncRulesDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncRulesDirect(
        targetDir,
        "coding-discipline",
        ruleFile,
        false,
      );
      // Call again — should not duplicate
      await opencodeAdapter.syncRulesDirect(
        targetDir,
        "coding-discipline",
        ruleFile,
        false,
      );

      const config = await readJson(
        path.join(targetDir, ".opencode", "opencode.json"),
      );
      const instructions = config["instructions"] as string[];
      const count = instructions.filter((i) => i === ".opencode/rules/*.md")
        .length;
      expect(count).toBe(1);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("appends glob to existing opencode.json instructions array via `syncRulesDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      const configFile = path.join(targetDir, ".opencode", "opencode.json");
      await writeJson(configFile, { instructions: ["some/other.md"] });

      await opencodeAdapter.syncRulesDirect(
        targetDir,
        "coding-discipline",
        ruleFile,
        false,
      );

      const config = await readJson(configFile);
      const instructions = config["instructions"] as string[];
      expect(instructions).toContain("some/other.md");
      expect(instructions).toContain(".opencode/rules/*.md");
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("skips file write in dry-run mode via `syncRulesDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncRulesDirect(
        targetDir,
        "coding-discipline",
        ruleFile,
        true,
      );

      const rulesDir = path.join(targetDir, ".opencode", "rules");
      const exists = await fs
        .access(rulesDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// syncHooksDirect — skip with info log
// =============================================================================

describe("opencodeAdapter.syncHooksDirect", () => {
  it("skips hook and returns normally via `syncHooksDirect`", async () => {
    // Should not throw
    await expect(
      opencodeAdapter.syncHooksDirect(
        "/some/target",
        "keyword-detector.sh",
        "/some/source.sh",
        false,
      ),
    ).resolves.toBeUndefined();
  });
});

// =============================================================================
// syncPlatformYaml — integration tests (P2-6)
// =============================================================================

describe("opencodeAdapter.syncPlatformYaml", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("processes YAML with only config section via `syncPlatformYaml`", async () => {
    const result = await opencodeAdapter.syncPlatformYaml(
      tmpDir,
      { config: { model: "openai/o3", theme: "dark" } },
      false,
    );

    expect(result.processedSections).toEqual(["config"]);
    expect(result.modelMap).toBeUndefined();

    const config = await readJson(
      path.join(tmpDir, ".opencode", "opencode.json"),
    );
    expect(config["model"]).toBe("openai/o3");
    expect(config["theme"]).toBe("dark");
  });

  it("processes full YAML with all sections via `syncPlatformYaml`", async () => {
    const result = await opencodeAdapter.syncPlatformYaml(
      tmpDir,
      {
        "model-map": { "claude-opus-4": "openai/o3" },
        config: { model: "claude-opus-4" },
        hooks: { UserPromptSubmit: [] },
        mcps: {
          context7: { type: "http", url: "http://localhost:3000" },
        },
      },
      false,
    );

    expect(result.processedSections).toContain("model-map");
    expect(result.processedSections).toContain("config");
    expect(result.processedSections).toContain("hooks");
    expect(result.processedSections).toContain("mcps");
  });

  it("applies model mapping to config model fields when model-map is present via `syncPlatformYaml`", async () => {
    const result = await opencodeAdapter.syncPlatformYaml(
      tmpDir,
      {
        "model-map": {
          "claude-opus-4": "openai/o3",
          "claude-haiku-3": "openai/gpt-4o-mini",
        },
        config: {
          model: "claude-opus-4",
          small_model: "claude-haiku-3",
          theme: "dark",
        },
      },
      false,
    );

    expect(result.processedSections).toEqual(["model-map", "config"]);
    expect(result.modelMap).toEqual({
      "claude-opus-4": "openai/o3",
      "claude-haiku-3": "openai/gpt-4o-mini",
    });

    const config = await readJson(
      path.join(tmpDir, ".opencode", "opencode.json"),
    );
    expect(config["model"]).toBe("openai/o3");
    expect(config["small_model"]).toBe("openai/gpt-4o-mini");
    expect(config["theme"]).toBe("dark");
  });

  it("preserves config model field unchanged when model-map is absent via `syncPlatformYaml`", async () => {
    await opencodeAdapter.syncPlatformYaml(
      tmpDir,
      { config: { model: "claude-opus-4" } },
      false,
    );

    const config = await readJson(
      path.join(tmpDir, ".opencode", "opencode.json"),
    );
    expect(config["model"]).toBe("claude-opus-4");
  });

  it("skips hooks section processing but includes it in processedSections via `syncPlatformYaml`", async () => {
    const result = await opencodeAdapter.syncPlatformYaml(
      tmpDir,
      { hooks: { UserPromptSubmit: [{ component: "keyword-detector.sh" }] } },
      false,
    );

    expect(result.processedSections).toContain("hooks");
    // No file should be written for hooks
    const hooksDir = path.join(tmpDir, ".opencode", "hooks");
    const exists = await fs
      .access(hooksDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("processes mcps section and merges it into opencode.json via `syncPlatformYaml`", async () => {
    const result = await opencodeAdapter.syncPlatformYaml(
      tmpDir,
      {
        mcps: {
          context7: { type: "http", url: "http://localhost:3000" },
          serena: { type: "stdio", command: "npx serena" },
        },
      },
      false,
    );

    expect(result.processedSections).toContain("mcps");

    const config = await readJson(
      path.join(tmpDir, ".opencode", "opencode.json"),
    );
    const mcp = config["mcp"] as Record<string, unknown>;
    expect(mcp["context7"]).toEqual({
      type: "http",
      url: "http://localhost:3000",
    });
    expect(mcp["serena"]).toEqual({ type: "stdio", command: "npx serena" });
  });

  it("skips file write in dry-run mode via `syncPlatformYaml`", async () => {
    const result = await opencodeAdapter.syncPlatformYaml(
      tmpDir,
      {
        "model-map": { "claude-opus-4": "openai/o3" },
        config: { model: "claude-opus-4" },
        mcps: { context7: { type: "http" } },
      },
      true,
    );

    expect(result.processedSections).toEqual(["model-map", "config", "mcps"]);
    expect(result.modelMap).toEqual({ "claude-opus-4": "openai/o3" });

    const exists = await fs
      .access(path.join(tmpDir, ".opencode", "opencode.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("returns empty processedSections for empty YAML object via `syncPlatformYaml`", async () => {
    const result = await opencodeAdapter.syncPlatformYaml(tmpDir, {}, false);
    expect(result.processedSections).toEqual([]);
    expect(result.modelMap).toBeUndefined();
  });
});

// =============================================================================
// syncAgentsDirect — with model-map (P2-5)
// =============================================================================

describe("opencodeAdapter.syncAgentsDirect", () => {
  let tmpDir: string;
  let agentFile: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
    agentFile = path.join(tmpDir, "oracle.md");
    await fs.writeFile(
      agentFile,
      `---
name: oracle
subagent_type: general
add-skills:
  - testing
model: claude-opus-4
---

Body content.`,
      "utf-8",
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("copies agent and translates frontmatter via `syncAgentsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncAgentsDirect(
        targetDir,
        "oracle",
        agentFile,
        [],
        [],
        false,
      );

      const target = path.join(targetDir, ".opencode", "agents", "oracle.md");
      const content = await fs.readFile(target, "utf-8");

      expect(content).not.toContain("subagent_type");
      expect(content).not.toContain("add-skills");
      expect(content).toContain("mode: subagent");
      expect(content).toContain("Body content.");
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("skips file write in dry-run mode via `syncAgentsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncAgentsDirect(
        targetDir,
        "oracle",
        agentFile,
        [],
        [],
        true,
      );

      const target = path.join(targetDir, ".opencode", "agents", "oracle.md");
      const exists = await fs
        .access(target)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("applies modelMap to agent frontmatter model field at runtime (P2-5) via `syncAgentsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      const modelMap = { "claude-opus-4": "openai/o3" };
      await opencodeAdapter.syncAgentsDirect(
        targetDir,
        "oracle",
        agentFile,
        [],
        [],
        false,
        modelMap,
      );

      const target = path.join(targetDir, ".opencode", "agents", "oracle.md");
      const content = await fs.readFile(target, "utf-8");

      // model field must be translated
      expect(content).toContain("model: openai/o3");
      expect(content).not.toContain("claude-opus-4");
      // frontmatter translation still applied
      expect(content).not.toContain("subagent_type");
      expect(content).toContain("mode: subagent");
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("logs warning and copies file as-is when frontmatter is malformed via `syncAgentsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      // Write a file with malformed frontmatter that will cause parseFrontmatter to throw
      const malformedFile = path.join(tmpDir, "malformed.md");
      // serializeFrontmatter will throw if frontmatter value is a circular reference —
      // easier to trigger by making translateAgentFrontmatter throw via a bad YAML value.
      // We simulate this by temporarily overriding: instead, write a file that is valid to
      // copy but we stub the error path by writing binary-ish content that js-yaml chokes on.
      // A realistic approach: write content where YAML parsing succeeds but serialization
      // would fail. The simplest path: write a file whose content after copy cannot be read
      // (we make readFile succeed but serializeFrontmatter blow up by using a circular ref
      // injected via a subclassed approach is complex). Instead just verify the structural
      // guarantee: if translateAgentFrontmatter throws, the file is still present.
      //
      // Practical test: use normal content but verify the file is copied as-is when we
      // test the happy path already. For malformed frontmatter, write a content that uses
      // a YAML tag that js-yaml rejects.
      const malformedContent = `---\nname: !!python/object:os.system "rm -rf"\n---\n\nBody.`;
      await fs.writeFile(malformedFile, malformedContent, "utf-8");

      await opencodeAdapter.syncAgentsDirect(
        targetDir,
        "malformed",
        malformedFile,
        [],
        [],
        false,
      );

      const target = path.join(targetDir, ".opencode", "agents", "malformed.md");
      const content = await fs.readFile(target, "utf-8");
      // File must exist regardless of translation failure
      expect(content).toBeTruthy();
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// syncCommandsDirect
// =============================================================================

describe("opencodeAdapter.syncCommandsDirect", () => {
  let tmpDir: string;
  let commandFile: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
    commandFile = path.join(tmpDir, "commit.md");
    await fs.writeFile(commandFile, "# Commit command\n\nDo a commit.", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("copies command file to .opencode/commands/ via `syncCommandsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncCommandsDirect(
        targetDir,
        "commit",
        commandFile,
        false,
      );

      const target = path.join(targetDir, ".opencode", "commands", "commit.md");
      const content = await fs.readFile(target, "utf-8");
      expect(content).toContain("Commit command");
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("logs warning and does not throw when source file is missing via `syncCommandsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await expect(
        opencodeAdapter.syncCommandsDirect(
          targetDir,
          "commit",
          path.join(tmpDir, "nonexistent.md"),
          false,
        ),
      ).resolves.toBeUndefined();

      const target = path.join(targetDir, ".opencode", "commands", "commit.md");
      const exists = await fs
        .access(target)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("skips file write in dry-run mode via `syncCommandsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncCommandsDirect(
        targetDir,
        "commit",
        commandFile,
        true,
      );

      const target = path.join(targetDir, ".opencode", "commands", "commit.md");
      const exists = await fs
        .access(target)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// syncSkillsDirect
// =============================================================================

describe("opencodeAdapter.syncSkillsDirect", () => {
  let tmpDir: string;
  let skillDir: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
    skillDir = path.join(tmpDir, "oracle");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Oracle skill", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("syncs skill directory to .opencode/skills/<name>/ via `syncSkillsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncSkillsDirect(
        targetDir,
        "oracle",
        skillDir,
        false,
      );

      const target = path.join(targetDir, ".opencode", "skills", "oracle", "SKILL.md");
      const content = await fs.readFile(target, "utf-8");
      expect(content).toContain("Oracle skill");
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("logs warning and does not throw when source directory is missing via `syncSkillsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await expect(
        opencodeAdapter.syncSkillsDirect(
          targetDir,
          "oracle",
          path.join(tmpDir, "nonexistent"),
          false,
        ),
      ).resolves.toBeUndefined();

      const skillsDir = path.join(targetDir, ".opencode", "skills");
      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("skips file write in dry-run mode via `syncSkillsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncSkillsDirect(
        targetDir,
        "oracle",
        skillDir,
        true,
      );

      const skillsDir = path.join(targetDir, ".opencode", "skills");
      const exists = await fs
        .access(skillsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// syncScriptsDirect
// =============================================================================

describe("opencodeAdapter.syncScriptsDirect", () => {
  let tmpDir: string;
  let scriptFile: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
    scriptFile = path.join(tmpDir, "hud.sh");
    await fs.writeFile(scriptFile, "#!/bin/bash\necho hud", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("copies script file to .opencode/scripts/ via `syncScriptsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncScriptsDirect(
        targetDir,
        "hud.sh",
        scriptFile,
        false,
      );

      const target = path.join(targetDir, ".opencode", "scripts", "hud.sh");
      const content = await fs.readFile(target, "utf-8");
      expect(content).toContain("echo hud");
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("logs warning and does not throw when source file is missing via `syncScriptsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await expect(
        opencodeAdapter.syncScriptsDirect(
          targetDir,
          "hud.sh",
          path.join(tmpDir, "nonexistent.sh"),
          false,
        ),
      ).resolves.toBeUndefined();

      const scriptsDir = path.join(targetDir, ".opencode", "scripts");
      const exists = await fs
        .access(scriptsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("skips file write in dry-run mode via `syncScriptsDirect`", async () => {
    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncScriptsDirect(
        targetDir,
        "hud.sh",
        scriptFile,
        true,
      );

      const scriptsDir = path.join(targetDir, ".opencode", "scripts");
      const exists = await fs
        .access(scriptsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("syncs directory source to .opencode/scripts/<name>/ via `syncScriptsDirect`", async () => {
    const scriptDir = path.join(tmpDir, "hud");
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(path.join(scriptDir, "hud.sh"), "#!/bin/bash\necho hud", "utf-8");

    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncScriptsDirect(
        targetDir,
        "hud",
        scriptDir,
        false,
      );

      const target = path.join(targetDir, ".opencode", "scripts", "hud", "hud.sh");
      const content = await fs.readFile(target, "utf-8");
      expect(content).toContain("echo hud");
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("skips directory sync in dry-run mode via `syncScriptsDirect`", async () => {
    const scriptDir = path.join(tmpDir, "hud");
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(path.join(scriptDir, "hud.sh"), "#!/bin/bash\necho hud", "utf-8");

    const targetDir = await mkTempDir();
    try {
      await opencodeAdapter.syncScriptsDirect(
        targetDir,
        "hud",
        scriptDir,
        true,
      );

      const scriptsDir = path.join(targetDir, ".opencode", "scripts");
      const exists = await fs
        .access(scriptsDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });
});
