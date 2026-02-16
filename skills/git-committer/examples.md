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

## Example 6: Atomic Commit Splitting (10+ Files)

**Situation**: 인증 기능 전체 구현 — 12 파일 변경 (config 2, source 5, test 3, docs 2)

분할 threshold: 10+ files → 5+ commits

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
- Config → Source → Test → Docs 순서 (의존성 순서)
- 각 커밋이 독립적으로 revert 가능
- `git bisect`로 문제 추적 용이
