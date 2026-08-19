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

	test("evidence 스텝에는 R1과 공통 R11 외의 항목이 평가되지 않는다", () => {
		const r = checkStructure(evidenceOnlyDoc("lib/state-lock.ts"), {
			signalFiles: ["lib/state-lock.ts"],
			step: "evidence",
		});
		expect(r.items.map((i) => i.id)).toEqual(["R1", "R11"]);
	});
});

describe("background 스텝 — R4만 평가", () => {
	test("Evidence 절만 있는 문서는 background 스텝에서 실패한다 — R4 미충족", () => {
		const r = checkStructure(evidenceOnlyDoc("lib/state-lock.ts"), {
			signalFiles: ["lib/state-lock.ts"],
			step: "background",
		});
		expect(r.pass).toBe(false);
		expect(r.items.map((i) => i.id)).toEqual(["R4", "R11"]);
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

describe("intuition 스텝 — 고유 구조 항목 없음 (공통 R11만)", () => {
	test("스타일 위반이 없는 최소 문서는 통과한다", () => {
		const r = checkStructure("# 설명\n\n본질만 적힌 한 줄.", {
			signalFiles: ["lib/state-lock.ts"],
			step: "intuition",
		});
		expect(r.pass).toBe(true);
		expect(r.items.map((i) => i.id)).toEqual(["R11"]);
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
		expect(r.items.map((i) => i.id)).toEqual(["R2", "R3", "R5", "R1", "R11"]);
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

		test("헤딩 백틱 뒤 괄호 주석(삭제·이동 표기)이 붙어도 파일 블록으로 센다", () => {
			// 실측: PR 3402 문서가 삭제 파일을 "### `path` (삭제)" 로 표기했고,
			// 줄 끝 앵커 때문에 블록이 0으로 세어져 R1 이 오탐했다.
			const annotated = `## Change Group 1: 테스트 계약 교체
> 예고: 옛 계약 테스트를 지운다.
> 순서: 복원 코드가 먼저 있어야 한다.

### \`tests/api/removed_routes.py\` (삭제)
**왜 필요한가** — [근거: "v1 복원으로 404 계약이 사라졌다"]
**추적성** — \`base:tests/api/removed_routes.py:12\` \`head:없음\`
`;
			const r = checkStructure(withBackground(annotated), {
				signalFiles: ["tests/api/removed_routes.py"],
				step: "code",
			});
			expect(r.items.find((i) => i.id === "R1")?.pass).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// v3 확장 — R9(아키텍처 3레벨), R10(커밋 저니), R11(스타일 발명 금지)

const ARCH_OK = `## Architecture

### 시스템 레벨
\`\`\`mermaid
flowchart LR
  A[Node backend] --> B[(PostgreSQL)]
\`\`\`
설명.

### 컴포넌트 레벨
\`\`\`mermaid
flowchart LR
  order --> couponHandler
\`\`\`
설명.

### 도메인 레벨
구조 변화 없음: 엔티티 관계는 이 diff에서 바뀌지 않는다.
`;

describe("architecture 스텝 — R9", () => {
	test("세 레벨이 각각 mermaid 블록 또는 생략 마커를 가지면 통과한다", () => {
		const r = checkStructure(withBackground(ARCH_OK), {
			signalFiles: ["lib/state-lock.ts"],
			step: "architecture",
		});
		expect(r.items.map((i) => i.id)).toContain("R9");
		expect(r.pass).toBe(true);
	});

	test("레벨 헤딩이 하나라도 빠지면 실패하고 그 레벨 이름을 사유에 담는다", () => {
		const doc = withBackground(ARCH_OK.replace(/### 도메인 레벨[\s\S]*$/, ""));
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" });
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("도메인 레벨");
	});

	test("레벨에 mermaid도 생략 마커도 없으면 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace(/구조 변화 없음.*$/m, "산문만 있다."));
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" });
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("도메인 레벨");
	});

	test("생략 마커에 사유가 없으면 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace(/구조 변화 없음.*$/m, "구조 변화 없음:"));
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" });
		expect(r.pass).toBe(false);
	});
});

const JOURNEY = `## Commit Journey

### 1. \`ab12cd3\` — feat: 첫 커밋
무엇을 만들었나 — 내용.

### 2. \`ef45ab6\` — fix: 둘째 커밋
무엇을 고쳤나 — 내용.
`;

describe("commits 스텝 — R10", () => {
	test("커밋 2개 이상이면 각 해시가 헤딩에 등장해야 통과한다", () => {
		const r = checkStructure(withBackground(JOURNEY), {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: ["ab12cd3f00", "ef45ab6c11"],
		});
		expect(r.items.map((i) => i.id)).toContain("R10");
		expect(r.pass).toBe(true);
	});

	test("빠진 커밋이 있으면 실패하고 그 해시를 사유에 담는다", () => {
		const r = checkStructure(withBackground(JOURNEY), {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: ["ab12cd3f00", "ef45ab6c11", "99dead000"],
		});
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("99dead0");
	});

	test("Commit Journey 밖 헤딩의 해시는 누락 커밋 블록을 대체하지 않는다", () => {
		const doc = `## Commit Journey

### 1. \`ab12cd3\` — feat: 첫 커밋
무엇을 만들었나 — 내용.

## Background
### unrelated heading \`ef45ab6\`
`;
		const r = checkStructure(doc, {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: ["ab12cd3f00", "ef45ab6c11"],
		});
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("ef45ab6");
	});

	test("단일 커밋 범위는 생략 마커로 통과한다", () => {
		const doc = withBackground("단일 커밋 범위 — Commit Journey 생략.\n");
		const r = checkStructure(doc, {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.pass).toBe(true);
	});

	test("단일 커밋인데 저니도 마커도 없으면 실패한다", () => {
		const r = checkStructure(withBackground("본문.\n"), {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.pass).toBe(false);
	});

	test("해시 목록이 비어 있으면(열거 실패) 섹션 존재 또는 마커만 요구한다", () => {
		const r = checkStructure(withBackground(JOURNEY), {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: [],
		});
		expect(r.pass).toBe(true);
	});
});

describe("모든 저작 스텝 — R11 스타일 발명 금지", () => {
	test("<style> 블록이 있으면 evidence 스텝부터 실패한다", () => {
		const doc = `${evidenceOnlyDoc("a.ts")}\n<style>h1 { color: red; }</style>\n`;
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "evidence" });
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("<style>");
	});

	test("인라인 style= 속성이 있으면 실패한다", () => {
		const doc = `${evidenceOnlyDoc("a.ts")}\n<div style="color:red">x</div>\n`;
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "evidence" });
		expect(r.pass).toBe(false);
	});

	test("단일 인용부호의 style과 승인 목록 밖 class도 실패한다", () => {
		const doc = `${evidenceOnlyDoc("a.ts")}\n<div style='color:red' class='invented'>x</div>\n`;
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "evidence" });
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("invented");
	});

	test("fenced HTML 예시는 R11 스타일 위반이 아니다", () => {
		const doc = ["# 설명", "", "```html", '<div style="color:red" class="invented">x</div>', "```"].join("\n");
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "intuition" });
		expect(r.pass).toBe(true);
	});

	test("인라인 HTML 예시는 R11 스타일 위반이 아니다", () => {
		const doc = "# 설명\n\n`<div style=\"color:red\" class=\"invented\">x</div>`";
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "intuition" });
		expect(r.pass).toBe(true);
	});

	test("승인 목록 밖의 class를 쓰면 실패하고 그 클래스명을 사유에 담는다", () => {
		const doc = `${evidenceOnlyDoc("a.ts")}\n<div class="my-fancy-box">x</div>\n`;
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "evidence" });
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("my-fancy-box");
	});

	test("승인된 컴포넌트 클래스만 쓰면 통과한다", () => {
		const doc = `${evidenceOnlyDoc("a.ts")}
<div class="flow">
  <div class="flow-step">A</div><span class="flow-arrow">→</span>
  <div class="flow-step">B</div>
</div>
<div class="compare">
  <div class="compare-before">전</div>
  <div class="compare-after">후</div>
</div>
`;
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "evidence" });
		expect(r.pass).toBe(true);
	});

	test("intuition 스텝에서도 R11은 평가된다", () => {
		const doc = `# 설명\n\n## Intuition\n<div style="display:grid">x</div>\n`;
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "intuition" });
		expect(r.pass).toBe(false);
	});
});
