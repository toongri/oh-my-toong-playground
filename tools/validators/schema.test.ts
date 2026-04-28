import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { validateSyncYaml, validatePlatformYaml, validateSyncYamlPartial, validatePlatformYamlPartial, validateAll, validateConfigYaml, validateConfigYamlPartial } from "./schema.ts";

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
    it("returns error when config section is present via `validateSyncYaml`", () => {
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

    it("returns error when hooks section is present via `validateSyncYaml`", () => {
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

    it("returns error when mcps section is present via `validateSyncYaml`", () => {
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

    it("returns error when plugins section is present via `validateSyncYaml`", () => {
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

    it("produces no deprecated-section errors for sync.yaml without deprecated sections", () => {
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
    it("returns error for invalid YAML syntax via `validateSyncYaml`", () => {
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
    it("produces no errors when only allowed sections are present", () => {
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

    it("produces no errors for valid object item format", () => {
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
    it("returns error for invalid platform value via `validateSyncYaml`", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
platforms: [claude, invalid-platform]
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("invalid-platform"))).toBe(true);
    });

    it("produces no errors for all supported platform values", () => {
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
    it("returns error for unknown top-level field via `validateSyncYaml`", () => {
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
    it("returns error when section is an array via `validateSyncYaml`", () => {
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
    it("returns error when item.platforms contains an invalid value", () => {
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
    it("returns error when agents section is a string via `validateSyncYaml`", () => {
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
    it("returns error for object item missing component field", () => {
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

  // --- items/platforms 비배열 검증 ---
  describe("items/platforms 비배열 검증", () => {
    it("returns error when items is a string via `validateSyncYaml`", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items: "not-array"
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("agents.items") && e.includes("배열 형식"))).toBe(true);
    });

    it("returns error when section platforms is a string via `validateSyncYaml`", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  platforms: "not-array"
  items:
    - oracle
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("agents.platforms") && e.includes("배열 형식"))).toBe(true);
    });

    it("produces no errors for valid items array and platforms array", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  platforms: [claude]
  items:
    - oracle
`);
      const result = validateSyncYaml(path);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- P2-3: component 필드 타입 검증 ---
  describe("P2-3: component 필드 타입 검증", () => {
    it("returns error when component is a number (non-string)", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items:
    - component: 123
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("string이어야 합니다"))).toBe(true);
    });

    it("returns error when component is an empty string", () => {
      const path = writeYaml(dir, "sync.yaml", `
path: /target
agents:
  items:
    - component: ""
`);
      const result = validateSyncYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("빈 문자열은 허용되지 않습니다"))).toBe(true);
    });
  });

  // --- P2-7: No hook component file checks ---
  describe("P2-7: schema.ts는 hook 파일 존재를 검사하지 않는다", () => {
    it("produces no file-existence errors for sync.yaml without hooks (deprecated — structure errors only)", () => {
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
    it("returns warning for unknown section in claude.yaml via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "claude.yaml", `
config:
  model: claude-opus
unknown-section: value
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("unknown-section"))).toBe(true);
    });

    it("does not warn for plugins section in gemini.yaml via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "gemini.yaml", `
config:
  model: gemini-pro
plugins:
  items: []
`);
      const result = validatePlatformYaml(path, "gemini");
      expect(result.warnings.some((w) => w.includes("plugins"))).toBe(false);
    });

    it("returns warning for hooks section in codex.yaml via `validatePlatformYaml`", () => {
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
    it("produces no errors or warnings when claude.yaml has only allowed sections", () => {
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

    it("produces no errors or warnings when gemini.yaml has only allowed sections", () => {
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

    it("produces no errors or warnings when codex.yaml has only allowed sections", () => {
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

    it("produces no errors or warnings when opencode.yaml has only allowed sections", () => {
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
    it("returns error for invalid event name in hooks via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "claude.yaml", `
hooks:
  InvalidEvent:
    - component: some-hook.sh
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("InvalidEvent"))).toBe(true);
    });

    it("returns error when event value is not an array via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "claude.yaml", `
hooks:
  UserPromptSubmit: "not-an-array"
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("UserPromptSubmit") && e.includes("배열"))).toBe(true);
    });

    it("produces no errors for valid event names with array values", () => {
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
    it("returns error when mcps entry value is not an object via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "claude.yaml", `
mcps:
  some-mcp: "not-an-object"
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("some-mcp") && e.includes("object"))).toBe(true);
    });

    it("produces no errors when mcps entry value is an object", () => {
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

  // --- hooks 최상위 타입 검증 ---
  describe("hooks 최상위 타입 검증", () => {
    it("returns error when hooks is an array via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "claude.yaml", `
hooks: []
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("hooks") && e.includes("object 형식"))).toBe(true);
    });

    it("returns error when hooks is a string via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "claude.yaml", `
hooks: "bad-type"
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("hooks") && e.includes("object 형식"))).toBe(true);
    });

    it("produces no errors when hooks is a valid object", () => {
      const path = writeYaml(dir, "claude.yaml", `
hooks:
  UserPromptSubmit: []
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- mcps 최상위 타입 검증 ---
  describe("mcps 최상위 타입 검증", () => {
    it("returns error when mcps is an array via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "claude.yaml", `
mcps: []
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("mcps") && e.includes("object 형식"))).toBe(true);
    });

    it("produces no errors when mcps is a valid object", () => {
      const path = writeYaml(dir, "claude.yaml", `
mcps:
  some-mcp:
    command: npx
`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors).toHaveLength(0);
    });
  });

  // --- YAML syntax error ---
  describe("YAML 문법 오류", () => {
    it("returns error for invalid YAML syntax via `validatePlatformYaml`", () => {
      const path = writeYaml(dir, "claude.yaml", `config: [unclosed`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --- 구조 오류 메시지에 실제 파일명 포함 ---
  describe("구조 오류 메시지에 실제 파일명 포함", () => {
    it("claude.yaml 구조 오류 메시지에 claude.yaml이 포함된다", () => {
      const path = writeYaml(dir, "claude.yaml", `hooks: "string"`);
      const result = validatePlatformYaml(path, "claude");
      expect(result.errors.some((e) => e.includes("claude.yaml"))).toBe(true);
    });
  });

  // --- Non-object top-level data ---
  describe("최상위 데이터가 object가 아닌 경우", () => {
    it("returns error when claude.yaml top-level is an array via `validatePlatformYaml`", () => {
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

// ---------------------------------------------------------------------------
// Suite: validateSyncYamlPartial
// ---------------------------------------------------------------------------

describe("validateSyncYamlPartial", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("빈 파일 처리", () => {
    it("빈 파일(0바이트)은 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "sync.local.yaml", "");
      const result = validateSyncYamlPartial(path);
      expect(result.errors).toHaveLength(0);
    });

    it("공백만 있는 파일은 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "sync.local.yaml", "   \n  \n");
      const result = validateSyncYamlPartial(path);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("부분 overlay 허용", () => {
    it("path 필드만 있는 파일은 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "sync.local.yaml", `path: "/work/project"\n`);
      const result = validateSyncYamlPartial(path);
      expect(result.errors).toHaveLength(0);
    });

    it("skills 섹션만 있는 파일은 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "sync.local.yaml", `
skills:
  items:
    - prometheus
`);
      const result = validateSyncYamlPartial(path);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("유효하지 않은 YAML은 오류 반환", () => {
    it("문법 오류가 있는 파일은 오류를 반환한다", () => {
      const path = writeYaml(dir, "sync.local.yaml", `path: [unclosed`);
      const result = validateSyncYamlPartial(path);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("오류 메시지에 파일명이 포함된다", () => {
      const path = writeYaml(dir, "sync.local.yaml", `path: [unclosed`);
      const result = validateSyncYamlPartial(path);
      expect(result.errors[0]).toContain("sync.local.yaml");
    });
  });

  describe("기본 검증 유지", () => {
    it("잘못된 플랫폼 값은 오류를 반환한다", () => {
      const path = writeYaml(dir, "sync.local.yaml", `
platforms: [invalid-platform]
`);
      const result = validateSyncYamlPartial(path);
      expect(result.errors.some((e) => e.includes("invalid-platform"))).toBe(true);
    });

    it("알 수 없는 최상위 필드는 오류를 반환한다", () => {
      const path = writeYaml(dir, "sync.local.yaml", `
unknown-field: value
`);
      const result = validateSyncYamlPartial(path);
      expect(result.errors.some((e) => e.includes("unknown-field"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: validatePlatformYamlPartial
// ---------------------------------------------------------------------------

describe("validatePlatformYamlPartial", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("빈 파일 처리", () => {
    it("빈 파일(0바이트)은 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "claude.local.yaml", "");
      const result = validatePlatformYamlPartial(path, "claude");
      expect(result.errors).toHaveLength(0);
    });

    it("공백만 있는 파일은 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "claude.local.yaml", "   \n");
      const result = validatePlatformYamlPartial(path, "claude");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("부분 overlay 허용", () => {
    it("config 섹션만 있는 claude.local.yaml은 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "claude.local.yaml", `
config:
  model: claude-opus
`);
      const result = validatePlatformYamlPartial(path, "claude");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("유효하지 않은 YAML은 오류 반환", () => {
    it("문법 오류가 있는 파일은 오류를 반환한다", () => {
      const path = writeYaml(dir, "claude.local.yaml", `config: [unclosed`);
      const result = validatePlatformYamlPartial(path, "claude");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("오류 메시지에 파일명이 포함된다", () => {
      const path = writeYaml(dir, "claude.local.yaml", `config: [unclosed`);
      const result = validatePlatformYamlPartial(path, "claude");
      expect(result.errors[0]).toContain("claude.local.yaml");
    });
  });

  describe("기본 검증 유지", () => {
    it("hooks가 배열이면 오류를 반환한다", () => {
      const path = writeYaml(dir, "claude.local.yaml", `hooks: []`);
      const result = validatePlatformYamlPartial(path, "claude");
      expect(result.errors.some((e) => e.includes("hooks") && e.includes("object 형식"))).toBe(true);
    });
  });

  describe("구조 오류 메시지에 실제 파일명 포함", () => {
    it("claude.local.yaml의 hooks 타입 오류 메시지에 claude.local.yaml이 포함된다", () => {
      const path = writeYaml(dir, "claude.local.yaml", `hooks: "string"`);
      const result = validatePlatformYamlPartial(path, "claude");
      expect(result.errors.some((e) => e.includes("claude.local.yaml"))).toBe(true);
      expect(result.errors.some((e) => e.includes("claude.yaml") && !e.includes("claude.local.yaml"))).toBe(false);
    });

    it("gemini.local.yaml의 hooks 타입 오류 메시지에 gemini.local.yaml이 포함된다", () => {
      const path = writeYaml(dir, "gemini.local.yaml", `hooks: "string"`);
      const result = validatePlatformYamlPartial(path, "gemini");
      expect(result.errors.some((e) => e.includes("gemini.local.yaml"))).toBe(true);
    });

    it("claude.local.yaml의 알 수 없는 섹션 경고에 claude.local.yaml이 포함된다", () => {
      const path = writeYaml(dir, "claude.local.yaml", `unknown-section: value`);
      const result = validatePlatformYamlPartial(path, "claude");
      expect(result.warnings.some((w) => w.includes("claude.local.yaml"))).toBe(true);
      expect(result.warnings.some((w) => w.includes("claude.yaml") && !w.includes("claude.local.yaml"))).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: validateConfigYaml — enabled-projects 타입 검증
// ---------------------------------------------------------------------------

describe("validateConfigYaml", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("enabled-projects 유효한 값", () => {
    it("enabled-projects가 string 배열이면 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "config.yaml", `
use-platforms: [claude]
enabled-projects:
  - foo
  - bar
`);
      const result = validateConfigYaml(path);
      expect(result.errors).toHaveLength(0);
    });

    it("enabled-projects가 빈 배열이면 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "config.yaml", `
use-platforms: [claude]
enabled-projects: []
`);
      const result = validateConfigYaml(path);
      expect(result.errors).toHaveLength(0);
    });

    it("enabled-projects가 없어도 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "config.yaml", `
use-platforms: [claude]
`);
      const result = validateConfigYaml(path);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("enabled-projects 잘못된 타입 거부", () => {
    it("enabled-projects가 string이면 오류를 반환한다", () => {
      const path = writeYaml(dir, "config.yaml", `
use-platforms: [claude]
enabled-projects: "single string"
`);
      const result = validateConfigYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("enabled-projects"))).toBe(true);
    });

    it("enabled-projects가 숫자이면 오류를 반환한다", () => {
      const path = writeYaml(dir, "config.yaml", `
use-platforms: [claude]
enabled-projects: 123
`);
      const result = validateConfigYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("enabled-projects"))).toBe(true);
    });

    it("enabled-projects 오류 메시지에 config.yaml이 포함된다", () => {
      const path = writeYaml(dir, "config.yaml", `
enabled-projects: "bad"
`);
      const result = validateConfigYaml(path);
      expect(result.errors.some((e) => e.includes("config.yaml"))).toBe(true);
    });
  });

  describe("YAML 문법 오류", () => {
    it("문법 오류가 있는 파일은 오류를 반환한다", () => {
      const path = writeYaml(dir, "config.yaml", `enabled-projects: [unclosed`);
      const result = validateConfigYaml(path);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: validateConfigYamlPartial — partial mode (config.local.yaml)
// ---------------------------------------------------------------------------

describe("validateConfigYamlPartial", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("partial mode: enabled-projects 단독 선언", () => {
    it("config.local.yaml에서 enabled-projects만 선언해도 통과한다", () => {
      const path = writeYaml(dir, "config.local.yaml", `
enabled-projects:
  - my-project
`);
      const result = validateConfigYamlPartial(path);
      expect(result.errors).toHaveLength(0);
    });

    it("빈 파일은 오류 없이 통과한다", () => {
      const path = writeYaml(dir, "config.local.yaml", "");
      const result = validateConfigYamlPartial(path);
      expect(result.errors).toHaveLength(0);
    });

    it("enabled-projects가 string이면 partial mode에서도 오류를 반환한다", () => {
      const path = writeYaml(dir, "config.local.yaml", `
enabled-projects: "bad"
`);
      const result = validateConfigYamlPartial(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("enabled-projects"))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: validateAll — local yaml 파일 탐색
// ---------------------------------------------------------------------------

describe("validateAll — local yaml 탐색", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = makeTempDir();
    mkdirSync(join(rootDir, "projects", "my-project"), { recursive: true });
    writeYaml(rootDir, "config.yaml", `defaults:\n  use-platforms: [claude]\n`);
    writeYaml(rootDir, "sync.yaml", `path: /target\n`);
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  describe("sync.local.yaml 탐색", () => {
    it("루트 sync.local.yaml 빈 파일은 통과한다", () => {
      writeYaml(rootDir, "sync.local.yaml", "");
      const result = validateAll(rootDir);
      expect(result.errors).toHaveLength(0);
    });

    it("루트 sync.local.yaml 문법 오류는 실패한다", () => {
      writeYaml(rootDir, "sync.local.yaml", `path: [unclosed`);
      const result = validateAll(rootDir);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("sync.local.yaml"))).toBe(true);
    });

    it("projects 하위 sync.local.yaml 문법 오류는 실패한다", () => {
      writeYaml(rootDir, join("projects", "my-project", "sync.yaml"), `path: /proj\n`);
      writeYaml(rootDir, join("projects", "my-project", "sync.local.yaml"), `path: [unclosed`);
      const result = validateAll(rootDir);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("sync.local.yaml"))).toBe(true);
    });
  });

  describe("platform.local.yaml 탐색", () => {
    it("루트 claude.local.yaml 빈 파일은 통과한다", () => {
      writeYaml(rootDir, "claude.local.yaml", "");
      const result = validateAll(rootDir);
      expect(result.errors).toHaveLength(0);
    });

    it("루트 claude.local.yaml 문법 오류는 실패한다", () => {
      writeYaml(rootDir, "claude.local.yaml", `config: [unclosed`);
      const result = validateAll(rootDir);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("claude.local.yaml"))).toBe(true);
    });

    it("루트 gemini.local.yaml 부분 파일은 통과한다", () => {
      writeYaml(rootDir, "gemini.local.yaml", `config:\n  model: gemini-pro\n`);
      const result = validateAll(rootDir);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("config.yaml / config.local.yaml 통합 검증", () => {
    it("config.yaml의 enabled-projects가 string이면 validateAll 결과에 errors가 포함된다", () => {
      writeYaml(rootDir, "config.yaml", `enabled-projects: 123\n`);
      const result = validateAll(rootDir);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("enabled-projects"))).toBe(true);
    });

    it("config.local.yaml의 enabled-projects가 string이면 validateAll 결과에 errors가 포함된다", () => {
      writeYaml(rootDir, "config.local.yaml", `enabled-projects: "wrong-type"\n`);
      const result = validateAll(rootDir);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("enabled-projects"))).toBe(true);
    });

    it("config.yaml의 enabled-projects가 배열이면 errors가 없다", () => {
      writeYaml(rootDir, "config.yaml", `enabled-projects: [foo]\n`);
      const result = validateAll(rootDir);
      expect(result.errors).toHaveLength(0);
    });

    it("config.local.yaml이 존재하지 않으면 errors가 없다", () => {
      const result = validateAll(rootDir);
      expect(result.errors).toHaveLength(0);
    });
  });
});
