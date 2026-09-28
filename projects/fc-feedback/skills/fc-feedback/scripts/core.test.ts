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
	checkCandidates,
	checkLines,
	checkNotes,
	checkPlan,
	checkRefsDraft,
	checkSession,
	checkSimilarChoices,
	desc,
	formatTime,
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
	type SimilarCandidatesResult,
	type Taxonomy,
	type ValidatedPlan,
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

// ── formatTime (DESIGN.md §4, plan §13.2-5) ──────────────────────────────────

describe("formatTime", () => {
	test("59분 59초는 m:ss로 표시한다(59:59)", () => {
		expect(formatTime(3599)).toBe("59:59");
	});

	test("1시간이면 h:mm:ss로 표시한다(1:00:00)", () => {
		expect(formatTime(3600)).toBe("1:00:00");
	});

	test("60분 미만은 분 앞에 0을 붙이지 않는다(0:05)", () => {
		expect(formatTime(5)).toBe("0:05");
	});
});

// ── session.json / lines.json / candidates.json 가드 (plan §3, §7 T3) ───────

function makeRawSession(): any {
	return {
		version: 1,
		session_id: "20240104-AAAAAAAAAAA",
		created_at: "2024-01-04T10:00:00Z",
		videos: [
			{
				id: "AAAAAAAAAAA",
				url: "https://youtu.be/AAAAAAAAAAA",
				part: 1,
				title: "1부",
				channel: "채널",
				upload_date: "20240104",
				duration: 60,
				embeddable: true,
				width: 854,
				height: 480,
				files: { audio: "a.wav", video: "a.mp4", captions: null, captions_format: null, wav: "a.wav" },
			},
			{
				id: "BBBBBBBBBBB",
				url: "https://youtu.be/BBBBBBBBBBB",
				part: 2,
				title: "2부",
				channel: "채널",
				upload_date: "20240104",
				duration: 100,
				embeddable: true,
				width: 854,
				height: 480,
				files: { audio: "b.wav", video: "b.mp4", captions: null, captions_format: null, wav: "b.wav" },
			},
		],
	};
}

function makeRawLines(): any[] {
	return [
		{ i: 0, video: "AAAAAAAAAAA", start: 0, end: 10, text: "안녕하세요" },
		{ i: 1, video: "AAAAAAAAAAA", start: 10, end: 20, text: "다음 상황 보시죠" },
		{ i: 2, video: "AAAAAAAAAAA", start: 20, end: 30, text: "골키퍼 배급 상황입니다" },
		{ i: 3, video: "BBBBBBBBBBB", start: 0, end: 10, text: "2부 시작합니다" },
		{ i: 4, video: "BBBBBBBBBBB", start: 10, end: 20, text: "크로스가 올라갑니다" },
	];
}

function makeRawCandidates(): any[] {
	return [
		{ id: "c001", video: "AAAAAAAAAAA", t: 10, kind: "silence", dur: 3 },
		{ id: "c002", video: "AAAAAAAAAAA", t: 25, kind: "scene" },
		{ id: "c004", video: "AAAAAAAAAAA", t: 40, kind: "scene" },
		{ id: "c003", video: "BBBBBBBBBBB", t: 5, kind: "interval" },
	];
}

describe("checkSession", () => {
	test("유효한 session.json을 파싱한다", () => {
		const result = checkSession(makeRawSession());
		expect(result.errors).toEqual([]);
		expect(result.value.session_id).toBe("20240104-AAAAAAAAAAA");
		expect(result.value.videos).toHaveLength(2);
		expect(result.value.videos[0].part).toBe(1);
	});

	test("version이 1이 아니면 version 경로 에러를 낸다", () => {
		const raw = makeRawSession();
		raw.version = 2;
		const result = checkSession(raw);
		expect(findError(result.errors, "version")).toBe(true);
	});

	test("session_id 패턴이 아니면 session_id 경로 에러를 낸다", () => {
		const raw = makeRawSession();
		raw.session_id = "bad-id";
		const result = checkSession(raw);
		expect(findError(result.errors, "session_id")).toBe(true);
	});

	test("video의 id 패턴이 아니면 videos[n].id 경로 에러를 낸다", () => {
		const raw = makeRawSession();
		raw.videos[0].id = "short";
		const result = checkSession(raw);
		expect(findError(result.errors, "videos[0].id")).toBe(true);
	});

	test("video의 part가 URL 순서와 다르면 videos[n].part 경로 에러를 낸다", () => {
		const raw = makeRawSession();
		raw.videos[1].part = 5;
		const result = checkSession(raw);
		expect(findError(result.errors, "videos[1].part")).toBe(true);
	});

	test("files.audio가 비어있으면 videos[n].files.audio 경로 에러를 낸다", () => {
		const raw = makeRawSession();
		raw.videos[0].files.audio = "";
		const result = checkSession(raw);
		expect(findError(result.errors, "videos[0].files.audio")).toBe(true);
	});
});

describe("checkLines", () => {
	const session = checkSession(makeRawSession()).value;

	test("유효한 lines.json을 파싱한다", () => {
		const result = checkLines(makeRawLines(), session);
		expect(result.errors).toEqual([]);
		expect(result.value).toHaveLength(5);
	});

	test("i가 연속되지 않으면 [n].i 경로 에러를 낸다", () => {
		const raw = makeRawLines();
		raw[1].i = 5;
		const result = checkLines(raw, session);
		expect(findError(result.errors, "[1].i")).toBe(true);
	});

	test("end가 duration+1을 넘으면 [n].end 경로 에러를 낸다", () => {
		const raw = makeRawLines();
		raw[2].end = 100; // video의 duration은 60 -> 최대 61
		const result = checkLines(raw, session);
		expect(findError(result.errors, "[2].end")).toBe(true);
	});

	test("text가 비어있으면 [n].text 경로 에러를 낸다", () => {
		const raw = makeRawLines();
		raw[0].text = "   ";
		const result = checkLines(raw, session);
		expect(findError(result.errors, "[0].text")).toBe(true);
	});

	test("video가 파트 순서대로 그룹화되지 않으면 [n].video 경로 에러를 낸다", () => {
		const raw = [
			{ i: 0, video: "AAAAAAAAAAA", start: 0, end: 5, text: "a" },
			{ i: 1, video: "BBBBBBBBBBB", start: 0, end: 5, text: "b" },
			{ i: 2, video: "AAAAAAAAAAA", start: 6, end: 9, text: "c" },
		];
		const result = checkLines(raw, session);
		expect(findError(result.errors, "[2].video")).toBe(true);
	});

	test("같은 video 그룹 내에서 start가 내림차순이면 [n].start 경로 에러를 낸다", () => {
		const raw = [
			{ i: 0, video: "AAAAAAAAAAA", start: 10, end: 20, text: "a" },
			{ i: 1, video: "AAAAAAAAAAA", start: 5, end: 15, text: "b" },
		];
		const result = checkLines(raw, session);
		expect(findError(result.errors, "[1].start")).toBe(true);
	});
});

describe("checkCandidates", () => {
	test("유효한 candidates.json을 파싱한다", () => {
		const result = checkCandidates(makeRawCandidates());
		expect(result.errors).toEqual([]);
		expect(result.value).toHaveLength(4);
	});

	test("id 패턴이 아니면 [n].id 경로 에러를 낸다", () => {
		const raw = makeRawCandidates();
		raw[0].id = "bad";
		const result = checkCandidates(raw);
		expect(findError(result.errors, "[0].id")).toBe(true);
	});

	test("중복된 id는 [n].id 경로 에러를 낸다", () => {
		const raw = [
			{ id: "c001", video: "AAAAAAAAAAA", t: 1, kind: "scene" },
			{ id: "c001", video: "AAAAAAAAAAA", t: 2, kind: "scene" },
		];
		const result = checkCandidates(raw);
		expect(findError(result.errors, "[1].id")).toBe(true);
	});

	test("kind가 silence가 아닌데 dur가 있으면 [n].dur 경로 에러를 낸다", () => {
		const raw = [{ id: "c001", video: "AAAAAAAAAAA", t: 1, kind: "scene", dur: 2 }];
		const result = checkCandidates(raw);
		expect(findError(result.errors, "[0].dur")).toBe(true);
	});

	test("video 그룹이 섞이면 [n].video 경로 에러를 낸다", () => {
		const raw = [
			{ id: "c010", video: "AAAAAAAAAAA", t: 1, kind: "scene" },
			{ id: "c011", video: "BBBBBBBBBBB", t: 1, kind: "scene" },
			{ id: "c012", video: "AAAAAAAAAAA", t: 2, kind: "scene" },
		];
		const result = checkCandidates(raw);
		expect(findError(result.errors, "[2].video")).toBe(true);
	});
});

// ── plan.json / plan.validated.json (checkPlan, plan §3, §7 T3) ─────────────

const fixtureSession = checkSession(makeRawSession()).value;
const fixtureLines = checkLines(makeRawLines(), fixtureSession).value;
const fixtureCandidates = checkCandidates(makeRawCandidates()).value;
const fixtureTaxonomy: Taxonomy = { version: 1, topics: ["빌드업", "탈압박"] };
const fixtureRoster: Roster = {
	members: [
		{ id: "hong-gildong", name: "홍길동", gamertag: "HongGD", positions: ["CB"], aliases: [] },
		{ id: "kim-cheolsu", name: "김철수", gamertag: "KimCS", positions: ["GK"], aliases: [] },
	],
};
const fixtureContext = {
	lines: fixtureLines,
	candidates: fixtureCandidates,
	taxonomy: fixtureTaxonomy,
	roster: fixtureRoster,
};

function makeValidPlan(): any {
	return {
		version: 1,
		session_title: "1월 4일 세션",
		matches: [
			{
				title: "1경기",
				topics: [
					{
						title: "빌드업 문제",
						summary: "후방 빌드업이 불안정했다",
						units: [
							{
								start_line: 0,
								end_line: 1,
								title: "센터백 패스 미스",
								position_tags: ["CB"],
								topic_tags: ["빌드업"],
								member_ids: ["hong-gildong"],
								key_frame_candidate_ids: ["c001"],
							},
							{
								start_line: 2,
								end_line: 2,
								title: "골키퍼 배급",
								position_tags: ["GK"],
								topic_tags: ["탈압박"],
								member_ids: [],
								key_frame_candidate_ids: ["c002"],
							},
						],
					},
				],
			},
		],
		proposed_tags: [],
	};
}

describe("checkPlan", () => {
	test("유효한 plan을 검증하면 에러가 없다", () => {
		const result = checkPlan(makeValidPlan(), fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.pending).toBe(false);
	});

	test("validated는 문서 순서대로 m1/m1-t1/u001 id를 부여하고 start/end/video를 채운다", () => {
		const result = checkPlan(makeValidPlan(), fixtureContext);
		expect(result.validated.matches[0].id).toBe("m1");
		expect(result.validated.matches[0].topics[0].id).toBe("m1-t1");
		expect(result.validated.units.map((u) => u.id)).toEqual(["u001", "u002"]);
		expect(result.validated.units[0]).toMatchObject({ video: "AAAAAAAAAAA", start: 0, end: 20 });
		expect(result.validated.units[1]).toMatchObject({ video: "AAAAAAAAAAA", start: 20, end: 30 });
	});

	test("tableMd는 경기·시간·제목·포지션·주제·팀원 열로 게이트 표를 만든다(스냅샷)", () => {
		const result = checkPlan(makeValidPlan(), fixtureContext);
		const expected = [
			"| 경기 | 시간 | 제목 | 포지션 | 주제 | 팀원 |",
			"|---|---|---|---|---|---|",
			"| 1경기 | 0:00 | 센터백 패스 미스 | CB | 빌드업 | 홍길동 |",
			"| 1경기 | 0:20 | 골키퍼 배급 | GK | 탈압박 | - |",
		].join("\n");
		expect(result.tableMd).toBe(expected);
	});

	test("session_title이 비어있으면 session_title 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.session_title = "";
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "session_title")).toBe(true);
	});

	test("session_title이 80자를 넘으면 session_title 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.session_title = "가".repeat(81);
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "session_title")).toBe(true);
	});

	test("topic summary가 비어있으면 summary 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].summary = "";
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].summary")).toBe(true);
	});

	test("match에 topic이 없으면 matches[n].topics 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics = [];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics")).toBe(true);
	});

	test("topic에 unit이 없으면 units 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units = [];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units")).toBe(true);
	});

	test("end_line이 lines.length 이상이면 end_line 경로 에러를 낸다(예시 경로)", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[1].end_line = 999;
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[1].end_line")).toBe(true);
	});

	test("start_line과 end_line이 다른 video면 end_line 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].end_line = 3; // video B
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].end_line")).toBe(true);
	});

	test("같은 video 내에서 unit이 겹치면 start_line 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[1].start_line = 1; // unit[0]의 end_line(1)과 겹침
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[1].start_line")).toBe(true);
	});

	test("포지션 트리에 없는 태그면 position_tags[n] 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].position_tags = ["XX"];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].position_tags[0]")).toBe(true);
	});

	test("topic_tags가 비어있으면 topic_tags 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].topic_tags = [];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].topic_tags")).toBe(true);
	});

	test("taxonomy에도 proposed_tags에도 없는 태그면 topic_tags[n] 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].topic_tags = ["존재안함"];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].topic_tags[0]")).toBe(true);
	});

	test("로스터에 없는 멤버면 member_ids[n] 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].member_ids = ["nobody"];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].member_ids[0]")).toBe(true);
	});

	test("roster가 null인데 member_ids가 있으면 member_ids[n] 경로 에러를 낸다(disabled)", () => {
		const plan = makeValidPlan(); // unit[0].member_ids = ["hong-gildong"] (비어있지 않음)
		const disabledContext = { ...fixtureContext, roster: null };
		const result = checkPlan(plan, disabledContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].member_ids[0]")).toBe(true);
	});

	test("존재하지 않는 candidate면 key_frame_candidate_ids[n] 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].key_frame_candidate_ids = ["c999"];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].key_frame_candidate_ids[0]")).toBe(true);
	});

	test("다른 video의 candidate면 key_frame_candidate_ids[n] 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].key_frame_candidate_ids = ["c003"]; // video B
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].key_frame_candidate_ids[0]")).toBe(true);
	});

	test("unit 허용 범위(±5초)를 벗어난 candidate 시각이면 key_frame_candidate_ids[n] 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].key_frame_candidate_ids = ["c004"]; // t=40, unit[0] 범위는 [-5,25]
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].key_frame_candidate_ids[0]")).toBe(true);
	});

	test("proposed_tags의 태그가 유효하지 않으면 proposed_tags[n].tag 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.proposed_tags = [{ tag: "a|b", reason: "이유" }];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "proposed_tags[0].tag")).toBe(true);
	});

	test("proposed_tags의 태그가 이미 taxonomy에 있으면 proposed_tags[n].tag 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.proposed_tags = [{ tag: "빌드업", reason: "이유" }];
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "proposed_tags[0].tag")).toBe(true);
	});

	test("proposed 태그를 사용하면 pending이 true가 된다", () => {
		const plan = makeValidPlan();
		plan.proposed_tags = [{ tag: "역습저지", reason: "새 주제" }];
		plan.matches[0].topics[0].units[0].topic_tags = ["역습저지"];
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.pending).toBe(true);
		expect(result.proposed).toEqual([{ tag: "역습저지", reason: "새 주제" }]);
		expect(result.tableMd).toContain("제안 태그:");
		expect(result.tableMd).toContain("- 역습저지 (새 주제)");
	});
});

// ── notes.json (checkNotes, plan §3) ─────────────────────────────────────────

const fixtureValidated: ValidatedPlan = checkPlan(makeValidPlan(), fixtureContext).validated;

function makeValidNotes(): any {
	return {
		version: 1,
		units: {
			u001: {
				problem: "센터백이 패스를 미스했습니다",
				who: "홍길동",
				instead: "빌드업 시 패스 각도를 열어야 합니다",
				key_frames: [{ candidate_id: "c001", caption: "패스 미스 장면" }],
			},
			u002: {
				problem: "골키퍼 배급이 느렸습니다",
				who: "김철수",
				instead: "더 빠르게 배급해야 합니다",
				key_frames: [],
			},
		},
	};
}

describe("checkNotes", () => {
	test("유효한 notes를 검증하면 에러가 없다", () => {
		const result = checkNotes(makeValidNotes(), fixtureValidated);
		expect(result.errors).toEqual([]);
	});

	test("검증된 unit에 대응하는 노트가 없으면 units.<id> 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		delete notes.units.u002;
		const result = checkNotes(notes, fixtureValidated);
		expect(findError(result.errors, "units.u002")).toBe(true);
	});

	test("검증된 plan에 없는 unit id면 units.<id> 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u999 = { problem: "p", who: "w", instead: "i", key_frames: [] };
		const result = checkNotes(notes, fixtureValidated);
		expect(findError(result.errors, "units.u999")).toBe(true);
	});

	test("problem이 1200자를 넘으면 units.<id>.problem 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.problem = "가".repeat(1201);
		const result = checkNotes(notes, fixtureValidated);
		expect(findError(result.errors, "units.u001.problem")).toBe(true);
	});

	test("key_frames가 4개를 넘으면 units.<id>.key_frames 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.key_frames = Array.from({ length: 5 }, () => ({ candidate_id: "c001", caption: "x" }));
		const result = checkNotes(notes, fixtureValidated);
		expect(findError(result.errors, "units.u001.key_frames")).toBe(true);
	});

	test("key_frames의 candidate_id가 unit의 key_frame_candidate_ids에 없으면 candidate_id 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.key_frames = [{ candidate_id: "c999", caption: "x" }];
		const result = checkNotes(notes, fixtureValidated);
		expect(findError(result.errors, "units.u001.key_frames[0].candidate_id")).toBe(true);
	});

	test("caption이 120자를 넘으면 caption 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.key_frames = [{ candidate_id: "c001", caption: "가".repeat(121) }];
		const result = checkNotes(notes, fixtureValidated);
		expect(findError(result.errors, "units.u001.key_frames[0].caption")).toBe(true);
	});
});

// ── similar-choices.json (checkSimilarChoices, plan §3) ──────────────────────

const fixtureSimilarCandidates: SimilarCandidatesResult = {
	u001: [
		{ uid: "20230101-CCCCCCCCCCC#u001", score: 0.5, title: "과거1", date: "2023-01-01", topic_tags: ["빌드업"], position_tags: ["CB"] },
		{ uid: "20230201-DDDDDDDDDDD#u001", score: 0.4, title: "과거2", date: "2023-02-01", topic_tags: ["빌드업"], position_tags: ["CB"] },
	],
	u002: [],
};

function makeValidChoices(): any {
	return { version: 1, units: { u001: ["20230101-CCCCCCCCCCC#u001"] } };
}

describe("checkSimilarChoices", () => {
	test("유효한 similar-choices를 검증하면 에러가 없다", () => {
		const result = checkSimilarChoices(makeValidChoices(), fixtureSimilarCandidates);
		expect(result.errors).toEqual([]);
	});

	test("후보 목록에 없는 uid면 units.<id>[n] 경로 에러를 낸다", () => {
		const choices = makeValidChoices();
		choices.units.u001 = ["20230101-ZZZZZZZZZZZ#u001"];
		const result = checkSimilarChoices(choices, fixtureSimilarCandidates);
		expect(findError(result.errors, "units.u001[0]")).toBe(true);
	});

	test("unit당 3개를 넘으면 units.<id> 경로 에러를 낸다", () => {
		const choices = makeValidChoices();
		choices.units.u001 = [
			"20230101-CCCCCCCCCCC#u001",
			"20230201-DDDDDDDDDDD#u001",
			"20230301-EEEEEEEEEEE#u001",
			"20230401-FFFFFFFFFFF#u001",
		];
		const result = checkSimilarChoices(choices, fixtureSimilarCandidates);
		expect(findError(result.errors, "units.u001")).toBe(true);
	});

	test("중복된 uid면 units.<id>[n] 경로 에러를 낸다", () => {
		const choices = makeValidChoices();
		choices.units.u001 = ["20230101-CCCCCCCCCCC#u001", "20230101-CCCCCCCCCCC#u001"];
		const result = checkSimilarChoices(choices, fixtureSimilarCandidates);
		expect(findError(result.errors, "units.u001[1]")).toBe(true);
	});
});

// ── refs-draft.json (checkRefsDraft, plan §3) ────────────────────────────────

function makeValidRefsDraft(): any {
	return {
		version: 1,
		refs: [
			{
				url: "https://example.com/tactics-article",
				title: "전술 아티클",
				source_name: "Example",
				lang: "en",
				kind: "tactics",
				summary_ko: "한국어 요약입니다",
				key_points_ko: ["포인트1"],
				translations: [{ orig: "Some point", ko: "어떤 포인트" }],
				unit_ids: ["u001"],
			},
		],
	};
}

describe("checkRefsDraft", () => {
	test("유효한 refs-draft를 검증하면 에러가 없다", () => {
		const result = checkRefsDraft(makeValidRefsDraft(), fixtureValidated);
		expect(result.errors).toEqual([]);
	});

	test("url이 http(s)가 아니면 refs[n].url 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		draft.refs[0].url = "javascript:alert(1)";
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[0].url")).toBe(true);
	});

	test("lang 패턴이 아니면 refs[n].lang 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		draft.refs[0].lang = "eng";
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[0].lang")).toBe(true);
	});

	test("kind가 eafc/tactics가 아니면 refs[n].kind 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		draft.refs[0].kind = "other";
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[0].kind")).toBe(true);
	});

	test("lang이 ko가 아닌데 summary_ko가 없으면 refs[n].summary_ko 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		delete draft.refs[0].summary_ko;
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[0].summary_ko")).toBe(true);
	});

	test("lang이 ko가 아닌데 key_points_ko가 없으면 refs[n].key_points_ko 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		draft.refs[0].key_points_ko = [];
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[0].key_points_ko")).toBe(true);
	});

	test("translations가 5개를 넘으면 refs[n].translations 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		draft.refs[0].translations = Array.from({ length: 6 }, (_, i) => ({ orig: `o${i}`, ko: `k${i}` }));
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[0].translations")).toBe(true);
	});

	test("unit_ids가 비어있으면 refs[n].unit_ids 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		draft.refs[0].unit_ids = [];
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[0].unit_ids")).toBe(true);
	});

	test("unit_ids에 존재하지 않는 id가 있으면 refs[n].unit_ids[m] 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		draft.refs[0].unit_ids = ["u999"];
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[0].unit_ids[0]")).toBe(true);
	});

	test("unit당 참고자료가 3개를 넘으면 refs[n].unit_ids 경로 에러를 낸다", () => {
		const draft = {
			version: 1,
			refs: Array.from({ length: 4 }, (_, i) => ({
				url: `https://example.com/ref-${i}`,
				title: `참고자료 ${i}`,
				source_name: "Example",
				lang: "ko",
				kind: "tactics",
				key_points_ko: [],
				translations: [],
				unit_ids: ["u001"],
			})),
		};
		const result = checkRefsDraft(draft, fixtureValidated);
		expect(findError(result.errors, "refs[3].unit_ids")).toBe(true);
	});
});
