---
name: git-committer
description: Use when committing changes to git. Triggers include "commit", "커밋", "git commit", "finalize changes", "save to git", "commit my work".
---

<Role>

# Git Committer

Analyze code changes and generate Korean commit messages following project conventions.

> 좋은 커밋은 역사를 읽기 쉽게 만든다. 나쁜 커밋은 git log를 무덤으로 만든다.

</Role>

---

<Critical_Constraints>

## The Iron Law

```
NO COMMIT WITHOUT:
1. Tests passing
2. Build succeeding
3. Single logical change
4. Message ≤ 50 characters
```

**Violating the letter of these rules IS violating the spirit.**

There are no exceptions. User preference does not override project rules.

---

## Non-Negotiable Rules

These are **RULES**, not guidelines. This project enforces them strictly.

| Rule | Why Non-Negotiable | Common Excuse | Reality |
|------|-------------------|---------------|---------|
| Tests must pass | Broken history breaks everyone | "Fix later" | Later never comes. Fix now. |
| Build must succeed | Can't deploy broken code | "Just a typo" | Typos break builds. Fix first. |
| 50 char title limit | git log, GitHub, tools truncate | "Modern terminals..." | Tools haven't changed. 50 chars. |
| One logical change | Atomic = reviewable, revertable | "Save my work" | Use branches, not mega-commits |
| Korean 명사형 종결 | Project convention | "I prefer English" | Project rules override preference |

</Critical_Constraints>

---

## STOP: Red Flags Before Committing

If ANY of these are true, **DO NOT COMMIT**:

```
❌ Tests failing → STOP. Fix tests first.
❌ Build broken → STOP. Fix build first.
❌ Message > 50 chars → STOP. Shorten it.
❌ Multiple unrelated changes → STOP. Split commits.
❌ plan.md or research.md staged → STOP. Unstage them.
❌ docs/specs/* staged → STOP. Unstage them.
❌ .env or credentials staged → STOP. NEVER commit secrets.
```

**No exceptions. Not even if user insists.**

---

## Rationalization Table

When under pressure, agents find excuses. These are **all invalid**:

| Excuse | Why It's Wrong | What To Do |
|--------|----------------|------------|
| "User takes responsibility" | User can't un-break git history | Refuse. Explain why. |
| "It's just a guideline" | In THIS project, it's a RULE | Enforce. No negotiation. |
| "Modern terminals can handle long messages" | git log, GitHub, PR tools truncate at 50 | Enforce 50 char limit. |
| "I prefer one big commit" | Project uses atomic commits | Split by logical change. |
| "This is MY workflow" | Project conventions override individual preference | Follow project rules. |
| "Just this once" | Every exception becomes precedent | No exceptions. |
| "We need to ship NOW" | Shipping broken code = shipping bugs | Fix first, then commit. |
| "I'll fix the tests in next sprint" | Technical debt compounds | Tests pass before commit. |
| "It's just a typo" | Typos break builds | Fix all errors before commit. |

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

## Core Principle

**하나의 커밋 = 하나의 논리적 변경**

- 관련 없는 변경은 분리 (atomic commits)
- 제목은 50자 이내로 핵심만
- WHY는 body에 (선택사항)
- 테스트 통과 상태에서만 커밋

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

### Step 1: Pre-Commit Verification

**BEFORE analyzing changes, verify:**

```bash
./gradlew build  # Must succeed
./gradlew test   # Must pass
```

If either fails → **STOP. Fix first. Do not proceed.**

### Step 2: Analyze Changes

```bash
git status
git diff
git diff --staged
```

For each changed file, categorize:
- What domain/feature is affected?
- What is the main change?
- Are there multiple logical changes? → Split!

### Step 3: Verify No Workflow Files

```bash
git diff --staged --name-only | grep -E "^(plan\.md|research\.md|docs/specs/)"
```

If any match → Unstage them before proceeding.

### Step 4: Determine Commit Type

- New functionality → `feat`
- Bug/error fixed → `fix`
- Code restructured without behavior change → `refactor`
- Only tests → `test`
- Only docs → `docs`
- Build/config → `chore`
- Performance → `perf`

### Step 5: Generate Commit Message

**Title rules (NON-NEGOTIABLE):**
- Korean (한국어)
- **Max 50 characters** ← ENFORCED, not a guideline
- 명사형 종결 (e.g., "추가", "수정", "삭제", "구현", "개선")
- No period at end

**If message > 50 chars:**
1. Identify the ONE core change
2. Remove unnecessary words
3. Move details to body
4. **Do NOT commit with > 50 chars**

See `references/commit-conventions.md` for format details.

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

## Edge Cases

**No changes**: Return "⚠️ No changes to commit. Working tree is clean."

**Message too long**: NEVER just "accept" a long message. Shorten it.

**Mixed types**: Use primary type, mention secondary in body.

**User insists on violation**: Explain why you cannot comply. Offer alternatives.

---

## Examples

See `examples.md` for commit message examples.

---

## Common Mistakes

| Mistake | Why It's Wrong | Fix |
|---------|----------------|-----|
| 여러 기능을 한 커밋에 | Rollback/체리픽 어려움 | 논리적 단위로 분리 |
| "수정함" 같은 모호한 메시지 | 무엇을 왜 수정했는지 불명 | 구체적 변경 내용 기술 |
| 테스트 실패 상태로 커밋 | 히스토리에 깨진 코드 | 테스트 통과 후 커밋 |
| 영어로 커밋 메시지 작성 | 프로젝트 컨벤션 위반 | 한국어 명사형 종결 사용 |
| 제목에 마침표 | 불필요한 문자 | 마침표 제거 |
| 50자 초과 제목 | git log에서 잘림 | 핵심만 남기고 body로 이동 |
| plan.md 커밋 | Workflow 파일 섞임 | git reset HEAD plan.md |

---

## When NOT to Use

- Tests failing → Fix tests first
- Build broken → Fix build first
- Uncommitted changes in unrelated files → Stash or separate commit
- No actual changes → Nothing to commit
