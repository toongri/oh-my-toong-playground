import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { serialize } from "./entity.ts";
import type { Entity, EntityType, PinSource } from "./types.ts";
import { query } from "./query.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pins-query-test-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function makeEntity(
	id: string,
	overrides: { type?: EntityType; tags?: string; source?: PinSource } = {},
): Entity {
	return {
		frontmatter: {
			id,
			type: overrides.type ?? "concept",
			source: overrides.source ?? "notion",
			authority: "test",
			source_url: "https://example.com",
			tier: "2",
			tags: overrides.tags ?? "general",
			sensitivity: "private",
			status: "active",
			updated_at: "2024-01-01T00:00:00Z",
			checked_at: "2024-01-01T00:00:00Z",
			created_at: "2024-01-01T00:00:00Z",
			relations: [],
		},
		body: "## 무엇\n\ndef\n\n## 왜\n\nwhy\n\n## 어디서\n\nwhere\n\n## 관계\n\nnone",
	};
}

// ---------------------------------------------------------------------------
// Tests — all exercised via dir-scan (no index.json present)
// ---------------------------------------------------------------------------

describe("query", () => {
	test("dir-scan — filter by type", () => {
		const dir = makeTmpDir();
		writeFileSync(join(dir, "pin-a.md"), serialize(makeEntity("pin-a", { type: "code" })));
		writeFileSync(join(dir, "pin-b.md"), serialize(makeEntity("pin-b", { type: "doc" })));
		writeFileSync(join(dir, "pin-c.md"), serialize(makeEntity("pin-c", { type: "code" })));
		// No index.json — dir-scan only

		const results = query(dir, { type: "code" });

		expect(existsSync(join(dir, "index.json"))).toBe(false);
		expect(results.map((r) => r.frontmatter.id).sort()).toEqual(["pin-a", "pin-c"]);
	});

	test("dir-scan — filter by tag membership", () => {
		const dir = makeTmpDir();
		writeFileSync(join(dir, "pin-a.md"), serialize(makeEntity("pin-a", { tags: "alpha,beta" })));
		writeFileSync(join(dir, "pin-b.md"), serialize(makeEntity("pin-b", { tags: "beta,gamma" })));
		writeFileSync(join(dir, "pin-c.md"), serialize(makeEntity("pin-c", { tags: "delta" })));
		// No index.json — dir-scan only

		const results = query(dir, { tags: ["beta"] });

		expect(existsSync(join(dir, "index.json"))).toBe(false);
		expect(results.map((r) => r.frontmatter.id).sort()).toEqual(["pin-a", "pin-b"]);
	});

	test("dir-scan — filter by source", () => {
		const dir = makeTmpDir();
		writeFileSync(join(dir, "pin-a.md"), serialize(makeEntity("pin-a", { source: "github" })));
		writeFileSync(join(dir, "pin-b.md"), serialize(makeEntity("pin-b", { source: "slack" })));
		writeFileSync(join(dir, "pin-c.md"), serialize(makeEntity("pin-c", { source: "github" })));
		// No index.json — dir-scan only

		const results = query(dir, { source: "github" });

		expect(existsSync(join(dir, "index.json"))).toBe(false);
		expect(results.map((r) => r.frontmatter.id).sort()).toEqual(["pin-a", "pin-c"]);
	});

	test("dir-scan — combined type + tags + source", () => {
		const dir = makeTmpDir();
		writeFileSync(
			join(dir, "pin-a.md"),
			serialize(makeEntity("pin-a", { type: "code", tags: "alpha,beta", source: "github" })),
		);
		writeFileSync(
			join(dir, "pin-b.md"),
			serialize(makeEntity("pin-b", { type: "code", tags: "alpha", source: "slack" })),
		);
		writeFileSync(
			join(dir, "pin-c.md"),
			serialize(makeEntity("pin-c", { type: "doc", tags: "alpha,beta", source: "github" })),
		);
		// No index.json — dir-scan only

		const results = query(dir, { type: "code", tags: ["alpha"], source: "github" });

		expect(existsSync(join(dir, "index.json"))).toBe(false);
		expect(results.map((r) => r.frontmatter.id)).toEqual(["pin-a"]);
	});

	test("dir-scan — orphan pin with no relations is findable by type", () => {
		const dir = makeTmpDir();
		const orphan = makeEntity("orphan", { type: "decision" });
		orphan.frontmatter.relations = [];
		writeFileSync(join(dir, "orphan.md"), serialize(orphan));
		// No index.json — dir-scan only

		const results = query(dir, { type: "decision" });

		expect(existsSync(join(dir, "index.json"))).toBe(false);
		expect(results.map((r) => r.frontmatter.id)).toEqual(["orphan"]);
	});

	test("dir-scan — tag query does not crash on tagless pin and excludes it", () => {
		const dir = makeTmpDir();
		// Pin with tags
		writeFileSync(join(dir, "tagged.md"), serialize(makeEntity("tagged", { tags: "alpha" })));
		// Pin without tags field — simulate pins that passed validator before tags was required
		const tagless = makeEntity("tagless", {});
		(tagless.frontmatter as unknown as Record<string, unknown>)["tags"] = undefined;
		writeFileSync(join(dir, "tagless.md"), serialize(tagless));
		// No index.json — dir-scan only

		let results: ReturnType<typeof query>;
		expect(() => {
			results = query(dir, { tags: ["alpha"] });
		}).not.toThrow();
		expect(results!.map((r) => r.frontmatter.id)).toEqual(["tagged"]);
	});
});
