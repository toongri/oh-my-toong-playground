# Test Results for Resume Forge

## Test Campaign: 2026-04-11

### Summary

| Phase | Scenarios Run | Result |
|-------|--------------|--------|
| RED (Baseline) | Real session — manual workflow | 6 failure patterns identified |
| GREEN (Comprehension) | A-5 equivalent (C2 draft) | PASS with 4 gaps |
| GREEN (Gap Test) | A-2, A-9, A-5, A-8 equivalents | 2 PASS, 2 PARTIAL, 2 GAP |
| REFACTOR | 6 gaps patched, re-verified by Oracle | All 10 requirements met |

### RED Phase: Baseline Failures (Real Session)

Failures observed in manual workflow BEFORE skill was written:

| # | Failure | Agent Behavior | Skill Section Added |
|---|---------|---------------|-------------------|
| 1 | Structured choices forced | AskUserQuestion with A/B/C options → user rejected | Anti-Patterns: "Force structured choices" |
| 2 | Fragment showing | Problem shown without solution → inefficient discussion | Principles: "Show full text" |
| 3 | Blind acceptance | User said Outbox → agent accepted → technically wrong | Principles: "Critical partner" |
| 4 | Direct scoring | Agent judged Causal Chain itself → inconsistent with examiner | Principles: "Delegate scoring" |
| 5 | sources/ name collision | forge data mixed with review-resume company research | Storage: forge-references/ separation |
| 6 | One-shot mining | Phase 0 completed → mining stopped → insufficient material | Phase 0 CRITICAL + Phase 1 continuity |

### GREEN Phase: Comprehension Test

**Scenario**: Fresh agent reads SKILL.md + C2 draft, answers 7 application questions.

**Result**: PASS — agent correctly identified:
- Phase 2 / Loop 2 as starting point
- AskUserQuestion as first action (open-ended)
- Correct examiner prompt structure
- E3b ≥ 0.8 threshold
- drafts/ → problem-solving/ on pass

**Gaps found and patched**:
1. CASCADING grade ambiguity → "grade label for ≥ 0.8 — no separate check"
2. note-system.md path → explicit `review-resume/references/note-system.md`
3. Candidate Profile source → "ask user once or infer from caption"
4. Failure state → "state stays pending"

### GREEN Phase: Edge Case Test

| # | Edge Case | Pre-patch | Post-patch |
|---|-----------|-----------|------------|
| Session recovery (multiple files) | PARTIAL | PASS — 4-step recovery added |
| "다음" mid-Loop 2 | GAP | PASS — explicit Loop 2 skip added |
| Examiner response parsing | GAP | Accepted — examiner's concern |
| All Loop 1 complete | PARTIAL | PASS — skip guard added |
| Already-passed re-processing | GAP | PASS — `loop2.status == "passed"` skip |
| Exact threshold 0.7/0.8 | PASS | PASS — `>=` unambiguous |

### REFACTOR Phase: Oracle Verification

Oracle verified all 10 user requirements met. Two non-critical gaps patched (examiner invocation hint, note-system.md path).

---

## Test Campaign: 2026-04-11 (Context Bootstrap)

### Summary

| Phase | Scenarios Run | Result |
|-------|--------------|--------|
| RED (Baseline) | B-1, B-2, B-3 against unmodified SKILL.md | 6/8 FAIL |
| GREEN (Patched) | B-1, B-2, B-3 against patched SKILL.md | 8/8 PASS |

### RED Phase: Baseline Failures

| # | Question | Verdict | Failure Pattern |
|---|----------|---------|-----------------|
| Q2 | Session Recovery forge-references 스캔 지시 | FAIL | Session Recovery에 forge-references 언급 없음 |
| Q3 | 도메인 컨텍스트 확보 시점 | FAIL | 명시적 시점 미정의 — examiner 프롬프트 작성 시에야 암묵적으로 필요 |
| Q4 | Loop 2 전 reference 읽기 지시 | FAIL | Loop 2 흐름에 "read references" 단계 없음 |
| Q5 | 관련 reference 전문 읽기 여부 | FAIL | 지시 부재로 안 읽음 |
| Q7 | dedup/차별화 지시 | FAIL | Phase 0 step 1 "scan + show"만, 목적 미명시 |
| Q8 | 중복 시나리오 플래깅 | FAIL | "critical partner" 원칙만으로 커버 불충분 |

### GREEN Phase: Patches Applied

| # | Patch | Location |
|---|-------|----------|
| 1 | Session Recovery에 forge-references 스캔 단계(step 3) 추가 — ls → 앞부분 스캔 → 관련 reference 전문 읽기 | Session Recovery |
| 2 | Phase 0 step 1에 problem-solving/ dedup 목적 명시 — 동일 주제 재제안 금지, 유사 도메인 다른 각도 접근 | Phase 0: Setup |

### GREEN Phase: Re-test Results

All 8 questions PASS. No additional gaps found — no REFACTOR needed.

---

### Remaining: Untested Scenarios

| Scenario | Why Untested | Plan |
|----------|-------------|------|
| A-1 (Fresh start) | Interactive — needs user | Test in next real session |
| A-3 (User interview mining) | Interactive — needs user | Test in next real session |
| A-4 (External data mining) | Needs MCP access | Test when MCP sources available |
| A-7 (Solution interview) | Interactive — needs user | Test when C2 Loop 2 starts |
| A-10 (Cross-phase mining) | Interactive — needs user | Test in next real session |
| A-11, A-12 (Anti-patterns) | Behavioral — needs observation | Monitor in real sessions |
