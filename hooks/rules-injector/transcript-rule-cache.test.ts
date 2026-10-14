import { test, expect, beforeEach, afterEach } from "bun:test";
import {
	appendFileSync,
	closeSync,
	mkdtempSync,
	openSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryTranscriptRuleCache } from "./transcript-rule-cache.js";

let dir = "";
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "transcript-rule-cache-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const LATEST = { latestCompactedReplacementOnly: true } as const;
const compacted = (history: unknown[], extra: Record<string, unknown> = {}) =>
	JSON.stringify({ type: "compacted", payload: { replacement_history: history, ...extra } });

// Whole seconds survive utimes exactly; a fractional mtime may not round-trip.
const PINNED_MTIME = 1_700_000_000;
function pinMtime(path: string): void {
	utimesSync(path, PINNED_MTIME, PINNED_MTIME);
}

/**
 * Blanks bytes in place while keeping size and the pinned mtime, so the cache
 * cannot tell the file changed. A query that still finds the blanked block was
 * answered from the index; a query that rescanned from offset 0 would not.
 */
function blankWithoutTrace(path: string, from: number, length: number): void {
	const fd = openSync(path, "r+");
	try {
		writeSync(fd, Buffer.alloc(length, 0x20), 0, length, from);
	} finally {
		closeSync(fd);
	}
	pinMtime(path);
}

test("변경 없음과 JSONL 추가 시 쿼리 결과 보존", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '{"text":"body"}\n');
	const query = { body: "body", marker: '<rules name="x">' };
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
	appendFileSync(transcript, `${JSON.stringify({ text: '<rules name="x">\nbody\n</rules>' })}\n`);
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([true]);
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([true]);
});

test("지연 쿼리는 이력을 검색하고 손상된 캐시는 안전하게 대체", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '<rules name="x">\nold body\n');
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "old body", marker: '<rules name="x">' }]),
	).toEqual([true]);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "old", marker: '<rules name="x">' }]),
	).toEqual([true]);
	writeFileSync(`${transcript}.rule-cache.json`, "not json");
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "old body", marker: '<rules name="x">' }]),
	).toEqual([true]);
});

test("최신 압축 모드는 교체 이력 이전의 증거를 제외", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(
		transcript,
		['<rules name="x">\nold body', compacted(["new body"]), '<rules name="y">\nnew body'].join(
			"\n",
		),
	);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "old body", marker: '<rules name="x">' }], LATEST),
	).toEqual([false]);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "new body", marker: '<rules name="y">' }], LATEST),
	).toEqual([true]);
});

test("부분 UTF-8 마지막 줄은 추가 시 완성", () => {
	const transcript = join(dir, "t.jsonl");
	const query = { body: "몸상태", marker: '<rules name="x">' };
	const bytes = Buffer.from('<rules name="x">\n몸상태\n', "utf8");
	writeFileSync(transcript, bytes.subarray(0, bytes.length - 2));
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
	appendFileSync(transcript, bytes.subarray(bytes.length - 2));
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([true]);
});

test("새 쿼리는 제한된 이력을 검색하고 교체 시 기존 증거를 초기화", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '<rules name="old">\nold body\n');
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "old body", marker: '<rules name="old">' }]),
	).toEqual([true]);
	appendFileSync(transcript, `${compacted(["new body"])}\n<rules name="new">\nnew body\n`);
	expect(
		queryTranscriptRuleCache(
			transcript,
			[{ body: "old body", marker: '<rules name="old">' }],
			LATEST,
		),
	).toEqual([false]);
	expect(
		queryTranscriptRuleCache(
			transcript,
			[{ body: "new body", marker: '<rules name="new">' }],
			LATEST,
		),
	).toEqual([true]);
});

test("대기 바이트가 완성된 원문 줄에 중복되지 않음", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '<rules name="x">\nabc');
	const doubled = { body: "abcabc", marker: '<rules name="x">' };
	expect(queryTranscriptRuleCache(transcript, [doubled])).toEqual([false]);
	appendFileSync(transcript, "def\n");
	expect(queryTranscriptRuleCache(transcript, [doubled])).toEqual([false]);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "abcdef", marker: '<rules name="x">' }]),
	).toEqual([true]);
});

test("압축 이벤트 없는 최신 모드는 증거 없음", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '<rules name="x">\nbody\n');
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "body", marker: '<rules name="x">' }], LATEST),
	).toEqual([false]);
});

test("큰 안정 접두부에서 추가 후 대기 미리보기 보존", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${"x".repeat(12_000)}\n<rules name="x">\npre\nabc`);
	const query = { body: "pre\nabc", marker: '<rules name="x">' };
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([true]);
	appendFileSync(transcript, "\nxyz");
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([true]);
});

test("디코딩된 JSON 문자열은 추가 레코드 사이 구분자를 보존", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${JSON.stringify({ text: '<rules name="x">\nab' })}\n`);
	appendFileSync(transcript, `${JSON.stringify({ text: "cd" })}\n`);
	const marker = '<rules name="x">';
	expect(queryTranscriptRuleCache(transcript, [{ body: "abcd", marker }])).toEqual([false]);
	expect(queryTranscriptRuleCache(transcript, [{ body: "ab\ncd", marker }])).toEqual([true]);
});

test("최신 모드는 줄바꿈 없는 유효한 압축 레코드를 미리보기", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${"x".repeat(12_000)}\n${compacted(['<rules name="x">\nnew body'])}`);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "new body", marker: '<rules name="x">' }], LATEST),
	).toEqual([true]);
});

test("최신 대기 압축 미리보기는 우선하며 추가 페이로드 문자열을 제외", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${"x".repeat(12_000)}\n<rules name="old">\nold body\n`);
	const old = { body: "old body", marker: '<rules name="old">' };
	expect(queryTranscriptRuleCache(transcript, [old])).toEqual([true]);
	appendFileSync(
		transcript,
		compacted(['<rules name="new">\nnew body'], { secret: '<rules name="old">\nold body' }),
	);
	expect(queryTranscriptRuleCache(transcript, [old], LATEST)).toEqual([false]);
});

test("최신 대기 압축이 안정 압축 증거를 교체", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${"x".repeat(12_000)}\n${compacted(['<rules name="x">\nold body'])}\n`);
	const old = { body: "old body", marker: '<rules name="x">' };
	expect(queryTranscriptRuleCache(transcript, [old], LATEST)).toEqual([true]);
	appendFileSync(transcript, compacted(['<rules name="x">\nnew body']));
	expect(queryTranscriptRuleCache(transcript, [old], LATEST)).toEqual([false]);
});

test("교대 쿼리 집합은 이력 캐시 항목을 보존", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '<rules name="a">\na body\n<rules name="b">\nb body\n');
	const a = { body: "a body", marker: '<rules name="a">' };
	const b = { body: "b body", marker: '<rules name="b">' };
	expect(queryTranscriptRuleCache(transcript, [a])).toEqual([true]);
	expect(queryTranscriptRuleCache(transcript, [b])).toEqual([true]);
	expect(queryTranscriptRuleCache(transcript, [a])).toEqual([true]);
});

test("태그와 본문이 서로 다른 곳에 있으면 주입된 것으로 보지 않음", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(
		transcript,
		`${JSON.stringify({ text: 'mentioning <rules name="x">\nsomething else' })}\n${JSON.stringify({ text: "body" })}\n`,
	);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "body", marker: '<rules name="x">' }]),
	).toEqual([false]);
});

test("본문이 바뀐 규칙은 이전 블록으로 판정하지 않음", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${JSON.stringify({ text: '<rules name="x">\nv1 body\n</rules>' })}\n`);
	const marker = '<rules name="x">';
	expect(queryTranscriptRuleCache(transcript, [{ body: "v1 body", marker }])).toEqual([true]);
	expect(queryTranscriptRuleCache(transcript, [{ body: "v2 body", marker }])).toEqual([false]);
});

test("본문 앞 2000자로 판정하고 그보다 짧게 잘린 블록은 주입된 것으로 보지 않음", () => {
	const transcript = join(dir, "t.jsonl");
	const body = "가".repeat(5_000);
	const marker = '<rules name="x">';
	writeFileSync(transcript, `${JSON.stringify({ text: `${marker}\n${body}\n</rules>` })}\n`);
	expect(queryTranscriptRuleCache(transcript, [{ body, marker }])).toEqual([true]);
	writeFileSync(
		transcript,
		`${JSON.stringify({ text: `${marker}\n${body.slice(0, 1_500)}\n</rules>` })}\n`,
	);
	expect(queryTranscriptRuleCache(transcript, [{ body, marker }])).toEqual([false]);
});

test("여러 추가에 걸쳐 이어진 블록 본문을 이어 붙여 판정", () => {
	const transcript = join(dir, "t.jsonl");
	const marker = '<rules name="x">';
	writeFileSync(transcript, `${JSON.stringify({ text: `${marker}\nfirst half` })}\n`);
	expect(queryTranscriptRuleCache(transcript, [{ body: "first half", marker }])).toEqual([true]);
	appendFileSync(transcript, `${JSON.stringify({ text: "second half" })}\n`);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "first half\nsecond half", marker }]),
	).toEqual([true]);
});

test("새 쿼리는 처음부터 다시 읽지 않고 색인에서 답함", () => {
	const transcript = join(dir, "t.jsonl");
	const head = `${"x".repeat(2_000)}\n`;
	const block = `${JSON.stringify({ text: '<rules name="early">\nearly body\n</rules>' })}\n`;
	writeFileSync(transcript, head + block);
	const warm = { body: "warm", marker: '<rules name="warm">' };
	expect(queryTranscriptRuleCache(transcript, [warm])).toEqual([false]);
	for (let i = 0; i < 50; i++) appendFileSync(transcript, `${JSON.stringify({ text: `turn ${i}` })}\n`);
	pinMtime(transcript);
	expect(queryTranscriptRuleCache(transcript, [warm])).toEqual([false]);
	blankWithoutTrace(transcript, head.length, block.length - 1);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "early body", marker: '<rules name="early">' }]),
	).toEqual([true]);
});

test("압축 모드를 바꿔도 처음부터 다시 읽지 않음", () => {
	const transcript = join(dir, "t.jsonl");
	const head = `${"x".repeat(2_000)}\n`;
	const before = `<rules name="a">\na body\n`;
	const after = `${compacted(['<rules name="b">\nb body'])}\n`;
	writeFileSync(transcript, head + before + after);
	pinMtime(transcript);
	const a = { body: "a body", marker: '<rules name="a">' };
	const b = { body: "b body", marker: '<rules name="b">' };
	expect(queryTranscriptRuleCache(transcript, [a])).toEqual([true]);
	blankWithoutTrace(transcript, head.length, before.length + after.length - 1);
	expect(queryTranscriptRuleCache(transcript, [b], LATEST)).toEqual([true]);
	expect(queryTranscriptRuleCache(transcript, [a], LATEST)).toEqual([false]);
	expect(queryTranscriptRuleCache(transcript, [a])).toEqual([true]);
});

test("잘리거나 교체된 파일은 색인을 다시 만듦", () => {
	const transcript = join(dir, "t.jsonl");
	const query = { body: "body", marker: '<rules name="x">' };
	writeFileSync(transcript, `${"x".repeat(2_000)}\n<rules name="x">\nbody\n`);
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([true]);
	writeFileSync(transcript, "short\n");
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
	rmSync(transcript);
	writeFileSync(transcript, `${"y".repeat(3_000)}\n`);
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
});

test("이전 형식의 캐시 파일은 버리고 다시 만듦", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '{"text":"body"}\n');
	const size = statSync(transcript).size;
	const query = { body: "body", marker: '<rules name="x">' };
	writeFileSync(
		`${transcript}.rule-cache.json`,
		JSON.stringify({
			version: 2,
			identity: { dev: 0, ino: 0, size, mtimeMs: 0 },
			cursor: size,
			queries: {
				[JSON.stringify([query.body, query.marker])]: { bodySeen: true, markerSeen: true },
			},
		}),
	);
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
});

test("JSON에서 <를 이스케이프한 태그도 색인", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '{"text":"\\u003crules name=\\"x\\">\\nbody"}\n');
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "body", marker: '<rules name="x">' }]),
	).toEqual([true]);
});
