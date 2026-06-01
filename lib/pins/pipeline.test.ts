import { describe, test, expect } from "bun:test";
import { validateLegacy } from "./pipeline.ts";
import { validate } from "./validator.ts";
import type { FrontmatterSchema } from "../../hooks/pin-up/types";

// Minimal valid legacy fixture — has `slug`, no `id`/`type` (raw legacy shape)
const LEGACY_FIXTURE: FrontmatterSchema = {
  slug: "linear-eng-1234",
  source_url: "https://linear.app/algocare/issue/ENG-1234",
  authority: "toong",
  tier: "2",
  tags: "backend,architecture",
  sensitivity: "shared",
  created_at: "2024-03-15T09:00:00Z",
  related: "notion-auth-doc",
};

describe("validateLegacy pipeline", () => {
  describe("compat precedes validation", () => {
    test("legacy fixture passes validation after pipeline", async () => {
      const result = await validateLegacy(LEGACY_FIXTURE);
      expect(result.valid).toBe(true);
    });

    test("raw legacy fails validate directly but passes through validateLegacy (compat ran first)", async () => {
      // Build the raw entity that bypasses compat — same fixture, no transformation
      const rawEntity = {
        frontmatter: LEGACY_FIXTURE as unknown as import("./types.ts").Entity["frontmatter"],
        body: "",
      };

      // Raw legacy must fail schema validation (no `type` field → unknown_type, or forbidden `slug`)
      const rawResult = await validate(rawEntity);
      expect(rawResult.valid).toBe(false);

      // The same fixture through validateLegacy (compat → validate) must pass
      const pipelineResult = await validateLegacy(LEGACY_FIXTURE);
      expect(pipelineResult.valid).toBe(true);
    });
  });

  describe("negative control: raw legacy rejected by validator directly", () => {
    test("feeding raw legacy directly to validate returns valid:false (forbidden field slug)", async () => {
      // Bypasses compat — raw legacy has `slug` which is a forbidden_axiom field
      const rawAsEntity = {
        frontmatter: LEGACY_FIXTURE as unknown as import("./types.ts").Entity["frontmatter"],
        body: "## 한 줄 요지\n본문",
      };
      const result = await validate(rawAsEntity);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        // Should fail either on unknown_type (no `type` field) or forbidden_field (has `slug`)
        expect(["unknown_type", "forbidden_field", "missing_field"]).toContain(result.reason);
      }
    });
  });
});
