# 렌탈 주문 상태 전이 일원화 — 변경 설명

## 목적과 핵심

렌탈 주문의 **진행 상태(`progressStatus`: 주문이 결제·활성·해지 같은 단계를 거치는 현재
상태 값)**를 바꾸는 로직이 코드 여러 곳에 흩어져 있어, 한 곳만 고치고 다른 곳을 빠뜨리는
버그가 반복됐다. 이 변경의 핵심은 모든 상태 전이가 반드시 통과하는 **단일
chokepoint(초크포인트: 모든 흐름이 거쳐 가는 하나의 병목 지점 — 여기 한 곳만 지키면 전이
규칙이 전 경로에 적용된다)**를 만든 것이다.

## 배경 — 왜 필요했나

상태를 바꾸는 코드가 하나의 함수로 모이지 않고 약 9개 호출처에 분산돼 있었다. 공통으로
거치는 건 저수준 두 개뿐이었다: 순수 DB 쓰기 `RentalOrderRepo.updateStatus`와 이력 기록
`RentalHistoryRepo.create`. 그 위의 오케스트레이션(검증 → 상태 쓰기 → 이력 → 상태와 payload의
정합성 맞추기)은 각 호출처에 복붙돼 있었다. 그 결과 실제로 두 버그가 났다:

- 결제 경로의 자체 전이 가드가 `PAYMENT_FAILED`(결제 실패) 상태를 빠뜨려, 재시도가 성공해도
  주문이 실패 상태에 갇혔다.
- admin 종료 처리가 비대칭이라, 해지됐다가 다른 상태로 되돌린 주문에 종료 사유
  (`payload.terminationReason`: 주문 부가정보 payload 안의 "왜 해지됐는지" 필드)가 잔재로
  남아 "강제 해지"로 잘못 표시됐다.

두 버그가 서로 다른 경로에서, 각각 따로 고쳐야 했다는 점이 분산 구조의 비용이었다.

## 기능 단위 — `RentalOrderStatusService.transition`

**정체성**: 렌탈 주문 상태 전이의 단일 chokepoint. 신규 서비스 클래스
`RentalOrderStatusService`의 `transition(rentalOrderId, targetStatus, opts)`.

**소속·협력**: 렌탈 도메인. 고객·결제·크론·admin 4개 주체가 모두 이 함수를 통과한다.
분산돼 있던 약 9개 호출처를 이 한 곳으로 일원화했다.

**책임(구조만)**: 한 트랜잭션(`withTransaction`) 안에서 아래를 순차 실행한다.

1. 현재 상태 조회 — 조회·검증을 트랜잭션 안에서 수행
2. `opts.validate`가 참이면 보조 상태기계(**FSM, finite state machine: 어떤 상태에서 어떤
   상태로 갈 수 있는지 정의한 전이 규칙표**)로 전이 합법성 검증
3. 상태↔payload 불변식(**invariant: 항상 참이어야 하는 조건** — 여기선 "종료 사유는 상태가
   TERMINATED일 때만 존재한다")을 자동 적용. 상태 쓰기보다 **먼저** 처리해, 검증 실패 시
   불필요한 쓰기를 피하고 반환값이 최신 payload를 담게 한다
4. `updateStatus`로 실제 상태 쓰기
5. 이력 기록
6. 갱신된 row 반환

**핵심 효과**: 불변식이 chokepoint 한 곳에 있으므로 어떤 경로로 전이가 와도 자동 적용된다.
그래서 위 "종료 사유 잔재" 같은 한쪽 누락 버그가 구조적으로 불가능해진다.

**의존 방향**: `transition`이 저수준 repo(`RentalOrderRepo`, `RentalHistoryRepo`)와 FSM
서비스를 호출한다(단방향). 호출자(고객/결제/크론/admin 서비스)가 `transition`을 호출한다.

## 경계 — chokepoint가 하지 않는 것

- **side-effect는 소유하지 않는다.** 쿠폰 발급·포인트 원복·리뷰슬롯 생성·Slack 알림 같은
  side-effect(전이에 딸린 부수 효과)는 chokepoint 밖이다. 호출자가 `transition()` 반환 후
  자기 side-effect를 멱등(**idempotent: 여러 번 실행해도 결과가 한 번 실행한 것과 같음**)하게
  실행한다. chokepoint는 구조(검증·상태·payload·이력)만 일원화한다.
- **admin은 자유 전이.** admin은 `validate: false`로 FSM 검증을 우회한다(운영상 강제 전이 필요).
  단 같은 chokepoint를 통과하므로 이력·불변식은 admin에도 동일하게 적용된다.
- **`canTransition`은 결제 서비스에 남겼다.** 월 자동결제 크론이 이미 활성인 주문을 만나면
  예외를 던지지 않고 조용히 건너뛰어야 한다. 이건 "이 상태에서 결제를 시도할지"의 전제조건이지
  전이 규칙이 아니라서 chokepoint로 옮기지 않았다.

## 주의점

- **Slack 알림은 exactly-once(정확히 한 번)를 보장하지 않는다 — 의도적이다.** Slack은 외부
  fire-and-forget 알림이라 중복은 정합성 문제가 아니라 노이즈다. 완벽한 1회 보장은
  transactional outbox가 필요한 과투자라 하지 않았다. 특히 admin의 상태변경 알림은 매 변경마다
  울리는 게 의도된 운영 가시성이다.
- **동시성(TOCTOU) 완전 차단은 후속 과제다.** `transition`은 조회·검증을 트랜잭션 안에서 하지만,
  격리수준(READ COMMITTED) 특성상 동시 요청 간 경합이 이론상 가능하다. 완전 차단은 행 잠금
  (`SELECT ... FOR UPDATE`)이 필요한데 공유 조회 메서드에 잠금을 더하면 다른 호출자에 영향이
  가서 별도 후속 과제로 뺐다. 이 리팩토링이 새로 만든 경합이 아니라 기존에도 있던 특성이다.

## 검증

동작 보존(behavior-preserving) 리팩토링이다. 기존 e2e 약 1645건을 그린으로 유지하고,
chokepoint 단위 테스트(검증 on/off, 종료 사유 양방향, 이력 생성)와 멱등성 회귀 테스트를
더해 증명했다.
