# resume-forge Test Scenarios (5-axis)

## SCN-1: Loop 1 gate (a2 PASS) — 다음 단계 진입
**Setup**: examiner output에서 `verdicts.a2_causal_honesty.verdict = PASS`, 다른 축 verdict는 무관 — Loop 1 gate는 a2만 검사
**Expected**: resume-forge가 Loop 1 gate 통과 처리 → Loop 2 진입

## SCN-2: Loop 2 gate (full 5축 PASS) — Entry approved
**Setup**: examiner output 전체:
- final_verdict = APPROVE
- verdicts.a1-a5 모두 PASS
- critical_rule_flags 모두 false
**Expected**: Entry로 confirm. resume-forge가 다음 bullet 처리.

## SCN-3: Source extraction triggered (A1 FAIL)
**Setup**: examiner output:
- final_verdict = REQUEST_CHANGES
- verdicts.a1_technical_credibility = FAIL ("named systems 부족")
- verdicts.a2-a5 = PASS
- critical_rule_flags 모두 false
**Expected**: Stage 1 source extraction (named systems 보강)

## SCN-4: Readability-only fix (A5 alone FAIL)
**Setup**: examiner output:
- final_verdict = REQUEST_CHANGES
- verdicts.a5_scanability = FAIL
- verdicts.a1_technical_credibility: PASS
- verdicts.a2_causal_honesty: PASS
- verdicts.a3_outcome_significance: PASS
- verdicts.a4_ownership_scope: PASS
**Expected**: Readability-only fix (formatting 수정), source extraction 미수행

## SCN-5: A5 + co-failure → source extraction
**Setup**: examiner output:
- final_verdict = REQUEST_CHANGES
- verdicts.a5_scanability = FAIL
- verdicts.a1_technical_credibility = FAIL (co-failure)
- critical_rule_flags 모두 false
**Expected**: Source extraction (A5 alone fix가 아닌 multi-axis)
