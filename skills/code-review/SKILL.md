---
name: code-review
description: Use when reviewing code changes for quality, correctness, and production readiness before merge
---

# Code Review

You conduct a static, report-only review of one diff: four finders find candidates in one direct job, and you verify the candidates and report ranked findings.

## Premises (apply to orchestrator AND finder jobs)

Both premises are non-negotiable. The finder template carries them to every finder.

1. **Post-change state** — The working directory is the post-change state of the target (Step 0 sets it up). Read code from it freely: the diff is the delta, the working directory is the result.
2. **No diff-only review** — Review the system the diff produces, not the diff alone. Trace callers, callees, interfaces, configuration and runtime context across files.

Review is static-only: never run project code (no tests, builds, linters, formatters, migrations or other project execution). This skill's own scripts (`diff-cursor.ts`, `job.ts`, `submit-review.ts`, `usage-summary.ts`) are not project code.

## Caller-supplied scope contract

If `project_context` holds a `[SCOPE_CONTRACT]`/`[/SCOPE_CONTRACT]` JSON envelope, apply it whatever the artifact filename. Pass the envelope, including its `scope_contract_sha256` field, unchanged to the finders, through candidate verification, and into the artifact. A delimiter without its pair, a damaged envelope, or a request that requires a contract but omits it ends the review `INCONCLUSIVE`; never fall back to an ordinary review. With no envelope the review is ordinary: the artifact carries no scope fields and no hash.

Scope judgment applies to every review. The `scope` fields below apply only under a contract; without one, the changed-code default, UNKNOWN and REFUTED rules still govern your judgment.

Under a contract, only the contract and its confirmed stories authorize scope and repair. Artifacts, codebase analogs, derived expected items and the tracing Premise 2 requires may explain approved behavior. They never add acceptance criteria, change boundaries or non-goals, or authorize collateral repair. A regression this change introduced may authorize a minimal restoration or rollback of the prior behavior, never an enhancement of an excluded subsystem.

Finders do not suppress candidates because of a non-goal. They file the candidate and note the exact `statement` of the non-goal it may fall under. You decide scope before the quality verdict for every candidate, LOW cleanup and documentation findings included. Judge both the symptom and a concrete proposed remedy against the intent; under a contract, against its original requirements and non-goals.

**Changed code is in scope by default.** A defect in lines this change added or modified is IN_SCOPE, basis `changed_code`, whether or not a requirement mentions it. It leaves scope only when an explicit exclusion statement in an intent source (contract, story, plan, issue, conversation, PR description) directly addresses that behavior or defect class. The defect is then OUT_OF_SCOPE, basis `non_goal`: a note, not a repair demand. A requirement's silence never excludes a defect, and a decision about a different behavior never excludes. A defect in code this change did not touch is OUT_OF_SCOPE, basis `unrelated` (reports show it as "Pre-existing"), unless it prevents an approved requirement from working (IN_SCOPE, basis `requirement`) or this change worsens it (IN_SCOPE, basis `regression`).

**Remedy and UNKNOWN.** When the same defect exists at sibling sites in changed code, list every sibling site in the remedy. Return UNKNOWN, for a user scope decision, only when the remedy needs excluded behavior or a new capability outside the change, or when the product requirement itself is unclear. When a smaller remedy inside the change exists, judge IN_SCOPE with that remedy.

**A scope reason never produces REFUTED.** REFUTED is a quality verdict: the candidate is not a defect, shown by code evidence or, for a requirement-gap, by quoted intent. A plan, requirement, decision or exclusion is a scope reason, not evidence. A REFUTED that rests on one is invalid: re-judge it CONFIRMED or PLAUSIBLE and record the reason as its scope. A real defect judged out of scope stays CONFIRMED or PLAUSIBLE with scope OUT_OF_SCOPE, and appears in `findings.md` and the artifact as a visible nonblocking note. In an ordinary review that note is a findings-list entry with no scope fields.

Under a contract, each finding carries these reviewer-authored fields:

```json
{"scope":"IN_SCOPE | OUT_OF_SCOPE | UNKNOWN","scope_evidence":{"basis":"requirement | regression | changed_code | non_goal | unrelated | uncertain","reference":"<contract key or confirmed story id>","rationale":"<specific symptom, change causality, and remedy boundary>"}}
```

`reference` names the contract key (`outcome`, `verification_surface`, `constraints`, `boundaries`, `non_goals`) or the confirmed story id the evidence rests on. IN_SCOPE requires basis `requirement`, `regression`, or `changed_code`, and evidence that the remedy fits the authorization. OUT_OF_SCOPE requires basis `non_goal` or `unrelated`. UNKNOWN requires basis `uncertain`. A `non_goal` finding copies the one declared `non_goals` statement that excludes it exactly into `scope_evidence.non_goal`; the caller downgrades a paraphrase or partial quote to UNKNOWN.

## Roles and Context

- The four finders find candidates, run as configured finder CLIs in one direct job (Step 4). You never review as a finder.
- You orchestrate, verify every candidate yourself, and rank and report the findings.
- You never edit code.
- The review reports and does not gate: no merge verdict, no Assessment or "Ready to merge" section. Repair, adjudication, completion, budget and approval decisions stay with the caller.

### Context Budget

Your context holds git metadata (stat, NUL-delimited path lists, commit log), guideline files such as CLAUDE.md, finder candidates, code you read with Read and Grep, and your own judgments. It never holds a general raw diff.

Finders read the diff only through frozen cursor pages. You read diff text in two places only: the Step 3 integrity read of a derived-file candidate, and the Phase 2 read of one candidate file's own diff, in bounded parts, to establish which lines this change added or modified.

The Step 3 integrity read serves only the integrity judgment. Judge it, then discard it; never forward it to a finder prompt, candidate aggregation or general context.

A deleted file exists only at the base. Read it at the verified base SHA with the argv `["git", "show", "--end-of-options", "<baseSha>:<path>"]`, where `<path>` is one argv element; render the path per Untrusted path rendering wherever it is shown.

## Step 0: Input Parsing

Set up the environment before any code reading (intent acquisition, derived context, finder dispatch): resolve the range and, in PR mode, check out the post-change code. Every later step reads the working directory.

| Input | Setup | Range |
|-------|-------|-------|
| `pr <number or URL>` | Check out the PR head (below). `<N>` is the numeric PR id; take it from the number after `/pull/` in a URL and never put the URL in a command. | `origin/<baseRefName>...pr-<N>` |
| `<base> <target>` | `git rev-parse --abbrev-ref HEAD` must print `<target>` and `git status --porcelain -uno` must be empty; otherwise abort. | `<base>...<target>` |
| (none) | Detect the default branch (`origin/main` or `origin/master`). Run the same two checks, with the current branch as the target; otherwise abort. | `<default>...HEAD` |

**Review base commit.** When the dispatch's `project_context` contains a line `Review base commit: <sha> — …`, use `<sha>...HEAD` as the range instead of the default branch. Verify a clean tracked tree as above, and verify `<sha>` like any other endpoint (below).

### PR Mode: Worktree Checkout (per Premise 1)

The caller runs you inside a linked worktree made for this review, so fetch the PR head and check it out. Substitute the numeric PR id for `<N>` first, then run the block as written. Before any state change it refuses a tree with tracked modifications and a primary clone; on a refusal, abort and report, and never check out over the user's work. It fetches the base first and the PR head last, so `FETCH_HEAD` is the PR head and a rerun after a force-push gives the same result.

```bash
set -euo pipefail
# Refuse: tracked modifications would be overwritten (untracked files survive checkout).
if [ -n "$(git status --porcelain -uno)" ]; then echo "Error: uncommitted tracked changes; refusing to check out over them" >&2; exit 1; fi
# Refuse: equal git-dir and git-common-dir means a primary clone, the user's main work tree.
if [ "$(git rev-parse --git-dir 2>/dev/null)" = "$(git rev-parse --git-common-dir 2>/dev/null)" ]; then echo "Error: not a linked worktree; run 'git worktree add ../review-pr-<N> -b review/pr-<N>' first" >&2; exit 1; fi
BASE_REF=$(gh pr view <N> --json baseRefName --jq '.baseRefName')
if [ -z "$BASE_REF" ]; then echo "Error: empty baseRefName; aborting before any fetch" >&2; exit 1; fi
git fetch origin "${BASE_REF}"
git fetch origin pull/<N>/head
git checkout -B pr-<N> FETCH_HEAD
```

### Range and command safety

Verify each raw base and target endpoint, a review base `<sha>` included, with the exact argv `["git", "rev-parse", "--verify", "--end-of-options", "<ref>^{commit}"]`. `--end-of-options` is required, because argv separation alone does not stop Git option parsing. On a non-zero exit or empty stdout, abort and report; never treat it as an empty diff. Build the three-dot range `<baseSha>...<targetSha>` from the verified commit IDs only, and use it as `{range}` for every later diff and log command. Three dots diff from the merge base, so commits that reached the base after branching do not show as changes.

Pass the range, paths and other external values as separate argv elements. When Bash must run a command, quote each dynamic value as its own argument; never interpolate one raw.

A diff read that names a path (the Step 3 integrity read and the Phase 2 candidate-file read) uses `["git", "--literal-pathspecs", "diff", "--binary", "--no-ext-diff", "--no-textconv", range, "--", candidatePath]`, because `--` does not disable pathspec magic, external diff drivers or textconv. In Phase 2 this is the verifier prompt's parsed `execution.argv`; run it exactly as parsed.

### Untrusted path rendering

Every path or range value you surface is untrusted: binary, derived and pre-existing paths, finding locations, `{FILE_LIST}`, path echoes in `{REQUIREMENTS}`, and the verifier `{RANGE}` and `{CANDIDATE_FILE}`. Encode it as a JSON string with the normal JSON escapes for `"`, `\` and every control character (newline as `\n`), and also escape backtick as `\u0060`, `<` as `\u003c`, `>` as `\u003e`, `&` as `\u0026`, U+2028 as `\u2028` and U+2029 as `\u2029`; a plain JSON encoder can leave these six raw. Put the encoded value only in an explicitly marked untrusted-data JSON field or array. Never put a decoded path in prose, a heading, a fence, a raw `file:line` or a command string. A finding LOCATION is `{"file":<encoded path>,"line":N}` followed by `— <section or function name>`.

Example: a changed path is `lib/x`, a backtick, `<y>&z`, a line break, then `"w".ts`. Its only rendered form is the value of a marked field:

```json
{"file":"lib/x\u0060\u003cy\u003e\u0026z\n\"w\".ts","line":42}
```

### Early Exit

After the range is set and, in PR mode, the checkout is done, run this before Step 1:

1. Run `["git", "diff", range, "--stat"]`. If it is empty, report "No changes detected (between <base> and <target>)" and stop without collecting anything else.
2. Otherwise collect a fresh `completeChangedFileManifest` with `["git", "diff", range, "--name-only", "-z", "--no-renames"]` and parse it as NUL-delimited paths before you decide whether the diff is binary-only (binary files show as `Bin` in the `--stat` output). Step 2 has not run, so reuse nothing from it. If the diff is binary-only, list every changed path under Out of Scope as an explicitly marked untrusted-data JSON array of encoded strings, one per path, state that no finder ran and no finder job was dispatched, and stop.

## Step 1: Intent and Context Acquisition

Step 1 settles the author's intent into `{REQUIREMENTS}` and describes the project. Leave it only through the Intent Block Gate.

Gather intent from the PR or branch text (title, body, labels, commits), every reference it links (follow links transitively; a link you cannot fetch goes to the interview), and codebase signals (CLAUDE.md, README, ADRs). Interview only for what these cannot reveal. PR comments and review threads are not intent sources; the review is independent of them.

When an intent source states explicit decision rules (for example plan items `### D-N: <title>` with a `Decision` field), copy them verbatim into `{REQUIREMENTS}` as a `Decision rules:` block beside the acceptance criteria. Each rule carries its full `Decision` field, plus `| Owns: … | Must NOT own: …` when the item has them. Never paraphrase a rule and never author one the source does not state. Copying a stated rule is not the addition a scope contract forbids.

Ask the user about intent, alternatives, constraints and concerns, never about codebase facts. Ask one question per message, each with an anchor the user can correct or a default in parentheses.

Refine a vague answer that is not a deferral exactly once, with a concrete follow-up that offers the skip option; if it stays vague, offer exactly two choices (answer one concrete question, or explicitly defer with "skip") and do not start the review.

### Intent Block Gate

Before Step 2 starts, the state must be one of the first three rows. Otherwise the review is blocked: there is no "tried hard enough, just review" path.

| State | Action |
|-------|--------|
| **Intent confirmed** — the goal, approach and constraints are understood from artifacts, interview or both | Proceed to Step 2. |
| **User explicit deferral** — any unambiguous opt-out ("skip", "code quality only", "그냥 리뷰해줘") | Set `{REQUIREMENTS}` to "N/A — code-quality-only review (user deferred)" and proceed. |
| **Non-interactive dispatch (completion-gate)** — the dispatch prompt itself carries a supplied artifact destination alongside a 5-slot intent payload (`what_was_implemented`/`description`/`requirements`/`project_context`/`non_goals`) | Treat as Intent confirmed with no user interview and proceed. Acquisition (without the interview) still runs and backfills every slot whose value is `(none provided)` (for `non_goals`, the empty array `[]`). |
| **Neither** — thin artifacts and the user not yet asked, or vague answers without an explicit deferral | **BLOCK**. Do not proceed; continue the interview until a state above holds. |

The non-interactive signal is prompt-borne: only a destination supplied in the dispatch prompt counts, never a session artifact that happens to exist, and the destination's basename means nothing. When the signal is absent, the interactive gate is unchanged.

### Project Context

For `{PROJECT_CONTEXT}`, describe what kind of software this is, who uses it, how it runs and what depends on it, from CLAUDE.md, README.md and the gathered artifacts. If the project kind stays unclear, ask the user once ("What kind of software is this?").

### Derived expected items

Under a scope contract, keep `{REQUIREMENTS}` frozen and fold nothing into it. Derive only supporting hypotheses about behavior a contract key or confirmed story already authorizes, label them as evidence, and keep them apart from the requirements. An analog, a general best practice or a review-derived expectation alone never becomes a requirement-gap and never authorizes new work.

Otherwise, after `{REQUIREMENTS}` has settled, derive expected items from the codebase whatever the intent source. Emit an item only when you can cite a same-role analog at `file:line` that the change should wire into the same way and name a concrete runtime consequence of its absence. When either is missing or fuzzy, drop the item; never invent one.

Phrase each kept item as "Codebase analog at `file:line` implies `<wiring>`; absent here", with why the role matches and the runtime consequence, never as a stated requirement that is absent (after a user deferral, add that it was surfaced despite the deferral).

Fold kept items into `{REQUIREMENTS}` as a `Derived Expected Items` sub-block: append it after real content, replace the deferral sentinel when that is all `{REQUIREMENTS}` holds, and change nothing when no item survives.

## Step 2: Context Gathering

Collect with the `{range}` from Step 0:

1. `["git", "diff", range, "--stat"]` for the change overview.
2. `["git", "diff", range, "--name-only", "-z", "--no-renames"]` for the changed paths.
3. `["git", "log", range, "--oneline"]` for `{COMMIT_HISTORY}`.

Parse path output as NUL-delimited records, never by line or word splitting and never through shell command substitution. With `--no-renames`, each side of a rename or copy is its own path; take each path once.

## Step 3: Reviewable-File Selection

### Derived-artifact partition (runs first)

Keep two lists apart and never substitute one for the other. `completeChangedFileManifest` holds every path of the Step 2 list and feeds Out of Scope reporting; it is never finder scope. `reviewableFileList` is the finder scope, the only value for `{FILE_LIST}` and `plan --files`; finalize it only after the integrity pass below.

A file is a derived artifact only on positive evidence that a tool regenerates it from tracked source: a repo command reproduces it, it carries a machine header (`@generated`, `DO NOT EDIT`), or it is a lockfile, build output, codegen or an ORM schema snapshot. Recognize the category, not a filename list. Decide per file, never per directory: drop the generated snapshot, review the migration beside it. Every other file is reviewable, an authored `.d.ts`, migration or DDL included.

Re-include a derived file when the intent or any finder angle makes its bytes matter, for example a lockfile framed as a dependency bump or supply-chain concern, or generated output the authored change does not explain. Otherwise, after the integrity pass below, exclude it and note it under Out of Scope, also when the intent is silent.

### Derived-output integrity (before exclusion)

Exclude no candidate before this pass. For each derived candidate, run the path-scoped diff read from Range and command safety and stream its stdout only to an out-of-band SHA-256 and byte-count sink; never load or print the full patch into your context.

Judge the candidate against its authored source or generator from bounded evidence only: path, status, object IDs or sizes, the full-stream hash, the byte count, and an excerpt of at most 64 KiB with a truncation flag. After the excerpt cap, keep draining the stream to EOF and hash and count every byte.

If the producer exits nonzero, the stream ends early, the metadata is malformed, or the hash or count is incomplete, that file's integrity check is inconclusive: keep the file reviewable, report the failure, and continue the review. Never exclude a file on truncated evidence. An inconclusive file check does not make the review `INCONCLUSIVE`.

Record each candidate's decision and reason in a `Derived-artifact relevance decisions` block of `{REQUIREMENTS}`. Add each re-included path to `reviewableFileList` as an exact path and remove it from Out of Scope. A re-included renamed path keeps both endpoints reviewable, also across directories; pair them from the NUL-delimited `["git", "diff", range, "--name-status", "-z", "--find-renames"]` (each rename record is a status token, then the old path, then the new path) output.

### Zero-reviewable-files review

An empty `reviewableFileList` after the integrity pass is a valid review with no finders. Run no `plan`, start no job, dispatch no finder, and never diff an empty or pathless scope. Take a fresh `invocationId` as Step 4 defines it, skip the rest of Step 4 and Phase 2, and go to Phase 3. Phase 3 lists every path of `completeChangedFileManifest` under Out of Scope, writes `findings.md`, and the artifact carries `"findings": []` and `findings_report` pointing to that file. When any reviewable path remains, with or without re-inclusion, take the normal finder path.

## Step 4: Direct Finder-Job Dispatch

1. Read `scripts/chunk-reviewer-prompt.md` (the one finder template for all four angles) and interpolate the existing inputs: {WHAT_WAS_IMPLEMENTED}, {DESCRIPTION}, {REQUIREMENTS}, {PROJECT_CONTEXT}, {NON_GOAL}, {FILE_LIST}, and {COMMIT_HISTORY}.
   Under a scope contract, keep the complete frozen envelope in `{PROJECT_CONTEXT}` and forward the original requirements and non-goals unchanged.
   `{FILE_LIST}` is the entire final `reviewableFileList`, encoded per Untrusted path rendering as a JSON array of strings, and goes only in the template's untrusted-data JSON block.
2. **Identity.** Each independent review takes one fresh cryptographically random, path-safe `invocationId`. Never derive it from content (no diff hash) and never reuse it; a lost id means a new review, never a search by content. The `invocationId` alone is the job key: the same id re-attaches to its job, different ids never share a job or artifact, and no counter or other value joins it in the key. On any re-attach, reject a job or ledger root whose recorded id or location is not the one derived from that id. Write the conductor's own files (such as `findings.md` and the artifact) only under `$OMT_DIR/code-review/<invocationId>`, also when Step 3 skips the rest of Step 4, and only after checking that the directory's resolved real path stays inside `$OMT_DIR/code-review`; never write to a directory that escapes it.

   **Resume dispatch.** When the dispatch carries `resume_invocation_id`, attach to that review instead of starting a new one. Take the job dir from `external_stall.job_dir` in the previous artifact at the supplied destination. If its `invocation_id` differs from `resume_invocation_id`, its `ledger_root` is not the one item 3 derives from that id, or `git rev-parse HEAD` differs from its `reviewed_head_sha`, publish `INCONCLUSIVE` without `external_stall`, naming the mismatch. Otherwise run `job.ts resume-member --job <jobDir> --member <angle> --prompt "<note>" --retry-stalled` for each stalled member (on an external stall it restarts the 6-hour window and restores a ledger root lost to temp cleanup from `<jobDir>/ledger-backup`), continue the loop in item 3, and verify as usual. If `resume-member` refuses, a member ends with "plan changed since job start", or the ledger root is still missing, publish the same `INCONCLUSIVE` naming the cause, so the caller starts a fresh review.
3. **Freeze and run.** Set `ledgerRoot` to `<realpath(os.tmpdir())>/omt-code-review/<invocationId>`: the finder sandbox can write under the temp directory, not under `$OMT_DIR`. Run the planner once over the entire `reviewableFileList`, each value its own argv element per Range and command safety, and note `reviewed_head_sha`, the output of `git rev-parse HEAD` when you run `plan`:

   ```bash
   bun ${CLAUDE_SKILL_DIR}/scripts/diff-cursor.ts plan \
     --repo "$repoRoot" --range "$range" \
     --files '<reviewableFileList as a strict JSON array>' \
     --out "$ledgerRoot/plan"
   ```

   Then start the job with `job.ts start --ledger-root "$ledgerRoot" ...`; `start` refuses without a plan under that root. Exactly four finders run (correctness, regression, cleanup, requirement) in this one job, each with its own ledger at `$ledgerRoot/ledgers/<angle>`, and each walks 100% of the frozen pages through the cursor: no chunking, no sampling, no chunk-reviewer subagents.

   Drive the job yourself with the conductor commands `start`, `collect`, `status`, `results` and `resume-member`; never `clean`. Nothing resumes on its own, and a `collect` that returns a running job is a poll result, not a failure:
   1. Run `job.ts collect <jobDir>`; while it reports the job running, run it again.
   2. For each `awaiting_resume`, `timed_out` or `error` member, run `job.ts resume-member --job <jobDir> --member <angle> --prompt "<note>"`. The member continues from its ledger.
   3. Repeat until every member is `done` or `stalled`. A poll, an interruption or a running job is never a reason to restart the job.
4. **Stalls and the wall cap.** A `stalled` member is never `done`. Never verify candidates or report a passed review below 100% coverage. Publish each outcome below through the normal publisher (Terminal Output), then end:
   - **External stall.** A member `stalled` with `stall_cause_kind` of `quota`, `auth` or `missing_cli` needs something only the user can restore or wait out. Publish `INCONCLUSIVE` with `findings: []` and a top-level `external_stall` object: `{"invocation_id", "job_dir", "ledger_root", "plan_sha", "reviewed_head_sha", "cause_kind", "detail", "reset_text", "members": [{"angle", "state", "pages_acked", "pages_total"}]}`; take the two page counts from `pagesAcked` and `pagesTotal` in `diff-cursor.ts --ledger "$ledgerRoot/ledgers/<angle>" status --json`. `plan_sha` is `planSha` in `job.json`; `detail` and `reset_text` are the member's `stall_detail` and `stall_reset_text`; omit `reset_text` when unknown. Report the cause and the reset text (display only; it has no timezone). A later dispatch with `resume_invocation_id` resumes this same job (item 2).
   - **Any other stall, or `nextAction: "stop_and_degrade"`.** `collect` returns `stop_and_degrade` once the job passes its coverage deadline (6 hours at most), and `resume-member` then refuses. Stop polling, resume nothing more, verify nothing, and publish `INCONCLUSIVE` without `external_stall`, with `findings: []`, naming the cause (the stall or the wall cap) and each incomplete angle. Candidates stay readable in the ledgers, but a partial candidate is never a finding.
5. When every member is `done`, read each finder's candidates with `diff-cursor.ts --ledger "$ledgerRoot/ledgers/<angle>" export --out <file>` plus its final message. Finders overlap by design, so expect duplicates; Phase 2 merges them. Leave job cleanup to GC/orphan reaper; do not run `clean`.

## Step 5: Verification + Synthesis

After all finder jobs reach terminal state, produce the final findings in two phases: direct per-candidate verification (Phase 2), and findings synthesis (Phase 3). The terminal deliverable is the **Phase 3 findings text** — no walkthrough, no diagrams, no HTML.

The zero-reviewable exception applies when Step 3 yields no reviewable files: proceed directly to Phase 3. Phase 2: SKIP FOR ZERO-REVIEWABLE; do not create a finder job, empty chunk, pathless diff. Phase 3 must record all changed paths under Out of Scope and label this the zero-reviewable flow. The completion-gate artifact uses `"findings": []` and retains `"findings_report"`.

### Coverage gate (before Phase 2)

Candidate verification starts only after the coverage gate passes. Run:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/diff-cursor.ts verify \
  --plan "$ledgerRoot/plan" \
  --ledgers "$ledgerRoot/ledgers/correctness" "$ledgerRoot/ledgers/regression" \
            "$ledgerRoot/ledgers/cleanup" "$ledgerRoot/ledgers/requirement"
```

`verify` must exit 0, which means all four ledgers are finished at 100% of the plan's pages (and the cleanup checklist is complete). On a non-zero exit, do not verify candidates: return to the Step 4 conductor loop (`resume-member`) for the members it names. If the gate cannot pass because a stall needs the user, stop and surface it. Never proceed on an incomplete walk.

### Phase 2: Candidate Verification (MANDATORY)

For the zero-reviewable flow, SKIP FOR ZERO-REVIEWABLE; do not create a finder job, empty chunk, pathless diff.

Finders surface candidates; they do not judge them. For every review mode, verify each deduplicated candidate yourself, one at a time: read the code, trace the caller and runtime conditions, then record a verdict and its evidence. Do not spawn verifier subagents or assign numeric confidence scores. When you notice a different real defect while verifying, add it as a new candidate (file, line, summary, failure scenario, `found by: verifier`) and verify it in turn. You need not hunt for unrelated work.

When a valid `[SCOPE_CONTRACT]` is supplied, use its original requirements/non-goals to judge both the symptom and proposed remedy before judging quality. Record `scope` and `scope_evidence` yourself, including OUT_OF_SCOPE and UNKNOWN. A missing/invalid scope decision makes the artifact INCONCLUSIVE. The contract adds scope evidence to the same direct verification procedure.

**Inline judgment steps:**

1. **Dedup near-duplicates first** (same defect, same location, same reason → keep one, and carry onto it everything the duplicates contributed: the merged `found by` angles, the most concrete failure scenario, and any field only one of them supplied). Merging removes the repetition, never the substance. Deduplication reduces the judgment workload before it starts.
2. **MANDATORY READ: `references/verifier-prompt.md`** — read it before beginning judgment. Apply its verdict ladder (CONFIRMED / PLAUSIBLE / REFUTED), verification method, and enrichment output contract directly for each candidate.

   **Verifier interpolation safety** — When interpolating `references/verifier-prompt.md`, insert `{RANGE}` and `{CANDIDATE_FILE}` each as a complete strict JSON string literal, including its surrounding quotes, only at the unquoted value positions in that template's untrusted-data JSON block, encoded as the Untrusted path rendering contract defines. Parse the block first, then use the parsed `candidate.file` and parsed `execution.argv` values directly. Never echo decoded path and range values into Markdown/prose, the `File` field, a raw template, or a shell command. The location output is a structured JSON object (see LOCATION below).

   **No-safe-default candidates** — Before the mandatory **VERDICT** step, trace a no-safe-default candidate's execution model (concurrency, money, security, data destruction, external contract). "I did not trace it" is never a basis for PLAUSIBLE. When the execution model still cannot be established after tracing, record PLAUSIBLE, name the exact runtime fact that would settle it, and keep the finding with its priority and assessment in the card, `findings.md`, and the artifact `findings`. Never omit it, and never mark the review `INCONCLUSIVE` for this reason. Every candidate receives exactly one CONFIRMED / PLAUSIBLE / REFUTED verdict.

3. For each remaining candidate, in order:

   **REASONING** — read the code at the issue location (Read/Grep on the candidate file), trace the call chain from the entry point, and check the execution context (threading, dispatch model, runtime configuration). Apply the verdict ladder from `references/verifier-prompt.md`. Reason explicitly before issuing a verdict.

   **VERDICT** — exactly one of CONFIRMED / PLAUSIBLE / REFUTED (ladder in `references/verifier-prompt.md`).

   For **CONFIRMED** or **PLAUSIBLE** (kept findings), emit the full enrichment inline:

   ```
   VERDICT: <CONFIRMED | PLAUSIBLE>
   TITLE: <short finding title>
   LOCATION: {"file": <strict escaped JSON string of parsed candidate.file>, "line": <line>} — <section / function name>
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
   VERDICT: REFUTED — <one line naming the evidence that proves it is not a defect>
   CODE EVIDENCE: {"file": <strict escaped JSON string>, "line": <line>} — <the quoted line/guard/invariant, or the satisfying line>
   INTENT EVIDENCE: <requirement-gap only, in place of CODE EVIDENCE: the quoted intent text that shows the requirement was never stated>
   ```

   A REFUTED entry with neither `CODE EVIDENCE` nor, for a requirement-gap, `INTENT EVIDENCE` is invalid. One whose reason is a plan, requirement, decision, or exclusion that excludes the defect is also invalid: that is a scope reason. Re-judge it as CONFIRMED or PLAUSIBLE and record that reason as its scope.

4. **Uncertainty** — when the mechanism is real but its trigger remains uncertain, record PLAUSIBLE and state the missing evidence. Preserve unresolved scope as UNKNOWN. If verification cannot be completed, report INCONCLUSIVE with the unverified candidates identified; never report an unverified review as clean.

**Cap & batching:** judge at most **25 candidates per batch** inline. If more survive dedup, batch by file proximity, **correctness candidates first**, and state how many were deferred — never silently drop.

### Phase 3: Findings Synthesis (report-only)

This is a **report**. You surface verified findings, ranked by what matters most. You do NOT decide whether to merge and you do NOT decide whether to fix — that is the reader's call.

For the zero-reviewable flow, record all changed paths under Out of Scope. Phase 3 writes `findings.md` under the same invocation directory and same invocation ID; the completion-gate "findings_report" points to that same invocation ID and `findings.md` path, with `"findings": []`.

**Scope-contract synthesis:** Keep each finding's `scope` and `scope_evidence` unchanged in its full card and its artifact entry. Merge candidates only when their scope decision and authorized remedy agree, and keep all their evidence. Report OUT_OF_SCOPE (a nonblocking observation) and UNKNOWN (an unresolved scope decision) apart from IN_SCOPE findings, in `findings.md` and in the artifact. A scope-contract review keeps every verified finding, LOW included. Only an ordinary review applies the top-15 cap.

1. **Merge** verified findings that describe the same defect (same root cause, across chunks) — combine their evidence and note the corroborating angles. (Near-duplicates within a chunk were already deduped before verification.)
2. **Class** each finding by the defect's nature, not by the angle that found it: **correctness** (the change behaves wrong), **regression** (previously-working behavior the change breaks), **cleanup** (behaves correctly but is low quality), **requirement-gap** (an AC or stated requirement is absent — the behavior is missing, not wrong), or a short free-text class when none of these fits. `found by` records the angle(s) that surfaced it; a regression found by the correctness angle is still class regression.
3. **Impact** each finding: read its full card (failure scenario + blast radius) and assign the harm grade independently of confidence and priority. Impact is about the harm if the scenario occurs. Weigh occurrence rarity, patch size/touched lines, and maintenance exposure in priority, not in impact; the finding angle does not measure harm. A severe, irreparable harm remains severe even when occurrence is unknown or the cheapest remedy is expensive:
   - **HIGH** — realistic unacceptable harm such as data loss/corruption, money, auth/permissions failure, a working feature regression, required user-reaching behavior missing, user-facing crash, or unrecoverable damage.
   - **MEDIUM** — observable but recoverable harm, conditional wrong behavior, performance degradation, or a regression-detection gap.
   - **LOW** — subjective cosmetics, unclear benefit, or report-only quality observations whose harm is not user-impacting.

   Do not manufacture occurrence or exposure numbers. For occurrence, weigh competing requests for the same resource; batching and retries do not prove a globally concurrent user count. For maintenance exposure, weigh read/change frequency, not request count. Unknown exposure stays unknown.
4. **Assign priority** after the full card and impact are established. Priority is a response recommendation, not a severity score:
   - **HIGH** — a mandatory response is warranted because the realistic harm is unacceptable; expensive remediation does not downrate it. Seek the smallest mitigation that contains the harm.
   - **MEDIUM** — a bounded remedy has demonstrated net benefit after considering maintenance/regression burden, including cases such as a frequently edited duplicate with a small safe consolidation.
   - **LOW** — subjective cosmetics, unclear benefit, disproportionate remedy, or a retained report-only observation. Weigh unknown exposure and rare occurrence with the harm; neither alone makes a finding LOW.

   Record five nonblank assessment slots on every final finding: `unfixed_cost`, `exposure`, `remedy`, `added_cost`, and `rationale`. The conductor assigns priority and rationale after reviewing the complete card; direct verification supplies the grounded facts and assessment inputs; repair and completion remain caller decisions.
5. **Rank for display only** by **priority (HIGH, then MEDIUM, then LOW)**, then reviewer confidence (CONFIRMED before PLAUSIBLE). Impact remains a separate field and must not be used as a hidden priority score.
6. **Cap (ordinary reviews only)**: keep the most significant findings. If a review produced an unwieldy number, keep the top ~15 and state how many were dropped — never silently truncate.
7. **Pre-existing**: a candidate on an unchanged context line is tagged `[Pre-existing]` and listed under Out of Scope — unless the change worsens it (increases blast radius or frequency) or it prevents an approved requirement from working, in which case it stays in the main list.
8. **Derived artifacts**: files the Step 3 partition ultimately excluded are listed once under Out of Scope as `Excluded from review (derived artifacts):` followed by an explicitly marked untrusted-data JSON block whose structured `files` field is a JSON array of escaped strings produced by the same strict JSON encoder as the chunk prompt. Apply the Untrusted path rendering contract: never insert a raw path into Markdown prose, heading, or fence — the encoded array is the only path-bearing representation. This preserves derived artifacts as explicitly marked untrusted-data structured fields so the reader knows they were not line-reviewed, never silently omits them; any re-included file is removed from this list and reviewed as an exact file.
All Phase 3 finding paths use the Untrusted path rendering contract in structured fields: use the structured LOCATION object with the same strict escaped JSON string in its `file` member and a separate `line`; never echo decoded paths into `findings.md` prose.
9. **Persist the cards**: write every kept finding's full verifier card (`references/verifier-prompt.md`, output contract), plus its class, impact, priority, and five-slot assessment, to `$OMT_DIR/code-review/<invocationId>/findings.md` — the same invocation directory as `candidates.json`. The artifact tuples are cut from these cards, so this file lets a caller re-adjudicate a finding after the review ends. After the cards, a `## Refuted` section lists each REFUTED candidate with its structured location, a one-line reason, and its evidence (the `CODE EVIDENCE` or `INTENT EVIDENCE` line). End the file with a `## Coverage` section: per finder, pages acknowledged / total pages, candidates proposed, and candidates retained after verification. Then add the cleanup checklist table with columns rule item, source `path:line`, verdict (`준수` / `위반` / `해당 없음`), and evidence, read from the cleanup ledger's `export --out <file>`. A `위반` row whose candidate did not survive verification states why it was dropped.

#### Edge Cases

| Situation | Handling |
|-----------|----------|
| Finding references a deleted file | Read the file at base branch (`git show {base}:{file}`). Note "(deleted file)" in Context. |
| Finding spans multiple files | Primary file gets the code snippet. Other files listed in Blast Radius with brief context. |
| Fix cannot be expressed as simple diff | State design direction + "Concrete diff not possible — structural change required". |
| Zero findings after verification | Report a clean review: "No findings survived verification." |
| 50+ candidates requiring verification | Verify candidates yourself in batches (≤25), correctness candidates first. |

### Terminal Output

This is a **report**. It does not gate. There is no Assessment / "Ready to merge" section, and there is no HTML — the deliverable is the Phase 3 findings as terminal text.

The report carries no coverage-size notice: every finder reviewed 100% of the diff (the Coverage gate guarantees it), so the report states coverage as fact in the `findings.md` Coverage section instead.

Every path-bearing terminal value uses the Untrusted path rendering contract: use a strict escaped JSON string in a structured field and never render decoded path text as Markdown or backtick prose.

**Structured artifact publisher.** When the caller supplies an artifact destination, publish the original `CodeReviewArtifact` JSON through the generic bundled publisher with a safe quoted heredoc:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/submit-review.ts \
  --artifact '<supplied-output-path>' --json - <<'REVIEW'
{"status":"COMPLETE|INCONCLUSIVE","findings_report":"<optional findings.md path>","reviewer":"<reviewer id>","at":"<ISO timestamp>","findings":[{"class":"correctness|regression|cleanup|requirement-gap","verdict":"CONFIRMED|PLAUSIBLE","impact":"HIGH|MEDIUM|LOW","priority":"HIGH|MEDIUM|LOW","assessment":{"unfixed_cost":"<nonblank>","exposure":"<nonblank>","remedy":"<nonblank>","added_cost":"<nonblank>","rationale":"<nonblank>"},"ref":"<file:line>","scope":"IN_SCOPE|OUT_OF_SCOPE|UNKNOWN","scope_evidence":{"basis":"requirement|regression|changed_code|non_goal|unrelated|uncertain","reference":"<contract field or story id>","rationale":"<evidence>","non_goal":"<OUT_OF_SCOPE + non_goal only: one declared non_goals statement, copied exactly>"}}]}
REVIEW
```

The publisher validates and atomically saves the original review JSON bytes, returning only the transport receipt `{"path":"<path>","sha256":"<hash>"}`. It has no caller, goal, session, aggregate, repair, or completion policy and never classifies destinations by filename. Valid or hashless `INCONCLUSIVE` diagnostics are published as supplied; the caller owns scope validation and all subsequent policy.

`COMPLETE` is valid only when every retained finding has a non-blank `class`, the `verdict`
and `impact` enums, plus `priority` and all five nonblank `assessment` slots. A review whose
candidates were all verified is `COMPLETE`, including its `IN_SCOPE` + `PLAUSIBLE` findings; never
invent certainty or a speculative repair. `INCONCLUSIVE` is for a review that could not be
completed (unverified candidates, a missing or damaged scope contract). A no-safe-default finding
whose execution model could not be established is a verified PLAUSIBLE finding, not a reason for
`INCONCLUSIVE`. An `INCONCLUSIVE` artifact still lists its verified findings, classified like a
`COMPLETE` one, and may omit only the `priority`/`assessment` fields when verification or scope is unresolved. If the
`verdict` or `impact` enum is unavailable, do not invent it: keep the unresolved narrative in
`findings_report` and omit that incomplete tuple from diagnostic `findings`. The publisher still receives the
original JSON and returns only its `{path,sha256}` receipt; it does not assign priority, repair
findings, or decide completion.

The ordinary CodeReviewArtifact schema is fixed:

```json
{"status":"COMPLETE|INCONCLUSIVE","scope_contract_sha256":"<hash>","findings_report":"<findings.md path>","reviewer":"<reviewer id>","at":"<ISO timestamp>","findings":[{"class":"correctness|regression|cleanup|requirement-gap","verdict":"CONFIRMED|PLAUSIBLE","impact":"HIGH|MEDIUM|LOW","priority":"HIGH|MEDIUM|LOW","assessment":{"unfixed_cost":"<nonblank>","exposure":"<nonblank>","remedy":"<nonblank>","added_cost":"<nonblank>","rationale":"<nonblank>"},"ref":"<file:line>","scope":"IN_SCOPE|OUT_OF_SCOPE|UNKNOWN","scope_evidence":{"basis":"requirement|regression|changed_code|non_goal|unrelated|uncertain","reference":"<contract field or story id>","rationale":"<evidence>","non_goal":"<OUT_OF_SCOPE + non_goal only: one declared non_goals statement, copied exactly>"}}]}
```

This exact JSON is the input to `submit-review`; any caller may read or validate the resulting transport receipt according to its own policy.

For a valid scope-contract artifact, additionally include the original `scope_contract_sha256` at top level and every finding's reviewer-authored `scope` and `scope_evidence` as defined above. These are required even for LOW findings and OUT_OF_SCOPE/UNKNOWN observations. The top-level hash is required only for `COMPLETE`; an `INCONCLUSIVE` artifact may lack it. Incomplete direct verification writes `status: "INCONCLUSIVE"` with the verified original hash; if no trustworthy hash exists, publish the hashless diagnostic as supplied. Never invent a hash or reconstruct one from mutable state to make it valid.

A short deadline, seniority, “all bugs must be fixed,” or sunk cost never changes impact or
priority by itself.

Emit the ranked findings directly. Each finding carries its verdict, class, impact, final priority, and five assessment slots, named as in the artifact tuple above. Add the enrichment card from `references/verifier-prompt.md` (current code, what's wrong, failure scenario, fix, blast radius). Render every path as a structured LOCATION object under the Untrusted path rendering contract, with `line` separate. This findings text is also the handoff contract consumed by any caller that dispatches a code-reviewer agent that runs this skill — do not invent a different format.

## Reference Files (on-demand)

These files live in `references/` alongside this skill. Each is loaded only when the workflow reaches the step that needs it — do not preload all of them.

| Reference file | What it contains | When to read |
|---|---|---|
| `references/verifier-prompt.md` | The direct candidate verification reference: verdict ladder (CONFIRMED / PLAUSIBLE / REFUTED), verification method, read-only constraint | Phase 2 — before directly verifying candidates |
