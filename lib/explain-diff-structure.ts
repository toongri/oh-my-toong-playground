/**
 * explain-diff structural checks — rubric items R1..R5, R9..R11, R13..R19.
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
		| "R19";
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

/** The two slots the 목표 section must fill (R16): goal+why, and a one-line core before code. */
const GOAL_SLOTS = [
	{ label: "무엇을·왜", re: /^###\s*무엇을/m },
	{ label: "핵심", re: /^###\s*핵심/m },
] as const;

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
	const missing = GOAL_SLOTS.filter((s) => !s.re.test(slice)).map((s) => s.label);
	return {
		id: "R16",
		title: "R16 목표·핵심 전달",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `목표 섹션에 없는 슬롯: ${missing.join(", ")} (### 무엇을·왜 / ### 핵심)`
				: "",
	};
}

// R5 — both endpoints of the move (base:/head: anchors). An ADDED file is asked
// for the head anchor alone. Read on the code-stripped body; the template places
// these in the cf-loc slot, but the check only asks that the anchors be present —
// the author fills where and how precisely they point.
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
// `### 경계·의존·유스케이스` sub-slice with fences masked (an example block inside a
// fence must not satisfy the gate — same masking discipline as R14).
function checkR15(text: string): CheckItem {
	const slice = levelSlice(maskFenced(text), "경계·의존·유스케이스");
	if (slice === null) {
		return {
			id: "R15",
			title: "R15 경계·의존·유스케이스 블록",
			pass: false,
			detail: "경계·의존·유스케이스 헤딩(### 경계·의존·유스케이스)이 없습니다",
		};
	}
	const missing: string[] = BOUNDARY_MARKERS.filter((label) => !slice.includes(label));
	// The change kind of each behaviour unit rides on the arch-entity's
	// data-change attribute — a boundary block with no unit carrying it is a
	// static list again, not the change map R15 requires.
	if (!slice.includes("data-change")) missing.push("변경종류(data-change)");
	return {
		id: "R15",
		title: "R15 경계·의존·유스케이스 블록",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `경계·의존·유스케이스 블록에 없는 슬롯: ${missing.join(", ")} — 동작 단위마다 변경종류(arch-entity data-change)와 영향 인터페이스를 적고, 의존 방향을 판정한다 (architecture-boundaries rule 참조)`
				: "",
	};
}

/** The column labels the 시스템 레벨 standing-interface table must carry (R17). */
const STANDING_INTERFACE_MARKERS = ["경계", "인터페이스", "오가는 것"] as const;

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
	const missing = STANDING_INTERFACE_MARKERS.filter((label) => !slice.includes(label));
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
const COMPONENT_CARD_MARKERS = ["레이어", "책임", "인터페이스"] as const;

// R18 — the component level, beyond the dependency graph (R9/R12), decodes each
// changed behaviour node with an arch-entity card: its layer, responsibility,
// and interface (functions), plus a change kind. Measured gap: the component
// diagram was bare class names — `CurrentBoostPackInfoCard` alone read as opaque.
function checkR18(text: string): CheckItem {
	const slice = levelSlice(maskFenced(text), "컴포넌트 레벨");
	if (slice === null) {
		return {
			id: "R18",
			title: "R18 컴포넌트 레벨 노드 카드",
			pass: false,
			detail: "컴포넌트 레벨 헤딩(### 컴포넌트 레벨)이 없습니다",
		};
	}
	const missing: string[] = COMPONENT_CARD_MARKERS.filter((label) => !slice.includes(label));
	if (!slice.includes("arch-entity")) missing.push("arch-entity 카드");
	if (!slice.includes("data-change")) missing.push("변경종류(data-change)");
	return {
		id: "R18",
		title: "R18 컴포넌트 레벨 노드 카드",
		pass: missing.length === 0,
		detail:
			missing.length > 0
				? `컴포넌트 노드 카드에 없는 슬롯: ${missing.join(", ")} — 변경 노드마다 arch-entity로 레이어·책임·인터페이스·변경종류를 적는다`
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

// R19 — no methodology name leaks into the Architecture prose. Read on the
// fence-masked Architecture section (a token inside a code example is not prose).
function checkR19(text: string): CheckItem {
	const slice = sectionSlice(maskFenced(text), "Architecture");
	if (slice === null) {
		return {
			id: "R19",
			title: "R19 방법론 명칭 비노출",
			pass: false,
			detail: "## Architecture 섹션이 없습니다",
		};
	}
	const lower = slice.toLowerCase();
	const found = METHODOLOGY_TOKENS.filter((t) => lower.includes(t.toLowerCase()));
	return {
		id: "R19",
		title: "R19 방법론 명칭 비노출",
		pass: found.length === 0,
		detail:
			found.length > 0
				? `Architecture 산문에 방법론 명칭이 노출됨: ${found.join(", ")} — 코드베이스 실제 도메인 어휘로 바꾼다`
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
		// Only validate hashes when enumeration succeeded — an empty known set is
		// "git failed", not "every hash is fake".
		if (known.length > 0) {
			const bogus = heads.filter((h) => !known.some((c) => c.startsWith(h)));
			if (bogus.length > 0) problems.push(`${g.title}: 범위에 없는 커밋 해시 ${bogus.join(", ")}`);
		}
	}
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
	"arch-entity",
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
