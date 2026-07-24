import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { filterExcludedCandidates, findRuleCandidates } from "./finder.js";
import { DEFAULT_AUTO_DISABLED_SOURCES } from "./sources.js";
import type { RuleCandidate } from "./types.js";

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

describe("findRuleCandidates — .claude/rules conditional supersede by .codex/rules", () => {
	// Previously DEFAULT_AUTO_DISABLED_SOURCES disabled .claude/rules /
	// ~/.claude/rules UNCONDITIONALLY, so a project with only .claude/rules
	// deployed (no .codex/rules counterpart) lost rules entirely — []. The fix
	// makes the supersede conditional on the codex counterpart actually being
	// present in the SAME scope (project pairs with project, home with home).
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "rules-supersede-test-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function plantClaudeRules(root: string): void {
		const dir = join(root, ".claude", "rules");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "probe.md"), "Ask via the AskUserQuestion tool.\n");
	}

	function plantCodexRules(root: string): void {
		const dir = join(root, ".codex", "rules");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "probe.md"), "Ask via the request_user_input tool.\n");
	}

	test("arm 1 — both .claude/rules and .codex/rules present: only .codex/rules is adopted (no duplicate)", () => {
		const projectRoot = join(tmp, "repo");
		plantClaudeRules(projectRoot);
		plantCodexRules(projectRoot);

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
		});

		expect(candidates.map((c) => c.source)).toEqual([".codex/rules"]);
	});

	test("arm 2 — only .claude/rules present (.codex/rules NOT deployed): .claude/rules is adopted, not dropped to []", () => {
		const projectRoot = join(tmp, "repo");
		plantClaudeRules(projectRoot);

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
		});

		expect(candidates.map((c) => c.source)).toEqual([".claude/rules"]);
	});

	test("arm 3 — only .codex/rules present: .codex/rules is adopted", () => {
		const projectRoot = join(tmp, "repo");
		plantCodexRules(projectRoot);

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
		});

		expect(candidates.map((c) => c.source)).toEqual([".codex/rules"]);
	});

	test("explicit config disable of .codex/rules still unconditionally drops it, even with .claude/rules present", () => {
		const projectRoot = join(tmp, "repo");
		plantClaudeRules(projectRoot);
		plantCodexRules(projectRoot);

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			disabledSources: new Set([".codex/rules"]),
		});

		expect(candidates.map((c) => c.source)).toEqual([".claude/rules"]);
	});

	test("mixed directory (project scope): a .claude/rules file WITHOUT a .codex/rules counterpart survives, while the paired file is superseded", () => {
		// .claude/rules/{shared.md, team-conventions.md} + .codex/rules/shared.md only.
		// Only shared.md has a codex counterpart — team-conventions.md has none and
		// must NOT be dropped by the scope-wide all-or-nothing gate the bug used.
		const projectRoot = join(tmp, "repo");
		const claudeDir = join(projectRoot, ".claude", "rules");
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(join(claudeDir, "shared.md"), "Ask via the AskUserQuestion tool.\n");
		writeFileSync(join(claudeDir, "team-conventions.md"), "# Team conventions\n");
		plantCodexRules(projectRoot); // .codex/rules/probe.md — NOT shared.md, so add shared.md directly
		writeFileSync(join(projectRoot, ".codex", "rules", "shared.md"), "Ask via the request_user_input tool.\n");

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			skipUserHome: true,
			pluginRoot: tmp,
			disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
		});

		const claudeCandidates = candidates.filter((c) => c.source === ".claude/rules");
		const codexCandidates = candidates.filter((c) => c.source === ".codex/rules");

		// team-conventions.md has no codex counterpart — it must survive.
		expect(claudeCandidates.map((c) => c.relativePath)).toContain(".claude/rules/team-conventions.md");
		// shared.md DOES have a codex counterpart — the .claude/rules copy is dropped.
		expect(claudeCandidates.map((c) => c.relativePath)).not.toContain(".claude/rules/shared.md");
		expect(codexCandidates.map((c) => c.relativePath)).toContain(".codex/rules/shared.md");
	});

	test("mixed directory (home scope): a ~/.claude/rules file WITHOUT a ~/.codex/rules counterpart survives", () => {
		const projectRoot = join(tmp, "repo");
		mkdirSync(projectRoot, { recursive: true });
		const homeDir = join(tmp, "home");
		const homeClaudeDir = join(homeDir, ".claude", "rules");
		mkdirSync(homeClaudeDir, { recursive: true });
		writeFileSync(join(homeClaudeDir, "shared.md"), "Ask via the AskUserQuestion tool.\n");
		writeFileSync(join(homeClaudeDir, "team-conventions.md"), "# Team conventions\n");
		const homeCodexDir = join(homeDir, ".codex", "rules");
		mkdirSync(homeCodexDir, { recursive: true });
		writeFileSync(join(homeCodexDir, "shared.md"), "Ask via the request_user_input tool.\n");

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			homeDir,
			pluginRoot: tmp,
			disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
		});

		const claudeCandidates = candidates.filter((c) => c.source === "~/.claude/rules");
		const codexCandidates = candidates.filter((c) => c.source === "~/.codex/rules");

		expect(claudeCandidates.map((c) => c.relativePath)).toContain(".claude/rules/team-conventions.md");
		expect(claudeCandidates.map((c) => c.relativePath)).not.toContain(".claude/rules/shared.md");
		expect(codexCandidates.map((c) => c.relativePath)).toContain(".codex/rules/shared.md");
	});

	test("mixed directory (nested package, non-root walk directory): a .claude/rules file WITH a .codex/rules counterpart is superseded even when the walk directory is not projectRoot", () => {
		// Regression: ruleStem previously derived the stem by stripping a
		// `${source}/` prefix off `relativePath` (which is always projectRoot-
		// relative). For a walk directory nested under projectRoot (e.g.
		// packages/app), relativePath is "packages/app/.claude/rules/foo.md" —
		// it never starts with ".claude/rules/", so the whole path was returned
		// unstemmed and claude/codex candidates could never pair up. The fix
		// derives the stem from the file's own rules-directory-relative path.
		const projectRoot = join(tmp, "nested");
		const appDir = join(projectRoot, "packages", "app");
		mkdirSync(join(appDir, "src"), { recursive: true });
		writeFileSync(join(projectRoot, "package.json"), "{}");
		const claudeDir = join(appDir, ".claude", "rules");
		const codexDir = join(appDir, ".codex", "rules");
		mkdirSync(claudeDir, { recursive: true });
		mkdirSync(codexDir, { recursive: true });
		writeFileSync(join(claudeDir, "foo.md"), "Ask via the AskUserQuestion tool.\n");
		writeFileSync(join(codexDir, "foo.md"), "Ask via the request_user_input tool.\n");

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: join(appDir, "src", "index.ts"),
			skipUserHome: true,
			pluginRoot: tmp,
			disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
		});

		const claudeCandidates = candidates.filter((c) => c.source === ".claude/rules");
		const codexCandidates = candidates.filter((c) => c.source === ".codex/rules");

		expect(claudeCandidates.map((c) => c.relativePath)).not.toContain(
			"packages/app/.claude/rules/foo.md",
		);
		expect(codexCandidates.map((c) => c.relativePath)).toContain(
			"packages/app/.codex/rules/foo.md",
		);
	});

	test("scope pairing: a project-scope .codex/rules must not suppress ~/.claude/rules (home scope)", () => {
		const projectRoot = join(tmp, "repo");
		plantCodexRules(projectRoot);
		const homeDir = join(tmp, "home");
		mkdirSync(join(homeDir, ".claude", "rules"), { recursive: true });
		writeFileSync(
			join(homeDir, ".claude", "rules", "probe.md"),
			"Ask via the AskUserQuestion tool.\n",
		);

		const candidates = findRuleCandidates({
			projectRoot,
			targetFile: null,
			cwd: projectRoot,
			homeDir,
			pluginRoot: tmp,
			disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
		});

		const sources = candidates.map((c) => c.source);
		expect(sources).toContain(".codex/rules");
		expect(sources).toContain("~/.claude/rules");
	});

	// Regression: supersedeClaudeRulesWithCodex previously consumed the raw candidate
	// list before excludeGlobs and the project-boundary check ran, so a `.codex/rules`
	// file that was about to be dropped by either filter still "won" the supersede
	// fight and suppressed its live `.claude/rules` sibling — losing both files. The
	// fix runs both filters before supersede; the predicates themselves are unchanged.
	describe("ordering: exclude-glob and project-boundary filters must run BEFORE supersede", () => {
		test("arm (i) — an excluded .codex/rules file must not suppress its .claude/rules sibling", () => {
			const projectRoot = join(tmp, "repo");
			plantClaudeRules(projectRoot);
			plantCodexRules(projectRoot);

			const candidates = findRuleCandidates({
				projectRoot,
				targetFile: null,
				cwd: projectRoot,
				skipUserHome: true,
				pluginRoot: tmp,
				disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
				excludeGlobs: ["/**/.codex/rules/probe.md"],
			});

			// The codex file is gone (user excluded it) AND its claude sibling must
			// survive — the old bug lost both files here.
			expect(candidates.map((c) => c.source)).toEqual([".claude/rules"]);
		});

		test("arm (ii) — a .codex/rules candidate resolving outside the project boundary must not suppress its .claude/rules sibling", () => {
			const projectRoot = join(tmp, "repo");
			plantClaudeRules(projectRoot);

			// .codex/rules/probe.md is a symlink to a file OUTSIDE projectRoot, so its
			// realPath fails isCandidateWithinProjectCached — it should never have been
			// eligible to supersede anything.
			const outsideDir = join(tmp, "outside");
			mkdirSync(outsideDir, { recursive: true });
			writeFileSync(join(outsideDir, "probe.md"), "Ask via the request_user_input tool.\n");
			const codexDir = join(projectRoot, ".codex", "rules");
			mkdirSync(codexDir, { recursive: true });
			symlinkSync(join(outsideDir, "probe.md"), join(codexDir, "probe.md"));

			const candidates = findRuleCandidates({
				projectRoot,
				targetFile: null,
				cwd: projectRoot,
				skipUserHome: true,
				pluginRoot: tmp,
				disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
			});

			const claudeCandidates = candidates.filter((c) => c.source === ".claude/rules");
			expect(claudeCandidates.map((c) => c.relativePath)).toContain(".claude/rules/probe.md");
		});

		test("arm (iii) — control: with both siblings valid and in-boundary, .codex/rules still wins as before", () => {
			const projectRoot = join(tmp, "repo");
			plantClaudeRules(projectRoot);
			plantCodexRules(projectRoot);

			const candidates = findRuleCandidates({
				projectRoot,
				targetFile: null,
				cwd: projectRoot,
				skipUserHome: true,
				pluginRoot: tmp,
				disabledSources: new Set(DEFAULT_AUTO_DISABLED_SOURCES),
			});

			expect(candidates.map((c) => c.source)).toEqual([".codex/rules"]);
		});
	});
});

describe("filterExcludedCandidates — win32 path normalization", () => {
	function candidate(path: string, realPath: string): RuleCandidate {
		return {
			path,
			realPath,
			source: ".claude/rules",
			distance: 0,
			isGlobal: false,
			isSingleFile: true,
			relativePath: ".claude/rules/ai-collaboration.md",
		};
	}

	test("slash-based glob drops a candidate whose path uses win32 backslashes", () => {
		// On win32 candidate.path/realPath carry backslashes (node:path /
		// realpathSync.native) while globs stay slash-based; the filter must
		// normalize both sides before matching.
		const backslashPath = "C:\\repo\\.claude\\rules\\ai-collaboration.md";
		const filtered = filterExcludedCandidates(
			[candidate(backslashPath, backslashPath)],
			["**/ai-collaboration.md"],
		);
		expect(filtered).toHaveLength(0);
	});

	test("drops on realPath backslashes even when path already matches nothing", () => {
		const backslashReal = "D:\\canonical\\rules\\ai-collaboration.md";
		const filtered = filterExcludedCandidates(
			[candidate("/symlink/rules/ai-collaboration.md", backslashReal)],
			["**/canonical/**"],
		);
		expect(filtered).toHaveLength(0);
	});

	test("posix paths remain matchable (normalization is a no-op)", () => {
		const posixPath = "/repo/.claude/rules/ai-collaboration.md";
		const filtered = filterExcludedCandidates(
			[candidate(posixPath, posixPath)],
			["**/ai-collaboration.md"],
		);
		expect(filtered).toHaveLength(0);
	});
});
