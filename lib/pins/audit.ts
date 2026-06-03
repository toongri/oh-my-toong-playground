/**
 * READ-ONLY lint over a pin entity set.
 *
 * Detectors (ranked highest-signal first in output):
 *   1. dangling  — relation target absent from the in-scope id set (error)
 *   2. duplicate — two entities share the same source_url (error)
 *   3. invalid   — entity fails schema validate() (error)
 *   4. stale     — entity has not been refreshed within its tier threshold (error)
 *   5. orphan    — entity has no outgoing relations (warning)
 *
 * Staleness thresholds (days since the relevant timestamp):
 *   tier1 → 180d  tier2 → 90d  tier3 → 30d
 *   "reference" type: uses checked_at; all other types: uses created_at
 *
 * Inject `opts.now` to make staleness deterministic in tests.
 * The wall clock is NEVER read.
 */

import type { Entity, Tier } from "./types.ts";
import { validate } from "./validator.ts";
import { buildIndex } from "./index.ts";

// ── Finding shape ─────────────────────────────────────────────────────────────

export type FindingType = "dangling" | "duplicate" | "invalid" | "stale" | "orphan";
export type Severity = "error" | "warning";

interface BaseFinding {
  type: FindingType;
  severity: Severity;
  entityId: string;
  message: string;
}

export interface DanglingFinding extends BaseFinding {
  type: "dangling";
  severity: "error";
  targetId: string;
}

export interface DuplicateFinding extends BaseFinding {
  type: "duplicate";
  severity: "error";
  conflictsWith: string;
}

export interface InvalidFinding extends BaseFinding {
  type: "invalid";
  severity: "error";
}

export interface StaleFinding extends BaseFinding {
  type: "stale";
  severity: "error";
}

export interface OrphanFinding extends BaseFinding {
  type: "orphan";
  severity: "warning";
}

export type AuditFinding =
  | DanglingFinding
  | DuplicateFinding
  | InvalidFinding
  | StaleFinding
  | OrphanFinding;

export interface AuditReport {
  findings: AuditFinding[];
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface AuditOptions {
  /** Injected current timestamp for deterministic staleness checks. Never reads wall clock. */
  now?: Date;
}

// ── Stale thresholds (days) ───────────────────────────────────────────────────

const STALE_THRESHOLD_DAYS: Record<Tier, number> = {
  "1": 180,
  "2": 90,
  "3": 30,
};

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Audit a set of entities (or a pinsDir path) for structural issues.
 *
 * When passed a string, reads the directory via buildIndex and parses all
 * entries. When passed an Entity array, audits the provided set directly.
 *
 * Output findings are ordered: dangling first (highest-signal), then
 * duplicate, invalid, stale, orphan.
 */
export async function audit(
  input: Entity[] | string,
  opts: AuditOptions = {}
): Promise<AuditReport> {
  const { entities, skippedFindings } = await resolveEntities(input);

  // Build the in-scope id set from the provided entities
  const scopeIds = new Set(entities.map((e) => e.frontmatter.id));

  const dangling: DanglingFinding[] = detectDangling(entities, scopeIds);
  const duplicate: DuplicateFinding[] = detectDuplicate(entities);
  const invalid: InvalidFinding[] = await detectInvalid(entities);
  const stale: StaleFinding[] = detectStale(entities, opts.now);
  const orphan: OrphanFinding[] = detectOrphan(entities);

  // Ranked order: dangling > duplicate > invalid > stale > orphan
  // Skipped-file findings are included in the invalid slot (same severity).
  const findings: AuditFinding[] = [
    ...dangling,
    ...duplicate,
    ...skippedFindings,
    ...invalid,
    ...stale,
    ...orphan,
  ];

  return { findings };
}

// ── Input resolution ──────────────────────────────────────────────────────────

async function resolveEntities(
  input: Entity[] | string
): Promise<{ entities: Entity[]; skippedFindings: InvalidFinding[] }> {
  if (typeof input !== "string") {
    return { entities: input, skippedFindings: [] };
  }

  const index = buildIndex(input);

  // Detectors and validate() read only frontmatter (never body), and buildIndex
  // has already read+parsed every file — so build entities straight from the
  // index instead of re-reading and re-parsing each file.
  const entities: Entity[] = Object.values(index.entries).map((entry) => ({
    frontmatter: entry.frontmatter,
    body: "",
  }));

  // Surface all skipped files as invalid findings — one uniform path covers
  // Parse error, Missing id, Duplicate id, and Could not read file.
  const skippedFindings: InvalidFinding[] = index.skipped.map((s) => ({
    type: "invalid",
    severity: "error",
    entityId: s.file,
    message: `${s.file}: ${s.reason}`,
  }));

  return { entities, skippedFindings };
}

// ── Detectors ─────────────────────────────────────────────────────────────────

function detectDangling(entities: Entity[], scopeIds: Set<string>): DanglingFinding[] {
  const findings: DanglingFinding[] = [];

  for (const entity of entities) {
    for (const relation of entity.frontmatter.relations) {
      if (!scopeIds.has(relation.target)) {
        findings.push({
          type: "dangling",
          severity: "error",
          entityId: entity.frontmatter.id,
          targetId: relation.target,
          message: `relation target "${relation.target}" is absent from the in-scope id set`,
        });
      }
    }
  }

  return findings;
}

function detectDuplicate(entities: Entity[]): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  // Map source_url → first entity id that claimed it
  const seenUrls = new Map<string, string>();

  for (const entity of entities) {
    const url = entity.frontmatter.source_url;
    if (!url) continue;

    const existingId = seenUrls.get(url);
    if (existingId !== undefined) {
      findings.push({
        type: "duplicate",
        severity: "error",
        entityId: entity.frontmatter.id,
        conflictsWith: existingId,
        message: `source_url "${url}" is already claimed by entity "${existingId}"`,
      });
    } else {
      seenUrls.set(url, entity.frontmatter.id);
    }
  }

  return findings;
}

async function detectInvalid(entities: Entity[]): Promise<InvalidFinding[]> {
  const findings: InvalidFinding[] = [];

  // Build id → type map from the in-scope corpus so validate() can enforce range constraints.
  // Only in-scope targets are range-checked; missing targets are already handled by detectDangling.
  const targetTypes = new Map<string, string>(
    entities.map((e) => [e.frontmatter.id, e.frontmatter.type])
  );

  for (const entity of entities) {
    const result = await validate(entity, targetTypes);
    if (!result.valid) {
      findings.push({
        type: "invalid",
        severity: "error",
        entityId: entity.frontmatter.id,
        message: `${result.reason}: ${result.message}`,
      });
    }
  }

  return findings;
}

function detectStale(entities: Entity[], now?: Date): StaleFinding[] {
  const findings: StaleFinding[] = [];

  for (const entity of entities) {
    const fm = entity.frontmatter;
    const threshold = STALE_THRESHOLD_DAYS[fm.tier];

    // Pick the relevant timestamp: reference type uses checked_at (fallback to created_at), others use created_at
    const timestampStr = fm.type === "reference" ? (fm.checked_at ?? fm.created_at) : fm.created_at;
    if (!timestampStr || !now) continue;

    const from = new Date(timestampStr);
    const age = daysBetween(from, now);

    if (age > threshold) {
      findings.push({
        type: "stale",
        severity: "error",
        entityId: fm.id,
        message: `entity is ${Math.floor(age)} days old (threshold for tier${fm.tier}: ${threshold}d)`,
      });
    }
  }

  return findings;
}

function detectOrphan(entities: Entity[]): OrphanFinding[] {
  const findings: OrphanFinding[] = [];

  for (const entity of entities) {
    if (entity.frontmatter.relations.length === 0) {
      findings.push({
        type: "orphan",
        severity: "warning",
        entityId: entity.frontmatter.id,
        message: `entity has no outgoing relations`,
      });
    }
  }

  return findings;
}
