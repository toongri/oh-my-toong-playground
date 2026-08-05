/** Pure structural predicates for the QA actor → story → scenario chain. */

export const QA_PHASES = [
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
export const BASELINE_INDEX = QA_PHASES.indexOf("BASELINE");

export type QaDriver = "agent-device" | "agent-browser" | "curl" | "bash";
export type QaReachability = "yes" | "unknown" | (string & {});
export type QaPriority = "H" | "M" | "L";
export type QaResult = "pass" | "fail" | "na";
export type QaVerdict = "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | null;

export interface QaActor {
	id: string;
	name?: string;
	boundary?: string;
	driver?: QaDriver;
	reachable?: QaReachability;
}

export interface QaEvidence {
	path: string;
	surface: string;
}

export interface QaBaseline {
	result?: QaResult;
	status?: QaResult;
	note?: string;
	evidence?: QaEvidence;
	cycle?: number;
}

export interface QaStory {
	id: string;
	/** Actor id; `actor_id` is accepted as the serialized spelling too. */
	actor?: string;
	actor_id?: string;
	baseline?: QaBaseline | null;
}

export interface QaCell {
	story: string;
	cls: number;
	sub?: "hang-timeout" | "flaky-green";
	attack_point?: string;
	priority?: QaPriority;
	status?: QaResult | "waived" | null;
	na_reason?: string;
	evidence?: QaEvidence;
	cycle?: number;
}

export interface QaRunCheck {
	result?: QaResult;
	status?: QaResult;
	note?: string;
	cycle?: number;
}

export interface QaRunChecks {
	stale_state?: QaRunCheck | QaResult | null;
	dirty_worktree?: QaRunCheck | QaResult | null;
	flaky_rerun?: QaRunCheck | QaResult | null;
}

export interface QaWaive {
	story: string;
	cls: number;
	sub?: "hang-timeout" | "flaky-green";
	cycle?: number;
}

export interface QaInert {
	declared?: boolean;
	reason?: string;
	cycle?: number;
}

export interface QaDerived {
	chain_complete?: boolean;
	record_complete?: boolean;
	approve_ok?: boolean;
	comment_ok?: boolean;
	roster_complete?: boolean;
	driver_gate_armed?: boolean;
}

/** Raw state shape shared by the CLI and the Stop hook. */
export interface QaChainState {
	active?: boolean;
	phase?: QaPhase;
	cycle?: number;
	phase_max?: number;
	actors?: QaActor[];
	stories?: QaStory[];
	cells?: QaCell[];
	run_checks?: QaRunChecks;
	waives?: QaWaive[];
	inert?: QaInert;
	verdict?: QaVerdict;
	derived?: QaDerived;
	[key: string]: unknown;
}

/** Backwards-compatible name for callers that refer to the chain as QaState. */
export type QaState = QaChainState;

export type EvidenceProbe = (path: string) => { exists: boolean; size: number };

export interface RequiredCell {
	story: string;
	cls: number;
	sub?: "hang-timeout" | "flaky-green";
}

export function requiredCells(state: QaChainState): RequiredCell[] {
	const cells: RequiredCell[] = [];
	for (const story of state.stories ?? []) {
		for (const cls of [1, 2, 3, 4, 5, 6]) cells.push({ story: story.id, cls });
		cells.push({ story: story.id, cls: 1, sub: "hang-timeout" });
		cells.push({ story: story.id, cls: 5, sub: "flaky-green" });
	}
	return cells;
}

function key(cell: Pick<QaCell, "story" | "cls" | "sub">): string {
	return `${cell.story}:${cell.cls}:${cell.sub ?? ""}`;
}

function actorId(story: QaStory): string | undefined {
	return story.actor ?? story.actor_id;
}

function actorFor(state: QaChainState, story: QaStory): QaActor | undefined {
	const id = actorId(story);
	return (state.actors ?? []).find((actor) => actor.id === id);
}

function currentCycle(state: QaChainState): number {
	return typeof state.cycle === "number" ? state.cycle : 0;
}

function currentCell(state: QaChainState, required: RequiredCell): QaCell | undefined {
	return (state.cells ?? []).find((cell) => key(cell) === key(required) && cell.cycle === currentCycle(state));
}

function result(value: QaRunCheck | QaResult | null | undefined): QaResult | null {
	if (typeof value === "string") return value;
	if (!value) return null;
	return value.result ?? value.status ?? null;
}

function recordCycle(value: QaRunCheck | QaResult | null | undefined, state: QaChainState): boolean {
	if (typeof value === "string") return false;
	return !!value && value.cycle === currentCycle(state) && result(value) !== null;
}

function validEvidence(
	state: QaChainState,
	evidence: QaEvidence | undefined,
	driver: QaDriver | undefined,
	cycle: number | undefined,
	probe: EvidenceProbe,
): boolean {
	if (!evidence || typeof evidence.path !== "string" || !evidence.path || evidence.surface !== driver) return false;
	if (cycle !== currentCycle(state)) return false;
	try {
		const inspected = probe(evidence.path);
		return inspected.exists === true && inspected.size > 0;
	} catch {
		return false;
	}
}

function waived(state: QaChainState, required: RequiredCell): boolean {
	return (state.waives ?? []).some(
		(waive) => waive.cycle === currentCycle(state) && key(waive) === key(required),
	);
}

export function rosterComplete(state: QaChainState): boolean {
	const actors = state.actors ?? [];
	const stories = state.stories ?? [];
	return (
		actors.length > 0 &&
		actors.every((actor) => !!actor.id && !!actor.boundary && !!actor.driver) &&
		actors.every((actor) => stories.some((story) => actorId(story) === actor.id))
	);
}

export function chainComplete(state: QaChainState): boolean {
	const stories = state.stories ?? [];
	if (!rosterComplete(state)) return false;
	if (stories.some((story) => !actorFor(state, story))) return false;
	return stories.every((story) => {
		const required = requiredCells({ ...state, stories: [story] });
		const authored = required.every((cell) => {
			const actual = currentCell(state, cell);
			return !!actual && typeof actual.attack_point === "string" && actual.attack_point.trim() !== "" && !!actual.priority;
		});
		return authored && required.some((cell) => {
			const actual = currentCell(state, cell);
			return actual?.priority === "H";
		});
	});
}

export function recordComplete(state: QaChainState, probe: EvidenceProbe): boolean {
	const stories = state.stories ?? [];
	for (const story of stories) {
		const actor = actorFor(state, story);
		const baseline = story.baseline;
		if (!baseline || baseline.cycle !== currentCycle(state) || result(baseline) === null) return false;
		if (result(baseline) === "pass" && !validEvidence(state, baseline.evidence, actor?.driver, baseline.cycle, probe)) return false;
	}
	for (const required of requiredCells(state)) {
		const cell = currentCell(state, required);
		if (!cell || cell.status === null || cell.status === undefined || cell.cycle !== currentCycle(state)) return false;
		if (cell.status === "na" && !cell.na_reason) return false;
		const story = stories.find((candidate) => candidate.id === required.story);
		if (cell.status === "pass" && !validEvidence(state, cell.evidence, story ? actorFor(state, story)?.driver : undefined, cell.cycle, probe)) return false;
	}
	const checks = state.run_checks ?? {};
	return (
		recordCycle(checks.stale_state, state) &&
		recordCycle(checks.dirty_worktree, state) &&
		recordCycle(checks.flaky_rerun, state)
	);
}

function allRequiredNa(state: QaChainState): boolean {
	return requiredCells(state).length > 0 && requiredCells(state).every((required) => currentCell(state, required)?.status === "na");
}

function inertNaAllowed(state: QaChainState): boolean {
	return state.inert?.declared === true && allRequiredNa(state) && (state.inert.cycle === undefined || state.inert.cycle === currentCycle(state));
}

function resolvedForApprove(state: QaChainState, required: RequiredCell): boolean {
	const cell = currentCell(state, required);
	if (!cell) return false;
	if (cell.status === "pass" || cell.status === "waived" || waived(state, required)) return true;
	if (cell.status !== "na") return false;
	return cell.priority !== "H" || inertNaAllowed(state);
}

function resolvedForComment(state: QaChainState, required: RequiredCell): boolean {
	const cell = currentCell(state, required);
	if (!cell) return false;
	if (cell.status === "pass" || cell.status === "waived" || waived(state, required)) return true;
	if (cell.priority !== "H") return true;
	return cell.status === "na" && inertNaAllowed(state);
}

function baselinesPass(state: QaChainState): boolean {
	return (state.stories ?? []).every((story) => result(story.baseline) === "pass");
}

export function approveOk(state: QaChainState, probe: EvidenceProbe): boolean {
	const checks = state.run_checks ?? {};
	return (
		chainComplete(state) &&
		recordComplete(state, probe) &&
		result(checks.stale_state) === "pass" &&
		result(checks.flaky_rerun) === "pass" &&
		baselinesPass(state) &&
		requiredCells(state).every((cell) => resolvedForApprove(state, cell))
	);
}

export function commentOk(state: QaChainState, probe: EvidenceProbe): boolean {
	const checks = state.run_checks ?? {};
	return (
		chainComplete(state) &&
		recordComplete(state, probe) &&
		result(checks.stale_state) === "pass" &&
		result(checks.flaky_rerun) === "pass" &&
		baselinesPass(state) &&
		requiredCells(state).every((cell) => resolvedForComment(state, cell))
	);
}

export function cycleUntouched(state: Partial<QaChainState>): boolean {
	const actors = state.actors ?? [];
	const stories = state.stories ?? [];
	const cells = state.cells ?? [];
	const records = stories.some((story) => story.baseline !== null && story.baseline !== undefined) ||
		cells.some((cell) => cell.status !== null && cell.status !== undefined || cell.evidence !== null && cell.evidence !== undefined) ||
		Object.values(state.run_checks ?? {}).some((check) => check !== null && check !== undefined);
	return actors.length === 0 && stories.length === 0 && cells.length === 0 && !records;
}

export function driverGateArmed(state: QaChainState): boolean {
	return !rosterComplete(state) || (!chainComplete(state) && (state.phase_max ?? 0) >= BASELINE_INDEX);
}
