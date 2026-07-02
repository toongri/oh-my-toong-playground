import { describe, test, expect } from "bun:test";
import { toCanonical } from "./compat";
import type { FrontmatterSchema } from "./legacy-types";

// Minimal valid legacy fixture factory
function legacyBase(slug: string): FrontmatterSchema {
	return {
		slug,
		source_url: "https://example.com",
		authority: "someone",
		tier: "2",
		tags: "a,b",
		sensitivity: "shared",
		created_at: "2024-01-01T00:00:00Z",
	};
}

describe("toCanonical", () => {
	test("slug becomes id", () => {
		const legacy: FrontmatterSchema = {
			...legacyBase("notion-auth-foo"),
		};
		const entity = toCanonical(legacy);
		expect(entity.id).toBe("notion-auth-foo");
		// Confirm there was no id on the input (proves we map slug → id)
		expect((legacy as unknown as Record<string, unknown>)["id"]).toBeUndefined();
	});

	describe("kind mapping", () => {
		test("person → {type:person, source:person}", () => {
			const e = toCanonical(legacyBase("person-john-doe"));
			expect(e.type).toBe("person");
			expect(e.source).toBe("person");
		});

		test("notion → {type:doc, source:notion}", () => {
			const e = toCanonical(legacyBase("notion-auth-doc"));
			expect(e.type).toBe("doc");
			expect(e.source).toBe("notion");
		});

		test("jira → {type:reference, source:jira}", () => {
			const e = toCanonical(legacyBase("jira-proj-123"));
			expect(e.type).toBe("reference");
			expect(e.source).toBe("jira");
		});

		test("linear → {type:reference, source:linear}", () => {
			const e = toCanonical(legacyBase("linear-proj-abc"));
			expect(e.type).toBe("reference");
			expect(e.source).toBe("linear");
		});

		test("slack → {type:reference, source:slack}", () => {
			const e = toCanonical(legacyBase("slack-chan-msg"));
			expect(e.type).toBe("reference");
			expect(e.source).toBe("slack");
		});

		test("github → {type:reference, source:github}", () => {
			const e = toCanonical(legacyBase("github-repo-pr"));
			expect(e.type).toBe("reference");
			expect(e.source).toBe("github");
		});

		test("code → {type:reference, source:code}", () => {
			const e = toCanonical(legacyBase("code-foo-bar"));
			expect(e.type).toBe("reference");
			expect(e.source).toBe("code");
		});

		test("decision → {type:decision, source:url}", () => {
			const e = toCanonical(legacyBase("decision-foo-bar"));
			expect(e.type).toBe("decision");
			expect(e.source).toBe("url");
		});

		test("finding → {type:reference, source:url}", () => {
			const e = toCanonical(legacyBase("finding-perf-issue"));
			expect(e.type).toBe("reference");
			expect(e.source).toBe("url");
		});

		test("gotcha → {type:reference, source:url}", () => {
			const e = toCanonical(legacyBase("gotcha-null-check"));
			expect(e.type).toBe("reference");
			expect(e.source).toBe("url");
		});

		test("unknown → {type:reference, source:url}", () => {
			const e = toCanonical(legacyBase("unknown-x-y"));
			expect(e.type).toBe("reference");
			expect(e.source).toBe("url");
		});

		test("unrecognized kind falls back to {type:reference, source:url} (never undefined)", () => {
			const e = toCanonical(legacyBase("xyzzy-foo-bar"));
			expect(e.type).toBeDefined();
			expect(e.source).toBeDefined();
			expect(e.type).toBe("reference");
			expect(e.source).toBe("url");
		});
	});

	describe("field preservation", () => {
		test("related CSV → relations[], discovery_context preserved, all legacy fields present", () => {
			const legacy: FrontmatterSchema = {
				...legacyBase("notion-db-setup"),
				related: "notion-auth-foo,linear-proj-abc",
				discovery_context: "Found during DB migration investigation",
			};

			const entity = toCanonical(legacy);

			// relations[] built from CSV
			expect(entity.relations).toHaveLength(2);
			expect(entity.relations[0]).toEqual({ target: "notion-auth-foo", type: "related_to" });
			expect(entity.relations[1]).toEqual({ target: "linear-proj-abc", type: "related_to" });

			// discovery_context preserved verbatim
			expect(entity.discovery_context).toBe("Found during DB migration investigation");

			// All other legacy fields preserved
			expect(entity.authority).toBe("someone");
			expect(entity.sensitivity).toBe("shared");
			expect(entity.source_url).toBe("https://example.com");
			expect(entity.created_at).toBe("2024-01-01T00:00:00Z");
			expect(entity.tier).toBe("2");
			expect(entity.tags).toBe("a,b");
		});

		test("empty related → relations is []", () => {
			const entity = toCanonical(legacyBase("notion-empty-rels"));
			expect(entity.relations).toEqual([]);
		});

		test("absent related → relations is []", () => {
			const legacy = legacyBase("notion-no-related");
			// related is not set at all
			delete (legacy as Partial<FrontmatterSchema>).related;
			const entity = toCanonical(legacy);
			expect(entity.relations).toEqual([]);
		});
	});
});
