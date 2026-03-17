import type { Platform, PlatformConfigResult } from "../lib/types.ts";

/**
 * Common interface for all platform adapters.
 * Each adapter handles component deployment and platform-specific config for one target platform.
 */
export interface PlatformAdapter {
  /** Platform identifier (e.g., "claude", "gemini", "codex", "opencode") */
  readonly platform: Platform;

  /** Config directory name relative to target project (e.g., ".claude", ".gemini") */
  readonly configDir: string;

  /** Context file name (e.g., "CLAUDE.md", "GEMINI.md", "AGENTS.md") */
  readonly contextFile: string;

  /**
   * Sync an agent file to the target project.
   * Optionally injects skills and hooks into the agent's frontmatter.
   */
  syncAgentsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    addSkills?: string[],
    addHooks?: unknown[],
    dryRun?: boolean,
  ): Promise<void>;

  /** Sync a command file to the target project. */
  syncCommandsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void>;

  /**
   * Sync a hook file or directory to the target project.
   * Directories are synced recursively; files are copied with chmod +x.
   */
  syncHooksDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void>;

  /** Sync a skill directory to the target project. */
  syncSkillsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void>;

  /** Sync a script file or directory to the target project. */
  syncScriptsDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void>;

  /** Sync a rule file to the target project's rules directory. */
  syncRulesDirect(
    targetPath: string,
    displayName: string,
    sourcePath: string,
    dryRun?: boolean,
  ): Promise<void>;

  /**
   * Process a per-platform YAML config object and apply all sections
   * (config, hooks, mcps, plugins, statusLine, model-map).
   *
   * Returns the list of sections that were processed, plus an optional model map.
   */
  syncPlatformYaml(
    targetPath: string,
    platformYaml: Record<string, unknown>,
    dryRun: boolean,
  ): Promise<PlatformConfigResult>;

  /**
   * Optional: prepare a category target directory before sync (e.g., backup).
   */
  prepareCategory?(
    targetPath: string,
    category: string,
    backupSession: string,
  ): Promise<void>;
}
