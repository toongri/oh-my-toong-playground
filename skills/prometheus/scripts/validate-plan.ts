/**
 * validate-plan.ts
 *
 * Deterministic validator for prometheus plans, two independent passes:
 * (1) Section presence — the 7 always-required plan sections exist as level-2
 *     headings with non-empty bodies (cheap PRESENCE pre-filter).
 * (2) Graph semantics — a non-empty `## TODOs` section contains at least one
 *     canonical checkbox TODO; IDs are unique and either numeric or F1-F4;
 *     Blocked By references resolve with no self-dependency/cycles; `Wave: FINAL`
 *     is reserved for F1-F4 audit TODOs and required for them; a numeric
 *     implementation TODO's Wave is at least `max(blocker waves) + 1` (no
 *     blockers means at least 1). A later Wave is the planner's call and passes.
 *     A TODO whose Blocked By has an unparseable entry skips the Wave check (the
 *     parse violation is already reported).
 *
 * `Blocked By:` and `Blocks:` share one id-list parser: one pair of surrounding
 * brackets is stripped; "no ids" tokens (empty, none, —, –, -, n/a, 없음, or a
 * parenthesized none such as `(none — first task)`) give an empty list; ids may
 * carry a `T` or `TODO ` prefix; ranges with a shared prefix and numeric ends
 * (`1-6`, `T1-T10`, `F1-F4`, hyphen or en dash) expand to each id. Reversed or
 * mixed-prefix ranges, ranges spanning more than 1000 ids, and anything else are
 * unparseable.
 *
 * `Blocks:` entries must be defined and not the declaring TODO itself. A numeric
 * target must reach the declaring TODO through `Blocked By` edges (a transitive
 * predecessor counts). F1-F4 targets are exempt from that path check. The reverse
 * is not required: `Blocks:` may omit dependents, and the field may be absent.
 *
 * Code fences follow `lib/markdown-fence.ts`. Every pass ignores fenced text, and
 * a fence that never closes is reported, since everything after it renders as code.
 *
 * Usage: bun skills/prometheus/scripts/validate-plan.ts <plan_path>
 * Exit 0 = all sections present and non-empty, and no graph violations.
 * Exit 1 = violations found (offending literals/messages printed to stdout).
 * Exit 2 = usage or I/O error (missing argument, or the plan file cannot be
 *          read; a one-line message goes to stderr, nothing to stdout).
 */

import { findFenceBlocks } from "@lib/markdown-fence";

export const REQUIRED_HEADINGS: string[] = [
	"TL;DR",
	"Context",
	"Work Objectives",
	"TODOs",
	"Execution Strategy",
	"Verification Strategy",
	"Success Criteria",
];

/**
 * Replace each fenced code block with `placeholder`. Fences follow the shared
 * rules in `lib/markdown-fence.ts`: list-relative indentation, a closer of the
 * same character at least as long, and an unclosed fence running to the end (so
 * nothing after it counts as plan structure; `validateFences` reports it). Line
 * endings are normalized to LF first, so every check built on this sees LF.
 * HTML comments (`<!-- ... -->`, single- or multi-line) outside fences are then
 * removed; an unclosed `<!--` is left untouched. Other text is never changed.
 */
function stripFences(content: string, placeholder = ""): string {
	const lines = content.replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	let next = 0;
	for (const block of findFenceBlocks(lines)) {
		out.push(...lines.slice(next, block.open), placeholder);
		next = block.close === -1 ? lines.length : block.close + 1;
	}
	out.push(...lines.slice(next));
	return out.join("\n").replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Report a code fence that never closes. Markdown renders everything after it as
 * code, so the sections and TODOs written there are not part of the plan.
 *
 * @returns One violation message per unclosed fence (at most one), or empty.
 */
export function validateFences(content: string): string[] {
	const lines = content.replace(/\r\n?/g, "\n").split("\n");
	return findFenceBlocks(lines)
		.filter((block) => block.close === -1)
		.map(
			(block) =>
				`Code fence: the fence opened on line ${block.open + 1} (\`${lines[block.open].trim()}\`) never closes, so everything after it renders as code. Close it or remove it.`,
		);
}

/**
 * Validate a plan's text for section presence and non-emptiness.
 *
 * Rules:
 * (a) Fenced code blocks are stripped before scanning, but a fenced block
 *     counts as section content (headings inside it still do not count).
 * (b) A heading matches exactly `## <literal>` (level-2, case-sensitive, no extra text).
 * (c) Duplicate headings: first occurrence wins.
 * (d) Non-empty = body between this heading and the next ## heading has trimmed length > 0.
 *
 * @returns Array of heading literals that are missing or empty.
 */
export function validatePlan(content: string): string[] {
	const stripped = stripFences(content, "[fenced block]");

	// Parse the heading line regex: exactly ## <literal> (optional trailing whitespace)
	const headingRegex = /^##[ \t]+(.+?)[ \t]*$/gm;

	// Collect first-occurrence positions of level-2 headings
	const headingPositions: Array<{ literal: string; bodyStart: number }> = [];
	const seen = new Set<string>();

	let match: RegExpExecArray | null;
	while ((match = headingRegex.exec(stripped)) !== null) {
		const literal = match[1];
		if (!seen.has(literal)) {
			seen.add(literal);
			headingPositions.push({
				literal,
				bodyStart: match.index + match[0].length,
			});
		}
	}

	const missing: string[] = [];

	for (const required of REQUIRED_HEADINGS) {
		const entry = headingPositions.find((h) => h.literal === required);

		if (entry === undefined) {
			// Heading not found at all
			missing.push(required);
			continue;
		}

		// Find the start of the next ## heading after this one
		const nextHeadingMatch = /^##[ \t]+/m.exec(stripped.slice(entry.bodyStart));
		const bodyEnd =
			nextHeadingMatch !== null ? entry.bodyStart + nextHeadingMatch.index : stripped.length;

		const body = stripped.slice(entry.bodyStart, bodyEnd).trim();

		if (body.length === 0) {
			missing.push(required);
		}
	}

	return missing;
}

// ---------------------------------------------------------------------------
// Graph semantics — TODO id uniqueness, Blocked By resolution, cycles, Wave rule
// ---------------------------------------------------------------------------

interface TodoNode {
	id: string;
	blockedBy: string[]; // resolved blocker ids (self included if self-referenced)
	blockedByUnparseable: boolean; // true when any Blocked By entry could not be parsed
	blocks: string[] | null; // resolved ids from `Blocks:`; null when the line is absent
	wave: string | null; // raw Wave value ("2", "FINAL", …) or null when absent
	violations: string[]; // parse-level violations local to this TODO
}

const NO_IDS = /^(?:none|—|–|-|n\/a|없음|\(\s*none\b.*\))$/i;
// Ranges are expanded id by id, so one typo such as `1-99999999999999999999` would
// exhaust memory. No real plan has this many TODOs.
const MAX_RANGE_IDS = 1000;

/**
 * Parse a `Blocked By:` / `Blocks:` value into TODO ids. See the file header for
 * the accepted forms; entries that match none of them are returned in `bad`.
 */
function parseIdList(raw: string): { ids: string[]; bad: string[] } {
	let value = raw.trim();
	const bracketed = /^\[(.*)\]$/.exec(value);
	if (bracketed !== null) value = bracketed[1].trim();
	const ids: string[] = [];
	const bad: string[] = [];
	if (value === "" || NO_IDS.test(value)) return { ids, bad };

	const norm = (prefix: string, digits: string): string =>
		prefix === "F" ? `F${digits}` : digits;
	for (const part of value.split(",")) {
		const entry = part.trim();
		if (entry === "") continue;
		const single = /^(?:TODO\s+|T)?(F)?(\d+)$/.exec(entry);
		if (single !== null) {
			ids.push(norm(single[1] ?? "", single[2]));
			continue;
		}
		const range = /^(F|T|TODO\s+)?(\d+)\s*[-–]\s*\1(\d+)$/.exec(entry);
		if (range !== null) {
			const prefix = range[1] ?? "";
			const from = Number(range[2]);
			const to = Number(range[3]);
			if (from <= to && to - from < MAX_RANGE_IDS) {
				for (let n = from; n <= to; n++) ids.push(norm(prefix, String(n)));
				continue;
			}
		}
		bad.push(entry);
	}
	return { ids, bad };
}

/**
 * Parse TODO nodes out of the `## TODOs` section (first occurrence, fences
 * stripped). A TODO is a checkbox line `- [ ] <id>. Title` where id is a
 * number or F-number (F1-F4 FINAL-wave tasks). `Blocked By:` / `Blocks:` / `Wave:` lines
 * up to the next checkbox line belong to that TODO.
 */
function parseTodos(content: string): TodoNode[] {
	const stripped = stripFences(content);

	// Isolate the ## TODOs section body; absence is validatePlan's concern.
	const sectionMatch = /^##[ \t]+TODOs[ \t]*$/m.exec(stripped);
	if (sectionMatch === null) return [];
	const bodyStart = sectionMatch.index + sectionMatch[0].length;
	const nextHeading = /^##[ \t]+/m.exec(stripped.slice(bodyStart));
	const body = stripped.slice(
		bodyStart,
		nextHeading !== null ? bodyStart + nextHeading.index : stripped.length,
	);

	const todos: TodoNode[] = [];
	let current: TodoNode | null = null;

	for (const line of body.split("\n")) {
		const todoMatch = /^\s*- \[[ xX]\] (F?\d+)\.\s/.exec(line);
		if (todoMatch !== null) {
			current = {
				id: todoMatch[1],
				blockedBy: [],
				blockedByUnparseable: false,
				blocks: null,
				wave: null,
				violations: [],
			};
			todos.push(current);
			continue;
		}
		if (current === null) continue;

		const blockedMatch = /^\s*-?\s*Blocked By:\s*(.*)$/.exec(line);
		if (blockedMatch !== null) {
			const { ids, bad } = parseIdList(blockedMatch[1]);
			current.blockedBy.push(...ids);
			for (const entry of bad) {
				current.violations.push(`TODO ${current.id}: unparseable Blocked By entry "${entry}"`);
			}
			if (bad.length > 0) current.blockedByUnparseable = true;
			continue;
		}

		const blocksMatch = /^\s*-?\s*Blocks:\s*(.*)$/.exec(line);
		if (blocksMatch !== null) {
			const { ids, bad } = parseIdList(blocksMatch[1]);
			current.blocks = ids;
			for (const entry of bad) {
				current.violations.push(`TODO ${current.id}: unparseable Blocks entry "${entry}"`);
			}
			continue;
		}

		const waveMatch = /^\s*-?\s*Wave:\s*(.+?)\s*$/.exec(line);
		if (waveMatch !== null) {
			current.wave = waveMatch[1];
		}
	}

	return todos;
}

/** Whether a first `## TODOs` section exists and has non-whitespace body text. */
function hasNonEmptyTodosSection(content: string): boolean {
	const stripped = stripFences(content);
	const sectionMatch = /^##[ \t]+TODOs[ \t]*$/m.exec(stripped);
	if (sectionMatch === null) return false;
	const bodyStart = sectionMatch.index + sectionMatch[0].length;
	const nextHeading = /^##[ \t]+/m.exec(stripped.slice(bodyStart));
	const body = stripped.slice(
		bodyStart,
		nextHeading !== null ? bodyStart + nextHeading.index : stripped.length,
	);
	return body.trim().length > 0;
}

/**
 * Validate graph semantics of the `## TODOs` section.
 *
 * Checks:
 * (a) a non-empty TODOs section contains at least one canonical checkbox TODO
 * (b) TODO IDs are unique and either numeric or F1-F4
 * (c) every Blocked By / Blocks reference resolves to a defined TODO
 *     (a numeric `Blocks:` target must reach the declaring TODO via Blocked By)
 * (d) no self-dependency, no dependency cycles
 * (e) `Wave: FINAL` is reserved for F1-F4 audit TODOs and required for them
 * (f) numeric implementation TODOs have `Wave >= max(blocker waves) + 1`
 *     (no blockers → at least Wave 1); a numeric task blocked by a FINAL task is invalid
 *
 * @returns Array of human-readable violation messages (empty = OK).
 */
export function validatePlanGraph(content: string): string[] {
	const todos = parseTodos(content);
	const violations: string[] = [];
	if (todos.length === 0 && hasNonEmptyTodosSection(content)) {
		violations.push("TODOs section contains no canonical checkbox TODOs");
	}

	// (a) id uniqueness — first definition wins for graph resolution
	const byId = new Map<string, TodoNode>();
	for (const todo of todos) {
		if (byId.has(todo.id)) {
			violations.push(`duplicate TODO id: ${todo.id}`);
		} else {
			byId.set(todo.id, todo);
		}
		violations.push(...todo.violations);
	}

	// (b) reference resolution + self-dependency
	for (const todo of byId.values()) {
		for (const ref of todo.blockedBy) {
			if (ref === todo.id) {
				violations.push(`TODO ${todo.id}: blocked by itself`);
			} else if (!byId.has(ref)) {
				violations.push(`TODO ${todo.id}: Blocked By references undefined TODO ${ref}`);
			}
		}
	}

	// (b2) Blocks: resolution, self-reference, and path check. A numeric target must
	// reach the declaring TODO by following Blocked By edges (transitive predecessors
	// count); F1-F4 targets are exempt.
	function reachesViaBlockedBy(from: string, goal: string): boolean {
		const seen = new Set<string>();
		const queue = [from];
		for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
			if (seen.has(id)) continue;
			seen.add(id);
			for (const ref of byId.get(id)?.blockedBy ?? []) {
				if (ref === goal) return true;
				queue.push(ref);
			}
		}
		return false;
	}
	for (const todo of byId.values()) {
		if (todo.blocks === null) continue;
		for (const ref of todo.blocks) {
			const target = byId.get(ref);
			if (ref === todo.id) {
				violations.push(`TODO ${todo.id}: blocks itself`);
			} else if (target === undefined) {
				violations.push(`TODO ${todo.id}: Blocks references undefined TODO ${ref}`);
			} else if (!/^F[1-4]$/.test(ref) && !reachesViaBlockedBy(ref, todo.id)) {
				violations.push(
					`TODO ${todo.id}: Blocks ${ref} but TODO ${ref} has no Blocked By path to ${todo.id}`,
				);
			}
		}
	}

	// (c) cycle detection — DFS with colors, definition order, self-loops excluded
	const color = new Map<string, "visiting" | "done">();
	const stack: string[] = [];
	const inCycle = new Set<string>();

	function dfs(id: string): void {
		color.set(id, "visiting");
		stack.push(id);
		const node = byId.get(id);
		if (node !== undefined) {
			for (const ref of node.blockedBy) {
				if (ref === id || !byId.has(ref)) continue; // reported above
				const state = color.get(ref);
				if (state === "visiting") {
					const cycle = stack.slice(stack.indexOf(ref)).concat(ref);
					if (!cycle.some((n) => inCycle.has(n))) {
						violations.push(`dependency cycle: ${cycle.join(" -> ")}`);
						for (const n of cycle) inCycle.add(n);
					}
				} else if (state === undefined) {
					dfs(ref);
				}
			}
		}
		stack.pop();
		color.set(id, "done");
	}
	for (const id of byId.keys()) {
		if (!color.has(id)) dfs(id);
	}

	// (d) FINAL is reserved for the F1-F4 audit TODOs.
	for (const todo of byId.values()) {
		const isFinalTodo = /^F[1-4]$/.test(todo.id);
		if (!/^\d+$/.test(todo.id) && !isFinalTodo) {
			violations.push(`invalid TODO id: ${todo.id}`);
		}
		if (todo.wave === "FINAL" && !isFinalTodo) {
			violations.push(`TODO ${todo.id}: Wave FINAL is reserved for F1-F4`);
		} else if (isFinalTodo && todo.wave !== "FINAL") {
			violations.push(`TODO ${todo.id}: F1-F4 TODO must use Wave FINAL`);
		}
	}

	// (e) Wave rule for numeric implementation tasks
	for (const todo of byId.values()) {
		if (todo.wave === "FINAL") continue;
		if (todo.wave === null) {
			violations.push(`TODO ${todo.id}: missing Wave`);
			continue;
		}
		if (!/^\d+$/.test(todo.wave)) {
			violations.push(`TODO ${todo.id}: unparseable Wave "${todo.wave}"`);
			continue;
		}
		if (inCycle.has(todo.id)) continue; // expected wave undefined inside a cycle
		if (todo.blockedByUnparseable) continue; // parse violation already reported

		let expected = 1;
		let computable = true;
		for (const ref of todo.blockedBy) {
			const blocker = byId.get(ref);
			if (blocker === undefined || ref === todo.id) {
				computable = false; // unresolved/self refs already reported
			} else if (blocker.wave === "FINAL") {
				violations.push(`TODO ${todo.id}: numeric-wave task blocked by FINAL task ${ref}`);
				computable = false;
			} else if (blocker.wave === null || !/^\d+$/.test(blocker.wave)) {
				computable = false; // blocker's own wave violation already reported
			} else {
				expected = Math.max(expected, Number(blocker.wave) + 1);
			}
		}
		if (computable && Number(todo.wave) < expected) {
			violations.push(
				`TODO ${todo.id}: Wave ${todo.wave} but must be at least ${expected} (= max(blocker waves) + 1)`,
			);
		}
	}

	return violations;
}

// ---------------------------------------------------------------------------
// Boundary Map — consolidated two-axis boundary picture (structural plans only)
// ---------------------------------------------------------------------------

/**
 * Label forms of the D-item `Must NOT own` field (case-insensitive); prose
 * mentions without label punctuation match none of them.
 * (a) at the start of a line's content, after optional indent / list marker / `**`;
 * (b) anywhere in a line, followed by optional `**`, optional spaces, then `:`;
 * (c) a bold `**Must NOT own.**` / `**Must NOT own:**` anywhere in a line.
 */
const MUST_NOT_OWN_LABEL: RegExp[] = [
	/^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(?:\*\*)?Must NOT own(?:[:.*]|[ \t]*$)/im,
	/Must NOT own(?:\*\*)?[ \t]*:/i,
	/\*\*Must NOT own[.:]\*\*/i,
];

/**
 * Validate the Boundary Map block.
 *
 * A plan that carries structural enumeration must also render the consolidated
 * two-axis boundary picture the per-component D-items leave scattered: each
 * part named with its layer + collaborators, classified affected vs modified,
 * and a dependency-direction verdict. This mirrors the ADR structural
 * enumeration's own gating — structural enumeration is Complex/Architecture
 * only, detected here by the `Must NOT own` ownership field every structural
 * D-item declares (an explicit `Must NOT own: none` counts). Only the label
 * forms in `MUST_NOT_OWN_LABEL` trigger (line-start label, `Must NOT own:`
 * anywhere in a line, bold `**Must NOT own.**`); prose mentions do not.
 * When that field is absent the plan carries no structural enumeration and the block is not
 * required.
 *
 * The three content markers parallel the explain-diff R15 gate: presence only
 * (Collaborators / affected + modified / Dependency direction) — the block's
 * prose is the planner's to fill, the gate only forces the slots present. See
 * the `architecture-boundaries` rule.
 *
 * @returns Array of human-readable violation messages (empty = OK or N/A).
 */
export function validateBoundaryMap(content: string): string[] {
	const stripped = stripFences(content);

	// No structural enumeration → block not required.
	if (!MUST_NOT_OWN_LABEL.some((re) => re.test(stripped))) return [];

	// The block anchors on a heading whose text contains "Boundary Map".
	const headingMatch = /^#{2,4}[ \t]+.*Boundary Map.*$/im.exec(stripped);
	if (headingMatch === null) {
		return [
			"Boundary Map: block is missing — a plan with structural enumeration MUST render the consolidated two-axis boundary map (vertical domain / horizontal use-case, collaborators, affected vs modified, dependency direction). See the architecture-boundaries rule.",
		];
	}

	// Slice the block body: from the heading to the next same-or-higher heading.
	const bodyStart = headingMatch.index + headingMatch[0].length;
	const hashes = headingMatch[0].match(/^#+/);
	const level = hashes !== null ? hashes[0].length : 2;
	const nextHeading = new RegExp(`^#{1,${level}}[ \\t]+`, "m").exec(stripped.slice(bodyStart));
	const block = stripped.slice(
		bodyStart,
		nextHeading !== null ? bodyStart + nextHeading.index : stripped.length,
	);

	const violations: string[] = [];
	const markers: Array<[RegExp, string]> = [
		[/Collaborators/i, "Collaborators (names each part with its boundary + collaborators)"],
		[/affected/i, "affected (affected-vs-modified classification)"],
		[/modified/i, "modified (affected-vs-modified classification)"],
		[/Dependency direction/i, "Dependency direction (unidirectional-per-axis verdict)"],
	];
	for (const [re, label] of markers) {
		if (!re.test(block)) {
			violations.push(`Boundary Map: missing "${label}" slot (see architecture-boundaries rule)`);
		}
	}
	return violations;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
	const planPath = process.argv[2];
	if (!planPath) {
		console.error("Usage: bun validate-plan.ts <plan_path>");
		process.exit(2);
	}

	const { readFileSync } = await import("fs");
	let content: string;
	try {
		content = readFileSync(planPath, "utf8");
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.error(`validate-plan: cannot read ${planPath}: ${reason}`);
		process.exit(2);
	}
	const problems = [
		...validateFences(content),
		...validatePlan(content),
		...validatePlanGraph(content),
		...validateBoundaryMap(content),
	];

	if (problems.length > 0) {
		for (const p of problems) {
			// eslint-disable-next-line no-console -- CLI contract (see file header): offending literals/messages printed to stdout for the invoking skill to read
			console.log(p);
		}
		process.exit(1);
	}

	process.exit(0);
}
