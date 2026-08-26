import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import { resolveSlotCount, acquireWorkerSlot, releaseWorkerSlot } from "./worker-slots.ts";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "worker-slots-test-"));
}

describe("resolveSlotCount", () => {
	const originalEnv = process.env.OMT_WORKER_SLOTS;

	afterEach(() => {
		if (originalEnv === undefined) delete process.env.OMT_WORKER_SLOTS;
		else process.env.OMT_WORKER_SLOTS = originalEnv;
	});

	it("OMT_WORKER_SLOTS가 없으면 12를 기본값으로 쓴다", () => {
		delete process.env.OMT_WORKER_SLOTS;
		expect(resolveSlotCount()).toBe(12);
	});

	it("OMT_WORKER_SLOTS로 슬롯 수를 오버라이드할 수 있다", () => {
		process.env.OMT_WORKER_SLOTS = "3";
		expect(resolveSlotCount()).toBe(3);
	});

	it("0 이하이거나 숫자가 아닌 오버라이드 값은 무시하고 기본값으로 되돌아간다", () => {
		for (const bad of ["0", "-1", "abc", "", "1.5"]) {
			process.env.OMT_WORKER_SLOTS = bad;
			expect(resolveSlotCount()).toBe(12);
		}
	});
});

describe("acquireWorkerSlot / releaseWorkerSlot", () => {
	let dir: string;

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("빈 풀에서 첫 acquire는 즉시 성공하고, release 후 슬롯 디렉터리가 사라진다", async () => {
		dir = makeTmpDir();
		const slot = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 });
		expect(fs.statSync(slot.slotPath).isDirectory()).toBe(true);
		expect(fs.readdirSync(slot.slotPath)).toEqual([path.basename(slot.ownerRecordPath)]);
		expect(JSON.parse(fs.readFileSync(slot.ownerRecordPath, "utf8"))).toHaveProperty("pid", process.pid);

		releaseWorkerSlot(slot);
		expect(fs.existsSync(slot.slotPath)).toBe(false);
		releaseWorkerSlot(slot);
		expect(fs.existsSync(slot.slotPath)).toBe(false);
	});

	it("이전 세대의 늦은 release가 새 owner의 슬롯을 지우지 않는다", async () => {
		dir = makeTmpDir();
		const first = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 });
		releaseWorkerSlot(first);

		const second = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 });
		releaseWorkerSlot(first);

		expect(fs.existsSync(second.slotPath)).toBe(true);
		releaseWorkerSlot(second);
	});

	it("슬롯이 가득 차면 대기하다가, 반납되면 그때 진행한다", async () => {
		dir = makeTmpDir();
		const first = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 });

		let secondAcquired = false;
		const secondPromise = acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 }).then((slot) => {
			secondAcquired = true;
			return slot;
		});

		// Pool is size 1 and still held by `first` — give the poller several
		// cycles to prove it does NOT get through while occupied.
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(secondAcquired).toBe(false);

		releaseWorkerSlot(first);
		const second = await secondPromise;
		expect(secondAcquired).toBe(true);
		expect(second.slotPath).toBe(first.slotPath);

		releaseWorkerSlot(second);
	});

	it("점유 중이던 프로세스가 이미 죽었으면 대기 없이(폴링 주기를 기다리지 않고) 슬롯을 즉시 회수한다", async () => {
		dir = makeTmpDir();
		fs.mkdirSync(dir, { recursive: true });

		// Spawn a real, short-lived process and let it exit — a genuinely dead
		// pid, not a guessed-unused number — then squat its slot directory with that
		// now-dead pid, mirroring a worker that was SIGKILLed/panicked before
		// it ever reached releaseWorkerSlot.
		const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
		const deadPid = child.pid;
		expect(typeof deadPid).toBe("number");

		const slotPath = path.join(dir, "slot-0");
		fs.mkdirSync(slotPath);
		fs.writeFileSync(
			path.join(slotPath, "owner-dead.json"),
			JSON.stringify({ pid: deadPid, pidStartedAt: "Thu Jan  1 00:00:00 1970" }),
		);

		const before = Date.now();
		// pollMs is set deliberately large: if reclaim required waiting a full
		// poll cycle instead of happening on the first synchronous scan, this
		// assertion below on elapsed time would fail.
		const slot = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 5000 });
		const elapsed = Date.now() - before;

		expect(slot.slotPath).toBe(path.join(dir, "slot-0"));
		expect(elapsed).toBeLessThan(2000);

		releaseWorkerSlot(slot);
	});

	it("소유자 pid 기록이 없는(쓰기 도중 죽은) 슬롯 디렉터리는 오래됐을 때만 회수한다", async () => {
		dir = makeTmpDir();
		fs.mkdirSync(dir, { recursive: true });
		const slotPath = path.join(dir, "slot-0");

		// Empty directory mirrors a slot whose owner reserved the directory but
		// was killed before the completed owner record was installed.
		fs.mkdirSync(slotPath);
		// Fresh (mtime "now"): must NOT be reclaimed yet — indistinguishable
		// from the normal sub-millisecond open/write race.
		let claimedWhileFresh = false;
		const pending = acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 }).then((slot) => {
			claimedWhileFresh = true;
			return slot;
		});
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(claimedWhileFresh).toBe(false);

		// Backdate it past the staleness bound — now it reads as truly abandoned.
		const past = new Date(Date.now() - 5 * 60 * 1000);
		fs.utimesSync(slotPath, past, past);

		const slot = await pending;
		expect(claimedWhileFresh).toBe(true);
		releaseWorkerSlot(slot);
	});

	it("malformed owner record는 fresh 상태에서 유지되고 stale 상태에서만 회수한다", async () => {
		dir = makeTmpDir();
		const slotPath = path.join(dir, "slot-0");
		const ownerRecordPath = path.join(slotPath, "owner-dead.json");
		fs.mkdirSync(slotPath);
		fs.writeFileSync(ownerRecordPath, "not-json");

		let claimedWhileFresh = false;
		const pending = acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 }).then((slot) => {
			claimedWhileFresh = true;
			return slot;
		});
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(claimedWhileFresh).toBe(false);

		const past = new Date(Date.now() - 5 * 60 * 1000);
		fs.utimesSync(slotPath, past, past);

		const slot = await pending;
		expect(claimedWhileFresh).toBe(true);
		expect(fs.existsSync(ownerRecordPath)).toBe(false);
		releaseWorkerSlot(slot);
	});
});
