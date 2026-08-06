/**
 * explain-diff structural checks — rubric items R1..R5.
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
 */

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
}

export interface CheckItem {
	id: "R1" | "R2" | "R3" | "R4" | "R5";
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

export function checkStructure(text: string, input: StructureInput): StructureResult {
	const items: CheckItem[] = [];
	const blocks = fileBlocks(text);

	// R1 — every signal file reachable. The empty signal set fails rather than
	// passing vacuously: "no files to cover" is a classification bug upstream,
	// not a document that covered everything.
	const missing = input.signalFiles.filter((p) => !text.includes(p));
	items.push({
		id: "R1",
		title: "R1 signal 파일 전수 등장",
		pass: input.signalFiles.length > 0 && missing.length === 0,
		detail:
			input.signalFiles.length === 0
				? "signal 파일이 하나도 분류되지 않았습니다 — evidence 스텝의 분류표를 확인하세요."
				: missing.length > 0
					? `문서에 등장하지 않는 파일: ${missing.join(", ")}`
					: "",
	});

	// R2 — the three slots of a Change Group. Measured RED: 0/16 documents
	// produced a named group at all, even when the prompt asked for grouping in
	// prose, which is why this is a slot check rather than an instruction.
	const groups = collect(new RegExp(GROUP_HEADING.source, "gm"), text);
	const heralds = (text.match(/^>\s*예고\s*:/gm) || []).length;
	const orders = (text.match(/^>\s*순서\s*:/gm) || []).length;
	const r2Missing: string[] = [];
	if (groups.length === 0) r2Missing.push("Change Group 제목");
	if (heralds < groups.length || heralds === 0) r2Missing.push("예고 슬롯");
	if (orders < groups.length || orders === 0) r2Missing.push("순서 근거 슬롯");
	items.push({
		id: "R2",
		title: "R2 Change Group 구조",
		pass: r2Missing.length === 0,
		detail: r2Missing.length > 0 ? `채워지지 않은 슬롯: ${r2Missing.join(", ")}` : "",
	});

	// R3 — provenance on every "왜". Not "don't explain why": the measured
	// baselines were often right about why, and one was verifiably grounded in a
	// diff comment. What none of them did was say WHERE the why came from.
	const unmarked = blocks
		.filter((b) => /\*\*왜 필요한가\*\*/.test(b.body))
		.filter((b) => {
			const why = b.body.slice(b.body.search(/\*\*왜 필요한가\*\*/));
			const end = why.search(/\n\*\*/);
			return !WHY_MARKERS.test(end >= 0 ? why.slice(0, end) : why);
		})
		.map((b) => b.path);
	const noWhy = blocks.filter((b) => !/\*\*왜 필요한가\*\*/.test(b.body)).map((b) => b.path);
	items.push({
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
	});

	// R4 — two-tier background with a skip marker. RED: gist 8/8, no-guidance
	// 0/8. This is the one item the original prompt already solves; the slot
	// exists to keep it from regressing, not to teach it.
	const hasDeep = /###\s*깊은 배경/.test(text);
	const hasNarrow = /###\s*좁은 배경/.test(text);
	const hasSkip = /(건너뛰|이미 (아는|익숙)|already familiar)/.test(text);
	const r4Missing = [
		hasDeep ? "" : "깊은 배경",
		hasNarrow ? "" : "좁은 배경",
		hasSkip ? "" : "건너뛰기 마커",
	].filter(Boolean);
	items.push({
		id: "R4",
		title: "R4 Background 2단 + 건너뛰기 마커",
		pass: r4Missing.length === 0,
		detail: r4Missing.length > 0 ? `없는 요소: ${r4Missing.join(", ")}` : "",
	});

	// R5 — both endpoints of the move. A document that only points at the new
	// location cannot answer "what was there before", which is the question a
	// refactor diff turns on. An ADDED file is the one case where that question
	// has no answer, so it is asked for the head anchor alone — measured: the two
	// GREEN documents that failed this item failed it entirely on added files,
	// which no honest author could have satisfied.
	const addedSet = new Set(input.addedFiles ?? []);
	const noAnchor = blocks
		.filter((b) => {
			const head = /`head:[^`]+`/.test(b.body);
			if (addedSet.has(b.path)) return !head;
			return !(head && /`base:[^`]+`/.test(b.body));
		})
		.map((b) => b.path);
	items.push({
		id: "R5",
		title: "R5 추적성",
		pass: blocks.length > 0 && noAnchor.length === 0,
		detail:
			blocks.length === 0
				? "파일 블록이 하나도 없습니다."
				: noAnchor.length > 0
					? `base/head 위치가 모두 있지 않은 파일: ${noAnchor.join(", ")}`
					: "",
	});

	const failedItems = items.filter((i) => !i.pass).map((i) => `${i.title}: ${i.detail}`);
	return { pass: failedItems.length === 0, items, failedItems };
}
