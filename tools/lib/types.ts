/**
 * Core type definitions for the oh-my-toong TypeScript sync tool.
 * Mirrors the global variables and structures used in tools/sync.sh.
 */

export type Platform = "claude" | "gemini" | "codex" | "opencode";

export type PluginScope = "user" | "project";

export type PluginObjectItem = {
	name: string;
	check?: string;
	"pre-commands"?: string[];
};

export type DeployCategory = "agents" | "commands" | "skills" | "scripts" | "rules";

/** Backward-compat alias — existing consumers bind `Category`; keep resolving to the same union. */
export type Category = DeployCategory;

export type SourceCategory = DeployCategory | "docs";

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

export type ModelMapEntry = { model: string; effort?: string };

export type ModelMap = { tiers: Record<string, ModelMapEntry>; agents?: Record<string, ModelMapEntry> };

export type DocsItem = string | { component: string; path?: string; as?: string; delete?: true };

export type DocsSection = {
	path?: string;
	items?: DocsItem[];
};

export type ProvisionItem = {
	check?: string;
	commands: string[];
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
	docs?: DocsSection;
	provision?: ProvisionItem[];
	format?: string | string[];
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
	plugins?: { items?: Array<string | PluginObjectItem> };
	statusLine?: string;
	"model-map"?: ModelMap;
};

export type SyncContext = {
	dryRun: boolean;
	projectName: string;
	projectDir: string;
	isRootYaml: boolean;
	/**
	 * The OMT-owned backup root for this run, resolved once via
	 * resolveBackupBase() (run-scoped — one value for the entire sync run).
	 * Consumed only by the retention pruner and the startup location log —
	 * never by a writer directly.
	 */
	backupBase: string;
	/**
	 * The absolute per-deploy backup destination (<backupBase>/sync-backup/<deployId>),
	 * reassigned once per (target, worktree) at the top of each fan-out iteration
	 * (deploy-scoped). Consumed only by writers (backupCategory, backupDocs, and
	 * their call sites) — never by the pruner, which only ever sees backupBase.
	 */
	backupDest: string;
	modelMaps: Map<Platform, ModelMap>;
	/** Root/global platform model-maps; loaded once, NEVER cleared by processYaml. */
	rootModelMaps: Map<Platform, ModelMap>;
	processedPaths: Set<string>;
	platformYamlSections: Map<Platform, string[]>;
	/**
	 * Deploy roots whose per-worktree iteration failed (best-effort fan-out: one
	 * failing worktree is logged and skipped, the rest continue). A non-empty set
	 * forces the CLI to exit non-zero so an unwritable worktree is never silent.
	 */
	failedTargets: string[];
};

export type PlatformConfigResult = {
	processedSections: string[];
	modelMap?: ModelMap;
};
