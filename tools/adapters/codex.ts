/**
 * OpenAI Codex CLI Adapter
 * Implements PlatformAdapter for the Codex platform.
 *
 * Key behaviors:
 * - agents: not supported, skip with warning
 * - commands: not supported (global ~/.codex/prompts/ only), skip with warning
 * - hooks: Notification event only
 * - skills, scripts: syncDirectory
 * - rules: not supported, skip with warning
 * - config: TOML managed block in .codex/config.toml
 * - mcps: accumulate all servers, flush as single managed block
 */

import fs from "fs/promises";
import path from "path";
import { stringify } from "smol-toml";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";
import { readTextFile } from "../lib/json.ts";
import { syncDirectory, copyFile } from "../lib/sync-directory.ts";
import type { PlatformConfigResult } from "../lib/types.ts";
import type { PlatformAdapter } from "./types.ts";

// =============================================================================
// TOML Managed Block Helpers
// =============================================================================

/**
 * Inserts or replaces a managed block in TOML content.
 *
 * Finds `# --- omt:{blockName} ---` / `# --- end omt:{blockName} ---` markers
 * and replaces everything between them (inclusive) with the new block content.
 * If markers are not found, appends the block at the end.
 *
 * Content outside managed blocks is always preserved.
 */
export function insertManagedBlock(
  content: string,
  blockName: string,
  tomlContent: string
): string {
  const startMarker = `# --- omt:${blockName} ---`;
  const endMarker = `# --- end omt:${blockName} ---`;

  const block = `${startMarker}\n${tomlContent}${endMarker}`;

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing block (inclusive of markers)
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + endMarker.length);
    // Trim trailing newlines from before, trim leading newlines from after
    const beforeTrimmed = before.replace(/\n+$/, "");
    const afterTrimmed = after.replace(/^\n+/, "");
    if (beforeTrimmed && afterTrimmed) {
      return `${beforeTrimmed}\n\n${block}\n\n${afterTrimmed}`;
    } else if (beforeTrimmed) {
      return `${beforeTrimmed}\n\n${block}\n`;
    } else if (afterTrimmed) {
      return `${block}\n\n${afterTrimmed}`;
    } else {
      return `${block}\n`;
    }
  }

  // Append at end
  const trimmed = content.replace(/\n+$/, "");
  if (trimmed) {
    return `${trimmed}\n\n${block}\n`;
  }
  return `${block}\n`;
}

// =============================================================================
// MCP Accumulator
// =============================================================================

/**
 * Builds the TOML content for a managed MCP block from accumulated servers.
 *
 * Each server becomes a `[mcp_servers.<name>]` section.
 * Object sub-keys become `[mcp_servers.<name>.<key>]` sub-tables.
 */
export function buildMcpTomlContent(
  servers: Record<string, Record<string, unknown>>
): string {
  // We use smol-toml stringify via a constructed object
  // Build: { mcp_servers: { <name>: { ... } } }
  const mcpServersObj: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(servers)) {
    mcpServersObj[name] = server;
  }
  // smol-toml stringify on { mcp_servers: { ... } }
  const tomlObj = { mcp_servers: mcpServersObj };
  const tomlStr = stringify(tomlObj);
  return tomlStr;
}

// =============================================================================
// CodexAdapter
// =============================================================================

export class CodexAdapter implements PlatformAdapter {
  readonly platform = "codex" as const;
  readonly configDir = ".codex";
  readonly contextFile = "AGENTS.md";

  /** Accumulated MCP servers (reset at the start of each syncPlatformYaml call) */
  private mcpAccumulator: Record<string, Record<string, unknown>> = {};

  // ---------------------------------------------------------------------------
  // syncAgentsDirect — not supported
  // ---------------------------------------------------------------------------

  async syncAgentsDirect(
    _targetPath: string,
    displayName: string,
    _sourcePath: string,
    _addSkills?: string[],
    _addHooks?: unknown[],
    _dryRun = false,
    _modelMap?: Record<string, string>,
  ): Promise<void> {
    logWarn(`Codex: agents는 지원되지 않습니다. Skip: ${displayName}`);
  }

  // ---------------------------------------------------------------------------
  // syncCommandsDirect — not supported
  // ---------------------------------------------------------------------------

  async syncCommandsDirect(
    _targetPath: string,
    displayName: string,
    _sourcePath: string,
    _dryRun = false
  ): Promise<void> {
    logWarn(
      `Codex: commands는 project-local이 아닌 ~/.codex/prompts/ (global)만 지원됩니다. Skip: ${displayName}`
    );
  }

  // ---------------------------------------------------------------------------
  // syncHooksDirect — Notification event only
  // ---------------------------------------------------------------------------

  async syncHooksDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false
  ): Promise<void> {
    // event filtering is handled by the caller (sync.sh / orchestrator)
    // This method is called only for supported events — just copy the file
    const targetDir = path.join(targetPath, this.configDir, "hooks");

    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      logWarn(`Hook not found: ${sourcePath}`);
      return;
    }

    if (stat.isDirectory()) {
      if (dryRun) {
        logDry(
          `Copy (directory): ${sourcePath} -> ${path.join(targetDir, displayName)}/`
        );
        return;
      }
      await syncDirectory(
        sourcePath,
        path.join(targetDir, displayName)
      );
      logInfo(`Copied: ${displayName}/`);
    } else {
      const targetFile = path.join(targetDir, displayName);
      if (dryRun) {
        logDry(`Copy: ${sourcePath} -> ${targetFile}`);
        return;
      }
      await copyFile(sourcePath, targetFile);
      // Ensure executable
      const fileStat = await fs.stat(targetFile);
      await fs.chmod(targetFile, fileStat.mode | 0o111);
      logInfo(`Copied: ${displayName}`);
    }
  }

  // ---------------------------------------------------------------------------
  // syncSkillsDirect — syncDirectory
  // ---------------------------------------------------------------------------

  async syncSkillsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false
  ): Promise<void> {
    const targetDir = path.join(targetPath, this.configDir, "skills");
    const targetSkillDir = path.join(targetDir, displayName);

    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      logWarn(`Skill directory not found: ${sourcePath}`);
      return;
    }

    if (!stat.isDirectory()) {
      logWarn(`Skill path is not a directory: ${sourcePath}`);
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
  // syncScriptsDirect — syncDirectory or copyFile
  // ---------------------------------------------------------------------------

  async syncScriptsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun = false
  ): Promise<void> {
    const targetDir = path.join(targetPath, this.configDir, "scripts");

    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      logWarn(`Script not found: ${sourcePath}`);
      return;
    }

    if (stat.isDirectory()) {
      if (dryRun) {
        logDry(
          `Copy (directory): ${sourcePath} -> ${path.join(targetDir, displayName)}/`
        );
        return;
      }
      await syncDirectory(
        sourcePath,
        path.join(targetDir, displayName)
      );
      logInfo(`Copied: ${displayName}/`);
    } else {
      const targetFile = path.join(targetDir, displayName);
      if (dryRun) {
        logDry(`Copy: ${sourcePath} -> ${targetFile}`);
        return;
      }
      await copyFile(sourcePath, targetFile);
      logInfo(`Copied: ${displayName}`);
    }
  }

  // ---------------------------------------------------------------------------
  // syncRulesDirect — not supported
  // ---------------------------------------------------------------------------

  async syncRulesDirect(
    _targetPath: string,
    displayName: string,
    _sourcePath: string,
    _dryRun = false
  ): Promise<void> {
    logWarn(`Codex: rules는 지원되지 않습니다. Skip: ${displayName}`);
  }

  // ---------------------------------------------------------------------------
  // syncConfig — write TOML managed block to .codex/config.toml
  // ---------------------------------------------------------------------------

  async syncConfig(
    targetPath: string,
    configJson: Record<string, unknown>,
    dryRun = false
  ): Promise<void> {
    const configFile = path.join(targetPath, this.configDir, "config.toml");

    if (dryRun) {
      logDry(`Config managed block: ${JSON.stringify(configJson)} -> ${configFile}`);
      return;
    }

    await fs.mkdir(path.join(targetPath, this.configDir), { recursive: true });

    const existing = await readTextFile(configFile);

    // Use smol-toml to generate TOML content from the config object
    const tomlContent = stringify(configJson);
    const updated = insertManagedBlock(existing, "config", tomlContent);

    await fs.writeFile(configFile, updated, "utf-8");
    logInfo(`Config managed block: ${configFile}`);
  }

  // ---------------------------------------------------------------------------
  // MCP accumulation helpers
  // ---------------------------------------------------------------------------

  /** Reset MCP accumulator (called at start of syncPlatformYaml) */
  resetMcpAccumulator(): void {
    this.mcpAccumulator = {};
  }

  /** Accumulate a single MCP server */
  accumulateMcp(name: string, server: Record<string, unknown>): void {
    this.mcpAccumulator[name] = server;
  }

  /** Flush all accumulated MCP servers to a managed block in config.toml */
  async flushMcpBlock(targetPath: string, dryRun: boolean): Promise<void> {
    const configFile = path.join(targetPath, this.configDir, "config.toml");
    const serverCount = Object.keys(this.mcpAccumulator).length;

    if (serverCount === 0) {
      // If a managed MCP block exists in the file, replace it with an empty block
      const existing = await readTextFile(configFile);
      if (!existing) {
        // File does not exist — nothing to clean up
        return;
      }
      const startMarker = `# --- omt:mcp ---`;
      if (!existing.includes(startMarker)) {
        return;
      }
      if (dryRun) {
        logDry(`MCP managed block (empty — removing servers): ${configFile}`);
        return;
      }
      const updated = insertManagedBlock(existing, "mcp", "# No MCP servers configured\n");
      await fs.writeFile(configFile, updated, "utf-8");
      logInfo(`MCP managed block cleared: ${configFile}`);
      return;
    }

    if (dryRun) {
      logDry(
        `MCP managed block: ${JSON.stringify(this.mcpAccumulator)} -> ${configFile}`
      );
      return;
    }

    await fs.mkdir(path.join(targetPath, this.configDir), { recursive: true });

    const existing = await readTextFile(configFile);

    const tomlContent = buildMcpTomlContent(this.mcpAccumulator);
    const updated = insertManagedBlock(existing, "mcp", tomlContent);

    await fs.writeFile(configFile, updated, "utf-8");
    logInfo(`MCP managed block: ${configFile}`);
  }

  // ---------------------------------------------------------------------------
  // syncPlatformYaml — config, mcps, model-map
  // ---------------------------------------------------------------------------

  async syncPlatformYaml(
    targetPath: string,
    platformYaml: Record<string, unknown>,
    dryRun: boolean
  ): Promise<PlatformConfigResult> {
    const processedSections: string[] = [];
    let modelMap: Record<string, string> | undefined;

    // Reset MCP accumulator for this run
    this.resetMcpAccumulator();

    // --- config ---
    const configJson = platformYaml["config"];
    if (configJson != null && typeof configJson === "object" && !Array.isArray(configJson)) {
      await this.syncConfig(
        targetPath,
        configJson as Record<string, unknown>,
        dryRun
      );
      processedSections.push("config");
    }

    // --- mcps ---
    const mcps = platformYaml["mcps"];
    if (mcps != null && typeof mcps === "object" && !Array.isArray(mcps)) {
      const mcpsObj = mcps as Record<string, unknown>;
      for (const name of Object.keys(mcpsObj)) {
        const server = mcpsObj[name];
        if (server != null && typeof server === "object" && !Array.isArray(server)) {
          this.accumulateMcp(name, server as Record<string, unknown>);
          if (!dryRun) {
            logInfo(`MCP accumulated: ${name}`);
          }
        }
      }
      await this.flushMcpBlock(targetPath, dryRun);
      processedSections.push("mcps");
    }

    // --- model-map ---
    const modelMapRaw = platformYaml["model-map"];
    if (
      modelMapRaw != null &&
      typeof modelMapRaw === "object" &&
      !Array.isArray(modelMapRaw)
    ) {
      modelMap = modelMapRaw as Record<string, string>;
      processedSections.push("model-map");
    }

    // --- hooks ---
    const hooksRaw = platformYaml["hooks"];
    if (hooksRaw != null) {
      logWarn("Codex does not support hooks in config.toml. Skipping hooks section.");
    }

    return { processedSections, modelMap };
  }

  // ---------------------------------------------------------------------------
  // updateSettings — merge hooks into .codex/config.toml
  // ---------------------------------------------------------------------------

  async updateSettings(
    _targetPath: string,
    _hooksEntries: unknown[],
    _dryRun = false
  ): Promise<void> {
    logWarn("Codex does not support hooks in config.toml. Skipping hook entries.");
  }
}

export const codexAdapter = new CodexAdapter();
