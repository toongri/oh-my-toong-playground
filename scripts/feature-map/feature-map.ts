import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
	configureFeatureMap,
	getFeature,
	getFeatureMapStatus,
	parseFeature,
	queryFeatureMap,
	saveFeature,
	validateFeatureMap,
	type FeatureMapOptions,
} from "@lib/feature-map/index";
import { renderFeatureMapHelp, FEATURE_MAP_COMMANDS } from "./help.ts";

export type { FeatureMapOptions } from "@lib/feature-map/index";
export type FeatureMapCliResult = { exitCode: number; stdout: string; stderr: string };

type Parsed = { command: string; positionals: string[]; values: Record<string, string>; help: boolean };
const commandNames = new Set(FEATURE_MAP_COMMANDS.map((command) => command.name));

function usageError(message: string): FeatureMapCliResult {
	return { exitCode: 2, stdout: "", stderr: `${message}\nSee: feature-map --help\n` };
}

function jsonResult(value: unknown, exitCode = 0): FeatureMapCliResult {
	return { exitCode, stdout: `${JSON.stringify(value)}\n`, stderr: "" };
}

function parseArgs(args: string[]): Parsed {
	if (args.length === 0) return { command: "help", positionals: [], values: {}, help: true };
	if (args[0] === "--help") {
		if (args.length !== 1) throw new Error("--help cannot be combined with other arguments");
		return { command: "help", positionals: [], values: {}, help: true };
	}
	const command = args[0];
	if (!command) throw new Error("missing command");
	if (command === "help") {
		if (args.length > 2) throw new Error("help accepts at most one command");
		return { command: args[1] ?? "help", positionals: [], values: {}, help: true };
	}
	if (!commandNames.has(command)) throw new Error(`Unknown feature-map command '${command}'`);
	const values: Record<string, string> = {};
	const positionals: string[] = [];
	const allowed: Record<string, string[]> = {
		query: ["text", "changed-by", "project"], get: ["project"],
		save: ["file", "expect", "project"], validate: ["project"],
		status: ["project"], configure: ["location", "project"],
	};
	for (let i = 1; i < args.length; i += 1) {
		const token = args[i];
		if (!token) throw new Error("missing argument");
		if (token === "--help") {
			if (args.length !== 2) throw new Error("--help cannot be combined with other arguments");
			return { command, positionals: [], values: {}, help: true };
		}
		if (!token.startsWith("--")) { positionals.push(token); continue; }
		const name = token.slice(2);
		if (!allowed[command].includes(name)) throw new Error(`unknown or inapplicable option --${name}`);
		const value = args[++i];
		if (!value || value.startsWith("--")) throw new Error(`option --${name} requires a value`);
		if (name in values) throw new Error(`option --${name} was provided more than once`);
		values[name] = value;
	}
	return { command, positionals, values, help: false };
}

function projectOptions(values: Record<string, string>, options: FeatureMapOptions): FeatureMapOptions {
	if (!values.project) return options;
	const base = options.cwd ?? process.cwd();
	return { ...options, cwd: isAbsolute(values.project) ? values.project : resolve(base, values.project) };
}

function checkShape(parsed: Parsed): void {
	const { command, positionals, values } = parsed;
	const expectedPositionals = command === "get" ? 1 : 0;
	if (positionals.length !== expectedPositionals) throw new Error(command === "get" ? "get requires exactly one feature id" : "unexpected positional argument");
	if (command === "save" && (!values.file || !values.expect)) throw new Error("save requires --file and --expect");
	if (command === "configure" && !values.location) throw new Error("configure requires --location");
	if (command !== "save" && (values.file || values.expect)) throw new Error("--file and --expect apply only to save");
	if (command !== "configure" && values.location) throw new Error("--location applies only to configure");
	if (values.expect && values.expect !== "new" && !/^[a-f0-9]{64}$/.test(values.expect)) throw new Error("--expect must be new or a 64-character SHA-256 revision");
}

function exitForStatus(value: unknown): number {
	if (typeof value === "object" && value !== null && "status" in value) {
		const status = Reflect.get(value, "status");
		return status === "conflict" || status === "invalid" ? 1 : 0;
	}
	return 0;
}

export function runFeatureMapCli(args: string[], options: FeatureMapOptions = {}): FeatureMapCliResult {
	let parsed: Parsed;
	try { parsed = parseArgs(args); }
	catch (error) { return usageError(error instanceof Error ? error.message : String(error)); }
	if (parsed.help) {
		try { return { exitCode: 0, stdout: `${renderFeatureMapHelp(parsed.command === "help" ? undefined : parsed.command)}\n`, stderr: "" }; }
		catch (error) { return usageError(error instanceof Error ? error.message : String(error)); }
	}
	try { checkShape(parsed); }
	catch (error) { return usageError(error instanceof Error ? error.message : String(error)); }
	const operationalOptions = projectOptions(parsed.values, options);
	try {
		let result: unknown;
		switch (parsed.command) {
			case "query": result = queryFeatureMap({ text: parsed.values.text, changedBy: parsed.values["changed-by"] }, operationalOptions); break;
			case "get": result = getFeature(parsed.positionals[0] ?? "", operationalOptions); break;
			case "status": result = getFeatureMapStatus(operationalOptions); break;
			case "validate": result = validateFeatureMap(operationalOptions); break;
			case "configure": configureFeatureMap(parsed.values.location ?? "", operationalOptions); result = getFeatureMapStatus(operationalOptions); break;
			case "save": {
				const fileBase = options.cwd ?? process.cwd();
				const inputFile = parsed.values.file ?? "";
				const file = isAbsolute(inputFile) ? inputFile : resolve(fileBase, inputFile);
				const document = parseFeature(readFileSync(file, "utf8"));
				result = saveFeature({ ...document, expectedRevision: parsed.values.expect === "new" ? null : (parsed.values.expect ?? null) }, operationalOptions);
				break;
			}
			default: throw new Error(`Unknown feature-map command '${parsed.command}'`);
		}
		return jsonResult(result, exitForStatus(result));
	} catch (error) {
		return { exitCode: 1, stdout: "", stderr: `${JSON.stringify({ status: "error", message: error instanceof Error ? error.message : String(error) })}\n` };
	}
}

const isEntryPoint = typeof Bun !== "undefined" ? Bun.main === fileURLToPath(import.meta.url) : process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
	const result = runFeatureMapCli(process.argv.slice(2));
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	process.exitCode = result.exitCode;
}
