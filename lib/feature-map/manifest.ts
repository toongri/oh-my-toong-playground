import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	accessSync,
	constants,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseAllDocuments, parseDocument, stringify } from "yaml";

import { withStateLock } from "@lib/persistent-mode-core/state-lock";

export interface FeatureMapOptions {
	cwd?: string;
	home?: string;
}

export interface FeatureMapManifest {
	version: 1;
	project: string;
	storage: null | { format: "markdown-frontmatter-v1"; location: string };
}

export interface FeatureMapContext {
	projectKey: string;
	projectRoot: string;
	manifestPath: string;
}

type ManifestResult = { context: FeatureMapContext; manifest: FeatureMapManifest };

export function resolveFeatureMapContext(options: FeatureMapOptions = {}): FeatureMapContext {
	const cwd = realpath(resolve(options.cwd ?? process.cwd()));
	const gitRoot = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
	const projectRoot = gitRoot === undefined ? cwd : realpath(isAbsolute(gitRoot) ? gitRoot : resolve(cwd, gitRoot));
	const commonDirOutput = gitOutput(cwd, ["rev-parse", "--git-common-dir"]);
	const identity = commonDirOutput === undefined
		? projectRoot
		: realpath(isAbsolute(commonDirOutput) ? commonDirOutput : resolve(cwd, commonDirOutput));
	const commonName = basename(identity);
	const readableName = sanitizeProjectName(commonName === ".git" || commonName === ".bare"
		? basename(dirname(identity))
		: commonName);
	const digest = createHash("sha256").update(identity).digest("hex").slice(0, 12);
	const projectKey = `${readableName}-${digest}`;
	const manifestDir = join(realpath(options.home ?? homedir()), ".feature-maps", projectKey);
	return { projectKey, projectRoot, manifestPath: join(manifestDir, "manifest.yaml") };
}

export function ensureFeatureMapManifest(options: FeatureMapOptions = {}): ManifestResult {
	const context = resolveFeatureMapContext(options);
	const parent = dirname(context.manifestPath);
	mkdirSync(parent, { recursive: true });
	return withStateLock(context.manifestPath, () => {
		try {
			return { context, manifest: readAndValidate(context) };
		} catch (error) {
			if (!isMissingFile(error)) throw error;
		}
		const manifest: FeatureMapManifest = { version: 1, project: context.projectKey, storage: null };
		writeAtomic(context.manifestPath, stringify(manifest));
		return { context, manifest };
	});
}

export function configureFeatureMap(location: string, options: FeatureMapOptions = {}): ManifestResult {
	if (location.trim() === "") throw new Error("feature-map: storage location must not be blank");
	const context = resolveFeatureMapContext(options);
	mkdirSync(dirname(context.manifestPath), { recursive: true });
	return withStateLock(context.manifestPath, () => {
		let existing: FeatureMapManifest;
		let raw: Record<string, unknown>;
		try {
			raw = readAndValidateRaw(context);
			existing = validateManifest(raw, context);
		} catch (error) {
			if (!isMissingFile(error)) throw error;
			raw = { version: 1, project: context.projectKey, storage: null };
			existing = { version: 1, project: context.projectKey, storage: null };
		}
		const resolvedLocation = isAbsolute(location)
			? location
			: resolve(dirname(context.manifestPath), location);
		mkdirSync(resolvedLocation, { recursive: true });
		assertReadableDirectory(resolvedLocation);
		const manifest: FeatureMapManifest = {
			version: 1,
			project: existing.project,
			storage: { format: "markdown-frontmatter-v1", location: resolvedLocation },
		};
		raw.storage = manifest.storage;
		writeAtomic(context.manifestPath, stringify(raw));
		return { context, manifest };
	});
}

function readAndValidate(context: FeatureMapContext): FeatureMapManifest {
	return validateManifest(readAndValidateRaw(context), context);
}

function readAndValidateRaw(context: FeatureMapContext): Record<string, unknown> {
	const text = readFileSync(context.manifestPath, "utf8");
	const document = parseDocument(text);
	if (document.errors.length > 0) throw new Error(`feature-map: invalid manifest: ${document.errors[0]?.message}`);
	const documents = parseAllDocuments(text);
	if (documents.length !== 1 || documents.some((doc) => doc.errors.length > 0)) {
		throw new Error("feature-map: manifest must contain exactly one valid YAML document");
	}
	const value: unknown = document.toJS();
	if (!isRecord(value)) throw new Error("feature-map: manifest must be a YAML object");
	return value;
}

function validateManifest(value: Record<string, unknown>, context: FeatureMapContext): FeatureMapManifest {
	if (value.version !== 1) throw new Error("feature-map: unsupported manifest version");
	if (value.project !== context.projectKey) throw new Error("feature-map: manifest project does not match context");
	if (value.storage === null) return { version: 1, project: context.projectKey, storage: null };
	if (!isRecord(value.storage) || value.storage.format !== "markdown-frontmatter-v1" ||
		typeof value.storage.location !== "string" || value.storage.location.trim() === "") {
		throw new Error("feature-map: invalid storage configuration");
	}
	return {
		version: 1,
		project: context.projectKey,
		storage: { format: "markdown-frontmatter-v1", location: value.storage.location },
	};
}

function writeAtomic(path: string, content: string): void {
	const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
	try {
		writeFileSync(temporary, content, "utf8");
		renameSync(temporary, path);
	} finally {
		try { unlinkSync(temporary); } catch { /* already renamed */ }
	}
}

function assertReadableDirectory(path: string): void {
	if (!statSync(path).isDirectory()) throw new Error("feature-map: storage location is not a directory");
	accessSync(path, constants.R_OK);
}

function gitOutput(cwd: string, args: string[]): string | undefined {
	try {
		return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

function realpath(path: string): string {
	return realpathSync(path);
}

function sanitizeProjectName(name: string): string {
	const sanitized = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return sanitized || "project";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
