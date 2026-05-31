import { describe, test, expect } from "bun:test";
import { validate } from "./validator.ts";
import type { Entity } from "./types.ts";

// Minimal valid canonical entity (post-compat shape: no slug/kind, has id/type/source/tier/created_at)
function makeEntity(overrides: Partial<Entity["frontmatter"]> = {}): Entity {
  return {
    frontmatter: {
      id: "code-hello-world",
      type: "code",
      source: "github",
      tier: "2",
      created_at: "2024-01-01T00:00:00Z",
      authority: "toong",
      source_url: "https://github.com/example",
      tags: "backend,infra",
      sensitivity: "shared",
      status: "active",
      updated_at: "2024-01-01T00:00:00Z",
      checked_at: "2024-01-01T00:00:00Z",
      relations: [],
      ...overrides,
    },
    body: "## 한 줄 요지\n본문",
  };
}

describe("validate", () => {
  test("unknown type", async () => {
    const entity = makeEntity({ type: "bogus" as any });
    const result = await validate(entity);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("unknown_type");
    }
  });

  test("missing field", async () => {
    // Remove a required field (tier is required for all types)
    const entity = makeEntity();
    delete (entity.frontmatter as any).tier;
    const result = await validate(entity);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("missing_field");
      // The missing field name should appear in the message
      expect(result.message).toContain("tier");
    }
  });

  test("relation domain", async () => {
    // 'documents' has domain [doc, decision]; a 'code'-typed entity emitting it violates domain
    const entity = makeEntity({
      type: "code",
      relations: [{ target: "doc-some-ref", type: "documents" }],
    });
    const result = await validate(entity);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("relation_domain_violation");
      // Distinct from other reasons
      expect(result.reason).not.toBe("unknown_type");
      expect(result.reason).not.toBe("missing_field");
    }
  });

  test("related_to unconstrained", async () => {
    // person with related_to to an arbitrary target — must pass regardless of source type
    const entity = makeEntity({
      type: "person",
      relations: [
        { target: "code-any-target", type: "related_to" },
        { target: "concept-something-else", type: "related_to" },
      ],
    });
    const result = await validate(entity);
    expect(result.valid).toBe(true);
  });

  test("relation range violation — doc as target of 'documents' relation", async () => {
    // 'documents' has range [code, concept, reference, person, decision] — excludes 'doc'
    // A doc-typed entity emitting documents→doc must be rejected when a type resolver is provided
    const targetTypeMap = new Map<string, string>([["doc-some-target", "doc"]]);
    const entity = makeEntity({
      type: "doc",
      relations: [{ target: "doc-some-target", type: "documents" }],
    });
    const result = await validate(entity, targetTypeMap);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("relation_range_violation");
      expect(result.reason).not.toBe("relation_domain_violation");
    }
  });

  test("relation range — valid target passes", async () => {
    // 'documents' allows code as target; doc→code must pass
    const targetTypeMap = new Map<string, string>([["code-some-target", "code"]]);
    const entity = makeEntity({
      type: "doc",
      relations: [{ target: "code-some-target", type: "documents" }],
    });
    const result = await validate(entity, targetTypeMap);
    expect(result.valid).toBe(true);
  });

  test("relation range — no resolver skips range check (backward compatible)", async () => {
    // Without resolver, range is not checked — same doc→doc edge must pass
    const entity = makeEntity({
      type: "doc",
      relations: [{ target: "doc-some-target", type: "documents" }],
    });
    const result = await validate(entity);
    expect(result.valid).toBe(true);
  });

  test("legacy regression", async () => {
    // Fixture mimicking a real legacy pin AFTER compat translation.
    // Canonical shape: id, type, source, tier, created_at, relations[], authority, sensitivity, source_url, tags
    // NO slug, NO kind (those are forbidden fields and must NOT be present)
    const entity: Entity = {
      frontmatter: {
        id: "reference-linear-some-pin",
        type: "reference",
        source: "linear",
        tier: "2",
        created_at: "2024-03-15T09:00:00Z",
        authority: "toong",
        source_url: "https://linear.app/algocare/issue/ENG-1234",
        tags: "backend,architecture",
        sensitivity: "shared",
        status: "active",
        updated_at: "2024-03-15T09:00:00Z",
        checked_at: "2024-03-15T09:00:00Z",
        relations: [
          { target: "concept-domain-model", type: "related_to" },
        ],
      },
      body: "## 한 줄 요지\n설명",
    };
    const result = await validate(entity);
    expect(result.valid).toBe(true);
  });
});
