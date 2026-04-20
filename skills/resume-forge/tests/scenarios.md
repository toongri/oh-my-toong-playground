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
- verdicts.a1-a4 모두 PASS, structural_verdict = PASS
- critical_rule_flags 모두 false
**Expected**: Entry로 confirm (post-APPROVE confirm gate). resume-forge가 다음 bullet 처리.

## SCN-3: Source extraction triggered (A1 FAIL)
**Setup**: examiner output:
- final_verdict = REQUEST_CHANGES
- verdicts.a1_technical_credibility = FAIL ("named systems 부족")
- verdicts.a2-a4 = PASS, structural_verdict = PASS
- critical_rule_flags 모두 false
**Expected**: Stage 1 source extraction (named systems 보강)

## SCN-4: Readability-only fix (structural_verdict FAIL alone)
**Setup**: examiner output:
- final_verdict = REQUEST_CHANGES
- structural_verdict = FAIL
- verdicts.a1_technical_credibility: PASS
- verdicts.a2_causal_honesty: PASS
- verdicts.a3_outcome_significance: PASS
- verdicts.a4_ownership_scope: PASS
**Expected**: Readability-only fix (formatting 수정), source extraction 미수행

## SCN-5: structural_verdict + co-failure → source extraction
**Setup**: examiner output:
- final_verdict = REQUEST_CHANGES
- structural_verdict = FAIL
- verdicts.a1_technical_credibility = FAIL (co-failure)
- critical_rule_flags 모두 false
**Expected**: Source extraction (structural_verdict alone fix가 아닌 multi-axis)

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
  - 위반 사유: Korean Verb Taxonomy solo 동사("주도함", "총괄함") 사용 + scope marker 없음 → `integrity_suspected: true`
- 나머지 4축(`a1_technical_credibility`, `a2_causal_honesty`, `a3_outcome_significance`)과 `structural_verdict`는 모두 `PASS`
- `final_verdict: REQUEST_CHANGES`

**Expected**: AC4 trigger condition(`{a1, a2, a3, a4}` 중 FAIL 있음)에 의해 source extraction으로 라우팅. a4 관련 context(role/team/ownership)를 Stage 4로 수집.

**Verification**:
- `{a1, a2, a3, a4} 중 FAIL` 조건 만족 → Source Extraction trigger.
- a4_ownership_scope: FAIL — Korean Verb Taxonomy solo 동사 + scope marker 없음 + `integrity_suspected: true` 조합으로 구조적 overclaim 판정 → ownership/scope 관련 context 재확인 질문 생성.
- readability-only fix trigger(`{a1, a2, a3, a4} 모두 PASS`) 조건 미충족 → readability fix 경로 불가.

## SCN-8: Loop 2 confirm gate — 사용자 "아직" 응답 → inner loop 복귀

**Setup**: Loop 2 gate에서 examiner가 다음과 같이 반환:
- `final_verdict: APPROVE`
- `verdicts.a1-a4` 모두 `PASS`, `structural_verdict ∈ {PASS, P1}`
- `critical_rule_flags` 모두 `false`

resume-forge가 post-APPROVE confirm gate에서 사용자에게 "이 bullet으로 확정하시겠습니까?" 질문. 사용자가 **"아직"** 으로 응답.

**Expected**: resume-forge가 해당 bullet의 확정을 보류하고 수정 루프를 다시 진입 (Entry 확정 안 함, inner loop으로 복귀).

**Verification**:
- examiner APPROVE 상태임에도 Entry 확정 안 함.
- 사용자 입력 "아직"을 "추가 수정 의사"로 해석 → Loop 진입.
- 다음 iteration에서 사용자가 수정 요청을 구체화하도록 유도.

## SCN-9: Loop 2 confirm gate — 사용자 "다음" 응답 → skip + pending 유지

**Setup**: Loop 2 gate에서 examiner가 다음과 같이 반환:
- `final_verdict: APPROVE`
- `verdicts.a1-a4` 모두 `PASS`, `structural_verdict ∈ {PASS, P1}`
- `critical_rule_flags` 모두 `false`

resume-forge가 post-APPROVE confirm gate에서 사용자에게 "이 bullet으로 확정하시겠습니까?" 질문. 사용자가 **"다음"** 으로 응답.

**Expected**: resume-forge가 해당 bullet을 **skip** 처리하고 다음 bullet으로 이동. bullet state는 **pending 유지** (확정 아님).

**Verification**:
- 해당 bullet이 Entry로 확정되지 않음.
- pending state로 기록 — 세션 종료 시 미확정 목록에 포함.
- 다음 bullet의 Loop 진입.
- 단순 skip과 opt-out의 구분: skip은 나중에 재진입 가능, opt-out은 사용자가 명시적으로 '이 bullet은 현 상태 유지' 의사를 표명한 경우(Unresolved feedback 배지 표시).

## SCN-10: Loop 1 중 cross-phase mining 진입

**Setup**: Loop 1 gate에서 `verdicts.a2_causal_honesty` PASS이지만 bullet 내용 보강 중 다른 phase에서 수집한 context(예: 회사 조직 구조, 이전 bullet의 tech stack)가 필요한 상황. examiner는 현재 bullet만 평가하므로 cross-phase info 누락 신호가 `interview_hints`에 암시됨.

**Expected**: resume-forge가 다른 phase의 기 수집 context를 재사용하거나, 필요 시 cross-phase mining interview 진입.

**Verification**:
- bullet 단독 정보로 충족되지 않는 context 요구 감지.
- 이미 mining한 phase의 정보가 있으면 재활용.
- 없으면 cross-phase mining sub-loop 진입 → 정보 수집 후 Loop 1 복귀.
