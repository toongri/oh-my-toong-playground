import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDocument, stringify } from "yaml";

import { resolveQaCaseContext, type QaCaseStoreOptions } from "@lib/qa-case-store.ts";
import type { QaDeviceProfile } from "@lib/qa-chain-core.ts";

/**
 * The screen sizes a project's clients must stay usable on. One YAML file per
 * project, beside the reusable-case manifest: `~/.qa-cases/<projectKey>/device-profiles.yaml`.
 * Absent means the project has not chosen them yet; QA offers the built-in defaults, asks the user once, and saves the answer.
 */
export type DeviceProfilesResult =
	| { status: "unconfigured"; path: string; ask_user: string; defaults: readonly QaDeviceProfile[] }
	| { status: "ok"; path: string; profiles: QaDeviceProfile[] };

const PLATFORMS = ["web", "ios", "android"] as const;

/**
 * Starting list for a project that has none, from Korean usage share (StatCounter, Sep 2026) and
 * the 2026 foldables. Logical px/pt/dp. Z Fold8 sizes assume DPR 2.625; no measured value was found.
 */
export const DEFAULT_DEVICE_PROFILES: readonly QaDeviceProfile[] = [
	{ id: "iphone-se", label: "iPhone SE (가장 좁은 아이폰)", platform: "ios", width: 375, height: 667 },
	{ id: "iphone-11", label: "iPhone 11·XR 계열 (한국 모바일 1위)", platform: "ios", width: 414, height: 896 },
	{ id: "iphone-18-pro-max", label: "iPhone 18 Pro Max (가장 큰 아이폰)", platform: "ios", width: 440, height: 956 },
	{ id: "galaxy-360", label: "갤럭시 360폭 (가장 좁은 안드로이드)", platform: "android", width: 360, height: 780 },
	{ id: "fold8-cover", label: "Galaxy Z Fold8 커버 화면", platform: "android", width: 475, height: 751 },
	{ id: "fold8-main", label: "Galaxy Z Fold8 펼친 메인 화면", platform: "android", width: 696, height: 933 },
	{ id: "iphone-duo-folded", label: "iPhone Duo 접힘", platform: "ios", width: 466, height: 678 },
	{ id: "iphone-duo-unfolded", label: "iPhone Duo 펼침", platform: "ios", width: 626, height: 890 },
	{ id: "ipad-portrait", label: "iPad Air 11 세로", platform: "ios", width: 820, height: 1180 },
	{ id: "ipad-landscape", label: "iPad Air 11 가로", platform: "ios", width: 1180, height: 820 },
	{ id: "desktop-laptop", label: "노트북 (1920 화면 125% 배율)", platform: "web", width: 1536, height: 864 },
	{ id: "desktop-fhd", label: "데스크톱 FHD", platform: "web", width: 1920, height: 1080 },
	{ id: "desktop-ultrawide", label: "21:9 울트라와이드", platform: "web", width: 3440, height: 1440 },
];

const ASK_USER =
	"No device profiles are recorded for this project. Ask the user once: show the `defaults` list and ask which platforms (web, ios, android) the project ships and which screens it must stay usable on. " +
	"If the user accepts the list or does not know, save it with `set --defaults`. Then fit it to the project: `remove <id>` for each platform or device the project does not support, " +
	"`upsert --json '<profile>'` to change a size or add a project-specific screen (a kiosk, an embedded device). Never guess a size the user did not give or the project does not document.";

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
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return { status: "unconfigured", path, ask_user: ASK_USER, defaults: DEFAULT_DEVICE_PROFILES };
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

function savedProfiles(options: QaCaseStoreOptions, action: string): QaDeviceProfile[] {
	const current = readDeviceProfiles(options);
	if (current.status === "unconfigured") throw new Error(`no device profiles saved yet; ${action} edits a saved list — run \`set --defaults\` or \`set --file\` first`);
	return current.profiles;
}

/** Adds a profile, or replaces the one with the same id. */
export function upsertDeviceProfile(input: unknown, options: QaCaseStoreOptions = {}): DeviceProfilesResult {
	const [profile] = validateDeviceProfiles([input]);
	if (!profile) throw new Error("upsert needs one profile");
	const profiles = savedProfiles(options, "upsert");
	const index = profiles.findIndex((existing) => existing.id === profile.id);
	return saveDeviceProfiles(index === -1 ? [...profiles, profile] : profiles.map((existing, at) => (at === index ? profile : existing)), options);
}

/** Removes a profile the project does not support; the list may not become empty. */
export function removeDeviceProfile(id: string, options: QaCaseStoreOptions = {}): DeviceProfilesResult {
	const profiles = savedProfiles(options, "remove");
	if (!profiles.some((profile) => profile.id === id)) throw new Error(`no saved profile "${id}"; saved: ${profiles.map((profile) => profile.id).join(", ")}`);
	if (profiles.length === 1) throw new Error(`"${id}" is the last saved profile; upsert the replacement first, then remove it`);
	return saveDeviceProfiles(profiles.filter((profile) => profile.id !== id), options);
}
