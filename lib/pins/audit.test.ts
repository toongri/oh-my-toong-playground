import { describe, test, expect } from "bun:test";
import { audit } from "./audit.ts";
import type { Entity } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

// All ids must match tbox id_pattern: ^[a-z0-9]+(-[a-z0-9]+){2,} (3+ segments)
function makeEntity(
  id: string,
  overrides: Partial<Entity["frontmatter"]> = {}
): Entity {
  // source_url is unique per entity by default to avoid spurious duplicate findings
  const defaultUrl = `https://notion.so/test-${id}`;
  return {
    frontmatter: {
      id,
      type: "concept",
      source: "notion",
      authority: "test",
      source_url: defaultUrl,
      tier: "2",
      tags: "test",
      sensitivity: "shared",
      status: "active",
      updated_at: "2024-01-01T00:00:00Z",
      checked_at: "2024-01-01T00:00:00Z",
      created_at: "2024-01-01T00:00:00Z",
      relations: [],
      ...overrides,
    },
    body: "## 한 줄 요지\nbody",
  };
}

function isoOffset(base: string, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// dangling — PRIMARY detector
// ---------------------------------------------------------------------------

describe("dangling", () => {
  test("relation pointing to missing id is flagged dangling", async () => {
    // "concept-pin-missing" is not in the entity list → dangling
    const entities: Entity[] = [
      makeEntity("concept-pin-alpha", {
        relations: [{ target: "concept-pin-missing", type: "related_to" }],
      }),
      makeEntity("concept-pin-beta"),
    ];

    const report = await audit(entities);

    const dangling = report.findings.filter((f) => f.type === "dangling");
    expect(dangling.length).toBeGreaterThanOrEqual(1);
    const hit = dangling.find((f) => f.entityId === "concept-pin-alpha");
    expect(hit).toBeDefined();
    expect(hit?.targetId).toBe("concept-pin-missing");
    expect(hit?.severity).toBe("error");
  });

  test("cross-scope target relation is flagged dangling (never silently resolved)", async () => {
    // "external-node-outside" is simply absent from the in-scope entity list.
    // Audit uses entity list as scope — cross-scope targets are dangling.
    const entities: Entity[] = [
      makeEntity("scope-a-node-one", {
        relations: [{ target: "external-node-outside", type: "related_to" }],
      }),
      makeEntity("scope-a-node-two"),
    ];

    const report = await audit(entities);

    const dangling = report.findings.filter((f) => f.type === "dangling");
    expect(dangling.length).toBeGreaterThanOrEqual(1);
    const hit = dangling.find((f) => f.targetId === "external-node-outside");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
  });

  test("dangling findings are ranked first (highest-signal)", async () => {
    const baseDate = "2020-01-01T00:00:00Z";
    const now = new Date(isoOffset(baseDate, 120)); // tier2 stale (90d threshold)

    // Mix: a dangling relation + a stale entity.
    const entities: Entity[] = [
      makeEntity("concept-stale-entity", {
        tier: "2",
        created_at: baseDate,
        checked_at: baseDate,
      }),
      makeEntity("concept-dangling-source", {
        relations: [{ target: "concept-ghost-target", type: "related_to" }],
      }),
    ];

    const report = await audit(entities, { now });

    // dangling findings must appear before stale findings in the output
    const firstDanglingIndex = report.findings.findIndex(
      (f) => f.type === "dangling"
    );
    const firstStaleIndex = report.findings.findIndex(
      (f) => f.type === "stale"
    );
    // If both exist, dangling must come first
    if (firstStaleIndex !== -1) {
      expect(firstDanglingIndex).toBeLessThan(firstStaleIndex);
    }
    expect(firstDanglingIndex).not.toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// duplicate
// ---------------------------------------------------------------------------

describe("duplicate", () => {
  test("two entities sharing same source_url are flagged duplicate", async () => {
    const sharedUrl = "https://notion.so/same-page-doc";
    const entities: Entity[] = [
      makeEntity("concept-pin-xray", { source_url: sharedUrl }),
      makeEntity("concept-pin-yankee", { source_url: sharedUrl }),
      makeEntity("concept-pin-zulu", { source_url: "https://notion.so/other-page" }),
    ];

    const report = await audit(entities);

    const dupes = report.findings.filter((f) => f.type === "duplicate");
    expect(dupes.length).toBeGreaterThanOrEqual(1);
    // At least one of the two duplicate entities must be flagged
    const ids = dupes.map((f) => f.entityId);
    const hasX = ids.includes("concept-pin-xray");
    const hasY = ids.includes("concept-pin-yankee");
    expect(hasX || hasY).toBe(true);
    // severity is error
    expect(dupes[0].severity).toBe("error");
  });

  test("unique source_urls produce no duplicate findings", async () => {
    const entities: Entity[] = [
      makeEntity("concept-pin-one", { source_url: "https://a.com/one" }),
      makeEntity("concept-pin-two", { source_url: "https://b.com/two" }),
    ];

    const report = await audit(entities);

    const dupes = report.findings.filter((f) => f.type === "duplicate");
    expect(dupes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// invalid
// ---------------------------------------------------------------------------

describe("invalid", () => {
  test("entity with unknown type is flagged invalid", async () => {
    const entities: Entity[] = [
      makeEntity("concept-bad-type", { type: "bogus" as any }),
      makeEntity("concept-good-entity"),
    ];

    const report = await audit(entities);

    const invalids = report.findings.filter((f) => f.type === "invalid");
    expect(invalids.length).toBeGreaterThanOrEqual(1);
    const hit = invalids.find((f) => f.entityId === "concept-bad-type");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
  });

  test("invalid enum detected", async () => {
    // An entity with an out-of-enum tier value must surface as an invalid finding via audit
    const entities: Entity[] = [
      makeEntity("concept-bad-enum", { tier: "9" as any }),
      makeEntity("concept-good-entity"),
    ];

    const report = await audit(entities);

    const invalids = report.findings.filter((f) => f.type === "invalid");
    const hit = invalids.find((f) => f.entityId === "concept-bad-enum");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toContain("enum_violation");
  });

  test("valid entities produce no invalid findings", async () => {
    const entities: Entity[] = [
      makeEntity("concept-ok-one"),
      makeEntity("concept-ok-two"),
    ];

    const report = await audit(entities);

    const invalids = report.findings.filter((f) => f.type === "invalid");
    expect(invalids.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// stale — boundary-deterministic via injected "now"
// ---------------------------------------------------------------------------

describe("stale", () => {
  const BASE = "2024-01-01T00:00:00Z";

  test("tier2 non-reference entity at day 89 is NOT stale", async () => {
    const now = new Date(isoOffset(BASE, 89));
    const entities: Entity[] = [
      makeEntity("concept-tier2-day89", {
        tier: "2",
        type: "concept",
        created_at: BASE,
        checked_at: BASE,
      }),
    ];

    const report = await audit(entities, { now });

    const stale = report.findings.filter(
      (f) => f.type === "stale" && f.entityId === "concept-tier2-day89"
    );
    expect(stale.length).toBe(0);
  });

  test("tier2 non-reference entity at day 91 IS stale", async () => {
    const now = new Date(isoOffset(BASE, 91));
    const entities: Entity[] = [
      makeEntity("concept-tier2-day91", {
        tier: "2",
        type: "concept",
        created_at: BASE,
        checked_at: BASE,
      }),
    ];

    const report = await audit(entities, { now });

    const stale = report.findings.filter(
      (f) => f.type === "stale" && f.entityId === "concept-tier2-day91"
    );
    expect(stale.length).toBe(1);
    expect(stale[0].severity).toBe("error");
  });

  test("reference entity uses checked_at for staleness (not created_at)", async () => {
    // created_at is old (200d ago), checked_at is recent (10d ago)
    // For reference type, threshold is 90d — should NOT be stale
    const now = new Date(isoOffset(BASE, 200));
    const recentCheckedAt = isoOffset(BASE, 190); // only 10d before now
    const entities: Entity[] = [
      makeEntity("concept-ref-entity", {
        type: "reference",
        tier: "2",
        created_at: BASE,           // 200d ago — would be stale if using created_at
        checked_at: recentCheckedAt, // only 10d ago — NOT stale
      }),
    ];

    const report = await audit(entities, { now });

    const stale = report.findings.filter(
      (f) => f.type === "stale" && f.entityId === "concept-ref-entity"
    );
    expect(stale.length).toBe(0);
  });

  test("tier1 threshold is 180d", async () => {
    const now = new Date(isoOffset(BASE, 181));
    const entities: Entity[] = [
      makeEntity("concept-tier1-day181", {
        tier: "1",
        type: "concept",
        created_at: BASE,
        checked_at: BASE,
      }),
    ];

    const report = await audit(entities, { now });

    const stale = report.findings.filter(
      (f) => f.type === "stale" && f.entityId === "concept-tier1-day181"
    );
    expect(stale.length).toBe(1);
  });

  test("tier3 threshold is 30d", async () => {
    const notStaleNow = new Date(isoOffset(BASE, 29));
    const staleNow = new Date(isoOffset(BASE, 31));

    const notStaleReport = await audit(
      [makeEntity("concept-tier3-day29", {
        tier: "3",
        type: "concept",
        created_at: BASE,
        checked_at: BASE,
      })],
      { now: notStaleNow }
    );
    const staleReport = await audit(
      [makeEntity("concept-tier3-day31", {
        tier: "3",
        type: "concept",
        created_at: BASE,
        checked_at: BASE,
      })],
      { now: staleNow }
    );

    expect(
      notStaleReport.findings.filter(
        (f) => f.type === "stale" && f.entityId === "concept-tier3-day29"
      ).length
    ).toBe(0);

    expect(
      staleReport.findings.filter(
        (f) => f.type === "stale" && f.entityId === "concept-tier3-day31"
      ).length
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// orphan — severity "warning", NOT error
// ---------------------------------------------------------------------------

describe("orphan", () => {
  test("entity with no relations is flagged orphan with severity warning", async () => {
    const entities: Entity[] = [
      makeEntity("concept-lonely-pin", { relations: [] }),
      makeEntity("concept-connected-pin", {
        relations: [{ target: "concept-lonely-pin", type: "related_to" }],
      }),
    ];

    const report = await audit(entities);

    // concept-lonely-pin has no outgoing relations — orphan
    const orphans = report.findings.filter((f) => f.type === "orphan");
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    const hit = orphans.find((f) => f.entityId === "concept-lonely-pin");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("warning");
    // Must NOT be severity "error"
    expect(hit?.severity).not.toBe("error");
  });

  test("orphan is NOT a violation (error count unaffected)", async () => {
    const entities: Entity[] = [makeEntity("concept-solo-pin", { relations: [] })];

    const report = await audit(entities);

    const errors = report.findings.filter((f) => f.severity === "error");
    // concept-solo-pin is orphaned but that is not an error
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dense graph fixture — dangling-dominant, confirms multi-finding report
// ---------------------------------------------------------------------------

describe("dense graph (dangling-dominant)", () => {
  test("dense connected graph with many dangling relations produces error-dominant findings", async () => {
    const now = new Date("2024-06-01T00:00:00Z");

    // 4 entities forming a dense graph; several relations point outside the set
    const entities: Entity[] = [
      makeEntity("concept-node-alpha", {
        relations: [
          { target: "concept-node-beta", type: "related_to" },   // valid
          { target: "concept-ghost-one", type: "related_to" },   // dangling
          { target: "concept-ghost-two", type: "related_to" },   // dangling
        ],
      }),
      makeEntity("concept-node-beta", {
        relations: [
          { target: "concept-node-alpha", type: "related_to" },  // valid
          { target: "concept-node-gamma", type: "related_to" },  // valid
          { target: "concept-ghost-three", type: "related_to" }, // dangling
        ],
      }),
      makeEntity("concept-node-gamma", {
        relations: [
          { target: "concept-node-alpha", type: "related_to" },  // valid
          { target: "concept-node-delta", type: "related_to" },  // valid
        ],
      }),
      makeEntity("concept-node-delta", {
        relations: [
          { target: "concept-ghost-four", type: "related_to" },  // dangling
        ],
      }),
    ];

    const report = await audit(entities, { now });

    const dangling = report.findings.filter((f) => f.type === "dangling");
    // 4 dangling relations across the graph
    expect(dangling.length).toBe(4);

    const errors = report.findings.filter((f) => f.severity === "error");
    const warnings = report.findings.filter((f) => f.severity === "warning");

    // dangling findings dominate — more errors than warnings
    expect(errors.length).toBeGreaterThan(warnings.length);
  });
});

// ---------------------------------------------------------------------------
// directory audit — buildIndex skipped entries surface as invalid findings
// ---------------------------------------------------------------------------

describe("directory audit surfaces parse-error skip", () => {
  test("parse-error file in pinsDir yields an invalid finding naming the file", async () => {
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const dir = mkdtempSync(join(tmpdir(), "pins-audit-parse-"));
    // File with no YAML frontmatter fences — triggers parse error in buildIndex
    writeFileSync(join(dir, "bad-parse.md"), "this is not valid frontmatter\n");

    const report = await audit(dir);

    const invalids = report.findings.filter((f) => f.type === "invalid");
    expect(invalids.length).toBeGreaterThanOrEqual(1);
    const hit = invalids.find((f) => f.message.includes("bad-parse.md"));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toMatch(/[Pp]arse/);
  });
});

describe("directory audit surfaces missing-id skip", () => {
  test("missing-id file in pinsDir yields an invalid finding naming the file", async () => {
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const dir = mkdtempSync(join(tmpdir(), "pins-audit-noid-"));
    // Valid frontmatter format but no `id` field — triggers missing-id skip
    const content = `---\ntype: concept\nsource: notion\n---\n\nbody\n`;
    writeFileSync(join(dir, "no-id.md"), content);

    const report = await audit(dir);

    const invalids = report.findings.filter((f) => f.type === "invalid");
    expect(invalids.length).toBeGreaterThanOrEqual(1);
    const hit = invalids.find((f) => f.message.includes("no-id.md"));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toMatch(/[Mm]issing/i);
  });
});

describe("directory audit surfaces dup-id skip", () => {
  test("duplicate-id file in pinsDir yields an invalid finding naming the file", async () => {
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const dir = mkdtempSync(join(tmpdir(), "pins-audit-dupid-"));
    // Two files with same id — second one is skipped as Duplicate id
    const validContent = (id: string) =>
      `---\nid: ${id}\ntype: concept\nsource: notion\nauthority: test\nsource_url: https://notion.so/${id}\ntier: "2"\ntags: test\nsensitivity: shared\nstatus: active\nupdated_at: "2024-01-01T00:00:00Z"\nchecked_at: "2024-01-01T00:00:00Z"\ncreated_at: "2024-01-01T00:00:00Z"\nrelations: []\n---\n\nbody\n`;
    writeFileSync(join(dir, "a-first.md"), validContent("concept-dup-shared"));
    writeFileSync(join(dir, "b-second.md"), validContent("concept-dup-shared"));

    const report = await audit(dir);

    const invalids = report.findings.filter((f) => f.type === "invalid");
    expect(invalids.length).toBeGreaterThanOrEqual(1);
    const hit = invalids.find((f) => f.message.includes("b-second.md"));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toMatch(/[Dd]uplicate/);
  });
});

// ---------------------------------------------------------------------------
// relation range — in-scope targets are range-checked; missing targets stay dangling
// ---------------------------------------------------------------------------

describe("relation range", () => {
  test("in-scope doc--documents-->doc edge is flagged invalid with reason relation_range_violation", async () => {
    // `documents` range excludes `doc` — this is a range violation
    const entities: Entity[] = [
      makeEntity("doc-source-pin", {
        type: "doc",
        relations: [{ target: "doc-target-pin", type: "documents" }],
      }),
      makeEntity("doc-target-pin", { type: "doc" }),
    ];

    const report = await audit(entities);

    const invalids = report.findings.filter((f) => f.type === "invalid");
    expect(invalids.length).toBeGreaterThanOrEqual(1);
    const hit = invalids.find((f) => f.entityId === "doc-source-pin");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toContain("relation_range_violation");
  });

  test("in-scope doc--documents-->concept edge is NOT flagged (concept is in range)", async () => {
    // `documents` range includes `concept` — must NOT produce any range-related invalid
    const entities: Entity[] = [
      makeEntity("doc-valid-source", {
        type: "doc",
        relations: [{ target: "concept-valid-target", type: "documents" }],
      }),
      makeEntity("concept-valid-target", { type: "concept" }),
    ];

    const report = await audit(entities);

    const invalids = report.findings.filter(
      (f) => f.type === "invalid" && f.entityId === "doc-valid-source"
    );
    expect(invalids.length).toBe(0);
  });

  test("missing/out-of-scope target remains dangling (NOT double-reported as range-invalid)", async () => {
    // Target is absent from corpus — dangling only, range cannot be checked
    const entities: Entity[] = [
      makeEntity("doc-dangling-source", {
        type: "doc",
        relations: [{ target: "doc-ghost-target", type: "documents" }],
      }),
    ];

    const report = await audit(entities);

    const dangling = report.findings.filter((f) => f.type === "dangling");
    expect(dangling.length).toBeGreaterThanOrEqual(1);
    const hit = dangling.find((f) => f.targetId === "doc-ghost-target");
    expect(hit).toBeDefined();

    // Must NOT also be flagged as invalid for range
    const invalids = report.findings.filter(
      (f) => f.type === "invalid" && f.entityId === "doc-dangling-source"
    );
    expect(invalids.length).toBe(0);
  });
});
