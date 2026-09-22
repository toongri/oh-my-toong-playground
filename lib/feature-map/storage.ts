import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, lstatSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { withStateLock } from "@lib/persistent-mode-core/state-lock";
import { ensureFeatureMapManifest, type FeatureMapOptions } from "@lib/feature-map/manifest";
import { parseFeature, serializeFeature, validateFeature, type FeatureDocument, type FeatureMetadata } from "@lib/feature-map/schema";

export type FeatureSummary = { id: string; title: string; path: string; revision: string; metadata: FeatureMetadata };
export type StoredFeature = FeatureDocument & { path: string; revision: string };
export type StorageNotConfigured = { status: "not_found"; reason: "storage_not_configured"; next_action: "ask_user_for_storage"; project: string; manifestPath: string };
export type FeatureNotFound = { status: "not_found"; reason: "feature_not_found" };
export type ReadyStatus = { status: "ready"; project: string; manifestPath: string; storage: { format: "markdown-frontmatter-v1"; location: string } };
export type FeatureMapStatus = StorageNotConfigured | ReadyStatus;

function configured(options: FeatureMapOptions = {}): { context: ReturnType<typeof ensureFeatureMapManifest>["context"]; manifest: ReturnType<typeof ensureFeatureMapManifest>["manifest"]; location?: string } {
  const result = ensureFeatureMapManifest(options);
  if (result.manifest.storage === null) return result;
  const location = isAbsolute(result.manifest.storage.location)
    ? result.manifest.storage.location
    : resolve(dirname(result.context.manifestPath), result.manifest.storage.location);
  return { ...result, location };
}

function requireRoot(value: ReturnType<typeof configured>, writable = false): string {
  if (!value.location) throw new Error("feature-map: storage is not configured");
  let stats: ReturnType<typeof statSync>;
  try { stats = statSync(value.location); accessSync(value.location, writable ? constants.R_OK | constants.W_OK : constants.R_OK); }
  catch (error) { throw new Error(`feature-map: storage location is unavailable: ${value.location}`, { cause: error }); }
  if (!stats.isDirectory()) throw new Error(`feature-map: storage location is not a directory: ${value.location}`);
  return value.location;
}

function revision(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function featurePath(root: string, id: string): string { return join(root, `${id}.md`); }
function isSymlink(path: string): boolean { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } }
function listMarkdown(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).filter((entry) => !entry.name.startsWith(".") && entry.name.endsWith(".md")).map((entry) => join(root, entry.name));
}

type ReadRecord = { path: string; document: FeatureDocument; revision: string };
function readRecords(root: string): ReadRecord[] {
  const records: ReadRecord[] = [];
  const ids = new Map<string, string>();
  for (const path of listMarkdown(root)) {
    if (isSymlink(path)) throw new Error(`feature-map: symlink feature file is not allowed: ${path}`);
    const bytes = readFileSync(path);
    let document: FeatureDocument;
    try { document = parseFeature(bytes.toString("utf8")); }
    catch (error) { throw new Error(`feature-map: invalid feature file ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
    const expected = relative(root, path).replace(/\.md$/, "");
    if (document.metadata.id !== expected) throw new Error(`feature-map: filename/id mismatch: ${path}`);
    const prior = ids.get(document.metadata.id);
    if (prior) throw new Error(`feature-map: duplicate feature id ${document.metadata.id}: ${prior}, ${path}`);
    ids.set(document.metadata.id, path);
    records.push({ path, document, revision: revision(bytes) });
  }
  return records.sort((a, b) => a.document.metadata.id.localeCompare(b.document.metadata.id));
}

function notConfigured(result: ReturnType<typeof configured>): StorageNotConfigured {
  return { status: "not_found", reason: "storage_not_configured", next_action: "ask_user_for_storage", project: result.context.projectKey, manifestPath: result.context.manifestPath };
}
function summary(record: ReadRecord): FeatureSummary { return { id: record.document.metadata.id, title: record.document.metadata.title, path: record.path, revision: record.revision, metadata: record.document.metadata }; }
function stored(record: ReadRecord): StoredFeature { return { ...record.document, path: record.path, revision: record.revision }; }

export function getFeatureMapStatus(options: FeatureMapOptions = {}): FeatureMapStatus {
  const result = configured(options);
  if (!result.location) return notConfigured(result);
  const root = requireRoot(result);
  return { status: "ready", project: result.context.projectKey, manifestPath: result.context.manifestPath, storage: { format: "markdown-frontmatter-v1", location: root } };
}

export function queryFeatureMap(criteria: { text?: string; changedBy?: string } = {}, options: FeatureMapOptions = {}): { status: "ok"; features: FeatureSummary[] } | FeatureMapStatus | FeatureNotFound {
  const result = configured(options);
  if (!result.location) return notConfigured(result);
  const root = requireRoot(result);
  const text = criteria.text?.toLocaleLowerCase();
  const records = readRecords(root).filter((record) => {
    if (text && !(`${JSON.stringify(record.document.metadata)}\n${record.document.body}`).toLocaleLowerCase().includes(text)) return false;
    if (criteria.changedBy && !(record.document.metadata.state_changed_by ?? []).includes(criteria.changedBy)) return false;
    return true;
  });
  return records.length === 0 ? { status: "not_found", reason: "feature_not_found" as const } : { status: "ok" as const, features: records.map(summary) };
}

export function getFeature(id: string, options: FeatureMapOptions = {}): { status: "ok"; feature: StoredFeature } | FeatureMapStatus | FeatureNotFound {
  if (typeof id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) throw new Error("feature-map: id must be a safe lower ASCII identifier");
  const result = configured(options);
  if (!result.location) return notConfigured(result);
  const root = requireRoot(result);
  const path = featurePath(root, id);
  if (isSymlink(path)) throw new Error(`feature-map: symlink feature file is not allowed: ${path}`);
  try {
    const bytes = readFileSync(path);
    const document = parseFeature(bytes.toString("utf8"));
    if (document.metadata.id !== id) throw new Error(`feature-map: filename/id mismatch: ${path}`);
    return { status: "ok" as const, feature: stored({ path, document, revision: revision(bytes) }) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { status: "not_found" as const, reason: "feature_not_found" as const };
    throw error;
  }
}

export function saveFeature(input: FeatureDocument & { expectedRevision: string | null }, options: FeatureMapOptions = {}): { status: "ok"; feature: StoredFeature } | StorageNotConfigured | { status: "conflict"; reason: "revision_mismatch"; expectedRevision: string | null; actualRevision: string | null; path: string } {
  if (!input || typeof input !== "object" || !("expectedRevision" in input)) throw new Error("feature-map: expectedRevision is required");
  validateFeature(input);
  if (input.expectedRevision !== null && (typeof input.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedRevision))) throw new Error("feature-map: expectedRevision must be null or a SHA-256 hex string");
  const result = configured(options);
  if (!result.location) return notConfigured(result);
  const root = requireRoot(result, true);
  const path = featurePath(root, input.metadata.id);
  return withStateLock(join(root, ".feature-map-state"), () => {
    if (isSymlink(path)) throw new Error(`feature-map: symlink feature file is not allowed: ${path}`);
    let actualRevision: string | null = null;
    let exists = true;
    try { actualRevision = revision(readFileSync(path)); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") { exists = false; } else throw error; }
    if ((input.expectedRevision === null && exists) || (input.expectedRevision !== null && input.expectedRevision !== actualRevision)) return { status: "conflict" as const, reason: "revision_mismatch" as const, expectedRevision: input.expectedRevision, actualRevision, path };
    const bytes = Buffer.from(serializeFeature(input), "utf8");
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    try { writeFileSync(temporary, bytes, { flag: "wx" }); renameSync(temporary, path); }
    finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
    return { status: "ok" as const, feature: { ...parseFeature(bytes.toString("utf8")), path, revision: revision(bytes) } };
  });
}

export function validateFeatureMap(options: FeatureMapOptions = {}): { status: "valid" | "invalid"; issues: Array<{ path?: string; id?: string; message: string }>; feature_count: number } | StorageNotConfigured {
  const result = configured(options);
  if (!result.location) return notConfigured(result);
  const root = requireRoot(result);
  const issues: Array<{ path?: string; id?: string; message: string }> = [];
  const records: ReadRecord[] = [];
  const ids = new Set<string>();
  for (const path of listMarkdown(root)) {
    if (isSymlink(path)) { issues.push({ path, message: "symlink feature file is not allowed" }); continue; }
    let document: FeatureDocument;
    try { document = parseFeature(readFileSync(path, "utf8")); }
    catch (error) { issues.push({ path, message: error instanceof Error ? error.message : String(error) }); continue; }
    const expected = relative(root, path).replace(/\.md$/, "");
    if (document.metadata.id !== expected) issues.push({ path, id: document.metadata.id, message: "filename/id mismatch" });
    if (ids.has(document.metadata.id)) issues.push({ path, id: document.metadata.id, message: "duplicate feature id" });
    ids.add(document.metadata.id);
    records.push({ path, document, revision: revision(readFileSync(path)) });
  }
  for (const record of records) for (const ref of record.document.metadata.state_changed_by ?? []) if (!ids.has(ref)) issues.push({ path: record.path, id: record.document.metadata.id, message: `dangling state_changed_by reference: ${ref}` });
  return { status: issues.length === 0 ? "valid" : "invalid", issues, feature_count: records.length };
}
