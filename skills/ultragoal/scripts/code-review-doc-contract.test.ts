import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as state from "./ultragoal-state";

// ---------------------------------------------------------------------------
// ultragoal(소비자)이 code-review SKILL.md(생산자 문서)에 기대는 값이 serializeReviewContext 등
// ultragoal-state.ts가 실제로 내보내는 값과 같은지 확인한다. 값은 코드에서 읽는다.
// 문서가 값을 적지 않았다면 통과한다(모순이 없으면 된다).
// ---------------------------------------------------------------------------

const skillMd = readFileSync(join(import.meta.dir, "../../code-review/SKILL.md"), "utf8");

const SID = "code-review-doc-contract";
let dir: string;
const previousOmtDir = process.env.OMT_DIR;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "code-review-doc-contract-"));
	process.env.OMT_DIR = dir;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (previousOmtDir === undefined) delete process.env.OMT_DIR;
	else process.env.OMT_DIR = previousOmtDir;
});

function planningContext() {
	state.setGoalState(SID, { phase: "planning", outcome: "ship it", verification_surface: "v1" });
	return state.serializeReviewContext(SID);
}

describe("code-review SKILL.md가 기대는 ultragoal 직렬화 값", () => {
	test("UG-1 [SCOPE_CONTRACT] 봉투 표지와 키가 serializeReviewContext 출력과 같다", () => {
		const { project_context } = planningContext();
		const envelope = project_context.match(/(\[SCOPE_CONTRACT\])\n([\s\S]*?)\n(\[\/SCOPE_CONTRACT\])/);
		expect(envelope).not.toBeNull();
		const [, open, json, close] = envelope as RegExpMatchArray;
		const keys = Object.keys(JSON.parse(json) as Record<string, unknown>).sort();
		expect(keys).toContain("scope_contract_sha256");
		if (skillMd.includes("SCOPE_CONTRACT")) {
			expect(skillMd).toContain(`${open}\`/\`${close}`);
		}
		for (const sentence of skillMd.matchAll(/It contains ((?:`[a-z_0-9]+`(?:,\s*(?:and\s+)?|\s+and\s+)?)+)/g)) {
			const named = [...sentence[1].matchAll(/`([a-z_0-9]+)`/g)].map((token) => token[1]).sort();
			expect(named).toEqual(keys);
		}
	});

	test("UG-2 Review base commit 줄 모양이 serializeReviewContext가 내보내는 줄과 같다", () => {
		planningContext();
		const sha = "a".repeat(40);
		const raw = state.readGoalState(SID) as { review_base_commit?: string };
		raw.review_base_commit = sha;
		writeFileSync(join(dir, `ultragoal-state-${SID}.json`), JSON.stringify(raw));
		const emitted = state.serializeReviewContext(SID).project_context.match(/^Review base commit: (\S+) — review the range (\S+) /m);
		expect(emitted).not.toBeNull();
		expect(emitted?.[1]).toBe(sha);
		// 문서가 같은 줄 모양을 적고, 범위를 <sha>...HEAD로 쓴다.
		const prefix = `Review base commit: ${"<sha>"} — `;
		const rangeShape = (emitted?.[2] ?? "").replace(sha, "<sha>");
		for (const mention of skillMd.matchAll(/Review base commit: <[^>]+> — /g)) {
			expect(mention[0]).toBe(prefix);
		}
		for (const mention of skillMd.matchAll(/`(<sha>\.\.\.\S+?)` as the range/g)) {
			expect(mention[1]).toBe(rangeShape);
		}
	});

	test("UG-3 intent payload 슬롯 키와 개수와 backfill 표지가 serializeReviewContext와 같다", () => {
		const keys = Object.keys(planningContext()).sort();
		for (const mention of skillMd.matchAll(/(\d+)-slot [^(\n]*\(((?:`[a-z_]+`\/?)+)\)/g)) {
			expect(Number(mention[1])).toBe(keys.length);
			expect([...mention[2].matchAll(/`([a-z_]+)`/g)].map((token) => token[1]).sort()).toEqual(keys);
		}
		// 모든 원본이 비면 필드는 BACKFILL_MARKER가 된다. 문서가 괄호 표지를 적었다면 같은 값이어야 한다.
		state.setGoalState(`${SID}-blank`, { phase: "planning" });
		expect(state.serializeReviewContext(`${SID}-blank`).what_was_implemented).toBe(state.BACKFILL_MARKER);
		for (const mention of skillMd.matchAll(/\(none provid\w*\)/g)) {
			expect(mention[0]).toBe(state.BACKFILL_MARKER);
		}
	});

	test("UG-4 문서에 적힌 모든 basis enum 사본이 코드가 수용하는 basis 집합과 같다", () => {
		const universe = ["requirement", "regression", "changed_code", "non_goal", "unrelated", "uncertain", "bogus_basis"];
		const artifactPath = join(dir, `ultragoal-codereview-${SID}.json`);
		const accepted = new Set<string>();
		for (const scope of ["IN_SCOPE", "OUT_OF_SCOPE", "UNKNOWN"]) {
			for (const basis of universe) {
				writeFileSync(
					artifactPath,
					JSON.stringify({
						status: "COMPLETE",
						scope_contract_sha256: "0".repeat(64),
						reviewer: "r",
						at: "2026-01-01T00:00:00Z",
						findings: [
							{
								class: "correctness",
								verdict: "CONFIRMED",
								impact: "HIGH",
								priority: "HIGH",
								assessment: { unfixed_cost: "a", exposure: "b", remedy: "c", added_cost: "d", rationale: "e" },
								scope,
								scope_evidence: { basis, reference: "outcome", rationale: "r" },
							},
						],
					}),
				);
				if (state.readCodeReviewArtifact(SID) !== null) accepted.add(basis);
			}
		}
		expect(accepted.size).toBeGreaterThan(0);
		for (const copy of skillMd.matchAll(/"basis":\s*"([a-z_ |]+)"/g)) {
			const documented = copy[1].split(/\s*\|\s*/).sort();
			expect(documented, copy[0]).toEqual([...accepted].sort());
		}
	});
});
