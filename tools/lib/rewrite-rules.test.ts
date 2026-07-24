import { describe, it, expect } from "bun:test";
import {
	applyRewriteRules,
	bakeSkillDirToken,
	BROAD_DETECTORS,
	KEEP_IDENTICAL_TOKENS,
	OUT_OF_SCOPE_TOKENS,
	PLATFORM_REWRITE_RULES,
	SKILL_DIR_TOKEN,
} from "./rewrite-rules.ts";

// Fixture containing (at least) one occurrence of every family in the codex
// table: S, 17, 17b, 4, 4b, 5, 6a, 6b, 7, 8, 9, 10, 11, 12, 13, 14p, 14, 1, 2, 3.
const CODEX_FIXTURE_LINES = [
	"~/.claude/skills/hud/catalog.ts",
	".claude/skills/goal/SKILL.md",
	"~/.claude/hooks/session-start.sh",
	".claude/agents/oracle.md",
	"See ~/.claude] for config (bracket notation, no trailing slash)",
	"Read `./.claude/settings.json` for config",
	"See CLAUDE.md for repository overview.",
	"Skill(humanizer)",
	'Skill(skill: "sisyphus")',
	'Skill("test-driven-development")',
	'Skill(skill: "${entry.name}")',
	"MUST invoke via Skill()",
	"WebFetch call forbidden",
	"Run a WebSearch query",
	"Never use the TaskOutput tool.",
	"TaskCreate a todo",
	"Agent(explore)",
	"subagent_type: explore",
	"MultiEdit(file_path, edits)",
	"AskUserQuestion to gather input",
	"asking too many AskUserQuestions will tire the user",
	"$CLAUDE_CONFIG_DIR",
	"$CLAUDE_ENV_FILE",
	"$CLAUDE_PROJECT_DIR",
	'Task(subagent_type="explore")',
	"dispatch via the Task tool",
];
const CODEX_FIXTURE = CODEX_FIXTURE_LINES.join("\n");

describe("PLATFORM_REWRITE_RULES.claude", () => {
	it("빈 배열이다 — Claude 바이트 불변성(G4-10)의 구조적 근거", () => {
		expect(PLATFORM_REWRITE_RULES.claude).toEqual([]);
	});

	it("`applyRewriteRules`를 codex 전 토큰이 담긴 fixture에 적용해도 내용이 바뀌지 않는다", () => {
		expect(applyRewriteRules(CODEX_FIXTURE, PLATFORM_REWRITE_RULES.claude)).toBe(CODEX_FIXTURE);
	});
});

describe("PLATFORM_REWRITE_RULES.gemini / opencode", () => {
	it("gemini는 `.claude/` -> `.gemini/` 단일 규칙만 보존한다", () => {
		expect(PLATFORM_REWRITE_RULES.gemini.length).toBe(1);
		expect(applyRewriteRules(".claude/skills/x", PLATFORM_REWRITE_RULES.gemini)).toBe(
			".gemini/skills/x",
		);
	});

	it("opencode는 `.claude/` -> `.opencode/` 단일 규칙만 보존한다", () => {
		expect(PLATFORM_REWRITE_RULES.opencode.length).toBe(1);
		expect(applyRewriteRules(".claude/skills/x", PLATFORM_REWRITE_RULES.opencode)).toBe(
			".opencode/skills/x",
		);
	});
});

describe("applyRewriteRules — 멱등성 및 상태성", () => {
	it("codex 테이블 전 가족이 담긴 fixture에 대해 apply(apply(x)) === apply(x)", () => {
		const once = applyRewriteRules(CODEX_FIXTURE, PLATFORM_REWRITE_RULES.codex);
		const twice = applyRewriteRules(once, PLATFORM_REWRITE_RULES.codex);
		expect(twice).toBe(once);
	});

	it("동일 rules 배열로 동일 input에 대해 두 번 호출해도 같은 결과를 반환한다 (lastIndex 트랩)", () => {
		const first = applyRewriteRules(CODEX_FIXTURE, PLATFORM_REWRITE_RULES.codex);
		const second = applyRewriteRules(CODEX_FIXTURE, PLATFORM_REWRITE_RULES.codex);
		expect(second).toBe(first);
	});

	it("공유 규칙 객체의 detect에 대해 사전에 `.test()`를 호출해 lastIndex를 흘려도 결과가 동일하다", () => {
		const rule = PLATFORM_REWRITE_RULES.codex.find((r) => r.id === "4");
		expect(rule).toBeDefined();
		// lastIndex를 임의로 전진시켜 흘림 상태를 시뮬레이션한다.
		rule!.detect.test(".claude/skills/probe");

		const withProbe = applyRewriteRules(CODEX_FIXTURE, PLATFORM_REWRITE_RULES.codex);
		const clean = applyRewriteRules(CODEX_FIXTURE, PLATFORM_REWRITE_RULES.codex);
		expect(withProbe).toBe(clean);
	});
});

describe("codex 규칙 순서 — S -> 17 -> 4", () => {
	it('"~/.claude/skills/hud" -> "~/.agents/skills/hud" (NOT "~/.codex/skills/hud")', () => {
		const result = applyRewriteRules("~/.claude/skills/hud", PLATFORM_REWRITE_RULES.codex);
		expect(result).toBe("~/.agents/skills/hud");
		expect(result).not.toBe("~/.codex/skills/hud");
	});

	it('".claude/skills/goal" -> ".agents/skills/goal"', () => {
		expect(applyRewriteRules(".claude/skills/goal", PLATFORM_REWRITE_RULES.codex)).toBe(
			".agents/skills/goal",
		);
	});

	it('"~/.claude/hooks/x.sh" -> "~/.codex/hooks/x.sh"', () => {
		expect(applyRewriteRules("~/.claude/hooks/x.sh", PLATFORM_REWRITE_RULES.codex)).toBe(
			"~/.codex/hooks/x.sh",
		);
	});

	it('".claude/agents/oracle.md" -> ".codex/agents/oracle.md"', () => {
		expect(applyRewriteRules(".claude/agents/oracle.md", PLATFORM_REWRITE_RULES.codex)).toBe(
			".codex/agents/oracle.md",
		);
	});
});

describe("codex 규칙 6a — `Skill(` 형태는 Codex mention sigil `$name`로 치환된다", () => {
	it('정규형 \'Skill(skill: "sisyphus")\' -> "$sisyphus" (19건 형태)', () => {
		expect(applyRewriteRules('Skill(skill: "sisyphus")', PLATFORM_REWRITE_RULES.codex)).toBe(
			"$sisyphus",
		);
	});

	it('bare name "Skill(humanizer)" -> "$humanizer" (25건 형태, prefix 없음)', () => {
		expect(applyRewriteRules("Skill(humanizer)", PLATFORM_REWRITE_RULES.codex)).toBe(
			"$humanizer",
		);
	});

	it('따옴표만 \'Skill("test-driven-development")\' -> "$test-driven-development" (2건 형태, skill: prefix 없음)', () => {
		expect(
			applyRewriteRules('Skill("test-driven-development")', PLATFORM_REWRITE_RULES.codex),
		).toBe("$test-driven-development");
	});

	it('하이픈 포함 정규형 \'Skill(skill: "test-driven-development")\' -> "$test-driven-development" (3건 형태)', () => {
		expect(
			applyRewriteRules('Skill(skill: "test-driven-development")', PLATFORM_REWRITE_RULES.codex),
		).toBe("$test-driven-development");
	});

	it('플레이스홀더 \'Skill(skill: "{chosen}")\' -> "${chosen}" (skills/deep-interview/SKILL.md:505 실제 캐리어)', () => {
		expect(applyRewriteRules('Skill(skill: "{chosen}")', PLATFORM_REWRITE_RULES.codex)).toBe(
			"${chosen}",
		);
	});

	it('리터럴 힌트 플레이스홀더 \'Skill(skill: "...")\' -> "$..." (skills/meeting-notes/SKILL.md:103 실제 캐리어)', () => {
		expect(applyRewriteRules('Skill(skill: "...")', PLATFORM_REWRITE_RULES.codex)).toBe("$...");
	});

	it('JS 템플릿 리터럴 안의 `Skill(skill: "${entry.name}")` -> "$${entry.name}" (skills/sisyphus/hooks/skill-catalog/catalog.ts:201) — 템플릿 리터럴 보간과 합쳐져 최종 "$humanizer" 등으로 렌더되므로 의도된 정상 동작', () => {
		expect(
			applyRewriteRules('Skill(skill: "${entry.name}")', PLATFORM_REWRITE_RULES.codex),
		).toBe("$${entry.name}");
	});

	it('출력이 리터럴 `$`로 시작한다 (String.replace `$` 이스케이프 회귀 고정: `"$1"`은 `$`를 방출하지 않고 `"$$1"`은 리터럴 `$1`을 방출하므로 `"$$$1"`만 정답)', () => {
		const result = applyRewriteRules("Skill(sisyphus)", PLATFORM_REWRITE_RULES.codex);
		expect(result.startsWith("$")).toBe(true);
		expect(result).toBe("$sisyphus");
	});

	it('"Skill()" -> "skill invocation" (규칙 6b, 무회귀)', () => {
		expect(applyRewriteRules("Skill()", PLATFORM_REWRITE_RULES.codex)).toBe("skill invocation");
	});

	it('음성 대조군: 영어 산문 "## GREEN Phase: Write Minimal Skill (Make It Pass)"는 치환되지 않고 그대로 남는다 (skills/writing-skills/testing-skills-with-subagents.md:82) — `\\bSkill\\(`는 공백을 허용하지 않으므로 "Skill ("은 매치되지 않는다', () => {
		const line = "## GREEN Phase: Write Minimal Skill (Make It Pass)";
		expect(applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex)).toBe(line);
	});

	it('음성 대조군: 영어 산문 "name of the Skill (64 characters maximum)"는 치환되지 않고 그대로 남는다 (skills/writing-skills/anthropic-best-practices.md:149)', () => {
		const line = "name of the Skill (64 characters maximum)";
		expect(applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex)).toBe(line);
	});

	it("AC4 — Claude 무회귀: PLATFORM_REWRITE_RULES.claude에 대해서는 Skill(...) 호출이 바이트 동일하게 그대로 반환된다", () => {
		const input = 'Skill(skill: "sisyphus")';
		expect(applyRewriteRules(input, PLATFORM_REWRITE_RULES.claude)).toBe(input);
	});

	it('인자 동반 형태 \'Skill(skill: "testing", args: "auth only")\' -> "$testing auth only" (인자를 프로즈로 보존한다 — 조용히 소실되던 결함 수정)', () => {
		expect(
			applyRewriteRules(
				'Skill(skill: "testing", args: "auth only")',
				PLATFORM_REWRITE_RULES.codex,
			),
		).toBe("$testing auth only");
	});

	it('인자 값에 괄호가 있어도 균형을 유지한다: \'Skill(skill: "testing", args: "review (draft)")\' -> "$testing review (draft)" (괄호 불균형으로 깨진 조각 "$testing\\")"이 남던 결함 수정)', () => {
		expect(
			applyRewriteRules(
				'Skill(skill: "testing", args: "review (draft)")',
				PLATFORM_REWRITE_RULES.codex,
			),
		).toBe("$testing review (draft)");
	});

	it("인자 동반 형태 apply(apply(x)) === apply(x) — 멱등성", () => {
		const once = applyRewriteRules(
			'Skill(skill: "testing", args: "auth only")',
			PLATFORM_REWRITE_RULES.codex,
		);
		const twice = applyRewriteRules(once, PLATFORM_REWRITE_RULES.codex);
		expect(twice).toBe(once);
	});

	it('회귀 고정: 무인자 정규형 \'Skill(skill: "sisyphus")\' -> "$sisyphus" (인자 지원 추가가 무인자 형태를 깨뜨리지 않는다)', () => {
		expect(applyRewriteRules('Skill(skill: "sisyphus")', PLATFORM_REWRITE_RULES.codex)).toBe(
			"$sisyphus",
		);
	});

	it('회귀 고정: 플레이스홀더 \'Skill(skill: "{chosen}")\' -> "${chosen}" (인자 파싱과 혼동되지 않는다)', () => {
		expect(applyRewriteRules('Skill(skill: "{chosen}")', PLATFORM_REWRITE_RULES.codex)).toBe(
			"${chosen}",
		);
	});
});

describe("codex 규칙 — `Agent(`는 자신의 출력을 재매칭하지 않는다", () => {
	it('"Agent(explore)" -> "spawn_agent(explore)"이고 재적용해도 변하지 않는다', () => {
		const once = applyRewriteRules("Agent(explore)", PLATFORM_REWRITE_RULES.codex);
		expect(once).toBe("spawn_agent(explore)");

		const twice = applyRewriteRules(once, PLATFORM_REWRITE_RULES.codex);
		expect(twice).toBe(once);
	});
});

describe("codex 규칙 11a — bare `Task(`는 `spawn_agent(`로 치환된다 (skills/clarify/SKILL.md:150 실제 캐리어)", () => {
	it('"Task(subagent_type=\\"explore\\", prompt=\\"...\\")" -> "spawn_agent(subagent_type=\\"explore\\", prompt=\\"...\\")"', () => {
		expect(
			applyRewriteRules('Task(subagent_type="explore", prompt="...")', PLATFORM_REWRITE_RULES.codex),
		).toBe('spawn_agent(agent_type="explore", prompt="...")');
	});

	it("재적용해도 값이 변하지 않는다 (고정점)", () => {
		const once = applyRewriteRules("Task(explore)", PLATFORM_REWRITE_RULES.codex);
		expect(once).toBe("spawn_agent(explore)");
		const twice = applyRewriteRules(once, PLATFORM_REWRITE_RULES.codex);
		expect(twice).toBe(once);
	});

	it('음성 대조군: "TaskOutput("·"TaskCreate("처럼 Task 뒤에 다른 식별자가 이어지는 형태는 매치되지 않는다 (rule 9/10의 bareword 매치를 훔치지 않음)', () => {
		expect(applyRewriteRules("Never use the TaskOutput tool.", PLATFORM_REWRITE_RULES.codex)).toBe(
			"Never use the subagent transcript read tool.",
		);
		expect(applyRewriteRules("TaskCreate a todo", PLATFORM_REWRITE_RULES.codex)).toBe(
			"update_plan a todo",
		);
	});
});

describe("codex 규칙 7b — `run_in_background`는 능력 명사로 치환된다 (Codex 셸 도구에 그 파라미터가 없음)", () => {
	it('"run_in_background=true" -> "background execution" (skills/insane-browsing 실제 캐리어 형태)', () => {
		expect(
			applyRewriteRules("engine은 `run_in_background=true`로 Bash 툴에서 띄워둔다", PLATFORM_REWRITE_RULES.codex),
		).toBe("engine은 `background execution`로 Bash 툴에서 띄워둔다");
	});

	it("처방 문장에서 실행 가능한 지시로 남는다 (skills/qa 실제 캐리어)", () => {
		expect(
			applyRewriteRules("it MUST be launched with `run_in_background`, OR with a trailing `&`", PLATFORM_REWRITE_RULES.codex),
		).toBe("it MUST be launched with `background execution`, OR with a trailing `&`");
	});

	it("금지 문장에서도 의미가 보존된다 — 실제 도구명을 넣으면 과잉 해석될 자리 (rules/tool-usage-policy 실제 캐리어)", () => {
		expect(applyRewriteRules("`run_in_background` is prohibited.", PLATFORM_REWRITE_RULES.codex)).toBe(
			"`background execution` is prohibited.",
		);
	});

	it("재적용해도 값이 변하지 않는다 (고정점)", () => {
		const once = applyRewriteRules("run_in_background", PLATFORM_REWRITE_RULES.codex);
		expect(once).toBe("background execution");
		expect(applyRewriteRules(once, PLATFORM_REWRITE_RULES.codex)).toBe(once);
	});

	it("음성 대조군: 더 긴 식별자의 접두사로 나타나면 매치되지 않는다 (가드가 항상 걸리는 무효 가드가 아님)", () => {
		expect(applyRewriteRules("run_in_background_mode", PLATFORM_REWRITE_RULES.codex)).toBe(
			"run_in_background_mode",
		);
	});
});

describe('codex 규칙 11b — "Task tool" 산문은 "spawn_agent tool"로 치환된다 (skills/code-review, skills/review-report 실제 캐리어)', () => {
	it('"via the Task tool" -> "via the spawn_agent tool"', () => {
		expect(applyRewriteRules("via the Task tool", PLATFORM_REWRITE_RULES.codex)).toBe(
			"via the spawn_agent tool",
		);
	});

	it("`subagent_type`과 같은 줄에 있어도 두 규칙이 서로를 방해하지 않는다 (실제 캐리어 형태)", () => {
		const line = 'dispatch via the Task tool (`subagent_type: "code-reviewer"`)';
		const result = applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex);
		expect(result).toBe('dispatch via the spawn_agent tool (`agent_type: "code-reviewer"`)');
	});

	it("재적용해도 값이 변하지 않는다 (고정점)", () => {
		const once = applyRewriteRules("via the Task tool", PLATFORM_REWRITE_RULES.codex);
		const twice = applyRewriteRules(once, PLATFORM_REWRITE_RULES.codex);
		expect(twice).toBe(once);
	});
});

describe("codex 규칙 11a/11b — 리터럴 `\\n` DOT 라벨 이스케이프 직후에도 커버된다 (rule 14/14p와 동일한 `\\b` 사각지대 방어)", () => {
	it('DOT 라벨 리터럴 \\n 직후의 "Task(" — 회귀 시 uncovered로 노출되어야 할 형태가 rule 11a로 커버된다: \'label="x:\\\\nTask("\' -> \'label="x:\\\\nspawn_agent("\'', () => {
		const line = String.raw`label="x:\nTask("`;
		expect(applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex)).toBe(
			String.raw`label="x:\nspawn_agent("`,
		);
	});

	it('DOT 라벨 리터럴 \\n 직후의 "Task tool" — rule 11b로 커버된다: \'x:\\\\nTask tool\' -> \'x:\\\\nspawn_agent tool\'', () => {
		const line = String.raw`x:\nTask tool`;
		expect(applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex)).toBe(
			String.raw`x:\nspawn_agent tool`,
		);
	});
});

describe("codex 규칙 9 — `TaskOutput`는 절대 `update_plan`을 방출하지 않는다", () => {
	it('"Never use the TaskOutput tool."의 출력에 "update_plan"이 포함되지 않는다', () => {
		const result = applyRewriteRules(
			"Never use the TaskOutput tool.",
			PLATFORM_REWRITE_RULES.codex,
		);
		expect(result).not.toContain("update_plan");
	});
});

describe("bakeSkillDirToken", () => {
	it("SKILL_DIR_TOKEN을 절대 스킬 디렉터리 경로로 치환한다", () => {
		const content = `bun ${SKILL_DIR_TOKEN}/scripts/job.ts`;
		expect(bakeSkillDirToken(content, "/home/u/.agents/skills/goal")).toBe(
			"bun /home/u/.agents/skills/goal/scripts/job.ts",
		);
	});

	it("토큰이 없으면 원본 문자열을 그대로 반환한다", () => {
		const content = "bun scripts/job.ts";
		expect(bakeSkillDirToken(content, "/home/u/.agents/skills/goal")).toBe(content);
	});

	it("두 번 호출해도 같은 결과를 반환한다 (토큰이 소거된 이후 재매칭 없음)", () => {
		const content = `bun ${SKILL_DIR_TOKEN}/scripts/job.ts`;
		const once = bakeSkillDirToken(content, "/home/u/.agents/skills/goal");
		const twice = bakeSkillDirToken(once, "/home/u/.agents/skills/goal");
		expect(twice).toBe(once);
	});
});

describe("BROAD_DETECTORS — 완결성 넷은 공허하지 않다", () => {
	function matches(name: string, input: string): boolean {
		const detector = BROAD_DETECTORS.find((d) => d.name === name);
		expect(detector).toBeDefined();
		const re = new RegExp(detector!.detect.source, detector!.detect.flags);
		return re.test(input);
	}

	it("claude-env — 적어도 하나의 문자열에 매치한다", () => {
		expect(matches("claude-env", "CLAUDE_UNKNOWN_ENV")).toBe(true);
	});

	it("claude-path — 적어도 하나의 문자열에 매치한다", () => {
		expect(matches("claude-path", ".claude/skills/foo")).toBe(true);
	});

	it("claude-tool — 적어도 하나의 문자열에 매치한다", () => {
		expect(matches("claude-tool", "TaskOutput")).toBe(true);
	});

	it('claude-tool — bare "Task("(괄호형 호출)에도 매치한다', () => {
		expect(matches("claude-tool", 'Task(subagent_type="explore")')).toBe(true);
	});

	it('claude-tool — "Task tool" 산문에도 매치한다', () => {
		expect(matches("claude-tool", "dispatch via the Task tool")).toBe(true);
	});

	it('음성 대조군: "getInProgressTask(tasks)"처럼 식별자 접미로 이어지는 "Task("는 매치되지 않는다 (skills/hud/scripts/state.ts:60 형태, \\b 경계 없음)', () => {
		expect(matches("claude-tool", "getInProgressTask(tasks)")).toBe(false);
	});

	it('음성 대조군: "Task tool"이 없는 평범한 문장은 매치되지 않는다', () => {
		expect(matches("claude-tool", "dispatch via the subagent mechanism")).toBe(false);
	});

	it("claude-model — 적어도 하나의 문자열에 매치한다", () => {
		expect(matches("claude-model", "model: opus\n")).toBe(true);
	});

	it("CLAUDE_UNKNOWN_ENV는 claude-env에 매치하지만 codex 테이블의 어떤 규칙도 커버하지 않는다", () => {
		const codexRules = PLATFORM_REWRITE_RULES.codex;
		const coveredByAnyRule = codexRules.some((rule) => {
			const re = new RegExp(rule.detect.source, rule.detect.flags);
			return re.test("CLAUDE_UNKNOWN_ENV");
		});
		expect(coveredByAnyRule).toBe(false);
		expect(matches("claude-env", "CLAUDE_UNKNOWN_ENV")).toBe(true);
	});
});

describe("BROAD_DETECTORS — 리터럴 `\\n` DOT 라벨 이스케이프 직후에도 매치한다 (규칙 14/14p와 동일한 `\\b` 사각지대를 net도 공유했으므로 fail-loud화)", () => {
	function matches(name: string, input: string): boolean {
		const detector = BROAD_DETECTORS.find((d) => d.name === name);
		expect(detector).toBeDefined();
		const re = new RegExp(detector!.detect.source, detector!.detect.flags);
		return re.test(input);
	}

	it('claude-tool — 리터럴 \\n 직후의 "MultiEdit"에 매치한다: label="x:\\nMultiEdit"', () => {
		expect(matches("claude-tool", 'label="x:\\nMultiEdit"')).toBe(true);
	});

	it('claude-tool — 리터럴 \\n 직후의 "TaskWatcher"에 매치한다: x:\\nTaskWatcher', () => {
		expect(matches("claude-tool", "x:\\nTaskWatcher")).toBe(true);
	});

	it('claude-tool — 리터럴 \\n 직후의 "Agent("에 매치한다: phase:\\nAgent("', () => {
		expect(matches("claude-tool", 'phase:\\nAgent("')).toBe(true);
	});

	it('claude-env — 리터럴 \\n 직후의 "CLAUDE_ENV_FILE"에 매치한다: x:\\nCLAUDE_ENV_FILE', () => {
		expect(matches("claude-env", "x:\\nCLAUDE_ENV_FILE")).toBe(true);
	});

	it('claude-path — 리터럴 \\n 직후의 "CLAUDE.md"에 매치한다: x:\\nCLAUDE.md', () => {
		expect(matches("claude-path", "x:\\nCLAUDE.md")).toBe(true);
	});

	it("공백 구분 형태는 수정 전후 모두 매치한다 (회귀 없음)", () => {
		expect(matches("claude-tool", "x: MultiEdit")).toBe(true);
		expect(matches("claude-env", "x: CLAUDE_ENV_FILE")).toBe(true);
		expect(matches("claude-path", "x: CLAUDE.md")).toBe(true);
	});
});

describe("codex 규칙 — Hole A: `$CLAUDE_CONFIG_DIR` -> `$CODEX_HOME`", () => {
	it('"$CLAUDE_CONFIG_DIR" -> "$CODEX_HOME"', () => {
		expect(applyRewriteRules("$CLAUDE_CONFIG_DIR", PLATFORM_REWRITE_RULES.codex)).toBe(
			"$CODEX_HOME",
		);
	});

	it("실제 캐리어 라인(deep-interview/SKILL.md, code-review/SKILL.md)에서 CONFIG_DIR과 bracket 표기, settings.json -> config.toml이 함께 정정된다", () => {
		const line =
			"Read `[$CLAUDE_CONFIG_DIR|~/.claude]/settings.json` and `./.claude/settings.json` (project overrides user)";
		const result = applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex);
		expect(result).toBe(
			"Read `[$CODEX_HOME|~/.codex]/config.toml` and `./.codex/config.toml` (project overrides user)",
		);
	});
});

describe("codex 규칙 — Hole B: `~/.claude]`(트레일링 슬래시 없음) -> `~/.codex`, 순서 17 이후", () => {
	it('"~/.claude]/settings.json" -> "~/.codex]/config.toml" (4b가 뒤이어 파일명까지 정정)', () => {
		expect(
			applyRewriteRules("~/.claude]/settings.json", PLATFORM_REWRITE_RULES.codex),
		).toBe("~/.codex]/config.toml");
	});

	it('새 규칙이 "~/.claude/skills/hud" -> "~/.agents/skills/hud" 매치를 훔치지 않는다 (회귀)', () => {
		const result = applyRewriteRules("~/.claude/skills/hud", PLATFORM_REWRITE_RULES.codex);
		expect(result).toBe("~/.agents/skills/hud");
		expect(result).not.toBe("~/.codex/skills/hud");
	});

	it('새 규칙이 "~/.claude/hooks/x" -> "~/.codex/hooks/x" 매치를 훔치지 않는다 (회귀)', () => {
		expect(applyRewriteRules("~/.claude/hooks/x", PLATFORM_REWRITE_RULES.codex)).toBe(
			"~/.codex/hooks/x",
		);
	});
});

describe("codex 규칙 4b — `.codex/settings.json` -> `.codex/config.toml` (실제로 존재하지 않는 Codex 설정 경로 결함)", () => {
	it('".codex/settings.json" (rule 4가 만든 중간 산출물) -> ".codex/config.toml"', () => {
		expect(applyRewriteRules(".codex/settings.json", PLATFORM_REWRITE_RULES.codex)).toBe(
			".codex/config.toml",
		);
	});

	it('원본 "./.claude/settings.json" -> "./.codex/config.toml" (rule 4 + 4b 합성)', () => {
		expect(applyRewriteRules("./.claude/settings.json", PLATFORM_REWRITE_RULES.codex)).toBe(
			"./.codex/config.toml",
		);
	});

	it("정정 후 결과물에 존재하지 않는 Codex 경로 `settings.json`이 남지 않는다 (결함 1 실행 가능한 검사)", () => {
		const line =
			"Read `[$CLAUDE_CONFIG_DIR|~/.claude]/settings.json` and `./.claude/settings.json` (project overrides user)";
		const result = applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex);
		// tools/adapters/codex.ts's syncConfig/flushMcpBlock write ONLY
		// config.toml under .codex/ — settings.json is never a real Codex
		// config file. Any surviving "settings.json" substring here means the
		// deployed sentence still tells a Codex session to read a file that
		// does not exist.
		expect(result).not.toContain("settings.json");
		expect(result).toContain("config.toml");
	});

	it('"settings.local.json" (hud 전용, Codex 미배포)은 오검출로 건드리지 않는다 — "settings.json"이 연속 부분문자열이 아님', () => {
		expect(
			applyRewriteRules(".codex/settings.local.json", PLATFORM_REWRITE_RULES.codex),
		).toBe(".codex/settings.local.json");
	});

	it("멱등성: config.toml로 정정된 결과를 다시 적용해도 변하지 않는다", () => {
		const once = applyRewriteRules("./.claude/settings.json", PLATFORM_REWRITE_RULES.codex);
		const twice = applyRewriteRules(once, PLATFORM_REWRITE_RULES.codex);
		expect(twice).toBe(once);
	});
});

describe("codex 규칙 — Hole C: `AskUserQuestions`(복수) -> `request_user_input calls`, rule 14보다 먼저", () => {
	it('"AskUserQuestion" (단수) -> "request_user_input" (기존 규칙 14, 회귀)', () => {
		expect(applyRewriteRules("AskUserQuestion", PLATFORM_REWRITE_RULES.codex)).toBe(
			"request_user_input",
		);
	});

	it('"AskUserQuestions" (복수) -> "request_user_input calls"', () => {
		expect(applyRewriteRules("AskUserQuestions", PLATFORM_REWRITE_RULES.codex)).toBe(
			"request_user_input calls",
		);
	});

	it("단수와 복수가 한 줄에 함께 있어도 서로 오염시키지 않는다", () => {
		const result = applyRewriteRules(
			"AskUserQuestion and AskUserQuestions",
			PLATFORM_REWRITE_RULES.codex,
		);
		expect(result).toBe("request_user_input and request_user_input calls");
	});

	it("실제 캐리어 라인(collect-jd/tests/pressure-scenarios.md:688)이 정정된다", () => {
		const line = '"asking too many AskUserQuestions will tire the user" user-consideration rationalization';
		const result = applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex);
		expect(result).toBe(
			'"asking too many request_user_input calls will tire the user" user-consideration rationalization',
		);
	});

	it('"asking a single AskUserQuestion" -> "asking a single request_user_input" (이중관사 없음)', () => {
		expect(
			applyRewriteRules("asking a single AskUserQuestion", PLATFORM_REWRITE_RULES.codex),
		).toBe("asking a single request_user_input");
	});

	it('백틱 캐리어 "Use `AskUserQuestion`" -> "Use `request_user_input`"', () => {
		expect(applyRewriteRules("Use `AskUserQuestion`", PLATFORM_REWRITE_RULES.codex)).toBe(
			"Use `request_user_input`",
		);
	});

	it('"via a single AskUserQuestion" -> "via a single request_user_input"', () => {
		expect(
			applyRewriteRules("via a single AskUserQuestion", PLATFORM_REWRITE_RULES.codex),
		).toBe("via a single request_user_input");
	});
});

describe("codex 규칙 — Hole D: DOT 라벨의 리터럴 `\\n` 이스케이프 직후 AskUserQuestion(s) (witnessed: skills/collect-jd/reference/dedup-and-discovery.md:64)", () => {
	it('DOT 라벨 "Phase 3:\\nAskUserQuestion\\n(x)" -> "Phase 3:\\nrequest_user_input\\n(x)" (리터럴 \\n 보존, 토큰만 치환)', () => {
		expect(
			applyRewriteRules(
				"Phase 3:\\nAskUserQuestion\\n(x)",
				PLATFORM_REWRITE_RULES.codex,
			),
		).toBe("Phase 3:\\nrequest_user_input\\n(x)");
	});

	it('복수형도 리터럴 \\n 직후에서 치환된다: "foo\\nAskUserQuestions bar" -> "foo\\nrequest_user_input calls bar"', () => {
		expect(
			applyRewriteRules("foo\\nAskUserQuestions bar", PLATFORM_REWRITE_RULES.codex),
		).toBe("foo\\nrequest_user_input calls bar");
	});

	it("실개행(real newline) 캐리어에서도 word-boundary 분기로 동일하게 치환된다: 'Phase 3:' + real-newline + 'AskUserQuestion' + real-newline + '(x)' -> 토큰만 request_user_input으로 (boundary 계약의 두 반쪽을 함께 고정)", () => {
		expect(
			applyRewriteRules("Phase 3:\nAskUserQuestion\n(x)", PLATFORM_REWRITE_RULES.codex),
		).toBe("Phase 3:\nrequest_user_input\n(x)");
	});

	it('과매치 없음: "XAskUserQuestion"(복합 식별자 접미)은 미치환 유지', () => {
		expect(applyRewriteRules("XAskUserQuestion", PLATFORM_REWRITE_RULES.codex)).toBe(
			"XAskUserQuestion",
		);
	});

	it('과매치 없음 (복수): "XAskUserQuestions"·"fooAskUserQuestions"(복합 식별자 접미)는 미치환 유지', () => {
		expect(applyRewriteRules("XAskUserQuestions", PLATFORM_REWRITE_RULES.codex)).toBe(
			"XAskUserQuestions",
		);
		expect(applyRewriteRules("fooAskUserQuestions", PLATFORM_REWRITE_RULES.codex)).toBe(
			"fooAskUserQuestions",
		);
	});
});

describe("G4-1 — KEEP_IDENTICAL_TOKENS / OUT_OF_SCOPE_TOKENS", () => {
	it("KEEP_IDENTICAL_TOKENS는 codex가 공유하는 5개 hook 이벤트명이다", () => {
		expect(KEEP_IDENTICAL_TOKENS).toEqual([
			"PreToolUse",
			"PostToolUse",
			"SessionStart",
			"UserPromptSubmit",
			"PreCompact",
		]);
	});

	it("어느 플랫폼 테이블의 어떤 규칙도 KEEP_IDENTICAL_TOKENS 토큰을 매치하지 않는다 — 매치되면 hook 이벤트명이 조용히 rename되어 dispatch가 깨진다", () => {
		for (const rules of Object.values(PLATFORM_REWRITE_RULES)) {
			for (const rule of rules) {
				const re = new RegExp(rule.detect.source, rule.detect.flags);
				for (const token of KEEP_IDENTICAL_TOKENS) {
					re.lastIndex = 0;
					expect(re.test(token)).toBe(false);
				}
			}
		}
	});

	it("OUT_OF_SCOPE_TOKENS는 비어있지 않고, 모든 항목이 비어있지 않은 reason을 가진다", () => {
		expect(OUT_OF_SCOPE_TOKENS.length).toBeGreaterThan(0);
		for (const entry of OUT_OF_SCOPE_TOKENS) {
			expect(entry.token.length).toBeGreaterThan(0);
			expect(entry.reason.trim().length).toBeGreaterThan(0);
		}
	});
});

describe("codex 테이블 각 규칙의 replace 결과는 전체 테이블에 대해 고정점이다", () => {
	for (const rule of PLATFORM_REWRITE_RULES.codex) {
		it(`규칙 ${rule.id}: replace 결과가 전체 codex 테이블을 다시 통과해도 변하지 않는다`, () => {
			// 함수형 replace(규칙 6a)는 대표 입력("X"라는 인자 없는 이름)으로 호출해 시드를 얻는다.
			// $1 캡처 템플릿을 쓰는 문자열 규칙은 플레이스홀더 "X"로 치환한 뒤 고정점을 검증한다.
			const seed =
				typeof rule.replace === "function"
					? rule.replace("Skill(X)", "X")
					: rule.replace.includes("$1")
						? rule.replace.replace("$1", "X")
						: rule.replace;
			const result = applyRewriteRules(seed, PLATFORM_REWRITE_RULES.codex);
			expect(result).toBe(seed);
		});
	}
});
