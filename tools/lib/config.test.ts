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
    it("config.yaml이 존재하면 루트 디렉토리를 반환한다", () => {
      // getRootDir walks up from __dirname; in the real project the root exists
      const rootDir = getRootDir();
      expect(rootDir).not.toBeNull();
      // The root dir should contain config.yaml (checked by Bun.file().size > 0)
      expect(typeof rootDir).toBe("string");
    });

    it("config.yaml이 없으면 null을 반환한다", () => {
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
    it("실제 config.yaml을 파싱해서 반환한다", async () => {
      const config = await loadConfig();
      expect(config).not.toBeNull();
      // Real config has use-platforms
      expect(config!["use-platforms"]).toBeDefined();
    });

    it("config.yaml이 없으면 null을 반환한다", async () => {
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

    it("파싱 불가한 YAML이면 null을 반환한다", async () => {
      // Return size > 0 but throw on text() to simulate read error
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

    it("결과를 캐싱해서 두 번째 호출 시 재파싱하지 않는다", async () => {
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
    it("config.yaml의 use-platforms 값을 반환한다", async () => {
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

    it("config.yaml이 없으면 [\"claude\"]를 반환한다", async () => {
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

    it("use-platforms 필드가 없으면 [\"claude\"]를 반환한다", async () => {
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

    it("use-platforms가 빈 배열이면 [\"claude\"]를 반환한다", async () => {
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
    it("존재하는 카테고리의 feature-platforms 값을 반환한다", async () => {
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

    it("존재하는 hooks 카테고리를 반환한다", async () => {
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

    it("카테고리가 없으면 getDefaultPlatforms() 결과로 폴백한다", async () => {
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

    it("feature-platforms 섹션 자체가 없으면 getDefaultPlatforms() 결과로 폴백한다", async () => {
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

    it("config.yaml이 없으면 [\"claude\"]로 폴백한다", async () => {
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
    it("config.yaml의 backup_retention_days 값을 반환한다", async () => {
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

    it("backup_retention_days 필드가 없으면 3을 반환한다", async () => {
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

    it("config.yaml이 없으면 3을 반환한다", async () => {
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

    it("backup_retention_days가 0이면 기본값 3을 반환한다", async () => {
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
