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

**Intent acquisition is non-negotiable.** Either intent is confirmed (from artifacts, interview, or both), or the user explicitly defers to a code-quality-only review. There is no third option — proceeding without intent and without explicit deferral is forbidden. Reviewing without intent produces wrong severities, missed scope creep, and false positives born from misunderstanding the author's goal.

### Acquisition order

1. **PR/branch artifacts** — PR title, description, labels, commit history. PR comments and review threads are not intent sources: the review is independent of them.
2. **Linked references (recursive)** — every link found in the artifacts above, followed transitively until the trail ends
3. **Codebase signals** — CLAUDE.md, README, ADRs, related history in changed paths
4. **User interview** — only for what the artifacts cannot reveal

### Acquire all reachable references

PR descriptions and commits routinely link to richer context (issue trackers, design docs, chat threads). **Follow every link recursively** — a linked ticket may itself link to a doc which links to a discussion thread; keep following until the trail ends.

Do not name specific tools. Use whatever fetch capability the environment provides for each link type. If a link cannot be fetched directly (no credential, no MCP for that platform, network unreachable), do not skip it — mark it for the user interview step.

Sources to consult per input mode:

| Input mode | Sources |
|------------|---------|
| PR | `gh pr view --json title,body,labels`, linked issues, `gh issue view <n>`, every external link found in the chain, commit messages on the PR branch |
| Branch comparison | Commit messages, branch name conventions, any linked tickets discovered in commits, related issues |
| Auto-detect | Recent commit messages on HEAD, any linked tickets found there |

- **Explicit decision rules** — when an intent source (plan, spec, issue, PR description) states explicit decision rules (for example plan ADR items `### D-N: <title>` with a `Decision` field, or rule sentences in an issue), copy them verbatim into `{REQUIREMENTS}` as a `Decision rules:` block alongside the acceptance criteria. Each rule carries the full `Decision` field, plus `| Owns: … | Must NOT own: …` when the item has them. These are rules the frozen intent source already states, not new acceptance criteria, so copying them is not the addition that scope-contract mode forbids; never paraphrase and never author a rule the source does not state.

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
| **Non-interactive dispatch (completion-gate)** — the dispatch prompt itself carries a supplied artifact destination alongside a 5-slot intent payload (`what_was_implemented`/`description`/`requirements`/`project_context`/`non_goals`) | Treat as **Intent confirmed (non-interactive, no user interview)** and proceed to Step 2. Acquisition steps 1-3 (PR/branch artifacts, linked references, codebase signals) still run — they backfill any slot whose value is the `(none provided)` marker (for `non_goals`, an empty array `[]`). Only step 4 (user interview) is replaced by the payload. The destination is opaque; do not infer workflow from its basename. |
| **Neither** — artifacts thin and user not yet asked, OR user gave vague answers without explicit deferral | **BLOCK**. Do not proceed. Continue interview until one of the two states above is reached. |

There is no "I tried hard enough, just review" path. The block IS the safety mechanism.

A fresh code-reviewer agent has no ambient session to check for an active artifact path — the non-interactive discriminator above is prompt-borne: whether the dispatch prompt includes the supplied destination, not whether a session-scoped artifact happens to exist. The destination is opaque and may use any basename. When the signal is absent, the main-session interactive gate above (**Neither** → BLOCK) is unchanged.

### Vague answer refinement

When the user gives a vague answer that is not an explicit deferral, refine ONCE with a specific follow-up:

Include the deferral option in every follow-up so the user can opt out without already knowing the phrases "skip / 그냥 리뷰해줘 / 없어".

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
| 2-4 structured choices (review scope, focus areas) | Propose alternatives, each with trade-offs |
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

**Scope-contract exception:** Keep the frozen requirements unchanged. Derive only supporting hypotheses about behavior already authorized by a contract key or confirmed story; label them as evidence and keep them separate from the authoritative requirements. An analog, general best practice, or review-derived expectation alone cannot become a requirement-gap or authorize new work. The unconditional rules below apply to other review modes.

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
4. `["git", "diff", range, "--name-status", "-z", "--find-renames"]` (rename/copy relation pass)
5. `["git", "diff", range, "--numstat", "-z", "--find-renames"]` (rename-aware insertion/deletion counts for scale)
6. `["git", "log", range, "--oneline"]` (commit history)
7. CLAUDE.md files: repo root + each changed directory's CLAUDE.md (if exists)

Parse raw stdout as NUL-delimited records from all manifest commands. Never use newline, line, or word splitting, and never use shell command substitution. A name-only record is one path; a numstat record splits only its first two tab fields while preserving the remainder as the path. This preserves arbitrary Git pathnames, including newline, tab, quote, and backslash filenames. `--no-renames` avoids old/new pair ambiguity by emitting separate single-path records for each side of rename/copy changes. The relation pass is pairing only: parse its NUL-safe R/C old/new endpoint pair and normalize its R/C old/new endpoint pair; name-only/numstat outputs are membership/accounting and must not double-count endpoints or insertions.

For NUL-separated `--numstat -z --find-renames` R/C output, associate one stats tuple with its R/C relation record, then consume its NUL-separated old/new endpoints as a pair. Do not interpret the endpoints as independent numstat records or add them twice.

Keep the no-renames manifest for endpoint membership/path scope. Before scale, reconcile the rename-aware numstat records with the R/C relation map. For each R/C relation record, use its single rename-aware insertion/deletion tuple for scale; a pure rename contributes 0 insertions. Consume each no-renames endpoint exactly once for membership/accounting. The no-renames endpoint values remain membership/accounting only; never add the endpoint-level `--no-renames` values to scale.

While parsing each NUL-delimited numstat record, treat an insertion or deletion field of `-` as numeric zero for `reviewableInsertionLines` arithmetic; preserve that path's binary marker separately. Normalize only finite numeric fields into the insertion/deletion sums: do not add `-`, `undefined`, or `NaN` (or any non-numeric value). This applies to mixed text/binary diffs when they are not binary-only. This is Step 2 accounting and must not be confused with the fresh-manifest binary-only Early Exit; the latter reports paths and exits before Step 2.

## Step 3: Reviewable-File Selection

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

To keep binary diffs out of model context, stream the complete candidate diff only to an out-of-band digest/byte-count sink; never load or print the full binary patch into model context. Expose bounded metadata: path, status, old/new object IDs or sizes, full-stream hash, and byte count; expose at most a fixed 64 KiB textual excerpt and an explicit truncation flag. Continue draining the producer stdout to EOF after the 64 KiB excerpt cap, hashing and counting every byte; finalize only after EOF and a complete hash/count. Any nonzero producer exit, partial/early stream, malformed metadata, or incomplete hash/count is `INCONCLUSIVE`; fail closed: do not exclude or silently drop the candidate, re-include it for review, and report the integrity failure. Never exclude a candidate solely from truncated evidence; require bounded integrity evidence or re-include it.

Keep the two manifests as separate values. Never substitute one for the other. Before exclusion and before any path-filtered finder command, inspect each candidate derived file in the complete changed-file manifest by streaming its complete candidate-scoped diff only to the out-of-band sink above; inspect only the bounded integrity evidence against authored source/generator evidence:

Before final integrity exclusion, run a bounded, selection-only relevance screen for each candidate against the review intent and every configured angle even when intent is silent. The screen uses candidate-scoped evidence only; it is not a full finder job or general aggregation and sends no diff bytes to either. Record a per-path decision and reason: if intent or any angle deems the exact path relevant, remove it from Out of Scope and re-include it in `reviewableFileList`, keeping it reviewable alongside its authored source or related rename endpoint (both enter the single job's scope). If no angle is relevant, leave the path in Out of Scope for final exclusion, including when intent is silent. After this screen, apply the final integrity exclusion.

Execute this candidate-scoped diff through Bash. The preferred form is argv-safe direct process execution with the argument vector `["git", "--literal-pathspecs", "diff", "--binary", "--no-ext-diff", "--no-textconv", range, "--", candidatePath]`; if Bash must run the command, quote the diff range and candidate path as separate arguments:

```bash
git --literal-pathspecs diff --binary --no-ext-diff --no-textconv "$range" -- "$candidatePath"
```

Raw interpolation is forbidden. Git's `--` is only the revision/pathspec separator; it does not disable Git pathspec magic, external diff drivers, or textconv filters. `--literal-pathspecs` must be before `diff`; `--binary` is required, and `--no-ext-diff` and `--no-textconv` are required for this candidate integrity read. `--literal-pathspecs` treats the candidate path literally and is not shell escaping. These rules apply even when a changed filename contains spaces, shell metacharacters, command substitution, or newlines, including `:(exclude)*`.

This candidate-scoped diff inspection exception is for integrity judgment only. Compare the changed bytes with authored source/generator evidence to decide whether the output is meaningful, stale, manually altered, or otherwise unexplained. Its diff result is not forwarded to a finder prompt, candidate aggregation, or general orchestrator context. Project tests, builds, linters, formatters, migrations, and other project execution remain forbidden. A `.d.ts` is excluded only with generated evidence; an authored `.d.ts` remains reviewable and contributes to `reviewableInsertionLines`. Authored migrations and DDL remain reviewable, including when a neighboring migration snapshot is derived. Authored `.d.ts`, migrations, and DDL remain reviewable without generated evidence.

After this integrity pass and partition, finalize `reviewableFileList`; derive the scale units from the relation-reconciled reviewable subset for rename-aware insertion/deletion scale, while deriving `reviewableFileCount` as the finalized reviewable endpoint/path count (that is, count each path in `reviewableFileList` exactly once, including both endpoints of an R/C relation when both are reviewable). Derive `reviewableInsertionLines` from the `--find-renames` numstat insertion counts. R/C relation reconciliation is used for rename-aware insertion/deletion scale only; it does not collapse endpoint membership or double-count endpoints. Endpoint-level `--no-renames` values never feed scale. Derived artifacts do not satisfy the changed-file threshold.

**Handling:** derived artifacts are excluded from the insertion-line scale count and are never assigned to a chunk or finder job — a 5,000-line `*_snapshot.json` must not inflate the scale decision or consume finder budget. They are **not** silently dropped: list them under Out of Scope in the report (synthesis item below) so the reader sees they changed and were not line-reviewed. Re-included outputs are reviewed as exact files instead.

### Zero-reviewable-files review

This is a valid zero-reviewable-files review. If `reviewableFileCount` is 0, do not dispatch a finder job, do not create an empty chunk or pathless diff, report all changed derived artifacts under Out of Scope, and explicitly report that this is not a single empty chunk. This branch applies only to a non-empty, non-binary-only diff after Step 2; empty-diff and binary-only Early Exit flows do not initialize these artifacts. If derived re-inclusion makes `reviewableFileCount` > 0, use the normal finder path instead.

Before entering Phase 3, allocate a fresh cryptographically random, path-safe `invocationId`; before writing, verify that the invocation directory is contained within `$OMT_DIR/code-review`; atomically persist the frozen invocation manifest plus `candidates.json` with an empty `candidates` array (`"candidates": []`), using the normal invocation-manifest/`candidates.json` schemas and all configured angle coverage fields (one coverage record per configured angle, including unavailable angles); do not create or start a finder, job, chunk, attempt, or prompt, including an empty chunk or pathless diff.

### Scale

Determine scale from the **reviewable subset** using the derived values — of the two line counts, only `X` (insertions), never `Y` (deletions), feeds this decision:

These are the rename-aware, relation-reconciled scale values from Step 2: each R/C relation contributes its single insertion/deletion tuple to scale, pure renames contribute 0 insertions, while `reviewableFileCount` remains the finalized `reviewableFileList` endpoint/path count and endpoint-level `--no-renames` values never feed scale.

`reviewableInsertionLines` and `reviewableFileCount` no longer branch review strategy and no longer produce a coverage notice: every non-empty reviewable set gets exactly four finders (one per angle) in one job, and every finder walks 100% of the diff.

## Step 4: Direct Finder-Job Dispatch

1. For a valid scope contract, retain the complete frozen scope envelope in `{PROJECT_CONTEXT}` and the original requirements/non-goals when forwarding intent to finders. Read `scripts/chunk-reviewer-prompt.md` (the one finder template for all four angles) and interpolate the existing inputs: {WHAT_WAS_IMPLEMENTED}, {DESCRIPTION}, {REQUIREMENTS}, {PROJECT_CONTEXT}, {NON_GOAL}, {FILE_LIST}, and {COMMIT_HISTORY}. Before interpolation, path-bearing values must never be inserted as raw Markdown/prose: serialize `{FILE_LIST}` as a JSON array of path strings with the strict encoder from the Untrusted path rendering contract, and place it only in the template's untrusted-data JSON block. Any exact path echo in `{REQUIREMENTS}` uses the same escaped JSON string representation. Include each per-path relevance decision and reason in the existing `{REQUIREMENTS}` payload/finder handoff. These are the Step 3 relevance-screen results; then freeze the final `reviewableFileList`. Set {FILE_LIST} to the entire `reviewableFileList`. Pass re-included derived paths as exact path finder scope, keeping each re-included path reviewable alongside its authored source or related rename endpoint, including ordinary cross-directory rename endpoints. Never pass the complete changed-file manifest or derived-artifact Out of Scope list as finder scope.
2. The review receives one fresh cryptographically random, path-safe `invocationId`; never derive it from content or reuse it. Before the finder starts, durably persist a frozen invocation manifest containing the target, resolved launch context, the reviewable file list (the job's scope), and required job metadata. Recovery uses that ID and frozen values; conflicting state is rejected, not reused.
   **Resume dispatch.** When the dispatch carries `resume_invocation_id`, attach to that review instead of starting a new one; find its job dir from `external_stall` in the previous artifact at the supplied destination path (or the manifest under `$OMT_DIR/code-review/<invocationId>/`). If current HEAD differs from `reviewed_head_sha`, publish `INCONCLUSIVE` without `external_stall`, naming the mismatch. Otherwise run `job.ts resume-member --job <jobDir> --member <angle> --prompt "<note>" --retry-stalled` for each stalled member (it restores a ledger root lost to temp cleanup from `<jobDir>/ledger-backup`), run `collect` until terminal, and verify as usual. If `resume-member` refuses, a member ends with "plan changed since job start", or the ledger root is still missing, publish the same `INCONCLUSIVE` naming the cause, so the caller starts a fresh review.
3. The logical job key is `(invocationId, attempt)`. Same keys idempotently attach; different invocation IDs never share jobs or artifacts. Validate ownership and path containment on recovery, attaching rather than respawning. If `invocationId` is lost, safely start a new independent review rather than rediscovering by content. Pass commands, paths, and external values safely; use argv-safe direct process execution as the preferred form. If Bash is required, quote the range and every path explicitly; raw interpolation is forbidden.
4. Freeze the diff for the finders. Compute `ledgerRoot` = `<realpath(os.tmpdir())>/omt-code-review/<invocationId>` (the finder sandbox can write under the temp directory, not under `$OMT_DIR`), then run the planner once, passing the range and every reviewable path as separate argv values (argv-safe direct execution; if Bash is required, quote each value explicitly and never interpolate raw):

   ```bash
   bun ${CLAUDE_SKILL_DIR}/scripts/diff-cursor.ts plan \
     --repo "$repoRoot" --range "$range" \
     --files '<reviewableFileList as a strict JSON array>' \
     --out "$ledgerRoot/plan"
   ```

   Record `reviewed_head_sha` (the output of `git rev-parse HEAD` when you run `plan`) in the invocation manifest.

   `plan` freezes the diff of exactly the `reviewableFileList` into pages (default 24,000 UTF-8 bytes, max 32,000) and records the applicable guideline files for the cleanup finder: `CLAUDE.md`/`AGENTS.md` on the ancestor paths of the changed files, plus `.claude/rules` and `.codex/rules` in every ancestor directory of a changed file (a nested rule's `paths` globs are relative to the directory that owns that `.claude`/`.codex`; files are read from the reviewed head commit). Re-running it with the same inputs is a no-op. A different file list or range for an existing plan directory is refused. Each finder keeps its own ledger at `$ledgerRoot/ledgers/<angle>`; the worker creates it.
5. Start the one job with `job.ts start --ledger-root "$ledgerRoot" ...` before polling. `--ledger-root` is required: `start` refuses without it, so the `plan` step in item 4 must run first. `start` records the ledger root, the plan directory and the plan hash (`planSha`) in `job.json`. Exactly four finders run (correctness, regression, cleanup, requirement), and every finder walks 100% of the pages through the cursor. There is no chunking and no sampling. Drive the direct `job.ts` job (`start`, `collect`, `resume-member`, `status`, `results`) to terminal. Poll progress, interruption, or a running/ready job is never a retry. Run `job.ts --help` to see the full command roster grouped by who typically runs it — these tags are advisory only, since code-review has no write-guard enforcement.

   **Completion and resume policy.** A finder is complete only when its ledger is 100% acknowledged and finished (and, for cleanup, its checklist is finalized). A member whose turn ends below 100% is not `done`; it is `awaiting_resume`. Nothing resumes on its own: the conductor drives every resume. The conductor loop is:
   1. Run `job.ts collect <jobDir>`. It re-reads status every 5 seconds and waits at most 20 seconds per call. It returns the manifest at once only when the job is `done`, or when it is `awaiting_resume` with no member running, retrying or queued. While another member still runs, it keeps polling. At the 20-second limit it returns `overallState: "running"` with member counts (including `awaiting_resume`).
   2. For each `awaiting_resume`, `timed_out` or `error` member, run `job.ts resume-member --job <jobDir> --member <angle> --prompt "<note>"`. The member continues from its ledger, not from page one.
   3. Run `collect` again. Repeat from step 1 until every member is `done` or `stalled`. Check `status --verbose` for each member's acked/total pages.

   The resume policy follows progress. Progress means the acknowledged pages, the checklist items or the checklist verdicts went up, or the ledger finished. Progress resets every counter. There is no fixed resume cap while progress continues. The stall sequence is:
   1. After 3 consecutive resumes without progress (the initial turn counts), the next `resume-member` applies one remedy. It re-splits the issued page to half its size. If no page is issued, it spends one plain resume.
   2. The next resume without progress marks the member `stalled` with a stated reason. A `stalled` member is never `done`.
   3. A missing CLI, a non-retryable turn failure or a missing session id stalls the member at once. The reason reads "non-retryable failure: <detail>".

   A changed plan (`planSha` in `job.json` no longer matches `plan.json`) ends the member `error` or `stalled` with "plan changed since job start"; start a new job for the new plan.
   - To recover a `stalled` member whose cause you cleared, run `job.ts resume-member --job <jobDir> --member <angle> --prompt "<note>" --retry-stalled`. It always starts a fresh initial turn on the same ledger and resets the counters. On a member that is not `stalled`, the flag is ignored and the call runs as a plain resume.
   - The job deadline is for the coverage job as a whole. It slides only when a member acknowledges a page, adds a checklist item or sets its verdict or evidence (checklist item updates), or finishes its ledger. Heartbeats and resumes without progress do not extend it. It never passes 6 hours after job creation (or after the last external-cause `--retry-stalled`; see below). Past that wall cap, `collect` reports `stop_and_degrade` on every return, and `resume-member` refuses; `--retry-stalled` does not override it, except on a member stalled by an external cause, where it restarts the window. Workers are not killed, and candidates stay readable from the ledgers.
   - **External stall.** A member `stalled` with `stall_cause_kind` of `quota`, `auth` or `missing_cli` (`status.json` also carries `stall_detail` and, when known, `stall_reset_text`) needs something only the user can restore or wait out. `--retry-stalled` on such a member restarts the 6-hour window. A no-progress stall never restarts it. Publish an `INCONCLUSIVE` artifact through the normal publisher with `findings: []` and a top-level `external_stall` object: `{"invocation_id", "job_dir", "ledger_root", "plan_sha", "reviewed_head_sha", "cause_kind", "detail", "reset_text", "members": [{"angle", "state", "pages_acked", "pages_total"}]}`. Omit `reset_text` when unknown. Then end, and report the cause and reset text (display only; it has no timezone) to the caller. Never accept an incomplete walk, never run candidate verification below 100%, and never report a passed review below 100%. Any other stall (no progress) also publishes `INCONCLUSIVE` without `external_stall`.
   - Page notes are free prose for every angle; there are no per-angle templates. Only a blank note is refused. A note may record an open question as "check later: <what, where>" to revisit before `finish`. A finder re-reads all its notes in full with `diff-cursor.ts notes [--from <pageId>]`, paged under the output budget; `resume` prints the finder's position and the note count, and tells it to read the notes with `notes`. Doc and test pages may take a short note. After `finish`, the ledger refuses candidate and checklist writes.
6. Read each finder's candidates with `diff-cursor.ts --ledger "$ledgerRoot/ledgers/<angle>" export --out <file>` (the full JSON file: coverage, candidates, checklist, notes; `export --part N` gives budget-sized JSON parts) plus its final message, deduplicate candidates by normalized location and defect reason, union `found by` angles/evidence, and emit one coverage record per configured angle (including unavailable angles). Duplicates across angles are expected, because finders are not told to avoid other angles' areas; merge them here. Atomically persist `candidates.json` before `usage-summary`. Leave job cleanup to GC/orphan reaper; do not run `clean`.
7. Use the existing direct finder CLIs and prompt interpolation; do not dispatch chunk-reviewer subagents. Keep the review static-only and preserve all raw finder fields required by the aggregation contract.

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
