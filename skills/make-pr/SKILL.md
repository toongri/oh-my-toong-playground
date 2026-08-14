---
name: make-pr
description: Use when creating a PR description. Triggers include "PR 작성", "PR description", "make PR", "PR 만들어", "풀리퀘", "pull request 작성".
---

<Role>

# Make-PR -- PR Description Writer

Write Korean PR descriptions from a senior backend engineer's perspective. Write so that core decisions can be fully understood from the PR alone without reading diffs, clearly separating "what changed" (Changes) from "what needs discussion" (Review Points).

> "A good PR description makes review productive. A bad one makes review a guessing game."

</Role>

---

<Critical_Constraints>

## The Iron Law

```
NO PR DESCRIPTION WITHOUT SUFFICIENT CONTEXT
```

Never write a PR description without sufficient context. Continue the interview until ALL items in the Clearance Checklist are YES.

**Violating the letter of this rule IS violating the spirit.**

---

## Non-Negotiable Rules

| Rule | Why Non-Negotiable | Common Excuse | Reality |
|------|-------------------|---------------|---------|
| Clearance Checklist all YES | Insufficient info leads to inaccurate PR | "I roughly get it, just write it" | Missing context leads to wrong PR |
| Write body & conversation in Korean | Project convention | "English is easier" | Project rules take priority. Sole exception: PR title language follows the surveyed `{title-convention}` when one exists |
| Never run `gh pr create` without user confirmation | PR creation requires explicit user approval | "Just create it directly" | Always confirm before creating PR |
| Never read git diff file contents for PR description writing | Use metadata only | "Need to see code for accuracy" | Use explore for patterns. User interview is key. Exception: conflict resolution in Step 0-C requires reading file contents to analyze and resolve conflicts |
| Never reference non-git content in PR | Reviewers can't access agent-internal files | "Memory/plan adds context" | PR is a public document; internal files are inaccessible to reviewers |

</Critical_Constraints>

---

## Scope

Writes PR description body. Optionally assesses PR scope for multi-thesis splitting, separating each sub-PR into its own worktree. Detects base branch via heuristic merge-base analysis, settles target branch, sync strategy, and conflict policy in one question, performs target branch synchronization with conflict resolution at request start, then collects metadata + surveys repo PR conventions (title/branch/label) → interview → assessment → description. Creates the PR via `gh pr create` after user approval, assigned to the authenticated gh user, with labels per the surveyed convention.

---

## When NOT to Use

- Purpose is code review (use code-review skill)
- Purpose is writing commit messages (use git-master skill)

---

## Workflow

```dot
digraph make_pr_flow {
    rankdir=TB;

    "User Request" [shape=ellipse];

    subgraph cluster_step0 {
        label="Step 0: Setup -- analyze first, ask once, then execute";
        style=dashed;
        "0-A: Fetch & Analyze\nAll Remote Branches\n(ahead/behind/scale\nper candidate)" [shape=box];
        "Setup Question\nONE AskUserQuestion call:\n(1) 타겟 브랜치\n(2) 동기화 방식\n(3) 충돌 처리 방침" [shape=box];
        "0-B: Execute\nmerge / rebase" [shape=box];
        "0-C: Conflict?" [shape=diamond];
        "0-C: Apply\n충돌 처리 방침\n(파일별 확인이면 이번 라운드\n충돌 파일을 한 콜에 담아 질문)" [shape=box];
        "More Conflicts?" [shape=diamond];
        "Commit / Continue\nRebase" [shape=box];

        "0-A: Fetch & Analyze\nAll Remote Branches\n(ahead/behind/scale\nper candidate)" -> "Setup Question\nONE AskUserQuestion call:\n(1) 타겟 브랜치\n(2) 동기화 방식\n(3) 충돌 처리 방침";
        "Setup Question\nONE AskUserQuestion call:\n(1) 타겟 브랜치\n(2) 동기화 방식\n(3) 충돌 처리 방침" -> "0-B: Execute\nmerge / rebase" [label="behind > 0"];
        "0-B: Execute\nmerge / rebase" -> "0-C: Conflict?";
        "0-C: Conflict?" -> "0-C: Apply\n충돌 처리 방침\n(파일별 확인이면 이번 라운드\n충돌 파일을 한 콜에 담아 질문)" [label="YES"];
        "0-C: Conflict?" -> "Collect Git Metadata" [label="NO"];
        "0-C: Apply\n충돌 처리 방침\n(파일별 확인이면 이번 라운드\n충돌 파일을 한 콜에 담아 질문)" -> "More Conflicts?";
        "More Conflicts?" -> "0-C: Apply\n충돌 처리 방침\n(파일별 확인이면 이번 라운드\n충돌 파일을 한 콜에 담아 질문)" [label="YES"];
        "More Conflicts?" -> "Commit / Continue\nRebase" [label="NO"];
    }

    "Collect Git Metadata" [shape=box];
    "Explore Codebase Patterns" [shape=box];
    "Interview Mode" [shape=box];
    "Clearance Checklist" [shape=diamond];
    "Scope Assessment" [shape=diamond];
    "Split Proposal" [shape=box];
    "Branch Separation\n(worktree per sub-PR)" [shape=box];
    "Sub-PR Loop\n(Step 6-8 per sub-PR\nincl. user confirmation)" [shape=box];
    "Draft PR Description" [shape=box];
    "Present to User" [shape=box];
    "User Feedback" [shape=diamond];
    "Confirm PR Creation" [shape=diamond];
    "Ahead Check\n(commits not in base)" [shape=diamond];
    "gh pr create" [shape=box];
    "Return PR URL" [shape=ellipse];
    "Output Description Only" [shape=ellipse];
    "Report Absorbed\n+ Stop" [shape=ellipse];

    "User Request" -> "0-A: Fetch & Analyze\nAll Remote Branches\n(ahead/behind/scale\nper candidate)";
    "Setup Question\nONE AskUserQuestion call:\n(1) 타겟 브랜치\n(2) 동기화 방식\n(3) 충돌 처리 방침" -> "Collect Git Metadata" [label="behind = 0"];
    "Commit / Continue\nRebase" -> "Collect Git Metadata";
    "Commit / Continue\nRebase" -> "0-C: Conflict?" [label="rebase:\nmore commits"];
    "Collect Git Metadata" -> "Explore Codebase Patterns";
    "Explore Codebase Patterns" -> "Interview Mode";
    "Interview Mode" -> "Clearance Checklist";
    "Clearance Checklist" -> "Interview Mode" [label="ANY NO"];
    "Clearance Checklist" -> "Scope Assessment" [label="ALL YES"];
    "Scope Assessment" -> "Draft PR Description" [label="Single thesis"];
    "Scope Assessment" -> "Split Proposal" [label="Multi-thesis"];
    "Split Proposal" -> "Branch Separation\n(worktree per sub-PR)" [label="Accept"];
    "Split Proposal" -> "Draft PR Description" [label="Reject"];
    "Split Proposal" -> "Split Proposal" [label="Modify"];
    "Branch Separation\n(worktree per sub-PR)" -> "Sub-PR Loop\n(Step 6-8 per sub-PR\nincl. user confirmation)";
    "Branch Separation\n(worktree per sub-PR)" -> "Draft PR Description" [label="Fallback\n(conflict/mixed)"];
    "Sub-PR Loop\n(Step 6-8 per sub-PR\nincl. user confirmation)" -> "Return PR URL";
    "Draft PR Description" -> "Present to User";
    "Present to User" -> "User Feedback";
    "User Feedback" -> "Draft PR Description" [label="Revision requested"];
    "User Feedback" -> "Confirm PR Creation" [label="Approved"];
    "Confirm PR Creation" -> "Output Description Only" [label="Declined"];
    "Confirm PR Creation" -> "Ahead Check\n(commits not in base)" [label="Confirmed"];
    "Ahead Check\n(commits not in base)" -> "gh pr create" [label="ahead > 0"];
    "Ahead Check\n(commits not in base)" -> "Report Absorbed\n+ Stop" [label="ahead = 0"];
    "gh pr create" -> "Return PR URL";
}
```

---

## Step 0: Base Branch Detection & Synchronization

Upon receiving a PR writing request, detect the target base branch via heuristic analysis, confirm with the user, and synchronize the current branch before collecting metadata.

---

### Step 0-A: Base Branch Detection

**Phase 1 — Fetch all remote state:**

```bash
git fetch --all --prune
```

**Phase 2 — Analyze all remote branches as candidates:**

For every remote branch **except the current branch's remote counterpart** (`origin/$(git branch --show-current)`) and symbolic refs (`origin/HEAD`), compute merge-base distance:

```bash
# For each remote branch {branch}:
MERGE_BASE=$(git merge-base HEAD origin/{branch} 2>/dev/null || true)
if [ -z "$MERGE_BASE" ]; then continue; fi  # Skip unrelated/orphan branches
AHEAD=$(git rev-list --count $MERGE_BASE..HEAD)
BEHIND=$(git rev-list --count $MERGE_BASE..origin/{branch})
DIFF_STAT=$(git diff --stat $MERGE_BASE..HEAD | tail -1)
```

**Phase 3 — Build candidate table:**

Collect all candidates and present a table showing commits ahead/behind and change scale. Sort by `AHEAD` ascending (smallest diff from current branch = most likely true base):

```
| 후보 브랜치           | commits ahead | commits behind | 변경 규모              |
|----------------------|---------------|----------------|----------------------|
| sisyphus-myth-title  | 1             | 0              | +53 -70 (8 files)    |
| main                 | 17            | 0              | +1832 -1881 (17 files)|
```

Show the top 2-3 candidates. Native-capable clients may add one explicit branch-name option when needed; on Codex, expose only those top 2-3 candidates and rely on the UI's automatic `Other` for a free-form branch name — never add an explicit catch-all option.

**Phase 4 — Setup Question:**

Everything Step 0 needs from the user is settled in **one `AskUserQuestion` call**, assembled from the candidate table. Present the table first, then make the call with this `questions` array:

| # | header | question | options | Included when |
|---|--------|----------|---------|---------------|
| 1 | 타겟 브랜치 | 이 PR의 base 브랜치는 어디인가 | Native-capable clients: top 2-3 candidates with ahead/behind/change scale + one explicit branch-name option when needed. Codex: top 2-3 candidates only; the UI's automatic `Other` receives a free-form branch name | Always |
| 2 | 동기화 방식 | 타겟 브랜치가 앞서 있으면 그 커밋들을 어떻게 가져올까 | **merge**: 타겟 브랜치의 변경사항을 merge commit으로 통합합니다. 기존 히스토리가 보존됩니다. / **rebase**: 현재 브랜치의 커밋을 타겟 브랜치 위로 재배치합니다. 선형적인 히스토리를 유지합니다. | Any candidate in the table has `behind > 0` |
| 3 | 충돌 처리 | 동기화 중 충돌이 나면 어떻게 처리할까 | **파일별로 확인**: 충돌마다 양쪽 내용과 제안을 설명하고 물어봅니다. / **제안대로 자동 해결**: 각 충돌을 분석해 제안대로 바로 적용하고 결과를 보고합니다. / **현재 브랜치 우선**: 모든 충돌에서 현재 브랜치 쪽 변경을 채택합니다. / **타겟 브랜치 우선**: 모든 충돌에서 타겟 브랜치 쪽 변경을 채택합니다. | Question 2 is included |

The candidate table already carries `behind` for every candidate, so questions 2 and 3 are answerable before the target is picked — build them from the table, not from the answer to question 1.

Always include question 1 even when the default branch is the only likely candidate — never auto-skip.

On Codex, each structured setup question must offer **2–3 explicit options**; the UI adds an automatic `Other` option for free-form input, so do not add a fourth catch-all option. For conflict policy, render exactly **파일별로 확인**, **현재 브랜치 우선**, and **타겟 브랜치 우선** as the three explicit options; keep **제안대로 자동 해결** as the canonical `Other` input when the user wants the suggested resolution. Native-capable clients may show the four policies in the table below.

The answers drive the rest of Step 0: `{base-branch}` (question 1) is used in all subsequent git commands, `{sync-strategy}` (question 2) is executed in Step 0-B, `{conflict-policy}` (question 3) settles every conflict in Step 0-C.

---

### Step 0-B: Target Branch Synchronization

`{base-branch}` and `{sync-strategy}` are already answered. Confirm the divergence and execute — this step asks nothing:

```bash
git rev-list --left-right --count origin/{base-branch}...HEAD
# Output: {behind}\t{ahead}
```

**If behind = 0:** No synchronization needed. Proceed to Step 1.

**If behind > 0:** If the candidate table showed every candidate at `behind = 0` and no `{sync-strategy}` was collected, make **exactly one** late-divergence `AskUserQuestion`/user-input call before executing anything. Its `questions` array MUST contain both `{sync-strategy}` and `{conflict-policy}` questions in that same call; neither value may be collected in a separate call later. Otherwise, use the already-collected `{sync-strategy}`. In either case, execute the selected strategy only after the applicable answer is available:

```text
AskUserQuestion({
  questions: [
    { id: "sync-strategy", header: "동기화 방식", ... },
    { id: "conflict-policy", header: "충돌 처리", ... }
  ]
})
```

Only after that single call returns may the selected `{sync-strategy}` be executed; `{conflict-policy}` then governs every conflict in Step 0-C.

```bash
# merge
git merge origin/{base-branch}

# rebase
git rebase origin/{base-branch}
```

**If the operation completes without conflict:** Proceed to Step 1.

**If conflict is detected:** Proceed to Step 0-C.

---

### Step 0-C: Conflict Resolution

When a merge or rebase operation encounters conflicts:

**Phase 1 — Enumerate conflicted files:**

```bash
git diff --name-only --diff-filter=U
```

**Phase 2 — Analyze every conflicted file in this round:**

For each file in the list: read its contents, locate the conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`), work out what each side holds, and form a proposed resolution with reasoning. Use the correct ours/theirs mapping for the operation in progress:

- **During merge:** `HEAD` side (ours) = current branch changes, incoming side (theirs) = target branch changes
- **During rebase:** `HEAD` side (ours) = target branch changes (commit being rebased onto), incoming side (theirs) = current branch changes (commit being replayed)

**Phase 3 — Settle them per `{conflict-policy}`:**

| `{conflict-policy}` | How this round is settled |
|---|---|
| 파일별로 확인 | Explain this round's conflicts in plain text — one short block per file: what each side holds, what the conflict represents, the proposed resolution and its reasoning. Native-capable clients may ask about up to 4 files per call; Codex batches are capped at 3 files per call. A later batch starts with the remaining files. Each question offers **제안대로 해결** / **현재 브랜치 유지** (merge: ours / rebase: theirs) / **타겟 브랜치 채택** (merge: theirs / rebase: ours) |
| 제안대로 자동 해결 | Apply the Phase 2 proposal to every file |
| 현재 브랜치 우선 | Take the current branch's side in every file — merge: `git checkout --ours {file}`, rebase: `git checkout --theirs {file}` |
| 타겟 브랜치 우선 | Take the target branch's side in every file — merge: `git checkout --theirs {file}`, rebase: `git checkout --ours {file}` |

Stage each settled file:

```bash
git add {file}
```

Under the three non-interactive policies, report what was applied per file in plain text after the operation finishes, so the user can see the resolutions they did not individually approve.

**Phase 4 — Finalize the operation:**

After all conflicted files are resolved:

```bash
# If merge:
git commit --no-edit   # creates the merge commit with default message

# If rebase:
git rebase --continue
```

**Phase 5 — Check for additional conflicts:**

If `git rebase --continue` triggers a new conflict (rebase replays commits one by one), return to Phase 1 and repeat for the new conflict set. `{conflict-policy}` is answered once and carries across every round — do not re-ask it.

**When all conflicts are resolved and the operation completes:** Proceed to Step 1.

---

## Step 1: Collect Git Metadata & PR Conventions

After base branch detection and fetch, collect lightweight git metadata.

```bash
# Commit history
git log origin/{base-branch}..HEAD --oneline

# Changed file list
git diff origin/{base-branch}..HEAD --stat

# Commit messages and descriptions
git log origin/{base-branch}..HEAD --format='%s%n%b'
```

Use this metadata as supplementary context for the interview. Use it to gauge the scope and scale of changes, but do NOT read actual file contents.

### PR Convention Survey

Survey the repo's recent PRs to learn its title, branch-name, and label conventions. Run once per session, right after metadata collection:

```bash
# Recent PRs (10-30): title / branch / label conventions
gh pr list --state all --limit 30 --json number,title,labels,headRefName

# Labels that actually exist in the repo
gh label list --limit 100
```

From the survey, derive and record three values for later steps:

| Value | Derived from | What to extract |
|-------|-------------|-----------------|
| `{title-convention}` | `title` field | Prefix style (conventional commit / gitmoji / bare), language, typical length |
| `{branch-convention}` | `headRefName` field | Naming pattern (e.g., `feat/*`, `fix/*`, `{user}/*`, kebab-case topic) |
| `{label-convention}` | `labels` field | Which labels are applied to which kinds of change (feature/fix/refactor/docs …) |

**Convention exists only when a majority pattern does.** An axis counts as having a convention only when BOTH hold: (1) at least 5 PRs were surveyed, and (2) strictly more than half of them share the pattern — an exact tie (e.g., 3-3 between two styles) means no convention. With fewer than 5 surveyed PRs, mark every axis "no convention" — a handful of PRs is not a convention. For any axis without a convention, use the fallback defaults (title: conventional commit style Korean, branch: keep current name, labels: none).

**Never invent labels.** Only labels present in `gh label list` output may ever be applied. If no existing label fits, apply none.

---

## Step 2: Explore Codebase Patterns

Use the explore agent to understand codebase patterns and structure. For architecture-level changes (e.g., module restructuring, design pattern changes), additionally consult oracle for deeper analysis. Do NOT ask the user about the codebase.

**Context Brokering (CRITICAL):**

| Question Type | Ask User? | Action |
|---------------|-----------|--------|
| "What's the project architecture?" | NO | Discover via explore |
| "Which files changed?" | NO | Check via git metadata |
| "What are the existing patterns?" | NO | Discover via explore |
| "What's the architectural impact?" | NO | Consult oracle |
| "What's the motivation for this change?" | YES | User interview |
| "What alternatives were considered?" | YES | User interview |
| "Anything you want to ask reviewers?" | YES | User interview |

**Only ask the user about PREFERENCES and DECISIONS. Discover FACTS yourself.**

---

## Step 3: User Interview

### Interview Rules

1. **One question at a time** -- never bundle multiple questions. This governs the Step 3 interview, where each answer shapes the next question. It does not reach Step 0, whose decisions are all answerable from the same candidate table and are collected in a single call
2. **Adaptive question count** -- repeat until Clearance Checklist is all YES. Could be 1-2 if user provides enough upfront, or 5-6+ for complex changes
3. **AskUserQuestion = structured choices**, plain text = open-ended questions
4. **Context Brokering** -- if the codebase can answer it, use explore instead of asking
5. **No shortcut from prior sessions** -- memory, plans, and previous session context do not replace the interview. Always start from git metadata + explore

### Question Type Selection

| Situation | Method | Reason |
|-----------|--------|--------|
| Decision with 2-4 clear options | AskUserQuestion | Provide structured choices |
| Open/subjective question | plain text | Free-form answer needed |
| Yes/No confirmation | plain text | AskUserQuestion is overkill |

### Question Quality Standard

```yaml
BAD:
  question: "What changed?"

GOOD:
  question: "I see changes in OrderService and PaymentService from git log.
    The commit messages suggest event-based decoupling.
    Could you share the core motivation (e.g., removing domain coupling,
    transaction separation, scalability)?"
```

### Handling User Responses

**Vague answers:**
1. Do not accept as-is
2. Ask specific follow-up questions
3. Repeat until clear

**Explicit delegation** ("figure it out", "pass", "you decide"):
1. Investigate autonomously via explore/git metadata
2. Decide based on industry best practices or codebase patterns
3. Reflect the decision in the PR description

**Bare-text reference (e.g., issue key, channel name):**
1. Ask once for the full URL/permalink so References can be rendered as a markdown link
2. If the user has no URL, bare-text is acceptable as fallback

---

## Step 4: Clearance Checklist (Interview Exit Condition)

**Run after every interview turn.** If ANY NO, continue the interview.

| # | Check | Must Be |
|---|-------|---------|
| 1 | Is the background/purpose clear enough to write Summary? | YES |
| 2 | Are the changes and their reasons clear enough to write Changes? | YES |
| 3 | Are enough technical decisions/concerns collected to write Review Points? | YES |
| 4 | Are acceptance criteria organized enough to write Checklist? | YES |

**All YES** -> Proceed to Step 5.
**Any NO** -> Continue interview. Do not proceed.

This checklist is internal -- do NOT show it to the user.

---

## Step 5: Scope Assessment

After Clearance Checklist passes, analyze whether the PR contains multiple independent theses (behavioral changes) that should be separate PRs. **Read `references/scope-assessment.md` now** — it contains the complete multi-thesis split framework required for this step.

**Quick summary:**
1. Identify candidate theses, then absorb exception-matching changes (campsite cleanup, minimal cross-domain) into their nearest main thesis
2. Check proxy signals (commit type diversity, domain spread, LOC) as initial triggers
3. Apply thesis isolation test: "Does this PR prove a single thesis?"
4. If single thesis → proceed to Step 6
5. If multi-thesis → propose split to user (Accept/Reject/Modify)
6. On Accept → create one git worktree per sub-PR (so each PR stays editable side by side once review starts), write sub-PR descriptions (Step 6-8 per sub-PR)
7. On Reject → proceed to Step 6 as single PR

**Data sources:** `git diff origin/{base-branch}..HEAD --stat`, `git log`, explore results, interview answers. Never read `git diff` file contents.

---

## Step 6: Write PR Title & Description

### PR Title

- Include a PR title along with the description body
- Format: follow `{title-convention}` from the Step 1 PR Convention Survey — match the surveyed prefix style, language, and length
- Title-language precedence: for the title only, the surveyed language wins over the Korean default (an English-titled repo gets an English title). The PR body and user conversation remain Korean regardless
- Fallback (no surveyed convention): conventional commit style (`feat:`, `fix:`, `refactor:`, etc.), Korean, under 50 characters (excluding prefix)
- Fallback example: `refactor: 주문-결제 간 이벤트 기반 아키텍처 전환`
- **Split sub-PR**: the title carries its position in the series as a ` (K/N)` suffix after the convention-conforming title — `feat: 주문 이벤트 스키마 정의 (1/3)`. The suffix sits at the end so the surveyed prefix style still leads

### PR Labels

- Select labels per `{label-convention}` from the Step 1 survey: pick the label(s) the repo applies to this kind of change
- Only labels that exist in `gh label list` output — never invent one; if none fits, apply none
- Present the selected labels alongside the title and body in Step 7 so the user reviews them together

### Writing Principles

- Write so fellow developers can quickly understand the changes
- Be concise and focused on essentials
- Separate "what changed" (Changes) from "what needs discussion" (Review Points)
- Proactively identify areas where reviewer feedback would help
- Base on provided documents and code; ask for confirmation if uncertain

### Output Format

**MUST read `references/output-format.md` before writing the PR body.** It contains the definitive template (emoji headers, Impact Scope field, Review Points 5-part structure, Checklist format). Follow it exactly. Key requirements:

- Use emoji section headers: `📌 Summary`, `🔧 Changes`, `💬 Review Points`, `✅ Checklist`, `📎 References`
- Each Changes subsection MUST include `**영향 범위**` (Impact Scope)
- Each Checklist item MUST be a **verifiable acceptance criterion** in `- [ ]` checkbox format, with the relevant file path indented below. Write true/false verifiable conditions, not file lists or feature descriptions.
- Review Points MUST use the 5-part structure: 배경 및 문제 상황 → 해결 방안 → 구현 세부사항 → 관련 코드 (optional) → 선택과 트레이드오프

### Review Points Selection Criteria

- Core architecture decisions
- Trade-offs between competing concerns (performance vs readability, simplicity vs extensibility)
- Patterns/approaches where multiple valid alternatives exist
- Areas where a senior engineer's domain expertise would be valuable
- Implementation choices that deviate from common conventions
- Mixed strategies within the same flow (e.g., different lock mechanisms)
- Data modeling decisions affecting future extensibility

### Each Review Point Structure

1. **배경 및 문제 상황**: Why it was needed, what problem existed
2. **해결 방안**: How it was solved (overview)
3. **구현 세부사항**: Detailed implementation explanation
4. **관련 코드**: (Optional) Useful for Before/After comparison
5. **선택과 트레이드오프**: Rationale for the choice, rejected alternatives, acknowledged trade-offs. Include open questions only when they naturally arise.

---

## Step 7: User Review & Revision

Present the drafted PR description to the user and collect feedback.

- If approved: proceed to Step 8
- If revision requested: incorporate feedback and re-present

---

## Step 8: PR Creation

After user approves the PR description, ask if they want to create the PR.

### Pre-creation Check

Before pushing, verify the branch still holds commits that `{base-branch}` does not:

```bash
git fetch origin {base-branch}
AHEAD=$(git rev-list --count origin/{base-branch}..HEAD)
```

| Condition | Action |
|-----------|--------|
| `AHEAD > 0` | Proceed to push + `gh pr create` |
| `AHEAD == 0` | The branch's commits already exist in `{base-branch}` — there is nothing to open a PR for. Tell the user and stop |

`AHEAD` is a property of the current branch, so this check is evaluated once and its answer does not change when the target branch receives new commits meanwhile. It is also the only precondition `gh pr create` needs: GitHub computes the merge server-side, so the branch does not have to be up to date with the target. Synchronizing the branch with the target is handled earlier, by the Step 0-B merge/rebase that runs before the interview.

- If user confirms: check branch name convention, push the branch, and run `gh pr create` with the approved title, description, assignee, and labels
- If user declines: output the final PR description only

For a split sub-PR, resolve its branch → worktree mapping from Step 5 and bind the matching `$WT_DIR` before any ahead check, branch-name/convention check, remote lookup, rename, or push. If the mapping is missing, stop and ask the user; never infer a worktree path. Run those operations from the bound `$WT_DIR`, then create the PR with the mapped branch. This binding rule applies only to split sub-PRs; single-PR Step 8 keeps the flow below unchanged.

### Branch Name Convention Check (before push)

If `{branch-convention}` exists (Step 1 survey) and the current branch name does not match it:

1. Skip when the branch already exists on origin (`git ls-remote --heads origin {current-branch}` non-empty) — renaming a pushed branch orphans the remote copy
2. Otherwise propose a convention-conforming name via AskUserQuestion:
   - **{proposed-name}으로 변경**: `git branch -m {proposed-name}` then push under the new name
   - **현재 이름 유지**: push as-is

**For single PR** (create after remote push):

```bash
# Single PR (create after remote push)
# If the Step 0-B synchronization used rebase:
git push --force-with-lease -u origin HEAD
# If merge was used or no sync was needed:
git push -u origin HEAD
TITLE=$(cat <<'EOF'
PR title
EOF
)
gh pr create --base {base-branch} --head $(git branch --show-current) --assignee @me --title "$TITLE" --body "$(cat <<'EOF'
PR description body
EOF
)" --label "{label-1}" --label "{label-2}"
```

- `--assignee @me` is always included: the PR is assigned to the authenticated gh user
- `--label` once per selected label from Step 6; omit the flag entirely when no label was selected

**Sub-PR (Stacked split):**
- Branch push already completed during Step 5 branch separation procedure (sub-branch names follow `{branch-convention}`; each sub-branch is checked out in its own worktree)
- Title carries the ` (K/N)` position suffix, body opens with the split context block (`references/scope-assessment.md`)
- First sub-PR: `--base {base-branch}`
- Subsequent sub-PRs: `--base {previous-split-branch}`

**Split-only Step 8 command block** (run once per mapped sub-PR; do not use this block for a single PR):

```bash
WT_DIR="{mapped-worktree}"
TARGET_SUB_BRANCH=$(git -C "$WT_DIR" branch --show-current)
git -C "$WT_DIR" fetch origin {appropriate-base}
AHEAD=$(git -C "$WT_DIR" rev-list --count origin/{appropriate-base}..{target-sub-branch})
if [ "$AHEAD" -eq 0 ]; then
  echo "No commits to open for {target-sub-branch}" >&2
  exit 0
fi
REMOTE_TARGET=$(git -C "$WT_DIR" ls-remote --heads origin "$TARGET_SUB_BRANCH")
if [ -z "$REMOTE_TARGET" ] && [ "$TARGET_SUB_BRANCH" != "{target-sub-branch}" ]; then
  git -C "$WT_DIR" branch -m {target-sub-branch}
  TARGET_SUB_BRANCH="{target-sub-branch}"
fi
git -C "$WT_DIR" push -u origin {target-sub-branch}
TITLE=$(cat <<'EOF'
PR title
EOF
)
gh pr create --base {appropriate-base} --head {target-sub-branch} --assignee @me --title "$TITLE" --body "$(cat <<'EOF'
PR description body
EOF
)" --label "{label-1}"
```

Return the PR URL to the user after successful creation.

---

## Examples

Read these to calibrate PR body style before writing:

- `examples/example-001.md`: Event-driven architecture PR — domain decoupling, compensating transactions, layer responsibility separation
- `examples/example-002.md`: Kafka event pipeline PR — Transactional Outbox Pattern, idempotency guarantees, multi-module setup

---

**Step-by-step summary cheat-sheet:** read `references/reference-tables.md` when you need a quick step summary.

**Known failure-mode lookup:** read `references/reference-tables.md` during self-review to check against documented failure modes.

---

## Reference Files (on-demand)

| Reference file | What it contains | When to read |
|---|---|---|
| `references/scope-assessment.md` | Multi-thesis PR split framework | **Step 5** (scope assessment) |
| `references/output-format.md` | Definitive PR body template: emoji headers, Impact Scope field, Review Points 5-part structure, Checklist format | **Step 6** (write PR title & description) — read before writing |
| `references/reference-tables.md` | Step-by-step summary cheat-sheet + known-failure-mode lookup | When you need a quick step summary or during self-review |
| `examples/example-001.md` | Worked example: event-driven architecture PR (domain decoupling, compensating transactions, layer responsibility separation) | To calibrate PR body style before writing |
| `examples/example-002.md` | Worked example: Kafka event pipeline PR (Transactional Outbox Pattern, idempotency guarantees, multi-module setup) | To calibrate PR body style before writing |

---

## Language Rules

- Entire PR body in Korean
- Conversations with user also in Korean
- PR title language follows `{title-convention}` when a surveyed convention exists; fallback is Korean
