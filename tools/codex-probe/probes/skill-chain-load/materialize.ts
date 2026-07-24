/**
 * Materializes DEPLOYED-FORM codex skill bytes into a scratch root, without
 * running `make sync` and without touching any real target project (the
 * caller supplies a throwaway `deployRoot`, typically a mkdtemp result).
 *
 * Reuses the exact production functions rather than re-implementing the
 * rewrite pipeline — a drift in PLATFORM_REWRITE_RULES.codex must show up
 * here automatically, or this probe's ability to catch a real regression is
 * zero:
 *   - `syncDirectory` (tools/lib/sync-directory.ts) for the raw per-skill
 *     copy — the same call CodexAdapter.syncSkillsDirect makes.
 *   - `rewritePlatformPaths` (tools/sync.ts) for the rewrite+bake pass — the
 *     SAME function `make sync` calls for the codex platform.
 *
 * Scripts under `.agents/skills/<name>/scripts/` keep whatever `@lib/`
 * aliases they carry in source: `rewriteLibAliases` only ever walks
 * `.codex/` (the platform root), never `.agents/skills/` — verified against
 * this machine's real deployed skills (e.g.
 * `~/.agents/skills/agent-council/scripts/worker.ts` still imports raw
 * `@lib/logging`, and no `lib/`/`vendor/` directory exists anywhere under
 * `~/.agents/skills/`). This function does not "fix" that gap — it
 * reproduces it faithfully, because the whole point of this probe is
 * measuring what REAL deployed bytes do, not a hypothetically-improved
 * version of them.
 */

import path from "path";

import { codexSkillsDir } from "../../../adapters/codex.ts";
import { syncDirectory } from "../../../lib/sync-directory.ts";
import { rewritePlatformPaths } from "../../../sync.ts";

export type MaterializeOptions = {
	/**
	 * Skill names to copy WITHOUT the rewrite+bake pass — the negative
	 * control. Their body keeps the pre-rule-6a Claude-tool-call form
	 * (literal `Skill(skill: "x")`) and an unbaked `${CLAUDE_SKILL_DIR}`
	 * token, exactly as authored in skills/<name>/SKILL.md.
	 */
	skipRewrite?: ReadonlySet<string>;
};

/**
 * Copies each named skill from `<repoRoot>/skills/<name>` into
 * `<deployRoot>/.agents/skills/<name>`, then applies the codex rewrite+bake
 * pass to every name NOT listed in `options.skipRewrite`. Returns the
 * deployed skills root (`<deployRoot>/.agents/skills`) — the directory a
 * `codex exec -C <deployRoot>` session actually reads from (verified fact:
 * this machine's real codex skills live under `~/.agents/skills/`).
 */
export async function materializeCodexSkills(
	repoRoot: string,
	deployRoot: string,
	skillNames: readonly string[],
	options: MaterializeOptions = {},
): Promise<string> {
	const skillsDir = codexSkillsDir(deployRoot);

	for (const name of skillNames) {
		await syncDirectory(path.join(repoRoot, "skills", name), path.join(skillsDir, name));
	}

	const rewriteNames = new Set(skillNames.filter((name) => !(options.skipRewrite?.has(name) ?? false)));
	if (rewriteNames.size > 0) {
		await rewritePlatformPaths(deployRoot, "codex", rewriteNames);
	}

	return skillsDir;
}
