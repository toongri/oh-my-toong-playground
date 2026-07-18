import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import {
	initDeepInterviewState,
	updateDeepInterviewState,
	readDeepInterviewState,
	resolveStatePath,
	computeAmbiguityFloor,
} from "./deep-interview-state.ts";
import type { DeepInterviewStateContent, ClarityScores } from "./deep-interview-state.ts";

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;
const SID = "T";

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "di-state-test-"));
	process.env.OMT_DIR = tmpDir;
	process.env.OMT_SESSION_ID = SID;
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

/** Write a seed-shaped file (what PreToolUse hook creates) */
function writeSeed(sid: string = SID): void {
	const seed = {
		active: true,
		started_at: "2026-01-01T00:00:00+00:00",
		last_touched_at: "2026-01-01T00:00:00+00:00",
	};
	writeFileSync(resolveStatePath(sid), JSON.stringify(seed, null, 2), "utf8");
}

function rawState(sid: string = SID): Record<string, unknown> {
	return JSON.parse(readFileSync(resolveStatePath(sid), "utf8")) as Record<string, unknown>;
}

describe("deep-interview state", () => {
	// AC A4/A5 — init overlays into seed; update merges and refreshes heartbeat; single file
	test("A4/A5: init overlays rich shape into seed; update merges and refreshes last_touched_at; one file throughout", async () => {
		writeSeed();

		// init with initial_idea
		initDeepInterviewState(SID, { initial_idea: "build X" });

		const afterInit = rawState();
		// Seed fields preserved
		expect(afterInit["active"]).toBe(true);
		expect(typeof afterInit["started_at"]).toBe("string");
		// Rich state overlaid
		expect((afterInit["state"] as Record<string, unknown>)["initial_idea"]).toBe("build X");
		expect(afterInit["current_phase"]).toBe("deep-interview");
		// Still one file
		const files = readdirSync(tmpDir).filter((f: string) =>
			f.startsWith("deep-interview-active-state-"),
		);
		expect(files).toHaveLength(1);
		expect(files[0]).toBe(`deep-interview-active-state-${SID}.json`);

		const ltaBefore = String(afterInit["last_touched_at"]);

		// Small delay so last_touched_at advances
		await new Promise((r) => setTimeout(r, 1100));

		// update with current_phase
		updateDeepInterviewState(SID, { current_phase: "phase2" });

		const afterUpdate = rawState();
		// Rich fields preserved
		expect((afterUpdate["state"] as Record<string, unknown>)["initial_idea"]).toBe("build X");
		// current_phase updated
		expect(afterUpdate["current_phase"]).toBe("phase2");
		// last_touched_at advanced
		expect(afterUpdate["last_touched_at"]).not.toBe(ltaBefore);
		// Still one file
		const files2 = readdirSync(tmpDir).filter((f: string) =>
			f.startsWith("deep-interview-active-state-"),
		);
		expect(files2).toHaveLength(1);
	});

	// self-heal-init — init on absent file seeds the pristine skeleton, then overlays
	// (the PreToolUse hook never fired, e.g. slash-command entry)
	test("self-heal-init: init on absent file seeds then succeeds", () => {
		expect(existsSync(resolveStatePath(SID))).toBe(false);
		expect(() => initDeepInterviewState(SID, { initial_idea: "x" })).not.toThrow();
		expect(existsSync(resolveStatePath(SID))).toBe(true);
		const parsed = JSON.parse(readFileSync(resolveStatePath(SID), "utf8")) as Record<
			string,
			unknown
		>;
		expect((parsed.state as Record<string, unknown>).initial_idea).toBe("x");
	});

	// self-heal-update — update on absent file seeds the pristine skeleton, then overlays
	// (this is the original incident: a round-2 update on a never-seeded file)
	test("self-heal-update: update on absent file seeds then succeeds", () => {
		expect(existsSync(resolveStatePath(SID))).toBe(false);
		expect(() => updateDeepInterviewState(SID, { current_phase: "phase1" })).not.toThrow();
		expect(existsSync(resolveStatePath(SID))).toBe(true);
		const parsed = JSON.parse(readFileSync(resolveStatePath(SID), "utf8")) as Record<
			string,
			unknown
		>;
		expect(parsed.current_phase).toBe("phase1");
	});

	// AC sessionId-free — no sessionId field written
	test("sessionId-free: init output contains no sessionId field", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "build Y" });
		const state = rawState();
		expect(Object.prototype.hasOwnProperty.call(state, "sessionId")).toBe(false);
		// Also check nested state object
		const nested = state["state"] as Record<string, unknown> | undefined;
		if (nested) {
			expect(Object.prototype.hasOwnProperty.call(nested, "sessionId")).toBe(false);
		}
	});

	// AC E2c — purpose recorded: .state.initial_idea non-empty after init
	test("E2c: .state.initial_idea is non-empty after init", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "the real idea" });
		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		expect(typeof nested["initial_idea"]).toBe("string");
		expect((nested["initial_idea"] as string).length).toBeGreaterThan(0);
	});

	// AC A3 (unit half) — resolveStatePath is keyed on sessionId, not on any positional argument
	test("A3: resolveStatePath produces a path keyed on sessionId; a different sid maps to a different path", () => {
		const path = resolveStatePath(SID);
		expect(path).toContain(`deep-interview-active-state-${SID}.json`);
		const otherPath = resolveStatePath("other-session");
		expect(otherPath).not.toBe(path);
		// CLI-surface enforcement (stray positional arg is silently dropped) is covered in
		// the "CLI main()" describe block below via execSync.
	});

	// read returns null for absent file
	test("readDeepInterviewState returns null for absent file", () => {
		expect(readDeepInterviewState(SID)).toBeNull();
	});

	// read returns the raw object for a seed-only file (active but no state object yet)
	test("readDeepInterviewState returns seed content as raw object", () => {
		writeSeed();
		const result = readDeepInterviewState(SID);
		expect(result).not.toBeNull();
		expect(result!["active"]).toBe(true);
	});
});

// CLI integration tests — exercise main() via execSync (real binary surface)
describe("deep-interview-state CLI main()", () => {
	const script = join(import.meta.dir, "deep-interview-state.ts");
	const run = (cmd: string, env?: Record<string, string>) =>
		execSync(`bun ${script} ${cmd}`, {
			encoding: "utf8",
			env: { ...process.env, ...env },
		});

	// AC A3 (CLI surface) — stray positional arg must NOT redirect the state file
	test("A3: stray positional arg after subcommand is silently dropped; state lands at canonical sid path only", () => {
		writeSeed();
		// Pass a stray positional: "init EVIL hijack-sid --initial-idea X"
		// parseArgs should take "init" as subcommand, silently drop "EVIL" and "hijack-sid",
		// and write the state keyed on OMT_SESSION_ID (SID = 'T'), not on "hijack-sid".
		run("init EVIL hijack-sid --initial-idea stranded");
		// The canonical file must exist and contain the written idea
		const state = rawState(SID);
		expect((state["state"] as Record<string, unknown>)["initial_idea"]).toBe("stranded");
		// No file was created at paths derived from the stray args
		const files = readdirSync(tmpDir);
		const strayFiles = files.filter((f) => f.includes("EVIL") || f.includes("hijack-sid"));
		expect(strayFiles).toHaveLength(0);
	});

	// CLI init subcommand writes rich shape via the real parseArgs + main() path
	test("init subcommand overlays rich shape into seed file via CLI", () => {
		writeSeed();
		run('init --initial-idea "cli test idea" --type greenfield');
		const state = rawState();
		expect((state["state"] as Record<string, unknown>)["initial_idea"]).toBe("cli test idea");
		expect((state["state"] as Record<string, unknown>)["type"]).toBe("greenfield");
		expect(state["current_phase"]).toBe("deep-interview");
	});

	// CLI update subcommand — current_ambiguity must land under state (SKILL.md:93)
	test("update subcommand writes current_ambiguity under state.current_ambiguity", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "seed idea" });
		run('update --current-phase "round2" --current-ambiguity 0.6');
		const state = rawState();
		expect(state["current_phase"]).toBe("round2");
		// Must be nested under state per SKILL.md shape, not at the file root
		const nested = state["state"] as Record<string, unknown>;
		expect(nested["current_ambiguity"]).toBe(0.6);
		expect(Object.prototype.hasOwnProperty.call(state, "current_ambiguity")).toBe(false);
	});

	// CLI get subcommand prints parseable JSON to stdout
	test("get subcommand prints parseable JSON to stdout", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "get test" });
		const output = run("get");
		const parsed = JSON.parse(output) as Record<string, unknown>;
		expect(parsed).not.toBeNull();
		expect((parsed["state"] as Record<string, unknown>)["initial_idea"]).toBe("get test");
	});

	// CLI absent-file → self-heal (exit 0, file created) — slash-command entry path
	test("init on absent file self-heals via CLI (exit 0, file created)", () => {
		// No seed written — init self-heals by seeding the pristine skeleton first
		expect(() => run('init --initial-idea "x"')).not.toThrow();
		expect(existsSync(resolveStatePath(SID))).toBe(true);
	});

	// CLI absent OMT_SESSION_ID → non-zero exit
	test("CLI exits non-zero when OMT_SESSION_ID is empty", () => {
		expect(() => run('init --initial-idea "x"', { OMT_SESSION_ID: "" })).toThrow();
	});

	// --- new-flags RED tests ---

	// init --codebase-context stores text under state.codebase_context
	test("init --codebase-context persists codebase_context under state", () => {
		writeSeed();
		run("init --initial-idea 'base idea' --codebase-context 'src/ uses Express'");
		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		expect(nested["codebase_context"]).toBe("src/ uses Express");
	});

	// update --append-round appends one round object to state.rounds
	test("update --append-round appends a round object to state.rounds; two calls → two rounds in order", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		run(`update --append-round '{"n":1,"score":0.8}'`);
		run(`update --append-round '{"n":2,"score":0.6}'`);
		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const rounds = nested["rounds"] as unknown[];
		expect(rounds).toHaveLength(2);
		expect((rounds[0] as Record<string, unknown>)["n"]).toBe(1);
		expect((rounds[1] as Record<string, unknown>)["n"]).toBe(2);
	});

	// update --append-ontology-snapshot appends to state.ontology_snapshots
	test("update --append-ontology-snapshot appends to state.ontology_snapshots", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		run(`update --append-ontology-snapshot '{"entities":["User"],"stability_ratio":0.5}'`);
		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const snaps = nested["ontology_snapshots"] as unknown[];
		expect(snaps).toHaveLength(1);
		expect((snaps[0] as Record<string, unknown>)["stability_ratio"]).toBe(0.5);
	});

	// update --challenge-mode appends name; second call with same name is deduped
	test("update --challenge-mode appends to challenge_modes_used; duplicate is deduped", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		run("update --challenge-mode contrarian");
		run("update --challenge-mode simplifier");
		run("update --challenge-mode contrarian"); // duplicate — must dedupe
		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const modes = nested["challenge_modes_used"] as string[];
		expect(modes).toHaveLength(2);
		expect(modes).toContain("contrarian");
		expect(modes).toContain("simplifier");
	});

	// invalid JSON for --append-round → non-zero exit
	test("update --append-round with invalid JSON exits non-zero", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		expect(() => run("update --append-round 'not json'")).toThrow();
	});

	// invalid JSON for --append-ontology-snapshot → non-zero exit
	test("update --append-ontology-snapshot with invalid JSON exits non-zero", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		expect(() => run("update --append-ontology-snapshot '{bad}'")).toThrow();
	});

	// ---------------------------------------------------------------------------
	// stdin channel tests (Finding #7)
	// ---------------------------------------------------------------------------

	const runStdin = (cmd: string, stdinInput: string, env?: Record<string, string>): string =>
		execSync(`bun ${script} ${cmd}`, {
			encoding: "utf8",
			input: stdinInput,
			env: { ...process.env, ...env },
		});

	// stdin --append-round-stdin: round with apostrophe and inner double quotes round-trips verbatim
	test("stdin round-trip: apostrophe and inner double quotes in question/answer survive --append-round-stdin", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		const payload = JSON.stringify({
			n: 1,
			question: "What's the user's role?",
			answer: 'She said "admin" and "editor"',
			scores: { goal: 0.8, constraints: 0.6, criteria: 0.7 },
			ambiguity: 0.3,
		});
		runStdin("update --append-round-stdin", payload);
		const state = rawState();
		const rounds = (state["state"] as Record<string, unknown>)["rounds"] as unknown[];
		expect(rounds).toHaveLength(1);
		const r = rounds[0] as Record<string, unknown>;
		expect(r["question"]).toBe("What's the user's role?");
		expect(r["answer"]).toBe('She said "admin" and "editor"');
	});

	// stdin --append-round-stdin: invalid JSON → exit 1 loudly
	test("stdin --append-round-stdin with invalid JSON exits non-zero", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		expect(() => runStdin("update --append-round-stdin", "not valid json")).toThrow();
	});

	// stdin --append-round-stdin back-compat: argv --append-round still works
	test("argv --append-round still works alongside stdin flag (back-compat)", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		run(
			`update --append-round '{"n":1,"scores":{"goal":0.5,"constraints":0.5,"criteria":0.5},"ambiguity":0.5}'`,
		);
		const state = rawState();
		const rounds = (state["state"] as Record<string, unknown>)["rounds"] as unknown[];
		expect(rounds).toHaveLength(1);
		expect((rounds[0] as Record<string, unknown>)["n"]).toBe(1);
	});

	// stdin --append-ontology-snapshot-stdin: round-trips verbatim
	test("stdin round-trip: --append-ontology-snapshot-stdin persists snapshot verbatim", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		const payload = JSON.stringify({
			entities: [{ name: 'User\'s "account"', type: "entity", fields: [], relationships: [] }],
			stability_ratio: 0.9,
			matching_reasoning: "stable",
		});
		runStdin("update --append-ontology-snapshot-stdin", payload);
		const state = rawState();
		const snaps = (state["state"] as Record<string, unknown>)["ontology_snapshots"] as unknown[];
		expect(snaps).toHaveLength(1);
		const snap = snaps[0] as Record<string, unknown>;
		expect(snap["entities"] as unknown[]).toHaveLength(1);
		expect(((snap["entities"] as unknown[])[0] as Record<string, unknown>)["name"]).toBe(
			'User\'s "account"',
		);
	});

	// stdin --append-ontology-snapshot-stdin: invalid JSON → exit 1
	test("stdin --append-ontology-snapshot-stdin with invalid JSON exits non-zero", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q" });
		expect(() => runStdin("update --append-ontology-snapshot-stdin", "{bad json}")).toThrow();
	});

	// brownfield context score: round with "context" key round-trips verbatim (Finding #6)
	test("brownfield context score: round with context key round-trips verbatim via stdin", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "q", type: "brownfield" });
		const payload = JSON.stringify({
			n: 1,
			question: "Where is the auth layer?",
			answer: "In middleware",
			scores: { goal: 0.7, constraints: 0.6, criteria: 0.6, context: 0.5 },
			ambiguity: 0.42,
		});
		runStdin("update --append-round-stdin", payload);
		const state = rawState();
		const rounds = (state["state"] as Record<string, unknown>)["rounds"] as unknown[];
		expect(rounds).toHaveLength(1);
		const r = rounds[0] as Record<string, unknown>;
		const scores = r["scores"] as Record<string, unknown>;
		expect(scores["context"]).toBe(0.5);
	});

	// ---------------------------------------------------------------------------
	// TODO 7: provenance per-label round-trip (D-H)
	// ---------------------------------------------------------------------------

	// Each of the 4 closed-set labels persists and reads back via the CLI.
	// 4 separate append+get cycles, one per label.

	test("provenance [from-code]: append+get round-trip persists the item", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "prov test" });
		run(`update --append-provenance-item '{"evidence_id":"e1","label":"[from-code]"}'`);
		const out = run("get");
		const parsed = JSON.parse(out) as Record<string, unknown>;
		const prov = (parsed["state"] as Record<string, unknown>)["evidence_provenance"] as unknown[];
		expect(prov).toHaveLength(1);
		expect((prov[0] as Record<string, unknown>)["evidence_id"]).toBe("e1");
		expect((prov[0] as Record<string, unknown>)["label"]).toBe("[from-code]");
	});

	test("provenance [from-code][auto-confirmed]: append+get round-trip persists the item", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "prov test" });
		run(
			`update --append-provenance-item '{"evidence_id":"e2","label":"[from-code][auto-confirmed]"}'`,
		);
		const out = run("get");
		const parsed = JSON.parse(out) as Record<string, unknown>;
		const prov = (parsed["state"] as Record<string, unknown>)["evidence_provenance"] as unknown[];
		expect(prov).toHaveLength(1);
		expect((prov[0] as Record<string, unknown>)["evidence_id"]).toBe("e2");
		expect((prov[0] as Record<string, unknown>)["label"]).toBe("[from-code][auto-confirmed]");
	});

	test("provenance [from-research]: append+get round-trip persists the item", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "prov test" });
		run(`update --append-provenance-item '{"evidence_id":"e3","label":"[from-research]"}'`);
		const out = run("get");
		const parsed = JSON.parse(out) as Record<string, unknown>;
		const prov = (parsed["state"] as Record<string, unknown>)["evidence_provenance"] as unknown[];
		expect(prov).toHaveLength(1);
		expect((prov[0] as Record<string, unknown>)["evidence_id"]).toBe("e3");
		expect((prov[0] as Record<string, unknown>)["label"]).toBe("[from-research]");
	});

	test("provenance [from-user]: append+get round-trip persists the item", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "prov test" });
		run(`update --append-provenance-item '{"evidence_id":"e4","label":"[from-user]"}'`);
		const out = run("get");
		const parsed = JSON.parse(out) as Record<string, unknown>;
		const prov = (parsed["state"] as Record<string, unknown>)["evidence_provenance"] as unknown[];
		expect(prov).toHaveLength(1);
		expect((prov[0] as Record<string, unknown>)["evidence_id"]).toBe("e4");
		expect((prov[0] as Record<string, unknown>)["label"]).toBe("[from-user]");
	});

	// ---------------------------------------------------------------------------
	// TODO 7: ordered stance-history round-trip (D-E)
	// ---------------------------------------------------------------------------

	// stance_history is ordered and NOT deduplicated (unlike challenge_modes_used).
	test("stance-history: appends persist in insertion order; duplicate NOT deduplicated", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "stance test" });
		run("update --append-stance Clarify");
		run("update --append-stance Fact-ground");
		run("update --append-stance Ontologist");
		run("update --append-stance Clarify"); // duplicate — must NOT be deduped
		const out = run("get");
		const parsed = JSON.parse(out) as Record<string, unknown>;
		const history = (parsed["state"] as Record<string, unknown>)["stance_history"] as string[];
		expect(history).toHaveLength(4);
		expect(history[0]).toBe("Clarify");
		expect(history[1]).toBe("Fact-ground");
		expect(history[2]).toBe("Ontologist");
		expect(history[3]).toBe("Clarify"); // preserved, not deduplicated
	});

	// ---------------------------------------------------------------------------
	// TODO 7: Ontologist stance round-trip (D-E)
	// ---------------------------------------------------------------------------
	//
	// SKILL.md is the ONLY owner of stance selection (prose-only; no selection
	// helper exists in deep-interview-state.ts). Selector correctness (stall /
	// late-stage trigger conditions) is guarded by the SKILL.md token-contract
	// grep (TODO 5 AC), NOT by this state-layer test.
	//
	// This test guards only the state layer: a stance_history recording an
	// Ontologist stance (as the rotation would write via --append-stance)
	// round-trips correctly — the recorded value is defined and non-empty.

	test("stance-history: Ontologist stance round-trips defined and non-empty", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "Ontologist round-trip test" });
		run("update --append-stance Ontologist");
		const out = run("get");
		const parsed = JSON.parse(out) as Record<string, unknown>;
		const history = (parsed["state"] as Record<string, unknown>)["stance_history"] as string[];
		expect(history.length).toBeGreaterThan(0);
		const recorded = history[history.length - 1];
		expect(recorded).toBe("Ontologist");
	});

	// ---------------------------------------------------------------------------
	// topology-floor-evolution Stage 1: topology + per-component clarity_scores
	// (UC1, UC8 — see /Users/toong/.omt/oh-my-toong-playground/deep-interview/topology-floor-evolution.md)
	// ---------------------------------------------------------------------------

	const CLARITY_DIMENSIONS = ["intent", "outcome", "scope", "constraints", "success", "context"];

	// UC1 — Round 0 다중 컴포넌트 열거(greenfield): a 4-component idea locks 4 active
	// components into state.topology.components, each with all 6 clarity_scores null.
	test("UC1: set-topology locks 4 active components, each with 6 null clarity_scores", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "CSV 수집 → 정규화 → 리뷰 UI → 내보내기" });
		const components = [
			{ id: "c1", name: "CSV 수집" },
			{ id: "c2", name: "정규화" },
			{ id: "c3", name: "리뷰 UI" },
			{ id: "c4", name: "내보내기" },
		];
		run(`set-topology --json '${JSON.stringify(components)}'`);
		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const topology = nested["topology"] as Record<string, unknown>;
		const locked = topology["components"] as Record<string, unknown>[];
		expect(locked).toHaveLength(4);
		for (const comp of locked) {
			expect(comp["status"]).toBe("active");
			const scores = comp["clarity_scores"] as Record<string, unknown>;
			for (const dim of CLARITY_DIMENSIONS) {
				expect(scores[dim]).toBeNull();
			}
		}
	});

	// UC8 — 단일 컴포넌트 pass-through: a 1-component idea locks topology.components[0]
	// as the lone active component, with the same 6-null clarity_scores shape.
	test("UC8: set-topology with a single-component idea locks topology.components[0] as the lone active component", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "standalone script" });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "standalone script" }])}'`);
		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const topology = nested["topology"] as Record<string, unknown>;
		const locked = topology["components"] as Record<string, unknown>[];
		expect(locked).toHaveLength(1);
		const only = locked[0] as Record<string, unknown>;
		expect(only["status"]).toBe("active");
		const scores = only["clarity_scores"] as Record<string, unknown>;
		for (const dim of CLARITY_DIMENSIONS) {
			expect(scores[dim]).toBeNull();
		}
	});

	// ---------------------------------------------------------------------------
	// topology-floor-evolution Stage 2: computeAmbiguityFloor + write clamp
	// (UC2, UC3, UC7 — see /Users/toong/.omt/oh-my-toong-playground/deep-interview/topology-floor-evolution.md)
	// ---------------------------------------------------------------------------

	/** A fully-scored ClarityScores fixture — all 6 dimensions non-null. */
	function scoredDims(overrides: Partial<ClarityScores> = {}): ClarityScores {
		return {
			intent: 0.9,
			outcome: 0.9,
			scope: 0.9,
			constraints: 0.9,
			success: 0.9,
			context: 0.9,
			...overrides,
		};
	}

	// UC3 — floor clamp (anchor numbers): LLM reports ambiguity 0.04 while 1 active
	// component is still unscored → floor = 0.05·1 = 0.05 → effective = max(0.04, 0.05)
	// = 0.05 is what gets persisted as current_ambiguity, and the raw 0.04 the LLM
	// reported is preserved separately under reported_ambiguity (not overwritten).
	test("UC3: reported ambiguity 0.04 with 1 unscored component clamps to floor 0.05; reported_ambiguity preserved", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "single-slice idea" });
		// One active component, never scored (set-topology always seeds null scores).
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "only component" }])}'`);

		run("update --current-ambiguity 0.04");

		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		expect(nested["current_ambiguity"]).toBe(0.05);
		expect(nested["reported_ambiguity"]).toBe(0.04);
		expect(nested["ambiguity_floor"]).toBe(0.05);
	});

	// UC2 — sibling component cannot hide an unscored one: Review UI is fully scored
	// on all 6 dimensions, but Export has zero dimensions scored. Floor pressure
	// (0.05 for the one unscored component) survives regardless of Review UI's
	// completeness, and the fixture's threshold (0.03) sits below that floor —
	// so the clamped effective ambiguity can never read as "under threshold" no
	// matter how low the LLM's reported value is.
	test("UC2: Export left unscored keeps floor active even though Review UI is fully scored — effective ambiguity cannot drop below threshold", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "review + export idea", threshold: 0.03 });
		run(
			`set-topology --json '${JSON.stringify([
				{ id: "review-ui", name: "Review UI" },
				{ id: "export", name: "Export" },
			])}'`,
		);
		// Simulate a completed per-component scoring write for Review UI only (that
		// write path is a later story — patch the raw file directly here to set up
		// the fixture). Export is left at set-topology's all-null default.
		const path = resolveStatePath(SID);
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const nestedRaw = raw["state"] as Record<string, unknown>;
		const topology = nestedRaw["topology"] as Record<string, unknown>;
		const components = topology["components"] as Record<string, unknown>[];
		components[0]["clarity_scores"] = scoredDims();
		writeFileSync(path, JSON.stringify(raw, null, 2), "utf8");

		// LLM reports an ambiguity well under the threshold — this must NOT survive as-is.
		run("update --current-ambiguity 0.01");

		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const threshold = nested["threshold"] as number;
		const effective = nested["current_ambiguity"] as number;
		expect(effective).toBe(0.05); // one unscored component (Export) → floor 0.05
		expect(effective).toBeGreaterThan(threshold);
		expect(nested["reported_ambiguity"]).toBe(0.01);
	});

	// UC7 — context is not a special dimension, just one of the 6: a component with
	// every dimension scored EXCEPT context is still unscored and contributes floor
	// pressure; once context is scored alongside the other 5, the same component no
	// longer contributes and the floor drops to 0.
	test("UC7: a null context dimension keeps a component unscored (blocks); scoring context removes the block", () => {
		const blocked: DeepInterviewStateContent = {
			topology: {
				components: [
					{
						id: "c1",
						name: "greenfield component",
						status: "active",
						clarity_scores: scoredDims({ context: null }),
					},
				],
			},
		};
		expect(computeAmbiguityFloor(blocked)).toBe(0.05);

		const unblocked: DeepInterviewStateContent = {
			topology: {
				components: [
					{
						id: "c1",
						name: "greenfield component",
						status: "active",
						clarity_scores: scoredDims({ context: 0.9 }),
					},
				],
			},
		};
		expect(computeAmbiguityFloor(unblocked)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Adoption surface tests (TODO 8)
// ---------------------------------------------------------------------------

const diScript = join(import.meta.dir, "deep-interview-state.ts");
function runDi(cmd: string, env?: Record<string, string>): string {
	return execSync(`bun ${diScript} ${cmd}`, {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

/** Returns a current-time ISO-8601 string with timezone offset. */
function nowIsoDi(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const tzOffset = -d.getTimezoneOffset();
	const tzSign = tzOffset >= 0 ? "+" : "-";
	const tzH = pad(Math.floor(Math.abs(tzOffset) / 60));
	const tzM = pad(Math.abs(tzOffset) % 60);
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`${tzSign}${tzH}:${tzM}`
	);
}

/** Write a live (non-pristine) deep-interview state for the given sid. */
function writeLiveDiState(sid: string, initialIdea: string): void {
	const path = `${tmpDir}/deep-interview-active-state-${sid}.json`;
	const now = nowIsoDi();
	writeFileSync(
		path,
		JSON.stringify({
			active: true,
			current_phase: "deep-interview",
			started_at: now,
			last_touched_at: now,
			state: {
				interview_id: "uuid-" + sid,
				type: "greenfield",
				initial_idea: initialIdea,
				initial_context_summary: null,
				rounds: [],
				current_ambiguity: 0.5,
				threshold: 0.2,
				codebase_context: null,
				challenge_modes_used: [],
				ontology_snapshots: [],
			},
		}),
		"utf8",
	);
}

/** Write a pristine (seed-only) deep-interview state for the given sid. */
function writePristineDiState(sid: string): void {
	writeSeed(sid);
}

describe("adoption: list-others + adopt (deep-interview CLI)", () => {
	// (F2-di) list-others surfaces ACTIVE-live candidate; purpose = state.initial_idea
	test("F2-di: list-others shows A with initial_idea as purpose, excludes self B", () => {
		writeLiveDiState("diA", "build DI feature");
		writePristineDiState("diB");
		const out = runDi("list-others", { OMT_SESSION_ID: "diB" });
		expect(out).toContain("diA");
		expect(out).toContain("build DI feature");
		// Self must not appear
		const lines = out.trim().split("\n").filter(Boolean);
		expect(lines.some((l) => l.includes("diB"))).toBe(false);
	});

	// (label) candidate line has all 4 fields
	test("label: list-others DI candidate line has sid + purpose + started_at + idle-seconds", () => {
		writeLiveDiState("diLabel", "my DI idea");
		const out = runDi("list-others", { OMT_SESSION_ID: "diOther" });
		expect(out).toContain("diLabel");
		expect(out).toContain("my DI idea");
		expect(out).toMatch(/\d{4}-\d{2}-\d{2}/);
		expect(out).toMatch(/\d+s/);
	});

	// (F3-cli) adopt re-keys via DI CLI
	test("F3-cli: DI adopt --src A moves A to B; A absent, B holds initial_idea", () => {
		writeLiveDiState("diSrcA", "adopt DI idea");
		writePristineDiState("diDstB");
		runDi("adopt --src diSrcA", { OMT_SESSION_ID: "diDstB" });
		expect(existsSync(resolveStatePath("diSrcA"))).toBe(false);
		const b = JSON.parse(readFileSync(resolveStatePath("diDstB"), "utf8")) as Record<
			string,
			unknown
		>;
		const st = b["state"] as Record<string, unknown>;
		expect(st["initial_idea"]).toBe("adopt DI idea");
		const log = readFileSync(`${tmpDir}/adoption.log`, "utf8");
		expect(log).toContain("deep-interview");
		expect(log).toContain("diSrcA -> diDstB");
	});

	// (F6-cli) adopt refused on ACTIVE non-pristine current
	test("F6-cli: DI adopt refused when current is ACTIVE non-pristine", () => {
		writeLiveDiState("diSrc2", "source idea");
		writeLiveDiState("diDst2", "current work"); // non-pristine (has state object)
		const srcContent = readFileSync(resolveStatePath("diSrc2"), "utf8");
		const dstContent = readFileSync(resolveStatePath("diDst2"), "utf8");
		expect(() => runDi("adopt --src diSrc2", { OMT_SESSION_ID: "diDst2" })).toThrow();
		expect(readFileSync(resolveStatePath("diSrc2"), "utf8")).toBe(srcContent);
		expect(readFileSync(resolveStatePath("diDst2"), "utf8")).toBe(dstContent);
	});

	// (dormancy-di) adopted-away source cannot write via update
	test("dormancy-di: after adoption, session A update is refused (no-create)", () => {
		writeLiveDiState("diAdoptA", "idea to adopt");
		writePristineDiState("diAdoptB");
		runDi("adopt --src diAdoptA", { OMT_SESSION_ID: "diAdoptB" });
		expect(existsSync(resolveStatePath("diAdoptA"))).toBe(false);
		// Session A tries to write — must fail non-zero
		expect(() => runDi("update --current-phase phase2", { OMT_SESSION_ID: "diAdoptA" })).toThrow();
		expect(existsSync(resolveStatePath("diAdoptA"))).toBe(false);
	});
});
