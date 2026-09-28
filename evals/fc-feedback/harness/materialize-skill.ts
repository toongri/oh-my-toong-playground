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
 */
import path from "node:path";
import { syncLib, type LibSourceRoots } from "../../../tools/sync.ts";
import { codexAdapter } from "../../../tools/adapters/codex.ts";
import type { SyncContext } from "../../../tools/lib/types.ts";

export interface MaterializeSkillOptions {
	/** Run-dir root; plays the role of a sync target `path`. */
	runDir: string;
	/** Repo root (rootDir in syncLib's terms) — where package.json and lib/ live. */
	repoRoot: string;
	/** Absolute path to the skill's SOURCE directory (e.g. projects/<p>/skills/<name>). */
	skillSourceDir: string;
	/** Skill display name (the directory name under skills/, e.g. "fc-feedback"). */
	skillName: string;
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
 * Materialize one skill into `runDir` in the exact shape a real codex sync
 * target would receive it. Idempotent: re-running against the same runDir
 * re-copies the skill and re-resolves lib (syncLib's atomic swap leaves no
 * partial state on failure).
 */
export async function materializeSkill(
	options: MaterializeSkillOptions,
): Promise<MaterializeSkillResult> {
	const { runDir, repoRoot, skillSourceDir, skillName } = options;

	await codexAdapter.syncSkillsDirect(runDir, skillName, skillSourceDir, false);

	const libSourceRoots: LibSourceRoots = new Map([["agents", new Set([skillSourceDir])]]);
	await syncLib(buildSyncContext(), runDir, repoRoot, [], libSourceRoots);

	return { skillDir: path.join(runDir, ".agents", "skills", skillName) };
}

if (import.meta.main) {
	const [runDir, repoRoot, skillSourceDir, skillName] = process.argv.slice(2);
	if (!runDir || !repoRoot || !skillSourceDir || !skillName) {
		console.error(
			"usage: materialize-skill.ts <run-dir> <repo-root> <skill-source-dir> <skill-name>",
		);
		process.exit(1);
	}
	const result = await materializeSkill({ runDir, repoRoot, skillSourceDir, skillName });
	process.stdout.write(`${result.skillDir}\n`);
}
