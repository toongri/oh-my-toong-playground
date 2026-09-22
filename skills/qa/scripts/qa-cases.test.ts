import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQaCasesCli } from "./qa-cases.ts";

const roots: string[] = [];
function repo(): string { const root = mkdtempSync(join(tmpdir(), "qa-cases-cli-")); roots.push(root); const project = join(root, "repo"); mkdirSync(project); execFileSync("git", ["init", "-q", project]); return project; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("qa-cases CLI", () => {
	test("help and status return JSON-compatible operational output", () => { const cwd = repo(); const home = mkdtempSync(join(tmpdir(), "qa-cases-home-")); roots.push(home); expect(runQaCasesCli(["help"]).stdout).toContain("configure --location ABSOLUTE_PATH"); const status = runQaCasesCli(["status", "--project", cwd], { cwd, home }); expect(status.exitCode).toBe(0); expect(JSON.parse(status.stdout).status).toBe("unconfigured"); });
	test("configure requires explicit project-storage opt-in and save accepts JSON metadata only", () => { const cwd = repo(); const home = mkdtempSync(join(tmpdir(), "qa-cases-home-")); roots.push(home); const location = join(mkdtempSync(join(tmpdir(), "qa-cases-store-")), "store"); const configured = runQaCasesCli(["configure", "--location", location, "--project", cwd], { cwd, home }); expect(configured.exitCode).toBe(0); });
});
