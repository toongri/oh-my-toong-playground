#!/usr/bin/env bun
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { QaCaseStoreOptions } from "@lib/qa-case-store.ts";
import { readDeviceProfiles, saveDeviceProfiles } from "@lib/qa-device-profiles.ts";

export type QaDeviceProfilesCliResult = { exitCode: number; stdout: string; stderr: string };

const help = `qa-device-profiles — the screen sizes this project's clients must stay usable on

Commands:
  get [--project DIR]                    print the saved profiles, or status "unconfigured" with an ask_user instruction
  set --file JSON_PATH [--project DIR]   save the profiles the user confirmed (JSON array of {id,label,platform,width,height})
  help

Stored per project at ~/.qa-cases/<projectKey>/device-profiles.yaml. Widths and heights are logical px/pt/dp.
`;

export function runQaDeviceProfilesCli(args: string[], baseOptions: QaCaseStoreOptions = {}): QaDeviceProfilesCliResult {
	const [command, ...rest] = args;
	if (!command || command === "help" || command === "--help") return { exitCode: 0, stdout: help, stderr: "" };
	try {
		if (command !== "get" && command !== "set") throw new Error(`Unknown qa-device-profiles command '${command}'`);
		const { values } = parseArgs({ args: rest, options: { project: { type: "string" }, file: { type: "string" } }, strict: true });
		const cwd = baseOptions.cwd ?? process.cwd();
		const options = values.project ? { ...baseOptions, cwd: isAbsolute(values.project) ? values.project : resolve(cwd, values.project) } : baseOptions;
		if (command === "get") return { exitCode: 0, stdout: `${JSON.stringify(readDeviceProfiles(options))}\n`, stderr: "" };
		if (!values.file) throw new Error("set requires --file");
		const input: unknown = JSON.parse(readFileSync(isAbsolute(values.file) ? values.file : resolve(cwd, values.file), "utf8"));
		return { exitCode: 0, stdout: `${JSON.stringify(saveDeviceProfiles(input, options))}\n`, stderr: "" };
	} catch (error) {
		return { exitCode: 1, stdout: "", stderr: `${JSON.stringify({ status: "error", message: error instanceof Error ? error.message : String(error) })}\n` };
	}
}

const entry = typeof Bun !== "undefined" ? Bun.main === fileURLToPath(import.meta.url) : process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (entry) {
	const result = runQaDeviceProfilesCli(process.argv.slice(2));
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	process.exitCode = result.exitCode;
}
