/**
 * validate-plan.ts
 *
 * Deterministic validator for prometheus plans, two independent passes:
 * (1) Section presence — the 7 always-required plan sections exist as level-2
 *     headings with non-empty bodies (cheap PRESENCE pre-filter).
 * (2) Graph semantics — a non-empty `## TODOs` section contains at least one
 *     canonical checkbox TODO; IDs are unique and either numeric or F1-F4;
 *     Blocked By references resolve with no self-dependency/cycles; `Wave: FINAL`
 *     is reserved for F1-F4 audit TODOs and required for them; numeric
 *     implementation TODOs satisfy `Wave = max(blocker waves) + 1` (no blockers
 *     means Wave 1).
 *
 * Usage: bun skills/prometheus/scripts/validate-plan.ts <plan_path>
 * Exit 0 = all sections present and non-empty, and no graph violations.
 * Exit 1 = violations found (offending literals/messages printed to stdout).
 */

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
 * Strip fenced code blocks (``` ... ```) from markdown content.
 * This prevents headings inside fences from being counted.
 */
function stripFences(content: string): string {
	return content.replace(/^```[\s\S]*?^```/gm, "");
}

/**
 * Validate a plan's text for section presence and non-emptiness.
 *
 * Rules:
 * (a) Fenced code blocks are stripped before scanning.
 * (b) A heading matches exactly `## <literal>` (level-2, case-sensitive, no extra text).
 * (c) Duplicate headings: first occurrence wins.
 * (d) Non-empty = body between this heading and the next ## heading has trimmed length > 0.
 *
 * @returns Array of heading literals that are missing or empty.
 */
export function validatePlan(content: string): string[] {
	const stripped = stripFences(content);

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
	wave: string | null; // raw Wave value ("2", "FINAL", …) or null when absent
	violations: string[]; // parse-level violations local to this TODO
}

/**
 * Parse TODO nodes out of the `## TODOs` section (first occurrence, fences
 * stripped). A TODO is a checkbox line `- [ ] <id>. Title` where id is a
 * number or F-number (F1-F4 FINAL-wave tasks). `Blocked By:` / `Wave:` lines
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
			current = { id: todoMatch[1], blockedBy: [], wave: null, violations: [] };
			todos.push(current);
			continue;
		}
		if (current === null) continue;

		const blockedMatch = /^\s*-?\s*Blocked By:\s*(.*)$/.exec(line);
		if (blockedMatch !== null) {
			const value = blockedMatch[1].trim();
			if (value !== "" && !/^none$/i.test(value)) {
				for (const raw of value.split(",")) {
					const entry = raw.trim();
					if (entry === "") continue;
					const ref = /^(?:TODO\s+)?(F?\d+)$/.exec(entry);
					if (ref === null) {
						current.violations.push(
							`TODO ${current.id}: unparseable Blocked By entry "${entry}"`,
						);
					} else {
						current.blockedBy.push(ref[1]);
					}
				}
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
 * (c) every Blocked By reference resolves to a defined TODO
 * (d) no self-dependency, no dependency cycles
 * (e) `Wave: FINAL` is reserved for F1-F4 audit TODOs and required for them
 * (f) numeric implementation TODOs satisfy `Wave = max(blocker waves) + 1`
 *     (no blockers → Wave 1); a numeric task blocked by a FINAL task is invalid
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
		if (computable && Number(todo.wave) !== expected) {
			violations.push(
				`TODO ${todo.id}: Wave ${todo.wave} but expected ${expected} (= max(blocker waves) + 1)`,
			);
		}
	}

	return violations;
}

// ---------------------------------------------------------------------------
// Boundary Map — consolidated two-axis boundary picture (structural plans only)
// ---------------------------------------------------------------------------

/**
 * Validate the Boundary Map block.
 *
 * A plan that carries structural enumeration must also render the consolidated
 * two-axis boundary picture the per-component D-items leave scattered: each
 * part named with its layer + collaborators, classified affected vs modified,
 * and a dependency-direction verdict. This mirrors the ADR structural
 * enumeration's own gating — structural enumeration is Complex/Architecture
 * only, detected here by the `Must NOT own` ownership marker every structural
 * D-item declares (an explicit `Must NOT own: none` counts). When that marker
 * is absent the plan carries no structural enumeration and the block is not
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
	if (!/Must NOT own/.test(stripped)) return [];

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
	const content = readFileSync(planPath, "utf8");
	const problems = [
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
