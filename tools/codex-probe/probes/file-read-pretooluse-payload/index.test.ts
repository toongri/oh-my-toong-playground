import { describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";

import type { RunResult, SessionConfig } from "../../types.ts";
import { FILE_READ_PROMPT, TARGET_FILE_NAME } from "./fixture.ts";
import { buildSessionConfig, main, runEntry } from "./index.ts";

const payload = (toolName: string, toolInput: Record<string, unknown>) =>
	JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput }) + "\n";

async function withScratch<T>(fn: (root: string, auth: string) => Promise<T>): Promise<T> {
	const parent = await fs.mkdtemp(path.join(os.tmpdir(), "file-read-probe-test-"));
	const auth = path.join(parent, "auth.json");
	await fs.writeFile(auth, "{}");
	try {
		return await fn(path.join(parent, "scratch"), auth);
	} finally {
		await fs.rm(parent, { recursive: true, force: true });
	}
}

describe("buildSessionConfig", () => {
	it("uses the target-read prompt, isolated env, and hook-trust bypass", () => {
		const config = buildSessionConfig("/tmp/cwd", { home: "/tmp/home", codexHome: "/tmp/home/.codex" });
		expect(config.prompt).toBe(FILE_READ_PROMPT);
		expect(config.prompt).toContain(TARGET_FILE_NAME);
		expect(config.prompt.toLowerCase()).not.toContain("bash");
		expect(config.env).toEqual({ HOME: "/tmp/home", CODEX_HOME: "/tmp/home/.codex" });
		expect(config.extraArgs).toEqual(["--dangerously-bypass-hook-trust"]);
	});
});

describe("file-read payload entrypoint", () => {
	it("registers PreToolUse capture hook and measures a matching non-shell read", async () => {
		await withScratch(async (scratchRoot, authSourcePath) => {
			let seen!: SessionConfig;
			const runSessionFn = async (config: SessionConfig): Promise<RunResult> => {
				seen = config;
				const hooksPath = path.join(config.env!.CODEX_HOME, "hooks.json");
				const hooks = JSON.parse(await fs.readFile(hooksPath, "utf8"));
				const command = hooks.hooks.PreToolUse[0].hooks[0].command as string;
				expect(command).toMatch(/file-read-pretooluse-capture/);
				const hookResult = Bun.spawnSync(["sh", "-c", `printf '%s' '${payload("read_file", { path: TARGET_FILE_NAME }).trim()}' | ${command}`]);
				expect(hookResult.exitCode).toBe(0);
				return { ok: true, observation: { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "", stderr: "" } };
			};
			const code = await runEntry(["node", "index.ts"], { scratchRoot, authSourcePath, runSessionFn });
			expect(code).toBe(0);
			expect(seen.extraArgs).toEqual(["--dangerously-bypass-hook-trust"]);
		});
	});

	it("emits deterministic inventory for measured pass and measured fail", async () => {
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (config: SessionConfig): Promise<RunResult> => {
				const hooks = JSON.parse(await fs.readFile(path.join(config.env!.CODEX_HOME, "hooks.json"), "utf8"));
				const command = hooks.hooks.PreToolUse[0].hooks[0].command as string;
				Bun.spawnSync(["sh", "-c", `printf '%s' '${payload("read_file", { path: TARGET_FILE_NAME }).trim()}' | ${command}`]);
				return { ok: true, observation: { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "", stderr: "" } };
			};
			expect(await runEntry([], { scratchRoot, authSourcePath, runSessionFn })).toBe(0);
		});
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (config: SessionConfig): Promise<RunResult> => {
				const hooks = JSON.parse(await fs.readFile(path.join(config.env!.CODEX_HOME, "hooks.json"), "utf8"));
				const command = hooks.hooks.PreToolUse[0].hooks[0].command as string;
				Bun.spawnSync(["sh", "-c", `printf '%s' '${payload("read_file", { path: "other.txt" }).trim()}' | ${command}`]);
				return { ok: true, observation: { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "", stderr: "" } };
			};
			expect(await runEntry([], { scratchRoot, authSourcePath, runSessionFn })).toBe(1);
		});
	});

	it("maps missing or invalid capture and setup failures to exit 2", async () => {
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (): Promise<RunResult> => ({ ok: true, observation: { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "", stderr: "" } });
			expect(await runEntry([], { scratchRoot, authSourcePath, runSessionFn })).toBe(2);
		});
		await withScratch(async (scratchRoot, authSourcePath) => {
			const runSessionFn = async (config: SessionConfig): Promise<RunResult> => {
				const hooks = JSON.parse(await fs.readFile(path.join(config.env!.CODEX_HOME, "hooks.json"), "utf8"));
				const command = hooks.hooks.PreToolUse[0].hooks[0].command as string;
				Bun.spawnSync(["sh", "-c", `printf '%s' 'not-json' | ${command}`]);
				return { ok: true, observation: { events: [], toolCalls: [], baseInstructions: "", injectedContext: "", finalMessage: null, rawStdout: "", stderr: "" } };
			};
			expect(await runEntry([], { scratchRoot, authSourcePath, runSessionFn })).toBe(2);
		});
	});
});
