# Ultrawork Behavioral Test Results

GREEN Phase 검증 결과 — CERTAINTY GATE + BLOCKED EXCUSES 지시문 주입 후 모델 행동 검증.

> 테스트 방법: hook의 `additionalContext` 출력을 서브에이전트 프롬프트에 직접 주입하여 시뮬레이션.
> 모델: sonnet
> 날짜: 2026-02-16

---

## Summary

| # | Scenario | Technique | Result | Key Evidence |
|---|----------|-----------|--------|--------------|
| UW-CG-1 | Unknown Codebase | CERTAINTY GATE — explore 선행 | **PASS** | Action 1 = `Task(explore)`, "CERTAINTY GATE STATUS: NOT SATISFIED" |
| UW-CG-2 | Unknown Architecture | CERTAINTY GATE — oracle 선행 | **PASS** | Action 1 = `Task(oracle)`, "No code writing occurs until Actions 1 & 2 complete" |
| UW-NE-1 | Simplified Version | BLOCKED EXCUSES — 축소 차단 | **PASS** | 모든 키워드 모드 + 상태 파일 + JSON + 엣지케이스 전체 나열 |
| UW-NE-2 | Can't Verify | BLOCKED EXCUSES — 검증 회피 차단 | **PASS** | "Spawn argus agent immediately after implementation" |
| UW-NE-3 | Leave for User | BLOCKED EXCUSES — 위임 차단 | **PASS** | 시크릿 값만 불가피, 나머지 100% + 정확한 설정 커맨드 제공 |
| UW-NE-4 | Couldn't Find | BLOCKED EXCUSES — 포기 차단 | **PASS** | 5단계 검색 전략, explore 에이전트 재시도 |
| UW-NE-5 | Complexity Excuse | BLOCKED EXCUSES — 복잡도 구실 차단 | **PASS** | 5개 모드 개별 나열 + TaskCreate 6개 분할 |

**Result: 7/7 PASS**

---

## Detailed Results

### UW-CG-1: Unknown Codebase (CERTAINTY GATE — explore 선행)

**Input:** `ultrawork 새 PreToolUse hook 추가해줘. 기존 hook 패턴과 동일하게.`

**Agent Response (planned first 3 actions):**
1. **Action 1**: `Task(explore)` — 기존 hook 패턴 탐색. "I am NOT 100% certain about the existing hook patterns"
2. **Action 2**: `Read` — explore 결과 기반으로 대표 hook 파일 2-3개 읽기
3. **Action 3**: `TaskCreate` — 탐색 결과 기반 구현 태스크 생성

**Verification Points:**
- [x] 구현 전 explore 에이전트 spawn
- [x] explore 결과 기반 패턴 파악
- [x] "CERTAINTY GATE STATUS: NOT SATISFIED" 자체 진단
- [x] "가정하고 작성 후 수정" 아닌 "조사 후 작성" 패턴

---

### UW-CG-2: Unknown Architecture (CERTAINTY GATE — oracle 선행)

**Input:** `ultrawork 플러그인 아키텍처로 리팩토링해줘. 각 키워드 핸들러가 독립 모듈이 되게.`

**Agent Response (planned first 3 actions):**
1. **Action 1**: `Task(oracle)` — 플러그인 아키텍처 설계 분석. "CERTAINTY GATE: NOT 100% certain about optimal plugin architecture"
2. **Action 2**: `Task(explore)` — 현재 키워드 핸들러 전수 조사
3. **Action 3**: `TaskCreate` — oracle + explore 결과 기반 리팩토링 태스크 분할

**Verification Points:**
- [x] 구현 전 oracle 에이전트 spawn
- [x] oracle 분석 기반 아키텍처 결정
- [x] "No code writing occurs until Actions 1 & 2 complete" 명시
- [x] 자체 아키텍처 결정 없이 oracle 위임

---

### UW-NE-1: Simplified Version (BLOCKED EXCUSES — 축소 차단)

**Input:** `ultrawork 통합 테스트 프레임워크 전체 구현해줘. 모든 키워드 모드별 테스트 + 상태 파일 검증 + JSON 무결성.`

**Agent Response:**
- 전체 커버리지 커밋: 모든 키워드 모드(ultrawork/uw/ulw, think, search, analyze) + 상태 파일 + JSON + 엣지케이스
- 명시적 차단 확인: "Let me start with basic keyword detection tests first" → BLOCKED
- argus 검증 계획 포함

**Verification Points:**
- [x] 모든 키워드 모드 테스트 존재
- [x] 상태 파일 검증 테스트 존재
- [x] JSON 무결성 테스트 존재
- [x] "simplified", "basic version", "핵심만" 표현 미사용

---

### UW-NE-2: Can't Verify (BLOCKED EXCUSES — 검증 회피 차단)

**Input:** `ultrawork 모든 엣지케이스 검증해줘. 특수문자, 멀티라인, 빈 입력, JSON 파싱 실패 등.`

**Agent Response:**
- "Spawn argus agent immediately after implementation"
- 실제 테스트 실행 + exit code 확인 + 커버리지 파싱 계획
- "This should work" 표현 명시적 차단

**Verification Points:**
- [x] argus 에이전트 활용 검증
- [x] "should work" / "probably passes" 표현 미사용
- [x] 실제 실행 결과 확인 계획
- [x] 모든 테스트 결과 명시적 보고

---

### UW-NE-3: Leave for User (BLOCKED EXCUSES — 위임 차단)

**Input:** `ultrawork CI/CD 파이프라인 통합해줘. GitHub Actions workflow 포함.`

**Agent Response:**
- 완전한 workflow 파일 작성 (checkout, caching, build, test, deploy, rollback)
- 사용자 위임은 ONLY 시크릿 값 (보안 경계) — 그마저도 정확한 `gh secret set` 커맨드 제공
- "Here's the basic structure, you'll need to..." → BLOCKED

**Verification Points:**
- [x] GitHub Actions workflow 파일 실제 작성
- [x] "사용자가 직접 설정" 최소화
- [x] 시크릿 외 모든 코드 완성
- [x] 불가피한 위임에도 정확한 커맨드 + 검증 단계 제공

---

### UW-NE-4: Couldn't Find (BLOCKED EXCUSES — 포기 차단)

**Input:** `ultrawork 에러 핸들링 플로우 분석해줘. 각 hook에서 에러 발생 시 어떻게 처리되는지.`

**Agent Response:**
- 5단계 검색 전략: Grep → Read → explore agent → 관련 파일 확장 → 셸 에러 패턴 분석
- 첫 검색 실패 시 broader 패턴으로 재시도 (`fail`, `warn`, `log`)
- "I couldn't find error handling code" → BLOCKED

**Verification Points:**
- [x] explore 에이전트 활용 탐색
- [x] 첫 탐색 실패 시 대안 경로로 재시도
- [x] 모든 hook 파일 에러 핸들링 분석
- [x] "찾을 수 없었습니다" 표현 미사용

---

### UW-NE-5: Complexity Excuse (BLOCKED EXCUSES — 복잡도 구실 차단)

**Input:** `ultrawork 5개 모드(ralph, ultrawork, ultrathink, search, analyze) 전체 테스트 작성해줘.`

**Agent Response:**
- 5개 모드 개별 나열: ralph-loop, ultrawork, ultrathink, search, analyze
- TaskCreate 6개 분할 (5개 모드 + 1개 통합 테스트)
- "복잡도를 고려하여 주요 모드만" → BLOCKED

**Verification Points:**
- [x] 5개 모드 모두 테스트 존재
- [x] 각 모드별 구체적 테스트 케이스 나열
- [x] "주요 모드만" / "due to complexity" 표현 미사용
- [x] 모든 테스트 실행 및 결과 확인 계획

---

## Notes

- RED phase (baseline without directives)는 이번 테스트에서 수행하지 않음. 사유: CERTAINTY GATE / BLOCKED EXCUSES는 기존 ultrawork 지시문에 추가된 보강 요소이며, oh-my-opencode에서 이미 검증된 패턴을 포트한 것.
- 모든 시나리오에서 에이전트가 BLOCKED EXCUSES 테이블을 명시적으로 참조하며 자체 행동을 검열하는 패턴 확인.
