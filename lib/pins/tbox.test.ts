import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const TBOX_PATH = join(import.meta.dir, "tbox.yaml");

function loadTbox(): Record<string, unknown> {
	const raw = readFileSync(TBOX_PATH, "utf8");
	return Bun.YAML.parse(raw) as Record<string, unknown>;
}

describe("schema completeness", () => {
	const tbox = loadTbox();

	const EXPECTED_ENTITY_TYPES = ["code", "doc", "concept", "reference", "person", "decision"];
	const EXPECTED_RELATION_TYPES = [
		"related_to",
		"supersedes",
		"superseded_by",
		"duplicates",
		"derived_from",
		"documents",
	];
	const CONSTRAINED_RELATIONS = [
		"supersedes",
		"superseded_by",
		"duplicates",
		"derived_from",
		"documents",
	];

	test("all 6 entity_types exist", () => {
		const entityTypes = tbox.entity_types as Record<string, unknown>;
		for (const et of EXPECTED_ENTITY_TYPES) {
			expect(entityTypes).toHaveProperty(et);
		}
	});

	test("each entity_type has a required_axiom array", () => {
		const entityTypes = tbox.entity_types as Record<string, { required_axiom: unknown }>;
		for (const et of EXPECTED_ENTITY_TYPES) {
			expect(Array.isArray(entityTypes[et].required_axiom)).toBe(true);
			expect((entityTypes[et].required_axiom as unknown[]).length).toBeGreaterThan(0);
		}
	});

	test("each entity_type has a forbidden_axiom array", () => {
		const entityTypes = tbox.entity_types as Record<string, { forbidden_axiom: unknown }>;
		for (const et of EXPECTED_ENTITY_TYPES) {
			expect(Array.isArray(entityTypes[et].forbidden_axiom)).toBe(true);
			expect((entityTypes[et].forbidden_axiom as unknown[]).length).toBeGreaterThan(0);
		}
	});

	test("all 6 relation_types exist", () => {
		const relationTypes = tbox.relation_types as Record<string, unknown>;
		for (const rt of EXPECTED_RELATION_TYPES) {
			expect(relationTypes).toHaveProperty(rt);
		}
	});

	test("5 constrained relations each declare domain and range", () => {
		const relationTypes = tbox.relation_types as Record<
			string,
			{ domain?: unknown; range?: unknown }
		>;
		for (const rt of CONSTRAINED_RELATIONS) {
			expect(relationTypes[rt]).toHaveProperty("domain");
			expect(relationTypes[rt]).toHaveProperty("range");
			expect(Array.isArray(relationTypes[rt].domain)).toBe(true);
			expect(Array.isArray(relationTypes[rt].range)).toBe(true);
		}
	});

	test("related_to is unconstrained — carries NO domain or range", () => {
		const relationTypes = tbox.relation_types as Record<string, Record<string, unknown>>;
		const relatedTo = relationTypes["related_to"];
		expect(relatedTo).not.toHaveProperty("domain");
		expect(relatedTo).not.toHaveProperty("range");
	});
});

describe("id pattern collision suffix", () => {
	function getPattern(): RegExp {
		const tbox = loadTbox();
		const pattern = (tbox as Record<string, unknown>)["id_pattern"] as string;
		return new RegExp(pattern);
	}

	test("notion-x-y-143022-2 is VALID (collision suffix)", () => {
		const re = getPattern();
		expect(re.test("notion-x-y-143022-2")).toBe(true);
	});

	test("linear-b2c-4786 is VALID (real legacy slug)", () => {
		const re = getPattern();
		expect(re.test("linear-b2c-4786")).toBe(true);
	});

	test("slack-channel-software-12-1 is VALID (real legacy slug)", () => {
		const re = getPattern();
		expect(re.test("slack-channel-software-12-1")).toBe(true);
	});

	test("finding-opensearch-typeless-173606 is VALID (6-digit trailing segment)", () => {
		const re = getPattern();
		expect(re.test("finding-opensearch-typeless-173606")).toBe(true);
	});

	test('"Bad Id!" is INVALID', () => {
		const re = getPattern();
		expect(re.test("Bad Id!")).toBe(false);
	});
});
