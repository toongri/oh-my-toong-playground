#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
	configureQaCaseStore,
	disableQaCaseStore,
	getQaCase,
	getQaCaseStoreStatus,
	listQaCases,
	saveQaCase,
	type QaCaseStoreOptions,
} from "@lib/qa-case-store.ts";
import { getFeature } from "@lib/feature-map/storage.ts";

export type QaCasesCliResult = { exitCode: number; stdout: string; stderr: string };
const commands = ["help", "status", "configure", "disable", "list", "get", "save"];
const help = `qa-cases — reusable QA case metadata storage\n\nCommands:\n  status [--project DIR]\n  configure --location ABSOLUTE_PATH [--allow-project-storage] [--project DIR]\n  disable [--project DIR]\n  list [--feature ID] [--project DIR]\n  get <id> [--project DIR]\n  save --file JSON_PATH --expect <new|sha256> [--project DIR]\n  help\n\nCase records store Given/When/Then strings, a non-empty feature_refs list of feature-map ids (cases are found by feature; save refuses an id the feature map does not hold), an explicit runner argv array, native file references, and a reset description. Saving never executes a runner or copies product files.\n`;
type Parsed = { command: string; positionals: string[]; values: Record<string, string>; flags: Set<string> };
function parse(args: string[]): Parsed {
	if (!args.length || args[0] === "help" || args[0] === "--help") return { command: "help", positionals: [], values: {}, flags: new Set() };
	const command = args[0] ?? "";
	if (!commands.includes(command) || command === "help") throw new Error(`Unknown qa-cases command '${command}'`);
	const values: Record<string, string> = {}; const flags = new Set<string>(); const positionals: string[] = [];
	const allowed: Record<string, string[]> = { status: ["project"], configure: ["location", "project"], disable: ["project"], list: ["feature", "project"], get: ["project"], save: ["file", "expect", "project"] };
	for (let i = 1; i < args.length; i += 1) {
		const token = args[i] ?? "";
		if (!token.startsWith("--")) { positionals.push(token); continue; }
		const name = token.slice(2);
		if (name === "allow-project-storage") { if (command !== "configure") throw new Error("--allow-project-storage applies only to configure"); flags.add(name); continue; }
		if (!allowed[command]?.includes(name)) throw new Error(`unknown or inapplicable option --${name}`);
		const value = args[++i]; if (!value || value.startsWith("--")) throw new Error(`option --${name} requires a value`); if (name in values) throw new Error(`option --${name} was provided more than once`); values[name] = value;
	}
	if (command === "get" && positionals.length !== 1) throw new Error("get requires exactly one case id");
	if (command !== "get" && positionals.length) throw new Error("unexpected positional argument");
	if (command === "configure" && !values.location) throw new Error("configure requires --location");
	if (command === "save" && (!values.file || !values.expect)) throw new Error("save requires --file and --expect");
	if (values.expect && values.expect !== "new" && !/^[a-f0-9]{64}$/.test(values.expect)) throw new Error("--expect must be new or a 64-character SHA-256 revision");
	return { command, positionals, values, flags };
}
function options(values: Record<string, string>, base: QaCaseStoreOptions): QaCaseStoreOptions { return values.project ? { ...base, cwd: isAbsolute(values.project) ? values.project : resolve(base.cwd ?? process.cwd(), values.project) } : base; }
// 케이스는 기능으로 찾으므로, 저장 전에 feature_refs가 모두 feature map에 있어야 한다.
function unmappedFeature(record: unknown, op: QaCaseStoreOptions): string | undefined {
	const refs = typeof record === "object" && record !== null ? Reflect.get(record, "feature_refs") : undefined;
	if (!Array.isArray(refs)) return undefined;
	return refs.find((ref) => typeof ref === "string" && getFeature(ref, op).status !== "ok");
}
function exitFor(value: unknown): number { if (typeof value === "object" && value !== null && "status" in value) { const status = Reflect.get(value, "status"); return status === "conflict" || Reflect.get(value, "reason") === "feature_not_in_map" ? 1 : 0; } return 0; }
export function runQaCasesCli(args: string[], baseOptions: QaCaseStoreOptions = {}): QaCasesCliResult {
	let parsed: Parsed; try { parsed = parse(args); } catch (error) { return { exitCode: 2, stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\nSee: qa-cases --help\n` }; }
	if (parsed.command === "help") return { exitCode: 0, stdout: help, stderr: "" };
	try {
		const op = options(parsed.values, baseOptions); let result: unknown;
		switch (parsed.command) {
			case "status": result = getQaCaseStoreStatus(op); break;
			case "configure": result = configureQaCaseStore(parsed.values.location ?? "", { ...op, allowProjectStorage: parsed.flags.has("allow-project-storage") }); break;
			case "disable": result = disableQaCaseStore(op); break;
			case "list": result = listQaCases(op, parsed.values.feature ? { feature: parsed.values.feature } : {}); break;
			case "get": result = getQaCase(parsed.positionals[0] ?? "", op); break;
			case "save": { const inputFile = parsed.values.file ?? ""; const expected = parsed.values.expect ?? ""; const path = isAbsolute(inputFile) ? inputFile : resolve(baseOptions.cwd ?? process.cwd(), inputFile); const record = JSON.parse(readFileSync(path, "utf8")); const unmapped = unmappedFeature(record, op); result = unmapped ? { status: "not_found", reason: "feature_not_in_map", feature: unmapped, next_action: "add the feature with feature-map.ts save, then save the case" } : saveQaCase({ record, expectedRevision: expected === "new" ? null : expected }, op); break; }
			default: throw new Error(`Unknown qa-cases command '${parsed.command}'`);
		}
		return { exitCode: exitFor(result), stdout: `${JSON.stringify(result)}\n`, stderr: "" };
	} catch (error) { return { exitCode: 1, stdout: "", stderr: `${JSON.stringify({ status: "error", message: error instanceof Error ? error.message : String(error) })}\n` }; }
}
const entry = typeof Bun !== "undefined" ? Bun.main === fileURLToPath(import.meta.url) : process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (entry) { const result = runQaCasesCli(process.argv.slice(2)); process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode; }
