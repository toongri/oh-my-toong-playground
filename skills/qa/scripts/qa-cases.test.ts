import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveFeature } from "@lib/feature-map/storage.ts";
import { runQaCasesCli } from "./qa-cases.ts";

const roots: string[] = [];
function repo(): string { const root = realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-cli-"))); roots.push(root); const project = join(root, "repo"); mkdirSync(project); execFileSync("git", ["init", "-q", project]); return project; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function seedFeatures(cwd: string, home: string, ids: string[]): void { for (const id of ids) saveFeature({ metadata: { schema_version: 1, id, title: id }, body: "기능", expectedRevision: null }, { cwd, home }); }
describe("qa-cases CLI", () => {
	test("help and status return JSON-compatible operational output", () => { const cwd = repo(); const home = realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-home-"))); roots.push(home); expect(runQaCasesCli(["help"]).stdout).toContain("configure --location ABSOLUTE_PATH"); const status = runQaCasesCli(["status", "--project", cwd], { cwd, home }); expect(status.exitCode).toBe(0); expect(JSON.parse(status.stdout).status).toBe("configured"); });
	test("configure는 project-local 저장을 거부하고 명시적 opt-in 후 save는 실행하지 않는다", () => {
		const cwd = repo(); const home = realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-home-"))); roots.push(home);
		const rejected = runQaCasesCli(["configure", "--location", join(cwd, "qa-cases"), "--project", cwd], { cwd, home });
		expect(rejected).toMatchObject({ exitCode: 1 }); expect(rejected.stderr).toContain("allow-project-storage");
		const location = join(realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-store-"))), "store");
		expect(runQaCasesCli(["configure", "--location", location, "--project", cwd], { cwd, home }).exitCode).toBe(0);
		const runner = join(cwd, "runner.sh"); const native = join(cwd, "native.json"); const input = join(cwd, "case.json");
		writeFileSync(runner, "sentinel-runner"); writeFileSync(native, "sentinel-native"); seedFeatures(cwd, home, ["checkout"]);
		writeFileSync(input, JSON.stringify({ id: "cli-case", title: "CLI case", goal: "metadata only", given: ["ready"], when: ["save"], then: ["stored"], feature_refs: ["checkout"], surface: "bash", runner: ["./runner.sh"], execution_cwd: "project-root", native_files: ["native.json"], reset_description: "remove case" }));
		const saved = runQaCasesCli(["save", "--file", input, "--expect", "new", "--project", cwd], { cwd, home });
		expect(saved.exitCode).toBe(0); expect(readFileSync(runner, "utf8")).toBe("sentinel-runner"); expect(readFileSync(native, "utf8")).toBe("sentinel-native");
	});
	test("list --feature는 feature_refs가 일치하는 case만 돌려주고 help에 안내가 있다", () => {
		const cwd = repo(); const home = realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-home-"))); roots.push(home);
		const help = runQaCasesCli(["help"]).stdout;
		expect(help).toContain("list [--feature ID] [--project DIR]");
		expect(help).not.toContain("acceptance criteria");
		seedFeatures(cwd, home, ["checkout", "profile"]);
		for (const [id, refs] of [["case-a", ["checkout"]], ["case-b", ["profile"]]] as const) {
			const input = join(cwd, `${id}.json`);
			writeFileSync(input, JSON.stringify({ id, title: id, goal: "g", given: ["g"], when: ["w"], then: ["t"], feature_refs: refs, surface: "bash", runner: ["true"], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset" }));
			expect(runQaCasesCli(["save", "--file", input, "--expect", "new", "--project", cwd], { cwd, home }).exitCode).toBe(0);
		}
		const filtered = JSON.parse(runQaCasesCli(["list", "--feature", "profile", "--project", cwd], { cwd, home }).stdout);
		expect(filtered.cases.map((entry: { id: string }) => entry.id)).toEqual(["case-b"]);
		expect(filtered.cases[0].feature_refs).toEqual(["profile"]);
		expect(JSON.parse(runQaCasesCli(["list", "--project", cwd], { cwd, home }).stdout).cases).toHaveLength(2);
	});
	test("save는 feature map에 없는 feature_refs를 거부하고 저장하지 않는다", () => {
		const cwd = repo(); const home = realpathSync(mkdtempSync(join(tmpdir(), "qa-cases-home-"))); roots.push(home);
		seedFeatures(cwd, home, ["checkout"]);
		const input = join(cwd, "case.json");
		writeFileSync(input, JSON.stringify({ id: "orphan", title: "orphan", goal: "g", given: ["g"], when: ["w"], then: ["t"], feature_refs: ["checkout", "unmapped"], surface: "bash", runner: ["true"], execution_cwd: "{artifacts}", native_files: [], reset_description: "reset" }));
		const result = runQaCasesCli(["save", "--file", input, "--expect", "new", "--project", cwd], { cwd, home });
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({ status: "not_found", reason: "feature_not_in_map", feature: "unmapped" });
		expect(JSON.parse(runQaCasesCli(["list", "--project", cwd], { cwd, home }).stdout).cases).toHaveLength(0);
	});
});
