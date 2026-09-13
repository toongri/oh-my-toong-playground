import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { pathToFileURL } from "url";
import {
	CANCELLATION_MARKER,
	isWorkerCancellationRequested,
	observeWorkerCancellation,
	requestWorkerCancellation,
} from "./worker-cancellation.ts";

const dirs: string[] = [];

function makeMemberDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "worker-cancellation-test-"));
	dirs.push(dir);
	return dir;
}

function waitForAbort(signal: AbortSignal, timeoutMs = 2_000): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timed out waiting for cancellation")), timeoutMs);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

function waitForChildExit(
	child: ReturnType<typeof spawn>,
	timeoutMs = 2_000,
): Promise<{ code: number | null; stdout: string }> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			reject(new Error("child process did not exit after external abort"));
		}, timeoutMs);
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ code, stdout });
		});
	});
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("worker cancellation", () => {
	it("취소 marker를 내구적으로 기록하고 반복 요청을 멱등 처리한다", () => {
		const memberDir = makeMemberDir();

		requestWorkerCancellation(memberDir, "stop requested");
		requestWorkerCancellation(memberDir, "stop requested again");

		expect(existsSync(join(memberDir, CANCELLATION_MARKER))).toBe(true);
		expect(isWorkerCancellationRequested(memberDir)).toBe(true);
		expect(JSON.parse(readFileSync(join(memberDir, CANCELLATION_MARKER), "utf8"))).toMatchObject({
			reason: "stop requested again",
		});
	});

	it("읽을 수 없는 기존 marker를 취소로 보수 판정한다", () => {
		const memberDir = makeMemberDir();
		writeFileSync(join(memberDir, CANCELLATION_MARKER), "not json", "utf8");

		expect(isWorkerCancellationRequested(memberDir)).toBe(true);
	});

	it("없는 marker를 미취소로 판정한다", () => {
		expect(isWorkerCancellationRequested(makeMemberDir())).toBe(false);
	});

	it("존재하지 않는 member 디렉터리에 기록할 때 오류를 전파한다", () => {
		expect(() => requestWorkerCancellation(join(makeMemberDir(), "missing"))).toThrow();
	});

	it("다른 프로세스가 기록한 marker를 관찰한다", async () => {
		const memberDir = makeMemberDir();
		const observation = observeWorkerCancellation(memberDir);
		const child = spawn(process.execPath, [
			"-e",
			`setTimeout(() => Bun.write(process.argv[1] + "/${CANCELLATION_MARKER}", "{}"), 50)`,
			memberDir,
		]);

		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(existsSync(join(memberDir, CANCELLATION_MARKER))).toBe(true);
		await waitForAbort(observation.signal);
		observation.dispose();
		child.kill();
	});

	it("이미 취소된 상태로 시작하고 외부 abort를 relay한다", async () => {
		const memberDir = makeMemberDir();
		requestWorkerCancellation(memberDir);
		const preexisting = observeWorkerCancellation(memberDir);
		expect(preexisting.signal.aborted).toBe(true);
		preexisting.dispose();

		const freshMemberDir = makeMemberDir();
		const moduleUrl = pathToFileURL(join(process.cwd(), "lib/worker-cancellation.ts")).href;
		const child = spawn(process.execPath, [
			"-e",
			[
				`const { observeWorkerCancellation } = await import(${JSON.stringify(moduleUrl)});`,
				"const upstream = new AbortController();",
				"const observation = observeWorkerCancellation(process.argv[1], upstream.signal);",
				"if (observation.signal.aborted) process.exit(2);",
				"observation.signal.addEventListener('abort', () => process.stdout.write('aborted\\n'));",
				"setTimeout(() => upstream.abort(), 50);",
			].join(" "),
			freshMemberDir,
		]);

		const result = await waitForChildExit(child);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("aborted");
	});

	it("dispose가 polling과 upstream listener를 정리한다", async () => {
		const memberDir = makeMemberDir();
		const upstream = new AbortController();
		const observation = observeWorkerCancellation(memberDir, upstream.signal);

		observation.dispose();
		requestWorkerCancellation(memberDir);
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(observation.signal.aborted).toBe(false);
		upstream.abort();
		expect(observation.signal.aborted).toBe(false);
	});
});
