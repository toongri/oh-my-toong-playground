import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";

import {
  validateSyncYamlComponents,
  validatePlatformYamlHookComponents,
  validateAll,
} from "./components.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `comp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function touch(path: string): void {
  const parent = path.split("/").slice(0, -1).join("/");
  mkdirSync(parent, { recursive: true });
  writeFileSync(path, "# placeholder\n", "utf-8");
}

function writeYaml(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

/**
 * Build a minimal root structure:
 *   rootDir/
 *     config.yaml          (so getRootDir works)
 *     CLAUDE.md            (CLI project file)
 *     sync.yaml            (created by caller)
 */
function makeRoot(): string {
  const root = makeTempDir();
  touch(join(root, "config.yaml"));
  touch(join(root, "CLAUDE.md"));
  return root;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "T",
  GIT_AUTHOR_EMAIL: "t@t.com",
  GIT_COMMITTER_NAME: "T",
  GIT_COMMITTER_EMAIL: "t@t.com",
};

/**
 * Seeds an empty commit into a bare repo so worktrees can be added.
 * Mirrors the recipe from tools/lib/git-key.test.ts.
 */
function seedBareRepo(bareDir: string): void {
  const tmpWt = fs.mkdtempSync(join(os.tmpdir(), "comp-test-seed-"));
  try {
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", "--orphan", "-b", "main", tmpWt], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    execFileSync("git", ["-C", tmpWt, "commit", "--allow-empty", "-m", "init"], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    fs.rmSync(tmpWt, { recursive: true, force: true });
    execFileSync("git", ["--git-dir", bareDir, "worktree", "prune"], {
      stdio: "pipe",
    });
  } catch {
    fs.rmSync(tmpWt, { recursive: true, force: true });
    throw new Error("Failed to seed bare repo");
  }
}

// ---------------------------------------------------------------------------
// Suite: validateSyncYamlComponents
// ---------------------------------------------------------------------------

describe("validateSyncYamlComponents", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // --- Valid: components exist ---
  describe("유효한 컴포넌트 존재", () => {
    it("produces no errors for existing agent component", async () => {
      touch(join(root, "agents", "oracle.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - oracle
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors).toHaveLength(0);
    });

    it("produces no errors for existing skills component", async () => {
      touch(join(root, "skills", "prometheus", "SKILL.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
skills:
  items:
    - prometheus
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors).toHaveLength(0);
    });

    it("correctly resolves SKILL.md directory-style skill via `validateSyncYamlComponents`", async () => {
      touch(join(root, "skills", "sisyphus-junior", "SKILL.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
skills:
  items:
    - sisyphus-junior
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- Missing components ---
  describe("존재하지 않는 컴포넌트", () => {
    it("returns error for missing agent component via `validateSyncYamlComponents`", async () => {
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - nonexistent-agent
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("nonexistent-agent"))).toBe(true);
    });

    it("returns error for missing skills component via `validateSyncYamlComponents`", async () => {
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
skills:
  items:
    - nonexistent-skill
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("returns error for missing rules component via `validateSyncYamlComponents`", async () => {
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
rules:
  items:
    - nonexistent-rule
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --- path not defined (template state) ---
  describe("path가 없는 경우 (템플릿)", () => {
    it("returns warning and no errors when path field is absent", async () => {
      const syncPath = writeYaml(root, "sync.yaml", `
agents:
  items:
    - oracle
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // --- CLI project file validation ---
  describe("CLI 프로젝트 파일 검증", () => {
    it("returns error when CLAUDE.md is absent via `validateSyncYamlComponents`", async () => {
      // Remove the CLAUDE.md created in makeRoot
      rmSync(join(root, "CLAUDE.md"));
      // Fixture has a real agent item (non-empty items) so validateCliProjectFiles is called
      touch(join(root, "agents", "oracle.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
platforms: [claude]
agents:
  items:
    - oracle
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("CLAUDE.md"))).toBe(true);
    });

    it("MCP-only 프로젝트(컴포넌트 없음)는 CLAUDE.md 부재 에러를 내지 않는다 via `validateSyncYamlComponents`", async () => {
      // Target dir exists but has no CLAUDE.md
      rmSync(join(root, "CLAUDE.md"));
      // sync.yaml has only name + path, zero component sections
      const syncPath = writeYaml(root, "sync.yaml", `
name: mcp-only-project
path: ${root}
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("CLAUDE.md"))).toBe(false);
    });

    it("produces no CLAUDE.md errors when CLAUDE.md exists", async () => {
      // CLAUDE.md already created in makeRoot
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
platforms: [claude]
agents:
  items: []
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      const claudeErrors = result.errors.filter((e) => e.includes("CLAUDE.md"));
      expect(claudeErrors).toHaveLength(0);
    });

    it("claude.yaml가 config/hooks만 있고 컴포넌트 항목이 없어도 .claude/로 배포하므로 CLAUDE.md를 요구한다 via `validateSyncYamlComponents`", async () => {
      // No component items, but claude.yaml has a non-mcps key (config) →
      // the project deploys into <path>/.claude/, so validateCliProjectFiles must RUN.
      rmSync(join(root, "CLAUDE.md"));
      writeYaml(root, "claude.yaml", `
config:
  permissions:
    allow:
      - "Bash(ls:*)"
`);
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("CLAUDE.md"))).toBe(true);
    });

    it("claude.yaml가 mcps만 있는 MCP-only 프로젝트는 CLAUDE.md를 요구하지 않는다 via `validateSyncYamlComponents`", async () => {
      // claude.yaml has ONLY mcps → MCP-only, writes to ~/.claude.json not
      // <path>/.claude/, so validateCliProjectFiles must be SKIPPED.
      rmSync(join(root, "CLAUDE.md"));
      writeYaml(root, "claude.yaml", `
mcps:
  notion:
    url: https://example.com/mcp
`);
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("CLAUDE.md"))).toBe(false);
    });
  });

  // --- scripts/rules section platform collection ---
  describe("scripts/rules 섹션 플랫폼 수집", () => {
    it("checks for GEMINI.md when scripts item has platforms: [gemini]", async () => {
      // GEMINI.md does NOT exist → error expected (proving gemini was collected)
      touch(join(root, "scripts", "my-script", "index.sh"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
scripts:
  items:
    - component: my-script
      platforms: [gemini]
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("GEMINI.md"))).toBe(true);
    });

    it("checks for GEMINI.md when rules item has platforms: [gemini]", async () => {
      touch(join(root, "rules", "my-rule.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
rules:
  items:
    - component: my-rule
      platforms: [gemini]
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("GEMINI.md"))).toBe(true);
    });
  });

  // --- checkHookDirectoryIndex: directory index validation ---
  describe("hook 디렉토리 index 파일 검증", () => {
    it("produces no errors when add-hooks directory contains index.sh", async () => {
      touch(join(root, "agents", "oracle.md"));
      touch(join(root, "hooks", "my-hook", "index.sh"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - component: oracle
      add-hooks:
        - component: my-hook
          event: UserPromptSubmit
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      const hookErrors = result.errors.filter((e) => e.includes("my-hook"));
      expect(hookErrors).toHaveLength(0);
    });

    it("returns error when add-hooks directory has no index file", async () => {
      touch(join(root, "agents", "oracle.md"));
      mkdirSync(join(root, "hooks", "empty-hook"), { recursive: true });
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - component: oracle
      add-hooks:
        - component: empty-hook
          event: UserPromptSubmit
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("empty-hook") && e.includes("index"))).toBe(true);
    });
  });

  // --- Component existence via object item format ---
  describe("object item 형식 컴포넌트 검증", () => {
    it("produces no errors for existing component in object item format", async () => {
      touch(join(root, "agents", "oracle.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - component: oracle
      platforms: [claude]
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.filter((e) => e.includes("oracle"))).toHaveLength(0);
    });

    it("returns error for missing component in object item format", async () => {
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - component: missing-agent
      platforms: [claude]
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("missing-agent"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: validatePlatformYamlHookComponents (P2-7 — sole owner)
// ---------------------------------------------------------------------------

describe("validatePlatformYamlHookComponents (P2-7)", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // --- Hook component exists ---
  describe("hook 컴포넌트 파일 존재", () => {
    it("produces no errors for existing hook component via `validatePlatformYamlHookComponents`", async () => {
      touch(join(root, "hooks", "keyword-detector.sh"));
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: keyword-detector.sh
      timeout: 10
`);
      const result = await validatePlatformYamlHookComponents(root, root);
      expect(result.errors).toHaveLength(0);
    });

    it("produces no errors for existing gemini hook component via `validatePlatformYamlHookComponents`", async () => {
      touch(join(root, "hooks", "session-start.sh"));
      writeYaml(root, "gemini.yaml", `
hooks:
  SessionStart:
    - component: session-start.sh
`);
      const result = await validatePlatformYamlHookComponents(root, root);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- P2-7: Hook component does NOT exist → fail ---
  describe("P2-7: hook 컴포넌트 파일 없음 → 에러", () => {
    it("returns error for missing hook component via `validatePlatformYamlHookComponents`", async () => {
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: nonexistent-hook.sh
      timeout: 10
`);
      const result = await validatePlatformYamlHookComponents(root, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("nonexistent-hook.sh"))).toBe(true);
    });

    it("returns error for missing gemini hook component via `validatePlatformYamlHookComponents`", async () => {
      writeYaml(root, "gemini.yaml", `
hooks:
  Stop:
    - component: missing-stop-hook.sh
`);
      const result = await validatePlatformYamlHookComponents(root, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("missing-stop-hook.sh"))).toBe(true);
    });
  });

  // --- codex: hook validation ---
  describe("codex hook 컴포넌트 검증", () => {
    it("returns error for missing hook component in codex.yaml via `validatePlatformYamlHookComponents`", async () => {
      writeYaml(root, "codex.yaml", `
hooks:
  UserPromptSubmit:
    - component: nonexistent.sh
`);
      const result = await validatePlatformYamlHookComponents(root, root);
      // codex is in the validated list alongside claude and gemini
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("nonexistent.sh"))).toBe(true);
    });
  });

  // --- platform YAML not present ---
  describe("platform YAML 파일 없음", () => {
    it("passes without errors when claude.yaml is absent", async () => {
      // No claude.yaml created
      const result = await validatePlatformYamlHookComponents(root, root);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- Scoped hook component ---
  describe("scoped hook 컴포넌트", () => {
    it("produces no errors for existing scoped hook component in project context", async () => {
      // Scoped refs are only valid in project context (yamlDir inside projects/).
      // This test places claude.yaml inside projects/myproject/ to use project context.
      // A-8 fix: root-context scoped refs are now rejected (see A-8 suite below).
      const projectDir = join(root, "projects", "myproject");
      mkdirSync(join(root, "projects", "myproject", "hooks"), { recursive: true });
      touch(join(root, "projects", "myproject", "hooks", "custom-hook.sh"));
      writeYaml(projectDir, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: myproject:custom-hook.sh
`);
      const result = await validatePlatformYamlHookComponents(projectDir, root);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error for missing scoped hook component", async () => {
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: myproject:nonexistent-hook.sh
`);
      const result = await validatePlatformYamlHookComponents(root, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("nonexistent-hook.sh"))).toBe(true);
    });

    it("returns null (error) for cross-project scoped ref from a project context", async () => {
      // yamlDir is inside projects/myproject — projectDirName = "myproject"
      // component references "otherproject:hook.sh" — cross-project, must be rejected
      const projectDir = join(root, "projects", "myproject");
      mkdirSync(join(root, "projects", "otherproject", "hooks"), { recursive: true });
      touch(join(root, "projects", "otherproject", "hooks", "hook.sh"));
      writeYaml(projectDir, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: otherproject:hook.sh
`);
      const result = await validatePlatformYamlHookComponents(projectDir, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("otherproject:hook.sh"))).toBe(true);
    });
  });

  // --- Resolution order: project-local before global ---
  describe("해석 순서: project-local이 global보다 우선", () => {
    it("prefers project-local hook over global hook when both exist", async () => {
      // Both hooks/shared.sh and projects/myproject/hooks/shared.sh exist.
      // With projectDirName = "myproject", the project-local one must be found (no error).
      const projectDir = join(root, "projects", "myproject");
      touch(join(root, "hooks", "shared.sh"));
      touch(join(root, "projects", "myproject", "hooks", "shared.sh"));
      writeYaml(projectDir, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: shared.sh
`);
      const result = await validatePlatformYamlHookComponents(projectDir, root);
      expect(result.errors).toHaveLength(0);
    });

    it("falls back to global hook when only global exists", async () => {
      const projectDir = join(root, "projects", "myproject");
      mkdirSync(join(root, "projects", "myproject", "hooks"), { recursive: true });
      touch(join(root, "hooks", "global-only.sh"));
      writeYaml(projectDir, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: global-only.sh
`);
      const result = await validatePlatformYamlHookComponents(projectDir, root);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- Multiple hooks, one missing ---
  describe("여러 hook 중 하나가 없는 경우", () => {
    it("returns only the error for the missing hook when one of two hooks is absent", async () => {
      touch(join(root, "hooks", "existing-hook.sh"));
      // nonexistent-hook.sh is NOT created
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: existing-hook.sh
    - component: nonexistent-hook.sh
`);
      const result = await validatePlatformYamlHookComponents(root, root);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("nonexistent-hook.sh");
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: overlay-aware 로더 통합 테스트 (*.local.yaml)
// ---------------------------------------------------------------------------

describe("overlay-aware 통합: sync.local.yaml 컴포넌트 누락 catch", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("sync.local.yaml YAML 파싱 오류 메시지에 sync.local.yaml 포함", async () => {
    writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items: []
`);
    writeYaml(root, "sync.local.yaml", `
agents:
  items: [invalid: yaml: parse: error
`);

    const result = await validateSyncYamlComponents(join(root, "sync.yaml"), root);
    expect(result.errors.some((e) => e.includes("sync.local.yaml"))).toBe(true);
  });

  it("sync.local.yaml에 추가된 agent 파일이 없으면 error를 반환한다", async () => {
    // base: agent A 존재
    touch(join(root, "agents", "agent-a.md"));
    writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - agent-a
`);
    // local: agent B 추가 (파일 없음)
    writeYaml(root, "sync.local.yaml", `
agents:
  items:
    - agent-b
`);

    const result = await validateSyncYamlComponents(join(root, "sync.yaml"), root);
    expect(result.errors.some((e) => e.includes("agent-b"))).toBe(true);
  });

  it("sync.local.yaml에 추가된 agent가 파일도 존재하면 error 없음", async () => {
    touch(join(root, "agents", "agent-a.md"));
    touch(join(root, "agents", "agent-b.md"));
    writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - agent-a
`);
    writeYaml(root, "sync.local.yaml", `
agents:
  items:
    - agent-b
`);

    const result = await validateSyncYamlComponents(join(root, "sync.yaml"), root);
    const agentErrors = result.errors.filter((e) => e.includes("agent-b"));
    expect(agentErrors).toHaveLength(0);
  });

  it("sync.local.yaml 없이 base만 있을 때 기존 동작 유지 (회귀)", async () => {
    touch(join(root, "agents", "oracle.md"));
    writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - oracle
`);

    const result = await validateSyncYamlComponents(join(root, "sync.yaml"), root);
    expect(result.errors).toHaveLength(0);
  });
});

describe("overlay-aware 통합: claude.local.yaml hook 컴포넌트 누락 catch", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("claude.local.yaml YAML 파싱 오류 메시지에 claude.local.yaml 포함", async () => {
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit: []
`);
    writeYaml(root, "claude.local.yaml", `
hooks:
  UserPromptSubmit: [invalid: yaml: parse: error
`);

    const result = await validatePlatformYamlHookComponents(root, root);
    expect(result.errors.some((e) => e.includes("claude.local.yaml"))).toBe(true);
  });

  it("claude.local.yaml에 추가된 hook 파일이 없으면 error를 반환한다", async () => {
    // base: hook X 존재
    touch(join(root, "hooks", "hook-x.sh"));
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: hook-x.sh
`);
    // local: hook Y 추가 (파일 없음)
    writeYaml(root, "claude.local.yaml", `
hooks:
  UserPromptSubmit:
    - component: hook-y.sh
`);

    const result = await validatePlatformYamlHookComponents(root, root);
    expect(result.errors.some((e) => e.includes("hook-y.sh"))).toBe(true);
  });

  it("claude.local.yaml에 추가된 hook이 파일도 존재하면 error 없음", async () => {
    touch(join(root, "hooks", "hook-x.sh"));
    touch(join(root, "hooks", "hook-y.sh"));
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: hook-x.sh
`);
    writeYaml(root, "claude.local.yaml", `
hooks:
  UserPromptSubmit:
    - component: hook-y.sh
`);

    const result = await validatePlatformYamlHookComponents(root, root);
    expect(result.errors).toHaveLength(0);
  });

  it("claude.local.yaml 없이 base만 있을 때 기존 동작 유지 (회귀)", async () => {
    touch(join(root, "hooks", "keyword-detector.sh"));
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: keyword-detector.sh
`);

    const result = await validatePlatformYamlHookComponents(root, root);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: A-8 — root-context scoped hook ref는 resolver와 대칭으로 거부된다
// ---------------------------------------------------------------------------

describe("A-8: root-context per-platform YAML scoped hook ref 거부", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("root-context claude.yaml에서 scoped hook ref는 에러를 반환한다", async () => {
    // File exists in the project scope, but root-context cannot reference scoped hooks.
    mkdirSync(join(root, "projects", "myproject", "hooks"), { recursive: true });
    touch(join(root, "projects", "myproject", "hooks", "hook.sh"));
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: myproject:hook.sh
`);
    // yamlDir is root (not inside projects/), so projectDirName should be ""
    const result = await validatePlatformYamlHookComponents(root, root);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("myproject:hook.sh"))).toBe(true);
  });

  it("root-context codex.yaml에서 scoped hook ref는 에러를 반환한다", async () => {
    mkdirSync(join(root, "projects", "myproject", "hooks"), { recursive: true });
    touch(join(root, "projects", "myproject", "hooks", "hook.sh"));
    writeYaml(root, "codex.yaml", `
hooks:
  UserPromptSubmit:
    - component: myproject:hook.sh
`);
    const result = await validatePlatformYamlHookComponents(root, root);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("myproject:hook.sh"))).toBe(true);
  });

  it("project-context에서 동일 project scoped ref는 여전히 통과한다 (회귀)", async () => {
    // projects/myproject/claude.yaml references myproject:hook.sh — allowed
    const projectDir = join(root, "projects", "myproject");
    mkdirSync(join(root, "projects", "myproject", "hooks"), { recursive: true });
    touch(join(root, "projects", "myproject", "hooks", "hook.sh"));
    writeYaml(projectDir, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: myproject:hook.sh
`);
    const result = await validatePlatformYamlHookComponents(projectDir, root);
    expect(result.errors).toHaveLength(0);
  });

  it("root-context unscoped hook ref는 여전히 통과한다 (회귀)", async () => {
    touch(join(root, "hooks", "global-hook.sh"));
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: global-hook.sh
`);
    const result = await validatePlatformYamlHookComponents(root, root);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: validateAll — enabled-projects 화이트리스트
// ---------------------------------------------------------------------------

describe("validateAll — enabled-projects 화이트리스트", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("`enabledProjects`에 포함되지 않은 projects/* 항목은 검증 대상에서 제외", async () => {
    // proj-a는 활성, proj-b는 비활성. 둘 다 존재하지 않는 target path를 갖도록 만들어
    // 검증되면 CLAUDE.md 누락 에러가 나게 함.
    writeYaml(join(root, "projects", "proj-a"), "sync.yaml", `path: ${root}\n`);
    writeYaml(join(root, "projects", "proj-b"), "sync.yaml", `path: /nonexistent/proj-b\n`);
    writeYaml(root, "sync.yaml", `path: ${root}\n`);

    const result = await validateAll(root, ["proj-a"]);

    expect(result.errors.some((e) => e.includes("/nonexistent/proj-b"))).toBe(false);
  });

  it("`enabledProjects`로 활성화된 프로젝트는 정상 검증된다", async () => {
    // proj-a 활성: target path가 존재하지 않으면 CLAUDE.md 에러가 나야 함
    // agents 섹션에 항목이 있어야 validateCliProjectFiles가 호출된다
    writeYaml(join(root, "projects", "proj-a"), "sync.yaml",
      `path: /nonexistent/proj-a\nagents:\n  items:\n    - oracle\n`);
    writeYaml(root, "sync.yaml", `path: ${root}\n`);

    const result = await validateAll(root, ["proj-a"]);

    expect(result.errors.some((e) => e.includes("/nonexistent/proj-a"))).toBe(true);
  });

  it("루트 sync.yaml은 `enabledProjects` 필터와 무관하게 항상 검증된다", async () => {
    // 루트 sync.yaml만 있고 enabledProjects는 비어있는 sentinel — 루트는 그래도 처리되어야 함
    // agents 섹션에 항목이 있어야 validateCliProjectFiles가 호출된다
    writeYaml(root, "sync.yaml",
      `path: /nonexistent/root-target\nagents:\n  items:\n    - oracle\n`);

    const result = await validateAll(root, ["__none__"]);

    expect(result.errors.some((e) => e.includes("/nonexistent/root-target"))).toBe(true);
  });

  it("`enabledProjects` 미지정 시 모든 프로젝트 검증 (기존 동작 회귀)", async () => {
    // agents 섹션에 항목이 있어야 validateCliProjectFiles가 호출된다
    writeYaml(join(root, "projects", "proj-a"), "sync.yaml",
      `path: /nonexistent/proj-a\nagents:\n  items:\n    - oracle\n`);
    writeYaml(join(root, "projects", "proj-b"), "sync.yaml",
      `path: /nonexistent/proj-b\nagents:\n  items:\n    - oracle\n`);
    writeYaml(root, "sync.yaml", `path: ${root}\n`);

    const result = await validateAll(root, []);

    expect(result.errors.some((e) => e.includes("/nonexistent/proj-a"))).toBe(true);
    expect(result.errors.some((e) => e.includes("/nonexistent/proj-b"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: V7 — claude.yaml 파싱 오류 가드
// ---------------------------------------------------------------------------

describe("V7: claude.yaml 파싱 오류 가드", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("malformed claude.yaml 시 크래시 대신 구조화된 YAML 파싱 오류를 result.errors에 반환한다 via `validateSyncYamlComponents`", async () => {
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit: [invalid: yaml: parse: error
`);
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items: []
`);

    const result = await validateSyncYamlComponents(syncPath, root);
    expect(result.errors.some((e) => e.includes("YAML 파싱 오류"))).toBe(true);
    expect(result.errors.some((e) => e.includes("claude.yaml"))).toBe(true);
  });

  it("malformed claude.local.yaml 시 크래시 대신 구조화된 YAML 파싱 오류를 result.errors에 반환한다 via `validateSyncYamlComponents`", async () => {
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit: []
`);
    writeYaml(root, "claude.local.yaml", `
hooks:
  UserPromptSubmit: [invalid: yaml: parse: error
`);
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items: []
`);

    const result = await validateSyncYamlComponents(syncPath, root);
    expect(result.errors.some((e) => e.includes("YAML 파싱 오류"))).toBe(true);
    expect(result.errors.some((e) => e.includes("claude.yaml"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: AC4.1 — bare-structure fan-out (resolveDeployTargets integration)
// ---------------------------------------------------------------------------

describe("AC4.1 — bare-structure worktree fan-out for CLAUDE.md check", () => {
  let root: string;
  let tmpdirs: string[];

  beforeEach(() => {
    root = makeRoot();
    tmpdirs = [root];
  });

  afterEach(() => {
    for (const d of tmpdirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it("bare-structure path with one worktree missing CLAUDE.md flags that worktree with an error", async () => {
    // Layout: container/.bare (bare repo) + container/wt (worktree, no CLAUDE.md)
    const container = join(root, "target");
    mkdirSync(container, { recursive: true });
    tmpdirs.push(container);

    const bareDir = join(container, ".bare");
    const wtDir = join(container, "wt");
    mkdirSync(wtDir, { recursive: true });

    execFileSync("git", ["init", "--bare", bareDir], { stdio: "pipe" });
    seedBareRepo(bareDir);
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", wtDir], {
      stdio: "pipe",
      env: GIT_ENV,
    });

    // wt has NO CLAUDE.md
    touch(join(root, "agents", "oracle.md"));
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${container}
agents:
  items:
    - oracle
`);

    const result = await validateSyncYamlComponents(syncPath, root);

    // Must flag the worktree path in the error message
    expect(result.errors.some((e) => e.includes("CLAUDE.md"))).toBe(true);
    expect(result.errors.some((e) => e.includes(wtDir))).toBe(true);
  });

  it("bare-structure with CLAUDE.md in each worktree produces no CLAUDE.md errors", async () => {
    const container = join(root, "target");
    mkdirSync(container, { recursive: true });
    tmpdirs.push(container);

    const bareDir = join(container, ".bare");
    const wt1 = join(container, "wt1");
    const wt2 = join(container, "wt2");
    mkdirSync(wt1, { recursive: true });
    mkdirSync(wt2, { recursive: true });

    execFileSync("git", ["init", "--bare", bareDir], { stdio: "pipe" });
    seedBareRepo(bareDir);
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", wt1], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", "-b", "wt2-branch", wt2], {
      stdio: "pipe",
      env: GIT_ENV,
    });

    // Both worktrees have CLAUDE.md
    touch(join(wt1, "CLAUDE.md"));
    touch(join(wt2, "CLAUDE.md"));

    touch(join(root, "agents", "oracle.md"));
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${container}
agents:
  items:
    - oracle
`);

    const result = await validateSyncYamlComponents(syncPath, root);
    const claudeErrors = result.errors.filter((e) => e.includes("CLAUDE.md"));
    expect(claudeErrors).toHaveLength(0);
  });

  it("source-component check runs ONCE regardless of worktree count (no double-error for bare with 2 worktrees)", async () => {
    // A bare-structure path with 2 worktrees + a missing source component.
    // The missing-component error must appear exactly ONCE (component resolution
    // is OMT-root-relative and must not fan out per worktree).
    const container = join(root, "target");
    mkdirSync(container, { recursive: true });
    tmpdirs.push(container);

    const bareDir = join(container, ".bare");
    const wt1 = join(container, "wt1");
    const wt2 = join(container, "wt2");
    mkdirSync(wt1, { recursive: true });
    mkdirSync(wt2, { recursive: true });

    execFileSync("git", ["init", "--bare", bareDir], { stdio: "pipe" });
    seedBareRepo(bareDir);
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", wt1], {
      stdio: "pipe",
      env: GIT_ENV,
    });
    execFileSync("git", ["--git-dir", bareDir, "worktree", "add", "-b", "wt2-branch", wt2], {
      stdio: "pipe",
      env: GIT_ENV,
    });

    // Both worktrees have CLAUDE.md (so no CLAUDE.md errors pollute the count)
    touch(join(wt1, "CLAUDE.md"));
    touch(join(wt2, "CLAUDE.md"));

    // missing-agent does NOT exist in the OMT root
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${container}
agents:
  items:
    - missing-agent
`);

    const result = await validateSyncYamlComponents(syncPath, root);

    const missingErrors = result.errors.filter((e) => e.includes("missing-agent"));
    // Source-component check must be single-pass: exactly 1 error, not 2
    expect(missingErrors).toHaveLength(1);
  });

  it("resolver failure (bare path with zero real worktrees) lands in result.errors, not a throw", async () => {
    // A bare-structure path with no worktrees at all → resolveDeployTargets throws
    // DeployTargetsError → must be caught and pushed into result.errors.
    const container = join(root, "target");
    mkdirSync(container, { recursive: true });
    tmpdirs.push(container);

    const bareDir = join(container, ".bare");
    execFileSync("git", ["init", "--bare", bareDir], { stdio: "pipe" });
    // Intentionally NOT seeding / adding any worktrees — zero worktrees → DeployTargetsError

    touch(join(root, "agents", "oracle.md"));
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${container}
agents:
  items:
    - oracle
`);

    // Must NOT throw — resolver failure must be swallowed into result.errors.
    // A rejected promise would cause this test to fail, so no separate
    // not.toThrow() guard is needed.
    const result = await validateSyncYamlComponents(syncPath, root);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Suite: V7b — claude.yaml는 sync.yaml당 1회만 파싱된다 (이중 파싱 금지)
// ---------------------------------------------------------------------------

describe("V7b: claude.yaml 이중 파싱 금지 — validateAll이 단일 오류만 생성해야 한다", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("malformed claude.yaml 시 validateAll이 YAML 파싱 오류를 정확히 1건만 반환한다", async () => {
    // Both validateSyncYamlComponents and validatePlatformYamlHookComponents
    // parse claude.yaml. With dual-parse, a broken claude.yaml produces 2 errors.
    // After dedup, it must produce exactly 1.
    writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit: [invalid: yaml: parse: error
`);
    writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items: []
`);

    const result = await validateAll(root, []);

    const parseErrors = result.errors.filter((e) => e.includes("YAML 파싱 오류") && e.includes("claude.yaml"));
    expect(parseErrors).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: C1 — deploy-target resolution is unconditional (validate/sync parity)
// ---------------------------------------------------------------------------

describe("C1: 배포 대상 해소는 무조건 시도되어 sync.ts와 정렬된다", () => {
  let root: string;
  let tmpdirs: string[];

  beforeEach(() => {
    root = makeRoot();
    tmpdirs = [root];
  });

  afterEach(() => {
    for (const d of tmpdirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it("MCP-only 프로젝트(컴포넌트·non-mcps 키 없음)도 깨진 bare 컨테이너의 해소 실패를 result.errors에 보고한다 via `validateSyncYamlComponents`", async () => {
    // sync.ts calls resolveDeployTargets(targetPath) UNCONDITIONALLY and aborts on
    // DeployTargetsError. The validator must do the same: even for an MCP-only
    // project (deploysToClaudeDotDir=false), a broken bare container (zero
    // worktrees) must surface as a result.errors entry — so `make validate`
    // catches it BEFORE `make sync` aborts.
    const container = join(root, "target");
    mkdirSync(container, { recursive: true });
    tmpdirs.push(container);

    const bareDir = join(container, ".bare");
    execFileSync("git", ["init", "--bare", bareDir], { stdio: "pipe" });
    // Intentionally NOT seeding / adding any worktrees → zero worktrees → DeployTargetsError

    // MCP-only: claude.yaml has ONLY mcps, sync.yaml has no component sections.
    writeYaml(root, "claude.yaml", `
mcps:
  notion:
    url: https://example.com/mcp
`);
    const syncPath = writeYaml(root, "sync.yaml", `
name: mcp-only-project
path: ${container}
`);

    const result = await validateSyncYamlComponents(syncPath, root);

    expect(result.errors.some((e) => e.includes("배포 대상 확인 실패"))).toBe(true);
    expect(result.errors.some((e) => e.includes(container))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: C2 — CLI context file check is platform-aware (non-Claude regression)
// ---------------------------------------------------------------------------

describe("C2: 비-Claude config/mcp-only 프로젝트도 자기 플랫폼 CLI 파일을 검사받는다", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("platforms: [codex] + 컴포넌트 없음 + AGENTS.md 없음이면 에러를 보고한다 via `validateSyncYamlComponents`", async () => {
    // deploysToClaudeDotDir is a Claude-only predicate → false here. The base
    // behavior ran validateCliProjectFiles unconditionally, so a codex-only
    // project missing AGENTS.md failed. The gate must not swallow non-Claude
    // platforms.
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
platforms: [codex]
`);

    const result = await validateSyncYamlComponents(syncPath, root);
    expect(result.errors.some((e) => e.includes("AGENTS.md"))).toBe(true);
  });

  it("platforms: [gemini] + 컴포넌트 없음 + GEMINI.md 없음이면 에러를 보고한다 via `validateSyncYamlComponents`", async () => {
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
platforms: [gemini]
`);

    const result = await validateSyncYamlComponents(syncPath, root);
    expect(result.errors.some((e) => e.includes("GEMINI.md"))).toBe(true);
  });

  it("platforms: [codex] + AGENTS.md 존재면 에러 없음 via `validateSyncYamlComponents`", async () => {
    touch(join(root, "AGENTS.md"));
    const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
platforms: [codex]
`);

    const result = await validateSyncYamlComponents(syncPath, root);
    expect(result.errors.some((e) => e.includes("AGENTS.md"))).toBe(false);
  });
});
