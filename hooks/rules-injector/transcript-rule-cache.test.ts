import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
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

test("변경 없음과 JSONL 추가 시 쿼리 결과 보존", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '{"text":"body"}\n');
	const query = { body: "body", marker: '<rules name="x">' };
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
	writeFileSync(transcript, '{"text":"body"}\n<rules name="x">\n', "utf8");
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
		[
			'<rules name="x">\nold body',
			JSON.stringify({ type: "compacted", payload: { replacement_history: ["new body"] } }),
			'<rules name="y">\nnew body',
		].join("\n"),
	);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "old body", marker: '<rules name="x">' }], {
			latestCompactedReplacementOnly: true,
		}),
	).toEqual([false]);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "new body", marker: '<rules name="y">' }], {
			latestCompactedReplacementOnly: true,
		}),
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
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "old", marker: '<rules name="old">' }]),
	).toEqual([true]);
	appendFileSync(
		transcript,
		`${JSON.stringify({ type: "compacted", payload: { replacement_history: ["new body"] } })}\n<rules name="new">\nnew body\n`,
	);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "old body", marker: '<rules name="old">' }], {
			latestCompactedReplacementOnly: true,
		}),
	).toEqual([false]);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "new body", marker: '<rules name="new">' }], {
			latestCompactedReplacementOnly: true,
		}),
	).toEqual([true]);
});

test("대기 바이트가 완성된 원문 줄에 중복되지 않음", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, "abc");
	const query = { body: "cabc", marker: "M" };
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
	appendFileSync(transcript, "def\nM\n");
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
});

test("압축 이벤트 없는 최신 모드는 증거 없음", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, '<rules name="x">\nbody\n');
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "body", marker: '<rules name="x">' }], {
			latestCompactedReplacementOnly: true,
		}),
	).toEqual([false]);
});

test("큰 안정 접두부에서 추가 후 대기 미리보기 보존", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${"x".repeat(12_000)}M\npre\nabc`);
	const query = { body: "pre\nabc", marker: "M" };
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([true]);
	appendFileSync(transcript, "\nxyz");
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([true]);
});

test("디코딩된 JSON 문자열은 추가 레코드 사이 구분자를 보존", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${"x".repeat(12_000)}${JSON.stringify({ text: "ab" })}`);
	const query = { body: "abcd", marker: "M" };
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
	appendFileSync(transcript, `${JSON.stringify({ text: "cd" })}`);
	expect(queryTranscriptRuleCache(transcript, [query])).toEqual([false]);
});

test("최신 모드는 줄바꿈 없는 유효한 압축 레코드를 미리보기", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(
		transcript,
		`${"x".repeat(12_000)}\n${JSON.stringify({ type: "compacted", payload: { replacement_history: ["new body", "M"] } })}`,
	);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "new body", marker: "M" }], {
			latestCompactedReplacementOnly: true,
		}),
	).toEqual([true]);
});

test("최신 대기 압축 미리보기는 우선하며 추가 페이로드 문자열을 제외", () => {
	const transcript = join(dir, "t.jsonl");
	writeFileSync(transcript, `${"x".repeat(12_000)}\n<rules name="old">\nold body\n`);
	const old = { body: "old body", marker: '<rules name="old">' };
	expect(queryTranscriptRuleCache(transcript, [old])).toEqual([true]);
	appendFileSync(
		transcript,
		JSON.stringify({
			type: "compacted",
			payload: { replacement_history: ["new body", "M"], secret: "old body" },
		}),
	);
	expect(
		queryTranscriptRuleCache(transcript, [old], { latestCompactedReplacementOnly: true }),
	).toEqual([false]);
	expect(
		queryTranscriptRuleCache(transcript, [{ body: "secret", marker: "M" }], {
			latestCompactedReplacementOnly: true,
		}),
	).toEqual([false]);
});

test("최신 대기 압축이 안정 압축 증거를 교체", () => {
	const transcript = join(dir, "t.jsonl");
	const oldCompact = JSON.stringify({
		type: "compacted",
		payload: { replacement_history: ["old body", "M"] },
	});
	writeFileSync(transcript, `${"x".repeat(12_000)}\n${oldCompact}\n`);
	const old = { body: "old body", marker: "M" };
	expect(
		queryTranscriptRuleCache(transcript, [old], { latestCompactedReplacementOnly: true }),
	).toEqual([true]);
	appendFileSync(
		transcript,
		JSON.stringify({ type: "compacted", payload: { replacement_history: ["new body", "M"] } }),
	);
	expect(
		queryTranscriptRuleCache(transcript, [old], { latestCompactedReplacementOnly: true }),
	).toEqual([false]);
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
