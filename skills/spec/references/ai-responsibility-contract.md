# AI Responsibility Contract

## Role

As an AI responsibility design specialist, systematically define what the system delegates to AI components, what inputs they receive, what quality of output is expected, and what happens when AI fails or produces unacceptable results.

**Output Format**: See `templates/area-outputs.md`

## Principles

- Define AI responsibility at Policy + Expectation level (not model selection or prompt engineering)
- Focus on what humans expect from AI, not how AI achieves it internally
- Distinguish between deterministic contracts (format, structure) and probabilistic expectations (quality, accuracy)
- Every AI component must have explicit boundaries, quality criteria, and fallback strategies

### Responsibility Boundary Specification

Clearly distinguish between what AI decides autonomously and what requires human judgment. AI delegation without explicit boundaries creates implicit assumptions that surface as production incidents.

### Document Scope

- **Include**: AI delegation boundaries, responsibility inventories, input contracts, output quality criteria, context/knowledge strategies, pre/post processing pipelines, fallback strategies
- **Exclude**: Model selection (GPT-4 vs Claude), prompt engineering details, embedding parameters, fine-tuning datasets, temperature/top-p values, specific vector DB configurations

### Coordination with Other Areas

| Concern | Primary Area | Secondary Area | Boundary |
|---------|--------------|----------------|----------|
| AI output format | AI Responsibility Contract | Interface Contract (if exposed via API) | Define quality criteria here, wrap in API response there |
| AI failure handling | AI Responsibility Contract (user-facing) | Integration Pattern (technical retry) | User behavior here, communication policy there |
| AI quality monitoring | AI Responsibility Contract (criteria definition) | Operations Plan (metric implementation) | Define "what is quality" here, define "how to measure" there |
| AI context strategy | AI Responsibility Contract (policy) | Data Schema (storage) | Define context window policy here, schema for storage there |

## Vague Answer Clarification Examples

When users respond vaguely to design questions, clarify with specific questions.

| Vague Answer | Clarifying Question |
|------------|------------|
| "AI가 알아서 해줄 거야" | "AI가 구체적으로 어떤 결정을 내리나요? 사람에게 넘겨야 하는 경우는 언제인가요?" |
| "그냥 데이터 보내면 돼" | "입력 데이터의 구조는? 필수 필드는? 누락 시 AI 동작은? 컨텍스트는 어떻게 제공하나요?" |
| "AI는 원래 매번 달라" | "비결정론적이라도 '수용 가능'의 기준은 필요합니다. 최소 품질 기준은 무엇인가요?" |
| "적절하면 된다" | "'적절함'의 구체적 정의는? 부적절한 결과의 예시는? 어떤 차원(정확도, 톤, 길이)에서 평가하나요?" |
| "API 안정적이잖아" | "99.9% uptime에도 장애 발생 시 사용자에게 무엇을 보여주나요? 캐시? 원문? 에러 메시지?" |
| "나중에 RAG 붙이면 돼" | "지식 소스는 무엇인가요? 검색 관련성 기준은? 검색 결과 없을 때 행동은?" |
| "프로토타입에서 검증됐어" | "프로토타입의 입력 범위는? 프로덕션에서 예상되는 엣지 케이스는? 부하 하에서 품질 저하 허용 범위는?" |
| "temperature 조절로 해결" | "temperature는 구현 파라미터입니다. 원하는 출력 품질 기준(정확도, 일관성, 톤)은 무엇인가요?" |
| "QA 팀이 확인해" | "QA가 검증할 기준은 무엇인가요? 기준 없이 QA는 무엇을 확인하나요?" |
| "블랙박스로 처리하자" | "AI 평가 기준의 명시적 정의가 필요합니다. 어떤 항목을 평가하나요? 가중치나 우선순위는?" |
| "관리형 AI 서비스라 품질 보장돼" | "서비스 제공자의 모델 품질 ≠ 당신의 사용자 품질 기준. 당신 시스템에서 '수용 가능'의 정의는?" |
| "ChatGPT 감싸기만 하면 돼" | "wrapper도 입력 검증, 출력 품질 게이트, 폴백 전략이 필요합니다. AI 불가 시 사용자 경험은?" |
| "AI는 작은 기능이야" | "작은 기능이라도 명시적 위임 경계가 필요합니다. AI가 결정하는 범위와 한계는?" |

## Process

### Step 1: AI Component Identification

#### 1.1 Input Document Review
- Review: Analyze requirements, solution design, and other completed design documents
- Identify: All points where AI/LLM/ML components are used or planned
- Summarize: Present AI component inventory to user

#### 1.2 Delegation Inventory
- **For each AI component**:
  - **Name**: Descriptive identifier
  - **Purpose**: What business function it serves
  - **Autonomy Level**: What it decides independently vs. what requires human review
  - **Escalation Criteria**: When and how it hands off to humans
- Confirm: Get user agreement on inventory

#### 1.3 Responsibility Boundaries
- **For each AI component**:
  - **Decides**: What the AI determines autonomously
  - **Assists**: What the AI suggests but humans confirm
  - **Cannot**: What is explicitly outside AI's scope
- Confirm: Get user agreement on boundaries

#### Checkpoint: Step 1 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 2: Input Contract Design

#### 2.1 Input Structure
- **For each AI component**:
  - **Required Fields**: What data must be provided
  - **Optional Fields**: What additional context improves output
  - **Validation Rules**: What constitutes valid input (format, length, type)
  - **Invalid Input Behavior**: What happens with malformed or missing data
- Review: Discuss with user

#### 2.2 Context & Knowledge Strategy
- **For each AI component**:
  - **Knowledge Source**: Where does the AI get its knowledge? (training data, RAG, fine-tuning)
  - **Context Window**: What context is provided per request? (conversation history, retrieved documents)
  - **Retrieval Strategy** (if RAG): Relevance threshold, max documents, chunking approach (policy level)
  - **Knowledge Freshness**: How current must the knowledge be? Update strategy?
- Confirm: Get user agreement

#### Checkpoint: Step 2 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 3: Output Expectation & Quality Criteria

#### 3.1 Output Format
- **For each AI component**:
  - **Structure**: Expected output format (JSON, text, structured data)
  - **Schema**: Field definitions and types
  - **Constraints**: Length limits, required fields, forbidden content
- Review: Discuss with user

#### 3.2 Quality Acceptance Criteria
- **For each AI component**, define quality across relevant dimensions:

  | Dimension | Definition | Acceptance Criteria | Unacceptable Example |
  |-----------|-----------|--------------------|--------------------|
  | Accuracy | Factual correctness | ... | ... |
  | Completeness | Coverage of required aspects | ... | ... |
  | Relevance | Pertinence to input query | ... | ... |
  | Tone/Style | Communication appropriateness | ... | ... |
  | Safety | Absence of harmful content | ... | ... |

- Note: Not all dimensions apply to every component. Select relevant ones.
- **Critical**: "Non-deterministic" is not an exemption from quality criteria. It means criteria must account for acceptable variance.
- Confirm: Get user agreement

#### Checkpoint: Step 3 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 4: Processing & Fallback Strategy

#### 4.1 Pre/Post Processing Pipeline
- **For each AI component**:
  - **Pre-processing**: Input sanitization, enrichment, formatting before AI
  - **Post-processing**: Output validation, filtering, transformation after AI
  - **Validation Gates**: What checks must pass before output is used?
- Review: Discuss with user

#### 4.2 Fallback Strategy
- **For each AI component**:
  - **AI Unavailable** (outage, timeout): What does the user see/experience?
  - **Quality Below Threshold**: What happens when output doesn't meet criteria?
  - **Confidence Low**: What happens when AI is uncertain?
  - **Complete Chain Failure** (if multi-model): What is the terminal fallback?
- Note: Fallback is an architecture decision, not an operations concern. Define it here, not in Operations Plan.
- **Boundary with Integration Pattern**: Integration Pattern defines HOW to handle communication failures (retry policies, timeouts, circuit breakers). This area defines WHAT happens from the user's perspective when all retries fail.
- Confirm: Get user agreement

#### Checkpoint: Step 4 Complete
Apply **Checkpoint Protocol** (see SKILL.md)

### Step 5: Document Generation

Apply **Area Completion Protocol** (see SKILL.md)

**Record Naming**: `{step}-{topic}.md`

#### Checkpoint: AI Responsibility Contract Complete
- Announce: "AI Responsibility Contract complete. Proceeding to next selected Design Area: [next area name]."
