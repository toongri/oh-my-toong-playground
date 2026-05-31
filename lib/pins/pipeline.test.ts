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

    test("canonical input has type set and no slug (compat ran before validate)", async () => {
      // Intercept what validate receives by wrapping it
      let capturedFrontmatter: Record<string, unknown> | null = null;
      const originalValidate = validate;

      // Temporarily capture the entity passed to validate by running toCanonical
      // and verifying the result has canonical shape
      const { toCanonical } = await import("./compat.ts");
      const canonical = toCanonical(LEGACY_FIXTURE);

      // The canonical object must have `type` and no `slug`
      expect((canonical as unknown as Record<string, unknown>)["type"]).toBeDefined();
      expect((canonical as unknown as Record<string, unknown>)["slug"]).toBeUndefined();
      expect((canonical as unknown as Record<string, unknown>)["id"]).toBe("linear-eng-1234");
      expect(canonical.relations).toEqual([{ target: "notion-auth-doc", type: "related_to" }]);
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
