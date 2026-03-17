import fs from "fs/promises";
import path from "path";

import type { PlatformConfigResult, PlatformYaml } from "../lib/types.ts";
import { parseFrontmatter, serializeFrontmatter } from "../lib/frontmatter.ts";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";
import { syncDirectory, copyFile } from "../lib/sync-directory.ts";
import type { PlatformAdapter } from "./types.ts";

// =============================================================================
// Model Map Helper
// =============================================================================

/**
 * Apply a model map to resolve a model string to its mapped value.
 * Returns the mapped value if found, or the original string if not.
 */
export function applyModelMap(
  modelMap: Record<string, string>,
  model: string,
): string {
  return modelMap[model] ?? model;
}

// =============================================================================
// Agent Frontmatter Translation
// =============================================================================

/**
 * Translate agent frontmatter for OpenCode compatibility.
 * - Removes 'add-skills' field
 * - Converts 'subagent_type' -> 'mode: "subagent"'
 * - If modelMap provided, applies mapping to 'model' field (P2-5)
 *
 * Uses parseFrontmatter/serializeFrontmatter to preserve body `---` lines (P2-4 fix).
 */
export function translateAgentFrontmatter(
  content: string,
  modelMap?: Record<string, string>,
): string {
  const { frontmatter, body, hasFrontmatter } = parseFrontmatter(content);

  if (!hasFrontmatter) {
    return content;
  }

  // Remove add-skills
  delete frontmatter["add-skills"];

  // Convert subagent_type -> mode: "subagent"
  if ("subagent_type" in frontmatter) {
    frontmatter["mode"] = "subagent";
    delete frontmatter["subagent_type"];
  }

  // P2-5: Apply model map to model field if provided
  if (modelMap && typeof frontmatter["model"] === "string") {
    frontmatter["model"] = applyModelMap(modelMap, frontmatter["model"]);
  }

  return serializeFrontmatter(frontmatter, body);
}

// =============================================================================
// OpenCode Adapter
// =============================================================================

export const opencodeAdapter: PlatformAdapter = {
  platform: "opencode",
  configDir: ".opencode",
  contextFile: "AGENTS.md",

  async syncAgentsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    addSkills?: string[],
    _addHooks?: unknown[],
    dryRun?: boolean,
    modelMap?: Record<string, string>,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".opencode", "agents");
    const targetFile = path.join(targetDir, `${displayName}.md`);

    try {
      await fs.access(sourcePath);
    } catch {
      logWarn(`Agent file not found: ${sourcePath}`);
      return;
    }

    if (dryRun) {
      logDry(`Copy: ${sourcePath} -> ${targetFile}`);
      return;
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourcePath, targetFile);
    logInfo(`Copied: ${displayName}.md`);

    // Translate frontmatter for OpenCode compatibility (P2-5: pass modelMap)
    const content = await fs.readFile(targetFile, "utf-8");
    const translated = translateAgentFrontmatter(content, modelMap);
    await fs.writeFile(targetFile, translated, "utf-8");

    // add-skills not supported — log if provided
    if (addSkills && addSkills.length > 0) {
      logInfo(
        `OpenCode does not support add-skills. Skipping add-skills for: ${displayName}`,
      );
    }
  },

  async syncCommandsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".opencode", "commands");
    const targetFile = path.join(targetDir, `${displayName}.md`);

    try {
      await fs.access(sourcePath);
    } catch {
      logWarn(`Command file not found: ${sourcePath}`);
      return;
    }

    if (dryRun) {
      logDry(`Copy: ${sourcePath} -> ${targetFile}`);
      return;
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourcePath, targetFile);
    logInfo(`Copied: ${displayName}.md`);
  },

  async syncSkillsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".opencode", "skills");
    const targetSkillDir = path.join(targetDir, displayName);

    try {
      const stat = await fs.stat(sourcePath);
      if (!stat.isDirectory()) {
        logWarn(`Skill directory not found: ${sourcePath}`);
        return;
      }
    } catch {
      logWarn(`Skill directory not found: ${sourcePath}`);
      return;
    }

    if (dryRun) {
      logDry(`Copy (directory): ${sourcePath} -> ${targetSkillDir}`);
      return;
    }

    await fs.mkdir(targetDir, { recursive: true });
    await syncDirectory(sourcePath, targetSkillDir);
    logInfo(`Copied: ${displayName}/`);
  },

  async syncScriptsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".opencode", "scripts");

    let isDir = false;
    let exists = true;
    try {
      const stat = await fs.stat(sourcePath);
      isDir = stat.isDirectory();
    } catch {
      exists = false;
    }

    if (!exists) {
      logWarn(`Script not found: ${sourcePath}`);
      return;
    }

    if (isDir) {
      const targetScriptDir = path.join(targetDir, displayName);
      if (dryRun) {
        logDry(`Copy (directory): ${sourcePath} -> ${targetScriptDir}/`);
      } else {
        await fs.mkdir(targetScriptDir, { recursive: true });
        await syncDirectory(sourcePath, targetScriptDir);
        logInfo(`Copied: ${displayName}/`);
      }
    } else {
      const targetFile = path.join(targetDir, displayName);
      if (dryRun) {
        logDry(`Copy: ${sourcePath} -> ${targetFile}`);
      } else {
        await fs.mkdir(targetDir, { recursive: true });
        await copyFile(sourcePath, targetFile);
        logInfo(`Copied: ${displayName}`);
      }
    }
  },

  async syncRulesDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".opencode", "rules");
    const targetFile = path.join(targetDir, `${displayName}.md`);
    const configFile = path.join(targetPath, ".opencode", "opencode.json");
    const globEntry = ".opencode/rules/*.md";

    try {
      await fs.access(sourcePath);
    } catch {
      logWarn(`Rule file not found: ${sourcePath}`);
      return;
    }

    if (dryRun) {
      logDry(`Copy: ${sourcePath} -> ${targetFile}`);
      logDry(`Ensure instructions glob in: ${configFile}`);
      return;
    }

    // Copy rule file
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourcePath, targetFile);
    logInfo(`Copied: ${displayName}.md`);

    // Ensure opencode.json has instructions glob (idempotent)
    await fs.mkdir(path.join(targetPath, ".opencode"), { recursive: true });

    let config: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(configFile, "utf-8");
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File doesn't exist yet — start fresh
    }

    const instructions = Array.isArray(config["instructions"])
      ? (config["instructions"] as unknown[])
      : [];

    if (!instructions.includes(globEntry)) {
      config["instructions"] = [...instructions, globEntry];
      await fs.writeFile(
        configFile,
        JSON.stringify(config, null, 2) + "\n",
        "utf-8",
      );
      if (instructions.length === 0) {
        logInfo("Created: opencode.json with instructions glob");
      } else {
        logInfo("Updated: opencode.json instructions glob added");
      }
    }
    // else: already present — idempotent, skip
  },

  async syncHooksDirect(
    _targetPath: string,
    displayName: string,
    _sourcePath: string,
    _dryRun?: boolean,
  ): Promise<void> {
    logInfo(`OpenCode does not support hooks. Skipping: ${displayName || "hook"}`);
  },

  async syncPlatformYaml(
    targetPath: string,
    platformYaml: Record<string, unknown>,
    dryRun: boolean,
  ): Promise<PlatformConfigResult> {
    const yaml = platformYaml as PlatformYaml;
    const processedSections: string[] = [];
    let modelMap: Record<string, string> | undefined;

    // 1. model-map (must be processed before config)
    if (yaml["model-map"] != null) {
      modelMap = yaml["model-map"] as Record<string, string>;
      processedSections.push("model-map");
    }

    // 2. config — apply model-map to model and small_model fields, then merge
    if (yaml.config != null) {
      let configObj = { ...yaml.config } as Record<string, unknown>;

      if (modelMap) {
        if (typeof configObj["model"] === "string") {
          configObj["model"] = applyModelMap(modelMap, configObj["model"]);
        }
        if (typeof configObj["small_model"] === "string") {
          configObj["small_model"] = applyModelMap(
            modelMap,
            configObj["small_model"],
          );
        }
      }

      await syncConfig(targetPath, configObj, dryRun);
      processedSections.push("config");
    }

    // 3. hooks — not supported, log and skip
    if (yaml.hooks != null) {
      logInfo("OpenCode does not support hooks. Skipping hooks section.");
      processedSections.push("hooks");
    }

    // 4. mcps — iterate items and merge each server
    if (yaml.mcps != null) {
      const mcps = yaml.mcps as Record<string, Record<string, unknown>>;
      for (const [name, serverDef] of Object.entries(mcps)) {
        await syncMcpsMerge(targetPath, name, serverDef, dryRun);
      }
      processedSections.push("mcps");
    }

    return { processedSections, modelMap };
  },
};

// =============================================================================
// Config Sync (internal helper — also exported for tests)
// =============================================================================

/**
 * Deep merge configObj into .opencode/opencode.json (new values win on conflict).
 */
export async function syncConfig(
  targetPath: string,
  configObj: Record<string, unknown>,
  dryRun: boolean,
): Promise<void> {
  const configFile = path.join(targetPath, ".opencode", "opencode.json");

  if (dryRun) {
    logDry(`Config merge: ${JSON.stringify(configObj)} -> ${configFile}`);
    return;
  }

  await fs.mkdir(path.join(targetPath, ".opencode"), { recursive: true });

  let current: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configFile, "utf-8");
    current = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist — start empty
  }

  const merged = deepMerge(current, configObj);
  await fs.writeFile(
    configFile,
    JSON.stringify(merged, null, 2) + "\n",
    "utf-8",
  );
  logInfo(`Config merged: ${configFile}`);
}

// =============================================================================
// MCP Server Sync (internal helper — also exported for tests)
// =============================================================================

/**
 * Merge an MCP server definition into .opencode/opencode.json at `.mcp.<name>`.
 */
export async function syncMcpsMerge(
  targetPath: string,
  serverName: string,
  serverDef: Record<string, unknown>,
  dryRun: boolean,
): Promise<void> {
  const configFile = path.join(targetPath, ".opencode", "opencode.json");

  if (dryRun) {
    logDry(`MCP merge: ${serverName} -> ${configFile}`);
    logDry(`Server config: ${JSON.stringify(serverDef)}`);
    return;
  }

  await fs.mkdir(path.join(targetPath, ".opencode"), { recursive: true });

  let current: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configFile, "utf-8");
    current = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File doesn't exist — start empty
  }

  const mcp = (current["mcp"] as Record<string, unknown> | undefined) ?? {};
  mcp[serverName] = serverDef;
  current["mcp"] = mcp;

  await fs.writeFile(
    configFile,
    JSON.stringify(current, null, 2) + "\n",
    "utf-8",
  );
  logInfo(`MCP merged: ${serverName} -> ${configFile}`);
}

// =============================================================================
// Deep Merge Helper
// =============================================================================

/**
 * Deep merge two objects. Values from `override` win on conflict.
 * Non-plain-object values are replaced (not merged).
 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(override)) {
    if (
      isPlainObject(result[key]) &&
      isPlainObject(val)
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      result[key] = val;
    }
  }
  return result;
}

function isPlainObject(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
