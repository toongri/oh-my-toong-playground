/**
 * Skill path-reference validator (path-shaped references only).
 *
 * The deployable source surface may mention a skill by a path, but references
 * to a skill that is not present in the source tree are stale.  This check is
 * deliberately narrower than a prose search: only `skills/<name>/` and
 * normalized relative paths from files under `skills/` are candidates.
 *
 * CLI usage: bun run tools/validators/skill-refs.ts
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getRootDir } from "../lib/config.ts";
import { collectFiles } from "../lib/sync-directory.ts";

const SCAN_DIRS = ["skills", "agents", "rules", "projects", "lib"] as const;
const EXCLUDED_DIRS = ["references", "tests", "__fixtures__"];
const SOURCE_EXTENSIONS = [".md", ".ts", ".yaml", ".sh"];

export type SkillRefAllowlistEntry = {
	file: string;
	name: string;
	reason: string;
};

export const ALLOWLIST: SkillRefAllowlistEntry[] = [
	// Upstream taste-skill attribution intentionally names materialized source skills.
	{
		file: "skills/frontend/ATTRIBUTION.md",
		name: "brandkit",
		reason: "vendored upstream attribution",
	},
	// Upstream taste-skill attribution intentionally names the source DESIGN document.
	{
		file: "skills/frontend/ATTRIBUTION.md",
		name: "stitch-skill",
		reason: "vendored upstream attribution",
	},
	// This assertion must retain the old path as the negative case under test.
	{
		file: "skills/frontend/SKILL.test.ts",
		name: "ui-ux-pro-max",
		reason: "negative path assertion",
	},
	// The documentation example uses a metavariable path, not a repository skill.
	{ file: "skills/writing-skills/SKILL.md", name: "path", reason: "metavariable example" },
	// These two anti-pattern examples deliberately show the path form being rejected.
	{ file: "skills/writing-skills/SKILL.md", name: "testing", reason: "anti-pattern example" },
];

type Candidate = { index: number; name: string; token: string; project?: string };

function isSourceFile(relPath: string): boolean {
	return (
		SOURCE_EXTENSIONS.some((extension) => relPath.endsWith(extension)) && !relPath.endsWith(".d.ts")
	);
}

function isExcludedContext(content: string, index: number): boolean {
	const left = content.slice(0, index);
	return /:\/\/\S*$/.test(left) || /\.(?:agents|claude|gemini|opencode)\/$/.test(left);
}

function collectCandidates(content: string, relPath: string): Candidate[] {
	const candidates: Candidate[] = [];

	// The one-character lookbehind is the path-segment boundary: a suffix such
	// as `shared-skills/skills/...` must not manufacture a candidate at its first
	// `skills/` occurrence.
	const skillPath =
		/(?<![a-z0-9-])(?:projects\/([a-z][a-z0-9-]*)\/)?skills\/([a-z][a-z0-9-]*)\//g;
	for (const match of content.matchAll(skillPath)) {
		const index = match.index ?? 0;
		if (isExcludedContext(content, index)) continue;
		candidates.push({ index, name: match[2], project: match[1], token: match[0] });
	}

	if (!relPath.startsWith("skills/")) return candidates;

	// A relative candidate is valid only when its normalized base is the
	// top-level `skills/` directory.  Consuming every `../` makes ../../x/ land
	// at the same source-root level as a one-step ../x/ from skills/<skill>/.
	const relativePath = /(?<!\.)(?:\.\.\/)+([a-z][a-z0-9-]*)\//g;
	const fileDir = relPath.split("/").slice(0, -1);
	for (const match of content.matchAll(relativePath)) {
		const index = match.index ?? 0;
		if (isExcludedContext(content, index)) continue;

		const upCount = (match[0].match(/\.\.\//g) ?? []).length;
		const base = fileDir.slice();
		for (let i = 0; i < upCount; i++) base.pop();
		if (base.length !== 1 || base[0] !== "skills") continue;

		candidates.push({ index, name: match[1], token: match[0] });
	}

	return candidates;
}

function sourceProject(relPath: string): string | undefined {
	return /^projects\/([a-z][a-z0-9-]*)\//.exec(relPath)?.[1];
}

function skillExists(rootDir: string, name: string, project?: string): boolean {
	return project
		? existsSync(join(rootDir, "projects", project, "skills", name))
		: existsSync(join(rootDir, "skills", name));
}

function isAllowlisted(
	relPath: string,
	name: string,
	allowlist: readonly SkillRefAllowlistEntry[],
): boolean {
	return allowlist.some((entry) => entry.file === relPath && entry.name === name);
}

export async function findSkillRefViolations(
	rootDir: string,
	allowlist: readonly SkillRefAllowlistEntry[] = ALLOWLIST,
): Promise<string[]> {
	const violations: string[] = [];

	for (const dir of SCAN_DIRS) {
		const base = join(rootDir, dir);
		if (!existsSync(base)) continue;

		const files = (await collectFiles(base, "", EXCLUDED_DIRS)).sort();
		for (const rel of files) {
			if (!isSourceFile(rel)) continue;

			const filePath = join(base, rel);
			const content = readFileSync(filePath, "utf8");
			const rootRelative = `${dir}/${rel}`;
			const currentProject = sourceProject(rootRelative);
			for (const candidate of collectCandidates(content, rootRelative)) {
				if (candidate.project) {
					// A project-scoped source may only resolve its own project path.
					if (
						(!currentProject || candidate.project === currentProject) &&
						skillExists(rootDir, candidate.name, candidate.project)
					) {
						continue;
					}
				} else if (
					(currentProject && skillExists(rootDir, candidate.name, currentProject)) ||
					skillExists(rootDir, candidate.name)
				) {
					continue;
				}
				if (isAllowlisted(rootRelative, candidate.name, allowlist)) continue;

				const line = content.slice(0, candidate.index).split("\n").length;
				violations.push(`${rootRelative}:${line}: ${candidate.token}`);
			}
		}
	}

	return violations;
}

async function main(): Promise<void> {
	const rootDir = getRootDir();
	if (!rootDir) {
		process.stderr.write("[SKILL-REF] config.yaml를 찾을 수 없습니다\n");
		process.exit(1);
	}

	const violations = await findSkillRefViolations(rootDir);
	if (violations.length > 0) {
		for (const violation of violations) {
			process.stderr.write(`\x1b[0;31m[ERROR]\x1b[0m ${violation}\n`);
		}
		process.stderr.write(
			`\x1b[0;31m[ERROR]\x1b[0m skill 경로 참조 검증 실패: ${violations.length} 개 위반\n`,
		);
		process.exit(1);
	}

	process.stderr.write("\x1b[0;32m[SKILL-REF]\x1b[0m skill 경로 참조 검증 통과\n");
	process.exit(0);
}

if (import.meta.main) {
	main();
}
