#!/usr/bin/env bun

/**
 * Codex 축 실효성 실측 테스트 — 실제 codex 프로세스를 spawn하는 통합 테스트.
 *
 * settings.deny.skills 선언이 실제로 codex 프롬프트에서 해당 스킬을 억제하는지, 프로덕션
 * 전송 경로(buildAugmentedCommand → splitCommand)를 그대로 통과한 실제 argv로 `codex debug
 * prompt-input`을 돌려 baseline(deny 미적용) / deny(적용) 쌍 비교로 검증한다.
 *
 * 측정 창은 `<skills_instructions>...</skills_instructions>` 블록 내부로 좁힌다 — 스킬
 * 나열이 실릴 수 있는 자리는 구조적으로 이 블록뿐이고, 전체 출력 기준으로 세면 CLAUDE.md
 * echo 속 문서 예시가 카운트에 섞여 오탐이 난다. 가드 두 개: (1) 여는/닫는 태그가 정확히
 * 1쌍이 아니면 빈 문자열로 계속 진행하는 대신 즉시 하드 실패, (2) "최소 1개 측정 가능"
 * 대신 "선언 이름의 과반이 측정 가능"을 요구한다 — codex가 상류에서 블록 태그명을 바꾸면
 * baseline이 전부 0이 되어, 좁히지 않았다면 테스트는 초록인데 가드는 사라진 상태가 될 수
 * 있다.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import fs from "fs";
import path from "path";

import { buildAugmentedCommand } from "@lib/generic-job";
import { splitCommand } from "@lib/worker-utils";

const CONFIG_PATH = path.join(import.meta.dir, "..", "orchestrate-review.config.yaml");
const SKILLS_DIR = path.join(import.meta.dir, "..", "..");

/** 같은 선언 집합을 들고 있어야 하는 나머지 job config들 — [경로, 최상위 키]. */
const LOCKSTEP_CONFIGS: Array<[string, string]> = [
	[path.join(SKILLS_DIR, "agent-council", "council.config.yaml"), "council"],
	[path.join(SKILLS_DIR, "design-review", "design-review.config.yaml"), "review"],
	[path.join(SKILLS_DIR, "diagnose", "diagnose.config.yaml"), "review"],
];

const codexPath = Bun.which("codex");

/** AC7: codex 부재는 skip이 아니라 명시적 실패다. */
function requireCodex(): void {
	if (!codexPath) {
		throw new Error(
			"codex binary not found on PATH — this test measures REAL codex-side suppression via " +
				"`codex debug prompt-input`; skipping would silently hide a broken enforcement chain, " +
				"so absence must fail, not skip.",
		);
	}
}

/** settings.deny.skills를 YAML 파일에서 직접 읽는다 — 값을 테스트에 하드코딩하지 않는다. */
function readDeclaredDenySkills(configPath: string, topLevelKey: string): string[] {
	const parsed = Bun.YAML.parse(fs.readFileSync(configPath, "utf8")) as Record<string, any>;
	const skills = parsed?.[topLevelKey]?.settings?.deny?.skills;
	if (!Array.isArray(skills) || skills.length === 0) {
		throw new Error(`${configPath}: '${topLevelKey}.settings.deny.skills' must be a non-empty array`);
	}
	return skills.map((name: unknown) => String(name));
}

/**
 * 프로덕션 전송 경로를 그대로 재현한다: buildAugmentedCommand(번역) → splitCommand(재토큰화).
 * "codex exec"의 앞 두 토큰은 버리고 나머지만 반환한다 — 프로브가 "exec" 대신
 * "debug prompt-input"을 쓰기 때문이다.
 */
function buildExtraArgs(denySkills: string[]): string[] {
	const augmented = buildAugmentedCommand({ command: "codex exec", deny: denySkills }, "codex");
	const tokens = splitCommand(augmented.command);
	if (!tokens) throw new Error(`splitCommand failed to tokenize: ${augmented.command}`);
	return tokens.slice(2);
}

async function probePromptInput(extraArgs: string[]): Promise<string> {
	const proc = Bun.spawn(["codex", "debug", "prompt-input", ...extraArgs, "hi"], {
		stdin: "ignore", // AC8: 안 닫으면 "Reading additional input from stdin..."에서 멈춘다
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(
			`codex debug prompt-input exited ${exitCode} (extraArgs=${JSON.stringify(extraArgs)}): ${stderr.slice(0, 1000)}`,
		);
	}
	return stdout;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SKILLS_BLOCK_OPEN = "<skills_instructions>";
const SKILLS_BLOCK_CLOSE = "</skills_instructions>";

/**
 * 측정 창을 `<skills_instructions>...</skills_instructions>` 블록 내부로 좁힌다.
 *
 * 태그가 정확히 1쌍이 아니면(0개 = 못 찾음, 2개 이상 = 모호) 빈 문자열로 조용히 계속
 * 진행하는 대신 즉시 하드 실패한다 — codex가 이 블록 태그 이름을 바꿨을 수 있으니, 이
 * 실패를 만난 사람은 이 파일의 추출 로직(SKILLS_BLOCK_OPEN/CLOSE)을 갱신해야 한다.
 */
function extractSkillsInstructionsBlock(promptJson: string): string {
	const openCount = promptJson.split(SKILLS_BLOCK_OPEN).length - 1;
	const closeCount = promptJson.split(SKILLS_BLOCK_CLOSE).length - 1;
	if (openCount !== 1 || closeCount !== 1) {
		throw new Error(
			`expected exactly one ${SKILLS_BLOCK_OPEN}...${SKILLS_BLOCK_CLOSE} block, found ` +
				`${openCount} open tag(s) and ${closeCount} close tag(s) — codex may have renamed ` +
				"this block; update SKILLS_BLOCK_OPEN/SKILLS_BLOCK_CLOSE in this file to match.",
		);
	}
	const start = promptJson.indexOf(SKILLS_BLOCK_OPEN) + SKILLS_BLOCK_OPEN.length;
	const end = promptJson.indexOf(SKILLS_BLOCK_CLOSE);
	return promptJson.slice(start, end);
}

/** 측정 단위: 원시 이름 문자열이 아니라, 블록 내부 `/<name>/SKILL.md` 등장 횟수. */
function countSkillListings(skillsBlock: string, skillName: string): number {
	const pattern = new RegExp(`/${escapeRegExp(skillName)}/SKILL\\.md`, "g");
	return (skillsBlock.match(pattern) || []).length;
}

describe("codex 축 실효성 — settings.deny.skills가 실제 프롬프트에서 스킬을 억제하는가", () => {
	let declaredNames: string[];
	let baselineBlock: string;
	let denyAllBlock: string;
	let controlBlock: string;

	beforeAll(async () => {
		requireCodex();

		declaredNames = readDeclaredDenySkills(CONFIG_PATH, "chunk-review");

		// baseline 1회 + declaredNames 전체를 한 번에 deny 적용 1회 + 대조군 1회 — 프로덕션에서도
		// settings.deny.skills는 job 하나당 한 번에 전체가 적용되므로, 이 구성이 실제 사용 방식과
		// 동일한 전송 단위다.
		//
		// 세 spawn은 서로 독립이다 — `codex debug prompt-input`은 순수 렌더 커맨드로, 인자로
		// 받은 -c 오버라이드와 프롬프트만으로 JSON을 stdout에 쓸 뿐 어떤 파일에도 쓰지 않는다
		// (실측: 동시 2회 호출 후에도 `~/.codex/history.jsonl`/`state_*.sqlite` mtime 불변, 두
		// 출력 바이트 동일). 그래서 Promise.all로 병렬 실행해도 경합이 없다.
		const [baselineOutput, denyAllOutput, controlOutput] = await Promise.all([
			probePromptInput(buildExtraArgs([])),
			probePromptInput(buildExtraArgs(declaredNames)),
			probePromptInput(buildExtraArgs(["__no_such_skill__"])),
		]);
		// 실제 codex 프로세스의 소요 시간은 시스템 부하에 따라 달라지므로 이 hook에는
		// 고정 시간 제한을 두지 않는다.

		// 측정 창을 <skills_instructions> 블록 내부로 좁힌다 — 세 출력 각각 한 번씩만 추출해
		// 아래 모든 테스트가 재사용한다. 추출 실패(태그 0개/2개 이상)는 여기서 즉시 하드 실패한다.
		baselineBlock = extractSkillsInstructionsBlock(baselineOutput);
		denyAllBlock = extractSkillsInstructionsBlock(denyAllOutput);
		controlBlock = extractSkillsInstructionsBlock(controlOutput);
	}, { timeout: 0 });

	test("job config 4종은 동일한 선언 집합을 갖는다 (각자 파일에서 읽음)", () => {
		for (const [configPath, topLevelKey] of LOCKSTEP_CONFIGS) {
			const names = readDeclaredDenySkills(configPath, topLevelKey);
			expect([...names].sort(), `lockstep 이탈: ${configPath}`).toEqual([...declaredNames].sort());
		}
	});

	// deny.skills와 달리 subagents 축은 프롬프트 크기가 아니라 능력을 끄는 선언이라
	// 여기서는 "4개 config 전부가 켜 두었는가"만 본다 — 실효성은 아래 codex 프롬프트
	// 측정이 아니라 lib/generic-job.test.ts의 번역 테스트가 담당한다.
	test("job config 4종 모두 settings.deny.subagents를 켜 두었다", () => {
		const all: Array<[string, string]> = [[CONFIG_PATH, "chunk-review"], ...LOCKSTEP_CONFIGS];
		for (const [configPath, topLevelKey] of all) {
			const parsed = Bun.YAML.parse(fs.readFileSync(configPath, "utf8")) as Record<string, any>;
			expect(parsed?.[topLevelKey]?.settings?.deny?.subagents, `subagents 미선언: ${configPath}`).toBe(
				true,
			);
		}
	});

	test("선언 이름의 과반은 baseline > 0이다(블록 내부) — 과반에 못 미치면 블록 추출이 깨졌다는 신호다", () => {
		const measurable = declaredNames.filter((name) => countSkillListings(baselineBlock, name) > 0);
		expect(
			measurable.length,
			`측정 가능 ${measurable.length}/${declaredNames.length}개(선언: ${declaredNames.join(", ")}) — ` +
				"과반에 못 미치면 단순 배포 스코프 차이가 아니라 <skills_instructions> 블록 추출 자체가 " +
				"깨졌을 가능성을 의심하라.",
		).toBeGreaterThan(declaredNames.length / 2);
	});

	test("baseline > 0인 선언 이름은 deny 적용 시 반드시 0이다 (블록 내부, baseline === 0인 이름은 측정 불가로 보고하고 단언에서 제외한다)", () => {
		for (const name of declaredNames) {
			const baselineCount = countSkillListings(baselineBlock, name);
			if (baselineCount === 0) {
				// AC5: 측정 불가는 테스트 실패가 아니라 정보 출력이다. 이 이름의 통과는
				// 억제의 증거로 쓰이지 않는다 — 배포 스코프가 바뀌어도 조용히 통과하지 않도록
				// 사유를 남긴다.
				console.warn(
					`[측정 불가] "${name}": baseline count 0 (블록 내부) — codex 배포 스코프에 이 스킬 ` +
						"파일이 없어 억제 여부를 판정할 수 없다.",
				);
				continue;
			}
			const denyCount = countSkillListings(denyAllBlock, name);
			expect(denyCount).toBe(0);
		}
	});

	test("대조군: 존재하지 않는 스킬명으로 억제를 시도하면 baseline과 동일하게 유지된다 (블록 내부, 억제가 일어나지 않음)", () => {
		for (const name of declaredNames) {
			const baselineCount = countSkillListings(baselineBlock, name);
			const controlCount = countSkillListings(controlBlock, name);
			expect(controlCount).toBe(baselineCount);
		}
	});

	test("과차단 대조군: 선언되지 않은 스킬의 카운트는 deny 적용 후에도 그대로다(블록 내부)", () => {
		const declared = new Set(declaredNames);
		const surviving = new Set(
			[...baselineBlock.matchAll(/\/([a-zA-Z0-9_-]+)\/SKILL\.md/g)]
				.map((m) => m[1])
				.filter((n) => !declared.has(n)),
		);
		// 이 대조군 자체가 공허하지 않음을 먼저 보장한다 —
		// surviving이 비면 아래 루프가 0회 돌며 조용히 통과해버린다.
		expect(surviving.size).toBeGreaterThan(0);
		for (const name of surviving) {
			expect(countSkillListings(denyAllBlock, name)).toBe(countSkillListings(baselineBlock, name));
		}
	});
});

/**
 * 오타 검출 — 순수 파일시스템 검사, codex 불필요.
 *
 * 위 실효성 테스트는 baseline === 0인 이름을 "측정 불가"로 면제한다. 그래서
 * orchestrate-reviewX 같은 오타를 두 config에 똑같이 넣으면(codex 배포 스코프에
 * 당연히 없으므로 baseline 0) 실효성 단언은 통과하고, "두 config가 같은 집합"
 * 단언만 깨진다 — 두 config에 같은 오타가 들어가면 아무것도 안 잡힌다. 이 테스트는
 * 그 틈을 "baseline 0"과 "이름 자체가 존재하지 않음"을 분리해 메운다.
 */
const REPO_ROOT = path.join(import.meta.dir, "..", "..", "..");

function skillMdPath(name: string): string {
	return path.join(REPO_ROOT, "skills", name, "SKILL.md");
}

/**
 * Case-exact existence check. This repo lives on a case-insensitive filesystem
 * (macOS default), so `fs.existsSync(skillMdPath("ORCHESTRATE-REVIEW"))` returns
 * true even though the real directory on disk is spelled "orchestrate-review" —
 * codex itself is case-sensitive, so a miscased deny name silently fails to
 * suppress anything while this guard waves it through. readdirSync returns the
 * actual on-disk spelling, so comparing against it (not just existsSync) catches
 * a miscased name that existsSync alone would miss.
 */
function skillDirExists(name: string): boolean {
	return fs.readdirSync(path.join(REPO_ROOT, "skills")).includes(name) && fs.existsSync(skillMdPath(name));
}

describe("오타 검출 — 선언된 이름이 실재하는 스킬인가", () => {
	test("job config 4종에 선언된 모든 deny.skills 이름은 skills/<name>/SKILL.md로 실재한다", () => {
		const sources: Array<{ configPath: string; topLevelKey: string }> = [
			{ configPath: CONFIG_PATH, topLevelKey: "chunk-review" },
			...LOCKSTEP_CONFIGS.map(([configPath, topLevelKey]) => ({ configPath, topLevelKey })),
		];

		const missing: string[] = [];
		for (const { configPath, topLevelKey } of sources) {
			const names = readDeclaredDenySkills(configPath, topLevelKey);
			for (const name of names) {
				if (!skillDirExists(name)) {
					missing.push(
						`"${name}" (declared in ${configPath} at '${topLevelKey}.settings.deny.skills') ` +
							`— ${skillMdPath(name)} not found. Possible typo?`,
					);
				}
			}
		}

		expect(missing, missing.join("\n")).toEqual([]);
	});
});
