import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getRootDir } from "../lib/config.ts";
import { extractAcRulesBlock, findAcRulesDrift } from "./ac-rules-ssot.ts";

describe("AC Quality Detail Rules SSOT 검증기", () => {
  test("`extractAcRulesBlock` returns the body between the heading and the next ## heading", () => {
    const md = [
      "# Title",
      "## AC Quality Detail Rules",
      "rule line 1",
      "rule line 2",
      "## Next Section",
      "other",
    ].join("\n");
    expect(extractAcRulesBlock(md)).toBe("rule line 1\nrule line 2");
  });

  test("`extractAcRulesBlock` returns null when the heading is absent", () => {
    expect(extractAcRulesBlock("# Title\n## Something Else\nbody")).toBeNull();
  });

  test("`extractAcRulesBlock` returns an empty string when the block body was deleted (heading immediately followed by the next ## heading)", () => {
    expect(extractAcRulesBlock("## AC Quality Detail Rules\n## Next")).toBe("");
  });

  test("`findAcRulesDrift` reports null when both source copies are byte-identical (current repo state)", () => {
    const rootDir = getRootDir();
    expect(rootDir).not.toBeNull();
    expect(findAcRulesDrift(rootDir as string)).toBeNull();
  });

  test("`findAcRulesDrift` flags whitespace-only blocks even when both copies are byte-identical", () => {
    // Deleting the rules from both files but leaving blank lines under the heading yields a
    // non-empty whitespace body (e.g. "\n"), which is byte-identical across the two copies and
    // would slip past the identity check. The empty guard must treat whitespace-only as empty.
    const root = mkdtempSync(join(tmpdir(), "ac-ssot-ws-"));
    try {
      mkdirSync(join(root, "agents"), { recursive: true });
      mkdirSync(join(root, "skills", "momus"), { recursive: true });
      const whitespaceOnly = "## AC Quality Detail Rules\n\n\n## Next\n";
      writeFileSync(join(root, "agents/metis.md"), whitespaceOnly);
      writeFileSync(join(root, "skills/momus/SKILL.md"), whitespaceOnly);
      expect(extractAcRulesBlock(whitespaceOnly)).not.toBe(""); // body is whitespace, not exactly ""
      expect(findAcRulesDrift(root)).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
