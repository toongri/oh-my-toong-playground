import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { PROJECT_MARKERS } from "./constants.js";

/**
 * Workspace root markers that unambiguously identify a monorepo root.
 * Takes precedence over plain package.json which may appear in nested packages.
 */
const WORKSPACE_MARKERS: readonly string[] = ["pnpm-workspace.yaml", "turbo.json", ".git"];

export function findProjectRoot(startPath: string, markers: ReadonlyArray<string> = PROJECT_MARKERS): string | null {
	const resolvedStartPath = resolve(startPath);

	if (!existsSync(resolvedStartPath)) {
		return null;
	}

	const startStats = statSync(resolvedStartPath);
	let currentDirectory = startStats.isDirectory() ? resolvedStartPath : dirname(resolvedStartPath);
	const filesystemRoot = resolve("/");

	// First candidate that matches a weak marker (package.json etc.) — used as fallback
	// if no workspace root marker is found higher up.
	let weakCandidate: string | null = null;

	while (true) {
		// Workspace root markers stop immediately — they unambiguously identify the root.
		for (const marker of WORKSPACE_MARKERS) {
			if (existsSync(join(currentDirectory, marker))) {
				return currentDirectory;
			}
		}

		// A root package.json with a "workspaces" field is also a workspace root.
		const packageJsonPath = join(currentDirectory, "package.json");
		if (existsSync(packageJsonPath) && hasWorkspacesField(packageJsonPath)) {
			return currentDirectory;
		}

		// Weak marker: first directory matching any PROJECT_MARKERS entry — kept as fallback
		// in case no workspace root marker exists above.
		if (weakCandidate === null) {
			for (const marker of markers) {
				if (existsSync(join(currentDirectory, marker))) {
					weakCandidate = currentDirectory;
					break;
				}
			}
		}

		const parentDirectory = dirname(currentDirectory);
		if (currentDirectory === filesystemRoot || parentDirectory === currentDirectory) {
			return weakCandidate;
		}

		currentDirectory = parentDirectory;
	}
}

function hasWorkspacesField(packageJsonPath: string): boolean {
	try {
		const content = readFileSync(packageJsonPath, "utf8");
		const parsed: unknown = JSON.parse(content);
		return (
			typeof parsed === "object" &&
			parsed !== null &&
			"workspaces" in parsed &&
			parsed.workspaces !== null &&
			parsed.workspaces !== undefined
		);
	} catch {
		return false;
	}
}
