import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SKILL_MD = join(REPO_ROOT, "skills", "code-review", "SKILL.md");

// ---------------------------------------------------------------------------
// Regression guard: main-session interactive paths preserved when the
// {gate}-codereview-{sid}.json signal is absent.
//
// The non-interactive discriminator (Intent Block Gate) and the dispatch-payload
// parse-failure INCONCLUSIVE bridge (Agent Dispatch step) added signal-gated
// branches alongside the pre-existing main-session
// interactive paths in SKILL.md. This test pins
// that those additions stayed additive: the interactive rows/branches must
// still exist, and the new branches must remain conditional on the
// completion-gate signal rather than replacing or unconditionally triggering
// over them.
//
// These invariants are already satisfied by the current SKILL.md — this test
// is GREEN-from-start by design, not a manufactured RED. It exists to fail
// loudly if a future edit deletes the signal-absent branch, the
// Neither → BLOCK row, or makes the non-interactive row unconditional.
// ---------------------------------------------------------------------------

/**
 * Extract the markdown block between a `### <heading>` line (matched by
 * substring) and the next `##`/`###` heading, or end of file.
 */
function extractSection(content: string, headingMarker: string): string {
	const lines = content.split("\n");
	const startIndex = lines.findIndex((line) => line.includes(headingMarker));
	if (startIndex === -1) {
		throw new Error(
			`SKILL.md: could not locate heading marker "${headingMarker}". ` +
				"The section may have been renamed — update the parser in signal-gating.test.ts.",
		);
	}

	const sectionLines: string[] = [];
	for (let i = startIndex + 1; i < lines.length; i++) {
		if (/^#{2,6}\s/.test(lines[i])) break;
		sectionLines.push(lines[i]);
	}
	return sectionLines.join("\n");
}

/**
 * Extract state names (first column) from the Intent Block Gate table.
 * Skips the header row and the `|---|---|` separator row.
 */
function extractIntentGateStates(section: string): string[] {
	const states: string[] = [];
	for (const line of section.split("\n")) {
		if (!line.trim().startsWith("|")) continue;
		if (/^\|\s*-+\s*\|/.test(line.trim())) continue; // separator row
		if (/^\|\s*State\s*\|/.test(line.trim())) continue; // header row

		const firstCell = line.split("|")[1]?.trim() ?? "";
		// Strip markdown bold markers and the trailing " — description" text.
		const name = firstCell.replace(/\*\*/g, "").split("—")[0].trim();
		if (name.length > 0) states.push(name);
	}
	return states;
}

describe("code-review SKILL.md: 신호-게이팅 불변식 (regression guard: main-session paths preserved when completion-gate signal absent)", () => {
	const skillContent = readFileSync(SKILL_MD, "utf-8");

	describe("Step 0 Intent Block Gate: 메인세션 대화형 경로 보존", () => {
		const gateSection = extractSection(skillContent, "### Intent Block Gate");
		const states = extractIntentGateStates(gateSection);

		it("대화형 3-상태(Intent confirmed / User explicit deferral / Neither)가 모두 존재한다", () => {
			expect(states).toContain("Intent confirmed");
			expect(states).toContain("User explicit deferral");
			expect(states).toContain("Neither");
		});

		it("`Neither` 상태는 BLOCK으로 귀결된다 — 신호 부재시 이 경로로 도달한다", () => {
			const neitherRow = gateSection
				.split("\n")
				.find((line) => line.trim().startsWith("|") && line.includes("**Neither**"));

			expect(neitherRow).toBeDefined();
			expect(neitherRow).toContain("BLOCK");
		});

		it("`Non-interactive dispatch (completion-gate)` 행은 `{gate}-codereview-{sid}.json` discriminator에 조건부다 (무조건 대체가 아니다)", () => {
			expect(states).toContain("Non-interactive dispatch (completion-gate)");

			const nonInteractiveRow = gateSection
				.split("\n")
				.find(
					(line) =>
						line.trim().startsWith("|") &&
						line.includes("**Non-interactive dispatch (completion-gate)**"),
				);

			expect(nonInteractiveRow).toBeDefined();
			// Conditional: the row's own text ties the state to the dispatch
			// prompt carrying the artifact path — not an unconditional check.
			expect(nonInteractiveRow).toContain("the dispatch prompt itself carries a");
			expect(nonInteractiveRow).toContain("{gate}-codereview-{sid}.json");
		});

		it("신호 부재시 메인세션 대화형 게이트가 unchanged로 명시된다", () => {
			expect(gateSection).toContain("signal is absent");
			expect(gateSection).toContain("unchanged");
		});
	});

	describe("Agent Dispatch 페이로드 파싱과 정적 검토 계약", () => {
		it("concise Step 4 preserves named-field completion-gate parsing", () => {
			expect(skillContent).toContain("named-field completion-gate parsing");
		});

		it("리뷰 시작 전 build/test/lint 실행을 요구하는 Evidence Verification 게이트가 존재하지 않는다 (정적-전용 리뷰 불변식)", () => {
			expect(skillContent).not.toContain("Evidence Verification");
			expect(skillContent).not.toContain("{EVIDENCE_RESULTS}");
			expect(skillContent).not.toContain(
				"Run build, test, and lint checks BEFORE dispatching",
			);
		});
	});
});
