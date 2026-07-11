import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { findRuleCandidates } from "./finder.js";

describe("findRuleCandidates — static mode distance gradient (regression: #static-distance-flatten)", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "rules-finder-test-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	test("nested CONTEXT.md and root CONTEXT.md both survive with distinct distances when cwd is nested package", () => {
		// Arrange: /tmp/.../repo/CONTEXT.md + /tmp/.../repo/apps/mobile/CONTEXT.md
		const projectRoot = join(tmp, "repo");
		const mobileDir = join(projectRoot, "apps", "mobile");
		mkdirSync(mobileDir, { recursive: true });
		writeFileSync(join(projectRoot, "CONTEXT.md"), "# Root context");
		writeFileSync(join(mobileDir, "CONTEXT.md"), "# Mobile context");

		// Act: static mode — targetFile null, cwd = apps/mobile
		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: mobileDir,
			skipUserHome: true,
			pluginRoot: tmp, // no bundled rules under tmp
		});

		const contextCandidates = candidates.filter((c) => c.source === "CONTEXT.md");

		// Assert: both files are discovered
		expect(contextCandidates).toHaveLength(2);

		// Nested (apps/mobile/CONTEXT.md) should be distance 0 (closest to cwd)
		const nested = contextCandidates.find((c) => c.path === join(mobileDir, "CONTEXT.md"));
		expect(nested).toBeDefined();
		expect(nested!.distance).toBe(0);

		// Root CONTEXT.md should be at distance 2 (apps/mobile → apps → repo)
		const root = contextCandidates.find((c) => c.path === join(projectRoot, "CONTEXT.md"));
		expect(root).toBeDefined();
		expect(root!.distance).toBe(2);
	});

	test("nested CONTEXT.md sorts before root CONTEXT.md (lower distance = closer)", () => {
		const projectRoot = join(tmp, "repo");
		const mobileDir = join(projectRoot, "apps", "mobile");
		mkdirSync(mobileDir, { recursive: true });
		writeFileSync(join(projectRoot, "CONTEXT.md"), "# Root context");
		writeFileSync(join(mobileDir, "CONTEXT.md"), "# Mobile context");

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: mobileDir,
			skipUserHome: true,
			pluginRoot: tmp,
		});

		const contextCandidates = candidates.filter((c) => c.source === "CONTEXT.md");
		expect(contextCandidates).toHaveLength(2);

		// First in sorted order should be the nested one (distance 0 < distance 2)
		expect(contextCandidates[0]!.path).toBe(join(mobileDir, "CONTEXT.md"));
		expect(contextCandidates[1]!.path).toBe(join(projectRoot, "CONTEXT.md"));
	});

	test("only root CONTEXT.md (distance 0) is treated as isRootSingleFile — nested survives with non-zero distance", () => {
		const projectRoot = join(tmp, "repo");
		const mobileDir = join(projectRoot, "apps", "mobile");
		mkdirSync(mobileDir, { recursive: true });
		writeFileSync(join(projectRoot, "CONTEXT.md"), "# Root context");
		writeFileSync(join(mobileDir, "CONTEXT.md"), "# Mobile context");

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: mobileDir,
			skipUserHome: true,
			pluginRoot: tmp,
		});

		const contextCandidates = candidates.filter((c) => c.source === "CONTEXT.md");

		// The nested file at distance=0 is isRootSingleFile (it's closest),
		// the root at distance=2 is NOT isRootSingleFile — both survive the finder.
		// (dedup only applies within engine-static-loader, not in findRuleCandidates itself)
		const nested = contextCandidates.find((c) => c.path === join(mobileDir, "CONTEXT.md"))!;
		const root = contextCandidates.find((c) => c.path === join(projectRoot, "CONTEXT.md"))!;

		expect(nested.isSingleFile).toBe(true);
		expect(root.isSingleFile).toBe(true);

		// Critical: distances must differ so dedup logic can distinguish them
		expect(nested.distance).not.toBe(root.distance);
	});
});

describe("findRuleCandidates — excludeGlobs filter", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "rules-finder-exclude-test-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	test("excludes on absolute path not relativePath", () => {
		const projectRoot = join(tmp, "repo");
		const rulesDir = join(projectRoot, ".claude", "rules");
		mkdirSync(rulesDir, { recursive: true });
		writeFileSync(join(rulesDir, "ai-collaboration.md"), "# rule");

		// An absolute-anchored glob matches the absolute path and drops the candidate.
		const excluded = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			excludeGlobs: ["/**/ai-collaboration.md"],
		});
		expect(excluded.find((c) => c.source === ".claude/rules")).toBeUndefined();

		// A non-matching glob leaves the candidate present.
		const present = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			excludeGlobs: ["nonexistent/**"],
		});
		expect(present.find((c) => c.source === ".claude/rules")).toBeDefined();
	});

	test("exclude matches path OR realPath", () => {
		const projectRoot = join(tmp, "repo");
		mkdirSync(join(projectRoot, ".claude"), { recursive: true });
		const realRulesDir = join(tmp, "real-rules");
		mkdirSync(realRulesDir, { recursive: true });
		writeFileSync(join(realRulesDir, "symlinked.md"), "# rule");
		// Symlink the rule dir so a candidate's `path` (via the symlink) differs
		// from its `realPath` (the resolved canonical location).
		symlinkSync(realRulesDir, join(projectRoot, ".claude", "rules"), "dir");

		// Glob matches only realPath (the symlink target, outside the project tree).
		const droppedByRealPath = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			excludeGlobs: ["/**/real-rules/**"],
		});
		expect(droppedByRealPath.find((c) => c.source === ".claude/rules")).toBeUndefined();

		// Glob matches only path (the symlink itself, under the project tree).
		const droppedByPath = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			excludeGlobs: ["/**/.claude/rules/**"],
		});
		expect(droppedByPath.find((c) => c.source === ".claude/rules")).toBeUndefined();
	});
});
