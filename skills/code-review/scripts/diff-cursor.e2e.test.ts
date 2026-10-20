#!/usr/bin/env bun

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

import { run, loadPlan, type Plan } from "./diff-cursor.ts";
import {
	initMemberLedger,
	memberLedgerDir,
	coverageCompletionGate,
	coverageHooks,
	type JobCoverage,
} from "./worker.ts";
import { cmdResumeMember, type JobConfig } from "@lib/generic-job";
import { runOneTurn } from "@lib/worker-utils";
import type { AgentDriver } from "@lib/agent-drivers/types";

const PAGE_BYTES = 6000;
const ANGLES = ["correctness", "regression", "cleanup", "requirement"] as const;

// ---------------------------------------------------------------------------
// Fixture: a temp git repo with a ~40KB change across production, doc, test and rule files
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
	return execFileSync(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
		{ cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } },
	);
}

function write(root: string, rel: string, content: string): void {
	fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
	fs.writeFileSync(path.join(root, rel), content);
}

let tmp: string;
let coverage: JobCoverage;
let plan: Plan;
let files: string[];

beforeAll(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diff-cursor-e2e-"));
	const repo = path.join(tmp, "repo");
	fs.mkdirSync(repo);
	git(repo, "init", "-q", "-b", "main");
	write(repo, ".claude/rules/x.md", '---\npaths: ["src/**/*.ts"]\n---\n# x\n- 함수는 짧게 쓴다\n- no any\n');
	write(repo, "src/app.ts", "export const seed = 0;\n");
	write(repo, "docs/guide.md", "# 안내\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "base");
	const base = git(repo, "rev-parse", "HEAD").trim();

	write(
		repo,
		"src/app.ts",
		Array.from(
			{ length: 260 },
			(_, i) => `export function computeTotal${i}(input: number): number { return input + ${i}; } // 합계 ${i}\n`,
		).join(""),
	);
	write(
		repo,
		"docs/guide.md",
		"# 안내\n" + Array.from({ length: 200 }, (_, i) => `이 문서는 리뷰 커서의 페이지 예산을 설명하는 ${i}번째 문단입니다.\n`).join(""),
	);
	write(
		repo,
		"src/app.test.ts",
		Array.from({ length: 110 }, (_, i) => `test("합계 ${i}", () => expect(computeTotal${i}(1)).toBe(${i + 1}));\n`).join(""),
	);
	git(repo, "add", "-A");
	git(repo, "commit", "-q", "-m", "head");
	const head = git(repo, "rev-parse", "HEAD").trim();
	const range = `${base}...${head}`;
	files = git(repo, "-c", "core.quotePath=false", "diff", "--name-only", range).trim().split("\n");

	const ledgerRoot = path.join(tmp, "ledger-root");
	const planDir = path.join(ledgerRoot, "plan");
	const r = run(["plan", "--repo", repo, "--range", range, "--files", JSON.stringify(files), "--out", planDir, "--page-bytes", String(PAGE_BYTES)]);
	if (r.code !== 0) throw new Error(r.stderr);
	plan = loadPlan(planDir);
	coverage = { ledgerRoot, planDir, planSha: plan.planSha };
	for (const angle of ANGLES) initMemberLedger(coverage, angle);
});

afterAll(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scripted finder helpers
// ---------------------------------------------------------------------------

const ledgerOf = (angle: string) => memberLedgerDir(coverage, angle);
const cli = (angle: string, ...args: string[]) => run([...args, "--ledger", ledgerOf(angle)]);
const ackOf = (out: string) => /### ACK (\S+): ([0-9a-f]{8}) ###/.exec(out)?.[2] ?? "";
const pageIdOf = (out: string) => /\[PAGE (\S+) ·/.exec(out)?.[1] ?? "";

/**
 * The note each scripted finder writes: a free note citing the page, naming `candidateId` when
 * one was recorded first.
 */
function noteFor(out: string, candidateId?: string): string {
	const line = /^ {0,5}(\d+) \|/m.exec(out)?.[1];
	const cite = line !== undefined ? `L${line}` : (/^FILES ON THIS PAGE:\n {2}(\S+)/m.exec(out)?.[1] ?? "");
	return `${cite} ${candidateId ? `후보 ${candidateId} 기록함` : "확인함"}`;
}

/**
 * Walks the angle's ledger with `done --next`, leaving `leave` pages unacknowledged, and returns
 * every page output seen. `onFirstPage` runs while the first page is issued (candidates need an
 * issued page).
 */
function walk(angle: string, opts: { leave?: number; onFirstPage?: (pageId: string) => string | undefined } = {}): string[] {
	const seen: string[] = [];
	let out = cli(angle, "next").stdout;
	let first = true;
	for (;;) {
		if (out.includes("ALL PAGES DONE")) return seen;
		const status = JSON.parse(cli(angle, "status", "--json").stdout) as { pagesTotal: number; pagesAcked: number };
		if (status.pagesTotal - status.pagesAcked <= (opts.leave ?? 0)) return seen;
		seen.push(out);
		let candidateId: string | undefined;
		if (first) {
			candidateId = opts.onFirstPage?.(pageIdOf(out));
			first = false;
		}
		const r = cli(angle, "done", pageIdOf(out), "--ack", ackOf(out), "--note", noteFor(out, candidateId), "--next");
		if (r.code !== 0) throw new Error(r.stderr);
		out = r.stdout;
	}
}

function addCandidate(angle: string, page: string, summary: string, rule?: string): string {
	const r = cli(
		angle,
		"candidate", "add", "--page", page, "--file", "src/app.ts", "--line", "4",
		"--summary", summary, "--failure-scenario", `${summary}: 호출하면 잘못된 값이 나온다`,
		...(rule ? ["--rule", rule] : []),
	);
	if (r.code !== 0) throw new Error(r.stderr);
	return /CANDIDATE (c\d+)/.exec(r.stdout)?.[1] ?? "";
}

function fillChecklist(angle: string): string {
	let violationId = "";
	plan.applicable.forEach((a, i) => {
		const violation = i === 0;
		const r = cli(
			angle, "checklist", "add", "--source", `${a.aliases[0] ?? a.path}:1`, "--rule", `${a.path} 첫 항목`,
			"--verdict", violation ? "위반" : "준수", "--evidence", "src/app.ts:4",
		);
		expect(r.code).toBe(0);
		if (violation) violationId = /(r\d+)/.exec(r.stdout)?.[1] ?? "";
	});
	return violationId;
}

// ---------------------------------------------------------------------------
// Happy path: four scripted finders reach 100%
// ---------------------------------------------------------------------------

describe("diff-cursor E2E: 네 finder가 diff를 100% 읽는 경로", () => {
	test("plan은 한글을 포함한 변경을 10페이지 이상으로 나누고 hunk 하나를 쪼갠다", () => {
		expect(plan.pages.length).toBeGreaterThanOrEqual(10);
		const texts = plan.pages.map((p) => fs.readFileSync(path.join(coverage.planDir, "pages", `${p.id}.txt`), "utf8"));
		expect(texts.some((t) => /^@@ .* \(continued\)$/m.test(t))).toBe(true);
		expect(texts.some((t) => t.includes("문단입니다"))).toBe(true);
		expect(plan.applicable.map((a) => a.path)).toContain(".claude/rules/x.md");
	});

	test("각 finder가 모든 페이지를 확인하면 verify가 0으로 끝나고 export가 각도별 후보와 체크리스트를 돌려준다", () => {
		let violationId = "";
		for (const angle of ANGLES) {
			const seen = walk(angle, {
				onFirstPage: (page) => {
					const id = addCandidate(angle, page, `${angle} 후보`);
					if (angle === "cleanup") {
						violationId = fillChecklist(angle);
						addCandidate(angle, page, "규칙 위반 후보", violationId);
					}
					return id;
				},
			});
			const fin = cli(angle, "finish");
			expect(fin.code).toBe(0);
			expect(seen.length).toBeGreaterThan(0);
			for (const o of seen) {
				expect(o).toContain('--note "<what you checked and concluded>" --next');
				expect(o).not.toMatch(/cite a line/);
			}
		}

		const verify = run(["verify", "--plan", coverage.planDir, "--ledgers", ...ANGLES.map(ledgerOf)]);
		expect(verify.code).toBe(0);

		for (const angle of ANGLES) {
			const exported = JSON.parse(cli(angle, "export").stdout) as {
				coverage: { pagesTotal: number; pagesAcked: number };
				candidates: { found_by: string; summary: string }[];
				checklist?: { id: string; verdict: string }[];
			};
			expect(exported.coverage.pagesAcked).toBe(exported.coverage.pagesTotal);
			expect(exported.coverage.pagesTotal).toBe(plan.pages.length);
			expect(exported.candidates.every((c) => c.found_by === angle)).toBe(true);
			expect(exported.candidates.map((c) => c.summary)).toContain(`${angle} 후보`);
			if (angle === "cleanup") {
				expect(exported.candidates.length).toBe(2);
				expect(exported.checklist?.length).toBe(plan.applicable.length);
				expect(exported.checklist?.filter((c) => c.verdict === "위반").map((c) => c.id)).toEqual([violationId]);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Negative path: a finder one page short
// ---------------------------------------------------------------------------

describe("diff-cursor E2E: 한 페이지 모자란 finder", () => {
	const SHORT = "short";

	test("finish와 verify가 실패한다", () => {
		initMemberLedger(coverage, SHORT);
		walk(SHORT, { leave: 1 });
		const status = JSON.parse(cli(SHORT, "status", "--json").stdout) as { pagesTotal: number; pagesAcked: number };
		expect(status.pagesAcked).toBe(status.pagesTotal - 1);

		const fin = cli(SHORT, "finish");
		expect(fin.code).toBe(1);
		const verify = run(["verify", "--plan", coverage.planDir, "--ledgers", ledgerOf(SHORT)]);
		expect(verify.code).toBe(1);
	});

	test("작업 계층의 완주 게이트는 done 대신 awaiting_resume을 만든다", async () => {
		const memberDir = path.join(tmp, "turn-member");
		fs.mkdirSync(memberDir, { recursive: true });
		const driver: AgentDriver = {
			cli: "opencode",
			parseStdout: () => ({ sessionID: "sess-1", terminal: "stop", text: "final", rawEvents: [] }),
			initialCommand: (o) => ({ program: o.baseCommand, args: o.baseArgs, env: o.workerEnv }),
			resumeCommand: (o) => ({ program: o.baseCommand, args: o.baseArgs, env: o.workerEnv }),
		};
		const result = await runOneTurn({
			program: "opencode",
			args: [],
			prompt: "p",
			member: SHORT,
			memberDir,
			command: "opencode",
			timeoutSec: 10,
			cliType: "opencode",
			workerEnv: {},
			driverFactory: () => driver,
			runOnceFn: async (o) => {
				fs.writeFileSync(path.join(o.memberDir, "output.txt"), "raw");
				fs.writeFileSync(path.join(o.memberDir, "error.txt"), "");
				return { member: o.member, command: o.command, attempt: 0, state: "done", exitCode: 0, message: null, finishedAt: new Date().toISOString() };
			},
			completionGate: coverageCompletionGate(coverage, SHORT),
		});
		expect(result.state).toBe("awaiting_resume");
		const status = JSON.parse(fs.readFileSync(path.join(memberDir, "status.json"), "utf8"));
		expect(status.state).toBe("awaiting_resume");
		expect(status.coverage).toMatchObject({ finished: false });
	});

	test("진행 없는 재개가 거듭되면 해법을 쓴 뒤 stalled로 멈추고 done이 되지 않는다", async () => {
		const jobDir = path.join(tmp, "job");
		const memberDir = path.join(jobDir, "members", SHORT);
		fs.mkdirSync(memberDir, { recursive: true });
		fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify({ id: "chunk-review-e2e", settings: { timeoutSec: 60, coverageGated: true } }));
		const statusPath = path.join(memberDir, "status.json");
		const writeStatus = (state: string) =>
			fs.writeFileSync(statusPath, JSON.stringify({ member: SHORT, command: "opencode", sessionID: "sess-1", state }));
		writeStatus("awaiting_resume");
		const config: JobConfig = {
			entitySingular: "member",
			entityPlural: "members",
			entityDirName: "members",
			jobPrefix: "chunk-review-",
			uiLabel: "[Chunk Review]",
			configTopLevelKey: "chunk-review",
		};
		const driver: AgentDriver = {
			cli: "opencode",
			parseStdout: () => null,
			initialCommand: () => ({ program: "opencode", args: [], env: {} }),
			resumeCommand: () => ({ program: "opencode", args: [], env: {} }),
		};

		// Leave a page issued so the remedy can try a real resplit on the ledger.
		cli(SHORT, "next");
		const states: string[] = [];
		let stalledError = "";
		for (let i = 0; i < 12 && !stalledError; i++) {
			try {
				await cmdResumeMember(jobDir, SHORT, "continue", config, {
					driverFactory: () => driver,
					// The finder's turn makes no progress: the real ledger gate still says unfinished.
					resumeOneTurnFn: async () => {
						expect(coverageCompletionGate(coverage, SHORT)().complete).toBe(false);
						writeStatus("awaiting_resume");
						return { state: "awaiting_resume", sessionID: "sess-1", text: "", exitCode: 0 };
					},
					coverage: coverageHooks(coverage),
				});
			} catch (e) {
				stalledError = e instanceof Error ? e.message : String(e);
			}
			states.push(JSON.parse(fs.readFileSync(statusPath, "utf8")).state);
		}
		expect(stalledError).toContain("member stalled");
		expect(states.at(-1)).toBe("stalled");
		expect(states).not.toContain("done");
		expect(states.slice(0, -1).every((s) => s === "awaiting_resume")).toBe(true);
		// The ledger was never finished by the policy.
		expect(cli(SHORT, "finish").code).toBe(1);
	}, 60000);
});
