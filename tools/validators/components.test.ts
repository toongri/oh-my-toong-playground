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
    it("실제로 존재하는 agent 컴포넌트는 에러가 없다", () => {
      touch(join(root, "agents", "oracle.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - oracle
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors).toHaveLength(0);
    });

    it("실제로 존재하는 skills 컴포넌트는 에러가 없다", () => {
      touch(join(root, "skills", "prometheus", "SKILL.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
skills:
  items:
    - prometheus
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors).toHaveLength(0);
    });

    it("SKILL.md 폴더 형태의 skill을 올바르게 해석한다", () => {
      touch(join(root, "skills", "sisyphus-junior", "SKILL.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
skills:
  items:
    - sisyphus-junior
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- Missing components ---
  describe("존재하지 않는 컴포넌트", () => {
    it("존재하지 않는 agent 컴포넌트는 에러를 반환한다", () => {
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - nonexistent-agent
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("nonexistent-agent"))).toBe(true);
    });

    it("존재하지 않는 skills 컴포넌트는 에러를 반환한다", () => {
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
skills:
  items:
    - nonexistent-skill
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("존재하지 않는 rules 컴포넌트는 에러를 반환한다", () => {
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
rules:
  items:
    - nonexistent-rule
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --- path not defined (template state) ---
  describe("path가 없는 경우 (템플릿)", () => {
    it("path가 없으면 경고를 반환하고 에러는 없다", () => {
      const syncPath = writeYaml(root, "sync.yaml", `
agents:
  items:
    - oracle
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // --- CLI project file validation ---
  describe("CLI 프로젝트 파일 검증", () => {
    it("CLAUDE.md가 없으면 에러를 반환한다", () => {
      // Remove the CLAUDE.md created in makeRoot
      rmSync(join(root, "CLAUDE.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
platforms: [claude]
agents:
  items: []
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("CLAUDE.md"))).toBe(true);
    });

    it("CLAUDE.md가 있으면 에러가 없다", () => {
      // CLAUDE.md already created in makeRoot
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
platforms: [claude]
agents:
  items: []
`);
      const result = validateSyncYamlComponents(syncPath, root);
      const claudeErrors = result.errors.filter((e) => e.includes("CLAUDE.md"));
      expect(claudeErrors).toHaveLength(0);
    });
  });

  // --- scripts/rules section platform collection ---
  describe("scripts/rules 섹션 플랫폼 수집", () => {
    it("scripts 섹션 item에 platforms: [gemini]가 있으면 GEMINI.md 존재를 검사한다", () => {
      // GEMINI.md does NOT exist → error expected (proving gemini was collected)
      touch(join(root, "scripts", "my-script", "index.sh"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
scripts:
  items:
    - component: my-script
      platforms: [gemini]
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("GEMINI.md"))).toBe(true);
    });

    it("rules 섹션 item에 platforms: [gemini]가 있으면 GEMINI.md 존재를 검사한다", () => {
      touch(join(root, "rules", "my-rule.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
rules:
  items:
    - component: my-rule
      platforms: [gemini]
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors.some((e) => e.includes("GEMINI.md"))).toBe(true);
    });
  });

  // --- Component existence via object item format ---
  describe("object item 형식 컴포넌트 검증", () => {
    it("object 형식 item에서 존재하는 컴포넌트는 에러가 없다", () => {
      touch(join(root, "agents", "oracle.md"));
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - component: oracle
      platforms: [claude]
`);
      const result = validateSyncYamlComponents(syncPath, root);
      expect(result.errors.filter((e) => e.includes("oracle"))).toHaveLength(0);
    });

    it("object 형식 item에서 존재하지 않는 컴포넌트는 에러를 반환한다", () => {
      const syncPath = writeYaml(root, "sync.yaml", `
path: ${root}
agents:
  items:
    - component: missing-agent
      platforms: [claude]
`);
      const result = validateSyncYamlComponents(syncPath, root);
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
    it("존재하는 hook 컴포넌트는 에러가 없다", () => {
      touch(join(root, "hooks", "keyword-detector.sh"));
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: keyword-detector.sh
      timeout: 10
`);
      const result = validatePlatformYamlHookComponents(root, root);
      expect(result.errors).toHaveLength(0);
    });

    it("존재하는 gemini hook 컴포넌트는 에러가 없다", () => {
      touch(join(root, "hooks", "session-start.sh"));
      writeYaml(root, "gemini.yaml", `
hooks:
  SessionStart:
    - component: session-start.sh
`);
      const result = validatePlatformYamlHookComponents(root, root);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- P2-7: Hook component does NOT exist → fail ---
  describe("P2-7: hook 컴포넌트 파일 없음 → 에러", () => {
    it("존재하지 않는 hook 컴포넌트는 에러를 반환한다", () => {
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: nonexistent-hook.sh
      timeout: 10
`);
      const result = validatePlatformYamlHookComponents(root, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("nonexistent-hook.sh"))).toBe(true);
    });

    it("존재하지 않는 gemini hook 컴포넌트도 에러를 반환한다", () => {
      writeYaml(root, "gemini.yaml", `
hooks:
  Stop:
    - component: missing-stop-hook.sh
`);
      const result = validatePlatformYamlHookComponents(root, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("missing-stop-hook.sh"))).toBe(true);
    });
  });

  // --- codex/opencode: no hook validation ---
  describe("codex/opencode는 hook 검증 대상이 아니다", () => {
    it("codex.yaml에 hooks가 있어도 컴포넌트 존재를 검사하지 않는다", () => {
      writeYaml(root, "codex.yaml", `
hooks:
  UserPromptSubmit:
    - component: nonexistent.sh
`);
      const result = validatePlatformYamlHookComponents(root, root);
      // codex is not in the validated list (claude and gemini only)
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- platform YAML not present ---
  describe("platform YAML 파일 없음", () => {
    it("claude.yaml이 없으면 에러 없이 통과한다", () => {
      // No claude.yaml created
      const result = validatePlatformYamlHookComponents(root, root);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- Scoped hook component ---
  describe("scoped hook 컴포넌트", () => {
    it("존재하는 scoped hook 컴포넌트는 에러가 없다", () => {
      mkdirSync(join(root, "projects", "myproject", "hooks"), { recursive: true });
      touch(join(root, "projects", "myproject", "hooks", "custom-hook.sh"));
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: myproject:custom-hook.sh
`);
      const result = validatePlatformYamlHookComponents(root, root);
      expect(result.errors).toHaveLength(0);
    });

    it("존재하지 않는 scoped hook 컴포넌트는 에러를 반환한다", () => {
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: myproject:nonexistent-hook.sh
`);
      const result = validatePlatformYamlHookComponents(root, root);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("nonexistent-hook.sh"))).toBe(true);
    });
  });

  // --- Multiple hooks, one missing ---
  describe("여러 hook 중 하나가 없는 경우", () => {
    it("두 hook 중 하나가 없으면 해당 에러만 반환한다", () => {
      touch(join(root, "hooks", "existing-hook.sh"));
      // nonexistent-hook.sh is NOT created
      writeYaml(root, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: existing-hook.sh
    - component: nonexistent-hook.sh
`);
      const result = validatePlatformYamlHookComponents(root, root);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("nonexistent-hook.sh");
    });
  });
});
