import { Event as DomEvent, parseHTML } from "linkedom";
import { describe, expect, test } from "bun:test";

import { posClosure, relatedMembers, type Member, type Roster } from "./core.ts";
import {
	renderIndex,
	renderRef,
	renderSession,
	VIEWER_JS,
	type ArchiveIndex,
	type SessionData,
	type SessionMemberInfo,
	type SessionUnit,
} from "./render.ts";

// ── fixtures ─────────────────────────────────────────────────────────────

const MEMBERS: SessionMemberInfo[] = [
	{ id: "hong", name: "홍길동", gamertag: "Hong", positions: ["CB"] },
	{ id: "kim", name: "김철수", gamertag: "Kim", positions: ["FB"] },
	{ id: "park", name: "박영희", gamertag: "Park", positions: ["GK"] },
	{ id: "choi", name: "최민수", gamertag: "Choi", positions: ["ST"] },
];

/** Same shape as `MEMBERS`, but typed as core.ts's `Roster` for calling `relatedMembers` directly. */
const ROSTER: Roster = {
	members: MEMBERS.map((member): Member => ({
		id: member.id,
		name: member.name,
		gamertag: member.gamertag,
		positions: member.positions,
		aliases: [],
	})),
};

function baseUnit(overrides: Partial<SessionUnit>): SessionUnit {
	return {
		id: "u001",
		uid: "20240104-NUzEChn9EyI#u001",
		match_id: "m1",
		topic_id: "m1-t1",
		video: "AAAAAAAAAAA",
		start: 754,
		end: 780,
		title: "빌드업 지적",
		position_tags: ["FB"],
		topic_tags: ["빌드업"],
		member_ids: ["hong"],
		related_member_ids: relatedMembers({ member_ids: ["hong"], position_tags: ["FB"] }, ROSTER).map(
			(member) => member.id,
		),
		note: { problem: "라인이 늘어짐", who: "홍길동", instead: "간격을 좁혀야 함" },
		images: {
			start: { src: "img/u001-start.webp", width: 1280, height: 720 },
			key: [],
		},
		similar: [],
		refs: [],
		watch_url: "https://youtu.be/AAAAAAAAAAA?t=754",
		...overrides,
	};
}

function sampleData(): SessionData {
	const u001 = baseUnit({});
	const u002 = baseUnit({
		id: "u002",
		uid: "20240104-NUzEChn9EyI#u002",
		topic_id: "m1-t2",
		video: "BBBBBBBBBBB",
		start: 3725,
		end: 3740,
		title: "GK 캐칭 판단",
		position_tags: ["GK"],
		topic_tags: ["피지컬"],
		member_ids: [],
		related_member_ids: relatedMembers({ member_ids: [], position_tags: ["GK"] }, ROSTER).map(
			(member) => member.id,
		),
		note: {
			problem: "캐칭이 불안정함",
			who: "박영희",
			instead: "펀칭 대신 캐칭 연습",
			detail: "다음 세션에서 재확인",
		},
		images: { start: { src: "img/u002-start.webp", width: 1280, height: 720 }, key: [] },
		similar: [
			{
				uid: "20230101-XXXXXXXXXXX#u002",
				title: "과거 유사 GK 지적",
				date: "2023-01-01",
				href: "../20230101-XXXXXXXXXXX/index.html#u002",
			},
		],
		refs: [
			{
				id: "r-bbbbbbbbbb",
				title: "한국어 GK 훈련 자료",
				lang: "ko",
				kind: "tactics",
				href: null,
				orig_url: "https://example.kr/doc",
			},
		],
		watch_url: "https://youtu.be/BBBBBBBBBBB?t=3725",
	});
	const u003 = baseUnit({
		id: "u003",
		uid: "20240104-NUzEChn9EyI#u003",
		topic_id: "m1-t1",
		video: "AAAAAAAAAAA",
		start: 100,
		end: 120,
		title: "역습 전환 속도",
		position_tags: ["ST"],
		topic_tags: ["빌드업", "전환"],
		member_ids: ["choi"],
		related_member_ids: relatedMembers({ member_ids: ["choi"], position_tags: ["ST"] }, ROSTER).map(
			(member) => member.id,
		),
		note: { problem: "전환이 느림", who: "최민수", instead: "패스 템포를 올려야 함" },
		images: {
			start: { src: "img/u003-start.webp", width: 1280, height: 720 },
			key: [{ src: "img/u003-key1.webp", caption: "역습 시작 지점", t: 105 }],
		},
		watch_url: "https://youtu.be/AAAAAAAAAAA?t=100",
	});

	return {
		version: 1,
		session_id: "20240104-NUzEChn9EyI",
		title: "1월 4일 세션",
		date: "2024-01-04",
		generated_at: "2024-01-05T00:00:00Z",
		pages_base_url: "https://toongri.github.io/fc-feedback/",
		videos: [
			{ id: "AAAAAAAAAAA", part: 1, embeddable: true },
			{ id: "BBBBBBBBBBB", part: 2, embeddable: true },
		],
		members: MEMBERS.map((member) => ({ ...member, positions: [...member.positions] })),
		matches: [
			{
				id: "m1",
				title: "1경기",
				topics: [
					{
						id: "m1-t1",
						title: "빌드업 전개",
						summary: "후방 빌드업을 정리한다",
						unit_ids: ["u001", "u003"],
					},
					{
						id: "m1-t2",
						title: "피지컬 싸움",
						summary: "GK 캐칭 판단을 점검한다",
						unit_ids: ["u002"],
					},
				],
			},
		],
		units: [u001, u002, u003],
	};
}

// ── helpers ───────────────────────────────────────────────────────────────

const XSS_PAYLOAD = '"><script>alert(1)</script>';

function scriptCount(html: string): number {
	return parseHTML(html).document.querySelectorAll("script").length;
}

interface StubPlayerCall {
	method: string;
	args: unknown[];
}

class StubPlayer {
	calls: StubPlayerCall[] = [];
	videoId: string;
	private readonly onReadyCallback?: (event: { target: StubPlayer }) => void;

	constructor(
		_elementId: string,
		options: { videoId: string; events?: { onReady?: (event: { target: StubPlayer }) => void } },
	) {
		this.videoId = options.videoId;
		this.onReadyCallback = options.events?.onReady;
	}

	fireReady(): void {
		this.onReadyCallback?.({ target: this });
	}

	seekTo(seconds: number, allowSeekAhead: boolean): void {
		this.calls.push({ method: "seekTo", args: [seconds, allowSeekAhead] });
	}

	playVideo(): void {
		this.calls.push({ method: "playVideo", args: [] });
	}

	loadVideoById(options: { videoId: string; startSeconds: number }): void {
		this.videoId = options.videoId;
		this.calls.push({ method: "loadVideoById", args: [options] });
	}

	getCurrentTime(): number {
		return 0;
	}

	getVideoData(): { video_id: string } {
		return { video_id: this.videoId };
	}
}

interface ViewerWindow {
	document: Document;
	fcPlayer?: StubPlayer;
	Element: { prototype: { scrollIntoView?: () => void } };
	matchMedia?: (query: string) => {
		matches: boolean;
		addListener: () => void;
		removeListener: () => void;
	};
}

/** Parses `html` into a linkedom DOM, stubs scrollIntoView/matchMedia, and runs VIEWER_JS. */
function mountViewer(
	html: string,
	ytLoaded: boolean,
): { win: ViewerWindow; doc: Document; stub: StubPlayer | null } {
	const dom = parseHTML(html);
	const win = dom as unknown as ViewerWindow;
	win.Element.prototype.scrollIntoView = () => {};
	win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
	const yt = { Player: StubPlayer, loaded: ytLoaded };
	const run = new Function("window", "document", "YT", VIEWER_JS) as (
		windowArg: unknown,
		documentArg: unknown,
		ytArg: unknown,
	) => void;
	run(win, win.document, yt);
	const stub = win.fcPlayer instanceof StubPlayer ? win.fcPlayer : null;
	return { win, doc: win.document, stub };
}

/** Dispatches a bubbling click, built from linkedom's own `Event` (matches its dispatchEvent internals). */
function click(el: Element | null | undefined): void {
	if (!el) throw new Error("click(): element not found");
	el.dispatchEvent(new DomEvent("click", { bubbles: true }) as unknown as Event);
}

function clickChip(doc: Document, group: string, value: string): void {
	const selector = `.chip-filter[data-group="${group}"][data-value="${value}"]`;
	click(doc.querySelector(selector));
}

function isHidden(el: Element | null): boolean {
	return el !== null && el.hasAttribute("hidden");
}

// ── escaping ─────────────────────────────────────────────────────────────

describe("escapeHtml 전면 적용", () => {
	test("세션 페이지의 모든 문자열 필드가 이스케이프된다", () => {
		const data = sampleData();
		data.title = XSS_PAYLOAD;
		data.units[0].title = XSS_PAYLOAD;
		data.units[0].note.problem = XSS_PAYLOAD;
		data.units[0].note.who = XSS_PAYLOAD;
		data.units[0].note.instead = XSS_PAYLOAD;
		data.units[0].topic_tags = [XSS_PAYLOAD];
		data.units[0].member_ids = ["hong"];
		data.members[0].name = XSS_PAYLOAD;
		data.members[0].gamertag = XSS_PAYLOAD;
		data.matches[0].title = XSS_PAYLOAD;
		data.matches[0].topics[0].title = XSS_PAYLOAD;
		data.matches[0].topics[0].summary = XSS_PAYLOAD;
		data.units[0].images.key = [{ src: XSS_PAYLOAD, caption: XSS_PAYLOAD, t: 1 }];
		data.units[0].similar = [
			{ uid: "x", title: XSS_PAYLOAD, date: XSS_PAYLOAD, href: XSS_PAYLOAD },
		];
		data.units[0].refs = [
			{
				id: "r-x",
				title: XSS_PAYLOAD,
				lang: "en",
				kind: "eafc",
				href: XSS_PAYLOAD,
				orig_url: XSS_PAYLOAD,
			},
		];
		data.units[0].watch_url = XSS_PAYLOAD;

		const html = renderSession(data);
		expect(html.includes(XSS_PAYLOAD)).toBe(false);
		expect(html.includes("alert(1)")).toBe(true);
		expect(scriptCount(html)).toBe(2);
	});

	test("인덱스 페이지의 모든 문자열 필드가 이스케이프된다", () => {
		const index: ArchiveIndex = {
			version: 1,
			updated_at: "2024-01-05T00:00:00Z",
			sessions: [
				{
					id: "20240104-NUzEChn9EyI",
					title: XSS_PAYLOAD,
					date: "2024-01-04",
					videos: 2,
					unit_count: 3,
					topic_tags: [XSS_PAYLOAD],
					href: XSS_PAYLOAD,
				},
			],
			units: [
				{
					uid: "20240104-NUzEChn9EyI#u001",
					session: "20240104-NUzEChn9EyI",
					title: XSS_PAYLOAD,
					date: "2024-01-04",
					position_tags: ["FB"],
					topic_tags: [XSS_PAYLOAD],
					member_ids: [],
					href: XSS_PAYLOAD,
				},
			],
			refs: [],
		};
		const html = renderIndex(index);
		expect(html.includes(XSS_PAYLOAD)).toBe(false);
		expect(html.includes("alert(1)")).toBe(true);
		expect(scriptCount(html)).toBe(0);
	});

	test("참고자료 페이지의 모든 문자열 필드가 이스케이프된다", () => {
		const html = renderRef({
			id: "r-xxxxxxxxxx",
			title: XSS_PAYLOAD,
			lang: "en",
			kind: "eafc",
			url: XSS_PAYLOAD,
			summary_ko: XSS_PAYLOAD,
			key_points_ko: [XSS_PAYLOAD],
			translations: [{ orig: XSS_PAYLOAD, ko: XSS_PAYLOAD }],
		});
		expect(html.includes(XSS_PAYLOAD)).toBe(false);
		expect(html.includes("alert(1)")).toBe(true);
		expect(scriptCount(html)).toBe(0);
	});
});

// ── structural / static contract tests ────────────────────────────────────

describe("스크립트 개수 · noindex · 카드 수 · data-pos", () => {
	test("세션 페이지는 script 태그가 정확히 2개다", () => {
		expect(scriptCount(renderSession(sampleData()))).toBe(2);
	});

	test("인덱스·참고자료 페이지는 script 태그가 0개다", () => {
		const index: ArchiveIndex = {
			version: 1,
			updated_at: "now",
			sessions: [],
			units: [],
			refs: [],
		};
		expect(scriptCount(renderIndex(index))).toBe(0);
		expect(
			scriptCount(
				renderRef({
					id: "r-1",
					title: "제목",
					lang: "en",
					kind: "eafc",
					url: "https://example.com",
					summary_ko: "요약",
					key_points_ko: [],
					translations: [],
				}),
			),
		).toBe(0);
	});

	test("세 페이지 모두 noindex,nofollow meta를 가진다", () => {
		const sessionDoc = parseHTML(renderSession(sampleData())).document;
		const indexDoc = parseHTML(
			renderIndex({ version: 1, updated_at: "now", sessions: [], units: [], refs: [] }),
		).document;
		const refDoc = parseHTML(
			renderRef({
				id: "r-1",
				title: "제목",
				lang: "en",
				kind: "eafc",
				url: "https://example.com",
				summary_ko: "요약",
				key_points_ko: [],
				translations: [],
			}),
		).document;
		for (const doc of [sessionDoc, indexDoc, refDoc]) {
			const meta = doc.querySelector('meta[name="robots"]');
			expect(meta?.getAttribute("content")).toBe("noindex, nofollow");
		}
	});

	test("카드 개수는 unit 개수와 같다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelectorAll(".card").length).toBe(data.units.length);
	});

	test("data-pos는 posClosure 결과와 같다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		for (const unit of data.units) {
			const card = doc.getElementById(unit.id);
			const actual = (card?.getAttribute("data-pos") ?? "").split(" ").filter(Boolean).sort();
			const expected = posClosure(unit.position_tags).sort();
			expect(actual).toEqual(expected);
		}
	});
});

// ── card anatomy (plan §12 item 1 test names) ─────────────────────────────

describe("카드 해부", () => {
	test("카드는 youtu.be/ID?t=초 딥링크를 가진다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const card = doc.getElementById("u001");
		const link = card?.querySelector("a.watch-link");
		expect(link?.getAttribute("href")).toBe(data.units[0].watch_url);
		expect(link?.getAttribute("href")).toMatch(/^https:\/\/youtu\.be\/[\w-]{11}\?t=\d+$/);
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener");
	});

	test("카드는 m:ss / h:mm:ss 시간 칩을 보인다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const chips = [...doc.querySelectorAll(".chip-time")].map((el) => el.textContent);
		expect(chips).toContain("12:34"); // u001: start=754s < 1h
		expect(chips).toContain("1:02:05"); // u002: start=3725s >= 1h
	});

	test("카드는 시작 이미지를 실제 width/height로 가진다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const card = doc.getElementById("u001");
		const img = card?.querySelector("img");
		expect(img?.getAttribute("width")).toBe(String(data.units[0].images.start.width));
		expect(img?.getAttribute("height")).toBe(String(data.units[0].images.start.height));
		expect(img?.getAttribute("src")).toBe(data.units[0].images.start.src);
	});

	test("노트 dl은 문제·누구·대신 순서를 가진다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const card = doc.getElementById("u002"); // has an optional detail field too
		const dl = card?.querySelector("dl.note-dl");
		const labels = [...(dl?.querySelectorAll("dt") ?? [])].map((el) => el.textContent);
		expect(labels).toEqual(["문제", "누구", "대신", "상세"]);
	});

	test("중요 이미지는 캡션과 함께 렌더된다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const card = doc.getElementById("u003");
		const figure = card?.querySelector(".key-images figure");
		expect(figure?.querySelector("img")?.getAttribute("src")).toBe(data.units[2].images.key[0].src);
		expect(figure?.querySelector("figcaption")?.textContent).toBe(
			data.units[2].images.key[0].caption,
		);
	});

	test("관련 팀원 목록은 relatedMembers 결과와 같다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;

		const expectedU001 = relatedMembers(
			{ member_ids: ["hong"], position_tags: ["FB"] },
			ROSTER,
		).map((member) => member.name);
		const textU001 =
			doc.getElementById("u001")?.querySelector(".related-members")?.textContent ?? "";
		expect(expectedU001.length).toBeGreaterThan(0);
		for (const name of expectedU001) expect(textU001).toContain(name);

		const expectedU002 = relatedMembers({ member_ids: [], position_tags: ["GK"] }, ROSTER).map(
			(member) => member.name,
		);
		const textU002 =
			doc.getElementById("u002")?.querySelector(".related-members")?.textContent ?? "";
		expect(expectedU002).toEqual(["박영희"]);
		for (const name of expectedU002) expect(textU002).toContain(name);
	});

	test("유사 과거 피드백은 세션 날짜와 링크를 가진다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const item = doc.getElementById("u002")?.querySelector(".similar-list li");
		const similar = data.units[1].similar[0];
		expect(item?.textContent).toContain(similar.date);
		expect(item?.querySelector("a")?.getAttribute("href")).toBe(similar.href);
		expect(item?.querySelector("a")?.textContent).toBe(similar.title);
	});

	test("참고자료는 요약 페이지 링크와 원문 링크를 가진다(ko는 원문만)", () => {
		const data = sampleData();
		data.units[0].refs = [
			{
				id: "r-en",
				title: "EN 자료",
				lang: "en",
				kind: "eafc",
				href: "../../refs/r-en.html",
				orig_url: "https://example.com/en",
			},
		];
		const doc = parseHTML(renderSession(data)).document;

		const enItem = doc.getElementById("u001")?.querySelector(".refs-list li");
		const enLinks = [...(enItem?.querySelectorAll("a") ?? [])];
		expect(
			enLinks.some(
				(a) => a.textContent === "요약" && a.getAttribute("href") === "../../refs/r-en.html",
			),
		).toBe(true);
		expect(
			enLinks.some(
				(a) => a.textContent === "원문 ↗" && a.getAttribute("href") === "https://example.com/en",
			),
		).toBe(true);

		const koItem = doc.getElementById("u002")?.querySelector(".refs-list li");
		const koLinks = [...(koItem?.querySelectorAll("a") ?? [])];
		expect(koLinks.some((a) => a.textContent === "요약")).toBe(false);
		expect(
			koLinks.some(
				(a) => a.textContent === "원문 ↗" && a.getAttribute("href") === "https://example.kr/doc",
			),
		).toBe(true);
	});
});

// ── TOC ────────────────────────────────────────────────────────────────────

describe("목차 탭", () => {
	test("경기별 탭의 주제 항목은 summary를 보인다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const summaries = [...doc.querySelectorAll("#panel-match .toc-summary")].map(
			(el) => el.textContent,
		);
		for (const topic of data.matches[0].topics) {
			expect(summaries).toContain(topic.summary);
		}
	});

	test("주제별 탭은 태그별 피드백 개수를 보인다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const headings = [...doc.querySelectorAll("#panel-topic .toc-tag-group h2")].map(
			(el) => el.textContent,
		);
		expect(headings).toContain("빌드업 (2)"); // u001, u003
		expect(headings).toContain("피지컬 (1)"); // u002
		expect(headings).toContain("전환 (1)"); // u003
	});

	test("탭 전환은 aria-selected와 패널 hidden을 토글한다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		const tabMatch = doc.getElementById("tab-match");
		const tabTopic = doc.getElementById("tab-topic");
		expect(tabMatch?.getAttribute("aria-selected")).toBe("true");

		click(tabTopic);

		expect(tabTopic?.getAttribute("aria-selected")).toBe("true");
		expect(tabMatch?.getAttribute("aria-selected")).toBe("false");
		expect(isHidden(doc.getElementById("panel-topic"))).toBe(false);
		expect(isHidden(doc.getElementById("panel-match"))).toBe(true);
	});
});

// ── filters ─────────────────────────────────────────────────────────────

describe("필터", () => {
	test("그룹 간에는 AND로 결합된다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "FB");
		clickChip(doc, "topic", "빌드업");
		expect(isHidden(doc.getElementById("u001"))).toBe(false); // FB pos AND 빌드업 topic
		expect(isHidden(doc.getElementById("u003"))).toBe(true); // ST pos, topic matches but pos doesn't
		expect(isHidden(doc.getElementById("u002"))).toBe(true);
	});

	test("주제 그룹 내부는 OR로 결합된다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "topic", "빌드업");
		clickChip(doc, "topic", "전환");
		expect(isHidden(doc.getElementById("u001"))).toBe(false); // 빌드업
		expect(isHidden(doc.getElementById("u003"))).toBe(false); // 빌드업 또는 전환
		expect(isHidden(doc.getElementById("u002"))).toBe(true); // 피지컬만
	});

	test("필터 결과 0건이면 빈 상태를 보인다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "mention", "park"); // park는 어떤 unit의 member_ids에도 없음
		expect(isHidden(doc.querySelector(".card-list"))).toBe(true);
		expect(isHidden(doc.querySelector(".toc"))).toBe(true);
		const emptyState = doc.querySelector(".empty-state");
		expect(isHidden(emptyState)).toBe(false);
		expect(emptyState?.textContent).toContain("조건에 맞는 피드백이 없어요");
	});

	test("리셋은 모든 필터를 초기화하고 전체 결과를 복원한다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "FB");
		expect(isHidden(doc.getElementById("u002"))).toBe(true);
		click(doc.querySelector(".filter-reset"));
		expect(isHidden(doc.getElementById("u001"))).toBe(false);
		expect(isHidden(doc.getElementById("u002"))).toBe(false);
		expect(isHidden(doc.getElementById("u003"))).toBe(false);
	});
});

// ── video player ────────────────────────────────────────────────────────

describe("영상 전환", () => {
	test("API script가 먼저 로드돼도 플레이어가 초기화된다", () => {
		const { stub } = mountViewer(renderSession(sampleData()), true);
		expect(stub).not.toBeNull();
		expect(stub?.videoId).toBe("AAAAAAAAAAA");
	});

	test("뷰어 스크립트는 다른 파트 카드에서 loadVideoById를 호출한다", () => {
		const { doc, stub } = mountViewer(renderSession(sampleData()), true);
		stub?.fireReady();
		click(doc.getElementById("u002")); // Part 2 카드
		const loadCalls = stub?.calls.filter((call) => call.method === "loadVideoById") ?? [];
		expect(loadCalls.length).toBe(1);
		expect(loadCalls[0].args[0]).toEqual({ videoId: "BBBBBBBBBBB", startSeconds: 3725 });
	});

	test("같은 파트 카드 클릭은 seekTo와 playVideo를 호출한다(loadVideoById는 호출하지 않는다)", () => {
		const { doc, stub } = mountViewer(renderSession(sampleData()), true);
		stub?.fireReady();
		click(doc.getElementById("u003")); // Part 1, 같은 video
		const methods = stub?.calls.map((call) => call.method) ?? [];
		expect(methods).toContain("seekTo");
		expect(methods).toContain("playVideo");
		expect(methods).not.toContain("loadVideoById");
	});

	test("onReady 이전 클릭은 큐에 쌓였다가 ready 시 순서대로 실행된다", () => {
		const { doc, stub } = mountViewer(renderSession(sampleData()), true);
		// 아직 fireReady() 호출 전 — ready 콜백 미도달 상태에서 클릭.
		click(doc.getElementById("u002"));
		expect(stub?.calls.length ?? -1).toBe(0);
		stub?.fireReady();
		expect(stub?.calls.some((call) => call.method === "loadVideoById")).toBe(true);
	});

	test("카드 클릭 후 body.dataset.video가 클릭한 카드의 videoId와 같다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), true);
		click(doc.getElementById("u002"));
		expect(doc.body.getAttribute("data-video")).toBe("BBBBBBBBBBB");
	});
});
