#!/usr/bin/env bun

/**
 * Hermetic tests for the codex-persistent-mode CLI: two subcommands over stdin,
 * `hook post-tool-use` (the update_plan writer, G6-2) and `hook stop` (the
 * fail-open reader, G6-1 / G6-3).
 *
 * Every test spawns the real binary (`bun run cli.ts hook <sub>`) with
 * `env.OMT_DIR` pointed at a fresh mkdtemp dir, so `resolveOmtDir` never
 * touches real $HOME. Never import cli.ts directly — its top-level dispatch
 * reads real stdin as a side effect of module load.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dirname, "cli.ts");

function mirrorPath(omtDir: string, sessionId: string): string {
	return join(omtDir, `codex-todo-${sessionId}.json`);
}

function postToolUsePayload(sessionId: string, cwd: string, toolName: string, toolInput: unknown) {
	return {
		session_id: sessionId,
		turn_id: "t1",
		transcript_path: null,
		cwd,
		hook_event_name: "PostToolUse",
		model: "gpt-5.6-sol",
		permission_mode: "auto",
		tool_name: toolName,
		tool_input: toolInput,
		tool_response: null,
		tool_use_id: "tu1",
	};
}

function stopPayload(sessionId: string, cwd: string, lastAssistantMessage?: string) {
	const payload: Record<string, unknown> = {
		session_id: sessionId,
		cwd,
		hook_event_name: "Stop",
	};
	if (lastAssistantMessage !== undefined) {
		payload["last_assistant_message"] = lastAssistantMessage;
	}
	return payload;
}

async function runCli(
	subcommand: "post-tool-use" | "stop",
	input: unknown,
	omtDir: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["bun", "run", CLI_PATH, "hook", subcommand], {
		stdin: new TextEncoder().encode(JSON.stringify(input)),
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, OMT_DIR: omtDir },
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { exitCode, stdout, stderr };
}

describe("codex-persistent-mode cli", () => {
	let omtDir: string;
	let projectDir: string;

	beforeEach(() => {
		omtDir = mkdtempSync(join(tmpdir(), "codex-persistent-mode-omt-"));
		projectDir = mkdtempSync(join(tmpdir(), "codex-persistent-mode-proj-"));
	});

	afterEach(() => {
		rmSync(omtDir, { recursive: true, force: true });
		rmSync(projectDir, { recursive: true, force: true });
	});

	describe("hook post-tool-use (writer, G6-2)", () => {
		test("3-step plan with 1 completed writes {incomplete:2}", async () => {
			const sid = "sid-writer-1";
			const payload = postToolUsePayload(sid, projectDir, "update_plan", {
				plan: [{ status: "completed" }, { status: "pending" }, { status: "in_progress" }],
			});
			const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
			const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
			expect(written).toEqual({ incomplete: 2 });
		});

		test("release valve: all-completed plan overwrites an existing file with {incomplete:0}", async () => {
			const sid = "sid-valve-1";
			const path = mirrorPath(omtDir, sid);
			writeFileSync(path, JSON.stringify({ incomplete: 5 }));
			const payload = postToolUsePayload(sid, projectDir, "update_plan", {
				plan: [{ status: "completed" }, { status: "completed" }],
			});
			const { exitCode } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ incomplete: 0 });
		});

		test("non-completed count tracks the payload, not a constant (2 !== 0)", async () => {
			const sidA = "sid-nonconst-a";
			const sidB = "sid-nonconst-b";
			await runCli(
				"post-tool-use",
				postToolUsePayload(sidA, projectDir, "update_plan", {
					plan: [{ status: "pending" }, { status: "pending" }],
				}),
				omtDir,
			);
			await runCli(
				"post-tool-use",
				postToolUsePayload(sidB, projectDir, "update_plan", {
					plan: [{ status: "completed" }, { status: "completed" }],
				}),
				omtDir,
			);
			const a = JSON.parse(readFileSync(mirrorPath(omtDir, sidA), "utf8"));
			const b = JSON.parse(readFileSync(mirrorPath(omtDir, sidB), "utf8"));
			expect(a.incomplete).not.toBe(b.incomplete);
			expect(a).toEqual({ incomplete: 2 });
			expect(b).toEqual({ incomplete: 0 });
		});

		test("tool_name other than update_plan writes no file at all", async () => {
			const sid = "sid-other-tool";
			const payload = postToolUsePayload(sid, projectDir, "exec_command", {
				plan: [{ status: "pending" }],
			});
			const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
			expect(existsSync(mirrorPath(omtDir, sid))).toBe(false);
		});

		test("defensive parse: missing/non-array/empty plan and status-less entries never throw", async () => {
			const cases: Array<{ sid: string; toolInput: unknown; expected: number }> = [
				{ sid: "sid-missing-plan", toolInput: {}, expected: 0 },
				{ sid: "sid-nonarray-plan", toolInput: { plan: "not-an-array" }, expected: 0 },
				{ sid: "sid-empty-plan", toolInput: { plan: [] }, expected: 0 },
				{ sid: "sid-no-status", toolInput: { plan: [{ step: "do a thing" }] }, expected: 1 },
				{
					sid: "sid-nonobject-entry",
					toolInput: { plan: [{ status: "completed" }, "garbage", 42] },
					expected: 2,
				},
			];
			for (const c of cases) {
				const payload = postToolUsePayload(c.sid, projectDir, "update_plan", c.toolInput);
				const { exitCode, stdout, stderr } = await runCli("post-tool-use", payload, omtDir);
				expect({ sid: c.sid, exitCode, stdout, stderr }).toEqual({
					sid: c.sid,
					exitCode: 0,
					stdout: "",
					stderr: "",
				});
				const written = JSON.parse(readFileSync(mirrorPath(omtDir, c.sid), "utf8"));
				expect({ sid: c.sid, written }).toEqual({ sid: c.sid, written: { incomplete: c.expected } });
			}
		});
	});

	describe("hook stop (reader, G6-1 / G6-3)", () => {
		test("G6-1: incomplete:2 blocks with a non-empty reason naming the count", async () => {
			const sid = "sid-block-1";
			writeFileSync(mirrorPath(omtDir, sid), JSON.stringify({ incomplete: 2 }));
			const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(exitCode).toBe(0);
			const parsed = JSON.parse(stdout);
			expect(parsed).toEqual({ decision: "block", reason: parsed.reason });
			expect(typeof parsed.reason).toBe("string");
			expect(parsed.reason.length).toBeGreaterThan(0);
			expect(parsed.reason).toContain("2");
		});

		test("G6-3: mirror file absent prints 0 bytes, exit 0", async () => {
			const sid = "sid-absent-1";
			const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
		});

		const failOpenCases: Array<{ name: string; content: string }> = [
			{ name: "incomplete:0", content: JSON.stringify({ incomplete: 0 }) },
			{ name: "malformed JSON", content: "{not valid json" },
			{ name: 'incomplete:"x" (non-number)', content: JSON.stringify({ incomplete: "x" }) },
			{ name: "incomplete:-1 (negative)", content: JSON.stringify({ incomplete: -1 }) },
		];
		for (const c of failOpenCases) {
			test(`G6-3: fail-open on ${c.name}`, async () => {
				const sid = `sid-failopen-${c.name.replace(/[^a-z0-9]/gi, "")}`;
				writeFileSync(mirrorPath(omtDir, sid), c.content);
				const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
				expect(exitCode).toBe(0);
				expect(stdout).toBe("");
			});
		}
	});

	describe("hook stop: shared continuation contract (makeDecision integration)", () => {
		test("awaiting-user token allows stop even with incomplete=2 (priority over baseline-todo)", async () => {
			const sid = "sid-awaiting-with-incomplete";
			writeFileSync(mirrorPath(omtDir, sid), JSON.stringify({ incomplete: 2 }));
			const { exitCode, stdout } = await runCli(
				"stop",
				stopPayload(sid, projectDir, "wrapping up for now <awaiting-user/>"),
				omtDir,
			);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
		});

		test("awaiting-user token allows stop with incomplete=0", async () => {
			const sid = "sid-awaiting-no-incomplete";
			writeFileSync(mirrorPath(omtDir, sid), JSON.stringify({ incomplete: 0 }));
			const { exitCode, stdout } = await runCli(
				"stop",
				stopPayload(sid, projectDir, "<awaiting-user/>"),
				omtDir,
			);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
		});

		test("active deep-interview state blocks stop when no done-token", async () => {
			const sid = "sid-deep-interview-active-blocks";
			writeFileSync(
				join(omtDir, `deep-interview-active-state-${sid}.json`),
				JSON.stringify({
					active: true,
					sessionId: sid,
					started_at: new Date().toISOString(),
					last_touched_at: new Date().toISOString(),
					state: { phase: "in_progress" },
				}),
			);
			const { exitCode, stdout } = await runCli(
				"stop",
				stopPayload(sid, projectDir, "still interviewing, no token yet"),
				omtDir,
			);
			expect(exitCode).toBe(0);
			const parsed = JSON.parse(stdout);
			expect(parsed.decision).toBe("block");
			expect(parsed.reason).toContain("<deep-interview-continuation>");
		});

		test("deep-interview done-token clears active state and allows stop", async () => {
			const sid = "sid-deep-interview-done";
			const statePath = join(omtDir, `deep-interview-active-state-${sid}.json`);
			writeFileSync(
				statePath,
				JSON.stringify({
					active: true,
					sessionId: sid,
					started_at: new Date().toISOString(),
					last_touched_at: new Date().toISOString(),
					state: { phase: "in_progress" },
				}),
			);
			const { exitCode, stdout } = await runCli(
				"stop",
				stopPayload(sid, projectDir, "interview complete <deep-interview-done/>"),
				omtDir,
			);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
			expect(existsSync(statePath)).toBe(false);
		});

		test("last_assistant_message absent + incomplete=2 blocks (fail-open defers to incomplete count)", async () => {
			const sid = "sid-no-lam-blocks";
			writeFileSync(mirrorPath(omtDir, sid), JSON.stringify({ incomplete: 2 }));
			const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(exitCode).toBe(0);
			const parsed = JSON.parse(stdout);
			expect(parsed.decision).toBe("block");
			expect(parsed.reason).toContain("2");
		});

		test("last_assistant_message absent + incomplete=0 allows stop", async () => {
			const sid = "sid-no-lam-allows";
			writeFileSync(mirrorPath(omtDir, sid), JSON.stringify({ incomplete: 0 }));
			const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
		});
	});

	describe("path-traversal guard", () => {
		test("unsafe session_id: writer writes nothing, reader fails open, nothing escapes omtDir", async () => {
			const unsafeSid = "../evil";
			const writerResult = await runCli(
				"post-tool-use",
				postToolUsePayload(unsafeSid, projectDir, "update_plan", { plan: [{ status: "pending" }] }),
				omtDir,
			);
			expect(writerResult.exitCode).toBe(0);
			expect(writerResult.stdout).toBe("");
			expect(readdirSync(omtDir)).toEqual([]);

			const readerResult = await runCli("stop", stopPayload(unsafeSid, projectDir), omtDir);
			expect(readerResult.exitCode).toBe(0);
			expect(readerResult.stdout).toBe("");
			expect(readdirSync(omtDir)).toEqual([]);
		});
	});

	describe("round trip: writer then reader on the same $OMT_DIR + session_id", () => {
		test("blocks while incomplete, then releases once the plan is all-completed", async () => {
			const sid = "sid-roundtrip-1";

			const writeResult1 = await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "update_plan", {
					plan: [{ status: "pending" }, { status: "completed" }],
				}),
				omtDir,
			);
			expect(writeResult1.exitCode).toBe(0);

			const stopResult1 = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(stopResult1.exitCode).toBe(0);
			const parsed1 = JSON.parse(stopResult1.stdout);
			expect(parsed1.decision).toBe("block");
			expect(parsed1.reason.length).toBeGreaterThan(0);

			const writeResult2 = await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "update_plan", {
					plan: [{ status: "completed" }, { status: "completed" }],
				}),
				omtDir,
			);
			expect(writeResult2.exitCode).toBe(0);

			const stopResult2 = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(stopResult2.exitCode).toBe(0);
			expect(stopResult2.stdout).toBe("");
		});
	});
});
