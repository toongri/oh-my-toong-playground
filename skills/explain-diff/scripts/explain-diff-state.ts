#!/usr/bin/env bun
/**
 * explain-diff state CLI — the only writer of explain-diff-state-<sid>.json.
 *
 * Every step transition passes through here, which is what makes the gate real:
 * the PreToolUse artifact guard and the Stop gate read booleans this CLI wrote,
 * and hooks/write-guard-core.sh denies any attempt to edit the file directly.
 * A step cannot advance because someone said it did — it advances because the
 * structural checks in lib/explain-diff-structure.ts passed and a judge backed
 * every existence claim with a quote this CLI found in the document.
 */
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { getOmtDir } from "@lib/omt-dir";
import { Lexer, Parser, type Token } from "marked";
import { findMarkdownBlocks } from "@lib/markdown-blocks";
import { lintReceiptProblem, nowStamp, resolveSessionIdOrThrow, STATE_PREFIX } from "@lib/state-core";
import {
	computeDerived,
	CAPABILITY_STEP_MIGRATION_VERSION,
	nextStep,
	normalizeExplainDiffState,
	REQUIRED_JUDGE_IDS,
	STEP_ORDER,
	type ExplainDiffState,
	type Step,
} from "@lib/explain-diff-core";
import {
	checkStructure,
	DIAGRAM_FIGURE_PATTERN,
	diagramFigures,
	documentHeadings,
	usedStyleClasses,
	type DiffHunk,
	type DiffLineRange,
} from "@lib/explain-diff-structure";
import { renderHelp, type CliCommand } from "@lib/cli-help";

interface Persisted extends ExplainDiffState {
	range: string;
	slug: string;
	/** Steps whose structural checks passed but whose judge review has not run. */
	structural_ok: Step[];
	/** Render proof contract used by the persisted structural render verdict. */
	render_proof_contract_version: number;
	/** Exact artifact paths bound by the successful render submission. */
	render_proof: RenderProofBinding | null;
	diff_hunks: DiffHunk[];
	/**
	 * Commit-body ∪ net-diff corpus for R22 (근거 소스 대조), captured once at
	 * `start` — the one moment the CLI is guaranteed to run inside the repo —
	 * and read (never re-fetched) at the `code` submit, exactly like diff_hunks.
	 * Empty means capture failed; R22 then fail-opens.
	 */
	source_corpus: string;
	started_at: string;
	last_touched_at: string;
	derived: ReturnType<typeof computeDerived>;
}

/**
 * What the successful render submission bound: the document and the model-authored
 * HTML (both by path and by content hash), the lint receipt with the evidence
 * folder it was linted against, and the two review reports.
 */
interface RenderProofBinding {
	doc_path: string;
	doc_sha256: string;
	html_path: string;
	html_sha256: string;
	lint_receipt_path: string;
	lint_source_path: string;
	writing_report_path: string;
	checklist_path: string;
}

const CURRENT_RENDER_PROOF_CONTRACT_VERSION = 2;

function statePath(sessionId: string): string {
	return `${getOmtDir()}/${STATE_PREFIX["explain-diff"]}${sessionId}.json`;
}

function sha256File(path: string): string | null {
	try {
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch {
		return null;
	}
}

function normalizeRenderProofBinding(raw: unknown): RenderProofBinding | null {
	if (raw === null || typeof raw !== "object") return null;
	const record: Record<string, unknown> = {};
	Object.assign(record, raw);
	const text = (key: string): string | null => {
		const value = record[key];
		return typeof value === "string" && value.length > 0 ? value : null;
	};
	const sha = (key: string): string | null => {
		const value = text(key);
		return value !== null && /^[0-9a-f]{64}$/.test(value) ? value : null;
	};
	const docPath = text("doc_path");
	const docSha = sha("doc_sha256");
	const htmlPath = text("html_path");
	const htmlSha = sha("html_sha256");
	const receiptPath = text("lint_receipt_path");
	const lintSource = text("lint_source_path");
	const writingReportPath = text("writing_report_path");
	const checklistPath = text("checklist_path");
	if (
		docPath === null ||
		docSha === null ||
		htmlPath === null ||
		htmlSha === null ||
		receiptPath === null ||
		lintSource === null ||
		writingReportPath === null ||
		checklistPath === null
	)
		return null;
	return {
		doc_path: docPath,
		doc_sha256: docSha,
		html_path: htmlPath,
		html_sha256: htmlSha,
		lint_receipt_path: receiptPath,
		lint_source_path: lintSource,
		writing_report_path: writingReportPath,
		checklist_path: checklistPath,
	};
}

// mkdir is atomic, which is the property this needs: two CLI processes racing on
// the same state file must serialize, and the loser must wait rather than
// clobber. Same mechanism qa-state.ts uses, for the same reason.
const LOCK_RETRIES = 200;
const LOCK_SLEEP = new Int32Array(new SharedArrayBuffer(4));

function withLock<T>(path: string, fn: () => T): T {
	const lockPath = `${path}.lock`;
	for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
		try {
			mkdirSync(lockPath, { recursive: false });
			try {
				return fn();
			} finally {
				rmSync(lockPath, { recursive: true, force: true });
			}
		} catch (err) {
			// Only a lost create race is retryable; anything else is a real failure
			// and must surface rather than spin for a second.
			const code =
				err !== null && typeof err === "object" && "code" in err ? String(err.code) : "";
			if (code !== "EEXIST") throw err;
			Atomics.wait(LOCK_SLEEP, 0, 0, 5);
		}
	}
	throw new Error(`could not acquire state lock: ${path}.lock`);
}

interface ReadSnapshot {
	state: Persisted;
	needsCapabilityStepMigration: boolean;
	needsRenderProofMigration: boolean;
}

/** Reads and normalizes one state-file snapshot without acquiring a lock or writing. */
function readSnapshot(sessionId: string): ReadSnapshot | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(statePath(sessionId), "utf8"));
		const base = normalizeExplainDiffState(parsed);
		if (!base) return null;
		const r: Record<string, unknown> = {};
		Object.assign(r, parsed);
		const rawStep = STEP_ORDER.find((step) => step === r["step"]);
		const needsCapabilityStepMigration =
			r["active"] === true &&
			Object.prototype.hasOwnProperty.call(r, "commit_hashes") &&
			!Object.prototype.hasOwnProperty.call(r, "capability_step_migration_version") &&
			rawStep !== undefined &&
			STEP_ORDER.indexOf(rawStep) > STEP_ORDER.indexOf("capability") &&
			!base.passed.includes("capability");
		const structuralRaw = r["structural_ok"];
		const renderProof = normalizeRenderProofBinding(r["render_proof"]);
		const hasCurrentRenderProofContract =
			r["render_proof_contract_version"] === CURRENT_RENDER_PROOF_CONTRACT_VERSION &&
			renderProof !== null;
		const state: Persisted = {
			...base,
			...(needsCapabilityStepMigration
				? { capability_step_migration_version: CAPABILITY_STEP_MIGRATION_VERSION }
				: {}),
			structural_ok: Array.isArray(structuralRaw)
				? structuralRaw.flatMap((x) => STEP_ORDER.find((s) => s === x) ?? [])
				: [],
			render_proof_contract_version: CURRENT_RENDER_PROOF_CONTRACT_VERSION,
			render_proof: renderProof,
			diff_hunks: normalizeStoredDiffHunks(r["diff_hunks"]),
			source_corpus: typeof r["source_corpus"] === "string" ? r["source_corpus"] : "",
			range: typeof r["range"] === "string" ? r["range"] : "",
			slug: typeof r["slug"] === "string" ? r["slug"] : "",
			started_at: typeof r["started_at"] === "string" ? r["started_at"] : nowStamp(),
			last_touched_at:
				typeof r["last_touched_at"] === "string" ? r["last_touched_at"] : nowStamp(),
			// Recomputed on every write; the persisted copy is never trusted on read.
			derived: computeDerived(base),
		};
		if (needsCapabilityStepMigration) {
			state.structural_ok = state.structural_ok.filter(
				(step) => STEP_ORDER.indexOf(step) < STEP_ORDER.indexOf("capability"),
			);
		}
		const hasRenderProof =
			state.render_proof !== null ||
			state.structural_ok.includes("render") ||
			state.passed.includes("render") ||
			state.step === "quiz";
		const needsRenderProofMigration = !hasCurrentRenderProofContract && hasRenderProof;
		if (needsRenderProofMigration) {
			state.structural_ok = state.structural_ok.filter((step) => step !== "render");
			state.passed = state.passed.filter((step) => step !== "render");
			state.render_proof = null;
			if (state.step === "quiz") state.step = "render";
			state.last_failure = {
				step: "render",
				items: ["기존 render 증거가 현재 계약(모델이 쓴 HTML + lint 영수증, render_proof v2)으로 검증되지 않았습니다 — html-report 로 HTML 을 쓰고 lint 영수증과 함께 다시 제출하세요."],
			};
		}
		state.derived = computeDerived(state);
		return { state, needsCapabilityStepMigration, needsRenderProofMigration };
	} catch {
		return null;
	}
}

/**
 * Reads the state for the CLI. A legacy render-proof rewind is the one read path
 * that mutates state, so it owns the lock and re-reads after acquiring it; a
 * competing submit/pass can therefore never be overwritten by the first snapshot.
 */
function read(sessionId: string): Persisted | null {
	const snapshot = readSnapshot(sessionId);
	if (
		!snapshot ||
		(!snapshot.needsCapabilityStepMigration && !snapshot.needsRenderProofMigration)
	)
		return snapshot?.state ?? null;
	return withLock(statePath(sessionId), () => {
		const latest = readSnapshot(sessionId);
		if (!latest) return null;
		if (latest.needsCapabilityStepMigration || latest.needsRenderProofMigration)
			write(sessionId, latest.state);
		return latest.state;
	});
}

/** Every write recomputes `derived` — the booleans the hooks read are never stale. */
function write(sessionId: string, state: Persisted): void {
	state.derived = computeDerived(state);
	state.last_touched_at = nowStamp();
	const path = statePath(sessionId);
	mkdirSync(getOmtDir(), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function mustRead(sessionId: string): Persisted {
	const snapshot = readSnapshot(sessionId);
	if (!snapshot) throw new Error("explain-diff 상태가 없습니다. 먼저 `start` 를 실행하세요.");
	// Every caller of mustRead already owns the operation's outer lock. Reuse it
	// for the legacy rewind instead of trying to acquire the same lock again.
	if (snapshot.needsCapabilityStepMigration || snapshot.needsRenderProofMigration)
		write(sessionId, snapshot.state);
	return snapshot.state;
}

/** Normalizes one persisted hunk side and rejects malformed line metadata. */
function normalizeStoredLineRange(raw: unknown): DiffLineRange | null | undefined {
	if (raw === null) return null;
	if (raw === undefined || typeof raw !== "object") return undefined;
	const record: Record<string, unknown> = {};
	Object.assign(record, raw);
	const start = record["start"];
	const count = record["count"];
	if (
		typeof start !== "number" ||
		typeof count !== "number" ||
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(count) ||
		start < 0 ||
		count < 0
	)
		return undefined;
	if (count === 0) return null;
	if (start < 1) return undefined;
	return { start, count };
}

/** Rebuilds the optional CLI-owned hunk field; legacy states become `[]`. */
function normalizeStoredDiffHunks(raw: unknown): DiffHunk[] {
	if (!Array.isArray(raw)) return [];
	const out: DiffHunk[] = [];
	for (const item of raw) {
		if (item === null || typeof item !== "object") continue;
		const record: Record<string, unknown> = {};
		Object.assign(record, item);
		const path = record["path"];
		if (typeof path !== "string" || path.length === 0 || path === "/dev/null") continue;
		const base = normalizeStoredLineRange(record["base"]);
		const head = normalizeStoredLineRange(record["head"]);
		if (base === undefined || head === undefined || (base === null && head === null)) continue;
		out.push({ path, base, head });
	}
	return out;
}

/** Decodes Git's C-style quoted pathname form when a path needs it. */
function decodeGitPath(raw: string): string | null {
	if (!raw.startsWith('"')) return raw;
	if (raw.length < 2 || !raw.endsWith('"')) return null;
	const body = raw.slice(1, -1);
	let decoded = "";
	for (let i = 0; i < body.length; i += 1) {
		const char = body[i];
		if (char !== "\\") {
			decoded += char ?? "";
			continue;
		}
		const escaped = body[i + 1];
		if (escaped === undefined) return null;
		i += 1;
		switch (escaped) {
			case "a":
				decoded += "\x07";
				break;
			case "b":
				decoded += "\b";
				break;
			case "t":
				decoded += "\t";
				break;
			case "n":
				decoded += "\n";
				break;
			case "v":
				decoded += "\v";
				break;
			case "f":
				decoded += "\f";
				break;
			case "r":
				decoded += "\r";
				break;
			case "e":
				decoded += "\x1b";
				break;
			case "\\":
				decoded += "\\";
				break;
			case '"':
				decoded += '"';
				break;
			default: {
				if (!/[0-7]/.test(escaped)) return null;
				let octal = escaped;
				while (octal.length < 3 && /[0-7]/.test(body[i + 1] ?? "")) {
					i += 1;
					octal += body[i] ?? "";
				}
				decoded += String.fromCharCode(Number.parseInt(octal, 8));
			}
		}
	}
	return decoded;
}

type ParsedDiffPath = string | null | undefined;

/** Parses a `---` or `+++` file header without splitting paths on whitespace. */
function parseDiffHeaderPath(line: string, marker: "---" | "+++"): ParsedDiffPath {
	const prefix = `${marker} `;
	if (!line.startsWith(prefix)) return undefined;
	const decoded = decodeGitPath(line.slice(prefix.length));
	if (decoded === null) return undefined;
	if (decoded === "/dev/null") return null;
	const sidePrefix = marker === "---" ? "a/" : "b/";
	if (!decoded.startsWith(sidePrefix) || decoded.length === sidePrefix.length) return undefined;
	return decoded.slice(sidePrefix.length);
}

/** Parses a hunk header side; a zero-count side carries no file lines. */
function parseDiffLineRange(
	startText: string,
	countText: string | undefined,
): DiffLineRange | null | undefined {
	const start = Number(startText);
	const count = countText === undefined ? 1 : Number(countText);
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(count) ||
		start < 0 ||
		count < 0
	)
		return undefined;
	if (count === 0) return null;
	if (start < 1) return undefined;
	return { start, count };
}

/** Parses all textual hunk headers from one unified diff. */
function parseDiffHunks(output: string): DiffHunk[] {
	const out: DiffHunk[] = [];
	let basePath: ParsedDiffPath;
	let headPath: ParsedDiffPath;
	let inHunk = false;
	let fileHeaderContext = false;
	for (const line of output.split(/\r?\n/)) {
		if (line.startsWith("diff --git ")) {
			basePath = undefined;
			headPath = undefined;
			inHunk = false;
			fileHeaderContext = true;
			continue;
		}
		if (!inHunk && fileHeaderContext && line.startsWith("--- ")) {
			const parsed = parseDiffHeaderPath(line, "---");
			if (parsed === undefined) return [];
			basePath = parsed;
			headPath = undefined;
			continue;
		}
		if (!inHunk && fileHeaderContext && line.startsWith("+++ ")) {
			const parsed = parseDiffHeaderPath(line, "+++");
			if (parsed === undefined || basePath === undefined) return [];
			headPath = parsed;
			continue;
		}
		if (!line.startsWith("@@ ")) continue;

		const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(line);
		if (match === null || basePath === undefined || headPath === undefined) return [];
		inHunk = true;
		const path = headPath ?? basePath;
		if (path === null) return [];
		const base = parseDiffLineRange(match[1] ?? "", match[2]);
		const head = parseDiffLineRange(match[3] ?? "", match[4]);
		if (base === undefined || head === undefined || (base === null && head === null)) return [];
		out.push({ path, base, head });
	}
	return out;
}

/** Captures the range's textual Git hunks once, at `start`; failure is fail-open. */
function captureDiffHunks(range: string): DiffHunk[] {
	try {
		const out = execFileSync(
			"git",
			[
				"diff",
				"--no-ext-diff",
				"--no-renames",
				"--no-color",
				"--unified=0",
				range,
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
		return parseDiffHunks(out);
	} catch {
		return [];
	}
}

/**
 * Builds the source-fidelity corpus for R22: every in-range commit body joined
 * with the range's net diff text. R22 (근거 소스 대조) asks that each 근거 quote be a
 * normalized substring of THIS — so a paraphrase or a PR-body sentence that
 * appears nowhere in the real source cannot pose as a verbatim ground. Captured
 * fresh at the `code` submit (not stored at `start`) because it is only read
 * once. Failure is fail-open (empty string): a git error must not read as "every
 * quote is fabricated", matching captureDiffHunks / enumerateCommits.
 */
function captureSourceCorpus(range: string, hashes: string[]): string {
	const parts: string[] = [];
	for (const h of hashes) {
		try {
			parts.push(
				execFileSync("git", ["show", "-s", "--format=%B", h], {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				}),
			);
		} catch {
			// A single unreachable hash drops out; the rest of the corpus stands.
		}
	}
	try {
		parts.push(
			execFileSync("git", ["diff", "--no-ext-diff", "--no-color", range], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}),
		);
	} catch {
		// No diff text — commit bodies alone still ground most quotes.
	}
	return parts.join("\n");
}

/**
 * Enumerates the commits of `range`, oldest first, at the only moment the CLI
 * is guaranteed to run inside the repo. `A...B` is normalized to `A..B`: the
 * diff convention (merge-base diff) and the commit-list convention (commits on
 * the branch side) name the same intent with different dot counts. Failure is
 * an empty list, not an error — R10 then degrades to section presence.
 */
function enumerateCommits(range: string): string[] {
	try {
		// 머지 커밋 제외: 머지의 첫 부모 대비 diff는 범위 전체와 같아 서사가 없다 —
		// 머지 헤딩을 강요하면 실커밋 1개짜리 PR에서 waiver가 영영 열리지 않는다.
		const out = execFileSync("git", ["rev-list", "--reverse", "--no-merges", range.replace("...", "..")], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

function start(sessionId: string, range: string, slug: string): void {
	const ts = nowStamp();
	const commitHashes = enumerateCommits(range);
	const seed: Persisted = {
		active: true,
		step: "evidence",
		capability_step_migration_version: CAPABILITY_STEP_MIGRATION_VERSION,
		passed: [],
		structural_ok: [],
		render_proof_contract_version: CURRENT_RENDER_PROOF_CONTRACT_VERSION,
		render_proof: null,
		concepts: [],
		bank: [],
		commit_hashes: commitHashes,
		diff_hunks: captureDiffHunks(range),
		source_corpus: captureSourceCorpus(range, commitHashes),
		awaiting_answer: false,
		no_progress: { key: "", count: 0, doc_digest: "" },
		last_failure: null,
		range,
		slug,
		started_at: ts,
		last_touched_at: ts,
		derived: {
			artifact_write_allowed: false,
			quiz_passed: false,
			stop_allowed: false,
			no_progress_tripped: false,
			block_reason: "",
		},
	};
	withLock(statePath(sessionId), () => write(sessionId, seed));
}

/** Reads a verification report and demands its machine-checkable closing line. */
function checkReport(
	label: string,
	flag: string,
	reportPath: string | undefined,
	marker: RegExp,
	markerName: string,
	failedItems: string[],
): void {
	if (!reportPath) {
		failedItems.push(`${label} 리포트 경로(${flag})가 없습니다.`);
		return;
	}
	let text: string;
	try {
		text = readFileSync(reportPath, "utf8");
	} catch {
		failedItems.push(`${label} 리포트를 찾을 수 없습니다: ${reportPath}`);
		return;
	}
	const closingLine = text.trimEnd().split(/\r?\n/).at(-1) ?? "";
	if (!marker.test(closingLine)) {
		failedItems.push(`${label} 리포트에 \`${markerName}\` 줄이 없습니다: ${reportPath}`);
	}
}

interface ChecklistAxisRow {
	number: number;
	axis: string;
	status: string;
	evidence: string;
}

const CHECKLIST_AXIS_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Reads the four-column Markdown table used by the final nine-axis checklist. */
function parseChecklistAxisRows(text: string): ChecklistAxisRow[] {
	const rows: ChecklistAxisRow[] = [];
	for (const line of text.split(/\r?\n/)) {
		const cells = line.trim().split("|");
		if (cells[0] === "") cells.shift();
		if (cells.at(-1) === "") cells.pop();
		if (cells.length !== 4) continue;

		const numberText = cells[0]?.trim() ?? "";
		if (!/^\d+$/.test(numberText)) continue;
		const number = Number(numberText);
		if (!Number.isSafeInteger(number)) continue;
		rows.push({
			number,
			axis: cells[1]?.trim() ?? "",
			status: cells[2]?.trim() ?? "",
			evidence: cells[3]?.trim() ?? "",
		});
	}
	return rows;
}

/** A final all-pass marker is valid only with one grounded verdict for each axis. */
function checkChecklistReport(checklistPath: string | undefined, failedItems: string[]): void {
	checkReport(
		"체크리스트",
		"--checklist",
		checklistPath,
		/^CHECKLIST:\s*ALL PASS$/,
		"CHECKLIST: ALL PASS",
		failedItems,
	);
	if (!checklistPath) return;

	let text: string;
	try {
		text = readFileSync(checklistPath, "utf8");
	} catch {
		return;
	}

	const rows = parseChecklistAxisRows(text);
	if (rows.length === 0) {
		failedItems.push(`체크리스트에 10개 축 행이 없습니다: ${checklistPath}`);
		return;
	}

	const seen = new Set<number>();
	for (const row of rows) {
		if (!CHECKLIST_AXIS_NUMBERS.some((axisNumber) => axisNumber === row.number)) {
			failedItems.push(`체크리스트의 축 번호가 1~10 범위를 벗어났습니다: ${row.number}`);
			continue;
		}
		if (seen.has(row.number)) {
			failedItems.push(`체크리스트에 축 ${row.number}가 중복됩니다: ${checklistPath}`);
			continue;
		}
		seen.add(row.number);

		if (row.axis.length === 0) {
			failedItems.push(`체크리스트의 축 ${row.number} 이름이 비어 있습니다: ${checklistPath}`);
		}
		if (row.status !== "PASS" && row.status !== "N.A") {
			failedItems.push(`체크리스트 축 ${row.number}의 상태가 허용되지 않습니다: ${row.status || "(빈 상태)"}`);
			continue;
		}
		if (row.number === 10 && row.status === "N.A") {
			failedItems.push("체크리스트 축 10은 N.A일 수 없습니다");
		}
		if (row.evidence.length === 0) {
			failedItems.push(`체크리스트 축 ${row.number}의 근거가 비어 있습니다: ${checklistPath}`);
		}
	}

	const missing = CHECKLIST_AXIS_NUMBERS.filter((number) => !seen.has(number));
	if (missing.length > 0) {
		failedItems.push(`체크리스트의 축이 누락되었습니다: ${missing.join(", ")}`);
	}
}

const BASIC_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: "\u00a0" };

/** Decodes the five basic named entities, `&nbsp;` and numeric entities in one pass (no double decoding). */
function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|nbsp);/gi, (whole, body: string) => {
		if (body[0] !== "#") return BASIC_ENTITIES[body.toLowerCase()] ?? whole;
		const code = body[1]?.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
		return Number.isSafeInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	});
}

/** Tag-stripped, entity-decoded text of an HTML fragment. */
function htmlText(fragment: string): string {
	return decodeHtmlEntities(fragment.replace(/<[^>]*>/g, ""));
}

function collapseSpace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** Bodies of the document's fenced code blocks (empty fences skipped), fence indentation removed. */
function documentCodeBodies(doc: string): string[] {
	const lines = doc.split(/\r\n?|\n/);
	const bodies: string[] = [];
	for (const block of findMarkdownBlocks(doc)) {
		if (block.kind !== "code" || !block.fenced) continue;
		const indent = /^[ \t]*/.exec(lines[block.start] ?? "")?.[0].length ?? 0;
		const bodyLines = lines
			.slice(block.start + 1, block.closed ? block.end : block.end + 1)
			.map((line) => line.slice(Math.min(indent, /^[ \t]*/.exec(line)?.[0].length ?? 0)));
		const body = bodyLines.join("\n");
		if (body.trim() !== "") bodies.push(body);
	}
	return bodies;
}

/**
 * The one text normal form both sides of the prose check are compared in: tags dropped,
 * entities decoded, no-break space read as a space, zero-width characters removed,
 * whitespace runs collapsed to one space.
 */
function normalizeProse(htmlFragment: string): string {
	return collapseSpace(htmlText(htmlFragment).replace(/\u00a0/g, " ").replace(/[\u200b\u2060\ufeff]/g, ""));
}

/**
 * The document's text blocks a page must carry verbatim, each in {@link normalizeProse} form:
 * paragraphs, list items' own text, table cells and the text of raw HTML component blocks
 * (callout, compare, cf, gloss, …). Headings, fenced code, diagram figures, HTML comments
 * and front matter are skipped — other checks cover them.
 */
function documentTextUnits(doc: string): string[] {
	const stripped = doc
		.replace(/\r\n?/g, "\n")
		.replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, "")
		.replace(new RegExp(`^ {0,3}${DIAGRAM_FIGURE_PATTERN}`, "gim"), "\n");
	const units: string[] = [];
	const add = (htmlFragment: string): void => {
		const text = normalizeProse(htmlFragment);
		if (text !== "") units.push(text);
	};
	const inline = (tokens: Token[] | undefined, fallback: string): string => (tokens ? Parser.parseInline(tokens) : fallback);
	const walk = (tokens: Token[]): void => {
		for (const token of tokens) {
			switch (token.type) {
				case "paragraph":
				case "text":
					add(inline(token.tokens, token.raw));
					break;
				case "list":
					for (const item of token.items ?? []) walk(item.tokens ?? []);
					break;
				case "blockquote":
					walk(token.tokens ?? []);
					break;
				case "table": {
					const cells: Array<{ tokens?: Token[]; text: string }> = [...(token.header ?? []), ...(token.rows ?? []).flat()];
					for (const cell of cells) add(inline(cell.tokens, cell.text));
					break;
				}
				case "html":
					// Each text node of the block is its own unit, so tags between nodes cannot glue words together.
					for (const node of token.raw.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/<[^>]*>/)) add(node);
					break;
				default:
					break;
			}
		}
	};
	walk(Lexer.lex(stripped));
	return units;
}

const trimOneTrailingNewline = (text: string): string => text.replace(/\r\n/g, "\n").replace(/\n$/, "");

export interface HtmlSubmissionInput {
	htmlPath: string | undefined;
	docPath: string;
	receiptPath: string | undefined;
	lintSource: string | undefined;
	writingReport: string | undefined;
	checklistPath: string | undefined;
	commitHashes: string[];
	diffHunks: DiffHunk[];
}

/**
 * render is authored by the model (html-report) and proven here: the Markdown
 * document stays the content SSOT, and the submitted page must carry its exact
 * facts — every diagram's SVG byte-identical and in order, every fenced code block
 * verbatim in a `<pre>`, every commit hash and changed path, every `##`/`###`
 * heading in order, every text block (paragraph, list item, table cell, component text) verbatim, a style rule for each reference class the document uses, and no
 * `<foreignObject>`. A receipt proves only a clean strict lint of these exact HTML
 * bytes in the three lint runs (1280 light, 1280 dark, 400 light); it does not prove anyone looked at the page. The
 * technical-writing report and final checklist close with their machine-checkable lines.
 */
export function checkHtmlSubmission(input: HtmlSubmissionInput): { pass: boolean; failedItems: string[] } {
	const failedItems: string[] = [];
	const { htmlPath, docPath, receiptPath, lintSource } = input;
	if (!htmlPath) return { pass: false, failedItems: ["render 산출물 경로(--html)가 없습니다."] };
	if (!receiptPath) return { pass: false, failedItems: ["lint 영수증 경로(--receipt)가 없습니다 — html-report lint.sh 를 --receipt 로 실행하세요."] };
	if (!lintSource) return { pass: false, failedItems: ["lint 원천 폴더 경로(--lint-source)가 없습니다 — lint.sh 의 --source 와 같은 증거 폴더를 주세요."] };

	// a. the page exists, has a body, and is not older than the document
	let html: string;
	let doc: string;
	try {
		if (statSync(htmlPath).size === 0) return { pass: false, failedItems: [`render 산출물이 비어 있습니다: ${htmlPath}`] };
		html = readFileSync(htmlPath, "utf8");
	} catch {
		return { pass: false, failedItems: [`render 산출물을 찾을 수 없습니다: ${htmlPath}`] };
	}
	try {
		doc = readFileSync(docPath, "utf8");
	} catch {
		return { pass: false, failedItems: [`문서를 읽을 수 없습니다: ${docPath}`] };
	}
	const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(html)?.[1] ?? "";
	if (!/<html\b/i.test(html) || htmlText(body.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")).trim() === "") {
		return { pass: false, failedItems: [`HTML 에 <html> 또는 내용이 있는 <body> 가 없습니다: ${htmlPath}`] };
	}
	if (statSync(htmlPath).mtimeMs < statSync(docPath).mtimeMs) {
		failedItems.push(
			`HTML 이 문서보다 오래됐습니다 — 문서를 고친 뒤 HTML 을 다시 쓰고(최신 문서 기준), capture·lint 를 다시 돌려 제출하세요: ${htmlPath}`,
		);
	}

	// b. clean strict lint receipt for exactly these bytes
	try {
		statSync(lintSource);
	} catch {
		failedItems.push(`lint 원천 폴더를 찾을 수 없습니다: ${lintSource}`);
	}
	const receiptProblem = lintReceiptProblem(receiptPath, htmlPath, lintSource);
	if (receiptProblem !== null) failedItems.push(`lint 영수증이 유효하지 않습니다 — ${receiptProblem}`);

	// c. every diagram SVG, byte-identical and in document order
	let cursor = 0;
	diagramFigures(doc).forEach((figure, i) => {
		if (figure.svg === null) return;
		const at = html.indexOf(figure.svg, cursor);
		if (at >= 0) {
			cursor = at + figure.svg.length;
		} else if (html.includes(figure.svg)) {
			failedItems.push(`다이어그램 ${i + 1}번째 SVG 가 문서의 순서와 다른 위치에 있습니다 — 문서 순서대로 놓으세요.`);
		} else {
			failedItems.push(
				`다이어그램 ${i + 1}번째 SVG 가 HTML 에 문서와 바이트 단위로 같게 들어 있지 않습니다 — 문서의 <svg>…</svg> 를 한 글자도 바꾸지 말고 그대로 붙여 넣으세요.`,
			);
		}
	});

	// Markup a reader sees: <style>/<script> bodies and comments (which may mention "<pre>") dropped.
	const visible = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");

	// d. every fenced code block verbatim as the text of some <pre>
	const preTexts = [...visible.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi)].flatMap((m) => {
		const text = trimOneTrailingNewline(htmlText(m[1] ?? ""));
		return [text, text.replace(/^\n/, "")];
	});
	documentCodeBodies(doc).forEach((code, i) => {
		if (!preTexts.includes(trimOneTrailingNewline(code))) {
			failedItems.push(
				`문서의 ${i + 1}번째 코드 블록("${code.trim().split("\n")[0]?.slice(0, 40) ?? ""}…")이 HTML 의 어떤 <pre> 텍스트와도 같지 않습니다 — 코드는 글자 그대로 <pre> 안에 넣으세요(구문 강조 <span> 은 가능).`,
			);
		}
	});

	// e. commit hashes (7-char short form, as R10 compares) and changed paths in the page text
	const pageText = htmlText(visible);
	const missingHashes = input.commitHashes.map((h) => h.slice(0, 7)).filter((h) => !pageText.includes(h));
	if (missingHashes.length > 0) failedItems.push(`HTML 에 없는 커밋 해시: ${missingHashes.join(", ")}`);
	const missingPaths = [...new Set(input.diffHunks.map((h) => h.path))].filter((p) => !pageText.includes(p));
	if (missingPaths.length > 0) failedItems.push(`HTML 에 없는 변경 파일 경로: ${missingPaths.join(", ")}`);

	// f. document headings as an ordered subsequence of the page's h2/h3 texts
	const pageHeadings = [...visible.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)].map((m) => collapseSpace(htmlText(m[2] ?? "")));
	let headingCursor = 0;
	for (const heading of documentHeadings(doc)) {
		const wanted = collapseSpace(decodeHtmlEntities(heading));
		const at = pageHeadings.indexOf(wanted, headingCursor);
		if (at < 0) {
			failedItems.push(
				pageHeadings.includes(wanted)
					? `문서 헤딩 "${wanted}" 이 문서의 순서와 다른 위치에 있습니다.`
					: `문서 헤딩 "${wanted}" 이 HTML 의 <h2>/<h3> 텍스트에 없습니다 — 문서의 ##/### 헤딩을 같은 글자로 같은 순서로 두세요.`,
			);
			continue;
		}
		headingCursor = at + 1;
	}

	// f2. every text block of the document verbatim somewhere in the page's visible text
	const pageProse = normalizeProse(/<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(visible)?.[1] ?? "");
	const missingUnits = documentTextUnits(doc).filter((unit) => !pageProse.includes(unit));
	if (missingUnits.length > 0) {
		const shown = missingUnits.slice(0, 5).map((u) => `"${u.length > 60 ? `${u.slice(0, 60)}…` : u}"`);
		failedItems.push(
			`문서 본문 텍스트 ${missingUnits.length}개가 HTML 에 글자 그대로 없습니다: ${shown.join(", ")}${missingUnits.length > shown.length ? " …" : ""} — 문단·목록 항목·표 셀·컴포넌트(callout 등)의 텍스트를 문서와 같은 글자로 모두 싣고, 배치·꾸밈만 자유롭게 하세요.`,
		);
	}

	// g. labels are SVG <text>; a fixed-width <foreignObject> box clips when the viewer font is wider
	const foreignObjects = (html.match(/<foreignObject/gi) ?? []).length;
	if (foreignObjects > 0) {
		failedItems.push(
			`HTML 에 <foreignObject> 가 ${foreignObjects}개 있습니다 — 뷰어 폰트가 넓으면 고정폭 박스가 글자를 잘라 숨깁니다. 라벨은 <text>/<tspan> 으로 그리세요.`,
		);
	}

	// h. a style rule for every reference class the document uses
	const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1] ?? "").join("\n");
	const unstyled = usedStyleClasses(doc).filter((cls) => !new RegExp(`\\.${cls}(?![\\w-])`).test(css));
	if (unstyled.length > 0) {
		failedItems.push(
			`문서가 쓰는 class 의 스타일 규칙이 <style> 에 없습니다: ${unstyled.join(", ")} — 기준 스타일시트(skills/explain-diff/references/components.css, skills/html-report/references/diagram-classes.css)에서 가져오세요.`,
		);
	}

	// i. review reports
	checkReport(
		"technical-writing",
		"--writing-report",
		input.writingReport,
		/^REVIEW:\s*APPLIED\s*$/,
		"REVIEW: APPLIED",
		failedItems,
	);
	checkChecklistReport(input.checklistPath, failedItems);
	return { pass: failedItems.length === 0, failedItems };
}

/** The `render` step's evidence paths; all are required, a missing one fails the submission. */
export interface RenderSubmission {
	htmlPath?: string;
	receiptPath?: string;
	lintSource?: string;
	writingReport?: string;
	checklistPath?: string;
}

/**
 * Runs the script-decidable rubric items against the section just authored.
 * A failure is recorded, not just reported: `last_failure` is what the artifact
 * guard's deny message quotes back, so the author reads the same sentence the
 * gate acted on.
 */
function submitStep(
	sessionId: string,
	step: Step,
	docPath: string,
	signalFiles: string[],
	addedFiles: string[],
	render: RenderSubmission = {},
): number {
	return withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		if (s.step !== step) {
			throw new Error(`현재 스텝은 ${s.step} 입니다. ${step} 을 제출할 수 없습니다.`);
		}
		const result =
			step === "render"
					? checkHtmlSubmission({
							htmlPath: render.htmlPath,
							docPath,
							receiptPath: render.receiptPath,
							lintSource: render.lintSource,
							writingReport: render.writingReport,
							checklistPath: render.checklistPath,
							commitHashes: s.commit_hashes,
							diffHunks: s.diff_hunks,
						})
					: checkStructure(readFileSync(docPath, "utf8"), {
						signalFiles,
						addedFiles,
						commitHashes: s.commit_hashes,
						diffHunks: s.diff_hunks,
						sourceCorpus: step === "code" ? s.source_corpus : undefined,
						step,
					});
		if (!result.pass) {
			s.last_failure = { step, items: result.failedItems };
			s.structural_ok = s.structural_ok.filter((x) => x !== step);
			if (step === "render") s.render_proof = null;
			write(sessionId, s);
			process.stderr.write(`${result.failedItems.join("\n")}\n`);
			return 1;
		}
		s.last_failure = null;
		if (step === "render") {
			const docSha = sha256File(docPath);
			const htmlSha = render.htmlPath === undefined ? null : sha256File(render.htmlPath);
			if (
				docSha === null ||
				htmlSha === null ||
				render.htmlPath === undefined ||
				render.receiptPath === undefined ||
				render.lintSource === undefined ||
				render.writingReport === undefined ||
				render.checklistPath === undefined
			) {
				throw new Error("render 제출이 성공했지만 증거 경로가 없습니다.");
			}
			s.render_proof_contract_version = CURRENT_RENDER_PROOF_CONTRACT_VERSION;
			s.render_proof = {
				doc_path: docPath,
				doc_sha256: docSha,
				html_path: render.htmlPath,
				html_sha256: htmlSha,
				lint_receipt_path: render.receiptPath,
				lint_source_path: render.lintSource,
				writing_report_path: render.writingReport,
				checklist_path: render.checklistPath,
			};
		}
		if (!s.structural_ok.includes(step)) s.structural_ok.push(step);
		write(sessionId, s);
		return 0;
	});
}

interface JudgeItem {
	id: string;
	pass: boolean;
	quote?: string;
}

/**
 * Records the judge's verdict and advances the step.
 *
 * Two refusals matter here. A judge that passes an existence item without a
 * quote is refused, and a quote that is not a literal substring of the document
 * is refused — an unverifiable citation is how a review-shaped gate turns into a
 * rubber stamp, and both checks are cheap enough to run every time.
 */
function passStep(sessionId: string, step: Step, docPath: string, judge: JudgeItem[]): number {
	return withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		if (s.step !== step) throw new Error(`현재 스텝은 ${s.step} 입니다.`);
		if (!s.structural_ok.includes(step)) {
			throw new Error(`${step} 구조 검사를 먼저 통과시키세요 (\`submit-step\`).`);
		}
		let text = "";
		const bad: string[] = [];
		if (step === "render") {
			const proof = s.render_proof;
			if (proof === null) {
				throw new Error("render 증거 바인딩이 없습니다. 다시 submit-step 하세요.");
			}
			if (docPath !== proof.doc_path) {
				bad.push(`render pass-step의 docPath가 제출 시 저장한 경로와 다릅니다: ${docPath}`);
			}
			const renderResult = checkHtmlSubmission({
				htmlPath: proof.html_path,
				docPath: proof.doc_path,
				receiptPath: proof.lint_receipt_path,
				lintSource: proof.lint_source_path,
				writingReport: proof.writing_report_path,
				checklistPath: proof.checklist_path,
				commitHashes: s.commit_hashes,
				diffHunks: s.diff_hunks,
			});
			bad.push(...renderResult.failedItems);
			if (sha256File(proof.doc_path) !== proof.doc_sha256) {
				bad.push(`제출 뒤 문서가 바뀌었습니다 — HTML 을 문서에 맞추고 capture·lint 를 거쳐 다시 제출하세요: ${proof.doc_path}`);
			}
			if (sha256File(proof.html_path) !== proof.html_sha256) {
				bad.push(`제출 뒤 HTML 이 바뀌었습니다 — lint 를 다시 돌려 다시 제출하세요: ${proof.html_path}`);
			}
			try {
				text = readFileSync(proof.doc_path, "utf8");
			} catch {
				// checkHtmlSubmission already records the missing/unreadable document.
			}
		} else {
			text = readFileSync(docPath, "utf8");
		}
		// A required id missing from the payload entirely is refused before the
		// per-item loop runs — an empty (or off-topic) judge array must not
		// vacuously satisfy a step whose rubric depends on the judge's review.
		const presentIds = new Set(judge.map((item) => item.id));
		for (const id of REQUIRED_JUDGE_IDS[step]) {
			if (!presentIds.has(id)) bad.push(`${id}: 심사 판정이 없습니다`);
		}
		for (const item of judge) {
			if (!item.pass) {
				bad.push(`${item.id}: 심사 실패`);
				continue;
			}
			if (!item.quote) {
				bad.push(`${item.id}: pass 인데 인용이 없습니다 — 인용 없는 통과는 자동 실패입니다.`);
				continue;
			}
			if (!text.includes(item.quote)) {
				bad.push(`${item.id}: 인용이 문서에 문자열로 존재하지 않습니다 — "${item.quote}"`);
			}
		}
		if (bad.length > 0) {
			s.last_failure = { step, items: bad };
			write(sessionId, s);
			process.stderr.write(`${bad.join("\n")}\n`);
			return 1;
		}
		s.last_failure = null;
		if (!s.passed.includes(step)) s.passed.push(step);
		const nxt = nextStep(step);
		if (nxt) s.step = nxt;
		write(sessionId, s);
		return 0;
	});
}

function addConcept(sessionId: string, id: string, required: boolean): void {
	withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		if (!s.concepts.some((c) => c.id === id)) s.concepts.push({ id, required, passed: false });
		write(sessionId, s);
	});
}

/** Marks a question outstanding. The Stop gate reads this and permits the wait. */
function ask(sessionId: string): void {
	withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		s.awaiting_answer = true;
		write(sessionId, s);
	});
}

/**
 * Records one graded answer.
 *
 * The no-progress counter advances only when the SAME rubric item fails again on
 * an UNCHANGED document. Either a different missing item or an edited document
 * resets it, so the escalation fires on a genuinely stuck loop rather than on a
 * reader who is simply taking more than one attempt.
 */
function grade(sessionId: string, concept: string, missing: string[], docDigest: string): void {
	withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		// No pending question means no reader answer exists to grade — reject before
		// any mutation so a grade attempted without `ask` leaves the state untouched,
		// not just leaves `passed` false.
		if (s.awaiting_answer !== true) {
			throw new Error(
				"채점할 수 없습니다: 먼저 `ask` 로 문항을 내고 독자의 답을 받아야 합니다.",
			);
		}
		s.awaiting_answer = false;
		const c = s.concepts.find((x) => x.id === concept);
		if (!c) throw new Error(`알 수 없는 개념: ${concept}`);
		if (missing.length === 0) {
			c.passed = true;
			s.no_progress = { key: "", count: 0, doc_digest: docDigest };
		} else {
			const key = `${concept}:${missing.slice().sort().join("|")}`;
			s.no_progress =
				s.no_progress.key === key && s.no_progress.doc_digest === docDigest
					? { key, count: s.no_progress.count + 1, doc_digest: docDigest }
					: { key, count: 1, doc_digest: docDigest };
			if (computeDerived({ ...s, no_progress: s.no_progress }).no_progress_tripped) s.stalled = true;
		}
		write(sessionId, s);
	});
}

function complete(sessionId: string): number {
	return withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		const d = computeDerived(s);
		if (!d.quiz_passed) {
			process.stderr.write(
				"완료할 수 없습니다: 필수 개념이 전부 통과되지 않았습니다. 남은 개념의 문항을 계속 진행하세요.\n",
			);
			return 1;
		}
		s.active = false;
		write(sessionId, s);
		return 0;
	});
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | string[] | boolean> {
	const out: Record<string, string | string[] | boolean> = {};
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === undefined || !a.startsWith("--")) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith("--")) {
			out[key] = true;
			continue;
		}
		const prior = out[key];
		if (prior === undefined) out[key] = next;
		else if (Array.isArray(prior)) prior.push(next);
		else out[key] = [String(prior), next];
		i += 1;
	}
	return out;
}

function req(args: Record<string, string | string[] | boolean>, name: string): string {
	const v = args[name];
	if (typeof v !== "string" || v.length === 0) throw new Error(`--${name} 은 필수입니다.`);
	return v;
}

/** Validates the step name against the known set instead of asserting it. */
function reqStep(args: Record<string, string | string[] | boolean>, name: string): Step {
	const raw = req(args, name);
	const found = STEP_ORDER.find((s) => s === raw);
	if (!found) throw new Error(`알 수 없는 스텝: ${raw} (가능: ${STEP_ORDER.join(", ")})`);
	return found;
}

/**
 * Parses the judge's verdict array. A malformed payload is rejected here rather
 * than trusted into the gate — this is the one input a subagent controls.
 */
function parseJudge(raw: string): JudgeItem[] {
	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed)) throw new Error("--judge-json 은 JSON 배열이어야 합니다.");
	return parsed.map((entry, i) => {
		if (entry === null || typeof entry !== "object") {
			throw new Error(`--judge-json[${i}] 이 객체가 아닙니다.`);
		}
		const rec: Record<string, unknown> = {};
		Object.assign(rec, entry);
		const id = rec["id"];
		if (typeof id !== "string") throw new Error(`--judge-json[${i}].id 가 없습니다.`);
		const quote = rec["quote"];
		return { id, pass: rec["pass"] === true, quote: typeof quote === "string" ? quote : undefined };
	});
}

function csv(raw: string): string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function list(args: Record<string, string | string[] | boolean>, name: string): string[] {
	const v = args[name];
	if (v === undefined || typeof v === "boolean") return [];
	return Array.isArray(v) ? v : [v];
}

/**
 * Single source of truth for this CLI's command roster: every subcommand `main()`
 * dispatches, tagged with who may run it. `help` prints this via renderHelp() so the
 * AI can see, before acting, which commands it may run itself. Every command here is
 * ai-authority — no user/system/hook path exists for this CLI.
 */
const ROSTER: CliCommand[] = [
	{ name: "start", authority: "ai", effect: "starts a new explain-diff reading session" },
	{ name: "get", authority: "ai", effect: "reads the full session state" },
	{ name: "submit-step", authority: "ai", effect: "submits a step's produced document" },
	{ name: "pass-step", authority: "ai", effect: "records a step's judge verdict" },
	{ name: "add-concept", authority: "ai", effect: "registers one concept for the quiz" },
	{ name: "ask", authority: "ai", effect: "asks the next quiz question" },
	{ name: "grade", authority: "ai", effect: "grades a quiz answer for one concept" },
	{ name: "complete", authority: "ai", effect: "completes the reading session" },
];

function main(): void {
	const sub = process.argv[2];
	const args = parseArgs(process.argv.slice(3));
	// help is a discovery command — it must print without a session id or seeded
	// state, so it runs BEFORE resolveSessionIdOrThrow (every other subcommand's
	// precondition is unchanged).
	if (sub === "help") {
		process.stdout.write(renderHelp("explain-diff-state", ROSTER));
		return;
	}
	try {
		const sessionId = resolveSessionIdOrThrow();
		switch (sub) {
			case "start":
				start(sessionId, req(args, "range"), req(args, "slug"));
				break;
			case "get":
				process.stdout.write(`${JSON.stringify(read(sessionId))}\n`);
				break;
			case "submit-step":
				process.exit(
					submitStep(
						sessionId,
						reqStep(args, "step"),
						req(args, "doc"),
						csv(req(args, "signal-files")),
							csv(typeof args["added-files"] === "string" ? args["added-files"] : ""),
							{
								htmlPath: typeof args["html"] === "string" ? args["html"] : undefined,
								receiptPath: typeof args["receipt"] === "string" ? args["receipt"] : undefined,
								lintSource: typeof args["lint-source"] === "string" ? args["lint-source"] : undefined,
								writingReport: typeof args["writing-report"] === "string" ? args["writing-report"] : undefined,
								checklistPath: typeof args["checklist"] === "string" ? args["checklist"] : undefined,
							},
						),
				);
				break;
			case "pass-step":
				process.exit(
					passStep(
						sessionId,
						reqStep(args, "step"),
						req(args, "doc"),
						parseJudge(req(args, "judge-json")),
					),
				);
				break;
			case "add-concept":
				addConcept(sessionId, req(args, "id"), args["required"] === true);
				break;
			case "ask":
				ask(sessionId);
				break;
			case "grade":
				grade(sessionId, req(args, "concept"), list(args, "missing"), req(args, "doc-digest"));
				break;
			case "complete":
				process.exit(complete(sessionId));
				break;
			default:
				process.stderr.write(
					`Usage: explain-diff-state.ts <help|${ROSTER.map((c) => c.name).join("|")}> [options]\n` +
						`Steps: ${STEP_ORDER.join(" -> ")}\n`,
				);
				process.exit(1);
		}
	} catch (e) {
		process.stderr.write(`explain-diff-state: ${String(e)}\n`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}

export { start, submitStep, passStep, addConcept, ask, grade, complete, read, statePath };
