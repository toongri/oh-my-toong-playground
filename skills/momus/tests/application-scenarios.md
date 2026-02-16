# Momus Skill — Application Test Scenarios

## Purpose

These scenarios test whether the momus skill's **core techniques** are correctly applied. Each scenario targets simulation protocol, reference verification, four-criteria evaluation, and verdict format compliance.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| MO-1 | Simulation Protocol | 단계별 시뮬레이션으로 숨겨진 모호성 발견 | Action sequence 식별 |
| MO-2 | Reference Verification | 구체적 참조 수용 / 모호한 참조 거부 | Codebase 접근 불가 시 평가 |
| MO-3 | Four Criteria — Full Pass | 4개 기준 전체 통과 평가 | OKAY 판정 |
| MO-4 | Four Criteria — Partial Fail | Verifiability/Completeness 실패 감지 | REJECT 판정 + 개선안 |
| MO-5 | Final Verdict Format | 출력 형식 준수 | 판정 구조 검증 |
| MO-6 | Failure_Modes | Rubber-stamping 회피 및 구체적 REJECT 사유 제시 | 모호한 거부 방지 |
| MO-7 | Certainty Levels | "확실히 누락" vs "불명확할 수 있음" 구분 | 심각도별 판정 가중치 |

---

## Scenario MO-1: Simulation Protocol — Ambiguity Discovery

**Primary Technique:** Simulation Protocol — 단계별 시뮬레이션으로 숨겨진 모호성 발견

**Prompt:**
```
다음 작업 플랜을 리뷰해줘:

## 주문 상태 알림 시스템 구현 플랜

### Task 1: 주문 상태 변경 이벤트 발행
- OrderService에서 상태 변경 시 도메인 이벤트 발행
- 이벤트에 주문 ID, 이전 상태, 새 상태 포함

### Task 2: 알림 전송 핸들러 구현
- 이벤트 수신 후 사용자에게 알림 전송
- 알림 채널은 기존 패턴을 따름
- 적절한 메시지 템플릿 사용

### Task 3: 알림 이력 저장
- 전송된 알림을 DB에 기록
- 기존 테이블 구조를 활용

### 기술 스택
- Kotlin, Spring Boot, Spring Events
- PostgreSQL
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Task 1 시뮬레이션 수행 | Task 1을 단계별로 시뮬레이션하여 OrderService의 상태 변경 트리거 조건(어떤 상태 전이?) 모호성을 발견 |
| V2 | Task 2 시뮬레이션에서 모호성 발견 | "기존 패턴을 따름"이 구현 시 해결 불가능한 모호성임을 식별 (어떤 패턴? 어디에 정의?) |
| V3 | Task 3 시뮬레이션에서 참조 부재 발견 | "기존 테이블 구조"가 구체적으로 어떤 테이블인지 특정 불가능함을 식별 |
| V4 | 차단 갭(blocking gap)으로 모호성 분류 | 발견된 모호성을 차단 갭으로 판정에 반영 |

---

## Scenario MO-2: Reference Verification — Specific vs Vague References

**Primary Technique:** Reference Verification Strategy — 구체적 참조 수용, 모호한 참조 거부

**Prompt:**
```
다음 작업 플랜을 리뷰해줘 (코드베이스 접근 불가 상태로 평가해줘):

## 인증 토큰 갱신 로직 리팩토링 플랜

### Task 1: 토큰 갱신 엔드포인트 수정
- `src/main/kotlin/com/example/auth/TokenController.kt:45-67`의 refreshToken() 메서드를 수정
- 현재 만료 시간 고정값을 설정 기반으로 변경
- `src/main/resources/application.yml`의 `auth.token.refresh-ttl` 속성 추가

### Task 2: 토큰 검증 로직 개선
- 기존 검증 로직을 참고하여 개선
- 표준적인 JWT 검증 방식 적용
- 에러 처리는 기존 방식을 따름

### Task 3: 테스트 작성
- `src/test/kotlin/com/example/auth/TokenControllerTest.kt`에 테스트 추가
- 갱신 성공, 만료 토큰, 잘못된 토큰 케이스

### 기술 스택
- Kotlin, Spring Boot, jjwt 0.11.5
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Task 1 구체적 참조 수용 | `TokenController.kt:45-67`, `application.yml` 참조를 구체적이라고 판단하여 수용 |
| V2 | Task 2 "기존 검증 로직" 거부 | "기존 검증 로직을 참고"가 모호함을 REJECT 사유로 지적 (어떤 파일? 어떤 메서드?) |
| V3 | Task 2 "표준적인 방식" 거부 | "표준적인 JWT 검증 방식"이 구체성 부족임을 지적 (어떤 표준? 어떤 라이브러리 API?) |
| V4 | Task 2 "기존 방식" 거부 | "에러 처리는 기존 방식을 따름"이 참조 불충분임을 지적 |
| V5 | Task 3 구체적 참조 수용 | 테스트 파일 경로와 테스트 케이스가 구체적이라고 판단 |

---

## Scenario MO-3: Four Criteria Evaluation — Full Pass

**Primary Technique:** 4개 기준 전체 평가 — OKAY 판정

**Prompt:**
```
다음 작업 플랜을 리뷰해줘 (코드베이스 접근 불가 상태로 평가해줘):

## CSV → JSON 변환 CLI 도구 구현 플랜

### 비즈니스 이유
매달 마케팅팀에서 CSV 포맷 고객 데이터를 받아 JSON으로 수동 변환 중. 월 2시간 소요되며 수동 변환 시 필드 매핑 오류 빈번. 자동화 도구로 교체하여 오류 제거 및 시간 절약.

### Task 순서
Task 1 → Task 2 → Task 3 (순차 실행)

### Task 1: 프로젝트 초기화
- TypeScript + esbuild 기반 CLI 프로젝트 생성
- 외부 런타임 의존성 없이 Node.js 내장 모듈만 사용

### Task 2: CSV 파싱 및 JSON 변환 기능 구현
- CSV 파일을 읽어 헤더-값 매핑된 구조화 데이터로 변환
- JSON 출력 구조: 배열 형태, 각 행은 {헤더: 값} 객체, 모든 값은 문자열
- 구조화 데이터를 pretty-printed JSON 파일로 출력
- 파싱 제약: 단순 CSV만 지원 (필드 내 쉼표/따옴표 없음, 입력 보장)
- 줄바꿈 처리: \r\n, \n 모두 지원 (마케팅팀 Excel 출력 대응)
- 에러 처리: 파일 미존재, 빈 파일 케이스
- "빈 CSV" 정의: 헤더만 있고 데이터 행 없는 파일 포함

### Task 3: CLI 인터페이스 구현
- CLI 인자 형식: 위치 인자 (csv2json input.csv output.json), 두 인자 모두 필수
- 인자 부족 시 사용법 안내 출력 + exit code 1

### 인수 조건
- 빌드 성공 (esbuild 번들링)
- 3행 2열 샘플 CSV 변환 → 올바른 JSON 출력 (diff 검증)
- 파일 미존재 입력 시 에러 메시지 + exit code 1
- 빈 CSV(헤더만 존재) 입력 시 빈 배열 JSON 출력 ([] + exit code 0)
- 인자 부족 시 사용법 안내 + exit code 1

### 기술 스택
- TypeScript 5.x, Node.js 20+
- esbuild (빌드)

### Out of Scope
- 대용량 파일 스트리밍 (1MB 이하만 대상)
- CSV 방언 (탭 구분, 커스텀 구분자)
- 웹 UI
- 자동화 테스트 프레임워크 도입
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Clarity 통과 | 요구사항(JSON 구조, CLI 인자 형식, 빈 CSV 정의, 줄바꿈 처리)이 명확하고, 제약조건과 에러 케이스가 구체적이라고 판단하여 Pass |
| V2 | Verifiability 통과 | 인수 조건이 측정 가능하고 (빌드, diff 검증, exit code), 검증 방법이 명시되어 있어 Pass |
| V3 | Completeness 통과 | 기술 스택, 의존성 제약, 에러 케이스, 줄바꿈 처리가 명시되어 있어 Pass |
| V4 | Big Picture 통과 | 비즈니스 이유, Task 순서, Out of Scope가 명시되어 있어 Pass |
| V5 | OKAY 판정 | 최종 판정이 **OKAY**이며, 4개 기준 모두 Pass로 Summary에 표시 |

---

## Scenario MO-4: Four Criteria Evaluation — Partial Fail

**Primary Technique:** 4개 기준 평가 — 부분 실패 감지

**Prompt:**
```
다음 작업 플랜을 리뷰해줘:

## 상품 검색 기능 구현 플랜

### 목표
사용자가 상품명, 카테고리, 가격 범위로 상품을 검색할 수 있는 기능 구현

### 엔티티 스키마
- Product: id, name, price, category(ManyToOne), thumbnailUrl
- Category: id, name

### Task 1: 검색 API 엔드포인트 구현
- GET /api/products/search 엔드포인트 생성
- 검색 파라미터: keyword (상품명 부분일치), categoryId, minPrice, maxPrice (모두 선택적)
- 검색 시맨틱스: keyword는 양방향 부분일치, 대소문자 무시. 가격 범위는 이상/이하(경계값 포함)
- 페이지네이션 지원 (page, size 파라미터)
- 결과는 최신 등록순 정렬

### Task 2: 검색 결과 응답 정의
- 응답 포함 정보: 상품 ID, 이름, 가격, 카테고리명, 썸네일 URL
- 페이지 메타데이터 포함 (총 개수, 현재 페이지, 총 페이지 수)

### Task 3: 동적 쿼리 구현
- 각 검색 조건은 null이면 필터 미적용 (동적 조합)
- QueryDSL 기반 구현

### 비즈니스 이유
- 사용자 피드백에서 검색 기능이 가장 많이 요청됨
- 상품 수가 1000개를 넘어서 목록 스크롤만으로 부족

### 기술 스택
- Kotlin, Spring Boot 3.2, QueryDSL 5.0
- PostgreSQL

### Out of Scope
- 전문 검색 엔진(Elasticsearch) 도입
- 자동완성
- 검색어 추천
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Clarity 통과 | 검색 파라미터, 응답 필드, 정렬 기준, 엔티티 스키마, 검색 시맨틱스 등 요구사항이 구체적이라고 판단하여 Pass |
| V2 | Verifiability 실패 | 인수 조건과 테스트 전략이 전혀 없음을 지적하여 Fail (어떻게 검증? 어떤 테스트?) |
| V3 | Completeness 실패 | QueryDSL 빌드 설정 누락, Task 간 의존성 미정의를 지적하여 Fail |
| V4 | Big Picture 통과 | 비즈니스 이유와 Out of Scope가 있어 Pass |
| V5 | REJECT 판정 | 최종 판정이 **REJECT**이며, Verifiability Fail + Completeness Fail을 명시하고 구체적 개선안 제시 |

---

## Scenario MO-5: Final Verdict Format Compliance

**Primary Technique:** Final Verdict Format 출력 준수

**Prompt:**
```
다음 작업 플랜을 리뷰해줘:

## 로깅 표준화 플랜

### 목표
애플리케이션 전반의 로깅을 SLF4J + Logback으로 표준화

### 작업 항목
1. System.out.println을 logger로 교체
2. 로그 레벨 가이드라인 정의
3. 구조화된 로그 포맷(JSON) 적용
4. 로그 파일 로테이션 설정

### 기술 스택
- Kotlin, Spring Boot
- SLF4J, Logback
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | [OKAY/REJECT] 판정 존재 | 출력에 `**[OKAY]**` 또는 `**[REJECT]**` 형식의 판정이 포함됨 |
| V2 | Justification 존재 | `**Justification**:` 레이블과 1-2문장 근거가 포함됨 |
| V3 | Summary with Per-Criterion 존재 | `**Summary**:` 아래에 Clarity, Verifiability, Completeness, Big Picture 각각의 Pass/Fail이 포함됨 |
| V4 | 개선안 (REJECT인 경우) | REJECT 판정 시 구체적 개선 항목이 3-5개 포함됨 |

---

## Scenario MO-6: Failure_Modes — Rubber-stamping & Vague Rejection Avoidance

**Primary Technique:** Failure_Modes — Rubber-stamping 회피 및 구체적 REJECT 사유 제시

**Prompt:**
```
다음 작업 플랜을 리뷰해줘:

## 결제 재시도 로직 구현 플랜

### 목표
결제 실패 시 자동 재시도하여 결제 성공률을 높이는 기능 구현

### 참조 파일
- `src/main/kotlin/com/example/payment/PaymentService.kt` — 결제 처리 핵심 서비스
- `src/main/kotlin/com/example/payment/RetryPolicy.kt` — 재시도 정책 정의
- `src/main/resources/application.yml` — 재시도 관련 설정값

### Task 1: 재시도 정책 구현
- `RetryPolicy.kt`에 재시도 정책 클래스 구현
- 최대 재시도 횟수: `application.yml`의 `payment.retry.max-attempts` 값 사용
- 재시도 간격: 지수 백오프 적용 (기본 1초, 배수 2)
- 재시도 대상: 네트워크 타임아웃, 5xx 응답만 해당. 4xx 응답은 재시도 안 함

### Task 2: PaymentService에 재시도 통합
- 결제 실패 시 RetryPolicy를 적용하여 자동 재시도
- 기존 결제 흐름을 참고하여 적절한 위치에 통합
- 재시도 중 상태 관리는 기존 방식 활용

### Task 3: 재시도 이력 기록
- 재시도 발생 시 이력을 DB에 저장
- 기존 테이블을 활용하여 적절히 저장
- 로깅은 기존 로깅 패턴을 따름

### 기술 스택
- Kotlin, Spring Boot 3.2
- PostgreSQL
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 참조 파일 실제 읽기 시도 (rubber-stamping 회피) | 참조된 3개 파일(`PaymentService.kt`, `RetryPolicy.kt`, `application.yml`)을 실제로 읽으려 시도하거나, 읽을 수 없는 경우 해당 사실을 명시. "참조 파일이 있으므로 충분하다"고 무비판 수용하지 않음 |
| V2 | REJECT 사유가 파일/위치를 특정 | "플랜에 디테일이 부족합니다" 같은 모호한 거부가 아닌, "Task 2의 '기존 결제 흐름을 참고'는 `PaymentService.kt`의 어떤 메서드인지 특정 불가" 수준의 구체적 사유 제시 |
| V3 | "기존 방식/패턴" 모호성을 구체적으로 지적 | Task 2 "기존 방식 활용", Task 3 "기존 테이블 활용", "기존 로깅 패턴" 각각에 대해 어떤 파일/테이블/패턴인지 구체적으로 특정하라는 개선안 제시 (포괄적 "모호하다"가 아닌 항목별 지적) |
| V4 | Task 1의 구체적 요구사항은 정당하게 수용 | Task 1의 재시도 횟수, 간격, 대상 조건이 구체적임을 인정하고 해당 부분은 Pass 처리 (문제 발명 회피) |

---

## Scenario MO-7: Certainty Levels — Severity Differentiation in Findings

**Primary Technique:** Certainty Levels — "확실히 누락"과 "불명확할 수 있음"의 구분

**Prompt:**
```
다음 작업 플랜을 리뷰해줘 (코드베이스 접근 불가 상태로 평가해줘):

## 사용자 알림 설정 API 구현 플랜

### 비즈니스 이유
사용자별 알림 수신 채널(이메일, SMS, 푸시)과 알림 유형별 On/Off를 설정할 수 있는 기능이 필요. CS팀에서 월 50건 이상 "알림 끄고 싶다" 문의 발생 중.

### 엔티티 스키마
- NotificationPreference: id, userId, channel(ENUM: EMAIL/SMS/PUSH), notificationType(ENUM: MARKETING/TRANSACTIONAL/SYSTEM), enabled(Boolean)
- 복합 유니크 제약: (userId, channel, notificationType)

### Task 1: 알림 설정 조회 API
- GET /api/users/{userId}/notification-preferences
- 응답: 해당 사용자의 모든 알림 설정 목록 (channel, notificationType, enabled)
- 설정이 없는 사용자: 빈 배열 반환

### Task 2: 알림 설정 변경 API
- PUT /api/users/{userId}/notification-preferences
- 요청 바디: { channel: "EMAIL", notificationType: "MARKETING", enabled: false }
- 해당 설정이 없으면 새로 생성, 있으면 업데이트 (Upsert)
- SYSTEM 유형 알림은 변경 불가 (항상 enabled=true), 시도 시 400 응답

### Task 3: 알림 발송 시 설정 확인 로직
- 알림 발송 전 해당 사용자의 설정을 확인하여 enabled=false이면 발송 스킵
- 설정이 없는 경우 기본값은 enabled=true로 간주
- 발송 스킵 시 로그 기록

### Task 4: 기본 설정 초기화
- 신규 사용자 가입 시 기본 알림 설정을 생성하는 로직 필요
- 어떤 시점에, 어떤 이벤트로 트리거할지는 추후 결정

### 인수 조건
- 조회 API: 설정이 있는 사용자 → 목록 반환, 없는 사용자 → 빈 배열
- 변경 API: Upsert 동작 검증, SYSTEM 유형 변경 시 400 응답
- 알림 스킵: enabled=false 설정된 알림이 발송되지 않음을 검증
- 복합 유니크 제약 위반 시 적절한 에러 처리

### 기술 스택
- Kotlin, Spring Boot 3.2, Spring Data JPA
- PostgreSQL

### Out of Scope
- 관리자 일괄 설정 변경
- 알림 설정 이력 추적
- 알림 채널 추가 (현재 3개 고정)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Task 4 "추후 결정"을 높은 확실성(확실히 누락)으로 분류 | "어떤 시점에, 어떤 이벤트로 트리거할지는 추후 결정"은 구현 시 반드시 차단되는 미결 사항이므로 critical/blocking 수준으로 지적 |
| V2 | Task 3 발송 로직 통합 지점을 낮은 확실성(불명확할 수 있음)으로 분류 | Task 3는 "알림 발송 전 확인"이라고 했지만 기존 발송 로직의 위치가 미명시. 이를 Task 4와 동일한 심각도가 아닌 "구체적 파일 참조 추가 권장" 정도의 낮은 심각도로 구분 |
| V3 | Task 1-2의 명확한 요구사항은 높은 확실성 Pass 처리 | 엔티티 스키마, API 경로, 응답 형식, Upsert 동작, SYSTEM 제약 등 구체적인 부분을 확실한 Pass로 판정 (불필요한 문제 발명 없음) |
| V4 | 심각도가 판정 가중치에 영향 | "확실히 누락"(Task 4 트리거)이 REJECT 사유의 핵심 근거가 되고, "불명확할 수 있음"(Task 3 통합 지점)은 부가적 개선 권고로 분리되어, 심각도에 따른 가중치 차이가 판정 근거에 드러남 |

---

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| MO-1 | Simulation Protocol | **PASS** | 2026-02-10 | 4/4 VP 충족. 시뮬레이션 수행, 모호성 발견, 차단 갭 분류 정상 |
| MO-2 | Reference Verification | **PASS** | 2026-02-10 | 4/5 VP 충족. 구체적 참조 수용, 모호한 참조 거부 정상. V5 borderline (extra critical) |
| MO-3 | Four Criteria — Full Pass | **PASS** | 2026-02-11 | 4/4 기준 Pass, OKAY 판정. 프롬프트 보강(JSON 구조, CLI 인자, 빈 CSV 정의, 줄바꿈) 후 구현 디테일 요구 없이 정상 통과 |
| MO-4 | Four Criteria — Partial Fail | **PASS** | 2026-02-11 | Clarity Pass, Verifiability Fail, Completeness Fail, Big Picture Pass — REJECT 판정. 엔티티 스키마/검색 시맨틱스 보강 후 Clarity 정상 통과, 인수조건/QueryDSL 설정 누락 정확히 감지 |
| MO-5 | Final Verdict Format | **PASS** | 2026-02-10 | 4/4 VP 충족. 판정, Justification, Summary, 개선안 형식 모두 정상 |
