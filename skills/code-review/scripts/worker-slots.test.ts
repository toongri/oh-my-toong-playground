import { describe, it, expect, afterEach, jest } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";

import { resolveSlotCount, slotsDir, acquireWorkerSlot, releaseWorkerSlot } from "./worker-slots.ts";
import { tryAcquireWorkerSlot } from "../../../lib/worker-slots.ts";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "worker-slots-test-"));
}

/** Poll-wait seam: counts failed scans and yields to the event loop instead of timing. */
function countingSleep() {
	let polls = 0;
	const waiters: Array<{ n: number; resolve: () => void }> = [];
	return {
		sleep: async () => {
			polls += 1;
			for (const w of waiters) if (polls >= w.n) w.resolve();
			await new Promise((resolve) => setImmediate(resolve));
		},
		waitForPolls: (n: number) =>
			polls >= n ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ n, resolve })),
		get polls() {
			return polls;
		},
	};
}

describe("resolveSlotCount", () => {
	const originalEnv = process.env.OMT_WORKER_SLOTS;

	afterEach(() => {
		if (originalEnv === undefined) delete process.env.OMT_WORKER_SLOTS;
		else process.env.OMT_WORKER_SLOTS = originalEnv;
	});

	it("OMT_WORKER_SLOTS가 없으면 30을 기본값으로 쓴다", () => {
		delete process.env.OMT_WORKER_SLOTS;
		expect(resolveSlotCount()).toBe(30);
	});

	it("OMT_WORKER_SLOTS로 슬롯 수를 오버라이드할 수 있다", () => {
		process.env.OMT_WORKER_SLOTS = "3";
		expect(resolveSlotCount()).toBe(3);
	});

	it("0 이하이거나 숫자가 아닌 오버라이드 값은 무시하고 기본값으로 되돌아간다", () => {
		for (const bad of ["0", "-1", "abc", "", "1.5"]) {
			process.env.OMT_WORKER_SLOTS = bad;
			expect(resolveSlotCount()).toBe(30);
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

		const poller = countingSleep();
		let secondAcquired = false;
		const secondPromise = acquireWorkerSlot({ dir, slotCount: 1, sleep: poller.sleep }).then((slot) => {
			secondAcquired = true;
			return slot;
		});

		// Pool is size 1 and still held by `first` — wait until the poller has
		// scanned and failed several times to prove it does NOT get through.
		await poller.waitForPolls(3);
		expect(secondAcquired).toBe(false);

		releaseWorkerSlot(first);
		const second = await secondPromise;
		expect(secondAcquired).toBe(true);
		expect(second.slotPath).toBe(first.slotPath);

		releaseWorkerSlot(second);
	});

	it("tryAcquireWorkerSlot은 빈 슬롯을 즉시 반환하고 점유 중에는 null을 반환한다", () => {
		dir = makeTmpDir();
		const first = tryAcquireWorkerSlot({ dir, slotCount: 1 });
		expect(first).not.toBeNull();
		expect(tryAcquireWorkerSlot({ dir, slotCount: 1 })).toBeNull();
		releaseWorkerSlot(first!);
	});

	it("tryAcquireWorkerSlot은 abort된 signal에서 claim하지 않고 AbortError를 던진다", () => {
		dir = makeTmpDir();
		const controller = new AbortController();
		controller.abort();

		expect(() => tryAcquireWorkerSlot({ dir, slotCount: 1, signal: controller.signal })).toThrow(
			 expect.objectContaining({ name: "AbortError" }),
		);
		expect(fs.readdirSync(dir)).toEqual([]);
	});

	it("이미 abort된 signal은 슬롯을 주장하기 전에 AbortError로 거부한다", async () => {
		dir = makeTmpDir();
		const controller = new AbortController();
		controller.abort();

		await expect(acquireWorkerSlot({ dir, slotCount: 1, signal: controller.signal })).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(fs.readdirSync(dir)).toEqual([]);
	});

	it("풀이 가득 찬 동안 abort하면 polling timer를 남기지 않고 즉시 거부한다", async () => {
		dir = makeTmpDir();
		const first = await acquireWorkerSlot({ dir, slotCount: 1 });
		const controller = new AbortController();
		// pollMs far beyond any test timeout: only the abort can settle `pending`.
		const pending = acquireWorkerSlot({ dir, slotCount: 1, pollMs: 3_600_000, signal: controller.signal });

		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(fs.existsSync(first.slotPath)).toBe(true);

		releaseWorkerSlot(first);
		const replacement = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 });
		releaseWorkerSlot(replacement);
	});

	it("acquire 중 signal이 abort되어도 방금 주장한 슬롯을 즉시 반납한다", async () => {
		dir = makeTmpDir();
		let reads = 0;
		const signal = {
			get aborted() {
				reads += 1;
				return reads > 1;
			},
			addEventListener() {},
			removeEventListener() {},
		} as unknown as AbortSignal;

		await expect(acquireWorkerSlot({ dir, slotCount: 1, signal })).rejects.toMatchObject({ name: "AbortError" });
		expect(fs.readdirSync(dir)).toEqual([]);
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
let polls = 0;
let enoughPolls;
const enough = new Promise((resolve) => (enoughPolls = resolve));
const sleep = async () => {
\tpolls++;
\tif (polls >= 9) enoughPolls();
\tawait new Promise((resolve) => setImmediate(resolve));
};
const contenders = [1, 2, 3].map(() =>
\tacquireWorkerSlot({ dir, slotCount: 1, sleep }).then((slot) => {
\t\tcontenderAcquired++;
\t\treturn slot;
\t}),
);
await enough;
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
				timeout: 45_000,
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

	it("heartbeat는 owner record를 갱신하고 release 시 heartbeat timer를 해제한다", async () => {
		dir = makeTmpDir();
		jest.useFakeTimers();
		try {
			const slot = tryAcquireWorkerSlot({ dir, slotCount: 1 });
			expect(slot).not.toBeNull();
			expect(jest.getTimerCount()).toBe(1);
			const initialMtimeMs = fs.statSync(slot!.ownerRecordPath).mtimeMs;

			// Fake clock: heartbeat ticks run synchronously and stamp the faked "now".
			jest.advanceTimersByTime(60_000);
			expect(fs.statSync(slot!.ownerRecordPath).mtimeMs).toBeGreaterThan(initialMtimeMs);

			releaseWorkerSlot(slot!);
			expect(jest.getTimerCount()).toBe(0);
		} finally {
			jest.useRealTimers();
		}
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

		// Reclaim must happen on the first synchronous scan: the poll wait is
		// never entered.
		const poller = countingSleep();
		const slot = await acquireWorkerSlot({ dir, slotCount: 1, sleep: poller.sleep });

		expect(slot.slotPath).toBe(path.join(dir, "slot-0"));
		expect(poller.polls).toBe(0);

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
		const poller = countingSleep();
		let claimedWhileFresh = false;
		const pending = acquireWorkerSlot({ dir, slotCount: 1, sleep: poller.sleep }).then((slot) => {
			claimedWhileFresh = true;
			return slot;
		});
		await poller.waitForPolls(3);
		expect(claimedWhileFresh).toBe(false);

		// Backdate it past the staleness bound — now it reads as truly abandoned.
		const past = new Date(Date.now() - 5 * 60 * 1000);
		fs.utimesSync(slotPath, past, past);

		const slot = await pending;
		expect(claimedWhileFresh).toBe(true);
		releaseWorkerSlot(slot);
	});

	it("claim publication은 canonical slot을 빈 디렉터리로 만들지 않는다", async () => {
		dir = makeTmpDir();
		const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
		const slotPath = path.join(dir, "slot-0");
		fs.mkdirSync(slotPath);
		fs.writeFileSync(path.join(slotPath, "owner-dead.json"), JSON.stringify({ pid: dead.pid }));

		const originalRename = fs.renameSync;
		let observedPublication = false;
		fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
			if (to === slotPath) {
				observedPublication = true;
				expect(fs.existsSync(slotPath)).toBe(false);
				expect(fs.readdirSync(from as string)).toHaveLength(1);
			}
			return originalRename(from, to);
		}) as typeof fs.renameSync;
		try {
			const slot = await acquireWorkerSlot({ dir, slotCount: 1, pollMs: 20 });
			releaseWorkerSlot(slot);
		} finally {
			fs.renameSync = originalRename;
		}
		expect(observedPublication).toBe(true);
	});

	it("동시에 dead-owner를 회수해도 cap 1에서 한 contender만 claim한다", async () => {
		dir = makeTmpDir();
		const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
		const slotPath = path.join(dir, "slot-0");
		fs.mkdirSync(slotPath);
		fs.writeFileSync(
			path.join(slotPath, "owner-dead.json"),
			JSON.stringify({ pid: dead.pid, pidStartedAt: "Thu Jan  1 00:00:00 1970" }),
		);
		// A hit holds its slot until the parent closes stdin, which happens only
		// after both contenders reported — a late starter can never see a free slot.
		const script = `
import { tryAcquireWorkerSlot, releaseWorkerSlot } from ${JSON.stringify(path.resolve(import.meta.dirname, "../../../lib/worker-slots.ts"))};
const slot = tryAcquireWorkerSlot({ dir: process.env.WORKER_SLOTS_TEST_DIR, slotCount: 1 });
if (slot === null) process.stdout.write("miss");
else {
  process.stdout.write("hit");
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.on("end", resolve));
  releaseWorkerSlot(slot);
}
`;
		const contenders = [1, 2].map(() => {
			const child = spawn(process.execPath, ["-e", script], {
				cwd: path.resolve(import.meta.dirname, "../../.."),
				env: { ...process.env, WORKER_SLOTS_TEST_DIR: dir },
				stdio: ["pipe", "pipe", "inherit"],
			});
			let output = "";
			const reported = new Promise<void>((resolve, reject) => {
				child.stdout.on("data", (chunk: Buffer) => {
					output += chunk.toString("utf8");
					resolve();
				});
				child.on("error", reject);
				child.on("close", () => reject(new Error("child exited without reporting")));
			});
			const closed = new Promise<string>((resolve, reject) => {
				child.on("error", reject);
				child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`child exited ${code}`))));
			});
			return { child, reported, closed };
		});
		await Promise.all(contenders.map((c) => c.reported));
		for (const c of contenders) c.child.stdin.end();
		const results = await Promise.all(contenders.map((c) => c.closed));
		expect(results.filter((result) => result === "hit")).toHaveLength(1);
		expect(results.filter((result) => result === "miss")).toHaveLength(1);
	});

	it("malformed owner record는 fresh 상태에서 유지되고 stale 상태에서만 회수한다", async () => {
		dir = makeTmpDir();
		const slotPath = path.join(dir, "slot-0");
		const ownerRecordPath = path.join(slotPath, "owner-dead.json");
		fs.mkdirSync(slotPath);
		fs.writeFileSync(ownerRecordPath, "not-json");

		const poller = countingSleep();
		let claimedWhileFresh = false;
		const pending = acquireWorkerSlot({ dir, slotCount: 1, sleep: poller.sleep }).then((slot) => {
			claimedWhileFresh = true;
			return slot;
		});
		await poller.waitForPolls(3);
		expect(claimedWhileFresh).toBe(false);

		const past = new Date(Date.now() - 5 * 60 * 1000);
		fs.utimesSync(slotPath, past, past);

		const slot = await pending;
		expect(claimedWhileFresh).toBe(true);
		expect(fs.existsSync(ownerRecordPath)).toBe(false);
		releaseWorkerSlot(slot);
	});
});
