import fs from "fs/promises";
import path from "path";

// Lives under the target's `.omt/` working dir (not littering the deploy root)
// so the target repo can gitignore all OMT-generated bookkeeping with one entry.
const MANIFEST_RELPATH = path.join(".omt", "sync-manifest.json");

/** Manifest shape: `"<platform>/<category>"` -> the entry names OMT deployed there. */
export type ManifestData = Record<string, string[]>;

function manifestPath(deployRoot: string): string {
	return path.join(deployRoot, MANIFEST_RELPATH);
}

function pairKey(platform: string, category: string): string {
	return `${platform}/${category}`;
}

/** True when `value` is a pair-key -> string[] map (the only shape readManifest accepts). */
function isValidManifestShape(value: unknown): value is ManifestData {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return Object.values(value).every(
		(names) => Array.isArray(names) && names.every((name) => typeof name === "string"),
	);
}

/**
 * Read the deploy manifest at `{deployRoot}/.omt/sync-manifest.json`.
 *
 * Returns `null` — the BOOTSTRAP sentinel — when the file is absent, unreadable
 * for any reason, not valid JSON, or parses to something other than a pair-key
 * -> string[] map. Callers MUST branch on `null` meaning "treat as bootstrap:
 * delete nothing, reseed from the current declared set" — never as an empty
 * map. Collapsing a corrupt/missing manifest to `{}` would make every foreign
 * resident compute as an orphan of an empty declared history and get deleted;
 * `null` is a distinct type from `{}` specifically so that mistake cannot
 * typecheck past this boundary.
 */
export async function readManifest(deployRoot: string): Promise<ManifestData | null> {
	let text: string;
	try {
		text = await fs.readFile(manifestPath(deployRoot), "utf8");
	} catch {
		return null; // absent or unreadable
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null; // unparseable
	}

	return isValidManifestShape(parsed) ? parsed : null; // structurally invalid
}

/** Write the manifest, with pair keys and each pair's entry-name array sorted for deterministic output. */
export async function writeManifest(deployRoot: string, data: ManifestData): Promise<void> {
	const sorted: ManifestData = {};
	for (const key of Object.keys(data).sort()) {
		sorted[key] = [...data[key]].sort();
	}
	const target = manifestPath(deployRoot);
	// `.omt/` may not exist yet at this target — writeFile does not create parents.
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

/** Orphans = names OMT deployed previously that are not in this run's declared set. */
export function computeOrphans(previousNames: string[], declaredNames: string[]): string[] {
	const declared = new Set(declaredNames);
	return previousNames.filter((name) => !declared.has(name));
}

/**
 * Remove each orphaned entry under `{deployRoot}/.{platform}/{category}/`.
 *
 * For an orphan named `X`, removes the on-disk entry `X` itself (directory or
 * extensionless file) AND its single-file forms `X.md` / `X.toml` — the exact
 * on-disk forms OMT's adapters ever deploy a component as (extensionless
 * directory for skills/scripts, `.md` for claude/opencode agents-commands-
 * rules, `.toml` for gemini commands and codex agents). Matching is exact
 * equality against those known suffixes, not a prefix/stem check, so `intro`
 * matches `intro.md` but never `introduction.md`, and never a same-stem
 * foreign file like `intro.personal.md`. Because `X` only ever names
 * something OMT itself previously recorded deploying, and the match is exact
 * rather than a `startsWith`, a foreign resident (any name, including one
 * that merely starts with `X.`) can never match here, regardless of what
 * orphanNames contains.
 */
export async function removeOrphans(
	deployRoot: string,
	platform: string,
	category: string,
	orphanNames: string[],
): Promise<void> {
	if (orphanNames.length === 0) return;

	const categoryDir = path.join(deployRoot, `.${platform}`, category);
	let entries: string[];
	try {
		entries = await fs.readdir(categoryDir);
	} catch {
		return; // category dir absent — nothing to remove
	}

	for (const entry of entries) {
		const isOrphan = orphanNames.some(
			(name) => entry === name || entry === `${name}.md` || entry === `${name}.toml`,
		);
		if (isOrphan) {
			await fs.rm(path.join(categoryDir, entry), { recursive: true, force: true });
		}
	}
}

/**
 * Reconcile one `(platform, category)` pair's on-disk state against this
 * run's declared set, then persist the result to the manifest.
 *
 * Read-modify-write over the whole manifest file (not just this pair): the
 * manifest holds every pair, and only this call's own pair is touched — every
 * other pair's recorded entries pass through unchanged. On BOOTSTRAP
 * (readManifest returns `null`), orphan removal is skipped entirely — the
 * safety contract's hard branch — and the manifest is (re)seeded starting
 * from `declaredNames` for this pair.
 */
export async function reconcilePairManifest(
	deployRoot: string,
	platform: string,
	category: string,
	declaredNames: string[],
): Promise<void> {
	const key = pairKey(platform, category);
	const previous = await readManifest(deployRoot);

	if (previous !== null) {
		const orphans = computeOrphans(previous[key] ?? [], declaredNames);
		if (orphans.length > 0) {
			await removeOrphans(deployRoot, platform, category, orphans);
		}
	}

	const next: ManifestData = previous !== null ? { ...previous } : {};
	next[key] = declaredNames;
	await writeManifest(deployRoot, next);
}

/**
 * Remove a single `${platformOrLocation}/${category}` pair key from the
 * manifest, leaving every other pair untouched. Bootstrap-safe: when
 * `readManifest` returns `null` (file absent, unreadable, or corrupt), this
 * is a no-op — it never writes the manifest and never throws. Used to prune a
 * stale pair key after its deploy location has moved (e.g. `codex/skills`
 * once Codex skills routed to `.agents/skills`), so a future `codex/skills`
 * deploy never diffs against that stale key's leftover entry names.
 */
export async function removeManifestPair(
	deployRoot: string,
	platformOrLocation: string,
	category: string,
): Promise<void> {
	const current = await readManifest(deployRoot);
	if (current === null) return;

	const key = pairKey(platformOrLocation, category);
	const { [key]: _removed, ...rest } = current;
	await writeManifest(deployRoot, rest);
}
