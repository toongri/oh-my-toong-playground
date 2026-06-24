import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadTbox, parseTboxYaml } from "./tbox-loader.ts";

// ── Static assertions against the real tbox.yaml ────────────────────────────

describe("loadTbox()", () => {
  let tbox: Awaited<ReturnType<typeof loadTbox>>;

  beforeAll(async () => {
    tbox = await loadTbox();
  });

  test("id_pattern matches the tbox.yaml value", () => {
    expect(tbox.id_pattern).toBe(
      "^[a-z0-9]+(-[a-z0-9]+){2,}(-\\d{6}(-\\d+)?)?$"
    );
  });

  test("entity_types has exactly 6 keys", () => {
    expect(Object.keys(tbox.entity_types).sort()).toEqual(
      ["code", "concept", "decision", "doc", "person", "reference"]
    );
  });

  test("each entity_type has required_axiom and forbidden_axiom arrays", () => {
    for (const [name, def] of Object.entries(tbox.entity_types)) {
      expect(Array.isArray(def.required_axiom), `${name}.required_axiom`).toBe(true);
      expect(Array.isArray(def.forbidden_axiom), `${name}.forbidden_axiom`).toBe(true);
    }
  });

  test("entity_type 'code' required_axiom equals tbox.yaml value", () => {
    expect(tbox.entity_types.code.required_axiom).toEqual(
      ["id", "type", "source", "tier", "created_at"]
    );
  });

  test("entity_type 'decision' forbidden_axiom equals tbox.yaml value", () => {
    expect(tbox.entity_types.decision.forbidden_axiom).toEqual(["slug", "kind"]);
  });

  test("relation_types has exactly 6 keys", () => {
    expect(Object.keys(tbox.relation_types).sort()).toEqual(
      ["derived_from", "documents", "duplicates", "related_to", "superseded_by", "supersedes"]
    );
  });

  test("related_to has no domain or range", () => {
    const rt = tbox.relation_types.related_to;
    expect(rt.domain).toBeUndefined();
    expect(rt.range).toBeUndefined();
  });

  test("documents relation domain and range match tbox.yaml", () => {
    const rt = tbox.relation_types.documents;
    expect(rt.domain).toEqual(["doc", "decision"]);
    expect(rt.range).toEqual(["code", "concept", "reference", "person", "decision"]);
  });

  test("enums.tier equals tbox.yaml value", () => {
    expect(tbox.enums.tier).toEqual(["1", "2", "3"]);
  });

  test("enums.source equals tbox.yaml value", () => {
    expect(tbox.enums.source).toEqual(
      ["jira", "linear", "slack", "github", "notion", "code", "person", "url"]
    );
  });

  test("enums.sensitivity equals tbox.yaml value", () => {
    expect(tbox.enums.sensitivity).toEqual(["private", "shared"]);
  });

  test("enums.status equals tbox.yaml value", () => {
    expect(tbox.enums.status).toEqual(["active", "superseded", "stale"]);
  });

  test("body_sections has exactly 4 headers", () => {
    expect(tbox.body_sections).toHaveLength(4);
  });

  test("body_sections equals tbox.yaml value", () => {
    expect(tbox.body_sections).toEqual([
      "한 줄 요지",
      "SSOT 위치",
      "전후 컨텍스트",
      "관련 cross-link",
    ]);
  });
});

// ── Malformed fixture tests: schema guard must throw descriptive errors ────────

describe("parseTboxYaml() with malformed fixtures", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tbox-loader-malformed-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, content: string): Promise<string> {
    const p = join(tmpDir, name);
    await writeFile(p, content, "utf8");
    return p;
  }

  test("empty file throws schema validation error", async () => {
    const p = await writeFixture("empty.yaml", "");
    await expect(parseTboxYaml(p)).rejects.toThrow(
      /tbox\.yaml schema validation failed/
    );
  });

  test("scalar YAML throws schema validation error", async () => {
    const p = await writeFixture("scalar.yaml", "just a string");
    await expect(parseTboxYaml(p)).rejects.toThrow(
      /tbox\.yaml schema validation failed/
    );
  });

  test("missing enums throws schema validation error mentioning enums", async () => {
    const p = await writeFixture("no-enums.yaml", `
id_pattern: '^[a-z]+$'
entity_types:
  code:
    required_axiom: [id]
    forbidden_axiom: []
relation_types:
  related_to: {}
`);
    await expect(parseTboxYaml(p)).rejects.toThrow(
      /tbox\.yaml schema validation failed.*enums/
    );
  });

  test("missing entity_types throws schema validation error mentioning entity_types", async () => {
    const p = await writeFixture("no-entity-types.yaml", `
id_pattern: '^[a-z]+$'
enums:
  tier: ["1"]
  source: [github]
  sensitivity: [shared]
  status: [active]
relation_types:
  related_to: {}
`);
    await expect(parseTboxYaml(p)).rejects.toThrow(
      /tbox\.yaml schema validation failed.*entity_types/
    );
  });

  test("missing relation_types throws schema validation error mentioning relation_types", async () => {
    const p = await writeFixture("no-relation-types.yaml", `
id_pattern: '^[a-z]+$'
enums:
  tier: ["1"]
  source: [github]
  sensitivity: [shared]
  status: [active]
entity_types:
  code:
    required_axiom: [id]
    forbidden_axiom: []
`);
    await expect(parseTboxYaml(p)).rejects.toThrow(
      /tbox\.yaml schema validation failed.*relation_types/
    );
  });

  test("duplicate top-level key in tbox.yaml throws (fail-fast contract)", async () => {
    // Bun.YAML silently kept last-wins on dup keys; parseYamlStrict must throw.
    const p = await writeFixture("dup-key.yaml", `
id_pattern: '^[a-z]+$'
id_pattern: '^[a-z0-9]+$'
enums:
  tier: ["1"]
  source: [github]
  sensitivity: [shared]
  status: [active]
entity_types:
  code:
    required_axiom: [id]
    forbidden_axiom: []
relation_types:
  related_to: {}
`);
    await expect(parseTboxYaml(p)).rejects.toThrow();
  });

  test("id_pattern as number throws schema validation error mentioning id_pattern", async () => {
    const p = await writeFixture("numeric-id-pattern.yaml", `
id_pattern: 42
enums:
  tier: ["1"]
  source: [github]
  sensitivity: [shared]
  status: [active]
entity_types:
  code:
    required_axiom: [id]
    forbidden_axiom: []
relation_types:
  related_to: {}
`);
    await expect(parseTboxYaml(p)).rejects.toThrow(
      /tbox\.yaml schema validation failed.*id_pattern/
    );
  });
});

// ── Dynamic test: parseTboxYaml with a custom fixture proves no hardcoding ───

describe("parseTboxYaml() with a custom fixture", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tbox-loader-test-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("extra entity_type in fixture appears in parsed output", async () => {
    const fixturePath = join(tmpDir, "tbox-fixture.yaml");
    const fixtureContent = `
id_pattern: '^[a-z]+$'
enums:
  tier: ["1", "2"]
  source: [github]
  sensitivity: [shared]
  status: [active]
body_sections:
  - section-one
  - section-two
entity_types:
  code:
    required_axiom: [id]
    forbidden_axiom: [slug]
  custom_entity:
    required_axiom: [id, type]
    forbidden_axiom: [kind]
relation_types:
  related_to: {}
`;
    await writeFile(fixturePath, fixtureContent, "utf8");

    const result = await parseTboxYaml(fixturePath);

    // The extra entity type must appear
    expect(Object.keys(result.entity_types)).toContain("custom_entity");
    expect(result.entity_types.custom_entity.required_axiom).toEqual(["id", "type"]);

    // Standard entity must also be there
    expect(Object.keys(result.entity_types)).toContain("code");

    // Enums from fixture (NOT the real tbox)
    expect(result.enums.tier).toEqual(["1", "2"]);
    expect(result.enums.source).toEqual(["github"]);

    // body_sections from fixture
    expect(result.body_sections).toEqual(["section-one", "section-two"]);
  });
});
