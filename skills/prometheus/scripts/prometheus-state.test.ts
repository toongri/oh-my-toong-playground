import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import * as os from "os";
import { join } from "path";
import {
	readPrometheusState,
	setPrometheusState,
	clearPrometheusState,
	resolveStatePath,
} from "./prometheus-state.ts";

let tmpDir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;

/** Seed the state file as the PreToolUse hook would (create-if-absent skeleton). */
function seedFile(sessionId: string): string {
	const path = resolveStatePath(sessionId);
	if (!existsSync(path)) {
		writeFileSync(
			path,
			JSON.stringify({
				active: true,
				phase: "S0",
				plan_path: "",
				resume_summary: "",
				started_at: new Date().toISOString().slice(0, 19),
				last_touched_at: new Date().toISOString().slice(0, 19),
			}),
			"utf8",
		);
	}
	return path;
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "prometheus-state-test-"));
	process.env.OMT_DIR = tmpDir;
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

describe("prometheus state", () => {
	test("prometheus roundtrip", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		setPrometheusState("test-session", {
			phase: "S3",
			plan_path: `${tmpDir}/plans/my-plan.md`,
			resume_summary: "paused after interview",
		});
		const state = readPrometheusState("test-session");
		expect(state).not.toBeNull();
		expect(state!.active).toBe(true);
		expect(state!.phase).toBe("S3");
		expect(state!.plan_path).toBe(`${tmpDir}/plans/my-plan.md`);
		expect(state!.resume_summary).toBe("paused after interview");
	});

	test("prometheus inactive returns null", () => {
		process.env.OMT_SESSION_ID = "test-session";
		// absent file
		expect(readPrometheusState("test-session")).toBeNull();

		// file with active:false
		const path = resolveStatePath("test-session");
		writeFileSync(
			path,
			JSON.stringify({
				active: false,
				phase: "S1",
				plan_path: "",
				resume_summary: "",
				started_at: "2024-01-01T00:00:00",
			}),
			"utf8",
		);
		expect(readPrometheusState("test-session")).toBeNull();
	});

	test("prometheus clear removes file", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		setPrometheusState("test-session", { phase: "S1", plan_path: "", resume_summary: "" });
		const path = resolveStatePath("test-session");
		expect(existsSync(path)).toBe(true);
		clearPrometheusState("test-session");
		expect(existsSync(path)).toBe(false);
	});

	test("prometheus state path literal", () => {
		process.env.OMT_SESSION_ID = "my-session";
		const path = resolveStatePath("my-session");
		expect(path).toBe(`${tmpDir}/prometheus-state-my-session.json`);
	});

	test("prometheus resume_summary control-char normalized", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		const dirty = "line1\nline2\ttabbed\x01control";
		setPrometheusState("test-session", {
			phase: "S2",
			plan_path: "",
			resume_summary: dirty,
		});
		const state = readPrometheusState("test-session");
		expect(state).not.toBeNull();
		// No characters in U+0000-U+001F should remain
		// eslint-disable-next-line no-control-regex -- asserting the sanitizer strips this exact control-char range
		const hasBadChars = /[\x00-\x1F]/.test(state!.resume_summary);
		expect(hasBadChars).toBe(false);
	});

	test("prometheus started_at seeded and preserved", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		setPrometheusState("test-session", { phase: "S1", plan_path: "", resume_summary: "" });
		const first = readPrometheusState("test-session");
		expect(first).not.toBeNull();
		const firstStartedAt = first!.started_at;

		// Second set call
		setPrometheusState("test-session", { phase: "S2", plan_path: "", resume_summary: "" });
		const second = readPrometheusState("test-session");
		expect(second!.started_at).toBe(firstStartedAt);

		// Format: no milliseconds, matches local ISO-8601 date+time
		expect(firstStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});

	test("prometheus session id fallback", () => {
		delete process.env.OMT_SESSION_ID;
		const sessionId = process.env.OMT_SESSION_ID || "default";
		const path = resolveStatePath(sessionId);
		expect(path).toBe(`${tmpDir}/prometheus-state-default.json`);
	});

	// Pins the fix: on Codex, OMT_DIR is unset by design (hooks/codex-write-guard.sh:272,
	// hooks/pre-tool-enforcer.sh:339 both `unset OMT_DIR` and derive it from cwd
	// instead). prometheus-state.ts now delegates to @lib/omt-dir's shared getOmtDir()
	// (prometheus-state.ts:17,101), the same fallback every sibling skill state module
	// (goal-state.ts, ultragoal-state.ts, qa-state.ts, deep-interview-state.ts) uses,
	// which never throws — replacing prometheus-state.ts's former local getOmtDir()
	// reimplementation, which used to throw in this condition. This test guards the
	// regression: it must keep resolving to a path, not throw.
	// Sandboxed: bun's os.homedir() ignores env HOME (must spyOn, per
	// tools/lib/backup.test.ts), and the shared getOmtDir() creates the resolved
	// directory — so homedir() is faked to a disposable tmp dir to avoid ever
	// touching the real ~/.omt.
	test("resolveStatePath resolves without throwing when OMT_DIR is unset (Codex condition)", () => {
		delete process.env.OMT_DIR;
		const fakeHome = mkdtempSync(join(tmpdir(), "prometheus-fakehome-"));
		const homedirSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
		try {
			expect(() => resolveStatePath("codex-session")).not.toThrow();
			const path = resolveStatePath("codex-session");
			expect(path.startsWith(`${fakeHome}/.omt/`)).toBe(true);
			expect(path.endsWith("/prometheus-state-codex-session.json")).toBe(true);
		} finally {
			homedirSpy.mockRestore();
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});

	test("prometheus phase-only update preserves prior plan_path and resume_summary", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");

		// First write: full fields
		setPrometheusState("test-session", {
			phase: "S2",
			plan_path: `${tmpDir}/plans/my-plan.md`,
			resume_summary: "paused at interview",
		});
		const first = readPrometheusState("test-session");
		expect(first).not.toBeNull();
		const firstStartedAt = first!.started_at;

		// Second write: phase only, omitting plan_path and resume_summary
		setPrometheusState("test-session", { phase: "S4" });

		const second = readPrometheusState("test-session");
		expect(second).not.toBeNull();
		expect(second!.phase).toBe("S4");
		expect(second!.plan_path).toBe(`${tmpDir}/plans/my-plan.md`);
		expect(second!.resume_summary).toBe("paused at interview");
		expect(second!.started_at).toBe(firstStartedAt);
	});

	// --- (A5) prometheus-state refreshes last_touched_at on every write ---
	test("(A5) prometheus-state refreshes last_touched_at on every write", async () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		setPrometheusState("test-session", { phase: "S1", plan_path: "", resume_summary: "" });
		const first = readPrometheusState("test-session");
		expect(first).not.toBeNull();
		const firstLta = first!.last_touched_at;
		expect(firstLta).toBeTruthy();
		// Wait 1 second to ensure timestamp advances
		await new Promise((r) => setTimeout(r, 1100));
		setPrometheusState("test-session", { phase: "S2", plan_path: "", resume_summary: "" });
		const second = readPrometheusState("test-session");
		expect(second!.last_touched_at).not.toBe(firstLta);
		expect(second!.last_touched_at > firstLta).toBe(true);
		expect(second!.last_touched_at >= second!.started_at).toBe(true);
	});

	// --- (self-heal-prom) prometheus CLI seeds when the hook never fired ---
	test("(self-heal-prom) setPrometheusState seeds then succeeds when file absent", () => {
		process.env.OMT_SESSION_ID = "absent-session";
		// No file seeded (e.g. slash-command entry) — ensureSeed writes the pristine skeleton
		expect(existsSync(resolveStatePath("absent-session"))).toBe(false);
		expect(() => setPrometheusState("absent-session", { phase: "S1" })).not.toThrow();
		expect(existsSync(resolveStatePath("absent-session"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Adoption surface tests (TODO 8)
// ---------------------------------------------------------------------------

const promScript = join(import.meta.dir, "prometheus-state.ts");

/** Returns a current-time ISO-8601 string with timezone offset. */
function nowIsoP(): string {
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

/** Write a live prometheus state with the given sid and plan_path. */
function writeLivePromState(sid: string, planPath: string): void {
	const path = `${tmpDir}/prometheus-state-${sid}.json`;
	const now = nowIsoP();
	writeFileSync(
		path,
		JSON.stringify({
			active: true,
			phase: "S3",
			plan_path: planPath,
			resume_summary: "",
			started_at: now,
			last_touched_at: now,
		}),
		"utf8",
	);
}

/** Write a pristine prometheus state (S0, plan_path empty). */
function writePristinePromState(sid: string): void {
	const path = `${tmpDir}/prometheus-state-${sid}.json`;
	const now = nowIsoP();
	writeFileSync(
		path,
		JSON.stringify({
			active: true,
			phase: "S0",
			plan_path: "",
			resume_summary: "",
			started_at: now,
			last_touched_at: now,
		}),
		"utf8",
	);
}

function runPromCli(args: string, env?: Record<string, string>): string {
	return execSync(`bun ${promScript} ${args}`, {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

describe("adoption: list-others + adopt (prometheus CLI)", () => {
	// (F2-prom) list-others surfaces ACTIVE-live candidate, purpose = plan_path or phase
	test("F2-prom: list-others shows A with plan_path as purpose, excludes self B", () => {
		process.env.OMT_SESSION_ID = "B";
		writeLivePromState("A", `${tmpDir}/plans/myplan.md`);
		writePristinePromState("B");
		const out = runPromCli("list-others", { OMT_SESSION_ID: "B" });
		expect(out).toContain("A");
		expect(out).toContain("myplan.md");
		// Self B must not appear
		const lines = out.trim().split("\n").filter(Boolean);
		expect(lines.some((l) => l.includes("prometheus-state-B") || l.startsWith("B "))).toBe(false);
	});

	// (F2-prom) purpose shows phase when plan_path is empty
	test("F2-prom: list-others shows phase as purpose when plan_path is empty", () => {
		// writeLivePromState with empty planPath: plan_path='', phase='S3' → purpose is phase
		writeLivePromState("PA", "");
		const out = runPromCli("list-others", { OMT_SESSION_ID: "PB" });
		expect(out).toContain("PA");
		expect(out).toContain("S3");
	});

	// (label) candidate line has all 4 fields
	test("label: list-others prometheus candidate line has sid + purpose + started_at + idle-seconds", () => {
		writeLivePromState("labelProm", `${tmpDir}/plans/z.md`);
		const out = runPromCli("list-others", { OMT_SESSION_ID: "xSession" });
		expect(out).toContain("labelProm");
		expect(out).toContain("z.md");
		expect(out).toMatch(/\d{4}-\d{2}-\d{2}/);
		expect(out).toMatch(/\d+s/);
	});

	// (F3-cli) adopt re-keys via prometheus CLI
	test("F3-cli: prometheus adopt --src A moves A into B; A absent, B holds content", () => {
		writeLivePromState("A", `${tmpDir}/plans/myplan.md`);
		writePristinePromState("B");
		runPromCli("adopt --src A", { OMT_SESSION_ID: "B" });
		expect(existsSync(`${tmpDir}/prometheus-state-A.json`)).toBe(false);
		const b = JSON.parse(readFileSync(`${tmpDir}/prometheus-state-B.json`, "utf8"));
		expect(b.plan_path).toBe(`${tmpDir}/plans/myplan.md`);
		const log = readFileSync(`${tmpDir}/adoption.log`, "utf8");
		expect(log).toContain("prometheus");
		expect(log).toContain("A -> B");
	});

	// (F6-cli) adopt refused when current B is ACTIVE non-pristine
	test("F6-cli: prometheus adopt refused on ACTIVE non-pristine current B", () => {
		writeLivePromState("A", `${tmpDir}/plans/a.md`);
		writeLivePromState("B", `${tmpDir}/plans/b.md`); // non-pristine (phase S3)
		const aContent = readFileSync(`${tmpDir}/prometheus-state-A.json`, "utf8");
		const bContent = readFileSync(`${tmpDir}/prometheus-state-B.json`, "utf8");
		expect(() => runPromCli("adopt --src A", { OMT_SESSION_ID: "B" })).toThrow();
		expect(readFileSync(`${tmpDir}/prometheus-state-A.json`, "utf8")).toBe(aContent);
		expect(readFileSync(`${tmpDir}/prometheus-state-B.json`, "utf8")).toBe(bContent);
	});

	// (plan-path-warn) adopt with unresolvable plan_path: exit 0 + stderr warning
	test("plan-path-warn: adopt exits 0 and warns on stderr when plan_path does not resolve", () => {
		writeLivePromState("pwSrc", "/nonexistent/plan.md");
		writePristinePromState("pwDst");
		// Capture stdout+stderr merged; should exit 0 (no throw)
		const merged = execSync(`bun ${promScript} adopt --src pwSrc 2>&1`, {
			encoding: "utf8",
			env: { ...process.env, OMT_SESSION_ID: "pwDst", OMT_DIR: tmpDir },
			shell: "/bin/sh",
		});
		// Source must be renamed away
		expect(existsSync(`${tmpDir}/prometheus-state-pwSrc.json`)).toBe(false);
		// Warning must be present in output
		expect(merged).toMatch(/warn|warning|plan_path|not found|does not exist/i);
	});

	// (dormancy-prom) adopted-away source cannot write via set
	test("dormancy-prom: after adoption, session A write is refused (no-create)", () => {
		writeLivePromState("A", `${tmpDir}/plans/plan.md`);
		writePristinePromState("B");
		runPromCli("adopt --src A", { OMT_SESSION_ID: "B" });
		expect(existsSync(`${tmpDir}/prometheus-state-A.json`)).toBe(false);
		// Session A tries to write — must fail
		expect(() => runPromCli("set --phase S2", { OMT_SESSION_ID: "A" })).toThrow();
		expect(existsSync(`${tmpDir}/prometheus-state-A.json`)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// (a) get subcommand
// ---------------------------------------------------------------------------

describe("get subcommand", () => {
	// RED: get with present state file prints JSON to stdout, exits 0
	test("get: prints state JSON to stdout when state file exists", () => {
		writePristinePromState("getSession");
		const out = runPromCli("get", { OMT_SESSION_ID: "getSession" });
		const parsed = JSON.parse(out);
		expect(parsed).not.toBeNull();
		expect(parsed.phase).toBe("S0");
		expect(parsed.active).toBe(true);
	});

	// RED: get with absent state file exits non-zero with a clear message
	test("get: exits non-zero with error message when state file is absent", () => {
		// No file written for 'noStateSession'
		let errorOutput = "";
		try {
			execSync(`bun ${promScript} get 2>&1`, {
				encoding: "utf8",
				env: { ...process.env, OMT_SESSION_ID: "noStateSession", OMT_DIR: tmpDir },
				shell: "/bin/sh",
			});
			// Should have thrown — fail if it reaches here
			expect("should have thrown").toBe("did not throw");
		} catch (err) {
			errorOutput =
				(err as { stdout?: string; stderr?: string; message?: string }).stdout ??
				(err as { message?: string }).message ??
				"";
		}
		expect(errorOutput).toMatch(/noStateSession|absent|not found|no state/i);
	});
});

// ---------------------------------------------------------------------------
// (steps) per-planning-step persistence
// ---------------------------------------------------------------------------

describe("steps persistence", () => {
	// (a) --record-ac records content, done=true, recorded_at=current phase
	test("record-ac: records AC content + done + recorded_at from current phase", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		setPrometheusState("test-session", {
			phase: "S1",
			record_ac: ["AC-1: user can set phase", "AC-2: steps preserved"],
		});
		const state = readPrometheusState("test-session");
		expect(state).not.toBeNull();
		expect(state!.steps.acceptance_criteria.done).toBe(true);
		expect(state!.steps.acceptance_criteria.content).toEqual([
			"AC-1: user can set phase",
			"AC-2: steps preserved",
		]);
		expect(state!.steps.acceptance_criteria.recorded_at).toBe("S1");
	});

	// (b) --mark-design-done sets done=true, ref=current plan_path
	test("mark-design-done: sets design_decisions.done and ref=plan_path", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		setPrometheusState("test-session", {
			phase: "S2",
			plan_path: `${tmpDir}/plans/myplan.md`,
			mark_design_done: true,
		});
		const state = readPrometheusState("test-session");
		expect(state).not.toBeNull();
		expect(state!.steps.design_decisions.done).toBe(true);
		expect(state!.steps.design_decisions.ref).toBe(`${tmpDir}/plans/myplan.md`);
	});

	// (c) --mark-plan-done sets plan.done=true
	test("mark-plan-done: sets plan.done=true", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		setPrometheusState("test-session", { phase: "S3", mark_plan_done: true });
		const state = readPrometheusState("test-session");
		expect(state).not.toBeNull();
		expect(state!.steps.plan.done).toBe(true);
	});

	// (d) steps preserved across a later set --phase that omits step flags
	test("steps preserved across phase-only update", () => {
		process.env.OMT_SESSION_ID = "test-session";
		seedFile("test-session");
		setPrometheusState("test-session", {
			phase: "S1",
			record_ac: ["AC-1"],
		});
		// Phase-only update, no step flags
		setPrometheusState("test-session", { phase: "S2" });
		const state = readPrometheusState("test-session");
		expect(state).not.toBeNull();
		expect(state!.steps.acceptance_criteria.done).toBe(true);
		expect(state!.steps.acceptance_criteria.content).toEqual(["AC-1"]);
		expect(state!.steps.acceptance_criteria.recorded_at).toBe("S1");
	});

	// (e) fresh default steps shape present after a plain set --phase on state with no prior steps
	test("fresh default steps shape when prior state has no steps field", () => {
		process.env.OMT_SESSION_ID = "test-session";
		const path = resolveStatePath("test-session");
		// Write a legacy state without steps
		writeFileSync(
			path,
			JSON.stringify({
				active: true,
				phase: "S0",
				plan_path: "",
				resume_summary: "",
				started_at: new Date().toISOString().slice(0, 19),
				last_touched_at: new Date().toISOString().slice(0, 19),
			}),
			"utf8",
		);
		setPrometheusState("test-session", { phase: "S1" });
		const state = readPrometheusState("test-session");
		expect(state).not.toBeNull();
		expect(state!.steps).toEqual({
			acceptance_criteria: { done: false, content: [], recorded_at: "" },
			design_decisions: { done: false, ref: "" },
			plan: { done: false },
		});
	});

	// (f) invalid --record-ac JSON exits non-zero (CLI test)
	test("record-ac: invalid JSON exits non-zero with clear message", () => {
		writePristinePromState("acErrSession");
		let errorOutput = "";
		try {
			execSync(`bun ${promScript} set --phase S1 --record-ac 'not-json' 2>&1`, {
				encoding: "utf8",
				env: { ...process.env, OMT_SESSION_ID: "acErrSession", OMT_DIR: tmpDir },
				shell: "/bin/sh",
			});
			expect("should have thrown").toBe("did not throw");
		} catch (err) {
			errorOutput =
				(err as { stdout?: string; stderr?: string; message?: string }).stdout ??
				(err as { message?: string }).message ??
				"";
		}
		expect(errorOutput).toMatch(/record-ac|JSON|array/i);
	});

	// (f2) --record-ac with valid JSON but non-array exits non-zero
	test("record-ac: valid JSON but non-array exits non-zero", () => {
		writePristinePromState("acErrSession2");
		let errorOutput = "";
		try {
			execSync(`bun ${promScript} set --phase S1 --record-ac '{"key":"value"}' 2>&1`, {
				encoding: "utf8",
				env: { ...process.env, OMT_SESSION_ID: "acErrSession2", OMT_DIR: tmpDir },
				shell: "/bin/sh",
			});
			expect("should have thrown").toBe("did not throw");
		} catch (err) {
			errorOutput =
				(err as { stdout?: string; stderr?: string; message?: string }).stdout ??
				(err as { message?: string }).message ??
				"";
		}
		expect(errorOutput).toMatch(/record-ac|JSON|array/i);
	});
});

// ---------------------------------------------------------------------------
// (F5) --record-ac input hardening: empty array / non-string elements / bare flag
// ---------------------------------------------------------------------------

/** Run the CLI capturing stdout+stderr merged; returns {code, out}. Never throws. */
function runPromCliMerged(
	args: string,
	env: Record<string, string>,
	stdin?: string,
): { code: number; out: string } {
	try {
		const out = execSync(`bun ${promScript} ${args} 2>&1`, {
			encoding: "utf8",
			env: { ...process.env, ...env },
			shell: "/bin/sh",
			input: stdin,
		});
		return { code: 0, out };
	} catch (err) {
		const e = err as { status?: number; stdout?: string; message?: string };
		return { code: e.status ?? 1, out: e.stdout ?? e.message ?? "" };
	}
}

describe("record-ac input hardening (F5)", () => {
	// (F5-empty) empty array is rejected — would otherwise write done=true with no usable content
	test("record-ac: empty array exits non-zero and writes nothing", () => {
		writePristinePromState("acEmpty");
		const { code, out } = runPromCliMerged("set --phase S1 --record-ac '[]'", {
			OMT_SESSION_ID: "acEmpty",
			OMT_DIR: tmpDir,
		});
		expect(code).not.toBe(0);
		expect(out).toMatch(/record-ac|non-empty|array of strings/i);
		// State must remain at its pristine acceptance_criteria (not recorded done=true)
		const state = JSON.parse(readFileSync(`${tmpDir}/prometheus-state-acEmpty.json`, "utf8"));
		expect(state.steps?.acceptance_criteria?.done ?? false).toBe(false);
	});

	// (F5-nonstring) mixed non-string elements rejected
	test("record-ac: array with non-string elements exits non-zero", () => {
		writePristinePromState("acMixed");
		const { code, out } = runPromCliMerged("set --phase S1 --record-ac '[123, null]'", {
			OMT_SESSION_ID: "acMixed",
			OMT_DIR: tmpDir,
		});
		expect(code).not.toBe(0);
		expect(out).toMatch(/record-ac|non-empty|array of strings|string/i);
	});

	// (F5-bare) bare --record-ac (boolean true, no value) is rejected loudly, not silently no-op'd
	test("record-ac: bare flag with no value exits non-zero", () => {
		writePristinePromState("acBare");
		// `--record-ac` followed by another flag → parses to boolean true
		const { code, out } = runPromCliMerged("set --phase S1 --record-ac --mark-plan-done", {
			OMT_SESSION_ID: "acBare",
			OMT_DIR: tmpDir,
		});
		expect(code).not.toBe(0);
		expect(out).toMatch(/record-ac|requires|JSON-array|stdin/i);
	});

	// (F5-valid) valid argv array still records (backward compatible)
	test("record-ac: valid argv array records done + content + recorded_at", () => {
		writePristinePromState("acValid");
		const { code } = runPromCliMerged(`set --phase S1 --record-ac '["AC1","AC2"]'`, {
			OMT_SESSION_ID: "acValid",
			OMT_DIR: tmpDir,
		});
		expect(code).toBe(0);
		const state = JSON.parse(readFileSync(`${tmpDir}/prometheus-state-acValid.json`, "utf8"));
		expect(state.steps.acceptance_criteria.done).toBe(true);
		expect(state.steps.acceptance_criteria.content).toEqual(["AC1", "AC2"]);
		expect(state.steps.acceptance_criteria.recorded_at).toBe("S1");
	});
});

// ---------------------------------------------------------------------------
// (F4) --record-ac stdin support: value '-' reads JSON array from stdin
// ---------------------------------------------------------------------------

describe("record-ac stdin support (F4)", () => {
	// (F4-stdin-valid) `--record-ac -` reads JSON array from stdin and records it
	test('record-ac: stdin "-" reads JSON array and records it', () => {
		writePristinePromState("acStdin");
		const { code } = runPromCliMerged(
			"set --phase S2 --record-ac -",
			{ OMT_SESSION_ID: "acStdin", OMT_DIR: tmpDir },
			'["AC from stdin", "AC with apostrophe\'s safe"]',
		);
		expect(code).toBe(0);
		const state = JSON.parse(readFileSync(`${tmpDir}/prometheus-state-acStdin.json`, "utf8"));
		expect(state.steps.acceptance_criteria.done).toBe(true);
		expect(state.steps.acceptance_criteria.content).toEqual([
			"AC from stdin",
			"AC with apostrophe's safe",
		]);
		expect(state.steps.acceptance_criteria.recorded_at).toBe("S2");
	});

	// (F4-stdin-empty) stdin empty array rejected (same F5 validation)
	test("record-ac: stdin empty array exits non-zero", () => {
		writePristinePromState("acStdinEmpty");
		const { code, out } = runPromCliMerged(
			"set --phase S1 --record-ac -",
			{ OMT_SESSION_ID: "acStdinEmpty", OMT_DIR: tmpDir },
			"[]",
		);
		expect(code).not.toBe(0);
		expect(out).toMatch(/record-ac|non-empty|array of strings/i);
	});

	// (F4-stdin-garbage) stdin invalid JSON rejected
	test("record-ac: stdin invalid JSON exits non-zero", () => {
		writePristinePromState("acStdinGarbage");
		const { code, out } = runPromCliMerged(
			"set --phase S1 --record-ac -",
			{ OMT_SESSION_ID: "acStdinGarbage", OMT_DIR: tmpDir },
			"not-json",
		);
		expect(code).not.toBe(0);
		expect(out).toMatch(/record-ac|JSON|array/i);
	});
});

// ---------------------------------------------------------------------------
// (F6) --mark-design-done requires a non-empty plan_path
// ---------------------------------------------------------------------------

describe("mark-design-done plan_path guard (F6)", () => {
	// (F6-empty) mark-design-done with no plan_path (seed plan_path="") exits non-zero
	test("mark-design-done: empty plan_path exits non-zero and writes nothing", () => {
		writePristinePromState("mdEmpty"); // plan_path = ''
		const { code, out } = runPromCliMerged("set --phase S2 --mark-design-done", {
			OMT_SESSION_ID: "mdEmpty",
			OMT_DIR: tmpDir,
		});
		expect(code).not.toBe(0);
		expect(out).toMatch(/mark-design-done|plan_path|plan-path/i);
		const state = JSON.parse(readFileSync(`${tmpDir}/prometheus-state-mdEmpty.json`, "utf8"));
		expect(state.steps?.design_decisions?.done ?? false).toBe(false);
	});

	// (F6-arg) mark-design-done with --plan-path provided in the same call records done + ref
	test("mark-design-done: with --plan-path in same call records done + ref", () => {
		writePristinePromState("mdArg");
		const { code } = runPromCliMerged(
			`set --phase S2 --plan-path ${tmpDir}/plans/p.md --mark-design-done`,
			{ OMT_SESSION_ID: "mdArg", OMT_DIR: tmpDir },
		);
		expect(code).toBe(0);
		const state = JSON.parse(readFileSync(`${tmpDir}/prometheus-state-mdArg.json`, "utf8"));
		expect(state.steps.design_decisions.done).toBe(true);
		expect(state.steps.design_decisions.ref).toBe(`${tmpDir}/plans/p.md`);
	});

	// (F6-prior) mark-design-done with plan_path persisted earlier records done + ref
	test("mark-design-done: with prior persisted plan_path records done + ref", () => {
		writeLivePromState("mdPrior", `${tmpDir}/plans/prior.md`); // plan_path persisted
		const { code } = runPromCliMerged("set --phase S2 --mark-design-done", {
			OMT_SESSION_ID: "mdPrior",
			OMT_DIR: tmpDir,
		});
		expect(code).toBe(0);
		const state = JSON.parse(readFileSync(`${tmpDir}/prometheus-state-mdPrior.json`, "utf8"));
		expect(state.steps.design_decisions.done).toBe(true);
		expect(state.steps.design_decisions.ref).toBe(`${tmpDir}/plans/prior.md`);
	});
});

// ---------------------------------------------------------------------------
// (c) no-create write: writeFileNoCreate replaces existsSync-then-write
// ---------------------------------------------------------------------------

describe("no-create write (TOCTOU)", () => {
	// The orphan-resurrection guarantee that matters — an adopted-away session whose
	// old-sid write must be refused — is covered by dormancy-prom above (adopt() records
	// the adoption, and ensureSeed's adoption.log guard refuses to re-seed it). A file
	// that is simply absent with NO adoption record is not an orphan: setPrometheusState
	// self-heals it by seeding the pristine skeleton (mirrors the PreToolUse hook for
	// slash-command entry). writeFileNoCreate still collapses check+write to a single
	// open('r+'), so a concurrent mid-write rename of a non-pristine file throws ENOENT.
	test("setPrometheusState self-heals an absent file with no adoption record", () => {
		const path = resolveStatePath("toctouSession");
		writeFileSync(
			path,
			JSON.stringify({
				active: true,
				phase: "S0",
				plan_path: "",
				resume_summary: "",
				started_at: "2024-01-01T00:00:00",
				last_touched_at: "2024-01-01T00:00:00",
			}),
			"utf8",
		);
		setPrometheusState("toctouSession", { phase: "S1" });
		expect(existsSync(path)).toBe(true);
		// Delete with no adoption record → self-heal on the next write
		unlinkSync(path);
		expect(() => setPrometheusState("toctouSession", { phase: "S2" })).not.toThrow();
		expect(existsSync(path)).toBe(true);
		expect(JSON.parse(readFileSync(path, "utf8")).phase).toBe("S2");
	});
});
