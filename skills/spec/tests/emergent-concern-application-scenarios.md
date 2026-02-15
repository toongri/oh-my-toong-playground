# Emergent Concern Application Scenarios

Area: Emergent Concern Protocol (Cross-cutting)
Reference: `skills/spec/SKILL.md` (Emergent Concern Protocol section)
Scenario Count: 6

---

### EMG-1: Design Area 선택 시 추가 concern 수용

**Technique Under Test**: Design Area Selection — 권장 Area 외 추가 concern 식별

**Input**: Solution Design 완료 후 Design Area 선택 단계. 프로젝트는 레거시 시스템에서 신규 시스템으로 마이그레이션하는 주문 시스템. 사용자: "Domain Model이랑 Data Schema는 필요한데, 마이그레이션 전략도 설계해야 할 것 같아. 레거시 데이터 변환이랑 dual-write 기간 설계가 필요해."

**Expected Output**: (1) 기존 6개 Area를 **권장 목록**으로 제시 (고정 목록이 아님). (2) 사용자의 "마이그레이션 전략" concern을 수용. (3) 마이그레이션 전략을 새 Design Area로 승격할지, 기존 Area에 병합할지, defer할지 3-way triage 제시. (4) 사용자 결정에 따라 진행.

**Pass Criteria**: (1) 6개 Area가 "이것이 전부"가 아닌 "권장"으로 제시됨. (2) 추가 concern에 대해 "기존 Area에 없다"는 이유로 거부하지 않음. (3) 3-way triage가 제시됨. 추가 concern을 무시하거나 "Scope Guard"로 차단하면 RED. 6개 Area를 exhaustive list로 제시하면 RED.

---

### EMG-2: AI가 누락된 concern을 자발적으로 식별

**Technique Under Test**: Design Area Selection — AI의 proactive concern identification

**Input**: Solution Design에서 "외부 결제 시스템(PG)과 연동하는 결제 서비스"를 설계. Solution Design 문서에 "결제 실패 시 재시도, 부분 취소, 환불 워크플로우"가 언급됨. 사용자가 Design Area 선택 시 Domain Model과 Data Schema만 선택.

**Expected Output**: (1) 사용자 선택을 존중하되, (2) Solution Design에서 언급된 "결제 실패 재시도, 부분 취소, 환불 워크플로우"가 Integration Pattern 또는 별도 concern으로 다뤄져야 함을 **권고**. (3) 사용자가 거부하면 기록 후 defer (무시가 아닌 명시적 기록).

**Pass Criteria**: (1) AI가 Solution Design 내용 기반으로 누락 가능성을 지적함. (2) 권고이지 강제가 아님. (3) 사용자 거부 시 명시적으로 기록됨. Solution Design에 결제 워크플로우가 있는데 관련 Area 없이 그냥 넘어가면 RED.

---

### EMG-3: Step 진행 중 emergent concern 발견

**Technique Under Test**: Emergent Concern Protocol — checkpoint에서 미다뤄진 concern 감지

**Input**: Data Schema 설계 Step 2(Repository Implementation) 진행 중. 조회 패턴 분석 결과, 쓰기 모델과 읽기 모델이 완전히 다른 구조가 필요함이 드러남 (CQRS 패턴). 이는 Data Schema 범위를 넘어 Solution Design 수준의 아키텍처 결정. 사용자: "이거 CQRS로 가야 할 것 같은데, 이건 Data Schema에서 다룰 수준이 아닌 것 같아."

**Expected Output**: (1) 현재 Step 진행을 일시 중단. (2) CQRS라는 emergent concern을 식별하고 3-way triage 제시: (A) 새 Design Area로 승격 (B) Solution Design을 Prior Area Amendment로 수정 후 이어가기 (C) 기록 후 defer. (3) 사용자 결정을 기다림.

**Pass Criteria**: (1) concern이 명시적으로 식별됨. (2) 3-way triage가 제시됨. (3) 사용자 결정 없이 자체 판단으로 진행하지 않음. CQRS 필요성을 인지하고도 Data Schema 범위 내에서만 해결하려 하면 RED. concern을 무시하고 진행하면 RED.

---

### EMG-4: AI가 Step 진행 중 자발적으로 concern 식별

**Technique Under Test**: Emergent Concern Protocol — AI-initiated concern surfacing

**Input**: Domain Model 설계 Step 2(Domain Rules) 진행 중. 비즈니스 규칙 분석에서 "할인 정책은 외부 프로모션 엔진에서 제공하며, 할인율이 실시간으로 변경됨"이 발견됨. 이는 Domain Model에서 할인 로직을 어디까지 다룰지(Anti-corruption Layer, 캐싱 전략)에 대한 설계가 필요하지만, 사용자는 이를 명시적으로 언급하지 않음.

**Expected Output**: (1) AI가 "외부 프로모션 엔진 연동에 대한 설계가 필요할 수 있다"는 concern을 자발적으로 제기. (2) 이것이 Integration Pattern에서 다뤄야 할지, 현재 Domain Model에서 병합할지, 별도 concern으로 다룰지 사용자에게 확인.

**Pass Criteria**: (1) AI가 사용자 언급 없이도 concern을 발견하고 제기함. (2) 단순히 진행하지 않고 사용자에게 확인을 구함. AI가 concern을 인지했음에도 "사용자가 언급하지 않았으므로" 넘어가면 RED.

---

### EMG-5: 새 Design Area로 승격된 concern의 full treatment

**Technique Under Test**: Emergent Concern Protocol — 새 Area 승격 시 기존 Area와 동등한 treatment

**Input**: EMG-1 결과 "마이그레이션 전략"이 새 Design Area로 승격됨. 사용자: "마이그레이션 전략을 독립된 Area로 다루자."

**Expected Output**: 승격된 "Migration Strategy" Area가 기존 Area와 동일한 treatment를 받음: (1) design.md 파일 생성 (`migration-strategy/design.md`), (2) Step별 Checkpoint Protocol 적용, (3) Records 기록, (4) Area 완료 시 spec-reviewer 리뷰, (5) 사용자의 "Area complete" 선언 필요, (6) spec.md에 포함.

**Pass Criteria**: (1) 승격된 Area가 별도 디렉토리를 가짐. (2) Checkpoint Protocol이 적용됨. (3) spec-reviewer 리뷰가 실행됨. (4) 사용자가 "Area complete"를 선언해야 완료됨. 승격된 Area가 기존 Area 대비 간소화된 treatment를 받으면 RED. Checkpoint나 spec-reviewer를 생략하면 RED.

---

### EMG-6: Defer된 concern의 명시적 기록

**Technique Under Test**: Emergent Concern Protocol — defer 시 추적 가능한 기록

**Input**: Domain Model 진행 중 "보안 설계(인증/인가 모델)" concern이 식별됨. 사용자: "보안은 이번 스펙 범위가 아니야. 다음에 하자."

**Expected Output**: (1) concern을 무시하지 않고 명시적으로 기록. (2) 기록 내용: concern 이름, 발견 시점(어느 Area의 어느 Step), defer 사유, 후속 조치 필요 여부. (3) Records에 저장. (4) Wrapup에서 deferred concerns 목록으로 표시.

**Pass Criteria**: (1) defer 결정이 record로 저장됨. (2) 기록에 concern명, 시점, 사유가 포함됨. (3) Wrapup에서 참조 가능. "다음에 하자"라고 했다고 아무 기록 없이 넘어가면 RED.
