#!/usr/bin/env bun
/**
 * fc-feedback model-comparison automatic scorer.
 *
 * Authoritative contract: plan §13.3 (scoring), §14.1 (inputs), §14.3 (points),
 * §14.5 (judge SCORE line), §14.6 (gold rules), §15-4 (gate re-run + skip-git-repo-check).
 *
 * CLI:
 *   bun score.ts <run-dir> --gold <gold.json> [--judge <judge.md>] [--skill-src <skill dir>]
 *
 * Writes <run-dir>/score.json and prints it to stdout.
 *
 * Work dir resolution: fc.ts's default --work dir (the skill runs without --work under
 * codex, plan §15-1) is ${OMT_DIR}/fc-feedback/${OMT_SESSION_ID}. run.sh sets OMT_DIR to
 * <run-dir>/omt and writes the session label it used for OMT_SESSION_ID into
 * <run-dir>/.fc-eval-session (a single line) — score.ts runs afterwards in a separate
 * process with none of run.sh's exported env vars, so it reads that file to reconstruct
 * <run-dir>/omt/fc-feedback/<label>. Missing the label file is a hard error.
 *
 * Reads (from the resolved work dir, unless noted):
 *   plan.validated.json  — predicted units (core.ts ValidatedUnit: id, video, start, end,
 *                           position_tags, topic_tags, member_ids)
 *   plan.json            — the Claude/Codex-authored index-only plan, scanned for a
 *                           smuggled seconds field (plan must carry only line indices)
 *   refs-draft.json      — this run's authored refs (url, lang, summary_ko, ...)
 *   refs.verified.json   — refs-draft augmented with http_status by verify-refs
 * Reads from <run-dir> directly:
 *   run.jsonl            — codex `--json` event stream (see parseRunEvents below)
 * Reads from the path given via --judge:
 *   judge.md             — presentation-reviewer output; last line must be
 *                           "SCORE specificity=<0-15> fidelity=<0-15> readability=<0-10>"
 *
 * Gold format (this eval's own contract, not part of the skill's data model, plan §14.6):
 *   { version: 1, video: string, units: [{ start_line, end_line, start,
 *     topic_tags[], position_tags[], member_ids[] }] }
 *
 * Gate (plan §15-4): re-runs `fc.ts check plan|notes|similar|refs --work <work-dir>` before
 * anything else. Any non-zero exit zeroes the total, but the rest of the breakdown is still
 * computed and reported (tagged gate_failed) for diagnosis. The gate's process-spawning sits
 * behind the CheckRunner interface so tests never spawn fc.ts.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── shared JSON helpers (no `as`, no `any`: narrow `unknown` by hand) ───────

/** Shallow-copies an unknown value into a plain string-keyed record, or null if it isn't one. */
function asRecord(node: unknown): Record<string, unknown> | null {
	if (node === null || typeof node !== "object" || Array.isArray(node)) return null;
	const record: Record<string, unknown> = {};
	Object.assign(record, node);
	return record;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function readJsonFile(path: string): unknown {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

// ── work dir resolution (run.sh writes the session label, plan §15-1/§15-4) ─

const SESSION_LABEL_FILE = ".fc-eval-session";

/** run.sh writes the OMT_SESSION_ID label it used into <run-dir>/.fc-eval-session because
 * score.ts runs afterwards in a separate process, with none of run.sh's exported env vars.
 * fc.ts's default --work dir is ${OMT_DIR}/fc-feedback/${OMT_SESSION_ID}, and run.sh sets
 * OMT_DIR to <run-dir>/omt, so the work dir is always <run-dir>/omt/fc-feedback/<label>. */
function resolveWorkDir(runDir: string): string {
	const labelPath = join(runDir, SESSION_LABEL_FILE);
	if (!existsSync(labelPath)) {
		throw new Error(
			`work dir를 찾을 수 없습니다: ${labelPath}가 없습니다(run.sh가 세션 레이블을 쓰지 않았습니다)`,
		);
	}
	const label = readFileSync(labelPath, "utf8").trim();
	if (label.length === 0) {
		throw new Error(`work dir를 찾을 수 없습니다: ${labelPath}가 비어 있습니다`);
	}
	return join(runDir, "omt", "fc-feedback", label);
}

// ── gold format (plan §14.6) ─────────────────────────────────────────────────

export interface GoldUnit {
	start_line: number;
	end_line: number;
	start: number;
	topic_tags: string[];
	position_tags: string[];
	member_ids: string[];
}

export interface Gold {
	version: 1;
	video: string;
	units: GoldUnit[];
}

function parseGoldUnit(raw: unknown, index: number): GoldUnit {
	const record = asRecord(raw);
	if (record === null) throw new Error(`gold: units[${index}]가 객체가 아닙니다`);
	const startLine = record["start_line"];
	const endLine = record["end_line"];
	const start = record["start"];
	if (typeof startLine !== "number" || typeof endLine !== "number" || typeof start !== "number") {
		throw new Error(`gold: units[${index}]의 start_line/end_line/start는 숫자여야 합니다`);
	}
	return {
		start_line: startLine,
		end_line: endLine,
		start,
		topic_tags: stringArray(record["topic_tags"]),
		position_tags: stringArray(record["position_tags"]),
		member_ids: stringArray(record["member_ids"]),
	};
}

export function parseGold(raw: unknown): Gold {
	const record = asRecord(raw);
	if (record === null) throw new Error("gold: 최상위가 객체가 아닙니다");
	const video = record["video"];
	if (typeof video !== "string" || video.length === 0) {
		throw new Error("gold: video는 비어있지 않은 문자열이어야 합니다");
	}
	const unitsRaw = record["units"];
	if (!Array.isArray(unitsRaw)) throw new Error("gold: units는 배열이어야 합니다");
	return { version: 1, video, units: unitsRaw.map((unit, index) => parseGoldUnit(unit, index)) };
}

function loadGold(path: string): Gold {
	if (!existsSync(path)) throw new Error(`gold 파일이 없습니다: ${path}`);
	const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
	return parseGold(raw);
}

// ── predicted units (core.ts plan.validated.json ValidatedUnit, plan §3) ────

export interface PredictedUnit {
	id: string;
	video: string;
	start: number;
	end: number;
	position_tags: string[];
	topic_tags: string[];
	member_ids: string[];
}

function readPredictedUnits(workDir: string): PredictedUnit[] {
	const record = asRecord(readJsonFile(join(workDir, "plan.validated.json")));
	if (record === null) return [];
	const units = record["units"];
	if (!Array.isArray(units)) return [];
	return units.flatMap((raw) => {
		const unit = asRecord(raw);
		if (unit === null) return [];
		const video = unit["video"];
		const start = unit["start"];
		const end = unit["end"];
		if (typeof video !== "string" || typeof start !== "number" || typeof end !== "number")
			return [];
		const id = unit["id"];
		return [
			{
				id: typeof id === "string" ? id : "",
				video,
				start,
				end,
				position_tags: stringArray(unit["position_tags"]),
				topic_tags: stringArray(unit["topic_tags"]),
				member_ids: stringArray(unit["member_ids"]),
			},
		];
	});
}

// ── unit matching: greedy one-to-one by smallest |Δstart|, same video, ±15s ─

export interface UnitMatch {
	gold: GoldUnit;
	predicted: PredictedUnit;
	deltaS: number;
}

export interface MatchResult {
	matches: UnitMatch[];
	totalGold: number;
	totalPredicted: number;
}

export function matchUnits(
	gold: Gold,
	predicted: readonly PredictedUnit[],
	toleranceS = 15,
): MatchResult {
	const candidates = predicted.filter((unit) => unit.video === gold.video);
	const pairs: Array<{ goldIndex: number; predIndex: number; deltaS: number }> = [];
	gold.units.forEach((goldUnit, goldIndex) => {
		candidates.forEach((predUnit, predIndex) => {
			const deltaS = Math.abs(predUnit.start - goldUnit.start);
			if (deltaS <= toleranceS) pairs.push({ goldIndex, predIndex, deltaS });
		});
	});
	// Deterministic tie-break: smallest delta first, then earliest gold/predicted index.
	pairs.sort(
		(a, b) => a.deltaS - b.deltaS || a.goldIndex - b.goldIndex || a.predIndex - b.predIndex,
	);

	const usedGold = new Set<number>();
	const usedPred = new Set<number>();
	const matches: UnitMatch[] = [];
	for (const pair of pairs) {
		if (usedGold.has(pair.goldIndex) || usedPred.has(pair.predIndex)) continue;
		usedGold.add(pair.goldIndex);
		usedPred.add(pair.predIndex);
		matches.push({
			gold: gold.units[pair.goldIndex],
			predicted: candidates[pair.predIndex],
			deltaS: pair.deltaS,
		});
	}
	return { matches, totalGold: gold.units.length, totalPredicted: candidates.length };
}

// ── unit F1 (×25, plan §14.3) ─────────────────────────────────────────────────

export interface UnitF1Score {
	precision: number;
	recall: number;
	f1: number;
	points: number;
	matched: number;
	total_gold: number;
	total_predicted: number;
}

export function scoreUnitF1(match: MatchResult): UnitF1Score {
	const matched = match.matches.length;
	const precision = match.totalPredicted > 0 ? matched / match.totalPredicted : 0;
	const recall = match.totalGold > 0 ? matched / match.totalGold : 0;
	const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
	return {
		precision,
		recall,
		f1,
		points: f1 * 25,
		matched,
		total_gold: match.totalGold,
		total_predicted: match.totalPredicted,
	};
}

// ── start-time accuracy (×10, plan §14.3: 0s=10 … ≥20s=0, linear, no matches=0) ─

export interface StartTimeAccuracy {
	median_delta_s: number | null;
	points: number;
}

export function scoreStartTimeAccuracy(matches: readonly UnitMatch[]): StartTimeAccuracy {
	if (matches.length === 0) return { median_delta_s: null, points: 0 };
	const sorted = matches.map((match) => match.deltaS).sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	const clamped = Math.min(Math.max(median, 0), 20);
	return { median_delta_s: median, points: 10 - (clamped / 20) * 10 };
}

// ── tag F1 (×15 = position 5 + topic 5 + member 5, micro F1 over matched pairs) ─

export interface TagMetric {
	precision: number;
	recall: number;
	f1: number;
	points: number;
}

function microF1(
	sets: ReadonlyArray<{ predicted: readonly string[]; gold: readonly string[] }>,
	points: number,
): TagMetric {
	let truePositive = 0;
	let falsePositive = 0;
	let falseNegative = 0;
	for (const set of sets) {
		const goldSet = new Set(set.gold);
		const predictedSet = new Set(set.predicted);
		for (const tag of predictedSet) {
			if (goldSet.has(tag)) truePositive += 1;
			else falsePositive += 1;
		}
		for (const tag of goldSet) {
			if (!predictedSet.has(tag)) falseNegative += 1;
		}
	}
	const precision =
		truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 0;
	const recall =
		truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 0;
	const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
	return { precision, recall, f1, points: f1 * points };
}

export interface TagScores {
	position: TagMetric;
	topic: TagMetric;
	member: TagMetric;
}

/** Member tag F1 counts mentioned members (member_ids) only — related members are excluded
 * because they are a deterministic function of member_ids + position_tags (plan §14.6). */
export function scoreTags(matches: readonly UnitMatch[]): TagScores {
	return {
		position: microF1(
			matches.map((match) => ({
				predicted: match.predicted.position_tags,
				gold: match.gold.position_tags,
			})),
			5,
		),
		topic: microF1(
			matches.map((match) => ({
				predicted: match.predicted.topic_tags,
				gold: match.gold.topic_tags,
			})),
			5,
		),
		member: microF1(
			matches.map((match) => ({
				predicted: match.predicted.member_ids,
				gold: match.gold.member_ids,
			})),
			5,
		),
	};
}

// ── refs (×10 = url-in-log 4 + http ratio 3 + ko summary 3, plan §14.3) ──────

interface DraftRef {
	url: string;
	lang: string;
	summary_ko: string;
}

function readDraftRefs(workDir: string): DraftRef[] {
	const record = asRecord(readJsonFile(join(workDir, "refs-draft.json")));
	if (record === null) return [];
	const refs = record["refs"];
	if (!Array.isArray(refs)) return [];
	return refs.flatMap((raw) => {
		const ref = asRecord(raw);
		if (ref === null) return [];
		const url = ref["url"];
		const lang = ref["lang"];
		if (typeof url !== "string" || typeof lang !== "string") return [];
		const summaryKo = ref["summary_ko"];
		return [{ url, lang, summary_ko: typeof summaryKo === "string" ? summaryKo : "" }];
	});
}

interface VerifiedRef {
	http_status: number | undefined;
}

function readVerifiedRefs(workDir: string): VerifiedRef[] {
	const record = asRecord(readJsonFile(join(workDir, "refs.verified.json")));
	if (record === null) return [];
	const refs = record["refs"];
	if (!Array.isArray(refs)) return [];
	return refs.flatMap((raw) => {
		const ref = asRecord(raw);
		if (ref === null) return [];
		const status = ref["http_status"];
		return [{ http_status: typeof status === "number" ? status : undefined }];
	});
}

export interface RefMetric {
	fraction: number;
	points: number;
}

export interface RefsScore {
	url_in_log: RefMetric;
	http_ratio: RefMetric;
	ko_summary: RefMetric;
}

/** No refs at all → 0 for all three (plan explicitly requires this rather than leaving it
 * to fall out of a division by zero, since a vacuous "no refs to check" is not a real pass). */
export function scoreRefs(
	draftRefs: readonly DraftRef[],
	verifiedRefs: readonly VerifiedRef[],
	eventTexts: readonly string[],
): RefsScore {
	if (draftRefs.length === 0) {
		return {
			url_in_log: { fraction: 0, points: 0 },
			http_ratio: { fraction: 0, points: 0 },
			ko_summary: { fraction: 0, points: 0 },
		};
	}

	const foundInLog = draftRefs.filter((ref) =>
		eventTexts.some((text) => text.includes(ref.url)),
	).length;
	const urlFraction = foundInLog / draftRefs.length;

	const withStatus = verifiedRefs.filter((ref) => ref.http_status !== undefined);
	const okCount = withStatus.filter(
		(ref) => ref.http_status !== undefined && ref.http_status >= 200 && ref.http_status <= 399,
	).length;
	const httpFraction = withStatus.length > 0 ? okCount / withStatus.length : 0;

	// Vacuously true when every ref is already Korean — nothing required a summary.
	const nonKoRefs = draftRefs.filter((ref) => ref.lang !== "ko");
	const koFraction =
		nonKoRefs.length === 0
			? 1
			: nonKoRefs.filter((ref) => ref.summary_ko.trim().length > 0).length / nonKoRefs.length;

	return {
		url_in_log: { fraction: urlFraction, points: urlFraction * 4 },
		http_ratio: { fraction: httpFraction, points: httpFraction * 3 },
		ko_summary: { fraction: koFraction, points: koFraction * 3 },
	};
}

// ── run.jsonl parsing (plan §14.1) ────────────────────────────────────────────
//
// SMOKE 2026-09-28 관측: one JSON object per line — `{"type": "thread.started"
// | "turn.started" | "item.started" | "item.completed" | "turn.completed",
// "item": {...}}`. Observed `item.type` values:
//   - `agent_message`      — `.item.text`
//   - `command_execution`  — `.item.command` (e.g. `/bin/zsh -lc '<cmd>'`),
//                             `.item.exit_code` (null on item.started, an
//                             integer on item.completed)
//   - `web_search`         — `.item.query`, `.item.action.{type,query}`, and
//                             on completion `.item.results[]` with keys
//                             domain, ref_id, snippet, title, type, url
// Rather than pattern-matching those specific keys — which breaks the moment
// the real shape differs even slightly — this walks the ENTIRE parsed value
// of each line and joins every string leaf into one search blob per line, in
// file order. Every detector below (push attempt, gate-order violation, refs
// URL-in-log fallback) does a plain substring/regex search over that blob, so
// it already covers `.item.results[].url` without a dedicated web_search
// extractor, and stays correct regardless of which key a command or URL
// actually lands under.

function collectStrings(node: unknown, out: string[]): void {
	if (typeof node === "string") {
		out.push(node);
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) collectStrings(item, out);
		return;
	}
	const record = asRecord(node);
	if (record === null) return;
	for (const value of Object.values(record)) collectStrings(value, out);
}

/** One search blob per non-empty run.jsonl line, in file order. A line that fails to
 * parse as JSON is kept verbatim so it stays searchable instead of silently vanishing. */
export function parseRunEvents(jsonlText: string): string[] {
	return jsonlText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				return line;
			}
			const strings: string[] = [];
			collectStrings(parsed, strings);
			return strings.join("\n");
		});
}

function readRunEvents(runDir: string): string[] {
	const path = join(runDir, "run.jsonl");
	if (!existsSync(path)) return [];
	return parseRunEvents(readFileSync(path, "utf8"));
}

// ── penalties (−20 each, floor 0, plan §14.3/§14.6) ──────────────────────────

const TIME_FIELD_NAMES = new Set(["start", "end", "t", "time", "seconds"]);

/** plan.json must carry only line indices (start_line/end_line) — a numeric start/end/t/
 * time/seconds anywhere in the document means a second value was written directly, which
 * plan §6 forbids ("LLM은 시간을 쓰지 않는다"). Walks the whole document rather than only
 * `units[]` so a smuggled field is caught regardless of nesting depth. */
export function containsDirectSeconds(node: unknown, seen: Set<unknown> = new Set()): boolean {
	if (Array.isArray(node)) return node.some((item) => containsDirectSeconds(item, seen));
	const record = asRecord(node);
	if (record === null) return false;
	if (seen.has(node)) return false;
	seen.add(node);
	for (const [key, value] of Object.entries(record)) {
		if (TIME_FIELD_NAMES.has(key) && typeof value === "number") return true;
	}
	return Object.values(record).some((value) => containsDirectSeconds(value, seen));
}

const GIT_PUSH_RE = /\bgit\s+push\b/;

export function detectPushAttempt(eventTexts: readonly string[]): boolean {
	return eventTexts.some((text) => GIT_PUSH_RE.test(text));
}

const CHECK_PLAN_RE = /\bcheck\s+plan\b/;
const GATED_COMMAND_RE = /\bfc\.ts\s+(render|add-frame|frames)\b|\bnotes\.json\b/;

function firstIndexMatching(texts: readonly string[], re: RegExp): number {
	return texts.findIndex((text) => re.test(text));
}

/** A `check plan` run must precede the first notes/frames/render command (plan §6, §14.3).
 * If a gated command never ran, there is nothing to have jumped ahead of. */
export function detectGateOrderViolation(eventTexts: readonly string[]): boolean {
	const gatedIndex = firstIndexMatching(eventTexts, GATED_COMMAND_RE);
	if (gatedIndex === -1) return false;
	const checkPlanIndex = firstIndexMatching(eventTexts, CHECK_PLAN_RE);
	return checkPlanIndex === -1 || gatedIndex < checkPlanIndex;
}

export interface Penalties {
	seconds_in_plan: boolean;
	push_attempt: boolean;
	gate_order_violation: boolean;
	points_deducted: number;
}

export interface TotalResult {
	total: number;
	points_deducted: number;
}

/** Pure scoring-math combinator: gate failure zeroes the total outright; otherwise each
 * triggered penalty subtracts 20, floored at 0. Kept separate from file/process I/O so the
 * arithmetic is testable without any fixtures. */
export function combineTotal(
	rawTotal: number,
	gateFailed: boolean,
	penalties: { secondsInPlan: boolean; pushAttempt: boolean; gateOrderViolation: boolean },
): TotalResult {
	const triggered = [
		penalties.secondsInPlan,
		penalties.pushAttempt,
		penalties.gateOrderViolation,
	].filter(Boolean).length;
	const pointsDeducted = triggered * 20;
	const total = gateFailed ? 0 : Math.max(0, rawTotal - pointsDeducted);
	return { total, points_deducted: pointsDeducted };
}

// ── judge (×40, plan §14.5) ───────────────────────────────────────────────────

export interface JudgeResult {
	specificity: number | null;
	fidelity: number | null;
	readability: number | null;
	points: number;
	judge_invalid: boolean;
}

const SCORE_LINE_RE =
	/^SCORE\s+specificity=(-?\d+(?:\.\d+)?)\s+fidelity=(-?\d+(?:\.\d+)?)\s+readability=(-?\d+(?:\.\d+)?)\s*$/;

function invalidJudge(): JudgeResult {
	return { specificity: null, fidelity: null, readability: null, points: 0, judge_invalid: true };
}

/** Parses the LAST non-blank line of judge.md as `SCORE specificity=<0-15> fidelity=<0-15>
 * readability=<0-10>`. Missing, malformed, or out-of-range → judge_invalid (caller re-runs
 * the judge) and 0 points, never a clamped or partial score. */
export function parseJudgeScore(judgeText: string | undefined): JudgeResult {
	if (judgeText === undefined) return invalidJudge();
	const lines = judgeText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return invalidJudge();
	const last = lines[lines.length - 1];
	const match = SCORE_LINE_RE.exec(last);
	if (match === null) return invalidJudge();
	const specificity = Number(match[1]);
	const fidelity = Number(match[2]);
	const readability = Number(match[3]);
	const inRange =
		specificity >= 0 &&
		specificity <= 15 &&
		fidelity >= 0 &&
		fidelity <= 15 &&
		readability >= 0 &&
		readability <= 10;
	if (!inRange) return { specificity, fidelity, readability, points: 0, judge_invalid: true };
	return {
		specificity,
		fidelity,
		readability,
		points: specificity + fidelity + readability,
		judge_invalid: false,
	};
}

// ── gate: re-run the 4 checks (plan §15-4) ───────────────────────────────────

export type CheckKind = "plan" | "notes" | "similar" | "refs";

export interface CheckOutcome {
	kind: CheckKind;
	exitCode: number;
}

/** Injectable so tests never spawn fc.ts (or need a real work dir + git archive to do it). */
export interface CheckRunner {
	run(kind: CheckKind, workDir: string): CheckOutcome;
}

export function createFcCheckRunner(skillSrcDir: string): CheckRunner {
	return {
		run(kind, workDir) {
			const fcPath = join(skillSrcDir, "scripts", "fc.ts");
			const result = Bun.spawnSync(["bun", fcPath, "check", kind, "--work", workDir]);
			return { kind, exitCode: result.exitCode ?? 1 };
		},
	};
}

// ── top-level scoring pipeline ────────────────────────────────────────────────

export interface ScoreBreakdown {
	gate: { plan: number; notes: number; similar: number; refs: number; passed: boolean };
	unit_f1: UnitF1Score;
	start_time_accuracy: StartTimeAccuracy;
	tags: TagScores;
	refs: RefsScore;
	judge: JudgeResult;
	penalties: Penalties;
}

export interface ScoreResult {
	version: 1;
	total: number;
	gate_failed: boolean;
	breakdown: ScoreBreakdown;
}

export interface ScoreRunInput {
	runDir: string;
	gold: Gold;
	judgeText: string | undefined;
	checkRunner: CheckRunner;
	/** Override for tests. Defaults to resolveWorkDir(runDir) (the .fc-eval-session-based
	 * resolution documented at the top of this file). */
	workDir?: string;
}

export function scoreRun(input: ScoreRunInput): ScoreResult {
	const workDir = input.workDir ?? resolveWorkDir(input.runDir);

	const planCheck = input.checkRunner.run("plan", workDir);
	const notesCheck = input.checkRunner.run("notes", workDir);
	const similarCheck = input.checkRunner.run("similar", workDir);
	const refsCheck = input.checkRunner.run("refs", workDir);
	const gateFailed = [planCheck, notesCheck, similarCheck, refsCheck].some(
		(outcome) => outcome.exitCode !== 0,
	);

	const predicted = readPredictedUnits(workDir);
	const match = matchUnits(input.gold, predicted);
	const unitF1 = scoreUnitF1(match);
	const startTimeAccuracy = scoreStartTimeAccuracy(match.matches);
	const tags = scoreTags(match.matches);

	const eventTexts = readRunEvents(input.runDir);
	const secondsInPlan = containsDirectSeconds(readJsonFile(join(workDir, "plan.json")));
	const pushAttempt = detectPushAttempt(eventTexts);
	const gateOrderViolation = detectGateOrderViolation(eventTexts);

	const refs = scoreRefs(readDraftRefs(workDir), readVerifiedRefs(workDir), eventTexts);
	const judge = parseJudgeScore(input.judgeText);

	const rawTotal =
		unitF1.points +
		startTimeAccuracy.points +
		tags.position.points +
		tags.topic.points +
		tags.member.points +
		refs.url_in_log.points +
		refs.http_ratio.points +
		refs.ko_summary.points +
		judge.points;

	const { total, points_deducted } = combineTotal(rawTotal, gateFailed, {
		secondsInPlan,
		pushAttempt,
		gateOrderViolation,
	});

	return {
		version: 1,
		total,
		gate_failed: gateFailed,
		breakdown: {
			gate: {
				plan: planCheck.exitCode,
				notes: notesCheck.exitCode,
				similar: similarCheck.exitCode,
				refs: refsCheck.exitCode,
				passed: !gateFailed,
			},
			unit_f1: unitF1,
			start_time_accuracy: startTimeAccuracy,
			tags,
			refs,
			judge,
			penalties: {
				seconds_in_plan: secondsInPlan,
				push_attempt: pushAttempt,
				gate_order_violation: gateOrderViolation,
				points_deducted,
			},
		},
	};
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function defaultSkillSrc(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, "../../../projects/fc-feedback/skills/fc-feedback");
}

interface CliArgs {
	runDir: string;
	goldPath: string;
	judgePath: string | undefined;
	skillSrc: string;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
	const positional: string[] = [];
	let goldPath: string | undefined;
	let judgePath: string | undefined;
	let skillSrc: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--gold" && i + 1 < argv.length) {
			goldPath = argv[i + 1];
			i++;
		} else if (arg === "--judge" && i + 1 < argv.length) {
			judgePath = argv[i + 1];
			i++;
		} else if (arg === "--skill-src" && i + 1 < argv.length) {
			skillSrc = argv[i + 1];
			i++;
		} else {
			positional.push(arg);
		}
	}
	const runDir = positional[0];
	if (runDir === undefined) {
		throw new Error(
			"사용법: bun score.ts <run-dir> --gold <gold.json> [--judge <judge.md>] [--skill-src <skill dir>]",
		);
	}
	if (goldPath === undefined) throw new Error("--gold <gold.json>이 필요합니다");
	return {
		runDir: resolve(runDir),
		goldPath: resolve(goldPath),
		judgePath: judgePath !== undefined ? resolve(judgePath) : undefined,
		skillSrc: skillSrc !== undefined ? resolve(skillSrc) : defaultSkillSrc(),
	};
}

if (import.meta.main) {
	const args = parseCliArgs(process.argv.slice(2));
	const gold = loadGold(args.goldPath);
	const judgeText =
		args.judgePath !== undefined && existsSync(args.judgePath)
			? readFileSync(args.judgePath, "utf8")
			: undefined;
	const result = scoreRun({
		runDir: args.runDir,
		gold,
		judgeText,
		checkRunner: createFcCheckRunner(args.skillSrc),
	});
	const json = `${JSON.stringify(result, null, 2)}\n`;
	writeFileSync(join(args.runDir, "score.json"), json);
	process.stdout.write(json);
}
