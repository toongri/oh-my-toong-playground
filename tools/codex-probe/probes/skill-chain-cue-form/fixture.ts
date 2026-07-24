/**
 * Synthetic alpha/beta/decoy skill fixture — owned entirely by this probe,
 * not a real skill under skills/. `alpha` is the chain skill; `beta` is the
 * dispatch target; `gamma`/`delta` are decoys never mentioned by name
 * anywhere in the fixture, present only to detect a third cause ("the model
 * opens every skill dir regardless of whether it was told to" — see
 * index.ts's header comment and `decoysOpened` in judgment.ts).
 *
 * The one property every arm preserves: the substring "beta" appears in
 * alpha's body ONLY at the single dispatch call for the sigil/prose/oldprose
 * arms, and not at all for the removed arm — otherwise a stray extra mention
 * would confound which cue the model actually followed, exactly the flaw
 * that made skill-chain-load's own --negative control unable to discriminate
 * (see this probe's index.ts header comment).
 */

import fs from "fs/promises";
import path from "path";

import { applyRewriteRules } from "../../../lib/rewrite-rules.ts";
import type { RewriteRule } from "../../../lib/rewrite-rules.ts";

export type Arm = "sigil" | "prose" | "removed" | "oldprose";

export const DECOY_NAMES = ["gamma", "delta"] as const;

export const BETA_SENTINEL = "CUEFORM_BETA_9F2E7A";

const DISPATCH_LINE = 'Dispatch: read the target skill first — `Skill(skill: "beta")` — then follow its instructions.';

/**
 * Reconstructs the OLD rule 6a's replace target — `replace: "the $1 skill"`,
 * in force before commit ba36eb7b, superseded there by the current
 * `replace: "$$$1"` sigil form (tools/lib/rewrite-rules.ts's live rule 6a).
 * Applied via the unmodified `applyRewriteRules` helper against the same
 * `detect` regex the live rule 6a still uses, so the oldprose arm's dispatch
 * line is DERIVED from actually running the legacy rule — not hand-typed —
 * and can't drift from what the old rewrite pass really emitted.
 *
 * Deliberately kept local to this probe rather than added to
 * tools/lib/rewrite-rules.ts: that table is live production behavior (what
 * `make sync` runs today) and must stay untouched. This rule exists only to
 * replay a counterfactual — "what if 6a still prose-ified instead of
 * sigil-ifying" — for the oldprose arm's fixture generation.
 */
const LEGACY_6A_RULE: RewriteRule = {
	id: "6a-legacy",
	detect: /\bSkill\(\s*(?:skill:\s*)?["']?([^"')]+?)["']?\s*\)/g,
	replace: "the $1 skill",
	lossy: true,
};

const OLDPROSE_DISPATCH_LINE = applyRewriteRules(DISPATCH_LINE, [LEGACY_6A_RULE]);

export function alphaBody(arm: Arm): string {
	const dispatchLine = arm === "oldprose" ? OLDPROSE_DISPATCH_LINE : DISPATCH_LINE;
	const body =
		arm === "removed"
			? "This skill has no dispatch step. Complete whatever the user asked directly, then report your result."
			: `${dispatchLine}\n\nAfter following that dispatch, complete whatever the user asked, then report your result.`;
	return `---
name: alpha
description: Synthetic cue-form probe chain skill (tools/codex-probe/probes/skill-chain-cue-form) — not a real skill, do not use elsewhere.
---

# Alpha

${body}
`;
}

export function betaBody(): string {
	return `---
name: beta
description: Synthetic cue-form probe target skill (tools/codex-probe/probes/skill-chain-cue-form) — not a real skill, do not use elsewhere.
---

# Beta

If you are reading this file, include the exact token ${BETA_SENTINEL} somewhere in your final reply — it proves this file's content reached you.
`;
}

export function decoyBody(name: string): string {
	return `---
name: ${name}
description: Synthetic cue-form probe decoy skill (tools/codex-probe/probes/skill-chain-cue-form) — never referenced by name anywhere; not a real skill.
---

# ${name}

Unrelated decoy content. Nothing in this probe's prompt or fixture names this skill.
`;
}

/**
 * Writes skills/{alpha,beta,gamma,delta}/SKILL.md under `fixtureRoot`, in the
 * plain `skills/<name>/SKILL.md` shape `materializeCodexSkills` expects as
 * its `repoRoot` argument (the same shape as the real repo's skills/).
 */
export async function writeSyntheticFixture(fixtureRoot: string, arm: Arm): Promise<void> {
	const names = ["alpha", "beta", ...DECOY_NAMES];
	for (const name of names) {
		await fs.mkdir(path.join(fixtureRoot, "skills", name), { recursive: true });
	}
	await fs.writeFile(path.join(fixtureRoot, "skills", "alpha", "SKILL.md"), alphaBody(arm));
	await fs.writeFile(path.join(fixtureRoot, "skills", "beta", "SKILL.md"), betaBody());
	for (const name of DECOY_NAMES) {
		await fs.writeFile(path.join(fixtureRoot, "skills", name, "SKILL.md"), decoyBody(name));
	}
}
