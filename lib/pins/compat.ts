/**
 * Translates a legacy pin frontmatter (FrontmatterSchema, slug-keyed) into
 * the canonical Frontmatter shape (id-keyed, with type/source/relations[]).
 *
 * This is a pure data transform — no disk I/O, no mutation.
 * Lifecycle fields (status, updated_at, checked_at) are NOT set here;
 * they are the responsibility of the record/migrate modules.
 */

import type { FrontmatterSchema } from "./legacy-types";
import type { EntityType, PinSource, Relation, Tier, Frontmatter } from "./types";

// Canonical frontmatter minus the lifecycle fields, which the record/migrate
// modules set — not compat. Derived from Frontmatter so the two never drift.
export type CompatFrontmatter = Omit<Frontmatter, "status" | "updated_at" | "checked_at">;

// Total mapping from slug-prefix (kind) to canonical {type, source}.
// Fallback for any unrecognized kind: {type:'reference', source:'url'}.
const KIND_MAP: Record<string, { type: EntityType; source: PinSource }> = {
	person: { type: "person", source: "person" },
	notion: { type: "doc", source: "notion" },
	jira: { type: "reference", source: "jira" },
	linear: { type: "reference", source: "linear" },
	slack: { type: "reference", source: "slack" },
	github: { type: "reference", source: "github" },
	code: { type: "reference", source: "code" },
	decision: { type: "decision", source: "url" },
	finding: { type: "reference", source: "url" },
	gotcha: { type: "reference", source: "url" },
	unknown: { type: "reference", source: "url" },
};

const FALLBACK: { type: EntityType; source: PinSource } = { type: "reference", source: "url" };

/**
 * Converts a legacy FrontmatterSchema into the canonical CompatFrontmatter.
 *
 * - `id` is taken from `slug` (legacy has no `id` field).
 * - `type` and `source` are derived from `slug.split('-')[0]` via KIND_MAP.
 * - `related` CSV is expanded to `relations[]` with type `"related_to"`.
 * - All other legacy fields are preserved verbatim.
 */
export function toCanonical(legacy: FrontmatterSchema): CompatFrontmatter {
	const kind = legacy.slug.split("-")[0];
	const { type, source } = KIND_MAP[kind] ?? FALLBACK;

	const relations: Relation[] = legacy.related
		? legacy.related
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
				.map((target) => ({ target, type: "related_to" }))
		: [];

	const result: CompatFrontmatter = {
		id: legacy.slug,
		type,
		source,
		authority: legacy.authority,
		source_url: legacy.source_url,
		// legacy.tier is untyped string (see legacy-types.ts TODO: not yet enumerated
		// to 'L1'|'L2'|'L3'); this boundary crossing is unavoidable until that lands.
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- legacy.tier is plain string pending enum narrowing in legacy-types.ts
		tier: legacy.tier as Tier,
		tags: legacy.tags,
		sensitivity: legacy.sensitivity,
		created_at: legacy.created_at,
		relations,
	};

	if (legacy.discovery_context !== undefined) {
		result.discovery_context = legacy.discovery_context;
	}

	return result;
}
