import fs from "fs/promises";
import path from "path";

import type { Platform, PlatformConfigResult, PlatformYaml, PluginObjectItem, PluginScope } from "../lib/types.ts";
import type { PlatformAdapter } from "./types.ts";
import { parseFrontmatter, serializeFrontmatter } from "../lib/frontmatter.ts";
import { syncDirectory } from "../lib/sync-directory.ts";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";
import { syncShellDependencies, syncShellDepsForDir } from "./hook-deps.ts";
import { deepMerge } from "../lib/deep-merge.ts";
import { readJsonFile, writeJsonFile } from "../lib/json.ts";

// =============================================================================
// Plugin installer type (for DI in tests)
// =============================================================================

export type PluginInstaller = (name: string, targetPath: string, scope: PluginScope) => Promise<void>;

export type CommandRunner = (command: string, cwd: string) => Promise<{ exitCode: number }>;

async function defaultPluginInstaller(
  name: string,
  targetPath: string,
  scope: PluginScope,
): Promise<void> {
  const proc = Bun.spawn(["claude", "plugin", "install", "--scope", scope, name], {
    cwd: targetPath,
    env: { ...process.env, CLAUDECODE: "" },
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`claude plugin install --scope ${scope} ${name} exited with code ${proc.exitCode}`);
  }
}

async function defaultCommandRunner(command: string, cwd: string): Promise<{ exitCode: number }> {
  const proc = Bun.spawn(["bash", "-c", command], { cwd, stdout: "inherit", stderr: "inherit" });
  await proc.exited;
  return { exitCode: proc.exitCode ?? 1 };
}

// =============================================================================
// Claude Adapter
// =============================================================================

export class ClaudeAdapter implements PlatformAdapter {
  readonly platform: Platform = "claude";
  readonly configDir: string = ".claude";
  readonly contextFile: string = "CLAUDE.md";

  /** Injected plugin installer — swap out in tests. */
  private readonly _installPlugin: PluginInstaller;
  /** Injected command runner — swap out in tests. */
  private readonly _runCommand: CommandRunner;

  constructor(installPlugin?: PluginInstaller, runCommand?: CommandRunner) {
    this._installPlugin = installPlugin ?? defaultPluginInstaller;
    this._runCommand = runCommand ?? defaultCommandRunner;
  }

  // ---------------------------------------------------------------------------
  // syncAgentsDirect
  // ---------------------------------------------------------------------------

  async syncAgentsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    addSkills?: string[],
    addHooks?: unknown[],
    dryRun = false,
    _modelMap?: Record<string, string>,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".claude", "agents");
    const targetFile = path.join(targetDir, `${displayName}.md`);

    try {
      await fs.stat(sourcePath);
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

    // Inject add-skills into frontmatter
    if (addSkills && addSkills.length > 0) {
      await this._addSkillsToFrontmatter(targetFile, addSkills);
    }

    // Inject add-hooks into frontmatter (and deploy hook files)
    if (addHooks && addHooks.length > 0) {
      const hooks = addHooks as Array<{
        source_path?: string;
        display_name?: string;
        event: string;
        matcher?: string;
        type?: string;
        command?: string;
        prompt?: string;
        timeout?: number;
      }>;

      // Deploy hook component files first
      for (const hook of hooks) {
        if (hook.source_path && hook.display_name) {
          try {
            await fs.stat(hook.source_path);
            await this.syncHooksDirect(
              targetPath,
              hook.display_name,
              hook.source_path,
              false,
            );
          } catch {
            // Hook file not found; skip silently
          }
        }
      }

      // Build frontmatter-ready hook definitions
      const frontmatterHooks = hooks.map((h) => ({
        event: h.event,
        matcher: h.matcher ?? "*",
        type: h.type ?? "command",
        command:
          h.command && h.command !== ""
            ? h.command
            : `$CLAUDE_PROJECT_DIR/.claude/hooks/${h.display_name ?? ""}`,
        prompt: h.prompt,
        timeout: h.timeout ?? 10,
      }));

      await this._addHooksToFrontmatter(targetFile, frontmatterHooks);
    }
  }

  // ---------------------------------------------------------------------------
  // syncCommandsDirect
  // ---------------------------------------------------------------------------

  async syncCommandsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".claude", "commands");
    const targetFile = path.join(targetDir, `${displayName}.md`);

    try {
      await fs.stat(sourcePath);
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
  }

  // ---------------------------------------------------------------------------
  // syncHooksDirect
  // ---------------------------------------------------------------------------

  async syncHooksDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".claude", "hooks");
    // hooksSourceDir: parent of sourcePath — hooks/ root for top-level files,
    // or the directory hook itself (its .sh files resolve deps relative to it).
    const hooksSourceDir = path.dirname(sourcePath);

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
        // Scan .sh files in directory for dependencies (dry-run logging)
        await syncShellDepsForDir(sourcePath, hooksSourceDir, targetHookDir, dryRun);
      } else {
        await syncDirectory(sourcePath, targetHookDir, {
          exclude: ["*.test.ts"],
        });
        logInfo(`Copied: ${displayName}/`);
        // Copy shell dependencies discovered in directory hooks
        await syncShellDepsForDir(sourcePath, hooksSourceDir, targetHookDir, dryRun);
      }
    } else {
      const targetFile = path.join(targetDir, displayName);
      if (dryRun) {
        logDry(`Copy: ${sourcePath} -> ${targetFile}`);
        // Log dependency copies for dry-run
        await syncShellDependencies(sourcePath, hooksSourceDir, targetDir, dryRun);
      } else {
        await fs.mkdir(targetDir, { recursive: true });
        await fs.copyFile(sourcePath, targetFile);
        // chmod +x
        const tgtStat = await fs.stat(targetFile);
        await fs.chmod(targetFile, tgtStat.mode | 0o111);
        logInfo(`Copied: ${displayName}`);
        // Copy shell dependencies
        await syncShellDependencies(sourcePath, hooksSourceDir, targetDir, dryRun);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // syncSkillsDirect
  // ---------------------------------------------------------------------------

  async syncSkillsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".claude", "skills");
    const targetSkillDir = path.join(targetDir, displayName);

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

    await fs.mkdir(targetDir, { recursive: true });
    await syncDirectory(sourcePath, targetSkillDir);
    logInfo(`Copied: ${displayName}/`);
  }

  // ---------------------------------------------------------------------------
  // syncScriptsDirect
  // ---------------------------------------------------------------------------

  async syncScriptsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".claude", "scripts");

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

  async syncRulesDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false,
  ): Promise<void> {
    const targetDir = path.join(targetPath, ".claude", "rules");
    const targetFile = path.join(targetDir, `${displayName}.md`);

    try {
      await fs.stat(sourcePath);
    } catch {
      logWarn(`Rule file not found: ${sourcePath}`);
      return;
    }

    if (dryRun) {
      logDry(`Copy: ${sourcePath} -> ${targetFile}`);
      return;
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourcePath, targetFile);
    logInfo(`Copied: ${displayName}.md`);
  }

  // ---------------------------------------------------------------------------
  // syncPlatformYaml
  // ---------------------------------------------------------------------------

  async syncPlatformYaml(
    targetPath: string,
    yaml: PlatformYaml,
    dryRun: boolean,
    scope?: PluginScope,
  ): Promise<PlatformConfigResult> {
    const processedSections: string[] = [];

    // --- config ---
    if (yaml.config != null) {
      await this.syncConfig(targetPath, yaml.config, dryRun);
      processedSections.push("config");
    }

    // --- hooks ---
    if (yaml.hooks != null) {
      const hooksMap = yaml.hooks;
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

          // If a component is specified, resolve and copy the hook file
          if (component) {
            // component is a pre-resolved absolute path (orchestrator resolves before calling adapter)
            displayName = path.basename(component);
            resolvedSourcePath = component;

            // Copy the hook file/dir
            await this.syncHooksDirect(
              targetPath,
              displayName,
              resolvedSourcePath,
              dryRun,
            );
          }

          // Build hook entry
          let hookEntry: Record<string, unknown>;

          if (hookType === "prompt") {
            if (!promptText) {
              logWarn(`Hook prompt 미정의: event=${hookEvent} (스킵)`);
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
              // Determine command path based on whether it's a directory
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
                  cmdPath = `bun run $CLAUDE_PROJECT_DIR/.claude/hooks/${displayName}/index.ts`;
                } else if (hasIndexSh) {
                  cmdPath = `bash $CLAUDE_PROJECT_DIR/.claude/hooks/${displayName}/index.sh`;
                } else {
                  logWarn(`Hook 디렉토리에 index.ts/index.sh 없음: ${resolvedSourcePath} (스킵)`);
                  continue;
                }
              } else {
                cmdPath = `$CLAUDE_PROJECT_DIR/.claude/hooks/${displayName}`;
              }
            } else {
              logWarn(`Hook command 미정의: event=${hookEvent} (스킵)`);
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
      for (const [name, serverJson] of Object.entries(yaml.mcps)) {
        await this.syncMcpsMerge(targetPath, name, serverJson, dryRun, scope === "project" ? "local" : undefined);
      }
      processedSections.push("mcps");
    }

    // --- plugins ---
    if (yaml.plugins?.items != null) {
      const pluginScope = scope ?? "user";
      for (const item of yaml.plugins.items) {
        if (typeof item === "string" && item) {
          await this._installPluginSafe(item, targetPath, dryRun, pluginScope);
        } else if (typeof item === "object" && item !== null) {
          const obj = item as PluginObjectItem;
          if (!obj.name) { logWarn("플러그인 항목에 name 필드 없음 (스킵)"); continue; }
          await this._installPluginObjectSafe(obj.name, obj.check, obj["pre-commands"], targetPath, dryRun, pluginScope);
        }
      }
      processedSections.push("plugins");
    }

    // --- statusLine ---
    if (yaml.statusLine != null) {
      await this.setStatusline(targetPath, yaml.statusLine, dryRun);
      processedSections.push("statusLine");
    }

    return { processedSections, modelMap: undefined };
  }

  // ---------------------------------------------------------------------------
  // buildHookEntry
  // ---------------------------------------------------------------------------

  /**
   * Build a hook entry object for settings.json `hooks` section.
   *
   * Returns an object of shape: { [event]: [{ matcher, hooks: [...] }] }
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
      // Substitute ${component} placeholder if present
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
   * Merge hooks entries into .claude/settings.json.
   * Replaces the existing `hooks` key entirely with the new value.
   */
  async updateSettings(
    targetPath: string,
    hooksEntries: Record<string, unknown>,
    dryRun = false,
  ): Promise<void> {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");

    if (dryRun) {
      logDry(`Update settings.json: ${settingsFile}`);
      return;
    }

    await fs.mkdir(path.join(targetPath, ".claude"), { recursive: true });
    const current = await readJsonFile(settingsFile);
    // Remove existing hooks key, add new one
    const { hooks: _removed, ...rest } = current as { hooks?: unknown; [k: string]: unknown };
    const updated = { ...rest, hooks: hooksEntries };
    await writeJsonFile(settingsFile, updated);
    logInfo(`Updated settings.json: ${settingsFile}`);
  }

  // ---------------------------------------------------------------------------
  // setStatusline
  // ---------------------------------------------------------------------------

  /** Set the statusLine field in .claude/settings.json. */
  async setStatusline(
    targetPath: string,
    statusLine: string,
    dryRun = false,
  ): Promise<void> {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");

    if (dryRun) {
      logDry(`Set statusLine: ${statusLine} -> ${settingsFile}`);
      return;
    }

    await fs.mkdir(path.join(targetPath, ".claude"), { recursive: true });

    let current: Record<string, unknown>;
    try {
      current = await readJsonFile(settingsFile);
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        logWarn(`statusLine 설정 실패: ${settingsFile} JSON 파싱 오류`);
      } else {
        logWarn(`statusLine 설정 실패: ${settingsFile} 읽기 오류`);
      }
      return;
    }

    const merged = deepMerge(current, {
      statusLine: { type: "command", command: statusLine },
    });
    await writeJsonFile(settingsFile, merged);
    logInfo(`statusLine 설정 완료: ${settingsFile}`);
  }

  // ---------------------------------------------------------------------------
  // syncConfig
  // ---------------------------------------------------------------------------

  /** Deep merge config into .claude/settings.json. */
  async syncConfig(
    targetPath: string,
    configJson: Record<string, unknown>,
    dryRun = false,
  ): Promise<void> {
    const settingsFile = path.join(targetPath, ".claude", "settings.json");

    if (dryRun) {
      logDry(`Config merge: ${JSON.stringify(configJson)} -> ${settingsFile}`);
      return;
    }

    await fs.mkdir(path.join(targetPath, ".claude"), { recursive: true });
    const current = await readJsonFile(settingsFile);
    const merged = deepMerge(current, configJson);
    await writeJsonFile(settingsFile, merged);
    logInfo(`Config merged: ${settingsFile}`);
  }

  // ---------------------------------------------------------------------------
  // syncMcpsMerge
  // ---------------------------------------------------------------------------

  /**
   * Merge an MCP server definition into ~/.claude.json (user scope)
   * or .claude/settings.json (local scope).
   */
  async syncMcpsMerge(
    targetPath: string,
    serverName: string,
    serverJson: Record<string, unknown>,
    dryRun = false,
    scope?: string,
  ): Promise<void> {
    const claudeUserConfig =
      process.env["CLAUDE_USER_CONFIG"] ??
      path.join(process.env["HOME"] ?? "~", ".claude.json");

    if (dryRun) {
      if (scope === "local") {
        logDry(`MCP merge: ${serverName} -> ~/.claude.json (local: ${targetPath})`);
      } else {
        logDry(`MCP merge: ${serverName} -> ~/.claude.json (user scope)`);
      }
      return;
    }

    if (scope === "local") {
      const current = await readJsonFile(claudeUserConfig);
      const projects = (current["projects"] as Record<string, unknown>) ?? {};
      const projectEntry = (projects[targetPath] as Record<string, unknown>) ?? {};
      const mcpServers = (projectEntry["mcpServers"] as Record<string, unknown>) ?? {};
      mcpServers[serverName] = serverJson;
      projects[targetPath] = { ...projectEntry, mcpServers };
      await writeJsonFile(claudeUserConfig, { ...current, projects });
      logInfo(`MCP merged: ${serverName} -> ~/.claude.json (local: ${targetPath})`);
    } else {
      const current = await readJsonFile(claudeUserConfig);
      const mcpServers = (current["mcpServers"] as Record<string, unknown>) ?? {};
      mcpServers[serverName] = serverJson;
      await writeJsonFile(claudeUserConfig, { ...current, mcpServers });
      logInfo(`MCP merged: ${serverName} -> ~/.claude.json (user scope)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private frontmatter helpers
  // ---------------------------------------------------------------------------

  private async _addSkillsToFrontmatter(
    agentFile: string,
    skillsToAdd: string[],
  ): Promise<void> {
    const content = await fs.readFile(agentFile, "utf8");
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(content);
    } catch {
      logWarn(`Malformed frontmatter, skipping: ${agentFile}`);
      return;
    }
    const { frontmatter, body, hasFrontmatter } = parsed;

    if (!hasFrontmatter) {
      logWarn(`No frontmatter found: ${agentFile}`);
      return;
    }

    const existing = frontmatter["skills"];
    let currentSkills: string[] = [];
    if (Array.isArray(existing)) {
      currentSkills = existing.filter((s): s is string => typeof s === "string");
    } else if (typeof existing === "string" && existing) {
      currentSkills = [existing];
    }

    // Deduplicate: existing + new
    const merged = Array.from(new Set([...currentSkills, ...skillsToAdd]));
    frontmatter["skills"] = merged;

    await fs.writeFile(agentFile, serializeFrontmatter(frontmatter, body), "utf8");
    logInfo(`Updated frontmatter: ${agentFile}`);
  }

  private async _addHooksToFrontmatter(
    agentFile: string,
    hooks: Array<{
      event: string;
      matcher: string;
      type: string;
      command?: string;
      prompt?: string;
      timeout: number;
    }>,
  ): Promise<void> {
    const content = await fs.readFile(agentFile, "utf8");
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(content);
    } catch {
      logWarn(`Malformed frontmatter, skipping: ${agentFile}`);
      return;
    }
    const { frontmatter, body, hasFrontmatter } = parsed;

    if (!hasFrontmatter) {
      logWarn(`No frontmatter found: ${agentFile}`);
      return;
    }

    // Build Claude frontmatter hooks structure grouped by event:
    // hooks:
    //   SubagentStop:
    //     - matcher: "*"
    //       hooks:
    //         - type: command
    //           command: "..."
    //           timeout: 60
    const existingHooks =
      (frontmatter["hooks"] as Record<string, unknown[]>) ?? {};

    for (const h of hooks) {
      const eventHooks = (existingHooks[h.event] as Array<Record<string, unknown>>) ?? [];
      const hookDef: Record<string, unknown> =
        h.type === "prompt"
          ? { type: "prompt", prompt: h.prompt ?? "", timeout: h.timeout }
          : { type: "command", command: h.command ?? "", timeout: h.timeout };

      // Find existing matcher group or create new one
      const matcherGroup = eventHooks.find(
        (g) => g["matcher"] === h.matcher,
      ) as Record<string, unknown> | undefined;

      if (matcherGroup) {
        const inner = (matcherGroup["hooks"] as unknown[]) ?? [];
        inner.push(hookDef);
        matcherGroup["hooks"] = inner;
      } else {
        eventHooks.push({ matcher: h.matcher, hooks: [hookDef] });
      }

      existingHooks[h.event] = eventHooks;
    }

    frontmatter["hooks"] = existingHooks;
    await fs.writeFile(agentFile, serializeFrontmatter(frontmatter, body), "utf8");
    logInfo(`Updated frontmatter hooks: ${agentFile}`);
  }

  // ---------------------------------------------------------------------------
  // Private plugin install helper
  // ---------------------------------------------------------------------------

  private async _installPluginSafe(
    name: string,
    targetPath: string,
    dryRun: boolean,
    scope: PluginScope,
  ): Promise<void> {
    if (dryRun) {
      logDry(`claude plugin install --scope ${scope} ${name}`);
      return;
    }

    try {
      await this._installPlugin(name, targetPath, scope);
      logInfo(`플러그인 설치 완료: ${name} (scope: ${scope})`);
    } catch {
      logWarn(`플러그인 설치 실패 (계속 진행): ${name}`);
    }
  }

  private async _installPluginObjectSafe(
    name: string,
    check: string | undefined,
    preCommands: string[] | undefined,
    targetPath: string,
    dryRun: boolean,
    scope: PluginScope,
  ): Promise<void> {
    if (dryRun) {
      logDry(`claude plugin install --scope ${scope} ${name}`);
      return;
    }

    // Run check — skip installation if exit code is 0
    if (check) {
      try {
        const result = await this._runCommand(check, targetPath);
        if (result.exitCode === 0) {
          logInfo(`플러그인 이미 설치됨 (스킵): ${name}`);
          return;
        }
      } catch { /* check failed, proceed with install */ }
    }

    // Run pre-commands
    if (preCommands) {
      for (const cmd of preCommands) {
        try {
          await this._runCommand(cmd, targetPath);
        } catch {
          logWarn(`pre-command 실패 (계속 진행): ${cmd}`);
        }
      }
    }

    // Install
    try {
      await this._installPlugin(name, targetPath, scope);
      logInfo(`플러그인 설치 완료: ${name} (scope: ${scope})`);
    } catch {
      logWarn(`플러그인 설치 실패 (계속 진행): ${name}`);
    }
  }
}
