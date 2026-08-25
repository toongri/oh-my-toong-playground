import { describe, expect, test } from "bun:test";
import { checkStructure, type DiffHunk } from "./explain-diff-structure";

// v5 계약: 코드 섹션의 뼈대는 커밋이고, 단위는 파일이 아니라 변경(change)이다.
// Change Group(관심사) 안에서 커밋 단위로 내려가고(### `hash` — 제목), 커밋 아래
// 변경 블록(#### 변경 N: <한 일>)이 cf 컴포넌트로 필드를 분리한다. 한 변경은 여러
// 책임(함께 바뀐 class·function) 항목으로 이뤄지고, 파일은 heading이 아니라 `바뀐 위치`
// (cf-loc)의 위치 인용으로만 등장한다. R1 커버리지는 모든 signal 파일이 어느 변경 블록에든
// 인용되는지를, R5는 그 인용이 실제 hunk에 드는지를, R13은 커밋 뼈대 + 변경당 코드 하나를 본다.
const GOOD_GROUP = `## Change Group 1: 락을 공용 모듈로 뽑아낸다
> 예고: 먼저 락 자체를 옮겨 놓아야 호출부 정리가 의미를 갖는다.
> 순서: 추출이 먼저다 — 호출부를 먼저 고치면 가리킬 대상이 없다.

### \`ab12cd3\` — feat: 락을 공용 모듈로 추출
이 커밋이 락 획득/해제를 한 파일로 모은다.

#### 변경 1: 락 획득·해제를 공용 모듈로 추출
<div class="cf" data-change="new">
<p><strong>책임 1 — 공용 락 유틸</strong> — <code>withLock()</code> (state 도메인의 락 유틸). 획득→실행→해제를 한 함수로 모은다.</p>
<p><strong>왜</strong> — 두 CLI가 같은 락을 공유해야 하기 때문 <span class="cf-src">근거</span> "fix: 상태 갱신 락 통합"</p>
<p><strong>효과·사이드이펙트</strong> — 두 CLI가 같은 락을 쓰므로 상태 파일 경쟁이 직렬화된다.</p>
<p><strong>검증</strong> — state-lock.test.ts 가 동시 획득 직렬화를 고정한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14</code></p>
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

const GOAL = `## 목표

### 무엇을·왜
반복 오류 테스트가 실행 준비를 매번 다시 쓰지 않도록 공통 helper를 복원한다.

### 핵심
코드를 보기 전에: 이 변경은 "도구 실행 준비"를 한 함수로 모은 작은 어댑터다.

### 출처
커밋 본문 "helper 복원"과 코드 추론.
`;

describe("goal 스텝 — R16만 평가", () => {
	test("목표 섹션이 아예 없으면 R16이 실패하고 없는 슬롯을 담는다", () => {
		const r = checkStructure(evidenceOnlyDoc("lib/state-lock.ts"), {
			signalFiles: ["lib/state-lock.ts"],
			step: "goal",
		});
		expect(r.pass).toBe(false);
		expect(r.items.map((i) => i.id)).toEqual(["R16", "R11"]);
		expect(r.items.find((i) => i.id === "R16")?.pass).toBe(false);
		expect(r.items.find((i) => i.id === "R16")?.detail).toContain("목표");
	});

	test("무엇을·왜 + 핵심 두 슬롯이 다 있으면 통과한다", () => {
		const r = checkStructure(`# 설명\n\n${GOAL}`, {
			signalFiles: ["lib/state-lock.ts"],
			step: "goal",
		});
		expect(r.items.find((i) => i.id === "R16")?.pass).toBe(true);
	});

	test("핵심 슬롯이 빠지면 R16이 실패하고 그 슬롯을 사유에 담는다", () => {
		const doc = `# 설명\n\n${GOAL.replace(/### 핵심[\s\S]*$/, "")}`;
		const r = checkStructure(doc, { signalFiles: ["lib/state-lock.ts"], step: "goal" });
		const item = r.items.find((i) => i.id === "R16");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("핵심");
	});

	test("무엇을·왜 슬롯이 빠지면 R16이 실패한다", () => {
		const doc = `# 설명\n\n${GOAL.replace(/### 무엇을·왜[\s\S]*?(?=### 핵심)/, "")}`;
		const r = checkStructure(doc, { signalFiles: ["lib/state-lock.ts"], step: "goal" });
		expect(r.items.find((i) => i.id === "R16")?.pass).toBe(false);
	});

	test("출처 슬롯이 빠지면 R16이 실패하고 그 슬롯을 사유에 담는다", () => {
		const doc = `# 설명\n\n${GOAL.replace(/### 출처[\s\S]*$/, "")}`;
		const r = checkStructure(doc, { signalFiles: ["lib/state-lock.ts"], step: "goal" });
		const item = r.items.find((i) => i.id === "R16");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("출처");
	});

	test("출처 헤딩만 있고 내용이 비어 있으면 R16이 실패한다", () => {
		const doc = `# 설명

## 목표

### 무엇을·왜
상태 갱신 경합을 없앤다.

### 핵심
락 획득과 해제를 공용 함수로 모은다.

### 출처
`;
		const r = checkStructure(doc, { signalFiles: ["lib/state-lock.ts"], step: "goal" });
		const item = r.items.find((i) => i.id === "R16");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("출처");
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
		expect(item?.detail).toContain("변경 1");
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
		// 핵심 로직 코드 펜스에 `// 왜냐하면` 같은 주석이 있어도, 변경 블록의 진짜
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

#### 변경 1: 락을 도입한다
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

	test("텍스트 hunk가 없는 파일은 파일 단위 legacy R5 규칙으로 검사한다", () => {
		const strict = GOOD_GROUP.replace(
			"base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14",
			"base:lib/state-lock.ts:2</code> → <code>head:lib/state-lock.ts:14",
		);
		const fallbackPath = "assets/mode-only.png";
		const fallback = `## Change Group 2: 바이너리 메타데이터
> 예고: 텍스트 변경과 함께 비텍스트 파일도 기록한다.
> 순서: 텍스트 hunk 검증 뒤 파일 존재를 확인한다.

### \`ef45ab6\` — chore: 이미지 메타데이터 갱신
비텍스트 파일은 텍스트 hunk가 없다.

#### 변경 2: 비텍스트 파일 위치를 기록한다
<div class="cf">
<p class="cf-loc"><code>base:${fallbackPath}:12</code> → <code>head:${fallbackPath}:20</code></p>
</div>

\`\`\`text
binary placeholder
\`\`\`
`;
		const r = checkStructure(withBackground(`${strict}\n${fallback}`), {
			signalFiles: ["lib/state-lock.ts", fallbackPath],
			step: "code",
			commitHashes: ["ab12cd3f00", "ef45ab6c11"],
			diffHunks: [
				{
					path: "lib/state-lock.ts",
					base: { start: 2, count: 4 },
					head: { start: 14, count: 5 },
				},
			],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	test("공백이 있는 경로의 strict·fallback 앵커는 변경 블록 위치와 일치하면 통과한다", () => {
		const strictPath = "src/strict file.ts";
		const fallbackPath = "assets/mode only file.bin";
		const strict = GOOD_GROUP.replace(/lib\/state-lock\.ts/g, strictPath).replace(
			`base:${strictPath}:0</code> → <code>head:${strictPath}:14`,
			`base:${strictPath}:12</code> → <code>head:${strictPath}:18`,
		);
		const fallback = `## Change Group 2: 비텍스트 경로
> 예고: 공백 경로도 기록한다.
> 순서: 텍스트 파일의 hunk 뒤 fallback 파일을 확인한다.

### \`ef45ab6\` — chore: 공백 경로 기록
공백이 있는 비텍스트 경로다.

#### 변경 2: 공백 경로의 위치를 기록한다
<div class="cf">
<p class="cf-loc"><code>base:${fallbackPath}:12</code> → <code>head:${fallbackPath}:20</code></p>
</div>
`;
		const r = checkStructure(withBackground(`${strict}\n${fallback}`), {
			signalFiles: [strictPath, fallbackPath],
			step: "code",
			commitHashes: ["ab12cd3f00", "ef45ab6c11"],
			diffHunks: [
				{
					path: strictPath,
					base: { start: 12, count: 4 },
					head: { start: 18, count: 5 },
				},
			],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	// 실측(luna max): 수정 파일인데 cf-loc를 base:…:1 → head:…:1 플레이스홀더로 채워
	// (29건) 실제 변경 hunk를 가리키지 않았다. 두 앵커가 다 있어 존재검사(R5)는 통과했다.
	// base·head 라인이 둘 다 1이면 추적성이 없는 플레이스홀더로 판정해 거부한다.
	test("수정 파일 cf-loc가 :1 → :1 플레이스홀더면 R5가 실패한다", () => {
		const body = GOOD_GROUP.replace(
			"base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14",
			"base:lib/state-lock.ts:1</code> → <code>head:lib/state-lock.ts:1",
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		const item = r.items.find((i) => i.id === "R5");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("lib/state-lock.ts");
	});

	test("실제 hunk가 양쪽 모두 1행에서 시작하면 :1 → :1을 R5가 허용한다", () => {
		const body = GOOD_GROUP.replace(
			"base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14",
			"base:lib/state-lock.ts:1</code> → <code>head:lib/state-lock.ts:1",
		);
		const diffHunks: DiffHunk[] = [
			{
				path: "lib/state-lock.ts",
				base: { start: 1, count: 4 },
				head: { start: 1, count: 5 },
			},
		];
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
			diffHunks,
		});
		const item = r.items.find((i) => i.id === "R5");
		expect(item?.pass).toBe(true);
	});

	test("메타데이터의 hunk가 다른 위치면 :1 → :1을 여전히 거부한다", () => {
		const body = GOOD_GROUP.replace(
			"base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14",
			"base:lib/state-lock.ts:1</code> → <code>head:lib/state-lock.ts:1",
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
			diffHunks: [
				{
					path: "lib/state-lock.ts",
					base: { start: 20, count: 4 },
					head: { start: 20, count: 5 },
				},
			],
		});
		const item = r.items.find((i) => i.id === "R5");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("lib/state-lock.ts");
	});

	test("숫자 앵커가 보고된 hunk 범위를 벗어나면 R5가 실패한다", () => {
		const body = GOOD_GROUP.replace(
			"base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14",
			"base:lib/state-lock.ts:25</code> → <code>head:lib/state-lock.ts:35",
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
			diffHunks: [
				{
					path: "lib/state-lock.ts",
					base: { start: 20, count: 4 },
					head: { start: 30, count: 5 },
				},
			],
		});
		const item = r.items.find((i) => i.id === "R5");
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("hunk");
	});

	test("메타데이터에서 base가 없는 신규 파일은 head hunk만 검증한다", () => {
		const added = `## Change Group 1: 락을 도입한다
> 예고: 락이 무엇을 막는지 본다.
> 순서: 락이 없으면 나머지가 성립하지 않는다.

### \`ab12cd3\` — feat: 락 도입
동시 작성자 두 명을 막는 락을 새로 넣는다.

#### 변경 1: 락을 도입한다
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
			diffHunks: [
				{
					path: "lib/state-lock.ts",
					base: null,
					head: { start: 15, count: 1 },
				},
			],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	test("삭제 파일은 null head side에 대해 base hunk만 검증한다", () => {
		const body = GOOD_GROUP.replace(
			"base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14",
			"base:lib/state-lock.ts:1</code> → <code>head:삭제됨",
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
			diffHunks: [
				{
					path: "lib/state-lock.ts",
					base: { start: 1, count: 4 },
					head: null,
				},
			],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	test("실제 라인 번호를 가리키는 cf-loc는 R5를 통과한다", () => {
		const body = GOOD_GROUP.replace(
			"base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14",
			"base:lib/state-lock.ts:325</code> → <code>head:lib/state-lock.ts:590",
		);
		const r = checkStructure(withBackground(body), {
			signalFiles: ["lib/state-lock.ts"],
			step: "code",
			commitHashes: ["ab12cd3f00"],
		});
		expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
	});

	describe("R13 — 커밋이 그룹의 뼈대이고 변경마다 핵심 로직 코드가 있다", () => {
		test("그룹에 커밋 서브섹션이 하나도 없으면 실패한다", () => {
			// 변경 블록을 그룹 바로 아래 두고 커밋 서브섹션을 생략한 옛 평면 구조.
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

		test("변경 블록에 핵심 로직 코드 펜스가 없으면 실패하고 그 변경을 담는다", () => {
			const body = GOOD_GROUP.replace(/```ts[\s\S]*?```/, "");
			const r = checkStructure(withBackground(body), {
				signalFiles: ["lib/state-lock.ts"],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			const item = r.items.find((i) => i.id === "R13");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("변경 1");
		});
	});

	describe("R1 커버리지형 — signal 파일이 어느 변경 블록엔가 인용된다", () => {
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

		test("같은 signal 파일이 두 변경 블록에 인용돼도 통과한다 — 한 파일은 여러 변경에 참여할 수 있다", () => {
			const duplicated = `${GOOD_GROUP}
## Change Group 2: 같은 파일을 또 다룬다
> 예고: 같은 파일이 다른 변경에서 다시 등장한다.
> 순서: 두 번째 손질이 필요하다.

### \`ef45ab6\` — fix: 두 번째 손질
같은 파일을 다른 이유로 다시 만진다.

#### 변경 2: 락 해제 타임아웃을 추가
<div class="cf" data-change="mod">
<p><strong>책임 1 — 락 해제</strong> — <code>withLock()</code> (state 도메인의 락 유틸). 해제에 타임아웃을 건다.</p>
<p><strong>왜</strong> — 데드락 방지 <span class="cf-src">근거</span> "fix: 락 해제 타임아웃"</p>
<p><strong>효과·사이드이펙트</strong> — 무한 대기 대신 타임아웃으로 실패한다.</p>
<p><strong>검증</strong> — state-lock.test.ts 가 타임아웃 경로를 고정한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:lib/state-lock.ts:14</code> → <code>head:lib/state-lock.ts:20</code></p>
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
			expect(r.items.find((i) => i.id === "R1")?.pass).toBe(true);
		});

		test("signal 파일이 하나도 없으면 통과가 아니다 — 빈 집합 공허참 차단", () => {
			const r = checkStructure(withBackground(GOOD_GROUP), {
				signalFiles: [],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			expect(r.items.find((i) => i.id === "R1")?.pass).toBe(false);
		});

		test("한 변경 블록이 여러 파일을 인용하면 그 파일들이 모두 커버된다 — 책임 묶음", () => {
			// 하나의 변경이 함께 바뀐 두 책임(서로 다른 파일)으로 이뤄진다. 두 파일 모두
			// 한 변경 블록의 cf-loc에 인용되므로 R1 커버리지를 통과해야 한다(파일당 1블록 강제 없음).
			const grouped = `## Change Group 1: category 읽기로 전환
> 예고: 읽기 경계를 category로 옮긴다.
> 순서: 어댑터가 먼저다.

### \`ab12cd3\` — refactor: category 읽기

#### 변경 1: v2 제안 읽기를 category 정본으로만 조립
<div class="cf" data-change="mod">
<p><strong>책임 1 — 읽기 입구</strong> — <code>Adapter.read_v2()</code> (인프라 어댑터). product를 읽지 않는다.</p>
<p><strong>책임 2 — 조립·실패</strong> — <code>compose()</code> (도메인 유틸). 없으면 NotFoundError.</p>
<p><strong>왜</strong> — 정체성 기준을 category로 <span class="cf-src">근거</span> "refactor: category 읽기"</p>
<p><strong>효과·사이드이펙트</strong> — 누락이 조용한 성공 대신 명시적 실패로 드러난다.</p>
<p><strong>검증</strong> — read_v2.test 가 누락 시 실패를 고정한다.</p>
<p class="cf-loc"><strong>바뀐 위치</strong> — <code>base:app/adapter.py:170</code> → <code>head:app/adapter.py:183</code>, <code>base:app/compose.py:40</code> → <code>head:app/compose.py:31</code></p>
</div>

\`\`\`py
if not mirror:
    raise NotFoundError()
\`\`\`
`;
			const r = checkStructure(withBackground(grouped), {
				signalFiles: ["app/adapter.py", "app/compose.py"],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			expect(r.items.find((i) => i.id === "R1")?.pass).toBe(true);
			expect(r.items.find((i) => i.id === "R5")?.pass).toBe(true);
			expect(r.items.find((i) => i.id === "R13")?.pass).toBe(true);
		});

		test("변경 블록이 인용하지 않은 signal 파일은 R1이 잡아낸다", () => {
			// 두 파일이 signal인데 변경 블록이 한 파일만 인용하면, 빠진 파일을 사유에 담아 실패한다.
			const r = checkStructure(withBackground(GOOD_GROUP), {
				signalFiles: ["lib/state-lock.ts", "lib/forgotten.ts"],
				step: "code",
				commitHashes: ["ab12cd3f00"],
			});
			const item = r.items.find((i) => i.id === "R1");
			expect(item?.pass).toBe(false);
			expect(item?.detail).toContain("lib/forgotten.ts");
		});

		test("v4 파일 블록은 변경 블록으로 인식하지 않아 code 스텝이 실패한다", () => {
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
			expect(r.pass).toBe(false);
			expect(r.items.find((i) => i.id === "R1")?.pass).toBe(false);
			expect(r.items.find((i) => i.id === "R1")?.detail).toContain("tests/api/removed_routes.py");
		});
	});
});

// ---------------------------------------------------------------------------
// v3/v4 확장 — R9·R14(아키텍처), R10(커밋 오버뷰), R11(스타일 발명 금지)

// v5 계약: 시스템 레벨은 상시 인터페이스 표(R17), 컴포넌트 레벨은 노드별 arch-entity
// 카드(R18), 경계 블록은 동작단위 변경종류·영향 인터페이스·의존 방향(R15 재작성)을 갖고,
// Architecture 산문에는 방법론 명칭이 없다(R19).
const ARCH_OK = `## Architecture

### 시스템 레벨
\`\`\`mermaid
flowchart LR
  A[commerce browser] -->|HTTP| B[Hono backend]
  B -->|SQL| C[(PostgreSQL)]
\`\`\`

| 경계 | 인터페이스 | 오가는 것 |
|---|---|---|
| browser → backend | GET /v1/supplement-catalog | 표시 카탈로그 |
| backend → db | supplement_categories 조회 | 카탈로그 행 |

| 축 | 이번에 바뀌는 계약 |
|---|---|
| 서버 API | \`GET /v1/supplement-catalog\` 가 query를 받는다 |
| DB 스키마 | 변경 없음: 조인 방식만 바뀐다 |
| 클라이언트 의존 | 챗이 display catalog를 함께 읽는다 |

설명.

### 컴포넌트 레벨
\`\`\`mermaid
flowchart LR
  card --> resolver
\`\`\`

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>useSupplementCodeResolver</code></p>
<p><strong>레이어</strong> entities/supplement/api</p>
<p><strong>책임</strong> fail-closed 해소기 공급</p>
<p><strong>인터페이스</strong> resolveAlias, resolveDisplay</p>
</div>

### 도메인 레벨
구조 변화 없음: 엔티티 관계는 이 diff에서 바뀌지 않는다.

### 경계·의존·유스케이스

유스케이스: 표시 카탈로그 조회 흐름. 아래 시퀀스의 backend 조회 단계가 이 diff로 바뀐다.

\`\`\`mermaid
sequenceDiagram
  participant Card as card
  participant Resolver as resolver
  participant Backend as Hono backend
  Card->>Resolver: resolveDisplay(code)
  Resolver->>Backend: GET /v1/supplement-catalog
  Backend-->>Resolver: 표시 카탈로그
\`\`\`

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> display catalog 조회</p>
<p><strong>한 일</strong> 삭제 포함 표시 카탈로그 경로 신설</p>
<p><strong>영향 인터페이스</strong> GET /v1/supplement-catalog?includeDeletedCategories=true</p>
</div>

**의존 방향** — commerce feature → resolver → backend REST 단방향 유지.
`;

describe("architecture 스텝 — R9·R14·R15·R17·R18·R19", () => {
	test("세 레벨·계약3축·상시 인터페이스 표·컴포넌트 카드·경계 동작단위가 모두 있으면 통과한다", () => {
		const r = checkStructure(withBackground(ARCH_OK), {
			signalFiles: ["lib/state-lock.ts"],
			step: "architecture",
		});
		const ids = r.items.map((i) => i.id as string);
		for (const id of ["R9", "R14", "R15", "R17", "R18", "R19", "R21"]) {
			expect(ids).toContain(id);
		}
		expect(r.pass).toBe(true);
	});

	// R15 재작성 — 경계 블록은 동작단위 변경종류·영향 인터페이스·의존 방향을 요구한다.
	test("경계 블록에 의존 방향이 빠지면 R15가 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace(/\*\*의존 방향\*\*[^\n]*\n/, ""));
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R15",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("의존 방향");
	});

	test("경계 블록에 영향 인터페이스 라벨이 빠지면 R15가 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace("영향 인터페이스", "무엇"));
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R15",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("영향 인터페이스");
	});

	test("경계 블록 동작단위에 변경종류(data-change)가 없으면 R15가 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				'<div class="arch-entity" data-change="new">\n<p><strong>이름</strong> display catalog 조회</p>',
				'<div class="arch-entity">\n<p><strong>이름</strong> display catalog 조회</p>',
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R15",
		);
		expect(item?.pass).toBe(false);
	});

	test("경계 동작단위의 data-change가 arch-entity 태그 밖 산문에만 있으면 R15가 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				'<div class="arch-entity" data-change="new">\n<p><strong>이름</strong> display catalog 조회</p>',
				'<div class="arch-entity">\n<p><strong>이름</strong> display catalog 조회</p>\n<p>data-change="new"</p>',
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R15",
		);
		expect(item?.pass).toBe(false);
	});

	test("경계 동작단위의 허용되지 않은 data-change 값은 R15가 거부한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				'<div class="arch-entity" data-change="new">\n<p><strong>이름</strong> display catalog 조회</p>',
				'<div class="arch-entity" data-change="changed">\n<p><strong>이름</strong> display catalog 조회</p>',
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R15",
		);
		expect(item?.pass).toBe(false);
	});

	test("경계 동작단위는 data-change mod와 del도 R15에서 허용한다", () => {
		for (const change of ["mod", "del"]) {
			const doc = withBackground(
				ARCH_OK.replace(
					'<div class="arch-entity" data-change="new">\n<p><strong>이름</strong> display catalog 조회</p>',
					`<div class="arch-entity" data-change="${change}">\n<p><strong>이름</strong> display catalog 조회</p>`,
				),
			);
			const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
				(i) => i.id === "R15",
			);
			expect(item?.pass).toBe(true);
		}
	});

	// R17 — 시스템 레벨 상시 인터페이스 표.
	test("시스템 레벨에 상시 인터페이스 표가 없으면 R17이 실패하고 빠진 라벨을 담는다", () => {
		const doc = withBackground(
			ARCH_OK.replace(/\| 경계 \| 인터페이스 \| 오가는 것 \|[\s\S]*?카탈로그 행 \|\n/, ""),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R17",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("오가는 것");
	});

	test("시스템 레벨 산문에 열 이름만 있으면 R17이 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				/\| 경계 \| 인터페이스 \| 오가는 것 \|[\s\S]*?카탈로그 행 \|\n/,
				"경계, 인터페이스, 오가는 것을 설명한다.\n",
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R17",
		);
		expect(item?.pass).toBe(false);
	});

	test("시스템 레벨 표 헤더에 구분 행이 없으면 R17이 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace("|---|---|---|\n", ""));
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R17",
		);
		expect(item?.pass).toBe(false);
	});

	test("시스템 레벨 상시 인터페이스 표가 헤더와 구분 행만 있으면 R17이 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				"| browser → backend | GET /v1/supplement-catalog | 표시 카탈로그 |\n| backend → db | supplement_categories 조회 | 카탈로그 행 |\n",
				"",
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R17",
		);
		expect(item?.pass).toBe(false);
	});

	// R18 — 컴포넌트 레벨 노드별 arch-entity 카드.
	test("컴포넌트 레벨의 사유 있는 구조 변화 없음 면제는 R18을 통과시킨다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				/```mermaid\nflowchart LR\n {2}card --> resolver\n```[\s\S]*?(?=### 도메인 레벨)/,
				"구조 변화 없음: 이 diff는 컴포넌트 경계를 바꾸지 않는다.\n\n",
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R18",
		);
		expect(item?.pass).toBe(true);
	});

	test("컴포넌트 카드의 data-change 값이 허용값이 아니면 R18이 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace('class="arch-entity" data-change="new"', 'class="arch-entity" data-change="changed"'),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R18",
		);
		expect(item?.pass).toBe(false);
	});

	test("컴포넌트 카드 밖 산문의 data-change는 R18을 통과시키지 않는다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				'<div class="arch-entity" data-change="new">\n<p><strong>이름</strong> <code>useSupplementCodeResolver</code></p>',
				'<div class="arch-entity">\n<p><strong>이름</strong> <code>useSupplementCodeResolver</code></p>\n<p>data-change="new"</p>',
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R18",
		);
		expect(item?.pass).toBe(false);
	});

	test("완전한 카드가 다른 카드의 누락된 인터페이스를 가리지 못한다", () => {
		const incompleteCard = `<div class="arch-entity" data-change="mod">
<p><strong>이름</strong> secondaryNode</p>
<p><strong>레이어</strong> features/catalog</p>
<p><strong>책임</strong> 보조 경로 연결</p>
</div>`;
		const doc = withBackground(
			ARCH_OK.replace("</div>\n\n### 도메인 레벨", `</div>\n\n${incompleteCard}\n\n### 도메인 레벨`),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R18",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("인터페이스");
	});

	test("유효한 카드가 다른 카드의 잘못된 data-change를 가리지 못한다", () => {
		const invalidCard = `<div class="arch-entity" data-change="changed">
<p><strong>이름</strong> invalidNode</p>
<p><strong>레이어</strong> features/catalog</p>
<p><strong>책임</strong> 잘못된 변경 종류를 가진 경로</p>
<p><strong>인터페이스</strong> resolveInvalid</p>
</div>`;
		const doc = withBackground(
			ARCH_OK.replace("</div>\n\n### 도메인 레벨", `</div>\n\n${invalidCard}\n\n### 도메인 레벨`),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R18",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("data-change");
	});

	test("컴포넌트 레벨에 arch-entity 카드 라벨이 없으면 R18이 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				/<div class="arch-entity" data-change="new">\n<p><strong>이름<\/strong> <code>useSupplementCodeResolver[\s\S]*?<\/div>\n/,
				"",
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R18",
		);
		expect(item?.pass).toBe(false);
	});

	// R19 — Architecture 산문의 방법론 명칭 금지.
	test("Architecture 산문에 방법론 명칭(FSD 등)이 있으면 R19가 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace("fail-closed 해소기 공급", "이건 FSD의 feature다"));
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R19",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("FSD");
	});

	test("방법론 명칭이 없으면 R19가 통과한다", () => {
		const item = checkStructure(withBackground(ARCH_OK), {
			signalFiles: ["a.ts"],
			step: "architecture",
		}).items.find((i) => i.id === "R19");
		expect(item?.pass).toBe(true);
	});

	test("펜스와 인라인 코드의 방법론 토큰 및 AddDomainEvent 식별자는 R19에서 무시한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				"fail-closed 해소기 공급",
				"식별자 AddDomainEvent와 `FSD`, `DDD`, `Clean Architecture`, `수평`, `수직`은 코드 예시다.\n\n```ts\nconst labels = 'FSD DDD Clean Architecture 수평 수직';\n```",
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R19",
		);
		expect(item?.pass).toBe(true);
	});

	test("독립된 방법론 토큰과 축 라벨은 R19에서 거부한다", () => {
		for (const token of ["FSD", "DDD", "Clean Architecture", "수평", "수직"]) {
			const doc = withBackground(ARCH_OK.replace("fail-closed 해소기 공급", `${token} 분류를 쓴다.`));
			const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
				(i) => i.id === "R19",
			);
			expect(item?.pass).toBe(false);
		}
	});

	// R19 — 레이어 축 라벨(수평/수직)도 방법론 프레이밍이라 산문 노출 금지. 실측(luna max):
	// 경계 블록 "닿은 곳" 줄에 "수평: … 수직: …"를 재도입해, 사용자가 빼라던 정적 축
	// 분류가 되살아났다. 방법론 명칭 스캔과 같은 기계검사로 막는다.
	test("Architecture 산문에 축 라벨(수평/수직)이 있으면 R19가 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace("단방향 유지.", "단방향 유지. 수직 도메인은 catalog, 수평 레이어는 feature다."),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R19",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("수직");
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

	// R15 — 유스케이스 블록은 오케스트레이션을 다이어그램으로 보여야 한다(정적 카드가 아니라 흐름).
	test("경계·유스케이스 블록에 오케스트레이션 다이어그램이 없으면 R15가 실패한다", () => {
		const doc = withBackground(ARCH_OK.replace(/```mermaid\nsequenceDiagram[\s\S]*?```\n\n/, ""));
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R15",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("오케스트레이션");
	});

	test("경계 블록의 비오케스트레이션 Mermaid는 R15를 통과시키지 않는다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				/```mermaid\nsequenceDiagram[\s\S]*?```\n\n/,
				"```mermaid\nclassDiagram\n  class Boundary\n```\n\n",
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R15",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("오케스트레이션");
	});

	test("유스케이스 흐름이 정말 안 바뀌면 사유 있는 waiver로 R15 오케스트레이션을 대신할 수 있다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				/유스케이스: 표시 카탈로그 조회 흐름[\s\S]*?```\n/,
				"구조 변화 없음: 이 diff는 유스케이스 흐름을 바꾸지 않는다.\n",
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R15",
		);
		expect(item?.pass).toBe(true);
	});

	// R21 — 도메인 레벨은 다이어그램만이 아니라 엔티티 카드(책임·변경종류)를 요구한다.
	test("도메인 레벨이 waiver면 R21을 통과한다", () => {
		const item = checkStructure(withBackground(ARCH_OK), {
			signalFiles: ["a.ts"],
			step: "architecture",
		}).items.find((i) => i.id === "R21");
		expect(item?.pass).toBe(true);
	});

	test("도메인 레벨에 다이어그램만 있고 엔티티 카드도 waiver도 없으면 R21이 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				"### 도메인 레벨\n구조 변화 없음: 엔티티 관계는 이 diff에서 바뀌지 않는다.",
				"### 도메인 레벨\n```mermaid\nclassDiagram\n  class SupplementCategory\n```",
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R21",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("책임");
	});

	test("도메인 엔티티 카드가 책임·변경종류를 갖추면 R21을 통과한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				"### 도메인 레벨\n구조 변화 없음: 엔티티 관계는 이 diff에서 바뀌지 않는다.",
				`### 도메인 레벨
\`\`\`mermaid
classDiagram
  class SupplementCategory {
    +code: string
    +displayName: string
    +isActive() bool
  }
\`\`\`

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>SupplementCategory</code></p>
<p><strong>책임</strong> 영양제의 canonical 정체성을 보유하고, 상품 교체와 무관하게 유지된다</p>
</div>`,
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R21",
		);
		expect(item?.pass).toBe(true);
	});

	// R18/R21 — 다이어그램 노드는 컴포넌트/도메인 이름이지 파일 경로가 아니다.
	// 실측(luna max): 컴포넌트 다이어그램 노드가 전체 파일 경로라 화면에서 중간이
	// 잘렸다(`health-`, `proposal-`). 위치는 카드의 레이어 슬롯이 말한다.
	test("컴포넌트 다이어그램 노드가 파일 경로면 R18이 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				"flowchart LR\n  card --> resolver",
				'flowchart LR\n  a["apps/backend/src/domains/health-profiles/routers/health-v2.router.ts"] --> b["packages/schemas/src/program/proposal-request-v2.ts"]',
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R18",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("파일 경로");
	});

	test("도메인 객체 다이어그램의 클래스 박스가 비어 있으면 R21이 실패한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				"### 도메인 레벨\n구조 변화 없음: 엔티티 관계는 이 diff에서 바뀌지 않는다.",
				`### 도메인 레벨
\`\`\`mermaid
classDiagram
  class SupplementCategory
  class Supplement
  SupplementCategory --> Supplement
\`\`\`

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>SupplementCategory</code></p>
<p><strong>책임</strong> canonical 정체성 보유</p>
</div>`,
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R21",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("멤버");
	});

	test("classDiagram의 한 클래스가 채워져도 다른 빈 클래스 박스를 가리지 못한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				"### 도메인 레벨\n구조 변화 없음: 엔티티 관계는 이 diff에서 바뀌지 않는다.",
				`### 도메인 레벨
\`\`\`mermaid
classDiagram
  class SupplementCategory {
    +code: string
  }
  class Supplement
  SupplementCategory --> Supplement
\`\`\`

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>SupplementCategory</code></p>
<p><strong>책임</strong> canonical 정체성 보유</p>
</div>`,
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R21",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("멤버");
	});

	test("관계로 암시된 빈 class도 R21에서 검사한다", () => {
		const doc = withBackground(
			ARCH_OK.replace(
				"### 도메인 레벨\n구조 변화 없음: 엔티티 관계는 이 diff에서 바뀌지 않는다.",
				`### 도메인 레벨
\`\`\`mermaid
classDiagram
  SupplementCategory : +code: string
  SupplementCategory --> Supplement
\`\`\`

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>SupplementCategory</code></p>
<p><strong>책임</strong> canonical 정체성 보유</p>
</div>`,
			),
		);
		const item = checkStructure(doc, { signalFiles: ["a.ts"], step: "architecture" }).items.find(
			(i) => i.id === "R21",
		);
		expect(item?.pass).toBe(false);
		expect(item?.detail).toContain("멤버");
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

	test("R13 — 변경 블록의 유일한 펜스가 mermaid면 핵심 로직 코드로 인정되지 않는다", () => {
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
