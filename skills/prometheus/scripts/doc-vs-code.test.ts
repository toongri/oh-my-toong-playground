import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_BLOCK_COUNT } from "../../../lib/persistent-mode-core/state.ts";
import { detectPrometheusDone } from "../../../lib/persistent-mode-core/transcript-detector.ts";
import { stageAPresentationPath } from "../../../lib/state-core.ts";
import { readPrometheusState, setPrometheusState } from "./prometheus-state.ts";
import { validateBoundaryMap } from "./validate-plan.ts";

// ---------------------------------------------------------------------------
// 문서-코드 값 일치 검증. 프로메테우스 스킬 문서가 적어 둔 값(상태 CLI 사용법, 비목표
// 줄 모양, 상태 필드 이름, Boundary Map 슬롯, Stage A 경로와 거부 상한, 문서 간 포인터)이
// 그 값을 소비하는 코드와 어긋나지 않는지만 본다. 통과 규칙: 문서가 코드와 모순되는 값을
// 적지 않았으면 통과한다. 문서가 값을 아예 적지 않는 것은 실패가 아니며, 바닥(floor)을
// 명시한 곳만 예외다. 코드 쪽 값은 항상 실제 소스에서 읽고 이 파일에 복사하지 않는다.
// 추출은 제목, 플래그 토큰, 표 행 같은 내용 기준이라 문장을 고쳐 써도 깨지지 않는다.
// ---------------------------------------------------------------------------

const skillDir = join(import.meta.dir, "..");
const readDoc = (name: string): string => readFileSync(join(skillDir, name), "utf8");

const docs = {
	skill: readDoc("SKILL.md"),
	reviewPipeline: readDoc("review-pipeline.md"),
	planTemplate: readDoc("plan-template.md"),
	acceptanceCriteria: readDoc("acceptance-criteria.md"),
	interview: readDoc("interview.md"),
};

const stateSource = readFileSync(join(import.meta.dir, "prometheus-state.ts"), "utf8");
const stateCliPath = join(import.meta.dir, "prometheus-state.ts");

/** 라인 단위로 펜스(```) 안과 밖을 구분해 돌려준다. */
function* linesWithFence(text: string): Generator<{ line: string; inFence: boolean }> {
	let inFence = false;
	for (const line of text.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		yield { line, inFence };
	}
}

/** 정규식의 첫 캡처 그룹을 모두 모은다. */
function captureAll(re: RegExp, text: string): string[] {
	return [...text.matchAll(re)].map((m) => m[1]);
}

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "prometheus-doc-vs-code-"));
	process.env.OMT_DIR = tmpDir;
	process.env.OMT_SESSION_ID = "doc-vs-code";
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalOmtDir !== undefined) process.env.OMT_DIR = originalOmtDir;
	else delete process.env.OMT_DIR;
	if (originalSessionId !== undefined) process.env.OMT_SESSION_ID = originalSessionId;
	else delete process.env.OMT_SESSION_ID;
});

// ---------------------------------------------------------------------------
// DVC-P1 상태 CLI 사용법
// ---------------------------------------------------------------------------

/** 문서의 코드 스팬과 펜스 줄에서 `prometheus-state.ts <subcommand> <rest>` 호출을 모은다. */
function stateCliInvocations(text: string): { subcommand: string; rest: string; context: string }[] {
	const spans: string[] = [];
	for (const { line, inFence } of linesWithFence(text)) {
		if (inFence) spans.push(line);
		else spans.push(...captureAll(/`([^`]*prometheus-state\.ts[^`]*)`/g, line));
	}
	const found: { subcommand: string; rest: string; context: string }[] = [];
	for (const span of spans) {
		for (const part of span.split(/prometheus-state\.ts"?/).slice(1)) {
			const m = /^\s+([a-z][a-z-]*)\b(.*)$/s.exec(part);
			if (m) found.push({ subcommand: m[1], rest: m[2], context: span });
		}
	}
	return found;
}

/** 상태 CLI 소스에서 읽은 코드 정의: 디스패치 서브커맨드, AI 사용 가능 서브커맨드, 플래그, 단계 토큰. */
function stateCliDefinition() {
	const dispatched = new Set(captureAll(/subcommand === "([a-z][a-z-]*)"/g, stateSource));
	const help = spawnSync(process.execPath, [stateCliPath, "help"], { encoding: "utf8" }).stdout;
	const systemOnlyAt = help.indexOf("SYSTEM-ONLY");
	const systemOnly = new Set(captureAll(/^\s+([a-z][a-z-]*) — /gm, help.slice(systemOnlyAt)));
	const flags = new Set(captureAll(/(?:stringFlag\(args, |args\[)"([a-z][a-z-]*)"/g, stateSource));
	const phasesLiteral = /const PHASES = \[([^\]]*)\]/.exec(stateSource)?.[1] ?? "";
	const phases = new Set(captureAll(/"([^"]+)"/g, phasesLiteral));
	return { allowedSubcommands: new Set([...dispatched].filter((s) => !systemOnly.has(s))), flags, phases };
}

function stateCliDrift(skillText: string, reviewPipelineText: string): string[] {
	const { allowedSubcommands, flags, phases } = stateCliDefinition();
	const problems: string[] = [];
	if (allowedSubcommands.size === 0 || flags.size === 0 || phases.size === 0) {
		return ["state CLI definition could not be read from prometheus-state.ts"];
	}
	for (const text of [skillText, reviewPipelineText]) {
		for (const { subcommand, rest, context } of stateCliInvocations(text)) {
			if (!allowedSubcommands.has(subcommand)) problems.push(`unknown or system-only subcommand "${subcommand}" in: ${context}`);
			for (const flag of captureAll(/(?<![\w-])--([a-z][a-z-]*)/g, rest)) {
				if (!flags.has(flag)) problems.push(`unknown flag --${flag} in: ${context}`);
			}
			for (const phase of captureAll(/--phase\s+(S\d+)\b/g, rest)) {
				if (!phases.has(phase)) problems.push(`unknown phase ${phase} in: ${context}`);
			}
			if (/--submit-presentation\b/.test(rest) && !/--receipt\b/.test(rest)) {
				problems.push(`--submit-presentation without --receipt in: ${context}`);
			}
		}
	}
	// 바닥: 소스에 있는 모든 플래그는 SKILL.md 또는 review-pipeline.md 어딘가에 적혀 있어야 한다.
	const spelled = new Set(captureAll(/(?<![\w-])--([a-z][a-z-]*)/g, `${skillText}\n${reviewPipelineText}`));
	for (const flag of flags) {
		if (!spelled.has(flag)) problems.push(`flag --${flag} is defined in prometheus-state.ts but spelled in neither SKILL.md nor review-pipeline.md`);
	}
	return problems;
}

describe("DVC-P1 상태 CLI 사용법", () => {
	test("문서의 prometheus-state.ts 호출은 CLI가 정의한 서브커맨드, 플래그, 단계만 쓴다", () => {
		expect(stateCliDrift(docs.skill, docs.reviewPipeline)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// DVC-P2 비목표 줄 모양
// ---------------------------------------------------------------------------

/** `- ... | decider: ...` 모양(또는 decider 철자가 어긋난 변형) 줄을 모으고 `{자리표시자}`를 x로 바꾼다. */
function nonGoalLines(text: string): string[] {
	return text
		.split("\n")
		.filter((line) => /^\s*-\s+.*\|\s*decid\w*\s*:/.test(line))
		.map((line) => line.replace(/\{[^}]*\}/g, "x").trim());
}

describe("DVC-P2 비목표 줄 모양", () => {
	test("문서가 보여 주는 비목표 줄을 상태 setter가 모두 받아들인다", () => {
		const lines = [docs.skill, docs.reviewPipeline, docs.planTemplate, docs.acceptanceCriteria].flatMap(nonGoalLines);
		expect(lines.length).toBeGreaterThan(0);
		const refused: string[] = [];
		for (const line of lines) {
			try {
				setPrometheusState("p2", { phase: "S2", non_goals: line });
			} catch {
				refused.push(line);
			}
		}
		expect(refused).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// DVC-P3 상태 필드 이름
// ---------------------------------------------------------------------------

/** 실제 setter로 만든 상태 두 벌(진행 상태, 중단 상태)의 키 트리. */
function realStateShapes(): Record<string, unknown>[] {
	const plan = join(tmpDir, "plans", "p3.md");
	setPrometheusState("p3", {
		phase: "S2",
		plan_path: plan,
		non_goals: "- x | decider: y",
		record_ac: ["ac"],
		mark_design_done: true,
		mark_plan_done: true,
		resume_summary: "r",
	});
	setPrometheusState("p3-abort", { phase: "S2", non_goals: "- x | decider: y", abort_reason: "stop" });
	return [readPrometheusState("p3"), readPrometheusState("p3-abort")].map((s) => s as unknown as Record<string, unknown>);
}

function stateFieldDrift(text: string, shapes: Record<string, unknown>[]): string[] {
	const tokens = new Set<string>();
	for (const m of text.matchAll(/(?<![\w./-])state\.([a-z_]+)/g)) tokens.add(`state.${m[1]}`);
	for (const m of text.matchAll(/(?<![\w./-])steps\.([a-z_]+)(?:\.([a-z_]+))?/g)) {
		tokens.add(m[2] ? `steps.${m[1]}.${m[2]}` : `steps.${m[1]}`);
	}
	const problems: string[] = [];
	for (const token of tokens) {
		const [root, ...path] = token.split(".");
		const resolves = shapes.some((shape) => {
			let node: unknown = root === "state" ? shape : (shape as { steps?: unknown }).steps;
			for (const key of path) {
				if (typeof node !== "object" || node === null || !(key in node)) return false;
				node = (node as Record<string, unknown>)[key];
			}
			return true;
		});
		if (!resolves) problems.push(`${token} does not resolve to a key of the state written by setPrometheusState`);
	}
	return problems;
}

describe("DVC-P3 상태 필드 이름", () => {
	test("문서의 state.<field>, steps.<a>.<b> 토큰이 실제 상태 키로 풀린다", () => {
		const shapes = realStateShapes();
		expect(shapes.every((s) => s !== null)).toBe(true);
		expect(stateFieldDrift(`${docs.skill}\n${docs.reviewPipeline}`, shapes)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// DVC-P4 Boundary Map 슬롯
// ---------------------------------------------------------------------------

/** validateBoundaryMap을 탐침해 코드가 요구하는 블록 이름, 슬롯 단어, 규칙 이름을 읽는다. */
function boundaryMapDefinition() {
	const label = "Must NOT own";
	const missing = validateBoundaryMap(`${label}: x\n`);
	const blockName = /^(.+?): block is missing/.exec(missing[0] ?? "")?.[1] ?? "";
	const ruleName = /the ([\w-]+) rule/.exec(missing[0] ?? "")?.[1] ?? "";
	const slotMessages = validateBoundaryMap(`${label}: x\n\n### ${blockName}\n`);
	const slots = slotMessages.map((m) => /missing "(.+?) \(/.exec(m)?.[1] ?? "");
	return { label, blockName, ruleName, slots, triggered: missing.length > 0 };
}

function boundaryMapDrift(skillText: string, planTemplateText: string): string[] {
	const def = boundaryMapDefinition();
	if (!def.triggered || def.blockName === "" || def.ruleName === "" || def.slots.length === 0 || def.slots.includes("")) {
		return ["validateBoundaryMap probe did not yield block name, slots, and rule name"];
	}
	const problems: string[] = [];
	for (const word of [def.label, def.blockName, ...def.slots]) {
		for (const [name, text] of [["SKILL.md", skillText], ["plan-template.md", planTemplateText]] as const) {
			if (!text.includes(word)) problems.push(`${name} does not spell "${word}"`);
		}
	}
	if (!skillText.includes(def.ruleName)) problems.push(`SKILL.md does not name the "${def.ruleName}" rule`);
	if (!new RegExp(`^#{2,4}[ \\t]+.*${def.blockName}`, "m").test(planTemplateText)) {
		problems.push(`plan-template.md has no heading carrying "${def.blockName}"`);
	}
	return problems;
}

describe("DVC-P4 Boundary Map 슬롯", () => {
	test("문서가 쓰는 Boundary Map 슬롯 단어와 규칙 이름이 validateBoundaryMap 메시지와 같다", () => {
		expect(boundaryMapDrift(docs.skill, docs.planTemplate)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// DVC-P5 Stage A 값
// ---------------------------------------------------------------------------

function stageADrift(skillText: string, reviewPipelineText: string): string[] {
	const problems: string[] = [];
	const text = `${skillText}\n${reviewPipelineText}`;

	// 경로: 문서의 플랜 경로 표기 하나를 기준 삼아 모든 발표 경로 표기를 stageAPresentationPath와 비교한다.
	const planSpelling = /(\$OMT_DIR\/plans)\/\{name\}\.md/.exec(text);
	if (planSpelling === null) return ["docs do not spell the plan path $OMT_DIR/plans/{name}.md"];
	const planPath = `${planSpelling[1].replace("$OMT_DIR", "/omt")}/foo.md`;
	const expected = stageAPresentationPath(planPath);
	const spellings = [...text.matchAll(/(\$OMT_DIR[^\s`"']*|<plan directory>)\/presentation\/(\{name\}|<plan stem>)\.html/g)];
	if (spellings.length === 0) problems.push("docs spell no Stage A presentation path");
	for (const [spelled, dir] of spellings) {
		const resolved = `${dir.replace("$OMT_DIR", "/omt").replace("<plan directory>", dirname(planPath))}/presentation/foo.html`;
		if (resolved !== expected) problems.push(`${spelled} resolves to ${resolved}, code gives ${expected}`);
	}

	// 거부 상한: "capped at N" / "bounded at N" 문장의 숫자는 MAX_BLOCK_COUNT여야 한다.
	for (const digits of captureAll(/(?:capped|bounded) at (\d+)/g, text)) {
		if (Number(digits) !== MAX_BLOCK_COUNT) problems.push(`docs say the refusal cap is ${digits}, code MAX_BLOCK_COUNT is ${MAX_BLOCK_COUNT}`);
	}
	return problems;
}

describe("DVC-P5 Stage A 값", () => {
	test("발표 경로 표기와 done 토큰 거부 상한이 코드(stageAPresentationPath, MAX_BLOCK_COUNT)와 같다", () => {
		expect(detectPrometheusDone("<prometheus-done/>")).toBe(true);
		expect(stageADrift(docs.skill, docs.reviewPipeline)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// DVC-D1 문서 간 포인터 무결성
// ---------------------------------------------------------------------------

function pointerDrift(skillText: string, referenceTexts: Record<string, string>): string[] {
	const headings = new Set<string>();
	for (const { line, inFence } of linesWithFence(skillText)) {
		if (!inFence && /^#{1,6}\s+\S/.test(line)) headings.add(line.trim());
	}
	const problems: string[] = [];
	const pointers: { where: string; heading: string }[] = [];
	for (const [name, text] of Object.entries(referenceTexts)) {
		for (const m of text.matchAll(/SKILL\.md\s*>\s*(#{1,6}\s+[^`]+)`/g)) pointers.push({ where: name, heading: m[1].trim() });
	}
	for (const m of skillText.matchAll(/`(#{1,6}\s+[^`]*\(Mandatory Contract\))`/g)) pointers.push({ where: "SKILL.md", heading: m[1].trim() });
	if (pointers.length === 0) problems.push("no heading pointers found in the docs");
	for (const { where, heading } of pointers) {
		if (!headings.has(heading)) problems.push(`${where} points at "${heading}" but SKILL.md has no such heading`);
	}
	return problems;
}

describe("DVC-D1 포인터 무결성 (문서 대 문서)", () => {
	test("`SKILL.md > ## 제목`과 (Mandatory Contract) 포인터가 SKILL.md의 실제 제목으로 풀린다", () => {
		const references = {
			"review-pipeline.md": docs.reviewPipeline,
			"interview.md": docs.interview,
			"plan-template.md": docs.planTemplate,
			"acceptance-criteria.md": docs.acceptanceCriteria,
		};
		expect(pointerDrift(docs.skill, references)).toEqual([]);
	});
});
