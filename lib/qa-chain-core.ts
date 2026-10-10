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
	"STATE",
] as const;

export type QaPhase = (typeof QA_PHASES)[number];
export const BASELINE_INDEX = QA_PHASES.indexOf("BASELINE");

export type QaDriver = "agent-device" | "agent-browser" | "curl" | "bash";

/**
 * Evidence surface for an automated test run (unit/integration/component/e2e
 * test runner) that executed this cycle and exercises the scenario. Distinct
 * from an actor driver: it is accepted alongside the actor's own driver
 * wherever evidence surface is matched.
 */
export const TEST_EVIDENCE_SURFACE = "test";
export type QaReachability = "yes" | "unknown" | (string & {});
export type QaPriority = "H" | "M" | "L";
export type QaResult = "pass" | "fail" | "na";
/**
 * Scenario outcome. `blocked`: execution was attempted and a structural limit
 * outside the change stopped it. A scenario with no status is open work.
 */
export type QaScenarioStatus = "pass" | "fail" | "blocked";
export type QaVerdict = "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | null;

/**
 * How this change reaches a client that renders the actor's result.
 * `none`: no client renders it (a job, a document, a CLI). `contract`: a client
 * renders it, but its rendering code did not change; the proof is the client's
 * own request at its real boundary. `render`: the client's rendering changed;
 * the proof is the screen, on every device profile the actor names.
 */
export const CLIENT_IMPACTS = ["none", "contract", "render"] as const;
export type QaClientImpact = (typeof CLIENT_IMPACTS)[number];

export interface QaActor {
	id: string;
	name?: string;
	boundary?: string;
	driver?: QaDriver;
	reachable?: QaReachability;
	client_impact?: QaClientImpact;
	client_impact_reason?: string;
	/** Device profile ids (from state.device_profiles); required for `render`. */
	profiles?: string[];
}

/** A screen size the project's clients must stay usable on, copied from the project manifest. */
export interface QaDeviceProfile {
	id: string;
	label: string;
	platform: "web" | "ios" | "android";
	width: number;
	height: number;
}

export interface QaEvidence {
	path: string;
	surface: string;
	/**
	 * Actor-perspective evidence paths. Visual pass/fail cells require all three;
	 * before/after are separate screenshot files, checked again at completion.
	 */
	before?: string;
	action?: string;
	after?: string;
}

export interface QaBaseline {
	result?: QaResult;
	status?: QaResult;
	note?: string;
	evidence?: QaEvidence;
	cycle?: number;
}

export interface QaFeatureRef {
	id: string;
	revision: string;
	/** Coverage labels from current code / the QA plan; not a membership claim. */
	entrypoints: string[];
	/** Coverage labels from current code / the QA plan; not a membership claim. */
	states: string[];
}

export interface QaStoryProvenance {
	features: QaFeatureRef[];
	/** Tested-code version, including dirty diff and build identity; not just a path. */
	code_ref: string;
	cycle: number;
}

/** Structured user-story intent. acceptance_criteria contains zero-based links
 * into the session-level acceptance_criteria array. */
export interface QaStoryContract {
	goal: string;
	given: string[];
	when: string[];
	then: string[];
	acceptance_criteria: number[];
}

export interface QaStory {
	id: string;
	/** Actor id; `actor_id` is accepted as the serialized spelling too. */
	actor?: string;
	actor_id?: string;
	/** New stories carry an explicit intent contract; absent means legacy data. */
	contract?: QaStoryContract;
	baseline?: QaBaseline | null;
	baseline_history?: QaBaseline[];
	provenance?: QaStoryProvenance;
	provenance_history?: QaStoryProvenance[];
}

function nonblank(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** Validates a new structured story contract without inventing legacy intent. */
export function storyContractValid(story: QaStory, acceptanceCriteria: string[] = []): boolean {
	if (!Array.isArray(acceptanceCriteria) || !acceptanceCriteria.every(nonblank)) return false;
	const contract = story.contract;
	if (!contract || !nonblank(contract.goal)) return false;
	if (!Array.isArray(contract.given) || !contract.given.length || !contract.given.every(nonblank)) return false;
	if (!Array.isArray(contract.when) || !contract.when.length || !contract.when.every(nonblank)) return false;
	if (!Array.isArray(contract.then) || !contract.then.length || !contract.then.every(nonblank)) return false;
	if (!Array.isArray(contract.acceptance_criteria) || !contract.acceptance_criteria.length) return false;
	return contract.acceptance_criteria.every(
		(index) => Number.isInteger(index) && index >= 0 && index < acceptanceCriteria.length && nonblank(acceptanceCriteria[index]),
	);
}

export const RISK_AXES = [1, 2, 3, 4, 5, 6] as const;
export type QaRiskAxis = (typeof RISK_AXES)[number];
export function isRiskAxis(value: unknown): value is QaRiskAxis {
	return RISK_AXES.some((axis) => axis === value);
}

/**
 * One user scenario under a story: who does what, in which state, and what they
 * must observe. `risks` names the adversarial axes (1 failure path · 2 boundary/
 * malformed input · 3 injection · 4 interruption/concurrency · 5 misleading
 * success · 6 idempotency) this scenario exercises; a plain happy path carries
 * none. `profile` is the device profile the scenario runs on, set only for a
 * story whose actor's client rendering changed (`client_impact: render`), and
 * only on a scenario driven on the screen; one proven off-screen carries none.
 */
export interface QaScenario {
	story: string;
	id: string;
	title?: string;
	preconditions?: string;
	steps?: string[];
	expected?: string;
	why_needed?: string;
	priority?: QaPriority;
	risks?: number[];
	profile?: string;
	status?: QaScenarioStatus | null;
	/** The structural limit that stopped execution (status `blocked`). */
	blocked?: QaBlocked;
	evidence?: QaEvidence;
	evidence_review?: QaEvidenceReview;
	case_run?: QaCaseRunBinding;
	/** The saved case this passed scenario is linked to, or why it has none (record-case). */
	case?: QaScenarioCase;
	cycle?: number;
	driven_at?: string;
	source?: "self-authored" | "caller-provided";
}

/** An adversarial axis that no scenario of this change can exercise, declared once per cycle. */
export interface QaRiskNotApplicable {
	axis: number;
	reason: string;
	cycle: number;
}

/** The only limits a scenario may be blocked by; everything on the local stack is setup work. */
export const QA_OBSTACLE_KINDS = ["hardware", "third-party", "person"] as const;
export type QaObstacleKind = (typeof QA_OBSTACLE_KINDS)[number];

export interface QaBlocked {
	obstacle: string;
	/** What kind of limit stopped the scenario; absent on records written before the kinds existed and on run checks. */
	obstacle_kind?: QaObstacleKind;
	/** The user's own reply, required when the limit is something only a person can give. */
	user_answer?: string;
	/** Each attempt made to reach the surface, with its observed result. */
	attempts: string[];
	deepest_reachable: string;
	/** File holding the attempts' actual output. */
	attempt_log: string;
}

export function blockedRecordValid(blocked: QaBlocked | undefined, probe: EvidenceProbe): boolean {
	if (!blocked || !nonblank(blocked.obstacle) || !nonblank(blocked.deepest_reachable) || !nonblank(blocked.attempt_log)) return false;
	if (!Array.isArray(blocked.attempts) || !blocked.attempts.length || !blocked.attempts.every(nonblank)) return false;
	try {
		const file = probe(blocked.attempt_log);
		return file.exists && file.size > 0;
	} catch { return false; }
}

export type QaScenarioCase =
	| { kind: "saved"; id: string; revision: string; receipt_path: string; attempt_id: string }
	| { kind: "none"; reason: string };

export interface QaCaseRunBinding {
	case_id: string;
	attempt_id: string;
	code_ref: string;
	receipt_path: string;
	files: Record<string, string>;
	evidence_paths: string[];
}

export interface QaEvidenceClaim {
	claim: string;
	verdict: "supported" | "insufficient";
	observation: string;
	gap: string;
	sources: Array<{ path: string; location: string }>;
	/**
	 * "layout" marks the claim that a profile screen was checked for the LAYOUT_CHECKS breakages.
	 * "cause" marks the claim that a failure is the change's product defect, checked for CAUSE_CHECKS.
	 */
	kind?: "layout" | "cause";
	checked?: string[];
}

/** What a person-usable screen must be free of on each device profile. */
export const LAYOUT_CHECKS = ["clipping", "overlap", "horizontal-scroll", "text-wrap"] as const;

/**
 * What a failure must show before it counts as the change's defect: the product's own
 * log or code took the wrong path (not setup such as signing, keys or debug mode), and
 * the base commit behaves differently or the diff touches the code that breaks.
 */
export const CAUSE_CHECKS = ["product-path", "base-commit"] as const;

export interface QaEvidenceReview {
	claims: QaEvidenceClaim[];
	/** Snapshot binds this review to the exact recorded scenario, not its filename. */
	cell_snapshot: string;
	files: Record<string, string>;
}

export function evidenceReviewSnapshot(scenario: QaScenario): string {
	const { evidence_review: _review, ...record } = scenario;
	return JSON.stringify(record);
}

/** Structural receipt only: the reviewer, not this predicate, judges pixels. */
export function evidenceReviewComplete(cell: QaScenario, probe: EvidenceProbe): boolean {
	const review = cell.evidence_review;
	if (!review || review.cell_snapshot !== evidenceReviewSnapshot(cell) || !Array.isArray(review.claims) || !review.claims.length) return false;
	const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
	if (!review.claims.every((claim) => claim && nonblank(claim.claim) && claim.verdict === "supported" && nonblank(claim.observation) && claim.gap === "" && Array.isArray(claim.sources) && claim.sources.length > 0 && claim.sources.every((source) => source && nonblank(source.path) && nonblank(source.location)))) return false;
	const paths = [cell.evidence?.path, cell.evidence?.before, cell.evidence?.action, cell.evidence?.after, ...review.claims.flatMap((claim) => claim.sources.map((source) => source.path))];
	try {
		return paths.filter((path): path is string => !!path).every((path) => {
			const file = probe(path);
			return file.exists && file.size > 0 && /^[a-f0-9]{64}$/.test(review.files?.[path] ?? "") && file.sha256 === review.files[path];
		});
	} catch { return false; }
}

export function caseRunBindingComplete(cell: QaScenario, probe: EvidenceProbe): boolean {
	if (!cell.case_run || typeof cell.case_run !== "object" || !cell.case_run.case_id || !cell.case_run.attempt_id || !cell.case_run.code_ref || !cell.case_run.receipt_path || !cell.case_run.files || typeof cell.case_run.files !== "object" || Array.isArray(cell.case_run.files) || !Object.keys(cell.case_run.files).length) return false;
	try {
		const binding = cell.case_run;
		const required = [binding.receipt_path, cell.evidence?.path, cell.evidence?.before, cell.evidence?.action, cell.evidence?.after].filter((path): path is string => typeof path === "string" && path.trim() !== "");
		return required.every((path) => Object.prototype.hasOwnProperty.call(binding.files, path)) && Object.entries(binding.files).every(([path, hash]) => {
			const file = probe(path);
			return file.exists && /^[a-f0-9]{64}$/.test(hash) && file.sha256 === hash;
		});
	} catch { return false; }
}

export interface QaRunCheck {
	/** "blocked" is accepted only for flaky-rerun: the environment kept the rerun from running. */
	result?: QaResult | "blocked";
	status?: QaResult;
	note?: string;
	cycle?: number;
	blocked?: QaBlocked;
}

export interface QaRunChecks {
	stale_state?: QaRunCheck | QaResult | null;
	dirty_worktree?: QaRunCheck | QaResult | null;
	flaky_rerun?: QaRunCheck | QaResult | null;
}

export type QaRunCheckHistory = Partial<Record<"stale-state" | "dirty-worktree" | "flaky-rerun", QaRunCheck[]>>;

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
	/**
	 * Set true by `qa-state.ts await-user` when a plain-text question is posed at a
	 * human-decision gate (e.g. a question about the requirement itself); recomputed
	 * to false by any later progress write (mergeWrite derives it from `next` on
	 * every write). The Stop gate reads it as a legitimate pause and allows the turn
	 * to end WITHOUT a verdict, resuming on the user's reply. It never marks
	 * completion; only a satisfied verdict + reviewed report does.
	 */
	awaiting_user?: boolean;
	/** The cycle in which `await-user` last ran; it outlives the pause so a `person` blocker can show the user was asked this cycle. */
	awaited_user_cycle?: number;
	phase?: QaPhase;
	cycle?: number;
	phase_max?: number;
	actors?: QaActor[];
	stories?: QaStory[];
	scenarios?: QaScenario[];
	risk_not_applicable?: QaRiskNotApplicable[];
	device_profiles?: QaDeviceProfile[];
	run_checks?: QaRunChecks | null;
	run_checks_history?: QaRunCheckHistory;
	inert?: QaInert;
	verdict?: QaVerdict;
	/** Acceptance criteria captured at PLAN; rendered by the report from records. */
	acceptance_criteria?: string[];
	derived?: QaDerived;
	report?: { path: string; sha256: string; state_snapshot: string; reviewed: boolean };
	/** Set only by the user-only `force-complete`: the cycle ended without its gates. */
	forced_complete?: boolean;
	forced_reason?: string;
	[key: string]: unknown;
}

export function qaReportSnapshot(state: QaChainState): string {
	return JSON.stringify([state.target, state.cycle, state.acceptance_criteria, state.actors, state.stories, state.scenarios, state.risk_not_applicable, state.device_profiles, state.run_checks, state.inert, state.verdict]);
}

export function qaReportComplete(state: QaChainState, probe: EvidenceProbe): boolean {
	if (!(state.actors ?? []).length) return true;
	const report = state.report;
	if (!report || report.reviewed !== true || report.state_snapshot !== qaReportSnapshot(state) || !/\.html$/i.test(report.path)) return false;
	try {
		const file = probe(report.path);
		return file.exists && file.size > 0 && /^[a-f0-9]{64}$/.test(report.sha256) && file.sha256 === report.sha256;
	} catch { return false; }
}

/** Backwards-compatible name for callers that refer to the chain as QaState. */
export type QaState = QaChainState;

export type EvidenceProbe = (path: string) => { exists: boolean; size: number; image?: boolean; sha256?: string };

export function isVisualDriver(driver: string | undefined): boolean {
	return driver === "agent-browser" || driver === "agent-device";
}


/**
 * A scenario needs before/after screenshots and an evidence review when it runs
 * on a device profile, or when its OWN recorded evidence surface is visual —
 * falling back to the actor's driver when it carries no evidence yet. A
 * test-evidence scenario without a profile never needs visual proof.
 */
export function scenarioNeedsVisualProof(scenario: Pick<QaScenario, "evidence" | "profile">, actorDriver: string | undefined): boolean {
	return nonblank(scenario.profile) || isVisualDriver(scenario.evidence?.surface ?? actorDriver);
}

/** Visual scenarios carry two separate captures and the actor's action record. */
export function visualEvidenceComplete(evidence: QaEvidence | undefined, probe: EvidenceProbe): boolean {
	if (!evidence?.before || !evidence.action || !evidence.after || evidence.before === evidence.after) return false;
	try {
		return [evidence.before, evidence.action, evidence.after].every((path, index) => {
			const file = probe(path);
			return file.exists && file.size > 0 && (index === 1 || (/\.(png|jpe?g|webp|gif)$/i.test(path) && file.image !== false));
		});
	} catch { return false; }
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

/** Scenarios authored for the current cycle; earlier cycles stay in the raw record for audit. */
export function currentScenarios(state: QaChainState): QaScenario[] {
	return (state.scenarios ?? []).filter((scenario) => scenario.cycle === currentCycle(state));
}

/**
 * Current-cycle H scenarios that passed by driving their boundary (not an automated
 * test run) and so must be saved as a reusable case: each needs a `case` link, a
 * recorded reason for having none, or a `case_run` (it was proven by replaying a saved case).
 */
export function scenariosMissingCase(state: QaChainState): QaScenario[] {
	return currentScenarios(state).filter((scenario) => {
		if (scenario.priority !== "H" || scenario.status !== "pass" || scenario.evidence?.surface === TEST_EVIDENCE_SURFACE) return false;
		if (scenario.case_run) return false;
		if (scenario.case?.kind === "saved") return false;
		return !(scenario.case?.kind === "none" && nonblank(scenario.case.reason));
	});
}

function result(value: QaRunCheck | QaResult | null | undefined): QaResult | "blocked" | null {
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
	if (!evidence || typeof evidence.path !== "string" || !evidence.path || (evidence.surface !== driver && evidence.surface !== TEST_EVIDENCE_SURFACE)) return false;
	if (cycle !== currentCycle(state)) return false;
	try {
		const inspected = probe(evidence.path);
		return inspected.exists === true && inspected.size > 0;
	} catch {
		return false;
	}
}

/** An actor row is complete when its surface, driver, and client impact are pinned. */
export function actorComplete(state: QaChainState, actor: QaActor): boolean {
	if (!nonblank(actor.id) || !nonblank(actor.boundary) || !actor.driver) return false;
	if (!actor.client_impact || !CLIENT_IMPACTS.includes(actor.client_impact) || !nonblank(actor.client_impact_reason)) return false;
	const profiles = actor.profiles ?? [];
	if (actor.client_impact !== "render") return profiles.length === 0;
	const known = new Set((state.device_profiles ?? []).map((profile) => profile.id));
	return isVisualDriver(actor.driver) && profiles.length > 0 && profiles.every((id) => known.has(id));
}

export function rosterComplete(state: QaChainState): boolean {
	const actors = state.actors ?? [];
	const stories = state.stories ?? [];
	return (
		actors.length > 0 &&
		actors.every((actor) => actorComplete(state, actor)) &&
		actors.every((actor) => stories.some((story) => actorId(story) === actor.id))
	);
}

/** The six authored fields a scenario must carry before it can run. */
export function scenarioAuthored(scenario: QaScenario): boolean {
	const risks = scenario.risks ?? [];
	return (
		nonblank(scenario.id) &&
		nonblank(scenario.title) &&
		nonblank(scenario.preconditions) &&
		Array.isArray(scenario.steps) && scenario.steps.length > 0 && scenario.steps.every(nonblank) &&
		nonblank(scenario.expected) &&
		nonblank(scenario.why_needed) &&
		!!scenario.priority &&
		Array.isArray(risks) && risks.every(isRiskAxis) && new Set(risks).size === risks.length
	);
}

function inertDeclared(state: QaChainState): boolean {
	return state.inert?.declared === true && (state.inert.cycle === undefined || state.inert.cycle === currentCycle(state));
}

/** Each adversarial axis is exercised by a current scenario or declared not applicable this cycle. */
export function riskCoverageComplete(state: QaChainState): boolean {
	const scenarios = currentScenarios(state);
	const declared = (state.risk_not_applicable ?? []).filter((entry) => entry.cycle === currentCycle(state) && nonblank(entry.reason));
	return RISK_AXES.every((axis) => scenarios.some((scenario) => (scenario.risks ?? []).includes(axis)) || declared.some((entry) => entry.axis === axis));
}

function storyScenariosComplete(state: QaChainState, story: QaStory): boolean {
	const actor = actorFor(state, story);
	const scenarios = currentScenarios(state).filter((scenario) => scenario.story === story.id);
	if (!scenarios.length || !scenarios.every(scenarioAuthored) || !scenarios.some((scenario) => scenario.priority === "H")) return false;
	if (actor?.client_impact !== "render") return scenarios.every((scenario) => !scenario.profile);
	const profiles = actor.profiles ?? [];
	return (
		scenarios.every((scenario) => !scenario.profile || profiles.includes(scenario.profile)) &&
		profiles.every((profile) => scenarios.some((scenario) => scenario.profile === profile))
	);
}

export function chainComplete(state: QaChainState): boolean {
	const stories = state.stories ?? [];
	if (!rosterComplete(state)) return false;
	if (stories.some((story) => !actorFor(state, story))) return false;
	// Execution readiness always requires an explicit story contract. Historical
	// records remain readable through the state/view APIs, but cannot authorize a
	// new execution or verdict without being re-authored in a fresh cycle.
	if (stories.some((story) => !storyContractValid(story, state.acceptance_criteria ?? []))) return false;
	if (inertDeclared(state)) return currentScenarios(state).length === 0;
	if (currentScenarios(state).some((scenario) => !stories.some((story) => story.id === scenario.story))) return false;
	return stories.every((story) => storyScenariosComplete(state, story)) && riskCoverageComplete(state);
}

function storyFor(state: QaChainState, scenario: QaScenario): QaStory | undefined {
	return (state.stories ?? []).find((story) => story.id === scenario.story);
}

export function recordComplete(state: QaChainState, probe: EvidenceProbe): boolean {
	return recordGaps(state, probe).length === 0;
}

/** What keeps the current cycle's record incomplete, one line per gap, so a refused verdict names what to record. */
export function recordGaps(state: QaChainState, probe: EvidenceProbe): string[] {
	const gaps: string[] = [];
	for (const story of state.stories ?? []) {
		const actor = actorFor(state, story);
		const baseline = story.baseline;
		if (!baseline || baseline.cycle !== currentCycle(state) || result(baseline) === null) gaps.push(`${story.id}: baseline not recorded this cycle (record-baseline)`);
		else if (result(baseline) === "pass" && !validEvidence(state, baseline.evidence, actor?.driver, baseline.cycle, probe)) gaps.push(`${story.id}: baseline evidence missing or invalid`);
	}
	for (const scenario of currentScenarios(state)) {
		const name = `${scenario.story}/${scenario.id}`;
		if (scenario.status !== "pass" && scenario.status !== "fail" && scenario.status !== "blocked") { gaps.push(`${name}: not recorded`); continue; }
		if (scenario.status === "blocked" && !blockedRecordValid(scenario.blocked, probe)) gaps.push(`${name}: blocked record needs obstacle, attempts, deepest reachable and an existing attempt log`);
		if (scenario.case_run && !caseRunBindingComplete(scenario, probe)) gaps.push(`${name}: case-run binding stale or incomplete`);
		const story = storyFor(state, scenario);
		const driver = story ? actorFor(state, story)?.driver : undefined;
		if (scenario.status !== "blocked" && scenarioNeedsVisualProof(scenario, driver)) {
			if (!visualEvidenceComplete(scenario.evidence, probe)) gaps.push(`${name}: before/action/after screenshots missing`);
			else if (!evidenceReviewComplete(scenario, probe)) gaps.push(`${name}: evidence review incomplete (review-evidence)`);
		}
		if (scenario.status === "pass" && !validEvidence(state, scenario.evidence, driver, scenario.cycle, probe)) gaps.push(`${name}: pass evidence missing or invalid`);
	}
	const checks = state.run_checks ?? {};
	for (const [name, check] of [["stale-state", checks.stale_state], ["dirty-worktree", checks.dirty_worktree], ["flaky-rerun", checks.flaky_rerun]] as const) {
		if (!recordCycle(check, state)) gaps.push(`run check ${name}: not recorded this cycle (record-run-check)`);
	}
	return gaps;
}

function failureEstablished(state: QaChainState, scenario: QaScenario, probe: EvidenceProbe): boolean {
	if (scenario.status !== "fail") return false;
	const story = storyFor(state, scenario);
	const driver = story ? actorFor(state, story)?.driver : undefined;
	if (scenarioNeedsVisualProof(scenario, driver) && !visualEvidenceComplete(scenario.evidence, probe)) return false;
	const cause = scenario.evidence_review?.claims?.some((claim) => claim?.kind === "cause" && CAUSE_CHECKS.every((check) => claim.checked?.includes(check)));
	return !!cause && evidenceReviewComplete(scenario, probe);
}

/**
 * REQUEST_CHANGES asks for a product change, so it needs a recorded product
 * failure: a failed current-cycle scenario, baseline, stale-state, or
 * flaky-rerun check. Unexecuted work is not a failure; it is work left to do. A
 * dirty worktree is harness debris, not a product defect, so it does not count.
 * Scenarios left unrun after a stop-driving failure do not block it. A failed
 * scenario counts only once its evidence review is complete with a supported
 * "cause" claim (and, on a screen, its screenshots): a failure whose cause is
 * unproven or that the reviewer marked insufficient is not yet established.
 */
export function requestChangesOk(state: QaChainState, probe: EvidenceProbe): boolean {
	if (!chainComplete(state)) return false;
	const checks = state.run_checks ?? {};
	return (
		currentScenarios(state).some((scenario) => failureEstablished(state, scenario, probe)) ||
		(state.stories ?? []).some((story) => result(story.baseline) === "fail") ||
		[checks.stale_state, checks.flaky_rerun].some((check) => result(check) === "fail")
	);
}

function verdictGround(state: QaChainState, probe: EvidenceProbe): boolean {
	const checks = state.run_checks ?? {};
	return (
		chainComplete(state) &&
		recordComplete(state, probe) &&
		result(checks.stale_state) === "pass" &&
		(result(checks.flaky_rerun) === "pass" || flakyRerunBlocked(checks, probe)) &&
		(state.stories ?? []).every((story) => result(story.baseline) === "pass")
	);
}

// A rerun the environment kept from running leaves stability unproven, like a blocked scenario.
function flakyRerunBlocked(checks: QaRunChecks, probe: EvidenceProbe): boolean {
	const check = checks.flaky_rerun;
	return typeof check === "object" && check !== null && check.result === "blocked" && blockedRecordValid(check.blocked, probe);
}

// Priority orders execution; it never decides whether an unexecuted scenario may
// pass the verdict gate. A `blocked` scenario resolves, and the report names it.
export function approveOk(state: QaChainState, probe: EvidenceProbe): boolean {
	// A blocked scenario leaves its requirement unproven: COMMENT at most, never APPROVE.
	return verdictGround(state, probe) && result(state.run_checks?.flaky_rerun) === "pass" &&
		currentScenarios(state).every((scenario) => scenario.status === "pass");
}

/** Soft pass: a failed non-H scenario (the 50-74 nitpick band) permits COMMENT. */
/**
 * COMMENT leaves the merge to a person. An H failure whose product cause is
 * established asks for REQUEST_CHANGES instead; an H failure whose cause is
 * still unproven may stay as an open finding under COMMENT.
 */
export function commentOk(state: QaChainState, probe: EvidenceProbe): boolean {
	return verdictGround(state, probe) &&
		currentScenarios(state).every((scenario) => scenario.priority !== "H" || !failureEstablished(state, scenario, probe));
}

export function cycleUntouched(state: Partial<QaChainState>): boolean {
	const actors = state.actors ?? [];
	const stories = state.stories ?? [];
	const scenarios = state.scenarios ?? [];
	const records = stories.some((story) => story.baseline !== null && story.baseline !== undefined) ||
		scenarios.some((scenario) => scenario.status !== null && scenario.status !== undefined || scenario.evidence !== null && scenario.evidence !== undefined) ||
		Object.values(state.run_checks ?? {}).some((check) => check !== null && check !== undefined);
	return actors.length === 0 && stories.length === 0 && scenarios.length === 0 && !records;
}

export function driverGateArmed(state: QaChainState): boolean {
	return !rosterComplete(state) || (!chainComplete(state) && (state.phase_max ?? 0) >= BASELINE_INDEX);
}
