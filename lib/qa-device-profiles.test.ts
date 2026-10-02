import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDeviceProfiles, saveDeviceProfiles, validateDeviceProfiles } from "./qa-device-profiles";

const roots: string[] = [];
function fixture(): { home: string; cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "qa-device-profiles-"));
	roots.push(root);
	const home = join(root, "home");
	const cwd = join(root, "project");
	mkdirSync(home, { recursive: true });
	mkdirSync(join(cwd, ".git"), { recursive: true });
	return { home, cwd };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const PROFILES = [
	{ id: "iphone-se", label: "iPhone SE", platform: "ios", width: 375, height: 667 },
	{ id: "fold-folded", label: "Galaxy Z Fold 접힘", platform: "android", width: 344, height: 882 },
];

describe("기기 프로필 저장소", () => {
	test("저장된 프로필이 없으면 사용자에게 물어보라는 상태를 돌려줌", () => {
		const result = readDeviceProfiles(fixture());
		expect(result.status).toBe("unconfigured");
		if (result.status === "unconfigured") expect(result.ask_user).toContain("Ask the user");
	});

	test("저장한 프로필을 프로젝트 단위로 다시 읽음", () => {
		const options = fixture();
		saveDeviceProfiles(PROFILES, options);
		const result = readDeviceProfiles(options);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.profiles.map((profile) => profile.id)).toEqual(["iphone-se", "fold-folded"]);
			expect(result.path).toContain(join(".qa-cases"));
			expect(result.path.endsWith("device-profiles.yaml")).toBe(true);
		}
	});

	test("잘못된 프로필은 거부함", () => {
		expect(() => validateDeviceProfiles([])).toThrow("non-empty");
		expect(() => validateDeviceProfiles([{ ...PROFILES[0], id: "iPhone SE" }])).toThrow("kebab-case");
		expect(() => validateDeviceProfiles([PROFILES[0], PROFILES[0]])).toThrow("duplicate");
		expect(() => validateDeviceProfiles([{ ...PROFILES[0], platform: "windows" }])).toThrow("platform");
		expect(() => validateDeviceProfiles([{ ...PROFILES[0], width: 0 }])).toThrow("width");
	});

	test("손으로 고친 파일이 깨졌으면 조용히 넘어가지 않고 오류를 냄", () => {
		const options = fixture();
		saveDeviceProfiles(PROFILES, options);
		const result = readDeviceProfiles(options);
		if (result.status !== "ok") throw new Error("expected ok");
		writeFileSync(result.path, "profiles: [{ id: x }]\n");
		expect(() => readDeviceProfiles(options)).toThrow("label");
	});
});
