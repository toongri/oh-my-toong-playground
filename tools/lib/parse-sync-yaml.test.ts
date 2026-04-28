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

  it("sync.yaml + sync.local.yaml가 모두 있으면 overlay merge 결과를 반환한다", async () => {
    await withTempDir(async (dir) => {
      const base = path.join(dir, "sync.yaml");
      const local = path.join(dir, "sync.local.yaml");
      await writeFile(base, "path: ~/base\nagents:\n  items:\n    - oracle\n");
      await writeFile(local, "path: ~/override\nagents:\n  items:\n    - explore\n");
      const result = await readAndExpandSyncYaml(base);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(path.join(os.homedir(), "override"));
      expect((result!.agents as { items: string[] }).items).toEqual(["oracle", "explore"]);
    });
  });

  it("sync.local.yaml만 있고 sync.yaml이 없으면 local 내용을 반환한다", async () => {
    await withTempDir(async (dir) => {
      const basePath = path.join(dir, "sync.yaml");
      const local = path.join(dir, "sync.local.yaml");
      await writeFile(local, "path: ~/local-only\nagents:\n  items:\n    - oracle\n");
      const result = await readAndExpandSyncYaml(basePath);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(path.join(os.homedir(), "local-only"));
    });
  });

  it("sync.local.yaml이 비어있으면 base-only 결과와 동일하다", async () => {
    await withTempDir(async (dir) => {
      const base = path.join(dir, "sync.yaml");
      const local = path.join(dir, "sync.local.yaml");
      await writeFile(base, "path: ~/projects/my-app\n");
      await writeFile(local, "");
      const result = await readAndExpandSyncYaml(base);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(path.join(os.homedir(), "projects/my-app"));
    });
  });

  it("base의 path가 local의 path로 scalar-replace된다", async () => {
    await withTempDir(async (dir) => {
      const base = path.join(dir, "sync.yaml");
      const local = path.join(dir, "sync.local.yaml");
      await writeFile(base, "path: ~/base-path\n");
      await writeFile(local, "path: ~/local-path\n");
      const result = await readAndExpandSyncYaml(base);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(path.join(os.homedir(), "local-path"));
    });
  });

  it("local의 tilde path가 expand된다", async () => {
    await withTempDir(async (dir) => {
      const base = path.join(dir, "sync.yaml");
      const local = path.join(dir, "sync.local.yaml");
      await writeFile(base, "path: /absolute/base\n");
      await writeFile(local, "path: ~/from-local\n");
      const result = await readAndExpandSyncYaml(base);
      expect(result).not.toBeNull();
      expect(result!.path).toBe(path.join(os.homedir(), "from-local"));
    });
  });
});
