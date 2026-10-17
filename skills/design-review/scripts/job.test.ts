#!/usr/bin/env bun

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

import { getPgidSnapshot, judgePgidSignal } from "@lib/generic-job";

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
 * returns. Wait until every recorded worker process group has exited and every
 * member state is terminal, so `clean` can safely enforce its active-member
 * guard without racing a worker's final status write. Exit is observed from
 * the process group itself, never inferred from state staying unchanged.
 */
async function waitForWorkersExited(jobDir: string): Promise<void> {
	// 상한은 hang guard일 뿐이다 — 워커가 이미 끝났다면 첫 확인에서 바로 반환한다.
	const deadline = Date.now() + 45_000;
	while (Date.now() < deadline) {
		if (workersExited(jobDir) && memberStatesTerminal(jobDir)) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`worker did not exit with a terminal state: ${jobDir}`);
}

function workersExited(jobDir: string): boolean {
	let members: Array<{ workerPgid?: unknown; workerPgidStartedAt?: unknown }>;
	try {
		members = JSON.parse(fs.readFileSync(path.join(jobDir, "job.json"), "utf8")).members ?? [];
	} catch {
		return false;
	}
	const snapshot = getPgidSnapshot();
	return members.every(({ workerPgid, workerPgidStartedAt }) => {
		if (typeof workerPgid !== "number") return true;
		if (typeof workerPgidStartedAt === "string" && workerPgidStartedAt.trim() !== "") {
			return judgePgidSignal(workerPgid, workerPgidStartedAt, snapshot) !== "signal";
		}
		try {
			process.kill(-workerPgid, 0);
			return false;
		} catch {
			return true;
		}
	});
}

function memberStatesTerminal(jobDir: string): boolean {
	const membersDir = path.join(jobDir, "reviewers");
	if (!fs.existsSync(membersDir)) return false;
	for (const entry of fs.readdirSync(membersDir)) {
		try {
			const status = JSON.parse(fs.readFileSync(path.join(membersDir, entry, "status.json"), "utf8"));
			if (ACTIVE_STATES.has(String(status.state))) return false;
		} catch {
			return false;
		}
	}
	return true;
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
		await waitForWorkersExited(output.jobDir);
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
		await waitForWorkersExited(jobDir);
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
		await waitForWorkersExited(jobDir);
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
		await waitForWorkersExited(jobDir);
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
		await waitForWorkersExited(jobDir);
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

describe("settings.mcp 배관", () => {
	const CONFIG_PATH = path.join(import.meta.dirname, "..", "design-review.config.yaml");
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// codex stub가 받은 실제 argv를 파일로 남긴다. `mcp list`에는 지어낸 서버 이름만 가진 fixture JSON으로 답한다.
	async function startWithCodexStub(configPath: string) {
		const jobsDir = path.join(tmpDir, "jobs");
		const codexHome = path.join(tmpDir, "codex-home");
		const binDir = path.join(tmpDir, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.mkdirSync(codexHome, { recursive: true });
		fs.writeFileSync(
			path.join(codexHome, "mcp-list.json"),
			JSON.stringify(
				["codegraph", "srv-blocked"].map((name) => ({ name, enabled: true, transport: { type: "stdio" } })),
			),
		);
		const argvPath = path.join(tmpDir, "codex-argv.txt");
		const stubPath = path.join(binDir, "codex");
		fs.writeFileSync(stubPath, '#!/bin/sh\ncase " $* " in *" mcp list "*) cat "$CODEX_HOME/mcp-list.json"; exit 0;; esac\nprintf "%s\\n" "$@" > "$STUB_CODEX_ARGV.tmp" && mv "$STUB_CODEX_ARGV.tmp" "$STUB_CODEX_ARGV"\n', "utf8");
		fs.chmodSync(stubPath, 0o755);
		const env = {
			...process.env,
			CODEX_HOME: codexHome,
			STUB_CODEX_ARGV: argvPath,
			PATH: `${binDir}:${process.env.PATH || ""}`,
		};
		const result = execFileSync(
			process.execPath,
			[SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "--json", "mcp test"],
			{ stdio: "pipe", env },
		);
		const member = JSON.parse(result.toString()).members[0];
		// 상한은 실패 선언 시점만 정한다 — 파일이 끝내 안 생기면 그대로 실패한다.
		// 여기서 기다리는 대상은 별도로 스폰된 워커 프로세스이고, 전체 스위트
		// 부하에서 프로세스 기동만 5.8초까지 늘어난 것이 실측됐다. 30회 x 20ms
		// (0.6초) 상한은 결함 없이도 만료된다.
		const argvDeadline = Date.now() + 45_000;
		while (!fs.existsSync(argvPath) && Date.now() < argvDeadline)
			await new Promise((resolve) => setTimeout(resolve, 20));
		expect(fs.existsSync(argvPath)).toBe(true);
		const argv = fs.readFileSync(argvPath, "utf8").split("\n").filter(Boolean);
		return { member, argv };
	}

	test("reset + add를 job metadata와 실제 codex argv에 적용한다", async () => {
		const configPath = path.join(tmpDir, "design-review.config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"review:",
				"  members:",
				"    - name: tester",
				"      command: codex exec",
				"  settings:",
				"    timeout: 10",
				"    mcp:",
				"      reset: true",
				"      add:",
				"        codegraph:",
				"          command: codegraph",
				"          args: [serve, --mcp]",
			].join("\n"),
			"utf8",
		);
		const { member, argv } = await startWithCodexStub(configPath);
		expect(member.mcpReset).toBe(true);
		expect(member.mcpAdd).toEqual({ codegraph: { command: "codegraph", args: ["serve", "--mcp"] } });
		expect(member.mcpBlock).toEqual(["srv-blocked"]);
		const disabled = argv.flatMap((arg, i) => (arg === "--disable" ? [argv[i + 1]] : []));
		expect(disabled).toEqual(["plugins", "apps"]);
		expect(argv).toContain("mcp_servers.srv-blocked.enabled=false");
		expect(argv).not.toContain("mcp_servers.codegraph.enabled=false");
		expect(argv).toContain('mcp_servers.codegraph.command="codegraph"');
		expect(argv).toContain('mcp_servers.codegraph.args=["serve","--mcp"]');
	});

	test("settings.mcp가 없으면 MCP 관련 플래그를 하나도 붙이지 않는다", async () => {
		const configPath = path.join(tmpDir, "design-review.config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"review:",
				"  members:",
				"    - name: tester",
				"      command: codex exec",
				"  settings:",
				"    timeout: 10",
			].join("\n"),
			"utf8",
		);
		const { member, argv } = await startWithCodexStub(configPath);
		expect(member.mcpReset).toBe(false);
		expect(member.mcpAdd).toEqual({});
		expect(member.mcpBlock).toEqual([]);
		expect(argv).not.toContain("--disable");
		expect(argv.filter((arg) => arg.startsWith("mcp_servers."))).toEqual([]);
	});

	test("malformed settings.mcp는 worker와 job 생성 전에 거부한다", () => {
		const configPath = path.join(tmpDir, "design-review.config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"review:",
				"  members:",
				"    - name: tester",
				"      command: codex exec",
				"  settings:",
				"    mcp:",
				"      add:",
				"        bad.name:",
				"          command: x",
			].join("\n"),
			"utf8",
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
		let error: any;
		try {
			execFileSync(process.execPath, [SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "bad mcp"], {
				stdio: "pipe",
			});
		} catch (caught) {
			error = caught;
		}
		expect(error?.status).toBe(1);
		expect(`${error?.stderr?.toString() || ""}`).toContain("review.settings.mcp.add");
		expect(fs.readdirSync(jobsDir)).toEqual([]);
	});

	test("settings.mcp가 있는데 codex/claude가 아닌 멤버가 있으면 job 생성 전에 거부한다", () => {
		const configPath = path.join(tmpDir, "design-review.config.yaml");
		fs.writeFileSync(
			configPath,
			[
				"review:",
				"  members:",
				"    - name: tester",
				"      command: gemini",
				"  settings:",
				"    mcp:",
				"      reset: true",
			].join("\n"),
			"utf8",
		);
		const jobsDir = path.join(tmpDir, "jobs");
		fs.mkdirSync(jobsDir, { recursive: true });
		let error: any;
		try {
			execFileSync(process.execPath, [SCRIPT, "start", "--config", configPath, "--jobs-dir", jobsDir, "gemini mcp"], {
				stdio: "pipe",
			});
		} catch (caught) {
			error = caught;
		}
		expect(error?.status).toBe(1);
		expect(`${error?.stderr?.toString() || ""}`).toContain("codex and claude");
		expect(fs.readdirSync(jobsDir)).toEqual([]);
	});

	test("deployed config는 settings.mcp를 선언하지 않는다 (모든 MCP 서버를 그대로 상속)", () => {
		const parsed = Bun.YAML.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<string, any>;
		expect(parsed.review.settings.mcp).toBeUndefined();
		expect(parsed.review.settings.mcps).toBeUndefined();
	});
});
