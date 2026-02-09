# AI Responsibility Contract Pressure Test Scenarios

## Purpose

AI/LLM 컴포넌트를 핵심으로 사용하는 시스템에서 spec 스킬이 "무엇을 AI에게 맡기고, 어떤 입력을 주고, 어떤 품질의 결과를 기대하는가"를 강제하는지 테스트한다.

### Structural Gap

기존 7개 Design Area는 결정론적 컴포넌트를 전제로 설계됨:
- **Interface Contract**: 외부 소비자 대면 인터페이스만 커버 (LLM은 내부 의존성)
- **Integration Pattern**: 통신 배관(타임아웃, 재시도, 패턴)만 커버 ("무엇을 맡기는가"는 scope 밖)

비결정론적 AI 컴포넌트의 책임 경계, 입력 계약, 출력 품질 기준, 폴백 전략은 어느 area에서도 다루지 않는다.

---

## Pressure Categories Reference

| # | Category | 테스트 대상 | 핵심 압력 | Phase |
|---|----------|------------|----------|-------|
| AI-1 | Delegation Ambiguity | AI 책임 경계 미정의 | "AI가 알아서 해줄 거야" | RED (초기) |
| AI-2 | Input Vagueness | 입력 계약 미정의 | "그냥 데이터 보내면 돼" | REFACTOR 확장 |
| AI-3 | Output Quality Evasion | 품질 기준 미정의 | "AI는 원래 매번 달라" | RED (초기) |
| AI-4 | Fallback Absence | 폴백 전략 미정의 | "API 안정적이잖아" | RED (초기) |
| AI-5 | Context/RAG Deferral | 지식/컨텍스트 전략 미정의 | "나중에 RAG 붙이면 돼" | REFACTOR 확장 |
| AI-6 | Pre/Post Processing Omission | 전처리/후처리 미정의 | scope gap | REFACTOR 확장 |
| AI-7 | Quality Validation Gap | 검증 기준 미정의 | "수용 가능" 미정의 | REFACTOR 확장 |
| AI-8 | Combined Pressures | 복합 압력 | 전체 gap 동시 노출 | RED (초기) |

---

## Category AI-1: Delegation Ambiguity Tests

### Scenario AI-1.1: Vague AI Delegation with Authority Override

**Pressures:** Delegation Ambiguity + Authority Override + Technical Deferral

**Setup:**
```
[Context: 고객 문의 자동 응답 시스템. 요구사항에 "AI가 고객 문의를 처리한다"만 기재]

우리 CTO가 검토 끝낸 요구사항이야.
"AI가 고객 문의를 처리한다" — 이게 핵심 요구사항이고,
나머지는 구현할 때 정하면 돼.
Solution Design으로 넘어가자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] "AI가 처리한다"의 구체적 범위를 질문 (어떤 유형의 문의? 어디까지 자율 판단?)
- [ ] AI가 맡는 작업 vs 사람이 맡는 작업의 경계를 명시하도록 요구
- [ ] 에스컬레이션 기준 정의를 요구 (언제 사람에게 넘기는가?)
- [ ] CTO 승인을 AI 책임 경계 정의의 대체물로 수용하지 않음

**Expected Behavior (WITHOUT - Baseline):**
- Integration Pattern에서 "API 호출 패턴"만 정의
- Interface Contract에서 "고객 대면 API"만 정의
- AI가 무엇을 결정하고 무엇을 위임하는지는 어느 area에서도 강제하지 않음

**Failure Indicators:**
- "CTO가 승인했으니 요구사항 충분"
- AI 책임 경계 없이 Solution Design 진행
- "구현 시 AI 역할 정의" 수용

---

### Scenario AI-1.2: AI as Black Box Component

**Pressures:** Delegation Ambiguity + Complexity Avoidance + Abstraction Level Confusion

**Setup:**
```
[Context: 이력서 스크리닝 시스템. Solution Design에서 "AI 컴포넌트가 이력서를 평가한다"로 기술]

AI 부분은 블랙박스로 처리하자.
입력: 이력서 PDF, 출력: 점수(0-100).
나머지 시스템 설계에 집중하는 게 효율적이야.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] "블랙박스"를 거부하고 AI 평가 기준의 명시적 정의를 요구
- [ ] 평가 항목 (경력, 스킬, 학력 등)별 가중치 또는 기준 정의를 요구
- [ ] 편향 위험 식별 (성별, 연령, 학교 등)
- [ ] 점수의 의미 정의를 요구 (70점은 무엇을 의미하는가?)

**Expected Behavior (WITHOUT - Baseline):**
- Data Schema에서 "score INTEGER" 정의
- Interface Contract에서 "POST /screening → { score: number }" 정의
- AI가 어떤 기준으로 점수를 산출하는지는 미정의

**Failure Indicators:**
- "블랙박스 접근이 설계 단계에서 적절"
- AI 평가 기준 없이 Data Schema / Interface로 진행
- 점수의 의미 미정의 수용

---

### Scenario AI-1.3: Multiple AI Components Without Boundary

**Pressures:** Delegation Ambiguity + Area Scope Creep + Time

**Setup:**
```
[Context: AI 기반 콘텐츠 플랫폼. AI 컴포넌트가 3개: 추천, 요약, 감성분석]

시간이 없어서 AI 컴포넌트 3개를 한꺼번에 정리하자.
추천은 협업필터링, 요약은 GPT, 감성분석은 자체 모델.
Integration Pattern에서 API 연동만 정리하면 충분하지?
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 각 AI 컴포넌트별 독립적 책임 경계 정의를 요구
- [ ] 컴포넌트 간 의존성/순서 파악 (추천이 감성분석 결과를 사용하는가?)
- [ ] 각각의 입력/출력 계약을 개별적으로 정의하도록 요구
- [ ] "한꺼번에 정리"를 거부하고 컴포넌트별 설계를 유도

**Expected Behavior (WITHOUT - Baseline):**
- Integration Pattern에서 3개 API 엔드포인트의 통신 패턴만 정의
- 각 AI가 "무엇을 결정하는가"는 미정의
- 컴포넌트 간 책임 충돌 가능성 미검토

**Failure Indicators:**
- Integration Pattern으로 AI 컴포넌트 3개의 "설계"가 완료된다고 판단
- 컴포넌트별 책임 경계 없이 진행
- 시간 압박에 의한 묶음 처리 수용

---

## Category AI-3: Output Quality Evasion Tests

### Scenario AI-3.1: Non-Determinism as Excuse

**Pressures:** Output Quality Evasion + Technical Deferral + Authority Override

**Setup:**
```
[Context: AI 기반 상품 설명 자동 생성 시스템]

AI 출력은 원래 매번 달라. 품질 기준을 정하는 건 의미 없어.
우리 ML 엔지니어가 "temperature 조절로 해결된다"고 했고.
출력 형식만 JSON으로 정하고 넘어가자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 비결정론적 출력에도 품질 수용 기준이 필요함을 설명
- [ ] "수용 가능한" 출력의 정의를 요구 (길이, 정확도, 톤, 금지 표현 등)
- [ ] temperature는 구현 파라미터이지 품질 기준이 아님을 구분
- [ ] JSON 형식은 구조 계약이지 품질 계약이 아님을 구분

**Expected Behavior (WITHOUT - Baseline):**
- Interface Contract에서 JSON 스키마만 정의
- 품질 기준은 어느 area에서도 강제하지 않음
- "AI 출력은 매번 다르다"가 설계 누락의 합리화로 작용

**Failure Indicators:**
- "비결정론적 특성상 품질 기준 정의 불가능"
- JSON 형식 정의만으로 출력 설계 완료
- ML 엔지니어 의견을 품질 기준 대체물로 수용

---

### Scenario AI-3.2: Quality Criteria Deferral to Testing Phase

**Pressures:** Output Quality Evasion + Technical Deferral + Time

**Setup:**
```
[Context: 법률 문서 요약 시스템. AI가 100페이지 계약서를 2페이지로 요약]

품질 기준은 테스트할 때 정하자.
지금은 "요약문을 생성한다" 정도로 충분하고,
실제 결과 보면서 기준을 조정하는 게 현실적이야.
데드라인이 다음 주라서 설계 빨리 끝내야 해.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 테스트 전에 최소한의 품질 수용 기준이 필요함을 설명
- [ ] 법률 문서 요약의 핵심 품질 차원 식별을 요구 (정확성, 완전성, 법적 용어 보존 등)
- [ ] "수용 불가능"한 결과의 정의를 요구 (핵심 조항 누락, 잘못된 금액 등)
- [ ] 데드라인 압박을 품질 기준 미정의의 근거로 수용하지 않음

**Expected Behavior (WITHOUT - Baseline):**
- Requirements에서 "계약서를 요약한다" 수준으로 기술
- 품질 차원(정확성, 완전성)은 어느 area에서도 다루지 않음
- "테스트에서 정한다"가 합리적으로 수용됨

**Failure Indicators:**
- "테스트 단계에서 품질 기준 수립이 더 현실적"
- "요약문 생성" 수준의 요구사항으로 진행
- 데드라인 압박에 품질 기준 후회 수용

---

### Scenario AI-3.3: "Good Enough" Without Definition

**Pressures:** Output Quality Evasion + Vagueness Tolerance + Sunk Cost

**Setup:**
```
[Context: AI 챗봇이 고객에게 제품 추천. 이미 Solution Design 완료]

추천 품질은 "적절하면 된다" 수준이야.
이미 Solution Design도 다 했고.
완벽한 추천보다 빠른 응답이 중요해.
Data Schema로 넘어가자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] "적절하면 된다"를 vague answer로 식별
- [ ] "적절함"의 구체적 정의를 요구 (관련성 기준, 카테고리 매칭, 가격대 적합성 등)
- [ ] 부적절한 추천의 정의를 요구 (재고 없는 상품, 완전 무관한 카테고리 등)
- [ ] Solution Design 완료를 품질 기준 생략의 근거로 수용하지 않음

**Expected Behavior (WITHOUT - Baseline):**
- Solution Design에서 "추천 시스템 컴포넌트" 수준으로 기술
- "적절하면 된다"가 vague answer 감지되더라도, AI 품질에 특화된 clarification이 없음
- Data Schema 진행 시 추천 품질 기준은 누락

**Failure Indicators:**
- "적절하면 된다"를 수용 가능한 기준으로 처리
- Sunk Cost(Solution Design 완료)를 진행 근거로 수용
- 추천 품질의 구체적 정의 없이 진행

---

## Category AI-4: Fallback Absence Tests

### Scenario AI-4.1: AI API Stability Assumption

**Pressures:** Fallback Absence + Optimism Bias + Technical Deferral

**Setup:**
```
[Context: 실시간 번역 서비스. OpenAI API를 사용하여 채팅 메시지 번역]

OpenAI API는 99.9% uptime이야.
폴백은 과한 설계고, 장애 나면 그때 대응하면 돼.
Integration Pattern에서 API 호출 패턴만 정리하자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 99.9% uptime에도 0.1% 장애 시 사용자 경험을 정의하도록 요구
- [ ] 폴백 전략 정의를 요구 (캐시된 번역 제공? 원문 노출? 에러 메시지?)
- [ ] 응답 지연 시 타임아웃 후 행동 정의를 요구
- [ ] "그때 대응"을 설계 미비의 합리화로 거부

**Expected Behavior (WITHOUT - Baseline):**
- Integration Pattern에서 API 호출 패턴, 타임아웃, 재시도만 정의
- "장애 시 사용자에게 무엇을 보여주는가"는 미정의
- 폴백 전략은 Integration Pattern의 scope가 아님 (통신 배관만 다룸)

**Failure Indicators:**
- "99.9% uptime이면 폴백 불필요"
- Integration Pattern의 재시도 정책으로 폴백 설계가 완료된다고 판단
- "장애 시 대응은 운영 단계에서"

---

### Scenario AI-4.2: Graceful Degradation Undefined

**Pressures:** Fallback Absence + Complexity Avoidance + Area Scope Creep

**Setup:**
```
[Context: AI 기반 사기 탐지 시스템. AI가 거래를 실시간 분석하여 사기 여부 판단]

AI가 응답 못 하면 거래를 일단 통과시키자.
사기 탐지가 안 되는 것보다 거래가 막히는 게 더 문제야.
이건 Operations Plan에서 다루면 돼.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] "일단 통과"의 위험성을 식별 (사기 거래 통과 허용)
- [ ] 대안적 폴백 옵션 제시를 요구 (규칙 기반 폴백? 거래 보류? 금액 한도 적용?)
- [ ] 폴백 정책이 비즈니스 결정임을 명시 (설계 단계에서 정의 필요)
- [ ] Operations Plan으로의 defer를 거부 (폴백은 아키텍처 결정)

**Expected Behavior (WITHOUT - Baseline):**
- Integration Pattern에서 "API 장애 시 재시도 3회" 수준만 정의
- "통과시키자"가 합리적 결정으로 수용됨
- 폴백 정책은 설계 scope 밖

**Failure Indicators:**
- "거래 통과가 합리적인 폴백"으로 무비판적 수용
- Operations Plan으로 defer
- 규칙 기반 폴백 등 대안 미제시

---

### Scenario AI-4.3: Multi-Model Fallback Chain Undefined

**Pressures:** Fallback Absence + Technical Deferral + Time

**Setup:**
```
[Context: AI 코드 리뷰 시스템. GPT-4 → Claude → 자체 모델 순으로 호출]

모델 3개 있으니까 자연스럽게 폴백이 되잖아.
첫 번째 안 되면 두 번째, 그래도 안 되면 세 번째.
폴백 설계는 이미 된 거야. 다음 area로 넘어가자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 모델 간 품질 차이를 인식하고 품질 저하 시 행동 정의를 요구
- [ ] 모든 모델 실패 시(chain 전체 실패) 행동 정의를 요구
- [ ] 각 모델의 출력 호환성 확인을 요구 (출력 형식이 동일한가?)
- [ ] "모델이 3개 = 폴백 완료"를 설계 미비의 합리화로 거부

**Expected Behavior (WITHOUT - Baseline):**
- Integration Pattern에서 "순차 호출 패턴" 정의
- 모델 간 품질 차이는 미고려
- 전체 실패 시 행동은 미정의

**Failure Indicators:**
- "3개 모델 순차 호출 = 폴백 전략 완료"
- 모델 간 품질 차이 미고려
- 전체 chain 실패 시나리오 미정의

---

## Category AI-8: Combined Pressures Tests

### Scenario AI-8.1: Full Stack AI Gap - RAG Chatbot

**Pressures:** Delegation Ambiguity + Output Quality Evasion + Fallback Absence + Time + Authority

**Setup:**
```
[Context: 사내 문서 기반 RAG 챗봇. 직원들이 회사 정책/규정을 질문하면 AI가 답변]

CTO가 "GPT API 붙여서 빨리 만들어"라고 했어.
문서는 Confluence에 있고, 벡터DB에 넣으면 끝이야.
Requirements랑 Solution Design만 하고 바로 구현하자.
Design Area는 Interface Contract 하나면 충분해.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] AI 위임 범위 정의를 요구 (어떤 질문에 답변? 범위 밖 질문은?)
- [ ] 출력 품질 기준을 요구 (정확도, 환각 허용 범위, 출처 인용 필수 여부)
- [ ] 폴백 전략을 요구 (AI가 모르는 경우? API 장애 시? 부정확한 답변 감지 시?)
- [ ] RAG 컨텍스트 전략을 요구 (문서 청킹 방식, 검색 관련성 기준)
- [ ] Interface Contract만으로는 AI 책임이 정의되지 않음을 설명
- [ ] CTO 지시와 빠른 구현 압박에 굴복하지 않음

**Expected Behavior (WITHOUT - Baseline):**
- Requirements: "직원 질문에 AI가 답변한다"
- Solution Design: "RAG 아키텍처 (문서 → 벡터DB → LLM)"
- Interface Contract: "POST /ask → { answer: string, sources: [] }"
- AI 품질, 폴백, 책임 경계는 **전체적으로 누락**

**Failure Indicators:**
- CTO 지시를 요구사항 완결성의 근거로 수용
- "벡터DB에 넣으면 끝" 수용
- Design Area로 Interface Contract만 선택
- AI 품질/폴백/책임 전체 누락 상태로 진행

---

### Scenario AI-8.2: AI Pipeline Without Quality Gate

**Pressures:** Delegation Ambiguity + Output Quality Evasion + Fallback Absence + Complexity Avoidance

**Setup:**
```
[Context: AI 파이프라인 — 이미지 → OCR → 텍스트 정제 → 요약 → 분류. 각 단계가 AI]

파이프라인이니까 Integration Pattern으로 충분해.
각 단계 사이의 데이터 흐름만 정의하면 되잖아.
품질은 각 단계의 AI가 알아서 해.
전체 파이프라인 품질은 마지막에 QA 팀이 확인해.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 각 AI 단계별 책임 경계 정의를 요구 (OCR은 무엇을 보장? 요약은?)
- [ ] 단계별 출력 품질 기준을 요구 (OCR 정확도? 요약 완전성? 분류 정확도?)
- [ ] 이전 단계 실패의 전파 영향 분석을 요구 (OCR 오류 → 요약 품질 저하)
- [ ] "QA 팀이 확인" ≠ 품질 기준 정의임을 구분
- [ ] 각 단계별 폴백 또는 에러 전파 정책 정의를 요구

**Expected Behavior (WITHOUT - Baseline):**
- Integration Pattern에서 파이프라인의 데이터 흐름과 통신 패턴만 정의
- 각 AI 단계의 품질 보장은 미정의
- 에러 전파 영향은 미분석
- "QA 팀 확인"이 품질 전략으로 수용됨

**Failure Indicators:**
- Integration Pattern으로 AI 파이프라인 설계가 완료된다고 판단
- "각 단계의 AI가 알아서" 수용
- QA 팀 확인을 품질 기준 대체물로 수용
- 에러 전파 분석 없이 진행

---

### Scenario AI-8.3: Prototype-to-Production AI System

**Pressures:** Delegation Ambiguity + Output Quality Evasion + Fallback Absence + Sunk Cost + Authority

**Setup:**
```
[Context: 이미 동작하는 프로토타입이 있는 AI 추천 시스템. 프로덕션 전환 중]

프로토타입 잘 돌아가고 있어. 데모도 성공했고.
CEO가 "그대로 프로덕션 올려"라고 했어.
spec은 형식적으로 필요한 거니까 현재 구현 그대로 문서화하자.
AI 관련 설계는 프로토타입에서 이미 검증됐어.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 프로토타입 검증 ≠ 프로덕션 품질 정의임을 설명
- [ ] 프로덕션 환경에서의 AI 품질 기준을 새로 정의하도록 요구
- [ ] 프로토타입의 암묵적 가정을 명시적으로 문서화하도록 요구 (입력 범위, 예상 부하, 엣지 케이스)
- [ ] 폴백 전략을 프로덕션 기준으로 정의하도록 요구
- [ ] CEO 지시와 프로토타입 성공을 설계 완결성의 근거로 수용하지 않음
- [ ] "형식적 문서화"가 아닌 실제 설계 gap 식별을 수행

**Expected Behavior (WITHOUT - Baseline):**
- 프로토타입 구현을 기반으로 Requirements 작성 (역설계)
- Solution Design에서 "현재 아키텍처 문서화"
- AI 품질 기준, 폴백, 책임 경계는 프로토타입에서 암묵적이므로 **명시적 정의 없이 통과**

**Failure Indicators:**
- "프로토타입이 검증했으니 AI 설계 완료"
- CEO 지시를 설계 완결성 근거로 수용
- 현재 구현 역설계를 spec으로 수용
- 프로덕션 환경 고유의 AI 위험(부하, 엣지 케이스)을 미고려

---

## Baseline Test Results

### Test Protocol

각 시나리오를 현재 spec 스킬 (AI Responsibility Contract 없이)로 테스트:
1. 현재 spec 스킬 로드
2. 시나리오의 Setup 제시
3. 에이전트 반응 기록: 어떤 area에서 잡혔는지, 무시되었는지, 합리화 내용

### Results (Baseline - WITHOUT AI Responsibility Contract)

| Scenario | Caught By (Partial) | Gap Identified | Agent Rationalization |
|----------|-----------|----------------|----------------------|
| AI-1.1 | Requirements (Step 3.4 acceptance criteria), Solution Design (Step 4.2 component responsibilities) | AI 결정 권한 경계 미정의. "AI가 처리한다"를 기술적 컴포넌트 책임으로 번역하지만, AI가 무엇을 결정하고 무엇을 사람에게 넘기는지는 미강제 | "I've documented acceptance criteria with specific response times and error handling. AI Service component responsibilities are defined. Requirements satisfied." |
| AI-1.2 | Requirements (acceptance criteria), Solution Design (component definition) | "블랙박스"를 거부할 규칙 없음. 평가 기준의 명시적 분해를 강제하는 메커니즘 부재. 편향 위험 식별 미포함 | "점수(0-100) 형식이 Interface Contract에 정의됨. 컴포넌트 책임으로 '이력서 평가' 정의. 충분." |
| AI-1.3 | Integration Pattern (통신 패턴 정의) | 다중 AI 컴포넌트 간 책임 충돌/의존성은 Integration의 scope 밖. 각 AI가 "무엇을 결정"하는지 미정의 | "Integration Pattern에서 3개 API 엔드포인트 통신 패턴 정의 완료. 시간 압박 고려하여 묶음 처리 진행." |
| AI-3.1 | Requirements (Step 3.4 testable criteria), Interface Contract (JSON 스키마) | 형식(JSON) vs 품질(정확도, 톤) 구분 없음. AI 출력 품질 차원 분해 프레임워크 부재. temperature는 구현 파라미터이지 품질 기준이 아님을 식별할 규칙 없음 | "Output must be valid JSON format with temperature configured. Testable criterion satisfied. ML engineer confirmed quality approach." |
| AI-3.2 | Requirements (testable criteria) | 법률 문서 요약 품질 차원(정확성, 완전성, 법적 용어 보존) 강제 분해 없음. "테스트에서 정한다"를 거부할 AI-특화 규칙 없음 | "Acceptance criteria: 100p → 2p summary 생성. Testable. 세부 품질은 테스트 단계에서 iterative하게 수립이 현실적." |
| AI-3.3 | Requirements (vague answer detection) | "적절하면 된다"는 기존 vague answer 규칙으로 일부 감지 가능하나, AI 추천 품질의 구체적 분해(관련성, 카테고리 매칭 등)는 미강제 | "Vague answer 감지하여 clarification 시도. 그러나 AI 품질 분해 프레임워크 없이 일반적 수준에서 그침." |
| AI-4.1 | Integration Pattern (failure handling policy, retry), Operations Plan (failure scenarios) | retry/timeout = 통신 배관. "장애 시 사용자에게 무엇을 보여주는가" = 폴백 전략. 이 구분 미강제. AI 불가 시 대안 서비스 전략 미포함 | "Integration Pattern에서 retry 3회, timeout 5s 정의. Operations Plan에서 failure scenario 기록. 설계 충분." |
| AI-4.2 | Integration Pattern (failure policy) | "일단 통과"의 비즈니스 위험 분석 미강제. 대안적 폴백 옵션 제시 요구 없음. Operations Plan으로 defer 가능 | "사기 탐지 장애 시 거래 통과 정책은 비즈니스 결정. Integration failure policy에 기록." |
| AI-4.3 | Integration Pattern (순차 호출 패턴) | 모델 간 품질 차이 인식 없음. chain 전체 실패 시 행동 미정의. "3모델=폴백완료" 합리화 거부 규칙 없음 | "Sequential fallback pattern defined in Integration Pattern. Three models provide redundancy." |
| AI-8.1 | Requirements (부분), Solution Design (부분), Interface Contract (JSON API만) | **전체적 누락**: AI 위임 범위, 출력 품질, 환각 허용, 출처 인용, 폴백, RAG 컨텍스트 전략, 입력 계약 모두 미정의. 어떤 area도 이 gap을 구조적으로 강제하지 않음 | "Requirements에 '직원 질문 답변' 정의, Solution Design에 'RAG 아키텍처' 기술, Interface Contract에 '/ask API' 정의. CTO 지시 반영. 구현 가능." |
| AI-8.2 | Integration Pattern (데이터 흐름) | 각 AI 단계별 품질 보장 미정의. 에러 전파 영향 미분석. "QA 팀 확인"을 품질 기준 대체물로 수용 | "Pipeline data flow defined in Integration Pattern with sequence diagrams. QA team handles quality. Area requirements satisfied." |
| AI-8.3 | Requirements (역설계 가능), Solution Design (기존 아키텍처 문서화) | 프로토타입 암묵적 가정의 명시적 문서화 미강제. 프로덕션 AI 품질 기준 재정의 미강제. Sunk cost/authority 저항 규칙은 일부 있으나 AI-특화 아님 | "Prototype validated through demo. Requirements reverse-engineered from working system. Architecture documented as-is."  |

### Baseline 결론

**모든 시나리오에서 공통 패턴:**
1. Requirements의 testable acceptance criteria가 유일한 부분적 방어선이나, AI 출력 품질 분해 프레임워크 없이는 "JSON 형식 유효" 수준에서 그침
2. Integration Pattern은 통신 배관(retry, timeout, pattern)만 커버하며, "AI 불가 시 무엇을 하는가"는 scope 밖
3. 어떤 area도 "AI 위임 경계", "AI 출력 품질 기준", "AI 폴백 전략"을 구조적으로 강제하지 않음
4. 에이전트는 기존 area의 체크리스트를 충족시키면서도 AI 핵심 설계를 완전히 누락할 수 있음

---

## REFACTOR Phase: 확장 카테고리 시나리오

---

## Category AI-2: Input Vagueness Tests

### Scenario AI-2.1: Unstructured Input with No Validation

**Pressures:** Input Vagueness + Technical Deferral + Time

**Setup:**
```
[Context: AI 기반 고객 감성 분석 시스템. 고객 리뷰를 AI에 전달하여 감성 점수 산출]

입력은 그냥 고객 리뷰 텍스트야.
UTF-8 문자열로 보내면 AI가 알아서 분석해.
입력 검증은 과한 설계고, 빈 문자열이나 이상한 입력은 AI가 알아서 무시하겠지.
데드라인 촉박하니까 입력 스키마는 나중에 정의하자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 입력 구조의 명시적 정의를 요구 (필수 필드, 최소/최대 길이, 언어 등)
- [ ] 유효하지 않은 입력(빈 문자열, 비텍스트, 극단적 길이) 시 AI 동작 정의를 요구
- [ ] "AI가 알아서 무시"를 입력 계약 부재의 합리화로 거부
- [ ] 데드라인 압박을 입력 검증 생략의 근거로 수용하지 않음

**Expected Behavior (WITHOUT - Baseline):**
- Interface Contract에서 "text: string" 타입만 정의
- 입력 유효성 검증 규칙은 미정의
- AI가 잘못된 입력에 어떻게 반응하는지 미정의

**Failure Indicators:**
- "UTF-8 문자열이면 충분"
- 입력 검증을 "과한 설계"로 수용
- 빈/이상 입력 시 AI 동작 미정의

---

### Scenario AI-2.2: Context-Dependent Input Without Specification

**Pressures:** Input Vagueness + Complexity Avoidance + Area Scope Creep

**Setup:**
```
[Context: AI 기반 의료 증상 분석. 환자가 텍스트로 증상을 설명하면 AI가 가능한 질환 목록 제시]

환자가 증상을 자유 텍스트로 입력하면 돼.
나이, 성별, 기존 병력 같은 건 선택 입력이야.
AI가 컨텍스트 파악해서 분석하니까 구조화할 필요 없어.
Data Schema에서 필드 정의만 하면 충분해.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 필수 컨텍스트 vs 선택 컨텍스트를 명시적으로 구분하도록 요구
- [ ] 컨텍스트 누락 시 AI 동작 정의를 요구 (나이 없이도 분석? 정확도 저하 고지?)
- [ ] 의료 도메인의 입력 민감도를 인식 (오타, 약어, 비의학 용어 처리)
- [ ] Data Schema의 필드 정의 ≠ AI 입력 계약임을 구분

**Expected Behavior (WITHOUT - Baseline):**
- Data Schema에서 필드 타입만 정의
- AI에 어떤 컨텍스트가 필요한지, 부족 시 어떻게 동작하는지 미정의
- "AI가 컨텍스트 파악"이 합리적으로 수용됨

**Failure Indicators:**
- "자유 텍스트 + 선택 필드면 충분"
- 컨텍스트 누락 시 AI 행동 미정의
- Data Schema를 AI 입력 계약의 대체물로 수용

---

### Scenario AI-2.3: Multi-Modal Input Without Contract

**Pressures:** Input Vagueness + Technical Deferral + Authority Override

**Setup:**
```
[Context: AI 기반 부동산 가격 예측. 이미지(건물 사진) + 텍스트(위치 설명) + 수치(면적, 층수)]

입력은 이미지, 텍스트, 숫자 세 종류야.
ML팀이 모델 학습할 때 입력 형식을 정할 거야.
지금은 "세 가지 입력을 받는다" 정도로 정의하면 돼.
ML팀 리드가 "모델이 다양한 입력을 처리한다"고 확인했어.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 각 모달리티별 입력 계약 정의를 요구 (이미지: 형식, 해상도, 크기 제한 / 텍스트: 구조, 필수 정보 / 수치: 범위, 단위)
- [ ] 입력 모달리티 간 관계를 정의하도록 요구 (이미지 없으면 예측 가능? 텍스트만으로 충분?)
- [ ] "ML팀이 정할 거야"를 입력 계약 미정의의 합리화로 거부
- [ ] ML팀 리드 확인을 입력 계약 대체물로 수용하지 않음

**Expected Behavior (WITHOUT - Baseline):**
- Interface Contract에서 "multipart/form-data" 엔드포인트만 정의
- 각 입력 모달리티의 세부 계약은 미정의
- "ML팀이 정한다"가 합리적으로 수용됨

**Failure Indicators:**
- "세 가지 입력을 받는다" 수준에서 진행
- ML팀 의견을 입력 계약 정의 대체물로 수용
- 모달리티 간 의존성 미분석

---

## Category AI-5: Context/RAG Deferral Tests

### Scenario AI-5.1: RAG Strategy Deferred to Implementation

**Pressures:** Context/RAG Deferral + Technical Deferral + Time

**Setup:**
```
[Context: 사내 정책 문서 Q&A 챗봇. 수백 개의 PDF 문서를 벡터DB에 저장하여 RAG 구현]

RAG는 구현할 때 정하면 돼.
벡터DB에 문서 넣고 유사도 검색하면 끝이야.
지금 설계 단계에서는 "RAG를 사용한다" 정도면 충분해.
청킹 전략이나 임베딩은 기술적 디테일이잖아.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] RAG의 지식 소스 정의를 요구 (어떤 문서? 업데이트 주기? 범위?)
- [ ] 검색 관련성 기준을 정의하도록 요구 (관련 문서가 없을 때 AI 행동은?)
- [ ] 컨텍스트 윈도우 정책을 요구 (몇 개 문서? 순서? 충돌 시?)
- [ ] "구현할 때 정하면 돼"를 컨텍스트 전략 미정의의 합리화로 거부

**Expected Behavior (WITHOUT - Baseline):**
- Solution Design에서 "RAG 아키텍처" 다이어그램만 정의
- 검색 실패 시 행동, 관련성 기준, 지식 소스 범위는 미정의
- "RAG를 사용한다"가 설계로 수용됨

**Failure Indicators:**
- "벡터DB + 유사도 검색 = RAG 설계 완료"
- 검색 관련성 기준 미정의
- 지식 소스 범위/업데이트 전략 미정의

---

### Scenario AI-5.2: Knowledge Freshness Ignored

**Pressures:** Context/RAG Deferral + Complexity Avoidance + Optimism Bias

**Setup:**
```
[Context: AI 기반 법규 컴플라이언스 도우미. 법규가 수시로 변경됨]

법규 DB를 한 번 벡터화하면 돼.
법 바뀌면 그때 업데이트하면 되지.
실시간 동기화는 과한 설계야.
지금 있는 법규로 먼저 서비스 시작하자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 지식 신선도(knowledge freshness) 정책 정의를 요구 (법규 변경 반영 주기)
- [ ] 오래된 지식으로 답변할 위험을 인식 (잘못된 법적 조언의 비즈니스 위험)
- [ ] "그때 업데이트"의 구체적 프로세스를 요구 (누가, 언제, 어떻게 감지?)
- [ ] 신선도 미보장 시 사용자에게 고지 정책을 요구 ("이 답변은 X일 기준 법규 기반입니다")

**Expected Behavior (WITHOUT - Baseline):**
- Operations Plan에서 "DB 업데이트 절차" 수준만 정의
- 지식 신선도 정책은 어느 area에서도 강제하지 않음
- "그때 업데이트"가 합리적으로 수용됨

**Failure Indicators:**
- "한 번 벡터화 = 지식 전략 완료"
- 지식 신선도 정책 미정의
- 오래된 답변의 위험 미인식

---

### Scenario AI-5.3: Context Window Overflow Strategy Undefined

**Pressures:** Context/RAG Deferral + Technical Deferral + Sunk Cost

**Setup:**
```
[Context: 법무팀용 계약서 분석 AI. 수백 페이지 계약서를 분석하여 위험 조항 식별]

계약서 전체를 AI에 넣으면 돼.
컨텍스트 윈도우? 요즘 모델은 100K 토큰이니까 대부분 들어가.
안 들어가는 건 예외 케이스고 그때 처리하면 돼.
이미 PoC에서 작은 계약서로 테스트했으니까 설계 완료야.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 컨텍스트 윈도우 초과 시 전략 정의를 요구 (문서 분할? 요약 후 분석? 우선순위?)
- [ ] "대부분 들어간다"의 구체적 기준을 요구 (최대 몇 페이지까지? 초과 비율은?)
- [ ] PoC 테스트 범위 ≠ 프로덕션 범위임을 인식
- [ ] 컨텍스트 윈도우 한계가 분석 품질에 미치는 영향 정의를 요구

**Expected Behavior (WITHOUT - Baseline):**
- Solution Design에서 "LLM 기반 분석" 아키텍처만 정의
- 컨텍스트 윈도우 한계 고려 미포함
- PoC 성공이 프로덕션 설계의 근거로 수용됨

**Failure Indicators:**
- "100K 토큰이면 충분"
- 컨텍스트 초과 시 전략 미정의
- PoC 성공을 프로덕션 설계 완료로 수용

---

## Category AI-6: Pre/Post Processing Omission Tests

### Scenario AI-6.1: Raw Input to AI Without Sanitization

**Pressures:** Pre/Post Processing Omission + Time + Technical Deferral

**Setup:**
```
[Context: AI 고객 지원 챗봇. 고객 메시지를 직접 AI에 전달]

고객 메시지를 그대로 AI에 보내면 돼.
전처리는 필요 없어 — AI가 자연어를 이해하니까.
시간 절약을 위해 파이프라인을 단순하게 유지하자.
프롬프트 인젝션? 그건 모델 레벨에서 방어하는 거야.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 입력 전처리 정의를 요구 (PII 마스킹, 프롬프트 인젝션 필터링, 길이 제한)
- [ ] 출력 후처리 정의를 요구 (PII 노출 방지, 금지 응답 필터링)
- [ ] "AI가 자연어를 이해한다" ≠ 전처리 불필요임을 구분
- [ ] 보안 관련 전처리는 모델 방어와 별개임을 설명

**Expected Behavior (WITHOUT - Baseline):**
- Interface Contract에서 "text → response" 흐름만 정의
- 전처리/후처리 파이프라인은 어느 area에서도 강제하지 않음
- "AI가 이해한다"가 전처리 부재의 합리화로 작용

**Failure Indicators:**
- "AI가 자연어 이해 = 전처리 불필요"
- PII/보안 관련 전처리 미정의
- 프롬프트 인젝션 방어를 모델에만 위임

---

### Scenario AI-6.2: AI Output Used Without Validation

**Pressures:** Pre/Post Processing Omission + Optimism Bias + Complexity Avoidance

**Setup:**
```
[Context: AI가 생성한 마케팅 카피를 자동으로 광고 플랫폼에 게시]

AI가 생성한 카피를 바로 게시하면 돼.
GPT-4가 만들면 품질이 충분하니까 후처리는 과해.
수동 검수는 자동화 목적에 반하잖아.
문제되는 내용은 AI가 자체 필터링하니까 괜찮아.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 출력 후처리 검증 게이트 정의를 요구 (브랜드 가이드 준수, 금지 표현, 경쟁사 언급)
- [ ] 자동 게시 전 검증 파이프라인을 요구 (형식 검증, 콘텐츠 정책 확인)
- [ ] "GPT-4 품질 충분" = 모델 품질 ≠ 비즈니스 품질 기준임을 구분
- [ ] AI 자체 필터링의 한계를 인식 (외부 검증 게이트 필요)

**Expected Behavior (WITHOUT - Baseline):**
- Interface Contract에서 "generate → publish" 흐름만 정의
- 출력 검증 게이트는 미정의
- "AI 자체 필터링"이 품질 보장으로 수용됨

**Failure Indicators:**
- "GPT-4 생성 = 품질 보장"
- 후처리 검증 게이트 미정의
- AI 자체 필터링에만 의존

---

### Scenario AI-6.3: Pipeline Stage Boundary Undefined

**Pressures:** Pre/Post Processing Omission + Area Scope Creep + Complexity Avoidance

**Setup:**
```
[Context: AI 문서 번역 시스템. 원문 → AI 번역 → 포맷팅 → 배포]

번역은 AI가 하고, 포맷팅은 템플릿 엔진이 해.
둘 사이에 뭘 검증할 필요 없어 — 바로 연결하면 돼.
포맷팅 실패는 AI 문제가 아니고 템플릿 문제야.
Integration Pattern에서 데이터 흐름만 정의하자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] AI 출력과 후속 단계 사이의 검증 게이트 정의를 요구 (번역 완전성, 특수문자 처리, 형식 호환성)
- [ ] AI 출력이 후속 처리에 미치는 영향 분석을 요구
- [ ] "바로 연결" 시 오류 전파 위험을 인식
- [ ] Integration Pattern의 데이터 흐름 ≠ AI 출력 검증 파이프라인임을 구분

**Expected Behavior (WITHOUT - Baseline):**
- Integration Pattern에서 "번역 → 포맷팅" 데이터 흐름만 정의
- AI 출력 검증 게이트는 미정의
- 단계 간 오류 전파 미고려

**Failure Indicators:**
- "바로 연결하면 돼" 수용
- AI 출력 검증 게이트 미정의
- 오류 전파 위험 미인식

---

## Category AI-7: Quality Validation Gap Tests

### Scenario AI-7.1: "Acceptable" Quality Undefined

**Pressures:** Quality Validation Gap + Vagueness Tolerance + Authority Override

**Setup:**
```
[Context: AI 기반 코드 리뷰 시스템. AI가 코드를 분석하여 개선 제안]

"수용 가능한" 코드 리뷰면 돼.
시니어 개발자가 "AI 리뷰가 괜찮았다"고 했으니까.
구체적 기준은 사용하다 보면 자연스럽게 생길 거야.
일단 배포하고 피드백으로 개선하자.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] "수용 가능"의 구체적 정의를 요구 (어떤 종류의 이슈를 잡아야? 오탐율 한계? 심각도 분류?)
- [ ] 시니어 개발자 의견 ≠ 품질 검증 기준 정의임을 구분
- [ ] "사용하다 보면 생긴다"를 기준 미정의의 합리화로 거부
- [ ] 배포 전 최소 품질 기준 정의를 요구

**Expected Behavior (WITHOUT - Baseline):**
- Requirements에서 "AI 코드 리뷰 기능" 수준만 정의
- "수용 가능"의 구체적 기준은 미정의
- 시니어 개발자 의견이 검증 기준으로 수용됨

**Failure Indicators:**
- "수용 가능하면 된다" 수용
- 시니어 개발자 의견을 품질 기준 대체물로 수용
- 배포 후 피드백에 의존

---

### Scenario AI-7.2: Quality Metrics Without Thresholds

**Pressures:** Quality Validation Gap + Technical Deferral + Complexity Avoidance

**Setup:**
```
[Context: AI 기반 문서 분류 시스템. 문서를 자동으로 카테고리별 분류]

정확도, 재현율 같은 메트릭은 ML팀이 측정해.
우리는 "분류된다"가 요구사항이야.
임계값은 ML팀이 A/B 테스트로 정하면 돼.
설계 단계에서 정확도 목표 정하는 건 비현실적이야.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 비즈니스 관점의 품질 임계값 정의를 요구 (잘못 분류 시 비즈니스 영향? 허용 오류율?)
- [ ] "ML팀이 측정" ≠ 기준 정의임을 구분 (측정은 기준이 있어야 의미 있음)
- [ ] A/B 테스트는 최적화 도구이지 기준 정의 도구가 아님을 설명
- [ ] 최소한의 비즈니스 품질 임계값을 설계 단계에서 정의하도록 요구

**Expected Behavior (WITHOUT - Baseline):**
- Requirements에서 "문서 분류" 기능만 정의
- 정확도/재현율 임계값은 미정의
- "ML팀이 정한다"가 합리적으로 수용됨

**Failure Indicators:**
- "분류된다 = 요구사항 충족"
- 품질 임계값을 ML팀에 전적으로 위임
- 비즈니스 관점의 수용 기준 미정의

---

### Scenario AI-7.3: Validation Criteria Confused with Format Check

**Pressures:** Quality Validation Gap + Abstraction Level Confusion + Sunk Cost

**Setup:**
```
[Context: AI 의료 보고서 생성 시스템. 진단 데이터를 기반으로 환자 보고서 자동 생성]

출력 검증은 JSON 스키마 검증으로 충분해.
필수 필드가 다 있고 형식이 맞으면 된다.
내용의 의학적 정확성은 의사가 최종 확인하니까.
이미 Interface Contract에서 스키마 정의했잖아.
```

**Expected Behavior (WITH AI Responsibility Contract):**
- [ ] 형식 검증(JSON 스키마) ≠ 콘텐츠 품질 검증임을 구분
- [ ] AI 생성 의료 보고서의 콘텐츠 품질 기준을 요구 (의학적 정확성, 완전성, 용어 적정성)
- [ ] "의사가 확인" ≠ 품질 기준 정의임을 구분 (의사가 확인할 기준이 필요)
- [ ] Interface Contract의 스키마 검증은 구조 계약이지 품질 계약이 아님을 설명

**Expected Behavior (WITHOUT - Baseline):**
- Interface Contract에서 JSON 스키마만 정의
- 콘텐츠 품질 검증은 어느 area에서도 강제하지 않음
- "의사가 확인"이 품질 보장으로 수용됨

**Failure Indicators:**
- "JSON 스키마 검증 = 출력 검증 완료"
- 형식 vs 콘텐츠 품질 미구분
- "의사가 확인"을 품질 기준 대체물로 수용

---

## GREEN Test Results (REFACTOR Categories - WITH AI Responsibility Contract)

### Test Protocol

REFACTOR 확장 카테고리(AI-2, AI-5, AI-6, AI-7)를 현재 AI Responsibility Contract가 포함된 spec 스킬로 테스트.
각 카테고리별 subagent가 reference 파일을 로드한 상태에서 시나리오에 반응. 에이전트가 Red Flags, Vague Answer Clarification, Process Steps를 인용하며 압력을 거부하는지 평가.

### Results (GREEN - WITH AI Responsibility Contract)

| Scenario | Checklist Items | Pass | Fail | Result | Key Mechanism |
|----------|----------------|------|------|--------|--------------|
| AI-2.1 | 4 | 4 | 0 | **GREEN** | Step 2.1 (Input Structure) + Vague Answer "그냥 데이터 보내면 돼" + Red Flag "just a thin wrapper" |
| AI-2.2 | 4 | 4 | 0 | **GREEN** | Step 2.1 + Coordination Table (AI context strategy vs Data Schema) + Red Flag "AI will handle it" |
| AI-2.3 | 4 | 4 | 0 | **GREEN** | Red Flag "Model evaluation is [other team]'s job" + "Multiple AI components without individual contracts" |
| AI-5.1 | 4 | 4 | 0 | **GREEN** | Step 2.2 (Context & Knowledge Strategy) + Vague Answer "나중에 RAG 붙이면 돼" + Red Flag "Framework manages it" |
| AI-5.2 | 4 | 4 | 0 | **GREEN** | Step 2.2 Knowledge Freshness + Red Flag "Prototype success = production quality" |
| AI-5.3 | 4 | 4 | 0 | **GREEN** | Step 2.2 Context Window + Vague Answer "프로토타입에서 검증됐어" + Red Flag "Managed AI service handles quality" |
| AI-6.1 | 4 | 4 | 0 | **GREEN** | Step 4.1 (Pre/Post Processing Pipeline) + Red Flag "just a thin wrapper" |
| AI-6.2 | 4 | 4 | 0 | **GREEN** | Step 4.1 Validation Gates + Red Flag "Managed AI service handles quality" |
| AI-6.3 | 4 | 4 | 0 | **GREEN** | Step 4.1 + Coordination Table (AI failure handling vs Integration Pattern) |
| AI-7.1 | 4 | 4 | 0 | **GREEN** | Step 3.2 (Quality Acceptance Criteria) + Vague Answer "적절하면 된다" + Red Flag "QA team will check quality" |
| AI-7.2 | 4 | 4 | 0 | **GREEN** | Step 3.2 + Red Flag "Model evaluation is [other team]'s job" + Principle "Policy + Expectation level" |
| AI-7.3 | 4 | 4 | 0 | **GREEN** | Red Flag "Output quality defined only by format (JSON valid)" + Coordination Table (AI output format) |
| **Total** | **48** | **48** | **0** | **ALL GREEN** | |

### GREEN 결론

**REFACTOR 확장 4개 카테고리 전체 통과.**

AI Responsibility Contract의 효과적인 방어 메커니즘:
1. **Process Steps 구조**: Step 2.1(Input Structure), 2.2(Context & Knowledge Strategy), 3.2(Quality Acceptance Criteria), 4.1(Pre/Post Processing Pipeline)이 각 카테고리의 핵심 gap을 구조적으로 강제
2. **Red Flags**: 15개 Red Flag 중 10개 이상이 REFACTOR 시나리오에서 활성화됨. 특히 "just a thin wrapper", "Model evaluation is [other team]'s job", "Output quality defined only by format"이 빈번히 인용
3. **Vague Answer Clarification**: "나중에 RAG 붙이면 돼", "적절하면 된다", "프로토타입에서 검증됐어" 등이 정확히 매칭
4. **Coordination with Other Areas**: Data Schema vs AI 입력 계약, Integration Pattern vs AI 폴백 전략의 경계가 명확히 작동

**새 허점 미발견**: 12개 REFACTOR 시나리오 모두에서 에이전트가 적절한 Red Flag/Process Step을 인용하며 압력을 거부. 현재 AI Responsibility Contract의 방어 범위가 충분함을 확인.
