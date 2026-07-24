/**
 * Synthetic rule fixture — owned entirely by this probe, not one of this
 * repo's real rules/*.md. A synthetic source (rather than, say,
 * rules/continuation-contract.md) is deliberate: it packs ALL FOUR literals
 * spec AC line 76 names (`AskUserQuestion`, `TaskOutput`, `TaskCreate`,
 * `subagent_type`) into ONE rule file, and carries its own unique sentinel
 * for the positive control — so this probe's result never depends on which
 * literals a real rule happens to contain today, or drifts if that rule's
 * prose changes later (matching skill-chain-cue-form's synthetic-fixture
 * rationale for the same reason: a real source's content is out of this
 * probe's control).
 */

import fs from "fs/promises";
import path from "path";

export const RULE_SENTINEL = "RULESLEAK_SENTINEL_8Q3F1B";

export const FORBIDDEN_LITERALS = ["AskUserQuestion", "TaskOutput", "TaskCreate", "subagent_type"] as const;

export const RULE_NAME = "runtime-leak-probe";

/**
 * The rule body. Every FORBIDDEN_LITERALS entry appears verbatim exactly
 * once — each is a live match for its corresponding PLATFORM_REWRITE_RULES.codex
 * entry (rules 9, 10, 12, 14 in tools/lib/rewrite-rules.ts), so applying the
 * real rewrite pass must rewrite every one of them. RULE_SENTINEL is plain
 * text that collides with no rewrite rule's `detect` pattern, so it survives
 * the rewrite pass unchanged in both the "rewritten" and "unrewritten" arms —
 * it exists to prove the RULE ITSELF reached injectedContext, independent of
 * whether the rewrite pass ran.
 */
export function ruleBody(): string {
	return `# Synthetic Runtime-Leak Probe Rule (tools/codex-probe/probes/rules-runtime-leak-absence)

Sentinel: ${RULE_SENTINEL}

Ask the user via AskUserQuestion when a decision is needed.
Read a subagent's full transcript with TaskOutput.
Create a todo with TaskCreate.
Pass subagent_type when spawning a subagent.
`;
}

/** Writes `<root>/rules/<RULE_NAME>.md` in the plain `rules/<name>.md` shape CodexAdapter.syncRulesDirect expects as its source. */
export async function writeSyntheticRuleSource(root: string): Promise<string> {
	const rulesDir = path.join(root, "rules");
	await fs.mkdir(rulesDir, { recursive: true });
	const sourcePath = path.join(rulesDir, `${RULE_NAME}.md`);
	await fs.writeFile(sourcePath, ruleBody());
	return sourcePath;
}
