import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	CAPABILITY_STEP_MIGRATION_VERSION,
	STEP_ORDER,
	type Step,
} from "@lib/explain-diff-core";
import { Lexer, Parser } from "marked";
import { DIAGRAM_FIGURE_PATTERN, diagramFigures, usedStyleClasses } from "@lib/explain-diff-structure";
import { writeLintReceipt } from "@lib/__fixtures__/lint-receipt";
import type { RenderSubmission } from "./explain-diff-state";

/** 문서에 쓰는 다이어그램 figure — data-kind 와 라벨(<text>)만 다르다. */
function figure(kind: string, ...labels: string[]): string {
	const texts = labels
		.map((label, i) => `<text class="t-b" x="16" y="${24 + i * 24}">${label}</text>`)
		.join("");
	return `<figure class="diagram" data-kind="${kind}">
<svg viewBox="0 0 340 ${24 + labels.length * 24}" role="img" aria-label="${labels.join(", ")}">${texts}</svg>
<figcaption>그림. ${labels.join(" → ")}</figcaption>
</figure>`;
}

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
${figure("architecture", "CLI", "state file")}

| 경계 | 인터페이스 | 오가는 것 |
|---|---|---|
| CLI → state file | withLock(경로) | 락 획득/해제 |

| 축 | 이번에 바뀌는 계약 |
|---|---|
| 서버 API | 변경 없음: CLI 전용이라 서버 API 표면이 없다 |
| DB 스키마 | 변경 없음: 상태는 JSON 파일이다 |
| 클라이언트 의존 | 두 CLI가 공용 락 모듈에 의존하게 된다 |

### 컴포넌트 레벨
${figure("architecture", "cliA", "cliB", "lock")}

<div class="arch-entity" data-change="new">
<p><strong>이름</strong> <code>state-lock</code></p>
<p><strong>패키지</strong> lib/상태-인프라</p>
<p><strong>책임</strong> 상태 파일 락 소유</p>
<p><strong>인터페이스</strong> withLock</p>
<p><strong>변경점</strong> 두 CLI에 흩어져 있던 락 획득/해제를 공용 모듈로 추출</p>
</div>

### 도메인 레벨
구조 변화 없음: 엔티티가 없다.
`;

/** capability 스텝의 R15 — `## 기능 단위` 섹션의 `### <캐피빌리티>` 챕터. */
const CAPABILITY_SECTION = `## 기능 단위

### 상태 갱신 락 통합

- 구현체: \`withLock\`
- 버전: 버전 토큰 없음 · 신규 — 두 CLI의 상태 쓰기를 공용 락으로 직렬화하는 유스케이스를 추가했다.
- 소속 도메인 + 협력: 상태 인프라가 소유한다. 두 CLI가 [의존=계약 위임]으로 withLock을 부른다.
- 입구(트리거): 두 CLI의 상태 쓰기 경로 — \`withLock(경로, fn)\`. 기존 쓰기 경로 수정(mod).
- 영향범위: ultragoal·explain-diff 두 CLI의 상태 쓰기가 직렬화된다. 파일 포맷 변경 없음.

**책임** 나는 두 CLI의 상태 쓰기를 공용 락으로 직렬화한다. 실제 파일 IO는 저장소에 위임한다.

락 획득→쓰기→해제 흐름을 확인한다.

${figure("sequence", "ultragoal CLI", "withLock (신설)", "state file", "락 획득 → 쓰기 → 해제")}

**개념/도메인 모델 연결** 상태 파일과 락 소유권을 연결한다.

의존 방향 판정: 두 CLI → 공용 락 모듈 단방향, 역참조 없음.
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
const FULL_DOC = `${GOOD_DOC}\n${GOAL_SECTION}\n${ARCH_SECTION}\n${CAPABILITY_SECTION}\n${JOURNEY_SECTION}`;

function docFile(text: string): string {
	const p = join(sandbox, "doc.md");
	writeFileSync(p, text, "utf8");
	return p;
}

function state(): Record<string, any> {
	return JSON.parse(readFileSync(join(sandbox, `explain-diff-state-${SID}.json`), "utf8"));
}

function rewriteState(mutator: (current: Record<string, any>) => void): void {
	const current = state();
	mutator(current);
	writeFileSync(
		join(sandbox, `explain-diff-state-${SID}.json`),
		`${JSON.stringify(current, null, 2)}\n`,
		"utf8",
	);
}

function seedLegacyRenderProof(): void {
	const legacyProof = {
		doc_path: join(sandbox, "legacy-doc.md"),
		html_path: join(sandbox, "legacy-doc.html"),
		writing_report_path: join(sandbox, "legacy-writing.md"),
		checklist_path: join(sandbox, "legacy-checklist.md"),
	};
	rewriteState((current) => {
		current.capability_step_migration_version = CAPABILITY_STEP_MIGRATION_VERSION;
		delete current.render_proof_contract_version;
		current.render_proof = legacyProof;
		current.structural_ok = ["render"];
		current.passed = ["render"];
		current.step = "quiz";
		current.last_failure = null;
	});
}

describe("legacy render-proof migration locking", () => {
	test("read migrates legacy state only after acquiring the state lock", async () => {
		const { read, start } = await cli();
		start(SID, "r", "s");
		seedLegacyRenderProof();
		const stateFile = join(sandbox, `explain-diff-state-${SID}.json`);
		const before = readFileSync(stateFile, "utf8");
		const lockPath = `${stateFile}.lock`;
		mkdirSync(lockPath);

		try {
			let error: unknown;
			try {
				read(SID);
			} catch (caught) {
				error = caught;
			}
			expect(error instanceof Error ? error.message : error).toBe(
				`could not acquire state lock: ${lockPath}`,
			);
			expect(readFileSync(stateFile, "utf8")).toBe(before);
		} finally {
			rmSync(lockPath, { recursive: true, force: true });
		}

		const migrated = read(SID);
		expect(migrated?.render_proof).toBeNull();
		expect(migrated?.step).toBe("render");
		expect(migrated?.structural_ok).not.toContain("render");
		expect(migrated?.passed).not.toContain("render");
		expect(state().render_proof).toBeNull();
		expect(state().step).toBe("render");
		expect(state().structural_ok).not.toContain("render");
		expect(state().passed).not.toContain("render");
	});
});

describe("start", () => {
	test("첫 스텝은 evidence 이고 산출물 쓰기가 열려 있다", async () => {
		const { start } = await cli();
		start(SID, "HEAD~1..HEAD", "sample");
		expect(state().step).toBe("evidence");
		expect(state().capability_step_migration_version).toBe(
			CAPABILITY_STEP_MIGRATION_VERSION,
		);
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

describe("capability step migration persistence", () => {
	function seedOldLaterState(start: (sessionId: string, range: string, slug: string) => void): void {
		start(SID, "unavailable..range", "sample");
		rewriteState((current) => {
			delete current.capability_step_migration_version;
			current.step = "intuition";
			current.passed = ["evidence", "background", "goal", "architecture"];
			current.structural_ok = ["evidence", "background", "goal", "architecture", "intuition"];
			current.commit_hashes = ["abc1234"];
		});
	}

	test("read가 commit_hashes-bearing old later state를 capability로 저장한다", async () => {
		const { read, start } = await cli();
		seedOldLaterState(start);

		const migrated = read(SID);
		expect(migrated?.step).toBe("capability");
		expect(migrated?.capability_step_migration_version).toBe(
			CAPABILITY_STEP_MIGRATION_VERSION,
		);
		expect(migrated?.passed).not.toContain("capability");
		expect(migrated?.structural_ok).not.toContain("capability");
		expect(state().step).toBe("capability");
		expect(state().passed).toEqual(["evidence", "background", "goal", "architecture"]);
		expect(state().structural_ok).toEqual(["evidence", "background", "goal", "architecture"]);
		expect(state().derived).toEqual(migrated?.derived);
	});

	test("read가 migration을 감지한 뒤 잠긴 최신 snapshot을 덮어쓰지 않는다", async () => {
		const { read, start } = await cli();
		seedOldLaterState(start);
		const stateFile = join(sandbox, `explain-diff-state-${SID}.json`);
		const lockPath = `${stateFile}.lock`;
		mkdirSync(lockPath);
		try {
			expect(() => read(SID)).toThrow(`could not acquire state lock: ${lockPath}`);
			expect(state().step).toBe("intuition");
		} finally {
			rmSync(lockPath, { recursive: true, force: true });
		}
	});

	test("migration 중 이미 갱신된 locked snapshot은 그대로 반환한다", async () => {
		const { read, start } = await cli();
		seedOldLaterState(start);
		const stateFile = join(sandbox, `explain-diff-state-${SID}.json`);
		rewriteState((current) => {
			current.capability_step_migration_version = CAPABILITY_STEP_MIGRATION_VERSION;
			current.step = "capability";
			current.passed = ["evidence", "background", "goal", "architecture"];
			current.structural_ok = current.passed.slice();
			current.last_failure = null;
		});
		const latestBytes = readFileSync(stateFile, "utf8");
		mkdirSync(`${stateFile}.lock`);
		try {
			const latest = read(SID);
			expect(latest?.step).toBe("capability");
			expect(readFileSync(stateFile, "utf8")).toBe(latestBytes);
		} finally {
			rmSync(`${stateFile}.lock`, { recursive: true, force: true });
		}
	});

	test("mustRead outer lock 경로는 deadlock 없이 capability migration을 저장한다", async () => {
		const { addConcept } = await cli();
		const { start } = await cli();
		seedOldLaterState(start);

		addConcept(SID, "lock", true);
		expect(state().step).toBe("capability");
		expect(state().capability_step_migration_version).toBe(
			CAPABILITY_STEP_MIGRATION_VERSION,
		);
		expect(state().concepts).toEqual([{ id: "lock", required: true, passed: false }]);
	});

	test("capability와 render-proof migration이 함께 발생한다", async () => {
		const { read, start } = await cli();
		seedOldLaterState(start);
		seedLegacyRenderProof();
		rewriteState((current) => {
			delete current.capability_step_migration_version;
			current.commit_hashes = ["abc1234"];
		});

		const migrated = read(SID);
		expect(migrated?.step).toBe("capability");
		expect(migrated?.capability_step_migration_version).toBe(
			CAPABILITY_STEP_MIGRATION_VERSION,
		);
		expect(migrated?.render_proof).toBeNull();
		expect(migrated?.structural_ok).not.toContain("render");
		expect(migrated?.passed).not.toContain("render");
	});

	test("이미 표시된 capability 통과 상태는 뒤로 되돌리지 않는다", async () => {
		const { read, start } = await cli();
		start(SID, "unavailable..range", "sample");
		rewriteState((current) => {
			current.capability_step_migration_version = CAPABILITY_STEP_MIGRATION_VERSION;
			current.step = "intuition";
			current.passed = ["evidence", "background", "goal", "architecture", "capability"];
			current.structural_ok = current.passed.slice();
			current.commit_hashes = ["abc1234"];
		});

		expect(read(SID)?.step).toBe("intuition");
		expect(state().passed).toContain("capability");
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
const WITH_ARCH_DOC = () =>
	`${WITH_BACKGROUND_DOC}\n${GOAL_SECTION}\n${ARCH_SECTION}\n${CAPABILITY_SECTION}\n${JOURNEY_SECTION}`;

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
		// R6·R7·R12·R23·R24를 매 스텝에 함께 싣는다 — 각 스텝이 요구하는 필수 ID를 놓치지
		// 않기 위해서이고, 요구되지 않는 스텝에서는 여분의 검증된 통과 항목일 뿐이다.
		passStep(SID, s, doc, [
			{ id: "R6", pass: true, quote: "state-lock" },
			{ id: "R7", pass: true, quote: "state-lock" },
			{ id: "R12", pass: true, quote: "state-lock" },
			{ id: "R23", pass: true, quote: "state-lock" },
			{ id: "R24", pass: true, quote: "state-lock" },
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
		// 커밋 메시지에 GOOD_DOC 의 근거 인용을 담아 R22(근거 소스 대조)와 픽스처를
		// 내부 일관되게 만든다 — 문서가 근거로 인용하는 문장은 실제 소스에 있어야 한다.
		git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "fix: ultragoal 상태 갱신 락 통합");
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

	test("code 스텝은 R7만으로는 통과하지 못한다 — R24 미제출", async () => {
		const { submitStep, passStep } = await advanceTo("code", () => FULL_DOC);
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "code", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "code", doc, [
			{ id: "R7", pass: true, quote: "락을 공용 모듈로 뽑아낸다" },
		]);
		expect(rc).toBe(1);
		expect(state().last_failure.items.join(" ")).toContain("R24");
		expect(state().step).toBe("code");
	});

	test("code 스텝은 R7·R24를 pass:true + 실재 인용으로 제출해야 통과하고 render로 넘어간다", async () => {
		const { submitStep, passStep } = await advanceTo("code", () => FULL_DOC);
		const doc = docFile(GOOD_DOC);
		submitStep(SID, "code", doc, ["lib/state-lock.ts"], []);
		const rc = passStep(SID, "code", doc, [
			{ id: "R7", pass: true, quote: "락을 공용 모듈로 뽑아낸다" },
			{ id: "R24", pass: true, quote: "락을 공용 모듈로 뽑아낸다" },
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
		"capability",
		"intuition",
		"commits",
		"code",
	] as const) {
		submitStep(SID, step, doc, ["lib/state-lock.ts"], []);
		passStep(SID, step, doc, [
			{ id: "R6", pass: true, quote },
			{ id: "R7", pass: true, quote },
			{ id: "R12", pass: true, quote },
			{ id: "R23", pass: true, quote },
			{ id: "R24", pass: true, quote },
		]);
	}
	return { passStep, submitStep, doc };
}

/** render 게이트가 요구하는 검증 리포트(technical-writing)를 통과 형태로 만든다. */
function reportFiles(): { writing: string; checklist: string } {
	const writing = join(sandbox, "writing-report.md");
	writeFileSync(writing, "지적 2건 반영.\nREVIEW: APPLIED\n", "utf8");
	const checklist = join(sandbox, "final-checklist.md");
	writeFileSync(checklist, checklistReport(), "utf8");
	return { writing, checklist };
}

const REFERENCE_CSS = [
	readFileSync(join(import.meta.dir, "../../html-report/references/diagram-classes.css"), "utf8"),
	readFileSync(join(import.meta.dir, "../references/components.css"), "utf8"),
].join("\n");

const COMMIT_HASH = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";
const CHANGED_PATH = "lib/state-lock.ts";

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 문서에서 손으로 짠 것과 같은 모양의 최소 HTML 페이지: 기준 스타일시트, 문서 헤딩(h2/h3),
 * 문서 본문(문단·목록·표·컴포넌트)을 marked 로 렌더한 섹션, figure 의 SVG 그대로, 코드 펜스를 구문 강조 span 이 든 <pre> 로, 커밋 해시와 경로 문장.
 */
function authorHtml(doc: string): string {
	const headings = [...doc.matchAll(/^(#{2,3})\s+(.+)$/gm)]
		.map((m) => `<h${m[1]?.length ?? 2}>${escapeHtml((m[2] ?? "").replace(/`/g, ""))}</h${m[1]?.length ?? 2}>`)
		.join("\n");
	const figures = diagramFigures(doc)
		.map((f) => f.html)
		.join("\n");
	const code = [...doc.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)]
		.map((m) => `<pre><code><span class="kw">${escapeHtml(m[1] ?? "")}</span></code></pre>`)
		.join("\n");
	// 헤딩·코드·figure 는 위에서 따로 싣는다 — 본문(문단·목록·표·컴포넌트)만 marked 로 렌더한다.
	const bodyTokens = Lexer.lex(doc.replace(new RegExp(`^ {0,3}${DIAGRAM_FIGURE_PATTERN}`, "gim"), "\n")).filter(
		(t) => t.type !== "heading" && t.type !== "code",
	);
	const prose = Parser.parse(bodyTokens);
	return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>설명</title><style>${REFERENCE_CSS}</style></head>
<body><main>
<h1>설명</h1>
<p>커밋 <code>${COMMIT_HASH.slice(0, 7)}</code> 가 <code>${CHANGED_PATH}</code> 를 바꾼다.</p>
${headings}
${figures}
${code}
<section class="prose">${prose}</section>
</main></body></html>
`;
}

interface PreparedPage {
	doc: string;
	htmlPath: string;
	receiptPath: string;
	lintSource: string;
	writing: string;
	checklist: string;
	render: RenderSubmission;
}

/** 문서 → 손으로 만든 HTML → lint 영수증 → 리포트까지 한 번에 놓는다. `edit` 는 HTML 바이트를 영수증 발급 전에 고친다. */
function preparePage(doc: string, edit: (html: string) => string = (html) => html): PreparedPage {
	rewriteState((current) => {
		current.commit_hashes = [COMMIT_HASH];
		current.diff_hunks = [{ path: CHANGED_PATH, base: null, head: { start: 1, count: 14 } }];
	});
	const htmlPath = join(sandbox, "doc.html");
	writeFileSync(htmlPath, edit(authorHtml(readFileSync(doc, "utf8"))), "utf8");
	const lintSource = join(sandbox, "evidence");
	mkdirSync(lintSource, { recursive: true });
	const receiptPath = writeLintReceipt(join(sandbox, "lint-receipt.json"), htmlPath, lintSource);
	const rep = reportFiles();
	return {
		doc,
		htmlPath,
		receiptPath,
		lintSource,
		writing: rep.writing,
		checklist: rep.checklist,
		render: {
			htmlPath,
			receiptPath,
			lintSource,
			writingReport: rep.writing,
			checklistPath: rep.checklist,
		},
	};
}

/** HTML 을 고친 뒤 새 영수증까지 다시 발급한다(lint 를 다시 돌린 것과 같다). */
function relint(page: PreparedPage, html: string): void {
	writeFileSync(page.htmlPath, html, "utf8");
	writeLintReceipt(page.receiptPath, page.htmlPath, page.lintSource);
}

const CHECKLIST_AXES = [
	["1", "시스템 분해"],
	["2", "양측 커버리지"],
	["3", "목표→그림→해석"],
	["4", "상태 다이어그램"],
	["5", "로직 flowchart"],
	["6", "실재 식별자+변경 마커"],
	["7", "시퀀스 완결성"],
	["8", "사용자 여정"],
	["9", "HTML 렌더"],
	["10", "쓰기 전에 소개"],
] as const;

function checklistReport(
	rows: Array<{ number: string; axis: string; status: string; evidence: string }> = CHECKLIST_AXES.map(
		([number, axis]) => ({
			number,
			axis,
			status: number === "2" || number === "4" ? "N.A" : "PASS",
			evidence: `${axis} 근거를 문서에서 확인했다.`,
		}),
	),
): string {
	return [
		"| # | 축 | 판정 | 근거 |",
		"|---|---|---|---|",
		...rows.map(({ number, axis, status, evidence }) => `| ${number} | ${axis} | ${status} | ${evidence} |`),
		"CHECKLIST: ALL PASS",
		"",
	].join("\n");
}

/** 한 축만 status 를 바꾼 체크리스트 */
function checklistWith(number: string, status: string, evidence = "수정이 필요하다."): string {
	return checklistReport(
		CHECKLIST_AXES.map(([n, axis]) => ({
			number: n,
			axis,
			status: n === number ? status : "PASS",
			evidence: n === number ? evidence : `${axis} 근거를 문서에서 확인했다.`,
		})),
	);
}

describe("render 산출물 검사 (모델이 쓴 HTML + 내용 증명)", () => {
	/** 제출이 실패해 render 에 남고 last_failure 가 needle 을 말하는지 확인한다. */
	function expectRejected(rc: number, needle: string): void {
		expect(rc).toBe(1);
		expect(state().step).toBe("render");
		expect(state().structural_ok).not.toContain("render");
		expect(state().last_failure.step).toBe("render");
		expect(state().last_failure.items.join(" ")).toContain(needle);
	}

	describe("a. HTML 파일", () => {
		test("--html 없이 제출하면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			expectRejected(submitStep(SID, "render", doc, [], []), "--html");
		});

		test("존재하지 않는 HTML 경로는 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			const rc = submitStep(SID, "render", doc, [], [], { ...page.render, htmlPath: join(sandbox, "없음.html") });
			expectRejected(rc, "찾을 수 없습니다");
		});

		test("빈 HTML 파일은 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeFileSync(page.htmlPath, "", "utf8");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "비어 있습니다");
		});

		test("<body> 안에 내용이 없으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, () => "<!doctype html><html><head><title>x</title></head><body>\n</body></html>");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "<body>");
		});

		test("<html> 태그가 없는 조각은 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, () => "<body><p>조각</p></body>");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "<html>");
		});

		test("HTML 이 문서보다 오래되면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			const old = new Date(Date.now() - 3_600_000);
			utimesSync(page.htmlPath, old, old);
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "문서보다 오래됐습니다");
		});
	});

	describe("b. lint 영수증", () => {
		test("--receipt 없이 제출하면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expectRejected(submitStep(SID, "render", doc, [], [], { ...page.render, receiptPath: undefined }), "--receipt");
		});

		test("--lint-source 없이 제출하면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expectRejected(submitStep(SID, "render", doc, [], [], { ...page.render, lintSource: undefined }), "--lint-source");
		});

		test("lint 뒤에 HTML 바이트가 바뀌면 영수증이 맞지 않아 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeFileSync(page.htmlPath, `${readFileSync(page.htmlPath, "utf8")}<!-- lint 뒤 수정 -->\n`, "utf8");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "lint 영수증이 유효하지 않습니다");
		});

		test("에러가 남은 영수증은 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeLintReceipt(page.receiptPath, page.htmlPath, page.lintSource, { errors: 2 });
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "lint 영수증이 유효하지 않습니다");
		});

		test("다른 원천 폴더로 lint 한 영수증은 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			const other = join(sandbox, "other-evidence");
			mkdirSync(other);
			writeLintReceipt(page.receiptPath, page.htmlPath, other);
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "lint 영수증이 유효하지 않습니다");
		});

		test("원천 폴더가 없으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			const missing = join(sandbox, "없는-증거");
			writeLintReceipt(page.receiptPath, page.htmlPath, missing);
			expectRejected(submitStep(SID, "render", doc, [], [], { ...page.render, lintSource: missing }), "lint 원천 폴더를 찾을 수 없습니다");
		});
	});

	describe("c. 다이어그램 SVG", () => {
		test("SVG 한 바이트만 달라도 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace('x="16" y="24">CLI', 'x="17" y="24">CLI'));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "1번째 SVG");
		});

		test("SVG 가 하나 빠지면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace(/(<figure\b[^>]*>\s*)<svg\b[\s\S]*?<\/svg>/, "$1"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "번째 SVG");
		});

		test("SVG 의 순서가 문서와 다르면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => {
				const svgs = html.match(/<svg viewBox[\s\S]*?<\/svg>/g) ?? [];
				const [first, second] = svgs;
				return html.replace(first ?? "", "@@A@@").replace(second ?? "", first ?? "").replace("@@A@@", second ?? "");
			});
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "순서");
		});
	});

	describe("d. 코드 블록", () => {
		test("구문 강조 span 이 있어도 코드 글자가 같으면 통과한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(readFileSync(page.htmlPath, "utf8")).toContain('<span class="kw">');
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
		});

		test("코드 한 줄을 고치면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace("// 획득 → fn() → 해제", "// 획득 → fn() → 반납"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "코드 블록");
		});

		test("<pre> 가 아닌 곳에 코드를 두면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace(/<pre>/g, "<div>").replace(/<\/pre>/g, "</div>"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "<pre>");
		});

		test("숫자 엔티티로 쓴 코드 글자도 같은 글자로 본다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace("export function", "&#101;xport&#x20;function"));
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
		});
	});

	describe("e. 커밋 해시와 변경 경로", () => {
		test("HTML 에 커밋 해시가 없으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replaceAll(COMMIT_HASH.slice(0, 7), "0000000"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), COMMIT_HASH.slice(0, 7));
		});

		test("HTML 에 변경 파일 경로가 없으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replaceAll(CHANGED_PATH, "lib/other.ts"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), CHANGED_PATH);
		});
	});

	describe("f. 헤딩", () => {
		test("문서 헤딩이 HTML h2/h3 에 없으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace("<h2>Background</h2>", "<p>Background</p>"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), '"Background"');
		});

		test("헤딩 순서가 문서와 다르면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) =>
				html.replace("<h2>Evidence</h2>", "@@E@@").replace("<h2>Background</h2>", "<h2>Evidence</h2>").replace("@@E@@", "<h2>Background</h2>"),
			);
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "순서");
		});

		test("헤딩 안의 태그와 공백은 무시하고 글자로 비교한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace("<h2>Evidence</h2>", "<h2>  <span>Evi</span>dence\n</h2>"));
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
		});
	});

	describe("본문 텍스트 verbatim", () => {
		const withoutProse = (html: string): string => html.replace(/<section class="prose">[\s\S]*<\/section>/, "");

		test("헤딩·figure·코드만 있는 얇은 페이지는 빠진 본문 텍스트 개수를 짚어 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, withoutProse);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(1);
			expect(state().last_failure.items.join(" ")).toContain("문서 본문 텍스트 60개");
		});

		test("문단의 단어 하나를 바꾸면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace("한 파일로 모은다", "한 파일로 합친다"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "한 파일로 모은다");
		});

		test("표 셀 하나가 빠지면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace("변경 없음: 상태는 JSON 파일이다", "변경 없음"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "상태는 JSON 파일이다");
		});

		test("컴포넌트 카드의 텍스트가 빠지면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace("두 CLI가 같은 락을 쓴다", ""));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "두 CLI가 같은 락을 쓴다");
		});

		test("텍스트를 span·style 로 감싸고 &nbsp; 를 써도 글자가 같으면 통과한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) =>
				html.replace("한 파일로 모은다", '<span style="color:red">한&nbsp;파일로</span>\u200b <em>모은다</em>'),
			);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
		});
	});

	describe("g. foreignObject", () => {
		test("페이지에 <foreignObject> 가 있으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) =>
				html.replace("</main>", '<svg viewBox="0 0 10 10"><foreignObject width="80"><div>clipped</div></foreignObject></svg></main>'),
			);
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "foreignObject");
		});
	});

	describe("h. 클래스 스타일 규칙", () => {
		test("문서가 쓰는 컴포넌트 클래스의 규칙이 <style> 에 없으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace(/\.arch-entity\b/g, ".renamed-entity"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "arch-entity");
		});

		test("SVG 클래스 규칙이 없어도 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc, (html) => html.replace(/\.t-b(?![\w-])/g, ".t-renamed"));
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "t-b");
		});

		test("기준 스타일시트는 FULL_DOC 이 쓰는 모든 클래스를 정의한다", () => {
			for (const cls of usedStyleClasses(FULL_DOC)) {
				expect(new RegExp(`\\.${cls}(?![\\w-])`).test(REFERENCE_CSS)).toBe(true);
			}
		});
	});

	describe("i. 리포트와 체크리스트", () => {
		test("정상 제출은 통과하고 v2 render_proof 를 남긴다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
			expect(state().structural_ok).toContain("render");
			expect(state().render_proof_contract_version).toBe(2);
			const proof = state().render_proof;
			expect(Object.keys(proof).sort()).toEqual([
				"checklist_path",
				"doc_path",
				"doc_sha256",
				"html_path",
				"html_sha256",
				"lint_receipt_path",
				"lint_source_path",
				"writing_report_path",
			]);
			expect(proof.doc_sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(proof.html_sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(proof.lint_source_path).toBe(page.lintSource);
		});

		test("visual-qa 리포트 없이도 통과한다 — 시각 검증은 lint 영수증이 증명한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
		});

		test("--checklist 없이 제출하면 실패하고 현재 스텝은 render 에 남는다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expectRejected(submitStep(SID, "render", doc, [], [], { ...page.render, checklistPath: undefined }), "--checklist");
		});

		test("존재하지 않는 checklist 파일은 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			const rc = submitStep(SID, "render", doc, [], [], { ...page.render, checklistPath: join(sandbox, "없는-checklist.md") });
			expectRejected(rc, "체크리스트 리포트");
		});

		test("checklist 마지막 verdict가 CHECKLIST: ALL PASS가 아니면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeFileSync(page.checklist, "체크리스트 검토 결과\nCHECKLIST: NOT PASS\n", "utf8");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "CHECKLIST: ALL PASS");
		});

		test("마지막 ALL PASS 표식만 있고 10개 축 행이 없으면 거부한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeFileSync(page.checklist, "CHECKLIST: ALL PASS\n", "utf8");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "10개");
		});

		test("축 10의 N.A 판정은 거부한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeFileSync(page.checklist, checklistWith("10", "N.A", "근거"), "utf8");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "축 10");
		});

		test("장식된 FAIL 행은 마지막 ALL PASS 표식이 있어도 거부한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			for (const status of ["**FAIL**", "'FAIL'", "<strong>FAIL</strong>"]) {
				writeFileSync(page.checklist, checklistWith("1", status), "utf8");
				expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(1);
				expect(state().step).toBe("render");
			}
		});

		test("축 중복·누락·허용되지 않은 상태는 마지막 ALL PASS 표식이 있어도 거부한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			const validRows = CHECKLIST_AXES.map(([number, axis]) => ({
				number,
				axis,
				status: "PASS",
				evidence: "문서에서 확인했다.",
			}));
			const invalidRows = [
				validRows.map((row) => (row.number === "9" ? { ...row, number: "1" } : row)),
				validRows.slice(0, 8),
				validRows.map((row) => (row.number === "1" ? { ...row, status: "MAYBE" } : row)),
			];
			for (const rows of invalidRows) {
				writeFileSync(page.checklist, checklistReport(rows), "utf8");
				expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(1);
				expect(state().step).toBe("render");
			}
		});

		test("앞선 FAIL 행이 있으면 마지막 ALL PASS 표식만으로 통과하지 못한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeFileSync(
				page.checklist,
				"| # | 축 | 판정 | 근거 |\n|---|---|---|---|\n| 1 | 시스템 분해 | FAIL | 수정 필요 |\nCHECKLIST: ALL PASS\n",
				"utf8",
			);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(1);
			expect(state().structural_ok).not.toContain("render");
		});

		test("PASS와 N.A 행은 trailing whitespace 뒤의 ALL PASS 표식과 함께 통과한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeFileSync(page.checklist, `${checklistReport().trimEnd()}   \n\t\n`, "utf8");
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
		});

		test("technical-writing 리포트가 없거나 REVIEW: APPLIED 가 없으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], { ...page.render, writingReport: undefined })).toBe(1);
			writeFileSync(page.writing, "리뷰만 하고 반영 안 함\n", "utf8");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "REVIEW: APPLIED");
		});

		test("리포트의 종결 표식 뒤 미해결 항목이 있으면 실패한다", async () => {
			const { submitStep, doc } = await driveToRender();
			const page = preparePage(doc);
			writeFileSync(page.writing, "REVIEW: APPLIED\n미반영 지적\n", "utf8");
			expectRejected(submitStep(SID, "render", doc, [], [], page.render), "REVIEW: APPLIED");
		});
	});

	describe("pass-step 재검증", () => {
		test("render 통과 후 pass-step 은 심사 항목 없이 quiz 로 넘긴다", async () => {
			const { submitStep, passStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
			expect(passStep(SID, "render", doc, [])).toBe(0);
			expect(state().step).toBe("quiz");
		});

		test("제출 뒤 HTML 을 고치면 영수증 불일치로 pass-step 이 실패한다", async () => {
			const { submitStep, passStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
			writeFileSync(page.htmlPath, readFileSync(page.htmlPath, "utf8").replace("// 획득 → fn() → 해제", "// 획득 → fn() → 반납"), "utf8");
			expect(passStep(SID, "render", doc, [])).toBe(1);
			expect(state().step).toBe("render");
			const items = state().last_failure.items.join(" ");
			expect(items).toContain("코드 블록");
			expect(items).toContain("lint 영수증이 유효하지 않습니다");
			expect(items).toContain("제출 뒤 HTML 이 바뀌었습니다");
		});

		test("제출 뒤 HTML 을 고치고 영수증을 새로 받아도 다시 submit-step 하지 않으면 실패한다", async () => {
			const { submitStep, passStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
			relint(page, `${readFileSync(page.htmlPath, "utf8")}<!-- 재 lint 한 수정 -->\n`);
			expect(passStep(SID, "render", doc, [])).toBe(1);
			expect(state().last_failure.items.join(" ")).toContain("제출 뒤 HTML 이 바뀌었습니다");
		});

		test("제출 뒤 문서를 고치면 pass-step 이 실패한다", async () => {
			const { submitStep, passStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
			writeFileSync(doc, readFileSync(doc, "utf8").replace("내용", "고친 산문"), "utf8");
			expect(passStep(SID, "render", doc, [])).toBe(1);
			expect(state().last_failure.items.join(" ")).toContain("제출 뒤 문서가 바뀌었습니다");
		});

		test("제출 뒤 checklist 가 FAIL 이면 pass-step 이 재검증에 실패한다", async () => {
			const { submitStep, passStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
			writeFileSync(page.checklist, checklistWith("1", "FAIL", "변경된 판정"), "utf8");
			expect(passStep(SID, "render", doc, [])).toBe(1);
			expect(state().step).toBe("render");
			expect(state().last_failure?.items.join(" ")).toContain("허용되지 않습니다");
		});

		test("제출 뒤 writing report 가 바뀌면 pass-step 이 재검증에 실패한다", async () => {
			const { submitStep, passStep, doc } = await driveToRender();
			const page = preparePage(doc);
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
			writeFileSync(page.writing, "변경된 report\n", "utf8");
			expect(passStep(SID, "render", doc, [])).toBe(1);
			expect(state().step).toBe("render");
		});

		test("제출 뒤 다른 docPath 로 pass-step 을 호출하면 거부한다", async () => {
			const { submitStep, passStep, doc } = await driveToRender();
			const page = preparePage(doc);
			const otherDoc = join(sandbox, "other-doc.md");
			writeFileSync(otherDoc, readFileSync(doc, "utf8"), "utf8");
			expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
			expect(passStep(SID, "render", otherDoc, [])).toBe(1);
			expect(state().step).toBe("render");
			expect(state().last_failure?.items.join(" ")).toContain("docPath");
		});
	});

	describe("render proof 계약 버전", () => {
		test("구 계약이 없는 render proof는 pass-step 전에 무효화된다", async () => {
			const { passStep, doc } = await driveToRender();
			rewriteState((current) => {
				delete current.render_proof_contract_version;
				current.structural_ok = ["render"];
			});
			expect(() => passStep(SID, "render", doc, [])).toThrow(/submit-step/);
			expect(state().step).toBe("render");
			expect(state().structural_ok).not.toContain("render");
		});

		test("v1 render proof 로 이미 quiz 에 있어도 render 로 되돌아가고 한국어 사유를 남긴다", async () => {
			const { read, passStep } = await cli();
			const { doc } = await driveToRender();
			rewriteState((current) => {
				current.render_proof_contract_version = 1;
				current.render_proof = {
					doc_path: doc,
					html_path: join(sandbox, "doc.html"),
					writing_report_path: join(sandbox, "writing-report.md"),
					checklist_path: join(sandbox, "final-checklist.md"),
				};
				current.structural_ok = ["render"];
				current.passed = [...current.passed, "render"];
				current.step = "quiz";
				current.last_failure = null;
			});

			const migrated = read(SID);
			expect(migrated?.step).toBe("render");
			expect(migrated?.render_proof).toBeNull();
			expect(migrated?.structural_ok).not.toContain("render");
			expect(migrated?.passed).not.toContain("render");
			expect(migrated?.render_proof_contract_version).toBe(2);
			expect(migrated?.last_failure?.step).toBe("render");
			expect(migrated?.last_failure?.items.join(" ")).toContain("lint 영수증");
			expect(state().step).toBe("render");
			expect(() => passStep(SID, "render", doc, [])).toThrow(/submit-step/);
		});

		test("v2 버전 표기라도 v1 모양(해시·영수증 없는) 증거는 무효로 본다", async () => {
			const { read } = await cli();
			const { doc } = await driveToRender();
			rewriteState((current) => {
				current.render_proof = {
					doc_path: doc,
					html_path: join(sandbox, "doc.html"),
					writing_report_path: join(sandbox, "writing-report.md"),
					checklist_path: join(sandbox, "final-checklist.md"),
				};
				current.structural_ok = ["render"];
			});
			const migrated = read(SID);
			expect(migrated?.render_proof).toBeNull();
			expect(migrated?.structural_ok).not.toContain("render");
		});
	});

	test("evidence 부터 render 까지 전 스텝을 통과시키고 필수 개념을 채우면 complete 가 성공한다", async () => {
		const { submitStep, passStep, addConcept, ask, grade, complete } = await cli();
		const { doc } = await driveToRender();
		const page = preparePage(doc);
		expect(submitStep(SID, "render", doc, [], [], page.render)).toBe(0);
		expect(passStep(SID, "render", doc, [])).toBe(0);
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

describe("help subcommand", () => {
	// help renders this CLI's roster via the shared lib/cli-help.ts renderer, grouped by
	// authority. This pins the explain-diff-specific wiring (roster tags), not the
	// renderer's own formatting — that's covered by lib/cli-help.test.ts. Run through the
	// real script (not the imported functions) since help lives in main()'s dispatch.
	const script = join(import.meta.dir, "explain-diff-state.ts");
	const run = (args: string[], env?: Record<string, string>) =>
		execFileSync("bun", [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

	test("every roster command is listed under AI-USABLE (no user/system/hook path exists)", () => {
		const out = run(["help"]);
		expect(out).toContain("AI-USABLE");
		expect(out).not.toContain("USER-ONLY");
		expect(out).not.toContain("SYSTEM-ONLY");
		expect(out).not.toContain("HOOK-ONLY");
		for (const name of ["start", "get", "submit-step", "pass-step", "add-concept", "ask", "grade", "complete"]) {
			expect(out).toContain(`${name} —`);
		}
	});

	test("Usage fallback lists help plus every roster command", () => {
		expect(() => run(["bogus-subcommand"])).toThrow();
		try {
			run(["bogus-subcommand"]);
		} catch (e: any) {
			expect(e.stderr.toString()).toContain("help|start|get|submit-step|pass-step|add-concept|ask|grade|complete");
		}
	});

	// help is a discovery command — it must not require resolveSessionIdOrThrow's
	// precondition. What breaks if this regresses: help runs after the session-id
	// resolution again and throws with no session id set.
	test("prints without a session id set (session-independent discovery)", () => {
		const out = run(["help"], { OMT_SESSION_ID: "", CODEX_THREAD_ID: "" });
		expect(out).toContain("explain-diff-state commands:");
	});
});
