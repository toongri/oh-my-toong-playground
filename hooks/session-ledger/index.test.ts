import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractClaude, extractCodex, outputExcerpt } from "./extract.ts";
import { headOf, ledgerPath, preCompact, selectLog, sessionStartContext } from "./index.ts";
import {
	fallbackLedger,
	isLedgerJson,
	type LedgerJson,
	type ModelResult,
	previousUsers,
	renderLedger,
	repairForeignLetters,
	unknownIdentifiers,
	validateLedger,
	writeLedger,
} from "./ledger.ts";

const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "session-ledger-test-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const user = (text: string, extra: Record<string, unknown> = {}) => ({
	type: "user",
	message: { content: text },
	...extra,
});
const assistant = (...blocks: Record<string, unknown>[]) => ({ type: "assistant", message: { content: blocks } });

function ledgerJson(overrides: Partial<LedgerJson> = {}): LedgerJson {
	return {
		analysis_checklist: ["U1 asked to fix the login bug"],
		primary_request_and_intent: "Fix the login bug.",
		current_work: "Editing `src/login.ts`.",
		next_steps: ["Run the tests"],
		working_rules: [],
		decisions: [],
		rejected: [],
		unverified_results: [],
		open_questions: [],
		key_technical_concepts: [],
		files_and_code: [],
		errors_and_fixes: [],
		operational_gotchas: [],
		experiment_results: [],
		findings: [],
		pieces: [],
		pending: [],
		...overrides,
	};
}

describe("Claude 대화 기록 추출", () => {
	test("사용자·어시스턴트 id는 창 밖에서도 세어 compaction 뒤에도 같은 번호를 유지한다", () => {
		const records = [
			user("첫 요청"),
			assistant({ type: "text", text: "확인했습니다" }),
			{ type: "system", subtype: "compact_boundary" },
			user("두 번째 요청"),
		];
		const log = extractClaude(records, 3);
		expect(log.users).toEqual([{ id: "U2", text: "두 번째 요청" }]);
		expect(log.lines).toEqual(["[U2 user] 두 번째 요청"]);
	});

	test("창 밖의 질문 답변도 세어, 창만 읽은 추출과 전체 추출의 사용자 id가 같다", () => {
		const records = [
			user("첫 요청"),
			assistant({ type: "tool_use", id: "ask1", name: "AskUserQuestion", input: { questions: [{ question: "A?" }] } }),
			{ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "ask1", content: "A로 하자" }] } },
			{ type: "system", subtype: "compact_boundary" },
			user("다음 요청"),
		];
		expect(extractClaude(records, 4).users).toEqual([{ id: "U3", text: "다음 요청" }]);
		expect(extractClaude(records).users.at(-1)).toEqual({ id: "U3", text: "다음 요청" });
	});

	test("스킬 본문은 meta 레코드로 와도 로그에 남고, 다른 meta 레코드는 버린다", () => {
		const records = [
			user("Base directory for this skill: /skills/sisyphus\n\ncommits by mnemosyne", { isMeta: true }),
			user("<local-command-caveat>무시</local-command-caveat>", { isMeta: true }),
		];
		const log = extractClaude(records);
		expect(log.lines).toHaveLength(1);
		expect(log.lines[0]).toStartWith("[skill sisyphus] ");
		expect(log.users).toHaveLength(0);
	});

	test("작업 중에 보낸 사용자 메시지와 대기열로 온 서브에이전트 결과를 모두 추출한다", () => {
		const records = [
			{
				type: "attachment",
				attachment: { type: "queued_command", prompt: "evidence도 지워줘", origin: { kind: "human" } },
			},
			{
				type: "attachment",
				attachment: {
					type: "queued_command",
					commandMode: "task-notification",
					prompt: "<task-notification><summary>Agent done</summary><result>found root cause</result></task-notification>",
				},
			},
		];
		const log = extractClaude(records);
		expect(log.lines[0]).toBe("[U1 user, sent while the agent was working] evidence도 지워줘");
		expect(log.lines[1]).toBe("[agent result] Agent done :: found root cause");
	});

	test("질문 도구 오류는 사용자 답변으로 잡지 않는다", () => {
		const records = [
			assistant({ type: "tool_use", id: "ask1", name: "AskUserQuestion", input: { questions: [{ question: "push?" }] } }),
			user("", {}),
			{
				type: "user",
				message: {
					content: [{ type: "tool_result", tool_use_id: "ask1", is_error: true, content: "<tool_use_error>bad json</tool_use_error>" }],
				},
			},
		];
		const log = extractClaude(records);
		expect(log.users).toHaveLength(0);
		expect(log.lines.at(-1)).toStartWith("[tool error]");
	});

	test("긴 출력의 잘린 가운데에서도 결과 요약 줄은 남긴다", () => {
		const body = `${"a".repeat(1200)}\n${"noise\n".repeat(300)}Tasks:    6 successful, 6 total\n${"b".repeat(900)}`;
		expect(outputExcerpt(body)).toContain("Tasks:    6 successful, 6 total");
	});
});

describe("Codex rollout 추출", () => {
	test("item_completed 스트림에서 발언·명령·파일 변경·서브에이전트 최종 메시지를 뽑는다", () => {
		const sessions = tempDir();
		mkdirSync(join(sessions, "2026", "09"), { recursive: true });
		writeFileSync(
			join(sessions, "2026", "09", "rollout-x-child-thread.jsonl"),
			`${JSON.stringify({ type: "event_msg", payload: { type: "task_complete", last_agent_message: "원인은 타이머" } })}\n`,
		);
		const item = (payload: Record<string, unknown>) => ({ type: "event_msg", payload: { type: "item_completed", item: payload } });
		const records = [
			item({ type: "UserMessage", content: [{ type: "text", text: "테스트 고쳐줘" }] }),
			item({ type: "AgentMessage", content: [{ type: "Text", text: "확인하겠습니다" }] }),
			item({ type: "CommandExecution", command: ["/bin/zsh", "-lc", "pnpm test"], aggregated_output: "ok", exit_code: 0 }),
			item({ type: "FileChange", changes: { "/repo/a.ts": { type: "update" } } }),
			item({ type: "SubAgentActivity", kind: "completed", agent_thread_id: "child-thread", agent_path: "/root/probe" }),
		];
		const log = extractCodex(records, 0, sessions);
		expect(log.lines).toEqual([
			"[U1 user] 테스트 고쳐줘",
			"[A1 assistant] 확인하겠습니다",
			"[tool Bash] :: pnpm test",
			"[result] exit 0: ok",
			"[tool Edit] file_path=/repo/a.ts (update)",
			"[agent result] Agent /root/probe finished :: 원인은 타이머",
		]);
		expect(log.editedFiles).toEqual(["/repo/a.ts"]);
	});
});

describe("검증기", () => {
	const ctx = (overrides: Record<string, unknown> = {}) => ({
		users: new Map([["U1", "로그인 버그 고쳐줘."]]),
		assistants: new Map([["A1", "1. 재시도 2. 캐시"]]),
		sourceText: "[U1 user] 로그인 버그 고쳐줘.\nEditing src/login.ts",
		budget: 32000,
		...overrides,
	});

	test("schema.json과 모양이 다른 요약기 출력은 받지 않는다", () => {
		expect(isLedgerJson(ledgerJson())).toBe(true);
		const { pending: _, ...missing } = ledgerJson();
		expect(isLedgerJson(missing)).toBe(false);
		expect(isLedgerJson({ ...ledgerJson(), extra: [] })).toBe(false);
		expect(isLedgerJson({ ...ledgerJson(), next_steps: [{ step: "x" }] })).toBe(false);
	});
	test("정상 출력은 위반이 없다", () => {
		expect(validateLedger(ledgerJson(), ctx())).toEqual([]);
	});

	test("결정은 누가 정했는지를 정해진 값으로 적고, 출처는 실제 사용자 메시지만 가리킨다", () => {
		const decision = (made_by: string, source: string) => ({ decision: "Keep the cache", rationale: "faster", made_by, source });
		expect(isLedgerJson(ledgerJson({ decisions: [decision("agreed", "A1, U1")] as LedgerJson["decisions"] }))).toBe(true);
		expect(isLedgerJson({ ...ledgerJson(), decisions: [decision("someone", "U1")] })).toBe(false);
		const stray = validateLedger(ledgerJson({ decisions: [decision("user", "U1, U7")] as LedgerJson["decisions"] }), ctx());
		expect(stray).toEqual([expect.stringContaining('["U7"]')]);
	});

	test("사용자 몫으로 적은 결정은 그 결정을 내리거나 받아들인 사용자 메시지를 출처로 든다", () => {
		const decision = (made_by: string, source: string) => ({ decision: "Keep the cache", rationale: "faster", made_by, source });
		const check = (made_by: string, source: string) =>
			validateLedger(ledgerJson({ decisions: [decision(made_by, source)] as LedgerJson["decisions"] }), ctx());
		expect(check("user", "A3")).toEqual([expect.stringContaining('"Keep the cache"')]);
		expect(check("agreed", "A1")).toEqual([expect.stringContaining('"Keep the cache"')]);
		expect(check("agreed", "A1, U1")).toEqual([]);
		expect(check("agent", "")).toEqual([]);
	});

	test("요약기 출력에는 승인·인용 필드가 없다", () => {
		expect(isLedgerJson({ ...ledgerJson(), approved_proposals: [] })).toBe(false);
		const step = { step: "Run the tests", authorized_by: "U1", authorization_quote: "고쳐줘", needs_user_confirmation: false };
		expect(isLedgerJson({ ...ledgerJson(), next_steps: [step] })).toBe(false);
		const decision = { decision: "d", rationale: "r", decided_by: "U1", user_quote: "고쳐줘" };
		expect(isLedgerJson({ ...ledgerJson(), decisions: [decision] })).toBe(false);
	});

	test("로그에 없는 식별자는 거부하고, 로그의 디렉터리와 파일명을 합친 경로는 허용한다", () => {
		const source = "cd /tmp/work && ls\nwrote ac-v5.json";
		expect(unknownIdentifiers(ledgerJson({ current_work: "See `/tmp/work/ac-v5.json`." }), source)).toEqual([]);
		expect(unknownIdentifiers(ledgerJson({ current_work: "See `src/logn.ts`." }), source)).toEqual(["src/logn.ts"]);
	});

	test("일반 문장 속 브랜치·경로의 한 글자 오타는 거부하고, 풀어 쓴 영어 표현은 허용한다", () => {
		const source = "git push origin resolve-3229:toong-algocare/b2c-6078 ; partial re-run of child_process";
		const prose = (text: string) => unknownIdentifiers(ledgerJson({ current_work: text }), source);
		expect(prose("Push resolve-3229:toong-algacare/b2c-6078 next.")).toEqual(["toong-algacare"]);
		expect(prose("Push resolve-3229:toong-algocare/b2c-6078 next.")).toEqual([]);
		expect(prose("A partial-rerun/child-process check, then a script-decided step.")).toEqual([]);
	});

	test("로그의 단어와 숫자를 공백 없이 붙인 표현은 오타로 보지 않고, 번호가 바뀐 식별자는 거부한다", () => {
		const source = "use-case 4/4, 100% coverage; Mobile HTTP 200 offsets 0/100; adb -s emulator-5556 shell";
		const prose = (text: string) => unknownIdentifiers(ledgerJson({ current_work: text }), source);
		expect(prose("use-case4/4 with100% coverage; HTTP200 offsets0/100.")).toEqual([]);
		expect(unknownIdentifiers(ledgerJson({ current_work: "Set width0 and totalcount6." }), "style width: 0; totalCount: 6")).toEqual([]);
		expect(prose("Drive emulator-5557 next.")).toEqual(["emulator-5557"]);
	});

	test("로그에 없는 문자 체계가 섞여 깨진 경로는 거부하고, 한글 설명은 허용한다", () => {
		const source = "cd /repo/기존-프로그램-문제/apps && cat slot-distribution.ts";
		const text = (current_work: string) => unknownIdentifiers(ledgerJson({ current_work }), source);
		expect(text("Open `/repo/기존-프로그램-խնդիր/apps/slot-distribution.ts`.")).toEqual([
			"/repo/기존-프로그램-խնդիր/apps/slot-distribution.ts",
		]);
		expect(text("다음으로 `/repo/기존-프로그램-문제/apps/slot-distribution.ts`를 수정한다.")).toEqual([]);
	});

	test("다음 단계는 확인 표시 없이 이어서 할 작업 순서로만 보여준다", () => {
		const markdown = renderLedger(
			ledgerJson({
				next_steps: ["Run the tests", "Push the branch"],
				decisions: [
					{ decision: "Keep the cache", rationale: "a cold start costs 4 s", made_by: "user", source: "U3" },
					{ decision: "Retry twice", rationale: "the API drops one call in 50", made_by: "agent", source: "" },
				],
				unverified_results: [{ source: "code-reviewer", recommendations: ["Rename the flag"] }],
			}),
			[],
		);
		expect(markdown).toContain("## 3. Next steps\n1. Run the tests\n2. Push the branch\n");
		expect(markdown).toContain("- Keep the cache — a cold start costs 4 s (user's decision: U3)\n- Retry twice — the API drops one call in 50 (agent's decision)\n");
		expect(markdown).toContain("## Results the agent had not acted on yet\n- **code-reviewer**\n  - Rename the flag\n");
		expect(markdown).not.toMatch(/approv|ask the user|confirm/i);
	});

	test("깨진 경로 구간은 로그의 가장 가까운 구간으로 복원한다", () => {
		const source = "cd /repo/기존-프로그램-문제/apps && cat slot-distribution.ts";
		const garbled = ledgerJson({
			current_work: "Open `/repo/기존-프로แกรม-문제/apps/slot-distribution.ts` and `/repo/기존-프로그램-문зе/apps`.",
		});
		const repaired = repairForeignLetters(garbled, source);
		expect(repaired.current_work).toBe(
			"Open `/repo/기존-프로그램-문제/apps/slot-distribution.ts` and `/repo/기존-프로그램-문제/apps`.",
		);
		expect(unknownIdentifiers(repaired, source)).toEqual([]);
		// A translated segment is too far to respell, but its neighbors in the log's paths still place it.
		const translated = repairForeignLetters(ledgerJson({ current_work: "Open `/repo/կ_existing-프로그램-문제/apps`." }), source);
		expect(translated.current_work).toBe("Open `/repo/기존-프로그램-문제/apps`.");
	});

	test("경로나 한글이 없는 산문의 외국 문자는 위반이나 복원 대상이 아니다", () => {
		const source = "latency measured with the naming guide";
		for (const text of ["latency 120 μs measured", "Use λ-calculus naming"]) {
			expect(unknownIdentifiers(ledgerJson({ current_work: text }), source)).toEqual([]);
			expect(repairForeignLetters(ledgerJson({ current_work: text }), source).current_work).toBe(text);
		}
	});

	test("한글이 섞인 토큰의 깨진 구간은 슬래시가 없어도 위반으로 잡는다", () => {
		const source = "cd algocare-home/기존-프로그램-문제/apps";
		expect(unknownIdentifiers(ledgerJson({ current_work: "Open algocare-home/기존-프로그램-խնդիր/apps now." }), source)).toEqual([
			"algocare-home/기존-프로그램-խնդիր/apps",
		]);
		expect(unknownIdentifiers(ledgerJson({ current_work: "Open 기존-프로그램-խնդիր now." }), source)).toEqual(["기존-프로그램-խնդիր"]);
	});
});

describe("재시도와 대체 경로", () => {
	const log = {
		lines: ["[U1 user] 로그인 버그 고쳐줘.", "[A1 assistant] 1. 재시도 2. 캐시", "Editing src/login.ts"],
		users: [{ id: "U1", text: "로그인 버그 고쳐줘." }],
		assistants: [{ id: "A1", text: "1. 재시도 2. 캐시" }],
		editedFiles: ["src/login.ts"],
	};

	test("거부된 출력은 위반 목록과 함께 되돌려 보내고, 고친 출력을 채택한다", async () => {
		const prompts: string[] = [];
		const outputs: ModelResult[] = [
			{ output: ledgerJson({ current_work: "Editing `src/logn.ts`." }) },
			{ output: ledgerJson() },
		];
		const result = await writeLedger({
			log,
			runModel: async (prompt) => {
				prompts.push(prompt);
				return outputs.shift() as ModelResult;
			},
			deadline: Date.now() + 60_000,
		});
		expect(result.status).toBe("accepted");
		expect(result.attempts).toHaveLength(2);
		expect(prompts[1]).toContain("YOUR PREVIOUS OUTPUT WAS REJECTED");
		expect(prompts[1]).toContain("src/logn.ts");
		expect(result.markdown).toContain("## All user messages (verbatim)\n- [U1] 로그인 버그 고쳐줘.");
	});

	test("지켜야 할 규칙에는 사용자 발언과 불러온 스킬에서 온 항목만 남고, 규칙 파일 요약은 빠진다", async () => {
		const result = await writeLedger({
			log: { ...log, lines: [...log.lines, "[skill qa] QA never edits product code"] },
			previousLedger: "## Working rules (still in force)\n- Commits go through the commit subagent (sisyphus)\n- Old rule summary (AGENTS.md)\n",
			runModel: async () => ({
				output: ledgerJson({
					working_rules: [
						{ rule: "Reply in Korean", source: "U1" },
						{ rule: "QA never edits product code", source: "qa" },
						{ rule: "Commits go through the commit subagent", source: "sisyphus" },
						{ rule: "Write the failing test first", source: "tdd.md" },
						{ rule: "Never coin opaque labels", source: ".claude/rules/communication-style.md" },
						{ rule: "Old rule summary", source: "AGENTS.md" },
						{ rule: "Cites a message that does not exist", source: "U9" },
					],
				}),
			}),
			deadline: Date.now() + 60_000,
		});
		expect(result.status).toBe("accepted");
		expect(result.markdown).toContain(
			"## Working rules (still in force)\n- Reply in Korean (U1)\n- QA never edits product code (qa)\n- Commits go through the commit subagent (sisyphus)\n\n",
		);
	});

	test("이전 ledger가 스킬을 파일 경로로 적었어도 그 스킬의 규칙은 남는다", async () => {
		const result = await writeLedger({
			log,
			previousLedger:
				"## Working rules (still in force)\n- QA owns dynamic verification (/Users/me/.agents/skills/qa/SKILL.md)\n- Red then green (/Users/me/.codex/rules/tdd.md)\n",
			runModel: async () => ({
				output: ledgerJson({
					working_rules: [
						{ rule: "QA owns dynamic verification", source: "qa" },
						{ rule: "Saved case needs a clean replay", source: "/Users/me/.agents/skills/qa/reusable-cases.md" },
						{ rule: "Red then green", source: "/Users/me/.codex/rules/tdd.md" },
					],
				}),
			}),
			deadline: Date.now() + 60_000,
		});
		expect(result.markdown).toContain(
			"## Working rules (still in force)\n- QA owns dynamic verification (qa)\n- Saved case needs a clean replay (/Users/me/.agents/skills/qa/reusable-cases.md)\n\n",
		);
	});

	test("스킬 디렉터리 경로를 출처로 든 규칙은 그 스킬을 불러왔을 때만 남는다", async () => {
		const result = await writeLedger({
			log: { ...log, lines: [...log.lines, "[skill qa] QA never edits product code"] },
			runModel: async () => ({
				output: ledgerJson({
					working_rules: [
						{ rule: "Saved case needs a clean replay", source: "/Users/me/.agents/skills/qa/reusable-cases.md" },
						{ rule: "A rule from a skill never loaded", source: "/tmp/skills/unloaded/note.md" },
					],
				}),
			}),
			deadline: Date.now() + 60_000,
		});
		expect(result.markdown).toContain(
			"## Working rules (still in force)\n- Saved case needs a clean replay (/Users/me/.agents/skills/qa/reusable-cases.md)\n\n",
		);
	});

	test("예산만 넘은 시도는 재시도 없이 바로 채택한다", async () => {
		const sizes = [3000, 2000, 2500];
		const result = await writeLedger({
			log,
			budget: 100,
			runModel: async () => ({ output: ledgerJson({ pending: ["x".repeat(sizes.shift() as number)] }) }),
			deadline: Date.now() + 60_000,
		});
		expect(result.status).toBe("accepted-over-budget");
		expect(result.attempts).toHaveLength(1);
		expect(result.markdown).toContain(`- ${"x".repeat(3000)}\n`);
	});

	test("다른 위반으로 재시도한 뒤 예산만 넘은 시도는 그대로 채택한다", async () => {
		const outputs: ModelResult[] = [
			{ output: ledgerJson({ current_work: "Editing `src/logn.ts`." }) },
			{ output: ledgerJson({ pending: ["x".repeat(3000)] }) },
		];
		const result = await writeLedger({
			log,
			budget: 100,
			runModel: async () => outputs.shift() as ModelResult,
			deadline: Date.now() + 60_000,
		});
		expect(result.status).toBe("accepted-over-budget");
		expect(result.attempts).toHaveLength(2);
	});

	test("어떤 시도도 검증을 통과하지 못하면 문제가 가장 적은 시도를 채택하고 확인 못 한 점을 적는다", async () => {
		const outputs: ModelResult[] = [
			{ output: ledgerJson({ current_work: "Editing `src/logn.ts` and `src/lgin.ts`." }) },
			{ output: ledgerJson({ current_work: "Editing `src/logn.ts`.", decisions: [{ decision: "Keep the cache", rationale: "faster", made_by: "user", source: "U1" }] }) },
		];
		const result = await writeLedger({
			log,
			runModel: async () => outputs.shift() ?? { error: "codex exited 1" },
			deadline: Date.now() + 60_000,
			retryDelayMs: 0,
		});
		expect(result.status).toBe("accepted-with-warnings");
		expect(result.markdown).toContain("- Keep the cache — faster (user's decision: U1)");
		expect(result.markdown).toContain("## Unverified points\n");
		expect(result.markdown).toContain("src/logn.ts");
		expect(result.markdown).toContain("## All user messages (verbatim)\n- [U1] 로그인 버그 고쳐줘.");
	});

	test("같은 수의 문제를 가진 시도 중 예산을 넘은 것이 섞이면 크기가 작은 시도를 채택한다", async () => {
		const attempt = (size: number) => ledgerJson({ current_work: "Editing `src/logn.ts`.", pending: ["x".repeat(size)] });
		const outputs: ModelResult[] = [{ output: attempt(3000) }, { output: attempt(1000) }, { output: attempt(6000) }];
		const result = await writeLedger({
			log,
			budget: 100,
			runModel: async () => outputs.shift() as ModelResult,
			deadline: Date.now() + 60_000,
			retryDelayMs: 0,
		});
		expect(result.status).toBe("accepted-with-warnings");
		expect(result.markdown).toContain("x".repeat(1000));
		expect(result.markdown).not.toContain("x".repeat(1001));
		expect(result.markdown).not.toContain("over budget");
	});

	test("이전 ledger의 확인 못 한 점이 결정 문장을 인용해도 그 결정 안의 식별자는 확인된 것으로 본다", async () => {
		const previousLedger =
			'# Session ledger\n\n## Decisions\n- Use `src/retry_queue.ts` for the retry queue — durable (user\'s decision: U1)\n\n## Unverified points\nThe validator could not verify these against the transcript; check them before relying on them:\n- these decisions are credited to the user (made_by user or agreed) but cite no user message: ["Use `src/retry_queue.ts` for the retry queue"]; cite the U-id\n\n## All user messages (verbatim)\n- [U1] 로그인 버그 고쳐줘.\n';
		const decision = { decision: "Use `src/retry_queue.ts` for the retry queue", rationale: "durable", made_by: "user" as const, source: "U1" };
		const result = await writeLedger({
			log,
			previousLedger,
			runModel: async () => ({ output: ledgerJson({ decisions: [decision] }) }),
			deadline: Date.now() + 60_000,
		});
		expect(result.status).toBe("accepted");
		expect(result.attempts[0].violations).toEqual([]);
	});

	test("같은 확인 못 한 점 목록에 식별자와 결정 문장이 함께 있으면 식별자만 계속 위반으로 잡는다", async () => {
		const previousLedger =
			'# Session ledger\n\n## Decisions\n- Use `src/retry_queue.ts` for the retry queue — durable (user\'s decision: U1)\n\n## Unverified points\nThe validator could not verify these against the transcript; check them before relying on them:\n- these decisions are credited to the user but cite no user message: ["Use `src/retry_queue.ts` for the retry queue"]\n- these code-formatted identifiers do not appear in the work log, so they are misspelled or invented: ["src/logn.ts"]\n\n## All user messages (verbatim)\n- [U1] 로그인 버그 고쳐줘.\n';
		const decision = { decision: "Use `src/retry_queue.ts` for the retry queue", rationale: "durable", made_by: "user" as const, source: "U1" };
		const outputs: ModelResult[] = [
			{ output: ledgerJson({ current_work: "Editing `src/logn.ts`.", decisions: [decision] }) },
			{ output: ledgerJson({ decisions: [decision] }) },
		];
		const result = await writeLedger({ log, previousLedger, runModel: async () => outputs.shift() as ModelResult, deadline: Date.now() + 60_000 });
		expect(result.attempts[0].violations).toEqual([expect.stringContaining("src/logn.ts")]);
		expect(result.attempts[0].violations?.join("\n")).not.toContain("retry_queue");
		expect(result.status).toBe("accepted");
	});

	test("출력 없이 끝난 호출은 같은 모델로 한 번 다시 부르고, 그래도 없으면 대체 모델로 넘어가 그 뒤 시도도 대체 모델로 한다", async () => {
		const calls: string[] = [];
		const codex = async (): Promise<ModelResult> => (calls.push("codex"), { error: "codex exited 1", model: "codex" });
		const claudeOutputs: ModelResult[] = [
			{ error: "claude exited 1", model: "claude" },
			{ output: ledgerJson({ current_work: "Editing `src/logn.ts`." }), model: "claude" },
			{ output: ledgerJson(), model: "claude" },
		];
		const claude = async (): Promise<ModelResult> => (calls.push("claude"), claudeOutputs.shift() as ModelResult);
		const result = await writeLedger({ log, runModel: codex, fallbackModel: claude, deadline: Date.now() + 60_000, retryDelayMs: 0 });
		expect(result.status).toBe("accepted");
		expect(calls).toEqual(["codex", "codex", "claude", "claude", "claude"]);
		expect(result.attempts.at(-1)?.model).toBe("claude");
	});

	test("대체 모델까지 다시 불러도 출력이 없으면 최소 ledger를 쓴다", async () => {
		let calls = 0;
		const down = async (): Promise<ModelResult> => (++calls, { error: "exited 1" });
		const result = await writeLedger({ log, runModel: down, fallbackModel: down, deadline: Date.now() + 60_000, retryDelayMs: 0 });
		expect(result.status).toBe("fallback");
		expect(calls).toBe(4);
	});

	test("이전 ledger가 확인 못 한 식별자는 그 ledger에 적혀 있어도 확인된 것으로 보지 않는다", async () => {
		const previousLedger =
			'# Session ledger\n\n## 2. Current work\nEditing `src/logn.ts`.\n\n## Unverified points\nThe validator could not verify these against the transcript; check them before relying on them:\n- these code-formatted identifiers do not appear in the work log, so they are misspelled or invented: ["src/logn.ts"]. Copy identifiers exactly from the log or remove them\n\n## All user messages (verbatim)\n- [U1] 로그인 버그 고쳐줘.\n';
		const outputs: ModelResult[] = [{ output: ledgerJson({ current_work: "Editing `src/logn.ts`." }) }, { output: ledgerJson() }];
		const result = await writeLedger({ log, previousLedger, runModel: async () => outputs.shift() as ModelResult, deadline: Date.now() + 60_000 });
		expect(result.status).toBe("accepted");
		expect(result.attempts[0].violations).toEqual([expect.stringContaining("src/logn.ts")]);
	});

	test("요약기가 아무 출력도 못 내면 이전 ledger와 모든 사용자 메시지를 이어받는 최소 ledger를 쓴다", async () => {
		const previousLedger =
			"# Session ledger\n\n## Decisions\n- Keep the cache — faster (user's decision: U1)\n\n## All user messages (verbatim)\n- [U1] 로그인 버그 고쳐줘.\n- [U2] 캐시는 유지해\n";
		const result = await writeLedger({
			log: { ...log, users: [{ id: "U3", text: "이제 배포해" }] },
			previousLedger,
			runModel: async () => ({ error: "codex not runnable", permanent: true }),
			deadline: Date.now() + 60_000,
		});
		expect(result.status).toBe("fallback");
		expect(result.attempts).toHaveLength(1);
		expect(result.markdown).toContain("codex not runnable");
		expect(result.markdown).toContain("- `src/login.ts`");
		expect(result.markdown).toContain("## Previous ledger (written at the previous compaction)\n## Decisions\n- Keep the cache");
		expect(previousUsers(result.markdown).map((u) => u.id)).toEqual(["U1", "U2", "U3"]);
	});

	test("전체 로그 모드에서도 디스크의 이전 ledger 결정을 fallback이 이어받는다", async () => {
		const home = tempDir();
		const transcript = join(home, "t.jsonl");
		writeFileSync(transcript, `${JSON.stringify(user("로그인 버그 고쳐줘."))}\n`);
		const path = ledgerPath("s-fb", home);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, "# Session ledger\n\n## Decisions\n- Keep the cache — faster (user's decision: U1)\n\n## All user messages (verbatim)\n- [U1] 캐시는 유지해\n");
		await preCompact(
			"claude",
			{ hook_event_name: "PreCompact", session_id: "s-fb", transcript_path: transcript },
			{ home, runModel: async () => ({ error: "codex not runnable", permanent: true }) },
		);
		const written = readFileSync(path, "utf8");
		expect(written).toStartWith("# Session ledger (fallback)");
		expect(written).toContain("- Keep the cache — faster");
	});

	test("fallback을 반복해도 크기가 늘지 않고 처음 실제 ledger의 결정을 유지한다", async () => {
		const real =
			"# Session ledger\n\n## Decisions\n- Keep the cache — faster (user's decision: U1)\n\n## All user messages (verbatim)\n- [U1] 캐시는 유지해\n";
		const down = async () => ({ error: "codex not runnable", permanent: true }) as ModelResult;
		let ledger = real;
		const sizes: number[] = [];
		for (let i = 0; i < 5; i++) {
			const result = await writeLedger({
				log: { ...log, assistants: [{ id: `A${i}`, text: `마지막 답변 ${i}` }], editedFiles: [`src/file${i}.ts`] },
				fallbackPreviousLedger: ledger,
				runModel: down,
				deadline: Date.now() + 60_000,
			});
			ledger = result.markdown;
			sizes.push(Buffer.byteLength(ledger));
		}
		expect(ledger).toContain("- Keep the cache — faster");
		expect(ledger.match(/# Session ledger/g)).toHaveLength(1);
		expect(ledger.match(/## Last assistant message/g)).toHaveLength(1);
		for (let i = 0; i < 5; i++) expect(ledger).toContain(`- \`src/file${i}.ts\``);
		// Each round adds one file line; no whole-fallback layer is added.
		expect(sizes[4] - sizes[3]).toBeLessThan(80);
	});

	test("fallback의 마지막 assistant 메시지는 약 3000바이트로 자른다", async () => {
		const result = await writeLedger({
			log: { ...log, assistants: [{ id: "A1", text: "가".repeat(5000) }] },
			runModel: async () => ({ error: "codex not runnable", permanent: true }),
			deadline: Date.now() + 60_000,
		});
		const section = result.markdown.split("## Last assistant message\n")[1].split("\n\n## Files edited")[0];
		expect(Buffer.byteLength(section)).toBeLessThan(3200);
		expect(section).toContain("bytes cut");
		expect(section).not.toContain("\uFFFD");
	});

	test("이전 ledger의 여러 줄 사용자 메시지를 이어받는다", () => {
		const previous = "## All user messages (verbatim)\n- [U1] 첫 줄\n둘째 줄\n- [U2] 좋아\n\n## Appendix: original text of approved proposals\n- [U9] 부록\n";
		expect(previousUsers(previous)).toEqual([
			{ id: "U1", text: "첫 줄\n둘째 줄" },
			{ id: "U2", text: "좋아" },
		]);
	});

	test("사용자 메시지 안의 마크다운 제목에서 파싱을 멈추지 않는다", () => {
		const previous = "## All user messages (verbatim)\n- [U1] 첫 요청\n- [U2] 이 문서 봐\n## Plan\nstep one\n- [U3] never push --force\n";
		expect(previousUsers(previous)).toEqual([
			{ id: "U1", text: "첫 요청" },
			{ id: "U2", text: "이 문서 봐\n## Plan\nstep one" },
			{ id: "U3", text: "never push --force" },
		]);
	});

	test("본문에 제목 문자열이 있어도 마지막 실제 사용자 섹션을 읽는다", () => {
		const previous =
			'# Session ledger\n\n## Files\n```ts\nconst USERS_HEADING = "## All user messages (verbatim)";\n```\nnote: ## All user messages (verbatim)\n\n## All user messages (verbatim)\n- [U1] 진짜 하나\n- [U2] 진짜 둘\n';
		expect(previousUsers(previous)).toEqual([
			{ id: "U1", text: "진짜 하나" },
			{ id: "U2", text: "진짜 둘" },
		]);
	});

	test("파일 맨 앞의 사용자 섹션 제목도 읽는다", () => {
		expect(previousUsers("## All user messages (verbatim)\n- [U1] 하나\n")).toEqual([{ id: "U1", text: "하나" }]);
	});

	test("번호가 커지지 않는 인용 줄은 새 사용자 메시지로 세지 않는다", () => {
		const previous = "## All user messages (verbatim)\n- [U1] 첫째\n- [U2] 이렇게 적혀 있었어:\n- [U1] 인용된 줄\n- [U2] 또 인용\n- [U3] 셋째\n";
		expect(previousUsers(previous)).toEqual([
			{ id: "U1", text: "첫째" },
			{ id: "U2", text: "이렇게 적혀 있었어:\n- [U1] 인용된 줄\n- [U2] 또 인용" },
			{ id: "U3", text: "셋째" },
		]);
	});

	test("이전 ledger 전체를 붙여넣은 사용자 메시지가 있어도 실제 메시지를 모두 되살린다", () => {
		const pasted = "# Session ledger\n\n## All user messages (verbatim)\n- [U6] 붙여넣은 여섯째\n- [U7] 붙여넣은 일곱째\n둘째 줄";
		const users = [
			{ id: "U1", text: "하나" },
			{ id: "U2", text: `이전 ledger야:\n${pasted}` },
			{ id: "U3", text: "셋" },
		];
		expect(previousUsers(renderLedger(ledgerJson(), users))).toEqual(users);
		expect(previousUsers(fallbackLedger(log, users, "test"))).toEqual(users);
	});

	test("제목 줄과 앞 공백 줄이 있는 메시지가 왕복 후에도 바이트 단위로 같다", () => {
		const users = [{ id: "U1", text: "## 제목\n  들여쓴 줄\n    더 들여쓴 줄\n\n- [U1] 인용\n마지막" }];
		expect(previousUsers(renderLedger(ledgerJson(), users))).toEqual(users);
	});

	test("이어지는 줄을 들여쓰지 않은 옛 형식 ledger도 그대로 읽는다", () => {
		const previous = "# Session ledger\n\n## All user messages (verbatim)\n- [U1] 첫 줄\n둘째 줄\n\n넷째 줄\n- [U2] 좋아\n";
		expect(previousUsers(previous)).toEqual([
			{ id: "U1", text: "첫 줄\n둘째 줄\n\n넷째 줄" },
			{ id: "U2", text: "좋아" },
		]);
	});
});

describe("훅 진입점", () => {
	test("크기가 작은 세션은 이전 ledger가 있어도 전체를 한 번에 요약한다", () => {
		const records = [user("첫 요청"), { type: "system", subtype: "compact_boundary" }, user("둘째 요청")];
		const selected = selectLog("claude", records, "# previous");
		expect(selected.previousLedger).toBeUndefined();
		expect(selected.log.users.map((u) => u.id)).toEqual(["U1", "U2"]);
	});

	test("PreCompact는 ledger와 meta를 세션 id 파일에 쓴다", async () => {
		const home = tempDir();
		const transcript = join(home, "t.jsonl");
		writeFileSync(transcript, `${JSON.stringify(user("로그인 버그 고쳐줘."))}\n`);
		const path = await preCompact(
			"claude",
			{ hook_event_name: "PreCompact", session_id: "s-1", transcript_path: transcript },
			{ home, runModel: async () => ({ output: ledgerJson({ current_work: "Working." }) }) },
		);
		expect(path).toBe(ledgerPath("s-1", home));
		expect(readFileSync(path as string, "utf8")).toStartWith("# Session ledger");
		expect(JSON.parse(readFileSync(join(home, ".omt", "session-ledger", "s-1.meta.json"), "utf8")).status).toBe("accepted");
	});

	test("SessionStart는 compaction 직후에만 주입하고, 긴 ledger는 앞부분과 전체 읽기 지시를 준다", () => {
		const home = tempDir();
		const path = ledgerPath("s-2", home);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, `# Session ledger\n${"line\n".repeat(3000)}`);
		expect(sessionStartContext("claude", { source: "startup", session_id: "s-2" }, home)).toBeNull();
		const context = sessionStartContext("codex", { source: "compact", session_id: "s-2" }, home) as string;
		expect(context).toContain(`read the whole ledger file with a file-read command, to its last line: ${path}`);
		expect(context).not.toMatch(/approv|confirm/i);
		expect(Buffer.byteLength(context)).toBeLessThan(6000);
	});

	test("앞부분 자르기는 줄 경계에서 멈춘다", () => {
		expect(headOf("aaa\nbbb\nccc", 8)).toEqual({ head: "aaa\nbbb", truncated: true });
	});

	test("요약기 하위 세션과 서브에이전트 세션에서는 아무것도 하지 않는다", () => {
		const home = tempDir();
		const run = (env: Record<string, string>, input: Record<string, unknown>) =>
			spawnSync("bun", ["run", join(import.meta.dir, "index.ts")], {
				input: JSON.stringify(input),
				encoding: "utf8",
				env: { ...process.env, HOME: home, ...env },
			});
		const ledger = ledgerPath("s-3", home);
		mkdirSync(join(ledger, ".."), { recursive: true });
		writeFileSync(ledger, "# Session ledger\n");
		const start = { hook_event_name: "SessionStart", source: "compact", session_id: "s-3" };
		expect(run({}, start).stdout).toContain("[SESSION LEDGER]");
		expect(run({ OMT_LEDGER_WORKER: "1" }, start).stdout).toBe("");
		expect(run({}, { ...start, agent_id: "sub" }).stdout).toBe("");
		expect(existsSync(ledger)).toBe(true);
	});
});
