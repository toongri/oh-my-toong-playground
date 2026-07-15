import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Step-1 static regression for the craft-issue checklist review gate.
//
// Covers the shared contract between:
//   - agents/issue-reviewer.md   (new, READ-ONLY reviewer subagent)
//   - skills/craft-issue/references/issue-craft.md (Request-Coverage Rule +
//     Decisions Needed label-bullet restructure)
//   - projects/oh-my-toong/sync.yaml (F2: every registered agent has a file)
//
// SKILL.md gate wiring (B/D/G literals, A6, A8) is a LATER step (step-4) and
// is deliberately NOT asserted here — `make sync` runs the full test suite
// before `bun run tools/sync.ts`, so a step-1 assertion on unwritten SKILL.md
// literals would fail the whole sync pipeline before this task's files ever
// deploy.
//
// Each LIT below is its own assertion (no bundling by AC id) so a failure
// names the exact missing literal.
// ---------------------------------------------------------------------------

const repoRoot = join(import.meta.dir, "..", "..");
const reviewerMd = readFileSync(join(repoRoot, "agents/issue-reviewer.md"), "utf8");
const issueCraftMd = readFileSync(join(import.meta.dir, "references/issue-craft.md"), "utf8");

describe("A1: agents/issue-reviewer.md frontmatter", () => {
	test("declares name: issue-reviewer", () => {
		expect(reviewerMd).toMatch(/^name: issue-reviewer$/m);
	});

	test("declares a non-empty description field", () => {
		expect(reviewerMd).toMatch(/^description: \S.+$/m);
	});

	test("declares tools: Read, Glob, Grep exactly", () => {
		expect(reviewerMd).toMatch(/^tools: Read, Glob, Grep$/m);
	});

	test("declares model: opus", () => {
		expect(reviewerMd).toMatch(/^model: opus$/m);
	});

	test("never grants Write, Edit, or Bash on the tools line", () => {
		expect(reviewerMd).not.toMatch(/^tools:.*(Write|Edit|Bash)/m);
	});
});

describe("A2: reviewer output contract", () => {
	test("PASS status literal", () => {
		expect(reviewerMd).toContain("**Status:** PASS");
	});

	test("REQUEST_CHANGES status literal", () => {
		expect(reviewerMd).toContain("**Status:** REQUEST_CHANGES");
	});

	test("Rule field label", () => {
		expect(reviewerMd).toContain("**Rule:**");
	});

	test("Where field label", () => {
		expect(reviewerMd).toContain("**Where:**");
	});

	test("Offending field label", () => {
		expect(reviewerMd).toContain("**Offending:**");
	});

	test("Why field label", () => {
		expect(reviewerMd).toContain("**Why:**");
	});

	test("PASS-silence instruction", () => {
		expect(reviewerMd).toContain("On PASS, emit the Status line and nothing else");
	});

	test("descending-severity instruction", () => {
		expect(reviewerMd).toContain("Emit findings in descending severity.");
	});

	test("Offending three-field pipe format", () => {
		expect(reviewerMd).toContain(
			"**Offending:** <target> | <locator> | <verbatim quote, or the word absent>",
		);
	});
});

describe("A2b: citation norms (8)", () => {
	test("norm 1 — headings and row/field labels quoted verbatim", () => {
		expect(reviewerMd).toContain("Quote headings and row/field labels verbatim from the rule file");
	});

	test("norm 2 — section over duplicated table row", () => {
		expect(reviewerMd).toContain("cite the section, not the row");
	});

	test("norm 3 — › only for table rows/bullets, dedicated section is heading-only", () => {
		expect(reviewerMd).toContain("a dedicated section is cited by its heading alone, with no › suffix");
	});

	test("norm 4 — missing/misplaced/mislabeled section cites Standard Body Shape", () => {
		expect(reviewerMd).toContain("### Standard Body Shape");
	});

	test("norm 5 — in-section content violation cites the content rule, not the shape rule", () => {
		expect(reviewerMd).toContain(
			"cited by that section's own content rule, not by the shape rule that governs whether the section exists",
		);
	});

	test("norm 6 — untriggered section emission cites Lean by Default", () => {
		expect(reviewerMd).toContain("### Lean by Default");
	});

	test("norm 7 — absent-class violation cites target + expected location + the word absent", () => {
		expect(reviewerMd).toContain(
			"an absent-class violation is cited by target + the location it was expected at + the word absent in the Offending field",
		);
	});

	test("norm 8 — payload contract is the sole non-rule-file Rule value", () => {
		expect(reviewerMd).toContain(
			"reserved for a Stage-6 payload defect, never repurposed for a rule-file citation",
		);
	});
});

describe("A5: verification-method breadth (anti metis-style strictness)", () => {
	test("test/query/manual-step are all valid verification methods", () => {
		expect(reviewerMd).toContain("a test, a query, or a manual step are ALL valid verification methods.");
	});

	test("do not apply an agent-executable-only standard", () => {
		expect(reviewerMd).toContain("Do not apply an agent-executable-only standard.");
	});
});

describe("A7: SSOT guard — no embedded rule text", () => {
	test("instructs reading rule files at dispatch time instead of copying rule text", () => {
		expect(reviewerMd).toContain("Do not copy rule text into this file. Read the rule files at dispatch time.");
	});
});

describe("A9: payload precondition", () => {
	test("requires one labeled block per child, repeating the child:<title-slug> label", () => {
		expect(reviewerMd).toContain(
			"One labeled block per child: repeat the child:<title-slug> label N times for N children.",
		);
	});

	test("missing block cites Rule: payload contract", () => {
		expect(reviewerMd).toContain("**Rule:** payload contract");
	});

	test("incomplete payload forbids PASS", () => {
		expect(reviewerMd).toContain(
			"An incomplete payload (any of the three blocks missing) is a payload contract violation and PASS is forbidden.",
		);
	});
});

describe("A10: corpus scoping", () => {
	test("checklist scope is issue-authoring rules only", () => {
		expect(reviewerMd).toContain(
			"The checklist you enforce is the issue-authoring rules in `SKILL.md` and `references/issue-craft.md`",
		);
	});

	test("gate/loop mechanics are writer instructions, never cited", () => {
		expect(reviewerMd).toContain(
			"Gate and loop mechanics that govern how many times you get dispatched (`max_cycles`, `Same-Rule-3x`, and similar loop-control language) are instructions to the writer, not content to cite against the reviewed issue",
		);
	});

	test("rule files themselves are never the review target", () => {
		expect(reviewerMd).toContain(
			"never cite the rule files themselves (`SKILL.md` structure, `issue-craft.md` section/meta text) as if they were part of the issue under review",
		);
	});
});

describe("C1: Request-Coverage Rule heading — issue-craft.md SSOT, absent from reviewer", () => {
	test("exists in issue-craft.md", () => {
		expect(issueCraftMd).toContain("### Request-Coverage Rule");
	});

	test("is absent from agents/issue-reviewer.md", () => {
		expect(reviewerMd).not.toContain("### Request-Coverage Rule");
	});
});

describe("C2: Request-Coverage Rule label bullets", () => {
	test("Coverage bullet label", () => {
		expect(issueCraftMd).toContain("- **Coverage** — ");
	});

	test("Non-Goals justification bullet label", () => {
		expect(issueCraftMd).toContain("- **Non-Goals justification** — ");
	});

	test("Standalone scoring bullet label", () => {
		expect(issueCraftMd).toContain("- **Standalone scoring** — ");
	});

	test("Delta from Coverage gap bullet, full text", () => {
		expect(issueCraftMd).toContain(
			"- **Delta from Coverage gap** — the slice-seam row compares the child set against the parent's own requirements; this rule compares the original request against the issue set.",
		);
	});

	test("Cite only one. instruction", () => {
		expect(issueCraftMd).toContain("Cite only one.");
	});
});

describe("C3: Decisions Needed label-bullet restructure", () => {
	test("No pre-solving bullet present", () => {
		expect(issueCraftMd).toContain(
			"- **No pre-solving** — name the decision and the issue or owner it is delegated to; do not state any option as chosen.",
		);
	});

	test("Research-backed alternatives bullet present", () => {
		expect(issueCraftMd).toContain(
			"- **Research-backed alternatives** — an alternatives table (option / pros / cons / source URL) and a recommendation are permitted; a decision is not.",
		);
	});

	test("proposal marker present", () => {
		expect(issueCraftMd).toContain("proposal — not decided in this issue");
	});

	test("Model-A intent ban sentence present", () => {
		expect(issueCraftMd).toContain(
			"The Model-A intent ban applies: naming the open question and its owner is allowed; embedding the answer is not.",
		);
	});

	test("the old bold-prose sentence is gone (replaced by label bullets)", () => {
		expect(issueCraftMd).not.toContain("**Entries must not pre-solve.**");
	});
});

// ---------------------------------------------------------------------------
// F2: every agent registered in projects/oh-my-toong/sync.yaml has a source
// file at agents/<name>.md. Parsed directly (no sync.local.yaml merge) so the
// result is identical on every machine, not just the author's.
//
// RED coverage (both provable by deleting/renaming, not asserted at runtime
// here since that would mutate repo state as a side effect of `bun test`):
//   (a) an agents/<name>.md file referenced by sync.yaml is deleted — the
//       existsSync check below fails for that item.
//   (b) sync.yaml lists a name with no matching agents/<name>.md file — same
//       existsSync check fails.
// Both RED cases are covered by the SAME per-item assertion below: any
// registered item with no backing file fails its own named test.
// ---------------------------------------------------------------------------

type RawSyncItem = string | { component?: unknown; [key: string]: unknown };

function itemComponentName(item: RawSyncItem): string | null {
	if (typeof item === "string") return item;
	if (item && typeof item === "object" && typeof item.component === "string") return item.component;
	return null;
}

describe("F2: projects/oh-my-toong/sync.yaml agents.items all resolve to a real file", () => {
	const syncYamlPath = join(repoRoot, "projects/oh-my-toong/sync.yaml");
	const syncYamlText = readFileSync(syncYamlPath, "utf8");
	const parsed = Bun.YAML.parse(syncYamlText) as {
		agents?: { items?: RawSyncItem[] };
	};
	const items = parsed.agents?.items ?? [];

	test("agents.items is non-empty (positive control — an empty list would make the loop below vacuous)", () => {
		expect(items.length).toBeGreaterThan(0);
	});

	for (const item of items) {
		const name = itemComponentName(item);
		test("agents/" + String(name) + ".md exists for registered item " + String(name), () => {
			expect(name).not.toBeNull();
			expect(existsSync(join(repoRoot, "agents", name + ".md"))).toBe(true);
		});
	}
});

// ---------------------------------------------------------------------------
// Step-4 static regression for the craft-issue checklist review gate.
//
// Covers skills/craft-issue/SKILL.md gate wiring: the new
// "### Checklist Review Gate (before any write)" section, its ordering
// relative to the pre-existing Plain-Language Gate and Abstract write steps,
// the loop contract (max_cycles=5, Same-Rule-3x), the terminal write-anyway
// path, and the Stage 3 design-research trigger.
//
// Two literals below (B5's RULES_RESOLVED bash line, B2's Skill(humanizer)
// sentence) contain `${...}` and backticks respectively — they are authored
// as plain quoted strings, never JS template literals, so the test file
// itself never attempts to interpolate them.
//
// Each LIT below is its own assertion (no bundling by AC id) so a failure
// names the exact missing literal.
// ---------------------------------------------------------------------------

const skillMd = readFileSync(join(import.meta.dir, "SKILL.md"), "utf8");

function lineOf(content: string, literal: string): number {
	return content.split("\n").findIndex((line) => line.includes(literal));
}

describe("B1: Checklist Review Gate sits between Plain-Language Gate and Abstract write steps", () => {
	test("Plain-Language Gate heading precedes Checklist Review Gate heading precedes Abstract write steps", () => {
		const plainGateLine = lineOf(skillMd, "### Plain-Language Gate (before any write)");
		const checklistGateLine = lineOf(skillMd, "### Checklist Review Gate (before any write)");
		const abstractStepsLine = lineOf(skillMd, "Abstract write steps (in order):");
		expect(plainGateLine).toBeGreaterThanOrEqual(0);
		expect(checklistGateLine).toBeGreaterThan(plainGateLine);
		expect(abstractStepsLine).toBeGreaterThan(checklistGateLine);
	});
});

describe("B2: revision re-runs the Plain-Language Gate before re-dispatch", () => {
	test("Re-run the Plain-Language Gate (including Skill(humanizer)) sentence", () => {
		expect(skillMd).toContain(
			"Re-run the Plain-Language Gate (including `Skill(humanizer)`) on the revised body before re-dispatching.",
		);
	});
});

describe("B3: dispatch payload assembly", () => {
	test("Preserve the raw request verbatim", () => {
		expect(skillMd).toContain("Preserve the raw request verbatim");
	});

	test("Dispatch payload header", () => {
		expect(skillMd).toContain("Dispatch payload (inline text, not file paths):");
	});

	test("Rule files passed as the two RULES_RESOLVED paths", () => {
		expect(skillMd).toContain("Rule files are passed as the two absolute paths printed by the RULES_RESOLVED step.");
	});
});

describe("B4: post-hoc contract correction", () => {
	test("Stage 6 intro names the Checklist Review Gate as the agent gate", () => {
		expect(skillMd).toContain("No pre-write human approval gate — the Checklist Review Gate is an agent gate.");
	});

	test("post-hoc review sentence names the Checklist Review Gate as pre-write", () => {
		expect(skillMd).toContain(
			"Human review is post-hoc: the issue is written first; the caller can review and request changes afterward. The Checklist Review Gate above is an agent gate and runs before the write.",
		);
	});

	test("pipeline diagram write-tail node names the gate", () => {
		expect(skillMd).toContain("→ write tail    (checklist gate → autonomous write; human review post-hoc)");
	});
});

describe("B5: RULES_RESOLVED rule-resolution step", () => {
	test("non-interpolated bash literal with two test -f guards and the echo", () => {
		const lit =
			'test -f "${CLAUDE_SKILL_DIR}/SKILL.md" && test -f "${CLAUDE_SKILL_DIR}/references/issue-craft.md" && echo "RULES_RESOLVED ${CLAUDE_SKILL_DIR}/SKILL.md ${CLAUDE_SKILL_DIR}/references/issue-craft.md"';
		expect(skillMd).toContain(lit);
	});
});

describe("B6: six sequential stages (five→six fix)", () => {
	test("presence: six sequential stages", () => {
		expect(skillMd).toContain("The pipeline runs in six sequential stages:");
	});

	test("absence: five sequential stages", () => {
		expect(skillMd).not.toContain("five sequential stages");
	});
});

describe("A6: silent-verdict handling", () => {
	test("a response with no Status line is REQUEST_CHANGES and consumes a cycle", () => {
		expect(skillMd).toContain(
			"A reviewer response with no **Status:** line is treated as REQUEST_CHANGES and consumes a cycle.",
		);
	});
});

describe("A8: dispatch-failure handling", () => {
	test("dispatch failure blocks the write and is reported to the caller", () => {
		expect(skillMd).toContain("If the reviewer cannot be dispatched, do not write — report the failure to the caller.");
	});
});

describe("D1: loop contract — max_cycles=5 and Same-Rule-3x", () => {
	test("max_cycles=5 literal", () => {
		expect(skillMd).toContain("max_cycles=5");
	});

	test("Same-Rule-3x literal", () => {
		expect(skillMd).toContain("Same-Rule-3x");
	});

	test("Same-Rule key definition", () => {
		expect(skillMd).toContain("Same-Rule key = target + the **Rule:** string verbatim.");
	});

	test("target identifier pinned at cycle 1", () => {
		expect(skillMd).toContain("Pin each target identifier at cycle 1 and never recompute it.");
	});

	test("same-key equality and reset rule", () => {
		expect(skillMd).toContain(
			'Two verdicts are "the same" iff the Same-Rule key matches; the count resets to 1 when a different key appears.',
		);
	});

	test("cycle start/increment and 5th-dispatch terminal rule", () => {
		expect(skillMd).toContain(
			"cycle starts at 0 and increments at reviewer dispatch; max_cycles=5 permits exactly 5 dispatches. A REQUEST_CHANGES on the 5th dispatch is terminal — no further revision is produced.",
		);
	});
});

describe("D2: fresh-instance dispatch and no self-assessment substitute", () => {
	test("fresh agent instance each cycle, no prior verdict carried forward", () => {
		expect(skillMd).toContain(
			"Dispatch a fresh agent instance each cycle. Do not pass the prior verdict or its findings into the new prompt.",
		);
	});

	test("writer self-assessment cannot substitute for a reviewer verdict", () => {
		expect(skillMd).toContain("The writer's self-assessment cannot substitute for a reviewer verdict.");
	});
});

describe("D3: terminal findings recorded under Notes only (not Decisions Needed)", () => {
	const literal = "record every unresolved finding verbatim under Notes";

	test("literal present", () => {
		expect(skillMd).toContain(literal);
	});

	test("same line does not also mention Decisions Needed", () => {
		const line = skillMd.split("\n").find((l) => l.includes(literal));
		expect(line).toBeDefined();
		expect(line as string).not.toContain("Decisions Needed");
	});
});

describe("D4: terminal exit — write anyway, exact bytes, caller notification", () => {
	test("terminal exit condition and write-anyway action", () => {
		expect(skillMd).toContain(
			"Terminal exit (max_cycles=5 exhausted, or Same-Rule-3x): write the issue anyway, and append the unresolved findings verbatim under Notes.",
		);
	});

	test("bytes-written invariant and no post-terminal revision", () => {
		expect(skillMd).toContain(
			"The bytes written are exactly the body as last dispatched to the reviewer. The findings from that final verdict are recorded, not acted on — no post-terminal revision is produced.",
		);
	});

	test("terminal Notes block is exempt from the Plain-Language Gate", () => {
		expect(skillMd).toContain("This terminal Notes block is appended after the Plain-Language Gate and is exempt from it");
	});

	test("sole exception to the reviewed-bytes-equal-written-bytes invariant", () => {
		expect(skillMd).toContain("the only exception to the reviewed-bytes-equal-written-bytes invariant");
	});

	test("caller notification on terminal write", () => {
		expect(skillMd).toContain(
			"Report the terminal write to the caller: the issue was written with N unresolved findings on <rule>; see Notes.",
		);
	});
});

describe("G1: design-research trigger test", () => {
	test("both-must-be-true trigger sentence", () => {
		expect(skillMd).toContain("Design-research trigger test (both must be true):");
	});
});

describe("G2: bounded librarian, never the maximum-saturation research engine", () => {
	// The banned engine name is built by concatenation, not written as one contiguous
	// literal, so this file's own raw bytes don't trip the recursive absence-scan below
	// (this test file lives inside skills/craft-issue/ and is swept by that scan too).
	const bannedEngineName = "ultra" + "research";

	test("presence: dispatches the bounded librarian engine", () => {
		expect(skillMd).toContain("Dispatch the bounded librarian engine");
	});

	test("absence: the banned engine name is never mentioned anywhere under skills/craft-issue/", () => {
		const craftIssueDir = join(import.meta.dir);
		const entries = readdirSync(craftIssueDir, { recursive: true }) as string[];
		for (const entry of entries) {
			const full = join(craftIssueDir, entry);
			if (!statSync(full).isFile()) continue;
			const content = readFileSync(full, "utf8");
			expect(content).not.toContain(bannedEngineName);
		}
	});
});

describe("G3: research output is advisory, never a decision", () => {
	test("proposal marker", () => {
		expect(skillMd).toContain("proposal — not decided in this issue");
	});

	test("name the decision and its owner, state no option as chosen", () => {
		expect(skillMd).toContain("Name the decision and its owner. State no option as chosen.");
	});

	test("TBD marker for an unavailable source URL", () => {
		expect(skillMd).toContain("TBD — needs validation via {method}");
	});
});

describe("G4: no forced Decisions Needed section when the trigger fails", () => {
	test("do not create a Decisions Needed section", () => {
		expect(skillMd).toContain("do not create a Decisions Needed section");
	});
});

describe("G5: dedup — one dispatch per open decision", () => {
	test("one dispatch per decision", () => {
		expect(skillMd).toContain("one dispatch per decision");
	});
});
