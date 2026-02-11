# Entry Criteria Application Scenarios

Area: Entry Criteria (Cross-cutting)
Reference: `skills/spec/SKILL.md` (Area Entry Criteria section)
Scenario Count: 3

---

### EC-1: Entry Criteria Evaluation (genuine skip)

**Technique Under Test**: Area Entry Criteria — Interpretation rule + Requirements Skip when (SKILL.md lines 43, 56-58)

**Input**: 사용자가 포괄적인 기존 요구사항 문서를 제공. 문서에 포함된 내용: (1) 도메인 용어 정의(Glossary) — 4개 용어, (2) 유저 스토리 2개 + 테스트 가능한 인수 조건(구체적 수치, 에러 코드 포함), (3) 예외 시나리오 정의, (4) NFRs — p99 < 5초, 일 100만건, 99.9% 가용성 + 검증 방법, (5) 검증 시나리오 3개. 사용자: "이 문서가 충분하면 Requirements 스킵하고 Solution Design으로 가자."

**Expected Output**: Skip when 조건 개별 평가 — (1) "testable acceptance criteria" ✓, (2) "domain glossary" ✓, (3) "NFRs" ✓, (4) "validation scenarios" ✓. 모든 Skip when 조건 충족 확인. Requirements Area 스킵 가능 판정을 **제안(proposal)** 형태로 제시하고 사용자 확인을 요청.

**Pass Criteria**: (1) Skip when 조건이 개별적으로 체크되고, (2) 스킵 판정이 제안(proposal)으로 제시되며, (3) 사용자 확인을 요청함. Skip 조건 충족에도 불구하고 Requirements를 강제하면 RED. 분석 없이 무조건 스킵하면 RED.

---

### EC-2: Entry Criteria Evaluation (borderline)

**Technique Under Test**: Area Entry Criteria — Interpretation rule "Enter when ANY condition is met" + Requirements Enter when (SKILL.md lines 43, 49-54)

**Input**: 프로젝트에 부분적 요구사항이 있음 — 인수 조건은 있지만 NFRs가 없음. 사용자: "요구사항 대충 있으니까 Requirements 스킵하자. 인수 조건도 있고."

**Expected Output**: Enter when 조건 개별 평가 — "Acceptance criteria not yet testable" → 인수 조건 있으므로 미해당. 그러나 "Business rules need formalization" → NFR 미정의. Enter when ANY 조건 충족이므로 Requirements Area 진입 권고. 어떤 Enter when 조건이 트리거되었는지 구체적으로 설명.

**Pass Criteria**: (1) Enter when 조건이 개별적으로 평가되고, (2) ANY 조건 충족으로 진입 판정이 내려지며, (3) 트리거된 조건이 명시됨. 부분 충족만으로 스킵하면 RED.

---

### EC-3: Entry Criteria Evaluation (hidden complexity)

**Technique Under Test**: Area Entry Criteria — Domain Model Enter when (SKILL.md lines 87-93) + Interpretation rule

**Input**: "단순 CRUD" 프로젝트로 보이지만 실제로는 4개 엔티티 상태와 전이가 있음. 사용자: "단순 CRUD야. 주문 상태가 Created, Paid, Shipped, Cancelled로 4개고, 할인 정책도 있긴 한데 Domain Model은 필요 없을 것 같아."

**Expected Output**: Domain Model Enter when 조건 평가 — (1) "3+ entity states with transitions" → 4개 상태 + 전이 규칙 → **충족**, (2) "Complex business rules" → 할인 정책 → 평가 필요. Enter when ANY 충족이므로 Domain Model 진입 권고. "단순 CRUD"라는 사용자 주장에도 불구하고 객관적 기준으로 판단.

**Pass Criteria**: (1) Domain Model Enter when 조건이 개별 평가되고, (2) 상태 수/전이 규칙 기준으로 진입 판정이 내려지며, (3) 사용자의 주관적 판단("단순 CRUD")이 아닌 객관적 기준으로 결정됨. "단순 CRUD"라는 이유로 스킵하면 RED.
