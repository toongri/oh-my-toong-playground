/**
 * Component existence validator for sync.yaml and per-platform YAML files.
 *
 * Validates that referenced component files/directories actually exist.
 * P2-7: Hook component file existence validation lives HERE and ONLY HERE.
 *       schema.ts does NOT check hook component file existence.
 *
 * Validates:
 *   - Component file existence for each category item in sync.yaml
 *   - CLI project files (CLAUDE.md / GEMINI.md / AGENTS.md) at target path
 *   - Per-platform YAML hooks: component file existence (sole owner — P2-7)
 *
 * CLI usage: bun run tools/validators/components.ts [path-to-sync.yaml]
 */

import { existsSync, readdirSync } from "fs";
import { join, dirname, basename } from "path";
import { getRootDir, getEnabledProjects } from "../lib/config.ts";
import { expandTilde } from "../lib/path-utils.ts";
import {
  type ValidationResult,
  makeResult,
  mergeResult,
  isObject,
  isArray,
} from "../lib/validation.ts";
import { resolveComponentPath, setProjectContext } from "../lib/resolver.ts";
import type { SyncYaml } from "../lib/types.ts";
import { readAndExpandSyncYaml } from "../lib/parse-sync-yaml.ts";
import { parseAndMergePlatformYaml } from "../lib/parse-platform-yaml.ts";
import { deploysToClaudeDotDir } from "../sync.ts";
import { resolveDeployTargets } from "../lib/resolve-deploy-targets.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORMS = ["claude", "gemini", "codex", "opencode"] as const;
type Platform = (typeof PLATFORMS)[number];

// CLI project file per platform
const CLI_PROJECT_FILE: Record<Platform, string> = {
  claude: "CLAUDE.md",
  gemini: "GEMINI.md",
  codex: "AGENTS.md",
  opencode: "AGENTS.md",
};

/**
 * Check that a hook directory contains index.ts or index.sh.
 * Mirrors the runtime contract in sync.sh.
 */
function checkHookDirectoryIndex(
  dirPath: string,
  componentName: string,
  result: ValidationResult,
): void {
  if (!existsSync(dirPath)) return;
  if (!existsSync(join(dirPath, "index.ts")) && !existsSync(join(dirPath, "index.sh"))) {
    result.errors.push(`Hook directory '${componentName}' missing index.ts or index.sh: ${dirPath}`);
  }
}

/**
 * Resolve a hook component path for per-platform YAML hooks.
 * Search order:
 *   1. Scoped {project}:{name} → projects/{project}/hooks/{name}
 *      Cross-project refs (scopeProject !== projectDirName) return null.
 *   2. Project-local projects/{projectDirName}/hooks/{component} (if projectDirName given)
 *   3. Global hooks/{component}
 */
function resolveHookComponentPath(
  component: string,
  rootDir: string,
  projectDirName: string,
): string | null {
  if (component.includes(":")) {
    const [scopeProject, scopeName] = component.split(":", 2);
    if (projectDirName && scopeProject !== projectDirName) return null;
    const path = join(rootDir, "projects", scopeProject, "hooks", scopeName);
    if (existsSync(path)) return path;
    return null;
  }

  // Project-local hook (checked first)
  if (projectDirName) {
    const localPath = join(rootDir, "projects", projectDirName, "hooks", component);
    if (existsSync(localPath)) return localPath;
  }

  // Global hook fallback
  const globalPath = join(rootDir, "hooks", component);
  if (existsSync(globalPath)) return globalPath;

  return null;
}

// ---------------------------------------------------------------------------
// CLI project file validation
// ---------------------------------------------------------------------------

function collectUsedPlatforms(data: Record<string, unknown>): Set<Platform> {
  const used = new Set<Platform>();

  function addPlatforms(val: unknown): void {
    if (!isArray(val)) return;
    for (const p of val) {
      if (typeof p === "string" && PLATFORMS.includes(p as Platform)) {
        used.add(p as Platform);
      }
    }
  }

  // Top-level platforms
  addPlatforms(data.platforms);
  if (!data.platforms) {
    used.add("claude"); // default
  }

  // Section and item platforms
  const sections = ["agents", "commands", "hooks", "skills", "scripts", "rules"];
  for (const section of sections) {
    const sectionData = data[section];
    if (!isObject(sectionData)) continue;

    addPlatforms(sectionData.platforms);

    if (isArray(sectionData.items)) {
      for (const item of sectionData.items) {
        if (isObject(item)) {
          addPlatforms(item.platforms);
        }
      }
    }
  }

  return used;
}

function validateCliProjectFiles(
  data: Record<string, unknown>,
  targetPath: string,
  result: ValidationResult,
  claudeDeploys: boolean,
): void {
  const usedPlatforms = collectUsedPlatforms(data);

  for (const platform of usedPlatforms) {
    const projectFile = CLI_PROJECT_FILE[platform];
    let found = false;

    if (platform === "claude") {
      // The MCP-only skip is Claude-only: an MCP-only Claude project writes to
      // ~/.claude.json, not <path>/.claude/, so it needs no CLAUDE.md.
      if (!claudeDeploys) continue;
      // Claude: check at target path or target/.claude/
      found =
        existsSync(join(targetPath, projectFile)) ||
        existsSync(join(targetPath, ".claude", projectFile));
    } else {
      // Non-Claude platforms are always checked (base behavior): a config/mcp-only
      // codex/gemini project still needs its AGENTS.md / GEMINI.md context file.
      found = existsSync(join(targetPath, projectFile));
    }

    if (!found) {
      result.errors.push(
        `CLI 프로젝트 파일 없음: ${projectFile} (대상: ${targetPath})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// sync.yaml component validation
// ---------------------------------------------------------------------------

function getItemComponent(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (isObject(item) && typeof item.component === "string") return item.component;
  return null;
}

/** Pre-parsed claude.yaml result threaded from validateAll to avoid duplicate parsing. */
type ClaudeYamlPreParsed =
  | { ok: true; value: unknown }   // successfully parsed (value may be null = no file)
  | { ok: false };                 // parse failed; error already recorded in caller

export async function validateSyncYamlComponents(
  filePath: string,
  rootDir: string,
  /** When provided by validateAll, skips re-parsing claude.yaml. */
  claudeYamlPreParsed?: ClaudeYamlPreParsed,
): Promise<ValidationResult> {
  const result = makeResult();

  let syncYaml;
  try {
    syncYaml = await readAndExpandSyncYaml(filePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const baseFilename = basename(filePath);
    const localFilename = baseFilename.replace(/\.yaml$/, ".local.yaml");
    result.errors.push(`YAML 파싱 오류 (${baseFilename} 또는 ${localFilename}): ${msg}`);
    return result;
  }
  if (syncYaml === null) return result;

  const data = syncYaml as unknown as Record<string, unknown>;
  if (!isObject(data)) return result;

  const ctx = setProjectContext(syncYaml, filePath, rootDir);
  const projectDirName = ctx.isRootYaml ? undefined : ctx.projectDir;

  // Skip if path is not defined (template state)
  const targetPath = typeof data.path === "string" && data.path ? expandTilde(data.path) : null;
  if (!targetPath) {
    result.warnings.push(`${basename(filePath)}: path가 정의되지 않음 (템플릿 상태)`);
    return result;
  }

  // Determine whether this project deploys into <path>/.claude/ — i.e. component
  // items OR a non-mcps claude.yaml key. This mirrors the sync.ts mkdir gate via
  // the shared deploysToClaudeDotDir predicate, so an MCP-only Claude project
  // (claude.yaml with only `mcps`) skips the Claude CLI-file check below. The
  // predicate is Claude-only, so it gates ONLY the claude branch of the CLI-file
  // check — non-Claude platforms are still checked.
  //
  // When claudeYamlPreParsed is provided by validateAll (deduped), skip re-parsing.
  // If parse failed upstream ({ ok: false }), bail without adding a duplicate error.
  let claudeYaml: Record<string, unknown> | null;
  if (claudeYamlPreParsed !== undefined) {
    if (!claudeYamlPreParsed.ok) return result; // parse failed upstream; error already recorded
    claudeYaml = claudeYamlPreParsed.value as Record<string, unknown> | null;
  } else {
    try {
      claudeYaml = await parseAndMergePlatformYaml(dirname(filePath), "claude");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`YAML 파싱 오류 (claude.yaml 또는 claude.local.yaml): ${msg}`);
      return result;
    }
  }
  const claudeDeploys = deploysToClaudeDotDir(data, claudeYaml);

  // Resolve deploy targets UNCONDITIONALLY so the validator mirrors sync.ts —
  // which calls resolveDeployTargets(targetPath) for every project and aborts on
  // DeployTargetsError. Gating this behind a Claude-only predicate would let an
  // MCP-only project pointing at a broken bare container pass `make validate` yet
  // abort `make sync`. A resolution failure is reported via result.errors so
  // `make validate` catches it first.
  let deployTargets: string[];
  try {
    deployTargets = resolveDeployTargets(targetPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`배포 대상 확인 실패 (${targetPath}): ${msg}`);
    deployTargets = [];
  }
  for (const wtPath of deployTargets) {
    validateCliProjectFiles(data, wtPath, result, claudeDeploys);
  }

  // Category definitions: [category, extension]
  type CategoryDef = { category: string; ext: string };
  const categories: CategoryDef[] = [
    { category: "agents", ext: ".md" },
    { category: "commands", ext: ".md" },
    { category: "skills", ext: "" },
    { category: "scripts", ext: "" },
    { category: "rules", ext: ".md" },
  ];

  for (const { category, ext } of categories) {
    const sectionData = data[category];
    if (!isObject(sectionData)) continue;

    const items = sectionData.items;
    if (!isArray(items)) continue;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const component = getItemComponent(item);
      if (!component) continue;

      // Agents: try flat path first for non-scoped refs
      if (category === "agents" && !component.includes(":")) {
        const flatPath = join(rootDir, "agents", `${component}.md`);
        const indexPath = join(rootDir, "agents", component, "index.md");
        if (existsSync(flatPath) || existsSync(indexPath)) continue;
      }

      const resolved = resolveComponentPath(component, category, rootDir, projectDirName);
      if ("error" in resolved) {
        result.errors.push(`${category}.items[${i}]: ${resolved.error}`);
      }
    }

    // hooks: also validate add-hooks in agent items
    if (category === "agents") {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!isObject(item)) continue;

        // add-skills
        if (isArray(item["add-skills"])) {
          for (let j = 0; j < item["add-skills"].length; j++) {
            const skill = item["add-skills"][j];
            if (typeof skill !== "string") continue;
            const resolved = resolveComponentPath(skill, "skills", rootDir, projectDirName);
            if ("error" in resolved) {
              result.errors.push(`agents.items[${i}].add-skills[${j}]: ${resolved.error}`);
            }
          }
        }

        // add-hooks
        if (isArray(item["add-hooks"])) {
          for (let j = 0; j < item["add-hooks"].length; j++) {
            const hook = item["add-hooks"][j];
            if (!isObject(hook)) continue;
            const hookComp = hook.component;
            if (typeof hookComp !== "string" || !hookComp) continue;

            const resolved = resolveComponentPath(hookComp, "hooks", rootDir, projectDirName);
            if ("error" in resolved) {
              result.errors.push(`agents.items[${i}].add-hooks[${j}]: ${resolved.error}`);
            } else {
              // Check directory index
              const resolvedPath = resolved.path;
              if (!resolvedPath.endsWith(".sh") && !resolvedPath.endsWith(".ts") && !resolvedPath.endsWith(".js")) {
                checkHookDirectoryIndex(resolvedPath, hookComp, result);
              }
            }
          }
        }
      }
    }

  }

  // hooks section: separate pass (not in categories above since hooks use "" ext)
  const hooksData = data.hooks;
  if (isObject(hooksData) && isArray(hooksData.items)) {
    for (let i = 0; i < hooksData.items.length; i++) {
      const item = hooksData.items[i];
      if (!isObject(item)) continue;
      const component = item.component;
      if (typeof component !== "string" || !component) continue;

      const resolved = resolveComponentPath(component, "hooks", rootDir, projectDirName);
      if ("error" in resolved) {
        result.errors.push(`hooks.items[${i}]: ${resolved.error}`);
      } else {
        const resolvedPath = resolved.path;
        if (!resolvedPath.endsWith(".sh") && !resolvedPath.endsWith(".ts") && !resolvedPath.endsWith(".js")) {
          checkHookDirectoryIndex(resolvedPath, component, result);
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// P2-7: Per-platform YAML hook component validation (SOLE OWNER)
// ---------------------------------------------------------------------------

export async function validatePlatformYamlHookComponents(
  yamlDir: string,
  rootDir: string,
  /** When provided by validateAll, skips re-parsing claude.yaml. */
  claudeYamlPreParsed?: ClaudeYamlPreParsed,
): Promise<ValidationResult> {
  const result = makeResult();

  // Determine project dir name for local hook resolution
  const projectsDir = join(rootDir, "projects");
  let projectDirName = "";
  if (yamlDir.startsWith(projectsDir + "/") || yamlDir === projectsDir) {
    projectDirName = basename(yamlDir);
  }

  // Only claude and gemini support hooks
  for (const platform of ["claude", "gemini"] as const) {
    let merged: unknown;
    if (platform === "claude" && claudeYamlPreParsed !== undefined) {
      // Pre-parsed by validateAll: skip re-parsing.
      // If parse failed ({ ok: false }), error already recorded — skip claude hooks.
      if (!claudeYamlPreParsed.ok) continue;
      merged = claudeYamlPreParsed.value;
    } else {
      try {
        merged = await parseAndMergePlatformYaml(yamlDir, platform);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.errors.push(`YAML 파싱 오류 (${platform}.yaml 또는 ${platform}.local.yaml): ${msg}`);
        continue;
      }
    }
    if (merged === null) continue;

    const data = merged as unknown as Record<string, unknown>;
    if (!isObject(data)) continue;

    const hooks = data.hooks;
    if (!isObject(hooks)) continue;

    // hooks is event-keyed map: { EventName: [ {component, ...}, ... ] }
    for (const event of Object.keys(hooks)) {
      const eventItems = hooks[event];
      if (!isArray(eventItems)) continue;

      for (let i = 0; i < eventItems.length; i++) {
        const hookItem = eventItems[i];
        if (!isObject(hookItem)) continue;

        const component = hookItem.component;
        if (typeof component !== "string" || !component) continue;

        const resolved = resolveHookComponentPath(component, rootDir, projectDirName);
        if (resolved === null) {
          result.errors.push(
            `${platform}.yaml: hooks.${event}[${i}].component '${component}' 파일 없음`,
          );
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Discovery and orchestration
// ---------------------------------------------------------------------------

function discoverSyncYamls(rootDir: string): string[] {
  const results: string[] = [];

  const projectsDir = join(rootDir, "projects");
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const candidate = join(projectsDir, entry.name, "sync.yaml");
        if (existsSync(candidate)) {
          results.push(candidate);
        }
      }
    }
  }

  const rootSync = join(rootDir, "sync.yaml");
  if (existsSync(rootSync)) {
    results.push(rootSync);
  }

  return results;
}

export async function validateAll(
  rootDir: string,
  enabledProjects?: string[],
): Promise<ValidationResult> {
  const result = makeResult();

  const effective = enabledProjects ?? (await getEnabledProjects());
  const enabledSet = effective && effective.length > 0 ? new Set(effective) : undefined;
  const projectsDir = join(rootDir, "projects");

  for (const syncYamlPath of discoverSyncYamls(rootDir)) {
    if (enabledSet) {
      const parentDir = dirname(syncYamlPath);
      if (dirname(parentDir) === projectsDir && !enabledSet.has(basename(parentDir))) {
        continue;
      }
    }

    // Parse claude.yaml exactly once per sync.yaml, so a broken claude.yaml
    // produces a single error regardless of how many validators consume it.
    const yamlDir = dirname(syncYamlPath);
    let claudeYamlPreParsed: ClaudeYamlPreParsed;
    try {
      const value = await parseAndMergePlatformYaml(yamlDir, "claude");
      claudeYamlPreParsed = { ok: true, value };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`YAML 파싱 오류 (claude.yaml 또는 claude.local.yaml): ${msg}`);
      claudeYamlPreParsed = { ok: false };
    }

    mergeResult(result, await validateSyncYamlComponents(syncYamlPath, rootDir, claudeYamlPreParsed));
    mergeResult(result, await validatePlatformYamlHookComponents(yamlDir, rootDir, claudeYamlPreParsed));
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rootDir = getRootDir();
  if (!rootDir) {
    process.stderr.write("[COMPONENT] config.yaml를 찾을 수 없습니다\n");
    process.exit(1);
  }

  const result = await validateAll(rootDir);

  for (const warning of result.warnings) {
    process.stderr.write(`\x1b[1;33m[COMPONENT]\x1b[0m ${warning}\n`);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      process.stderr.write(`\x1b[0;31m[ERROR]\x1b[0m ${error}\n`);
    }
    process.stderr.write(
      `\x1b[0;31m[ERROR]\x1b[0m 컴포넌트 검증 실패: ${result.errors.length} 개 오류, ${result.warnings.length} 개 경고\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`\x1b[0;32m[COMPONENT]\x1b[0m 컴포넌트 검증 통과\n`);
  process.exit(0);
}

if (import.meta.main) {
  main();
}
