#!/usr/bin/env bun

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawnSync } from "child_process";

import {
	run,
	classifyPath,
	globMatch,
	noteCitesPage,
	parseRuleFrontmatter,
	DYNAMIC_RESERVE,
	TOOL_OUTPUT_CEILING,
	type Plan,
} from "./diff-cursor.ts";

const SCRIPT = path.join(import.meta.dirname, "diff-cursor.ts");
const PAGE_BYTES = 4096;

// ---------------------------------------------------------------------------
// Fixture: a temp git repo with two commits
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
	return execFileSync(
		"git",
		[
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@example.com",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"core.hooksPath=/dev/null",
			...args,
		],
		{
			cwd,
			encoding: "utf8",
			env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
		},
	);
}

function write(root: string, rel: string, content: string): void {
	fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
	fs.writeFileSync(path.join(root, rel), content);
}

interface Fixture {
	tmp: string;
	repo: string;
	range: string;
	files: string[];
}

function makeFixture(): Fixture {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diff-cursor-test-"));
	const repo = path.join(tmp, "repo");
	fs.mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	write(repo, "CLAUDE.md", "# root\n- rule one\n- rule two\n");
	write(repo, "src/CLAUDE.md", "# src\n- use camelCase\n");
	fs.symlinkSync("CLAUDE.md", path.join(repo, "src/AGENTS.md"));
	write(repo, "lib/CLAUDE.md", "# lib only\n");
	write(repo, ".claude/rules/ts.md", '---\npaths: ["src/**/*.ts"]\n---\n# ts\n- no any\n');
	write(repo, ".claude/rules/py.md", '---\npaths:\n  - "**/*.py"\n---\n# py\n');
	write(repo, ".claude/rules/docs.md", "---\npaths: docs/**\n---\n# docs\n- 한국어로 쓴다\n");
	write(repo, ".claude/rules/general.md", "# general\n- small diffs\n");
	fs.mkdirSync(path.join(repo, ".codex/rules"), { recursive: true });
	fs.symlinkSync("../../.claude/rules/ts.md", path.join(repo, ".codex/rules/ts-link.md"));
	write(
		repo,
		"src/app.ts",
		Array.from({ length: 100 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
	);
	write(repo, "docs/guide.md", "# 안내\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "base");
	const base = git(repo, "rev-parse", "HEAD").trim();

	const appLines = Array.from(
		{ length: 400 },
		(_, i) =>
			`export function computeTotal${i}(input: number): number { return input + ${i}; } // 합계를 계산한다 ${i}\n`,
	);
	write(repo, "src/app.ts", appLines.join(""));
	write(
		repo,
		"docs/guide.md",
		"# 안내\n" +
			Array.from(
				{ length: 60 },
				(_, i) => `이 문서는 리뷰 커서의 페이지 예산을 설명하는 ${i}번째 문단입니다.\n`,
			).join(""),
	);
	write(
		repo,
		"src/app.test.ts",
		'import { computeTotal1 } from "./app";\ntest("합계", () => expect(computeTotal1(1)).toBe(2));\n',
	);
	write(repo, "db/migrations/V2__add.sql", "ALTER TABLE users ADD COLUMN nick_name TEXT;\n");
	write(
		repo,
		"config/big.json",
		JSON.stringify(
			Object.fromEntries(
				Array.from({ length: 400 }, (_, i) => [`item_${String(i).padStart(4, "0")}`, `값 ${i}`]),
			),
		) + "\n",
	);
	write(repo, "src/설정.ts", "export const 설정값 = { retryCount: 3 };\n");
	write(repo, "schema/user.graphql", "type User { id: ID! nickName: String }\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "head");
	const head = git(repo, "rev-parse", "HEAD").trim();
	const files = git(repo, "-c", "core.quotePath=false", "diff", "--name-only", `${base}...${head}`)
		.trim()
		.split("\n");
	return { tmp, repo, range: `${base}...${head}`, files };
}

let fx: Fixture;
let planDir: string;
let plan: Plan;
let ledgerSeq = 0;

beforeAll(() => {
	fx = makeFixture();
	planDir = path.join(fx.tmp, "plan");
	const r = run([
		"plan",
		"--repo",
		fx.repo,
		"--range",
		fx.range,
		"--files",
		JSON.stringify(fx.files),
		"--out",
		planDir,
		"--page-bytes",
		String(PAGE_BYTES),
	]);
	if (r.code !== 0) throw new Error(r.stderr);
	plan = JSON.parse(fs.readFileSync(path.join(planDir, "plan.json"), "utf8")) as Plan;
});

afterAll(() => {
	fs.rmSync(fx.tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Ledger helpers
// ---------------------------------------------------------------------------

function newLedger(angle: string): string {
	const dir = path.join(fx.tmp, "ledgers", `${angle}-${++ledgerSeq}`);
	const r = run(["init", "--plan", planDir, "--angle", angle, "--ledger", dir]);
	expect(r.code).toBe(0);
	return dir;
}

const cli = (ledger: string, ...args: string[]) => run([...args, "--ledger", ledger]);
const ackOf = (out: string) => /### ACK (\S+): ([0-9a-f]{8}) ###/.exec(out)?.[2] ?? "";
const pageIdOf = (out: string) => /\[PAGE (\S+) ·/.exec(out)?.[1] ?? "";
const kindOf = (out: string) => /^PAGE \S+ {2}kind=(\w+)$/m.exec(out)?.[1] ?? "";

/** A citation of the page: a new-file line number, or the file name when the page has none. */
function citeOf(out: string): string {
	const line = /^ {0,5}(\d+) \|/m.exec(out)?.[1];
	if (line !== undefined) return `L${line}`;
	return /^FILES ON THIS PAGE:\n {2}(\S+)/m.exec(out)?.[1] ?? "";
}

/** A note that cites the page (a scripted finder that holds every page). */
const noteFor = (out: string) => `${citeOf(out)} 확인함`;

/** Acknowledges pages until the current page has the wanted kind. */
function advanceTo(ledger: string, kinds: readonly string[]): string {
	let cur = cli(ledger, "next").stdout;
	while (!kinds.includes(kindOf(cur))) {
		const r = cli(ledger, "done", pageIdOf(cur), "--ack", ackOf(cur), "--note", noteFor(cur), "--next");
		if (r.code !== 0) throw new Error(r.stderr);
		cur = r.stdout;
	}
	return cur;
}

/** Walks the ledger with `done --next` until `leave` pages remain; returns every page output seen. */
function walk(ledger: string, leave = 0): string[] {
	const seen: string[] = [];
	let out = cli(ledger, "next").stdout;
	for (;;) {
		if (out.includes("ALL PAGES DONE")) return seen;
		const status = JSON.parse(cli(ledger, "status", "--json").stdout) as {
			pagesTotal: number;
			pagesAcked: number;
		};
		if (status.pagesTotal - status.pagesAcked <= leave) return seen;
		seen.push(out);
		expect(Buffer.byteLength(out)).toBeLessThanOrEqual(PAGE_BYTES);
		const r = cli(
			ledger,
			"done",
			pageIdOf(out),
			"--ack",
			ackOf(out),
			"--note",
			noteFor(out),
			"--next",
		);
		if (r.code !== 0) throw new Error(r.stderr);
		out = r.stdout;
	}
}

function pageTexts(): string[] {
	return plan.pages.map((p) => fs.readFileSync(path.join(planDir, "pages", `${p.id}.txt`), "utf8"));
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

describe("`plan` 페이지 구성", () => {
	test("모든 페이지가 헤더 포함 바이트 예산 이하이고 한글은 바이트로 센다", () => {
		const texts = pageTexts();
		expect(texts.length).toBeGreaterThan(5);
		for (const t of texts)
			expect(Buffer.byteLength(t)).toBeLessThanOrEqual(PAGE_BYTES - DYNAMIC_RESERVE);
		const korean = texts.find((t) => t.includes("문단입니다"));
		expect(korean).toBeDefined();
		expect(Buffer.byteLength(korean as string)).toBeGreaterThan((korean as string).length);
		expect(plan.stats.maxPageBytes).toBe(Math.max(...texts.map((t) => Buffer.byteLength(t))));
	});

	test("예산보다 큰 hunk와 한 줄은 여러 페이지로 나뉘고 diff 줄은 빠짐없이 순서대로 실린다", () => {
		const texts = pageTexts();
		const appPages = texts.filter((t) => t.includes("=== FILE src/app.ts"));
		expect(appPages.length).toBeGreaterThan(1);
		expect(appPages.some((t) => /^@@ .* \(continued\)$/m.test(t))).toBe(true);
		expect(texts.some((t) => t.includes("(partial)"))).toBe(true);
		expect(texts.filter((t) => t.includes("=== FILE config/big.json")).length).toBeGreaterThan(1);
		expect(texts.some((t) => t.includes("  cont |"))).toBe(true);

		const rebuilt: string[] = [];
		for (const t of texts) {
			const lines = t.split("\n");
			const body = lines.slice(
				lines.findIndex((l) => l.startsWith("--- BEGIN ")) + 1,
				lines.findIndex((l) => l.startsWith("--- END ")),
			);
			for (const l of body) {
				if (
					l.startsWith("=== FILE ") ||
					l.startsWith("### ACK ") ||
					(l.startsWith("@@ ") && l.endsWith(" (continued)"))
				)
					continue;
				if (l.startsWith("  cont |")) rebuilt[rebuilt.length - 1] += l.slice("  cont |".length);
				else {
					const m = /^( {0,5}\d+| {6}) \|(.*)$/.exec(l);
					rebuilt.push(m ? (m[2] as string) : l);
				}
			}
		}
		const patch = fs.readFileSync(path.join(planDir, "diff.patch"), "utf8").split("\n");
		patch.pop();
		expect(rebuilt).toEqual(patch);
	});

	test("페이지 종류는 경로로 분류하고 페이지마다 하나의 kind를 가진다", () => {
		expect(classifyPath("src/app.ts")).toBe("production");
		expect(classifyPath("src/app.test.ts")).toBe("test");
		expect(classifyPath("apps/api/src/test/kotlin/FooServiceTest.kt")).toBe("test");
		expect(classifyPath("db/migrations/V2__add.sql")).toBe("migration");
		expect(classifyPath("schema/user.graphql")).toBe("schema");
		expect(classifyPath("apps/backend/src/lib/database/schema/health.ts")).toBe("schema");
		expect(classifyPath("config/big.json")).toBe("config");
		expect(classifyPath("build.gradle.kts")).toBe("config");
		expect(classifyPath("docs/guide.md")).toBe("doc");
		expect(classifyPath("CLAUDE.md")).toBe("doc");
		const kinds = new Set(plan.pages.map((p) => p.kind));
		for (const k of ["production", "config", "doc"])
			expect(kinds.has(k as Plan["pages"][number]["kind"])).toBe(true);
		expect(plan.fileKinds.find((f) => f.path === "src/설정.ts")?.kind).toBe("production");
	});

	test("같은 입력의 plan은 no-op이고 다른 range나 파일 목록은 거부한다", () => {
		const base = ["--repo", fx.repo, "--out", planDir, "--page-bytes", String(PAGE_BYTES)];
		const again = run([
			"plan",
			...base,
			"--range",
			fx.range,
			"--files",
			JSON.stringify([...fx.files].reverse()),
		]);
		expect(again.code).toBe(0);
		expect(JSON.parse(again.stdout)).toMatchObject({ created: false, planSha: plan.planSha });

		const otherRange = run([
			"plan",
			...base,
			"--range",
			fx.range.replace("...", ".."),
			"--files",
			JSON.stringify(fx.files),
		]);
		expect(otherRange.code).toBe(1);
		expect(otherRange.stderr).toContain("plan conflict");

		const otherFiles = run([
			"plan",
			...base,
			"--range",
			fx.range,
			"--files",
			JSON.stringify(fx.files.slice(1)),
		]);
		expect(otherFiles.code).toBe(1);
		expect(otherFiles.stderr).toContain("plan conflict");

		expect(
			run(["plan", ...base, "--range", "--output=x", "--files", JSON.stringify(fx.files)]).code,
		).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// applicable guidelines and rules
// ---------------------------------------------------------------------------

describe("적용 지침·규칙 계산", () => {
	test("경로상의 CLAUDE.md·AGENTS.md, paths가 맞는 규칙, paths 없는 규칙만 고르고 symlink는 한 번만 센다", () => {
		const byPath = new Map(plan.applicable.map((a) => [a.path, a]));
		expect([...byPath.keys()].sort()).toEqual([
			".claude/rules/docs.md",
			".claude/rules/general.md",
			".claude/rules/ts.md",
			"CLAUDE.md",
			"src/CLAUDE.md",
		]);
		expect(byPath.get("src/CLAUDE.md")?.aliases).toEqual(["src/AGENTS.md"]);
		expect(byPath.get(".claude/rules/ts.md")?.aliases).toEqual([".codex/rules/ts-link.md"]);
		expect(byPath.get(".claude/rules/general.md")?.reason).toContain("no paths");
		expect(byPath.get(".claude/rules/ts.md")?.reason).toContain("src/**/*.ts");
		expect(byPath.get("CLAUDE.md")?.reason).toContain("repo-root");
		expect(byPath.get("CLAUDE.md")?.lines).toBe(3);
	});

	test("`globMatch`와 frontmatter 파서가 인라인 배열·블록 목록·스칼라·중괄호·점 경로를 처리한다", () => {
		expect(globMatch("src/**/*.ts", "src/a/b.ts")).toBe(true);
		expect(globMatch("src/**/*.ts", "src/b.ts")).toBe(true);
		expect(globMatch("src/**/*.ts", "src/.hidden/b.ts")).toBe(true);
		expect(globMatch("src/*.{ts,tsx}", "src/a.tsx")).toBe(true);
		expect(globMatch("src/*.ts", "src/a/b.ts")).toBe(false);
		expect(globMatch("apps/", "apps/x/y.kt")).toBe(true);
		expect(parseRuleFrontmatter("---\npaths: [\"a/**\", 'b/*.{ts,js}']\n---\n").patterns).toEqual([
			"a/**",
			"b/*.{ts,js}",
		]);
		expect(parseRuleFrontmatter('---\npaths:\n  - "x/**"\n  - y.md\n---\n').patterns).toEqual([
			"x/**",
			"y.md",
		]);
		expect(parseRuleFrontmatter("---\nglobs: a/**, b/**\nalwaysApply: true\n---\n")).toEqual({
			patterns: ["a/**", "b/**"],
			alwaysApply: true,
		});
		expect(parseRuleFrontmatter("# no frontmatter\n").patterns).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// ledger
// ---------------------------------------------------------------------------

describe("ledger 진행 규칙", () => {
	test("ack 없이, 틀린 ack로, 가운데가 잘린 페이지로는 done이 거부된다", () => {
		const ledger = newLedger("correctness");
		const out = cli(ledger, "next").stdout;
		const id = pageIdOf(out);
		const ack = ackOf(out);
		expect(ack).toMatch(/^[0-9a-f]{8}$/);
		expect(Buffer.byteLength(out)).toBeGreaterThan(3000);

		// A tool output cut in the middle keeps head and tail; drop the middle 20%.
		const buf = Buffer.from(out);
		const cut = Buffer.concat([
			buf.subarray(0, Math.floor(buf.length * 0.4)),
			Buffer.from("\n…truncated…\n"),
			buf.subarray(Math.ceil(buf.length * 0.6)),
		]).toString("utf8");
		expect(ackOf(cut)).toBe("");
		expect(cut.includes(ack)).toBe(false);

		const note = noteFor(out);
		expect(cli(ledger, "done", id, "--note", note).code).toBe(1);
		const wrong = cli(ledger, "done", id, "--ack", "00000000", "--note", note);
		expect(wrong.code).toBe(1);
		expect(wrong.stderr).toContain("ack mismatch");
		expect(cli(ledger, "done", id, "--ack", ack, "--note", note).code).toBe(0);
	});

	test("발급 전 페이지와 순서를 건너뛴 done을 거부하고 같은 ack 재실행은 no-op이다", () => {
		const ledger = newLedger("regression");
		const out = cli(ledger, "next").stdout;
		const [first, second] = [plan.pages[0]?.id as string, plan.pages[1]?.id as string];
		expect(pageIdOf(out)).toBe(first);
		expect(cli(ledger, "next").stdout).toBe(out);

		const skip = cli(ledger, "done", second, "--ack", plan.pages[1]?.ack as string, "--note", "L1");
		expect(skip.code).toBe(1);
		expect(skip.stderr).toContain("out of order");
		expect(cli(ledger, "view", second).code).toBe(1);
		expect(cli(ledger, "done", "p9999", "--ack", "x", "--note", "y").code).toBe(1);

		expect(cli(ledger, "done", first, "--ack", ackOf(out), "--note", noteFor(out)).code).toBe(0);
		const again = cli(ledger, "done", first, "--ack", ackOf(out), "--note", "다른 메모");
		expect(again.code).toBe(0);
		expect(again.stdout).toContain("ALREADY DONE");
		expect(cli(ledger, "done", first, "--ack", "ffffffff", "--note", "x").code).toBe(1);
		expect(cli(ledger, "view", first).stdout).toContain(`### ACK ${first}: ${ackOf(out)} ###`);
	});

	test("production·config 페이지 메모는 페이지의 줄 번호나 식별자를 인용해야 하고 문서 페이지는 짧은 메모로 충분하다", () => {
		const ledger = newLedger("requirement");
		const out = cli(ledger, "next").stdout;
		expect(["production", "config", "schema", "migration"]).toContain(kindOf(out));
		const id = pageIdOf(out);
		const vague = cli(
			ledger,
			"done",
			id,
			"--ack",
			ackOf(out),
			"--note",
			"전반적으로 확인함",
		);
		expect(vague.code).toBe(1);
		expect(vague.stderr).toContain("must cite");
		expect(cli(ledger, "done", id, "--ack", ackOf(out), "--note", "   ").code).toBe(1);

		let cur = cli(ledger, "done", id, "--ack", ackOf(out), "--note", noteFor(out), "--next").stdout;
		while (kindOf(cur) !== "doc")
			cur = cli(
				ledger,
				"done",
				pageIdOf(cur),
				"--ack",
				ackOf(cur),
				"--note",
				noteFor(cur),
				"--next",
			).stdout;
		expect(
			cli(
				ledger,
				"done",
				pageIdOf(cur),
				"--ack",
				ackOf(cur),
				"--note",
				"관련 메커니즘 없음: 안내 문서",
			).code,
		).toBe(0);

		const appPage = pageTexts().find((t) => t.includes("computeTotal1(input")) as string;
		const lineNo = /^ {0,5}(\d+) \|/m.exec(appPage)?.[1] as string;
		expect(noteCitesPage(`L${lineNo}에서 경계값 확인`, appPage)).toBe(true);
		expect(noteCitesPage(`src/app.ts:${lineNo} 확인`, appPage)).toBe(true);
		expect(noteCitesPage("`input + 1` 계산 확인", appPage)).toBe(true);
		expect(noteCitesPage("computeTotal1 반환값 확인", appPage)).toBe(true);
		expect(noteCitesPage("L99999 확인, 코드 읽음", appPage)).toBe(false);
		expect(noteCitesPage("export function 확인", appPage)).toBe(false);
	});

	test("99%에서는 finish와 verify가 거부되고 100%에서 통과한다", () => {
		const full = newLedger("correctness");
		const partial = newLedger("regression");
		walk(full);
		walk(partial, 1);

		const early = cli(partial, "finish");
		expect(early.code).toBe(1);
		expect(early.stderr).toContain(`1 of ${plan.pages.length} page(s) not done`);
		expect(cli(full, "finish").code).toBe(0);

		const v1 = run(["verify", "--plan", planDir, "--ledgers", full, partial]);
		expect(v1.code).toBe(1);
		expect(JSON.parse(v1.stdout).ledgers.map((l: { ok: boolean }) => l.ok)).toEqual([true, false]);

		walk(partial);
		expect(run(["verify", "--plan", planDir, "--ledgers", full, "--ledgers", partial]).code).toBe(
			1,
		);
		expect(cli(partial, "finish").code).toBe(0);
		const v2 = run(["verify", "--plan", planDir, "--ledgers", full, partial]);
		expect(v2.code).toBe(0);
		expect(JSON.parse(v2.stdout)).toMatchObject({ ok: true, pages: plan.pages.length });
	});

	test("resplit은 끝나지 않은 페이지를 더 작은 하위 페이지로 다시 자르고 순서와 id를 유지한다", () => {
		const ledger = newLedger("correctness");
		const out = cli(ledger, "next").stdout;
		const id = pageIdOf(out);
		expect(cli(ledger, "resplit", id, "--page-bytes", String(PAGE_BYTES)).code).toBe(1);
		const r = cli(ledger, "resplit", id, "--page-bytes", "2048");
		expect(r.code).toBe(0);
		expect(r.stdout).toContain(`${id}.1`);
		const refused = cli(ledger, "done", id, "--ack", ackOf(out), "--note", noteFor(out));
		expect(refused.code).toBe(1);
		expect(refused.stderr).toContain("re-split");

		const seen = walk(ledger);
		const subIds = seen.map(pageIdOf).filter((p) => p.startsWith(`${id}.`));
		expect(subIds.length).toBeGreaterThan(1);
		expect(subIds).toEqual(subIds.map((_, i) => `${id}.${i + 1}`));
		expect(pageIdOf(seen[0] as string)).toBe(`${id}.1`);
		for (const s of seen.filter((o) => pageIdOf(o).startsWith(`${id}.`)))
			expect(Buffer.byteLength(s)).toBeLessThanOrEqual(2048);
		const status = JSON.parse(cli(ledger, "status", "--json").stdout);
		expect(status.pagesTotal).toBe(plan.pages.length - 1 + subIds.length);
		expect(cli(ledger, "finish").code).toBe(0);
		expect(cli(ledger, "resplit", plan.pages[1]?.id as string, "--page-bytes", "2048").code).toBe(
			1,
		);
	});

	test("resume 한 번으로 각도·진행·다음 페이지·최근 메모·후보·체크리스트·적용 파일을 보여준다", () => {
		const ledger = newLedger("correctness");
		let out = cli(ledger, "next").stdout;
		for (let i = 0; i < 2; i++)
			out = cli(
				ledger,
				"done",
				pageIdOf(out),
				"--ack",
				ackOf(out),
				"--note",
				`${noteFor(out)} 메모${i}`,
				"--next",
			).stdout;
		expect(
			cli(
				ledger,
				"candidate",
				"add",
				"--page",
				plan.pages[0]?.id as string,
				"--file",
				"src/app.ts",
				"--line",
				"3",
				"--summary",
				"경계값 누락",
				"--failure-scenario",
				"음수 입력에서 합계가 틀린다",
			).code,
		).toBe(0);
		const r = cli(ledger, "resume");
		expect(r.code).toBe(0);
		for (const needle of [
			"RESUME angle=correctness",
			`PROGRESS: done 2/${plan.pages.length}`,
			`NEXT PAGE: ${plan.pages[2]?.id} (issued, not done)`,
			"메모1",
			"CANDIDATES: 1",
			"c001 src/app.ts:3 경계값 누락",
			"CHECKLIST: 0 item(s)",
			"src/CLAUDE.md (= src/AGENTS.md)",
			".claude/rules/ts.md",
			"NEXT STEP: run next",
		])
			expect(r.stdout).toContain(needle);
		expect(Buffer.byteLength(r.stdout)).toBeLessThan(TOOL_OUTPUT_CEILING);
	});

	test("candidate add는 목록 밖 파일과 발급 전 페이지를 거부하고 같은 후보는 한 번만 저장한다", () => {
		const ledger = newLedger("regression");
		cli(ledger, "next");
		const add = (...extra: string[]) =>
			cli(
				ledger,
				"candidate",
				"add",
				"--page",
				plan.pages[0]?.id as string,
				"--file",
				"src/app.ts",
				"--line",
				"5",
				"--summary",
				"s",
				"--failure-scenario",
				"f",
				...extra,
			);
		expect(add().stdout).toContain("c001 recorded");
		expect(add().stdout).toContain("c001 already recorded");
		expect(
			cli(
				ledger,
				"candidate",
				"add",
				"--page",
				plan.pages[0]?.id as string,
				"--file",
				"lib/CLAUDE.md",
				"--line",
				"1",
				"--summary",
				"s",
				"--failure-scenario",
				"f",
			).code,
		).toBe(1);
		expect(
			cli(
				ledger,
				"candidate",
				"add",
				"--page",
				plan.pages[3]?.id as string,
				"--file",
				"src/app.ts",
				"--line",
				"1",
				"--summary",
				"s",
				"--failure-scenario",
				"f",
			).code,
		).toBe(1);
		const exported = JSON.parse(cli(ledger, "export").stdout);
		expect(exported.candidates).toHaveLength(1);
		expect(exported.candidates[0]).toMatchObject({
			id: "c001",
			found_by: "regression",
			failure_scenario: "f",
		});
		expect(exported.coverage).toMatchObject({
			pagesTotal: plan.pages.length,
			pagesDelivered: 1,
			pagesAcked: 0,
			candidates: 1,
		});
	});

	test("cleanup finish는 적용 파일마다 체크리스트 항목, 모든 항목의 최종 판정, 위반 항목의 후보를 요구한다", () => {
		const ledger = newLedger("cleanup");
		walk(ledger);
		const noItems = cli(ledger, "finish");
		expect(noItems.code).toBe(1);
		expect(noItems.stderr).toContain("without a checklist item");

		expect(cli(ledger, "checklist", "add", "--source", "lib/CLAUDE.md:1", "--rule", "x").code).toBe(
			1,
		);
		expect(cli(ledger, "checklist", "add", "--source", "CLAUDE.md:99", "--rule", "x").code).toBe(1);
		expect(
			cli(
				ledger,
				"checklist",
				"add",
				"--source",
				"CLAUDE.md:2",
				"--rule",
				"x",
				"--verdict",
				"확인 불가",
			).code,
		).toBe(1);

		for (const a of plan.applicable) {
			const r = cli(
				ledger,
				"checklist",
				"add",
				"--source",
				`${a.aliases[0] ?? a.path}:1`,
				"--rule",
				`${a.path} 첫 항목`,
				"--verdict",
				"준수",
				"--evidence",
				"src/app.ts:3",
			);
			expect(r.code).toBe(0);
		}
		expect(
			cli(
				ledger,
				"checklist",
				"add",
				"--source",
				"CLAUDE.md:2",
				"--rule",
				"rule one",
				"--evidence",
				"확인 중",
			).stdout,
		).toContain("r006");
		const open = cli(ledger, "finish");
		expect(open.code).toBe(1);
		expect(open.stderr).toContain("without a final verdict: r006");

		expect(
			cli(
				ledger,
				"checklist",
				"update",
				"r006",
				"--verdict",
				"위반",
				"--evidence",
				"src/app.ts:4 위반",
			).code,
		).toBe(0);
		const unfiled = cli(ledger, "finish");
		expect(unfiled.code).toBe(1);
		expect(unfiled.stderr).toContain("위반 item(s) without a candidate");

		expect(
			cli(
				ledger,
				"candidate",
				"add",
				"--page",
				plan.pages[0]?.id as string,
				"--file",
				"src/app.ts",
				"--line",
				"4",
				"--summary",
				"rule one 위반",
				"--failure-scenario",
				"규칙과 다르다",
				"--rule",
				"r006",
			).code,
		).toBe(0);
		expect(cli(ledger, "finish").code).toBe(0);
		const list = cli(ledger, "checklist", "list").stdout;
		expect(list).toContain("위반 1");
		expect(list).toContain("src/CLAUDE.md:1");
		expect(run(["verify", "--plan", planDir, "--ledgers", ledger]).code).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// free-form page notes
// ---------------------------------------------------------------------------

describe("모든 각도의 코드 페이지 메모는 자유 서술이고 페이지 인용만 요구한다", () => {
	const ANGLES = ["correctness", "regression", "requirement", "cleanup"];
	const DEEP = ["production", "schema", "migration", "config"];
	const doneWith = (ledger: string, out: string, note: string) =>
		cli(ledger, "done", pageIdOf(out), "--ack", ackOf(out), "--note", note);

	for (const angle of ANGLES) {
		test(`${angle}: 페이지를 인용한 메모는 통과하고 인용이 없는 메모는 거부된다`, () => {
			const ledger = newLedger(angle);
			const out = cli(ledger, "next").stdout;
			expect(DEEP).toContain(kindOf(out));
			const vague = doneWith(ledger, out, "전반적으로 확인함");
			expect(vague.code).toBe(1);
			expect(vague.stderr).toContain("must cite");
			expect(doneWith(ledger, out, `${citeOf(out)} 확인함`).code).toBe(0);
		});

		test(`${angle}: 메모 안의 \`a || b\`는 항목 구분자로 쪼개지지 않고 통과한다`, () => {
			const ledger = newLedger(angle);
			const out = cli(ledger, "next").stdout;
			expect(doneWith(ledger, out, `${citeOf(out)}: a || b 둘 다 확인함`).code).toBe(0);
		});

		test(`${angle}: NEXT와 resume은 각도별 템플릿을 보이지 않는다`, () => {
			const ledger = newLedger(angle);
			const out = cli(ledger, "next").stdout;
			expect(out).toContain("full note: cite a line from this page");
			expect(out).not.toMatch(/breaks-if|changed-contract|dependents:|branches:|quality:/);
			expect(cli(ledger, "resume").stdout).not.toContain("NOTE TEMPLATE");
		});
	}

	test("문서 페이지는 모든 각도에서 짧은 메모로 충분하다", () => {
		for (const angle of ANGLES) {
			const ledger = newLedger(angle);
			const page = advanceTo(ledger, ["doc"]);
			expect(page).toContain("short note is enough");
			expect(doneWith(ledger, page, "관련 메커니즘 없음: 안내 문서").code).toBe(0);
		}
	});
});

// ---------------------------------------------------------------------------
// process
// ---------------------------------------------------------------------------

describe("CLI 프로세스", () => {
	test("`--help`는 0, 모르는 명령과 빠진 ledger는 2로 끝난다", () => {
		const help = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
		expect(help.status).toBe(0);
		expect(help.stdout).toContain("done <pageId> --ack <code>");
		expect(spawnSync(process.execPath, [SCRIPT, "nope"], { encoding: "utf8" }).status).toBe(2);
		const env = { ...process.env };
		delete env.OMT_DIFF_CURSOR_LEDGER;
		expect(spawnSync(process.execPath, [SCRIPT, "next"], { encoding: "utf8", env }).status).toBe(2);
	});
});
