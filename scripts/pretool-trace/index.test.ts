import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateEvent } from "./schema";
import { selectCorrelationInput } from "./index";

const root = process.cwd();
const wrapper = join(root, "scripts/pretool-trace/index.ts");
const child = join(root, "scripts/pretool-trace/fixtures/child.ts");
const originalEnv = { ...process.env };
const dirs: string[] = [];

afterEach(() => {
	for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
	Object.assign(process.env, originalEnv);
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function run(command: string, input: Uint8Array, env: Record<string, string> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pretool-wrapper-")); dirs.push(dir);
	const proc = Bun.spawn(["bun", wrapper, "claude", "fixture", command], { cwd: root, env: { ...process.env, OMT_DIR: join(dir, ".omt"), OMT_SESSION_ID: "test-session", ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	proc.stdin.write(input); proc.stdin.end();
	return { proc, dir, stdout: new Uint8Array(await new Response(proc.stdout).arrayBuffer()), stderr: new Uint8Array(await new Response(proc.stderr).arrayBuffer()), status: await proc.exited };
}

async function runDirect(command: string, input: Uint8Array, env: Record<string, string> = {}) {
	const proc = Bun.spawn(["bash", "-c", command], { cwd: root, env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
	proc.stdin.write(input); proc.stdin.end();
	return { stdout: new Uint8Array(await new Response(proc.stdout).arrayBuffer()), stderr: new Uint8Array(await new Response(proc.stderr).arrayBuffer()), status: await proc.exited };
}

async function waitFor(path: string, timeout = 2000): Promise<void> {
	const end = Date.now() + timeout;
	while (!existsSync(path) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 10));
	if (!existsSync(path)) throw new Error(`readiness timeout: ${path}`);
}

async function waitForGone(pid: number, timeout = 2000): Promise<void> {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		try { process.kill(pid, 0); } catch { return; }
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`process remained alive: ${pid}`);
}

function traceEvents(dir: string) {
	const path = join(dir, ".omt", "pretool-trace", "events.jsonl");
	return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => validateEvent(JSON.parse(line)));
}

function allTraceRecords(dir: string): string[] {
	const traceDir = join(dir, ".omt", "pretool-trace");
	return ["events.jsonl", "events.jsonl.1", "events.jsonl.2", "events.jsonl.3"].flatMap((name) => {
		const path = join(traceDir, name);
		return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean) : [];
	});
}

function expectPaired(events: ReturnType<typeof traceEvents>) {
	expect(events).toHaveLength(2);
	const start = events.find((event) => event.phase === "start");
	const end = events.find((event) => event.phase === "end");
	expect(start).toBeDefined(); expect(end).toBeDefined();
	expect(end?.invocation_id).toBe(start?.invocation_id);
	expect(end?.call_correlation).toBe(start?.call_correlation);
	return end;
}

describe("transparent child contract", () => {
	test("preserves binary stdin and child streams/status", async () => {
		const input = Uint8Array.from([0, 13, 10, 10, 9, 0xc3, 0xa9, 0xff]);
		const baseline = await runDirect(`bun ${child}`, input);
		const wrapped = await run(`bun ${child}`, input, { CHILD_SENTINEL: "same" });
		expect(Buffer.from(wrapped.stdout)).toEqual(Buffer.from(baseline.stdout));
		expect(Buffer.from(wrapped.stderr)).toEqual(Buffer.from(baseline.stderr));
		expect(wrapped.status).toBe(baseline.status);
		expect(createHash("sha256").update(wrapped.stdout).digest("hex")).toBe(createHash("sha256").update(input).digest("hex"));
	});

	test("preserves cwd and environment", async () => {
		const file = join(mkdtempSync(join(tmpdir(), "pretool-child-")), "out.json");
		dirs.push(file.slice(0, file.lastIndexOf("/")));
		const baseline = await runDirect(`bun ${child}`, Buffer.from("x"), { CHILD_SENTINEL: "visible" });
		const result = await run(`bun ${child}`, Buffer.from("x"), { CHILD_WRITE_JSON: file, CHILD_SENTINEL: "visible" });
		expect(result.status).toBe(0);
		expect(result.status).toBe(baseline.status);
		expect(Buffer.from(result.stdout)).toEqual(Buffer.from(baseline.stdout));
		expect(Buffer.from(result.stderr)).toEqual(Buffer.from(baseline.stderr));
		const metadata = JSON.parse(readFileSync(file, "utf8"));
		expect(metadata.cwd).toBe(root);
		expect(metadata.env).toBe("visible");
	});

	test("skips tracing when tool id has no stable session", async () => {
		const selected = selectCorrelationInput({ tool_use_id: "raw-id", tool_name: "Read", tool_input: { x: 1 } }, undefined, Buffer.from("{}"));
		expect(selected.tool_use_id).toBeUndefined();
		const input = Buffer.from('{"tool_use_id":"raw-id","tool_name":"Read","tool_input":{"x":1}}');
		const baseline = await runDirect(`bun ${child}`, input);
		const result = await run(`bun ${child}`, input, { OMT_SESSION_ID: "", CODEX_THREAD_ID: "" });
		expect(result.status).toBe(baseline.status);
		expect(Buffer.from(result.stdout)).toEqual(Buffer.from(baseline.stdout));
		expect(Buffer.from(result.stderr)).toEqual(Buffer.from(baseline.stderr));
		expect(allTraceRecords(result.dir)).toHaveLength(0);
	});

	test("uses exact quality when identity and tool id are present", async () => {
		const result = await run(`bun ${child}`, Buffer.from('{"session_id":"payload-session","tool_use_id":"toolu_123","tool_name":"Read"}'), { OMT_SESSION_ID: "", CODEX_THREAD_ID: "" });
		const start = traceEvents(result.dir).find((event) => event.phase === "start");
		expect(start?.correlation_quality).toBe("exact");
	});

	test("uses fingerprint quality when identity has no tool id", async () => {
		const result = await run(`bun ${child}`, Buffer.from('{"tool_name":"Read","tool_input":{"x":1}}'), { OMT_SESSION_ID: "identity-session", CODEX_THREAD_ID: "" });
		const start = traceEvents(result.dir).find((event) => event.phase === "start");
		expect(start?.correlation_quality).toBe("fingerprint");
		expect(start?.call_correlation).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
	});
});

describe("termination semantics", () => {
	test("preserves child status when child closes stdin before a large payload finishes", async () => {
		const input = new Uint8Array(1024 * 1024).fill(0x61);
		for (const code of [0, 7]) {
			const result = await run(`exec 0<&-; exit ${code}`, input);
			expect(result.status).toBe(code);
			expect(Buffer.from(result.stderr).toString()).not.toContain("EPIPE");
			const end = expectPaired(traceEvents(result.dir));
			expect(end?.process_status).toBe(code);
		}
	});

	test("keeps ordinary exit statuses including 143", async () => {
		for (const code of [0, 1, 2, 143]) {
			const result = await run(`CHILD_EXIT=${code} bun ${child}`, Buffer.from("x"));
			expect(result.status).toBe(code);
			const events = traceEvents(result.dir);
			const end = events.find((event) => event.phase === "end");
			expectPaired(events);
			expect(end?.process_status).toBe(code);
			expect(end?.termination).toBe(code === 143 ? "ambiguous" : "exit");
		}
	});

	test("forwards SIGTERM and records a witnessed signal", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pretool-signal-")); dirs.push(dir);
		const ready = join(dir, "ready.json");
		const proc = Bun.spawn(["bun", wrapper, "claude", "fixture", `bun ${child}`], { cwd: root, env: { ...process.env, OMT_DIR: join(dir, ".omt"), OMT_SESSION_ID: "signal-session", CHILD_READY: ready }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
		proc.stdin.write(Buffer.from("{}")); proc.stdin.end();
		await waitFor(ready); process.kill(proc.pid, "SIGTERM");
		try { expect(await proc.exited).toBe(143); const pids = JSON.parse(readFileSync(ready, "utf8")); await waitForGone(pids.child); await waitForGone(pids.descendant); const end = expectPaired(traceEvents(dir)); expect(end?.termination).toBe("signal"); expect(end?.process_status).toBe(143); expect(end?.signal).toBe(15); expect(end?.signal_name).toBe("SIGTERM"); } finally { const pids = JSON.parse(readFileSync(ready, "utf8")); for (const pid of [pids.child, pids.descendant]) { try { process.kill(pid, "SIGKILL"); } catch {} } }
	});

	test("forwards SIGINT and records its numeric witness", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pretool-sigint-")); dirs.push(dir);
		const ready = join(dir, "ready.json");
		const proc = Bun.spawn(["bun", wrapper, "claude", "fixture", `bun ${child}`], { cwd: root, env: { ...process.env, OMT_DIR: join(dir, ".omt"), OMT_SESSION_ID: "sigint-session", CHILD_READY: ready }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
		proc.stdin.write(Buffer.from("{}")); proc.stdin.end();
		await waitFor(ready); process.kill(proc.pid, "SIGINT");
		try { expect(await proc.exited).toBe(130); const pids = JSON.parse(readFileSync(ready, "utf8")); await waitForGone(pids.child); await waitForGone(pids.descendant); const end = expectPaired(traceEvents(dir)); expect(end?.termination).toBe("signal"); expect(end?.process_status).toBe(130); expect(end?.signal).toBe(2); expect(end?.signal_name).toBe("SIGINT"); } finally { const pids = JSON.parse(readFileSync(ready, "utf8")); for (const pid of [pids.child, pids.descendant]) { try { process.kill(pid, "SIGKILL"); } catch {} } }
	});

	test("records start-only when wrapper is SIGKILLed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pretool-sigkill-")); dirs.push(dir);
		const ready = join(dir, "ready.json");
		const proc = Bun.spawn(["bun", wrapper, "claude", "fixture", `bun ${child}`], { cwd: root, env: { ...process.env, OMT_DIR: join(dir, ".omt"), OMT_SESSION_ID: "sigkill-session", CHILD_READY: ready }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
		proc.stdin.write(Buffer.from("{}")); proc.stdin.end();
		const eventsPath = join(dir, ".omt", "pretool-trace", "events.jsonl");
		try {
			await waitFor(ready); await waitFor(eventsPath);
			process.kill(proc.pid, "SIGKILL");
			expect(await proc.exited).toBe(137);
			const events = traceEvents(dir);
			expect(events.filter((event) => event.phase === "start")).toHaveLength(1);
			expect(events.filter((event) => event.phase === "end")).toHaveLength(0);
			const pids = JSON.parse(readFileSync(ready, "utf8"));
			await Promise.all([waitForGone(pids.child), waitForGone(pids.descendant)]);
			const stderr = Buffer.from(await new Response(proc.stderr).arrayBuffer()).toString();
			expect(stderr).toContain("pretool-trace: watchdog fired after parent exit");
		} finally {
			if (existsSync(ready)) { const pids = JSON.parse(readFileSync(ready, "utf8")); for (const pid of [pids.child, pids.descendant]) { try { process.kill(pid, "SIGKILL"); } catch {} } }
		}
	});

	test("kills a TERM-ignoring child group after wrapper SIGKILL", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pretool-term-ignore-")); dirs.push(dir);
		const pidFile = join(dir, "child.pid");
		const proc = Bun.spawn(["bun", wrapper, "claude", "fixture", `trap '' TERM; printf '%s\\n' "$$" > "$PID_FILE"; sleep 30`], { cwd: root, env: { ...process.env, OMT_DIR: join(dir, ".omt"), OMT_SESSION_ID: "term-ignore-session", PID_FILE: pidFile }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
		proc.stdin.write(Buffer.from("{}")); proc.stdin.end();
		const eventsPath = join(dir, ".omt", "pretool-trace", "events.jsonl");
		try {
			await waitFor(pidFile); await waitFor(eventsPath);
			process.kill(proc.pid, "SIGKILL");
			expect(await proc.exited).toBe(137);
			const events = traceEvents(dir);
			expect(events.filter((event) => event.phase === "start")).toHaveLength(1);
			expect(events.filter((event) => event.phase === "end")).toHaveLength(0);
			await waitForGone(Number(readFileSync(pidFile, "utf8").trim()));
			const stderr = Buffer.from(await new Response(proc.stderr).arrayBuffer()).toString();
			expect(stderr).toContain("pretool-trace: watchdog fired after parent exit");
		} finally {
			if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, "utf8").trim()), "SIGKILL"); } catch {} }
		}
	});

	test("maps unwitnessed child SIGKILL to ambiguous 137", async () => {
		const result = await run("kill -KILL $$", Buffer.from("{}"));
		const events = traceEvents(result.dir);
		expect(result.status).toBe(137);
		expect(events).toHaveLength(2);
		const end = events.find((event) => event.phase === "end");
		expect(end?.termination).toBe("ambiguous"); expect(end?.process_status).toBe(137); expect("signal" in (end ?? {})).toBe(false); expect("signal_name" in (end ?? {})).toBe(false);
	});
});

describe("opt out and fail open", () => {
	test("runs child unchanged when trace is opted out", async () => {
		const baseline = await runDirect(`bun ${child}`, Buffer.from("opt-out"), { CHILD_SENTINEL: "same" });
		const result = await run(`bun ${child}`, Buffer.from("opt-out"), { OMT_HOOK_TRACE_ENABLED: "0", CHILD_SENTINEL: "same" });
		expect(result.status).toBe(baseline.status);
		expect(Buffer.from(result.stdout)).toEqual(Buffer.from(baseline.stdout));
		expect(Buffer.from(result.stderr)).toEqual(Buffer.from(baseline.stderr));
		expect(existsSync(join(result.dir, ".omt"))).toBe(false);
	});

	test("fails open on malformed JSON and unwritable trace root", async () => {
		const secret = "TRACE_SECRET_7f3c";
		const toolId = "RAW_TOOL_ID_42";
		const command = `printf 'CHILD_STDOUT_SENTINEL' ; printf 'CHILD_STDERR_SENTINEL' >&2`;
		const malformed = Buffer.from(`{"session_id":"${secret}","tool_use_id":"${toolId}","tool_input":{"path":"${child}"},`);
		const traced = await run(command, malformed);
		expect(traced.status).toBe(0);
		const records = allTraceRecords(traced.dir); const serialized = records.join("\n");
		for (const line of records) expect(() => validateEvent(JSON.parse(line))).not.toThrow();
		const locator = createHash("sha256").update(`pretool-trace-key-locator:v1\0test-session`).digest("hex");
		const keyPath = join(traced.dir, ".omt", "pretool-trace", "keys", `${locator}.key`);
		const keyHex = readFileSync(keyPath).toString("hex");
		for (const forbidden of [secret, toolId, command, child, root, "CHILD_STDOUT_SENTINEL", "CHILD_STDERR_SENTINEL", "test-session", locator, keyHex]) expect(serialized).not.toContain(forbidden);
		const blockedRoot = join(traced.dir, "not-a-directory");
		writeFileForTest(blockedRoot);
		const baseline = await runDirect(`bun ${child}`, Buffer.from("unwritable"), { HOME: join(traced.dir, "home") });
		const result = await run(`bun ${child}`, Buffer.from("unwritable"), { OMT_DIR: blockedRoot, HOME: join(traced.dir, "home") });
		expect(result.status).toBe(baseline.status);
		expect(Buffer.from(result.stdout)).toEqual(Buffer.from(baseline.stdout));
		expect(Buffer.from(result.stderr)).toEqual(Buffer.from(baseline.stderr));
		expect(existsSync(join(traced.dir, "home", ".omt"))).toBe(false);
	});
});

function writeFileForTest(path: string): void {
	writeFileSync(path, "regular-file");
}
