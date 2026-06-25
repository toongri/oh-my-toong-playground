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
import { existsSync } from "fs";

import type {
  Platform,
  Category,
  PlatformYaml,
  SyncItem,
  SyncYaml,
  SyncContext,
  PluginScope,
} from "./lib/types.ts";
import { getRootDir, getBackupRetentionDays, getEnabledProjects } from "./lib/config.ts";
import { readAndExpandSyncYaml } from "./lib/parse-sync-yaml.ts";
import { parseAndMergePlatformYaml } from "./lib/parse-platform-yaml.ts";
import {
  resolvePlatforms,
  resolveComponentPath,
  setProjectContext,
} from "./lib/resolver.ts";
import { generateBackupSessionId, backupCategory, cleanupOldBackups } from "./lib/backup.ts";
import { logInfo, logWarn, logError, logDry, logSuccess } from "./lib/logger.ts";
import { ProjectKeyError } from "./lib/git-key.ts";
import { resolveDeployTargets, DeployTargetsError } from "./lib/resolve-deploy-targets.ts";
import { syncDirectory, rewriteLibImports } from "./lib/sync-directory.ts";
import {
  collectRequiredLibModulesFromSources,
  collectLibDataFiles,
  findBareNpmImports,
  readPackageJsonDeps,
} from "./adapters/ts-lib-deps.ts";
import { runProvision } from "./lib/provision.ts";
import { ClaudeAdapter } from "./adapters/claude.ts";
import { GeminiAdapter } from "./adapters/gemini.ts";
import { CodexAdapter } from "./adapters/codex.ts";
import { opencodeAdapter } from "./adapters/opencode.ts";
import type { PlatformAdapter } from "./adapters/types.ts";

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
    if (section == null || typeof section !== "object") return false;
    const items = (section as Record<string, unknown>)["items"];
    return Array.isArray(items) && items.length > 0;
  });
  const hasClaudeDotFileDeploy =
    parsedClaudeYaml != null && Object.keys(parsedClaudeYaml).some((k) => k !== "mcps");
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
  codex: new Set(["skills", "scripts"]),
  opencode: new Set(["agents", "commands", "skills", "scripts", "rules"]),
};

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
  const section = syncYaml[category as keyof SyncYaml] as
    | { platforms?: Platform[]; items?: SyncItem[] }
    | undefined;
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

  for (const item of items) {
    const componentRef =
      typeof item === "string" ? item : item.component ?? "";

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
    const platforms = await resolvePlatforms(
      item,
      sectionPlatforms,
      syncYamlPlatforms,
      category,
    );

    // Resolve add-skills (agents category only)
    let addSkills: string[] | undefined;
    if (category === "agents" && typeof item === "object" && item["add-skills"]) {
      const rawSkillsValue = item["add-skills"];
      if (!Array.isArray(rawSkillsValue)) {
        logWarn(`add-skills must be an array, got ${typeof rawSkillsValue}. Skipping.`);
      } else {
        const rawSkills = rawSkillsValue as string[];
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
        const rawHooks = rawHooksValue as Array<Record<string, unknown>>;
        const resolvedHooks: Array<Record<string, unknown>> = [];
        for (const hook of rawHooks) {
          const hookComponent = (hook["component"] as string | undefined) ?? "";
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
      if (!SUPPORTED_CATEGORIES[platform]?.has(category)) continue;

      // Record SOURCE paths for lib-dependency collection (independent of dryRun:
      // the lib scan reads source, never the deployed tree). The component itself
      // plus any add-hooks bundles it deploys may carry @lib/ imports.
      if (libSourceRoots) {
        addLibSourceRoot(libSourceRoots, platform, sourcePath);
        if (category === "agents" && Array.isArray(addHooks)) {
          for (const hook of addHooks as Array<{ source_path?: string }>) {
            if (typeof hook.source_path === "string" && hook.source_path) {
              addLibSourceRoot(libSourceRoots, platform, hook.source_path);
            }
          }
        }
      }

      // Backup before first write for this platform×category
      const prepKey = `${platform}:${category}`;
      if (!preparedKeys.has(prepKey) && !context.dryRun) {
        await backupCategory(
          deployRoot,
          platform,
          category,
          context.backupSession,
        );
        preparedKeys.add(prepKey);
        // Wipe category dir so orphan files from removed components are cleaned up.
        // Rules are excluded: they may contain user-managed files.
        if (category !== "rules") {
          const categoryDir = path.join(deployRoot, `.${platform}`, category);
          await fs.rm(categoryDir, { recursive: true, force: true });
          await fs.mkdir(categoryDir, { recursive: true });
        }
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
          context.modelMaps.get(platform),
        );
      } else if (category === "commands") {
        await adapter.syncCommandsDirect(
          deployRoot,
          displayName,
          sourcePath,
          false,
        );
      } else if (category === "skills") {
        await adapter.syncSkillsDirect(
          deployRoot,
          displayName,
          sourcePath,
          false,
        );
      } else if (category === "scripts") {
        await adapter.syncScriptsDirect(
          deployRoot,
          displayName,
          sourcePath,
          false,
        );
      } else if (category === "rules") {
        await adapter.syncRulesDirect(
          deployRoot,
          displayName,
          sourcePath,
          false,
        );
      }
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
    if (parsedYaml.hooks != null) {
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

    try {
      const pluginScope: PluginScope = context.isRootYaml ? "user" : "project";
      const result = await adapter.syncPlatformYaml(targetPath, parsedYaml, context.dryRun, pluginScope);

      if (result.processedSections.length > 0) {
        context.platformYamlSections.set(platform, result.processedSections);
        logInfo(`${platform}.yaml 처리 완료: ${result.processedSections.join(", ")}`);
      }

      if (result.modelMap) {
        context.modelMaps.set(platform, result.modelMap);
      }
    } catch (err) {
      // Rethrow so the per-worktree catch in processYaml records this deploy root
      // in failedTargets and the CLI exits non-zero. A swallowed config/hooks/
      // plugins error meant a worktree's .claude was silently left unsynced while
      // the run reported success — the warn-and-continue here was a pre-fan-out
      // relic. (ProjectKeyError is rethrown for the same reason — a local MCP not
      // written to ~/.claude.json.)
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// syncLib
// ---------------------------------------------------------------------------

/**
 * Rewrite @lib/* import aliases and bundled bare specifiers in deployed .ts
 * files to relative paths. Mirrors rewrite_lib_aliases in sync.sh:1383-1405.
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
    entries = (await fs.readdir(dir, { withFileTypes: true })) as import("fs").Dirent[];
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
        const pkg = specifier.startsWith("@")
          ? segments.slice(0, 2).join("/")
          : segments[0];
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
      const platformEntries = await fs.readdir(platformDir).catch(() => [] as string[]);
      for (const entry of platformEntries) {
        if (entry.startsWith("lib.tmp-") || entry.startsWith("lib.old-")) {
          await fs.rm(path.join(platformDir, entry), { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
      }

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
          const proc = Bun.spawn(
            ["bun", "build", pkg, "--target=node", "--outfile", outFile],
            { cwd: rootDir, stdout: "inherit", stderr: "inherit" },
          );
          await proc.exited;
          if (proc.exitCode !== 0) {
            throw new Error(`bun build ${pkg} --target=node failed (exit ${proc.exitCode})`);
          }
        }

        // Atomic swap: rename old out, rename new in, remove old.
        if (existsSync(libDest)) {
          await fs.rename(libDest, libOld);
        }
        await fs.rename(libTmp, libDest);
        await fs.rm(libOld, { recursive: true, force: true }).catch(() => undefined);
      } catch (err) {
        // Build failed — clean up temp, leave the original lib untouched.
        await fs.rm(libTmp, { recursive: true, force: true }).catch(() => undefined);
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
 * For non-claude platforms: find deployed .md files and replace .claude/ references
 * with .<platform>/. Mirrors rewrite_platform_paths in sync.sh:1407-1420.
 */
export async function rewritePlatformPaths(
  targetPath: string,
  platform: Platform,
): Promise<void> {
  if (platform === "claude") return;

  const platformDir = path.join(targetPath, `.${platform}`);
  const mdFiles = await collectMdFiles(platformDir);

  for (const filePath of mdFiles) {
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    if (!content.includes(".claude/")) continue;

    const updated = content.replace(/\.claude\//g, `.${platform}/`);
    await fs.writeFile(filePath, updated, "utf8");
  }
}

/**
 * Recursively collect all .md files under a directory.
 */
async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as import("fs").Dirent[];
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectMdFiles(fullPath)));
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
    if (result == null) {
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
  const libPlatforms = await resolvePlatforms({} as SyncItem, undefined, syncYaml.platforms, "lib");

  // Parse claude.yaml once (it is colocated with sync.yaml in yamlDir, shared by
  // every worktree) so the per-worktree mkdir gate need not re-read it.
  const claudeYaml = await parseAndMergePlatformYaml(yamlDir, "claude");
  const shouldMkdirClaude = deploysToClaudeDotDir(syncYaml as Record<string, unknown>, claudeYaml);

  // Fan-out (D-1): a bare-structure container deploys into EVERY linked
  // worktree's .claude/; a plain path resolves to [path] (today's behavior).
  // targetPath (the container) is NEVER written to — it is the dedup/identity
  // anchor (processedPaths) and, for a bare structure, a dead-letter.
  // resolveDeployTargets throws DeployTargetsError on git-enumeration failure or
  // an empty worktree set — let it escape so it surfaces as a non-zero exit.
  const deployRoots = resolveDeployTargets(targetPath);

  for (const deployRoot of deployRoots) {
    try {
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
        await syncCategory(context, category, syncYaml, adapters, rootDir, deployRoot, libSourceRoots);
      }

      // Sync lib — only when this project deploys local component files into the
      // platform dir (same gate as the mkdir above). An MCP-only project
      // (shouldMkdirClaude=false) targets ~/.claude.json, so syncLib must not
      // reach into the worktree's .{platform}/lib and delete a directory this
      // sync never owns.
      if (shouldMkdirClaude) {
        await syncLib(context, deployRoot, rootDir, libPlatforms, libSourceRoots);
      }

      // Record this worktree as a backup root ONLY after all sync steps succeeded.
      // Registering before the steps (or on failure) would let retention cleanup
      // prune the last good backup of a worktree whose deploy threw — it must hold
      // a success-only invariant: failed worktrees go to failedTargets, not here.
      context.backupRoots.add(deployRoot);

      // Rewrite platform paths for non-claude platforms
      for (const platform of (["gemini", "codex", "opencode"] as Platform[])) {
        const platformDir = path.join(deployRoot, `.${platform}`);
        if (existsSync(platformDir)) {
          if (context.dryRun) {
            logDry(`Rewrite .claude/ paths -> .${platform}/ in ${platformDir}/`);
          } else {
            await rewritePlatformPaths(deployRoot, platform);
          }
        }
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
// createContext
// ---------------------------------------------------------------------------

/**
 * Create an initial SyncContext for a sync run.
 */
export function createContext(dryRun: boolean): SyncContext {
  return {
    dryRun,
    projectName: "",
    projectDir: "",
    isRootYaml: true,
    backupSession: generateBackupSessionId(),
    modelMaps: new Map(),
    processedPaths: new Set(),
    platformYamlSections: new Map(),
    backupRoots: new Set(),
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
        if (result == null) continue;
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

  const context = createContext(dryRun);

  logInfo(`백업 세션: ${context.backupSession}`);
  logInfo(`백업 위치: ${rootDir}/.sync-backup/${context.backupSession}/`);

  const adapters: AdapterMap = new Map<Platform, PlatformAdapter>();
  adapters.set("claude", new ClaudeAdapter());
  adapters.set("gemini", new GeminiAdapter());
  adapters.set("codex", new CodexAdapter());
  adapters.set("opencode", opencodeAdapter);

  try {
    // projects/*/sync.yaml 먼저 처리
    const enabledProjects = await getEnabledProjects();
    const effectiveFilter = resolveProjectFilter(projectFilter, enabledProjects);
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

    // 오래된 백업 정리
    const cleanupPromises: Promise<void>[] = [];
    if (!dryRun) {
      const retentionDays = await getBackupRetentionDays();
      // Union of processedPaths (container, drives deploy dedup) and backupRoots (per-worktree
      // deploy roots populated during fan-out). Set-union ensures a non-bare path present in
      // both is cleaned exactly once.
      const cleanupTargets = new Set<string>([...context.processedPaths, ...context.backupRoots]);
      for (const target of cleanupTargets) {
        cleanupPromises.push(cleanupOldBackups(target, retentionDays).catch(() => {}));
      }
    }

    if (dryRun) {
      logWarn("========== DRY-RUN 완료 ==========");
    } else {
      logSuccess("========== 동기화 완료 ==========");
    }

    await Promise.all(cleanupPromises);
    // Any worktree that failed during the best-effort fan-out forces a non-zero
    // exit: an unwritable worktree must never be reported as a clean sync.
    if (context.failedTargets.length > 0) {
      logError(`일부 worktree 배포 실패 (${context.failedTargets.length}개): ${context.failedTargets.join(", ")}`);
    }
    process.exit(context.failedTargets.length > 0 ? 1 : 0);
  } catch (err) {
    logError(`동기화 실패: ${err}`);
    process.exit(1);
  }
}
