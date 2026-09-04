/**
 * QA skill state CLI.
 *
 * State file path: ${OMT_DIR}/qa-state-${sessionId}.json
 * Session ID: resolved from env OMT_SESSION_ID, falling back to CODEX_THREAD_ID (Codex), via resolveSessionIdOrThrow(); hard-fails when neither is set or unsafe.
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

import { closeSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync } from "fs";
import { execSync } from "child_process";
import { extname, resolve } from "path";
import { getOmtDir } from "@lib/omt-dir";
import {
	mergeWithHeartbeat,
	resolveSessionIdOrThrow,
	writeFileNoCreate,
	ensureSeed,
	STATE_PREFIX,
} from "@lib/state-core";
import {
	BASELINE_INDEX,
	QA_PHASES,
	approveOk,
	chainComplete,
	commentOk,
	cycleUntouched,
	driverGateArmed,
	recordComplete,
	rosterComplete,
	type QaActor,
	type QaBaseline,
	type QaCell,
	type QaChainState,
	type QaDriver,
	type QaPhase,
	type QaRunCheckHistory,
	type QaRunChecks,
	type QaStory,
	type QaWaive,
	type QaInert,
} from "@lib/qa-chain-core";

const DEFAULT_MAX_CYCLES = 5;

export interface QaState extends QaChainState {
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

type ChainState = QaState & QaChainState;
type QaStateSeed = Pick<
	QaState,
	| "active"
	| "phase"
	| "cycle"
	| "max_cycles"
	| "same_failure_key"
	| "same_failure_count"
	| "fix_head_before"
	| "user_dirty_set"
	| "target"
	| "started_at"
> & QaChainState;

const DRIVERS = ["agent-device", "agent-browser", "curl", "bash"] as const;
const PRIORITIES = ["H", "M", "L"] as const;
const RESULTS = ["pass", "fail", "na"] as const;
const BINARY_RESULTS = ["pass", "fail"] as const;
const CHECKS = ["stale-state", "dirty-worktree", "flaky-rerun"] as const;
const VERDICTS = ["APPROVE", "COMMENT", "REQUEST_CHANGES"] as const;
type CheckName = (typeof CHECKS)[number];

function nonEmpty(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
	return value;
}

function currentCycle(state: Partial<ChainState>): number {
	return typeof state.cycle === "number" && Number.isInteger(state.cycle) ? state.cycle : 0;
}

function probeEvidence(path: string, surface: string, driver: QaDriver): string {
	const absolute = resolve(path);
	if (surface !== driver) throw new Error(`evidence-surface must match actor driver "${driver}"`);
	const size = (() => {
		try {
			return statSync(absolute).size;
		} catch {
			throw new Error(`evidence-path does not exist: ${absolute}`);
		}
	})();
	if (size <= 0) throw new Error(`evidence-path is empty: ${absolute}`);
	return absolute;
}

/** Like probeEvidence, but for a supplementary 3-slot capture path — no driver/surface match required. */
function probePlainFile(path: string): string {
	const absolute = resolve(path);
	const size = (() => {
		try {
			return statSync(absolute).size;
		} catch {
			throw new Error(`evidence-path does not exist: ${absolute}`);
		}
	})();
	if (size <= 0) throw new Error(`evidence-path is empty: ${absolute}`);
	return absolute;
}

// Signatures of a unit/integration test-RUNNER report (vitest, jest, pytest,
// mocha, go test). A scenario cell's evidence must be a user-boundary
// observation — a rendered screen/device capture, the client-received API
// response, or the terminal a CLI user actually operates. A test-runner report
// proves code in isolation, NOT the boundary an actor touches, so it can never
// stand as a cell's proof. (BASELINE evidence is exempt — build/test/lint logs
// are its whole point — so this is enforced only on record-cell.) Images and
// other binaries can never be a test log, so they are skipped by extension.
const TEST_RUNNER_SIGNATURES: RegExp[] = [
	/\bRUN\s+v\d+\.\d+\.\d+/, // vitest banner
	/\bTest Files\s+\d+\s+(passed|failed)/, // vitest summary
	/\bTests\s+\d+\s+(passed|failed)/, // vitest / generic summary
	/\bTest Suites:\s+\d+\s+(passed|failed|total)/, // jest
	/^PASS\s+.+\.(test|spec)\.[cm]?[jt]sx?/m, // jest per-file
	/\b\d+\s+passing\b/, // mocha
	/=+\s*(test session starts|\d+ passed)/, // pytest banner / normal summary
	/^\s*\d+ (passed|failed|error|errors|skipped|xfailed|xpassed|deselected)\b[^\n]*\bin [\d.]+s/m, // pytest quiet summary (no === banner; covers fail/error too)
	/^--- (PASS|FAIL):/m, // go test -v
	/^(ok|FAIL)\s+\S+\s+[\d.]+s\s*$/m, // go test summary
];

// Prefix scanned for a test-runner signature. A report's summary/banner always
// lands well within this window, so a longer capture need never be read in full.
const EVIDENCE_SCAN_BYTES = 65536;

const NON_TEXT_EVIDENCE_EXT = new Set([
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf",
	".mp4", ".mov", ".webm", ".zip", ".ico", ".woff", ".woff2",
]);

/**
 * Guards a scenario cell's evidence against being a test-runner report masquerading
 * as user-boundary proof — the failure the QA presentation exists to prevent (a PO
 * shown `vitest run … exit=0` as "requirement met"). Throws when the file's content
 * matches a unit/integration test-runner report. Read-capped and image-skipping so
 * the check is cheap and never fires on a screenshot / API-response capture.
 */
function assertBoundaryObservation(absolute: string): void {
	if (NON_TEXT_EVIDENCE_EXT.has(extname(absolute).toLowerCase())) return;
	let head: string;
	try {
		// Read only the inspected prefix — record-cell imposes no evidence-size
		// limit, so decoding the whole file (as readFileSync would) could consume
		// memory proportional to an oversized capture. Cap the read at the source.
		const fd = openSync(absolute, "r");
		try {
			const buf = Buffer.alloc(EVIDENCE_SCAN_BYTES);
			const bytesRead = readSync(fd, buf, 0, EVIDENCE_SCAN_BYTES, 0);
			head = buf.subarray(0, bytesRead).toString("utf8");
		} finally {
			closeSync(fd);
		}
	} catch {
		return; // unreadable/binary — probe* already validated existence+size
	}
	if (TEST_RUNNER_SIGNATURES.some((re) => re.test(head))) {
		throw new Error(
			`evidence "${absolute}" is a unit/integration test-runner report, which proves code in ` +
				`isolation — NOT the user boundary. A scenario cell's evidence must be a boundary ` +
				`observation: the rendered screen/device state, the client-received API response, or the ` +
				`terminal a CLI user actually operates. If the real boundary is unreachable, record the ` +
				`scenario as a NOT-RUN coverage delta — never as pass/na backed by a test log. ` +
				`(BASELINE build/test/lint logs are exempt; this guard is for ADVERSARIAL E2E cells.) ` +
				`See skills/qa/SKILL.md → ADVERSARIAL E2E / Boundary substitution.`,
		);
	}
}

const SCENARIO_SOURCES = ["self-authored", "caller-provided"] as const;

/** Shared optional structured-scenario fields accepted by both author-cell and record-cell. */
interface ScenarioFieldOpts {
	drivenAt?: string;
	whyNeeded?: string;
	source?: string;
}

function scenarioFieldPatch(opts: ScenarioFieldOpts): Partial<QaCell> {
	const patch: Partial<QaCell> = {};
	if (opts.drivenAt !== undefined) patch.driven_at = opts.drivenAt;
	if (opts.whyNeeded !== undefined) patch.why_needed = opts.whyNeeded;
	if (opts.source !== undefined) {
		if (!isOneOf(opts.source, SCENARIO_SOURCES)) throw new Error(`source must be one of ${SCENARIO_SOURCES.join("|")}`);
		patch.source = opts.source;
	}
	return patch;
}

/** Carries forward an authored cell's scenario fields as defaults for record-cell to override. */
function pickScenarioFields(cell: QaCell | undefined): Partial<QaCell> {
	if (!cell) return {};
	const out: Partial<QaCell> = {};
	if (cell.driven_at !== undefined) out.driven_at = cell.driven_at;
	if (cell.why_needed !== undefined) out.why_needed = cell.why_needed;
	if (cell.source !== undefined) out.source = cell.source;
	return out;
}

interface EvidenceSlotOpts {
	evidenceBefore?: string;
	evidenceAction?: string;
	evidenceAfter?: string;
}

/** Validates and resolves whichever of the 3 supplementary evidence slots were supplied. */
function buildEvidenceSlots(
	opts: EvidenceSlotOpts,
): { path: string; before?: string; action?: string; after?: string } | undefined {
	const slot: { before?: string; action?: string; after?: string } = {};
	if (opts.evidenceBefore) slot.before = probePlainFile(opts.evidenceBefore);
	if (opts.evidenceAction) slot.action = probePlainFile(opts.evidenceAction);
	if (opts.evidenceAfter) slot.after = probePlainFile(opts.evidenceAfter);
	if (Object.keys(slot).length === 0) return undefined;
	return { path: slot.action ?? slot.after ?? slot.before ?? "", ...slot };
}

function stateProbe(path: string): { exists: boolean; size: number } {
	try {
		return { exists: true, size: statSync(path).size };
	} catch {
		return { exists: false, size: 0 };
	}
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isQaState(value: Partial<ChainState>): value is QaState {
	return (
		typeof value.active === "boolean" &&
		isOneOf(value.phase, QA_PHASES) &&
		typeof value.cycle === "number" &&
		Number.isInteger(value.cycle) &&
		value.cycle >= 0 &&
		typeof value.max_cycles === "number" &&
		Number.isInteger(value.max_cycles) &&
		value.max_cycles >= 1 &&
		typeof value.same_failure_key === "string" &&
		typeof value.same_failure_count === "number" &&
		typeof value.fix_head_before === "string" &&
		Array.isArray(value.user_dirty_set) &&
		value.user_dirty_set.every((item) => typeof item === "string") &&
		typeof value.target === "string" &&
		typeof value.started_at === "string" &&
		typeof value.last_touched_at === "string"
	);
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

function readPrior(sessionId: string): Partial<ChainState> {
	const content = readFileOrNull(resolveStatePath(sessionId));
	if (!content) return {};
	try {
		const parsed: unknown = JSON.parse(content);
		if (!isRecord(parsed)) return {};
		const prior: Partial<ChainState> = {};
		Object.assign(prior, parsed);
		return prior;
	} catch {
		return {};
	}
}

// ---------------------------------------------------------------------------
// State-file lock (mkdir is atomic across the CLI processes used by QA).
// ---------------------------------------------------------------------------

const STATE_LOCK_RETRIES = 200;
const STATE_LOCK_SLEEP = new Int32Array(new SharedArrayBuffer(4));

function withStateLock<T>(stateFilePath: string, callback: () => T): T {
	const lockPath = `${stateFilePath}.lock`;
	for (let attempt = 0; attempt < STATE_LOCK_RETRIES; attempt += 1) {
		try {
			mkdirSync(lockPath);
			try {
				return callback();
			} finally {
				rmSync(lockPath, { recursive: true, force: true });
				}
		} catch (err) {
			if (!isErrnoException(err) || err.code !== "EEXIST") throw err;
			Atomics.wait(STATE_LOCK_SLEEP, 0, 0, 5);
		}
	}
	throw new Error("qa-state: state lock contended; refusing unlocked write");
}

/**
 * Merge `next` over the prior on-disk state, seeding `started_at` once and
 * supplying field defaults on first write. Persists and returns the result.
 *
 * Strict no-create: refuses and exits non-zero when the state file is absent
 * AND ensureSeed's self-heal did not create it (e.g. adopted-away sid).
 */
function mergeWriteUnlocked(sessionId: string, next: Partial<ChainState>): QaState {
	// Self-heal: seed the pristine skeleton if the PreToolUse hook never fired
	// (e.g. slash-command entry). No-op when the file already exists.
	ensureSeed("qa", sessionId);
	const stateFilePath = resolveStatePath(sessionId);
	const prior = readPrior(sessionId);
	const maxCyclesCandidate = next.max_cycles ?? prior.max_cycles;
	const partial: QaStateSeed = {
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
	const chain: QaStateSeed = { ...prior, ...partial };
	for (const [key, value] of Object.entries(next)) {
		if (value !== undefined) chain[key] = value;
	}
	const derived = {
		chain_complete: chainComplete(chain),
		record_complete: recordComplete(chain, stateProbe),
		approve_ok: approveOk(chain, stateProbe),
		comment_ok: commentOk(chain, stateProbe),
		roster_complete: rosterComplete(chain),
		driver_gate_armed: driverGateArmed(chain),
	};
	chain.derived = derived;
	const state: QaState = mergeWithHeartbeat(chain, {});
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

function mergeWrite(sessionId: string, next: Partial<ChainState>): QaState {
	return withStateLock(resolveStatePath(sessionId), () => mergeWriteUnlocked(sessionId, next));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readQaState(sessionId: string): QaState | null {
	const state = readPrior(sessionId);
	return isQaState(state) && state.active ? state : null;
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

function writePhase(sessionId: string, phase: QaPhase, target?: string): void {
	const prior = readPrior(sessionId);
	const index = QA_PHASES.indexOf(phase);
	if (index >= BASELINE_INDEX && !chainComplete(prior)) {
		throw new Error(`phase funnel: ${phase} requires a complete actor/story/scenario chain`);
	}
	const priorMax = typeof prior.phase_max === "number" && Number.isInteger(prior.phase_max) && prior.phase_max >= 0 ? prior.phase_max : 0;
	mergeWrite(sessionId, { phase, phase_max: Math.max(priorMax, index), target });
}

/** General setter: phase + target. Refuses an out-of-enum phase. */
export function setQaState(sessionId: string, opts: SetQaOpts): void {
	const phase = opts.phase;
	if (phase !== undefined && !isOneOf(phase, QA_PHASES)) {
		throw new Error(`set: phase must be one of ${QA_PHASES.join("|")} (got "${phase}")`);
	}
	if (phase === undefined) mergeWrite(sessionId, { target: opts.target });
	else writePhase(sessionId, phase, opts.target);
}

/** Advances phase only (does not touch target). Refuses an out-of-enum phase. */
export function advancePhase(sessionId: string, phase: string): void {
	if (!isOneOf(phase, QA_PHASES)) {
		throw new Error(`advance-phase: phase must be one of ${QA_PHASES.join("|")} (got "${phase}")`);
	}
	writePhase(sessionId, phase);
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

export interface AddActorOpts {
	id: string;
	name?: string;
	boundary?: string;
	driver?: string;
	reachable: string;
}

export function addActor(sessionId: string, opts: AddActorOpts): void {
	const id = nonEmpty(opts.id, "id");
	const reachable = nonEmpty(opts.reachable, "reachable");
	const prior = readPrior(sessionId);
	const actors = [...(prior.actors ?? [])];
	const index = actors.findIndex((candidate) => candidate.id === id);
	const existing = index >= 0 ? actors[index] : undefined;
	const name = opts.name ?? existing?.name;
	const boundary = opts.boundary ?? existing?.boundary;
	const driver = opts.driver ?? existing?.driver;
	if (!name || !boundary) throw new Error("name and boundary are required for a new actor");
	if (!isOneOf(driver, DRIVERS)) throw new Error(`driver must be one of ${DRIVERS.join("|")}`);
	const actor: QaActor = { id, name, boundary, driver, reachable };
	if (index >= 0) actors[index] = actor;
	else actors.push(actor);
	mergeWrite(sessionId, { actors });
}

export interface AddStoryOpts {
	id: string;
	actor: string;
}

export function addStory(sessionId: string, opts: AddStoryOpts): void {
	const id = nonEmpty(opts.id, "id");
	const actor = nonEmpty(opts.actor, "actor");
	const prior = readPrior(sessionId);
	if (!(prior.actors ?? []).some((candidate) => candidate.id === actor)) {
		throw new Error(`add-story: unknown actor "${actor}"`);
	}
	const stories = [...(prior.stories ?? [])];
	const next: QaStory = { id, actor };
	const index = stories.findIndex((candidate) => candidate.id === id);
	if (index >= 0) stories[index] = { ...stories[index], ...next };
	else stories.push(next);
	mergeWrite(sessionId, { stories });
}

function validateCellSelector(story: string, cls: unknown, sub: string | undefined): { story: string; cls: number; sub?: "hang-timeout" | "flaky-green" } {
	const storyId = nonEmpty(story, "story");
	const classNumber = typeof cls === "number" ? cls : Number(cls);
	if (!Number.isInteger(classNumber) || classNumber < 1 || classNumber > 6) throw new Error("cls must be an integer from 1 to 6");
	if (sub !== undefined && sub !== "hang-timeout" && sub !== "flaky-green") throw new Error("invalid sub");
	if (sub === "hang-timeout" && classNumber !== 1) throw new Error("hang-timeout requires cls 1");
	if (sub === "flaky-green" && classNumber !== 5) throw new Error("flaky-green requires cls 5");
	return { story: storyId, cls: classNumber, ...(sub ? { sub } : {}) };
}

function sameCell(left: Pick<QaCell, "story" | "cls" | "sub">, right: Pick<QaCell, "story" | "cls" | "sub">): boolean {
	return left.story === right.story && left.cls === right.cls && left.sub === right.sub;
}

export interface AuthorCellOpts extends ScenarioFieldOpts {
	story: string;
	cls: number;
	sub?: string;
	attackPoint: string;
	priority: string;
}

export function authorCell(sessionId: string, opts: AuthorCellOpts): void {
	const selector = validateCellSelector(opts.story, opts.cls, opts.sub);
	const attackPoint = nonEmpty(opts.attackPoint, "attack-point");
	if (!isOneOf(opts.priority, PRIORITIES)) throw new Error(`priority must be one of ${PRIORITIES.join("|")}`);
	const prior = readPrior(sessionId);
	if (!(prior.stories ?? []).some((story) => story.id === selector.story)) throw new Error(`author-cell: unknown story "${selector.story}"`);
	const cycle = currentCycle(prior);
	const cells = [...(prior.cells ?? [])];
	const scenarioPatch = scenarioFieldPatch(opts);
	const next: QaCell = { ...selector, attack_point: attackPoint, priority: opts.priority, cycle, ...scenarioPatch };
	const index = cells.findIndex((cell) => cell.cycle === cycle && sameCell(cell, selector));
	if (index >= 0) cells[index] = next;
	else cells.push(next);
	mergeWrite(sessionId, { cells });
}

function actorDriver(state: QaChainState, storyId: string): QaDriver {
	const story = (state.stories ?? []).find((candidate) => candidate.id === storyId);
	if (!story) throw new Error(`unknown story "${storyId}"`);
	const actorId = story.actor ?? story.actor_id;
	const actor = (state.actors ?? []).find((candidate) => candidate.id === actorId);
	if (!actor || !actor.driver || !isOneOf(actor.driver, DRIVERS)) throw new Error(`story "${storyId}" has no valid actor driver`);
	return actor.driver;
}

export interface RecordBaselineOpts {
	story: string;
	result: string;
	note?: string;
	evidencePath?: string;
	evidenceSurface?: string;
}

export function recordBaseline(sessionId: string, opts: RecordBaselineOpts): void {
	const storyId = nonEmpty(opts.story, "story");
	if (!isOneOf(opts.result, BINARY_RESULTS)) throw new Error("result must be pass or fail");
	const prior = readPrior(sessionId);
	const story = (prior.stories ?? []).find((candidate) => candidate.id === storyId);
	if (!story) throw new Error(`record-baseline: unknown story "${storyId}"`);
	const cycle = currentCycle(prior);
	let evidence: { path: string; surface: string } | undefined;
	if (opts.result === "pass") {
		if (!opts.evidencePath || !opts.evidenceSurface) throw new Error("pass baseline requires evidence-path and evidence-surface");
		evidence = { path: probeEvidence(opts.evidencePath, opts.evidenceSurface, actorDriver(prior, storyId)), surface: opts.evidenceSurface };
	}
	const baseline: QaBaseline = { result: opts.result, ...(opts.note !== undefined ? { note: opts.note } : {}), ...(evidence ? { evidence, cycle } : { cycle }) };
	const stories = [...(prior.stories ?? [])];
	const index = stories.findIndex((candidate) => candidate.id === storyId);
	const existing = stories[index];
	if (!existing) throw new Error(`record-baseline: unknown story "${storyId}"`);
	const priorHistory = existing.baseline_history ? [...existing.baseline_history] : [];
	if (existing.baseline && existing.baseline.cycle !== cycle) priorHistory.push(existing.baseline);
	stories[index] = { ...existing, baseline, ...(priorHistory.length ? { baseline_history: priorHistory } : {}) };
	mergeWrite(sessionId, { stories });
}

export interface RecordCellOpts extends ScenarioFieldOpts, EvidenceSlotOpts {
	story: string;
	cls: number;
	sub?: string;
	status: string;
	naReason?: string;
	evidencePath?: string;
	evidenceSurface?: string;
}

export function recordCell(sessionId: string, opts: RecordCellOpts): void {
	const selector = validateCellSelector(opts.story, opts.cls, opts.sub);
	if (!isOneOf(opts.status, RESULTS)) throw new Error(`status must be one of ${RESULTS.join("|")}`);
	const prior = readPrior(sessionId);
	const cycle = currentCycle(prior);
	const authored = (prior.cells ?? []).find((cell) => cell.cycle === cycle && sameCell(cell, selector));
	if (!authored || !authored.attack_point || !authored.priority) throw new Error("record-cell requires an authored current-cycle cell");
	if (opts.status === "na" && !opts.naReason?.trim()) throw new Error("na status requires na-reason");
	const scenarioPatch = scenarioFieldPatch(opts);
	let evidence: QaCell["evidence"];
	if (opts.status === "pass") {
		if (!opts.evidencePath || !opts.evidenceSurface) throw new Error("pass cell requires evidence-path and evidence-surface");
		evidence = { path: probeEvidence(opts.evidencePath, opts.evidenceSurface, actorDriver(prior, selector.story)), surface: opts.evidenceSurface };
	}
	const slots = buildEvidenceSlots(opts);
	if (slots) {
		evidence = {
			path: evidence?.path ?? slots.path,
			surface: evidence?.surface ?? opts.evidenceSurface ?? actorDriver(prior, selector.story),
			...(slots.before !== undefined ? { before: slots.before } : {}),
			...(slots.action !== undefined ? { action: slots.action } : {}),
			...(slots.after !== undefined ? { after: slots.after } : {}),
		};
	}
	// A cell's evidence is a user-boundary observation — never a test-runner report.
	// Enforced here (record-cell), not on record-baseline where test/build/lint logs
	// are the expected evidence.
	if (evidence) {
		for (const p of [evidence.path, evidence.before, evidence.action, evidence.after]) {
			if (p) assertBoundaryObservation(p);
		}
	}
	const next: QaCell = {
		...selector,
		attack_point: authored.attack_point,
		priority: authored.priority,
		status: opts.status,
		cycle,
		...(opts.naReason !== undefined ? { na_reason: opts.naReason } : {}),
		...pickScenarioFields(authored),
		...scenarioPatch,
		...(evidence ? { evidence } : {}),
	};
	const cells = [...(prior.cells ?? [])];
	const index = cells.findIndex((cell) => cell.cycle === cycle && sameCell(cell, selector));
	cells[index] = next;
	mergeWrite(sessionId, { cells });
}

export interface RecordRunCheckOpts {
	check: string;
	result: string;
	note?: string;
}

export function recordRunCheck(sessionId: string, opts: RecordRunCheckOpts): void {
	if (!isOneOf(opts.check, CHECKS)) throw new Error(`check must be one of ${CHECKS.join("|")}`);
	if (!isOneOf(opts.result, BINARY_RESULTS)) throw new Error("result must be pass or fail");
	if (opts.result === "fail" && !opts.note?.trim()) throw new Error("fail result requires note");
	const prior = readPrior(sessionId);
	const cycle = currentCycle(prior);
	const key = opts.check;
	const existingChecks: QaRunChecks = { ...(prior.run_checks ?? {}) };
	const history: QaRunCheckHistory = { ...(prior.run_checks_history ?? {}) };
	const fields: Record<CheckName, keyof QaRunChecks> = {
		"stale-state": "stale_state",
		"dirty-worktree": "dirty_worktree",
		"flaky-rerun": "flaky_rerun",
	};
	const field = fields[key];
	const old = existingChecks[field];
	if (old && typeof old !== "string" && old.cycle !== cycle) {
		history[key] = [...(history[key] ?? []), old];
	}
	existingChecks[field] = { result: opts.result, ...(opts.note !== undefined ? { note: opts.note } : {}), cycle };
	mergeWrite(sessionId, { run_checks: existingChecks, ...(Object.keys(history).length ? { run_checks_history: history } : {}) });
}

export function setVerdict(sessionId: string, verdict: string): void {
	if (!isOneOf(verdict, VERDICTS)) {
		throw new Error("set-verdict: verdict must be APPROVE, COMMENT, or REQUEST_CHANGES");
	}
	withStateLock(resolveStatePath(sessionId), () => {
		ensureSeed("qa", sessionId);
		const prior = readPrior(sessionId);
		if (verdict === "APPROVE" && !approveOk(prior, stateProbe)) {
			throw new Error("set-verdict: APPROVE refused — approveOk is false; record/waive cells or use REQUEST_CHANGES");
		}
		if (verdict === "COMMENT" && !commentOk(prior, stateProbe)) {
			throw new Error("set-verdict: COMMENT refused — commentOk is false; resolve all H-priority cells");
		}
		mergeWriteUnlocked(sessionId, { verdict });
	});
}

export function waiveCell(sessionId: string, opts: { story: string; cls: number; sub?: string; reason: string }): void {
	const selector = validateCellSelector(opts.story, opts.cls, opts.sub);
	const reason = nonEmpty(opts.reason, "reason");
	const prior = readPrior(sessionId);
	const cycle = currentCycle(prior);
	if (!(prior.stories ?? []).some((story) => story.id === selector.story)) throw new Error(`waive: unknown story "${selector.story}"`);
	if (!(prior.cells ?? []).some((cell) => cell.cycle === cycle && sameCell(cell, selector))) {
		throw new Error("waive: cell must be authored in the current cycle");
	}
	const waives = [...(prior.waives ?? [])];
	const next: QaWaive = { ...selector, cycle, reason };
	const index = waives.findIndex((item) => item.cycle === cycle && sameCell(item, selector));
	if (index >= 0) waives[index] = next;
	else waives.push(next);
	mergeWrite(sessionId, { waives });
}

export function declareInert(sessionId: string, reason: string): void {
	mergeWrite(sessionId, { inert: { declared: true, reason: nonEmpty(reason, "reason"), cycle: currentCycle(readPrior(sessionId)) } });
}

/** Persists the acceptance criteria (full-replace) so the report renders them from records. */
export function setAcceptance(sessionId: string, criteria: string[]): void {
	if (!Array.isArray(criteria)) throw new Error("set-acceptance: expected a JSON array of strings");
	if (!criteria.every((item) => typeof item === "string")) {
		throw new Error("set-acceptance: every acceptance item must be a string");
	}
	const cleaned = criteria.map((item) => nonEmpty(item, "acceptance item"));
	mergeWrite(sessionId, { acceptance_criteria: cleaned });
}

/** Re-enters a session with a fresh, empty QA cycle. */
export function startQa(sessionId: string, target: string): void {
	const stateFilePath = resolveStatePath(sessionId);
	withStateLock(stateFilePath, () => {
		ensureSeed("qa", sessionId);
		const prior = readPrior(sessionId);
		if (prior.active !== false && !cycleUntouched(prior)) {
			throw new Error("start: refused — active cycle has work; run gated complete first");
		}
		const reset: QaStateSeed = {
			...prior,
			active: true,
			phase: "PRE-FLIGHT",
			phase_max: 0,
			cycle: 0,
			max_cycles: prior.max_cycles ?? DEFAULT_MAX_CYCLES,
			same_failure_key: "",
			same_failure_count: 0,
			fix_head_before: "",
			user_dirty_set: [],
			target: nonEmpty(target, "target"),
			started_at: prior.started_at ?? seedStartedAt(),
			actors: [],
			stories: [],
			cells: [],
			run_checks: null,
			waives: [],
			acceptance_criteria: [],
			verdict: null,
		};
		delete reset.inert;
		delete reset.run_checks_history;
		reset.derived = {
			chain_complete: chainComplete(reset),
			record_complete: recordComplete(reset, stateProbe),
			approve_ok: approveOk(reset, stateProbe),
			comment_ok: commentOk(reset, stateProbe),
			roster_complete: rosterComplete(reset),
			driver_gate_armed: driverGateArmed(reset),
		};
		const state: QaState = mergeWithHeartbeat(reset, {});
		writeFileNoCreate(stateFilePath, JSON.stringify(state, null, 2));
	});
}

/**
 * Marks the qa cycle inactive at the terminal STATE phase (Goal Met / max_cycles /
 * Same-Failure-3x / Safety). Without this, `active` stays `true` forever (mergeWrite
 * has no other path to `false`), and a completed cycle gets resurrected by the
 * session-start restore banner on the next session.
 */
export function completeQa(sessionId: string): void {
	withStateLock(resolveStatePath(sessionId), () => {
		ensureSeed("qa", sessionId);
		const prior = readPrior(sessionId);
		const verdict = prior.verdict;
		const canComplete =
			(verdict === "APPROVE" && approveOk(prior, stateProbe)) ||
			(verdict === "COMMENT" && commentOk(prior, stateProbe)) ||
			(verdict === "REQUEST_CHANGES" && (recordComplete(prior, stateProbe) || cycleUntouched(prior)));
		if (!canComplete) {
			throw new Error("complete: refused — unmet verdict/record predicate; run set-verdict after recording the current cycle");
		}
		mergeWriteUnlocked(sessionId, { active: false });
	});
}

export type QaView = QaState & {
	prior_cycle_cells: QaCell[];
	prior_cycle_waives: QaWaive[];
	verdict_report: { verdict: QaState["verdict"]; cycle: number; waives: QaWaive[]; inert?: QaInert };
};

function isPriorCycleRecord(value: unknown, cycle: number): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"cycle" in value &&
		typeof value.cycle === "number" &&
		value.cycle !== cycle
	);
}

export function readQaView(sessionId: string): QaView | null {
	const state = readQaState(sessionId);
	if (!state) return null;
	const cycle = currentCycle(state);
	const cells = state.cells ?? [];
	const waives = state.waives ?? [];
	const currentWaives = waives.filter((waive) => waive.cycle === cycle);
	const currentInert = state.inert?.cycle === undefined || state.inert.cycle === cycle ? state.inert : undefined;
	const stories = (state.stories ?? []).map((story) => ({
		...story,
		baseline: isPriorCycleRecord(story.baseline, cycle) ? null : story.baseline,
	}));
	const runChecks = state.run_checks
		? {
				stale_state: isPriorCycleRecord(state.run_checks.stale_state, cycle) ? null : state.run_checks.stale_state,
				dirty_worktree: isPriorCycleRecord(state.run_checks.dirty_worktree, cycle)
					? null
					: state.run_checks.dirty_worktree,
				flaky_rerun: isPriorCycleRecord(state.run_checks.flaky_rerun, cycle) ? null : state.run_checks.flaky_rerun,
			}
		: state.run_checks;
	return {
		...state,
		stories,
		run_checks: runChecks,
		cells: cells.filter((cell) => cell.cycle === cycle),
		waives: currentWaives,
		prior_cycle_cells: cells.filter((cell) => cell.cycle !== cycle),
		prior_cycle_waives: waives.filter((waive) => waive.cycle !== cycle),
		verdict_report: { verdict: state.verdict, cycle, waives: currentWaives, ...(currentInert ? { inert: currentInert } : {}) },
	};
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

function requiredArg(args: Record<string, string | boolean>, name: string): string {
	const value = str(args[name]);
	if (!value || value.trim() === "") throw new Error(`${name} is required`);
	return value;
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
			} else if (subcommand === "add-actor") {
				addActor(sessionId, {
					id: requiredArg(args, "id"),
					name: str(args["name"]),
					boundary: str(args["boundary"]),
					driver: str(args["driver"]),
					reachable: requiredArg(args, "reachable"),
				});
			} else if (subcommand === "add-story") {
				addStory(sessionId, { id: requiredArg(args, "id"), actor: str(args["actor"]) ?? str(args["actor-id"]) ?? "" });
			} else if (subcommand === "author-cell") {
				authorCell(sessionId, {
					story: requiredArg(args, "story"),
					cls: Number(requiredArg(args, "cls")),
					sub: str(args["sub"]),
					attackPoint: requiredArg(args, "attack-point"),
					priority: requiredArg(args, "priority"),
					drivenAt: str(args["driven-at"]),
					whyNeeded: str(args["why-needed"]),
					source: str(args["source"]),
				});
			} else if (subcommand === "record-baseline") {
				recordBaseline(sessionId, {
					story: requiredArg(args, "story"),
					result: requiredArg(args, "result"),
					note: str(args["note"]),
					evidencePath: str(args["evidence-path"]),
					evidenceSurface: str(args["evidence-surface"]),
				});
			} else if (subcommand === "record-cell") {
				recordCell(sessionId, {
					story: requiredArg(args, "story"),
					cls: Number(requiredArg(args, "cls")),
					sub: str(args["sub"]),
					status: requiredArg(args, "status"),
					naReason: str(args["na-reason"]),
					evidencePath: str(args["evidence-path"]),
					evidenceSurface: str(args["evidence-surface"]),
					drivenAt: str(args["driven-at"]),
					whyNeeded: str(args["why-needed"]),
					source: str(args["source"]),
					evidenceBefore: str(args["evidence-before"]),
					evidenceAction: str(args["evidence-action"]),
					evidenceAfter: str(args["evidence-after"]),
				});
			} else if (subcommand === "record-run-check") {
				recordRunCheck(sessionId, {
					check: requiredArg(args, "check"),
					result: requiredArg(args, "result"),
					note: str(args["note"]),
				});
			} else if (subcommand === "set-verdict") {
				const verdict = process.argv.slice(3).find((arg) => !arg.startsWith("--"));
				if (!verdict) {
					process.stderr.write("set-verdict: <APPROVE|COMMENT|REQUEST_CHANGES> argument is required\n");
					process.exit(1);
				}
				setVerdict(sessionId, verdict);
			} else if (subcommand === "start") {
				startQa(sessionId, requiredArg(args, "target"));
			} else if (subcommand === "set-acceptance") {
				const parsed = JSON.parse(requiredArg(args, "json"));
				setAcceptance(sessionId, parsed);
			} else if (subcommand === "waive") {
				waiveCell(sessionId, {
					story: requiredArg(args, "story"),
					cls: Number(requiredArg(args, "cls")),
					sub: str(args["sub"]),
					reason: requiredArg(args, "reason"),
				});
			} else if (subcommand === "declare-inert") {
				declareInert(sessionId, requiredArg(args, "reason"));
			} else if (subcommand === "complete") {
			completeQa(sessionId);
		} else if (subcommand === "get") {
			process.stdout.write(JSON.stringify(readQaView(sessionId)) + "\n");
		} else if (subcommand === "status") {
			const state = readQaState(sessionId);
			process.stdout.write((state ? state.phase : "absent") + "\n");
		} else {
			process.stderr.write(
				"Usage: qa-state.ts <set|set-acceptance|advance-phase|inc-cycle|record-fix-head|capture-dirty-set|note-failure|add-actor|add-story|author-cell|record-baseline|record-cell|record-run-check|set-verdict|start|waive|declare-inert|complete|get|status> [options]\n",
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
