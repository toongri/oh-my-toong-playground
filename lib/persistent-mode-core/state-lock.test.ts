import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStateLock } from "./state-lock.ts";

describe("withStateLock", () => {
	let testDir: string;
	let stateFilePath: string;
	let lockPath: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "persistent-state-lock-"));
		stateFilePath = join(testDir, "ultragoal-state-session.json");
		lockPath = `${stateFilePath}.lock`;
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("fresh live-owner contention fails closed without running the callback", () => {
		mkdirSync(lockPath);
		writeFileSync(
			join(lockPath, "owner.json"),
			JSON.stringify({ ownerPid: process.pid, token: "live-owner", startedAt: Date.now() }),
		);
		let called = false;

		expect(() => withStateLock(stateFilePath, () => {
			called = true;
		})).toThrow("ultragoal-state: state lock contended; refusing unlocked write");
		expect(called).toBe(false);
		expect(existsSync(lockPath)).toBe(true);
	});

	test("stale ownerless lock is recovered before running the callback", () => {
		mkdirSync(lockPath);
		const stale = new Date(Date.now() - 31_000);
		utimesSync(lockPath, stale, stale);

		expect(withStateLock(stateFilePath, () => "written")).toBe("written");
		expect(existsSync(lockPath)).toBe(false);
	});

	test("release preserves a successor lock when its owner token changed", () => {
		withStateLock(stateFilePath, () => {
			writeFileSync(
				join(lockPath, "owner.json"),
				JSON.stringify({ ownerPid: process.pid, token: "successor", startedAt: Date.now() }),
			);
		});

		expect(existsSync(lockPath)).toBe(true);
		expect(JSON.parse(readFileSync(join(lockPath, "owner.json"), "utf8")).token).toBe("successor");
	});

	test("owner release waits for a long fresh recovery guard before allowing a subsequent writer", async () => {
		const recoveryPath = `${lockPath}.recovery`;
		let recoveryReleaser: ReturnType<typeof Bun.spawn> | undefined;

		withStateLock(stateFilePath, () => {
			mkdirSync(recoveryPath);
			recoveryReleaser = Bun.spawn([
				"sh",
				"-c",
				"sleep 0.7; rm -rf \"$1\"",
				"release-recovery",
				recoveryPath,
			]);
		});

		expect(recoveryReleaser).toBeDefined();
		expect(await recoveryReleaser!.exited).toBe(0);
		expect(existsSync(lockPath)).toBe(false);
		expect(withStateLock(stateFilePath, () => "written")).toBe("written");
		expect(existsSync(lockPath)).toBe(false);
	});
});
