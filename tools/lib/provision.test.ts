import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProvision } from "./provision.ts";
import type { ProvisionItem } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "provision-test-"));
}

// Write a marker file at <dir>/<name> with given content
function markerPath(dir: string, name: string): string {
  return path.join(dir, name);
}

function markerExists(dir: string, name: string): boolean {
  return fs.existsSync(markerPath(dir, name));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runProvision", () => {
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

  it("(a) check exits 0 — commands NOT run", () => {
    const dir = mktemp();
    tmpdirs.push(dir);

    // check: true (always exits 0) → commands should NOT run
    const item: ProvisionItem = {
      check: "true",
      commands: [`touch ${markerPath(dir, "ran.txt")}`],
    };

    runProvision([item], [dir], { dryRun: false });

    expect(markerExists(dir, "ran.txt")).toBe(false);
  });

  it("(b) check exits non-zero — commands run", () => {
    const dir = mktemp();
    tmpdirs.push(dir);

    // check: false (always exits 1) → commands SHOULD run
    const item: ProvisionItem = {
      check: "false",
      commands: [`touch ${markerPath(dir, "ran.txt")}`],
    };

    runProvision([item], [dir], { dryRun: false });

    expect(markerExists(dir, "ran.txt")).toBe(true);
  });

  it("(c) no check — commands run", () => {
    const dir = mktemp();
    tmpdirs.push(dir);

    const item: ProvisionItem = {
      commands: [`touch ${markerPath(dir, "ran.txt")}`],
    };

    runProvision([item], [dir], { dryRun: false });

    expect(markerExists(dir, "ran.txt")).toBe(true);
  });

  it("(d) dryRun — nothing executed (only logs)", () => {
    const dir = mktemp();
    tmpdirs.push(dir);

    const item: ProvisionItem = {
      commands: [`touch ${markerPath(dir, "ran.txt")}`],
    };

    runProvision([item], [dir], { dryRun: true });

    // File must NOT have been created
    expect(markerExists(dir, "ran.txt")).toBe(false);
  });

  it("(e) non-existent target dir — skipped", () => {
    const nonExistent = path.join(os.tmpdir(), "provision-noexist-" + Math.random().toString(36).slice(2));

    // Should not throw; simply skip
    let threw = false;
    try {
      runProvision(
        [{ commands: ["true"] }],
        [nonExistent],
        { dryRun: false },
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
  });

  it("(f) multiple items run in order", () => {
    const dir = mktemp();
    tmpdirs.push(dir);

    // Item 0: write "0" to order.txt
    // Item 1: append "1" to order.txt
    // If order is wrong, content would be "10" instead of "01"
    const items: ProvisionItem[] = [
      { commands: [`printf '0' > ${markerPath(dir, "order.txt")}`] },
      { commands: [`printf '1' >> ${markerPath(dir, "order.txt")}`] },
    ];

    runProvision(items, [dir], { dryRun: false });

    const content = fs.readFileSync(markerPath(dir, "order.txt"), "utf8");
    expect(content).toBe("01");
  });
});
