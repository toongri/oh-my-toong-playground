# Task 10 Evidence — A2 Chained vs Isolated sub-check 추가

## Change 1: `skills/tech-claim-rubric/a2-causal-honesty.md`

### Before
```
## Three Sub-checks
1. **Causal Chain Validity**: 원인→결과 chain이 직접적 or 각 단계 명시
2. **Arithmetic Consistency**: 수치(%, 배수, 절대값)가 내부 일관
3. **Constraint Resolution**: 명시된 제약이 해결되거나 explicit accept
```

### After
```
## Three Sub-checks
1. **Causal Chain Validity**: 원인→결과 chain이 직접적 or 각 단계 명시
2. **Arithmetic Consistency**: 수치(%, 배수, 절대값)가 내부 일관
3. **Constraint Resolution**: 명시된 제약이 해결되거나 explicit accept
4. **(Trigger-conditioned) Chained vs Isolated problem resolution**: bullet이 2+ 문제/제약을 언급할 때만 판정. 단일 문제 bullet은 이 sub-check 대상이 아니며 자동 PASS (N/A). 다중 문제일 때 — **Chained**(선행 해결이 후행 문제를 드러냄, 제약이 연쇄적으로 풀림)는 강한 긍정 신호, **Isolated**(병렬 나열, 독립적 해결)는 중립 PASS. 어느 쪽이든 penalty는 없음. Junior/Mid/Senior 구분 없이 모든 경력 레벨에 동일 적용 — calibration 없음 (A2는 Absolute 축).
```

Sub-check 목록이 3개에서 4개로 확장. "calibration 없음 (A2는 Absolute 축)" 명시로 senior-only 오독 방지.

---

## Change 2: `skills/tech-claim-rubric/tests/scenarios.md`

### Before (SCN-17 다음, Coverage Matrix 이전)
SCN-17이 마지막 scenario. Coverage Matrix가 바로 이어짐.

### After
SCN-18 추가 (SCN-17과 Coverage Matrix 사이):

```
### SCN-18: A2 Chained pattern — 다중 제약 순차 해결

Bullet: 주문 이벤트 파이프라인 p99 800ms → DB write contention 식별 → user_id 파티셔닝 → hot key rebalance 문제 드러남 → consistent hashing 재설계 → p99 800ms→120ms, hot key imbalance <5%
Candidate: years 5, Backend Engineer, 커머스 플랫폼
Expected: 5축 모두 PASS, critical rules 모두 false, APPROVE
Purpose: sub-check 4 Chained 신호 검증
```

Coverage Matrix (SCN 목록, Axis Boundary Coverage, Critical Rule Coverage) 3개 테이블 모두 SCN-18 반영 업데이트.
