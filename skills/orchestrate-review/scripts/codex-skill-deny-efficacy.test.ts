#!/usr/bin/env bun

/**
 * Codex 축 실효성 실측 테스트.
 *
 * settings.deny.skills 선언이 실제로 codex 프롬프트에서 해당 스킬을 억제하는지를,
 * 프로덕션 전송 경로(buildAugmentedCommand → splitCommand — spawnWorkers가 워커에
 * --command로 넘긴 문자열을 워커가 재토큰화하는 것과 동일한 경로)를 통과한 실제 argv로
 * `codex debug prompt-input`을 돌려 baseline(deny 미적용) / deny(적용) 쌍 비교로 검증한다.
 *
 * 측정 단위: 스킬은 프롬프트에 `- <name>: <설명> (file: <경로>/<name>/SKILL.md)` 형태로
 * 열거된다. 원시 이름 문자열을 세면 무관한 본문의 우연한 일치가 섞여 들어간다 — 실측상
 * "code-review"라는 문자열은 이 레포의 CLAUDE.md 본문에만도 12건 등장하고, 그 원시 카운트로는
 * deny 적용 후에도 그대로 12건이라 오탐(빨간불)이 뜨지만 실제로는 억제가 정상 동작한 것이다.
 * 그래서 반드시 `/<name>/SKILL.md`의 등장 횟수만 센다.
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

/** 측정 단위: 원시 이름 문자열이 아니라 `/<name>/SKILL.md` 등장 횟수. */
function countSkillListings(promptJson: string, skillName: string): number {
	const pattern = new RegExp(`/${escapeRegExp(skillName)}/SKILL\\.md`, "g");
	return (promptJson.match(pattern) || []).length;
}

describe("codex 축 실효성 — settings.deny.skills가 실제 프롬프트에서 스킬을 억제하는가", () => {
	let declaredNames: string[];
	let baselineOutput: string;
	let denyAllOutput: string;
	let controlOutput: string;

	beforeAll(async () => {
		requireCodex();

		declaredNames = readDeclaredDenySkills(CONFIG_PATH, "chunk-review");

		// baseline 1회 + declaredNames 전체를 한 번에 deny 적용 1회 + 대조군 1회 — 프로덕션에서도
		// settings.deny.skills는 job 하나당 한 번에 전체가 적용되므로, 이 구성이 실제 사용 방식과
		// 동일한 전송 단위다.
		baselineOutput = await probePromptInput(buildExtraArgs([]));
		denyAllOutput = await probePromptInput(buildExtraArgs(declaredNames));
		controlOutput = await probePromptInput(buildExtraArgs(["__no_such_skill__"]));
		// 3회 실 codex 프로세스 spawn(각 ~2-3초) 합산이 bun:test 기본 hook 타임아웃(5s)을
		// 넘는다 — BEFORE_ALL_TIMEOUT_MS로 넉넉히 확장.
	}, BEFORE_ALL_TIMEOUT_MS);

	test("council.config.yaml은 orchestrate-review.config.yaml과 동일한 선언 집합을 갖는다 (각자 파일에서 읽음)", () => {
		const councilNames = readDeclaredDenySkills(COUNCIL_CONFIG_PATH, "council");
		expect([...councilNames].sort()).toEqual([...declaredNames].sort());
	});

	test("최소 1개 선언 이름은 baseline > 0이다 — 전부 측정 불가면 이 테스트는 아무것도 증명하지 못한다", () => {
		const measurable = declaredNames.filter((name) => countSkillListings(baselineOutput, name) > 0);
		expect(measurable.length).toBeGreaterThan(0);
	});

	test("baseline > 0인 선언 이름은 deny 적용 시 반드시 0이다 (baseline === 0인 이름은 측정 불가로 보고하고 단언에서 제외한다)", () => {
		for (const name of declaredNames) {
			const baselineCount = countSkillListings(baselineOutput, name);
			if (baselineCount === 0) {
				// AC5: 측정 불가는 테스트 실패가 아니라 정보 출력이다. 이 이름의 통과는
				// 억제의 증거로 쓰이지 않는다 — 배포 스코프가 바뀌어도 조용히 통과하지 않도록
				// 사유를 남긴다.
				console.warn(
					`[측정 불가] "${name}": baseline count 0 — codex 배포 스코프에 이 스킬 파일이 없어 ` +
						"억제 여부를 판정할 수 없다.",
				);
				continue;
			}
			const denyCount = countSkillListings(denyAllOutput, name);
			expect(denyCount).toBe(0);
		}
	});

	test("대조군: 존재하지 않는 스킬명으로 억제를 시도하면 baseline과 동일하게 유지된다 (억제가 일어나지 않음)", () => {
		for (const name of declaredNames) {
			const baselineCount = countSkillListings(baselineOutput, name);
			const controlCount = countSkillListings(controlOutput, name);
			expect(controlCount).toBe(baselineCount);
		}
	});

	test("과차단 대조군: 선언되지 않은 스킬의 카운트는 deny 적용 후에도 그대로다", () => {
		const declared = new Set(declaredNames);
		const surviving = new Set(
			[...baselineOutput.matchAll(/\/([a-zA-Z0-9_-]+)\/SKILL\.md/g)]
				.map((m) => m[1])
				.filter((n) => !declared.has(n)),
		);
		// 이 대조군 자체가 공허하지 않음을 먼저 보장한다 —
		// surviving이 비면 아래 루프가 0회 돌며 조용히 통과해버린다.
		expect(surviving.size).toBeGreaterThan(0);
		for (const name of surviving) {
			expect(countSkillListings(denyAllOutput, name)).toBe(countSkillListings(baselineOutput, name));
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
