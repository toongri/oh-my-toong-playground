import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	readManifest,
	writeManifest,
	computeOrphans,
	removeOrphans,
	reconcilePairManifest,
	type ManifestData,
} from "./deploy-manifest.ts";

describe("deploy-manifest 모듈", () => {
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "omt-deploy-manifest-test-"));
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	describe("readManifest", () => {
		it("returns null when the manifest file is absent", async () => {
			const deployRoot = join(tmpDir, "read-missing");
			await mkdir(deployRoot, { recursive: true });

			expect(await readManifest(deployRoot)).toBeNull();
		});

		it("returns null (BOOTSTRAP sentinel) when the manifest file is not valid JSON", async () => {
			const deployRoot = join(tmpDir, "read-invalid-json");
			await mkdir(deployRoot, { recursive: true });
			await writeFile(join(deployRoot, ".sync-manifest.json"), "{not valid json");

			expect(await readManifest(deployRoot)).toBeNull();
		});

		it("returns null when the parsed JSON is not a pair-key -> string[] map", async () => {
			const deployRoot = join(tmpDir, "read-structurally-invalid");
			await mkdir(deployRoot, { recursive: true });
			await writeFile(
				join(deployRoot, ".sync-manifest.json"),
				JSON.stringify(["claude/skills", "not-a-map"]),
			);

			expect(await readManifest(deployRoot)).toBeNull();
		});

		it("returns null when a pair's value is not an array of strings", async () => {
			const deployRoot = join(tmpDir, "read-bad-values");
			await mkdir(deployRoot, { recursive: true });
			await writeFile(
				join(deployRoot, ".sync-manifest.json"),
				JSON.stringify({ "claude/skills": [1, 2, 3] }),
			);

			expect(await readManifest(deployRoot)).toBeNull();
		});

		it("returns the parsed map when the manifest is valid", async () => {
			const deployRoot = join(tmpDir, "read-valid");
			await mkdir(deployRoot, { recursive: true });
			const data: ManifestData = { "claude/skills": ["a", "b"] };
			await writeFile(join(deployRoot, ".sync-manifest.json"), JSON.stringify(data));

			expect(await readManifest(deployRoot)).toEqual(data);
		});
	});

	describe("writeManifest", () => {
		it("writes to {deployRoot}/.sync-manifest.json", async () => {
			const deployRoot = join(tmpDir, "write-basic");
			await mkdir(deployRoot, { recursive: true });

			await writeManifest(deployRoot, { "claude/skills": ["a"] });

			const raw = await readFile(join(deployRoot, ".sync-manifest.json"), "utf8");
			expect(JSON.parse(raw)).toEqual({ "claude/skills": ["a"] });
		});

		it("sorts entry-name arrays AND pair keys for deterministic output", async () => {
			const deployRoot = join(tmpDir, "write-sorted");
			await mkdir(deployRoot, { recursive: true });

			await writeManifest(deployRoot, {
				"codex/skills": ["zeta", "alpha", "mu"],
				"claude/agents": ["beta", "alpha"],
			});

			const raw = await readFile(join(deployRoot, ".sync-manifest.json"), "utf8");
			const parsed = JSON.parse(raw);
			// Key order itself must be deterministic (sorted), not just structurally equal —
			// the same data keyed in the opposite insertion order must serialize identically
			// (CLAUDE.md cache-safety: sorted collections before emitting).
			expect(Object.keys(parsed)).toEqual(["claude/agents", "codex/skills"]);
			expect(parsed["claude/agents"]).toEqual(["alpha", "beta"]);
			expect(parsed["codex/skills"]).toEqual(["alpha", "mu", "zeta"]);
		});
	});

	describe("computeOrphans", () => {
		it("returns names present in previous but absent from declared", () => {
			expect(computeOrphans(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
		});

		it("returns [] when nothing was previously deployed", () => {
			expect(computeOrphans([], ["a", "b"])).toEqual([]);
		});

		it("returns every previous name when nothing is declared this run", () => {
			expect(computeOrphans(["a", "b"], [])).toEqual(["a", "b"]);
		});

		it("returns [] when declared matches previous exactly (order-independent)", () => {
			expect(computeOrphans(["a", "b"], ["b", "a"])).toEqual([]);
		});
	});

	describe("removeOrphans", () => {
		it("removes an orphaned directory-form entry by exact name", async () => {
			const deployRoot = join(tmpDir, "remove-dir");
			const categoryDir = join(deployRoot, ".claude", "skills");
			await mkdir(join(categoryDir, "b"), { recursive: true });
			await writeFile(join(categoryDir, "b", "SKILL.md"), "stale skill");

			await removeOrphans(deployRoot, "claude", "skills", ["b"]);

			expect(stat(join(categoryDir, "b"))).rejects.toThrow();
		});

		it("removes an orphaned file-form entry via stem match (X.*)", async () => {
			const deployRoot = join(tmpDir, "remove-file-stem");
			const categoryDir = join(deployRoot, ".gemini", "commands");
			await mkdir(categoryDir, { recursive: true });
			await writeFile(join(categoryDir, "old-cmd.toml"), "stale");

			await removeOrphans(deployRoot, "gemini", "commands", ["old-cmd"]);

			expect(stat(join(categoryDir, "old-cmd.toml"))).rejects.toThrow();
		});

		it("never removes a foreign entry whose name only shares a prefix (intro vs introduction.md)", async () => {
			const deployRoot = join(tmpDir, "remove-prefix-safety");
			const categoryDir = join(deployRoot, ".claude", "skills");
			await mkdir(categoryDir, { recursive: true });
			await writeFile(join(categoryDir, "intro.md"), "orphan file-form");
			await writeFile(join(categoryDir, "introduction.md"), "foreign - must survive");
			await mkdir(join(categoryDir, "intro-extra"), { recursive: true });

			await removeOrphans(deployRoot, "claude", "skills", ["intro"]);

			expect(stat(join(categoryDir, "intro.md"))).rejects.toThrow();
			expect((await stat(join(categoryDir, "introduction.md"))).isFile()).toBe(true);
			expect((await stat(join(categoryDir, "intro-extra"))).isDirectory()).toBe(true);
		});

		it("is a no-op when the category directory does not exist", async () => {
			const deployRoot = join(tmpDir, "remove-no-category-dir");
			await mkdir(deployRoot, { recursive: true });

			// Should not throw
			await removeOrphans(deployRoot, "claude", "skills", ["anything"]);
		});
	});

	describe("reconcilePairManifest - safety contract", () => {
		it("bootstrap (no manifest file): preserves a foreign resident, removes nothing, and seeds the manifest from the declared set", async () => {
			const deployRoot = join(tmpDir, "reconcile-bootstrap");
			const categoryDir = join(deployRoot, ".claude", "skills");
			await mkdir(join(categoryDir, "skill-a"), { recursive: true });
			await writeFile(join(categoryDir, "skill-a", "SKILL.md"), "# skill-a");
			// Foreign resident: not OMT-managed, never appears in any manifest.
			await mkdir(join(categoryDir, "plannotator-compound"), { recursive: true });
			await writeFile(join(categoryDir, "plannotator-compound", "SKILL.md"), "# user-authored");
			const foreignBytesBefore = await readFile(
				join(categoryDir, "plannotator-compound", "SKILL.md"),
				"utf8",
			);

			// No .sync-manifest.json exists yet -> BOOTSTRAP.
			await reconcilePairManifest(deployRoot, "claude", "skills", ["skill-a"]);

			const foreignBytesAfter = await readFile(
				join(categoryDir, "plannotator-compound", "SKILL.md"),
				"utf8",
			);
			expect(foreignBytesAfter).toBe(foreignBytesBefore);
			expect((await stat(join(categoryDir, "skill-a"))).isDirectory()).toBe(true);

			expect(await readManifest(deployRoot)).toEqual({ "claude/skills": ["skill-a"] });
		});

		it("corrupt manifest: zero deletions, re-seeds from the declared set (never read as an empty deployed set)", async () => {
			const deployRoot = join(tmpDir, "reconcile-corrupt");
			const categoryDir = join(deployRoot, ".claude", "skills");
			await mkdir(join(categoryDir, "skill-a"), { recursive: true });
			// An entry recorded as OMT-deployed by some prior (corrupt) manifest state but
			// not declared this run. If corruption were misread as "empty deployed set",
			// this would incorrectly become the entire prior set minus itself; treated
			// correctly as BOOTSTRAP, it must survive because bootstrap deletes nothing.
			await mkdir(join(categoryDir, "old-entry"), { recursive: true });
			await mkdir(join(categoryDir, "plannotator-compound"), { recursive: true });
			await writeFile(join(deployRoot, ".sync-manifest.json"), "{ this is not json");

			await reconcilePairManifest(deployRoot, "claude", "skills", ["skill-a"]);

			expect((await stat(join(categoryDir, "skill-a"))).isDirectory()).toBe(true);
			expect((await stat(join(categoryDir, "old-entry"))).isDirectory()).toBe(true);
			expect((await stat(join(categoryDir, "plannotator-compound"))).isDirectory()).toBe(true);

			expect(await readManifest(deployRoot)).toEqual({ "claude/skills": ["skill-a"] });
		});

		it("orphan-only removal: prior manifest [a,b], declared [a] this run -> only b removed", async () => {
			const deployRoot = join(tmpDir, "reconcile-orphan-only");
			const categoryDir = join(deployRoot, ".claude", "skills");
			await mkdir(join(categoryDir, "a"), { recursive: true });
			await writeFile(join(categoryDir, "a", "SKILL.md"), "# a - must survive");
			await mkdir(join(categoryDir, "b"), { recursive: true });
			await mkdir(join(categoryDir, "plannotator-compound"), { recursive: true });
			await writeFile(
				join(deployRoot, ".sync-manifest.json"),
				JSON.stringify({ "claude/skills": ["a", "b"] }),
			);

			await reconcilePairManifest(deployRoot, "claude", "skills", ["a"]);

			expect(stat(join(categoryDir, "b"))).rejects.toThrow();
			expect(await readFile(join(categoryDir, "a", "SKILL.md"), "utf8")).toBe(
				"# a - must survive",
			);
			expect((await stat(join(categoryDir, "plannotator-compound"))).isDirectory()).toBe(true);

			expect(await readManifest(deployRoot)).toEqual({ "claude/skills": ["a"] });
		});

		it("preserves other pairs' manifest entries untouched by this reconcile call", async () => {
			const deployRoot = join(tmpDir, "reconcile-preserve-other-pairs");
			await mkdir(join(deployRoot, ".claude", "skills", "x"), { recursive: true });
			await writeFile(
				join(deployRoot, ".sync-manifest.json"),
				JSON.stringify({ "claude/skills": ["x"], "codex/scripts": ["y"] }),
			);

			await reconcilePairManifest(deployRoot, "claude", "skills", ["x"]);

			expect(await readManifest(deployRoot)).toEqual({
				"claude/skills": ["x"],
				"codex/scripts": ["y"],
			});
		});
	});
});
