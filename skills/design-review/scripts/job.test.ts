#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

const SCRIPT = path.join(import.meta.dirname, "job.ts");

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "themis-job-test-"));
}

function writeConfig(configPath: string) {
	fs.writeFileSync(
		configPath,
		[
			"review:",
			"  members:",
			"    - name: tester",
			"      command: echo done",
			"  settings:",
			"    timeout: 10",
		].join("\n"),
		"utf8",
	);
}

const ACTIVE_STATES = new Set(["queued", "running", "retrying", "awaiting_resume"]);

/**
 * Detached workers can still be in their queued startup window after `stop`
 * returns. Keep the job directory until the terminal state has been stable
 * long enough for that worker process to exit, then `clean` can safely enforce
 * its active-member guard without racing the worker's final status write.
 */
async function waitForStableTerminal(jobDir: string, stableMs = 500): Promise<void> {
	const deadline = Date.now() + 15_000;
	let terminalSince: number | null = null;
	while (Date.now() < deadline) {
		const membersDir = path.join(jobDir, "reviewers");
		let allTerminal = fs.existsSync(membersDir);
		if (allTerminal) {
			for (const entry of fs.readdirSync(membersDir)) {
				try {
					const status = JSON.parse(
						fs.readFileSync(path.join(membersDir, entry, "status.json"), "utf8"),
					);
					if (ACTIVE_STATES.has(String(status.state))) {
						allTerminal = false;
						break;
					}
				} catch {
					allTerminal = false;
					break;
				}
			}
		}

		if (allTerminal) {
			terminalSince ??= Date.now();
			if (Date.now() - terminalSince >= stableMs) return;
		} else {
			terminalSince = null;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`worker did not reach a stable terminal state: ${jobDir}`);
}

describe("design-review job lifecycle", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("start creates jobDir and job.json with expected fields", async () => {
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
		writeConfig(configPath);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--json",
				"design-review test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());

		// jobDir exists and starts with expected prefix
		expect(typeof output.jobDir).toBe("string");
		expect(path.basename(output.jobDir).startsWith("themis-")).toBe(true);
		expect(fs.existsSync(output.jobDir)).toBe(true);

		// job.json exists with correct fields
		const jobJson = JSON.parse(fs.readFileSync(path.join(output.jobDir, "job.json"), "utf8"));
		expect(typeof jobJson.id).toBe("string");
		expect(jobJson.id.startsWith("themis-")).toBe(true);
		expect(Array.isArray(jobJson.members)).toBe(true);
		expect(jobJson.members[0].name).toBe("tester");

		// prompt.txt written
		const prompt = fs.readFileSync(path.join(output.jobDir, "prompt.txt"), "utf8");
		expect(prompt).toBe("design-review test prompt");

		// reviewers directory created
		expect(fs.existsSync(path.join(output.jobDir, "reviewers"))).toBe(true);

		// cleanup
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		await waitForStableTerminal(output.jobDir);
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir, "--jobs-dir", jobsDir], {
				stdio: "pipe",
			});
		} catch {}
	});

	test("clean removes jobDir", async () => {
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
		writeConfig(configPath);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const startResult = execFileSync(
			process.execPath,
			[
				SCRIPT,
				"start",
				"--config",
				configPath,
				"--jobs-dir",
				jobsDir,
				"--json",
				"clean lifecycle test",
			],
			{ stdio: "pipe" },
		);

		const { jobDir } = JSON.parse(startResult.toString());
		expect(fs.existsSync(jobDir)).toBe(true);

		// stop workers first, then clean
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", jobDir], { stdio: "pipe" });
		} catch {}
		await waitForStableTerminal(jobDir);
		execFileSync(process.execPath, [SCRIPT, "clean", jobDir, "--jobs-dir", jobsDir], {
			stdio: "pipe",
		});

		expect(fs.existsSync(jobDir)).toBe(false);
	});

	test("queued stop cleanup waits for terminal worker before deleting jobDir", async () => {
		const configPath = path.join(tmpDir, "slow.config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"review:",
				"  members:",
				"    - name: tester",
				"      command: sleep 0.5",
				"  settings:",
				"    timeout: 10",
			].join("\n"),
			"utf8",
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const { jobDir } = JSON.parse(
			execFileSync(
				process.execPath,
				[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "--json", "queued race"],
				{ stdio: "pipe" },
			).toString(),
		);

		// `stop` may observe the freshly-written queued state and return without
		// signaling. Waiting for a stable terminal state is therefore required
		// before clean; clean's queued-member refusal remains intentional.
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", jobDir], { stdio: "pipe" });
		} catch {}
		await waitForStableTerminal(jobDir);
		execFileSync(process.execPath, [SCRIPT, "clean", jobDir, "--jobs-dir", jobsDir], {
			stdio: "pipe",
		});

		expect(fs.existsSync(jobDir)).toBe(false);
	});

	test("start returns plain jobDir path without --json flag", async () => {
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
		writeConfig(configPath);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "plain output test"],
			{ stdio: "pipe" },
		);

		const jobDir = result.toString().trim();
		expect(path.isAbsolute(jobDir)).toBe(true);
		expect(fs.existsSync(jobDir)).toBe(true);
		expect(path.basename(jobDir).startsWith("themis-")).toBe(true);

		try {
			execFileSync(process.execPath, [SCRIPT, "stop", jobDir], { stdio: "pipe" });
		} catch {}
		await waitForStableTerminal(jobDir);
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", jobDir, "--jobs-dir", jobsDir], {
				stdio: "pipe",
			});
		} catch {}
	});

	test("start fails fast when no valid reviewers are configured", () => {
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
		fs.writeFileSync(
			configPath,
			["review:", "  members: []", "  settings:", "    timeout: 10"].join("\n"),
			"utf8",
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		let threw = false;
		let exitCode = 0;
		let stderrOutput = "";
		try {
			execFileSync(
				process.execPath,
				[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "empty members test"],
				{ stdio: "pipe" },
			);
		} catch (e: any) {
			threw = true;
			exitCode = e.status;
			stderrOutput = e.stderr?.toString() || "";
		}

		// start must exit non-zero
		expect(threw).toBe(true);
		expect(exitCode).not.toBe(0);

		// error message must mention no reviewers to dispatch
		expect(stderrOutput).toContain("to dispatch");

		// no job.json must have been written under jobsDir
		const jobDirs = fs.existsSync(jobsDir)
			? fs.readdirSync(jobsDir).filter((d) => d.startsWith("themis-"))
			: [];
		const anyJobJson = jobDirs.some((d) => fs.existsSync(path.join(jobsDir, d, "job.json")));
		expect(anyJobJson).toBe(false);
	});

	test("status returns JSON with members after start", async () => {
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
		writeConfig(configPath);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const startResult = execFileSync(
			process.execPath,
			[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "--json", "status test"],
			{ stdio: "pipe" },
		);

		const { jobDir } = JSON.parse(startResult.toString());

		const statusResult = execFileSync(process.execPath, [SCRIPT, "status", jobDir], {
			stdio: "pipe",
		});

		const status = JSON.parse(statusResult.toString());
		expect(Array.isArray(status.members)).toBe(true);
		expect(typeof status.overallState).toBe("string");
		expect(typeof status.counts).toBe("object");

		try {
			execFileSync(process.execPath, [SCRIPT, "stop", jobDir], { stdio: "pipe" });
		} catch {}
		await waitForStableTerminal(jobDir);
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", jobDir, "--jobs-dir", jobsDir], {
				stdio: "pipe",
			});
		} catch {}
	});
});

describe("resume-member subcommand", () => {
	test("resume-member without jobDir exits with error", () => {
		let exitCode = 0;
		let output = "";
		try {
			execFileSync(process.execPath, [SCRIPT, "resume-member"], { stdio: "pipe" });
		} catch (e: any) {
			exitCode = e.status;
			output = (e.stderr?.toString() || "") + (e.stdout?.toString() || "");
		}
		expect(exitCode).not.toBe(0);
		expect(output).toContain("resume-member: missing jobDir");
	});

	test("resume-member without member name exits with error", () => {
		let exitCode = 0;
		let output = "";
		try {
			execFileSync(process.execPath, [SCRIPT, "resume-member", "/tmp/fake-job"], { stdio: "pipe" });
		} catch (e: any) {
			exitCode = e.status;
			output = (e.stderr?.toString() || "") + (e.stdout?.toString() || "");
		}
		expect(exitCode).not.toBe(0);
		expect(output).toContain("resume-member: missing member name");
	});

	test("resume-member without prompt exits with error", () => {
		let exitCode = 0;
		let output = "";
		try {
			execFileSync(process.execPath, [SCRIPT, "resume-member", "/tmp/fake-job", "themis"], {
				stdio: "pipe",
			});
		} catch (e: any) {
			exitCode = e.status;
			output = (e.stderr?.toString() || "") + (e.stdout?.toString() || "");
		}
		expect(exitCode).not.toBe(0);
		expect(output).toContain("resume-member: missing prompt");
	});
});

// ---------------------------------------------------------------------------
// settings.deny — skills 축 + subagents 축이 job.json에 기록되고, 집행 불가 CLI는
// jobDir 생성 전에 차단된다. `start`가 spawn하는 워커는 member의 진짜 CLI를 exec
// 하므로, 실 CLI 이름을 쓰는 테스트는 PATH를 no-op 스텁으로 가린다.
// ---------------------------------------------------------------------------

function makeCliStubDir(): string {
	const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "themis-cli-stub-"));
	for (const cli of ["codex", "claude", "opencode"]) {
		const stubPath = path.join(stubDir, cli);
		fs.writeFileSync(stubPath, "#!/bin/sh\nexit 0\n");
		fs.chmodSync(stubPath, 0o755);
	}
	return stubDir;
}

describe("settings.deny 배관", () => {
	let tmpDir: string;
	let stubDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		stubDir = makeCliStubDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function writeDenyConfig(configPath: string, command: string) {
		fs.writeFileSync(
			configPath,
			[
				"review:",
				"  members:",
				"    - name: gpt",
				`      command: ${command}`,
				"  settings:",
				"    timeout: 10",
				"    deny:",
				"      subagents: true",
				"      skills:",
				"        - design-review",
				"        - code-review",
			].join("\n"),
			"utf8",
		);
	}

	test("두 축 모두 job.json settings에 기록된다", () => {
		const configPath = path.join(tmpDir, "design-review.config.yaml");
		writeDenyConfig(configPath, "codex exec");
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "--json", "deny prompt"],
			{ stdio: "pipe", env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` } },
		);
		const output = JSON.parse(result.toString());
		expect(output.settings.denySkills).toEqual(["design-review", "code-review"]);
		expect(output.settings.denySubagents).toBe(true);

		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir, "--jobs-dir", jobsDir], {
				stdio: "pipe",
			});
		} catch {}
	});

	test("집행 레버가 없는 CLI member는 exit 1 — jobDir도 만들어지지 않는다", () => {
		const configPath = path.join(tmpDir, "design-review.config.yaml");
		writeDenyConfig(configPath, "echo done");
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		let exitCode = 0;
		let output = "";
		try {
			execFileSync(
				process.execPath,
				[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "--json", "deny prompt"],
				{ stdio: "pipe" },
			);
		} catch (e: any) {
			exitCode = e.status;
			output = (e.stderr?.toString() || "") + (e.stdout?.toString() || "");
		}
		expect(exitCode).toBe(1);
		expect(output).toContain("gpt (unknown)");
		expect(fs.readdirSync(jobsDir)).toEqual([]);
	});

	test("deny.subagents가 boolean이 아니면 exit 1이다", () => {
		const configPath = path.join(tmpDir, "design-review.config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"review:",
				"  members:",
				"    - name: gpt",
				"      command: codex exec",
				"  settings:",
				"    deny:",
				"      subagents: yes-please",
			].join("\n"),
			"utf8",
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		let exitCode = 0;
		let output = "";
		try {
			execFileSync(
				process.execPath,
				[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "--json", "deny prompt"],
				{ stdio: "pipe" },
			);
		} catch (e: any) {
			exitCode = e.status;
			output = (e.stderr?.toString() || "") + (e.stdout?.toString() || "");
		}
		expect(exitCode).toBe(1);
		expect(output).toContain("settings.deny.subagents' must be a boolean");
	});
});
