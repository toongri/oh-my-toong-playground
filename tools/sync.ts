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
import { parse as parseYaml } from "yaml";

import type {
  Platform,
  Category,
  SyncItem,
  SyncYaml,
  SyncContext,
} from "./lib/types.ts";
import { getRootDir, getBackupRetentionDays } from "./lib/config.ts";
import {
  resolvePlatforms,
  resolveComponentPath,
  setProjectContext,
} from "./lib/resolver.ts";
import { generateBackupSessionId, backupCategory, cleanupOldBackups } from "./lib/backup.ts";
import { logInfo, logWarn, logError, logDry, logSuccess } from "./lib/logger.ts";
import { syncDirectory } from "./lib/sync-directory.ts";
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

// ---------------------------------------------------------------------------
// syncCategory
// ---------------------------------------------------------------------------

/** All categories handled by syncCategory. */
const CATEGORIES: Category[] = ["agents", "commands", "skills", "scripts", "rules"];

/**
 * Platform×category capability map.
 * Only combinations listed here proceed through backup+wipe+dispatch.
 * Unsupported combos (e.g., codex+agents) are skipped entirely.
 */
const SUPPORTED_CATEGORIES: Record<string, Set<Category>> = {
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
      const rawSkills = item["add-skills"] as string[];
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

    // Resolve add-hooks (agents category only)
    let addHooks: unknown[] | undefined;
    if (category === "agents" && typeof item === "object" && item["add-hooks"]) {
      const rawHooks = item["add-hooks"] as Array<Record<string, unknown>>;
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

    // Dispatch to each platform
    for (const platform of platforms) {
      const adapter = adapters.get(platform);
      if (!adapter) {
        logWarn(`${category}/${componentRef}: no adapter for platform '${platform}', skipping`);
        continue;
      }

      // Skip unsupported platform×category combinations entirely (no backup/wipe/dispatch).
      if (!SUPPORTED_CATEGORIES[platform]?.has(category)) continue;

      // Backup before first write for this platform×category
      const prepKey = `${platform}:${category}`;
      if (!preparedKeys.has(prepKey) && !context.dryRun) {
        await backupCategory(
          syncYaml.path ?? "",
          platform,
          category,
          context.backupSession,
        );
        preparedKeys.add(prepKey);
        // Wipe category dir so orphan files from removed components are cleaned up.
        // Rules are excluded: they may contain user-managed files.
        if (category !== "rules") {
          const categoryDir = path.join(syncYaml.path ?? "", `.${platform}`, category);
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
          syncYaml.path ?? "",
          displayName,
          sourcePath,
          addSkills,
          addHooks,
          false,
          context.modelMaps.get(platform),
        );
      } else if (category === "commands") {
        await adapter.syncCommandsDirect(
          syncYaml.path ?? "",
          displayName,
          sourcePath,
          false,
        );
      } else if (category === "skills") {
        await adapter.syncSkillsDirect(
          syncYaml.path ?? "",
          displayName,
          sourcePath,
          false,
        );
      } else if (category === "scripts") {
        await adapter.syncScriptsDirect(
          syncYaml.path ?? "",
          displayName,
          sourcePath,
          false,
        );
      } else if (category === "rules") {
        await adapter.syncRulesDirect(
          syncYaml.path ?? "",
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
): Promise<void> {
  for (const platform of KNOWN_PLATFORMS) {
    const platformYamlPath = path.join(yamlDir, `${platform}.yaml`);
    if (!existsSync(platformYamlPath)) {
      continue;
    }

    logInfo(`Per-platform YAML 감지: ${platform}.yaml`);

    const adapter = adapters.get(platform);
    if (!adapter) {
      logWarn(`${platform}: adapter 없음, 스킵`);
      continue;
    }

    let parsedYaml: Record<string, unknown>;
    try {
      const text = await fs.readFile(platformYamlPath, "utf8");
      const parsed = parseYaml(text);
      if (parsed == null || typeof parsed !== "object") {
        logWarn(`${platform}.yaml이 비어있거나 유효하지 않음, 스킵`);
        continue;
      }
      parsedYaml = parsed as Record<string, unknown>;
    } catch (err) {
      logWarn(`${platform}.yaml 파싱 실패: ${err}`);
      continue;
    }

    // Pre-resolve hook component paths before passing to adapter
    if (parsedYaml["hooks"] != null) {
      const hooksMap = parsedYaml["hooks"] as Record<string, Array<Record<string, unknown>>>;
      for (const [hookEvent, items] of Object.entries(hooksMap)) {
        if (!Array.isArray(items)) continue;
        const resolvedItems: Array<Record<string, unknown>> = [];
        for (const item of items) {
          const component = (item["component"] as string | undefined) ?? "";
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
          }
        }
        hooksMap[hookEvent] = resolvedItems;
      }
    }

    try {
      const result = await adapter.syncPlatformYaml(targetPath, parsedYaml, context.dryRun);

      if (result.processedSections.length > 0) {
        context.platformYamlSections.set(platform, result.processedSections);
        logInfo(`${platform}.yaml 처리 완료: ${result.processedSections.join(", ")}`);
      }

      if (result.modelMap) {
        context.modelMaps.set(platform, result.modelMap);
      }
    } catch (err) {
      logWarn(`${platform}.yaml 처리 실패: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// syncLib
// ---------------------------------------------------------------------------

/**
 * Rewrite @lib/* import aliases in deployed .ts files to relative paths.
 * Mirrors rewrite_lib_aliases in sync.sh:1383-1405.
 */
export async function rewriteLibAliases(platformRoot: string): Promise<void> {
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

    if (!content.includes("@lib/")) continue;

    const dir = path.dirname(filePath);
    const relDir = path.relative(platformRoot, dir);
    const depth = relDir === "" ? 0 : relDir.split(path.sep).length;
    const prefix = depth === 0 ? "./" : "../".repeat(depth);

    const updated = content
      .replace(/'@lib\//g, `'${prefix}lib/`)
      .replace(/"@lib\//g, `"${prefix}lib/`);

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
): Promise<void> {
  const libSrc = path.join(rootDir, "lib");
  if (!existsSync(libSrc)) {
    return;
  }

  for (const platform of platforms) {
    const platformDir = path.join(targetPath, `.${platform}`);
    const libDest = path.join(platformDir, "lib");

    if (context.dryRun) {
      logDry(`Deploy lib: lib/ -> ${libDest}/`);
      logDry(`Rewrite @lib/* aliases in ${platformDir}/`);
    } else {
      // Remove and recreate lib dir
      try {
        await fs.rm(libDest, { recursive: true, force: true });
      } catch {
        // ignore
      }
      await fs.mkdir(libDest, { recursive: true });
      await syncDirectory(libSrc, libDest, { exclude: ["*.test.ts"] });
      logInfo(`Deployed shared lib to .${platform}/lib/`);
      await rewriteLibAliases(platformDir);
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
  let rawText: string;
  try {
    rawText = await fs.readFile(syncYamlPath, "utf8");
  } catch {
    logWarn(`YAML 파일 없음: ${syncYamlPath}`);
    return;
  }

  let syncYaml: SyncYaml;
  try {
    const parsed = parseYaml(rawText);
    if (parsed == null || typeof parsed !== "object") {
      logWarn(`YAML이 비어 있거나 유효한 객체가 아님: ${syncYamlPath}`);
      return;
    }
    syncYaml = parsed as SyncYaml;
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

  // Ensure .claude directory exists (non-dry)
  if (!context.dryRun) {
    await fs.mkdir(path.join(targetPath, ".claude"), { recursive: true });
  }

  // Clear per-project state to prevent cross-project leaks
  context.modelMaps.clear();
  context.platformYamlSections.clear();

  // Per-platform YAML processing
  const yamlDir = path.dirname(syncYamlPath);
  await syncPlatformConfigs(context, targetPath, yamlDir, adapters, rootDir);

  // Resolve platforms for lib sync using the full cascade (item, section, syncYaml,
  // feature-platforms.lib, use-platforms, hardcoded ["claude"]).
  const libPlatforms = await resolvePlatforms({} as SyncItem, undefined, syncYaml.platforms, "lib");

  // Sync 5 categories
  for (const category of CATEGORIES) {
    await syncCategory(context, category, syncYaml, adapters, rootDir);
  }

  // Sync lib
  await syncLib(context, targetPath, rootDir, libPlatforms);

  // Rewrite platform paths for non-claude platforms
  for (const platform of (["gemini", "codex", "opencode"] as Platform[])) {
    const platformDir = path.join(targetPath, `.${platform}`);
    if (existsSync(platformDir)) {
      if (context.dryRun) {
        logDry(`Rewrite .claude/ paths -> .${platform}/ in ${platformDir}/`);
      } else {
        await rewritePlatformPaths(targetPath, platform);
      }
    }
  }

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
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

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
    const projectsDir = path.join(rootDir, "projects");
    if (existsSync(projectsDir)) {
      const projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
      for (const entry of projectEntries) {
        if (!entry.isDirectory()) continue;
        const projectSyncYaml = path.join(projectsDir, entry.name, "sync.yaml");
        if (!existsSync(projectSyncYaml)) continue;

        let syncYaml: SyncYaml;
        try {
          const text = await fs.readFile(projectSyncYaml, "utf8");
          const parsed = parseYaml(text);
          if (parsed == null || typeof parsed !== "object") {
            continue;
          }
          syncYaml = parsed as SyncYaml;
        } catch {
          continue;
        }

        const targetPath = syncYaml.path;
        if (!targetPath) continue;

        try {
          await processYaml(context, projectSyncYaml, adapters, rootDir);
          context.processedPaths.add(targetPath);
        } catch (err) {
          logError(`프로젝트 처리 실패 (계속 진행): ${projectSyncYaml}: ${err}`);
        }
      }
    }

    // 루트 sync.yaml 처리 (이미 처리된 path는 스킵)
    const rootSyncYaml = path.join(rootDir, "sync.yaml");
    if (existsSync(rootSyncYaml)) {
      let syncYaml: SyncYaml;
      try {
        const text = await fs.readFile(rootSyncYaml, "utf8");
        const parsed = parseYaml(text);
        if (parsed == null || typeof parsed !== "object") {
          syncYaml = {};
        } else {
          syncYaml = parsed as SyncYaml;
        }
      } catch {
        syncYaml = {};
      }

      const targetPath = syncYaml.path;
      if (!targetPath) {
        logInfo("루트 sync.yaml에 path가 정의되지 않음 (템플릿 상태)");
      } else if (context.processedPaths.has(targetPath)) {
        logWarn(`${targetPath}는 projects/에서 이미 처리됨, 스킵`);
      } else {
        await processYaml(context, rootSyncYaml, adapters, rootDir);
        context.processedPaths.add(targetPath);
      }
    }

    // 오래된 백업 정리
    const cleanupPromises: Promise<void>[] = [];
    if (!dryRun) {
      const retentionDays = await getBackupRetentionDays();
      // Find all processed target paths and clean up their backups
      for (const targetPath of context.processedPaths) {
        cleanupPromises.push(cleanupOldBackups(targetPath, retentionDays).catch(() => {}));
      }
    }

    if (dryRun) {
      logWarn("========== DRY-RUN 완료 ==========");
    } else {
      logSuccess("========== 동기화 완료 ==========");
    }

    await Promise.all(cleanupPromises);
    process.exit(0);
  } catch (err) {
    logError(`동기화 실패: ${err}`);
    process.exit(1);
  }
}
