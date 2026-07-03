import { readFileSync } from "fs";
import { join } from "path";
import type { EntityType } from "./types.ts";
import { parseYamlStrict } from "./yaml";

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
	if (!("id_pattern" in raw) || typeof raw.id_pattern !== "string") {
		throw new Error("tbox.yaml schema validation failed: id_pattern must be a string");
	}
	if (
		!("enums" in raw) ||
		raw.enums === null ||
		typeof raw.enums !== "object" ||
		Array.isArray(raw.enums)
	) {
		throw new Error("tbox.yaml schema validation failed: enums must be a mapping");
	}
	if (
		!("entity_types" in raw) ||
		raw.entity_types === null ||
		typeof raw.entity_types !== "object" ||
		Array.isArray(raw.entity_types)
	) {
		throw new Error("tbox.yaml schema validation failed: entity_types must be a mapping");
	}
	if (
		!("relation_types" in raw) ||
		raw.relation_types === null ||
		typeof raw.relation_types !== "object" ||
		Array.isArray(raw.relation_types)
	) {
		throw new Error("tbox.yaml schema validation failed: relation_types must be a mapping");
	}
}

export async function parseTboxYaml(filePath: string): Promise<Tbox> {
	const text = readFileSync(filePath, "utf8");
	const raw = parseYamlStrict(text);
	assertTboxShape(raw);
	return {
		id_pattern: raw.id_pattern,
		enums: raw.enums,
		body_sections: raw.body_sections,
		entity_types: raw.entity_types,
		// relation_types' domain/range are plain string[] in the raw YAML shape;
		// membership against EntityType is enforced downstream by validator.ts, not here.
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- opaque tbox.yaml boundary; domain/range enum membership validated downstream
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
