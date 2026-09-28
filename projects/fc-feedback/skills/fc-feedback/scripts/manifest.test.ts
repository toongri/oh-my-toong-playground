import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureFc, disableFc, getFcStatus, requireConfigured, resolveFcContext } from "./manifest.ts";

const roots: string[] = [];
function tempDir(): string {
	const root = mkdtempSync(join(tmpdir(), "fc-feedback-manifest-"));
	roots.push(root);
	return realpathSync(root);
}
function repo(name = "repo"): string {
	const root = join(tempDir(), name);
	mkdirSync(root);
	execFileSync("git", ["init", "-q", root]);
	return root;
}
function rosterFile(content = "members:\n  - id: hong\n    name: 홍길동\n"): string {
	const path = join(tempDir(), "roster.yaml");
	writeFileSync(path, content);
	return path;
}

// Snapshots the ambient value (normally unset) so tests that set
// FC_FEEDBACK_MANIFEST_ROOT never leak it into later tests or the real shell env,
// mirroring how fc.test.ts's run() isolates HOME per child process.
const ORIGINAL_MANIFEST_ROOT_ENV = process.env.FC_FEEDBACK_MANIFEST_ROOT;

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	if (ORIGINAL_MANIFEST_ROOT_ENV === undefined) delete process.env.FC_FEEDBACK_MANIFEST_ROOT;
	else process.env.FC_FEEDBACK_MANIFEST_ROOT = ORIGINAL_MANIFEST_ROOT_ENV;
});

describe("fc-feedback manifest", () => {
	test("없는 manifest는 unconfigured로 생성되고 다시 읽어도 유지된다", () => {
		const cwd = repo();
		const home = tempDir();
		const first = getFcStatus({ cwd, home });
		const second = getFcStatus({ cwd, home });
		expect(first.status).toBe("unconfigured");
		expect(second).toEqual(first);
		expect(readFileSync(resolveFcContext({ cwd, home }).manifestPath, "utf8")).toContain("mode: unconfigured");
	});

	test("configure는 절대경로 archive·roster와 유효한 pages_base_url로 성공한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const roster = rosterFile();
		const result = configureFc({ archive, roster, pagesUrl: "https://example.github.io/team/" }, { cwd, home });
		expect(result).toMatchObject({ status: "configured", archive_repo_path: archive, roster_path: roster, pages_base_url: "https://example.github.io/team/" });
		expect(getFcStatus({ cwd, home })).toEqual(result);
	});

	test("configure는 상대경로 archive_repo_path를 거부한다", () => {
		const cwd = repo();
		const home = tempDir();
		const roster = rosterFile();
		expect(() => configureFc({ archive: "relative/archive", roster, pagesUrl: "https://example.com/" }, { cwd, home })).toThrow(/absolute/);
	});

	test("configure는 git 저장소가 아닌 디렉터리를 archive_repo_path로 거부한다", () => {
		const cwd = repo();
		const home = tempDir();
		const notRepo = tempDir();
		const roster = rosterFile();
		expect(() => configureFc({ archive: notRepo, roster, pagesUrl: "https://example.com/" }, { cwd, home })).toThrow(/git repository/);
	});

	test("configure는 https가 아니거나 슬래시로 끝나지 않는 pages_base_url을 거부한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const roster = rosterFile();
		expect(() => configureFc({ archive, roster, pagesUrl: "http://example.com/" }, { cwd, home })).toThrow(/https/);
		expect(() => configureFc({ archive, roster, pagesUrl: "https://example.com" }, { cwd, home })).toThrow(/end with/);
	});

	test("configure는 존재하지 않거나 YAML로 파싱되지 않는 roster_path를 거부한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const missingRoster = join(tempDir(), "missing.yaml");
		expect(() => configureFc({ archive, roster: missingRoster, pagesUrl: "https://example.com/" }, { cwd, home })).toThrow(/does not exist/);
		const brokenRoster = rosterFile("members: [unterminated\n");
		expect(() => configureFc({ archive, roster: brokenRoster, pagesUrl: "https://example.com/" }, { cwd, home })).toThrow(/valid YAML/);
	});

	test("disable은 기존 archive·roster·pages_base_url 경로를 그대로 유지한다", () => {
		const cwd = repo();
		const home = tempDir();
		const archive = repo("archive");
		const roster = rosterFile();
		configureFc({ archive, roster, pagesUrl: "https://example.com/" }, { cwd, home });
		const disabled = disableFc({ cwd, home });
		expect(disabled).toMatchObject({ status: "disabled", archive_repo_path: archive, roster_path: roster, pages_base_url: "https://example.com/" });
		expect(getFcStatus({ cwd, home })).toEqual(disabled);
	});

	test("disable은 configure 이력이 없으면 경로 없이 disabled로만 남는다", () => {
		const cwd = repo();
		const home = tempDir();
		const disabled = disableFc({ cwd, home });
		expect(disabled).toEqual({ status: "disabled", mode: "disabled", project: disabled.project, manifestPath: disabled.manifestPath });
	});

	test("manifest의 project가 현재 context와 다르면 throw한다", () => {
		const cwd = repo();
		const home = tempDir();
		const context = resolveFcContext({ cwd, home });
		mkdirSync(join(home, ".fc-feedback", context.projectKey), { recursive: true });
		writeFileSync(context.manifestPath, "version: 1\nproject: wrong-project\nmode: unconfigured\n");
		expect(() => getFcStatus({ cwd, home })).toThrow(/project/);
	});

	test("malformed manifest는 자동 복구되지 않고 throw하며 원문을 보존한다", () => {
		const cwd = repo();
		const home = tempDir();
		const context = resolveFcContext({ cwd, home });
		mkdirSync(join(home, ".fc-feedback", context.projectKey), { recursive: true });
		const raw = `version: 1\nproject: ${context.projectKey}\nmode: configured\n`;
		writeFileSync(context.manifestPath, raw);
		expect(() => getFcStatus({ cwd, home })).toThrow(/requires archive_repo_path/);
		expect(readFileSync(context.manifestPath, "utf8")).toBe(raw);
	});

	test("requireConfigured는 configured가 아니면 throw하고 configured면 경로를 반환한다", () => {
		const cwd = repo();
		const home = tempDir();
		expect(() => requireConfigured({ cwd, home })).toThrow(/not configured/);
		const archive = repo("archive");
		const roster = rosterFile();
		configureFc({ archive, roster, pagesUrl: "https://example.com/" }, { cwd, home });
		expect(requireConfigured({ cwd, home })).toMatchObject({ status: "configured", archive_repo_path: archive, roster_path: roster });
	});

	test("FC_FEEDBACK_MANIFEST_ROOT을 설정하면 그 경로 아래에 쓰이고 HOME의 .fc-feedback에는 아무것도 생기지 않는다", () => {
		const cwd = repo();
		const home = tempDir();
		const manifestRoot = tempDir();
		process.env.FC_FEEDBACK_MANIFEST_ROOT = manifestRoot;
		const archive = repo("archive");
		const roster = rosterFile();
		const status = configureFc({ archive, roster, pagesUrl: "https://example.com/" }, { cwd, home });
		expect(status.manifestPath.startsWith(manifestRoot)).toBe(true);
		expect(status).toEqual(getFcStatus({ cwd, home }));
		expect(readFileSync(status.manifestPath, "utf8")).toContain("mode: configured");
		expect(existsSync(join(home, ".fc-feedback"))).toBe(false);
	});

	test("FC_FEEDBACK_MANIFEST_ROOT이 상대경로면 거부한다", () => {
		const cwd = repo();
		const home = tempDir();
		process.env.FC_FEEDBACK_MANIFEST_ROOT = "relative/manifest-root";
		expect(() => getFcStatus({ cwd, home })).toThrow(/absolute/);
	});

	test("FC_FEEDBACK_MANIFEST_ROOT이 없으면 기존처럼 <home>/.fc-feedback 아래에 저장된다", () => {
		delete process.env.FC_FEEDBACK_MANIFEST_ROOT;
		const cwd = repo();
		const home = tempDir();
		const status = getFcStatus({ cwd, home });
		expect(resolveFcContext({ cwd, home }).manifestPath.startsWith(join(home, ".fc-feedback"))).toBe(true);
		expect(status.status).toBe("unconfigured");
	});

	test("options.manifestRoot은 FC_FEEDBACK_MANIFEST_ROOT보다 우선한다", () => {
		const cwd = repo();
		const home = tempDir();
		const envRoot = tempDir();
		const optionRoot = tempDir();
		process.env.FC_FEEDBACK_MANIFEST_ROOT = envRoot;
		const context = resolveFcContext({ cwd, home, manifestRoot: optionRoot });
		expect(context.manifestPath.startsWith(optionRoot)).toBe(true);
		expect(context.manifestPath.startsWith(envRoot)).toBe(false);
	});
});
