# Phase 9 Loop Scenarios (5-axis blackbox contract)

review-resume의 Phase 9 (Per-Bullet Content Quality Gate) loop 동작 검증. examiner는 blackbox로 호출되며 review-resume은 PUBLIC contract만 소비.

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
(Note: batch dispatch + summary table은 SKILL.md L492-499 Red Flag pattern — loop continuation이 정답, Phase 10 진입이 오답.)

**Expected:** 결과 요약 후에도 Phase 10으로 진입하지 않고 per-bullet 피드백 루프를 계속 실행.

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
1. 사용자의 의사를 존중하되, 명시적 opt-out 확인: "이 2개 bullet에 대해 현재 상태로 진행하시겠습니까? 리포트에 'Unresolved feedback' 배지가 표시됩니다."
2. 사용자가 명시적으로 opt-out → 해당 bullet을 opt-out으로 기록 → Phase 10 진입.
3. 사용자가 모호하게 답변 → 명확한 재확인 질문.
4. 사용자가 "아니, 해보자" → 해당 bullet의 수정 루프 시작.

**Verification:**
- 3개 APPROVE 후에도 2개 REQUEST_CHANGES 때문에 Phase 10 미진입.
- 사용자의 "그냥 넣어도 되지" 요청에 명시적 opt-out 확인 수행.
- opt-out 시 "Unresolved feedback" 배지 안내.
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

## SCN-6: HTML axis label noleak verification

**Target Rule:** HTML report에 examiner internal field가 노출되어서는 안 된다.

**Setup:** SCN-1 또는 SCN-2의 examiner output으로 HTML report 렌더링.

**Expected:** HTML report 출력에 `output-schema.md §Prohibited Token Patterns for review-resume` 의 3개 정규식 각각에 대해 0 matches.

**Verification**: 각 pattern을 rendered HTML에 `grep -E` 실행:
- Axis identifier `\bA[1-5]\b` → 0 matches
- Axis name (5축 정식 이름 alternation) → 0 matches
- Internal struct (`verdicts.`, `critical_rule_flags.`, `evidence_quote`, `reasoning:`) → 0 matches

Pattern 본문은 `skills/tech-claim-rubric/output-schema.md §Prohibited Token Patterns for review-resume`에서 canonical 관리. 축 이름 변경 시 그 표만 갱신하면 SCN-6은 자동으로 따라간다.
