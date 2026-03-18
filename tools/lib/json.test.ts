import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { readJsonFile, writeJsonFile, readTextFile } from "./json.ts";

describe("readJsonFile", () => {
  it("returns {} when file does not exist (ENOENT)", async () => {
    const result = await readJsonFile("/nonexistent/path/that/does/not/exist.json");
    expect(result).toEqual({});
  });

  it("returns parsed object for valid JSON file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-test-"));
    const filePath = path.join(tmpDir, "test.json");
    await fs.writeFile(filePath, JSON.stringify({ foo: "bar", num: 42 }), "utf8");

    const result = await readJsonFile(filePath);
    expect(result).toEqual({ foo: "bar", num: 42 });

    await fs.rm(tmpDir, { recursive: true });
  });

  it("throws and calls logError for invalid (corrupt) JSON", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-test-"));
    const filePath = path.join(tmpDir, "corrupt.json");
    await fs.writeFile(filePath, "{ not valid json }", "utf8");

    await expect(readJsonFile(filePath)).rejects.toThrow();

    await fs.rm(tmpDir, { recursive: true });
  });
});

describe("readTextFile", () => {
  it("returns empty string when file does not exist (ENOENT)", async () => {
    const result = await readTextFile("/nonexistent/path/that/does/not/exist.txt");
    expect(result).toBe("");
  });

  it("returns file contents for an existing file", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "text-test-"));
    const filePath = path.join(tmpDir, "test.txt");
    await fs.writeFile(filePath, "hello world", "utf8");

    const result = await readTextFile(filePath);
    expect(result).toBe("hello world");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("re-throws non-ENOENT errors (permission denied)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "text-test-"));
    const filePath = path.join(tmpDir, "noperm.txt");
    await fs.writeFile(filePath, "secret", "utf8");
    await fs.chmod(filePath, 0o000);

    try {
      await expect(readTextFile(filePath)).rejects.toThrow();
    } finally {
      await fs.chmod(filePath, 0o644);
      await fs.rm(tmpDir, { recursive: true });
    }
  });
});

describe("writeJsonFile", () => {
  it("creates parent directories and writes formatted JSON with trailing newline", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "json-test-"));
    const filePath = path.join(tmpDir, "nested", "dir", "output.json");
    const data = { key: "value", num: 1 };

    await writeJsonFile(filePath, data);

    const raw = await fs.readFile(filePath, "utf8");
    expect(raw).toBe(JSON.stringify(data, null, 2) + "\n");

    await fs.rm(tmpDir, { recursive: true });
  });
});
