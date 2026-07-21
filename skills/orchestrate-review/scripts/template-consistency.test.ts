import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setGoalState, serializeReviewContext } from "../../ultragoal/scripts/ultragoal-state.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SKILL_MD = join(REPO_ROOT, "skills", "code-review", "SKILL.md");
const TEMPLATE_MD = join(
	REPO_ROOT,
	"skills",
	"orchestrate-review",
	"scripts",
	"chunk-reviewer-prompt.md",
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
		line.includes("Interpolate placeholders with context from"),
	);
	if (startIndex === -1) {
		throw new Error(
			"SKILL.md: Could not locate 'Interpolate placeholders with context from' marker in Step 5. " +
				"The section may have been renamed — update the parser in template-consistency.test.ts.",
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
	const headingIndex = lines.findIndex((line) => /^##\s+Field Reference/.test(line));
	if (headingIndex === -1) {
		throw new Error(
			"chunk-reviewer-prompt.md: Could not locate '## Field Reference' heading. " +
				"The section may have been renamed — update the parser in template-consistency.test.ts.",
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

/**
 * Extract the template body — everything ABOVE the "## Field Reference" heading — from
 * chunk-reviewer-prompt.md.
 *
 * This is the text actually interpolated and handed to the angle finder. The
 * Field Reference table below the heading is documentation about the body, not
 * body content itself, so a placeholder declared only in the table and never
 * substituted into the body never reaches the finder.
 */
function extractTemplateBody(content: string): string {
	const lines = content.split("\n");

	const headingIndex = lines.findIndex((line) => /^##\s+Field Reference/.test(line));
	if (headingIndex === -1) {
		throw new Error(
			"chunk-reviewer-prompt.md: Could not locate '## Field Reference' heading. " +
				"The section may have been renamed — update the parser in template-consistency.test.ts.",
		);
	}

	return lines.slice(0, headingIndex).join("\n");
}

describe("dispatch template body coverage", () => {
	it("every placeholder declared in the Field Reference table also appears in the template body", () => {
		// Arrange
		const templateContent = readFileSync(TEMPLATE_MD, "utf-8");
		const templatePlaceholders = extractTemplateFieldReferences(templateContent);
		const templateBody = extractTemplateBody(templateContent);

		// Guard: parser must not silently return empty set (format regression detection)
		expect(templatePlaceholders.size).toBeGreaterThan(0);

		// Act: find placeholders declared in the table but absent from the body actually
		// interpolated and sent to the angle finder
		const missingFromBody = [...templatePlaceholders].filter(
			(placeholder) => !templateBody.includes(placeholder),
		);

		// Assert
		expect(
			missingFromBody,
			`Declared in Field Reference table but MISSING from template body (never reaches the finder): ${missingFromBody.join(", ")}`,
		).toEqual([]);
	});
});

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
		const onlyInSkill = [...skillPlaceholders].filter((p) => !templatePlaceholders.has(p));
		const onlyInTemplate = [...templatePlaceholders].filter((p) => !skillPlaceholders.has(p));

		// Assert: sets must be equal
		const mismatchLines: string[] = [];
		if (onlyInSkill.length > 0) {
			mismatchLines.push(
				`Declared in SKILL.md Step 5 but MISSING from chunk-reviewer-prompt.md Field Reference: ${onlyInSkill.join(", ")}`,
			);
		}
		if (onlyInTemplate.length > 0) {
			mismatchLines.push(
				`Declared in chunk-reviewer-prompt.md Field Reference but MISSING from SKILL.md Step 5: ${onlyInTemplate.join(", ")}`,
			);
		}

		expect(mismatchLines.length).toBe(0);
	});
});

/**
 * Extract the JSON field names named by "JSON field `x`" bullets in SKILL.md Step 5.
 *
 * Of the nine placeholder bullets under "Interpolate placeholders", only the five intent
 * placeholders ({WHAT_WAS_IMPLEMENTED}/{DESCRIPTION}/{REQUIREMENTS}/{PROJECT_CONTEXT}/{NON_GOAL})
 * carry a "JSON field `x`" tag — the codebase-derived bullets ({FILE_LIST}/{DIFF_COMMAND}/
 * {COMMIT_HISTORY}/{EVIDENCE_RESULTS}) do not. The regex itself is the selector: only
 * matching lines contribute a name.
 *
 * Scoped to the "## Step 5" section (stops at the next level-2 heading) so a same-named
 * JSON field mentioned elsewhere in the file is never picked up by accident.
 */
function extractSkillJsonFieldBullets(content: string): Set<string> {
	const lines = content.split("\n");

	const startIndex = lines.findIndex((line) => /^##\s+Step 5:/.test(line));
	if (startIndex === -1) {
		throw new Error(
			"SKILL.md: Could not locate '## Step 5:' heading. " +
				"The section may have been renamed — update the parser in template-consistency.test.ts.",
		);
	}

	const fields = new Set<string>();
	for (let i = startIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^##\s/.test(line)) break; // next level-2 heading ends Step 5

		const match = line.match(/JSON field `([a-zA-Z_]+)`/);
		if (match) {
			fields.add(match[1]);
		}
	}

	return fields;
}

/**
 * Extract the field names from Step 5's summary sentence: "named fields
 * `a`/`b`/`c`/..." — the second, independent place the same five field names are spelled
 * out in prose. A drift where only the bullets or only this sentence gets updated is the
 * exact failure mode this parser exists to catch.
 */
function extractSkillNamedFieldsSummary(content: string): Set<string> {
	const match = content.match(/named fields ((?:`[a-zA-Z_]+`\/?)+)/);
	if (!match) {
		throw new Error(
			"SKILL.md: Could not locate the 'named fields `...`/`...`' summary sentence in Step 5. " +
				"The wording may have changed — update the parser in template-consistency.test.ts.",
		);
	}

	const fields = new Set<string>();
	const tokenRegex = /`([a-zA-Z_]+)`/g;
	let tokenMatch: RegExpExecArray | null;
	while ((tokenMatch = tokenRegex.exec(match[1])) !== null) {
		fields.add(tokenMatch[1]);
	}

	return fields;
}

describe("dispatch JSON-field binding (SKILL.md Step 5 <-> serializeReviewContext)", () => {
	// This binding today lives only in prose: Step 5's bullets and summary sentence name the
	// JSON field keys a completion-gate dispatch payload must carry, but nothing checks that
	// those names still match the keys serializeReviewContext() actually emits. Renaming a
	// field on either side silently breaks completion-gate dispatch without failing any test.
	let tmpDir: string;
	const originalOmtDir = process.env.OMT_DIR;
	const originalSessionId = process.env.OMT_SESSION_ID;
	const SESSION_ID = "template-consistency-json-field-binding-test";

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "template-consistency-json-field-test-"));
		process.env.OMT_DIR = tmpDir;
		process.env.OMT_SESSION_ID = SESSION_ID;
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		if (originalOmtDir !== undefined) {
			process.env.OMT_DIR = originalOmtDir;
		} else {
			delete process.env.OMT_DIR;
		}
		if (originalSessionId !== undefined) {
			process.env.OMT_SESSION_ID = originalSessionId;
		} else {
			delete process.env.OMT_SESSION_ID;
		}
	});

	it("bullet JSON field names, the summary sentence's field list, and serializeReviewContext's actual output keys are exactly the same set", () => {
		// Arrange: parse SKILL.md's two prose listings
		const skillContent = readFileSync(SKILL_MD, "utf-8");
		const bulletFields = extractSkillJsonFieldBullets(skillContent);
		const summaryFields = extractSkillNamedFieldsSummary(skillContent);

		// Guard: parsers must not silently return empty sets (format regression detection)
		expect(bulletFields.size).toBeGreaterThan(0);
		expect(summaryFields.size).toBeGreaterThan(0);

		// Act: get the real contract keys by calling the function and reading Object.keys() —
		// never a hardcoded array, so a rename on the code side breaks this test too.
		setGoalState(SESSION_ID, { phase: "planning" });
		const actualKeys = new Set(Object.keys(serializeReviewContext(SESSION_ID)));

		const sortedBullets = [...bulletFields].sort();
		const sortedSummary = [...summaryFields].sort();
		const sortedActual = [...actualKeys].sort();

		// Assert (1): the bullets and the summary sentence must agree with each other —
		// one prose spot getting updated without the other is a real drift mode.
		expect(
			sortedSummary,
			`Step 5 summary sentence field list drifted from the per-field bullet list. ` +
				`bullets=[${sortedBullets.join(", ")}] summary=[${sortedSummary.join(", ")}]`,
		).toEqual(sortedBullets);

		// Assert (2): the prose field names must exactly match serializeReviewContext's
		// actual output keys — bidirectional, not toContain/subset, per the asymmetric gap
		// this test closes.
		expect(
			sortedBullets,
			`SKILL.md Step 5 JSON field names do not match serializeReviewContext's actual output keys. ` +
				`skill=[${sortedBullets.join(", ")}] actual=[${sortedActual.join(", ")}]`,
		).toEqual(sortedActual);
	});
});
