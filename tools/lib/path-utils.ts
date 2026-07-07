import os from "os";
import path from "path";

/**
 * Expand a leading `~` or `~/` to the user's home directory.
 *
 * Rules:
 *   `~`        → os.homedir()
 *   `~/foo`    → path.join(os.homedir(), "foo")
 *   `~user/…`  → returned as-is (POSIX ~user not supported)
 *   absolute   → returned as-is
 *   relative   → returned as-is
 *   empty      → returned as-is
 */
export function expandTilde(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

/**
 * Returns true when targetPath resolves to the user's home directory.
 * Adapters use this to choose between $HOME (global sync) and $CLAUDE_PROJECT_DIR (project sync).
 * Symlinked homedir is not followed — uses path.resolve only. If needed later, switch to fs.realpathSync.
 */
export function isGlobalSync(targetPath: string): boolean {
	return path.resolve(expandTilde(targetPath)) === path.resolve(os.homedir());
}

// ---------------------------------------------------------------------------
// Docs component target resolution (purely lexical — no filesystem access)
// ---------------------------------------------------------------------------

/**
 * Compute a `docs` component item's final deploy target, relative to deployRoot.
 * POSIX-normalized, no leading `./`. Does not append a file extension — that's
 * the caller's concern.
 *
 * Resolution:
 *   base = sectionPath ?? "docs"
 *   itemPath given  → path.join(base, itemPath), overriding componentName.
 *                     itemPath is root-relative in the sense that `..` segments
 *                     can walk it back out of base — as long as the joined,
 *                     normalized result stays under deployRoot, that's allowed
 *                     (containment is about deployRoot, not about base).
 *   itemPath absent → path.join(base, componentName) — a nested componentName
 *                     like "skills/authoring" preserves its subpath under base.
 *   as given        → replace the final path segment's name with `as`.
 *
 * Throws (via assertDocsTargetContained) if the resolved target escapes
 * deployRoot, is absolute, is empty, or equals deployRoot itself.
 *
 * Lexical only — no realpath/lstat. The FS-level symlink-escape guard for
 * intermediate directories is a separate, later runtime-only task.
 */
export function resolveDocsTarget(
	componentName: string,
	sectionPath: string | undefined,
	itemPath: string | undefined,
	as: string | undefined,
): string {
	const base = sectionPath ?? "docs";
	const joined =
		itemPath !== undefined ? path.posix.join(base, itemPath) : path.posix.join(base, componentName);

	const renamed = as !== undefined ? path.posix.join(path.posix.dirname(joined), as) : joined;

	const target = path.posix.normalize(renamed);
	assertDocsTargetContained(target);
	return target;
}

/**
 * Reject a docs deploy target that escapes deployRoot as a trust-boundary check.
 * Lexical only (path.normalize) — no realpath/lstat/existsSync.
 *
 * Rejects a relTarget that, after path.normalize:
 *   - has a leading `..` segment (escapes deployRoot)
 *   - is absolute
 *   - is empty
 *   - normalizes to `.` (equals deployRoot itself)
 *
 * A `..` that merely leaves the docs *base* but stays strictly under
 * deployRoot (e.g. base "docs" + itemPath "../other/x" → "other/x") is NOT
 * rejected here — that check already happened via normalize before this is
 * called; this function only cares about escaping deployRoot.
 */
export function assertDocsTargetContained(relTarget: string): void {
	const normalized = path.posix.normalize(relTarget);

	if (normalized === "" || normalized === ".") {
		throw new Error(`docs target must not resolve to deployRoot itself: ${JSON.stringify(relTarget)}`);
	}
	if (path.posix.isAbsolute(normalized)) {
		throw new Error(`docs target must be relative to deployRoot, got absolute path: ${JSON.stringify(relTarget)}`);
	}
	if (normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`docs target escapes deployRoot: ${JSON.stringify(relTarget)}`);
	}
}

export type DocsTargetCollision = {
	kind: "duplicate" | "case-collision";
	targets: string[];
};

/**
 * Detect collisions among resolved docs deploy targets, purely by string
 * comparison — no filesystem probe — so the result is identical on
 * case-sensitive (Linux) and case-insensitive (macOS) filesystems.
 *
 *   - "duplicate": two or more targets normalize to the exact same string.
 *   - "case-collision": two or more targets normalize to the same string
 *     only after lowercasing (i.e. differ only in case).
 */
export function detectDocsTargetCollisions(targets: string[]): DocsTargetCollision[] {
	const byLower = new Map<string, string[]>();

	for (const raw of targets) {
		const normalized = path.posix.normalize(raw);
		const lower = normalized.toLowerCase();
		const bucket = byLower.get(lower);
		if (bucket) {
			bucket.push(normalized);
		} else {
			byLower.set(lower, [normalized]);
		}
	}

	const collisions: DocsTargetCollision[] = [];

	for (const group of byLower.values()) {
		if (group.length < 2) continue;

		const countByExact = new Map<string, number>();
		for (const t of group) {
			countByExact.set(t, (countByExact.get(t) ?? 0) + 1);
		}

		for (const [exact, count] of countByExact) {
			if (count > 1) {
				collisions.push({ kind: "duplicate", targets: Array(count).fill(exact) });
			}
		}

		if (countByExact.size > 1) {
			collisions.push({ kind: "case-collision", targets: [...countByExact.keys()] });
		}
	}

	return collisions;
}
