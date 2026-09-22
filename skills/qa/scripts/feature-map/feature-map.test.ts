import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { runFeatureMapCli } from "./feature-map.ts";

const roots: string[] = [];
function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "feature-map-cli-"));
	roots.push(root);
	return root;
}
function repo(): string {
	const root = tempDir();
	execFileSync("git", ["init", "-q", root]);
	return root;
}
function json(result: { stdout: string }): Record<string, unknown> {
	return JSON.parse(result.stdout) as Record<string, unknown>;
}
function document(id: string, title = "Stock", changedBy = id): string {
	return `---\nschema_version: 1\nid: ${id}\ntitle: ${title}\nstate_changed_by:\n  - ${changedBy}\n---\n# ${title}\n`;
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("feature-map CLI", () => {
	test("도움말 변형은 파일 시스템을 조회하지 않고 출력한다", () => {
		for (const args of [[], ["help"], ["--help"], ["help", "query"], ["query", "--help"]]) {
			const result = runFeatureMapCli(args, { cwd: join(tempDir(), "missing"), home: join(tempDir(), "home") });
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout.length).toBeGreaterThan(0);
		}
	});

	test("전역 --help 뒤의 추가 인자는 usage 오류이며 manifest를 만들지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const result = runFeatureMapCli(["--help", "typo"], { cwd, home });
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("See: feature-map --help");
		expect(readdirSync(home)).toEqual([]);
	});

	test("알 수 없는 help 명령은 usage 오류다", () => {
		const result = runFeatureMapCli(["help", "unknown"], { cwd: join(tempDir(), "missing"), home: tempDir() });
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("Unknown feature-map command 'unknown'");
	});

	test("알 수 없는 명령과 잘못된 옵션은 API 호출 전에 usage 오류를 낸다", () => {
		const cwd = join(tempDir(), "missing");
		for (const args of [["wat"], ["query", "--bad"], ["get"], ["save", "--file", "x"], ["configure", "--location", "x", "extra"]]) {
			const result = runFeatureMapCli(args, { cwd, home: tempDir() });
			expect(result.exitCode).toBe(2);
			expect(result.stderr).toContain("feature-map");
		}
	});

	test("미설정 query는 manifest를 bootstrap하고 사용자 동의를 안내한다", () => {
		const cwd = repo();
		const home = tempDir();
		const result = runFeatureMapCli(["query"], { cwd, home });
		expect(result.exitCode).toBe(0);
		expect(json(result)).toMatchObject({ status: "not_found", reason: "storage_not_configured", next_action: "ask_user_for_storage" });
	});

	test("--project는 invocation cwd와 다른 프로젝트의 injected home manifest를 사용한다", () => {
		const invocation = repo();
		const project = repo();
		const home = tempDir();
		const configured = json(runFeatureMapCli(["configure", "--location", "features", "--project", project], { cwd: invocation, home }));
		expect(configured.status).toBe("ready");
		expect(String(configured.manifestPath)).toContain(home);
		expect(runFeatureMapCli(["query", "--project", project], { cwd: invocation, home }).exitCode).toBe(0);
		expect(existsSync(join(invocation, ".feature-maps"))).toBe(false);
	});

	test("configure부터 save/get/query/update/conflict/validate까지 흐름을 수행한다", () => {
		const cwd = repo();
		const home = tempDir();
		expect(runFeatureMapCli(["configure", "--location", "features"], { cwd, home }).exitCode).toBe(0);
		const input = join(cwd, "input.md");
		writeFileSync(input, document("stock.view"));
		const saved = runFeatureMapCli(["save", "--file", input, "--expect", "new"], { cwd, home });
		expect(saved.exitCode).toBe(0);
		const revision = String((json(saved).feature as Record<string, unknown>).revision);
		const got = runFeatureMapCli(["get", "stock.view"], { cwd, home });
		expect(json(got)).toMatchObject({ status: "ok", feature: { metadata: { id: "stock.view" }, body: "# Stock\n" } });
		const queried = runFeatureMapCli(["query", "--changed-by", "stock.view"], { cwd, home });
		expect((json(queried).features as unknown[]).length).toBe(1);
		writeFileSync(input, document("stock.view", "Updated"));
		const updated = runFeatureMapCli(["save", "--file", input, "--expect", revision], { cwd, home });
		expect(updated.exitCode).toBe(0);
		expect(runFeatureMapCli(["save", "--file", input, "--expect", revision], { cwd, home }).exitCode).toBe(1);
		expect(runFeatureMapCli(["validate"], { cwd, home }).exitCode).toBe(0);
	});

	test("save의 상대 file은 --project가 아닌 invocation cwd에서 읽는다", () => {
		const invocation = repo();
		const project = repo();
		const home = tempDir();
		runFeatureMapCli(["configure", "--location", "features", "--project", project], { cwd: invocation, home });
		writeFileSync(join(invocation, "input.md"), document("invocation.file"));
		const saved = runFeatureMapCli(["save", "--file", "input.md", "--expect", "new", "--project", project], { cwd: invocation, home });
		expect(saved.exitCode).toBe(0);
		expect(runFeatureMapCli(["get", "invocation.file", "--project", project], { cwd: invocation, home }).exitCode).toBe(0);
	});

	test("잘못된 revision은 API와 manifest에 접근하지 않는 usage 오류다", () => {
		const cwd = repo();
		const home = tempDir();
		const result = runFeatureMapCli(["save", "--file", "missing.md", "--expect", "nope"], { cwd, home });
		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(readdirSync(home)).toEqual([]);
	});

	test("missing file과 malformed document는 JSON error를 stderr에만 출력한다", () => {
		const cwd = repo();
		const home = tempDir();
		const missing = runFeatureMapCli(["save", "--file", "missing.md", "--expect", "new"], { cwd, home });
		expect(missing.exitCode).toBe(1);
		expect(missing.stdout).toBe("");
		expect(JSON.parse(missing.stderr)).toMatchObject({ status: "error" });
		const malformed = join(cwd, "malformed.md");
		writeFileSync(malformed, "not markdown");
		const invalid = runFeatureMapCli(["save", "--file", malformed, "--expect", "new"], { cwd, home });
		expect(invalid.exitCode).toBe(1);
		expect(invalid.stdout).toBe("");
		expect(JSON.parse(invalid.stderr)).toMatchObject({ status: "error" });
	});

	test("누락 feature와 미설정 storage를 구분하고 invalid 문서를 보고한다", () => {
		const cwd = repo();
		const home = tempDir();
		expect(json(runFeatureMapCli(["get", "missing"], { cwd, home }))).toMatchObject({ reason: "storage_not_configured" });
		const configured = json(runFeatureMapCli(["configure", "--location", "features"], { cwd, home }));
		expect(json(runFeatureMapCli(["get", "missing"], { cwd, home }))).toMatchObject({ status: "not_found", reason: "feature_not_found" });
		const bad = join(cwd, "bad.md");
		writeFileSync(bad, "---\nid: bad\n---\n");
		expect(runFeatureMapCli(["save", "--file", bad, "--expect", "new"], { cwd, home }).exitCode).toBe(1);
		const location = String((configured.storage as Record<string, unknown>).location);
		writeFileSync(join(location, "bad.md"), "---\nid: bad\n---\n");
		expect(runFeatureMapCli(["validate"], { cwd, home }).exitCode).toBe(1);
	});
});
