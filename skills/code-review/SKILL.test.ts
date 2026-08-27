import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");
const codeReviewerAgent = readFileSync(
	join(import.meta.dir, "../../agents/code-reviewer.md"),
	"utf8",
);
const chunkReviewerPrompt = readFileSync(
	join(import.meta.dir, "../orchestrate-review/scripts/chunk-reviewer-prompt.md"),
	"utf8",
);
const verifierPrompt = readFileSync(
	join(import.meta.dir, "references/verifier-prompt.md"),
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
		expect(step4).toContain("argv-safe direct process execution");
		expect(step4).toContain("raw interpolation is forbidden");
		expect(step4).not.toContain("exact serialization/quoting is left to implementation judgment");
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

	test("orchestrator limits diff access to integrity and hashing while agent uses direct jobs", () => {
		expect(skillMd).toContain("never inspects, loads, or displays diff text");
		expect(skillMd).toContain(
			"stdout byte stream flows directly to SHA-256 outside model context",
		);
		expect(skillMd).toContain("candidate-scoped diff inspection exception");
		expect(skillMd).toContain("integrity judgment only");
		expect(skillMd).toContain("not forwarded to a finder prompt, candidate aggregation, or general orchestrator context");
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

describe("code-review runtime range command safety contract", () => {
	const contextBudget = extractSection(skillMd, "### Context Budget", "## Step 0:");
	const step0 = extractSection(skillMd, "## Step 0: Input Parsing", "## Step 1:");
	const step2 = extractSection(skillMd, "## Step 2: Context Gathering", "## Step 3:");

	test("describes allowed context output with argv-safe range arguments", () => {
		expect(contextBudget).toContain('`["git", "diff", range, "--stat"]` output');
		expect(contextBudget).toContain(
			'`["git", "diff", range, "--name-only", "-z", "--no-renames"]` output',
		);
		expect(contextBudget).toContain(
			'`["git", "diff", range, "--numstat", "-z", "--no-renames"]` output',
		);
		expect(contextBudget).toContain('`["git", "log", range, "--oneline"]` output');
	});

	test("uses argv-safe range arguments for early exit and context gathering", () => {
		expect(step0).toContain('Run `["git", "diff", range, "--stat"]` (using the range determined above)');
		expect(step2).toContain('`["git", "diff", range, "--stat"]` (change overview; not the scale input)');
		expect(step2).toContain(
			'`["git", "diff", range, "--name-only", "-z", "--no-renames"]` (file list)',
		);
		expect(step2).toContain(
			'`["git", "diff", range, "--numstat", "-z", "--no-renames"]` (per-file insertion/deletion counts)',
		);
		expect(step2).toContain('`["git", "log", range, "--oneline"]` (commit history)');
	});

	test("preserves arbitrary changed-file pathnames with NUL manifests", () => {
		expect(step2).not.toContain('`["git", "diff", range, "--name-only"]`');
		expect(step2).not.toContain('`["git", "diff", range, "--numstat"]`');
		expect(step2).toContain("Parse raw stdout as NUL-delimited records");
		expect(step2).toContain("Never use newline, line, or word splitting");
		expect(step2).toContain("never use shell command substitution");
		expect(step2).toContain("A name-only record is one path");
		expect(step2).toContain(
			"a numstat record splits only its first two tab fields while preserving the remainder as the path",
		);
		expect(step2).toContain("newline, tab, quote, and backslash filenames");
		expect(step2).toContain("`--no-renames` avoids old/new pair ambiguity");
	});

	test("requires safe dynamic command construction and forbids raw range interpolation", () => {
		expect(step0).toContain(
			"All subsequent commands that receive range or path values must use argv-safe arguments",
		);
		expect(step0).toContain("if Bash is required, quote each dynamic value as a separate argument");
		expect(skillMd).not.toContain("git diff {range} -- <candidate-path>");
		expect(skillMd).not.toContain("git diff {range} -- <files>");
		expect(skillMd).not.toMatch(/git (?:diff|log) \{range\}/);
	});
});

describe("code-review Step 3 partition and scale contract", () => {
	const step2 = extractSection(skillMd, "## Step 2: Context Gathering", "## Step 3:");
	const step3 = extractSection(skillMd, "## Step 3: Chunking Decision", "## Step 4:");
	const step4 = extractSection(skillMd, "## Step 4: Direct Finder-Job Dispatch", "## Step 5:");

	test("partitions before scale and derives reviewable file and insertion counts", () => {
		const partition = step3.indexOf("### Derived-artifact partition (runs first)");
		const derive = step3.indexOf("derive `reviewableFileCount`");
		const scale = step3.indexOf("### Scale");

		expect(partition).toBeGreaterThanOrEqual(0);
		expect(derive).toBeGreaterThanOrEqual(0);
		expect(step3).toContain("`reviewableInsertionLines` from their `--numstat` insertion counts");
		expect(partition).toBeLessThan(derive);
		expect(derive).toBeLessThan(scale);
	});

	test("uses the reviewable subset for both scale thresholds", () => {
		const scale = extractSection(step3, "### Scale", "### Per-Chunk Diff Command Construction");

		expect(scale).toContain("`reviewableInsertionLines` < 2000");
		expect(scale).toContain("`reviewableFileCount` < 30");
		expect(scale).not.toContain("changed files < 30");
		expect(scale).not.toContain("changed files >= 30");
	});

	test("handles an empty reviewable subset without dispatching an empty review", () => {
		const zeroScope = step3.indexOf("### Zero-reviewable-files review");
		const diffCommand = step3.indexOf("### Per-Chunk Diff Command Construction");

		expect(zeroScope).toBeGreaterThanOrEqual(0);
		expect(step3).toContain("valid zero-reviewable-files review");
		expect(step3).toContain("If `reviewableFileCount` is 0");
		expect(step3).toContain("do not dispatch a finder job");
		expect(step3).toContain("do not create an empty chunk or pathless diff");
		expect(step3).toContain("all changed derived artifacts under Out of Scope");
		expect(zeroScope).toBeLessThan(diffCommand);
	});

	test("checks derived-output integrity before exclusion and path-filtered commands", () => {
		const integrity = step3.indexOf("### Derived-output integrity (before exclusion)");
		const exclusion = step3.indexOf("**Handling:** derived artifacts are excluded");
		const pathFilteredCommand = step3.indexOf("### Per-Chunk Diff Command Construction");

		expect(integrity).toBeGreaterThanOrEqual(0);
		expect(step3).toContain("complete changed-file manifest");
		expect(step3).toContain("output is meaningful, stale, manually altered, or otherwise unexplained");
		expect(step3).toContain("Re-included outputs are reviewed as exact files instead");
		expect(step3).toContain("before any path-filtered finder command");
		expect(integrity).toBeLessThan(exclusion);
		expect(integrity).toBeLessThan(pathFilteredCommand);
	});

	test("routes integrity comparison through a candidate-scoped diff inspection", () => {
		const integrity = extractSection(
			step3,
			"### Derived-output integrity (before exclusion)",
			"### Zero-reviewable-files review",
		);

		expect(integrity).toContain("each candidate derived file in the complete changed-file manifest");
		expect(integrity).toContain("Execute this candidate-scoped diff through Bash");
		expect(integrity).toContain("argv-safe direct process execution");
		expect(integrity).toContain(
			'["git", "--literal-pathspecs", "diff", "--binary", "--no-ext-diff", "--no-textconv", range, "--", candidatePath]',
		);
		expect(integrity).toContain(
			'git --literal-pathspecs diff --binary --no-ext-diff --no-textconv "$range" -- "$candidatePath"',
		);
		expect(integrity).not.toContain('["git", "diff", range, "--", candidatePath]');
		expect(integrity).not.toContain('git diff "$range" -- "$candidatePath"');
		expect(integrity).toContain("quote the diff range and candidate path as separate arguments");
		expect(integrity).toContain("Raw interpolation is forbidden");
		expect(integrity).not.toContain("git diff {range} -- <candidate-path>");
		expect(integrity).toContain(
			"`--` is only the revision/pathspec separator; it does not disable Git pathspec magic, external diff drivers, or textconv filters",
		);
		expect(integrity).toContain("`--literal-pathspecs` must be before `diff`");
		expect(integrity).toContain("`--no-ext-diff` and `--no-textconv`");
		expect(integrity).toContain("not shell escaping");
		expect(integrity).toContain("including `:(exclude)*`");
		expect(integrity).toContain("authored source/generator evidence");
		expect(integrity).toContain("candidate-scoped diff inspection exception");
		expect(integrity).toContain("integrity judgment only");
		expect(integrity).toContain(
			"not forwarded to a finder prompt, candidate aggregation, or general orchestrator context",
		);
	});

	test("constructs path-filtered chunk diffs with safe arguments", () => {
		const chunkDiff = extractSection(
			step3,
			"### Per-Chunk Diff Command Construction",
			"## Step 4:",
		);

		expect(chunkDiff).toContain("argv-safe direct process execution");
		expect(chunkDiff).toContain(
			'["git", "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", range, "--", ...chunkPaths]',
		);
		expect(chunkDiff).toContain(
			'git --literal-pathspecs diff --no-ext-diff --no-textconv "$range" -- "$file1" "$file2" ... "$fileN"',
		);
		expect(chunkDiff).not.toContain("--binary");
		expect(chunkDiff).not.toContain('["git", "diff", range, "--", ...chunkPaths]');
		expect(chunkDiff).not.toContain('git diff "$range" -- "$file1" "$file2" ... "$fileN"');
		expect(chunkDiff).toContain("quote the diff range and every chunk path as separate arguments");
		expect(chunkDiff).toContain("Raw interpolation is forbidden");
		expect(chunkDiff).not.toContain("git diff {range} -- <file1> <file2> ... <fileN>");
		expect(chunkDiff).toContain(
			"`--` is only the revision/pathspec separator; it does not disable Git pathspec magic, external diff drivers, or textconv filters",
		);
		expect(chunkDiff).toContain("`--literal-pathspecs` must be before `diff`");
		expect(chunkDiff).toContain("`--no-ext-diff` and `--no-textconv`");
		expect(chunkDiff).toContain("not shell escaping");
	});

	test("separates the complete manifest from the post-integrity reviewable finder scope", () => {
		expect(step3).toContain("`completeChangedFileManifest`");
		expect(step3).toContain("`reviewableFileList`");
		expect(step3).toContain("Never substitute one for the other");
		expect(step4).toContain("{FILE_LIST} to the current chunk's reviewable files only");
		expect(step4).toContain("{DIFF_COMMAND} is constructed from that same chunk list");
		expect(step4).toContain(
			"Never pass the complete changed-file manifest or derived-artifact Out of Scope list as finder scope",
		);
	});

	test("reports binary-only paths under Out of Scope before the quick exit", () => {
		const earlyExit = extractSection(skillMd, "### Early Exit", "## Step 1:");
		const binary = earlyExit.indexOf("If the diff is binary-only");
		const outOfScope = earlyExit.indexOf("list every binary changed path under Out of Scope");
		const noFinder = earlyExit.indexOf("do not dispatch a finder job");
		const exit = earlyExit.indexOf("then exit");

		expect(earlyExit).toContain(
			'If empty diff: report "No changes detected (between <base> and <target>)" and exit immediately',
		);
		expect(earlyExit).not.toContain("If binary-only diff: report \"Only binary file changes detected\" and exit");
		expect(binary).toBeGreaterThanOrEqual(0);
		expect(outOfScope).toBeGreaterThan(binary);
		expect(noFinder).toBeGreaterThan(outOfScope);
		expect(exit).toBeGreaterThan(noFinder);
	});

	test("requires evidence before excluding declarations and scales authored declarations", () => {
		expect(step3).toContain("A `.d.ts` is excluded only with generated evidence");
		expect(step3).toContain("an authored `.d.ts` remains reviewable");
		expect(step3).toContain("contributes to `reviewableInsertionLines`");
		expect(step3).not.toContain("`*.d.ts`");
	});

	test("labels argv-safe --stat as context rather than the scale input", () => {
		expect(step2).not.toContain("`git diff {range} --stat` (change scale)");
		expect(step2).toContain(
			'`["git", "diff", range, "--stat"]` (change overview; not the scale input)',
		);
	});
});

describe("code-review Phase 2 verifier diff safety contract", () => {
	test("uses separate literal argv values and keeps verifier read-only", () => {
		expect(verifierPrompt).toContain(
			'["git", "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "{RANGE}", "--", "{CANDIDATE_FILE}"]',
		);
		expect(verifierPrompt).toContain("{RANGE} and {CANDIDATE_FILE} are separate argv values");
		expect(verifierPrompt).not.toContain("git diff {RANGE} -- {CANDIDATE_FILE}");
		expect(verifierPrompt).not.toMatch(/git diff\s+\{RANGE\}.*\{CANDIDATE_FILE\}/);
		expect(verifierPrompt).toContain("READ-ONLY.");
		expect(verifierPrompt).toContain("Do not edit, write, or modify any file");
	});
});

describe("chunk-reviewer prompt scope and section order contract", () => {
	test("keeps the review sections ordered and binds placeholders to the chunk reviewable list", () => {
		const headings = [
			"## Review Scope",
			"## What Was Implemented",
			"## Requirements/Plan",
			"## Project Context",
			"## Non-Goals",
			"## Diff Command",
		];
		let previous = -1;

		for (const heading of headings) {
			const position = chunkReviewerPrompt.indexOf(heading);
			expect(position).toBeGreaterThan(previous);
			previous = position;
		}

		expect(chunkReviewerPrompt).toContain(
			"{FILE_LIST} is the chunk's post-integrity reviewable file list, not the complete changed-file manifest",
		);
		expect(chunkReviewerPrompt).toContain(
			"The complete changed-file manifest and derived-artifact Out of Scope list are not finder scope",
		);
		expect(chunkReviewerPrompt).toContain(
			"This command was constructed from this chunk's reviewable files only",
		);
		expect(chunkReviewerPrompt).toContain(
			"Step 3 reviewableFileList (current chunk only; not the complete changed-file manifest)",
		);
		expect(chunkReviewerPrompt).toContain(
			"Step 3 — constructed from range + current chunk's reviewable file list",
		);
	});
});
