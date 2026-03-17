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
  it("매핑된 모델명을 반환한다", () => {
    const map = { "claude-opus-4": "openai/o3", "claude-sonnet-4": "openai/gpt-4o" };
    expect(applyModelMap(map, "claude-opus-4")).toBe("openai/o3");
    expect(applyModelMap(map, "claude-sonnet-4")).toBe("openai/gpt-4o");
  });

  it("매핑이 없으면 원래 모델명을 반환한다", () => {
    const map = { "claude-opus-4": "openai/o3" };
    expect(applyModelMap(map, "unknown-model")).toBe("unknown-model");
  });

  it("빈 맵에서도 원래 모델명을 반환한다", () => {
    expect(applyModelMap({}, "some-model")).toBe("some-model");
  });
});

// =============================================================================
// translateAgentFrontmatter
// =============================================================================

describe("translateAgentFrontmatter", () => {
  it("add-skills 필드를 제거한다", () => {
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

  it("subagent_type을 mode: subagent로 변환한다", () => {
    const content = `---
name: oracle
subagent_type: general
---

Body.`;

    const result = translateAgentFrontmatter(content);

    expect(result).not.toContain("subagent_type");
    expect(result).toContain("mode: subagent");
  });

  it("subagent_type이 없으면 mode를 추가하지 않는다", () => {
    const content = `---
name: prometheus
---

Body.`;

    const result = translateAgentFrontmatter(content);

    expect(result).not.toContain("mode:");
    expect(result).toContain("name: prometheus");
  });

  it("본문의 --- 수평선을 보존한다 (P2-4 회귀 테스트)", () => {
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

  it("모델맵이 제공되면 model 필드에 적용한다 (P2-5)", () => {
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

  it("모델맵에 없는 model 값은 원래대로 유지한다 (P2-5)", () => {
    const content = `---
name: oracle
model: gpt-5-turbo
---

Body.`;

    const modelMap = { "claude-opus-4": "openai/o3" };
    const result = translateAgentFrontmatter(content, modelMap);

    expect(result).toContain("model: gpt-5-turbo");
  });

  it("모델맵이 없으면 model 필드를 그대로 유지한다", () => {
    const content = `---
name: oracle
model: claude-opus-4
---

Body.`;

    const result = translateAgentFrontmatter(content);

    expect(result).toContain("model: claude-opus-4");
  });

  it("프론트매터가 없으면 원본을 그대로 반환한다", () => {
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

  it("opencode.json이 없을 때 새로 생성한다", async () => {
    await syncConfig(tmpDir, { model: "openai/o3" }, false);

    const config = await readJson(
      path.join(tmpDir, ".opencode", "opencode.json"),
    );
    expect(config["model"]).toBe("openai/o3");
  });

  it("기존 opencode.json과 딥 머지한다 (새 값이 우선)", async () => {
    const configFile = path.join(tmpDir, ".opencode", "opencode.json");
    await writeJson(configFile, { model: "old-model", theme: "dark" });

    await syncConfig(tmpDir, { model: "new-model", fontSize: 14 }, false);

    const config = await readJson(configFile);
    expect(config["model"]).toBe("new-model");
    expect(config["theme"]).toBe("dark");
    expect(config["fontSize"]).toBe(14);
  });

  it("dry-run 모드에서는 파일을 쓰지 않는다", async () => {
    await syncConfig(tmpDir, { model: "openai/o3" }, true);

    const exists = await fs
      .access(path.join(tmpDir, ".opencode", "opencode.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
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

  it("opencode.json의 .mcp.<name>에 서버 정의를 머지한다", async () => {
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

  it("기존 MCP 서버를 보존하면서 새 서버를 추가한다", async () => {
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

  it("dry-run 모드에서는 파일을 쓰지 않는다", async () => {
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

  it("룰 파일을 .opencode/rules/에 복사하고 instructions glob을 추가한다", async () => {
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

  it("instructions glob은 멱등적으로 추가된다 (중복 없음)", async () => {
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

  it("기존 opencode.json의 instructions 배열에 glob을 추가한다", async () => {
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

  it("dry-run 모드에서는 파일을 쓰지 않는다", async () => {
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
  it("훅을 건너뛰고 정상 종료한다", async () => {
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

  it("config만 있는 YAML을 처리한다", async () => {
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

  it("모든 섹션이 있는 전체 YAML을 처리한다", async () => {
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

  it("model-map + config: model 필드에 모델 매핑을 적용한다", async () => {
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

  it("model-map 없이 config model 필드는 그대로 유지된다", async () => {
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

  it("hooks 섹션을 건너뛰고 processedSections에 포함한다", async () => {
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

  it("mcps 섹션을 처리하고 opencode.json에 머지한다", async () => {
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

  it("dry-run 모드에서는 파일을 쓰지 않는다", async () => {
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

  it("빈 YAML 객체는 processedSections가 비어있다", async () => {
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

  it("에이전트를 복사하고 프론트매터를 번역한다", async () => {
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

  it("dry-run 모드에서는 파일을 쓰지 않는다", async () => {
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

  it("modelMap이 전달되면 에이전트 프론트매터의 model 필드에 적용된다 (P2-5 런타임 배선)", async () => {
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
});
