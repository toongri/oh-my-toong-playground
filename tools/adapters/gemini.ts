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
import { stringify as tomlStringify } from "smol-toml";

import type { Platform, PlatformConfigResult, PlatformYaml, PluginScope } from "../lib/types.ts";
import type { PlatformAdapter } from "./types.ts";
import { parseFrontmatter } from "../lib/frontmatter.ts";
import { syncDirectory } from "../lib/sync-directory.ts";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";
import { deepMerge } from "../lib/deep-merge.ts";
import { readJsonFile, writeJsonFile } from "../lib/json.ts";

// =============================================================================
// Extension installer types (for DI in tests)
// =============================================================================

export type ExtensionInstaller = (name: string) => Promise<void>;
export type CommandRunner = (command: string, cwd: string) => Promise<{ exitCode: number }>;

async function defaultExtensionInstaller(name: string): Promise<void> {
  const proc = Bun.spawn(["gemini", "extensions", "install", name], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`gemini extensions install ${name} failed`);
  }
}

async function defaultCommandRunner(
  command: string,
  cwd: string,
): Promise<{ exitCode: number }> {
  const proc = Bun.spawn(["bash", "-c", command], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  return { exitCode: proc.exitCode ?? 1 };
}

// =============================================================================
// Gemini Adapter
// =============================================================================

export class GeminiAdapter implements PlatformAdapter {
  readonly platform: Platform = "gemini";
  readonly configDir: string = ".gemini";
  readonly contextFile: string = "GEMINI.md";

  private readonly _installExtension: ExtensionInstaller;
  private readonly _runCommand: CommandRunner;

  constructor(installExtension?: ExtensionInstaller, runCommand?: CommandRunner) {
    this._installExtension = installExtension ?? defaultExtensionInstaller;
    this._runCommand = runCommand ?? defaultCommandRunner;
  }

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
    let frontmatter: Record<string, unknown> = {};
    try {
      ({ frontmatter } = parseFrontmatter(content));
    } catch (err) {
      logWarn(`Malformed frontmatter, skipping command: ${path.basename(sourcePath)} (${err instanceof Error ? err.message : err})`);
      return;
    }
    const description =
      typeof frontmatter["description"] === "string"
        ? frontmatter["description"]
        : "";

    await fs.mkdir(targetDir, { recursive: true });
    const toml = tomlStringify({ extension: { name: displayName, description } });
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
   * Atomically replaces hook event entries in .gemini/settings.json.
   * Preserves non-hook config keys (e.g. mcpServers, customInstructions, model).
   *
   * Hook event values are always arrays; config values are objects or strings.
   * This distinction is used to identify and remove stale hook entries.
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

    // Preserve non-hook config keys (objects/strings), remove stale hook event keys (arrays)
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(current)) {
      if (!Array.isArray(value)) {
        result[key] = value;
      }
    }
    // Apply new hooks atomically
    Object.assign(result, hooksEntries);

    await writeJsonFile(settingsFile, result);
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

  /** Replaces .gemini/settings.json mcpServers entirely with the provided servers map. */
  async syncMcpsMerge(
    targetPath: string,
    servers: Record<string, Record<string, unknown>>,
    dryRun = false,
  ): Promise<void> {
    const settingsFile = path.join(targetPath, ".gemini", "settings.json");

    if (dryRun) {
      logDry(`MCP replace: ${Object.keys(servers).join(", ")} -> ${settingsFile}`);
      return;
    }

    await fs.mkdir(path.join(targetPath, ".gemini"), { recursive: true });
    const current = await readJsonFile(settingsFile);
    // Build complete mcpServers from yaml
    const newMcpServers: Record<string, unknown> = {};
    for (const [name, serverDef] of Object.entries(servers)) {
      newMcpServers[name] = serverDef;
    }
    // Replace entirely (not merge)
    current.mcpServers = newMcpServers;
    await writeJsonFile(settingsFile, current);
    logInfo(`MCP replaced: ${settingsFile}`);
  }

  // ---------------------------------------------------------------------------
  // syncPlatformYaml
  // ---------------------------------------------------------------------------

  /**
   * Processes all sections from a gemini.yaml platform config object.
   *
   * Sections handled: config, hooks, mcps, plugins (as extensions)
   * Not handled: model-map (Gemini has none)
   *
   * Returns the list of processed sections with modelMap: undefined.
   */
  async syncPlatformYaml(
    targetPath: string,
    platformYaml: Record<string, unknown>,
    dryRun: boolean,
    _scope?: PluginScope,
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
        }
      }

      await this.updateSettings(targetPath, accumulatedHooks, dryRun);
      processedSections.push("hooks");
    }

    // --- mcps ---
    if (yaml.mcps != null) {
      const mcps = yaml.mcps as Record<string, Record<string, unknown>>;
      await this.syncMcpsMerge(targetPath, mcps, dryRun);
      processedSections.push("mcps");
    }

    // --- plugins (extensions) ---
    if (yaml.plugins?.items != null) {
      for (const item of yaml.plugins.items) {
        if (typeof item === "string" && item) {
          await this._installExtensionSafe(item, dryRun);
        } else if (typeof item === "object" && item !== null) {
          await this._installExtensionObjectSafe(
            item as Record<string, unknown>,
            targetPath,
            dryRun,
          );
        }
      }
      processedSections.push("plugins");
    }

    return { processedSections, modelMap: undefined };
  }

  // ---------------------------------------------------------------------------
  // Private extension install helpers
  // ---------------------------------------------------------------------------

  private async _installExtensionSafe(name: string, dryRun: boolean): Promise<void> {
    if (dryRun) {
      logDry(`gemini extensions install ${name}`);
      return;
    }

    try {
      await this._installExtension(name);
      logInfo(`익스텐션 설치 완료: ${name}`);
    } catch {
      logWarn(`익스텐션 설치 실패 (계속 진행): ${name}`);
    }
  }

  private async _installExtensionObjectSafe(
    item: Record<string, unknown>,
    targetPath: string,
    dryRun: boolean,
  ): Promise<void> {
    const name = typeof item["name"] === "string" ? item["name"] : "";
    if (!name) {
      logWarn("익스텐션 항목에 name이 없음 (스킵)");
      return;
    }

    const check = typeof item["check"] === "string" ? item["check"] : "";
    const preCommands = Array.isArray(item["pre-commands"])
      ? (item["pre-commands"] as string[])
      : [];

    if (dryRun) {
      logDry(`gemini extensions install ${name}`);
      return;
    }

    // Run check — skip install if exit 0
    if (check) {
      try {
        const { exitCode } = await this._runCommand(check, targetPath);
        if (exitCode === 0) {
          logInfo(`익스텐션 이미 설치됨 (스킵): ${name}`);
          return;
        }
      } catch {
        // check failed — proceed with install
      }
    }

    // Run pre-commands
    for (const cmd of preCommands) {
      try {
        await this._runCommand(cmd, targetPath);
      } catch {
        logWarn(`pre-command 실패 (계속 진행): ${cmd}`);
      }
    }

    try {
      await this._installExtension(name);
      logInfo(`익스텐션 설치 완료: ${name}`);
    } catch {
      logWarn(`익스텐션 설치 실패 (계속 진행): ${name}`);
    }
  }
}
