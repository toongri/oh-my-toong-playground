# 원본(SSOT) — 렌탈 주문 상태 전이 일원화 (algocare-home PR #1592 기반)

이 파일은 발표 리뷰어 검증용 원본 번들이다. 실제 병합된 PR #1592
(`refactor/rental-status-transition-unification`)의 설계 문서와 최종 구현 코드에서
사실만 발췌했다. 발표(presentation)를 이 원본과 대조해 거짓·이격·설명 누락을 잡는다.

## 문제

렌탈 주문의 `progressStatus`(주문 진행 상태)를 바꾸는 코드가 하나의 함수로 모이지
않고 약 9개 호출처에 분산돼 있었다. 공통으로 통과하는 것은 저수준 primitive 2개
(`RentalOrderRepo.updateStatus` 순수 DB 쓰기, `RentalHistoryRepo.create` 이력)뿐이고,
전이 오케스트레이션(검증 → updateStatus → 이력 → 상태↔payload 불변식)이 각 호출처에
복붙돼 있었다. 그래서 "한 곳을 고치고 다른 곳을 빠뜨리는" 버그가 실제로 2건 났다:

- 버그 1: 결제 경로의 자체 `canTransition` 가드가 `PAYMENT_FAILED`를 빠뜨려, 재시도
  성공해도 주문이 `PAYMENT_FAILED`에 갇힘.
- 버그 2: admin `changeStatus`의 자체 종료 처리가 비대칭이라, `TERMINATED → 다른 상태`
  복귀 시 `payload.terminationReason` 잔재가 남아 "강제 해지"로 오표시.

## 핵심 해결 — 단일 chokepoint

신규 서비스 `RentalOrderStatusService.transition(rentalOrderId, targetStatus, opts)`을
도입해, 4개 주체(고객 / 결제 / 크론 / admin)의 모든 상태 전이가 이 한 함수를 통과하게
했다. 분산돼 있던 약 9개 호출처를 이 chokepoint로 일원화했다.

`opts`: `actor`(이력 changedBy), `validate`(boolean), `reason?`, `terminationReason?`.

한 `withTransaction` 안에서 **구조만** 소유하며, 실제 코드 실행 순서는:

1. 현재 상태 조회 (`getByIdWithDeleted`) — 조회·검증을 트랜잭션 안에서 수행
2. `opts.validate === true`면 `RentalStateMachineService.assertProgressTransition(current, target)`
3. **상태↔payload 불변식 자동 적용** — `updateStatus`보다 **먼저** 처리한다
   (검증 실패 시 불필요한 상태 쓰기 회피 + 반환 row가 최신 payload를 담게):
   - `target === TERMINATED` → `terminationReason` 누락이면 `RentalTerminationReasonRequiredError` throw, 아니면 `updatePayloadTerminationReason`
   - `target !== TERMINATED` && 기존 payload에 `terminationReason` 존재 → `removePayloadKey`
4. `RentalOrderRepo.updateStatus(id, { progressStatus: target })`
5. `RentalHistoryRepo.create(...)` — 이력 기록
6. 갱신된 row 반환

불변식(`payload.terminationReason`는 `progressStatus === TERMINATED`일 때만 존재)이
chokepoint에 있으므로 어떤 경로로 전이가 와도 자동 적용된다 → 버그 2 같은 한쪽 누락이
구조적으로 불가능.

## 명시적 계약·경계

- **side-effect는 chokepoint가 소유하지 않는다.** 쿠폰 발급·포인트 원복·리뷰슬롯 생성·Slack
  알림 같은 side-effect는 chokepoint 밖이며, 호출자가 `transition()` 반환 후 자기 멱등
  side-effect를 실행한다. chokepoint는 구조(검증·상태·payload·이력)만 일원화한다.
- **admin은 `validate: false`(자유 전이, FSM 우회).** 고객·결제·크론은 `validate: true`.
  admin도 같은 chokepoint를 통과하므로 이력·불변식은 동일하게 적용받는다.
- **`canTransition`은 결제 서비스에 남긴다.** 월 자동결제 크론이 이미 활성 주문을 만나면
  throw가 아니라 조용히 skip해야 하므로, 이건 "결제를 시도할지"의 전제조건이지 전이 규칙이
  아니다. chokepoint의 `validate=true`는 실제 전이 시도에 대한 throw 가드.

## 멱등성 (1급 산출물, 그러나 chokepoint 밖)

전이에 매달린 돈/데이터 side-effect는 대부분 이미 멱등이며, 이번 PR은 그 멱등성을 회귀
테스트로 고정했다(코드 쿠폰 발급·프로모션/REFERRAL 포인트 원복·리뷰슬롯). 프로모션 포인트
원복의 잔액부족 엣지에 status 재확인 가드를 보강.

## 의도적 비목표 (해결 안 함)

- **Slack 알림 exactly-once는 추구하지 않는다.** Slack은 외부 fire-and-forget 알림이라
  중복은 정합성 문제가 아니라 노이즈다. exactly-once는 transactional outbox가 필요한
  과투자(YAGNI). `notifyStatusChange`는 admin 매 변경마다 알리는 게 의도된 동작이라 손대지 않음.
- **chokepoint TOCTOU 완전 직렬화는 후속 과제.** `transition`은 조회·검증을 트랜잭션 안에서
  하지만 READ COMMITTED 하에선 동시 요청 간 race가 이론상 가능. 완전 차단은 `SELECT ... FOR
  UPDATE` 행 잠금이 필요한데 공유 메서드에 잠금을 더하면 다른 호출자에 영향 → 별도 후속 과제.
  이 리팩토링이 신규 도입한 race가 아니라 기존 코드에도 있던 특성이다.
- `mergePayload`의 범용 read-modify-write lost-update, Python 이지어드민 어댑터 경로, side-effect의
  비즈니스 로직 변경은 범위 밖.

## 테스트 전략 / 검증

- **chokepoint 단위 테스트**: `validate` on/off(합법·불법·강제 전이), `terminationReason`
  기록/제거 양방향, 이력 생성.
- **멱등성 회귀 테스트**: 코드 쿠폰 발급·프로모션/REFERRAL 포인트 원복·리뷰슬롯의 반복 전이 시나리오.
- **동작 보존**: behavior-preserving 리팩토링. 기존 e2e(약 1645건) 그린 유지로 동작 보존을
  증명한다. PR 1개.
