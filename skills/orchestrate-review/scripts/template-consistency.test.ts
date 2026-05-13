import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SKILL_MD = join(REPO_ROOT, "skills", "code-review", "SKILL.md");
const TEMPLATE_MD = join(
  REPO_ROOT,
  "skills",
  "orchestrate-review",
  "scripts",
  "chunk-reviewer-prompt.md"
);

/**
 * Extract placeholder names from SKILL.md Step 5's "Interpolate placeholders" bullet list.
 *
 * The block starts at the line containing "Interpolate placeholders with context from"
 * and ends at the next line beginning with "##" or "###" (or the next numbered list item
 * that is not a placeholder bullet).
 *
 * Bullet format: `   - {NAME} ←`
 */
function extractSkillPlaceholders(content: string): Set<string> {
  const lines = content.split("\n");

  // Find the line index that starts the placeholder block
  const startIndex = lines.findIndex((line) =>
    line.includes("Interpolate placeholders with context from")
  );
  if (startIndex === -1) {
    throw new Error(
      "SKILL.md: Could not locate 'Interpolate placeholders with context from' marker in Step 5. " +
        "The section may have been renamed — update the parser in template-consistency.test.ts."
    );
  }

  const placeholders = new Set<string>();

  // Scan forward from the start marker until we hit the next heading or numbered step
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop at the next heading (## or ###) or at the next top-level numbered step
    if (/^#{1,6}\s/.test(line)) break;
    // Stop when we hit the closing step line (e.g. "3. Dispatch ...")
    if (/^\d+\.\s/.test(line)) break;

    // Match bullet lines: optional spaces + "- {NAME} ←"
    const match = line.match(/^\s+-\s+(\{[A-Z_]+\})\s+←/);
    if (match) {
      placeholders.add(match[1]);
    }
  }

  return placeholders;
}

/**
 * Extract placeholder names from the "## Field Reference" table in chunk-reviewer-prompt.md.
 *
 * Table format:
 *   | {NAME} | ... |
 *
 * Only rows whose first column is a `{PLACEHOLDER}` token are extracted (skips the header row).
 */
function extractTemplateFieldReferences(content: string): Set<string> {
  const lines = content.split("\n");

  // Find the "## Field Reference" heading
  const headingIndex = lines.findIndex((line) =>
    /^##\s+Field Reference/.test(line)
  );
  if (headingIndex === -1) {
    throw new Error(
      "chunk-reviewer-prompt.md: Could not locate '## Field Reference' heading. " +
        "The section may have been renamed — update the parser in template-consistency.test.ts."
    );
  }

  const placeholders = new Set<string>();

  // Scan forward from the heading until the next top-level heading or end of file
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // Stop at the next heading of the same or higher level
    if (/^#{1,2}\s/.test(line)) break;

    // Match table rows whose first column is {PLACEHOLDER}
    // Format: | {NAME} | ... |
    const match = line.match(/^\|\s*(\{[A-Z_]+\})\s*\|/);
    if (match) {
      placeholders.add(match[1]);
    }
  }

  return placeholders;
}

describe("dispatch template placeholder consistency", () => {
  it("SKILL.md Step 5 and chunk-reviewer-prompt.md Field Reference declare the same placeholder set", () => {
    // Arrange
    const skillContent = readFileSync(SKILL_MD, "utf-8");
    const templateContent = readFileSync(TEMPLATE_MD, "utf-8");

    const skillPlaceholders = extractSkillPlaceholders(skillContent);
    const templatePlaceholders = extractTemplateFieldReferences(templateContent);

    // Guard: parsers must not silently return empty sets (format regression detection)
    expect(skillPlaceholders.size).toBeGreaterThan(0);
    expect(templatePlaceholders.size).toBeGreaterThan(0);

    // Act: compute symmetric difference
    const onlyInSkill = [...skillPlaceholders].filter(
      (p) => !templatePlaceholders.has(p)
    );
    const onlyInTemplate = [...templatePlaceholders].filter(
      (p) => !skillPlaceholders.has(p)
    );

    // Assert: sets must be equal
    const mismatchLines: string[] = [];
    if (onlyInSkill.length > 0) {
      mismatchLines.push(
        `Declared in SKILL.md Step 5 but MISSING from chunk-reviewer-prompt.md Field Reference: ${onlyInSkill.join(", ")}`
      );
    }
    if (onlyInTemplate.length > 0) {
      mismatchLines.push(
        `Declared in chunk-reviewer-prompt.md Field Reference but MISSING from SKILL.md Step 5: ${onlyInTemplate.join(", ")}`
      );
    }

    expect(mismatchLines.length).toBe(0);
  });
});
