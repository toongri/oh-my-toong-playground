import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { STEP_ORDER, type Step } from "@lib/explain-diff-core";

const SID = "explain-diff-cli-test";
let sandbox: string;
let priorOmt: string | undefined;
let priorSid: string | undefined;

// The CLI resolves OMT_DIR and the session id from the environment at call time,
// so each test gets its own directory and the suite never touches a real state.
beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "explain-diff-"));
	priorOmt = process.env["OMT_DIR"];
	priorSid = process.env["OMT_SESSION_ID"];
	process.env["OMT_DIR"] = sandbox;
	process.env["OMT_SESSION_ID"] = SID;
});

afterEach(() => {
	if (priorOmt === undefined) delete process.env["OMT_DIR"];
	else process.env["OMT_DIR"] = priorOmt;
	if (priorSid === undefined) delete process.env["OMT_SESSION_ID"];
	else process.env["OMT_SESSION_ID"] = priorSid;
	rmSync(sandbox, { recursive: true, force: true });
});

async function cli() {
	return await import("./explain-diff-state");
}

const GOOD_DOC = `# 설명

## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

### 좁은 배경
내용

## Change Group 1: 락을 공용 모듈로 뽑아낸다
> 예고: 먼저 락을 옮겨야 호출부 정리가 의미를 갖는다.
> 순서: 추출이 먼저다.

### \`lib/state-lock.ts\`
**역할/변경 전 맥락** — 없던 파일 (\`base:lib/state-lock.ts:0\`)
**무엇이 바뀌었나** — 락이 모였다 (\`head:lib/state-lock.ts:14\`)
**왜 필요한가** — [근거: "fix: ultragoal 상태 갱신 락 통합"]
**시스템 효과** — 두 CLI가 같은 락을 쓴다
**추적성** — \`lib/state-lock.ts:14\`
`;

function docFile(text: string): string {
	const p = join(sandbox, "doc.md");
	writeFileSync(p, text, "utf8");
	return p;
}

function state(): Record<string, any> {
	return JSON.parse(readFileSync(join(sandbox, `explain-diff-state-${SID}.json`), "utf8"));
}

describe("start", () => {
	test("첫 스텝은 evidence 이고 산출물 쓰기가 열려 있다", async () => {
		const { start } = await cli();
		start(SID, "HEAD~1..HEAD", "sample");
		expect(state().step).toBe("evidence");
		expect(state().derived.artifact_write_allowed).toBe(true);
	});
});

describe("구조 검사 게이트", () => {
	test("검사 실패는 스텝을 넘기지 않고 실패 항목을 상태에 남긴다", async () => {
		const { start, submitStep } = await cli();
		start(SID, "r", "s");
		const rc = submitStep(SID, "evidence", docFile("빈 문서"), ["lib/state-lock.ts"], []);
		expect(rc).toBe(1);
		expect(state().step).toBe("evidence");
		expect(state().last_failure.items.length).toBeGreaterThan(0);
	});

	test("실패 항목이 가드의 거부 사유로 그대로 흘러간다", async () => {
		const { start, submitStep } = await cli();
		start(SID, "r", "s");
		submitStep(SID, "evidence", docFile("빈 문서"), ["lib/state-lock.ts"], []);
		// step 이 여전히 evidence 라 artifact_write_allowed 는 열려 있지만,
		// 다음 스텝으로 넘어간 뒤에는 이 실패가 거부 사유가 된다.
		expect(state().last_failure.step).toBe("evidence");
		expect(state().last_failure.items.join(" ")).toContain("R1");
	});

	test("구조 검사를 통과해야 심사로 넘어갈 수 있다", async () => {
		const { start, passStep } = await cli();
		start(SID, "r", "s");
		expect(() => passStep(SID, "evidence", docFile(GOOD_DOC), [])).toThrow(/구조 검사/);
	});

	test("현재 스텝이 아닌 스텝은 제출할 수 없다", async () => {
		const { start, submitStep } = await cli();
		start(SID, "r", "s");
		expect(() => submitStep(SID, "code", docFile(GOOD_DOC), ["lib/state-lock.ts"], [])).toThrow(
			/현재 스텝은 evidence/,
		);
	});
});

// Evidence 절만 있고 signal 경로가 표에만 적힌, 문서화된 흐름의 실제 첫 호출 모양의 문서.
const EVIDENCE_ONLY_DOC = `# 설명

## Evidence

| 파일 | 분류 |
|---|---|
| \`lib/state-lock.ts\` | signal |
`;

const WITH_BACKGROUND_DOC = `${EVIDENCE_ONLY_DOC}
## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

### 좁은 배경
내용
`;

/**
 * evidence 부터 `step` 직전까지 `docAtStep`이 준 문서로 통과시켜 그 스텝에 진입시킨다.
 * 도달한 스텝의 `submitStep`/`passStep` 은 호출자가 직접 실행해 검증한다.
 */
async function advanceTo(
	step: Step,
	docAtStep: (s: Step) => string,
): Promise<{
	submitStep: Awaited<ReturnType<typeof cli>>["submitStep"];
	passStep: Awaited<ReturnType<typeof cli>>["passStep"];
}> {
	const { start, submitStep, passStep } = await cli();
	start(SID, "r", "s");
	for (const s of STEP_ORDER) {
		if (s === step) break;
		const doc = docFile(docAtStep(s));
		submitStep(SID, s, doc, ["lib/state-lock.ts"], []);
		passStep(SID, s, doc, [{ id: "R6", pass: true, quote: "state-lock" }]);
	}
	return { submitStep, passStep };
}

describe("스텝 스코핑 — 스텝마다 다른 슬롯만 본다", () => {
	test("Evidence 절만 있는 문서는 evidence 스텝을 통과한다 — 문서화된 흐름의 첫 호출", async () => {
		const { start, submitStep } = await cli();
		start(SID, "r", "s");
		const rc = submitStep(SID, "evidence", docFile(EVIDENCE_ONLY_DOC), ["lib/state-lock.ts"], []);
		expect(rc).toBe(0);
	});

	test("같은 문서를 background 스텝으로 제출하면 R4 미충족으로 실패한다", async () => {
		const { submitStep } = await advanceTo("background", () => EVIDENCE_ONLY_DOC);
		const rc = submitStep(SID, "background", docFile(EVIDENCE_ONLY_DOC), ["lib/state-lock.ts"], []);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R4");
	});

	test("Background 까지 채운 문서는 background 스텝을 통과하고, code 스텝은 실패한다", async () => {
		// WITH_BACKGROUND_DOC 은 evidence 의 R1(등재형)과 background 의 R4 를 모두
		// 만족시키므로 그대로 evidence·background·intuition 을 통과해 code 에 진입한다.
		const { submitStep } = await advanceTo("code", () => WITH_BACKGROUND_DOC);
		// Change Group이 없는 같은 문서를 code 스텝에 그대로 제출한다 — R2가 슬롯 부재로
		// 실패하고, R1(커버리지형)도 signal 파일이 어느 그룹에도 없어 실패한다.
		const rc = submitStep(SID, "code", docFile(WITH_BACKGROUND_DOC), ["lib/state-lock.ts"], []);
		expect(rc).toBe(1);
		const items = state().last_failure.items.join(" ");
		expect(items).toContain("R2");
		expect(items).toContain("lib/state-lock.ts");
	});

	test("signal 파일이 Evidence 표에만 있고 Change Group 파일 블록이 없으면 code 스텝이 실패하고 사유에 경로가 나온다", async () => {
		const { submitStep } = await advanceTo("code", () => WITH_BACKGROUND_DOC);
		const noGroupDoc = `${WITH_BACKGROUND_DOC}
## Change Group 1: 관련 없는 변경
> 예고: 다른 파일을 다룬다.
> 순서: 순서상 이유가 있다.

### \`lib/other.ts\`
**왜 필요한가** — [근거: "다른 이유"]
**추적성** — \`base:lib/other.ts:1\` \`head:lib/other.ts:2\`
`;
		const rc = submitStep(SID, "code", docFile(noGroupDoc), ["lib/state-lock.ts"], []);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("lib/state-lock.ts");
	});

	test("같은 signal 파일의 파일 블록이 두 Change Group에 각각 있으면 code 스텝이 실패하고 사유가 중복임을 밝힌다", async () => {
		const { submitStep } = await advanceTo("code", () => WITH_BACKGROUND_DOC);
		const duplicatedDoc = `${WITH_BACKGROUND_DOC}
## Change Group 1: 락을 공용 모듈로 뽑아낸다
> 예고: 먼저 락 자체를 옮겨 놓아야 호출부 정리가 의미를 갖는다.
> 순서: 추출이 먼저다.

### \`lib/state-lock.ts\`
**왜 필요한가** — [근거: "첫 번째 이유"]
**추적성** — \`base:lib/state-lock.ts:1\` \`head:lib/state-lock.ts:14\`

## Change Group 2: 같은 파일을 또 다룬다
> 예고: 같은 파일이 다시 등장한다.
> 순서: 두 번째 손질이 필요하다.

### \`lib/state-lock.ts\`
**왜 필요한가** — [근거: "두 번째 이유"]
**추적성** — \`base:lib/state-lock.ts:14\` \`head:lib/state-lock.ts:20\`
`;
		const rc = submitStep(SID, "code", docFile(duplicatedDoc), ["lib/state-lock.ts"], []);
		expect(rc).toBe(1);
		const items = state().last_failure.items.join(" ");
		expect(items).toContain("lib/state-lock.ts");
		expect(items).toContain("중복");
	});

	test("intuition 스텝은 최소 문서로도 구조 검사를 통과한다", async () => {
		const { submitStep } = await advanceTo("intuition", () => WITH_BACKGROUND_DOC);
		const rc = submitStep(SID, "intuition", docFile("본질만 적힌 한 줄."), ["lib/state-lock.ts"], []);
		expect(rc).toBe(0);
	});

	test("평가되지 않은 항목은 실패 사유에 등장하지 않는다 — background 실패는 R4만 담는다", async () => {
		const { submitStep } = await advanceTo("background", () => EVIDENCE_ONLY_DOC);
		submitStep(SID, "background", docFile(EVIDENCE_ONLY_DOC), ["lib/state-lock.ts"], []);
		const items = state().last_failure.items;
		expect(items.length).toBe(1);
		expect(items[0]).toContain("R4");
	});
});

describe("심사 인용 검증", () => {
	test("인용 없는 pass 는 자동 실패다", async () => {
		const { start, submitStep, passStep } = await cli();
		start(SID, "r", "s");
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "evidence", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "evidence", doc, [{ id: "R6", pass: true }]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("인용이 없습니다");
		expect(state().step).toBe("evidence");
	});

	test("문서에 없는 인용은 자동 실패다", async () => {
		const { start, submitStep, passStep } = await cli();
		start(SID, "r", "s");
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "evidence", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "evidence", doc, [
			{ id: "R6", pass: true, quote: "문서에 결코 없는 문장" },
		]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("문자열로 존재하지 않습니다");
	});

	test("실재하는 인용이면 통과하고 다음 스텝으로 넘어간다", async () => {
		const { start, submitStep, passStep } = await cli();
		start(SID, "r", "s");
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "evidence", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "evidence", doc, [
			{ id: "R6", pass: true, quote: "락을 공용 모듈로 뽑아낸다" },
		]);
		expect(rc).toBe(0);
		expect(state().step).toBe("background");
		expect(state().passed).toEqual(["evidence"]);
	});
});

describe("필수 심사 ID 강제 — 빈 페이로드로 심사 관문을 건너뛸 수 없다", () => {
	test("intuition 스텝은 --judge-json '[]' 로는 통과하지 못한다 — R6 미제출", async () => {
		const { submitStep, passStep } = await advanceTo("intuition", () => WITH_BACKGROUND_DOC);
		const doc = docFile("본질만 적힌 한 줄.");
		submitStep(SID, "intuition", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "intuition", doc, []);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R6");
		expect(state().step).toBe("intuition");
	});

	test("intuition 스텝은 R6가 아닌 무관한 ID만으로는 통과하지 못한다 — 인용이 문서에 실재해도", async () => {
		const { submitStep, passStep } = await advanceTo("intuition", () => WITH_BACKGROUND_DOC);
		const doc = docFile("본질만 적힌 한 줄.");
		submitStep(SID, "intuition", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "intuition", doc, [{ id: "R9", pass: true, quote: "본질만" }]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R6");
	});

	test("intuition 스텝은 R6를 pass:true + 실재 인용으로 제출해야 통과하고 code로 넘어간다", async () => {
		const { submitStep, passStep } = await advanceTo("intuition", () => WITH_BACKGROUND_DOC);
		const doc = docFile("본질만 적힌 한 줄.");
		submitStep(SID, "intuition", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "intuition", doc, [{ id: "R6", pass: true, quote: "본질만" }]);
		expect(rc).toBe(0);
		expect(state().step).toBe("code");
		expect(state().passed).toContain("intuition");
	});

	test("R6가 있어도 인용이 문서에 없으면 통과하지 못한다 — 기존 인용 검증은 살아 있다", async () => {
		const { submitStep, passStep } = await advanceTo("intuition", () => WITH_BACKGROUND_DOC);
		const doc = docFile("본질만 적힌 한 줄.");
		submitStep(SID, "intuition", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "intuition", doc, [{ id: "R6", pass: true, quote: "문서에 없는 문장" }]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("문자열로 존재하지 않습니다");
	});

	test("code 스텝은 --judge-json '[]' 로는 통과하지 못한다 — R7 미제출", async () => {
		const { submitStep, passStep } = await advanceTo("code", () => GOOD_DOC);
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "code", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "code", doc, []);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R7");
		expect(state().step).toBe("code");
	});

	test("code 스텝은 R7이 아닌 무관한 ID만으로는 통과하지 못한다 — 인용이 문서에 실재해도", async () => {
		const { submitStep, passStep } = await advanceTo("code", () => GOOD_DOC);
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "code", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "code", doc, [
			{ id: "R9", pass: true, quote: "락을 공용 모듈로 뽑아낸다" },
		]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R7");
	});

	test("code 스텝은 R7을 pass:true + 실재 인용으로 제출해야 통과하고 render로 넘어간다", async () => {
		const { submitStep, passStep } = await advanceTo("code", () => GOOD_DOC);
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "code", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "code", doc, [
			{ id: "R7", pass: true, quote: "락을 공용 모듈로 뽑아낸다" },
		]);
		expect(rc).toBe(0);
		expect(state().step).toBe("render");
		expect(state().passed).toContain("code");
	});

	test("evidence 스텝은 필수 ID가 없어 빈 배열로도 통과한다", async () => {
		const { start, submitStep, passStep } = await cli();
		start(SID, "r", "s");
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "evidence", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "evidence", doc, []);
		expect(rc).toBe(0);
		expect(state().step).toBe("background");
	});

	test("background 스텝은 필수 ID가 없어 빈 배열로도 통과한다", async () => {
		const { submitStep, passStep } = await advanceTo("background", () => WITH_BACKGROUND_DOC);
		const doc = docFile(WITH_BACKGROUND_DOC);
		submitStep(SID, "background", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "background", doc, []);
		expect(rc).toBe(0);
		expect(state().step).toBe("intuition");
	});

	// render는 필수 ID가 없어 빈 배열로 통과한다 — "render 산출물 검사" 아래
	// "render 통과 후 pass-step 은 심사 항목 없이 quiz 로 넘긴다" 가 이미 이 경우를 검증한다.
});

// evidence 부터 code 까지는 같은 문서·같은 인용으로 매 스텝을 통과시킨다 — 구조 검사는
// 스텝마다 다른 항목만 보지만, GOOD_DOC 은 Evidence·Background·Change Group을 전부
// 갖추고 있어 스텝이 바뀔 때마다 그 스텝이 보는 슬롯이 이미 채워져 있다. R6·R7을 매
// 스텝에 함께 실어 보내는 것은 intuition·code 각각이 요구하는 필수 ID를 놓치지 않기
// 위해서다 — 요구되지 않는 스텝에서는 그냥 검증되는 여분의 통과 항목일 뿐이다.
async function driveToRender(): Promise<{
	passStep: Awaited<ReturnType<typeof cli>>["passStep"];
	submitStep: Awaited<ReturnType<typeof cli>>["submitStep"];
	doc: string;
}> {
	const { start, submitStep, passStep } = await cli();
	start(SID, "r", "s");
	const doc = docFile(GOOD_DOC);
	const quote = "락을 공용 모듈로 뽑아낸다";
	for (const step of ["evidence", "background", "intuition", "code"] as const) {
		submitStep(SID, step, doc, ["lib/state-lock.ts"], []);
		passStep(SID, step, doc, [
			{ id: "R6", pass: true, quote },
			{ id: "R7", pass: true, quote },
		]);
	}
	return { passStep, submitStep, doc };
}

describe("render 산출물 검사", () => {
	test("--html 없이 제출하면 실패한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const rc = submitStep(SID, "render", doc, [], []);
		expect(rc).toBe(1);
		expect(state().step).toBe("render");
		expect(state().last_failure.step).toBe("render");
	});

	test("존재하지 않는 HTML 경로는 실패한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const rc = submitStep(SID, "render", doc, [], [], join(sandbox, "없음.html"));
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("찾을 수 없습니다");
	});

	test("빈 HTML 파일은 실패한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, "", "utf8");
		const rc = submitStep(SID, "render", doc, [], [], htmlPath);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("비어 있습니다");
	});

	test("정상 HTML 은 통과하고 render 를 구조 통과 목록에 남긴다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, "<html></html>", "utf8");
		const rc = submitStep(SID, "render", doc, [], [], htmlPath);
		expect(rc).toBe(0);
		expect(state().structural_ok).toContain("render");
	});

	test("render 통과 후 pass-step 은 심사 항목 없이 quiz 로 넘긴다", async () => {
		const { submitStep, passStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, "<html></html>", "utf8");
		submitStep(SID, "render", doc, [], [], htmlPath);
		const rc = passStep(SID, "render", doc, []);
		expect(rc).toBe(0);
		expect(state().step).toBe("quiz");
	});

	test("evidence 부터 render 까지 전 스텝을 통과시키고 필수 개념을 채우면 complete 가 성공한다", async () => {
		const { start, submitStep, passStep, addConcept, ask, grade, complete } = await cli();
		start(SID, "r", "s");
		const doc = docFile(GOOD_DOC);
		const quote = "락을 공용 모듈로 뽑아낸다";
		for (const step of ["evidence", "background", "intuition", "code"] as const) {
			submitStep(SID, step, doc, ["lib/state-lock.ts"], []);
			passStep(SID, step, doc, [
				{ id: "R6", pass: true, quote },
				{ id: "R7", pass: true, quote },
			]);
		}
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, "<html></html>", "utf8");
		submitStep(SID, "render", doc, [], [], htmlPath);
		passStep(SID, "render", doc, []);
		expect(state().step).toBe("quiz");
		addConcept(SID, "c1", true);
		ask(SID);
		grade(SID, "c1", [], "digest-final");
		expect(complete(SID)).toBe(0);
	});
});

describe("퀴즈 완료 게이트", () => {
	test("필수 개념이 남아 있으면 완료할 수 없다", async () => {
		const { start, addConcept, complete } = await cli();
		start(SID, "r", "s");
		addConcept(SID, "c1", true);
		expect(complete(SID)).toBe(1);
		expect(state().active).toBe(true);
	});
});

describe("무진전 카운터", () => {
	test("같은 항목·같은 문서로 두 번 실패하면 소프트 정지한다", async () => {
		const { start, addConcept, ask, grade } = await cli();
		start(SID, "r", "s");
		addConcept(SID, "c1", true);
		ask(SID);
		grade(SID, "c1", ["R3 근거"], "digest-a");
		expect(state().stalled).toBeUndefined();
		ask(SID);
		grade(SID, "c1", ["R3 근거"], "digest-a");
		expect(state().stalled).toBe(true);
	});

	test("문서가 바뀌면 카운터가 초기화된다", async () => {
		const { start, addConcept, ask, grade } = await cli();
		start(SID, "r", "s");
		addConcept(SID, "c1", true);
		ask(SID);
		grade(SID, "c1", ["R3 근거"], "digest-a");
		ask(SID);
		grade(SID, "c1", ["R3 근거"], "digest-b");
		expect(state().no_progress.count).toBe(1);
		expect(state().stalled).toBeUndefined();
	});

	test("정답이면 카운터가 초기화되고 개념이 통과한다", async () => {
		const { start, addConcept, ask, grade } = await cli();
		start(SID, "r", "s");
		addConcept(SID, "c1", true);
		ask(SID);
		grade(SID, "c1", ["R3 근거"], "digest-a");
		ask(SID);
		grade(SID, "c1", [], "digest-a");
		expect(state().no_progress.count).toBe(0);
		expect(state().concepts[0].passed).toBe(true);
	});

	test("`ask` 는 대기 플래그를 세워 정지를 허용한다", async () => {
		const { start, ask } = await cli();
		start(SID, "r", "s");
		ask(SID);
		expect(state().awaiting_answer).toBe(true);
		expect(state().derived.stop_allowed).toBe(true);
	});
});

describe("ask 없이 grade 를 부르면", () => {
	test("거부되고 개념은 passed:false 로 남는다", async () => {
		const { start, addConcept, grade } = await cli();
		start(SID, "r", "s");
		addConcept(SID, "c1", true);
		expect(() => grade(SID, "c1", [], "digest-a")).toThrow(/ask/);
		expect(state().concepts[0].passed).toBe(false);
	});

	test("거부는 awaiting_answer 를 원래 값에서 바꾸지 않는다", async () => {
		const { start, addConcept, grade } = await cli();
		start(SID, "r", "s");
		addConcept(SID, "c1", true);
		expect(state().awaiting_answer).toBe(false);
		expect(() => grade(SID, "c1", [], "digest-a")).toThrow();
		expect(state().awaiting_answer).toBe(false);
	});

	test("ask 이후에는 missing 없는 grade 가 정상적으로 통과한다", async () => {
		const { start, addConcept, ask, grade } = await cli();
		start(SID, "r", "s");
		addConcept(SID, "c1", true);
		ask(SID);
		grade(SID, "c1", [], "digest-a");
		expect(state().concepts[0].passed).toBe(true);
		expect(state().awaiting_answer).toBe(false);
	});

	test("ask 이후 missing 이 있으면 통과하지 않고 무진전 카운터가 1이 된다", async () => {
		const { start, addConcept, ask, grade } = await cli();
		start(SID, "r", "s");
		addConcept(SID, "c1", true);
		ask(SID);
		grade(SID, "c1", ["R3 근거"], "digest-a");
		expect(state().concepts[0].passed).toBe(false);
		expect(state().no_progress.count).toBe(1);
	});
});
