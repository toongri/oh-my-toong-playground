import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

import { resolveSlotCount, slotsDir, acquireWorkerSlot, releaseWorkerSlot } from "./worker-slots.ts";

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

describe("slotsDir", () => {
	const originalOmtDir = process.env.OMT_DIR;

	afterEach(() => {
		if (originalOmtDir === undefined) delete process.env.OMT_DIR;
		else process.env.OMT_DIR = originalOmtDir;
	});

	it("서로 다른 OMT_DIR에서도 HOME 기준 machine-wide v2 경로를 반환한다", () => {
		const firstOmtDir = makeTmpDir();
		const secondOmtDir = makeTmpDir();
		const expected = path.join(os.homedir(), ".omt", "worker-slots", "v2");

		try {
			process.env.OMT_DIR = firstOmtDir;
			const firstSlotsDir = slotsDir();
			process.env.OMT_DIR = secondOmtDir;
			const secondSlotsDir = slotsDir();

			expect(firstSlotsDir).toBe(expected);
			expect(secondSlotsDir).toBe(expected);
			expect(path.relative(firstOmtDir, firstSlotsDir).split(path.sep)[0]).toBe("..");
			expect(path.relative(secondOmtDir, secondSlotsDir).split(path.sep)[0]).toBe("..");
		} finally {
			fs.rmSync(firstOmtDir, { recursive: true, force: true });
			fs.rmSync(secondOmtDir, { recursive: true, force: true });
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

	it("정상 live owner를 여러 contender가 polling해도 ps를 반복 호출하지 않는다", async () => {
		dir = makeTmpDir();
		const wrapperDir = makeTmpDir();
		const psCallsPath = path.join(wrapperDir, "ps-calls");
		const realPs = spawnSync("sh", ["-c", "command -v ps"], { encoding: "utf8" }).stdout.trim();
		expect(realPs).not.toBe("");

		const fakePsPath = path.join(wrapperDir, "ps");
		fs.writeFileSync(
			fakePsPath,
			[
				"#!/bin/sh",
				`printf '%s\\n' call >> ${JSON.stringify(psCallsPath)}`,
				`exec ${JSON.stringify(realPs)} "$@"`,
			].join("\n"),
			"utf8",
		);
		fs.chmodSync(fakePsPath, 0o755);

		try {
			// Start a separate Bun process after installing the wrapper. Bun snapshots
			// the child environment at process start, so changing PATH in this test
			// process after importing worker-slots.ts would not intercept execSync.
			const script = `
import fs from "fs";
import { acquireWorkerSlot, releaseWorkerSlot } from ${JSON.stringify(path.resolve(import.meta.dirname, "worker-slots.ts"))};

const dir = process.env.WORKER_SLOTS_TEST_DIR;
const psCallsPath = process.env.WORKER_SLOTS_TEST_PS_CALLS;
if (typeof dir !== "string" || typeof psCallsPath !== "string") process.exit(2);

function countCalls() {
\tif (!fs.existsSync(psCallsPath)) return 0;
\tconst content = fs.readFileSync(psCallsPath, "utf8").trim();
\treturn content === "" ? 0 : content.split("\\n").length;
}

const first = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 });
const callsAfterAcquire = countCalls();
let contenderAcquired = 0;
const contenders = [1, 2, 3].map(() =>
\tacquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 }).then((slot) => {
\t\tcontenderAcquired++;
\t\treturn slot;
\t}),
);
await new Promise((resolve) => setTimeout(resolve, 120));
const callsWhileOccupied = countCalls();
const marker = { callsAfterAcquire, callsWhileOccupied, contenderAcquired };

releaseWorkerSlot(first);
await Promise.all(
\tcontenders.map(async (promise) => {
\t\tconst slot = await promise;
\t\treleaseWorkerSlot(slot);
\t}),
);
console.log(JSON.stringify(marker));
`;
			const child = spawnSync(process.execPath, ["-e", script], {
				cwd: path.resolve(import.meta.dirname, "../../.."),
				encoding: "utf8",
				env: {
					...process.env,
					PATH: process.env.PATH === undefined ? wrapperDir : `${wrapperDir}:${process.env.PATH}`,
					WORKER_SLOTS_TEST_DIR: dir,
					WORKER_SLOTS_TEST_PS_CALLS: psCallsPath,
				},
			});

			expect(child.status).toBe(0);
			const marker = JSON.parse(child.stdout.trim());
			expect(marker.contenderAcquired).toBe(0);
			expect(marker.callsAfterAcquire).toBeGreaterThan(0);
			expect(marker.callsWhileOccupied).toBe(marker.callsAfterAcquire);
		} finally {
			fs.rmSync(wrapperDir, { recursive: true, force: true });
		}
	});

	it("heartbeat는 owner record를 갱신하고 release 뒤에는 같은 경로를 갱신하지 않는다", async () => {
		dir = makeTmpDir();
		const script = `
import fs from "fs";
import { acquireWorkerSlot, releaseWorkerSlot } from ${JSON.stringify(path.resolve(import.meta.dirname, "worker-slots.ts"))};

const dir = process.env.WORKER_SLOTS_TEST_DIR;
if (typeof dir !== "string") process.exit(2);

const slot = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 });
let heartbeatObserved = false;
let markerChangedAfterRelease = false;
try {
\tconst initialMtimeMs = fs.statSync(slot.ownerRecordPath).mtimeMs;
\tconst heartbeatDeadline = Date.now() + 2500;
\twhile (Date.now() < heartbeatDeadline) {
\t\tif (fs.statSync(slot.ownerRecordPath).mtimeMs > initialMtimeMs) {
\t\t\theartbeatObserved = true;
\t\t\tbreak;
\t\t}
\t\tawait new Promise((resolve) => setTimeout(resolve, 20));
\t}

\treleaseWorkerSlot(slot);
\tfs.mkdirSync(slot.slotPath);
\tfs.writeFileSync(slot.ownerRecordPath, "released-owner-marker");
\tconst markerMtimeMs = fs.statSync(slot.ownerRecordPath).mtimeMs;
\tconst releaseDeadline = Date.now() + 1500;
\twhile (Date.now() < releaseDeadline) {
\t\tif (fs.statSync(slot.ownerRecordPath).mtimeMs !== markerMtimeMs) {
\t\t\tmarkerChangedAfterRelease = true;
\t\t\tbreak;
\t\t}
\t\tawait new Promise((resolve) => setTimeout(resolve, 20));
\t}
} finally {
\treleaseWorkerSlot(slot);
\tif (fs.existsSync(slot.slotPath)) fs.rmSync(slot.slotPath, { recursive: true, force: true });
}
console.log(JSON.stringify({ heartbeatObserved, markerChangedAfterRelease }));
`;
		const child = spawnSync(process.execPath, ["-e", script], {
			cwd: path.resolve(import.meta.dirname, "../../.."),
			encoding: "utf8",
			env: { ...process.env, WORKER_SLOTS_TEST_DIR: dir },
		});

		expect(child.status).toBe(0);
		const marker = JSON.parse(child.stdout.trim());
		expect(marker.heartbeatObserved).toBe(true);
		expect(marker.markerChangedAfterRelease).toBe(false);
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
