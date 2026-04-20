import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const VALIDATOR_SCRIPT = path.join(import.meta.dir, "validate-cross-skill.ts");

/**
 * Run the validate-cross-skill.ts script and return exit code + output.
 */
function runValidator(): { exitCode: number; output: string } {
  const result = spawnSync("bun", [VALIDATOR_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return {
    exitCode: result.status ?? 1,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Positive fixture: current repo is symmetric
// ---------------------------------------------------------------------------

describe("validate-cross-skill", () => {
  describe("positive fixture — current repo is in symmetric state", () => {
    it("exits 0 when rubric/examiner/consumers are in sync", () => {
      const { exitCode } = runValidator();
      expect(exitCode).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Drift-injection negative: rename final_verdict in examiner → exit non-zero
  // -------------------------------------------------------------------------

  describe("drift-injection negative fixture — final_verdict renamed in examiner", () => {
    const EXAMINER_PATH = path.join(REPO_ROOT, "agents", "tech-claim-examiner.md");
    let originalContent: string;

    beforeEach(async () => {
      originalContent = await fs.readFile(EXAMINER_PATH, "utf8");
      // Rename all occurrences to simulate drift
      const drifted = originalContent.replaceAll("final_verdict", "final_verd");
      await fs.writeFile(EXAMINER_PATH, drifted, "utf8");
    });

    afterEach(async () => {
      // Restore original
      await fs.writeFile(EXAMINER_PATH, originalContent, "utf8");
    });

    it("exits non-zero when final_verdict is absent from examiner", () => {
      const { exitCode, output } = runValidator();
      expect(exitCode).not.toBe(0);
      expect(output.toLowerCase()).toMatch(/final_verdict|asymmetry|drift/);
    });
  });

  // -------------------------------------------------------------------------
  // Examiner strict-bar regression: A1 PASS criterion must be "5 of 5"
  // -------------------------------------------------------------------------

  describe("examiner A1 strict-bar regression — PASS criterion must be 5 of 5", () => {
    const EXAMINER_PATH = path.join(REPO_ROOT, "agents", "tech-claim-examiner.md");
    let originalContent: string;

    beforeEach(async () => {
      originalContent = await fs.readFile(EXAMINER_PATH, "utf8");
    });

    afterEach(async () => {
      // Restore original
      await fs.writeFile(EXAMINER_PATH, originalContent, "utf8");
    });

    it("exits 0 when examiner.md contains the canonical 5 of 5 PASS criterion", () => {
      // Positive: current repo should already satisfy this
      const { exitCode } = runValidator();
      expect(exitCode).toBe(0);
    });

    it("exits non-zero and reports drift when A1 PASS criterion is weakened to 2개 이상", async () => {
      // Negative: replace the strict 5/5 bar with a weaker "Signal 2개 이상" pattern
      // to simulate a v3 regression where the threshold was lowered.
      const weakened = originalContent
        .replace(/\*\*PASS\*\*:\s*Signal\s+5\s+of\s+5/g, "**PASS**: Signal 2개 이상")
        .replace(/ALL\s+5\s+of\s+5/g, "2개 이상");
      await fs.writeFile(EXAMINER_PATH, weakened, "utf8");

      const { exitCode, output } = runValidator();
      expect(exitCode).not.toBe(0);
      expect(output).toMatch(/A1 PASS criterion|5\/5|strict bar|drift/i);
    });
  });
});
