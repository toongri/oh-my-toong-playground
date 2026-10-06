// GREEN-run metrics for quality-gates.md §0: fixed pass/fail criteria plus trend values that are only reported.
// usage: bun green-metrics.ts <work-dir> [<gold.units.json>]  — prints JSON, exit 1 when a fixed criterion fails.
import { join } from "node:path";

import { type Gold, type PredictedUnit, asRecord, matchUnits, parseGold, readJsonFile, scoreUnitF1, stringArray } from "./score.ts";

/** Unit F1 against gold at or above this passes (round-15 measured 1.00 for the best model). */
export const GOLD_UNIT_F1_MIN = 0.9;

export interface GreenMetrics {
	failures: string[];
	trend: { units: number; frames: number; unidentified_units: number; refs: number; video_refs: number; units_with_refs: number };
	unit_f1: number | null;
	/** Share of gold-unit lines that fall inside some plan unit's line range — trend only (unit F1 matches starts, not end boundaries). */
	gold_line_recall: number | null;
}

function records(value: unknown): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	for (const item of Array.isArray(value) ? value : []) {
		const record = asRecord(item);
		if (record !== null) out.push(record);
	}
	return out;
}

function planUnits(work: string): Record<string, unknown>[] {
	return records(asRecord(readJsonFile(join(work, "plan.json")))?.matches).flatMap((match) => records(match.topics).flatMap((topic) => records(topic.units)));
}

/** Comment lines that sit in other than exactly one plan unit, plus units that hold other than exactly one comment line (0 for a speech-only session). */
function commentCoverageProblems(work: string): number {
	const comments = records(readJsonFile(join(work, "lines.json"))).filter((line) => line.source === "comment");
	if (comments.length === 0) return 0;
	const units = planUnits(work);
	const inside = (unit: Record<string, unknown>, line: Record<string, unknown>): boolean =>
		typeof unit.start_line === "number" && typeof unit.end_line === "number" && typeof line.i === "number" && unit.start_line <= line.i && line.i <= unit.end_line;
	const strayLines = comments.filter((line) => units.filter((unit) => inside(unit, line)).length !== 1).length;
	const strayUnits = units.filter((unit) => comments.filter((line) => inside(unit, line)).length !== 1).length;
	return strayLines + strayUnits;
}

function goldLineRecall(work: string, gold: Gold): number {
	const ranges = planUnits(work).flatMap((unit) => (typeof unit.start_line === "number" && typeof unit.end_line === "number" ? [[unit.start_line, unit.end_line]] : []));
	const goldLines = gold.units.flatMap((unit) => Array.from({ length: unit.end_line - unit.start_line + 1 }, (_, k) => unit.start_line + k));
	const covered = goldLines.filter((line) => ranges.some(([start, end]) => start <= line && line <= end)).length;
	return goldLines.length === 0 ? 1 : covered / goldLines.length;
}

function predictedUnits(work: string): PredictedUnit[] {
	return records(asRecord(readJsonFile(join(work, "plan.validated.json")))?.units).flatMap((unit) =>
		typeof unit.video === "string" && typeof unit.start === "number" && typeof unit.end === "number"
			? [{ id: String(unit.id), video: unit.video, start: unit.start, end: unit.end, position_tags: stringArray(unit.position_tags), topic_tags: stringArray(unit.topic_tags), member_ids: stringArray(unit.member_ids) }]
			: [],
	);
}

export function greenMetrics(work: string, gold: Gold | null): GreenMetrics {
	const notes = records(Object.values(asRecord(asRecord(readJsonFile(join(work, "notes.json")))?.units) ?? {}));
	const refs = records(asRecord(readJsonFile(join(work, "refs.verified.json")))?.refs);
	const failures: string[] = [];

	const coverage = commentCoverageProblems(work);
	if (coverage > 0) failures.push(`댓글 줄 커버리지: ${coverage}건 문제`);
	const leadFirst = notes.filter((unit) => records(unit.blocks)[0]?.type === "text").length;
	if (leadFirst < notes.length) failures.push(`본문 먼저 카드: ${leadFirst}/${notes.length}`);
	const videoRefs = refs.filter((ref) => ref.format === "video").length;
	if (videoRefs === 0) failures.push(`영상 자료: 0개`);

	let unitF1: number | null = null;
	let lineRecall: number | null = null;
	if (gold !== null) {
		lineRecall = goldLineRecall(work, gold);
		unitF1 = scoreUnitF1(matchUnits(gold, predictedUnits(work))).f1;
		if (unitF1 < GOLD_UNIT_F1_MIN) failures.push(`정답 단위 F1: ${unitF1.toFixed(2)} < ${GOLD_UNIT_F1_MIN.toFixed(2)}`);
	}

	return {
		failures,
		trend: {
			units: notes.length,
			frames: notes.reduce((sum, unit) => sum + records(unit.blocks).filter((block) => block.type === "frame").length, 0),
			unidentified_units: notes.filter((unit) => stringArray(unit.unidentified_member_ids).length > 0).length,
			refs: refs.length,
			video_refs: videoRefs,
			units_with_refs: new Set(refs.flatMap((ref) => stringArray(ref.unit_ids))).size,
		},
		unit_f1: unitF1,
		gold_line_recall: lineRecall,
	};
}

if (import.meta.main) {
	const [work, goldPath] = process.argv.slice(2);
	const result = greenMetrics(work, goldPath === undefined ? null : parseGold(readJsonFile(goldPath)));
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	process.exit(result.failures.length === 0 ? 0 : 1);
}
