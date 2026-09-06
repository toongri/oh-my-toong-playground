import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "smol-toml";
import {
	planConfig, parseConfigState, serializeConfigState,
	type ConfigPlan, type ConfigState,
} from "./codex-config-ownership";
import { applyTomlEdits } from "./toml-edit";
import type { DeployMutationHooks } from "./deploy-transaction";

const CONFIG = ".codex/config.toml";
const STATE = ".omt/codex-config-state.json";
const PENDING = ".omt/codex-config-pending.json";
const LOCK = ".omt/codex-config.lock";
type Bytes = string | null;
type Pair = { configBytes: Bytes; stateBytes: Bytes };
type Journal = { version: 1; target: string; before: Pair; after: Pair };
export type ConfigSnapshot = Pair & {
	target: string;
	current: Record<string, unknown>;
	state: ConfigState | undefined;
	pendingBytes: Bytes;
};
export type ConfigResult = {
	status: "ready" | "noop" | "conflict" | "recovery-required" | "applied";
	plan: ConfigPlan;
	configBytes: Bytes;
	stateBytes: Bytes;
};
const direct: DeployMutationHooks = { async mutate(_file, operation) { await operation(); } };
function code(error: unknown): unknown {
	return typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
}
async function readBytes(file: string): Promise<Bytes> {
	try {
		const stat = await fs.lstat(file);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Config store requires regular files");
		return await fs.readFile(file, "utf8");
	} catch (error) {
		if (code(error) === "ENOENT") return null;
		throw error;
	}
}
async function checkDirectories(target: string): Promise<void> {
	for (const directory of [".omt", ".codex"]) {
		try {
			const stat = await fs.lstat(path.join(target, directory));
			if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Config store requires ordinary directories");
		} catch (error) { if (code(error) !== "ENOENT") throw error; }
	}
}
function document(bytes: Bytes): Record<string, unknown> {
	try { return parse(bytes ?? "", { integersAsBigInt: "asNeeded" }); }
	catch { throw new Error("Invalid config TOML"); }
}
function snapshot(target: string, pair: Pair, pendingBytes: Bytes): ConfigSnapshot {
	return { ...pair, target, current: document(pair.configBytes), state: pair.stateBytes === null ? undefined : parseConfigState(pair.stateBytes), pendingBytes };
}
async function readPair(target: string): Promise<Pair> {
	const [configBytes, stateBytes] = await Promise.all([readBytes(path.join(target, CONFIG)), readBytes(path.join(target, STATE))]);
	return { configBytes, stateBytes };
}
function pair(input: unknown): Pair {
	if (typeof input !== "object" || input === null) throw new Error("Invalid config pending journal");
	const configBytes: unknown = Reflect.get(input, "configBytes");
	const stateBytes: unknown = Reflect.get(input, "stateBytes");
	if ((configBytes !== null && typeof configBytes !== "string") || (stateBytes !== null && typeof stateBytes !== "string")) throw new Error("Invalid config pending journal");
	document(configBytes);
	if (stateBytes !== null) parseConfigState(stateBytes);
	return { configBytes, stateBytes };
}
function journal(bytes: string, target: string): Journal {
	try {
		const input: unknown = JSON.parse(bytes);
		if (typeof input !== "object" || input === null || Reflect.get(input, "version") !== 1 || Reflect.get(input, "target") !== target) throw new Error();
		return { version: 1, target, before: pair(Reflect.get(input, "before")), after: pair(Reflect.get(input, "after")) };
	} catch { throw new Error("Invalid config pending journal"); }
}
function same(a: Pair, b: Pair): boolean { return a.configBytes === b.configBytes && a.stateBytes === b.stateBytes; }
function recognized(current: Pair, pending: Journal): void {
	if (!same(current, pending.before) && !same(current, pending.after) && !(current.configBytes === pending.after.configBytes && current.stateBytes === pending.before.stateBytes)) throw new Error("Config pending recovery conflict: config or state changed");
}

/** Read-only, including when recovery is pending. No directory or lock creation. */
export async function readConfigSnapshot(target: string): Promise<ConfigSnapshot> {
	target = path.resolve(target);
	await checkDirectories(target);
	const [current, pendingBytes] = await Promise.all([readPair(target), readBytes(path.join(target, PENDING))]);
	if (pendingBytes !== null) recognized(current, journal(pendingBytes, target));
	return snapshot(target, current, pendingBytes);
}
function planned(current: ConfigSnapshot, desired: Record<string, unknown>): ConfigResult {
	const plan = planConfig(current.current, desired, current.state);
	if (plan.conflicts.length) return { status: "conflict", plan, configBytes: current.configBytes, stateBytes: current.stateBytes };
	const configBytes = plan.edits.length ? applyTomlEdits(current.configBytes ?? "", plan.edits) : current.configBytes;
	const serialized = serializeConfigState(plan.nextState);
	// Preserve pre-existing formatting when ownership has no semantic change.
	const stateBytes = current.state === undefined && plan.nextState.entries.length === 0 ? null : current.state && serializeConfigState(current.state) === serialized ? current.stateBytes : serialized;
	return { status: configBytes === current.configBytes && stateBytes === current.stateBytes ? "noop" : "ready", plan, configBytes, stateBytes };
}
export async function previewConfig(target: string, desired: Record<string, unknown>): Promise<ConfigResult> {
	const current = await readConfigSnapshot(target);
	if (current.pendingBytes !== null) {
		const pending = journal(current.pendingBytes, current.target);
		return { ...planned(snapshot(current.target, pending.after, null), desired), status: "recovery-required" };
	}
	return planned(current, desired);
}
async function assertUnchanged(target: string, expected: Pair, pendingBytes: Bytes): Promise<void> {
	await checkDirectories(target);
	if (!same(await readPair(target), expected) || await readBytes(path.join(target, PENDING)) !== pendingBytes) throw new Error("Config store changed before replacement");
}
/** Recheck immediately before rename/unlink; external non-OMT writers do not share a CAS protocol. */
async function replace(target: string, name: string, bytes: Bytes, expected: Pair, pendingBytes: Bytes, hooks: DeployMutationHooks): Promise<void> {
	const file = path.join(target, name);
	await hooks.mutate(file, async () => {
		await checkDirectories(target);
		await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			if (bytes !== null) {
				const handle = await fs.open(temporary, "wx", 0o600);
				try { await handle.writeFile(bytes, "utf8"); await handle.sync(); }
				finally { await handle.close(); }
			}
			await assertUnchanged(target, expected, pendingBytes);
			if (bytes === null) await fs.unlink(file);
			else await fs.rename(temporary, file);
		} finally { await fs.unlink(temporary).catch((error) => { if (code(error) !== "ENOENT") throw error; }); }
	});
}
async function lock(target: string): Promise<() => Promise<void>> {
	await checkDirectories(target);
	await fs.mkdir(path.join(target, ".omt"), { recursive: true, mode: 0o700 });
	const file = path.join(target, LOCK);
	const bytes = JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() });
	try {
		const handle = await fs.open(file, "wx", 0o600);
		try { await handle.writeFile(bytes); } finally { await handle.close(); }
		return async () => { if (await readBytes(file) === bytes) await fs.unlink(file); };
	} catch (error) {
		if (code(error) !== "EEXIST") throw error;
		// A check followed by unlink cannot safely reclaim a lock: another reaper
		// may have replaced it. PID metadata alone cannot establish ownership.
		throw new Error("Config lock already exists. Confirm no sync is active before removing .omt/codex-config.lock manually.", { cause: error });
	}
}
async function recover(target: string, hooks: DeployMutationHooks): Promise<void> {
	const pendingBytes = await readBytes(path.join(target, PENDING));
	if (pendingBytes === null) return;
	const pending = journal(pendingBytes, target);
	const current = await readPair(target);
	recognized(current, pending);
	if (current.configBytes !== pending.after.configBytes) {
		await replace(target, CONFIG, pending.after.configBytes, current, pendingBytes, hooks);
		current.configBytes = pending.after.configBytes;
	}
	if (current.stateBytes !== pending.after.stateBytes) {
		await replace(target, STATE, pending.after.stateBytes, current, pendingBytes, hooks);
		current.stateBytes = pending.after.stateBytes;
	}
	await replace(target, PENDING, null, current, pendingBytes, hooks);
}
async function commit(target: string, current: ConfigSnapshot, result: ConfigResult, hooks: DeployMutationHooks): Promise<ConfigResult> {
	if (result.plan.conflicts.length) throw new Error(`Config ownership conflicts: ${result.plan.conflicts.map(({ path }) => JSON.stringify(path)).join(", ")}`);
	if (result.status === "noop") return result;
	const before: Pair = { configBytes: current.configBytes, stateBytes: current.stateBytes };
	const after: Pair = { configBytes: result.configBytes, stateBytes: result.stateBytes };
	const pendingBytes = `${JSON.stringify({ version: 1, target, before, after } satisfies Journal)}\n`;
	await replace(target, PENDING, pendingBytes, before, null, hooks);
	const expected = { ...before };
	if (after.configBytes !== before.configBytes) {
		await replace(target, CONFIG, after.configBytes, expected, pendingBytes, hooks);
		expected.configBytes = after.configBytes;
	}
	if (after.stateBytes !== before.stateBytes) {
		await replace(target, STATE, after.stateBytes, expected, pendingBytes, hooks);
		expected.stateBytes = after.stateBytes;
	}
	await replace(target, PENDING, null, expected, pendingBytes, hooks);
	return { ...result, status: "applied" };
}
async function withLock<T>(target: string, operation: () => Promise<T>): Promise<T> {
	const release = await lock(target);
	try { return await operation(); }
	finally { await release(); }
}
export async function applyConfig(target: string, desired: Record<string, unknown>, hooks: DeployMutationHooks = direct): Promise<ConfigResult> {
	target = path.resolve(target);
	return withLock(target, async () => {
		await recover(target, hooks);
		const current = await readConfigSnapshot(target);
		return commit(target, current, planned(current, desired), hooks);
	});
}

/** Explicit ownership adoption can commit a reviewed snapshot without editing config bytes. */
export async function commitConfigState(target: string, reviewed: ConfigSnapshot, nextState: ConfigState, hooks: DeployMutationHooks = direct): Promise<ConfigResult> {
	target = path.resolve(target);
	return withLock(target, async () => {
		const current = await readConfigSnapshot(target);
		if (reviewed.target !== target || reviewed.pendingBytes !== null || current.pendingBytes !== null || !same(reviewed, current)) throw new Error("Config adoption snapshot changed; preview again");
		const serialized = serializeConfigState(nextState);
		const stateBytes = current.state && serializeConfigState(current.state) === serialized ? current.stateBytes : !current.state && nextState.entries.length === 0 ? null : serialized;
		return commit(target, current, { status: stateBytes === current.stateBytes ? "noop" : "ready", plan: { edits: [], nextState, conflicts: [] }, configBytes: current.configBytes, stateBytes }, hooks);
	});
}
