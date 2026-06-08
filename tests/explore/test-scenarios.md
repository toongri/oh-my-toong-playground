# Explore Agent - Application Test Scenarios

## Purpose

These scenarios test whether the explore agent's core techniques are correctly applied. Each scenario targets output format compliance, decision tree navigation, workflow patterns, anti-pattern avoidance, and intent understanding.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| E-1 | Output Format Compliance | Output Format (MANDATORY) | Section structure |
| E-2 | Decision Tree - Known File Path | Decision Tree - Start From What You Know | Token efficiency |
| E-3 | Decision Tree - Known Symbol | Decision Tree - Symbol name only | Codebase-wide search |
| E-4 | Workflow - Find Who Calls | Workflow Example - Scenario 4 | Approximate reference search (candidate set, verify) |
| E-5 | Anti-Pattern Avoidance | Anti-Patterns + Core Principle (Token Efficiency) | Precision querying |
| E-6 | Intent Understanding | Success Criteria - Intent | Actual Need vs Literal Request |

---

## Scenario E-1: Output Format Compliance (analysis + results)

**Primary Technique:** Output Format (MANDATORY)

**Prompt:**
```
AuthService의 login 메서드는 어디에 구현되어 있고, 어떤 클래스들이 이를 호출하는가?
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | analysis block | `<analysis>` 블록 존재 (Literal Request, Actual Need, Success Looks Like) |
| V2 | results block | `<results>` 블록 존재 |
| V3 | files section | `<files>` 섹션에 절대 경로 + 관련 이유 |
| V4 | relationships section | `<relationships>` 섹션에 파일/패턴 간 연결 설명 |
| V5 | answer section | `<answer>` 섹션에 직접 답변 |
| V6 | next_steps section | `<next_steps>` 섹션 존재 |

---

## Scenario E-2: Decision Tree - Known File Path

**Primary Technique:** Decision Tree - Start From What You Know (file path known)

**Prompt:**
```
src/auth/AuthService.kt 파일의 주요 메서드 구조를 분석해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Direct structural outline | 알려진 파일에 대해 `ast-grep` 구조 아웃라인(top-level 심볼)을 바로 호출 |
| V2 | No unnecessary pre-call | 불필요한 디렉터리 나열 선행 호출 없음 |
| V3 | Precise lookup | 필요 시 `Grep` 또는 `Read(offset/limit)`로 특정 메서드 body를 표적 조회 |

---

## Scenario E-3: Decision Tree - Known Symbol, Unknown Location

**Primary Technique:** Decision Tree - Symbol name only

**Prompt:**
```
PaymentProcessor 클래스의 위치와 메서드 구성을 알려줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Repo-wide search | `ast-grep` + `Grep`로 심볼명 `PaymentProcessor`를 경로 제한 없이 전체 코드베이스 검색 |
| V2 | Targeted method list | 검색 결과에서 위치 확인 후 `ast-grep` 구조 아웃라인으로 메서드 목록 조회 |
| V3 | Absolute paths | 결과에 절대 경로 포함 |

---

## Scenario E-4: Workflow - Find Who Calls a Method

**Primary Technique:** Workflow Example - Scenario 4 (approximate reference search)

**Prompt:**
```
AuthService의 login 메서드를 호출하는 모든 코드를 찾아줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Locate definition first | 먼저 `login` 정의를 찾은 뒤 그 이름으로 호출부를 근사 검색 (`Grep` 텍스트 + `ast-grep` 구문) |
| V2 | Repo-wide candidate search | 경로 제한 없이 전체 코드베이스에서 호출 후보를 수집 |
| V3 | Candidate-set honesty | 결과를 검증 필요한 **후보 집합**으로 명시 — 동명 식별자 오탐 가능, scope/type/import 미해결, 의미 기반 find-references 도구 부재이므로 ground-truth 참조 집합이 아님을 `<answer>`에 플래그 |

---

## Scenario E-5: Anti-Pattern Avoidance - Token Efficiency

**Primary Technique:** Anti-Patterns + Core Principle (Token Efficiency)

**Prompt:**
```
UserService 클래스의 validateEmail 메서드 구현을 보여줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | No full-file read | 전체 파일 읽기 시도 없음 |
| V2 | Precise lookup | `Grep`로 `validateEmail` 위치를 특정한 뒤 `Read(offset/limit)`로 해당 메서드 body만 정밀 조회 |
| V3 | Staged approach | 대형 클래스에서 바로 전체 body를 읽지 않고, `ast-grep` 구조 아웃라인으로 메서드 목록 먼저 확인 후 특정 메서드 범위만 `Read(offset/limit)` |

---

## Scenario E-6: Intent Understanding (Actual Need vs Literal Request)

**Primary Technique:** Success Criteria - Intent (Address actual need, not just literal request)

**Prompt:**
```
로그인 관련 파일 어디 있어?
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | Intent analysis | `<analysis>` 블록에서 Literal Request("로그인 관련 파일 위치")와 Actual Need("인증 흐름 전체 이해") 구분 |
| V2 | Relationship explanation | 단순 파일 목록이 아닌 인증 관련 파일들의 관계와 데이터 흐름 설명 |
| V3 | Completeness | `<next_steps>`에 후속 작업 불필요한 수준의 정보 제공 |

---

## Evaluation Criteria

각 시나리오의 verification point를 ALL PASS해야 시나리오 PASS.

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point 완전히 충족 |
| PARTIAL | 언급했으나 불충분하거나 프레이밍이 부정확 |
| FAIL | 미언급 또는 잘못된 판정 |

---

## Test Results (2026-02-10)

### GREEN Tests (WITH agent)

| Scenario | Result | V-Points | Key Evidence |
|----------|--------|----------|-------------|
| E-1: Output Format | PASS | 6/6 | analysis+results 블록 모두 존재, 절대 경로, 관계 설명, next_steps 포함 |
| E-2: Known File Path | PASS | 3/3 | ast-grep 구조 아웃라인 바로 호출, 불필요한 디렉터리 나열 없음, Grep/Read(offset/limit) 표적 조회 |
| E-3: Known Symbol | PASS | 3/3 | ast-grep+Grep 전체 코드베이스 심볼명 검색, ast-grep 아웃라인으로 메서드 목록, 절대 경로 포함 |
| E-4: Find References | PASS | 3/3 | 정의 위치 확인 후 Grep+ast-grep로 호출 후보 근사 검색, 검증 필요한 후보 집합으로 플래그(동명 오탐·scope 미해결) |
| E-5: Token Efficiency | PASS | 3/3 | Grep로 위치 특정 -> Read(offset/limit) 정밀 조회, 전체 파일 읽기 없음 |
| E-6: Intent Understanding | PASS | 3/3 | Literal/Actual Need 구분, hook 관계/역할 설명, 완결적 정보 제공 |

**Overall: 6/6 scenarios PASSED (21/21 verification points)**
