import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COVERAGE_JOB_WALL_CAP_SEC, isExternalStallCause } from "@lib/generic-job";
import { HELP, VERDICTS, loadPlan, run as runDiffCursor } from "./diff-cursor.ts";
import { submitReviewArtifact } from "./submit-review.ts";

// ---------------------------------------------------------------------------
// SKILL.md가 말하는 값(명령, 플래그, enum, 상한, 경로)이 코드가 실제로 정의한 값과 같은지 확인한다.
// 값은 스크립트/lib에서 읽는다. 문서가 값을 적지 않았다면 통과한다(모순이 없으면 된다).
// ---------------------------------------------------------------------------

const SKILL_DIR = join(import.meta.dir, "..");
const REPO_ROOT = join(SKILL_DIR, "..", "..");
const skillMd = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
const verifierPrompt = readFileSync(join(SKILL_DIR, "references", "verifier-prompt.md"), "utf8");
const genericJobSource = readFileSync(join(REPO_ROOT, "lib", "generic-job.ts"), "utf8");

/** 백슬래시 줄바꿈으로 이어진 셸 명령을 한 줄로 합친다. */
const joinContinuations = (text: string): string => text.replace(/\\\n\s*/g, " ");
/** 대괄호로 감싼 선택 인자를 제거한다. */
const withoutOptional = (text: string): string => text.replace(/\[[^\]]*\]/g, " ");
const flagsOf = (text: string): string[] => [...text.matchAll(/--[a-z][a-z-]*/g)].map((match) => match[0]);

// ---------------------------------------------------------------------------
// DVC-01 job.ts 명령과 플래그
// ---------------------------------------------------------------------------

const jobHelp = spawnSync(process.execPath, [join(import.meta.dir, "job.ts"), "--help"], { encoding: "utf8" }).stdout;
const jobUsage = new Map<string, string[]>();
for (const match of jobHelp.matchAll(/^ {2}job\.ts (\S+)(.*)$/gm)) {
	jobUsage.set(match[1], [...(jobUsage.get(match[1]) ?? []), match[2]]);
}
const aiUsableBlock = jobHelp.match(/^AI-USABLE\n((?: {2}\S.*\n)+)/m)?.[1] ?? "";
const rosterAiCommands = [...aiUsableBlock.matchAll(/^ {2}(\S+) — /gm)].map((match) => match[1]);
// 결정: conductor는 `job.ts clean`을 실행하지 않는다(잡 정리는 GC/orphan reaper 몫).
// job.ts ROSTER는 clean을 아직 "ai"로 표시하므로 여기서 직접 뺀다. ROSTER를 "system"으로 바꾸면 이 줄을 지운다.
const CONDUCTOR_EXCLUDED = ["clean"];
const conductorCommands = rosterAiCommands.filter((name) => !CONDUCTOR_EXCLUDED.includes(name));

describe("DVC-01 job.ts 명령과 플래그가 --help와 일치한다", () => {
	const text = joinContinuations(skillMd);
	const invocations = [...text.matchAll(/job\.ts"?\s+([a-z][a-z-]*)([^`\n]*)/g)].map((match) => ({
		command: match[1],
		args: match[2],
		line: match[0],
	}));

	test("conductor 허용 명령, 호출 플래그, start의 --ledger-root, resume-member 플래그가 --help와 일치하고 clean은 허용되지 않는다", () => {
		expect(rosterAiCommands.length).toBeGreaterThan(0);
		for (const required of ["start", "collect", "status", "results", "resume-member"]) {
			expect(conductorCommands).toContain(required);
		}
		expect(conductorCommands).not.toContain("clean");

		// 문서의 모든 job.ts 호출은 허용된 명령이다.
		for (const call of invocations) {
			expect(conductorCommands, `job.ts ${call.command}`).toContain(call.command);
		}
		// 문장 속 "job lifecycle commands (`a`, `b`, ...)" 허용 목록도 같은 집합이어야 한다.
		for (const list of text.matchAll(/job lifecycle commands \(([^)]*)\)/gi)) {
			for (const token of list[1].matchAll(/`([a-z][a-z-]*)`/g)) {
				expect(conductorCommands, `lifecycle list entry ${token[1]}`).toContain(token[1]);
			}
		}
		// 각 호출은 그 명령이 --help에 적은 플래그만 쓰고, resume-member와 start는 필수 플래그를 모두 갖는다.
		for (const call of invocations) {
			const usageLines = jobUsage.get(call.command) ?? [];
			const allowedFlags = usageLines.flatMap(flagsOf);
			const requiredFlags = flagsOf(withoutOptional(usageLines[0] ?? ""));
			for (const flag of flagsOf(call.args)) {
				expect(allowedFlags, `${call.line} uses ${flag}`).toContain(flag);
			}
			// 인자 목록을 "..."로 줄여 쓴 start 호출은 필수 플래그 전체를 요구하지 않는다.
			if (call.command === "resume-member" || (call.command === "start" && !call.args.includes("..."))) {
				for (const flag of requiredFlags) expect(flagsOf(call.args), call.line).toContain(flag);
			}
		}
		// start는 --ledger-root를 싣고, --retry-stalled는 resume-member에만 붙는다.
		expect(flagsOf(withoutOptional(jobUsage.get("start")?.[0] ?? ""))).toContain("--ledger-root");
		for (const call of invocations.filter((c) => c.command === "start")) {
			expect(flagsOf(call.args), call.line).toContain("--ledger-root");
		}
		for (const call of invocations.filter((c) => flagsOf(c.args).includes("--retry-stalled"))) {
			expect(call.command).toBe("resume-member");
		}
	});
});

// ---------------------------------------------------------------------------
// DVC-02 ~ DVC-04 stall 원인, 백업 경로, wall cap
// ---------------------------------------------------------------------------

describe("DVC-02 stall 원인 이름이 generic-job과 일치한다", () => {
	test("문서가 적은 stall_cause_kind 값은 모두 타입 안의 외부 원인이다", () => {
		const declared = [...(genericJobSource.match(/export type StallCauseKind = ([^;]+);/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
		expect(declared.length).toBeGreaterThan(0);
		for (const sentence of skillMd.matchAll(/`stall_cause_kind` of ((?:`[a-z_]+`(?:,|\s+or)?\s*)+)/g)) {
			for (const token of sentence[1].matchAll(/`([a-z_]+)`/g)) {
				expect(declared, `${token[1]} is not a StallCauseKind`).toContain(token[1]);
				expect(isExternalStallCause(token[1]), `${token[1]} is not an external stall cause`).toBe(true);
			}
		}
	});
});

describe("DVC-03 ledger 백업 경로가 generic-job과 일치한다", () => {
	test("문서의 <jobDir>/ledger-* 조각은 코드의 백업 디렉터리 이름과 같다", () => {
		const backupName = genericJobSource.match(/const ledgerBackupDir = \(jobDir: string\) => path\.join\(jobDir, "([^"]+)"\)/)?.[1];
		expect(backupName).toBeDefined();
		for (const fragment of skillMd.matchAll(/<jobDir>\/(ledger[\w-]*)/g)) {
			expect(fragment[1]).toBe(backupName as string);
		}
	});
});

describe("DVC-04 wall cap 시간이 generic-job과 일치한다", () => {
	test("문서의 N-hour 값은 COVERAGE_JOB_WALL_CAP_SEC / 3600과 같다", () => {
		const hours = COVERAGE_JOB_WALL_CAP_SEC / 3600;
		for (const mention of skillMd.matchAll(/\b(\d+)-hour\b/g)) {
			expect(Number(mention[1])).toBe(hours);
		}
	});
});

// ---------------------------------------------------------------------------
// DVC-05 diff-cursor.ts 호출
// ---------------------------------------------------------------------------

describe("DVC-05 diff-cursor.ts 호출이 HELP와 일치한다", () => {
	// HELP의 명령 줄은 공백 2칸으로 시작한다. 이어지는 설명 줄은 더 깊게 들여쓴다.
	const helpLines = HELP.split("\n");
	const helpCommands = new Map<string, string[]>();
	for (const line of helpLines) {
		const match = line.match(/^ {2}([a-z]+)\b(.*)$/);
		if (match) helpCommands.set(match[1], [...(helpCommands.get(match[1]) ?? []), match[2]]);
	}
	const globalFlags = ["--ledger"];
	const text = joinContinuations(skillMd);
	const calls = [...text.matchAll(/diff-cursor\.ts\s+(?:--ledger\s+\S+\s+)?([a-z]+)([^\n`]*)/g)]
		.map((match) => ({ command: match[1], args: match[2], line: match[0] }))
		// 플래그가 없는 문장 속 언급(`diff-cursor.ts plan`)은 제외한다.
		.filter((call) => /--[a-z]/.test(call.args));

	test("문서가 쓴 하위 명령과 플래그는 HELP에 있고 plan, verify, export 호출은 필수 플래그를 싣는다", () => {
		expect(globalFlags.every((flag) => HELP.includes(flag))).toBe(true);
		for (const call of calls) {
			expect([...helpCommands.keys()], call.line).toContain(call.command);
			const allowed = (helpCommands.get(call.command) ?? []).flatMap(flagsOf);
			for (const flag of flagsOf(call.args)) {
				expect([...allowed, ...globalFlags], `${call.line} uses ${flag}`).toContain(flag);
			}
		}

		const required = (command: string): string[] => flagsOf(withoutOptional((helpCommands.get(command) ?? [])[0] ?? ""));
		for (const command of ["plan", "verify"]) {
			expect(required(command).length).toBeGreaterThan(0);
			for (const call of calls.filter((c) => c.command === command)) {
				for (const flag of required(command)) expect(flagsOf(call.args), call.line).toContain(flag);
			}
		}
		for (const call of calls.filter((c) => c.command === "export")) {
			expect(flagsOf(call.args).some((flag) => flag === "--out" || flag === "--part"), call.line).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// DVC-06 finder 구성
// ---------------------------------------------------------------------------

describe("DVC-06 finder 이름과 개수가 code-review.config.yaml과 일치한다", () => {
	const config = Bun.YAML.parse(readFileSync(join(SKILL_DIR, "code-review.config.yaml"), "utf8")) as {
		"chunk-review": { members: { name: string }[] };
	};
	const members = config["chunk-review"].members.map((member) => member.name);
	const numberWords: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };

	test("문서가 세는 finder 수와 finder 이름 목록이 config의 member와 일치한다", () => {
		expect(members.length).toBeGreaterThan(0);
		for (const mention of skillMd.matchAll(/\b(two|three|four|five|six) (finders?|angles?|ledgers?|members?)\b/gi)) {
			expect(numberWords[mention[1].toLowerCase()], mention[0]).toBe(members.length);
		}

		for (const name of members) expect(skillMd).toMatch(new RegExp(`\\b${name}\\b`));
		for (const list of skillMd.matchAll(/finders run \(([^)]*)\)/g)) {
			const named = [...list[1].matchAll(/[a-z]+/g)].map((token) => token[0]);
			expect(named.sort()).toEqual([...members].sort());
		}
	});
});

// ---------------------------------------------------------------------------
// DVC-07 pathspec 경로의 hardening 플래그
// ---------------------------------------------------------------------------

describe("DVC-07 diff 호출의 hardening 플래그가 diff-cursor plan과 일치한다", () => {
	const HARDENED = ["--literal-pathspecs", "--no-ext-diff", "--no-textconv"];

	test("plan이 얼린 gitArgv와 문서의 pathspec diff 호출이 같은 hardening 플래그를 싣는다", () => {
		const root = mkdtempSync(join(tmpdir(), "doc-vs-code-plan-"));
		try {
			const repo = join(root, "repo");
			mkdirSync(repo);
			const git = (...args: string[]): string =>
				execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
					cwd: repo,
					encoding: "utf8",
					env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
				}).trim();
			git("init", "-q", "-b", "main");
			writeFileSync(join(repo, "a.txt"), "one\n");
			git("add", "a.txt");
			git("commit", "-q", "-m", "one");
			const base = git("rev-parse", "HEAD");
			writeFileSync(join(repo, "a.txt"), "two\n");
			git("commit", "-q", "-am", "two");
			const head = git("rev-parse", "HEAD");
			const planDir = join(root, "plan");
			const result = runDiffCursor(["plan", "--repo", repo, "--range", `${base}...${head}`, "--files", JSON.stringify(["a.txt"]), "--out", planDir]);
			expect(result.code).toBe(0);
			const { gitArgv } = loadPlan(planDir);
			for (const flag of HARDENED) expect(gitArgv).toContain(flag);
			expect(gitArgv.indexOf("--literal-pathspecs")).toBeLessThan(gitArgv.indexOf("diff"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}

		// 문서의 pathspec 포함 diff 호출은 같은 플래그를 모두 싣고 --literal-pathspecs를 diff 앞에 둔다.
		for (const line of skillMd.split("\n")) {
			if (/"--",\s*candidatePath\b|--\s+"\$candidatePath"/.test(line)) {
				for (const flag of HARDENED) expect(line, flag).toContain(flag);
			}
			for (const argv of line.matchAll(/(?:"git",\s*|git\s+)--literal-pathspecs("?,?\s*"?)(\w*)/g)) {
				expect(argv[2], line).toBe("diff");
			}
		}
	});
});

// ---------------------------------------------------------------------------
// DVC-08 스크립트가 가리키는 SKILL.md 단계
// ---------------------------------------------------------------------------

describe("DVC-08 스크립트가 가리키는 SKILL.md 단계 제목이 실제로 있다", () => {
	test("job.ts와 worker.ts가 인용한 'code-review SKILL.md Step N'을 SKILL.md가 제목으로 갖는다", () => {
		let cited = 0;
		for (const file of ["job.ts", "worker.ts"]) {
			const source = readFileSync(join(import.meta.dir, file), "utf8");
			for (const reference of source.matchAll(/code-review[ /]SKILL\.md (Step \d+)/g)) {
				cited += 1;
				expect(skillMd, `${file} cites ${reference[1]}`).toMatch(new RegExp(`^#{1,6} ${reference[1]}\\b`, "m"));
			}
		}
		expect(cited).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// DVC-09 / DVC-10 submit-review 산출물
// ---------------------------------------------------------------------------

describe("DVC-09 아티팩트 enum이 submit-review 검증과 일치한다", () => {
	const root = mkdtempSync(join(tmpdir(), "doc-vs-code-submit-"));
	const destination = join(root, "artifact.json");
	const finding = (overrides: Record<string, unknown>) => ({
		class: "correctness",
		verdict: "CONFIRMED",
		impact: "HIGH",
		priority: "HIGH",
		assessment: { unfixed_cost: "a", exposure: "b", remedy: "c", added_cost: "d", rationale: "e" },
		...overrides,
	});
	const artifact = (status: string, findingOverrides: Record<string, unknown>) =>
		JSON.stringify({ status, reviewer: "r", at: "2026-01-01T00:00:00Z", findings: [finding(findingOverrides)] });
	const accepts = (field: string, value: string): boolean => {
		try {
			submitReviewArtifact(destination, field === "status" ? artifact(value, {}) : artifact("COMPLETE", { [field]: value }));
			return true;
		} catch {
			return false;
		}
	};
	// 문서가 적은 값 외에 거부되어야 할 후보. 문서 값이 코드와 어긋나면 수용 집합이 달라진다.
	const UNIVERSE = ["COMPLETE", "INCONCLUSIVE", "CONFIRMED", "PLAUSIBLE", "REFUTED", "UNKNOWN", "HIGH", "MEDIUM", "LOW", "CRITICAL", "NONE"];

	test("문서가 적은 status, verdict, impact, priority 값 집합은 코드가 수용하는 집합과 같다", () => {
		try {
			for (const spelled of skillMd.matchAll(/"(status|verdict|impact|priority)":"([A-Z|]+)"/g)) {
				const documented = spelled[2].split("|");
				const accepted = [...new Set([...documented, ...UNIVERSE])].filter((value) => accepts(spelled[1], value));
				expect(accepted.sort(), spelled[0]).toEqual([...documented].sort());
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("DVC-10 게시 receipt가 submit-review와 일치한다", () => {
	test("문서가 말한 publisher 경로가 실재하고 receipt 키가 submitReviewArtifact 반환 키와 같다", () => {
		const root = mkdtempSync(join(tmpdir(), "doc-vs-code-receipt-"));
		try {
			for (const mention of skillMd.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/(scripts\/submit-review\.ts)/g)) {
				expect(existsSync(join(SKILL_DIR, mention[1]))).toBe(true);
			}
			const receipt = submitReviewArtifact(
				join(root, "artifact.json"),
				JSON.stringify({ status: "INCONCLUSIVE", reviewer: "r", at: "2026-01-01T00:00:00Z", findings: [] }),
			);
			const actualKeys = Object.keys(receipt).sort();
			const keysOf = (spelled: string): string[] => {
				try {
					return Object.keys(JSON.parse(spelled)).sort();
				} catch {
					return spelled.replace(/[{}"\s]/g, "").split(",").sort();
				}
			};
			for (const spelled of skillMd.matchAll(/`(\{[^`{}]*\bpath\b[^`{}]*\bsha256\b[^`{}]*\})`/g)) {
				expect(keysOf(spelled[1]), spelled[1]).toEqual(actualKeys);
			}
			for (const spelled of skillMd.matchAll(/\{"path":"<path>","sha256":"<hash>"\}/g)) {
				expect(keysOf(spelled[0])).toEqual(actualKeys);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// DVC-11 cleanup 체크리스트 verdict
// ---------------------------------------------------------------------------

describe("DVC-11 cleanup 체크리스트 판정 이름이 diff-cursor VERDICTS와 일치한다", () => {
	test("문서가 `a` / `b` / `c`로 적은 한국어 판정 세 개는 VERDICTS와 같은 집합이다", () => {
		for (const triple of skillMd.matchAll(/`([^`\n]+)` \/ `([^`\n]+)` \/ `([^`\n]+)`/g)) {
			const named = [triple[1], triple[2], triple[3]];
			if (!named.some((name) => (VERDICTS as readonly string[]).includes(name))) continue;
			expect([...named].sort()).toEqual([...VERDICTS].sort());
		}
	});
});

// ---------------------------------------------------------------------------
// DVC-12 verifier 입력 JSON 키 (문서 대 문서)
// ---------------------------------------------------------------------------

describe("DVC-12 SKILL.md가 말하는 verifier 입력 키는 verifier-prompt.md가 정의한다", () => {
	test("`candidate.file`, `execution.argv` 같은 점 표기 키는 verifier-prompt의 untrusted-data JSON 블록에 있다", () => {
		const boundary = verifierPrompt.indexOf("<!-- BEGIN untrusted-data JSON boundary -->");
		const jsonStart = verifierPrompt.indexOf("```json\n", boundary) + "```json\n".length;
		const jsonEnd = verifierPrompt.indexOf("\n```", jsonStart);
		expect(boundary).toBeGreaterThanOrEqual(0);
		const block = verifierPrompt
			.slice(jsonStart, jsonEnd)
			.replace("{RANGE}", '"range"')
			.replaceAll("{CANDIDATE_FILE}", '"file"');
		const parsed = JSON.parse(block) as Record<string, Record<string, unknown>>;
		const definedKeys = Object.entries(parsed).flatMap(([group, fields]) => Object.keys(fields).map((key) => `${group}.${key}`));
		expect(definedKeys).toContain("candidate.file");
		expect(definedKeys).toContain("execution.argv");
		for (const mention of skillMd.matchAll(/`((?:candidate|execution)\.[a-z_]+)`/g)) {
			expect(definedKeys, mention[1]).toContain(mention[1]);
		}
	});
});
