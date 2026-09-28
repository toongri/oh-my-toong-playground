import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
	MEMBER_ID_PATTERN,
	PARENT,
	POSITIONS,
	SID_PATTERN,
	UID_PATTERN,
	VID_PATTERN,
	anc,
	desc,
	isValidTag,
	localLinks,
	normalizeUrl,
	parseRoster,
	parseTaxonomy,
	posClosure,
	refId,
	related,
	relatedMembers,
	similarCandidates,
	type CurrentUnit,
	type PastUnit,
	type Roster,
} from "./core.ts";

const TAXONOMY_DEFAULT_PATH = join(import.meta.dir, "taxonomy.default.yaml");

// ── patterns ─────────────────────────────────────────────────────────────────

describe("패턴", () => {
	test("VID_PATTERN은 11자 영숫자/-/_만 허용한다", () => {
		expect(VID_PATTERN.test("NUzEChn9EyI")).toBe(true);
		expect(VID_PATTERN.test("short")).toBe(false);
		expect(VID_PATTERN.test("has spaces!")).toBe(false);
	});

	test("SID_PATTERN은 YYYYMMDD-VID 형태만 허용한다", () => {
		expect(SID_PATTERN.test("20240104-NUzEChn9EyI")).toBe(true);
		expect(SID_PATTERN.test("2024104-NUzEChn9EyI")).toBe(false);
		expect(SID_PATTERN.test("20240104-tooShort")).toBe(false);
	});

	test("UID_PATTERN은 SID#u000 형태만 허용한다", () => {
		expect(UID_PATTERN.test("20240104-NUzEChn9EyI#u001")).toBe(true);
		expect(UID_PATTERN.test("20240104-NUzEChn9EyI#u1")).toBe(false);
		expect(UID_PATTERN.test("20240104-NUzEChn9EyI")).toBe(false);
	});

	test("MEMBER_ID_PATTERN은 소문자/숫자로 시작하는 kebab-case만 허용한다", () => {
		expect(MEMBER_ID_PATTERN.test("hong-gildong2")).toBe(true);
		expect(MEMBER_ID_PATTERN.test("-leading-dash")).toBe(false);
		expect(MEMBER_ID_PATTERN.test("Upper")).toBe(false);
	});

	test("isValidTag는 1~20자, |없음, trim된 문자열만 허용한다", () => {
		expect(isValidTag("빌드업")).toBe(true);
		expect(isValidTag("전환/역습")).toBe(true);
		expect(isValidTag("")).toBe(false);
		expect(isValidTag("a".repeat(21))).toBe(false);
		expect(isValidTag("a|b")).toBe(false);
		expect(isValidTag(" 앞뒤공백 ")).toBe(false);
	});
});

// ── position tree (plan §4-C) ─────────────────────────────────────────────────

describe("포지션 트리", () => {
	test("FB 태그와 LB를 가진 멤버는 관련 있다", () => {
		expect(related("FB", "LB")).toBe(true);
	});

	test("CB와 LB는 관련 없다(같은 DF 하위지만 조상/자손 관계 아님)", () => {
		expect(related("CB", "LB")).toBe(false);
	});

	test("GK는 DF/MF/FW 하위 무엇과도 관련 없다", () => {
		expect(related("GK", "CB")).toBe(false);
		expect(related("GK", "CDM")).toBe(false);
		expect(related("GK", "ST")).toBe(false);
		expect(related("GK", "DF")).toBe(false);
	});

	test("DF는 DF 하위 전부와 관련 있다", () => {
		const dfDescendants = desc("DF");
		expect(dfDescendants).toEqual(
			expect.arrayContaining(["DF", "CB", "FB", "LB", "RB", "LWB", "RWB"]),
		);
		for (const position of dfDescendants) {
			expect(related("DF", position)).toBe(true);
		}
	});

	test("anc는 자신부터 루트까지의 조상 체인을 반환한다", () => {
		expect(anc("LB")).toEqual(["LB", "FB", "DF"]);
		expect(anc("DF")).toEqual(["DF"]);
	});

	test("posClosure는 태그별 조상∪자손의 합집합이다", () => {
		expect(new Set(posClosure(["FB"]))).toEqual(
			new Set(["FB", "DF", "LB", "RB", "LWB", "RWB"]),
		);
	});

	test("POSITIONS와 PARENT는 spec의 트리 정의와 일치한다", () => {
		expect(POSITIONS.has("GK")).toBe(true);
		expect(POSITIONS.has("CAM")).toBe(true);
		expect(PARENT.CB).toBe("DF");
		expect(PARENT.ST).toBe("FW");
		expect(PARENT.GK).toBeUndefined();
	});
});

describe("relatedMembers", () => {
	const roster: Roster = {
		members: [
			{ id: "mention-only", name: "언급만", gamertag: "MentionOnly", positions: ["ST"], aliases: [] },
			{ id: "position-only", name: "포지션만", gamertag: "PositionOnly", positions: ["LB"], aliases: [] },
			{ id: "unrelated", name: "무관", gamertag: "Unrelated", positions: ["GK"], aliases: [] },
		],
	};

	test("member_ids에 직접 언급된 멤버를 포함한다(언급 경로)", () => {
		// RW는 명단의 ST(FW 하위지만 다른 가지)/LB/GK 누구와도 트리상 관련되지 않는 태그다.
		const result = relatedMembers({ member_ids: ["mention-only"], position_tags: ["RW"] }, roster);
		expect(result.map((m) => m.id)).toEqual(["mention-only"]);
	});

	test("포지션 트리로 관련된 멤버를 포함한다(포지션 경로)", () => {
		const result = relatedMembers({ member_ids: [], position_tags: ["FB"] }, roster);
		expect(result.map((m) => m.id)).toEqual(["position-only"]);
	});

	test("두 경로 모두 해당하면 중복 없이 명단 순서로 반환한다", () => {
		const result = relatedMembers(
			{ member_ids: ["mention-only"], position_tags: ["FB"] },
			roster,
		);
		expect(result.map((m) => m.id)).toEqual(["mention-only", "position-only"]);
	});

	test("무관한 멤버는 제외한다", () => {
		const result = relatedMembers({ member_ids: [], position_tags: ["FB"] }, roster);
		expect(result.map((m) => m.id)).not.toContain("unrelated");
	});
});

// ── roster.yaml ───────────────────────────────────────────────────────────────

function findError(errors: { path: string; message: string }[], path: string): boolean {
	return errors.some((error) => error.path === path);
}

describe("parseRoster", () => {
	test("유효한 roster를 파싱한다", () => {
		const result = parseRoster(`
members:
  - id: hong-gildong
    name: 홍길동
    gamertag: HongGD
    positions: [CB, FB]
    aliases: [길동]
  - id: coach-kim
    name: 김코치
    gamertag: CoachKim
    positions: [MF]
    role: coach
`);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.members).toHaveLength(2);
		expect(result.value.members[0]).toEqual({
			id: "hong-gildong",
			name: "홍길동",
			gamertag: "HongGD",
			positions: ["CB", "FB"],
			aliases: ["길동"],
		});
		expect(result.value.members[1].role).toBe("coach");
	});

	test("members가 없거나 빈 배열이면 members 경로 에러를 낸다", () => {
		const empty = parseRoster("members: []");
		expect(empty.ok).toBe(false);
		if (empty.ok) return;
		expect(findError(empty.errors, "members")).toBe(true);
	});

	test("중복된 id는 members[n].id 경로 에러를 낸다", () => {
		const result = parseRoster(`
members:
  - id: dup-id
    name: A
    gamertag: A1
    positions: [GK]
  - id: dup-id
    name: B
    gamertag: B1
    positions: [GK]
`);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "members[1].id")).toBe(true);
	});

	test("대소문자 무시 중복 gamertag는 members[n].gamertag 경로 에러를 낸다", () => {
		const result = parseRoster(`
members:
  - id: player-a
    name: A
    gamertag: SameTag
    positions: [GK]
  - id: player-b
    name: B
    gamertag: sametag
    positions: [GK]
`);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "members[1].gamertag")).toBe(true);
	});

	test("트리에 없는 포지션은 members[n].positions[m] 경로 에러를 낸다", () => {
		const result = parseRoster(`
members:
  - id: player-a
    name: A
    gamertag: A1
    positions: [XX]
`);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "members[0].positions[0]")).toBe(true);
	});

	test("alias가 다른 멤버의 이름과 충돌하면 에러를 낸다", () => {
		const result = parseRoster(`
members:
  - id: player-a
    name: 홍길동
    gamertag: A1
    positions: [GK]
  - id: player-b
    name: B
    gamertag: B1
    positions: [GK]
    aliases: [홍길동]
`);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "members[1].aliases[0]")).toBe(true);
	});

	test("alias가 다른 멤버의 alias와 충돌하면 에러를 낸다", () => {
		const result = parseRoster(`
members:
  - id: player-a
    name: A
    gamertag: A1
    positions: [GK]
    aliases: [별명]
  - id: player-b
    name: B
    gamertag: B1
    positions: [GK]
    aliases: [별명]
`);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "members[0].aliases[0]")).toBe(true);
		expect(findError(result.errors, "members[1].aliases[0]")).toBe(true);
	});

	test("role은 coach 외 값이면 members[n].role 경로 에러를 낸다", () => {
		const result = parseRoster(`
members:
  - id: player-a
    name: A
    gamertag: A1
    positions: [GK]
    role: manager
`);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "members[0].role")).toBe(true);
	});

	test("name이 빈 문자열이면 members[n].name 경로 에러를 낸다", () => {
		const result = parseRoster(`
members:
  - id: player-a
    name: "  "
    gamertag: A1
    positions: [GK]
`);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "members[0].name")).toBe(true);
	});

	test("YAML 파싱에 실패하면 빈 경로 에러를 낸다", () => {
		const result = parseRoster("members: [\n");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "")).toBe(true);
	});
});

// ── taxonomy.yaml ─────────────────────────────────────────────────────────────

describe("parseTaxonomy", () => {
	test("유효한 taxonomy를 파싱한다", () => {
		const result = parseTaxonomy("version: 1\ntopics: [빌드업, 탈압박]\n");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual({ version: 1, topics: ["빌드업", "탈압박"] });
	});

	test("version이 1이 아니면 version 경로 에러를 낸다", () => {
		const result = parseTaxonomy("version: 2\ntopics: [빌드업]\n");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "version")).toBe(true);
	});

	test("중복된 topic은 topics[n] 경로 에러를 낸다", () => {
		const result = parseTaxonomy("version: 1\ntopics: [빌드업, 빌드업]\n");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "topics[1]")).toBe(true);
	});

	test("유효하지 않은 태그는 topics[n] 경로 에러를 낸다", () => {
		const result = parseTaxonomy("version: 1\ntopics: ['a|b']\n");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(findError(result.errors, "topics[0]")).toBe(true);
	});

	test("번들 taxonomy.default.yaml은 spec 기본 주제 11개를 모두 포함한다(plan §13.2-4)", () => {
		const text = readFileSync(TAXONOMY_DEFAULT_PATH, "utf8");
		const result = parseTaxonomy(text);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.version).toBe(1);
		expect(result.value.topics).toEqual([
			"빌드업",
			"탈압박",
			"압박",
			"수비라인",
			"전환/역습",
			"파이널서드",
			"크로스",
			"세트피스",
			"조작/키사용",
			"포지셔닝",
			"커뮤니케이션",
		]);
	});
});

// ── similarity (plan §4-D) ─────────────────────────────────────────────────────

describe("similarCandidates", () => {
	const current: CurrentUnit = {
		id: "u001",
		session: "20240201-currentSessAAA",
		topic_tags: ["빌드업", "전환/역습"],
		position_tags: ["CB"],
		member_ids: ["a", "b"],
	};

	test("직접 계산한 점수와 일치한다(0.5*topic + 0.3*position + 0.2*member)", () => {
		const pastA: PastUnit = {
			uid: "20230101-AAAAAAAAAAA#u001",
			session: "20230101-AAAAAAAAAAA",
			title: "과거 A",
			date: "2024-01-01",
			topic_tags: ["빌드업"],
			position_tags: ["DF"],
			member_ids: ["a"],
		};
		const pastB: PastUnit = {
			uid: "20230201-BBBBBBBBBBB#u001",
			session: "20230201-BBBBBBBBBBB",
			title: "과거 B",
			date: "2024-02-01",
			topic_tags: ["빌드업", "전환/역습"],
			position_tags: ["CB"],
			member_ids: ["a", "b"],
		};

		const result = similarCandidates([current], [pastA, pastB]);
		expect(result.u001).toHaveLength(2);
		// pastA: topic J=1/2=.5, position J(anc(CB)={CB,DF} vs anc(DF)={DF})=1/2=.5, member J=1/2=.5
		//   -> 0.5*.5+0.3*.5+0.2*.5 = 0.5
		// pastB: 모든 태그 집합이 동일 -> J=1 전부 -> score 1.0
		expect(result.u001[0]).toMatchObject({ uid: pastB.uid, score: 1 });
		expect(result.u001[1]).toMatchObject({ uid: pastA.uid, score: 0.5 });
	});

	test("점수를 소수 3자리로 반올림한다", () => {
		const past: PastUnit = {
			uid: "20230101-AAAAAAAAAAA#u001",
			session: "20230101-AAAAAAAAAAA",
			title: "과거",
			date: "2024-01-01",
			topic_tags: ["빌드업"],
			position_tags: ["DF"],
			member_ids: ["a"],
		};
		const threeTopicCurrent: CurrentUnit = {
			id: "u002",
			session: "20240201-currentSessAAA",
			topic_tags: ["빌드업", "탈압박", "압박"],
			position_tags: ["DF"],
			member_ids: ["a"],
		};
		// topic J = 1/3, position J = 1, member J = 1
		// score = 0.5*(1/3) + 0.3*1 + 0.2*1 = 0.6666...  -> 반올림 0.667
		const result = similarCandidates([threeTopicCurrent], [past]);
		expect(result.u002[0].score).toBe(0.667);
	});

	test("같은 세션의 유닛은 제외한다", () => {
		const sameSession: PastUnit = {
			uid: "20240201-currentSessAAA#u002",
			session: current.session,
			title: "같은 세션",
			date: "2024-02-01",
			topic_tags: ["빌드업"],
			position_tags: ["CB"],
			member_ids: ["a", "b"],
		};
		const result = similarCandidates([current], [sameSession]);
		expect(result.u001).toEqual([]);
	});

	test("공유 주제 태그가 없으면 점수가 높아도 제외한다", () => {
		const noSharedTopic: PastUnit = {
			uid: "20230101-AAAAAAAAAAA#u001",
			session: "20230101-AAAAAAAAAAA",
			title: "무관한 주제",
			date: "2024-01-01",
			topic_tags: ["크로스"], // current와 완전히 다른 주제
			position_tags: ["CB"],
			member_ids: ["a", "b"],
		};
		const result = similarCandidates([current], [noSharedTopic]);
		expect(result.u001).toEqual([]);
	});

	test("점수가 0.2 미만이면 제외한다", () => {
		const lowScore: PastUnit = {
			uid: "20230101-AAAAAAAAAAA#u001",
			session: "20230101-AAAAAAAAAAA",
			title: "낮은 점수",
			date: "2024-01-01",
			topic_tags: ["빌드업", "탈압박", "압박", "수비라인", "전환/역습", "파이널서드", "크로스"],
			position_tags: ["GK"],
			member_ids: ["z"],
		};
		// topic J = 1/8 = .125, position J = 0(공통 조상 없음), member J = 0
		// score = 0.5*.125 = 0.0625 < 0.2
		const result = similarCandidates([current], [lowScore]);
		expect(result.u001).toEqual([]);
	});

	test("동점이면 날짜 내림차순 → uid 오름차순으로 정렬한다", () => {
		const makeTiedPast = (uid: string, date: string, session: string): PastUnit => ({
			uid,
			session,
			title: `과거 ${uid}`,
			date,
			topic_tags: ["빌드업"],
			position_tags: ["CB"],
			member_ids: ["a", "b"],
		});
		const x = makeTiedPast("20240501-sessionX0000#u001", "2024-05-01", "20240501-sessionX0000");
		const y = makeTiedPast("20240501-sessionY0000#u001", "2024-05-01", "20240501-sessionY0000");
		const z = makeTiedPast("20240401-sessionZ0000#u001", "2024-04-01", "20240401-sessionZ0000");
		const tiedCurrent: CurrentUnit = {
			id: "u003",
			session: "20240601-currentSessBB",
			topic_tags: ["빌드업", "전환/역습"],
			position_tags: ["CB"],
			member_ids: ["a", "b", "c"],
		};

		const result = similarCandidates([tiedCurrent], [x, y, z]);
		// x, y는 uid만 다르고 나머지 태그 동일 -> 같은 점수, 같은 날짜
		// uid 오름차순: "...sessionX0000..." < "...sessionY0000..." (X < Y)
		expect(result.u003.map((c) => c.uid)).toEqual([x.uid, y.uid, z.uid]);
	});

	test("상위 5개만 남긴다", () => {
		const pastUnits: PastUnit[] = Array.from({ length: 8 }, (_, index) => ({
			uid: `2024010${index}-sessionA000${index}#u001`,
			session: `2024010${index}-sessionA000${index}`,
			title: `과거 ${index}`,
			date: `2024-01-0${index + 1}`,
			topic_tags: ["빌드업"],
			position_tags: ["CB"],
			member_ids: ["a", "b"],
		}));
		const result = similarCandidates([current], pastUnits);
		expect(result.u001).toHaveLength(5);
	});
});

// ── URL normalization + refId (plan §4-E) ────────────────────────────────────

describe("normalizeUrl", () => {
	test("scheme/host를 소문자로 만든다", () => {
		expect(normalizeUrl("HTTPS://Example.COM/path")).toBe("https://example.com/path");
	});

	test("fragment를 제거한다", () => {
		expect(normalizeUrl("https://example.com/path#section")).toBe("https://example.com/path");
	});

	test("utm_* 파라미터를 제거한다", () => {
		expect(normalizeUrl("https://example.com/?utm_source=x&utm_medium=y&q=1")).toBe(
			"https://example.com/?q=1",
		);
	});

	test("fbclid/gclid 파라미터를 제거한다", () => {
		expect(normalizeUrl("https://example.com/?fbclid=abc&gclid=def&q=1")).toBe(
			"https://example.com/?q=1",
		);
	});

	test("루트가 아닌 경로의 끝 슬래시를 제거한다", () => {
		expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
	});

	test("루트 경로의 슬래시는 유지한다", () => {
		expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
	});

	test("youtu.be 링크를 watch?v=ID로 재작성한다", () => {
		expect(normalizeUrl("https://youtu.be/NUzEChn9EyI?t=30")).toBe(
			"https://www.youtube.com/watch?v=NUzEChn9EyI",
		);
	});

	test("shorts 링크를 watch?v=ID로 재작성한다", () => {
		expect(normalizeUrl("https://www.youtube.com/shorts/NUzEChn9EyI")).toBe(
			"https://www.youtube.com/watch?v=NUzEChn9EyI",
		);
	});

	test("이미 watch 형태인 링크도 v만 남기고 정규화한다", () => {
		expect(normalizeUrl("https://youtube.com/watch?v=NUzEChn9EyI&t=10&utm_source=x")).toBe(
			"https://www.youtube.com/watch?v=NUzEChn9EyI",
		);
	});

	test("javascript: 스킴은 거부한다", () => {
		expect(() => normalizeUrl("javascript:alert(1)")).toThrow();
	});
});

describe("refId", () => {
	test("r- 접두사 + sha256 앞 10자 hex로 결정적인 id를 만든다", () => {
		const id = refId("https://example.com/article");
		expect(id).toMatch(/^r-[0-9a-f]{10}$/);
		expect(refId("https://example.com/article")).toBe(id);
	});

	test("정규화 후 같은 URL이면 같은 refId를 만든다(추적 파라미터만 다른 경우)", () => {
		const a = refId("https://example.com/article?utm_source=slack");
		const b = refId("https://EXAMPLE.com/article?utm_source=newsletter#top");
		expect(a).toBe(b);
	});

	test("다른 URL이면 다른 refId를 만든다", () => {
		expect(refId("https://example.com/a")).not.toBe(refId("https://example.com/b"));
	});
});

// ── link check (plan §4-F) ────────────────────────────────────────────────────

describe("localLinks", () => {
	test("http(s)가 아닌 href/src만 추출한다", () => {
		const html = `
			<a href="https://example.com">외부</a>
			<a href="../refs/r-0123456789.html">참고자료</a>
			<img src="img/frame1.webp">
			<a href="#u001">유닛 앵커</a>
		`;
		expect(localLinks(html)).toEqual(["../refs/r-0123456789.html", "img/frame1.webp", "#u001"]);
	});

	test("href/src가 없으면 빈 배열을 반환한다", () => {
		expect(localLinks("<p>본문만 있음</p>")).toEqual([]);
	});
});
