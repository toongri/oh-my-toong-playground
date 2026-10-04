import { recordResource, releaseResource, unreleasedResources } from "@lib/session-resources";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

import {
	readQaState,
	setQaState,
	advancePhase,
	incCycle,
	completeQa,
	forceCompleteQa,
	startQa,
	setVerdict,
	setAwaitingUser,
	resolveStatePath,
	addActor,
	addStory,
	authorScenario,
	declareInert,
	declareRiskNotApplicable,
	readQaView,
	recordScenario,
	reviewEvidence,
	setAcceptance,
	type QaState,
} from "./qa-state.ts";
import { chainComplete, approveOk } from "@lib/qa-chain-core";
import { saveDeviceProfiles } from "@lib/qa-device-profiles.ts";

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const S = "test-session";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "qa-state-test-"));
	process.env.OMT_DIR = tmpDir;
	process.env.OMT_SESSION_ID = S;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalOmtDir !== undefined) {
		process.env.OMT_DIR = originalOmtDir;
	} else {
		delete process.env.OMT_DIR;
	}
	if (originalSessionId !== undefined) {
		process.env.OMT_SESSION_ID = originalSessionId;
	} else {
		delete process.env.OMT_SESSION_ID;
	}
});

function rawState(sid: string = S): any {
	return JSON.parse(readFileSync(resolveStatePath(sid), "utf8"));
}

describe("qa state: seed shape", () => {
	// Switch-exhaustiveness proxy: seeding via the CLI (any writer) must produce the
	// qa-specific seed shape — not a default/other-skill shape (goal's outcome/iteration,
	// or deep-interview's bare active/started_at/last_touched_at).
	test("seeding via a writer produces the qa-specific seed shape, not a default/other-skill shape", () => {
		const fresh = "fresh-qa-session";
		expect(existsSync(resolveStatePath(fresh))).toBe(false);
		setQaState(fresh, { phase: "PRE-FLIGHT" });
		const raw = rawState(fresh);
		expect(raw).toMatchObject({
			active: true,
			phase: "PRE-FLIGHT",
			cycle: 0,
			max_cycles: 5,
			target: "",
		});
		expect(raw).toHaveProperty("started_at");
		expect(raw).toHaveProperty("last_touched_at");
		// Not goal's shape
		expect(raw).not.toHaveProperty("outcome");
		expect(raw).not.toHaveProperty("iteration");
		// Not deep-interview's bare shape (would lack phase/cycle entirely if that arm fired)
		expect(raw).toHaveProperty("phase");
		expect(raw).toHaveProperty("cycle");
	});

	// (self-heal-qa) qa CLI seeds the pristine skeleton when the state file is absent —
	// mirrors goal-state.ts's ensureSeed self-heal pattern (slash-command hook-miss path).
	test("(self-heal-qa) setQaState seeds then succeeds when state file is absent", () => {
		const absentSid = "absent-qa-session";
		expect(existsSync(resolveStatePath(absentSid))).toBe(false);
		expect(() => setQaState(absentSid, { phase: "PRE-FLIGHT" })).not.toThrow();
		expect(existsSync(resolveStatePath(absentSid))).toBe(true);
		expect(readQaState(absentSid)!.phase).toBe("PRE-FLIGHT");
	});

	test("schema enumerates all required fields", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		const s = rawState();
		expect(s).toHaveProperty("active");
		expect(s).toHaveProperty("phase");
		expect(s).toHaveProperty("cycle");
		expect(s).toHaveProperty("max_cycles");
		expect(s).toHaveProperty("target");
		expect(s).toHaveProperty("started_at");
		expect(s).toHaveProperty("last_touched_at");
	});
});

describe("qa state: phase/target round-trip", () => {
	test("legacy story without contract remains readable but cannot become execution-ready", () => {
		setQaState(S, { phase: "PLAN" });
		const legacy = rawState();
		legacy.acceptance_criteria = undefined;
		legacy.actors = [{ id: "actor", name: "User", boundary: "home", driver: "bash", reachable: "yes" }];
		legacy.stories = [{ id: "story", actor: "actor" }];
		writeFileSync(resolveStatePath(S), JSON.stringify(legacy));
		const readable = readQaState(S)!;
		expect(readable.stories?.[0]?.contract).toBeUndefined();
		expect(chainComplete(readable)).toBe(false);
		expect(approveOk(readable, () => ({ exists: false, size: 0 }))).toBe(false);
		incCycle(S);
		expect(chainComplete(readQaState(S)!)).toBe(false);
	});

	test("set then get round-trips phase and target; cycle stays 0", () => {
		setQaState(S, { phase: "PLAN", target: "verify feature X" });
		const state = readQaState(S)!;
		expect(state.phase).toBe("PLAN");
		expect(state.target).toBe("verify feature X");
		expect(state.cycle).toBe(0);
	});

	test("set preserves prior target when omitted; started_at seeded once", () => {
		setQaState(S, { phase: "PRE-FLIGHT", target: "feature Y" });
		const first = readQaState(S)!;
		setQaState(S, { phase: "PLAN" });
		const second = readQaState(S)!;
		expect(second.phase).toBe("PLAN");
		expect(second.target).toBe("feature Y");
		expect(second.started_at).toBe(first.started_at);
	});

	test("set rejects an out-of-enum phase", () => {
		expect(() => setQaState(S, { phase: "BOGUS-PHASE" })).toThrow();
	});

	test("set rejects ROLLBACK as a removed phase", () => {
		expect(() => setQaState(S, { phase: "ROLLBACK" })).toThrow(/phase must be one of/);
	});

	test("advance-phase writes phase without touching target", () => {
		setQaState(S, { phase: "PRE-FLIGHT", target: "feature Z" });
		advancePhase(S, "PLAN");
		const state = readQaState(S)!;
		expect(state.phase).toBe("PLAN");
		expect(state.target).toBe("feature Z");
	});

	test("advance-phase rejects an out-of-enum phase", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		expect(() => advancePhase(S, "NOT-A-PHASE")).toThrow();
	});

	test("advance-phase rejects ROLLBACK as a removed phase", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		expect(() => advancePhase(S, "ROLLBACK")).toThrow(/phase must be one of/);
	});
});

describe("qa state: cycle counting", () => {
	test("inc-cycle increments; terminate signaled at cycle===max_cycles(5)", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		let last: { cycle: number; terminate: boolean } | undefined;
		for (let i = 1; i <= 5; i++) {
			last = incCycle(S);
			expect(last.cycle).toBe(i);
			expect(last.terminate).toBe(i === 5);
		}
		expect(readQaState(S)!.cycle).toBe(5);
	});

	test("inc-cycle refuses to increment past max_cycles once terminate is reached", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		for (let i = 0; i < 5; i++) incCycle(S);
		expect(() => incCycle(S)).toThrow();
		// state unchanged at the cap
		expect(readQaState(S)!.cycle).toBe(5);
	});
});

describe("qa state: terminal completion (P2 finding 1 — no active:false resurrection)", () => {
	test("completeQa marks active:false so readQaState no longer restores the session", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		advancePhase(S, "PLAN");
		expect(readQaState(S)).not.toBeNull();
		setVerdict(S, "REQUEST_CHANGES");
		completeQa(S);
		expect(readQaState(S)).toBeNull();
		// but the underlying file still exists (inactive, not deleted)
		expect(existsSync(resolveStatePath(S))).toBe(true);
		expect(rawState().active).toBe(false);
	});
});

describe("qa state: background resource gate", () => {
	test("complete refuses while a recorded resource is unreleased, then succeeds after release", () => {
		setQaState(S, { phase: "PRE-FLIGHT" });
		advancePhase(S, "PLAN");
		setVerdict(S, "REQUEST_CHANGES");
		recordResource(S, { id: "emulator-5554", kind: "emulator", stop: "true" });
		expect(() => completeQa(S)).toThrow("qa-state.ts release-resource --id emulator-5554");
		expect(rawState().active).not.toBe(false);
		releaseResource(S, "emulator-5554");
		completeQa(S);
		expect(rawState().active).toBe(false);
	});
});

describe("qa state: user-only force-complete", () => {
	test("ends an ungated cycle inactive and records the reason", () => {
		setQaState(S, { phase: "PLAN", target: "stuck" });
		forceCompleteQa(S, "  gates keep failing on a harness limit  ");
		const raw = rawState();
		expect(raw.active).toBe(false);
		expect(raw.forced_complete).toBe(true);
		expect(raw.forced_reason).toBe("gates keep failing on a harness limit");
	});

	test("refuses without a reason, and on an inactive cycle", () => {
		setQaState(S, { phase: "PLAN" });
		expect(() => forceCompleteQa(S, "  ")).toThrow("--reason is required");
		forceCompleteQa(S, "done");
		expect(() => forceCompleteQa(S, "again")).toThrow("no active qa cycle");
	});

	test("releases resources it can, and returns the ones whose stop command failed without blocking", () => {
		setQaState(S, { phase: "PLAN" });
		recordResource(S, { id: "sim-ok", kind: "simulator", stop: "true" });
		recordResource(S, { id: "emu-stuck", kind: "emulator", stop: "exit 3" });
		const failed = forceCompleteQa(S, "user ended the cycle");
		expect(failed.map((f) => f.id)).toEqual(["emu-stuck"]);
		expect(unreleasedResources(S).map((r) => r.id)).toEqual(["emu-stuck"]);
		expect(rawState().active).toBe(false);
	});

	test("a start that lands while resources are being released keeps its new cycle active", () => {
		setQaState(S, { phase: "PLAN" });
		const script = join(import.meta.dir, "qa-state.ts");
		// The stop command itself opens the next cycle, the way a concurrent
		// session would during a slow release. The stop shell does not inherit
		// this test's process.env edits, so the isolated OMT_DIR/session are
		// passed explicitly — otherwise it writes to the developer's real session.
		const env = `OMT_DIR='${tmpDir}' OMT_SESSION_ID='${S}'`;
		recordResource(S, { id: "sim-racing", kind: "simulator", stop: `${env} bun ${script} start --target next-cycle >/dev/null` });
		expect(forceCompleteQa(S, "user ended the cycle")).toEqual([]);
		const raw = rawState();
		expect(raw.active).toBe(true);
		expect(raw.target).toBe("next-cycle");
		expect(raw.forced_complete).toBeUndefined();
	});

	test("a fresh start clears the forced marker", () => {
		setQaState(S, { phase: "PLAN" });
		forceCompleteQa(S, "done");
		startQa(S, "next target");
		const raw = rawState();
		expect(raw.active).toBe(true);
		expect(raw.forced_complete).toBeUndefined();
		expect(raw.forced_reason).toBeUndefined();
	});
});

describe("qa state: awaiting_user pause (human-gate yield)", () => {
	test("setAwaitingUser sets awaiting_user=true on a live cycle", () => {
		setQaState(S, { phase: "PLAN" });
		setAwaitingUser(S);
		expect(rawState().awaiting_user).toBe(true);
	});

	test("any later progress write auto-clears awaiting_user", () => {
		setQaState(S, { phase: "PLAN" });
		setAwaitingUser(S);
		expect(rawState().awaiting_user).toBe(true);
		advancePhase(S, "PLAN");
		expect(rawState().awaiting_user).toBe(false);
	});

	test("setAwaitingUser refuses when no active cycle exists", () => {
		expect(() => setAwaitingUser("no-such-session")).toThrow(/no active QA cycle/);
	});
});

// ---------------------------------------------------------------------------
// In-process fixtures for the actor → story → scenario chain.
// ---------------------------------------------------------------------------

const CONTRACT = { goal: "Check supplements", given: ["program exists"], when: ["open home"], then: ["today supplements are shown"], acceptance_criteria: [0] };
const NO_CLIENT = { clientImpact: "none", clientImpactReason: "no client renders this result" };
const PHONE = { id: "phone-small", label: "작은 폰", platform: "ios", width: 375, height: 667 } as const;
const TABLET = { id: "tablet-portrait", label: "태블릿 세로", platform: "ios", width: 820, height: 1180 } as const;

const fixtureRoots: string[] = [];
afterEach(() => {
	for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project directory plus an isolated home; profiles are saved to the project's device-profiles manifest when given. */
function profileFixture(profiles?: unknown): { cwd: string; home: string } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "qa-state-profiles-")));
	fixtureRoots.push(root);
	const cwd = join(root, "repo");
	const home = join(root, "home");
	mkdirSync(join(cwd, ".git"), { recursive: true });
	mkdirSync(home);
	if (profiles !== undefined) saveDeviceProfiles(profiles, { cwd, home });
	return { cwd, home };
}

function scenarioOpts(id: string, priority: string, risks: number[], profile?: string) {
	return {
		story: "story-1",
		id,
		title: `scenario ${id}`,
		preconditions: "program exists",
		steps: ["open home"],
		expected: "supplements shown",
		whyNeeded: `covers ${id}`,
		priority,
		risks,
		...(profile !== undefined ? { profile } : {}),
	};
}

/** PLAN-phase chain with one bash actor (no client rendering) and one story, no scenarios yet. */
function seedStoryApi(): void {
	setQaState(S, { phase: "PLAN" });
	setAcceptance(S, ["home shows today supplements"]);
	addActor(S, { id: "actor-1", name: "User", boundary: "home", driver: "bash", reachable: "yes", ...NO_CLIENT });
	addStory(S, { id: "story-1", actor: "actor-1", contract: CONTRACT });
}

const chainOk = () => chainComplete(readQaState(S)!);

describe("qa state: actor client impact", () => {
	test("add-actor는 client-impact 값이 없거나 틀리면 거부하고 상태를 바꾸지 않는다", () => {
		setQaState(S, { phase: "PLAN" });
		const base = { id: "actor-1", name: "User", boundary: "home", driver: "bash", reachable: "yes" };
		expect(() => addActor(S, { ...base, clientImpactReason: "reason" })).toThrow(/client-impact must be one of/);
		expect(() => addActor(S, { ...base, clientImpact: "bogus", clientImpactReason: "reason" })).toThrow(/client-impact must be one of/);
		expect(rawState().actors ?? []).toEqual([]);
	});

	test("add-actor는 client-impact-reason이 비어 있으면 거부한다", () => {
		setQaState(S, { phase: "PLAN" });
		const base = { id: "actor-1", name: "User", boundary: "home", driver: "bash", reachable: "yes", clientImpact: "none" };
		expect(() => addActor(S, base)).toThrow(/client-impact-reason is required/);
		expect(() => addActor(S, { ...base, clientImpactReason: "  " })).toThrow(/client-impact-reason is required/);
		expect(rawState().actors ?? []).toEqual([]);
	});

	test("none과 contract 액터는 profile 없이 완성되고 profile을 주면 거부한다", () => {
		setQaState(S, { phase: "PLAN" });
		addActor(S, { id: "a-none", name: "Job", boundary: "worker", driver: "bash", reachable: "yes", ...NO_CLIENT });
		addActor(S, { id: "a-contract", name: "App", boundary: "api", driver: "curl", reachable: "yes", clientImpact: "contract", clientImpactReason: "the app renders this response; its rendering code did not change" });
		expect(rawState().actors.map((actor: any) => actor.client_impact)).toEqual(["none", "contract"]);
		expect(rawState().actors[0].profiles).toBeUndefined();
		expect(() => addActor(S, { id: "a-none", clientImpact: "none", reachable: "yes", profiles: ["phone-small"] })).toThrow(/applies only to client-impact render/);
	});
});

describe("qa state: render actor device profiles", () => {
	const renderActor = { id: "actor-1", name: "User", boundary: "home screen", driver: "agent-browser", reachable: "yes", clientImpact: "render", clientImpactReason: "the home screen layout changed" };

	test("프로젝트 매니페스트가 없으면 render 액터를 거부하고 사용자에게 물으라고 안내한다", () => {
		const { cwd, home } = profileFixture();
		setQaState(S, { phase: "PLAN" });
		expect(() => addActor(S, { ...renderActor, profiles: ["phone-small"], project: cwd, home })).toThrow(/No device profiles are recorded/);
		expect(rawState().actors ?? []).toEqual([]);
	});

	test("매니페스트에 없는 profile id와 profile이 없는 render 액터를 거부한다", () => {
		const { cwd, home } = profileFixture([PHONE]);
		setQaState(S, { phase: "PLAN" });
		expect(() => addActor(S, { ...renderActor, profiles: ["ghost"], project: cwd, home })).toThrow(/unknown device profile "ghost"/);
		expect(() => addActor(S, { ...renderActor, project: cwd, home })).toThrow(/requires --profiles/);
		expect(rawState().actors ?? []).toEqual([]);
	});

	test("render 액터는 화면 driver가 아니면 거부한다", () => {
		const { cwd, home } = profileFixture([PHONE]);
		setQaState(S, { phase: "PLAN" });
		expect(() => addActor(S, { ...renderActor, driver: "curl", profiles: ["phone-small"], project: cwd, home })).toThrow(/screen driver/);
	});

	test("매니페스트의 profile을 state.device_profiles로 복사하고 CLI도 HOME의 매니페스트로 해석한다", () => {
		const { cwd, home } = profileFixture([PHONE, TABLET]);
		const script = join(import.meta.dir, "qa-state.ts");
		setQaState(S, { phase: "PLAN" });
		execSync(
			`bun ${script} add-actor --id actor-1 --name "User" --boundary "home screen" --driver agent-browser --reachable yes --client-impact render --client-impact-reason "layout changed" --profiles '["phone-small","tablet-portrait"]' --project ${cwd}`,
			{ encoding: "utf8", env: { ...process.env, HOME: home } },
		);
		const raw = rawState();
		expect(raw.actors[0]).toMatchObject({ client_impact: "render", profiles: ["phone-small", "tablet-portrait"] });
		expect(raw.device_profiles).toEqual([PHONE, TABLET]);
		expect(raw.derived.roster_complete).toBe(false); // the actor has no story yet
	});

	test("render story는 actor의 모든 profile에 시나리오가 있어야 chain이 완성된다", () => {
		const { cwd, home } = profileFixture([PHONE, TABLET]);
		setQaState(S, { phase: "PLAN" });
		setAcceptance(S, ["home shows today supplements"]);
		addActor(S, { ...renderActor, profiles: ["phone-small", "tablet-portrait"], project: cwd, home });
		addStory(S, { id: "story-1", actor: "actor-1", contract: CONTRACT });
		// a profile must be one of the actor's own; a scenario proven off-screen carries none
		expect(() => authorScenario(S, scenarioOpts("s1", "H", [1, 2, 3, 4, 5, 6], "watch"))).toThrow(/--profile must be one of phone-small\|tablet-portrait/);
		authorScenario(S, scenarioOpts("s0", "M", []));
		expect(chainOk()).toBe(false); // no profile is covered yet
		authorScenario(S, scenarioOpts("s1", "H", [1, 2, 3, 4, 5, 6], "phone-small"));
		expect(rawState().derived.roster_complete).toBe(true);
		expect(chainOk()).toBe(false); // tablet-portrait has no scenario
		authorScenario(S, scenarioOpts("s2", "M", [], "tablet-portrait"));
		expect(chainOk()).toBe(true);
	});

	test("AC·스토리 목표·클라이언트 영향 사유에 코드 식별자를 쓰면 거부한다", () => {
		const { cwd, home } = profileFixture([PHONE]);
		setQaState(S, { phase: "PLAN" });
		expect(() => setAcceptance(S, ["보유분 표에 응답 맵의 displayName이 보인다"])).toThrow(/acceptance item.*"displayName"/);
		expect(() => setAcceptance(S, ["딥링크 deep_link_value가 페어링 화면을 연다"])).toThrow(/"deep_link_value"/);
		expect(() => setAcceptance(S, ["JoinStepLayout이 키보드 위에 남는다"])).toThrow(/"JoinStepLayout"/);
		setAcceptance(S, ["iPhone과 macOS 사용자가 AlgoCare 앱과 OneLink·AppsFlyer 링크로 보유분 표에서 카테고리 이름을 본다"]);
		expect(() => addActor(S, { ...renderActor, clientImpactReason: "SelfIntakeSections가 supplementCategories를 읽는다", profiles: ["phone-small"], project: cwd, home })).toThrow(/client-impact-reason names the code identifier "SelfIntakeSections"/);
		addActor(S, { ...renderActor, profiles: ["phone-small"], project: cwd, home });
		expect(() => addStory(S, { id: "story-1", actor: "actor-1", contract: { ...CONTRACT, goal: "운영자가 getJobs 응답을 확인한다" } })).toThrow(/goal.*"getJobs"/);
	});

	test("render 아닌 액터의 story에 --profile을 주면 거부한다", () => {
		seedStoryApi();
		expect(() => authorScenario(S, scenarioOpts("s1", "H", [1], "phone-small"))).toThrow(/applies only to a client-impact render actor/);
	});

	test("render 시나리오는 profile 화면의 before/action/after 없이는 성공을 기록할 수 없다", () => {
		const { cwd, home } = profileFixture([PHONE]);
		setQaState(S, { phase: "PLAN" });
		setAcceptance(S, ["home shows today supplements"]);
		addActor(S, { ...renderActor, profiles: ["phone-small"], project: cwd, home });
		addStory(S, { id: "story-1", actor: "actor-1", contract: CONTRACT });
		authorScenario(S, scenarioOpts("s1", "H", [1, 2, 3, 4, 5, 6], "phone-small"));
		const log = join(tmpDir, "screen.log");
		writeFileSync(log, "screen text dump");
		expect(() => recordScenario(S, { story: "story-1", scenario: "s1", status: "pass", evidencePath: log, evidenceSurface: "agent-browser" })).toThrow(/captured on device profile "phone-small"/);
		// an automated test run renders at no screen size, so it cannot prove a profile scenario, screenshots or not
		const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dAAAAABJRU5ErkJggg==", "base64");
		const before = join(tmpDir, "context-before.png");
		const after = join(tmpDir, "context-after.png");
		writeFileSync(before, png);
		writeFileSync(after, png);
		expect(() => recordScenario(S, { story: "story-1", scenario: "s1", status: "pass", evidencePath: log, evidenceSurface: "test", evidenceBefore: before, evidenceAction: log, evidenceAfter: after })).toThrow(/device profile "phone-small" is proven on the screen/);
	});

	test("profile 시나리오의 근거 검토는 잘림·겹침·가로 스크롤·줄바꿈을 점검한 layout claim이 있어야 한다", () => {
		const { cwd, home } = profileFixture([PHONE]);
		setQaState(S, { phase: "PLAN" });
		setAcceptance(S, ["home shows today supplements"]);
		addActor(S, { ...renderActor, profiles: ["phone-small"], project: cwd, home });
		addStory(S, { id: "story-1", actor: "actor-1", contract: CONTRACT });
		authorScenario(S, scenarioOpts("s1", "H", [1, 2, 3, 4, 5, 6], "phone-small"));
		const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dAAAAABJRU5ErkJggg==", "base64");
		const before = join(tmpDir, "before.png");
		const after = join(tmpDir, "after.png");
		const action = join(tmpDir, "action.txt");
		writeFileSync(before, png);
		writeFileSync(after, png);
		writeFileSync(action, "tapped the today tab");
		recordScenario(S, { story: "story-1", scenario: "s1", status: "pass", evidencePath: after, evidenceSurface: "agent-browser", evidenceBefore: before, evidenceAction: action, evidenceAfter: after });
		const content = { claim: "오늘 영양제가 보인다", verdict: "supported", observation: "목록에 3개", gap: "", sources: [{ path: after, location: "목록" }] };
		const layout = { ...content, kind: "layout", claim: "작은 폰에서 읽고 누를 수 있다", checked: ["clipping", "overlap", "horizontal-scroll", "text-wrap"] };
		expect(() => reviewEvidence(S, "story-1", "s1", [content])).toThrow(/layout claim .*phone-small/);
		expect(() => reviewEvidence(S, "story-1", "s1", [content, { ...layout, checked: ["clipping"] }])).toThrow(/overlap, horizontal-scroll, text-wrap/);
		expect(() => reviewEvidence(S, "story-1", "s1", [{ ...content, claim: "rightEdgeHit 값이 버튼이다" }, layout])).toThrow(/claim names the code identifier "rightEdgeHit"/);
		expect(() => reviewEvidence(S, "story-1", "s1", [{ ...content, observation: "scrollWidth가 375" }, layout])).toThrow(/observation names the code identifier "scrollWidth"/);
		expect(() => reviewEvidence(S, "story-1", "s1", [{ ...content, sources: [{ path: after, location: "visualViewport 하단" }] }, layout])).toThrow(/source location names the code identifier "visualViewport"/);
		reviewEvidence(S, "story-1", "s1", [content, layout]);
		expect(rawState().scenarios[0].evidence_review.claims[1]).toMatchObject({ kind: "layout", checked: ["clipping", "overlap", "horizontal-scroll", "text-wrap"] });
	});
});

describe("qa state: scenario authoring and risk coverage", () => {
	test("위험 축이 일부만 덮이면 chain이 미완성이고 declare-risk-na가 나머지를 채우면 완성된다", () => {
		seedStoryApi();
		authorScenario(S, scenarioOpts("s1", "H", [1, 2]));
		expect(chainOk()).toBe(false);
		for (const axis of [3, 4, 5]) declareRiskNotApplicable(S, axis, `axis ${axis} has no input surface in this change`);
		expect(chainOk()).toBe(false);
		declareRiskNotApplicable(S, 6, "the operation is a pure read");
		expect(chainOk()).toBe(true);
		expect(rawState().risk_not_applicable).toEqual([
			{ axis: 3, reason: "axis 3 has no input surface in this change", cycle: 0 },
			{ axis: 4, reason: "axis 4 has no input surface in this change", cycle: 0 },
			{ axis: 5, reason: "axis 5 has no input surface in this change", cycle: 0 },
			{ axis: 6, reason: "the operation is a pure read", cycle: 0 },
		]);
	});

	test("declare-risk-na는 이유와 올바른 축을 요구하고 이미 시나리오가 다루는 축은 거부한다", () => {
		seedStoryApi();
		authorScenario(S, scenarioOpts("s1", "H", [1]));
		expect(() => declareRiskNotApplicable(S, 3, "  ")).toThrow(/reason is required/);
		expect(() => declareRiskNotApplicable(S, 7, "no such axis")).toThrow(/axis must be one of/);
		expect(() => declareRiskNotApplicable(S, 2, "liftBundlesToTop은 순수 정렬 함수다")).toThrow(/reason names the code identifier "liftBundlesToTop"/);
		expect(() => declareRiskNotApplicable(S, 1, "claimed inapplicable")).toThrow(/already exercises axis 1/);
		expect(rawState().risk_not_applicable ?? []).toEqual([]);
	});

	test("author-scenario는 해당 없음으로 선언된 축을 다루는 시나리오를 거부하고 상태를 바꾸지 않는다", () => {
		seedStoryApi();
		authorScenario(S, scenarioOpts("s1", "H", [1]));
		declareRiskNotApplicable(S, 3, "no free-text input");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => authorScenario(S, scenarioOpts("s2", "M", [3, 4]))).toThrow(/axis 3 was declared not applicable this cycle/);
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
	});

	test("해당 없음 선언은 cycle 단위여서 다음 cycle에서는 다시 선언해야 한다", () => {
		seedStoryApi();
		authorScenario(S, scenarioOpts("s1", "H", [1, 2, 3, 4, 5]));
		declareRiskNotApplicable(S, 6, "pure read");
		expect(chainOk()).toBe(true);
		incCycle(S);
		expect(chainOk()).toBe(false);
		expect(readQaView(S)!.risk_not_applicable).toEqual([]);
		expect(rawState().risk_not_applicable).toHaveLength(1);
		authorScenario(S, scenarioOpts("s1", "H", [1, 2, 3, 4, 5]));
		declareRiskNotApplicable(S, 6, "still a pure read");
		expect(chainOk()).toBe(true);
	});

	test("story마다 H 우선순위 시나리오가 하나 이상 있어야 chain이 완성된다", () => {
		seedStoryApi();
		authorScenario(S, scenarioOpts("s1", "M", [1, 2, 3]));
		authorScenario(S, scenarioOpts("s2", "L", [4, 5, 6]));
		expect(chainOk()).toBe(false);
		authorScenario(S, scenarioOpts("s3", "H", []));
		expect(chainOk()).toBe(true);
	});

	test("잘못된 시나리오 입력은 거부하고 상태를 바꾸지 않는다", () => {
		seedStoryApi();
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => authorScenario(S, scenarioOpts("s1", "X", []))).toThrow(/priority must be one of/);
		expect(() => authorScenario(S, scenarioOpts("s1", "H", [7]))).toThrow(/risks must be a JSON array of adversarial axes/);
		expect(() => authorScenario(S, scenarioOpts("s1", "H", [2, 2]))).toThrow(/must not repeat an axis/);
		expect(() => authorScenario(S, { ...scenarioOpts("s1", "H", []), steps: [] })).toThrow(/steps must be a non-empty/);
		expect(() => authorScenario(S, { ...scenarioOpts("s1", "H", []), whyNeeded: " " })).toThrow(/why-needed is required/);
		expect(() => authorScenario(S, { ...scenarioOpts("s1", "H", []), story: "missing" })).toThrow(/unknown story "missing"/);
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
	});

	test("기록된 결과가 있는 시나리오를 다시 작성하면 거부하고 결과 없는 시나리오는 덮어쓴다", () => {
		seedStoryApi();
		authorScenario(S, scenarioOpts("s1", "H", [1]));
		authorScenario(S, { ...scenarioOpts("s1", "H", [1]), title: "rewritten before any run" });
		expect(rawState().scenarios).toHaveLength(1);
		expect(rawState().scenarios[0].title).toBe("rewritten before any run");
		recordScenario(S, { story: "story-1", scenario: "s1", status: "fail" });
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => authorScenario(S, { ...scenarioOpts("s1", "H", [1]), title: "rewritten after the run" })).toThrow(/already has a recorded result this cycle/);
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		incCycle(S);
		authorScenario(S, { ...scenarioOpts("s1", "H", [1]), title: "next cycle rewrite" });
		expect(rawState().scenarios.map((scenario: any) => [scenario.cycle, scenario.title])).toEqual([[0, "rewritten before any run"], [1, "next cycle rewrite"]]);
	});

	test("record-scenario는 이번 cycle에 작성된 시나리오만 기록하고 상태 값을 검증한다", () => {
		seedStoryApi();
		expect(() => recordScenario(S, { story: "story-1", scenario: "nope", status: "fail" })).toThrow(/requires a scenario authored this cycle/);
		authorScenario(S, scenarioOpts("s1", "H", [1]));
		expect(() => recordScenario(S, { story: "story-1", scenario: "s1", status: "na" })).toThrow(/status must be one of pass\|fail\|blocked/);
		expect(() => recordScenario(S, { story: "story-1", scenario: "s1", status: "pass" })).toThrow(/evidence-path and evidence-surface/);
	});

	test("inert 선언은 시나리오가 0개일 때만 chain을 완성하고 시나리오를 작성하면 다시 미완성이 된다", () => {
		seedStoryApi();
		expect(chainOk()).toBe(false);
		declareInert(S, "refactor has no reachable risk surface");
		expect(chainOk()).toBe(true);
		authorScenario(S, scenarioOpts("s1", "H", [1]));
		expect(chainOk()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// CLI end-to-end: proves parseArgs + subcommand wiring, not just the TS API.
// ---------------------------------------------------------------------------

describe("qa-state CLI wiring", () => {
	const script = join(import.meta.dir, "qa-state.ts");
	const run = (cmd: string) => execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: process.env });
	const actorCmd = (flags = "--driver bash") => `add-actor --id actor-1 --name "User" --boundary "home" ${flags} --reachable yes --client-impact none --client-impact-reason "no client renders this result"`;
	const storyCmd = (actor = "actor-1") => `add-story --id story-1 --actor ${actor} --goal 'Check supplements' --given '["program exists"]' --when '["open home"]' --then '["today supplements are shown"]' --acceptance-criteria '[0]'`;
	const scenarioCmd = (id: string, priority: string, risks: number[], extra = "") =>
		`author-scenario --story story-1 --id ${id} --title "scenario ${id}" --preconditions "program exists" --steps '["open home"]' --expected "supplements shown" --why-needed "covers ${id}" --priority ${priority} --risks '${JSON.stringify(risks)}' ${extra}`;
	// Three scenarios under one story: one H, two L, jointly covering every adversarial axis 1..6.
	const SCENARIOS: Array<[string, string, number[]]> = [["s1", "H", [1, 2]], ["s2", "L", [3, 4]], ["s3", "L", [5, 6]]];
	const startChain = () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run(actorCmd());
		run(storyCmd());
	};
	const authorCompleteChain = () => {
		startChain();
		for (const [id, priority, risks] of SCENARIOS) run(scenarioCmd(id, priority, risks));
	};
	const scenarioOf = (id: string, cycle = 0) => rawState().scenarios.find((s: any) => s.story === "story-1" && s.id === id && s.cycle === cycle);
	const PASS_EVIDENCE = "--evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash";
	const recordPass = (id: string) => run(`record-scenario --story story-1 --scenario ${id} --status pass ${PASS_EVIDENCE}`);

	test("새 CLI story는 구조화 계약과 AC 링크가 없으면 거부한다", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run(actorCmd());
		expect(() => run('add-story --id story-1 --actor actor-1')).toThrow();
		run(storyCmd());
		expect(rawState().stories[0].contract).toEqual({
			goal: "Check supplements",
			given: ["program exists"],
			when: ["open home"],
			then: ["today supplements are shown"],
			acceptance_criteria: [0],
		});
	});

	test("이미 증거가 있는 story의 계약 변경은 현재 cycle에서 거부한다", () => {
		startChain();
		run(scenarioCmd("s1", "H", [1]));
		run('record-baseline --story story-1 --result fail --note "observed"');
		expect(() => run("add-story --id story-1 --actor actor-1 --goal 'Changed intent' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'")).toThrow(/cannot change an evidenced story contract/);
	});

	test("시나리오 결과가 기록된 story의 계약 변경도 현재 cycle에서 거부한다", () => {
		startChain();
		run(scenarioCmd("s1", "H", [1]));
		run("record-scenario --story story-1 --scenario s1 --status fail");
		expect(() => run("add-story --id story-1 --actor actor-1 --goal 'Changed intent' --given '[\"program exists\"]' --when '[\"open home\"]' --then '[\"today supplements are shown\"]' --acceptance-criteria '[0]'")).toThrow(/cannot change an evidenced story contract/);
	});

	test("현재 cycle evidence 이후 참조된 AC 텍스트 변경은 거부한다", () => {
		authorCompleteChain();
		run('record-baseline --story story-1 --result fail --note "observed"');
		expect(() => run("set-acceptance --json '[\"rewritten AC\"]'")).toThrow(/cannot change referenced acceptance criteria/);
		expect(rawState().acceptance_criteria).toEqual(["home shows today supplements"]);
	});

	test("add-actor는 --client-impact 없이는 거부한다", () => {
		run("set --phase PLAN");
		expect(() => run('add-actor --id actor-1 --name "User" --boundary "home" --driver bash --reachable yes')).toThrow(/client-impact must be one of/);
		expect(rawState().actors ?? []).toEqual([]);
	});

	test("author-cell, record-cell, waive는 폐기되어 안내 메시지와 함께 거부된다", () => {
		authorCompleteChain();
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run('author-cell --story story-1 --cls 1 --attack-point "attack" --priority H')).toThrow(/author-cell is retired: author user scenarios with author-scenario/);
		expect(() => run("record-cell --story story-1 --cls 1 --status fail")).toThrow(/record-cell is retired: .*record-scenario/);
		expect(() => run('waive --story story-1 --cls 1 --reason "user approved exception"')).toThrow(/waive is retired/);
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
	});

	test("화면 액터는 텍스트 근거만으로 성공을 기록할 수 없음", () => {
		authorCompleteChain();
		run('add-actor --id actor-1 --driver agent-browser --reachable yes');
		const evidence = join(tmpDir, "observation.log");
		writeFileSync(evidence, "Clicked export; received HTTP 200; screen showed success.");
		expect(() => run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${evidence} --evidence-surface agent-browser`)).toThrow();
		const before = join(tmpDir, "before.png");
		const after = join(tmpDir, "after.png");
		const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dAAAAABJRU5ErkJggg==", "base64");
		writeFileSync(before, png);
		writeFileSync(after, png);
		expect(() => run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${after} --evidence-surface agent-browser --evidence-before ${before} --evidence-action ${evidence} --evidence-after ${after}`)).not.toThrow();
		const reviewFile = join(tmpDir, "review.json");
		writeFileSync(reviewFile, JSON.stringify([{ claim: "오류 안내 표시", verdict: "insufficient", observation: "단색 픽셀만 보임", gap: "실제 실패 안내 화면을 다시 캡처", sources: [{ path: after, location: "전체 이미지" }] }]));
		expect(() => run(`review-evidence --story story-1 --scenario s1 --json-file ${reviewFile}`)).not.toThrow();
		expect(scenarioOf("s1").evidence_review.claims[0].verdict).toBe("insufficient");
		expect(rawState().derived.record_complete).toBe(false);
		const savedReview = scenarioOf("s1").evidence_review;
		expect(savedReview.files[after]).toMatch(/^[a-f0-9]{64}$/);
		expect(savedReview.cell_snapshot).toContain("story-1");
		run('add-actor --id actor-1 --boundary "another user boundary" --reachable yes');
		expect(scenarioOf("s1").evidence_review).toBeUndefined();
		expect(() => run(`review-evidence --story story-1 --scenario s1 --json-file ${reviewFile}`)).toThrow(/executed current-cycle scenario with evidence/);
		run(actorCmd("--driver agent-browser").replace("actor-1", "actor-2").replace('"User"', '"Other"').replace('"home"', '"other home"'));
		run(storyCmd("actor-2"));
		expect(scenarioOf("s1").evidence_review).toBeUndefined();
		writeFileSync(reviewFile, JSON.stringify([{ claim: "오류 안내 표시", verdict: "supported", observation: "보임", gap: "", sources: [] }]));
		expect(() => run(`review-evidence --story story-1 --scenario s1 --json-file ${reviewFile}`)).toThrow();
		writeFileSync(after, "This is a text log renamed as an image, not a screenshot.");
		expect(() => run(`record-scenario --story story-1 --scenario s2 --status fail --evidence-before ${before} --evidence-action ${evidence} --evidence-after ${after}`)).toThrow();
	});

	// An automated test run (unit/integration/component/e2e) that exercises the
	// scenario now counts as that scenario's evidence when recorded under the
	// explicit `test` evidence surface — efficient QA in place of always driving
	// a UI/emulator. Fragments are concatenated at runtime so the assembled FILE
	// matches real test-runner output, while THIS source file does not.
	const VITEST_LOG =
		" RUN  v" + "3.2.4 /Users/toong/repos/algocare-home/apps/backend\n\n" +
		" ok test/domains/customer-label/delete-guard (7 tests)\n\n" +
		" Test Fil" + "es  1 passed (1)\n      Test" + "s  1 passed | 6 skipped (7)\n   Duration  1.95s\nexit=0\n";
	const QUIET_PYTEST_PASS = "1 pass" + "ed in 0.04s\n";
	const JUNIT_REPORT = '<?xml version="1.0"?><testsuite tests="1" failures="0"><testcase /></testsuite>';

	const AUTOMATED_TEST_REPORTS: Record<string, string> = {
		vitest: VITEST_LOG,
		pytest: QUIET_PYTEST_PASS,
		junit: JUNIT_REPORT,
	};

	for (const [name, report] of Object.entries(AUTOMATED_TEST_REPORTS)) {
		test(`record-scenario ACCEPTS a ${name} report as pass evidence via evidence-surface test`, () => {
			authorCompleteChain();
			const logPath = join(tmpDir, `s1-${name}-test-evidence.txt`);
			writeFileSync(logPath, report);
			expect(() =>
				run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${logPath} --evidence-surface test`),
			).not.toThrow();
			expect(scenarioOf("s1").evidence.surface).toBe("test");
		});

		// A test log under the actor driver's surface would read as that driver's
		// observation (e.g. "observed via curl"); the surface must name the medium.
		test(`record-scenario REJECTS a ${name} report under the actor driver's surface`, () => {
			authorCompleteChain();
			const logPath = join(tmpDir, `s1-${name}-driver-surface.txt`);
			writeFileSync(logPath, report);
			expect(() =>
				run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${logPath} --evidence-surface bash`),
			).toThrow(/--evidence-surface test/);
		});
	}

	test("record-scenario REJECTS an evidence-surface that matches neither the actor driver nor \"test\"", () => {
		authorCompleteChain();
		const logPath = join(tmpDir, "s1-mismatched-surface.txt");
		writeFileSync(logPath, "HTTP/1.1 200 OK\n\n{\"ok\":true}\n");
		expect(() =>
			run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${logPath} --evidence-surface curl`),
		).toThrow(/evidence-surface must match actor driver/);
	});

	test("agent-device test-surface evidence needs no before/after or evidence review; recordComplete/approveOk accept it", () => {
		authorCompleteChain();
		run('add-actor --id actor-1 --driver agent-device --reachable yes');
		run(`record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface test`);
		for (const [id] of SCENARIOS) {
			run(`record-scenario --story story-1 --scenario ${id} --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface test`);
		}
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result pass");
		run("record-run-check --check flaky-rerun --result pass");
		expect(scenarioOf("s1").evidence.before).toBeUndefined();
		expect(scenarioOf("s1").evidence_review).toBeUndefined();
		expect(rawState().derived.record_complete).toBe(true);
		expect(rawState().derived.approve_ok).toBe(true);
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
	});

	test("agent-device actor still requires before/after screenshots when evidence-surface is its own driver", () => {
		authorCompleteChain();
		run('add-actor --id actor-1 --driver agent-device --reachable yes');
		const logPath = join(tmpDir, "s1-device-plain.txt");
		writeFileSync(logPath, "device screen text dump");
		expect(() =>
			run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${logPath} --evidence-surface agent-device`),
		).toThrow();
	});

	test("record-scenario ACCEPTS a real boundary observation (client-received response, no test-runner signature)", () => {
		authorCompleteChain();
		const apiPath = join(tmpDir, "s1-response.txt");
		writeFileSync(apiPath, "HTTP/1.1 409 Conflict\n\n{\"error\":\"label in use by 1 bundle\",\"deleted\":false}\n");
		expect(() =>
			run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${apiPath} --evidence-surface bash`),
		).not.toThrow();
	});

	test("record-baseline is EXEMPT: build/test/lint logs are its expected evidence", () => {
		authorCompleteChain();
		const logPath = join(tmpDir, "baseline-tests.txt");
		writeFileSync(logPath, VITEST_LOG);
		expect(() =>
			run(`record-baseline --story story-1 --result pass --evidence-path ${logPath} --evidence-surface bash`),
		).not.toThrow();
	});

	test("CLI set/get round-trip", () => {
		run('set --phase PLAN --target "cli target"');
		expect(rawState().phase).toBe("PLAN");
		expect(rawState().target).toBe("cli target");
		const out = run("get");
		const parsed = JSON.parse(out);
		expect(parsed.phase).toBe("PLAN");
		expect(parsed.target).toBe("cli target");
	});

	test("CLI inc-cycle prints cycle+terminate JSON", () => {
		run("set --phase PRE-FLIGHT");
		const out = run("inc-cycle");
		const parsed = JSON.parse(out);
		expect(parsed.cycle).toBe(1);
		expect(parsed.terminate).toBe(false);
	});

	test("CLI complete deactivates the session; get then reports absent", () => {
		run("set --phase PRE-FLIGHT");
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		expect(rawState().active).toBe(false);
		const out = run("get").trim();
		expect(out).toBe("null");
	});

	const recordAllPass = () => {
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		for (const [id] of SCENARIOS) recordPass(id);
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result pass");
	};

	const writeAttemptLog = () => {
		const log = join(tmpDir, "attempts.txt");
		writeFileSync(log, "$ docker compose up -d postgres\nCannot connect to the Docker daemon\n");
		return log;
	};

	test("set-verdict follows recorded outcomes: a fail scenario refuses APPROVE and permits REQUEST_CHANGES", () => {
		authorCompleteChain();
		recordAllPass();
		run("record-scenario --story story-1 --scenario s1 --status fail");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("set-verdict APPROVE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		run("set-verdict REQUEST_CHANGES");
		expect(rawState().verdict).toBe("REQUEST_CHANGES");
	});

	test("실패한 시나리오가 H가 아니면 COMMENT는 허용하고 H이면 거부한다", () => {
		authorCompleteChain();
		recordAllPass();
		run("record-scenario --story story-1 --scenario s2 --status fail");
		run("set-verdict COMMENT");
		expect(rawState().verdict).toBe("COMMENT");
		run("record-scenario --story story-1 --scenario s1 --status fail");
		expect(() => run("set-verdict COMMENT")).toThrow(/COMMENT refused/);
	});

	test("REQUEST_CHANGES는 제품 실패 기록 없이 거부되고 거부 메시지가 남은 실행을 안내함", () => {
		authorCompleteChain();
		recordAllPass();
		// dirty-worktree fail is harness debris; every scenario passed.
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("set-verdict REQUEST_CHANGES")).toThrow(/requires a recorded failure/);
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
	});

	test("미실행 시나리오가 남으면 APPROVE·COMMENT·REQUEST_CHANGES 모두 거부됨", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		recordPass("s2");
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result pass");
		run("record-run-check --check flaky-rerun --result pass");
		for (const verdict of ["APPROVE", "COMMENT", "REQUEST_CHANGES"]) expect(() => run(`set-verdict ${verdict}`)).toThrow();
		expect(rawState().verdict ?? null).toBeNull();
	});

	test("blocked requires obstacle, attempts, deepest-reachable, and a readable attempt log, then resolves APPROVE", () => {
		authorCompleteChain();
		recordAllPass();
		const log = writeAttemptLog();
		const base = "record-scenario --story story-1 --scenario s3 --status blocked";
		expect(() => run(base)).toThrow();
		expect(() => run(`${base} --obstacle "PGlite has one connection" --attempts '[]' --deepest-reachable PGlite --attempt-log ${log}`)).toThrow(/attempts/);
		expect(() => run(`${base} --obstacle "PGlite has one connection" --attempts '["docker compose up → daemon down"]' --deepest-reachable PGlite --attempt-log ${join(tmpDir, "missing.txt")}`)).toThrow();
		run(`${base} --obstacle "PGlite has one connection" --attempts '["docker compose up → daemon down"]' --deepest-reachable PGlite --attempt-log ${log}`);
		const scenario = scenarioOf("s3");
		expect(scenario.status).toBe("blocked");
		expect(scenario.evidence).toBeUndefined();
		expect(scenario.blocked).toEqual({ obstacle: "PGlite has one connection", attempts: ["docker compose up → daemon down"], deepest_reachable: "PGlite", attempt_log: log });
		expect(() => run("set-verdict REQUEST_CHANGES")).toThrow();
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
	});

	test("start resets a completed cycle and refuses to launder active work", () => {
		run("set-acceptance --json '[\"first cycle AC\"]'");
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		const completed = rawState();
		completed.report = { path: "/old.html", sha256: "a".repeat(64), state_snapshot: "old", reviewed: true };
		completed.trusted_receipts = [{ attempt_id: "old-attempt", receipt_path: "/old/receipt.json", sha256: "b".repeat(64) }];
		completed.risk_not_applicable = [{ axis: 3, reason: "old", cycle: 0 }];
		completed.device_profiles = [PHONE];
		writeFileSync(resolveStatePath(S), JSON.stringify(completed));
		run('start --target "second cycle"');
		const reset = rawState();
		expect(reset.active).toBe(true);
		expect(reset.derived.chain_complete).toBe(false);
		expect(reset.derived.driver_gate_armed).toBe(true);
		expect(reset.verdict).toBeNull();
		expect(reset.phase_max).toBe(0);
		expect(reset.cycle).toBe(0);
		expect(reset.acceptance_criteria).toEqual([]);
		expect(reset.report).toBeUndefined();
		expect(reset.trusted_receipts).toEqual([]);
		expect(reset.scenarios).toEqual([]);
		expect(reset.risk_not_applicable).toEqual([]);
		expect(reset.device_profiles).toEqual([]);
		run(actorCmd());
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run('start --target "launder"')).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
	});

	test("complete is gated and accepts the four normative arms", () => {
		run("set-verdict REQUEST_CHANGES");
		run("complete");
		// Re-enter, author a complete but failing chain, and close with RC.
		run('start --target "recorded failure"');
		authorCompleteChain();
		run("record-baseline --story story-1 --result fail --note broken");
		for (const [id] of SCENARIOS) run(`record-scenario --story story-1 --scenario ${id} --status fail`);
		run("record-run-check --check stale-state --result fail --note stale");
		run("record-run-check --check dirty-worktree --result fail --note debris");
		run("record-run-check --check flaky-rerun --result fail --note flaky");
		run("set-verdict REQUEST_CHANGES");
		expect(() => run("complete")).toThrow("report");
		const report = join(tmpDir, "report.html");
		execSync(`bun ${join(import.meta.dir, "qa-report.ts")} --session ${S} --out ${report}`, { env: process.env });
		expect(() => run("complete")).toThrow("report");
		run(`review-report --path ${report}`);
		writeFileSync(report, readFileSync(report, "utf8") + "<!-- changed -->");
		expect(() => run("complete")).toThrow("report");
		expect(() => run(`review-report --path ${report}`)).toThrow("current report");
		execSync(`bun ${join(import.meta.dir, "qa-report.ts")} --session ${S} --out ${report}`, { env: process.env });
		run(`review-report --path ${report}`);
		run("complete");
		expect(rawState().active).toBe(false);
	});

	test("declare-inert requires a reason and records an inert view", () => {
		authorCompleteChain();
		expect(() => run("declare-inert")).toThrow();
		run('declare-inert --reason "refactor has no reachable risk surface"');
		const view = JSON.parse(run("get"));
		expect(view.verdict_report.inert.reason).toContain("no reachable");
	});

	test("이전 사이클 기록이 있어도 현재 보고서 제출이 가능함", () => {
		authorCompleteChain();
		run("record-scenario --story story-1 --scenario s1 --status fail");
		run("inc-cycle");
		const report = join(tmpDir, "next-cycle.html");
		expect(() => execSync(`bun ${join(import.meta.dir, "qa-report.ts")} --session ${S} --out ${report}`, { env: process.env })).not.toThrow();
		expect(rawState().report.path).toBe(report);
	});

	test("모든 위험 축이 해당 없음으로 선언되면 위험 시나리오 없이 APPROVE가 가능함", () => {
		startChain();
		run(scenarioCmd("s1", "H", []));
		expect(rawState().derived.chain_complete).toBe(false);
		for (const axis of [1, 2, 3, 4, 5, 6]) run(`declare-risk-na --axis ${axis} --reason "rename-only refactor; no behavior reaches axis ${axis}"`);
		expect(rawState().derived.chain_complete).toBe(true);
		run("record-baseline --story story-1 --result pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		recordPass("s1");
		run("record-run-check --check stale-state --result pass");
		run("record-run-check --check dirty-worktree --result pass");
		run("record-run-check --check flaky-rerun --result pass");
		run("set-verdict APPROVE");
		expect(rawState().verdict).toBe("APPROVE");
		const report = join(tmpDir, "inert-report.html");
		execSync(`bun ${join(import.meta.dir, "qa-report.ts")} --session ${S} --out ${report}`, { env: process.env });
		run(`review-report --path ${report}`);
		run("complete");
		expect(rawState().active).toBe(false);
	});

	test("declare-risk-na CLI는 --axis와 --reason을 요구하고 해당 축 시나리오 작성을 막는다", () => {
		startChain();
		run(scenarioCmd("s1", "H", [1]));
		expect(() => run("declare-risk-na --reason x")).toThrow(/axis is required/);
		expect(() => run("declare-risk-na --axis 3")).toThrow(/reason is required/);
		run('declare-risk-na --axis 3 --reason "no free-text input"');
		expect(rawState().risk_not_applicable).toEqual([{ axis: 3, reason: "no free-text input", cycle: 0 }]);
		expect(() => run(scenarioCmd("s2", "M", [3]))).toThrow(/declared not applicable/);
	});

	test("lock serializes concurrent blocked and pass record-scenario writes", () => {
		authorCompleteChain();
		const log = writeAttemptLog();
		const scriptPath = join(import.meta.dir, "qa-state.ts");
		execSync(
			`(bun ${scriptPath} record-scenario --story story-1 --scenario s1 --status blocked --obstacle "no daemon" --attempts '["docker compose up → daemon down"]' --deepest-reachable PGlite --attempt-log ${log} & bun ${scriptPath} record-scenario --story story-1 --scenario s2 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash & wait)`,
			{ encoding: "utf8", env: process.env, shell: "/bin/sh" },
		);
		expect(scenarioOf("s1").status).toBe("blocked");
		expect(scenarioOf("s2").status).toBe("pass");
	});

	test("get separates prior-cycle scenario records from the current-cycle view", () => {
		authorCompleteChain();
		run("record-scenario --story story-1 --scenario s1 --status fail");
		run("inc-cycle");
		run(scenarioCmd("s1", "H", [1, 2]));
		const view = JSON.parse(run("get"));
		expect(view.cycle).toBe(1);
		expect(view.scenarios.some((scenario: any) => scenario.id === "s1" && scenario.cycle === 1)).toBe(true);
		expect(view.prior_cycle_scenarios.some((scenario: any) => scenario.id === "s1" && scenario.cycle === 0)).toBe(true);
	});

	test("get excludes prior-cycle baseline and run-check records from the current view", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result fail --note first-cycle");
		run("record-run-check --check stale-state --result fail --note first-cycle");
		run("record-run-check --check dirty-worktree --result pass");
		run("record-run-check --check flaky-rerun --result pass");
		run("inc-cycle");

		const view = JSON.parse(run("get"));
		expect(view.stories[0].baseline).toBeNull();
		expect(view.run_checks.stale_state).toBeNull();
		expect(view.run_checks.dirty_worktree).toBeNull();
		expect(view.run_checks.flaky_rerun).toBeNull();
	});

	test("inc-cycle invalidates chain completion until current-cycle scenarios are authored", () => {
		authorCompleteChain();
		expect(rawState().derived.chain_complete).toBe(true);
		run("inc-cycle");
		expect(rawState().derived.chain_complete).toBe(false);
	});

	test("byte-identical: unknown actor and invalid authoring are refused before write", () => {
		run("set --phase PLAN");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("add-story --id story-1 --actor missing")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		run(actorCmd());
		const beforeScenario = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run(scenarioCmd("s1", "H", [1]).replace("--story story-1", "--story missing"))).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(beforeScenario);
	});

	test("phase gate: both phase writers refuse BASELINE until the chain is complete", () => {
		run("set --phase PLAN");
		const before = readFileSync(resolveStatePath(S), "utf8");
		expect(() => run("advance-phase BASELINE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		expect(() => run("set --phase BASELINE")).toThrow();
		expect(readFileSync(resolveStatePath(S), "utf8")).toBe(before);
		authorCompleteChain();
		expect(() => run("advance-phase BASELINE")).not.toThrow();
	});

	test("phase_max: high-water mark is not lowered by a backward set", () => {
		authorCompleteChain();
		run('advance-phase "ADVERSARIAL E2E"');
		expect(rawState().phase_max).toBe(3);
		run("set --phase PLAN");
		expect(rawState().phase).toBe("PLAN");
		expect(rawState().phase_max).toBe(3);
	});

	test("re-record: current-cycle records replace while prior-cycle records remain", () => {
		authorCompleteChain();
		run("record-scenario --story story-1 --scenario s1 --status fail");
		recordPass("s1");
		expect(scenarioOf("s1").status).toBe("pass");
		expect(scenarioOf("s1").blocked).toBeUndefined();
		run("inc-cycle");
		run(scenarioCmd("s1", "H", [1, 2]));
		run("record-scenario --story story-1 --scenario s1 --status fail");
		const records = rawState().scenarios.filter((scenario: any) => scenario.story === "story-1" && scenario.id === "s1");
		expect(records).toHaveLength(2);
		expect(records[0].cycle).toBe(0);
		expect(records[0].status).toBe("pass");
		expect(records[1].cycle).toBe(1);
		expect(records[1].status).toBe("fail");
	});

	test("re-recorded baseline and run-check history survive later writes", () => {
		authorCompleteChain();
		run("record-baseline --story story-1 --result fail --note first");
		run("inc-cycle");
		run("record-baseline --story story-1 --result fail --note second");
		run("record-run-check --check stale-state --result fail --note first");
		run("inc-cycle");
		run("record-run-check --check stale-state --result fail --note second");
		const state = rawState();
		expect(state.stories[0].baseline_history).toEqual([
			expect.objectContaining({ result: "fail", note: "first", cycle: 0 }),
		]);
		expect(state.run_checks_history["stale-state"]).toEqual([
			expect.objectContaining({ result: "fail", note: "first", cycle: 1 }),
		]);
	});

	test("derived: every successful chain write persists recomputed flags", () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run(actorCmd());
		const afterActor = rawState();
		expect(afterActor.derived).toMatchObject({ chain_complete: false, driver_gate_armed: true });
		run(storyCmd());
		expect(rawState()).toHaveProperty("derived.chain_complete");
	});

	test("funnel: exported phase writers share the BASELINE gate", () => {
		setQaState(S, { phase: "PLAN" });
		expect(() => advancePhase(S, "BASELINE")).toThrow();
		expect(() => setQaState(S, { phase: "BASELINE" })).toThrow();
	});

	test("(B2) CLI exits non-zero when no session identifier is available", () => {
		const env: NodeJS.ProcessEnv = { ...process.env, OMT_SESSION_ID: "" };
		delete env.CODEX_THREAD_ID;
		expect(() =>
			execSync(`bun ${script} set --phase PLAN`, { encoding: "utf8", env }),
		).toThrow();
		const defaultPath = `${tmpDir}/qa-state-default.json`;
		expect(existsSync(defaultPath)).toBe(false);
	});

	// -------------------------------------------------------------------------
	// Report-rendering schema extension: author-scenario/record-scenario
	// round-trip the optional structured scenario fields and 3-slot evidence.
	// -------------------------------------------------------------------------

	test("author-scenario records the structured scenario fields and optional source", () => {
		startChain();
		run(scenarioCmd("s1", "H", [1, 3], "--source self-authored --driven-at \"app screen\""));
		const scenario = scenarioOf("s1");
		expect(scenario).toMatchObject({
			story: "story-1",
			id: "s1",
			title: "scenario s1",
			preconditions: "program exists",
			steps: ["open home"],
			expected: "supplements shown",
			why_needed: "covers s1",
			priority: "H",
			risks: [1, 3],
			cycle: 0,
			source: "self-authored",
			driven_at: "app screen",
		});
		expect(scenario.profile).toBeUndefined();
	});

	test("set-acceptance records the acceptance criteria (full-replace)", () => {
		run("set --phase PLAN");
		run(`set-acceptance --json '["V2 read returns category-only DTO","Unauthenticated request yields 401"]'`);
		expect(rawState().acceptance_criteria).toEqual([
			"V2 read returns category-only DTO",
			"Unauthenticated request yields 401",
		]);
		run(`set-acceptance --json '["only this one now"]'`);
		expect(rawState().acceptance_criteria).toEqual(["only this one now"]);
	});

	test("set-acceptance rejects non-string criteria instead of stringifying them", () => {
		run("set --phase PLAN");
		expect(() => run(`set-acceptance --json '[42]'`)).toThrow();
	});

	test("record-scenario round-trips driven-at, scenario fields, and 3-slot evidence", () => {
		startChain();
		run(scenarioCmd("s1", "H", [1]));
		run(
			"record-scenario --story story-1 --scenario s1 --status pass " +
				"--evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash " +
				'--driven-at "app screen" --source self-authored ' +
				"--evidence-before skills/qa/scripts/qa-state.test.ts " +
				"--evidence-action skills/qa/scripts/qa-state.test.ts " +
				"--evidence-after skills/qa/scripts/qa-state.test.ts",
		);
		const scenario = scenarioOf("s1");
		expect(scenario.driven_at).toBe("app screen");
		expect(scenario.why_needed).toBe("covers s1");
		expect(scenario.source).toBe("self-authored");
		expect(scenario.evidence.before).toContain("qa-state.test.ts");
		expect(scenario.evidence.action).toContain("qa-state.test.ts");
		expect(scenario.evidence.after).toContain("qa-state.test.ts");
		// existing pass-evidence contract (path/surface) stays intact alongside the 3-slot addition
		expect(scenario.evidence.path).toContain("qa-state.test.ts");
		expect(scenario.evidence.surface).toBe("bash");
	});

	test("record-scenario records the 3-slot evidence on a FAIL scenario too (no pass-evidence required)", () => {
		startChain();
		run(scenarioCmd("s1", "H", [1]));
		run(
			"record-scenario --story story-1 --scenario s1 --status fail " +
				"--evidence-before skills/qa/scripts/qa-state.test.ts " +
				"--evidence-after skills/qa/scripts/qa-state.test.ts",
		);
		const scenario = scenarioOf("s1");
		expect(scenario.status).toBe("fail");
		expect(scenario.evidence.before).toContain("qa-state.test.ts");
		expect(scenario.evidence.after).toContain("qa-state.test.ts");
	});

	test("record-scenario rejects an invalid --source value", () => {
		startChain();
		run(scenarioCmd("s1", "H", [1]));
		expect(() => run("record-scenario --story story-1 --scenario s1 --status fail --source bogus")).toThrow();
	});
});

describe("help subcommand", () => {
	// help renders this CLI's roster via the shared lib/cli-help.ts renderer, grouped by
	// authority. This pins the qa-specific wiring (roster tags), not the renderer's own
	// formatting — that's covered by lib/cli-help.test.ts.
	const script = join(import.meta.dir, "qa-state.ts");
	const run = (cmd: string, env?: Record<string, string>) =>
		execSync(`bun ${script} ${cmd}`, { encoding: "utf8", env: { ...process.env, ...env } });
	const actorCmd = (id: string, boundary: string) => `add-actor --id ${id} --name "User" --boundary "${boundary}" --driver bash --reachable yes --client-impact none --client-impact-reason "no client renders this result"`;
	const storyCmd = (actor: string) => `add-story --id story-1 --actor ${actor} --goal 'Check supplements' --given '["program exists"]' --when '["open home"]' --then '["today supplements are shown"]' --acceptance-criteria '[0]'`;
	const scenarioCmd = (id: string, priority: string, risks: number[]) =>
		`author-scenario --story story-1 --id ${id} --title "scenario ${id}" --preconditions "program exists" --steps '["open home"]' --expected "supplements shown" --why-needed "covers ${id}" --priority ${priority} --risks '${JSON.stringify(risks)}'`;
	const authorCompleteChain = () => {
		run("set --phase PLAN");
		run("set-acceptance --json '[\"home shows today supplements\"]'");
		run(actorCmd("actor-1", "home"));
		run(storyCmd("actor-1"));
		run(scenarioCmd("s1", "H", [1, 2, 3, 4, 5, 6]));
	};
	const scenarioOf = (id: string, cycle: number) => rawState().scenarios.find((s: any) => s.story === "story-1" && s.id === id && s.cycle === cycle);

	test("retired waive is not listed and force-complete is the only user-only command", () => {
		const out = run("help");
		const aiSection = out.slice(out.indexOf("AI-USABLE"), out.indexOf("USER-ONLY"));
		const userSection = out.slice(out.indexOf("USER-ONLY"));
		expect(aiSection).not.toContain("waive —");
		expect(aiSection).not.toContain("force-complete —");
		expect(userSection.trim().split("\n").filter((line) => line.startsWith("  "))).toEqual([
			expect.stringContaining("force-complete —"),
		]);
	});

	test("scenario commands are listed under AI-USABLE", () => {
		const out = run("help");
		const aiSection = out.slice(out.indexOf("AI-USABLE"), out.indexOf("USER-ONLY"));
		for (const name of ["author-scenario", "record-scenario", "declare-risk-na"]) expect(aiSection).toContain(`${name} —`);
	});

	test("set and get are listed under AI-USABLE", () => {
		const out = run("help");
		const aiSection = out.slice(out.indexOf("AI-USABLE"), out.indexOf("SYSTEM-ONLY"));
		expect(aiSection).toContain("set —");
		expect(aiSection).toContain("get —");
	});

	test("Usage fallback lists help plus every roster command", () => {
		expect(() => run("bogus-subcommand")).toThrow();
		try {
			run("bogus-subcommand");
		} catch (e: any) {
			expect(e.stderr.toString()).toContain("help|set|");
		}
	});

	// help is a discovery command — it must not require resolveSessionIdOrThrow's
	// precondition. What breaks if this regresses: help runs after the session-id
	// resolution again and throws with no session id set.
	test("prints without a session id set (session-independent discovery)", () => {
		const out = run("help", { OMT_SESSION_ID: "", CODEX_THREAD_ID: "" });
		expect(out).toContain("qa-state commands:");
	});

	test("JUnit XML is scenario evidence only under evidence-surface test, never under the actor driver", () => {
		authorCompleteChain();
		const junit = join(tmpDir, "junit.xml");
		writeFileSync(junit, '<?xml version="1.0"?><testsuite tests="1" failures="0"><testcase /></testsuite>');
		expect(() => run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${junit} --evidence-surface bash`)).toThrow(/--evidence-surface test/);
		run("inc-cycle");
		run(scenarioCmd("s1", "H", [1, 2, 3, 4, 5, 6]));
		expect(() => run(`record-scenario --story story-1 --scenario s1 --status pass --evidence-path ${junit} --evidence-surface test`)).not.toThrow();
	});

	test("actor change only invalidates current-cycle execution and keeps history", () => {
		authorCompleteChain();
		run("record-scenario --story story-1 --scenario s1 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		run("inc-cycle");
		run(scenarioCmd("s1", "H", [1, 2, 3, 4, 5, 6]));
		run("record-scenario --story story-1 --scenario s1 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		run(actorCmd("actor-2", "other home"));
		run(storyCmd("actor-2"));
		expect(scenarioOf("s1", 0)?.status).toBe("pass");
		expect(scenarioOf("s1", 1)?.status).toBeUndefined();
	});

	test("actor change invalidates current-cycle execution while retaining the authored scenario", () => {
		authorCompleteChain();
		run("record-scenario --story story-1 --scenario s1 --status pass --evidence-path skills/qa/scripts/qa-state.test.ts --evidence-surface bash");
		const before = scenarioOf("s1", 0);
		run(actorCmd("actor-2", "other home"));
		run(storyCmd("actor-2"));
		const after = scenarioOf("s1", 0);
		expect(after.title).toBe(before.title);
		expect(after.steps).toEqual(before.steps);
		expect(after.priority).toBe(before.priority);
		expect(after.risks).toEqual(before.risks);
		expect(after.status).toBeUndefined();
		expect(after.evidence).toBeUndefined();
		expect(after.evidence_review).toBeUndefined();
		expect(after.case_run).toBeUndefined();
	});
});


// Type-only compile-time smoke: ensures QaState shape is exported and usable.
const _typeCheck: QaState = {
	active: true,
	phase: "PRE-FLIGHT",
	cycle: 0,
	max_cycles: 5,
	target: "",
	started_at: "2026-01-01T00:00:00",
	last_touched_at: "2026-01-01T00:00:00",
};
void _typeCheck;
