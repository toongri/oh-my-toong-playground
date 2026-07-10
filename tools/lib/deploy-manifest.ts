import fs from "fs/promises";
import path from "path";

const MANIFEST_FILENAME = ".sync-manifest.json";

/** Manifest shape: `"<platform>/<category>"` -> the entry names OMT deployed there. */
export type ManifestData = Record<string, string[]>;

function manifestPath(deployRoot: string): string {
	return path.join(deployRoot, MANIFEST_FILENAME);
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
 * Read the deploy manifest at `{deployRoot}/.sync-manifest.json`.
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
	await fs.writeFile(manifestPath(deployRoot), JSON.stringify(sorted, null, 2) + "\n", "utf8");
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
 * extensionless file) AND any sibling `X.*` (a file carrying an extension,
 * e.g. a `.toml`/`.md` component) — the two on-disk forms a deployed component
 * can take. Matching is anchored on the full name plus a literal following
 * dot, so `intro` matches `intro.md` but never `introduction.md`: a bare
 * `startsWith` without the trailing-dot check would treat an unrelated longer
 * name as the same entry. Because `X` only ever names something OMT itself
 * previously recorded deploying, a foreign resident (a different name
 * entirely) can never match here, regardless of what orphanNames contains.
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
		const isOrphan = orphanNames.some((name) => entry === name || entry.startsWith(`${name}.`));
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
