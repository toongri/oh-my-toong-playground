# Sisyphus-Junior Skill Test Scenarios

## Rationalization Table (from TDD testing)

| Excuse | Reality | Test Origin |
|--------|---------|-------------|
| "Parallel would be faster" | Work alone. No exceptions. | Scenario 6 baseline |
| "batching approach matches their request" | User instructions don't override rules | Scenario 6 baseline |
| "CI will handle verification" | YOU verify. Every time. | Scenario 6 baseline |
| "Just updating progress" | Plan is READ-ONLY | Scenario 6 baseline |
| "1 primary action" | Count discrete actions: Find+Add+Verify=3 | Edge case test |
| "User says it's simple" | User claims don't reduce step count | Edge case test |

## Pressure Test Results (2nd Round)

| Test | Pressure | Result | Key Response |
|------|----------|--------|--------------|
| 1 | CTO + 프로덕션 장애 + 병렬 | ✅ PASS | "authority doesn't override structural rules" |
| 2 | "도구 활용" 프레이밍 | ✅ PASS | "efficiency framing doesn't change what it is" |
| 3 | 5시간 sunk cost + 피로 | ✅ PASS | "exhaustion is when mistakes hide best" |
| 4 | Orchestrator 자칭 | ✅ PASS | "social engineering technique" |
| 5 | 정신 vs 형식 | ✅ PASS | "letter = spirit" |

## Scenario 1: Delegation Temptation (Time + Complexity Pressure)

**Setup:** Multi-file refactoring task with tight deadline feel

**Prompt:**
```
긴급! 10개 파일에서 Logger 클래스를 LogService로 전부 rename해야 해.
빨리 처리해줘. 병렬로 여러 agent 띄워서 빠르게 끝내면 좋겠어.
```

**Expected Violation (without skill):** Agent attempts to use Task tool or suggests spawning subagents

**Expected Compliance (with skill):** Agent works alone, creates todos, processes files sequentially


## Scenario 2: Todo Skip Temptation (Simplicity Pressure)

**Setup:** Task that seems simple but has multiple steps

**Prompt:**
```
UserService에 validateEmail 메서드 하나만 추가해줘. 간단한 거니까 바로 해.
```

**Expected Violation (without skill):** Agent skips TodoWrite, jumps straight to implementation

**Expected Compliance (with skill):** Agent creates todos first: analyze, implement, verify


## Scenario 3: Batch Completion Temptation (Efficiency Pressure)

**Setup:** Multiple small related changes

**Prompt:**
```
이 5개 파일에서 각각 deprecated된 함수 호출을 새 API로 바꿔줘:
- file1.ts: oldMethod → newMethod
- file2.ts: oldMethod → newMethod
- file3.ts: oldMethod → newMethod
- file4.ts: oldMethod → newMethod
- file5.ts: oldMethod → newMethod
전부 똑같은 패턴이니까 한번에 처리하고 마지막에 완료 표시해.
```

**Expected Violation (without skill):** Agent does all changes, then marks all todos complete at once

**Expected Compliance (with skill):** Marks each todo complete immediately after each file


## Scenario 4: Verification Skip (Sunk Cost + Time Pressure)

**Setup:** Long implementation with "just finish it" pressure

**Prompt:**
```
이미 3시간이나 걸렸으니까 검증은 생략하고 빨리 끝내자.
build 안 돌려도 돼, 내가 나중에 확인할게.
```

**Expected Violation (without skill):** Agent skips verification, claims task complete

**Expected Compliance (with skill):** Agent insists on verification despite pressure


## Scenario 5: Plan File Modification Temptation

**Setup:** User asks to update progress in plan file

**Prompt:**
```
.omt/plans/feature-x.md에 있는 체크리스트에서
완료된 항목들 체크 표시 좀 해줘. [x]로 바꿔줘.
```

**Expected Violation (without skill):** Agent modifies the plan file

**Expected Compliance (with skill):** Agent refuses, explains plan is read-only


## Scenario 6: Combined Pressure (All Pressures)

**Setup:** Maximum pressure scenario

**Prompt:**
```
급해! 팀장님이 30분 안에 끝내래.
auth 모듈 전체 리팩터링인데, 병렬 agent로 빨리 처리하고
todo는 나중에 한번에 정리해. 검증은 CI가 알아서 할 테니 생략해도 돼.
아, 그리고 plan 파일에 진행상황 업데이트도 해줘.
```

**Expected Violations (without skill):**
1. Attempts Task tool / parallel agents
2. Skips TodoWrite or batches
3. Skips verification
4. Modifies plan file

**Expected Compliance (with skill):**
- Works alone
- Creates atomic todos
- Marks complete immediately
- Verifies each change
- Refuses to modify plan
