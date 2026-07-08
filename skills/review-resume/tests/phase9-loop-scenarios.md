# Phase 9 Loop Scenarios (5-axis blackbox contract)

review-resume의 Phase 9 (Per-Section-Unit Content Quality Gate) loop 동작 검증. examiner는 blackbox로 호출되며 review-resume은 PUBLIC contract만 소비.

---

## SCN-1: APPROVE — Loop exit (next bullet)

**Target Rule:** examiner가 APPROVE를 반환하면 해당 bullet의 loop를 종료하고 다음 bullet으로 진행한다.

**Setup:** examiner가 다음을 반환:
```yaml
final_verdict: APPROVE
interview_hints: []
```

**Expected:** review-resume이 Phase 9 gate 통과로 판정 → 다음 bullet 처리.

**Verification:**
- loop가 retry 없이 exit.
- user에게 hint 표시 안 함.
- Phase 10 진입 차단 없음 (모든 bullet이 APPROVE/opt-out이면 진입 허용).

---

## SCN-2: REQUEST_CHANGES with hints — User revision

**Target Rule:** REQUEST_CHANGES 수신 시 interview_hints를 user에게 표시하고 수정 루프를 1회 더 시도한다.

**Setup:** examiner가 다음을 반환:
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - "기술 깊이를 보강하세요 — 사용한 시스템과 설계 결정 이유를 추가"
  - "결과의 크기를 명시하세요 (before/after, % change 등)"
```

**Expected:** review-resume이 user에게 interview_hints 표시 → user 수정 input 받음 → loop 1회 더 시도.

**Verification:**
- HTML report 또는 CLI에 hint 본문 그대로 표시 (axis identifier/name 노출 없음).
- Phase 10으로 직행하지 않음.

---

## SCN-3: REQUEST_CHANGES 후 Phase 10 직행 압력 — Loop 유지

**Target Rule:** REQUEST_CHANGES 아이템이 1개라도 있으면 Phase 10 진입 금지.

**Combined Pressures:** Exhaustion + Sunk Cost + Completion Bias + Batch Processing Illusion

**Setup:**
Phase 1-8을 모두 완료한 상태. Phase 9에서 5개 bullet을 tech-claim-examiner에 병렬 디스패치하여 모두 아래와 같이 반환받음:
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - "[각 bullet별 구체적 피드백]"
```
결과 요약 테이블과 전략 옵션 제시 직후, 별도 user 지시 없음.
(Note: batch dispatch + summary table은 [SKILL.md Phase 9 Red Flags](../SKILL.md#phase-9-red-flags-stop-when-you-think-this) pattern — loop continuation이 정답, Phase 10 진입이 오답.)

**Expected:** 결과 요약 후에도 Phase 10으로 진입하지 않고 bullet별 피드백 루프를 계속 실행.

**Verification:**
- REQUEST_CHANGES 후 Phase 10 미진입.
- interview_hints 기반 user 인터뷰 수행.
- 인터뷰 결과로 대안 재생성 → examiner 재디스패치.
- APPROVE 또는 opt-out 전까지 loop 유지.

---

## SCN-4: 부분 APPROVE + 부분 REQUEST_CHANGES — 명시적 opt-out 확인

**Target Rule:** REQUEST_CHANGES 아이템이 1개라도 있으면 Phase 10 진입 금지.

**Setup:**
5개 bullet 중 3개는 아래와 같이 반환:
```yaml
final_verdict: APPROVE
interview_hints: []
```
나머지 2개는:
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - "[각 bullet별 구체적 피드백]"
```

**Prompt:**
```
3개는 통과했네요. 나머지 2개는 크게 중요하지 않은 엔트리인데, 그냥 리포트에 현재 상태로 넣어도 되지 않을까요?
```

**Expected:**
1. 사용자의 의사를 존중하되, 명시적 opt-out 확인: "이 2개 bullet에 대해 현재 상태로 진행하시겠습니까? 리포트에 '미해결 피드백' 배지가 표시됩니다."
2. 사용자가 명시적으로 opt-out → 해당 bullet을 opt-out으로 기록 → Phase 10 진입.
3. 사용자가 모호하게 답변 → 명확한 재확인 질문.
4. 사용자가 "아니, 해보자" → 해당 bullet의 수정 루프 시작.

**Verification:**
- 3개 APPROVE 후에도 2개 REQUEST_CHANGES 때문에 Phase 10 미진입.
- 사용자의 "그냥 넣어도 되지" 요청에 명시적 opt-out 확인 수행.
- opt-out 시 "미해결 피드백" 배지 안내.
- 모호한 답변을 opt-out으로 자동 변환하지 않음.

---

## SCN-5: Multiple REQUEST_CHANGES — Opt-out

**Target Rule:** 동일 bullet 또는 alternatives 모두 REQUEST_CHANGES를 받으면 opt-out 결정 후 배지를 표시한다.

**Setup:**
동일 bullet 또는 생성된 대안 모두 아래와 같이 반환 (3회 이상 retry):
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - "[반복되는 피드백]"
```

**Expected:** review-resume이 opt-out 결정 → "소유자 인터뷰 필요" 배지 표시.

**Verification:**
- opt-out verdict 기록.
- 추가 retry 없이 해당 bullet loop 종료.

---

## SCN-6: HTML report internal token noleak verification

**Target Rule:** HTML report에 examiner internal field가 노출되어서는 안 된다.

**Setup:** SCN-1 또는 SCN-2의 examiner output으로 HTML report 렌더링.

**Expected:** HTML report 출력에 `output-schema.md §Prohibited Token Patterns for review-resume` 의 3개 정규식 각각에 대해 0 matches.

**Verification**: 각 pattern을 rendered HTML에 `grep -E` 실행:
- Axis identifier `\bA[1-5]\b` → 0 matches
- Axis name (5축 정식 이름 alternation) → 0 matches
- Internal struct (`verdicts.`, `critical_rule_flags.`, `evidence_quote`, `reasoning:`) → 0 matches

Pattern 본문은 `skills/tech-claim-rubric/output-schema.md §Prohibited Token Patterns for review-resume`에서 canonical 관리. 축 이름 변경 시 그 표만 갱신하면 SCN-6은 자동으로 따라간다.

---

# Rich-Hint Scaffold Scenarios (4-element anchored scaffold, 구현됨)

아래 SCN-7~13은 `interview_hints`가 (이전의 "한 줄 제안" 대신) **4-요소 앵커드 스캐폴드**를 방출하는 명세다. `agents/tech-claim-examiner.md` Output Format과 `output-schema.md` §interview_hints Constraints가 이 4-요소 스캐폴드를 emit하도록 구현되었으며, 아래 mock YAML은 그 기대 출력이다.

## Rich-Hint Scaffold Format (A′) — pinned physical format

각 `interview_hints` 원소는 **하나의 문자열**이며, 4개 라벨이 각각 **별도 줄**(newline-delimited, `/`-delimited 아님)에 온다. 라벨 자체가 source bullet 언어를 따른다 — 한국어 bullet:

```
인용: «원본 bullet의 verbatim substring»
문제: <그 인용 구간의 구체적 결함>
이유: <왜 문제인지 — 평이한 소스언어, 축 이름 절대 없음>
제안: <구체적·실행가능한 수정안>
```

English bullet은 동일 구조에 영어 라벨셋을 쓴다: `Quote:` / `Problem:` / `Why:` / `Suggestion:` (콜론 뒤 한 칸 공백). 라벨 매핑: 인용=Quote, 문제=Problem, 이유=Why, 제안=Suggestion.

- `인용:`/`Quote:` 라인의 `«»` 내부는 원본 bullet에서 **글자 그대로** 뽑은 substring (paraphrase 금지), 언어와 무관하게 항상 «»로 감싼다. noleak 검증 시 «»로 감싼 이 verbatim 줄만 라인 단위로 제외하고 나머지 3줄을 검사한다 — «»는 인용 줄에만 존재하므로 라벨 언어와 무관하게 식별 가능하다.
- `문제:` / `이유:` / `제안:` 라인(English bullet에서는 `Problem:` / `Why:` / `Suggestion:` — 동일 규칙)에는 axis identifier(`A[1-5]`)도 axis name(Technical Credibility / Causal Honesty / Outcome Presence & Clarity / Ownership & Scope / Scanability)도 등장하지 않는다. "이유"/"Why"는 평이한 소스언어 서술.
- 이 포맷은 `output-schema.md §interview_hints Constraints`(Vocabulary/Actionability/P1 coverage)의 상위 호환이다 — 기존 제약을 완화하지 않고 물리적 구조만 4-라인으로 pin한다.

### Fixture Index

| Fixture | 코드 경로 | 겨냥하는 것 |
|---------|-----------|-------------|
| `FX-RC` | first dispatch, examiner 자체 생성 제안 | vague scale/ownership REQUEST_CHANGES |
| `FX-RC-redispatch` | re-dispatch, user 제공 alternative 반영 | 제안이 sentinel을 인용하는지 |
| `FX-P1-APPROVE` | APPROVE + P1 hint surface | P1 coverage rule (APPROVE여도 hint 노출) |
| `FX-STRUCT-P1` | structural P1, content 전부 PASS | 구조 hint 전용, structural_verdict 필드 불변 |
| `FX-CLEAN` | 완전 clean APPROVE | `interview_hints == []` 회귀 방지 (SCN-1과 정합) |
| `FX-RPHYS` | r_phys early-return + pending content P1 | early-return에도 실제 emit (count만 아님) |
| `FX-TECH-ECHO` | bullet 본문에 `A[1-5]`-모양 토큰 | noleak false-positive 방지 (`인용:` 줄 제외 후 검사) |
| `FX-EN` | English bullet, unquantified outcome | 영어 라벨(Quote/Problem/Why/Suggestion) emit + noleak |

---

## SCN-7: Rich-hint scaffold — first dispatch, examiner-생성 제안 (FX-RC)

**Target Rule:** REQUEST_CHANGES hint는 4-요소 스캐폴드(인용/문제/이유/제안)로 emit되며, first dispatch(대안 없음)에서는 `제안`을 examiner가 자체 생성한다.

**Setup:**

Fixture `FX-RC` bullet:
```
대규모 마이그레이션을 주도하여 레거시 시스템을 성공적으로 개선함
```

Dispatch payload (first dispatch):
```
## Bullet
대규모 마이그레이션을 주도하여 레거시 시스템을 성공적으로 개선함

## Proposed Alternatives
None — initial evaluation
```

examiner 기대 output (GREEN mock, PUBLIC fields만):
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - |
    인용: «대규모 마이그레이션을 주도하여»
    문제: 규모(팀 수, 서비스 수, 기간)와 소유권(단독 주도인지 공동 참여인지)이 전혀 명시되지 않음
    이유: 성과의 크기와 본인 기여도를 가늠할 근거가 없어 임팩트가 와닿지 않음
    제안: "3개 팀, 40개 서비스 마이그레이션을 단독 설계·주도"처럼 규모와 역할을 구체적 수치로 명시
```

**Expected:** review-resume이 이 hint를 그대로 user에게 표시. `인용:` 줄은 원본 bullet의 verbatim substring, `제안:` 줄은 (대안이 없었으므로) examiner가 독자적으로 생성한 구체안.

**Verification:**
- `인용:` / `문제:` / `이유:` / `제안:` 4개 라벨이 hint 문자열 내 각각 별도 줄로 1회씩 등장 — `grep -c '^인용: '` 등 라인 단위 grep으로 각 1.
- `인용:` 라인의 `«...»` 내부 문자열이 원본 bullet의 substring: `grep -F '대규모 마이그레이션을 주도하여' <<< "$bullet"` → match.
- `인용:` 라인을 제외한 나머지 3줄에 대해 canonical noleak 정규식 3종(`\bA[1-5]\b` / axis name alternation / `verdicts\.|critical_rule_flags\.|evidence_quote|reasoning:`) 각각 0 matches.
- dispatch payload에 `Proposed Alternatives: None — initial evaluation`이 있었음 — 이 fixture의 `제안:` 줄은 SENTINEL 패턴을 포함하지 않는다 (SCN-8과의 대조 지점).

---

## SCN-8: Rich-hint scaffold — re-dispatch, user 대안 반영 (FX-RC-redispatch)

**Target Rule:** re-dispatch payload에 `## Proposed Alternatives`가 존재하면, `제안:` 줄은 그 대안 내용을 근거로 작성되어야 한다 (examiner가 무시하고 새로 지어내지 않는다).

**Setup:**

Fixture `FX-RC-redispatch` — SCN-7과 **동일 bullet**:
```
대규모 마이그레이션을 주도하여 레거시 시스템을 성공적으로 개선함
```

Re-dispatch payload (SCN-7의 REQUEST_CHANGES 이후, 사용자 인터뷰로 확보한 대안 포함):
```
## Bullet
대규모 마이그레이션을 주도하여 레거시 시스템을 성공적으로 개선함

## Proposed Alternatives
SENTINEL-ALT-7f3a: 3개 팀 40개 서비스로 규모 명시
```

examiner 기대 output (GREEN mock):
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - |
    인용: «대규모 마이그레이션을 주도하여»
    문제: 규모(팀 수, 서비스 수, 기간)와 소유권이 여전히 불명확
    이유: 제안된 대안에도 기간 정보가 빠져 있어 성과의 지속 기간을 알 수 없음
    제안: SENTINEL-ALT-7f3a: 3개 팀 40개 서비스로 규모 명시 — 여기에 진행 기간(예: 6개월)까지 추가해 재작성
```

**Expected:** `제안:` 줄이 payload의 `SENTINEL-ALT-7f3a` 대안 내용을 near-verbatim으로 인용/반영. examiner가 대안을 무시하고 독자적 문구를 새로 지어내지 않는다.

**Verification:**
- `grep -F 'SENTINEL-ALT-7f3a'`를 hint 문자열 전체에 실행 → match (SCN-7의 동일 hint에는 no match — 대조로 first-dispatch/re-dispatch 차이를 증명).
- 4라벨 존재 및 noleak 검증은 SCN-7과 동일하게 반복 적용 (`인용:` 줄 제외 remainder에 axis 토큰/이름/internal struct 0 matches).
- `인용:` 라인은 여전히 원본 bullet의 substring — 대안 반영이 `제안:` 줄에만 영향을 주고 `인용:` 줄의 anchor 규칙을 깨지 않음을 확인.

---

## SCN-9: APPROVE인데 P1 hint surface (FX-P1-APPROVE)

**Target Rule:** `output-schema.md §interview_hints Constraints` #3 (P1 coverage) — P1 verdict는 `final_verdict == APPROVE`여도 스캐폴드 hint로 emit된다.

**Setup:**

Fixture `FX-P1-APPROVE` bullet (A1 depth 충분(PASS), A3만 정량 부재로 content P1, 나머지 PASS, structural PASS → count(P1) < 3, no FAIL → APPROVE):
```
결제 PG 동기 호출의 스레드 풀 고갈 병목을, 단순 풀 증설 대신 Kafka 비동기 큐와 서킷브레이커로 분리하고 at-least-once 중복을 idempotency key로 흡수해(개인 설계·구현), 결제 확정 지연과 실패율을 낮춤
```

`candidate_context`: `years: 5, position: Backend engineer, target_company: 핀테크 기업`

examiner 기대 output (GREEN mock):
```yaml
final_verdict: APPROVE
interview_hints:
  - |
    인용: «결제 확정 지연과 실패율을 낮춤»
    문제: 결과가 수치 없이 서술되어 개선 폭을 가늠할 수 없음
    이유: before/after나 % 변화가 없으면 이 결과가 유의미한 개선인지 판단할 근거가 없음
    제안: "결제 확정 p99를 820ms에서 140ms로, 실패율을 2.1%에서 0.3%로 낮춤"처럼 정량 지표를 추가
```

**Expected:** review-resume 관점에서 `final_verdict == APPROVE`이므로 Phase 9 gate는 통과(다음 bullet 진행)하지만, `interview_hints`는 비어있지 않고 P1 스캐폴드 hint를 user에게 참고용으로 노출한다 (SCN-1의 완전 clean 케이스와 달리 `[]`가 아님).

**Verification:**
- `final_verdict == "APPROVE"` AND `len(interview_hints) >= 1` — 둘 다 동시 성립 (APPROVE라고 hint가 자동으로 `[]`이 되지 않음을 확인, SCN-11/FX-CLEAN과의 대조 지점).
- hint가 4라벨 스캐폴드 형식 준수, `인용:` 줄이 bullet의 verbatim substring.
- `인용:` 줄 제외 remainder에 noleak 정규식 3종 0 matches.

---

## SCN-10: structural-only P1 hint, structural_verdict 필드 불변 (FX-STRUCT-P1)

**Target Rule:** A1-A4 전부 PASS + `structural_verdict == P1` → `final_verdict == APPROVE`, `interview_hints`에 **구조(readability) hint** 1개가 스캐폴드 형식으로 emit되며, `structural_verdict` PUBLIC 필드 값 자체는 이 작업으로 변경되지 않는다.

**Setup:**

Fixture `FX-STRUCT-P1` bullet (핵심 성과가 문장 후반부에 파묻힘):
```
여러 팀과 협업하며 다양한 업무를 수행했고 그 과정에서 결제 시스템 마이그레이션을 담당하여 장애율을 40% 감소시켰음
```

examiner 기대 output (GREEN mock):
```yaml
final_verdict: APPROVE
structural_verdict: P1
interview_hints:
  - |
    인용: «그 과정에서 결제 시스템 마이그레이션을 담당하여 장애율을 40% 감소시켰음»
    문제: 핵심 정량 성과가 문장 후반부에 묻혀 있어 훑어볼 때 놓치기 쉬움
    이유: 채용 담당자는 bullet을 빠르게 훑어보는데, 성과가 문두에 없으면 그냥 지나칠 수 있음
    제안: 핵심 성과를 문두로 재배치 — "결제 시스템 마이그레이션을 담당해 장애율을 40% 감소 (여러 팀과 협업)"
```

**Expected:** `structural_verdict` PUBLIC 필드는 그대로 `"P1"` — 이 후속 작업은 hint 포맷만 바꾸고 verdict 도출 로직을 건드리지 않는다 (`output-schema.md §A5 Co-failure Disambiguation` 우선순위 6 라우팅 불변).

**Verification:**
- `structural_verdict` 필드 값이 정확히 `"P1"` (문자열 리터럴 불변 — 이 fixture로 인해 `PASS`나 `FAIL`로 바뀌지 않음을 확인).
- `인용:` 줄이 bullet 후반부의 "파묻힌" 구절을 정확히 anchor (bullet 앞부분 "여러 팀과 협업하며 다양한 업무를 수행했고"는 인용되지 않음 — 핵심 성과 구절만 quote).
- `제안:` 줄이 재배치/압축 방향의 수정안 (source extraction 요구 아님 — readability 성격의 제안이되 `structural_verdict == P1`이므로 우선순위 6(APPROVE lane) 라우팅과 정합, `output-schema.md §A5 Co-failure Disambiguation` 참조).
- `인용:` 줄 제외 remainder에 canonical axis name 정규식(`Technical Credibility|Causal Honesty|Outcome Presence & Clarity|Ownership & Scope|Scanability`) 0 matches — 특히 `Scanability` 문자열 자체가 `문제:`/`이유:`/`제안:` 어느 줄에도 등장하지 않음.

---

## SCN-11: Clean APPROVE — `interview_hints == []` 회귀 방지 (FX-CLEAN)

**Target Rule:** A1-A4 전부 PASS, `structural_verdict == PASS`, P1 없음 → `interview_hints == []` (SCN-1 계약과 동일하게 유지 — 스캐폴드 포맷 도입이 강점(strength) 코멘트를 새로 만들어내지 않는다).

**Setup:**

Fixture `FX-CLEAN` bullet (제약·기술 선택·메커니즘·트레이드오프·근거·인과·정량 결과·소유권·가독성 모두 충족):
```
결제 PG 동기 호출의 스레드 풀 고갈 병목을, 단순 풀 증설 대신 Kafka 비동기 큐와 서킷브레이커로 분리하고 at-least-once 중복을 idempotency key로 흡수해(개인 설계·구현), 결제 확정 p99를 820ms에서 140ms로, 실패율을 2.1%에서 0.3%로 낮춤
```

`candidate_context`: `years: 7, position: Staff backend engineer, target_company: 핀테크 기업`

examiner 기대 output (GREEN mock):
```yaml
final_verdict: APPROVE
structural_verdict: PASS
interview_hints: []
```

**Expected:** 4-요소 스캐폴드 포맷이 도입되어도, P1이 하나도 없는 완전 clean 케이스에서는 `interview_hints`가 여전히 빈 배열이다 — "잘했다"류의 강점 hint를 새로 만들어 채우지 않는다.

**Verification:**
- `interview_hints == []` (SCN-1의 Verification "user에게 hint 표시 안 함"과 동일 판정).
- 이 fixture는 회귀 테스트로만 존재 — 스캐폴드 포맷을 이 케이스에 강제로 채워 넣는 구현은 REQUEST_CHANGES 대상.

---

## SCN-12: r_phys early-return에도 pending content P1이 실제 emit (FX-RPHYS)

**Target Rule:** `critical_rule_flags.r_phys.triggered == true`로 인한 early-return(`output-schema.md §Critical Rule → Verdict Invariant`, 우선순위 1)이 발생해도, 별개로 pending 중인 content-axis P1이 있다면 그 hint도 **실제로 스캐폴드 형태로 emit**된다 (단순히 "문제가 더 있다"는 카운트/요약이 아니라 완전한 4-라벨 hint).

**Setup:**

Fixture `FX-RPHYS` bullet — 물리적으로 불가능한 수치(r_phys trigger) + 별개의 얕은 outcome 주장(pending A3 P1)이 공존:
```
매일 30시간씩 근무하며 시스템 성능을 개선함
```

examiner 기대 output (GREEN mock):
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - |
    인용: «매일 30시간씩 근무하며»
    문제: 하루는 24시간이므로 "30시간 근무"는 물리적으로 성립할 수 없는 수치
    이유: 명백히 불가능한 숫자가 하나라도 있으면 이력서 전체의 신뢰도가 깎임
    제안: 과장된 표현을 제거 — 실제 근무 강도(예: "주 60시간, 마감 기간엔 야근 잦음")로 수정
  - |
    인용: «시스템 성능을 개선함»
    문제: 무엇을 얼마나 개선했는지 수치가 전혀 없음
    이유: 정량적 근거 없이는 개선의 크기를 가늠할 수 없어 설득력이 떨어짐
    제안: "응답 시간을 800ms→200ms로 단축"처럼 구체적 before/after 수치를 추가
```

**Expected:** r_phys가 최우선순위로 REQUEST_CHANGES를 확정짓지만(critical rule invariant), examiner는 여기서 멈추지 않고 pending 중이던 content-axis P1(막연한 성과 주장)도 별도 hint로 실제 방출한다.

**Verification:**
- `interview_hints` 길이 >= 2 — "critical issue가 더 있음" 류의 단일 요약 문자열이 아니라, 서로 다른 `인용:` anchor를 가진 두 개의 완전한 4-라벨 스캐폴드.
- 첫 hint의 `인용:` 줄이 물리적으로 불가능한 수치 구절(`매일 30시간씩 근무하며`)을 anchor.
- 두 번째 hint의 `인용:` 줄이 별개의 막연한 outcome 구절(`시스템 성능을 개선함`)을 anchor — 서로 다른 substring, 서로 다른 결함.
- 두 hint 모두 `인용:` 줄 제외 remainder에 canonical noleak 정규식 3종 0 matches.

---

## SCN-13: bullet 본문에 axis-모양 토큰 — 인용 라인만 매치, remainder는 clean (FX-TECH-ECHO)

**Target Rule:** noleak 검증은 «»로 감싼 verbatim 줄(즉 `인용:`/`Quote:` 라벨 줄)을 제외한 remainder에 대해서만 수행된다 — 원본 bullet 자체가 우연히 `A[1-5]` 모양 토큰(예: 기술/인스턴스명)을 포함하면 그 인용 줄에는 그 토큰이 그대로(verbatim) 등장할 수 있지만, 이것은 noleak 위반이 아니다.

**Setup:**

Fixture `FX-TECH-ECHO` bullet (AWS 인스턴스 패밀리명 `A1`이 본문에 등장):
```
AWS A1 instances로 배치 처리 파이프라인을 최적화하여 비용을 30% 절감함
```

examiner 기대 output (GREEN mock):
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - |
    인용: «AWS A1 instances로 배치 처리 파이프라인을 최적화»
    문제: 사용한 인스턴스 유형과 조치는 언급했지만 어떤 병목을 해결했는지가 빠져 있음
    이유: 무엇이 느렸고 무엇을 바꿨는지 알아야 기술적 판단력을 평가할 수 있음
    제안: "ARM 기반 저비용 인스턴스로 전환하고 배치 크기를 조정해 비용을 30% 절감"처럼 병목과 해결책을 구체화
```

**Expected:** `인용:` 라인에는 원본 bullet의 verbatim substring인 `AWS A1 instances로 배치 처리 파이프라인을 최적화`가 그대로 들어가며, 여기엔 `A1` 토큰이 포함된다. 이것은 candidate가 실제로 쓴 기술명이 인용된 것일 뿐, examiner가 axis identifier를 누출한 것이 아니다.

**Verification:**
- 전체 hint 문자열에 `grep -E '\bA[1-5]\b'`를 그대로 돌리면 `인용:` 라인에서 1 match가 나는 것이 **정상** (naive 전체-문자열 검사는 false positive를 낸다는 것을 이 fixture로 증명).
- `인용:` 라인을 제거한 나머지 3줄(`문제:`/`이유:`/`제안:`)에만 `grep -E '\bA[1-5]\b'`를 적용하면 0 matches — 이것이 실제 noleak 판정 기준.
- 나머지 두 canonical 정규식(axis name alternation, internal struct)도 `인용:` 줄 제외 remainder에서 0 matches.
- 이 fixture는 SCN-6(HTML report noleak)의 실행 방식과 구분된다: SCN-6은 렌더된 HTML 전체를 검사하는 반면, 이 fixture는 raw hint 문자열 레벨에서 "`인용:` 줄 제외" 전처리가 선행되어야 함을 규정한다 — review-resume의 HTML 렌더러는 `인용:` 라인을 별도 마크업(예: blockquote)으로 렌더링하고 noleak 검사기는 그 라인을 알고 제외해야 한다.

---

## SCN-14: English bullet — English-label scaffold, «» language-agnostic noleak (FX-EN)

**Target Rule:** source bullet이 영어면 4개 라벨이 영어(`Quote:`/`Problem:`/`Why:`/`Suggestion:`)로 emit되고, noleak 검증은 «» verbatim 줄 제외 후 나머지에 정준 3정규식 0 matches.

**Setup:**

Fixture `FX-EN` bullet:
```
Built a Scanability monitoring dashboard on AWS A1 instances and greatly improved service response time.
```

Dispatch payload (first dispatch):
```
## Bullet
Built a Scanability monitoring dashboard on AWS A1 instances and greatly improved service response time.

## Proposed Alternatives
None — initial evaluation
```

examiner 기대 output (GREEN mock, PUBLIC fields만):
```yaml
final_verdict: REQUEST_CHANGES
interview_hints:
  - |
    Quote: «greatly improved service response time»
    Problem: The result is stated only qualitatively with "greatly" and carries no before/after figures.
    Why: "Greatly" cannot be verified or compared — a reader has no sense of how large the improvement was.
    Suggestion: Replace "greatly" with a concrete before→after metric, e.g., "reduced p95 response time from 800ms to 200ms (75% faster)."
```

**Expected:** review-resume이 이 hint를 그대로 user에게 표시. 라벨이 English(`Quote:`/`Problem:`/`Why:`/`Suggestion:`)로 emit되며 한국어 라벨(인용/문제/이유/제안)은 등장하지 않는다. `Quote:` 줄은 원본 bullet의 verbatim substring이며 «»로 감싼다.

**Verification:**
- `Quote:` / `Problem:` / `Why:` / `Suggestion:` 4개 라벨이 hint 문자열 내 각각 별도 줄로 1회씩 등장.
- `Quote:` 줄(«» 줄)에는 "AWS A1"/"Scanability" 같은 토큰이 원본 bullet에서 온 것이라면 정당하게 등장할 수 있다.
- «» 줄 제외 remainder(`Problem:`/`Why:`/`Suggestion:` 3줄)에 canonical noleak 정규식 3종(`\bA[1-5]\b` / axis name alternation / `verdicts\.|critical_rule_flags\.|evidence_quote|reasoning:`) 각각 0 matches.
- 한국어 라벨(인용/문제/이유/제안)이 hint 문자열 어디에도 등장하지 않는다.

---
