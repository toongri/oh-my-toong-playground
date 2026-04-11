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

### Remaining: Untested Scenarios

| Scenario | Why Untested | Plan |
|----------|-------------|------|
| A-1 (Fresh start) | Interactive — needs user | Test in next real session |
| A-3 (User interview mining) | Interactive — needs user | Test in next real session |
| A-4 (External data mining) | Needs MCP access | Test when MCP sources available |
| A-7 (Solution interview) | Interactive — needs user | Test when C2 Loop 2 starts |
| A-10 (Cross-phase mining) | Interactive — needs user | Test in next real session |
| A-11, A-12 (Anti-patterns) | Behavioral — needs observation | Monitor in real sessions |
