import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
	MEMBER_ID_PATTERN,
	LEGACY_POSITION_CODES,
	PARENT,
	POSITIONS,
	SID_PATTERN,
	UID_PATTERN,
	VID_PATTERN,
	anc,
	boldSpans,
	checkCandidates,
	checkLines,
	checkNotes,
	checkPlan,
	checkRefsDraft,
	recurringPartialCoverageWarnings,
	recurringProClubsWarnings,
	recurringCandidateWarnings,
	recurringInferredActorWarnings,
	trailingUnassignedLineWarnings,
	unitLines,
	TRAILING_LINE_WINDOW_SECONDS,
	dubeolsikReading,
	unmatchedTagReadingWarnings,
	closeRosterNames,
	type Line,
	rosterLabelIn,
	searchKeywordWords,
	checkSession,
	checkSimilarChoices,
	clockSeconds,
	commentAuthorMember,
	commentAuthorName,
	selfCritiqueMemberIds,
	desc,
	formatTime,
	isValidTag,
	localLinks,
	namedMemberIds,
	normalizeUrl,
	noteWarnings,
	parseRoster,
	positionFromLegacyCode,
	positionTagsFromLegacy,
	parseTaxonomy,
	posClosure,
	refId,
	related,
	positionTargetMembers,
	groupMembers,
	relatedMembers,
	similarCandidates,
	webpDimensions,
	type CurrentUnit,
	type PastUnit,
	type Roster,
	type SimilarCandidatesResult,
	type Taxonomy,
	type ValidatedPlan,
	matchGameVersion,
	refsMatchVersionErrors,
	refVersionBadge,
	publishedBadge,
	unitTitleFormErrors,
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
	test("DF 태그와 FB를 가진 멤버는 관련 있다", () => {
		expect(related("DF", "FB")).toBe(true);
	});

	test("CB와 FB는 관련 없다(같은 DF 하위지만 조상/자손 관계 아님)", () => {
		expect(related("CB", "FB")).toBe(false);
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
			expect.arrayContaining(["DF", "CB", "FB", "WB"]),
		);
		for (const position of dfDescendants) {
			expect(related("DF", position)).toBe(true);
		}
	});

	test("anc는 자신부터 루트까지의 조상 체인을 반환한다", () => {
		expect(anc("FB")).toEqual(["FB", "DF"]);
		expect(anc("DF")).toEqual(["DF"]);
	});

	test("posClosure는 태그별 조상∪자손의 합집합이다", () => {
		expect(new Set(posClosure(["FB"]))).toEqual(new Set(["FB", "DF"]));
		expect(new Set(posClosure(["DF"]))).toEqual(new Set(["DF", "CB", "FB", "WB"]));
	});

	test("POSITIONS와 PARENT는 spec의 트리 정의와 일치한다", () => {
		expect(POSITIONS.has("GK")).toBe(true);
		expect(POSITIONS.has("CAM")).toBe(true);
		expect(PARENT.CB).toBe("DF");
		expect(PARENT.ST).toBe("FW");
		expect(PARENT.GK).toBeUndefined();
	});

	test("트리는 좌우를 가리지 않는 정확히 이 구성이다(GK / DF>CB,FB,WB / MF>CDM,CM,CAM,SM / FW>WF,ST)", () => {
		expect(Object.fromEntries(Object.entries(PARENT))).toEqual({
			CB: "DF",
			FB: "DF",
			WB: "DF",
			CDM: "MF",
			CM: "MF",
			CAM: "MF",
			SM: "MF",
			WF: "FW",
			ST: "FW",
		});
		expect([...POSITIONS].sort()).toEqual(["CAM", "CB", "CDM", "CM", "DF", "FB", "FW", "GK", "MF", "SM", "ST", "WB", "WF"]);
		for (const old of ["LB", "RB", "LWB", "RWB", "LM", "RM", "LW", "RW", "LF", "RF", "CF"]) expect(POSITIONS.has(old)).toBe(false);
	});
});

describe("positionFromLegacyCode", () => {
	test("옛 좌우 코드는 새 트리의 코드로 한 번에 옮기고, 새 코드는 그대로 둔다", () => {
		expect(LEGACY_POSITION_CODES).toEqual({
			LB: "FB",
			RB: "FB",
			LWB: "WB",
			RWB: "WB",
			LM: "SM",
			RM: "SM",
			LW: "WF",
			RW: "WF",
			LF: "WF",
			RF: "WF",
			CF: "ST",
		});
		for (const [old, now] of Object.entries(LEGACY_POSITION_CODES)) expect(positionFromLegacyCode(old)).toBe(now);
		for (const position of POSITIONS) expect(positionFromLegacyCode(position)).toBe(position);
	});

	test("트리에도 옛 표에도 없는 값은 null이다", () => {
		expect(positionFromLegacyCode("XX")).toBeNull();
		expect(positionFromLegacyCode("센터백")).toBeNull();
		expect(positionFromLegacyCode("")).toBeNull();
	});

	test("positionTagsFromLegacy는 옛 코드를 옮기고 중복을 없애며 모르는 값은 그대로 남긴다", () => {
		expect(positionTagsFromLegacy(["LW", "RW", "CM"])).toEqual(["WF", "CM"]);
		expect(positionTagsFromLegacy(["FB", "LB", "XX"])).toEqual(["FB", "XX"]);
	});
});

describe("positionTargetMembers", () => {
	const roster: Roster = {
		members: [
			{ id: "cb-a", name: "센터백A", gamertag: "CbA", positions: ["CB"], aliases: [] },
			{ id: "cb-b", name: "센터백B", gamertag: "CbB", positions: ["CB"], aliases: [] },
			{ id: "bench", name: "벤치", gamertag: "Bench", positions: ["FB"], aliases: [] },
			{ id: "mid", name: "미드", gamertag: "Mid", positions: ["CM"], aliases: [] },
		],
	};
	const lineup = { "cb-a": "CB", "cb-b": "CB", mid: "CM" };

	test("group_positions에 해당하는 그 경기 출전자를, member_ids는 빼고 돌려준다", () => {
		const unit = { member_ids: ["cb-a"], group_positions: ["DF"] };
		expect(positionTargetMembers(unit, roster, lineup).map((m) => m.id)).toEqual(["cb-b"]);
	});

	test("group_positions가 비면 아무도 없고, 출전하지 않은 명단 수비수(bench)는 들지 않는다", () => {
		expect(positionTargetMembers({ member_ids: [], group_positions: [] }, roster, lineup)).toEqual([]);
		expect(positionTargetMembers({ member_ids: [], group_positions: ["DF"] }, roster, lineup).map((m) => m.id)).toEqual(["cb-a", "cb-b"]);
	});
});

describe("groupMembers", () => {
	const roster: Roster = {
		members: [
			{ id: "cb-a", name: "센터백A", gamertag: "CbA", positions: ["CB"], aliases: [] },
			{ id: "cb-b", name: "센터백B", gamertag: "CbB", positions: ["CB"], aliases: [] },
			{ id: "bench", name: "벤치", gamertag: "Bench", positions: ["FB"], aliases: [] },
			{ id: "mid", name: "미드", gamertag: "Mid", positions: ["CM"], aliases: [] },
		],
	};
	const lineup = { "cb-a": "CB", "cb-b": "CB", mid: "CM" };

	test("group_positions에 해당하는 그 경기 출전자를 member_ids(고칠 사람)까지 포함해 돌려준다 — positionTargetMembers와 달리 빼지 않는다", () => {
		const unit = { member_ids: ["cb-a"], group_positions: ["DF"] };
		expect(groupMembers(unit, roster, lineup).map((m) => m.id)).toEqual(["cb-a", "cb-b"]);
		expect(positionTargetMembers(unit, roster, lineup).map((m) => m.id)).toEqual(["cb-b"]);
	});

	test("group_positions가 비면 아무도 없고, 출전하지 않은 명단 수비수는 들지 않으며, lineup을 모르면(null) 명단 포지션으로 본다", () => {
		expect(groupMembers({ group_positions: [] }, roster, lineup)).toEqual([]);
		expect(groupMembers({ group_positions: ["DF"] }, roster, lineup).map((m) => m.id)).toEqual(["cb-a", "cb-b"]);
		expect(groupMembers({ group_positions: ["DF"] }, roster, null).map((m) => m.id)).toEqual(["cb-a", "cb-b", "bench"]);
	});
});

describe("relatedMembers", () => {
	const roster: Roster = {
		members: [
			{ id: "mention-only", name: "언급만", gamertag: "MentionOnly", positions: ["ST"], aliases: [] },
			{ id: "position-only", name: "포지션만", gamertag: "PositionOnly", positions: ["FB"], aliases: [] },
			{ id: "unrelated", name: "무관", gamertag: "Unrelated", positions: ["GK"], aliases: [] },
		],
	};

	test("member_ids에 직접 언급된 멤버를 포함한다(언급 경로)", () => {
		// WF는 명단의 ST(FW 하위지만 다른 가지)/FB/GK 누구와도 트리상 관련되지 않는 태그다.
		const result = relatedMembers({ member_ids: ["mention-only"], position_tags: ["WF"] }, roster, null);
		expect(result.map((m) => m.id)).toEqual(["mention-only"]);
	});

	test("포지션 트리로 관련된 멤버를 포함한다(포지션 경로)", () => {
		const result = relatedMembers({ member_ids: [], position_tags: ["FB"] }, roster, null);
		expect(result.map((m) => m.id)).toEqual(["position-only"]);
	});

	test("두 경로 모두 해당하면 중복 없이 명단 순서로 반환한다", () => {
		const result = relatedMembers(
			{ member_ids: ["mention-only"], position_tags: ["FB"] },
			roster,
			null,
		);
		expect(result.map((m) => m.id)).toEqual(["mention-only", "position-only"]);
	});

	test("lineup이 있으면 그 경기에 뛴 멤버만, 그 경기 포지션으로 관련을 판단한다", () => {
		// position-only는 명단 LB지만 이 경기에서는 CDM으로 뛰었다. unrelated(명단 GK)는 이 경기 LB였다.
		const lineup = { "position-only": "CDM", unrelated: "FB" };
		expect(relatedMembers({ member_ids: [], position_tags: ["FB"] }, roster, lineup).map((m) => m.id)).toEqual(["unrelated"]);
		expect(relatedMembers({ member_ids: [], position_tags: ["FB"] }, roster, {}).map((m) => m.id)).toEqual([]);
	});

	test("무관한 멤버는 제외한다", () => {
		const result = relatedMembers({ member_ids: [], position_tags: ["FB"] }, roster, null);
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

	test("옛 좌우 포지션 코드(LB/RW 등)는 새 코드로 바꿔 읽고 중복을 없앤다 — 명단은 옛 파일을 고칠 수 없다", () => {
		const result = parseRoster(`
members:
  - id: player-a
    name: A
    gamertag: A1
    positions: [LW, RW, CM]
  - id: player-b
    name: B
    gamertag: B1
    positions: [RB, LWB, CF, LM]
`);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.members[0].positions).toEqual(["WF", "CM"]);
		expect(result.value.members[1].positions).toEqual(["FB", "WB", "ST", "SM"]);
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

	test("source가 없는 옛 줄은 음성 줄로 읽고, 댓글 줄은 작성자 handle을 함께 남긴다", () => {
		const raw = [
			{ i: 0, video: "AAAAAAAAAAA", start: 0, end: 5, text: "a" },
			{ i: 1, video: "AAAAAAAAAAA", start: 6, end: 9, text: "b", source: "comment", author: "@석상용-h2t" },
		];
		const result = checkLines(raw, session);
		expect(result.errors).toEqual([]);
		expect(result.value.map((line) => [line.source, line.source === "comment" ? line.author : null])).toEqual([
			["speech", null],
			["comment", "@석상용-h2t"],
		]);
	});

	test("댓글 줄에 author가 없거나 source가 알 수 없는 값이면 경로 에러를 낸다", () => {
		const raw = [
			{ i: 0, video: "AAAAAAAAAAA", start: 0, end: 5, text: "a", source: "comment" },
			{ i: 1, video: "AAAAAAAAAAA", start: 6, end: 9, text: "b", source: "chat" },
		];
		const result = checkLines(raw, session);
		expect(findError(result.errors, "[0].author")).toBe(true);
		expect(findError(result.errors, "[1].source")).toBe(true);
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

	test("댓글 시각 후보(kind comment)를 받아들인다", () => {
		const result = checkCandidates([{ id: "c001", video: "AAAAAAAAAAA", t: 468, kind: "comment" }]);
		expect(result.errors).toEqual([]);
		expect(result.value[0].kind).toBe("comment");
	});

	test("scan-range가 쓰는 kind range를 받아들이고, range에 dur를 쓰면 [n].dur 경로 에러를 낸다", () => {
		const ok = checkCandidates([{ id: "c001", video: "AAAAAAAAAAA", t: 12, kind: "range" }]);
		expect(ok.errors).toEqual([]);
		expect(ok.value[0].kind).toBe("range");
		const withDur = checkCandidates([{ id: "c001", video: "AAAAAAAAAAA", t: 12, kind: "range", dur: 2 }]);
		expect(findError(withDur.errors, "[0].dur")).toBe(true);
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
		recurring: [],
		matches_without_feedback: [],
		matches: [
			{
				title: "1경기",
				lineup: { "hong-gildong": "CB" },
				topics: [
					{
						title: "빌드업 문제",
						summary: "후방 빌드업이 불안정했다",
						units: [
							{
								start_line: 0,
								end_line: 1,
								title: "센터백: 라인 올리기",
								position_tags: ["CB"],
								topic_tags: ["빌드업"],
								member_ids: ["hong-gildong"],
								key_frame_candidate_ids: ["c001"],
								group_positions: [],
							},
							{
								start_line: 2,
								end_line: 2,
								title: "골키퍼: 짧게 배급하기",
								position_tags: ["GK"],
								topic_tags: ["탈압박"],
								member_ids: [],
								key_frame_candidate_ids: ["c002"],
								group_positions: [],
							},
						],
					},
				],
			},
		],
		proposed_tags: [],
	};
}

describe("namedMemberIds / validated.units[].named_member_ids", () => {
	const roster: Roster = {
		members: [
			{ id: "a", name: "동그리", gamertag: "toongri", positions: ["CM"], aliases: ["동글"] },
			{ id: "b", name: "뎁스차저", gamertag: "DepthCharger", positions: ["ST"], aliases: [] },
			{ id: "c", name: "무명", gamertag: "Nobody", positions: ["GK"], aliases: [] },
		],
	};

	test("이름·별칭·게이머태그가 줄 text에 있으면 로스터 순서로 id를 돌려준다(조사 붙어도, 라틴 대소문자 무시)", () => {
		const lines = [{ text: "동그리와 뎁스차저의 거리가 벌어짐" }, { text: "depthcharger 쪽은 괜찮음" }];
		expect(namedMemberIds(lines, roster)).toEqual(["a", "b"]);
		expect(namedMemberIds([{ text: "동글이가 내려옴" }], roster)).toEqual(["a"]);
		expect(namedMemberIds([{ text: "TOONGRI 압박" }], roster)).toEqual(["a"]);
	});

	test("댓글 author는 보지 않고 text만 본다", () => {
		const lines = [{ text: "거리가 벌어짐", author: "@뎁스차저" }];
		expect(namedMemberIds(lines, roster)).toEqual([]);
	});

	test("로스터가 없으면 빈 배열이다", () => {
		expect(namedMemberIds([{ text: "동그리" }], null)).toEqual([]);
	});

	test("checkPlan은 unit의 줄 범위에서 계산한 named_member_ids를 validated에 싣는다(member_ids와 별개)", () => {
		const lines = fixtureLines.map((line, i) => (i === 1 ? { ...line, text: "김철수와 홍길동의 거리" } : line));
		const result = checkPlan(makeValidPlan(), { ...fixtureContext, lines });
		expect(result.errors).toEqual([]);
		expect(result.validated.units[0].member_ids).toEqual(["hong-gildong"]);
		expect(result.validated.units[0].named_member_ids).toEqual(["hong-gildong", "kim-cheolsu"]);
		expect(result.validated.units[1].named_member_ids).toEqual([]);
	});

	test("plan.json이 named_member_ids를 직접 써도 무시한다(스크립트 계산값만 쓴다)", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[1].named_member_ids = ["kim-cheolsu"];
		expect(checkPlan(plan, fixtureContext).validated.units[1].named_member_ids).toEqual([]);
	});
});

describe("checkPlan — matches_without_feedback(피드백 없는 경기)", () => {
	const withField = (value: unknown): any => ({ ...makeValidPlan(), matches_without_feedback: value });

	test("필드가 없으면 matches_without_feedback: []를 추가하라는 안내와 함께 에러를 낸다", () => {
		const plan = makeValidPlan();
		delete plan.matches_without_feedback;
		const error = checkPlan(plan, fixtureContext).errors.find((e) => e.path === "matches_without_feedback");
		expect(error?.message).toContain('"matches_without_feedback": []');
	});

	test("빈 배열은 허용하고, 제목은 validated와 table에 그대로 실린다", () => {
		expect(checkPlan(withField([]), fixtureContext).validated.matches_without_feedback).toEqual([]);
		const result = checkPlan(withField(["2경기 · LVT 대 AL"]), fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.matches_without_feedback).toEqual(["2경기 · LVT 대 AL"]);
		expect(result.tableMd).toContain("피드백 없는 경기:\n- 2경기 · LVT 대 AL");
	});

	test("배열이 아니거나 항목이 빈 문자열·문자열이 아님·80자 초과면 그 경로 에러다", () => {
		expect(findError(checkPlan(withField("2경기"), fixtureContext).errors, "matches_without_feedback")).toBe(true);
		expect(findError(checkPlan(withField(["  "]), fixtureContext).errors, "matches_without_feedback[0]")).toBe(true);
		expect(findError(checkPlan(withField([3]), fixtureContext).errors, "matches_without_feedback[0]")).toBe(true);
		expect(findError(checkPlan(withField(["가".repeat(81)]), fixtureContext).errors, "matches_without_feedback[0]")).toBe(true);
		expect(checkPlan(withField(["가".repeat(80)]), fixtureContext).errors).toEqual([]);
	});
});

describe("recurringInferredActorWarnings — 반복 지적의 사람이 연결 유닛에서 추정한 행위자인 경우", () => {
	function planWith(inferred: string[], memberIds: string[]): ValidatedPlan {
		const plan = makeValidPlan();
		plan.recurring = [{ label: "반대편을 보지 않음", lines: [0, 2], member_ids: [] }];
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		const validated: ValidatedPlan = result.validated;
		validated.units[0].inferred_member_ids = inferred;
		validated.recurring[0].member_ids = memberIds;
		return validated;
	}

	test("recurring member_ids의 사람이 연결 유닛의 inferred_member_ids에 있으면 유닛마다 경고한다", () => {
		const validated = planWith(["hong-gildong"], ["hong-gildong"]);
		const unitId = validated.recurring[0].unit_ids[0];
		expect(validated.units.find((unit) => unit.id === unitId)?.inferred_member_ids).toEqual(["hong-gildong"]);
		expect(recurringInferredActorWarnings(validated, fixtureRoster)).toEqual([`fc-feedback: 경고 반복 지적 반대편을 보지 않음: 홍길동는 ${unitId}에서 추정한 행위자다`]);
	});

	test("추정이 아니거나 recurring member_ids에 없으면 경고하지 않는다", () => {
		expect(recurringInferredActorWarnings(planWith([], ["hong-gildong"]), fixtureRoster)).toEqual([]);
		expect(recurringInferredActorWarnings(planWith(["hong-gildong"], []), fixtureRoster)).toEqual([]);
		expect(recurringInferredActorWarnings(planWith(["kim-cheolsu"], ["hong-gildong"]), fixtureRoster)).toEqual([]);
	});
});

describe("recurringCandidateWarnings — 같은 행위자·공통어 반복 지적 후보", () => {
	function validatedWith(titles: [string, string], recurring: unknown = []): ValidatedPlan {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].title = titles[0];
		plan.matches[0].topics[0].units[1].title = titles[1];
		plan.recurring = recurring;
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		return result.validated;
	}

	test("같은 행위자의 두 유닛이 내용어 '반대편'을 공유하면 후보 경고를 한 줄 낸다(조사 이나는 뗀다)", () => {
		const validated = validatedWith(["뎁스차저: 동그리 위치 보고 뒤로 끌거나 반대편 보기", "뎁스차저: 반대편이나 두두 보기"]);
		expect(recurringCandidateWarnings(validated)).toEqual([
			'fc-feedback: 경고 반복 지적 후보 u001·u002 "뎁스차저" 공통어 "반대편", "보기" — 같은 잘못이면 recurring에 묶는다',
		]);
	});

	test("둘이 이미 한 recurring 항목에 있으면 경고하지 않는다", () => {
		const validated = validatedWith(
			["뎁스차저: 동그리 위치 보고 뒤로 끌거나 반대편 보기", "뎁스차저: 반대편이나 두두 보기"],
			[{ label: "반대편을 보지 않음", lines: [0, 2], member_ids: [] }],
		);
		expect(recurringCandidateWarnings(validated)).toEqual([]);
	});

	test("행위자가 다르거나 공통어가 없거나 불용어·한 음절뿐이면 경고하지 않는다", () => {
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 반대편 보기", "동그리: 반대편 보기"]))).toEqual([]);
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 뒤로 빼기", "뎁스차저: 앞으로 올리기"]))).toEqual([]);
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 더 벌리기", "뎁스차저: 더 올라가기"]))).toEqual([]);
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 무리하게 가로채지 않기", "뎁스차저: 무리하게 전진하지 않기"]))).toEqual([]);
	});

	test("A·B 행위자는 이름별로 나눠 비교하고, 한 유닛의 여러 조각 중 맞는 조각을 본다", () => {
		const validated = validatedWith(["동그리·뎁스차저: 압박 때 간격 좁히기", "수비 라인: 뒷공간을 내줌 / 뎁스차저: 간격을 벌림"]);
		expect(recurringCandidateWarnings(validated)).toEqual([
			'fc-feedback: 경고 반복 지적 후보 u001·u002 "뎁스차저" 공통어 "간격" — 같은 잘못이면 recurring에 묶는다',
		]);
	});
});

describe("recurringCandidateWarnings — 잡음 거르기(명단 이름·조건절·패스하기)와 공통어 전체 나열", () => {
	const ROSTER: Roster = { members: [{ id: "dongri", name: "동그리", gamertag: "toongri", positions: ["CM"], aliases: ["동글"] }] };
	function validatedWith(titles: [string, string]): ValidatedPlan {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].title = titles[0];
		plan.matches[0].topics[0].units[1].title = titles[1];
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		return result.validated;
	}

	test("명단 이름·별칭은 공통어로 세지 않는다(roster를 주지 않으면 센다)", () => {
		const validated = validatedWith(["뎁스차저: 동그리와 동글 보기", "뎁스차저: 동그리가 동글 따라가기"]);
		expect(recurringCandidateWarnings(validated, ROSTER)).toEqual([]);
		expect(recurringCandidateWarnings(validated)).toEqual([
			'fc-feedback: 경고 반복 지적 후보 u001·u002 "뎁스차저" 공통어 "동그리", "동글" — 같은 잘못이면 recurring에 묶는다',
		]);
	});

	test("-면·-때 조건절 낱말과 '패스하기'는 공통어로 세지 않지만, '측면' 같은 명사는 센다", () => {
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 잡으면 위로 패스하기", "뎁스차저: 잡으면 빠르게 패스하기"]))).toEqual([]);
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 공이 올 때 한 발 나가기", "뎁스차저: 공을 줄때 한 발 비키기"]))).toEqual([]);
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 받았을 때 위로 물러서기", "뎁스차저: 했을 때 아래 내려가기"]))).toEqual([]);
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 측면 지키기", "뎁스차저: 측면 벌리기"]))).toEqual([
			'fc-feedback: 경고 반복 지적 후보 u001·u002 "뎁스차저" 공통어 "측면" — 같은 잘못이면 recurring에 묶는다',
		]);
	});

	test("공통어가 여럿이면 정렬해 모두 나열한다", () => {
		expect(recurringCandidateWarnings(validatedWith(["뎁스차저: 위치 간격 좁히기", "뎁스차저: 간격 위치 벌리기"]))).toEqual([
			'fc-feedback: 경고 반복 지적 후보 u001·u002 "뎁스차저" 공통어 "간격", "위치" — 같은 잘못이면 recurring에 묶는다',
		]);
	});
});

describe("searchKeywordWords / rosterLabelIn — 검색 키워드 정리", () => {
	const roster: Roster = {
		members: [
			{ id: "dep", name: "뎁스차저", gamertag: "DepthCharger", positions: ["ST"], aliases: ["뎁차"] },
			{ id: "dong", name: "동그리", gamertag: "toongri", positions: ["CM"], aliases: [] },
		],
	};

	test("명단 이름·별칭·게이머태그가 든 낱말(조사 붙은 꼴, 대소문자 무시)을 버린다", () => {
		expect(searchKeywordWords("뎁스차저가 동그리에게 패스 depthcharger", roster)).toEqual(["패스"]);
		expect(rosterLabelIn("라인 뎁차가", roster)).toBe("뎁차");
		expect(rosterLabelIn("라인 간격", roster)).toBeUndefined();
		expect(rosterLabelIn("뎁스차저", null)).toBeUndefined();
	});

	test("끝 조사를 떼고(남는 글자 2자 이상일 때만), 조건절(-면·-때) 낱말과 한 글자 낱말을 버린다", () => {
		expect(searchKeywordWords("뎁스차저가 잡으면 라인이 간격을 안 좁힐 때 올라가기", roster)).toEqual(["라인", "간격", "좁힐", "올라가기"]);
		expect(searchKeywordWords("측면 지키기", null)).toEqual(["측면", "지키기"]);
		expect(searchKeywordWords("pro clubs 수비 라인", null)).toEqual(["pro", "clubs", "수비", "라인"]);
	});
});

describe("checkPlan — 시간 순서와 topic (떨어진 유닛 묶기)", () => {
	// fixtureLines: 0·1·2는 video A, 3·4는 video B. 유닛 하나 = 줄 하나.
	function unitAt(line: number, title: string, extra: object = {}): any {
		return {
			start_line: line,
			end_line: line,
			title,
			position_tags: ["CB"],
			topic_tags: ["빌드업"],
			member_ids: [],
			key_frame_candidate_ids: [],
			group_positions: [],
			...extra,
		};
	}
	function planWithTopics(topicLines: number[][]): any {
		const plan = makeValidPlan();
		plan.matches[0].topics = topicLines.map((lines, index) => ({
			title: `주제 ${index + 1}`,
			summary: "요약",
			units: lines.map((line) => unitAt(line, `센터백: ${line}번 줄 패스하기`)),
		}));
		return plan;
	}

	test("한 topic이 떨어진 유닛을 묶을 수 있고, 유닛 id는 시간 순서(u001이 가장 이른 유닛)로 매긴다", () => {
		const result = checkPlan(planWithTopics([[0, 2], [1]]), fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.units.map((u) => [u.id, u.topic_id, u.start])).toEqual([
			["u001", "m1-t1", 0],
			["u002", "m1-t2", 10],
			["u003", "m1-t1", 20],
		]);
		expect(result.validated.matches[0].topics.map((t) => t.unit_ids)).toEqual([["u001", "u003"], ["u002"]]);
	});

	test("recurring unit_ids도 시간 순서이고, topic 순서가 시간과 달라도 같은 줄은 같은 유닛이다", () => {
		const plan = planWithTopics([[2], [0, 1]]);
		plan.recurring = [{ label: "패스 미스", lines: [2, 0], member_ids: [] }];
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.recurring[0].unit_ids).toEqual(["u001", "u003"]);
		expect(result.validated.units.find((u) => u.id === "u003")?.topic_id).toBe("m1-t1");
	});

	test("한 topic 안에서 유닛이 내림차순이면 start_line 경로 에러를 낸다", () => {
		const result = checkPlan(planWithTopics([[2, 0]]), fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[1].start_line")).toBe(true);
	});

	test("다른 topic의 유닛과도 같은 video 안에서 겹치면 겹친 쪽 start_line 경로 에러를 낸다", () => {
		const plan = planWithTopics([[0, 2], [1]]);
		plan.matches[0].topics[0].units[0].end_line = 1; // 0..1 이 topic 2의 1..1과 겹침
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors.map((e) => e.path)).toEqual(["matches[0].topics[1].units[0].start_line"]);
	});

	test("다른 video의 유닛은 topic이 달라도 겹침이 아니다", () => {
		expect(checkPlan(planWithTopics([[0, 3], [1, 4]]), fixtureContext).errors).toEqual([]);
	});
});

describe("checkPlan — recurring(반복 지적)", () => {
	function withRecurring(recurring: unknown): any {
		const plan = makeValidPlan();
		plan.recurring = recurring;
		return plan;
	}

	test("recurring이 없으면 recurring: []를 추가하라는 안내와 함께 에러를 낸다", () => {
		const plan = makeValidPlan();
		delete plan.recurring;
		const error = checkPlan(plan, fixtureContext).errors.find((e) => e.path === "recurring");
		expect(error?.message).toContain('"recurring": []');
	});

	test("빈 배열은 허용하고 validated.recurring도 빈 배열이다", () => {
		const result = checkPlan(withRecurring([]), fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.recurring).toEqual([]);
	});

	test("서로 다른 unit에 걸친 줄 2개는 통과하고 unit_ids를 문서 순서로 담는다", () => {
		const result = checkPlan(withRecurring([{ label: "수비 라인이 맞지 않음", lines: [2, 0], member_ids: [] }]), fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.recurring).toEqual([{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u002"], member_ids: [] }]);
	});

	describe("주인 검사 — 제목 행위자가 전부 팀원인 유닛의 고칠 사람이 member_ids에 있어야 한다", () => {
		/** u001 제목·고칠 사람을 바꾼 plan(u002는 비-팀원 행위자 "골키퍼", 고칠 사람 없음). */
		function planWithU001(title: string, memberIds: string[], recurringMemberIds: string[]): any {
			const plan = makeValidPlan();
			Object.assign(plan.matches[0].topics[0].units[0], { title, member_ids: memberIds });
			plan.recurring = [{ label: "상대 마크를 놓침", lines: [0, 2], member_ids: recurringMemberIds }];
			return plan;
		}
		const recurringErrors = (plan: unknown) => checkPlan(plan, fixtureContext).errors.filter((e) => e.path.startsWith("recurring"));

		test("행위자가 전부 팀원이고 유닛 고칠 사람이 있는데 항목 member_ids에 하나도 없으면 에러다(member_ids가 []여도)", () => {
			const empty = recurringErrors(planWithU001("홍길동: 마크를 놓침", ["hong-gildong"], []));
			expect(empty.map((e) => e.path)).toEqual(["recurring[0].member_ids"]);
			expect(empty[0].message).toBe("recurring '상대 마크를 놓침': u001의 고칠 사람 홍길동이 member_ids에 없다");
			// 항목 주인이 다른 유닛(u002)의 고칠 사람이어도 u001의 고칠 사람이 빠졌으면 에러다.
			const other = planWithU001("홍길동: 마크를 놓침", ["hong-gildong"], ["kim-cheolsu"]);
			other.matches[0].lineup["kim-cheolsu"] = "GK";
			other.matches[0].topics[0].units[1].member_ids = ["kim-cheolsu"];
			expect(recurringErrors(other).map((e) => e.message)).toEqual(["recurring '상대 마크를 놓침': u001의 고칠 사람 홍길동이 member_ids에 없다"]);
		});

		test("항목 member_ids에 그 유닛의 고칠 사람이 하나라도 있으면 통과한다", () => {
			expect(recurringErrors(planWithU001("홍길동: 마크를 놓침", ["hong-gildong"], ["hong-gildong"]))).toEqual([]);
		});

		test("제목에 팀원이 아닌 행위자(수비진·수비 라인·전원)가 있는 유닛은 면제다", () => {
			for (const title of ["수비진: 마크를 놓침", "수비 라인: 맞지 않음 / 홍길동: 정신 놓음", "홍길동·전원: 마크를 놓침"]) {
				expect(recurringErrors(planWithU001(title, ["hong-gildong"], []))).toEqual([]);
			}
		});

		test("유닛의 member_ids가 비어 있으면 면제다(게이머태그로 쓴 제목도 팀원으로 본다)", () => {
			expect(recurringErrors(planWithU001("홍길동: 마크를 놓침", [], []))).toEqual([]);
			const gamertag = recurringErrors(planWithU001("HongGD: 마크를 놓침", ["hong-gildong"], []));
			expect(gamertag.map((e) => e.path)).toEqual(["recurring[0].member_ids"]);
		});
	});

	describe("같은 제목 조각의 공동 행위자 검사 — 항목 주인이 든 조각의 팀원 행위자는 모두 member_ids에 있어야 한다", () => {
		/** u001 제목 조각 행위자에 홍길동·김철수를 함께 둔 plan. 항목 member_ids만 바꿔 본다. */
		function planWithSharedSegment(title: string, recurringMemberIds: string[]): any {
			const plan = makeValidPlan();
			Object.assign(plan.matches[0].topics[0].units[0], { title, member_ids: ["hong-gildong", "kim-cheolsu"] });
			plan.matches[0].lineup["kim-cheolsu"] = "GK";
			plan.recurring = [{ label: "수비 라인이 맞지 않음", lines: [0, 2], member_ids: recurringMemberIds }];
			return plan;
		}
		// 두 사람이 모두 고칠 사람인 유닛이라 기존 '주인 누락' 검사도 같은 경로에 걸린다 — 이 검사의 메시지("함께 묶인")만 본다.
		const coActorErrors = (plan: unknown) => checkPlan(plan, fixtureContext).errors.filter((e) => e.path.startsWith("recurring") && e.message.includes("함께 묶인"));

		test("조각 행위자 'A·B'에서 A만 member_ids에 있으면 빠진 B를 이름으로 든 에러를 낸다", () => {
			const errors = coActorErrors(planWithSharedSegment("홍길동·김철수: 슈퍼 캔슬로 위치 조정하기", ["hong-gildong"]));
			expect(errors.map((e) => e.path)).toEqual(["recurring[0].member_ids"]);
			expect(errors[0].message).toBe('recurring \'수비 라인이 맞지 않음\': u001의 제목 조각 "홍길동·김철수"에서 함께 묶인 김철수가 member_ids에 없다');
		});

		test("조각 행위자 전원이 member_ids에 있으면 통과한다", () => {
			expect(coActorErrors(planWithSharedSegment("홍길동·김철수: 슈퍼 캔슬로 위치 조정하기", ["hong-gildong", "kim-cheolsu"]))).toEqual([]);
		});

		test("항목 member_ids에 그 조각의 행위자가 하나도 없으면(주인 아님) 이 검사는 하지 않는다", () => {
			expect(coActorErrors(planWithSharedSegment("홍길동·김철수: 슈퍼 캔슬로 위치 조정하기", []))).toEqual([]);
		});

		test("다른 조각에만 있는 팀원, 팀원이 아닌 행위자는 요구하지 않는다", () => {
			expect(coActorErrors(planWithSharedSegment("홍길동: 더 벌리기 / 김철수: 라인 올리기", ["hong-gildong"]))).toEqual([]);
			expect(coActorErrors(planWithSharedSegment("홍길동·수비진: 위치 조정하기", ["hong-gildong"]))).toEqual([]);
		});

		test("별칭·게이머태그로 쓴 행위자도 같은 이름 매칭으로 팀원이 된다", () => {
			const errors = coActorErrors(planWithSharedSegment("홍길동·KimCS: 슈퍼 캔슬로 위치 조정하기", ["hong-gildong"]));
			expect(errors.map((e) => e.message)).toEqual(['recurring \'수비 라인이 맞지 않음\': u001의 제목 조각 "홍길동·KimCS"에서 함께 묶인 김철수가 member_ids에 없다']);
		});
	});

	test("member_ids는 묶인 유닛 중 하나 이상에서 고칠 사람인 명단 id만 담고, 아니면 member_ids 경로 에러다", () => {
		const plan = withRecurring([{ label: "패스 미스", lines: [0, 2], member_ids: ["kim-cheolsu"] }]);
		expect(findError(checkPlan(plan, fixtureContext).errors, "recurring[0].member_ids")).toBe(true);
		plan.recurring[0].member_ids = ["hong-gildong"];
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.recurring[0].member_ids).toEqual(["hong-gildong"]);
		const missing = withRecurring([{ label: "필드 없음", lines: [0, 2] }]);
		expect(findError(checkPlan(missing, fixtureContext).errors, "recurring[0].member_ids")).toBe(true);
	});

	test("tableMd 끝에 반복 지적 구역이 label·횟수·unit 시각으로 붙는다", () => {
		const result = checkPlan(withRecurring([{ label: "수비 라인이 맞지 않음", lines: [0, 2], member_ids: [] }]), fixtureContext);
		expect(result.tableMd).toContain("반복 지적:\n- 수비 라인이 맞지 않음 ×2 (0:00, 0:20)");
	});

	test("같은 unit 안의 두 줄은 lines 경로 에러다", () => {
		const result = checkPlan(withRecurring([{ label: "중복", lines: [0, 1], member_ids: [] }]), fixtureContext);
		expect(findError(result.errors, "recurring[0].lines[1]")).toBe(true);
	});

	test("줄이 2개 미만이면 lines 경로 에러다", () => {
		const result = checkPlan(withRecurring([{ label: "하나뿐", lines: [0], member_ids: [] }]), fixtureContext);
		expect(findError(result.errors, "recurring[0].lines")).toBe(true);
	});

	test("범위 밖·비정수 줄 인덱스는 에러다", () => {
		const result = checkPlan(withRecurring([{ label: "범위 밖", lines: [0, 999, 1.5], member_ids: [] }]), fixtureContext);
		expect(findError(result.errors, "recurring[0].lines[1]")).toBe(true);
		expect(findError(result.errors, "recurring[0].lines[2]")).toBe(true);
	});

	test("어떤 unit에도 속하지 않는 줄은 에러다", () => {
		const plan = withRecurring([{ label: "미소속", lines: [0, 2], member_ids: [] }]);
		plan.matches[0].topics[0].units.pop(); // line 2를 덮던 두 번째 unit 제거
		expect(findError(checkPlan(plan, fixtureContext).errors, "recurring[0].lines[1]")).toBe(true);
	});

	test("label은 비어 있거나 여러 줄이거나 40자를 넘거나 중복이면 에러다", () => {
		const result = checkPlan(
			withRecurring([
				{ label: " ", lines: [0, 2], member_ids: [] },
				{ label: "두\n줄", lines: [0, 2], member_ids: [] },
				{ label: "가".repeat(41), lines: [0, 2], member_ids: [] },
				{ label: "같은 이름", lines: [0, 2], member_ids: [] },
				{ label: "같은 이름", lines: [0, 2], member_ids: [] },
			]),
			fixtureContext,
		);
		for (const path of ["recurring[0].label", "recurring[1].label", "recurring[2].label", "recurring[4].label"]) {
			expect(findError(result.errors, path)).toBe(true);
		}
		expect(findError(result.errors, "recurring[3].label")).toBe(false);
	});
});

describe("checkPlan", () => {
	test("validated unit은 줄 범위 안 댓글 작성자 handle을 처음 나온 순서대로 중복 없이 담는다", () => {
		const raw = makeRawLines();
		raw[0] = { ...raw[0], source: "comment", author: "@a" };
		raw[1] = { ...raw[1], source: "comment", author: "@b" };
		raw[2] = { ...raw[2], source: "comment", author: "@a" };
		const lines = checkLines(raw, fixtureSession).value;
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units = [{ ...plan.matches[0].topics[0].units[0], start_line: 0, end_line: 2 }];
		const result = checkPlan(plan, { ...fixtureContext, lines });
		expect(result.errors).toEqual([]);
		expect(result.validated.units[0].comment_authors).toEqual(["@a", "@b"]);
	});

	test("음성 줄만 있는 unit의 comment_authors는 빈 배열이다", () => {
		const result = checkPlan(makeValidPlan(), fixtureContext);
		expect(result.validated.units.map((unit) => unit.comment_authors)).toEqual([[], []]);
	});

	test("validated unit은 plan의 start_line..end_line을 line_range로 남긴다", () => {
		const result = checkPlan(makeValidPlan(), fixtureContext);
		expect(result.validated.units.map((unit) => unit.line_range)).toEqual([
			{ start_line: 0, end_line: 1 },
			{ start_line: 2, end_line: 2 },
		]);
	});

	test("unitLines는 시간이 겹쳐도 line_range 밖 줄을 넣지 않고, line_range가 없는 옛 unit은 시간 범위로 고른다", () => {
		// 15초짜리 댓글 줄(0)이 다른 유닛의 짧은 음성 줄(1)을 시간상 감싼다.
		const lines: Line[] = [
			{ i: 0, video: "AAAAAAAAAAA", start: 10, end: 25, text: "댓글", source: "comment", author: "@a" },
			{ i: 1, video: "AAAAAAAAAAA", start: 12, end: 14, text: "해설", source: "speech" },
		];
		const unit = { ...checkPlan(makeValidPlan(), fixtureContext).validated.units[0], video: "AAAAAAAAAAA", start: 10, end: 25 };
		expect(unitLines({ ...unit, line_range: { start_line: 0, end_line: 0 } }, lines).map((line) => line.i)).toEqual([0]);
		expect(unitLines({ ...unit, line_range: null }, lines).map((line) => line.i)).toEqual([0, 1]);
	});

	test("명단이 있으면 matches[].lineup이 필요하고, 키는 명단 id·값은 포지션 트리의 포지션이어야 한다", () => {
		const paths = (lineup: unknown) => {
			const plan = makeValidPlan();
			plan.matches[0].lineup = lineup;
			return checkPlan(plan, fixtureContext)
				.errors.map((e) => e.path)
				.filter((path) => path.startsWith("matches[0].lineup"));
		};
		expect(paths({ "hong-gildong": "CB" })).toEqual([]);
		expect(paths(undefined)).toEqual(["matches[0].lineup"]);
		expect(paths({ nobody: "CB" })).toEqual(["matches[0].lineup.nobody"]);
		expect(paths({ "hong-gildong": "센터백" })).toEqual(["matches[0].lineup.hong-gildong"]);
		const plan = makeValidPlan();
		plan.matches[0].lineup = { "hong-gildong": "CB" };
		expect(checkPlan(plan, fixtureContext).validated.matches[0].lineup).toEqual({ "hong-gildong": "CB" });
	});

	test("고칠 사람(member_ids)이 그 경기 lineup에 없으면 그 member_ids 경로 에러다", () => {
		const plan = makeValidPlan();
		plan.matches[0].lineup = {};
		expect(checkPlan(plan, fixtureContext).errors.map((e) => e.path)).toEqual(["matches[0].topics[0].units[0].member_ids[0]"]);
	});

	test("group_positions는 position_tags 안의 포지션만 담는다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].group_positions = ["DF"];
		expect(findError(checkPlan(plan, fixtureContext).errors, "matches[0].topics[0].units[0].group_positions[0]")).toBe(true);
		plan.matches[0].topics[0].units[0].position_tags = ["DF", "CB"];
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.units[0].group_positions).toEqual(["DF"]);
	});

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
			"| 1경기 | 0:00 | 센터백: 라인 올리기 | CB | 빌드업 | 홍길동 |",
			"| 1경기 | 0:20 | 골키퍼: 짧게 배급하기 | GK | 탈압박 | - |",
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

	test("옛 좌우 포지션 코드는 새 작성에서 에러이고 메시지가 바꿀 코드를 말한다(position_tags·group_positions·lineup)", () => {
		const plan = makeValidPlan();
		const unit = plan.matches[0].topics[0].units[0];
		unit.position_tags = ["RB"];
		unit.group_positions = ["LWB"];
		plan.matches[0].lineup = { "hong-gildong": "CF" };
		const { errors } = checkPlan(plan, fixtureContext);
		const message = (path: string) => errors.find((error) => error.path === path)?.message;
		expect(message("matches[0].topics[0].units[0].position_tags[0]")).toBe("RB는 더 이상 쓰지 않는 포지션 코드다 — FB로 쓴다(좌우를 가리지 않는다)");
		expect(message("matches[0].topics[0].units[0].group_positions[0]")).toBe("LWB는 더 이상 쓰지 않는 포지션 코드다 — WB로 쓴다(좌우를 가리지 않는다)");
		expect(message("matches[0].lineup.hong-gildong")).toBe("CF는 더 이상 쓰지 않는 포지션 코드다 — ST로 쓴다(좌우를 가리지 않는다)");
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

	test("addressed_to_all이 없으면 false로 취급한다(옛 plan 호환)", () => {
		const plan = makeValidPlan();
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.units[0].addressed_to_all).toBe(false);
	});

	test("addressed_to_all이 true면 통과하고 validated에 반영한다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].addressed_to_all = true;
		const result = checkPlan(plan, fixtureContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.units[0].addressed_to_all).toBe(true);
	});

	test("addressed_to_all이 boolean이 아니면 addressed_to_all 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].addressed_to_all = "true";
		const result = checkPlan(plan, fixtureContext);
		expect(findError(result.errors, "matches[0].topics[0].units[0].addressed_to_all")).toBe(true);
	});

	test("addressed_to_all: true인 유닛에 group_positions가 있으면 유닛 id를 짚는 에러를 낸다", () => {
		const plan = makeValidPlan();
		const unit = plan.matches[0].topics[0].units[0];
		unit.addressed_to_all = true;
		unit.group_positions = [unit.position_tags[0]];
		const errors = checkPlan(plan, fixtureContext).errors.filter((e) => e.path === "matches[0].topics[0].units[0].group_positions");
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("fc-feedback:");
		expect(errors[0].message).toContain("전원 대상(addressed_to_all) 유닛은 group_positions가 비어야 합니다");
		expect(errors[0].message).toContain("u001");
		unit.group_positions = [];
		expect(checkPlan(plan, fixtureContext).errors).toEqual([]);
	});

	test("unit 제목이 `행위자: ~기` 꼴이 아니면 title 경로 에러를 낸다(조각마다)", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].title = "뎁스차저: 더 벌렸다 / 동그리: 더 올라가기";
		plan.matches[0].topics[0].units[1].title = "골키퍼 배급";
		const result = checkPlan(plan, fixtureContext);
		const first = result.errors.filter((e) => e.path === "matches[0].topics[0].units[0].title");
		expect(first.length).toBe(1);
		expect(first[0].message).toContain("뎁스차저: 더 벌렸다");
		expect(findError(result.errors, "matches[0].topics[0].units[1].title")).toBe(true);
	});

	test("제목 조각은 `~기`(할 일) 또는 -ㅁ 받침 명사형(지적)으로 끝나고, 끝 괄호 한 개는 떼고 본다", () => {
		for (const ok of [
			"뎁스차저: 첫판부터 정신 놓음",
			"동그리: 뒷공간을 노출함",
			"수비 라인: 뒷공간을 내줌",
			"뎁스차저: 혼자 오프사이드 트랩 걸지 말고 뒤로 빼기(아직까진)",
			"뎁스차저: 첫판부터 정신 놓음(아직까진) / 동그리: 더 올라가기",
		]) {
			expect(unitTitleFormErrors(ok)).toEqual([]);
		}
		for (const bad of ["뎁스차저: 더 벌렸다", "뎁스차저: 정신 놓았다", "뎁스차저: 정신 놓음(유보) 이후", "뎁스차저: (아직까진)"]) {
			expect(unitTitleFormErrors(bad)).toHaveLength(1);
		}
		const message = unitTitleFormErrors("뎁스차저: 정신 놓았다")[0];
		expect(message).toContain("뎁스차저: 더 벌리기");
		expect(message).toContain("뎁스차저: 첫판부터 정신 놓음");
	});

	test("할 일 꼴 조각을 \" / \"로 이은 제목은 통과한다", () => {
		expect(unitTitleFormErrors("뎁스차저: 무리하게 가로채지 않기 / 동그리·쿠쿠: 더 올라가기")).toEqual([]);
		expect(unitTitleFormErrors("동그리 더 올라가기")).toHaveLength(1);
		expect(unitTitleFormErrors(": 더 올라가기")).toHaveLength(1);
	});

	test("member_ids·position_tags가 비고 addressed_to_all이 아니면 unit 경로에 대상 없음 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[1].position_tags = [];
		const result = checkPlan(plan, fixtureContext);
		const errors = result.errors.filter((e) => e.path === "matches[0].topics[0].units[1]");
		expect(errors.some((e) => e.message.includes("대상이 없습니다"))).toBe(true);
		plan.matches[0].topics[0].units[1].addressed_to_all = true;
		expect(checkPlan(plan, fixtureContext).errors).toEqual([]);
	});

	test("roster가 null(disabled)이어도 addressed_to_all: true는 허용한다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].member_ids = [];
		plan.matches[0].topics[0].units[0].addressed_to_all = true;
		plan.matches[0].topics[0].units[1].member_ids = [];
		plan.matches[0].lineup = {};
		const disabledContext = { ...fixtureContext, roster: null };
		const result = checkPlan(plan, disabledContext);
		expect(result.errors).toEqual([]);
		expect(result.validated.units[0].addressed_to_all).toBe(true);
	});

	test("게이트 표는 addressed_to_all 유닛의 팀원 칸에 '전원'을 표시한다(이름이 있으면 '전원 + 이름들')", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].addressed_to_all = true;
		plan.matches[0].topics[0].units[1].addressed_to_all = true;
		plan.matches[0].topics[0].units[1].member_ids = [];
		const result = checkPlan(plan, fixtureContext);
		const rows = result.tableMd.split("\n");
		expect(rows[2]).toContain("전원 + 홍길동");
		expect(rows[3]).toContain("| 전원 |");
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

// ── notes.json v2 (checkNotes, plan §16-1) ───────────────────────────────────

const fixtureValidated: ValidatedPlan = checkPlan(makeValidPlan(), fixtureContext).validated;

// u001: video A, [start=0,end=20] → 허용 범위 [-5,25]. u002: video A, [start=20,end=30] → [15,35].
// fixtureCandidates: c001(A,t=10) c002(A,t=25) c004(A,t=40) c003(B,t=5).

function makeValidNotes(): any {
	return {
		version: 2,
		units: {
			u001: {
				blocks: [
					{ type: "text", text: "센터백이 패스를 미스한 장면입니다" },
					{ type: "frame", candidate_id: "c001", caption: "화면 왼쪽 홍길동이 공을 패스 미스한 순간" },
				],
			},
			u002: {
				blocks: [
					{ type: "text", text: "골키퍼 배급이 느렸습니다" },
					{ type: "frame", candidate_id: "c002", caption: "골키퍼가 공을 잡은 장면" },
				],
			},
		},
	};
}

// scan-range가 u001 창(video A, [-5,25]) 안에서 훑은 프레임 하나(kind range)를 더한 후보 목록.
const rangedCandidates = [...fixtureCandidates, { id: "c005", video: "AAAAAAAAAAA", t: 12, kind: "range" as const }];

describe("checkNotes", () => {
	describe("fault_scene", () => {
		// u001 제목이 -ㅁ 지적이면 장면 문장(fault_scene)이 필수, -기 할 일만이면 쓸 수 없다.
		const validatedWithTitle = (title: string): ValidatedPlan => {
			const plan = makeValidPlan();
			plan.matches[0].topics[0].units[0].title = title;
			const result = checkPlan(plan, fixtureContext);
			expect(result.errors).toEqual([]);
			return result.validated;
		};
		const SCENE = "홍길동이 페널티 아크 근처에서 상대 둘 사이에 서 있고 수비 라인 뒤에 공간이 비어 있다";
		const paths = (validated: ValidatedPlan, faultScene?: unknown): string[] => {
			const notes = makeValidNotes();
			if (faultScene !== undefined) notes.units.u001.fault_scene = faultScene;
			return checkNotes(notes, validated, fixtureCandidates, fixtureRoster).errors.map((e) => e.path);
		};

		test("제목에 -ㅁ 조각이 있으면 fault_scene이 필수다(없으면 에러, 있으면 통과)", () => {
			for (const title of ["센터백: 첫판부터 정신 놓음", "센터백: 더 벌리기 / 골키퍼: 뒷공간을 내줌", "센터백: 첫판부터 정신 놓음(아직까진)"]) {
				const validated = validatedWithTitle(title);
				const missing = checkNotes(makeValidNotes(), validated, fixtureCandidates, fixtureRoster).errors;
				expect(missing.map((e) => e.path)).toEqual(["units.u001.fault_scene"]);
				expect(missing[0].message).toContain("u001");
				expect(paths(validated, SCENE)).toEqual([]);
			}
		});

		test("fault_scene은 trim 후 1~120자·개행 금지 문자열이다", () => {
			const validated = validatedWithTitle("센터백: 첫판부터 정신 놓음");
			expect(paths(validated, "   ")).toEqual(["units.u001.fault_scene"]);
			expect(paths(validated, "가".repeat(121))).toEqual(["units.u001.fault_scene"]);
			expect(paths(validated, "가".repeat(120))).toEqual([]);
			expect(paths(validated, "위\n아래")).toEqual(["units.u001.fault_scene"]);
			expect(paths(validated, 3)).toEqual(["units.u001.fault_scene"]);
		});

		test("제목에 -ㅁ 조각이 없으면 fault_scene을 쓸 수 없다", () => {
			const notes = makeValidNotes();
			notes.units.u001.fault_scene = SCENE;
			const errors = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
			expect(errors.map((e) => e.path)).toEqual(["units.u001.fault_scene"]);
			expect(errors[0].message).toContain("u001");
		});
	});

	describe("첫 문단 볼드", () => {
		const notesWithTexts = (texts: string[]): any => {
			const notes = makeValidNotes();
			notes.units.u001.blocks = [
				...texts.map((text) => ({ type: "text", text })),
				{ type: "frame", candidate_id: "c001", caption: "화면 왼쪽 홍길동이 패스를 미스한 순간" },
			];
			return notes;
		};
		const errorsOf = (texts: string[]) => checkNotes(notesWithTexts(texts), fixtureValidated, fixtureCandidates, fixtureRoster).errors;

		test("첫 text 블록에 볼드가 없고 뒤 text 블록에만 있으면 유닛을 짚어 에러를 낸다", () => {
			const errors = errorsOf(["센터백이 패스를 미스한 장면입니다", "다음엔 **짧게 패스하기**가 맞습니다"]);
			expect(errors.map((e) => e.path)).toEqual(["units.u001.blocks"]);
			expect(errors[0].message).toBe("u001: 볼드(할 행동)가 첫 문단에 없고 뒤 문단에만 있다 — 행위자와 교정 행동을 첫 문단에 쓴다");
		});

		test("첫 문단에 볼드가 있거나, 어느 문단에도 볼드가 없으면 통과한다", () => {
			expect(errorsOf(["**짧게 패스하기**가 맞습니다", "근거 문단"])).toEqual([]);
			expect(errorsOf(["**짧게 패스하기**가 맞습니다", "또 **한 번 더** 씁니다"])).toEqual([]);
			expect(errorsOf(["볼드 없는 첫 문단", "볼드 없는 둘째 문단"])).toEqual([]);
		});
	});

	describe("제목의 받는 사람", () => {
		const validatedWithTitle = (title: string): ValidatedPlan => {
			const plan = makeValidPlan();
			plan.matches[0].topics[0].units[0].title = title;
			const result = checkPlan(plan, fixtureContext);
			expect(result.errors).toEqual([]);
			return result.validated;
		};
		const errorsOf = (title: string, caption: string, roster: Roster | null = fixtureRoster) => {
			const notes = makeValidNotes();
			notes.units.u001.blocks[1].caption = caption;
			return checkNotes(notes, validatedWithTitle(title), fixtureCandidates, roster).errors;
		};

		test("제목이 '이름에게'로 받는 사람을 부르는데 어느 캡션에도 그 이름이 없으면 에러를 낸다", () => {
			const errors = errorsOf("게임메이커: 김철수에게 짧게 패스하기", "홍길동이 공을 잡은 순간");
			expect(errors.map((e) => e.path)).toEqual(["units.u001.blocks"]);
			expect(errors[0].message).toBe(
				"u001: 제목의 받는 사람 김철수가 어느 캡션에도 없다 — 받는 사람 위치를 캡션에 쓰거나, 프레임에 안 보이면 '김철수는 이 프레임에 보이지 않는다'처럼 밝힌다",
			);
		});

		test("캡션에 이름(또는 '보이지 않는다' 문구)이 있으면 통과하고, 별칭·게이머태그로 부른 제목도 같은 이름 매칭을 쓴다", () => {
			expect(errorsOf("게임메이커: 김철수에게 짧게 패스하기", "홍길동 앞쪽 공 옆 김철수가 열린 순간")).toEqual([]);
			expect(errorsOf("게임메이커: KimCS에게 짧게 패스하기", "홍길동이 공을 잡은 순간").map((e) => e.path)).toEqual(["units.u001.blocks"]);
		});

		test("'이름 쪽'으로 방향을 부른 제목도 받는 사람으로 본다(별칭·게이머태그 포함)", () => {
			const errors = errorsOf("게임메이커: 김철수 쪽 바라보기", "홍길동이 공을 잡은 순간");
			expect(errors.map((e) => e.path)).toEqual(["units.u001.blocks"]);
			expect(errors[0].message).toContain("제목의 받는 사람 김철수");
			expect(errorsOf("게임메이커: 김철수 쪽으로 짧게 패스하기", "홍길동이 공을 잡은 순간").map((e) => e.path)).toEqual(["units.u001.blocks"]);
			expect(errorsOf("게임메이커: KimCS 쪽 바라보기", "홍길동이 공을 잡은 순간").map((e) => e.path)).toEqual(["units.u001.blocks"]);
			expect(errorsOf("게임메이커: 김철수 쪽 바라보기", "홍길동 앞쪽 김철수가 열린 순간")).toEqual([]);
		});

		test("'에게'·' 쪽'이 이름 바로 뒤에 붙지 않았거나 명단이 없으면 검사하지 않는다", () => {
			expect(errorsOf("게임메이커: 김철수가 짧게 패스하기", "홍길동이 공을 잡은 순간")).toEqual([]);
			expect(errorsOf("게임메이커: 김철수쪽 바라보기", "홍길동이 공을 잡은 순간")).toEqual([]);
			expect(errorsOf("게임메이커: 김철수에게 짧게 패스하기", "홍길동이 공을 잡은 순간", null).filter((e) => e.message.includes("받는 사람"))).toEqual([]);
			expect(errorsOf("게임메이커: 김철수 쪽 바라보기", "홍길동이 공을 잡은 순간", null).filter((e) => e.message.includes("받는 사람"))).toEqual([]);
		});

		describe("받는 사람이 안 보인다고 쓴 캡션은 scan-range 기록이 필요하다", () => {
			const NOT_VISIBLE = "홍길동 앞 공 옆, 김철수는 이 프레임에 보이지 않는다";
			const run = (title: string, captions: string[], candidates: typeof fixtureCandidates | typeof rangedCandidates) => {
				const notes = makeValidNotes();
				notes.units.u001.blocks = [
					notes.units.u001.blocks[0],
					...captions.map((caption, index) => ({ type: "frame", candidate_id: index === 0 ? "c001" : "c002", caption })),
				];
				// 받는 사람이 안 보인다는 캡션이 있으면 look_at이 필수라(별도 describe), 이 describe는 범위 스캔 요구만 본다.
				if (captions.every((caption) => ["보이지 않는다", "확인되지 않는다", "알아볼 수 없다"].some((p) => caption.includes(p)))) notes.units.u001.look_at = "화면 아래쪽 빈 공간";
				return checkNotes(notes, validatedWithTitle(title), candidates, fixtureRoster).errors;
			};
			const TITLE = "게임메이커: 김철수에게 짧게 패스하기";

			test("범위 스캔 기록이 없으면 받는 사람 이름을 든 에러를 낸다", () => {
				const errors = run(TITLE, [NOT_VISIBLE], fixtureCandidates);
				expect(errors.map((e) => e.path)).toEqual(["units.u001.blocks"]);
				expect(errors[0].message).toBe("u001: 받는 사람 김철수를 사진에서 못 찾았다고 했지만 이 유닛 범위를 scan-range로 훑은 기록이 없다");
			});

			test("유닛 창 안에 kind range 후보가 있으면 통과한다", () => {
				expect(run(TITLE, [NOT_VISIBLE], rangedCandidates)).toEqual([]);
			});

			test("'알아볼 수 없다'로 쓴 캡션도 못 찾았다는 말로 보고 범위 스캔 기록을 요구한다", () => {
				const errors = run(TITLE, ["홍길동 앞 공 옆, 김철수는 이 프레임에서 알아볼 수 없다"], fixtureCandidates);
				expect(errors.map((e) => e.message)).toEqual(["u001: 받는 사람 김철수를 사진에서 못 찾았다고 했지만 이 유닛 범위를 scan-range로 훑은 기록이 없다"]);
			});

			test("'확인되지 않는다'로 쓴 캡션도 못 찾았다는 말로 보고 범위 스캔 기록을 요구한다", () => {
				const errors = run(TITLE, ["홍길동 앞 공 옆, 김철수는 이 프레임에서 이름표로 확인되지 않는다"], fixtureCandidates);
				expect(errors.map((e) => e.message)).toEqual(["u001: 받는 사람 김철수를 사진에서 못 찾았다고 했지만 이 유닛 범위를 scan-range로 훑은 기록이 없다"]);
			});

			test("받는 사람 위치를 쓴 캡션이 하나라도 있으면 범위 스캔 기록을 요구하지 않는다", () => {
				expect(run(TITLE, [NOT_VISIBLE, "홍길동 앞쪽 김철수가 열린 순간"], fixtureCandidates)).toEqual([]);
			});

			test("'이름 쪽' 제목에도 같은 요구가 적용된다", () => {
				const errors = run("게임메이커: 김철수 쪽 바라보기", [NOT_VISIBLE], fixtureCandidates);
				expect(errors.map((e) => e.message)).toEqual(["u001: 받는 사람 김철수를 사진에서 못 찾았다고 했지만 이 유닛 범위를 scan-range로 훑은 기록이 없다"]);
			});
		});
	});

	test("고칠 사람(member_ids)을 짚은 캡션이 없으면 blocks 경로 에러, unidentified_member_ids에 넣으면 통과한다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = "공 패스 미스 순간";
		const missing = checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster);
		expect(missing.errors.some((e) => e.path === "units.u001.blocks" && e.message.includes("hong-gildong"))).toBe(true);
		notes.units.u001.unidentified_member_ids = ["hong-gildong"];
		notes.units.u001.look_at = "화면 위쪽 마크 없는 홍길동";
		expect(checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors).toEqual([]);
	});

	test("'X는 이 프레임에서 알아볼 수 없다' 절은 X를 짚은 것으로 세지 않는다 — unidentified_member_ids에 함께 둘 수 있다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = "공은 화면 가운데, 홍길동은 이 프레임에서 알아볼 수 없다";
		notes.units.u001.unidentified_member_ids = ["hong-gildong"];
		notes.units.u001.look_at = "화면 위쪽 마크 없는 홍길동";
		const errors = checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors;
		expect(errors.filter((e) => e.message.includes("이미 이름을 짚은"))).toEqual([]);
	});

	test("unidentified_member_ids가 비어 있지 않으면 look_at이 필수고, 비어 있는데 look_at이 있으면 에러다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = "패스 미스 순간";
		notes.units.u001.unidentified_member_ids = ["hong-gildong"];
		const missing = checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors;
		expect(missing.map((e) => e.path)).toEqual(["units.u001.look_at"]);
		expect(missing[0].message).toContain("u001");
		notes.units.u001.look_at = "a".repeat(61);
		expect(checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors.map((e) => e.path)).toEqual(["units.u001.look_at"]);
		notes.units.u001.look_at = "위\n아래";
		expect(checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors.map((e) => e.path)).toEqual(["units.u001.look_at"]);
		notes.units.u001.look_at = "화면 위쪽 마크 없는 홍길동";
		expect(checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors).toEqual([]);
		const stray = makeValidNotes();
		stray.units.u001.look_at = "화면 위쪽";
		const strayErrors = checkNotes(stray, fixtureValidated, rangedCandidates, fixtureRoster).errors;
		expect(strayErrors.map((e) => e.path)).toEqual(["units.u001.look_at"]);
		expect(strayErrors[0].message).toContain("unidentified_member_ids");
	});

	test("look_at에 ':'나 ' / '가 있으면 에러다(볼 곳은 한 문장)", () => {
		for (const lookAt of ["동그리: 화면 위쪽", "화면 위쪽 / 우사는 아래쪽"]) {
			const notes = makeValidNotes();
			notes.units.u001.blocks[1].caption = "패스 미스 순간";
			notes.units.u001.unidentified_member_ids = ["hong-gildong"];
			notes.units.u001.look_at = lookAt;
			const errors = checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors;
			expect(errors.map((e) => e.path)).toEqual(["units.u001.look_at"]);
			expect(errors[0].message).toContain("콜론");
		}
	});

	test("text 블록이나 frame 캡션에 '원문'이 있으면 유닛 id를 짚은 에러를 낸다", () => {
		const inText = makeValidNotes();
		inText.units.u001.blocks[0].text = "원문에서 지적한 패스 미스입니다";
		const textErrors = checkNotes(inText, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
		expect(textErrors.map((e) => e.path)).toEqual(["units.u001.blocks[0].text"]);
		expect(textErrors[0].message).toContain("u001");
		expect(textErrors[0].message).toContain("원문");
		const inCaption = makeValidNotes();
		inCaption.units.u001.blocks[1].caption = "화면 왼쪽 홍길동이 원문 속 패스를 미스한 순간";
		const captionErrors = checkNotes(inCaption, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
		expect(captionErrors.map((e) => e.path)).toEqual(["units.u001.blocks[1].caption"]);
		expect(captionErrors[0].message).toContain("u001");
	});

	test("frame 캡션에 '가려내기 어렵'·'알아보기 어렵' 같은 작업 과정의 말이 있으면 유닛 id를 짚은 에러를 낸다", () => {
		for (const phrase of ["가려내기 어렵", "알아보기 어렵"]) {
			const notes = makeValidNotes();
			notes.units.u001.blocks[1].caption = `홍길동 뒤 선수는 ${phrase}다`;
			const errors = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
			expect(errors.map((e) => e.path)).toEqual(["units.u001.blocks[1].caption"]);
			expect(errors[0].message).toContain("u001");
			expect(errors[0].message).toContain(phrase);
		}
	});

	test("text 블록·frame 캡션·fault_scene·look_at이 '댓글은/댓글이/댓글에'로 댓글 자체를 말하면 유닛 id를 짚은 에러를 낸다", () => {
		const message = (unitId: string) => `${unitId}: 카드에 '댓글은 …' 꼴로 댓글 자체를 말하지 않는다 — 방향이 어긋나면 notes 유닛의 direction_check_ko에 한 문장으로 적는다`;
		const faultValidated = (() => {
			const plan = makeValidPlan();
			plan.matches[0].topics[0].units[0].title = "센터백: 첫판부터 정신 놓음";
			return checkPlan(plan, fixtureContext).validated;
		})();
		for (const phrase of ["댓글은", "댓글이", "댓글에"]) {
			const inText = makeValidNotes();
			inText.units.u001.blocks[0].text = `${phrase} 좌측이라고 했다`;
			const textErrors = checkNotes(inText, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
			expect(textErrors.map((e) => e.path)).toEqual(["units.u001.blocks[0].text"]);
			expect(textErrors[0].message).toBe(message("u001"));

			const inCaption = makeValidNotes();
			inCaption.units.u001.blocks[1].caption = `홍길동 ${phrase} 좌측이라 했지만 몰린 쪽은 화면 위쪽이다`;
			const captionErrors = checkNotes(inCaption, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
			expect(captionErrors.map((e) => e.path)).toEqual(["units.u001.blocks[1].caption"]);
			expect(captionErrors[0].message).toBe(message("u001"));

			const inScene = makeValidNotes();
			inScene.units.u001.fault_scene = `${phrase} 말한 대로 홍길동이 아크에 서 있다`;
			const sceneErrors = checkNotes(inScene, faultValidated, fixtureCandidates, fixtureRoster).errors;
			expect(sceneErrors.map((e) => e.path)).toEqual(["units.u001.fault_scene"]);
			expect(sceneErrors[0].message).toBe(message("u001"));

			const inLookAt = makeValidNotes();
			inLookAt.units.u001.blocks[1].caption = "패스 미스 순간";
			inLookAt.units.u001.unidentified_member_ids = ["hong-gildong"];
			inLookAt.units.u001.look_at = `${phrase} 가리킨 화면 위쪽`;
			const lookAtErrors = checkNotes(inLookAt, fixtureValidated, rangedCandidates, fixtureRoster).errors;
			expect(lookAtErrors.map((e) => e.path)).toEqual(["units.u001.look_at"]);
			expect(lookAtErrors[0].message).toBe(message("u001"));
		}
		const clean = makeValidNotes();
		clean.units.u001.blocks[0].text = "코치는 좌측이라고 했다";
		expect(checkNotes(clean, fixtureValidated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
	});

	test("frame 캡션이 fault_scene과 같으면(앞뒤 공백 무시) 그 캡션 경로 에러를 낸다", () => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].title = "센터백: 첫판부터 정신 놓음";
		const validated = checkPlan(plan, fixtureContext).validated;
		const SCENE = "홍길동이 페널티 아크 근처에서 상대 둘 사이에 서 있다";
		const notes = makeValidNotes();
		notes.units.u001.fault_scene = SCENE;
		notes.units.u001.blocks[1].caption = `  ${SCENE} `;
		const errors = checkNotes(notes, validated, fixtureCandidates, fixtureRoster).errors;
		expect(errors.map((e) => e.path)).toEqual(["units.u001.blocks[1].caption"]);
		expect(errors[0].message).toBe("u001: 캡션이 fault_scene과 같다 — 캡션은 그 프레임에서 더 보이는 것을 쓴다");
		notes.units.u001.blocks[1].caption = `${SCENE} 공은 오른쪽 위에 있다`;
		expect(checkNotes(notes, validated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
	});

	describe("unidentified_member_ids는 유닛 범위를 scan-range로 훑은 기록이 필요하다", () => {
		const MESSAGE = "u001: 고칠 사람을 사진에서 못 찾았다고 했지만 이 유닛 범위를 scan-range로 훑은 기록이 없다";
		const unidentifiedNotes = () => {
			const notes = makeValidNotes();
			notes.units.u001.blocks[1].caption = "패스 미스 순간";
			notes.units.u001.unidentified_member_ids = ["hong-gildong"];
			notes.units.u001.look_at = "화면 위쪽 마크 없는 홍길동";
			return notes;
		};
		const run = (candidates: Parameters<typeof checkNotes>[2]) => checkNotes(unidentifiedNotes(), fixtureValidated, candidates, fixtureRoster).errors;

		test("범위 후보가 없으면 에러를 낸다", () => {
			const errors = run(fixtureCandidates);
			expect(errors.map((e) => e.path)).toEqual(["units.u001.unidentified_member_ids"]);
			expect(errors[0].message).toBe(MESSAGE);
		});

		test("kind가 range가 아닌 후보(manual 포함)는 범위 스캔 기록이 아니다", () => {
			expect(run([...fixtureCandidates, { id: "c005", video: "AAAAAAAAAAA", t: 12, kind: "manual" }]).map((e) => e.message)).toEqual([MESSAGE]);
		});

		test("다른 video이거나 유닛 창(시작-5 ~ 끝+5초) 밖의 range 후보는 기록으로 세지 않는다", () => {
			expect(run([...fixtureCandidates, { id: "c005", video: "BBBBBBBBBBB", t: 12, kind: "range" }]).map((e) => e.message)).toEqual([MESSAGE]);
			expect(run([...fixtureCandidates, { id: "c005", video: "AAAAAAAAAAA", t: 26, kind: "range" }]).map((e) => e.message)).toEqual([MESSAGE]);
			expect(run([...fixtureCandidates, { id: "c005", video: "AAAAAAAAAAA", t: 25, kind: "range" }])).toEqual([]);
		});

		test("창 안에 range 후보가 하나라도 있으면 통과한다", () => {
			expect(run(rangedCandidates)).toEqual([]);
		});

		test("unidentified_member_ids가 없거나 비어 있으면 요구하지 않는다", () => {
			expect(checkNotes(makeValidNotes(), fixtureValidated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
			const empty = makeValidNotes();
			empty.units.u001.unidentified_member_ids = [];
			expect(checkNotes(empty, fixtureValidated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
		});
	});

	test("게이머태그로 짚어도 통과하고, 캡션이 이미 짚었거나 member_ids에 없는 id를 unidentified에 넣으면 에러다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = "HONGGD 이름표 선수가 공을 뺏긴 순간";
		expect(checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors).toEqual([]);
		notes.units.u001.unidentified_member_ids = ["hong-gildong", "kim-cheolsu"];
		notes.units.u001.look_at = "화면 위쪽";
		const paths = checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors.map((e) => e.path);
		expect(paths).toEqual(["units.u001.unidentified_member_ids", "units.u001.unidentified_member_ids"]);
	});

	test("유효한 최소 notes(유닛마다 텍스트 1개+프레임 1개)를 검증하면 에러가 없다", () => {
		const result = checkNotes(makeValidNotes(), fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(result.errors).toEqual([]);
	});

	test("프레임 블록의 focus_x는 0~1 사이 숫자만 허용하고 생략은 허용한다", () => {
		const check = (focusX: unknown) => {
			const notes = makeValidNotes();
			notes.units.u001.blocks[1].focus_x = focusX;
			return checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors.map((e) => e.path);
		};
		expect(check(0)).toEqual([]);
		expect(check(0.25)).toEqual([]);
		expect(check(1)).toEqual([]);
		expect(check(-0.1)).toEqual(["units.u001.blocks[1].focus_x"]);
		expect(check(1.5)).toEqual(["units.u001.blocks[1].focus_x"]);
		expect(check("0.5")).toEqual(["units.u001.blocks[1].focus_x"]);
		expect(check(Number.NaN)).toEqual(["units.u001.blocks[1].focus_x"]);
		expect(check(null)).toEqual(["units.u001.blocks[1].focus_x"]);
		const omitted = makeValidNotes();
		expect(checkNotes(omitted, fixtureValidated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
	});

	test("텍스트+프레임 2개가 섞인 notes를 검증하면 에러가 없다", () => {
		const notes = makeValidNotes();
		notes.units.u001 = {
			blocks: [
				{ type: "text", text: "센터백은 **빌드업** 때 패스를 짧게 하기가 맞습니다" },
				{ type: "frame", candidate_id: "c001", caption: "홍길동이 패스를 미스한 순간" },
				{ type: "text", text: "각도가 좁았습니다" },
				{ type: "frame", candidate_id: "c002", caption: "직후 상황" },
			],
		};
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(result.errors).toEqual([]);
	});

	test("v1 형식(problem/who/instead/key_frames)이면 version 경로에 명시적 거부 메시지를 낸다", () => {
		const v1 = {
			version: 1,
			units: {
				u001: { problem: "p", who: "w", instead: "i", key_frames: [] },
				u002: { problem: "p", who: "w", instead: "i", key_frames: [] },
			},
		};
		const result = checkNotes(v1, fixtureValidated, fixtureCandidates, fixtureRoster);
		const error = result.errors.find((e) => e.path === "version");
		expect(error?.message).toBe("notes v1 형식은 더 이상 지원하지 않습니다 — v2 blocks 형식으로 작성");
	});

	test("version이 2가 아니면(1도 아니면) version 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.version = 3;
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "version")).toBe(true);
	});

	test("blocks 없이 problem/who/instead/key_frames만 있는 unit은 units.<id> 경로에 v1 거부 메시지를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001 = { problem: "p", who: "w", instead: "i", key_frames: [] };
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		const error = result.errors.find((e) => e.path === "units.u001");
		expect(error?.message).toBe("notes v1 형식은 더 이상 지원하지 않습니다 — v2 blocks 형식으로 작성");
	});

	test("검증된 unit에 대응하는 노트가 없으면 units.<id> 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		delete notes.units.u002;
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u002")).toBe(true);
	});

	test("검증된 plan에 없는 unit id면 units.<id> 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u999 = { blocks: [{ type: "text", text: "x" }] };
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u999")).toBe(true);
	});

	test("blocks가 비어있으면 units.<id>.blocks 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks")).toBe(true);
	});

	test("blocks가 20개를 넘으면 units.<id>.blocks 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = Array.from({ length: 21 }, () => ({ type: "text", text: "문단" }));
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks")).toBe(true);
	});

	test("text 블록이 하나도 없으면 units.<id>.blocks 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [{ type: "frame", candidate_id: "c001", caption: "x" }];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks")).toBe(true);
	});

	test("첫 블록이 text가 아니면(사진이 본문보다 먼저면) units.<id>.blocks[0] 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [...notes.units.u001.blocks].reverse();
		const errors = checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors;
		expect(errors.filter((e) => e.path === "units.u001.blocks[0]").map((e) => e.message)).toEqual(["u001: 첫 블록은 본문(text)이어야 한다 — 카드는 할 행동을 담은 본문 문단을 사진보다 먼저 보인다"]);
	});

	test("text가 trim 후 비어있으면 units.<id>.blocks[n].text 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [{ type: "text", text: "   " }];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[0].text")).toBe(true);
	});

	test("text가 trim 후 800자를 넘으면 units.<id>.blocks[n].text 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [{ type: "text", text: "가".repeat(801) }];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[0].text")).toBe(true);
	});

	test("text에 개행이 있으면 units.<id>.blocks[n].text 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [{ type: "text", text: "첫 줄\n둘째 줄" }];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[0].text")).toBe(true);
	});

	test("**가 짝이 맞지 않으면 units.<id>.blocks[n].text 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [{ type: "text", text: "이것은 **닫히지 않음" }];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[0].text")).toBe(true);
	});

	test("**로 감싼 내용이 비어있으면 units.<id>.blocks[n].text 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [{ type: "text", text: "이것은 **** 비어있음" }];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[0].text")).toBe(true);
	});

	test("frame이 6개를 넘으면 units.<id>.blocks 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			...Array.from({ length: 7 }, () => ({ type: "frame", candidate_id: "c001", caption: "x" })),
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks")).toBe(true);
	});

	test("존재하지 않는 candidate면 units.<id>.blocks[n].candidate_id 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c999", caption: "x" },
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[1].candidate_id")).toBe(true);
	});

	test("다른 video의 candidate면 units.<id>.blocks[n].candidate_id 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c003", caption: "x" }, // video B
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[1].candidate_id")).toBe(true);
	});

	test("unit 허용 범위(±5초)를 벗어난 candidate면 units.<id>.blocks[n].candidate_id 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c004", caption: "x" }, // t=40, u001 범위는 [-5,25]
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[1].candidate_id")).toBe(true);
	});

	test("unit 내에서 candidate_id가 중복되면 units.<id>.blocks[n].candidate_id 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c001", caption: "x" },
			{ type: "frame", candidate_id: "c001", caption: "y" },
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[2].candidate_id")).toBe(true);
	});

	test("블록 순서대로 candidate 시각이 감소하면 units.<id>.blocks[n].candidate_id 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c002", caption: "x" }, // t=25
			{ type: "frame", candidate_id: "c001", caption: "y" }, // t=10 (감소)
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[2].candidate_id")).toBe(true);
	});

	test("caption이 trim 후 비어있으면 units.<id>.blocks[n].caption 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c001", caption: "   " },
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[1].caption")).toBe(true);
	});

	test("frame 블록이 하나도 없는 unit은 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [{ type: "text", text: "**볼드** 문장입니다" }];
		const error = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors.find(
			(e) => e.path === "units.u001.blocks",
		);
		expect(error?.message).toContain("frame 블록이 최소 1개");
	});

	test("caption이 시계·점수 표기로 시작하면 경기 N분 표기를 안내하는 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c001", caption: " 34:12, 1-0 홍길동 상황" },
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		const error = result.errors.find((e) => e.path === "units.u001.blocks[1].caption");
		expect(error?.message).toContain("경기 34분");
		notes.units.u001.blocks[1].caption = "경기 34분, 1-0 홍길동 상황";
		expect(checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
		notes.units.u001.blocks[1].caption = "정지 화면(28:48) — 홍길동 표시 시작";
		expect(checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
	});

	test("caption이 120자를 넘으면 units.<id>.blocks[n].caption 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c001", caption: "가".repeat(121) },
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[1].caption")).toBe(true);
	});

	test("caption에 개행이 있으면 units.<id>.blocks[n].caption 경로 에러를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [
			{ type: "text", text: "문단" },
			{ type: "frame", candidate_id: "c001", caption: "첫 줄\n둘째 줄" },
		];
		const result = checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster);
		expect(findError(result.errors, "units.u001.blocks[1].caption")).toBe(true);
	});
});

describe("checkNotes — direction_check_ko(원문 방향과 프레임이 어긋남)", () => {
	const errorsOf = (value: unknown) => {
		const notes = makeValidNotes();
		notes.units.u001.direction_check_ko = value;
		return checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
	};

	test("trim 후 1~100자 한 줄 문자열이면 통과한다(필드는 선택)", () => {
		expect(errorsOf("댓글은 좌측, 사진에서 몰린 쪽은 화면 위쪽(이 하프의 우리 우측)")).toEqual([]);
		expect(checkNotes(makeValidNotes(), fixtureValidated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
	});

	test("문자열이 아니거나 비었거나 100자를 넘거나 개행이 있으면 units.<id>.direction_check_ko 경로 에러를 낸다", () => {
		for (const bad of [1, "  ", "가".repeat(101), "첫 줄\n둘째 줄"]) {
			const errors = errorsOf(bad);
			expect(errors.map((e) => e.path)).toEqual(["units.u001.direction_check_ko"]);
			expect(errors[0].message).toContain("u001");
		}
		expect(errorsOf("가".repeat(100))).toEqual([]);
	});

	test("'원문'이라는 작업 과정의 말을 쓰면 에러다", () => {
		expect(errorsOf("원문은 좌측, 사진은 위쪽").map((e) => e.path)).toEqual(["units.u001.direction_check_ko"]);
	});

	test("캡션의 '이 하프에서' 방향 문장은 더 이상 요구하지 않는다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = "홍길동이 화면 위쪽에 몰렸다";
		expect(checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors).toEqual([]);
	});
});

describe("checkNotes — 같은 경기 다른 유닛이 이름표로 짚은 사람은 못 찾았다고 하기 전에 marker_colors를 시도한다", () => {
	const GOOD = { match: 1, member_id: "hong-gildong", color: "분홍", evidence_candidate_id: "c001" };
	const run = (otherCaption: string, markerColors?: unknown) => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = "분홍 삼각형 선수가 화면 위쪽에 있다";
		notes.units.u001.unidentified_member_ids = ["hong-gildong"];
		notes.units.u001.look_at = "화면 위쪽 마크 없는 선수";
		notes.units.u002.blocks[1].caption = otherCaption;
		// 범례에 있는 색만 쓸 수 있으므로, 홍길동 항목이 없는 경우에도 u001 캡션의 분홍은 다른 사람(김철수)의 색으로 둔다.
		notes.marker_colors = markerColors ?? [{ match: 1, member_id: "kim-cheolsu", color: "분홍", evidence_candidate_id: "c002" }];
		return checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors;
	};

	test("다른 유닛 캡션이 이름표로 짚었는데 marker_colors에 그 경기·그 사람 항목이 없으면 유닛 id를 짚은 에러를 낸다", () => {
		const errors = run("홍길동 이름표가 보이는 골키퍼 앞");
		expect(errors.map((e) => e.path)).toEqual(["units.u001.unidentified_member_ids"]);
		expect(errors[0].message).toBe("u001: 홍길동는 같은 경기 u002 캡션에서 이름표로 짚혔다 — 그 프레임에서 머리 위 색 삼각형을 marker_colors에 적고, 이 유닛 프레임에서 그 색으로 찾아본다");
	});

	test("그 경기·그 사람의 marker_colors 항목이 있으면 통과한다", () => {
		expect(run("홍길동 이름표가 보이는 골키퍼 앞", [GOOD])).toEqual([]);
	});

	test("다른 유닛 캡션에 '이름표'가 없거나, 이름표로 확인되지 않는다는 캡션이면 에러가 아니다", () => {
		expect(run("홍길동이 골키퍼 앞에 있다")).toEqual([]);
		expect(run("홍길동은 이 프레임에서 이름표로 확인되지 않는다")).toEqual([]);
	});
});

describe("checkNotes — 못 찾았다는 사람의 마커 색은 이 유닛 프레임에서도 찾아본다", () => {
	const GOOD = { match: 1, member_id: "hong-gildong", color: "분홍", evidence_candidate_id: "c001" };
	const run = (caption: string, markerColors: unknown[] = [GOOD]) => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = caption;
		notes.units.u001.unidentified_member_ids = ["hong-gildong"];
		notes.units.u001.look_at = "화면 위쪽 마크 없는 선수";
		notes.marker_colors = markerColors;
		return checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors;
	};

	test("marker_colors에 그 경기·그 사람의 색이 있는데 캡션에 '<색> 삼각형'도 marker_unresolved_ko도 없으면 marker_unresolved_ko를 짚은 에러를 낸다", () => {
		for (const caption of ["공 앞 선수 둘이 겹친 순간", "분홍 선수가 공 앞에 있다", "삼각형이 공 앞에 있다"]) {
			const errors = run(caption);
			expect(errors.map((e) => e.path)).toEqual(["units.u001.unidentified_member_ids"]);
			expect(errors[0].message).toBe("u001: 홍길동의 색(분홍 삼각형)이 marker_colors에 있다 — 이 유닛 프레임에서 그 색으로 짚는 캡션을 쓰거나, 짚지 못한 이유를 notes 유닛의 marker_unresolved_ko에 적는다(카드에는 보이지 않는다)");
		}
	});

	test("캡션에 '<색> 삼각형'이 있으면 통과한다", () => {
		expect(run("공 옆 분홍 삼각형 선수가 받을 자리에 있다")).toEqual([]);
	});

	test("marker_unresolved_ko[member]가 있으면 캡션에 색이 없어도 통과한다", () => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = "공 앞 선수 둘이 겹친 순간";
		notes.units.u001.unidentified_member_ids = ["hong-gildong"];
		notes.units.u001.look_at = "화면 위쪽 마크 없는 선수";
		notes.units.u001.marker_unresolved_ko = { "hong-gildong": "분홍 삼각형이 두 선수 위에 있어 구별되지 않음" };
		notes.marker_colors = [GOOD];
		expect(checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors).toEqual([]);
	});

	test("캡션에 색으로 못 가리킨다는 작업 메모를 쓰면 유닛 id를 짚은 에러를 낸다", () => {
		for (const caption of ["분홍 삼각형이 둘이라 색으로 가리키지 않는다", "분홍 삼각형이 함께 있어 구별이 어렵다", "분홍 삼각형이 같이 보여 알 수 없다", "색으로 사람을 가리키지 않는다"]) {
			const errors = run(caption).filter((e) => e.path === "units.u001.blocks[1].caption");
			expect(errors).toHaveLength(1);
			expect(errors[0].message).toContain("u001");
			expect(errors[0].message).toContain("marker_unresolved_ko");
		}
	});
});

describe("checkNotes — marker_unresolved_ko 형식", () => {
	const run = (value: unknown, unidentified: string[] = ["hong-gildong"]) => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = "마크 없는 선수가 화면 위쪽에 있다";
		notes.units.u001.unidentified_member_ids = unidentified;
		if (unidentified.length > 0) notes.units.u001.look_at = "화면 위쪽 마크 없는 선수";
		notes.units.u001.marker_unresolved_ko = value;
		return checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors;
	};

	test("unidentified_member_ids 안의 사람 키와 1~80자 한 줄 이유면 통과한다", () => {
		expect(run({ "hong-gildong": "가".repeat(80) })).toEqual([]);
	});

	test("객체가 아니거나 이유가 문자열이 아니거나 비었거나 80자를 넘거나 개행이 있으면 경로를 짚은 에러를 낸다", () => {
		expect(run("이유").map((e) => e.path)).toEqual(["units.u001.marker_unresolved_ko"]);
		expect(run([]).map((e) => e.path)).toEqual(["units.u001.marker_unresolved_ko"]);
		for (const bad of [1, "  ", "가".repeat(81), "첫 줄\n둘째 줄"]) {
			expect(run({ "hong-gildong": bad }).map((e) => e.path)).toEqual(["units.u001.marker_unresolved_ko.hong-gildong"]);
		}
	});

	test("unidentified_member_ids에 없는 사람 키는 에러다", () => {
		const errors = run({ "kim-cheolsu": "이유" });
		expect(errors.map((e) => e.path)).toEqual(["units.u001.marker_unresolved_ko.kim-cheolsu"]);
		expect(errors[0].message).toContain("unidentified_member_ids");
		expect(run({ "hong-gildong": "이유" }, []).map((e) => e.path)).toContain("units.u001.marker_unresolved_ko.hong-gildong");
	});
});

describe("checkNotes — marker_colors 나머지 규칙(색 삼각형 찾기)", () => {
	const GOOD = { match: 1, member_id: "hong-gildong", color: "분홍", evidence_candidate_id: "c001" };
	const run = (caption: string, markerColors: unknown[] = [GOOD]) => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = caption;
		notes.units.u001.unidentified_member_ids = ["hong-gildong"];
		notes.units.u001.look_at = "화면 위쪽 마크 없는 선수";
		notes.marker_colors = markerColors;
		return checkNotes(notes, fixtureValidated, rangedCandidates, fixtureRoster).errors;
	};

	test("다른 경기의 색 항목이거나 다른 사람의 색이면 요구하지 않는다", () => {
		expect(run("공 앞 선수 둘이 겹친 순간", [{ ...GOOD, member_id: "kim-cheolsu", evidence_candidate_id: "c002" }])).toEqual([]);
		expect(run("공 앞 선수 둘이 겹친 순간", [])).toEqual([]);
	});
});

describe("checkNotes — 패스 카드는 공을 말로 짚는다", () => {
	const run = (title: string, captions: string[]) => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].title = title;
		const validated = checkPlan(plan, fixtureContext).validated;
		const notes = makeValidNotes();
		notes.units.u001.blocks = [notes.units.u001.blocks[0], ...captions.map((caption, index) => ({ type: "frame", candidate_id: index === 0 ? "c001" : "c002", caption }))];
		return checkNotes(notes, validated, rangedCandidates, fixtureRoster).errors;
	};

	test("제목 조각에 '패스'나 '<이름>에게'가 있는데 어느 캡션에도 단어 '공'이 없으면 유닛 id를 짚은 에러를 낸다", () => {
		for (const title of ["센터백: 패스 미스하지 않기", "센터백: 김철수에게 붙이기"]) {
			const errors = run(title, ["홍길동이 김철수 앞 아크에 서 있다 공격 공간 공중"]);
			expect(errors.map((e) => e.path)).toEqual(["units.u001.blocks"]);
			expect(errors[0].message).toContain("u001");
			expect(errors[0].message).toContain("공");
		}
	});

	test("'공이/공을/공은/공의/공과/공도' 같은 조사 꼴과 단어 '공'은 통과한다", () => {
		for (const caption of ["공 앞에 홍길동이 있다", "홍길동이 공을 받는다", "홍길동 옆 공이 떠 있다", "홍길동 (공은 아직 멀다)", "홍길동과 공의 거리", "공과 홍길동", "홍길동 공도 멀다", "홍길동 “공” 앞에 있다"]) {
			expect(run("센터백: 패스 미스하지 않기", [caption])).toEqual([]);
		}
	});

	test("패스·받는 사람 제목이 아니면 공을 요구하지 않는다", () => {
		expect(run("센터백: 더 벌리기", ["홍길동이 아크에 서 있다"])).toEqual([]);
	});
});

describe("checkNotes — direction_check_ko가 있는 유닛은 fault_scene을 쓰지 않는다", () => {
	const SCENE = "홍길동이 페널티 아크 근처에서 상대 둘 사이에 서 있고 수비 라인 뒤에 공간이 비어 있다";
	const run = (opts: { faultScene?: string; direction?: string }) => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].title = "센터백: 첫판부터 정신 놓음";
		const validated = checkPlan(plan, fixtureContext).validated;
		const notes = makeValidNotes();
		if (opts.faultScene !== undefined) notes.units.u001.fault_scene = opts.faultScene;
		if (opts.direction !== undefined) notes.units.u001.direction_check_ko = opts.direction;
		return checkNotes(notes, validated, fixtureCandidates, fixtureRoster).errors;
	};

	test("direction_check_ko가 있으면 -ㅁ 제목이어도 fault_scene 없이 통과한다", () => {
		expect(run({ direction: "사진에서 몰린 쪽은 화면 위쪽" })).toEqual([]);
	});

	test("direction_check_ko와 fault_scene이 함께 있으면 fault_scene 경로 에러를 낸다", () => {
		const errors = run({ direction: "사진에서 몰린 쪽은 화면 위쪽", faultScene: SCENE });
		expect(errors.map((e) => e.path)).toEqual(["units.u001.fault_scene"]);
		expect(errors[0].message).toContain("u001");
		expect(errors[0].message).toContain("direction_check_ko");
	});

	test("direction_check_ko가 없으면 -ㅁ 제목의 fault_scene 필수는 그대로다", () => {
		expect(run({}).map((e) => e.path)).toEqual(["units.u001.fault_scene"]);
		expect(run({ faultScene: SCENE })).toEqual([]);
	});
});

describe("checkNotes — 받는 사람이 안 보이면 look_at 필수", () => {
	const validatedWithTitle = (title: string): ValidatedPlan => {
		const plan = makeValidPlan();
		plan.matches[0].topics[0].units[0].title = title;
		return checkPlan(plan, fixtureContext).validated;
	};
	const TITLE = "게임메이커: 김철수에게 짧게 패스하기";
	const NOT_VISIBLE = "홍길동 앞 공 옆, 김철수는 이 프레임에 보이지 않는다";
	const run = (captions: string[], lookAt?: string, title = TITLE) => {
		const notes = makeValidNotes();
		notes.units.u001.blocks = [notes.units.u001.blocks[0], ...captions.map((caption, index) => ({ type: "frame", candidate_id: index === 0 ? "c001" : "c002", caption }))];
		if (lookAt !== undefined) notes.units.u001.look_at = lookAt;
		return checkNotes(notes, validatedWithTitle(title), rangedCandidates, fixtureRoster).errors;
	};

	test("받는 사람을 짚은 캡션이 모두 '보이지 않는다'면 unidentified_member_ids가 없어도 look_at이 필수다", () => {
		const errors = run([NOT_VISIBLE]);
		expect(errors.map((e) => e.path)).toEqual(["units.u001.look_at"]);
		expect(errors[0].message).toContain("u001");
		expect(errors[0].message).toContain("보이지 않는다");
	});

	test("look_at을 쓰면 통과하고, 형식(콜론 금지)은 그대로 검사한다", () => {
		expect(run([NOT_VISIBLE], "화면 아래쪽 공을 받을 빈 공간")).toEqual([]);
		expect(run([NOT_VISIBLE], "김철수: 화면 아래쪽").map((e) => e.path)).toEqual(["units.u001.look_at"]);
	});

	test("받는 사람이 보이는 캡션이 하나라도 있으면 look_at을 쓸 수 없다", () => {
		const errors = run([NOT_VISIBLE, "홍길동 앞쪽 김철수가 열린 순간"], "화면 아래쪽");
		expect(errors.map((e) => e.path)).toEqual(["units.u001.look_at"]);
		expect(errors[0].message).toContain("unidentified_member_ids");
	});

	test("받는 사람 제목이 없는 유닛은 캡션에 '보이지 않는다'가 있어도 look_at을 요구하지 않는다", () => {
		expect(run([NOT_VISIBLE], undefined, "센터백: 라인 올리기")).toEqual([]);
	});
});

describe("checkNotes — unmatched_name_tags(명단에 없는 이름표)", () => {
	const TAG = { match: 1, tag: "SAMBA", color: "자홍", evidence_candidate_id: "c001" };
	const run = (caption: string, unmatched?: unknown, markerColors?: unknown) => {
		const notes = makeValidNotes();
		notes.units.u001.blocks[1].caption = `홍길동이 ${caption}`;
		if (unmatched !== undefined) notes.unmatched_name_tags = unmatched;
		if (markerColors !== undefined) notes.marker_colors = markerColors;
		return checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
	};

	test("캡션의 '<TAG> 이름표'가 명단에 없고 그 경기 unmatched_name_tags에도 없으면 필드 이름을 짚은 에러를 낸다", () => {
		const errors = run("화면 왼쪽 선수(SAMBA 이름표)가 공을 갖고 있다");
		expect(errors.map((e) => e.path)).toEqual(["unmatched_name_tags"]);
		expect(errors[0].message).toBe('u001: SAMBA 이름표는 명단 멤버의 이름·별칭·게이머태그가 아니다 — unmatched_name_tags에 { match: 1, tag: "SAMBA", color?, evidence_candidate_id }로 기록한다');
	});

	test("그 경기에 같은 tag 항목(대소문자 무시)이 있으면 통과한다", () => {
		expect(run("화면 왼쪽 선수(SAMBA 이름표)가 공을 갖고 있다", [{ ...TAG, color: undefined }])).toEqual([]);
		expect(run("화면 왼쪽 선수(samba 이름표)가 공을 갖고 있다", [{ ...TAG, color: undefined }])).toEqual([]);
	});

	test("이름표가 명단 멤버의 게이머태그이거나, 멤버 이름 바로 뒤 괄호 안의 줄임 이름표이면 에러가 아니다", () => {
		expect(run("HongGD 이름표가 보이는 선수가 공을 갖고 있다")).toEqual([]);
		expect(run("홍길동(HONG 이름표)가 공을 갖고 있다")).toEqual([]);
		expect(run("홍길동(별 표시, HONG 이름표)가 공을 갖고 있다")).toEqual([]);
	});

	test("같은 쉼표 절에서 이름표보다 앞에 '상대'가 있으면 상대 이름표라 검사하지 않고, 뒤에 있거나 다른 절에 있으면 검사한다", () => {
		expect(run("자홍 삼각형 선수(SAMBA 이름표)가 상대 하나와 붙어 있다").map((e) => e.path)).toContain("unmatched_name_tags");
		expect(run("공은 가운데 상대(MARSHALL 이름표) 발 앞에 있다")).toEqual([]);
		expect(run("상대가 서 있고, 왼쪽 선수(MARSHALL 이름표)가 공을 갖고 있다").map((e) => e.path)).toEqual(["unmatched_name_tags"]);
	});

	test("다른 경기의 항목은 이 유닛의 이름표를 덮지 못한다", () => {
		expect(run("화면 왼쪽 선수(SAMBA 이름표)가 공을 갖고 있다", [{ ...TAG, match: 2 }]).map((e) => e.path)).toContain("unmatched_name_tags");
	});

	test("이름표를 한글 자판으로 읽은 이름이 명단 이름·별칭과 같으면 그 멤버다(클럽 접두·숫자는 떼고 읽는다)", () => {
		expect(run("ghdrlfehd 이름표가 보이는 선수가 공을 갖고 있다")).toEqual([]);
		expect(run("CEF_ghdrlfehd313 이름표가 보이는 선수가 공을 갖고 있다")).toEqual([]);
		expect(run("화면 왼쪽 선수가 있다", [{ ...TAG, tag: "CEF_ghdrlfehd" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].tag"]);
	});

	test("항목의 tag가 명단 멤버와 같으면 tag 경로 에러다", () => {
		expect(run("화면 왼쪽 선수가 있다", [{ ...TAG, tag: "honggd" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].tag"]);
		expect(run("화면 왼쪽 선수가 있다", [{ ...TAG, tag: "홍길동" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].tag"]);
	});

	test("항목 모양이 틀리면 항목 경로에 에러를 낸다", () => {
		const caption = "화면 왼쪽 선수가 있다";
		expect(run(caption, "SAMBA").map((e) => e.path)).toEqual(["unmatched_name_tags"]);
		expect(run(caption, [3]).map((e) => e.path)).toEqual(["unmatched_name_tags[0]"]);
		expect(run(caption, [{ ...TAG, match: 2 }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].match"]);
		expect(run(caption, [{ ...TAG, tag: "" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].tag"]);
		expect(run(caption, [{ ...TAG, tag: "A".repeat(31) }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].tag"]);
		expect(run(caption, [{ ...TAG, color: "pink" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].color"]);
		expect(run(caption, [{ ...TAG, evidence_candidate_id: "c999" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].evidence_candidate_id"]);
		expect(run(caption, [{ ...TAG, evidence_candidate_id: "c003" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].evidence_candidate_id"]);
		expect(run(caption, [{ ...TAG, evidence_candidate_id: "c004" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[0].evidence_candidate_id"]);
	});

	test("color는 선택이고, 같은 경기에서 같은 tag 두 번이나 marker_colors와 같은 색은 에러다", () => {
		expect(run("화면 왼쪽 선수가 있다", [{ match: 1, tag: "SAMBA", evidence_candidate_id: "c001" }])).toEqual([]);
		expect(run("화면 왼쪽 선수가 있다", [TAG, { ...TAG, tag: "samba", color: "초록" }]).map((e) => e.path)).toEqual(["unmatched_name_tags[1].tag"]);
		const clash = run("화면 왼쪽 선수가 있다", [TAG], [{ match: 1, member_id: "hong-gildong", color: "자홍", evidence_candidate_id: "c001" }]);
		expect(clash.map((e) => e.path)).toEqual(["unmatched_name_tags[0].color"]);
	});
});

describe("checkNotes — '<색> 삼각형'은 그 경기 범례에 있는 색이다", () => {
	const MARKER = { match: 1, member_id: "hong-gildong", color: "분홍", evidence_candidate_id: "c001" };
	const TAG = { match: 1, tag: "SAMBA", color: "자홍", evidence_candidate_id: "c001" };
	const run = (mutate: (notes: any) => void, withLegend = true) => {
		const notes = makeValidNotes();
		if (withLegend) {
			notes.marker_colors = [MARKER];
			notes.unmatched_name_tags = [TAG];
		}
		mutate(notes);
		return checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
	};
	const legendErrors = (mutate: (notes: any) => void) => run(mutate).filter((e) => e.message.includes("범례에 없다")).map((e) => e.message);

	test("범례에 없는 색이 캡션에 있으면 유닛 id·색·경기를 짚은 에러를 낸다", () => {
		const errors = run((n) => {
			n.units.u001.blocks[1].caption = "홍길동 초록 삼각형 선수가 화면 위쪽에 있다";
		});
		expect(errors.map((e) => e.path)).toEqual(["units.u001"]);
		expect(errors[0].message).toBe("u001: 초록 삼각형은 1경기 범례에 없다 — marker_colors/unmatched_name_tags에 기록하거나 위치로만 쓴다");
	});

	test("marker_colors 색과 unmatched_name_tags 색은 통과한다(공백 없는 '분홍삼각형' 포함)", () => {
		expect(run((n) => (n.units.u001.blocks[1].caption = "홍길동 분홍 삼각형 선수 옆에 자홍삼각형 선수가 있다"))).toEqual([]);
	});

	test("fault_scene·look_at·direction_check_ko의 범례 밖 색도 에러다", () => {
		expect(legendErrors((n) => (n.units.u001.fault_scene = "자주 삼각형 선수가 비었다"))).toEqual(["u001: 자주 삼각형은 1경기 범례에 없다 — marker_colors/unmatched_name_tags에 기록하거나 위치로만 쓴다"]);
		expect(legendErrors((n) => (n.units.u001.look_at = "노랑 삼각형 선수 주변"))).toHaveLength(1);
		expect(legendErrors((n) => (n.units.u001.direction_check_ko = "파랑 삼각형 쪽이 좌측"))).toHaveLength(1);
	});

	test("같은 쉼표 절에서 색보다 앞에 '상대'가 있으면 상대 선수 이야기라 통과하고, 뒤에 있거나 다른 절이면 에러다", () => {
		expect(run((n) => (n.units.u001.blocks[1].caption = "홍길동 초록 삼각형이 상대 앞에 있다")).map((e) => e.path)).toEqual(["units.u001"]);
		expect(run((n) => (n.units.u001.blocks[1].caption = "홍길동 공은 상대 초록 삼각형 발 앞에 있다"))).toEqual([]);
		expect(run((n) => (n.units.u001.blocks[1].caption = "홍길동 상대가 둘이고, 초록 삼각형은 위쪽에 있다")).map((e) => e.path)).toEqual(["units.u001"]);
	});

	test("흰 삼각형도 범례에 없으므로 에러다", () => {
		expect(run((n) => (n.units.u001.blocks[1].caption = "홍길동 흰 삼각형 선수가 있다")).map((e) => e.path)).toEqual(["units.u001"]);
	});

	test("같은 색을 한 유닛에서 여러 번 써도 에러는 한 번이다", () => {
		const errors = run((n) => {
			n.units.u001.blocks[1].caption = "홍길동 초록 삼각형이 있고, 초록 삼각형이 또 있다";
			n.units.u001.fault_scene = "초록 삼각형 뒤가 비었다";
		});
		expect(errors.filter((e) => e.message.includes("범례에 없다"))).toHaveLength(1);
	});

	test("색 삼각형을 쓰지 않으면 범례가 없어도 에러가 아니다", () => {
		expect(run(() => {}, false)).toEqual([]);
	});
});

describe("checkNotes — marker_colors(경기별 색 삼각형 대응)", () => {
	const withMarkers = (marker_colors: unknown) => {
		const notes = makeValidNotes();
		notes.marker_colors = marker_colors;
		return checkNotes(notes, fixtureValidated, fixtureCandidates, fixtureRoster).errors;
	};
	const GOOD = { match: 1, member_id: "hong-gildong", color: "분홍", evidence_candidate_id: "c001" };

	test("marker_colors가 없거나 올바른 항목이면 통과한다", () => {
		expect(withMarkers(undefined)).toEqual([]);
		expect(withMarkers([])).toEqual([]);
		expect(withMarkers([GOOD, { match: 1, member_id: "kim-cheolsu", color: "파랑", evidence_candidate_id: "c002" }])).toEqual([]);
	});

	test("배열이 아니거나 항목 모양이 틀리면 항목 경로에 에러를 낸다", () => {
		expect(withMarkers("분홍").map((e) => e.path)).toEqual(["marker_colors"]);
		expect(withMarkers([GOOD, 3]).map((e) => e.path)).toEqual(["marker_colors[1]"]);
		expect(withMarkers([{ ...GOOD, match: 0 }]).map((e) => e.path)).toEqual(["marker_colors[0].match"]);
		expect(withMarkers([{ ...GOOD, match: 2 }]).map((e) => e.path)).toEqual(["marker_colors[0].match"]);
		expect(withMarkers([{ ...GOOD, match: 1.5 }]).map((e) => e.path)).toEqual(["marker_colors[0].match"]);
		expect(withMarkers([{ ...GOOD, color: "" }]).map((e) => e.path)).toEqual(["marker_colors[0].color"]);
		expect(withMarkers([{ ...GOOD, color: "아주아주진한분홍색삼각형" }]).map((e) => e.path)).toEqual(["marker_colors[0].color"]);
		expect(withMarkers([{ ...GOOD, color: "pink" }]).map((e) => e.path)).toEqual(["marker_colors[0].color"]);
	});

	test("명단에 없는 member_id와 없는 후보는 에러다", () => {
		expect(withMarkers([{ ...GOOD, member_id: "nobody" }]).map((e) => e.path)).toEqual(["marker_colors[0].member_id"]);
		expect(withMarkers([{ ...GOOD, evidence_candidate_id: "c999" }]).map((e) => e.path)).toEqual(["marker_colors[0].evidence_candidate_id"]);
	});

	test("증거 후보의 시각이 그 경기 범위(유닛 시간 범위 ±5초) 밖이거나 다른 영상이면 에러다", () => {
		// m1 = video A의 u001·u002 = [0,30] → 허용 [-5,35]. c004는 t=40, c003은 video B.
		expect(withMarkers([{ ...GOOD, evidence_candidate_id: "c004" }]).map((e) => e.path)).toEqual(["marker_colors[0].evidence_candidate_id"]);
		expect(withMarkers([{ ...GOOD, evidence_candidate_id: "c003" }]).map((e) => e.path)).toEqual(["marker_colors[0].evidence_candidate_id"]);
		expect(withMarkers([{ ...GOOD, evidence_candidate_id: "c002" }])).toEqual([]);
	});

	test("한 경기에서 같은 색이나 같은 사람이 두 번 나오면 에러다", () => {
		const sameColor = withMarkers([GOOD, { match: 1, member_id: "kim-cheolsu", color: "분홍", evidence_candidate_id: "c002" }]);
		expect(sameColor.map((e) => e.path)).toEqual(["marker_colors[1].color"]);
		const sameMember = withMarkers([GOOD, { match: 1, member_id: "hong-gildong", color: "파랑", evidence_candidate_id: "c002" }]);
		expect(sameMember.map((e) => e.path)).toEqual(["marker_colors[1].member_id"]);
	});

	test("명단이 없는 모드에서는 비어 있지 않은 marker_colors가 에러다", () => {
		const notes = makeValidNotes();
		notes.marker_colors = [GOOD];
		const errors = checkNotes(notes, fixtureValidated, fixtureCandidates, null).errors;
		expect(errors.some((e) => e.path === "marker_colors")).toBe(true);
	});
});

describe("checkPlan — inferred_member_ids(원문에 주어가 없어 추정한 행위자)", () => {
	const withInferred = (inferred: unknown) => {
		const plan = makeValidPlan();
		if (inferred !== undefined) plan.matches[0].topics[0].units[0].inferred_member_ids = inferred;
		return checkPlan(plan, fixtureContext);
	};

	test("필드가 없으면 빈 배열로 검증된다", () => {
		const result = withInferred(undefined);
		expect(result.errors).toEqual([]);
		expect(result.validated.units[0].inferred_member_ids).toEqual([]);
	});

	test("member_ids의 부분집합이면 통과하고 validated 유닛에 그대로 실린다", () => {
		const result = withInferred(["hong-gildong"]);
		expect(result.errors).toEqual([]);
		expect(result.validated.units[0].inferred_member_ids).toEqual(["hong-gildong"]);
	});

	test("member_ids에 없는 id나 배열이 아닌 값은 에러다", () => {
		const outside = withInferred(["kim-cheolsu"]).errors;
		expect(outside.map((e) => e.path)).toEqual(["matches[0].topics[0].units[0].inferred_member_ids[0]"]);
		expect(outside[0].message).toContain("member_ids");
		expect(withInferred("hong-gildong").errors.map((e) => e.path)).toEqual(["matches[0].topics[0].units[0].inferred_member_ids"]);
	});
});

describe("checkPlan — recurring member_ids는 묶인 유닛 member_ids의 합집합 안이어야 한다", () => {
	test("항목 member_ids에 묶인 유닛 어디에서도 고칠 사람이 아닌 사람이 있으면 에러다", () => {
		const plan = makeValidPlan();
		plan.recurring = [{ label: "수비 라인이 맞지 않음", lines: [0, 2], member_ids: ["kim-cheolsu"] }];
		const errors = checkPlan(plan, fixtureContext).errors.filter((e) => e.path === "recurring[0].member_ids");
		expect(errors.length).toBe(1);
		expect(errors[0].message).toContain("kim-cheolsu");
	});
});

describe("noteWarnings", () => {
	test("볼드 없는 text 블록만 있는 unit은 볼드 행동 없음 경고를 낸다", () => {
		const notes = makeValidNotes();
		notes.units.u001 = { blocks: [{ type: "text", text: "볼드 없는 문장입니다" }] };
		const warnings = noteWarnings(notes, fixtureRoster);
		expect(warnings).toContain(
			"fc-feedback: 경고 u001: 볼드 행동 없음 — 원문이 할 행동을 요청하면 첫 문단에 그 행동을 볼드로 쓰고, 원문에 잘못·상태·결과만 있으면 볼드 없이 둔다. 지시·평가가 없는 음성 구간이면 인접 유닛에 합칠지 확인(댓글 유닛은 합치지 않는다)",
		);
	});


	test("볼드 스팬이 과거형(마지막 한글 음절 받침 ㅆ, 끝의 다/고는 건너뜀)이면 스팬을 짚는 경고를 낸다", () => {
		for (const span of ["우리 마크가 두 명 붙었다", "가로채기를 시도했다", "마크를 놓쳤고"]) {
			const notes = makeValidNotes();
			notes.units.u001 = { blocks: [{ type: "text", text: `**${span}** 상황이다` }, { type: "frame", candidate_id: "c001", caption: "장면" }] };
			const warnings = noteWarnings(notes, fixtureRoster).filter((warning) => warning.includes("과거형"));
			expect(warnings).toEqual([
				`fc-feedback: 경고 유닛 u001 볼드 "${span}"가 과거형입니다 — 볼드는 원문이 요청한 할 행동만 짚습니다(잘못한 행동·결과는 볼드하지 않음)`,
			]);
		}
	});

	test("할 행동을 말하는 볼드 스팬은 과거형 경고를 내지 않는다", () => {
		for (const span of ["빠르게 페널티 박스에서 소산해야", "더 올라가면", "짧게 패스하는", "상대 격수 가까이 있고", "포켓을 보고 있다"]) {
			const notes = makeValidNotes();
			notes.units.u001 = { blocks: [{ type: "text", text: `**${span}** 좋겠다` }, { type: "frame", candidate_id: "c001", caption: "장면" }] };
			expect(noteWarnings(notes, fixtureRoster).filter((warning) => warning.includes("과거형"))).toEqual([]);
		}
	});

	test("볼드 밖의 과거형과 한글로 끝나지 않는 볼드 스팬은 과거형 경고를 내지 않는다", () => {
		const notes = makeValidNotes();
		notes.units.u001 = { blocks: [{ type: "text", text: "상대가 붙었다 **A와 B** 사이를 좁혀야 한다 **1:1**" }, { type: "frame", candidate_id: "c001", caption: "장면" }] };
		expect(noteWarnings(notes, fixtureRoster).filter((warning) => warning.includes("과거형"))).toEqual([]);
	});

	test("볼드·frame이 모두 있는 unit은 경고가 없다", () => {
		const notes = makeValidNotes();
		notes.units.u001 = {
			blocks: [
				{ type: "text", text: "**볼드** 문장입니다" },
				{ type: "frame", candidate_id: "c001", caption: "장면" },
			],
		};
		const warnings = noteWarnings(notes, fixtureRoster).filter((warning) => warning.includes("u001"));
		expect(warnings).toEqual([]);
	});
});

describe("noteWarnings — 본문에 나온 사람이 캡션에 없음", () => {
	const unit = (text: string, caption: string, extra: object = {}) => ({
		version: 2 as const,
		units: { u001: { blocks: [{ type: "text" as const, text }, { type: "frame" as const, candidate_id: "c001", caption }], ...extra } },
	});
	const missing = (notes: ReturnType<typeof unit>) => noteWarnings(notes, fixtureRoster).filter((w) => w.includes("어느 캡션에도 없음"));

	test("본문에 이름이 나왔는데 어느 캡션에도 없으면 사람마다 경고한다", () => {
		expect(missing(unit("**김철수**에게 패스했어야 한다", "홍길동이 공을 잡은 순간"))).toEqual([
			"fc-feedback: 경고 u001: 본문에 나온 김철수이(가) 어느 캡션에도 없음 — 패스 받을 사람·간격 상대면 둘이 함께 보이는 프레임을 고르고 캡션에 둘의 위치를 쓴다",
		]);
	});

	test("게이머태그·별칭 매칭이고, 캡션이 짚었거나 unidentified_member_ids에 있으면 경고하지 않는다", () => {
		expect(missing(unit("KimCS에게 패스했어야 한다", "홍길동이 공을 잡은 순간")).length).toBe(1);
		expect(missing(unit("김철수에게 패스했어야 한다", "홍길동과 김철수가 함께 보인다"))).toEqual([]);
		expect(missing(unit("김철수에게 패스했어야 한다", "홍길동이 공을 잡은 순간", { unidentified_member_ids: ["kim-cheolsu"], look_at: "위쪽" }))).toEqual([]);
		expect(missing(unit("패스를 늦게 했다", "홍길동이 공을 잡은 순간"))).toEqual([]);
	});

	test("명단이 없으면(disabled) 이 경고를 내지 않는다", () => {
		expect(noteWarnings(unit("김철수에게 패스했어야 한다", "장면"), null).filter((w) => w.includes("어느 캡션에도 없음"))).toEqual([]);
	});
});

describe("noteWarnings — 화면 방향 캡션과 focus_x", () => {
	const warningsFor = (block: any) => noteWarnings({ version: 2, units: { u001: { blocks: [{ type: "text", text: "**행동** 문장" }, block] } } }, fixtureRoster).filter((w) => w.includes("focus_x"));

	test("캡션이 화면 방향을 말하는데 focus_x가 없으면 경고한다", () => {
		for (const caption of ["화면 왼쪽 홍길동이 서 있음", "화면 오른쪽 아래에서 받음", "왼쪽 끝 수비수가 올라옴", "오른쪽 끝에 공간이 비어 있음"]) {
			const warnings = warningsFor({ type: "frame", candidate_id: "c001", caption });
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("u001");
			expect(warnings[0]).toContain("c001");
		}
	});

	test("focus_x가 있거나 화면 방향을 말하지 않는 캡션은 경고하지 않는다(focus_x 0도 값이다)", () => {
		expect(warningsFor({ type: "frame", candidate_id: "c001", caption: "화면 왼쪽 홍길동", focus_x: 0 })).toEqual([]);
		expect(warningsFor({ type: "frame", candidate_id: "c001", caption: "홍길동이 패스를 미스한 순간" })).toEqual([]);
	});
});

describe("boldSpans", () => {
	test("볼드가 없으면 평문 구간 하나만 반환한다", () => {
		expect(boldSpans("그냥 텍스트입니다")).toEqual([{ bold: false, text: "그냥 텍스트입니다" }]);
	});

	test("볼드 하나를 평문/볼드/평문 순서로 분리한다", () => {
		expect(boldSpans("이것은 **강조**입니다")).toEqual([
			{ bold: false, text: "이것은 " },
			{ bold: true, text: "강조" },
			{ bold: false, text: "입니다" },
		]);
	});

	test("볼드 여러 개를 순서대로 분리한다", () => {
		expect(boldSpans("**첫째** 그리고 **둘째**")).toEqual([
			{ bold: true, text: "첫째" },
			{ bold: false, text: " 그리고 " },
			{ bold: true, text: "둘째" },
		]);
	});

	test("사이 평문 없이 볼드가 연달아 있으면 볼드 구간 두 개를 반환한다", () => {
		expect(boldSpans("**a****b**")).toEqual([
			{ bold: true, text: "a" },
			{ bold: true, text: "b" },
		]);
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
		recurring_unfound: [],
		units_unfound: [{ unit_id: "u002", queries: ["pro clubs gk distribution", "골키퍼 배급 프로클럽"], subtitle_terms: ["배급", "distribution"] }],
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
				format: "article",
				recurring_labels: [],
				relevance_ko: { u001: "센터백 패스 미스 장면의 전진 패스 각도를 다룬다" },
			},
		],
	};
}

describe("checkRefsDraft — recurring_unfound(반복 지적 커버리지)", () => {
	const LABEL = "수비 라인이 맞지 않음";
	const recurringValidated: ValidatedPlan = checkPlan(
		{ ...makeValidPlan(), recurring: [{ label: LABEL, lines: [0, 2], member_ids: [] }] },
		fixtureContext,
	).validated; // 반복 항목 unit_ids = [u001, u002]

	function draftWith(recurringUnfound: unknown, refUnitIds: string[] | null, recurringLabels: unknown[] = [LABEL]): any {
		const draft = makeValidRefsDraft();
		if (refUnitIds === null) draft.refs = [];
		else {
			draft.refs[0].unit_ids = refUnitIds;
			draft.refs[0].relevance_ko = Object.fromEntries(refUnitIds.map((id) => [id, "관련성 문장"]));
			draft.refs[0].recurring_labels = recurringLabels;
		}
		draft.units_unfound = ["u001", "u002"]
			.filter((id) => !(refUnitIds ?? []).includes(id))
			.map((id) => ({ unit_id: id, queries: [`${id} 검색 a`, `${id} 검색 b`], subtitle_terms: [`x${id}`] }));
		if (recurringUnfound === undefined) delete draft.recurring_unfound;
		else draft.recurring_unfound = recurringUnfound;
		return draft;
	}
	const messages = (draft: unknown) => checkRefsDraft(draft, recurringValidated).errors.map((e) => e.message).join("\n");

	test("필드가 없으면 recurring_unfound: []를 추가하라는 안내와 함께 에러를 낸다", () => {
		expect(messages(draftWith(undefined, ["u001"]))).toContain('"recurring_unfound": []');
	});

	test("반복 항목의 unit 중 하나에 붙고 recurring_labels에 label을 적은 ref가 있으면 통과한다", () => {
		expect(checkRefsDraft(draftWith([], ["u002"]), recurringValidated).errors).toEqual([]);
	});

	test("반복 항목의 unit에 붙었어도 recurring_labels에 label이 없으면 덮은 것이 아니다 — recurring_unfound 기록을 허용한다", () => {
		expect(messages(draftWith([], ["u001"], []))).toContain(LABEL);
		expect(checkRefsDraft(draftWith([{ label: LABEL, queries: ["a 검색", "b 검색"], subtitle_terms: ["라인"] }], ["u001"], []), recurringValidated).errors).toEqual([]);
	});

	test("recurring_labels가 없거나, plan에 없는 label이거나, 그 label의 유닛에 붙지 않은 ref면 에러다", () => {
		const missing = draftWith([], ["u001"]);
		delete missing.refs[0].recurring_labels;
		expect(findError(checkRefsDraft(missing, recurringValidated).errors, "refs[0].recurring_labels")).toBe(true);
		expect(findError(checkRefsDraft(draftWith([], ["u001"], ["없는 label"]), recurringValidated).errors, "refs[0].recurring_labels[0]")).toBe(true);
		const unrelated = { ...makeValidPlan(), recurring: [{ label: LABEL, lines: [2, 2], member_ids: [] }] };
		unrelated.matches[0].topics[0].units[1].start_line = 2;
		const singleValidated = checkPlan(unrelated, fixtureContext).validated; // unit_ids = [u002]
		expect(findError(checkRefsDraft(draftWith([], ["u001"]), singleValidated).errors, "refs[0].recurring_labels[0]")).toBe(true);
	});

	test("ref도 없고 recurring_unfound도 없으면 label을 이름으로 든 에러를 낸다", () => {
		expect(messages(draftWith([], null))).toContain(LABEL);
	});

	test("recurring_unfound에 label + 검색어 2개 이상이 있으면 통과하고, 1개면 에러다", () => {
		expect(checkRefsDraft(draftWith([{ label: LABEL, queries: ["a 검색", "b 검색"], subtitle_terms: ["라인"] }], null), recurringValidated).errors).toEqual([]);
		expect(messages(draftWith([{ label: LABEL, queries: ["a 검색", "  "], subtitle_terms: ["라인"] }], null))).toContain("queries");
	});

	test("recurring_unfound 항목은 subtitle_terms를 비어 있지 않은 문자열 1개 이상으로 가져야 한다", () => {
		const entry = (subtitleTerms: unknown) => ({ label: LABEL, queries: ["a 검색", "b 검색"], ...(subtitleTerms === undefined ? {} : { subtitle_terms: subtitleTerms }) });
		for (const bad of [undefined, [], ["  "], "라인"]) {
			const errors = checkRefsDraft(draftWith([entry(bad)], null), recurringValidated).errors;
			expect(errors.map((e) => e.path)).toEqual(["recurring_unfound[0].subtitle_terms"]);
		}
		expect(checkRefsDraft(draftWith([entry(["옵사", "line"])], null), recurringValidated).errors).toEqual([]);
	});

	test("plan에 없는 label이나 이미 ref가 덮은 label을 recurring_unfound에 적으면 에러다", () => {
		expect(messages(draftWith([{ label: "없는 label", queries: ["a", "b"], subtitle_terms: ["x"] }], ["u001"]))).toContain("없는 label");
		expect(messages(draftWith([{ label: LABEL, queries: ["a", "b"], subtitle_terms: ["x"] }], ["u001"]))).toContain("이미 참고자료가 연결된");
	});
});

describe("checkRefsDraft — unfound 기록은 실제 검색이어야 한다", () => {
	const recurringValidated: ValidatedPlan = checkPlan(
		{ ...makeValidPlan(), recurring: [{ label: "수비 라인이 맞지 않음", lines: [0, 2], member_ids: [] }] },
		fixtureContext,
	).validated; // 반복 항목 unit_ids = [u001, u002]
	const draftOf = (units: Array<Record<string, unknown>>, recurring: Array<Record<string, unknown>> = []): any => {
		const draft = makeValidRefsDraft();
		draft.refs = [];
		draft.recurring_unfound = recurring;
		draft.units_unfound = units;
		return draft;
	};
	const unit = (unitId: string, overrides: Record<string, unknown> = {}) => ({ unit_id: unitId, queries: [`${unitId} 검색 하나`, `${unitId} 검색 둘`], subtitle_terms: [`${unitId}용어`], ...overrides });
	const run = (draft: any, roster: Roster | null = fixtureRoster) => checkRefsDraft(draft, draft.recurring_unfound.length > 0 ? recurringValidated : fixtureValidated, roster).errors;

	test("서로 다른 검색어·용어의 기록은 통과한다", () => {
		expect(run(draftOf([unit("u001"), unit("u002")], [{ label: "수비 라인이 맞지 않음", queries: ["라인 간격 a", "라인 간격 b"], subtitle_terms: ["간격"] }]))).toEqual([]);
	});

	test("검색어에 명단 팀원의 이름·별칭·게이머태그가 있으면(대소문자 무시) 그 항목의 queries 경로 에러다", () => {
		for (const name of ["홍길동", "honggd"]) {
			const errors = run(draftOf([unit("u001", { queries: [`pro clubs ${name} 수비`, "센터백 전진 패스 각도"] }), unit("u002")]));
			expect(errors.map((e) => e.path)).toEqual(["units_unfound[0].queries"]);
			expect(errors[0].message).toContain("u001");
			expect(errors[0].message).toContain("팀원");
		}
		expect(run(draftOf([unit("u001", { queries: ["홍길동 수비", "센터백 패스"] }), unit("u002")]), null)).toEqual([]);
	});

	test("recurring_unfound의 검색어에 팀원 이름이 있어도 에러다", () => {
		const errors = run(draftOf([unit("u001"), unit("u002")], [{ label: "수비 라인이 맞지 않음", queries: ["김철수 라인", "라인 간격"], subtitle_terms: ["간격"] }]));
		expect(errors.map((e) => e.path)).toEqual(["recurring_unfound[0].queries"]);
	});

	test("recurring_unfound는 게임 용어(fc·fifa·피파·프로클럽·pro clubs·eafc)가 없는 검색어를 하나는 가져야 한다", () => {
		const recurring = (queries: string[]) => [{ label: "수비 라인이 맞지 않음", queries, subtitle_terms: ["간격"] }];
		const errors = run(draftOf([unit("u001"), unit("u002")], recurring(["FC 26 라인 간격", "피파 수비 라인", "프로클럽 수비", "pro clubs defending", "eafc back line", "EA FC 26 line"])));
		expect(errors.map((e) => e.path)).toEqual(["recurring_unfound[0].queries"]);
		expect(errors[0].message).toContain("수비 라인이 맞지 않음");
		expect(errors[0].message).toContain("게임 용어");
		expect(run(draftOf([unit("u001"), unit("u002")], recurring(["FC 26 라인 간격", "백포 라인 간격 맞추기"])))).toEqual([]);
		expect(run(draftOf([unit("u001"), unit("u002")], recurring(["fifa line", "soccer defensive line spacing"])))).toEqual([]);
		// 'fc'로 시작하는 낱말(fcb 등)은 게임 용어가 아니다
		expect(run(draftOf([unit("u001"), unit("u002")], recurring(["피파 라인", "fcb defensive line"])))).toEqual([]);
	});

	test("게임 용어 검사는 recurring_unfound에만 걸리고 units_unfound는 그대로다", () => {
		expect(run(draftOf([unit("u001", { queries: ["FC 26 패스", "fifa 패스"] }), unit("u002")]))).toEqual([]);
	});

	test("같은 검색어 문자열이 unfound 항목 3개 이상에 있으면 에러다(2개는 통과)", () => {
		const shared = "pro clubs fc 26 defending tips";
		const three = draftOf([unit("u001", { queries: [shared, "a 둘"] }), unit("u002", { queries: [shared, "b 둘"] })], [
			{ label: "수비 라인이 맞지 않음", queries: [` ${shared.toUpperCase()} `, "c 둘"], subtitle_terms: ["간격"] },
		]);
		const errors = run(three);
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain(shared);
		expect(errors[0].message).toContain("3");
		three.recurring_unfound = [];
		expect(run(three)).toEqual([]);
	});

	test("같은 subtitle_terms 집합(순서 무관)이 3개 이상에 있으면 에러다", () => {
		const terms = (list: string[]) => ({ subtitle_terms: list });
		const draft = draftOf([unit("u001", terms(["수비", "패스", "defend"])), unit("u002", terms(["defend", "수비", "패스"]))], [
			{ label: "수비 라인이 맞지 않음", queries: ["x 하나", "x 둘"], ...terms(["패스", "defend", "수비"]) },
		]);
		const errors = run(draft);
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("subtitle_terms");
		draft.recurring_unfound[0].subtitle_terms = ["수비", "패스"];
		expect(run(draft)).toEqual([]);
	});
});

describe("checkRefsDraft — units_unfound(자료 없는 유닛)", () => {
	const draftWithUnfound = (unitsUnfound: unknown): any => {
		const draft = makeValidRefsDraft(); // u001에만 ref가 붙어 있다 -> u002가 자료 없는 유닛
		if (unitsUnfound === undefined) delete draft.units_unfound;
		else draft.units_unfound = unitsUnfound;
		return draft;
	};
	const entry = (overrides: Record<string, unknown> = {}) => ({ unit_id: "u002", queries: ["a 검색", "b 검색"], subtitle_terms: ["배급"], ...overrides });
	const errorsOf = (draft: unknown) => checkRefsDraft(draft, fixtureValidated).errors;

	test("자료 없는 유닛마다 항목이 하나씩 있으면 통과한다", () => {
		expect(errorsOf(draftWithUnfound([entry()]))).toEqual([]);
	});

	test("필드가 없거나 배열이 아니면 units_unfound 경로 에러를 낸다", () => {
		expect(errorsOf(draftWithUnfound(undefined)).map((e) => e.path)).toContain("units_unfound");
		expect(errorsOf(draftWithUnfound({})).map((e) => e.path)).toContain("units_unfound");
	});

	test("자료도 항목도 없는 유닛은 그 유닛 id를 든 에러를 낸다", () => {
		const errors = errorsOf(draftWithUnfound([]));
		expect(errors.map((e) => e.path)).toEqual(["units_unfound"]);
		expect(errors[0].message).toContain("u002");
	});

	test("자료가 붙은 유닛, plan에 없는 id, 중복 id는 각각 에러다", () => {
		expect(errorsOf(draftWithUnfound([entry(), entry({ unit_id: "u001" })])).map((e) => e.path)).toEqual(["units_unfound[1].unit_id"]);
		expect(errorsOf(draftWithUnfound([entry(), entry({ unit_id: "u999" })])).map((e) => e.path)).toEqual(["units_unfound[1].unit_id"]);
		const dup = errorsOf(draftWithUnfound([entry(), entry()]));
		expect(dup.map((e) => e.path)).toEqual(["units_unfound[1].unit_id"]);
		expect(dup[0].message).toContain("중복");
	});

	test("queries는 2개 이상, subtitle_terms는 1개 이상(비어 있지 않게)이어야 한다", () => {
		expect(errorsOf(draftWithUnfound([entry({ queries: ["a 검색"] })])).map((e) => e.path)).toEqual(["units_unfound[0].queries"]);
		expect(errorsOf(draftWithUnfound([entry({ queries: ["a", " "] })])).map((e) => e.path)).toEqual(["units_unfound[0].queries"]);
		expect(errorsOf(draftWithUnfound([entry({ subtitle_terms: [] })])).map((e) => e.path)).toEqual(["units_unfound[0].subtitle_terms"]);
		expect(errorsOf(draftWithUnfound([entry({ subtitle_terms: ["  "] })])).map((e) => e.path)).toEqual(["units_unfound[0].subtitle_terms"]);
		expect(errorsOf(draftWithUnfound(["문자열"])).map((e) => e.path)).toEqual(["units_unfound[0]", "units_unfound"]);
	});
});

describe("matchGameVersion / refsMatchVersionErrors", () => {
	test("영상 제목에서 FC/FIFA 버전을 읽고, 없거나 서로 다르면 null이다", () => {
		expect(matchGameVersion(["FC26 KFPL Club(1001) [Los Veteranos]"])).toBe("FC 26");
		expect(matchGameVersion(["EAFC24 프로클럽 연습 - Part 3", "EA FC 24 Part 2"])).toBe("FC 24");
		expect(matchGameVersion(["FIFA 23 pro clubs"])).toBe("FIFA 23");
		expect(matchGameVersion(["프로클럽 연습"])).toBeNull();
		expect(matchGameVersion(["FC 25 경기", "FC 26 경기"])).toBeNull();
	});

	test("이번 경기 버전을 제목과 다르게 적거나 버전이 없는데 적으면 그 문장 경로에 에러를 낸다", () => {
		const draft = { refs: [{ summary_ko: "이번 경기(FC 27)보다 한 버전 앞선 자료다.", key_points_ko: ["이번 경기 FC26 기준"], relevance_ko: { u001: "관련" } }] };
		const errors = refsMatchVersionErrors(draft, "FC 26");
		expect(errors.map((e) => e.path)).toEqual(["refs[0].summary_ko"]);
		expect(errors[0].message).toContain("FC 26");
		expect(refsMatchVersionErrors(draft, null).map((e) => e.path)).toEqual(["refs[0].summary_ko", "refs[0].key_points_ko[0]"]);
	});
});

describe("refVersionBadge / publishedBadge", () => {
	test("자료 버전이 경기 버전보다 앞서면 이전 버전으로 적고, 버전이 없으면 배지가 없다(null)", () => {
		expect(refVersionBadge("FC 25", "FC 26")).toBe("FC 25 · 이전 버전");
		expect(refVersionBadge("FIFA 23", "FC 26")).toBe("FIFA 23 · 이전 버전");
		expect(refVersionBadge("FC 26", "FC 26")).toBe("FC 26");
		expect(refVersionBadge("FC 25", null)).toBe("FC 25");
		expect(refVersionBadge(null, "FC 26")).toBeNull();
	});

	test("publishedBadge는 업로드 연월을 'YYYY년 M월'로 적는다", () => {
		expect(publishedBadge("2023-01")).toBe("2023년 1월");
		expect(publishedBadge("2024-12")).toBe("2024년 12월");
	});
});

describe("recurringPartialCoverageWarnings", () => {
	const LABEL = "수비 라인이 맞지 않음";
	const validated: ValidatedPlan = checkPlan(
		{ ...makeValidPlan(), recurring: [{ label: LABEL, lines: [0, 2], member_ids: [] }] },
		fixtureContext,
	).validated; // 반복 항목 unit_ids = [u001, u002]
	const refOn = (unitIds: string[], recurringLabels: string[] = [LABEL]) => ({ refs: [{ unit_ids: unitIds, recurring_labels: recurringLabels }] });

	test("일부 유닛에만 ref가 있으면 자료 없는 유닛을 이름으로 든 경고 한 줄을 낸다", () => {
		expect(recurringPartialCoverageWarnings(refOn(["u001"]), validated)).toEqual([
			`fc-feedback: 경고 반복 지적 "${LABEL}": 자료 없는 유닛 u002`,
		]);
	});

	test("전부 덮였거나 하나도 안 덮였으면 경고하지 않는다(후자는 차단 에러의 몫)", () => {
		expect(recurringPartialCoverageWarnings(refOn(["u001", "u002"]), validated)).toEqual([]);
		expect(recurringPartialCoverageWarnings({ refs: [] }, validated)).toEqual([]);
	});

	test("label을 덮은 ref가 없는데 그 유닛에 다른 ref가 붙어 있으면 그 ref를 든 경고를 낸다", () => {
		expect(recurringPartialCoverageWarnings(refOn(["u002"], []), validated)).toEqual([
			`fc-feedback: 경고 반복 지적 "${LABEL}"을 덮은 자료가 없지만 그 유닛에 자료 1(u002)가 붙어 있습니다 — 그 자료가 이 잘못을 다루면 recurring_labels에 적고 나머지 유닛에도 붙입니다`,
		]);
	});

	test("label을 적지 않은 ref는 그 반복 지적의 커버리지로 세지 않는다", () => {
		const draft = { refs: [...refOn(["u001"]).refs, ...refOn(["u002"], []).refs] };
		expect(recurringPartialCoverageWarnings(draft, validated)).toEqual([`fc-feedback: 경고 반복 지적 "${LABEL}": 자료 없는 유닛 u002`]);
	});
});

describe("recurringProClubsWarnings", () => {
	// 반복 항목 둘: "두 번 나온 지적"(유닛 u001·u002)과 "세 번 나온 지적"(u001·u002·u003, 가장 많음).
	const plan = makeValidPlan();
	plan.matches[0].topics[0].units.push({
		start_line: 3, end_line: 3, title: "센터백: 라인 올리기", position_tags: ["CB"], topic_tags: ["빌드업"], member_ids: [], key_frame_candidate_ids: ["c003"], group_positions: [],
	});
	plan.recurring = [
		{ label: "두 번 나온 지적", lines: [0, 2], member_ids: [] },
		{ label: "세 번 나온 지적", lines: [0, 2, 3], member_ids: [] },
	];
	const validated: ValidatedPlan = checkPlan(plan, fixtureContext).validated;
	const MOST = "세 번 나온 지적";
	const refWith = (labels: string[], proClubs?: boolean) => ({ unit_ids: ["u001"], recurring_labels: labels, ...(proClubs === undefined ? {} : { pro_clubs: proClubs }) });
	const WARNING = (label: string) => `fc-feedback: 경고 가장 많이 반복된 '${label}'에 프로클럽 자료가 없다 — 프로클럽 수비전술 강좌·같은 채널 label 핵심어로 더 찾는다`;

	test("fixture가 유닛 수가 가장 많은 label을 만든다", () => {
		expect(validated.recurring.map((entry) => [entry.label, entry.unit_ids.length])).toEqual([["두 번 나온 지적", 2], [MOST, 3]]);
	});

	test("유닛이 가장 많은 label에 pro_clubs: true인 자료가 없으면 그 label을 든 경고 한 줄을 낸다", () => {
		expect(recurringProClubsWarnings({ refs: [] }, validated)).toEqual([WARNING(MOST)]);
		expect(recurringProClubsWarnings({ refs: [refWith([MOST], false)] }, validated)).toEqual([WARNING(MOST)]);
		expect(recurringProClubsWarnings({ refs: [refWith([MOST])] }, validated)).toEqual([WARNING(MOST)]);
	});

	test("다른 label을 적었거나 label을 적지 않은 프로클럽 자료는 그 label을 덮지 않는다", () => {
		expect(recurringProClubsWarnings({ refs: [refWith(["두 번 나온 지적"], true), refWith([], true)] }, validated)).toEqual([WARNING(MOST)]);
	});

	test("그 label에 pro_clubs: true인 자료가 붙어 있으면 경고하지 않는다", () => {
		expect(recurringProClubsWarnings({ refs: [refWith([MOST], false), refWith([MOST], true)] }, validated)).toEqual([]);
	});

	test("유닛 수가 같으면 먼저 나온 label을 고르고, 반복 지적이 없으면 경고하지 않는다", () => {
		const tied: ValidatedPlan = { ...validated, recurring: validated.recurring.map((entry) => ({ ...entry, unit_ids: ["u001", "u002"] })) };
		expect(recurringProClubsWarnings({ refs: [] }, tied)).toEqual([WARNING("두 번 나온 지적")]);
		expect(recurringProClubsWarnings({ refs: [] }, { ...validated, recurring: [] })).toEqual([]);
	});
});

describe("checkRefsDraft", () => {
	test("유효한 refs-draft를 검증하면 에러가 없다", () => {
		const result = checkRefsDraft(makeValidRefsDraft(), fixtureValidated);
		expect(result.errors).toEqual([]);
	});

	test("format이 video/article이 아니면 refs[n].format 경로 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		delete draft.refs[0].format;
		expect(findError(checkRefsDraft(draft, fixtureValidated).errors, "refs[0].format")).toBe(true);
	});

	test("relevance_ko는 unit_ids의 각 유닛마다 정확히 한 문장(1–120자, 개행 없음)이어야 한다", () => {
		const missing = makeValidRefsDraft();
		missing.refs[0].unit_ids = ["u001", "u002"];
		expect(findError(checkRefsDraft(missing, fixtureValidated).errors, "refs[0].relevance_ko.u002")).toBe(true);

		const extra = makeValidRefsDraft();
		extra.refs[0].relevance_ko.u002 = "unit_ids에 없는 유닛";
		expect(findError(checkRefsDraft(extra, fixtureValidated).errors, "refs[0].relevance_ko.u002")).toBe(true);

		const tooLong = makeValidRefsDraft();
		tooLong.refs[0].relevance_ko.u001 = "가".repeat(121);
		expect(findError(checkRefsDraft(tooLong, fixtureValidated).errors, "refs[0].relevance_ko.u001")).toBe(true);
	});

	test("relevance_ko가 상황 차이를 양보하는 말('예시지만' 등)을 담으면 자료·유닛을 짚은 에러를 낸다", () => {
		for (const phrase of ["예시지만", "예시이지만", "예시에서는", "상황은 다르지만", "상황이 다르지만"]) {
			const draft = makeValidRefsDraft();
			draft.refs[0].relevance_ko.u001 = `다른 팀 ${phrase} 센터백 전진 패스 각도를 다룬다`;
			const errors = checkRefsDraft(draft, fixtureValidated).errors;
			expect(errors.map((e) => e.path)).toEqual(["refs[0].relevance_ko.u001"]);
			expect(errors[0].message).toBe(`전술 아티클 u001: relevance_ko가 상황 차이를 양보한다('${phrase}') — 상황이 다른 구간은 붙이지 않는다`);
		}
		expect(checkRefsDraft(makeValidRefsDraft(), fixtureValidated).errors).toEqual([]);
	});

	test("'상황이 다르다'·'상황은/과는/과도 다르다'·'상황 기준이다'처럼 어미가 달라도 상황 차이를 양보하면 에러다(relevance_ko·lesson_ko)", () => {
		for (const phrase of ["상황이 다르다", "상황은 다르다", "상황과는 다르다", "상황과도 다르다", "상황이  다르다", "상황 기준이다"]) {
			const draft = makeValidRefsDraft();
			draft.refs[0].relevance_ko.u001 = `박스 안 실점 장면과는 ${phrase}`;
			const errors = checkRefsDraft(draft, fixtureValidated).errors;
			expect(errors.map((e) => e.path)).toEqual(["refs[0].relevance_ko.u001"]);
			expect(errors[0].message).toContain("상황 차이를 양보한다");
		}
		const lesson = makeValidRefsDraft();
		lesson.refs[0].lesson_ko = { u001: "우리 숫자가 적은 상황 기준이다" };
		const lessonErrors = checkRefsDraft(lesson, fixtureValidated).errors;
		expect(lessonErrors.map((e) => e.path)).toEqual(["refs[0].lesson_ko.u001"]);
		expect(lessonErrors[0].message).toBe("전술 아티클 u001: lesson_ko가 상황 차이를 양보한다('상황 기준이') — 상황이 다른 구간은 붙이지 않는다");
		const fine = makeValidRefsDraft();
		fine.refs[0].relevance_ko.u001 = "같은 상황에서 센터백이 전진 패스 각도를 만드는 법을 다룬다";
		expect(checkRefsDraft(fine, fixtureValidated).errors).toEqual([]);
	});

	test("relevance_ko·lesson_ko에 내부 용어(카드 장면·이 카드·카드의·유닛)가 있으면 그 경로에 에러를 내고, 진짜 축구 카드는 걸리지 않는다", () => {
		const message = (path: string, word: string) => `${path}: 독자에게 보이는 문장에 내부 용어 "${word}"가 있다 — 장면은 "이 장면"으로 쓴다`;
		for (const word of ["카드 장면", "이 카드", "카드의", "유닛"]) {
			const draft = makeValidRefsDraft();
			draft.refs[0].relevance_ko.u001 = `${word}을 보면 뺏으려고 누른 태클을 다룬다`;
			const errors = checkRefsDraft(draft, fixtureValidated).errors;
			expect(errors.map((e) => e.path)).toEqual(["refs[0].relevance_ko.u001"]);
			expect(errors[0].message).toBe(message("refs[0].relevance_ko.u001", word));
		}
		const lesson = makeValidRefsDraft();
		lesson.refs[0].lesson_ko = { u001: "이 유닛에서는 한 발 늦게 태클한다" };
		const lessonErrors = checkRefsDraft(lesson, fixtureValidated).errors;
		expect(lessonErrors.map((e) => e.path)).toEqual(["refs[0].lesson_ko.u001"]);
		expect(lessonErrors[0].message).toBe(message("refs[0].lesson_ko.u001", "유닛"));
		for (const real of ["옐로 카드", "옐로카드", "레드 카드", "레드카드", "경고 카드"]) {
			const fine = makeValidRefsDraft();
			fine.refs[0].relevance_ko.u001 = `${real}가 나오는 태클과 같은 장면을 다룬다`;
			expect(checkRefsDraft(fine, fixtureValidated).errors).toEqual([]);
		}
		const mixed = makeValidRefsDraft();
		mixed.refs[0].relevance_ko.u001 = "옐로 카드가 나온 이 카드 장면을 다룬다";
		expect(checkRefsDraft(mixed, fixtureValidated).errors.map((e) => e.message)).toEqual([message("refs[0].relevance_ko.u001", "카드 장면"), message("refs[0].relevance_ko.u001", "이 카드")]);
	});

	describe("lesson_ko(자료가 권하는 행동)", () => {
		/** u001 제목이 -ㅁ 지적인 검증된 plan. */
		const faultValidated = (): ValidatedPlan => {
			const plan = makeValidPlan();
			plan.matches[0].topics[0].units[0].title = "센터백: 첫판부터 정신 놓음";
			return checkPlan(plan, fixtureContext).validated;
		};
		const pathsOf = (draft: unknown, validated: ValidatedPlan = faultValidated()) => checkRefsDraft(draft, validated).errors.map((e) => e.path);

		test("제목에 -ㅁ 지적 조각이 있는 유닛에 자료가 붙었는데 어느 자료도 그 유닛의 lesson_ko를 주지 않으면 에러다", () => {
			const draft = makeValidRefsDraft();
			const errors = checkRefsDraft(draft, faultValidated()).errors;
			expect(errors.map((e) => e.path)).toEqual(["refs"]);
			expect(errors[0].message).toContain("u001");
			expect(errors[0].message).toContain("lesson_ko");
			draft.refs[0].lesson_ko = { u001: "포백이 한 줄로 서서 한 덩어리로 움직인다" };
			expect(pathsOf(draft)).toEqual([]);
		});

		test("같은 유닛에 자료가 둘이면 하나만 lesson_ko를 줘도 된다", () => {
			const draft = makeValidRefsDraft();
			draft.refs.push({ ...draft.refs[0], url: "https://example.com/other", lesson_ko: { u001: "공을 받기 전에 먼저 둘러본다" } });
			expect(pathsOf(draft)).toEqual([]);
		});

		test("-ㅁ 조각이 없는 제목이거나 자료가 안 붙은 유닛은 lesson_ko가 없어도 된다", () => {
			expect(pathsOf(makeValidRefsDraft(), fixtureValidated)).toEqual([]);
			const draft = makeValidRefsDraft();
			draft.refs[0].unit_ids = ["u002"];
			draft.refs[0].relevance_ko = { u002: "골키퍼 배급 장면의 짧은 패스 각도를 다룬다" };
			draft.units_unfound = [{ unit_id: "u001", queries: ["a b", "c d"], subtitle_terms: ["정신"] }];
			expect(pathsOf(draft)).toEqual([]);
		});

		test("lesson_ko는 unit_ids의 유닛만 키로 갖고 값은 trim 후 1–80자 한 줄이다", () => {
			const base = (lesson: unknown) => {
				const draft = makeValidRefsDraft();
				draft.refs[0].lesson_ko = lesson;
				return draft;
			};
			const ok = { u001: "포백이 한 줄로 선다" };
			expect(pathsOf(base(ok))).toEqual([]);
			expect(pathsOf(base({ ...ok, u002: "unit_ids에 없는 유닛" }))).toEqual(["refs[0].lesson_ko.u002"]);
			expect(pathsOf(base({ u001: "가".repeat(81) }), fixtureValidated)).toEqual(["refs[0].lesson_ko.u001"]);
			expect(pathsOf(base({ u001: "가".repeat(80) }), fixtureValidated)).toEqual([]);
			expect(pathsOf(base({ u001: "  " }), fixtureValidated)).toEqual(["refs[0].lesson_ko.u001"]);
			expect(pathsOf(base({ u001: "위\n아래" }), fixtureValidated)).toEqual(["refs[0].lesson_ko.u001"]);
			expect(pathsOf(base(["배열"]), fixtureValidated)).toEqual(["refs[0].lesson_ko"]);
		});
	});

	test("video_starts는 format이 video일 때만, unit_ids의 유닛마다 m:ss·h:mm:ss로 쓸 수 있다", () => {
		const video = makeValidRefsDraft();
		video.refs[0] = { ...video.refs[0], url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", format: "video", video_starts: { u001: "4:05" } };
		expect(checkRefsDraft(video, fixtureValidated).errors).toEqual([]);
		const article = makeValidRefsDraft();
		article.refs[0].video_starts = { u001: "4:05" };
		expect(findError(checkRefsDraft(article, fixtureValidated).errors, "refs[0].video_starts")).toBe(true);
		const malformed = makeValidRefsDraft();
		malformed.refs[0] = { ...malformed.refs[0], format: "video", video_starts: { u001: "245초" } };
		expect(findError(checkRefsDraft(malformed, fixtureValidated).errors, "refs[0].video_starts.u001")).toBe(true);
		const foreign = makeValidRefsDraft();
		foreign.refs[0] = { ...foreign.refs[0], format: "video", video_starts: { u002: "1:00" } };
		expect(findError(checkRefsDraft(foreign, fixtureValidated).errors, "refs[0].video_starts.u002")).toBe(true);
	});

	test("한 참고자료에서 두 유닛이 같은 관련성 문장을 쓰면 두 번째 유닛 경로에 에러를 낸다", () => {
		const draft = makeValidRefsDraft();
		draft.refs[0].unit_ids = ["u001", "u002"];
		draft.units_unfound = [];
		draft.refs[0].relevance_ko = { u001: "패스길과 슈팅 길 사이에서 기다리는 수비를 보여 준다", u002: " 패스길과 슈팅 길 사이에서 기다리는 수비를 보여 준다" };
		const errors = checkRefsDraft(draft, fixtureValidated).errors;
		expect(errors.filter((e) => e.path.startsWith("refs[0].relevance_ko")).map((e) => e.path)).toEqual(["refs[0].relevance_ko.u002"]);
		draft.refs[0].relevance_ko.u002 = "공 가진 선수에게 붙지 않고 슈팅 길을 막는 수비를 보여 준다";
		expect(checkRefsDraft(draft, fixtureValidated).errors).toEqual([]);
	});

	test("eafc 자료는 game_version(FC/FIFA nn 또는 null)과 pro_clubs가 있어야 하고, tactics 자료는 둘 다 쓰지 않는다", () => {
		const eafc = (fields: Record<string, unknown>) => {
			const draft = makeValidRefsDraft();
			draft.refs[0] = { ...draft.refs[0], kind: "eafc", ...fields };
			return checkRefsDraft(draft, fixtureValidated).errors.map((e) => e.path);
		};
		expect(eafc({ game_version: "FC 25", pro_clubs: true })).toEqual([]);
		expect(eafc({ game_version: null, published: "2023-01", pro_clubs: false })).toEqual([]);
		expect(eafc({ game_version: null, pro_clubs: false })).toEqual(["refs[0].published"]);
		expect(eafc({ game_version: null, published: "2023-1", pro_clubs: false })).toEqual(["refs[0].published"]);
		expect(eafc({ pro_clubs: false })).toEqual(["refs[0].game_version"]);
		expect(eafc({ game_version: "EA FC25", pro_clubs: false })).toEqual(["refs[0].game_version"]);
		expect(eafc({ game_version: "FIFA 23" })).toEqual(["refs[0].pro_clubs"]);
		const tactics = makeValidRefsDraft();
		tactics.refs[0].pro_clubs = false;
		expect(findError(checkRefsDraft(tactics, fixtureValidated).errors, "refs[0]")).toBe(true);
	});

	test("옛 video_start(참고자료 하나에 시각 하나)는 video_starts로 옮기라는 에러를 낸다", () => {
		const legacy = makeValidRefsDraft();
		legacy.refs[0] = { ...legacy.refs[0], format: "video", video_start: "4:05" };
		expect(findError(checkRefsDraft(legacy, fixtureValidated).errors, "refs[0].video_start")).toBe(true);
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

describe("webpDimensions", () => {
	function padTo30(bytes: number[]): Uint8Array {
		const padded = [...bytes];
		while (padded.length < 30) padded.push(0);
		return new Uint8Array(padded);
	}

	test("simple lossy(VP8 ) 1x1 webp의 width/height를 읽는다", () => {
		const bytes = padTo30([
			0x52, 0x49, 0x46, 0x46, // RIFF
			26, 0, 0, 0, // file size (LE)
			0x57, 0x45, 0x42, 0x50, // WEBP
			0x56, 0x50, 0x38, 0x20, // "VP8 "
			14, 0, 0, 0, // chunk size (LE)
			0x50, 0x01, 0x00, // frame tag
			0x9d, 0x01, 0x2a, // start code
			0x01, 0x00, // width=1
			0x01, 0x00, // height=1
		]);
		expect(webpDimensions(bytes)).toEqual({ width: 1, height: 1 });
	});

	test("simple lossless(VP8L) webp의 width/height를 읽는다(width 2 height 3)", () => {
		// width_minus_one=1, height_minus_one=2 → bits = 1 | (2<<14)
		const bits = 1 | (2 << 14);
		const bytes = padTo30([
			0x52, 0x49, 0x46, 0x46,
			0, 0, 0, 0,
			0x57, 0x45, 0x42, 0x50,
			0x56, 0x50, 0x38, 0x4c, // "VP8L"
			5, 0, 0, 0,
			0x2f, // signature
			bits & 0xff,
			(bits >>> 8) & 0xff,
			(bits >>> 16) & 0xff,
			(bits >>> 24) & 0xff,
		]);
		expect(webpDimensions(bytes)).toEqual({ width: 2, height: 3 });
	});

	test("extended(VP8X) webp의 width/height를 읽는다(width 100 height 200)", () => {
		const widthMinusOne = 99;
		const heightMinusOne = 199;
		const bytes = padTo30([
			0x52, 0x49, 0x46, 0x46,
			0, 0, 0, 0,
			0x57, 0x45, 0x42, 0x50,
			0x56, 0x50, 0x38, 0x58, // "VP8X"
			10, 0, 0, 0,
			0x00, // flags
			0x00, 0x00, 0x00, // reserved
			widthMinusOne & 0xff,
			(widthMinusOne >>> 8) & 0xff,
			(widthMinusOne >>> 16) & 0xff,
			heightMinusOne & 0xff,
			(heightMinusOne >>> 8) & 0xff,
			(heightMinusOne >>> 16) & 0xff,
		]);
		expect(webpDimensions(bytes)).toEqual({ width: 100, height: 200 });
	});

	test("RIFF/WEBP 시그니처가 없으면 에러를 낸다", () => {
		expect(() => webpDimensions(padTo30([0, 0, 0, 0]))).toThrow();
	});

	test("알 수 없는 하위 포맷이면 에러를 낸다", () => {
		const bytes = padTo30([
			0x52, 0x49, 0x46, 0x46,
			0, 0, 0, 0,
			0x57, 0x45, 0x42, 0x50,
			0x41, 0x42, 0x43, 0x44, // "ABCD" (알 수 없는 포맷)
		]);
		expect(() => webpDimensions(bytes)).toThrow();
	});
});

describe("commentAuthorName", () => {
	const roster: Roster = {
		members: [
			{ id: "depscharger", name: "뎁스차저", gamertag: "Depscharger", positions: ["CB"], aliases: ["석상용", "켐벨"] },
			{ id: "woosa-40", name: "우사", gamertag: "WOOSA_40", positions: ["CB"], aliases: [] },
		],
	};

	test("유튜브가 붙인 -접미사를 떼고 명단의 별칭과 맞으면 명단 이름을 쓴다", () => {
		expect(commentAuthorName("@석상용-h2t", roster)).toBe("뎁스차저");
	});

	test("게이머태그와 대소문자 무시로 맞으면 명단 이름을 쓴다", () => {
		expect(commentAuthorName("@woosa_40", roster)).toBe("우사");
	});

	test("명단에 없거나 명단이 없으면 @를 뗀 handle을 그대로 쓴다", () => {
		expect(commentAuthorName("@maker654", roster)).toBe("maker654");
		expect(commentAuthorName("@석상용-h2t", null)).toBe("석상용-h2t");
	});
});

describe("commentAuthorMember / selfCritiqueMemberIds", () => {
	const roster: Roster = {
		members: [
			{ id: "depscharger", name: "뎁스차저", gamertag: "Depscharger", positions: ["CB"], aliases: ["석상용", "켐벨"] },
			{ id: "woosa-40", name: "우사", gamertag: "WOOSA_40", positions: ["CB"], aliases: [] },
		],
	};

	test("commentAuthorMember는 commentAuthorName과 같은 규칙으로 handle의 명단 멤버를 돌려주고 없으면 null이다", () => {
		expect(commentAuthorMember("@석상용-h2t", roster)?.id).toBe("depscharger");
		expect(commentAuthorMember("@maker654", roster)).toBeNull();
		expect(commentAuthorMember("@석상용", null)).toBeNull();
	});

	test("고칠 사람 중 그 유닛 댓글 작성자인 멤버만 member_ids 순서로 돌려준다(별칭 handle 포함)", () => {
		expect(selfCritiqueMemberIds(["woosa-40", "depscharger"], ["@켐벨", "@maker654"], roster)).toEqual(["depscharger"]);
		expect(selfCritiqueMemberIds(["woosa-40"], ["@켐벨"], roster)).toEqual([]);
	});

	test("작성자가 없거나 명단이 없으면 빈 배열이다", () => {
		expect(selfCritiqueMemberIds(["depscharger"], [], roster)).toEqual([]);
		expect(selfCritiqueMemberIds(["depscharger"], ["@켐벨"], null)).toEqual([]);
	});
});

describe("clockSeconds", () => {
	test("m:ss와 h:mm:ss를 초로 바꾸고 형식이 아니면 null이다", () => {
		expect(clockSeconds("4:05")).toBe(245);
		expect(clockSeconds("1:02:03")).toBe(3723);
		expect(clockSeconds("4:65")).toBeNull();
		expect(clockSeconds("245")).toBeNull();
	});
});

// ── 비차단 경고: lineup 누락 · 유닛 끝 직후 미배정 줄 · 두벌식 이름표 ─────────────

function warnUnit(id: string, matchId: string, namedMemberIds: string[], range: { video?: string; start?: number; end?: number } = {}): ValidatedPlan["units"][number] {
	return {
		id,
		match_id: matchId,
		topic_id: `${matchId}-t1`,
		video: range.video ?? "AAAAAAAAAAA",
		start: range.start ?? 0,
		end: range.end ?? 10,
		title: "센터백: 라인 올리기",
		position_tags: [],
		topic_tags: [],
		member_ids: [],
		named_member_ids: namedMemberIds,
		inferred_member_ids: [],
		key_frame_candidate_ids: [],
		addressed_to_all: false,
		group_positions: [],
		comment_authors: [],
		line_range: null,
	};
}

function warnPlan(units: ValidatedPlan["units"], lineups: Array<Record<string, string> | null>): ValidatedPlan {
	return {
		version: 1,
		session_title: "세션",
		matches: lineups.map((lineup, index) => ({ id: `m${index + 1}`, title: `${index + 1}경기`, topics: [], lineup })),
		units,
		recurring: [],
		matches_without_feedback: [],
	};
}

describe("trailingUnassignedLineWarnings — 유닛 끝 직후 어느 유닛에도 없는 줄", () => {
	const speech = (i: number, start: number, end: number, text: string, video = "AAAAAAAAAAA"): Line => ({ i, video, start, end, text, source: "speech" });

	test("창 상수는 5초다", () => {
		expect(TRAILING_LINE_WINDOW_SECONDS).toBe(5);
	});

	test("유닛 끝 5초 안에 시작하는 미배정 줄을 유닛마다 한 줄로 낸다", () => {
		const validated = warnPlan([warnUnit("u001", "m1", [], { start: 0, end: 10 })], [null]);
		const lines = [speech(0, 0, 10, "수비 보세요"), speech(1, 11.5, 13, "새로 패널티"), speech(2, 15, 16, "경계 안 줄"), speech(3, 15.1, 17, "먼 줄")];
		expect(trailingUnassignedLineWarnings(validated, lines)).toEqual([
			'fc-feedback: 경고 u001 끝 직후 어느 유닛에도 없는 줄: 1(0:11) "새로 패널티", 2(0:15) "경계 안 줄" — 그 장면의 결과나 지시면 유닛 범위에 넣는다',
		]);
	});

	test("다른 유닛에 들어간 줄과 다른 영상의 줄은 미배정이 아니다", () => {
		const validated = warnPlan(
			[warnUnit("u001", "m1", [], { start: 0, end: 10 }), warnUnit("u002", "m1", [], { start: 11, end: 14 })],
			[null],
		);
		const lines = [speech(0, 0, 10, "가"), speech(1, 11, 13, "나"), speech(2, 11.5, 12, "다 다른 영상", "BBBBBBBBBBB")];
		expect(trailingUnassignedLineWarnings(validated, lines)).toEqual([]);
	});

	test("유닛 끝보다 앞서 시작하는 줄(경계에 걸친 미배정 줄)은 후행 줄이 아니다", () => {
		const validated = warnPlan([warnUnit("u001", "m1", [], { start: 0, end: 10 })], [null]);
		expect(trailingUnassignedLineWarnings(validated, [speech(0, 9, 12, "걸침")])).toEqual([]);
	});
});

describe("dubeolsikReading — 한글 자판으로 읽은 라틴 이름표", () => {
	test("영문 런마다 두벌식으로 조립해 완성 음절만 2음절 이상일 때 돌려준다", () => {
		expect(dubeolsikReading("CEF_dnjswo313")).toEqual(["원재"]);
		expect(dubeolsikReading("gksrmf")).toEqual(["한글"]);
		expect(dubeolsikReading("dkssud")).toEqual(["안녕"]);
	});

	test("겹받침·받침 이동·겹모음을 표준 IME처럼 처리한다", () => {
		expect(dubeolsikReading("rkqtdk")).toEqual(["값아"]); // ㄱㅏㅂㅅㅇㅏ: ㅂㅅ=ㅄ 겹받침 뒤 자음 ㅇ
		expect(dubeolsikReading("rkqtjs")).toEqual(["갑선"]); // 모음 ㅓ가 뒤따르면 ㅅ은 다음 음절로 이동
		expect(dubeolsikReading("dnjsdnjs")).toEqual(["원원"]); // ㅜ+ㅓ=ㅝ
		expect(dubeolsikReading("Rkqk")).toEqual(["까바"]); // 쌍자음 ㄲ은 Shift+r
	});

	test("낱자모가 남거나 1음절이면 버린다", () => {
		expect(dubeolsikReading("SAMBA")).toEqual([]);
		expect(dubeolsikReading("Gislove")).toEqual([]);
		expect(dubeolsikReading("rhkd")).toEqual([]); // 광 한 음절
		expect(dubeolsikReading("한글")).toEqual([]);
	});

	test("영문 런이 여럿이면 읽힌 것만 순서대로 모은다", () => {
		expect(dubeolsikReading("gksrmf_SAMBA_dkssud")).toEqual(["한글", "안녕"]);
	});
});

describe("unmatchedTagReadingWarnings — 명단에 없는 이름표의 한글 자판 읽기", () => {
	const tag = (name: string) => ({ match: 1, tag: name, evidence_candidate_id: "c001" });

	test("읽기가 있는 이름표마다 한 줄, 같은 이름표는 한 번만 낸다", () => {
		expect(unmatchedTagReadingWarnings([tag("CEF_dnjswo313"), tag("SAMBA"), { ...tag("CEF_dnjswo313"), match: 2 }], null)).toEqual([
			'fc-feedback: 경고 이름표 CEF_dnjswo313는 한글 자판으로 "원재"로 읽힌다 — 명단에 없는 사람이면 본문·캡션에서 "원재(CEF_dnjswo313 이름표)"처럼 그 이름으로 부른다',
		]);
	});

	test("읽기가 모두 비면 경고가 없다", () => {
		expect(unmatchedTagReadingWarnings([tag("SAMBA")], null)).toEqual([]);
	});

	const rosterOf = (...names: string[]): Roster => ({
		members: names.map((name, index) => ({ id: `m${index}`, name, gamertag: `Tag${index}`, positions: ["CB"], aliases: [] })),
	});
	const nearLine =
		'fc-feedback: 경고 이름표 CEF_dnjswo313는 한글 자판으로 "원재"로 읽힌다 — 명단에 없는 사람이면 본문·캡션에서 "원재(CEF_dnjswo313 이름표)"처럼 그 이름으로 부른다';

	test("읽기가 명단 이름과 같지는 않지만 비슷하면 경고 끝에 그 팀원 이름과 판단 문장을 붙인다", () => {
		expect(unmatchedTagReadingWarnings([tag("CEF_dnjswo313")], rosterOf("홍길동", "원전"))).toEqual([
			`${nearLine} — 명단의 원전과 같은 사람일 수 있다: 같은 사람이면 그 팀원으로 쓰고, 모르면 그대로 둔다`,
		]);
		expect(unmatchedTagReadingWarnings([tag("CEF_dnjswo313")], rosterOf("원전", "원재민", "윈재"))).toEqual([
			`${nearLine} — 명단의 원전·윈재와 같은 사람일 수 있다: 같은 사람이면 그 팀원으로 쓰고, 모르면 그대로 둔다`,
		]);
	});

	test("별칭과 비슷해도 그 팀원 이름으로 알린다", () => {
		const roster: Roster = { members: [{ id: "m0", name: "홍길동", gamertag: "HongGD", positions: ["CB"], aliases: ["원전"] }] };
		expect(unmatchedTagReadingWarnings([tag("CEF_dnjswo313")], roster)[0]).toContain("명단의 홍길동과 같은 사람일 수 있다");
	});

	test("명단이 없거나 비슷한 이름이 없으면 기본 경고 그대로다", () => {
		expect(unmatchedTagReadingWarnings([tag("CEF_dnjswo313")], null)).toEqual([nearLine]);
		expect(unmatchedTagReadingWarnings([tag("CEF_dnjswo313")], rosterOf("홍길동", "존재"))).toEqual([nearLine]);
	});
});

describe("closeRosterNames — 이름표의 한글 자판 읽기와 비슷한 명단 이름", () => {
	const roster: Roster = { members: [{ id: "a", name: "원전", gamertag: "WJ", positions: ["CB"], aliases: [] }] };

	test("글자 수가 같고 한 글자만 다르며 그 두 글자의 초성이 같을 때만 비슷하다", () => {
		expect(closeRosterNames("CEF_dnjswo313", roster)).toEqual(["원전"]); // 원재: 재/전은 둘 다 ㅈ
		expect(closeRosterNames("whswo", roster)).toEqual([]); // 존재: 두 글자가 다르다
		expect(closeRosterNames("dnjsto", roster)).toEqual([]); // 원새: 새 ㅅ / 전 ㅈ
		expect(closeRosterNames("dnjswjs", roster)).toEqual([]); // 원전: 같은 이름은 비슷한 것이 아니다
		expect(closeRosterNames("dnjswjsdl", roster)).toEqual([]); // 원전이: 글자 수가 다르다
	});

	test("한글로 읽히지 않는 이름표와 명단이 없는 경우는 빈 목록이다", () => {
		expect(closeRosterNames("SAMBA", roster)).toEqual([]);
		expect(closeRosterNames("dnjswo", null)).toEqual([]);
	});
});
