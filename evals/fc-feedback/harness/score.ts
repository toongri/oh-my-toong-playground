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
 *   run.jsonl            — codex `--json` event stream, or Claude Code's `stream-json`
 *                           (see extractCommandExecutions/extractWebResultTexts below)
 * Reads from the path given via --judge:
 *   judge.md             — presentation-reviewer output; last line must be
 *                           "SCORE specificity=<0-15> fidelity=<0-15> readability=<0-10>"
 *
 * Gold format (this eval's own contract, not part of the skill's data model, plan §14.6):
 *   { version: 1, video: string, units: [{ start_line, end_line, start,
 *     topic_tags[], position_tags[], member_ids[] }] }
 *
 * Gate (plan §15-4): re-runs `fc.ts check plan|notes|similar|refs` against a throwaway COPY
 * of the work dir, giving every spawned fc.ts process the SAME cwd and env the run itself
 * used (<run-dir>) — otherwise fc.ts resolves its config manifest from the scorer's own cwd
 * instead of the run's, landing on "unconfigured" and failing every check regardless of
 * whether the run's plan was actually valid. See the "gate" section below for the exact
 * contract. Any non-zero exit zeroes the total, but the rest of the breakdown is still
 * computed and reported (tagged gate_failed) for diagnosis. The gate's process-spawning sits
 * behind the CheckRunner interface so tests never spawn fc.ts.
 *
 * Discipline penalties (push attempt, gate-order violation) are computed from commands the
 * run actually EXECUTED (run.jsonl's command_execution items), never from conversational
 * text, tool output, or aggregated_output — see "executed-command extraction" below.
 *
 * Contamination detection flags a run that read, searched, or had returned to it this eval's
 * own design/answer material (evals/fc-feedback/, the repo's projects/fc-feedback/ SOURCE
 * tree, a saved plan under ~/.omt/**\/plans/fc-feedback*, or another run's temp dir) — see
 * the "contamination detection" section below. A contaminated run keeps its score but is
 * marked excluded_from_comparison.
 */

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── shared JSON helpers (no `as`, no `any`: narrow `unknown` by hand) ───────

/** Shallow-copies an unknown value into a plain string-keyed record, or null if it isn't one. */
export function asRecord(node: unknown): Record<string, unknown> | null {
	if (node === null || typeof node !== "object" || Array.isArray(node)) return null;
	const record: Record<string, unknown> = {};
	Object.assign(record, node);
	return record;
}

export function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

export function readJsonFile(path: string): unknown {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

// ── repo root (dynamic — never hardcode an absolute path) ───────────────────

function repoRootDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, "../../..");
}

const REPO_ROOT = repoRootDir();

// ── work dir resolution (run.sh writes the session label, plan §15-1/§15-4) ─

const SESSION_LABEL_FILE = ".fc-eval-session";

/** run.sh writes the OMT_SESSION_ID label it used into <run-dir>/.fc-eval-session because
 * score.ts runs afterwards in a separate process, with none of run.sh's exported env vars.
 * Also used by the gate's CheckRunner to reconstruct the same OMT_SESSION_ID for re-run
 * fc.ts processes. */
function readSessionLabel(runDir: string): string {
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
	return label;
}

/** fc.ts's default --work dir is ${OMT_DIR}/fc-feedback/${OMT_SESSION_ID}, and run.sh sets
 * OMT_DIR to <run-dir>/omt, so the work dir is always <run-dir>/omt/fc-feedback/<label>. */
function resolveWorkDir(runDir: string): string {
	return join(runDir, "omt", "fc-feedback", readSessionLabel(runDir));
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

// ── unit matching: maximum-cardinality bipartite match, same video, ±15s ────
//
// A pure greedy-by-smallest-delta assignment can strand matchable pairs: gold starts
// [0, 14] vs predicted [10, 24] at tolerance 15 greedily takes 14↔10 (Δ4, the smallest
// delta) and leaves 0 and 24 unmatched, even though 0↔10 + 14↔24 matches BOTH. Maximizing
// match COUNT is the actual goal (plan §14.3's unit F1 wants every matchable pair
// credited); minimizing total |Δ| only breaks ties among matchings that already tie on
// count. Solved as a min-cost assignment problem (Hungarian algorithm): an eligible pair
// costs its |Δ|, and every ineligible or padding pair costs a constant strictly greater
// than the sum of all eligible deltas — so the optimal assignment always prefers one more
// eligible pair over any amount of delta saved elsewhere, and only falls back to fewer
// eligible pairs when no larger matching exists.

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

/** Solves the square minimum-cost assignment problem (Kuhn–Munkres / Hungarian algorithm,
 * O(n^3)) — returns, for each row, the 0-indexed column it's assigned to. `cost` must be an
 * n×n matrix. Standard textbook formulation (1-indexed internally, 0 as the "no row/column
 * yet" sentinel); sizes here are small (≤ ~30 gold units per video), so O(n^3) is fine. */
function solveAssignment(cost: readonly (readonly number[])[]): number[] {
	const n = cost.length;
	const INF = Number.POSITIVE_INFINITY;
	const u = new Array(n + 1).fill(0);
	const v = new Array(n + 1).fill(0);
	const rowOfCol = new Array(n + 1).fill(0); // rowOfCol[j] = 1-indexed row assigned to column j (0 = free)
	const parentCol = new Array(n + 1).fill(0); // parentCol[j] = previous column on the augmenting path to j
	for (let row = 1; row <= n; row++) {
		rowOfCol[0] = row;
		let col0 = 0;
		const minCostToCol = new Array(n + 1).fill(INF);
		const visited = new Array(n + 1).fill(false);
		do {
			visited[col0] = true;
			const curRow = rowOfCol[col0];
			let delta = INF;
			let nextCol = -1;
			for (let col = 1; col <= n; col++) {
				if (visited[col]) continue;
				const reduced = cost[curRow - 1][col - 1] - u[curRow] - v[col];
				if (reduced < minCostToCol[col]) {
					minCostToCol[col] = reduced;
					parentCol[col] = col0;
				}
				if (minCostToCol[col] < delta) {
					delta = minCostToCol[col];
					nextCol = col;
				}
			}
			for (let col = 0; col <= n; col++) {
				if (visited[col]) {
					u[rowOfCol[col]] += delta;
					v[col] -= delta;
				} else {
					minCostToCol[col] -= delta;
				}
			}
			col0 = nextCol;
		} while (rowOfCol[col0] !== 0);
		// Walk the augmenting path back to the root, reassigning each column on the way.
		while (col0 !== 0) {
			const parent = parentCol[col0];
			rowOfCol[col0] = rowOfCol[parent];
			col0 = parent;
		}
	}
	const colOfRow = new Array(n).fill(-1);
	for (let col = 1; col <= n; col++) {
		if (rowOfCol[col] > 0) colOfRow[rowOfCol[col] - 1] = col - 1;
	}
	return colOfRow;
}

export function matchUnits(
	gold: Gold,
	predicted: readonly PredictedUnit[],
	toleranceS = 15,
): MatchResult {
	const candidates = predicted.filter((unit) => unit.video === gold.video);
	const goldUnits = gold.units;
	const size = Math.max(goldUnits.length, candidates.length);
	if (size === 0) return { matches: [], totalGold: 0, totalPredicted: 0 };

	const deltaAt: number[][] = goldUnits.map((goldUnit) =>
		candidates.map((predUnit) => Math.abs(predUnit.start - goldUnit.start)),
	);
	let eligibleDeltaSum = 0;
	for (const row of deltaAt) {
		for (const deltaS of row) {
			if (deltaS <= toleranceS) eligibleDeltaSum += deltaS;
		}
	}
	// Strictly greater than any achievable sum of eligible deltas, so trading one eligible
	// match for a padding/ineligible slot never lowers the total cost.
	const ineligibleCost = eligibleDeltaSum + 1;

	const cost: number[][] = [];
	for (let i = 0; i < size; i++) {
		const row: number[] = [];
		for (let j = 0; j < size; j++) {
			const eligible = i < goldUnits.length && j < candidates.length && deltaAt[i][j] <= toleranceS;
			row.push(eligible ? deltaAt[i][j] : ineligibleCost);
		}
		cost.push(row);
	}
	const assignedCol = solveAssignment(cost);

	// Iterating gold indices in ascending order keeps `matches` ordered by gold index.
	const matches: UnitMatch[] = [];
	for (let i = 0; i < goldUnits.length; i++) {
		const j = assignedCol[i];
		if (j < candidates.length && deltaAt[i][j] <= toleranceS) {
			matches.push({ gold: goldUnits[i], predicted: candidates[j], deltaS: deltaAt[i][j] });
		}
	}
	return { matches, totalGold: goldUnits.length, totalPredicted: candidates.length };
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

export interface VerifiedRefs {
	/** Refs verify-refs kept (didn't reject), with a numeric http_status when one was recorded. */
	kept: readonly VerifiedRef[];
	/** Count of refs verify-refs REJECTED (HTTP 4xx/5xx or a network error) and moved from
	 * `refs` to `dropped: [{url, reason}]` — each one is a ref that was never actually
	 * reachable, so it must count as one non-200–399 ref in the http-ratio denominator. */
	droppedCount: number;
}

function readVerifiedRefs(workDir: string): VerifiedRefs {
	const record = asRecord(readJsonFile(join(workDir, "refs.verified.json")));
	if (record === null) return { kept: [], droppedCount: 0 };
	const refs = record["refs"];
	const kept: VerifiedRef[] = Array.isArray(refs)
		? refs.flatMap((raw) => {
				const ref = asRecord(raw);
				if (ref === null) return [];
				const status = ref["http_status"];
				return [{ http_status: typeof status === "number" ? status : undefined }];
			})
		: [];
	const dropped = record["dropped"];
	return { kept, droppedCount: Array.isArray(dropped) ? dropped.length : 0 };
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
	verifiedRefs: VerifiedRefs,
	webResultTexts: readonly string[],
): RefsScore {
	if (draftRefs.length === 0) {
		return {
			url_in_log: { fraction: 0, points: 0 },
			http_ratio: { fraction: 0, points: 0 },
			ko_summary: { fraction: 0, points: 0 },
		};
	}

	const foundInLog = draftRefs.filter((ref) =>
		webResultTexts.some((text) => text.includes(ref.url)),
	).length;
	const urlFraction = foundInLog / draftRefs.length;

	const withStatus = verifiedRefs.kept.filter((ref) => ref.http_status !== undefined);
	const okCount = withStatus.filter(
		(ref) => ref.http_status !== undefined && ref.http_status >= 200 && ref.http_status <= 399,
	).length;
	// Denominator = every ref verify-refs actually judged: kept refs with a resolved status,
	// PLUS every dropped ref (rejected outright as HTTP 4xx/5xx or a network error — never ok).
	// Leaving dropped refs out let a run hide failures by having verify-refs drop them instead
	// of recording a bad status.
	const httpDenominator = withStatus.length + verifiedRefs.droppedCount;
	const httpFraction = httpDenominator > 0 ? okCount / httpDenominator : 0;

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
//                             integer on item.completed), `.item.id`,
//                             `.item.aggregated_output` (present once completed)
//   - `web_search`         — `.item.query`, `.item.action.{type,query}`, and
//                             on completion `.item.results[]` with keys
//                             domain, ref_id, snippet, title, type, url
//   - `file_change`        — `.item.id`, `.item.changes[]` (`{path, kind}`, kind e.g.
//                             "add"/"update"/"delete") — a native (non-shell) file write,
//                             observed for notes.json/plan.json/etc. written through the
//                             agent's own file-edit tool rather than a shell redirection
//
// Two different questions need two different views of this stream, and BOTH are narrow,
// purpose-built extractions — neither one walks the raw text of every event indiscriminately:
//
// 1. "Did the run actually find this ref's URL on the web?" — extractWebResultTexts looks
//    ONLY at web-search/fetch TOOL RESULTS: a codex `web_search` item's `.item.results[]`
//    (never `.item.action`, never command output), or a Claude `WebSearch`/`WebFetch`
//    tool_use's matching tool_result text. A URL the model only wrote into an agent message,
//    a command, or a file is not evidence it was actually found on the web — crediting that
//    would let a run invent a URL and paste it somewhere the log happens to echo it.
//
// 2. "What commands did the run actually EXECUTE?" — extractCommandExecutions
//    looks ONLY at command_execution items' `.command` field, deduped by
//    item id (a started+completed pair is the same execution, counted once).
//    Discipline penalties (push attempt, gate-order violation) and
//    contamination detection use ONLY this list — never agent-message or web-result
//    text — because that text also contains conversational text, aggregated command
//    output, and search-result snippets, any of which can innocently mention
//    "git push" or a forbidden path without the run ever having executed or
//    read it (SMOKE 2026-09-29: exactly this false-positive was observed —
//    every "git push" hit in four real round-0 runs came from `cat`-ing
//    CLAUDE.md/rubric.md, never an executed command).

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

/** Walks a CODEX-shaped run.jsonl once and returns one search blob per `web_search` item that
 * carries a `.item.results[]` array (only the completion event does) — every string leaf of
 * `results` only, joined per line, never `.item.action`/`.item.query` and never any other
 * item type's text. */
function extractCodexWebResultTexts(jsonlText: string): string[] {
	const texts: string[] = [];
	for (const rawLine of jsonlText.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		const record = asRecord(parsed);
		const item = record === null ? null : asRecord(record["item"]);
		if (item === null || item["type"] !== "web_search") continue;
		const results = item["results"];
		if (!Array.isArray(results)) continue;
		const strings: string[] = [];
		collectStrings(results, strings);
		if (strings.length > 0) texts.push(strings.join("\n"));
	}
	return texts;
}

function readRunJsonlText(runDir: string): string {
	const path = join(runDir, "run.jsonl");
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// ── run.jsonl format detection (codex `--json` vs Claude Code `stream-json`) ─
//
// Claude Code's `claude -p --output-format stream-json --verbose` writes one JSON
// object per line too, but shaped completely differently from codex: top-level
// `type: "system" | "assistant" | "user" | "result"`, with `assistant`/`user`
// lines carrying a `.message.content[]` array of blocks (`tool_use`, `tool_result`,
// `text`, ...) instead of codex's `.item`. Every command-execution/file-change/
// contamination/gate-order/push consumer below needs the SAME internal shapes
// (CommandExecutionEvent, FileChangeEvent) regardless of which harness produced
// run.jsonl, so extractCommandExecutions/extractFileChangeEvents/extractWebResultTexts
// detect the format once and dispatch to a per-format extractor — web-result extraction
// needs this dispatch too, since codex and Claude represent tool results completely
// differently (`.item.results[]` vs a `tool_result` block keyed by tool name).

export type RunLogFormat = "codex" | "claude";

/** Detects the format from the first line that clearly commits to one shape
 * (`.item` for codex, `.message` for Claude) — defaults to "codex" so an empty
 * or fully-unparseable log never changes existing codex behavior. */
export function detectRunLogFormat(jsonlText: string): RunLogFormat {
	for (const rawLine of jsonlText.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		const record = asRecord(parsed);
		if (record === null) continue;
		if (asRecord(record["item"]) !== null) return "codex";
		if (asRecord(record["message"]) !== null) return "claude";
	}
	return "codex";
}

// ── executed-command extraction ──────────────────────────────────────────────

export interface CommandExecutionEvent {
	id: string;
	command: string;
	/** 1-based line number in run.jsonl of this command's first occurrence (item.started, or
	 * item.completed if no started event was seen — used for contamination hit reporting). */
	eventLine: number;
	/** Longest `aggregated_output` seen across this id's events (only item.completed carries
	 * one; "" when none was seen). */
	aggregatedOutput: string;
	/** `.item.exit_code` from the item.completed event (null on item.started, and null when
	 * no item.completed was seen at all — an incomplete/still-running command is never
	 * treated as a passing gate). */
	exitCode: number | null;
}

/** Walks a CODEX-shaped run.jsonl once and returns one entry per command_execution item id,
 * in first-seen order — a started/completed pair collapses into a single entry (counted
 * once, never twice). A line that fails to parse, or whose item isn't a command_execution
 * with a string `.command`, is skipped. */
function extractCodexCommandExecutions(jsonlText: string): CommandExecutionEvent[] {
	const order: string[] = [];
	const byId = new Map<string, CommandExecutionEvent>();
	const lines = jsonlText.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index].trim();
		if (raw.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		const record = asRecord(parsed);
		const item = record === null ? null : asRecord(record["item"]);
		if (item === null || item["type"] !== "command_execution") continue;
		const command = item["command"];
		if (typeof command !== "string") continue;
		const idRaw = item["id"];
		const id = typeof idRaw === "string" ? idRaw : command;
		let entry = byId.get(id);
		if (entry === undefined) {
			entry = { id, command, eventLine: index + 1, aggregatedOutput: "", exitCode: null };
			byId.set(id, entry);
			order.push(id);
		}
		const output = item["aggregated_output"];
		if (typeof output === "string" && output.length > entry.aggregatedOutput.length) {
			entry.aggregatedOutput = output;
		}
		const exitCode = item["exit_code"];
		if (typeof exitCode === "number") {
			entry.exitCode = exitCode;
		}
	}
	return order.map((id) => {
		const entry = byId.get(id);
		if (entry === undefined) throw new Error("unreachable: extractCommandExecutions id/byId mismatch");
		return entry;
	});
}

/** A native (non-shell) file write recorded as a `file_change` item — e.g. the agent's own
 * file-edit tool creating/modifying notes.json directly, with no shell redirection command to
 * inspect. */
export interface FileChangeEvent {
	id: string;
	/** Every path this change touched (usually one), exactly as `.item.changes[].path` gave it —
	 * absolute or relative depending on the runtime, so callers match by suffix. */
	paths: string[];
	/** 1-based line number in run.jsonl of this change's first occurrence. */
	eventLine: number;
}

/** Walks a CODEX-shaped run.jsonl once and returns one entry per file_change item id, in
 * first-seen order — mirrors `extractCodexCommandExecutions`'s started/completed collapsing.
 * A line that fails to parse, or whose item isn't a file_change with a `.changes[]` array, is
 * skipped. */
function extractCodexFileChangeEvents(jsonlText: string): FileChangeEvent[] {
	const order: string[] = [];
	const byId = new Map<string, FileChangeEvent>();
	const lines = jsonlText.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index].trim();
		if (raw.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		const record = asRecord(parsed);
		const item = record === null ? null : asRecord(record["item"]);
		if (item === null || item["type"] !== "file_change") continue;
		const changes = item["changes"];
		if (!Array.isArray(changes)) continue;
		const paths = changes
			.map((change) => {
				const changeRecord = asRecord(change);
				return changeRecord === null ? null : changeRecord["path"];
			})
			.filter((path): path is string => typeof path === "string");
		if (paths.length === 0) continue;
		const idRaw = item["id"];
		const id = typeof idRaw === "string" ? idRaw : paths.join(",");
		let entry = byId.get(id);
		if (entry === undefined) {
			entry = { id, paths, eventLine: index + 1 };
			byId.set(id, entry);
			order.push(id);
		} else {
			for (const path of paths) {
				if (!entry.paths.includes(path)) entry.paths.push(path);
			}
		}
	}
	return order.map((id) => {
		const entry = byId.get(id);
		if (entry === undefined) throw new Error("unreachable: extractFileChangeEvents id/byId mismatch");
		return entry;
	});
}

// ── Claude stream-json normalization ─────────────────────────────────────────
//
// Maps Claude Code's `stream-json` tool events onto the exact same
// CommandExecutionEvent/FileChangeEvent shapes the codex extractors above
// produce, so every downstream consumer (push detection, gate-order detection,
// contamination scanning) stays format-agnostic:
//   - `type: "assistant"` message content blocks: `type: "tool_use"` with
//     `name: "Bash"` -> `.input.command` becomes the executed command, verbatim
//     (real shell text, so the existing shell-segment walker above handles it
//     unchanged); `Write`/`Edit`/`MultiEdit`/`NotebookEdit` -> `.input.file_path`
//     becomes a file-change path; `Read`/`Grep`/`Glob` -> synthesized as a
//     read/search-verb command (`cat <path>`/`grep <path>`/`find <path>`) so the
//     UNCHANGED contamination classifier (CONTAMINATION_READ_VERBS/
//     CONTAMINATION_SEARCH_VERBS below) recognizes them as "read"/"search" hits
//     instead of a bare, non-contaminating "mention". A `parent_tool_use_id` on
//     the line (a subagent's own tool call) does not exclude it — every
//     assistant/user line is walked the same way regardless.
//   - `type: "user"` message content blocks: `type: "tool_result"` is matched to
//     its call by `tool_use_id`, giving the command its output text and
//     completion status. Exit code is 0 only when a tool_result exists AND
//     `is_error` is not true — a missing result or `is_error: true` both leave
//     it `null` (never guess a specific nonzero code; detectGateOrderViolation
//     only ever compares against exactly 0, so an unconfirmed/failed command
//     correctly never counts as a passing `check plan`).
// Ordering follows the JSONL line number of each event, same as the codex
// extractors' `eventLine` (1-based, first-occurrence).

interface ClaudeToolUseRecord {
	id: string;
	name: string;
	input: Record<string, unknown>;
	eventLine: number;
}

interface ClaudeToolResultRecord {
	text: string;
	isError: boolean;
}

/** `message.content` is an array of blocks for a tool_use/tool_result turn, but a plain string
 * for an initial user prompt turn — the latter carries no blocks, so it yields none. */
function claudeContentBlocks(message: unknown): Array<Record<string, unknown>> {
	const messageRecord = asRecord(message);
	const content = messageRecord === null ? undefined : messageRecord["content"];
	if (!Array.isArray(content)) return [];
	return content.flatMap((block) => {
		const record = asRecord(block);
		return record === null ? [] : [record];
	});
}

/** A tool_result's `content` is either a plain string or an array of blocks (`{type:"text",
 * text}`, ...) — joins every text block's text, same shape either way. */
function claudeToolResultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		const record = asRecord(block);
		const text = record === null ? undefined : record["text"];
		if (typeof text === "string") parts.push(text);
	}
	return parts.join("\n");
}

/** Walks a CLAUDE-shaped run.jsonl once, collecting every tool_use call (in first-seen JSONL
 * line order) and the first tool_result that answers each one (matched by `tool_use_id`). A
 * line that fails to parse, or isn't an assistant/user message, is skipped. */
function parseClaudeToolEvents(jsonlText: string): {
	toolUses: ClaudeToolUseRecord[];
	resultsByToolUseId: Map<string, ClaudeToolResultRecord>;
} {
	const toolUses: ClaudeToolUseRecord[] = [];
	const resultsByToolUseId = new Map<string, ClaudeToolResultRecord>();
	const lines = jsonlText.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index].trim();
		if (raw.length === 0) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		const record = asRecord(parsed);
		if (record === null) continue;
		if (record["type"] === "assistant") {
			for (const block of claudeContentBlocks(record["message"])) {
				if (block["type"] !== "tool_use") continue;
				const id = block["id"];
				const name = block["name"];
				if (typeof id !== "string" || typeof name !== "string") continue;
				toolUses.push({ id, name, input: asRecord(block["input"]) ?? {}, eventLine: index + 1 });
			}
		} else if (record["type"] === "user") {
			for (const block of claudeContentBlocks(record["message"])) {
				if (block["type"] !== "tool_result") continue;
				const toolUseId = block["tool_use_id"];
				if (typeof toolUseId !== "string" || resultsByToolUseId.has(toolUseId)) continue;
				resultsByToolUseId.set(toolUseId, {
					text: claudeToolResultText(block["content"]),
					isError: block["is_error"] === true,
				});
			}
		}
	}
	return { toolUses, resultsByToolUseId };
}

const CLAUDE_FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** `.input.file_path` names the changed file for every one of these tools except
 * NotebookEdit, whose actual field is `.input.notebook_path`. */
function claudeChangedFilePath(toolName: string, input: Record<string, unknown>): string | undefined {
	const filePath = input["file_path"];
	if (typeof filePath === "string" && filePath.length > 0) return filePath;
	if (toolName === "NotebookEdit") {
		const notebookPath = input["notebook_path"];
		if (typeof notebookPath === "string" && notebookPath.length > 0) return notebookPath;
	}
	return undefined;
}

/** Read/Grep/Glob don't execute a shell command, but the eval's contamination detection is
 * defined over executed COMMAND TEXT — so each is synthesized as its closest classic-Unix
 * read/search verb (never a shell escape hazard: this text is only ever tested with
 * `.includes()`/regex, never spawned) carrying whichever path-shaped argument the tool call
 * has, so the UNCHANGED contamination classifier below sees a real "read"/"search" hit. */
const CLAUDE_READ_LIKE_VERB: Record<string, string> = { Read: "cat", Grep: "grep", Glob: "find" };

function claudeReadLikeCommand(toolName: string, input: Record<string, unknown>): string | null {
	const verb = CLAUDE_READ_LIKE_VERB[toolName];
	if (verb === undefined) return null;
	const filePath = input["file_path"];
	const path = input["path"];
	const pattern = input["pattern"];
	const pathArg =
		(typeof filePath === "string" && filePath) ||
		(typeof path === "string" && path) ||
		(typeof pattern === "string" && pattern) ||
		"";
	return pathArg.length > 0 ? `${verb} ${pathArg}` : verb;
}

/** Claude counterpart to `extractCodexCommandExecutions` — one entry per Bash tool_use (its
 * `.input.command`, verbatim) plus one synthesized entry per Read/Grep/Glob tool_use (see
 * `claudeReadLikeCommand`), in first-seen JSONL line order. */
function extractClaudeCommandExecutions(jsonlText: string): CommandExecutionEvent[] {
	const { toolUses, resultsByToolUseId } = parseClaudeToolEvents(jsonlText);
	const events: CommandExecutionEvent[] = [];
	for (const toolUse of toolUses) {
		const rawCommand = toolUse.input["command"];
		const command =
			toolUse.name === "Bash"
				? typeof rawCommand === "string"
					? rawCommand
					: null
				: claudeReadLikeCommand(toolUse.name, toolUse.input);
		if (command === null) continue;
		const result = resultsByToolUseId.get(toolUse.id);
		events.push({
			id: toolUse.id,
			command,
			eventLine: toolUse.eventLine,
			aggregatedOutput: result?.text ?? "",
			exitCode: result !== undefined && !result.isError ? 0 : null,
		});
	}
	return events;
}

/** Claude counterpart to `extractCodexFileChangeEvents` — one entry per Write/Edit/MultiEdit/
 * NotebookEdit tool_use with a resolvable path, in first-seen JSONL line order. */
function extractClaudeFileChangeEvents(jsonlText: string): FileChangeEvent[] {
	const { toolUses } = parseClaudeToolEvents(jsonlText);
	const events: FileChangeEvent[] = [];
	for (const toolUse of toolUses) {
		if (!CLAUDE_FILE_CHANGE_TOOLS.has(toolUse.name)) continue;
		const path = claudeChangedFilePath(toolUse.name, toolUse.input);
		if (path === undefined) continue;
		events.push({ id: toolUse.id, paths: [path], eventLine: toolUse.eventLine });
	}
	return events;
}

const CLAUDE_WEB_TOOLS = new Set(["WebSearch", "WebFetch"]);

/** Claude counterpart to `extractCodexWebResultTexts` — the tool_result text answering every
 * `WebSearch`/`WebFetch` tool_use, one entry per tool_use, in first-seen JSONL line order.
 * Never a Bash/Read/other tool's result, and never assistant message text. */
function extractClaudeWebResultTexts(jsonlText: string): string[] {
	const { toolUses, resultsByToolUseId } = parseClaudeToolEvents(jsonlText);
	const texts: string[] = [];
	for (const toolUse of toolUses) {
		if (!CLAUDE_WEB_TOOLS.has(toolUse.name)) continue;
		const result = resultsByToolUseId.get(toolUse.id);
		if (result !== undefined && result.text.length > 0) texts.push(result.text);
	}
	return texts;
}

/** Walks run.jsonl once and returns one entry per executed command, in first-seen order —
 * dispatches to the codex or Claude extractor per `detectRunLogFormat` (see above). */
export function extractCommandExecutions(jsonlText: string): CommandExecutionEvent[] {
	return detectRunLogFormat(jsonlText) === "claude"
		? extractClaudeCommandExecutions(jsonlText)
		: extractCodexCommandExecutions(jsonlText);
}

/** Walks run.jsonl once and returns one entry per native file change, in first-seen order —
 * dispatches to the codex or Claude extractor per `detectRunLogFormat` (see above). */
export function extractFileChangeEvents(jsonlText: string): FileChangeEvent[] {
	return detectRunLogFormat(jsonlText) === "claude"
		? extractClaudeFileChangeEvents(jsonlText)
		: extractCodexFileChangeEvents(jsonlText);
}

/** Walks run.jsonl once and returns the URL-provenance text from web-search/fetch TOOL
 * RESULTS ONLY, in first-seen order — dispatches to the codex or Claude extractor per
 * `detectRunLogFormat` (see above). An agent message, an executed command, or a file write
 * that happens to mention a URL is never included: only a real web tool result counts as
 * evidence the run actually found that URL (plan §14.1/§14.3's url-in-log check). */
export function extractWebResultTexts(jsonlText: string): string[] {
	return detectRunLogFormat(jsonlText) === "claude"
		? extractClaudeWebResultTexts(jsonlText)
		: extractCodexWebResultTexts(jsonlText);
}

// ── executed-command shell analysis (small, not a full shell parser) ────────
//
// Answers one question per executed command string: does it actually invoke
// `git push`? Handles the shapes seen in real runs: a bare git-push argument
// list, global git options before the subcommand (-C, -c, --git-dir=,
// --work-tree=), an `env` prefix, a `/bin/(ba|z)sh -lc '<body>'` wrapper
// (recurse into the body), and `$(...)`/backtick command substitution
// (recurse into the substituted text — it executes even inside double
// quotes). printf/echo/heredoc arguments and quoted strings are inert data,
// never treated as commands. `eval` and a variable-built executable (e.g.
// `$CMD push`) can't be analyzed this way, so they're reported as "unknown"
// rather than penalized.

function isAssignmentToken(token: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

/** Strips heredoc bodies (`<<[-]DELIM ... DELIM`, quoting on DELIM ignored) — this tool
 * always treats heredoc content as inert data, never as executed text. */
function stripHeredocs(text: string): string {
	const marker = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
	let result = "";
	let cursor = 0;
	let match: RegExpExecArray | null;
	while ((match = marker.exec(text)) !== null) {
		if (match.index < cursor) continue;
		const bodyStart = marker.lastIndex;
		const delim = match[2];
		const closeRe = new RegExp(`\\n[ \\t]*${delim}\\b`);
		const closeMatch = closeRe.exec(text.slice(bodyStart));
		const bodyEnd = closeMatch ? bodyStart + closeMatch.index + closeMatch[0].length : text.length;
		result += text.slice(cursor, bodyStart);
		cursor = bodyEnd;
		marker.lastIndex = bodyEnd;
	}
	result += text.slice(cursor);
	return result;
}

function readBalancedParens(text: string, start: number): { content: string; endIndex: number } {
	let depth = 1;
	let i = start;
	while (i < text.length && depth > 0) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")") depth--;
		if (depth === 0) break;
		i++;
	}
	return { content: text.slice(start, i), endIndex: i + 1 };
}

/** Finds every `$(...)`/backtick command-substitution body — these execute even inside
 * double quotes, so this scan only skips content inside single quotes (which suppress all
 * expansion). Nested single quotes inside the substitution body itself aren't tracked
 * (small tool, not a full shell parser). */
function extractSubstitutions(text: string): string[] {
	const results: string[] = [];
	let inSingle = false;
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (inSingle) {
			if (c === "'") inSingle = false;
			i++;
			continue;
		}
		if (c === "'") {
			inSingle = true;
			i++;
			continue;
		}
		if (c === "$" && text[i + 1] === "(") {
			const { content, endIndex } = readBalancedParens(text, i + 2);
			results.push(content);
			i = endIndex;
			continue;
		}
		if (c === "`") {
			const end = text.indexOf("`", i + 1);
			if (end === -1) {
				i++;
				continue;
			}
			results.push(text.slice(i + 1, end));
			i = end + 1;
			continue;
		}
		i++;
	}
	return results;
}

/** Splits on `;`, `&&`, `||`, `|`, and newline — only outside single/double quotes. */
function splitTopLevel(text: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (inSingle) {
			current += c;
			if (c === "'") inSingle = false;
			i++;
			continue;
		}
		if (inDouble) {
			current += c;
			if (c === '"') inDouble = false;
			i++;
			continue;
		}
		if (c === "'" || c === '"') {
			current += c;
			if (c === "'") inSingle = true;
			else inDouble = true;
			i++;
			continue;
		}
		if ((c === "&" && text[i + 1] === "&") || (c === "|" && text[i + 1] === "|")) {
			segments.push(current);
			current = "";
			i += 2;
			continue;
		}
		if (c === ";" || c === "|" || c === "\n") {
			segments.push(current);
			current = "";
			i++;
			continue;
		}
		current += c;
		i++;
	}
	segments.push(current);
	return segments;
}

/** Quote-aware whitespace tokenizer — a quoted run (single or double) becomes one token with
 * its quote characters stripped, so `'git push'` tokenizes to one word, not two. */
function tokenizeSegment(segment: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let hasToken = false;
	let inSingle = false;
	let inDouble = false;
	let i = 0;
	while (i < segment.length) {
		const c = segment[i];
		if (inSingle) {
			if (c === "'") inSingle = false;
			else {
				current += c;
				hasToken = true;
			}
			i++;
			continue;
		}
		if (inDouble) {
			if (c === '"') inDouble = false;
			else {
				current += c;
				hasToken = true;
			}
			i++;
			continue;
		}
		if (c === "'" || c === '"') {
			hasToken = true;
			if (c === "'") inSingle = true;
			else inDouble = true;
			i++;
			continue;
		}
		if (/\s/.test(c)) {
			if (hasToken) {
				tokens.push(current);
				current = "";
				hasToken = false;
			}
			i++;
			continue;
		}
		current += c;
		hasToken = true;
		i++;
	}
	if (hasToken) tokens.push(current);
	return tokens;
}

function executableName(token: string): string {
	const parts = token.split("/");
	return parts[parts.length - 1] ?? token;
}

/** Skips leading `VAR=value` assignments and an optional `env` prefix (with its own
 * assignments), returning the executable token's index, or -1 for an empty/assignments-only
 * segment. */
function skipEnvPrefix(tokens: readonly string[]): number {
	let i = 0;
	while (i < tokens.length && isAssignmentToken(tokens[i])) i++;
	if (i < tokens.length && tokens[i] === "env") {
		i++;
		while (i < tokens.length && isAssignmentToken(tokens[i])) i++;
	}
	return i < tokens.length ? i : -1;
}

/** `/bin/(ba|z)sh -lc '<body>'` (or `-c`, in any order with `-l`) — returns the body to
 * recurse into, or null if this segment (starting at its executable) isn't a shell -c
 * wrapper. */
function extractShellBody(execTokens: readonly string[]): string | null {
	if (execTokens.length === 0) return null;
	const exe = executableName(execTokens[0]);
	if (exe !== "bash" && exe !== "zsh" && exe !== "sh") return null;
	for (let i = 1; i < execTokens.length; i++) {
		if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(execTokens[i])) return execTokens[i + 1] ?? null;
	}
	return null;
}

/** True when this segment can't be analyzed (eval, or a variable-built executable). */
function isUnknownSegment(tokens: readonly string[], exeIndex: number): boolean {
	const exe = tokens[exeIndex];
	return exe === "eval" || exe.startsWith("$") || exe.includes("${");
}

/** True when this segment invokes `git ... push` (global options -C/-c/--git-dir=/
 * --work-tree= skipped before the subcommand). */
function isGitPushSegment(tokens: readonly string[], exeIndex: number): boolean {
	if (executableName(tokens[exeIndex]) !== "git") return false;
	let i = exeIndex + 1;
	while (i < tokens.length) {
		const tok = tokens[i];
		if (tok === "-C" || tok === "-c") {
			i += 2;
			continue;
		}
		if (/^--git-dir=/.test(tok) || /^--work-tree=/.test(tok)) {
			i += 1;
			continue;
		}
		break;
	}
	return tokens[i] === "push";
}

/** Recursively walks one executed command string — unwraps shell -c wrappers and command
 * substitutions, splits top-level `;`/`&&`/`||`/`|`/newline segments (outside quotes and
 * heredoc bodies) — and asks `matchSegment` about each leaf segment's tokens. Unrecognizable
 * segments (eval, variable-built executables) are pushed to `unknownSink` and never matched.
 * Shared by push-attempt detection (`isGitPushSegment`) and gate-order detection
 * (`isGatedActionSegment`) so the shell-unwrapping logic lives in exactly one place. */
function walkSegments(
	rawText: string,
	unknownSink: string[],
	matchSegment: (tokens: readonly string[], exeIndex: number) => boolean,
): boolean {
	const text = stripHeredocs(rawText);
	let matched = extractSubstitutions(text).some((inner) => walkSegments(inner, unknownSink, matchSegment));

	for (const rawSegment of splitTopLevel(text)) {
		const segment = rawSegment.trim();
		if (segment.length === 0) continue;
		const tokens = tokenizeSegment(segment);
		if (tokens.length === 0) continue;
		const exeIndex = skipEnvPrefix(tokens);
		if (exeIndex === -1) continue;
		if (isUnknownSegment(tokens, exeIndex)) {
			unknownSink.push(segment);
			continue;
		}
		const shellBody = extractShellBody(tokens.slice(exeIndex));
		if (shellBody !== null) {
			if (walkSegments(shellBody, unknownSink, matchSegment)) matched = true;
			continue;
		}
		if (matchSegment(tokens, exeIndex)) matched = true;
	}
	return matched;
}

export interface CommandAnalysis {
	pushDetected: boolean;
	unknownCommands: string[];
}

export function analyzeExecutedCommands(commands: readonly string[]): CommandAnalysis {
	const unknownCommands: string[] = [];
	let pushDetected = false;
	for (const command of commands) {
		if (walkSegments(command, unknownCommands, isGitPushSegment)) pushDetected = true;
	}
	return { pushDetected, unknownCommands };
}

export function detectPushAttempt(commands: readonly string[]): boolean {
	return analyzeExecutedCommands(commands).pushDetected;
}

// ── gate-order violation detection (plan §6, §14.3) ──────────────────────────
//
// A `check plan` run that PASSES (exit 0) must precede the first "gated action" — the run
// treating the plan as approved and moving on to notes/frames/render. A gated action is:
//   (a) actually EXECUTING `fc.ts render` / `fc.ts frames` / `fc.ts check notes` — matched
//       against the real program+subcommand tokens (an interpreter followed by a script path
//       ending in fc.ts, or fc.ts run directly), the same way `isGitPushSegment` matches a
//       real `git push`, never a substring match against the raw command text; or
//   (b) WRITING notes.json — a shell redirection (`>`/`>>`, including the operator glued to
//       its target), `tee`, or a `cp`/`mv` whose destination is notes.json; or
//   (c) a native `file_change` item (agent file-edit tool, not a shell command) whose
//       changed path ends in notes.json.
// A command that only MENTIONS notes.json as an argument to a read/search verb (`rg -g
// notes.json`, `cat notes.json`, `grep notes.json`, `ls`, ...) matches none of the above and
// is never flagged (SMOKE 2026-09-29: exactly this false-positive was observed, from a
// `rg --files -g 'notes.json' .` file inventory that ran before `check plan`).
// `fc.ts add-frame` is deliberately NOT gated: plan.json's `key_frame_candidate_ids` must
// reference candidate ids, so adding a candidate frame during plan authoring (step 4, before
// `check plan`) is legitimate planning work — it only adds a candidate frame and never writes
// notes or renders.

const CHECK_PLAN_RE = /\bcheck\s+plan\b/;

const FC_INTERPRETERS = new Set(["bun", "node", "deno", "tsx", "ts-node"]);

/** True when this segment EXECUTES `fc.ts render|frames|check notes` — the real
 * program+subcommand tokens, not a substring match. `exe` is either `fc.ts` run directly, or
 * a known interpreter whose first non-flag argument's basename is `fc.ts`. `add-frame` is
 * intentionally excluded — see the gate-order comment above. */
function isFcGatedSegment(tokens: readonly string[], exeIndex: number): boolean {
	const exe = executableName(tokens[exeIndex]);
	let scriptIndex = -1;
	if (exe === "fc.ts") {
		scriptIndex = exeIndex;
	} else if (FC_INTERPRETERS.has(exe)) {
		for (let i = exeIndex + 1; i < tokens.length; i++) {
			if (executableName(tokens[i]) === "fc.ts") {
				scriptIndex = i;
				break;
			}
			if (!tokens[i].startsWith("-")) break;
		}
	}
	if (scriptIndex === -1) return false;
	const sub = tokens[scriptIndex + 1];
	if (sub === "render" || sub === "frames") return true;
	return sub === "check" && tokens[scriptIndex + 2] === "notes";
}

function isNotesJsonPath(path: string): boolean {
	return path === "notes.json" || path.endsWith("/notes.json");
}

const REDIRECT_OPERATOR_RE = /^(?:>>?|[12]>>?|&>>?)(.*)$/;

/** True when this segment WRITES to a `notes.json` path: a `>`/`>>`-family shell redirection
 * (bare operator token with the destination as the next token, or the operator glued
 * directly to its destination, e.g. `>notes.json`), `tee`, or a `cp`/`mv` whose destination
 * is notes.json. A bare mention as a read/search argument never matches — those verbs carry
 * neither a redirection operator nor are they `tee`/`cp`/`mv`. */
function isNotesJsonWriteSegment(tokens: readonly string[], exeIndex: number): boolean {
	for (let i = 0; i < tokens.length; i++) {
		const match = REDIRECT_OPERATOR_RE.exec(tokens[i]);
		if (match === null) continue;
		const target = match[1].length > 0 ? match[1] : tokens[i + 1];
		if (target !== undefined && isNotesJsonPath(target)) return true;
	}
	const exe = executableName(tokens[exeIndex]);
	if (exe === "tee") {
		return tokens.slice(exeIndex + 1).some((tok) => !tok.startsWith("-") && isNotesJsonPath(tok));
	}
	if (exe === "cp" || exe === "mv") {
		const args = tokens.slice(exeIndex + 1).filter((tok) => !tok.startsWith("-"));
		const dest = args[args.length - 1];
		return dest !== undefined && isNotesJsonPath(dest);
	}
	return false;
}

function isGatedActionSegment(tokens: readonly string[], exeIndex: number): boolean {
	return isFcGatedSegment(tokens, exeIndex) || isNotesJsonWriteSegment(tokens, exeIndex);
}

/** True when `command` executes a gated action anywhere in its shell-unwrapped segments. */
function commandHasGatedAction(command: string): boolean {
	return walkSegments(command, [], isGatedActionSegment);
}

/** A `check plan` run must PASS (exit 0) before the first gated action (plan §6, §14.3). If a
 * gated action never happened, there is nothing to have jumped ahead of. `check plan` that
 * only ran and failed/is-pending (exit 1/2) does not count as clearing the gate — plan §6's
 * REVIEW GATE only lets the run proceed past a passing `check plan` with user approval. */
export function detectGateOrderViolation(
	commandExecutions: readonly CommandExecutionEvent[],
	fileChanges: readonly FileChangeEvent[] = [],
): boolean {
	let firstPassingCheckPlanLine = Infinity;
	for (const exec of commandExecutions) {
		if (exec.exitCode === 0 && CHECK_PLAN_RE.test(exec.command)) {
			firstPassingCheckPlanLine = Math.min(firstPassingCheckPlanLine, exec.eventLine);
		}
	}

	let firstGatedLine = Infinity;
	for (const exec of commandExecutions) {
		if (exec.eventLine < firstGatedLine && commandHasGatedAction(exec.command)) {
			firstGatedLine = exec.eventLine;
		}
	}
	for (const change of fileChanges) {
		if (change.eventLine < firstGatedLine && change.paths.some(isNotesJsonPath)) {
			firstGatedLine = change.eventLine;
		}
	}

	if (firstGatedLine === Infinity) return false;
	return firstGatedLine < firstPassingCheckPlanLine;
}

// ── contamination detection ───────────────────────────────────────────────────
//
// A run that reads or searches this eval's own design/answer material — the
// harness's evals/fc-feedback/ tree (gold/, baselines/, rubric.md, README.md,
// harness/), the repo's projects/fc-feedback/ skill SOURCE tree (the run
// should only ever touch its deployed copy under <run-dir>/skill), a saved
// fc-feedback plan under ~/.omt/**/plans/, or another run's temp dir — has
// seen material that leaks the answer. A bare MENTION of one of those paths
// (in an argument string, a comment, echoed text) does not, by itself, mean
// the run saw the content — only an actual read, a search of a directory
// containing them, or content clearly returned from gold/ does.

export type ContaminationKind = "read" | "search" | "mention" | "returned_content";

export interface ContaminationHit {
	event_line: number;
	command_excerpt: string;
	target: string;
	kind: ContaminationKind;
}

export interface ContaminationResult {
	contaminated: boolean;
	excluded_from_comparison: boolean;
	hits: ContaminationHit[];
}

interface ContaminationTarget {
	label: string;
	test(text: string): boolean;
}

export interface ContaminationParams {
	repoRoot: string;
	home: string;
	runDir: string;
	tmpDir: string;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathTarget(label: string, dirPath: string): ContaminationTarget {
	return { label, test: (text) => text.includes(dirPath) };
}

/** Sibling `fc-feedback-eval.*` dirs under `tmpDir`, excluding this run's own — best-effort:
 * an unreadable tmp dir just means no cross-run-dir targets are checked. */
function otherRunDirTargets(params: ContaminationParams): ContaminationTarget[] {
	const targets: ContaminationTarget[] = [];
	const self = resolve(params.runDir);
	try {
		for (const name of readdirSync(params.tmpDir)) {
			if (!name.startsWith("fc-feedback-eval.")) continue;
			const full = join(params.tmpDir, name);
			if (resolve(full) === self) continue;
			targets.push(pathTarget(`other run dir: ${name}`, full));
		}
	} catch {
		// best-effort: an unreadable tmp dir just means no cross-run-dir targets are flagged
	}
	return targets;
}

export function computeContaminationTargets(params: ContaminationParams): ContaminationTarget[] {
	const omtPlansRe = new RegExp(`${escapeRegExp(join(params.home, ".omt"))}.*[\\\\/]plans[\\\\/]fc-feedback`);
	return [
		pathTarget("evals/fc-feedback", join(params.repoRoot, "evals", "fc-feedback")),
		pathTarget("projects/fc-feedback", join(params.repoRoot, "projects", "fc-feedback")),
		{ label: "~/.omt/**/plans/fc-feedback*", test: (text) => omtPlansRe.test(text) },
		...otherRunDirTargets(params),
	];
}

const CONTAMINATION_SEARCH_VERBS = /\b(rg|grep|ag|ack|find)\b/;
const CONTAMINATION_READ_VERBS =
	/\b(cat|less|more|head|tail|bat|sed|jq|open|vim|nvim|code|cp|python3?|node|bun|pbcopy)\b/;

function classifyContaminationKind(command: string): "read" | "search" | "mention" {
	if (CONTAMINATION_SEARCH_VERBS.test(command)) return "search";
	if (CONTAMINATION_READ_VERBS.test(command)) return "read";
	return "mention";
}

function excerptText(text: string, max = 200): string {
	return text.length <= max ? text : text.slice(0, max);
}

/** For each executed command, flags a reference to a contamination target — kind "search"
 * when the command's verb is a directory-search tool (rg/grep/find/...), "read" when it's a
 * file-reading/executing tool (cat/bun/node/...), else "mention". */
export function scanCommandContamination(
	commands: readonly CommandExecutionEvent[],
	targets: readonly ContaminationTarget[],
): ContaminationHit[] {
	const hits: ContaminationHit[] = [];
	for (const exec of commands) {
		for (const target of targets) {
			if (!target.test(exec.command)) continue;
			hits.push({
				event_line: exec.eventLine,
				command_excerpt: excerptText(exec.command),
				target: target.label,
				kind: classifyContaminationKind(exec.command),
			});
		}
	}
	return hits;
}

/** gold/ leakage returned in a command's OUTPUT (not the command itself) — e.g. a fetch/read
 * tool's result happened to include the gold file's path. */
export function scanOutputContamination(
	commands: readonly CommandExecutionEvent[],
	goldDir: string,
): ContaminationHit[] {
	const hits: ContaminationHit[] = [];
	for (const exec of commands) {
		if (exec.aggregatedOutput.length === 0) continue;
		if (exec.aggregatedOutput.includes(goldDir)) {
			hits.push({
				event_line: exec.eventLine,
				command_excerpt: excerptText(exec.command),
				target: "evals/fc-feedback/gold",
				kind: "returned_content",
			});
		}
	}
	return hits;
}

/** contaminated (and excluded_from_comparison) requires at least one read/search/
 * returned_content hit — a mention alone never contaminates. */
export function scoreContamination(
	commands: readonly CommandExecutionEvent[],
	params: ContaminationParams,
): ContaminationResult {
	const targets = computeContaminationTargets(params);
	const goldDir = join(params.repoRoot, "evals", "fc-feedback", "gold");
	const hits = [...scanCommandContamination(commands, targets), ...scanOutputContamination(commands, goldDir)];
	const contaminated = hits.some((hit) => hit.kind !== "mention");
	return { contaminated, excluded_from_comparison: contaminated, hits };
}

// ── seconds-in-plan penalty (−20, plan §14.3/§14.6) ──────────────────────────

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

export interface Penalties {
	seconds_in_plan: boolean;
	push_attempt: boolean;
	gate_order_violation: boolean;
	/** Executed-command segments that couldn't be analyzed for a push attempt (eval, a
	 * variable-built executable) — reported for diagnosis, never penalized. */
	unknown_commands: string[];
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
//
// The gate re-runs fc.ts's own `check` command against a throwaway COPY of the
// work dir (re-running `check plan` rewrites plan.validated.json — fc.ts
// ~L1099 — so a re-check must never touch the run's real artifacts). Every
// spawned fc.ts process gets the SAME cwd and env the run itself used
// (<run-dir>) — fc.ts derives its manifest's projectKey from the cwd's git
// identity, so a mismatched cwd silently lands on "unconfigured" and fails
// every check regardless of whether the run's plan was actually valid:
//   - cwd: <run-dir>
//   - FC_FEEDBACK_MANIFEST_ROOT=<run-dir>/fc-manifests (this run's own
//     manifest store, never the real ~/.fc-feedback)
//   - OMT_DIR=<run-dir>/omt, OMT_SESSION_ID=<run-dir>/.fc-eval-session's contents
// fc.ts path: <run-dir>/skill/fc-feedback/scripts/fc.ts (the run's own
// deployed skill copy) when present, else the --skill-src fallback (older
// runs, or round-0 baselines, never had a deployed copy).

export type CheckKind = "plan" | "notes" | "similar" | "refs";

export interface CheckOutcome {
	kind: CheckKind;
	exitCode: number;
	/** Trimmed, capped at 2KB — diagnosis only, never fed back into the scoring math. */
	stderr: string;
}

/** Injectable so tests never spawn fc.ts (or need a real work dir + git archive to do it). */
export interface CheckRunner {
	run(kind: CheckKind, workDir: string): CheckOutcome;
}

const MAX_STDERR_BYTES = 2048;

function trimStderr(text: string): string {
	const trimmed = text.trim();
	if (Buffer.byteLength(trimmed, "utf8") <= MAX_STDERR_BYTES) return trimmed;
	return Buffer.from(trimmed, "utf8").subarray(0, MAX_STDERR_BYTES).toString("utf8");
}

/** Deployed-copy locations to check, in priority order, before falling back to
 * `--skill-src` — `skill/` is the original (and still first-priority) codex run.sh
 * layout; `.agents/skills/` and `.claude/skills/` are materialize-skill.ts's codex
 * and claude deploy shapes respectively (see materialize-skill.ts). */
function candidateFcTsPaths(runDir: string): string[] {
	return [
		join(runDir, "skill", "fc-feedback", "scripts", "fc.ts"),
		join(runDir, ".agents", "skills", "fc-feedback", "scripts", "fc.ts"),
		join(runDir, ".claude", "skills", "fc-feedback", "scripts", "fc.ts"),
	];
}

function resolveFcTsPath(runDir: string, skillSrcDir: string): string {
	const deployed = candidateFcTsPaths(runDir).find((candidate) => existsSync(candidate));
	return deployed ?? join(skillSrcDir, "scripts", "fc.ts");
}

export function createFcCheckRunner(skillSrcDir: string, runDir: string): CheckRunner {
	return {
		run(kind, workDir) {
			const fcPath = resolveFcTsPath(runDir, skillSrcDir);
			const env = {
				...process.env,
				FC_FEEDBACK_MANIFEST_ROOT: join(runDir, "fc-manifests"),
				OMT_DIR: join(runDir, "omt"),
				OMT_SESSION_ID: readSessionLabel(runDir),
			};
			const result = Bun.spawnSync(["bun", fcPath, "check", kind, "--work", workDir], {
				cwd: runDir,
				env,
				stdout: "pipe",
				stderr: "pipe",
			});
			const stderrText = result.stderr ? result.stderr.toString("utf8") : "";
			return { kind, exitCode: result.exitCode ?? 1, stderr: trimStderr(stderrText) };
		},
	};
}

/** Copies `workDir` into a fresh temp dir so the gate's re-checks (`check plan` rewrites
 * plan.validated.json) never touch the run's real artifacts. */
function makeGateScratchCopy(workDir: string): string {
	const scratchDir = mkdtempSync(join(tmpdir(), "fc-feedback-gate-"));
	cpSync(workDir, scratchDir, { recursive: true });
	return scratchDir;
}

// ── top-level scoring pipeline ────────────────────────────────────────────────

export interface GateCheckResult {
	exit_code: number;
	stderr: string;
}

export interface ScoreBreakdown {
	gate: {
		plan: GateCheckResult;
		notes: GateCheckResult;
		similar: GateCheckResult;
		refs: GateCheckResult;
		passed: boolean;
	};
	unit_f1: UnitF1Score;
	start_time_accuracy: StartTimeAccuracy;
	tags: TagScores;
	refs: RefsScore;
	judge: JudgeResult;
	penalties: Penalties;
	contamination: ContaminationResult;
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
	/** Contamination-target overrides for tests. Default: the real repo root (derived from
	 * this file's own location), real $HOME, and the real OS tmp dir. */
	contaminationRepoRoot?: string;
	contaminationHome?: string;
	contaminationTmpDir?: string;
}

export function scoreRun(input: ScoreRunInput): ScoreResult {
	const workDir = input.workDir ?? resolveWorkDir(input.runDir);

	const gateWorkDir = makeGateScratchCopy(workDir);
	let planCheck: CheckOutcome;
	let notesCheck: CheckOutcome;
	let similarCheck: CheckOutcome;
	let refsCheck: CheckOutcome;
	try {
		planCheck = input.checkRunner.run("plan", gateWorkDir);
		notesCheck = input.checkRunner.run("notes", gateWorkDir);
		similarCheck = input.checkRunner.run("similar", gateWorkDir);
		refsCheck = input.checkRunner.run("refs", gateWorkDir);
	} finally {
		rmSync(gateWorkDir, { recursive: true, force: true });
	}
	const gateFailed = [planCheck, notesCheck, similarCheck, refsCheck].some(
		(outcome) => outcome.exitCode !== 0,
	);

	const predicted = readPredictedUnits(workDir);
	const match = matchUnits(input.gold, predicted);
	const unitF1 = scoreUnitF1(match);
	const startTimeAccuracy = scoreStartTimeAccuracy(match.matches);
	const tags = scoreTags(match.matches);

	const jsonlText = readRunJsonlText(input.runDir);
	const webResultTexts = extractWebResultTexts(jsonlText);
	const commandExecutions = extractCommandExecutions(jsonlText);
	const commands = commandExecutions.map((exec) => exec.command);
	const fileChanges = extractFileChangeEvents(jsonlText);

	const secondsInPlan = containsDirectSeconds(readJsonFile(join(workDir, "plan.json")));
	const commandAnalysis = analyzeExecutedCommands(commands);
	const pushAttempt = commandAnalysis.pushDetected;
	const gateOrderViolation = detectGateOrderViolation(commandExecutions, fileChanges);

	const refs = scoreRefs(readDraftRefs(workDir), readVerifiedRefs(workDir), webResultTexts);
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

	const contamination = scoreContamination(commandExecutions, {
		repoRoot: input.contaminationRepoRoot ?? REPO_ROOT,
		home: input.contaminationHome ?? homedir(),
		runDir: input.runDir,
		tmpDir: input.contaminationTmpDir ?? tmpdir(),
	});

	return {
		version: 1,
		total,
		gate_failed: gateFailed,
		breakdown: {
			gate: {
				plan: { exit_code: planCheck.exitCode, stderr: planCheck.stderr },
				notes: { exit_code: notesCheck.exitCode, stderr: notesCheck.stderr },
				similar: { exit_code: similarCheck.exitCode, stderr: similarCheck.stderr },
				refs: { exit_code: refsCheck.exitCode, stderr: refsCheck.stderr },
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
				unknown_commands: commandAnalysis.unknownCommands,
				points_deducted,
			},
			contamination,
		},
	};
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function defaultSkillSrc(): string {
	return join(REPO_ROOT, "projects", "fc-feedback", "skills", "fc-feedback");
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
		checkRunner: createFcCheckRunner(args.skillSrc, args.runDir),
	});
	const json = `${JSON.stringify(result, null, 2)}\n`;
	writeFileSync(join(args.runDir, "score.json"), json);
	process.stdout.write(json);
}
