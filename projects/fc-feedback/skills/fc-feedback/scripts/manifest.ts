/**
 * fc-feedback external manifest (~/.fc-feedback/<projectKey>/manifest.yaml).
 *
 * Pattern copied from lib/qa-case-store.ts (validateManifest / writeAtomic /
 * readOrCreateManifest / statusFrom / configure+disable) — see that file for
 * the reference shape. Reuses @lib/feature-map/manifest.ts for projectKey
 * derivation and @lib/persistent-mode-core/state-lock.ts for the
 * read-modify-write lock, without importing qa-case-store's own (unexported)
 * helpers.
 *
 * Mode contract (plan §1 / §3):
 *   unconfigured — no archive/roster/pages set up yet.
 *   disabled     — renders to $OMT_DIR only; any previously configured paths
 *                  are kept (not required, not re-validated).
 *   configured   — archive_repo_path / roster_path / pages_base_url are all
 *                  required and structurally valid.
 *
 * roster_path is checked here only for "exists + parses as YAML" (Bun.YAML).
 * Its member/roster schema is validated later by core.ts, not here (§12-5).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseDocument, stringify } from "yaml";

import { resolveFeatureMapContext, type FeatureMapOptions } from "@lib/feature-map/manifest.ts";
import { withStateLock } from "@lib/persistent-mode-core/state-lock.ts";

export type FcContextOptions = FeatureMapOptions;

export interface FcContext {
	projectKey: string;
	projectRoot: string;
	manifestPath: string;
}

export interface ConfigureFcInput {
	archive: string;
	roster: string;
	pagesUrl: string;
}

export type FcManifest =
	| { version: 1; project: string; mode: "unconfigured" }
	| { version: 1; project: string; mode: "disabled"; archive_repo_path?: string; roster_path?: string; pages_base_url?: string }
	| { version: 1; project: string; mode: "configured"; archive_repo_path: string; roster_path: string; pages_base_url: string };

export type FcStatus =
	| { status: "unconfigured"; mode: "unconfigured"; project: string; manifestPath: string }
	| { status: "disabled"; mode: "disabled"; project: string; manifestPath: string; archive_repo_path?: string; roster_path?: string; pages_base_url?: string }
	| { status: "configured"; mode: "configured"; project: string; manifestPath: string; archive_repo_path: string; roster_path: string; pages_base_url: string };

export function resolveFcContext(options: FcContextOptions = {}): FcContext {
	const feature = resolveFeatureMapContext(options);
	const home = realpathSync(options.home ?? homedir());
	return { projectKey: feature.projectKey, projectRoot: feature.projectRoot, manifestPath: join(home, ".fc-feedback", feature.projectKey, "manifest.yaml") };
}

function isMissing(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNonblankString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim() === "") throw new Error(`fc-feedback: manifest ${field} must be a nonblank string`);
	return value;
}

function assertPagesBaseUrl(url: string): void {
	if (!url.startsWith("https://")) throw new Error("fc-feedback: pages_base_url must use https");
	if (!url.endsWith("/")) throw new Error("fc-feedback: pages_base_url must end with '/'");
}

function readRaw(context: FcContext): Record<string, unknown> {
	const document = parseDocument(readFileSync(context.manifestPath, "utf8"));
	if (document.errors.length) throw new Error(`fc-feedback: invalid manifest: ${document.errors[0]?.message}`);
	const value: unknown = document.toJS();
	if (!isRecord(value)) throw new Error("fc-feedback: manifest must be a YAML object");
	return value;
}

function validateManifest(value: Record<string, unknown>, context: FcContext): FcManifest {
	if (value.version !== 1) throw new Error("fc-feedback: unsupported manifest version");
	if (value.project !== context.projectKey) throw new Error("fc-feedback: manifest project does not match context");
	const archive = optionalNonblankString(value.archive_repo_path, "archive_repo_path");
	const roster = optionalNonblankString(value.roster_path, "roster_path");
	const pagesUrl = optionalNonblankString(value.pages_base_url, "pages_base_url");
	if (value.mode === "unconfigured") return { version: 1, project: context.projectKey, mode: "unconfigured" };
	if (value.mode === "disabled") {
		return {
			version: 1,
			project: context.projectKey,
			mode: "disabled",
			...(archive !== undefined ? { archive_repo_path: archive } : {}),
			...(roster !== undefined ? { roster_path: roster } : {}),
			...(pagesUrl !== undefined ? { pages_base_url: pagesUrl } : {}),
		};
	}
	if (value.mode === "configured") {
		if (archive === undefined) throw new Error("fc-feedback: configured manifest requires archive_repo_path");
		if (roster === undefined) throw new Error("fc-feedback: configured manifest requires roster_path");
		if (pagesUrl === undefined) throw new Error("fc-feedback: configured manifest requires pages_base_url");
		if (!isAbsolute(archive)) throw new Error("fc-feedback: manifest archive_repo_path must be absolute");
		if (!isAbsolute(roster)) throw new Error("fc-feedback: manifest roster_path must be absolute");
		assertPagesBaseUrl(pagesUrl);
		return { version: 1, project: context.projectKey, mode: "configured", archive_repo_path: archive, roster_path: roster, pages_base_url: pagesUrl };
	}
	throw new Error("fc-feedback: invalid manifest mode");
}

function writeAtomic(path: string, content: string): void {
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	try { writeFileSync(temporary, content, "utf8"); renameSync(temporary, path); } finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
}

function writeManifest(context: FcContext, manifest: FcManifest): void {
	writeAtomic(context.manifestPath, stringify(manifest));
}

/** Reads the manifest, or creates it as unconfigured when missing — the only implicit write. */
function readOrCreateManifest(context: FcContext): { context: FcContext; manifest: FcManifest } {
	try {
		return { context, manifest: validateManifest(readRaw(context), context) };
	} catch (error) {
		if (!isMissing(error)) throw error;
		const manifest: FcManifest = { version: 1, project: context.projectKey, mode: "unconfigured" };
		writeManifest(context, manifest);
		return { context, manifest };
	}
}

function statusFrom(result: { context: FcContext; manifest: FcManifest }): FcStatus {
	const base = { project: result.context.projectKey, manifestPath: result.context.manifestPath };
	const manifest = result.manifest;
	if (manifest.mode === "unconfigured") return { ...base, status: "unconfigured", mode: "unconfigured" };
	if (manifest.mode === "disabled") {
		return {
			...base,
			status: "disabled",
			mode: "disabled",
			...(manifest.archive_repo_path !== undefined ? { archive_repo_path: manifest.archive_repo_path } : {}),
			...(manifest.roster_path !== undefined ? { roster_path: manifest.roster_path } : {}),
			...(manifest.pages_base_url !== undefined ? { pages_base_url: manifest.pages_base_url } : {}),
		};
	}
	return { ...base, status: "configured", mode: "configured", archive_repo_path: manifest.archive_repo_path, roster_path: manifest.roster_path, pages_base_url: manifest.pages_base_url };
}

/** Carries forward whatever archive/roster/pages fields an existing manifest already had. */
function carryPaths(manifest: FcManifest): { archive_repo_path?: string; roster_path?: string; pages_base_url?: string } {
	if (manifest.mode === "unconfigured") return {};
	return {
		...(manifest.archive_repo_path !== undefined ? { archive_repo_path: manifest.archive_repo_path } : {}),
		...(manifest.roster_path !== undefined ? { roster_path: manifest.roster_path } : {}),
		...(manifest.pages_base_url !== undefined ? { pages_base_url: manifest.pages_base_url } : {}),
	};
}

function statOrUndefined(path: string): ReturnType<typeof statSync> | undefined {
	try { return statSync(path); } catch { return undefined; }
}

function gitToplevel(path: string): string | undefined {
	try { return execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
	catch { return undefined; }
}

function assertArchiveRepoPath(path: string): string {
	if (!isAbsolute(path)) throw new Error("fc-feedback: archive_repo_path must be absolute");
	const stats = statOrUndefined(path);
	if (stats === undefined) throw new Error(`fc-feedback: archive_repo_path does not exist: ${path}`);
	if (!stats.isDirectory()) throw new Error(`fc-feedback: archive_repo_path must be a directory: ${path}`);
	const toplevel = gitToplevel(path);
	if (toplevel === undefined) throw new Error(`fc-feedback: archive_repo_path is not a git repository: ${path}`);
	const resolvedToplevel = realpathSync(isAbsolute(toplevel) ? toplevel : resolve(path, toplevel));
	if (resolvedToplevel !== realpathSync(path)) throw new Error(`fc-feedback: archive_repo_path is not the git repository root: ${path}`);
	return path;
}

/** Confirms roster_path exists and parses as YAML. Member/roster schema is validated later by core.ts (§12-5). */
function assertRosterPath(path: string): string {
	if (!isAbsolute(path)) throw new Error("fc-feedback: roster_path must be absolute");
	if (statOrUndefined(path) === undefined) throw new Error(`fc-feedback: roster_path does not exist: ${path}`);
	try { Bun.YAML.parse(readFileSync(path, "utf8")); }
	catch (error) { throw new Error(`fc-feedback: roster_path is not valid YAML: ${path}`, { cause: error }); }
	return path;
}

export function getFcStatus(options: FcContextOptions = {}): FcStatus {
	const context = resolveFcContext(options);
	mkdirSync(dirname(context.manifestPath), { recursive: true });
	const result = withStateLock(context.manifestPath, () => readOrCreateManifest(context));
	return statusFrom(result);
}

export function configureFc(input: ConfigureFcInput, options: FcContextOptions = {}): FcStatus {
	const archive = assertArchiveRepoPath(input.archive);
	const roster = assertRosterPath(input.roster);
	assertPagesBaseUrl(input.pagesUrl);
	const context = resolveFcContext(options);
	mkdirSync(dirname(context.manifestPath), { recursive: true });
	return withStateLock(context.manifestPath, () => {
		readOrCreateManifest(context); // validates (or creates) the existing manifest before it is overwritten
		const manifest: FcManifest = { version: 1, project: context.projectKey, mode: "configured", archive_repo_path: archive, roster_path: roster, pages_base_url: input.pagesUrl };
		writeManifest(context, manifest);
		return statusFrom({ context, manifest });
	});
}

export function disableFc(options: FcContextOptions = {}): FcStatus {
	const context = resolveFcContext(options);
	mkdirSync(dirname(context.manifestPath), { recursive: true });
	return withStateLock(context.manifestPath, () => {
		const existing = readOrCreateManifest(context).manifest;
		const manifest: FcManifest = { version: 1, project: context.projectKey, mode: "disabled", ...carryPaths(existing) };
		writeManifest(context, manifest);
		return statusFrom({ context, manifest });
	});
}

export function requireConfigured(options: FcContextOptions = {}): Extract<FcStatus, { status: "configured" }> {
	const status = getFcStatus(options);
	if (status.status !== "configured") throw new Error(`fc-feedback: fc-feedback is not configured (mode: ${status.mode})`);
	return status;
}
