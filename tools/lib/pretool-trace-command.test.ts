import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { composePreToolTraceCommand, PreToolTraceCommandError } from "./pretool-trace-command";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function run(command: string, env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const child = spawn("bash", ["-c", command], {
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
		child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
		child.once("close", (code) => resolve({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), code: code ?? 1 }));
	});
}

async function makeCaptureWrapper(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pretool-trace-command-"));
	temporaryDirectories.push(directory);
	const wrapper = join(directory, "capture wrapper's path.ts");
	await writeFile(wrapper, "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');\n", "utf8");
	await chmod(wrapper, 0o755);
	return wrapper;
}

async function makeExecutionWrapper(): Promise<{ wrapperPath: string; omtDir: string }> {
	const directory = await mkdtemp(join(tmpdir(), "pretool-trace-command-exec-"));
	temporaryDirectories.push(directory);
	const wrapperPath = join(directory, "execution wrapper's path.ts");
	const omtDir = join(directory, "omt");
	await writeFile(
		wrapperPath,
		'import { spawnSync } from "node:child_process";\nconst child = spawnSync("bash", ["-c", process.argv[4] ?? ""], { stdio: "inherit" });\nprocess.exit(child.status ?? 1);\n',
		"utf8",
	);
	await chmod(wrapperPath, 0o755);
	return { wrapperPath, omtDir };
}

describe("pretool trace command composer", () => {
	it("opaque command round trip", async () => {
		const wrapperPath = await makeCaptureWrapper();
		const commands = [
			"",
			`printf '%s' "double" 'single' $HOME \`date\`; echo a;\necho\tback\\slash | cat > /tmp/out`,
			"literal \\$HOME and \\`not-substituted\\` with spaces",
		];

		for (const originalCommand of commands) {
			const command = composePreToolTraceCommand({ wrapperPath, platform: "claude", hookId: "PreToolUse.v1", originalCommand });
			const result = await run(command);
			expect(result.code).toBe(0);
			expect(result.stderr).toBe("");
			expect(JSON.parse(result.stdout)).toEqual(["claude", "PreToolUse.v1", originalCommand]);
		}
	});

	it("expansion exactly once", async () => {
		const { wrapperPath, omtDir } = await makeExecutionWrapper();
		const command = composePreToolTraceCommand({
			wrapperPath,
			platform: "claude",
			hookId: "PreToolUse",
			originalCommand: "printf '%s\\n' \"$HOME\"; printf '%s\\n' \"$CLAUDE_PROJECT_DIR\"; printf '%s\\n' \"\\$HOME\"; printf '%s\\n' '$CLAUDE_PROJECT_DIR'; printf '%s\\n' \"`printf backtick-ok`\"; printf '%s\\n' \"outer '$HOME'\"; printf '%s\\n' 'outer \"$HOME\"'",
		});
		const result = await run(command, {
			HOME: "/controlled/home",
			CLAUDE_PROJECT_DIR: "/controlled/project",
			OMT_DIR: omtDir,
			OMT_HOOK_TRACE_ENABLED: "0",
		});
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("/controlled/home\n/controlled/project\n$HOME\n$CLAUDE_PROJECT_DIR\nbacktick-ok\nouter '/controlled/home'\nouter \"$HOME\"\n");
		expect(await stat(omtDir).then(() => true, () => false)).toBe(false);

		const literalHomeValue = composePreToolTraceCommand({ wrapperPath, platform: "codex", hookId: "PreToolUse", originalCommand: "printf '%s\\n' \"$HOME\"" });
		const literalHomeResult = await run(literalHomeValue, {
			HOME: "$CLAUDE_PROJECT_DIR",
			CLAUDE_PROJECT_DIR: "/controlled/project",
			OMT_DIR: omtDir,
			OMT_HOOK_TRACE_ENABLED: "0",
		});
		expect(literalHomeResult.code).toBe(0);
		expect(literalHomeResult.stdout).toBe("$CLAUDE_PROJECT_DIR\n");
		expect(literalHomeResult.stderr).toBe("");
		expect(await stat(omtDir).then(() => true, () => false)).toBe(false);
	});

	it("has no filesystem dependency", () => {
		expect(composePreToolTraceCommand({ wrapperPath: "/does/not/exist/index.ts", platform: "codex", hookId: "hook", originalCommand: "echo ok" })).toContain("/does/not/exist/index.ts");
	});

	it("metadata validation", () => {
		const valid = { wrapperPath: "/tmp/index.ts", platform: "codex" as const, hookId: "a_0.-Z", originalCommand: "" };
		expect(composePreToolTraceCommand(valid)).toContain("'codex'");
		for (const input of [
			{ ...valid, wrapperPath: "" },
			{ ...valid, wrapperPath: 1 },
			{ ...valid, originalCommand: 1 },
			{ ...valid, platform: "bash" },
			{ ...valid, hookId: "" },
			{ ...valid, hookId: "bad id" },
			{ ...valid, hookId: "bad;id" },
			{ ...valid, hookId: "bad/id" },
			{ ...valid, hookId: "bad\n" },
			{ ...valid, hookId: "a".repeat(129) },
		]) {
			expect(() => composePreToolTraceCommand(input as never)).toThrow(PreToolTraceCommandError);
		}
	});
});
