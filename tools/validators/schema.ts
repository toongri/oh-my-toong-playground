/**
 * Schema validator for sync.yaml and per-platform YAML files.
 *
 * Performs structural validation only — no file existence checks (P2-7).
 * Hook component file existence lives exclusively in components.ts.
 *
 * Validates:
 *   - YAML syntax
 *   - P2-3: Deprecated top-level sections (config, hooks, mcps, plugins) in sync.yaml → ERROR
 *   - Allowed sections in sync.yaml (agents, commands, skills, scripts, rules)
 *   - Item format (string or object with component)
 *   - Platform values against valid targets
 *   - Per-platform YAML: allowed sections per platform, unknown section → WARN
 *
 * CLI usage: bun run tools/validators/schema.ts [path-to-sync.yaml]
 */

import { parse } from "yaml";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { getRootDir } from "../lib/config.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_PLATFORMS = ["claude", "gemini", "codex", "opencode"] as const;
type Platform = (typeof VALID_PLATFORMS)[number];

const VALID_SYNC_TOP_LEVEL = new Set([
  "name",
  "path",
  "platforms",
  "agents",
  "commands",
  "skills",
  "scripts",
  "rules",
]);

// P2-3: Deprecated sections that must not appear in sync.yaml
const DEPRECATED_SYNC_SECTIONS: Record<string, string> = {
  config: "sync.yaml: 'config' 섹션은 더 이상 지원되지 않습니다. claude.yaml 등 per-platform YAML을 사용하세요",
  hooks: "sync.yaml: 'hooks' 섹션은 더 이상 지원되지 않습니다. claude.yaml 등 per-platform YAML을 사용하세요",
  mcps: "sync.yaml: 'mcps' 섹션은 더 이상 지원되지 않습니다. claude.yaml 등 per-platform YAML을 사용하세요",
  plugins: "sync.yaml: 'plugins' 섹션은 더 이상 지원되지 않습니다. claude.yaml 등 per-platform YAML을 사용하세요",
};

const VALID_SECTION_FIELDS = new Set(["platforms", "items"]);

const VALID_AGENT_ITEM_FIELDS = new Set([
  "component",
  "add-skills",
  "add-hooks",
  "platforms",
]);

const VALID_ADD_HOOK_ITEM_FIELDS = new Set([
  "event",
  "component",
  "command",
  "type",
  "matcher",
  "timeout",
  "prompt",
]);

const VALID_GENERIC_ITEM_FIELDS = new Set(["component", "platforms"]);

const VALID_EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
]);

const VALID_HOOK_TYPES = new Set(["command", "prompt"]);

const PLATFORM_ALLOWED_SECTIONS: Record<string, Set<string>> = {
  claude: new Set(["config", "hooks", "mcps", "plugins", "statusLine"]),
  gemini: new Set(["config", "hooks", "mcps"]),
  codex: new Set(["config", "mcps", "model-map"]),
  opencode: new Set(["config", "mcps", "model-map"]),
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
    return { error: `YAML 문법 오류 (${basename(filePath)}): ${msg}` };
  }
}

function validatePlatformValues(
  platforms: unknown,
  context: string,
  result: ValidationResult,
): void {
  if (!isArray(platforms)) return;
  for (const p of platforms) {
    if (typeof p === "string" && !VALID_PLATFORMS.includes(p as Platform)) {
      result.errors.push(`${context}: 잘못된 플랫폼 '${p}' (지원: ${VALID_PLATFORMS.join(", ")})`);
    }
  }
}

function validateComponentRef(value: string, context: string, result: ValidationResult): void {
  if (!value.includes(":")) return;
  const parts = value.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    result.errors.push(`${context}: 잘못된 형식 '${value}' (올바른 형식: {project}:{name})`);
  }
}

// ---------------------------------------------------------------------------
// Section validators
// ---------------------------------------------------------------------------

function validateSection(
  sectionData: unknown,
  sectionName: string,
  result: ValidationResult,
  itemFieldsAllowed: Set<string>,
  extraItemValidation?: (item: Record<string, unknown>, idx: number, ctx: string, r: ValidationResult) => void,
): void {
  if (sectionData === null || sectionData === undefined) return;

  // Reject old array format
  if (isArray(sectionData)) {
    result.errors.push(`${sectionName}: 기존 배열 형식은 더 이상 지원되지 않습니다. items 형식을 사용하세요.`);
    return;
  }

  if (!isObject(sectionData)) return;

  // Check section-level fields
  for (const key of Object.keys(sectionData)) {
    if (!VALID_SECTION_FIELDS.has(key)) {
      result.errors.push(`${sectionName}: 알 수 없는 필드 '${key}' (지원: ${[...VALID_SECTION_FIELDS].join(", ")})`);
    }
  }

  validatePlatformValues(sectionData.platforms, `${sectionName}.platforms`, result);

  const items = sectionData.items;
  if (!isArray(items)) return;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemCtx = `${sectionName}.items[${i}]`;

    if (typeof item === "string") {
      validateComponentRef(item, itemCtx, result);
      continue;
    }

    if (!isObject(item)) {
      result.errors.push(`${itemCtx}: string 또는 object 이어야 합니다`);
      continue;
    }

    // Check item-level fields
    for (const key of Object.keys(item)) {
      if (!itemFieldsAllowed.has(key)) {
        result.errors.push(`${itemCtx}: 알 수 없는 필드 '${key}' (지원: ${[...itemFieldsAllowed].join(", ")})`);
      }
    }

    const component = item.component;
    if (typeof component === "string" && component) {
      validateComponentRef(component, `${itemCtx}.component`, result);
    }

    validatePlatformValues(item.platforms, `${itemCtx}.platforms`, result);

    if (extraItemValidation) {
      extraItemValidation(item, i, itemCtx, result);
    }
  }
}

function validateAgentAddHooks(
  addHooks: unknown,
  agentCtx: string,
  result: ValidationResult,
): void {
  if (!isArray(addHooks)) return;

  for (let j = 0; j < addHooks.length; j++) {
    const hook = addHooks[j];
    const hookCtx = `${agentCtx}.add-hooks[${j}]`;

    if (!isObject(hook)) {
      result.errors.push(`${hookCtx}: object 이어야 합니다`);
      continue;
    }

    for (const key of Object.keys(hook)) {
      if (!VALID_ADD_HOOK_ITEM_FIELDS.has(key)) {
        result.errors.push(`${hookCtx}: 알 수 없는 필드 '${key}'`);
      }
    }

    const event = hook.event;
    if (typeof event === "string" && event && !VALID_EVENTS.has(event)) {
      result.errors.push(`${hookCtx}.event: 잘못된 값 '${event}' (지원: ${[...VALID_EVENTS].join(", ")})`);
    }

    const type = hook.type;
    if (typeof type === "string" && type && !VALID_HOOK_TYPES.has(type)) {
      result.errors.push(`${hookCtx}.type: 잘못된 값 '${type}' (지원: ${[...VALID_HOOK_TYPES].join(", ")})`);
    }

    const comp = hook.component;
    if (typeof comp === "string" && comp) {
      validateComponentRef(comp, `${hookCtx}.component`, result);
    }
  }
}

function validateAgentItems(
  item: Record<string, unknown>,
  _idx: number,
  ctx: string,
  result: ValidationResult,
): void {
  // add-skills format validation
  if (isArray(item["add-skills"])) {
    for (let k = 0; k < item["add-skills"].length; k++) {
      const skill = item["add-skills"][k];
      if (typeof skill === "string") {
        validateComponentRef(skill, `${ctx}.add-skills[${k}]`, result);
      }
    }
  }

  // add-hooks validation
  if (item["add-hooks"] !== undefined) {
    validateAgentAddHooks(item["add-hooks"], ctx, result);
  }
}

// ---------------------------------------------------------------------------
// sync.yaml validator
// ---------------------------------------------------------------------------

export function validateSyncYaml(filePath: string): ValidationResult {
  const result = makeResult();

  const parsed = parseYaml(filePath);
  if (parsed.error) {
    result.errors.push(parsed.error);
    return result;
  }

  const data = parsed.data;
  if (!isObject(data)) {
    result.errors.push(`sync.yaml: 최상위 레벨은 map 이어야 합니다`);
    return result;
  }

  const label = basename(dirname(filePath)) + "/sync.yaml";

  // P2-3: Check for deprecated sections
  for (const [section, message] of Object.entries(DEPRECATED_SYNC_SECTIONS)) {
    if (section in data) {
      result.errors.push(message);
    }
  }

  // Check unknown top-level fields
  for (const key of Object.keys(data)) {
    if (!VALID_SYNC_TOP_LEVEL.has(key) && !(key in DEPRECATED_SYNC_SECTIONS)) {
      result.errors.push(`${label}: 알 수 없는 최상위 필드 '${key}'`);
    }
  }

  validatePlatformValues(data.platforms, "platforms", result);

  // Validate each section
  validateSection(data.agents, "agents", result, VALID_AGENT_ITEM_FIELDS, validateAgentItems);
  validateSection(data.commands, "commands", result, VALID_GENERIC_ITEM_FIELDS);
  validateSection(data.skills, "skills", result, VALID_GENERIC_ITEM_FIELDS);
  validateSection(data.scripts, "scripts", result, VALID_GENERIC_ITEM_FIELDS);
  validateSection(data.rules, "rules", result, VALID_GENERIC_ITEM_FIELDS);

  return result;
}

// ---------------------------------------------------------------------------
// Per-platform YAML validator
// ---------------------------------------------------------------------------

export function validatePlatformYaml(platformYamlPath: string, platform: string): ValidationResult {
  const result = makeResult();

  const parsed = parseYaml(platformYamlPath);
  if (parsed.error) {
    result.errors.push(parsed.error);
    return result;
  }

  const data = parsed.data;
  if (!isObject(data)) return result;

  const allowed = PLATFORM_ALLOWED_SECTIONS[platform];
  if (!allowed) return result;

  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) {
      result.warnings.push(`${platform}.yaml: 알 수 없는 섹션 '${key}' (지원: ${[...allowed].join(", ")})`);
    }
  }

  // NOTE: No hook component file existence checks here (P2-7).
  // Hook validation lives exclusively in components.ts.

  return result;
}

// ---------------------------------------------------------------------------
// Discovery and orchestration
// ---------------------------------------------------------------------------

function discoverSyncYamls(rootDir: string): string[] {
  const results: string[] = [];

  // projects/* first
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

  // root sync.yaml
  const rootSync = join(rootDir, "sync.yaml");
  if (existsSync(rootSync)) {
    results.push(rootSync);
  }

  return results;
}

export function validateAll(rootDir: string): ValidationResult {
  const result = makeResult();

  for (const syncYamlPath of discoverSyncYamls(rootDir)) {
    const syncResult = validateSyncYaml(syncYamlPath);
    mergeResult(result, syncResult);

    // Validate co-located per-platform YAMLs
    const yamlDir = dirname(syncYamlPath);
    for (const platform of VALID_PLATFORMS) {
      const platformYaml = join(yamlDir, `${platform}.yaml`);
      if (existsSync(platformYaml)) {
        const platformResult = validatePlatformYaml(platformYaml, platform);
        mergeResult(result, platformResult);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const targetArg = process.argv[2];
  const rootDir = getRootDir();

  if (!rootDir) {
    process.stderr.write("[SCHEMA] config.yaml를 찾을 수 없습니다\n");
    process.exit(1);
  }

  let result: ValidationResult;

  if (targetArg && existsSync(targetArg)) {
    result = validateSyncYaml(targetArg);
    const yamlDir = dirname(targetArg);
    for (const platform of VALID_PLATFORMS) {
      const platformYaml = join(yamlDir, `${platform}.yaml`);
      if (existsSync(platformYaml)) {
        mergeResult(result, validatePlatformYaml(platformYaml, platform));
      }
    }
  } else {
    result = validateAll(rootDir);
  }

  for (const warning of result.warnings) {
    process.stderr.write(`\x1b[1;33m[SCHEMA]\x1b[0m ${warning}\n`);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      process.stderr.write(`\x1b[0;31m[SCHEMA]\x1b[0m ${error}\n`);
    }
    process.stderr.write(`\x1b[0;31m[SCHEMA]\x1b[0m 스키마 검증 실패: ${result.errors.length} 개 오류\n`);
    process.exit(1);
  }

  process.stderr.write(`\x1b[0;32m[SCHEMA]\x1b[0m 스키마 검증 통과\n`);
  process.exit(0);
}

if (import.meta.main) {
  main();
}
