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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { getOmtDir } from "@lib/omt-dir";
import { nowStamp, resolveSessionIdOrThrow, STATE_PREFIX } from "@lib/state-core";
import {
	computeDerived,
	nextStep,
	normalizeExplainDiffState,
	REQUIRED_JUDGE_IDS,
	STEP_ORDER,
	type ExplainDiffState,
	type Step,
} from "@lib/explain-diff-core";
import { checkStructure, type DiffHunk, type DiffLineRange } from "@lib/explain-diff-structure";

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
	started_at: string;
	last_touched_at: string;
	derived: ReturnType<typeof computeDerived>;
}

interface RenderProofBinding {
	doc_path: string;
	html_path: string;
	writing_report_path: string;
	checklist_path: string;
}

const CURRENT_RENDER_PROOF_CONTRACT_VERSION = 1;
const renderedDocumentCache = new Map<string, string>();
type FreshRenderer = (docPath: string) => string;

function statePath(sessionId: string): string {
	return `${getOmtDir()}/${STATE_PREFIX["explain-diff"]}${sessionId}.json`;
}

function normalizeRenderProofBinding(raw: unknown): RenderProofBinding | null {
	if (raw === null || typeof raw !== "object") return null;
	const record: Record<string, unknown> = {};
	Object.assign(record, raw);
	const docPath = record["doc_path"];
	const htmlPath = record["html_path"];
	const writingReportPath = record["writing_report_path"];
	const checklistPath = record["checklist_path"];
	if (
		typeof docPath !== "string" ||
		docPath.length === 0 ||
		typeof htmlPath !== "string" ||
		htmlPath.length === 0 ||
		typeof writingReportPath !== "string" ||
		writingReportPath.length === 0 ||
		typeof checklistPath !== "string" ||
		checklistPath.length === 0
	)
		return null;
	return {
		doc_path: docPath,
		html_path: htmlPath,
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
		const structuralRaw = r["structural_ok"];
		const renderProof = normalizeRenderProofBinding(r["render_proof"]);
		const hasCurrentRenderProofContract =
			r["render_proof_contract_version"] === CURRENT_RENDER_PROOF_CONTRACT_VERSION &&
			renderProof !== null;
		const state: Persisted = {
			...base,
			structural_ok: Array.isArray(structuralRaw)
				? structuralRaw.flatMap((x) => STEP_ORDER.find((s) => s === x) ?? [])
				: [],
			render_proof_contract_version: CURRENT_RENDER_PROOF_CONTRACT_VERSION,
			render_proof: renderProof,
			diff_hunks: normalizeStoredDiffHunks(r["diff_hunks"]),
			range: typeof r["range"] === "string" ? r["range"] : "",
			slug: typeof r["slug"] === "string" ? r["slug"] : "",
			started_at: typeof r["started_at"] === "string" ? r["started_at"] : nowStamp(),
			last_touched_at:
				typeof r["last_touched_at"] === "string" ? r["last_touched_at"] : nowStamp(),
			// Recomputed on every write; the persisted copy is never trusted on read.
			derived: computeDerived(base),
		};
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
				items: ["기존 render 증거가 현재 체크리스트 계약으로 검증되지 않았습니다."],
			};
		}
		state.derived = computeDerived(state);
		return { state, needsRenderProofMigration };
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
	if (!snapshot || !snapshot.needsRenderProofMigration) return snapshot?.state ?? null;
	return withLock(statePath(sessionId), () => {
		const latest = readSnapshot(sessionId);
		if (!latest) return null;
		if (latest.needsRenderProofMigration) write(sessionId, latest.state);
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
	if (snapshot.needsRenderProofMigration) write(sessionId, snapshot.state);
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
	const seed: Persisted = {
		active: true,
		step: "evidence",
		passed: [],
		structural_ok: [],
		render_proof_contract_version: CURRENT_RENDER_PROOF_CONTRACT_VERSION,
		render_proof: null,
		concepts: [],
		bank: [],
		commit_hashes: enumerateCommits(range),
		diff_hunks: captureDiffHunks(range),
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

const CHECKLIST_AXIS_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

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
		failedItems.push(`체크리스트에 9개 축 행이 없습니다: ${checklistPath}`);
		return;
	}

	const seen = new Set<number>();
	for (const row of rows) {
		if (!CHECKLIST_AXIS_NUMBERS.some((axisNumber) => axisNumber === row.number)) {
			failedItems.push(`체크리스트의 축 번호가 1~9 범위를 벗어났습니다: ${row.number}`);
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
		if (row.evidence.length === 0) {
			failedItems.push(`체크리스트 축 ${row.number}의 근거가 비어 있습니다: ${checklistPath}`);
		}
	}

	const missing = CHECKLIST_AXIS_NUMBERS.filter((number) => !seen.has(number));
	if (missing.length > 0) {
		failedItems.push(`체크리스트의 축이 누락되었습니다: ${missing.join(", ")}`);
	}
}

/**
 * Re-renders the submitted Markdown through the project renderer and returns
 * the exact bytes it produced.  The renderer output is the proof boundary:
 * comparing only Mermaid/SVG counts cannot detect stale prose or component
 * markup, while comparing this deterministic derivation proves the HTML was
 * built from this exact source (including Mermaid source, not just its SVG).
 */
function renderCurrentDocument(docPath: string): string {
	const markdown = readFileSync(docPath, "utf8");
	const cached = renderedDocumentCache.get(markdown);
	if (cached !== undefined) return cached;
	const dir = mkdtempSync(join(tmpdir(), "explain-diff-render-check-"));
	const sourcePath = join(dir, "source.md");
	const outPath = join(dir, "render.html");
	try {
		writeFileSync(sourcePath, markdown, "utf8");
		execFileSync(
			process.execPath,
			[
				fileURLToPath(new URL("./render.ts", import.meta.url)),
				"--in",
				sourcePath,
				"--out",
				outPath,
			],
			{ encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
		);
		const rendered = readFileSync(outPath, "utf8");
		renderedDocumentCache.set(markdown, rendered);
		return rendered;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

let renderFreshDocument: FreshRenderer = renderCurrentDocument;

/** Test seam: production keeps the sibling renderer; tests inject its pure renderer. */
export function setRenderForTesting(renderer?: FreshRenderer): void {
	renderFreshDocument = renderer ?? renderCurrentDocument;
}

/**
 * render is a derivation, not authoring — the markdown structure slots were
 * already earned at `code`, so this checks the artifacts of the derivation:
 * the HTML exists and is not empty, every authored mermaid block actually
 * became an inline SVG, and the technical-writing prose review ran and closed
 * with its machine-checkable verdict line. The final checklist must also close
 * with its machine-checkable all-pass verdict and nine grounded axis rows. Visual layout is not reviewed
 * per document — it is a deterministic property render.ts owns (wide-diagram
 * legibility is sealed by normalizeSvgWidth + the figure scroll container,
 * regression-guarded by render.test.ts), so there is no per-document visual-qa
 * gate here.
 */
function checkRenderOutput(
	htmlPath: string | undefined,
	docPath: string,
	writingReport: string | undefined,
	checklistPath: string | undefined,
): { pass: boolean; failedItems: string[] } {
	const failedItems: string[] = [];
	if (!htmlPath) {
		return { pass: false, failedItems: ["render 산출물 경로(--html)가 없습니다."] };
	}
	let size: number;
	try {
		size = statSync(htmlPath).size;
	} catch {
		return { pass: false, failedItems: [`render 산출물을 찾을 수 없습니다: ${htmlPath}`] };
	}
	if (size === 0) {
		return { pass: false, failedItems: [`render 산출물이 비어 있습니다: ${htmlPath}`] };
	}

	try {
		const actualHtml = readFileSync(htmlPath, "utf8");
		const expectedHtml = renderFreshDocument(docPath);
		if (actualHtml !== expectedHtml) {
			failedItems.push(
				`HTML이 현재 Markdown에서 만들어진 renderer 산출물과 일치하지 않습니다 — 현재 Markdown으로 다시 렌더한 뒤 제출하세요: ${htmlPath}`,
			);
		}
	} catch {
		failedItems.push(`현재 Markdown으로 renderer 산출물을 만들 수 없습니다: ${docPath}`);
	}

	// Diagram parity: N authored mermaid fences must yield at least N inline
	// SVGs, and no fence may survive as literal text — a page with the source
	// where the picture should be is a failed render that still "exists".
	try {
		const md = readFileSync(docPath, "utf8");
		const fences = (md.match(/```mermaid/g) || []).length;
		if (fences > 0) {
			const html = readFileSync(htmlPath, "utf8");
			const svgs = (html.match(/<svg/g) || []).length;
			if (svgs < fences || html.includes("```mermaid") || html.includes("language-mermaid")) {
				failedItems.push(
					`mermaid 블록 ${fences}개 중 인라인 SVG로 렌더된 것이 ${svgs}개입니다 — render.ts가 mmdc 사전 렌더에 실패했는지 확인하세요.`,
				);
			}
		}
	} catch {
		failedItems.push(`문서를 읽을 수 없습니다: ${docPath}`);
	}

	checkReport(
		"technical-writing",
		"--writing-report",
		writingReport,
		/^REVIEW:\s*APPLIED\s*$/,
		"REVIEW: APPLIED",
		failedItems,
	);
	checkChecklistReport(checklistPath, failedItems);
	return { pass: failedItems.length === 0, failedItems };
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
	htmlPath?: string,
	writingReport?: string,
	checklistPath?: string,
): number {
	return withLock(statePath(sessionId), () => {
		const s = mustRead(sessionId);
		if (s.step !== step) {
			throw new Error(`현재 스텝은 ${s.step} 입니다. ${step} 을 제출할 수 없습니다.`);
		}
		const result =
			step === "render"
					? checkRenderOutput(htmlPath, docPath, writingReport, checklistPath)
					: checkStructure(readFileSync(docPath, "utf8"), {
						signalFiles,
						addedFiles,
						commitHashes: s.commit_hashes,
						diffHunks: s.diff_hunks,
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
			if (htmlPath === undefined || writingReport === undefined || checklistPath === undefined) {
				throw new Error("render 제출이 성공했지만 증거 경로가 없습니다.");
			}
			s.render_proof_contract_version = CURRENT_RENDER_PROOF_CONTRACT_VERSION;
			s.render_proof = {
				doc_path: docPath,
				html_path: htmlPath,
				writing_report_path: writingReport,
				checklist_path: checklistPath,
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
			const renderResult = checkRenderOutput(
				proof.html_path,
				proof.doc_path,
				proof.writing_report_path,
				proof.checklist_path,
			);
			bad.push(...renderResult.failedItems);
			try {
				text = readFileSync(proof.doc_path, "utf8");
			} catch {
				// checkRenderOutput already records the missing/unreadable document.
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

function main(): void {
	const sub = process.argv[2];
	const args = parseArgs(process.argv.slice(3));
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
							typeof args["html"] === "string" ? args["html"] : undefined,
							typeof args["writing-report"] === "string" ? args["writing-report"] : undefined,
							typeof args["checklist"] === "string" ? args["checklist"] : undefined,
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
					`Usage: explain-diff-state.ts <start|get|submit-step|pass-step|add-concept|ask|grade|complete> [options]\n` +
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
