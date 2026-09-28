import { Event as DomEvent, parseHTML } from "linkedom";
import { describe, expect, test } from "bun:test";

import { posClosure, relatedMembers, type Member, type Roster } from "./core.ts";
import {
	glueKorean,
	renderIndex,
	renderRef,
	renderSession,
	STYLE,
	VIEWER_JS,
	type ArchiveIndex,
	type SessionData,
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
	};
}

// ── helpers ───────────────────────────────────────────────────────────────

const XSS_PAYLOAD = '"><script>alert(1)</script>';
const NBSP = " ";

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

	test("번역 표의 각 셀은 data-label을 갖는다(<1024px 스택 레이아웃의 라벨 소스, 라운드6 CJK 검토)", () => {
		const doc = parseHTML(
			renderRef({
				id: "r-1",
				title: "제목",
				lang: "en",
				kind: "eafc",
				url: "https://example.com",
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
				url: "https://example.com",
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
		expect(figure?.querySelector("figcaption")?.textContent).toContain(frameBlock?.caption ?? "");
	});

	test("언급된 팀원 줄은 member_ids를, 관련 팀원 줄은 relatedMembers \\ member_ids를 보인다(DESIGN §5 item 6/8)", () => {
		const data = sampleData();
		const doc = parseHTML(renderSession(data)).document;

		// u001: member_ids=["hong"], relatedMembers=hong(직접 언급)+kim(FB 포지션 관련) — 차집합은 kim만 남는다.
		const mentionedU001 =
			doc.getElementById("u001")?.querySelector(".mentioned-members")?.textContent ?? "";
		expect(mentionedU001).toBe("언급: 홍길동");
		const relatedU001 =
			doc.getElementById("u001")?.querySelector(".related-members")?.textContent ?? "";
		expect(relatedU001).toBe("관련: 김철수");

		// u002: member_ids=[]이므로 "언급된 팀원" 줄 자체가 렌더되지 않고, relatedMembers 전체가 관련 줄에 남는다.
		expect(doc.getElementById("u002")?.querySelector(".mentioned-members")).toBeNull();
		const expectedU002 = relatedMembers({ member_ids: [], position_tags: ["GK"] }, ROSTER).map(
			(member) => member.name,
		);
		const relatedU002 =
			doc.getElementById("u002")?.querySelector(".related-members")?.textContent ?? "";
		expect(relatedU002).toBe(`관련: ${expectedU002.join(", ")}`);
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

	test("목차 항목은 시각 칩을 함께 보인다(DESIGN §8)", () => {
		const doc = parseHTML(renderSession(sampleData())).document;
		const item = doc.querySelector('#panel-match .toc-item[data-target="u001"]');
		expect(item?.querySelector(".chip-time")?.textContent).toBe("12:34");
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
		expect(badgeU001Kim?.textContent).toBe("포지션 관련(참고)");
		expect(badgeU001Kim?.classList.contains("mention-related")).toBe(true);
		expect(isHidden(doc.getElementById("u002")?.querySelector(".mention-badge") ?? null)).toBe(true);

		clickMinePill(doc, "kim"); // 토글 해제
		clickMinePill(doc, "hong"); // hong: u001의 member_ids에 직접 있다 → "직접 언급".
		const badgeU001Hong = doc.getElementById("u001")?.querySelector(".mention-badge");
		expect(badgeU001Hong?.textContent).toBe("직접 언급");
		expect(badgeU001Hong?.classList.contains("mention-direct")).toBe(true);
	});

	test("선택 시 언급/관련 목록에서 해당 이름만 mark.mine으로 강조된다", () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);
		clickMinePill(doc, "hong");
		const mark = doc.getElementById("u001")?.querySelector('.member-name[data-member-id="hong"]');
		expect(mark?.tagName.toLowerCase()).toBe("mark");
		expect(mark?.classList.contains("mine")).toBe(true);
	});

	test('"내 피드백" 선택 시 card-list에 mine-active가, 직접 언급 카드에만 is-direct가 붙는다(30초 기준, DESIGN §6)', () => {
		const { doc } = mountViewer(renderSession(sampleData()), false);

		clickMinePill(doc, "kim"); // kim: u001에 포지션(FB) 관련만 있고 직접 언급은 없다.
		expect(doc.querySelector(".card-list")?.classList.contains("mine-active")).toBe(true);
		expect(doc.getElementById("u001")?.classList.contains("is-direct")).toBe(false);

		clickMinePill(doc, "kim"); // 토글 해제
		clickMinePill(doc, "hong"); // hong: u001의 member_ids에 직접 있다.
		expect(doc.getElementById("u001")?.classList.contains("is-direct")).toBe(true);

		clickMinePill(doc, "hong"); // 해제 시 둘 다 지워진다.
		expect(doc.querySelector(".card-list")?.classList.contains("mine-active")).toBe(false);
		expect(doc.getElementById("u001")?.classList.contains("is-direct")).toBe(false);
	});

	test("STYLE은 mine-active 상태에서 직접 언급이 아닌 카드에 order:1을 주어 위로 뜨지 않게 한다(DESIGN §6)", () => {
		expect(STYLE).toMatch(/\.card-list\.mine-active\s+\.card:not\(\.is-direct\)\s*\{\s*order:\s*1;?\s*\}/);
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

describe("제목의 한글단어(영문) 줄바꿈 방지", () => {
	test('"비활성(disabled)"처럼 괄호 앞에서 줄바꿈되지 않도록 nobr로 감싼다', () => {
		const data = sampleData();
		data.title = "QA 비활성(disabled) 모드 세션";
		data.units[0].title = "QA 비활성(disabled) 모드 세션";
		const doc = parseHTML(renderSession(data)).document;

		const h1 = doc.querySelector(".header h1");
		expect(h1?.innerHTML).toContain('<span class="nobr">비활성(disabled)</span>');

		const cardTitle = doc.getElementById("u001")?.querySelector("h3");
		expect(cardTitle?.innerHTML).toContain('<span class="nobr">비활성(disabled)</span>');

		const tocItem = doc.querySelector('#panel-match .toc-item[data-target="u001"]');
		expect(tocItem?.innerHTML).toContain('<span class="nobr">비활성(disabled)</span>');
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
				url: "https://example.com",
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
