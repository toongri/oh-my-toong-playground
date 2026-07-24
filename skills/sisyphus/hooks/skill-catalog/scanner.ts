import { readdir } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";
import { Harness } from "./types.ts";

// Scan a single directory for skill subdirectories
// Returns directory names (skill names), empty array on any error
async function scanDirectory(dirPath: string): Promise<string[]> {
	try {
		const entries = await readdir(dirPath, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		// Directory doesn't exist or can't be read — not an error
		return [];
	}
}

// Scan skill directories for the given harness only — Claude reads
// .claude/skills, Codex reads .agents/skills (tools/adapters/codex.ts:159
// codexSkillsDir — Codex 0.144.1 deploys skills there, not .claude/skills),
// each at project and home scope — and return deduplicated skill names.
// Scanning is harness-scoped, not unconditional across both roots: a
// platforms:[claude]-gated skill lands only under .claude/skills, and a
// Codex session must not discover it (it would surface as an invokable
// catalog entry that fails on call, since Codex has no landing copy).
export async function scanSkillDirectories(cwd: string, harness: Harness): Promise<string[]> {
	const homeDir = process.env.HOME || "/tmp";
	const landingDirName = harness === "codex" ? ".agents" : ".claude";

	const candidateDirs = [join(cwd, landingDirName, "skills"), join(homeDir, landingDirName, "skills")];

	const scannedDirs = await Promise.all(candidateDirs.map(scanDirectory));

	// Deduplicate: first-seen wins (project dirs listed before home dirs)
	const seen = new Set<string>();
	const result: string[] = [];

	for (const names of scannedDirs) {
		for (const name of names) {
			if (!seen.has(name)) {
				seen.add(name);
				result.push(name);
			}
		}
	}

	// Sort deterministically so output is session- and machine-invariant
	return result.sort((l, r) => l.localeCompare(r));
}

// Read enabled plugin IDs from ~/.claude/settings.json.
// Codex has no plugin system (tools/adapters/codex.ts:862 — "Codex does not
// support plugins. Skipping plugins section."), so under a Codex session a
// plugin-gated catalog entry (e.g. frontend-design) can never actually be
// reached even if a stray ~/.claude/settings.json exists on the same machine
// (e.g. the user also runs Claude Code elsewhere). Short-circuit to an empty
// Set rather than reading a file whose contents are meaningless to this
// harness. `harness` is the caller's already-resolved detectHarness() value
// (index.ts) — this function does not re-derive it from env itself, so there
// is exactly one place in this package that decides Claude vs Codex (a
// second, independent CODEX_THREAD_ID check here previously could disagree
// with detectHarness()'s OMT_SESSION_ID-aware priority whenever both env
// vars were present).
export function readEnabledPlugins(harness: Harness): Set<string> {
	if (harness === "codex") {
		return new Set();
	}

	try {
		const homeDir = process.env.HOME || "/tmp";
		const settingsPath = join(homeDir, ".claude", "settings.json");
		const raw = readFileSync(settingsPath, "utf8");
		const settings = JSON.parse(raw);
		const enabledPlugins = settings.enabledPlugins;

		if (!enabledPlugins || typeof enabledPlugins !== "object") {
			return new Set();
		}

		const result = new Set<string>();
		for (const [pluginId, enabled] of Object.entries(enabledPlugins)) {
			if (enabled === true) {
				result.add(pluginId);
			}
		}
		return result;
	} catch {
		// File missing, parse error, or any other issue — return empty Set
		return new Set();
	}
}
