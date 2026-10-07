import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { greenMetrics } from "./green-metrics.ts";

function work(files: Record<string, unknown>): string {
	const dir = mkdtempSync(join(tmpdir(), "green-metrics-"));
	for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
	return dir;
}

const lines = [
	{ i: 0, video: "V", start: 10, end: 25, text: "a", source: "comment", author: "@x" },
	{ i: 1, video: "V", start: 40, end: 55, text: "b", source: "comment", author: "@x" },
];
const plan = { matches: [{ topics: [{ units: [{ title: "A", start_line: 0, end_line: 0 }, { title: "B", start_line: 1, end_line: 1 }] }] }] };
const validated = {
	units: [
		{ id: "u001", video: "V", start: 10, end: 25, position_tags: [], topic_tags: [], member_ids: [] },
		{ id: "u002", video: "V", start: 40, end: 55, position_tags: [], topic_tags: [], member_ids: [] },
	],
};
const text = { type: "text", text: "t" };
const frame = { type: "frame", candidate_id: "c1", caption: "c" };
const refs = { refs: [{ format: "video", unit_ids: ["u001"] }] };

describe("greenMetrics", () => {
	test("모든 고정 기준을 채우면 pass, 추세 지표는 값만 보고한다", () => {
		const dir = work({
			"lines.json": lines,
			"plan.json": plan,
			"plan.validated.json": validated,
			"notes.json": { units: { u001: { blocks: [text, frame] }, u002: { blocks: [text, frame], unidentified_member_ids: ["m"] } } },
			"refs.verified.json": refs,
		});
		const result = greenMetrics(dir, null);
		expect(result.failures).toEqual([]);
		expect(result.trend).toEqual({ units: 2, frames: 2, unidentified_units: 1, refs: 1, video_refs: 1, units_with_refs: 1 });
	});

	test("본문이 사진 뒤인 카드, 댓글 누락, 영상 자료 0, gold F1 미달을 실패로 적는다", () => {
		const dir = work({
			"lines.json": lines,
			"plan.json": { matches: [{ topics: [{ units: [{ title: "A", start_line: 0, end_line: 0 }] }] }] },
			"plan.validated.json": validated,
			"notes.json": { units: { u001: { blocks: [frame, text] }, u002: { blocks: [text, frame] } } },
			"refs.verified.json": { refs: [{ format: "article", unit_ids: ["u001"] }] },
		});
		const gold = { version: 1 as const, video: "V", units: [{ start_line: 0, end_line: 0, start: 100, topic_tags: [], position_tags: [], member_ids: [] }] };
		const failures = greenMetrics(dir, gold).failures;
		expect(failures).toEqual([
			"댓글 줄 커버리지: 1건 문제",
			"본문 먼저 카드: 1/2",
			"영상 자료: 0개",
			"정답 단위 F1: 0.00 < 0.90",
		]);
	});

	test("음성과 댓글이 섞인 세션에서 음성만 든 유닛은 커버리지 문제가 아니고, 댓글 둘을 묶은 유닛은 문제다", () => {
		const mixedLines = [
			{ i: 0, video: "V", start: 0, end: 4, text: "s", source: "speech" },
			{ i: 1, video: "V", start: 10, end: 25, text: "a", source: "comment", author: "@x" },
			{ i: 2, video: "V", start: 40, end: 55, text: "b", source: "comment", author: "@x" },
		];
		const units = (ranges: number[][]) => ({ matches: [{ topics: [{ units: ranges.map(([start_line, end_line]) => ({ title: "T", start_line, end_line })) }] }] });
		const base = { "lines.json": mixedLines, "plan.validated.json": validated, "notes.json": { units: {} }, "refs.verified.json": refs };
		expect(greenMetrics(work({ ...base, "plan.json": units([[0, 0], [1, 1], [2, 2]]) }), null).failures).toEqual([]);
		expect(greenMetrics(work({ ...base, "plan.json": units([[0, 0], [1, 2]]) }), null).failures).toEqual(["댓글 줄 커버리지: 1건 문제"]);
	});

	test("정답 단위의 줄 중 plan 유닛 범위에 든 비율을 줄 재현율로 보고하고 막지는 않는다", () => {
		const dir = work({
			"lines.json": [],
			"plan.json": { matches: [{ topics: [{ units: [{ title: "A", start_line: 0, end_line: 2 }, { title: "B", start_line: 5, end_line: 5 }] }] }] },
			"plan.validated.json": validated,
			"notes.json": { units: {} },
			"refs.verified.json": refs,
		});
		const gold = {
			version: 1 as const,
			video: "V",
			units: [
				{ start_line: 0, end_line: 3, start: 10, topic_tags: [], position_tags: [], member_ids: [] },
				{ start_line: 4, end_line: 5, start: 40, topic_tags: [], position_tags: [], member_ids: [] },
			],
		};
		const result = greenMetrics(dir, gold);
		expect(result.gold_line_recall).toBe(4 / 6);
		expect(result.failures).not.toContain(expect.stringContaining("재현율"));
		expect(greenMetrics(dir, null).gold_line_recall).toBeNull();
	});
});
