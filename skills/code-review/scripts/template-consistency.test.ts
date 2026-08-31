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
	"code-review",
	"scripts",
	"chunk-reviewer-prompt.md",
);
const COMPLETION_GATE_MD = join(REPO_ROOT, "skills", "ultragoal", "references", "completion-gate.md");

/** Extract placeholder names from Step 4's concise interpolation sentence. */
function extractSkillPlaceholders(content: string): Set<string> {
	const interpolationLine = content
		.split("\n")
		.find((line) => line.includes("interpolate the existing inputs:"));
	if (!interpolationLine) {
		throw new Error(
			"SKILL.md: Could not locate the concise interpolation sentence in Step 4. " +
				"The section may have been renamed — update the parser in template-consistency.test.ts.",
		);
	}

	const placeholders = new Set<string>();
	for (const match of interpolationLine.matchAll(/\{[A-Z_]+\}/g)) {
		placeholders.add(match[0]);
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
	it("SKILL.md Step 4 and chunk-reviewer-prompt.md Field Reference declare the same placeholder set", () => {
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
				`Declared in SKILL.md Step 4 but MISSING from chunk-reviewer-prompt.md Field Reference: ${onlyInSkill.join(", ")}`,
			);
		}
		if (onlyInTemplate.length > 0) {
			mismatchLines.push(
				`Declared in chunk-reviewer-prompt.md Field Reference but MISSING from SKILL.md Step 4: ${onlyInTemplate.join(", ")}`,
			);
		}

		expect(mismatchLines.length).toBe(0);
	});
});

/** Extract the canonical five-slot payload fields from the completion-gate reference. */
function extractCompletionGatePayloadFields(content: string): Set<string> {
	const payload = content.match(/5-slot payload `?\{([^}]+)\}/)?.[1];
	if (!payload) throw new Error("completion-gate reference payload marker missing");
	return new Set(payload.match(/[a-z_]+/g) ?? []);
}

describe("dispatch JSON-field binding (completion-gate reference <-> serializeReviewContext)", () => {
	// The completion-gate reference is the payload source of truth; this detects drift against
	// the keys serializeReviewContext() actually emits.
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

	it("completion-gate payload keys and serializeReviewContext's actual output keys are exactly the same set", () => {
		// Arrange: parse the completion-gate reference's canonical five-slot payload
		const completionGate = readFileSync(COMPLETION_GATE_MD, "utf-8");
		const payloadFields = extractCompletionGatePayloadFields(completionGate);

		// Guard: parsers must not silently return empty sets (format regression detection)
		expect(payloadFields.size).toBe(5);

		// Act: get the real contract keys by calling the function and reading Object.keys() —
		// never a hardcoded array, so a rename on the code side breaks this test too.
		setGoalState(SESSION_ID, { phase: "planning" });
		const actualKeys = new Set(Object.keys(serializeReviewContext(SESSION_ID)));

		const sortedPayload = [...payloadFields].sort();
		const sortedActual = [...actualKeys].sort();
		expect(
			sortedPayload,
			`completion-gate payload keys do not match serializeReviewContext's actual output keys. ` +
				`payload=[${sortedPayload.join(", ")}] actual=[${sortedActual.join(", ")}]`,
		).toEqual(sortedActual);
	});
});

const CODE_REVIEW_DIR = join(REPO_ROOT, "skills", "code-review");
const MEMBER_ROLE_PROMPTS = [
	"correctness",
	"regression",
	"cleanup",
	"requirement",
	"default",
] as const;
const MEMBER_PROMPT_DIR = join(CODE_REVIEW_DIR, "scripts", "prompts");
const CODE_REVIEW_CONFIG = join(CODE_REVIEW_DIR, "code-review.config.yaml");

function expectStaticReviewOnlyContract(content: string, fixture: string): void {
	expect(
		content,
		`${fixture} must state the recognizable STATIC REVIEW ONLY contract.`,
	).toMatch(/\bSTATIC REVIEW ONLY\b/i);
}

describe("정적 리뷰와 Test value 책임 경계 계약", () => {
	it("`all member prompts declare STATIC REVIEW ONLY`", () => {
		// Keep this list explicit: adding a member prompt without the contract must fail.
		for (const member of MEMBER_ROLE_PROMPTS) {
			const fixture = `scripts/prompts/${member}.md`;
			expectStaticReviewOnlyContract(
				readFileSync(join(MEMBER_PROMPT_DIR, `${member}.md`), "utf-8"),
				fixture,
			);
		}
	});

	it("`cleanup owns one light-touch Test value lens with the approved categories`", () => {
		const cleanup = readFileSync(join(MEMBER_PROMPT_DIR, "cleanup.md"), "utf-8");
		const testValueHeadings = cleanup.match(/^#{1,6}\s+Test value\b/gim) ?? [];

		expect(testValueHeadings, "cleanup must own exactly one Test value lens.").toHaveLength(1);
		expect(cleanup).toMatch(/false confidence|fake coverage/i);
		expect(cleanup).toMatch(/verification value/i);
		expect(cleanup).toMatch(/feedback[- ]loop cost/i);
		expect(cleanup).toMatch(/implementation[- ]coupled|unstable tests?/i);
	});

	it("`requirement remains pure AC mapping while preserving implementation-or-test evidence`", () => {
		const requirement = readFileSync(join(MEMBER_PROMPT_DIR, "requirement.md"), "utf-8");

		expect(requirement).not.toMatch(/^#{1,6}\s+Test quality\b/im);
		expect(requirement).not.toMatch(/test-quality issues?/i);
		expect(requirement).toContain("implements and/or tests it");
	});

	it("`the dispatch fallback and configuration synchronize the static-only responsibility split`", () => {
		const dispatchFallback = readFileSync(join(MEMBER_PROMPT_DIR, "default.md"), "utf-8");
		const config = readFileSync(CODE_REVIEW_CONFIG, "utf-8");

		for (const [fixture, content] of [
			["scripts/prompts/default.md", dispatchFallback],
			["code-review.config.yaml", config],
		] as const) {
			expectStaticReviewOnlyContract(content, fixture);
			expect(content, `${fixture} must assign Test value to cleanup.`).toMatch(
				/cleanup[^\n]{0,160}Test value|Test value[^\n]{0,160}cleanup/i,
			);
			expect(content, `${fixture} must keep requirement focused on AC mapping.`).toMatch(
				/requirement[^\n]{0,160}(AC mapping|acceptance criteria)|(AC mapping|acceptance criteria)[^\n]{0,160}requirement/i,
			);
		}
	});
});
