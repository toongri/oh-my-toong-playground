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
// table: S, 17, 17b, 4, 5, 6a, 6b, 7, 8, 9, 10, 11, 12, 13, 14p, 14, 1, 2, 3.
const CODEX_FIXTURE_LINES = [
	"~/.claude/skills/hud/catalog.ts",
	".claude/skills/goal/SKILL.md",
	"~/.claude/hooks/session-start.sh",
	".claude/agents/oracle.md",
	"See ~/.claude] for config (bracket notation, no trailing slash)",
	"See CLAUDE.md for repository overview.",
	"Skill(humanizer)",
	'Skill(skill: "sisyphus")',
	'Skill("superpowers:test-driven-development")',
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

describe("codex 규칙 — `Skill(` 형태", () => {
	it('"Skill(humanizer)" -> "the humanizer skill"', () => {
		expect(applyRewriteRules("Skill(humanizer)", PLATFORM_REWRITE_RULES.codex)).toBe(
			"the humanizer skill",
		);
	});

	it('\'Skill(skill: "sisyphus")\' -> "the sisyphus skill"', () => {
		expect(applyRewriteRules('Skill(skill: "sisyphus")', PLATFORM_REWRITE_RULES.codex)).toBe(
			"the sisyphus skill",
		);
	});

	it('\'Skill("superpowers:test-driven-development")\' -> "the superpowers:test-driven-development skill"', () => {
		expect(
			applyRewriteRules(
				'Skill("superpowers:test-driven-development")',
				PLATFORM_REWRITE_RULES.codex,
			),
		).toBe("the superpowers:test-driven-development skill");
	});

	it('\'Skill(skill: "${entry.name}")\' -> "the ${entry.name} skill"', () => {
		expect(
			applyRewriteRules('Skill(skill: "${entry.name}")', PLATFORM_REWRITE_RULES.codex),
		).toBe("the ${entry.name} skill");
	});

	it('"Skill()" -> "skill invocation"', () => {
		expect(applyRewriteRules("Skill()", PLATFORM_REWRITE_RULES.codex)).toBe("skill invocation");
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

describe("codex 규칙 — Hole A: `$CLAUDE_CONFIG_DIR` -> `$CODEX_HOME`", () => {
	it('"$CLAUDE_CONFIG_DIR" -> "$CODEX_HOME"', () => {
		expect(applyRewriteRules("$CLAUDE_CONFIG_DIR", PLATFORM_REWRITE_RULES.codex)).toBe(
			"$CODEX_HOME",
		);
	});

	it("실제 캐리어 라인(deep-interview/SKILL.md:67)에서 CONFIG_DIR과 bracket 표기가 함께 정정된다", () => {
		const line =
			"Read `[$CLAUDE_CONFIG_DIR|~/.claude]/settings.json` and `./.claude/settings.json` (project overrides user)";
		const result = applyRewriteRules(line, PLATFORM_REWRITE_RULES.codex);
		expect(result).toBe(
			"Read `[$CODEX_HOME|~/.codex]/settings.json` and `./.codex/settings.json` (project overrides user)",
		);
	});
});

describe("codex 규칙 — Hole B: `~/.claude]`(트레일링 슬래시 없음) -> `~/.codex`, 순서 17 이후", () => {
	it('"~/.claude]/settings.json" -> "~/.codex]/settings.json"', () => {
		expect(
			applyRewriteRules("~/.claude]/settings.json", PLATFORM_REWRITE_RULES.codex),
		).toBe("~/.codex]/settings.json");
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

	it('과매치 없음: "XAskUserQuestion"(복합 식별자 접미)은 미치환 유지', () => {
		expect(applyRewriteRules("XAskUserQuestion", PLATFORM_REWRITE_RULES.codex)).toBe(
			"XAskUserQuestion",
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
			// $1 캡처 템플릿(규칙 6a)은 플레이스홀더 "X"로 치환한 뒤 고정점을 검증한다.
			const seed = rule.replace.includes("$1") ? rule.replace.replace("$1", "X") : rule.replace;
			const result = applyRewriteRules(seed, PLATFORM_REWRITE_RULES.codex);
			expect(result).toBe(seed);
		});
	}
});
