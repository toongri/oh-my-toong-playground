#!/usr/bin/env bun

// worker.ts 종료 경로에 lib/worker-utils.ts의 reapOwnProcessGroup이 실제로 연결돼
// 있는지를 검증하는 헤르메틱 통합 테스트. 실제 worker.ts를 detached 자식으로 띄우고,
// 그 워커가 실행하는 커맨드(셸 스크립트)가 백그라운드 자손(sleep)을 남긴 채 자신은
// 먼저 종료하는 시나리오에서, 워커의 프로세스 그룹 전체가 결국 0개로 회수되는지를
// ps로 직접 관찰한다.
//
// job.ts의 cmdStart/spawnWorkers를 거치지 않고 worker.ts를 직접 spawn한다 — 이 파일이
// job.test.ts와 같은 bun test 프로세스에서 함께 실행될 때, 다른 describe 블록의
// `mock.module("@lib/generic-job", ...)`(spawnWorkers 오버라이드)가 파일 경계를 넘어
// 살아있는 경우에도 영향받지 않게 하기 위함이다.
//
// 한계: 이 테스트는 워커가 자신의 정상 종료 경로(.then 콜백)를 실제로 타는 경우만
// 검증한다. 워커 자신이 SIGKILL·패닉·OOM으로 죽어 이 경로에 도달하지 못하는 경우는
// 이 계층(계층 1: 워커 자가회수)이 잡지 못한다 — 그건 별도의 고아 회수기(계층 3:
// SessionStart 고아 회수기)의 몫이다.

import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execSync } from "child_process";

const WORKER_PATH = path.join(import.meta.dirname, "worker.ts");

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "worker-reap-test-"));
}

/** 지정한 pgid에 속한 (pid, comm) 목록을 ps로 직접 조회한다 (macOS BSD ps 호환). */
function processesInGroup(pgid: number): { pid: number; comm: string }[] {
	const output = execSync("ps -o pgid=,pid=,comm= -A", { encoding: "utf8" });
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [pgidStr, pidStr, ...rest] = line.split(/\s+/);
			return { pgid: Number(pgidStr), pid: Number(pidStr), comm: rest.join(" ") };
		})
		.filter((entry) => entry.pgid === pgid)
		.map(({ pid, comm }) => ({ pid, comm }));
}

describe("worker.ts 종료 경로 — reapOwnProcessGroup 연결", () => {
	test(
		"워커가 실행한 커맨드가 자기보다 오래 사는 백그라운드 자손을 남겨도, 워커 종료 후 해당 프로세스 그룹은 결국 0개로 회수된다",
		async () => {
			const tmpDir = makeTmpDir();
			try {
				const markerPath = path.join(tmpDir, "sleep-spawned.marker");
				const scriptPath = path.join(tmpDir, "leak-child.sh");
				fs.writeFileSync(
					scriptPath,
					[
						"#!/bin/sh",
						// stdio를 /dev/null로 명시적으로 돌려 워커 파이프를 붙잡지 않게 한다 —
						// 그러지 않으면 이 백그라운드 자손이 상속받은 파이프 쓰기단을 계속
						// 쥐고 있어 부모 스크립트가 exit해도 Node의 child 'close' 이벤트가
						// (sleep 30초 동안) 지연된다.
						"sleep 30 </dev/null >/dev/null 2>&1 &",
						`echo $! > ${JSON.stringify(markerPath)}`,
						// 마커를 남긴 뒤 고정된 3초를 대기한다 — 테스트가 "자손이 실제로
						// 살아 있었음"을 관찰할 확정적인 창(타이밍 레이스가 아님)을 준다.
						"sleep 3",
						"exit 0",
					].join("\n"),
					"utf8",
				);
				fs.chmodSync(scriptPath, 0o755);

				const jobDir = path.join(tmpDir, "job");
				const memberDir = path.join(jobDir, "members", "leaker");
				fs.mkdirSync(memberDir, { recursive: true });

				const worker = spawn(
					process.execPath,
					[
						WORKER_PATH,
						"--job-dir",
						jobDir,
						"--member",
						"leaker",
						"--command",
						scriptPath,
						"--timeout",
						"60",
					],
					{ detached: true, stdio: "ignore", env: process.env },
				);
				const workerPgid = worker.pid;
				worker.unref();
				expect(typeof workerPgid).toBe("number");
				if (workerPgid === undefined) throw new Error("spawn failed to produce a pid");

				try {
					// 자손이 실제로 살아 있었음을 먼저 확인 — 마커가 나타날 때까지 폴링한다.
					// 이게 없으면 "애초에 아무것도 안 떴는데 0개라서 통과"하는 공허한
					// 초록이 된다. 이 단계는 필수다.
					const spawnDeadline = Date.now() + 5000;
					while (!fs.existsSync(markerPath) && Date.now() < spawnDeadline) {
						await new Promise((resolve) => setTimeout(resolve, 50));
					}
					expect(fs.existsSync(markerPath)).toBe(true);

					const aliveBeforeReap = processesInGroup(workerPgid);
					expect(aliveBeforeReap.length).toBeGreaterThanOrEqual(2);
					expect(aliveBeforeReap.some((p) => p.comm.includes("sleep"))).toBe(true);

					// 워커 종료(스크립트의 3초 대기 + close 이벤트) + 자가회수 유예(5초) +
					// 여유분을 기다린 뒤, 그룹이 완전히 회수됐는지 확인한다.
					const reapDeadline = Date.now() + 20000;
					let remaining = processesInGroup(workerPgid);
					while (remaining.length > 0 && Date.now() < reapDeadline) {
						await new Promise((resolve) => setTimeout(resolve, 300));
						remaining = processesInGroup(workerPgid);
					}

					expect(remaining).toHaveLength(0);
				} finally {
					// 회수 실패(RED 재현 등) 대비 — 남은 프로세스 그룹을 정리한다.
					try {
						process.kill(-workerPgid, "SIGKILL");
					} catch {
						/* 이미 회수됨 — 정리할 것 없음 */
					}
				}
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		},
		60000,
	);
});
