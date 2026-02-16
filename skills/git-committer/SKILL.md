---
name: git-committer
description: Use when committing changes to git. Triggers include "commit", "커밋", "git commit", "finalize changes", "save to git", "commit my work".
---

<Role>

# Git Committer

Analyze code changes and generate Korean commit messages following project conventions.

> "A good commit makes history easy to read. A bad commit turns git log into a graveyard."

</Role>

---

<Critical_Constraints>

## The Iron Law

```
NO COMMIT WITHOUT:
1. Single logical change (or properly split)
2. Message ≤ 50 characters
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
- 3+ files changed → check split threshold (see Atomic Commit Splitting)

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

**When staged files exceed thresholds, split into multiple commits:**

| Changed Files | Minimum Commits |
|---------------|-----------------|
| 3+ files | 2+ commits |
| 5+ files | 3+ commits |
| 10+ files | 5+ commits |

**Concern-Based Split Criteria:**

| Signal | Action |
|--------|--------|
| Different directories/modules | SPLIT |
| Different component types (config / source / test / docs) | SPLIT |
| Independently revertable | SPLIT |

**Grouping Strategy (commit in this order):**

1. **Config files** -- settings, build config, dependencies
2. **Source/Logic files** -- business logic, application code
3. **Test files** -- unit tests, integration tests
4. **Documentation** -- README, docs, comments

Commit in **dependency order**: what is depended on gets committed first.

**Splitting Workflow:**

```
Staged files → Count check against threshold
  → Below threshold? → Single commit
  → Above threshold? → Group by concern → Sequential commits in dependency order
```

Each split commit must:
- Be independently meaningful (not "part 1 of 3")
- Have its own proper commit message
- Be revertable without breaking other commits

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
- Build/config → `chore`
- Performance → `perf`

### Step 4: Generate Commit Message

**Subject rules (NON-NEGOTIABLE):**
- Korean (한국어)
- **Max 50 characters** ← ENFORCED, not a guideline
- 명사형 종결 (e.g., "추가", "수정", "삭제", "구현", "개선")
- No period at end

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

### Step 5: Execute Commit

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

### Step 6: Return Result

```markdown
## Commit Result
- **Hash**: [7-char hash]
- **Type**: [feat/fix/refactor/etc.]
- **Message**: [full commit message]
- **Files**: [count] files changed
```

---

## Edge Cases

**No changes**: Return "Warning: No changes to commit. Working tree is clean."

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
| Multiple features in one commit | Hard to rollback/cherry-pick | Separate by logical unit |
| Vague messages like "수정함" | Unclear what was changed and why | Describe specific changes |
| Writing commit messages in English | Project convention violation | Use Korean 명사형 종결 |
| Period at end of title | Unnecessary character | Remove period |
| Title exceeding 50 characters | Truncated in git log | Keep core message, move details to body |
| Committing plan.md | Workflow files mixed in | git reset HEAD plan.md |

---

## When NOT to Use

- Uncommitted changes in unrelated files → Stash or separate commit
- No actual changes → Nothing to commit
