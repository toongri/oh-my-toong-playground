# Metis Skill — Application Test Scenarios

## Purpose

These scenarios test whether the metis skill's **core techniques** are correctly applied. Each scenario targets the 8-category Analysis Framework, Mandatory Output Structure, vague term detection, and completeness enforcement.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| M-1 | Analysis Framework 전반부 | Requirements / Assumptions / Scope / Dependencies | 카테고리 누락 감지 |
| M-2 | Analysis Framework 후반부 | Risks / Success Criteria / Edge Cases / Error Handling | 보안/에러 처리 누락 감지 |
| M-3 | Mandatory Output Structure | 7-section markdown 출력 구조 | 섹션별 품질 검증 |
| M-4 | Vague Term Detection | 모호한 용어 감지 및 명확화 요청 | Analysis Framework 전반 |
| M-5 | Completeness | Scope Exclusion / Common Mistake Detection | 암묵적 가정 질문 |

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

**Primary Technique:** 7-section Mandatory Output Structure

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

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| M-1 | Analysis Framework 전반부 | PASS | 2026-02-10 | V1-V4 모두 충족 |
| M-2 | Analysis Framework 후반부 | PASS | 2026-02-10 | V1-V4 모두 충족 |
| M-3 | Mandatory Output Structure | PASS | 2026-02-10 | V1-V7 모두 충족 |
| M-4 | Vague Term Detection | PASS | 2026-02-10 | V1-V5 모두 충족 |
| M-5 | Completeness | PASS | 2026-02-10 | V1-V4 모두 충족 |
