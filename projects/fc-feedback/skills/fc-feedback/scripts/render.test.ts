import { readFileSync } from "node:fs";
import { Event as DomEvent, parseHTML } from "linkedom";
import { describe, expect, test } from "bun:test";

import { posClosure, relatedMembers, type Member, type Roster } from "./core.ts";
import {
	glueKorean,
	panCenterFromFocus,
	proClubsFromLegacyData,
	unidentifiedMemberIdsFromLegacyData,
	lookAtFromLegacyData,
	faultSceneFromLegacyData,
	directionCheckFromLegacyData,
	groupMemberIdsFromLegacyData,
	positionTagsFromLegacyData,
	lineupFromLegacyData,
	inferredMemberIdsFromLegacyData,
	lessonFromLegacyData,
	sourceNameFromLegacyData,
	versionBadgeFromLegacyData,
	publishedBadgeFromLegacyData,
	renderIndex,
	renderRef,
	namedMemberIdsFromLegacyData,
	recurringFromLegacyData,
	refsUnfoundFromLegacyData,
	matchesWithoutFeedbackFromLegacyData,
	markerLegendFromLegacyData,
	unmatchedNameTagsFromLegacyData,
	selfCritiqueMemberIdsFromLegacyData,
	renderSession,
	STYLE,
	VIEWER_JS,
	type ArchiveIndex,
	type SessionData,
	type SessionDataInput,
	type SessionMemberInfo,
	type SessionUnit,
	type UnitBodyFrameBlock,
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

/** A test unit without `position_target_ids`, so the renderer derives it the legacy way from whatever `member_ids` the test sets. */
type TestUnit = SessionDataInput["units"][number];

function baseUnit(overrides: Partial<TestUnit>): TestUnit {
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
		named_member_ids: [],
		related_member_ids: relatedMembers({ member_ids: ["hong"], position_tags: ["FB"] }, ROSTER, null).map(
			(member) => member.id,
		),
		addressed_to_all: false,
		comment_author_names: [],
		unidentified_member_ids: [],
		look_at: null,
		body: [{ type: "text", text: "라인이 **홍길동** 기준으로 늘어짐. 간격을 좁혀야 함" }],
		images: {
			start: { src: "img/u001-start.webp", width: 1280, height: 720 },
		},
		similar: [],
		refs: [],
		watch_url: "https://youtu.be/AAAAAAAAAAA?t=754",
		...overrides,
	};
}

function sampleData(): SessionDataInput {
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
		related_member_ids: relatedMembers({ member_ids: [], position_tags: ["GK"] }, ROSTER, null).map(
			(member) => member.id,
		),
		body: [{ type: "text", text: "**박영희**의 캐칭이 불안정함. 펀칭 대신 캐칭 연습이 필요함" }],
		images: { start: { src: "img/u002-start.webp", width: 1280, height: 720 } },
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
				format: "article",
				relevance_ko: "이 장면의 빌드업 문제를 다룬다",
				start_seconds: null,
				version_badge: null,
				pro_clubs: false,
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
		related_member_ids: relatedMembers({ member_ids: ["choi"], position_tags: ["ST"] }, ROSTER, null).map(
			(member) => member.id,
		),
		body: [
			{ type: "text", text: "**최민수**의 전환이 느림. 패스 템포를 올려야 함" },
			{
				type: "frame",
				src: "img/u003-c001.webp",
				width: 1280,
				height: 720,
				t: 105,
				caption: "역습 시작 지점",
			},
		],
		images: {
			start: { src: "img/u003-start.webp", width: 1280, height: 720 },
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
		recurring: [],
	};
}

// ── helpers ───────────────────────────────────────────────────────────────

const XSS_PAYLOAD = '"><script>alert(1)</script>';
const NBSP = " ";

/** textContent with the NBSP glue (DESIGN §10) read as a plain space — for assertions about the words, not the line-break glue. */
function plain(text: string | null | undefined): string {
	return (text ?? "").replaceAll(NBSP, " ");
}

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
	innerHeight?: number;
	fcPlayer?: StubPlayer;
	Element: { prototype: { scrollIntoView?: () => void } };
	matchMedia?: (query: string) => {
		matches: boolean;
		addListener: () => void;
		removeListener: () => void;
	};
	YT?: { Player: typeof StubPlayer; loaded: boolean };
	onYouTubeIframeAPIReady?: () => void;
	getSelection?: () => { toString: () => string };
}

/**
 * linkedom's `parseHTML()` result shares custom-property storage across separate calls within
 * one process (a plain `win.someAdHocProp = x` write on one parsed document is readable, and
 * deletable, from every OTHER `parseHTML()` result too) — confirmed by direct repro, not by the
 * DOM API surface itself. So the `window` passed into VIEWER_JS is a fresh plain object carrying
 * only the real `document`/`Element` from that parse; every ad hoc global (YT, fcPlayer,
 * onYouTubeIframeAPIReady, matchMedia, getSelection) is then an own property of THIS plain
 * object, never of the leaky parse result, so tests can't see another test's leftover state.
 */
function makeWindow(dom: ReturnType<typeof parseHTML>): ViewerWindow {
	return { document: dom.document, Element: dom.Element };
}

/** Runs VIEWER_JS via the `new Function("window","document","YT", src)` harness (source now reads `window.YT`, so this also sets `win.YT`). */
function runViewer(win: ViewerWindow, yt: { Player: typeof StubPlayer; loaded: boolean } | undefined): void {
	const run = new Function("window", "document", "YT", VIEWER_JS) as (
		windowArg: unknown,
		documentArg: unknown,
		ytArg: unknown,
	) => void;
	if (yt !== undefined) {
		win.YT = yt;
	}
	run(win, win.document, yt);
}

/** Parses `html` into a linkedom DOM, stubs scrollIntoView/matchMedia, and runs VIEWER_JS. */
function mountViewer(
	html: string,
	ytLoaded: boolean,
): { win: ViewerWindow; doc: Document; stub: StubPlayer | null } {
	const dom = parseHTML(html);
	const win = makeWindow(dom);
	win.Element.prototype.scrollIntoView = () => {};
	win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
	runViewer(win, { Player: StubPlayer, loaded: ytLoaded });
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

function clickMinePill(doc: Document, value: string): void {
	click(doc.querySelector(`.pill-mine[data-value="${value}"]`));
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
		data.units[0].body = [
			{ type: "text", text: XSS_PAYLOAD },
			{ type: "frame", src: XSS_PAYLOAD, width: 100, height: 100, t: 1, caption: XSS_PAYLOAD },
		];
		data.units[0].topic_tags = [XSS_PAYLOAD];
		data.units[0].member_ids = ["hong"];
		data.members[0].name = XSS_PAYLOAD;
		data.members[0].gamertag = XSS_PAYLOAD;
		data.matches[0].title = XSS_PAYLOAD;
		data.matches[0].topics[0].title = XSS_PAYLOAD;
		data.matches[0].topics[0].summary = XSS_PAYLOAD;
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
				format: "video",
				relevance_ko: XSS_PAYLOAD,
				start_seconds: 245,
				version_badge: null,
				pro_clubs: false,
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

	test("세션 카드의 날짜도 헤더와 같이 '영상 업로드'로 라벨한다", () => {
		const html = renderIndex({
			version: 1,
			updated_at: "2024-01-05T00:00:00Z",
			sessions: [{ id: "20240104-NUzEChn9EyI", title: "세션", date: "2024-01-04", videos: 1, unit_count: 1, topic_tags: [], href: "sessions/x/index.html" }],
			units: [],
			refs: [],
		});
		expect(parseHTML(html).document.querySelector(".session-card .date")?.textContent).toBe("영상 업로드 2024-01-04");
	});

	test("참고자료 페이지의 모든 문자열 필드가 이스케이프된다", () => {
		const html = renderRef({
			id: "r-xxxxxxxxxx",
			title: XSS_PAYLOAD,
			lang: "en",
			kind: "eafc",
			format: "article",
			url: XSS_PAYLOAD,
			start_seconds: null,
			summary_ko: XSS_PAYLOAD,
			key_points_ko: [XSS_PAYLOAD],
			translations: [{ orig: XSS_PAYLOAD, ko: XSS_PAYLOAD }],
		});
		expect(html.includes(XSS_PAYLOAD)).toBe(false);
		expect(html.includes("alert(1)")).toBe(true);
		expect(scriptCount(html)).toBe(0);
	});

	test("번역 표의 각 셀은 data-label을 갖는다(<1024px 스택 레이아웃의 라벨 소스, 라운드6 CJK 검토)", () => {
		const doc = parseHTML(
			renderRef({
				id: "r-1",
				title: "제목",
				lang: "en",
				kind: "eafc",
				format: "article",
				url: "https://example.com",
				start_seconds: null,
				summary_ko: "요약",
				key_points_ko: [],
				translations: [{ orig: "Play out from the back.", ko: "후방에서 빌드업하라." }],
			}),
		).document;
		const cells = [...doc.querySelectorAll(".translations-table td")];
		expect(cells.map((cell) => cell.getAttribute("data-label"))).toEqual(["원문", "한국어"]);
	});

	test("ref 페이지의 key_points_ko도 묶인 문법 구성 glue 파이프라인을 탄다(REAL BUG 회귀, 라운드7)", () => {
		const doc = parseHTML(
			renderRef({
				id: "r-1",
				title: "제목",
				lang: "en",
				kind: "eafc",
				format: "article",
				url: "https://example.com",
				start_seconds: null,
				summary_ko: "요약",
				key_points_ko: ["좋은 각을 만들 것"],
				translations: [],
			}),
		).document;
		const item = doc.querySelector(".key-points li");
		expect(item?.textContent).toContain(`만들${NBSP}것`);
	});

	test("STYLE은 1024px 미만에서 번역 표를 라벨이 붙은 블록으로 세로 스택한다(라운드6 CJK 검토)", () => {
		expect(STYLE).toMatch(/@media \(max-width: 1023\.98px\)[^]*?\.translations-table[^{]*\{[^}]*display:\s*block/);
		expect(STYLE).toContain("content: attr(data-label)");
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
					format: "article",
					url: "https://example.com",
					start_seconds: null,
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
				format: "article",
				url: "https://example.com",
				start_seconds: null,
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
			const actual = (card?.getAttribute("data-pos") ?? "").split("|").filter(Boolean).sort();
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

	test("본문은 문단과 프레임을 작성 순서대로 렌더한다", () => {
		const data = sampleData();
		data.units[0].body = [
			{ type: "text", text: "첫 문단" },
			{ type: "frame", src: "img/u001-c001.webp", width: 1280, height: 720, t: 760, caption: "장면 1" },
			{ type: "text", text: "둘째 문단" },
		];
		const doc = parseHTML(renderSession(data)).document;
		const body = doc.getElementById("u001")?.querySelector(".card-body");
		const tags = [...(body?.children ?? [])].map((el) => el.tagName.toLowerCase());
		expect(tags).toEqual(["p", "figure", "p"]);
	});

	test("본문 굵게는 strong으로만 변환되고 나머지는 이스케이프된다", () => {
		const data = sampleData();
		data.units[0].body = [{ type: "text", text: "**<b>x</b>** y<script>" }];
		const doc = parseHTML(renderSession(data)).document;
		const p = doc.getElementById("u001")?.querySelector(".card-body p");
		expect(p?.innerHTML).toBe("<strong>&lt;b&gt;x&lt;/b&gt;</strong> y&lt;script&gt;");
	});

	test("본문 프레임 클릭은 그 시각으로 seek한다", () => {
		const data = sampleData();
		data.units[0].body = [
			{ type: "text", text: "문단입니다" },
			{ type: "frame", src: "img/u001-c001.webp", width: 1280, height: 720, t: 760, caption: "장면" },
		];
		const { doc, stub } = mountViewer(renderSession(data), true);
		stub?.fireReady();
		click(doc.querySelector("#u001 .body-frame"));
		const seekCall = stub?.calls.find((call) => call.method === "seekTo");
		expect(seekCall?.args[0]).toBe(760);
		expect(stub?.calls.some((call) => call.method === "playVideo")).toBe(true);
	});

	test("중요 이미지는 캡션과 함께 렌더된다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const card = doc.getElementById("u003");
		const figure = card?.querySelector(".card-body .body-frame");
		const frameBlock = data.units[2].body.find(
			(block): block is UnitBodyFrameBlock => block.type === "frame",
		);
		expect(frameBlock).toBeDefined();
		expect(figure?.querySelector("img")?.getAttribute("src")).toBe(frameBlock?.src);
		expect(plain(figure?.querySelector("figcaption")?.textContent)).toContain(frameBlock?.caption ?? "");
	});

	test("언급된 팀원 줄은 member_ids를, 관련 팀원 줄은 relatedMembers \\ member_ids를 보인다(DESIGN §5 item 6/8)", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;

		// u001: member_ids=["hong"], relatedMembers=hong(직접 언급)+kim(FB 포지션 관련) — 차집합은 kim만 남는다.
		const mentionedU001 =
			doc.getElementById("u001")?.querySelector(".mentioned-members")?.textContent ?? "";
		expect(mentionedU001).toBe("고칠 사람: 홍길동");
		const relatedU001 =
			doc.getElementById("u001")?.querySelector(".related-members")?.textContent ?? "";
		expect(relatedU001).toBe("같은 포지션: 김철수");

		// u002: member_ids=[]이므로 "고칠 사람" 줄은 없고, relatedMembers 전체가 포지션 대상(position_target_ids)이라 "대상(GK):" 줄에 오며 "같은 포지션" 줄은 없다.
		expect(doc.getElementById("u002")?.querySelector(".mentioned-members")).toBeNull();
		const expectedU002 = relatedMembers({ member_ids: [], position_tags: ["GK"] }, ROSTER, null).map(
			(member) => member.name,
		);
		expect(doc.getElementById("u002")?.querySelector(".position-target-members")?.textContent).toBe(`대상(GK): ${expectedU002.join(", ")}`);
		expect(doc.getElementById("u002")?.querySelector("p.related-members:not(.position-target-members)")).toBeNull();
	});

	test("addressed_to_all 유닛은 카드 루트에 data-addressed-to-all=\"true\"를 달고 '대상: 전원' 칩을 렌더한다(DESIGN §5 item 6)", () => {
		const data = sampleData();
		data.units[0].addressed_to_all = true;
		const doc = parseHTML(renderSession(data)).document;
		const card = doc.getElementById("u001");
		expect(card?.getAttribute("data-addressed-to-all")).toBe("true");
		expect(plain(card?.querySelector(".addressed-all-line")?.textContent)).toBe("대상: 전원");
		// 고칠 사람이 함께 올 수 있다 — "고칠 사람:" 줄과 "대상: 전원" 줄이 공존한다.
		expect(card?.querySelector(".mentioned-members:not(.addressed-all-line)")?.textContent).toBe("고칠 사람: 홍길동");
	});

	test("댓글 피드백 유닛은 카드 머리 줄의 브레드크럼 안에 '· 댓글 작성 이름'을 렌더하고 제목 아래 별도 줄은 없다", () => {
		const data = sampleData();
		data.units[0].comment_author_names = ["뎁스차저", "maker654"];
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		const source = card?.querySelector(".card-head .breadcrumb .card-source");
		expect(plain(source?.textContent)).toBe("· 댓글 작성 뎁스차저, maker654");
		expect(source?.querySelector("[aria-hidden='true']")?.textContent).toBe("· ");
		expect(plain(card?.querySelector(".breadcrumb")?.textContent)).toBe("1경기 › 빌드업 전개 · 댓글 작성 뎁스차저, maker654");
		expect(card?.querySelector("h3 ~ p.feedback-source")).toBeNull();
	});

	test("음성 피드백 유닛은 출처가 없다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		expect(doc.getElementById("u001")?.querySelector(".card-source")).toBeNull();
	});

	test("경기·주제 정보가 없는 댓글 카드도 출처를 머리 줄에 보인다(구분점 없이)", () => {
		const data = sampleData();
		data.units[0].comment_author_names = ["뎁스차저"];
		data.units[0].match_id = "없는-경기";
		const source = parseHTML(renderSession(data)).document.querySelector("#u001 .card-head .card-source");
		expect(plain(source?.textContent)).toBe("댓글 작성 뎁스차저");
	});

	test("카드 출처는 한 덩어리로 줄바꿈하고(구분점이 줄 끝에 남지 않게) 제목 아래 줄 규칙은 헤더 한 줄(p)에만 남는다", () => {
		expect(STYLE).toMatch(/\n\.card-source\s*\{[^}]*display:\s*inline-block/);
		expect(STYLE).toMatch(/\np\.feedback-source\s*\{[^}]*margin:/);
		expect(STYLE).not.toMatch(/\n\.feedback-source\s*\{/);
	});

	test("addressed_to_all이 아닌 유닛은 data-addressed-to-all=\"false\"이고 '대상: 전원' 줄이 없다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const card = doc.getElementById("u001");
		expect(card?.getAttribute("data-addressed-to-all")).toBe("false");
		expect(card?.querySelector(".addressed-all-line")).toBeNull();
	});

	test("관련 팀원이 정확히 5명이면 여전히 <p> 한 줄로 전원이 나온다(모바일 가독성 상한 경계값)", () => {
		const data = sampleData();
		const extra = { id: "m5", name: "이영수", gamertag: "Lee", positions: ["CB"] };
		data.members = [...data.members, extra];
		data.units[0].member_ids = [];
		data.units[0].position_target_ids = [];
		data.units[0].related_member_ids = ["hong", "kim", "park", "choi", "m5"];
		const doc = parseHTML(renderSession(data)).document;
		const card = doc.getElementById("u001");
		expect(card?.querySelector("details.related-members")).toBeNull();
		const p = card?.querySelector("p.related-members");
		expect(p?.textContent).toBe("같은 포지션: 홍길동, 김철수, 박영희, 최민수, 이영수");
	});

	test("관련 팀원이 6명 이상이면 <details>로 접혀 앞 4명 + '외 N명'만 보이고 나머지는 펼쳐야 보인다(모바일 가독성)", () => {
		const data = sampleData();
		const extra = [
			{ id: "m5", name: "이영수", gamertag: "Lee", positions: ["CB"] },
			{ id: "m6", name: "정하늘", gamertag: "Jung", positions: ["CB"] },
			{ id: "m7", name: "오승민", gamertag: "Oh", positions: ["CB"] },
		];
		data.members = [...data.members, ...extra];
		data.units[0].member_ids = [];
		data.units[0].position_target_ids = [];
		data.units[0].related_member_ids = ["hong", "kim", "park", "choi", "m5", "m6", "m7"];
		const doc = parseHTML(renderSession(data)).document;
		const card = doc.getElementById("u001");
		expect(card?.querySelector("p.related-members")).toBeNull();
		const details = card?.querySelector("details.related-members");
		expect(details).not.toBeNull();
		const summary = details?.querySelector("summary");
		expect(summary?.textContent).toBe("같은 포지션: 홍길동, 김철수, 박영희, 최민수 외 3명");
		expect(summary?.querySelector(".related-more")?.textContent).toBe(" 외 3명");
		expect(summary?.querySelector('.member-name[data-member-id="m5"]')).toBeNull();
		const rest = details?.querySelector(".related-rest");
		expect(rest?.textContent).toBe("이영수, 정하늘, 오승민");
		expect(rest?.textContent?.startsWith(",")).toBe(false);
		for (const id of ["m5", "m6", "m7"]) {
			const mark = details?.querySelector(`.member-name[data-member-id="${id}"]`);
			expect(mark?.tagName.toLowerCase()).toBe("mark");
			expect(summary?.contains(mark ?? null)).toBe(false);
		}
	});

	test("관련 팀원 접힘 summary는 보이지 않는 44px 탭 확장 영역을 갖고, '외 N명'은 줄바꿈 없이 밑줄 전파도 막는다(DESIGN §13/§5 item 8)", () => {
		const beforeRule = STYLE.match(/\.related-members summary::before\s*\{[^}]*\}/)?.[0] ?? "";
		expect(beforeRule).toContain("position: absolute");
		expect(beforeRule).toContain("top: -11px");
		expect(beforeRule).toContain("bottom: -11px");
		const openBeforeRule = STYLE.match(/\.related-members\[open\] summary::before\s*\{[^}]*\}/)?.[0] ?? "";
		expect(openBeforeRule).toContain("bottom: 0");
		const moreRule = STYLE.match(/\.related-more\s*\{[^}]*\}/)?.[0] ?? "";
		expect(moreRule).toContain("white-space: nowrap");
		const moreAfterRule = STYLE.match(/\.related-more::after\s*\{[^}]*\}/)?.[0] ?? "";
		expect(moreAfterRule).toContain("display: inline-block");
	});

	test("유사 과거 피드백은 세션 날짜와 링크를 가진다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const item = doc.getElementById("u002")?.querySelector(".similar-list li");
		const similar = data.units[1].similar[0];
		expect(item?.textContent).toContain(similar.date);
		expect(item?.querySelector("a")?.getAttribute("href")).toBe(similar.href);
		expect(plain(item?.querySelector("a")?.textContent)).toBe(similar.title);
	});

	test("참고자료는 형식 배지와 이 장면과의 관련성 문장을 보여준다", () => {
		const data = sampleData();
		data.units[0].refs = [
			{
				id: "r-v",
				title: "센터백 간격 강의",
				lang: "ko",
				kind: "tactics",
				href: null,
				orig_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
				format: "video",
				relevance_ko: "두 센터백 사이 간격을 좁혀 크로스 헤딩을 막는 법",
				start_seconds: 245,
				version_badge: null,
				pro_clubs: false,
			},
		];
		const item = parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector(".refs-list li");
		expect(item?.querySelector(".ref-format")?.textContent).toBe("영상");
		expect(plain(item?.querySelector(".ref-relevance")?.textContent)).toBe("두 센터백 사이 간격을 좁혀 크로스 헤딩을 막는 법");
		const open = [...(item?.querySelectorAll("a") ?? [])].find((a) => a.textContent === "자료 영상 4:05부터 ↗");
		expect(open?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=245s");
	});

	test("시작 시각이 없는 영상과 글은 원문 링크를 그대로 연다", () => {
		const data = sampleData();
		const item = parseHTML(renderSession(data)).document.getElementById("u002")?.querySelector(".refs-list li");
		expect(item?.querySelector(".ref-format")?.textContent).toBe("글");
		expect([...(item?.querySelectorAll("a") ?? [])].some((a) => a.textContent === "원문 ↗")).toBe(true);
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
				format: "article",
				relevance_ko: "이 장면의 빌드업 문제를 다룬다",
				start_seconds: null,
				version_badge: null,
				pro_clubs: false,
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

// ── CJK 파이프라인 — titleHtml 라우팅 (DESIGN §10, 라운드8) ──────────────────

describe("CJK 파이프라인 — titleHtml 라우팅", () => {
	test("본문 프레임 캡션은 묶인 문법 구성의 공백을 nbsp로 치환한다(escapeHtml 대신 titleHtml 경유, 라운드8 회귀)", () => {
		const data = sampleData();
		data.units[2].body = [
			{ type: "text", text: "문단" },
			{
				type: "frame",
				src: "img/u003-c001.webp",
				width: 1280,
				height: 720,
				t: 105,
				caption: "좋은 각을 만들 것",
			},
		];
		const doc = parseHTML(renderSession(data)).document;
		const captionEl = doc.getElementById("u003")?.querySelector(".body-frame-caption");
		expect(captionEl?.textContent).toBe(`좋은 각을 만들${NBSP}것`);
	});

	test("유사한 과거 피드백 제목도 묶인 문법 구성을 보호한다(escapeHtml 대신 titleHtml 경유, 라운드8 회귀)", () => {
		const data = sampleData();
		data.units[1].similar = [
			{
				uid: "20230101-XXXXXXXXXXX#u002",
				title: "두 걸음 앞서는 위치선정",
				date: "2023-01-01",
				href: "../20230101-XXXXXXXXXXX/index.html#u002",
			},
		];
		const doc = parseHTML(renderSession(data)).document;
		const link = doc.getElementById("u002")?.querySelector(".similar-list a");
		expect(link?.textContent).toBe(`두${NBSP}걸음 앞서는 위치선정`);
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

	test("목차 항목은 시각 칩을 함께 보인다(DESIGN §8)", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const item = doc.querySelector('#panel-match .toc-item[data-target="u001"]');
		expect(item?.querySelector(".chip-time")?.textContent).toBe("12:34");
	});

	test("경기별 목차는 topic을 가장 이른 유닛 순서로 늘어놓고, 떨어진 유닛을 묶은 topic 안은 시간 순서다", () => {
		const data = sampleData();
		// plan 순서는 t2 → t1이지만 t1이 가장 이른 유닛(u001)을 가진다.
		data.matches[0].topics = [data.matches[0].topics[1], data.matches[0].topics[0]];
		const doc = parseHTML(renderSession(data)).document;
		expect([...doc.querySelectorAll("#panel-match .toc-topic-group h3")].map((h) => plain(h.textContent))).toEqual(["빌드업 전개", "피지컬 싸움"]);
		expect([...doc.querySelectorAll("#panel-match .toc-topic-group")[0].querySelectorAll(".toc-item")].map((a) => a.getAttribute("data-target"))).toEqual(["u001", "u003"]);
	});

	test("필터로 결과가 없어진 목차 그룹은 숨겨진다(DESIGN §8, :has() 의존 없이 JS로 계산)", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "GK"); // u002(피지컬/빌드업 아님)만 해당
		const buildupGroup = [...doc.querySelectorAll("#panel-topic .toc-tag-group")].find((group) =>
			group.querySelector("h2")?.textContent?.startsWith("빌드업"),
		);
		expect(isHidden(buildupGroup ?? null)).toBe(true); // u001, u003 모두 숨겨짐
		const physicalGroup = [...doc.querySelectorAll("#panel-match .toc-topic-group")].find(
			(group) => group.querySelector("h3")?.textContent === "피지컬 싸움",
		);
		expect(isHidden(physicalGroup ?? null)).toBe(false); // u002는 남아있음
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

	test("필터 다음 내 피드백 조합이 0건이면 빈 상태를 보인다(filter-empty-and, DESIGN §14) — 패싯 칩 두 개만으로는 0건에 도달할 수 없다(§7 라이브 카운트, 아래 별도 describe)", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		// 주제 "피지컬"은 선택 시점에 u002만 해당(0건이 아니라 눌린다) — 패싯끼리는 서로를 미리
		// 비활성화하므로, 0건에 도달하는 유일한 경로는 "내 피드백"(비활성화 대상이 아님)과의 조합이다.
		clickChip(doc, "topic", "피지컬"); // u002만 해당
		clickMinePill(doc, "choi"); // choi의 관련 유닛은 u003뿐 — 피지컬(u002)과 겹치지 않아 AND 0건
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

	test("공백을 포함한 주제 태그도 단독 선택 시 정상적으로 매칭된다(core.ts의 isValidTag는 공백을 허용, '|' 구분자로 인코딩)", () => {
		const data = sampleData();
		data.units[0].topic_tags = ["전환 역습"];
		const { doc } = mountViewer(renderSession(data), false);
		clickChip(doc, "topic", "전환 역습");
		expect(isHidden(doc.getElementById("u001"))).toBe(false);
		expect(isHidden(doc.getElementById("u002"))).toBe(true);
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

	test("YT가 정의되기 전에 로드돼도 onYouTubeIframeAPIReady를 등록한다", () => {
		const dom = parseHTML(renderSession(sampleData()));
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
		expect(() => runViewer(win, undefined)).not.toThrow();
		expect(typeof win.onYouTubeIframeAPIReady).toBe("function");
	});

	test("API 로드 전 카드 클릭도 이후 ready가 오면 플레이어가 생성되고 큐가 재생된다(REAL BUG 회귀)", () => {
		const dom = parseHTML(renderSession(sampleData()));
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
		runViewer(win, undefined); // window.YT가 아예 없는 콜드 로드 상태에서 시작

		click(win.document.getElementById("u002")); // Part 2 카드 — 아직 YT가 없어 ensurePlayer는 아무 것도 못 한다.
		expect(win.fcPlayer).toBeUndefined();

		win.YT = { Player: StubPlayer, loaded: true }; // iframe_api 스크립트가 뒤늦게 로드됨
		expect(typeof win.onYouTubeIframeAPIReady).toBe("function");
		win.onYouTubeIframeAPIReady?.();

		const stub = win.fcPlayer instanceof StubPlayer ? win.fcPlayer : null;
		expect(stub).not.toBeNull();
		expect(stub?.videoId).toBe("BBBBBBBBBBB"); // 클릭 시점의 currentVideo로 생성돼야 한다(초기 비디오가 아니라).

		stub?.fireReady(); // 큐에 쌓여 있던, 클릭 시점의 seekTo(3725)가 재생돼야 한다.
		const seekCall = stub?.calls.find((call) => call.method === "seekTo");
		expect(seekCall?.args[0]).toBe(3725);
	});

	test("서로 다른 파트를 잇따라 pre-ready 클릭하면 마지막 클릭의 목표만 적용된다(REAL BUG 회귀, 라운드7)", () => {
		const dom = parseHTML(renderSession(sampleData()));
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
		runViewer(win, undefined); // window.YT가 아예 없는 콜드 로드 상태에서 시작

		click(win.document.getElementById("u001")); // Part 1 카드, 754초 — 아직 YT가 없어 대기만 한다.
		const part2Btn = win.document.querySelector('.part-btn[data-video="BBBBBBBBBBB"]');
		click(part2Btn); // Part 2 버튼, 0초 — 이 클릭의 목표가 이전 클릭의 목표를 대체해야 한다.
		expect(win.fcPlayer).toBeUndefined();

		win.YT = { Player: StubPlayer, loaded: true }; // iframe_api 스크립트가 뒤늦게 로드됨
		win.onYouTubeIframeAPIReady?.();

		const stub = win.fcPlayer instanceof StubPlayer ? win.fcPlayer : null;
		expect(stub).not.toBeNull();
		expect(stub?.videoId).toBe("BBBBBBBBBBB"); // 마지막 클릭(Part 2)의 비디오로 생성된다.

		stub?.fireReady();
		// 이전 클릭(Part 1, 754초)의 stale seekTo가 Part 2 재생에 흘러들어와선 안 된다 — 큐가 아니라
		// 단일 슬롯이므로 Part 2 클릭(0초, 별도 seek 불필요)이 이를 완전히 대체한다.
		expect(stub?.calls.some((call) => call.method === "seekTo")).toBe(false);
		expect(stub?.calls.some((call) => call.method === "loadVideoById")).toBe(false);
	});

	test("pre-ready Part 버튼 클릭(0초, 같은 비디오)도 ready 시 playVideo를 호출해 재생을 시작한다(REAL BUG 회귀, 라운드8)", () => {
		const { doc, stub } = mountViewer(renderSession(sampleData()), true);
		// onPartButtonClick은 항상 switchTo(video, 0, ...)를 호출한다 — 이미 재생 중인 파트를 다시
		// 눌러도 마찬가지다. 플레이어가 이미 같은 비디오로 생성된 채(mountViewer 초기화) ready 이전에
		// 눌리면, start가 0이라 seekTo조차 실행되지 않는데 playVideo 호출도 없으면 플레이어가 idle
		// 상태로 멈춰 있게 된다(§9 계약 위반).
		const part1Btn = doc.querySelector('.part-btn[data-video="AAAAAAAAAAA"]');
		click(part1Btn); // ready 전 — 아직 아무 것도 실행되지 않는다.
		expect(stub?.calls.length ?? -1).toBe(0);

		stub?.fireReady();
		const methods = stub?.calls.map((call) => call.method) ?? [];
		expect(methods.filter((m) => m === "playVideo").length).toBe(1);
		expect(methods).not.toContain("seekTo");
		expect(methods).not.toContain("loadVideoById");
	});

	test("onReady 시 대기 중인 액션이 없으면 아무 메서드도 호출하지 않는다(진행 중인 재생 상태를 건드리지 않는다)", () => {
		const { stub } = mountViewer(renderSession(sampleData()), true);
		stub?.fireReady(); // 클릭 없이 바로 ready — pendingAction이 애초에 없다.
		expect(stub?.calls.length).toBe(0);
	});
});

// ── layout skeleton (DESIGN §4) ──────────────────────────────────────────

describe("레이아웃 골격", () => {
	test("side-col은 player-wrapper와 side를 함께 묶고, main은 단일 wrapper다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const sideCol = doc.querySelector(".side-col");
		expect(sideCol).not.toBeNull();
		expect(sideCol?.querySelector(".player-wrapper")).not.toBeNull();
		expect(sideCol?.querySelector(".side")).not.toBeNull();
		expect(doc.querySelector(".main")).not.toBeNull();
		expect(doc.querySelector(".main .my-feedback, .main .filter-bar")).not.toBeNull();
	});

	test("필터 바는 기본 상태에서 open이 아니다(모바일 접힘·1440 fold 확보, DESIGN §7)", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const filterBar = doc.querySelector(".filter-bar");
		expect(filterBar?.tagName.toLowerCase()).toBe("details");
		expect(filterBar?.hasAttribute("open")).toBe(false);
	});

	test("목차는 모바일 접힘을 위해 토글 버튼+hidden 패널로 감싸이고, 데스크톱에서는 CSS로 항상 펼쳐진다(DESIGN §4)", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const toggle = doc.querySelector(".toc-scroll .toc-toggle");
		const panel = doc.querySelector(".toc-scroll .toc-panel");
		expect(toggle?.textContent).toBe("목차");
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		expect(toggle?.getAttribute("aria-controls")).toBe("toc-panel");
		expect(panel?.id).toBe("toc-panel");
		expect(panel?.hasAttribute("hidden")).toBe(true);
		expect(panel?.querySelector(".toc")).not.toBeNull();
	});

	test("목차 토글 버튼을 누르면 패널이 펼쳐지고 aria-expanded가 갱신된다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		const toggle = doc.querySelector(".toc-toggle");
		const panel = doc.querySelector(".toc-panel");
		expect(isHidden(panel)).toBe(true);
		click(toggle);
		expect(isHidden(panel)).toBe(false);
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		click(toggle);
		expect(isHidden(panel)).toBe(true);
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
	});
});

describe("토큰·와이드 칩 (DESIGN §2, §15-10)", () => {
	test("STYLE에는 raw #fff가 없다(모두 --bg 토큰을 쓴다)", () => {
		expect(/#fff(?![0-9a-f])/i.test(STYLE)).toBe(false);
	});

	test("칩(.chip)은 줄바꿈 없이 한 줄을 유지한다", () => {
		const chipRule = STYLE.match(/\.chip\s*\{[^}]*\}/)?.[0] ?? "";
		expect(chipRule).toContain("white-space: nowrap");
		expect(chipRule).toContain("flex-shrink: 0");
	});

	test(".card-list는 명시적 display(flex)를 갖는 요소라 [hidden] 전용 오버라이드가 없으면 UA [hidden]이 지지 않는다 — 0건일 때 flex 슬롯이 남아 빈 상태 위 여백이 배로 벌어지던 결함(라운드6 CJK 검토)", () => {
		expect(STYLE).toMatch(/\.card-list\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
	});
});

// ── 필터 옵션: 세션 전체 0건 숨김 · 라이브 카운트 (DESIGN §7) ────────────────

describe("필터 옵션 — 세션 전체 0건 숨김", () => {
	test("결과가 없는 포지션 노드(MF)는 렌더되지 않고, 있는 노드는 카운트를 보인다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const values = [...doc.querySelectorAll('.chip-filter[data-group="position"]')].map((el) =>
			el.getAttribute("data-value"),
		);
		expect(values).not.toContain("MF");
		const fb = doc.querySelector('.chip-filter[data-group="position"][data-value="FB"]');
		expect(fb?.textContent).toContain("(1)");
	});

	test("이름 필터 그룹 라벨은 '이름이 나온 선수'다(내 피드백의 '이름이 나온 장면'과 같은 말)", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		expect(plain(doc.querySelector('.filter-group[data-role="filter-mention"] .filter-group-label')?.textContent)).toBe("이름이 나온 선수");
	});

	test("언급이 없는 팀원(park·kim)은 언급 선수 옵션에 나타나지 않는다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const values = [...doc.querySelectorAll('.chip-filter[data-group="mention"]')].map((el) =>
			el.getAttribute("data-value"),
		);
		expect(values).toContain("hong");
		expect(values).toContain("choi");
		expect(values).not.toContain("park");
		expect(values).not.toContain("kim");
	});

	test("선택된 옵션은 다른 조건과의 AND로 0건이 되어도 필터 바에서 사라지거나 비활성화되지 않는다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "GK"); // 선택 시점엔 u002 1건 — 눌린다
		clickMinePill(doc, "choi"); // choi 관련 유닛은 u003(ST)뿐 — GK(u002)와 겹치지 않아 AND 0건
		const gkChip = doc.querySelector('.chip-filter[data-group="position"][data-value="GK"]');
		expect(gkChip).not.toBeNull();
		expect(gkChip?.getAttribute("aria-pressed")).toBe("true");
		expect(gkChip?.hasAttribute("disabled")).toBe(false); // 이미 선택된 옵션은 절대 비활성화하지 않는다(§7)
	});
});

// ── 라이브 패싯 카운트 — 선택 조건 재계산·비활성화 (DESIGN §7, 사용자 요청 반영) ─────

describe("라이브 패싯 카운트", () => {
	test("다른 그룹 선택 시 옵션 카운트가 실시간으로 재계산되고, 0건 옵션은 비활성화된다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "GK"); // u002(피지컬)만 해당

		const buildup = doc.querySelector('.chip-filter[data-group="topic"][data-value="빌드업"]');
		expect(buildup?.querySelector(".chip-count")?.textContent).toBe("(0)"); // GK와 겹치는 빌드업 카드 없음
		expect(buildup?.hasAttribute("disabled")).toBe(true);
		expect(buildup?.getAttribute("aria-disabled")).toBe("true");

		const physical = doc.querySelector('.chip-filter[data-group="topic"][data-value="피지컬"]');
		expect(physical?.querySelector(".chip-count")?.textContent).toBe("(1)"); // u002 그대로 살아있다
		expect(physical?.hasAttribute("disabled")).toBe(false);

		const hongMention = doc.querySelector('.chip-filter[data-group="mention"][data-value="hong"]');
		expect(hongMention?.querySelector(".chip-count")?.textContent).toBe("(0)"); // hong은 u001(FB) 소속
		expect(hongMention?.hasAttribute("disabled")).toBe(true);
	});

	test("이미 선택된 옵션은 절대 비활성화하지 않는다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "GK");
		clickMinePill(doc, "choi"); // GK(u002)와 choi 관련(u003)은 서로 겹치지 않는다
		const gkChip = doc.querySelector('.chip-filter[data-group="position"][data-value="GK"]');
		expect(gkChip?.querySelector(".chip-count")?.textContent).toBe("(0)"); // 카운트는 정직하게 0을 보이지만
		expect(gkChip?.hasAttribute("disabled")).toBe(false); // 선택된 옵션이라 비활성화되지 않는다
	});

	test('태그 이름이 "constructor"여도 프로토타입 값이 아니라 정직한 카운트를 보이고 0건이면 비활성화된다(REAL BUG 회귀, 라운드7)', () => {
		const data = sampleData();
		data.units[0].topic_tags = ["constructor"]; // u001(FB) — 플레인 {} 카운트 조회라면 Object.prototype.constructor를 읽어올 위험이 있는 이름
		const { doc } = mountViewer(renderSession(data), false);

		const chip = doc.querySelector('.chip-filter[data-group="topic"][data-value="constructor"]');
		expect(chip?.querySelector(".chip-count")?.textContent).toBe("(1)");

		clickChip(doc, "position", "GK"); // u002만 해당 — u001(FB, constructor 태그)과 겹치지 않는다
		expect(chip?.querySelector(".chip-count")?.textContent).toBe("(0)");
		expect(chip?.hasAttribute("disabled")).toBe(true);
		expect(chip?.getAttribute("aria-disabled")).toBe("true");
	});

	test("주제 그룹은 내부적으로 OR다 — 이미 선택된 옵션이 같은 그룹의 다른 옵션을 비활성화하지 않는다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "topic", "빌드업"); // u001, u003
		const transition = doc.querySelector('.chip-filter[data-group="topic"][data-value="전환"]');
		expect(transition?.querySelector(".chip-count")?.textContent).toBe("(1)"); // u003 — 빌드업 선택의 영향을 받지 않는다
		expect(transition?.hasAttribute("disabled")).toBe(false);
	});

	test("비활성화된 옵션은 클릭해도 선택되지 않는다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "GK");
		clickChip(doc, "topic", "빌드업"); // 이 시점에 이미 비활성화된 옵션 — 클릭이 무시돼야 한다
		const buildup = doc.querySelector('.chip-filter[data-group="topic"][data-value="빌드업"]');
		expect(buildup?.getAttribute("aria-pressed")).toBe("false");
		expect(isHidden(doc.getElementById("u002"))).toBe(false); // GK 조건 그대로 — 0건이 되지 않았다
	});

	test("필터 해제 시 카운트가 선택 없음 상태(빌드 시점 카운트)로 복원된다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "GK");
		click(doc.querySelector(".filter-reset"));
		const buildup = doc.querySelector('.chip-filter[data-group="topic"][data-value="빌드업"]');
		expect(buildup?.querySelector(".chip-count")?.textContent).toBe("(2)"); // u001 + u003
		expect(buildup?.hasAttribute("disabled")).toBe(false);
	});

	test('주제 태그에 큰따옴표가 있어도 활성 필터 칩의 × 버튼으로 정상 해제된다(REAL BUG 회귀, 라운드7)', () => {
		const data = sampleData();
		const quoted = '전환"역습'; // data-value에 "가 있으면 콘캣 CSS 셀렉터가 깨져 던지는 시나리오
		data.units[2].topic_tags = [quoted]; // u003(ST)
		const { doc } = mountViewer(renderSession(data), false);

		const chip = [...doc.querySelectorAll('.chip-filter[data-group="topic"]')].find(
			(el) => el.getAttribute("data-value") === quoted,
		);
		expect(chip).not.toBeUndefined();
		click(chip);
		expect(chip?.getAttribute("aria-pressed")).toBe("true");

		const removeBtn = doc.querySelector(".active-filters .chip-remove");
		expect(removeBtn).not.toBeNull();
		expect(() => click(removeBtn)).not.toThrow();

		expect(chip?.getAttribute("aria-pressed")).toBe("false");
		expect(doc.querySelector(".active-filters")?.hasAttribute("hidden")).toBe(true);
	});
});

// ── 내 피드백 (DESIGN §6) ──────────────────────────────────────────────────

describe("내 피드백", () => {
	test("결과가 있는 팀원만 pill로 노출된다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const expectedIds = new Set(data.units.flatMap((unit) => unit.related_member_ids));
		const pillIds = [...doc.querySelectorAll(".pill-mine")].map((el) => el.getAttribute("data-value"));
		expect(new Set(pillIds)).toEqual(expectedIds);
	});

	test("선택 시 relatedMembers 카드만 남고 결과 수가 갱신된다", () => {
		const data = sampleData();
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "kim");
		const visibleIds = data.units.filter((unit) => unit.related_member_ids.includes("kim")).map((unit) => unit.id);
		for (const unit of data.units) {
			expect(isHidden(doc.getElementById(unit.id))).toBe(!visibleIds.includes(unit.id));
		}
		expect(doc.getElementById("visible-count")?.textContent).toBe(String(visibleIds.length));
	});

	test("배지는 data-member-ids/data-related-ids 기준으로 직접 언급과 포지션 관련(참고)을 구분한다", () => {
		const data = sampleData();
		const { doc } = mountViewer(renderSession(data), false);

		// kim: u001의 member_ids에는 없지만 FB 포지션으로 related_member_ids에는 있다 → "포지션 관련(참고)".
		clickMinePill(doc, "kim");
		const badgeU001Kim = doc.getElementById("u001")?.querySelector(".mention-badge");
		expect(badgeU001Kim?.textContent).toBe("같은 포지션 참고");
		expect(badgeU001Kim?.classList.contains("mention-related")).toBe(true);
		expect(isHidden(doc.getElementById("u002")?.querySelector(".mention-badge") ?? null)).toBe(true);

		clickMinePill(doc, "kim"); // 토글 해제
		clickMinePill(doc, "hong"); // hong: u001의 member_ids에 직접 있다 → "직접 언급".
		const badgeU001Hong = doc.getElementById("u001")?.querySelector(".mention-badge");
		expect(badgeU001Hong?.textContent).toBe("고칠 점");
		expect(badgeU001Hong?.classList.contains("mention-direct")).toBe(true);
	});

	test("선택 시 언급/관련 목록에서 해당 이름만 mark.mine으로 강조된다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickMinePill(doc, "hong");
		const mark = doc.getElementById("u001")?.querySelector('.member-name[data-member-id="hong"]');
		expect(mark?.tagName.toLowerCase()).toBe("mark");
		expect(mark?.classList.contains("mine")).toBe(true);
	});

	test("접힌 관련 팀원 목록 안의 이름을 선택하면 details가 자동으로 펼쳐진다(강조가 가리지 않도록)", () => {
		const data = sampleData();
		const extra = [
			{ id: "m5", name: "이영수", gamertag: "Lee", positions: ["CB"] },
			{ id: "m6", name: "정하늘", gamertag: "Jung", positions: ["CB"] },
			{ id: "m7", name: "오승민", gamertag: "Oh", positions: ["CB"] },
		];
		data.members = [...data.members, ...extra];
		data.units[0].member_ids = [];
		data.units[0].position_target_ids = [];
		data.units[0].related_member_ids = ["hong", "kim", "park", "choi", "m5", "m6", "m7"];
		const { doc } = mountViewer(renderSession(data), false);

		const details = doc.getElementById("u001")?.querySelector("details.related-members");
		expect(details?.hasAttribute("open")).toBe(false);

		clickMinePill(doc, "m6"); // m6: 접힌 "외 3명" 안에 있는 이름
		expect(details?.hasAttribute("open")).toBe(true);
		const mark = details?.querySelector('.member-name[data-member-id="m6"]');
		expect(mark?.classList.contains("mine")).toBe(true);

		clickMinePill(doc, "m6"); // 토글 해제 — 선택 해제 시 자동으로 펼쳐진 details를 다시 접지 않는다
		expect(details?.hasAttribute("open")).toBe(true);
	});

	test('"내 피드백" 선택 시 is-direct는 직접 언급 카드에만 붙고 해제하면 지워진다(DESIGN §6)', () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);

		clickMinePill(doc, "kim"); // kim: u001에 포지션(FB) 관련만 있고 직접 언급은 없다.
		expect(doc.getElementById("u001")?.classList.contains("is-direct")).toBe(false);

		clickMinePill(doc, "kim"); // 토글 해제
		clickMinePill(doc, "hong"); // hong: u001의 member_ids에 직접 있다.
		expect(doc.getElementById("u001")?.classList.contains("is-direct")).toBe(true);

		clickMinePill(doc, "hong");
		expect(doc.getElementById("u001")?.classList.contains("is-direct")).toBe(false);
	});

	/** card-list의 자식을 DOM 순서대로 "H:제목" / "C:id"로 나열한다. */
	function cardListOrder(doc: Document): string[] {
		return [...(doc.querySelector(".card-list")?.children ?? [])]
			.filter((el) => !el.hasAttribute("hidden"))
			.map((el) => (el.classList.contains("mine-group-heading") ? `H:${el.textContent}` : `C:${el.id}`));
	}

	test("pill 큰 숫자는 고칠 점이고 전원 대상은 팀 숫자, 포지션 참고만 '· 참고 N'으로 따로 보인다(DESIGN §6)", () => {
		const data = sampleData();
		data.units[1].addressed_to_all = true; // u002: 전원 대상 — 모든 팀원에게 적용된다
		const doc = parseHTML(renderSession(data)).document;
		// hong: u001 고칠 점 1건(큰 숫자) + u002 전원 대상 1건(팀 1), u003(ST)은 hong과 무관해 참고 없음.
		const hong = doc.querySelector('.pill-mine[data-value="hong"]');
		expect(hong?.querySelector(".count")?.textContent).toBe("1");
		expect(hong?.querySelector(".count-team")?.textContent).toBe("· 팀 1");
		expect(hong?.querySelector(".count-ref")).toBeNull();
		// kim: 고칠 점 0건(큰 숫자 0), u002 전원 대상 1건(팀 1), u001은 포지션 관련 참고 1건.
		const kim = doc.querySelector('.pill-mine[data-value="kim"]');
		expect(kim?.querySelector(".count")?.textContent).toBe("0");
		expect(kim?.querySelector(".count-team")?.textContent).toBe("· 팀 1");
		expect(kim?.querySelector(".count-ref")?.textContent).toBe("· 참고 1");
	});

	test("pill 줄 아래에 숫자와 참고가 세는 것을 설명하는 보이는 범례가 한 줄 있다(hover가 없는 폰, DESIGN §6)", () => {
		const legend = parseHTML(renderSession(sampleData())).document.querySelector(".my-feedback .my-feedback-legend");
		expect(plain(legend?.textContent)).toBe("숫자: 내가 고칠 점 / 팀: 내 포지션 대상 · 전원 대상 / 참고: 이름이 나온 장면 · 같은 포지션 지적");
	});

	test("참고 건수가 0이면 '· 참고' 표기를 생략한다", () => {
		const data = sampleData();
		data.units = [data.units[2]]; // u003: choi 직접 언급 1건뿐
		data.matches[0].topics = [{ ...data.matches[0].topics[0], unit_ids: ["u003"] }];
		const doc = parseHTML(renderSession(data)).document;
		const choi = doc.querySelector('.pill-mine[data-value="choi"]');
		expect(choi?.querySelector(".count")?.textContent).toBe("1");
		expect(choi?.querySelector(".count-ref")).toBeNull();
	});

	test('"내 피드백" 선택 시 실제 DOM이 "직접 언급 → 전원 대상 → 포지션 참고" 제목 아래로 재배치되고 해제하면 시간 순서로 돌아온다(DESIGN §6)', () => {
		const data = sampleData();
		// u001: hong 직접 / u002: 전원 대상 / u003: hong과 포지션 관련만(참고)
		data.units[1].addressed_to_all = true;
		data.units[2].related_member_ids = ["choi", "hong"];
		const { doc } = mountViewer(renderSession(data), false);
		const original = cardListOrder(doc);
		expect(original).toEqual(["C:u001", "C:u002", "C:u003"]);

		clickMinePill(doc, "hong");
		expect(cardListOrder(doc)).toEqual(["H:고칠 점 1", "C:u001", "H:전원 대상 1", "C:u002", "H:같은 포지션 참고 1", "C:u003"]);

		clickMinePill(doc, "hong"); // 해제
		expect(cardListOrder(doc)).toEqual(original);
		expect(doc.querySelectorAll(".mine-group-heading").length).toBe(0);
	});

	test("그룹 제목은 비어 있는 그룹을 생략하고, 직접 언급 카드가 문서 순서상 뒤에 있어도 DOM에서 앞으로 온다", () => {
		const data = sampleData();
		data.units[0].member_ids = ["choi"]; // u001: 다른 사람의 지적, hong은 포지션 관련(참고)로만 남는다
		data.units[0].related_member_ids = ["choi", "hong"];
		data.units[2].member_ids = ["hong"]; // u003: hong 직접 언급
		data.units[2].related_member_ids = ["hong"];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		expect(cardListOrder(doc)).toEqual(["H:고칠 점 1", "C:u003", "H:같은 포지션 참고 1", "C:u001"]);
	});
});

describe("전원 대상 유닛과 내 피드백", () => {
	test("addressed_to_all 유닛은 누구를 선택해도 남는다(mine 필터 통과)", () => {
		const data = sampleData();
		data.units[1].addressed_to_all = true; // u002: member_ids=[], 특정 포지션과 무관한 원칙
		for (const memberId of ["hong", "kim", "park", "choi"]) {
			const { doc } = mountViewer(renderSession(data), false);
			clickMinePill(doc, memberId);
			expect(isHidden(doc.getElementById("u002"))).toBe(false);
		}
	});

	test("다른 필터가 없는 상태에서 pill의 고칠 점 수 + 참고 수는 그 팀원만 선택했을 때의 결과 수와 일치한다", () => {
		const data = sampleData();
		data.units[1].addressed_to_all = true;
		const { doc } = mountViewer(renderSession(data), false);
		for (const memberId of ["hong", "kim", "park", "choi"]) {
			const pill = doc.querySelector(`.pill-mine[data-value="${memberId}"]`);
			const direct = Number(pill?.querySelector(".count")?.textContent) + Number((pill?.querySelector(".count-team")?.textContent ?? "").replace(/\D/g, "") || "0");
			const reference = Number((pill?.querySelector(".count-ref")?.textContent ?? "").replace(/\D/g, "") || "0");
			clickMinePill(doc, memberId); // 선택
			const visibleCount = Number(doc.getElementById("visible-count")?.textContent);
			expect(direct + reference).toBe(visibleCount);
			clickMinePill(doc, memberId); // 해제(다음 팀원을 위해)
		}
	});

	test("mine 선택 시 전원 카드는 '직접 언급'도 '포지션 관련(참고)'도 아닌 '전원' 배지를 보인다", () => {
		const data = sampleData();
		data.units[1].addressed_to_all = true; // u002: member_ids=[]
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong"); // hong은 u002의 member_ids에도 related_member_ids에도 없다.
		const badge = doc.getElementById("u002")?.querySelector(".mention-badge");
		expect(badge?.textContent).toBe("전원 대상");
		expect(badge?.classList.contains("mention-all")).toBe(true);
	});

	test("addressed_to_all이어도 member_ids에 선택한 팀원이 있으면 '직접 언급'이 우선한다", () => {
		const data = sampleData();
		data.units[0].addressed_to_all = true;
		data.units[0].member_ids = ["hong"]; // 이름 불린 팀원과 함께 온 전원 대상 원칙
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		const badge = doc.getElementById("u001")?.querySelector(".mention-badge");
		expect(badge?.textContent).toBe("고칠 점");
		expect(badge?.classList.contains("mention-direct")).toBe(true);
	});

	test("addressed_to_all 유닛은 member_ids가 비어 있으면 '언급 선수' 필터 옵션에 걸리지 않는다(DESIGN §7)", () => {
		const data = sampleData();
		data.units[1].addressed_to_all = true; // u002: member_ids=[]
		const doc = parseHTML(renderSession(data)).document;
		const mentionValues = [...doc.querySelectorAll('.chip-filter[data-group="mention"]')].map((el) =>
			el.getAttribute("data-value"),
		);
		// u002가 유일하게 "hong"을 언급하는 유닛이 되지 않도록, 다른 유닛의 member_ids로만 옵션이 구성되는지 확인한다.
		for (const memberId of mentionValues) {
			const unitsWithMember = data.units.filter((unit) => unit.member_ids.includes(memberId ?? ""));
			expect(unitsWithMember.length).toBeGreaterThan(0);
		}
	});
});

describe("전원 대상 유닛의 적용 범위(경기 lineup, DESIGN §6)", () => {
	/** u002(전원 대상)가 m1에 속하고 m1에는 hong·kim만 뛰었다. park·choi는 그 경기에 뛰지 않았다. */
	function lineupData(): SessionDataInput {
		const data = sampleData();
		data.units[1].addressed_to_all = true;
		data.units[1].related_member_ids = []; // 포지션 경로로는 아무에게도 닿지 않는 순수 전원 대상
		data.units[1].position_target_ids = [];
		data.matches[0].lineup = { hong: "CB", kim: "FB" };
		return data;
	}

	test("lineup에도 없고 그 경기 원문에 이름도 없는 팀원의 pill 숫자에는 그 경기의 전원 대상 유닛이 들지 않는다", () => {
		const doc = parseHTML(renderSession(lineupData())).document;
		const count = (id: string) => doc.querySelector(`.pill-mine[data-value="${id}"] .count`)?.textContent;
		expect(count("hong")).toBe("1"); // u001 고칠 점
		expect(doc.querySelector('.pill-mine[data-value="hong"] .count-team')?.textContent).toBe("· 팀 1"); // u002 전원 대상
		expect(count("kim")).toBe("0");
		expect(doc.querySelector('.pill-mine[data-value="kim"] .count-team')?.textContent).toBe("· 팀 1"); // u002 전원 대상
		expect(count("choi")).toBe("1"); // u003 고칠 점뿐
		expect(doc.querySelector('.pill-mine[data-value="park"]')).toBeNull(); // 아무 건도 없는 팀원
	});

	test("lineup 밖 팀원을 선택하면 전원 대상 카드가 숨겨지고, lineup 안 팀원에게는 '전원 대상' 그룹으로 남는다", () => {
		const { doc } = mountViewer(renderSession(lineupData()), false);
		clickMinePill(doc, "choi");
		expect(isHidden(doc.getElementById("u002"))).toBe(true);
		expect(doc.getElementById("visible-count")?.textContent).toBe("1");
		clickMinePill(doc, "choi"); // 해제
		clickMinePill(doc, "kim");
		expect(isHidden(doc.getElementById("u002"))).toBe(false);
		expect([...doc.querySelectorAll(".mine-group-heading")].map((el) => el.textContent)).toContain("전원 대상 1");
	});

	test("lineup 밖이어도 그 경기 어느 유닛 원문에 이름이 나온 팀원(뛴 것이 들린 팀원)에게는 전원 대상이 닿는다", () => {
		const data = lineupData();
		data.units[0].named_member_ids = ["park"]; // u001(같은 m1)에서 이름이 불렸지만 포지션을 몰라 lineup에 없다
		const { doc } = mountViewer(renderSession(data), false);
		expect(doc.getElementById("u002")?.getAttribute("data-addressed-member-ids")).toBe("hong|kim|park");
		expect(doc.querySelector('.pill-mine[data-value="park"] .count-team')?.textContent).toBe("· 팀 1");
		clickMinePill(doc, "park");
		expect(isHidden(doc.getElementById("u002"))).toBe(false);
		expect([...doc.querySelectorAll(".mine-group-heading")].map((el) => el.textContent)).toContain("전원 대상 1");
	});

	test("lineup이 null이거나 없는 경기(옛 data.json)의 전원 대상 유닛은 모든 팀원에게 적용된다", () => {
		for (const lineup of [null, undefined]) {
			const data = lineupData();
			if (lineup === undefined) delete data.matches[0].lineup;
			else data.matches[0].lineup = lineup;
			const doc = parseHTML(renderSession(data)).document;
			expect(doc.querySelector('.pill-mine[data-value="park"] .count-team')?.textContent).toBe("· 팀 1");
			expect(doc.getElementById("u002")?.getAttribute("data-addressed-member-ids")).toBe("hong|kim|park|choi");
		}
	});
});

// ── 활성 필터 — 내 피드백 칩 (DESIGN §6/§7, 라운드8 시각 QA) ───────────────────

describe("활성 필터 — 내 피드백 칩", () => {
	test('"내 피드백" 선택 시 활성 필터 줄 맨 앞에 "내 피드백: {이름}" 칩이 나타나고, 그 줄이 보인다', () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "topic", "빌드업"); // 다른 그룹 칩이 먼저 있어도 mine 칩이 맨 앞이어야 한다
		clickMinePill(doc, "hong");

		const container = doc.querySelector(".active-filters");
		expect(isHidden(container)).toBe(false);
		const chips = [...(container?.querySelectorAll(".chip-active") ?? [])];
		expect(chips[0]?.textContent).toContain("내 피드백: 홍길동");
		expect(chips[1]?.textContent).toContain("주제: 빌드업");
	});

	test('"내 피드백" 선택만 있어도(다른 필터 그룹 선택 없이) 활성 필터 줄이 보인다', () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		expect(isHidden(doc.querySelector(".active-filters"))).toBe(true); // 선택 전에는 숨김
		clickMinePill(doc, "hong");
		expect(isHidden(doc.querySelector(".active-filters"))).toBe(false);
	});

	test("칩의 × 클릭은 그 pill을 다시 누른 것과 동일하게 내 피드백 선택을 해제한다(aria-pressed·그룹 제목·배지·강조·패싯 카운트 모두 복원)", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);

		// choi는 u003(ST)만 관련이라, mine=choi 동안 hong(u001, FB)을 대상으로 하는 mention 칩은
		// 0건으로 비활성화된다 — 위 "라이브 패싯 카운트" describe와 같은 판정 로직.
		clickMinePill(doc, "choi");
		const hongMention = doc.querySelector('.chip-filter[data-group="mention"][data-value="hong"]');
		expect(hongMention?.querySelector(".chip-count")?.textContent).toBe("(0)");
		expect(hongMention?.hasAttribute("disabled")).toBe(true);
		expect(doc.querySelectorAll(".mine-group-heading").length).toBeGreaterThan(0);

		const removeBtn = doc.querySelector('.active-filters .chip-active .chip-remove');
		expect(removeBtn).not.toBeNull();
		click(removeBtn);

		const choiPill = doc.querySelector('.pill-mine[data-value="choi"]');
		expect(choiPill?.getAttribute("aria-pressed")).toBe("false");
		expect(doc.querySelectorAll(".mine-group-heading").length).toBe(0);
		expect(isHidden(doc.querySelector(".active-filters"))).toBe(true);
		expect(hongMention?.querySelector(".chip-count")?.textContent).toBe("(1)"); // 빌드 시점 카운트로 복원
		expect(hongMention?.hasAttribute("disabled")).toBe(false);
	});

	test('"전체 해제"는 내 피드백 선택도 함께 지운다(필터 바·활성 필터 줄·빈 상태 버튼 공통)', () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickMinePill(doc, "hong");
		expect(doc.querySelector('.pill-mine[data-value="hong"]')?.getAttribute("aria-pressed")).toBe("true");

		click(doc.querySelector(".filter-reset"));

		expect(doc.querySelector('.pill-mine[data-value="hong"]')?.getAttribute("aria-pressed")).toBe("false");
		expect(doc.querySelectorAll(".mine-group-heading").length).toBe(0);
		expect(isHidden(doc.querySelector(".active-filters"))).toBe(true);
		expect(doc.getElementById("visible-count")?.textContent).toBe(String(sampleData().units.length));
	});
});

// ── 플레이어 접기 (DESIGN §4) ──────────────────────────────────────────────

describe("플레이어 접기", () => {
	test("aria-expanded를 토글하고 wrapper에 is-collapsed 클래스를 붙인다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		const btn = doc.querySelector(".player-collapse");
		expect(btn?.getAttribute("aria-expanded")).toBe("true");
		expect(btn?.textContent).toBe("플레이어 접기");

		click(btn);

		expect(btn?.getAttribute("aria-expanded")).toBe("false");
		expect(btn?.textContent).toBe("펼치기");
		expect(doc.querySelector(".player-wrapper")?.classList.contains("is-collapsed")).toBe(true);
	});

	test("player-collapse는 iframe 위가 아니라 영상 아래 별도 toolbar 줄에 있다(마크업 순서, 라운드7 시각 QA)", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		const wrapper = doc.querySelector(".player-wrapper");
		const children = Array.from(wrapper?.children ?? []);
		expect(children.map((el) => el.className)).toEqual(["player-media", "player-toolbar"]);
		expect(doc.querySelector(".player-toolbar .player-collapse")).not.toBeNull();
		expect(doc.querySelector(".player-media .player-collapse")).toBeNull();
	});

	test("STYLE은 player-collapse를 iframe 위에 겹치는 position:absolute로 두지 않는다(DESIGN §4, 라운드7 시각 QA)", () => {
		const rules = STYLE.match(/\.player-collapse\s*\{[^}]*\}/g) ?? [];
		expect(rules.length).toBeGreaterThan(0);
		for (const rule of rules) {
			expect(rule).not.toMatch(/position:\s*absolute/);
		}
	});

	test("STYLE은 1024px 미만 펼친 상태의 높이 계약을 .player-media(영상 ≤200px)와 .player-toolbar(44px)로 나눠 고정한다(DESIGN §4/§15-3, 라운드8: 전체 ≤244px)", () => {
		const mediaRule = STYLE.match(/\.player-media\s*\{[^}]*height:\s*min\(56\.25vw,\s*200px\)[^}]*\}/);
		expect(mediaRule).not.toBeNull();
		const toolbarRule = STYLE.match(/\.player-toolbar\s*\{[^}]*min-height:\s*44px[^}]*\}/);
		expect(toolbarRule).not.toBeNull();
	});
});

// ── 텍스트 선택 가드 · 확대 링크 (DESIGN §5, §13) ──────────────────────────

describe("텍스트 선택 가드 · 확대 링크", () => {
	test("VIEWER_JS는 getSelection이 비어있지 않으면 카드 클릭 seek를 실행하지 않는다", () => {
		expect(VIEWER_JS).toContain("getSelection");

		const data = sampleData();
		data.units[0].body = [
			{ type: "text", text: "문단" },
			{ type: "frame", src: "img/u001-c001.webp", width: 1280, height: 720, t: 760, caption: "장면" },
		];
		const dom = parseHTML(renderSession(data));
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
		win.getSelection = () => ({ toString: () => "선택된 텍스트" });
		runViewer(win, { Player: StubPlayer, loaded: true });
		const stub = win.fcPlayer instanceof StubPlayer ? win.fcPlayer : null;
		stub?.fireReady();

		click(win.document.getElementById("u001"));
		expect(stub?.calls.length ?? -1).toBe(0);
	});

	test("본문 프레임의 확대 링크는 새 탭·noopener로 원본을 열고 data-frame-t로 seek한다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const frameBlock = data.units[2].body.find(
			(block): block is UnitBodyFrameBlock => block.type === "frame",
		);
		expect(frameBlock).toBeDefined();
		const figure = doc.getElementById("u003")?.querySelector(".body-frame");
		expect(figure?.getAttribute("data-frame-t")).toBe(String(frameBlock?.t));
		const zoom = figure?.querySelector("a.zoom-link");
		expect(zoom?.textContent).toBe("확대");
		expect(zoom?.getAttribute("target")).toBe("_blank");
		expect(zoom?.getAttribute("rel")).toBe("noopener");
		expect(zoom?.getAttribute("href")).toBe(frameBlock?.src);
	});
});

// ── disabled 모드 (DESIGN §11) ─────────────────────────────────────────────

describe("disabled 모드(명단 없음)", () => {
	test("명단이 없으면 내 피드백·언급 선수 필터·언급/관련 줄·멘션 배지가 렌더되지 않는다", () => {
		const data = sampleData();
		data.members = [];
		for (const unit of data.units) {
			unit.member_ids = [];
			unit.related_member_ids = [];
		}
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelector(".my-feedback")).toBeNull();
		expect(doc.querySelector('.filter-group[data-role="filter-mention"]')).toBeNull();
		expect(doc.querySelector(".mentioned-members")).toBeNull();
		expect(doc.querySelector(".related-members")).toBeNull();
		expect(doc.querySelector(".mention-badge")).toBeNull();
	});

	test("명단이 없어도 addressed_to_all 카드는 \"대상: 전원\" 칩을 보이되 pill-mine과 멘션 배지는 없다(DESIGN §5-6/§10)", () => {
		const data = sampleData();
		data.members = [];
		for (const unit of data.units) {
			unit.member_ids = [];
			unit.related_member_ids = [];
		}
		data.units[0].addressed_to_all = true;
		const doc = parseHTML(renderSession(data)).document;

		const chip = doc.getElementById("u001")?.querySelector(".chip-addressed-all");
		expect(plain(chip?.textContent)).toBe("대상: 전원");
		expect(doc.querySelector(".pill-mine")).toBeNull();
		expect(doc.querySelector(".mention-badge")).toBeNull();
	});

	test("내 피드백 pill 자체가 없으므로 활성 필터 줄에도 '내 피드백:' 칩이 나타나지 않는다(DESIGN §6/§7)", () => {
		const data = sampleData();
		data.members = [];
		for (const unit of data.units) {
			unit.member_ids = [];
			unit.related_member_ids = [];
		}
		const { doc } = mountViewer(renderSession(data), false);
		expect(doc.querySelector(".pill-mine")).toBeNull();

		clickChip(doc, "position", "FB");
		const container = doc.querySelector(".active-filters");
		expect(isHidden(container)).toBe(false); // 포지션 칩은 정상 노출된다
		expect(container?.textContent).not.toContain("내 피드백:");
	});
});

// ── 키보드 접근성: seek 버튼 · 내 피드백 리스트 시맨틱 (DESIGN §13) ──────────────

describe("키보드 접근성", () => {
	test("카드 헤더 시각 칩은 버튼이며 클릭하면 카드 시작 시각으로 seek한다", () => {
		const { doc, stub } = mountViewer(renderSession(sampleData()), true);
		stub?.fireReady();
		const btn = doc.querySelector("#u001 .card-head .seek-btn");
		expect(btn?.tagName.toLowerCase()).toBe("button");
		expect(btn?.getAttribute("aria-label")).toBe("12:34부터 재생");

		click(btn);

		const seekCall = stub?.calls.find((call) => call.method === "seekTo");
		expect(seekCall?.args[0]).toBe(754);
	});

	test("본문 프레임의 시각 칩도 버튼이며 그 프레임의 시각을 data-seek-t로 갖는다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		const frameBlock = data.units[2].body.find(
			(block): block is UnitBodyFrameBlock => block.type === "frame",
		);
		const btn = doc.getElementById("u003")?.querySelector(".body-frame .seek-btn");
		expect(btn?.tagName.toLowerCase()).toBe("button");
		expect(btn?.getAttribute("data-seek-t")).toBe(String(frameBlock?.t));
	});

	test('"내 피드백" pill 자신은 role="listitem"을 갖지 않고, 감싸는 요소가 그 역할을 갖는다(DESIGN §6/§13)', () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const pill = doc.querySelector(".pill-mine");
		expect(pill?.hasAttribute("role")).toBe(false);
		expect(pill?.parentElement?.getAttribute("role")).toBe("listitem");
		expect(doc.querySelector(".my-feedback-row")?.getAttribute("role")).toBe("list");
	});
});

// ── 제목 줄바꿈 방지 (DESIGN §10) ────────────────────────────────────────────

describe("필터 포지션 트리 모바일 정렬", () => {
	test("640px 이하에서는 자식 줄이 부모 칩 줄 아래 같은 왼쪽 끝에 놓인다(들여쓰기 열 없음)", () => {
		const mobile = [...STYLE.matchAll(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g)].map((m) => m[0]).join("\n");
		expect(mobile).toMatch(/\.pos-node--branch\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
	});
});

describe("g13 시각 리뷰 보정", () => {
	const mobile = (): string => [...STYLE.matchAll(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g)].map((m) => m[0]).join("\n");

	test("포지션 트리 640px 이하: 가지 칩은 내용 폭(justify-self: start)이고 자식 줄은 한 단계 들여쓴다", () => {
		expect(mobile()).toMatch(/\.pos-node--branch\s*>\s*\.chip\s*\{[^}]*justify-self:\s*start/);
		expect(mobile()).toMatch(/\.pos-children\s*\{[^}]*padding-left:\s*var\(--space-4\)/);
	});

	test("참고자료 링크는 44px 히트 영역을 ::after로 가진다", () => {
		expect(STYLE).toMatch(/\.ref-link::after\s*\{[^}]*height:\s*44px/);
	});

	test("참고자료 링크는 min-width 없이 내용 폭이고, 링크 행은 gap을 가진 flex 행이며 구분자는 aria-hidden 별도 요소다", () => {
		expect(STYLE).not.toMatch(/\.ref-link\s*\{[^}]*min-width/);
		// 히트 영역은 링크 가운데 기준이라 짧은 "요약"의 44px 영역이 한쪽으로만 번지지 않는다.
		expect(STYLE).toMatch(/\.ref-link::after\s*\{[^}]*left:\s*50%[^}]*translate\(-50%,\s*-50%\)/);
		expect(STYLE).toMatch(/\.ref-links\s*\{[^}]*display:\s*flex[^}]*gap:/);
		const data = sampleData();
		data.units[0].refs = [{ id: "r-en", title: "EN", lang: "en", kind: "tactics", href: "../../refs/r-en.html", orig_url: "https://example.com/a", format: "article", relevance_ko: "관련", start_seconds: null, version_badge: null, pro_clubs: false }];
		const row = parseHTML(renderSession(data)).document.querySelector("#u001 .refs-list li .ref-links");
		expect(row?.children.length).toBe(3);
		expect(row?.children[1]?.classList.contains("ref-sep")).toBe(true);
		expect(row?.children[1]?.getAttribute("aria-hidden")).toBe("true");
		expect(row?.children[1]?.textContent).toBe("·");
		expect(row?.textContent).not.toContain(" · ");
	});

	test("제목의 'N월 N일'은 줄바꿈 없이 묶는다(세션 H1, 아카이브 카드 제목)", () => {
		const data = sampleData();
		data.title = "10월 2일 세션";
		expect(parseHTML(renderSession(data)).document.querySelector(".header h1")?.textContent).toContain(`10월${NBSP}2일`);
		const html = renderIndex({
			version: 1,
			updated_at: "2024-01-05T00:00:00Z",
			sessions: [{ id: "20240104-NUzEChn9EyI", title: "10월 2일 세션", date: "2024-01-04", videos: 1, unit_count: 1, topic_tags: [], href: "sessions/x/index.html" }],
			units: [],
			refs: [],
		});
		expect(parseHTML(html).document.querySelector(".session-card h2")?.textContent).toContain(`10월${NBSP}2일`);
	});

	test("640px 이하 카드 헤드: 브레드크럼은 자기 줄 전체 폭을 쓴다", () => {
		expect(mobile()).toMatch(/\.breadcrumb\s*\{[^}]*flex-basis:\s*100%/);
	});

	test("내 피드백 알약 줄은 오른쪽 끝에 페이드 힌트가 있다(라이트·다크 토큰)", () => {
		expect(STYLE).toMatch(/\.my-feedback-row\b[^{]*\{[^}]*mask-image:\s*linear-gradient\(to right,[^;]*transparent\)/);
	});

	test("링크 전용 안내(.watch-bar-note)는 타입 스케일의 Label 크기(0.8125rem)다", () => {
		expect(STYLE).toMatch(/\.watch-bar-note\s*\{[^}]*font-size:\s*0\.8125rem/);
	});
});

describe("세션 헤더 날짜 줄", () => {
	test("제목 아래 날짜 줄은 영상 업로드일임을 라벨로 밝힌다", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelector(".header .date")?.textContent).toBe(`영상 업로드 ${data.date}`);
	});
});

describe("제목의 한글단어(영문) 줄바꿈 방지", () => {
	test('"비활성(disabled)"처럼 괄호 앞에서 줄바꿈되지 않도록 nobr로 감싼다', () => {
		const data = sampleData();
		data.title = "QA 비활성(disabled) 모드 세션";
		data.units[0].title = "QA 비활성(disabled) 모드 세션";
		const doc = parseHTML(renderSession(data)).document;

		const h1 = doc.querySelector(".header h1");
		expect(h1?.innerHTML).toContain('<span class="nobr">비활성\u2060(disabled)</span>');

		const cardTitle = doc.getElementById("u001")?.querySelector("h3");
		expect(cardTitle?.innerHTML).toContain('<span class="nobr">비활성\u2060(disabled)</span>');

		const tocItem = doc.querySelector('#panel-match .toc-item[data-target="u001"]');
		expect(tocItem?.innerHTML).toContain('<span class="nobr">비활성\u2060(disabled)</span>');
	});

	test("카드 브레드크럼의 경기 제목도 묶인 문법 구성 glue 파이프라인을 탄다(REAL BUG 회귀, 라운드7)", () => {
		const data = sampleData();
		data.matches[0].title = "받아들이지 못한 경기";
		const doc = parseHTML(renderSession(data)).document;
		const breadcrumb = doc.getElementById("u001")?.querySelector(".breadcrumb");
		expect(breadcrumb?.textContent).toContain(`받아들이지${NBSP}못한`);
	});
});

// ── 한글 묶인 문법 구성 줄바꿈 방지 (DESIGN §10/§15-1) ───────────────────────

describe("glueKorean — 묶인 문법 구성 공백을 nbsp로 치환", () => {
	test.each([
		["부정(-지 못/않)", "리바운드 위치를 선점하지 못한 장면", "선점하지 못한"],
		["-기(도) 전", "패스가 나가기도 전에 먼저 움직였다", "나가기도 전에"],
		["-기 전", "윙어가 볼을 잡기 전부터 늦었다", "잡기 전부터"],
		["-기 시작", "패스 코스를 찾기 시작해 늦었다", "찾기 시작해"],
		["-다 보니", "세트피스 상황에만 집중하다 보니 늦었다", "집중하다 보니"],
		["-을 수 있(양쪽 공백)", "탈취 직후 전방으로 패스를 찾을 수 있다", "찾을 수 있다"],
		["-고 있", "압박을 피하고 있다", "피하고 있다"],
		["-아/어 주", "코스를 잡아 주는 습관", "잡아 주는"],
		["의존명사 것(-는 것)", "라인을 올리는 것을 원칙으로", "올리는 것을"],
		["숫자+단위", "클리어링 이후 3 초를 가장 위험하게 본다", "3 초를"],
		["-ㄹ 것(받침 ㄹ, 융합 음절로 감지)", "앞당겨질 것이다", "앞당겨질 것이다"],
		["-ㄹ 수 있(받침 ㄹ, 양쪽 공백)", "할 수 있다", "할 수 있다"],
		["-ㄴ 것(받침 ㄴ, 융합 음절로 감지)", "만든 것이", "만든 것이"],
		["의존명사 게(것이 축약)", "줄이는 게 핵심이다", "줄이는 게"],
		["의존명사 거(것 축약)", "할 거야", "할 거야"],
		["의존명사 걸(것을 축약)", "하는 걸 알았다", "하는 걸"],
		["의존명사 건(것은 축약)", "간 건 사실이다", "간 건"],
		["고유어 수사+단위(반 걸음)", "반 걸음씩 밀렸다", "반 걸음"],
		["고유어 수사+단위(두 걸음)", "두 걸음 앞서 있다", "두 걸음"],
		["고유어 수사+단위(세 번)", "세 번 시도했다", "세 번"],
		["고유어 수사+단위(한 박자, 라운드7 시각 QA)", "한 박자씩 늦게 반응했다", "한 박자"],
		["고유어 수사+단위(두 박자)", "두 박자 빠르게 움직였다", "두 박자"],
		["고유어 수사+단위(한 발짝)", "한 발짝 먼저 움직였다", "한 발짝"],
		["고유어 수사+단위(세 번째)", "세 번째 시도에서 성공했다", "세 번째"],
		["고유어 수사+단위(두 터치)", "두 터치 만에 처리했다", "두 터치"],
		["고유어 수사+단위(한 줄, 390px 시각 QA)", "수비 라인이 한 줄로 서 있다", "한 줄로"],
		["관형사형 ㄹ+때(가졌을 때)", "공을 가졌을 때의 선택", "가졌을 때의"],
		["관형사형 ㄹ+때(받을 때)", "공을 받을 때 몸의 방향", "받을 때"],
		["관형사형 는+때(있는 때)", "공이 있는 때를 놓쳤다", "있는 때를"],
		["짧은 부정 안+동사", "탈출이 안 된다며", "안 된다며"],
		["짧은 부정 못+동사", "패스를 못 했다", "못 했다"],
		["볼드 경계의 안 되", "탈출이 **안** 된다며", "**안** 된다며"],
	])("%s: %s", (_label, input, expected) => {
		expect(glueKorean(input)).toContain(expected);
	});

	test('독립된 두 단어 사이의 통상적인 어절 공백("수비 전환")은 그대로 둔다', () => {
		expect(glueKorean("수비 전환은 다음 훈련 과제다")).toContain("수비 전환");
		expect(glueKorean("수비 전환은 다음 훈련 과제다")).not.toContain("수비 전환");
	});

	test("볼드 마커(**) 경계에 걸친 구성도 boldSpans 분리 전에 적용돼 함께 붙는다", () => {
		expect(glueKorean("**잡는** 것을 원칙으로")).toBe("**잡는** 것을 원칙으로");
	});

	test("단어 일부인 안/못은 붙이지 않는다 (안쪽, 못지않게, 탈출 안내, 이 못 ...)", () => {
		for (const t of ["안쪽 공간을 비웠다", "못지않게 빠르다", "그라운드 안내 방송", "수비가 안정된 상태", "깊게 못생긴 모양"]) {
			expect(glueKorean(t)).toBe(t);
		}
		expect(glueKorean("공간 안쪽 수비")).toBe("공간 안쪽 수비");
	});

	test('여는 마커가 공백 바로 뒤에 와도 붙는다("하는 **것**", 라운드6 검토)', () => {
		expect(glueKorean("하는 **것**을 원칙으로")).toBe(`하는${NBSP}**것**을 원칙으로`);
	});

	test('여는 마커가 "수 있" 구성의 앞쪽 공백 뒤에 와도 양쪽 다 붙는다("할 **수 있다**")', () => {
		expect(glueKorean("할 **수 있다**")).toBe(`할${NBSP}**수${NBSP}있다**`);
	});

	test('닫는 마커가 공백 바로 앞에 오는 기존 지원도 계속 동작한다("**받아들이지** 못하고")', () => {
		expect(glueKorean("**받아들이지** 못하고 있는 것을 놓쳤다")).toContain(`**받아들이지**${NBSP}못`);
	});

	test("캡은 **를 제외한 표시 글자 수 기준이다 — 마커까지 합친 raw 길이가 14자를 넘어도 표시 길이가 14자 이하면 끊지 않는다(라운드6 검토)", () => {
		const glued = glueKorean("**앞당겨질 것**을 몇 번이고 강조했다");
		expect(glued).toContain(`**앞당겨질${NBSP}것**을`);
	});

	test("nbsp는 escapeHtml을 그대로 통과한다(렌더된 본문 문단에서 확인)", () => {
		const data = sampleData();
		data.units[0].body = [{ type: "text", text: "리바운드 위치를 선점하지 못한 장면이 나왔다." }];
		const doc = parseHTML(renderSession(data)).document;
		const p = doc.getElementById("u001")?.querySelector(".card-body p");
		expect(p?.textContent).toContain("선점하지 못한");
	});

	test("연쇄된 묶인 문법 구성(\"-기 시작 -다 보니\")은 이어지는 공백을 모두 nbsp로 붙인다(DESIGN §15-1)", () => {
		expect(glueKorean("패스 코스를 찾기 시작하다 보니 이미 늦어 있었다")).toContain("찾기 시작하다 보니");
	});

	test("nbsp로 이어붙인 한 구간이 390px 컬럼 상한(14자)을 넘으면 그 안에서 다시 끊어진다(DESIGN §15-1 체이닝 상한)", () => {
		const glued = glueKorean("받아들이지 못하고 있는 것을 놓쳤다");
		const runs = glued.split(" ");
		for (const run of runs) {
			expect(run.length).toBeLessThanOrEqual(14);
		}
		// 원래라면 "받아들이지-못하고-있는-것을"이 하나로 이어붙어 15자가 되므로, 마지막 이음매가
		// 도로 끊어져 "것을"이 별도 구간으로 남아야 한다(구간 경계 자체가 복원됨을 확인).
		expect(runs).toContain("것을");
	});
});

// ── 타이포 토큰 — body 기본값·off-scale 방지 (DESIGN §2, §15-2) ───────────────

describe("타이포 토큰 이탈 방지 (DESIGN §2, §15-2)", () => {
	test("body는 Body 토큰(1.0625rem/1.7)을 기본값으로 갖는다", () => {
		const bodyRule = STYLE.match(/^body\s*\{[^}]*\}/m)?.[0] ?? "";
		expect(bodyRule).toContain("font-size: 1.0625rem");
		expect(bodyRule).toContain("line-height: 1.7");
	});

	test.each([
		[".watch-link", "0.8125rem"],
		[".filter-reset", "0.8125rem"],
		[".empty-state", "1.0625rem"],
		[".plain-link", "0.875rem"],
	])("%s는 §2 타입 스케일 값을 명시한다", (selector, size) => {
		const escaped = selector.replace(".", "\\.");
		const rule = STYLE.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? "";
		expect(rule).toContain(`font-size: ${size}`);
	});

	test("아카이브 주제별 링크와 참고자료 페이지의 평문 링크는 각각 .toc-item/.plain-link를 재사용한다", () => {
		const index: ArchiveIndex = {
			version: 1,
			updated_at: "now",
			sessions: [
				{
					id: "20240104-NUzEChn9EyI",
					title: "1월 4일 세션",
					date: "2024-01-04",
					videos: 2,
					unit_count: 1,
					topic_tags: ["빌드업"],
					href: "20240104-NUzEChn9EyI/index.html",
				},
			],
			units: [
				{
					uid: "20240104-NUzEChn9EyI#u001",
					session: "20240104-NUzEChn9EyI",
					title: "빌드업 지적",
					date: "2024-01-04",
					position_tags: ["FB"],
					topic_tags: ["빌드업"],
					member_ids: [],
					href: "../20240104-NUzEChn9EyI/index.html#u001",
				},
			],
			refs: [],
		};
		const doc = parseHTML(renderIndex(index)).document;
		expect(doc.querySelector("#by-topic li a")?.classList.contains("toc-item")).toBe(true);
		expect(doc.querySelector('p a[href="#by-topic"]')?.closest("p")?.classList.contains("plain-link")).toBe(
			true,
		);

		const refDoc = parseHTML(
			renderRef({
				id: "r-1",
				title: "제목",
				lang: "en",
				kind: "eafc",
				format: "article",
				url: "https://example.com",
				start_seconds: null,
				summary_ko: "요약",
				key_points_ko: [],
				translations: [],
			}),
		).document;
		expect(refDoc.querySelector('a[href="https://example.com"]')?.closest("p")?.classList.contains("plain-link")).toBe(
			true,
		);
		expect(refDoc.querySelector('a[href="../index.html"]')?.closest("p")?.classList.contains("plain-link")).toBe(
			true,
		);
	});
});

// ── 대표 이미지 확대 링크 (DESIGN §5 item 4) ─────────────────────────────────

describe("대표 시작 이미지 — 확대 링크", () => {
	test("본문 프레임과 동일하게 새 탭·noopener 확대 링크를 가지며, 이미지 클릭은 카드 시작 시각으로 seek한다", () => {
		const data = sampleData();
		const { doc, stub } = mountViewer(renderSession(data), true);
		stub?.fireReady();
		const figure = doc.getElementById("u001")?.querySelector(".card-image");
		const zoom = figure?.querySelector("a.zoom-link");
		expect(zoom?.getAttribute("target")).toBe("_blank");
		expect(zoom?.getAttribute("rel")).toBe("noopener");
		expect(zoom?.getAttribute("href")).toBe(data.units[0].images.start.src);

		click(figure?.querySelector("img"));
		const seekCall = stub?.calls.find((call) => call.method === "seekTo");
		expect(seekCall?.args[0]).toBe(data.units[0].start);
	});
});

// ── 포지션 트리 시각 위계 (DESIGN §15-5/§15-10) ──────────────────────────────

describe("포지션 필터 트리 — 루트/자식 시각 구분", () => {
	test("루트 노드(DF/GK/FW)만 chip-pos-root를 갖고, 자식 노드(FB)는 갖지 않는다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const df = doc.querySelector('.chip-filter[data-group="position"][data-value="DF"]');
		const gk = doc.querySelector('.chip-filter[data-group="position"][data-value="GK"]');
		const fb = doc.querySelector('.chip-filter[data-group="position"][data-value="FB"]');
		expect(df?.classList.contains("chip-pos-root")).toBe(true);
		expect(gk?.classList.contains("chip-pos-root")).toBe(true);
		expect(fb?.classList.contains("chip-pos-root")).toBe(false);
	});

	test("STYLE은 chip-pos-root에 굵은 글자와 표면 채움을 준다", () => {
		const rule = STYLE.match(/\.chip-pos-root\s*\{[^}]*\}/)?.[0] ?? "";
		expect(rule).toContain("font-weight: 700");
		expect(rule).toContain("background: var(--surface-sunken)");
	});
});

// ── 본문-메타 구획 간격 (DESIGN §5 items 9/10) ───────────────────────────────

describe("본문과 유사/참고자료 사이 구획 간격", () => {
	test("유사·참고자료가 있으면 card-meta로 묶여 상단 구분선을 갖는다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const meta = doc.getElementById("u002")?.querySelector(".card-meta");
		expect(meta).not.toBeNull();
		expect(meta?.querySelector(".similar-list")).not.toBeNull();
		expect(meta?.querySelector(".refs-list")).not.toBeNull();
	});

	test("유사·참고자료가 모두 없으면 card-meta 자체를 렌더하지 않는다", () => {
		const data = sampleData();
		data.units[0].similar = [];
		data.units[0].refs = [];
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.getElementById("u001")?.querySelector(".card-meta")).toBeNull();
	});

	test("STYLE은 card-meta에 space-6 상단 여백과 line 구분선을 준다", () => {
		const rule = STYLE.match(/\.card-meta\s*\{[^}]*\}/)?.[0] ?? "";
		expect(rule).toContain("margin-top: var(--space-6)");
		expect(rule).toContain("border-top: 1px solid var(--line)");
	});
});

// ── 시작 이미지 중복 제거 (DESIGN §5 item 4) ───────────────────────────────

describe("시작 이미지와 같은 시각의 본문 프레임", () => {
	test("본문 프레임 t가 unit.start와 같으면 시작 이미지 figure를 렌더하지 않고 태그 행은 같은 자리에 단독으로 렌더한다", () => {
		const data = sampleData();
		data.units[0].body = [
			{ type: "text", text: "문단" },
			{ type: "frame", src: "img/u001-c001.webp", width: 1280, height: 720, t: data.units[0].start, caption: "시작 장면" },
		];
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		expect(card?.querySelector(".card-image")).toBeNull();
		expect(card?.querySelectorAll("img").length).toBe(1);
		const chipRow = card?.querySelector(".chip-row");
		expect(chipRow?.parentElement?.classList.contains("card")).toBe(true);
		expect(chipRow?.previousElementSibling?.classList.contains("mention-badge")).toBe(true); // 시작 이미지 figure가 있던 자리
	});

	test("본문 프레임이 하나라도 있으면 시각이 달라도 캡션 없는 시작 이미지를 렌더하지 않는다", () => {
		const data = sampleData();
		data.units[0].body = [{ type: "frame", src: "img/u001-c001.webp", width: 1280, height: 720, t: data.units[0].start + 5, caption: "다른 장면" }];
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		expect(card?.querySelector(".card-image")).toBeNull();
		expect(card?.querySelector(".chip-row")?.parentElement?.classList.contains("card")).toBe(true);
	});

	test("본문 프레임이 없으면 시작 이미지 figure가 그대로 남고 그 안에 태그 행이 있다", () => {
		const data = sampleData();
		data.units[0].body = [{ type: "text", text: "문단만 있음" }];
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		expect(card?.querySelector(".card-image .chip-row")).not.toBeNull();
	});
});

// ── 임베드 불가 세션 (DESIGN §4/§9) ─────────────────────────────────────────

describe("임베드 불가 세션", () => {
	function linkOnlyData(): SessionDataInput {
		const data = sampleData();
		data.videos = data.videos.map((video) => ({ ...video, embeddable: false }));
		data.units[2].body = [
			{ type: "text", text: "문단" },
			{ type: "frame", src: "img/u003-c001.webp", width: 1280, height: 720, t: 105, caption: "역습 시작" },
		];
		return data;
	}

	test("모든 영상이 임베드 불가면 sticky 플레이어 대신 파트별 '유튜브에서 시청 ↗' 막대를 렌더하고 파트 전환 버튼은 없다", () => {
		const doc = parseHTML(renderSession(linkOnlyData())).document;
		expect(doc.querySelector(".player-wrapper")).toBeNull();
		expect(doc.querySelector(".part-switch")).toBeNull();
		const links = [...doc.querySelectorAll(".watch-bar a")];
		expect(links.map((a) => a.textContent)).toEqual(["Part 1 유튜브에서 시청 ↗", "Part 2 유튜브에서 시청 ↗"]);
		expect(links.map((a) => a.getAttribute("href"))).toEqual([
			"https://youtu.be/AAAAAAAAAAA?t=0",
			"https://youtu.be/BBBBBBBBBBB?t=0",
		]);
		expect(links.every((a) => a.getAttribute("rel") === "noopener" && a.getAttribute("target") === "_blank")).toBe(true);
	});

	test("유튜브에서 시청 링크 옆에 시간을 누르면 열린다는 안내를 한 번만 보인다", () => {
		const doc = parseHTML(renderSession(linkOnlyData())).document;
		const notes = doc.querySelectorAll(".watch-bar .watch-bar-note");
		expect(notes.length).toBe(1);
		expect(notes[0].textContent).toBe("시간을 누르면 유튜브에서 그 장면부터 열립니다");
		expect(parseHTML(renderSession(sampleData())).document.querySelector(".watch-bar-note")).toBeNull();
		expect(renderSession(sampleData())).not.toContain("시간을 누르면 유튜브에서");
	});

	test("카드 헤드와 본문 프레임의 시간 칩은 해당 시각의 유튜브 링크다", () => {
		const doc = parseHTML(renderSession(linkOnlyData())).document;
		const head = doc.querySelector("#u001 .card-head a.seek-btn");
		expect(head?.getAttribute("href")).toBe("https://youtu.be/AAAAAAAAAAA?t=754");
		expect(head?.getAttribute("target")).toBe("_blank");
		expect(head?.getAttribute("rel")).toBe("noopener");
		const frame = doc.querySelector("#u003 .body-frame a.seek-btn");
		expect(frame?.getAttribute("href")).toBe("https://youtu.be/AAAAAAAAAAA?t=105");
		expect(doc.querySelector(".card button.seek-btn")).toBeNull();
	});

	test("카드 영역을 클릭해도 seek를 시도하지 않는다", () => {
		const { doc, win } = mountViewer(renderSession(linkOnlyData()), true);
		expect(doc.body.dataset.video).toBe("AAAAAAAAAAA");
		click(doc.querySelector("#u002 h3")); // Part 2 카드
		expect(doc.body.dataset.video).toBe("AAAAAAAAAAA");
		expect(win.fcPlayer).toBeUndefined();
	});

	test("하나라도 임베드 가능하면 기존 플레이어를 유지한다", () => {
		const data = sampleData();
		data.videos[1].embeddable = false;
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelector(".player-wrapper")).not.toBeNull();
		expect(doc.querySelector(".watch-bar")).toBeNull();
		expect(doc.querySelector("#u001 .card-head button.seek-btn")).not.toBeNull();
	});

	test("접힌 플레이어에서는 임베드 불가 플레이스홀더를 숨기고 미디어 영역을 잘라 펼치기 버튼을 가리지 않는다", () => {
		expect(STYLE).toMatch(/\.player-wrapper\.is-collapsed\s+\.player-placeholder\s*\{\s*display:\s*none/);
		expect(STYLE).toMatch(/\.player-wrapper\.is-collapsed\s+\.player-media\s*\{[^}]*overflow:\s*hidden/);
	});
});

// ── 내 피드백 · 참고자료 · 대상 줄 ──────────────────────────────────────────

describe("참고자료 라벨", () => {
	test("참고자료 목록 앞에 '참고자료' 라벨이 붙고 kind는 한국어로 보인다", () => {
		const data = sampleData();
		data.units[1].refs.push({ ...data.units[1].refs[0], id: "r-eafc", kind: "eafc" });
		const card = parseHTML(renderSession(data)).document.getElementById("u002");
		const label = card?.querySelector(".card-meta .refs-label");
		expect(label?.textContent).toBe("참고자료");
		expect(label?.nextElementSibling?.classList.contains("refs-list")).toBe(true);
		const badges = [...(card?.querySelectorAll(".refs-list .badge") ?? [])].map((el) => el.textContent);
		expect(badges).toContain("축구 전술");
		expect(badges).toContain("EA FC");
		expect(badges).not.toContain("프로클럽");
		expect(badges).not.toContain("tactics");
		expect(badges).not.toContain("eafc");
	});

	test("참고자료가 없으면 라벨도 없다", () => {
		const card = parseHTML(renderSession(sampleData())).document.getElementById("u001");
		expect(card?.querySelector(".refs-label")).toBeNull();
	});
});

describe("대상 줄 — 이름·전원 지정이 없는 유닛", () => {
	test("member_ids가 비고 전원 대상이 아니면 '대상: <포지션들>'을 전원 줄과 같은 칩 스타일로 렌더한다", () => {
		const data = sampleData();
		data.units[0].member_ids = [];
		data.units[0].position_target_ids = [];
		data.units[0].position_tags = ["CB", "FB"];
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		const line = card?.querySelector(".target-position-line");
		expect(line?.textContent).toBe("대상: CB, FB");
		expect(line?.querySelector(".chip-addressed-all, .chip-target-position")).not.toBeNull();
		expect(card?.querySelector(".addressed-all-line")).toBeNull();
	});

	test("포지션 태그가 없거나 전원 대상이면 포지션 대상 줄이 없다", () => {
		const data = sampleData();
		data.units[0].member_ids = [];
		data.units[0].position_tags = [];
		data.units[1].member_ids = [];
		data.units[1].addressed_to_all = true;
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.getElementById("u001")?.querySelector(".target-position-line")).toBeNull();
		expect(doc.getElementById("u002")?.querySelector(".target-position-line")).toBeNull();
	});
});

// ── 초광각 프레임 (DESIGN §5 item 4a) ───────────────────────────────────────

describe("초광각 프레임 가로 이동 상자", () => {
	function ultrawideData(): SessionDataInput {
		const data = sampleData();
		data.units[1].images.start = { src: "img/u002-start.webp", width: 1280, height: 360 };
		data.units[2].body = [{ type: "frame", src: "img/u003-c001.webp", width: 1280, height: 360, t: 105, caption: "초광각" }];
		return data;
	}

	test("가로/세로 비가 2를 넘는 시작 이미지와 본문 프레임은 힌트가 붙은 이동 상자 안에 렌더하고 16:9는 감싸지 않는다", () => {
		const doc = parseHTML(renderSession(ultrawideData())).document;
		expect(doc.querySelectorAll("#u003 .frame-pan").length).toBe(1);
		expect(doc.querySelectorAll("#u002 .frame-pan").length).toBe(1);
		expect(doc.querySelector("#u002 .card-image .frame-pan-scroll img")).not.toBeNull();
		expect(doc.querySelector("#u003 .body-frame .frame-pan-scroll img")).not.toBeNull();
		expect(doc.querySelector("#u002 .frame-pan-hint")?.textContent).toBe("좌우로 밀어 보기");
		expect(doc.querySelector("#u001 .frame-pan")).toBeNull();
	});

	test("폭 2:1 정확히는 감싸지 않는다(경계값)", () => {
		const data = sampleData();
		data.units[0].images.start = { src: "img/u001-start.webp", width: 1000, height: 500 };
		expect(parseHTML(renderSession(data)).document.querySelector("#u001 .frame-pan")).toBeNull();
	});

	test("STYLE은 모든 폭에서 상자 안 가로 스크롤을 주고 높이는 모바일 고정 280px·데스크톱 300px이며 페이지는 가로 스크롤시키지 않는다", () => {
		expect(STYLE).toMatch(/\n\.frame-pan-scroll\s*\{[^}]*overflow-x:\s*auto/);
		expect(STYLE).toMatch(/\n\.card-image \.frame-pan-scroll img[^{]*\{[^}]*width:\s*auto[^}]*height:\s*100%/);
		const mobile = [...STYLE.matchAll(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g)].map((m) => m[0]).join("\n");
		expect(mobile).toMatch(/\.frame-pan-scroll\s*\{[^}]*height:\s*280px/);
		expect(STYLE).not.toContain("56vw");
		const desktop = STYLE.match(/@media \(min-width: 641px\) \{[\s\S]*?\n\}/)?.[0] ?? "";
		expect(desktop).toMatch(/\.frame-pan-scroll\s*\{[^}]*height:\s*300px/);
		expect(STYLE).toMatch(/\n\.frame-pan \.frame-pan-hint\s*\{[^}]*display:\s*block/);
		expect(STYLE).not.toMatch(/body\s*\{[^}]*overflow-x:\s*auto/);
	});

	test("VIEWER_JS는 시작 시 이동 상자를 가로 중앙으로 스크롤한다", () => {
		const dom = parseHTML(renderSession(ultrawideData()));
		for (const box of dom.document.querySelectorAll(".frame-pan-scroll")) {
			Object.defineProperty(box, "scrollWidth", { value: 1280, configurable: true });
			Object.defineProperty(box, "clientWidth", { value: 358, configurable: true });
		}
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		runViewer(win, { Player: StubPlayer, loaded: false });
		const box = dom.document.querySelector(".frame-pan-scroll") as unknown as { scrollLeft: number };
		expect(box.scrollLeft).toBe((1280 - 358) / 2);
	});

	test("이동 상자 안 프레임을 클릭하면 그 프레임 시각으로 seek한다", () => {
		const { doc, stub } = mountViewer(renderSession(ultrawideData()), true);
		stub?.fireReady();
		click(doc.querySelector("#u003 .body-frame .frame-pan-scroll img"));
		expect(stub?.calls.some((call) => call.method === "seekTo" && call.args[0] === 105)).toBe(true);
	});
});

// ── 반복 지적 (DESIGN §6a) ──────────────────────────────────────────────────

describe("반복 지적", () => {
	function recurringData(): SessionDataInput {
		const data = sampleData();
		data.recurring = [
			{ label: "한 번 더", unit_ids: ["u001", "u002"], member_ids: [] },
			{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u002", "u003"], member_ids: [] },
		];
		return data;
	}

	test("카드 목록 앞에 많이 반복된 순서로 label·×N·시간 칩 앵커를 렌더한다", () => {
		const doc = parseHTML(renderSession(recurringData())).document;
		const block = doc.querySelector(".main .recurring");
		expect(block?.nextElementSibling?.classList.contains("card-list")).toBe(true);
		const rows = [...(block?.querySelectorAll(".recurring-item") ?? [])];
		expect(rows.map((row) => row.querySelector(".recurring-label")?.textContent?.replaceAll(NBSP, " "))).toEqual(["수비 라인이 맞지 않음", "한 번 더"]);
		expect(rows.map((row) => row.querySelector(".recurring-count")?.textContent)).toEqual(["×3", "×2"]);
		const chips = [...rows[0].querySelectorAll("a.recurring-unit")];
		expect(chips.map((a) => a.getAttribute("href"))).toEqual(["#u001", "#u002", "#u003"]);
		// 라벨 주인이 없고 제목이 팀원만 부르면 칩이 유닛의 고칠 사람 이름을 보인다(u002는 고칠 사람이 없어 시간만).
		expect(chips.map((a) => a.textContent)).toEqual(["12:34 홍길동", "1:02:05", "1:40 최민수"]);
	});

	test("recurring이 비었거나 옛 data.json처럼 필드가 없으면 블록을 렌더하지 않는다", () => {
		const data = sampleData();
		expect(parseHTML(renderSession(data)).document.querySelector(".recurring")).toBeNull();
		const legacy = sampleData() as Partial<SessionData>;
		delete legacy.recurring;
		expect(parseHTML(renderSession(legacy as SessionData)).document.querySelector(".recurring")).toBeNull();
		expect(recurringFromLegacyData(legacy)).toEqual([]);
	});

	test("member_ids가 없는 옛 recurring 항목은 member_ids [](카드 소속으로 세는 옛 동작)로 읽는다", () => {
		expect(recurringFromLegacyData({ recurring: [{ label: "라벨", unit_ids: ["u001"] }] })).toEqual([
			{ label: "라벨", unit_ids: ["u001"], member_ids: [], refs_unfound: false },
		]);
		expect(recurringFromLegacyData({ recurring: [{ label: "라벨", unit_ids: ["u001"], member_ids: ["hong"] }] })[0].member_ids).toEqual(["hong"]);
	});

	test("시간 칩 클릭은 TOC처럼 카드로 스크롤·강조하고 seek하지 않는다", () => {
		const { doc, stub } = mountViewer(renderSession(recurringData()), true);
		stub?.fireReady();
		const before = stub?.calls.length ?? 0;
		click(doc.querySelector(".recurring-unit[data-target='u003']"));
		expect(doc.getElementById("u003")?.classList.contains("card--highlighted")).toBe(true);
		expect(stub?.calls.length ?? 0).toBe(before);
	});

	test("필터가 가린 카드의 칩은 숨고, 보이는 칩이 없는 행과 블록도 숨는다", () => {
		const { doc } = mountViewer(renderSession(recurringData()), false);
		clickChip(doc, "position", "GK"); // u002만 남는다
		const hiddenTargets = [...doc.querySelectorAll(".recurring-unit")]
			.filter((chip) => chip.hasAttribute("hidden"))
			.map((chip) => chip.getAttribute("data-target"));
		expect(hiddenTargets.sort()).toEqual(["u001", "u001", "u003"]);
		expect(isHidden(doc.querySelector(".recurring"))).toBe(false);
		clickChip(doc, "position", "GK"); // 해제
		expect(doc.querySelectorAll(".recurring-unit[hidden]").length).toBe(0);
	});

	test("주제별 목차는 유닛이 많은 주제부터, 같으면 처음 나온 순서로 정렬한다", () => {
		const data = sampleData();
		data.units[2].topic_tags = ["전환", "피지컬"]; // 빌드업 1, 피지컬 2, 전환 1 (처음 나온 순서: 빌드업, 피지컬, 전환)
		const doc = parseHTML(renderSession(data)).document;
		const headings = [...doc.querySelectorAll("#panel-topic .toc-tag-group h2")].map((el) => el.textContent);
		expect(headings).toEqual(["피지컬 (2)", "빌드업 (1)", "전환 (1)"]);
	});
});

// ── named_member_ids · 고칠 점 / 이름이 나온 장면 (DESIGN §5 item 6/8, §6, §6a, §7) ─────────────

describe("named_member_ids — 고칠 사람 / 언급 / 같은 포지션", () => {
	function names(doc: Document, id: string, selector: string): string {
		return plain(doc.getElementById(id)?.querySelector(selector)?.textContent);
	}

	test("옛 data.json처럼 named_member_ids가 없으면 member_ids를 이름이 불린 목록으로 읽는다", () => {
		expect(namedMemberIdsFromLegacyData({ member_ids: ["hong"] })).toEqual(["hong"]);
		expect(namedMemberIdsFromLegacyData({ member_ids: ["hong"], named_member_ids: ["park"] })).toEqual(["park"]);
		const data = sampleData() as unknown as { units: Array<Partial<SessionUnit>> };
		delete data.units[0].named_member_ids;
		const doc = parseHTML(renderSession(data as unknown as SessionData)).document;
		expect(doc.getElementById("u001")?.getAttribute("data-named-ids")).toBe("hong");
	});

	test("카드는 고칠 사람 → 언급(named − member) → 같은 포지션(related − member − named) 순으로 세 줄을 보인다", () => {
		const data = sampleData();
		data.units[0].named_member_ids = ["hong", "park"]; // u001: member [hong], FB → related [hong, kim]
		const doc = parseHTML(renderSession(data)).document;
		expect(names(doc, "u001", ".mentioned-members:not(.named-members)")).toBe("고칠 사람: 홍길동");
		expect(names(doc, "u001", ".named-members")).toBe("언급: 박영희");
		expect(names(doc, "u001", ".related-members")).toBe("같은 포지션: 김철수");
		expect(doc.getElementById("u001")?.getAttribute("data-mention-ids")).toBe("hong|park");
		// named가 related와 겹치면 같은 포지션 줄에서 빠진다
		data.units[0].named_member_ids = ["kim"];
		const doc2 = parseHTML(renderSession(data)).document;
		expect(doc2.getElementById("u001")?.querySelector(".related-members")).toBeNull();
		expect(names(doc2, "u001", ".named-members")).toBe("언급: 김철수");
	});

	test("pill 주 숫자는 고칠 점(member_ids) 유닛 수뿐이고, 이름만 나온 장면은 '· 참고 N'에 든다", () => {
		const data = sampleData();
		data.units[0].named_member_ids = ["park"]; // park: u001 이름만 나옴, u002는 다른 사람(choi)의 GK 포지션 관련 지적
		data.units[1].member_ids = ["choi"];
		const doc = parseHTML(renderSession(data)).document;
		const park = doc.querySelector('.pill-mine[data-value="park"]');
		expect(park?.querySelector(".count")?.textContent).toBe("0");
		expect(park?.querySelector(".count-ref")?.textContent).toBe("· 참고 2");
	});

	test("선택 시 DOM이 고칠 점 → 이름이 나온 장면 → 전원 대상 → 같은 포지션 참고 순으로 묶이고 배지 문구가 같다", () => {
		const data = sampleData();
		data.units[0].named_member_ids = ["park"]; // park: 이름이 나온 장면
		data.units[2].addressed_to_all = true; // 전원 대상
		data.units[1].member_ids = ["choi"]; // u002: 다른 사람의 지적 -> park은 포지션 관련 참고
		const u004 = baseUnit({ id: "u004", uid: "20240104-NUzEChn9EyI#u004", start: 200, end: 210, position_tags: ["CB"], member_ids: ["park"], related_member_ids: ["park", "hong"] });
		data.units.push(u004); // 고칠 점
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "park");
		const order = [...(doc.querySelector(".card-list")?.children ?? [])]
			.filter((el) => !el.hasAttribute("hidden"))
			.map((el) => (el.classList.contains("mine-group-heading") ? `H:${el.textContent}` : `C:${el.id}`));
		expect(order).toEqual(["H:고칠 점 1", "C:u004", "H:이름이 나온 장면 1", "C:u001", "H:전원 대상 1", "C:u003", "H:같은 포지션 참고 1", "C:u002"]);
		const badge = (id: string) => doc.getElementById(id)?.querySelector(".mention-badge")?.textContent;
		expect([badge("u004"), badge("u003"), badge("u001"), badge("u002")]).toEqual(["고칠 점", "전원 대상", "이름이 나온 장면", "같은 포지션 참고"]);
	});

	test("언급 선수 패싯은 member_ids ∪ named 기준으로 세고 걸러낸다", () => {
		const data = sampleData();
		data.units[0].named_member_ids = ["park"];
		const { doc } = mountViewer(renderSession(data), false);
		const chipEl = doc.querySelector('.chip-filter[data-group="mention"][data-value="park"]');
		expect(chipEl?.querySelector(".chip-count")?.textContent).toBe("(1)");
		clickChip(doc, "mention", "park");
		expect(doc.getElementById("u001")?.hasAttribute("hidden")).toBe(false);
		expect(doc.getElementById("u002")?.hasAttribute("hidden")).toBe(true);
	});

	test("필터가 가린 카드의 목차 항목(경기별·주제별 두 패널 모두)도 함께 숨는다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickChip(doc, "position", "GK"); // u002만 남는다
		const tocState = (id: string) => [...doc.querySelectorAll(`.toc-item[data-target="${id}"]`)].map((el) => el.hasAttribute("hidden"));
		expect(tocState("u001").length).toBeGreaterThan(1);
		expect(tocState("u001").every(Boolean)).toBe(true);
		expect(tocState("u002").some(Boolean)).toBe(false);
	});

	test("반복 지적은 선택한 팀원이 고칠 유닛이 있으면 '×N · 내가 고칠 것 k'를, 없으면 '×N'만 보인다", () => {
		const data = sampleData();
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u002", "u003"], member_ids: ["hong"] }];
		const { doc } = mountViewer(renderSession(data), false);
		const count = () => doc.querySelector(".recurring-count")?.textContent;
		expect(count()).toBe("×3");
		clickMinePill(doc, "hong"); // hong이 member_ids에 든 유닛: u001뿐
		expect(count()).toBe("×3 · 보이는 카드 1 (그중 내가 고칠 것 1)");
		clickMinePill(doc, "hong");
		expect(count()).toBe("×3");
	});

	test("position_target_ids가 있으면 member_ids가 있는 카드도 그 팀원에게 '내 포지션 대상'으로 묶이고 pill 팀 숫자에 든다", () => {
		const data = sampleData();
		// u001: hong이 고칠 사람이고, "수비 라인" 단위 대상으로 kim도 함께 부른다.
		data.units[0].position_target_ids = ["kim"];
		const { doc } = mountViewer(renderSession(data), false);
		const kim = doc.querySelector('.pill-mine[data-value="kim"]');
		expect(kim?.querySelector(".count")?.textContent).toBe("0");
		expect(kim?.querySelector(".count-team")?.textContent).toBe("· 팀 1");
		clickMinePill(doc, "kim");
		expect(doc.getElementById("u001")?.querySelector(".mention-badge")?.textContent).toBe("내 포지션 대상");
	});

	test("필터가 내 카드를 가리면 '그중 내가 고칠 것'은 보이는 칩 안에서만 센다", () => {
		const data = sampleData();
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u002", "u003"], member_ids: ["hong"] }];
		data.units[1].named_member_ids = ["hong"]; // u002(GK): hong 이름만 나온 장면 — 내 피드백에는 보이지만 고칠 카드는 아니다
		const { doc } = mountViewer(renderSession(data), false);
		const count = () => doc.querySelector(".recurring-count")?.textContent;
		clickMinePill(doc, "hong"); // 보이는 카드 u001(고칠 점)·u002(이름이 나온 장면)
		expect(count()).toBe("×3 · 보이는 카드 2 (그중 내가 고칠 것 1)");
		clickChip(doc, "position", "GK"); // u002만 남아 u001이 가려진다
		expect(isHidden(doc.getElementById("u001"))).toBe(true);
		expect(count()).toBe("×3 · 보이는 카드 1");
	});

	test("팀원이 항목 유닛의 member_ids에 한 번도 없으면 참고·언급 카드가 보여도 '내가 고칠 것' 접미사가 없다", () => {
		const data = sampleData();
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u002", "u003"], member_ids: [] }];
		data.units[0].named_member_ids = ["kim"]; // kim: 이름만 나온 장면 + (FB 포지션) 참고 카드
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "kim");
		expect(doc.querySelectorAll(".recurring-unit:not([hidden])").length).toBeGreaterThan(0);
		expect(doc.querySelector(".recurring-count")?.textContent).not.toContain("내가 고칠 것");
	});

	test("반복 지적은 1024px 미만에서 상위 3개만 보이고 '더 보기 (N)' 버튼으로 펼친다", () => {
		const data = sampleData();
		data.recurring = [
			{ label: "하나", unit_ids: ["u001", "u002", "u003"], member_ids: [] },
			{ label: "둘", unit_ids: ["u001", "u002", "u003"], member_ids: [] },
			{ label: "셋", unit_ids: ["u001", "u002", "u003"], member_ids: [] },
			{ label: "넷", unit_ids: ["u001", "u002"], member_ids: [] },
		];
		const { doc } = mountViewer(renderSession(data), false);
		const more = doc.querySelector(".recurring-more");
		expect(more?.hasAttribute("hidden")).toBe(false);
		expect(more?.textContent).toBe("더 보기 (1)");
		expect(doc.querySelectorAll(".recurring-extra").length).toBe(1);
		click(more);
		expect(more?.textContent).toBe("접기");
		expect(more?.getAttribute("aria-expanded")).toBe("true");
		expect(STYLE).toMatch(/\.recurring:not\(\.is-expanded\) \.recurring-extra\s*\{\s*display:\s*none/);
	});
});

describe("제목 줄바꿈 (DESIGN §10, §15-1)", () => {
	test('공백 없이 붙은 "·"는 앞 단어에 U+2060 WORD JOINER로 붙어 줄이 "·"로 시작하지 않는다', () => {
		const data = sampleData();
		data.units[0].title = "마크를 놓침·라인이 안 맞음";
		const doc = parseHTML(renderSession(data)).document;
		const toc = doc.querySelector('#panel-match .toc-item[data-target="u001"] .toc-title')?.textContent ?? "";
		expect(toc).toContain("\u2060·\u2060라인이");
	});

	test('" / " 제목은 슬래시를 앞 조각 끝에 붙인 inline-block 조각들로 나뉘고 짧은 마지막 서술어는 앞 어절에 붙는다', () => {
		const data = sampleData();
		data.units[0].title = "동그리: 내려오지 말고 올라가기 / 게임메이커: 마크를 놓침";
		const doc = parseHTML(renderSession(data)).document;
		const parts = [...(doc.getElementById("u001")?.querySelectorAll("h3 .title-part") ?? [])].map((el) => el.textContent ?? "");
		expect(parts.length).toBe(2);
		expect(parts[0].endsWith(" /")).toBe(true);
		expect(parts[1].startsWith("/")).toBe(false);
		expect(parts[1]).toBe(`지적 게임메이커:${NBSP}마크를${NBSP}놓침`); // -ㅁ 조각 앞의 "지적" 라벨
		// 목차 라벨도 같은 파이프라인을 탄다
		expect(doc.querySelectorAll('#panel-match .toc-item[data-target="u001"] .toc-title .title-part').length).toBe(2);
	});

	test("마지막 어절이 2음절 이하면 앞 어절에 붙고, 앞 어절이 1음절이면 한 어절 더 이어 붙는다(MAX_GLUE_RUN 이내)", () => {
		const data = sampleData();
		data.units[0].title = "수비 상대 한 명을";
		data.units[1].title = "공간을 넓힘";
		data.units[2].title = "압박 라인이 텅 빔";
		const doc = parseHTML(renderSession(data)).document;
		const title = (id: string) => doc.getElementById(id)?.querySelector("h3")?.textContent;
		expect(title("u001")).toBe(`수비 상대${NBSP}한${NBSP}명을`);
		expect(title("u002")).toBe(`공간을${NBSP}넓힘`);
		expect(title("u003")).toBe(`압박 라인이${NBSP}텅${NBSP}빔`);
	});

	test("한글 사이 가운뎃점 뒤에 U+2060을 둬 '윙·풀백'이 줄 끝에서 갈라지지 않는다", () => {
		expect(glueKorean("윙·풀백")).toBe("윙·\u2060풀백");
		expect(glueKorean("A·B")).toBe("A·B");
	});

	test("제목 조각 끝의 헤지 괄호는 앞 단어와 nbsp로 묶인다", () => {
		const data = sampleData();
		data.units[0].title = "라인 간격 좁히기 (필요해 보임) / 압박 타이밍 (늦음)";
		const title = parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector("h3")?.textContent ?? "";
		expect(title).toContain(`좁히기${NBSP}(필요해${NBSP}보임)`);
		expect(title).toContain(`타이밍${NBSP}(늦음)`);
		data.units[0].title = "이름(NAME 이름표)가 보임";
		expect(parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector("h3")?.textContent).not.toContain(`이름${NBSP}(`);
	});

	test("제목 조각 끝의 12자 이하 괄호는 안쪽 공백도 nbsp라 괄호 안에서 줄바꿈되지 않고, 13자 이상은 안쪽을 그대로 둔다", () => {
		const data = sampleData();
		const titleOf = (title: string) => {
			data.units[0].title = title;
			return parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector("h3")?.textContent ?? "";
		};
		expect(titleOf("볼 내주기(찬스가 있었을 듯)")).toContain(`(찬스가${NBSP}있었을${NBSP}듯)`);
		expect(titleOf("볼 내주기 (필요해 보임) / 압박 타이밍(늦은 듯함)")).toContain(`(필요해${NBSP}보임)`);
		expect(titleOf("볼 내주기 (필요해 보임) / 압박 타이밍(늦은 듯함)")).toContain(`(늦은${NBSP}듯함)`);
		expect(titleOf("볼 내주기(찬스가 꽤 많이 있었던 것 같음)")).toContain("(찬스가 꽤");
		expect(titleOf("볼 (찬스가 있었을 듯) 내주기")).toContain("(찬스가 있었을 듯)");
	});

	test('"양 팀"처럼 양 + 명사는 묶인다', () => {
		expect(glueKorean("양 팀 모두 내려섬")).toBe(`양${NBSP}팀 모두 내려섬`);
		expect(glueKorean("양이 많다")).toBe("양이 많다");
	});

	test(".toc-item은 시간 칩 뒤 열에 라벨을 정렬하는 auto/1fr 그리드다", () => {
		const rule = STYLE.match(/\.toc-item\s*\{[^}]*\}/)?.[0] ?? "";
		expect(rule).toContain("display: grid");
		expect(rule).toContain("grid-template-columns: auto minmax(0, 1fr)");
		expect(STYLE).toContain(".toc-item[hidden] { display: none; }");
	});
});

describe("참고자료 페이지 · 포지션 트리 (DESIGN §7, §12)", () => {
	test("ref 페이지는 kind를 한국어로, 형식 배지를 영상/글로 보이고 요약 폭은 --measure로 제한한다", () => {
		const doc = parseHTML(
			renderRef({ id: "r-1", title: "제목", lang: "en", kind: "eafc", format: "video", url: "https://example.com", start_seconds: null, summary_ko: "요약", key_points_ko: [], translations: [] }),
		).document;
		const badges = [...doc.querySelectorAll(".ref-badges .badge")].map((el) => el.textContent);
		expect(badges).toEqual(["영상", "EA FC", "EN"]);
		expect(STYLE.match(/\.summary-ko\s*\{[^}]*\}/)?.[0]).toContain("max-width: var(--measure)");
	});

	test("포지션 트리는 태그된 노드와 그 조상만 렌더한다(FW 태그가 ST/WF를, DF 태그가 WB를 만들지 않는다)", () => {
		const doc = parseHTML(renderSession(sampleData())).document; // FB, GK, ST
		const rendered = new Set([...doc.querySelectorAll('.chip-filter[data-group="position"]')].map((el) => el.getAttribute("data-value")));
		for (const present of ["GK", "DF", "FB", "FW", "ST"]) expect(rendered.has(present)).toBe(true);
		for (const absent of ["CB", "WB", "WF", "CDM", "CM", "CAM", "SM", "MF"]) expect(rendered.has(absent)).toBe(false);
		const data = sampleData();
		data.units[0].position_tags = ["DF"]; // DF만 태그: DF 아래 노드는 태그되지 않았으므로 렌더 안 됨
		const doc2 = parseHTML(renderSession(data)).document;
		const rendered2 = new Set([...doc2.querySelectorAll('.chip-filter[data-group="position"]')].map((el) => el.getAttribute("data-value")));
		expect(rendered2.has("DF")).toBe(true);
		expect(rendered2.has("WB")).toBe(false);
		expect(rendered2.has("FB")).toBe(false);
	});

	test("옛 data.json의 좌우 포지션 코드(LB/RW/CF 등)는 읽을 때 새 코드로 옮겨 필터 트리·data-pos·칩에 새 코드만 나온다", () => {
		const data = sampleData();
		data.units[0].member_ids = [];
		data.units[0].position_target_ids = [];
		data.units[0].position_tags = ["LB", "RB", "CF", "LW"];
		data.members[0].positions = ["RWB", "RM", "RW"];
		data.matches[0].lineup = { hong: "LB", kim: "RF" };
		const doc = parseHTML(renderSession(data)).document;
		const rendered = new Set([...doc.querySelectorAll('.chip-filter[data-group="position"]')].map((el) => el.getAttribute("data-value")));
		for (const present of ["DF", "FB", "FW", "ST", "WF"]) expect(rendered.has(present)).toBe(true);
		for (const old of ["LB", "RB", "CF", "LW"]) expect(rendered.has(old)).toBe(false);
		expect(doc.getElementById("u001")?.getAttribute("data-pos")).toBe("DF|FB|FW|ST|WF");
		expect(plain(doc.getElementById("u001")?.querySelector(".target-position-line")?.textContent)).toBe("대상: FB, ST, WF");
	});

	test("positionTagsFromLegacyData·lineupFromLegacyData는 core의 한 변환 함수로 옛 코드를 옮긴다", () => {
		expect(positionTagsFromLegacyData({ position_tags: ["LW", "RW", "CM"] })).toEqual(["WF", "CM"]);
		expect(lineupFromLegacyData({ lineup: { a: "RB", b: "CB" } })).toEqual({ a: "FB", b: "CB" });
		expect(lineupFromLegacyData({ lineup: null })).toBeNull();
	});
});

// ── 리뷰 결함 수정 (DESIGN §4, §5 4a, §10, §12, §6) ─────────────────────────

describe("리뷰 결함 수정", () => {
	function ultrawide(): SessionDataInput {
		const data = sampleData();
		data.units[2].body = [{ type: "frame", src: "img/u003-c001.webp", width: 1280, height: 360, t: 105, caption: "초광각" }];
		data.units[2].images.start = { src: "img/u003-start.webp", width: 1280, height: 360 };
		return data;
	}
	function sizedBox(dom: ReturnType<typeof parseHTML>, scrollWidth: number, clientWidth: number) {
		const box = dom.document.querySelector(".frame-pan-scroll") as unknown as { scrollLeft: number; dispatchEvent(event: unknown): boolean };
		Object.defineProperty(box, "scrollWidth", { value: scrollWidth, configurable: true });
		Object.defineProperty(box, "clientWidth", { value: clientWidth, configurable: true });
		return box;
	}

	test("glueKorean은 금지형 '-지 말고/말아/말라/말자'를 묶는다", () => {
		for (const tail of ["말고", "말아", "말라", "말자"]) {
			expect(glueKorean(`걸지 ${tail} 올라가기`)).toContain(`걸지${NBSP}${tail}`);
		}
		expect(glueKorean("걸지 마라")).toBe("걸지 마라");
	});

	test("모바일 목차 토글은 필터 바 바로 다음(카드 목록보다 앞) order를 갖는다", () => {
		const media = STYLE.match(/@media \(max-width: 1023\.98px\) \{\s*\.layout[\s\S]*?\n\}/)?.[0] ?? "";
		const order = (selector: string) => Number(media.match(new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{[^}]*?order:\\s*(\\d+)`))?.[1]);
		expect(order(".toc-scroll")).toBe(order(".filter-bar") + 1);
		expect(order(".toc-scroll")).toBeLessThan(order(".card-list"));
	});

	test("프레임 이동 힌트 선택자는 .frame-pan 안으로 한정돼 본문 단락 규칙을 이긴다", () => {
		expect(STYLE).toMatch(/\.frame-pan \.frame-pan-hint\s*\{[^}]*font-size:\s*0\.8125rem/);
		expect(STYLE).not.toMatch(/(^|\n)\.frame-pan-hint/);
	});

	test("이동 상자는 이미지 load 때 다시 가운데로 가고, 사용자가 민 상자는 건드리지 않는다", () => {
		const dom = parseHTML(renderSession(ultrawide()));
		const box = sizedBox(dom, 0, 0);
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		runViewer(win, { Player: StubPlayer, loaded: false });
		expect(box.scrollLeft).toBe(0);
		sizedBox(dom, 1280, 358);
		const img = dom.document.querySelector(".frame-pan-scroll img");
		img?.dispatchEvent(new DomEvent("load") as unknown as Event);
		expect(box.scrollLeft).toBe((1280 - 358) / 2);

		box.scrollLeft = 10; // 사용자가 밀었다
		box.dispatchEvent(new DomEvent("scroll") as unknown as Event);
		sizedBox(dom, 1280, 300);
		img?.dispatchEvent(new DomEvent("load") as unknown as Event);
		expect(box.scrollLeft).toBe(10);
	});

	test("필터로 숨었다 다시 보이는 카드의 이동 상자는 다시 가운데로 간다", () => {
		const dom = parseHTML(renderSession(ultrawide()));
		const box = sizedBox(dom, 0, 0);
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
		runViewer(win, { Player: StubPlayer, loaded: false });
		sizedBox(dom, 1280, 358);
		click(win.document.querySelector('.chip-filter[data-group="position"][data-value="GK"]'));
		expect(box.scrollLeft).toBe((1280 - 358) / 2);
	});

	test("참고자료 페이지 '원문'은 영상 시작 시각으로 열고, 시작이 없으면 원문 그대로 연다", () => {
		const base = { id: "r-1", title: "제목", lang: "en", kind: "eafc" as const, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", summary_ko: "요약", key_points_ko: [], translations: [] };
		const video = parseHTML(renderRef({ ...base, format: "video", start_seconds: 245 })).document.querySelector(".plain-link a");
		expect(video?.getAttribute("href")).toContain("t=245s");
		expect(video?.textContent).toBe("자료 영상 4:05부터 ↗");
		const article = parseHTML(renderRef({ ...base, format: "article", start_seconds: null })).document.querySelector(".plain-link a");
		expect(article?.textContent).toBe("원문 ↗");
	});

	test("참고자료 배지는 제목 아래 자기 줄(.ref-badges)에 놓이고 형식 배지는 따로 스타일된다", () => {
		const data = sampleData();
		data.units[0].refs = [{ id: "r-v", title: "센터백 간격 강의", lang: "ko", kind: "tactics", href: null, orig_url: "https://example.com", format: "article", relevance_ko: "관련", start_seconds: null, version_badge: null, pro_clubs: false }];
		const li = parseHTML(renderSession(data)).document.querySelector("#u001 .refs-list li");
		expect(li?.querySelector(".ref-badges .ref-format")?.textContent).toBe("글");
		expect(STYLE).toMatch(/\.ref-badges\s*\{[^}]*display:\s*flex/);
		const rule = STYLE.match(/\.badge\.ref-format\s*\{[^}]*\}/)?.[0] ?? "";
		expect(rule).toMatch(/color:\s*var\(--ink\)/);
		expect(rule).toMatch(/background:\s*var\(--surface-sunken\)/);
		expect(rule).not.toMatch(/--accent|--mine-tint/);
	});

	test("참고자료 링크 줄은 요약·원문 링크를 보이는 '·' 구분자로 나누고 요약도 새 탭으로 연다", () => {
		const data = sampleData();
		data.units[0].refs = [{ id: "r-en", title: "EN 자료", lang: "en", kind: "tactics", href: "../../refs/r-en.html", orig_url: "https://example.com/en", format: "article", relevance_ko: "관련", start_seconds: null, version_badge: null, pro_clubs: false }];
		const li = parseHTML(renderSession(data)).document.querySelector("#u001 .refs-list li");
		const summary = [...(li?.querySelectorAll("a") ?? [])].find((a) => a.textContent === "요약");
		expect(summary?.getAttribute("target")).toBe("_blank");
		expect(summary?.getAttribute("rel")).toBe("noopener");
		expect(li?.innerHTML).toContain('</a><span class="ref-sep" aria-hidden="true">·</span><a');
	});

	test("목차 시간 칩은 자릿수와 무관하게 같은 최소 폭(ch)을 가져 제목 시작선이 흔들리지 않는다", () => {
		expect(STYLE).toMatch(/\.toc-item \.chip-time\s*\{[^}]*min-width:\s*\d+ch/);
		expect(STYLE).toMatch(/\.toc-item \.chip-time\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
	});

	test("내 피드백 pill 줄은 1024px 이상에서 줄바꿈하고 미만에서만 가로 스크롤한다", () => {
		expect(STYLE).toMatch(/\.my-feedback-row\s*\{[^}]*flex-wrap:\s*wrap/);
		expect(STYLE).not.toMatch(/\n\.my-feedback-row\s*\{[^}]*overflow-x/);
		expect(STYLE).toMatch(/@media \(max-width: 1023\.98px\) \{\s*\.my-feedback-row\s*\{[^}]*overflow-x:\s*auto/);
	});

	test("제목의 연속된 대문자 라틴 단어는 NBSP로 묶고 '·'는 앞 단어에 붙어 줄 머리에 오지 않는다", () => {
		const data = sampleData();
		data.units[0].title = "Los Veteranos 상대 수비 · 전환 상황";
		const title = parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector("h3")?.textContent;
		expect(title).toContain(`Los${NBSP}Veteranos 상대`);
		expect(title).toContain(`수비${NBSP}· 전환`);
	});
});

// ── 반복 지적 소유자 · 보이는 개수 · 접기 (DESIGN §6a) ─────────────────────────

describe("반복 지적 — member_ids 소유자와 보이는 개수", () => {
	function ownedData(): SessionDataInput {
		const data = sampleData();
		// u001 = hong, u003 = choi. 라벨은 choi 본인의 반복 행동만 가리킨다.
		data.recurring = [{ label: "최민수가 더 올라가지 않음", unit_ids: ["u001", "u003"], member_ids: ["choi"] }];
		return data;
	}

	test("항목의 member_ids를 행에 data-label-owner-ids로, 칩 단위로 정한 소유자를 data-owner-ids로 싣는다", () => {
		const row = parseHTML(renderSession(ownedData())).document.querySelector(".recurring-item");
		expect(row?.getAttribute("data-label-owner-ids")).toBe("choi");
		expect(row?.getAttribute("data-owner-ids")).toBe("choi");
	});

	test("반복 지적 행은 라벨을 자기 줄에 두고 칩은 따로 감기는 줄이며, 개수 문구는 '·'로 줄이 끝나지 않는 조각들이다", () => {
		const rule = (selector: string): string => STYLE.match(new RegExp(`\\n${selector.replace(/[.]/g, "\\.")}\\s*\\{[^}]*\\}`))?.[0] ?? "";
		expect(rule(".recurring-label")).toMatch(/display:\s*block/);
		expect(rule(".recurring-units")).toMatch(/display:\s*flex[^}]*flex-wrap:\s*wrap/);
		expect(rule(".recurring-count-part")).toMatch(/white-space:\s*nowrap/);
		const { doc } = mountViewer(renderSession(ownedData()), false);
		clickMinePill(doc, "choi");
		const parts = [...doc.querySelectorAll(".recurring-count .recurring-count-part")].map((el) => el.textContent ?? "");
		expect(parts.length).toBeGreaterThan(1);
		expect(parts.every((text) => !text.trimEnd().endsWith("·"))).toBe(true);
		expect(parts.slice(1).every((text) => text.startsWith("·") || text.startsWith("("))).toBe(true);
		expect(parts.every((text) => text === text.trim())).toBe(true); // 간격은 flex gap이 낸다 — 조각에 바깥 공백이 없다
		expect(parts.join(" ")).toBe(doc.querySelector(".recurring-count")?.textContent ?? "");
		expect(doc.querySelector(".recurring-unfound")).toBeNull();
	});

	test("member_ids가 비어 있지 않으면 그 주인만 자기가 고칠 카드 수로 k를 받고, 다른 팀원은 카드 소속이어도 접미사가 없다", () => {
		const { doc } = mountViewer(renderSession(ownedData()), false);
		const count = () => doc.querySelector(".recurring-count")?.textContent ?? "";
		clickMinePill(doc, "hong"); // u001 카드에는 hong이 있지만 라벨의 주인은 choi
		expect(count()).not.toContain("내가 고칠 것");
		clickMinePill(doc, "hong");
		clickMinePill(doc, "choi");
		expect(count()).toContain("내가 고칠 것 1"); // choi가 고칠 사람인 카드는 u003뿐
	});

	test("필터가 칩을 가리면 '×N · 보이는 카드 v'를 보이고, 다 보이면 생략한다", () => {
		const data = sampleData();
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u002", "u003"], member_ids: [] }];
		const { doc } = mountViewer(renderSession(data), false);
		const count = () => doc.querySelector(".recurring-count")?.textContent ?? "";
		expect(count()).toBe("×3");
		clickChip(doc, "position", "GK"); // u002만 남는다
		expect(count()).toBe("×3 · 보이는 카드 1");
		clickChip(doc, "position", "GK");
		expect(count()).toBe("×3");
	});

	test("지금 보이는 카드와 내가 고칠 것이 함께 나온다", () => {
		const { doc } = mountViewer(renderSession(ownedData()), false);
		clickMinePill(doc, "choi");
		clickChip(doc, "position", "GK"); // 두 카드 모두 가려진다 -> 행 자체가 숨는다
		clickChip(doc, "position", "GK");
		clickChip(doc, "position", "ST"); // u003만 남는다
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×2 · 보이는 카드 1 (그중 내가 고칠 것 1)");
	});

	test("'더 보기' 접기 규칙은 폭과 무관하게 적용된다(미디어 쿼리 밖)", () => {
		expect(STYLE).toMatch(/\n\.recurring:not\(\.is-expanded\) \.recurring-extra\s*\{\s*display:\s*none/);
		expect(STYLE).toMatch(/\n\.recurring-more:not\(\[hidden\]\)\s*\{/);
	});
});

describe("제목·캡션 글루 (DESIGN §10)", () => {
	test("glueTitle은 연속된 대문자 라틴 단어를 2~3개까지만 묶고 더 긴 줄은 공백에서 줄바꿈되게 둔다", () => {
		const data = sampleData();
		data.units[0].title = "How To Win Every Header In FC 25";
		const title = parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector("h3")?.textContent ?? "";
		expect(title).toContain(`How To Win Every Header In FC${NBSP}25`); // 긴 대문자 줄은 풀어 두되 "FC 25"는 묶는다
		expect(title.replace(`FC${NBSP}25`, "FC 25")).not.toContain(NBSP);
		data.units[0].title = "Los Veteranos Cup 결승전 분석입니다";
		const three = parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector("h3")?.textContent ?? "";
		expect(three).toContain(`Los${NBSP}Veteranos${NBSP}Cup 결승전 분석입니다`);
	});

	test("glueKorean은 한글과 '(' 사이, ')'와 바로 붙은 조사 사이에 U+2060을 넣는다", () => {
		expect(glueKorean("이스코(ISCO 이름표)")).toBe("이스코\u2060(ISCO 이름표)");
		expect(glueKorean("용딘(YONGDIN 이름표)이 골대")).toBe("용딘\u2060(YONGDIN 이름표)\u2060이 골대");
		expect(glueKorean("(ISCO)가 아니라 (ISCO)이름")).toBe("(ISCO)\u2060가 아니라 (ISCO)이름");
		expect(glueKorean(glueKorean("이스코(ISCO)는"))).toBe(glueKorean("이스코(ISCO)는"));
	});

	test("glueKorean은 숫자 범위 '6–8m'/'6-8m'을 쪼개지 못하게 묶는다", () => {
		expect(glueKorean("간격 6–8m")).toBe("간격 6\u2060–\u20608m");
		expect(glueKorean("간격 6-8m")).toBe("간격 6\u2060-\u20608m");
		expect(glueKorean("a-b 와 3–x")).toBe("a-b 와 3–x");
	});
});

describe("내 피드백 pill 스크롤", () => {
	test("pill을 고르면 그 pill을 가로 스크롤 영역 안으로 scrollIntoView(nearest)하고, 해제 때는 부르지 않는다", () => {
		const { win, doc } = mountViewer(renderSession(sampleData()), false);
		const calls: Array<{ el: unknown; opts: unknown }> = [];
		win.Element.prototype.scrollIntoView = function (this: unknown, opts: unknown) {
			calls.push({ el: this, opts });
		} as unknown as () => void;
		const pill = doc.querySelector('.pill-mine[data-value="park"]');
		clickMinePill(doc, "park");
		expect(calls.length).toBe(1);
		expect(calls[0].el).toBe(pill);
		expect(calls[0].opts).toEqual({ block: "nearest", inline: "nearest" });
		clickMinePill(doc, "park");
		expect(calls.length).toBe(1);
	});
});

describe("링크 전용 세션의 본문 프레임 이미지", () => {
	function linkOnlyFrameData(embeddable: boolean): SessionDataInput {
		const data = sampleData();
		data.videos = data.videos.map((video) => ({ ...video, embeddable }));
		return data;
	}

	test("링크 전용이면 본문 프레임 img를 시간 칩과 같은 youtu.be ?t= 새 탭 링크로 감싼다(alt 유지)", () => {
		const doc = parseHTML(renderSession(linkOnlyFrameData(false))).document;
		const img = doc.querySelector("#u003 .body-frame img");
		const link = img?.parentElement;
		expect(link?.tagName).toBe("A");
		expect(link?.getAttribute("href")).toBe("https://youtu.be/AAAAAAAAAAA?t=105");
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener");
		expect(link?.getAttribute("href")).toBe(doc.querySelector("#u003 .body-frame a.seek-btn")?.getAttribute("href"));
		expect(img?.getAttribute("alt")).toBe("역습 시작 지점");
	});

	test("임베드 가능한 세션의 본문 프레임 img는 링크로 감싸지 않는다", () => {
		const doc = parseHTML(renderSession(linkOnlyFrameData(true))).document;
		expect(doc.querySelector("#u003 .body-frame img")?.parentElement?.tagName).toBe("FIGURE");
	});
});

describe("데스크톱 목차 탭 줄", () => {
	test("1024px 이상에서 경기별/주제별 tablist는 .toc-scroll 안에서 위에 고정(sticky)된다", () => {
		const desktop = STYLE.slice(STYLE.indexOf("@media (min-width: 1024px)"));
		expect(desktop).toMatch(/\.toc \[role="tablist"\]\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/);
	});
});

// ── 참고자료 배지 · 미확인 인물 · 위계 · 반복 지적 문구 · 아카이브 목록 (DESIGN §5/§6a/§12/§13) ──

describe("참고자료 버전·프로클럽 배지", () => {
	const refBase = {
		id: "r-eafc",
		title: "EA FC 자료",
		lang: "en",
		kind: "eafc" as const,
		href: "../../refs/r-eafc.html",
		orig_url: "https://example.com/en",
		format: "article" as const,
		relevance_ko: "관련",
		start_seconds: null,
		version_badge: null as string | null,
		pro_clubs: false,
	};
	const badgesOf = (ref: typeof refBase & { published_badge?: string | null }): (string | null)[] => {
		const data = sampleData();
		data.units[0].refs = [ref];
		const li = parseHTML(renderSession(data)).document.querySelector("#u001 .refs-list li");
		return [...(li?.querySelectorAll(".ref-badges .badge") ?? [])].map((el) => el.textContent);
	};

	test("프로클럽은 pro_clubs가 true일 때만 별도 배지로, 버전 배지는 version_badge 문구 그대로 보인다", () => {
		expect(badgesOf({ ...refBase, pro_clubs: true, version_badge: "FC 25 · 이전 버전" })).toEqual(["글", "EA FC", "프로클럽", "FC 25 · 이전 버전", "EN"]);
		expect(badgesOf(refBase)).toEqual(["글", "EA FC", "EN"]);
	});

	test("언어 배지는 ko가 아닐 때만 보이고, 날짜(published_badge)는 버전 배지 다음에 단독으로 보인다", () => {
		expect(badgesOf({ ...refBase, lang: "ko" })).toEqual(["글", "EA FC"]);
		expect(badgesOf({ ...refBase, published_badge: "2023년 1월" })).toEqual(["글", "EA FC", "2023년 1월", "EN"]);
		expect(badgesOf({ ...refBase, version_badge: "FC 25 · 이전 버전", published_badge: "2023년 1월" })).toEqual(["글", "EA FC", "FC 25 · 이전 버전", "2023년 1월", "EN"]);
	});

	test("옛 data.json의 '버전 미표기' 문구는 이름 있는 변환 함수가 버전 없음·날짜만으로 읽어 보이지 않는다", () => {
		expect(versionBadgeFromLegacyData({ version_badge: "버전 미표기" })).toBeNull();
		expect(versionBadgeFromLegacyData({ version_badge: "2023년 1월 · 버전 미표기" })).toBeNull();
		expect(publishedBadgeFromLegacyData({ version_badge: "2023년 1월 · 버전 미표기" })).toBe("2023년 1월");
		expect(publishedBadgeFromLegacyData({ version_badge: "버전 미표기" })).toBeNull();
		expect(publishedBadgeFromLegacyData({ version_badge: "FC 25 · 이전 버전" })).toBeNull();
		expect(publishedBadgeFromLegacyData({ version_badge: null, published_badge: "2024년 3월" })).toBe("2024년 3월");
		expect(badgesOf({ ...refBase, version_badge: "버전 미표기" })).toEqual(["글", "EA FC", "EN"]);
		expect(badgesOf({ ...refBase, version_badge: "2023년 1월 · 버전 미표기" })).toEqual(["글", "EA FC", "2023년 1월", "EN"]);
	});

	test("버전 배지 문구는 이스케이프된다", () => {
		const data = sampleData();
		data.units[0].refs = [{ ...refBase, version_badge: XSS_PAYLOAD }];
		const html = renderSession(data);
		expect(html.includes(XSS_PAYLOAD)).toBe(false);
	});

	test("참고자료 페이지도 같은 두 배지를 같은 자리에 보인다", () => {
		const page = {
			id: "r-1", title: "제목", lang: "en", kind: "eafc" as const, format: "video" as const, url: "https://example.com", start_seconds: null,
			summary_ko: "요약", key_points_ko: [], translations: [], version_badge: "FC 26" as string | null, pro_clubs: true,
		};
		const badges = (ref: typeof page) => [...parseHTML(renderRef(ref)).document.querySelectorAll(".ref-badges .badge")].map((el) => el.textContent);
		expect(badges(page)).toEqual(["영상", "EA FC", "프로클럽", "FC 26", "EN"]);
		expect(badges({ ...page, lang: "ko" })).toEqual(["영상", "EA FC", "프로클럽", "FC 26"]);
		expect(badges({ ...page, version_badge: null, pro_clubs: false })).toEqual(["영상", "EA FC", "EN"]);
	});

	test("옛 데이터는 이름 있는 변환 함수로 version_badge null · pro_clubs false로 읽는다", () => {
		expect(versionBadgeFromLegacyData({})).toBeNull();
		expect(versionBadgeFromLegacyData({ version_badge: "FC 26" })).toBe("FC 26");
		expect(proClubsFromLegacyData({})).toBe(false);
		expect(proClubsFromLegacyData({ pro_clubs: true })).toBe(true);
		const legacyRef = { ...refBase } as Partial<typeof refBase>;
		delete legacyRef.version_badge;
		delete legacyRef.pro_clubs;
		const data = sampleData();
		data.units[0].refs = [legacyRef as typeof refBase];
		const li = parseHTML(renderSession(data)).document.querySelector("#u001 .refs-list li");
		expect([...(li?.querySelectorAll(".ref-badges .badge") ?? [])].map((el) => el.textContent)).toEqual(["글", "EA FC", "EN"]);
		const legacyPage = { id: "r-1", title: "제목", lang: "en", kind: "eafc" as const, format: "article" as const, url: "https://example.com", start_seconds: null, summary_ko: "요약", key_points_ko: [], translations: [] };
		expect([...parseHTML(renderRef(legacyPage)).document.querySelectorAll(".ref-badges .badge")].map((el) => el.textContent)).toEqual(["글", "EA FC", "EN"]);
	});
});

describe("카드의 장면 줄(fault_scene)", () => {
	test("fault_scene이 있으면 제목 바로 아래 <p class=fault-scene>장면: …</p>로 이스케이프해 렌더한다", () => {
		const data = sampleData();
		data.units[0].fault_scene = "뎁스차저가 <b>아크</b> 근처에서 상대 둘 사이에 서 있다";
		const html = renderSession(data);
		expect(html.includes("<b>아크</b>")).toBe(false);
		const line = parseHTML(html).document.querySelector("#u001 .fault-scene");
		expect(line?.tagName).toBe("P");
		expect(plain(line?.textContent)).toBe("장면 · 뎁스차저가 <b>아크</b> 근처에서 상대 둘 사이에 서 있다");
		expect(line?.querySelector(".line-label")?.textContent).toBe("장면 ·");
	});

	test("장면 줄과 자료 교훈 줄은 한 단계 작은 글자(0.875rem)이고 행간 1.6 이상이며 대비 색을 유지한다", () => {
		const scene = STYLE.match(/\.fault-scene\s*\{([^}]*)\}/)?.[1] ?? "";
		const lesson = STYLE.match(/\.ref-lesson\s*\{([^}]*)\}/)?.[1] ?? "";
		for (const rule of [scene, lesson]) {
			expect(rule).toMatch(/font-size:\s*0\.875rem/);
			expect(rule).toMatch(/line-height:\s*1\.[6-9]/);
		}
		expect(scene).toMatch(/color:\s*var\(--muted\)/);
		expect(lesson).toMatch(/color:\s*var\(--ink\)/);
	});

	test("장면 줄과 자료 교훈 줄은 같은 구분점('·')과 같은 .line-label 스타일의 머리말을 쓴다", () => {
		const data = sampleData();
		Object.assign(data.units[0], {
			title: "센터백: 첫판부터 정신 놓음",
			fault_scene: "수비 라인이 둘로 갈라졌다",
			refs: [
				{
					id: "r-w",
					title: "강의",
					source_name: "Example Channel",
					lang: "ko",
					kind: "tactics",
					href: null,
					orig_url: "https://example.com/w",
					format: "article",
					relevance_ko: "관련",
					lesson_ko: "포백이 한 줄로 선다",
					start_seconds: null,
					version_badge: null,
					pro_clubs: false,
				},
			],
		});
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		const labels = [...(card?.querySelectorAll(".fault-scene .line-label, .ref-lesson .line-label") ?? [])].map((el) => el.textContent);
		expect(labels).toEqual(["자료가 권하는 것 ·", "장면 ·"]);
		expect(card?.querySelectorAll(".line-label").length).toBe(2);
		const label = STYLE.match(/\n\.line-label\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(label).toMatch(/font-weight:\s*600/);
		expect(label).toMatch(/color:\s*var\(--ink\)/);
		expect(label).toMatch(/white-space:\s*nowrap/);
	});

	test("fault_scene이 null이면 줄을 렌더하지 않고, 스타일은 --muted 색이다", () => {
		const data = sampleData();
		data.units[0].fault_scene = null;
		expect(parseHTML(renderSession(data)).document.querySelector(".fault-scene")).toBeNull();
		const rule = STYLE.match(/\.fault-scene\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(rule).toMatch(/color:\s*var\(--muted\)/);
	});

	test("옛 데이터는 faultSceneFromLegacyData로 null로 읽는다", () => {
		expect(faultSceneFromLegacyData({})).toBeNull();
		expect(faultSceneFromLegacyData({ fault_scene: "장면" })).toBe("장면");
		const data = sampleData();
		delete (data as unknown as { units: Array<Partial<SessionUnit>> }).units[0].fault_scene;
		expect(parseHTML(renderSession(data)).document.querySelector(".fault-scene")).toBeNull();
	});
});

describe("제목 묶음 — '<말> 쪽'과 한 음절 부사 '더'", () => {
	test("glueKorean은 단독 '쪽'을 앞 낱말에, glueTitle 경로는 단독 '더'를 뒤 낱말에 붙이고 '위쪽'·'더블' 같은 한 낱말은 건드리지 않는다", () => {
		expect(glueKorean("용딘: 뎁스차저 패스를 받으면 우사 쪽 바라보기")).toContain(`우사${NBSP}쪽`);
		expect(glueKorean("화면 위쪽에 몰렸다")).toBe("화면 위쪽에 몰렸다");
		const data = sampleData();
		data.units[0].title = "동그리: 받으러 내려오지 말고 더 올라가기 / 두두: 더블 팀 서기";
		const text = parseHTML(renderSession(data)).document.querySelector("#u001 h3")?.textContent ?? "";
		expect(text).toContain(`더${NBSP}올라가기`);
		expect(plain(text)).toContain("더블 팀");
	});
});

describe("카드 제목 줄바꿈 — ' / ' 조각은 블록 줄이고 text-wrap은 pretty", () => {
	test("카드 제목의 .title-part는 블록(한 조각이 한 줄 이상을 차지)이고 제목 h3는 balance가 아니라 pretty다", () => {
		expect(STYLE).toMatch(/\.card h3 \.title-part\s*\{[^}]*display:\s*block/);
		expect(STYLE).toMatch(/\.card h3\s*\{[^}]*text-wrap:\s*pretty/);
	});

	test("목차 등 카드 밖의 .title-part는 기존대로 inline-block을 유지한다", () => {
		expect(STYLE).toMatch(/\n\.title-part\s*\{[^}]*display:\s*inline-block/);
	});

	test("제목 조각의 '행위자:'는 첫 낱말과 NBSP로 묶여 행위자만 줄 끝에 남지 않는다", () => {
		const data = sampleData();
		data.units[0].title = "동그리: 받으러 내려오지 말고 더 올라가기 / 우사: 리턴 대신 아래 게임메이커에게 주기";
		const doc = parseHTML(renderSession(data)).document;
		const parts = [...doc.querySelectorAll("#u001 h3 .title-part")].map((el) => el.textContent ?? "");
		expect(parts[0].startsWith("동그리:\u00a0받으러")).toBe(true);
		expect(parts[1].startsWith("우사:\u00a0리턴")).toBe(true);
		const single = sampleData();
		single.units[0].title = "용딘: 뎁스차저 패스를 받으면 리턴 패스도 생각하기";
		expect(parseHTML(renderSession(single)).document.querySelector("#u001 h3")?.textContent?.startsWith("용딘:\u00a0뎁스차저")).toBe(true);
	});
});

describe("카드 breadcrumb — '›'는 뒤따르는 조각에 붙는다", () => {
	test("'›'는 주제 조각(.breadcrumb-topic) 안에서 주제 글자와 NBSP로 이어져 줄 끝에 홀로 남지 않고, 경기 제목과는 보통 공백으로 나뉜다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const crumb = doc.querySelector("#u001 .breadcrumb");
		const topic = crumb?.querySelector(".breadcrumb-topic");
		expect(topic?.textContent?.startsWith("›\u00a0")).toBe(true);
		expect(topic?.querySelector("[aria-hidden='true']")?.textContent).toBe("›\u00a0");
		expect(crumb?.innerHTML).toMatch(/[^>\s] <span class="breadcrumb-topic">/);
		expect(plain(crumb?.textContent)).toBe("1경기 › 빌드업 전개");
	});
});

describe("카드의 방향 확인 줄(direction_check_ko)", () => {
	test("direction_check_ko가 있으면 장면 줄 자리에 <p class=direction-check>방향 확인 필요 · …</p>로 이스케이프해 렌더한다", () => {
		const data = sampleData();
		data.units[0].fault_scene = "수비 라인이 둘로 갈라졌다";
		data.units[0].direction_check_ko = "댓글은 좌측, 사진은 <b>위쪽</b>";
		const html = renderSession(data);
		expect(html.includes("<b>위쪽</b>")).toBe(false);
		const card = parseHTML(html).document.getElementById("u001");
		const line = card?.querySelector(".direction-check");
		expect(line?.tagName).toBe("P");
		expect(plain(line?.textContent)).toBe("방향 확인 필요 · 댓글은 좌측, 사진은 <b>위쪽</b>");
		expect(line?.querySelector(".line-label")?.textContent).toBe("방향 확인 필요 ·");
		expect(line?.previousElementSibling?.classList.contains("fault-scene")).toBe(true);
	});

	test("direction_check_ko가 null이면 줄이 없고, 스타일은 기존 색 토큰만 쓴다", () => {
		const data = sampleData();
		data.units[0].direction_check_ko = null;
		expect(parseHTML(renderSession(data)).document.querySelector(".direction-check")).toBeNull();
		const rule = STYLE.match(/\.direction-check \.line-label\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(rule).toMatch(/color:\s*var\(--pos-gk-fg\)/);
	});

	test("옛 데이터는 directionCheckFromLegacyData로 null로 읽는다", () => {
		expect(directionCheckFromLegacyData({})).toBeNull();
		expect(directionCheckFromLegacyData({ direction_check_ko: "확인" })).toBe("확인");
		const data = sampleData();
		delete (data as unknown as { units: Array<Partial<SessionUnit>> }).units[0].direction_check_ko;
		expect(parseHTML(renderSession(data)).document.querySelector(".direction-check")).toBeNull();
	});
});

describe("카드의 위치 미확인 인물 줄", () => {
	test("unidentified_member_ids가 있으면 본문 바로 뒤에 흐린 한 줄로 이름을 쉼표로 잇는다", () => {
		const data = sampleData();
		data.units[0].unidentified_member_ids = ["kim", "park"];
		const line = parseHTML(renderSession(data)).document.querySelector("#u001 .unidentified-members");
		expect(plain(line?.textContent)).toBe("사진에서 위치를 확인하지 못한 사람: 김철수, 박영희");
		expect(line?.previousElementSibling?.classList.contains("card-body")).toBe(true);
		expect(STYLE).toMatch(/\.unidentified-members\b[^{]*\{[^}]*color:\s*var\(--muted\)/);
	});

	test("look_at은 위치 미확인 줄 바로 아래 자기 줄(<p class=look-at>)로 이스케이프해 렌더하고, 라벨은 줄바꿈 없이 묶는다", () => {
		const data = sampleData();
		data.units[0].unidentified_member_ids = ["kim"];
		data.units[0].look_at = "화면 위쪽 마크 없는 <b>RONALDO</b>";
		const html = renderSession(data);
		expect(html.includes("<b>RONALDO</b>")).toBe(false);
		const doc = parseHTML(html).document;
		expect(plain(doc.querySelector("#u001 .unidentified-members")?.textContent)).toBe("사진에서 위치를 확인하지 못한 사람: 김철수");
		const line = doc.querySelector("#u001 .unidentified-members + .look-at");
		expect(line?.tagName).toBe("P");
		expect(plain(line?.textContent)).toBe("사진에서 볼 곳: 화면 위쪽 마크 없는 <b>RONALDO</b>");
		expect(line?.textContent?.startsWith(`사진에서${NBSP}볼${NBSP}곳:`)).toBe(true);
		expect(STYLE).toMatch(/\.look-at\b[^{]*\{[^}]*color:\s*var\(--muted\)/);
	});

	test("옛 데이터는 lookAtFromLegacyData로 null로 읽는다", () => {
		expect(lookAtFromLegacyData({})).toBeNull();
		expect(lookAtFromLegacyData({ look_at: "화면 위쪽" })).toBe("화면 위쪽");
		const data = sampleData();
		data.units[0].unidentified_member_ids = ["kim"];
		delete (data as unknown as { units: Array<Partial<SessionUnit>> }).units[0].look_at;
		expect(plain(parseHTML(renderSession(data)).document.querySelector("#u001 .unidentified-members")?.textContent)).toBe("사진에서 위치를 확인하지 못한 사람: 김철수");
	});

	test("로스터에 없는 id는 id로, 이름은 이스케이프하고, 비면 줄이 없다", () => {
		const data = sampleData();
		data.members[0].name = XSS_PAYLOAD;
		data.units[0].unidentified_member_ids = ["hong", "ghost"];
		const html = renderSession(data);
		expect(html.includes(XSS_PAYLOAD)).toBe(false);
		const doc = parseHTML(html).document;
		expect(plain(doc.querySelector("#u001 .unidentified-members")?.textContent)).toBe(`사진에서 위치를 확인하지 못한 사람: ${XSS_PAYLOAD}, ghost`);
		expect(doc.querySelector("#u002 .unidentified-members")).toBeNull();
	});

	test("옛 데이터는 변환 함수로 []로 읽고 줄을 렌더하지 않는다", () => {
		expect(unidentifiedMemberIdsFromLegacyData({})).toEqual([]);
		expect(unidentifiedMemberIdsFromLegacyData({ unidentified_member_ids: ["kim"] })).toEqual(["kim"]);
		const data = sampleData();
		const legacy = data as unknown as { units: Array<Partial<SessionUnit>> };
		delete legacy.units[0].unidentified_member_ids;
		expect(parseHTML(renderSession(data)).document.querySelector(".unidentified-members")).toBeNull();
	});
});

describe("참고자료 위계 · 링크 탭 영역", () => {
	test("제목은 600 굵기, 관련성 문장은 --muted, 항목 사이는 --space-3", () => {
		const data = sampleData();
		const li = parseHTML(renderSession(data)).document.querySelector("#u002 .refs-list li");
		expect(plain(li?.querySelector(".ref-title")?.textContent)).toBe("한국어 GK 훈련 자료");
		expect(STYLE).toMatch(/\.ref-title\s*\{[^}]*font-weight:\s*600/);
		expect(STYLE).toMatch(/\.ref-relevance\s*\{[^}]*color:\s*var\(--muted\)/);
		expect(STYLE).toMatch(/\.refs-list li \+ li\s*\{[^}]*margin-top:\s*var\(--space-3\)/);
	});

	test("요약·원문·시작 시각 링크는 ::after로 44px 이상 히트 영역을 가진다(카드와 참고자료 페이지)", () => {
		const data = sampleData();
		data.units[0].refs = [{ id: "r-en", title: "EN", lang: "en", kind: "tactics", href: "../../refs/r-en.html", orig_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", format: "video", relevance_ko: "관련", start_seconds: 245, version_badge: null, pro_clubs: false }];
		const links = [...parseHTML(renderSession(data)).document.querySelectorAll("#u001 .refs-list li a")];
		expect(links.map((a) => a.textContent)).toEqual(["요약", "자료 영상 4:05부터 ↗"]);
		expect(links.every((a) => a.classList.contains("ref-link"))).toBe(true);
		const page = parseHTML(renderRef({ id: "r-1", title: "제목", lang: "en", kind: "eafc", format: "article", url: "https://example.com", start_seconds: null, summary_ko: "요약", key_points_ko: [], translations: [] }));
		expect(page.document.querySelector(".plain-link a")?.classList.contains("ref-link")).toBe(true);
		expect(STYLE).toMatch(/\.ref-link\s*\{[^}]*position:\s*relative/);
		expect(STYLE).toMatch(/\.ref-link::after\s*\{[^}]*height:\s*44px/);
	});
});

describe("반복 지적 포함 관계 문구와 내 칩 틴트", () => {
	function twoOfThree(): SessionDataInput {
		const data = sampleData();
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u002", "u003"], member_ids: ["hong"] }];
		return data;
	}

	test("보이는 카드만 / 내가 고칠 것만 / 둘 다의 문구", () => {
		const { doc } = mountViewer(renderSession(twoOfThree()), false);
		const count = () => doc.querySelector(".recurring-count")?.textContent ?? "";
		clickChip(doc, "position", "FB"); // u001만 보임
		expect(count()).toBe("×3 · 보이는 카드 1");
		clickMinePill(doc, "hong"); // u001이 hong의 고칠 점
		expect(count()).toBe("×3 · 보이는 카드 1 (그중 내가 고칠 것 1)");
		const single = twoOfThree();
		single.recurring = [{ label: "혼자 반복", unit_ids: ["u001"], member_ids: ["hong"] }];
		const alone = mountViewer(renderSession(single), false).doc;
		clickMinePill(alone, "hong");
		expect(alone.querySelector(".recurring-count")?.textContent).toBe("×1 · 내가 고칠 것 1");
	});

	test("선택한 팀원이 고칠 카드의 칩만 .is-mine이고 선택을 풀면 사라진다", () => {
		const { doc } = mountViewer(renderSession(twoOfThree()), false);
		const mineIds = () => [...doc.querySelectorAll(".recurring-unit.is-mine")].map((el) => el.getAttribute("data-target"));
		expect(mineIds()).toEqual([]);
		clickMinePill(doc, "hong");
		expect(mineIds()).toEqual(["u001"]);
		clickMinePill(doc, "hong");
		expect(mineIds()).toEqual([]);
		expect(STYLE).toMatch(/\.recurring-unit\.is-mine\s*\{[^}]*background:\s*var\(--mine-tint\)/);
	});

	test("항목 주인이 다른 사람이면 카드에 지목돼 있어도 칩을 틴트하지 않는다", () => {
		const data = sampleData();
		data.recurring = [{ label: "최민수가 더 올라가지 않음", unit_ids: ["u001", "u003"], member_ids: ["choi"] }];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		expect(doc.querySelectorAll(".recurring-unit.is-mine").length).toBe(0);
	});
});

describe("아카이브 주제별 목록", () => {
	test("항목은 링크처럼 보이고(링크색·밑줄) 헤어라인 구분선과 고정 세로 패딩을 가진다", () => {
		expect(STYLE).toMatch(/#by-topic \.toc-item\s*\{[^}]*color:\s*var\(--accent\)/);
		expect(STYLE).toMatch(/#by-topic \.toc-item\s*\{[^}]*text-decoration:\s*underline/);
		expect(STYLE).toMatch(/#by-topic \.toc-item\s*\{[^}]*padding:\s*var\(--space-3\)/);
		expect(STYLE).toMatch(/#by-topic li\s*\{[^}]*border-bottom:\s*1px solid var\(--line\)/);
	});
});

describe("탭 타깃 목록 문서", () => {
	test("DESIGN §13 탭 타깃 목록에 참고자료 링크가 든다", () => {
		const design = readFileSync(new URL("./DESIGN.md", import.meta.url), "utf8");
		expect(design).toMatch(/\*\*탭 타깃\*\*[^]*?`\.ref-link`/);
	});
});

// ── 내 포지션 대상 · 링크/TOC/글루/대상 줄 보정 (DESIGN §5-2, §5-6, §6, §6a, §8, §10, §13) ─────────────

describe("내 포지션 대상 그룹 (DESIGN §6)", () => {
	/** hong(CB) 기준 다섯 종류: u001 고칠 점 / u004 내 포지션 대상 / u005 이름이 나온 장면 / u006 전원 대상 / u007 같은 포지션 참고. */
	function positionTargetData(): SessionDataInput {
		const data = sampleData();
		const extra = (id: string, overrides: Partial<TestUnit>): TestUnit =>
			baseUnit({ id, uid: `20240104-NUzEChn9EyI#${id}`, start: 200, end: 210, topic_tags: ["전환"], ...overrides });
		const related = (memberIds: string[], tags: string[]) => relatedMembers({ member_ids: memberIds, position_tags: tags }, ROSTER, null).map((m) => m.id);
		data.units.push(
			extra("u004", { title: "수비 라인이 맞지 않음", position_tags: ["DF", "CB"], member_ids: [], related_member_ids: related([], ["DF", "CB"]) }),
			extra("u005", { position_tags: ["ST"], member_ids: ["choi"], named_member_ids: ["hong"], related_member_ids: related(["choi"], ["ST"]) }),
			extra("u006", { position_tags: [], member_ids: [], addressed_to_all: true, related_member_ids: [] }),
			extra("u007", { position_tags: ["CB"], member_ids: ["choi"], related_member_ids: related(["choi"], ["CB"]) }),
		);
		return data;
	}

	test("선택 시 고칠 점 → 이름이 나온 장면 → 내 포지션 대상 → 전원 대상 → 같은 포지션 참고 순으로 묶이고 배지가 같다", () => {
		const { doc } = mountViewer(renderSession(positionTargetData()), false);
		clickMinePill(doc, "hong");
		expect(cardListOrder(doc)).toEqual([
			"H:고칠 점 1", "C:u001",
			"H:이름이 나온 장면 1", "C:u005",
			"H:내 포지션 대상 1", "C:u004",
			"H:전원 대상 1", "C:u006",
			"H:같은 포지션 참고 1", "C:u007",
		]);
		const badge = (id: string) => doc.getElementById(id)?.querySelector(".mention-badge");
		expect(["u001", "u005", "u004", "u006", "u007"].map((id) => badge(id)?.textContent)).toEqual([
			"고칠 점", "이름이 나온 장면", "내 포지션 대상", "전원 대상", "같은 포지션 참고",
		]);
		expect(badge("u004")?.classList.contains("mention-position-target")).toBe(true);
	});

	function cardListOrder(doc: Document): string[] {
		return [...(doc.querySelector(".card-list")?.children ?? [])]
			.filter((el) => !el.hasAttribute("hidden"))
			.map((el) => (el.classList.contains("mine-group-heading") ? `H:${el.textContent}` : `C:${el.id}`));
	}

	test("pill 큰 숫자는 개인 고칠 점만, '· 팀 N'은 내 포지션 대상 + 전원 대상, '· 참고 N'은 나머지이며 셋의 합은 선택 결과 수와 같다", () => {
		const { doc } = mountViewer(renderSession(positionTargetData()), false);
		const hong = doc.querySelector('.pill-mine[data-value="hong"]');
		expect(hong?.querySelector(".count")?.textContent).toBe("1"); // u001
		expect(hong?.querySelector(".count-team")?.textContent).toBe("· 팀 2"); // u004(내 포지션 대상) + u006(전원 대상)
		expect(hong?.querySelector(".count-ref")?.textContent).toBe("· 참고 2"); // u005 + u007
		expect(hong?.textContent?.replace(/\s+/g, " ").trim()).toBe("홍길동 1· 팀 2· 참고 2");
		clickMinePill(doc, "hong");
		expect(doc.getElementById("visible-count")?.textContent).toBe("5");
		// choi(ST)는 u003·u005·u007의 member_ids에 있고, 수비 라인 유닛(u004)은 ST와 무관해 주 숫자에 들지 않는다.
		const choi = doc.querySelector('.pill-mine[data-value="choi"]');
		expect(choi?.querySelector(".count")?.textContent).toBe("3"); // u003 + u005 + u007
		expect(choi?.querySelector(".count-team")?.textContent).toBe("· 팀 1"); // u006(전원 대상, 모든 팀원에게 적용)
	});

	test("카드는 포지션 대상 팀원 id를 data-position-target-ids로 싣고, 이름이 불린 유닛은 비운다", () => {
		const doc = parseHTML(renderSession(positionTargetData())).document;
		expect(doc.getElementById("u004")?.getAttribute("data-position-target-ids")).toBe("hong|kim");
		expect(doc.getElementById("u007")?.getAttribute("data-position-target-ids")).toBe("");
	});

	function recurringPositionData(ownerIds: string[]): SessionDataInput {
		const data = positionTargetData();
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u004"], member_ids: ownerIds }];
		return data;
	}

	test("반복 지적은 주인이 없는 항목에서 카드에 지목돼 있어도 칩 주인이 아니면 '내가 고칠 것'으로 세지 않고, '내 포지션 대상'만 센다", () => {
		const { doc } = mountViewer(renderSession(recurringPositionData([])), false);
		clickMinePill(doc, "hong");
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×2 · 내 포지션 대상 1");
		expect([...doc.querySelectorAll(".recurring-unit.is-mine")].map((el) => el.getAttribute("data-target"))).toEqual(["u004"]);
	});

	test("포지션 대상으로만 닿는 항목은 '내가 고칠 것' 없이 '내 포지션 대상 N'만 보이고, 필터로 가리면 보이는 칩 안에서 센다", () => {
		const data = recurringPositionData([]);
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u004", "u008"], member_ids: [] }];
		data.units.push(
			baseUnit({ id: "u008", uid: "20240104-NUzEChn9EyI#u008", start: 300, end: 310, topic_tags: ["빌드업"], title: "수비 라인이 맞지 않음", position_tags: ["DF", "CB"], member_ids: [], position_target_ids: ["hong", "kim"], related_member_ids: ["hong", "kim"] }),
		);
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×2 · 내 포지션 대상 2");
		clickChip(doc, "topic", "빌드업"); // u004(전환)가 가려지고 u008(빌드업)만 보인다
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×2 · 보이는 카드 1 (그중 내 포지션 대상 1)");
	});

	test("반복 지적에 주인이 있으면 주인의 고칠 점 카드만 세고 내 포지션 대상 카드는 세지 않는다", () => {
		const { doc } = mountViewer(renderSession(recurringPositionData(["hong"])), false);
		clickMinePill(doc, "hong");
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×2 · 내가 고칠 것 1");
		expect([...doc.querySelectorAll(".recurring-unit.is-mine")].map((el) => el.getAttribute("data-target"))).toEqual(["u001"]);
	});
});

describe("참고자료 링크 0초", () => {
	const refBase = { id: "r-v", title: "강의", lang: "ko", kind: "tactics" as const, href: null, orig_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", format: "video" as const, relevance_ko: "관련", version_badge: null, pro_clubs: false };

	test("start_seconds가 0이면 카드 링크는 '원문 ↗'이다", () => {
		const data = sampleData();
		data.units[0].refs = [{ ...refBase, start_seconds: 0 }];
		const link = parseHTML(renderSession(data)).document.querySelector("#u001 .refs-list li a.ref-link");
		expect(link?.textContent).toBe("원문 ↗");
	});

	test("start_seconds가 0이면 참고자료 페이지 링크도 '원문 ↗'이다", () => {
		const page = renderRef({ id: "r-1", title: "제목", lang: "en", kind: "eafc", format: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", start_seconds: 0, summary_ko: "요약", key_points_ko: [], translations: [] });
		expect(parseHTML(page).document.querySelector(".plain-link a")?.textContent).toBe("원문 ↗");
	});
});

describe("TOC 주제별 그룹 개수는 보이는 항목 수를 따른다 (DESIGN §8)", () => {
	test("필터가 항목을 숨기면 그룹 제목의 숫자가 보이는 항목 수로 바뀌고 해제하면 돌아온다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		const group = () => [...doc.querySelectorAll("#panel-topic .toc-tag-group")].find((g) => plain(g.querySelector("h2")?.textContent).startsWith("빌드업"));
		expect(plain(group()?.querySelector("h2")?.textContent)).toBe("빌드업 (2)");
		clickChip(doc, "position", "FB"); // u001만 남는다
		expect(plain(group()?.querySelector("h2")?.textContent)).toBe("빌드업 (1)");
		expect(group()?.querySelector(".toc-group-count")?.textContent).toBe("1");
		clickChip(doc, "position", "FB");
		expect(plain(group()?.querySelector("h2")?.textContent)).toBe("빌드업 (2)");
	});
});

describe("CSS 보정", () => {
	test("TOC 시간 칩은 h:mm:ss가 들어가도록 min-width 8ch", () => {
		expect(STYLE).toMatch(/\.toc-item \.chip-time\s*\{[^}]*min-width:\s*8ch[^}]*tabular-nums/);
	});

	test("번역 표 td도 text-wrap: pretty 규칙에 든다", () => {
		expect(STYLE).toMatch(/\.translations-table td[^{}]*\{[^}]*text-wrap:\s*pretty/);
	});

	test(".title-part와 그 부모 .toc-title은 링크 밑줄이 이어지도록 text-decoration: inherit", () => {
		expect(STYLE).toMatch(/\.title-part\s*\{[^}]*text-decoration:\s*inherit/);
		expect(STYLE).toMatch(/\.toc-item \.toc-title\s*\{[^}]*text-decoration:\s*inherit/);
	});

	test("링크 전용 세션의 카드는 cursor: pointer를 쓰지 않는다", () => {
		expect(STYLE).toMatch(/body\[data-link-only\] \.card[^{}]*\{[^}]*cursor:\s*(auto|default)/);
	});
});

describe("제목 글루 — 버전 표기와 짧은 괄호 묶음 (DESIGN §10)", () => {
	const titleText = (title: string) => {
		const data = sampleData();
		data.units[0].title = title;
		return parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector("h3")?.textContent ?? "";
	};

	test("'FC 26'·'FIFA 23'은 계열과 숫자를 NBSP로 묶는다", () => {
		expect(titleText("FC 26 수비 설정")).toContain(`FC${NBSP}26 `);
		expect(titleText("FIFA 23 에서 달라진 점")).toContain(`FIFA${NBSP}23 `);
	});

	test("괄호 안쪽 공백은 일반 공백으로 두어 괄호 묶음이 한 덩어리로 줄바꿈 불가가 되지 않는다", () => {
		expect(titleText("공수 균형 (Offense & Defense) 정리")).toContain("(Offense & Defense)");
		expect(titleText("뎁스차저(DEPSCHARGER 이름표)가 공을 받음")).toContain("뎁스차저\u2060(DEPSCHARGER 이름표)\u2060가");
	});
});

describe("댓글 작성자 표기 위치", () => {
	test("모든 유닛의 작성자가 같은 한 명이어도 세션 헤더에 한 번, 카드마다 한 번씩 보인다(카드마다 작성자 표시)", () => {
		const data = sampleData();
		for (const unit of data.units) unit.comment_author_names = ["뎁스차저"];
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelector(".header .feedback-source")?.textContent).toBe("댓글 작성 · 뎁스차저");
		const cards = [...doc.querySelectorAll("article.card")];
		expect(cards.length).toBe(3);
		for (const card of cards) {
			expect(card.querySelectorAll(".card-source").length).toBe(1);
			expect(plain(card.querySelector(".card-source")?.textContent)).toBe("· 댓글 작성 뎁스차저");
		}
		expect(doc.querySelectorAll(".feedback-source").length).toBe(1);
	});

	test("낭독(댓글 아닌) 유닛에는 작성자 줄이 없다", () => {
		const data = sampleData();
		data.units[0].comment_author_names = ["뎁스차저"];
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelector("#u001 .card-source")).not.toBeNull();
		expect(doc.querySelector("#u002 .card-source")).toBeNull();
	});

	test("작성자가 다르거나 일부 유닛이 비어 있거나 여러 명이면 카드마다 보이고 헤더에는 없다", () => {
		const data = sampleData();
		data.units[0].comment_author_names = ["뎁스차저"];
		data.units[1].comment_author_names = ["maker654"];
		data.units[2].comment_author_names = ["뎁스차저"];
		const mixed = parseHTML(renderSession(data)).document;
		expect(mixed.querySelector(".header .feedback-source")).toBeNull();
		expect(mixed.querySelectorAll(".card .card-source").length).toBe(3);
		data.units[1].comment_author_names = ["뎁스차저"];
		data.units[2].comment_author_names = [];
		const partial = parseHTML(renderSession(data)).document;
		expect(partial.querySelector(".header .feedback-source")).toBeNull();
		expect(partial.querySelectorAll(".card .card-source").length).toBe(2);
		for (const unit of data.units) unit.comment_author_names = ["뎁스차저", "maker654"];
		const multi = parseHTML(renderSession(data)).document;
		expect(multi.querySelector(".header .feedback-source")).toBeNull();
		expect(multi.querySelectorAll(".card .card-source").length).toBe(3);
	});
});

describe("언급 줄에서 이미 보인 이름 제외 (DESIGN §5-6)", () => {
	const line = (data: SessionDataInput) => plain(parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector(".named-members")?.textContent);

	test("포지션 대상 줄에 이미 보인 이름은 '언급:' 줄에서 뺀다", () => {
		const data = sampleData();
		data.units[0].member_ids = [];
		data.units[0].position_tags = ["DF", "CB"];
		data.units[0].position_target_ids = ["kim", "hong"];
		data.units[0].named_member_ids = ["hong", "park"];
		expect(line(data)).toBe("언급: 박영희");
	});

	test("고칠 사람 줄과 포지션 대상 줄에 모두 보인 이름뿐이면 '언급:' 줄이 없다", () => {
		const data = sampleData();
		data.units[0].member_ids = ["hong"];
		data.units[0].position_target_ids = ["kim"];
		data.units[0].named_member_ids = ["hong", "kim"];
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		expect(card?.querySelector(".named-members")).toBeNull();
		expect(plain(card?.querySelector(".mentioned-members:not(.named-members)")?.textContent)).toBe("고칠 사람: 홍길동 · 대상(FB): 김철수");
	});
});

describe("대상 줄 — 포지션과 지정 대상 (DESIGN §5-6)", () => {
	const card = (data: SessionDataInput) => parseHTML(renderSession(data)).document.getElementById("u001");

	test("고칠 사람 줄이 보이고 포지션이 모두 태그 행에 보이면 '대상: 포지션' 줄은 태그 칩과 겹치므로 생략한다", () => {
		const data = sampleData();
		data.units[0].member_ids = ["hong"];
		data.units[0].position_tags = ["DF"];
		const c = card(data);
		expect(c?.querySelector(".mentioned-members")?.textContent).toBe("고칠 사람: 홍길동");
		expect(c?.querySelector(".target-position-line")).toBeNull();
	});

	test("고칠 사람이 없고 포지션 대상 이름도 없으면 '대상: 포지션' 줄이 남는다", () => {
		const data = sampleData();
		data.units[0].member_ids = [];
		data.units[0].position_target_ids = [];
		data.units[0].position_tags = ["DF"];
		expect(plain(card(data)?.querySelector(".target-position-line")?.textContent)).toBe("대상: DF");
	});

	test("명단이 없으면(disabled) 고칠 사람 줄이 없으므로 '대상: 포지션' 줄이 남는다", () => {
		const data = sampleData();
		data.members = [];
		data.units[0].position_tags = ["DF"];
		expect(plain(card(data)?.querySelector(".target-position-line")?.textContent)).toBe("대상: DF");
	});

	test("포지션 태그가 태그 행의 6개 상한을 넘으면 고칠 사람이 있어도 '대상: 포지션' 줄이 전체 목록을 보인다", () => {
		const data = sampleData();
		data.units[0].position_tags = ["GK", "CB", "FB", "WB", "CM", "CAM", "ST"];
		expect(plain(card(data)?.querySelector(".target-position-line")?.textContent)).toBe("대상: GK, CB, FB, WB, CM, CAM, ST");
	});

	test("addressed_to_all인데 제목 앞(첫 ':' 앞)이 '전원'이 아니면 그 문구를 대상으로 보인다", () => {
		const data = sampleData();
		data.units[0].addressed_to_all = true;
		data.units[0].title = "키 작은 선수: 헤딩 경합을 피함";
		expect(plain(card(data)?.querySelector(".addressed-all-line")?.textContent)).toBe("대상: 키 작은 선수");
		data.units[0].title = "전원: 간격을 좁힘";
		expect(plain(card(data)?.querySelector(".addressed-all-line")?.textContent)).toBe("대상: 전원");
		data.units[0].title = "콜론 없는 제목";
		expect(plain(card(data)?.querySelector(".addressed-all-line")?.textContent)).toBe("대상: 전원");
	});
});

// ── 시각 리뷰 결함 수정 (DESIGN §4, §5, §6, §13, §15) ────────────────────────

describe("시각 리뷰 결함 수정", () => {
	function wideData(focusX?: number): SessionDataInput {
		const data = sampleData();
		data.units[2].body = [
			{ type: "frame", src: "img/u003-c001.webp", width: 1920, height: 540, t: 105, caption: "초광각", ...(focusX === undefined ? {} : { focus_x: focusX }) },
		];
		data.units[1].images.start = { src: "img/u002-start.webp", width: 1920, height: 540 };
		return data;
	}
	function mountBoxes(data: SessionDataInput, scrollWidth: number, clientWidth: number) {
		const dom = parseHTML(renderSession(data));
		const box = dom.document.querySelector("#u003 .body-frame .frame-pan-scroll") as unknown as { scrollLeft: number };
		for (const el of dom.document.querySelectorAll(".frame-pan-scroll")) {
			Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
			Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
		}
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		runViewer(win, { Player: StubPlayer, loaded: false });
		return box;
	}

	test("panCenterFromFocus는 focus_x가 없으면 가운데(0.5), 있으면 그 값을 쓴다", () => {
		expect(panCenterFromFocus(undefined)).toBe(0.5);
		expect(panCenterFromFocus(0.2)).toBe(0.2);
		expect(panCenterFromFocus(0)).toBe(0);
	});

	test("이동 상자는 data-pan-center에 focus_x를 담고, 없는 프레임과 시작 이미지는 0.5를 담는다", () => {
		const withFocus = parseHTML(renderSession(wideData(0.8))).document;
		expect(withFocus.querySelector("#u003 .body-frame .frame-pan-scroll")?.getAttribute("data-pan-center")).toBe("0.8");
		expect(withFocus.querySelector("#u002 .card-image .frame-pan-scroll")?.getAttribute("data-pan-center")).toBe("0.5");
		const without = parseHTML(renderSession(wideData())).document;
		expect(without.querySelector("#u003 .body-frame .frame-pan-scroll")?.getAttribute("data-pan-center")).toBe("0.5");
	});

	test("VIEWER_JS는 상자 시작 위치를 focus_x 지점이 가운데 오도록 맞추고 양 끝에서 자른다", () => {
		expect(mountBoxes(wideData(0.6), 1067, 612).scrollLeft).toBe(0.6 * 1067 - 612 / 2);
		expect(mountBoxes(wideData(0.99), 1067, 612).scrollLeft).toBe(1067 - 612);
		expect(mountBoxes(wideData(0), 1067, 612).scrollLeft).toBe(0);
		expect(mountBoxes(wideData(), 1067, 612).scrollLeft).toBe((1067 - 612) / 2);
	});

	test("≤640px에서 캡션은 시간 칩·확대 줄 아래 전체 폭 자기 줄을 갖는다", () => {
		const media = [...STYLE.matchAll(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g)].map((m) => m[0]).join("\n");
		expect(media).toMatch(/\.body-frame figcaption\s*\{[^}]*grid-template-columns:\s*auto 1fr/);
		expect(media).toMatch(/\.body-frame-caption\s*\{[^}]*grid-column:\s*1 \/ -1/);
		expect(media).toMatch(/\.zoom-link\s*\{[^}]*grid-column:\s*2/);
	});

	test(".zoom-link와 .watch-link는 44px ::after 히트 영역을, 반복 지적 시간 칩은 min-height 44px를 갖는다", () => {
		expect(STYLE).toMatch(/\.zoom-link\s*\{[^}]*position:\s*relative/);
		expect(STYLE).toMatch(/\.zoom-link::after\s*\{[^}]*width:\s*max\(100%,\s*44px\)[^}]*height:\s*44px/);
		expect(STYLE).toMatch(/\.watch-link\s*\{[^}]*position:\s*relative/);
		expect(STYLE).toMatch(/\.watch-link::after\s*\{[^}]*width:\s*max\(100%,\s*44px\)[^}]*height:\s*44px/);
		expect(STYLE).toMatch(/\.recurring-unit\s*\{[^}]*min-height:\s*44px/);
	});

	test("카드 하단 링크는 '경기 영상 m:ss부터 보기 ↗'로 유닛 시작 시각을 말한다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		expect(doc.querySelector("#u001 a.watch-link")?.textContent).toBe("경기 영상 12:34부터 보기 ↗");
		expect(doc.querySelector("#u002 a.watch-link")?.textContent).toBe("경기 영상 1:02:05부터 보기 ↗");
	});

	test("내 피드백 pill의 title이 주 숫자와 참고가 세는 그룹을 설명한다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const title = doc.querySelector(".pill-mine")?.getAttribute("title") ?? "";
		expect(title).toContain("숫자: 내가 고칠 점");
		expect(title).toContain("팀: 내 포지션 대상 + 전원 대상");
		expect(title).toContain("이름이 나온 장면 + 같은 포지션 참고");
	});

	test("브레드크럼은 text-wrap: balance로 마지막 단어가 홀로 줄바꿈되지 않는다", () => {
		expect(STYLE).toMatch(/\.breadcrumb\s*\{[^}]*text-wrap:\s*balance/);
	});
});

// ── 리뷰어 지적 수정 라운드 (DESIGN §4, §5, §6, §6a, §10, §13) ───────────────────

describe("대상(포지션) 줄 — 포지션 대상과 같은 포지션 참고의 분리 (DESIGN §5-6/§5-8)", () => {
	test("position_target_ids는 '대상(포지션): 이름' 줄에 오고 '같은 포지션:' 줄에서는 빠진다", () => {
		const data = sampleData();
		data.units[0].member_ids = ["hong"];
		data.units[0].position_tags = ["DF", "CB"];
		data.units[0].position_target_ids = ["kim", "choi"];
		data.units[0].related_member_ids = ["hong", "kim", "choi", "park"];
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		// 고칠 사람이 있으면 같은 줄에 " · 대상(포지션): 이름"으로 이어진다(별도 줄 없음)
		expect(plain(card?.querySelector(".mentioned-members")?.textContent)).toBe("고칠 사람: 홍길동 · 대상(DF, CB): 김철수, 최민수");
		expect(card?.querySelector(".position-target-members")).toBeNull();
		expect(card?.querySelector("p.related-members")?.textContent).toBe("같은 포지션: 박영희");
	});

	test("고칠 사람이 없으면 대상 줄이 따로 서고, 대상이 6명 이상이면 고칠 사람이 있어도 <details> 줄이 따로 선다", () => {
		const alone = sampleData();
		alone.units[0].member_ids = [];
		alone.units[0].position_target_ids = ["kim", "choi"];
		expect(plain(parseHTML(renderSession(alone)).document.querySelector("#u001 .position-target-members")?.textContent)).toBe("대상(FB): 김철수, 최민수");
		const many = sampleData();
		many.members = [...many.members, ...["a1", "a2", "a3"].map((id) => ({ id, name: id, gamertag: id, positions: ["CB"] }))];
		many.units[0].member_ids = ["hong"];
		many.units[0].position_target_ids = ["kim", "park", "choi", "a1", "a2", "a3"];
		const card = parseHTML(renderSession(many)).document.getElementById("u001");
		expect(plain(card?.querySelector("p.mentioned-members")?.textContent)).toBe("고칠 사람: 홍길동");
		expect(card?.querySelector("details.position-target-members")).not.toBeNull();
	});

	test("합친 줄의 '·'는 줄 끝이 아니라 다음 조각의 머리에 붙는다", () => {
		const data = sampleData();
		data.units[0].member_ids = ["hong"];
		data.units[0].position_target_ids = ["kim"];
		const part = parseHTML(renderSession(data)).document.querySelector("#u001 .mentioned-members .position-target-part");
		expect(part?.textContent?.startsWith("·\u00a0대상(FB):")).toBe(true);
		expect(STYLE).toMatch(/\.position-target-part\s*\{[^}]*display:\s*inline-block/);
	});

	test("position_target_ids가 6명 이상이면 같은 포지션 줄처럼 <details>로 접힌다", () => {
		const data = sampleData();
		data.members = [...data.members, ...["a1", "a2", "a3"].map((id) => ({ id, name: id, gamertag: id, positions: ["CB"] }))];
		data.units[0].position_target_ids = ["hong", "kim", "park", "choi", "a1", "a2"];
		const details = parseHTML(renderSession(data)).document.querySelector("#u001 details.position-target-members");
		expect(details?.querySelector("summary")?.textContent).toContain("대상(FB): 홍길동, 김철수, 박영희, 최민수 외 2명");
	});
});

describe("배지에 이름 나옴 병기 (DESIGN §5-3)", () => {
	test("내 포지션 대상이면서 이름도 나온 카드는 두 사실을 함께 보인다", () => {
		const data = sampleData();
		data.units[0].member_ids = [];
		data.units[0].position_target_ids = ["kim"];
		data.units[0].named_member_ids = ["kim"];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "kim");
		const badge = doc.getElementById("u001")?.querySelector(".mention-badge");
		expect(badge?.textContent).toBe("내 포지션 대상 · 이름 나옴");
		expect(badge?.classList.contains("mention-position-target")).toBe(true);
	});

	test("전원 대상이면서 이름도 나온 카드는 '전원 대상 · 이름 나옴'이고, 이름이 안 나왔으면 접미사가 없다", () => {
		const data = sampleData();
		data.units[0].member_ids = [];
		data.units[0].position_target_ids = [];
		data.units[0].addressed_to_all = true;
		data.units[0].named_member_ids = ["kim"];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "kim");
		expect(doc.getElementById("u001")?.querySelector(".mention-badge")?.textContent).toBe("전원 대상 · 이름 나옴");
		clickMinePill(doc, "kim");
		clickMinePill(doc, "park");
		expect(doc.getElementById("u001")?.querySelector(".mention-badge")?.textContent).toBe("전원 대상");
	});

	test("고칠 점 배지에는 이름 나옴을 붙이지 않는다", () => {
		const data = sampleData();
		data.units[0].named_member_ids = ["hong"];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		expect(doc.getElementById("u001")?.querySelector(".mention-badge")?.textContent).toBe("고칠 점");
	});
});

describe("반복 지적 행 — 주인 이름과 추천 자료 없음 (DESIGN §6a)", () => {
	function withRecurring(entries: Array<{ member_ids?: string[]; refs_unfound?: boolean }>): SessionDataInput {
		const data = sampleData();
		data.recurring = entries.map((entry, index) => ({ label: `라벨${index}`, unit_ids: ["u001", "u003"], ...entry }));
		return data;
	}

	/** One recurring row over u001 and u003 with the given unit titles/fixers; returns the row's chips. */
	function chipsFor(entry: { member_ids: string[] }, u001: { title: string; member_ids: string[] }, u003: { title: string; member_ids: string[] }) {
		const data = sampleData();
		Object.assign(data.units[0], u001);
		Object.assign(data.units[2], u003);
		data.recurring = [{ label: "상대 마크를 놓침", unit_ids: ["u001", "u003"], ...entry }];
		const doc = parseHTML(renderSession(data)).document;
		return { doc, chips: [...doc.querySelectorAll(".recurring-item .recurring-unit")] };
	}

	test("행에는 주인 목록을 두지 않고, 시간 칩마다 그 유닛의 주인을 시간 뒤에 보인다: 고칠 사람이 없는 유닛은 제목의 행위자, 있는 유닛은 고칠 사람 이름", () => {
		const { doc, chips } = chipsFor(
			{ member_ids: ["hong"] },
			{ title: "수비진: 상대 역습 때 마크 놓침", member_ids: [] },
			{ title: "홍길동: 마크 놓침", member_ids: ["hong"] },
		);
		expect(doc.querySelector(".recurring-owners")).toBeNull();
		expect(chips.map((chip) => chip.textContent)).toEqual(["12:34 수비진", "1:40 홍길동"]);
		expect(chips.map((chip) => chip.querySelector(".recurring-unit-owner")?.textContent)).toEqual(["수비진", "홍길동"]);
		expect(doc.querySelector(".recurring-item")?.getAttribute("data-label-owner-ids")).toBe("hong");
		expect(doc.querySelector(".recurring-item")?.getAttribute("data-owner-ids")).toBe("hong|kim"); // 팀 단위 칩 "수비진"의 포지션 구성원 kim이 더해진다
	});

	test("라벨 주인이 없으면 제목에서 로스터 선수가 아닌 행위자만 칩에 쓴다(제목 안 선수 이름은 쓰지 않는다)", () => {
		const data = sampleData();
		Object.assign(data.units[0], { title: "수비 라인: 맞지 않음 / 홍길동: 첫판부터 정신 놓음", member_ids: ["hong"] });
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u003"], member_ids: [] }];
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelector(".recurring-unit[data-target='u001']")?.textContent).toBe("12:34 수비 라인");
	});

	test("라벨 주인이 없고 제목에 비-팀원 행위자도 없으면 유닛의 고칠 사람 이름을 칩에 쓰되 '내가 고칠 것'은 세지 않는다", () => {
		const data = sampleData();
		Object.assign(data.units[0], { title: "홍길동: AI 격수 마크를 놓침", member_ids: ["hong"] });
		data.recurring = [{ label: "상대 마크를 놓침", unit_ids: ["u001", "u003"], member_ids: [] }];
		const doc = parseHTML(renderSession(data)).document;
		const chip = doc.querySelector(".recurring-unit[data-target='u001']");
		expect(chip?.textContent).toBe("12:34 홍길동");
		expect(chip?.querySelector(".recurring-unit-owner")?.textContent).toBe("홍길동");
		expect(chip?.getAttribute("data-fixer-ids")).toBe("");
		expect(chip?.getAttribute("aria-label")).toBe("12:34 홍길동 — 홍길동: AI 격수 마크를 놓침");
	});

	test("라벨 주인이 없고 제목에 비-팀원 행위자가 있으면 그 행위자가 고칠 사람 이름보다 먼저다", () => {
		const data = sampleData();
		Object.assign(data.units[0], { title: "수비진: 마크를 놓침", member_ids: ["hong"] });
		data.recurring = [{ label: "상대 마크를 놓침", unit_ids: ["u001", "u003"], member_ids: [] }];
		const chip = parseHTML(renderSession(data)).document.querySelector(".recurring-unit[data-target='u001']");
		expect(chip?.textContent).toBe("12:34 수비진");
	});

	test("라벨 주인이 둘이고 유닛의 고칠 사람이 둘 다 주인이면 칩에 이름을 ·로 잇는다", () => {
		const { chips } = chipsFor(
			{ member_ids: ["hong", "kim"] },
			{ title: "홍길동·김철수: 마크 놓침", member_ids: ["hong", "kim"] },
			{ title: "홍길동: 마크 놓침", member_ids: ["hong", "choi"] },
		);
		expect(chips.map((chip) => chip.querySelector(".recurring-unit-owner")?.textContent)).toEqual(["홍길동·김철수", "홍길동"]);
	});

	test("칩의 aria-label은 보이는 시간·주인으로 시작해 유닛 제목까지 읽히고, 주인이 없는 칩은 시간과 제목만 읽는다", () => {
		const { chips } = chipsFor(
			{ member_ids: [] },
			{ title: "수비진: 상대 역습 때 마크 놓침", member_ids: [] },
			{ title: "홍길동: 마크 놓침", member_ids: [] },
		);
		expect(chips[0].getAttribute("aria-label")).toBe("12:34 수비진 — 수비진: 상대 역습 때 마크 놓침");
		expect(chips[1].getAttribute("aria-label")).toBe("1:40 홍길동: 마크 놓침");
		expect(chips[1].querySelector(".recurring-unit-owner")).toBeNull();
	});

	test("주인이 붙은 칩은 44px 탭 영역을 지키면서 좁은 폭에서 줄바꿈할 수 있다", () => {
		const rule = STYLE.match(/\n\.recurring-unit\s*\{[^}]*\}/)?.[0] ?? "";
		expect(rule).toMatch(/min-height:\s*44px/);
		expect(rule).toMatch(/white-space:\s*normal/);
		expect(rule).toMatch(/max-width:\s*100%/);
		expect(rule).toMatch(/gap:\s*var\(--space-1\)/);
		expect(STYLE).toMatch(/\n\.recurring-unit-owner\s*\{[^}]*overflow-wrap:\s*anywhere/);
	});

	test("칩의 주인 이름은 내 피드백 선택으로 ×N 문구가 다시 쓰여도 남는다", () => {
		const data = sampleData();
		data.recurring = [{ label: "최민수가 더 올라가지 않음", unit_ids: ["u001", "u003"], member_ids: ["hong"] }];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		expect(doc.querySelector(".recurring-count")?.textContent).toContain("내가 고칠 것");
		expect(doc.querySelector(".recurring-unit[data-target='u001'] .recurring-unit-owner")?.textContent).toBe("홍길동");
	});

	test("내가 고칠 것은 칩의 주인이 그 팀원일 때만 센다: 행위자가 팀 단위인 칩은 고칠 점 카드에 팀원이 있어도 세지 않고 is-mine도 아니다", () => {
		const data = sampleData();
		Object.assign(data.units[0], { title: "수비 라인: 맞지 않음 / 홍길동: 첫판부터 정신 놓음", member_ids: ["hong"] });
		Object.assign(data.units[2], { title: "홍길동: 마크 놓침", member_ids: ["hong"], related_member_ids: ["hong"] });
		data.recurring = [
			{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u003"], member_ids: [] },
			{ label: "마크를 놓침", unit_ids: ["u001", "u003"], member_ids: ["hong"] },
		];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		// 선택하면 내가 고칠 것이 있는 행이 앞으로 오므로 순서가 아니라 라벨로 찾는다. 이 data는 group_member_ids가 없는 옛 형식이라 팀 단위 칩은 내 포지션 대상도 아니다.
		const rowOf = (label: string) => [...doc.querySelectorAll(".recurring-item")].find((row) => plain(row.querySelector(".recurring-label")?.textContent) === label) as Element;
		const [team, owned] = [rowOf("수비 라인이 맞지 않음"), rowOf("마크를 놓침")];
		expect(plain(doc.querySelector(".recurring-item .recurring-label")?.textContent)).toBe("마크를 놓침");
		expect(team.querySelector(".recurring-count")?.textContent).toBe("×2");
		expect(team.querySelectorAll(".recurring-unit.is-mine").length).toBe(0);
		expect(owned.querySelector(".recurring-count")?.textContent).toBe("×2 · 내가 고칠 것 2");
		expect(owned.querySelectorAll(".recurring-unit.is-mine").length).toBe(2);
		expect(owned.querySelector(".recurring-unit[data-target='u001']")?.getAttribute("data-fixer-ids")).toBe("hong");
		expect(team.querySelector(".recurring-unit[data-target='u001']")?.getAttribute("data-fixer-ids")).toBe("");
	});

	test("refs_unfound가 true인 행만 '추천 자료 없음' 표시를 달고, 필드가 없는 옛 데이터는 표시가 없다", () => {
		const doc = parseHTML(renderSession(withRecurring([{ refs_unfound: true }, { refs_unfound: false }, {}]))).document;
		const rows = [...doc.querySelectorAll(".recurring-item")];
		expect(rows.map((row) => row.querySelector(".recurring-unfound")?.textContent ?? null)).toEqual(["추천 자료 없음", null, null]);
	});

	test("refsUnfoundFromLegacyData는 필드가 없으면 false, 있으면 그 값이다", () => {
		expect(refsUnfoundFromLegacyData({})).toBe(false);
		expect(refsUnfoundFromLegacyData({ refs_unfound: true })).toBe(true);
	});

	test("≤640px에서는 시간 칩의 가로·세로 간격을 4px로 줄인다", () => {
		const media = [...STYLE.matchAll(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g)].map((m) => m[0]).join("\n");
		expect(media).toMatch(/\.recurring-unit\s*\{[^}]*margin:\s*0 var\(--space-1\) var\(--space-1\) 0/);
	});
});

describe("피드백 없는 경기 (DESIGN §4)", () => {
	test("카드 흐름에 자리가 없는 matches_without_feedback(맨 뒤 순번)는 muted 한 줄씩 카드 목록 뒤에 렌더한다", () => {
		const data = sampleData();
		data.matches_without_feedback = ["2경기 · LVT 대 AL", "3경기 · 연습"];
		const doc = parseHTML(renderSession(data)).document;
		const lines = [...doc.querySelectorAll(".main > .matches-without-feedback > .match-no-feedback")].map((el) => plain(el.textContent));
		expect(lines).toEqual(["2경기 · LVT 대 AL — 피드백 없음", "3경기 · 연습 — 피드백 없음"]);
		expect(doc.querySelector(".card-list")?.nextElementSibling?.className).toBe("matches-without-feedback");
	});

	test("비어 있거나 필드가 없는 옛 데이터는 블록 자체를 렌더하지 않는다", () => {
		expect(parseHTML(renderSession(sampleData())).document.querySelector(".matches-without-feedback")).toBeNull();
		expect(matchesWithoutFeedbackFromLegacyData({})).toEqual([]);
		expect(matchesWithoutFeedbackFromLegacyData({ matches_without_feedback: ["a"] })).toEqual(["a"]);
	});
});

describe("작성자 본인 지적 표시 (DESIGN §5-6)", () => {
	test("self_critique_member_ids의 이름은 '고칠 사람' 줄에서 이름 바로 뒤에 '(작성자 본인)'을 붙이고 별도 줄은 없다", () => {
		const data = sampleData();
		data.units[0].member_ids = ["hong", "kim"];
		data.units[0].comment_author_names = ["홍길동"];
		data.units[0].self_critique_member_ids = ["hong"];
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		const line = card?.querySelector(".mentioned-members:not(.named-members):not(.position-target-members)");
		expect(plain(line?.textContent)).toBe("고칠 사람: 홍길동 (작성자 본인), 김철수");
		expect(line?.querySelectorAll(".self-critique-mark").length).toBe(1);
		expect(card?.querySelector(".self-critique-line")).toBeNull();
		expect(card?.querySelector(".mentioned-members")?.textContent).not.toContain("작성자 본인 지적");
	});

	test("'(작성자 본인)'은 이름과 nbsp로 묶이고 자체로 줄바꿈되지 않는다(nowrap)", () => {
		const data = sampleData();
		data.units[0].member_ids = ["hong"];
		data.units[0].self_critique_member_ids = ["hong"];
		const mark = parseHTML(renderSession(data)).document.getElementById("u001")?.querySelector(".self-critique-mark");
		expect(mark?.textContent).toBe(`${NBSP}(작성자 본인)`);
		expect(STYLE).toMatch(/\.self-critique-mark\s*\{[^}]*white-space:\s*nowrap/);
	});

	test("없거나 필드가 없는 옛 데이터는 표시하지 않는다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		expect(doc.querySelector(".self-critique-mark")).toBeNull();
		expect(doc.querySelector(".self-critique-line")).toBeNull();
		expect(selfCritiqueMemberIdsFromLegacyData({})).toEqual([]);
	});
});

describe("시각 결함 수정 2차 (DESIGN §5-4a, §5-7, §10)", () => {
	function twoWideFramesData(): SessionDataInput {
		const data = sampleData();
		data.units[2].body = [
			{ type: "frame", src: "img/a.webp", width: 1920, height: 540, t: 101, caption: "첫째" },
			{ type: "frame", src: "img/b.webp", width: 1920, height: 540, t: 105, caption: "둘째" },
		];
		return data;
	}
	function mountWide(data: SessionDataInput, overflow: boolean) {
		const dom = parseHTML(renderSession(data));
		for (const el of dom.document.querySelectorAll(".frame-pan-scroll")) {
			Object.defineProperty(el, "scrollWidth", { value: overflow ? 1067 : 600, configurable: true });
			Object.defineProperty(el, "clientWidth", { value: 600, configurable: true });
		}
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		runViewer(win, { Player: StubPlayer, loaded: false });
		return dom.document;
	}
	const hintVisible = (doc: Document) => [...doc.querySelectorAll("#u003 .frame-pan-hint")].map((el) => !el.hasAttribute("hidden"));

	test("좌우로 밀어 보기 힌트는 마크업에서 숨김이고, 넘치는 카드에서 첫 프레임에만 한 번 보인다", () => {
		const data = twoWideFramesData();
		expect([...parseHTML(renderSession(data)).document.querySelectorAll(".frame-pan-hint")].every((el) => el.hasAttribute("hidden"))).toBe(true);
		expect(hintVisible(mountWide(data, true))).toEqual([true, false]);
	});

	test("프레임이 상자에 다 들어가면(넘치지 않으면) 힌트가 보이지 않는다", () => {
		expect(hintVisible(mountWide(twoWideFramesData(), false))).toEqual([false, false]);
	});

	describe("목차의 현재 카드(is-current)", () => {
		function mountToc(tops: Record<string, number>, innerHeight = 800) {
			const dom = parseHTML(renderSession(sampleData()));
			const doc = dom.document;
			const win = makeWindow(dom);
			win.Element.prototype.scrollIntoView = () => {};
			win.innerHeight = innerHeight;
			const setTops = (next: Record<string, number>) => {
				for (const [id, top] of Object.entries(next)) {
					Object.defineProperty(doc.getElementById(id) as Element, "getBoundingClientRect", { value: () => ({ top }), configurable: true });
				}
			};
			setTops(tops);
			runViewer(win, { Player: StubPlayer, loaded: false });
			const current = () => [...new Set([...doc.querySelectorAll(".toc-item.is-current")].map((el) => el.getAttribute("data-target")))];
			return { doc, setTops, current, scroll: () => doc.dispatchEvent(new DomEvent("scroll") as unknown as Event) };
		}

		test("시작할 때 뷰포트 위쪽을 차지한 카드(위쪽이 기준선 이내인 마지막 카드)의 목차 항목에 is-current와 aria-current를 둔다", () => {
			const { doc, current } = mountToc({ u001: -300, u002: 50, u003: 900 });
			expect(current()).toEqual(["u002"]);
			for (const item of doc.querySelectorAll(".toc-item[data-target]")) {
				expect(item.getAttribute("aria-current")).toBe(item.getAttribute("data-target") === "u002" ? "true" : null);
			}
		});

		test("모든 카드가 기준선 아래면 첫 카드가 현재다", () => {
			expect(mountToc({ u001: 500, u002: 900, u003: 1500 }).current()).toEqual(["u001"]);
		});

		test("스크롤하면 현재 카드가 옮겨가고, 이전 항목의 표시는 사라진다", () => {
			const { doc, setTops, current, scroll } = mountToc({ u001: 0, u002: 700, u003: 1400 });
			expect(current()).toEqual(["u001"]);
			setTops({ u001: -700, u002: 0, u003: 700 });
			scroll();
			expect(current()).toEqual(["u002"]);
			expect(doc.querySelector('.toc-item[data-target="u001"]')?.hasAttribute("aria-current")).toBe(false);
			setTops({ u001: -1400, u002: -700, u003: 0 });
			scroll();
			expect(current()).toEqual(["u003"]);
		});

		test("필터로 가려진 카드는 현재가 될 수 없다", () => {
			const { doc, setTops, current, scroll } = mountToc({ u001: -300, u002: 50, u003: 900 });
			doc.getElementById("u002")?.setAttribute("hidden", "");
			setTops({ u001: -300, u002: 50, u003: 900 });
			scroll();
			expect(current()).toEqual(["u001"]);
		});

		test("목차 항목을 누르면 그 항목이 현재 표시를 갖는다", () => {
			const { doc, current } = mountToc({ u001: -300, u002: 50, u003: 900 });
			click(doc.querySelector('#panel-match .toc-item[data-target="u003"]'));
			expect(current()).toContain("u003");
		});
	});

	describe("데스크톱 프레임 이동(마우스 끌기)", () => {
		function mountPan(opts: { fine: boolean; scrollWidth?: number; clientWidth?: number; panWidth?: number }) {
			const dom = parseHTML(renderSession(twoWideFramesData()));
			const doc = dom.document;
			const boxes = [...doc.querySelectorAll("#u003 .frame-pan-scroll")] as unknown as { scrollLeft: number; dispatchEvent(event: unknown): boolean; hasAttribute(name: string): boolean; classList: DOMTokenList }[];
			for (const el of boxes) {
				Object.defineProperty(el, "scrollWidth", { value: opts.scrollWidth ?? 1067, configurable: true });
				Object.defineProperty(el, "clientWidth", { value: opts.clientWidth ?? 600, configurable: true });
			}
			for (const pan of doc.querySelectorAll("#u003 .frame-pan")) Object.defineProperty(pan, "clientWidth", { value: opts.panWidth ?? 600, configurable: true });
			const win = makeWindow(dom);
			win.Element.prototype.scrollIntoView = () => {};
			win.matchMedia = (query: string) => ({ matches: opts.fine && query === "(pointer: fine)", addListener: () => {}, removeListener: () => {} });
			runViewer(win, { Player: StubPlayer, loaded: false });
			return { doc, box: boxes[0], img: doc.querySelector("#u003 .frame-pan-scroll img") as Element };
		}
		const fire = (target: unknown, type: string, props: Record<string, unknown> = {}): Event => {
			const event = new DomEvent(type, { bubbles: true, cancelable: true }) as unknown as Event;
			Object.assign(event, props);
			(target as Element).dispatchEvent(event);
			return event;
		};
		const mouse = (clientX: number) => ({ pointerType: "mouse", button: 0, clientX });

		test("마우스로 끌면 scrollLeft가 끄는 만큼 움직이고, 끈 뒤의 클릭은 막힌다", () => {
			const { doc, box, img } = mountPan({ fine: true });
			box.scrollLeft = 200;
			fire(img, "pointerdown", mouse(300));
			fire(doc, "pointermove", mouse(250));
			expect(box.scrollLeft).toBe(250);
			fire(doc, "pointermove", mouse(100));
			expect(box.scrollLeft).toBe(400);
			expect(box.classList.contains("is-dragging")).toBe(true);
			fire(doc, "pointerup", mouse(100));
			expect(box.classList.contains("is-dragging")).toBe(false);
			expect(fire(img, "click").defaultPrevented).toBe(true);
			expect(fire(img, "click").defaultPrevented).toBe(false);
		});

		test("끌지 않은 클릭(4px 미만 이동 포함)은 막지 않는다", () => {
			const { doc, box, img } = mountPan({ fine: true });
			box.scrollLeft = 200;
			fire(img, "pointerdown", mouse(300));
			fire(doc, "pointermove", mouse(298));
			fire(doc, "pointerup", mouse(298));
			expect(box.scrollLeft).toBe(200);
			expect(fire(img, "click").defaultPrevented).toBe(false);
		});

		test("터치·보조 버튼 포인터이거나 고정밀 포인터가 아니거나 넘치지 않는 상자는 끌어도 움직이지 않는다", () => {
			const stays = (opts: { fine: boolean; scrollWidth?: number }, down: Record<string, unknown>) => {
				const { doc, box, img } = mountPan(opts);
				const before = box.scrollLeft;
				fire(img, "pointerdown", down);
				fire(doc, "pointermove", mouse(100));
				return box.scrollLeft === before && !box.classList.contains("is-dragging");
			};
			expect(stays({ fine: true }, { pointerType: "touch", button: 0, clientX: 300 })).toBe(true);
			expect(stays({ fine: true }, { pointerType: "mouse", button: 2, clientX: 300 })).toBe(true);
			expect(stays({ fine: false }, mouse(300))).toBe(true);
			expect(stays({ fine: true, scrollWidth: 600 }, mouse(300))).toBe(true);
			expect(stays({ fine: true }, mouse(300))).toBe(false);
		});

		test("이미지 기본 끌기(dragstart)는 막는다", () => {
			const { img } = mountPan({ fine: true });
			expect(fire(img, "dragstart").defaultPrevented).toBe(true);
		});

		test("힌트는 고정밀 포인터에서 '끌어서 좌우로 보기', 아니면 '좌우로 밀어 보기'다", () => {
			const hintOf = (fine: boolean) => mountPan({ fine }).doc.querySelector("#u003 .frame-pan-hint")?.textContent;
			expect(hintOf(true)).toBe("끌어서 좌우로 보기");
			expect(hintOf(false)).toBe("좌우로 밀어 보기");
		});

		test("프레임이 통째로 보이는(frame-pan--full) 상자나 1px 반올림 차이뿐인 상자에는 힌트가 없고, 끌기 커서도 없다", () => {
			const full = mountPan({ fine: true, panWidth: 996 });
			expect(full.doc.querySelector("#u003 .frame-pan")?.classList.contains("frame-pan--full")).toBe(true);
			expect([...full.doc.querySelectorAll("#u003 .frame-pan-hint")].every((el) => el.hasAttribute("hidden"))).toBe(true);
			expect(full.box.hasAttribute("data-pannable")).toBe(false);
			const rounding = mountPan({ fine: true, scrollWidth: 601 });
			expect([...rounding.doc.querySelectorAll("#u003 .frame-pan-hint")].every((el) => el.hasAttribute("hidden"))).toBe(true);
			expect(rounding.box.hasAttribute("data-pannable")).toBe(false);
			expect(mountPan({ fine: true }).box.hasAttribute("data-pannable")).toBe(true);
		});

		test("(pointer: fine)에서만 넘치는 상자에 grab, 끄는 중 grabbing 커서를 준다", () => {
			const fine = STYLE.match(/@media \(pointer: fine\) \{[\s\S]*?\n\}/)?.[0] ?? "";
			expect(fine).toMatch(/\.frame-pan-scroll\[data-pannable\]\s*\{[^}]*cursor:\s*grab/);
			expect(fine).toMatch(/\.frame-pan-scroll\.is-dragging\s*\{[^}]*cursor:\s*grabbing/);
			expect(fine).toMatch(/\.frame-pan-scroll\[data-pannable\] \.frame-link\s*\{[^}]*cursor:\s*inherit/);
		});
	});

	test("hidden 힌트는 display:block 규칙에 눌리지 않는다", () => {
		expect(STYLE).toMatch(/\.frame-pan \.frame-pan-hint\[hidden\]\s*\{[^}]*display:\s*none/);
	});

	test("≤640px 캡션 줄에서 시간 칩과 확대 링크는 첫 줄에서 세로 가운데 정렬이다", () => {
		const media = [...STYLE.matchAll(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g)].map((m) => m[0]).join("\n");
		expect(media).toMatch(/\.body-frame figcaption\s*\{[^}]*align-items:\s*center/);
	});

	test("확대 링크의 aria-label은 보이는 글자 '확대'로 시작하고 프레임 시각을 말한다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		expect(doc.querySelector("#u003 .body-frame .zoom-link")?.getAttribute("aria-label")).toBe("확대: 1:45 프레임 원본");
		expect(doc.querySelector("#u001 .card-image .zoom-link")?.getAttribute("aria-label")).toBe("확대: 12:34 프레임 원본");
	});

	test("제목에서 한 음절 지시어(한/이/그/각)는 다음 낱말에 붙고, 지시어가 아닌 낱말 끝 글자는 붙이지 않는다", () => {
		const titleOf = (title: string) => {
			const data = sampleData();
			data.units[0].title = title;
			return parseHTML(renderSession(data)).document.querySelector("#u001 h3")?.textContent ?? "";
		};
		expect(titleOf("각 라인 간격 맞추기")).toContain(`각${NBSP}라인`);
		expect(titleOf("그 상황에서 물러서기")).toContain(`그${NBSP}상황에서`);
		expect(titleOf("수비 라인 한 칸 내리기")).toContain(`한${NBSP}칸`);
		expect(titleOf("다시 이 공간 막기")).toContain(`이${NBSP}공간`);
		expect(titleOf("공간이 넓게 열리면 대응")).not.toContain(`이${NBSP}`);
	});

	test("제목의 '&'는 양쪽 낱말에 붙고, 괄호 안 '&'는 그대로 두며, '슈퍼 캔슬'은 한 덩어리다", () => {
		const titleOf = (title: string) => {
			const data = sampleData();
			data.units[0].title = title;
			return parseHTML(renderSession(data)).document.querySelector("#u001 h3")?.textContent ?? "";
		};
		expect(titleOf("Tips & Tricks 정리")).toContain(`Tips${NBSP}&${NBSP}Tricks`);
		expect(titleOf("공수 균형 (Offense & Defense) 정리")).toContain("(Offense & Defense)");
		expect(titleOf("슈퍼 캔슬 쓰기")).toContain(`슈퍼${NBSP}캔슬`);
	});
});

// ── 자료가 권하는 것 (DESIGN §5, refs-draft lesson_ko) ─────────────────────────

describe("자료가 권하는 것 — 장면 줄 아래의 자료 교훈", () => {
	const lessonRef = {
		id: "r-w",
		title: "수비 라인 강의",
		source_name: "Example Channel",
		lang: "ko",
		kind: "tactics" as const,
		href: null,
		orig_url: "https://example.com/w",
		format: "article" as const,
		relevance_ko: "관련",
		lesson_ko: "포백이 한 줄로 서서 한 덩어리로 움직인다",
		start_seconds: null,
		version_badge: null,
		pro_clubs: false,
	};
	function faultData(refs: SessionDataInput["units"][number]["refs"]): SessionDataInput {
		const data = sampleData();
		Object.assign(data.units[0], { title: "센터백: 첫판부터 정신 놓음", fault_scene: "수비 라인이 둘로 갈라졌다", refs });
		return data;
	}

	test("제목 바로 아래(장면 줄 앞)에 자료 이름과 함께 '자료가 권하는 것 · 교훈 (출처)'를 보이고, 출처는 카드의 그 자료 항목으로 잇는다", () => {
		const doc = parseHTML(renderSession(faultData([lessonRef]))).document;
		const lesson = doc.querySelector("#u001 h3")?.nextElementSibling;
		expect(lesson?.classList.contains("ref-lesson")).toBe(true);
		expect(lesson?.nextElementSibling?.classList.contains("fault-scene")).toBe(true);
		expect(lesson?.textContent?.replaceAll(NBSP, " ")).toBe("자료가 권하는 것 · 포백이 한 줄로 서서 한 덩어리로 움직인다 (Example Channel)");
		const link = lesson?.querySelector("a.ref-lesson-source");
		expect(link?.textContent).toBe("Example Channel");
		const target = doc.getElementById((link?.getAttribute("href") ?? "").replace("#", ""));
		expect(target?.closest(".refs-list")).not.toBeNull();
		expect(target?.querySelector(".ref-title")?.textContent?.replaceAll(NBSP, " ")).toContain("수비 라인 강의");
	});

	test("출처 링크의 44px 탭 영역은 .ref-link와 같은 가운데 ::after 기법이고 min-height로 문단을 키우지 않는다", () => {
		const rule = STYLE.match(/\n\.ref-lesson-source\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(rule).toMatch(/position:\s*relative/);
		expect(rule).not.toMatch(/min-height/);
		expect(rule).not.toMatch(/display:\s*inline-flex/);
		const after = STYLE.match(/\n\.ref-lesson-source::after\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(after).toMatch(/position:\s*absolute/);
		expect(after).toMatch(/height:\s*44px/);
		expect(after).toMatch(/width:\s*max\(100%,\s*44px\)/);
		expect(after).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
	});

	test("'(출처)'는 한 덩어리 .ref-lesson-cite 안에 있어 여는 괄호가 줄 끝에 홀로 남지 않는다", () => {
		const doc = parseHTML(renderSession(faultData([lessonRef]))).document;
		const cite = doc.querySelector("#u001 .ref-lesson > .ref-lesson-cite");
		expect(cite?.textContent).toBe("(Example Channel)");
		expect(cite?.firstElementChild?.classList.contains("ref-lesson-source")).toBe(true);
		const rule = STYLE.match(/\n\.ref-lesson-cite\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(rule).toMatch(/display:\s*inline-block/);
		expect(rule).toMatch(/max-width:\s*100%/);
	});

	test("lesson_ko가 없는 자료만 붙었거나 옛 데이터면 줄을 렌더하지 않는다", () => {
		const noLesson = { ...lessonRef } as Partial<typeof lessonRef>;
		delete noLesson.lesson_ko;
		delete noLesson.source_name;
		const doc = parseHTML(renderSession(faultData([noLesson as typeof lessonRef]))).document;
		expect(doc.querySelector(".ref-lesson")).toBeNull();
		expect(lessonFromLegacyData({})).toBeNull();
		expect(lessonFromLegacyData({ lesson_ko: "교훈" })).toBe("교훈");
		expect(sourceNameFromLegacyData({ title: "강의" })).toBe("강의");
		expect(sourceNameFromLegacyData({ title: "강의", source_name: "채널" })).toBe("채널");
	});

	test("자료가 둘이면 lesson_ko를 가진 첫 자료의 교훈을 쓴다", () => {
		const noLesson = { ...lessonRef, id: "r-x", lesson_ko: null, source_name: "Other" };
		const doc = parseHTML(renderSession(faultData([noLesson, lessonRef]))).document;
		expect(doc.querySelectorAll("#u001 .ref-lesson").length).toBe(1);
		expect(doc.querySelector("#u001 .ref-lesson")?.textContent).toContain("Example Channel");
	});
});

// ── 반복 지적 — 내 것 먼저 · 요약 줄 · 팀 단위 칩 (DESIGN §6a) ─────────────────────

describe("반복 지적 — 팀원을 고르면 내 지적이 먼저 온다", () => {
	/** hong이 고칠 사람인 유닛은 u001·u004. 행: 한 번 더(4, 주인 없음) · 홍길동 마크(3, 주인 hong) · 홍길동 라인(2, 주인 hong) · 최민수 템포(2, 주인 choi) · 홍길동 단독(2, 주인 hong). */
	function mixedData(): SessionDataInput {
		const data = sampleData();
		data.units.push(baseUnit({ id: "u004", uid: "20240104-NUzEChn9EyI#u004", start: 400, end: 410, topic_tags: ["전환"] }));
		data.recurring = [
			{ label: "한 번 더", unit_ids: ["u001", "u002", "u003", "u004"], member_ids: [] },
			{ label: "홍길동 마크", unit_ids: ["u001", "u003", "u004"], member_ids: ["hong"] },
			{ label: "홍길동 라인", unit_ids: ["u001", "u004"], member_ids: ["hong"] },
			{ label: "최민수 템포", unit_ids: ["u002", "u003"], member_ids: ["choi"] },
			{ label: "홍길동 단독", unit_ids: ["u001", "u002"], member_ids: ["hong"] },
		];
		return data;
	}
	const labels = (doc: Document) => [...doc.querySelectorAll(".recurring-item .recurring-label")].map((el) => plain(el.textContent));
	const ORIGINAL = ["한 번 더", "홍길동 마크", "홍길동 라인", "최민수 템포", "홍길동 단독"];

	test("선택 전에는 많이 반복된 순서 그대로이고 요약 줄은 숨어 있다", () => {
		const { doc } = mountViewer(renderSession(mixedData()), false);
		expect(labels(doc)).toEqual(ORIGINAL);
		expect(isHidden(doc.querySelector(".recurring-summary"))).toBe(true);
	});

	test("hong을 고르면 '내가 고칠 것'이 있는 행이 먼저(개수 순 유지)·나머지가 뒤(개수 순 유지)에 오고, 해제하면 원래 순서로 돌아온다", () => {
		const { doc } = mountViewer(renderSession(mixedData()), false);
		clickMinePill(doc, "hong");
		expect(labels(doc)).toEqual(["홍길동 마크", "홍길동 라인", "홍길동 단독", "한 번 더", "최민수 템포"]);
		clickMinePill(doc, "hong");
		expect(labels(doc)).toEqual(ORIGINAL);
	});

	test("요약 줄은 내가 고칠 것이 있는 행 수를 '내가 고칠 반복 N'으로 목록 위에 보이고(포지션 대상 행이 있으면 ' · 내 포지션 대상 M'), 해제하면 숨는다", () => {
		const { doc } = mountViewer(renderSession(mixedData()), false);
		const summary = doc.querySelector(".recurring-summary");
		expect(summary?.nextElementSibling?.classList.contains("recurring-list")).toBe(true);
		clickMinePill(doc, "hong");
		expect(isHidden(summary)).toBe(false);
		expect(summary?.textContent).toBe("내가 고칠 반복 3");
		clickMinePill(doc, "hong");
		expect(isHidden(summary)).toBe(true);
		clickMinePill(doc, "choi"); // choi는 '최민수 템포'(u003)만 고칠 것이다
		expect(summary?.textContent).toBe("내가 고칠 반복 1");
		clickMinePill(doc, "choi");
		clickMinePill(doc, "park"); // park은 고칠 반복 지적이 없다 — 0을 그대로 말하고, 주인 없는 행의 u002 칩은 그 포지션 대상으로 따로 센다
		expect(summary?.textContent).toBe("내가 고칠 반복 0 · 내 포지션 대상 1");
	});

	test("접힌 '더 보기'에는 내 것이 아닌 나머지가 들어간다(내 것이 3개를 넘지 않을 때)", () => {
		const { doc } = mountViewer(renderSession(mixedData()), false);
		clickMinePill(doc, "hong");
		// '최민수 템포'(u002·u003)는 hong의 카드가 아니라 가려져 행째 숨는다 — 보이는 행은 홍길동 마크·라인·단독·한 번 더.
		const folded = [...doc.querySelectorAll(".recurring-item.recurring-extra:not([hidden]) .recurring-label")].map((el) => plain(el.textContent));
		expect(folded).toEqual(["한 번 더"]);
		expect(doc.querySelector(".recurring-more")?.textContent).toBe("더 보기 (1)");
	});

	test("내 칩이 있는 행(내가 고칠 것·내 포지션 대상)은 3개를 넘어도 접지 않고, 내 것이 아닌 행만 '더 보기'로 접는다", () => {
		const data = mixedData();
		data.recurring = [
			{ label: "홍길동 마크", unit_ids: ["u001", "u003", "u004"], member_ids: ["hong"] },
			{ label: "홍길동 라인", unit_ids: ["u001", "u004"], member_ids: ["hong"] },
			{ label: "홍길동 단독", unit_ids: ["u001", "u002"], member_ids: ["hong"] },
			{ label: "홍길동 넷째", unit_ids: ["u001", "u004"], member_ids: ["hong"] },
			{ label: "한 번 더", unit_ids: ["u001", "u002", "u003", "u004"], member_ids: [] },
		];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		const visible = (extra: boolean) =>
			[...doc.querySelectorAll(`.recurring-item${extra ? ".recurring-extra" : ":not(.recurring-extra)"}:not([hidden]) .recurring-label`)].map((el) => plain(el.textContent));
		expect(visible(false)).toEqual(["홍길동 마크", "홍길동 라인", "홍길동 단독", "홍길동 넷째"]);
		expect(visible(true)).toEqual(["한 번 더"]);
		expect(doc.querySelector(".recurring-more")?.textContent).toBe("더 보기 (1)");
	});

	test("내 포지션 대상 행도 내가 고칠 것 행 뒤에서 접히지 않는다", () => {
		const data = sampleData();
		data.units.push(
			baseUnit({ id: "u004", uid: "20240104-NUzEChn9EyI#u004", start: 400, end: 410, title: "수비 라인: 라인 맞추기", member_ids: [], position_target_ids: ["hong"], group_member_ids: ["hong"] }),
			baseUnit({ id: "u005", uid: "20240104-NUzEChn9EyI#u005", start: 500, end: 510, title: "수비 라인: 라인 맞추기", member_ids: [], position_target_ids: ["hong"], group_member_ids: ["hong"] }),
		);
		data.recurring = [
			{ label: "수비 라인이 안 맞음", unit_ids: ["u004", "u005", "u002", "u003"], member_ids: [] },
			{ label: "홍길동 A", unit_ids: ["u001", "u004"], member_ids: ["hong"] },
			{ label: "홍길동 B", unit_ids: ["u001", "u005"], member_ids: ["hong"] },
			{ label: "홍길동 C", unit_ids: ["u001", "u002"], member_ids: ["hong"] },
			{ label: "홍길동 D", unit_ids: ["u001", "u003"], member_ids: ["hong"] },
		];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		const order = [...doc.querySelectorAll(".recurring-item:not([hidden])")].map((el) => ({ label: plain(el.querySelector(".recurring-label")?.textContent), extra: el.classList.contains("recurring-extra") }));
		expect(order.at(-1)).toEqual({ label: "수비 라인이 안 맞음", extra: false });
		expect(order.filter((row) => row.extra)).toEqual([]);
	});

	test("필터가 내 칩을 모두 가린 행은 요약 줄 개수에서 빠진다", () => {
		const { doc } = mountViewer(renderSession(mixedData()), false);
		clickMinePill(doc, "hong");
		clickChip(doc, "topic", "전환"); // hong의 카드 중 u004만 남는다 -> '홍길동 단독'(u001·u002)은 보이는 칩이 없다
		expect(doc.querySelector(".recurring-summary")?.textContent).toBe("내가 고칠 반복 2");
		clickChip(doc, "topic", "전환");
		expect(doc.querySelector(".recurring-summary")?.textContent).toBe("내가 고칠 반복 3");
	});
});

describe("group_member_ids — 팀 단위 칩의 '내 포지션 대상' (DESIGN §5, §6a)", () => {
	/** u004: "수비 라인" 단위가 행위자이고 hong(CB)도 고칠 사람 — position_target_ids는 고칠 사람을 빼 hong이 없지만 group_member_ids에는 든다. */
	function teamChipData(): SessionDataInput {
		const data = sampleData();
		const extra = (id: string, overrides: Partial<TestUnit>): TestUnit =>
			baseUnit({ id, uid: `20240104-NUzEChn9EyI#${id}`, start: 400, end: 410, topic_tags: ["빌드업"], position_tags: ["DF", "CB"], ...overrides });
		data.units.push(
			extra("u004", { title: "수비 라인: 라인 맞추기 / 홍길동: 정신 놓음", member_ids: ["hong"], position_target_ids: ["kim"], group_member_ids: ["hong", "kim"] }),
			extra("u005", { title: "수비 라인: 라인 맞추기", member_ids: [], position_target_ids: ["hong", "kim"], group_member_ids: ["hong", "kim"] }),
		);
		data.recurring = [{ label: "수비 라인이 맞지 않음", unit_ids: ["u001", "u004", "u005"], member_ids: [] }];
		return data;
	}

	test("카드는 group_member_ids를 data-group-member-ids로 싣고 position_target_ids 속성은 그대로 둔다", () => {
		const doc = parseHTML(renderSession(teamChipData())).document;
		expect(doc.getElementById("u004")?.getAttribute("data-group-member-ids")).toBe("hong|kim");
		expect(doc.getElementById("u004")?.getAttribute("data-position-target-ids")).toBe("kim");
	});

	test("칩 주인이 팀 단위(수비 라인)인 칩만 data-team-owner가 붙는다", () => {
		const doc = parseHTML(renderSession(teamChipData())).document;
		const team = (id: string) => doc.querySelector(`.recurring-unit[data-target="${id}"]`)?.getAttribute("data-team-owner");
		expect(team("u004")).toBe("true");
		expect(team("u005")).toBe("true");
		expect(team("u001")).toBeNull(); // 제목에 팀 단위 행위자가 없다
	});

	test("팀 단위 칩은 그 경기 그 단위에서 뛴 팀원에게 고칠 사람이어도 '내 포지션 대상'으로 틴트되고 개수에 든다", () => {
		const { doc } = mountViewer(renderSession(teamChipData()), false);
		clickMinePill(doc, "hong");
		expect([...doc.querySelectorAll(".recurring-unit.is-mine")].map((el) => el.getAttribute("data-target"))).toEqual(["u004", "u005"]);
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×3 · 내 포지션 대상 2");
	});

	test("단위에서 뛰지 않은 팀원(park GK)과 팀 단위 칩이 아닌 칩은 틴트하지 않는다", () => {
		const { doc } = mountViewer(renderSession(teamChipData()), false);
		clickMinePill(doc, "park");
		expect(doc.querySelectorAll(".recurring-unit.is-mine").length).toBe(0);
		clickMinePill(doc, "park");
		clickMinePill(doc, "hong");
		expect(doc.querySelector('.recurring-unit[data-target="u001"]')?.classList.contains("is-mine")).toBe(false);
	});

	test("group_member_ids가 없는 옛 data.json은 이름 있는 변환 함수가 position_target_ids로 읽는다", () => {
		expect(groupMemberIdsFromLegacyData({ member_ids: [], related_member_ids: ["kim"], position_target_ids: ["hong"] })).toEqual(["hong"]);
		expect(groupMemberIdsFromLegacyData({ member_ids: [], related_member_ids: ["kim"] })).toEqual(["kim"]);
		expect(groupMemberIdsFromLegacyData({ member_ids: ["hong"], related_member_ids: ["kim"] })).toEqual([]);
		expect(groupMemberIdsFromLegacyData({ member_ids: [], related_member_ids: [], position_target_ids: ["hong"], group_member_ids: ["hong", "kim"] })).toEqual(["hong", "kim"]);
		const legacy = sampleData();
		legacy.units[0].group_member_ids = undefined;
		legacy.units[0].position_target_ids = ["kim"];
		expect(parseHTML(renderSession(legacy)).document.getElementById("u001")?.getAttribute("data-group-member-ids")).toBe("kim");
	});

	test("pill의 '팀' 숫자와 카드 배지는 position_target_ids 뜻 그대로다(고칠 사람은 '내 포지션 대상'에 세지 않는다)", () => {
		const { doc } = mountViewer(renderSession(teamChipData()), false);
		const hong = doc.querySelector('.pill-mine[data-value="hong"]');
		expect(hong?.querySelector(".count-team")?.textContent).toBe("· 팀 1"); // u005만(u004는 고칠 사람이라 팀에 안 센다)
	});
});

// ── 데스크톱 넓은 카드 (DESIGN §5 4a) ──────────────────────────────────────────

describe("작은 보정 — 반복 지적 칩 정렬 · 참고자료 링크 말 · 서 있 묶음", () => {
	test("데스크톱에서도 반복 지적 시간 칩의 왼쪽 여백은 0이다(라벨과 칩 정렬)", () => {
		const base = STYLE.match(/\n\.recurring-unit\s*\{[^}]*\}/)?.[0] ?? "";
		expect(base).toMatch(/margin:\s*var\(--space-1\) var\(--space-1\) var\(--space-1\) 0\s*;/);
	});

	test("참고자료 영상의 열기 링크는 '자료 영상 m:ss부터 ↗'로 경기 영상 링크와 구별한다(카드·참고자료 페이지 공통)", () => {
		const data = sampleData();
		data.units[0].refs = [{ id: "r-v", title: "강의", lang: "ko", kind: "tactics", href: null, orig_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", format: "video", relevance_ko: "관련", start_seconds: 392, version_badge: null, pro_clubs: false }];
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelector("#u001 a.ref-link")?.textContent).toBe("자료 영상 6:32부터 ↗");
		expect(doc.querySelector("#u001 a.ref-link")?.getAttribute("href")).toContain("t=392s");
		expect(doc.querySelector("#u001 a.watch-link")?.textContent).toBe("경기 영상 12:34부터 보기 ↗");
		const page = renderRef({ id: "r-1", title: "제목", lang: "en", kind: "eafc", format: "video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", start_seconds: 392, summary_ko: "요약", key_points_ko: [], translations: [] });
		expect(parseHTML(page).document.querySelector(".plain-link a")?.textContent).toBe("자료 영상 6:32부터 ↗");
	});

	test('glueKorean은 "서 있"(서 있다/서 있고)을 nbsp로 붙이되 "에서 있"처럼 단어 끝 "서"는 붙이지 않는다', () => {
		expect(glueKorean("두 명이 떨어져 서 있고 라인이 갈렸다")).toContain(`서${NBSP}있고`);
		expect(glueKorean("떨어져 서 있고")).toBe(`떨어져 서${NBSP}있고`);
		expect(glueKorean("**서** 있다")).toBe(`**서**${NBSP}있다`);
		expect(glueKorean("라인에서 있었던 일")).toBe("라인에서 있었던 일");
		expect(glueKorean("서로 있는 자리")).toBe("서로 있는 자리");
	});
});

// ── 반복 지적 소유자 · 요약 · 칩 속성 형식 ──────────────────────────────────────

describe("data-* id 목록은 '|'로 잇는다(VIEWER_JS hasToken과 같은 형식)", () => {
	/** u001은 hong·choi 둘이 고칠 사람, u003은 choi. 항목 주인은 둘 다. */
	function twoFixerData(): SessionDataInput {
		const data = sampleData();
		data.units[0].member_ids = ["hong", "choi"];
		data.units[0].related_member_ids = ["hong", "choi"]; // 두 사람 모두 이 카드가 '내 피드백'으로 보인다
		data.recurring = [{ label: "둘이 함께 놓침", unit_ids: ["u001", "u003"], member_ids: ["hong", "choi"] }];
		return data;
	}

	test("고칠 사람이 둘인 칩의 data-fixer-ids와 행의 data-owner-ids는 '|'로 이어진다(공백 아님)", () => {
		const doc = parseHTML(renderSession(twoFixerData())).document;
		expect(doc.querySelector('.recurring-unit[data-target="u001"]')?.getAttribute("data-fixer-ids")).toBe("hong|choi");
		expect(doc.querySelector('.recurring-unit[data-target="u003"]')?.getAttribute("data-fixer-ids")).toBe("choi");
		expect(doc.querySelector(".recurring-item")?.getAttribute("data-owner-ids")).toBe("hong|choi");
		for (const el of doc.querySelectorAll("[data-fixer-ids], [data-owner-ids]")) {
			expect(el.getAttribute("data-fixer-ids") ?? "").not.toContain(" ");
			expect(el.getAttribute("data-owner-ids") ?? "").not.toContain(" ");
		}
	});

	test("첫 고칠 사람이 아닌 둘째 사람을 골라도 그 칩이 내 칩으로 세어지고 행이 '내가 고칠 반복'에 든다", () => {
		const { doc } = mountViewer(renderSession(twoFixerData()), false);
		clickMinePill(doc, "choi");
		expect([...doc.querySelectorAll(".recurring-unit.is-mine")].map((el) => el.getAttribute("data-target"))).toEqual(["u001", "u003"]);
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×2 · 내가 고칠 것 2"); // 두 칩 모두 보인다
		expect(doc.querySelector(".recurring-summary")?.textContent).toBe("내가 고칠 반복 1");
		clickMinePill(doc, "choi");
		clickMinePill(doc, "hong");
		expect([...doc.querySelectorAll(".recurring-unit.is-mine")].map((el) => el.getAttribute("data-target"))).toEqual(["u001"]);
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×2 · 보이는 카드 1 (그중 내가 고칠 것 1)"); // hong 필터는 u003 카드를 가린다
	});
});

describe("반복 지적 소유자는 칩 단위로 정한다(고칠 사람 칩 + 팀 단위 칩의 포지션 구성원)", () => {
	/** 항목 주인은 hong뿐이지만 u004 칩의 행위자는 "수비 라인"(주인 없는 팀 단위, 포지션 구성원 kim·choi). */
	function teamAndOwnerData(): SessionDataInput {
		const data = sampleData();
		data.units.push(
			baseUnit({
				id: "u004",
				uid: "20240104-NUzEChn9EyI#u004",
				start: 400,
				end: 410,
				title: "수비 라인: 라인 맞추기",
				position_tags: ["DF"],
				member_ids: [],
				group_member_ids: ["kim", "choi"],
				position_target_ids: ["kim", "choi"],
			}),
		);
		data.recurring = [{ label: "마크를 놓침", unit_ids: ["u001", "u004"], member_ids: ["hong"] }];
		return data;
	}

	test("행의 data-owner-ids는 고칠 사람 칩의 고칠 사람과 팀 단위 칩의 포지션 구성원을 모은다", () => {
		const doc = parseHTML(renderSession(teamAndOwnerData())).document;
		expect(doc.querySelector(".recurring-item")?.getAttribute("data-owner-ids")).toBe("hong|kim|choi");
	});

	test("포지션 구성원은 자기 포지션 칩이 든 행을 '내 포지션 대상'으로 요약 줄에 세고 그 행이 앞에 온다", () => {
		const data = teamAndOwnerData();
		data.recurring = [...(data.recurring ?? []), { label: "한참 뒤 반복", unit_ids: ["u002", "u003"], member_ids: [] }];
		const { doc } = mountViewer(renderSession(data), false);
		const summary = doc.querySelector(".recurring-summary");
		const labels = () => [...doc.querySelectorAll(".recurring-item .recurring-label")].map((el) => plain(el.textContent));
		clickMinePill(doc, "kim");
		expect(summary?.textContent).toBe("내가 고칠 반복 0 · 내 포지션 대상 1");
		expect(labels()[0]).toBe("마크를 놓침");
		expect(doc.querySelector('.recurring-unit[data-target="u004"]')?.classList.contains("is-mine")).toBe(true);
		clickMinePill(doc, "kim");
		clickMinePill(doc, "hong");
		expect(summary?.textContent).toBe("내가 고칠 반복 1"); // hong은 u004 그룹이 아니라 포지션 대상 행이 없다
	});

	test("고칠 반복과 포지션 대상 행이 다르면 고칠 반복 → 포지션 대상 → 나머지 순으로 놓는다", () => {
		const data = teamAndOwnerData();
		data.units[0].group_member_ids = ["hong"];
		data.recurring = [
			{ label: "나머지 행", unit_ids: ["u002", "u003"], member_ids: [] },
			{ label: "포지션 행", unit_ids: ["u001", "u004"], member_ids: [] },
			{ label: "고칠 행", unit_ids: ["u001", "u003"], member_ids: ["hong"] },
		];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		expect([...doc.querySelectorAll(".recurring-item .recurring-label")].map((el) => plain(el.textContent))).toEqual(["고칠 행", "포지션 행", "나머지 행"]);
		expect(doc.querySelector(".recurring-summary")?.textContent).toBe("내가 고칠 반복 1 · 내 포지션 대상 1");
	});

	test("고칠 사람이 없는 팀원은 0을 그대로 말한다", () => {
		const { doc } = mountViewer(renderSession(teamAndOwnerData()), false);
		clickMinePill(doc, "park");
		expect(doc.querySelector(".recurring-summary")?.textContent).toBe("내가 고칠 반복 0");
	});
});

describe("반복 지적 개수 문구 간격 · 브레드크럼 토픽 묶음", () => {
	test("개수 조각은 앞뒤 공백 없이 만들고 사이 간격은 flex gap이 낸다(공백은 조각 사이 텍스트 노드로만 둔다)", () => {
		const data = sampleData();
		data.recurring = [{ label: "최민수가 더 올라가지 않음", unit_ids: ["u001", "u003"], member_ids: ["choi"] }];
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "choi");
		clickChip(doc, "position", "ST");
		const parts = [...doc.querySelectorAll(".recurring-count .recurring-count-part")].map((el) => el.textContent ?? "");
		expect(parts).toEqual(["×2", "· 보이는 카드 1", "(그중 내가 고칠 것 1)"]);
		expect(doc.querySelector(".recurring-count")?.textContent).toBe("×2 · 보이는 카드 1 (그중 내가 고칠 것 1)");
	});

	test("카드 헤더의 토픽 구절은 inline-block 묶음이라 좁은 폭에서 구절 중간이 끊기지 않는다", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const topic = doc.querySelector("#u001 .breadcrumb .breadcrumb-topic");
		expect(plain(topic?.textContent)).toBe("› 빌드업 전개");
		expect(plain(doc.querySelector("#u001 .breadcrumb")?.textContent)).toContain("1경기 › 빌드업 전개");
		expect(STYLE).toMatch(/\n\.breadcrumb-topic\s*\{[^}]*display:\s*inline-block/);
	});
});

// ── 초광각 프레임: 280px 이상일 때만 전체 프레임 ───────────────────────────────────

describe("초광각 프레임 — 280px 넘게 그려질 때만 전체를 보이고 아니면 이동 상자", () => {
	function ultrawideData(width: number, height: number): SessionDataInput {
		const data = sampleData();
		data.units[2].body = [{ type: "frame", src: "img/u003-c001.webp", width, height, t: 105, caption: "초광각" }];
		return data;
	}
	function mountWithPanWidth(data: SessionDataInput, panWidth: number) {
		const dom = parseHTML(renderSession(data));
		for (const pan of dom.document.querySelectorAll(".frame-pan")) Object.defineProperty(pan, "clientWidth", { value: panWidth, configurable: true });
		const win = makeWindow(dom);
		win.Element.prototype.scrollIntoView = () => {};
		runViewer(win, { Player: StubPlayer, loaded: false });
		return dom.document;
	}

	test("카드 폭에서 높이가 280px 미만이면 이동 상자를 유지한다(1920×540, 폭 1000 미만은 전부)", () => {
		for (const width of [358, 612, 746, 995]) {
			expect(mountWithPanWidth(ultrawideData(1920, 540), width).querySelector("#u003 .frame-pan")?.classList.contains("frame-pan--full")).toBe(false);
		}
	});

	test("높이가 280px 이상이면 전체 프레임으로 푼다(1920×540은 폭 996 이상, 1100×500은 폭 616 이상)", () => {
		expect(mountWithPanWidth(ultrawideData(1920, 540), 996).querySelector("#u003 .frame-pan")?.classList.contains("frame-pan--full")).toBe(true);
		expect(mountWithPanWidth(ultrawideData(1100, 500), 616).querySelector("#u003 .frame-pan")?.classList.contains("frame-pan--full")).toBe(true);
		expect(mountWithPanWidth(ultrawideData(1100, 500), 612).querySelector("#u003 .frame-pan")?.classList.contains("frame-pan--full")).toBe(false);
	});

	test("카드를 넓히는 card--ultrawide와 ≥1024px의 일괄 풀기 규칙은 없다", () => {
		expect(STYLE).not.toContain("card--ultrawide");
		expect(STYLE).not.toContain("--card-bleed");
		expect(parseHTML(renderSession(ultrawideData(1920, 540))).document.querySelector(".card--ultrawide")).toBeNull();
		const wide = STYLE.match(/@media \(min-width: 1024px\) \{[\s\S]*?\n\}/g)?.find((block) => block.includes(".frame-pan")) ?? "";
		expect(wide).toBe("");
	});

	test("전체 프레임 클래스가 상자 높이·가로 스크롤을 풀고 이미지를 폭 100%로 둔다", () => {
		expect(STYLE).toMatch(/\n\.frame-pan--full \.frame-pan-scroll\s*\{[^}]*overflow:\s*visible[^}]*height:\s*auto/);
		expect(STYLE).toMatch(/\.frame-pan--full \.frame-pan-scroll img[^{]*\{[^}]*width:\s*100%[^}]*height:\s*auto/);
		expect(STYLE).toMatch(/\.frame-pan--full \.frame-pan-scroll \.frame-link\s*\{[^}]*height:\s*auto/);
		const desktop = STYLE.match(/@media \(min-width: 641px\) \{[\s\S]*?\n\}/)?.[0] ?? "";
		expect(desktop).toMatch(/\.frame-pan-scroll\s*\{[^}]*height:\s*300px/);
	});
});

// ── 지적 라벨 · 추정 행위자 ────────────────────────────────────────────────────────

describe("제목의 -ㅁ 지적 조각 앞에 '지적' 라벨", () => {
	const titleOf = (title: string) => {
		const data = sampleData();
		data.units[0].title = title;
		return parseHTML(renderSession(data)).document.querySelector("#u001 h3");
	};

	test("-ㅁ 조각 앞에만 라벨을 붙이고 -기 할 일 조각에는 붙이지 않는다", () => {
		const h3 = titleOf("뎁스차저: 더 벌리기 / 홍길동: 첫판부터 정신 놓음");
		const labels = [...(h3?.querySelectorAll(".title-fault-label") ?? [])];
		expect(labels.map((el) => el.textContent)).toEqual(["지적"]);
		expect(plain(h3?.textContent)).toBe("뎁스차저: 더 벌리기 / 지적 홍길동: 첫판부터 정신 놓음");
		expect(plain(labels[0].closest(".title-part")?.textContent)).toContain("정신 놓음");
		expect(h3?.querySelectorAll(".title-part").length).toBe(2);
	});

	test("조각이 하나뿐인 -ㅁ 제목에도 라벨이 붙는다", () => {
		const h3 = titleOf("홍길동: 첫판부터 정신 놓음");
		expect(plain(h3?.textContent)).toBe("지적 홍길동: 첫판부터 정신 놓음");
	});

	test("지적 조각이 없으면 제목은 그대로이고 라벨도 없다", () => {
		const h3 = titleOf("뎁스차저: 더 벌리기");
		expect(h3?.querySelector(".title-fault-label")).toBeNull();
		expect(plain(h3?.textContent)).toBe("뎁스차저: 더 벌리기");
	});

	test("라벨 CSS는 작은 크기·줄바꿈 금지다", () => {
		expect(STYLE).toMatch(/\n\.title-fault-label\s*\{[^}]*white-space:\s*nowrap/);
	});
});

describe("look_at 단독 — 받는 사람이 안 보이는 카드", () => {
	test("위치 미확인 인물이 없어도 look_at이 있으면 '사진에서 볼 곳' 줄만 보인다", () => {
		const data = sampleData();
		data.units[0].look_at = "화면 아래쪽 공을 받을 빈 공간";
		const doc = parseHTML(renderSession(data)).document;
		expect(doc.querySelector("#u001 .unidentified-members")).toBeNull();
		expect(plain(doc.querySelector("#u001 .look-at")?.textContent)).toBe("사진에서 볼 곳: 화면 아래쪽 공을 받을 빈 공간");
	});
});

describe("inferred_member_ids — 추정한 행위자 표시", () => {
	test("추정한 고칠 사람 이름 옆에만 '(추정 — 문장에 주어 없음)'을 붙인다", () => {
		const data = sampleData();
		data.units[0].member_ids = ["hong", "kim"];
		data.units[0].inferred_member_ids = ["hong"];
		const line = parseHTML(renderSession(data)).document.querySelector("#u001 .mentioned-members:not(.named-members)");
		const marks = [...(line?.querySelectorAll(".inferred-mark") ?? [])];
		expect(marks.map((el) => el.textContent)).toEqual(["(추정 — 문장에 주어 없음)"]);
		expect(marks[0].previousElementSibling?.getAttribute("data-member-id")).toBe("hong");
		expect(plain(line?.textContent)).toBe("고칠 사람: 홍길동(추정 — 문장에 주어 없음), 김철수");
	});

	test("위치를 확인하지 못한 사람 줄에는 추정 표시를 반복하지 않는다(고칠 사람 줄에만 있다)", () => {
		const data = sampleData();
		data.units[0].unidentified_member_ids = ["hong"];
		data.units[0].look_at = "화면 위쪽";
		data.units[0].inferred_member_ids = ["hong"];
		const doc = parseHTML(renderSession(data)).document;
		expect(plain(doc.querySelector("#u001 .unidentified-members")?.textContent)).toBe("사진에서 위치를 확인하지 못한 사람: 홍길동");
		expect(doc.querySelectorAll("#u001 .inferred-mark")).toHaveLength(1);
	});

	test(".inferred-mark는 줄바꿈하지 않는다", () => {
		expect(STYLE).toMatch(/\.inferred-mark\s*\{[^}]*white-space:\s*nowrap/);
	});


	test("필드가 없는 옛 data.json은 이름 있는 변환 함수가 추정 없음([])으로 읽는다", () => {
		expect(inferredMemberIdsFromLegacyData({})).toEqual([]);
		expect(inferredMemberIdsFromLegacyData({ inferred_member_ids: ["hong"] })).toEqual(["hong"]);
		const doc = parseHTML(renderSession(sampleData())).document;
		expect(doc.querySelector(".inferred-mark")).toBeNull();
	});
});

// ── 경기 구분선 · 내 피드백 그룹 순서 ────────────────────────────────────────────────

describe("카드 흐름의 경기 구분선", () => {
	/** 카드 순서 u001·u002(1경기) → u003(2경기). */
	function twoMatchData(): SessionDataInput {
		const data = sampleData();
		data.units[2].match_id = "m2";
		data.units[2].topic_id = "m2-t1";
		data.matches[0].topics[0].unit_ids = ["u001"];
		data.matches.push({ id: "m2", title: "2경기 · AL 대 LVT", topics: [{ id: "m2-t1", title: "전환 속도", summary: "역습 전환", unit_ids: ["u003"] }] });
		return data;
	}
	const flow = (doc: Document) => [...(doc.querySelector(".card-list")?.children ?? [])].map((el) => (el.classList.contains("match-divider") ? `D:${plain(el.textContent)}` : el.id));

	test("연속한 카드의 경기가 바뀌는 자리에 경기 제목 머리글을 넣는다", () => {
		const doc = parseHTML(renderSession(twoMatchData())).document;
		expect(flow(doc)).toEqual(["u001", "u002", "D:2경기 · AL 대 LVT", "u003"]);
		expect(doc.querySelector(".match-divider")?.tagName).toBe("H2");
	});

	describe("피드백 없는 경기는 제목의 'N경기' 순번으로 영상 순서 자리에 선다", () => {
		const noFeedbackFlow = (doc: Document) =>
			[...(doc.querySelector(".card-list")?.children ?? [])].map((el) => (el.classList.contains("match-divider") ? `D:${plain(el.textContent)}` : el.classList.contains("match-no-feedback") ? `N:${plain(el.textContent)}` : el.id));
		function gapData(): SessionDataInput {
			const data = twoMatchData();
			data.matches[0].title = "1경기 · LVT 대 HR";
			data.matches[1].title = "3경기 · FCB 대 LVT";
			data.matches_without_feedback = ["4경기 · COP 대 LVT", "2경기 · LVT 대 ALB", "자유 제목"];
			return data;
		}

		test("카드 흐름에서 순번이 앞서는 피드백 있는 경기의 구분선 바로 앞에 선다", () => {
			const doc = parseHTML(renderSession(gapData())).document;
			expect(noFeedbackFlow(doc)).toEqual(["u001", "u002", "N:2경기 · LVT 대 ALB — 피드백 없음", "D:3경기 · FCB 대 LVT", "u003"]);
		});

		test("맨 앞 경기가 피드백 없으면 첫 카드 앞에 서고, 뒤쪽·순번 없는 제목은 카드 목록 뒤 블록에 남는다", () => {
			const data = gapData();
			data.matches[0].title = "2경기 · LVT 대 ALB";
			data.matches_without_feedback = ["1경기 · 앞 경기", "4경기 · COP 대 LVT", "자유 제목"];
			const doc = parseHTML(renderSession(data)).document;
			expect(noFeedbackFlow(doc)[0]).toBe("N:1경기 · 앞 경기 — 피드백 없음");
			expect([...doc.querySelectorAll(".main > .matches-without-feedback > .match-no-feedback")].map((el) => plain(el.textContent))).toEqual(["4경기 · COP 대 LVT — 피드백 없음", "자유 제목 — 피드백 없음"]);
		});

		test("경기별 목차에도 같은 자리에 '제목 — 피드백 없음' 줄이 서고, 맨 뒤 것도 목차에는 실린다", () => {
			const doc = parseHTML(renderSession(gapData())).document;
			const tocOrder = [...doc.querySelectorAll("#panel-match > *")].map((el) => (el.classList.contains("toc-no-feedback") ? `N:${plain(el.textContent)}` : `G:${plain(el.querySelector("h2")?.textContent)}`));
			expect(tocOrder).toEqual(["G:1경기 · LVT 대 HR", "N:2경기 · LVT 대 ALB — 피드백 없음", "G:3경기 · FCB 대 LVT", "N:4경기 · COP 대 LVT — 피드백 없음", "N:자유 제목 — 피드백 없음"]);
		});

		test("내 피드백을 고르면 경기 구분선처럼 사라진다", () => {
			const { doc } = mountViewer(renderSession(gapData()), false);
			const row = doc.querySelector(".card-list .match-no-feedback");
			expect(isHidden(row)).toBe(false);
			clickMinePill(doc, "hong");
			expect(isHidden(row)).toBe(true);
			clickMinePill(doc, "hong");
			expect(isHidden(row)).toBe(false);
		});
	});

	describe("머리 위 표시 색 범례(marker_legend)", () => {
		const LEGEND = [
			{ member_id: "hong", color: "분홍" },
			{ member_id: "kim", color: "민트" },
		];
		const LEGEND_TEXT = "머리 위 표시: 홍길동 분홍 삼각형 · 김철수 민트 삼각형";
		const NBSP_LEGEND_ENTRY = `홍길동${NBSP}분홍${NBSP}삼각형`;

		test("경기 구분선에 이름 + 색 + 삼각형 범례를 싣는다", () => {
			const data = twoMatchData();
			data.matches[1].marker_legend = LEGEND;
			const doc = parseHTML(renderSession(data)).document;
			expect(plain(doc.querySelector(".match-divider .marker-legend")?.textContent)).toBe(LEGEND_TEXT);
			expect(doc.querySelector(".match-divider .marker-legend")?.textContent).toContain(NBSP_LEGEND_ENTRY);
			expect(doc.querySelectorAll(".marker-legend")).toHaveLength(1);
		});

		test("구분선이 없는 첫 경기는 첫 카드에 범례를 싣는다", () => {
			const data = twoMatchData();
			data.matches[0].marker_legend = LEGEND;
			const doc = parseHTML(renderSession(data)).document;
			expect(plain(doc.querySelector("#u001 .marker-legend")?.textContent)).toBe(LEGEND_TEXT);
			expect(doc.querySelectorAll(".marker-legend")).toHaveLength(1);
			expect(doc.querySelector(".match-divider .marker-legend")).toBeNull();
		});

		test("색 항목이 없는 경기에는 범례가 없고, 필드가 없는 옛 data.json은 []로 읽는다", () => {
			const data = twoMatchData();
			data.matches[0].marker_legend = [];
			expect(parseHTML(renderSession(data)).document.querySelector(".marker-legend")).toBeNull();
			expect(markerLegendFromLegacyData({})).toEqual([]);
			expect(markerLegendFromLegacyData({ marker_legend: LEGEND })).toEqual(LEGEND);
		});
	});

	describe("범례의 명단에 없는 이름표(unmatched_name_tags)", () => {
		test("이름표 + 명단에 없음 + 색 + 삼각형을 이름 항목 뒤에 싣고, 색이 없으면 색 부분을 뺀다", () => {
			const data = twoMatchData();
			data.matches[1].marker_legend = [{ member_id: "hong", color: "분홍" }];
			data.matches[1].unmatched_name_tags = [{ tag: "SAMBA", color: "자홍" }, { tag: "ANG" }];
			const doc = parseHTML(renderSession(data)).document;
			expect(plain(doc.querySelector(".match-divider .marker-legend")?.textContent).replaceAll("\u2060", "")).toBe("머리 위 표시: 홍길동 분홍 삼각형 · SAMBA 이름표(명단에 없음) 자홍 삼각형 · ANG 이름표(명단에 없음)");
			expect(doc.querySelector(".match-divider .marker-legend")?.textContent?.replaceAll("\u2060", "")).toContain(`)${NBSP}자홍${NBSP}삼각형`);
		});

		test("이름 항목 없이 이름표 항목만 있어도 범례가 나오고, 필드가 없는 옛 data.json은 []로 읽는다", () => {
			const data = twoMatchData();
			data.matches[1].unmatched_name_tags = [{ tag: "SAMBA", color: "자홍" }];
			expect(plain(parseHTML(renderSession(data)).document.querySelector(".marker-legend")?.textContent).replaceAll("\u2060", "")).toBe("머리 위 표시: SAMBA 이름표(명단에 없음) 자홍 삼각형");
			expect(unmatchedNameTagsFromLegacyData({})).toEqual([]);
			expect(unmatchedNameTagsFromLegacyData({ unmatched_name_tags: [{ tag: "ANG" }] })).toEqual([{ tag: "ANG" }]);
		});
	});

	test("한 경기뿐인 세션에는 구분선이 없다", () => {
		expect(parseHTML(renderSession(sampleData())).document.querySelector(".match-divider")).toBeNull();
	});

	test("그 경기 카드가 필터로 모두 가려지면 구분선도 가려지고, 해제하면 돌아온다", () => {
		const { doc } = mountViewer(renderSession(twoMatchData()), false);
		const divider = () => doc.querySelector(".match-divider");
		expect(isHidden(divider())).toBe(false);
		clickChip(doc, "position", "GK"); // u002만 남는다
		expect(isHidden(divider())).toBe(true);
		clickChip(doc, "position", "GK");
		clickChip(doc, "position", "ST"); // u003만 남는다
		expect(isHidden(divider())).toBe(false);
	});

	test("내 피드백을 고르면 구분선이 숨고(그룹이 경기 순서를 깬다) 해제하면 원래 자리로 돌아온다", () => {
		const { doc } = mountViewer(renderSession(twoMatchData()), false);
		clickMinePill(doc, "hong");
		expect(isHidden(doc.querySelector(".match-divider"))).toBe(true);
		clickMinePill(doc, "hong");
		expect(flow(doc)).toEqual(["u001", "u002", "D:2경기 · AL 대 LVT", "u003"]);
		expect(isHidden(doc.querySelector(".match-divider"))).toBe(false);
	});

	test("구분선 CSS는 hidden이면 사라지고 390px에서도 줄바꿈된다", () => {
		expect(STYLE).toMatch(/\n\.match-divider\[hidden\]\s*\{\s*display:\s*none/);
		expect(STYLE).toMatch(/\n\.match-divider\s*\{[^}]*overflow-wrap:\s*anywhere/);
	});
});

describe("내 피드백 그룹 순서 — 이름이 나온 장면은 고칠 점 바로 뒤", () => {
	test("고칠 점 → 이름이 나온 장면 → 내 포지션 대상 → 전원 대상 → 같은 포지션 참고", () => {
		const keys = [...VIEWER_JS.matchAll(/\{ key: "(\w+)", label: "([^"]+)" \}/g)].map((m) => m[2]);
		expect(keys).toEqual(["고칠 점", "이름이 나온 장면", "내 포지션 대상", "전원 대상", "같은 포지션 참고"]);
	});

	test("이름만 나온 카드는 선택 시 고칠 점 그룹 바로 아래에 온다", () => {
		const data = sampleData();
		data.units[1].named_member_ids = ["hong"]; // u002: hong 이름만 나옴
		const { doc } = mountViewer(renderSession(data), false);
		clickMinePill(doc, "hong");
		const headings = [...doc.querySelectorAll(".mine-group-heading")].map((el) => plain(el.textContent));
		expect(headings.slice(0, 2)).toEqual(["고칠 점 1", "이름이 나온 장면 1"]);
	});
});

describe("카드의 '고칠 행동 없음' 줄", () => {
	const NO_ACTION = "피드백에 고칠 행동은 적혀 있지 않다 — 장면 줄 참고";
	const lessonRef = {
		id: "r-w", title: "강의", source_name: "Example Channel", lang: "ko", kind: "tactics" as const, href: null, orig_url: "https://example.com/w",
		format: "article" as const, relevance_ko: "관련", lesson_ko: "포백이 한 줄로 선다", start_seconds: null, version_badge: null, published_badge: null, pro_clubs: false,
	};
	const lineOf = (overrides: Partial<SessionUnit>) => {
		const data = sampleData();
		Object.assign(data.units[0], overrides);
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		return plain(card?.querySelector(".no-action")?.textContent);
	};

	test("제목 조각이 모두 -ㅁ 지적이고 어느 자료도 lesson_ko를 주지 않으면 제목 아래에 한 줄을 렌더한다", () => {
		expect(lineOf({ title: "센터백: 첫판부터 정신 놓음", fault_scene: "수비 라인이 갈라졌다" })).toBe(NO_ACTION);
		expect(lineOf({ title: "센터백: 첫판부터 정신 놓음 / 골키퍼: 뒷공간을 내줌", fault_scene: "수비 라인이 갈라졌다" })).toBe(NO_ACTION);
		const data = sampleData();
		Object.assign(data.units[0], { title: "센터백: 첫판부터 정신 놓음", fault_scene: "수비 라인이 갈라졌다" });
		const card = parseHTML(renderSession(data)).document.getElementById("u001");
		expect(card?.querySelector("h3")?.nextElementSibling?.classList.contains("no-action")).toBe(true);
	});

	test("-기 조각이 하나라도 있거나, lesson_ko를 주는 자료가 있으면 렌더하지 않는다", () => {
		expect(lineOf({ title: "센터백: 더 벌리기 / 골키퍼: 뒷공간을 내줌", fault_scene: "수비 라인이 갈라졌다" })).toBe("");
		expect(lineOf({ title: "센터백: 첫판부터 정신 놓음", fault_scene: "수비 라인이 갈라졌다", refs: [lessonRef] })).toBe("");
		expect(lineOf({ title: "센터백: 라인 올리기" })).toBe("");
	});

	test("장면 줄이 없는 카드(방향 확인 필요 카드)는 '장면 줄 참고' 없이 앞 문장만 쓴다", () => {
		expect(lineOf({ title: "센터백: 첫판부터 정신 놓음", fault_scene: null, direction_check_ko: "사진에서 몰린 쪽은 화면 위쪽" })).toBe("피드백에 고칠 행동은 적혀 있지 않다");
	});
});

describe("본문 프레임의 시각 칩 — 카드 시작과 같은 시각이면 생략", () => {
	const frameData = (frameT: number) => {
		const data = sampleData();
		Object.assign(data.units[0], {
			start: 754,
			body: [
				{ type: "text", text: "본문" },
				{ type: "frame", src: "img/u001-c001.webp", width: 1280, height: 720, t: frameT, caption: "첫 프레임" },
			],
		});
		return parseHTML(renderSession(data)).document.querySelector("#u001 .body-frame");
	};

	test("프레임 t가 유닛 시작과 같은 m:ss면 칩이 없고 캡션·확대 링크는 남는다", () => {
		for (const t of [754, 754.6]) {
			const frame = frameData(t);
			expect(frame?.querySelector(".seek-btn")).toBeNull();
			expect(plain(frame?.querySelector(".body-frame-caption")?.textContent)).toBe("첫 프레임");
			expect(frame?.querySelector(".zoom-link")).not.toBeNull();
			expect(frame?.classList.contains("no-time-chip")).toBe(true);
			expect(frame?.getAttribute("data-frame-t")).toBe(String(t));
		}
	});

	test("시작과 다른 m:ss의 프레임은 칩을 그대로 보인다", () => {
		for (const t of [755, 760]) {
			const frame = frameData(t);
			expect(frame?.querySelector(".seek-btn")?.getAttribute("data-seek-t")).toBe(String(t));
			expect(frame?.classList.contains("no-time-chip")).toBe(false);
		}
	});

	test("칩이 없는 캡션 줄은 열 두 개(캡션 | 확대) 그리드를 쓴다", () => {
		expect(STYLE).toMatch(/\.body-frame\.no-time-chip figcaption\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto/);
	});
});

describe("데스크톱 목차 아래쪽 페이드", () => {
	test("1024px 이상에서 .toc-scroll에 아래쪽 마스크가 있고, 끝까지 스크롤하면 마지막 줄이 가려지지 않게 아래 여백을 둔다", () => {
		const desktop = STYLE.slice(STYLE.indexOf("@media (min-width: 1024px)"));
		const rule = desktop.match(/\.toc-scroll\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(rule).toMatch(/mask-image:\s*linear-gradient\(to bottom,/);
		expect(rule).toMatch(/-webkit-mask-image:\s*linear-gradient\(to bottom,/);
		expect(rule).toMatch(/padding-bottom:/);
		expect(STYLE.slice(0, STYLE.indexOf("@media (min-width: 1024px)"))).not.toMatch(/\.toc-scroll\s*\{[^}]*mask-image/);
	});
});
