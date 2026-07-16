import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import fs2 from "fs";
import path from "path";
import os from "os";

import { formatDeployedRoots } from "./sync.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Writes an executable fake formatter shell script that logs its cwd (first
 * line) and each received argv (one per line, via `printf '%s\n' "$@"`) to
 * `logPath`, then exits with `exitCode`. Used instead of mocking Bun.spawn —
 * this exercises the real subprocess + real disk, mirroring the auto-
 * vendoring test's approach (tools/sync.ts:1258-1266).
 */
async function writeFakeFormatter(scriptPath: string, logPath: string, exitCode = 0): Promise<void> {
	const script = `#!/bin/sh\npwd >> '${logPath}'\nprintf '%s\\n' "$@" >> '${logPath}'\nexit ${exitCode}\n`;
	await fs.writeFile(scriptPath, script, "utf8");
	await fs.chmod(scriptPath, 0o755);
}

async function readLogLines(logPath: string): Promise<string[]> {
	const content = await fs.readFile(logPath, "utf8");
	return content.split("\n").filter((line) => line.length > 0);
}

async function logExists(logPath: string): Promise<boolean> {
	try {
		await fs.stat(logPath);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("formatDeployedRoots", () => {
	let tmpDir: string;
	let deployRoot: string;
	let scriptPath: string;
	let logPath: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "format-on-deploy-test-"));
		deployRoot = path.join(tmpDir, "deploy");
		await fs.mkdir(deployRoot, { recursive: true });
		scriptPath = path.join(tmpDir, "fake-formatter.sh");
		logPath = path.join(tmpDir, "log.txt");
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("는 존재하는 플랫폼 dir·codex per-name 스킬·docsDests를 정확한 argv로 실행한다", async () => {
		await writeFakeFormatter(scriptPath, logPath, 0);
		await fs.mkdir(path.join(deployRoot, ".claude"), { recursive: true });
		await fs.mkdir(path.join(deployRoot, ".gemini"), { recursive: true });
		const skillDir = path.join(deployRoot, ".agents", "skills", "my-skill");
		await fs.mkdir(skillDir, { recursive: true });
		const docsDest = path.join(deployRoot, "docs", "leaf");
		await fs.mkdir(docsDest, { recursive: true });

		await formatDeployedRoots(deployRoot, scriptPath, [docsDest], new Set(["my-skill"]));

		const lines = await readLogLines(logPath);
		const loggedCwd = lines[0];
		const loggedArgs = lines.slice(1);

		expect(fs2.realpathSync(loggedCwd)).toBe(fs2.realpathSync(deployRoot));
		expect(loggedArgs).toEqual([
			path.join(deployRoot, ".claude"),
			path.join(deployRoot, ".gemini"),
			skillDir,
			docsDest,
		]);
	});

	it("는 존재하지 않는 플랫폼 dir을 argv에서 제외한다", async () => {
		await writeFakeFormatter(scriptPath, logPath, 0);
		await fs.mkdir(path.join(deployRoot, ".claude"), { recursive: true });
		// .opencode 미생성

		await formatDeployedRoots(deployRoot, scriptPath, [], new Set());

		const lines = await readLogLines(logPath);
		const loggedArgs = lines.slice(1);
		expect(loggedArgs).toEqual([path.join(deployRoot, ".claude")]);
		expect(loggedArgs).not.toContain(path.join(deployRoot, ".opencode"));
	});

	it("는 codexSkillNames에 없는 foreign resident 스킬 dir을 argv에서 제외한다", async () => {
		await writeFakeFormatter(scriptPath, logPath, 0);
		const ownedSkillDir = path.join(deployRoot, ".agents", "skills", "owned-skill");
		const foreignSkillDir = path.join(deployRoot, ".agents", "skills", "foreign-skill");
		await fs.mkdir(ownedSkillDir, { recursive: true });
		await fs.mkdir(foreignSkillDir, { recursive: true });

		await formatDeployedRoots(deployRoot, scriptPath, [], new Set(["owned-skill"]));

		const lines = await readLogLines(logPath);
		const loggedArgs = lines.slice(1);
		expect(loggedArgs).toEqual([ownedSkillDir]);
		expect(loggedArgs).not.toContain(foreignSkillDir);
	});

	it("는 formatCmd가 빈 문자열이면 spawn하지 않는다 (skip)", async () => {
		await fs.mkdir(path.join(deployRoot, ".claude"), { recursive: true });

		await formatDeployedRoots(deployRoot, "", [], new Set());

		expect(await logExists(logPath)).toBe(false);
	});

	it("는 formatCmd가 공백만이면 spawn하지 않는다 (skip)", async () => {
		await fs.mkdir(path.join(deployRoot, ".claude"), { recursive: true });

		await formatDeployedRoots(deployRoot, "   ", [], new Set());

		expect(await logExists(logPath)).toBe(false);
	});

	it("는 managedRoots가 비어 있으면 spawn하지 않는다 (skip)", async () => {
		await writeFakeFormatter(scriptPath, logPath, 0);
		// .claude/.gemini/.codex/.opencode 전부 미생성, codexSkillNames·docsDests도 빈값

		await formatDeployedRoots(deployRoot, scriptPath, [], new Set());

		expect(await logExists(logPath)).toBe(false);
	});

	it("는 포매터가 non-zero exit이면 throw한다 (loud-fail)", async () => {
		await writeFakeFormatter(scriptPath, logPath, 1);
		await fs.mkdir(path.join(deployRoot, ".claude"), { recursive: true });

		await expect(formatDeployedRoots(deployRoot, scriptPath, [], new Set())).rejects.toThrow();
	});

	it("는 존재하지 않는 커맨드면 throw한다 (loud-fail ENOENT)", async () => {
		await fs.mkdir(path.join(deployRoot, ".claude"), { recursive: true });

		await expect(
			formatDeployedRoots(deployRoot, "this-command-does-not-exist-xyz", [], new Set()),
		).rejects.toThrow();
	});
});
