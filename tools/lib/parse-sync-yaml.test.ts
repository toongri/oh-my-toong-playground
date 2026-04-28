import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { readAndExpandSyncYaml } from "./parse-sync-yaml.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "parse-sync-yaml-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("readAndExpandSyncYaml", () => {
  it("tilde path 포함 YAML을 읽고 path를 expand한다", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "sync.yaml");
      await writeFile(file, "path: ~/projects/my-app\n");
      const result = await readAndExpandSyncYaml(file);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(path.join(os.homedir(), "projects/my-app"));
    });
  });

  it("절대경로 path는 그대로 반환한다", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "sync.yaml");
      await writeFile(file, "path: /absolute/path/to/project\n");
      const result = await readAndExpandSyncYaml(file);
      expect(result).not.toBeNull();
      expect(result!.path).toBe("/absolute/path/to/project");
    });
  });

  it("빈 파일은 null을 반환한다", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "sync.yaml");
      await writeFile(file, "");
      const result = await readAndExpandSyncYaml(file);
      expect(result).toBeNull();
    });
  });

  it("path 없는 빈 객체 YAML은 SyncYaml({})를 반환한다", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "sync.yaml");
      await writeFile(file, "{}\n");
      const result = await readAndExpandSyncYaml(file);
      expect(result).not.toBeNull();
      expect(result!.path).toBeUndefined();
    });
  });

  it("잘못된 YAML 문법이면 throw한다", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "sync.yaml");
      await writeFile(file, "key: [\nbad yaml\n");
      await expect(readAndExpandSyncYaml(file)).rejects.toThrow();
    });
  });

  it("존재하지 않는 파일이면 throw한다", async () => {
    await expect(
      readAndExpandSyncYaml("/nonexistent/path/sync.yaml"),
    ).rejects.toThrow();
  });
});
