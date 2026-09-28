import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractClaude, extractCodex, outputExcerpt } from "./extract.ts";
import { headOf, ledgerPath, preCompact, selectLog, sessionStartContext } from "./index.ts";
import {
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
		next_steps: [
			{ step: "Run the tests", authorized_by: "U1", authorization_quote: "로그인 버그 고쳐줘", needs_user_confirmation: false },
		],
		working_rules: [],
		approved_proposals: [],
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
	test("정상 출력은 위반이 없고, 끝 문장부호가 빠진 인용도 통과한다", () => {
		expect(validateLedger(ledgerJson(), ctx())).toEqual([]);
	});

	test("인용한 사용자 메시지에 없는 인용은 원문을 보여 주며 거부한다", () => {
		const d = ledgerJson({
			decisions: [{ decision: "d", rationale: "r", decided_by: "U1", user_quote: "승인한다" }],
		});
		const [violation] = validateLedger(d, ctx());
		expect(violation).toContain("not found in the cited user message");
		expect(violation).toContain('U1 says: "로그인 버그 고쳐줘."');
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

	test("로그에 없는 문자 체계가 섞여 깨진 경로는 거부하고, 한글 설명은 허용한다", () => {
		const source = "cd /repo/기존-프로그램-문제/apps && cat slot-distribution.ts";
		const text = (current_work: string) => unknownIdentifiers(ledgerJson({ current_work }), source);
		expect(text("Open `/repo/기존-프로그램-խնդիր/apps/slot-distribution.ts`.")).toEqual([
			"/repo/기존-프로그램-խնդիր/apps/slot-distribution.ts",
		]);
		expect(text("다음으로 `/repo/기존-프로그램-문제/apps/slot-distribution.ts`를 수정한다.")).toEqual([]);
	});

	test("다음 단계는 승인을 단정하지 않고 인용한 사용자 문구를 보여준다", () => {
		const markdown = renderLedger(ledgerJson(), [], new Map());
		expect(markdown).toContain('1. Run the tests. Approval cited: U1 "로그인 버그 고쳐줘".');
		expect(markdown).not.toContain("No further confirmation needed");
	});

	test("승인 근거 없이 확인 불필요로 표시한 다음 단계는 거부한다", () => {
		const step = { step: "Run the deploy", authorized_by: "", authorization_quote: "", needs_user_confirmation: false };
		const violations = validateLedger(ledgerJson({ next_steps: [step] }), ctx());
		expect(violations.some((x) => x.includes("without authorized_by"))).toBe(true);
		const asking = validateLedger(ledgerJson({ next_steps: [{ ...step, needs_user_confirmation: true }] }), ctx());
		expect(asking.some((x) => x.includes("without authorized_by"))).toBe(false);
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

	test("존재하지 않는 U-id와 제안 id를 거부한다", () => {
		const d = ledgerJson({
			approved_proposals: [
				{
					proposal_id: "A9",
					approved_by: "U7",
					approval_quote: "좋아",
					approved_scope: "all",
					excluded_or_changed: [],
					done: [],
					remaining: ["x"],
				},
			],
		});
		const violations = validateLedger(d, ctx()).join("\n");
		expect(violations).toContain('unknown assistant ids ["A9"]');
		expect(violations).toContain('unknown user-message ids ["U7"]');
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

	test("모든 시도가 예산만 넘으면 가장 작은 시도를 채택한다", async () => {
		const sizes = [3000, 2000, 2500];
		const result = await writeLedger({
			log,
			budget: 100,
			runModel: async () => ({ output: ledgerJson({ pending: ["x".repeat(sizes.shift() as number)] }) }),
			deadline: Date.now() + 60_000,
		});
		expect(result.status).toBe("accepted-over-budget");
		expect(result.markdown).toContain(`- ${"x".repeat(2000)}\n`);
	});

	test("요약기를 실행할 수 없으면 결정론적 최소 ledger를 쓴다", async () => {
		const result = await writeLedger({
			log,
			runModel: async () => ({ error: "codex not runnable" }),
			deadline: Date.now() + 60_000,
		});
		expect(result.status).toBe("fallback");
		expect(result.markdown).toContain("codex not runnable");
		expect(result.markdown).toContain("- `src/login.ts`");
		expect(result.markdown).toContain("- [U1] 로그인 버그 고쳐줘.");
	});

	test("승인된 제안은 남은 작업이 있을 때만 원문을 부록으로 붙인다", () => {
		const proposal = (remaining: string[]) => ({
			proposal_id: "A1",
			approved_by: "U1",
			approval_quote: "고쳐줘",
			approved_scope: "all",
			excluded_or_changed: [],
			done: [],
			remaining,
		});
		const assistants = new Map([["A1", "1. 재시도 2. 캐시"]]);
		expect(renderLedger(ledgerJson({ approved_proposals: [proposal(["2"])] }), [], assistants)).toContain("> 1. 재시도 2. 캐시");
		expect(renderLedger(ledgerJson({ approved_proposals: [proposal([])] }), [], assistants)).not.toContain("Appendix");
	});

	test("이전 ledger의 여러 줄 사용자 메시지를 이어받는다", () => {
		const previous = "## All user messages (verbatim)\n- [U1] 첫 줄\n둘째 줄\n- [U2] 좋아\n\n## Appendix: x\n";
		expect(previousUsers(previous)).toEqual([
			{ id: "U1", text: "첫 줄\n둘째 줄" },
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
