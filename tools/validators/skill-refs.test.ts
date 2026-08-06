import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { getRootDir } from "../lib/config.ts";
import { ALLOWLIST, findSkillRefViolations } from "./skill-refs.ts";

function makeRoot(): string {
	return mkdtempSync(join(tmpdir(), "skill-refs-test-"));
}

function writeFixture(rootDir: string, relPath: string, content: string): void {
	const filePath = join(rootDir, relPath);
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, content, "utf8");
}

async function withRoot(seed: (rootDir: string) => void): Promise<string[]> {
	const rootDir = makeRoot();
	try {
		seed(rootDir);
		return await findSkillRefViolations(rootDir);
	} finally {
		rmSync(rootDir, { recursive: true, force: true });
	}
}

describe("skill 경로 참조 검증기", () => {
	test("left boundary keeps a real skill quiet and reports a missing skill after the embedded segment", async () => {
		const violations = await withRoot((root) => {
			writeFixture(
				root,
				"agents/example.md",
				"packages/shared-skills/skills/visual-qa/\npackages/shared-skills/skills/nonexistent-xyz/\n",
			);
			mkdirSync(join(root, "skills", "visual-qa"), { recursive: true });
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("nonexistent-xyz");
	});

	test("repeated relative segments normalize from a skills child directory, while a dotted URL fragment is ignored", async () => {
		const violations = await withRoot((root) => {
			writeFixture(
				root,
				"skills/a/scripts/x.ts",
				'curl -X PUT https://example.test/json/new\n"../../nonexistent-xyz/y.ts"\n',
			);
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("nonexistent-xyz");
	});

	test("relative references resolving to an existing skill are not violations", async () => {
		const violations = await withRoot((root) => {
			writeFixture(
				root,
				"skills/orchestrate-review/scripts/template-consistency.test.ts",
				'import "../../ultragoal/scripts/ultragoal-state.ts";\n',
			);
			mkdirSync(join(root, "skills", "ultragoal"), { recursive: true });
		});

		expect(violations).toHaveLength(0);
	});

	test("URL-internal and deployed .claude skill paths are excluded without losing a same-line bare violation", async () => {
		const violations = await withRoot((root) => {
			writeFixture(
				root,
				"agents/paths.md",
				"https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/frontend-design/SKILL.md and skills/nonexistent-xyz/file.md ~/.claude/skills/debugging/\n",
			);
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("nonexistent-xyz");
		expect(violations[0]).not.toContain("frontend-design");
		expect(violations[0]).not.toContain("debugging");
	});

	test("deployed .agents skill paths are excluded without losing a same-line bare violation", async () => {
		const violations = await withRoot((root) => {
			writeFixture(
				root,
				"agents/paths.md",
				".agents/skills/nonexistent-xyz/ and skills/nonexistent-xyz/\n",
			);
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("skills/nonexistent-xyz/");
	});

	test("test TypeScript files are scanned but declaration files are skipped", async () => {
		const violations = await withRoot((root) => {
			writeFixture(root, "skills/x/SKILL.test.ts", "skills/nonexistent-xyz/\n");
			writeFixture(root, "skills/x/types.d.ts", "skills/also-missing/\n");
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("SKILL.test.ts");
		expect(violations[0]).toContain("nonexistent-xyz");
	});

	test("markdown, yaml, and shell files are scanned while unrelated extensions are skipped", async () => {
		const violations = await withRoot((root) => {
			writeFixture(root, "rules/rule.yaml", "skills/missing-yaml/");
			writeFixture(root, "projects/demo/check.sh", "skills/missing-shell/");
			writeFixture(root, "lib/ignored.txt", "skills/missing-text/");
		});

		expect(violations).toHaveLength(2);
		expect(violations.some((v) => v.includes("missing-yaml"))).toBe(true);
		expect(violations.some((v) => v.includes("missing-shell"))).toBe(true);
		expect(violations.join("\n")).not.toContain("missing-text");
	});

	test("references, tests, and fixture subtrees are pruned; missing scan roots are harmless; lib remains in scope", async () => {
		const violations = await withRoot((root) => {
			writeFixture(root, "skills/x/references/ignored.md", "skills/missing-references/");
			writeFixture(root, "skills/x/tests/ignored.md", "skills/missing-tests/");
			writeFixture(root, "skills/x/__fixtures__/ignored.md", "skills/missing-fixtures/");
			writeFixture(root, "skills/x/kept.md", "skills/missing-kept/");
			writeFixture(root, "lib/kept.ts", "skills/missing-lib/");
		});

		expect(violations).toHaveLength(2);
		expect(violations.some((v) => v.includes("missing-kept"))).toBe(true);
		expect(violations.some((v) => v.includes("missing-lib"))).toBe(true);
		expect(violations.join("\n")).not.toContain("missing-references");
		expect(violations.join("\n")).not.toContain("missing-tests");
		expect(violations.join("\n")).not.toContain("missing-fixtures");
	});

	test("only the five exact allowlist pairs are exempted", async () => {
		const violations = await withRoot((root) => {
			for (const item of ALLOWLIST) {
				writeFixture(root, item.file, `skills/${item.name}/\n`);
			}
		});

		expect(ALLOWLIST).toHaveLength(5);
		expect(violations).toHaveLength(0);
	});

	test("an allowlisted file still reports a different missing skill", async () => {
		const item = ALLOWLIST[0];
		const violations = await withRoot((root) => {
			writeFixture(root, item.file, `skills/${item.name}/ and skills/not-allowlisted-xyz/\n`);
		});

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("not-allowlisted-xyz");
	});

	test("bare prose names and top-level tools or hooks are outside the scan", async () => {
		const violations = await withRoot((root) => {
			writeFixture(root, "skills/x/prose.md", "Use nonexistent-xyz without a path.\n");
			writeFixture(root, "tools/ignored.md", "skills/missing-tools/\n");
			writeFixture(root, "hooks/ignored.sh", "skills/missing-hooks/\n");
		});

		expect(violations).toHaveLength(0);
	});

	test("allowlist self-pruning", async () => {
		const rootDir = getRootDir();
		expect(rootDir).not.toBeNull();

		for (const item of ALLOWLIST) {
			const reduced = ALLOWLIST.filter((candidate) => candidate !== item);
			const violations = await findSkillRefViolations(rootDir as string, reduced);
			expect(
				violations.some(
					(violation) => violation.startsWith(`${item.file}:`) && violation.includes(item.name),
				),
			).toBe(true);
		}
	});
});
