import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { COMMANDS } from "./scripts/fc.ts";

// ---------------------------------------------------------------------------
// Static prose/contract tests for skills/fc-feedback (plan T13).
//
// Covers: frontmatter shape, every `fc.ts <cmd>` invocation named in SKILL.md
// resolving to a real entry in the CLI's own COMMANDS table (ground truth,
// not a copy of it), every §3/§16 contract file name showing up in
// references/contracts.md, the REVIEW GATE / PUBLISH GATE / confirmation
// wording, the ${CLAUDE_SKILL_DIR} invocation form, the disabled-mode branch,
// and the notes v2 authoring rules (lead-first bold action, visible-only
// captions) that the plan calls out as the core quality lever.
// ---------------------------------------------------------------------------

const skillDir = import.meta.dir;
const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf8");
const contractsMd = readFileSync(join(skillDir, "references", "contracts.md"), "utf8");

function parseFrontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\n([\s\S]*?)\n---/);
	if (match === null) {
		throw new Error("SKILL.md에 frontmatter가 없습니다");
	}
	const fields: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const sep = line.indexOf(":");
		if (sep === -1) continue;
		fields[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
	}
	return fields;
}

const frontmatter = parseFrontmatter(skillMd);
const commandNames = new Set(COMMANDS.map((command) => command.name));

/** Every `fc.ts <word1[ word2]>` occurrence in SKILL.md, resolved against `commandNames`. */
function findUnknownCommandReferences(markdown: string): string[] {
	const pattern = /fc\.ts\s+([a-z][a-z-]+)(?:\s+([a-z][a-z-]+))?/g;
	const unknown: string[] = [];
	for (const match of markdown.matchAll(pattern)) {
		const [whole, word1, word2] = match;
		const twoWord = word2 !== undefined ? `${word1} ${word2}` : undefined;
		if (twoWord !== undefined && commandNames.has(twoWord)) continue;
		if (commandNames.has(word1)) continue;
		unknown.push(whole);
	}
	return unknown;
}

describe("frontmatter", () => {
	test("name은 fc-feedback이다", () => {
		expect(frontmatter.name).toBe("fc-feedback");
	});

	test("description은 Use when으로 시작한다", () => {
		expect(frontmatter.description?.startsWith("Use when")).toBe(true);
	});
});

describe("fc.ts 명령 참조는 CLI COMMANDS 전부와 대응한다", () => {
	test("SKILL.md가 언급하는 모든 fc.ts 명령은 COMMANDS에 실재한다", () => {
		expect(findUnknownCommandReferences(skillMd)).toEqual([]);
	});

	test("최소 12개 이상의 서로 다른 명령이 참조된다(단계 0-11 커버리지)", () => {
		const referenced = new Set<string>();
		const pattern = /fc\.ts\s+([a-z][a-z-]+)(?:\s+([a-z][a-z-]+))?/g;
		for (const match of skillMd.matchAll(pattern)) {
			const [, word1, word2] = match;
			const twoWord = word2 !== undefined ? `${word1} ${word2}` : undefined;
			if (twoWord !== undefined && commandNames.has(twoWord)) {
				referenced.add(twoWord);
			} else if (commandNames.has(word1)) {
				referenced.add(word1);
			}
		}
		expect(referenced.size).toBeGreaterThanOrEqual(12);
	});

	test("호출은 ${CLAUDE_SKILL_DIR}/scripts/fc.ts 형태를 쓴다", () => {
		const occurrences = skillMd.match(/\$\{CLAUDE_SKILL_DIR\}\/scripts\/fc\.ts/g) ?? [];
		expect(occurrences.length).toBeGreaterThanOrEqual(12);
	});
});

describe("references/contracts.md는 §3/§16의 모든 계약 파일을 담는다", () => {
	const contractFiles = [
		// LLM이 쓰고 스크립트가 검증하는 파일
		"plan.json",
		"notes.json",
		"similar-choices.json",
		"refs-draft.json",
		// 스크립트가 쓰고 LLM은 읽기만 하는 파일
		"session.json",
		"lines.json",
		"candidates.json",
		"sheets.json",
		"similar-candidates.json",
		"refs.verified.json",
		"data.json",
		// 설정/명단
		"manifest.yaml",
		"roster.yaml",
		"taxonomy.yaml",
	];

	test.each(contractFiles)("%s가 문서화되어 있다", (file) => {
		expect(contractsMd).toContain(file);
	});

	test("notes.json v2 스키마(blocks/candidate_id/caption)가 문서화되어 있다", () => {
		expect(contractsMd).toContain('"type": "text"');
		expect(contractsMd).toContain('"type": "frame"');
		expect(contractsMd).toContain("candidate_id");
	});

	test("plan.json의 check 결과 exit code 0/1/2 의미가 문서화되어 있다", () => {
		expect(contractsMd).toContain("exit 0");
		expect(contractsMd).toContain("exit 2");
		expect(contractsMd).toContain("exit 1");
		expect(contractsMd).toContain("pending");
	});
});

describe("게이트와 확인 문구", () => {
	test("REVIEW GATE가 명시되어 있다", () => {
		expect(skillMd).toContain("REVIEW GATE");
	});

	test("PUBLISH GATE가 명시되어 있다", () => {
		expect(skillMd).toContain("PUBLISH GATE");
	});

	test("발행 전 명시적 확인 문구(예/yes)가 있다", () => {
		expect(skillMd).toContain('"예"/"yes"');
	});

	test("승인 전에는 git 명령을 실행하지 않는다는 문구가 있다", () => {
		expect(skillMd).toContain("git 명령도 실행하지 않는다");
	});
});

describe("disabled 모드 분기", () => {
	test("disabled 분기 섹션이 있다", () => {
		expect(skillMd).toContain("disabled 모드 분기");
	});

	test("config disable이 언급된다", () => {
		expect(skillMd).toContain("config disable");
	});

	test("disabled에서 PUBLISH GATE를 생략하고 site-only로 렌더한다는 문구가 있다", () => {
		expect(skillMd).toContain("render --site-only");
		expect(skillMd).toContain("PUBLISH GATE는 생략");
	});
});

describe("notes v2 작성 규칙(품질 핵심)", () => {
	test("두괄식(lead-first) 원칙이 있다", () => {
		expect(skillMd).toContain("두괄식");
	});

	test("볼드는 핵심 행동 하나에만 쓴다는 규칙이 있다", () => {
		expect(skillMd).toContain("볼드는 그 문장의 핵심 행동/대상 하나에만 쓴다");
	});

	test("프레임 캡션은 실제로 보이는 것만 쓴다는 규칙이 있다", () => {
		expect(skillMd).toContain("그 프레임에 실제로 보이는 것만");
	});

	test("세그먼트 분할 기준(주제 전환 발화, 15초 무음, 경기 시계 리셋)이 있다", () => {
		expect(skillMd).toContain("15초 이상 무음");
		expect(skillMd).toContain("경기 시계가 리셋되면 새 경기");
	});

	test("포지션과 무관하게 모두에게 통하는 말은 addressed_to_all: true로 표시한다는 규칙이 있다", () => {
		expect(skillMd).toContain("addressed_to_all: true");
	});

	test("불린 이름·다루는 포지션·전원 대상을 해당하면 함께 태그한다는 규칙이 있다", () => {
		expect(skillMd).toContain("셋을 함께 넣는다");
		expect(skillMd).toContain("그 피드백이 다루는 포지션(코치가 지목한");
		expect(skillMd).toContain("확인 안 되면 명단의 주포지션)은\n  `position_tags`");
	});
});

describe("round-0 RED 기준선 실패 대응 (진입점/재개, bare fc 금지, render-only, publish-prep 도달)", () => {
	test("유일한 CLI 진입점과 bare `fc` 금지 문구가 있다", () => {
		expect(skillMd).toContain("유일한 진입점은");
		expect(skillMd).toContain("셸 내장");
		expect(skillMd).toContain("zsh 히스토리 명령");
	});

	test("작업 폴더 기본 경로와 --work 재정의가 명시되어 있다", () => {
		expect(skillMd).toContain("$OMT_DIR/fc-feedback/<세션 id>");
		expect(skillMd).toContain("--work");
	});

	test("이미 있는 산출물 파일로 다음 단계를 재개하고 사용자에게 묻지 않는다는 문구가 있다", () => {
		expect(skillMd).toContain("session.json");
		expect(skillMd).toContain("plan.validated.json");
		expect(skillMd).toContain("묻지 않고");
		expect(skillMd).toContain("비어 있는 단계부터");
	});

	test("페이지는 render만 만들고 data.json/HTML을 손으로 쓰지 않는다는 원칙이 있다", () => {
		expect(skillMd).toContain("페이지는 `render`만 만든다");
		expect(skillMd).toContain("손으로 쓰지 않는다");
		expect(skillMd).toContain("브라우저는 필요 없다");
	});

	test("REVIEW GATE 승인 후 PUBLISH GATE까지 멈추지 않고 이어간다는 문구가 있다", () => {
		expect(skillMd).toContain("승인 후에는 멈추지 말고 11단계 PUBLISH GATE까지");
	});
});

describe("SOURCE REVIEW — presentation-reviewer 원문 대조", () => {
	test("notes 작성 단계(6단계)에 presentation-reviewer 디스패치가 명시되어 있다", () => {
		expect(skillMd).toContain("SOURCE REVIEW");
		expect(skillMd).toContain("presentation-reviewer");
	});

	test("contracts.md에 원문 대조 리뷰 번들 섹션이 있다", () => {
		expect(contractsMd).toContain("원문 대조 리뷰 번들");
		expect(contractsMd).toContain("presentation");
		expect(contractsMd).toContain("sources");
		expect(contractsMd).toContain("reader_persona");
	});

	test("원문 대조 리뷰 체크리스트가 첫 문단의 행동 주체를 점검한다", () => {
		expect(contractsMd).toContain("볼드 행동을 할 사람이 드러나는가");
		expect(contractsMd).toContain("행동 주체로 읽히지 않게 한다");
	});

	test("원문 대조 리뷰 체크리스트가 볼드 대상을 점검한다", () => {
		expect(contractsMd).toContain("볼드가 평가어");
		expect(contractsMd).toContain("실제로 한 잘못된 행동을 볼드로 짚는다");
	});

	test("원문 대조 리뷰 체크리스트가 장면의 공수 방향을 점검한다", () => {
		expect(contractsMd).toContain("장면이 공격인지 수비인지");
		expect(contractsMd).toContain("잘못이나 공로로 단정하지 않는다");
		expect(contractsMd).toContain("key_frame_candidate_ids`가 가리키는 대표 프레임");
	});
});

describe("플랫폼 중립 도구 표현", () => {
	test("web search/fetch 도구의 Claude/Codex 대응이 병기된다", () => {
		expect(skillMd).toContain("Claude: WebSearch/WebFetch; Codex: web search");
	});

	test("이미지 보기 도구의 Claude/Codex 대응이 병기된다", () => {
		expect(skillMd).toContain("Claude는 Read, Codex는 view_image");
	});

	test("SKILL.md에 실행 모델 권장을 적지 않는다", () => {
		expect(skillMd).not.toContain("권장 실행 모델");
	});
});
