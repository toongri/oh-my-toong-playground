#!/usr/bin/env bun

import fs from "fs/promises";
import os from "os";
import path from "path";

import { getCodexVersions } from "../../../lib/config.ts";
import { buildIsolatedCodexHome } from "../../isolated-codex-home.ts";
import type { HooksSpec, IsolatedCodexHome } from "../../isolated-codex-home.ts";
import { runSession } from "../../runner.ts";
import type { SessionConfig } from "../../types.ts";
import { FILE_READ_PROMPT, TARGET_FILE_NAME, parsePreToolUseCapture, writeTargetFile } from "./fixture.ts";
import { judgePreToolUsePayloads } from "./judgment.ts";

export function buildSessionConfig(cwd: string, isolated: IsolatedCodexHome): SessionConfig {
	return {
		prompt: FILE_READ_PROMPT,
		cwd,
		sandbox: "read-only",
		timeoutMs: 120_000,
		env: { HOME: isolated.home, CODEX_HOME: isolated.codexHome },
		extraArgs: ["--dangerously-bypass-hook-trust"],
	};
}

export type MainOptions = {
	scratchRoot?: string;
	authSourcePath?: string;
	runSessionFn?: typeof runSession;
	allowedVersions?: string[];
};

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

async function createCaptureHook(scratchRoot: string, capturePath: string): Promise<string> {
	const hookPath = path.join(scratchRoot, "file-read-pretooluse-capture.sh");
	const body = `#!/bin/sh\n{ cat; printf '\\n'; } >> ${shellQuote(capturePath)}\n`;
	await fs.writeFile(hookPath, body, { encoding: "utf8", mode: 0o755 });
	await fs.chmod(hookPath, 0o755);
	return hookPath;
}

function emit(value: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function main(opts: MainOptions = {}): Promise<number> {
	const scratchRoot = opts.scratchRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), "codex-probe-file-read-pretooluse-")));
	const cwd = path.join(scratchRoot, "fixture");
	const capturePath = path.join(scratchRoot, "capture.jsonl");
	try {
		await writeTargetFile(cwd);
		const hookPath = await createCaptureHook(scratchRoot, capturePath);
		const hooks: HooksSpec = { PreToolUse: [{ command: hookPath, timeout: 10 }] };
		const isolated = await buildIsolatedCodexHome(scratchRoot, hooks, opts.authSourcePath === undefined ? {} : { authSourcePath: opts.authSourcePath });
		const config = buildSessionConfig(cwd, isolated);
		const allowedVersions = opts.allowedVersions ?? (await getCodexVersions());
		const result = await (opts.runSessionFn ?? runSession)(config, { allowedVersions, codexHome: isolated.codexHome });
		if (!result.ok) {
			emit({ exitCode: 2, reason: result.reason, detail: result.detail, inventory: [], matchedPayloads: [], hasNonShellMatchedPayload: false });
			return 2;
		}

		let rawCapture: string;
		try {
			rawCapture = await fs.readFile(capturePath, "utf8");
		} catch {
			emit({ exitCode: 2, reason: "capture-missing", inventory: [], matchedPayloads: [], hasNonShellMatchedPayload: false });
			return 2;
		}
		const parsed = parsePreToolUseCapture(rawCapture);
		if (!parsed.ok) {
			emit({ exitCode: 2, reason: "capture-invalid", detail: parsed.reason, inventory: [], matchedPayloads: [], hasNonShellMatchedPayload: false });
			return 2;
		}
		const judgment = judgePreToolUsePayloads(parsed.payloads, TARGET_FILE_NAME);
		const exitCode = judgment.kind === "pass" ? 0 : 1;
		emit({
			exitCode,
			inventory: judgment.inventory,
			matchedPayloads: judgment.matchedPayloads,
			hasNonShellMatchedPayload: judgment.hasNonShellMatchedPayload,
		});
		return exitCode;
	} finally {
		await fs.rm(scratchRoot, { recursive: true, force: true });
	}
}

export async function runEntry(_argv: readonly string[] = process.argv, opts: MainOptions = {}): Promise<number> {
	try {
		return await main(opts);
	} catch (error) {
		process.stderr.write(`codex-probe file-read-pretooluse-payload: unmeasurable — ${error instanceof Error ? error.message : String(error)}\n`);
		return 2;
	}
}

if (import.meta.main) process.exit(await runEntry(process.argv));
