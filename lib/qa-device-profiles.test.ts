import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_DEVICE_PROFILES, readDeviceProfiles, removeDeviceProfile, saveDeviceProfiles, upsertDeviceProfile, validateDeviceProfiles } from "./qa-device-profiles";

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
	test("저장된 프로필이 없으면 기본 목록과 함께 사용자에게 물어보라는 상태를 돌려줌", () => {
		const result = readDeviceProfiles(fixture());
		expect(result.status).toBe("unconfigured");
		if (result.status === "unconfigured") {
			expect(result.ask_user).toContain("Ask the user");
			expect(result.defaults).toEqual(DEFAULT_DEVICE_PROFILES);
		}
	});

	test("기본 목록은 그대로 저장할 수 있고 폰·폴더블·태블릿·데스크톱을 모두 담음", () => {
		expect(validateDeviceProfiles(DEFAULT_DEVICE_PROFILES)).toEqual([...DEFAULT_DEVICE_PROFILES]);
		const ids = DEFAULT_DEVICE_PROFILES.map((profile) => profile.id);
		for (const id of ["iphone-se", "fold8-cover", "fold8-main", "iphone-duo-unfolded", "ipad-portrait", "desktop-ultrawide"]) expect(ids).toContain(id);
	});

	test("프로젝트가 지원하지 않는 기기는 지우고, 크기는 고치고, 전용 화면은 추가함", () => {
		const options = fixture();
		saveDeviceProfiles(PROFILES, options);
		removeDeviceProfile("fold-folded", options);
		upsertDeviceProfile({ ...PROFILES[0], height: 668 }, options);
		upsertDeviceProfile({ id: "kiosk", label: "매장 키오스크", platform: "android", width: 1080, height: 1920 }, options);
		const result = readDeviceProfiles(options);
		if (result.status !== "ok") throw new Error("expected ok");
		expect(result.profiles.map((profile) => [profile.id, profile.height])).toEqual([["iphone-se", 668], ["kiosk", 1920]]);
	});

	test("저장 전 편집, 없는 id 삭제, 마지막 프로필 삭제는 거부함", () => {
		const options = fixture();
		expect(() => removeDeviceProfile("iphone-se", options)).toThrow("set --defaults");
		expect(() => upsertDeviceProfile(PROFILES[0], options)).toThrow("set --defaults");
		saveDeviceProfiles([PROFILES[0]], options);
		expect(() => removeDeviceProfile("nope", options)).toThrow("no saved profile");
		expect(() => removeDeviceProfile("iphone-se", options)).toThrow("last saved profile");
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
