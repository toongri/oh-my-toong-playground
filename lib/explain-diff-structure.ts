/**
 * explain-diff structural checks — rubric items R1..R5, R9..R11, R13..R14.
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
 * v4 spine: the code section is organized by COMMIT. A Change Group (concern)
 * holds commit subsections (`### \`hash\` — title`), each commit holds file
 * blocks (`#### \`file\``), and each file block separates its fields with the
 * `cf` component and carries one core-logic code fence. R13 enforces that spine.
 *
 * The document is written incrementally, one step at a time, so a rubric item
 * only ever has its slot filled once the step that owns it has been reached.
 * `step` scopes evaluation to the items that step's slots can possibly satisfy.
 */

import type { Step } from "@lib/explain-diff-core";

export interface StructureInput {
	/** Changed files classified as signal — every one must appear exactly once. */
	signalFiles: string[];
	/**
	 * Signal files the diff ADDED. These have no base location to point at, so
	 * R5 asks them for the head anchor only. Taken from `git diff --name-status`
	 * rather than from a phrase in the document.
	 */
	addedFiles?: string[];
	/**
	 * Short (or full) hashes of the commits in the explained range, oldest
	 * first, as captured at `start`. Empty means enumeration failed — R10 then
	 * degrades to section presence, and R13's hash-validity check is skipped.
	 */
	commitHashes?: string[];
	/** Which step's document just closed — decides which items below run. */
	step: Step;
}

export interface CheckItem {
	id: "R1" | "R2" | "R3" | "R4" | "R5" | "R9" | "R10" | "R11" | "R13" | "R14";
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
// 파일 블록은 h4다 — h3(### `hash` — 제목)은 커밋 서브섹션이라 파일이 아니다.
// 백틱 뒤 괄호 주석(`(삭제)`, `(→ 새 경로)` 등)은 정당한 표기 — 경로 캡처에서 제외하고 허용.
const FILE_BLOCK = /^####\s+`([^`]+)`(?:\s+\([^)]*\))?\s*$/gm;
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

/** Fenced code with its info string and body captured, so a mermaid-only or
 *  empty fence can be told apart from an actual core-logic fence. */
const CODE_FENCE = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^(?:`{3,}|~{3,})[^\n]*$/gm;

/**
 * A file block satisfies R13's core-logic requirement only with a fence that is
 * NOT a mermaid diagram and is NOT empty. The template reserves mermaid for
 * diagrams and requires real code/pseudocode per file, so a mermaid-only or
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
 * is what lets file blocks carry code fences without a `##` comment line inside
 * the fence truncating the block early.
 */
function maskFenced(text: string): string {
	return text.replace(FENCE_RE, (m) => m.replace(/[^\n]/g, " "));
}

/** Removes fenced and inline Markdown code, which can describe styles without applying them. */
function withoutMarkdownCode(text: string): string {
	return withoutFencedCode(text).replace(/`+[^`\n]*`+/g, "");
}

/** The slice of `text` belonging to one file block: from its heading to the next heading. */
function fileBlocks(text: string): Array<{ path: string; body: string }> {
	const masked = maskFenced(text);
	const out: Array<{ path: string; body: string }> = [];
	const re = new RegExp(FILE_BLOCK.source, "gm");
	const marks: Array<{ path: string; start: number }> = [];
	let m: RegExpExecArray | null = re.exec(masked);
	while (m !== null) {
		const captured = m[1];
		if (captured !== undefined) marks.push({ path: captured, start: m.index + m[0].length });
		m = re.exec(masked);
	}
	for (const mark of marks) {
		const next = masked.slice(mark.start).search(/^#{2,4}\s/m);
		const end = next >= 0 ? mark.start + next : text.length;
		out.push({ path: mark.path, body: text.slice(mark.start, end) });
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

// R1, listing form (evidence step) — every signal file appears somewhere in
// the document. The empty signal set fails rather than passing vacuously.
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

// R1, coverage form (code step) — every signal file has exactly one file block.
function checkR1Coverage(blocks: Array<{ path: string }>, signalFiles: string[]): CheckItem {
	const counts = new Map<string, number>();
	for (const b of blocks) counts.set(b.path, (counts.get(b.path) ?? 0) + 1);
	const zero = signalFiles.filter((p) => (counts.get(p) ?? 0) === 0);
	const dup = signalFiles.filter((p) => (counts.get(p) ?? 0) >= 2);
	const details: string[] = [];
	if (zero.length > 0) details.push(`파일 블록에 등장하지 않는 파일: ${zero.join(", ")}`);
	if (dup.length > 0) details.push(`여러 그룹에 중복 등장한 파일: ${dup.join(", ")}`);
	return {
		id: "R1",
		title: "R1 signal 파일 파일 블록 커버리지 (커버리지형)",
		pass: signalFiles.length > 0 && details.length === 0,
		detail:
			signalFiles.length === 0
				? "signal 파일이 하나도 분류되지 않았습니다 — evidence 스텝의 분류표를 확인하세요."
				: details.join(" / "),
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

// R3 — provenance on every 왜. Not "don't explain why": say WHERE the why came
// from. Read on the code-stripped body so a `[근거:]` inside a code comment can
// not stand in for the file block's actual 왜 field.
function checkR3(blocks: Array<{ path: string; body: string }>): CheckItem {
	const bodies = blocks.map((b) => ({ path: b.path, body: withoutFencedCode(b.body) }));
	const unmarked = bodies
		.filter((b) => WHY_PARAGRAPH.test(b.body))
		.filter((b) => {
			const m = b.body.match(WHY_PARAGRAPH);
			return m === null || !PROVENANCE.test(m[0]);
		})
		.map((b) => b.path);
	const noWhy = bodies.filter((b) => !WHY_PARAGRAPH.test(b.body)).map((b) => b.path);
	return {
		id: "R3",
		title: "R3 왜의 출처 표시",
		pass: blocks.length > 0 && unmarked.length === 0 && noWhy.length === 0,
		detail:
			blocks.length === 0
				? "파일 블록이 하나도 없습니다."
				: noWhy.length > 0
					? `"왜" 필드가 없는 파일: ${noWhy.join(", ")}`
					: unmarked.length > 0
						? `출처 태그(cf-src / [근거:] / [추론:] / Unknown) 없이 단정한 파일: ${unmarked.join(", ")}`
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

// R5 — both endpoints of the move (base:/head: anchors in the cf-loc slot). An
// ADDED file is asked for the head anchor alone. Read on the code-stripped body.
function checkR5(blocks: Array<{ path: string; body: string }>, addedFiles: string[] | undefined): CheckItem {
	const addedSet = new Set(addedFiles ?? []);
	const noAnchor = blocks
		.filter((b) => {
			const body = withoutFencedCode(b.body);
			const head = /head:\S/.test(body);
			if (addedSet.has(b.path)) return !head;
			return !(head && /base:\S/.test(body));
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

/** Levels the Architecture section must cover, each with a diagram or an explicit waiver. */
const ARCH_LEVELS = ["시스템 레벨", "컴포넌트 레벨", "도메인 레벨"] as const;

/** A waived level must say WHY in the same line — a bare marker is an opt-out, not a claim. */
const ARCH_WAIVER = /구조 변화 없음\s*[:：—-]\s*\S/;

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

// R9 — the three architecture levels, each with a mermaid diagram or a reasoned waiver.
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

/**
 * An axis passes only when it labels a table row whose value cell is non-empty.
 * Reads the row `| <axis> | <value> |`: finds the axis cell and checks the next
 * cell has content. A `변경 없음: <사유>` value counts (it is non-empty). An axis
 * mentioned only in prose, or with a blank value cell, does not.
 */
function axisHasValue(slice: string, axis: string): boolean {
	for (const line of slice.split("\n")) {
		if (!line.includes("|") || !line.includes(axis)) continue;
		const cells = line.split("|").map((c) => c.trim());
		const idx = cells.findIndex((c) => c.includes(axis));
		if (idx < 0 || idx + 1 >= cells.length) continue;
		const value = cells[idx + 1] ?? "";
		if (value === "") continue;
		// A bare no-change marker with no rationale is not a filled contract —
		// mirror R9's ARCH_WAIVER, which requires text after 구조 변화 없음:.
		if (/^변경\s*없음\s*[:：]?\s*$/.test(value)) continue;
		return true;
	}
	return false;
}

// R14 — the system level must enumerate the changed contracts across all three
// axes (server API / DB schema / client dependency). Measured gap: 시스템 레벨
// drew one box-and-arrow diagram and stopped, never naming which API surface,
// schema, or client-consumed contract this diff actually moves.
function checkR14(text: string): CheckItem {
	const slice = levelSlice(text, "시스템 레벨");
	if (slice === null) {
		return {
			id: "R14",
			title: "R14 시스템 레벨 변경 계약 3축",
			pass: false,
			detail: "시스템 레벨 헤딩(### 시스템 레벨)이 없습니다",
		};
	}
	// An axis label present but with an empty value cell is not a filled contract —
	// R14 exists to force the actual API/schema/client change, and nothing
	// downstream judges these cells, so the value must be checked here.
	const missing = SYSTEM_CONTRACT_AXES.filter((axis) => !axisHasValue(slice, axis));
	return {
		id: "R14",
		title: "R14 시스템 레벨 변경 계약 3축",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `시스템 레벨 변경 계약 표에서 라벨/값이 채워지지 않은 축: ${missing.join(", ")} (각 축은 바뀌는 계약을 적거나 "변경 없음: <사유>"로 채운다)`
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
// commit subsection whose hash is a real range commit, and each file block
// carries one core-logic code fence. Measured baseline: the code section sat
// disconnected from the commit history, and file blocks pointed at line
// numbers without ever showing the logic.
function checkR13(
	text: string,
	blocks: Array<{ path: string; body: string }>,
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
		// Every file block must sit UNDER a commit subsection, not just share the
		// group with one. A file block before the first commit heading is the flat
		// structure the spine rejects — the file is mapped to no commit.
		const firstCommit = masked.search(new RegExp(COMMIT_SUBSECTION.source, "m"));
		const orphanBeforeCommit = [...masked.matchAll(new RegExp(FILE_BLOCK.source, "gm"))].some(
			(m) => m.index !== undefined && m.index < firstCommit,
		);
		if (orphanBeforeCommit) {
			problems.push(`${g.title}: 커밋 서브섹션보다 먼저 온 파일 블록이 있습니다(커밋에 매이지 않음)`);
		}
		// Only validate hashes when enumeration succeeded — an empty known set is
		// "git failed", not "every hash is fake".
		if (known.length > 0) {
			const bogus = heads.filter((h) => !known.some((c) => c.startsWith(h)));
			if (bogus.length > 0) problems.push(`${g.title}: 범위에 없는 커밋 해시 ${bogus.join(", ")}`);
		}
	}
	// Every file block must live INSIDE a Change Group span. A `#### path` under
	// some other level-two section is seen by the global R1/R3/R5 checks but the
	// per-group loop above never reaches it — so it would attach to neither a
	// group nor a commit. Check group membership on the whole document here.
	const maskedFull = maskFenced(text);
	const groupSpans: Array<{ start: number; end: number }> = [];
	for (const m of maskedFull.matchAll(/^##\s+Change Group\s+\d+\s*:.*$/gm)) {
		if (m.index === undefined) continue;
		const rest = maskedFull.slice(m.index + m[0].length).search(/^##\s/m);
		groupSpans.push({
			start: m.index,
			end: rest >= 0 ? m.index + m[0].length + rest : maskedFull.length,
		});
	}
	const outsideGroup = [...maskedFull.matchAll(new RegExp(FILE_BLOCK.source, "gm"))].some((m) => {
		const at = m.index;
		return at !== undefined && !groupSpans.some((s) => at >= s.start && at < s.end);
	});
	if (outsideGroup) problems.push("Change Group 밖에 파일 블록이 있습니다(그룹·커밋에 매이지 않음)");
	const noCode = blocks.filter((b) => !hasCoreCodeFence(b.body)).map((b) => b.path);
	if (noCode.length > 0) problems.push(`핵심 로직 코드 펜스(mermaid·빈 펜스 제외)가 없는 파일: ${noCode.join(", ")}`);
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
	const blocks = fileBlocks(text);

	switch (input.step) {
		case "evidence":
			items.push(checkR1Listing(text, input.signalFiles));
			break;
		case "background":
			items.push(checkR4(text));
			break;
		case "architecture":
			items.push(checkR9(text));
			items.push(checkR14(text));
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
			items.push(checkR13(text, blocks, input.commitHashes));
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
