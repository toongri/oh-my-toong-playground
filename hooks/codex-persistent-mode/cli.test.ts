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
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
	readFileSync,
	existsSync,
	readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dirname, "cli.ts");

function mirrorPath(omtDir: string, sessionId: string): string {
	return join(omtDir, `codex-todo-${sessionId}.json`);
}

function postToolUsePayload(
	sessionId: string,
	cwd: string,
	toolName: string,
	toolInput: unknown,
	toolResponse: unknown = null,
) {
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
		tool_response: toolResponse,
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

	describe("hook post-tool-use (writer): skill-chain ratchet observation", () => {
		function writeSkill(name: string, body: string): void {
			const dir = join(projectDir, "skills", name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "SKILL.md"), body);
		}

		test("opening a SKILL.md that sigil-references a real sibling skill records both fields", async () => {
			const sid = "sid-chain-open-1";
			writeSkill("chain-alpha", "Body text. Next, load $chain-bravo to continue.");
			writeSkill("chain-bravo", "chain-bravo body.");

			const payload = postToolUsePayload(sid, projectDir, "exec_command", {
				command: "sed -n '1,240p' skills/chain-alpha/SKILL.md",
			});
			const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");

			const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
			expect(written.openedSkills).toEqual(["chain-alpha"]);
			expect(written.expectedSkills).toEqual(["chain-bravo"]);
		});

		test("uppercase `Bash` tool_name (matcher's registered case) still records the skill chain", async () => {
			const sid = "sid-chain-uppercase-bash";
			writeSkill("chain-alpha", "Body text. Next, load $chain-bravo to continue.");
			writeSkill("chain-bravo", "chain-bravo body.");

			const payload = postToolUsePayload(sid, projectDir, "Bash", {
				command: "sed -n '1,240p' skills/chain-alpha/SKILL.md",
			});
			const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");

			const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
			expect(written.openedSkills).toEqual(["chain-alpha"]);
			expect(written.expectedSkills).toEqual(["chain-bravo"]);
		});

		test("a sigil with no matching sibling skill directory is not recorded as expected", async () => {
			const sid = "sid-chain-false-sigil";
			writeSkill("chain-alpha", "Set $HOME then read the docs.");

			const payload = postToolUsePayload(sid, projectDir, "exec_command", {
				command: "cat skills/chain-alpha/SKILL.md",
			});
			await runCli("post-tool-use", payload, omtDir);

			const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
			expect(written.openedSkills).toEqual(["chain-alpha"]);
			expect(written.expectedSkills ?? []).toEqual([]);
		});

		test("a self-referencing sigil is not recorded as an expected next step", async () => {
			const sid = "sid-chain-self-ref";
			writeSkill("chain-alpha", "See $chain-alpha for background.");

			const payload = postToolUsePayload(sid, projectDir, "exec_command", {
				command: "cat skills/chain-alpha/SKILL.md",
			});
			await runCli("post-tool-use", payload, omtDir);

			const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
			expect(written.openedSkills).toEqual(["chain-alpha"]);
			expect(written.expectedSkills ?? []).toEqual([]);
		});

		test("a command with no SKILL.md reference writes nothing (preserves the update_plan-only regression test)", async () => {
			const sid = "sid-chain-no-ref";
			const payload = postToolUsePayload(sid, projectDir, "exec_command", {
				command: "ls -la",
			});
			const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
			expect(existsSync(mirrorPath(omtDir, sid))).toBe(false);
		});

		test("a subsequent update_plan write merges with, rather than clobbers, prior skill-chain fields", async () => {
			const sid = "sid-chain-merge";
			writeSkill("chain-alpha", "Load $chain-bravo next.");
			writeSkill("chain-bravo", "chain-bravo body.");

			await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "exec_command", {
					command: "cat skills/chain-alpha/SKILL.md",
				}),
				omtDir,
			);
			await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "update_plan", {
					plan: [{ status: "pending" }],
				}),
				omtDir,
			);

			const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
			expect(written).toEqual({
				incomplete: 1,
				openedSkills: ["chain-alpha"],
				expectedSkills: ["chain-bravo"],
			});
		});

		test("opening the expected skill later merges into openedSkills without clobbering", async () => {
			const sid = "sid-chain-progress";
			writeSkill("chain-alpha", "Load $chain-bravo next.");
			writeSkill("chain-bravo", "chain-bravo body.");

			await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "exec_command", {
					command: "cat skills/chain-alpha/SKILL.md",
				}),
				omtDir,
			);
			await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "exec_command", {
					command: "cat skills/chain-bravo/SKILL.md",
				}),
				omtDir,
			);

			const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
			expect(written.openedSkills.sort()).toEqual(["chain-alpha", "chain-bravo"]);
			expect(written.expectedSkills).toEqual(["chain-bravo"]);
		});

		describe("relative SKILL.md path resolves against the command's own workdir, not the top-level cwd", () => {
			test("arm 1: relative path + absolute workdir elsewhere than cwd still records the skill (the fix)", async () => {
				const sid = "sid-chain-workdir-abs";
				const workdirActual = join(projectDir, "workdir-actual");
				mkdirSync(join(workdirActual, "skills", "chain-abs"), { recursive: true });
				writeFileSync(join(workdirActual, "skills", "chain-abs", "SKILL.md"), "chain-abs body.");
				const unrelatedCwd = join(projectDir, "unrelated-cwd");

				const payload = postToolUsePayload(sid, unrelatedCwd, "exec_command", {
					cmd: "cat skills/chain-abs/SKILL.md",
					workdir: workdirActual,
				});
				const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
				expect(exitCode).toBe(0);
				expect(stdout).toBe("");

				const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
				expect(written.openedSkills).toEqual(["chain-abs"]);
			});

			test("arm 2 (regression): relative path + no workdir still resolves against cwd", async () => {
				const sid = "sid-chain-workdir-absent";
				writeSkill("chain-noworkdir", "chain-noworkdir body.");

				const payload = postToolUsePayload(sid, projectDir, "exec_command", {
					command: "cat skills/chain-noworkdir/SKILL.md",
				});
				const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
				expect(exitCode).toBe(0);
				expect(stdout).toBe("");

				const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
				expect(written.openedSkills).toEqual(["chain-noworkdir"]);
			});

			test("arm 3: relative path + relative workdir resolves the workdir against cwd first", async () => {
				const sid = "sid-chain-workdir-rel";
				mkdirSync(join(projectDir, "sub", "dir", "skills", "chain-rel"), { recursive: true });
				writeFileSync(
					join(projectDir, "sub", "dir", "skills", "chain-rel", "SKILL.md"),
					"chain-rel body.",
				);

				const payload = postToolUsePayload(sid, projectDir, "exec_command", {
					command: "cat skills/chain-rel/SKILL.md",
					workdir: "sub/dir",
				});
				const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
				expect(exitCode).toBe(0);
				expect(stdout).toBe("");

				const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
				expect(written.openedSkills).toEqual(["chain-rel"]);
			});

			test("tool_input.cwd is accepted as a workdir alias (sibling extractor's dual-key contract)", async () => {
				const sid = "sid-chain-workdir-cwd-alias";
				const workdirActual = join(projectDir, "workdir-cwd-alias");
				mkdirSync(join(workdirActual, "skills", "chain-cwdalias"), { recursive: true });
				writeFileSync(
					join(workdirActual, "skills", "chain-cwdalias", "SKILL.md"),
					"chain-cwdalias body.",
				);
				const unrelatedCwd = join(projectDir, "unrelated-cwd-2");

				const payload = postToolUsePayload(sid, unrelatedCwd, "exec_command", {
					command: "cat skills/chain-cwdalias/SKILL.md",
					cwd: workdirActual,
				});
				const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
				expect(exitCode).toBe(0);
				expect(stdout).toBe("");

				const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
				expect(written.openedSkills).toEqual(["chain-cwdalias"]);
			});
		});
	});

	describe("hook post-tool-use: failed tool_response gate (5th review round regression)", () => {
		function writeSkill(name: string, body: string): void {
			const dir = join(projectDir, "skills", name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "SKILL.md"), body);
		}

		test("arm 1: update_plan + tool_response {exit_code:1} writes no mirror (false-complete guard)", async () => {
			const sid = "sid-gate-update-plan-failed";
			const payload = postToolUsePayload(
				sid,
				projectDir,
				"update_plan",
				{ plan: [{ status: "completed" }, { status: "completed" }] },
				{ exit_code: 1, error: "plan update rejected" },
			);
			const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
			expect(existsSync(mirrorPath(omtDir, sid))).toBe(false);
		});

		test("arm 1b: update_plan + failed tool_response leaves a prior mirror value unchanged", async () => {
			const sid = "sid-gate-update-plan-failed-preexisting";
			const path = mirrorPath(omtDir, sid);
			writeFileSync(path, JSON.stringify({ incomplete: 2 }));
			const payload = postToolUsePayload(
				sid,
				projectDir,
				"update_plan",
				{ plan: [{ status: "completed" }, { status: "completed" }] },
				{ exit_code: 1, error: "plan update rejected" },
			);
			const { exitCode } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ incomplete: 2 });
		});

		test("arm 2: exec_command referencing an existing SKILL.md + tool_response {exit_code:1} records nothing", async () => {
			const sid = "sid-gate-exec-failed";
			writeSkill("chain-alpha", "Body text. Next, load $chain-bravo to continue.");
			writeSkill("chain-bravo", "chain-bravo body.");
			const payload = postToolUsePayload(
				sid,
				projectDir,
				"exec_command",
				{ command: "grep -c zzz skills/chain-bravo/SKILL.md" },
				{ exit_code: 1 },
			);
			const { exitCode, stdout } = await runCli("post-tool-use", payload, omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
			expect(existsSync(mirrorPath(omtDir, sid))).toBe(false);
		});

		test("arm 3 (ratchet-escape regression): a failed reference to the pending next-step skill still blocks stop", async () => {
			const sid = "sid-gate-ratchet-escape";
			writeSkill("chain-alpha", "Body text. Next, load $chain-bravo to continue.");
			writeSkill("chain-bravo", "chain-bravo body.");

			// Normal arm: opens chain-alpha, expects chain-bravo.
			await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "exec_command", {
					command: "cat skills/chain-alpha/SKILL.md",
				}),
				omtDir,
			);
			const stopBeforeFailedRef = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(JSON.parse(stopBeforeFailedRef.stdout).decision).toBe("block");

			// Failed command referencing chain-bravo/SKILL.md must NOT record it as opened.
			await runCli(
				"post-tool-use",
				postToolUsePayload(
					sid,
					projectDir,
					"exec_command",
					{ command: "grep -c zzz skills/chain-bravo/SKILL.md" },
					{ exit_code: 1 },
				),
				omtDir,
			);

			const written = JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"));
			expect(written.openedSkills).toEqual(["chain-alpha"]);
			expect(written.expectedSkills).toEqual(["chain-bravo"]);

			const stopResult = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			const parsed = JSON.parse(stopResult.stdout);
			expect(parsed.decision).toBe("block");
			expect(parsed.reason).toContain("chain-bravo");
		});

		test("arm 4 (false-complete regression): a rejected 'all-complete' update_plan still blocks stop", async () => {
			const sid = "sid-gate-false-complete";
			const path = mirrorPath(omtDir, sid);

			await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "update_plan", {
					plan: [{ status: "pending" }, { status: "pending" }],
				}),
				omtDir,
			);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ incomplete: 2 });

			await runCli(
				"post-tool-use",
				postToolUsePayload(
					sid,
					projectDir,
					"update_plan",
					{ plan: [{ status: "completed" }, { status: "completed" }] },
					{ exit_code: 1, error: "plan update rejected" },
				),
				omtDir,
			);
			expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ incomplete: 2 });

			const stopResult = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			const parsed = JSON.parse(stopResult.stdout);
			expect(parsed.decision).toBe("block");
			expect(parsed.reason).toContain("2");
		});

		test("arm 5 (success control group): successful/absent tool_response shapes all record normally", async () => {
			const successShapes: Array<{ name: string; toolResponse: unknown }> = [
				{ name: "exit_code-0", toolResponse: { exit_code: 0 } },
				{ name: "null", toolResponse: null },
				{ name: "empty-object", toolResponse: {} },
			];
			for (const shape of successShapes) {
				const sid = `sid-gate-success-${shape.name}`;
				const { exitCode } = await runCli(
					"post-tool-use",
					postToolUsePayload(
						sid,
						projectDir,
						"update_plan",
						{ plan: [{ status: "pending" }] },
						shape.toolResponse,
					),
					omtDir,
				);
				expect(exitCode).toBe(0);
				expect(JSON.parse(readFileSync(mirrorPath(omtDir, sid), "utf8"))).toEqual({ incomplete: 1 });
			}

			// tool_response field absent entirely (not merely null).
			const sidAbsent = "sid-gate-success-field-absent";
			const payloadAbsent = postToolUsePayload(sidAbsent, projectDir, "update_plan", {
				plan: [{ status: "pending" }],
			});
			delete (payloadAbsent as Record<string, unknown>)["tool_response"];
			const { exitCode: exitCodeAbsent } = await runCli("post-tool-use", payloadAbsent, omtDir);
			expect(exitCodeAbsent).toBe(0);
			expect(JSON.parse(readFileSync(mirrorPath(omtDir, sidAbsent), "utf8"))).toEqual({ incomplete: 1 });
		});

		test("arm 6 (failure-predicate axis): isError/error-string/status=error each block the write", async () => {
			const failureShapes: Array<{ name: string; toolResponse: unknown }> = [
				{ name: "isError-true", toolResponse: { isError: true } },
				{ name: "error-string", toolResponse: { error: "permission denied" } },
				{ name: "status-error", toolResponse: { status: "error" } },
			];
			for (const shape of failureShapes) {
				const sid = `sid-gate-failure-${shape.name}`;
				const { exitCode } = await runCli(
					"post-tool-use",
					postToolUsePayload(
						sid,
						projectDir,
						"update_plan",
						{ plan: [{ status: "pending" }] },
						shape.toolResponse,
					),
					omtDir,
				);
				expect(exitCode).toBe(0);
				expect(existsSync(mirrorPath(omtDir, sid))).toBe(false);
			}
		});
	});

	describe("hook stop (reader): skill-chain ratchet", () => {
		function writeSkill(name: string, body: string): void {
			const dir = join(projectDir, "skills", name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "SKILL.md"), body);
		}

		test("unresolved chain blocks stop, naming the pending skill", async () => {
			const sid = "sid-chain-stop-block";
			writeFileSync(
				mirrorPath(omtDir, sid),
				JSON.stringify({ openedSkills: ["chain-alpha"], expectedSkills: ["chain-bravo"] }),
			);
			const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(exitCode).toBe(0);
			const parsed = JSON.parse(stdout);
			expect(parsed.decision).toBe("block");
			expect(parsed.reason).toContain("<skill-chain-continuation>");
			expect(parsed.reason).toContain("chain-bravo");
		});

		test("resolved chain (expected already opened) allows stop", async () => {
			const sid = "sid-chain-stop-allow";
			writeFileSync(
				mirrorPath(omtDir, sid),
				JSON.stringify({ openedSkills: ["chain-alpha", "chain-bravo"], expectedSkills: ["chain-bravo"] }),
			);
			const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
		});

		test("no chain in play (negative control) allows stop", async () => {
			const sid = "sid-chain-stop-none";
			writeFileSync(mirrorPath(omtDir, sid), JSON.stringify({ incomplete: 0 }));
			const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(exitCode).toBe(0);
			expect(stdout).toBe("");
		});

		test("full round trip: open chain-alpha (unresolved) blocks, then open chain-bravo (resolved) allows", async () => {
			const sid = "sid-chain-roundtrip";
			writeSkill("chain-alpha", "Load $chain-bravo next.");
			writeSkill("chain-bravo", "chain-bravo body.");

			await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "exec_command", {
					command: "cat skills/chain-alpha/SKILL.md",
				}),
				omtDir,
			);
			const stopResult1 = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			const parsed1 = JSON.parse(stopResult1.stdout);
			expect(parsed1.decision).toBe("block");
			expect(parsed1.reason).toContain("chain-bravo");

			await runCli(
				"post-tool-use",
				postToolUsePayload(sid, projectDir, "exec_command", {
					command: "cat skills/chain-bravo/SKILL.md",
				}),
				omtDir,
			);
			const stopResult2 = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(stopResult2.stdout).toBe("");
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
					state: {
						phase: "in_progress",
						// non-goal decider Closure Guard (SKILL.md:146): a done-token is
						// refused while zero non-goals carry a non-empty decider, so the
						// allow-stop path requires at least one recorded decider — mirrors
						// decision.test.ts UC13 "cleans up when … non-empty decider".
						non_goals: [{ item: "out-of-scope thing", decider: "user confirmed out of scope in round 2" }],
					},
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

		// runtime-leak fix: the Stop hook's own OUTPUT must never hardcode the
		// Claude-only AskUserQuestion tool name — this reader passes
		// askToolName: "request_user_input" (Codex's real analog) into the
		// shared makeDecision core (lib/persistent-mode-core/decision.ts), which
		// defaults to "AskUserQuestion" only when the field is omitted (Claude).
		test("block reason names request_user_input, never AskUserQuestion (Codex ask-tool vocabulary)", async () => {
			const sid = "sid-ask-tool-vocabulary";
			writeFileSync(mirrorPath(omtDir, sid), JSON.stringify({ incomplete: 2 }));
			const { exitCode, stdout } = await runCli("stop", stopPayload(sid, projectDir), omtDir);
			expect(exitCode).toBe(0);
			const parsed = JSON.parse(stdout);
			expect(parsed.decision).toBe("block");
			expect(parsed.reason).toContain("request_user_input");
			expect(parsed.reason).not.toContain("AskUserQuestion");
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
