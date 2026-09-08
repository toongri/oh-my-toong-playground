# Commit Message Examples

## Example 1: New Feature (Simple)

**Changes**: New Point.kt entity, PointType.kt enum, PointStatus.kt enum

```
feat: 포인트 도메인 엔티티 및 Enum 추가
```

## Example 2: New Feature (With Body)

**Changes**: Point entity with pessimistic lock, differs from existing Coupon pattern

```
feat: 포인트 엔티티 및 상태 전이 로직 구현

- 동시 차감이 빈번하여 비관적 락 적용 (Coupon과 다른 전략)
- 만료 상태 전이는 배치에서 처리 예정
```

## Example 3: Bug Fix

**Changes**: Fixed race condition in point deduction

```
fix: 포인트 차감 시 동시성 제어 오류 수정
```

## Example 4: Refactor

**Changes**: Extracted validation logic to separate method

```
refactor: 포인트 유효성 검증 로직 분리
```

## Example 5: Test

**Changes**: Added unit tests for Point entity

```
test: 포인트 엔티티 상태 전이 테스트 추가
```

## Example 6: Splitting by Concern (10+ Files)

**Situation**: Full authentication feature implementation — 12 files changed (config 2, source 5, test 3, docs 2)

10+ files → split analysis: 4 concerns detected (config / source / test / docs)

**Split result:**

```
# Commit 1: Config
chore: 인증 관련 Gradle 의존성 추가

# Commit 2: Core domain
feat: 인증 도메인 엔티티 및 DTO 구현

# Commit 3: Service & API layer
feat: 인증 서비스 및 컨트롤러 구현

# Commit 4: Tests
test: 인증 서비스 및 컨트롤러 테스트 추가

# Commit 5: Documentation
docs: 인증 API 문서 작성
```

**Why split?**
- Config → Source → Test → Docs order (dependency order)
- Each commit can be reverted independently
- Easy problem tracing with `git bisect`

## Example 7: Cohesive Multi-File Change (Do NOT Split)

**Situation**: Point accrual feature implementation — 4 files changed, but one logical change

Changed files:
- `PointService.kt` (business logic)
- `PointRepository.kt` (data access)
- `PointServiceTest.kt` (tests)
- `PointController.kt` (API endpoint)

3+ files → split analysis: **no split needed**
- All files depend on one feature (point accrual)
- Controller cannot work without Service; Service cannot work without Repository
- Splitting causes intermediate commits to fail the build

```
feat: 포인트 적립 기능 구현

- PointService: 적립 비즈니스 로직
- PointRepository: JPA 저장소 인터페이스
- PointController: REST 엔드포인트
- PointServiceTest: 적립 로직 단위 테스트
```

**Why NOT split?**
- Despite 4 files, no independently meaningful split is possible
- Logical cohesion > file count

## Example 8: Different Concerns in Few Files (Must Split)

**Situation**: 2 files changed, but the changes are unrelated

Changed files:
- `AuthService.kt` — fix a login null-check bug (fix)
- `UserService.kt` — refactor variable names (refactor)

2 files → analysis: **different change types + different domains → must split**

**Split result:**

```
# Commit 1
fix: 로그인 시 null 사용자 예외 처리 추가

# Commit 2
refactor: UserService 변수명 및 메서드명 개선
```

**Why split?**
- Different change types (fix vs refactor)
- Different domains (auth vs user)
- Each can be reverted independently
- Few files, but logically unrelated

## Example 9: Mixed Changes Across 5 Files

**Situation**: 5 files changed while working on the payment module — bug fix + new feature mixed

Changed files:
- `PaymentService.kt` — fix a payment amount calculation bug (fix)
- `PaymentController.kt` — add a refund API endpoint (feat)
- `RefundService.kt` — implement refund business logic (feat)
- `PaymentServiceTest.kt` — test the corrected calculation logic (related to fix)
- `RefundServiceTest.kt` — test refund logic (related to feat)

5 files → analysis: **2 concerns (bug fix + new feature) → split**

**Split result:**

```
# Commit 1: Bug fix (first — more urgent)
fix: 결제 금액 계산 오류 수정

# Commit 2: New feature
feat: 환불 기능 구현

- RefundService 비즈니스 로직
- PaymentController 환불 엔드포인트
- 관련 테스트 추가
```

**Why split?**
- The bug fix must be immediately deployable (easy cherry-pick)
- The new feature must be independently reviewable/revertible
- Linux kernel: "Bug fixes must come first, then new features"

<a id="example-10-기능적-마크다운-파일-변경--featrefactor-docs-아님"></a>
## Example 10: Functional Markdown File Changes — feat/refactor (Not docs)

**Situation**: Changing skill behavior in the oh-my-toong project

Changed files:
- `skills/git-master/SKILL.md` — add commit type classification criteria (feat)
- `agents/sisyphus-junior.md` — strengthen the no-delegation rule (refactor)

**Judgment criterion**: "If it defines system behavior, it is functionality; if it provides reference/shared information for human readers, it is documentation"
- SKILL.md is a functional file that AI reads to determine behavior → `feat`
- agents/*.md are functional files defining subagent prompts → `refactor`

**Split result:**

```
# Commit 1
feat: git-master 스킬에 기능 vs 문서 분류 기준 추가

# Commit 2
refactor: sisyphus-junior 위임 금지 규칙 강화
```

**Why NOT docs?**
- README.md, API specifications → reference information for human readers → `docs`
- SKILL.md, agents/*.md, rules/*.md → define system behavior → `feat`/`fix`/`refactor`

<a id="example-11-코드-리뷰-수정--process가-아닌-product-기술"></a>
## Example 11: Code Review Changes — Describe Product, Not Process

**Situation**: Addressing 3 code review findings — 2 files changed

Review feedback:
- P1-1: persistence saves only on Area completion, risking loss of intermediate progress
- P2-1: wrapup reference omits its applicable targets
- P2-2: PointService method naming is unclear

Changed files:
- `persistence.md` — change save timing (P1-1) + add wrapup reference content (P2-1)
- `PointService.kt` — improve method names (P2-2)

2 files → analysis: 2 files, but 3 independent changes → **must split**

| Review Item | Actual Change | Type | Independent? |
|-----------|----------|------|--------|
| P1-1 | Change saving to occur on Step completion | fix | Yes |
| P2-1 | Specify applicable targets in the wrapup reference | fix | Yes |
| P2-2 | Improve PointService method names | refactor | Yes |

**BAD (meta-commit):**

```
fix: 코드 리뷰 이슈 수정 (P1-1, P2-1~2)
```

**GOOD (product-focused, split):**

```
# Commit 1
fix: persistence 저장 시점을 Step 완료 단위로 변경

# Commit 2
fix: wrapup 레퍼런스에 적용 대상 내용 명시

# Commit 3
refactor: PointService 메서드명 개선
```

**Why split and rename?**
- Each commit can be reverted independently
- Changes are understandable from `git log` alone (no review document needed)
- P2-2 improves naming rather than fixing a bug → `refactor` (review findings are not all `fix`)
