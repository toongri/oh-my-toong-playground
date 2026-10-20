#!/usr/bin/env bun

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawn, spawnSync } from "child_process";

import {
	run,
	globMatch,
	parseDiff,
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

/** A citation of the page: a new-file line number, or the file name when the page has none. */
function citeOf(out: string): string {
	const line = /^ {0,5}(\d+) \|/m.exec(out)?.[1];
	if (line !== undefined) return `L${line}`;
	return /^FILES ON THIS PAGE:\n {2}(\S+)/m.exec(out)?.[1] ?? "";
}

/** A note that cites the page (a scripted finder that holds every page). */
const noteFor = (out: string) => `${citeOf(out)} 확인함`;

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

	test("한글 경로 파일도 diff 에서 찾는다", () => {
		expect(plan.files).toContain("src/설정.ts");
		expect(plan.filesWithoutDiff).not.toContain("src/설정.ts");
	});

	test("range 없는 단일 revision 과 --json 없는 status 는 사용법 오류다", () => {
		expect(run(["plan", "--repo", fx.repo, "--range", "HEAD", "--files", JSON.stringify(fx.files), "--out", path.join(fx.tmp, "single")]).code).toBe(2);
		expect(cli(newLedger("correctness"), "status").code).toBe(2);
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

	test("코드 페이지 메모는 인용 없이도 통과하고 빈 메모는 거부된다", () => {
		const ledger = newLedger("requirement");
		const out = cli(ledger, "next").stdout;
		const id = pageIdOf(out);
		for (const blank of ["", "   "])
			expect(cli(ledger, "done", id, "--ack", ackOf(out), "--note", blank).code).toBe(1);
		expect(cli(ledger, "done", id, "--ack", ackOf(out), "--note", "전반적으로 확인함").code).toBe(0);
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

	test("resume 한 번으로 각도·진행·다음 페이지·notes 안내·후보·체크리스트·적용 파일을 보여준다", () => {
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
			"NOTES: 2 note(s)",
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

	test("candidate add는 저장소에 없는 경로와 발급 전 페이지를 거부하고 변경 밖 기존 파일은 조용히 받아들이며 같은 후보는 한 번만 저장한다", () => {
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
		const addAt = (file: string, ...extra: string[]) =>
			cli(
				ledger,
				"candidate",
				"add",
				"--page",
				plan.pages[0]?.id as string,
				"--file",
				file,
				"--line",
				"1",
				"--summary",
				"s2",
				"--failure-scenario",
				"f",
				...extra,
			);
		for (const bad of [" ", "/etc/passwd", "../x", "src/../lib/CLAUDE.md", "nope/missing.ts", "src"])
			expect(addAt(bad).code).toBe(1);
		const outside = addAt("lib/CLAUDE.md");
		expect(outside.code).toBe(0);
		expect(outside.stdout).toBe("CANDIDATE c002 recorded (lib/CLAUDE.md:1)\n");
		expect(outside.stderr).toBe("");
		// --rule takes a checklist item id only, never a path
		expect(addAt("src/app.ts", "--rule", "docs/guide.md:2").code).toBe(1);
		expect(addAt("src/app.ts", "--rule", "r999").code).toBe(1);
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
		expect(exported.candidates).toHaveLength(2);
		expect(exported.candidates[0]).toMatchObject({
			id: "c001",
			found_by: "regression",
			failure_scenario: "f",
		});
		expect(exported.coverage).toMatchObject({
			pagesTotal: plan.pages.length,
			pagesDelivered: 1,
			pagesAcked: 0,
			candidates: 2,
		});
	});

	test("checklist --source는 적용 목록 밖 저장소 .md 파일도 조용히 받아들이고 줄 번호는 선택이다", () => {
		const ledger = newLedger("cleanup");
		const add = (src: string) => cli(ledger, "checklist", "add", "--source", src, "--rule", "x");
		const lib = add("lib/CLAUDE.md:1");
		expect(lib.code).toBe(0);
		expect(lib.stdout).toBe("CHECKLIST r001 added (lib/CLAUDE.md:1, no verdict yet)\n");
		expect(add("docs/guide.md").stdout).toContain("r002 added (docs/guide.md,");
		expect(add("docs/guide.md:9999").code).toBe(1);
		// the finish gate still wants every applicable file covered
		expect(cli(ledger, "finish").stderr).toContain("without a checklist item");
	});

	test("cleanup finish는 적용 파일마다 체크리스트 항목, 모든 항목의 최종 판정, 위반 항목의 후보를 요구한다", () => {
		const ledger = newLedger("cleanup");
		walk(ledger);
		const noItems = cli(ledger, "finish");
		expect(noItems.code).toBe(1);
		expect(noItems.stderr).toContain("without a checklist item");

		expect(cli(ledger, "checklist", "add", "--source", "lib/missing.md:1", "--rule", "x").code).toBe(
			1,
		);
		expect(cli(ledger, "checklist", "add", "--source", "src/app.ts:1", "--rule", "x").code).toBe(1);
		expect(cli(ledger, "checklist", "add", "--source", "../CLAUDE.md:1", "--rule", "x").code).toBe(
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

describe("모든 각도의 코드 페이지 메모는 비어 있지 않은 자유 서술이다", () => {
	const ANGLES = ["correctness", "regression", "requirement", "cleanup"];
	const doneWith = (ledger: string, out: string, note: string) =>
		cli(ledger, "done", pageIdOf(out), "--ack", ackOf(out), "--note", note);

	for (const angle of ANGLES) {
		test(`${angle}: 인용 없는 메모도 통과하고 빈 메모는 거부된다`, () => {
			const ledger = newLedger(angle);
			const out = cli(ledger, "next").stdout;
			expect(doneWith(ledger, out, "  ").code).toBe(1);
			expect(doneWith(ledger, out, "전반적으로 확인함").code).toBe(0);
		});

		test(`${angle}: 메모 안의 \`a || b\`는 항목 구분자로 쪼개지지 않고 통과한다`, () => {
			const ledger = newLedger(angle);
			const out = cli(ledger, "next").stdout;
			expect(doneWith(ledger, out, `${citeOf(out)}: a || b 둘 다 확인함`).code).toBe(0);
		});

		test(`${angle}: NEXT와 resume은 각도별 템플릿을 보이지 않는다`, () => {
			const ledger = newLedger(angle);
			const out = cli(ledger, "next").stdout;
			expect(out).toContain("<what you checked and concluded>");
			expect(out).not.toMatch(/cite a line|short note is enough/);
			expect(out).not.toMatch(/breaks-if|changed-contract|dependents:|branches:|quality:/);
			expect(cli(ledger, "resume").stdout).not.toContain("NOTE TEMPLATE");
		});
	}
});

// ---------------------------------------------------------------------------
// audited defects
// ---------------------------------------------------------------------------

/** A repo with a base commit and a head commit; returns the plan inputs and the plan result. */
function miniRepo(
	name: string,
	baseFiles: Record<string, string>,
	headFiles: Record<string, string>,
	pageBytes = PAGE_BYTES,
) {
	const root = path.join(fx.tmp, name);
	const repo = path.join(root, "repo");
	fs.mkdirSync(repo, { recursive: true });
	git(repo, "init", "-q", "-b", "main");
	for (const [rel, c] of Object.entries(baseFiles)) write(repo, rel, c);
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "--allow-empty", "-m", "base");
	const base = git(repo, "rev-parse", "HEAD").trim();
	for (const [rel, c] of Object.entries(headFiles)) write(repo, rel, c);
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "head");
	const head = git(repo, "rev-parse", "HEAD").trim();
	const range = `${base}...${head}`;
	const files = Object.keys(headFiles).filter((f) => !f.includes(".claude/") && !f.includes(".codex/"));
	const out = path.join(root, "plan");
	const r = run([
		"plan",
		"--repo",
		repo,
		"--range",
		range,
		"--files",
		JSON.stringify(files),
		"--out",
		out,
		"--page-bytes",
		String(pageBytes),
	]);
	if (r.code !== 0) throw new Error(r.stderr);
	const p = JSON.parse(fs.readFileSync(path.join(out, "plan.json"), "utf8")) as Plan;
	return { root, repo, range, files, out, plan: p };
}

describe("삭제된 파일에 후보 등록", () => {
	test("candidate add는 변경 목록의 삭제된 파일을 받아들이고, 변경 밖의 없는 파일은 계속 거부한다", () => {
		const root = path.join(fx.tmp, "deleted");
		const repo = path.join(root, "repo");
		fs.mkdirSync(repo, { recursive: true });
		git(repo, "init", "-q", "-b", "main");
		write(repo, "src/gone.ts", "export const a = 1;\nexport const b = 2;\n");
		write(repo, "src/keep.ts", "export const c = 1;\n");
		git(repo, "add", "-A");
		git(repo, "commit", "-q", "-m", "base");
		const base = git(repo, "rev-parse", "HEAD").trim();
		fs.rmSync(path.join(repo, "src/gone.ts"));
		write(repo, "src/keep.ts", "export const c = 2;\n");
		git(repo, "add", "-A");
		git(repo, "commit", "-q", "-m", "head");
		const head = git(repo, "rev-parse", "HEAD").trim();
		const out = path.join(root, "plan");
		const planned = run([
			"plan", "--repo", repo, "--range", `${base}...${head}`,
			"--files", JSON.stringify(["src/gone.ts", "src/keep.ts"]), "--out", out,
		]);
		expect(planned.code).toBe(0);
		const ledger = path.join(root, "ledger");
		expect(run(["init", "--plan", out, "--angle", "regression", "--ledger", ledger]).code).toBe(0);
		const page = pageIdOf(cli(ledger, "next").stdout);
		const add = (file: string) =>
			cli(ledger, "candidate", "add", "--page", page, "--file", file, "--line", "1",
				"--summary", "s", "--failure-scenario", "f");
		expect(add("src/gone.ts").stdout).toContain("c001 recorded (src/gone.ts:1)");
		expect(add("src/never-existed.ts").code).toBe(1);
	});
});

describe("git 설정과 무관한 diff 해석", () => {
	test("diff.noprefix·mnemonicPrefix가 켜진 사용자 설정에서도 경로가 그대로 읽힌다", () => {
		const cfg = path.join(fx.tmp, "noprefix.gitconfig");
		fs.writeFileSync(cfg, "[diff]\n\tnoprefix = true\n\tmnemonicPrefix = true\n");
		const saved = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = cfg;
		try {
			const m = miniRepo("noprefix", { "src/x.ts": "export const a = 1;\n" }, {
				"src/x.ts": "export const a = 2;\n",
			});
			expect(m.plan.filesWithoutDiff).toEqual([]);
			expect(m.plan.gitArgv.join(" ")).toContain("--src-prefix=a/ --dst-prefix=b/");
		} finally {
			if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
			else process.env.GIT_CONFIG_GLOBAL = saved;
		}
	});
});

describe("규칙 frontmatter 후행 주석", () => {
	test("블록 목록과 인라인 값의 따옴표 밖 ` # 주석`만 지운다", () => {
		expect(
			parseRuleFrontmatter(
				'---\npaths:\n  - "src/**/*.ts" # application code\n  - docs/** # d\n  - "a#b/**"\n  - \'c #d/**\'\n---\n',
			).patterns,
		).toEqual(["src/**/*.ts", "docs/**", "a#b/**", "c #d/**"]);
		expect(parseRuleFrontmatter('---\npaths: ["a #b/**", x/** ]  # tail\n---\n').patterns).toEqual([
			"a #b/**",
			"x/**",
		]);
	});
});

describe("finish 이후 ledger는 닫혀 있다", () => {
	test("candidate add와 checklist add·update가 거부된다", () => {
		const ledger = newLedger("correctness");
		walk(ledger);
		expect(cli(ledger, "finish").code).toBe(0);
		const before = fs.readFileSync(path.join(ledger, "ledger.json"), "utf8");
		const cand = cli(
			ledger, "candidate", "add", "--page", plan.pages[0]?.id as string, "--file", "src/app.ts",
			"--line", "3", "--summary", "늦은 후보", "--failure-scenario", "finish 뒤에 추가됨",
		);
		expect(cand.code).toBe(1);
		expect(cand.stderr).toContain("ledger finished");
		const add = cli(ledger, "checklist", "add", "--source", "CLAUDE.md:1", "--rule", "x");
		expect(add.code).toBe(1);
		expect(add.stderr).toContain("ledger finished");
		const upd = cli(ledger, "checklist", "update", "r001", "--verdict", "준수");
		expect(upd.code).toBe(1);
		expect(upd.stderr).toContain("ledger finished");
		expect(fs.readFileSync(path.join(ledger, "ledger.json"), "utf8")).toBe(before);
	});
});

describe("ledger 잠금", () => {
	const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid as number;

	test("죽은 보유자가 남긴 잠금은 나이와 무관하게 인수된다", () => {
		const ledger = newLedger("correctness");
		const lock = path.join(ledger, ".lock");
		fs.writeFileSync(lock, `${deadPid()}.abcdef`);
		const t0 = Date.now();
		expect(cli(ledger, "next").code).toBe(0);
		expect(Date.now() - t0).toBeLessThan(5_000);
		expect(fs.existsSync(lock)).toBe(false);
		expect(fs.readdirSync(ledger).filter((n) => n.includes("stale") || n.includes("aside"))).toEqual([]);
	});

	test("살아 있는 보유자의 오래된 잠금은 대기 한도까지 인수되지 않고 보유자 pid를 알려 거부한다", () => {
		const ledger = newLedger("correctness");
		const lock = path.join(ledger, ".lock");
		fs.writeFileSync(lock, `${process.pid}.abcdef`);
		const old = new Date(Date.now() - 60_000);
		fs.utimesSync(lock, old, old);
		const r = cli(ledger, "next");
		expect(r.code).toBe(1);
		expect(r.stderr).toContain(`pid ${process.pid}`);
		expect(fs.readFileSync(lock, "utf8")).toBe(`${process.pid}.abcdef`);
	}, 20_000);

	test("떠 있는 자식 프로세스가 보유한 잠금도 인수되지 않는다", () => {
		const ledger = newLedger("correctness");
		const lock = path.join(ledger, ".lock");
		const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},30000)"], { stdio: "ignore" });
		try {
			fs.writeFileSync(lock, `${child.pid}.abcdef`);
			const r = cli(ledger, "next");
			expect(r.code).toBe(1);
			expect(r.stderr).toContain(`pid ${child.pid}`);
		} finally {
			child.kill();
		}
	}, 20_000);
});

describe("파일 권한", () => {
	test("plan 디렉터리·페이지·diff.patch·ledger는 소유자만 접근한다", () => {
		const ledger = newLedger("correctness");
		cli(ledger, "next");
		const mode = (p: string) => fs.statSync(p).mode & 0o777;
		for (const d of [planDir, path.join(planDir, "pages"), ledger]) expect(mode(d)).toBe(0o700);
		const filesIn = [
			path.join(planDir, "plan.json"),
			path.join(planDir, "diff.patch"),
			path.join(planDir, "pages", `${plan.pages[0]?.id}.txt`),
			path.join(ledger, "ledger.json"),
		];
		for (const f of filesIn) expect(mode(f)).toBe(0o600);
		const out = cli(ledger, "next").stdout;
		const id = pageIdOf(out);
		expect(cli(ledger, "resplit", id, "--page-bytes", "2048").code).toBe(0);
		expect(mode(path.join(ledger, "pages"))).toBe(0o700);
		for (const n of fs.readdirSync(path.join(ledger, "pages")))
			expect(mode(path.join(ledger, "pages", n))).toBe(0o600);
	});
});

describe("중첩 rules 디렉터리", () => {
	const base = { "pkg/src/a.ts": "export const a = 1;\n", "other/src/b.ts": "export const b = 1;\n" };
	const head = { "pkg/src/a.ts": "export const a = 2;\n", "other/src/b.ts": "export const b = 2;\n" };
	const rules = {
		"pkg/.claude/rules/ts.md": '---\npaths: ["src/**/*.ts"]\n---\n# ts\n',
		"pkg/.claude/rules/py.md": '---\npaths: ["**/*.py"]\n---\n# py\n',
		"pkg/.codex/rules/all.md": "# all in pkg\n",
		"pkg/CLAUDE.md": "# pkg\n",
	};

	test("변경 파일의 조상 디렉터리 규칙을 그 디렉터리 기준 paths로 평가한다", () => {
		const m = miniRepo("nested", { ...base, ...rules }, { ...head });
		const paths = m.plan.applicable.map((a) => a.path).sort();
		expect(paths).toEqual(["pkg/.claude/rules/ts.md", "pkg/.codex/rules/all.md", "pkg/CLAUDE.md"]);
		expect(paths).not.toContain("pkg/.claude/rules/py.md");
	});

	test("변경 파일이 규칙 소유 디렉터리 밖이면 그 규칙은 적용되지 않는다", () => {
		const m = miniRepo("nested-out", { ...base, ...rules }, { "other/src/b.ts": "export const b = 2;\n" });
		expect(m.plan.applicable).toEqual([]);
	});

	test("작업 트리가 아니라 검토 대상 head 커밋의 지침·규칙을 읽는다", () => {
		const m = miniRepo("nested-head", { ...base, ...rules }, { ...head });
		// Working tree drifts after the head commit: the matching rule is rewritten, a new one appears.
		write(m.repo, "pkg/.claude/rules/ts.md", '---\npaths: ["nothing/**"]\n---\n');
		write(m.repo, "pkg/.claude/rules/late.md", "# untracked\n");
		fs.rmSync(path.join(m.repo, "pkg/CLAUDE.md"));
		const out = path.join(m.root, "plan2");
		const r = run([
			"plan", "--repo", m.repo, "--range", m.range, "--files", JSON.stringify(m.files), "--out", out,
		]);
		expect(r.code).toBe(0);
		const p2 = JSON.parse(fs.readFileSync(path.join(out, "plan.json"), "utf8")) as Plan;
		expect(p2.applicable.map((a) => a.path).sort()).toEqual([
			"pkg/.claude/rules/ts.md",
			"pkg/.codex/rules/all.md",
			"pkg/CLAUDE.md",
		]);
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

// ---------------------------------------------------------------------------
// notes / export paging, git config, rule frontmatter, glob safety
// ---------------------------------------------------------------------------

describe("notes 는 오래된 메모를 잃지 않고 resume 은 notes 로 안내한다", () => {
	test("메모 8개 중 첫 페이지의 긴 메모까지 notes 로 전부 읽히고 호출마다 예산 이하다", () => {
		const ledger = newLedger("correctness");
		let out = cli(ledger, "next").stdout;
		const filler = "가".repeat(200);
		const question = "check later: OPEN_QUESTION_MARKER 는 src/app.ts 의 재시도 경로에서 확인";
		for (let i = 0; i < 8; i++) {
			const note = `${noteFor(out)} ${i === 0 ? `${filler} ${question}` : filler} 끝${i}`;
			const r = cli(ledger, "done", pageIdOf(out), "--ack", ackOf(out), "--note", note, "--next");
			expect(r.code).toBe(0);
			out = r.stdout;
		}
		const resume = cli(ledger, "resume").stdout;
		expect(resume).not.toContain("OPEN_QUESTION_MARKER");
		expect(resume).not.toContain("OPEN QUESTIONS");
		expect(resume).toContain("read them in full with: notes");

		let text = "";
		let cmd = cli(ledger, "notes");
		let calls = 0;
		for (;;) {
			expect(cmd.code).toBe(0);
			expect(Buffer.byteLength(cmd.stdout)).toBeLessThanOrEqual(PAGE_BYTES);
			text += cmd.stdout;
			calls++;
			const more = /^MORE: notes --from (\S+)$/m.exec(cmd.stdout)?.[1];
			if (more === undefined) break;
			cmd = cli(ledger, "notes", "--from", more);
		}
		expect(calls).toBeGreaterThan(1);
		expect(text).toContain(question);
		for (let i = 0; i < 8; i++) expect(text).toContain(`끝${i}`);
	});

	test("메모가 없으면 그렇게 알리고 모르는 --from 페이지는 거부한다", () => {
		const ledger = newLedger("correctness");
		expect(cli(ledger, "notes").stdout).toContain("no notes yet");
		expect(cli(ledger, "notes", "--from", "nope").code).toBe(1);
	});
});

describe("export 는 예산 이하의 독립 JSON 부분으로 나뉜다", () => {
	test("40KB 가 넘는 ledger 도 부분들을 합치면 후보·체크리스트·메모가 빠짐없이 돌아온다", () => {
		const ledger = newLedger("correctness");
		const first = cli(ledger, "next").stdout;
		const pid = pageIdOf(first);
		const N = 130;
		for (let i = 0; i < N; i++) {
			const r = cli(
				ledger, "candidate", "add", "--page", pid, "--file", "src/app.ts", "--line", String(i + 1),
				"--summary", `후보${i} ${"요".repeat(150)}`, "--failure-scenario", `시나리오${i} ${"시".repeat(150)}`,
			);
			expect(r.code).toBe(0);
		}
		expect(cli(ledger, "done", pid, "--ack", ackOf(first), "--note", `${noteFor(first)} 첫 메모`).code).toBe(0);
		const outFile = path.join(fx.tmp, `export-full-${++ledgerSeq}.json`);
		const w = cli(ledger, "export", "--out", outFile);
		expect(w.code).toBe(0);
		const full = JSON.parse(fs.readFileSync(outFile, "utf8"));
		expect(Buffer.byteLength(JSON.stringify(full, null, 2))).toBeGreaterThan(40_000);
		expect(full.candidates).toHaveLength(N);

		const parts: any[] = [];
		const p1 = cli(ledger, "export");
		expect(p1.code).toBe(0);
		const total = JSON.parse(p1.stdout).parts as number;
		expect(total).toBeGreaterThan(1);
		for (let n = 1; n <= total; n++) {
			const r = n === 1 ? p1 : cli(ledger, "export", "--part", String(n));
			expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(PAGE_BYTES);
			const j = JSON.parse(r.stdout);
			expect(j).toMatchObject({ part: n, parts: total, angle: "correctness" });
			parts.push(j);
		}
		const cands = parts.flatMap((p) => p.candidates);
		expect(cands.map((c: any) => c.line)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
		expect(cands.every((c: any) => c.found_by === "correctness")).toBe(true);
		expect(parts.flatMap((p) => p.notes).map((x: any) => x.pageId)).toEqual([pid]);
		// candidates come before notes across the whole sequence
		const lastCandPart = parts.map((p) => p.candidates.length > 0).lastIndexOf(true);
		const firstNotePart = parts.findIndex((p) => p.notes.length > 0);
		expect(lastCandPart).toBeLessThanOrEqual(firstNotePart);
		expect(cli(ledger, "export", "--part", String(total + 1)).code).toBe(1);
	});
});

describe("diff.suppressBlankEmpty 가 켜진 사용자 설정", () => {
	test("parseDiff 는 hunk 안의 빈 줄을 문맥 줄로 세어 줄 번호가 어긋나지 않는다", () => {
		const patch =
			"diff --git a/x.ts b/x.ts\nindex 1..2 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1,4 +1,4 @@\n a\n\n b\n-c\n+d\n";
		const d = parseDiff(patch, ["x.ts"]);
		const plus = d.atoms.find((a) => a.text === "+d");
		expect(plus?.newNo).toBe(4);
	});

	test("plan 은 사용자 설정과 무관하게 빈 문맥 줄을 공백 줄로 받고 줄 번호가 맞다", () => {
		const cfg = path.join(fx.tmp, "blank.gitconfig");
		fs.writeFileSync(cfg, "[diff]\n\tsuppressBlankEmpty = true\n");
		const saved = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = cfg;
		try {
			const m = miniRepo(
				"blank-ctx",
				{ "src/b.ts": "export const a = 1;\n\nexport const b = 2;\n\nexport const c = 3;\n" },
				{ "src/b.ts": "export const a = 1;\n\nexport const b = 2;\n\nexport const c = 4;\n" },
			);
			expect(m.plan.gitArgv.join(" ")).toContain("diff.suppressBlankEmpty=false");
			const page = fs.readFileSync(path.join(m.out, "pages", `${m.plan.pages[0]?.id}.txt`), "utf8");
			expect(page).toMatch(/ 5 \|\+export const c = 4;/);
		} finally {
			if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
			else process.env.GIT_CONFIG_GLOBAL = saved;
		}
	});
});

describe("규칙 frontmatter 보강", () => {
	test("`paths: # 주석` 뒤의 블록 목록을 읽는다", () => {
		expect(parseRuleFrontmatter("---\npaths: # where\n  - src/**\n  - docs/**\n---\n").patterns).toEqual([
			"src/**",
			"docs/**",
		]);
	});

	test("블록 목록 항목 사이의 # 주석 줄은 목록을 끝내지 않는다", () => {
		expect(
			parseRuleFrontmatter("---\npaths:\n  - src/**\n  # note\n  - docs/**\n---\n").patterns,
		).toEqual(["src/**", "docs/**"]);
	});

	test("앞의 BOM 은 `---` 검사 전에 지운다", () => {
		expect(parseRuleFrontmatter("\uFEFF---\npaths: src/**\n---\n").patterns).toEqual(["src/**"]);
	});
});

describe("잘못된 glob", () => {
	test("globMatch 는 던지지 않고 일치하지 않는다고 답한다", () => {
		expect(globMatch("src/[z-a].ts", "src/a.ts")).toBe(false);
	});

	test("plan 은 규칙 파일과 패턴을 이름으로 든 경고를 남기고 계속한다", () => {
		const m = miniRepo(
			"bad-glob",
			{ "src/g.ts": "export const g = 1;\n", ".claude/rules/bad.md": "---\npaths: [\"src/[z-a].ts\"]\n---\n# bad\n" },
			{ "src/g.ts": "export const g = 2;\n" },
		);
		expect(m.plan.warnings.some((w) => w.includes(".claude/rules/bad.md") && w.includes("src/[z-a].ts"))).toBe(true);
		expect(m.plan.applicable.map((a) => a.path)).not.toContain(".claude/rules/bad.md");
	});
});
