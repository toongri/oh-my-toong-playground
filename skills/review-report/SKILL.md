---
name: review-report
description: Use when you want the rich human-facing code review experience — a walkthrough with prose explanation plus inline-SVG architecture/sequence diagrams plus an HTML report of verified findings, not just terminal findings. Triggers include "review report", "코드리뷰 리포트", "리뷰 HTML", "다이어그램 리뷰", "리뷰 다이어그램", "walkthrough 리뷰", "PR 리뷰 리포트".
disable-model-invocation: true
---

# Review Report

The human-facing code-review comprehension orchestrator. It reads the diff, synthesizes a walkthrough (prose Change Summary + Core Logic Analysis + inline-SVG Architecture & Sequence diagrams) from the diff directly, dispatches a `code-reviewer` agent to obtain verified findings in an isolated context, and writes the combined walkthrough + findings as the body of a standalone HTML report.

This is a **report**. It does not gate — there is no Assessment / "Ready to merge" section. The full report lives only in the HTML; the terminal receives counts and a path, not the report body.

## Why two layers

The walkthrough describes the *change* (diagrams, data flow, design decisions). The findings describe *bugs* (verdict-labeled defects). These come from different sources:

- **Walkthrough** — synthesized here, directly from the diff and targeted code reading. The agent returns findings, not a change description, so this skill needs the diff itself for the walkthrough.
- **Findings** — obtained by **dispatching a `code-reviewer` agent** (Task tool, `subagent_type: "code-reviewer"`) in an isolated context. The agent runs the full pure code-review (finder fan-out + per-candidate verification) and returns findings as text in the existing markdown finding-card contract. The agent's finder+verifier fan-out is context-heavy; isolating it protects this skill's render context.

**Never** invoke the code-review skill inline in this context. **Never** use a file-based handoff. **Never** invent a new findings format — the agent returns the existing markdown finding cards; their content is carried over unchanged and only rewritten as HTML cards at render.

## Input Modes

Same input modes as `code-review` — a PR number/URL or a local diff range:

```bash
# PR (number or URL)
review-report pr 123
review-report pr https://github.com/org/repo/pull/123

# Branch comparison
review-report main feature/auth

# Auto-detect (current branch vs origin/main or origin/master)
review-report
```

## Flow

1. **Read the diff / review target** — determine the range and read the diff (Step 1).
2. **Synthesize the walkthrough** — prose Change Summary + Core Logic Analysis + inline-SVG Architecture Diagram + Sequence Diagram, from the diff directly (Step 2).
3. **Obtain findings** — dispatch a `code-reviewer` agent in an isolated context; it returns findings as markdown finding cards (Step 3).
4. **Render the HTML** — write the report body as HTML (walkthrough + findings cards), substitute the template placeholders, write `$OMT_DIR/reviews/{slug}.html`, open it, print the terminal pointer (Step 4 / R1–R5).

## Step 1: Read the Diff / Review Target

Determine the range from the input mode. This mirrors `code-review`'s input parsing — use the identical range derivation so the agent dispatch and the walkthrough operate on the same target.

| Input | Setup | Range |
|-------|-------|-------|
| `pr <number or URL>` | Fetch and check out the PR ref into the worktree (PR head checked out so the working directory reflects post-change state). Extract the numeric `<N>` from a URL *before* any git command — a raw URL produces an invalid refspec. | `origin/<baseRefName>...pr-<number>` |
| `<base> <target>` | Verify HEAD is `<target>` via `git rev-parse --abbrev-ref HEAD`; verify clean tree via `git status --porcelain -uno`. Abort if mismatch or dirty. | `<base>...<target>` |
| (none) | Detect default branch (`origin/main` or `origin/master`). Verify HEAD is the target branch; verify clean tree. Abort if mismatch or dirty. | `<default>...HEAD` |

All range formats use **three-dot syntax** (`A...B`) — only changes introduced by the target since the common ancestor, not changes on the base branch.

The diff is the delta; the working directory is the result. Read code freely from the working directory to enrich the walkthrough.

### Early Exit

After determining the range, run `git diff {range} --stat`:
- Empty diff → report "No changes detected (between <base> and <target>)" and exit.
- Binary-only diff → report "Only binary file changes detected" and exit.

### Context for the walkthrough

Collect (using `{range}`):

1. `git diff {range} --stat` (change scale)
2. `git diff {range} --name-only` (file list)
3. `git log {range} --oneline` (commit history)
4. CLAUDE.md files: repo root + each changed directory's CLAUDE.md (if exists)

## Step 2: Walkthrough Synthesis (MANDATORY)

Directly produce the Walkthrough from:
- `git diff {range} --stat` / `--name-only` and `git log {range}` — the shape, scope, and stated intent of the change.
- Targeted reads of the changed files (the working directory is the post-change state) + context-enrichment reads (below).

**Execution order:** First evaluate context enrichment. Then generate the four sections.

### Context Enrichment (Conditional)

After reviewing the diff shape (stat/name-only/log), assess whether the available information is sufficient to write the Walkthrough. If gaps exist, **read the relevant code directly** before writing the walkthrough.

**When to read code for enrichment:**

| Gap | What to Read | Example |
|-----|-------------|---------|
| Cross-module relationships unclear | Interfaces, base classes, caller/callee code | "Diff shows OrderService calling PaymentGateway — read the gateway interface and its implementations" |
| Architecture hierarchy unknown | Class hierarchy, module structure | "New class extends BaseRepository — read the base class to understand the contract" |
| Inconsistent patterns | Both implementations + project conventions | "One module uses Result<T>, another uses exceptions — read both to determine project convention" |

**When NOT to enrich:**

| Condition | Reason |
|-----------|--------|
| Simple changes (test-only, doc-only, config-only, single-function logic) | The diff stat and commit history are self-sufficient |
| The diff shape and a quick read of changed files give a complete picture | No gaps to fill |
| Trivial diff (< 5 files, < 100 lines) | Sparse analysis is expected, not a gap |

**Fallback**: For very broad architectural exploration (10+ files across many modules), dispatch an explore agent instead of reading everything directly. This is the exception, not the default.

### Walkthrough sections

Produce all four sections, in order.

#### Change Summary
- 1-2 paragraph prose summary of the entire change's purpose and context.
- Include motivation, approach taken, and overall impact.
- Written for someone unfamiliar with the code to understand the change.

#### Core Logic Analysis
- Build a unified module/feature-level narrative of the change from the diff shape and your code reading.
- Cover both core changes AND supporting/peripheral changes.
- Enrich with commit messages, PR description, CLAUDE.md, and enrichment reads when available.
- Explain data flow, design decisions, and side effects from the perspective of inter-module relationships.
- Level of detail: enough to understand the full change WITHOUT reading the code.

#### Architecture Diagram
- Inline SVG figure (class or component diagram), authored per `${CLAUDE_SKILL_DIR}/../html-report/SKILL.md` section 7 and `${CLAUDE_SKILL_DIR}/../html-report/references/diagram-recipes.md` (Structure recipe).
- Show changed classes/modules and their relationships (inheritance, composition, dependency).
- Distinguish new vs modified elements.
- If no structural changes (e.g., logic-only changes within existing methods): write "No structural changes — existing architecture preserved".

#### Sequence Diagram
- Inline SVG sequence figure (diagram-recipes.md Sequence recipe) visualizing the primary call flow(s) affected by the changes.
- Include actors, method calls, return values, and significant conditional branches.
- If no call flow changes (e.g., variable rename, config change): write "No call flow changes".

## Step 3: Dispatch the `code-reviewer` Agent for Findings

Findings come **only** from a dispatched `code-reviewer` agent running in an isolated context — never inline, never via a file handoff.

1. Dispatch a `code-reviewer` agent via the Task tool (`subagent_type: "code-reviewer"`), **in the foreground, waiting for it to return before going further**, passing the review target so the agent operates on the same range as the walkthrough: the input mode and range from Step 1 (PR number/URL, or `<base>...<target>`), plus any intent/requirements context already gathered. This skill consumes the agent's return value, not a file it writes, so the findings must be in hand before the HTML render assembles the report; a detached dispatch hands back a job reference instead of findings, and reading a subagent's transcript is prohibited, so there is no recovery path — the report renders with an empty Findings section.
2. The agent runs the full pure code-review: it fans out the angle finders, verifies each candidate (CONFIRMED / PLAUSIBLE / REFUTED), drops REFUTED, and **returns the verified findings as markdown finding cards** — the existing finding contract (verdict-labeled cards, split into Correctness, Requirement Gap, and Cleanup, plus any Out of Scope / Unverified sections). It does **not** render HTML.
3. **Collect the agent's findings text verbatim.** Do not re-judge verdicts, do not re-rank, do not reword the cards — the agent already verified and ranked. You carry every card's content into the HTML body unchanged and change only the markup (Step R1).

The agent's transcript stays in its own context. This skill's context receives only the returned findings text — keeping the render context clean.

## Step 4: HTML Render + Terminal Pointer

This is a **report**. It does not gate. There is no Assessment / "Ready to merge" section.

Write the report body as HTML (walkthrough from Step 2 + findings from Step 3), place it in the template, write `$OMT_DIR/reviews/{slug}.html`, and print a short terminal pointer. The full report lives only in the HTML — the terminal receives counts and a path, not the report body.

### Step R1: Write the Report Body as HTML

Write the report body directly as HTML, with the top-level sections — the Walkthrough (Step 2), then the findings the `code-reviewer` agent returned (Step 3), in the order the agent produced them. The page has no script and no markdown renderer: whatever you write is the final markup, so escaping is your job.

**MANDATORY READ: `${CLAUDE_SKILL_DIR}/references/render-assembly.md`** — body structure, finding-card HTML, the escaping and injection rules, SVG figure rules, translation rules, unverified-entry handling, and the placeholder table / write command. Read it now before writing.

Turn each markdown finding card from the agent into the HTML card of that reference. Keep verdicts, titles, locations, field text, code, and order exactly as the agent returned them. HTML-escape every piece of text and code that comes from the diff, the PR, or the agent (`&`, `<`, `>`), and write reviewed code only inside `<pre><code>` or `<code>`. The walkthrough sections you author follow the same rules, and each figure's labels are escaped too.

### Step R2: Read the Template

Read the HTML template from `${CLAUDE_SKILL_DIR}/templates/review-presentation.html`. Do NOT construct the path relative to the current working directory — during a review, the skill's bash CWD is the review target repo, not the skill directory, so a CWD-relative read would miss the deployed copy.

### Step R3: Derive the Slug

Derive `{slug}` from the review target — stable per target so that re-reviewing the same target **overwrites** the prior file (no timestamp suffix):

- PR review: `{repo-basename}-pr{N}` (e.g. `acme-home-pr123`)
- Branch comparison: `{repo-basename}-{sanitized-branch}` (branch sanitized to `[a-z0-9-]`)
- Fallback (no PR, no branch): `{repo-basename}-{short-diff-range-hash}`

where `{repo-basename}` = `basename -s .git $(git remote get-url origin)`, or `basename $(git rev-parse --show-toplevel)` if no remote.

### Step R4: Substitute Placeholders and Write

(Placeholder substitution and write procedure: **see `${CLAUDE_SKILL_DIR}/references/render-assembly.md`** — read it if you have not already done so at Step R1. The template carries 11 placeholders; substitute every one, escaping the plain-text placeholders and inserting the authored body and TOC markup, then write to `$OMT_DIR/reviews/{slug}.html`.)

### Step R4b: Capture and Lint the Assembled HTML

Before reporting, run the self-critique loop of `${CLAUDE_SKILL_DIR}/../html-report/SKILL.md` section 14 on the file just written. The diff is not a source directory on disk, so omit `--source` and say so in the report.

```bash
OUT="$OMT_DIR/reviews/.visual-check/round-1"
bash ${CLAUDE_SKILL_DIR}/../html-report/scripts/capture.sh "$OMT_DIR/reviews/{slug}.html" "$OUT"
bash ${CLAUDE_SKILL_DIR}/../html-report/scripts/lint.sh "$OMT_DIR/reviews/{slug}.html" --strict > "$OUT/lint.json"
jq '.summary' "$OUT/lint.json"
```

Look at every frame, fix the body HTML (never the findings cards' verdicts), re-substitute and rewrite the file, then follow `${CLAUDE_SKILL_DIR}/../html-report/SKILL.md` §14 to choose the next check (a new capture round only after a layout, style, or SVG fix; lint only after a text-only fix) and to decide when to stop. Walkthrough figures are the usual source of errors (`svg-text-overlap`, `svg-text-small`, `figure-scrolls`). Findings cards are not figures and keep their card format.

### Step R5: Open and Print Terminal Pointer

Attempt to open the HTML file in the browser (best-effort, non-blocking — never error on failure):

```bash
open "$OMT_DIR/reviews/{slug}.html" 2>/dev/null || \
  xdg-open "$OMT_DIR/reviews/{slug}.html" 2>/dev/null || \
  true
```

On headless/CI environments where neither `open` nor `xdg-open` succeeds, print the file path so the user can open it manually — do not raise an error.

Print the terminal pointer (finding counts by verdict/category + the html path — NOT the full report body):

```
Review written: $OMT_DIR/reviews/{slug}.html
Correctness:     {N confirmed} CONFIRMED, {N plausible} PLAUSIBLE
Requirement gap: {N confirmed} CONFIRMED, {N plausible} PLAUSIBLE
Cleanup:         {N confirmed} CONFIRMED, {N plausible} PLAUSIBLE
```

### Example Final Output

**MANDATORY READ on first output: `${CLAUDE_SKILL_DIR}/references/output-example.md`** — a complete example synthesized from 3 chunks (Order API + domain, Payment integration, Inventory + messaging). Read it before producing your first review output to match the expected format, level of detail, and enrichment style.

## Reference Files (on-demand)

These files live in `${CLAUDE_SKILL_DIR}/references/` alongside this skill. Each is loaded only when the workflow reaches the step that needs it — do not preload all of them.

| Reference file | What it contains | When to read |
|---|---|---|
| `references/render-assembly.md` | Body structure, finding-card HTML, escaping and injection rules, SVG figure rules, translation rules, unverified-entry handling, placeholder table and write command | Step R1 (write the body) and Step R4 (substitute placeholders and write) |
| `references/output-example.md` | A complete worked review example (the TOC items and the HTML body) synthesized from 3 chunks | When producing your first review output, to match expected format and enrichment depth |
