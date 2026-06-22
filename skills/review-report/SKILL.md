---
name: review-report
description: Use when you want the rich human-facing code review experience — a walkthrough with prose explanation plus mermaid architecture/sequence diagrams plus an HTML report of verified findings, not just terminal findings. Triggers include "review report", "코드리뷰 리포트", "리뷰 HTML", "다이어그램 리뷰", "리뷰 다이어그램", "walkthrough 리뷰", "PR 리뷰 리포트".
disable-model-invocation: true
---

# Review Report

The human-facing code-review comprehension orchestrator. It reads the diff, synthesizes a walkthrough (prose Change Summary + Core Logic Analysis + mermaid Architecture & Sequence diagrams) from the diff directly, dispatches a `code-reviewer` agent to obtain verified findings as plain text in an isolated context, **wraps those plain-text findings into verdict cards itself**, and renders the combined walkthrough + findings into a standalone HTML report.

**Rendering is this skill's responsibility.** The agent returns plain-text findings (this branch keeps `code-review` / `code-reviewer` as a plain terminal-text reviewer). This skill — the consumer — owns the render contract: it reformats each plain finding into a `<div class="finding" data-verdict>` card and fences every reviewed-code snippet. Nothing reaches `innerHTML` un-carded or with un-fenced reviewed code.

This is a **report**. It does not gate — there is no Assessment / "Ready to merge" section. The full report lives only in the HTML; the terminal receives counts and a path, not the report body.

## Why two layers

The walkthrough describes the *change* (diagrams, data flow, design decisions). The findings describe *bugs* (verdict-labeled defects). These come from different sources:

- **Walkthrough** — synthesized here, directly from the diff and targeted code reading. The agent returns findings, not a change description, so this skill needs the diff itself for the walkthrough.
- **Findings** — obtained by **dispatching a `code-reviewer` agent** (Task tool, `subagent_type: "code-reviewer"`) in an isolated context. The agent runs the full pure code-review (finder fan-out + per-candidate verification) and returns the verified findings as **plain terminal-text** (the `code-review` Phase 3 contract: verdict + class + `file:line` + enriched evidence per finding). The agent's finder+verifier fan-out is context-heavy; isolating it protects this skill's render context.

**Never** invoke the code-review skill inline in this context. **Never** use a file-based handoff. The agent returns **plain-text findings, not card HTML** — this skill reformats them into verdict cards at render (Step R1). Do not expect the agent to emit `<div class="finding">` markup; producing the card chrome and fencing the reviewed code is the consumer's job here.

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
2. **Acquire intent (gates the walkthrough)** — establish the author's intent from artifacts + linked references + interview, or accept an explicit code-quality-only deferral, before any walkthrough is written (Step 1.5).
3. **Synthesize the walkthrough** — prose Change Summary + Core Logic Analysis + mermaid Architecture Diagram + Sequence Diagram, from the diff directly, informed by the acquired intent (Step 2).
4. **Obtain findings** — dispatch a `code-reviewer` agent in an isolated context; it returns findings as plain-text findings, which this skill wraps into verdict cards at render (Step 3).
5. **Render the HTML** — assemble the render-time markdown (walkthrough + findings cards), substitute the template placeholders, write `$OMT_DIR/reviews/{slug}.html`, open it, print the terminal pointer (Step 4 / R1–R5).

## Step 1: Read the Diff / Review Target

Determine the range from the input mode. **Authoritative source = `code-review` Step 1 (Input Parsing)** — the range-derivation rules live there and are not independently editable here. The table below is a convenience restatement of the range strings this skill needs; if it ever drifts from `code-review` Step 1, `code-review` wins. Use the identical range derivation so the agent dispatch and the walkthrough operate on the same target.

| Input | Setup | Range |
|-------|-------|-------|
| `pr <number or URL>` | **Run the worktree-checkout guard block below first** (abort on dirty tree or primary repo), then fetch and check out the PR ref into the worktree (PR head checked out so the working directory reflects post-change state). Extract the numeric `<N>` from a URL *before* any git command — a raw URL produces an invalid refspec. | `origin/<baseRefName>...pr-<number>` |
| `<base> <target>` | Verify HEAD is `<target>` via `git rev-parse --abbrev-ref HEAD`; verify clean tree via `git status --porcelain -uno`. Abort if mismatch or dirty. | `<base>...<target>` |
| (none) | Detect default branch (`origin/main` or `origin/master`). Verify HEAD is the target branch; verify clean tree. Abort if mismatch or dirty. | `<default>...HEAD` |

All range formats use **three-dot syntax** (`A...B`) — only changes introduced by the target since the common ancestor, not changes on the base branch.

### PR Mode: Worktree Checkout Guards

The `pr` row checks out the PR ref, overwriting the working tree — so it carries the same safety guards as the non-PR rows, plus the primary-vs-linked-worktree refusal. Mirror `code-review`'s guard block: abort BEFORE any state change if the tree is dirty, and refuse to run in the primary repo.

```bash
set -euo pipefail

# Abort BEFORE any checkout — never overwrite the user's work.
# -uno: untracked files survive checkout; only tracked modifications matter here.
if [ -n "$(git status --porcelain -uno)" ]; then
  echo "Error: working directory has uncommitted changes — refusing to checkout over the user's work" >&2
  exit 1
fi
# Distinguish primary repo from linked worktree. In a linked worktree --git-dir
# points inside .git/worktrees/<wt> while --git-common-dir points to the shared
# .git directory (they differ); in a primary clone they are equal — refuse so we
# never checkout over the user's main work tree.
if [ "$(git rev-parse --git-dir 2>/dev/null)" = "$(git rev-parse --git-common-dir 2>/dev/null)" ]; then
  echo "Error: refusing to run in primary repo — create a dedicated linked worktree first. Hint: 'git worktree add ../review-pr-<N> -b review/pr-<N>'" >&2
  exit 1
fi
```

After these guards pass, fetch the base branch then `pull/<number>/head`, and `git checkout -B pr-<number> FETCH_HEAD`.

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

## Step 1.5: Intent Acquisition (MANDATORY — gates the walkthrough)

**Intent acquisition is non-negotiable, and it must happen *before* the walkthrough is synthesized.** The walkthrough explains the *change* — its purpose, approach, and design decisions — which cannot be characterized correctly without the author's intent. Synthesizing it first produces a confident-but-wrong narrative. The dispatched `code-reviewer` agent acquires intent for the findings inside its own isolated context (its Step 0), but that intent never flows back here, so this skill must establish intent itself before Step 2.

This mirrors `code-review`'s Step 0 Intent Block Gate. Acquire intent in this order, then gate:

1. **PR/branch artifacts** — PR title, description, labels, commit history, review comments and threads.
2. **Linked references (recursive)** — every link found in the artifacts above, followed transitively until the trail ends.
3. **Codebase signals** — CLAUDE.md, README, ADRs, related history in the changed paths.
4. **User interview** — only for what the artifacts cannot reveal (intent, alternatives, constraints, concerns). Do NOT interview the user about codebase facts; read those directly.

### Intent Block Gate (hard exit condition)

Before proceeding to Step 2, the state must be one of:

| State | Action |
|-------|--------|
| **Intent confirmed** — author's goal, approach, and constraints are understood from artifacts and/or interview | Proceed to Step 2 (and supply this intent to the walkthrough and to the Step 3 agent dispatch) |
| **User explicit deferral** — user says "skip", "그냥 리뷰해줘", "없어", "code quality only", or unambiguous equivalent | Treat as code-quality-only; proceed to Step 2 |
| **Neither** — artifacts thin and user not yet asked, OR user gave vague answers without explicit deferral | **BLOCK**. Do not synthesize the walkthrough. Continue the interview until one of the two states above is reached. |

There is no "I tried hard enough, just write the walkthrough" path. The block IS the safety mechanism. **One question per message** — never bundle, wait for each answer. Every question must carry a specific anchor (a summary the user can correct) or a default action in parentheses so progress is possible without an answer.

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
- Mermaid class diagram or component diagram.
- Show changed classes/modules and their relationships (inheritance, composition, dependency).
- Distinguish new vs modified elements.
- If no structural changes (e.g., logic-only changes within existing methods): write "No structural changes — existing architecture preserved".

#### Sequence Diagram
- Mermaid sequence diagram visualizing the primary call flow(s) affected by the changes.
- Include actors, method calls, return values, and significant conditional branches.
- If no call flow changes (e.g., variable rename, config change): write "No call flow changes".

## Step 3: Dispatch the `code-reviewer` Agent for Findings

Findings come **only** from a dispatched `code-reviewer` agent running in an isolated context — never inline, never via a file handoff.

1. Dispatch a `code-reviewer` agent via the Task tool (`subagent_type: "code-reviewer"`), passing the review target so the agent operates on the same range as the walkthrough: the input mode and range from Step 1 (PR number/URL, or `<base>...<target>`), plus the **intent/requirements confirmed in Step 1.5** (or the explicit code-quality-only deferral).
2. The agent runs the full pure code-review: it fans out the angle finders, verifies each candidate (CONFIRMED / PLAUSIBLE / REFUTED), drops REFUTED, and **returns the verified findings as plain text** — the `code-review` Phase 3 contract: per finding, a verdict (CONFIRMED / PLAUSIBLE), class (correctness / cleanup), `file:line`, and enriched evidence (current code, what's wrong, failure scenario, fix, blast radius). It returns plain text, **not** `<div class="finding">` card HTML, and it does **not** render HTML. Carding is this skill's job (Step R1).
3. **Collect the agent's plain-text findings.** Do not re-judge verdicts, do not re-rank — the agent already verified and ranked. You preserve the agent's verdicts, classes, and order; you only reformat (plain text → cards) at render.

### Evidence-Gate Failure Branch (do NOT render)

The agent runs `code-review` Step 3 evidence verification (build → tests → lint) as a fail-fast gate **before** producing any findings. On a failed check, the agent does **not** produce findings — it returns the `{EVIDENCE_RESULTS}` table (Build / Tests / Lint with PASS/FAIL + the failing command's last 30 lines) and exits with zero findings.

**Before assembling or rendering anything (before Step R1), inspect the agent's return:**

| Agent return | Action |
|--------------|--------|
| Findings (one or more verdict-bearing findings) | Proceed to Step 4 / R1 — wrap them into cards and render. |
| Explicit "No findings survived verification." | Proceed to Step 4 / R1 — render with the empty-findings line. |
| A Build / Tests / Lint **FAIL** table (no findings) | **Do NOT render.** Print the evidence table verbatim to the terminal and stop. Do not write an HTML report. |

A failed evidence gate is a build/test/lint failure, not a clean review. Rendering it would produce a normal-looking 0/0-count report that hides the failure — so this branch short-circuits the render entirely and surfaces the failure table in the terminal.

The agent's transcript stays in its own context. This skill's context receives only the returned findings text (or the failure table) — keeping the render context clean.

## Step 4: HTML Render + Terminal Pointer

This is a **report**. It does not gate. There is no Assessment / "Ready to merge" section.

Reach this step only when Step 3 returned findings (or the explicit "No findings survived verification." line) — **not** when it returned an evidence-gate FAIL table (that branch already stopped). Assemble the render-time markdown (walkthrough from Step 2 + findings from Step 3, reformatted into cards), render it into `$OMT_DIR/reviews/{slug}.html`, and print a short terminal pointer. The full report lives only in the HTML — the terminal receives counts and a path, not the report body.

### Step R1: Assemble the Render-Time Markdown

Assemble the report markdown with the top-level sections — the Walkthrough (Step 2), then the findings the `code-reviewer` agent returned (Step 3), preserving the agent's verdicts, classes, and order.

**MANDATORY READ: `${CLAUDE_SKILL_DIR}/references/render-assembly.md`** — card format, injection guard rules (card-body + prose), mermaid validity constraints, translation rules, unverified-entry handling, and the placeholder table / write command. Read it now before assembling.

**Reformat the agent's plain-text findings into verdict cards.** The agent returns plain text, not card HTML — so for each finding, **wrap it in a `<div class="finding" data-verdict="CONFIRMED">` (or `data-verdict="PLAUSIBLE"`) card** following the exact card format in `references/render-assembly.md`, splitting them into the Correctness and Cleanup sections in the agent's ranked order. Per that reference's injection guards: every reviewed-code snippet inside a card (Current Code / Fix) MUST be a fenced ` ```{lang} ` block, and every reviewed-code fragment quoted in a prose field (title / What's wrong / Failure scenario) MUST be wrapped in an inline-code span. The render sink is `innerHTML = marked.parse(md)` with no DOM sanitizer — un-carded findings escape the `[data-verdict]` CSS, and un-fenced reviewed code becomes live markup. The walkthrough sections you author here follow the same injection-guard and mermaid-validity rules (e.g. keep sequence-message text free of raw `;`).

### Step R2: Read the Template

Read the HTML template from `${CLAUDE_SKILL_DIR}/templates/review-presentation.html`. Do NOT construct the path relative to the current working directory — during a review, the skill's bash CWD is the review target repo, not the skill directory, so a CWD-relative read would miss the deployed copy.

### Step R3: Derive the Slug

Derive `{slug}` from the review target — stable per target so that re-reviewing the same target **overwrites** the prior file (no timestamp suffix):

- PR review: `{repo-basename}-pr{N}` (e.g. `algocare-home-pr123`)
- Branch comparison: `{repo-basename}-{sanitized-branch}` (branch sanitized to `[a-z0-9-]`)
- Fallback (no PR, no branch): `{repo-basename}-{short-diff-range-hash}`

where `{repo-basename}` = `basename -s .git $(git remote get-url origin)`, or `basename $(git rev-parse --show-toplevel)` if no remote.

### Step R4: Substitute Placeholders and Write

(Placeholder substitution and write procedure: **see `${CLAUDE_SKILL_DIR}/references/render-assembly.md`** — read it if you have not already done so at Step R1. The template carries 9 placeholders; substitute every one, HTML-escaping every active-HTML placeholder, then write to `$OMT_DIR/reviews/{slug}.html`.)

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
Correctness: {N confirmed} CONFIRMED, {N plausible} PLAUSIBLE
Cleanup:     {N confirmed} CONFIRMED, {N plausible} PLAUSIBLE
```

### Example Final Output

**MANDATORY READ on first output: `${CLAUDE_SKILL_DIR}/references/output-example.md`** — a complete example synthesized from 3 chunks (Order API + domain, Payment integration, Inventory + messaging). Read it before producing your first review output to match the expected format, level of detail, and enrichment style.

## Reference Files (on-demand)

These files live in `${CLAUDE_SKILL_DIR}/references/` alongside this skill. Each is loaded only when the workflow reaches the step that needs it — do not preload all of them.

| Reference file | What it contains | When to read |
|---|---|---|
| `references/render-assembly.md` | Card format, injection guards (card-body + prose), mermaid validity constraints, translation rules, unverified-entry handling, placeholder table and write command | Step R1 (assemble render markdown) and Step R4 (substitute placeholders and write) |
| `references/output-example.md` | A complete worked review example synthesized from 3 chunks | When producing your first review output, to match expected format and enrichment depth |
