/**
 * OpenAI Codex CLI Adapter
 * Implements PlatformAdapter for the Codex platform.
 *
 * Key behaviors:
 * - agents: md -> toml translator (name/description/developer_instructions + model-map)
 * - commands: not supported (global ~/.codex/prompts/ only), skip with warning
 * - hooks: supported; command is a literal relative `bun run .codex/hooks/<name>/index.ts`
 * - skills, scripts: syncDirectory
 * - rules: supported, copied verbatim to `.codex/rules/<name>.md` (syncRulesDirect)
 * - config: TOML managed block in .codex/config.toml
 * - mcps: accumulate all servers, flush as single managed block
 */

import fs from "fs/promises";
import path from "path";
import { stringify, parse } from "smol-toml";
import { logInfo, logWarn, logDry } from "../lib/logger.ts";
import { readTextFile, readJsonFile, writeJsonFile } from "../lib/json.ts";
import { isPlainObject } from "../lib/deep-merge.ts";
import { syncDirectory, copyFile } from "../lib/sync-directory.ts";
import { backupCategory } from "../lib/backup.ts";
import { syncShellDependencies, syncShellDepsForDir } from "./hook-deps.ts";
import { assertMappedTier } from "../lib/model-map.ts";
import { parseFrontmatter } from "../lib/frontmatter.ts";
import { PLATFORM_REWRITE_RULES, applyRewriteRules } from "../lib/rewrite-rules.ts";
import { composePreToolTraceCommand } from "../lib/pretool-trace-command.ts";
import { isGlobalSync } from "../lib/path-utils.ts";
import type {
	ModelMap,
	PlatformConfigResult,
	PlatformYaml,
	PlatformYamlHookItem,
	PluginScope,
} from "../lib/types.ts";
import type { PlatformAdapter, PlatformWriteObserver } from "./types.ts";
import type { DeployMutationHooks } from "../lib/deploy-transaction.ts";
import { planCategoryDestinationPaths, type DestinationCategory } from "./destinations.ts";

/** Resolve a Codex component destination by combining the shared plan with its deploy root. */
function codexDestinationPath(
	targetPath: string,
	category: DestinationCategory,
	displayName: string,
): string {
	const [relativePath] = planCategoryDestinationPaths("codex", category, displayName);
	if (!relativePath) {
		throw new Error(`Codex has no destination for category '${category}'`);
	}
	return path.join(targetPath, relativePath);
}

// =============================================================================
// Model Map Applier
// =============================================================================

export type CodexResolvedModel = { model: string; model_reasoning_effort?: string };

/**
 * Resolve an agent's tier to its Codex model + reasoning effort.
 * A per-agent override in `modelMap.agents` beats the `modelMap.tiers` default.
 * The tier must be present in `modelMap.tiers` — see `assertMappedTier`.
 */
export function resolveCodexAgentModel(
	modelMap: ModelMap,
	tier: string,
	agentFile: string,
	agentName?: string,
): CodexResolvedModel {
	assertMappedTier(modelMap, tier, { platform: "codex", agentFile, agentName });
	const entry = (agentName ? modelMap.agents?.[agentName] : undefined) ?? modelMap.tiers[tier];
	return entry.effort === undefined
		? { model: entry.model }
		: { model: entry.model, model_reasoning_effort: entry.effort };
}

// =============================================================================
// TOML Managed Block Helpers
// =============================================================================

/** Escapes a literal string for embedding in a RegExp source. */
function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns true when every leaf key/value `expected` declares is reachable
 * at the same path in `actual`. Plain objects recurse (actual may carry
 * extra sibling keys — e.g. a user-owned `[features]` table alongside the
 * managed one); everything else (string, number, boolean, array) is
 * compared by value, with arrays requiring an exact match rather than a
 * partial overlap.
 */
function isDeepSubset(expected: unknown, actual: unknown): boolean {
	if (isPlainObject(expected)) {
		return (
			isPlainObject(actual) &&
			Object.entries(expected).every(([key, val]) => isDeepSubset(val, actual[key]))
		);
	}
	if (Array.isArray(expected)) {
		return Array.isArray(actual) && JSON.stringify(expected) === JSON.stringify(actual);
	}
	return expected === actual;
}

/**
 * Finds every line-anchored occurrence of `marker`: the marker must start
 * the line and may be followed only by trailing horizontal whitespace
 * before the line ends. Anchoring to whole lines (rather than a raw
 * substring match) keeps a marker literal sitting inside a TOML string
 * value or a plain comment from being mistaken for a structural marker.
 * Trailing-whitespace tolerance exists because Codex re-serializing
 * config.toml can append trailing spaces to the marker line — treating
 * that as "marker absent" would fall through to append and duplicate the
 * block.
 */
function matchMarkerLines(content: string, marker: string): RegExpMatchArray[] {
	const pattern = new RegExp(`^${escapeRegExp(marker)}[ \t]*$`, "gm");
	return [...content.matchAll(pattern)];
}

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

	// Count, not just detect, each marker's occurrences: a corrupted pairing
	// (e.g. two start markers and one end marker, observed after a stale sync
	// appended a fresh block onto a file whose end marker had already been
	// clobbered) still satisfies a naive "both present, end after start"
	// existence check, and the replace path below would then splice out
	// everything between the FIRST start marker and the ONLY end marker —
	// silently deleting any user-owned content sitting between the duplicates.
	// Count and position come from the same line-anchored match (matchMarkerLines)
	// so they can never disagree about which occurrence is "the" marker.
	const startMatches = matchMarkerLines(content, startMarker);
	const endMatches = matchMarkerLines(content, endMarker);
	const startCount = startMatches.length;
	const endCount = endMatches.length;

	const startIdx = startMatches[0]?.index ?? -1;
	const endIdx = endMatches[0]?.index ?? -1;

	let result: string;

	if (startCount === 1 && endCount === 1 && endIdx > startIdx) {
		// Pre-replace backstop: confirm the matched marker pair actually wraps a
		// real managed block before splicing it out. The line-anchored marker
		// match only knows a marker sits at the start of its own line — it
		// cannot tell that line is real structure rather than the BODY of a
		// pre-existing multiline TOML string (e.g. `doc = """ ... """`) whose
		// text happens to contain lines matching both marker literals. Mirrors
		// the new-body landing-site backstop below, but on the existing side.
		const existingBody = content.slice(startIdx + startMatches[0][0].length, endIdx);
		let existingDeclared: Record<string, unknown>;
		try {
			existingDeclared = parse(existingBody);
		} catch (err) {
			const causeMessage = err instanceof Error ? err.message : String(err);
			throw new Error(
				`insertManagedBlock: existing content between the 'omt:${blockName}' markers does not parse as TOML ` +
					`(not written) — ${causeMessage}. This happens when the matched markers are not a real managed ` +
					`block, such as a multiline TOML string in the target file whose body happens to contain lines ` +
					`matching the marker literals. Nothing was written.`,
				{ cause: err },
			);
		}
		// The original content may be malformed for unrelated reasons; if so the
		// existing parse(result) backstop further down already catches it, so this
		// reachability check is skipped rather than raising a second, redundant error.
		let parsedOriginalContent: Record<string, unknown> | undefined;
		try {
			parsedOriginalContent = parse(content);
		} catch {
			parsedOriginalContent = undefined;
		}
		if (parsedOriginalContent && !isDeepSubset(existingDeclared, parsedOriginalContent)) {
			throw new Error(
				`insertManagedBlock: existing content between the 'omt:${blockName}' markers does not read back ` +
					`at the top level of the target file (not written) — the matched markers are not wrapping a ` +
					`real managed block. This happens when the target file has a structure such as a multiline ` +
					`TOML string whose body contains lines matching the marker literals, trapping what looks like ` +
					`a block body inside that string instead of as real top-level structure. Nothing was written.`,
			);
		}
		// lazy: when the trapped body AND the new tomlContent are both comment-only,
		// both this check and the landing-site backstop below pass vacuously (an
		// empty declared structure is a subset of anything) — loss is negligible
		// since comment-only text replaces comment-only text either way. Upgrade
		// path: a TOML string-boundary scanner that excludes marker lines living
		// inside string literals.

		// Replace existing block (inclusive of markers)
		const before = content.slice(0, startIdx);
		const after = content.slice(endIdx + endMatches[0][0].length);
		// Trim trailing newlines from before, trim leading newlines from after
		const beforeTrimmed = before.replace(/\n+$/, "");
		const afterTrimmed = after.replace(/^\n+/, "");
		if (beforeTrimmed && afterTrimmed) {
			result = `${beforeTrimmed}\n\n${block}\n\n${afterTrimmed}`;
		} else if (beforeTrimmed) {
			result = `${beforeTrimmed}\n\n${block}\n`;
		} else if (afterTrimmed) {
			result = `${block}\n\n${afterTrimmed}`;
		} else {
			result = `${block}\n`;
		}
	} else if (startCount === 0 && endCount === 0) {
		// Append at end
		const trimmed = content.replace(/\n+$/, "");
		result = trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
	} else {
		// Orphaned or duplicated marker: anything other than exactly one start +
		// one end (in start-before-end order) leaves the stale block's true
		// extent unknown — guessing where it ends risks deleting config the
		// user owns. This happens when something else rewrites the file and
		// breaks the marker pairing (observed: Codex CLI rewriting
		// .codex/config.toml to persist its own runtime state clobbered one
		// side of an `omt:mcp` marker pair — and, separately, a stale sync
		// re-appending a full block onto that already-clobbered file produced a
		// duplicated start marker). Silently falling through to append or
		// replace would either duplicate-declare keys (crashing the Codex CLI on
		// a `duplicate key` parse error) or delete content between duplicate
		// markers. Fail loud instead.
		let reason: string;
		if (startCount >= 1 && endCount === 0) {
			reason = `start marker '${startMarker}' is present but end marker '${endMarker}' is missing`;
		} else if (startCount === 0 && endCount >= 1) {
			reason = `end marker '${endMarker}' is present but start marker '${startMarker}' is missing`;
		} else if (startCount === 1 && endCount === 1) {
			reason = `end marker '${endMarker}' appears before start marker '${startMarker}'`;
		} else {
			reason = `found ${startCount} occurrence(s) of start marker '${startMarker}' and ${endCount} occurrence(s) of end marker '${endMarker}' — expected exactly one of each`;
		}
		throw new Error(
			`insertManagedBlock: orphaned marker for managed block 'omt:${blockName}' — ${reason}. ` +
				`Remove the extra/orphaned marker(s) and any stale block body by hand, then re-run sync.`,
		);
	}

	// Backstop: parse the result before returning it. Callers write the
	// return value straight to disk (syncConfig, flushMcpBlock) — a managed
	// block that duplicates a key already in the surrounding content (e.g. a
	// stale block appended alongside a fresh one) must never reach the file.
	let parsedResult: Record<string, unknown>;
	try {
		parsedResult = parse(result);
	} catch (err) {
		const causeMessage = err instanceof Error ? err.message : String(err);
		throw new Error(
			`insertManagedBlock: writing managed block 'omt:${blockName}' would produce invalid TOML (not written) — ${causeMessage}`,
			{ cause: err },
		);
	}

	// Landing-site backstop: valid TOML syntax alone isn't enough — the
	// line-anchored marker match above only knows a marker sits at the
	// start of its own line, not whether that line is real structure or
	// the body of a pre-existing multiline TOML string (e.g. a user-authored
	// `doc = """ ... """` whose text happens to contain a line matching the
	// marker literal). In that case the replace still produces syntactically
	// valid TOML — the block just ends up trapped inside the string instead
	// of declared at the top level. Confirm every leaf key/value
	// `tomlContent` declares is actually readable back from the parsed
	// result at its intended path before this is allowed to reach disk.
	const declaredStructure: Record<string, unknown> = parse(tomlContent);
	if (!isDeepSubset(declaredStructure, parsedResult)) {
		throw new Error(
			`insertManagedBlock: managed block 'omt:${blockName}' did not land at its intended location (not written) — ` +
				`the configuration this block declares does not read back from the result at its intended path. ` +
				`This happens when the target file has a structure such as a multiline TOML string whose body ` +
				`contains a line matching the marker literal, trapping the managed block inside that string instead ` +
				`of as real top-level structure. Nothing was written.`,
		);
	}

	return result;
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

function pickString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export type CodexPreToolUsePreview = {
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

export class CodexPreToolUsePreviewError extends Error {
	readonly itemIndex: number;

	constructor(itemIndex: number, message: string) {
		super(`Codex PreToolUse trace preview failed for item ${itemIndex}: ${message}`);
		this.name = "CodexPreToolUsePreviewError";
		this.itemIndex = itemIndex;
	}
}

// =============================================================================
// Skills directory resolution
// =============================================================================

/**
 * Codex 0.144.1 deprecates `~/.codex/skills` / `<repo>/.codex/skills` in favor
 * of the cross-CLI `.agents/skills` root (both home `~/.agents/skills` and
 * project `<repo>/.agents/skills`). Skills are the ONLY Codex category that
 * writes outside `configDir` (`.codex/`) — agents, config.toml, hooks, and
 * scripts all still live under `.codex/`.
 *
 * Exported so `rewritePlatformPaths` (tools/sync.ts) resolves this same path
 * rather than re-declaring the `.agents/skills` string — one owner for it.
 */
export function codexSkillsDir(targetPath: string): string {
	return path.dirname(codexDestinationPath(targetPath, "skills", "__skill__"));
}

function plannedCodexSkillsFossilEntries(
	fossilDir: string,
	fossilEntries: readonly string[],
	ownedSkillNames: ReadonlySet<string>,
): string[] {
	return fossilEntries
		.filter((name) => ownedSkillNames.has(name))
		.sort((left, right) => left.localeCompare(right))
		.map((name) => path.join(fossilDir, name));
}

function isErrno(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && Reflect.get(error, "code") === code;
}

/**
 * Returns the exact fossil entry paths that this run is allowed to remove.
 * The planner is read-only; ownership remains name-provenance based and the
 * executor repeats the counterpart checks before mutating any entry.
 */
export async function planCodexSkillsFossilCleanup(
	deployRoot: string,
	ownedSkillNames: ReadonlySet<string>,
): Promise<string[]> {
	const fossilDir = path.join(deployRoot, ".codex", "skills");
	const fossilStat = await fs.stat(fossilDir).catch((error: unknown) => {
		if (isErrno(error, "ENOENT")) return undefined;
		throw error;
	});
	if (!fossilStat?.isDirectory()) return [];
	const fossilEntries = await fs.readdir(fossilDir);
	return plannedCodexSkillsFossilEntries(fossilDir, fossilEntries, ownedSkillNames);
}

/**
 * Removes the pre-b9908fbc `.codex/skills` fossil now that Codex skills deploy
 * to `.agents/skills` (codexSkillsDir). Codex 0.144.1 reads BOTH roots, so a
 * populated fossil makes every skill appear twice in the session prompt.
 *
 * Safety contract:
 * - Ownership is decided by name-provenance, not on-disk state: an entry is
 *   OMT-owned iff its name is in `ownedSkillNames` — the set of skills OMT
 *   actually deployed to `.agents/skills` THIS run (the caller passes
 *   `deployedNames.get("agents")`). Anything else is a foreign resident
 *   (e.g. `.system`, or a same-named directory nobody here deployed) and is
 *   NEVER deleted, and never blocks cleanup.
 * - Byte identity between the fossil entry and its `.agents/skills`
 *   counterpart is deliberately NOT asserted: the fossil holds
 *   `rewrite_old(source)` — a prior OMT version's `rewritePlatformPaths`
 *   rewrote `.claude/` references to `.codex/` before ever writing the
 *   fossil — while the counterpart holds the raw, un-rewritten source, so
 *   the bytes structurally can never match on a real deploy.
 * - Deletion still requires a live counterpart: before removing an owned
 *   entry, its `.agents/skills/<name>` directory must exist. A name that is
 *   owned this run but has no on-disk counterpart is a deployed-but-missing
 *   anomaly, not an expected byte-drift case — this throws, naming the
 *   entry, and (checked for every owned entry before any deletion) leaves
 *   the whole fossil untouched and writes no backup.
 * - The fossil is backed up (via `backupCategory`, using the plain-string
 *   platform `"codex"`) BEFORE removal, giving a rollback surface.
 * - `fossilDir` itself is removed only once it is fully empty; a surviving
 *   foreign resident keeps it in place.
 * - Idempotent: once the fossil is gone, a repeat call returns silently.
 */
export async function cleanupCodexSkillsFossil(
	deployRoot: string,
	backupDest: string,
	dryRun: boolean,
	ownedSkillNames: ReadonlySet<string>,
	mutationHooks?: DeployMutationHooks,
): Promise<void> {
	const fossilDir = path.join(deployRoot, ".codex", "skills");
	const newDir = codexSkillsDir(deployRoot);

	const fossilStat = await fs.stat(fossilDir).catch((error: unknown) => {
		if (isErrno(error, "ENOENT")) return undefined;
		throw error;
	});
	if (!fossilStat?.isDirectory()) {
		return; // nothing to do — idempotent
	}

	const newStat = await fs.stat(newDir).catch((error: unknown) => {
		if (isErrno(error, "ENOENT")) return undefined;
		throw error;
	});
	if (!newStat?.isDirectory()) {
		if (dryRun) {
			logDry(
				`Codex skills fossil cleanup deferred: '${newDir}' does not exist yet (a real sync creates it first)`,
			);
			return;
		}
		throw new Error(
			`cleanupCodexSkillsFossil: '${fossilDir}' exists but its replacement '${newDir}' does not — refusing to delete the fossil`,
		);
	}

	const fossilEntries = await fs.readdir(fossilDir);

	const omtOwned: string[] = [];
	for (const name of fossilEntries) {
		if (ownedSkillNames.has(name)) {
			omtOwned.push(name);
		} else {
			logInfo(`Codex skills fossil: foreign resident kept: ${name}`);
		}
	}

	if (dryRun) {
		for (const name of omtOwned) {
			logDry(`Remove Codex skills fossil entry: ${path.join(fossilDir, name)}`);
		}
		return;
	}

	// Every OMT-owned entry must have a live counterpart under .agents/skills
	// BEFORE anything is deleted (deployed-but-missing anomaly guard). This is
	// a real-run-only guard: in dry-run nothing has been written yet, so a
	// missing counterpart is expected, not an anomaly.
	for (const name of omtOwned) {
		const counterpartStat = await fs.stat(path.join(newDir, name)).catch((error: unknown) => {
			if (isErrno(error, "ENOENT")) return undefined;
			throw error;
		});
		if (!counterpartStat) {
			throw new Error(
				`cleanupCodexSkillsFossil: entry '${name}' is owned this run but has no counterpart at '${path.join(newDir, name)}' — refusing to delete`,
			);
		}
	}

	if (omtOwned.length === 0) {
		return; // nothing OMT-owned to remove (fossil holds only foreign residents)
	}

	await backupCategory(deployRoot, "codex", "skills", backupDest);

	const plannedEntries = plannedCodexSkillsFossilEntries(fossilDir, fossilEntries, ownedSkillNames);
	for (const entryPath of plannedEntries) {
		const operation = async (): Promise<void> => {
			await fs.rm(entryPath, { recursive: true, force: true });
		};
		if (mutationHooks) await mutationHooks.mutate(entryPath, operation);
		else await operation();
	}

	const remaining = await fs.readdir(fossilDir);
	if (remaining.length === 0) {
		// The root is deliberately outside the per-entry journal: it overlaps
		// every inventoried entry. Remove it only when empty, and propagate all
		// errors except the expected absent/already-nonempty races.
		await fs.rmdir(fossilDir).catch((error: unknown) => {
			if (!isErrno(error, "ENOENT") && !isErrno(error, "ENOTEMPTY")) throw error;
		});
		logInfo(`Codex skills fossil removed: ${fossilDir}`);
	}
}

// =============================================================================
// Leaf-subagent gate (Claude `disallowedTools: Agent` → Codex prompt guard)
// =============================================================================

// Claude Code enforces leaf-ness at runtime by withholding the `Agent`
// (subagent-spawning) tool; Codex has no equivalent per-agent tool field, so the
// canonical leaf gate for a native Codex subagent is a developer-instruction
// text guard (mirrors oh-my-codex `NATIVE_SUBAGENT_LEAF_GUARD`). We inject it
// whenever the source frontmatter denies the spawn tool — the SAME signal Claude
// Code resolves — so a single source edit gates both platforms.
//
// When the source frontmatter carries a positive `tools:` allowlist (e.g.
// `tools: Bash, Read`), the guard names those tools explicitly instead of
// staying silent about them — but this is PROMPT TEXT ONLY. Unlike Claude
// Code, which withholds the tool at the runtime layer (the model literally
// cannot invoke it), Codex TOML has no per-agent tool-restriction field to
// bind to, so nothing enforces this beyond the model choosing to comply. The
// clause below says so explicitly, so this can never be misread as a
// guaranteed restriction.
function buildCodexLeafGuard(tools: string[]): string {
	const lines = [
		"<native_subagent_leaf_guard>",
		"",
		"Leaf native subagent: do not call Task, Agent, spawn_agent, or native child agents.",
		"Use local tools; report missing specialist coverage to your caller instead of spawning.",
	];
	if (tools.length > 0) {
		lines.push(
			"",
			`Tool restriction (soft guard, not enforced by Codex): the source frontmatter limits this agent to ${tools.join(", ")}. Codex has no per-agent tool-withholding field, so nothing stops you from calling another tool if you choose to — treat this as an instruction to follow, not a runtime capability limit.`,
		);
	}
	lines.push("", "</native_subagent_leaf_guard>");
	return lines.join("\n");
}

// The tool names that let an agent spawn other agents. `Task` is the pre-2.1.63
// alias of `Agent`; both must be recognized on either side of the gate.
const SPAWN_TOOL_NAMES = new Set(["Agent", "Task"]);

/** Normalize a frontmatter tools value (YAML array OR comma-separated string) to trimmed tokens. */
function toToolList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
	if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
	return [];
}

/**
 * A source agent is a leaf (cannot spawn subagents) exactly when Claude Code
 * would withhold the spawn tool: `disallowedTools` lists it, OR a non-empty
 * `tools` allowlist omits it. Frontmatter with neither restriction inherits all
 * tools (delegation-allowed, e.g. code-reviewer) and gets no guard.
 */
function isLeafAgent(frontmatter: Record<string, unknown>): boolean {
	const disallowed = toToolList(frontmatter.disallowedTools);
	if (disallowed.some((t) => SPAWN_TOOL_NAMES.has(t))) return true;
	const tools = toToolList(frontmatter.tools);
	if (tools.length > 0 && !tools.some((t) => SPAWN_TOOL_NAMES.has(t))) return true;
	return false;
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
	// syncAgentsDirect — md -> toml translator
	// ---------------------------------------------------------------------------

	/**
	 * Translates an agent `.md` (Claude-vocabulary frontmatter + body) into a
	 * Codex agent TOML. Emits ONLY the allowlisted keys `name` / `description` /
	 * `developer_instructions` [+ `model` / `model_reasoning_effort`] — Claude-only
	 * frontmatter keys (`add-skills`, `subagent_type`, `tools`, `skills`, ...) are
	 * never spread into the output. Codex does NOT reject unknown TOML keys — its
	 * `deny_unknown_fields` is silently disabled by the flattened `ConfigToml`
	 * (serde limitation, verified at 0.144.1) — so it will not catch a leak for us:
	 * this emit-allowlist is the only guarantee, and must never become a denylist.
	 */
	async syncAgentsDirect(
		targetPath: string,
		displayName: string,
		sourcePath: string,
		_addSkills?: string[],
		_addHooks?: unknown[],
		dryRun = false,
		modelMap?: ModelMap,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetFile = codexDestinationPath(targetPath, "agents", displayName);

		const stat = await fs.stat(sourcePath).catch(() => undefined);
		if (!stat?.isFile()) {
			logWarn(`Codex agent 원본 없음: ${sourcePath}`);
			return;
		}

		if (dryRun) {
			logDry(`Translate agent: ${sourcePath} -> ${targetFile}`);
			return;
		}

		const { frontmatter, body } = parseFrontmatter(await fs.readFile(sourcePath, "utf-8"));

		const name =
			typeof frontmatter.name === "string" && frontmatter.name.trim()
				? frontmatter.name.trim()
				: displayName;
		const description =
			typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
		const developer_instructions = body.trim();

		if (!description || !developer_instructions) {
			throw new Error(
				`codex agent '${sourcePath}': description/developer_instructions must be non-blank`,
			);
		}

		const tier = typeof frontmatter.model === "string" ? frontmatter.model : undefined;
		let modelFields: Partial<CodexResolvedModel> = {};
		if (tier) {
			if (!modelMap) {
				throw new Error(
					`codex agent '${sourcePath}': model tier '${tier}' but no model-map reachable`,
				);
			}
			modelFields = resolveCodexAgentModel(modelMap, tier, sourcePath, name);
		}

		// Agent bodies are instruction text the model reads (they carry `Skill(`,
		// `subagent_type`, etc. — e.g. agents/sisyphus-junior.md), and the emitted
		// TOML lives inside the codex deploy root the plan's absence checks scope
		// to. Apply the same rule table rewritePlatformPaths applies to deployed
		// .md here, at generation time, since these TOML files are generated (not
		// walked as .md). name/model/model_reasoning_effort are never rewritten —
		// the emit-allowlist stays exactly as it is. No ${CLAUDE_SKILL_DIR} bake:
		// it does not occur in agents/*.md, and an agent has no owning skill dir.
		const rewrittenDescription = applyRewriteRules(description, PLATFORM_REWRITE_RULES.codex);
		const rewrittenInstructions = applyRewriteRules(
			developer_instructions,
			PLATFORM_REWRITE_RULES.codex,
		);
		// Leaf gate: the guard is static English (no Claude vocabulary), so it is
		// appended AFTER rewrite to keep it verbatim. Delegation-allowed agents
		// (e.g. code-reviewer) carry no spawn restriction and get no guard.
		const gatedInstructions = isLeafAgent(frontmatter)
			? `${rewrittenInstructions}\n\n${buildCodexLeafGuard(toToolList(frontmatter.tools))}`
			: rewrittenInstructions;

		const tomlObj = {
			name,
			description: rewrittenDescription,
			developer_instructions: gatedInstructions,
			...modelFields,
		};

		const operation = async (): Promise<void> => {
			await fs.mkdir(path.dirname(targetFile), { recursive: true });
			await fs.writeFile(targetFile, stringify(tomlObj), "utf-8");
		};
		if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
		else await operation();
		logInfo(`Codex agent 생성: ${displayName}.toml`);
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
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		// event filtering is handled by the caller (sync.sh / orchestrator)
		// This method is called only for supported events — just copy the file
		const targetHookRoot = codexDestinationPath(targetPath, "hooks", displayName);
		const targetDir = path.dirname(targetHookRoot);
		const hooksSourceDir = path.dirname(sourcePath);

		let stat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			stat = await fs.stat(sourcePath);
		} catch {
			logWarn(`Hook not found: ${sourcePath}`);
			return;
		}

		if (stat.isDirectory()) {
			if (dryRun) {
				logDry(`Copy (directory): ${sourcePath} -> ${targetHookRoot}/`);
				await syncShellDepsForDir(sourcePath, hooksSourceDir, targetHookRoot, dryRun);
				return;
			}
			await syncDirectory(sourcePath, targetHookRoot, {
				exclude: ["*.test.ts", "config.local.yaml"],
				platformRoot: path.join(targetPath, this.configDir),
				mutationHooks,
			});
			logInfo(`Copied: ${displayName}/`);
			if (writeObserver && !mutationHooks) await writeObserver(targetHookRoot);
			await syncShellDepsForDir(sourcePath, hooksSourceDir, targetHookRoot, dryRun, writeObserver, mutationHooks);
		} else {
			const targetFile = targetHookRoot;
			if (dryRun) {
				logDry(`Copy: ${sourcePath} -> ${targetFile}`);
				await syncShellDependencies(sourcePath, hooksSourceDir, targetDir, dryRun);
				return;
			}
			const operation = async (): Promise<void> => {
				await copyFile(sourcePath, targetFile);
				// Ensure executable
				const fileStat = await fs.stat(targetFile);
				await fs.chmod(targetFile, fileStat.mode | 0o111);
			};
			if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
			else await operation();
			logInfo(`Copied: ${displayName}`);
			if (writeObserver) await writeObserver(targetFile);
			await syncShellDependencies(sourcePath, hooksSourceDir, targetDir, dryRun, writeObserver, mutationHooks);
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
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetSkillDir = codexDestinationPath(targetPath, "skills", displayName);

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

		await syncDirectory(sourcePath, targetSkillDir, { mutationHooks });
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
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetScriptRoot = codexDestinationPath(targetPath, "scripts", displayName);

		let stat: Awaited<ReturnType<typeof fs.stat>>;
		try {
			stat = await fs.stat(sourcePath);
		} catch {
			logWarn(`Script not found: ${sourcePath}`);
			return;
		}

		if (stat.isDirectory()) {
			if (dryRun) {
				logDry(`Copy (directory): ${sourcePath} -> ${targetScriptRoot}/`);
				return;
			}
			await syncDirectory(sourcePath, targetScriptRoot, {
				platformRoot: path.join(targetPath, this.configDir),
				mutationHooks,
			});
			logInfo(`Copied: ${displayName}/`);
		} else {
			const targetFile = targetScriptRoot;
			if (dryRun) {
				logDry(`Copy: ${sourcePath} -> ${targetFile}`);
				return;
			}
			const operation = async (): Promise<void> => copyFile(sourcePath, targetFile);
			if (mutationHooks) await mutationHooks.mutate(targetFile, operation);
			else await operation();
			logInfo(`Copied: ${displayName}`);
		}
	}

	// ---------------------------------------------------------------------------
	// syncRulesDirect — copy to .codex/rules/<name>.md
	// ---------------------------------------------------------------------------

	/**
	 * Mirrors ClaudeAdapter.syncRulesDirect (a plain file copy, never a
	 * directory): the source is always a single rule .md, copied verbatim to
	 * `.codex/rules/<displayName>.md`. Claude-vocabulary de-Claude-ification
	 * happens later, at the same deploy-time pass every other `.codex/` `.md`
	 * file goes through (rewritePlatformPaths walks `.codex/` — excluding only
	 * the skills fossil root — so `.codex/rules/**\/*.md` is covered with no
	 * extra wiring needed here).
	 */
	async syncRulesDirect(
		targetPath: string,
		displayName: string,
		sourcePath: string,
		dryRun = false,
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const targetFile = codexDestinationPath(targetPath, "rules", displayName);
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
		logInfo(`Copied: ${displayName}.md`);
		if (writeObserver) await writeObserver(targetFile);
	}

	// ---------------------------------------------------------------------------
	// syncConfig — write TOML managed block to .codex/config.toml
	// ---------------------------------------------------------------------------

	async syncConfig(
		targetPath: string,
		configJson: Record<string, unknown>,
		dryRun = false,
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const configFile = path.join(targetPath, this.configDir, "config.toml");

		if (dryRun) {
			logDry(`Config managed block: ${JSON.stringify(configJson)} -> ${configFile}`);
			return;
		}

		const operation = async (): Promise<void> => {
			await fs.mkdir(path.join(targetPath, this.configDir), { recursive: true });
			const existing = await readTextFile(configFile);
			const tomlContent = stringify(configJson);
			const updated = insertManagedBlock(existing, "config", tomlContent);
			await fs.writeFile(configFile, updated, "utf-8");
		};
		if (mutationHooks) await mutationHooks.mutate(configFile, operation);
		else await operation();
		if (writeObserver) await writeObserver(configFile);
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
	async flushMcpBlock(
		targetPath: string,
		dryRun: boolean,
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
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
			const operation = async (): Promise<void> => {
				const current = await readTextFile(configFile);
				const updated = insertManagedBlock(current, "mcp", "# No MCP servers configured\n");
				await fs.writeFile(configFile, updated, "utf-8");
			};
			if (mutationHooks) await mutationHooks.mutate(configFile, operation);
			else await operation();
			if (writeObserver) await writeObserver(configFile);
			logInfo(`MCP managed block cleared: ${configFile}`);
			return;
		}

		if (dryRun) {
			logDry(`MCP managed block: ${JSON.stringify(this.mcpAccumulator)} -> ${configFile}`);
			return;
		}

		const operation = async (): Promise<void> => {
			await fs.mkdir(path.join(targetPath, this.configDir), { recursive: true });
			const existing = await readTextFile(configFile);
			const tomlContent = buildMcpTomlContent(this.mcpAccumulator);
			const updated = insertManagedBlock(existing, "mcp", tomlContent);
			await fs.writeFile(configFile, updated, "utf-8");
		};
		if (mutationHooks) await mutationHooks.mutate(configFile, operation);
		else await operation();
		if (writeObserver) await writeObserver(configFile);
		logInfo(`MCP managed block: ${configFile}`);
	}

	// ---------------------------------------------------------------------------
	// syncPlatformYaml — config, mcps, model-map
	// ---------------------------------------------------------------------------

	async previewPreToolUseCommands(
		targetPath: string,
		yaml: PlatformYaml,
	): Promise<CodexPreToolUsePreview[]> {
		const items = yaml.hooks?.PreToolUse;
		if (!Array.isArray(items)) return [];
		const deployRoot = path.resolve(targetPath);
		const wrapperDeploymentPath = path.join(
			deployRoot,
			".codex",
			"scripts",
			"pretool-trace",
			"index.ts",
		);
		const scope = isGlobalSync(deployRoot) ? "global" : "project";
		const previews: CodexPreToolUsePreview[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
			const item = items[itemIndex];
			if (!item || pickString(item["type"]) === "prompt") continue;
			const component = item.component ?? "";
			const rawTraceId = pickString(item["trace-id"]);
			const hookId = component ? path.basename(component) : rawTraceId ?? "";
			if (!hookId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(hookId)) {
				throw new CodexPreToolUsePreviewError(
					itemIndex,
					component
						? `unsafe component basename ${hookId}`
						: "raw command requires a safe explicit trace-id",
				);
			}
			const matcher = item.matcher ?? "*";
			const timeout = item.timeout ?? 10;
			const originalCommand = await this.resolveHookCommand(deployRoot, item, true, itemIndex);
			if (!originalCommand) {
				throw new CodexPreToolUsePreviewError(itemIndex, "command is missing");
			}
			const wrappedCommand = composePreToolTraceCommand({
				wrapperPath: wrapperDeploymentPath,
				platform: "codex",
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

	private async resolveHookCommand(
		targetPath: string,
		item: PlatformYamlHookItem,
		strictMissingIndex = false,
		itemIndex = -1,
	): Promise<string> {
		const component = item.component ?? "";
		const customCommand = pickString(item["command"]) ?? "";
		let command = customCommand;
		if (!command && component) {
			const displayName = path.basename(component);
			const stat = await fs.stat(component).catch(() => undefined);
			if (stat?.isDirectory()) {
				const indexTs = path.join(component, "index.ts");
				const indexSh = path.join(component, "index.sh");
				const hasIndexTs = Boolean(await fs.stat(indexTs).catch(() => undefined));
				const hasIndexSh = Boolean(await fs.stat(indexSh).catch(() => undefined));
				if (hasIndexTs) command = `bun run .codex/hooks/${displayName}/index.ts`;
				else if (hasIndexSh) command = `bash .codex/hooks/${displayName}/index.sh`;
				else if (strictMissingIndex) {
					throw new CodexPreToolUsePreviewError(itemIndex, `hook directory has no index.ts/index.sh: ${component}`);
				}
			} else {
				command = `.codex/hooks/${displayName}`;
			}
		}
		return command.replaceAll(".codex/", `${path.join(targetPath, ".codex")}/`);
	}

	async syncPlatformYaml(
		targetPath: string,
		yaml: PlatformYaml,
		dryRun: boolean,
		_scope?: PluginScope,
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<PlatformConfigResult> {
		const processedSections: string[] = [];
		let modelMap: ModelMap | undefined;
		const preToolUsePreview = await this.previewPreToolUseCommands(targetPath, yaml);
		const previewByItemIndex = new Map(preToolUsePreview.map((preview) => [preview.itemIndex, preview]));

		// Reset MCP accumulator for this run
		this.resetMcpAccumulator();

		// --- config ---
		if (yaml.config !== undefined && yaml.config !== null) {
			await this.syncConfig(targetPath, yaml.config, dryRun, writeObserver, mutationHooks);
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
			await this.flushMcpBlock(targetPath, dryRun, writeObserver, mutationHooks);
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

				for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
					const item = items[itemIndex];
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

						await this.syncHooksDirect(
							targetPath,
							displayName,
							resolvedSourcePath,
							dryRun,
							writeObserver,
							mutationHooks,
						);
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
					const preview = hookEvent === "PreToolUse" ? previewByItemIndex.get(itemIndex) : undefined;
					if (preview) cmdPath = preview.wrappedCommand;

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

			await this.updateSettings(targetPath, accumulatedHooks, dryRun, preserveConfig, writeObserver, mutationHooks);
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
		writeObserver?: PlatformWriteObserver,
		mutationHooks?: DeployMutationHooks,
	): Promise<void> {
		const hooksFile = path.join(targetPath, ".codex", "hooks.json");

		if (dryRun) {
			logDry(`Update hooks.json: ${hooksFile}`);
			return;
		}

		const operation = async (): Promise<void> => {
			await fs.mkdir(path.join(targetPath, ".codex"), { recursive: true });
			const current = await readJsonFile(hooksFile);
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
						if (this.hookCommandMatches(block, markers)) (mergedHooks[event] ??= []).push(block);
					}
				}
			}
			const { hooks: _removed, ...rest } = current;
			await writeJsonFile(hooksFile, { ...rest, hooks: mergedHooks });
		};
		if (mutationHooks) await mutationHooks.mutate(hooksFile, operation);
		else await operation();
		if (writeObserver) await writeObserver(hooksFile);
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
