# resume-forge Test Scenarios (5-axis)

<!--
scenarios.md 축소 rationale:
- 이전 application-scenarios.md(664L) + test-results.md(156L) 820L의 대부분은 SKILL.md inline 지시로 이관.
- 실제 시나리오 검증은 real session 실행 + SKILL.md inline 지시로 수행.
- 본 파일은 5축 분류 verdict 패턴을 시연하는 최소 scenarios만 유지.
-->

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

## SCN-6: r_phys invariant — critical rule forces REQUEST_CHANGES

**Setup**: examiner가 bullet을 평가 후 다음과 같이 반환:
- `critical_rule_flags.r_phys.triggered: true`
- `final_verdict: REQUEST_CHANGES`
- 예: "achieved 10000% throughput increase with a single line change" 같이 물리적으로 불가능한 주장

**Expected**: resume-forge Loop 2 pass-criteria가 `critical_rule_flags.r_phys.triggered == false`를 요구하므로 final_verdict가 `REQUEST_CHANGES`가 되어 Loop 2 실패 처리.

**Verification**:
- Pass criteria 체크에서 r_phys.triggered == true → Loop 2 fail → 수정 루프 진입.
- critical rule은 axis verdict와 무관하게 invariant로 작동.

## SCN-7: a4 FAIL alone — source extraction Stage 4 routing

**Setup**: examiner가 다음과 같이 반환:
- `verdicts.a4_ownership_scope.verdict: FAIL`
- 나머지 4축(`a1_technical_credibility`, `a2_causal_honesty`, `a3_outcome_significance`, `a5_scanability`)은 모두 `PASS`
- `final_verdict: REQUEST_CHANGES`

**Expected**: AC4 trigger condition(`{a1, a2, a3, a4}` 중 FAIL 있음)에 의해 source extraction으로 라우팅. a4 관련 context(role/team/ownership)를 Stage 4로 수집.

**Verification**:
- `{a1, a2, a3, a4} 중 FAIL` 조건 만족 → Source Extraction trigger.
- a4_ownership_scope: FAIL → ownership/scope 관련 context 재확인 질문 생성.
- readability-only fix trigger(`{a1, a2, a3, a4} 모두 PASS`) 조건 미충족 → readability fix 경로 불가.
