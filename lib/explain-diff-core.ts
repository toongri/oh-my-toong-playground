/**
 * explain-diff step machine — the predicate layer.
 *
 * Every consumer of the step machine reads its verdict from here: the state CLI
 * (which writes the results into `derived`), the PreToolUse artifact guard, and
 * the Stop gate. None of them re-derives the arithmetic; the shell hooks in
 * particular read only the booleans this module computed, so there is exactly
 * one place where "may this write land" and "may this session stop" are decided.
 */

/** The six steps, in the order a document is built. */
export const STEP_ORDER = ["evidence", "background", "intuition", "code", "render", "quiz"] as const;

export type Step = (typeof STEP_ORDER)[number];

/**
 * The steps the skill performs alone. `render` is a derivation, not authoring,
 * and `quiz` is the only step that needs the reader — so authoring ends at `code`.
 */
export const AUTHORING_STEPS = ["evidence", "background", "intuition", "code"] as const;

/**
 * Judge rubric items each step's judge review must certify before `pass-step`
 * may advance it. SKILL.md and references/judge-prompt.md assign the judge
 * exactly two items — R6 at `intuition`, R7 at `code` — everything else in the
 * rubric (R1..R5) is scripted in explain-diff-structure.ts. An empty required
 * set is deliberate at the other four steps, not an oversight: their coverage
 * is already earned before the judge ever runs, so a judge payload with
 * nothing in it is correctly a no-op there, not a bypass.
 */
export const REQUIRED_JUDGE_IDS: Record<Step, readonly string[]> = {
	evidence: [],
	background: [],
	intuition: ["R6"],
	code: ["R7"],
	render: [],
	quiz: [],
};

export interface Concept {
	id: string;
	required: boolean;
	passed: boolean;
}

export interface StepFailure {
	step: Step;
	/** The structural-check items that failed, verbatim, for the deny message. */
	items: string[];
}

export interface ExplainDiffState {
	active: boolean;
	step: Step;
	/** Steps whose structural checks AND judge review both passed. */
	passed: Step[];
	concepts: Concept[];
	bank: unknown[];
	/** Set while a quiz question is outstanding and the reader has not answered. */
	awaiting_answer: boolean;
	/** Soft stop raised by the no-progress detector; cleared only by the user. */
	stalled?: boolean;
	no_progress: { key: string; count: number; doc_digest: string };
	last_failure: StepFailure | null;
}

export interface ExplainDiffDerived {
	artifact_write_allowed: boolean;
	quiz_passed: boolean;
	stop_allowed: boolean;
	no_progress_tripped: boolean;
	block_reason: string;
}

function toStep(v: unknown): Step | null {
	return STEP_ORDER.find((s) => s === v) ?? null;
}

/**
 * Rebuilds a state object out of untrusted JSON, field by field.
 *
 * Both readers go through here — the state CLI when it loads its own file, and
 * the Stop gate when it reads that file from the outside — so "what the gate
 * sees" and "what the writer sees" cannot drift. Rebuilding rather than casting
 * matters for a hand-edited or truncated file: an unknown step name is dropped
 * back to `evidence` instead of walking past the step order, and a missing array
 * arrives empty instead of crashing the first `.includes` that touches it.
 */
export function normalizeExplainDiffState(parsed: unknown): ExplainDiffState | null {
	if (parsed === null || typeof parsed !== "object") return null;
	const r: Record<string, unknown> = {};
	Object.assign(r, parsed);

	const np: Record<string, unknown> = {};
	if (r["no_progress"] !== null && typeof r["no_progress"] === "object") {
		Object.assign(np, r["no_progress"]);
	}

	const failureRaw = r["last_failure"];
	let last_failure: StepFailure | null = null;
	if (failureRaw !== null && typeof failureRaw === "object") {
		const f: Record<string, unknown> = {};
		Object.assign(f, failureRaw);
		const step = toStep(f["step"]);
		if (step) {
			const items = f["items"];
			last_failure = { step, items: Array.isArray(items) ? items.map(String) : [] };
		}
	}

	const passedRaw = r["passed"];
	const conceptsRaw = r["concepts"];
	return {
		active: r["active"] === true,
		step: toStep(r["step"]) ?? "evidence",
		passed: Array.isArray(passedRaw) ? passedRaw.flatMap((x) => toStep(x) ?? []) : [],
		concepts: Array.isArray(conceptsRaw)
			? conceptsRaw.flatMap((x) => {
					if (x === null || typeof x !== "object") return [];
					const c: Record<string, unknown> = {};
					Object.assign(c, x);
					const id = c["id"];
					if (typeof id !== "string") return [];
					return [{ id, required: c["required"] === true, passed: c["passed"] === true }];
				})
			: [],
		bank: Array.isArray(r["bank"]) ? r["bank"] : [],
		awaiting_answer: r["awaiting_answer"] === true,
		...(r["stalled"] === true ? { stalled: true } : {}),
		no_progress: {
			key: typeof np["key"] === "string" ? np["key"] : "",
			count: typeof np["count"] === "number" ? np["count"] : 0,
			doc_digest: typeof np["doc_digest"] === "string" ? np["doc_digest"] : "",
		},
		last_failure,
	};
}

export function nextStep(step: Step): Step | null {
	const i = STEP_ORDER.indexOf(step);
	if (i < 0 || i === STEP_ORDER.length - 1) return null;
	return STEP_ORDER[i + 1] ?? null;
}

function missingPriorSteps(state: ExplainDiffState): Step[] {
	const i = STEP_ORDER.indexOf(state.step);
	if (i <= 0) return [];
	return STEP_ORDER.slice(0, i).filter((s) => !state.passed.includes(s));
}

export function computeDerived(state: ExplainDiffState): ExplainDiffDerived {
	const missing = missingPriorSteps(state);
	const artifact_write_allowed = state.active === true && missing.length === 0;

	// The deny message is composed here rather than in the hook because this is
	// the only layer that knows WHICH check failed. A shell guard that rebuilt
	// this sentence would be a second, drifting copy of the step model.
	let block_reason = "";
	if (!artifact_write_allowed) {
		if (state.active !== true) {
			block_reason = "explain-diff 상태가 비활성입니다. 스킬을 다시 호출하세요.";
		} else if (state.last_failure) {
			block_reason =
				`${state.last_failure.step} 스텝 검사 실패: ${state.last_failure.items.join(", ")}. ` +
				`${state.last_failure.step} 스텝으로 돌아가 고친 뒤 다시 제출하세요.`;
		} else {
			block_reason =
				`${missing.join(", ")} 스텝이 아직 통과되지 않았습니다. ` +
				`${missing[0]} 스텝으로 돌아가세요.`;
		}
	}

	// Required-concept coverage, with the empty set treated as NOT passing. A
	// bank that produced no required concepts would otherwise satisfy "all
	// required concepts passed" vacuously and open the gate on an empty quiz.
	const required = state.concepts.filter((c) => c.required);
	const quiz_passed =
		state.step === "quiz" && required.length > 0 && required.every((c) => c.passed);

	// Waiting on the reader is not the same as being unfinished. The turn ends so
	// the human can answer; the gate re-arms on their reply.
	const stop_allowed =
		state.active !== true || state.awaiting_answer === true || state.stalled === true || quiz_passed;

	// Same reason, applied to the counter: a slow answer must not look like a
	// stuck loop, so a wait never advances the no-progress count.
	const no_progress_tripped = state.awaiting_answer !== true && state.no_progress.count >= 2;

	return { artifact_write_allowed, quiz_passed, stop_allowed, no_progress_tripped, block_reason };
}
