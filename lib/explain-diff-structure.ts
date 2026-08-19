/**
 * explain-diff structural checks — rubric items R1..R5 and R9..R11.
 *
 * These are the half of the rubric a script can decide, and the split is
 * deliberate (see skills/explain-diff/references/rubric.md): absence is
 * countable, so counting it is not left to a model. Every threshold here traces
 * to a measured baseline, not to a guess — the 16-run RED matrix is what said
 * which of these ever appear on their own.
 *
 * The document format these predicates read is a contract, not a preference.
 * Each check looks for a named slot; a section that fills the slots passes, and
 * one that does not names the missing slot back to the author.
 *
 * The document is written incrementally, one step at a time, so a rubric item
 * only ever has its slot filled once the step that owns it has been reached.
 * `step` scopes evaluation to the items that step's slots can possibly satisfy
 * — the alternative (always running R1..R5) fails every step before the last
 * one on slots it hasn't been asked to fill yet.
 */

import type { Step } from "@lib/explain-diff-core";

export interface StructureInput {
	/** Changed files classified as signal — every one must appear exactly once. */
	signalFiles: string[];
	/**
	 * Signal files the diff ADDED. These have no base location to point at, so
	 * R5 asks them for the head anchor only. Taken from `git diff --name-status`
	 * rather than from a phrase in the document: "this file is new" is a fact the
	 * diff already answers exactly, and reading it from the prose would let an
	 * author opt out of the base anchor by asserting it.
	 */
	addedFiles?: string[];
	/**
	 * Short (or full) hashes of the commits in the explained range, oldest
	 * first, as captured at `start`. Empty means enumeration failed — the R10
	 * check then degrades to section presence without per-hash verification.
	 */
	commitHashes?: string[];
	/** Which step's document just closed — decides which items below run. */
	step: Step;
}

export interface CheckItem {
	id: "R1" | "R2" | "R3" | "R4" | "R5" | "R9" | "R10" | "R11";
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
const FILE_BLOCK = /^###\s+`([^`]+)`\s*$/gm;

/** The three provenance markers a "왜" block may carry. Anything else is a flat assertion. */
const WHY_MARKERS = /(\[근거:|\[추론:|Unknown\s*\/\s*not supplied)/;

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

/** The slice of `text` belonging to one file block: from its heading to the next heading. */
function fileBlocks(text: string): Array<{ path: string; body: string }> {
	const out: Array<{ path: string; body: string }> = [];
	const re = new RegExp(FILE_BLOCK.source, "gm");
	const marks: Array<{ path: string; start: number }> = [];
	let m: RegExpExecArray | null = re.exec(text);
	while (m !== null) {
		const captured = m[1];
		if (captured !== undefined) marks.push({ path: captured, start: m.index + m[0].length });
		m = re.exec(text);
	}
	for (const mark of marks) {
		const next = text.slice(mark.start).search(/^#{2,3}\s/m);
		const end = next >= 0 ? mark.start + next : text.length;
		out.push({ path: mark.path, body: text.slice(mark.start, end) });
	}
	return out;
}

// R1, listing form (evidence step) — every signal file appears somewhere in
// the document. The empty signal set fails rather than passing vacuously: "no
// files to cover" is a classification bug upstream, not a document that
// covered everything. This is the only item evidence can satisfy — the
// Change Group slots R1's other form checks don't exist yet at this step.
function checkR1Listing(text: string, signalFiles: string[]): CheckItem {
	const missing = signalFiles.filter((p) => !text.includes(p));
	return {
		id: "R1",
		title: "R1 signal 파일 전수 등장 (등재형)",
		pass: signalFiles.length > 0 && missing.length === 0,
		detail:
			signalFiles.length === 0
				? "signal 파일이 하나도 분류되지 않았습니다 — evidence 스텝의 분류표를 확인하세요."
				: missing.length > 0
					? `문서에 등장하지 않는 파일: ${missing.join(", ")}`
					: "",
	};
}

// R1, coverage form (code step) — every signal file has exactly one Change
// Group file block. A string search on the whole document (the listing form
// above) is satisfied forever by the evidence table alone, so by the time
// Change Groups exist this item has to look at the blocks themselves: zero
// occurrences means the file never made it into a group, two or more means
// it landed in more than one — SKILL.md's "정확히 한 그룹에 한 번" is what
// this enforces.
function checkR1Coverage(blocks: Array<{ path: string }>, signalFiles: string[]): CheckItem {
	const counts = new Map<string, number>();
	for (const b of blocks) counts.set(b.path, (counts.get(b.path) ?? 0) + 1);
	const zero = signalFiles.filter((p) => (counts.get(p) ?? 0) === 0);
	const dup = signalFiles.filter((p) => (counts.get(p) ?? 0) >= 2);
	const details: string[] = [];
	if (zero.length > 0) details.push(`Change Group에 등장하지 않는 파일: ${zero.join(", ")}`);
	if (dup.length > 0) details.push(`여러 그룹에 중복 등장한 파일: ${dup.join(", ")}`);
	return {
		id: "R1",
		title: "R1 signal 파일 Change Group 커버리지 (커버리지형)",
		pass: signalFiles.length > 0 && details.length === 0,
		detail:
			signalFiles.length === 0
				? "signal 파일이 하나도 분류되지 않았습니다 — evidence 스텝의 분류표를 확인하세요."
				: details.join(" / "),
	};
}

// R2 — the three slots of a Change Group. Measured RED: 0/16 documents
// produced a named group at all, even when the prompt asked for grouping in
// prose, which is why this is a slot check rather than an instruction.
function checkR2(text: string): CheckItem {
	const groups = collect(new RegExp(GROUP_HEADING.source, "gm"), text);
	const heralds = (text.match(/^>\s*예고\s*:/gm) || []).length;
	const orders = (text.match(/^>\s*순서\s*:/gm) || []).length;
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

// R3 — provenance on every "왜". Not "don't explain why": the measured
// baselines were often right about why, and one was verifiably grounded in a
// diff comment. What none of them did was say WHERE the why came from.
function checkR3(blocks: Array<{ path: string; body: string }>): CheckItem {
	const unmarked = blocks
		.filter((b) => /\*\*왜 필요한가\*\*/.test(b.body))
		.filter((b) => {
			const why = b.body.slice(b.body.search(/\*\*왜 필요한가\*\*/));
			const end = why.search(/\n\*\*/);
			return !WHY_MARKERS.test(end >= 0 ? why.slice(0, end) : why);
		})
		.map((b) => b.path);
	const noWhy = blocks.filter((b) => !/\*\*왜 필요한가\*\*/.test(b.body)).map((b) => b.path);
	return {
		id: "R3",
		title: "R3 왜의 출처 표시",
		pass: blocks.length > 0 && unmarked.length === 0 && noWhy.length === 0,
		detail:
			blocks.length === 0
				? "파일 블록이 하나도 없습니다."
				: noWhy.length > 0
					? `"왜 필요한가" 블록이 없는 파일: ${noWhy.join(", ")}`
					: unmarked.length > 0
						? `출처 표시([근거:] / [추론:] / Unknown / not supplied) 없이 단정한 파일: ${unmarked.join(", ")}`
						: "",
	};
}

// R4 — two-tier background with a skip marker. RED: gist 8/8, no-guidance
// 0/8. This is the one item the original prompt already solves; the slot
// exists to keep it from regressing, not to teach it.
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

// R5 — both endpoints of the move. A document that only points at the new
// location cannot answer "what was there before", which is the question a
// refactor diff turns on. An ADDED file is the one case where that question
// has no answer, so it is asked for the head anchor alone — measured: the two
// GREEN documents that failed this item failed it entirely on added files,
// which no honest author could have satisfied.
function checkR5(blocks: Array<{ path: string; body: string }>, addedFiles: string[] | undefined): CheckItem {
	const addedSet = new Set(addedFiles ?? []);
	const noAnchor = blocks
		.filter((b) => {
			const head = /`head:[^`]+`/.test(b.body);
			if (addedSet.has(b.path)) return !head;
			return !(head && /`base:[^`]+`/.test(b.body));
		})
		.map((b) => b.path);
	return {
		id: "R5",
		title: "R5 추적성",
		pass: blocks.length > 0 && noAnchor.length === 0,
		detail:
			blocks.length === 0
				? "파일 블록이 하나도 없습니다."
				: noAnchor.length > 0
					? `base/head 위치가 모두 있지 않은 파일: ${noAnchor.join(", ")}`
					: "",
	};
}

// ---------------------------------------------------------------------------
// v3 items — measured RED (12 documents produced by the pre-v3 skill: 10
// fixture runs + 2 production artifacts): architecture sections 0/12, a
// guaranteed commit journey 0/12, and 11/12 invented their own styling (3..78
// inline style attributes; two production documents each shipped a different
// hand-written <style> block). These are slot checks for the same reason
// R2 is: prose instructions did not produce the slots.

/** Levels the Architecture section must cover, each with a diagram or an explicit waiver. */
const ARCH_LEVELS = ["시스템 레벨", "컴포넌트 레벨", "도메인 레벨"] as const;

/** A waived level must say WHY in the same line — a bare marker is an opt-out, not a claim. */
const ARCH_WAIVER = /구조 변화 없음\s*[:：—-]\s*\S/;

/** The slice of `text` from a `### <level>` heading to the next heading of depth <= 3. */
function levelSlice(text: string, level: string): string | null {
	const re = new RegExp(`^###\\s*${level}.*$`, "m");
	const m = re.exec(text);
	if (!m) return null;
	const start = m.index + m[0].length;
	const next = text.slice(start).search(/^#{2,3}\s/m);
	return next >= 0 ? text.slice(start, start + next) : text.slice(start);
}

// R9 — the three architecture levels. Each must carry a mermaid diagram or a
// reasoned waiver; a level that is merely prose has answered neither "what
// does the structure look like" nor "why is there nothing to draw".
function checkR9(text: string): CheckItem {
	const problems: string[] = [];
	for (const level of ARCH_LEVELS) {
		const slice = levelSlice(text, level);
		if (slice === null) {
			problems.push(`${level} 헤딩(### ${level})이 없습니다`);
			continue;
		}
		const hasDiagram = /```mermaid/.test(slice);
		if (!hasDiagram && !ARCH_WAIVER.test(slice)) {
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

// R10 — the commit journey. With two or more commits every commit's hash must
// head its own block; a single-commit range may waive the section with the
// explicit marker instead, because a one-entry journey restates the document.
function checkR10(text: string, commitHashes: string[] | undefined): CheckItem {
	const hashes = commitHashes ?? [];
	const hasJourney = /^##\s+Commit Journey/m.test(text);
	const hasSingleWaiver = /단일 커밋 범위/.test(text);
	const headings = collect(/^###\s+.*$/gm, text);

	let problems: string[] = [];
	if (hashes.length >= 2) {
		if (!hasJourney) {
			problems.push("## Commit Journey 섹션이 없습니다");
		} else {
			const missing = hashes.filter((h) => {
				const short = h.slice(0, 7);
				return !headings.some((line) => line.includes(short));
			});
			if (missing.length > 0)
				problems.push(`헤딩에 등장하지 않는 커밋: ${missing.map((h) => h.slice(0, 7)).join(", ")}`);
		}
	} else {
		// One commit, or enumeration failed: the journey may be waived, but
		// silence may not — the reader must be told which of the two happened.
		if (!hasJourney && !hasSingleWaiver) {
			problems = [
				'Commit Journey 섹션도, 단일 커밋 생략 마커("단일 커밋 범위 — Commit Journey 생략")도 없습니다',
			];
		}
	}
	return {
		id: "R10",
		title: "R10 Commit Journey",
		pass: problems.length === 0,
		detail: problems.join(" / "),
	};
}

/**
 * The component classes render.ts ships CSS for. Anything outside this set is
 * styling the renderer does not know, i.e. an invented visual language — the
 * exact failure the measured baselines produced 11/12 times.
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
]);

// R11 — the document authors content, the renderer owns presentation. Checked
// cumulatively at every authoring step so a violation is named at the step
// that introduced it, not discovered at render.
function checkR11(text: string): CheckItem {
	const problems: string[] = [];
	if (/<style/i.test(text)) problems.push("<style> 블록은 금지입니다 — 스타일은 render.ts가 소유합니다");
	if (/style\s*=\s*"/i.test(text)) problems.push('인라인 style="…" 속성은 금지입니다 — 승인된 컴포넌트 클래스를 쓰세요');
	const unknown = new Set<string>();
	for (const m of text.matchAll(/class\s*=\s*"([^"]*)"/gi)) {
		for (const cls of (m[1] ?? "").split(/\s+/).filter(Boolean)) {
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
	const blocks = fileBlocks(text);

	// Each step only closes the slots its own instructions ask for — running
	// every item on every step is what let R2..R5 fail evidence before the
	// author was ever told to fill them. The switch is exhaustive over `Step`
	// on purpose: a step this function doesn't recognize is not "no items to
	// check", it is a caller bug (a step never passed, a typo, an upstream
	// contract drift) — and the old fall-through-to-empty-array shape is
	// exactly what let a whole document pass with zero items evaluated.
	switch (input.step) {
		case "evidence":
			items.push(checkR1Listing(text, input.signalFiles));
			break;
		case "background":
			items.push(checkR4(text));
			break;
		case "architecture":
			items.push(checkR9(text));
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
			items.push(checkR5(blocks, input.addedFiles));
			items.push(checkR1Coverage(blocks, input.signalFiles));
			break;
		case "render":
		case "quiz":
			// Neither reaches this function in production: `render` is scored by
			// checkRenderOutput (explain-diff-state.ts), `quiz` by a separate
			// grading path. A caller landing here for either is passing the wrong
			// step, not exercising an empty-but-valid case.
			throw new Error(`checkStructure는 '${input.step}' 스텝을 채점하지 않습니다`);
		default:
			// Anything outside the eight known steps is corrupted input, not an
			// unhandled-but-legitimate case — the same "조용한 pass:true" failure
			// mode this switch exists to close, now for values Step can't even name.
			throw new Error(`알 수 없는 step 값: ${String(input.step)}`);
	}

	// R11 runs at every authoring step over the cumulative document, so an
	// invented style is rejected by the step that wrote it.
	items.push(checkR11(text));

	const failedItems = items.filter((i) => !i.pass).map((i) => `${i.title}: ${i.detail}`);
	return { pass: failedItems.length === 0, items, failedItems };
}
