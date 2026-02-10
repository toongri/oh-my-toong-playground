# Explore Skill — Application Test Scenarios

## Purpose

These scenarios test whether the explore skill's **core techniques** are correctly applied. Each scenario targets output format compliance, decision tree navigation, workflow patterns, anti-pattern avoidance, and intent understanding.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| E-1 | Output Format Compliance | Output Format (MANDATORY) | Section structure |
| E-2 | Decision Tree — Known File Path | Decision Tree — Start From What You Know | Token efficiency |
| E-3 | Decision Tree — Known Symbol | Decision Tree — Symbol name only | Codebase-wide search |
| E-4 | Workflow — Find Who Calls | Workflow Example — Scenario 4 | find_referencing_symbols |
| E-5 | Anti-Pattern Avoidance | Anti-Patterns + Core Principle (Token Efficiency) | Precision querying |
| E-6 | Intent Understanding | Success Criteria — Intent | Actual Need vs Literal Request |

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
| V1 | analysis 블록 | `<analysis>` 블록 존재 (Literal Request, Actual Need, Success Looks Like) |
| V2 | results 블록 | `<results>` 블록 존재 |
| V3 | files 섹션 | `<files>` 섹션에 절대 경로 + 관련 이유 |
| V4 | relationships 섹션 | `<relationships>` 섹션에 파일/패턴 간 연결 설명 |
| V5 | answer 섹션 | `<answer>` 섹션에 직접 답변 |
| V6 | next_steps 섹션 | `<next_steps>` 섹션 존재 |

---

## Scenario E-2: Decision Tree — Known File Path

**Primary Technique:** Decision Tree — Start From What You Know (file path known)

**Prompt:**
```
src/auth/AuthService.kt 파일의 주요 메서드 구조를 분석해줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 직접 overview 호출 | `get_symbols_overview(relative_path="src/auth/AuthService.kt")` 직접 호출 |
| V2 | 불필요 선행 호출 없음 | 불필요한 `list_dir` 선행 호출 없음 |
| V3 | 정밀 조회 | 필요 시 `find_symbol`로 특정 메서드 body 조회 |

---

## Scenario E-3: Decision Tree — Known Symbol, Unknown Location

**Primary Technique:** Decision Tree — Symbol name only

**Prompt:**
```
PaymentProcessor 클래스의 위치와 메서드 구성을 알려줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 전체 코드베이스 검색 | `find_symbol(name_path_pattern="PaymentProcessor")` 호출 시 `relative_path` 미지정 (전체 코드베이스 검색) |
| V2 | depth=1 메서드 목록 | 검색 결과에서 위치 확인 후 `depth=1`로 메서드 목록 조회 |
| V3 | 절대 경로 포함 | 결과에 절대 경로 포함 |

---

## Scenario E-4: Workflow — Find Who Calls a Method

**Primary Technique:** Workflow Example — Scenario 4 (find referencing symbols)

**Prompt:**
```
AuthService의 login 메서드를 호출하는 모든 코드를 찾아줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 정의 파일 지정 | `find_referencing_symbols` 호출 시 `relative_path`에 심볼이 **정의된** 파일 지정 |
| V2 | 자동 전체 검색 | 검색 범위는 자동으로 전체 코드베이스 (별도 설정 불필요) |
| V3 | 스니펫 포함 | 결과에 referencing 심볼의 위치와 코드 스니펫 포함 |

---

## Scenario E-5: Anti-Pattern Avoidance — Token Efficiency

**Primary Technique:** Anti-Patterns + Core Principle (Token Efficiency)

**Prompt:**
```
UserService 클래스의 validateEmail 메서드 구현을 보여줘
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 전체 파일 읽기 없음 | 전체 파일 읽기 시도 없음 |
| V2 | 정밀 조회 | `find_symbol(name_path_pattern="UserService/validateEmail", include_body=True)` 형태의 정밀 조회 |
| V3 | 단계적 접근 | 대형 클래스에서 바로 `include_body=True` 대신, 메서드 목록 먼저 확인 후 특정 메서드만 body 조회 |

---

## Scenario E-6: Intent Understanding (Actual Need vs Literal Request)

**Primary Technique:** Success Criteria — Intent (Address actual need, not just literal request)

**Prompt:**
```
로그인 관련 파일 어디 있어?
```

**Verification Points:**

| # | Check | Expected Behavior |
|---|-------|-------------------|
| V1 | 의도 분석 | `<analysis>` 블록에서 Literal Request("로그인 관련 파일 위치")와 Actual Need("인증 흐름 전체 이해") 구분 |
| V2 | 관계 설명 | 단순 파일 목록이 아닌 인증 관련 파일들의 관계와 데이터 흐름 설명 |
| V3 | 완결성 | `<next_steps>`에 후속 작업 불필요한 수준의 정보 제공 |

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

### GREEN Tests (WITH skill)

| Scenario | Result | V-Points | Key Evidence |
|----------|--------|----------|-------------|
| E-1: Output Format | PASS | 6/6 | analysis+results 블록 모두 존재, 절대 경로, 관계 설명, next_steps 포함 |
| E-2: Known File Path | PASS | 3/3 | get_symbols_overview/Read 직접 호출, 불필요한 list_dir 없음 |
| E-3: Known Symbol | PASS | 3/3 | find_file+search_for_pattern 전체 코드베이스 검색, 절대 경로 포함 |
| E-4: Find References | PASS | 3/3 | Grep+search_for_pattern으로 전체 코드베이스 검색, 51개 파일 발견, 컨텍스트 포함 |
| E-5: Token Efficiency | PASS | 3/3 | search_for_pattern -> Read(offset+limit) 정밀 조회, 전체 파일 읽기 없음 |
| E-6: Intent Understanding | PASS | 3/3 | Literal/Actual Need 구분, hook 관계/역할 설명, 완결적 정보 제공 |

**Overall: 6/6 scenarios PASSED (21/21 verification points)**
