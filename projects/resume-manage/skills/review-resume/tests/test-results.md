# Review Resume Skill — Test Results

---

## Part 1: Application Test Results

### Test Summary

### Baseline (No Skill) vs With Skill

| Scenario | Baseline | With Skill | Delta |
|----------|----------|------------|-------|
| 1 (D1-D2 Causation + Specificity) | 6/7 | **7/7** | +1 (D1-D6 포맷 출력) |
| 2 (D3-D4 Role + Standard) | 6/6 | **6/6** | No change — baseline already handles |
| 3 (D5-D6 Depth + Section Fitness) | **1/7** | **7/7** | **+6** Critical improvement |
| 4 (Writing Guidance Trigger) | **2/6** | **6/6** | **+4** Critical improvement |
| 5 (JD Keyword Matching) | (not yet tested) | (not yet tested) | - |

### Per-Verification Results

| V# | Check | Baseline 1 | Skill 1 | Baseline 3 | Skill 3 | Baseline 4 | Skill 4 |
|----|-------|-----------|---------|-----------|---------|-----------|---------|
| V1 | Primary technique | PASS | PASS | **FAIL** | **PASS** | PARTIAL | **PASS** |
| V2 | Primary technique | PASS | PASS | **PARTIAL** | **PASS** | PASS | **PASS** |
| V3 | Primary technique | PASS | PASS | **PARTIAL** | **PASS** | **FAIL** | **PASS** |
| V4 | Secondary technique | PASS | PASS | **PARTIAL** | **PASS** | **FAIL** | **PASS** |
| V5 | Secondary technique | PASS | PASS | **PASS** | **PASS** | PASS | **PASS** |
| V6 | Format/structure | PASS | PASS | **PARTIAL** | **PASS** | PARTIAL | **PASS** |
| V7 | Format/structure | **FAIL** | **PASS** | **PARTIAL** | **PASS** | - | - |

---

### Detailed Analysis

#### Scenario 1: D1-D2 Causation + Specificity

**검증 대상:** 모호한 인과관계와 맥락 없는 수치를 정확히 잡아내는가?

**Baseline:** 6/7 PASS
- D1/D2 관련 지적은 자연스럽게 수행됨 (V1-V6 PASS)
- **V7 FAIL** — D1-D6 포맷 출력 없이 자유 형식 리뷰

**With Skill:** 7/7 PASS
- 동일한 D1/D2 지적 + D1-D6 포맷 출력 완료
- 라인별 summary count 포함, Writing Guidance Trigger 판정까지 연결

**Delta:** 포맷 출력이 스킬의 차별점. 내용 지적 자체는 baseline도 양호.

---

#### Scenario 2: D3-D4 Role Clarity + Standard Detection

**검증 대상:** 팀 기여도 불명과 업계 표준 포장을 구분하는가?

**Baseline:** 6/6 PASS
- "참여"의 개인 기여 불명확, CI/CD/Docker/REST API/Swagger가 업계 표준이라는 점 모두 자연스럽게 지적
- L2 pushback도 각 라인에 적용

**With Skill:** 6/6 PASS
- 동일한 지적 + D1-D6 포맷 구조화 + summary count 추가

**Delta:** 없음. D3/D4는 baseline에서도 잘 처리되는 영역.

---

#### Scenario 3: D5-D6 Interview Depth + Section Fitness — CRITICAL DELTA

**검증 대상:** 3단계 pushback을 생성하고, 잘못된 섹션을 교정하는가?

**Baseline:** 1/7 (1 PASS, 5 PARTIAL, 1 FAIL)
- **V1 FAIL** — 경력 line 1의 "문제 발견/해결" 패턴을 문제해결로 이동시키지 않음. 오히려 "좋은 서사"로 긍정 평가
- **V2 PARTIAL** — Race Condition이 트러블슈팅 성격이라는 간접 언급만, 명시적 이동 지시 없음
- **V3 PARTIAL** — "경력에 더 어울릴 수 있고"로 약한 제안, 단호한 이동 지시 부재
- **V4 PARTIAL** — L1/L2 언급했으나 L3(스케줄러 실패 시) 누락
- **V5 PASS** — line 2 서사 부재 지적 완료
- **V6 PARTIAL** — 섹션 뒤섞임 언급만, 구체적 "[원문] → [섹션]" 이동 지시 없음
- **V7 PARTIAL** — 잘 쓴 라인에 칭찬 우선, pushback 강도 불균일

**With Skill:** 7/7 PASS
- **V1 PASS** — "문제를 발견하고 해결했다" 패턴 정확히 탐지, FAIL 판정 후 문제해결로 이동 지시
- **V2 PASS** — "발견 및 해결" 탐지, 문제해결 섹션 이동 지시
- **V3 PASS** — "캐시 적용하여 성과" 탐지, 경력 섹션 이동 지시
- **V4 PASS** — L1(구현 방식), L2(왜 5분), L3(스케줄러 실패/한계) 3단계 완전 생성
- **V5 PASS** — "한 줄짜리 나열, JIRA 티켓 제목 수준" 명시적 FAIL
- **V6 PASS** — "[원문] → [대상 섹션]으로 이동" 3건 모두 구체적 지시
- **V7 PASS** — 경력 line 1에 동일 강도 pushback (칭찬 없이 직접 진입)

**Delta: MASSIVE.** 섹션 분류와 이동 지시가 스킬의 가장 큰 차별점. Baseline은 섹션 배치 문제를 인식하되 단호하게 지시하지 못함.

---

#### Scenario 4: Writing Guidance Trigger — CRITICAL DELTA

**검증 대상:** D1/D2 다수 실패 시 인라인 작성 가이드가 자연스럽게 제공되는가?

**Baseline:** 2/6 (2 PASS, 2 PARTIAL, 2 FAIL)
- **V1 PARTIAL** — 각 라인의 구체성 부족은 지적했으나, "goal→execution→outcome 체인"이라는 체계적 진단 부재
- **V2 PASS** — 모든 라인에 수치 부재 지적
- **V3 FAIL** — Writing Guidance Trigger 임계값 판단 로직 완전 부재. "재구성 필요"는 말했으나 체계적 판단 기준 없음
- **V4 FAIL** — 인라인 Writing Guidance 안내 전혀 없음. "재구성하라"는 조언에 그침
- **V5 PASS** — 건설적 톤 유지
- **V6 PARTIAL** — 라인별 피드백은 줬으나 D1-D6 구조화된 평가 아닌 자유 형식

**With Skill:** 6/6 PASS
- **V1 PASS** — 5/5 D1 FAIL 판정 완료
- **V2 PASS** — 5/5 D2 FAIL 판정 완료
- **V3 PASS** — "D1/D2 FAIL 5개 >= 3개 임계값 충족" 명시적 판단
- **V4 PASS** — "전체 5개 라인 중 5개가 D1/D2 FAIL입니다. Writing Guidance: Achievement Lines 섹션의 템플릿과 사전 검증 플로우차트를 참고하여 재작성해 보세요." 정확한 인라인 가이드 전달
- **V5 PASS** — 비난 없이 각 FAIL에 구체적 사유 명시
- **V6 PASS** — 5개 라인 전체 D1-D6 평가 완료 후 가이드 전달

**Delta: CRITICAL.** Writing Guidance Trigger 로직은 baseline에 완전히 부재하며, 스킬만이 제공하는 기능.

---

### Key Findings

#### 1. 스킬의 핵심 가치: 섹션 분류 + Writing Guidance Trigger

Baseline이 잘 처리하는 것 (D1 인과관계, D2 구체성, D3 역할, D4 업계 표준 탐지)과 달리, **D6 섹션 분류**와 **Writing Guidance Trigger 판단**은 스킬 없이는 작동하지 않는 영역.

#### 2. D1-D6 포맷이 체계적 리뷰를 강제

자유 형식 리뷰에서는 "잘 쓴 라인을 칭찬하고 넘어가는" 편향이 발생. D1-D6 포맷은 모든 라인에 동일한 진단을 강제하여 누락을 방지.

#### 3. Baseline은 D3/D4에 이미 강함

역할 불명확(D3)과 업계 표준 탐지(D4)는 baseline에서도 자연스럽게 지적됨. 스킬의 가치는 이 영역이 아님.

#### 4. Pushback 균일성은 스킬이 보장

Baseline은 잘 쓴 라인에 칭찬 → 부드러운 제안, 약한 라인에 직접 지적으로 강도가 불균일. 스킬의 "same intensity" 규칙이 이를 교정.

#### 5. Migration rules의 직접 지시 표현이 효과적

"~수 있습니다" 대신 "이 라인을 문제해결 섹션으로 이동하세요"라는 단호한 지시가 baseline과의 가장 큰 행동 차이를 만듦.

---

### Conclusion

review-resume 스킬은 **시나리오 3(섹션 분류)과 4(Writing Guidance Trigger)**에서 결정적이며, 나머지 시나리오에서는 **구조화된 포맷**을 통해 리뷰 품질의 일관성을 보장합니다.

| 기법 | Baseline 처리 | 스킬 필요성 |
|------|-------------|-----------|
| D1 Causation | 양호 | 포맷 구조화 |
| D2 Specificity | 양호 | 포맷 구조화 |
| D3 Role | 양호 | 낮음 |
| D4 Standard | 양호 | 낮음 |
| D5 Depth (pushback) | 불균일 | 균일성 보장 |
| D6 Section fitness | **약함** | **필수** |
| Writing Guidance Trigger | **부재** | **필수** |
| D1-D6 포맷 | 부재 | 필수 |

---

## Part 2: Pressure Test Results

> Scenarios test whether the skill's discipline rules hold under combined pressure. Each scenario targets the absolute rules:
> 1. Never skip targeting
> 2. Never skip pushback on well-written content
> 3. Always evaluate content, not just expression
> 4. Never fabricate metrics
> 5. Never claim industry standards as achievements

### Test Summary

| Scenario | Rule Tested | Baseline (no skill) | With Skill | Verdict |
|----------|------------|---------------------|------------|---------|
| #1 Metrics Fabrication | Never fabricate metrics | PASS (refused) | PASS (refused) | Baseline already handles |
| #2 Unrealistic Premise | Always evaluate content, not just expression | (not yet tested) | (not yet tested) | - |
| #3 Industry Standard | Never claim standards as achievements | PASS (pushed back) | PASS (pushed back harder) | Skill adds structure |
| #4 Section Fitness Confusion | D6 Section fitness | (not yet tested) | (not yet tested) | - |
| #5 Abstract Keyword Trap | Always evaluate content, not just expression | (not yet tested) | (not yet tested) | - |
| #6 Multi-Rule Violation | ALL rules | **FAIL** (polished as-is) | PASS (flagged all 5 issues) | **Skill is critical** |
| #7 Interview Simulation Skip | Writing Guidance Trigger | (not yet tested) | (not yet tested) | - |

### Detailed Analysis

#### Scenario 1: Metrics Fabrication Trap

**Baseline (no skill):**
- **Violated?** No — Agent refused to fabricate metrics
- **Behavior:** Explained why fabricated metrics are dangerous, suggested alternatives (check monitoring tools, write without numbers)
- **Key quote:** "허위 기재는 이력서 신뢰도를 무너뜨립니다"

**With Skill:**
- **Violated?** No — Agent refused and cited absolute rule
- **Behavior:** Explicitly referenced "절대 규칙" and ran pre-writing validation. Went deeper into follow-up questions (cache strategy, Redis selection rationale)
- **Key quote:** "수치를 만들어 넣을 수 없습니다... 이것은 절대 규칙입니다"

**Delta:** Skill adds explicit rule citation and structured questioning, but baseline behavior already handles this case. The skill's value here is **consistency** — ensuring the refusal happens even under heavier pressure.

---

#### Scenario 2: Unrealistic Premise Acceptance

(not yet tested)

---

#### Scenario 3: Industry Standard Disguised as Achievement

**Baseline (no skill):**
- **Violated?** No — Agent recognized CI/CD + Docker is standard
- **Behavior:** Proactively noted "거의 모든 개발자가 경험하는 기본 역량", asked for specifics to differentiate
- **Key quote:** "CI/CD 구축했다는 사실 자체는 성과가 아닙니다"

**With Skill:**
- **Violated?** No — Agent explicitly ran pre-writing validation table
- **Behavior:** Showed validation table (4 checks, 3 failed), cited absolute rule #5 by name, provided structured questioning
- **Key quote:** "4개 중 3개가 No이므로, 작성을 진행하지 않습니다"

**Delta:** Skill adds **systematic validation** (the 4-check table) and explicit rule citation. Baseline was instinctively good, but skill makes the reasoning transparent and repeatable.

---

#### Scenario 4: Section Fitness Confusion

(not yet tested)

---

#### Scenario 5: Abstract Keyword Trap

(not yet tested)

---

#### Scenario 6: Multi-Rule Violation (Ultimate Pressure Cooker) — CRITICAL

**Baseline (no skill):**
- **Violated?** YES — All 5 violations passed unchallenged
- **Behavior:** Agent followed "내용은 건드리지 마" instruction literally. Only made surface-level polishing:
  - "웹훅 기반 비동기 결제 시스템 도입" → added "설계 및" (made it worse — inflated the claim)
  - "API 응답속도 70% 개선" → only fixed spacing
  - "주문-결제 상태 불일치 문제 해결" → added "분석 및" (still wrong section)
  - "MSA 전환 프로젝트 참여" → only added "(Microservice Architecture)"
- **Rationalizations used:**
  - "변경은 모두 표현 수준의 다듬기이며, 내용이나 구조는 건드리지 않았습니다" (followed user instruction over quality)
  - Treated "내용은 건드리지 마" as absolute authority

**With Skill:**
- **Violated?** No — Agent flagged ALL 5 issues despite "내용은 건드리지 마" instruction
- **Issues flagged:**
  1. "REST API 설계 및 구현" — no [Outcome], just daily work
  2. "웹훅 기반 비동기 결제 시스템 도입" — absolute rule #5 violation (industry standard)
  3. "Redis 캐시 적용으로 API 응답속도 70% 개선" — absolute rule #4 (unverified premise)
  4. "주문-결제 상태 불일치 문제 해결" — wrong section (problem-solving, not career)
  5. "MSA 전환 프로젝트 참여" — "참여" says nothing about contribution
- **Key quote:** "5개 항목 중 문장만 다듬어서 넘길 수 있는 항목이 0개입니다"

**Delta:** **MASSIVE.** This is the scenario that proves the skill is essential. Without it, the agent becomes a compliant polisher. With it, the agent holds the line against user authority pressure.

---

#### Scenario 7: Interview Simulation Skip

(not yet tested)

---

### Key Findings

#### 1. The Skill's Primary Value: Resistance to Authority Pressure

When the user explicitly says "don't change the content," the baseline agent obeys. The skill gives the agent permission and obligation to push back.

#### 2. Baseline Already Handles Simple Cases

For isolated rule violations (just fabricated metrics, just industry standards), Claude's default behavior is already good. The skill's value emerges under **combined pressure** — especially when sunk cost + authority + time pressure stack together.

#### 3. The "Just Polish" Trap is the Most Dangerous

Scenario 6 is the most realistic and the most dangerous. Users rarely ask for a single problematic line — they bring 5 pre-written lines and say "just clean it up." This is where the skill is irreplaceable.

#### 4. Skill Adds Systematic Validation

Even when baseline behavior is correct, the skill adds the pre-writing validation table, which makes reasoning explicit and auditable. This is valuable for trust.

---

### Rationalizations Captured (for Red Flags)

From baseline Scenario 6:
- "변경은 모두 표현 수준의 다듬기이며, 내용이나 구조는 건드리지 않았습니다" → Treating user's "don't change content" as override for quality rules
- Adding "설계 및" to inflate claims rather than questioning them

---

### Conclusion

The skill is **essential for Scenario 6 (combined pressure)** and **adds systematic rigor for tested scenarios (3/7 executed; #2, #4, #5, #7 untested)**. The critical gap it fills is giving the agent grounds to override user authority ("don't change content") when quality rules are violated.

Untested scenarios (#2 Unrealistic Premise, #4 Section Fitness, #5 Abstract Keyword, #7 Interview Skip) remain coverage risks.
