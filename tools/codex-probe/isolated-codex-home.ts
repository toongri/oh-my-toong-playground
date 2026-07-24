/**
 * Builds a fully isolated `HOME`/`CODEX_HOME` pair for a probe session — used
 * by EVERY probe that spawns a real `codex exec`, since none of them can let
 * this developer machine's own ambient state confound what they observe. The
 * two hook probes (ultrawork-keyword-injection, rules-runtime-leak-absence)
 * additionally register a self-authored `hooks.json`; the two skill-chain
 * probes (skill-chain-load, skill-chain-cue-form) pass an EMPTY `hooks` and
 * isolate for home-scope SKILL discovery alone (`~/.agents/skills`), which is
 * the ambient source that could otherwise satisfy their predicates without
 * the freshly materialized bytes ever being loaded.
 *
 * CONFIRMED defect this exists to avoid (measured on this machine
 * 2026-07-24): running a real codex session with the default HOME picks up
 * this user's OWN `~/.claude/rules/*.md` as a home-scope rules-injector
 * source (see hooks/rules-injector/rules/sources.ts's doc comment on
 * existence-conditional supersede) whenever the matching `~/.codex/rules`
 * counterpart hasn't been deployed on that particular machine yet — which is
 * exactly the pre-patch runtime-leak state story 76's probe exists to catch.
 * On this machine specifically, `~/.codex/rules` was empty (never synced),
 * so a real `codex exec` run with the default HOME leaked this user's own
 * `tool-usage-policy.md`/`work-principles.md` content — `TaskOutput`,
 * `TaskCreate`, and `subagent_type` all observed present in `injectedContext`
 * — into EVERY session regardless of what this probe deploys into its own
 * scratch project root. That leak is real but environmental (this machine's
 * sync staleness), not a property of the rules pipeline this probe tests;
 * isolating HOME removes the confound instead of asserting around it.
 *
 * `HOME` and `CODEX_HOME` are isolated independently (not the same
 * directory): `CODEX_HOME` alone governs where `codex exec` looks for
 * `auth.json`/`hooks.json`/`config.toml`/`sessions/`, while `HOME` alone
 * governs `os.homedir()`-based lookups the rules/skill engines make
 * (`~/.claude/rules`, `~/.codex/rules`, `~/.agents/skills`,
 * `~/.omt/rules-injector/` state) — confirmed by direct measurement on this
 * machine: spawning with `HOME=<empty tmpdir>` and `CODEX_HOME=<real path>`
 * both (a) authenticated successfully (auth.json found under CODEX_HOME) and
 * (b) showed zero home-scope rule/skill leakage (nothing under the empty
 * HOME to leak). `auth.json` is copied into the isolated `CODEX_HOME` rather
 * than pointed at the real one so a fully self-contained `CODEX_HOME` can
 * also carry its OWN `hooks.json` naming THIS REPO's source paths — see
 * `hooks` below.
 *
 * `hooks.json` entries point at absolute paths under THIS REPO (not a
 * deployed copy under any `~/.codex/`) deliberately: hook scripts (`.sh`/
 * `.ts`) are never walked by `rewritePlatformPaths` (only `.md` is — see
 * that function's doc comment in tools/sync.ts), so their deployed bytes are
 * byte-identical to repo source, and pointing at the repo directly avoids one
 * more sync-staleness confound: whether a given developer machine's
 * `~/.codex/hooks/` happens to be freshly synced. It also guarantees
 * SessionStart/UserPromptSubmit
 * sibling sourcing (`source "$SCRIPT_DIR/keyword-detector-core.sh"`) still
 * resolves, since the sibling file sits next to the hook script in repo
 * layout exactly as it does in deployed layout.
 *
 * A hooks.json written into a brand-new CODEX_HOME carries no established
 * trust (codex's trust registry is keyed by the hooks.json path itself,
 * inside `<codexHome>/config.toml` — see this repo's CLAUDE.md on the
 * codex-persistent-mode/write-guard hook registration for the same
 * mechanism). The caller MUST pass `--dangerously-bypass-approvals-and-sandbox`'s
 * sibling flag `--dangerously-bypass-hook-trust` as an extraArg — sanctioned
 * ONLY for this self-authored-hooks + fresh-CODEX_HOME combination (never for
 * a real user's `~/.codex`), per this task's own constraint.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";

export type HookEntry = { command: string; timeout?: number };

/** Event name (`UserPromptSubmit`, `SessionStart`, ...) -> ordered hook entries to register for it. */
export type HooksSpec = Record<string, HookEntry[]>;

export type IsolatedCodexHome = { home: string; codexHome: string };

export type BuildIsolatedCodexHomeOptions = {
	/** @default `${os.homedir()}/.codex/auth.json` — override for hermetic tests (a fixture file, never real credentials). */
	authSourcePath?: string;
};

/**
 * Creates `<root>/home` (an empty `HOME`) with `<root>/home/.codex` inside it
 * as `CODEX_HOME`, copies `auth.json` in, and — only if `hooks` is
 * non-empty — writes `<codexHome>/hooks.json` registering exactly the given
 * entries. An EMPTY `hooks` object deliberately produces NO hooks.json at
 * all (not an empty one): this is the "mechanism absent" arm both probes use
 * to demonstrate their positive control's discriminating power (see each
 * probe's index.ts header comment on its RED arm).
 */
export async function buildIsolatedCodexHome(
	root: string,
	hooks: HooksSpec,
	options: BuildIsolatedCodexHomeOptions = {},
): Promise<IsolatedCodexHome> {
	const home = path.join(root, "home");
	const codexHome = path.join(home, ".codex");
	await fs.mkdir(codexHome, { recursive: true });

	const authSource = options.authSourcePath ?? path.join(os.homedir(), ".codex", "auth.json");
	await fs.copyFile(authSource, path.join(codexHome, "auth.json"));

	if (Object.keys(hooks).length > 0) {
		const hooksJson = {
			hooks: Object.fromEntries(
				Object.entries(hooks).map(([event, entries]) => [
					event,
					[
						{
							matcher: "*",
							hooks: entries.map((entry) => ({
								type: "command",
								command: entry.command,
								...(entry.timeout === undefined ? {} : { timeout: entry.timeout }),
							})),
						},
					],
				]),
			),
		};
		await fs.writeFile(path.join(codexHome, "hooks.json"), JSON.stringify(hooksJson, null, 2));
	}

	return { home, codexHome };
}
