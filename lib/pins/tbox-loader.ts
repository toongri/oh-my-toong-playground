import { readFileSync } from "fs";
import { join } from "path";
import type { EntityType } from "./types.ts";

// ── Raw YAML shape ────────────────────────────────────────────────────────────

interface RawEntityTypeDef {
  required_axiom: string[];
  forbidden_axiom: string[];
}

interface RawRelationTypeDef {
  domain?: string[];
  range?: string[];
}

interface RawTbox {
  id_pattern: string;
  enums: {
    tier: string[];
    source: string[];
    sensitivity: string[];
    status: string[];
  };
  body_sections: string[];
  entity_types: Record<string, RawEntityTypeDef>;
  relation_types: Record<string, RawRelationTypeDef>;
}

// ── Public output types ───────────────────────────────────────────────────────

export interface EntityTypeDef {
  required_axiom: string[];
  forbidden_axiom: string[];
}

export interface RelationTypeDef {
  domain?: EntityType[];
  range?: EntityType[];
}

export interface TboxEnums {
  tier: string[];
  source: string[];
  sensitivity: string[];
  status: string[];
}

export interface Tbox {
  id_pattern: string;
  enums: TboxEnums;
  body_sections: string[];
  entity_types: Record<string, EntityTypeDef>;
  relation_types: Record<string, RelationTypeDef>;
}

// ── Core parse helper (parameterised path — enables testing with fixtures) ────

function assertTboxShape(raw: unknown): asserts raw is RawTbox {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("tbox.yaml schema validation failed: top-level value must be a mapping");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id_pattern !== "string") {
    throw new Error("tbox.yaml schema validation failed: id_pattern must be a string");
  }
  if (r.enums === null || typeof r.enums !== "object" || Array.isArray(r.enums)) {
    throw new Error("tbox.yaml schema validation failed: enums must be a mapping");
  }
  if (r.entity_types === null || typeof r.entity_types !== "object" || Array.isArray(r.entity_types)) {
    throw new Error("tbox.yaml schema validation failed: entity_types must be a mapping");
  }
  if (r.relation_types === null || typeof r.relation_types !== "object" || Array.isArray(r.relation_types)) {
    throw new Error("tbox.yaml schema validation failed: relation_types must be a mapping");
  }
}

export async function parseTboxYaml(filePath: string): Promise<Tbox> {
  const text = readFileSync(filePath, "utf8");
  const raw = Bun.YAML.parse(text);
  assertTboxShape(raw);
  return {
    id_pattern: raw.id_pattern,
    enums: raw.enums,
    body_sections: raw.body_sections,
    entity_types: raw.entity_types as unknown as Record<string, EntityTypeDef>,
    relation_types: raw.relation_types as unknown as Record<string, RelationTypeDef>,
  };
}

// ── Default loader — resolves tbox.yaml relative to this module ───────────────

const TBOX_PATH = join(import.meta.dir, "tbox.yaml");

// tbox.yaml is immutable for the process lifetime; parse it once and reuse.
let tboxPromise: Promise<Tbox> | undefined;

export function loadTbox(): Promise<Tbox> {
  return (tboxPromise ??= parseTboxYaml(TBOX_PATH));
}
