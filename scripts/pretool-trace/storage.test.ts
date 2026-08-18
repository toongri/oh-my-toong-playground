import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { appendEvent, getSessionKey, storagePaths } from "./storage";

const roots: string[] = [];
const originalHome = process.env.HOME;
const originalOmtDir = process.env.OMT_DIR;
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	if (originalOmtDir === undefined) delete process.env.OMT_DIR;
	else process.env.OMT_DIR = originalOmtDir;
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
});

function root(): string {
	const value = mkdtempSync(join(tmpdir(), "pretool-storage-"));
	roots.push(value);
	process.env.OMT_DIR = value;
	return value;
}

async function concurrentChildren(script: string, count: number, env: Record<string, string>): Promise<string[]> {
	const children = Array.from({ length: count }, () => Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" }));
	return Promise.all(children.map(async (child) => {
		const output = await new Response(child.stdout).text();
		await child.exited;
		expect(child.exitCode).toBe(0);
		return output.trim();
	}));
}

describe("pre-tool trace storage", () => {
	test("concurrent key and append — converges one atomic key per locator", async () => {
		root();
		const locator = "a".repeat(64);
		const modulePath = join(import.meta.dir, "storage.ts");
		const keys = await concurrentChildren(`import {getSessionKey} from ${JSON.stringify(modulePath)}; process.stdout.write(Buffer.from(getSessionKey(${JSON.stringify(locator)})).toString("hex"));`, 20, { OMT_DIR: process.env.OMT_DIR! });
		expect(new Set(keys.map((key) => Buffer.from(key).toString("hex"))).size).toBe(1);
		expect(Buffer.from(keys[0], "hex")).toHaveLength(32);
		const keyFile = readdirSync(storagePaths().keys).find((name) => name.endsWith(".key"));
		expect(keyFile).toBe(`${locator}.key`);
		expect(statSync(storagePaths().keys).mode & 0o777).toBe(0o700);
		expect(statSync(join(storagePaths().keys, keyFile!)).mode & 0o777).toBe(0o600);
	});

	test("concurrent key and append — keeps successful concurrent writes complete", async () => {
		root();
		const modulePath = join(import.meta.dir, "storage.ts");
		const results = await concurrentChildren(`import {appendEvent} from ${JSON.stringify(modulePath)}; const writer_id=${JSON.stringify("writer-")}+process.pid; const ok=appendEvent({writer_id}); process.stdout.write(JSON.stringify({writer_id,ok}));`, 20, { OMT_DIR: process.env.OMT_DIR! });
		const statuses = results.map((result) => JSON.parse(result) as { writer_id: string; ok: boolean });
		const successful = new Set(statuses.filter((status) => status.ok).map((status) => status.writer_id));
		expect(successful.size).toBeGreaterThan(0);
		const stored = new Set<string>();
		for (const line of readFileSync(storagePaths().events, "utf8").split("\n").filter(Boolean)) {
			const event = JSON.parse(line) as { writer_id?: string };
			expect(event.writer_id).toBeString();
			stored.add(event.writer_id!);
		}
		expect(stored).toEqual(successful);
	});

	test("rotation boundary — retains at most three generations", () => {
		root();
		const payload = "x".repeat(1024 * 1024 - 20);
		expect(appendEvent({ payload })).toBe(true);
		expect(appendEvent({ payload: "boundary" })).toBe(true);
		for (let i = 0; i < 40; i++) expect(appendEvent({ payload: "y".repeat(100_000) })).toBe(true);
		const files = readdirSync(storagePaths().dir).filter((name) => /^events\.jsonl(?:\.[1-3])?$/.test(name));
		expect(files).toHaveLength(4);
		for (const file of files) expect(statSync(join(storagePaths().dir, file)).size).toBeLessThanOrEqual(1024 * 1024);
	});

	test("rotation boundary — races 20 writers at 1 MiB", async () => {
		root();
		const nearLimit = "z".repeat(1024 * 1024 - 32);
		expect(appendEvent({ seed: nearLimit })).toBe(true);
		const modulePath = join(import.meta.dir, "storage.ts");
		const results = await concurrentChildren(`import {appendEvent} from ${JSON.stringify(modulePath)}; const writer_id=${JSON.stringify("boundary-")}+process.pid; const ok=appendEvent({writer_id,payload:"q".repeat(18000)}); process.stdout.write(JSON.stringify({writer_id,ok}));`, 20, { OMT_DIR: process.env.OMT_DIR! });
		const statuses = results.map((result) => JSON.parse(result) as { writer_id: string; ok: boolean });
		const successful = new Set(statuses.filter((status) => status.ok).map((status) => status.writer_id));
		expect(successful.size).toBeGreaterThan(0);
		const files = readdirSync(storagePaths().dir).filter((name) => /^events\.jsonl(?:\.[1-3])?$/.test(name));
		expect(files.length).toBeLessThanOrEqual(4);
		const stored = new Set<string>();
		for (const file of files) {
			expect(statSync(join(storagePaths().dir, file)).size).toBeLessThanOrEqual(1024 * 1024);
			const text = readFileSync(join(storagePaths().dir, file), "utf8");
			for (const line of text.split("\n").filter(Boolean)) {
				const event = JSON.parse(line) as { writer_id?: string };
				if (event.writer_id) stored.add(event.writer_id);
			}
		}
		expect(stored).toEqual(successful);
	});

	test("nonblocking fail open — busy lock drops immediately", () => {
		root();
		appendEvent({ setup: true });
		const before = statSync(storagePaths().events).size;
		mkdirSync(storagePaths().lock);
		const started = performance.now();
		expect(appendEvent({ dropped: true })).toBe(false);
		expect(performance.now() - started).toBeLessThan(100);
		expect(statSync(storagePaths().events).size).toBe(before);
	});

	test("owner lock — live owner drops immediately", () => {
		root();
		mkdirSync(storagePaths().dir, { recursive: true });
		mkdirSync(storagePaths().lock);
		writeFileSync(join(storagePaths().lock, `owner-${process.pid}-live`), JSON.stringify({ pid: process.pid, nonce: "live" }));
		const started = performance.now();
		expect(appendEvent({ dropped: true })).toBe(false);
		expect(performance.now() - started).toBeLessThan(100);
	});

	test("owner lock — dead owner is recovered and append succeeds", () => {
		root();
		mkdirSync(storagePaths().dir, { recursive: true });
		mkdirSync(storagePaths().lock);
		writeFileSync(join(storagePaths().lock, "owner-2147483647-dead"), JSON.stringify({ pid: 2147483647, nonce: "dead" }));
		expect(appendEvent({ recovered: true })).toBe(true);
		expect(JSON.parse(readFileSync(storagePaths().events, "utf8"))).toEqual({ recovered: true });
	});

	test("owner lock — fresh empty initialization drops immediately", () => {
		root();
		mkdirSync(storagePaths().dir, { recursive: true });
		mkdirSync(storagePaths().lock);
		const started = performance.now();
		expect(appendEvent({ dropped: true })).toBe(false);
		expect(performance.now() - started).toBeLessThan(100);
	});

	test("owner lock — stale empty initialization is recovered", () => {
		root();
		mkdirSync(storagePaths().dir, { recursive: true });
		mkdirSync(storagePaths().lock);
		const stale = new Date(Date.now() - 10_000);
		utimesSync(storagePaths().lock, stale, stale);
		expect(appendEvent({ recovered: true })).toBe(true);
	});

	test("owner lock — malformed owner and symlink lock fail open", () => {
		root();
		mkdirSync(storagePaths().dir, { recursive: true });
		mkdirSync(storagePaths().lock);
		writeFileSync(join(storagePaths().lock, "owner-malformed"), "not-json");
		expect(appendEvent({ dropped: true })).toBe(false);
		rmSync(storagePaths().lock, { recursive: true, force: true });
		const target = join(storagePaths().dir, "target-lock");
		mkdirSync(target);
		symlinkSync(target, storagePaths().lock);
		expect(appendEvent({ dropped: true })).toBe(false);
	});

	test("owner lock — concurrent stale recovery preserves JSONL records", async () => {
		root();
		mkdirSync(storagePaths().dir, { recursive: true });
		mkdirSync(storagePaths().lock);
		writeFileSync(join(storagePaths().lock, "owner-2147483647-dead"), JSON.stringify({ pid: 2147483647, nonce: "dead" }));
		const modulePath = join(import.meta.dir, "storage.ts");
		const results = await concurrentChildren(`import {appendEvent} from ${JSON.stringify(modulePath)}; const writer_id=${JSON.stringify("stale-")}+process.pid; const ok=appendEvent({writer_id}); process.stdout.write(JSON.stringify({writer_id,ok}));`, 20, { OMT_DIR: process.env.OMT_DIR! });
		const statuses = results.map((result) => JSON.parse(result) as { writer_id: string; ok: boolean });
		const successful = new Set(statuses.filter((status) => status.ok).map((status) => status.writer_id));
		const stored = new Set<string>();
		for (const line of readFileSync(storagePaths().events, "utf8").split("\n").filter(Boolean)) stored.add((JSON.parse(line) as { writer_id: string }).writer_id);
		expect(stored).toEqual(successful);
	});

	test("owner lock — append failure leaves no owned lock behind", () => {
		root();
		mkdirSync(storagePaths().dir, { recursive: true });
		mkdirSync(storagePaths().events);
		expect(appendEvent({ failed: true })).toBe(false);
		expect(existsSync(storagePaths().lock)).toBe(false);
	});

	test("owner lock — initialization metadata failure cleans up for retry", async () => {
		root();
		const modulePath = join(import.meta.dir, "storage.ts");
		const script = `import {mock} from "bun:test"; const actual=await import("node:fs"); let fail=true; mock.module("node:fs",()=>({...actual.default,...actual,writeFileSync(...args){if(fail && String(args[0]).includes(".append.lock/owner-")){fail=false; throw new Error("injected owner write failure");} return actual.writeFileSync(...args);}})); const {appendEvent,storagePaths}=await import(${JSON.stringify(modulePath)}); const first=appendEvent({first:true}); const lockAfterFirst=actual.existsSync(storagePaths().lock); process.stdout.write(JSON.stringify({first,lockAfterFirst}));`;
		const child = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, OMT_DIR: process.env.OMT_DIR! }, stdout: "pipe", stderr: "pipe" });
		const output = await new Response(child.stdout).text();
		const stderr = await new Response(child.stderr).text();
		await child.exited;
		expect(child.exitCode, stderr).toBe(0);
		expect(JSON.parse(output)).toEqual({ first: false, lockAfterFirst: false });
		expect(appendEvent({ second: true })).toBe(true);
		expect(readFileSync(storagePaths().events, "utf8")).toBe("{\"second\":true}\n");
	});

	test("canonical OMT directory — explicit override wins", () => {
		const custom = root();
		const home = mkdtempSync(join(tmpdir(), "pretool-home-sentinel-"));
		process.env.HOME = home;
		expect(appendEvent({ mode: true })).toBe(true);
		expect(statSync(custom).mode & 0o777).toBe(0o700);
		expect(statSync(storagePaths().dir).mode & 0o777).toBe(0o700);
		expect(statSync(storagePaths().events).mode & 0o777).toBe(0o600);
		expect(readdirSync(home)).toHaveLength(0);
		chmodSync(custom, 0o777);
	});

	test("nonblocking fail open — invalid root drops without fallback", () => {
		const parent = mkdtempSync(join(tmpdir(), "pretool-invalid-parent-"));
		roots.push(parent);
		const home = mkdtempSync(join(tmpdir(), "pretool-home-sentinel-"));
		roots.push(home);
		process.env.HOME = home;
		process.env.OMT_DIR = join(parent, "invalid-file");
		const rootFile = process.env.OMT_DIR;
		writeFileSync(rootFile, "file");
		expect(appendEvent({ invalid: true })).toBe(false);
		expect(readdirSync(home)).toHaveLength(0);
		expect(existsSync(join(home, ".omt"))).toBe(false);
	});

	test("rejects undefined and oversize UTF-8 records", () => {
		root();
		expect(appendEvent(undefined)).toBe(false);
		const multibyte = "한".repeat(600_000);
		expect(Buffer.byteLength(JSON.stringify(multibyte) + "\n")).toBeGreaterThan(1024 * 1024);
		expect(appendEvent(multibyte)).toBe(false);
		expect(existsSync(storagePaths().events)).toBe(false);
	});

	test("requires canonical locator and rejects malformed key", () => {
		root();
		expect(getSessionKey("raw identity")).toHaveLength(0);
		expect(getSessionKey("")).toHaveLength(0);
		expect(existsSync(storagePaths().keys)).toBe(false);
		const locator = "b".repeat(64);
		mkdirSync(storagePaths().keys, { recursive: true });
		writeFileSync(join(storagePaths().keys, `${locator}.key`), Buffer.from("short"));
		expect(getSessionKey(locator)).toHaveLength(0);
	});

	test("canonical OMT directory — custom cwd uses resolver", () => {
		const home = mkdtempSync(join(tmpdir(), "pretool-home-cwd-"));
		roots.push(home);
		process.env.HOME = home;
		delete process.env.OMT_DIR;
		const cwd = mkdtempSync(join(tmpdir(), "custom-cwd-"));
		roots.push(cwd);
		expect(storagePaths(cwd).dir).toBe(join(homedir(), ".omt", basename(cwd), "pretool-trace"));
	});
});
