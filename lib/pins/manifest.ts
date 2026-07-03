import { promises as fs } from "fs";
import { join } from "path";
import { resolveOmtDir, resolvePinsHome, resolveProjectRoot } from "../omt-dir.ts";
import { parseYamlStrict } from "./yaml";

export interface PinsManifest {
	location: string;
	scope: string;
	/** Whether this pins corpus is git-managed (default false; independent of location). */
	git?: boolean;
}

export type ManifestResult = { kind: "absent" } | { kind: "resolved"; manifest: PinsManifest };

interface ResolveOptions {
	projectRoot?: string;
	pinsHome?: string;
	userRoot?: string;
}

async function readManifestAt(dir: string): Promise<PinsManifest | null> {
	const filePath = join(dir, "pins.yaml");
	let text: string;
	try {
		text = await fs.readFile(filePath, "utf8");
	} catch (err) {
		const code = err instanceof Error && "code" in err ? err.code : undefined;
		if (code === "ENOENT" || code === "ENOTDIR") return null;
		throw err;
	}
	const parsed = parseYamlStrict(text);
	if (parsed === null || parsed === undefined || typeof parsed !== "object") return null;
	if (!("location" in parsed) || !("scope" in parsed)) return null;
	if (typeof parsed.location !== "string" || typeof parsed.scope !== "string") return null;
	const git = "git" in parsed && typeof parsed.git === "boolean" ? parsed.git : false;
	return { location: parsed.location, scope: parsed.scope, git };
}

/**
 * Resolves pins.yaml with project-root-first, user-root-fallback precedence.
 *
 * Search order:
 *   1. {projectRoot}/pins.yaml  (defaults to the git project root of cwd)
 *   2. {pinsHome}/pins.yaml     (defaults to resolvePinsHome(projectRoot))
 *   3. {userRoot}/pins.yaml     (defaults to resolveOmtDir())
 *
 * Returns { kind: "resolved", manifest } when found, { kind: "absent" } otherwise.
 * Never throws when neither manifest exists. Never creates a file.
 *
 * The optional `git` field records whether the pins corpus is git-managed
 * (default false; independent of location).
 */
export async function resolveManifest(options: ResolveOptions = {}): Promise<ManifestResult> {
	const projectRoot = options.projectRoot ?? resolveProjectRoot();
	const pinsHome = options.pinsHome ?? resolvePinsHome(projectRoot);
	const userRoot = options.userRoot ?? resolveOmtDir();

	const fromProject = await readManifestAt(projectRoot);
	if (fromProject !== null) {
		return { kind: "resolved", manifest: fromProject };
	}

	const fromPinsHome = await readManifestAt(pinsHome);
	if (fromPinsHome !== null) {
		return { kind: "resolved", manifest: fromPinsHome };
	}

	const fromUser = await readManifestAt(userRoot);
	if (fromUser !== null) {
		return { kind: "resolved", manifest: fromUser };
	}

	return { kind: "absent" };
}
