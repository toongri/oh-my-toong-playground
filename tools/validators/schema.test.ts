import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { validateSyncYaml, validatePlatformYaml } from "./schema.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeYaml(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

// ---------------------------------------------------------------------------
// Suite: validateSyncYaml
// ---------------------------------------------------------------------------

describe("validateSyncYaml", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // --- P2-3: Deprecated sections ---
  describe("P2-3: deprecated 섹션 감지", () => {
    it("config 섹션이 있으면 ERROR를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
config:
  claude:
    model: claude-opus
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      const msg = result.errors.find((e) => e.includes("config"));
      expect(msg).toBeDefined();
      expect(msg).toContain("per-platform YAML");
    });

    it("hooks 섹션이 있으면 ERROR를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
hooks:
  items:
    - component: keyword-detector.sh
      event: UserPromptSubmit
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      const msg = result.errors.find((e) => e.includes("hooks"));
      expect(msg).toBeDefined();
      expect(msg).toContain("per-platform YAML");
    });

    it("mcps 섹션이 있으면 ERROR를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
mcps:
  items:
    - component: some-mcp
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      const msg = result.errors.find((e) => e.includes("mcps"));
      expect(msg).toBeDefined();
      expect(msg).toContain("per-platform YAML");
    });

    it("plugins 섹션이 있으면 ERROR를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
plugins:
  items:
    - name: some-plugin
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      const msg = result.errors.find((e) => e.includes("plugins"));
      expect(msg).toBeDefined();
      expect(msg).toContain("per-platform YAML");
    });

    it("deprecated 섹션 없는 sync.yaml은 해당 에러가 없다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items:
    - oracle
`);
      const result = validateSyncYaml(path);
      const deprecatedErrors = result.errors.filter((e) => e.includes("per-platform YAML"));
      expect(deprecatedErrors).toHaveLength(0);
    });
  });

  // --- YAML syntax error ---
  describe("YAML 문법 오류", () => {
    it("잘못된 YAML이면 에러를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items:
  - invalid: [unclosed
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --- Valid sync.yaml ---
  describe("유효한 sync.yaml", () => {
    it("허용된 섹션만 있는 경우 에러가 없다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
platforms: [claude, gemini]
agents:
  items:
    - oracle
skills:
  items:
    - prometheus
rules:
  items:
    - some-rule
`);
      const result = validateSyncYaml(path);
      expect(result.errors).toHaveLength(0);
    });

    it("object item 형식이 올바르면 에러가 없다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items:
    - component: sisyphus-junior
      platforms: [claude]
`);
      const result = validateSyncYaml(path);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- Platform values ---
  describe("플랫폼 값 검증", () => {
    it("잘못된 플랫폼 값이 있으면 에러를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
platforms: [claude, invalid-platform]
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("invalid-platform"))).toBe(true);
    });

    it("지원되는 플랫폼 값은 에러가 없다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
platforms: [claude, gemini, codex, opencode]
`);
      const result = validateSyncYaml(path);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- Unknown top-level fields ---
  describe("알 수 없는 최상위 필드", () => {
    it("알 수 없는 최상위 필드가 있으면 에러를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
unknown-field: value
`);
      const result = validateSyncYaml(path);
      expect(result.errors.some((e) => e.includes("unknown-field"))).toBe(true);
    });
  });

  // --- Old array format ---
  describe("기존 배열 형식 거부", () => {
    it("섹션이 배열이면 에러를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  - oracle
`);
      const result = validateSyncYaml(path);
      expect(result.errors.some((e) => e.includes("배열 형식"))).toBe(true);
    });
  });

  // --- Item platform validation ---
  describe("item 플랫폼 값 검증", () => {
    it("item.platforms에 잘못된 값이 있으면 에러를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items:
    - component: oracle
      platforms: [bad-platform]
`);
      const result = validateSyncYaml(path);
      expect(result.errors.some((e) => e.includes("bad-platform"))).toBe(true);
    });
  });

  // --- Non-object section data ---
  describe("섹션 데이터가 object가 아닌 경우", () => {
    it("agents 섹션이 string이면 에러를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents: "bad-type"
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("agents") && e.includes("object 형식"))).toBe(true);
    });
  });

  // --- Object item missing component field ---
  describe("object item에 component 필드가 없는 경우", () => {
    it("component 필드가 없는 object item은 에러를 반환한다", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items:
    - add-skills: [oracle]
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("component 필드가 필요합니다"))).toBe(true);
    });
  });

  // --- P2-7: No hook component file checks ---
  describe("P2-7: schema.ts는 hook 파일 존재를 검사하지 않는다", () => {
    it("hooks가 없는 sync.yaml (hooks는 deprecated이므로 — 구조 오류만 감지)", () => {
      // This confirms schema doesn't do hook existence checks.
      // Since hooks is deprecated in sync.yaml (P2-3), any hooks in sync.yaml triggers
      // the deprecated error, not a file existence error.
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items:
    - oracle
`);
      const result = validateSyncYaml(path);
      // No file existence errors (there would be if schema.ts checked files)
      const fileErrors = result.errors.filter((e) => e.includes("파일 없음") || e.includes("not found"));
      expect(fileErrors).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: validatePlatformYaml
// ---------------------------------------------------------------------------

describe("validatePlatformYaml", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // --- Unknown section → warning ---
  describe("알 수 없는 섹션 경고", () => {
    it("claude.yaml에 알 수 없는 섹션이 있으면 WARNING을 반환한다", () => {
      const path = writeYaml(dir, "claude.yaml", `
config:
  model: claude-opus
unknown-section: value
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("unknown-section"))).toBe(true);
    });

    it("gemini.yaml에 알 수 없는 섹션이 있으면 WARNING을 반환한다", () => {
      const path = writeYaml(dir, "gemini.yaml", `
config:
  model: gemini-pro
plugins:
  items: []
`);
      const result = validatePlatformYaml(path, "gemini");
      expect(result.warnings.some((w) => w.includes("plugins"))).toBe(true);
    });

    it("codex.yaml에 hooks 섹션이 있으면 WARNING을 반환한다", () => {
      const path = writeYaml(dir, "codex.yaml", `
config:
  model: o3
hooks:
  UserPromptSubmit: []
`);
      const result = validatePlatformYaml(path, "codex");
      expect(result.warnings.some((w) => w.includes("hooks"))).toBe(true);
    });
  });

  // --- Valid per-platform YAML ---
  describe("유효한 per-platform YAML", () => {
    it("claude.yaml에 허용된 섹션만 있으면 에러/경고가 없다", () => {
      const path = writeYaml(dir, "claude.yaml", `
config:
  model: claude-opus
hooks:
  UserPromptSubmit: []
mcps:
  some-mcp:
    command: npx
statusLine: "test"
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("gemini.yaml에 허용된 섹션만 있으면 에러/경고가 없다", () => {
      const path = writeYaml(dir, "gemini.yaml", `
config:
  model: gemini-pro
mcps:
  some-mcp: {}
`);
      const result = validatePlatformYaml(path, "gemini");
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("codex.yaml에 허용된 섹션만 있으면 에러/경고가 없다", () => {
      const path = writeYaml(dir, "codex.yaml", `
config:
  model: o3
model-map:
  claude: o3
`);
      const result = validatePlatformYaml(path, "codex");
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("opencode.yaml에 허용된 섹션만 있으면 에러/경고가 없다", () => {
      const path = writeYaml(dir, "opencode.yaml", `
config:
  model: anthropic/claude-opus-4-5
model-map:
  claude: anthropic/claude-opus-4-5
`);
      const result = validatePlatformYaml(path, "opencode");
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // --- hooks event name validation ---
  describe("hooks 이벤트 이름 검증", () => {
    it("잘못된 이벤트 이름이 있으면 ERROR를 반환한다", () => {
      const path = writeYaml(dir, "claude.yaml", `
hooks:
  InvalidEvent:
    - component: some-hook.sh
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("InvalidEvent"))).toBe(true);
    });

    it("이벤트 값이 배열이 아니면 ERROR를 반환한다", () => {
      const path = writeYaml(dir, "claude.yaml", `
hooks:
  UserPromptSubmit: "not-an-array"
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("UserPromptSubmit") && e.includes("배열"))).toBe(true);
    });

    it("유효한 이벤트 이름과 배열 값은 에러가 없다", () => {
      const path = writeYaml(dir, "claude.yaml", `
hooks:
  UserPromptSubmit:
    - component: some-hook.sh
  Stop:
    - component: another-hook.sh
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- mcps structure validation ---
  describe("mcps 구조 검증", () => {
    it("mcps 값이 object가 아니면 ERROR를 반환한다", () => {
      const path = writeYaml(dir, "claude.yaml", `
mcps:
  some-mcp: "not-an-object"
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("some-mcp") && e.includes("object"))).toBe(true);
    });

    it("mcps 값이 object이면 에러가 없다", () => {
      const path = writeYaml(dir, "claude.yaml", `
mcps:
  some-mcp:
    command: npx
    args: [some-package]
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- YAML syntax error ---
  describe("YAML 문법 오류", () => {
    it("잘못된 YAML이면 에러를 반환한다", () => {
      const path = writeYaml(dir, "claude.yaml", `config: [unclosed`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --- Non-object top-level data ---
  describe("최상위 데이터가 object가 아닌 경우", () => {
    it("claude.yaml 최상위가 배열이면 에러를 반환한다", () => {
      const path = writeYaml(dir, "claude.yaml", `
- item1
- item2
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("object 형식이어야 합니다"))).toBe(true);
    });
  });
});
