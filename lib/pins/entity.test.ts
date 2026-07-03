import { describe, it, expect } from "bun:test";
import { serialize, parse } from "./entity";
import type { Entity } from "./types";

const FIXTURE: Entity = {
	frontmatter: {
		id: "proj-auth-token-refresh",
		type: "code",
		source: "github",
		authority: "toong@algocarelab.com",
		source_url: "https://github.com/algo-care/algocare-backend/pull/42",
		tier: "1",
		tags: "auth,token,refresh",
		sensitivity: "shared",
		status: "active",
		updated_at: "2026-06-01T00:00:00Z",
		checked_at: "2026-06-01T00:00:00Z",
		created_at: "2026-05-01T00:00:00Z",
		relations: [
			{ target: "proj-auth-jwt-strategy", type: "related_to" },
			{ target: "proj-auth-session-cleanup", type: "derived_from" },
		],
	},
	body: `## 한 줄 요지\n\n액세스 토큰 만료 시 리프레시 토큰으로 자동 재발급한다.\n\n## SSOT 위치\n\nhttps://github.com/algo-care/algocare-backend/pull/42\n\n## 전후 컨텍스트\n\n2026-05 인증 리팩터링 때 도입. JWT 전략 변경 이후 세션 유지 문제 해결을 위한 패치.\n\n## 관련 cross-link\n\n- [[proj-auth-jwt-strategy]]\n- [[proj-auth-session-cleanup]]`,
};

// (b) empty relations[] — the round-trip must preserve the empty array, not drop the key.
const FIXTURE_EMPTY_RELATIONS: Entity = {
	frontmatter: {
		id: "proj-standalone-note",
		type: "concept",
		source: "notion",
		authority: "toong@algocarelab.com",
		source_url: "https://notion.so/standalone",
		tier: "2",
		tags: "standalone",
		sensitivity: "private",
		status: "active",
		updated_at: "2026-06-02T00:00:00Z",
		checked_at: "2026-06-02T00:00:00Z",
		created_at: "2026-05-02T00:00:00Z",
		relations: [],
	},
	body: `## 한 줄 요지\n\n독립 노트.\n\n## SSOT 위치\n\nhttps://notion.so/standalone\n\n## 전후 컨텍스트\n\n관련 엣지 없음.\n\n## 관련 cross-link\n\n없음`,
};

// (c) discovery_context present + (e) Korean tag.
const FIXTURE_DISCOVERY_KOREAN_TAG: Entity = {
	frontmatter: {
		id: "proj-korean-context",
		type: "decision",
		source: "slack",
		authority: "toong@algocarelab.com",
		source_url: "https://slack.com/archives/C123/p456",
		tier: "1",
		tags: "인증,토큰,한글태그",
		sensitivity: "shared",
		status: "active",
		updated_at: "2026-06-03T00:00:00Z",
		checked_at: "2026-06-03T00:00:00Z",
		created_at: "2026-05-03T00:00:00Z",
		discovery_context: "2026-06 스레드에서 발견. 인증 정책 결정 맥락.",
		relations: [{ target: "proj-auth-token-refresh", type: "related_to" }],
	},
	body: `## 한 줄 요지\n\n한글 태그와 발견 맥락을 가진 결정.\n\n## SSOT 위치\n\nhttps://slack.com/archives/C123/p456\n\n## 전후 컨텍스트\n\n슬랙 스레드 결정.\n\n## 관련 cross-link\n\n- [[proj-auth-token-refresh]]`,
};

const FIXTURES: Array<[string, Entity]> = [
	["populated relations + discovery_context absent", FIXTURE],
	["empty relations[]", FIXTURE_EMPTY_RELATIONS],
	["discovery_context present + Korean tag", FIXTURE_DISCOVERY_KOREAN_TAG],
];

describe("parse: duplicate key rejection", () => {
	it("frontmatter with duplicate top-level key is rejected (throws)", () => {
		// Two `id:` keys — the second silently wins under Bun.YAML, corrupting the index.
		// After swapping to parseYamlStrict, parse() must throw so buildIndex skips the file.
		const dupKeyMd = [
			"---",
			"id: first-id",
			"id: second-id",
			"type: code",
			"source: github",
			"authority: someone",
			"source_url: https://example.com",
			'tier: "1"',
			"tags: test",
			"sensitivity: shared",
			"status: active",
			"updated_at: 2026-01-01T00:00:00Z",
			"checked_at: 2026-01-01T00:00:00Z",
			"created_at: 2026-01-01T00:00:00Z",
			"relations: []",
			"---",
			"",
			"## 한 줄 요지\n\nbody\n\n## SSOT 위치\n\nhttps://example.com\n\n## 전후 컨텍스트\n\nctx\n\n## 관련 cross-link\n\n없음",
		].join("\n");

		expect(() => parse(dupKeyMd)).toThrow();
	});
});

describe("entity", () => {
	it("roundtrip: parse(serialize(e)) deep-equals e", () => {
		const md = serialize(FIXTURE);
		const result = parse(md);
		expect(result).toEqual(FIXTURE);
	});

	for (const [name, fixture] of FIXTURES) {
		it(`roundtrip is value-lossless for fixture: ${name}`, () => {
			const result = parse(serialize(fixture));
			expect(result).toEqual(fixture);
		});

		it(`serialize emits the fence boundary "\\n---\\n\\n" for fixture: ${name}`, () => {
			expect(serialize(fixture).includes("\n---\n\n")).toBe(true);
		});
	}

	it("parse tolerates missing trailing newline", () => {
		const trimmed = serialize(FIXTURE).trimEnd();
		const result = parse(trimmed);
		expect(result).toEqual(FIXTURE);
	});

	it("Korean section headers and their content survive serialize→parse verbatim", () => {
		const md = serialize(FIXTURE);
		const result = parse(md);

		// Each Korean section header must appear in the body
		expect(result.body).toContain("## 한 줄 요지");
		expect(result.body).toContain("## SSOT 위치");
		expect(result.body).toContain("## 전후 컨텍스트");
		expect(result.body).toContain("## 관련 cross-link");

		// Content under each header must survive verbatim
		expect(result.body).toContain("액세스 토큰 만료 시 리프레시 토큰으로 자동 재발급한다.");
		expect(result.body).toContain(
			"2026-05 인증 리팩터링 때 도입. JWT 전략 변경 이후 세션 유지 문제 해결을 위한 패치.",
		);

		// Body must be byte-identical to input
		expect(result.body).toBe(FIXTURE.body);
	});
});
