import { toCanonical } from "./compat.ts";
import { validate } from "./validator.ts";
import type { ValidationResult } from "./validator.ts";
import type { FrontmatterSchema } from "../../hooks/pin-up/types";
import type { Entity, Frontmatter } from "./types.ts";

/**
 * Compat-then-validate pipeline.
 *
 * Translates a raw legacy frontmatter record to canonical shape via toCanonical,
 * then validates the result. The validator NEVER receives raw legacy input.
 *
 * Precondition: input is a FrontmatterSchema (legacy slug-keyed shape).
 * Postcondition: returned ValidationResult reflects validity of the canonical entity.
 */
export async function validateLegacy(
  rawLegacy: FrontmatterSchema
): Promise<ValidationResult> {
  const canonical = toCanonical(rawLegacy);

  // Wrap in Entity shape for the validator.
  // Lifecycle fields (status/updated_at/checked_at) are not in required_axiom
  // so their absence does not cause validation failure (see tbox.yaml rationale).
  const entity: Entity = {
    frontmatter: canonical as unknown as Frontmatter,
    body: "",
  };

  return validate(entity);
}
