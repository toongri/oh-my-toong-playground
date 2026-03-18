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

import { parse } from "yaml";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { getRootDir } from "../lib/config.ts";
import { resolveComponentPath, setProjectContext } from "../lib/resolver.ts";
import type { SyncYaml } from "../lib/types.ts";

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

// ---------------------------------------------------------------------------
// Result accumulator
// ---------------------------------------------------------------------------

type ValidationResult = {
  errors: string[];
  warnings: string[];
};

function makeResult(): ValidationResult {
  return { errors: [], warnings: [] };
}

function mergeResult(target: ValidationResult, source: ValidationResult): void {
  target.errors.push(...source.errors);
  target.warnings.push(...source.warnings);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseYaml(filePath: string): { data: unknown; error?: undefined } | { data?: undefined; error: string } {
  try {
    const text = readFileSync(filePath, "utf-8");
    const data = parse(text);
    return { data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `YAML 파싱 오류 (${basename(filePath)}): ${msg}` };
  }
}

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
 *   2. Global hooks/{component}
 *   3. Project-local projects/{projectDirName}/hooks/{component} (if projectDirName given)
 */
function resolveHookComponentPath(
  component: string,
  rootDir: string,
  projectDirName: string,
): string | null {
  if (component.includes(":")) {
    const [scopeProject, scopeName] = component.split(":", 2);
    const path = join(rootDir, "projects", scopeProject, "hooks", scopeName);
    if (existsSync(path)) return path;
    return null;
  }

  // Global hook
  const globalPath = join(rootDir, "hooks", component);
  if (existsSync(globalPath)) return globalPath;

  // Project-local hook
  if (projectDirName) {
    const localPath = join(rootDir, "projects", projectDirName, "hooks", component);
    if (existsSync(localPath)) return localPath;
  }

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
): void {
  const usedPlatforms = collectUsedPlatforms(data);

  for (const platform of usedPlatforms) {
    const projectFile = CLI_PROJECT_FILE[platform];
    let found = false;

    if (platform === "claude") {
      // Claude: check at target path or target/.claude/
      found =
        existsSync(join(targetPath, projectFile)) ||
        existsSync(join(targetPath, ".claude", projectFile));
    } else {
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

export function validateSyncYamlComponents(
  filePath: string,
  rootDir: string,
): ValidationResult {
  const result = makeResult();

  const parsed = parseYaml(filePath);
  if (parsed.error) {
    result.errors.push(parsed.error);
    return result;
  }

  const data = parsed.data;
  if (!isObject(data)) return result;

  const syncYaml = data as SyncYaml;
  const ctx = setProjectContext(syncYaml, filePath, rootDir);
  const projectDirName = ctx.isRootYaml ? undefined : ctx.projectDir;

  // Skip if path is not defined (template state)
  const targetPath = typeof data.path === "string" && data.path ? data.path : null;
  if (!targetPath) {
    result.warnings.push(`${basename(filePath)}: path가 정의되지 않음 (템플릿 상태)`);
    return result;
  }

  // Validate CLI project files
  validateCliProjectFiles(data, targetPath, result);

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

export function validatePlatformYamlHookComponents(
  yamlDir: string,
  rootDir: string,
): ValidationResult {
  const result = makeResult();

  // Determine project dir name for local hook resolution
  const projectsDir = join(rootDir, "projects");
  let projectDirName = "";
  if (yamlDir.startsWith(projectsDir + "/") || yamlDir === projectsDir) {
    projectDirName = basename(yamlDir);
  }

  // Only claude and gemini support hooks
  for (const platform of ["claude", "gemini"] as const) {
    const platformYaml = join(yamlDir, `${platform}.yaml`);
    if (!existsSync(platformYaml)) continue;

    const parsed = parseYaml(platformYaml);
    if (parsed.error) {
      result.errors.push(parsed.error);
      continue;
    }

    const data = parsed.data;
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

export function validateAll(rootDir: string): ValidationResult {
  const result = makeResult();

  for (const syncYamlPath of discoverSyncYamls(rootDir)) {
    mergeResult(result, validateSyncYamlComponents(syncYamlPath, rootDir));
    const yamlDir = dirname(syncYamlPath);
    mergeResult(result, validatePlatformYamlHookComponents(yamlDir, rootDir));
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const rootDir = getRootDir();
  if (!rootDir) {
    process.stderr.write("[COMPONENT] config.yaml를 찾을 수 없습니다\n");
    process.exit(1);
  }

  const result = validateAll(rootDir);

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
