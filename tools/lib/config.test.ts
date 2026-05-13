import { describe, it, expect, beforeEach, spyOn } from "bun:test";

import {
  loadConfig,
  getRootDir,
  getDefaultPlatforms,
  getFeaturePlatforms,
  getBackupRetentionDays,
  getEnabledProjects,
  _resetConfigCache,
} from "./config.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileMock(content: string | null) {
  return {
    size: content !== null ? content.length : 0,
    text: content !== null ? async () => content : async () => { throw new Error("File not found"); },
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FULL_CONFIG_YAML = `
use-platforms: [claude, gemini]
feature-platforms:
  skills: [claude, gemini, codex, opencode]
  hooks: [claude, gemini]
backup_retention_days: 7
`.trim();

const MINIMAL_CONFIG_YAML = `
use-platforms: [claude]
`.trim();

const EMPTY_FIELDS_CONFIG_YAML = `
some-other-field: value
`.trim();

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("config 모듈", () => {
  beforeEach(() => {
    _resetConfigCache();
  });

  // -------------------------------------------------------------------------
  describe("getRootDir", () => {
    it("returns root directory when config.yaml exists", () => {
      // getRootDir walks up from __dirname; in the real project the root exists
      const rootDir = getRootDir();
      expect(rootDir).not.toBeNull();
      // The root dir should contain config.yaml (checked by Bun.file().size > 0)
      expect(typeof rootDir).toBe("string");
    });

    it("returns null when config.yaml is missing", () => {
      // Patch Bun.file so size is always 0 to simulate missing file
      const spy = spyOn(Bun, "file").mockReturnValue({ size: 0, text: async () => "" } as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const result = getRootDir();
        expect(result).toBeNull();
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("loadConfig", () => {
    it("parses and returns the real config.yaml", async () => {
      const config = await loadConfig();
      expect(config).not.toBeNull();
      // Real config has use-platforms
      expect(config!["use-platforms"]).toBeDefined();
    });

    it("returns null when config.yaml is missing", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(null) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const config = await loadConfig();
        expect(config).toBeNull();
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("returns null when file read fails", async () => {
      // Return size > 0 but throw on text() to simulate I/O error
      const badFile = {
        size: 10,
        text: async () => { throw new Error("read error"); },
      };
      const spy = spyOn(Bun, "file").mockReturnValue(badFile as unknown as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const config = await loadConfig();
        expect(config).toBeNull();
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("throws on invalid YAML syntax", async () => {
      const badYamlFile = {
        size: 1,
        text: async () => Promise.resolve("{{invalid yaml:"),
      };
      const spy = spyOn(Bun, "file").mockReturnValue(badYamlFile as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        expect(loadConfig()).rejects.toThrow();
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("caches result so second call to `loadConfig` does not re-parse", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const first = await loadConfig();
        const second = await loadConfig();
        // spy called for getRootDir walk + one actual load = at most a few times, but NOT 2x for load
        expect(first).toBe(second); // Same object reference
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("getDefaultPlatforms", () => {
    it("returns use-platforms value from config.yaml", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const platforms = await getDefaultPlatforms();
        expect(platforms).toEqual(["claude", "gemini"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("returns [\"claude\"] when config.yaml is missing", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(null) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const platforms = await getDefaultPlatforms();
        expect(platforms).toEqual(["claude"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("returns [\"claude\"] when use-platforms field is absent", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(EMPTY_FIELDS_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const platforms = await getDefaultPlatforms();
        expect(platforms).toEqual(["claude"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("returns [\"claude\"] when use-platforms is an empty array", async () => {
      const yaml = "use-platforms: []";
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(yaml) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const platforms = await getDefaultPlatforms();
        expect(platforms).toEqual(["claude"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("getFeaturePlatforms", () => {
    it("returns feature-platforms value for an existing category", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const platforms = await getFeaturePlatforms("skills");
        expect(platforms).toEqual(["claude", "gemini", "codex", "opencode"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("returns feature-platforms for the hooks category", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const platforms = await getFeaturePlatforms("hooks");
        expect(platforms).toEqual(["claude", "gemini"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("falls back to `getDefaultPlatforms` when category is not in feature-platforms", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        // "commands" is not in FULL_CONFIG_YAML's feature-platforms
        const platforms = await getFeaturePlatforms("commands");
        // Should fall back to use-platforms from FULL_CONFIG_YAML
        expect(platforms).toEqual(["claude", "gemini"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("falls back to `getDefaultPlatforms` when feature-platforms section is absent", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(MINIMAL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const platforms = await getFeaturePlatforms("skills");
        expect(platforms).toEqual(["claude"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("falls back to [\"claude\"] when config.yaml is missing", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(null) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const platforms = await getFeaturePlatforms("skills");
        expect(platforms).toEqual(["claude"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("config.local.yaml 오버레이", () => {
    function makePathAwareFileMock(files: Record<string, string | null>) {
      return (path: string) => {
        const content = files[path] ?? null;
        return {
          size: content !== null ? content.length : 0,
          text:
            content !== null
              ? async () => content
              : async () => {
                  throw new Error("File not found");
                },
        };
      };
    }

    it("config.local.yaml 없을 때 기존 동작과 동일", async () => {
      const baseYaml = `
use-platforms: [claude, gemini]
feature-platforms:
  skills: [claude, gemini, codex]
backup_retention_days: 5
`.trim();

      const rootDir = getRootDir();
      const spy = spyOn(Bun, "file").mockImplementation(
        makePathAwareFileMock({
          [rootDir + "/config.yaml"]: baseYaml,
        }) as unknown as typeof Bun.file,
      );
      try {
        _resetConfigCache();
        const config = await loadConfig();
        expect(config!["use-platforms"]).toEqual(["claude", "gemini"]);
        expect(config!["feature-platforms"]!["skills"]).toEqual(["claude", "gemini", "codex"]);
        expect(config!.backup_retention_days).toBe(5);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("config.local.yaml의 feature-platforms.skills가 base와 union-dedup 병합됨", async () => {
      const baseYaml = `
use-platforms: [claude, gemini]
feature-platforms:
  skills: [claude, gemini, codex]
`.trim();
      const localYaml = `
feature-platforms:
  skills: [claude]
`.trim();

      const rootDir = getRootDir();
      const spy = spyOn(Bun, "file").mockImplementation(
        makePathAwareFileMock({
          [rootDir + "/config.yaml"]: baseYaml,
          [rootDir + "/config.local.yaml"]: localYaml,
        }) as unknown as typeof Bun.file,
      );
      try {
        _resetConfigCache();
        const platforms = await getFeaturePlatforms("skills");
        expect(platforms).toContain("claude");
        expect(platforms).toContain("gemini");
        expect(platforms).toContain("codex");
        // No duplicates
        expect(platforms.filter((p) => p === "claude").length).toBe(1);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("config.local.yaml의 backup_retention_days 스칼라 값이 base를 대체함", async () => {
      const baseYaml = `backup_retention_days: 7`;
      const localYaml = `backup_retention_days: 14`;

      const rootDir = getRootDir();
      const spy = spyOn(Bun, "file").mockImplementation(
        makePathAwareFileMock({
          [rootDir + "/config.yaml"]: baseYaml,
          [rootDir + "/config.local.yaml"]: localYaml,
        }) as unknown as typeof Bun.file,
      );
      try {
        _resetConfigCache();
        const days = await getBackupRetentionDays();
        expect(days).toBe(14);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("_resetConfigCache 이후 재로드 시 새로 작성된 config.local.yaml 반영됨", async () => {
      const baseYaml = `backup_retention_days: 3`;
      const localYaml = `backup_retention_days: 30`;

      const rootDir = getRootDir();

      const baseOnlyMock = makePathAwareFileMock({
        [rootDir + "/config.yaml"]: baseYaml,
      });
      const spy = spyOn(Bun, "file").mockImplementation(baseOnlyMock as unknown as typeof Bun.file);

      try {
        _resetConfigCache();
        const daysBefore = await getBackupRetentionDays();
        expect(daysBefore).toBe(3);

        // Now "write" config.local.yaml by changing the mock
        spy.mockImplementation(
          makePathAwareFileMock({
            [rootDir + "/config.yaml"]: baseYaml,
            [rootDir + "/config.local.yaml"]: localYaml,
          }) as unknown as typeof Bun.file,
        );

        _resetConfigCache();
        const daysAfter = await getBackupRetentionDays();
        expect(daysAfter).toBe(30);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("getEnabledProjects", () => {
    function makePathAwareFileMock(files: Record<string, string | null>) {
      return (path: string) => {
        const content = files[path] ?? null;
        return {
          size: content !== null ? content.length : 0,
          text:
            content !== null
              ? async () => content
              : async () => {
                  throw new Error("File not found");
                },
        };
      };
    }

    it("enabled-projects 미선언 시 undefined 반환", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(MINIMAL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const result = await getEnabledProjects();
        expect(result).toBeUndefined();
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("config.yaml 없을 때 undefined 반환", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(null) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const result = await getEnabledProjects();
        expect(result).toBeUndefined();
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("base에서 enabled-projects 선언 시 array 반환", async () => {
      const yaml = `enabled-projects: [foo, bar]`;
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(yaml) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const result = await getEnabledProjects();
        expect(result).toEqual(["foo", "bar"]);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("빈 array([]) → undefined로 정규화 (footgun 방지)", async () => {
      const yaml = `enabled-projects: []`;
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(yaml) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const result = await getEnabledProjects();
        expect(result).toBeUndefined();
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("local overlay union+dedup: base [foo] + local [bar, foo] → [foo, bar]", async () => {
      const baseYaml = `enabled-projects: [foo]`;
      const localYaml = `enabled-projects: [bar, foo]`;

      const rootDir = getRootDir();
      const spy = spyOn(Bun, "file").mockImplementation(
        makePathAwareFileMock({
          [rootDir + "/config.yaml"]: baseYaml,
          [rootDir + "/config.local.yaml"]: localYaml,
        }) as unknown as typeof Bun.file,
      );
      try {
        _resetConfigCache();
        const result = await getEnabledProjects();
        expect(result).toBeDefined();
        expect(result).toContain("foo");
        expect(result).toContain("bar");
        expect(result!.filter((p) => p === "foo").length).toBe(1);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("getBackupRetentionDays", () => {
    it("returns backup_retention_days value from config.yaml", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(FULL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const days = await getBackupRetentionDays();
        expect(days).toBe(7);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("returns 3 when backup_retention_days field is absent", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(MINIMAL_CONFIG_YAML) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const days = await getBackupRetentionDays();
        expect(days).toBe(3);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("returns 3 when config.yaml is missing", async () => {
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(null) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const days = await getBackupRetentionDays();
        expect(days).toBe(3);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });

    it("returns default 3 when backup_retention_days is 0", async () => {
      const yaml = "backup_retention_days: 0";
      const spy = spyOn(Bun, "file").mockReturnValue(makeFileMock(yaml) as ReturnType<typeof Bun.file>);
      try {
        _resetConfigCache();
        const days = await getBackupRetentionDays();
        expect(days).toBe(3);
      } finally {
        spy.mockRestore();
        _resetConfigCache();
      }
    });
  });
});
