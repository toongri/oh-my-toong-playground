import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	confirmStory,
	serializeRequirements,
	setGoalState,
	setStories,
	type Story,
} from "./ultragoal-state.ts";

// ---------------------------------------------------------------------------
// 프로메테우스 -> 울트라골 인계 계약(소비자 쪽). 프로메테우스 문서가 울트라골에 넘기는
// 값(비목표 줄, ADR 예시, 인계 플래그)을 울트라골 상태 코드가 그대로 받아들이는지 본다.
// 통과 규칙: 문서가 코드와 모순되는 값을 적지 않았으면 통과한다. 코드 쪽 값은 실제
// 소스와 실제 함수에서 읽고 이 파일에 복사하지 않는다.
// ---------------------------------------------------------------------------

const prometheusDir = join(import.meta.dir, "..", "..", "prometheus");
const readPrometheusDoc = (name: string): string => readFileSync(join(prometheusDir, name), "utf8");

const prometheusDocs = {
	skill: readPrometheusDoc("SKILL.md"),
	reviewPipeline: readPrometheusDoc("review-pipeline.md"),
	planTemplate: readPrometheusDoc("plan-template.md"),
	acceptanceCriteria: readPrometheusDoc("acceptance-criteria.md"),
};

const ultragoalSource = readFileSync(join(import.meta.dir, "ultragoal-state.ts"), "utf8");

const S = "prometheus-handoff";
let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "prometheus-handoff-"));
	process.env.OMT_DIR = tmpDir;
	process.env.OMT_SESSION_ID = S;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalOmtDir !== undefined) process.env.OMT_DIR = originalOmtDir;
	else delete process.env.OMT_DIR;
	if (originalSessionId !== undefined) process.env.OMT_SESSION_ID = originalSessionId;
	else delete process.env.OMT_SESSION_ID;
});

// ---------------------------------------------------------------------------
// DVC-U1 울트라골이 받아들이는 비목표 줄
// ---------------------------------------------------------------------------

/** `- ... | decider: ...` 모양(또는 decider 철자가 어긋난 변형) 줄을 모으고 `{자리표시자}`를 x로 바꾼다. */
function nonGoalLines(text: string): string[] {
	return text
		.split("\n")
		.filter((line) => /^\s*-\s+.*\|\s*decid\w*\s*:/.test(line))
		.map((line) => line.replace(/\{[^}]*\}/g, "x").trim());
}

describe("DVC-U1 울트라골이 받아들이는 비목표 줄", () => {
	test("프로메테우스 문서가 보여 주는 비목표 줄을 setGoalState가 모두 받아들인다", () => {
		const lines = Object.values(prometheusDocs).flatMap(nonGoalLines);
		expect(lines.length).toBeGreaterThan(0);
		const refused: string[] = [];
		for (const line of lines) {
			try {
				setGoalState(S, { phase: "planning", non_goals: line });
			} catch {
				refused.push(line);
			}
		}
		expect(refused).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// DVC-U2 ADR 예시가 결정 규칙이 된다
// ---------------------------------------------------------------------------

/** plan-template.md에서 `### D-N:` 항목이 든 첫 코드 펜스 본문(ADR 예시)을 돌려준다. */
function adrExample(planTemplate: string): string {
	const fences = [...planTemplate.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
	return fences.find((body) => /^### D-\d+:/m.test(body)) ?? "";
}

/** 예시에서 첫 `### D-N:` 항목부터 D 항목이 아닌 다음 제목(예: Boundary Map) 직전까지의 ADR 구간. */
function adrSection(example: string): string {
	const start = example.search(/^### D-\d+:/m);
	const rest = example.slice(start);
	const end = rest.search(/^#{1,6}[ \t]+(?!D-\d+:)/m);
	return end === -1 ? rest : rest.slice(0, end);
}

/** ADR 구간에서 줄 맨 앞에 오는 `Label:` / `**Label: x**` / `Label (note):` 형태의 필드 라벨을 모은다. */
function fieldLabels(example: string): string[] {
	const labels = new Set<string>();
	for (const line of example.split("\n")) {
		const m = /^(?:\*\*)?([A-Z][A-Za-z -]*?)(?:[ \t]*\([^)]*\))?(?:\*\*)?:/.exec(line);
		if (m) labels.add(m[1]);
	}
	return [...labels];
}

/** 계획 파일을 쓰고 ADR 결정 규칙 블록(serializeRequirements)을 돌려준다. */
function decisionRules(planText: string): string {
	const planPath = join(tmpDir, "plan.md");
	writeFileSync(planPath, planText);
	setGoalState(S, { phase: "planning", outcome: "ship it", plan_path: planPath });
	const story: Story = {
		id: "S1",
		story: "ship the feature",
		acceptance_criteria: ["ac"],
		verification_surface: "v",
		status: "unconfirmed",
	};
	setStories(S, [story]);
	confirmStory(S, "S1");
	return serializeRequirements(S);
}

function adrDrift(planTemplate: string): string[] {
	const example = adrExample(planTemplate);
	if (example === "") return ["plan-template.md has no ADR example with ### D-N: items"];
	const problems: string[] = [];

	// 예시 전체: Decision 필드가 있는 항목마다 `[D-N] 제목 — Decision 본문` 줄이 나와야 한다.
	const items = [...example.matchAll(/^### (D-\d+):[ \t]*(.*?)[ \t]*$/gm)].map((m) => {
		const bodyStart = m.index + m[0].length;
		const rest = example.slice(bodyStart);
		const next = rest.search(/^#{1,6}[ \t]/m);
		const body = next === -1 ? rest : rest.slice(0, next);
		return { id: m[1], title: m[2], decision: /^Decision[^:\n]*:[ \t]*(.+)$/m.exec(body)?.[1].trim() };
	});
	const withDecision = items.filter((i) => i.decision !== undefined);
	if (withDecision.length === 0) return ["the ADR example spells no Decision field"];
	const rules = decisionRules(example).split("\n");
	for (const item of withDecision) {
		const prefix = `[${item.id}] ${item.title} — ${item.decision}`;
		const line = rules.find((l) => l.startsWith(`[${item.id}] `));
		if (line === undefined) problems.push(`no decision rule line for ${item.id}`);
		else if (!(line === prefix || line.startsWith(`${prefix} | `))) problems.push(`rule line for ${item.id} is "${line}", expected it to start with "${prefix}"`);
	}

	// 예시가 쓰는 모든 필드 라벨은 Decision 본문을 끝내야 한다(본문에 붙어 들어오면 안 된다).
	for (const label of fieldLabels(adrSection(example))) {
		if (label === "Decision") continue;
		const line = decisionRules(`### D-1: t\nDecision: alpha\n${label}: beta\n`).split("\n").find((l) => l.startsWith("[D-1] "));
		if (line === undefined || !(line === "[D-1] t — alpha" || line.startsWith("[D-1] t — alpha | "))) {
			problems.push(`field label "${label}" does not end the Decision text (got: ${line})`);
		}
	}
	return problems;
}

describe("DVC-U2 ADR 예시가 결정 규칙이 된다", () => {
	test("plan-template.md의 ADR 예시가 [D-N] 결정 규칙 줄로 직렬화되고 예시의 모든 필드 라벨이 Decision 본문을 끝낸다", () => {
		expect(adrDrift(prometheusDocs.planTemplate)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// DVC-U3 인계 플래그
// ---------------------------------------------------------------------------

function handoffFlagDrift(prometheusSkill: string, source: string): string[] {
	// 코드 정의: 울트라골 CLI가 setGoalState의 non_goals에 연결하는 플래그와 CLI가 읽는 전체 플래그.
	const nonGoalsFlag = /non_goals: str\(args\["([a-z][a-z-]*)"\]\)/.exec(source)?.[1];
	const cliFlags = new Set([...source.matchAll(/args\["([a-z][a-z-]*)"\]/g)].map((m) => m[1]));
	if (nonGoalsFlag === undefined) return ["ultragoal-state.ts wires no CLI flag to non_goals"];

	// 문서 값: 울트라골을 호출하는 줄(`Skill(skill: "ultragoal")`)에 적힌 플래그.
	const handoffLines = prometheusSkill.split("\n").filter((l) => /Skill\(skill: "ultragoal"\)/.test(l));
	const spelled = handoffLines.flatMap((l) => [...l.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)].map((m) => m[1]));
	const problems: string[] = [];
	if (!spelled.includes(nonGoalsFlag)) problems.push(`the ultragoal handoff in SKILL.md does not name --${nonGoalsFlag}`);
	for (const flag of spelled) {
		if (!cliFlags.has(flag)) problems.push(`the ultragoal handoff names --${flag}, which ultragoal-state.ts does not read`);
	}
	return problems;
}

describe("DVC-U3 인계 플래그", () => {
	test("프로메테우스 SKILL.md의 울트라골 인계가 울트라골 CLI가 읽는 비목표 플래그를 쓴다", () => {
		expect(handoffFlagDrift(prometheusDocs.skill, ultragoalSource)).toEqual([]);
	});
});
