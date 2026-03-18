import { describe, it, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { makeResult, mergeResult, isObject, isArray, parseYaml } from "./validation.ts";

describe("makeResult", () => {
  it("returns result with empty errors and warnings arrays", () => {
    const result = makeResult();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("mergeResult", () => {
  it("merges errors and warnings from source into target", () => {
    const target = { errors: ["e1"], warnings: ["w1"] };
    const source = { errors: ["e2", "e3"], warnings: ["w2"] };
    mergeResult(target, source);
    expect(target.errors).toEqual(["e1", "e2", "e3"]);
    expect(target.warnings).toEqual(["w1", "w2"]);
  });

  it("does not mutate source", () => {
    const target = makeResult();
    const source = { errors: ["e1"], warnings: [] };
    mergeResult(target, source);
    expect(source.errors).toEqual(["e1"]);
  });

  it("handles empty source without error", () => {
    const target = { errors: ["e1"], warnings: [] };
    mergeResult(target, makeResult());
    expect(target.errors).toEqual(["e1"]);
    expect(target.warnings).toEqual([]);
  });
});

describe("isObject", () => {
  it("returns true for plain objects", () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it("returns false for arrays", () => {
    expect(isObject([])).toBe(false);
    expect(isObject([1, 2])).toBe(false);
  });

  it("returns false for null", () => {
    expect(isObject(null)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isObject("string")).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject(undefined)).toBe(false);
  });
});

describe("isArray", () => {
  it("returns true for arrays", () => {
    expect(isArray([])).toBe(true);
    expect(isArray([1, 2, 3])).toBe(true);
  });

  it("returns false for non-arrays", () => {
    expect(isArray({})).toBe(false);
    expect(isArray("string")).toBe(false);
    expect(isArray(null)).toBe(false);
    expect(isArray(undefined)).toBe(false);
  });
});

describe("parseYaml", () => {
  it("returns parsed data for valid YAML file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-test-"));
    const filePath = path.join(tmpDir, "valid.yaml");
    fs.writeFileSync(filePath, "key: value\nlist:\n  - a\n  - b\n", "utf-8");

    const result = parseYaml(filePath);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ key: "value", list: ["a", "b"] });

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns error with default prefix for invalid YAML", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-test-"));
    const filePath = path.join(tmpDir, "invalid.yaml");
    fs.writeFileSync(filePath, "key: [\nbad yaml", "utf-8");

    const result = parseYaml(filePath);
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/^YAML 파싱 오류 \(invalid\.yaml\):/);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns error with custom prefix when errorPrefix is provided", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-test-"));
    const filePath = path.join(tmpDir, "invalid.yaml");
    fs.writeFileSync(filePath, "key: [\nbad yaml", "utf-8");

    const result = parseYaml(filePath, "YAML 문법 오류");
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/^YAML 문법 오류 \(invalid\.yaml\):/);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns error when file does not exist", () => {
    const result = parseYaml("/nonexistent/path/file.yaml");
    expect(result.data).toBeUndefined();
    expect(result.error).toMatch(/^YAML 파싱 오류 \(file\.yaml\):/);
  });
});
