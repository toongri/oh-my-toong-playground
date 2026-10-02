import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDocument, stringify } from "yaml";

import { resolveQaCaseContext, type QaCaseStoreOptions } from "@lib/qa-case-store.ts";
import type { QaDeviceProfile } from "@lib/qa-chain-core.ts";

/**
 * The screen sizes a project's clients must stay usable on. One YAML file per
 * project, beside the reusable-case manifest: `~/.qa-cases/<projectKey>/device-profiles.yaml`.
 * Absent means the project has not chosen them yet; QA asks the user once and saves the answer.
 */
export type DeviceProfilesResult =
	| { status: "unconfigured"; path: string; ask_user: string }
	| { status: "ok"; path: string; profiles: QaDeviceProfile[] };

const PLATFORMS = ["web", "ios", "android"] as const;
const ASK_USER =
	"No device profiles are recorded for this project. Ask the user which screen sizes the changed clients must support " +
	"(id, label, platform web|ios|android, logical width × height — e.g. phones, foldables folded and unfolded, tablets in each orientation, desktop), then save them with `set`.";

export function deviceProfilesPath(options: QaCaseStoreOptions = {}): string {
	const context = resolveQaCaseContext(options);
	return join(dirname(context.manifestPath), "device-profiles.yaml");
}

export function validateDeviceProfiles(value: unknown): QaDeviceProfile[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("device profiles must be a non-empty array");
	const seen = new Set<string>();
	return value.map((raw, index) => {
		if (typeof raw !== "object" || raw === null) throw new Error(`profiles[${index}] must be an object`);
		const { id, label, platform, width, height }: Record<string, unknown> = { ...raw };
		if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`profiles[${index}].id must be lower-case kebab-case`);
		if (seen.has(id)) throw new Error(`duplicate profile id "${id}"`);
		seen.add(id);
		if (typeof label !== "string" || label.trim() === "") throw new Error(`profiles[${index}].label is required`);
		const knownPlatform = PLATFORMS.find((candidate) => candidate === platform);
		if (!knownPlatform) throw new Error(`profiles[${index}].platform must be one of ${PLATFORMS.join("|")}`);
		const size = (name: string, value: unknown): number => {
			if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`profiles[${index}].${name} must be a positive integer (logical px/pt/dp)`);
			return value;
		};
		return { id, label, platform: knownPlatform, width: size("width", width), height: size("height", height) };
	});
}

export function readDeviceProfiles(options: QaCaseStoreOptions = {}): DeviceProfilesResult {
	const path = deviceProfilesPath(options);
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return { status: "unconfigured", path, ask_user: ASK_USER };
		throw error;
	}
	const document = parseDocument(text);
	if (document.errors.length) throw new Error(`device profiles: invalid YAML in ${path}: ${document.errors[0]?.message}`);
	const value: unknown = document.toJS();
	const profiles = typeof value === "object" && value !== null && !Array.isArray(value) && "profiles" in value ? value.profiles : undefined;
	return { status: "ok", path, profiles: validateDeviceProfiles(profiles) };
}

export function saveDeviceProfiles(input: unknown, options: QaCaseStoreOptions = {}): DeviceProfilesResult {
	const profiles = validateDeviceProfiles(input);
	const path = deviceProfilesPath(options);
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, stringify({ version: 1, profiles }));
	renameSync(temp, path);
	return { status: "ok", path, profiles };
}
