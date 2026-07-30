#!/usr/bin/env bun
/**
 * F3-flow: proves the usage-summary harvest must precede clean, and clean must precede return.
 *
 * Four tests together establish the ordering constraint:
 *   1. summarizeUsage on a fixture job dir returns a known non-zero aggregate (harvest works).
 *   2. summarizeUsage on the SAME fixture after members/ is deleted returns 0
 *      (harvest is impossible post-clean — proves the window closes).
 *   3-4. SKILL.md mentions "Find Token Usage" (the label appended to the returned text)
 *      BEFORE the `clean` teardown reference — checked separately on EACH conductor path
 *      that runs clean, since either one reordered destroys the member data.
 *
 * Tests 1 & 2 are green from the start (summarizeUsage already implemented in T3).
 * Tests 3 & 4 are the RED gate: each fails until its path wires usage-summary before clean.
 * They must stay per-path: a single scan over the whole Conductor Workflow section resolves
 * every index inside the timeout-fallback branch, so a reordered normal path passes unnoticed.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { summarizeUsage } from "./usage-summary.ts";

const SKILL_MD_PATH = path.resolve(path.dirname(import.meta.path), "../SKILL.md");

// Known fixture token totals (alice + bob)
const FIXTURE_INPUT_TOKENS = 300; // 100 + 200
const FIXTURE_OUTPUT_TOKENS = 130; // 50 + 80
const FIXTURE_CACHED_TOKENS = 20; // alice only

function makeJobFixture(dir: string): void {
	const membersDir = path.join(dir, "members");
	const members = [
		{
			name: "alice",
			usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 20 },
		},
		{
			name: "bob",
			usage: { input_tokens: 200, output_tokens: 80 },
		},
	];
	for (const m of members) {
		fs.mkdirSync(path.join(membersDir, m.name), { recursive: true });
		fs.writeFileSync(
			path.join(membersDir, m.name, "status.json"),
			JSON.stringify({ member: m.name, state: "done", usage: m.usage }),
		);
	}
}

/**
 * Slice one named region out of SKILL.md. Each ordering assertion must be anchored to a
 * SINGLE conductor path: a whole-section scan lets one path's correct ordering satisfy the
 * index lookups while another path is silently reordered.
 */
function sliceRegion(skill: string, startMarker: string, endMarker: string): string {
	const start = skill.indexOf(startMarker);
	expect(start).toBeGreaterThan(-1);
	const end = skill.indexOf(endMarker, start + startMarker.length);
	expect(end).toBeGreaterThan(-1);
	return skill.slice(start, end);
}

/** Assert this path harvests token usage before deleting the job dir. Returns the clean position. */
function expectHarvestBeforeClean(block: string): number {
	const findTokenUsagePos = block.indexOf("Find Token Usage");
	expect(findTokenUsagePos).toBeGreaterThan(-1);

	const cleanPos = block.indexOf('clean "$JOB_DIR"', findTokenUsagePos);
	expect(cleanPos).toBeGreaterThan(-1);
	expect(findTokenUsagePos).toBeLessThan(cleanPos);

	return cleanPos;
}

describe("F3-flow: usage-summary 하베스트는 clean보다 먼저 실행돼야 한다", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f3-flow-test-"));
		makeJobFixture(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test("`summarizeUsage`는 members/ 삭제 전에 알려진 비-0 합산값을 반환한다", () => {
		const result = summarizeUsage(tmpDir);

		expect(result.memberCount).toBe(2);
		expect(result.usage.input_tokens).toBe(FIXTURE_INPUT_TOKENS);
		expect(result.usage.output_tokens).toBe(FIXTURE_OUTPUT_TOKENS);
		expect(result.usage.cached_input_tokens).toBe(FIXTURE_CACHED_TOKENS);
	});

	test("`summarizeUsage`는 members/ 삭제 후 빈 합산값을 반환한다 (clean 시뮬레이션)", () => {
		// Mirror generic-job.ts:867 — rmSync on the members subdir simulates what clean does
		// to the data summarizeUsage reads. The job dir shell survives; only member data is gone.
		fs.rmSync(path.join(tmpDir, "members"), { recursive: true, force: true });

		const result = summarizeUsage(tmpDir);

		expect(result.memberCount).toBe(0);
		expect(result.usage).toEqual({});
	});

	test('SKILL.md 정상 경로(Step 4)에서 "Find Token Usage"는 `clean` 앞에, `clean`은 최종 return 앞에 위치한다', () => {
		const step4 = sliceRegion(
			fs.readFileSync(SKILL_MD_PATH, "utf8"),
			"### Step 4 — Merge, Teardown & Return",
			"\n## ",
		);

		const cleanPos = expectHarvestBeforeClean(step4);

		// The final response must be handed back AFTER the clean step — teardown before return
		const returnPos = step4.indexOf("return the merged candidate list", cleanPos);
		expect(returnPos).toBeGreaterThan(-1);
		expect(cleanPos).toBeLessThan(returnPos);
	});

	test('SKILL.md 타임아웃 폴백 분기에서도 "Find Token Usage"는 `clean` 앞에 위치한다', () => {
		const fallback = sliceRegion(
			fs.readFileSync(SKILL_MD_PATH, "utf8"),
			"If the 6th call still does not report",
			"Response JSON (done)",
		);

		expectHarvestBeforeClean(fallback);
	});
});
