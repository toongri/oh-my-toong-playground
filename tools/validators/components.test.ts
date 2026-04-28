import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  validateSyncYamlComponents,
  validatePlatformYamlHookComponents,
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
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
platforms: [claude]
agents:
  items: []
`);
      const result = await validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("CLAUDE.md"))).toBe(true);
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

  // --- codex/opencode: no hook validation ---
  describe("codex/opencode는 hook 검증 대상이 아니다", () => {
    it("does not validate hook components in codex.yaml via `validatePlatformYamlHookComponents`", async () => {
      writeYaml(root, "codex.yaml", `
hooks:
  UserPromptSubmit:
    - component: nonexistent.sh
`);
      const result = await validatePlatformYamlHookComponents(root, root);
      // codex is not in the validated list (claude and gemini only)
      expect(result.errors).toHaveLength(0);
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
    it("produces no errors for existing scoped hook component", async () => {
      mkdirSync(join(root, "projects", "myproject", "hooks"), { recursive: true });
      touch(join(root, "projects", "myproject", "hooks", "custom-hook.sh"));
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: myproject:custom-hook.sh
`);
      const result = await validatePlatformYamlHookComponents(root, root);
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
