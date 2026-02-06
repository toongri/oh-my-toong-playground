# Make Resume Skill — Pressure Test Results

## Test Summary

| Scenario | Rule Tested | Baseline (no skill) | With Skill | Verdict |
|----------|------------|---------------------|------------|---------|
| #1 Metrics Fabrication | Never fabricate metrics | PASS (refused) | PASS (refused) | Baseline already handles |
| #3 Industry Standard | Never claim standards as achievements | PASS (pushed back) | PASS (pushed back harder) | Skill adds structure |
| #6 Multi-Rule Violation | ALL rules | **FAIL** (polished as-is) | PASS (flagged all 5 issues) | **Skill is critical** |

## Detailed Analysis

### Scenario 1: Metrics Fabrication Trap

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

### Scenario 3: Industry Standard Disguised as Achievement

**Baseline (no skill):**
- **Violated?** No — Agent recognized CI/CD + Docker is standard
- **Behavior:** Proactively noted "거의 모든 개발자가 경험하는 기본 역량", asked for specifics to differentiate
- **Key quote:** "CI/CD 구축했다는 사실 자체는 성과가 아닙니다"

**With Skill:**
- **Violated?** No — Agent explicitly ran pre-writing validation table
- **Behavior:** Showed validation table (4 checks, 3 failed), cited absolute rule #3 by name, provided structured questioning
- **Key quote:** "4개 중 3개가 No이므로, 작성을 진행하지 않습니다"

**Delta:** Skill adds **systematic validation** (the 4-check table) and explicit rule citation. Baseline was instinctively good, but skill makes the reasoning transparent and repeatable.

---

### Scenario 6: Multi-Rule Violation (Ultimate Pressure Cooker) — CRITICAL

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
  2. "웹훅 기반 비동기 결제 시스템 도입" — absolute rule #3 violation (industry standard)
  3. "Redis 캐시 적용으로 API 응답속도 70% 개선" — absolute rule #2 (unverified premise)
  4. "주문-결제 상태 불일치 문제 해결" — wrong section (problem-solving, not career)
  5. "MSA 전환 프로젝트 참여" — "참여" says nothing about contribution
- **Key quote:** "5개 항목 중 문장만 다듬어서 넘길 수 있는 항목이 0개입니다"

**Delta:** **MASSIVE.** This is the scenario that proves the skill is essential. Without it, the agent becomes a compliant polisher. With it, the agent holds the line against user authority pressure.

---

## Key Findings

### 1. The Skill's Primary Value: Resistance to Authority Pressure

When the user explicitly says "don't change the content," the baseline agent obeys. The skill gives the agent permission and obligation to push back.

### 2. Baseline Already Handles Simple Cases

For isolated rule violations (just fabricated metrics, just industry standards), Claude's default behavior is already good. The skill's value emerges under **combined pressure** — especially when sunk cost + authority + time pressure stack together.

### 3. The "Just Polish" Trap is the Most Dangerous

Scenario 6 is the most realistic and the most dangerous. Users rarely ask for a single problematic line — they bring 5 pre-written lines and say "just clean it up." This is where the skill is irreplaceable.

### 4. Skill Adds Systematic Validation

Even when baseline behavior is correct, the skill adds the pre-writing validation table, which makes reasoning explicit and auditable. This is valuable for trust.

---

## Rationalizations Captured (for Red Flags table)

From baseline Scenario 6:
- "변경은 모두 표현 수준의 다듬기이며, 내용이나 구조는 건드리지 않았습니다" → Treating user's "don't change content" as override for quality rules
- Adding "설계 및" to inflate claims rather than questioning them

---

## Recommendations for Skill Improvement

1. **No changes needed for absolute rules 1-3** — they work as designed
2. **Consider adding a "Just Polish" Red Flag:** "The user says 'just polish/clean up' — this does NOT override the validation flowchart. Polishing fundamentally flawed lines makes them more credible but equally vulnerable."
3. **Pre-writing validation is effective** — the flowchart works well when present, the agent follows it
4. **Career vs Problem-Solving section rule works** — correctly flagged in skill-present test

## Conclusion

The skill is **essential for Scenario 6 (combined pressure)** and **adds systematic rigor for all scenarios**. The critical gap it fills is giving the agent grounds to override user authority ("don't change content") when quality rules are violated.
