/**
 * validate-plan.ts
 *
 * Deterministic section-presence validator for prometheus plans.
 * Checks that the 7 always-required plan sections exist as level-2 headings
 * with non-empty bodies. This is a cheap PRESENCE pre-filter, not a quality gate.
 *
 * Usage: bun skills/prometheus/scripts/validate-plan.ts <plan_path>
 * Exit 0 = all sections present and non-empty.
 * Exit 1 = one or more sections missing or empty (offending literals printed to stdout).
 */

export const REQUIRED_HEADINGS: string[] = [
  'TL;DR',
  'Context',
  'Work Objectives',
  'TODOs',
  'Execution Strategy',
  'Verification Strategy',
  'Success Criteria',
];

/**
 * Strip fenced code blocks (``` ... ```) from markdown content.
 * This prevents headings inside fences from being counted.
 */
function stripFences(content: string): string {
  return content.replace(/^```[\s\S]*?^```/gm, '');
}

/**
 * Validate a plan's text for section presence and non-emptiness.
 *
 * Rules:
 * (a) Fenced code blocks are stripped before scanning.
 * (b) A heading matches exactly `## <literal>` (level-2, case-sensitive, no extra text).
 * (c) Duplicate headings: first occurrence wins.
 * (d) Non-empty = body between this heading and the next ## heading has trimmed length > 0.
 *
 * @returns Array of heading literals that are missing or empty.
 */
export function validatePlan(content: string): string[] {
  const stripped = stripFences(content);

  // Parse the heading line regex: exactly ## <literal> (optional trailing whitespace)
  const headingRegex = /^##[ \t]+(.+?)[ \t]*$/gm;

  // Collect first-occurrence positions of level-2 headings
  const headingPositions: Array<{ literal: string; bodyStart: number }> = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(stripped)) !== null) {
    const literal = match[1];
    if (!seen.has(literal)) {
      seen.add(literal);
      headingPositions.push({
        literal,
        bodyStart: match.index + match[0].length,
      });
    }
  }

  const missing: string[] = [];

  for (const required of REQUIRED_HEADINGS) {
    const entry = headingPositions.find((h) => h.literal === required);

    if (entry === undefined) {
      // Heading not found at all
      missing.push(required);
      continue;
    }

    // Find the start of the next ## heading after this one
    const nextHeadingMatch = /^##[ \t]+/m.exec(stripped.slice(entry.bodyStart));
    const bodyEnd =
      nextHeadingMatch !== null
        ? entry.bodyStart + nextHeadingMatch.index
        : stripped.length;

    const body = stripped.slice(entry.bodyStart, bodyEnd).trim();

    if (body.length === 0) {
      missing.push(required);
    }
  }

  return missing;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error('Usage: bun validate-plan.ts <plan_path>');
    process.exit(2);
  }

  const { readFileSync } = await import('fs');
  const content = readFileSync(planPath, 'utf8');
  const missing = validatePlan(content);

  if (missing.length > 0) {
    for (const h of missing) {
      console.log(h);
    }
    process.exit(1);
  }

  process.exit(0);
}
