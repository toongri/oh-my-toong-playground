/**
 * Prometheus skill state CLI.
 *
 * State file path: ${OMT_DIR}/prometheus-state-${sessionId}.json
 * Session ID: resolved from env OMT_SESSION_ID, falling back to CODEX_THREAD_ID (Codex), via resolveSessionIdOrThrow() (hard-fail when neither is set or unsafe)
 *
 * Subcommands:
 *   set --phase <S> [--plan-path <p>] [--resume-summary <s>]
 *       [--record-ac '<json-array>' | --record-ac - (reads JSON array from stdin)]
 *       [--record-non-goals '<lines>' | --record-non-goals - (reads lines from stdin)]
 *       [--mark-design-done] [--mark-plan-done] [--submit-presentation <html>] [--await-user]
 *   get
 *   clear (system-only internal teardown)
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync, statSync } from "fs";
import { isAbsolute } from "path";
import { execSync } from "child_process";
import { getOmtDir } from "@lib/omt-dir";
import {
	mergeWithHeartbeat,
	nowStamp,
	resolveSessionIdOrThrow,
	listOthers,
	adopt,
	writeFileNoCreate,
	ensureSeed,
	adoptedAwayTo,
	stageAPresentationPath,
	stageAPresentationStatus,
	createPresentationSubmission,
	presentationSubmissionCurrent,
	type PresentationSubmission,
	type SourceCompatibilityPredicate,
} from "@lib/state-core";
import { withStateLock } from "@lib/persistent-mode-core/state-lock";
import { renderHelp, type CliCommand } from "@lib/cli-help";

export interface PrometheusState {
	presentation?: PresentationSubmission;
	active: boolean;
	/**
	 * Set true by `set --await-user` when a plain-text question is posed to the
	 * user at any phase (an S0 interview question, or a human-decision gate such as S2 co-design, S7 execution bridge); cleared to false by
	 * any later `set` that does not repeat the flag (i.e. the next progress write).
	 * The persistent-mode Stop gate reads it as a legitimate pause and allows the
	 * turn to end WITHOUT completing — the session resumes on the user's reply.
	 * It never marks completion; only <prometheus-done/> + the Stage A gate does.
	 */
	awaiting_user: boolean;
	/**
	 * Set by `set --abort --reason "<the user's words>"` when the user abandons the
	 * plan. The persistent-mode Stop gate lets <prometheus-done/> tear the session
	 * down without a Stage A presentation while this is present. Cleared by any
	 * later `set` without --abort, so a resumed session keeps no stale abort.
	 */
	aborted?: { reason: string; phase: string; at: string };
	/** Pipeline token: S0-S8 */
	phase: string;
	/** Absolute path under $OMT_DIR/plans/, empty string until plan written */
	plan_path: string;
	/** Single-line pause bookmark, control chars normalized to spaces */
	resume_summary: string;
	/** Newline-delimited canonical non-goal/decider lines. */
	non_goals: string;
	/** Local ISO-8601 without milliseconds, seeded once via `date -Iseconds` */
	started_at: string;
	/** Refreshed on every write (heartbeat). Used by the GC liveness check. */
	last_touched_at: string;
	/** Per-planning-step completion records. */
	steps: {
		acceptance_criteria: { done: boolean; content: string[]; recorded_at: string };
		design_decisions: { done: boolean; ref: string };
		plan: { done: boolean };
	};
}

/**
 * A deliberate CLI refusal (gate or precondition not met). Thrown, not process.exit()ed,
 * so `set`'s state lock is released by its `finally`; main() prints it as one line.
 */
class PrometheusRefusal extends Error {}

/** The fresh default for `steps` — used when prior state has no steps field. */
const FRESH_STEPS: PrometheusState["steps"] = {
	acceptance_criteria: { done: false, content: [], recorded_at: "" },
	design_decisions: { done: false, ref: "" },
	plan: { done: false },
};

// ---------------------------------------------------------------------------
// IO helpers (safe write semantics, no import from hooks/)
// ---------------------------------------------------------------------------

function readFileOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function deleteFile(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// ignore missing file
	}
}

/** True iff `err` is an Error-shaped value carrying a Node.js `code` field. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

/** True iff every element of `value` is a string. */
function isStringArray(value: unknown[]): value is string[] {
	return value.every((x) => typeof x === "string");
}

/**
 * Read all of stdin synchronously (fd 0). Used by `--record-ac -` so AC content
 * can be piped via an apostrophe-safe quoted heredoc instead of shell-quoted argv.
 */
function readStdinSync(): string {
	try {
		return readFileSync(0, "utf8");
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------------------
// Path resolution — identical dir resolution as goal-state (@lib/omt-dir)
// ---------------------------------------------------------------------------

export function resolveStatePath(sessionId: string): string {
	return `${getOmtDir()}/prometheus-state-${sessionId}.json`;
}

// ---------------------------------------------------------------------------
// started_at seeding — spawns shell date to match the BSD-parseable format
// ---------------------------------------------------------------------------

function seedStartedAt(): string {
	try {
		const result = execSync('date -Iseconds 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S"', {
			encoding: "utf8",
			shell: "/bin/sh",
		});
		return result.trim();
	} catch {
		// Final fallback: manual ISO-8601 without milliseconds
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}
}

// ---------------------------------------------------------------------------
// Normalize resume_summary: replace U+0000-U+001F with space
// ---------------------------------------------------------------------------

function normalizeResumeSummary(s: string): string {
	// eslint-disable-next-line no-control-regex -- intentional: sanitizes literal control chars to spaces
	return s.replace(/[\x00-\x1F]/g, " ");
}

/** Canonical non-goal declaration shape shared with Ultragoal's state boundary. */
const NON_GOAL_LINE_PATTERN = /^-\s+\S.*\|\s*decider:\s*\S.*$/;

/** Returns the validated non-goals value, or null when the state is incompatible. */
function validatedNonGoals(value: unknown, phase: unknown): string | null {
	if (value !== null && value !== undefined && typeof value !== "string") return null;
	const nonGoals = typeof value === "string" ? value : "";
	const phaseName = typeof phase === "string" ? phase : "";
	if (nonGoals.trim() === "") {
		return phaseName === "S0" || phaseName === "S1" ? nonGoals : null;
	}
	for (const line of nonGoals.split("\n")) {
		if (line.trim() === "") continue;
		if (!NON_GOAL_LINE_PATTERN.test(line)) return null;
	}
	return nonGoals;
}

const nonGoalFixHint = (line: string): string =>
	line.startsWith("- ")
		? ` — add a membership test: "${line.trimEnd()} | decider: <what change would make a finding out of scope, e.g. a file path or function>"`
		: ' — each line must start with "- "';

function assertValidNonGoals(value: string, phase: string): void {
	if (validatedNonGoals(value, phase) !== null) return;
	if (value.trim() === "" && phase !== "S0" && phase !== "S1") {
		throw new Error(`non-goals are required for ${phase} and must contain a canonical decider line`);
	}
	const offending = value.split("\n").find((l) => l.trim() !== "" && !NON_GOAL_LINE_PATTERN.test(l)) ?? value;
	throw new Error(
		`non-goals refused — line does not match "- {excluded item} | decider: {membership test}" format: "${offending}"${nonGoalFixHint(offending)}`,
	);
}

const prometheusSourceCompatibility: SourceCompatibilityPredicate = (parsed) =>
	validatedNonGoals(parsed["non_goals"] ?? "", parsed["phase"]) !== null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readPrometheusState(sessionId: string): PrometheusState | null {
	const path = resolveStatePath(sessionId);
	const content = readFileOrNull(path);
	if (!content) return null;
	try {
		// JSON.parse's return type is already `any`; the caller only relies on
		// `.active`, so no assertion to PrometheusState is needed here.
		const state = JSON.parse(content);
		if (!state.active) return null;
		const nonGoals = validatedNonGoals(state.non_goals ?? "", state.phase);
		if (nonGoals === null) return null;
		state.non_goals = nonGoals;
		return state;
	} catch {
		return null;
	}
}

export function setPrometheusState(
	sessionId: string,
	opts: {
		phase: string;
		plan_path?: string;
		resume_summary?: string;
		non_goals?: string;
		/** Parsed AC string array — sets steps.acceptance_criteria.{done,content,recorded_at=phase}. */
		record_ac?: string[];
		/** Sets steps.design_decisions.{done:true, ref=current plan_path}. */
		mark_design_done?: boolean;
		/** Sets steps.plan.done=true. */
		mark_plan_done?: boolean;
		submit_presentation?: string;
		/** Sets awaiting_user=true (legitimate pause at a human gate). Omitting it on any set clears the flag. */
		await_user?: boolean;
		/** Records `aborted` with this reason (the user's words). Omitting it on any set clears `aborted`. */
		abort_reason?: string;
	},
): void {
	// Self-heal: seed the pristine skeleton if the PreToolUse hook never fired
	// (e.g. slash-command entry). No-op when the file already exists; the strict
	// writeFileNoCreate below is unchanged (ADR-7 mid-flight guard preserved).
	ensureSeed("prometheus", sessionId);
	const path = resolveStatePath(sessionId);
	// Same mkdir lock ultragoal uses for its read-modify-write: two concurrent `set`s
	// must not lose each other's step flags.
	withStateLock(path, () => writePrometheusState(sessionId, path, opts));
}

function writePrometheusState(
	sessionId: string,
	path: string,
	opts: Parameters<typeof setPrometheusState>[1],
): void {
	const existing = readFileOrNull(path);
	if (existing === null) {
		const adopter = adoptedAwayTo("prometheus", sessionId);
		if (adopter !== null) throw adoptedAwayRefusal(sessionId, adopter);
	}
	let prior: Partial<PrometheusState> = {};
	if (existing) {
		try {
			// `prior` is already typed Partial<PrometheusState>; JSON.parse's `any`
			// return assigns without a cast.
			prior = JSON.parse(existing);
		} catch {
			// corrupt file; start fresh from empty prior
		}
	}

	// Phase-preserving default: an absent --phase (CLI passes "") must NOT overwrite the
	// stored phase. A pure pause write (`set --await-user`) at a human gate carries no
	// --phase, and clobbering phase to "" would destroy the S2/S7 pipeline position needed
	// for resume (and be rejected outright in early states, where "" fails the non-goals
	// gate). Every real transition still passes an explicit --phase, which wins here.
	const resolvedPhase = opts.phase !== "" ? opts.phase : prior.phase ?? "";
	const resolvedPlanPath = opts.plan_path ?? prior.plan_path ?? "";
	const resolvedNonGoals = opts.non_goals ?? prior.non_goals ?? "";
	assertValidNonGoals(resolvedNonGoals, resolvedPhase);
	const presentation = opts.submit_presentation !== undefined
		? createPresentationSubmission(resolvedPlanPath, opts.submit_presentation)
		: prior.presentation;
	if (opts.submit_presentation !== undefined && !presentationSubmissionCurrent(presentation, resolvedPlanPath, stageAPresentationPath(resolvedPlanPath))) {
		throw new Error("presentation must be submitted at the current plan's presentation/<stem>.html path");
	}

	// F6: marking design done with no plan_path would persist done=true, ref="" —
	// resume then treats design as complete but has no ADR pointer. Loud error
	// instead of a silent ordering hazard.
	if (opts.mark_design_done && resolvedPlanPath === "") {
		throw new PrometheusRefusal(
			"--mark-design-done requires plan_path to be set (write the draft first, then pass --plan-path)",
		);
	}

	// F7: S6 and later are reachable only after Stage A renders the presentation, so a
	// presentation for THIS version of the plan must already be on disk. The prose
	// prohibition at the Stage A step had been in place for two months when production
	// still measured 5 prometheus plans with 1 compliant presentation — a reminder is
	// the wrong form for an omitted required artifact. Both conditions below are
	// mechanically checkable, so refuse the write rather than restate the rule.
	const phaseOrdinal = /^S(\d)$/.exec(opts.phase);
	if (phaseOrdinal && Number(phaseOrdinal[1]) >= 6) {
		// Typed on the binding, not just the arrow: TS narrows control flow through a
		// never-returning call only when the const carries the annotation.
		const refuse: (reason: string) => never = (reason) => {
			throw new PrometheusRefusal(`cannot advance to ${opts.phase} — ${reason}`);
		};

		// plan_path is set when the interview draft is written and preserved by later writes, so an empty one here
		// means that write was skipped. Treating the underivable check as success would
		// leave the whole gate bypassable by never passing --plan-path.
		if (resolvedPlanPath === "") {
			refuse(
				`plan_path is empty. It is preserved after the draft's first state write, so an empty ` +
					`plan_path at ${opts.phase} means that write was skipped. Pass --plan-path.`,
			);
		}

		// Predicate shared with the persistent-mode Stop hook's done-token gate
		// (lib/state-core.ts stageAPresentationStatus) — one definition of "fresh
		// presentation" for both enforcement points. Staleness matters because the
		// loop-backs (scoped re-review after a Momus REQUEST_CHANGES, and the S7→S0
		// revise) rewrite the plan at the same path while the earlier render sits
		// exactly where the check looks — a stale review document is worse than a
		// missing one: the user reviews it believing it describes the current plan.
		const presentationPath = stageAPresentationPath(resolvedPlanPath);
		switch (stageAPresentationStatus(resolvedPlanPath)) {
			case "plan-missing":
				refuse(
					`plan_path is set to ${resolvedPlanPath} but no file resolves there, so the ` +
						`presentation cannot be checked against the plan it claims to render.`,
				);
				break;
			case "presentation-missing":
				refuse(
					`the Stage A presentation is absent at ${presentationPath}. Render the plan ` +
						`there (S5 Stage A) first — skipping it hands the user an unrendered plan.`,
				);
				break;
			case "stale":
				refuse(
					`the Stage A presentation at ${presentationPath} predates the plan it renders. ` +
						`The plan was revised after that render, so the presentation is stale — ` +
						`re-run Stage A before recording ${opts.phase}.`,
				);
				break;
			case "ok":
				break;
		}
		if (!presentationSubmissionCurrent(presentation, resolvedPlanPath, presentationPath)) {
			refuse("presentation submission missing or stale; use set --phase S5 --submit-presentation <html> after rendering");
		}
	}

	if (opts.abort_reason !== undefined && opts.abort_reason.trim() === "") {
		throw new PrometheusRefusal("--abort requires a non-empty --reason (quote the user's words)");
	}
	const aborted =
		opts.abort_reason !== undefined
			? { reason: normalizeResumeSummary(opts.abort_reason).trim(), phase: resolvedPhase, at: nowStamp() }
			: undefined;

	const priorSteps = prior.steps ?? FRESH_STEPS;

	// Merge each step sub-object — only update the sub-object whose flag was passed.
	const steps: PrometheusState["steps"] = {
		acceptance_criteria:
			opts.record_ac !== undefined
				? { done: true, content: opts.record_ac, recorded_at: resolvedPhase }
				: priorSteps.acceptance_criteria,
		design_decisions: opts.mark_design_done
			? { done: true, ref: resolvedPlanPath }
			: priorSteps.design_decisions,
		plan: opts.mark_plan_done ? { done: true } : priorSteps.plan,
	};

	const partial: Omit<PrometheusState, "last_touched_at"> = {
		...(presentation ? { presentation } : {}),
		active: true,
		// Recomputed every write: true only when THIS set passed --await-user, so any
		// later progress write auto-clears the pause (mirrors explain-diff's grade clearing awaiting_answer).
		awaiting_user: opts.await_user === true,
		// Recomputed every write: present only when THIS set passed --abort.
		...(aborted ? { aborted } : {}),
		phase: resolvedPhase,
		plan_path: resolvedPlanPath,
		resume_summary: normalizeResumeSummary(opts.resume_summary ?? prior.resume_summary ?? ""),
		non_goals: resolvedNonGoals,
		// Preserve existing started_at on subsequent writes; seed on first write
		started_at: prior.started_at ?? seedStartedAt(),
		steps,
	};

	// mergeWithHeartbeat<T>'s return type (T & { last_touched_at: string }) is
	// structurally a PrometheusState already — no assertion needed.
	const state = mergeWithHeartbeat(partial, {});
	// ADR-7 (strict no-create): writeFileNoCreate throws ENOENT when the file is
	// absent — no existsSync check required. Eliminates the TOCTOU window where
	// an adopt-rename between existsSync and write could resurrect an orphan.
	// The PreToolUse seed is the ONLY creator of state files.
	try {
		writeFileNoCreate(path, JSON.stringify(state, null, 2));
	} catch (err) {
		const code = isErrnoException(err) ? err.code : undefined;
		if (code === "ENOENT") {
			throw new Error(
				`prometheus-state: state file absent for session "${sessionId}". ` +
					`Possible causes: state adopted by another session, or seed missing. ` +
					`Re-invoke the prometheus skill to re-seed.`,
				{ cause: err },
			);
		}
		throw err;
	}
	if (aborted) {
		// Teardown deletes the state file; this append-only line is the surviving record.
		appendFileSync(
			`${getOmtDir()}/prometheus-abort.log`,
			`${aborted.at} prometheus-abort ${sessionId} ${aborted.phase} ${aborted.reason}\n`,
			"utf8",
		);
	}
}

/** Refusal for a session whose state adoption.log shows another session took over. */
function adoptedAwayRefusal(sessionId: string, adopter: string, cause?: unknown): PrometheusRefusal {
	return new PrometheusRefusal(
		`state for session "${sessionId}" was adopted by session "${adopter}", so it cannot be written here. ` +
			`Continue the work in session "${adopter}" or in a new session.`,
		{ cause },
	);
}

export function clearPrometheusState(sessionId: string): void {
	deleteFile(resolveStatePath(sessionId));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): Record<string, string | boolean> {
	const result: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = args[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				result[key] = next;
				i++;
			} else {
				result[key] = true;
			}
		} else if (!result["_subcommand"]) {
			result["_subcommand"] = arg;
		}
	}
	return result;
}

/** Pipeline tokens accepted by `set --phase`. */
const PHASES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];

function fail(message: string): never {
	process.stderr.write(`prometheus-state: ${message}\n`);
	process.exit(1);
}

/**
 * Value of a string-valued flag, or undefined when absent. parseArgs stores boolean
 * `true` when no value follows (or the next token starts with `--`); that is a
 * missing value, not a string, so refuse it instead of coercing to "true".
 */
function stringFlag(args: Record<string, string | boolean>, name: string): string | undefined {
	const value = args[name];
	if (value === undefined) return undefined;
	if (typeof value !== "string") fail(`--${name} requires a value`);
	return value;
}

/**
 * Single source of truth for this CLI's command roster: every subcommand `main()`
 * dispatches, tagged with who may run it. `help` prints this via renderHelp() so the
 * AI can see, before acting, which commands it may run itself. The persistent-mode
 * hook performs teardown through its own cleanup path after the AI emits
 * <prometheus-done/>; `clear` is retained as an internal system-only subcommand.
 */
const ROSTER: CliCommand[] = [
	{
		name: "set",
		authority: "ai",
		effect:
			"writes phase/plan/AC state fields; `set --abort --reason \"<the user's words>\"` records that the user abandoned the plan (the done token then skips the Stage A gate)",
	},
	{ name: "get", authority: "ai", effect: "reads the full state" },
	{ name: "clear", authority: "system", effect: "internal session-state teardown" },
	{ name: "list-others", authority: "ai", effect: "lists other live sessions eligible for adoption" },
	{ name: "adopt", authority: "ai", effect: "re-keys another session's state into this one" },
];

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	const subcommand = args["_subcommand"];
	// help is a discovery command — it must print without a session id or seeded
	// state, so it runs BEFORE resolveSessionIdOrThrow (every other subcommand's
	// precondition is unchanged).
	if (subcommand === "help") {
		process.stdout.write(renderHelp("prometheus-state", ROSTER));
		return;
	}
	let sessionId: string;
	try {
		sessionId = resolveSessionIdOrThrow();
	} catch (e) {
		process.stderr.write(`prometheus-state: ${String(e)}\n`);
		process.exit(1);
	}

	try {
		if (subcommand === "set") {
			const phaseArg = stringFlag(args, "phase");
			if (phaseArg !== undefined && !PHASES.includes(phaseArg)) {
				fail(`--phase must be one of ${PHASES.join(", ")} (exact, case-sensitive), got: ${JSON.stringify(phaseArg)}`);
			}
			const phase = phaseArg ?? "";
			const planPath = stringFlag(args, "plan-path");
			if (planPath !== undefined && !isAbsolute(planPath)) {
				fail(`--plan-path must be an absolute path, got: ${JSON.stringify(planPath)}`);
			}
			const resumeSummary = stringFlag(args, "resume-summary");
			const submitPresentation = stringFlag(args, "submit-presentation");

			// --record-ac '<json-array>'  |  --record-ac -  (read JSON array from stdin)
			let recordAc: string[] | undefined;
			if (args["record-ac"] !== undefined) {
				// F5: a bare flag (no value) parses to boolean true — reject loudly
				// instead of silently no-op'ing the AC record.
				if (args["record-ac"] === true) {
					process.stderr.write(
						"prometheus-state: --record-ac requires a JSON-array value or '-' for stdin\n",
					);
					process.exit(1);
				}
				const arg = String(args["record-ac"]);
				// F4: '-' means read the JSON array from stdin (apostrophe-safe heredoc input).
				const raw = arg === "-" ? readStdinSync() : arg;
				let parsed: unknown;
				try {
					parsed = JSON.parse(raw);
				} catch {
					process.stderr.write(`prometheus-state: --record-ac value is not valid JSON: ${raw}\n`);
					process.exit(1);
				}
				if (!Array.isArray(parsed)) {
					process.stderr.write(
						`prometheus-state: --record-ac value must be a JSON array, got: ${raw}\n`,
					);
					process.exit(1);
				}
				// F5: require a non-empty array of strings — an empty or mixed array is
				// unusable on resume (would persist done=true with no real AC content).
				if (parsed.length === 0 || !isStringArray(parsed)) {
					process.stderr.write(
						"prometheus-state: --record-ac must be a non-empty array of strings\n",
					);
					process.exit(1);
				}
				recordAc = parsed;
			}

			let nonGoals: string | undefined;
			if (args["record-non-goals"] !== undefined) {
				if (args["record-non-goals"] === true) {
					process.stderr.write(
						"prometheus-state: --record-non-goals requires a value or '-' for stdin\n",
					);
					process.exit(1);
				}
				const arg = String(args["record-non-goals"]);
				nonGoals = arg === "-" ? readStdinSync() : arg;
			}

			const markDesignDone = args["mark-design-done"] === true;
			const markPlanDone = args["mark-plan-done"] === true;
			const awaitUser = args["await-user"] === true;
			const reason = stringFlag(args, "reason");
			const abort = args["abort"] === true;
			if (reason !== undefined && !abort) fail("--reason is only valid with --abort");
			if (abort && (reason === undefined || reason.trim() === "")) {
				fail("--abort requires a non-empty --reason (quote the user's words)");
			}

			setPrometheusState(sessionId, {
				phase,
				plan_path: planPath,
				resume_summary: resumeSummary,
				record_ac: recordAc,
				non_goals: nonGoals,
				mark_design_done: markDesignDone || undefined,
				mark_plan_done: markPlanDone || undefined,
				submit_presentation: submitPresentation,
				await_user: awaitUser || undefined,
				abort_reason: abort ? reason : undefined,
			});
		} else if (subcommand === "clear") {
			clearPrometheusState(sessionId);
		} else if (subcommand === "list-others") {
			const candidates = listOthers("prometheus", prometheusSourceCompatibility);
			for (const c of candidates) {
				const shortSid = c.sid.slice(0, 8);
				process.stdout.write(
					`${shortSid}\t${c.sid}\t${c.purpose}\t${c.startedAt}\t${c.idleSeconds}s\n`,
				);
			}
		} else if (subcommand === "get") {
			const state = readPrometheusState(sessionId);
			if (state === null) {
				process.stderr.write(
					`prometheus-state: state file absent or invalid for session "${sessionId}". ` +
					`Run the prometheus skill to seed state first, or repair its non-goals.\n`,
				);
				process.exit(1);
			}
			process.stdout.write(JSON.stringify(state, null, 2) + "\n");
		} else if (subcommand === "adopt") {
			const srcSid = stringFlag(args, "src");
			if (!srcSid) {
				process.stderr.write("adopt: --src <sid> is required\n");
				process.exit(1);
			}
			adopt("prometheus", srcSid, prometheusSourceCompatibility);
			// Additional check: stat the adopted state's plan_path and warn if it does not resolve
			const dstPath = resolveStatePath(sessionId);
			if (existsSync(dstPath)) {
				try {
					const content = readFileSync(dstPath, "utf8");
					// JSON.parse's `any` return assigns to the annotated variable without a cast.
					const parsed: Partial<PrometheusState> = JSON.parse(content);
					const planPath = parsed.plan_path;
					if (planPath && planPath !== "") {
						try {
							statSync(planPath);
						} catch {
							process.stderr.write(
								`adopt: warning: adopted plan_path "${planPath}" does not resolve on disk. ` +
									`The state was adopted successfully, but the plan file may need to be located manually.\n`,
							);
						}
					}
				} catch {
					// parse failure: skip plan_path check
				}
			}
		} else {
			process.stderr.write(
				`Usage: prometheus-state.ts <help|${ROSTER.map((c) => c.name).join("|")}> [options]\n`,
			);
			process.exit(1);
		}
	} catch (e) {
		process.stderr.write(`prometheus-state: ${e instanceof Error ? e.message : String(e)}\n`);
		process.exit(1);
	}
}

// Only run CLI when executed directly (not when imported as a module)
if (import.meta.main) {
	main();
}
