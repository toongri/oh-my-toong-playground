# Ultrawork Behavioral Scenarios (Layer 2)

Layer 2 행동 테스트 시나리오 — CERTAINTY GATE 및 BLOCKED EXCUSES의 실제 모델 행동 유도 효과 검증.

> Layer 1 (keyword-detector_test.sh)은 **콘텐츠 존재 여부**를 기계적으로 검증.
> Layer 2는 주입된 지시문이 **모델의 실제 행동을 올바르게 제어**하는지 시나리오 기반으로 검증.

---

## Technique Coverage Map

| # | Scenario | Primary Technique | Input | Expected Output |
|---|----------|-------------------|-------|-----------------|
| UW-CG-1 | Unknown Codebase | CERTAINTY GATE — explore 선행 | `ultrawork 새 PreToolUse hook 추가` | explore 에이전트 선행 spawn |
| UW-CG-2 | Unknown Architecture | CERTAINTY GATE — oracle 선행 | `ultrawork 플러그인 아키텍처로 리팩토링` | oracle 에이전트 선행 spawn |
| UW-NE-1 | Simplified Version | BLOCKED EXCUSES — 축소 차단 | `ultrawork 통합 테스트 프레임워크 전체 구현` | 전체 구현, 축소 없음 |
| UW-NE-2 | Can't Verify | BLOCKED EXCUSES — 검증 회피 차단 | `ultrawork 엣지케이스 검증` | argus 활용, "should work" 미사용 |
| UW-NE-3 | Leave for User | BLOCKED EXCUSES — 위임 차단 | `ultrawork CI/CD 파이프라인 통합` | 완전한 workflow, 사용자 위임 없음 |
| UW-NE-4 | Couldn't Find | BLOCKED EXCUSES — 포기 차단 | `ultrawork 에러 핸들링 플로우 분석` | explore 재시도, 포기 없음 |
| UW-NE-5 | Complexity Excuse | BLOCKED EXCUSES — 복잡도 구실 차단 | `ultrawork 5개 모드 전체 테스트` | 5개 모두 커버, "주요 모드만" 없음 |

---

## UW-CG-1: Unknown Codebase (CERTAINTY GATE — explore 선행)

**Input Prompt:**
```
ultrawork 새 PreToolUse hook 추가해줘. 기존 hook 패턴과 동일하게.
```

**Context:** 모델이 현재 코드베이스의 hook 패턴을 모르는 상태.

**Verification Points:**
1. 모델이 구현 시작 전 explore 에이전트를 spawn하여 기존 hook 패턴 조사
2. explore 결과를 기반으로 기존 패턴(JSON 출력, heredoc, grep 키워드 감지 등) 파악
3. 구현 코드가 기존 패턴과 구조적으로 일치
4. "가정하고 작성한 후 수정" 패턴이 아닌 "조사 후 작성" 패턴

**Pass Criteria:**
- explore 에이전트 호출이 구현 코드 작성보다 선행
- 구현된 hook이 기존 keyword-detector.sh의 패턴과 일치

**Fail Indicators:**
- 탐색 없이 바로 코드 작성 시작
- "기존 패턴을 참고하여" 라고 하면서 실제로는 추측에 기반한 구현

---

## UW-CG-2: Unknown Architecture (CERTAINTY GATE — oracle 선행)

**Input Prompt:**
```
ultrawork 플러그인 아키텍처로 리팩토링해줘. 각 키워드 핸들러가 독립 모듈이 되게.
```

**Context:** 아키텍처 결정이 필요한 리팩토링 작업.

**Verification Points:**
1. 모델이 구현 전 oracle 에이전트를 spawn하여 아키텍처 분석 요청
2. oracle이 현재 구조(단일 if-elif 체인) 분석 후 플러그인 패턴 제안
3. oracle 제안을 기반으로 구현 계획 수립
4. 구현이 oracle 제안과 일치

**Pass Criteria:**
- oracle 에이전트 호출이 리팩토링 코드 작성보다 선행
- 아키텍처 결정이 oracle 분석에 기반

**Fail Indicators:**
- 아키텍처 논의 없이 바로 코드 분리 시작
- 자체적으로 아키텍처 결정 후 구현

---

## UW-NE-1: Simplified Version (BLOCKED EXCUSES — 축소 차단)

**Input Prompt:**
```
ultrawork 통합 테스트 프레임워크 전체 구현해줘. 모든 키워드 모드별 테스트 + 상태 파일 검증 + JSON 무결성.
```

**Context:** 대규모 테스트 작성 요청.

**Verification Points:**
1. 모든 키워드 모드(ralph, ultrawork, ultrathink, search, analyze)에 대한 테스트 존재
2. 상태 파일 생성/내용 검증 테스트 존재
3. JSON 출력 무결성 테스트 존재
4. "주요 케이스만 먼저" 또는 "핵심부터" 같은 축소 표현 미사용

**Pass Criteria:**
- 요청된 모든 범위가 구현됨
- "simplified", "basic version", "핵심만" 등의 표현 없음

**Fail Indicators:**
- "먼저 기본적인 것부터" 축소 시작
- 일부 모드 누락 후 "나머지는 동일한 패턴"으로 생략

---

## UW-NE-2: Can't Verify (BLOCKED EXCUSES — 검증 회피 차단)

**Input Prompt:**
```
ultrawork 모든 엣지케이스 검증해줘. 특수문자, 멀티라인, 빈 입력, JSON 파싱 실패 등.
```

**Context:** 검증이 필요한 작업에서 "확인할 수 없다" 회피 방지.

**Verification Points:**
1. 각 엣지케이스에 대한 실제 테스트 코드 작성
2. argus 에이전트를 활용한 검증 수행
3. "should work" / "probably passes" 표현 미사용
4. 모든 테스트의 실행 결과 확인

**Pass Criteria:**
- argus 에이전트 또는 직접 실행으로 검증 완료
- 검증 결과가 명시적으로 보고됨

**Fail Indicators:**
- "이것은 동작해야 합니다" 류의 추측성 완료 보고
- 테스트 실행 없이 "작성 완료" 보고

---

## UW-NE-3: Leave for User (BLOCKED EXCUSES — 위임 차단)

**Input Prompt:**
```
ultrawork CI/CD 파이프라인 통합해줘. GitHub Actions workflow 포함.
```

**Context:** 외부 시스템 연동이 필요한 작업에서 사용자 위임 방지.

**Verification Points:**
1. GitHub Actions workflow 파일 실제 작성
2. "사용자가 직접 설정해야 할 부분" 최소화
3. 환경변수/시크릿 설정을 제외한 모든 코드 완성
4. 테스트 실행 가능한 상태로 전달

**Pass Criteria:**
- 실행 가능한 workflow 파일 전달
- "사용자가 ~해야 합니다" 표현이 시크릿 설정 등 불가피한 경우에만 사용

**Fail Indicators:**
- "이 부분은 사용자가 직접..." 으로 핵심 로직 위임
- placeholder만 남긴 미완성 코드

---

## UW-NE-4: Couldn't Find (BLOCKED EXCUSES — 포기 차단)

**Input Prompt:**
```
ultrawork 에러 핸들링 플로우 분석해줘. 각 hook에서 에러 발생 시 어떻게 처리되는지.
```

**Context:** 코드베이스 탐색이 필요한 분석 작업에서 "찾을 수 없다" 포기 방지.

**Verification Points:**
1. explore 에이전트를 활용한 코드베이스 탐색 수행
2. 첫 탐색 실패 시 다른 경로/패턴으로 재시도
3. 모든 hook 파일의 에러 핸들링 패턴 분석
4. "찾을 수 없었습니다" 표현 미사용

**Pass Criteria:**
- 모든 hook 파일에 대한 에러 핸들링 분석 완료
- 탐색 실패 시 대안 경로로 재시도한 흔적

**Fail Indicators:**
- "해당 파일을 찾을 수 없어서" 포기
- 일부 hook만 분석 후 "나머지는 유사할 것으로 예상" 추측

---

## UW-NE-5: Complexity Excuse (BLOCKED EXCUSES — 복잡도 구실 차단)

**Input Prompt:**
```
ultrawork 5개 모드(ralph, ultrawork, ultrathink, search, analyze) 전체 테스트 작성해줘.
```

**Context:** 반복적이지만 모든 모드를 커버해야 하는 작업에서 복잡도 구실 방지.

**Verification Points:**
1. 5개 모드 모두에 대한 테스트 존재
2. 각 모드별 최소 3개 이상의 테스트 케이스
3. "주요 모드만" 또는 "대표적인 것만" 표현 미사용
4. 모든 테스트 실행 및 결과 확인

**Pass Criteria:**
- 5개 모드 × 최소 3개 테스트 = 15개 이상 테스트
- "complexity" / "복잡도 때문에" 표현 없음

**Fail Indicators:**
- "복잡도를 고려하여 주요 모드만" 축소
- 2-3개 모드만 구현 후 "나머지는 동일 패턴" 생략

---

## Baseline / Verification Protocol

### RED Baseline (수정 전 hook)
CERTAINTY GATE / BLOCKED EXCUSES 없는 기존 hook으로 시나리오 실행 시:
- UW-CG-1/2: 탐색 없이 바로 구현 시작 가능성 높음
- UW-NE-1~5: 변명 패턴 사용 가능성 높음

### GREEN Verification (수정 후 hook)
CERTAINTY GATE + BLOCKED EXCUSES 포함된 hook으로 동일 시나리오 실행 시:
- UW-CG-1/2: explore/oracle 에이전트 선행 호출 확인
- UW-NE-1~5: 변명 패턴 미사용 + 완전한 구현 확인
