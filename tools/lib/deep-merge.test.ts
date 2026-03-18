import { describe, it, expect } from "bun:test";
import { deepMerge, isPlainObject } from "./deep-merge.ts";

describe("isPlainObject", () => {
  it("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe("deepMerge", () => {
  it("merges two flat objects, override wins on conflict", () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("recursively merges nested plain objects", () => {
    const base = { a: { x: 1, y: 2 } };
    const override = { a: { y: 99, z: 3 } };
    const result = deepMerge(base, override);
    expect(result).toEqual({ a: { x: 1, y: 99, z: 3 } });
  });

  it("replaces arrays entirely — does not concatenate", () => {
    const result = deepMerge({ arr: [1, 2, 3] }, { arr: [4, 5] });
    expect(result).toEqual({ arr: [4, 5] });
  });

  it("replaces array in base with object in override", () => {
    const result = deepMerge({ key: [1, 2] }, { key: { nested: true } });
    expect(result).toEqual({ key: { nested: true } });
  });

  it("replaces object in base with array in override", () => {
    const result = deepMerge({ key: { nested: true } }, { key: [1, 2] });
    expect(result).toEqual({ key: [1, 2] });
  });

  it("handles null values in override — replaces base value", () => {
    const result = deepMerge(
      { a: { x: 1 } },
      { a: null } as unknown as Record<string, unknown>,
    );
    expect(result).toEqual({ a: null });
  });

  it("handles null values in base — override wins", () => {
    const result = deepMerge(
      { a: null } as unknown as Record<string, unknown>,
      { a: { x: 1 } },
    );
    expect(result).toEqual({ a: { x: 1 } });
  });

  it("returns base unchanged when override is empty", () => {
    const result = deepMerge({ a: 1, b: { c: 2 } }, {});
    expect(result).toEqual({ a: 1, b: { c: 2 } });
  });

  it("returns override values when base is empty", () => {
    const result = deepMerge({}, { a: 1, b: { c: 2 } });
    expect(result).toEqual({ a: 1, b: { c: 2 } });
  });

  it("does not mutate the base object", () => {
    const base = { a: { x: 1 } };
    deepMerge(base, { a: { x: 99 } });
    expect(base).toEqual({ a: { x: 1 } });
  });

  it("handles deeply nested merge", () => {
    const base = { a: { b: { c: { d: 1, e: 2 } } } };
    const override = { a: { b: { c: { e: 99, f: 3 } } } };
    const result = deepMerge(base, override);
    expect(result).toEqual({ a: { b: { c: { d: 1, e: 99, f: 3 } } } });
  });
});
