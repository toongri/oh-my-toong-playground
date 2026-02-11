# AI Responsibility Contract Application Scenarios

Area: AI Responsibility Contract
Reference: `skills/spec/references/ai-responsibility-contract.md`
Scenario Count: 3

---

### AI-1: Responsibility Boundary (Decides/Assists/Cannot)

**Technique Under Test**: Step 1.3 Responsibility Boundaries (ai-responsibility-contract.md lines 89-94) + Principles "Responsibility Boundary Specification" (lines 16-18)

**Input**: AI 컴포넌트 — 상품 설명 자동 생성기(Product Description Generator). 상품명, 카테고리, 특성 입력 → 마케팅 문구 출력.

**Expected Output**: 3가지 수준으로 분류 — (1) **Decides**: 단어 선택, 문장 구조, 톤(마케팅 문체) — AI가 자율적으로 결정. (2) **Assists**: 사실 기반 주장(성능 수치, 재질 설명) — AI가 제안하되 사람이 검토. (3) **Cannot**: 가격 설정, 법적 주장(인증 마크, 의료 효능), 경쟁사 비교 — 명시적으로 AI 범위 밖.

**Pass Criteria**: (1) Decides/Assists/Cannot 3개 카테고리 모두 정의되고, (2) 각 카테고리에 구체적 항목이 포함되며, (3) 경계가 모호하지 않음. "AI가 알아서 처리"와 같은 모호한 위임이 있으면 RED.

---

### AI-2: Quality Acceptance Criteria (5 dimensions)

**Technique Under Test**: Step 3.2 Quality Acceptance Criteria (ai-responsibility-contract.md lines 129-142) — 5 dimension table

**Input**: AI 컴포넌트 — 고객 지원 챗봇(Customer Support Chatbot). 고객 문의에 대해 응답 생성.

**Expected Output**: 관련 차원 전체에 걸쳐 품질 기준 정의 — (1) **Accuracy**: 사실 정확성 — 제품 정보, 정책 안내가 실제와 일치해야 함. Unacceptable: 잘못된 환불 정책 안내. (2) **Completeness**: 고객 질문의 모든 부분에 답변 포함. Unacceptable: 2개 질문 중 1개만 답변. (3) **Relevance**: 질문과 관련 있는 내용만 포함. Unacceptable: 관련 없는 상품 홍보. (4) **Tone/Style**: 공손하고 전문적인 어조. Unacceptable: 반말, 감정적 표현. (5) **Safety**: 유해 콘텐츠 없음. Unacceptable: 개인정보 노출, 차별적 표현.

**Pass Criteria**: (1) 5가지 차원(Accuracy, Completeness, Relevance, Tone/Style, Safety) 중 해당하는 차원이 모두 정의되고, (2) 각 차원에 Acceptance Criteria와 Unacceptable Example이 포함되며, (3) "비결정론적이므로 기준 불필요"라는 면제를 허용하지 않음. 차원이 누락되거나 "적절하면 된다"와 같은 모호한 기준이면 RED.

---

### AI-3: Fallback Strategy (4 failure types)

**Technique Under Test**: Step 4.2 Fallback Strategy (ai-responsibility-contract.md lines 156-164) — 4 failure types

**Input**: AI 컴포넌트 — 상품 추천 엔진(Product Recommendation Engine). 사용자 행동 기반 맞춤 추천 제공.

**Expected Output**: 4가지 실패 유형별 폴백 정의 — (1) **AI Unavailable** (장애/타임아웃): 사용자에게 인기 상품 목록(비개인화) 표시. (2) **Quality Below Threshold**: 추천 관련성이 임계값 미달 시 카테고리 기반 일반 추천으로 대체. (3) **Confidence Low**: 추천 신뢰도 낮을 때 "추천 준비 중" 안내 + 기본 카탈로그 표시. (4) **Complete Chain Failure**: 모든 폴백 실패 시 최종 동작 — 정적 베스트셀러 목록 또는 추천 섹션 숨김.

**Pass Criteria**: (1) 4가지 실패 유형(AI Unavailable, Quality Below Threshold, Confidence Low, Complete Chain Failure) 모두 정의되고, (2) 각 유형에 사용자 관점의 구체적 폴백이 명시됨. 실패 유형이 누락되거나 "에러 메시지 표시"만 있으면 RED.
