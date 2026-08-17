import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const codeReviewerAgent = readFileSync(
	join(import.meta.dir, "../../agents/code-reviewer.md"),
	"utf8",
);

function extractSection(markdown: string, heading: string, nextHeading: string) {
	const start = markdown.indexOf(heading);
	const end = markdown.indexOf(nextHeading, start + heading.length);
	return markdown.slice(start, end === -1 ? undefined : end);
}

describe("code-review Terminal Output prose 계약", () => {
	test("`Terminal Output` keeps the handoff contract caller-agnostic", () => {
		const terminalOutput = extractSection(
			skillMd,
			"### Terminal Output",
			"## Reference Files (on-demand)",
		);

		expect(terminalOutput).not.toContain("review-report");
		expect(terminalOutput).toContain("ranked findings");
		expect(terminalOutput).toContain("handoff contract");
		expect(terminalOutput).toContain("do not invent a different format");
	});
});

describe("code-review direct finder-job contract", () => {
	const step4 = extractSection(skillMd, "## Step 4: Direct Finder-Job Dispatch", "## Step 5:");

	test("Step 4 is a concise invocationId contract", () => {
		expect(step4.split("\n").length).toBeLessThanOrEqual(46);
		expect(step4).toContain("fresh cryptographically random, path-safe `invocationId`");
		expect(step4).toContain("frozen invocation manifest");
		expect(step4).toContain("target, resolved launch context, chunk plan, and required job metadata");
		expect(step4).toContain("(invocationId, chunkId, attempt)");
		expect(step4).toContain("Start every chunk before polling");
		expect(step4).toContain("terminal infrastructure failure");
		expect(step4).toContain("If `invocationId` is lost, safely start a new independent review");
		expect(step4).toContain("Atomically persist `candidates.json` before `usage-summary`");
		expect(step4).toContain("exact serialization/quoting is left to implementation judgment");
	});

	test("Step 4 removes the superseded identity and lifecycle protocol", () => {
		for (const obsolete of [
			"scopeKey",
			"generation",
			"intentFingerprint",
			"finderFingerprint",
			"schemaVersion",
			"prepared",
			"recoverable",
			"retired",
			"quarantine",
			"content-addressed",
			"canonical effective launch manifest",
			"length-prefixed UTF-8",
		]) expect(step4).not.toContain(obsolete);
	});

	test("Step 4 uses direct job lifecycle and keeps finder dispatch delegated to CLIs", () => {
		expect(step4).not.toContain('subagent_type: "chunk-reviewer"');
		expect(step4).not.toMatch(/Task tool|Task wrapper/);
		expect(step4).toContain("direct `job.ts` job");
		expect(step4).toContain("existing direct finder CLIs");
		expect(step4).not.toContain('job.ts" clean');
	});

	test("candidate persistence precedes usage and defers shared-job cleanup to GC", () => {
		const persist = step4.indexOf("candidates.json");
		const usage = step4.indexOf("usage-summary");
		expect(persist).toBeGreaterThanOrEqual(0);
		expect(usage).toBeGreaterThan(persist);
		expect(step4).not.toContain('job.ts" clean');
		expect(step4).toContain("Leave job cleanup to GC/orphan reaper");
		expect(step4).toContain("Atomically persist `candidates.json`");
		expect(step4).toContain("frozen invocation manifest");
	});

	test("findings persistence belongs to Phase 3 and uses invocation-scoped paths", () => {
		expect(step4).not.toContain("then persist `findings.md` afterward");
		expect(skillMd).toContain("$OMT_DIR/code-review/<invocationId>/findings.md");
		expect(skillMd).not.toContain("<review-session-id>");
	});

	test("retry policy excludes polling/interruption and caps attempt two", () => {
		expect(step4).toContain("Attempt 2 is allowed once only");
		expect(step4).toContain("Poll progress, interruption, or a running/ready job is never a retry");
		expect(step4).toContain("partial coverage");
	});

	test("orchestrator uses hash-only diff exception and agent uses direct jobs", () => {
		expect(skillMd).toContain("never inspects, loads, or displays diff text");
		expect(skillMd).toContain(
			"stdout byte stream, which flows directly to SHA-256 outside model context",
		);
		expect(skillMd).not.toContain("unconditional prohibition");
		expect(codeReviewerAgent).toContain("direct finder-job lifecycle");
		expect(codeReviewerAgent).toContain("start/attach direct finder jobs");
		expect(codeReviewerAgent).not.toContain("chunk-reviewer dispatch");
		expect(codeReviewerAgent).not.toContain("dispatch chunk-reviewer agents");
		expect(codeReviewerAgent).toContain("do not start finder jobs");
	});

	test("aggregation contract is raw-field, reason-deduped, and angle-complete", () => {
		expect(step4).toContain("preserve all raw finder fields required by the aggregation contract");
		expect(step4).toContain("deduplicate candidates by normalized location and defect reason");
		expect(step4).toContain("union `found by` angles/evidence");
		expect(step4).toContain("one coverage record per configured angle");
		expect(step4).toContain("including unavailable angles");
	});
});

describe("code-review static-only premises", () => {
	test("review forbids project execution while retaining the post-change/system premises", () => {
		expect(skillMd).toContain("No diff-only review");
		expect(skillMd).toContain("working directory reflects the post-change state");
		expect(skillMd).toContain("Review is static-only");
		expect(skillMd).toContain("do not run tests, builds, linters");
	});
});
