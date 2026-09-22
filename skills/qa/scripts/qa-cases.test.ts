import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQaCasesCli } from "./qa-cases.ts";

const roots: string[] = [];
function repo(): string { const root = realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-cli-"))); roots.push(root); const project = join(root, "repo"); mkdirSync(project); execFileSync("git", ["init", "-q", project]); return project; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("qa-cases CLI", () => {
	test("help and status return JSON-compatible operational output", () => { const cwd = repo(); const home = realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-home-"))); roots.push(home); expect(runQaCasesCli(["help"]).stdout).toContain("configure --location ABSOLUTE_PATH"); const status = runQaCasesCli(["status", "--project", cwd], { cwd, home }); expect(status.exitCode).toBe(0); expect(JSON.parse(status.stdout).status).toBe("unconfigured"); });
	test("configure는 project-local 저장을 거부하고 명시적 opt-in 후 save는 실행하지 않는다", () => {
		const cwd = repo(); const home = realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-home-"))); roots.push(home);
		const rejected = runQaCasesCli(["configure", "--location", join(cwd, "qa-cases"), "--project", cwd], { cwd, home });
		expect(rejected).toMatchObject({ exitCode: 1 }); expect(rejected.stderr).toContain("allow-project-storage");
		const location = join(realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-store-"))), "store");
		expect(runQaCasesCli(["configure", "--location", location, "--project", cwd], { cwd, home }).exitCode).toBe(0);
		const runner = join(cwd, "runner.sh"); const native = join(cwd, "native.json"); const input = join(cwd, "case.json");
		writeFileSync(runner, "sentinel-runner"); writeFileSync(native, "sentinel-native");
		writeFileSync(input, JSON.stringify({ id: "cli-case", title: "CLI case", goal: "metadata only", given: ["ready"], when: ["save"], then: ["stored"], acceptance_criteria: ["one"], surface: "bash", runner: [runner], execution_cwd: "project-root", native_files: [native], reset_description: "remove case" }));
		const saved = runQaCasesCli(["save", "--file", input, "--expect", "new", "--project", cwd], { cwd, home });
		expect(saved.exitCode).toBe(0); expect(readFileSync(runner, "utf8")).toBe("sentinel-runner"); expect(readFileSync(native, "utf8")).toBe("sentinel-native");
	});
});
