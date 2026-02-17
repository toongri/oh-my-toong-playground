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

**Situation**: 인증 기능 전체 구현 — 12 파일 변경 (config 2, source 5, test 3, docs 2)

10+ files → 분할 분석 결과: 4가지 concern 감지 (config / source / test / docs)

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

## Example 7: Cohesive Multi-File Change (Do NOT Split)

**Situation**: 포인트 적립 기능 구현 — 4 파일 변경이지만 하나의 논리적 변경

Changed files:
- `PointService.kt` (비즈니스 로직)
- `PointRepository.kt` (데이터 접근)
- `PointServiceTest.kt` (테스트)
- `PointController.kt` (API 엔드포인트)

3+ files → 분할 분석 결과: **분할 불필요**
- 모든 파일이 하나의 기능(포인트 적립)에 종속
- Service 없이 Controller 동작 불가, Repository 없이 Service 동작 불가
- 분할하면 중간 커밋이 빌드 실패

```
feat: 포인트 적립 기능 구현

- PointService: 적립 비즈니스 로직
- PointRepository: JPA 저장소 인터페이스
- PointController: REST 엔드포인트
- PointServiceTest: 적립 로직 단위 테스트
```

**Why NOT split?**
- 4파일이지만 독립적으로 의미 있는 분할 불가능
- 논리적 응집성 > 파일 수

## Example 8: Different Concerns in Few Files (Must Split)

**Situation**: 2 파일 변경이지만 서로 무관한 변경

Changed files:
- `AuthService.kt` — 로그인 null 체크 버그 수정 (fix)
- `UserService.kt` — 변수명 리팩토링 (refactor)

2 files → 분석 결과: **다른 change type + 다른 도메인 → 분할 필요**

**Split result:**

```
# Commit 1
fix: 로그인 시 null 사용자 예외 처리 추가

# Commit 2
refactor: UserService 변수명 및 메서드명 개선
```

**Why split?**
- 다른 change type (fix vs refactor)
- 다른 도메인 (auth vs user)
- 각각 독립적으로 revert 가능
- 파일 수는 적지만 논리적으로 무관

## Example 9: Mixed Changes Across 5 Files

**Situation**: 결제 모듈 작업 중 5 파일 변경 — 버그 수정 + 새 기능 혼합

Changed files:
- `PaymentService.kt` — 결제 금액 계산 버그 수정 (fix)
- `PaymentController.kt` — 환불 API 엔드포인트 추가 (feat)
- `RefundService.kt` — 환불 비즈니스 로직 구현 (feat)
- `PaymentServiceTest.kt` — 수정된 계산 로직 테스트 (fix 관련)
- `RefundServiceTest.kt` — 환불 로직 테스트 (feat 관련)

5 files → 분석 결과: **2가지 concern (bug fix + new feature) → 분할**

**Split result:**

```
# Commit 1: Bug fix (먼저 — 더 긴급)
fix: 결제 금액 계산 오류 수정

# Commit 2: New feature
feat: 환불 기능 구현

- RefundService 비즈니스 로직
- PaymentController 환불 엔드포인트
- 관련 테스트 추가
```

**Why split?**
- Bug fix는 즉시 배포 가능해야 함 (cherry-pick 용이)
- 새 기능은 별도 리뷰/롤백 가능해야 함
- Linux kernel: "Bug fixes must come first, then new features"
