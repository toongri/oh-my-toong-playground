/**
 * Tests for C2: path-only `- [name]{path}` transcript reference must NOT suppress a rule
 * whose body has never been delivered.
 *
 * isRuleAlreadyInTranscript is private; tests drive it via the public
 * filterRulesNotInTranscriptText.
 */
import { test, expect } from "bun:test";
import { filterRulesNotInTranscriptText } from "./transcript-rule-filter.js";
import { ruleMarkerLine } from "./rules/index.js";
import type { LoadedRule } from "./rules/index.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<LoadedRule> = {}): LoadedRule {
	return {
		path: "/repo/.claude/rules/coding-discipline.md",
		realPath: "/repo/.claude/rules/coding-discipline.md",
		relativePath: ".claude/rules/coding-discipline.md",
		source: ".claude/rules",
		distance: 9999,
		isGlobal: true,
		isSingleFile: false,
		frontmatter: {},
		body: "# Coding Discipline\n\nDo not touch anything you must not touch.",
		contentHash: "abc123",
		matchReason: "alwaysApply",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// C2: path-only native reference does NOT suppress a rule whose body is absent
// ---------------------------------------------------------------------------

test("C2: native path-only reference `- [name]{path}` does not suppress rule when body absent", () => {
	const rule = makeRule();
	// Transcript contains Claude Code's native rule-reference list entry
	// but NOT the rule's body or a hash marker.
	const transcriptText = [
		"Some prior conversation.",
		"",
		"- [coding-discipline.md]{/repo/.claude/rules/coding-discipline.md}",
		"",
		"User: hello",
	].join("\n");

	const markInjectedCalls: LoadedRule[] = [];
	const pending = filterRulesNotInTranscriptText([rule], transcriptText, (r) =>
		markInjectedCalls.push(r),
	);

	// Rule should still be pending (not suppressed) — body was never in transcript.
	expect(pending).toHaveLength(1);
	expect(pending[0]).toBe(rule);
	expect(markInjectedCalls).toHaveLength(0);
});

test("C2: path-only reference using realPath spelling also does not suppress rule", () => {
	const rule = makeRule({
		path: "/repo/.claude/rules/coding-discipline.md",
		realPath: "/real/path/coding-discipline.md",
	});
	// Uses the realPath spelling in the native reference.
	const transcriptText = "- [coding-discipline.md]{/real/path/coding-discipline.md}";

	const markInjectedCalls: LoadedRule[] = [];
	const pending = filterRulesNotInTranscriptText([rule], transcriptText, (r) =>
		markInjectedCalls.push(r),
	);

	expect(pending).toHaveLength(1);
	expect(markInjectedCalls).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Positive case: rule body + XML open tag present → still suppressed (regression guard)
// ---------------------------------------------------------------------------

test("body and XML open tag present → rule is suppressed (treated as injected)", () => {
	const rule = makeRule();
	const openTag = ruleMarkerLine(rule.path);
	const transcriptText = [openTag, rule.body, "</rules>"].join("\n");

	const markInjectedCalls: LoadedRule[] = [];
	const pending = filterRulesNotInTranscriptText([rule], transcriptText, (r) =>
		markInjectedCalls.push(r),
	);

	// Rule is already in transcript — should be marked injected and NOT pending.
	expect(pending).toHaveLength(0);
	expect(markInjectedCalls).toHaveLength(1);
	expect(markInjectedCalls[0]).toBe(rule);
});

// ---------------------------------------------------------------------------
// CRLF: rule whose body has \r\n line endings is correctly detected as
// already-injected when the transcript contains the LF-normalised version.
// ---------------------------------------------------------------------------

test("CRLF-bodied rule already present in LF-normalised transcript is NOT re-injected", () => {
	// Rule loaded from a Windows-checkout file: body has \r\n endings.
	const crlfBody = "# Coding Discipline\r\n\r\nDo not touch anything you must not touch.";
	const rule = makeRule({ body: crlfBody });
	// The transcript contains the body as it was previously injected (LF-only, trimmed).
	const lfBody = "# Coding Discipline\n\nDo not touch anything you must not touch.";
	const openTag = ruleMarkerLine(rule.path);
	const transcriptText = [openTag, lfBody, "</rules>"].join("\n");

	const markInjectedCalls: LoadedRule[] = [];
	const pending = filterRulesNotInTranscriptText([rule], transcriptText, (r) =>
		markInjectedCalls.push(r),
	);

	// CRLF rule is already in transcript — must be suppressed (not re-injected).
	expect(pending).toHaveLength(0);
	expect(markInjectedCalls).toHaveLength(1);
	expect(markInjectedCalls[0]).toBe(rule);
});

// ---------------------------------------------------------------------------
// Edge: rule with empty body is never suppressed regardless of transcript
// ---------------------------------------------------------------------------

test("empty-body rule is never treated as injected (pending always)", () => {
	const rule = makeRule({ body: "" });
	const transcriptText = ruleMarkerLine(rule.path) + "\n</rules>\n";

	const markInjectedCalls: LoadedRule[] = [];
	const pending = filterRulesNotInTranscriptText([rule], transcriptText, (r) =>
		markInjectedCalls.push(r),
	);

	expect(pending).toHaveLength(1);
	expect(markInjectedCalls).toHaveLength(0);
});
