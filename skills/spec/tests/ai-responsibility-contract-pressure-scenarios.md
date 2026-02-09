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
