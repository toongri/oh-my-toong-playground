/**
 * materialize-skill.ts — thin wrapper around the sync engine that produces a
 * DEPLOYED-FORM copy of a skill inside an eval run-dir, so a codex run never
 * needs to read the source repo (skill dir, eval harness, orchestrator plan)
 * to find or run its bundled scripts.
 *
 * Layout mirrored: the exact codex deploy layout (tools/adapters/destinations.ts
 * `codexDestination`: category "skills" -> `.agents/skills/<name>`; a codex
 * skill's lib bucket is the "agents" deploy LOCATION -> sibling `.agents/lib/`,
 * per deployLocationForManifest, tools/sync.ts ~L476). `runDir` here plays the
 * role of a sync target `path`, so the materialized tree lands at
 * `<runDir>/.agents/skills/<skillName>/` with lib at `<runDir>/.agents/lib/` —
 * byte-identical in shape to what `make sync` would produce for a real codex
 * target rooted at `<runDir>`.
 *
 * Reuses, not reimplements:
 *   - CodexAdapter.syncSkillsDirect (tools/adapters/codex.ts ~L701) to copy
 *     the skill directory (SKILL.md if present, scripts/**\/*). It calls
 *     syncDirectory with no exclude override, so the shared DEFAULT_EXCLUDE
 *     (tools/lib/sync-directory.ts ~L15) drops `*.test.ts`, `__fixtures__`,
 *     and python cache dirs — same rule the real sync uses.
 *   - syncLib (tools/sync.ts ~L1613) to resolve the @lib/ transitive closure
 *     from the skill's SOURCE files (collectRequiredLibModulesFromSources
 *     follows both `@lib/...` and relative imports, so e.g. `@lib/state-core.ts`
 *     pulls in its sibling qa-chain-core.ts/explain-diff-core.ts, and
 *     `@lib/feature-map/manifest.ts` pulls in persistent-mode-core/state-lock.ts),
 *     copy those modules to `.agents/lib/`, vendor any declared bare npm import
 *     found along the way (bare-import vendoring, tools/sync.ts ~L1812; the
 *     fc-feedback skill's bare `import ... from "yaml"` vendors to
 *     `.agents/lib/vendor/yaml.js`), and rewrite every `@lib/` alias left in
 *     the copied skill scripts to the matching relative path
 *     (rewriteLibAliases, called from inside syncLib).
 *
 * Does NOT reuse rewritePlatformPaths' `${CLAUDE_SKILL_DIR}`/`$OMT_DIR` baking
 * (tools/sync.ts ~L1965) — that pass also de-Claude-ifies prose and is scoped
 * to a full sync run's owned-name bookkeeping. The caller (run.sh) already
 * does its own literal `${CLAUDE_SKILL_DIR}` substitution when it builds
 * prompt.txt; this wrapper only needs to hand it the right absolute path to
 * substitute in — the materialized skill dir, not the repo's source path.
 *
 * `materializeAgent` below does the same job for a single codex agent: the
 * fc-feedback skill's SKILL.md instructs dispatching `presentation-reviewer`
 * (a codex `spawn_agent` call) after notes are written, and that dispatch
 * must resolve against an agent definition materialized INTO the run-dir
 * (`<runDir>/.codex/agents/<name>.toml`, per tools/adapters/destinations.ts
 * `codexDestination`'s "agents" case), never this machine's global `~/.codex`
 * state (which a real eval run may not even have synced, or may have synced
 * stale). Reuses CodexAdapter.syncAgentsDirect (tools/adapters/codex.ts
 * `syncAgentsDirect`) for the md->toml translation — same emit-allowlist,
 * leaf-spawn guard, and rewrite-rules pass a real sync would apply — and
 * `loadRootModelMaps` (tools/sync.ts) to resolve the agent's frontmatter
 * `model` tier (e.g. `opus`) through this repo's own `codex.yaml`
 * `model-map.tiers`, exactly as a real sync would.
 *
 * `platform` selects which deployed shape gets materialized (default
 * "codex" — every existing call site, positional and CLI, keeps producing
 * the exact codex layout documented above). `platform: "claude"` instead
 * reuses ClaudeAdapter.syncSkillsDirect/syncAgentsDirect (tools/adapters/claude.ts
 * `syncSkillsDirect` ~L346, `syncAgentsDirect` ~L139) to land the skill at
 * `<runDir>/.claude/skills/<skillName>/`, its lib closure at
 * `<runDir>/.claude/lib/` (deployLocationForManifest("claude", "skills") is
 * just "claude" — no "agents" bucket remap, unlike codex skills), and the
 * agent as a plain copied `<runDir>/.claude/agents/<agentName>.md` (Claude
 * agents are markdown, not TOML — no model-tier translation to run).
 */
import path from "node:path";
import { loadRootModelMaps, syncLib, type LibSourceRoots } from "../../../tools/sync.ts";
import { codexAdapter } from "../../../tools/adapters/codex.ts";
import { ClaudeAdapter } from "../../../tools/adapters/claude.ts";
import { planCategoryDestinationPaths } from "../../../tools/adapters/destinations.ts";
import type { SyncContext } from "../../../tools/lib/types.ts";

const claudeAdapter = new ClaudeAdapter();

/** The two deployed shapes this wrapper can produce. */
export type MaterializePlatform = "codex" | "claude";

export interface MaterializeSkillOptions {
	/** Run-dir root; plays the role of a sync target `path`. */
	runDir: string;
	/** Repo root (rootDir in syncLib's terms) — where package.json and lib/ live. */
	repoRoot: string;
	/** Absolute path to the skill's SOURCE directory (e.g. projects/<p>/skills/<name>). */
	skillSourceDir: string;
	/** Skill display name (the directory name under skills/, e.g. "fc-feedback"). */
	skillName: string;
	/** Deployed shape to produce. Defaults to "codex" (unchanged behavior). */
	platform?: MaterializePlatform;
}

export interface MaterializeSkillResult {
	/** Absolute path to the materialized skill dir: <runDir>/.agents/skills/<skillName>. */
	skillDir: string;
}

/** Minimal SyncContext for a one-off syncLib call — only `dryRun` is read by syncLib. */
function buildSyncContext(): SyncContext {
	return {
		dryRun: false,
		projectName: "",
		projectDir: "",
		isRootYaml: true,
		backupBase: "",
		backupDest: "",
		modelMaps: new Map(),
		rootModelMaps: new Map(),
		processedPaths: new Set(),
		platformYamlSections: new Map(),
		failedTargets: [],
	};
}

/**
 * Materialize one skill into `runDir` in the exact shape a real sync target
 * for `options.platform` (default "codex") would receive it. Idempotent:
 * re-running against the same runDir re-copies the skill and re-resolves lib
 * (syncLib's atomic swap leaves no partial state on failure).
 */
export async function materializeSkill(
	options: MaterializeSkillOptions,
): Promise<MaterializeSkillResult> {
	const { runDir, repoRoot, skillSourceDir, skillName, platform = "codex" } = options;

	if (platform === "claude") {
		await claudeAdapter.syncSkillsDirect(runDir, skillName, skillSourceDir, false);

		const libSourceRoots: LibSourceRoots = new Map([["claude", new Set([skillSourceDir])]]);
		await syncLib(buildSyncContext(), runDir, repoRoot, [], libSourceRoots);

		return { skillDir: path.join(runDir, ".claude", "skills", skillName) };
	}

	await codexAdapter.syncSkillsDirect(runDir, skillName, skillSourceDir, false);

	const libSourceRoots: LibSourceRoots = new Map([["agents", new Set([skillSourceDir])]]);
	await syncLib(buildSyncContext(), runDir, repoRoot, [], libSourceRoots);

	return { skillDir: path.join(runDir, ".agents", "skills", skillName) };
}

export interface MaterializeAgentOptions {
	/** Run-dir root; plays the role of a sync target `path`. */
	runDir: string;
	/** Repo root — where `codex.yaml` (and its `model-map.tiers`) lives. */
	repoRoot: string;
	/** Absolute path to the agent's SOURCE file (e.g. agents/presentation-reviewer.md). */
	agentSourcePath: string;
	/** Agent display name (e.g. "presentation-reviewer"). */
	agentName: string;
	/** Deployed shape to produce. Defaults to "codex" (unchanged behavior). */
	platform?: MaterializePlatform;
}

export interface MaterializeAgentResult {
	/**
	 * Absolute path to the materialized agent file:
	 * `<runDir>/.codex/agents/<agentName>.toml` for codex,
	 * `<runDir>/.claude/agents/<agentName>.md` for claude.
	 */
	agentFile: string;
}

/**
 * Materialize one agent into `runDir` in the exact shape a real sync target
 * for `options.platform` (default "codex") would receive it, so a dispatch
 * for it resolves against the run-dir's own project-scoped agent directory,
 * independent of this machine's global `~/.codex`/`~/.claude` state.
 */
export async function materializeAgent(
	options: MaterializeAgentOptions,
): Promise<MaterializeAgentResult> {
	const { runDir, repoRoot, agentSourcePath, agentName, platform = "codex" } = options;

	if (platform === "claude") {
		// Claude agents are markdown, copied as-is — no TOML translation, so no
		// model-tier resolution to run (ClaudeAdapter.syncAgentsDirect ignores
		// its modelMap parameter).
		await claudeAdapter.syncAgentsDirect(runDir, agentName, agentSourcePath, undefined, undefined, false);
		const [relativePath] = planCategoryDestinationPaths("claude", "agents", agentName);
		return { agentFile: path.join(runDir, relativePath) };
	}

	const modelMap = (await loadRootModelMaps(repoRoot)).get("codex");
	await codexAdapter.syncAgentsDirect(runDir, agentName, agentSourcePath, undefined, undefined, false, modelMap);

	const [relativePath] = planCategoryDestinationPaths("codex", "agents", agentName);
	return { agentFile: path.join(runDir, relativePath) };
}

if (import.meta.main) {
	const rawArgs = process.argv.slice(2);
	const positionals: string[] = [];
	let platform: MaterializePlatform = "codex";
	for (let i = 0; i < rawArgs.length; i++) {
		const arg = rawArgs[i];
		if (arg === "--platform") {
			const value = rawArgs[++i];
			if (value !== "codex" && value !== "claude") {
				console.error(`--platform must be "codex" or "claude", got: ${value}`);
				process.exit(1);
			}
			platform = value;
		} else {
			positionals.push(arg);
		}
	}
	const [runDir, repoRoot, skillSourceDir, skillName, agentSourcePath, agentName] = positionals;
	if (!runDir || !repoRoot || !skillSourceDir || !skillName) {
		console.error(
			"usage: materialize-skill.ts <run-dir> <repo-root> <skill-source-dir> <skill-name> [<agent-source-path> <agent-name>] [--platform codex|claude]",
		);
		process.exit(1);
	}
	const result = await materializeSkill({ runDir, repoRoot, skillSourceDir, skillName, platform });
	process.stdout.write(`${result.skillDir}\n`);

	if (agentSourcePath && agentName) {
		const agentResult = await materializeAgent({ runDir, repoRoot, agentSourcePath, agentName, platform });
		process.stdout.write(`${agentResult.agentFile}\n`);
	}
}
