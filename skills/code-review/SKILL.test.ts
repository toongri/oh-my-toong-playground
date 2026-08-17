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

	test("review identity includes the canonical five-slot intent fingerprint", () => {
		expect(step4).toContain("canonical intent fingerprint");
		for (const slot of [
			"WHAT_WAS_IMPLEMENTED",
			"DESCRIPTION",
			"REQUIREMENTS",
			"PROJECT_CONTEXT",
			"NON_GOAL",
		]) {
			expect(step4).toContain(slot);
		}
		expect(step4).toContain(
			"reviewId = H(worktreeRealpath + NL + baseSha + NL + headSha + NL + intentFingerprint + NL + generation + NL)",
		);
		expect(step4).toContain("invocation-fresh");
		expect(step4).toContain("one reviewId shared across all chunks");
	});

	test("Step 4 uses direct job lifecycle and keeps finder dispatch delegated to CLIs", () => {
		expect(step4).not.toContain('subagent_type: "chunk-reviewer"');
		expect(step4).not.toMatch(/Task tool|Task wrapper/);
		expect(step4).toContain('job.ts" start');
		expect(step4).toContain('job.ts" collect');
		expect(step4).toContain('job.ts" results');
		expect(step4).not.toContain('job.ts" clean');
		expect(step4).toContain("configured finder CLIs");
	});

	test("identity flags and deterministic chunk fingerprint are explicit", () => {
		for (const flag of [
			"--review-id",
			"--chunk-key",
			"--attempt 1",
			"--worktree-realpath",
			"--base-sha",
			"--head-sha",
			"--diff-fingerprint",
		]) {
			expect(step4).toContain(flag);
		}
		expect(step4).toContain("sort its file list");
		expect(step4).toContain("SHA-256");
		expect(step4).toContain("review-session-id");
		expect(step4).toContain('realpath "$(git rev-parse --show-toplevel)"');
		expect(step4).toContain("git rev-parse --verify");
		expect(step4).toContain("git merge-base <baseSha> <headSha>");
		expect(step4).not.toContain("git merge-base --verify");
		expect(step4).toContain("joined by NL, followed by NL");
		expect(step4).toContain("git diff --no-ext-diff --binary <mergeBase> <headSha>");
		expect(step4).toContain("mergeBase");
		expect(step4).toContain("single chunk and for every multi-chunk file list");
		expect(step4).not.toContain("git diff --no-ext-diff --binary <baseSha> <headSha>");
		expect(step4).toContain("Exclude stderr");
		expect(step4).toContain("nonzero diff exit aborts");
	});

	test("polling allows the full finder runtime and treats poll_again as progress", () => {
		expect(step4).toContain("--timeout-ms 20000");
		expect(step4).toContain("--timeout 2700");
		expect(step4).toContain("2700 seconds (45 minutes)");
		expect(step4).toContain("poll_again");
		expect(step4).toContain("Codex keeps polling in-turn");
	});

	test("candidate persistence precedes usage and defers shared-job cleanup to GC", () => {
		const persist = step4.indexOf("candidates.json");
		const usage = step4.indexOf("usage-summary");
		expect(persist).toBeGreaterThanOrEqual(0);
		expect(usage).toBeGreaterThan(persist);
		expect(step4).not.toContain('job.ts" clean');
		expect(step4).toContain("identity-backed job directories are shared");
		expect(step4).toContain("stale-job GC/orphan-reaper cleanup");
		expect(step4).toContain("atomically");
		expect(step4).toContain("recovery artifact");
	});

	test("completed reviews retire the recovery artifact before returning", () => {
		expect(step4).toContain('update `lifecycle` to `"retired"`');
		expect(step4).toContain("A retired artifact never skips finder starts");
		expect(step4).toContain("after `findings.md` is durably written");
	});

	test("independent invocations get a fresh finder generation", () => {
		expect(step4).toContain("fresh finder generation");
		expect(step4).toContain("generation/nonce");
		expect(step4).toContain("independent invocation");
		expect(step4).toContain("retired artifact never reuses");
		expect(step4).toContain("reviewId or start identity");
	});

	test("recovery generation is durable before finder start and prepared/recoverable state reuses it", () => {
		expect(step4).toContain("durably record");
		expect(step4).toContain("before any finder start");
		expect(step4).toContain("prepared or recoverable");
		expect(step4).toContain("same generation");
	});

	test("recovery locator is stable before generation and paths are unified", () => {
		expect(step4).toContain("scopeKey = H(worktreeRealpath + NL + baseSha + NL + headSha + NL + intentFingerprint + NL)");
		expect(step4).toContain("$OMT_DIR/code-review/<scopeKey>/");
		expect(step4).toContain("candidates.json");
		expect(step4).toContain("findings.md");
		expect(step4).toContain("never `<reviewId>`");
	});

	test("prepared schema supports interruption before the first finder", () => {
		expect(step4).toContain('"schemaVersion": 2');
		expect(step4).toContain('"lifecycle": "prepared"');
		expect(step4).toContain('"attempts": []');
		expect(step4).toContain("terminalState` required only for terminal states");
	});

	test("scope initialization is serialized and recovery attaches idempotently", () => {
		expect(step4).toContain("scopeKey-scoped atomic lock/CAS");
		expect(step4).toContain("concurrent invocations cannot overwrite");
		expect(step4).toContain("Prepared/recoverable recovery");
		expect(step4).toContain("exact identity");
		expect(step4).toContain("same generation and reviewId");
	});

	test("prepared and recoverable artifacts both authorize generation reuse", () => {
		expect(step4).not.toContain("only an interrupted recoverable invocation may reuse it");
		expect(step4).toContain("prepared or recoverable");
		expect(step4).toContain("valid prepared/recoverable artifact");
	});

	test("prepared schema keeps attempts empty per chunk until transition", () => {
		expect(step4).toContain("every prepared chunk `attempts` MUST be empty");
		expect(step4).toContain("After the first successful or idempotent finder start");
		expect(step4).toContain("transition lifecycle to `recoverable`");
		expect(step4).toContain('"chunks": [{"chunkKey": "…", "diffFingerprint": "…", "attempts": []}]');
		expect(step4).not.toContain('"lifecycle": "prepared",\n     "attempts": [],');
	});

	test("obsolete lifecycle and reviewId-path rules are absent", () => {
		for (const obsolete of [
			"only interrupted recoverable state reuses generation",
			"Validate schemaVersion, `lifecycle === \"recoverable\"`",
			"A valid artifact skips all starts only when its lifecycle is recoverable",
			"a missing artifact reuses only validated jobs/results",
			"create a fresh recoverable artifact with a fresh generation",
			"reuse the same generation from the recoverable artifact",
			"$OMT_DIR/code-review/<reviewId>/candidates.json",
			"If the turn is interrupted earlier, leave it recoverable",
		]) expect(step4).not.toContain(obsolete);
		expect(step4).toContain('"scopeKey": "…"');
	});

	test("attempt cardinality is lifecycle-qualified", () => {
		expect(step4).not.toContain("Each chunk's attempts are unique and contiguous, exactly `[1]` or `[1,2]`");
		expect(step4).toContain("every prepared chunk `attempts` MUST be empty");
		expect(step4).toContain("recoverable attempt numbers are unique and contiguous, exactly `[1]` or `[1,2]`");
	});

	test("retry policy excludes polling/interruption and caps attempt two", () => {
		expect(step4).toContain("--attempt 2");
		expect(step4).toContain("at most once");
		expect(step4).toContain("poll_again");
		expect(step4).toContain("caller-turn interruption");
		expect(step4).toContain("running`/`ready");
		expect(step4).toContain("partial coverage");
		expect(step4).toContain("different full tuple");
		expect(step4).toContain("changing only `attempt 1` to `attempt 2`");
	});

	test("initializing recovery and candidates artifact schema are explicit", () => {
		expect(step4).toContain("identity job is still initializing");
		expect(step4).toContain("validate that job's `job.json` identity");
		expect(step4).toContain("never start, delete, or respawn it");
		expect(step4).toContain('"schemaVersion": 2');
		expect(step4).toContain('"lifecycle": "prepared"');
		expect(step4).toContain('"attempts": []');
		expect(step4).toContain('"expectedChunks"');
		expect(step4).toContain('"attempts"');
		expect(step4).toContain("unique and contiguous");
		expect(step4).toContain("exactly `[1]` or `[1,2]`");
		expect(step4).toContain("persisted `[1,2]` never respawns");
		expect(step4).toContain("same-directory temporary file");
		expect(step4).toContain("flush/fsync");
		expect(step4).toContain("Valid prepared or recoverable artifact authorizes exact attach or skip");
		expect(step4).toContain("invalid artifact is reported/quarantined");
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
		for (const field of ["file", "line", "summary", "failure_scenario"]) {
			expect(step4).toContain(`\`${field}\``);
		}
		expect(step4).toContain("defect reason match (not title)");
		expect(step4).toContain("union unique `found by` angles/evidence");
		expect(step4).toContain("one coverage record per configured angle");
		expect(step4).toContain("explicitly marking unavailable angles");
		expect(step4).toContain("Do not read the protected orchestrate-review/SKILL.md");
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
