#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { atomicWriteJson } from "@lib/job-utils.ts";
import { withStateLock } from "@lib/persistent-mode-core/state-lock.ts";

export type MeasureCliResult = { exitCode: number; stdout: string; stderr: string };

const help = `measure — scenario inventory and grades for one compaction target, kept in one JSON file

Every command takes --file <evidence-dir>/measurement.json. Only this CLI writes that file.

Commands:
  add-scenario --id ID --set SET --rules R-001,R-002   register a scenario (refuses a duplicate id or empty rules)
  record-grades --run RUN                              stdin: JSON array of {scenario, rep, grade C|P|W, note}
                                                       all-or-nothing; refuses unknown scenarios, bad grades,
                                                       and a (scenario, rep) already graded in RUN
  adjudicate --run RUN --scenario ID --rep REP --grade C|P|W --reason TEXT
                                                       change one recorded grade; keeps before, after, reason
  score --run RUN [--set SET,...] [--reps r1,r2,r3,r4,r5] [--out FILE]
                                                       per-scenario table and total; exits 1 when a scenario
                                                       is missing a rep or has no grades in RUN. --set limits
                                                       the scenarios scored and checked to those sets
`;

const POINTS = { C: 1, P: 0.5, W: 0 } as const;
type Grade = keyof typeof POINTS;
type Scenario = { id: string; set: string; rules: string[] };
type Adjudication = { scenario: string; rep: string; before: Grade; after: Grade; reason: string };
type Run = { grades: Record<string, Record<string, { grade: Grade; note: string }>>; adjudications: Adjudication[] };
type Measurement = { scenarios: Scenario[]; runs: Record<string, Run> };

const NAME = /^[A-Za-z0-9_.-]+$/;

function name(value: string | undefined, flag: string): string {
	if (!value || !NAME.test(value)) throw new Error(`${flag} must match ${NAME} (got ${JSON.stringify(value ?? "")})`);
	return value;
}

function grade(value: unknown, where: string): Grade {
	if (value !== "C" && value !== "P" && value !== "W") throw new Error(`${where}: grade must be C, P, or W (got ${JSON.stringify(value)})`);
	return value;
}

function load(file: string, create: boolean): Measurement {
	if (!existsSync(file)) {
		if (create) return { scenarios: [], runs: {} };
		throw new Error(`${file} does not exist; register scenarios with add-scenario first`);
	}
	const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (!isMeasurement(parsed)) throw new Error(`${file} is not a measurement file ({scenarios: [], runs: {}})`);
	return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMeasurement(value: unknown): value is Measurement {
	return isRecord(value) && Array.isArray(value.scenarios) && isRecord(value.runs);
}

function order(id: string): [string, number] {
	const cut = id.lastIndexOf("-");
	const tail = id.slice(cut + 1);
	return cut >= 0 && /^\d+$/.test(tail) ? [id.slice(0, cut), Number(tail)] : [id, 0];
}

function byId(a: string, b: string): number {
	const [ha, na] = order(a);
	const [hb, nb] = order(b);
	return ha < hb ? -1 : ha > hb ? 1 : na - nb;
}

function score(state: Measurement, runName: string, reps: string[], sets: string[]): { report: string; summary: string; incomplete: boolean } {
	if (state.scenarios.length === 0) throw new Error("no scenarios registered");
	for (const set of sets) if (!state.scenarios.some((s) => s.set === set)) throw new Error(`no scenario is registered in set ${set}`);
	const scenarios = sets.length ? state.scenarios.filter((s) => sets.includes(s.set)) : state.scenarios;
	const graded = state.runs[runName]?.grades ?? {};
	const lines = ["| scenario | grades | C | P | W | score |", "|---|---|---|---|---|---|"];
	const total = { C: 0, P: 0, W: 0 };
	const missing: string[] = [];
	const ungraded: string[] = [];
	for (const id of scenarios.map((s) => s.id).sort(byId)) {
		const reps0 = graded[id];
		if (!reps0 || Object.keys(reps0).length === 0) { ungraded.push(id); continue; }
		const got = reps.flatMap((r) => (reps0[r] ? [reps0[r].grade] : []));
		if (got.length < reps.length) { missing.push(id); continue; }
		const count = { C: 0, P: 0, W: 0 };
		for (const g of got) { count[g] += 1; total[g] += 1; }
		const value = got.reduce((sum, g) => sum + POINTS[g], 0) / reps.length;
		lines.push(`| ${id} | ${got.join("")} | ${count.C} | ${count.P} | ${count.W} | ${value.toFixed(2)} |`);
	}
	const n = total.C + total.P + total.W;
	let summary = `Total: ${n} answers, C ${total.C} / P ${total.P} / W ${total.W}`;
	if (n) summary += `, score ${((total.C + 0.5 * total.P) / n).toFixed(3)}`;
	const gaps: string[] = [];
	if (missing.length) gaps.push(`Missing reps (excluded): ${missing.join(", ")}`);
	if (ungraded.length) gaps.push(`No grades: ${ungraded.join(", ")}`);
	lines.push("", summary, ...gaps);
	return { report: `${lines.join("\n")}\n`, summary: [summary, ...gaps].join("\n"), incomplete: gaps.length > 0 };
}

export function runMeasureCli(args: string[], io: { stdin?: string } = {}): MeasureCliResult {
	if (args.length === 0 || args.includes("help") || args.includes("--help")) return { exitCode: 0, stdout: help, stderr: "" };
	try {
		const { values, positionals } = parseArgs({
			args,
			allowPositionals: true,
			options: {
				file: { type: "string" }, id: { type: "string" }, set: { type: "string" }, rules: { type: "string" },
				run: { type: "string" }, scenario: { type: "string" }, rep: { type: "string" }, grade: { type: "string" },
				reason: { type: "string" }, reps: { type: "string" }, out: { type: "string" },
			},
			strict: true,
		});
		if (positionals.length !== 1) throw new Error(`expected exactly one command, got ${JSON.stringify(positionals)}`);
		const command = positionals[0];
		if (!values.file) throw new Error("--file <evidence-dir>/measurement.json is required");
		const file = resolve(values.file);

		if (command === "score") {
			const runName = name(values.run, "--run");
			const reps = (values.reps ?? "r1,r2,r3,r4,r5").split(",").map((r) => r.trim()).filter(Boolean);
			if (reps.length === 0 || new Set(reps).size !== reps.length) throw new Error(`--reps must list distinct rep ids (got ${JSON.stringify(values.reps)})`);
			const sets = (values.set ?? "").split(",").map((s) => s.trim()).filter(Boolean);
			const result = score(load(file, false), runName, reps, sets);
			if (values.out) writeFileSync(resolve(values.out), result.report, "utf8");
			return { exitCode: result.incomplete ? 1 : 0, stdout: `${values.out ? result.summary : result.report}\n`, stderr: "" };
		}

		return withStateLock(file, () => {
			const state = load(file, command === "add-scenario");
			switch (command) {
				case "add-scenario": {
					const id = name(values.id, "--id");
					const set = name(values.set, "--set");
					const rules = (values.rules ?? "").split(",").map((r) => r.trim()).filter(Boolean);
					if (rules.length === 0) throw new Error("--rules needs at least one rule id");
					if (state.scenarios.some((s) => s.id === id)) throw new Error(`scenario ${id} is already registered`);
					state.scenarios.push({ id, set, rules });
					break;
				}
				case "record-grades": {
					const runName = name(values.run, "--run");
					const rows: unknown = JSON.parse(io.stdin ?? "");
					if (!Array.isArray(rows) || rows.length === 0) throw new Error("stdin must be a non-empty JSON array of {scenario, rep, grade, note}");
					const known = new Set(state.scenarios.map((s) => s.id));
					const run = state.runs[runName] ?? { grades: {}, adjudications: [] };
					const seen = new Set<string>();
					const accepted: Array<{ scenario: string; rep: string; grade: Grade; note: string }> = [];
					for (const [i, row] of rows.entries()) {
						const where = `row ${i}`;
						if (!isRecord(row)) throw new Error(`${where}: must be an object {scenario, rep, grade, note}`);
						const { scenario, rep, note } = row;
						if (typeof scenario !== "string" || !known.has(scenario)) throw new Error(`${where}: scenario ${JSON.stringify(scenario)} is not registered`);
						if (typeof rep !== "string" || !NAME.test(rep)) throw new Error(`${where}: rep must match ${NAME}`);
						const g = grade(row.grade, where);
						const key = `${scenario} ${rep}`;
						if (seen.has(key)) throw new Error(`${where}: ${key} appears twice in this batch`);
						if (run.grades[scenario]?.[rep]) throw new Error(`${where}: ${key} is already graded in run ${runName}; use adjudicate to change it`);
						seen.add(key);
						accepted.push({ scenario, rep, grade: g, note: typeof note === "string" ? note : "" });
					}
					for (const row of accepted) (run.grades[row.scenario] ??= {})[row.rep] = { grade: row.grade, note: row.note };
					state.runs[runName] = run;
					break;
				}
				case "adjudicate": {
					const runName = name(values.run, "--run");
					const scenario = name(values.scenario, "--scenario");
					const rep = name(values.rep, "--rep");
					const after = grade(values.grade, "--grade");
					const reason = (values.reason ?? "").trim();
					if (!reason) throw new Error("--reason is required");
					const run = state.runs[runName];
					const current = run?.grades[scenario]?.[rep];
					if (!run || !current) throw new Error(`${scenario} ${rep} has no grade in run ${runName}`);
					if (current.grade === after) throw new Error(`${scenario} ${rep} is already ${after}`);
					run.adjudications.push({ scenario, rep, before: current.grade, after, reason });
					current.grade = after;
					break;
				}
				default:
					throw new Error(`unknown command '${command}'`);
			}
			atomicWriteJson(file, state);
			return { exitCode: 0, stdout: `${JSON.stringify({ status: "ok", command })}\n`, stderr: "" };
		});
	} catch (error) {
		return { exitCode: 1, stdout: "", stderr: `${JSON.stringify({ status: "error", message: error instanceof Error ? error.message : String(error) })}\n` };
	}
}

const entry = typeof Bun !== "undefined" ? Bun.main === fileURLToPath(import.meta.url) : process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (entry) {
	const args = process.argv.slice(2);
	const result = runMeasureCli(args, { stdin: args.includes("record-grades") ? readFileSync(0, "utf8") : undefined });
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	process.exitCode = result.exitCode;
}
