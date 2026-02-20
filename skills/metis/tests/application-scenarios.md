# Metis Skill — Application Test Scenarios

## Purpose

These scenarios test whether the metis skill's **core techniques** are correctly applied. Each scenario targets the 8-category Analysis Framework, Mandatory Output Structure, vague term detection, and completeness enforcement.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| M-1 | Analysis Framework 전반부 | Requirements / Assumptions / Scope / Dependencies | 카테고리 누락 감지 |
| M-2 | Analysis Framework 후반부 | Risks / Success Criteria / Edge Cases / Error Handling | 보안/에러 처리 누락 감지 |
| M-3 | Mandatory Output Structure | 8-section markdown 출력 구조 | 섹션별 품질 검증 |
| M-4 | Vague Term Detection | 모호한 용어 감지 및 명확화 요청 | Analysis Framework 전반 |
| M-5 | Completeness | Scope Exclusion / Common Mistake Detection | 암묵적 가정 질문 |
| M-6 | Intent Classification | MT-1: Intent 분류 → 분석 전 수행 | 분류 신뢰도 검증 |
| M-7 | Intent-Specific Analysis | MT-2: Intent별 맞춤 분석 (Refactoring) | 안전성/회귀 방지 집중 |
| M-8 | Pre-Research Protocol | MT-3: Build from Scratch → 사전 탐색 후 질문 | 탐색 결과 기반 질문 |
| M-9 | Directives for Prometheus | MT-4: MUST/MUST NOT/PATTERN 구조화 지시문 | 실행 가능한 지시문 |
| M-10 | AI-Slop Detection | MT-5: 스코프 팽창 / 조기 추상화 감지 | 패턴별 명확화 질문 |
| M-11 | Why_This_Matters | MT-6: 분석 동기 및 맥락 전달 | 분석 가치 설명 |
| M-12 | Failure_Modes | MT-7: 안티패턴 회피 (시장 분석, 모호한 발견, 과분석) | 영향도 우선순위 |
| M-13 | Success_Criteria + Checklist | MT-8: 측정 가능한 기준 및 자기 검증 | 검증 방법 명시 |
| M-14 | AC Quality Check | AC Quality 검증 — 기존 AC의 품질 결함 감지 | Analysis Guards (AC) |

---

## Scenario M-1: Analysis Framework — Requirements/Assumptions/Scope/Dependencies

**Primary Technique:** 8-category Analysis Framework (전반 4개 카테고리)

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 실시간 채팅 기능 구현 플랜

### 목표
기존 웹 애플리케이션에 실시간 채팅 기능 추가

### 작업 항목
1. WebSocket 서버 구성
2. 채팅방 생성/참여 API
3. 메시지 전송/수신 처리
4. 채팅 이력 저장

### 기술 스택
- Spring Boot + WebSocket
- PostgreSQL

### 일정
- 2주 내 완료 예정
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Requirements 누락 감지 | 동시 접속자 수 제한, 메시지 길이 제한, 지원 브라우저 등 구체적 요구사항 누락을 지적 |
| V2 | Assumptions 검증 요청 | "기존 웹 애플리케이션"의 인증 체계, 사용자 모델 존재 여부 등 검증되지 않은 가정을 질문 |
| V3 | Scope 경계 질문 | 1:1 vs 그룹 채팅, 파일 전송, 읽음 확인 등 포함/미포함 범위를 명시적으로 질문 |
| V4 | Dependencies 목록화 | WebSocket 인프라, 인증 시스템 연동, 메시지 브로커 필요 여부 등 선행 의존성을 나열 |

---

## Scenario M-2: Analysis Framework — Risks/Success Criteria/Edge Cases/Error Handling

**Primary Technique:** 8-category Analysis Framework (후반 4개 카테고리)

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 결제 시스템 마이그레이션 플랜

### 목표
기존 Iamport 결제를 Toss Payments로 마이그레이션

### 작업 항목
1. Toss Payments SDK 연동
2. 기존 결제 로직을 새 API로 교체
3. 결제 내역 데이터 마이그레이션
4. 테스트 환경에서 검증

### 성공 기준
- 모든 결제가 정상 작동
- 기존 데이터 유실 없음

### 기술 스택
- Spring Boot, JPA
- Toss Payments API
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Risks 식별 | 마이그레이션 중 결제 실패 위험, 롤백 전략 부재, 양쪽 시스템 동시 운영 기간 등 위험 요소를 식별 |
| V2 | Success Criteria 구체화 요구 | "모든 결제가 정상 작동"이 측정 불가능함을 지적, 구체적 기준(성공률, 응답시간 등)을 요구 |
| V3 | Edge Cases 발견 | 마이그레이션 중 진행 중인 결제 처리, 환불 요청, 부분 결제, 정기 결제 갱신 등 엣지 케이스 제시 |
| V4 | Error Handling 누락 지적 | API 타임아웃, 결제 중복 처리, 웹훅 실패 시 재시도 전략 등 에러 처리 부재를 지적 |

---

## Scenario M-3: Mandatory Output Structure Compliance

**Primary Technique:** 8-section Mandatory Output Structure

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 사용자 프로필 이미지 업로드 기능

### 작업 항목
1. 이미지 업로드 API 엔드포인트 생성
2. S3 버킷에 이미지 저장
3. 프로필 이미지 URL을 사용자 테이블에 저장
4. 이미지 리사이징 처리

### 기술 스택
- Spring Boot, AWS S3
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Missing Questions 섹션 존재 | "### Missing Questions" 헤딩과 번호 목록이 출력에 포함됨 |
| V2 | Undefined Guardrails 섹션 존재 | "### Undefined Guardrails" 헤딩과 구체적 경계 정의 제안이 포함됨 |
| V3 | Scope Risks 섹션 존재 | "### Scope Risks" 헤딩과 스코프 확장 위험 항목이 포함됨 |
| V4 | Unvalidated Assumptions 섹션 존재 | "### Unvalidated Assumptions" 헤딩과 검증 필요 가정이 포함됨 |
| V5 | Missing Acceptance Criteria 섹션 존재 | "### Missing Acceptance Criteria" 헤딩과 측정 가능한 기준 제안이 포함됨 |
| V6 | Edge Cases 섹션 존재 | "### Edge Cases" 헤딩과 비정상 시나리오가 포함됨 |
| V7 | Recommendations 섹션 존재 | "### Recommendations" 헤딩과 우선순위가 매겨진 명확화 항목이 포함됨 |
| V8 | Domain Context 섹션 존재 | "### Domain Context" 헤딩과 도메인 맥락/분석 동기 설명이 출력 최상단(Intent Classification 이전)에 포함됨 |

---

## Scenario M-4: Vague Term Detection

**Primary Technique:** 모호한 용어 감지

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 알림 시스템 개선 플랜

### 목표
사용자 경험을 개선하기 위해 알림 시스템을 고도화한다.

### 작업 항목
1. 이벤트가 발생하면 적절한 알림을 전송
2. 사용자 선호도에 따라 알림 채널 분기
3. 표준적인 방식으로 알림 템플릿 관리
4. 적절한 빈도로 알림 발송 제한

### 비기능 요구사항
- 대량의 알림도 처리 가능해야 함
- 적절한 응답 시간 내에 전송 완료
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | "이벤트가 발생하면" 감지 | 어떤 이벤트인지 정의되지 않음을 명시적으로 지적 |
| V2 | "적절한 알림" 감지 | "적절한"이 정의되지 않음을 지적하고 구체적 기준 요구 |
| V3 | "사용자 선호도" 감지 | 어떤 선호도 옵션이 존재하는지 구체화 요구 |
| V4 | "표준적인 방식" 감지 | 어떤 표준인지 명시를 요구 |
| V5 | "대량" / "적절한 응답 시간" 감지 | 수치 기준 없이 모호한 비기능 요구사항임을 지적 (예: 초당 몇 건, 몇 초 이내) |

---

## Scenario M-5: Completeness — Scope Exclusion and Common Mistake Detection

**Primary Technique:** 완전성 검증 — 명시적 제외 요구 및 "당연한" 가정 질문

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 사용자 권한 관리 시스템 플랜

### 목표
역할 기반 접근 제어(RBAC) 시스템 구현

### 작업 항목
1. Role 엔티티 및 Permission 엔티티 설계
2. 사용자-역할 매핑 테이블 생성
3. API 엔드포인트별 권한 검증 미들웨어
4. 관리자 대시보드에서 역할/권한 관리 UI

### 기술 스택
- Spring Boot, Spring Security
- PostgreSQL, React (관리자 UI)

### 참고
- 기존 인증 시스템(JWT)은 이미 구현되어 있음
- 현재 모든 사용자는 동일한 권한을 가짐
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 명시적 제외 요구 | Out of Scope가 없음을 지적 (예: ABAC, 리소스 레벨 권한, 감사 로그 등이 포함/미포함인지 질문) |
| V2 | 암묵적 가정 질문 | "기존 JWT 시스템"의 토큰에 역할 정보 포함 여부, 토큰 재발급 전략 등 검증 요구 |
| V3 | "당연한" 것 건너뛰지 않음 | 기본 역할 정의(ADMIN, USER 등), 초기 데이터 시딩, 슈퍼관리자 존재 여부 등 "당연해 보이는" 항목도 명시 요구 |
| V4 | 카테고리 전체 검토 | 8개 Analysis Framework 카테고리를 모두 검토하되 특히 Security와 Error Handling을 빠뜨리지 않음 |

---

## Scenario M-6: Intent Classification

**Primary Technique:** MT-1 — Intent 분류 (분석 시작 전 필수 단계)

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 레거시 주문 모듈 리팩토링

### 배경
현재 주문 처리 로직이 OrderService 클래스 하나에 3000줄로 집중되어 있어 유지보수가 어렵다.
일부 메서드는 결제, 배송, 재고 관련 로직이 혼재되어 있다.

### 작업 항목
1. OrderService를 도메인별 서비스로 분리
2. 공통 유틸리티 추출
3. 기존 테스트 보존 및 확장

### 기술 스택
- Kotlin, Spring Boot
- 기존 테스트: JUnit 5 + Mockito
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Intent Type 명시 | 분석 시작 전에 Intent Type을 "Refactoring"으로 명시적으로 분류함 |
| V2 | Confidence Level 제시 | 분류 신뢰도(High/Medium/Low)를 근거와 함께 제시함 |
| V3 | 분류가 분석보다 선행 | Intent Classification이 세부 분석 섹션보다 먼저 등장하며, 이후 분석이 이 분류에 기반함 |

---

## Scenario M-7: Intent-Specific Analysis — Refactoring Safety Focus

**Primary Technique:** MT-2 — Intent별 맞춤 분석 (Refactoring → 안전성/회귀 방지)

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 인증 미들웨어 리팩토링

### 목표
현재 Express 라우터마다 인라인으로 작성된 JWT 검증 로직을 공통 미들웨어로 추출

### 작업 항목
1. authMiddleware.ts 파일 생성
2. 각 라우터에서 인라인 검증 코드 제거
3. 새 미들웨어로 교체
4. 역할별 접근 제어 로직 통합

### 현재 상태
- 12개 라우터에 JWT 검증 로직이 중복
- 각 라우터마다 미세하게 다른 검증 로직 존재
- 기존 E2E 테스트 68개 존재

### 기술 스택
- Node.js, Express, TypeScript
- Jest + Supertest
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 안전성 중심 질문 | 행동 보존에 대한 질문이 포함됨 (예: "12개 라우터의 미세한 차이가 의도적인 것인지, 각각의 현재 동작이 정확히 무엇인지") |
| V2 | 도구 가이던스 제공 | Refactoring에 적합한 도구 사용을 권장함 (예: 참조 추적, 안전한 리네임, 구조 패턴 검색 등) |
| V3 | 행동 보존 지시문 | "변경 전 동작 검증 정의", "각 변경 후 검증", "구조 변경 중 동작 변경 금지" 등 회귀 방지 지시문이 포함됨 |
| V4 | 롤백 전략 질문 | 리팩토링 실패 시 롤백 전략에 대한 질문이 포함됨 |

---

## Scenario M-8: Pre-Research Protocol — Build from Scratch

**Primary Technique:** MT-3 — 사전 탐색 프로토콜 (사용자 질문 전 explore/librarian 수행)

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 실시간 알림 센터 구현 (신규)

### 목표
기존 시스템에 없는 완전히 새로운 실시간 알림 센터를 구축한다.

### 작업 항목
1. 알림 이벤트 수집 서비스 생성
2. SSE(Server-Sent Events) 기반 실시간 푸시
3. 알림 센터 UI 컴포넌트 구현
4. 알림 읽음 처리 및 설정 관리

### 기술 스택
- Spring Boot (백엔드), React (프론트엔드)
- PostgreSQL, Redis (이벤트 큐)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | explore 에이전트 호출 | 사용자에게 질문하기 전에, 코드베이스에서 유사한 구현 패턴을 탐색하는 explore 에이전트를 호출함 (또는 호출을 권장함) |
| V2 | 탐색 기반 질문 | 질문이 generic하지 않고 탐색 결과에 기반함 (예: "코드베이스에서 X 패턴을 발견했는데, 새 기능도 이를 따라야 하나요?") |
| V3 | 사용자에게 코드베이스 질문 안 함 | 코드베이스에서 직접 확인 가능한 사항(파일 구조, 기존 패턴 등)을 사용자에게 묻지 않음 |

---

## Scenario M-9: Directives for Prometheus

**Primary Technique:** MT-4 — MUST/MUST NOT/PATTERN 구조화 지시문 출력

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 상품 검색 API 개선

### 목표
기존 키워드 기반 검색에 필터링(카테고리, 가격대, 정렬)을 추가

### 작업 항목
1. 검색 필터 파라미터 설계
2. QueryDSL 기반 동적 쿼리 구현
3. 검색 결과 페이지네이션
4. 검색 필터 UI 컴포넌트

### 기술 스택
- Kotlin, Spring Boot, QueryDSL
- PostgreSQL, React

### 기존 코드
- 현재 ProductRepository에 단순 키워드 검색만 존재
- 프론트엔드에 검색 바 컴포넌트 이미 존재
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Directives 섹션 존재 | 출력에 "Directives for Prometheus" 또는 동등한 구조화된 지시문 섹션이 존재함 |
| V2 | MUST 항목이 실행 가능 | MUST 항목이 구체적이고 실행 가능함 (예: "MUST: 기존 ProductRepository 패턴을 따를 것" — "잘 만들 것" 같은 모호한 표현이 아닌) |
| V3 | MUST NOT 항목이 안티패턴 방지 | MUST NOT 항목이 구체적 안티패턴을 방지함 (예: "MUST NOT: 요청되지 않은 전문 검색 엔진(Elasticsearch 등) 도입") |
| V4 | PATTERN/TOOL 지시문 포함 | 따라야 할 기존 코드 패턴이나 사용할 도구에 대한 구체적 지시가 포함됨 |

---

## Scenario M-10: AI-Slop Detection

**Primary Technique:** MT-5 — 스코프 팽창, 조기 추상화 등 AI-Slop 패턴 감지

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 사용자 프로필 수정 API

### 목표
사용자가 자신의 닉네임과 자기소개를 수정할 수 있는 API 구현

### 작업 항목
1. PATCH /api/users/me/profile 엔드포인트 구현
2. 닉네임 중복 체크
3. 입력값 검증 (길이 제한)
4. 수정 이력 저장

### 제약 조건
- 닉네임: 2-20자, 영문/한글/숫자만 허용
- 자기소개: 최대 200자

### 기술 스택
- Kotlin, Spring Boot, JPA
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 스코프 팽창 위험 식별 | 간단한 프로필 수정 API에서 발생할 수 있는 스코프 팽창을 식별함 (예: "수정 이력 저장"이 범위 대비 과한지 질문) |
| V2 | 조기 추상화 위험 경고 | 단순 기능에 대한 불필요한 추상화 위험을 경고함 (예: "프로필 수정용 범용 이벤트 시스템 구축" 등) |
| V3 | 패턴별 명확화 질문 | 각 AI-Slop 패턴에 대해 구체적 명확화 질문이 있음 (예: "수정 이력이 정말 필요한가요? 필요하다면 어디까지?") |

---

## Scenario M-11: Why_This_Matters — 분석 동기 전달

**Primary Technique:** MT-6 — 분석의 맥락과 동기를 설명

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 배치 작업 스케줄러 구현

### 목표
매일 자정에 미정산 거래를 집계하여 정산 리포트 생성

### 작업 항목
1. Spring Batch Job 설정
2. 미정산 거래 조회 쿼리
3. 정산 리포트 생성 로직
4. 이메일 발송

### 기술 스택
- Spring Boot, Spring Batch
- PostgreSQL
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 분석 동기 명시 | 왜 이 분석이 중요한지를 설명함 (예: "정산은 금전 관련 기능이므로 누락이 직접적인 재무 손실로 이어집니다" 등) |
| V2 | 도메인 맥락 연결 | 단순 기술 체크리스트가 아닌, 이 특정 도메인(정산/배치)에서 분석이 왜 중요한지 맥락을 제공함 |
| V3 | 분석 가치 설명이 출력 초반에 위치 | 동기 설명이 세부 분석보다 앞에 위치하여 독자가 분석의 중요성을 먼저 이해할 수 있음 |

---

## Scenario M-12: Failure_Modes — 안티패턴 회피

**Primary Technique:** MT-7 — 시장 분석, 모호한 발견, 과분석 등 안티패턴 회피

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 쿠폰 시스템 구현

### 목표
프로모션용 할인 쿠폰 발급 및 적용 시스템 구현

### 작업 항목
1. 쿠폰 엔티티 및 CRUD API
2. 쿠폰 발급 로직 (수량 제한, 유효기간)
3. 주문 시 쿠폰 적용 (할인 계산)
4. 쿠폰 사용 이력 관리

### 기술 스택
- Kotlin, Spring Boot, JPA
- PostgreSQL, Redis (동시성 제어)
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 구체적 발견 (모호하지 않음) | "요구사항이 불명확합니다" 같은 모호한 발견이 아니라, "동시에 1000명이 동일 쿠폰을 요청할 때의 동시성 처리가 정의되지 않았습니다" 같은 구체적 발견을 제시함 |
| V2 | 영향도 우선순위 부여 | 발견 항목에 영향도 기반 우선순위가 있음 (금전 관련 → 높음, UI 개선사항 → 낮음 등) |
| V3 | 시장 분석 회피 | "쿠폰 시스템이 비즈니스에 가치가 있는가?" 같은 시장 판단을 하지 않고, 구현 가능성에만 집중함 |
| V4 | 과분석 회피 | 단순 CRUD 부분에 대해 50가지 엣지케이스를 나열하지 않고, 핵심 위험(동시성, 금액 계산 정확성)에 집중함 |

---

## Scenario M-13: Success_Criteria + Checklist — 측정 가능한 기준 및 자기 검증

**Primary Technique:** MT-8 — 각 발견에 검증 방법 명시 및 테스트 가능한 수락 기준

**Prompt:**
```
다음 플랜을 리뷰해줘:

## 파일 업로드 서비스 구현

### 목표
사용자가 문서 파일(PDF, DOCX)을 업로드하고 다운로드할 수 있는 서비스

### 작업 항목
1. 멀티파트 파일 업로드 API
2. S3 저장소 연동
3. 파일 메타데이터 저장 (이름, 크기, 타입, 업로드일시)
4. 파일 다운로드 API (presigned URL)
5. 파일 크기/타입 검증

### 성공 기준
- 파일 업로드/다운로드가 정상 동작
- 허용되지 않은 파일 형식은 거부

### 기술 스택
- Kotlin, Spring Boot
- AWS S3, PostgreSQL
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 발견별 검증 방법 명시 | 각 발견 항목에 "어떻게 이 gap이 해소되었는지 검증할 수 있는가"가 포함됨 (예: "최대 파일 크기 미정의 → 정의 후 해당 크기 초과 파일 업로드 시 413 응답 확인") |
| V2 | 수락 기준이 테스트 가능 | Missing Acceptance Criteria에서 제안하는 기준이 pass/fail로 판단 가능함 (예: "정상 동작" → "100MB PDF 업로드 후 presigned URL로 다운로드 시 원본과 MD5 일치") |
| V3 | 자기 검증 체크리스트 존재 | 분석 완료 후 "모든 요구사항의 완전성 검토 여부", "발견이 구체적이고 해결 방안 포함 여부" 등 자기 검증 항목이 포함됨 |

---

## Scenario M-14: AC Quality Check — 기존 인수조건의 구조적 결함 감지

**Primary Technique:** AC Quality Check — 기존 인수조건의 구조적 결함 감지

**Prompt:**
```
다음 플랜을 리뷰해줘:

## council 워커 리팩토링 플랜

### 목표
council과 spec-review 워커의 공통 로직을 추출하고 프롬프트 조립을 구조화한다.

### 작업 항목
1. 공통 워커 인프라 추출
2. 구조화된 프롬프트 파이프라인 구축

### 인수조건
- [ ] skills/shared/lib/worker-core.js 생성 — splitCommand, atomicWriteJson, sleepMs 등 공통 함수 추출
- [ ] 프롬프트 파이프라인이 구현됨
- [ ] 기존 테스트 통과 확인
- [ ] council-worker와 spec-worker가 공통 모듈을 import하여, 중복 함수 없이 동작
      Verification: grep으로 양쪽 워커에서 공통 모듈 import 확인, 중복 함수 0개

### 기술 스택
- Node.js, JavaScript
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 파일 나열 AC 감지 | "worker-core.js 생성 -- splitCommand, atomicWriteJson..." 항목이 파일/함수 나열임을 지적하고, observable outcome으로 재작성을 제안 |
| V2 | 작업 재진술 AC 감지 | "프롬프트 파이프라인이 구현됨"이 작업을 재진술할 뿐 완료 후 상태를 기술하지 않음을 지적 |
| V3 | 모호한 검증 AC 감지 | "기존 테스트 통과 확인"이 보편적 진리(universal truth)이며 plan-specific하지 않음을 지적 |
| V4 | 잘 작성된 AC 구분 | 4번째 criterion (공통 모듈 import + grep 검증)은 observable outcome + 구체적 verification이 있으므로 문제로 지적하지 않음 |

---

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| M-1 | Analysis Framework 전반부 | PASS | 2026-02-10 | V1-V4 모두 충족 |
| M-2 | Analysis Framework 후반부 | PASS | 2026-02-10 | V1-V4 모두 충족 |
| M-3 | Mandatory Output Structure | PASS | 2026-02-10 | V1-V7 모두 충족 (V8 Domain Context 추가됨 — 재검증 필요) |
| M-4 | Vague Term Detection | PASS | 2026-02-10 | V1-V5 모두 충족 |
| M-5 | Completeness | PASS | 2026-02-10 | V1-V4 모두 충족 |
| M-14 | AC Quality Check | | | AC Quality 검증 추가 — 테스트 필요 |
