import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runQaDeviceProfilesCli } from "./qa-device-profiles.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(): { cwd: string; home: string } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "qa-device-profiles-cli-")));
	roots.push(root);
	const cwd = join(root, "repo");
	const home = join(root, "home");
	mkdirSync(join(cwd, ".git"), { recursive: true });
	mkdirSync(home);
	return { cwd, home };
}

describe("qa-device-profiles CLI", () => {
	test("프로필이 없으면 사용자에게 물으라고 하고, 저장 후에는 그대로 돌려줌", () => {
		const options = fixture();
		const before = JSON.parse(runQaDeviceProfilesCli(["get"], options).stdout);
		expect(before.status).toBe("unconfigured");
		expect(before.ask_user).toContain("Ask the user");

		const file = join(options.cwd, "profiles.json");
		writeFileSync(file, JSON.stringify([{ id: "phone-small", label: "작은 폰", platform: "ios", width: 375, height: 667 }]));
		expect(runQaDeviceProfilesCli(["set", "--file", file], options).exitCode).toBe(0);

		const after = JSON.parse(runQaDeviceProfilesCli(["get"], options).stdout);
		expect(after.status).toBe("ok");
		expect(after.profiles[0].id).toBe("phone-small");
	});

	test("잘못된 입력은 저장하지 않고 오류로 끝남", () => {
		const options = fixture();
		const file = join(options.cwd, "profiles.json");
		writeFileSync(file, JSON.stringify([{ id: "Bad Id", label: "x", platform: "ios", width: 1, height: 1 }]));
		const result = runQaDeviceProfilesCli(["set", "--file", file], options);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("kebab-case");
		expect(JSON.parse(runQaDeviceProfilesCli(["get"], options).stdout).status).toBe("unconfigured");
	});
});
