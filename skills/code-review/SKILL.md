---
name: code-review
description: Use when reviewing code changes for quality, correctness, and production readiness before merge
---

# Code Review

Directly conducts orchestrate-review jobs against diffs. Handles input parsing, context gathering, chunking, finder-job lifecycle, and result synthesis.

## Premises (apply to orchestrator AND finder jobs)

These two premises are non-negotiable. They are forwarded through every finder-job prompt and govern every decision in this skill.

1. **Post-change state** — The working directory reflects the post-change state of the target ref. PR mode achieves this by checking out the PR head into a dedicated linked worktree (see Step 0). Non-PR modes (branch comparison, auto-detect) achieve this by verifying HEAD-match + clean-tree on the current working directory (also Step 0). Either way: read code freely from the working directory — the diff is the delta, the working directory is the result. Do not pretend the file system is read-only or stuck at base.

2. **No diff-only review** — A diff is a delta. The unit of review is the *system the diff produces*. Always trace dependencies, callers, callees, interfaces, configurations, and runtime context across files. If you cannot explain how the changed code behaves end-to-end against the surrounding system, you have not reviewed it.

These premises must be reflected in the finder-job prompt — see Step 4. Review is static-only: do not run tests, builds, linters, formatters, migrations, or other project execution. The job lifecycle commands (`start`, `collect`, `status`, `results`, `clean`, and usage-summary) are allowed.

## Input Modes

```bash
# PR (number or URL)
/code-review pr 123
/code-review pr https://github.com/org/repo/pull/123

# Branch comparison
/code-review main feature/auth

# Auto-detect (current branch vs origin/main or origin/master)
/code-review
```

## Do vs Delegate Decision Matrix

| Action | YOU Do | DELEGATE |
|--------|--------|----------|
| Requirements 3-question gate | Yes | - |
| Diff range determination & git | Yes | - |
| Chunking decision | Yes | - |
| Findings synthesis (rank/class verified findings) | Yes | - |
| Individual candidate judgment inline (Phase 2) | Yes | - |
| Escalation verification (candidates below confidence threshold) | - | verifier subagent (one per escalated candidate) |
| Individual chunk review | NEVER | configured finder CLIs through direct jobs |
| Code modification | NEVER | (forbidden entirely) |

### Role Separation

**Your role as orchestrator:**
- Start direct orchestrate-review jobs with diff command strings (each job fans out the configured angle finders)
- Judge each deduped candidate inline in Phase 2 (reasoning → confidence → verdict + enrichment); enrich kept findings directly
- Escalate only candidates below the confidence threshold to verifier subagents; collect their final verdicts; supersede inline tentative verdicts with verifier verdicts in Phase 3
- Synthesize the kept findings into a ranked findings report (text only)
- Make chunking decisions and rank the verified findings (no merge verdict — this review reports, it does not gate)

**NOT your role:**
- Modifying any source files
- Running the raw `git diff` command (finder CLIs execute the diff)

### Context Budget

**Allowed in orchestrator context:**
- `git diff {range} --stat` output
- `git diff {range} --name-only` output
- `git diff {range} --numstat` output
- `git log {range} --oneline` output
- CLAUDE.md file content
- chunk-reviewer results (candidate findings)
- Phase 2 inline judgment output (reasoning, verdicts, enriched findings for non-escalated candidates)
- Escalated verifier subagent verdicts + enriched findings (Phase 2, candidates below confidence threshold)
- Code reading via Read/Grep for Phase 2 inline candidate judgment

The orchestrator never inspects, loads, or displays diff text. The sole exception is the prescribed binary `git diff --no-ext-diff --binary ...` stdout byte stream, which flows directly to SHA-256 outside model context for `diffFingerprint`; stderr is excluded and a nonzero exit aborts. Finder jobs execute the review diff from the prompt.

## Step 0: Input Parsing

Environment setup runs first — resolve the range and, in PR mode, check out the post-change code into the worktree **before** any code-reading step (intent acquisition, the derived-context sub-step, chunk-review). Every downstream step reads the working directory, so the working directory must already hold the post-change state.

Determine range and setup for subsequent steps:

| Input | Setup | Range |
|-------|-------|-------|
| `pr <number or URL>` | Fetch and check out PR ref into the worktree (see below) | `origin/<baseRefName>...pr-<number>` |
| `<base> <target>` | Verify HEAD is `<target>` via `git rev-parse --abbrev-ref HEAD`; verify clean tree via `git status --porcelain -uno`. Abort if mismatch or dirty. | `<base>...<target>` |
| (none) | Detect default branch (`origin/main` or `origin/master`). Verify HEAD is the target branch via `git rev-parse --abbrev-ref HEAD`; verify clean tree via `git status --porcelain -uno`. Abort if mismatch or dirty. | `<default>...HEAD` |

### PR Mode: Worktree Checkout (per Premise 1)

This skill assumes the orchestrator is already running inside a worktree dedicated to this review (the caller is responsible for creating the worktree). Therefore: **fetch the PR ref AND check it out**. The working directory must reflect the post-change state of the PR so that all subsequent code reading (Phase 2 verification, chunk-reviewer Step 2) sees the actual code under review.

**PR ID 추출 규칙**: 사용자가 URL(`https://github.com/<org>/<repo>/pull/<N>`) 형식으로 호출하면, 아래 bash로 진입하기 *전에* trailing path segment에서 numeric `<N>`을 추출해 `<number>` 자리에 substitute하라. URL을 그대로 substitute하면 `git fetch origin pull/<URL>/head`가 invalid refspec으로 실패하고 `git checkout -B pr-<URL>`이 invalid 브랜치명으로 실패한다.

```bash
set -euo pipefail

# 0. Safety guards (Premise 1 enforcement) — abort BEFORE any state change
# -uno: untracked files are preserved by checkout; only check tracked modifications
if [ -n "$(git status --porcelain -uno)" ]; then
  echo "Error: working directory has uncommitted changes — refusing to checkout over the user's work" >&2
  exit 1
fi
# Distinguish primary repo from linked worktree.
# In a linked worktree, --git-dir points inside .git/worktrees/<wt>,
# while --git-common-dir points to the shared .git directory; they differ.
# In a primary clone they are equal — refuse so we never checkout over the user's main work tree.
if [ "$(git rev-parse --git-dir 2>/dev/null)" = "$(git rev-parse --git-common-dir 2>/dev/null)" ]; then
  echo "Error: refusing to run in primary repo — create a dedicated linked worktree first (Premise 1). Hint: 'git worktree add ../review-pr-<N> -b review/pr-<N>'" >&2
  exit 1
fi

# 1. Get base branch name (abort if gh fails or returns empty)
BASE_REF=$(gh pr view <number> --json baseRefName --jq '.baseRefName')
if [ -z "$BASE_REF" ]; then
  echo "Error: gh pr view returned empty baseRefName — aborting before any fetch" >&2
  exit 1
fi

# 2. Fetch base branch first, then PR ref last so FETCH_HEAD points to PR head
#    (rerun-safe — force-push on the PR is picked up on re-review)
git fetch origin "${BASE_REF}"
git fetch origin pull/<number>/head

# 3. Reset local pr-<N> to the freshly fetched PR head (FETCH_HEAD) and check it out
#    so the working directory matches the PR state
git checkout -B pr-<number> FETCH_HEAD
```

If the working directory is dirty (uncommitted changes) or the caller is not in a worktree, abort and report — do not silently checkout over the user's work. The worktree premise is the safety net; without it, the safety net is gone.

All range formats use **three-dot syntax** (`A...B`), which is equivalent to `git diff $(git merge-base A B)..B`. This shows only changes introduced by the target since the common ancestor — not changes on the base branch. This prevents false positives when `origin/main` has moved ahead after branching.

All subsequent steps use `{range}` from this table. All diff commands use `git diff {range} -- <files>` for path-filtered output. After checkout, code reading via Read/Grep/Glob reflects the **post-change** state, which is the intended behavior — diff shows the delta, the working directory shows the result.

### Early Exit

After the range is resolved and (PR mode) the checkout is done, before proceeding to Step 1:

1. Run `git diff {range} --stat` (using the range determined above)
2. If empty diff: report "No changes detected (between <base> and <target>)" and exit
3. If binary-only diff: report "Only binary file changes detected" and exit

Early Exit runs before intent acquisition on purpose — an empty or binary-only diff needs no interview.

## Step 1: Intent and Context Acquisition

**Intent acquisition is non-negotiable.** Either intent is confirmed (from artifacts, interview, or both), or the user explicitly defers to a code-quality-only review. There is no third option — proceeding without intent and without explicit deferral is forbidden. Reviewing without intent produces wrong severities, missed scope creep, and false positives born from misunderstanding the author's goal.

### Acquisition order

1. **PR/branch artifacts** — PR title, description, labels, commit history, code review comments and threads
2. **Linked references (recursive)** — every link found in the artifacts above, followed transitively until the trail ends
3. **Codebase signals** — CLAUDE.md, README, ADRs, related history in changed paths
4. **User interview** — only for what the artifacts cannot reveal

### Acquire all reachable references

PR descriptions, commits, and comments routinely link to richer context (issue trackers, design docs, chat threads). **Follow every link recursively** — a linked ticket may itself link to a doc which links to a discussion thread; keep following until the trail ends.

Do not name specific tools. Use whatever fetch capability the environment provides for each link type. If a link cannot be fetched directly (no credential, no MCP for that platform, network unreachable), do not skip it — mark it for the user interview step.

Sources to consult per input mode:

| Input mode | Sources |
|------------|---------|
| PR | `gh pr view --json title,body,labels,comments,reviews`, `gh pr view --comments`, linked issues, `gh issue view <n>`, every external link found in the chain, commit messages on the PR branch |
| Branch comparison | Commit messages, branch name conventions, any linked tickets discovered in commits, related issues |
| Auto-detect | Recent commit messages on HEAD, any linked tickets found there |

### User interview — only for what artifacts cannot reveal

After exhausting fetchable sources, ask the user about:
- **Intent** — what problem is this PR solving and why was this approach chosen
- **Alternatives** — what was considered and rejected, and why
- **Constraints** — deadlines, dependencies, compatibility commitments, hidden requirements
- **Concerns** — known risks, untested paths, areas the author is uncertain about

DO NOT interview the user about codebase facts (file locations, patterns, architecture, who calls what). Use Read/Grep/Glob and the explore agent for those — they are reachable from the working directory.

### Intent Block Gate (hard exit condition)

Before exiting Step 1, the state must be one of:

| State | Action |
|-------|--------|
| **Intent confirmed** — author's goal, approach, and constraints are understood from artifacts and/or interview | Proceed to Step 2 |
| **User explicit deferral** — user says "skip", "그냥 리뷰해줘", "없어", "code quality only", or unambiguous equivalent | Set {REQUIREMENTS} = "N/A — code-quality-only review (user deferred)" and proceed |
| **Non-interactive dispatch (completion-gate)** — the dispatch prompt itself carries a `{gate}-codereview-{sid}.json` artifact path alongside a 5-slot intent payload (`what_was_implemented`/`description`/`requirements`/`project_context`/`non_goals`) | Treat as **Intent confirmed (non-interactive, no user interview)** and proceed to Step 2. Acquisition steps 1-3 (PR/branch artifacts, linked references, codebase signals) still run — they backfill any slot whose value is the `(none provided)` marker. Only step 4 (user interview) is replaced by the payload. |
| **Neither** — artifacts thin and user not yet asked, OR user gave vague answers without explicit deferral | **BLOCK**. Do not proceed. Continue interview until one of the two states above is reached. |

There is no "I tried hard enough, just review" path. The block IS the safety mechanism.

A fresh code-reviewer agent has no ambient session to check for an active artifact path — the non-interactive discriminator above is prompt-borne: whether the dispatch prompt includes the path, not whether a session-scoped artifact happens to exist. This is the same `{gate}-codereview-{sid}.json` signal Step 4 later reads for the named-field placeholder mapping; Step 1 is where it first enters the pipeline. When the signal is absent, the main-session interactive gate above (**Neither** → BLOCK) is unchanged.

### Vague answer refinement

When the user gives a vague answer that is not an explicit deferral, refine ONCE with a specific follow-up:

각 follow-up 메시지는 deferral 옵션을 함께 안내하여 사용자가 "skip / 그냥 리뷰해줘 / 없어" 어휘를 몰라도 escape 가능하도록 한다.

| User says | Follow-up |
|-----------|-----------|
| "대충 있어" / "뭐 좀 있긴 한데" | "어디서 찾을 수 있나요? 링크나 문서 위치를 알려주세요. (답하기 어려우면 'skip'으로 코드 품질만 리뷰 가능)" |
| "그냥 성능 개선이야" | "어떤 지표를 개선하려 했나요? (latency, throughput, memory 등 — 답하기 어려우면 'skip'으로 코드 품질만 리뷰 가능)" |
| "여러 가지 고쳤어" | "가장 중요한 1-2개만 알려주세요. 나머지는 코드에서 식별하겠습니다. (답하기 어려우면 'skip'으로 코드 품질만 리뷰 가능)" |

If refinement still yields a vague answer, surface the block explicitly to the user:

> "의도를 명확히 잡기 어렵습니다. 둘 중 하나를 선택해주세요: (1) [구체적 질문]에 답하여 의도 확정, 또는 (2) 'skip / 코드 품질만 리뷰' 명시적 deferral. 둘 중 하나를 명시하기 전까지 리뷰는 시작하지 않습니다."

This is not adversarial — it is refusing to silently produce a worse review.

### Question discipline

| Situation | Method |
|-----------|--------|
| 2-4 structured choices (review scope, focus areas) | AskUserQuestion tool |
| Free-form / subjective (intent, alternatives, constraints, concerns) | Plain text question |

**One question per message.** Never bundle. Wait for the answer before the next question.

**Question quality** — every question must include either a specific anchor (a summary the user can correct) or a default action in parentheses (so progress is possible without an answer):

| BAD | GOOD |
|-----|------|
| "요구사항이 있나요?" | "PR 본문과 연결된 이슈에서 [요약]을 추출했습니다. 보완할 부분이 있나요?" |
| "어떤 부분을 볼까요?" | "23개 파일이 변경됐습니다. 집중할 영역이 있나요? (없으면 전체 리뷰)" |

### Project Context

Include project context when interpolating the chunk-reviewer prompt template in Step 4. Describe what kind of software this is, who uses it, how it runs, and what depends on it — based on CLAUDE.md, README.md, and the artifacts gathered above.

If available context is insufficient to characterize the project, ask the user once: "What kind of software is this? (e.g., personal CLI tool, internal team service, public-facing API, shared library, etc.)"

### Step 1 Exit Condition

Proceed to Step 2 only when the Intent Block Gate state is **Intent confirmed** or **User explicit deferral**. Any other state → continue at Step 1.

### Bounded derived context (derived expected-items)

By this point `{REQUIREMENTS}` has settled — via interview, the deferral sentinel, or the completion-gate payload. This sub-step adds one more thing to it: **bounded derived context**, a codebase-grounded prediction of expected-items, kept distinct from intent *acquisition* above. "Intent acquisition is non-negotiable" (the Step 1 charter) means received, stated author intent is authoritative; this sub-step instead generates a hypothesis from the codebase's own "Codebase signals" (acquisition step 3) — it does not receive stated intent, it infers from what the codebase already does.

Mirror the same reasoning shape the regression and cleanup finder angles use: name a thing the codebase already establishes, then check whether the change re-establishes it. Here: name a same-role analog already in the codebase, then check whether the change wires the new addition into it the same way. Derive an expected-item only through this named-necessity gate:

| State | Condition | Action |
|-------|-----------|--------|
| Grounded + necessity-named | A citable codebase analog exists with a concrete `file:line`, AND a concrete runtime consequence of the item's absence can be named | **Keep** — emit the derived item |
| Uncertain | Only one of the two holds, or either is fuzzy | **Drop** |
| Neither | No citable analog, no nameable consequence | **never invent** |

For each kept item, emit one bullet carrying four fields — self-labeling for provenance, so the downstream `requirement-gap` finding needs no new field to explain where it came from:

- **Analog (`file:line`)** — the existing code whose role the missing item should mirror
- **Why same role** — why the analog and the missing item play the same structural role
- **Expected item absent here** — what the analog implies should exist in the changed code, and doesn't
- **Runtime consequence of its absence** — what breaks, silently or loudly, if it stays missing

Phrase the bullet itself like "Codebase analog at `file:line` implies `<wiring>`; absent here" — never "a requirement you stated is absent." The label must stay honest: a same-role analog implies wiring that is absent here, not a stated requirement that is absent.

Fold kept items into `{REQUIREMENTS}` as a `Derived Expected Items` sub-block:

- `{REQUIREMENTS}` already holds real content (caller/goal-lane requirements, or the completion-gate dispatch payload's `requirements` field) → **append** the sub-block after it; preserve what's there.
- `{REQUIREMENTS}` holds the deferral sentinel `N/A — code-quality-only review (user deferred)` (set at the Intent Block Gate above) AND at least one item was derived → **replace** the sentinel with the sub-block, so coverage never sees a self-contradictory "N/A" plus derived items.
- Zero items derived → leave `{REQUIREMENTS}` exactly as it was — no empty sub-block, no sentinel change.

This sub-step is unconditional on intent-source: it runs the same way regardless of whether intent came from a live interview, a caller-supplied artifact, the completion-gate dispatch payload, or explicit code-quality-only deferral. It never gates on live-interview-only or on requirements already being present — it derives wherever the codebase grounds an item, and stays silent otherwise.

When the deferral is an explicit *human* code-quality-only deferral (a person typed "skip" / "그냥 리뷰해줘" / "code quality only" at the Intent Block Gate) rather than the completion-gate's non-interactive payload, derived items are still surfaced — always-run holds even here — but their `Runtime consequence of its absence` text carries a short note such as "surfaced despite quality-only deferral," so the one mode where a person actively deferred scope stays framed honestly.

## Step 2: Context Gathering

Collect in parallel (using `{range}` from Step 0):

1. `git diff {range} --stat` (change scale)
2. `git diff {range} --name-only` (file list)
3. `git diff {range} --numstat` (per-file insertion/deletion counts)
4. `git log {range} --oneline` (commit history)
5. CLAUDE.md files: repo root + each changed directory's CLAUDE.md (if exists)

## Step 3: Chunking Decision

Determine scale from `--stat` summary line (`N files changed, X insertions(+), Y deletions(-)`) — of the two line counts, only `X` (insertions), never `Y` (deletions), feeds this decision:

| Condition | Strategy |
|-----------|----------|
| Insertion lines < 2000 AND changed files < 30 | Single review |
| Insertion lines >= 2000 OR changed files >= 30 | Group into chunks by directory/module affinity |

Chunking heuristic: group files sharing a directory prefix or import relationships.

**Per-chunk size guide:**
- Target ~2000 insertion lines per chunk (soft guide — files are the atomic unit)
- If adding the next file exceeds ~2000 insertion lines, start a new chunk
- If a single file alone exceeds ~2000 insertion lines, it becomes its own chunk
- If a directory group is oversized, split by subdirectory; if still oversized (flat structure), batch alphabetically (~10-15 files per chunk)

### Per-Chunk Diff Command Construction

For each chunk, construct the diff command string using git's native path filtering:

```bash
git diff {range} -- <file1> <file2> ... <fileN>
```

The orchestrator constructs this command string for the configured finder CLIs; each finder executes it independently inside the direct job.

## Step 4: Direct Finder-Job Dispatch

1. Read the job prompt template from `${CLAUDE_SKILL_DIR}/../orchestrate-review/scripts/chunk-reviewer-prompt.md`.
2. Interpolate placeholders with context from Steps 0-3:
   - {WHAT_WAS_IMPLEMENTED} ← Step 1 description (interactive) / JSON field `what_was_implemented` (structured-output completion-gate dispatch)
   - {DESCRIPTION} ← Step 1 or commit messages (interactive) / JSON field `description` (completion-gate dispatch)
   - {REQUIREMENTS} ← Step 1 requirements or "N/A - code quality review only" (interactive) / JSON field `requirements` (completion-gate dispatch)
   - {PROJECT_CONTEXT} ← Step 1 project context (interactive) / JSON field `project_context` (completion-gate dispatch); if it resolves to the literal `"(none provided)"` backfill marker, backfill from codebase signals gathered in Step 1 acquisition steps 1-3 (CLAUDE.md/README/ADR)
   - {NON_GOAL} ← Step 1 declared non-goals (interactive) / JSON field `non_goals` (completion-gate dispatch); backfilled to the literal `"(none provided)"` marker when blank
   - {FILE_LIST} ← Step 2 file list
   - {DIFF_COMMAND} ← diff command string: `git diff {range}` (single chunk) or `git diff {range} -- <chunk-files>` (multi-chunk). The orchestrator constructs this string for configured finder CLIs but does NOT execute it.
   - {COMMIT_HISTORY} ← Step 2 commit history

   The five intent placeholders above ({WHAT_WAS_IMPLEMENTED}/{DESCRIPTION}/{REQUIREMENTS}/{PROJECT_CONTEXT}/{NON_GOAL}) source differently depending on mode, discriminated by the completion-gate dispatch signal from Step 1's Intent Block Gate. In structured-output mode (completion-gate dispatch), the Step 1 payload is a JSON object with named fields `what_was_implemented`/`description`/`requirements`/`project_context`/`non_goals` — `JSON.parse` it and read each named field 1:1 into its placeholder above. This is a named-field read, not a blob split — never dump the whole payload into one placeholder. If the payload fails to parse as JSON, do not guess field values from malformed input — stop before starting finder jobs. When the completion-gate dispatch signal is present, first write that `{gate}-codereview-{sid}.json` artifact directly as `{"status": "INCONCLUSIVE", "reviewer": "<reviewer id>", "at": "<ISO timestamp>", "findings": []}` (the code-review artifact schema `skills/{gate}/references/completion-gate.md` defines); if the artifact write itself fails, leave the artifact absent — `request-complete` already refuses on an absent artifact. Then report the parse failure and exit.
3. Before starting any job, derive a deterministic review identity from the real worktree path, base SHA, head SHA, and a stable review-session-id hash of those values. For each chunk, sort its file list and derive a stable chunk key; compute a SHA-256 fingerprint of exactly that chunk's diff. Recompute the same values on recovery. Start with the exact seven committed identity flags and `--attempt 1`:

   Canonical bytes are UTF-8 with no normalization. Resolve `worktreeRealpath` as the physical repository root (`realpath "$(git rev-parse --show-toplevel)"`), `baseSha` as `git rev-parse --verify '<base>^{commit}'`, and `headSha` as `git rev-parse --verify '<head>^{commit}'`. Derive the fixed `mergeBase` reproducibly as `git merge-base <baseSha> <headSha>`. Paths are repository-relative and bytewise sorted. Let `NL` be one LF byte and `H(x)` be lowercase SHA-256 hex of UTF-8 bytes. Compute exactly:

   ```text
   chunkKey = H(sortedPaths joined by NL, followed by NL)
   diffFingerprint = H(raw stdout bytes of
     git diff --no-ext-diff --binary <mergeBase> <headSha> -- <sorted paths>)
   reviewId = H(worktreeRealpath + NL + baseSha + NL + headSha + NL)
   ```

   Exclude stderr from `diffFingerprint`; a nonzero diff exit aborts identity derivation. Use Bun/Node's builtin `crypto.createHash("sha256")` over the exact bytes (never a locale or ambiguous “stable hash”). These formulas and commands are rerun verbatim after interruption. The same path-filtered command is used for a single chunk and for every multi-chunk file list; only `<sorted paths>` differs.

   ```bash
   bun "${CLAUDE_SKILL_DIR}/../orchestrate-review/scripts/job.ts" start \
     --review-id "<reviewId>" --chunk-key "<chunkKey>" --attempt 1 \
     --worktree-realpath "<real worktree path>" --base-sha "<base SHA>" \
     --head-sha "<head SHA>" --diff-fingerprint "<SHA-256>" --timeout 2700 \
     --prompt-file "<interpolated chunk-reviewer-prompt.md>" --json
   ```

   Start every chunk before polling any chunk. `start` returns quickly after detached finder CLIs launch; its `jobDir` is the durable handle. On runtime recovery, rerun the same idempotent start identity only to attach to an existing job. If it reports `identity job is still initializing: <jobDir>`, validate that job's `job.json` identity and continue status/collect on that same directory; never start, delete, or respawn it. A true pre-start with no identity anchor starts once. Never create a new identity/job because the code-reviewer turn was interrupted.

4. Poll every returned `jobDir` with short foreground calls, each no longer than 20 seconds:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/../orchestrate-review/scripts/job.ts" collect --timeout-ms 20000 "<jobDir>"
   bun "${CLAUDE_SKILL_DIR}/../orchestrate-review/scripts/job.ts" status --json "<jobDir>"
   ```

   Continue polling until terminal. Finder runtime is allowed up to 2700 seconds (45 minutes); `poll_again` is expected progress, not failure, and must not trigger an early return or retry. Codex keeps polling in-turn rather than ending the turn to wait.

5. When terminal, read `outputFilePath` values from the results manifest:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/../orchestrate-review/scripts/job.ts" results --manifest "<jobDir>"
   ```

   Merge and deduplicate all finder candidate outputs and Angle Coverage blocks using the existing aggregation contract. Persist the merged candidates atomically to `$OMT_DIR/code-review/<reviewId>/candidates.json` **before** invoking `usage-summary` or `clean`; this file is the recovery point if the code-reviewer is interrupted after collection. Only after persistence run `bun "${CLAUDE_SKILL_DIR}/../orchestrate-review/scripts/usage-summary.ts" "<jobDir>"`, then clean:

   ```bash
   bun "${CLAUDE_SKILL_DIR}/../orchestrate-review/scripts/job.ts" clean "<jobDir>"
   ```

6. Retry only a terminal infrastructure failure, unavailable angle, or diff-command failure. Attempt 2 is a different full tuple: preserve reviewId, chunkKey, worktreeRealpath, baseSha, headSha, and diffFingerprint, changing only `attempt 1` to `attempt 2`; pass all seven flags again. Retry at most once and merge original plus retry outputs. `poll_again`, caller-turn interruption, and an existing `running`/`ready` job are not retry signals. If the retry fails, accept partial coverage under the existing policy.

   ```bash
   bun "${CLAUDE_SKILL_DIR}/../orchestrate-review/scripts/job.ts" start \
     --review-id "<same reviewId>" --chunk-key "<same chunkKey>" --attempt 2 \
     --worktree-realpath "<same real worktree path>" --base-sha "<same base SHA>" \
     --head-sha "<same head SHA>" --diff-fingerprint "<same SHA-256>" --timeout 2700 \
     --prompt-file "<same interpolated chunk-reviewer-prompt.md>" --json
   ```

7. Recovery artifact and aggregation are self-contained. Before cleanup, atomically write `$OMT_DIR/code-review/<reviewId>/candidates.json` using a same-directory temporary file, flush/fsync, then rename. Its schema is:

   ```json
   {
     "schemaVersion": 1,
     "lifecycle": "recoverable",
     "reviewId": "…", "worktreeRealpath": "…", "baseSha": "…", "headSha": "…",
     "expectedChunks": [{"chunkKey": "…", "files": ["…"]}],
     "chunks": [{"chunkKey": "…", "diffFingerprint": "…", "attempts": [{"attempt": 1,
       "jobDir": "…", "terminalState": "done", "candidates": [{"file": "…", "line": 1,
         "summary": "…", "failure_scenario": "…"}],
       "angleCoverage": [{"angle": "correctness", "state": "complete"}]}]}]
   }
   ```

   Validate schemaVersion, `lifecycle === "recoverable"`, exact top identity/chunk set/fingerprints, arrays, terminal state, and that each jobDir is under the orchestrate-review jobs root with matching `job.json` identity (including attempt) when present. Each chunk's attempts are unique and contiguous, exactly `[1]` or `[1,2]`, never more than two. A valid artifact skips all starts only when its lifecycle is recoverable; a missing artifact reuses only validated jobs/results; an invalid artifact is reported/quarantined and never authorizes unvalidated reuse. A retired artifact never skips finder starts: treat it as a completed prior invocation, quarantine it, and create a fresh recoverable artifact for the new review. Attempt 2 may be created only after terminal infrastructure failure and only when no validated attempt 2 exists; persisted `[1,2]` never respawns and both outputs merge. Cleanup interruption never respawns; an already-cleaned job relies on the validated artifact. Persist, then run usage-summary, then clean.

   The artifact is invocation-scoped recovery state, not a cache across independent reviews. Retire it after `findings.md` is durably written and the final findings report is fully synthesized: atomically update `lifecycle` to `"retired"` before returning the report. If the turn is interrupted earlier, leave it `recoverable` so the same invocation can resume. Retiring before the final response may cause an interruption in the narrow retire-to-response window to rerun finders, which is safe; reusing candidates produced from obsolete intent is not.

   Read each manifest `outputFilePath`. Required raw finder fields are `file`, `line`, `summary`, and `failure_scenario`; preserve any additional evidence fields. Normalize paths/locations and deduplicate only when normalized file/location and defect reason match (not title); union unique `found by` angles/evidence and retain the most concrete failure scenario. Emit exactly one coverage record per configured angle, explicitly marking unavailable angles, and require every configured angle to be represented before Phase 2. Do not read the protected orchestrate-review/SKILL.md to perform this aggregation.

**Dispatch rules:**

| Scale | Action |
|-------|--------|
| Single chunk | 1 direct `start` job |
| Multiple chunks | Start all jobs before polling; each gets its own interpolated template with chunk-specific {DIFF_COMMAND} and {FILE_LIST} |

### Result Scope Validation

Each configured finder CLI scans its whole assigned diff through its angle and reports coverage in the Angle Coverage block. A file that produced no candidates is clean, not omitted — never treat an unmentioned file as a coverage gap.

Retry a chunk job only when its terminal result signals an infrastructure failure: a "Partial review"/"Limited review" degradation notice, an Angle Coverage entry marked `Unavailable`, or a reported diff-command failure. Use attempt 2 once at most, preserving the same review identity.
Cap: maximum 1 retry per original chunk; if the retry also fails, accept partial coverage.
After all retries complete, merge all chunk results (original + retry) before proceeding to Step 5.

## Step 5: Verification + Synthesis

After all finder jobs reach terminal state, produce the final findings in two phases: per-candidate inline judgment with selective escalation (Phase 2), and findings synthesis (Phase 3). The terminal deliverable is the **Phase 3 findings text** — no walkthrough, no diagrams, no HTML.

### Phase 2: Candidate Verification (MANDATORY)

Finders surface candidates; they do not judge them. You judge each deduped candidate **inline** — reasoning through the evidence, reading the relevant code in your context, and issuing a confidence score and verdict.

**Config resolution:**

Read `[$CLAUDE_CONFIG_DIR|~/.claude]/settings.json` and `./.claude/settings.json` (project overrides user):
- Resolve `omt.codeReview.escalationConfidenceThreshold` into `<threshold>`; if undefined, use `0.35`
- Resolve `omt.codeReview.escalationKCap` into `<k>`; if undefined, use `3`

**Inline judgment steps:**

1. **Dedup near-duplicates first** (same defect, same location, same reason → keep one, and carry onto it everything the duplicates contributed: the merged `found by` angles, the most concrete failure scenario, and any field only one of them supplied). Merging removes the repetition, never the substance. Deduplication reduces the judgment workload before it starts.
2. **MANDATORY READ: `references/verifier-prompt.md`** — read it before beginning judgment. The verdict ladder (CONFIRMED / PLAUSIBLE / REFUTED), verification method, and the enrichment output contract all live there. Escalated candidates reuse this file as their dispatch prompt.
3. For each remaining candidate, in order:

   **REASONING** — read the code at the issue location (Read/Grep on the candidate file), trace the call chain from the entry point, and check the execution context (threading, dispatch model, runtime configuration). Apply the verdict ladder from `references/verifier-prompt.md`. Reason explicitly before issuing a score.

   **CONFIDENCE** — assign a numeric value in **0.0–1.0** reflecting certainty that the finding is real (1.0 = no doubt, 0.0 = clearly not a bug). This value is **internal only**: it drives the escalation comparison and candidate ranking but is **never serialized into any artifact**.

   **VERDICT** — exactly one of CONFIRMED / PLAUSIBLE / REFUTED (ladder in `references/verifier-prompt.md`).

   For **CONFIRMED** or **PLAUSIBLE** (kept findings), emit the full enrichment inline:

   ```
   VERDICT: <CONFIRMED | PLAUSIBLE>
   TITLE: <short finding title>
   LOCATION: <file>:<line> — <section / function name>
   CURRENT CODE:
   <5-15 lines centered on the issue>
   WHAT'S WRONG: <the problem, grounded in the quoted line>
   FAILURE SCENARIO: <concrete inputs/state -> wrong output, crash, or lost effect; for a cleanup finding, the concrete cost>
   FIX: <concrete diff, or design direction if structural>
   BLAST RADIUS: <grep/reference evidence — what else references this, or "This location only">
   AC: <the candidate's acceptance criterion / inferred intent — omit this line entirely when it carries none>
   FOUND BY: <angle(s)>
   ```

   For **REFUTED**, emit a one-line note:

   ```
   VERDICT: REFUTED — <one line quoting the line/guard/invariant that proves it is not a bug>
   ```

4. **Escalation** — after all inline judgments complete, collect candidates where `confidence < omt.codeReview.escalationConfidenceThreshold`:
   - If the count exceeds `omt.codeReview.escalationKCap`, take the `<k>` lowest-confidence candidates for escalation; the overflow candidates **keep their inline verdict** and are **surfaced in Phase 3** — never silently dropped.
   - For each escalated candidate, interpolate `references/verifier-prompt.md` with the candidate's fields and dispatch a `general-purpose` subagent via the Task tool (`subagent_type: "general-purpose"`). **All escalated candidates in ONE response** — parallel, foreground.
   - The escalated verifier's verdict is **FINAL** and **supersedes** the inline tentative verdict in Phase 3.

**Cap & batching:** judge at most **25 candidates per batch** inline. If more survive dedup, batch by file proximity, **correctness candidates first**, and state how many were deferred — never silently drop.

### Phase 3: Findings Synthesis (report-only)

This is a **report**. You surface verified findings, ranked by what matters most. You do NOT decide whether to merge and you do NOT decide whether to fix — that is the reader's call.

1. **Merge** verified findings that describe the same defect (same root cause, across chunks) — combine their evidence and note the corroborating angles. (Near-duplicates within a chunk were already deduped before verification.)
2. **Class** each finding by the angle that found it — the angle→class mapping is 1:1: the **correctness** angle → **correctness** (the change behaves wrong), the **regression** angle → **regression** (previously-working behavior the change breaks), the **cleanup** angle → **cleanup** (behaves correctly but is low quality), the **requirement** angle → **requirement-gap** (an AC or stated requirement is absent — the behavior is missing, not wrong). A finding corroborated by multiple angles takes the class of the angle whose lens names its defect mechanism.
3. **Impact** each finding: read its full 7-field card (failure scenario + blast radius) and assign the FIRST grade below whose test matches — verdict measures confidence; impact measures harm, and you are its assigner (finders and verifiers never grade it):
   - **LOW** — everything the finding touches lives in material that never reaches a user: docs, comments, internal naming, log wording, duplicated code. Judge by what the fix would touch, not by which angle found it, how certain the verdict is, or whether an acceptance criterion names it — a CONFIRMED docs-only finding required by an AC is still LOW.
   - **HIGH** — data loss/corruption; money; auth/permissions; a working feature regressed; user-reaching behavior an AC requires that was never implemented; a user-facing crash; unrecoverable damage.
   - **MEDIUM** — wrong behavior only under specific conditions; performance degradation; observable but recoverable; a regression-detection gap.

   When no test above clearly matches, fall back to the angle default: **correctness** MEDIUM; **regression** HIGH; **cleanup** LOW (never HIGH); **requirement** HIGH for unimplemented user-reaching behavior, MEDIUM for behavior implemented but unverified.
4. **Rank** most-significant first: **HIGH, then MEDIUM, then LOW impact**; within a grade, **CONFIRMED before PLAUSIBLE**.
5. **Cap**: keep the most significant findings. If a review produced an unwieldy number, keep the top ~15 and state how many were dropped — never silently truncate.
6. **Pre-existing**: a candidate on an unchanged context line is tagged `[Pre-existing]` and listed under Out of Scope — unless the change aggravates it (increases blast radius or frequency), in which case it stays in the main list.
7. **Persist the cards**: write every kept finding's full enrichment (the 7-field card from `references/verifier-prompt.md`'s output contract, plus its class and impact) to `$OMT_DIR/code-review/<review-session-id>/findings.md` — the same session directory `candidates.json` lives in. The summary tuples elsewhere are cut from these cards; this file is what makes a finding re-adjudicable after the review ends.

#### Edge Cases

| Situation | Handling |
|-----------|----------|
| Finding references a deleted file | Read the file at base branch (`git show {base}:{file}`). Note "(deleted file)" in Context. |
| Finding spans multiple files | Primary file gets the code snippet. Other files listed in Blast Radius with brief context. |
| Fix cannot be expressed as simple diff | State design direction + "Concrete diff not possible — structural change required". |
| Zero findings after verification | Report a clean review: "No findings survived verification." |
| 50+ candidates requiring verification | Dispatch verifiers in batches per Phase 2 (≤25), correctness candidates first. |

### Terminal Output

This is a **report**. It does not gate. There is no Assessment / "Ready to merge" section, and there is no HTML — the deliverable is the Phase 3 findings as terminal text.

**Exception — completion-gate dispatch.** When the completion-gate dispatch signal from Step 1's Intent Block Gate is present, the deliverable is that `{gate}-codereview-{sid}.json` artifact, not terminal text: write the ranked findings there as `{"status": "COMPLETE", "findings_report": "<the findings.md path from Phase 3>", "reviewer": …, "at": …, "findings": [{"class", "verdict", "impact", "ref"}]}` — the schema `skills/{gate}/references/completion-gate.md` defines, and the same one the payload-parse-failure `INCONCLUSIVE` write in Step 4 uses. Every finding carries all four fields; the gate refuses the whole artifact when any finding lacks `impact`, exactly as it refuses a missing `status`. The caller reads only that file; it never transcribes returned text, so ending a completion-gate dispatch with terminal text alone deadlocks it on an absent artifact.

Emit the ranked findings directly: each finding carries its verdict (CONFIRMED / PLAUSIBLE), class (correctness / cleanup / requirement-gap), `file:line`, and enriched evidence (current code, what's wrong, failure scenario, fix, blast radius — the enrichment shape from `references/verifier-prompt.md`, produced inline for non-escalated findings or by the escalated verifier for superseded ones). Pre-existing findings go under Out of Scope. This findings text is also the handoff contract consumed by any caller that dispatches a code-reviewer agent that runs this skill — do not invent a different format.

## Reference Files (on-demand)

These files live in `references/` alongside this skill. Each is loaded only when the workflow reaches the step that needs it — do not preload all of them.

| Reference file | What it contains | When to read |
|---|---|---|
| `references/verifier-prompt.md` | The per-candidate verifier contract: verdict ladder (CONFIRMED / PLAUSIBLE / REFUTED), verification method, read-only constraint | Phase 2 — before dispatching verifier subagents |
