/**
 * Materializes DEPLOYED-FORM codex rule bytes into a scratch project root,
 * without running `make sync` and without touching any real target project
 * — mirrors probes/skill-chain-load/materialize.ts's rationale exactly, one
 * category over: reuses the REAL production functions rather than
 * re-implementing the rewrite pipeline, so a drift in
 * PLATFORM_REWRITE_RULES.codex shows up here automatically.
 *
 *   - `CodexAdapter.syncRulesDirect` (tools/adapters/codex.ts) for the raw
 *     copy to `.codex/rules/<name>.md` — the SAME method `make sync` calls
 *     for the codex platform's rules category.
 *   - `rewritePlatformPaths` (tools/sync.ts) for the rewrite pass — the SAME
 *     function `make sync` calls, and the ONLY place Claude vocabulary
 *     (AskUserQuestion, TaskOutput, TaskCreate, subagent_type, ...) actually
 *     gets de-Claude-ified for a `.codex/rules/*.md` file (syncRulesDirect
 *     itself copies verbatim — see its own doc comment in codex.ts).
 *
 * Also writes a `package.json` project marker at `deployRoot` so
 * hooks/rules-injector/rules/project-root.ts's `findProjectRoot` resolves
 * `deployRoot` itself as the project root when a session runs with
 * `-C deployRoot` — verified directly against this repo's finder (see the
 * task's own investigation): a bare `{}` package.json is a sufficient weak
 * marker, no `.git` init needed.
 */

import fs from "fs/promises";
import path from "path";

import { CodexAdapter } from "../../../adapters/codex.ts";
import { rewritePlatformPaths } from "../../../sync.ts";

export type MaterializeOptions = {
	/**
	 * Skip the rewrite pass entirely — the negative control. The rule keeps
	 * its pre-rewrite Claude-vocabulary body (literal `AskUserQuestion`,
	 * `TaskOutput`, `TaskCreate`, `subagent_type`), exactly as authored in
	 * the source `.md`. @default false (rewrite runs, matching real `make sync`).
	 */
	skipRewrite?: boolean;
};

/**
 * Copies `<ruleSourceRoot>/rules/<ruleName>.md` into
 * `<deployRoot>/.codex/rules/<ruleName>.md`, writes a `package.json` project
 * marker at `deployRoot`, then applies the codex rewrite pass unless
 * `options.skipRewrite` is set. Returns the deployed rule file's path.
 */
export async function materializeCodexRule(
	ruleSourceRoot: string,
	deployRoot: string,
	ruleName: string,
	options: MaterializeOptions = {},
): Promise<string> {
	await fs.mkdir(deployRoot, { recursive: true });
	await fs.writeFile(path.join(deployRoot, "package.json"), "{}\n");

	const adapter = new CodexAdapter();
	await adapter.syncRulesDirect(deployRoot, ruleName, path.join(ruleSourceRoot, "rules", `${ruleName}.md`));

	if (options.skipRewrite !== true) {
		await rewritePlatformPaths(deployRoot, "codex");
	}

	return path.join(deployRoot, ".codex", "rules", `${ruleName}.md`);
}
