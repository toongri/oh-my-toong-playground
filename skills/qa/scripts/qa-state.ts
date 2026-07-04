/**
 * QA skill state CLI.
 *
 * State file path: ${OMT_DIR}/qa-state-${sessionId}.json
 * Session ID: resolved from env OMT_SESSION_ID via resolveSessionIdOrThrow(); hard-fails when absent or unsafe.
 *
 * Structural mirror of goal-state.ts (iteration/max_iterations ≙ cycle/max_cycles):
 * session-keyed JSON, merge-write preserving prior fields, `started_at` seeded once
 * and never re-seeded, null-on-malformed reads.
 *
 * qa is resume-only, NOT adoption-enabled (standalone skill, not consumed by
 * goal/prometheus) — no list-others/adopt subcommands here.
 *
 * NOTE (ordering): resolveStatePath and mergeWrite reference STATE_PREFIX["qa"],
 * and ensureSeed("qa", sessionId) passes the "qa" literal — both require the
 * sibling Fork-B task to extend @lib/state-core's `StateType` union with "qa"
 * before `tsc --noEmit` will pass. `bun test` (type-erasing) runs fine before
 * that lands; typecheck failure until then is EXPECTED ordering.
 *
 * Subcommands:
 *   set --phase <phase> [--target <text>]
 *   advance-phase <phase>
 *   inc-cycle
 *   record-fix-head <sha>
 *   capture-dirty-set <json-array>
 *   note-failure <key>
 *   complete
 *   get
 *   status
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { getOmtDir } from "@lib/omt-dir";
import {
	mergeWithHeartbeat,
	resolveSessionIdOrThrow,
	writeFileNoCreate,
	ensureSeed,
	STATE_PREFIX,
} from "@lib/state-core";

/** Phases of the qa cycle: PRE-FLIGHT → PLAN → BASELINE → ADVERSARIAL E2E → CHECK →
 * [DIAGNOSIS→FIX→RE-VERIFY loop] → EXIT → CLEANUP → ROLLBACK → STATE. */
const QA_PHASES = [
	"PRE-FLIGHT",
	"PLAN",
	"BASELINE",
	"ADVERSARIAL E2E",
	"CHECK",
	"DIAGNOSIS",
	"FIX",
	"RE-VERIFY",
	"EXIT",
	"CLEANUP",
	"ROLLBACK",
	"STATE",
] as const;
export type QaPhase = (typeof QA_PHASES)[number];

const DEFAULT_MAX_CYCLES = 5;

export interface QaState {
	active: boolean;
	phase: QaPhase;
	/** Pursuit-cycle counter; incremented at FIX dispatch only (inc-cycle). Base 0. */
	cycle: number;
	/** Finite cap on fix cycles. Terminate when cycle === max_cycles. */
	max_cycles: number;
	/** Equality key: scenario-id + root-cause-file + root-cause-symbol/category (NOT :line). */
	same_failure_key: string;
	/** Accumulates while same_failure_key is stable; resets to 1 on a new key. Terminate at 3. */
	same_failure_count: number;
	/** HEAD sha recorded at FIX dispatch — the ROLLBACK revert-range lower bound. */
	fix_head_before: string;
	/** PRE-FLIGHT `git status --porcelain` snapshot of the user's pre-existing dirty files, as porcelain status lines (`XY <path>`). */
	user_dirty_set: string[];
	/** The verification target/spec ref (short string; also the listOthers purpose, per sibling task). */
	target: string;
	/** Local ISO-8601 without milliseconds, seeded once. */
	started_at: string;
	/** Refreshed on every write (heartbeat). */
	last_touched_at: string;
}

// ---------------------------------------------------------------------------
// IO helpers (safe read, no import from hooks/)
// ---------------------------------------------------------------------------

function readFileOrNull(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

/** True iff `err` is an Error-shaped value carrying a Node.js `code` field. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

/** Type guard: true iff `value` is a string appearing in `options`; narrows to the literal union of `options`. */
function isOneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
	return typeof value === "string" && options.includes(value);
}

// ---------------------------------------------------------------------------
// Path resolution — identical dir resolution as goal-state
// ---------------------------------------------------------------------------

export function resolveStatePath(sessionId: string): string {
	return `${getOmtDir()}/${STATE_PREFIX["qa"]}${sessionId}.json`;
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
		const d = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	}
}

// ---------------------------------------------------------------------------
// Internal: read prior state (raw, regardless of active), {} on malformed
// ---------------------------------------------------------------------------

function readPrior(sessionId: string): Partial<QaState> {
	const content = readFileOrNull(resolveStatePath(sessionId));
	if (!content) return {};
	try {
		return JSON.parse(content);
	} catch {
		return {};
	}
}

/**
 * Merge `next` over the prior on-disk state, seeding `started_at` once and
 * supplying field defaults on first write. Persists and returns the result.
 *
 * Strict no-create: refuses and exits non-zero when the state file is absent
 * AND ensureSeed's self-heal did not create it (e.g. adopted-away sid).
 */
function mergeWrite(sessionId: string, next: Partial<QaState>): QaState {
	// Self-heal: seed the pristine skeleton if the PreToolUse hook never fired
	// (e.g. slash-command entry). No-op when the file already exists.
	ensureSeed("qa", sessionId);
	const stateFilePath = resolveStatePath(sessionId);
	const prior = readPrior(sessionId);
	const maxCyclesCandidate = next.max_cycles ?? prior.max_cycles;
	const partial: Omit<QaState, "last_touched_at"> = {
		active: next.active ?? prior.active ?? true,
		phase: next.phase ?? prior.phase ?? "PRE-FLIGHT",
		cycle: next.cycle ?? prior.cycle ?? 0,
		max_cycles:
			typeof maxCyclesCandidate === "number" &&
			Number.isInteger(maxCyclesCandidate) &&
			maxCyclesCandidate >= 1
				? maxCyclesCandidate
				: DEFAULT_MAX_CYCLES,
		same_failure_key: next.same_failure_key ?? prior.same_failure_key ?? "",
		same_failure_count: next.same_failure_count ?? prior.same_failure_count ?? 0,
		fix_head_before: next.fix_head_before ?? prior.fix_head_before ?? "",
		user_dirty_set: next.user_dirty_set ?? prior.user_dirty_set ?? [],
		target: next.target ?? prior.target ?? "",
		started_at: prior.started_at ?? seedStartedAt(),
	};
	const state: QaState = mergeWithHeartbeat(partial, {});
	try {
		writeFileNoCreate(stateFilePath, JSON.stringify(state, null, 2));
	} catch (err) {
		if (isErrnoException(err) && err.code === "ENOENT") {
			throw new Error(
				`qa-state: state file absent for session "${sessionId}". ` +
					`Possible causes: state adopted by another session, or seed missing. ` +
					`Re-invoke the qa skill to re-seed.`,
				{ cause: err },
			);
		}
		throw err;
	}
	return state;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readQaState(sessionId: string): QaState | null {
	const content = readFileOrNull(resolveStatePath(sessionId));
	if (!content) return null;
	try {
		const state = JSON.parse(content);
		if (
			typeof state.active !== "boolean" ||
			!isOneOf(state.phase, QA_PHASES) ||
			!Number.isInteger(state.cycle) ||
			state.cycle < 0 ||
			!Number.isInteger(state.max_cycles) ||
			state.max_cycles < 1
		) {
			return null;
		}
		return state.active ? state : null;
	} catch {
		return null;
	}
}

export interface SetQaOpts {
	/**
	 * Raw untrusted phase string (CLI/caller-supplied). `setQaState` is the runtime
	 * validator — it narrows this to `QaPhase` via the QA_PHASES guard below and
	 * throws (with the original string preserved in the message) when out-of-enum.
	 */
	phase?: string;
	target?: string;
}

/** General setter: phase + target. Refuses an out-of-enum phase. */
export function setQaState(sessionId: string, opts: SetQaOpts): void {
	if (opts.phase !== undefined && !isOneOf(opts.phase, QA_PHASES)) {
		throw new Error(`set: phase must be one of ${QA_PHASES.join("|")} (got "${opts.phase}")`);
	}
	mergeWrite(sessionId, {
		phase: opts.phase as QaPhase | undefined,
		target: opts.target,
	});
}

/** Advances phase only (does not touch target). Refuses an out-of-enum phase. */
export function advancePhase(sessionId: string, phase: string): void {
	if (!isOneOf(phase, QA_PHASES)) {
		throw new Error(`advance-phase: phase must be one of ${QA_PHASES.join("|")} (got "${phase}")`);
	}
	mergeWrite(sessionId, { phase });
}

/**
 * Increments the fix-cycle counter (called at FIX dispatch). Refuses once the
 * counter is already at max_cycles (the terminate condition has already fired —
 * a further increment would silently exceed the pinned cap). Returns the new
 * cycle and whether this increment reached the terminate boundary.
 */
export function incCycle(sessionId: string): { cycle: number; terminate: boolean } {
	const prior = readPrior(sessionId);
	const maxCycles = prior.max_cycles ?? DEFAULT_MAX_CYCLES;
	const cur = prior.cycle ?? 0;
	if (cur >= maxCycles) {
		throw new Error(
			`inc-cycle: refused — cycle already at max_cycles (${maxCycles}); terminate condition already reached`,
		);
	}
	const next = cur + 1;
	mergeWrite(sessionId, { cycle: next });
	return { cycle: next, terminate: next === maxCycles };
}

/** Records the HEAD sha at FIX dispatch — the ROLLBACK revert-range lower bound. */
export function recordFixHead(sessionId: string, sha: string): void {
	mergeWrite(sessionId, { fix_head_before: sha });
}

/** Records the PRE-FLIGHT `git status --porcelain` snapshot of user-dirty files. */
export function captureDirtySet(sessionId: string, files: string[]): void {
	mergeWrite(sessionId, { user_dirty_set: files });
}

/**
 * Same-Failure bookkeeping: if `key` matches the stored `same_failure_key`,
 * increments `same_failure_count`; otherwise resets it to 1 and updates the
 * stored key. Terminate signaled at count >= 3 (a latch, not an equality
 * check — a resumed/repeated call after count already reached 3 must still
 * report terminate, not silently pass through).
 */
export function noteFailure(
	sessionId: string,
	key: string,
): { same_failure_count: number; terminate: boolean } {
	const prior = readPrior(sessionId);
	const priorKey = prior.same_failure_key ?? "";
	const priorCount = prior.same_failure_count ?? 0;
	const count = key === priorKey ? priorCount + 1 : 1;
	mergeWrite(sessionId, { same_failure_key: key, same_failure_count: count });
	return { same_failure_count: count, terminate: count >= 3 };
}

/**
 * Marks the qa cycle inactive at the terminal STATE phase (Goal Met / max_cycles /
 * Same-Failure-3x / Safety). Without this, `active` stays `true` forever (mergeWrite
 * has no other path to `false`), and a completed cycle gets resurrected by the
 * session-start restore banner on the next session.
 */
export function completeQa(sessionId: string): void {
	mergeWrite(sessionId, { active: false });
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

function str(v: string | boolean | undefined): string | undefined {
	return v !== undefined ? String(v) : undefined;
}

function main(): void {
	const args = parseArgs(process.argv.slice(2));
	const subcommand = args["_subcommand"];
	let sessionId: string;
	try {
		sessionId = resolveSessionIdOrThrow();
	} catch (e) {
		process.stderr.write(`qa-state: ${String(e)}\n`);
		process.exit(1);
	}

	try {
		if (subcommand === "set") {
			setQaState(sessionId, {
				phase: str(args["phase"]),
				target: str(args["target"]),
			});
		} else if (subcommand === "advance-phase") {
			const rawPhase = process.argv.slice(3).find((a) => !a.startsWith("--"));
			if (!rawPhase) {
				process.stderr.write("advance-phase: <phase> argument is required\n");
				process.exit(1);
			}
			advancePhase(sessionId, rawPhase);
		} else if (subcommand === "inc-cycle") {
			const result = incCycle(sessionId);
			process.stdout.write(JSON.stringify(result) + "\n");
		} else if (subcommand === "record-fix-head") {
			const sha = process.argv.slice(3).find((a) => !a.startsWith("--"));
			if (!sha) {
				process.stderr.write("record-fix-head: <sha> argument is required\n");
				process.exit(1);
			}
			recordFixHead(sessionId, sha);
		} else if (subcommand === "capture-dirty-set") {
			const jsonArg = process.argv.slice(3).find((a) => !a.startsWith("--"));
			if (!jsonArg) {
				process.stderr.write("capture-dirty-set: <json-array> argument is required\n");
				process.exit(1);
			}
			let parsed: string[];
			try {
				parsed = JSON.parse(jsonArg);
				if (!Array.isArray(parsed)) throw new Error("expected JSON array");
			} catch (e) {
				process.stderr.write(`capture-dirty-set: invalid JSON — ${String(e)}\n`);
				process.exit(1);
			}
			captureDirtySet(sessionId, parsed);
		} else if (subcommand === "note-failure") {
			const key = process.argv.slice(3).find((a) => !a.startsWith("--"));
			if (!key) {
				process.stderr.write("note-failure: <key> argument is required\n");
				process.exit(1);
			}
			const result = noteFailure(sessionId, key);
			process.stdout.write(JSON.stringify(result) + "\n");
		} else if (subcommand === "complete") {
			completeQa(sessionId);
		} else if (subcommand === "get") {
			process.stdout.write(JSON.stringify(readQaState(sessionId)) + "\n");
		} else if (subcommand === "status") {
			const state = readQaState(sessionId);
			process.stdout.write((state ? state.phase : "absent") + "\n");
		} else {
			process.stderr.write(
				"Usage: qa-state.ts <set|advance-phase|inc-cycle|record-fix-head|capture-dirty-set|note-failure|complete|get|status> [options]\n",
			);
			process.exit(1);
		}
	} catch (e) {
		process.stderr.write(`qa-state: ${String(e)}\n`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main();
}
