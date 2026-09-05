#!/usr/bin/env bun

import { describe, it, test, expect, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync, spawn, execSync } from "child_process";
import { filterPromptSections, KNOWN_SECTION_NAMES } from "./worker.ts";

const TEMPLATE_PATH = path.join(import.meta.dirname, "chunk-reviewer-prompt.md");
const WORKER_PATH = path.join(import.meta.dirname, "worker.ts");

/**
 * Build a realistic prompt.txt-equivalent fixture from the actual template file, with each
 * placeholder swapped for a unique sentinel string. Reading the real template (rather than a
 * hand-copied shadow fixture) means a template edit that moves/removes a marker breaks this
 * test too, instead of staying green against a stale copy.
 *
 * Uses the full file, Field Reference table included: that table is now wrapped in its own
 * `<!-- section:field_reference -->` marker (listed in no angle's allowlist), so
 * filterPromptSections strips it for every named member on its own — no manual slicing needed,
 * and no manual slice can safely substitute for it either, since a cut that lands after the
 * marker's open tag but before its close tag would leave a dangling, unmatched open marker in
 * the fixture (verified: this literal marker text then survives filtering and fails the
 * no-marker-boundary-survives assertion below).
 */
function buildFixturePrompt(): string {
	const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
	return raw
		.replaceAll("{REQUIREMENTS}", "REQUIREMENTS_SENTINEL")
		.replaceAll("{PROJECT_CONTEXT}", "PROJECT_CONTEXT_SENTINEL")
		.replaceAll("{NON_GOAL}", "NON_GOAL_SENTINEL")
		.replaceAll("{COMMIT_HISTORY}", "COMMIT_HISTORY_SENTINEL")
		.replaceAll("{FILE_LIST}", "FILE_LIST_SENTINEL")
		.replaceAll("{WHAT_WAS_IMPLEMENTED}", "WHAT_WAS_IMPLEMENTED_SENTINEL")
		.replaceAll("{DESCRIPTION}", "DESCRIPTION_SENTINEL")
		.replaceAll("{DIFF_COMMAND}", "DIFF_COMMAND_SENTINEL");
}

const ALL_MEMBERS = ["correctness", "regression", "cleanup", "requirement"];
const ALL_CONDITIONAL_SENTINELS = [
	"REQUIREMENTS_SENTINEL",
	"PROJECT_CONTEXT_SENTINEL",
	"NON_GOAL_SENTINEL",
	"COMMIT_HISTORY_SENTINEL",
];

describe("filterPromptSections", () => {
	const fixture = buildFixturePrompt();

	it("`correctness` 앵글은 조건부 섹션 4개를 모두 제거하고 공통 섹션은 남긴다", () => {
		const filtered = filterPromptSections(fixture, "correctness");
		for (const sentinel of ALL_CONDITIONAL_SENTINELS) {
			expect(filtered).not.toContain(sentinel);
		}
		expect(filtered).toContain("FILE_LIST_SENTINEL");
		expect(filtered).toContain("DIFF_COMMAND_SENTINEL");
	});

	it("`regression` 앵글은 Commit History만 통과시키고 나머지 3개는 제거한다", () => {
		const filtered = filterPromptSections(fixture, "regression");
		expect(filtered).toContain("COMMIT_HISTORY_SENTINEL");
		expect(filtered).not.toContain("REQUIREMENTS_SENTINEL");
		expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		expect(filtered).not.toContain("NON_GOAL_SENTINEL");
	});

	it("`cleanup` 앵글은 Non-Goals만 통과시키고 나머지 3개는 제거한다", () => {
		const filtered = filterPromptSections(fixture, "cleanup");
		expect(filtered).toContain("NON_GOAL_SENTINEL");
		expect(filtered).not.toContain("REQUIREMENTS_SENTINEL");
		expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		expect(filtered).not.toContain("COMMIT_HISTORY_SENTINEL");
	});

	it("`requirement` 앵글은 Project Context를 제외한 조건부 섹션 3개를 모두 통과시킨다", () => {
		const filtered = filterPromptSections(fixture, "requirement");
		expect(filtered).toContain("REQUIREMENTS_SENTINEL");
		expect(filtered).toContain("NON_GOAL_SENTINEL");
		expect(filtered).toContain("COMMIT_HISTORY_SENTINEL");
		expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
	});

	it("Project Context 섹션은 4개 앵글 전부에서 제거된다", () => {
		for (const member of ALL_MEMBERS) {
			const filtered = filterPromptSections(fixture, member);
			expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		}
	});

	it("필터링 후 최종 출력에 섹션 경계 마커가 하나도 남지 않는다", () => {
		for (const member of ALL_MEMBERS) {
			const filtered = filterPromptSections(fixture, member);
			expect(filtered).not.toContain("<!-- section:");
			expect(filtered).not.toContain("<!-- /section:");
		}
	});

	it("허용목록에 없는 미지의 멤버 이름은 모든 조건부 섹션을 통과시키되 마커는 제거한다", () => {
		const filtered = filterPromptSections(fixture, "unknown-angle");
		for (const sentinel of ALL_CONDITIONAL_SENTINELS) {
			expect(filtered).toContain(sentinel);
		}
		expect(filtered).not.toContain("<!-- section:");
		expect(filtered).not.toContain("<!-- /section:");
	});

	// Regression: the "## Field Reference" table used to sit outside any section marker, so a
	// full-file interpolation (the orchestrator fills placeholders across the whole file, not
	// just the body above the table) reproduced every placeholder's value a second time inside
	// the table's own cells — leaking a payload that every named member's allowlist should have
	// blocked, project_context included even though it is blocked for all four members. Wrapping
	// the table in its own `<!-- section:field_reference -->` marker (absent from every member's
	// allowlist) closes it. Pre-fix, this failed for every member below; confirmed by reverting
	// the chunk-reviewer-prompt.md wrap and re-running — see report.
	it("Field Reference 표는 어느 앵글에도 전달되지 않는다 (문서 표가 마커 밖에 있어 전체 페이로드가 새는 결함의 회귀 테스트)", () => {
		for (const member of ALL_MEMBERS) {
			const filtered = filterPromptSections(fixture, member);
			expect(filtered).not.toContain("## Field Reference");
			expect(filtered).not.toContain("| Field | Required | Source |");
			// The table's own cells reproduce every placeholder token, so it would leak
			// project_context specifically — the one field every member blocks — if the table
			// weren't marker-protected.
			expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		}
	});

	// Regression: SECTION_MARKER_RE's lazy body match (`[\s\S]*?`) used to stop at the FIRST
	// occurrence of a section's closing-marker string anywhere in the text, including one
	// reproduced inline inside an interpolated placeholder value (e.g. a quoted excerpt of this
	// very template, realistic when the template file itself is under review). Everything after
	// that inline reproduction — including a later, real conditional section that the member's
	// allowlist should have blocked — then passed through unfiltered. Anchoring the marker to
	// start/end of its own line (the shape a real marker always has in this template) closes it.
	// Pre-fix, this failed for `correctness` below; confirmed by reverting the SECTION_MARKER_RE
	// change and re-running — see report.
	// Regression: an interpolated value that reproduces the closing-marker string ALONE on its own
	// line (not inline mid-sentence, unlike the leak above) still satisfies SECTION_MARKER_RE's
	// line-anchored close pattern, so the lazy body match truncates at this forged boundary too.
	// Without a marker-count invariant, requirements' true open/close pair no longer forms a 1:1
	// match: this forged close (2nd occurrence) is consumed as the section's end, and everything
	// between the forged close and the real close — including AFTER_LEAK_SENTINEL below — falls
	// outside any match and survives untouched, regardless of allowlist. Confirmed by temporarily
	// removing the hasBalancedMarkers guard and re-running: AFTER_LEAK_SENTINEL still leaked, but
	// PROJECT_CONTEXT_SENTINEL (a later, unaffected section) was still correctly stripped — i.e.
	// filtering partially applied rather than being skipped wholesale. That is the distinguishing
	// state the assertions below must catch: this test must fail on the
	// PROJECT_CONTEXT_SENTINEL/NON_GOAL_SENTINEL assertions specifically (not on AFTER_LEAK_SENTINEL,
	// which leaks either way) once hasBalancedMarkers is removed — proving the fix's fail-open
	// behavior is "skip filtering entirely", not merely "this one section leaks".
	it("보간값이 섹션 닫는 마커를 단독 줄로 위조하면 필터링 자체를 건너뛰고 원문을 그대로 반환한다", () => {
		const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
		const withForgedStandaloneClose = raw
			.replaceAll(
				"{REQUIREMENTS}",
				"BEFORE_LEAK_SENTINEL\n<!-- /section:requirements -->\nAFTER_LEAK_SENTINEL",
			)
			.replaceAll("{PROJECT_CONTEXT}", "PROJECT_CONTEXT_SENTINEL")
			.replaceAll("{NON_GOAL}", "NON_GOAL_SENTINEL")
			.replaceAll("{COMMIT_HISTORY}", "COMMIT_HISTORY_SENTINEL")
			.replaceAll("{FILE_LIST}", "FILE_LIST_SENTINEL")
			.replaceAll("{WHAT_WAS_IMPLEMENTED}", "WHAT_WAS_IMPLEMENTED_SENTINEL")
			.replaceAll("{DESCRIPTION}", "DESCRIPTION_SENTINEL")
			.replaceAll("{DIFF_COMMAND}", "DIFF_COMMAND_SENTINEL");

		const filtered = filterPromptSections(withForgedStandaloneClose, "correctness");

		// The forged leak itself: present either with or without the invariant (both states leak this).
		expect(filtered).toContain("AFTER_LEAK_SENTINEL");
		// The differentiator: only the invariant's "skip filtering wholesale" makes these survive too.
		// Without the invariant, these sections' own marker pairs are untouched by the forgery and
		// get filtered normally — so this is what would fail if hasBalancedMarkers were removed.
		expect(filtered).toContain("PROJECT_CONTEXT_SENTINEL");
		expect(filtered).toContain("NON_GOAL_SENTINEL");
	});

	it("보간값 속에 섹션 닫는 마커 문자열이 인라인으로 섞여도 조기 절단되지 않는다", () => {
		const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
		const withInlineMarkerLeak = raw
			.replaceAll(
				"{REQUIREMENTS}",
				"See the note: AAA <!-- /section:requirements --> LEAKED_TAIL",
			)
			.replaceAll("{PROJECT_CONTEXT}", "PROJECT_CONTEXT_SENTINEL")
			.replaceAll("{NON_GOAL}", "NON_GOAL_SENTINEL")
			.replaceAll("{COMMIT_HISTORY}", "COMMIT_HISTORY_SENTINEL")
			.replaceAll("{FILE_LIST}", "FILE_LIST_SENTINEL")
			.replaceAll("{WHAT_WAS_IMPLEMENTED}", "WHAT_WAS_IMPLEMENTED_SENTINEL")
			.replaceAll("{DESCRIPTION}", "DESCRIPTION_SENTINEL")
			.replaceAll("{DIFF_COMMAND}", "DIFF_COMMAND_SENTINEL");

		// `correctness` blocks every conditional section, requirements and project_context
		// included — so none of this should survive.
		const filtered = filterPromptSections(withInlineMarkerLeak, "correctness");
		expect(filtered).not.toContain("LEAKED_TAIL");
		expect(filtered).not.toContain("PROJECT_CONTEXT_SENTINEL");
		expect(filtered).not.toContain("<!-- section:");
		expect(filtered).not.toContain("<!-- /section:");
	});

	// Regression: hasBalancedMarkers used to require only "1 open / 1 close per discovered name",
	// so a brand-new name absent from the template (not a real section, not reused) still passed
	// as "balanced" once forged as a 1/1 pair — the invariant never checked the name itself against
	// the template's known set. Only the FIRST occurrence of each placeholder is replaced below:
	// both {DESCRIPTION} and {COMMIT_HISTORY} appear twice in the template (body + Field Reference
	// table), and replaceAll would forge two "zz" pairs — net balanced by luck — hiding the defect.
	// Pre-fix, this forged pair spans from the Description placeholder through the real Commit
	// History body, so filtering (for `correctness`, whose allowlist is empty) strips that whole
	// misidentified span — including the real "## Diff Command" section — even though every
	// genuine marker in the file remains individually 1/1. Confirmed by reverting the
	// KNOWN_SECTION_NAMES exact-match check and re-running: filtered !== forged and
	// "## Diff Command" is gone — see report.
	it("템플릿에 없는 새 이름으로 위조한 균형 쌍은 필터링을 건너뛰고 원문을 그대로 반환한다", () => {
		const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
		const forged = raw
			.replace("{DESCRIPTION}", "<!-- section:zz -->")
			.replace("{COMMIT_HISTORY}", "<!-- /section:zz -->");

		const filtered = filterPromptSections(forged, "correctness");

		expect(filtered).toBe(forged);
		expect(filtered).toContain("## Diff Command");
	});

	// Constant-vs-template drift guard: KNOWN_SECTION_NAMES is hand-declared in worker.ts, so if
	// chunk-reviewer-prompt.md ever gains or loses a conditional section without the constant
	// being updated, the exact-match invariant above silently starts failing open on every real
	// prompt.txt. Reading the template's actual marker names here means that drift fails this
	// test instead of surviving unnoticed.
	it("KNOWN_SECTION_NAMES는 chunk-reviewer-prompt.md의 실제 섹션 마커 이름 집합과 정확히 일치한다", () => {
		const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
		const namesInTemplate = new Set(
			[...raw.matchAll(/^<!-- section:([a-z_]+) -->$/gm)].map((m) => m[1]),
		);

		expect(namesInTemplate.size).toBeGreaterThan(0);
		expect(namesInTemplate).toEqual(KNOWN_SECTION_NAMES);
	});
});

// filterPromptSections being correct and its result actually reaching the finder are two
// different claims — the suite above only tests the former by calling the function directly.
// This drives worker.ts's real main() as a subprocess (job-dir/member/command CLI contract,
// same shape lib/generic-job.ts's spawnWorkers uses) and inspects assembled-prompt.txt, the
// file assemblePrompt (lib/worker-utils.ts) writes with whatever `reviewContent` it was passed
// — a real production side effect of the runOneTurn → runOnce → assemblePrompt call chain, not
// a mock. `--command true` is enough: assembled-prompt.txt is written before the command is
// ever spawned, so what the command does is irrelevant to what this test checks.
describe("main() 배선: prompt.txt가 필터링되어 reviewContent로 전달된다", () => {
	let tmpRoot: string;

	function makeJobDir(): string {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-worker-wiring-test-"));
		const jobDir = path.join(tmpRoot, "jobs", "chunk-review-wiring-test");
		fs.mkdirSync(path.join(jobDir, "members", "correctness"), { recursive: true });
		return jobDir;
	}

	afterEach(() => {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	// 명시적 타임아웃이 필요한 이유: 워커의 정상 종료 경로가 lib/worker-utils.ts의
	// reapOwnProcessGroup을 타고, 거기서 SIGTERM 후 고정 5초 유예를 기다린 뒤에야
	// 프로세스가 끝난다. execFileSync는 그 5초를 그대로 기다리므로 bun의 기본
	// 5000ms 안에 절대 끝나지 않는다. 유예 5초 + 프로세스 기동/파일 IO 여유분.
	it(
		"correctness 앵글로 실행하면 assembled-prompt.txt에 공통 섹션은 남고 조건부 섹션은 전부 제거된다",
		() => {
			const jobDir = makeJobDir();
			fs.writeFileSync(path.join(jobDir, "prompt.txt"), buildFixturePrompt(), "utf8");

			execFileSync(
				process.execPath,
				[WORKER_PATH, "--job-dir", jobDir, "--member", "correctness", "--command", "true"],
				// HOME isolates the machine-wide worker slot pool under
				// $HOME/.omt/worker-slots/v2, while OMT_DIR isolates worker state; both
				// are pinned to this test's own tmp root.
				{ stdio: "pipe", env: { ...process.env, HOME: tmpRoot, OMT_DIR: tmpRoot } },
			);

			const assembled = fs.readFileSync(
				path.join(jobDir, "members", "correctness", "assembled-prompt.txt"),
				"utf8",
			);

			// prompt.txt was actually read: a common section (no marker, always passes through) is present.
			expect(assembled).toContain("FILE_LIST_SENTINEL");
			// correctness blocks every conditional section — none of them may reach the finder.
			for (const sentinel of ALL_CONDITIONAL_SENTINELS) {
				expect(assembled).not.toContain(sentinel);
			}
		},
		20000,
	);
});

// worker.ts's resume mode (--session + --prompt) is what cmdResumeMember's detached-worker
// dispatch (lib/generic-job.ts) spawns instead of awaiting resumeOneTurn in-process. Drives the
// real main() as a subprocess against a fake `opencode` binary on PATH — a real driver
// (opencodeDriver) parses its stdout, so this proves resumeOneTurn (not runOneTurn) actually ran:
// promptsDir is never forwarded to it, so assembled-prompt.txt must not appear, and the fake CLI
// receives the resume-shaped `--session <id>` argv only driver.resumeCommand injects.
describe("main() 배선: --session/--prompt는 resumeOneTurn 경로(assembled-prompt.txt 미생성)를 태운다", () => {
	let tmpRoot: string;
	let stubDir: string;

	function makeJobDir(): string {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-worker-resume-test-"));
		const jobDir = path.join(tmpRoot, "jobs", "chunk-review-resume-test");
		fs.mkdirSync(path.join(jobDir, "members", "opencode"), { recursive: true });
		return jobDir;
	}

	function makeOpencodeStub(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-resume-stub-"));
		const stubPath = path.join(dir, "opencode");
		fs.writeFileSync(
			stubPath,
			[
				"#!/bin/sh",
				`echo "$@" > ${JSON.stringify(path.join(dir, "argv.txt"))}`,
				'echo \'{"type":"step_finish","sessionID":"sess-123","part":{"reason":"stop"}}\'',
				'echo \'{"type":"text","part":{"text":"resumed"}}\'',
				"exit 0",
			].join("\n"),
			"utf8",
		);
		fs.chmodSync(stubPath, 0o755);
		return dir;
	}

	afterEach(() => {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
		fs.rmSync(stubDir, { recursive: true, force: true });
	});

	// See the wiring test above for why an explicit timeout is required: reapOwnProcessGroup's
	// fixed 5s SIGTERM grace runs before the worker process itself exits.
	it(
		"--session/--prompt가 있으면 assembled-prompt.txt를 만들지 않고 driver.resumeCommand의 --session 인자로 실제 CLI를 호출한다",
		() => {
			const jobDir = makeJobDir();
			stubDir = makeOpencodeStub();

			execFileSync(
				process.execPath,
				[
					WORKER_PATH,
					"--job-dir",
					jobDir,
					"--member",
					"opencode",
					"--command",
					"opencode --format json",
					"--session",
					"sess-existing",
					"--prompt",
					"continue please",
				],
				// HOME isolates the machine-wide worker slot pool and OMT_DIR isolates
				// worker state; both are pinned to this test's own tmp root.
				{
					stdio: "pipe",
					env: {
						...process.env,
						PATH: `${stubDir}:${process.env.PATH}`,
						HOME: tmpRoot,
						OMT_DIR: tmpRoot,
					},
				},
			);

			const memberDir = path.join(jobDir, "members", "opencode");
			expect(fs.existsSync(path.join(memberDir, "assembled-prompt.txt"))).toBe(false);

			const argv = fs.readFileSync(path.join(stubDir, "argv.txt"), "utf8");
			expect(argv).toContain("--session sess-existing");

			const status = JSON.parse(fs.readFileSync(path.join(memberDir, "status.json"), "utf8"));
			expect(status.state).toBe("done");
			expect(status.sessionID).toBe("sess-123");
		},
		20000,
	);
});

// worker.ts 종료 경로에 lib/worker-utils.ts의 reapOwnProcessGroup이 실제로 연결돼
// 있는지를 검증하는 헤르메틱 통합 테스트. 실제 worker.ts를 detached 자식으로 띄우고,
// 그 워커가 실행하는 커맨드(셸 스크립트)가 백그라운드 자손(sleep)을 남긴 채 자신은
// 먼저 종료하는 시나리오에서, 워커의 프로세스 그룹 전체가 결국 0개로 회수되는지를
// ps로 직접 관찰한다.
//
// job.ts의 cmdStart/spawnWorkers를 거치지 않고 worker.ts를 직접 spawn한다 — 이 파일이
// job.test.ts와 같은 bun test 프로세스에서 함께 실행될 때, 다른 describe 블록의
// `mock.module("@lib/generic-job", ...)`(spawnWorkers 오버라이드)가 파일 경계를 넘어
// 살아있는 경우에도 영향받지 않게 하기 위함이다.
//
// 한계: 이 테스트는 워커가 자신의 정상 종료 경로(.then 콜백)를 실제로 타는 경우만
// 검증한다. 워커 자신이 SIGKILL·패닉·OOM으로 죽어 이 경로에 도달하지 못하는 경우는
// 이 계층(계층 1: 워커 자가회수)이 잡지 못한다 — 그건 별도의 고아 회수기(계층 3:
// SessionStart 고아 회수기)의 몫이다.



function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "worker-reap-test-"));
}

/** 지정한 pgid에 속한 (pid, comm) 목록을 ps로 직접 조회한다 (macOS BSD ps 호환). */
function processesInGroup(pgid: number): { pid: number; comm: string }[] {
	const output = execSync("ps -o pgid=,pid=,comm= -A", { encoding: "utf8" });
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [pgidStr, pidStr, ...rest] = line.split(/\s+/);
			return { pgid: Number(pgidStr), pid: Number(pidStr), comm: rest.join(" ") };
		})
		.filter((entry) => entry.pgid === pgid)
		.map(({ pid, comm }) => ({ pid, comm }));
}

describe("worker.ts 종료 경로 — reapOwnProcessGroup 연결", () => {
	test(
		"워커가 실행한 커맨드가 자기보다 오래 사는 백그라운드 자손을 남겨도, 워커 종료 후 해당 프로세스 그룹은 결국 0개로 회수된다",
		async () => {
			const tmpDir = makeTmpDir();
			try {
				const markerPath = path.join(tmpDir, "sleep-spawned.marker");
				const scriptPath = path.join(tmpDir, "leak-child.sh");
				fs.writeFileSync(
					scriptPath,
					[
						"#!/bin/sh",
						// stdio를 /dev/null로 명시적으로 돌려 워커 파이프를 붙잡지 않게 한다 —
						// 그러지 않으면 이 백그라운드 자손이 상속받은 파이프 쓰기단을 계속
						// 쥐고 있어 부모 스크립트가 exit해도 Node의 child 'close' 이벤트가
						// (sleep 30초 동안) 지연된다.
						"sleep 30 </dev/null >/dev/null 2>&1 &",
						`echo $! > ${JSON.stringify(markerPath)}`,
						// 마커를 남긴 뒤 고정된 3초를 대기한다 — 테스트가 "자손이 실제로
						// 살아 있었음"을 관찰할 확정적인 창(타이밍 레이스가 아님)을 준다.
						"sleep 3",
						"exit 0",
					].join("\n"),
					"utf8",
				);
				fs.chmodSync(scriptPath, 0o755);

				const jobDir = path.join(tmpDir, "job");
				const memberDir = path.join(jobDir, "members", "leaker");
				fs.mkdirSync(memberDir, { recursive: true });

				const worker = spawn(
					process.execPath,
					[
						WORKER_PATH,
						"--job-dir",
						jobDir,
						"--member",
						"leaker",
						"--command",
						scriptPath,
						"--timeout",
						"60",
					],
					// HOME isolates the machine-wide worker slot pool and OMT_DIR isolates
					// worker state; both are pinned to this test's own tmp root.
					{
						detached: true,
						stdio: "ignore",
						env: { ...process.env, HOME: tmpDir, OMT_DIR: tmpDir },
					},
				);
				const workerPgid = worker.pid;
				worker.unref();
				expect(typeof workerPgid).toBe("number");
				if (workerPgid === undefined) throw new Error("spawn failed to produce a pid");

				try {
					// 자손이 실제로 살아 있었음을 먼저 확인 — 마커가 나타날 때까지 폴링한다.
					// 이게 없으면 "애초에 아무것도 안 떴는데 0개라서 통과"하는 공허한
					// 초록이 된다. 이 단계는 필수다.
					// 상한은 '언제 실패를 선언할지'만 정한다 — 마커가 끝내 안 나타나면
					// 그대로 실패한다. 전체 스위트 부하에서 bun 기동이 5.8초까지 늘어난
					// 것이 실측돼, 5초 상한은 결함이 아니라 부하 때문에 터졌다.
					const spawnDeadline = Date.now() + 30_000;
					while (!fs.existsSync(markerPath) && Date.now() < spawnDeadline) {
						await new Promise((resolve) => setTimeout(resolve, 50));
					}
					expect(fs.existsSync(markerPath)).toBe(true);

					const aliveBeforeReap = processesInGroup(workerPgid);
					expect(aliveBeforeReap.length).toBeGreaterThanOrEqual(2);
					expect(aliveBeforeReap.some((p) => p.comm.includes("sleep"))).toBe(true);

					// 워커 종료(스크립트의 3초 대기 + close 이벤트) + 자가회수 유예(5초) +
					// 여유분을 기다린 뒤, 그룹이 완전히 회수됐는지 확인한다.
					const reapDeadline = Date.now() + 45_000;
					let remaining = processesInGroup(workerPgid);
					while (remaining.length > 0 && Date.now() < reapDeadline) {
						await new Promise((resolve) => setTimeout(resolve, 300));
						remaining = processesInGroup(workerPgid);
					}

					expect(remaining).toHaveLength(0);
				} finally {
					// 회수 실패(RED 재현 등) 대비 — 남은 프로세스 그룹을 정리한다.
					try {
						process.kill(-workerPgid, "SIGKILL");
					} catch {
						/* 이미 회수됨 — 정리할 것 없음 */
					}
				}
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		},
		120_000,
	);
});
