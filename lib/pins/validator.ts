import { loadTbox } from "./tbox-loader.ts";
import type { Entity, Frontmatter } from "./types.ts";

// ── Reason codes ──────────────────────────────────────────────────────────────

export type ValidationReason =
	| "unknown_type"
	| "missing_field"
	| "forbidden_field"
	| "enum_violation"
	| "unknown_relation_type"
	| "relation_domain_violation"
	| "relation_range_violation"
	| "id_pattern_violation";

// ── Result shape (mirrors legacy reason-union style) ──────────────────────────

export type ValidationResult =
	{ valid: true } | { valid: false; reason: ValidationReason; message: string };

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads a dynamically-named field off a Frontmatter object.
 *
 * Field names come from tbox.yaml (required_axiom / forbidden_axiom / enum
 * keys) and are not known at compile time, so Frontmatter — which has no
 * index signature — cannot be indexed by `field` without stepping outside
 * the static type. This is the single, isolated boundary where that happens.
 */
function getFrontmatterField(fm: Frontmatter, field: string): unknown {
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- dynamic field name from tbox.yaml schema; Frontmatter has no index signature to type this lookup
	return (fm as unknown as Record<string, unknown>)[field];
}

/**
 * Validate a single CANONICAL (new-shape) entity against the T-Box schema.
 *
 * Precondition: the entity has already been translated from legacy shape by the
 * compat module. This function never reads slug/kind as input — it only rejects
 * entities that still CARRY slug/kind as forbidden fields.
 *
 * Checks (in order):
 *   1. entity.type must be a known entity_types key.
 *   2. forbidden_axiom fields (slug, kind) must be absent.
 *   3. required_axiom fields must be present and non-empty.
 *   4. For each outgoing relation whose type has a domain constraint,
 *      the entity's own type must be in that domain.
 *      related_to is always exempt (carries no domain/range).
 *   5. For each outgoing relation whose type has a range constraint,
 *      the target entity's type must be in that range — checked only when
 *      targetTypes is provided (backward compatible: omit to skip range checks).
 *   6. (Optional) entity.id must match id_pattern if defined.
 *
 * @param entity       The canonical entity to validate.
 * @param targetTypes  Optional map of target id → entity type, used to
 *                     enforce range constraints. When absent, range is skipped.
 */
export async function validate(
	entity: Entity,
	targetTypes?: Map<string, string>,
): Promise<ValidationResult> {
	const tbox = await loadTbox();
	const fm = entity.frontmatter;

	// 1. Unknown type
	const typeDef = tbox.entity_types[fm.type];
	if (!typeDef) {
		return {
			valid: false,
			reason: "unknown_type",
			message: `entity type "${fm.type}" is not defined in the schema`,
		};
	}

	// 2. Forbidden fields must be absent
	for (const field of typeDef.forbidden_axiom) {
		if (field in fm) {
			return {
				valid: false,
				reason: "forbidden_field",
				message: `forbidden field "${field}" must not be present on a canonical entity`,
			};
		}
	}

	// 3. Required fields must be present and non-empty
	for (const field of typeDef.required_axiom) {
		const value = getFrontmatterField(fm, field);
		if (value === undefined || value === null || String(value).trim() === "") {
			return {
				valid: false,
				reason: "missing_field",
				message: `required field "${field}" is missing or empty`,
			};
		}
	}

	// 4. Closure enum constraints
	const enumEntries: [string, string[]][] = Object.entries(tbox.enums);
	for (const [field, allowed] of enumEntries) {
		const value = getFrontmatterField(fm, field);
		if (value === undefined || value === null) continue; // absent → missing_field already caught or optional
		if (!allowed.includes(String(value))) {
			return {
				valid: false,
				reason: "enum_violation",
				message: `field "${field}" value "${value}" is not in the allowed set: [${allowed.join(", ")}]`,
			};
		}
	}

	// 5. Relation domain constraints
	for (const relation of fm.relations) {
		// related_to is always exempt — no domain/range
		if (relation.type === "related_to") continue;

		const relDef = tbox.relation_types[relation.type];
		if (!relDef) {
			return {
				valid: false,
				reason: "unknown_relation_type",
				message: `relation type "${relation.type}" is not defined in the schema`,
			};
		}

		// If no domain defined, relation is unconstrained
		if (!relDef.domain || relDef.domain.length === 0) continue;

		if (!relDef.domain.includes(fm.type)) {
			return {
				valid: false,
				reason: "relation_domain_violation",
				message: `entity type "${fm.type}" is not a valid domain source for relation "${relation.type}" (allowed: ${relDef.domain.join(", ")})`,
			};
		}

		// Range check — only when caller supplies a target-type resolver
		if (targetTypes && relDef.range && relDef.range.length > 0) {
			const targetType = targetTypes.get(relation.target);
			// relDef.range is EntityType[]; targetType is a plain string resolved
			// at runtime from caller-supplied data, not guaranteed to be a member
			// of EntityType — widen to string[] for the membership check.
			const range: string[] = relDef.range;
			if (targetType !== undefined && !range.includes(targetType)) {
				return {
					valid: false,
					reason: "relation_range_violation",
					message: `target "${relation.target}" has type "${targetType}" which is not a valid range target for relation "${relation.type}" (allowed: ${relDef.range.join(", ")})`,
				};
			}
		}
	}

	// 6. id_pattern (optional — soft check)
	if (tbox.id_pattern && fm.id) {
		const pattern = new RegExp(tbox.id_pattern);
		if (!pattern.test(fm.id)) {
			return {
				valid: false,
				reason: "id_pattern_violation",
				message: `id "${fm.id}" does not match pattern ${tbox.id_pattern}`,
			};
		}
	}

	return { valid: true };
}
