/**
 * OpenAI Codex CLI Adapter
 * Implements PlatformAdapter for the Codex platform.
 *
 * Key behaviors:
 * - agents: not supported, skip with warning
 * - commands: not supported (global ~/.codex/prompts/ only), skip with warning
 * - hooks: supported; command is a literal relative `bun run .codex/hooks/<name>/index.ts`
 * - skills, scripts: syncDirectory
 * - rules: not supported, skip with warning
 * - config: TOML managed block in .codex/config.toml
 * - mcps: accumulate all servers, flush as single managed block
 */

import fs from "fs/promises";
import path from "path";
import { stringify } from "smol-toml";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";
import { readTextFile, readJsonFile, writeJsonFile } from "../lib/json.ts";
import { isPlainObject } from "../lib/deep-merge.ts";
import { syncDirectory, copyFile } from "../lib/sync-directory.ts";
import { syncShellDependencies, syncShellDepsForDir } from "./hook-deps.ts";
import type {
	PlatformConfigResult,
	PlatformYaml,
	PlatformYamlHookItem,
	PluginScope,
} from "../lib/types.ts";
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
	tomlContent: string,
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
export function buildMcpTomlContent(servers: Record<string, Record<string, unknown>>): string {
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
// Type Guards
// =============================================================================

/** Type-predicate wrapper around isPlainObject, used to narrow `unknown` without a cast. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return isPlainObject(value);
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
		_dryRun = false,
	): Promise<void> {
		logWarn(
			`Codex: commands는 project-local이 아닌 ~/.codex/prompts/ (global)만 지원됩니다. Skip: ${displayName}`,
		);
	}

	// ---------------------------------------------------------------------------
	// syncHooksDirect — Notification event only
	// ---------------------------------------------------------------------------

	async syncHooksDirect(
		targetPath: string,
		displayName: string,
		sourcePath: string,
		dryRun = false,
	): Promise<void> {
		// event filtering is handled by the caller (sync.sh / orchestrator)
		// This method is called only for supported events — just copy the file
		const targetDir = path.join(targetPath, this.configDir, "hooks");
		const hooksSourceDir = path.dirname(sourcePath);

		let stat: Awaited<ReturnType<typeof fs.stat>>;
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
				await syncShellDepsForDir(sourcePath, hooksSourceDir, targetHookDir, dryRun);
				return;
			}
			await syncDirectory(sourcePath, targetHookDir, {
				exclude: ["*.test.ts"],
				platformRoot: path.join(targetPath, this.configDir),
			});
			logInfo(`Copied: ${displayName}/`);
			await syncShellDepsForDir(sourcePath, hooksSourceDir, targetHookDir, dryRun);
		} else {
			const targetFile = path.join(targetDir, displayName);
			if (dryRun) {
				logDry(`Copy: ${sourcePath} -> ${targetFile}`);
				await syncShellDependencies(sourcePath, hooksSourceDir, targetDir, dryRun);
				return;
			}
			await copyFile(sourcePath, targetFile);
			// Ensure executable
			const fileStat = await fs.stat(targetFile);
			await fs.chmod(targetFile, fileStat.mode | 0o111);
			logInfo(`Copied: ${displayName}`);
			await syncShellDependencies(sourcePath, hooksSourceDir, targetDir, dryRun);
		}
	}

	// ---------------------------------------------------------------------------
	// syncSkillsDirect — syncDirectory
	// ---------------------------------------------------------------------------

	async syncSkillsDirect(
		targetPath: string,
		displayName: string,
		sourcePath: string,
		dryRun = false,
	): Promise<void> {
		const targetDir = path.join(targetPath, this.configDir, "skills");
		const targetSkillDir = path.join(targetDir, displayName);

		let stat: Awaited<ReturnType<typeof fs.stat>>;
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
		dryRun = false,
	): Promise<void> {
		const targetDir = path.join(targetPath, this.configDir, "scripts");

		let stat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			stat = await fs.stat(sourcePath);
		} catch {
			logWarn(`Script not found: ${sourcePath}`);
			return;
		}

		if (stat.isDirectory()) {
			if (dryRun) {
				logDry(`Copy (directory): ${sourcePath} -> ${path.join(targetDir, displayName)}/`);
				return;
			}
			await syncDirectory(sourcePath, path.join(targetDir, displayName));
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
		_dryRun = false,
	): Promise<void> {
		logWarn(`Codex: rules는 지원되지 않습니다. Skip: ${displayName}`);
	}

	// ---------------------------------------------------------------------------
	// syncConfig — write TOML managed block to .codex/config.toml
	// ---------------------------------------------------------------------------

	async syncConfig(
		targetPath: string,
		configJson: Record<string, unknown>,
		dryRun = false,
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
			logDry(`MCP managed block: ${JSON.stringify(this.mcpAccumulator)} -> ${configFile}`);
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
		yaml: PlatformYaml,
		dryRun: boolean,
		_scope?: PluginScope,
	): Promise<PlatformConfigResult> {
		const processedSections: string[] = [];
		let modelMap: Record<string, string> | undefined;

		// Reset MCP accumulator for this run
		this.resetMcpAccumulator();

		// --- config ---
		if (yaml.config !== undefined && yaml.config !== null) {
			await this.syncConfig(targetPath, yaml.config, dryRun);
			processedSections.push("config");
		}

		// --- mcps ---
		if (yaml.mcps !== undefined && yaml.mcps !== null) {
			// After overlay merge a server value can be null: a local override file
			// uses `<name>: null` as a deletion marker to drop a server inherited from
			// the base config. Skip those so the managed block omits them entirely.
			const entries = Object.entries<Record<string, unknown> | null>(yaml.mcps);
			for (const [name, server] of entries) {
				if (server === undefined || server === null) continue;
				this.accumulateMcp(name, server);
				if (!dryRun) {
					logInfo(`MCP accumulated: ${name}`);
				}
			}
			await this.flushMcpBlock(targetPath, dryRun);
			processedSections.push("mcps");
		}

		// --- model-map ---
		if (yaml["model-map"] !== undefined && yaml["model-map"] !== null) {
			modelMap = yaml["model-map"];
			processedSections.push("model-map");
		}

		// --- hooks ---
		if (yaml.hooks !== undefined && yaml.hooks !== null) {
			const hooksMap = yaml.hooks;
			// "preserve" is not a hook-items array; it carries a sibling config shape.
			// Read it via a widened Object.entries generic (instead of a cast) so the
			// declared Record<string, PlatformYamlHookItem[]> type can still hold it.
			const hooksEntries = Object.entries<
				PlatformYamlHookItem[] | { "command-contains"?: string[] }
			>(hooksMap);
			const preserveValue = hooksEntries.find(([key]) => key === "preserve")?.[1];
			const preserveConfig = Array.isArray(preserveValue) ? undefined : preserveValue;
			const accumulatedHooks: Record<string, unknown[]> = {};

			for (const [hookEvent, items] of hooksEntries) {
				if (hookEvent === "preserve") continue;
				if (!Array.isArray(items)) continue;

				for (const item of items) {
					const component = item.component ?? "";
					const timeout = item.timeout ?? 10;
					const matcher = item.matcher ?? "*";
					const commandRaw = item["command"];
					const customCommand = typeof commandRaw === "string" ? commandRaw : "";

					let displayName = "";
					let resolvedSourcePath = "";

					// If a component is specified, resolve and deploy the hook bundle
					if (component) {
						// component is a pre-resolved absolute path (orchestrator resolves before calling adapter)
						displayName = path.basename(component);
						resolvedSourcePath = component;

						await this.syncHooksDirect(targetPath, displayName, resolvedSourcePath, dryRun);
					}

					// Build command string
					let cmdPath: string;
					if (customCommand) {
						cmdPath = customCommand;
					} else if (component) {
						// Check if the source is a directory and pick index.ts or index.sh
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
							} catch {
								/* empty */
							}
							try {
								await fs.stat(indexSh);
								hasIndexSh = true;
							} catch {
								/* empty */
							}

							if (hasIndexTs) {
								cmdPath = `bun run .codex/hooks/${displayName}/index.ts`;
							} else if (hasIndexSh) {
								cmdPath = `bash .codex/hooks/${displayName}/index.sh`;
							} else {
								logWarn(`Hook 디렉토리에 index.ts/index.sh 없음: ${resolvedSourcePath} (스킵)`);
								continue;
							}
						} else {
							cmdPath = `.codex/hooks/${displayName}`;
						}
					} else {
						logWarn(`Hook command 미정의: event=${hookEvent} (스킵)`);
						continue;
					}

					// Rewrite relative `.codex/` references to absolute paths rooted at
					// targetPath so the hook command works regardless of the cwd Codex
					// uses when it launches (which may be a subdirectory of the repo).
					// This is correct for both global (~/.codex) and project-local deploys
					// because targetPath IS the deploy root in both cases.
					cmdPath = cmdPath.replaceAll(".codex/", `${path.join(targetPath, ".codex")}/`);

					const hookEntry = this.buildHookEntry(hookEvent, matcher, timeout, cmdPath);

					// Accumulate hook entries per event
					const existing = accumulatedHooks[hookEvent] ?? [];
					const entryArray = hookEntry[hookEvent];
					accumulatedHooks[hookEvent] = [...existing, ...entryArray];
				}
			}

			// Guard: if an event had source items but all were skipped, throw rather than
			// writing hooks: {} and silently wiping previously-synced command hooks.
			for (const [hookEvent, items] of Object.entries(hooksMap)) {
				if (hookEvent === "preserve") continue;
				if (!Array.isArray(items) || items.length === 0) continue;
				const accumulated = accumulatedHooks[hookEvent];
				if (!accumulated || accumulated.length === 0) {
					throw new Error(
						`hooks.${hookEvent}: ${items.length} 개 항목이 모두 스킵되어 유효한 항목이 없습니다 — hooks.json 덮어쓰기를 거부합니다`,
					);
				}
			}

			await this.updateSettings(targetPath, accumulatedHooks, dryRun, preserveConfig);
			processedSections.push("hooks");
		}

		// --- plugins ---
		if (yaml.plugins !== undefined && yaml.plugins !== null) {
			logWarn("Codex does not support plugins. Skipping plugins section.");
		}

		return { processedSections, modelMap };
	}

	// ---------------------------------------------------------------------------
	// buildHookEntry
	// ---------------------------------------------------------------------------

	/**
	 * Build a hook entry object for hooks.json `hooks` section.
	 *
	 * Returns an object of shape: { [event]: [{ matcher, hooks: [hookDef] }] }
	 */
	buildHookEntry(
		event: string,
		matcher: string,
		timeout: number,
		command: string,
	): Record<string, unknown[]> {
		const hookDef: Record<string, unknown> = { type: "command", command, timeout };
		return {
			[event]: [{ matcher, hooks: [hookDef] }],
		};
	}

	// ---------------------------------------------------------------------------
	// updateSettings — write hooks into .codex/hooks.json
	// ---------------------------------------------------------------------------

	/**
	 * Replace the `hooks` key in .codex/hooks.json with the synced entries.
	 * Foreign hook entries whose command matches a `preserve.command-contains` marker
	 * are carried over so this full replace does not silently drop them.
	 * Mirrors the semantics of the Claude adapter's updateSettings (claude.ts:563-603)
	 * but targets `.codex/hooks.json` instead of `.claude/settings.json`.
	 */
	async updateSettings(
		targetPath: string,
		hooksEntries: Record<string, unknown>,
		dryRun = false,
		preserve?: { "command-contains"?: string[] },
	): Promise<void> {
		const hooksFile = path.join(targetPath, ".codex", "hooks.json");

		if (dryRun) {
			logDry(`Update hooks.json: ${hooksFile}`);
			return;
		}

		await fs.mkdir(path.join(targetPath, ".codex"), { recursive: true });
		const current = await readJsonFile(hooksFile);

		// Start from the synced (OMT-authored) entries, then carry over foreign
		// entries matching a preserve marker so the replace below keeps them.
		const mergedHooks: Record<string, unknown[]> = {};
		for (const [event, blocks] of Object.entries(hooksEntries)) {
			mergedHooks[event] = Array.isArray(blocks)
				? [...blocks]
				: // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- hooksEntries is declared Record<string, unknown>; a non-array value here is carried through as-is (defensive passthrough for an already-untyped boundary), matching prior behavior
					(blocks as unknown[]);
		}
		const markers = preserve?.["command-contains"] ?? [];
		const currentHooks = current.hooks;
		if (markers.length > 0 && isRecord(currentHooks)) {
			for (const [event, blocks] of Object.entries(currentHooks)) {
				if (!Array.isArray(blocks)) continue;
				for (const block of blocks) {
					if (this.hookCommandMatches(block, markers)) {
						(mergedHooks[event] ??= []).push(block);
					}
				}
			}
		}

		const { hooks: _removed, ...rest } = current;
		const updated = { ...rest, hooks: mergedHooks };
		await writeJsonFile(hooksFile, updated);
		logInfo(`Updated hooks.json: ${hooksFile}`);
	}

	/** True if any command in a hook block contains one of the preserve markers. */
	private hookCommandMatches(block: unknown, markers: string[]): boolean {
		if (!isRecord(block)) return false;
		const hooks = block.hooks;
		if (!Array.isArray(hooks)) return false;
		return hooks.some((h) => {
			const cmd = isRecord(h) ? h.command : undefined;
			return typeof cmd === "string" && markers.some((m) => cmd.includes(m));
		});
	}
}

export const codexAdapter = new CodexAdapter();
