---
name: make-pr
description: "Analyzes git diffs and generates structured Korean PR descriptions with motivation, changes overview, and review points from a senior engineer perspective. Use when the user asks to create a PR, write a PR description, PR 작성, make PR, PR 만들어, 풀리퀘, or pull request 작성."
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
| Write in Korean | Project convention | "English is easier" | Project rules take priority |
| Never run `gh pr create` without user confirmation | PR creation requires explicit user approval | "Just create it directly" | Always confirm before creating PR |
| Never read git diff file contents for PR description writing | Use metadata only | "Need to see code for accuracy" | Use explore for patterns. User interview is key. Exception: conflict resolution in Step 0-C requires reading file contents to analyze and resolve conflicts |
| Never reference non-git content in PR | Reviewers can't access agent-internal files | "Memory/plan adds context" | PR is a public document; internal files are inaccessible to reviewers |

</Critical_Constraints>

---

## Scope

Writes PR description body. Optionally assesses PR scope for multi-thesis splitting. Detects base branch via heuristic merge-base analysis, confirms target branch with user, performs target branch synchronization with conflict resolution at request start, then collects metadata → interview → assessment → description. Creates the PR via `gh pr create` after user approval.

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
        label="Step 0: Base Branch Detection & Synchronization";
        style=dashed;
        "0-A: Fetch & Analyze\nAll Remote Branches" [shape=box];
        "Present Candidate Table\n+ AskUserQuestion" [shape=box];
        "Target Branch\nConfirmed" [shape=box];
        "0-B: Check Diverge\n(behind count)" [shape=diamond];
        "0-B: merge/rebase\nInterview + Execute" [shape=box];
        "0-C: Conflict?" [shape=diamond];
        "0-C: Per-file\nContext + Interview" [shape=box];
        "More Conflicts?" [shape=diamond];
        "Commit / Continue\nRebase" [shape=box];

        "0-A: Fetch & Analyze\nAll Remote Branches" -> "Present Candidate Table\n+ AskUserQuestion";
        "Present Candidate Table\n+ AskUserQuestion" -> "Target Branch\nConfirmed";
        "Target Branch\nConfirmed" -> "0-B: Check Diverge\n(behind count)";
        "0-B: Check Diverge\n(behind count)" -> "0-B: merge/rebase\nInterview + Execute" [label="behind > 0"];
        "0-B: merge/rebase\nInterview + Execute" -> "0-C: Conflict?";
        "0-C: Conflict?" -> "0-C: Per-file\nContext + Interview" [label="YES"];
        "0-C: Conflict?" -> "Collect Git Metadata" [label="NO"];
        "0-C: Per-file\nContext + Interview" -> "More Conflicts?";
        "More Conflicts?" -> "0-C: Per-file\nContext + Interview" [label="YES"];
        "More Conflicts?" -> "Commit / Continue\nRebase" [label="NO"];
    }

    "Collect Git Metadata" [shape=box];
    "Explore Codebase Patterns" [shape=box];
    "Interview Mode" [shape=box];
    "Clearance Checklist" [shape=diamond];
    "Scope Assessment" [shape=diamond];
    "Split Proposal" [shape=box];
    "Branch Separation" [shape=box];
    "Sub-PR Loop\n(Step 6-8 per sub-PR\nincl. user confirmation)" [shape=box];
    "Draft PR Description" [shape=box];
    "Present to User" [shape=box];
    "User Feedback" [shape=diamond];
    "Confirm PR Creation" [shape=diamond];
    "CAS Freshness\nCheck" [shape=diamond];
    "gh pr create" [shape=box];
    "Return PR URL" [shape=ellipse];
    "Output Description Only" [shape=ellipse];

    "User Request" -> "0-A: Fetch & Analyze\nAll Remote Branches";
    "0-B: Check Diverge\n(behind count)" -> "Collect Git Metadata" [label="behind = 0"];
    "Commit / Continue\nRebase" -> "Collect Git Metadata";
    "Commit / Continue\nRebase" -> "0-C: Conflict?" [label="rebase:\nmore commits"];
    "Collect Git Metadata" -> "Explore Codebase Patterns";
    "Explore Codebase Patterns" -> "Interview Mode";
    "Interview Mode" -> "Clearance Checklist";
    "Clearance Checklist" -> "Interview Mode" [label="ANY NO"];
    "Clearance Checklist" -> "Scope Assessment" [label="ALL YES"];
    "Scope Assessment" -> "Draft PR Description" [label="Single thesis"];
    "Scope Assessment" -> "Split Proposal" [label="Multi-thesis"];
    "Split Proposal" -> "Branch Separation" [label="Accept"];
    "Split Proposal" -> "Draft PR Description" [label="Reject"];
    "Split Proposal" -> "Split Proposal" [label="Modify"];
    "Branch Separation" -> "Sub-PR Loop\n(Step 6-8 per sub-PR\nincl. user confirmation)";
    "Branch Separation" -> "Draft PR Description" [label="Fallback\n(conflict/mixed)"];
    "Sub-PR Loop\n(Step 6-8 per sub-PR\nincl. user confirmation)" -> "Return PR URL";
    "Draft PR Description" -> "Present to User";
    "Present to User" -> "User Feedback";
    "User Feedback" -> "Draft PR Description" [label="Revision requested"];
    "User Feedback" -> "Confirm PR Creation" [label="Approved"];
    "Confirm PR Creation" -> "Output Description Only" [label="Declined"];
    "Confirm PR Creation" -> "CAS Freshness\nCheck" [label="Confirmed"];
    "CAS Freshness\nCheck" -> "gh pr create" [label="Fresh"];
    "CAS Re-sync\n(re-use or\nnew interview)" [shape=box];
    "CAS Conflict\nResolution (→ 0-C)" [shape=box];
    "CAS Freshness\nCheck" -> "CAS Re-sync\n(re-use or\nnew interview)" [label="Stale"];
    "CAS Re-sync\n(re-use or\nnew interview)" -> "gh pr create" [label="sync complete"];
    "CAS Re-sync\n(re-use or\nnew interview)" -> "CAS Conflict\nResolution (→ 0-C)" [label="conflict"];
    "CAS Conflict\nResolution (→ 0-C)" -> "gh pr create";
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

Show the top 2-3 candidates. If more branches exist, include an "other" option.

**Phase 4 — Confirm with user via AskUserQuestion:**

Always ask even when the default branch is the only likely candidate — never auto-skip.

Present the candidate table, then ask the user to select the target branch. Include:
- Each top candidate as a labeled option
- An option to type a custom branch name if none of the candidates apply

Use the confirmed value as `{base-branch}` in all subsequent git commands.

**Phase 5 — Record baseline target SHA:**

After user confirms the target branch, record the target branch tip SHA as the CAS baseline for Step 8 freshness check:

```bash
BASELINE_TARGET_SHA=$(git rev-parse origin/{base-branch})
```

This value is compared again at PR creation time (Step 8) to detect if the target branch tip has moved during the PR writing process.

---

### Step 0-B: Target Branch Synchronization

After the target branch is confirmed, check if the current branch has diverged:

```bash
git rev-list --left-right --count origin/{base-branch}...HEAD
# Output: {behind}\t{ahead}
```

**If behind = 0:** No synchronization needed. Proceed to Step 1.

**If behind > 0:** The current branch is behind `origin/{base-branch}`. Ask the user which strategy to use via AskUserQuestion:

- **merge**: 타겟 브랜치의 변경사항을 merge commit으로 통합합니다. 기존 히스토리가 보존됩니다.
- **rebase**: 현재 브랜치의 커밋을 타겟 브랜치 위로 재배치합니다. 선형적인 히스토리를 유지합니다.

Execute the chosen strategy:

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

**Phase 2 — Resolve each file interactively:**

For each conflicted file, repeat:

1. Read the file contents and locate conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
2. Analyze both sides:
   - **During merge:** `HEAD` side (ours) = current branch changes, incoming side (theirs) = target branch changes
   - **During rebase:** `HEAD` side (ours) = target branch changes (commit being rebased onto), incoming side (theirs) = current branch changes (commit being replayed)
3. Explain the conflict in plain text to the user: what each side contains and what the conflict represents. Use the correct ours/theirs mapping for the current operation (merge vs rebase).
4. Propose a resolution with reasoning.
5. Ask the user to choose via AskUserQuestion:
   - **제안대로 해결**: Apply the proposed resolution
   - **현재 브랜치 유지**: Keep only the current branch's changes (merge: ours / rebase: theirs)
   - **타겟 브랜치 채택**: Keep only the target branch's changes (merge: theirs / rebase: ours)
6. Apply the chosen resolution and stage the file:
   ```bash
   git add {file}
   ```

**Phase 3 — Finalize the operation:**

After all conflicted files are resolved:

```bash
# If merge:
git commit --no-edit   # creates the merge commit with default message

# If rebase:
git rebase --continue
```

**Phase 4 — Check for additional conflicts:**

If `git rebase --continue` triggers a new conflict (rebase replays commits one by one), return to Phase 1 and repeat for the new conflict set.

**When all conflicts are resolved and the operation completes:** Proceed to Step 1.

---

## Step 1: Collect Git Metadata

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

1. **One question at a time** -- never bundle multiple questions
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

After Clearance Checklist passes, analyze whether the PR contains multiple independent theses (behavioral changes) that should be separate PRs. See `references/scope-assessment.md` for the complete framework.

**Quick summary:**
1. Identify candidate theses, then absorb exception-matching changes (campsite cleanup, minimal cross-domain) into their nearest main thesis
2. Check proxy signals (commit type diversity, domain spread, LOC) as initial triggers
3. Apply thesis isolation test: "Does this PR prove a single thesis?"
4. If single thesis → proceed to Step 6
5. If multi-thesis → propose split to user (Accept/Reject/Modify)
6. On Accept → separate git branches, write sub-PR descriptions (Step 6-8 per sub-PR)
7. On Reject → proceed to Step 6 as single PR

**Data sources:** `git diff origin/{base-branch}..HEAD --stat`, `git log`, explore results, interview answers. Never read `git diff` file contents.

---

## Step 6: Write PR Title & Description

### PR Title

- Include a PR title along with the description body
- Format: conventional commit style (`feat:`, `fix:`, `refactor:`, etc.)
- Language: Korean
- Length: under 50 characters (excluding prefix)
- Example: `refactor: 주문-결제 간 이벤트 기반 아키텍처 전환`

### Writing Principles

- Write so fellow developers can quickly understand the changes
- Be concise and focused on essentials
- Separate "what changed" (Changes) from "what needs discussion" (Review Points)
- Proactively identify areas where reviewer feedback would help
- Base on provided documents and code; ask for confirmation if uncertain

### Output Format

**MUST** follow `references/output-format.md` exactly. Key requirements:

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

### Pre-creation Freshness Check (CAS Pattern)

Before pushing and creating the PR, verify the target branch hasn't changed since Step 0-A:

```bash
# Re-fetch target branch
git fetch origin {base-branch}

# Check target branch tip
CURRENT_TARGET_SHA=$(git rev-parse origin/{base-branch})
```

**Compare with baseline:**

| Condition | Action |
|-----------|--------|
| `CURRENT_TARGET_SHA == BASELINE_TARGET_SHA` | Target unchanged — proceed to push + `gh pr create` |
| `CURRENT_TARGET_SHA != BASELINE_TARGET_SHA` | Target has moved — re-sync before creating PR |

**When target has moved:**

1. Inform the user that the target branch has new commits since the analysis began
2. If a strategy was selected in Step 0-B: re-use it automatically (do NOT re-interview)
   If Step 0-B was skipped (behind was 0): ask the user via AskUserQuestion which strategy to use (merge/rebase)
3. Execute the sync (merge or rebase)
4. If conflict arises: follow Step 0-C conflict resolution interview
5. After successful sync: proceed to push + `gh pr create`
6. PR description is NOT re-written (the feature branch changes are the same; only the base has moved)

- If user confirms: push the branch and run `gh pr create` with the approved title and description
- If user declines: output the final PR description only

**For single PR** (create after remote push):

```bash
# Single PR (create after remote push)
# If rebase was used (Step 0-B or Step 8 CAS re-sync):
git push --force-with-lease -u origin HEAD
# If merge was used or no sync was needed:
git push -u origin HEAD
TITLE=$(cat <<'EOF'
PR title
EOF
)
gh pr create --base {base-branch} --head $(git branch --show-current) --title "$TITLE" --body "$(cat <<'EOF'
PR description body
EOF
)"
```

**Sub-PR (Stacked split):**
- Branch push already completed during Step 5 branch separation procedure
- First sub-PR: `--base {base-branch}`
- Subsequent sub-PRs: `--base {previous-split-branch}`

```bash
TITLE=$(cat <<'EOF'
PR title
EOF
)
gh pr create --base {appropriate-base} --head {target-sub-branch} --title "$TITLE" --body "$(cat <<'EOF'
PR description body
EOF
)"
```

Return the PR URL to the user after successful creation.

---

## Examples

- `examples/example-001.md`: Event-driven architecture PR — domain decoupling, compensating transactions, layer responsibility separation
- `examples/example-002.md`: Kafka event pipeline PR — Transactional Outbox Pattern, idempotency guarantees, multi-module setup

---

## Quick Reference

| Step | Action | Key Point |
|------|--------|-----------|
| 0-A: Base Branch Detection | `git fetch --all --prune`, merge-base analysis for all remote branches | Build candidate table, always confirm with AskUserQuestion — no auto-skip |
| 0-B: Target Sync | `git rev-list --left-right --count` to detect diverge | If behind > 0: merge/rebase interview + execute |
| 0-C: Conflict Resolution | Per-file context analysis + AskUserQuestion per conflict | Stage each resolved file, finalize with commit / rebase --continue |
| Collect Git Metadata | Run `git log`, `git diff --stat` | Metadata only, NO file contents |
| Explore Codebase | Use explore agent | Do NOT ask user about codebase |
| User Interview | One question at a time, Clearance Checklist-based | Adaptive question count |
| Clearance Checklist | Check after every turn | Continue until all YES |
| Scope Assessment | Analyze thesis count, propose split if multi-thesis | Proxy signals trigger analysis, thesis isolation decides |
| Write PR Title & Description | Follow output-format.md exactly | Emoji headers, Impact Scope, file paths in Checklist |
| User Review | Present and collect feedback | Repeat until approved |
| PR Creation | CAS freshness check → re-sync if target moved → `gh pr create` after user confirmation | Re-use Step 0-B strategy; re-interview only on conflict |

---

## Common Mistakes

| Mistake | Why It's a Problem | Fix |
|---------|-------------------|-----|
| Writing without Clearance Checklist | Incomplete info leads to inaccurate PR | Check checklist every turn |
| Bundling multiple questions | Increases user burden, lowers answer quality | One question at a time |
| Asking user about codebase facts | Unnecessary burden on user | Discover via explore |
| Describing design concerns in Changes | Mixes Changes and Review Points | Design concerns go in Review Points |
| Writing without Review Points | No focal points for reviewer feedback | Proactively identify Review Points |
| Running `gh pr create` without user confirmation | User must approve PR creation | Always confirm before running |
| Reading git diff file contents during PR description writing | Heavy context loading | Use git metadata + explore only (exception: Step 0-C conflict resolution) |
| Detecting only default branch | Stacked branches show massive diff against wrong base | Compare merge-base across all remote branches and present candidate table |
| Auto-selecting target branch | PR written against unintended target | Always confirm via AskUserQuestion — no auto-skip |
| Ignoring diverge | PR written against stale base | Sync via merge/rebase in Step 0-B |
| Ignoring conflicts | PR proceeds in incomplete state | Resolve all conflicts via per-file interview in Step 0-C |
| Fixing question count | Required questions vary by context | Adaptive via Clearance Checklist |
| Writing PR in English | Violates project convention | Write entirely in Korean |
| Missing emoji section headers | Inconsistent with output-format.md template | Use 📌, 🔧, 💬, ✅, 📎 prefixes |
| Checklist items without file paths | Unverifiable conditions | Add indented file path under each item |
| Checklist items are file lists or feature descriptions | Not verifiable, not acceptance criteria | Write verifiable acceptance criteria (true/false) |
| Missing Impact Scope in Changes | Reviewer can't assess blast radius | Add `**영향 범위**` per Changes subsection |
| Omitting PR title | Incomplete deliverable | Include conventional commit style Korean title |
| Writing textbook definitions in Review Points | Repeats what reviewers already know, filler | Describe the specific constraints you faced |
| Listing "improvement effects" as marketing | Irrelevant to Review Point purpose | Focus on choices and trade-offs |
| Including non-git documents (memory/plans) in References | Reviewers cannot access them | Reference only reviewer-accessible content (GitHub URLs, git-tracked docs) |
| Skipping interview based on prior session context | PR based on incomplete/biased info | Run Clearance Checklist-based interview every time |
| Deciding split based on proxy signals alone | Wrong split without thesis analysis | Proxy signals are detection triggers only; thesis isolation is the final criterion |
| Proposing unnecessary split for single-thesis PR | User burden, workflow delay | If single thesis, proceed to Step 6 immediately |
| Reading git diff file contents during scope assessment | Violates Non-Negotiable Rule | Use only git diff --stat and git log |
| Deleting original branch after split | User cannot recover | Always preserve the original branch |
| Skipping freshness check before PR creation | `gh pr create` fails or wrong diff when target branch moved | CAS pattern target SHA re-verification in Step 8 |

---

## Language Rules

- Entire PR body in Korean
- Conversations with user also in Korean
