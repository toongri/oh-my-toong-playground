import fs from "fs/promises";
import path from "path";

import type {
	ModelMap,
	Platform,
	PlatformConfigResult,
	PlatformYaml,
	PlatformYamlHookItem,
	PluginScope,
} from "../lib/types.ts";
import type { PlatformAdapter, PlatformWriteObserver } from "./types.ts";
import { parseFrontmatter, serializeFrontmatter } from "../lib/frontmatter.ts";
import { syncDirectory, copyFile } from "../lib/sync-directory.ts";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";
import { syncShellDependencies, syncShellDepsForDir } from "./hook-deps.ts";
import { deepMerge } from "../lib/deep-merge.ts";
import { readJsonFile, writeJsonFile } from "../lib/json.ts";
import { isGlobalSync } from "../lib/path-utils.ts";
import { deriveClaudeProjectKey } from "../lib/git-key.ts";
import { composePreToolTraceCommand } from "../lib/pretool-trace-command.ts";
import { planCategoryDestinationPaths, type DestinationCategory } from "./destinations.ts";
import type { DeployMutationHooks } from "../lib/deploy-transaction.ts";

// =============================================================================
// Local narrowing helpers (avoid `as` casts on loosely-typed YAML/JSON data)
// =============================================================================

/** Type-guard version of the plain-object check (mirrors deep-merge.ts's isPlainObject, but narrows). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v): v is string => typeof v === "string");
}

function claudeDestination(targetPath: string, category: DestinationCategory, displayName: string): string {
	const [relativePath] = planCategoryDestinationPaths("claude", category, displayName);
	if (!relativePath) throw new Error(`No Claude destination for ${category}`);
	return path.join(targetPath, relativePath);
}

function claudeDestinationRelative(category: DestinationCategory, displayName: string): string {
	const [relativePath] = planCategoryDestinationPaths("claude", category, displayName);
	if (!relativePath) throw new Error(`No Claude destination for ${category}`);
	return relativePath;
}

// =============================================================================
// Plugin installer type (for DI in tests)
// =============================================================================

export type PluginInstaller = (
	name: string,
	targetPath: string,
	scope: PluginScope,
) => Promise<void>;

export type CommandRunner = (command: string, cwd: string) => Promise<{ exitCode: number }>;

export type ClaudePreToolUsePreview = {
	hookEvent: "PreToolUse";
	itemIndex: number;
	hookId: string;
	originalCommand: string;
	wrappedCommand: string;
	wrapperDeploymentPath: string;
	matcher: string;
	timeout: number;
	scope: "global" | "project";
	component: string;
};

export class ClaudePreToolUsePreviewError extends Error {
	readonly itemIndex: number;

	constructor(itemIndex: number, message: string) {
		super(`Claude PreToolUse trace preview failed for item ${itemIndex}: ${message}`);
		this.name = "ClaudePreToolUsePreviewError";
		this.itemIndex = itemIndex;
	}
}

const CLAUDE_TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
		throw new Error(
			`claude plugin install --scope ${scope} ${name} exited with code ${proc.exitCode}`,
		);
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
		_modelMap?: ModelMap,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetFile = claudeDestination(targetPath, "agents", displayName);
		const targetDir = path.dirname(targetFile);

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

		const copyOperation = async (): Promise<void> => {
			await fs.mkdir(targetDir, { recursive: true });
			await copyFile(sourcePath, targetFile);
		};
		if (mutationHooks) await mutationHooks.mutate(targetFile, copyOperation);
		else await copyOperation();
		logInfo(`Copied: ${displayName}.md`);

		// Inject add-skills into frontmatter
		if (addSkills && addSkills.length > 0) {
			const operation = () => this._addSkillsToFrontmatter(targetFile, addSkills);
			if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
			else await operation();
		}

		// Inject add-hooks into frontmatter (and deploy hook files)
		if (addHooks && addHooks.length > 0) {
			const hooks = addHooks.map((h) => {
				const rec = isRecord(h) ? h : {};
				return {
					source_path: pickString(rec["source_path"]),
					display_name: pickString(rec["display_name"]),
					event: pickString(rec["event"]) ?? "",
					matcher: pickString(rec["matcher"]),
					type: pickString(rec["type"]),
					command: pickString(rec["command"]),
					prompt: pickString(rec["prompt"]),
					timeout:
						typeof rec["timeout"] === "number"
							? rec["timeout"]
							: typeof rec["timeout"] === "string" &&
								  rec["timeout"].trim() !== "" &&
								  Number.isFinite(Number(rec["timeout"]))
								? Number(rec["timeout"])
								: undefined,
				};
			});

			// Deploy hook component files first
			for (const hook of hooks) {
				if (hook.source_path && hook.display_name) {
					try {
						await fs.stat(hook.source_path);
					} catch {
						// Hook file not found; skip silently
						continue;
					}
					await this.syncHooksDirect(
						targetPath,
						hook.display_name,
						hook.source_path,
						false,
						undefined,
						mutationHooks,
					);
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
						: `${isGlobalSync(targetPath) ? "$HOME" : "$CLAUDE_PROJECT_DIR"}/${claudeDestinationRelative("hooks", h.display_name ?? "")}`,
				prompt: h.prompt,
				timeout: h.timeout ?? 10,
			}));

			const operation = () => this._addHooksToFrontmatter(targetFile, frontmatterHooks);
			if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
			else await operation();
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
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetFile = claudeDestination(targetPath, "commands", displayName);
		const targetDir = path.dirname(targetFile);

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

		const operation = async (): Promise<void> => {
			await fs.mkdir(targetDir, { recursive: true });
			await copyFile(sourcePath, targetFile);
		};
		if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
		else await operation();
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
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetFile = claudeDestination(targetPath, "hooks", displayName);
		const targetDir = path.dirname(targetFile);
		// hooksSourceDir: parent of sourcePath — hooks/ root for top-level files,
		// or the directory hook itself (its .sh files resolve deps relative to it).
		const hooksSourceDir = path.dirname(sourcePath);

		let stat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			stat = await fs.stat(sourcePath);
		} catch {
			logWarn(`Hook not found: ${sourcePath}`);
			return;
		}

		if (stat.isDirectory()) {
			const targetHookDir = targetFile;
			if (dryRun) {
				logDry(`Copy (directory): ${sourcePath} -> ${targetHookDir}/`);
				// Scan .sh files in directory for dependencies (dry-run logging)
				await syncShellDepsForDir(sourcePath, hooksSourceDir, targetHookDir, dryRun);
			} else {
				await syncDirectory(sourcePath, targetHookDir, {
					exclude: ["*.test.ts", "*.local.yaml"],
					platformRoot: path.join(targetPath, ".claude"),
					mutationHooks,
				});
				logInfo(`Copied: ${displayName}/`);
				if (!mutationHooks) await writeObserver?.(targetHookDir);
				// Copy shell dependencies discovered in directory hooks
				await syncShellDepsForDir(sourcePath, hooksSourceDir, targetHookDir, dryRun, writeObserver, mutationHooks);
			}
		} else {
			if (dryRun) {
				logDry(`Copy: ${sourcePath} -> ${targetFile}`);
				// Log dependency copies for dry-run
				await syncShellDependencies(sourcePath, hooksSourceDir, targetDir, dryRun);
			} else {
				const operation = async (): Promise<void> => {
					await fs.mkdir(targetDir, { recursive: true });
					await copyFile(sourcePath, targetFile);
					// chmod +x
					const tgtStat = await fs.stat(targetFile);
					await fs.chmod(targetFile, tgtStat.mode | 0o111);
				};
				if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
				else await operation();
				logInfo(`Copied: ${displayName}`);
				await writeObserver?.(targetFile);
				// Copy shell dependencies
				await syncShellDependencies(sourcePath, hooksSourceDir, targetDir, dryRun, writeObserver, mutationHooks);
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
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetSkillDir = claudeDestination(targetPath, "skills", displayName);

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

		await syncDirectory(sourcePath, targetSkillDir, {
			platformRoot: path.join(targetPath, ".claude"),
			mutationHooks,
		});
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
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetFile = claudeDestination(targetPath, "scripts", displayName);
		const targetDir = path.dirname(targetFile);

		let stat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			stat = await fs.stat(sourcePath);
		} catch {
			logWarn(`Script not found: ${sourcePath}`);
			return;
		}

		if (stat.isDirectory()) {
			const targetScriptDir = targetFile;
			if (dryRun) {
				logDry(`Copy (directory): ${sourcePath} -> ${targetScriptDir}/`);
			} else {
				await syncDirectory(sourcePath, targetScriptDir, {
					exclude: ["*.test.ts"],
					platformRoot: path.join(targetPath, ".claude"),
					mutationHooks,
				});
				logInfo(`Copied: ${displayName}/`);
			}
			return;
		}

		if (dryRun) {
			logDry(`Copy: ${sourcePath} -> ${targetFile}`);
		} else {
			const operation = async (): Promise<void> => {
				await fs.mkdir(targetDir, { recursive: true });
				await copyFile(sourcePath, targetFile);
			};
			if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
			else await operation();
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
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetFile = claudeDestination(targetPath, "rules", displayName);
		const targetDir = path.dirname(targetFile);

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

		const operation = async (): Promise<void> => {
			await fs.mkdir(targetDir, { recursive: true });
			await copyFile(sourcePath, targetFile);
		};
		if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
		else await operation();
		await writeObserver?.(targetFile);
		logInfo(`Copied: ${displayName}.md`);
	}

	// ---------------------------------------------------------------------------
	// syncPlatformYaml
	// ---------------------------------------------------------------------------

	/**
	 * Resolve command-type PreToolUse hooks and compose their trace wrappers.
	 * This method is intentionally pure with respect to deployment: it only
	 * stats source components and never creates, copies, or updates settings.
	 */
	async previewPreToolUseCommands(
		targetPath: string,
		yaml: PlatformYaml,
	): Promise<ClaudePreToolUsePreview[]> {
		const items = yaml.hooks?.PreToolUse;
		if (!Array.isArray(items)) return [];
		const wrapperDeploymentPath = path.join(
			claudeDestination(targetPath, "scripts", "pretool-trace"),
			"index.ts",
		);
		const scope = isGlobalSync(targetPath) ? "global" : "project";
		const previews: ClaudePreToolUsePreview[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			const item = items[itemIndex];
			if (!item || pickString(item["type"]) === "prompt") continue;
			const component = item.component ?? "";
			const customCommand = pickString(item["command"]) ?? "";
			if (!component) {
				if (Object.prototype.hasOwnProperty.call(item, "trace-id")) {
					const traceId = item["trace-id"];
					if (typeof traceId !== "string" || !CLAUDE_TRACE_ID_PATTERN.test(traceId)) {
						throw new ClaudePreToolUsePreviewError(itemIndex, "unsafe raw command trace-id");
					}
					if (!customCommand) {
						throw new ClaudePreToolUsePreviewError(itemIndex, "raw command is missing or not a string");
					}
					const matcher = item.matcher ?? "*";
					const timeout = item.timeout ?? 10;
					const wrappedCommand = composePreToolTraceCommand({
						wrapperPath: wrapperDeploymentPath,
						platform: "claude",
						hookId: traceId,
						originalCommand: customCommand,
					});
					previews.push({
						hookEvent: "PreToolUse",
						itemIndex,
						hookId: traceId,
						originalCommand: customCommand,
						wrappedCommand,
						wrapperDeploymentPath,
						matcher,
						timeout,
						scope,
						component,
					});
				}
				continue;
			}
			const hookId = path.basename(component);
			if (!CLAUDE_TRACE_ID_PATTERN.test(hookId)) {
				throw new ClaudePreToolUsePreviewError(itemIndex, `unsafe component basename ${hookId}`);
			}
			const matcher = item.matcher ?? "*";
			const timeout = item.timeout ?? 10;
			const originalCommand = await this._resolveHookCommand(targetPath, item, true);
			const wrappedCommand = composePreToolTraceCommand({
				wrapperPath: wrapperDeploymentPath,
				platform: "claude",
				hookId,
				originalCommand,
			});
			previews.push({
				hookEvent: "PreToolUse",
				itemIndex,
				hookId,
				originalCommand,
				wrappedCommand,
				wrapperDeploymentPath,
				matcher,
				timeout,
				scope,
				component,
			});
		}
		return previews;
	}

	private async _resolveHookCommand(
		targetPath: string,
		item: PlatformYamlHookItem,
		strictMissingIndex = false,
	): Promise<string> {
		const component = item.component ?? "";
		const customCommand = pickString(item["command"]) ?? "";
		if (customCommand) return customCommand;
		if (!component) return "";
		const displayName = path.basename(component);
		let stat: Awaited<ReturnType<typeof fs.stat>> | undefined;
		try {
			stat = await fs.stat(component);
		} catch {
			stat = undefined;
		}
		if (stat?.isDirectory()) {
			const indexTs = path.join(component, "index.ts");
			const indexSh = path.join(component, "index.sh");
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
			const hookPrefix = isGlobalSync(targetPath) ? "$HOME" : "$CLAUDE_PROJECT_DIR";
			const hookRelativePath = claudeDestinationRelative("hooks", displayName);
			if (hasIndexTs) return `bun run ${hookPrefix}/${hookRelativePath}/index.ts`;
			if (hasIndexSh) return `bash ${hookPrefix}/${hookRelativePath}/index.sh`;
			if (strictMissingIndex) {
				throw new ClaudePreToolUsePreviewError(-1, `hook directory has no index.ts/index.sh: ${component}`);
			}
			return "";
		}
		const hookPrefix = isGlobalSync(targetPath) ? "$HOME" : "$CLAUDE_PROJECT_DIR";
		return `${hookPrefix}/${claudeDestinationRelative("hooks", displayName)}`;
	}

	async syncPlatformYaml(
		targetPath: string,
		yaml: PlatformYaml,
		dryRun: boolean,
		scope?: PluginScope,
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<PlatformConfigResult> {
		const processedSections: string[] = [];
		const preToolUsePreview = await this.previewPreToolUseCommands(targetPath, yaml);

		// --- config ---
		if (yaml.config !== null && yaml.config !== undefined) {
			await this.syncConfig(targetPath, yaml.config, dryRun, writeObserver);
			processedSections.push("config");
		}

		// --- hooks ---
		if (yaml.hooks !== null && yaml.hooks !== undefined) {
			const previewByItemIndex = new Map(preToolUsePreview.map((preview) => [preview.itemIndex, preview]));
			const hooksMap = yaml.hooks;
			// "preserve" is a reserved key smuggled into the hooks map with a shape
			// (`{ "command-contains"?: string[] }`) that PlatformYaml.hooks doesn't
			// model (its declared value type is PlatformYamlHookItem[]). Widen to
			// unknown and narrow with guards instead of trusting the declared type.
			const hooksMapUnknown: unknown = hooksMap;
			const preserveRaw = isRecord(hooksMapUnknown) ? hooksMapUnknown["preserve"] : undefined;
			const preserveCommandContains = isRecord(preserveRaw)
				? preserveRaw["command-contains"]
				: undefined;
			const preserveConfig: { "command-contains"?: string[] } | undefined = isRecord(preserveRaw)
				? {
						"command-contains": isStringArray(preserveCommandContains)
							? preserveCommandContains
							: undefined,
					}
				: undefined;
			const accumulatedHooks: Record<string, unknown[]> = {};

			for (const [hookEvent, items] of Object.entries(hooksMap)) {
				if (hookEvent === "preserve") continue;
				if (!Array.isArray(items)) continue;

				for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
					const item = items[itemIndex];
					// component/timeout/matcher are declared fields on PlatformYamlHookItem;
					// type/command/prompt fall through its index signature as `unknown`.
					const component = item.component ?? "";
					const timeout = item.timeout ?? 10;
					const matcher = item.matcher ?? "*";
					const hookType = pickString(item["type"]) ?? "command";
					const promptText = pickString(item["prompt"]) ?? "";

					let displayName = "";

					// If a component is specified, resolve and copy the hook file
					if (component) {
						// component is a pre-resolved absolute path (orchestrator resolves before calling adapter)
						displayName = path.basename(component);

						// Copy the hook file/dir
						await this.syncHooksDirect(targetPath, displayName, component, dryRun, writeObserver, mutationHooks);
					}

					// Build hook entry (buildHookEntry always returns Record<string, unknown[]>)
					let hookEntry: Record<string, unknown[]>;

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
						const preview = hookEvent === "PreToolUse" ? previewByItemIndex.get(itemIndex) : undefined;
						const cmdPath = preview ? preview.wrappedCommand : await this._resolveHookCommand(targetPath, item);
						if (!cmdPath) {
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
					const existing = accumulatedHooks[hookEvent] ?? [];
					const entryArray = hookEntry[hookEvent] ?? [];
					accumulatedHooks[hookEvent] = [...existing, ...entryArray];
				}
			}

			await this.updateSettings(targetPath, accumulatedHooks, dryRun, preserveConfig, writeObserver);
			processedSections.push("hooks");
		}

		// --- mcps ---
		if (yaml.mcps !== null && yaml.mcps !== undefined) {
			for (const [name, serverJson] of Object.entries(yaml.mcps)) {
				await this.syncMcpsMerge(
					targetPath,
					name,
					serverJson,
					dryRun,
					scope === "project" ? "local" : undefined,
				);
			}
			processedSections.push("mcps");
		}

		// --- plugins ---
		if (yaml.plugins?.items !== null && yaml.plugins?.items !== undefined) {
			const pluginScope = scope ?? "user";
			for (const item of yaml.plugins.items) {
				if (typeof item === "string" && item) {
					await this._installPluginSafe(item, targetPath, dryRun, pluginScope);
				} else if (typeof item === "object" && item !== null) {
					const obj = item;
					if (!obj.name) {
						logWarn("플러그인 항목에 name 필드 없음 (스킵)");
						continue;
					}
					if (obj.state === "absent") {
						await this._uninstallPluginSafe(obj.name, targetPath, dryRun, pluginScope);
						continue;
					}
					await this._installPluginObjectSafe(
						obj.name,
						obj.check,
						obj["pre-commands"],
						targetPath,
						dryRun,
						pluginScope,
					);
				}
			}
			processedSections.push("plugins");
		}

		// --- statusLine ---
		if (yaml.statusLine !== null && yaml.statusLine !== undefined) {
			await this.setStatusline(targetPath, yaml.statusLine, dryRun, writeObserver);
			processedSections.push("statusLine");
		}

		return { processedSections, modelMap: undefined };
	}

	// ---------------------------------------------------------------------------
	// buildHookEntry
	// ---------------------------------------------------------------------------

	/**
	 * Build a hook entry object for settings.local.json `hooks` section.
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

	/** True if any command in a hook block contains one of the preserve markers. */
	private hookCommandMatches(block: unknown, markers: string[]): boolean {
		if (!isRecord(block)) return false;
		const hooks = block["hooks"];
		if (!Array.isArray(hooks)) return false;
		return hooks.some((h) => {
			const cmd = isRecord(h) ? h["command"] : undefined;
			return typeof cmd === "string" && markers.some((m) => cmd.includes(m));
		});
	}

	/**
	 * Replace the `hooks` key in settings with the synced entries. Foreign hook
	 * entries whose command matches a `preserve.command-contains` marker are
	 * carried over so this full replace does not silently drop them (e.g. hooks
	 * injected by another tool into the same settings file).
	 */
	async updateSettings(
		targetPath: string,
		hooksEntries: Record<string, unknown>,
		dryRun = false,
		preserve?: { "command-contains"?: string[] },
		writeObserver?: PlatformWriteObserver,
	): Promise<void> {
		const settingsFilename = isGlobalSync(targetPath) ? "settings.json" : "settings.local.json";
		const settingsFile = path.join(targetPath, ".claude", settingsFilename);

		if (dryRun) {
			logDry(`Update ${settingsFilename}: ${settingsFile}`);
			return;
		}

		await fs.mkdir(path.join(targetPath, ".claude"), { recursive: true });
		const current = await readJsonFile(settingsFile);

		// Start from the synced (OMT-authored) entries, then carry over foreign
		// entries matching a preserve marker so the replace below keeps them.
		const mergedHooks: Record<string, unknown[]> = {};
		for (const [event, blocks] of Object.entries(hooksEntries)) {
			// hooksEntries is typed Record<string, unknown> (looser than the
			// Record<string, unknown[]> every real caller passes), so the
			// non-array branch has no runtime-derivable array type; preserved
			// verbatim to match the caller's loose contract.
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- non-array branch value has no statically-derivable array type; preserved as-is per hooksEntries' declared `unknown` value type
			mergedHooks[event] = Array.isArray(blocks) ? [...blocks] : (blocks as unknown[]);
		}
		const markers = preserve?.["command-contains"] ?? [];
		const currentHooks = current["hooks"];
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
		await writeJsonFile(settingsFile, updated);
		await writeObserver?.(settingsFile);
		logInfo(`Updated ${settingsFilename}: ${settingsFile}`);
	}

	// ---------------------------------------------------------------------------
	// setStatusline
	// ---------------------------------------------------------------------------

	/** Set the statusLine field in .claude/settings.json (global) or .claude/settings.local.json (project). */
	async setStatusline(
		targetPath: string,
		statusLine: string,
		dryRun = false,
		writeObserver?: PlatformWriteObserver,
	): Promise<void> {
		const settingsFilename = isGlobalSync(targetPath) ? "settings.json" : "settings.local.json";
		const settingsFile = path.join(targetPath, ".claude", settingsFilename);

		if (dryRun) {
			logDry(`Set statusLine in ${settingsFilename}: ${statusLine} -> ${settingsFile}`);
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
		await writeObserver?.(settingsFile);
		logInfo(`statusLine 설정 완료: ${settingsFile}`);
	}

	// ---------------------------------------------------------------------------
	// syncConfig
	// ---------------------------------------------------------------------------

	/** Deep merge config into .claude/settings.json (global) or .claude/settings.local.json (project). */
	async syncConfig(
		targetPath: string,
		configJson: Record<string, unknown>,
		dryRun = false,
		writeObserver?: PlatformWriteObserver,
	): Promise<void> {
		const settingsFilename = isGlobalSync(targetPath) ? "settings.json" : "settings.local.json";
		const settingsFile = path.join(targetPath, ".claude", settingsFilename);

		if (dryRun) {
			logDry(
				`Config merge into ${settingsFilename}: ${JSON.stringify(configJson)} -> ${settingsFile}`,
			);
			return;
		}

		await fs.mkdir(path.join(targetPath, ".claude"), { recursive: true });
		const current = await readJsonFile(settingsFile);
		const merged = deepMerge(current, configJson);
		await writeJsonFile(settingsFile, merged);
		await writeObserver?.(settingsFile);
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
		serverJson: Record<string, unknown> | null,
		dryRun = false,
		scope?: "local",
	): Promise<void> {
		const claudeUserConfig =
			process.env["CLAUDE_USER_CONFIG"] ?? path.join(process.env["HOME"] ?? "~", ".claude.json");

		if (scope === "local") {
			const projectKey = deriveClaudeProjectKey(targetPath);
			if (dryRun) {
				logDry(`local MCP key: ${projectKey}`);
				logDry(
					`MCP ${serverJson === null ? "removed" : "merge"}: ${serverName} -> ~/.claude.json (local: ${targetPath})`,
				);
				return;
			}
			const current = await readJsonFile(claudeUserConfig);
			const projects = isRecord(current["projects"]) ? current["projects"] : {};
			const projectEntry = isRecord(projects[projectKey]) ? projects[projectKey] : {};
			const mcpServers = isRecord(projectEntry["mcpServers"]) ? projectEntry["mcpServers"] : {};
			if (serverJson === null) {
				if (!Object.prototype.hasOwnProperty.call(mcpServers, serverName)) {
					logInfo(`MCP removed: ${serverName} -> ~/.claude.json (local: ${targetPath})`);
					return;
				}
				delete mcpServers[serverName];
			} else {
				mcpServers[serverName] = serverJson;
			}
			projects[projectKey] = { ...projectEntry, mcpServers };
			await writeJsonFile(claudeUserConfig, { ...current, projects });
			logInfo(`MCP ${serverJson === null ? "removed" : "merged"}: ${serverName} -> ~/.claude.json (local: ${targetPath})`);
		} else {
			if (dryRun) {
				logDry(`MCP ${serverJson === null ? "removed" : "merge"}: ${serverName} -> ~/.claude.json (user scope)`);
				return;
			}
			const current = await readJsonFile(claudeUserConfig);
			const mcpServers = isRecord(current["mcpServers"]) ? current["mcpServers"] : {};
			if (serverJson === null) {
				if (!Object.prototype.hasOwnProperty.call(mcpServers, serverName)) {
					logInfo(`MCP removed: ${serverName} -> ~/.claude.json (user scope)`);
					return;
				}
				delete mcpServers[serverName];
			} else {
				mcpServers[serverName] = serverJson;
			}
			await writeJsonFile(claudeUserConfig, { ...current, mcpServers });
			logInfo(`MCP ${serverJson === null ? "removed" : "merged"}: ${serverName} -> ~/.claude.json (user scope)`);
		}
	}

	// ---------------------------------------------------------------------------
	// Private frontmatter helpers
	// ---------------------------------------------------------------------------

	private async _addSkillsToFrontmatter(agentFile: string, skillsToAdd: string[]): Promise<void> {
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
		const existingHooks = isRecord(frontmatter["hooks"]) ? frontmatter["hooks"] : {};

		for (const h of hooks) {
			const eventHooksRaw = existingHooks[h.event];
			const eventHooks: Array<Record<string, unknown>> = Array.isArray(eventHooksRaw)
				? eventHooksRaw.filter(isRecord)
				: [];
			const hookDef: Record<string, unknown> =
				h.type === "prompt"
					? { type: "prompt", prompt: h.prompt ?? "", timeout: h.timeout }
					: { type: "command", command: h.command ?? "", timeout: h.timeout };

			// Find existing matcher group or create new one
			const matcherGroup = eventHooks.find((g) => g["matcher"] === h.matcher);

			if (matcherGroup) {
				const innerRaw = matcherGroup["hooks"];
				const inner = Array.isArray(innerRaw) ? innerRaw : [];
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

	private async _uninstallPluginSafe(
		name: string,
		targetPath: string,
		dryRun: boolean,
		scope: PluginScope,
	): Promise<void> {
		const command = `claude plugin uninstall --scope ${scope} ${name}`;
		if (dryRun) {
			logDry(command);
			return;
		}

		try {
			const result = await this._runCommand(command, targetPath);
			if (result.exitCode !== 0) {
				logWarn(`플러그인 제거 실패 (계속 진행): ${name}`);
				return;
			}
			logInfo(`플러그인 제거 완료: ${name} (scope: ${scope})`);
		} catch {
			logWarn(`플러그인 제거 실패 (계속 진행): ${name}`);
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
			} catch {
				/* check failed, proceed with install */
			}
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
