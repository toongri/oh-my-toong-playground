import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { syncDirectory, copyFile } from "./sync-directory.ts";

async function writeFile(
  filePath: string,
  content: string,
  mode?: number
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  if (mode !== undefined) {
    await fs.chmod(filePath, mode);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(p: string): Promise<boolean> {
  const stat = await fs.stat(p);
  return Boolean(stat.mode & 0o111);
}

describe("syncDirectory", () => {
  let tmpDir: string;
  let src: string;
  let tgt: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-directory-test-"));
    src = path.join(tmpDir, "src");
    tgt = path.join(tmpDir, "tgt");
    await fs.mkdir(src, { recursive: true });
    await fs.mkdir(tgt, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("중첩 디렉토리 재귀 복사", () => {
    it("copies nested source files to target", async () => {
      await writeFile(path.join(src, "a.ts"), "a");
      await writeFile(path.join(src, "sub/b.ts"), "b");
      await writeFile(path.join(src, "sub/deep/c.ts"), "c");

      await syncDirectory(src, tgt);

      expect(await exists(path.join(tgt, "a.ts"))).toBe(true);
      expect(await exists(path.join(tgt, "sub/b.ts"))).toBe(true);
      expect(await exists(path.join(tgt, "sub/deep/c.ts"))).toBe(true);

      const content = await fs.readFile(path.join(tgt, "sub/b.ts"), "utf8");
      expect(content).toBe("b");
    });
  });

  describe("고아 파일 삭제 (--delete 동작)", () => {
    it("deletes target files absent from source", async () => {
      await writeFile(path.join(src, "keep.ts"), "keep");
      await writeFile(path.join(tgt, "keep.ts"), "keep");
      await writeFile(path.join(tgt, "orphan.ts"), "orphan");

      await syncDirectory(src, tgt);

      expect(await exists(path.join(tgt, "keep.ts"))).toBe(true);
      expect(await exists(path.join(tgt, "orphan.ts"))).toBe(false);
    });

    it("deletes orphan files in nested directories", async () => {
      await writeFile(path.join(src, "a.ts"), "a");
      await writeFile(path.join(tgt, "a.ts"), "a");
      await writeFile(path.join(tgt, "sub/orphan.ts"), "orphan");

      await syncDirectory(src, tgt);

      expect(await exists(path.join(tgt, "sub/orphan.ts"))).toBe(false);
    });
  });

  describe("제외 패턴 (*.test.ts 기본값)", () => {
    it("does not copy *.test.ts files", async () => {
      await writeFile(path.join(src, "foo.ts"), "foo");
      await writeFile(path.join(src, "foo.test.ts"), "test");

      await syncDirectory(src, tgt);

      expect(await exists(path.join(tgt, "foo.ts"))).toBe(true);
      expect(await exists(path.join(tgt, "foo.test.ts"))).toBe(false);
    });

    it("excludes *.test.ts files in nested paths", async () => {
      await writeFile(path.join(src, "sub/bar.ts"), "bar");
      await writeFile(path.join(src, "sub/bar.test.ts"), "bartest");

      await syncDirectory(src, tgt);

      expect(await exists(path.join(tgt, "sub/bar.ts"))).toBe(true);
      expect(await exists(path.join(tgt, "sub/bar.test.ts"))).toBe(false);
    });

    it("does not delete excluded files that exist only in target", async () => {
      await writeFile(path.join(src, "foo.ts"), "foo");
      await writeFile(path.join(tgt, "foo.ts"), "foo");
      await writeFile(path.join(tgt, "foo.test.ts"), "test");

      await syncDirectory(src, tgt);

      expect(await exists(path.join(tgt, "foo.ts"))).toBe(true);
      expect(await exists(path.join(tgt, "foo.test.ts"))).toBe(true);
    });

    it("applies custom exclude patterns", async () => {
      await writeFile(path.join(src, "script.sh"), "#!/bin/bash");
      await writeFile(path.join(src, "readme.md"), "docs");

      await syncDirectory(src, tgt, { exclude: ["*.md"] });

      expect(await exists(path.join(tgt, "script.sh"))).toBe(true);
      expect(await exists(path.join(tgt, "readme.md"))).toBe(false);
    });
  });

  describe("실행 권한 보존", () => {
    it("sets +x permission on target for executable source files", async () => {
      const scriptPath = path.join(src, "hook.sh");
      await writeFile(scriptPath, "#!/bin/bash\necho hi", 0o755);

      await syncDirectory(src, tgt);

      expect(await isExecutable(path.join(tgt, "hook.sh"))).toBe(true);
    });

    it("copies non-executable files without +x permission", async () => {
      const filePath = path.join(src, "data.json");
      await writeFile(filePath, "{}", 0o644);

      await syncDirectory(src, tgt);

      const stat = await fs.stat(path.join(tgt, "data.json"));
      expect(stat.mode & 0o111).toBe(0);
    });
  });

  describe("고아 제거 후 빈 디렉토리 정리", () => {
    it("removes empty directory after orphan file deletion", async () => {
      await writeFile(path.join(src, "a.ts"), "a");
      await writeFile(path.join(tgt, "a.ts"), "a");
      await writeFile(path.join(tgt, "empty-dir/orphan.ts"), "orphan");

      await syncDirectory(src, tgt);

      expect(await exists(path.join(tgt, "empty-dir/orphan.ts"))).toBe(false);
      expect(await exists(path.join(tgt, "empty-dir"))).toBe(false);
    });

    it("removes all nested empty directories", async () => {
      await writeFile(path.join(src, "a.ts"), "a");
      await writeFile(path.join(tgt, "a.ts"), "a");
      await writeFile(path.join(tgt, "deep/nested/orphan.ts"), "orphan");

      await syncDirectory(src, tgt);

      expect(await exists(path.join(tgt, "deep/nested"))).toBe(false);
      expect(await exists(path.join(tgt, "deep"))).toBe(false);
    });
  });
});

describe("copyFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "copy-file-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("파일 복사", () => {
    it("copies file contents", async () => {
      const src = path.join(tmpDir, "src.txt");
      const tgt = path.join(tmpDir, "nested/tgt.txt");
      await fs.writeFile(src, "hello");

      await copyFile(src, tgt);

      const content = await fs.readFile(tgt, "utf8");
      expect(content).toBe("hello");
    });

    it("creates target directory when it does not exist", async () => {
      const src = path.join(tmpDir, "src.txt");
      const tgt = path.join(tmpDir, "new/deep/tgt.txt");
      await fs.writeFile(src, "data");

      await copyFile(src, tgt);

      expect(await exists(tgt)).toBe(true);
    });
  });

  describe("실행 권한 보존", () => {
    it("makes target executable when source is executable", async () => {
      const src = path.join(tmpDir, "script.sh");
      const tgt = path.join(tmpDir, "out/script.sh");
      await fs.writeFile(src, "#!/bin/bash");
      await fs.chmod(src, 0o755);

      await copyFile(src, tgt);

      const stat = await fs.stat(tgt);
      expect(stat.mode & 0o111).toBeTruthy();
    });

    it("target is non-executable when source is non-executable", async () => {
      const src = path.join(tmpDir, "config.json");
      const tgt = path.join(tmpDir, "out/config.json");
      await fs.writeFile(src, "{}");
      await fs.chmod(src, 0o644);

      await copyFile(src, tgt);

      const stat = await fs.stat(tgt);
      expect(stat.mode & 0o111).toBe(0);
    });
  });
});
