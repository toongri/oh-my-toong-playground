import { describe, expect, test } from "bun:test";
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
});
