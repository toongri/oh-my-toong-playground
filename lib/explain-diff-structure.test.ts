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

function doc(body: string): string {
	return `# 설명\n\n## Background\n\n### 깊은 배경\n이미 익숙하면 건너뛰세요.\n내용\n\n### 좁은 배경\n내용\n\n${body}`;
}

describe("R1 — signal 파일 전수 등장", () => {
	test("모든 signal 파일이 등장하면 통과한다", () => {
		const r = checkStructure(doc(GOOD_GROUP), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R1")?.pass).toBe(true);
	});

	test("빠진 파일이 있으면 실패하고 그 경로를 사유에 담는다", () => {
		const r = checkStructure(doc(GOOD_GROUP), {
			signalFiles: ["lib/state-lock.ts", "tools/x/scripts/y.ts"],
		});
		const item = r.items.find((i) => i.id === "R1")!;
		expect(item.pass).toBe(false);
		expect(item.detail).toContain("tools/x/scripts/y.ts");
	});

	test("signal 파일이 하나도 없으면 통과가 아니다 — 빈 집합 공허참 차단", () => {
		const r = checkStructure(doc(GOOD_GROUP), { signalFiles: [] });
		expect(r.items.find((i) => i.id === "R1")?.pass).toBe(false);
	});
});

describe("R2 — Change Group 구조", () => {
	test("제목·예고·순서 세 슬롯이 다 있으면 통과한다", () => {
		const r = checkStructure(doc(GOOD_GROUP), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R2")?.pass).toBe(true);
	});

	test("예고 슬롯이 없으면 실패한다", () => {
		const body = GOOD_GROUP.replace(/^> 예고:.*$/m, "");
		const r = checkStructure(doc(body), { signalFiles: ["lib/state-lock.ts"] });
		const item = r.items.find((i) => i.id === "R2")!;
		expect(item.pass).toBe(false);
		expect(item.detail).toContain("예고");
	});

	test("그룹이 하나도 없으면 실패한다 — 베이스라인 16건이 전부 이 모양이었다", () => {
		const r = checkStructure(doc("### `lib/state-lock.ts`\n내용\n"), {
			signalFiles: ["lib/state-lock.ts"],
		});
		expect(r.items.find((i) => i.id === "R2")?.pass).toBe(false);
	});
});

describe("R3 — 왜의 출처 표시", () => {
	test("근거 인용이 붙어 있으면 통과한다", () => {
		const r = checkStructure(doc(GOOD_GROUP), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(true);
	});

	test("`[추론: ]` 라벨도 통과한다", () => {
		const body = GOOD_GROUP.replace(/\[근거:[^\]]*\]/, "[추론: 커밋 제목이 통합이라 말한다]");
		const r = checkStructure(doc(body), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(true);
	});

	test("`Unknown / not supplied` 도 통과한다", () => {
		const body = GOOD_GROUP.replace(
			/\*\*왜 필요한가\*\*.*$/m,
			"**왜 필요한가** — Unknown / not supplied",
		);
		const r = checkStructure(doc(body), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(true);
	});

	test("셋 다 없이 단정하면 실패한다 — 관측된 #5830 날조가 이 모양이다", () => {
		const body = GOOD_GROUP.replace(
			/\*\*왜 필요한가\*\*.*$/m,
			"**왜 필요한가** — 가로 스크롤이 없었던 것이 이슈 #5830이다",
		);
		const r = checkStructure(doc(body), { signalFiles: ["lib/state-lock.ts"] });
		const item = r.items.find((i) => i.id === "R3")!;
		expect(item.pass).toBe(false);
		expect(item.detail).toContain("lib/state-lock.ts");
	});
});

describe("R4 — Background 2단 + 건너뛰기 마커", () => {
	test("깊은 배경·좁은 배경·건너뛰기 마커가 다 있으면 통과한다", () => {
		const r = checkStructure(doc(GOOD_GROUP), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R4")?.pass).toBe(true);
	});

	test("건너뛰기 마커가 없으면 실패한다", () => {
		const text = doc(GOOD_GROUP).replace("이미 익숙하면 건너뛰세요.", "내용만 있다.");
		const r = checkStructure(text, { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R4")?.pass).toBe(false);
	});
});

describe("R5 — 추적성", () => {
	test("base/head 위치가 둘 다 있으면 통과한다", () => {
		const r = checkStructure(doc(GOOD_GROUP), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	test("head 위치가 없으면 실패한다", () => {
		const body = GOOD_GROUP.replace(/`head:[^`]*`/, "그 자리");
		const r = checkStructure(doc(body), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(false);
	});
});

describe("종합", () => {
	test("failedItems 는 실패 항목만 담아 거부 메시지에 그대로 실린다", () => {
		const r = checkStructure("빈 문서", { signalFiles: ["a.ts"] });
		expect(r.pass).toBe(false);
		expect(r.failedItems.length).toBeGreaterThan(0);
		expect(r.failedItems.every((s) => /^R[1-5] /.test(s))).toBe(true);
	});

	test("전부 통과하면 pass 이고 failedItems 가 비어 있다", () => {
		const r = checkStructure(doc(GOOD_GROUP), { signalFiles: ["lib/state-lock.ts"] });
		expect(r.pass).toBe(true);
		expect(r.failedItems).toEqual([]);
	});
});

describe("R5 — 신규 파일의 base 앵커", () => {
	const added = `## Change Group 1: 락을 도입한다

> 예고: 락이 무엇을 막는지 본다.
> 순서: 락이 없으면 나머지가 성립하지 않는다.

### \`lib/state-lock.ts\`

**왜 필요한가** — [근거: "동시 작성자 두 명"]

**추적성** — \`head:lib/state-lock.ts:15\`

## Background

### 깊은 배경
이미 아는 독자는 건너뛰세요.

### 좁은 배경
이 저장소의 락 규약.
`;

	test("신규 파일은 base 위치가 존재하지 않으므로 head 만으로 통과한다", () => {
		const r = checkStructure(added, {
			signalFiles: ["lib/state-lock.ts"],
			addedFiles: ["lib/state-lock.ts"],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	test("수정된 파일은 head 만으로는 통과하지 못한다 — 변경 전 위치를 답할 수 없다", () => {
		const r = checkStructure(added, { signalFiles: ["lib/state-lock.ts"], addedFiles: [] });
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(false);
		expect(r.items.find((i) => i.id === "R5")?.detail).toContain("lib/state-lock.ts");
	});

	test("addedFiles 를 주지 않으면 종전대로 양쪽을 요구한다", () => {
		const r = checkStructure(added, { signalFiles: ["lib/state-lock.ts"] });
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(false);
	});

	test("신규로 선언된 파일이라도 head 앵커가 없으면 실패한다", () => {
		const noHead = added.replace("`head:lib/state-lock.ts:15`", "그냥 새로 만들었다");
		const r = checkStructure(noHead, {
			signalFiles: ["lib/state-lock.ts"],
			addedFiles: ["lib/state-lock.ts"],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(false);
	});
});
