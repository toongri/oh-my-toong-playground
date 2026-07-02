/**
 * Prometheus skill state CLI.
 *
 * State file path: ${OMT_DIR}/prometheus-state-${sessionId}.json
 * Session ID: resolved via resolveSessionIdOrThrow() (hard-fail on absent/unsafe)
 *
 * Subcommands:
 *   set --phase <S> [--plan-path <p>] [--resume-summary <s>]
 *       [--record-ac '<json-array>' | --record-ac - (reads JSON array from stdin)]
 *       [--mark-design-done] [--mark-plan-done]
 *   get
 *   clear
 */

import { existsSync, readFileSync, unlinkSync, statSync } from "fs";
import { execSync } from "child_process";
import {
	mergeWithHeartbeat,
	resolveSessionIdOrThrow,
	listOthers,
	adopt,
	writeFileNoCreate,
	ensureSeed,
} from "@lib/state-core";

export interface PrometheusState {
	active: boolean;
	/** Pipeline token: S0-S8 */
	phase: string;
	/** Absolute path under $OMT_DIR/plans/, empty string until plan written */
	plan_path: string;
	/** Single-line pause bookmark, control chars normalized to spaces */
	resume_summary: string;
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
// Path resolution
// ---------------------------------------------------------------------------

function getOmtDir(): string {
	const dir = process.env.OMT_DIR;
	if (!dir) throw new Error("OMT_DIR environment variable is not set");
	return dir;
}

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
		return state.active ? state : null;
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
		/** Parsed AC string array — sets steps.acceptance_criteria.{done,content,recorded_at=phase}. */
		record_ac?: string[];
		/** Sets steps.design_decisions.{done:true, ref=current plan_path}. */
		mark_design_done?: boolean;
		/** Sets steps.plan.done=true. */
		mark_plan_done?: boolean;
	},
): void {
	// Self-heal: seed the pristine skeleton if the PreToolUse hook never fired
	// (e.g. slash-command entry). No-op when the file already exists; the strict
	// writeFileNoCreate below is unchanged (ADR-7 mid-flight guard preserved).
	ensureSeed("prometheus", sessionId);
	const path = resolveStatePath(sessionId);
	const existing = readFileOrNull(path);
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

	const resolvedPlanPath = opts.plan_path ?? prior.plan_path ?? "";

	// F6: marking design done with no plan_path would persist done=true, ref="" —
	// resume then treats design as complete but has no ADR pointer. Loud error
	// instead of a silent ordering hazard.
	if (opts.mark_design_done && resolvedPlanPath === "") {
		process.stderr.write(
			"prometheus-state: --mark-design-done requires plan_path to be set " +
				"(pass --plan-path or set it earlier at S2)\n",
		);
		process.exit(1);
	}

	const priorSteps = prior.steps ?? FRESH_STEPS;

	// Merge each step sub-object — only update the sub-object whose flag was passed.
	const steps: PrometheusState["steps"] = {
		acceptance_criteria:
			opts.record_ac !== undefined
				? { done: true, content: opts.record_ac, recorded_at: opts.phase }
				: priorSteps.acceptance_criteria,
		design_decisions: opts.mark_design_done
			? { done: true, ref: resolvedPlanPath }
			: priorSteps.design_decisions,
		plan: opts.mark_plan_done ? { done: true } : priorSteps.plan,
	};

	const partial: Omit<PrometheusState, "last_touched_at"> = {
		active: true,
		phase: opts.phase,
		plan_path: resolvedPlanPath,
		resume_summary: normalizeResumeSummary(opts.resume_summary ?? prior.resume_summary ?? ""),
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

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	const subcommand = args["_subcommand"];
	let sessionId: string;
	try {
		sessionId = resolveSessionIdOrThrow();
	} catch (e) {
		process.stderr.write(`prometheus-state: ${String(e)}\n`);
		process.exit(1);
	}

	try {
		if (subcommand === "set") {
			const phase = String(args["phase"] ?? "");
			const planPath = args["plan-path"] !== undefined ? String(args["plan-path"]) : undefined;
			const resumeSummary =
				args["resume-summary"] !== undefined ? String(args["resume-summary"]) : undefined;

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

			const markDesignDone = args["mark-design-done"] === true;
			const markPlanDone = args["mark-plan-done"] === true;

			setPrometheusState(sessionId, {
				phase,
				plan_path: planPath,
				resume_summary: resumeSummary,
				record_ac: recordAc,
				mark_design_done: markDesignDone || undefined,
				mark_plan_done: markPlanDone || undefined,
			});
		} else if (subcommand === "clear") {
			clearPrometheusState(sessionId);
		} else if (subcommand === "list-others") {
			const candidates = listOthers("prometheus");
			for (const c of candidates) {
				const shortSid = c.sid.slice(0, 8);
				process.stdout.write(
					`${shortSid}\t${c.sid}\t${c.purpose}\t${c.startedAt}\t${c.idleSeconds}s\n`,
				);
			}
		} else if (subcommand === "get") {
			const statePath = resolveStatePath(sessionId);
			const content = readFileOrNull(statePath);
			if (content === null) {
				process.stderr.write(
					`prometheus-state: state file absent for session "${sessionId}". ` +
						`Run the prometheus skill to seed state first.\n`,
				);
				process.exit(1);
			}
			process.stdout.write(content + "\n");
		} else if (subcommand === "adopt") {
			const srcSid = args["src"] !== undefined ? String(args["src"]) : undefined;
			if (!srcSid) {
				process.stderr.write("adopt: --src <sid> is required\n");
				process.exit(1);
			}
			adopt("prometheus", srcSid);
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
				"Usage: prometheus-state.ts <set|get|clear|list-others|adopt> [options]\n",
			);
			process.exit(1);
		}
	} catch (e) {
		process.stderr.write(`prometheus-state: ${String(e)}\n`);
		process.exit(1);
	}
}

// Only run CLI when executed directly (not when imported as a module)
if (import.meta.main) {
	main();
}
