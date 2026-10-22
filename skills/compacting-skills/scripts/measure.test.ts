import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMeasureCli } from "./measure.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function evidenceFile(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "compacting-measure-")));
	roots.push(root);
	return join(root, "measurement.json");
}

function run(file: string, args: string[], stdin?: string) {
	return runMeasureCli(["--file", file, ...args], { stdin });
}

function addScenarios(file: string, ids: string[]): void {
	for (const id of ids) expect(run(file, ["add-scenario", "--id", id, "--set", "a", "--rules", "R-001,R-002"]).exitCode).toBe(0);
}

function grades(rows: Array<[string, string, string]>): string {
	return JSON.stringify(rows.map(([scenario, rep, grade]) => ({ scenario, rep, grade, note: "" })));
}

describe("add-scenario", () => {
	test("첫 시나리오가 파일을 만들고 rules를 배열로 저장함", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1"]);
		const state = JSON.parse(readFileSync(file, "utf8"));
		expect(state.scenarios).toEqual([{ id: "S-A-1", set: "a", rules: ["R-001", "R-002"] }]);
	});

	test("같은 시나리오 ID를 두 번 등록하면 거부함", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1"]);
		const result = run(file, ["add-scenario", "--id", "S-A-1", "--set", "b", "--rules", "R-003"]);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("S-A-1");
	});

	test("rules가 비어 있으면 거부함", () => {
		const result = run(evidenceFile(), ["add-scenario", "--id", "S-A-1", "--set", "a", "--rules", " , "]);
		expect(result.exitCode).toBe(1);
	});
});

describe("record-grades", () => {
	test("등록되지 않은 시나리오, 잘못된 등급, 배치 내 중복, 이미 채점된 rep을 거부하고 아무것도 쓰지 않음", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1"]);
		const before = readFileSync(file, "utf8");
		for (const batch of [
			grades([["S-A-1", "r1", "C"], ["S-X-9", "r1", "C"]]),
			grades([["S-A-1", "r1", "X"]]),
			grades([["S-A-1", "r1", "C"], ["S-A-1", "r1", "W"]]),
		]) {
			expect(run(file, ["record-grades", "--run", "baseline"], batch).exitCode).toBe(1);
			expect(readFileSync(file, "utf8")).toBe(before);
		}
		expect(run(file, ["record-grades", "--run", "baseline"], grades([["S-A-1", "r1", "W"]])).exitCode).toBe(0);
		const again = run(file, ["record-grades", "--run", "baseline"], grades([["S-A-1", "r1", "C"]]));
		expect(again.exitCode).toBe(1);
		expect(again.stderr).toContain("adjudicate");
	});

	test("run 이름이 다르면 같은 시나리오·rep을 따로 기록함", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1"]);
		expect(run(file, ["record-grades", "--run", "baseline"], grades([["S-A-1", "r1", "W"]])).exitCode).toBe(0);
		expect(run(file, ["record-grades", "--run", "new"], grades([["S-A-1", "r1", "C"]])).exitCode).toBe(0);
	});
});

describe("adjudicate", () => {
	test("등급을 바꾸고 이전·이후 등급과 이유를 기록함", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1"]);
		run(file, ["record-grades", "--run", "baseline"], grades([["S-A-1", "r3", "P"]]));
		const result = run(file, ["adjudicate", "--run", "baseline", "--scenario", "S-A-1", "--rep", "r3", "--grade", "C", "--reason", "grader가 PARTIAL 조건을 잘못 적용"]);
		expect(result.exitCode).toBe(0);
		const state = JSON.parse(readFileSync(file, "utf8"));
		expect(state.runs.baseline.grades["S-A-1"].r3.grade).toBe("C");
		expect(state.runs.baseline.adjudications).toEqual([
			{ scenario: "S-A-1", rep: "r3", before: "P", after: "C", reason: "grader가 PARTIAL 조건을 잘못 적용" },
		]);
	});

	test("채점되지 않은 rep, 빈 이유, 같은 등급으로의 변경을 거부함", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1"]);
		run(file, ["record-grades", "--run", "baseline"], grades([["S-A-1", "r1", "P"]]));
		const base = ["adjudicate", "--run", "baseline", "--scenario", "S-A-1"];
		expect(run(file, [...base, "--rep", "r2", "--grade", "C", "--reason", "x"]).exitCode).toBe(1);
		expect(run(file, [...base, "--rep", "r1", "--grade", "C", "--reason", "  "]).exitCode).toBe(1);
		expect(run(file, [...base, "--rep", "r1", "--grade", "P", "--reason", "x"]).exitCode).toBe(1);
	});
});

describe("score", () => {
	test("시나리오별 점수와 총점을 쓰고, 숫자 순으로 정렬함", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-10", "S-A-2"]);
		run(file, ["record-grades", "--run", "baseline"], grades([["S-A-2", "r1", "C"], ["S-A-2", "r2", "P"], ["S-A-10", "r1", "W"], ["S-A-10", "r2", "C"]]));
		const out = join(file, "..", "score.md");
		const result = run(file, ["score", "--run", "baseline", "--reps", "r1,r2", "--out", out]);
		expect(result.exitCode).toBe(0);
		const report = readFileSync(out, "utf8");
		expect(report).toContain("| S-A-2 | CP | 1 | 1 | 0 | 0.75 |");
		expect(report).toContain("Total: 4 answers, C 2 / P 1 / W 1, score 0.625");
		expect(report.indexOf("| S-A-2 |")).toBeLessThan(report.indexOf("| S-A-10 |"));
		expect(result.stdout).toContain("score 0.625");
	});

	test("rep이 빠졌거나 채점이 없는 시나리오를 보고하고 exit 1, 집계에서는 뺌", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1", "S-A-2", "S-A-3"]);
		run(file, ["record-grades", "--run", "baseline"], grades([["S-A-1", "r1", "C"], ["S-A-1", "r2", "C"], ["S-A-2", "r1", "W"]]));
		const out = join(file, "..", "score.md");
		const result = run(file, ["score", "--run", "baseline", "--reps", "r1,r2", "--out", out]);
		expect(result.exitCode).toBe(1);
		const report = readFileSync(out, "utf8");
		expect(report).toContain("Total: 2 answers, C 2 / P 0 / W 0, score 1.000");
		expect(report).toContain("Missing reps (excluded): S-A-2");
		expect(report).toContain("No grades: S-A-3");
		expect(report).not.toContain("| S-A-2 |");
	});

	test("--set이 있으면 그 set 시나리오만 채점·완전성 검사하고, 없는 set은 거부함", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1"]);
		expect(run(file, ["add-scenario", "--id", "S-T-1", "--set", "targeted", "--rules", "R-009"]).exitCode).toBe(0);
		run(file, ["record-grades", "--run", "mid"], grades([["S-T-1", "r1", "W"], ["S-T-1", "r2", "C"]]));
		const all = run(file, ["score", "--run", "mid", "--reps", "r1,r2"]);
		expect(all.exitCode).toBe(1);
		const scoped = run(file, ["score", "--run", "mid", "--reps", "r1,r2", "--set", "targeted"]);
		expect(scoped.exitCode).toBe(0);
		expect(scoped.stdout).toContain("| S-T-1 | WC |");
		expect(scoped.stdout).not.toContain("S-A-1");
		expect(run(file, ["score", "--run", "mid", "--reps", "r1,r2", "--set", "nope"]).exitCode).toBe(1);
	});

	test("--reps가 비었거나 중복이면 채점 전에 거부함", () => {
		const file = evidenceFile();
		addScenarios(file, ["S-A-1"]);
		run(file, ["record-grades", "--run", "baseline"], grades([["S-A-1", "r1", "C"]]));
		for (const reps of ["r1,r1,r1,r1,r1", ",", " "]) {
			const result = run(file, ["score", "--run", "baseline", "--reps", reps]);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("--reps");
		}
	});

	test("시나리오가 하나도 없거나 파일이 없으면 실패함", () => {
		const file = evidenceFile();
		expect(run(file, ["score", "--run", "baseline"]).exitCode).toBe(1);
		expect(existsSync(file)).toBe(false);
	});
});
