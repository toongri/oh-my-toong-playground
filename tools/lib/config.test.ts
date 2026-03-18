import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { join } from "path";
import { parse } from "yaml";

import {
  loadConfig,
  getRootDir,
  getDefaultPlatforms,
  getFeaturePlatforms,
  getBackupRetentionDays,
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
      const spy = spyOn(Bun, "file").mockReturnValue(badFile as ReturnType<typeof Bun.file>);
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
        await expect(loadConfig()).rejects.toThrow();
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
