# Metis Agent - Application Test Scenarios

## Purpose

These scenarios validate the metis agent's pre-planning analysis quality without external agent dependencies.

## Coverage Map

| # | Scenario | Primary Technique | Validation Focus |
|---|----------|-------------------|------------------|
| M-1 | Intent Classification | Phase 0 classification | Correct intent type + rationale |
| M-2 | Scope and Guardrails | Analysis framework | In-scope/out-of-scope clarity |
| M-3 | Verifiability Gate | Verdict criteria | Unverifiable AC => REQUEST_CHANGES |
| M-4 | AC Quality Check | Analysis guards | Observable outcomes + concrete verification |
| M-5 | QA Directives | Executable-only QA | Check/Command/Expected/Failure completeness |
| M-6 | Evidence Discipline | Evidence protocol | Unknown + Verification Plan when evidence missing |
| M-7 | Negative Control (all axes clean) | B1-B4 whitelist | Clean brief with all axes satisfied => APPROVE |
| M-8 | Axis-Isolated Control (B1) | B1-B4 whitelist | Missing/untraceable requirement => RC citing B1 only |
| M-9 | Axis-Isolated Control (B2) | B1-B4 whitelist | Absent scope boundary => RC citing B2 only |
| M-10 | Axis-Isolated Control (B3) | B1-B4 whitelist | Unobservable AC end-state => RC citing B3 only |
| M-11 | Axis-Isolated Control (B4) | B1-B4 whitelist | Unflagged load-bearing assumption => RC citing B4 only (RED-at-HEAD control) |
| M-12 | Convergence Regression | Batch/Ambiguity demotion | 56-AC-style batch brief => 0 blocking on demoted axes |
| M-13 | Carried-Forward Deadlock | Option-B orchestrator-owned terminal | K=3 same-item RC => prometheus records residual + proceeds (metis stays RC, round-unaware) |
| M-14 | S1→S4 Relocation | COMMENT-carry + plan operationalization | Batch COMMENT => per-TODO AC => momus S4 bounded convergence |

---

## Scenario M-1: Intent Classification

**Prompt:**
```
다음 요구사항 초안을 검토해줘:
- 기존 유저 검색 API 응답이 느려서 리팩토링 필요
- 동작은 바뀌면 안 됨
```

**Expected:**
- Type = `Refactoring`
- Classification rationale included
- Behavior-preservation questions included

---

## Scenario M-2: Scope and Guardrails

**Prompt:**
```
다음 계획을 검토해줘:
- 상품 검색 필터 추가
- 기존 추천 시스템도 같이 개선
```

**Expected:**
- Scope risk identified (scope inflation)
- Explicit in/out scope clarification requested
- Guardrails are actionable

---

## Scenario M-3: Verifiability Gate

**Prompt:**
```
인수조건:
1) 검색이 잘 된다
2) 사용자 경험이 좋아진다
```

**Expected:**
- Vague ACs flagged as unverifiable
- Concrete rewrites proposed
- Verdict = `REQUEST_CHANGES`

---

## Scenario M-4: AC Quality Check

**Prompt:**
```
인수조건:
1) search.ts 파일에 함수 3개 추가
2) 기존 테스트 통과
```

**Expected:**
- File-listing AC rejected
- Generic verification rejected
- Rewritten ACs describe post-state + concrete verification

---

## Scenario M-5: QA Directives (Executable Only)

**Prompt:**
```
계획 검토 결과와 QA 지시를 같이 작성해줘.
```

**Expected:**
- `QA Directives (Executable Only)` section exists
- Each item includes all fields:
  - Check
  - Command/Assertion
  - Expected Result
  - Failure Signal
- No manual-only wording (`user confirms`, `looks good`, `manual check`)

---

## Scenario M-6: Evidence Discipline

**Prompt:**
```
아키텍처 개선 제안안을 검토해줘. 현재 코드 근거는 제공하지 않음.
```

**Expected:**
- Assumptions explicitly marked
- `Unknown + Verification Plan` used for missing evidence
- No fabricated codebase facts

---

## Scenario M-7: Negative Control (All Axes Clean)

**Prompt:**
```
다음 요구사항 브리프를 검토해줘:

요구사항: 사용자 프로필 페이지에 "마지막 로그인 시각" 필드를 추가한다. 값은 users 테이블의
기존 last_login_at 컬럼(스키마 확인됨: schema.sql:42, NOT NULL 제약이며 가입 시 DEFAULT로
가입시각(created_at)이 채워지고 이후 매 로그인마다 갱신됨 — 모든 사용자가 값을 가짐)에서
읽어와, API 응답에는 ISO 8601 형식(초 단위 정밀도, `Z` 오프셋 고정 — 예:
"2026-07-15T09:00:00Z")으로 노출하고, UI에는 KST(UTC+9) 로컬 포맷 "YYYY-MM-DD HH:mm"으로
렌더링한다.

Scope:
- In-scope: GET /api/users/:id 응답에 lastLoginAt 필드(ISO 8601, 초 단위, `Z` 오프셋)
  추가, 프로필 페이지 UI에 KST 로컬 포맷 렌더링 추가
- Out-of-scope: last_login_at 값을 갱신하는 로직(로그인 시각 기록)은 이번 작업에서 변경하지
  않음.

픽스처: users.id=1 레코드가 last_login_at = '2026-07-15T09:00:00Z'로 시드되어 있다
(http://localhost:3000 기준).

인수조건:
1) `curl -s http://localhost:3000/api/users/1 | jq -e '.lastLoginAt == "2026-07-15T09:00:00Z"'`
   exit 0
2) agent-browser로 http://localhost:3000/users/1 진입 후 페이지 텍스트에
   "마지막 로그인 시각: 2026-07-15 18:00" 문자열이 존재한다(레이블만이 아니라 KST로 변환된
   렌더값 자체를 확인)

가정: users.last_login_at 컬럼은 이미 존재하며 매 로그인마다 갱신됨 — schema.sql:42와
auth/login.ts:88(로그인 성공 시 UPDATE 쿼리)에서 검증됨.
```

**Expected:**
- B1 (requirements traceability): 단일 요구사항이 AC 1·2 모두로 추적 가능 — 위반 없음
- B2 (scope-boundary absence): in/out scope 명시적이고 NOT NULL+DEFAULT로 데이터 형태가
  정합 — 위반 없음
- B3 (AC principled-unverifiability): AC 1은 base URL 포함 `curl|jq -e`로 값 자체를 결정적
  자산, AC 2는 정적 레이블이 아니라 KST로 변환된 렌더값 문자열을 자산 — ISO 정밀도/로컬
  포맷 계약이 요구사항에 못박혀 있어 모호성 없음 — 위반 없음
- B4 (unvalidated + unflagged load-bearing assumption): 가정이 명시되고 file:line로
  검증됨(unflagged 아님) — 위반 없음
- Verdict = `APPROVE` (또는 비차단 advisory만 남는 경우 `COMMENT` — soft pass); **핵심 기준: Blocking = None (REQUEST_CHANGES 아님)**. negative control은 clean 브리프가 차단되지 않음을 증명하는 것이 목적이므로, APPROVE 또는 no-blocking COMMENT 모두 통과다.

---

## Scenario M-8: Axis-Isolated Control — B1 (Requirements Traceability)

**Prompt:**
```
다음 요구사항 브리프를 검토해줘:

요구사항:
1) 주문 목록 페이지(GET /api/orders)의 응답에 "주문일자"(orderedAt) 필드를 추가한다.
2) 주문 목록을 주문일자(orderedAt) 내림차순으로 정렬하여 반환한다.

Scope:
- In-scope: GET /api/orders 응답 필드 및 정렬 로직(orders/list.ts)
- Out-of-scope: 주문 생성/수정 로직은 변경하지 않음

가정 없음.

인수조건:
1) `curl -s http://localhost:3000/api/orders | jq -e '.items[0] | has("orderedAt")'`
   exit 0 (주문일자 필드 존재 확인)
```

**Expected:**
- B1 (requirements traceability): 요구사항 2("주문일자 내림차순 정렬")를 검증하는 AC가
  전혀 없음 — 추적 불가 → **위반**
- B2 (scope-boundary absence): 요구사항 1·2 모두 명백히 in-scope(orders/list.ts)이고
  out-of-scope와 모순 없음 — 위반 없음
- B3 (AC principled-unverifiability): 존재하는 AC 1은 base URL 포함 `curl|jq -e`로
  결정적 — 위반 없음
- B4 (unvalidated + unflagged load-bearing assumption): 가정 없음 — 위반 없음
- Verdict = `REQUEST_CHANGES` citing **B1 only**, cross-axis false positive 없음

---

## Scenario M-9: Axis-Isolated Control — B2 (Scope-Boundary Absence)

**Prompt:**
```
다음 요구사항 브리프를 검토해줘:

요구사항: 상품 목록 페이지의 정렬 옵션에 "리뷰 많은순"을 추가한다. 정렬 기준은
review_count 내림차순이며, 동점 시 2차 정렬 키는 상품 id 오름차순, review_count가 null인
상품은 정렬 결과의 맨 뒤에 위치한다. 관련해서 추천 알고리즘 쪽도 여유 되면 같이 손보면
좋을 것 같다.

인수조건:
1) `curl -s 'http://localhost:3000/products?sort=review_count' | jq -e '[.items[] |
   {r: (.reviewCount // -1), id}] as $a | $a == ($a | sort_by(.id) | sort_by(-.r))'`
   exit 0 (review_count 내림차순, 동점 시 id 오름차순, null은 맨 뒤 확인)

가정 없음.
```

**Expected:**
- B1 (requirements traceability): 단일 명시 요구사항(정렬 옵션 추가)이 AC 1로 추적
  가능 — 위반 없음
- B2 (scope-boundary absence): "추천 알고리즘도 여유 되면 같이"는 in/out scope 경계가
  전혀 명시되지 않은 scope inflation 위험 → **위반**
- B3 (AC principled-unverifiability): AC 1은 base URL 포함 `curl|jq -e`로 결정적이고,
  tie-break·null 처리가 요구사항에 명시되어 모호성 없음 — 위반 없음
- B4 (unvalidated + unflagged load-bearing assumption): 가정 없음 — 위반 없음
- Verdict = `REQUEST_CHANGES` citing **B2 only**, cross-axis false positive 없음

---

## Scenario M-10: Axis-Isolated Control — B3 (AC Principled-Unverifiability)

**Prompt:**
```
다음 요구사항 브리프를 검토해줘:

요구사항: 상품 상세 페이지에 "재입고 알림 신청" 버튼을 추가한다. 버튼 클릭 시
POST /api/restock-alerts 호출로 알림 신청이 등록된다.

Scope:
- In-scope: 상품 상세 페이지 UI에 버튼 추가, POST /api/restock-alerts 엔드포인트 신설
- Out-of-scope: 실제 재입고 발생 시 알림 발송 로직(이메일/푸시)은 이번 작업에서 변경하지
  않음

가정 없음.

인수조건:
1) `curl -s -X POST http://localhost:3000/api/restock-alerts -H 'Content-Type:
   application/json' -d '{"productId":1,"userId":1}' | jq -e '.status == "registered"'`
   exit 0
2) agent-browser로 상품 상세 페이지 진입 후 셀렉터 [data-testid="restock-alert-button"]
   또는 텍스트 "재입고 알림 신청"이 존재한다.
3) 재입고 알림 신청 완료 후 표시되는 확인 피드백이 사용자에게 직관적으로 느껴진다.
```

**Expected:**
- B1 (requirements traceability): 버튼(AC 2)과 엔드포인트(AC 1) 모두 요구사항으로부터
  추적 가능 — 위반 없음
- B2 (scope-boundary absence): in/out scope 명시적 — 위반 없음
- B3 (AC principled-unverifiability): AC 3 "확인 피드백이 사용자에게 직관적으로 느껴진다"는
  observable end-state가 없고 구체 검증 명령도 없음(주관적 완료 표현) → **위반**
  (AC 1은 결정적 `curl|jq`, AC 2는 관측 가능한 셀렉터/텍스트 존재 확인이라 둘 다 clean)
- B4 (unvalidated + unflagged load-bearing assumption): 가정 없음 — 위반 없음
- Verdict = `REQUEST_CHANGES` citing **B3 only**, cross-axis false positive 없음

---

## Scenario M-11: Axis-Isolated Control — B4 (Unvalidated + Unflagged Load-Bearing Assumption)

**Prompt:**
```
다음 요구사항 브리프를 검토해줘:

요구사항: 알림 발송 배치잡의 실행 주기를 매시간에서 5분마다로 변경한다.

Scope:
- In-scope: 배치잡 스케줄 설정(notifier/cron.yaml)만 변경
- Out-of-scope: 알림 발송 로직(notifier/send.ts) 자체는 변경하지 않음

인수조건:
1) `grep -qE 'schedule:\s*"?\*/5 \* \* \* \*"?' notifier/cron.yaml` exit 0
2) `! grep -qE 'schedule:\s*"?0 \* \* \* \*"?' notifier/cron.yaml` exit 0 (옛 매시간
   스케줄이 남아있지 않음을 확인)
```

**Expected:**
- B1 (requirements traceability): 단일 요구사항("매시간 → 5분 변경")이 AC 1(신규 스케줄
  존재)·AC 2(옛 스케줄 제거)로 추적 가능 — 위반 없음
- B2 (scope-boundary absence): in/out scope 명시적(config only) — 위반 없음
- B3 (AC principled-unverifiability): AC 1·AC 2 모두 단일 결정적 `grep` config 검증 —
  위반 없음
- B4 (unvalidated + unflagged load-bearing assumption): 실행 주기를 12배로 늘리는 설계는
  "기존 알림 발송 로직이 idempotent하여 반복 실행해도 중복 알림이 발생하지 않는다"는
  가정에 의존하지만, 이 가정은 브리프 어디에도 명시(flag)되지 않았고 검증되지도 않음
  → **위반**
- Verdict = `REQUEST_CHANGES` citing **B4 only**, cross-axis false positive 없음
- (RED-at-HEAD 컨트롤: 현재 HEAD metis가 이 브리프를 반드시 block해야 genuine control로
  성립함 — 빈 껍데기 브리프 금지)

---

## Scenario M-12: Convergence Regression (Batch/Ambiguity Demotion)

**Prompt:**
```
다음 요구사항 브리프를 검토해줘:

요구사항: 다음 10개 파일에서 "중복 결제 방지" 에러 메시지 포맷을 통일한다. 모든 파일에서
에러 메시지를 "이미 처리된 결제입니다" 리터럴 문자열로 맞춘다(가변 토큰 없음):
- payment/charge.ts
- payment/refund.ts
- payment/retry.ts
- payment/gateway-adapter.ts
- tracking/order-status.ts
- tracking/shipment.ts
- tracking/webhook.ts
- double-charge/detector.ts
- double-charge/resolver.ts
- double-charge/notifier.ts

Scope:
- In-scope: 위 10개 파일의 에러 메시지 문자열만 수정
- Out-of-scope: 에러 발생 조건/로직 자체는 변경하지 않음

가정 없음.

인수조건:
1) 대상 10개 파일 전체에서 에러 메시지가 "이미 처리된 결제입니다"로 통일되었다
   (`grep -l '이미 처리된 결제입니다' payment/charge.ts payment/refund.ts
   payment/retry.ts payment/gateway-adapter.ts tracking/order-status.ts
   tracking/shipment.ts tracking/webhook.ts double-charge/detector.ts
   double-charge/resolver.ts double-charge/notifier.ts | wc -l` → 10 — aggregate 카운트,
   파일별 개별 확인 문구 없음)
```

**Expected:**
- B1 (requirements traceability): 단일 요구사항이 AC 1로 추적 가능 — 위반 없음
- B2 (scope-boundary absence): in/out scope 명시적 — 위반 없음
- B3 (AC principled-unverifiability): AC 1은 `grep|wc -l` 결정적 명령이며 메시지가 완전
  리터럴(가변 토큰 없음)이라 모호성 없음 — 위반 없음
- B4 (unvalidated + unflagged load-bearing assumption): 가정 없음 — 위반 없음
- **(HEAD baseline)**: 이 AC는 10개 파일에 대한 단일 aggregate 검증(`wc -l` = 10)만 제공하고
  파일별 개별 pass/fail 확인 경로를 제공하지 않음 — `agents/metis.md`의
  `## AC Quality Detail Rules`가 정의하는 batch-pattern(enumeration) + aggregate-only
  verification에 해당하여, 현재 HEAD metis는 이를 `[CERTAIN]` blocker로 `REQUEST_CHANGES`
  할 것으로 예상됨 — 이것이 RED baseline
- **(재설계 후)**: batch-pattern은 whitelist 밖(B1-B4 어디에도 속하지 않는 demoted axis)이므로
  0 blocking — Verdict = `APPROVE` 또는 `COMMENT`(batch-pattern에 대한 advisory) —
  **`REQUEST_CHANGES` 아님**
- 명시: 이 픽스처의 discriminating power는 aggregate-only batch AC에 있다 — per-file
  granularity(파일별 개별 확인 문구)를 넣으면 현재 metis도 이미 demote하므로 회귀를
  증명하지 못한다.

---

## Scenario M-13: Carried-Forward Deadlock (Option-B-Shaped)

**Prompt:**
```
다음 요구사항 브리프를 검토해줘. (컨텍스트: 이 브리프는 prometheus 재검토 루프의 3번째
라운드다. 직전 두 라운드 모두 동일 항목에서 REQUEST_CHANGES를 받았다.)

요구사항: 알림 발송 배치잡의 실행 주기를 매시간에서 1분마다로 변경한다.

Round 이력:
- Round 1: REQUEST_CHANGES — B4(기존 알림 발송 로직이 exactly-once를 보장한다는 가정이
  미검증)
- Round 2: REQUEST_CHANGES — 동일 B4 항목, 여전히 미해결(가정을 검증하거나 flag하지 않음)
- Round 3 (현재): 브리프 변경 없음, 동일 B4 항목 여전히 미해결

Scope: In-scope 배치잡 스케줄 설정만. Out-of-scope: 알림 로직 자체.
인수조건: cron이 `* * * * *`로 설정되고 CloudWatch에서 분당 1회 실행이 관측된다.
```

**Expected:**
- (a) Residual 항목이 명명됨: "기존 알림 발송 로직의 exactly-once 미검증 가정"(B4)
- (b) metis는 round-unaware이므로 이번 호출에서도 **동일 B4 항목에 REQUEST_CHANGES를
  반환**함(round 이력을 읽고 verdict를 바꾸지 않음)
- (c) 관측 대상은 metis의 verdict가 아니라 **prometheus의 행동**: K=3 도달 시 prometheus가
  residual을 기록하고 terminal transition(S2 진행)함을 assert
- "metis 자신은 REQUEST_CHANGES를 반환(round-unaware) — terminal은 D-1 Option B에 따라
  prometheus-owned이며, metis의 verdict 자체가 아님"임을 명시

---

## Scenario M-14: S1→S4 Relocation (Batch COMMENT → Plan Operationalization → Momus Bounded)

**Prompt:**
```
다음 요구사항 브리프를 검토해줘, 그리고 검토 이후 진행될 파이프라인 단계도 함께 판단해줘:

요구사항: 다음 8개 파일에서 로그 포맷을 JSON 구조화 로그로 통일한다: api/auth.ts,
api/payment.ts, api/order.ts, api/user.ts, worker/email.ts, worker/sms.ts,
worker/push.ts, worker/webhook.ts.

Scope:
- In-scope: 위 8개 파일의 console.log 호출을 구조화 로거로 교체
- Out-of-scope: 로그 수집/저장 인프라는 변경하지 않음

인수조건:
1) 위 8개 파일 각각에서 console.log 호출이 structured logger(logger.info(...))로
   교체된다 (파일별 grep으로 console.log 잔존 여부 개별 확인 가능)
```

**Expected:**
- (a) metis는 batch-pattern("8개 파일 모두 통일")을 **COMMENT**로 표시(REQUEST_CHANGES
  아님) — B1-B4 중 어느 것도 위반하지 않으므로 blocking 없음
- (b) plan 저작 단계에서 이 COMMENT가 plan context로 carry되어, 후속 plan이 8개 파일을
  per-file(per-TODO) AC로 operationalize함(각 파일이 개별 AC로 분해됨)
- (c) momus가 S4에서 operationalize된 per-file AC들을 리뷰: 이미 per-element로 분해되어
  있으므로 batch 축으로 재-block하지 않고 **bounded 수렴**함
  (`skills/momus/tests/application-scenarios.md:370` MO-8의 batch-detection
  베이스라인과 일치 — momus는 이미 batch를 감지/bound하는 능력이 있으므로 무한
  재블록이 아님을 확인)

---

## Verdict Rubric

| Verdict | Condition |
|---------|-----------|
| PASS | All expected checks are met |
| PARTIAL | Major checks met, minor quality gaps remain |
| FAIL | Critical checks missed or wrong verdict logic |
