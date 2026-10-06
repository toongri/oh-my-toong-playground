#!/usr/bin/env bun
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import type { QaCaseStoreOptions } from "@lib/qa-case-store.ts";
import { DEFAULT_DEVICE_PROFILES, readDeviceProfiles, removeDeviceProfile, saveDeviceProfiles, upsertDeviceProfile } from "@lib/qa-device-profiles.ts";

export type QaDeviceProfilesCliResult = { exitCode: number; stdout: string; stderr: string };

const help = `qa-device-profiles — the screen sizes this project's clients must stay usable on

Commands:
  get [--project DIR]                    print the saved profiles, or status "unconfigured" with the defaults and an ask_user instruction
  defaults                               print the built-in default list (phones, foldables, tablets, desktops)
  set --defaults [--project DIR]         save the built-in defaults (the user accepted them or does not know)
  set --file JSON_PATH [--project DIR]   save the profiles the user gave (JSON array of {id,label,platform,width,height})
  upsert --json PROFILE [--project DIR]  add a profile, or replace the saved one with the same id (JSON {id,label,platform,width,height})
  remove ID [--project DIR]              remove a platform or device the project does not support
  help

Stored per project at ~/.qa-cases/<projectKey>/device-profiles.yaml. Widths and heights are logical px/pt/dp.
`;

export function runQaDeviceProfilesCli(args: string[], baseOptions: QaCaseStoreOptions = {}): QaDeviceProfilesCliResult {
	const [command, ...rest] = args;
	if (!command || command === "help" || command === "--help") return { exitCode: 0, stdout: help, stderr: "" };
	try {
		const { values, positionals } = parseArgs({
			args: rest,
			options: { project: { type: "string" }, file: { type: "string" }, defaults: { type: "boolean" }, json: { type: "string" } },
			allowPositionals: command === "remove",
			strict: true,
		});
		const cwd = baseOptions.cwd ?? process.cwd();
		const options = values.project ? { ...baseOptions, cwd: isAbsolute(values.project) ? values.project : resolve(cwd, values.project) } : baseOptions;
		const ok = (result: unknown): QaDeviceProfilesCliResult => ({ exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" });
		switch (command) {
			case "get":
				return ok(readDeviceProfiles(options));
			case "defaults":
				return ok({ status: "ok", profiles: DEFAULT_DEVICE_PROFILES });
			case "set": {
				if (Boolean(values.defaults) === Boolean(values.file)) throw new Error("set requires exactly one of --defaults or --file");
				const input: unknown = values.file ? JSON.parse(readFileSync(isAbsolute(values.file) ? values.file : resolve(cwd, values.file), "utf8")) : DEFAULT_DEVICE_PROFILES;
				return ok(saveDeviceProfiles(input, options));
			}
			case "upsert": {
				if (!values.json) throw new Error("upsert requires --json '<profile>'");
				const input: unknown = JSON.parse(values.json);
				return ok(upsertDeviceProfile(input, options));
			}
			case "remove": {
				const [id, ...extra] = positionals;
				if (!id || extra.length) throw new Error("remove takes exactly one profile id");
				return ok(removeDeviceProfile(id, options));
			}
			default:
				throw new Error(`Unknown qa-device-profiles command '${command}'`);
		}
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
