/**
 * Gemini CLI Adapter
 * Implements PlatformAdapter for the Gemini CLI platform.
 *
 * Key behaviors:
 * - agents: not supported, skip with warning
 * - commands: generate .toml from .md frontmatter (no .md copy)
 * - hooks: copy file + chmod +x (or syncDirectory for dirs)
 * - skills: syncDirectory
 * - scripts: syncDirectory
 * - rules: not supported, skip with warning
 * - config: deep merge into .gemini/settings.json
 * - hooks (platform yaml): event-keyed entries merged into .gemini/settings.json
 * - mcps: merge into .gemini/settings.json mcpServers
 */

import fs from "fs/promises";
import path from "path";

import type { Platform, PlatformConfigResult, PlatformYaml } from "../lib/types.ts";
import type { PlatformAdapter } from "./types.ts";
import { parseFrontmatter } from "../lib/frontmatter.ts";
import { syncDirectory } from "../lib/sync-directory.ts";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";
import { deepMerge } from "../lib/deep-merge.ts";

/** Read JSON file or return {} if missing. */
async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Write JSON to file, creating parent directories as needed. */
async function writeJsonFile(
  filePath: string,
  data: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// =============================================================================
// Gemini Adapter
// =============================================================================

export class GeminiAdapter implements PlatformAdapter {
  readonly platform: Platform = "gemini";
  readonly configDir: string = ".gemini";
  readonly contextFile: string = "GEMINI.md";

  // ---------------------------------------------------------------------------
  // syncAgentsDirect
  // ---------------------------------------------------------------------------

  /**
   * Gemini does not support native subagents.
   * Logs a warning and skips without error.
   */
  async syncAgentsDirect(
    _targetPath: string,
    displayName: string,
    _sourcePath: string,
    _addSkills?: string[],
    _addHooks?: unknown[],
    _dryRun = false,
    _modelMap?: Record<string, string>,
  ): Promise<void> {
    logWarn(`Gemini: agents는 지원되지 않습니다. Skip: ${displayName}`);
  }

  // ---------------------------------------------------------------------------
  // syncCommandsDirect
  // ---------------------------------------------------------------------------

  /**
   * Converts a .md command file to .toml in .gemini/commands/.
   * Reads the frontmatter `description` field and writes:
   *   [extension]
   *   name = "{displayName}"
   *   description = "{description}"
   */
  async syncCommandsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".gemini", "commands");
    const targetFile = path.join(targetDir, `${displayName}.toml`);

    try {
      await fs.stat(sourcePath);
    } catch {
      logWarn(`Command file not found: ${sourcePath}`);
      return;
    }

    if (dryRun) {
      logDry(`Convert: ${sourcePath} -> ${targetFile}`);
      return;
    }

    // Extract frontmatter description
    const content = await fs.readFile(sourcePath, "utf8");
    const { frontmatter } = parseFrontmatter(content);
    const description =
      typeof frontmatter["description"] === "string"
        ? frontmatter["description"]
        : "";

    await fs.mkdir(targetDir, { recursive: true });
    const toml = `[extension]\nname = "${displayName}"\ndescription = "${description}"\n`;
    await fs.writeFile(targetFile, toml, "utf8");
    logInfo(`Created: ${displayName}.toml`);
  }

  // ---------------------------------------------------------------------------
  // syncHooksDirect
  // ---------------------------------------------------------------------------

  /**
   * Copies a hook file (chmod +x) or syncs a hook directory to .gemini/hooks/.
   */
  async syncHooksDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".gemini", "hooks");

    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      logWarn(`Hook not found: ${sourcePath}`);
      return;
    }

    if (stat.isDirectory()) {
      const targetHookDir = path.join(targetDir, displayName);
      if (dryRun) {
        logDry(`Copy (directory): ${sourcePath} -> ${targetHookDir}/`);
      } else {
        await syncDirectory(sourcePath, targetHookDir, {
          exclude: ["*.test.ts"],
        });
        logInfo(`Copied: ${displayName}/`);
      }
    } else {
      const targetFile = path.join(targetDir, displayName);
      if (dryRun) {
        logDry(`Copy: ${sourcePath} -> ${targetFile}`);
      } else {
        await fs.mkdir(targetDir, { recursive: true });
        await fs.copyFile(sourcePath, targetFile);
        // chmod +x
        const tgtStat = await fs.stat(targetFile);
        await fs.chmod(targetFile, tgtStat.mode | 0o111);
        logInfo(`Copied: ${displayName}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // syncSkillsDirect
  // ---------------------------------------------------------------------------

  /** Syncs a skill directory to .gemini/skills/{displayName}/. */
  async syncSkillsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetSkillDir = path.join(targetPath, ".gemini", "skills", displayName);

    try {
      const stat = await fs.stat(sourcePath);
      if (!stat.isDirectory()) throw new Error("not a directory");
    } catch {
      logWarn(`Skill directory not found: ${sourcePath}`);
      return;
    }

    if (dryRun) {
      logDry(`Copy (directory): ${sourcePath} -> ${targetSkillDir}`);
      return;
    }

    await syncDirectory(sourcePath, targetSkillDir);
    logInfo(`Copied: ${displayName}/`);
  }

  // ---------------------------------------------------------------------------
  // syncScriptsDirect
  // ---------------------------------------------------------------------------

  /** Syncs a script file or directory to .gemini/scripts/. */
  async syncScriptsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".gemini", "scripts");

    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      logWarn(`Script not found: ${sourcePath}`);
      return;
    }

    if (stat.isDirectory()) {
      const targetScriptDir = path.join(targetDir, displayName);
      if (dryRun) {
        logDry(`Copy (directory): ${sourcePath} -> ${targetScriptDir}/`);
      } else {
        await syncDirectory(sourcePath, targetScriptDir, {
          exclude: ["*.test.ts"],
        });
        logInfo(`Copied: ${displayName}/`);
      }
      return;
    }

    const targetFile = path.join(targetDir, displayName);
    if (dryRun) {
      logDry(`Copy: ${sourcePath} -> ${targetFile}`);
    } else {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.copyFile(sourcePath, targetFile);
      logInfo(`Copied: ${displayName}`);
    }
  }

  // ---------------------------------------------------------------------------
  // syncRulesDirect
  // ---------------------------------------------------------------------------

  /**
   * Gemini has no rules support.
   * Logs a warning and skips without error.
   */
  async syncRulesDirect(
    _targetPath: string,
    displayName: string,
    _sourcePath: string,
    _dryRun = false,
  ): Promise<void> {
    logWarn(`Gemini: rules는 지원되지 않습니다. Skip: ${displayName}`);
  }

  // ---------------------------------------------------------------------------
  // buildHookEntry
  // ---------------------------------------------------------------------------

  /**
   * Builds a hook entry object for the Gemini settings.json hooks section.
   *
   * Returns shape: { [event]: [{ matcher, hooks: [...] }] }
   *
   * For command type, substitutes `${component}` placeholder with displayName.
   */
  buildHookEntry(
    event: string,
    matcher: string,
    type: "command" | "prompt",
    timeout: number,
    commandOrPrompt: string,
    displayName?: string,
  ): Record<string, unknown[]> {
    let hookDef: Record<string, unknown>;
    if (type === "prompt") {
      hookDef = { type: "prompt", prompt: commandOrPrompt, timeout };
    } else {
      let cmdPath = commandOrPrompt;
      if (displayName) {
        cmdPath = cmdPath.replace(/\$\{component\}/g, displayName);
      }
      hookDef = { type: "command", command: cmdPath, timeout };
    }

    return {
      [event]: [{ matcher, hooks: [hookDef] }],
    };
  }

  // ---------------------------------------------------------------------------
  // updateSettings
  // ---------------------------------------------------------------------------

  /**
   * Merges a hooks object into .gemini/settings.json using deep merge.
   * The hooks object has event keys mapped to arrays of hook entries.
   */
  async updateSettings(
    targetPath: string,
    hooksEntries: Record<string, unknown>,
    dryRun = false,
  ): Promise<void> {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");

    if (dryRun) {
      logDry(`Update settings.json: ${settingsFile}`);
      logDry(`New hooks: ${JSON.stringify(hooksEntries)}`);
      return;
    }

    await fs.mkdir(path.join(targetPath, ".gemini"), { recursive: true });
    const current = await readJsonFile(settingsFile);
    const merged = deepMerge(current, hooksEntries);
    await writeJsonFile(settingsFile, merged);
    logInfo(`Updated settings.json: ${settingsFile}`);
  }

  // ---------------------------------------------------------------------------
  // syncConfig
  // ---------------------------------------------------------------------------

  /** Deep merges config fields into .gemini/settings.json. */
  async syncConfig(
    targetPath: string,
    configJson: Record<string, unknown>,
    dryRun = false,
  ): Promise<void> {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");

    if (dryRun) {
      logDry(`Config merge: ${JSON.stringify(configJson)} -> ${settingsFile}`);
      return;
    }

    await fs.mkdir(path.join(targetPath, ".gemini"), { recursive: true });
    const current = await readJsonFile(settingsFile);
    const merged = deepMerge(current, configJson);
    await writeJsonFile(settingsFile, merged);
    logInfo(`Config merged: ${settingsFile}`);
  }

  // ---------------------------------------------------------------------------
  // syncMcpsMerge
  // ---------------------------------------------------------------------------

  /** Merges an MCP server definition into .gemini/settings.json mcpServers. */
  async syncMcpsMerge(
    targetPath: string,
    serverName: string,
    serverJson: Record<string, unknown>,
    dryRun = false,
  ): Promise<void> {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");

    if (dryRun) {
      logDry(`MCP merge: ${serverName} -> ${settingsFile}`);
      logDry(`Server config: ${JSON.stringify(serverJson)}`);
      return;
    }

    await fs.mkdir(path.join(targetPath, ".gemini"), { recursive: true });
    const current = await readJsonFile(settingsFile);
    const mcpServers = (current["mcpServers"] as Record<string, unknown>) ?? {};
    mcpServers[serverName] = serverJson;
    await writeJsonFile(settingsFile, { ...current, mcpServers });
    logInfo(`MCP merged: ${serverName} -> ${settingsFile}`);
  }

  // ---------------------------------------------------------------------------
  // syncPlatformYaml
  // ---------------------------------------------------------------------------

  /**
   * Processes all sections from a gemini.yaml platform config object.
   *
   * Sections handled: config, hooks, mcps
   * Not handled: model-map (Gemini has none), plugins (not supported)
   *
   * Returns the list of processed sections with modelMap: undefined.
   */
  async syncPlatformYaml(
    targetPath: string,
    platformYaml: Record<string, unknown>,
    dryRun: boolean,
  ): Promise<PlatformConfigResult> {
    const yaml = platformYaml as PlatformYaml;
    const processedSections: string[] = [];

    // --- config ---
    if (yaml.config != null) {
      await this.syncConfig(targetPath, yaml.config, dryRun);
      processedSections.push("config");
    }

    // --- hooks ---
    if (yaml.hooks != null) {
      const hooksMap = yaml.hooks as Record<string, Array<Record<string, unknown>>>;
      const accumulatedHooks: Record<string, unknown[]> = {};
      let hasHooks = false;

      for (const [hookEvent, items] of Object.entries(hooksMap)) {
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          const component = (item["component"] as string | undefined) ?? "";
          const timeout = (item["timeout"] as number | undefined) ?? 10;
          const matcher = (item["matcher"] as string | undefined) ?? "*";
          const hookType = (item["type"] as string | undefined) ?? "command";
          const customCommand = (item["command"] as string | undefined) ?? "";
          const promptText = (item["prompt"] as string | undefined) ?? "";

          let displayName = "";
          let resolvedSourcePath = "";

          // If a component is specified, copy the hook file/dir
          if (component) {
            // component is a pre-resolved absolute path (orchestrator resolves before calling adapter)
            displayName = path.basename(component);
            resolvedSourcePath = component;

            await this.syncHooksDirect(
              targetPath,
              displayName,
              resolvedSourcePath,
              dryRun,
            );
          }

          // Build hook entry
          let hookEntry: Record<string, unknown[]>;

          if (hookType === "prompt") {
            if (!promptText) {
              logWarn(`Hook prompt가 정의되지 않음: event=${hookEvent} (스킵)`);
              continue;
            }
            hookEntry = this.buildHookEntry(
              hookEvent,
              matcher,
              "prompt",
              timeout,
              promptText,
              displayName,
            );
          } else {
            let cmdPath: string;
            if (customCommand) {
              cmdPath = customCommand;
            } else if (component) {
              // Determine command path based on whether source is a directory
              let isDir = false;
              try {
                const stat = await fs.stat(resolvedSourcePath);
                isDir = stat.isDirectory();
              } catch {
                // treat as file
              }

              if (isDir) {
                const indexTs = path.join(resolvedSourcePath, "index.ts");
                const indexSh = path.join(resolvedSourcePath, "index.sh");
                let hasIndexTs = false;
                let hasIndexSh = false;
                try {
                  await fs.stat(indexTs);
                  hasIndexTs = true;
                } catch { /* empty */ }
                try {
                  await fs.stat(indexSh);
                  hasIndexSh = true;
                } catch { /* empty */ }

                if (hasIndexTs) {
                  cmdPath = `bun run .gemini/hooks/${displayName}/index.ts`;
                } else if (hasIndexSh) {
                  cmdPath = `bash .gemini/hooks/${displayName}/index.sh`;
                } else {
                  logWarn(`Hook 디렉토리에 index.ts 또는 index.sh가 없음: ${resolvedSourcePath} (스킵)`);
                  continue;
                }
              } else {
                cmdPath = `.gemini/hooks/${displayName}`;
              }
            } else {
              logWarn(`Hook command가 정의되지 않음: event=${hookEvent} (스킵)`);
              continue;
            }

            hookEntry = this.buildHookEntry(
              hookEvent,
              matcher,
              "command",
              timeout,
              cmdPath,
              displayName,
            );
          }

          // Accumulate hook entries per event
          const existing = (accumulatedHooks[hookEvent] as unknown[]) ?? [];
          const entryArray = hookEntry[hookEvent] as unknown[];
          accumulatedHooks[hookEvent] = [...existing, ...entryArray];
          hasHooks = true;
        }
      }

      if (hasHooks) {
        await this.updateSettings(targetPath, accumulatedHooks, dryRun);
      }
      processedSections.push("hooks");
    }

    // --- mcps ---
    if (yaml.mcps != null) {
      const mcps = yaml.mcps as Record<string, Record<string, unknown>>;
      for (const [name, serverJson] of Object.entries(mcps)) {
        await this.syncMcpsMerge(targetPath, name, serverJson, dryRun);
      }
      processedSections.push("mcps");
    }

    return { processedSections, modelMap: undefined };
  }
}
