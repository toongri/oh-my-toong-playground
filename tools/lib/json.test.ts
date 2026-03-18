import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { readJsonFile, writeJsonFile } from "./json.ts";

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
