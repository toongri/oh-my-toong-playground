import { describe, expect, test } from "bun:test";
import { checkStructure } from "./explain-diff-structure";

// v4 계약: 코드 섹션의 뼈대는 커밋이다. Change Group(관심사) 안에서 커밋 단위로
// 내려가고(### `hash` — 제목), 커밋 아래 파일 블록(#### `file`)이 cf 컴포넌트로
// 필드를 분리하며, 파일마다 핵심 로직 코드 펜스를 하나 둔다. 독립 Commit Journey는
// 커밋을 그룹에 매핑하는 한 줄짜리 오버뷰로만 남는다.
const GOOD_GROUP = `## Change Group 1: 락을 공용 모듈로 뽑아낸다
> 예고: 먼저 락 자체를 옮겨 놓아야 호출부 정리가 의미를 갖는다.
> 순서: 추출이 먼저다 — 호출부를 먼저 고치면 가리킬 대상이 없다.

### \`ab12cd3\` — feat: 락을 공용 모듈로 추출
이 커밋이 락 획득/해제를 한 파일로 모은다.

#### \`lib/state-lock.ts\`
<div class="cf">
<p><strong>역할/변경 전</strong> — 이 파일은 새로 생겼다</p>
<p><strong>바뀐 것</strong> — 락 획득/해제가 여기로 모였다</p>
<p><strong>왜</strong> — 커밋 메시지가 통합이라고 적는다 <span class="cf-src">근거</span> "fix: 상태 갱신 락 통합"</p>
<p><strong>효과</strong> — 두 CLI가 같은 락을 쓴다</p>
<p class="cf-loc"><code>base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14</code></p>
</div>

\`\`\`ts
export function withLock(path, fn) {
  // 획득 → fn() → 해제
}
\`\`\`
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
		const input = JSON.parse('{"signalFiles":["a.ts"],"step":"bogus"}');
		expect(() => checkStructure("# 완전히 빈 문서", input)).toThrow();
	});
});

describe("code 스텝 — R2·R3·R5·R1(커버리지형)·R13", () => {
	test("Background까지만 있고 Change Group이 없으면 실패한다", () => {
		const r = checkStructure(withBackground(""), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.pass).toBe(false);
		expect(r.items.map((i) => i.id)).toEqual(["R2", "R3", "R5", "R1", "R13", "R11"]);
	});

	test("완전한 문서는 code 스텝에서 통과한다", () => {
		const r = checkStructure(withBackground(GOOD_GROUP), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.pass).toBe(true);
		expect(r.failedItems).toEqual([]);
	});

	test("예고 슬롯이 없으면 R2가 실패한다", () => {
		const body = GOOD_GROUP.replace(/^> 예고:.*$/m, "");
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		const item = r.items.find((i) => i.id === "R2");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("예고");
	});

	test("출처 태그 없이 왜를 단정하면 R3가 실패한다", () => {
		const body = GOOD_GROUP.replace(
			/<p><strong>왜<\/strong>.*<\/p>/,
			"<p><strong>왜</strong> — 가로 스크롤이 없었던 것이 이슈 #5830이다</p>",
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		const item = r.items.find((i) => i.id === "R3");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("lib/state-lock.ts");
	});

	test("추론 출처 태그도 R3를 통과시킨다", () => {
		const body = GOOD_GROUP.replace(
			/<span class="cf-src">근거<\/span> "[^"]*"/,
			'<span class="cf-src">추론</span> 커밋 제목이 통합이라 말한다',
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(true);
	});

	test("코드 펜스 주석 안의 왜 단어는 R3의 출처 판정에 새지 않는다", () => {
		// 핵심 로직 코드 펜스에 `// 왜냐하면` 같은 주석이 있어도, 파일 블록의 진짜
		// 왜 필드에 출처 태그가 없으면 실패해야 한다 — 펜스를 벗겨내고 판정한다.
		const body = GOOD_GROUP.replace(
			/<p><strong>왜<\/strong>.*<\/p>/,
			"<p><strong>왜</strong> — 출처 없는 단정</p>",
		).replace("// 획득 → fn() → 해제", "// 왜 이렇게 하냐면 [근거: 없음]");
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(false);
	});

	test("head 위치가 없으면 R5가 실패한다", () => {
		const body = GOOD_GROUP.replace(/head:lib\/state-lock\.ts:14/, "그자리");
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(false);
	});

	test("신규 파일은 base 위치가 존재하지 않으므로 head 만으로 R5를 통과한다", () => {
		const added = `## Change Group 1: 락을 도입한다
> 예고: 락이 무엇을 막는지 본다.
> 순서: 락이 없으면 나머지가 성립하지 않는다.

### \`ab12cd3\` — feat: 락 도입
동시 작성자 두 명을 막는 락을 새로 넣는다.

#### \`lib/state-lock.ts\`
<div class="cf">
<p><strong>역할/변경 전</strong> — 이 파일은 새로 생겼다</p>
<p><strong>바뀐 것</strong> — 락 획득/해제를 새로 넣었다</p>
<p><strong>왜</strong> — <span class="cf-src">근거</span> "동시 작성자 두 명"</p>
<p><strong>효과</strong> — 두 CLI가 같은 락을 쓴다</p>
<p class="cf-loc"><code>base:신규 파일</code> → <code>head:lib/state-lock.ts:15</code></p>
</div>

\`\`\`ts
export function withLock() {}
\`\`\`
`;
		const r = checkStructure(withBackground(added), {
			signalFiles: ["lib/state-lock.ts"],
			addedFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	describe("R13 — 커밋이 그룹의 뼈대이고 파일마다 핵심 로직 코드가 있다", () => {
		test("그룹에 커밋 서브섹션이 하나도 없으면 실패한다", () => {
			// 파일 블록을 그룹 바로 아래 두고 커밋 서브섹션을 생략한 옛 평면 구조.
			const flat = `## Change Group 1: 락 추출
> 예고: 락을 옮긴다.
> 순서: 추출이 먼저다.

#### \`lib/state-lock.ts\`
<div class="cf">
<p><strong>왜</strong> — <span class="cf-src">근거</span> "통합"</p>
<p class="cf-loc"><code>base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14</code></p>
</div>

\`\`\`ts
export function withLock() {}
\`\`\`
`;
			const r = checkStructure(withBackground(flat), {
				signalFiles: ["lib/state-lock.ts"],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			const item = r.items.find((i) => i.id === "R13");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("Change Group 1");
		});

		test("커밋 서브섹션의 해시가 실제 범위 커밋이 아니면 실패한다", () => {
			const body = GOOD_GROUP.replace("### `ab12cd3`", "### `deadbee`");
			const r = checkStructure(withBackground(body), {
				signalFiles: ["lib/state-lock.ts"],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			const item = r.items.find((i) => i.id === "R13");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("deadbee");
		});

		test("파일 블록에 핵심 로직 코드 펜스가 없으면 실패하고 그 파일을 담는다", () => {
			const body = GOOD_GROUP.replace(/```ts[\s\S]*?```/, "");
			const r = checkStructure(withBackground(body), {
				signalFiles: ["lib/state-lock.ts"],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			const item = r.items.find((i) => i.id === "R13");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("lib/state-lock.ts");
		});
	});

	describe("R1 커버리지형 — signal 파일이 파일 블록으로 정확히 한 번", () => {
		test("signal 파일이 Evidence 표에만 있고 파일 블록이 없으면 실패하고 경로를 담는다", () => {
			const body = `## Evidence

| 파일 | 분류 |
|---|---|
| \`lib/state-lock.ts\` | signal |

## Change Group 1: 관련 없는 변경
> 예고: 다른 파일을 다룬다.
> 순서: 순서상 이유가 있다.

### \`ab12cd3\` — fix: 다른 변경
다른 파일을 고친다.

#### \`lib/other.ts\`
<div class="cf">
<p><strong>왜</strong> — <span class="cf-src">근거</span> "다른 이유"</p>
<p class="cf-loc"><code>base:lib/other.ts:1</code> → <code>head:lib/other.ts:2</code></p>
</div>

\`\`\`ts
const x = 1;
\`\`\`
`;
			const r = checkStructure(withBackground(body), {
				signalFiles: ["lib/state-lock.ts"],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			const item = r.items.find((i) => i.id === "R1");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("lib/state-lock.ts");
		});

		test("같은 signal 파일 블록이 두 그룹에 각각 있으면 실패하고 중복임을 밝힌다", () => {
			const duplicated = `${GOOD_GROUP}
## Change Group 2: 같은 파일을 또 다룬다
> 예고: 같은 파일이 다시 등장한다.
> 순서: 두 번째 손질이 필요하다.

### \`ef45ab6\` — fix: 두 번째 손질
같은 파일을 다시 만진다.

#### \`lib/state-lock.ts\`
<div class="cf">
<p><strong>왜</strong> — <span class="cf-src">근거</span> "두 번째 이유"</p>
<p class="cf-loc"><code>base:lib/state-lock.ts:14</code> → <code>head:lib/state-lock.ts:20</code></p>
</div>

\`\`\`ts
const y = 2;
\`\`\`
`;
			const r = checkStructure(withBackground(duplicated), {
				signalFiles: ["lib/state-lock.ts"],
				step: "code",
				commitHashes: ["ab12cd3f00", "ef45ab6c11"],
			});
			const item = r.items.find((i) => i.id === "R1");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("lib/state-lock.ts");
			expect(item?.detail).toContain("중복");
		});

		test("signal 파일이 하나도 없으면 통과가 아니다 — 빈 집합 공허참 차단", () => {
			const r = checkStructure(withBackground(GOOD_GROUP), {
				signalFiles: [],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			expect(r.items.find((i) => i.id === "R1")?.pass).toBe(false);
		});

		test("헤딩 백틱 뒤 괄호 주석(삭제·이동 표기)이 붙어도 파일 블록으로 센다", () => {
			const annotated = `## Change Group 1: 테스트 계약 교체
> 예고: 옛 계약 테스트를 지운다.
> 순서: 복원 코드가 먼저 있어야 한다.

### \`ab12cd3\` — refactor: 계약 테스트 교체
v1 복원으로 사라진 404 계약 테스트를 지운다.

#### \`tests/api/removed_routes.py\` (삭제)
<div class="cf">
<p><strong>왜</strong> — <span class="cf-src">근거</span> "v1 복원으로 404 계약이 사라졌다"</p>
<p class="cf-loc"><code>base:tests/api/removed_routes.py:12</code> → <code>head:삭제됨</code></p>
</div>

\`\`\`py
# 이 파일은 통째로 삭제된다
\`\`\`
`;
			const r = checkStructure(withBackground(annotated), {
				signalFiles: ["tests/api/removed_routes.py"],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			expect(r.items.find((i) => i.id === "R1")?.pass).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// v3/v4 확장 — R9·R14(아키텍처), R10(커밋 오버뷰), R11(스타일 발명 금지)

const ARCH_OK = `## Architecture

### 시스템 레벨
\`\`\`mermaid
flowchart LR
  A[Node backend] --> B[(PostgreSQL)]
\`\`\`

| 축 | 이번에 바뀌는 계약 |
|---|---|
| 서버 API | \`calculateSupplementCost\` 입력 스키마가 좁아진다 |
| DB 스키마 | 변경 없음: 조인 방식만 바뀐다 |
| 클라이언트 의존 | 챗이 의존하는 공유 계약이 category 단일로 좁아진다 |

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

describe("architecture 스텝 — R9·R14", () => {
	test("세 레벨이 각각 mermaid/생략 마커를 갖고 시스템 레벨에 계약 3축이 있으면 통과한다", () => {
		const r = checkStructure(withBackground(ARCH_OK), {
			signalFiles: ["lib/state-lock.ts"],
			step: "architecture",
		});
		expect(r.items.map((i) => i.id)).toContain("R9");
		expect(r.items.map((i) => i.id)).toContain("R14");
		expect(r.pass).toBe(true);
	});

	test("레벨 헤딩이 하나라도 빠지면 R9가 실패하고 그 레벨 이름을 사유에 담는다", () => {
		const doc = withBackground(ARCH_OK.replace(/### 도메인 레벨[\s\S]*$/, ""));
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" });
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("도메인 레벨");
	});

	test("레벨에 mermaid도 생략 마커도 없으면 R9가 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace(/구조 변화 없음.*$/m, "산문만 있다."));
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" });
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("도메인 레벨");
	});

	test("생략 마커에 사유가 없으면 R9가 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace(/구조 변화 없음.*$/m, "구조 변화 없음:"));
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" });
		expect(r.pass).toBe(false);
	});

	test("시스템 레벨에 계약 3축 중 하나라도 빠지면 R14가 실패하고 빠진 축을 담는다", () => {
		const doc = withBackground(ARCH_OK.replace(/\| DB 스키마 \|[^\n]*\n/, ""));
		const r = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" });
		const item = r.items.find((i) => i.id === "R14");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("DB 스키마");
	});
});

const OVERVIEW = `## Commit Journey

1. \`ab12cd3\` feat — 첫 커밋 → 그룹 1
2. \`ef45ab6\` fix — 둘째 커밋 → 그룹 1
`;

describe("commits 스텝 — R10 (한 줄 오버뷰)", () => {
	test("커밋 2개 이상이면 각 해시가 오버뷰 본문에 등장해야 통과한다", () => {
		const r = checkStructure(withBackground(OVERVIEW), {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: ["ab12cd3f00", "ef45ab6c11"],
		});
		expect(r.items.map((i) => i.id)).toContain("R10");
		expect(r.pass).toBe(true);
	});

	test("빠진 커밋이 있으면 실패하고 그 해시를 사유에 담는다", () => {
		const r = checkStructure(withBackground(OVERVIEW), {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: ["ab12cd3f00", "ef45ab6c11", "99dead000"],
		});
		expect(r.pass).toBe(false);
		expect(r.failedItems.join(" ")).toContain("99dead0");
	});

	test("Commit Journey 밖에 있는 해시는 누락 커밋을 대체하지 않는다", () => {
		const doc = `## Commit Journey

1. \`ab12cd3\` feat — 첫 커밋 → 그룹 1

## Background
### 무관한 헤딩 \`ef45ab6\`
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

	test("단일 커밋인데 오버뷰도 마커도 없으면 실패한다", () => {
		const r = checkStructure(withBackground("본문.\n"), {
			signalFiles: ["a.ts"],
			step: "commits",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.pass).toBe(false);
	});

	test("해시 목록이 비어 있으면(열거 실패) 섹션 존재 또는 마커만 요구한다", () => {
		const r = checkStructure(withBackground(OVERVIEW), {
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

	test("승인된 컴포넌트 클래스(cf 계열 포함)만 쓰면 통과한다", () => {
		const doc = `${evidenceOnlyDoc("a.ts")}
<div class="flow">
  <div class="flow-step">A</div><span class="flow-arrow">→</span>
  <div class="flow-step">B</div>
</div>
<div class="cf">
<p><strong>왜</strong> — <span class="cf-src">근거</span> "x"</p>
<p class="cf-loc"><code>head:a.ts:1</code></p>
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

// 코드리뷰(codex 봇, PR #264)가 지적한 게이트 이완 중 측정 기반 유지분 —
// R3 출처 배지 형식, R13 코드 펜스 실체. 세밀 강제(cf 필드·배치·값 셀·cf-loc
// 형식)는 추상 지시로 되돌려 게이트에서 뺐다.
describe("게이트 이완 보강 — R3 배지 형식·R13 코드 펜스", () => {
	test("R3 — cf-src 배지 텍스트가 세 라벨(근거/추론/Unknown)이 아니면 실패한다", () => {
		const body = GOOD_GROUP.replace(
			/<span class="cf-src">근거<\/span> "[^"]*"/,
			'<span class="cf-src">garbage</span>',
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		const item = r.items.find((i) => i.id === "R3");
		expect(item?.pass).toBe(false);
	});

	test("R3 — 빈 cf-src 배지도 실패한다", () => {
		const body = GOOD_GROUP.replace(
			/<span class="cf-src">근거<\/span> "[^"]*"/,
			'<span class="cf-src"></span>',
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(false);
	});

	test("R13 — 파일 블록의 유일한 펜스가 mermaid면 핵심 로직 코드로 인정되지 않는다", () => {
		const body = GOOD_GROUP.replace(
			/```ts[\s\S]*?```/,
			"```mermaid\nflowchart LR\n  A --> B\n```",
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		const item = r.items.find((i) => i.id === "R13");
		expect(item?.pass).toBe(false);
	});

	test("R13 — 빈 코드 펜스는 핵심 로직 코드로 인정되지 않는다", () => {
		const body = GOOD_GROUP.replace(/```ts[\s\S]*?```/, "```ts\n```");
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.items.find((i) => i.id === "R13")?.pass).toBe(false);
	});

});

// R3 출처 배지의 말미 내용 요구(근거+인용·추론+ground) — 측정 기반 유지분.
describe("게이트 이완 보강 — R3 배지 말미 내용", () => {
	test("R3 — `근거` 배지 뒤에 인용이 없으면 실패한다", () => {
		const body = GOOD_GROUP.replace(
			/<span class="cf-src">근거<\/span> "[^"]*"/,
			'<span class="cf-src">근거</span>',
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(false);
	});

	test("R3 — `추론` 배지 뒤에 근거 텍스트가 없으면 실패한다", () => {
		const body = GOOD_GROUP.replace(
			/<span class="cf-src">근거<\/span> "[^"]*"/,
			'<span class="cf-src">추론</span>',
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
		});
		expect(r.items.find((i) => i.id === "R3")?.pass).toBe(false);
	});
});

describe("게이트 이완 보강 — R14 펜스 마스킹", () => {
	// 펜스 안 예시 표는 R14를 만족시키지 못한다(fence 마스킹 — 진짜 일관성 수정, 유지분)
	test("R14 — 계약 3축이 펜스 예시 안에만 있으면 실패한다", () => {
		const fenced = `## Architecture

### 시스템 레벨
\`\`\`mermaid
flowchart LR
  A[Node] --> B[(PG)]
\`\`\`

표는 이렇게 씁니다:

\`\`\`markdown
| 축 | 이번에 바뀌는 계약 |
|---|---|
| 서버 API | 좁아진다 |
| DB 스키마 | 변경 없음: 조인만 |
| 클라이언트 의존 | 좁아진다 |
\`\`\`

### 컴포넌트 레벨
구조 변화 없음: 이 diff는 모듈 의존을 건드리지 않는다.

### 도메인 레벨
구조 변화 없음: 엔티티 관계는 바뀌지 않는다.
`;
		const r = checkStructure(withBackground(fenced), {
			signalFiles: ["a.ts"],
			step: "architecture",
		});
		expect(r.items.find((i) => i.id === "R14")?.pass).toBe(false);
	});
});
