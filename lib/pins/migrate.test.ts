import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parse } from "./entity.ts";
import { migrate } from "./migrate.ts";
import { validate } from "./validator.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Writes a legacy-shaped .md file: slug-keyed frontmatter, no id/type fields.
 * Represents the flat-pin format consumed by the migration pipeline.
 */
function writeLegacyPin(
	dir: string,
	filename: string,
	opts: {
		slug: string;
		source_url?: string;
		authority?: string;
		tier?: string;
		tags?: string;
		sensitivity?: string;
		created_at?: string;
		related?: string;
		discovery_context?: string;
		body?: string;
	},
): string {
	const {
		slug,
		source_url = "https://example.com",
		authority = "someone",
		tier = "2",
		tags = "test",
		sensitivity = "shared",
		created_at = "2025-01-15T10:00:00Z",
		related,
		discovery_context,
		body = "## 한 줄 요지\n\n요지\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음",
	} = opts;

	const lines: string[] = [
		"---",
		`slug: ${slug}`,
		`source_url: ${source_url}`,
		`authority: ${authority}`,
		`tier: "${tier}"`,
		`tags: "${tags}"`,
		`sensitivity: ${sensitivity}`,
		`created_at: ${created_at}`,
	];
	if (related !== undefined) lines.push(`related: "${related}"`);
	if (discovery_context !== undefined) lines.push(`discovery_context: "${discovery_context}"`);
	lines.push("---", "", body, "");

	const content = lines.join("\n");
	const filePath = join(dir, filename);
	writeFileSync(filePath, content, "utf8");
	return filePath;
}

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let pinsDir: string;

beforeEach(() => {
	tmpDir = join(tmpdir(), `pins-migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	pinsDir = join(tmpDir, "pins");
	mkdirSync(pinsDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests: opt-in 1-shot migration ───────────────────────────────────────────

describe("migrate", () => {
	test("writes .bak sibling before rewriting canonical", async () => {
		writeLegacyPin(pinsDir, "notion-auth-doc.md", {
			slug: "notion-auth-doc",
		});

		await migrate({ location: pinsDir });

		const bakPath = join(pinsDir, "notion-auth-doc.md.bak");
		expect(existsSync(bakPath)).toBe(true);

		// .bak must contain the original legacy content (slug field, no type)
		const bak = readFileSync(bakPath, "utf8");
		expect(bak).toContain("slug: notion-auth-doc");
		expect(bak).not.toContain("type:");
	});

	test("migrated file has canonical frontmatter (type present, slug absent)", async () => {
		writeLegacyPin(pinsDir, "notion-auth-doc.md", {
			slug: "notion-auth-doc",
		});

		await migrate({ location: pinsDir });

		const canonicalPath = join(pinsDir, "notion-auth-doc.md");
		const content = readFileSync(canonicalPath, "utf8");
		const entity = parse(content);

		expect(entity.frontmatter.type).toBeDefined();
		expect((entity.frontmatter as unknown as Record<string, unknown>)["slug"]).toBeUndefined();
	});

	test("checked_at equals created_at for migrated entities", async () => {
		const createdAt = "2025-03-10T08:00:00Z";
		writeLegacyPin(pinsDir, "github-repo-pr.md", {
			slug: "github-repo-pr",
			created_at: createdAt,
		});

		await migrate({ location: pinsDir });

		const content = readFileSync(join(pinsDir, "github-repo-pr.md"), "utf8");
		const entity = parse(content);
		expect(entity.frontmatter.checked_at).toBe(createdAt);
	});

	test("skips already-canonical files (type present → no re-migrate, no double .bak)", async () => {
		// Write a file that already has type (canonical)
		writeLegacyPin(pinsDir, "notion-auth-doc.md", {
			slug: "notion-auth-doc",
		});

		// Migrate once to produce canonical
		await migrate({ location: pinsDir });

		// Remove .bak so we can detect if a second run creates another
		const bakPath = join(pinsDir, "notion-auth-doc.md.bak");
		rmSync(bakPath);

		// Migrate a second time — should be no-op
		await migrate({ location: pinsDir });

		// No new .bak created
		expect(existsSync(bakPath)).toBe(false);
	});

	test("processes multiple .md files in a single run", async () => {
		writeLegacyPin(pinsDir, "notion-auth-doc.md", { slug: "notion-auth-doc" });
		writeLegacyPin(pinsDir, "code-foo-bar.md", { slug: "code-foo-bar" });
		writeLegacyPin(pinsDir, "linear-proj-abc.md", { slug: "linear-proj-abc" });

		await migrate({ location: pinsDir });

		for (const filename of ["notion-auth-doc.md", "code-foo-bar.md", "linear-proj-abc.md"]) {
			const content = readFileSync(join(pinsDir, filename), "utf8");
			const entity = parse(content);
			expect(entity.frontmatter.type).toBeDefined();
		}
	});

	test("ignores non-.md files (e.g., .bak, .escape.jsonl)", async () => {
		writeLegacyPin(pinsDir, "notion-auth-doc.md", { slug: "notion-auth-doc" });
		// Write a .bak file (should be ignored, not treated as a legacy pin)
		writeFileSync(join(pinsDir, "old.md.bak"), "some legacy content", "utf8");
		// Write escape log
		writeFileSync(join(pinsDir, ".escape.jsonl"), "{}", "utf8");

		// Should not throw when encountering non-.md files (just await — any throw fails the test)
		await migrate({ location: pinsDir });

		// Only the .md pin was migrated
		expect(existsSync(join(pinsDir, "notion-auth-doc.md.bak"))).toBe(true);
		// .bak.bak must not exist
		expect(existsSync(join(pinsDir, "old.md.bak.bak"))).toBe(false);
	});
});

// ── Tests: legacy field disposition ──────────────────────────────────────────

describe("legacy field disposition", () => {
	test("ZERO field loss: all legacy fields preserved in canonical output", async () => {
		const createdAt = "2025-06-01T12:00:00Z";
		writeLegacyPin(pinsDir, "notion-full-fixture.md", {
			slug: "notion-full-fixture",
			source_url: "https://notion.so/page/abc123",
			authority: "alice",
			tier: "1",
			tags: "db,migration,auth",
			sensitivity: "private",
			created_at: createdAt,
			related: "code-foo-bar,linear-proj-abc,github-repo-pr",
			discovery_context: "Found during DB migration investigation",
		});

		await migrate({ location: pinsDir });

		const content = readFileSync(join(pinsDir, "notion-full-fixture.md"), "utf8");
		const entity = parse(content);
		const fm = entity.frontmatter;

		// Identity
		expect(fm.id).toBe("notion-full-fixture");
		expect(fm.type).toBe("doc");
		expect(fm.source).toBe("notion");

		// Provenance
		expect(fm.authority).toBe("alice");
		expect(fm.source_url).toBe("https://notion.so/page/abc123");

		// Classification
		expect(fm.tier).toBe("1");
		expect(fm.tags).toBe("db,migration,auth");
		expect(fm.sensitivity).toBe("private");

		// Timestamps
		expect(fm.created_at).toBe(createdAt);
		expect(fm.checked_at).toBe(createdAt);

		// Optional
		expect(fm.discovery_context).toBe("Found during DB migration investigation");

		// Relations: CSV → 3 entries with type related_to
		expect(fm.relations).toHaveLength(3);
		expect(fm.relations[0]).toEqual({ target: "code-foo-bar", type: "related_to" });
		expect(fm.relations[1]).toEqual({ target: "linear-proj-abc", type: "related_to" });
		expect(fm.relations[2]).toEqual({ target: "github-repo-pr", type: "related_to" });
	});
});

// ── Tests: collision suffix yields valid id ───────────────────────────────────

describe("collision suffix yields valid id", () => {
	// id === slug === filename stem; a same-run content collision is unreachable by construction.
	// This test verifies that a pre-existing -HHMMSS-N suffixed id survives migration intact and validates.
	test("accepts an -HHMMSS-N collision-suffixed id as valid", async () => {
		writeLegacyPin(pinsDir, "finding-opensearch-typeless-173606.md", {
			slug: "finding-opensearch-typeless-173606",
		});

		await migrate({ location: pinsDir });

		const content = readFileSync(join(pinsDir, "finding-opensearch-typeless-173606.md"), "utf8");
		const entity = parse(content);

		expect(entity.frontmatter.id).toBe("finding-opensearch-typeless-173606");

		const result = await validate(entity);
		expect(result.valid).toBe(true);
	});
});

// ── Tests: collision id-derivation (same-slug legacy files → distinct ids) ────

describe("collision id-derivation", () => {
	test("collision pair distinct files", async () => {
		// Two legacy files share the SAME slug; the second carries the legacy
		// collision suffix in its filename stem. They must migrate to DISTINCT
		// canonical files (no overwrite / data loss).
		writeLegacyPin(pinsDir, "notion-auth-foo.md", {
			slug: "notion-auth-foo",
			body: "## 한 줄 요지\n\nBODY-A\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음",
		});
		writeLegacyPin(pinsDir, "notion-auth-foo-143022.md", {
			slug: "notion-auth-foo",
			body: "## 한 줄 요지\n\nBODY-B\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음",
		});

		await migrate({ location: pinsDir });

		const pathA = join(pinsDir, "notion-auth-foo.md");
		const pathB = join(pinsDir, "notion-auth-foo-143022.md");
		expect(existsSync(pathA)).toBe(true);
		expect(existsSync(pathB)).toBe(true);

		const entityA = parse(readFileSync(pathA, "utf8"));
		const entityB = parse(readFileSync(pathB, "utf8"));

		// Distinct ids derived from the filename stem.
		expect(entityA.frontmatter.id).toBe("notion-auth-foo");
		expect(entityB.frontmatter.id).toBe("notion-auth-foo-143022");
		expect(entityA.frontmatter.id).not.toBe(entityB.frontmatter.id);

		// Both ids pass validation.
		expect((await validate(entityA)).valid).toBe(true);
		expect((await validate(entityB)).valid).toBe(true);

		// Each body traces to its origin (no duplication/overwrite).
		expect(entityA.body).toContain("BODY-A");
		expect(entityA.body).not.toContain("BODY-B");
		expect(entityB.body).toContain("BODY-B");
		expect(entityB.body).not.toContain("BODY-A");
	});

	test("collision triple distinct ids", async () => {
		// A 3-file same-slug set including a -HHMMSS-N counter form.
		writeLegacyPin(pinsDir, "notion-auth-foo.md", {
			slug: "notion-auth-foo",
			body: "## 한 줄 요지\n\nBODY-A\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음",
		});
		writeLegacyPin(pinsDir, "notion-auth-foo-143022.md", {
			slug: "notion-auth-foo",
			body: "## 한 줄 요지\n\nBODY-B\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음",
		});
		writeLegacyPin(pinsDir, "notion-auth-foo-143022-1.md", {
			slug: "notion-auth-foo",
			body: "## 한 줄 요지\n\nBODY-C\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음",
		});

		await migrate({ location: pinsDir });

		const ids = ["notion-auth-foo", "notion-auth-foo-143022", "notion-auth-foo-143022-1"].map(
			(stem) => {
				const p = join(pinsDir, `${stem}.md`);
				expect(existsSync(p)).toBe(true);
				return parse(readFileSync(p, "utf8")).frontmatter.id;
			},
		);

		// 3 distinct canonical ids, each matching its stem.
		expect(ids).toEqual(["notion-auth-foo", "notion-auth-foo-143022", "notion-auth-foo-143022-1"]);
		expect(new Set(ids).size).toBe(3);
	});

	test("collision pair idempotent rerun", async () => {
		writeLegacyPin(pinsDir, "notion-auth-foo.md", {
			slug: "notion-auth-foo",
			body: "## 한 줄 요지\n\nBODY-A\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음",
		});
		writeLegacyPin(pinsDir, "notion-auth-foo-143022.md", {
			slug: "notion-auth-foo",
			body: "## 한 줄 요지\n\nBODY-B\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\n컨텍스트\n\n## 관련 cross-link\n\n없음",
		});

		await migrate({ location: pinsDir });

		const pathA = join(pinsDir, "notion-auth-foo.md");
		const pathB = join(pinsDir, "notion-auth-foo-143022.md");
		const canonicalA1 = readFileSync(pathA, "utf8");
		const canonicalB1 = readFileSync(pathB, "utf8");
		const bakA1 = readFileSync(join(pinsDir, "notion-auth-foo.md.bak"), "utf8");
		const bakB1 = readFileSync(join(pinsDir, "notion-auth-foo-143022.md.bak"), "utf8");

		// Second run: both files now have `type` → skipped (no re-convert, no content change).
		await migrate({ location: pinsDir });

		expect(readFileSync(pathA, "utf8")).toBe(canonicalA1);
		expect(readFileSync(pathB, "utf8")).toBe(canonicalB1);
		expect(readFileSync(join(pinsDir, "notion-auth-foo.md.bak"), "utf8")).toBe(bakA1);
		expect(readFileSync(join(pinsDir, "notion-auth-foo-143022.md.bak"), "utf8")).toBe(bakB1);

		// No second .bak generation (no .bak.bak).
		expect(existsSync(join(pinsDir, "notion-auth-foo.md.bak.bak"))).toBe(false);
		expect(existsSync(join(pinsDir, "notion-auth-foo-143022.md.bak.bak"))).toBe(false);
	});

	test("collision migrated created_at preserved", async () => {
		const createdAt = "2025-04-20T09:30:00Z";
		writeLegacyPin(pinsDir, "notion-auth-foo.md", {
			slug: "notion-auth-foo",
			created_at: "2025-01-01T00:00:00Z",
		});
		writeLegacyPin(pinsDir, "notion-auth-foo-143022.md", {
			slug: "notion-auth-foo",
			created_at: createdAt,
		});

		await migrate({ location: pinsDir });

		const entityB = parse(readFileSync(join(pinsDir, "notion-auth-foo-143022.md"), "utf8"));
		// The collision file's created_at equals its own legacy created_at.
		expect(entityB.frontmatter.created_at).toBe(createdAt);
	});

	test("collision pair resumed partial run", async () => {
		// Simulate a crashed run: file A is ALREADY canonical, file B is still legacy.
		writeLegacyPin(pinsDir, "notion-auth-foo.md", {
			slug: "notion-auth-foo",
		});
		writeLegacyPin(pinsDir, "notion-auth-foo-143022.md", {
			slug: "notion-auth-foo",
		});
		// Pre-migrate only file A (canonicalize it in place).
		await migrate({ location: pinsDir });
		// Sanity: A is canonical now.
		expect(
			parse(readFileSync(join(pinsDir, "notion-auth-foo.md"), "utf8")).frontmatter.type,
		).toBeDefined();

		// Now overwrite B back to legacy shape (simulating B never got migrated before the crash).
		writeLegacyPin(pinsDir, "notion-auth-foo-143022.md", {
			slug: "notion-auth-foo",
		});

		// Resume: A is skipped (has type), B migrates.
		await migrate({ location: pinsDir });

		const entityA = parse(readFileSync(join(pinsDir, "notion-auth-foo.md"), "utf8"));
		const entityB = parse(readFileSync(join(pinsDir, "notion-auth-foo-143022.md"), "utf8"));

		expect(entityA.frontmatter.id).toBe("notion-auth-foo");
		expect(entityB.frontmatter.id).toBe("notion-auth-foo-143022");
		expect(entityA.frontmatter.id).not.toBe(entityB.frontmatter.id);
	});
});

// ── Tests: idempotent (re-run is a no-op) ────────────────────────────────────

describe("idempotent re-run", () => {
	test("migrate twice: 2nd run is a no-op (no double .bak, no re-migrate)", async () => {
		writeLegacyPin(pinsDir, "code-hello-world.md", {
			slug: "code-hello-world",
			created_at: "2025-05-01T00:00:00Z",
		});

		await migrate({ location: pinsDir });

		// Capture state after first run
		const bakPath = join(pinsDir, "code-hello-world.md.bak");
		const canonicalAfterFirst = readFileSync(join(pinsDir, "code-hello-world.md"), "utf8");
		const bakAfterFirst = readFileSync(bakPath, "utf8");

		// Run second time
		await migrate({ location: pinsDir });

		// .bak is unchanged
		const bakAfterSecond = readFileSync(bakPath, "utf8");
		expect(bakAfterSecond).toBe(bakAfterFirst);

		// canonical is unchanged
		const canonicalAfterSecond = readFileSync(join(pinsDir, "code-hello-world.md"), "utf8");
		expect(canonicalAfterSecond).toBe(canonicalAfterFirst);

		// No double .bak (.bak.bak must not exist)
		expect(existsSync(join(pinsDir, "code-hello-world.md.bak.bak"))).toBe(false);
	});
});

// ── Tests: malformed YAML isolation ──────────────────────────────────────────

describe("malformed YAML isolation", () => {
	test("one malformed file does not abort migration of remaining valid files", async () => {
		// Two valid legacy pins + one malformed YAML file.
		writeLegacyPin(pinsDir, "notion-good-alpha.md", { slug: "notion-good-alpha" });
		writeLegacyPin(pinsDir, "notion-good-beta.md", { slug: "notion-good-beta" });
		// Malformed YAML: invalid structure that parseYaml throws on.
		writeFileSync(
			join(pinsDir, "bad-yaml-broken.md"),
			"---\nslug: bad-yaml-broken\nbroken: {unclosed: [bracket\n---\n\nbody text\n",
			"utf8",
		);

		// Must NOT throw — migrate() survives the malformed file.
		await expect(migrate({ location: pinsDir })).resolves.toBeUndefined();

		// Both valid files were migrated successfully.
		expect(
			parse(readFileSync(join(pinsDir, "notion-good-alpha.md"), "utf8")).frontmatter.type,
		).toBeDefined();
		expect(
			parse(readFileSync(join(pinsDir, "notion-good-beta.md"), "utf8")).frontmatter.type,
		).toBeDefined();

		// Malformed file was NOT written as canonical (no .bak created for it).
		expect(existsSync(join(pinsDir, "bad-yaml-broken.md.bak"))).toBe(false);
	});
});

// ── Tests: duplicate-key isolation ───────────────────────────────────────────

describe("duplicate-key isolation", () => {
	test("legacy file with duplicate frontmatter key is skipped, valid neighbours still migrate", async () => {
		// A legacy pin with a duplicate `slug:` key — parseYamlStrict must throw,
		// and the per-file catch must continue so valid neighbours still migrate.
		writeFileSync(
			join(pinsDir, "dup-key-broken.md"),
			'---\nslug: dup-key-broken\nslug: dup-key-broken-second\nsource_url: https://example.com\nauthority: someone\ntier: "2"\ntags: "test"\nsensitivity: shared\ncreated_at: 2025-01-15T10:00:00Z\n---\n\nbody\n',
			"utf8",
		);
		writeLegacyPin(pinsDir, "notion-valid-neighbour.md", { slug: "notion-valid-neighbour" });

		// Must not throw — per-file catch continues.
		await expect(migrate({ location: pinsDir })).resolves.toBeUndefined();

		// Valid neighbour was migrated.
		const content = readFileSync(join(pinsDir, "notion-valid-neighbour.md"), "utf8");
		expect(parse(content).frontmatter.type).toBeDefined();

		// Duplicate-key file was skipped (no .bak produced).
		expect(existsSync(join(pinsDir, "dup-key-broken.md.bak"))).toBe(false);
	});
});

// ── Tests: dotfile exclusion ──────────────────────────────────────────────────

describe("dotfile exclusion", () => {
	test(".hidden.md legacy file is not migrated (no .bak, no canonical rewrite)", async () => {
		// A dotfile legacy pin — should be invisible to migrate, matching index.ts policy.
		const originalContent = [
			"---",
			"slug: hidden-pin",
			"source_url: https://example.com",
			"authority: someone",
			'tier: "2"',
			'tags: "test"',
			"sensitivity: shared",
			"created_at: 2025-01-15T10:00:00Z",
			"---",
			"",
			"body",
			"",
		].join("\n");
		writeFileSync(join(pinsDir, ".hidden.md"), originalContent, "utf8");

		await migrate({ location: pinsDir });

		// No .bak sibling created.
		expect(existsSync(join(pinsDir, ".hidden.md.bak"))).toBe(false);
		// File content untouched (still legacy shape).
		expect(readFileSync(join(pinsDir, ".hidden.md"), "utf8")).toBe(originalContent);
	});
});
