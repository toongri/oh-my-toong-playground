import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { resolvePlatforms, resolveComponentPath, setProjectContext } from "./resolver.ts";
import { _resetConfigCache } from "./config.ts";
import type { SyncItem, Platform, SyncYaml } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a Bun.file-like mock for config.ts spying */
function makeFileMock(content: string | null) {
  return {
    size: content !== null ? content.length : 0,
    text: content !== null ? async () => content : async () => { throw new Error("File not found"); },
  };
}

/** Create a temp directory structure for resolver tests */
function makeTempRoot(): string {
  const root = join(tmpdir(), `resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "# placeholder\n");
}

function dirname(p: string): string {
  return p.split("/").slice(0, -1).join("/") || "/";
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_CONFIG = `
use-platforms: [claude, gemini]
feature-platforms:
  skills: [claude, gemini, codex, opencode]
  agents: [claude, gemini]
`.trim();

const MINIMAL_CONFIG = `
use-platforms: [claude, gemini]
`.trim();

// ---------------------------------------------------------------------------
// Suite: resolvePlatforms
// ---------------------------------------------------------------------------

describe("resolvePlatforms", () => {
  beforeEach(() => _resetConfigCache());
  afterEach(() => _resetConfigCache());

  // --- Level 1: item platforms ---
  describe("레벨 1: item.platforms", () => {
    it("item 객체에 platforms가 있으면 해당 값을 반환한다", async () => {
      const item: SyncItem = { component: "oracle", platforms: ["codex"] };
      const result = await resolvePlatforms(item, ["claude", "gemini"], ["claude"], "agents");
      expect(result).toEqual(["codex"]);
    });

    it("platforms가 빈 배열이면 다음 레벨로 넘어간다", async () => {
      const item: SyncItem = { component: "oracle", platforms: [] };
      const result = await resolvePlatforms(item, ["gemini"], undefined, "agents");
      expect(result).toEqual(["gemini"]);
    });

    it("string 형태 item은 레벨 2로 넘어간다", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, ["gemini"], undefined, "agents");
      expect(result).toEqual(["gemini"]);
    });
  });

  // --- Level 2: sectionPlatforms ---
  describe("레벨 2: sectionPlatforms", () => {
    it("item.platforms가 없을 때 sectionPlatforms를 반환한다", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, ["gemini", "codex"], ["claude"], "agents");
      expect(result).toEqual(["gemini", "codex"]);
    });

    it("sectionPlatforms가 비어있으면 다음 레벨로 넘어간다", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, [], ["opencode"], "agents");
      expect(result).toEqual(["opencode"]);
    });

    it("sectionPlatforms가 undefined이면 다음 레벨로 넘어간다", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, undefined, ["opencode"], "agents");
      expect(result).toEqual(["opencode"]);
    });
  });

  // --- Level 3: syncYamlPlatforms ---
  describe("레벨 3: syncYamlPlatforms", () => {
    it("sectionPlatforms가 없을 때 syncYamlPlatforms를 반환한다", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, undefined, ["claude", "opencode"], "agents");
      expect(result).toEqual(["claude", "opencode"]);
    });

    it("syncYamlPlatforms가 비어있으면 config 레벨로 넘어간다", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const item: SyncItem = "oracle";
        const result = await resolvePlatforms(item, undefined, [], "agents");
        expect(result).toEqual(["claude", "gemini"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // --- Level 4: feature-platforms ---
  describe("레벨 4: feature-platforms (config.yaml)", () => {
    it("syncYamlPlatforms가 없을 때 feature-platforms를 반환한다", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const item: SyncItem = "oracle";
        const result = await resolvePlatforms(item, undefined, undefined, "skills");
        expect(result).toEqual(["claude", "gemini", "codex", "opencode"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("agents 카테고리의 feature-platforms를 반환한다", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const item: SyncItem = "oracle";
        const result = await resolvePlatforms(item, undefined, undefined, "agents");
        expect(result).toEqual(["claude", "gemini"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // --- Level 5: use-platforms ---
  describe("레벨 5: use-platforms (config.yaml 기본값)", () => {
    it("feature-platforms 항목이 없는 카테고리는 use-platforms로 폴백한다", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(MINIMAL_CONFIG) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const item: SyncItem = "oracle";
        const result = await resolvePlatforms(item, undefined, undefined, "commands");
        expect(result).toEqual(["claude", "gemini"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // --- Level 6: hardcoded fallback ---
  describe("레벨 6: 하드코딩 폴백 [\"claude\"]", () => {
    it("config.yaml이 없으면 [\"claude\"]를 반환한다", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(null) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const item: SyncItem = "oracle";
        const result = await resolvePlatforms(item, undefined, undefined, "skills");
        expect(result).toEqual(["claude"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // --- Replacement semantics ---
  describe("완전 교체 동작", () => {
    it("item.platforms가 있으면 모든 하위 레벨을 완전히 교체한다", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const item: SyncItem = { component: "oracle", platforms: ["opencode"] };
        const result = await resolvePlatforms(
          item,
          ["claude", "gemini"],       // section
          ["claude", "gemini", "codex"], // sync yaml
          "skills",                    // feature-platforms has [claude,gemini,codex,opencode]
        );
        // item.platforms wins
        expect(result).toEqual(["opencode"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: resolveComponentPath
// ---------------------------------------------------------------------------

describe("resolveComponentPath", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // --- Global (root yaml) ---
  describe("전역 컴포넌트 (루트 yaml)", () => {
    it("직접 파일(.md)이 있으면 해당 경로를 반환한다", () => {
      touch(join(root, "agents", "oracle.md"));
      const result = resolveComponentPath("oracle", "agents", root, undefined);
      expect(result).toEqual({ path: join(root, "agents", "oracle.md"), displayName: "oracle" });
    });

    it("index.md 폴더 폴백을 사용한다", () => {
      touch(join(root, "agents", "oracle", "index.md"));
      const result = resolveComponentPath("oracle", "agents", root, undefined);
      expect(result).toEqual({ path: join(root, "agents", "oracle", "index.md"), displayName: "oracle" });
    });

    it("skills 카테고리에서 SKILL.md 폴더를 사용한다", () => {
      touch(join(root, "skills", "prometheus", "SKILL.md"));
      const result = resolveComponentPath("prometheus", "skills", root, undefined);
      expect(result).toEqual({ path: join(root, "skills", "prometheus", "SKILL.md"), displayName: "prometheus" });
    });

    it("컴포넌트가 없으면 에러를 반환한다", () => {
      const result = resolveComponentPath("missing", "agents", root, undefined);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("missing");
    });

    it("직접 파일이 index.md보다 우선한다", () => {
      touch(join(root, "agents", "oracle.md"));
      touch(join(root, "agents", "oracle", "index.md"));
      const result = resolveComponentPath("oracle", "agents", root, undefined);
      expect(result).toEqual({ path: join(root, "agents", "oracle.md"), displayName: "oracle" });
    });
  });

  // --- Scoped ref from root yaml (blocked) ---
  describe("루트 yaml에서 스코프 참조 (차단)", () => {
    it("루트 yaml에서 프로젝트 스코프 참조를 하면 에러를 반환한다", () => {
      const result = resolveComponentPath("myproject:oracle", "agents", root, undefined);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Root sync.yaml");
    });
  });

  // --- Project-local component ---
  describe("프로젝트 로컬 컴포넌트", () => {
    it("프로젝트 디렉토리에 컴포넌트가 있으면 먼저 반환한다", () => {
      touch(join(root, "projects", "myproject", "agents", "oracle.md"));
      touch(join(root, "agents", "oracle.md")); // also global
      const result = resolveComponentPath("oracle", "agents", root, "myproject");
      expect(result).toEqual({
        path: join(root, "projects", "myproject", "agents", "oracle.md"),
        displayName: "oracle",
      });
    });

    it("프로젝트에 없으면 전역으로 폴백한다", () => {
      touch(join(root, "agents", "oracle.md"));
      const result = resolveComponentPath("oracle", "agents", root, "myproject");
      expect(result).toEqual({ path: join(root, "agents", "oracle.md"), displayName: "oracle" });
    });

    it("프로젝트에도 전역에도 없으면 에러를 반환한다", () => {
      const result = resolveComponentPath("missing", "agents", root, "myproject");
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("myproject");
    });

    it("프로젝트 로컬 index.md 폴백을 사용한다", () => {
      touch(join(root, "projects", "myproject", "skills", "custom", "index.md"));
      const result = resolveComponentPath("custom", "skills", root, "myproject");
      expect(result).toEqual({
        path: join(root, "projects", "myproject", "skills", "custom", "index.md"),
        displayName: "custom",
      });
    });

    it("프로젝트 로컬 SKILL.md를 사용한다", () => {
      touch(join(root, "projects", "myproject", "skills", "custom", "SKILL.md"));
      const result = resolveComponentPath("custom", "skills", root, "myproject");
      expect(result).toEqual({
        path: join(root, "projects", "myproject", "skills", "custom", "SKILL.md"),
        displayName: "custom",
      });
    });
  });

  // --- Scoped ref (same project) ---
  describe("동일 프로젝트 스코프 참조", () => {
    it("같은 프로젝트 스코프 참조는 프로젝트 경로로 해석한다", () => {
      touch(join(root, "projects", "myproject", "skills", "custom.md"));
      const result = resolveComponentPath("myproject:custom", "skills", root, "myproject");
      expect(result).toEqual({
        path: join(root, "projects", "myproject", "skills", "custom.md"),
        displayName: "custom",
      });
    });
  });

  // --- Cross-project blocked ---
  describe("크로스 프로젝트 참조 (차단)", () => {
    it("다른 프로젝트를 참조하면 에러를 반환한다", () => {
      touch(join(root, "projects", "otherproject", "agents", "oracle.md"));
      const result = resolveComponentPath("otherproject:oracle", "agents", root, "myproject");
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Cross-project reference not allowed");
      expect((result as { error: string }).error).toContain("myproject");
    });
  });

  // --- index.md folder fallback (detail) ---
  describe("index.md 폴더 폴백 (상세)", () => {
    it("name.md가 없고 name/index.md가 있으면 index.md를 반환한다", () => {
      // Deliberately do NOT create oracle.md
      touch(join(root, "commands", "oracle", "index.md"));
      const result = resolveComponentPath("oracle", "commands", root, undefined);
      expect(result).toEqual({ path: join(root, "commands", "oracle", "index.md"), displayName: "oracle" });
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: setProjectContext
// ---------------------------------------------------------------------------

describe("setProjectContext", () => {
  let root: string;

  beforeEach(() => {
    root = makeTempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // --- Root yaml ---
  describe("루트 sync.yaml", () => {
    it("루트 경로의 sync.yaml은 isRootYaml=true를 반환한다", () => {
      const syncYaml: SyncYaml = { path: "/target" };
      const result = setProjectContext(syncYaml, join(root, "sync.yaml"), root);
      expect(result).toEqual({ projectName: "", projectDir: "", isRootYaml: true });
    });
  });

  // --- Project yaml with name field ---
  describe("name 필드가 있는 프로젝트 sync.yaml", () => {
    it("name 필드가 있으면 projectName에 사용한다", () => {
      const syncYaml: SyncYaml = { name: "my-custom-name", path: "/target" };
      const yamlPath = join(root, "projects", "my-dir", "sync.yaml");
      const result = setProjectContext(syncYaml, yamlPath, root);
      expect(result).toEqual({
        projectName: "my-custom-name",
        projectDir: "my-dir",
        isRootYaml: false,
      });
    });
  });

  // --- Project yaml without name field (directory fallback) ---
  describe("name 필드 없는 프로젝트 sync.yaml (디렉토리 폴백)", () => {
    it("name 필드가 없으면 디렉토리 이름을 projectName으로 사용한다", () => {
      const syncYaml: SyncYaml = { path: "/target" };
      const yamlPath = join(root, "projects", "loopers-project", "sync.yaml");
      const result = setProjectContext(syncYaml, yamlPath, root);
      expect(result).toEqual({
        projectName: "loopers-project",
        projectDir: "loopers-project",
        isRootYaml: false,
      });
    });

    it("빈 문자열 name 필드는 디렉토리 이름으로 폴백한다", () => {
      const syncYaml: SyncYaml = { name: "", path: "/target" };
      const yamlPath = join(root, "projects", "my-dir", "sync.yaml");
      const result = setProjectContext(syncYaml, yamlPath, root);
      expect(result).toEqual({
        projectName: "my-dir",
        projectDir: "my-dir",
        isRootYaml: false,
      });
    });
  });

  // --- projectDir from directory ---
  describe("projectDir 파생", () => {
    it("projectDir는 항상 sync.yaml 부모 디렉토리 이름이다", () => {
      const syncYaml: SyncYaml = { name: "alias" };
      const yamlPath = join(root, "projects", "actual-dir", "sync.yaml");
      const result = setProjectContext(syncYaml, yamlPath, root);
      expect(result.projectDir).toBe("actual-dir");
      expect(result.projectName).toBe("alias");
    });
  });
});
