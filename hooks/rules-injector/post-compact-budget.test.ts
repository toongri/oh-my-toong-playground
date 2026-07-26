import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withPostCompactBudget } from "./post-compact-budget.js";
import type { PiRulesConfig } from "./rules/index.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const scratchDirs: string[] = [];

afterEach(() => {
	for (const dir of scratchDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/**
 * Writes a plain-text (non-JSONL), pressure-marker-free transcript of exactly
 * 300 ASCII bytes, so estimateTranscript's token count is deterministic:
 * tokens = ceil(300 / ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN(3)) = 100 (T=100).
 */
function makeTranscript(): string {
	const dir = mkdtempSync(join(tmpdir(), "post-compact-budget-"));
	scratchDirs.push(dir);
	const path = join(dir, "transcript.txt");
	writeFileSync(path, "z".repeat(300));
	return path;
}

/**
 * Config with maxResultChars/postCompactMaxResultChars set well above the
 * largest possible dynamic value in this suite (372k path: 671,460 - 2T ≈
 * 671,260) so the Math.min in withPostCompactBudget never clips the dynamic
 * computation — otherwise a 372k-vs-200k regression would be invisible
 * (both clipped to the same config ceiling).
 */
function makeConfig(): PiRulesConfig {
	return {
		disabled: false,
		maxRuleChars: 2_000_000,
		maxResultChars: 2_000_000,
		postCompactMaxRuleChars: 2_000_000,
		postCompactMaxResultChars: 2_000_000,
		dynamicMaxRuleChars: 2_000_000,
		dynamicMaxResultChars: 2_000_000,
		promptMaxRuleChars: 2_000_000,
		promptMaxResultChars: 2_000_000,
		enabledSources: "auto",
		sessionStateTtlDays: 30,
		errorLogMaxBytes: 1_000_000,
		excludeGlobs: [],
	};
}

// ===========================================================================
// gpt-5.6 계열(sol/terra/luna) 372k 등록 — 신규
// ===========================================================================

test("gpt-5.6-sol 슬러그는 372k 컨텍스트 윈도우 기준 `maxResultChars`를 산출한다", () => {
	const transcriptPath = makeTranscript();
	const result = withPostCompactBudget(makeConfig(), { model: "gpt-5.6-sol", transcriptPath });
	// floor(372000*95/100)=353400; reserved=max(8000, floor(353400*5/100)=17670)=17670;
	// injectable=353400-17670-100=335630; maxResultChars=floor(335630*2)=671260.
	expect(result.maxResultChars).toBe(671_260);
});

test("gpt-5.6-terra 슬러그는 372k 컨텍스트 윈도우 기준 `maxResultChars`를 산출한다", () => {
	const transcriptPath = makeTranscript();
	const result = withPostCompactBudget(makeConfig(), { model: "gpt-5.6-terra", transcriptPath });
	expect(result.maxResultChars).toBe(671_260);
});

test("gpt-5.6-luna 슬러그는 372k 컨텍스트 윈도우 기준 `maxResultChars`를 산출한다", () => {
	const transcriptPath = makeTranscript();
	const result = withPostCompactBudget(makeConfig(), { model: "gpt-5.6-luna", transcriptPath });
	expect(result.maxResultChars).toBe(671_260);
});

// ===========================================================================
// 회귀 방지 — 기존 gpt-5.5(272k)와 미등록 슬러그(200k fallback)는 불변
// ===========================================================================

test("gpt-5.5 슬러그는 여전히 272k 경로를 탄다 (회귀 방지)", () => {
	const transcriptPath = makeTranscript();
	const result = withPostCompactBudget(makeConfig(), { model: "gpt-5.5", transcriptPath });
	// floor(272000*95/100)=258400; reserved=max(8000, floor(258400*5/100)=12920)=12920;
	// injectable=258400-12920-100=245380; maxResultChars=floor(245380*2)=490760.
	expect(result.maxResultChars).toBe(490_760);
});

test("미등록 슬러그(gpt-4.9-nonexistent)는 여전히 200k fallback을 탄다 (회귀 방지)", () => {
	const transcriptPath = makeTranscript();
	const result = withPostCompactBudget(makeConfig(), {
		model: "gpt-4.9-nonexistent",
		transcriptPath,
	});
	// floor(200000*95/100)=190000; reserved=max(8000, floor(190000*5/100)=9500)=9500;
	// injectable=190000-9500-100=180400; maxResultChars=floor(180400*2)=360800.
	expect(result.maxResultChars).toBe(360_800);
});

// ===========================================================================
// 372k 경로가 200k fallback 경로보다 명확히 크다 — 등록 vs 미등록 나란히 대조
// ===========================================================================

test("`gpt-5.6-sol`(372k 등록)의 결과는 `gpt-4.9-nonexistent`(200k fallback)보다 명확히 크다", () => {
	const transcriptPath = makeTranscript();
	const registered = withPostCompactBudget(makeConfig(), {
		model: "gpt-5.6-sol",
		transcriptPath,
	});
	const fallback = withPostCompactBudget(makeConfig(), {
		model: "gpt-4.9-nonexistent",
		transcriptPath,
	});
	expect(registered.maxResultChars).toBeGreaterThan(fallback.maxResultChars);
});
