# Interface Contract Application Scenarios

Area: Interface Contract
Reference: `skills/spec/references/interface-contract.md`
Scenario Count: 2

---

### IC-1: Error Handling Design

**Technique Under Test**: Step 4.3 Error Handling Design (interface-contract.md lines 94-97) + Vague Answer Clarification "Handle errors appropriately" (line 32)

**Input**: API 엔드포인트 `POST /orders` — 가능한 실패 케이스: (1) 유효성 검증 에러(필수 필드 누락, 잘못된 형식), (2) 결제 실패(잔액 부족, 카드 거절), (3) 재고 부족(요청 수량 초과).

**Expected Output**: 각 실패 케이스에 대해 (1) 구체적인 HTTP 상태 코드 (예: 400 Bad Request, 402 Payment Required 또는 422, 409 Conflict 등), (2) 에러 응답 포맷(일관된 구조 — code, message, details 등), (3) 각 에러 케이스별 구체적 에러 메시지. "에러를 적절히 처리한다"가 아닌 구체적 정의.

**Pass Criteria**: (1) 모든 실패 케이스에 HTTP 상태 코드가 지정되고, (2) 에러 응답 포맷이 일관되며, (3) 각 케이스별 구체적 에러 메시지가 정의됨. "적절히 처리"와 같은 모호한 표현이 있으면 RED.

---

### IC-2: Versioning Strategy

**Technique Under Test**: Step 4.4 Versioning and Compatibility Considerations (interface-contract.md lines 99-102) + Step 5.2 Modified Interface Documentation (lines 114-118)

**Input**: 기존 API에 외부 소비자(모바일 앱, 파트너 API)가 있는 상황. 계획된 breaking change — 응답 필드명 변경 (예: `userName` → `user_name`), 필수 파라미터 추가.

**Expected Output**: (1) 버저닝 전략 제안 (URL 버저닝 /v2/, Header 버저닝, Query parameter 등에서 선택 + 근거), (2) 마이그레이션 경로 — 기존 v1 유지 기간, 소비자 전환 가이드, deprecation 타임라인, (3) 기존 소비자 영향 분석, (4) 하위 호환성 유지 방안.

**Pass Criteria**: (1) 버저닝 전략이 명시되고, (2) 마이그레이션 경로가 구체적이며, (3) 기존 소비자 영향 분석이 포함됨. breaking change를 마이그레이션 없이 적용하면 RED.
