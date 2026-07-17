/**
 * oh-my-toong Sync Orchestrator
 *
 * Main entry point for the TypeScript sync tool.
 * Ports sync.sh's processYaml, syncCategory, syncPlatformConfigs,
 * syncLib, rewritePlatformPaths, and main loop.
 *
 * NOTE: config/hooks/mcps/plugins processing is intentionally absent (P2-3).
 * These sections are handled exclusively by per-platform YAML adapters via
 * syncPlatformConfigs.
 */

import fs from "fs/promises";
import path from "path";
import { existsSync, realpathSync } from "fs";
import { execFileSync } from "node:child_process";

import type {
	Platform,
	Category,
	PlatformYaml,
	SyncYaml,
	SyncContext,
	PluginScope,
	DocsItem,
	ModelMap,
} from "./lib/types.ts";
import {
	getRootDir,
	getBackupRetentionDays,
	getEnabledProjects,
	getFeaturePlatforms,
	getCodexVersions,
} from "./lib/config.ts";
import { parseCodexVersion, assertCodexVersionAllowed } from "./lib/codex-version.ts";
import { readAndExpandSyncYaml } from "./lib/parse-sync-yaml.ts";
import { parseAndMergePlatformYaml } from "./lib/parse-platform-yaml.ts";
import { resolvePlatforms, resolveComponentPath, setProjectContext } from "./lib/resolver.ts";
import {
	backupCategory,
	backupDocs,
	cleanupOldBackups,
	generateBackupSessionId,
	isSafeBackupRoot,
} from "./lib/backup.ts";
import { resolveOmtDir, getOmtDir, deriveProjectName } from "../lib/omt-dir.ts";
import { reconcilePairManifest, removeManifestPair } from "./lib/deploy-manifest.ts";
import { resolveDocsTarget, detectDocsTargetCollisions } from "./lib/path-utils.ts";
import { logInfo, logWarn, logError, logDry, logSuccess } from "./lib/logger.ts";
import { ProjectKeyError } from "./lib/git-key.ts";
import { resolveDeployTargets, DeployTargetsError } from "./lib/resolve-deploy-targets.ts";
import { rewriteLibImports } from "./lib/sync-directory.ts";
import {
	collectRequiredLibModulesFromSources,
	collectLibDataFiles,
	findBareNpmImports,
	readPackageJsonDeps,
} from "./adapters/ts-lib-deps.ts";
import { runProvision } from "./lib/provision.ts";
import { ClaudeAdapter } from "./adapters/claude.ts";
import { GeminiAdapter } from "./adapters/gemini.ts";
import { CodexAdapter, cleanupCodexSkillsFossil, codexSkillsDir } from "./adapters/codex.ts";
import { opencodeAdapter } from "./adapters/opencode.ts";
import type { PlatformAdapter } from "./adapters/types.ts";
import {
	PLATFORM_REWRITE_RULES,
	applyRewriteRules,
	bakeSkillDirToken,
	type RewriteRule,
} from "./lib/rewrite-rules.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Map from platform name to its adapter instance. */
export type AdapterMap = Map<Platform, PlatformAdapter>;

/**
 * Per-platform accumulator of resolved component SOURCE paths, populated as
 * categories and per-platform hooks are processed. syncLib scans these SOURCE
 * roots (not the deployed tree, which no longer carries raw `@lib/`) to decide
 * which lib modules to deploy. Keyed per platform so a component synced only to
 * one platform does not pull lib into another.
 */
export type LibSourceRoots = Map<Platform, Set<string>>;

/** Record a resolved source path under a platform in the lib-source accumulator. */
function addLibSourceRoot(roots: LibSourceRoots, platform: Platform, sourcePath: string): void {
	let set = roots.get(platform);
	if (!set) {
		set = new Set<string>();
		roots.set(platform, set);
	}
	set.add(sourcePath);
}

// ---------------------------------------------------------------------------
// syncCategory
// ---------------------------------------------------------------------------

/** All categories handled by syncCategory. */
export const CATEGORIES: Category[] = ["agents", "commands", "skills", "scripts", "rules"];

/**
 * Single source of truth for "does this project deploy anything into <path>/.claude/?".
 *
 * True when EITHER:
 *   (a) any CATEGORIES section in sync.yaml has ≥1 item, OR
 *   (b) claude.yaml has a key other than `mcps` (config/hooks/plugins → .claude/ files).
 *
 * An MCP-only project (claude.yaml with ONLY `mcps`, no component items) writes to
 * ~/.claude.json instead of <path>/.claude/, so this returns false for it.
 *
 * Both the sync.ts mkdir gate and the components.ts CLI-project-file validation gate
 * route through this predicate so the two cannot drift.
 */
export function deploysToClaudeDotDir(
	syncYamlData: Record<string, unknown>,
	parsedClaudeYaml: Record<string, unknown> | null,
): boolean {
	const hasComponentSections = CATEGORIES.some((cat) => {
		const section = syncYamlData[cat];
		if (section === null || section === undefined || typeof section !== "object") return false;
		const items = "items" in section ? section.items : undefined;
		return Array.isArray(items) && items.length > 0;
	});
	const hasClaudeDotFileDeploy =
		parsedClaudeYaml !== null &&
		parsedClaudeYaml !== undefined &&
		Object.keys(parsedClaudeYaml).some((k) => k !== "mcps");
	return hasComponentSections || hasClaudeDotFileDeploy;
}

/**
 * Platform×category capability map.
 * Only combinations listed here proceed through backup+wipe+dispatch.
 * Unsupported combos (e.g., codex+agents) are skipped entirely.
 */
export const SUPPORTED_CATEGORIES: Record<string, Set<Category>> = {
	claude: new Set(["agents", "commands", "skills", "scripts", "rules"]),
	gemini: new Set(["commands", "skills", "scripts"]),
	codex: new Set(["agents", "skills", "scripts"]),
	opencode: new Set(["agents", "commands", "skills", "scripts", "rules"]),
};

/**
 * Deploy-LOCATION key for backup + manifest reconciliation. NOT a Platform:
 * Codex reads skills from `.agents/skills` (a cross-CLI root), not `.codex/skills`,
 * so its backup source and manifest ownership key must name that physical pair.
 * Must never leak into the Platform union, the adapter registry, or SUPPORTED_CATEGORIES.
 */
export function deployLocationForManifest(platform: Platform, category: string): string {
	return platform === "codex" && category === "skills" ? "agents" : platform;
}

/**
 * Generic sync loop for a single category.
 * Replaces sync_agents, sync_commands, sync_skills, sync_scripts, sync_rules.
 *
 * For each item in syncYaml[category].items:
 *   1. Resolve effective platforms via resolvePlatforms()
 *   2. Resolve component path via resolveComponentPath()
 *   3. For each item×platform: call adapter.sync{Category}Direct(...)
 *   4. Handle prepared-directory tracking (backup before first write per platform×category)
 *   5. Handle add-skills and add-hooks for agents category
 */
export async function syncCategory(
	context: SyncContext,
	category: Category,
	syncYaml: SyncYaml,
	adapters: AdapterMap,
	rootDir: string,
	deployRoot: string,
	libSourceRoots?: LibSourceRoots,
): Promise<void> {
	const section = syncYaml[category];
	if (!section || !Array.isArray(section.items) || section.items.length === 0) {
		return;
	}

	const sectionPlatforms = section.platforms;
	const syncYamlPlatforms = syncYaml.platforms;
	const items = section.items;

	logInfo(`${category} 동기화 시작 (${items.length} 개)`);

	// Track which (platform, category) pairs have been prepared (backed up).
	// Key: `${platform}:${category}`
	const preparedKeys = new Set<string>();

	// Dedup key set for the unsupported platform×category skip log below — a
	// project deploying 12 agents to an unsupported platform must log the skip
	// once, not 12 times.
	const unsupportedLogged = new Set<string>();

	// Entry names (displayName) this run declares for each platform, within this
	// category — the manifest-scoped orphan removal below diffs this against the
	// PREVIOUS run's recorded set instead of wiping the whole category dir.
	// Never populated for "rules": rules are excluded from removal entirely (may
	// hold user-managed files), exactly as the old wipe excluded them.
	// Keyed by deploy LOCATION (deployLocationForManifest), not Platform directly —
	// Codex skills accumulate under "agents", matching the physical .agents/skills
	// pair its backup and manifest reconciliation actually own.
	const deployedNames = new Map<string, Set<string>>();

	for (const item of items) {
		const componentRef = typeof item === "string" ? item : (item.component ?? "");

		if (!componentRef) {
			logWarn(`${category}: component 없는 항목 스킵`);
			continue;
		}

		// Resolve component path
		const resolved = resolveComponentPath(
			componentRef,
			category,
			rootDir,
			context.projectDir || undefined,
		);
		if ("error" in resolved) {
			logWarn(`${category}/${componentRef}: ${resolved.error}`);
			continue;
		}

		const { path: sourcePath, displayName } = resolved;

		// Resolve platforms for this item
		const platforms = await resolvePlatforms(item, sectionPlatforms, syncYamlPlatforms, category);

		// Resolve add-skills (agents category only)
		let addSkills: string[] | undefined;
		if (category === "agents" && typeof item === "object" && item["add-skills"]) {
			const rawSkillsValue = item["add-skills"];
			if (!Array.isArray(rawSkillsValue)) {
				logWarn(`add-skills must be an array, got ${typeof rawSkillsValue}. Skipping.`);
			} else {
				const rawSkills = rawSkillsValue;
				const resolvedSkills: string[] = [];
				for (const skillRef of rawSkills) {
					const skillResolved = resolveComponentPath(
						skillRef,
						"skills",
						rootDir,
						context.projectDir || undefined,
					);
					if ("error" in skillResolved) {
						logWarn(`add-skills not found: ${skillRef} (${skillResolved.error})`);
					} else {
						resolvedSkills.push(skillResolved.displayName);
					}
				}
				if (resolvedSkills.length > 0) {
					addSkills = resolvedSkills;
				}
			}
		}

		// Resolve add-hooks (agents category only)
		let addHooks: unknown[] | undefined;
		if (category === "agents" && typeof item === "object" && item["add-hooks"]) {
			const rawHooksValue = item["add-hooks"];
			if (!Array.isArray(rawHooksValue)) {
				logWarn(`add-hooks must be an array, got ${typeof rawHooksValue}. Skipping.`);
			} else {
				const rawHooks = rawHooksValue;
				const resolvedHooks: Array<Record<string, unknown>> = [];
				for (const hook of rawHooks) {
					const hookComponent = hook.component ?? "";
					if (!hookComponent) {
						// No component field — pass through as-is (command: field hooks)
						resolvedHooks.push(hook);
						continue;
					}
					const hookResolved = resolveComponentPath(
						hookComponent,
						"hooks",
						rootDir,
						context.projectDir || undefined,
					);
					if ("error" in hookResolved) {
						logWarn(`add-hooks not found: ${hookComponent} (${hookResolved.error})`);
					} else {
						resolvedHooks.push({
							...hook,
							source_path: hookResolved.path,
							display_name: hookResolved.displayName,
						});
					}
				}
				if (resolvedHooks.length > 0) {
					addHooks = resolvedHooks;
				}
			}
		}

		// Dispatch to each platform
		for (const platform of platforms) {
			const adapter = adapters.get(platform);
			if (!adapter) {
				logWarn(`${category}/${componentRef}: no adapter for platform '${platform}', skipping`);
				continue;
			}

			// Skip unsupported platform×category combinations entirely (no backup/wipe/dispatch).
			if (!SUPPORTED_CATEGORIES[platform]?.has(category)) {
				const unsupportedKey = `${platform}:${category}`;
				if (!unsupportedLogged.has(unsupportedKey)) {
					unsupportedLogged.add(unsupportedKey);
					logWarn(`Unsupported platform/category skipped: platform=${platform} category=${category}`);
				}
				continue;
			}

			// Declare this entry for this platform×category pair (see deployedNames
			// above) — the set diffed against the manifest's previous run below.
			if (category !== "rules") {
				const deployLocation = deployLocationForManifest(platform, category);
				let names = deployedNames.get(deployLocation);
				if (!names) {
					names = new Set<string>();
					deployedNames.set(deployLocation, names);
				}
				names.add(displayName);
			}

			// Record SOURCE paths for lib-dependency collection (independent of dryRun:
			// the lib scan reads source, never the deployed tree). The component itself
			// plus any add-hooks bundles it deploys may carry @lib/ imports.
			if (libSourceRoots) {
				addLibSourceRoot(libSourceRoots, platform, sourcePath);
				if (category === "agents" && Array.isArray(addHooks)) {
					for (const hook of addHooks) {
						if (
							typeof hook === "object" &&
							hook !== null &&
							"source_path" in hook &&
							typeof hook.source_path === "string" &&
							hook.source_path
						) {
							addLibSourceRoot(libSourceRoots, platform, hook.source_path);
						}
					}
				}
			}

			// Backup before first write for this platform×category. Orphan cleanup for
			// components removed from sync.yaml no longer wipes the whole category dir —
			// see the manifest-scoped reconcile after this loop, which removes only this
			// pair's own previously-deployed orphans and leaves foreign residents (a
			// Codex `.system` dir, a user-authored skill, etc.) untouched.
			const prepKey = `${platform}:${category}`;
			if (!preparedKeys.has(prepKey) && !context.dryRun) {
				await backupCategory(
					deployRoot,
					deployLocationForManifest(platform, category),
					category,
					context.backupDest,
				);
				preparedKeys.add(prepKey);
			}

			if (context.dryRun) {
				logDry(`[${platform}] ${category}/${displayName}`);
				continue;
			}

			// Call the appropriate adapter method
			if (category === "agents") {
				await adapter.syncAgentsDirect(
					deployRoot,
					displayName,
					sourcePath,
					addSkills,
					addHooks,
					false,
					context.modelMaps.get(platform) ?? context.rootModelMaps.get(platform),
				);
			} else if (category === "commands") {
				await adapter.syncCommandsDirect(deployRoot, displayName, sourcePath, false);
			} else if (category === "skills") {
				await adapter.syncSkillsDirect(deployRoot, displayName, sourcePath, false);
			} else if (category === "scripts") {
				await adapter.syncScriptsDirect(deployRoot, displayName, sourcePath, false);
			} else if (category === "rules") {
				await adapter.syncRulesDirect(deployRoot, displayName, sourcePath, false);
			}
		}
	}

	// Manifest-scoped orphan removal: for each deploy location this category
	// deployed to, remove only entries OMT itself previously deployed for this
	// pair that are no longer declared — never a foreign resident, and never
	// anything under "rules" (deployedNames stays empty for rules, so this loop
	// is a no-op there). deployedNames is already keyed by deploy LOCATION
	// (deployLocationForManifest), so no further mapping is needed here.
	if (!context.dryRun) {
		for (const [deployLocation, names] of deployedNames) {
			await reconcilePairManifest(deployRoot, deployLocation, category, [...names]);
		}
	}

	// One-time fossil cleanup: `.codex/skills` is the pre-b9908fbc deploy location,
	// dead now that Codex skills route to `.agents/skills` (deployLocationForManifest).
	// Codex 0.144.1 reads BOTH roots, so a populated fossil duplicates every skill in
	// the session prompt. Runs once per deployRoot (syncCategory itself is called once
	// per deployRoot per category), guarded on codex having actually been a target for
	// skills THIS run — deployedNames is keyed by deploy LOCATION, so "agents" present
	// here means codex+skills was declared (never fires for a claude/gemini-only run).
	// Cleanup runs even under dryRun (it reports via logDry); the manifest key is only
	// pruned after a successful (non-dry) cleanup, so a thrown cleanup leaves the
	// ownership record intact for the next run to retry against.
	if (category === "skills" && deployedNames.has("agents")) {
		await cleanupCodexSkillsFossil(
			deployRoot,
			context.backupDest,
			context.dryRun,
			deployedNames.get("agents") ?? new Set(),
		);
		if (!context.dryRun) {
			await removeManifestPair(deployRoot, "codex", "skills");
		}
	}
}

// ---------------------------------------------------------------------------
// syncPlatformConfigs
// ---------------------------------------------------------------------------

const KNOWN_PLATFORMS: Platform[] = ["claude", "gemini", "codex", "opencode"];

/**
 * Discover {platform}.yaml files in yamlDir, parse each, and call
 * adapter.syncPlatformYaml(). Stores results in context.
 *
 * Solves P2-1: no subshell — model maps are stored directly in context.modelMaps.
 */
export async function syncPlatformConfigs(
	context: SyncContext,
	targetPath: string,
	yamlDir: string,
	adapters: AdapterMap,
	rootDir: string,
	libSourceRoots?: LibSourceRoots,
): Promise<void> {
	for (const platform of KNOWN_PLATFORMS) {
		const merged = await parseAndMergePlatformYaml(yamlDir, platform);
		if (merged === null) {
			continue;
		}

		logInfo(`Per-platform YAML 감지: ${platform}.yaml`);

		const adapter = adapters.get(platform);
		if (!adapter) {
			logWarn(`${platform}: adapter 없음, 스킵`);
			continue;
		}

		const parsedYaml: PlatformYaml = merged;

		// Pre-resolve hook component paths before passing to adapter
		if (parsedYaml.hooks !== null && parsedYaml.hooks !== undefined) {
			const hooksMap = parsedYaml.hooks;
			for (const [hookEvent, items] of Object.entries(hooksMap)) {
				if (!Array.isArray(items)) continue;
				const resolvedItems = [];
				for (const item of items) {
					const component = item.component ?? "";
					if (!component) {
						resolvedItems.push(item);
						continue;
					}
					const resolved = resolveComponentPath(
						component,
						"hooks",
						rootDir,
						context.projectDir || undefined,
					);
					if ("error" in resolved) {
						logWarn(`hook component not found: ${component}`);
						// Skip this item — do not add to resolvedItems
					} else {
						resolvedItems.push({ ...item, component: resolved.path });
						// Record the hook SOURCE so syncLib deploys any @lib/ deps it imports.
						if (libSourceRoots) {
							addLibSourceRoot(libSourceRoots, platform, resolved.path);
						}
					}
				}
				hooksMap[hookEvent] = resolvedItems;
			}
		}

		// No local try/catch here: any error from syncPlatformYaml propagates
		// straight to the per-worktree catch in processYaml, which records this
		// deploy root in failedTargets so the CLI exits non-zero. A swallowed
		// config/hooks/plugins error meant a worktree's .claude was silently left
		// unsynced while the run reported success — the warn-and-continue here
		// was a pre-fan-out relic. (ProjectKeyError also propagates for the same
		// reason — a local MCP not written to ~/.claude.json.)
		const pluginScope: PluginScope = context.isRootYaml ? "user" : "project";
		const result = await adapter.syncPlatformYaml(
			targetPath,
			parsedYaml,
			context.dryRun,
			pluginScope,
		);

		if (result.processedSections.length > 0) {
			context.platformYamlSections.set(platform, result.processedSections);
			logInfo(`${platform}.yaml 처리 완료: ${result.processedSections.join(", ")}`);
		}

		if (result.modelMap) {
			context.modelMaps.set(platform, result.modelMap);
		}
	}
}

// ---------------------------------------------------------------------------
// syncDocs
// ---------------------------------------------------------------------------

/** Read a docs item's declared fields uniformly for both the string shorthand and the object form. */
function docsItemFields(item: DocsItem): {
	componentName: string;
	itemPath: string | undefined;
	as: string | undefined;
	isDelete: boolean;
} {
	if (typeof item === "string") {
		return { componentName: item, itemPath: undefined, as: undefined, isDelete: false };
	}
	return {
		componentName: item.component,
		itemPath: item.path,
		as: item.as,
		isDelete: item.delete === true,
	};
}

/** Recursively list every FILE (not directory) under `dir`, as absolute paths. [] if `dir` is absent. */
async function listFilesRecursive(dir: string): Promise<string[]> {
	const results: string[] = [];
	let entries: import("fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return results;
	}
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await listFilesRecursive(fullPath)));
		} else if (entry.isFile()) {
			results.push(fullPath);
		}
	}
	return results;
}

/**
 * Recursively search `dir` for the first symlinked entry (file or directory),
 * without following it. Returns its absolute path, or null if the tree is
 * symlink-free. Used to reject a dir-form docs source that contains a
 * human-planted symlink pointing outside the docs tree.
 */
async function findSymlinkInTree(dir: string): Promise<string | null> {
	let entries: import("fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isSymbolicLink()) return fullPath;
		if (entry.isDirectory()) {
			const found = await findSymlinkInTree(fullPath);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Back up every file currently under `targetDir` (recursively), preserving
 * substructure. `backupDocs` only ever copies a single file, so a whole-tree
 * backup is this per-file loop over it. No-op if targetDir is absent/empty.
 */
async function backupDocsTree(targetDir: string, deployRoot: string, sessionId: string): Promise<void> {
	for (const file of await listFilesRecursive(targetDir)) {
		await backupDocs(file, deployRoot, sessionId);
	}
}

/**
 * Reject a docs deploy/delete target whose path — walked segment by segment
 * from just under deployRoot down to and including absTarget itself — passes
 * through a symlink anywhere along the way.
 *
 * Lexical containment (assertDocsTargetContained) is a string check and
 * cannot see what's actually on disk: a human-planted symlink at an
 * intermediate directory, or at the leaf target itself, would otherwise be
 * silently followed by mkdir/copyFile/rm — escaping the docs tree entirely.
 * This is the runtime-only counterpart that closes that gap.
 *
 * Only EXISTING segments are checked; a segment that doesn't exist yet means
 * nothing below it can exist either, so the walk stops there.
 */
async function assertNoSymlinkInTargetPath(absTarget: string, deployRoot: string): Promise<void> {
	const rel = path.relative(deployRoot, absTarget);
	const segments = rel.split(path.sep).filter((segment) => segment.length > 0);

	let current = deployRoot;
	for (const segment of segments) {
		current = path.join(current, segment);
		let st: import("fs").Stats;
		try {
			st = await fs.lstat(current);
		} catch {
			return; // Doesn't exist yet — nothing below it can exist either.
		}
		if (st.isSymbolicLink()) {
			throw new Error(`docs: refusing to write through symlink at ${current}`);
		}
	}
}

/**
 * Compute a file-form docs item's real write path: `absTarget`, with the
 * source's extension appended unless `absTarget` already ends with that same
 * extension — avoids `x.md.md`. Checking `absTarget`'s OWN extname (the old
 * approach) misfires on a dotted stem like `api.v2`: `path.extname` reports
 * `.v2` as an extension already present and wrongly suppresses the append,
 * losing `.md` entirely. Comparing against the SOURCE's extension specifically
 * (via endsWith) is what correctly distinguishes "already has this extension"
 * from "has an unrelated dot in the name".
 */
function docsFileFinalTarget(absTarget: string, sourceFile: string): string {
	const sourceExt = path.extname(sourceFile);
	return absTarget.endsWith(sourceExt) ? absTarget : absTarget + sourceExt;
}

/**
 * Remove a single stale FILE squatting at a dir-form docs item's own
 * (pre-extension) target path, backing it up first — otherwise the
 * mkdir/copyFile in deployDocsDir would ENOTDIR trying to write files under a
 * path that's currently a file. Only ever inspects `absTarget` itself; a
 * sibling item's target is never touched.
 *
 * File-form has NO equivalent call: its real write leaf carries an appended
 * extension (docsFileFinalTarget), so a directory sitting at the bare,
 * pre-extension stem never collides with it on disk — anti-wipe wins, that
 * directory is simply left alone (AC3.4 vs anti-wipe reconciliation).
 *
 * NEVER removes a directory — that would be an undeclared-human-dir wipe. If
 * a directory sits at the exact leaf being deployed (e.g. a directory
 * literally named `foo.md` squatting a file-form leaf), this function is not
 * called for that path at all; copyFile is left to fail loudly instead.
 */
async function cleanStaleDocsForm(absTarget: string, deployRoot: string, sessionId: string): Promise<void> {
	let existing: import("fs").Stats;
	try {
		existing = await fs.stat(absTarget);
	} catch {
		return; // Nothing there — no stale form to clean.
	}
	if (existing.isDirectory()) return; // Already the right form — additive merge handles it.

	await backupDocs(absTarget, deployRoot, sessionId);
	await fs.rm(absTarget, { force: true }); // Non-recursive: a single file, never a directory.
}

/**
 * Write one docs FILE target at its real, already-resolved leaf
 * (`finalTarget` — post-extension, computed once by the caller via
 * docsFileFinalTarget): back up whatever currently sits there, then copy the
 * source over it unconditionally (declared items always overwrite). No
 * opposite-form cleaning here — see cleanStaleDocsForm's doc comment for why
 * file-form never needs it.
 */
async function deployDocsFile(
	sourceFile: string,
	finalTarget: string,
	deployRoot: string,
	sessionId: string,
): Promise<void> {
	await backupDocs(finalTarget, deployRoot, sessionId);
	await fs.mkdir(path.dirname(finalTarget), { recursive: true });
	await fs.copyFile(sourceFile, finalTarget);
}

/**
 * Write one docs DIRECTORY target: clean a stale squatting file at the
 * target (see cleanStaleDocsForm), then additively copy every precomputed
 * source→dest pair — the caller's own read-only Pass 1 enumeration, shared
 * with the dry-run preview and the collision check, never re-derived here —
 * backing up each destination file before overwrite. NEVER wipes/mirrors the
 * target dir — an undeclared file already inside it is never enumerated
 * here, so it survives untouched.
 *
 * Guards EACH destination file individually right before its own mkdir/
 * copyFile: the coarse guard the caller already ran against `absTarget` only
 * reaches the item's own bare stem, not a symlink planted deeper at some
 * nested intermediate segment (e.g. `absTarget/sub` when the real write is
 * `absTarget/sub/x.md`) — only a per-file, full deployRoot→destFile walk
 * catches that write-escape.
 */
async function deployDocsDir(
	absTarget: string,
	files: { source: string; dest: string }[],
	deployRoot: string,
	sessionId: string,
): Promise<void> {
	await cleanStaleDocsForm(absTarget, deployRoot, sessionId);

	for (const { source, dest } of files) {
		await assertNoSymlinkInTargetPath(dest, deployRoot);
		await backupDocs(dest, deployRoot, sessionId);
		await fs.mkdir(path.dirname(dest), { recursive: true });
		await fs.copyFile(source, dest);
	}
}

/** Delete one docs target (file or directory), backing it up first. Idempotent: no-op if already absent. */
async function deleteDocsTarget(absTarget: string, deployRoot: string, sessionId: string): Promise<void> {
	let st: import("fs").Stats;
	try {
		st = await fs.stat(absTarget);
	} catch {
		return;
	}
	if (st.isDirectory()) {
		await backupDocsTree(absTarget, deployRoot, sessionId);
	} else {
		await backupDocs(absTarget, deployRoot, sessionId);
	}
	await fs.rm(absTarget, { recursive: true, force: true });
}

/**
 * Discover on-disk delete candidates for a delete:true item's bare stem. A
 * delete item has no source file, so — unlike a write item — its real leaf
 * isn't computable ahead of time; it must be discovered by basename directly
 * under the stem's parent directory.
 *
 * An entry matches when its name is EXACTLY the stem's basename (a dir-form
 * or extensionless-file candidate) or the stem's basename plus a literal `.`
 * AND the entry is a regular file (a file-form candidate carrying an
 * extension — stem `intro` matches `intro.md` but never `introduction.md`: a
 * bare `startsWith(base)` without the trailing dot would wrongly treat an
 * unrelated longer name as the same tombstone; the file-type check keeps a
 * human directory like `intro.assets/` from matching too).
 */
async function findDocsDeleteCandidates(absStem: string): Promise<string[]> {
	const dir = path.dirname(absStem);
	const base = path.basename(absStem);
	let entries: import("fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((entry) => entry.name === base || (entry.name.startsWith(`${base}.`) && entry.isFile()))
		.map((entry) => path.join(dir, entry.name));
}

/**
 * Deploy the `docs` component type: a NO-WIPE merge-patch onto a
 * human-co-authored folder. Unlike the OMT-owned CATEGORIES (which
 * backup+wipe+redeploy their whole target dir — see syncCategory above),
 * docs is additive per-file only: an undeclared file already present at or
 * under a docs target must always survive a sync. There is no per-platform
 * dispatch either — docs lands directly under deployRoot.
 *
 * Resolve-then-mutate, in passes, because `resolveDocsTarget` only returns a
 * BARE STEM (e.g. `docs/intro`, no extension) — the real materialized leaf
 * differs per form (file-form appends the source's extension via
 * docsFileFinalTarget; dir-form nests the source's files under the stem).
 * Collision detection, the symlink guard, and delete all have to key off that
 * REAL leaf, or they silently miss the path actually being written:
 *
 *   PASS 0 (lexical, no I/O): resolve each item's bare stem, and reject one
 *     that resolves to the docs base directory itself (finding6 — otherwise a
 *     single item could treat the whole shared folder as one target).
 *   PASS 1 (resolve, READ-ONLY): compute each item's REAL leaf(s) — stat/
 *     lstat/readdir only, no writes — so the collision check below still
 *     throws before any mutation, including dry-run. This is why collision
 *     detection can no longer be "purely lexical, no I/O" as it once was: the
 *     real leaf depends on the source's extension, which requires resolving
 *     and stat-ing the source. The property that survives is "before
 *     mutation", not "I/O-free".
 *   COLLISION: detectDocsTargetCollisions runs on the union of every real
 *     leaf (file leaves + dir-form destination files + delete candidates).
 *   PASS 2 (guard + mutate): for each real leaf, the runtime symlink guard
 *     fires — in dry-run too — immediately before that leaf would be written
 *     or removed.
 *
 * Under context.dryRun, every guard below still runs unconditionally — an
 * unsafe item is rejected, never previewed as a would-succeed write — but no
 * mutation happens: write/delete actions are logged via logDry instead of
 * executed, followed by an advisory pass listing every file already sitting
 * under the docs base that no item's write/delete plan would touch (the
 * operator's only stateless drift signal, since docs never wipes on its own).
 */
export async function syncDocs(
	context: SyncContext,
	syncYaml: SyncYaml,
	rootDir: string,
	deployRoot: string,
): Promise<string[]> {
	const section = syncYaml.docs;
	if (!section || !Array.isArray(section.items) || section.items.length === 0) {
		return [];
	}

	const items = section.items;
	const docsBase = path.posix.normalize(section.path ?? "docs");

	// PASS 0 (lexical, no I/O).
	const relStems = items.map((item) => {
		const { componentName, itemPath, as } = docsItemFields(item);
		const relStem = resolveDocsTarget(componentName, section.path, itemPath, as);
		// finding6 (defensive): an item resolving to the base directory itself
		// would let one item (e.g. `{component: '.', delete: true}`) treat the
		// ENTIRE shared docs folder as a single write/delete target — every
		// human file under it would be wiped. (Resolving to deployRoot itself
		// is already unreachable here: assertDocsTargetContained, called
		// inside resolveDocsTarget above, rejects a normalized "." before
		// returning.) Trailing slash(es) stripped before comparing: normalize
		// alone preserves a trailing slash on docsBase (e.g. "docs/" stays
		// "docs/") while relStem never carries one, so a raw string compare
		// would miss that case and let `{path: "docs/"}` bypass this guard.
		if (relStem.replace(/\/+$/, "") === docsBase.replace(/\/+$/, "")) {
			throw new Error(`docs: target resolves to the docs base directory itself — refusing: ${relStem}`);
		}
		return relStem;
	});

	// PASS 1 (resolve, READ-ONLY): each item's REAL materialized leaf(s).
	type DocsItemPlan =
		| { kind: "delete"; absTarget: string; candidates: string[] }
		| { kind: "file"; sourceFile: string; absTarget: string; finalTarget: string }
		| { kind: "dir"; absTarget: string; files: { source: string; dest: string }[] };

	const plans: (DocsItemPlan | null)[] = [];

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const { componentName, isDelete } = docsItemFields(item);
		const absTarget = path.join(deployRoot, relStems[i]);

		if (isDelete) {
			const candidates = await findDocsDeleteCandidates(absTarget);
			if (candidates.length > 1) {
				throw new Error(
					`docs: ambiguous tombstone — multiple candidates match ${relStems[i]}: [${candidates.join(", ")}]`,
				);
			}
			plans.push({ kind: "delete", absTarget, candidates });
			continue;
		}

		const resolved = resolveComponentPath(componentName, "docs", rootDir, context.projectDir || undefined);
		if ("error" in resolved) {
			logWarn(`docs/${componentName}: ${resolved.error}`);
			plans.push(null);
			continue;
		}

		// Runtime FS guard: refuse a source that is itself a symlink — never
		// materialize external content into the docs tree.
		const sourceLstat = await fs.lstat(resolved.path);
		if (sourceLstat.isSymbolicLink()) {
			throw new Error(`docs/${componentName}: source is a symlink — refusing to materialize external content`);
		}

		const sourceStat = await fs.stat(resolved.path);
		if (sourceStat.isDirectory()) {
			// Runtime FS guard: refuse a dir-form source containing a symlinked file.
			const symlinkPath = await findSymlinkInTree(resolved.path);
			if (symlinkPath) {
				throw new Error(
					`docs/${componentName}: source contains a symlink (${symlinkPath}) — refusing to materialize external content`,
				);
			}
			const files = (await listFilesRecursive(resolved.path)).map((source) => ({
				source,
				dest: path.join(absTarget, path.relative(resolved.path, source)),
			}));
			plans.push({ kind: "dir", absTarget, files });
		} else {
			const finalTarget = docsFileFinalTarget(absTarget, resolved.path);
			plans.push({ kind: "file", sourceFile: resolved.path, absTarget, finalTarget });
		}
	}

	// COLLISION: real leaves only (file leaves + dir-form destination files +
	// delete candidates) — a bare-stem check would miss a collision that only
	// appears post-extension (e.g. `intro` and `guide` renamed to `intro.md`
	// both landing on `docs/intro.md`).
	const leafSet: string[] = [];
	for (const plan of plans) {
		if (!plan) continue;
		if (plan.kind === "file") leafSet.push(plan.finalTarget);
		else if (plan.kind === "dir") leafSet.push(...plan.files.map((f) => f.dest));
		else leafSet.push(...plan.candidates);
	}
	const collisions = detectDocsTargetCollisions(leafSet);
	if (collisions.length > 0) {
		const detail = collisions.map((c) => `${c.kind}: [${c.targets.join(", ")}]`).join("; ");
		throw new Error(`docs: target collision detected — ${detail}`);
	}

	// PASS 2 (guard + mutate). Every target file any item resolves to touch
	// (write or delete) — dry-run only, feeds the advisory unmanaged-file pass
	// below. A delete:true item's own target counts as managed too: its
	// removal is already reported via its own dry-run line, so it must not
	// also surface as advisory drift.
	const managedTargets = new Set<string>();
	const writtenLeaves: string[] = [];

	for (const plan of plans) {
		if (!plan) continue;

		if (plan.kind === "delete") {
			// Coarse guard on the bare stem, mirroring the file/dir branches below
			// — usually a no-op (the bare stem rarely exists on disk verbatim),
			// but defends the case where it happens to coincide with the real
			// on-disk candidate (e.g. an explicit `as` already carrying the
			// extension).
			await assertNoSymlinkInTargetPath(plan.absTarget, deployRoot);

			const [candidate] = plan.candidates;
			if (candidate === undefined) continue; // No on-disk match — idempotent no-op.

			await assertNoSymlinkInTargetPath(candidate, deployRoot);
			if (context.dryRun) {
				managedTargets.add(candidate);
				logDry(`docs: would remove ${candidate}`);
			} else {
				await deleteDocsTarget(candidate, deployRoot, context.backupDest);
			}
			continue;
		}

		if (plan.kind === "file") {
			await assertNoSymlinkInTargetPath(plan.absTarget, deployRoot); // coarse: bare stem
			await assertNoSymlinkInTargetPath(plan.finalTarget, deployRoot); // real leaf
			if (context.dryRun) {
				managedTargets.add(plan.finalTarget);
				logDry(`docs: would write ${plan.finalTarget}`);
			} else {
				await deployDocsFile(plan.sourceFile, plan.finalTarget, deployRoot, context.backupDest);
				writtenLeaves.push(plan.finalTarget);
			}
			continue;
		}

		// plan.kind === "dir"
		await assertNoSymlinkInTargetPath(plan.absTarget, deployRoot); // coarse: the item's own bare stem
		if (context.dryRun) {
			for (const { dest } of plan.files) {
				await assertNoSymlinkInTargetPath(dest, deployRoot); // fine-grained: fires in dry-run too
				managedTargets.add(dest);
				logDry(`docs: would write ${dest}`);
			}
		} else {
			await deployDocsDir(plan.absTarget, plan.files, deployRoot, context.backupDest);
			writtenLeaves.push(...plan.files.map((f) => f.dest));
		}
	}

	if (!context.dryRun) return writtenLeaves;

	// Advisory unmanaged-file list (AC5.2c): every file already sitting under
	// the docs base that no item above would write or delete. NOT an error and
	// NOT swept — docs is no-wipe, so this is the only stateless signal that a
	// target has drifted from what sync.yaml declares (human-added, or the
	// operator deleted the source out from under a stale target).
	const docsBaseAbs = path.join(deployRoot, docsBase);
	for (const existingFile of (await listFilesRecursive(docsBaseAbs)).sort()) {
		if (!managedTargets.has(existingFile)) {
			logDry(`docs: advisory (unmanaged): ${existingFile}`);
		}
	}
	return [];
}

// ---------------------------------------------------------------------------
// syncLib
// ---------------------------------------------------------------------------

/**
 * Rewrite @lib/* import aliases and bundled bare specifiers in deployed .ts
 * files to relative paths. Mirrors rewrite_lib_aliases in sync.sh:1383-1405.
 *
 * Scope: this function walks ALL .ts files under platformRoot, not just the
 * files deployed in this sync invocation. That broad sweep is intentional and
 * safe for @lib/ aliases because that alias only appears in files that OMT
 * itself deployed — no user-authored file would reference it.
 *
 * Bundled bare specifiers (e.g. `picomatch`) are a different story: a user
 * could place their own .ts file under the platform root that imports the same
 * package. If that happens, this pass rewrites the user's import to the OMT
 * vendor path, coupling their file to OMT's bundle. Should a later sync
 * remove that bundle, the user's file would break. This is a known, accepted
 * limitation: the platform root is an area OMT manages via orphan-cleanup, so
 * the practical risk is negligible today. If a real user-file case arises,
 * narrow the rewrite scope to only the files deployed in the current sync run.
 */
export async function rewriteLibAliases(
	platformRoot: string,
	bundledPackages: Set<string>,
): Promise<void> {
	const tsFiles = await collectTsFiles(platformRoot);
	for (const filePath of tsFiles) {
		// Skip test files and lib/ itself
		if (filePath.endsWith(".test.ts")) continue;
		const rel = path.relative(platformRoot, filePath);
		if (rel.startsWith("lib/") || rel.startsWith("lib\\")) continue;

		let content: string;
		try {
			content = await fs.readFile(filePath, "utf8");
		} catch {
			continue;
		}

		const updated = rewriteLibImports(content, filePath, platformRoot, bundledPackages);

		if (updated !== content) {
			await fs.writeFile(filePath, updated, "utf8");
		}
	}
}

/**
 * Recursively collect all .ts files under a directory.
 */
async function collectTsFiles(dir: string): Promise<string[]> {
	const results: string[] = [];
	let entries: import("fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return results;
	}
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await collectTsFiles(fullPath)));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			results.push(fullPath);
		}
	}
	return results;
}

/**
 * Deploy lib/ directory to each platform target, then rewrite @lib/* aliases.
 * Mirrors sync_lib in sync.sh:1422-1457.
 *
 * Called AFTER category syncs, BEFORE rewritePlatformPaths.
 */
export async function syncLib(
	context: SyncContext,
	targetPath: string,
	rootDir: string,
	platforms: Platform[],
	libSourceRoots?: LibSourceRoots,
): Promise<void> {
	const libSrc = path.join(rootDir, "lib");
	if (!existsSync(libSrc)) {
		return;
	}

	// Static data files a lib module references at runtime via import.meta.dir
	// (e.g. lib/pins/tbox.yaml). Traced from the lib source tree, never globbed.
	// Copied verbatim (no alias rewrite — rewriteLibAliases only touches .ts).
	// Collected BEFORE the early-skip: it traces from SOURCE (independent of the
	// deployed tree), so a data file can be present even when requiredModules is
	// empty (notably in dry-run, where the stale prior deployment has no @lib/).
	const dataFiles = await collectLibDataFiles(libSrc);

	// Declared package names (dependencies ∪ devDependencies) from the OMT repo's
	// own package.json (rootDir IS the repo root — libSrc is rootDir/lib). Read
	// once: only DECLARED packages are eligible for sync-time bundling, so a bare
	// import of an undeclared package is never vendored. A root without a
	// package.json declares nothing → zero bundling (the empty-set default).
	const declaredPackages = await readPackageJsonDeps(rootDir).catch(() => new Set<string>());

	// lib is NOT an independent deploy target — it is a dependency of whatever
	// components landed. The resolved `platforms` cascades to ["claude"] when no
	// feature-platforms.lib is configured, but components resolve their OWN
	// platforms and populate libSourceRoots under each platform that received one.
	// Iterate the UNION so a component (with a bundled bare import) deployed to a
	// non-claude platform gets its matching lib/vendor bundle there too; otherwise
	// its rewritten source has no vendor target → ERR_MODULE_NOT_FOUND under node.
	// When components deploy only to claude (or nowhere), the union is exactly the
	// resolved `platforms`, so stale-lib cleanup and the claude default are
	// unchanged.
	const effectivePlatforms = new Set<Platform>([...platforms, ...(libSourceRoots?.keys() ?? [])]);

	for (const platform of effectivePlatforms) {
		const platformDir = path.join(targetPath, `.${platform}`);
		const libDest = path.join(platformDir, "lib");

		// Collect from component SOURCE (not the deployed tree): the deployed .ts
		// files have already had their `@lib/` aliases rewritten to relative paths
		// at copy time, so the deployed tree carries zero raw `@lib/` to match.
		const sourceRoots = libSourceRoots?.get(platform) ?? new Set<string>();
		const requiredModules = await collectRequiredLibModulesFromSources(sourceRoots, libSrc);

		// Discover bare npm imports across BOTH scan surfaces, intersecting each hit
		// with declared packages. A bare `import 'picomatch'` traces through no @lib/
		// alias, so it must be found wherever it sits:
		//   - component sourceRoots: the bare import lives directly in a component, OR
		//   - requiredModules: the bare import lives in a `lib/` module pulled in
		//     transitively via @lib/ (so it never appears in sourceRoots).
		// The resulting bundledPackages set names exactly the packages syncLib will
		// `bun build` into .{platform}/lib/vendor/ below, and is threaded into the
		// @lib/ rewriter (see rewriteLibAliases call) so those bare specifiers in
		// component files are repointed at the vendored bundles. Only DECLARED
		// packages bundle.
		const bundledPackages = new Set<string>();
		const recordBareImports = async (file: string): Promise<void> => {
			for (const specifier of await findBareNpmImports(file)) {
				// Reduce to the root package name (D-7: only the root package is
				// bundled, never a sub-path): "@scope/name/x" → "@scope/name",
				// "picomatch/lib/x" → "picomatch".
				const segments = specifier.split("/");
				const pkg = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
				if (declaredPackages.has(pkg)) {
					bundledPackages.add(pkg);
				}
			}
		};
		for (const root of sourceRoots) {
			let files: string[];
			try {
				const stat = await fs.stat(root);
				if (stat.isDirectory()) {
					files = await collectTsFiles(root);
				} else if (root.endsWith(".ts") && !root.endsWith(".test.ts")) {
					files = [root];
				} else {
					continue;
				}
			} catch {
				continue;
			}
			for (const file of files) {
				await recordBareImports(file);
			}
		}
		// Also scan the transitively-pulled lib modules: a declared bare import that
		// lives ONLY inside a `lib/` module (reached via @lib/) is invisible to the
		// sourceRoots scan above, so without this it would never be bundled.
		for (const libModule of requiredModules) {
			await recordBareImports(libModule);
		}

		// Data files (e.g. pins/tbox.yaml) are runtime assets for lib modules; with
		// zero modules deployed they have no consumer, so skip the whole lib deploy.
		// The skip relaxes to the UNION: a platform whose only lib need is a declared
		// bare import (zero @lib/ modules) must still deploy its lib dir so the
		// vendored bundle below can be produced — skip only when BOTH are empty.
		if (requiredModules.size === 0 && bundledPackages.size === 0) {
			// No @lib/ imports — remove any stale lib (dry-run: log only)
			if (context.dryRun) {
				if (existsSync(libDest)) {
					logDry(`Remove stale lib directory: ${libDest}`);
				}
			} else {
				try {
					await fs.rm(libDest, { recursive: true, force: true });
				} catch {
					// ignore
				}
			}
			logInfo(`No @lib/ imports found in .${platform}/, skipping lib deployment`);
			continue;
		}

		if (context.dryRun) {
			if (existsSync(libDest)) {
				logDry(`Remove stale lib directory: ${libDest}`);
			}
			logDry(`Deploy lib modules to ${libDest}/:`);
			for (const dep of requiredModules) {
				logDry(`  ${path.relative(libSrc, dep)}`);
			}
			for (const file of dataFiles) {
				logDry(`  ${path.relative(libSrc, file)}`);
			}
			for (const pkg of bundledPackages) {
				logDry(`  vendor/${pkg}.js (bun build --target=node)`);
			}
			logDry(`Rewrite @lib/* aliases in ${platformDir}/`);
		} else {
			// Build the new lib tree in a temp sibling directory (same filesystem as
			// libDest) so we can atomically swap it in via fs.rename.  The reader
			// always sees either the complete old lib or the complete new lib.
			const suffix = Math.random().toString(36).slice(2);
			const libTmp = path.join(platformDir, `lib.tmp-${suffix}`);
			const libOld = path.join(platformDir, `lib.old-${suffix}`);

			// Remove any leftover temp dirs from prior crashed runs.
			const platformEntries = await fs.readdir(platformDir).catch(() => []);
			for (const entry of platformEntries) {
				if (entry.startsWith("lib.tmp-") || entry.startsWith("lib.old-")) {
					await fs
						.rm(path.join(platformDir, entry), { recursive: true, force: true })
						.catch(() => undefined);
				}
			}

			// True once the live lib has been renamed to libOld but before the new
			// tree has taken its place — the window in which a failure would leave the
			// target with no live lib/ unless the catch restores the moved-aside copy.
			let movedAside = false;

			try {
				await fs.mkdir(libTmp, { recursive: true });
				for (const dep of requiredModules) {
					const relPath = path.relative(libSrc, dep);
					const destFile = path.join(libTmp, relPath);
					await fs.mkdir(path.dirname(destFile), { recursive: true });
					// A deployed lib module may itself carry a bundled bare specifier
					// (e.g. `import 'picomatch'`). rewriteLibAliases skips everything under
					// lib/, so the repoint must happen here at copy time — mirroring how
					// syncDirectory rewrites component files. Depth is computed from the
					// module's FINAL location (libDest = platformDir/lib), so the relative
					// prefix resolves to lib/vendor/<pkg>.js regardless of nesting.
					const finalFile = path.join(libDest, relPath);
					const srcContent = await fs.readFile(dep, "utf8");
					const rewritten = rewriteLibImports(srcContent, finalFile, platformDir, bundledPackages);
					await fs.writeFile(destFile, rewritten, "utf8");
				}
				for (const file of dataFiles) {
					const relPath = path.relative(libSrc, file);
					const destFile = path.join(libTmp, relPath);
					await fs.mkdir(path.dirname(destFile), { recursive: true });
					await fs.copyFile(file, destFile);
				}

				// Sync-time vendoring: bundle each declared bare-imported package into a
				// self-contained --target=node bundle (zero node_modules at runtime),
				// mirroring the Makefile's proven `bun build <pkg> --target=node` flags.
				// Output path mirrors the package name (a scoped name's "/" becomes a
				// vendor/@scope subdirectory). Inside the try-block / before the rename,
				// so a non-zero build exit throws → the catch removes libTmp and the
				// prior libDest stays intact (atomicity preserved).
				for (const pkg of bundledPackages) {
					const outFile = path.join(libTmp, "vendor", `${pkg}.js`);
					await fs.mkdir(path.dirname(outFile), { recursive: true });
					const proc = Bun.spawn(["bun", "build", pkg, "--target=node", "--outfile", outFile], {
						cwd: rootDir,
						stdout: "inherit",
						stderr: "inherit",
					});
					await proc.exited;
					if (proc.exitCode !== 0) {
						throw new Error(`bun build ${pkg} --target=node failed (exit ${proc.exitCode})`);
					}
				}

				// Atomic swap: rename old out, rename new in, remove old.
				if (existsSync(libDest)) {
					await fs.rename(libDest, libOld);
					movedAside = true;
				}
				await fs.rename(libTmp, libDest);
				movedAside = false;
				await fs.rm(libOld, { recursive: true, force: true }).catch(() => undefined);
			} catch (err) {
				// Clean up the temp tree. A failure BEFORE the swap (e.g. a non-zero
				// build exit) leaves the original lib untouched. But the swap is two
				// renames: if the second rename fails after the first moved the live lib
				// to libOld, the target is left with no live lib/ — restore it (best
				// effort) before re-throwing so the prior lib survives a failed swap.
				await fs.rm(libTmp, { recursive: true, force: true }).catch(() => undefined);
				if (movedAside && !existsSync(libDest) && existsSync(libOld)) {
					await fs.rename(libOld, libDest).catch(() => undefined);
				}
				throw err;
			}

			logInfo(`Deployed shared lib to .${platform}/lib/`);
			await rewriteLibAliases(platformDir, bundledPackages);
		}
	}
}

// ---------------------------------------------------------------------------
// rewritePlatformPaths
// ---------------------------------------------------------------------------

/**
 * De-Claude-ify deployed bytes for a non-claude platform, driven entirely by
 * the shared PLATFORM_REWRITE_RULES table (tools/lib/rewrite-rules.ts) — not
 * a hard-coded `.claude/` replace. Mirrors rewrite_platform_paths in
 * sync.sh:1407-1420, generalized to the full rule table (TODO 4).
 *
 * Cleaves by CONTENT TYPE, not by root: only `.md` — instruction text the
 * model reads — is ever rewritten (see collectMdFiles below). Programs that
 * RUN on Codex (`.ts`/`.sh`/`.js`/...) are never walked, because Claude
 * vocabulary inside them is often not a Claude-ism at all — e.g.
 * hooks/rules-injector's `.claude/rules` is one entry in a multi-ecosystem
 * rule-source enum (sibling to `.omo/rules`, `.cursor/rules`), and
 * skills/hud/scripts/transcript.ts's `subagent_type` is a struct field —
 * rewriting either breaks working code for a token that isn't OMT's platform
 * path or tool name at all. `.codex/agents/*.toml` (also program-adjacent,
 * generated from `agents/*.md`) gets the same rule table applied at
 * generation time in CodexAdapter.syncAgentsDirect instead of by this walk.
 *
 * Gemini/OpenCode have one deploy root (`.{platform}/`). Codex has TWO,
 * disjoint since commit b9908fbc: `.codex/` (agents, hooks, scripts, config,
 * lib) and `.agents/skills/<name>` (skills, manifest-owned). `codexSkillNames`
 * names exactly the skills OMT deployed to `.agents/skills` THIS run — the
 * only names this function is allowed to walk there; anything else under
 * `.agents/skills` (e.g. a foreign `plannotator-compound`) is left untouched.
 */
export async function rewritePlatformPaths(
	targetPath: string,
	platform: Platform,
	codexSkillNames: ReadonlySet<string> = new Set(),
): Promise<void> {
	const rules = PLATFORM_REWRITE_RULES[platform];
	// Claude's rule table is empty by design (tools/lib/rewrite-rules.ts) — this
	// return, BEFORE any directory is even computed, is what makes Claude's
	// deployed bytes invariant by construction (plan AC G4-10): no file under
	// .claude/ is ever opened by this function, so byte-identity is structural,
	// not merely asserted by a test.
	if (rules.length === 0) return;

	if (platform !== "codex") {
		await rewriteFilesUnder(path.join(targetPath, `.${platform}`), rules);
		return;
	}

	// Root 1: .codex/ (agents, hooks, scripts, config, lib), EXCLUDING
	// .codex/skills/** — the deprecated pre-b9908fbc fossil root.
	// cleanupCodexSkillsFossil removes only OMT-owned entries from it; whatever
	// survives (e.g. `.system`) is a foreign resident this function must never
	// touch.
	const codexDir = path.join(targetPath, ".codex");
	await rewriteFilesUnder(codexDir, rules, [path.join(codexDir, "skills")]);

	// Root 2: .agents/skills/<name>, manifest-owned only. For each owned skill,
	// also bake the contextual ${CLAUDE_SKILL_DIR} token to that skill's
	// absolute deployed dir (Claude Code expands the token at skill-injection
	// time; Codex has no expander, and a skill's shell command runs under the
	// agent's session cwd, not the skill dir, so only an absolute path resolves).
	for (const name of codexSkillNames) {
		const skillDir = path.join(codexSkillsDir(targetPath), name);
		await rewriteFilesUnder(skillDir, rules, [], (content) => bakeSkillDirToken(content, skillDir));
	}
}

// ---------------------------------------------------------------------------
// formatDeployedRoots
// ---------------------------------------------------------------------------

/**
 * Runs a declared post-deploy format command (SyncYaml `format:`) against the
 * OMT-managed roots under `deployRoot` — the existing OMT-managed platform dirs
 * (`.claude`/`.gemini`/`.codex`/`.opencode`), the per-name Codex skill dirs
 * OMT owns this run, and the docs leaf paths the caller deployed. Called from
 * processYaml's per-worktree deploy loop, right after `rewritePlatformPaths`,
 * when `syncYaml.format` is declared AND the run is non-dry-run. Deliberately
 * dry-run-agnostic itself — dry-run gating is the caller's responsibility, not
 * this function's; it always runs when given a non-empty command and a
 * non-empty root set.
 *
 * Ownership boundaries mirror rewritePlatformPaths: `.agents/skills` is never
 * passed whole, only per-name entries in `codexSkillNames`, so a foreign
 * resident skill directory is never handed to an external formatter.
 *
 * Only the `Bun.spawn` call itself is wrapped in try/catch because, unlike
 * the vendoring spawn above (`bun`, always present), `formatCmd` is an
 * arbitrary user-declared command — a missing binary throws synchronously
 * from `Bun.spawn` (ENOENT); `await proc.exited` never throws. The catch
 * re-throws that synchronous ENOENT as a plain Error; a non-zero exit is
 * checked and thrown separately, outside the try, so neither path double-wraps
 * the other's message. Either way the caller's best-effort handling (a
 * fatal-sync-error subclass check) does not mistake this for a fatal sync
 * error.
 */
export async function formatDeployedRoots(
	deployRoot: string,
	formatCmd: string | string[],
	docsDests: string[],
	codexSkillNames: ReadonlySet<string>,
): Promise<void> {
	// A string form is whitespace-tokenized (simple case, no quoting); an array
	// form is used verbatim as argv, so arguments containing spaces (e.g. a
	// config path) survive intact.
	const argv = (Array.isArray(formatCmd) ? formatCmd : formatCmd.split(/\s+/)).filter(Boolean);
	if (argv.length === 0) return;
	const cmdDisplay = Array.isArray(formatCmd) ? formatCmd.join(" ") : formatCmd;

	const managedRoots: string[] = [];
	for (const platform of KNOWN_PLATFORMS) {
		const platformDir = path.join(deployRoot, `.${platform}`);
		if (existsSync(platformDir)) managedRoots.push(platformDir);
	}
	for (const name of codexSkillNames) {
		const skillDir = path.join(codexSkillsDir(deployRoot), name);
		if (existsSync(skillDir)) managedRoots.push(skillDir);
	}
	managedRoots.push(...docsDests);

	if (managedRoots.length === 0) return;

	let proc: ReturnType<typeof Bun.spawn>;
	try {
		proc = Bun.spawn([...argv, ...managedRoots], {
			cwd: deployRoot,
			stdout: "inherit",
			stderr: "inherit",
		});
	} catch (err) {
		throw new Error(
			`format command '${cmdDisplay}' failed: ${err instanceof Error ? err.message : String(err)}`,
			{ cause: err },
		);
	}
	await proc.exited;
	if (proc.exitCode !== 0) {
		throw new Error(`format command '${cmdDisplay}' failed (exit ${proc.exitCode})`);
	}
}

/**
 * Apply `rules` (plus an optional per-file `extraTransform`, e.g. the
 * ${CLAUDE_SKILL_DIR} bake) to every rewrite-candidate file under `dir`,
 * writing back only files whose content actually changed. This IS the "does
 * any rule match" check (D2): a file no rule (and no extraTransform) touches
 * comes back identical and is never written.
 */
async function rewriteFilesUnder(
	dir: string,
	rules: readonly RewriteRule[],
	excludeDirs: string[] = [],
	extraTransform?: (content: string) => string,
): Promise<void> {
	const files = await collectMdFiles(dir, excludeDirs);
	for (const filePath of files) {
		let content: string;
		try {
			content = await fs.readFile(filePath, "utf8");
		} catch {
			continue;
		}
		let updated = applyRewriteRules(content, rules);
		if (extraTransform) updated = extraTransform(updated);
		if (updated !== content) {
			await fs.writeFile(filePath, updated, "utf8");
		}
	}
}

/**
 * Recursively collect `.md` files under `dir` — instruction text the model
 * reads, the only content type this rewrite ever touches. Programs that run
 * ON Codex (`.ts`/`.sh`/`.js`/...) are deliberately NEVER walked here: rows in
 * PLATFORM_REWRITE_RULES.codex translate Claude vocabulary for a model
 * reading prose, and applying them to source code corrupts it — e.g.
 * `.claude/rules` in hooks/rules-injector's multi-ecosystem rule-source enum
 * is a source-format name, not an OMT platform path, and `subagent_type` in
 * skills/hud/scripts/transcript.ts is a struct field, not the Claude tool
 * parameter. See the codex two-root policy on rewritePlatformPaths above.
 *
 * Exclusions:
 *   - `excludeDirs` (caller-supplied absolute paths): the .codex/skills
 *     fossil root, pruned so this walk never touches it.
 *   - `lib.tmp-*` / `lib.old-*`: syncLib's atomic-swap temp dirs — transient,
 *     never a stable deploy target. lib/ does carry .md, so this still
 *     matters even restricted to that one extension.
 */
async function collectMdFiles(dir: string, excludeDirs: string[] = []): Promise<string[]> {
	const results: string[] = [];
	let entries: import("fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return results;
	}
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (excludeDirs.includes(fullPath)) continue;
			if (/^lib\.(tmp|old)-/.test(entry.name)) continue;
			results.push(...(await collectMdFiles(fullPath, excludeDirs)));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push(fullPath);
		}
	}
	return results;
}

// ---------------------------------------------------------------------------
// Deploy-target dedup
// ---------------------------------------------------------------------------

/**
 * Resolve a path's deploy targets and record every one in processedPaths.
 *
 * Dedup is keyed by the RESOLVED deploy target (a bare container fans out to its
 * worktrees), never by the raw container path — otherwise a second sync.yaml
 * pointing directly at a worktree would not be recognized as already processed
 * and would re-deploy (backup+wipe+redeploy) the same .claude a second time.
 */
export function recordProcessedTargets(targetPath: string, processedPaths: Set<string>): void {
	for (const target of resolveDeployTargets(targetPath)) {
		processedPaths.add(target);
	}
}

/**
 * True when every resolved deploy target for targetPath is already present in
 * processedPaths (so the path can be skipped). Empty target sets never skip.
 */
export function allTargetsProcessed(targetPath: string, processedPaths: Set<string>): boolean {
	const targets = resolveDeployTargets(targetPath);
	return targets.length > 0 && targets.every((t) => processedPaths.has(t));
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * True when err is a "fatal" sync error that must always be rethrown rather
 * than downgraded to warn-and-continue.
 *
 * - ProjectKeyError: local MCP key-derivation failed — an MCP was silently
 *   not written to ~/.claude.json; swallowing would leave the user's config
 *   corrupted without any signal.
 * - DeployTargetsError: bare-repo enumeration failed or returned zero
 *   worktrees; the deployment has no valid target and continuing would silently
 *   write nothing.
 */
export function isFatalSyncError(err: unknown): boolean {
	return err instanceof ProjectKeyError || err instanceof DeployTargetsError;
}

// ---------------------------------------------------------------------------
// processYaml
// ---------------------------------------------------------------------------

/**
 * Process a single sync.yaml file:
 *   1. Parse YAML and extract path
 *   2. Set project context
 *   3. syncPlatformConfigs (per-platform YAML)
 *   4. syncCategory for each of 5 categories
 *   5. syncLib
 *   6. rewritePlatformPaths for non-claude platforms
 *
 * P2-3: NO config/hooks/mcps/plugins processing here.
 */
export async function processYaml(
	context: SyncContext,
	syncYamlPath: string,
	adapters: AdapterMap,
	rootDir: string,
): Promise<void> {
	// Read and parse
	let syncYaml: SyncYaml;
	try {
		const result = await readAndExpandSyncYaml(syncYamlPath);
		if (result === null) {
			logWarn(`YAML이 비어 있거나 유효한 객체가 아님: ${syncYamlPath}`);
			return;
		}
		syncYaml = result;
	} catch (err) {
		logError(`YAML 파싱 실패: ${syncYamlPath}: ${err}`);
		return;
	}

	const targetPath = syncYaml.path;
	if (!targetPath) {
		logWarn(`path가 정의되지 않음: ${syncYamlPath}`);
		return;
	}

	// Set project context on the mutable context object
	const projectCtx = setProjectContext(syncYaml, syncYamlPath, rootDir);
	context.projectName = projectCtx.projectName;
	context.projectDir = projectCtx.projectDir;
	context.isRootYaml = projectCtx.isRootYaml;

	logInfo("========================================");
	logInfo(`처리 중: ${syncYamlPath}`);
	logInfo(`대상: ${targetPath}`);
	if (context.projectName) {
		logInfo(`프로젝트: ${context.projectName}`);
	}
	logInfo("========================================");

	// Clear per-project state to prevent cross-project leaks
	context.modelMaps.clear();
	context.platformYamlSections.clear();

	// Per-platform YAML processing
	const yamlDir = path.dirname(syncYamlPath);

	// Resolve platforms for lib sync using the full cascade (item, section, syncYaml,
	// feature-platforms.lib, use-platforms, hardcoded ["claude"]).
	const libPlatforms = await resolvePlatforms(
		{ component: "" },
		undefined,
		syncYaml.platforms,
		"lib",
	);

	// Platforms eligible for the non-claude path-rewrite loop below: the union,
	// over every deployable category and every item in it, of that item's
	// resolved platform cascade — mirroring syncCategory's own per-item
	// resolvePlatforms(item, sectionPlatforms, syncYaml.platforms, category)
	// call exactly, so eligibility equals actual deployment by construction.
	// A project-level-only computation (fake item, no sectionPlatforms) would
	// miss an item- or section-level override that ADDS a non-claude platform.
	// This must key on CATEGORIES (feature-platforms.skills etc.), NOT
	// libPlatforms — feature-platforms has no `lib` entry, so libPlatforms
	// collapses to ["claude"] for any un-narrowed project and would wrongly
	// skip codex/gemini/opencode for the root self-deploy.
	const rewriteEligiblePlatforms = new Set<Platform>();
	// Skills this sync.yaml declares for codex, keyed by DEPLOYED directory name
	// (resolveComponentPath's displayName — a scoped ref like "proj:testing"
	// deploys as "testing", matching exactly what syncCategory later writes
	// under .agents/skills/). Collected in this same per-item cascade rather
	// than threaded out of syncCategory's local deployedNames map — this loop
	// already resolves every item, so a second plumbing path would only drift.
	const codexSkillNames = new Set<string>();
	for (const category of CATEGORIES) {
		const section = syncYaml[category];
		if (!section || !Array.isArray(section.items) || section.items.length === 0) continue;
		const sectionPlatforms = section.platforms;
		for (const item of section.items) {
			const platforms = await resolvePlatforms(item, sectionPlatforms, syncYaml.platforms, category);
			for (const platform of platforms) {
				rewriteEligiblePlatforms.add(platform);
			}
			if (category === "skills" && platforms.includes("codex")) {
				const componentRef = typeof item === "string" ? item : (item.component ?? "");
				if (componentRef) {
					const resolved = resolveComponentPath(
						componentRef,
						category,
						rootDir,
						context.projectDir || undefined,
					);
					if (!("error" in resolved)) {
						codexSkillNames.add(resolved.displayName);
					}
				}
			}
		}
	}

	// Parse claude.yaml once (it is colocated with sync.yaml in yamlDir, shared by
	// every worktree) so the per-worktree mkdir gate need not re-read it.
	const claudeYaml = await parseAndMergePlatformYaml(yamlDir, "claude");
	const shouldMkdirClaude = deploysToClaudeDotDir(syncYaml, claudeYaml);

	// Fan-out (D-1): a bare-structure container deploys into EVERY linked
	// worktree's .claude/; a plain path resolves to [path] (today's behavior).
	// targetPath (the container) is NEVER written to — it is the dedup/identity
	// anchor (processedPaths) and, for a bare structure, a dead-letter.
	// resolveDeployTargets throws DeployTargetsError on git-enumeration failure or
	// an empty worktree set — let it escape so it surfaces as a non-zero exit.
	const deployRoots = resolveDeployTargets(targetPath);

	for (const deployRoot of deployRoots) {
		try {
			// Per-deploy backup destination (D-5): computed once per (target,
			// worktree), before any deploy step. This is the only site that holds
			// targetPath (the container) and deployRoot (the worktree)
			// simultaneously, so it is the only site where the id CAN be computed —
			// generating it lower (e.g. inside backupDocs, called from 6+ places)
			// would scatter one deploy's backups across 6+ random directories.
			// Writers read this back off the context exactly as they read
			// context.backupDest at HEAD, so their signatures never change.
			context.backupDest = path.join(
				context.backupBase,
				"sync-backup",
				`${deriveProjectName(targetPath)}-${path.basename(deployRoot)}-${generateBackupSessionId()}`,
			);
			// This deploy's actual backup directory — the only breadcrumb an
			// operator has to recover from a clobber, since this backup design
			// has no restore path (logBackupLocation only prints the shared
			// parent, not this per-deploy destination).
			logInfo(`백업 대상: ${context.backupDest}`);

			// Each worktree's deploy is independent — fresh source-root accumulator so
			// syncLib targets this deployRoot's .{platform}/lib only.
			const libSourceRoots: LibSourceRoots = new Map();

			// Per-worktree dry-run target line (AC6.1): list this worktree, never the
			// container, as a deploy target.
			if (context.dryRun) {
				logDry(`Deploy target: ${deployRoot}`);
			}

			// Ensure <deployRoot>/.claude exists only when something deploys into it
			// (non-dry). The container is never the mkdir target (AC2.2): an MCP-only
			// project writes to ~/.claude.json, not <deployRoot>/.claude/.
			if (!context.dryRun && shouldMkdirClaude) {
				await fs.mkdir(path.join(deployRoot, ".claude"), { recursive: true });
			}

			await syncPlatformConfigs(context, deployRoot, yamlDir, adapters, rootDir, libSourceRoots);

			// Sync 5 categories
			for (const category of CATEGORIES) {
				await syncCategory(
					context,
					category,
					syncYaml,
					adapters,
					rootDir,
					deployRoot,
					libSourceRoots,
				);
			}

			// Sync lib — whenever this deploy target received deployable source. The
			// mkdir gate (shouldMkdirClaude) only sees component sections + .claude/
			// config, so a codex/gemini-hook-only project (hooks deployed and recorded
			// in libSourceRoots by syncPlatformConfigs above, but shouldMkdirClaude
			// false) would otherwise never vendor its hooks' bare imports → the
			// deployed hook crashes at runtime with an unresolved import. An MCP-only
			// project (shouldMkdirClaude=false AND libSourceRoots empty) keeps the gate
			// false, so syncLib never reaches into the worktree's .{platform}/lib to
			// delete a directory this sync never owns.
			if (shouldMkdirClaude || libSourceRoots.size > 0) {
				await syncLib(context, deployRoot, rootDir, libPlatforms, libSourceRoots);
			}

			// Sync docs — unconditional (not gated on shouldMkdirClaude): docs is
			// platform-agnostic and lands directly under deployRoot, so a docs-only
			// project (no CATEGORIES items, no .claude) must still deploy its docs.
			const docsDests = await syncDocs(context, syncYaml, rootDir, deployRoot);

			// Rewrite platform paths for non-claude platforms
			const nonClaudePlatforms: Platform[] = ["gemini", "codex", "opencode"];
			for (const platform of nonClaudePlatforms) {
				const platformDir = path.join(deployRoot, `.${platform}`);
				// Eligible = this sync deployed to the platform via a component category
				// (rewriteEligiblePlatforms) OR via a hook/lib deploy recorded in
				// libSourceRoots (a codex/gemini-hook-only project — same signal the
				// syncLib gate above keys on). Without the libSourceRoots arm, a copied
				// hook README's .claude/ references stay un-rewritten under .{platform}/.
				//
				// A codex-skills-only project never creates .codex/ at all (skills land
				// under .agents/skills, not .codex/skills) — codexSkillNames.size > 0 is
				// the second, independent trigger that covers exactly that case (D4).
				const codexSkillsPresent = platform === "codex" && codexSkillNames.size > 0;
				if (
					(existsSync(platformDir) || codexSkillsPresent) &&
					(rewriteEligiblePlatforms.has(platform) || libSourceRoots.has(platform))
				) {
					if (context.dryRun) {
						logDry(`Rewrite .claude/ paths -> .${platform}/ in ${platformDir}/`);
					} else {
						await rewritePlatformPaths(deployRoot, platform, codexSkillNames);
					}
				}
			}

			if (syncYaml.format && !context.dryRun) {
				await formatDeployedRoots(deployRoot, syncYaml.format, docsDests, codexSkillNames);
			}
		} catch (err) {
			// Fatal errors (MCP key-derivation or topology failure) must never be
			// downgraded: rethrow so they surface as a non-zero exit.
			if (isFatalSyncError(err)) {
				throw err;
			}
			// Best-effort fan-out (AC3a/3b): one failing worktree is logged WITH its
			// path and recorded; the loop continues to the other worktrees. A non-empty
			// failedTargets later forces the CLI to exit non-zero.
			logError(`worktree 배포 실패 (계속 진행): ${deployRoot}: ${err}`);
			context.failedTargets.push(deployRoot);
		}
	}

	// Per-yaml provision: run after all components deployed, at this yaml's deploy targets.
	// Non-fatal and dryRun-safe — a missing/failed provision never breaks sync.
	runProvision(syncYaml.provision ?? [], deployRoots, { dryRun: context.dryRun });

	logSuccess(`완료: ${syncYamlPath}`);
}

// ---------------------------------------------------------------------------
// loadRootModelMaps
// ---------------------------------------------------------------------------

/**
 * Load the root/global model-maps once, before any project or root sync.yaml
 * is processed. Root-only categories like "agents" are declared exclusively
 * in projects/*\/sync.yaml (no project ships its own codex.yaml/opencode.yaml),
 * while the model-map itself lives only in the root {platform}.yaml — and
 * projects/*\/sync.yaml runs BEFORE the root sync.yaml (runProjectsLoop, then
 * the root pass), with context.modelMaps cleared at the start of every
 * processYaml call. Without this, context.modelMaps.get("codex") is empty
 * for every project agent dispatch. context.rootModelMaps is populated here
 * exactly once and is never cleared, so it survives across every processYaml
 * call in the run.
 */
export async function loadRootModelMaps(rootDir: string): Promise<Map<Platform, ModelMap>> {
	const out = new Map<Platform, ModelMap>();
	for (const platform of ["codex", "opencode"] as const) {
		const merged = await parseAndMergePlatformYaml(rootDir, platform);
		const mm = merged?.["model-map"];
		if (mm) out.set(platform, mm);
	}
	return out;
}

/**
 * Thrown by resolveBackupBase() when the resolved OMT_DIR would make the
 * backup-retention pruner's recursive rm far more destructive than intended
 * (relative path, "/", or the user's home directory). Never process.exit —
 * that would kill the in-process test runner. The CLI entry point is
 * responsible for catching this and exiting non-zero.
 */
export class UnsafeBackupRootError extends Error {}

/**
 * Returns true if `err` is a Node.js errno exception (has a `code` field).
 */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err;
}

/**
 * Resolves the OMT-owned backup root for this run and guarantees the
 * directory exists — WITHOUT ever creating a degenerate root first.
 *
 * Order is load-bearing: resolveOmtDir() only computes the path (no fs
 * writes), so isSafeBackupRoot() can reject it BEFORE getOmtDir()'s
 * unconditional mkdirSync ever runs. Calling getOmtDir() first would create
 * the degenerate directory (e.g. <cwd>/rel/ for a relative OMT_DIR) and then
 * refuse to prune it — exactly the pollution this function exists to avoid.
 * The guard runs regardless of dryRun, so a degenerate root still throws
 * during a dry run.
 *
 * @param dryRun - When true, skip getOmtDir()'s mkdirSync and return the
 *                 already-computed path instead — a dry run must not create
 *                 the base directory as a side effect.
 */
export function resolveBackupBase(dryRun = false): string {
	const base = resolveOmtDir();
	if (!isSafeBackupRoot(base)) {
		throw new UnsafeBackupRootError(`안전하지 않은 백업 루트: ${base}`);
	}
	// The string guard above accepts a non-degenerate *spelling*, but base may
	// be an absolute symlink whose real target is "/" or $HOME. The write path
	// (context.backupDest → backup writers) follows that symlink and dumps
	// backups into the degenerate location, which cleanupOldBackups's F2 guard
	// then refuses to prune — so backups pile up unreachable. Re-validate the
	// real path here so both `make sync` and `make sync-dry` fail-fast, exactly
	// as cleanupOldBackups does before pruning.
	let realBase = base;
	try {
		realBase = realpathSync(base);
	} catch (err) {
		// base doesn't exist yet (first run) — can't be a symlink, fall through.
		if (!isErrnoException(err) || err.code !== "ENOENT") {
			throw err;
		}
	}
	if (!isSafeBackupRoot(realBase)) {
		throw new UnsafeBackupRootError(`안전하지 않은 백업 루트(실제 경로): ${realBase}`);
	}
	return dryRun ? base : getOmtDir();
}

// ---------------------------------------------------------------------------
// createContext
// ---------------------------------------------------------------------------

/**
 * Create an initial SyncContext for a sync run.
 */
export function createContext(dryRun: boolean): SyncContext {
	const backupBase = resolveBackupBase(dryRun);
	return {
		dryRun,
		projectName: "",
		projectDir: "",
		isRootYaml: true,
		backupBase,
		// Initialized to backupBase, never "" — an empty string would make
		// join("", platform, category) relative, so any reader that ran before
		// the fan-out assignment (sync.ts fan-out loop) would write into the
		// process cwd. No such reader exists today (every writer runs inside
		// the fan-out loop); this is a cheap seatbelt against that defect class.
		backupDest: backupBase,
		modelMaps: new Map(),
		rootModelMaps: new Map(),
		processedPaths: new Set(),
		platformYamlSections: new Map(),
		failedTargets: [],
	};
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

export function printUsage(): void {
	process.stderr.write(
		[
			"Usage: bun tools/sync.ts [options]",
			"",
			"Options:",
			"  --dry-run              Preview changes without writing files",
			"  --verbose              Print detailed per-project/category logs",
			"  --projects <name,...>  Process only the named project(s) (comma-separated)",
			"  --help                 Show this help message",
			"",
		].join("\n"),
	);
}

export function parseCliArgs(args: string[]): {
	dryRun: boolean;
	verbose: boolean;
	projectFilter: Set<string>;
} {
	let dryRun = false;
	let verbose = false;
	const projectFilter = new Set<string>();

	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === "--dry-run") {
			dryRun = true;
		} else if (arg === "--verbose") {
			verbose = true;
		} else if (arg === "--projects") {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) {
				logError("--projects 플래그에 값이 필요합니다 (예: --projects foo,bar)");
				process.exit(1);
			}
			for (const name of value.split(",")) {
				const trimmed = name.trim();
				if (trimmed) projectFilter.add(trimmed);
			}
			i++;
		} else if (arg === "--help") {
			printUsage();
			process.exit(0);
		} else if (arg.startsWith("--")) {
			logWarn(`알 수 없는 플래그: ${arg}`);
		}
		i++;
	}

	return { dryRun, verbose, projectFilter };
}

/** Effective filter: CLI > config > undefined. */
export function resolveProjectFilter(
	cliFilter: Set<string>,
	enabledProjects: string[] | undefined,
): Set<string> | undefined {
	if (cliFilter.size > 0) return cliFilter;
	if (enabledProjects !== undefined && enabledProjects.length > 0) {
		return new Set(enabledProjects);
	}
	return undefined;
}

export async function runProjectsLoop(
	rootDir: string,
	adapters: AdapterMap,
	context: SyncContext,
	effectiveFilter: Set<string> | undefined,
	verbose: boolean,
): Promise<void> {
	const projectsDir = path.join(rootDir, "projects");
	if (effectiveFilter !== undefined) {
		for (const name of effectiveFilter) {
			const projectDir = path.join(projectsDir, name);
			if (!existsSync(projectDir)) {
				logWarn(`프로젝트 디렉토리 없음, 스킵: ${name}`);
			}
		}
	}

	if (existsSync(projectsDir)) {
		const projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
		for (const entry of projectEntries) {
			if (!entry.isDirectory()) continue;
			if (effectiveFilter !== undefined && !effectiveFilter.has(entry.name)) continue;
			const projectSyncYaml = path.join(projectsDir, entry.name, "sync.yaml");
			if (!existsSync(projectSyncYaml)) continue;

			let syncYaml: SyncYaml;
			try {
				const result = await readAndExpandSyncYaml(projectSyncYaml);
				if (result === null) continue;
				syncYaml = result;
			} catch {
				continue;
			}

			const targetPath = syncYaml.path;
			if (!targetPath) continue;

			if (verbose) {
				logInfo(`[verbose] 프로젝트 시작: ${entry.name}`);
			}
			try {
				await processYaml(context, projectSyncYaml, adapters, rootDir);
				// Dedup is keyed by the resolved deploy targets (a bare container's
				// worktrees), not the raw container path, so a later sync.yaml pointing
				// straight at a worktree is recognized as already processed.
				recordProcessedTargets(targetPath, context.processedPaths);
			} catch (err) {
				// Fatal errors (MCP key-derivation or topology failure) must escape to
				// the top-level handler so the run exits non-zero.
				if (isFatalSyncError(err)) {
					throw err;
				}
				logError(`프로젝트 처리 실패 (계속 진행): ${projectSyncYaml}: ${err}`);
			}
			if (verbose) {
				logInfo(`[verbose] 프로젝트 완료: ${entry.name}`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Codex CLI version guard
// ---------------------------------------------------------------------------

/** DI hooks for {@link assertCodexVersionIfTargeted}; both default to the real check. */
export type CodexVersionCheckOptions = {
	isCodexTargetPlatform?: () => Promise<boolean>;
	fetchVersion?: () => string;
};

/** True when "codex" is a configured target platform for any deployed category. */
async function defaultIsCodexTargetPlatform(): Promise<boolean> {
	for (const category of CATEGORIES) {
		const platforms = await getFeaturePlatforms(category);
		if (platforms.includes("codex")) return true;
	}
	return false;
}

/**
 * Run-aware replacement for {@link defaultIsCodexTargetPlatform}: true only if
 * some component in a sync.yaml that THIS run will actually process resolves
 * to the "codex" platform. Mirrors the sync.yaml enumeration + filter
 * semantics of {@link runProjectsLoop} and the root-run block in the CLI entry
 * point, instead of scanning every category's GLOBAL feature-platforms
 * (which ignores `--projects` filtering and per-item platform overrides).
 */
export async function isCodexTargetedForRun(
	rootDir: string,
	effectiveFilter: Set<string> | undefined,
	includeRoot: boolean,
): Promise<boolean> {
	const syncYamlPaths: string[] = [];

	const projectsDir = path.join(rootDir, "projects");
	if (existsSync(projectsDir)) {
		const entries = await fs.readdir(projectsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (effectiveFilter !== undefined && !effectiveFilter.has(entry.name)) continue;
			const candidate = path.join(projectsDir, entry.name, "sync.yaml");
			if (existsSync(candidate)) syncYamlPaths.push(candidate);
		}
	}

	if (includeRoot) {
		const rootSyncYaml = path.join(rootDir, "sync.yaml");
		if (existsSync(rootSyncYaml)) syncYamlPaths.push(rootSyncYaml);
	}

	for (const syncYamlPath of syncYamlPaths) {
		let syncYaml: SyncYaml | null;
		try {
			syncYaml = await readAndExpandSyncYaml(syncYamlPath);
		} catch {
			continue;
		}
		// No `path` means the sync.yaml is an unconfigured template — runProjectsLoop
		// and the root-run block both skip it, so it deploys nothing either.
		if (!syncYaml || !syncYaml.path) continue;

		const syncYamlPlatforms = syncYaml.platforms;

		for (const category of SUPPORTED_CATEGORIES.codex) {
			const sectionData = syncYaml[category];
			if (!sectionData || !Array.isArray(sectionData.items)) continue;

			const sectionPlatforms = sectionData.platforms;
			for (const item of sectionData.items) {
				const platforms = await resolvePlatforms(item, sectionPlatforms, syncYamlPlatforms, category);
				if (platforms.includes("codex")) return true;
			}
		}
	}

	return false;
}

function defaultFetchCodexVersion(): string {
	// env explicitly passed (not left to spawn's default) so a runtime PATH
	// override — e.g. a test stubbing `codex` on a temp dir PATH — is honored;
	// Bun's spawn PATH resolution otherwise caches PATH from process start.
	return execFileSync("codex", ["--version"], {
		stdio: ["pipe", "pipe", "pipe"],
		env: process.env,
	}).toString();
}

/**
 * Guards the installed Codex CLI version against the probe-verified allowlist
 * (config.yaml `codex-versions`) before any deploy work runs. Skipped
 * entirely when codex isn't a configured target platform, so a codex-free
 * sync never requires codex to be installed.
 */
export async function assertCodexVersionIfTargeted(
	options: CodexVersionCheckOptions = {},
): Promise<void> {
	const isTargeted = options.isCodexTargetPlatform ?? defaultIsCodexTargetPlatform;
	const fetchVersion = options.fetchVersion ?? defaultFetchCodexVersion;

	if (!(await isTargeted())) return;

	const raw = fetchVersion();
	const observed = parseCodexVersion(raw);
	if (observed === null) {
		throw new Error(`Codex CLI 버전 파싱 실패: "codex --version" 출력이 "${raw.trim()}"`);
	}

	const allowed = await getCodexVersions();
	assertCodexVersionAllowed(observed, allowed);
}

/**
 * Logs the OMT-owned sync-backup root for this run.
 */
export function logBackupLocation(base: string): void {
	logInfo(`백업 위치: ${base}/sync-backup`);
}

/**
 * Prunes old backups under the OMT-owned shared root. Prune the single shared
 * OMT-owned root only — no longer a union with the per-worktree deploy-root
 * set. This deliberately gives up the prior success-only invariant (only
 * worktrees that finished cleanly were pruned): the shared root is pruned
 * unconditionally now, by age. See the plan's ACCEPTED CONSEQUENCES — backups
 * are write-only and git-recoverable, so this trade is accepted.
 */
export async function cleanupRunBackups(base: string, dryRun: boolean): Promise<void> {
	if (dryRun) return;
	const retentionDays = await getBackupRetentionDays();
	await cleanupOldBackups(base, retentionDays).catch(() => {});
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
	const args = process.argv.slice(2);
	const { dryRun, verbose, projectFilter } = parseCliArgs(args);

	if (dryRun) {
		logWarn("========== DRY-RUN 모드 (실제 변경 없음) ==========");
	}

	const rootDir = getRootDir();
	if (!rootDir) {
		logError("config.yaml를 찾을 수 없음. 실행 위치를 확인하세요.");
		process.exit(1);
	}

	let context: SyncContext;
	try {
		context = createContext(dryRun);
	} catch (err) {
		if (err instanceof UnsafeBackupRootError) {
			logError(err.message);
			process.exit(1);
		}
		throw err;
	}
	context.rootModelMaps = await loadRootModelMaps(rootDir);

	logBackupLocation(context.backupBase);

	const adapters: AdapterMap = new Map<Platform, PlatformAdapter>();
	adapters.set("claude", new ClaudeAdapter());
	adapters.set("gemini", new GeminiAdapter());
	adapters.set("codex", new CodexAdapter());
	adapters.set("opencode", opencodeAdapter);

	try {
		// projects/*/sync.yaml 먼저 처리
		const enabledProjects = await getEnabledProjects();
		const effectiveFilter = resolveProjectFilter(projectFilter, enabledProjects);

		// 배포 작업 이전에 Codex CLI 버전을 검증된 허용목록과 대조 (이번 실행이 실제로
		// 처리할 sync.yaml 중 codex를 대상으로 하는 컴포넌트가 있을 때만). includeRoot는
		// 아래 루트 sync.yaml 처리 조건(projectFilter.size === 0)과 동일해야 한다.
		await assertCodexVersionIfTargeted({
			isCodexTargetPlatform: () =>
				isCodexTargetedForRun(rootDir, effectiveFilter, projectFilter.size === 0),
		});

		await runProjectsLoop(rootDir, adapters, context, effectiveFilter, verbose);

		// 루트 sync.yaml 처리 (이미 처리된 path는 스킵, 프로젝트 필터 미적용)
		// projectFilter(raw CLI)가 비어있을 때만 루트 실행: CLI --projects는 "이 기기에서 이 프로젝트만" 일회성 의도이므로 글로벌 루트도 제외.
		// effectiveFilter(config enabled-projects 포함)와 다른 것은 의도된 비대칭 — config는 디바이스 프로필이라 루트(글로벌)는 항상 실행. README "루트 sync.yaml은 영향 받지 않습니다" 참조.
		if (projectFilter.size === 0) {
			const rootSyncYaml = path.join(rootDir, "sync.yaml");
			if (existsSync(rootSyncYaml)) {
				let syncYaml: SyncYaml;
				try {
					const result = await readAndExpandSyncYaml(rootSyncYaml);
					syncYaml = result ?? {};
				} catch {
					syncYaml = {};
				}

				const targetPath = syncYaml.path;
				if (!targetPath) {
					logInfo("루트 sync.yaml에 path가 정의되지 않음 (템플릿 상태)");
				} else if (allTargetsProcessed(targetPath, context.processedPaths)) {
					// Skip only when EVERY resolved deploy target was already processed by
					// projects/ — a root path that resolves to the same worktree(s) as a
					// project container would otherwise re-deploy the same .claude.
					logWarn(`${targetPath}는 projects/에서 이미 처리됨, 스킵`);
				} else {
					if (verbose) {
						logInfo("[verbose] 루트 sync.yaml 처리 시작");
					}
					await processYaml(context, rootSyncYaml, adapters, rootDir);
					recordProcessedTargets(targetPath, context.processedPaths);
					if (verbose) {
						logInfo("[verbose] 루트 sync.yaml 처리 완료");
					}
				}
			}
		}

		if (dryRun) {
			logWarn("========== DRY-RUN 완료 ==========");
		} else {
			logSuccess("========== 동기화 완료 ==========");
		}

		await cleanupRunBackups(context.backupBase, dryRun);
		// Any worktree that failed during the best-effort fan-out forces a non-zero
		// exit: an unwritable worktree must never be reported as a clean sync.
		if (context.failedTargets.length > 0) {
			logError(
				`일부 worktree 배포 실패 (${context.failedTargets.length}개): ${context.failedTargets.join(", ")}`,
			);
		}
		process.exit(context.failedTargets.length > 0 ? 1 : 0);
	} catch (err) {
		logError(`동기화 실패: ${err}`);
		process.exit(1);
	}
}
