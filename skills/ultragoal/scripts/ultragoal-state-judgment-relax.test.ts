import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as state from "./ultragoal-state";

let dir: string;
const previousOmtDir = process.env.OMT_DIR;
const SID = "judgment-relax";

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ultragoal-judgment-relax-"));
	process.env.OMT_DIR = dir;
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (previousOmtDir === undefined) delete process.env.OMT_DIR;
	else process.env.OMT_DIR = previousOmtDir;
});

const artifactPath = () => join(dir, `ultragoal-codereview-${SID}.json`);

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		class: "correctness",
		verdict: "CONFIRMED",
		impact: "HIGH",
		priority: "HIGH",
		assessment: { unfixed_cost: "a", exposure: "b", remedy: "c", added_cost: "d", rationale: "e" },
		ref: "src/a.ts:1",
		scope: "IN_SCOPE",
		scope_evidence: { basis: "requirement", reference: "outcome", rationale: "in scope" },
		...overrides,
	};
}

function pursuing(): void {
	state.setGoalState(SID, { phase: "planning", outcome: "ship it", verification_surface: "v1" });
	state.setSingleStory(SID);
	state.setGoalState(SID, { phase: "pursuing" });
}

function writeArtifact(body: Record<string, unknown>): void {
	writeFileSync(artifactPath(), JSON.stringify({ reviewer: "r", at: "2026-09-09T00:00:00Z", ...body }));
}

describe("INCONCLUSIVE artifact keeps its findings", () => {
	test("findings are classified and grouped like COMPLETE while the verdict stays REQUEST_CHANGES", () => {
		pursuing();
		writeArtifact({
			status: "INCONCLUSIVE",
			scope_contract_sha256: state.scopeContractSha256(state.readGoalState(SID)!),
			findings: [
				finding({ ref: "block" }),
				finding({ ref: "fix", priority: "MEDIUM" }),
				finding({ ref: "note", priority: "LOW" }),
				finding({ ref: "unknown", scope: "UNKNOWN", scope_evidence: { basis: "uncertain", reference: "outcome", rationale: "x" } }),
			],
		});
		const result = state.getReviewResult(SID);
		expect(result.verdict).toBe("REQUEST_CHANGES");
		expect(result.reason).toBe("inconclusive review");
		expect(result.findings.repair.map((f) => f.ref).sort()).toEqual(["block", "fix"]);
		expect(result.findings.adjudicate.map((f) => f.ref)).toEqual(["unknown"]);
		expect(result.findings.notes.map((f) => f.ref)).toEqual(["note"]);
	});

	test("dismissals apply to an INCONCLUSIVE artifact too", () => {
		pursuing();
		writeArtifact({
			status: "INCONCLUSIVE",
			scope_contract_sha256: state.scopeContractSha256(state.readGoalState(SID)!),
			findings: [finding({ ref: "block" })],
		});
		expect(state.dismissReviewFinding(SID, { ref: "block", class: "correctness", rationale: "false positive" })).toBe(true);
		const result = state.getReviewResult(SID);
		expect(result.verdict).toBe("REQUEST_CHANGES");
		expect(result.findings.repair).toEqual([]);
	});

	test("INCONCLUSIVE may omit scope_contract_sha256 and is never completion eligible", () => {
		pursuing();
		writeArtifact({ status: "INCONCLUSIVE", findings: [finding()] });
		expect(state.readCodeReviewArtifact(SID)).not.toBeNull();
		const result = state.getReviewResult(SID);
		expect(result.verdict).toBe("REQUEST_CHANGES");
		expect(result.reason).toBe("inconclusive review");
		expect(result.findings.repair).toHaveLength(1);
		expect(state.validateReviewArtifact(SID).problems.join(" ")).not.toContain("stale");
	});

	test("a hashless INCONCLUSIVE artifact cannot be used to dismiss findings", () => {
		pursuing();
		writeArtifact({ status: "INCONCLUSIVE", findings: [finding({ ref: "block" })] });
		expect(state.dismissReviewFinding(SID, { ref: "block", class: "correctness", rationale: "x" })).toBe(false);
	});

	test("COMPLETE still requires the hash; a malformed hash is invalid for both statuses", () => {
		pursuing();
		writeArtifact({ status: "COMPLETE", findings: [] });
		expect(state.readCodeReviewArtifact(SID)).toBeNull();
		writeArtifact({ status: "INCONCLUSIVE", scope_contract_sha256: "nothex", findings: [] });
		expect(state.readCodeReviewArtifact(SID)).toBeNull();
	});

	test("a present INCONCLUSIVE hash that mismatches the contract is still stale", () => {
		pursuing();
		writeArtifact({ status: "INCONCLUSIVE", scope_contract_sha256: "0".repeat(64), findings: [finding()] });
		expect(state.getReviewResult(SID)).toMatchObject({ verdict: "REQUEST_CHANGES", reason: "stale scope contract" });
	});
});

describe("review_base_commit", () => {
	const head = () => spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
	const baseLine = (sha: string) => `Review base commit: ${sha} — review the range ${sha}...HEAD (this pursuit's own changes).`;

	test("pursuit start records the full HEAD sha and serialize-review-context emits the line", () => {
		pursuing();
		const sha = head();
		expect(sha).toMatch(/^[0-9a-f]{40}$/);
		expect((state.readGoalState(SID) as { review_base_commit?: string }).review_base_commit).toBe(sha);
		expect(state.serializeReviewContext(SID).project_context).toContain(baseLine(sha));
	});

	test("a later pursuing write does not move the base", () => {
		pursuing();
		const raw = state.readGoalState(SID) as { review_base_commit?: string };
		raw.review_base_commit = "a".repeat(40);
		writeFileSync(join(dir, `ultragoal-state-${SID}.json`), JSON.stringify(raw));
		state.setGoalState(SID, { phase: "pursuing", resume_summary: "again" });
		expect((state.readGoalState(SID) as { review_base_commit?: string }).review_base_commit).toBe("a".repeat(40));
	});

	test("a state without the field emits no base line and no placeholder", () => {
		state.setGoalState(SID, { phase: "planning", outcome: "ship it", verification_surface: "v1" });
		const context = state.serializeReviewContext(SID).project_context;
		expect(context).not.toContain("Review base commit");
	});

	test("without git the field is omitted with a stderr note", () => {
		const cwd = process.cwd();
		const notRepo = mkdtempSync(join(tmpdir(), "ultragoal-no-git-"));
		const err = spyOn(console, "error").mockImplementation(() => {});
		try {
			process.chdir(notRepo);
			pursuing();
			expect((state.readGoalState(SID) as { review_base_commit?: string }).review_base_commit).toBeUndefined();
			expect(err.mock.calls.flat().join(" ")).toContain("review_base_commit");
		} finally {
			process.chdir(cwd);
			err.mockRestore();
			rmSync(notRepo, { recursive: true, force: true });
		}
	});
});

describe("plan decision rules carry the whole ADR rule", () => {
	function rules(lines: string[]): string {
		const planPath = join(dir, "plan.md");
		writeFileSync(planPath, lines.join("\n"));
		state.setGoalState(SID, { phase: "planning", outcome: "ship it", plan_path: planPath });
		return state.serializeRequirements(SID);
	}

	test("blank lines inside Decision no longer end it; Owns and Must NOT own are appended", () => {
		const out = rules([
			"### D-1: Layering",
			"Decision: First paragraph.",
			"",
			"Second paragraph after a blank line.",
			"Owns: Parsing the flag.",
			"Must NOT own: HTTP parsing,",
			"or session context.",
			"Why: reasons.",
			"",
		]);
		expect(out).toContain(
			"[D-1] Layering — First paragraph. Second paragraph after a blank line. | Owns: Parsing the flag. | Must NOT own: HTTP parsing, or session context.",
		);
	});

	test("Decision ends at a --- separator or a heading; no Owns means no suffix", () => {
		const out = rules(["### D-2: A", "Decision: one", "", "two", "---", "stray text", "### D-3: B", "Decision: three", ""]);
		expect(out).toContain("[D-2] A — one two\n");
		expect(out).toContain("[D-3] B — three\n");
	});

	test("zero-parsed notice is kept", () => {
		expect(rules(["### D-4: No field", "Why: because", ""])).toContain("plan has 1 decision headings but none");
	});
});
