---
name: git-master
description: Use when committing changes to git or naming branches. Triggers include "commit", "커밋", "git commit", "finalize changes", "save to git", "commit my work", "branch name", "브랜치 이름", "what should I name this branch".
---

<Role>

# Git Master

Analyze code changes and generate Korean commit messages following project conventions. Also applies branch naming conventions when naming new branches.

> "A good commit makes history easy to read. A bad commit turns git log into a graveyard."

</Role>

---

<Critical_Constraints>

## The Iron Law

```
NO COMMIT WITHOUT:
1. Single logical change (or properly split)
2. Message ≤ 50 characters
3. Subject comprehensible to git log readers without external context
```

**Violating the letter of these rules IS violating the spirit.**

There are no exceptions. User preference does not override project rules.

---

## Non-Negotiable Rules

These are **RULES**, not guidelines. This project enforces them strictly.

| Rule | Why Non-Negotiable | Common Excuse | Reality |
|------|-------------------|---------------|---------|
| 50 char title limit | git log, GitHub, tools truncate | "Modern terminals..." | Tools haven't changed. 50 chars. |
| One logical change | Atomic = reviewable, revertable | "Save my work" | Use branches, not mega-commits |
| Korean 명사형 종결 | Project convention | "I prefer English" | Project rules override preference |

</Critical_Constraints>

---

## Workflow Files: NEVER COMMIT

These files are **workflow artifacts**, not implementation deliverables:

```bash
# ALWAYS unstage these before committing:
git reset HEAD plan.md 2>/dev/null || true
git reset HEAD research.md 2>/dev/null || true
git reset HEAD docs/specs/ 2>/dev/null || true
```

**Why?**
- `plan.md`: Worker updates separately after commit
- `research.md`: Research artifact, not code
- `docs/specs/*`: Input documents, never modified

If user says "I always commit plan.md with my code" → **Refuse**. Project rules.

---

## Best Practice Additions (Industry Standard)

### Imperative Mood
Commit messages should be written in imperative mood. The message should complete the sentence: "If applied, this commit will [your message]".

| Good | Bad |
|------|-----|
| feat: 사용자 인증 기능 추가 | feat: 사용자 인증 기능 추가함 |
| fix: 결제 오류 수정 | fix: 결제 오류 수정했음 |

### Breaking Changes
Changes that break backward compatibility must be marked:

| Method | Format | Example |
|--------|--------|---------|
| Type with exclamation | type + "!" + message | feat!: API 응답 형식 변경 |
| Footer | BREAKING CHANGE: desc | Write at the end of body |

### Git Trailers (Optional)
Add trailers at the end of body when needed:

| Trailer | Usage |
|---------|-------|
| `Co-authored-by:` | Pair programming |
| `Fixes:` | Issue linking (`Fixes: #123`) |
| `Signed-off-by:` | Projects requiring DCO |

---

## Core Principle

**One commit = One logical change**

- Separate unrelated changes (atomic commits)
- Title must be within 50 characters, core message only
- WHY goes in body (optional)
- Many files ≠ many commits — logical cohesion decides (see Atomic Commit Splitting)

**Product, Not Process** — Commit messages describe the change itself.

- Describe **what changed**, rather than the source of the change (code review, issue number, meeting decision)
- Someone reading `git log` six months later will not know what "리뷰 P1-3 수정" means
- Record the source/context in the body or a trailer (`Fixes #123`)

---

## Quick Reference

| Type | When | Korean Ending |
|------|------|---------------|
| `feat` | New functionality | 추가, 구현 |
| `fix` | Bug/error fixed | 수정 |
| `refactor` | Code restructured, no behavior change | 리팩토링, 개선 |
| `test` | Only tests added/modified | 추가, 수정 |
| `docs` | Only documentation | 작성, 수정 |
| `chore` | Build/config/tooling | 설정, 변경 |
| `perf` | Performance improved | 개선, 최적화 |

---

## Process Steps

### Step 1: Analyze Changes

```bash
git status
git diff
git diff --staged
```

For each changed file, categorize:
- What domain/feature is affected?
- What is the main change?
- Are there multiple logical changes? → Split!

### Atomic Commit Splitting

> "Separate each logical change into a separate patch." — Linux Kernel Documentation
>
> "If you make a single change to numerous files, group those changes into a single patch." — Linux Kernel Patch Philosophy

**File count is a TRIGGER for analysis, NOT a splitting rule.**

#### Split Analysis Trigger

| Changed Files | Action |
|---------------|--------|
| 1-2 files | Likely single commit — verify one logical change |
| 3+ files | **Pause and analyze** — are there multiple concerns? |
| 10+ files | **Strongly consider splitting** — multiple concerns are probable |

#### Mandatory Self-Check (3+ Files)

When 3+ files change, you must perform this self-check before committing:

```
"N개 파일을 M개 커밋으로 만든다."
IF M == 1 AND N >= 3:
  → Is this really one logical change?
  → Can you explain in one sentence why these files must stay together?
  → If you cannot → SPLIT
```

**This is not a numerical formula.** 3+ files means "think it through," not "always split." A single commit is justified when logical cohesion is sufficient, as in Example 7 (point accrual: 4 files = 1 commit).

#### Commit Justification (3+ Files per Commit)

When a commit includes 3 or more files, you must explain **why they belong together** in one sentence:

```
"이 커밋은 [파일들]을 포함한다. 이유: [구체적 이유]"
```

| Valid Reason | Invalid Reason (→ must split) |
|------------|------------------------|
| Implementation + its direct test file | "같은 기능 관련" (vague) |
| Type definition + its only consumer | "같은 PR에 포함" (not a reason) |
| Migration + model change (splitting breaks the build) | "함께 변경됨" (not a reason) |
| Multiple files in a single rename operation | "관련 있어서" (vague) |

**IMPORTANT**: One feature ≠ one commit. A feature may contain multiple logical changes (config, domain, service, test, docs). Each independently meaningful layer is a separate commit. However, a single atomic operation (e.g., renaming across 10 files) IS one commit.

#### When to Split

Split when ANY of these are true:

| Signal | Example |
|--------|---------|
| Different change types mixed | Bug fix + unrelated refactor |
| Different domains/modules affected | auth/ change + user/ change with no dependency |
| Independently revertable parts | Config change that works without the feature using it |
| Description gets too long | "Fixed X and also added Y and refactored Z" |
| Different architectural layers | Config + domain + service + test + docs for one feature |
| Multiple independent changes (even in 1-2 files) | 3 review findings each require an independent change → 3 commits |

#### When NOT to Split

Keep as single commit when:

| Signal | Example |
|--------|---------|
| Truly atomic operation | Renaming a class across 5 files |
| Tightly coupled pair | DTO definition + the single mapper using it |
| Cannot exist independently | Interface + its only implementation (in same module) |
| Single mechanical change | Formatting/linting across many files |

#### Grouping Strategy (when splitting)

Commit in this order (dependency-first):

1. **Config/Build** — dependencies, build settings
2. **Infrastructure** — refactoring, API changes
3. **Source/Logic** — business logic, features
4. **Tests** — related test code
5. **Documentation** — README, docs

#### Splitting Rules

Each split commit must:
- Be independently meaningful (not "part 1 of 3")
- Have its own proper commit message
- Leave the codebase in a buildable state
- Be revertable without breaking other commits

#### Test-Implementation Pairing

Test files must be included in the **same commit** as their corresponding implementation:

| Test Pattern | Implementation File |
|------------|----------|
| `*_test.sh` | `*.sh` |
| `*.test.ts` | `*.ts` |
| `*.spec.ts` | `*.ts` |
| `*Test.kt` | `*.kt` |
| `__tests__/*` | Corresponding source |

**Anti-pattern**: Splitting implementation and tests into separate commits. An implementation commit without tests cannot be verified in its intermediate state.

### Step 2: Verify No Workflow Files

```bash
git diff --staged --name-only | grep -E "^(plan\.md|research\.md|docs/specs/)"
```

If any match → Unstage them before proceeding.

### Step 3: Determine Commit Type

- New functionality → `feat`
- Bug/error fixed → `fix`
- Code restructured without behavior change → `refactor`
- Only tests → `test`
- Only docs → `docs`
  - **Functionality vs documentation**: "If it defines system behavior, it is functionality; if it provides reference/shared information for human readers, it is documentation"
  - Changes to functional files (SKILL.md, agents/*.md, rules/*.md, hooks/*) → `feat`/`fix`/`refactor`
  - Changes to documentation files (README.md, API specifications, guides) → `docs`
- Build/config → `chore`
- Performance → `perf`

### Step 4: Output Commit Plan (3+ Files — BLOCKING)

When 3 or more files change, you must output a commit plan before executing any commit:

```
COMMIT PLAN
───────────
변경 파일: N개
계획 커밋 수: M개

COMMIT 1: type: 제목
  - path/to/file1
  - path/to/file1_test
  Justification: 구현체 + 직접 테스트

COMMIT 2: type: 제목
  - path/to/file2
  Justification: 독립적 설정 변경

실행 순서: Commit 1 → Commit 2
(의존성 순서: Config → Source → Test → Docs)
```

**Do not proceed to commit execution without this output.** Skip this step for changes to 1-2 files.

> **Caution about `fix`**: Changes arising from code review are not all `fix`. Even for review findings, use `feat` for new functionality and `refactor` for structural improvements. Only actual bug/error fixes use `fix`.

### Step 5: Generate Commit Message

<a id="mandatory-self-check-제목-초안-작성-직후"></a>
#### MANDATORY Self-Check (Immediately After Drafting the Subject)

Immediately after drafting the subject and before committing, you must check it for invented/opaque labels. **If any pattern matches, rewrite and check again.** This check enforces anti-pattern 1 (Invented/opaque label ban) of the `communication-style` rule (`rules/communication-style.md`). The canonical source of the detection regexes is `hooks/lib/label-patterns.sh` — git-master does not keep its own copy.

**Why this is mandatory**: Plan step numbers and AC IDs are clear to the worker viewing the plan, but git log readers cannot access that plan — past violations have required history rewrites to correct them.

**When a violating pattern is found:**
- Simply remove the token: `(Step 12)` → delete (when the subject is already self-contained in domain terms)
- Replace the token with domain terms: `align RN tooling lockstep with mobile (Step 4)` → `RN tooling mobile에 정렬`
- If traceability is truly needed, move it to a body trailer: `Refs: dispenser-monorepo-absorption.md#step-12`

**Subject rules (NON-NEGOTIABLE):**
- Korean (한국어)
- **Max 50 characters** ← ENFORCED, not a guideline
- 명사형 종결 (e.g., "추가", "수정", "삭제", "구현", "개선")
- No period at end

**Subject content rule:**

The subject's audience is a future git log reader — someone encountering the line six months later or another developer doing code archaeology. The subject must let that reader understand what changed without external context.

**Reader model:**

| What Readers Have | What Readers Do Not Have |
|---|---|
| The codebase itself | PR description, review thread |
| commit body / diff | Work session context |
| Domain knowledge | Internal classification systems (P-ratings, severity labels) |
| History of other commits | Meeting notes, Slack messages |

**Validation questions** — ask yourself after writing the subject:
1. "Can readers understand what changed from this subject alone?"
2. "Do readers need access to external documents/session context to understand it?"

If 1 is NO or 2 is YES → rewrite.

**Common failure patterns** (depend on external context):

| Pattern | Why It Fails |
|---|---|
| Review classifications (`P0`/`P1`/`HIGH`/`CRITICAL`, etc.) | Readers cannot access the classification definitions |
| Workflow labels (`잔여`/`residual`/`follow-up`) | Session context is needed to know what remains |
| Process references (`리뷰`/`audit`/`라운드`) | External documents are needed to identify the review/audit |
| Vague counts (`3건`/`여러 건` alone) | What the count refers to is unclear without the body |
| Plan step numbers (`Step N`/`Step 7.6`/`Phase N`/`Round N`) | The external plan is needed to identify which plan's step N |
| Acceptance criteria IDs (`AC M1`/`H4`/`(M3)`) | AC definitions are in an external plan/spec inaccessible to readers |

These are clear to you during the work but meaningless to git log readers. Put any needed source/classification/count in the body or a trailer — describe the change itself in domain terms in the subject.

**BAD vs GOOD subjects** (real examples):

| BAD (depends on external context) | GOOD (self-contained, domain terms) |
|---|---|
| `fix: collect-jd P1 스펙 드리프트 3건 정합` | `fix: ledger filename + canonical path + Gate 5 classification 정합` |
| `refactor: SKILL.md HIGH 잔여 3섹션 cross-ref 전환` | `refactor: SKILL.md Session Lock + Atomic Write + L1/L2 cross-ref 전환` |
| `fix: 코드 리뷰 P1/P2 이슈 수정` | `fix: persistence 저장 시점을 Step 완료 단위로 변경` |
| `chore(dispenser): remove per-app husky (AC M1)` | `chore(dispenser): per-app husky 제거` |

GOOD subjects directly reveal the changed area (file/module/domain concept) without external documents.

**If subject > 50 chars:**
1. Identify the ONE core change
2. Remove unnecessary words
3. Move details to body
4. **Do NOT commit with > 50 chars**

**Body rules (when needed):**
- Blank line between subject and body
- Wrap at 72 characters
- Explain WHY, not WHAT

**Footer rules (when needed):**
- Blank line between body and footer
- `BREAKING CHANGE: description` for breaking changes
- `Fixes #123` for issue references
- `Co-authored-by: Name <email>` for pair programming

See `references/commit-conventions.md` for complete format.

### Step 6: Execute Commit

```bash
git add .
git reset HEAD plan.md 2>/dev/null || true
git reset HEAD research.md 2>/dev/null || true
git reset HEAD docs/specs/ 2>/dev/null || true

# Verify staged files
git diff --staged --name-only

# Commit
git commit -m "$(cat <<'EOF'
type: 한국어 제목 50자 이내
EOF
)"
```

### Step 7: Return Result

```markdown
## Commit Result
- **Hash**: [7-char hash]
- **Type**: [feat/fix/refactor/etc.]
- **Message**: [full commit message]
- **Files**: [count] files changed
```

---

## Branch Naming Convention

Format: `<type>/<description>` (kebab-case, English)

| Type | When to Use |
|------|-------------|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `refactor/` | Code restructuring |
| `chore/` | Build, config, tooling |
| `docs/` | Documentation only |
| `test/` | Tests only |

**Examples**: `feature/user-auth`, `fix/login-redirect`, `refactor/api-middleware`, `chore/update-deps`

**Rules**:
- All lowercase, words separated by hyphens
- Description is English, concise (2-4 words)
- No special characters except hyphens

---

## Edge Cases

**No changes**: Return "Warning: No changes to commit. Working tree is clean."

**Message too long**: NEVER just "accept" a long message. Shorten it.

**Mixed types**: Use primary type, mention secondary in body.

**User insists on violation**: Explain why you cannot comply. Offer alternatives.

**Large cohesive change (10+ files)**: Analyze by concern. One feature ≠ one commit. Split by architectural layer (config, source, test, docs) unless the change is a single atomic operation (e.g., rename).

---

## Examples

See `examples.md` for commit message examples.

---

## Common Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| Multiple features in one commit | Hard to rollback/cherry-pick | Separate by logical unit |
| Vague messages like "수정함" | Unclear what was changed and why | Describe specific changes |
| Writing commit messages in English | Project convention violation | Use Korean 명사형 종결 |
| Period at end of title | Unnecessary character | Remove period |
| Title exceeding 50 characters | Truncated in git log | Keep core message, move details to body |
| Committing plan.md | Workflow files mixed in | git reset HEAD plan.md |
| Meta-commit: "리뷰 이슈 수정" | The change is opaque; git log becomes meaningless | Describe the actual change: "저장 시점을 Step 완료 단위로 변경" |
| Opaque reference: "P1-1, P2-3 반영" | Cannot be decoded without external documents | Put references in the body/trailer and the change itself in the subject |
| Subjects depending on external context (`P1 X`, `HIGH 잔여 Y`, `리뷰 N건`) | git log readers cannot access the classification system/session context — meaning is lost | Describe the change itself in domain terms; put classification/context in the body or trailer |
| Embedding plan-step / AC IDs | git log readers cannot decode them without the plan — tokens meaningful only to the worker | Automatically check with Step 5 MANDATORY Self-Check (canonical patterns: `hooks/lib/label-patterns.sh`); put traceability in the PR description or trailer |

---

## When NOT to Use

- Uncommitted changes in unrelated files → Stash or separate commit
- No actual changes → Nothing to commit
