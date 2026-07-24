/**
 * Tests for sortCandidates / compareCandidates in ordering.ts.
 *
 * `.codex/rules` file-for-file replaces `.claude/rules` (see finder.ts's
 * conditional supersede), so it must inherit that source's SOURCE_PRIORITY
 * rank, not the next unused number. A project carrying `.github/instructions`
 * (rank 3) must NOT push `.codex/rules` behind it — before the replacement,
 * `.claude/rules` (rank 1) always sorted ahead of `.github/instructions`.
 *
 * The same conditional-supersede relationship holds at home scope
 * (`~/.codex/rules` replaces `~/.claude/rules`), so it must carry the same
 * rank there too — `~/.claude/rules` at 102 and `~/.codex/rules` left at 103
 * was the promotion applied to project scope but not home scope.
 */
import { expect, test } from "bun:test";
import { sortCandidates } from "./ordering.js";
import { SOURCE_PRIORITY } from "./constants.js";
import type { RuleCandidate } from "./types.js";

function candidate(source: RuleCandidate["source"], relativePath: string): RuleCandidate {
	return {
		path: `/proj/${relativePath}`,
		realPath: `/proj/${relativePath}`,
		source,
		distance: 0,
		isGlobal: false,
		isSingleFile: false,
		relativePath,
	};
}

function globalCandidate(source: RuleCandidate["source"], relativePath: string): RuleCandidate {
	return {
		path: `/home/user/${relativePath}`,
		realPath: `/home/user/${relativePath}`,
		source,
		distance: 9999,
		isGlobal: true,
		isSingleFile: false,
		relativePath,
	};
}

test("`sortCandidates`: `.codex/rules` sorts before `.github/instructions` at equal distance", () => {
	const candidates = [
		candidate(".github/instructions", ".github/instructions/a.md"),
		candidate(".codex/rules", ".codex/rules/a.md"),
	];

	const sorted = sortCandidates(candidates);

	expect(sorted.map((c) => c.source)).toEqual([".codex/rules", ".github/instructions"]);
});

test("SOURCE_PRIORITY: `~/.claude/rules` and `~/.codex/rules` carry the same home-scope rank (parity with the project-scope supersede promotion)", () => {
	expect(SOURCE_PRIORITY.get("~/.codex/rules")).toBe(SOURCE_PRIORITY.get("~/.claude/rules"));
});

test("`sortCandidates`: at equal (global) distance, `~/.claude/rules` and `~/.codex/rules` tie on rank and fall through to relativePath ordering", () => {
	// Given out of source-priority order, a leftover rank gap (as before the
	// fix, where `~/.codex/rules` sat one rank behind `~/.claude/rules`) would
	// deterministically sort `~/.claude/rules` first regardless of
	// relativePath. With equal rank, the tie-break falls through to
	// relativePath — "a.md" sorts before "b.md" — proving the two sources are
	// no longer distinguished by rank at home scope.
	const candidates = [
		globalCandidate("~/.claude/rules", "b.md"),
		globalCandidate("~/.codex/rules", "a.md"),
	];

	const sorted = sortCandidates(candidates);

	expect(sorted.map((c) => c.source)).toEqual(["~/.codex/rules", "~/.claude/rules"]);
});
