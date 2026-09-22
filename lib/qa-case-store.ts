import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { parseDocument, stringify } from "yaml";

import { withStateLock } from "@lib/persistent-mode-core/state-lock.ts";
import { resolveFeatureMapContext, type FeatureMapOptions } from "@lib/feature-map/manifest.ts";

export type QaCaseSurface = "agent-browser" | "agent-device" | "curl" | "bash";
export interface QaCaseRecord {
	id: string;
	title: string;
	goal: string;
	given: string[];
	when: string[];
	then: string[];
	acceptance_criteria: string[];
	surface: QaCaseSurface;
	runner: string[];
	execution_cwd: string;
	native_files: string[];
	reset_description: string;
	feature_refs?: string[];
}
export interface QaCaseContext { projectKey: string; projectRoot: string; manifestPath: string; }
export type QaCaseManifest = { version: 1; project: string; mode: "unconfigured" | "disabled" | "configured"; location?: string; allow_project_storage?: boolean };
export type QaCaseStoreOptions = FeatureMapOptions;
export type QaCaseStatus =
	| { status: "unconfigured"; mode: "unconfigured"; project: string; manifestPath: string }
	| { status: "disabled"; mode: "disabled"; project: string; manifestPath: string; location?: string }
	| { status: "configured"; mode: "configured"; project: string; manifestPath: string; location: string };
export type QaCaseStoreResult = QaCaseStatus | { status: "ok"; record: QaCaseRecord; path: string; revision: string } | { status: "ok"; cases: Array<{ id: string; title: string; path: string; revision: string }> } | { status: "not_found"; reason: "case_not_found" } | { status: "conflict"; reason: "revision_mismatch"; expectedRevision: string | null; actualRevision: string | null; path: string };

export function resolveQaCaseContext(options: QaCaseStoreOptions = {}): QaCaseContext {
	const feature = resolveFeatureMapContext(options);
	const home = realpathSync(options.home ?? homedir());
	return { projectKey: feature.projectKey, projectRoot: feature.projectRoot, manifestPath: join(home, ".qa-cases", feature.projectKey, "manifest.yaml") };
}

function isMissing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"; }
function lstatMaybe(path: string): ReturnType<typeof lstatSync> | undefined { try { return lstatSync(path, { throwIfNoEntry: false }) ?? undefined; } catch (error) { if (isMissing(error)) return undefined; throw error; } }
function recordObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readRaw(context: QaCaseContext): Record<string, unknown> {
	const document = parseDocument(readFileSync(context.manifestPath, "utf8"));
	if (document.errors.length) throw new Error(`qa-cases: invalid manifest: ${document.errors[0]?.message}`);
	const value = document.toJS();
	if (!recordObject(value)) throw new Error("qa-cases: manifest must be a YAML object");
	return value;
}
function validateManifest(value: Record<string, unknown>, context: QaCaseContext): QaCaseManifest {
	if (value.version !== 1) throw new Error("qa-cases: unsupported manifest version");
	if (value.project !== context.projectKey) throw new Error("qa-cases: manifest project does not match context");
	if (value.mode !== "unconfigured" && value.mode !== "disabled" && value.mode !== "configured") throw new Error("qa-cases: invalid manifest mode");
	if (value.mode === "configured" && value.location === undefined) throw new Error("qa-cases: configured manifest requires a location");
	if (value.location !== undefined && (typeof value.location !== "string" || !isAbsolute(value.location) || value.location.trim() === "")) throw new Error("qa-cases: manifest location must be an absolute nonblank path");
	if (value.allow_project_storage !== undefined && typeof value.allow_project_storage !== "boolean") throw new Error("qa-cases: allow_project_storage must be boolean");
	return { version: 1, project: context.projectKey, mode: value.mode, ...(typeof value.location === "string" ? { location: value.location } : {}), ...(typeof value.allow_project_storage === "boolean" ? { allow_project_storage: value.allow_project_storage } : {}) };
}
function writeAtomic(path: string, content: string): void {
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	try { writeFileSync(temporary, content, "utf8"); renameSync(temporary, path); } finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
}
function ensureManifest(context: QaCaseContext): { context: QaCaseContext; manifest: QaCaseManifest; raw: Record<string, unknown> } {
	assertNoSymlinkComponents("/", context.manifestPath);
	mkdirSync(dirname(context.manifestPath), { recursive: true });
	return withStateLock(context.manifestPath, () => {
		return readOrCreateManifest(context);
	});
}
function readOrCreateManifest(context: QaCaseContext): { context: QaCaseContext; manifest: QaCaseManifest; raw: Record<string, unknown> } {
		try { const raw = readRaw(context); return { context, manifest: validateManifest(raw, context), raw }; }
		catch (error) {
			if (!isMissing(error)) throw error;
			const raw: Record<string, unknown> = { version: 1, project: context.projectKey, mode: "unconfigured" };
			writeAtomic(context.manifestPath, stringify(raw));
			return { context, manifest: { version: 1, project: context.projectKey, mode: "unconfigured" }, raw };
		}
}
function inside(root: string, candidate: string): boolean { const rest = relative(root, candidate); return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest)); }
function insideLexical(root: string, candidate: string): boolean { return candidate === root || candidate.startsWith(`${root}/`); }
function canonical(path: string): string { return realpathSync(path); }
function assertDirectory(path: string, writable = false): string {
	try { if (!statSync(path).isDirectory()) throw new Error("not a directory"); accessSync(path, writable ? constants.R_OK | constants.W_OK : constants.R_OK); return canonical(path); }
	catch (error) { throw new Error(`qa-cases: storage location is unavailable: ${path}`, { cause: error }); }
}
function validatePresentLocation(context: QaCaseContext, location: string, allowProjectStorage: boolean): string {
	assertNoSymlinkComponents("/", location);
	const actual = assertDirectory(location);
	if (!allowProjectStorage && inside(context.projectRoot, actual)) throw new Error("qa-cases: persisted project-local storage requires explicit approval");
	return actual;
}
function statusFrom(result: ReturnType<typeof ensureManifest>): QaCaseStatus {
	const base = { project: result.context.projectKey, manifestPath: result.context.manifestPath };
	const location = result.manifest.location ? validatePresentLocation(result.context, result.manifest.location, result.manifest.allow_project_storage === true) : undefined;
	if (result.manifest.mode === "unconfigured") return { ...base, status: "unconfigured", mode: "unconfigured" };
	if (result.manifest.mode === "disabled") return { ...base, status: "disabled", mode: "disabled", ...(location ? { location } : {}) };
	if (!location) throw new Error("qa-cases: configured manifest has no location");
	return { ...base, status: "configured", mode: "configured", location };
}
function configured(options: QaCaseStoreOptions): { result: ReturnType<typeof ensureManifest>; location?: string } {
	const result = ensureManifest(resolveQaCaseContext(options));
	if (result.manifest.mode !== "configured") return { result };
	if (!result.manifest.location) throw new Error("qa-cases: configured manifest has no location");
	assertNoSymlinkComponents("/", result.manifest.location);
	const location = assertDirectory(result.manifest.location);
	if (!result.manifest.allow_project_storage && inside(result.context.projectRoot, location)) throw new Error("qa-cases: persisted project-local storage requires explicit approval");
	return { result, location };
}

export function getQaCaseStoreStatus(options: QaCaseStoreOptions = {}): QaCaseStatus { return statusFrom(ensureManifest(resolveQaCaseContext(options))); }

export function configureQaCaseStore(location: string, options: QaCaseStoreOptions & { allowProjectStorage?: boolean } = {}): QaCaseStatus {
	if (!isAbsolute(location)) throw new Error("qa-cases: storage location must be absolute");
	const context = resolveQaCaseContext(options);
	assertNoSymlinkComponents("/", context.manifestPath);
	assertNoSymlinkComponents("/", location);
	let normalizedLocation = location;
	try { normalizedLocation = join(realpathSync(dirname(location)), basename(location)); } catch { /* nearest existing ancestor is used for new paths */ }
	let explicitLinkTarget: string | undefined;
	try { explicitLinkTarget = resolve(dirname(normalizedLocation), readlinkSync(normalizedLocation)); } catch { /* not a symlink */ }
	const existing = explicitLinkTarget ? { isSymbolicLink: () => true } : lstatMaybe(normalizedLocation);
	let potential: string;
	try { potential = canonicalPotentialPath(normalizedLocation); }
	catch (error) {
		try {
			const target = resolve(dirname(normalizedLocation), readlinkSync(normalizedLocation));
			if (!options.allowProjectStorage && (inside(context.projectRoot, target) || insideLexical(context.projectRoot, target))) throw new Error("qa-cases: project-local storage requires --allow-project-storage", { cause: error });
		} catch (linkError) { if (linkError instanceof Error && linkError.message.includes("allow-project-storage")) throw linkError; }
		potential = resolve(normalizedLocation);
		if (error && !isMissing(error)) throw error;
	}
	if (existing?.isSymbolicLink() || explicitLinkTarget) {
		const rawTarget = explicitLinkTarget ?? resolve(dirname(normalizedLocation), readlinkSync(normalizedLocation));
		let target = rawTarget;
		try { target = join(realpathSync(dirname(rawTarget)), rawTarget.slice(dirname(rawTarget).length + 1)); } catch { /* dangling target: lexical check below */ }
		if (!options.allowProjectStorage && (inside(context.projectRoot, target) || insideLexical(context.projectRoot, target))) throw new Error("qa-cases: project-local storage requires --allow-project-storage");
	}
	if (!options.allowProjectStorage && inside(context.projectRoot, potential)) throw new Error("qa-cases: project-local storage requires --allow-project-storage");
	if (!existing) mkdirSync(location, { recursive: true });
	const actual = assertDirectory(location, true);
	mkdirSync(dirname(context.manifestPath), { recursive: true });
	withStateLock(context.manifestPath, () => {
		const ensured = readOrCreateManifest(context);
		if (ensured.manifest.location) validatePresentLocation(ensured.context, ensured.manifest.location, ensured.manifest.allow_project_storage === true);
		const raw = ensured.raw;
		raw.mode = "configured";
		raw.location = actual;
		raw.allow_project_storage = options.allowProjectStorage === true;
		raw.version = 1;
		raw.project = context.projectKey;
		writeAtomic(context.manifestPath, stringify(raw));
	});
	return { status: "configured", mode: "configured", project: context.projectKey, manifestPath: context.manifestPath, location: actual };
}

export function disableQaCaseStore(options: QaCaseStoreOptions = {}): QaCaseStatus {
	const context = resolveQaCaseContext(options);
	assertNoSymlinkComponents("/", context.manifestPath);
	let result: QaCaseStatus | undefined;
	mkdirSync(dirname(context.manifestPath), { recursive: true });
	withStateLock(context.manifestPath, () => {
		const ensured = readOrCreateManifest(context);
		if (ensured.manifest.location) validatePresentLocation(ensured.context, ensured.manifest.location, ensured.manifest.allow_project_storage === true);
		ensured.raw.mode = "disabled";
		writeAtomic(ensured.context.manifestPath, stringify(ensured.raw));
		result = statusFrom(readOrCreateManifest(ensured.context));
	});
	if (!result) throw new Error("qa-cases: disable did not produce a status");
	return result;
}

function safeId(id: string): void { if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) throw new Error("qa-cases: id must be a safe lower ASCII identifier"); }
function stringArray(value: unknown, field: string, required = true): string[] {
	if (value === undefined && !required) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) throw new Error(`qa-cases: ${field} must be a string array`);
	if (required && value.length === 0) throw new Error(`qa-cases: ${field} must be a non-empty string array`);
	return value.map((item) => String(item));
}
export function validateQaCase(record: unknown): asserts record is QaCaseRecord {
	if (!recordObject(record)) throw new Error("qa-cases: record must be an object");
	for (const field of ["id", "title", "goal", "execution_cwd", "reset_description"]) if (typeof record[field] !== "string" || record[field].trim() === "") throw new Error(`qa-cases: ${field} must be nonblank`);
	if (typeof record.id !== "string") throw new Error("qa-cases: id must be a string");
	safeId(record.id);
	for (const field of ["given", "when", "then", "acceptance_criteria"]) stringArray(record[field], field);
	stringArray(record.native_files, "native_files", false);
	if (record.feature_refs !== undefined) stringArray(record.feature_refs, "feature_refs", false);
	if (typeof record.surface !== "string" || !["agent-browser", "agent-device", "curl", "bash"].includes(record.surface)) throw new Error("qa-cases: invalid surface");
	stringArray(record.runner, "runner");
}
function rootFor(options: QaCaseStoreOptions): string | QaCaseStatus { const value = configured(options); return value.location ?? statusFrom(value.result); }
function casePath(root: string, id: string): string { safeId(id); return join(root, "cases", `${id}.json`); }
function revision(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function unavailable(value: QaCaseStatus): QaCaseStatus { return value; }

export function saveQaCase(input: { record: QaCaseRecord; expectedRevision: string | null }, options: QaCaseStoreOptions = {}): QaCaseStoreResult {
	validateQaCase(input.record);
	if (input.expectedRevision !== null && !/^[a-f0-9]{64}$/.test(input.expectedRevision)) throw new Error("qa-cases: expectedRevision must be null or a SHA-256 hex string");
	const root = rootFor(options); if (typeof root !== "string") return unavailable(root);
	const path = casePath(root, input.record.id); assertNoSymlinkComponents(root, path); mkdirSync(dirname(path), { recursive: true });
	return withStateLock(join(root, ".qa-cases-state"), () => {
		if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`qa-cases: symlink case file is not allowed: ${path}`);
		let actual: string | null = null; let exists = true;
		try { actual = revision(readFileSync(path)); } catch (error) { if (isMissing(error)) exists = false; else throw error; }
		if ((input.expectedRevision === null && exists) || (input.expectedRevision !== null && input.expectedRevision !== actual)) return { status: "conflict", reason: "revision_mismatch", expectedRevision: input.expectedRevision, actualRevision: actual, path };
		const bytes = Buffer.from(`${JSON.stringify(input.record, null, 2)}\n`);
		writeAtomic(path, bytes.toString("utf8"));
		return { status: "ok", record: input.record, path, revision: revision(bytes) };
	});
}

export function getQaCase(id: string, options: QaCaseStoreOptions = {}): QaCaseStoreResult {
	const root = rootFor(options); if (typeof root !== "string") return unavailable(root);
	const path = casePath(root, id);
	assertNoSymlinkComponents(root, path);
	if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`qa-cases: symlink case file is not allowed: ${path}`);
	try { const bytes = readFileSync(path); const record = JSON.parse(bytes.toString("utf8")); validateQaCase(record); if (record.id !== id) throw new Error(`qa-cases: filename/id mismatch: ${path}`); return { status: "ok", record, path, revision: revision(bytes) }; }
	catch (error) { if (isMissing(error)) return { status: "not_found", reason: "case_not_found" }; throw error; }
}
export function listQaCases(options: QaCaseStoreOptions = {}): QaCaseStoreResult {
	const root = rootFor(options); if (typeof root !== "string") return unavailable(root);
	const directory = join(root, "cases");
	assertNoSymlinkComponents(root, directory);
	try { const ids = new Set<string>(); const cases = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => { const path = join(directory, entry.name); const bytes = readFileSync(path); const record = JSON.parse(bytes.toString("utf8")); validateQaCase(record); const expectedId = entry.name.slice(0, -5); if (record.id !== expectedId) throw new Error(`qa-cases: filename/id mismatch: ${path}`); if (ids.has(record.id)) throw new Error(`qa-cases: duplicate case id: ${record.id}`); ids.add(record.id); return { id: record.id, title: record.title, path, revision: revision(bytes) }; }).sort((a, b) => a.id.localeCompare(b.id)); return { status: "ok", cases }; }
	catch (error) { if (isMissing(error)) return { status: "ok", cases: [] }; throw error; }
}

function canonicalPotentialPath(path: string): string {
	let cursor = resolve(path); const suffix: string[] = [];
	while (!lstatMaybe(cursor)) { suffix.unshift(cursor.slice(dirname(cursor).length + 1)); cursor = dirname(cursor); }
	return resolve(realpathSync(cursor), ...suffix);
}
function assertNoSymlinkComponents(root: string, path: string): void {
	const rest = relative(root, resolve(path));
	if (rest.startsWith("..") || isAbsolute(rest)) throw new Error(`qa-cases: path is outside configured store: ${path}`);
	let cursor = root;
	for (const part of rest.split("/")) {
		if (!part || part === ".") continue;
		cursor = join(cursor, part);
		const entry = lstatMaybe(cursor);
		if (entry?.isSymbolicLink()) throw new Error(`qa-cases: symlink path component is not allowed: ${cursor}`);
	}
}
function safeStorePath(root: string, path: string): string { const resolved = resolve(root, path); if (!inside(root, resolved)) throw new Error(`qa-cases: path is outside configured store: ${path}`); assertNoSymlinkComponents(root, resolved); return resolved; }
export function resolveQaCaseOutputPath(location: string, id: string, filename: string): string { safeId(id); const root = canonical(location); const result = safeStorePath(root, join("outputs", id, filename)); if (!inside(join(root, "outputs", id), result)) throw new Error(`qa-cases: path is outside case output directory: ${filename}`); return result; }
export function resolveQaCaseRunPath(location: string, runId: string = randomUUID()): string { if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error("qa-cases: invalid run id"); const root = canonical(location); return safeStorePath(root, join("runs", runId)); }
export function resolveQaCaseAssetsPath(location: string, id: string): string { safeId(id); const root = canonical(location); return safeStorePath(root, join("assets", id)); }
