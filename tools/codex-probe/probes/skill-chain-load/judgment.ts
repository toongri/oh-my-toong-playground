/**
 * The "sub-skill file actually opened" predicate — the judgment this probe
 * exists to render. Requires ALL of:
 *   1. `ToolCallRecord.item.command` (the tool call's ARGUMENT) names
 *      `<skill>/SKILL.md` AT A PATH BOUNDARY — `not-<skill>/SKILL.md` (a
 *      different skill whose name happens to end with this one) and
 *      `<skill>/SKILL.md.backup` (a different file whose name happens to
 *      start with this one) must NOT match a plain substring check
 *      (CONFIRMED defect this closes — see skillPathPattern below).
 *   2. The call actually SUCCEEDED — `item.exit_code === 0` and
 *      `item.status === "completed"` (CONFIRMED defect this closes: a
 *      failed tool call, e.g. a permission-denied `cat`, can still carry a
 *      `command` argument naming the path and stale/attacker-controlled
 *      `aggregated_output` text — checking content alone without also
 *      checking the call actually succeeded let a failed call masquerade as
 *      a successful read).
 *   3. `ToolCallRecord.item.aggregated_output` (the tool call's RESULT)
 *      actually contains that skill's own `name: <skill>` frontmatter line
 *      — a command that merely NAMES the path without reading its bytes
 *      (`ls`, `test -f`, `echo`, or a `sed` range that misses the
 *      frontmatter) must NOT pass either (CONFIRMED defect this closes: an
 *      argument-only check accepted any of those). Checking against the
 *      real `name:` frontmatter — which every skills/<name>/SKILL.md in
 *      this repo has, matching its directory name exactly (verified: no
 *      mismatch across skills/*) — is what makes this robust to output
 *      that merely echoes the path back without ever containing the file's
 *      own content.
 *
 * `command`/`aggregated_output`/`exit_code`/`status` are the shapes observed
 * on this codex version (0.144.5) for a `command_execution` item (see
 * tools/codex-probe/fixtures/toolcall-stdout.jsonl's real captured
 * `{"exit_code":0,"status":"completed",...}` shape) — there is no dedicated
 * file-read tool call type; a file is read via a `command_execution` item's
 * shell command and its captured output (see tools/codex-probe/fixtures/
 * PROVENANCE.md's toolcall-stdout.jsonl capture, and the parity-spec's own
 * observation: the model ran `sed -n '1,240p' .codex/skills/chain-bravo/
 * SKILL.md`). If a future codex version adds a distinct read-file tool, this
 * predicate needs a matching new case — it is deliberately narrow rather
 * than speculatively broad.
 *
 * This predicate is shared by 4 call sites — this file's own
 * skillChainJudgment, skill-chain-cue-form/judgment.ts's cueFormPredicate
 * (the positive AND arm), its invertedCueFormPredicate (the negative-control
 * `opened` axis), and its decoysOpened — so a fix here closes the same
 * false-positive class everywhere it's used, not just at this file's own
 * call site.
 */

import type { Judgment, Observation } from "../../types.ts";

/**
 * Matches `<skillName>/SKILL.md` only at a real path boundary: immediately
 * preceded by `/` or the start of the string, and immediately followed by
 * something that is NOT a filename-continuing character (so `SKILL.md` is
 * the actual, complete final path segment — not a prefix of a longer one).
 * Guards the two CONFIRMED false-positive shapes: `not-<skillName>/SKILL.md`
 * (a different skill directory that merely ENDS with this name — rejected by
 * the leading-boundary check) and `<skillName>/SKILL.md.backup` (a different
 * file that merely STARTS with `SKILL.md` — rejected by the trailing
 * negative lookahead).
 */
function skillPathPattern(skillName: string): RegExp {
	const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|/)${escaped}/SKILL\\.md(?![A-Za-z0-9._-])`);
}

export function skillFileWasOpened(observation: Observation, skillName: string): boolean {
	const pathPattern = skillPathPattern(skillName);
	const contentMarker = `name: ${skillName}`;
	return observation.toolCalls.some((call) => {
		const command = call.item.command;
		if (typeof command !== "string" || !pathPattern.test(command)) return false;
		if (call.item.exit_code !== 0 || call.item.status !== "completed") return false;
		const output = call.item.aggregated_output;
		return typeof output === "string" && output.includes(contentMarker);
	});
}

export function skillChainJudgment(skillName: string): Judgment {
	return { kind: "predicate", predicate: (observation) => skillFileWasOpened(observation, skillName) };
}
