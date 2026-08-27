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
- Running a general raw `git diff` command (the Step 3 candidate-scoped integrity exception is the only text-inspection carve-out)

### Context Budget

**Allowed in orchestrator context:**
- `["git", "diff", range, "--stat"]` output
- `["git", "diff", range, "--name-only", "-z", "--no-renames"]` output
- `["git", "diff", range, "--numstat", "-z", "--no-renames"]` output
- `["git", "log", range, "--oneline"]` output
- CLAUDE.md file content
- chunk-reviewer results (candidate findings)
- Phase 2 inline judgment output (reasoning, verdicts, enriched findings for non-escalated candidates)
- Escalated verifier subagent verdicts + enriched findings (Phase 2, candidates below confidence threshold)
- Code reading via Read/Grep for Phase 2 inline candidate judgment

The orchestrator never inspects, loads, or displays diff text as general raw-diff review input. The candidate-scoped diff inspection exception in Step 3 is for integrity judgment only: for each candidate derived file, read only the candidate-scoped diff using the argv-safe argument vector or separately quoted Bash form specified in Step 3 and compare its changed bytes with authored source/generator evidence. Its diff result is not forwarded to a finder prompt, candidate aggregation, or general orchestrator context. This exception does not permit project tests, builds, linters, formatters, migrations, or other project execution, and it does not relax the ban on general raw diff text. The separate prescribed binary `git diff --no-ext-diff --binary ...` stdout byte stream flows directly to SHA-256 outside model context for `diffFingerprint`; stderr is excluded and a nonzero exit aborts. Finder jobs execute the review diff from the prompt.

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

All subsequent steps use `{range}` from this table. All subsequent commands that receive range or path values must use argv-safe arguments; if Bash is required, quote each dynamic value as a separate argument. After checkout, code reading via Read/Grep/Glob reflects the **post-change** state, which is the intended behavior — diff shows the delta, the working directory shows the result.

### Early Exit

After the range is resolved and (PR mode) the checkout is done, before proceeding to Step 1:

1. Run `["git", "diff", range, "--stat"]` (using the range determined above)
2. If empty diff: report "No changes detected (between <base> and <target>)" and exit immediately
3. If the diff is binary-only: report "Only binary file changes detected"; use the complete `--name-only` manifest to list every binary changed path under Out of Scope (one entry per path), state that you do not dispatch a finder job, and then exit

Early Exit runs before intent acquisition on purpose — an empty diff exits immediately; a binary-only diff reports its paths under Out of Scope and exits without dispatching a finder job.

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

1. `["git", "diff", range, "--stat"]` (change overview; not the scale input)
2. `["git", "diff", range, "--name-only", "-z", "--no-renames"]` (file list)
3. `["git", "diff", range, "--numstat", "-z", "--no-renames"]` (per-file insertion/deletion counts)
4. `["git", "log", range, "--oneline"]` (commit history)
5. CLAUDE.md files: repo root + each changed directory's CLAUDE.md (if exists)

Parse raw stdout as NUL-delimited records from both manifest commands. Never use newline, line, or word splitting, and never use shell command substitution. A name-only record is one path; a numstat record splits only its first two tab fields while preserving the remainder as the path. This preserves arbitrary Git pathnames, including newline, tab, quote, and backslash filenames. `--no-renames` avoids old/new pair ambiguity by emitting separate single-path records for each side of rename/copy changes.

## Step 3: Chunking Decision

### Derived-artifact partition (runs first)

Before partitioning, preserve the complete changed-file manifest from `--name-only` as `completeChangedFileManifest`. Build a separate `reviewableFileList` only after the integrity pass decides which paths remain reviewable; never use the complete manifest as finder scope. Then split that manifest into **reviewable source** and **derived artifacts**. A derived artifact is a file a build / codegen / lock / migration step mechanically (re)generates from other tracked source — you would never hand-edit it, so its diff is a tool's output, not an authored decision. This is ecosystem-agnostic; recognize it by the **category**, not a fixed filename list:

- **Regenerable, not authored** — a command in the repo reproduces it (bundler, code generator, lockfile resolver, ORM schema-snapshot dumper).
- **Carries a machine header** — `@generated`, `DO NOT EDIT`, Go's `Code generated by … DO NOT EDIT.`, and equivalents in any language.
- **A dependency lockfile or a conventionally-generated path** — across ecosystems: `pnpm-lock.yaml` / `Cargo.lock` / `go.sum` / `gradle.lockfile` / `poetry.lock` / `composer.lock` / `Gemfile.lock`; build output under `dist/` · `build/` · `target/`; codegen such as `**/__generated__/**`, `*.pb.go`, `*_pb2.py`, `*.g.kt`; ORM migration snapshots like Drizzle's `**/migrations/meta/*_snapshot.json` · `_journal.json`.

The filenames above are illustrations of the three categories, not a closed list — a Kotlin / Java / Go / Rust / Python project's generated files match the same categories under different names.

**Initial classification:** candidate derived artifacts are not yet excluded until the integrity pass completes.

**Partition per file, not per directory — keep the authored delta beside the generated state.** Exclude only the mechanically-generated file, never the hand-authored change it came from. The generated schema *snapshot/dump* is excluded; the authored migration or DDL beside it stays reviewable. The same split holds for any ORM in any language — drop the snapshot, review the migration: Drizzle's `meta/*.json` (excluded) vs its `NNNN_*.sql` and schema source (reviewable; the migration can carry destructive DDL); a Rails `schema.rb` dump vs its migration; a jOOQ/Diesel generated schema vs its migration.

**Judgment carve-out — re-include when intent makes content meaningful.** Recognition is mechanical; exclude-vs-keep is gated on intent. A derived file returns to review when intent or an angle makes its bytes matter: a lockfile diff that intent frames as a dependency bump or supply-chain concern, or a generated file whose output shifted in a way the authored source change does not explain. When intent is silent and there is no such angle, exclude and note it — do not spend a finder job on generator output by default.

### Derived-output integrity (before exclusion)

Keep the two manifests as separate values. Never substitute one for the other. Before exclusion and before any path-filtered finder command, inspect each candidate derived file in the complete changed-file manifest against authored source/generator evidence. For each candidate, read only this candidate-scoped diff:

Execute this candidate-scoped diff through Bash. The preferred form is argv-safe direct process execution with the argument vector `["git", "--literal-pathspecs", "diff", "--binary", "--no-ext-diff", "--no-textconv", range, "--", candidatePath]`; if Bash must run the command, quote the diff range and candidate path as separate arguments:

```bash
git --literal-pathspecs diff --binary --no-ext-diff --no-textconv "$range" -- "$candidatePath"
```

Raw interpolation is forbidden. Git's `--` is only the revision/pathspec separator; it does not disable Git pathspec magic, external diff drivers, or textconv filters. `--literal-pathspecs` must be before `diff`; `--binary` is required, and `--no-ext-diff` and `--no-textconv` are required for this candidate integrity read. `--literal-pathspecs` treats the candidate path literally and is not shell escaping. These rules apply even when a changed filename contains spaces, shell metacharacters, command substitution, or newlines, including `:(exclude)*`.

This candidate-scoped diff inspection exception is for integrity judgment only. Compare the changed bytes with authored source/generator evidence to decide whether the output is meaningful, stale, manually altered, or otherwise unexplained. Its diff result is not forwarded to a finder prompt, candidate aggregation, or general orchestrator context. Project tests, builds, linters, formatters, migrations, and other project execution remain forbidden. A `.d.ts` is excluded only with generated evidence; an authored `.d.ts` remains reviewable and contributes to `reviewableInsertionLines`. Authored migrations and DDL remain reviewable, including when a neighboring migration snapshot is derived.

After this integrity pass and partition, finalize `reviewableFileList`; derive `reviewableFileCount` from the reviewable files and `reviewableInsertionLines` from their `--numstat` insertion counts. Derived artifacts do not satisfy the changed-file threshold.

**Handling:** derived artifacts are excluded from the insertion-line scale count and are never assigned to a chunk or finder job — a 5,000-line `*_snapshot.json` must not inflate the scale decision or consume finder budget. They are **not** silently dropped: list them under Out of Scope in the report (synthesis item below) so the reader sees they changed and were not line-reviewed. Re-included outputs are reviewed as exact files instead.

### Zero-reviewable-files review

This is a valid zero-reviewable-files review. If `reviewableFileCount` is 0, do not dispatch a finder job, do not create an empty chunk or pathless diff, report all changed derived artifacts under Out of Scope, and explicitly report that this is not a single empty chunk.

### Scale

Determine scale from the **reviewable subset** using the derived values — of the two line counts, only `X` (insertions), never `Y` (deletions), feeds this decision:

| Condition | Strategy |
|-----------|----------|
| `reviewableInsertionLines` < 2000 AND `reviewableFileCount` < 30 | Single review |
| `reviewableInsertionLines` >= 2000 OR `reviewableFileCount` >= 30 | Group into chunks by directory/module affinity |

Chunking heuristic: group files sharing a directory prefix or import relationships.

**Per-chunk size guide:**
- Target ~2000 insertion lines per chunk (soft guide — files are the atomic unit)
- If adding the next file exceeds ~2000 insertion lines, start a new chunk
- If a single file alone exceeds ~2000 insertion lines, it becomes its own chunk
- If a directory group is oversized, split by subdirectory; if still oversized (flat structure), batch alphabetically (~10-15 files per chunk)

### Per-Chunk Diff Command Construction

For each non-empty chunk, construct the path-filtered finder command using git's native path filtering and execute it through Bash. The preferred form is argv-safe direct process execution with the argument vector `["git", "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", range, "--", ...chunkPaths]`; if Bash must run the command, quote the diff range and every chunk path as separate arguments:

```bash
git --literal-pathspecs diff --no-ext-diff --no-textconv "$range" -- "$file1" "$file2" ... "$fileN"
```

Raw interpolation is forbidden. Git's `--` is only the revision/pathspec separator; it does not disable Git pathspec magic, external diff drivers, or textconv filters. `--literal-pathspecs` must be before `diff` and is not shell escaping; `--no-ext-diff` and `--no-textconv` are required for the finder command. Apply literal pathspec handling to every chunk path, including `:(exclude)*`; finder output needs no binary-patch mode. The orchestrator constructs this safely for the configured finder CLIs; each finder executes it independently inside the direct job.

## Step 4: Direct Finder-Job Dispatch

1. Read the chunk-reviewer prompt template and interpolate the existing inputs: {WHAT_WAS_IMPLEMENTED}, {DESCRIPTION}, {REQUIREMENTS}, {PROJECT_CONTEXT}, {NON_GOAL}, {FILE_LIST}, {DIFF_COMMAND}, and {COMMIT_HISTORY}. Set {FILE_LIST} to the current chunk's reviewable files only; {DIFF_COMMAND} is constructed from that same chunk list. Never pass the complete changed-file manifest or derived-artifact Out of Scope list as finder scope. Preserve the named-field completion-gate parsing and result aggregation/angle coverage semantics used by later phases.
2. Each independent review receives one fresh cryptographically random, path-safe `invocationId`; never derive it from content or reuse it. Before any finder starts, durably persist a frozen invocation manifest containing the target, resolved launch context, chunk plan, and required job metadata. Recovery uses that ID and frozen values; conflicting state is rejected, not reused.
3. The logical job key is `(invocationId, chunkId, attempt)`. Same keys idempotently attach; different invocation IDs never share jobs or artifacts. Validate ownership and path containment on recovery, attaching rather than respawning. If `invocationId` is lost, safely start a new independent review rather than rediscovering by content. Pass commands, paths, and external values safely; use argv-safe direct process execution as the preferred form. If Bash is required, quote the range and every path explicitly; raw interpolation is forbidden.
4. Start every chunk before polling. Poll each direct `job.ts` job (`start`, `collect`, `status`, `results`) to terminal. Poll progress, interruption, or a running/ready job is never a retry. Attempt 2 is allowed once only for terminal infrastructure failure, unavailable angle, or diff-command failure; preserve the same invocation/chunk identity, merge original and retry outputs, and accept partial coverage if both fail.
5. Read every terminal output, merge and deduplicate candidates by normalized location and defect reason, union `found by` angles/evidence, and emit one coverage record per configured angle (including unavailable angles). Atomically persist `candidates.json` before `usage-summary`. Leave job cleanup to GC/orphan reaper; do not run `clean`.
6. Use the existing direct finder CLIs and prompt interpolation; do not dispatch chunk-reviewer subagents. Keep the review static-only and preserve all raw finder fields required by the aggregation contract.

**Dispatch rules:**

| Scale | Action |
|-------|--------|
| Single chunk | one direct `start` job |
| Multiple chunks | start all jobs, then poll and merge all terminal results |

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
7. **Derived artifacts**: files the Step 3 partition ultimately excluded are listed once under Out of Scope as "Excluded from review (derived artifacts): `<files>`" — surfaced so the reader knows they changed and were not line-reviewed, never silently omitted; any re-included file is removed from this list and reviewed as an exact file.
8. **Persist the cards**: write every kept finding's full enrichment (the 7-field card from `references/verifier-prompt.md`'s output contract, plus its class and impact) to `$OMT_DIR/code-review/<invocationId>/findings.md` — the same invocation directory `candidates.json` lives in. The summary tuples elsewhere are cut from these cards; this file is what makes a finding re-adjudicable after the review ends.

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
