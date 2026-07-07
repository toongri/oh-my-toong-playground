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

**Product, Not Process** — 커밋 메시지는 변경 자체를 설명한다.

- 변경의 출처(코드 리뷰, 이슈 번호, 회의 결정)가 아니라 **무엇이 바뀌었는지** 기술
- 6개월 뒤 `git log`를 읽는 사람은 "리뷰 P1-3 수정"이 무슨 뜻인지 모른다
- 출처/맥락은 body나 trailer(`Fixes #123`)에 기록

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

3+ 파일 변경 시 커밋 전 반드시 자가 점검:

```
"N개 파일을 M개 커밋으로 만든다."
IF M == 1 AND N >= 3:
  → 정말 하나의 논리적 변경인가?
  → 각 파일이 함께여야 하는 이유를 한 문장으로 쓸 수 있는가?
  → 쓸 수 없으면 → SPLIT
```

**이것은 수치 공식이 아니다.** 3+ 파일이면 "생각을 거치라"는 것이지, "반드시 분할하라"는 것이 아니다. Example 7(포인트 적립 4파일 = 1커밋)처럼 논리적 응집성이 충분하면 단일 커밋이 정당하다.

#### Commit Justification (3+ Files per Commit)

하나의 커밋에 3개 이상 파일이 포함될 때, **왜 함께인지** 한 문장으로 기술해야 한다:

```
"이 커밋은 [파일들]을 포함한다. 이유: [구체적 이유]"
```

| 유효한 이유 | 무효한 이유 (→ 분할 필요) |
|------------|------------------------|
| 구현체 + 직접 테스트 파일 | "같은 기능 관련" (모호) |
| 타입 정의 + 유일한 사용처 | "같은 PR에 포함" (이유 아님) |
| 마이그레이션 + 모델 변경 (분리 시 빌드 실패) | "함께 변경됨" (이유 아님) |
| 단일 rename 작업의 여러 파일 | "관련 있어서" (모호) |

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
| Multiple independent changes (even in 1-2 files) | 리뷰 지적 3건이 각각 독립적 변경 → 3 커밋 |

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

테스트 파일은 반드시 대응하는 구현체와 **같은 커밋**에 포함한다:

| 테스트 패턴 | 구현 파일 |
|------------|----------|
| `*_test.sh` | `*.sh` |
| `*.test.ts` | `*.ts` |
| `*.spec.ts` | `*.ts` |
| `*Test.kt` | `*.kt` |
| `__tests__/*` | 대응하는 소스 |

**Anti-pattern**: 구현과 테스트를 별도 커밋으로 분리하는 것. 테스트 없는 구현 커밋은 중간 상태에서 검증 불가능하다.

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
  - **기능 vs 문서 판단**: "시스템 동작을 정의하면 기능, 인간 독자를 위한 참조/공유 정보면 문서"
  - 기능적 파일 (SKILL.md, agents/*.md, rules/*.md, hooks/*) 변경 → `feat`/`fix`/`refactor`
  - 문서 파일 (README.md, API 명세서, 가이드) 변경 → `docs`
- Build/config → `chore`
- Performance → `perf`

### Step 4: Output Commit Plan (3+ Files — BLOCKING)

3개 이상 파일 변경 시, 커밋을 실행하기 전에 반드시 커밋 계획을 출력한다:

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

**이 출력 없이 커밋 실행으로 넘어가지 않는다.** 1-2개 파일 변경은 이 단계를 건너뛴다.

> **`fix` 타입 주의**: 코드 리뷰에서 나온 변경이 전부 `fix`는 아니다. 리뷰 지적이라도 새 기능이면 `feat`, 구조 개선이면 `refactor`. 실제 버그/오류 수정만 `fix`.

### Step 5: Generate Commit Message

#### MANDATORY Self-Check (제목 초안 작성 직후)

제목을 쓴 직후, 커밋 실행 전 반드시 invented/opaque label 여부를 자가 검사한다. **하나라도 매칭되면 rewrite 후 재검사.** 이 검사가 지키는 표준은 `communication-style` 룰(`rules/communication-style.md`)의 anti-pattern 1(Invented/opaque label ban)이며, 판정 정규식의 canonical source는 `hooks/lib/label-patterns.sh`다 — git-master는 자체 사본을 두지 않는다.

**왜 강제인가**: 작업자 본인은 plan 문서를 보고 있으니 plan 단계 번호나 AC ID가 명확하지만, git log 독자는 그 plan에 접근 불가 — 과거 실제 위반을 history rewrite로 교정해야 했던 사례가 있다.

**위반 패턴 발견 시 변환:**
- 토큰 단순 제거: `(Step 12)` → 삭제 (제목이 도메인 용어로 이미 자족적인 경우)
- 토큰 → 도메인 용어로 치환: `align RN tooling lockstep with mobile (Step 4)` → `RN tooling mobile에 정렬`
- 추적성이 정말 필요하면 body의 trailer로 이동: `Refs: dispenser-monorepo-absorption.md#step-12`

**Subject rules (NON-NEGOTIABLE):**
- Korean (한국어)
- **Max 50 characters** ← ENFORCED, not a guideline
- 명사형 종결 (e.g., "추가", "수정", "삭제", "구현", "개선")
- No period at end

**Subject content rule:**

제목의 독자는 미래의 git log 독자다 — 6개월 뒤 또는 다른 개발자가 코드 archaeology 중에 만나는 줄. 제목은 그 독자가 외부 맥락 없이 무엇이 바뀌었는지 이해할 수 있어야 한다.

**독자 모델:**

| 독자가 가진 것 | 독자가 갖지 못한 것 |
|---|---|
| 코드베이스 자체 | PR description, review thread |
| commit body / diff | 작업 세션의 맥락 |
| 도메인 지식 | 내부 분류 체계 (P-등급, 심각도 라벨) |
| 다른 commit들의 history | 회의록, Slack 메시지 |

**검증 질문** — 제목을 쓴 후 자문:
1. "독자가 이 제목만 보고 무엇이 바뀌었는지 이해하는가?"
2. "독자가 외부 문서/세션 맥락에 접근해야만 의미를 알 수 있는가?"

1번이 NO 또는 2번이 YES면 → rewrite.

**자주 실패하는 패턴** (외부 맥락에 의존):

| 패턴 | 왜 실패하는가 |
|---|---|
| 리뷰 분류 (`P0`/`P1`/`HIGH`/`CRITICAL` 등) | 독자는 그 분류 체계의 정의에 접근 불가 |
| 워크플로우 라벨 (`잔여`/`residual`/`follow-up`) | 무엇의 잔여인지 세션 맥락 필요 |
| 프로세스 참조 (`리뷰`/`audit`/`라운드`) | 어떤 리뷰/audit인지 외부 문서 필요 |
| 모호한 카운트 (`3건`/`여러 건` 단독) | 무엇이 3건인지 본문 없이 불명 |
| Plan 단계 번호 (`Step N`/`Step 7.6`/`Phase N`/`Round N`) | 어떤 plan의 N단계인지 외부 plan 문서 필요 |
| Acceptance criteria ID (`AC M1`/`H4`/`(M3)`) | AC 정의가 plan/spec 외부에 있어 독자 접근 불가 |

이들은 작업 중인 본인에게는 명확하지만 git log 독자에게는 의미 없다. 출처/분류/카운트가 필요하면 body 또는 trailer로 — 제목은 변경 자체를 도메인 용어로 기술.

**BAD vs GOOD subjects** (실제 사례):

| BAD (외부 맥락 의존) | GOOD (자족적, 도메인 용어) |
|---|---|
| `fix: collect-jd P1 스펙 드리프트 3건 정합` | `fix: ledger filename + canonical path + Gate 5 classification 정합` |
| `refactor: SKILL.md HIGH 잔여 3섹션 cross-ref 전환` | `refactor: SKILL.md Session Lock + Atomic Write + L1/L2 cross-ref 전환` |
| `fix: 코드 리뷰 P1/P2 이슈 수정` | `fix: persistence 저장 시점을 Step 완료 단위로 변경` |
| `chore(dispenser): remove per-app husky (AC M1)` | `chore(dispenser): per-app husky 제거` |

GOOD 제목들은 외부 문서 없이도 변경 영역(파일/모듈/도메인 개념)이 직접 보인다.

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
| Meta-commit: "리뷰 이슈 수정" | 변경 내용이 불투명, git log 무의미 | 실제 변경 기술: "저장 시점을 Step 완료 단위로 변경" |
| Opaque reference: "P1-1, P2-3 반영" | 외부 문서 없이 해독 불가 | 참조는 body/trailer, 제목은 변경 자체 |
| 외부 맥락에 의존하는 제목 (`P1 X`, `HIGH 잔여 Y`, `리뷰 N건`) | git log 독자는 분류 체계/세션 맥락에 접근 불가 — 의미 전달 실패 | 도메인 용어로 변경 자체를 기술; 분류/맥락은 body·trailer로 |
| Plan-step / AC ID 박기 | plan 문서 없으면 git log 독자 해독 불가 — 작업자 본인 외에 의미 없는 토큰 | Step 5 MANDATORY Self-Check로 자동 검사(canonical 패턴: `hooks/lib/label-patterns.sh`); 추적은 PR description 또는 trailer로 |

---

## When NOT to Use

- Uncommitted changes in unrelated files → Stash or separate commit
- No actual changes → Nothing to commit
