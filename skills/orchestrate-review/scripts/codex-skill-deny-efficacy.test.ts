#!/usr/bin/env bun

/**
 * Codex 축 실효성 실측 테스트.
 *
 * settings.deny.skills 선언이 실제로 codex 프롬프트에서 해당 스킬을 억제하는지를,
 * 프로덕션 전송 경로(buildAugmentedCommand → splitCommand — spawnWorkers가 워커에
 * --command로 넘긴 문자열을 워커가 재토큰화하는 것과 동일한 경로)를 통과한 실제 argv로
 * `codex debug prompt-input`을 돌려 baseline(deny 미적용) / deny(적용) 쌍 비교로 검증한다.
 *
 * 측정 창: 스킬은 프롬프트의 `<skills_instructions>...</skills_instructions>` 블록 안에서만
 * `- <name>: <설명> (file: <root-alias>/<name>/SKILL.md)` 형태로 열거된다. codex의 developer
 * 메시지는 <skills_instructions> → <permissions instructions> → <recommended_plugins> →
 * <INSTRUCTIONS>(AGENTS.md/CLAUDE.md echo) → <environment_context> 순 content 블록으로
 * 구성되고, 스킬 나열이 실릴 수 있는 자리는 구조적으로 <skills_instructions> 블록 하나뿐이다 —
 * <INSTRUCTIONS>는 스킬 로딩 메커니즘이 아니라 순수 문서 텍스트 echo다.
 *
 * 창을 블록으로 좁힌 이유(실측 근거): deny 목록을 4개→28개로 늘렸을 때 "prometheus" 하나에서
 * 단언이 깨졌다. 원인은 억제 실패가 아니라 측정 오탐이었다 — 이 레포의 AGENTS.md는 CLAUDE.md로의
 * 심링크이고 codex가 이를 project instructions로 실어 <INSTRUCTIONS> 블록으로 echo하는데,
 * CLAUDE.md:200에 `Read("skills/prometheus/SKILL.md")  // Wrong`이라는 문서 예시가 있다. 이
 * 예시 1건이 전체 출력 기준 카운트에 항상 섞여, deny가 <skills_instructions> 블록의 나열 항목을
 * 실제로는 지웠는데도 전체 카운트는 2→1로만 줄어 0을 기대하는 단언이 깨졌다(실측: 전체 baseline
 * 2 / 블록 1, deny 후 전체 1 / 블록 0 — 블록 안 나열 항목은 정상적으로 사라졌다). 억제는
 * 정상이었고 측정 단위가 오탐을 낸 것이다.
 *
 * `(file: ...)` 괄호 형태만 세는 대안은 고르지 않았다: 실측 baseline의 나열은
 * `- imagegen: ... (file: r3/imagegen/SKILL.md)`처럼 root alias 축약(r0~r7)을 쓰는데, 이는
 * 위 문단이 기술한 형식과도 달라진다 — 포맷을 더 고정하는 정규식은 렌더링 변형에 더 취약하고,
 * 블록 스코핑 + `/<name>/SKILL.md` suffix 매칭은 root alias/prefix가 무엇이든 살아남는다.
 *
 * 새 실패 모드와 가드: 창을 블록으로 좁히면 codex가 상류에서 블록 태그 이름을 바꿨을 때 추출이
 * 아무것도 못 찾고 baseline이 전부 0이 되어, 핵심 deny 단언이 전부 "측정 불가"로 스킵되며
 * 테스트는 초록인데 가드는 사라진 상태가 될 수 있다. 이를 막기 위해 (1) 블록 추출은
 * `<skills_instructions>` 여는/닫는 태그가 정확히 1쌍이 아니면 즉시 하드 실패하고(빈 문자열로
 * 계속 진행하는 fallback 금지), (2) "최소 1개 측정 가능" 단언을 "선언 이름의 과반이 측정
 * 가능"으로 강화했다 — 우연히 1개만 살아남아도 통과하던 약한 하한을 없앴다.
 *
 * job.test.ts와 별도 파일로 둔 이유: job.test.ts는 tmp 설정 + mock 기반의 빠른 단위 테스트만
 * 담는 반면, 이 테스트는 실제 codex 프로세스를 3회 spawn하는(초 단위) 외부-바이너리 의존
 * 통합 테스트라 성격이 다르다. orchestrate-review.config.yaml의 실제 선언값을 읽는 것이 이
 * 테스트의 핵심이라 job.ts와 같은 디렉터리에 colocate한다.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import fs from "fs";
import path from "path";

import { buildAugmentedCommand } from "@lib/generic-job";
import { splitCommand } from "@lib/worker-utils";

const CONFIG_PATH = path.join(import.meta.dir, "..", "orchestrate-review.config.yaml");
const COUNCIL_CONFIG_PATH = path.join(
	import.meta.dir,
	"..",
	"..",
	"agent-council",
	"council.config.yaml",
);

const codexPath = Bun.which("codex");

/** 실 codex 프로세스 3회 spawn을 감당할 beforeAll 타임아웃 (bun:test 기본 5s보다 넉넉히). */
const BEFORE_ALL_TIMEOUT_MS = 60_000;

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
		const baselineOutput = await probePromptInput(buildExtraArgs([]));
		const denyAllOutput = await probePromptInput(buildExtraArgs(declaredNames));
		const controlOutput = await probePromptInput(buildExtraArgs(["__no_such_skill__"]));
		// 3회 실 codex 프로세스 spawn(각 ~2-3초) 합산이 bun:test 기본 hook 타임아웃(5s)을
		// 넘는다 — BEFORE_ALL_TIMEOUT_MS로 넉넉히 확장.

		// 측정 창을 <skills_instructions> 블록 내부로 좁힌다 — 세 출력 각각 한 번씩만 추출해
		// 아래 모든 테스트가 재사용한다. 추출 실패(태그 0개/2개 이상)는 여기서 즉시 하드 실패한다.
		baselineBlock = extractSkillsInstructionsBlock(baselineOutput);
		denyAllBlock = extractSkillsInstructionsBlock(denyAllOutput);
		controlBlock = extractSkillsInstructionsBlock(controlOutput);
	}, BEFORE_ALL_TIMEOUT_MS);

	test("council.config.yaml은 orchestrate-review.config.yaml과 동일한 선언 집합을 갖는다 (각자 파일에서 읽음)", () => {
		const councilNames = readDeclaredDenySkills(COUNCIL_CONFIG_PATH, "council");
		expect([...councilNames].sort()).toEqual([...declaredNames].sort());
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
	test("orchestrate-review.config.yaml과 council.config.yaml에 선언된 모든 deny.skills 이름은 skills/<name>/SKILL.md로 실재한다", () => {
		const sources: Array<{ configPath: string; topLevelKey: string }> = [
			{ configPath: CONFIG_PATH, topLevelKey: "chunk-review" },
			{ configPath: COUNCIL_CONFIG_PATH, topLevelKey: "council" },
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
