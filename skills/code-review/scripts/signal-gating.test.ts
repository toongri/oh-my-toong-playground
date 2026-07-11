import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const SKILL_MD = join(REPO_ROOT, "skills", "code-review", "SKILL.md");

// ---------------------------------------------------------------------------
// Regression guard: main-session interactive paths preserved when the
// goal-codereview-{sid}.json signal is absent.
//
// T4 (Step 0 non-interactive discriminator, commit 027fd492) and T5 (Step 3
// INCONCLUSIVE bridge, commit c2f10630) added signal-gated branches alongside
// the pre-existing main-session interactive paths in SKILL.md. This test pins
// that those additions stayed additive: the interactive rows/branches must
// still exist, and the new branches must remain conditional on the goal
// signal rather than replacing or unconditionally triggering over them.
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

describe("code-review SKILL.md: 신호-게이팅 불변식 (regression guard: main-session paths preserved when goal signal absent)", () => {
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

		it("`Non-interactive dispatch (goal)` 행은 `goal-codereview-{sid}.json` discriminator에 조건부다 (무조건 대체가 아니다)", () => {
			expect(states).toContain("Non-interactive dispatch (goal)");

			const nonInteractiveRow = gateSection
				.split("\n")
				.find(
					(line) =>
						line.trim().startsWith("|") &&
						line.includes("**Non-interactive dispatch (goal)**"),
				);

			expect(nonInteractiveRow).toBeDefined();
			// Conditional: the row's own text ties the state to the dispatch
			// prompt carrying the artifact path — not an unconditional check.
			expect(nonInteractiveRow).toContain("the dispatch prompt itself carries a");
			expect(nonInteractiveRow).toContain("goal-codereview-{sid}.json");
		});

		it("신호 부재시 메인세션 대화형 게이트가 unchanged로 명시된다", () => {
			expect(gateSection).toContain("signal is absent");
			expect(gateSection).toContain("unchanged");
		});
	});

	describe("Step 3 Fail-Fast Gate: signal-present/signal-absent 양 브랜치가 하나의 exit로 수렴", () => {
		const gateSection = extractSection(skillContent, "### Fail-Fast Gate");
		const numberedLines = gateSection
			.split("\n")
			.filter((line) => /^\d+\.\s/.test(line.trim()))
			.map((line) => line.trim());

		it("signal-present 브랜치가 존재하고 INCONCLUSIVE 아티팩트를 기록한다", () => {
			const presentLine = numberedLines.find((line) =>
				line.includes("Goal dispatch signal present"),
			);

			expect(presentLine).toBeDefined();
			expect(presentLine).toContain("INCONCLUSIVE");
		});

		it("signal-absent 브랜치가 존재하고 아티팩트를 기록하지 않는다 — 메인세션은 INCONCLUSIVE write 안 함", () => {
			const absentLine = numberedLines.find((line) =>
				line.includes("Goal dispatch signal absent"),
			);

			expect(absentLine).toBeDefined();
			expect(absentLine).toContain("no artifact write");
			expect(absentLine).not.toContain("INCONCLUSIVE");
		});

		it("양 브랜치가 단일 'Report ... and exit' 단계로 수렴한다 (분기별 중복 없음)", () => {
			const reportLines = numberedLines.filter((line) =>
				/Report \{EVIDENCE_RESULTS\} and exit immediately/.test(line),
			);

			expect(reportLines.length).toBe(1);
		});
	});
});
