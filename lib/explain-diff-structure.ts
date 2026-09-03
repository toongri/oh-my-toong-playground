/**
 * explain-diff structural checks — rubric items R1..R5, R9..R11, R13..R19, R21.
 *
 * These are the half of the rubric a script can decide, and the split is
 * deliberate (see skills/explain-diff/references/rubric.md): absence is
 * countable, so counting it is not left to a model. Every threshold here traces
 * to a measured baseline, not to a guess.
 *
 * The document format these predicates read is a contract, not a preference.
 * Each check looks for a named slot; a section that fills the slots passes, and
 * one that does not names the missing slot back to the author.
 *
 * v5 spine: the code section is organized by COMMIT, and its unit is the CHANGE,
 * not the file. A Change Group (concern) holds commit subsections
 * (`### \`hash\` — title`), each commit holds change blocks (`#### 변경 N: <한 일>`),
 * and each change block separates its fields with the `cf` component — one or
 * more `책임`(responsibility) entries naming the class/function touched, plus
 * 왜/효과/검증 at the change level — and carries one core-logic code fence. The
 * file appears only as a location citation inside the `cf-loc` slot, never as the
 * block heading. R1 coverage therefore checks that every signal file is CITED by
 * some change block's location anchors, R5 that those anchors land in real hunks,
 * and R13 the commit spine + one code fence per change block.
 *
 * The document is written incrementally, one step at a time, so a rubric item
 * only ever has its slot filled once the step that owns it has been reached.
 * `step` scopes evaluation to the items that step's slots can possibly satisfy.
 */

import type { Step } from "@lib/explain-diff-core";

/** A Git hunk's line range: `start` is the first line and `count` its length. */
export interface DiffLineRange {
	start: number;
	count: number;
}

/** One unified-diff hunk; a null side means that side has no file lines. */
export interface DiffHunk {
	path: string;
	base: DiffLineRange | null;
	head: DiffLineRange | null;
}

export interface StructureInput {
	/** Changed files classified as signal — every one must be cited by a change block. */
	signalFiles: string[];
	/**
	 * Signal files the diff ADDED. These have no base location to point at, so
	 * R5 asks them for the head anchor only. Taken from `git diff --name-status`
	 * rather than from a phrase in the document.
	 */
	addedFiles?: string[];
	/** Unified diff hunks used to verify numeric R5 anchors when available. */
	diffHunks?: DiffHunk[];
	/**
	 * Short (or full) hashes of the commits in the explained range, oldest
	 * first, as captured at `start`. Empty means enumeration failed — R10 then
	 * degrades to section presence, and R13's hash-validity check is skipped.
	 */
	commitHashes?: string[];
	/**
	 * Every commit body in the range concatenated with the range's net diff
	 * text, captured from Git at submit time. R22 (근거 소스 대조) checks that each
	 * `근거` quote is a normalized substring of this corpus, so a paraphrase or a
	 * PR-body sentence that never appears in the actual source cannot be dressed
	 * as ground truth. Undefined means the capture failed — R22 then fail-opens,
	 * the same "git failed ≠ everything fake" degradation R13 uses for hashes.
	 */
	sourceCorpus?: string;
	/** Which step's document just closed — decides which items below run. */
	step: Step;
}

export interface CheckItem {
	id:
		| "R1"
		| "R2"
		| "R3"
		| "R4"
		| "R5"
		| "R9"
		| "R10"
		| "R11"
		| "R13"
		| "R14"
		| "R15"
		| "R16"
		| "R17"
		| "R18"
		| "R19"
		| "R21"
		| "R22";
	title: string;
	pass: boolean;
	detail: string;
}

export interface StructureResult {
	pass: boolean;
	items: CheckItem[];
	/** Failed items, pre-rendered for the guard's deny message. */
	failedItems: string[];
}

const GROUP_HEADING = /^##\s+Change Group\s+\d+\s*:\s*\S.*$/gm;
// 변경 블록은 h4 `#### 변경 N: <한 일>` — 파일이 아니라 변경이 단위다.
// (h3 `### `hash` — 제목`은 커밋 서브섹션이고, v4의 `#### `path``도 변경 블록이
// 아니다.) 수평 공백만 소비해 빈 행을 행동 텍스트로 오인하지 않도록 한다.
const CHANGE_BLOCK = /^####[ \t]+(변경[ \t]+\d+[ \t]*:[ \t]*\S[^\r\n]*?)[ \t]*\r?$/gm;
// 커밋 서브섹션: h3 헤딩의 백틱 안 16진 해시.
const COMMIT_SUBSECTION = /^###\s+`([0-9a-fA-F]{6,40})`/gm;

/** The 왜 field, as an HTML paragraph (the cf component authors it). */
const WHY_PARAGRAPH = /<p>\s*<strong>\s*왜[\s\S]*?<\/p>/;
/** A provenance tag a 왜 field may carry. The cf-src badge must be a valid label
 *  WITH its required companion — `근거` followed by a quote, `추론` followed by a
 *  ground (a non-tag char, so `추론</span></p>` fails), or a standalone
 *  `Unknown / not supplied`. The class alone, an empty/garbage label, or a bare
 *  badge with nothing after is a flat assertion. Whether an 추론's ground is real
 *  stays a human call (discipline.md); this only checks the badge's form. Legacy
 *  bracket forms remain accepted. */
const PROVENANCE =
	/<span[^>]*class=["']cf-src["'][^>]*>\s*근거\s*<\/span>\s*"[^"]+"|<span[^>]*class=["']cf-src["'][^>]*>\s*추론\s*<\/span>\s*[^<\s]|<span[^>]*class=["']cf-src["'][^>]*>\s*Unknown\s*\/\s*not supplied\s*<\/span>|\[근거:|\[추론:/;

/** Fenced code, matched so it can be stripped or length-preserving masked. */
const FENCE_RE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})[^\n]*$/gm;

/** Raw HTML preformatted blocks, which are not visible Markdown content. */
const RAW_PRE_RE = /<pre\b[^>]*>[\s\S]*?(?:<\/pre\s*>|$)/gi;

/** Fenced code with its info string and body captured, so a mermaid-only or
 *  empty fence can be told apart from an actual core-logic fence. */
const CODE_FENCE = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^(?:`{3,}|~{3,})[^\n]*$/gm;

/**
 * A change block satisfies R13's core-logic requirement only with a fence that is
 * NOT a mermaid diagram and is NOT empty. The template reserves mermaid for
 * diagrams and requires real code/pseudocode per change, so a mermaid-only or
 * blank fence is not the logic R13 guarantees.
 */
function hasCoreCodeFence(body: string): boolean {
	CODE_FENCE.lastIndex = 0;
	let m: RegExpExecArray | null = CODE_FENCE.exec(body);
	while (m !== null) {
		const info = (m[2] ?? "").trim().toLowerCase();
		const content = (m[3] ?? "").trim();
		if (info !== "mermaid" && content !== "") return true;
		m = CODE_FENCE.exec(body);
	}
	return false;
}

function collect(re: RegExp, text: string): string[] {
	const out: string[] = [];
	re.lastIndex = 0;
	let m: RegExpExecArray | null = re.exec(text);
	while (m !== null) {
		out.push(m[1] ?? m[0]);
		m = re.exec(text);
	}
	return out;
}

/** Removes fenced Markdown code (headings/anchors inside code are not structure). */
function withoutFencedCode(text: string): string {
	return text.replace(FENCE_RE, "");
}

/**
 * Blanks fenced code to same-length spaces (newlines kept), so heading and
 * boundary offsets computed on the masked copy still index the raw text. This
 * is what lets change blocks carry code fences without a `##` comment line inside
 * the fence truncating the block early.
 */
function maskFenced(text: string): string {
	return text.replace(FENCE_RE, (m) => m.replace(/[^\n]/g, " "));
}

/** Masks Markdown that is not visible content for structural predicates. */
function maskNonVisibleContainers(text: string): string {
	const withoutComments = text.replace(
		/<!--[\s\S]*?(?:-->|$)/g,
		(m) => m.replace(/[^\n]/g, " "),
	);
	const withoutRawPre = withoutComments.replace(RAW_PRE_RE, (m) => m.replace(/[^\n]/g, " "));
	const maskIndentedCode = (segment: string): string =>
		segment.replace(/^(?: {4}|\t)[^\r\n]*(?:\r?\n|$)/gm, (m) => m.replace(/[^\n]/g, " "));
	FENCE_RE.lastIndex = 0;
	let masked = "";
	let lastIndex = 0;
	let fence: RegExpExecArray | null = FENCE_RE.exec(withoutRawPre);
	while (fence !== null) {
		masked += maskIndentedCode(withoutRawPre.slice(lastIndex, fence.index));
		masked += fence[0];
		lastIndex = fence.index + fence[0].length;
		fence = FENCE_RE.exec(withoutRawPre);
	}
	return masked + maskIndentedCode(withoutRawPre.slice(lastIndex));
}

/** Masks fenced Markdown as well as non-visible containers. */
function maskNonVisibleMarkdown(text: string): string {
	return maskNonVisibleContainers(maskFenced(text));
}

/** Removes fenced and inline Markdown code, which can describe styles without applying them. */
function withoutMarkdownCode(text: string): string {
	return withoutFencedCode(text).replace(/`+[^`\n]*`+/g, "");
}

/** The slice of `text` belonging to one change block: from its `#### ` heading to the next heading. */
function changeBlocks(text: string): Array<{ heading: string; body: string }> {
	const masked = maskFenced(text);
	const out: Array<{ heading: string; body: string }> = [];
	const re = new RegExp(CHANGE_BLOCK.source, "gm");
	const marks: Array<{ heading: string; start: number }> = [];
	let m: RegExpExecArray | null = re.exec(masked);
	while (m !== null) {
		const captured = m[1];
		if (captured !== undefined) marks.push({ heading: captured, start: m.index + m[0].length });
		m = re.exec(masked);
	}
	for (const mark of marks) {
		const next = masked.slice(mark.start).search(/^#{2,4}\s/m);
		const end = next >= 0 ? mark.start + next : text.length;
		out.push({ heading: mark.heading, body: text.slice(mark.start, end) });
	}
	return out;
}

/** One `cf-loc` location citation parsed from a change block's `base:`/`head:` anchors. */
interface LocAnchor {
	side: AnchorSide;
	path: string;
	/** The parsed `:<number>` line, or null when the anchor carries no numeric suffix. */
	line: number | null;
}

const ANCHOR_SIDES: AnchorSide[] = ["base", "head"];

/** Every `base:path:line` / `head:path:line` location anchor in one change block. */
function blockAnchors(body: string): LocAnchor[] {
	const clean = withoutFencedCode(body);
	const out: LocAnchor[] = [];
	for (const side of ANCHOR_SIDES) {
		for (const value of anchorValues(clean, side)) {
			if (value === "") continue;
			const match = value.match(/^(.*):(\d+)$/);
			if (match !== null && match[1] !== undefined)
				out.push({ side, path: match[1], line: Number(match[2]) });
			else out.push({ side, path: value, line: null });
		}
	}
	return out;
}

/** The slice of `text` belonging to one Change Group: from its heading to the next level-two heading. */
function groupSlices(text: string): Array<{ title: string; body: string }> {
	const masked = maskFenced(text);
	const re = /^##\s+(Change Group\s+\d+)\s*:.*$/gm;
	const out: Array<{ title: string; body: string }> = [];
	const marks: Array<{ title: string; start: number }> = [];
	let m: RegExpExecArray | null = re.exec(masked);
	while (m !== null) {
		if (m[1] !== undefined) marks.push({ title: m[1], start: m.index + m[0].length });
		m = re.exec(masked);
	}
	for (const mark of marks) {
		const next = masked.slice(mark.start).search(/^##\s/m);
		const end = next >= 0 ? mark.start + next : text.length;
		out.push({ title: mark.title, body: text.slice(mark.start, end) });
	}
	return out;
}

/** The source table required inside `## Evidence` > `### 원천`. */
const EVIDENCE_SOURCE_TABLE =
	/^ {0,3}\|[ \t]*종류[ \t]*\|[ \t]*식별자\/경로[ \t]*\|[ \t]*확보[ \t]*\|[ \t]*내용 요약[ \t]*\|\r?\n {0,3}\|[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|\r?\n/m;

/** One four-cell data row following the source table header and separator. */
const EVIDENCE_SOURCE_DATA_ROW =
	/^ {0,3}\|([^|\r\n]*)\|([^|\r\n]*)\|([^|\r\n]*)\|([^|\r\n]*)\|[ \t]*(?:\r?\n|$)/gm;

/** Returns whether a table cell contains visible semantic text. */
function hasVisibleCellText(cell: string): boolean {
	return cell
		.replace(/<[^>]*>/g, "")
		.replace(/&(?:nbsp|#160|#xA0);/gi, "")
		.trim() !== "";
}

/** Returns the missing structure in the Evidence source sweep, if any. */
function checkEvidenceSourceStructure(text: string): string {
	const evidence = sectionSlice(maskNonVisibleMarkdown(text), "Evidence");
	if (evidence === null) return "## Evidence 섹션이 없습니다";

	const source = levelSlice(evidence, "원천");
	if (source === null) return "## Evidence 안에 ### 원천 heading이 없습니다";
	const table = EVIDENCE_SOURCE_TABLE.exec(source);
	let hasDataRow = false;
	if (table !== null) {
		EVIDENCE_SOURCE_DATA_ROW.lastIndex = table.index + table[0].length;
		let row: RegExpExecArray | null = EVIDENCE_SOURCE_DATA_ROW.exec(source);
		while (row !== null) {
			const cells = row.slice(1, 5);
			if (cells.length === 4 && cells.every((cell) => hasVisibleCellText(cell))) {
				hasDataRow = true;
				break;
			}
			row = EVIDENCE_SOURCE_DATA_ROW.exec(source);
		}
	}
	if (table === null || !hasDataRow) {
		return "원천 표가 없습니다 — 정확한 4열 헤더(종류 | 식별자/경로 | 확보 | 내용 요약), 구분선, 최소 1개 데이터 행이 필요합니다";
	}
	return "";
}

// R1, listing form (evidence step) — every signal file appears somewhere in
// the document, and the Evidence source sweep has its required table. The
// empty signal set fails rather than passing vacuously.
function checkR1Listing(text: string, signalFiles: string[]): CheckItem {
	const missing = signalFiles.filter((p) => !text.includes(p));
	const problems: string[] = [];
	if (signalFiles.length === 0) {
		problems.push("signal 파일이 하나도 분류되지 않았습니다 — evidence 스텝의 분류표를 확인하세요.");
	} else if (missing.length > 0) {
		problems.push(`문서에 등장하지 않는 파일: ${missing.join(", ")}`);
	}
	const sourceProblem = checkEvidenceSourceStructure(text);
	if (sourceProblem !== "") problems.push(sourceProblem);
	return {
		id: "R1",
		title: "R1 signal 파일 전수 등장 (등재형)",
		pass: problems.length === 0,
		detail: problems.join(" / "),
	};
}

// R1, coverage form (code step) — every signal file is CITED by at least one
// change block's location anchors. The unit is the change, not the file, so a
// file may be cited by several changes (no exactly-once rule); what must not
// happen is a signal file that never appears in any `바뀐 위치` slot — that is a
// file the walkthrough silently dropped.
function checkR1Coverage(
	blocks: Array<{ heading: string; body: string }>,
	signalFiles: string[],
): CheckItem {
	const cited = new Set<string>();
	for (const b of blocks) for (const a of blockAnchors(b.body)) cited.add(a.path);
	const missing = signalFiles.filter((p) => !cited.has(p));
	return {
		id: "R1",
		title: "R1 signal 파일 변경 블록 인용 커버리지 (커버리지형)",
		pass: signalFiles.length > 0 && missing.length === 0,
		detail:
			signalFiles.length === 0
				? "signal 파일이 하나도 분류되지 않았습니다 — evidence 스텝의 분류표를 확인하세요."
				: missing.length > 0
					? `어느 변경 블록의 '바뀐 위치'(cf-loc)에도 인용되지 않은 signal 파일: ${missing.join(", ")}`
					: "",
	};
}

// R2 — the three slots of a Change Group.
function checkR2(text: string): CheckItem {
	const masked = maskFenced(text);
	const groups = collect(new RegExp(GROUP_HEADING.source, "gm"), masked);
	const heralds = (masked.match(/^>\s*예고\s*:/gm) || []).length;
	const orders = (masked.match(/^>\s*순서\s*:/gm) || []).length;
	const r2Missing: string[] = [];
	if (groups.length === 0) r2Missing.push("Change Group 제목");
	if (heralds < groups.length || heralds === 0) r2Missing.push("예고 슬롯");
	if (orders < groups.length || orders === 0) r2Missing.push("순서 근거 슬롯");
	return {
		id: "R2",
		title: "R2 Change Group 구조",
		pass: r2Missing.length === 0,
		detail: r2Missing.length > 0 ? `채워지지 않은 슬롯: ${r2Missing.join(", ")}` : "",
	};
}

/** Every `근거` badge's quote in the document (the required companion of a 근거
 *  provenance tag). Both HTML (`cf-src">근거</span> "…"`) and legacy bracket
 *  (`[근거: …]`) forms are extracted so R22 covers the same surface R3 accepts. */
function collectGroundQuotes(text: string): string[] {
	const out: string[] = [];
	const html = /<span[^>]*class=["']cf-src["'][^>]*>\s*근거\s*<\/span>\s*"([^"]+)"/g;
	const bracket = /\[근거:\s*([^\]]+)\]/g;
	for (const re of [html, bracket]) {
		let m: RegExpExecArray | null = re.exec(text);
		while (m !== null) {
			const q = (m[1] ?? "").trim();
			if (q.length > 0) out.push(q);
			m = re.exec(text);
		}
	}
	return out;
}

/** Whitespace-free view for verbatim comparison. Commit bodies are hard-wrapped
 *  and use paired inline Markdown formatting; a faithful quote unwraps those
 *  markers. Only paired code/emphasis/strike delimiters are removed, so the
 *  punctuation in an identifier or expression remains meaningful. */
function normalizeForSource(s: string): string {
	const codeSpans: string[] = [];
	const maskedCode = s.replace(
		/(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g,
		(match: string, _delimiter: string, content: string) => {
			if (content.trim().length === 0) return match;
			const token = `\uE000${codeSpans.length}\uE001`;
			codeSpans.push(content);
			return token;
		},
	);

	const withoutFormatting = maskedCode
		.replace(
			/(?<![\p{L}\p{N}_])(\*\*|__|~~)(?!\s)([\s\S]*?)(?<!\s)\1(?![\p{L}\p{N}_])/gu,
			"$2",
		)
		.replace(
			/(?<![\p{L}\p{N}_])([*_])(?!\s)([\s\S]*?)(?<!\s)\1(?![\p{L}\p{N}_])/gu,
			"$2",
		);

	const restoredCode = withoutFormatting.replace(
		/\uE000(\d+)\uE001/g,
		(match: string, index: string) => codeSpans[Number(index)] ?? match,
	);
	return restoredCode.replace(/\s+/g, "");
}

// R22 — 근거 소스 대조. R3 checks a 왜 field CARRIES a 근거 badge; R22 checks the
// quote inside that badge is real. Each 근거 quote must be a normalized substring
// of the range's own source (every commit body ∪ the net diff text). This is the
// one machine check that catches invention: a paraphrase, or a sentence lifted
// from the PR description, appears nowhere in the source and fails here. It does
// NOT prove attribution (that the quote sits in the SPECIFIC commit the block
// names) — a quote verbatim in commit Y but attributed to commit X still passes;
// that residue is left to discipline.md and the fact-check subagent.
// lazy: union-of-corpus membership, no per-commit attribution; tighten to
// per-commit bodies if wrong-commit quotes start recurring.
function checkR22(text: string, sourceCorpus: string | undefined): CheckItem {
	const quotes = collectGroundQuotes(text);
	// Undefined/empty corpus = capture failed. Fail-open, like R13's empty hashes:
	// "git failed" must not read as "every quote is fabricated".
	if (sourceCorpus === undefined || sourceCorpus.trim().length === 0) {
		return { id: "R22", title: "R22 근거 소스 대조", pass: true, detail: "" };
	}
	const corpus = normalizeForSource(sourceCorpus);
	const missing = quotes.filter((q) => !corpus.includes(normalizeForSource(q)));
	return {
		id: "R22",
		title: "R22 근거 소스 대조",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `커밋 본문·넷 diff 어디에도 없는 근거 인용(패러프레이즈·PR 본문 발명 의심): ${missing
						.map((q) => `"${q}"`)
						.join(", ")}`
				: "",
	};
}

// R3 — provenance on every 왜. Not "don't explain why": say WHERE the why came
// from. Read on the code-stripped body so a `[근거:]` inside a code comment can
// not stand in for the change block's actual 왜 field.
function checkR3(blocks: Array<{ heading: string; body: string }>): CheckItem {
	const bodies = blocks.map((b) => ({ heading: b.heading, body: withoutFencedCode(b.body) }));
	const unmarked = bodies
		.filter((b) => WHY_PARAGRAPH.test(b.body))
		.filter((b) => {
			const m = b.body.match(WHY_PARAGRAPH);
			return m === null || !PROVENANCE.test(m[0]);
		})
		.map((b) => b.heading);
	const noWhy = bodies.filter((b) => !WHY_PARAGRAPH.test(b.body)).map((b) => b.heading);
	return {
		id: "R3",
		title: "R3 왜의 출처 표시",
		pass: blocks.length > 0 && unmarked.length === 0 && noWhy.length === 0,
		detail:
			blocks.length === 0
				? "변경 블록이 하나도 없습니다."
				: noWhy.length > 0
					? `"왜" 필드가 없는 변경: ${noWhy.join(", ")}`
					: unmarked.length > 0
						? `출처 태그(cf-src / [근거:] / [추론:] / Unknown) 없이 단정한 변경: ${unmarked.join(", ")}`
						: "",
	};
}

// R4 — two-tier background with a skip marker.
function checkR4(text: string): CheckItem {
	const hasDeep = /###\s*깊은 배경/.test(text);
	const hasNarrow = /###\s*좁은 배경/.test(text);
	const hasSkip = /(건너뛰|이미 (아는|익숙)|already familiar)/.test(text);
	const r4Missing = [
		hasDeep ? "" : "깊은 배경",
		hasNarrow ? "" : "좁은 배경",
		hasSkip ? "" : "건너뛰기 마커",
	].filter(Boolean);
	return {
		id: "R4",
		title: "R4 Background 2단 + 건너뛰기 마커",
		pass: r4Missing.length === 0,
		detail: r4Missing.length > 0 ? `없는 요소: ${r4Missing.join(", ")}` : "",
	};
}

/** The slots the 목표 section must fill (R16): goal+why, a one-line core, and where the understanding came from. */
const GOAL_SLOTS = [
	{ label: "무엇을·왜", re: /^###\s*무엇을/m },
	{ label: "핵심", re: /^###\s*핵심/m },
	{ label: "출처", re: /^###\s*출처/m },
] as const;

function goalSlotHasContent(slice: string, slot: (typeof GOAL_SLOTS)[number]): boolean {
	const heading = slot.re.exec(slice);
	if (heading === null) return false;
	const lineEnd = slice.indexOf("\n", heading.index);
	const bodyStart = lineEnd >= 0 ? lineEnd + 1 : slice.length;
	const nextHeading = slice.slice(bodyStart).search(/^#{1,3}\s/m);
	const bodyEnd = nextHeading >= 0 ? bodyStart + nextHeading : slice.length;
	return /\S/.test(slice.slice(bodyStart, bodyEnd));
}

// R16 — the goal / core-message beat, authored before any architecture or code.
// Measured gap: the document jumped from Background straight to Architecture with
// no statement of what the change is for or its one-line takeaway, so a reader met
// the mechanism before ever learning the point. Forced as slots because a prose
// request to "state the goal first" does not land as structure (same pattern as
// R2/R9/R14). Read on the fence-masked text so a `###` inside a code example does
// not stand in for the real slot.
function checkR16(text: string): CheckItem {
	const slice = sectionSlice(maskFenced(text), "목표");
	if (slice === null) {
		return {
			id: "R16",
			title: "R16 목표·핵심 전달",
			pass: false,
			detail: "## 목표 섹션이 없습니다 — 코드 전에 이 변경의 목표와 핵심 한 줄을 먼저 전달하세요.",
		};
	}
	const missing = GOAL_SLOTS.filter((s) => !goalSlotHasContent(slice, s)).map((s) => s.label);
	return {
		id: "R16",
		title: "R16 목표·핵심 전달",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `목표 섹션에 없는 슬롯: ${missing.join(", ")} (### 무엇을·왜 / ### 핵심 / ### 출처 — 이 이해에 쓴 근거: Linear·Notion·Slack·커밋·PR·위키·코드 추론)`
				: "",
	};
}

type AnchorSide = "base" | "head";

function anchorValues(body: string, side: AnchorSide): string[] {
	const values: string[] = [];
	const re = new RegExp(`${side}:([^<\\r\\n]+)`, "g");
	let match: RegExpExecArray | null = re.exec(body);
	while (match !== null) {
		if (match[1] !== undefined) values.push(match[1].trim());
		match = re.exec(body);
	}
	return values;
}

/** Location anchors collected per file path across all change blocks. */
interface FileAnchors {
	baseLines: number[];
	headLines: number[];
	baseNonNumeric: boolean;
	headNonNumeric: boolean;
}

/** Gathers every change block's `base:`/`head:` anchors keyed by file path. */
function collectFileAnchors(blocks: Array<{ body: string }>): Map<string, FileAnchors> {
	const byPath = new Map<string, FileAnchors>();
	for (const b of blocks) {
		for (const a of blockAnchors(b.body)) {
			const e = byPath.get(a.path) ?? {
				baseLines: [],
				headLines: [],
				baseNonNumeric: false,
				headNonNumeric: false,
			};
			if (a.line === null) {
				if (a.side === "base") e.baseNonNumeric = true;
				else e.headNonNumeric = true;
			} else {
				(a.side === "base" ? e.baseLines : e.headLines).push(a.line);
			}
			byPath.set(a.path, e);
		}
	}
	return byPath;
}

// R5 — traceability, file-centric. Every signal file must have its before AND
// after location cited somewhere in the change blocks' `바뀐 위치` (cf-loc)
// slots — an ADDED file needs the head anchor alone, a DELETED file the base
// alone — and every cited numeric anchor must land in a real diff hunk. Because
// the unit is the change, one file's anchors may be spread across several change
// blocks, so they are gathered per path first. New-ness comes from `A` in
// `git diff --name-status`; deleted-ness (no head side) comes from the hunk
// header. Without hunk metadata for a file, the check falls back to
// presence-only and rejects the `:1 → :1` placeholder on a modified file.
function checkR5(
	blocks: Array<{ heading: string; body: string }>,
	signalFiles: string[],
	addedFiles: string[] | undefined,
	diffHunks: DiffHunk[] | undefined,
): CheckItem {
	const addedSet = new Set(addedFiles ?? []);
	const byPath = collectFileAnchors(blocks);
	const hunksByPath = new Map<string, DiffHunk[]>();
	for (const hunk of diffHunks ?? []) {
		const hunks = hunksByPath.get(hunk.path) ?? [];
		hunks.push(hunk);
		hunksByPath.set(hunk.path, hunks);
	}

	const missing: string[] = [];
	const outside: string[] = [];
	const placeholder: string[] = [];

	for (const file of signalFiles) {
		const e = byPath.get(file);
		const hasBase = (e?.baseLines.length ?? 0) > 0 || (e?.baseNonNumeric ?? false);
		const hasHead = (e?.headLines.length ?? 0) > 0 || (e?.headNonNumeric ?? false);
		const hunks = hunksByPath.get(file);

		if (hunks !== undefined && hunks.length > 0) {
			const needsBase = !addedSet.has(file) && hunks.some((h) => h.base !== null);
			const needsHead = hunks.some((h) => h.head !== null);
			if (needsBase && (e?.baseLines.length ?? 0) === 0) missing.push(`${file} (base)`);
			if (needsHead && (e?.headLines.length ?? 0) === 0) missing.push(`${file} (head)`);
			for (const bl of e?.baseLines ?? [])
				if (
					!hunks.some(
						(h) => h.base !== null && bl >= h.base.start && bl < h.base.start + h.base.count,
					)
				)
					outside.push(`${file} (base:${bl})`);
			for (const hl of e?.headLines ?? [])
				if (
					!hunks.some(
						(h) => h.head !== null && hl >= h.head.start && hl < h.head.start + h.head.count,
					)
				)
					outside.push(`${file} (head:${hl})`);
		} else {
			if (addedSet.has(file)) {
				if (!hasHead) missing.push(`${file} (head)`);
			} else if (!(hasBase && hasHead)) {
				missing.push(`${file} (base/head)`);
			}
			if (
				!addedSet.has(file) &&
				e !== undefined &&
				e.baseLines.length === 1 &&
				e.baseLines[0] === 1 &&
				e.headLines.length === 1 &&
				e.headLines[0] === 1
			)
				placeholder.push(file);
		}
	}

	return {
		id: "R5",
		title: "R5 추적성",
		pass:
			signalFiles.length > 0 &&
			missing.length === 0 &&
			outside.length === 0 &&
			placeholder.length === 0,
		detail:
			signalFiles.length === 0
				? "signal 파일이 하나도 없습니다."
				: missing.length > 0
					? `변경 블록의 '바뀐 위치'(cf-loc)에 base/head 위치가 인용되지 않은 signal 파일: ${missing.join(", ")}`
					: outside.length > 0
						? `실제 diff hunk 범위 밖의 위치 앵커: ${outside.join(", ")}`
						: placeholder.length > 0
							? `cf-loc가 실제 변경 위치가 아니라 :1 → :1 플레이스홀더인 파일: ${placeholder.join(", ")} — git으로 변경 hunk의 base/head 라인을 확인해 적는다`
							: "",
	};
}

/** Levels the Architecture section must cover, each with a diagram or an explicit waiver. */
const ARCH_LEVELS = ["시스템 레벨", "컴포넌트 레벨", "도메인 레벨"] as const;

/** A waived level must be a dedicated line that says WHY — a bare marker is an opt-out, not a claim. */
const ARCH_WAIVER = /^[ \t]*구조 변화 없음[ \t]*[:：—-][ \t]*(\S[^\r\n]*)$/m;

function hasArchWaiver(text: string): boolean {
	const match = ARCH_WAIVER.exec(text);
	return match !== null && hasVisibleCellText(match[1] ?? "");
}

/** The three system-contract axes the 시스템 레벨 must enumerate (R14). */
const SYSTEM_CONTRACT_AXES = ["서버 API", "DB 스키마", "클라이언트 의존"] as const;

/** The slice of `text` from a `### <level>` heading to the next heading of depth <= 3. */
function levelSlice(text: string, level: string): string | null {
	const re = new RegExp(`^###\\s*${level}.*$`, "m");
	const m = re.exec(text);
	if (!m) return null;
	const start = m.index + m[0].length;
	const next = text.slice(start).search(/^#{2,3}\s/m);
	return next >= 0 ? text.slice(start, start + next) : text.slice(start);
}

/** The bodies of every ` ```mermaid ` fence in a raw (unmasked) slice. */
function mermaidFences(rawSlice: string): string[] {
	const out: string[] = [];
	const re = /```mermaid\r?\n([\s\S]*?)```/g;
	let m: RegExpExecArray | null = re.exec(rawSlice);
	while (m !== null) {
		if (m[1] !== undefined) out.push(m[1]);
		m = re.exec(rawSlice);
	}
	return out;
}

/** A node/label token that is a source file path (including root-level files). */
const FILE_PATH_TOKEN = /(?:^|[\s"'([{])(?:[\w.@-]+\/)*[\w.@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|md|json|sql|yaml|yml|css|scss)\b/i;

const DIAGRAM_TOKEN = "[A-Za-z0-9_./@-]+";
const DIAGRAM_NON_NODE_LINE = /^(?:flowchart|graph|classDiagram|erDiagram|sequenceDiagram|stateDiagram(?:-v2)?|subgraph|end|direction|title|accTitle|accDescr|note|classDef|style|linkStyle|click)\b/i;
const DIAGRAM_NODE_DECLARATION = new RegExp(
	`(?:^|[\\s,])(${DIAGRAM_TOKEN})\\s*(?:\\[\\[([^\\]\\r\\n]*)\\]\\]|\\[([^\\]\\r\\n]*)\\]|\\(\\(([^)\\r\\n]*)\\)\\)|\\(([^)\\r\\n]*)\\)\\)|\\{\\{([^}\\r\\n]*)\\}\\}|\\{([^}\\r\\n]*)\\})`,
	"g",
);
const DIAGRAM_RELATION = new RegExp(
	`(?:^|[\\s,])(${DIAGRAM_TOKEN}?)\\s*(?:["'][^"\\r\\n]*["']\\s*)?[<|>*o.{}-]{2,}\\s*(?:["'][^"\\r\\n]*["']\\s*)?(${DIAGRAM_TOKEN})`,
	"g",
);

function diagramNodeLabels(fence: string): string[] {
	const labels: string[] = [];
	for (const rawLine of fence.split(/\r?\n/)) {
		const line = rawLine.replace(/%%.*$/, "").trim();
		if (line === "" || DIAGRAM_NON_NODE_LINE.test(line)) continue;

		const classDeclaration = new RegExp(`^class\\s+(${DIAGRAM_TOKEN})\\b`, "i").exec(line);
		if (classDeclaration?.[1] !== undefined) {
			labels.push(classDeclaration[1]);
			continue;
		}

		const withoutEdgeLabels = line.replace(/\|[^|\r\n]*\|/g, "");
		DIAGRAM_NODE_DECLARATION.lastIndex = 0;
		let declaration: RegExpExecArray | null = DIAGRAM_NODE_DECLARATION.exec(withoutEdgeLabels);
		while (declaration !== null) {
			for (const value of declaration.slice(1)) {
				if (value !== undefined) labels.push(value);
			}
			declaration = DIAGRAM_NODE_DECLARATION.exec(withoutEdgeLabels);
		}

		const block = new RegExp(`^(${DIAGRAM_TOKEN})\\s*\\{$`).exec(withoutEdgeLabels);
		if (block?.[1] !== undefined) labels.push(block[1]);

		DIAGRAM_RELATION.lastIndex = 0;
		let relationship: RegExpExecArray | null = DIAGRAM_RELATION.exec(withoutEdgeLabels);
		while (relationship !== null) {
			if (relationship[1] !== undefined) labels.push(relationship[1]);
			if (relationship[2] !== undefined) labels.push(relationship[2]);
			relationship = DIAGRAM_RELATION.exec(withoutEdgeLabels);
		}

		const standalone = new RegExp(`^(${DIAGRAM_TOKEN})$`).exec(withoutEdgeLabels);
		if (standalone?.[1] !== undefined) labels.push(standalone[1]);
	}
	return labels;
}

// Component/domain diagram nodes must name a MODULE/concept (a feature, use case,
// hook, service, entity), not a source file path — a file path is WHERE a symbol
// lives (the card's `패키지` slot), not WHAT the component is. Measured gap: the
// component diagram nodes were full file paths that truncated mid-path
// (`health-`, `proposal-`) and told the reader a location, not a module.
function diagramFilePathNodes(rawSlice: string): boolean {
	return mermaidFences(rawSlice).some((fence) =>
		diagramNodeLabels(fence).some((label) => FILE_PATH_TOKEN.test(label)),
	);
}

// A domain object diagram (`classDiagram`) drawn with empty class bodies is an
// opaque box. Measured gap: the domain classDiagram showed only class names with
// no members or methods, so a reader could not tell what each object holds or
// does. Every rendered class must carry at least one member/method — explicit
// declarations, relationship endpoints, and `Class : +field` declarations all
// create class boxes in Mermaid.
function classDiagramMissingMembers(rawSlice: string): boolean {
	const fences = mermaidFences(rawSlice).filter((f) => /\bclassDiagram\b/.test(f));
	if (fences.length === 0) return false;
	return fences.some((fence) => {
		const lines = fence.split(/\r?\n/);
		const classes = new Map<string, boolean>();
		const declareClass = (name: string, hasMember = false): void => {
			classes.set(name, (classes.get(name) ?? false) || hasMember);
		};

		for (const line of lines) {
			const member = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*[+\-#~]?\s*\S/);
			if (member?.[1] !== undefined) declareClass(member[1], true);

			const relationship = line.match(
				/^\s*([A-Za-z_][\w-]*)\s*(?:["'][^"']*["']\s+)?[<|>*o.-]{2,}(?:\s+["'][^"']*["'])?\s*([A-Za-z_][\w-]*)\b/,
			);
			if (relationship?.[1] !== undefined && relationship[2] !== undefined) {
				declareClass(relationship[1]);
				declareClass(relationship[2]);
			}
		}

		for (let index = 0; index < lines.length; index += 1) {
			const declaration = lines[index]?.match(/^\s*class\s+([A-Za-z_][\w-]*)\b(.*)$/);
			if (declaration?.[1] === undefined) continue;

			const name = declaration[1];
			const tail = declaration[2] ?? "";
			const openBrace = tail.indexOf("{");
			if (openBrace < 0) {
				declareClass(name);
				continue;
			}

			const sameLineBody = tail.slice(openBrace + 1);
			const closeBrace = sameLineBody.indexOf("}");
			if (closeBrace >= 0) {
				declareClass(name, sameLineBody.slice(0, closeBrace).trim().length > 0);
				continue;
			}

			let hasMember = false;
			for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
				const bodyLine = lines[bodyIndex]?.trim() ?? "";
				if (bodyLine === "}") {
					index = bodyIndex;
					break;
				}
				if (bodyLine !== "" && !bodyLine.startsWith("%%") && !/^<<.*>>$/.test(bodyLine)) {
					hasMember = true;
				}
			}
			declareClass(name, hasMember);
		}

		return classes.size > 0 && [...classes.values()].some((hasMember) => !hasMember);
	});
}

// R9 — the three architecture levels, each with a mermaid diagram or a reasoned waiver.
function checkR9(text: string): CheckItem {
	const problems: string[] = [];
	for (const level of ARCH_LEVELS) {
		const slice = levelSlice(maskNonVisibleMarkdown(text), level);
		const diagramSlice = levelSlice(maskNonVisibleContainers(text), level);
		if (slice === null) {
			problems.push(`${level} 헤딩(### ${level})이 없습니다`);
			continue;
		}
		const hasDiagram = diagramSlice !== null && /```mermaid/.test(diagramSlice);
		if (!hasDiagram && !hasArchWaiver(slice)) {
			problems.push(
				`${level}에 mermaid 다이어그램도, 사유를 단 생략 마커("구조 변화 없음: <사유>")도 없습니다`,
			);
		}
	}
	return {
		id: "R9",
		title: "R9 아키텍처 3레벨",
		pass: problems.length === 0,
		detail: problems.join(" / "),
	};
}

// R14 — the system level must enumerate the changed contracts across all three
// axes (server API / DB schema / client dependency). Measured gap: 시스템 레벨
// drew one box-and-arrow diagram and stopped, never naming which API surface,
// schema, or client-consumed contract this diff actually moves.
function checkR14(text: string): CheckItem {
	// Mask fenced code first: a contract table that lives only inside a fenced
	// example (the template itself ships one) is illustration, not the rendered
	// table R14 requires. Every other structural check strips fences the same way.
	const slice = levelSlice(maskFenced(text), "시스템 레벨");
	if (slice === null) {
		return {
			id: "R14",
			title: "R14 시스템 레벨 변경 계약 3축",
			pass: false,
			detail: "시스템 레벨 헤딩(### 시스템 레벨)이 없습니다",
		};
	}
	// All three axis labels must be present in the system-level slice. What each
	// axis says about its contract is the author's to fill — the gate only forces
	// that the three change-contract axes are named, not their content.
	const missing = SYSTEM_CONTRACT_AXES.filter((axis) => !slice.includes(axis));
	return {
		id: "R14",
		title: "R14 시스템 레벨 변경 계약 3축",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `시스템 레벨 변경 계약 표에 없는 축: ${missing.join(", ")} (세 축 라벨을 모두 표에 둔다)`
				: "",
	};
}

/**
 * The boundary / dependency / use-case block the Architecture section must carry
 * (R15, v5 rewrite). The baseline that forced the rewrite: the earlier static
 * classification table (파트/레이어/협력자/영향·수정) miscategorised parts that are
 * neither a clean vertical domain nor a horizontal use-case, and answered "what
 * exists" instead of "what this diff did to the boundary". The block is now a
 * change map: each behaviour unit is an `arch-entity` carrying its change kind
 * (`data-change`) and the interface it affects (`영향 인터페이스`), closed by a
 * one-line dependency-direction verdict (`의존 방향`). The gate forces the slots
 * present; what each says is the author's to fill.
 */
const BOUNDARY_MARKERS = ["영향 인터페이스", "의존 방향"] as const;

// R15 — the boundary / dependency / use-case change map, read on the
// `### 경계·의존·유스케이스` sub-slice with fences masked for the slot check, but
// the RAW slice for the orchestration-diagram check (a mermaid fence is masked
// away, so it must be looked for before masking). Measured gap: the use-case
// level was a list of static arch-entity cards with cryptic names
// ("V2 proposal detail / active read") and no flow — a reader could not see the
// call order or which step moved. The rewrite requires the block to SHOW the
// orchestration as a mermaid diagram (a sequenceDiagram is the recommended type)
// with the changed step marked (leveling/marker judged by R12), alongside the
// existing behaviour-unit cards and the dependency-direction verdict.
function checkR15(text: string): CheckItem {
	const diagramSlice = levelSlice(maskNonVisibleContainers(text), "경계·의존·유스케이스");
	const slice = levelSlice(maskNonVisibleMarkdown(text), "경계·의존·유스케이스");
	if (slice === null || diagramSlice === null) {
		return {
			id: "R15",
			title: "R15 경계·의존·유스케이스 블록",
			pass: false,
			detail: "경계·의존·유스케이스 헤딩(### 경계·의존·유스케이스)이 없습니다",
		};
	}
	const missing: string[] = BOUNDARY_MARKERS.filter((label) => !slice.includes(label));
	// The change kind of each behaviour unit rides on a renderer-recognized
	// arch-entity opening tag — prose mentions or unsupported values are not a
	// change map.
	if (!hasValidArchEntity(slice)) missing.push("변경종류(data-change: new|mod|del)");
	// The orchestration must be a real diagram, not prose — the flow (call order,
	// changed step) is shown, not narrated. A reasoned waiver stands in when the
	// diff genuinely changes no use-case flow.
	const hasOrchestration =
		mermaidFences(diagramSlice).some((fence) => /^\s*sequenceDiagram\b/m.test(fence)) ||
		hasArchWaiver(slice);
	if (!hasOrchestration) missing.push("오케스트레이션 다이어그램(mermaid sequenceDiagram)");
	return {
		id: "R15",
		title: "R15 경계·의존·유스케이스 블록",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `경계·의존·유스케이스 블록에 없는 슬롯: ${missing.join(", ")} — 유스케이스마다 오케스트레이션(mermaid sequenceDiagram)으로 흐름과 바뀐 단계를 보이고, 동작 단위마다 변경종류(arch-entity data-change)·영향 인터페이스를 적고, 의존 방향을 판정한다 (architecture-boundaries rule 참조)`
				: "",
	};
}

/** The column labels the 시스템 레벨 standing-interface table must carry (R17). */
const STANDING_INTERFACE_MARKERS = ["경계", "인터페이스", "오가는 것"] as const;

const STANDING_INTERFACE_TABLE =
	/^[ \t]*\|[ \t]*경계[ \t]*\|[ \t]*인터페이스[ \t]*\|[ \t]*오가는 것[ \t]*\|[ \t]*\r?\n[ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*\r?\n(?![ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*:?-+:?[ \t]*\|[ \t]*(?:\r?\n|$))[ \t]*\|[^|\r\n]*\|[^|\r\n]*\|[^|\r\n]*\|[ \t]*(?:\r?\n|$)/m;

// R17 — the system level, beyond the change-contract table (R14), carries a
// standing-interface table so the diagram's short-protocol edges become legible:
// which boundary talks over which endpoint/query/screen-URL, and what flows.
// Read on the 시스템 레벨 slice with fences masked, same discipline as R14.
function checkR17(text: string): CheckItem {
	const slice = levelSlice(maskFenced(text), "시스템 레벨");
	if (slice === null) {
		return {
			id: "R17",
			title: "R17 시스템 레벨 상시 인터페이스 표",
			pass: false,
			detail: "시스템 레벨 헤딩(### 시스템 레벨)이 없습니다",
		};
	}
	const missing = STANDING_INTERFACE_TABLE.test(slice) ? [] : [...STANDING_INTERFACE_MARKERS];
	return {
		id: "R17",
		title: "R17 시스템 레벨 상시 인터페이스 표",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `상시 인터페이스 표에 없는 열: ${missing.join(", ")} (경계 | 인터페이스 | 오가는 것 — 엔드포인트·쿼리·화면 URL을 담는다)`
				: "",
	};
}

/** The labels each 컴포넌트 레벨 arch-entity card must carry (R18). */
const COMPONENT_CARD_MARKERS = ["패키지", "책임", "인터페이스", "변경점"] as const;

/** A field row has the label as the first strong child of a paragraph. */
const ARCH_ENTITY_FIELD_ROW =
	/(<p\b[^>]*>)\s*<strong\b[^>]*>\s*([^<]*?)\s*<\/strong>\s*([\s\S]*?)<\/p\s*>/gi;

/** Whether an arch-entity card has a non-empty, independently structured field row. */
function hasArchEntityField(body: string, label: string): boolean {
	const withoutComments = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
	ARCH_ENTITY_FIELD_ROW.lastIndex = 0;
	let row: RegExpExecArray | null = ARCH_ENTITY_FIELD_ROW.exec(withoutComments);
	while (row !== null) {
		const rowLabel = (row[2] ?? "").trim();
		const value = (row[3] ?? "")
			.replace(/<[^>]*>/g, " ")
			.replace(/&(?:nbsp|#160|#xA0);/gi, " ")
			.trim();
		if (rowLabel === label && value.length > 0) return true;
		row = ARCH_ENTITY_FIELD_ROW.exec(withoutComments);
	}
	return false;
}

/** Every authored arch-entity card, including cards with an invalid change kind. */
const ARCH_ENTITY_OPENING_TAG =
	/<([A-Za-z][\w-]*)\b(?=[^>]*\bclass=(["'])(?:[^"'\s]+\s+)*arch-entity(?:\s+[^"'\s]+)*\2)[^>]*>/gi;

/** A renderer-recognized arch-entity opening tag with an allowed change kind. */
const VALID_ARCH_ENTITY_OPENING_TAG =
	/<([A-Za-z][\w-]*)\b(?=[^>]*\bclass=(["'])(?:[^"'\s]+\s+)*arch-entity(?:\s+[^"'\s]+)*\2)(?=[^>]*\bdata-change=(["'])(?:new|mod|del)\3)[^>]*>/gi;

interface ArchEntityCard {
	body: string;
	validDataChange: boolean;
}

function archEntityCards(slice: string): ArchEntityCard[] {
	const cards: ArchEntityCard[] = [];
	ARCH_ENTITY_OPENING_TAG.lastIndex = 0;
	let match: RegExpExecArray | null = ARCH_ENTITY_OPENING_TAG.exec(slice);
	while (match !== null) {
		const tag = match[1];
		if (tag !== undefined) {
			const bodyStart = match.index + match[0].length;
			const close = new RegExp(`</${tag}\\s*>`, "i").exec(slice.slice(bodyStart));
			cards.push({
				body: slice.slice(bodyStart, close === null ? slice.length : bodyStart + close.index),
				validDataChange: /\bdata-change=(["'])(?:new|mod|del)\1/i.test(match[0]),
			});
		}
		match = ARCH_ENTITY_OPENING_TAG.exec(slice);
	}
	return cards;
}

function hasValidArchEntity(slice: string): boolean {
	VALID_ARCH_ENTITY_OPENING_TAG.lastIndex = 0;
	return VALID_ARCH_ENTITY_OPENING_TAG.test(slice);
}

// R18 — the component level, beyond the dependency graph (R9/R12), decodes each
// changed behaviour node with an arch-entity card: its layer, responsibility,
// and interface (functions), plus a change kind. Measured gap: the component
// diagram was bare class names — `CurrentBoostPackInfoCard` alone read as opaque.
function checkR18(text: string): CheckItem {
	const diagramSlice = levelSlice(maskNonVisibleContainers(text), "컴포넌트 레벨");
	const slice = levelSlice(maskNonVisibleMarkdown(text), "컴포넌트 레벨");
	if (slice === null || diagramSlice === null) {
		return {
			id: "R18",
			title: "R18 컴포넌트 레벨 노드 카드",
			pass: false,
			detail: "컴포넌트 레벨 헤딩(### 컴포넌트 레벨)이 없습니다",
		};
	}
	// The diagram-node ban applies whether or not the level is waived — a waiver
	// says "no structural change", not "file paths are fine as nodes".
	const pathNode = diagramFilePathNodes(diagramSlice);
	if (hasArchWaiver(slice) && !pathNode) {
		return { id: "R18", title: "R18 컴포넌트 레벨 노드 카드", pass: true, detail: "" };
	}
	const missing: string[] = [];
	if (pathNode)
		missing.push(
			"다이어그램 노드가 파일 경로 — 컴포넌트 노드는 모듈/개념 이름(피처·유스케이스·훅·서비스)으로 적고, 위치는 카드의 패키지 슬롯에 패키지 단위로 적는다",
		);
	if (!hasArchWaiver(slice)) {
		const cards = archEntityCards(slice);
		if (cards.length === 0) {
			missing.push("arch-entity 카드", "변경종류(data-change: new|mod|del)");
		} else {
			cards.forEach((card, index) => {
				const cardMissing: string[] = COMPONENT_CARD_MARKERS.filter(
					(label) => !hasArchEntityField(card.body, label),
				);
				if (!card.validDataChange) cardMissing.push("변경종류(data-change: new|mod|del)");
				if (cardMissing.length > 0) missing.push(`카드 ${index + 1}: ${cardMissing.join(", ")}`);
			});
		}
	}
	return {
		id: "R18",
		title: "R18 컴포넌트 레벨 노드 카드",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `컴포넌트 노드 카드에 없는 슬롯: ${missing.join(", ")} — 변경 노드마다 arch-entity로 패키지·책임·인터페이스·변경점(이 diff로 무엇이 어떻게 바뀌었나)·변경종류를 적는다`
				: "",
	};
}

/** The labels each 도메인 레벨 arch-entity card must carry (R21). */
const DOMAIN_CARD_MARKERS = ["책임", "핵심 멤버", "변경점"] as const;

// R21 — the domain level, beyond the entity/relation diagram (R9/R12), decodes
// each touched domain object with an arch-entity card: what it is responsible for
// (its 책임 / invariant) and how it changed (data-change). Measured gap: the
// domain level was the thinnest of the three — a bare diagram whose nodes were
// sometimes narrative concepts (`ModelAlias`, `LegacyProductKey`) with no
// responsibility or change kind, so a reader could not tell which domain object
// this diff added or modified, or what it now guarantees. A reasoned
// `구조 변화 없음: <사유>` waiver stands in when the diff changes no domain object.
function checkR21(text: string): CheckItem {
	const diagramSlice = levelSlice(maskNonVisibleContainers(text), "도메인 레벨");
	const slice = levelSlice(maskNonVisibleMarkdown(text), "도메인 레벨");
	if (slice === null || diagramSlice === null) {
		return {
			id: "R21",
			title: "R21 도메인 레벨 엔티티 카드",
			pass: false,
			detail: "도메인 레벨 헤딩(### 도메인 레벨)이 없습니다",
		};
	}
	const missing: string[] = [];
	// The diagram bans hold even under a waiver: an object diagram, if drawn, must
	// name domain concepts (not file paths) and must show each object's members.
	if (diagramFilePathNodes(diagramSlice))
		missing.push(
			"다이어그램 노드가 파일 경로 — 도메인 노드는 실재 비즈니스 개념/엔티티 이름으로 적는다",
		);
	if (classDiagramMissingMembers(diagramSlice))
		missing.push(
			"객체 다이어그램의 클래스 박스가 비어 있음 — 각 객체의 멤버 변수와 메소드(메시지)를 채운다",
		);
	const hasStructuredCoreMemberRow = (body: string): boolean => {
		const withoutComments = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
		ARCH_ENTITY_FIELD_ROW.lastIndex = 0;
		let row: RegExpExecArray | null = ARCH_ENTITY_FIELD_ROW.exec(withoutComments);
		while (row !== null) {
			const classes =
				row[1]?.match(/\sclass\s*=\s*(["'])([^"']*)\1/i)?.[2]?.split(/\s+/) ?? [];
			if (
				classes.includes("ae-members") &&
				(row[2] ?? "").trim() === "핵심 멤버" &&
				[...((row[3] ?? "").matchAll(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi))].some((chip) =>
					hasVisibleCellText(chip[1] ?? ""),
				)
			)
				return true;
			row = ARCH_ENTITY_FIELD_ROW.exec(withoutComments);
		}
		return false;
	};
	const hasNoMembersReason = (body: string): boolean => {
		const withoutComments = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
		ARCH_ENTITY_FIELD_ROW.lastIndex = 0;
		let row: RegExpExecArray | null = ARCH_ENTITY_FIELD_ROW.exec(withoutComments);
		while (row !== null) {
			const rowLabel = (row[2] ?? "").trim();
			const rowText = (row[3] ?? "")
				.replace(/<[^>]*>/g, " ")
				.replace(/&(?:nbsp|#160|#xA0);/gi, " ")
				.trim();
			if (rowLabel === "핵심 멤버 없음" && /^—\s*\S/.test(rowText)) return true;
			row = ARCH_ENTITY_FIELD_ROW.exec(withoutComments);
		}
		return false;
	};
	if (!hasArchWaiver(slice)) {
		const cards = archEntityCards(slice);
		if (cards.length === 0) {
			missing.push("arch-entity 카드", "변경종류(data-change: new|mod|del)");
		} else {
			cards.forEach((card, index) => {
				const cardMissing: string[] = [];
				for (const label of DOMAIN_CARD_MARKERS) {
					if (label === "핵심 멤버") {
						if (!hasStructuredCoreMemberRow(card.body) && !hasNoMembersReason(card.body))
							cardMissing.push(label);
					} else if (!hasArchEntityField(card.body, label)) {
						cardMissing.push(label);
					}
				}
				if (!card.validDataChange) cardMissing.push("변경종류(data-change: new|mod|del)");
				if (cardMissing.length > 0) missing.push(`카드 ${index + 1}: ${cardMissing.join(", ")}`);
			});
		}
	}
	return {
		id: "R21",
		title: "R21 도메인 레벨 엔티티 카드",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `도메인 엔티티 카드에 없는 슬롯: ${missing.join(", ")} — 이 diff가 건드린 도메인 객체마다 arch-entity로 책임(불변식·보유 비즈니스 로직 산문)·핵심 멤버(코드 칩 나열, 없으면 "핵심 멤버 없음 — <사유>")·변경점(무엇이 이번에 추가/변경됐나)·변경종류를 적는다(서사용 가짜 개념이 아니라 실재 도메인 객체)`
				: "",
	};
}

/**
 * Methodology proper names R19 forbids in the rendered Architecture prose. The
 * boundary vocabulary follows the architecture-boundaries rule, but the OUTPUT
 * must speak the codebase's own domain terms — a reader learns the change, not a
 * framework. The plain word `유스케이스`/`도메인` is legitimate (the block heading
 * uses it); only the framework names below leak methodology and are banned.
 */
const METHODOLOGY_TOKENS = [
	"FSD",
	"Feature-Sliced",
	"Clean Architecture",
	"Clean-arch",
	"DDD",
	"Domain-Driven",
	"bounded context",
] as const;

/**
 * Layer-axis labels R19 also forbids. Measured (luna max): the boundary block's
 * "닿은 곳" line reintroduced `수평: … 수직: …`, the exact static-classification
 * framing the boundary rewrite (R15) removed. The block must map what this diff
 * touched in the codebase's own domain terms, not sort parts into a horizontal /
 * vertical grid — so the bare axis words leak the same methodology framing the
 * proper names do, and are banned in the Architecture prose too.
 */
const AXIS_LABEL_TOKENS = ["수평", "수직"] as const;

function hasStandaloneToken(text: string, token: string): boolean {
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const identifierChars = /^[A-Za-z]/.test(token) ? "A-Za-z0-9_" : "\\p{L}\\p{N}_";
	return new RegExp(`(?<![${identifierChars}])${escaped}(?![${identifierChars}])`, "iu").test(text);
}

// R19 — no methodology name OR layer-axis label leaks into the Architecture
// prose. Read on the fence- and inline-code-stripped Architecture section so
// examples and identifiers do not count as rendered prose.
function checkR19(text: string): CheckItem {
	const slice = sectionSlice(maskFenced(text), "Architecture");
	if (slice === null) {
		return {
			id: "R19",
			title: "R19 방법론 명칭·축 라벨 비노출",
			pass: false,
			detail: "## Architecture 섹션이 없습니다",
		};
	}
	const prose = withoutMarkdownCode(slice);
	const found = [
		...METHODOLOGY_TOKENS.filter((t) => hasStandaloneToken(prose, t)),
		...AXIS_LABEL_TOKENS.filter((t) => hasStandaloneToken(prose, t)),
	];
	return {
		id: "R19",
		title: "R19 방법론 명칭·축 라벨 비노출",
		pass: found.length === 0,
		detail:
			found.length > 0
				? `Architecture 산문에 방법론 명칭·축 라벨이 노출됨: ${found.join(", ")} — 코드베이스 실제 도메인 어휘로 바꾼다(수평/수직 축 분류 대신 닿은 곳을 도메인 이름으로)`
				: "",
	};
}

/** The slice from a level-two heading to the next level-one or level-two heading. */
function sectionSlice(text: string, heading: string): string | null {
	const m = new RegExp(`^##\\s+${heading}.*$`, "m").exec(text);
	if (!m) return null;
	const start = m.index + m[0].length;
	const next = text.slice(start).search(/^#{1,2}\s/m);
	return next >= 0 ? text.slice(start, start + next) : text.slice(start);
}

// R10 — the commit overview. With two or more commits every commit's short hash
// must appear in the `## Commit Journey` overview (a one-line-per-commit map to
// its group); a single-commit range may waive the section with the marker.
function checkR10(text: string, commitHashes: string[] | undefined): CheckItem {
	const hashes = commitHashes ?? [];
	const journey = sectionSlice(text, "Commit Journey");
	const hasJourney = journey !== null;
	const hasSingleWaiver = /단일 커밋 범위/.test(text);
	const body = withoutFencedCode(journey ?? "");

	let problems: string[] = [];
	if (hashes.length >= 2) {
		if (!hasJourney) {
			problems.push("## Commit Journey 오버뷰 섹션이 없습니다");
		} else {
			const missing = hashes.filter((h) => !body.includes(h.slice(0, 7)));
			if (missing.length > 0)
				problems.push(`오버뷰에 등장하지 않는 커밋: ${missing.map((h) => h.slice(0, 7)).join(", ")}`);
		}
	} else {
		if (!hasJourney && !hasSingleWaiver) {
			problems = [
				'Commit Journey 오버뷰 섹션도, 단일 커밋 생략 마커("단일 커밋 범위 — Commit Journey 생략")도 없습니다',
			];
		}
	}
	return {
		id: "R10",
		title: "R10 Commit Journey 오버뷰",
		pass: problems.length === 0,
		detail: problems.join(" / "),
	};
}

// R13 — the commit-spined walkthrough. Each Change Group holds at least one
// commit subsection whose hash is a real range commit, and each change block
// carries one core-logic code fence. Measured baseline: the code section sat
// disconnected from the commit history, and change blocks pointed at line
// numbers without ever showing the logic.
function checkR13(
	text: string,
	blocks: Array<{ heading: string; body: string }>,
	commitHashes: string[] | undefined,
): CheckItem {
	const groups = groupSlices(text);
	const known = commitHashes ?? [];
	const problems: string[] = [];
	if (groups.length === 0) {
		problems.push("커밋 뼈대를 검사할 Change Group이 없습니다");
	}
	for (const g of groups) {
		const masked = maskFenced(g.body);
		const heads = collect(new RegExp(COMMIT_SUBSECTION.source, "gm"), masked);
		if (heads.length === 0) {
			problems.push(`${g.title}: 커밋 서브섹션(### \`hash\` — 제목)이 없습니다`);
			continue;
		}
		// Only validate hashes when enumeration succeeded — an empty known set is
		// "git failed", not "every hash is fake".
		if (known.length > 0) {
			const bogus = heads.filter((h) => !known.some((c) => c.startsWith(h)));
			if (bogus.length > 0) problems.push(`${g.title}: 범위에 없는 커밋 해시 ${bogus.join(", ")}`);
		}
	}
	if (blocks.length === 0) problems.push("변경 블록(#### 변경 N: …)이 하나도 없습니다");
	const noCode = blocks.filter((b) => !hasCoreCodeFence(b.body)).map((b) => b.heading);
	if (noCode.length > 0)
		problems.push(`핵심 로직 코드 펜스(mermaid·빈 펜스 제외)가 없는 변경: ${noCode.join(", ")}`);
	return {
		id: "R13",
		title: "R13 커밋 뼈대 + 핵심 로직 코드",
		pass: problems.length === 0,
		detail: problems.join(" / "),
	};
}

/**
 * The component classes render.ts ships CSS for. Anything outside this set is
 * styling the renderer does not know, i.e. an invented visual language.
 */
const SANCTIONED_CLASSES = new Set([
	"flow",
	"flow-step",
	"flow-arrow",
	"compare",
	"compare-before",
	"compare-after",
	"callout",
	"doc-meta",
	"diagram",
	"cf",
	"cf-src",
	"cf-loc",
	"arch-entity",
	"ae-members",
	"chg",
]);

// R11 — the document authors content, the renderer owns presentation.
function checkR11(text: string): CheckItem {
	const prose = withoutMarkdownCode(text);
	const problems: string[] = [];
	if (/<style/i.test(prose)) problems.push("<style> 블록은 금지입니다 — 스타일은 render.ts가 소유합니다");
	if (/style\s*=\s*["']/i.test(prose)) problems.push('인라인 style="…" 속성은 금지입니다 — 승인된 컴포넌트 클래스를 쓰세요');
	const unknown = new Set<string>();
	for (const m of prose.matchAll(/class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
		for (const cls of (m[1] ?? m[2] ?? "").split(/\s+/).filter(Boolean)) {
			if (!SANCTIONED_CLASSES.has(cls)) unknown.add(cls);
		}
	}
	if (unknown.size > 0)
		problems.push(
			`승인 목록 밖의 class: ${[...unknown].sort().join(", ")} (허용: ${[...SANCTIONED_CLASSES].sort().join(", ")})`,
		);
	return {
		id: "R11",
		title: "R11 스타일 발명 금지",
		pass: problems.length === 0,
		detail: problems.join(" / "),
	};
}

export function checkStructure(text: string, input: StructureInput): StructureResult {
	const items: CheckItem[] = [];
	const blocks = changeBlocks(text);

	switch (input.step) {
		case "evidence":
			items.push(checkR1Listing(text, input.signalFiles));
			break;
		case "background":
			items.push(checkR4(text));
			break;
		case "goal":
			items.push(checkR16(text));
			break;
		case "architecture":
			items.push(checkR9(text));
			items.push(checkR14(text));
			items.push(checkR15(text));
			items.push(checkR17(text));
			items.push(checkR18(text));
			items.push(checkR19(text));
			items.push(checkR21(text));
			break;
		case "intuition":
			// No slot of its own — R6 (the judge) is its rubric coverage; the
			// only script item here is the cumulative style ban below.
			break;
		case "commits":
			items.push(checkR10(text, input.commitHashes));
			break;
		case "code":
			items.push(checkR2(text));
			items.push(checkR3(blocks));
			items.push(checkR5(blocks, input.signalFiles, input.addedFiles, input.diffHunks));
			items.push(checkR1Coverage(blocks, input.signalFiles));
			items.push(checkR13(text, blocks, input.commitHashes));
			items.push(checkR22(text, input.sourceCorpus));
			break;
		case "render":
		case "quiz":
			// Neither reaches this function in production: `render` is scored by
			// checkRenderOutput (explain-diff-state.ts), `quiz` by a separate
			// grading path.
			throw new Error(`checkStructure는 '${input.step}' 스텝을 채점하지 않습니다`);
		default:
			throw new Error(`알 수 없는 step 값: ${String(input.step)}`);
	}

	// R11 runs at every authoring step over the cumulative document.
	items.push(checkR11(text));

	const failedItems = items.filter((i) => !i.pass).map((i) => `${i.title}: ${i.detail}`);
	return { pass: failedItems.length === 0, items, failedItems };
}
