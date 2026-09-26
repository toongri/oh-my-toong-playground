import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireDevice,
	type DeviceDeps,
	recordResource,
	releaseResource,
	unreleasedResources,
	unreleasedResourcesRefusal,
} from "./session-resources.ts";

const SID = "res-test";
let dir: string;
let prevOmtDir: string | undefined;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "session-resources-"));
	prevOmtDir = process.env.OMT_DIR;
	process.env.OMT_DIR = dir;
});

afterEach(() => {
	if (prevOmtDir === undefined) delete process.env.OMT_DIR;
	else process.env.OMT_DIR = prevOmtDir;
	rmSync(dir, { recursive: true, force: true });
});

describe("session resources", () => {
	test("세션에 기록한 자원은 해제 전까지 완료 거부 사유로 나온다", () => {
		recordResource(SID, { id: "emulator-5554", kind: "emulator", stop: "true" });
		expect(unreleasedResources(SID).map((r) => r.id)).toEqual(["emulator-5554"]);
		expect(unreleasedResourcesRefusal(SID, "qa-state.ts")).toContain(
			"qa-state.ts release-resource --id emulator-5554",
		);
	});

	test("stop 명령이 0으로 끝나야만 해제로 기록된다", () => {
		recordResource(SID, { id: "srv", kind: "server", stop: "exit 3" });
		expect(() => releaseResource(SID, "srv")).toThrow("stays unreleased");
		expect(unreleasedResources(SID)).toHaveLength(1);

		recordResource(SID, { id: "srv", kind: "server", stop: "true" });
		expect(releaseResource(SID, "srv").released_at).toBeString();
		expect(unreleasedResources(SID)).toEqual([]);
		expect(unreleasedResourcesRefusal(SID, "qa-state.ts")).toBe("");
	});

	test("빈 필드 기록과 없는 id 해제는 거부된다", () => {
		expect(() => recordResource(SID, { id: "x", kind: "emulator", stop: " " })).toThrow("--stop is required");
		expect(() => releaseResource(SID, "missing")).toThrow("no recorded resource");
	});
});

function fakeDeps(outputs: Record<string, { status: number; stdout: string }>): DeviceDeps & { calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		run(cmd, args) {
			calls.push([cmd, ...args]);
			const key = Object.keys(outputs).find((k) => args.join(" ").includes(k)) ?? "";
			const out = outputs[key] ?? { status: 0, stdout: "" };
			return { ...out, stderr: "" };
		},
		launchDetached(cmd, args) {
			calls.push(["launch", cmd, ...args]);
		},
		sleep() {},
	};
}

describe("acquireDevice", () => {
	test("iOS는 세션 이름 시뮬레이터를 만들고 부팅 전에 기록한다", () => {
		const deps = fakeDeps({ "simctl create": { status: 0, stdout: "UDID-1\n" }, bootstatus: { status: 1, stdout: "" } });
		expect(() => acquireDevice(SID, { platform: "ios", base: "iPhone 17 Pro" }, deps)).toThrow("release it with release-resource");
		expect(deps.calls[0]).toContain(`omt-${SID}-1`);
		const [rec] = unreleasedResources(SID);
		expect(rec.id).toBe("UDID-1");
		expect(rec.stop).toContain("xcrun simctl delete UDID-1");
	});

	test("Android는 비어 있는 포트에 세션 태그를 붙여 띄우고 serial을 돌려준다", () => {
		const deps = fakeDeps({ "devices": { status: 0, stdout: "emulator-5554\tdevice\n" }, "sys.boot_completed": { status: 0, stdout: "1\n" } });
		expect(acquireDevice(SID, { platform: "android", base: "Pixel" }, deps)).toBe("emulator-5556");
		const launch = deps.calls.find((c) => c[0] === "launch") ?? [];
		expect(launch.join(" ")).toContain(`-read-only -no-boot-anim -port 5556 -prop qemu.omt.session=${SID}`);
		expect(unreleasedResources(SID)[0].id).toBe("emulator-5556");
	});

	test("Android stop은 태그가 맞는 프로세스가 없으면 다른 세션 기기를 건드리지 않고 해제된다", () => {
		const deps = fakeDeps({ "devices": { status: 0, stdout: "" }, "sys.boot_completed": { status: 0, stdout: "1" } });
		acquireDevice(SID, { platform: "android", base: "Pixel" }, deps);
		// Real bash + pgrep: no process carries this tag, so stop must exit 0 without running emu kill.
		expect(releaseResource(SID, "emulator-5554").released_at).toBeString();
	});

	test("잘못된 platform과 빈 base는 거부된다", () => {
		expect(() => acquireDevice(SID, { platform: "tvos", base: "x" }, fakeDeps({}))).toThrow("--platform must be ios or android");
		expect(() => acquireDevice(SID, { platform: "ios", base: " " }, fakeDeps({}))).toThrow("--base is required");
	});
});
