import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";
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

export async function parseTboxYaml(filePath: string): Promise<Tbox> {
  const text = readFileSync(filePath, "utf8");
  const raw = parseYaml(text) as RawTbox;
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

export function loadTbox(): Promise<Tbox> {
  return parseTboxYaml(TBOX_PATH);
}
