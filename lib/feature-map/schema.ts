import { parseAllDocuments, parseDocument, stringify } from "yaml";

export type FeatureEntrypoint = {
	id: string;
	kind: string;
};

export type FeatureMetadata = {
	schema_version: 1;
	id: string;
	title: string;
	aliases?: string[];
	entrypoints?: FeatureEntrypoint[];
	state_changed_by?: string[];
	state_variants?: string[];
	source_refs?: string[];
	[key: string]: unknown;
};

export type FeatureDocument = {
	metadata: FeatureMetadata;
	body: string;
};

const KNOWN_FIELDS = [
	"schema_version",
	"id",
	"title",
	"aliases",
	"entrypoints",
	"state_changed_by",
	"state_variants",
	"source_refs",
] as const;

function fail(message: string): never {
	throw new Error(`Invalid feature document: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNonblankString(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || value.trim() === "") fail(`${field} must be a nonblank string`);
}

function validateStringArray(value: unknown, field: string): asserts value is string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
		fail(`${field} must be an array of nonblank strings`);
	}
}

export function validateFeature(document: { metadata: unknown; body: unknown }): void {
	if (!isRecord(document)) fail("document must be an object");
	if (!isRecord(document.metadata)) fail("metadata must be an object");
	const metadata = document.metadata;
	if (metadata.schema_version !== 1) fail("schema_version must be 1");
	if (typeof metadata.id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(metadata.id)) {
		fail("id must be a safe lower ASCII identifier");
	}
	validateNonblankString(metadata.title, "title");
	for (const field of ["aliases", "state_changed_by", "state_variants", "source_refs"] as const) {
		if (field in metadata) validateStringArray(metadata[field], field);
	}
	if ("entrypoints" in metadata) {
		if (!Array.isArray(metadata.entrypoints)) fail("entrypoints must be an array");
		const ids = new Set<string>();
		for (const entrypoint of metadata.entrypoints) {
			if (!isRecord(entrypoint)) fail("entrypoints must contain objects");
			validateNonblankString(entrypoint.id, "entrypoint.id");
			validateNonblankString(entrypoint.kind, "entrypoint.kind");
			if (ids.has(entrypoint.id)) fail(`duplicate entrypoint id: ${entrypoint.id}`);
			ids.add(entrypoint.id);
		}
	}
	if (typeof document.body !== "string" || document.body.trim() === "") fail("body must be nonblank Markdown");
}

export function parseFeature(text: string): FeatureDocument {
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
	if (!match) fail("expected YAML frontmatter delimited by ---");
	const source = match[1];
	const documents = parseAllDocuments(source, { uniqueKeys: true });
	if (documents.length !== 1) fail("multiple YAML documents are not allowed");
	const yamlDocument = parseDocument(source, { uniqueKeys: true });
	if (yamlDocument.errors.length > 0) fail(yamlDocument.errors.map((error) => error.message).join("; "));
	const metadata = yamlDocument.toJS({ maxAliasCount: 100 });
	const body = match[2].replace(/\r\n?/g, "\n");
	const result = { metadata, body };
	validateFeature(result);
	return result;
}

export function serializeFeature(document: FeatureDocument): string {
	validateFeature(document);
	const entries: Array<[string, unknown]> = [];
	for (const field of KNOWN_FIELDS) {
		if (field in document.metadata) entries.push([field, document.metadata[field]]);
	}
	for (const field of Object.keys(document.metadata).filter((key) => !KNOWN_FIELDS.some((known) => known === key)).sort()) {
		entries.push([field, document.metadata[field]]);
	}
	const yaml = stringify(Object.fromEntries(entries), { lineWidth: 0 }).replace(/\n+$/, "");
	const body = document.body.replace(/\r\n?/g, "\n").replace(/\n*$/, "");
	return `---\n${yaml}\n---\n${body}\n`;
}
