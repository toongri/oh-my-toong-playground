import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { STEP_ORDER, type Step } from "@lib/explain-diff-core";
import { preRenderMermaid, renderToHtml } from "./render";

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
	const stateCli = await import("./explain-diff-state");
	stateCli.setRenderForTesting((docPath) => projectRenderedHtml(readFileSync(docPath, "utf8")));
	return stateCli;
}

const GOOD_DOC = `# 설명

## Evidence

| 파일 | 분류 |
|---|---|
| \`lib/state-lock.ts\` | signal |

### 원천

| 종류 | 식별자/경로 | 확보 | 내용 요약 |
|---|---|---|---|
| 코드 | \`lib/state-lock.ts\` | 열람 | 락 구현과 호출 경로를 확인 |

## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

### 좁은 배경
내용

## Change Group 1: 락을 공용 모듈로 뽑아낸다
> 예고: 먼저 락을 옮겨야 호출부 정리가 의미를 갖는다.
> 순서: 추출이 먼저다.

### \`ab12cd3\` — fix: 상태 갱신 락 통합
락 획득/해제를 한 파일로 모은다.

#### 변경 1: 락 획득·해제를 공용 모듈로 추출
<div class="cf">
<p><strong>역할/변경 전</strong> — 없던 파일</p>
<p><strong>바뀐 것</strong> — 락이 여기로 모였다</p>
<p><strong>왜</strong> — 커밋 제목이 통합이라 적는다 <span class="cf-src">근거</span> "fix: ultragoal 상태 갱신 락 통합"</p>
<p><strong>효과</strong> — 두 CLI가 같은 락을 쓴다</p>
<p class="cf-loc"><code>base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14</code></p>
</div>

\`\`\`ts
export function withLock(path, fn) {
  // 획득 → fn() → 해제
}
\`\`\`
`;

const ARCH_SECTION = `## Architecture

### 시스템 레벨
\`\`\`mermaid
flowchart LR
  CLI --> STATE[(state file)]
\`\`\`

| 경계 | 인터페이스 | 오가는 것 |
|---|---|---|
| CLI → state file | withLock(경로) | 락 획득/해제 |

| 축 | 이번에 바뀌는 계약 |
|---|---|
| 서버 API | 변경 없음: CLI 전용이라 서버 API 표면이 없다 |
| DB 스키마 | 변경 없음: 상태는 JSON 파일이다 |
| 클라이언트 의존 | 두 CLI가 공용 락 모듈에 의존하게 된다 |

### 컴포넌트 레벨
\`\`\`mermaid
flowchart LR
  cliA --> lock
  cliB --> lock
\`\`\`

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>state-lock</code></p>
<p><strong>패키지</strong> lib/상태-인프라</p>
<p><strong>책임</strong> 상태 파일 락 소유</p>
<p><strong>인터페이스</strong> withLock</p>
<p><strong>변경점</strong> 두 CLI에 흩어져 있던 락 획득/해제를 공용 모듈로 추출</p>
</div>

### 도메인 레벨
구조 변화 없음: 엔티티가 없다.

### 경계·의존·유스케이스

\`\`\`mermaid
sequenceDiagram
  participant CLI_A as ultragoal CLI
  participant Lock as withLock (신설)
  participant State as state file
  CLI_A->>Lock: 상태 쓰기 요청
  Lock->>State: 락 획득 → 쓰기 → 해제
\`\`\`

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> 상태 갱신 락 통합</p>
<p><strong>한 일</strong> 두 CLI의 상태 쓰기를 공용 락으로 직렬화</p>
<p><strong>영향 인터페이스</strong> withLock(경로, fn)</p>
</div>

**의존 방향** — 두 CLI → 공용 락 모듈 단방향. 역참조 없음.
`;

const JOURNEY_SECTION = `## Commit Journey

1. \`ab12cd3\` fix — 상태 갱신 락 통합 → 그룹 1
`;

/** goal 스텝의 R16 두 슬롯(무엇을·왜 / 핵심). 코드 전에 목표를 먼저 전달한다. */
const GOAL_SECTION = `## 목표

### 무엇을·왜
두 CLI가 상태 파일 락을 공유하도록 공용 락 모듈로 뽑아, 갱신 경합을 없앤다.

### 핵심
코드를 보기 전에: 락 획득/해제를 한 곳으로 모으는 작은 추출이다.

### 출처
커밋 본문 "상태 갱신 락 통합"과 코드 추론.
`;

/** 9스텝 전부의 구조 슬롯을 갖춘 문서. */
const FULL_DOC = `${GOOD_DOC}\n${GOAL_SECTION}\n${ARCH_SECTION}\n${JOURNEY_SECTION}`;

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

	test("start 는 range 의 커밋 해시를 상태에 박제한다 — R10 이 나중에 git 없이 읽는다", async () => {
		// Hermetic repo: the count assertion must not depend on this repo's HEAD shape
		// (a merge commit makes HEAD~1..HEAD span the whole merged branch).
		const repo = join(sandbox, "repo");
		const git = (...a: string[]) =>
			execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "ignore"] });
		mkdirSync(repo);
		git("init", "-q", "-b", "main");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "one");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "two");
		const prev = process.cwd();
		try {
			process.chdir(repo);
			const { start } = await cli();
			start(SID, "HEAD~1..HEAD", "sample");
		} finally {
			process.chdir(prev);
		}
		expect(state().commit_hashes.length).toBe(1);
		expect(state().commit_hashes[0]).toMatch(/^[0-9a-f]{7,40}$/);
	});

	test("머지 커밋은 박제 목록에서 제외된다 — 머지의 서사는 문서 자신과 중복", async () => {
		// 실측(algocare-home PR 3407): 실커밋 1 + 머지 1 범위에서 머지 헤딩을
		// 강요하면 waiver 가 영영 못 열린다. 머지 커밋의 첫 부모 대비 diff 는
		// PR 전체 = 이 문서가 설명하는 것 그 자체다.
		const repo = join(sandbox, "repo-merge");
		const git = (...a: string[]) =>
			execFileSync(
				"git",
				["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...a],
				{ stdio: ["ignore", "pipe", "ignore"] },
			);
		mkdirSync(repo);
		git("init", "-q", "-b", "main");
		git("commit", "-q", "--allow-empty", "-m", "base");
		git("checkout", "-q", "-b", "feat");
		git("commit", "-q", "--allow-empty", "-m", "real work");
		git("checkout", "-q", "main");
		git("merge", "-q", "--no-ff", "--no-edit", "feat");
		const prev = process.cwd();
		try {
			process.chdir(repo);
			const { start } = await cli();
			start(SID, "HEAD^1..HEAD", "sample");
		} finally {
			process.chdir(prev);
		}
		expect(state().commit_hashes.length).toBe(1);
	});

	test("열거할 수 없는 range 는 빈 배열로 남는다 — 실패가 start 를 막지 않는다", async () => {
		const { start } = await cli();
		start(SID, "존재하지-않는-ref..도-없는-ref", "sample");
		expect(state().commit_hashes).toEqual([]);
		expect(state().diff_hunks).toEqual([]);
	});

	test("start 는 A...B diff hunk에 merge-base 이후 feature 변경만 박제한다", async () => {
		const repo = join(sandbox, "repo-diverged-range");
		const git = (...a: string[]) =>
			execFileSync("git", ["-C", repo, ...a], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
		mkdirSync(repo);
		git("init", "-q", "-b", "main");
		writeFileSync(join(repo, "shared.txt"), "merge base\n", "utf8");
		git("add", "shared.txt");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "merge base");
		writeFileSync(join(repo, "base-only.txt"), "base branch\n", "utf8");
		git("add", "base-only.txt");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base branch change");
		git("checkout", "-q", "-b", "feature", "HEAD~1");
		writeFileSync(join(repo, "feature-only.txt"), "feature branch\n", "utf8");
		git("add", "feature-only.txt");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "feature change");

		const prev = process.cwd();
		try {
			process.chdir(repo);
			const { start } = await cli();
			start(SID, "main...feature", "sample");
		} finally {
			process.chdir(prev);
		}

		expect(state().diff_hunks).toEqual([
			{
				path: "feature-only.txt",
				base: null,
				head: { start: 1, count: 1 },
			},
		]);
	});

	test("start 는 첫 줄 수정 hunk의 base/head 범위를 박제한다", async () => {
		const repo = join(sandbox, "repo-first-line");
		const git = (...a: string[]) =>
			execFileSync("git", ["-C", repo, ...a], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
		mkdirSync(repo);
		git("init", "-q", "-b", "main");
		mkdirSync(join(repo, "src"));
		const file = join(repo, "src", "target.ts");
		writeFileSync(file, "const value = \"old\";\nconst stable = true;\n", "utf8");
		git("add", "src/target.ts");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
		writeFileSync(file, "const value = \"new\";\nconst stable = true;\n", "utf8");
		git("add", "src/target.ts");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change");

		const prev = process.cwd();
		try {
			process.chdir(repo);
			const { start } = await cli();
			start(SID, "HEAD~1..HEAD", "sample");
		} finally {
			process.chdir(prev);
		}

		const hunks = state().diff_hunks;
		expect(hunks).toHaveLength(1);
		expect(hunks[0].path).toBe("src/target.ts");
		expect(hunks[0].base.start).toBe(1);
		expect(hunks[0].base.count).toBeGreaterThan(0);
		expect(hunks[0].head.start).toBe(1);
		expect(hunks[0].head.count).toBeGreaterThan(0);
	});

	test("start 는 hunk 안의 두 대시로 시작하는 삭제 줄을 파일 헤더로 오인하지 않는다", async () => {
		const repo = join(sandbox, "repo-dash-body-line");
		const git = (...a: string[]) =>
			execFileSync("git", ["-C", repo, ...a], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
		mkdirSync(repo);
		git("init", "-q", "-b", "main");
		const file = join(repo, "target.txt");
		writeFileSync(file, "-- old option\nstable\n", "utf8");
		git("add", "target.txt");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
		writeFileSync(file, "-- new option\nstable\n", "utf8");
		git("add", "target.txt");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change");

		const prev = process.cwd();
		try {
			process.chdir(repo);
			const { start } = await cli();
			start(SID, "HEAD~1..HEAD", "sample");
		} finally {
			process.chdir(prev);
		}

		const hunks = state().diff_hunks;
		expect(hunks).toHaveLength(1);
		expect(hunks[0].path).toBe("target.txt");
		expect(hunks[0].base).toMatchObject({ start: 1, count: 1 });
		expect(hunks[0].head).toMatchObject({ start: 1, count: 1 });
	});

	test("start 는 추가·삭제 파일 hunk의 없는 쪽을 null로 박제한다", async () => {
		const repo = join(sandbox, "repo-added-deleted");
		const git = (...a: string[]) =>
			execFileSync("git", ["-C", repo, ...a], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
		mkdirSync(repo);
		git("init", "-q", "-b", "main");
		writeFileSync(join(repo, "removed.txt"), "remove one\nremove two\n", "utf8");
		git("add", "removed.txt");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
		rmSync(join(repo, "removed.txt"));
		writeFileSync(join(repo, "added.txt"), "add one\nadd two\n", "utf8");
		git("add", "-A");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change");

		const prev = process.cwd();
		try {
			process.chdir(repo);
			const { start } = await cli();
			start(SID, "HEAD~1..HEAD", "sample");
		} finally {
			process.chdir(prev);
		}

		const hunks = state().diff_hunks as Array<Record<string, any>>;
		const byPath = new Map(hunks.map((hunk) => [hunk.path, hunk]));
		expect(byPath.get("added.txt")).toMatchObject({
			base: null,
			head: { start: 1, count: 2 },
		});
		expect(byPath.get("removed.txt")).toMatchObject({
			base: { start: 1, count: 2 },
			head: null,
		});
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

// Evidence 절과 원천 스윕 표만 있는, 문서화된 흐름의 실제 첫 호출 모양의 문서.
const EVIDENCE_ONLY_DOC = `# 설명

## Evidence

| 파일 | 분류 |
|---|---|
| \`lib/state-lock.ts\` | signal |

### 원천

| 종류 | 식별자/경로 | 확보 | 내용 요약 |
|---|---|---|---|
| 코드 | \`lib/state-lock.ts\` | 열람 | 락 구현과 호출 경로를 확인 |
`;

const WITH_BACKGROUND_DOC = `${EVIDENCE_ONLY_DOC}
## Background

### 깊은 배경
이미 익숙하면 건너뛰세요.

### 좁은 배경
내용
`;

/** advanceTo가 신규 스텝(goal·architecture·commits)을 건널 수 있는 문서. */
const WITH_ARCH_DOC = () => `${WITH_BACKGROUND_DOC}\n${GOAL_SECTION}\n${ARCH_SECTION}\n${JOURNEY_SECTION}`;

/**
 * evidence 부터 `step` 직전까지 `docAtStep`이 준 문서로 통과시켜 그 스텝에 진입시킨다.
 * 도달한 스텝의 `submitStep`/`passStep` 은 호출자가 직접 실행해 검증한다.
 */
async function advanceTo(
	step: Step,
	docAtStep: (s: Step) => string,
	range = "r",
): Promise<{
	submitStep: Awaited<ReturnType<typeof cli>>["submitStep"];
	passStep: Awaited<ReturnType<typeof cli>>["passStep"];
}> {
	const { start, submitStep, passStep } = await cli();
	start(SID, range, "s");
	for (const s of STEP_ORDER) {
		if (s === step) break;
		const doc = docFile(docAtStep(s));
		submitStep(SID, s, doc, ["lib/state-lock.ts"], []);
		// R6·R7·R12를 매 스텝에 함께 싣는다 — 각 스텝이 요구하는 필수 ID를 놓치지
		// 않기 위해서이고, 요구되지 않는 스텝에서는 여분의 검증된 통과 항목일 뿐이다.
		passStep(SID, s, doc, [
			{ id: "R6", pass: true, quote: "state-lock" },
			{ id: "R7", pass: true, quote: "state-lock" },
			{ id: "R12", pass: true, quote: "state-lock" },
		]);
	}
	return { submitStep, passStep };
}

describe("diff hunk 메타데이터 전달", () => {
	test("code 제출은 start에서 저장한 첫 줄 hunk로 :1 → :1 앵커를 검증한다", async () => {
		const repo = join(sandbox, "repo-submit-hunk");
		const git = (...a: string[]) =>
			execFileSync("git", ["-C", repo, ...a], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			});
		mkdirSync(repo);
		git("init", "-q", "-b", "main");
		mkdirSync(join(repo, "lib"));
		const file = join(repo, "lib", "state-lock.ts");
		writeFileSync(file, "export const mode = \"old\";\nexport const stable = true;\n", "utf8");
		git("add", "lib/state-lock.ts");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "base");
		writeFileSync(file, "export const mode = \"new\";\nexport const stable = true;\n", "utf8");
		git("add", "lib/state-lock.ts");
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "change");
		const shortHash = git("rev-parse", "--short", "HEAD").trim();

		const prev = process.cwd();
		try {
			process.chdir(repo);
			const { submitStep } = await advanceTo("code", WITH_ARCH_DOC, "HEAD~1..HEAD");
			const doc = docFile(
				GOOD_DOC.replaceAll("ab12cd3", shortHash).replace(
					"base:lib/state-lock.ts:0</code> → <code>head:lib/state-lock.ts:14",
					"base:lib/state-lock.ts:1</code> → <code>head:lib/state-lock.ts:1",
				),
			);
			// start 이후에는 저장된 메타데이터만 사용해야 하므로 저장소 밖에서 제출한다.
			process.chdir(prev);
			expect(submitStep(SID, "code", doc, ["lib/state-lock.ts"], [])).toBe(0);
		} finally {
			process.chdir(prev);
		}
	});
});

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
		const { submitStep } = await advanceTo("code", WITH_ARCH_DOC);
		// Change Group이 없는 같은 문서를 code 스텝에 그대로 제출한다 — R2가 슬롯 부재로
		// 실패하고, R1(커버리지형)도 signal 파일이 어느 그룹에도 없어 실패한다.
		const rc = submitStep(SID, "code", docFile(WITH_BACKGROUND_DOC), ["lib/state-lock.ts"], []);
		expect(rc).toBe(1);
		const items = state().last_failure.items.join(" ");
		expect(items).toContain("R2");
		expect(items).toContain("lib/state-lock.ts");
	});

	test("signal 파일이 Evidence 표에만 있고 Change Group 변경 블록이 없으면 code 스텝이 실패하고 사유에 경로가 나온다", async () => {
		const { submitStep } = await advanceTo("code", WITH_ARCH_DOC);
		const noGroupDoc = `${WITH_BACKGROUND_DOC}
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
		const rc = submitStep(SID, "code", docFile(noGroupDoc), ["lib/state-lock.ts"], []);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("lib/state-lock.ts");
	});

	test("같은 signal 파일을 두 변경 블록이 각각 인용해도 code 스텝은 통과한다 — 단위는 파일이 아니라 변경이다", async () => {
		const { submitStep } = await advanceTo("code", WITH_ARCH_DOC);
		const duplicatedDoc = `${WITH_BACKGROUND_DOC}
## Change Group 1: 락을 공용 모듈로 뽑아낸다
> 예고: 먼저 락 자체를 옮겨 놓아야 호출부 정리가 의미를 갖는다.
> 순서: 추출이 먼저다.

### \`ab12cd3\` — fix: 첫 손질
락을 옮긴다.

#### 변경 1: 락 획득/해제를 공용 함수로 추출
<div class="cf">
<p><strong>왜</strong> — <span class="cf-src">근거</span> "첫 번째 이유"</p>
<p class="cf-loc"><code>base:lib/state-lock.ts:1</code> → <code>head:lib/state-lock.ts:14</code></p>
</div>

\`\`\`ts
const a = 1;
\`\`\`

## Change Group 2: 같은 파일을 또 다룬다
> 예고: 같은 파일이 다시 등장한다.
> 순서: 두 번째 손질이 필요하다.

### \`ef45ab6\` — fix: 둘째 손질
같은 파일을 다시 만진다.

#### 변경 2: 같은 파일에 타임아웃 가드를 덧댄다
<div class="cf">
<p><strong>왜</strong> — <span class="cf-src">근거</span> "두 번째 이유"</p>
<p class="cf-loc"><code>base:lib/state-lock.ts:14</code> → <code>head:lib/state-lock.ts:20</code></p>
</div>

\`\`\`ts
const b = 2;
\`\`\`
`;
		const rc = submitStep(SID, "code", docFile(duplicatedDoc), ["lib/state-lock.ts"], []);
		expect(rc).toBe(0);
	});

	test("intuition 스텝은 최소 문서로도 구조 검사를 통과한다", async () => {
		const { submitStep } = await advanceTo("intuition", WITH_ARCH_DOC);
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
		const { submitStep, passStep } = await advanceTo("intuition", WITH_ARCH_DOC);
		const doc = docFile("본질만 적힌 한 줄.");
		submitStep(SID, "intuition", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "intuition", doc, []);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R6");
		expect(state().step).toBe("intuition");
	});

	test("intuition 스텝은 R6가 아닌 무관한 ID만으로는 통과하지 못한다 — 인용이 문서에 실재해도", async () => {
		const { submitStep, passStep } = await advanceTo("intuition", WITH_ARCH_DOC);
		const doc = docFile("본질만 적힌 한 줄.");
		submitStep(SID, "intuition", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "intuition", doc, [{ id: "R9", pass: true, quote: "본질만" }]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R6");
	});

	test("intuition 스텝은 R6를 pass:true + 실재 인용으로 제출해야 통과하고 commits로 넘어간다", async () => {
		const { submitStep, passStep } = await advanceTo("intuition", WITH_ARCH_DOC);
		const doc = docFile("본질만 적힌 한 줄.");
		submitStep(SID, "intuition", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "intuition", doc, [{ id: "R6", pass: true, quote: "본질만" }]);
		expect(rc).toBe(0);
		expect(state().step).toBe("commits");
		expect(state().passed).toContain("intuition");
	});

	test("R6가 있어도 인용이 문서에 없으면 통과하지 못한다 — 기존 인용 검증은 살아 있다", async () => {
		const { submitStep, passStep } = await advanceTo("intuition", WITH_ARCH_DOC);
		const doc = docFile("본질만 적힌 한 줄.");
		submitStep(SID, "intuition", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "intuition", doc, [{ id: "R6", pass: true, quote: "문서에 없는 문장" }]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("문자열로 존재하지 않습니다");
	});

	test("code 스텝은 --judge-json '[]' 로는 통과하지 못한다 — R7 미제출", async () => {
		const { submitStep, passStep } = await advanceTo("code", () => FULL_DOC);
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "code", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "code", doc, []);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R7");
		expect(state().step).toBe("code");
	});

	test("code 스텝은 R7이 아닌 무관한 ID만으로는 통과하지 못한다 — 인용이 문서에 실재해도", async () => {
		const { submitStep, passStep } = await advanceTo("code", () => FULL_DOC);
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "code", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "code", doc, [
			{ id: "R9", pass: true, quote: "락을 공용 모듈로 뽑아낸다" },
		]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R7");
	});

	test("code 스텝은 R7을 pass:true + 실재 인용으로 제출해야 통과하고 render로 넘어간다", async () => {
		const { submitStep, passStep } = await advanceTo("code", () => FULL_DOC);
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
		expect(state().step).toBe("goal");
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
	const doc = docFile(FULL_DOC);
	const quote = "락을 공용 모듈로 뽑아낸다";
	for (const step of [
		"evidence",
		"background",
		"goal",
		"architecture",
		"intuition",
		"commits",
		"code",
	] as const) {
		submitStep(SID, step, doc, ["lib/state-lock.ts"], []);
		passStep(SID, step, doc, [
			{ id: "R6", pass: true, quote },
			{ id: "R7", pass: true, quote },
			{ id: "R12", pass: true, quote },
		]);
	}
	return { passStep, submitStep, doc };
}

/** render 게이트가 요구하는 검증 리포트(technical-writing)를 통과 형태로 만든다. */
function reportFiles(): { writing: string; checklist: string } {
	const writing = join(sandbox, "writing-report.md");
	writeFileSync(writing, "지적 2건 반영.\nREVIEW: APPLIED\n", "utf8");
	const checklist = join(sandbox, "final-checklist.md");
	writeFileSync(checklist, "모든 render 산출물 확인.\nCHECKLIST: ALL PASS\n", "utf8");
	return { writing, checklist };
}

const projectRenderedHtmlCache = new Map<string, string>();

function projectRenderedHtml(markdown: string): string {
	const cached = projectRenderedHtmlCache.get(markdown);
	if (cached !== undefined) return cached;
	const renderedMarkdown = preRenderMermaid(
		markdown,
		(_source, index) => `<svg data-i="${index}"></svg>`,
	);
	const title = (renderedMarkdown.match(/^#\s+(.+)$/m)?.[1] ?? "explain-diff").trim();
	const rendered = renderToHtml(renderedMarkdown, title);
	projectRenderedHtmlCache.set(markdown, rendered);
	return rendered;
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

	test("정상 HTML + 두 리포트면 통과하고 render 를 구조 통과 목록에 남긴다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();
		const rc = submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist);
		expect(rc).toBe(0);
		expect(state().structural_ok).toContain("render");
	});

	test("--checklist 없이 제출하면 실패하고 현재 스텝은 render 에 남는다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();

		const rc = submitStep(SID, "render", doc, [], [], htmlPath, rep.writing);
		expect(rc).toBe(1);
		expect(state().step).toBe("render");
		expect(state().last_failure?.items.join(" ")).toContain("--checklist");
	});

	test("존재하지 않는 checklist 파일은 실패한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();

		const rc = submitStep(
			SID,
			"render",
			doc,
			[],
			[],
			htmlPath,
			rep.writing,
			join(sandbox, "없는-checklist.md"),
		);
		expect(rc).toBe(1);
		expect(state().step).toBe("render");
		expect(state().last_failure?.items.join(" ")).toContain("체크리스트 리포트");
	});

	test("checklist 마지막 verdict가 CHECKLIST: ALL PASS가 아니면 실패한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();
		writeFileSync(rep.checklist, "체크리스트 검토 결과\nCHECKLIST: NOT PASS\n", "utf8");

		const rc = submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist);
		expect(rc).toBe(1);
		expect(state().step).toBe("render");
		expect(state().last_failure?.items.join(" ")).toContain("CHECKLIST: ALL PASS");
	});

	test("Markdown 산문이 바뀐 뒤 예전 renderer HTML은 Mermaid 패리티가 같아도 거부하고 현재 산출물은 통과한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const oldMarkdown = readFileSync(doc, "utf8");
		const currentMarkdown = oldMarkdown.replace("내용", "현재 문서의 새 산문");
		writeFileSync(doc, currentMarkdown, "utf8");
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(oldMarkdown), "utf8");
		const rep = reportFiles();

		expect(submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist)).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("현재 Markdown");

		writeFileSync(htmlPath, projectRenderedHtml(currentMarkdown), "utf8");
		expect(submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist)).toBe(0);
	});

	test("visual-qa 리포트 없이도 통과한다 — 넓은 다이어그램 가독성은 render.ts 가 결정적으로 봉인한다", async () => {
		// 시각 검증은 문서마다 반복할 대상이 아니라 렌더러가 소유하는 결정적 속성이다
		// (넓은 mermaid 다운스케일은 normalizeSvgWidth + figure.diagram 스크롤로 봉인).
		// 그래서 render 게이트는 더는 visual-qa 리포트를 요구하지 않는다.
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();
		const rc = submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist);
		expect(rc).toBe(0);
		expect(state().structural_ok).toContain("render");
	});

	test("technical-writing 리포트가 없거나 REVIEW: APPLIED 가 없으면 실패한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();
		expect(submitStep(SID, "render", doc, [], [], htmlPath, undefined, rep.checklist)).toBe(1);
		writeFileSync(rep.writing, "리뷰만 하고 반영 안 함\n", "utf8");
		expect(submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist)).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("REVIEW: APPLIED");
	});

	test("리포트의 종결 표식 뒤 미해결 항목이 있으면 실패한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();
		writeFileSync(rep.writing, "REVIEW: APPLIED\n미반영 지적\n", "utf8");

		expect(submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist)).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("REVIEW: APPLIED");
	});

	test("문서에 mermaid 블록이 있는데 HTML에 SVG가 그만큼 없으면 실패한다", async () => {
		const { submitStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		// FULL_DOC 은 mermaid 블록 1개를 갖는다 — svg 0개인 HTML은 렌더 누락이다.
		writeFileSync(htmlPath, "<html>svg 없음</html>", "utf8");
		const rep = reportFiles();
		const rc = submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("mermaid");
	});

	test("render 통과 후 pass-step 은 심사 항목 없이 quiz 로 넘긴다", async () => {
		const { submitStep, passStep, doc } = await driveToRender();
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();
		submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist);
		const rc = passStep(SID, "render", doc, []);
		expect(rc).toBe(0);
		expect(state().step).toBe("quiz");
	});

	test("evidence 부터 render 까지 전 스텝을 통과시키고 필수 개념을 채우면 complete 가 성공한다", async () => {
		const { start, submitStep, passStep, addConcept, ask, grade, complete } = await cli();
		start(SID, "r", "s");
		const doc = docFile(FULL_DOC);
		const quote = "락을 공용 모듈로 뽑아낸다";
		for (const step of [
			"evidence",
			"background",
			"goal",
			"architecture",
			"intuition",
			"commits",
			"code",
		] as const) {
			submitStep(SID, step, doc, ["lib/state-lock.ts"], []);
			passStep(SID, step, doc, [
				{ id: "R6", pass: true, quote },
				{ id: "R7", pass: true, quote },
				{ id: "R12", pass: true, quote },
			]);
		}
		const htmlPath = join(sandbox, "doc.html");
		writeFileSync(htmlPath, projectRenderedHtml(readFileSync(doc, "utf8")), "utf8");
		const rep = reportFiles();
		submitStep(SID, "render", doc, [], [], htmlPath, rep.writing, rep.checklist);
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
