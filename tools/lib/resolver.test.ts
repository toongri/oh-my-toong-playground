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
    it("returns item.platforms when present on the item object", async () => {
      const item: SyncItem = { component: "oracle", platforms: ["codex"] };
      const result = await resolvePlatforms(item, ["claude", "gemini"], ["claude"], "agents");
      expect(result).toEqual(["codex"]);
    });

    it("falls through to next level when platforms is an empty array", async () => {
      const item: SyncItem = { component: "oracle", platforms: [] };
      const result = await resolvePlatforms(item, ["gemini"], undefined, "agents");
      expect(result).toEqual(["gemini"]);
    });

    it("falls through to level 2 when item is a string", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, ["gemini"], undefined, "agents");
      expect(result).toEqual(["gemini"]);
    });
  });

  // --- Level 2: sectionPlatforms ---
  describe("레벨 2: sectionPlatforms", () => {
    it("returns sectionPlatforms when item.platforms is absent", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, ["gemini", "codex"], ["claude"], "agents");
      expect(result).toEqual(["gemini", "codex"]);
    });

    it("falls through to next level when sectionPlatforms is empty", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, [], ["opencode"], "agents");
      expect(result).toEqual(["opencode"]);
    });

    it("falls through to next level when sectionPlatforms is undefined", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, undefined, ["opencode"], "agents");
      expect(result).toEqual(["opencode"]);
    });
  });

  // --- Level 3: syncYamlPlatforms ---
  describe("레벨 3: syncYamlPlatforms", () => {
    it("returns syncYamlPlatforms when sectionPlatforms is absent", async () => {
      const item: SyncItem = "oracle";
      const result = await resolvePlatforms(item, undefined, ["claude", "opencode"], "agents");
      expect(result).toEqual(["claude", "opencode"]);
    });

    it("falls through to config level when syncYamlPlatforms is empty", async () => {
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
    it("returns feature-platforms from config.yaml when syncYamlPlatforms is absent", async () => {
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

    it("returns feature-platforms for the agents category", async () => {
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
    it("falls back to use-platforms for categories absent from feature-platforms", async () => {
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
    it("returns [\"claude\"] when config.yaml is missing", async () => {
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
    it("item.platforms fully overrides all lower levels when present", async () => {
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
    it("returns path when direct .md file exists", () => {
      touch(join(root, "agents", "oracle.md"));
      const result = resolveComponentPath("oracle", "agents", root, undefined);
      expect(result).toEqual({ path: join(root, "agents", "oracle.md"), displayName: "oracle" });
    });

    it("falls back to index.md in folder", () => {
      touch(join(root, "agents", "oracle", "index.md"));
      const result = resolveComponentPath("oracle", "agents", root, undefined);
      expect(result).toEqual({ path: join(root, "agents", "oracle", "index.md"), displayName: "oracle" });
    });

    it("uses SKILL.md folder for the skills category", () => {
      touch(join(root, "skills", "prometheus", "SKILL.md"));
      const result = resolveComponentPath("prometheus", "skills", root, undefined);
      expect(result).toEqual({ path: join(root, "skills", "prometheus"), displayName: "prometheus" });
    });

    it("returns an error when component is not found", () => {
      const result = resolveComponentPath("missing", "agents", root, undefined);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("missing");
    });

    it("direct file takes priority over index.md", () => {
      touch(join(root, "agents", "oracle.md"));
      touch(join(root, "agents", "oracle", "index.md"));
      const result = resolveComponentPath("oracle", "agents", root, undefined);
      expect(result).toEqual({ path: join(root, "agents", "oracle.md"), displayName: "oracle" });
    });
  });

  // --- Scoped ref from root yaml (blocked) ---
  describe("루트 yaml에서 스코프 참조 (차단)", () => {
    it("returns an error when root yaml uses a project-scoped reference", () => {
      const result = resolveComponentPath("myproject:oracle", "agents", root, undefined);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Root sync.yaml");
    });
  });

  // --- Project-local component ---
  describe("프로젝트 로컬 컴포넌트", () => {
    it("returns project-local component first when it exists", () => {
      touch(join(root, "projects", "myproject", "agents", "oracle.md"));
      touch(join(root, "agents", "oracle.md")); // also global
      const result = resolveComponentPath("oracle", "agents", root, "myproject");
      expect(result).toEqual({
        path: join(root, "projects", "myproject", "agents", "oracle.md"),
        displayName: "oracle",
      });
    });

    it("falls back to global component when not found in project", () => {
      touch(join(root, "agents", "oracle.md"));
      const result = resolveComponentPath("oracle", "agents", root, "myproject");
      expect(result).toEqual({ path: join(root, "agents", "oracle.md"), displayName: "oracle" });
    });

    it("returns an error when component is absent from both project and global", () => {
      const result = resolveComponentPath("missing", "agents", root, "myproject");
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("myproject");
    });

    it("uses project-local index.md fallback", () => {
      touch(join(root, "projects", "myproject", "skills", "custom", "index.md"));
      const result = resolveComponentPath("custom", "skills", root, "myproject");
      expect(result).toEqual({
        path: join(root, "projects", "myproject", "skills", "custom", "index.md"),
        displayName: "custom",
      });
    });

    it("uses project-local SKILL.md", () => {
      touch(join(root, "projects", "myproject", "skills", "custom", "SKILL.md"));
      const result = resolveComponentPath("custom", "skills", root, "myproject");
      expect(result).toEqual({
        path: join(root, "projects", "myproject", "skills", "custom"),
        displayName: "custom",
      });
    });
  });

  // --- Scoped ref (same project) ---
  describe("동일 프로젝트 스코프 참조", () => {
    it("resolves same-project scoped reference to the project path", () => {
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
    it("returns an error when referencing a different project", () => {
      touch(join(root, "projects", "otherproject", "agents", "oracle.md"));
      const result = resolveComponentPath("otherproject:oracle", "agents", root, "myproject");
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toContain("Cross-project reference not allowed");
      expect((result as { error: string }).error).toContain("myproject");
    });
  });

  // --- index.md folder fallback (detail) ---
  describe("index.md 폴더 폴백 (상세)", () => {
    it("returns index.md when name.md is absent but name/index.md exists", () => {
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
    it("returns isRootYaml=true for sync.yaml at the root path", () => {
      const syncYaml: SyncYaml = { path: "/target" };
      const result = setProjectContext(syncYaml, join(root, "sync.yaml"), root);
      expect(result).toEqual({ projectName: "", projectDir: "", isRootYaml: true });
    });
  });

  // --- Project yaml with name field ---
  describe("name 필드가 있는 프로젝트 sync.yaml", () => {
    it("uses name field as projectName when present", () => {
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
    it("uses directory name as projectName when name field is absent", () => {
      const syncYaml: SyncYaml = { path: "/target" };
      const yamlPath = join(root, "projects", "loopers-project", "sync.yaml");
      const result = setProjectContext(syncYaml, yamlPath, root);
      expect(result).toEqual({
        projectName: "loopers-project",
        projectDir: "loopers-project",
        isRootYaml: false,
      });
    });

    it("falls back to directory name when name field is an empty string", () => {
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
    it("projectDir is always derived from the sync.yaml parent directory name", () => {
      const syncYaml: SyncYaml = { name: "alias" };
      const yamlPath = join(root, "projects", "actual-dir", "sync.yaml");
      const result = setProjectContext(syncYaml, yamlPath, root);
      expect(result.projectDir).toBe("actual-dir");
      expect(result.projectName).toBe("alias");
    });
  });
});
