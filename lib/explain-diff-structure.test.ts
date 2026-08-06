import { describe, expect, test } from "bun:test";
import { checkStructure } from "./explain-diff-structure";

const GOOD_GROUP = `## Change Group 1: 락을 공용 모듈로 뽑아낸다
> 예고: 먼저 락 자체를 옮겨 놓아야 호출부 정리가 의미를 갖는다.
> 순서: 추출이 먼저다 — 호출부를 먼저 고치면 가리킬 대상이 없다.

### \`lib/state-lock.ts\`
**역할/변경 전 맥락** — 이 파일은 새로 생겼다 (\`base:lib/state-lock.ts:0\`)
**무엇이 바뀌었나** — 락 획득/해제가 여기로 모였다 (\`head:lib/state-lock.ts:14\`)
**왜 필요한가** — 커밋 메시지가 "상태 갱신 락 통합"이라고 적고 있다 [근거: "fix: ultragoal 상태 갱신 락 통합"]
**시스템 효과** — 두 CLI가 같은 락을 쓰게 된다
**추적성** — \`lib/state-lock.ts:14\`
`;

const BACKGROUND = `## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.
내용

### 좁은 배경
내용
`;

/** Evidence 절만 있는 문서 — signal 경로가 표에 등장할 뿐 Change Group은 없다. */
function evidenceOnlyDoc(signalPath: string): string {
	return `# 설명\n\n## Evidence\n\n| 파일 | 분류 |\n|---|---|\n| \`${signalPath}\` | signal |\n`;
}

function withBackground(body: string): string {
	return `# 설명\n\n${BACKGROUND}\n${body}`;
}

describe("evidence 스텝 — R1 등재형", () => {
	test("signal 경로가 문서 어딘가에 등장하면 통과한다", () => {
		const r = checkStructure(evidenceOnlyDoc("lib/state-lock.ts"), {
			signalFiles: ["lib/state-lock.ts"],
			step: "evidence",
		});
		expect(r.pass).toBe(true);
		expect(r.items.find((i) => i.id === "R1")?.pass).toBe(true);
	});

	test("빠진 파일이 있으면 실패하고 그 경로를 사유에 담는다", () => {
		const r = checkStructure(evidenceOnlyDoc("lib/state-lock.ts"), {
			signalFiles: ["lib/state-lock.ts", "tools/x/scripts/y.ts"],
			step: "evidence",
		});
		const item = r.items.find((i) => i.id === "R1");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("tools/x/scripts/y.ts");
	});

	test("signal 파일이 하나도 없으면 통과가 아니다 — 빈 집합 공허참 차단", () => {
		const r = checkStructure(evidenceOnlyDoc("lib/state-lock.ts"), {
			signalFiles: [],
			step: "evidence",
		});
		expect(r.items.find((i) => i.id === "R1")?.pass).toBe(false);
	});

	test("evidence 스텝에는 R1 외의 항목이 평가되지 않는다", () => {
		const r = checkStructure(evidenceOnlyDoc("lib/state-lock.ts"), {
			signalFiles: ["lib/state-lock.ts"],
			step: "evidence",
		});
		expect(r.items.map((i) => i.id)).toEqual(["R1"]);
	});
});

describe("background 스텝 — R4만 평가", () => {
	test("Evidence 절만 있는 문서는 background 스텝에서 실패한다 — R4 미충족", () => {
		const r = checkStructure(evidenceOnlyDoc("lib/state-lock.ts"), {
			signalFiles: ["lib/state-lock.ts"],
			step: "background",
		});
		expect(r.pass).toBe(false);
		expect(r.items.map((i) => i.id)).toEqual(["R4"]);
		expect(r.items.find((i) => i.id === "R4")?.pass).toBe(false);
	});

	test("Background 두 단 + 건너뛰기 마커가 있으면 통과한다", () => {
		const r = checkStructure(withBackground(GOOD_GROUP), {
			signalFiles: ["lib/state-lock.ts"],
			step: "background",
		});
		expect(r.pass).toBe(true);
		expect(r.items.find((i) => i.id === "R4")?.pass).toBe(true);
	});

	test("건너뛰기 마커가 없으면 실패한다", () => {
		const text = withBackground(GOOD_GROUP).replace("이미 익숙하면 건너뛰세요.", "내용만 있다.");
		const r = checkStructure(text, { signalFiles: ["lib/state-lock.ts"], step: "background" });
		expect(r.items.find((i) => i.id === "R4")?.pass).toBe(false);
	});
});

describe("intuition 스텝 — 구조 항목 없음", () => {
	test("최소 문서로도 무조건 통과한다", () => {
		const r = checkStructure("# 설명\n\n본질만 적힌 한 줄.", {
			signalFiles: ["lib/state-lock.ts"],
			step: "intuition",
		});
		expect(r.pass).toBe(true);
		expect(r.items).toEqual([]);
		expect(r.failedItems).toEqual([]);
	});
});

// render/quiz는 프로덕션에서 checkStructure를 부르는 경로가 아니다 — render는
// checkRenderOutput으로, quiz는 별도 경로로 빠진다. 그래도 이 함수가 인식 못
// 하는 step에 조용히 pass:true를 돌려주면 안 된다: 회귀 이전엔 step이 아예
// 없어서 이 분기 밖 낙하가 "빈 문서도 만점"으로 드러났다 — 그 실패 모드가
// 다른 호출부에서 재발하지 않는다는 것을 여기서 고정한다.
describe("checkStructure가 인식하지 못하는 step — 조용한 통과 금지", () => {
	test("render 스텝은 조용한 통과가 아니다", () => {
		expect(() =>
			checkStructure("# 완전히 빈 문서", {
				signalFiles: ["a.ts"],
				addedFiles: [],
				step: "render",
			}),
		).toThrow();
	});

	test("quiz 스텝은 조용한 통과가 아니다", () => {
		expect(() =>
			checkStructure("# 완전히 빈 문서", {
				signalFiles: ["a.ts"],
				addedFiles: [],
				step: "quiz",
			}),
		).toThrow();
	});

	test("타입을 우회한 알려지지 않은 step 값도 조용한 통과가 아니다", () => {
		// as로 타입을 우회하지 않고 JSON.parse로 객체를 만들어 컴파일 타임
		// 체크를 피한다 — 런타임에 실제로 들어올 수 있는 오염된 입력을 흉내낸다.
		const input = JSON.parse('{"signalFiles":["a.ts"],"step":"bogus"}');
		expect(() => checkStructure("# 완전히 빈 문서", input)).toThrow();
	});
});

describe("code 스텝 — R2·R3·R5·R1(커버리지형)", () => {
	test("Background까지만 있고 Change Group이 없으면 실패한다", () => {
		const r = checkStructure(withBackground(""), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.pass).toBe(false);
		expect(r.items.map((i) => i.id)).toEqual(["R2", "R3", "R5", "R1"]);
	});

	test("완전한 문서는 code 스텝에서 통과한다", () => {
		const r = checkStructure(withBackground(GOOD_GROUP), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.pass).toBe(true);
		expect(r.failedItems).toEqual([]);
	});

	test("예고 슬롯이 없으면 R2가 실패한다", () => {
		const body = GOOD_GROUP.replace(/^> 예고:.*$/m, "");
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		const item = r.items.find((i) => i.id === "R2");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("예고");
	});

	test("근거 인용 없이 단정하면 R3가 실패한다", () => {
		const body = GOOD_GROUP.replace(
			/\*\*왜 필요한가\*\*.*$/m,
			"**왜 필요한가** — 가로 스크롤이 없었던 것이 이슈 #5830이다",
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		const item = r.items.find((i) => i.id === "R3");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("lib/state-lock.ts");
	});

	test("`[추론: ]` 라벨도 R3를 통과시킨다", () => {
		const body = GOOD_GROUP.replace(/\[근거:[^\]]*\]/, "[추론: 커밋 제목이 통합이라 말한다]");
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(true);
	});

	test("head 위치가 없으면 R5가 실패한다", () => {
		const body = GOOD_GROUP.replace(/`head:[^`]*`/, "그 자리");
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(false);
	});

	test("신규 파일은 base 위치가 존재하지 않으므로 head 만으로 R5를 통과한다", () => {
		const added = `## Change Group 1: 락을 도입한다

> 예고: 락이 무엇을 막는지 본다.
> 순서: 락이 없으면 나머지가 성립하지 않는다.

### \`lib/state-lock.ts\`

**왜 필요한가** — [근거: "동시 작성자 두 명"]

**추적성** — \`head:lib/state-lock.ts:15\`
`;
		const r = checkStructure(withBackground(added), {
			signalFiles: ["lib/state-lock.ts"],
			addedFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	describe("R1 커버리지형 — signal 파일이 Change Group에 정확히 한 번", () => {
		test("signal 파일이 Evidence 표에만 있고 Change Group 파일 블록이 없으면 실패하고 경로를 담는다", () => {
			// "lib/state-lock.ts" 는 Evidence 표(문자열)에 등장하지만 Change Group 파일
			// 블록으로는 한 번도 등장하지 않는다 — 옛 text.includes 검사라면 이 문서를
			// 무조건 통과시켰을 배치다.
			const body = `## Evidence

| 파일 | 분류 |
|---|---|
| \`lib/state-lock.ts\` | signal |

## Change Group 1: 관련 없는 변경
> 예고: 다른 파일을 다룬다.
> 순서: 순서상 이유가 있다.

### \`lib/other.ts\`
**왜 필요한가** — [근거: "다른 이유"]
**추적성** — \`base:lib/other.ts:1\` \`head:lib/other.ts:2\`
`;
			const r = checkStructure(withBackground(body), {
				signalFiles: ["lib/state-lock.ts"],
				step: "code",
			});
			const item = r.items.find((i) => i.id === "R1");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("lib/state-lock.ts");
		});

		test("같은 signal 파일의 파일 블록이 두 Change Group에 각각 있으면 실패하고 중복임을 밝힌다", () => {
			const duplicated = `${GOOD_GROUP}
## Change Group 2: 같은 파일을 또 다룬다
> 예고: 같은 파일이 다시 등장한다.
> 순서: 두 번째 손질이 필요하다.

### \`lib/state-lock.ts\`
**왜 필요한가** — [근거: "두 번째 이유"]
**추적성** — \`base:lib/state-lock.ts:14\` \`head:lib/state-lock.ts:20\`
`;
			const r = checkStructure(withBackground(duplicated), {
				signalFiles: ["lib/state-lock.ts"],
				step: "code",
			});
			const item = r.items.find((i) => i.id === "R1");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("lib/state-lock.ts");
			expect(item?.detail).toContain("중복");
		});

		test("signal 파일이 하나도 없으면 통과가 아니다 — 빈 집합 공허참 차단", () => {
			const r = checkStructure(withBackground(GOOD_GROUP), { signalFiles: [], step: "code" });
			expect(r.items.find((i) => i.id === "R1")?.pass).toBe(false);
		});
	});
});
