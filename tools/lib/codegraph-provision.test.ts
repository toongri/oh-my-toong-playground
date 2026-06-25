import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planCodegraphInit } from "./codegraph-provision.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cg-provision-test-"));
}

// ---------------------------------------------------------------------------
// planCodegraphInit — guard logic tests
// ---------------------------------------------------------------------------

describe("planCodegraphInit", () => {
  const tmpdirs: string[] = [];

  afterEach(() => {
    for (const d of tmpdirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it("includes a plain existing repo directory", () => {
    const dir = mktemp();
    tmpdirs.push(dir);

    const result = planCodegraphInit([dir]);

    expect(result).toEqual([dir]);
  });

  it("excludes a directory that does not exist", () => {
    const dir = path.join(os.tmpdir(), "cg-nonexistent-" + Math.random().toString(36).slice(2));

    const result = planCodegraphInit([dir]);

    expect(result).toEqual([]);
  });

  it("excludes a path that is a file, not a directory", () => {
    const dir = mktemp();
    tmpdirs.push(dir);
    const filePath = path.join(dir, "somefile.txt");
    fs.writeFileSync(filePath, "content");

    const result = planCodegraphInit([filePath]);

    expect(result).toEqual([]);
  });

  it("excludes os.homedir()", () => {
    const result = planCodegraphInit([os.homedir()]);

    expect(result).toEqual([]);
  });

  it("excludes '/'", () => {
    const result = planCodegraphInit(["/"]);

    expect(result).toEqual([]);
  });

  it("excludes a directory containing tools/sync.ts (the OMT harness repo)", () => {
    const dir = mktemp();
    tmpdirs.push(dir);
    // Create the tools/sync.ts sentinel file
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tools", "sync.ts"), "// harness");

    const result = planCodegraphInit([dir]);

    expect(result).toEqual([]);
  });

  it("excludes a directory that already has .codegraph/codegraph.db", () => {
    const dir = mktemp();
    tmpdirs.push(dir);
    // Create the .codegraph/codegraph.db sentinel
    fs.mkdirSync(path.join(dir, ".codegraph"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".codegraph", "codegraph.db"), "");

    const result = planCodegraphInit([dir]);

    expect(result).toEqual([]);
  });

  it("returns only the eligible dirs when mixed with excluded ones", () => {
    const good = mktemp();
    tmpdirs.push(good);

    const harness = mktemp();
    tmpdirs.push(harness);
    fs.mkdirSync(path.join(harness, "tools"), { recursive: true });
    fs.writeFileSync(path.join(harness, "tools", "sync.ts"), "// harness");

    const indexed = mktemp();
    tmpdirs.push(indexed);
    fs.mkdirSync(path.join(indexed, ".codegraph"), { recursive: true });
    fs.writeFileSync(path.join(indexed, ".codegraph", "codegraph.db"), "");

    const result = planCodegraphInit([good, harness, indexed, os.homedir(), "/"]);

    expect(result).toEqual([good]);
  });
});
