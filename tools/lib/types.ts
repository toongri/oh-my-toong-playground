/**
 * Core type definitions for the oh-my-toong TypeScript sync tool.
 * Mirrors the global variables and structures used in tools/sync.sh.
 */

export type Platform = "claude" | "gemini" | "codex" | "opencode";

export type PluginScope = "user" | "project";

export type Category = "agents" | "commands" | "skills" | "scripts" | "rules";

export type SyncItem =
  | string
  | {
      component: string;
      platforms?: Platform[];
      "add-skills"?: string[];
      "add-hooks"?: Array<{ component: string; event: string; [key: string]: unknown }>;
      [key: string]: unknown;
    };

export type SyncSection = {
  platforms?: Platform[];
  items?: SyncItem[];
};

export type SyncYaml = {
  path?: string;
  name?: string;
  platforms?: Platform[];
  agents?: SyncSection;
  commands?: SyncSection;
  skills?: SyncSection;
  scripts?: SyncSection;
  rules?: SyncSection;
};

export type PlatformYamlHookItem = {
  component: string;
  timeout?: number;
  matcher?: string;
  [key: string]: unknown;
};

export type PlatformYaml = {
  config?: Record<string, unknown>;
  hooks?: Record<string, PlatformYamlHookItem[]>;
  mcps?: Record<string, Record<string, unknown>>;
  plugins?: { items?: Array<string | Record<string, unknown>> };
  statusLine?: string;
  "model-map"?: Record<string, string>;
};

export type SyncContext = {
  dryRun: boolean;
  projectName: string;
  projectDir: string;
  isRootYaml: boolean;
  backupSession: string;
  modelMaps: Map<Platform, Record<string, string>>;
  processedPaths: Set<string>;
  platformYamlSections: Map<Platform, string[]>;
};

export type PlatformConfigResult = {
  processedSections: string[];
  modelMap?: Record<string, string>;
};
