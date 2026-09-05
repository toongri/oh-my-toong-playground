import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
	configPathId, configValuesEqual, isConfigPathPrefix, isConfigTable,
	parseConfigValue, readConfigPath, serializeConfigValue,
	type ConfigState, type KeyPath,
} from "./lib/codex-config-ownership";
import { commitConfigState, readConfigSnapshot } from "./lib/codex-config-store";
import type { DeployMutationHooks } from "./lib/deploy-transaction";

const HELP = `Usage: bun tools/codex-config-migrate.ts --target <deploy-root> --key '["model"]' [--key '["features","example"]'] [--apply]
Preview explicit ownership adoption by default (no writes).
--key accepts a nonempty JSON array of string path segments; repeat for each leaf.
--apply adopts present leaves and saves .omt/codex-config-before-adoption.toml once.
Tables cannot be adopted in bulk. Arrays are atomic. Config bytes and markers are preserved.
--help shows this help.`;
class MigrationError extends Error {}
function validKey(key: unknown): key is KeyPath {
	return Array.isArray(key) && key.length > 0 && key.every((part) => typeof part === "string");
}
function code(error: unknown): unknown {
	return typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
}
async function saveBackup(target: string, bytes: string): Promise<void> {
	const file = path.join(target, ".omt/codex-config-before-adoption.toml");
	const temporary = `${file}.${randomUUID()}.tmp`;
	let created = false;
	try {
		const handle = await fs.open(temporary, "wx", 0o600);
		created = true;
		try { await handle.writeFile(bytes, "utf8"); await handle.sync(); }
		finally { await handle.close(); }
		// Publish only complete bytes; link is atomic and never replaces an earlier backup.
		try { await fs.link(temporary, file); }
		catch (error) {
			if (code(error) !== "EEXIST") throw error;
			const stat = await fs.lstat(file);
			if (!stat.isFile() || stat.isSymbolicLink()) throw new MigrationError("Unsafe adoption backup: use an ordinary backup file before retrying.");
		}
	} finally {
		if (created) await fs.unlink(temporary);
	}
}
export type MigrationOptions = {
	target: string;
	keys: KeyPath[];
	apply?: boolean;
	hooks?: DeployMutationHooks;
};
export type MigrationResult = {
	status: "ready" | "noop" | "applied";
	actions: { path: KeyPath; action: "adopt" | "noop" }[];
};

/** Explicit adoption only: no TOML edits, marker inference, drift takeover, or recovery. */
export async function migrateConfig(options: MigrationOptions): Promise<MigrationResult> {
	if (!options.target?.trim() || !Array.isArray(options.keys) || !options.keys.length || !options.keys.every(validKey))
		throw new MigrationError("Provide --target and at least one --key containing a nonempty JSON array of strings.");
	const reviewed = await readConfigSnapshot(options.target);
	if (reviewed.pendingBytes !== null) throw new MigrationError("Config recovery required: resolve the pending sync transaction before adoption.");
	if (reviewed.configBytes === null) throw new MigrationError("Config file is missing: create a valid .codex/config.toml before adoption.");
	const originalBytes = reviewed.configBytes;
	const nextState: ConfigState = reviewed.state
		? { ...reviewed.state, entries: [...reviewed.state.entries] }
		: { version: 1, target: ".codex/config.toml", entries: [] };
	const actions: MigrationResult["actions"] = [];
	const unique = new Map(options.keys.map((key) => [configPathId(key), key]));
	for (const [id, key] of unique) {
		const present = readConfigPath(reviewed.current, key);
		if (!present.exists || present.blocked) throw new MigrationError(`Missing leaf ${id}: select a present config leaf.`);
		if (isConfigTable(present.value)) throw new MigrationError(`Table ${id}: select individual leaf paths; arrays are atomic.`);
		const owned = nextState.entries.find((entry) => configPathId(entry.path) === id);
		if (owned) {
			if (!configValuesEqual(present.value, parseConfigValue(owned.valueToml)))
				throw new MigrationError(`Owned-key drift ${id}: reconcile config and ownership state before retrying.`);
			actions.push({ path: key, action: "noop" });
			continue;
		}
		if (nextState.entries.some((entry) => isConfigPathPrefix(entry.path, key) || isConfigPathPrefix(key, entry.path)))
			throw new MigrationError(`Overlapping ownership ${id}: reconcile the existing ownership path before retrying.`);
		nextState.entries.push({ path: [...key], valueToml: serializeConfigValue(present.value) });
		actions.push({ path: key, action: "adopt" });
	}
	if (actions.every(({ action }) => action === "noop")) return { status: "noop", actions };
	if (!options.apply) return { status: "ready", actions };
	let backupChecked = false;
	const hooks: DeployMutationHooks = {
		async mutate(file, operation) {
			const backedOperation = async () => {
				if (!backupChecked) {
					const current = await readConfigSnapshot(reviewed.target);
					if (current.configBytes !== reviewed.configBytes || current.stateBytes !== reviewed.stateBytes || current.pendingBytes !== null)
						throw new MigrationError("Config adoption snapshot changed; preview again.");
					await saveBackup(reviewed.target, originalBytes);
					backupChecked = true;
				}
				await operation();
			};
			if (options.hooks) await options.hooks.mutate(file, backedOperation);
			else await backedOperation();
		},
	};
	await commitConfigState(reviewed.target, reviewed, nextState, hooks);
	return { status: "applied", actions };
}

function safeError(error: unknown): string {
	if (error instanceof MigrationError) return error.message;
	const message = error instanceof Error ? error.message : "";
	if (message.includes("TOML")) return "Invalid config TOML: fix .codex/config.toml before retrying.";
	if (message.includes("pending") || message.includes("recovery")) return "Config recovery required: inspect the pending transaction before retrying.";
	if (message.includes("ownership")) return "Invalid ownership state: repair .omt/codex-config-state.json before retrying; adoption will not replace corrupt state.";
	if (message.includes("changed")) return "Config adoption snapshot changed; preview again.";
	if (message.includes("lock")) return "Config lock unavailable: wait for the owning sync process or inspect a stale lock before retrying.";
	return "Adoption failed: check target, ordinary files/directories, and access permissions before retrying.";
}
async function main(): Promise<void> {
	let options: MigrationOptions;
	try {
		const { values } = parseArgs({ options: {
			target: { type: "string" }, key: { type: "string", multiple: true },
			apply: { type: "boolean" }, help: { type: "boolean", short: "h" },
		}, strict: true, allowPositionals: false });
		if (values.help) { process.stdout.write(`${HELP}\n`); return; }
		const keys: unknown[] = (values.key ?? []).map((key): unknown => JSON.parse(key));
		if (!values.target?.trim() || !keys.length || !keys.every(validKey)) throw new Error();
		options = { target: values.target, keys, apply: values.apply };
	} catch {
		console.error("Invalid arguments. Provide --target and repeated --key JSON paths; use --help for syntax.");
		process.exitCode = 1;
		return;
	}
	try {
		const result = await migrateConfig(options);
		process.stdout.write(`${options.apply ? "Apply" : "Preview"}: ${result.status}\n`);
		for (const action of result.actions) process.stdout.write(`${action.action} ${configPathId(action.path)}\n`);
	} catch (error) {
		console.error(safeError(error));
		process.exitCode = 1;
	}
}
if (import.meta.main) await main();
