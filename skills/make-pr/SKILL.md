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
| Write in Korean | Project convention | "English is easier" | Project rules take priority |
| Never run `gh pr create` without user confirmation | PR creation requires explicit user approval | "Just create it directly" | Always confirm before creating PR |
| Never read git diff file contents | Use metadata only | "Need to see code for accuracy" | Use explore for patterns. User interview is key |
| Never reference non-git content in PR | Reviewers can't access agent-internal files | "Memory/plan adds context" | PR is a public document; internal files are inaccessible to reviewers |

</Critical_Constraints>

---

## Scope

Writes PR description body. Optionally assesses PR scope for multi-thesis splitting. Detects base branch and fetches latest remote state at request start, then collects metadata → interview → assessment → description. Creates the PR via `gh pr create` after user approval.

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
    "Step 0: Base Branch Detection" [shape=box];
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
    "gh pr create" [shape=box];
    "Return PR URL" [shape=ellipse];
    "Output Description Only" [shape=ellipse];

    "User Request" -> "Step 0: Base Branch Detection";
    "Step 0: Base Branch Detection" -> "Collect Git Metadata";
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
    "Confirm PR Creation" -> "gh pr create" [label="Confirmed"];
    "gh pr create" -> "Return PR URL";
}
```

---

## Step 0: Base Branch Detection

Upon receiving a PR writing request, first detect the base branch and fetch its latest state.

Detect the project's base branch before any git operations:

```bash
# GitHub CLI (most accurate)
gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'

# Fallback: git remote HEAD
git symbolic-ref refs/remotes/origin/HEAD | sed 's@refs/remotes/origin/@@'

# Fallback: check if main or master exists on remote
git ls-remote --heads origin main   # if exit 0 and non-empty → use "main"
git ls-remote --heads origin master # if exit 0 and non-empty → use "master"

# If none of the above succeed: ask the user to specify the base branch
```

Use the detected value as `{base-branch}` in all subsequent git commands.

```bash
# Fetch latest state of base branch
git fetch origin {base-branch}
```

Proceed to Step 1.

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

- If user confirms: push the branch and run `gh pr create` with the approved title and description
- If user declines: output the final PR description only

**For single PR** (create after remote push):

```bash
# Single PR (create after remote push)
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
| Base Branch Detection | `git fetch origin {base-branch}` | Detect base branch, then fetch latest remote state |
| Collect Git Metadata | Run `git log`, `git diff --stat` | Metadata only, NO file contents |
| Explore Codebase | Use explore agent | Do NOT ask user about codebase |
| User Interview | One question at a time, Clearance Checklist-based | Adaptive question count |
| Clearance Checklist | Check after every turn | Continue until all YES |
| Scope Assessment | Analyze thesis count, propose split if multi-thesis | Proxy signals trigger analysis, thesis isolation decides |
| Write PR Title & Description | Follow output-format.md exactly | Emoji headers, Impact Scope, file paths in Checklist |
| User Review | Present and collect feedback | Repeat until approved |
| PR Creation | `gh pr create` after user confirmation | Return PR URL |

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
| Reading git diff file contents | Heavy context loading | Use git metadata + explore only |
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

---

## Language Rules

- Entire PR body in Korean
- Conversations with user also in Korean
