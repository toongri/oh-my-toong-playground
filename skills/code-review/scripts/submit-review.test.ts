import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { submitReviewArtifact } from "./submit-review.ts";

let dir: string;
const originalOmtDir = process.env.OMT_DIR;
const originalSessionId = process.env.OMT_SESSION_ID;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "submit-review-test-")); delete process.env.OMT_DIR; });
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	if (originalOmtDir === undefined) delete process.env.OMT_DIR;
	else process.env.OMT_DIR = originalOmtDir;
	if (originalSessionId === undefined) delete process.env.OMT_SESSION_ID;
	else process.env.OMT_SESSION_ID = originalSessionId;
});

function base(status: "COMPLETE" | "INCONCLUSIVE" = "COMPLETE"): string {
	return JSON.stringify({ status, reviewer: "reviewer", at: "now", findings: [], arbitrary: { kept: true } });
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		class: "correctness",
		verdict: "CONFIRMED",
		impact: "HIGH",
		priority: "HIGH",
		assessment: {
			unfixed_cost: "cost",
			exposure: "exposure",
			remedy: "remedy",
			added_cost: "added cost",
			rationale: "rationale",
		},
		...overrides,
	};
}

describe("중립 리뷰 publisher", () => {
	test("임의 destination을 수용하고 원본 바이트를 보존한다", () => {
		const path = join(dir, "opaque-result.json");
		const raw = `${base()}\n`;
		const receipt = submitReviewArtifact(path, raw);
		expect(receipt).toEqual({ path, sha256: createHash("sha256").update(raw).digest("hex") });
		expect(readFileSync(path, "utf8")).toBe(raw);
	});

	test("caller state를 읽지 않고 child context에서 SID를 추론하지 않는다", () => {
		const path = join(dir, "review-from-child.json");
		process.env.OMT_SESSION_ID = "child-sid";
		submitReviewArtifact(path, base());
		expect(existsSync(join(dir, "ultragoal-state-child-sid.json"))).toBe(false);
	});

	test("hashless INCONCLUSIVE와 scope 없는 generic finding을 수용한다", () => {
		const path = join(dir, "diagnostic.json");
		const raw = JSON.stringify({ status: "INCONCLUSIVE", reviewer: "r", at: "now", findings: [{ class: "correctness", verdict: "CONFIRMED", impact: "HIGH", ref: "a.ts:1" }] });
		expect(submitReviewArtifact(path, raw).path).toBe(path);
	});

	test("COMPLETE finding은 priority와 다섯 항목 assessment를 요구한다", () => {
		const path = join(dir, "complete.json");
		const raw = JSON.stringify({ status: "COMPLETE", reviewer: "r", at: "now", findings: [finding()] });
		expect(submitReviewArtifact(path, raw).path).toBe(path);
	});

	test("COMPLETE finding은 impact에서 priority를 추론하지 않는다", () => {
		const path = join(dir, "priority-required.json");
		const raw = JSON.stringify({ status: "COMPLETE", reviewer: "r", at: "now", findings: [{ ...finding(), priority: undefined }] });
		expect(() => submitReviewArtifact(path, raw)).toThrow();
	});

	test("INCONCLUSIVE finding은 새 필드를 생략할 수 있고 제공하면 검증한다", () => {
		const path = join(dir, "inconclusive.json");
		const omitted = JSON.stringify({ status: "INCONCLUSIVE", reviewer: "r", at: "now", findings: [finding({ priority: undefined, assessment: undefined })] });
		expect(submitReviewArtifact(path, omitted).path).toBe(path);
		const provided = JSON.stringify({ status: "INCONCLUSIVE", reviewer: "r", at: "now", findings: [finding()] });
		expect(submitReviewArtifact(path, provided).path).toBe(path);
	});

	test("malformed new fields cannot overwrite an existing artifact", () => {
		const path = join(dir, "existing-new-fields.json");
		const original = base();
		submitReviewArtifact(path, original);
		const malformed = JSON.stringify({ status: "COMPLETE", reviewer: "r", at: "now", findings: [finding({ assessment: { unfixed_cost: "" } })] });
		expect(() => submitReviewArtifact(path, malformed)).toThrow();
		expect(readFileSync(path, "utf8")).toBe(original);
	});

	test("malformed base JSON은 기존 아티팩트를 덮어쓰지 않는다", () => {
		const path = join(dir, "existing.json");
		const raw = base();
		submitReviewArtifact(path, raw);
		expect(() => submitReviewArtifact(path, "not-json")).toThrow();
		expect(readFileSync(path, "utf8")).toBe(raw);
	});
});
