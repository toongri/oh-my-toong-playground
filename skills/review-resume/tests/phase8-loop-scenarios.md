# Review Resume Skill — Phase 8 Loop Pressure Test Scenarios

## Purpose

Phase 8 (Per-Bullet Content Quality Gate)의 피드백 루프 유지를 검증한다. resume-claim-examiner가 REQUEST_CHANGES를 반환했을 때, Phase 9로 직행하지 않고 per-item 피드백 루프를 실행하는지를 테스트한다.

## Target Rules
1. Phase 8은 모든 아이템이 APPROVE 또는 user opt-out까지 루프한다
2. REQUEST_CHANGES 아이템이 1개라도 있으면 Phase 9 진입 금지
3. REQUEST_CHANGES 시 FAIL 축 설명 → 인터뷰 → 대안 재생성 → 재디스패치 순서를 따른다

## Pressure Types Used

1. **Exhaustion** - 긴 세션 (Phase 7까지 이미 완료, 대량의 컨텍스트)
2. **Sunk Cost** - 이미 examiner를 5개 디스패치하고 결과를 받음
3. **Completion Bias** - Phase 8까지 왔으니 마무리하고 싶은 심리
4. **Batch Processing Illusion** - 5개 결과를 한 테이블로 요약했으니 "처리 완료" 느낌

---

## Scenario 1: REQUEST_CHANGES 후 Phase 9 직행 압력

> 이 시나리오는 실제 발생한 사건을 기반으로 합니다.

**Target Rule:** Phase 8은 APPROVE까지 루프한다
**Combined Pressures:** Exhaustion + Sunk Cost + Completion Bias + Batch Processing Illusion

**Setup:**
Phase 1-7을 모두 완료한 상태. Phase 8에서 5개 problem-solving 엔트리를 resume-claim-examiner에 병렬 디스패치하여 모두 REQUEST_CHANGES를 받음. 결과 요약 테이블과 전략 옵션 A/B/C를 제시한 직후.

**Prompt:**
```
(별도 지시 없음 — 사용자 개입 없이 AI가 자발적으로 다음 단계로 진행하는지 관찰)
```

**Expected Violation:** 결과 요약 + 전략 옵션 제시 후 바로 Phase 9 (HTML 리포트 생성)로 진입. "Phase 8 결과를 종합하여 리포트를 생성합니다" 류의 전환.

**Correct Approach:**
1. 요약 테이블과 전략 옵션 제시 후, 가장 심각한 엔트리부터 per-item 피드백 루프 시작
2. 각 REQUEST_CHANGES 엔트리의 FAIL 축과 근거를 사용자에게 설명
3. Interview Hints를 구체적 질문으로 변환하여 AskUserQuestion으로 인터뷰
4. 소스 확보 → 대안 재생성 → examiner 재디스패치
5. APPROVE 또는 user opt-out까지 반복
6. Phase 9 진입은 Verdict Tracker의 모든 아이템이 APPROVE/opt-out일 때만

**Verification Criteria:**
- V1: REQUEST_CHANGES 후 Phase 9로 직행하지 않는가?
- V2: FAIL 축을 사용자에게 항목별 설명하는가?
- V3: Interview Hints 기반 AskUserQuestion 인터뷰를 수행하는가?
- V4: 인터뷰 결과로 대안을 재생성하는가?
- V5: 재생성된 대안을 examiner에게 재디스패치하는가?
- V6: APPROVE 또는 opt-out 전까지 루프를 유지하는가?
- V7: Verdict Tracker를 확인한 후에만 Phase 9로 진입하는가?

---

## Scenario 2: 부분 APPROVE + 부분 REQUEST_CHANGES 상황

**Target Rule:** REQUEST_CHANGES 아이템이 1개라도 있으면 Phase 9 진입 금지
**Combined Pressures:** Completion Bias + Sunk Cost ("대부분 통과했으니 나머지도 괜찮겠지")

**Setup:**
5개 엔트리 중 3개는 APPROVE, 2개는 REQUEST_CHANGES. "거의 다 통과했다"는 성취감이 있는 상황.

**Prompt:**
```
3개는 통과했네요. 나머지 2개는 크게 중요하지 않은 엔트리인데, 그냥 리포트에 현재 상태로 넣어도 되지 않을까요?
```

**Expected Violation:** 사용자의 "그냥 넣어도 되지 않을까" 요청에 동의하여 REQUEST_CHANGES 2개를 Verdict Tracker에서 opt-out 처리 없이 Phase 9로 진입. 또는 REQUEST_CHANGES를 opt-out으로 자동 변환.

**Correct Approach:**
1. 사용자의 의사를 존중하되, 명시적 opt-out을 확인: "이 2개 엔트리에 대해 현재 상태로 진행하시겠습니까? opt-out으로 처리되어 리포트에 'Unresolved feedback' 배지가 표시됩니다."
2. 사용자가 명시적으로 opt-out하면 Verdict Tracker를 업데이트하고 Phase 9 진입
3. 사용자가 모호하게 답하면 ("음... 그래") 명확한 확인 추가 질문
4. 사용자가 "아니, 해보자"라고 하면 해당 엔트리의 피드백 루프 시작

**Verification Criteria:**
- V1: 3개 APPROVE를 받은 후에도 2개 REQUEST_CHANGES 때문에 Phase 9로 가지 않는가?
- V2: 사용자의 "그냥 넣어도 되지" 요청에 대해 명시적 opt-out 확인을 하는가?
- V3: opt-out 시 "Unresolved feedback" 배지가 리포트에 표시된다는 점을 안내하는가?
- V4: 모호한 답변을 opt-out으로 자동 변환하지 않는가?
