// Canonical TypeScript types for the pins knowledge graph.
// Additive superset of the legacy flat-pin frontmatter shape (slug-keyed, no id/type).

export type Sensitivity = "private" | "shared";
export type Tier = "1" | "2" | "3";
export type PinStatus = "active" | "superseded" | "stale";
export type PinSource =
	"jira" | "linear" | "slack" | "github" | "notion" | "code" | "person" | "url";

export type EntityType = "code" | "doc" | "concept" | "reference" | "person" | "decision";

export interface Relation {
	target: string; // id of the target entity
	type: string; // one of the relation_types keys in tbox.yaml
}

export interface Frontmatter {
	// Identity
	id: string;
	type: EntityType;

	// Provenance
	source: PinSource;
	authority: string;
	source_url: string;

	// Classification
	tier: Tier;
	tags: string; // CSV scalar (e.g. "a,b,c")
	sensitivity: Sensitivity;

	// Lifecycle (set by record/migrate modules, not by compat)
	status: PinStatus;
	updated_at: string; // ISO8601
	checked_at: string; // ISO8601

	// Timestamps
	created_at: string; // ISO8601

	// Optional
	discovery_context?: string;

	// Graph edges
	relations: Relation[];
}

export interface Entity {
	frontmatter: Frontmatter;
	body: string; // full body text (contains the 4 Korean section headers)
}
