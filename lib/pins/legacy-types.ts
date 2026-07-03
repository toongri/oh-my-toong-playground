import type { Sensitivity } from "./types";

// Frontmatter schema for a legacy flat-pin file: slug-keyed, no id/type fields.
// Consumed by compat readers during migration to canonical Entity format.
export interface FrontmatterSchema {
	// 7 mandatory fields
	slug: string;
	source_url: string;
	authority: string;
	tier: string; // TODO: narrow to 'L1'|'L2'|'L3' once plan enumerates values
	tags: string; // CSV scalar: comma-separated tag list in a single string (e.g. `"a,b,c"`)
	sensitivity: Sensitivity;
	created_at: string; // ISO8601
	// 3 optional fields
	related?: string; // CSV scalar: comma-separated related-slug list in a single string
	discovery_context?: string;
}
