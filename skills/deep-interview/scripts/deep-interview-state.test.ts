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
	computeTopologyMigrationStatus,
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

	// topology-floor-evolution Stage 6 (UC11 consumption): `get` derives migration_status via
	// computeTopologyMigrationStatus so the resume path (get/adopt) can enforce Round 0 on a
	// pre-topology state. A state that never called set-topology reads as legacy_missing.
	test("get subcommand output includes migration_status: legacy_missing for topology-absent state", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "no topology yet" });
		const output = run("get");
		const parsed = JSON.parse(output) as Record<string, unknown>;
		expect(parsed["migration_status"]).toBe("legacy_missing");
	});

	// A state that has locked topology (even a single component) reads as current.
	test("get subcommand output includes migration_status: current once topology is locked", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "with topology" });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "only component" }])}'`);
		const output = run("get");
		const parsed = JSON.parse(output) as Record<string, unknown>;
		expect(parsed["migration_status"]).toBe("current");
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
	// (UC1, UC8 — see topology-floor-evolution.md)
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
	// (UC2, UC3, UC7 — see topology-floor-evolution.md)
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

	// ---------------------------------------------------------------------------
	// topology-floor-evolution Stage 2 writer: append_round → clarity_scores
	// propagation (UC-C1, UC-C2, UC-C3) — the writer wiring that fills what
	// setTopology always seeds null, so computeAmbiguityFloor's
	// unscored_component_count can actually drop at runtime.
	// ---------------------------------------------------------------------------

	// UC-C1 — scoring both active components via append-round (component + scores)
	// fills clarity_scores for each, and the floor's unscored contribution drops to 0:
	// a reported ambiguity of 0.04 with both components scored survives unclamped.
	test("UC-C1: append-round with component+scores propagates into topology.components[].clarity_scores; floor drops to 0 once every active component is scored", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "two-component idea" });
		run(
			`set-topology --json '${JSON.stringify([
				{ id: "c1", name: "Component 1" },
				{ id: "c2", name: "Component 2" },
			])}'`,
		);

		runStdin(
			"update --append-round-stdin",
			JSON.stringify({
				n: 1,
				component: "c1",
				question: "q1",
				answer: "a1",
				scores: scoredDims(),
				ambiguity: 0.1,
			}),
		);
		runStdin(
			"update --append-round-stdin",
			JSON.stringify({
				n: 2,
				component: "c2",
				question: "q2",
				answer: "a2",
				scores: scoredDims(),
				ambiguity: 0.1,
			}),
		);

		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const topology = nested["topology"] as Record<string, unknown>;
		const components = topology["components"] as Record<string, unknown>[];
		for (const comp of components) {
			const scores = comp["clarity_scores"] as Record<string, unknown>;
			for (const dim of CLARITY_DIMENSIONS) {
				expect(scores[dim]).not.toBeNull();
			}
		}

		// Both active components are now scored — the floor's unscored term is 0, so
		// a reported ambiguity of 0.04 is NOT clamped up.
		run("update --current-ambiguity 0.04");
		const state2 = rawState();
		const nested2 = state2["state"] as Record<string, unknown>;
		expect(nested2["ambiguity_floor"]).toBe(0);
		expect(nested2["current_ambiguity"]).toBe(0.04);
	});

	// UC-C2 — a sibling component cannot hide via propagation either: scoring c1 only
	// leaves c2's clarity_scores untouched (still all-null from set-topology), and the
	// floor keeps counting c2 as unscored.
	test("UC-C2: scoring only c1 via append-round leaves c2's clarity_scores null; floor still counts c2 as unscored", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "two-component idea" });
		run(
			`set-topology --json '${JSON.stringify([
				{ id: "c1", name: "Component 1" },
				{ id: "c2", name: "Component 2" },
			])}'`,
		);

		runStdin(
			"update --append-round-stdin",
			JSON.stringify({
				n: 1,
				component: "c1",
				question: "q1",
				answer: "a1",
				scores: scoredDims(),
				ambiguity: 0.1,
			}),
		);

		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const topology = nested["topology"] as Record<string, unknown>;
		const components = topology["components"] as Record<string, unknown>[];
		const c1 = components.find((c) => c["id"] === "c1")!;
		const c2 = components.find((c) => c["id"] === "c2")!;
		const c1Scores = c1["clarity_scores"] as Record<string, unknown>;
		const c2Scores = c2["clarity_scores"] as Record<string, unknown>;
		for (const dim of CLARITY_DIMENSIONS) {
			expect(c1Scores[dim]).not.toBeNull();
			expect(c2Scores[dim]).toBeNull();
		}

		run("update --current-ambiguity 0.01");
		const state2 = rawState();
		const nested2 = state2["state"] as Record<string, unknown>;
		expect(nested2["ambiguity_floor"]).toBe(0.05); // c2 still unscored
	});

	// UC-C3 — a round with neither component nor scores is a pure rounds-push: no
	// component's clarity_scores changes.
	test("UC-C3: append-round without component/scores leaves every component's clarity_scores unchanged", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "single-component idea" });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "Component 1" }])}'`);

		run(`update --append-round '{"n":1,"question":"q","answer":"a"}'`);

		const state = rawState();
		const nested = state["state"] as Record<string, unknown>;
		const topology = nested["topology"] as Record<string, unknown>;
		const components = topology["components"] as Record<string, unknown>[];
		const scores = components[0]["clarity_scores"] as Record<string, unknown>;
		for (const dim of CLARITY_DIMENSIONS) {
			expect(scores[dim]).toBeNull();
		}
	});

	// ---------------------------------------------------------------------------
	// topology-floor-evolution Stage 3: established_facts disputed lifecycle +
	// validateScoredTransition (UC4, UC5 — see
	// topology-floor-evolution.md)
	// ---------------------------------------------------------------------------

	// UC4 — 번복 시 양방향 상승: a user reversing an earlier answer (A→B) marks the
	// backing established_fact disputed via the CLI --dispute-fact path. The very next
	// ambiguity write — reporting the SAME value as before, i.e. no scorer re-call —
	// clamps up by exactly +0.10 purely because computeAmbiguityFloor's disputed_count
	// term is now active. A disputed fact that has since been superseded must NOT
	// contribute (disputed_count excludes superseded facts).
	test("UC4: disputing an established fact raises the floor +0.10 on the next ambiguity write, without any scorer re-call", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "reversal idea" });
		run(`update --establish-fact '{"id":"f1","statement":"uses PostgreSQL"}'`);

		// Baseline write, no dispute yet: floor is 0 (no topology, no disputed facts).
		run("update --current-ambiguity 0.05");
		let state = rawState();
		let nested = state["state"] as Record<string, unknown>;
		expect(nested["current_ambiguity"]).toBe(0.05);
		expect(nested["ambiguity_floor"]).toBe(0);

		// User reverses the earlier answer — mark f1 disputed via the CLI dispute path.
		run("update --dispute-fact f1");
		state = rawState();
		nested = state["state"] as Record<string, unknown>;
		const facts = nested["established_facts"] as Record<string, unknown>[];
		expect(facts).toHaveLength(1);
		expect(facts[0]["disputed"]).toBe(true);

		// Same reported ambiguity as before (no re-scoring happened) — yet the floor now
		// carries the disputed term, clamping the effective value up by exactly +0.10.
		run("update --current-ambiguity 0.05");
		state = rawState();
		nested = state["state"] as Record<string, unknown>;
		expect(nested["reported_ambiguity"]).toBe(0.05);
		expect(nested["ambiguity_floor"]).toBe(0.1);
		expect(nested["current_ambiguity"]).toBe(0.1);

		// disputed_count excludes a disputed fact once it has been superseded.
		const resolved: DeepInterviewStateContent = {
			established_facts: [
				{ id: "f1", statement: "uses PostgreSQL", disputed: true, superseded_by: "f2" },
			],
		};
		expect(computeAmbiguityFloor(resolved)).toBe(0);
	});

	// UC5 — validateScoredTransition fail-closed: an unresolved disputed established_fact
	// (active trigger) blocks a write that simultaneously claims a clarity-dimension
	// improvement (a component already fully scored) and an ambiguity decrease. The CLI
	// must reject with a non-zero exit and leave the state file byte-identical.
	// The name states what this actually asserts: the scores land in an EARLIER call, and the
	// pure ambiguity drop that follows is still refused. The scoring condition is the
	// interview's standing state, not a property of the refused write — narrowing it to an
	// in-write transition would let the same two steps through by sending them separately.
	test("UC5: an active unresolved disputed fact rejects a later ambiguity drop once the interview carries clarity scoring, even though that write applies no score; state file unchanged", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "fail-closed idea" });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "only component" }])}'`);

		// Simulate a completed per-component scoring write (the per-component scoring CLI
		// lands in a later story — patch the raw file directly, same fixture idiom as UC2).
		const path = resolveStatePath(SID);
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const nestedRaw = raw["state"] as Record<string, unknown>;
		const topology = nestedRaw["topology"] as Record<string, unknown>;
		const components = topology["components"] as Record<string, unknown>[];
		components[0]["clarity_scores"] = scoredDims();
		writeFileSync(path, JSON.stringify(raw, null, 2), "utf8");

		// Baseline ambiguity, set BEFORE any dispute exists — succeeds normally.
		run("update --current-ambiguity 0.5");

		// A user reversal establishes the active trigger.
		run(`update --establish-fact '{"id":"f1","statement":"uses REST"}'`);
		run("update --dispute-fact f1");

		const before = readFileSync(path, "utf8");

		// Attempt to converge further (ambiguity drop) while the dispute is unresolved and
		// the component's clarity dimensions are already scored (improvement claim) — must
		// be refused.
		expect(() => run("update --current-ambiguity 0.1")).toThrow();

		// State file is byte-identical — the refused write never reached mergeWrite.
		const after = readFileSync(path, "utf8");
		expect(after).toBe(before);
	});

	// UC6 — the disputed → superseded transition itself. UC4 above asserts that
	// computeAmbiguityFloor excludes a superseded fact, but it builds that state as an
	// object literal: no CLI path ever produced it, so the transition went untested AND
	// unimplemented, leaving validateScoredTransition's own remediation advice
	// ("supersede the disputed fact") pointing at a capability that did not exist.
	// Establishing the replacement WITH `supersedes` is the resolution event — it marks
	// the disputed predecessor superseded, releasing floor pressure and unblocking the
	// very convergence write UC5 proves is refused while the dispute is unresolved.
	test("UC6: establishing a replacement with supersedes marks the predecessor superseded, releasing floor pressure and unblocking convergence", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "supersede idea" });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "only component" }])}'`);
		// Score the component through the runtime append-round path (not a raw patch), so
		// hasScoredClarityDimension reflects a real scoring write.
		run(
			`update --append-round '${JSON.stringify({ n: 1, component: "c1", scores: scoredDims() })}'`,
		);

		run("update --current-ambiguity 0.5");
		run(`update --establish-fact '{"id":"f1","statement":"uses REST"}'`);
		run("update --dispute-fact f1");

		// While the dispute is unresolved, convergence stays refused (UC5's invariant).
		expect(() => run("update --current-ambiguity 0.1")).toThrow();

		// The resolution event: the replacement fact declares what it supersedes.
		run(`update --establish-fact '{"id":"f2","statement":"uses GraphQL","supersedes":"f1"}'`);
		const facts = (rawState()["state"] as Record<string, unknown>)[
			"established_facts"
		] as Record<string, unknown>[];
		expect(facts.find((f) => f["id"] === "f1")?.["superseded_by"]).toBe("f2");

		// Floor pressure released — the identical convergence write now succeeds.
		run("update --current-ambiguity 0.1");
		const nested = rawState()["state"] as Record<string, unknown>;
		expect(nested["ambiguity_floor"]).toBe(0);
		expect(nested["current_ambiguity"]).toBe(0.1);
	});

	// UC7 — a `supersedes` that does not name an unresolved disputed fact must be a LOUD
	// refusal, never a silent no-op. Silently ignoring it is exactly how the missing
	// transition stayed invisible: the floor would stay pressured while the caller
	// believed it had been released.
	test("UC7: supersedes referencing an unknown or undisputed fact is refused; state file unchanged", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "supersede guard idea" });
		run(`update --establish-fact '{"id":"f1","statement":"active fact"}'`);
		const path = resolveStatePath(SID);
		const before = readFileSync(path, "utf8");

		// Unknown id.
		expect(() =>
			run(`update --establish-fact '{"id":"fx","statement":"x","supersedes":"nope"}'`),
		).toThrow();
		// Exists but is NOT disputed — superseding an active fact releases no pressure, so
		// accepting it would hand back a false "resolved" signal.
		expect(() =>
			run(`update --establish-fact '{"id":"fy","statement":"y","supersedes":"f1"}'`),
		).toThrow();

		expect(readFileSync(path, "utf8")).toBe(before);
	});

	// UC8 — the transition gate must judge the state the write PRODUCES, not the one it
	// started from. Scoring a component and dropping ambiguity in a single `update` is
	// exactly the move UC5 refuses; batching the two flags into one invocation must not
	// buy an exemption. Whether the caller sends one call or two is a caller convenience,
	// never a semantic difference.
	test("UC8: a combined --append-round + --current-ambiguity write is refused on the same terms as two separate writes", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "combined write idea" });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "only component" }])}'`);
		run("update --current-ambiguity 0.5");
		run(`update --establish-fact '{"id":"f1","statement":"uses REST"}'`);
		run("update --dispute-fact f1");

		const path = resolveStatePath(SID);
		const before = readFileSync(path, "utf8");

		// One invocation carrying BOTH the six scores and the ambiguity drop.
		expect(() =>
			run(
				`update --append-round '${JSON.stringify({ n: 1, component: "c1", scores: scoredDims() })}' --current-ambiguity 0`,
			),
		).toThrow();

		expect(readFileSync(path, "utf8")).toBe(before);
	});

	// UC9 — a clarity score is contractually in [0,1]. Any finite number used to pass,
	// so a scorer emitting 2 or -1 marked the component "scored" and satisfied the
	// Stop-hook's Closure Guard completeness check, which only asks whether a dimension
	// is null. Out-of-range values are not applied, so the dimension stays null and the
	// guard keeps blocking — same skip semantics the sibling non-numeric check already
	// uses, rather than a second, louder failure mode for the same class of bad input.
	test("UC9: out-of-range clarity scores are not applied; the dimension stays unscored", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "score range idea" });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "only component" }])}'`);

		run(
			`update --append-round '${JSON.stringify({
				n: 1,
				component: "c1",
				scores: { intent: 2, outcome: -1, scope: 1, constraints: 0, success: 0.5, context: 1.5 },
			})}'`,
		);

		const components = (
			(rawState()["state"] as Record<string, unknown>)["topology"] as Record<string, unknown>
		)["components"] as Record<string, unknown>[];
		const scores = components[0]["clarity_scores"] as Record<string, unknown>;

		// Out of range → never applied.
		expect(scores["intent"]).toBeNull();
		expect(scores["outcome"]).toBeNull();
		expect(scores["context"]).toBeNull();
		// In range, including both closed endpoints → applied.
		expect(scores["scope"]).toBe(1);
		expect(scores["constraints"]).toBe(0);
		expect(scores["success"]).toBe(0.5);
	});

	// UC10 — `init` is a merge, not a reset: every field it names is carried forward from
	// priorState, which is what makes re-invoking it on a live interview safe. It named
	// those fields as a fixed list, so a field added later is silently dropped instead —
	// and the fields this story added are exactly the ones carrying convergence pressure.
	// Re-running init then launders an unresolved dispute out of the state and unblocks
	// the very convergence write UC5/UC8 refuse.
	test("UC10: re-running init preserves established_facts and the ambiguity audit fields", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "relaunder idea", threshold: 0.15 });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "only component" }])}'`);
		run("update --current-ambiguity 0.5");
		run(`update --establish-fact '{"id":"f1","statement":"uses REST"}'`);
		run("update --dispute-fact f1");

		run(`init --initial-idea 'relaunder idea'`);

		const state = rawState()["state"] as Record<string, unknown>;
		const facts = state["established_facts"] as Record<string, unknown>[] | undefined;
		expect(facts).toHaveLength(1);
		expect(facts?.[0]?.["disputed"]).toBe(true);
		// The clamp's audit trail survives too — losing it makes the stored ambiguity
		// unauditable, since reported vs floor is no longer recoverable.
		expect(state["reported_ambiguity"]).toBe(0.5);
		expect(state["ambiguity_floor"]).toBe(0.05);

		// The laundering payoff must stay closed: the dispute still blocks convergence.
		run(`update --append-round '${JSON.stringify({ n: 1, component: "c1", scores: scoredDims() })}'`);
		expect(() => run("update --current-ambiguity 0")).toThrow();
	});

	// UC11 — `--threshold` is the other operand of the Stop-hook's convergence comparison,
	// but it was parsed with a bare Number(), unlike --current-ambiguity's raw-string
	// decimal guard right beside it. Number("abc") is NaN, which JSON.stringify writes as
	// `null`; the hook then compares against null-coerced-to-0 and blocks every done token
	// forever. Refuse at the CLI boundary so a non-finite threshold never reaches disk.
	test("UC11: init refuses a non-decimal --threshold instead of persisting NaN as null", () => {
		writeSeed();
		expect(() => run(`init --initial-idea 'x' --threshold abc`)).toThrow();
		expect(() => run(`init --initial-idea 'x' --threshold ''`)).toThrow();
		expect(() => run(`init --initial-idea 'x' --threshold NaN`)).toThrow();

		// A valid threshold still lands.
		run(`init --initial-idea 'x' --threshold 0.15`);
		expect((rawState()["state"] as Record<string, unknown>)["threshold"]).toBe(0.15);
	});

	// UC13 — the counterweight that makes UC5's strictness safe rather than a wedge. UC5
	// pins what the guard refuses; nothing pinned what it must still ALLOW, so a future
	// "simplification" to "refuse every write while disputed" would pass the whole suite
	// while stranding the interview with no way to record an honest ambiguity rise. The
	// guard is directional by design — SKILL.md tells the interviewer ambiguity may come
	// back HIGHER after a reversal, which is only usable if raising it is permitted.
	test("UC13: while a dispute is unresolved, raising or holding ambiguity stays allowed; only lowering is refused", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "directional guard idea" });
		run(`set-topology --json '${JSON.stringify([{ id: "c1", name: "only component" }])}'`);
		run(`update --append-round '${JSON.stringify({ n: 1, component: "c1", scores: scoredDims() })}'`);
		run("update --current-ambiguity 0.5");
		run(`update --establish-fact '{"id":"f1","statement":"uses REST"}'`);
		run("update --dispute-fact f1");

		const read = () =>
			(rawState()["state"] as Record<string, unknown>)["current_ambiguity"] as number;

		// Raising: the reversal genuinely made the interview less certain.
		run("update --current-ambiguity 0.6");
		expect(read()).toBe(0.6);
		// Holding: a round that settles nothing either way.
		run("update --current-ambiguity 0.6");
		expect(read()).toBe(0.6);
		// Lowering: the one direction the open dispute forbids.
		expect(() => run("update --current-ambiguity 0.5")).toThrow();
		expect(read()).toBe(0.6);

		// Superseding the dispute releases the block — the documented way out.
		run(`update --establish-fact '{"id":"f2","statement":"uses gRPC","supersedes":"f1"}'`);
		run("update --current-ambiguity 0.5");
		expect(read()).toBe(0.5);
	});

	// UC12 — threshold is the OTHER operand of `current_ambiguity > threshold`, so it lives
	// on the same 0–1 scale and needs the same closed-range guard current_ambiguity already
	// has. Syntactically valid but off-scale values disable the comparison in both
	// directions: above 1, no ambiguity can ever exceed it, so a done token always passes
	// and the convergence gate is off; below 0, even a fully converged 0 exceeds it, so the
	// interview can never finish. Decimal syntax alone does not make a threshold meaningful.
	test("UC12: init refuses an off-scale --threshold; both closed endpoints stay legal", () => {
		writeSeed();
		expect(() => run(`init --initial-idea 'x' --threshold 2`)).toThrow();
		expect(() => run(`init --initial-idea 'x' --threshold -1`)).toThrow();
		expect(() => run(`init --initial-idea 'x' --threshold 1.5`)).toThrow();
		expect(() => run(`init --initial-idea 'x' --threshold -0.5`)).toThrow();

		run(`init --initial-idea 'x' --threshold 0`);
		expect((rawState()["state"] as Record<string, unknown>)["threshold"]).toBe(0);
		run(`init --initial-idea 'x' --threshold 1`);
		expect((rawState()["state"] as Record<string, unknown>)["threshold"]).toBe(1);
	});

	// ---------------------------------------------------------------------------
	// non-finite --current-ambiguity guard: `Number(reported)` on a non-numeric or
	// non-finite CLI value silently produces NaN, which `JSON.stringify` then
	// serializes as `null` — a null current_ambiguity fail-opens past the Stop-hook's
	// `ambiguity > threshold` cross-check (hooks/persistent-mode/decision.ts). The CLI
	// must refuse before any write reaches the state file.
	// ---------------------------------------------------------------------------

	test("update --current-ambiguity abc (non-numeric string): CLI exits non-zero; current_ambiguity stays at its prior value (never null)", () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "guard idea" });
		run("update --current-ambiguity 0.3");

		const path = resolveStatePath(SID);
		const before = readFileSync(path, "utf8");

		expect(() => run("update --current-ambiguity abc")).toThrow();

		const after = readFileSync(path, "utf8");
		expect(after).toBe(before);
		const nested = (JSON.parse(after) as Record<string, unknown>)["state"] as Record<
			string,
			unknown
		>;
		expect(nested["current_ambiguity"]).not.toBeNull();
		expect(nested["current_ambiguity"]).toBe(0.3);
	});

	test.each([["Infinity"], ["-Infinity"], ["NaN"]])(
		"update --current-ambiguity %s (non-finite): CLI exits non-zero; state file byte-unchanged",
		(value) => {
			writeSeed();
			initDeepInterviewState(SID, { initial_idea: "guard idea" });
			run("update --current-ambiguity 0.3");

			const path = resolveStatePath(SID);
			const before = readFileSync(path, "utf8");

			expect(() => run(`update --current-ambiguity ${value}`)).toThrow();

			const after = readFileSync(path, "utf8");
			expect(after).toBe(before);
		},
	);

	// ---------------------------------------------------------------------------
	// fail-open closure: `Number("")` and `Number("   ")` both coerce to the finite
	// value `0`, which passes the `Number.isFinite` guard above and gets accepted as
	// a legitimate ambiguity=0 write — fail-opening the Stop-hook's
	// `ambiguity > threshold` cross-check via a *finite* value the isFinite guard
	// cannot distinguish from a genuine "0". The CLI must refuse at the raw-string
	// layer, before Number() ever runs on the value.
	// ---------------------------------------------------------------------------

	test('update --current-ambiguity "" (empty string): CLI exits non-zero; current_ambiguity stays at its prior value (never coerced to 0)', () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "guard idea" });
		run("update --current-ambiguity 0.3");

		const path = resolveStatePath(SID);
		const before = readFileSync(path, "utf8");

		expect(() => run('update --current-ambiguity ""')).toThrow();

		const after = readFileSync(path, "utf8");
		expect(after).toBe(before);
		const nested = (JSON.parse(after) as Record<string, unknown>)["state"] as Record<
			string,
			unknown
		>;
		expect(nested["current_ambiguity"]).toBe(0.3);
	});

	test('update --current-ambiguity "   " (whitespace-only): CLI exits non-zero; state file byte-unchanged', () => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "guard idea" });
		run("update --current-ambiguity 0.3");

		const path = resolveStatePath(SID);
		const before = readFileSync(path, "utf8");

		expect(() => run('update --current-ambiguity "   "')).toThrow();

		const after = readFileSync(path, "utf8");
		expect(after).toBe(before);
	});

	// Closed [0,1] range guard. The scoring contract defines ambiguity on a 0.0–1.0
	// scale, but Number.isFinite alone admits any finite value. The two ends fail in
	// OPPOSITE directions, which is why neither is caught by the other's guard:
	//   below 0 — Math.max(reported, floor) clamps it away, so current_ambiguity never
	//             goes negative; the out-of-contract figure still lands verbatim in
	//             reported_ambiguity, the field the audit trail is read from.
	//   above 1 — nothing clamps downward, so the value persists into current_ambiguity
	//             and pins the Stop-hook's `ambiguity > threshold` cross-check
	//             permanently true, blocking every done token until a valid write lands.
	// Refuse both ends at the boundary rather than persisting an undefined value.
	test.each([["-1"], ["-0.5"], ["5"], ["1.5"]])(
		"update --current-ambiguity %s (outside closed 0-1 range): CLI exits non-zero; state file byte-unchanged",
		(value) => {
			writeSeed();
			initDeepInterviewState(SID, { initial_idea: "range guard idea" });
			run("update --current-ambiguity 0.3");

			const path = resolveStatePath(SID);
			const before = readFileSync(path, "utf8");

			expect(() => run(`update --current-ambiguity ${value}`)).toThrow();

			expect(readFileSync(path, "utf8")).toBe(before);
		},
	);

	// The range is CLOSED — both endpoints are legal. 1.0 is the seeded starting
	// ambiguity and 0 is a legitimate fully-converged claim, so an off-by-one guard
	// that rejected either endpoint would break the normal interview lifecycle.
	test.each([
		["0", 0],
		["1", 1],
	])("update --current-ambiguity %s (closed-range endpoint) is accepted", (value, expected) => {
		writeSeed();
		initDeepInterviewState(SID, { initial_idea: "range endpoint idea" });

		run(`update --current-ambiguity ${value}`);

		const nested = rawState()["state"] as Record<string, unknown>;
		expect(nested["current_ambiguity"]).toBe(expected);
		expect(nested["reported_ambiguity"]).toBe(expected);
	});

	test.each([["0x1a"]])(
		"update --current-ambiguity %s (non-decimal format): CLI exits non-zero; state file byte-unchanged",
		(value) => {
			writeSeed();
			initDeepInterviewState(SID, { initial_idea: "guard idea" });
			run("update --current-ambiguity 0.3");

			const path = resolveStatePath(SID);
			const before = readFileSync(path, "utf8");

			expect(() => run(`update --current-ambiguity ${value}`)).toThrow();

			const after = readFileSync(path, "utf8");
			expect(after).toBe(before);
		},
	);

	test.each([["0"], ["0.04"], ["1"]])(
		"update --current-ambiguity %s (valid decimal): CLI exits zero; current_ambiguity is stored as reported",
		(value) => {
			writeSeed();
			initDeepInterviewState(SID, { initial_idea: "guard idea" });

			run(`update --current-ambiguity ${value}`);

			const nested = rawState()["state"] as Record<string, unknown>;
			expect(nested["current_ambiguity"]).toBe(Number(value));
		},
	);

	// ---------------------------------------------------------------------------
	// topology-floor-evolution Stage 6: legacy migration (UC11 — see
	// topology-floor-evolution.md)
	// ---------------------------------------------------------------------------

	// UC11 — legacy migration: a state written before the topology field existed (no
	// `state.topology` at all — the pre-Stage-1 shape) reads as "legacy_missing", the
	// signal that Round 0 (topology enumeration) must run before the next per-component
	// scoring write. A state that has already locked topology — even with zero
	// components — is never legacy_missing, regardless of scoring progress elsewhere.
	test("UC11: topology-absent state reads as legacy_missing; topology-present state does not", () => {
		const legacy: DeepInterviewStateContent = {
			initial_idea: "pre-topology state",
			current_ambiguity: 0.4,
		};
		expect(computeTopologyMigrationStatus(legacy)).toBe("legacy_missing");

		const migrated: DeepInterviewStateContent = {
			initial_idea: "post-topology state",
			topology: { components: [] },
		};
		expect(computeTopologyMigrationStatus(migrated)).toBe("current");
	});

	// UC11 — undefined/null state (no state object written at all yet) is also
	// legacy_missing, matching computeAmbiguityFloor's undefined/null-safe convention.
	test("UC11: undefined/null state also reads as legacy_missing", () => {
		expect(computeTopologyMigrationStatus(undefined)).toBe("legacy_missing");
		expect(computeTopologyMigrationStatus(null)).toBe("legacy_missing");
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
