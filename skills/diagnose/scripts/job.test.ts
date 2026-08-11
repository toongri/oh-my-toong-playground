#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

import { buildAugmentedCommand } from "@lib/generic-job";

const SCRIPT = path.join(import.meta.dirname, "job.ts");

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "diagnose-job-test-"));
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

describe("diagnose job lifecycle", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("start creates jobDir and job.json with expected fields", () => {
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
				"diagnose test prompt",
			],
			{ stdio: "pipe" },
		);

		const output = JSON.parse(result.toString());

		// jobDir exists and starts with expected prefix
		expect(typeof output.jobDir).toBe("string");
		expect(path.basename(output.jobDir).startsWith("diagnose-")).toBe(true);
		expect(fs.existsSync(output.jobDir)).toBe(true);

		// job.json exists with correct fields
		const jobJson = JSON.parse(fs.readFileSync(path.join(output.jobDir, "job.json"), "utf8"));
		expect(typeof jobJson.id).toBe("string");
		expect(jobJson.id.startsWith("diagnose-")).toBe(true);
		expect(Array.isArray(jobJson.members)).toBe(true);
		expect(jobJson.members[0].name).toBe("tester");
		// env field must be present on each member (defaults to empty object)
		expect(jobJson.members[0].env).toEqual({});

		// prompt.txt written
		const prompt = fs.readFileSync(path.join(output.jobDir, "prompt.txt"), "utf8");
		expect(prompt).toBe("diagnose test prompt");

		// reviewers directory created
		expect(fs.existsSync(path.join(output.jobDir, "reviewers"))).toBe(true);

		// cleanup
		try {
			execFileSync(process.execPath, [SCRIPT, "stop", output.jobDir], { stdio: "pipe" });
		} catch {}
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", output.jobDir, "--jobs-dir", jobsDir], {
				stdio: "pipe",
			});
		} catch {}
	});

	test("clean removes jobDir", () => {
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
		execFileSync(process.execPath, [SCRIPT, "clean", jobDir, "--jobs-dir", jobsDir], {
			stdio: "pipe",
		});

		expect(fs.existsSync(jobDir)).toBe(false);
	});

	test("start returns plain jobDir path without --json flag", () => {
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
		expect(path.basename(jobDir).startsWith("diagnose-")).toBe(true);

		try {
			execFileSync(process.execPath, [SCRIPT, "stop", jobDir], { stdio: "pipe" });
		} catch {}
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
			[
				"review:",
				"  members:",
				"    - name: typo-member",
				"      commmand: echo done",
				"  settings:",
				"    timeout: 10",
			].join("\n"),
			"utf8",
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		let threw = false;
		let exitCode = 0;
		try {
			execFileSync(
				process.execPath,
				[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "guard test prompt"],
				{ stdio: "pipe" },
			);
		} catch (e: any) {
			threw = true;
			exitCode = e.status;
		}

		// start must exit non-zero
		expect(threw).toBe(true);
		expect(exitCode).not.toBe(0);

		// no job.json must have been written under jobsDir
		const jobDirs = fs.existsSync(jobsDir)
			? fs.readdirSync(jobsDir).filter((d) => d.startsWith("diagnose-"))
			: [];
		const anyJobJson = jobDirs.some((d) => fs.existsSync(path.join(jobsDir, d, "job.json")));
		expect(anyJobJson).toBe(false);
	});

	test("status returns JSON with members after start", () => {
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
		try {
			execFileSync(process.execPath, [SCRIPT, "clean", jobDir, "--jobs-dir", jobsDir], {
				stdio: "pipe",
			});
		} catch {}
	});
});

describe("settings fallback 병합", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("`settings`를 생략한 config에서 default timeout(600)이 job.json에 유지된다", () => {
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
		// settings 블록 없이 members만 정의
		fs.writeFileSync(
			configPath,
			["review:", "  members:", "    - name: tester", "      command: echo done"].join("\n"),
			"utf8",
		);

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
				"fallback timeout test",
			],
			{ stdio: "pipe" },
		);

		const { jobDir } = JSON.parse(result.toString());
		const jobJson = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf8"));

		expect(jobJson.settings.timeoutSec).toBe(600);

		try {
			execFileSync(process.execPath, [SCRIPT, "stop", jobDir], { stdio: "pipe" });
		} catch {}
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
			execFileSync(process.execPath, [SCRIPT, "resume-member", "/tmp/fake-job", "hephaestus"], {
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
	const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "diagnose-cli-stub-"));
	for (const cli of ["opencode", "codex", "claude"]) {
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
				"    - name: hephaestus",
				`      command: ${command}`,
				"  settings:",
				"    timeout: 10",
				"    deny:",
				"      subagents: true",
				"      skills:",
				"        - diagnose",
				"        - code-review",
			].join("\n"),
			"utf8",
		);
	}

	test("두 축 모두 job.json settings에 기록된다", () => {
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
		writeDenyConfig(configPath, "opencode run");
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });

		const result = execFileSync(
			process.execPath,
			[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "--json", "deny prompt"],
			{ stdio: "pipe", env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` } },
		);
		const output = JSON.parse(result.toString());
		expect(output.settings.denySkills).toEqual(["diagnose", "code-review"]);
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
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
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
		expect(output).toContain("hephaestus (unknown)");
		expect(fs.readdirSync(jobsDir)).toEqual([]);
	});

	test("deny.subagents가 boolean이 아니면 exit 1이다", () => {
		const configPath = path.join(tmpDir, "diagnose.config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"review:",
				"  members:",
				"    - name: hephaestus",
				"      command: opencode run",
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

// ---------------------------------------------------------------------------
// 배포되는 실제 diagnose.config.yaml — 픽스처가 아니라 프로덕션 파일을 읽고,
// buildAugmentedCommand로 실제 전송되는 커맨드라인까지 해석해 검사한다.
// 문자열이 파일에 있는지가 아니라 그 선언이 무엇으로 resolve되는지가 계약이다.
// ---------------------------------------------------------------------------

describe("배포 config의 외부 디스패치 계약", () => {
	const CONFIG_PATH = path.join(import.meta.dirname, "..", "diagnose.config.yaml");

	function readMember(): Record<string, unknown> {
		const parsed = Bun.YAML.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<string, any>;
		const members = parsed?.review?.members;
		if (!Array.isArray(members) || members.length !== 1) {
			throw new Error(`${CONFIG_PATH}: 'review.members'는 단일 멤버 배열이어야 한다`);
		}
		return members[0] as Record<string, unknown>;
	}

	test("멤버는 codex exec를 gpt-5.6-sol/high로 실행한다", () => {
		const member = readMember();
		expect(member.command).toBe("codex exec");
		expect(member.model).toBe("gpt-5.6-sol");
		expect(member.effort_level).toBe("high");
	});

	test("opencode·Hephaestus 잔여 참조가 없다", () => {
		const raw = fs.readFileSync(CONFIG_PATH, "utf8");
		expect(raw).not.toContain("opencode");
		expect(raw.toLowerCase()).not.toContain("hephaestus");
	});

	test("codegraph만 MCP 허용 목록에 있다", () => {
		const parsed = Bun.YAML.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<string, any>;
		expect(parsed?.review?.settings?.mcps?.allow).toEqual(["codegraph"]);
	});

	test("해석된 커맨드라인이 모델·추론강도·subagent 차단을 함께 싣는다", () => {
		const member = readMember();
		const parsed = Bun.YAML.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<string, any>;
		const { command } = buildAugmentedCommand(
			{
				command: member.command,
				model: member.model,
				effort_level: member.effort_level,
				output_format: member.output_format,
				denySubagents: parsed?.review?.settings?.deny?.subagents,
			},
			"codex",
		);
		expect(command).toContain("-m gpt-5.6-sol");
		expect(command).toContain("model_reasoning_effort=high");
		expect(command).toContain("agents.enabled=false");
	});
});
