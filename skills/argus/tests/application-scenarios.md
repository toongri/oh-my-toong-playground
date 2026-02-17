# Application Scenarios for Argus

Argus의 핵심 기법(Three-Stage Review, Spec Compliance, Scope Boundary)을 파일 읽기 기반 검증으로 테스트하는 Application 시나리오.

## 변경 배경

Argus가 `git diff`로 변경사항을 식별하면 두 가지 문제가 발생:
1. **누적 diff**: `git diff main`이 이전 커밋의 변경까지 포함
2. **병렬 오염**: 여러 Junior가 동시 작업 시 git diff가 모든 Junior의 변경을 섞어서 표시

해결: Sisyphus가 전달하는 **Changed files 목록 + 5-Section prompt**를 Single Source of Truth로 삼고, 파일을 직접 읽어서 검증.

---

## Technique Coverage Map

| # | Scenario | Primary Technique | What it isolates |
|---|---------|-------------------|------------------|
| A-1 | Expected Outcome verification | File reading | git diff 제거 확인 |
| A-2 | MUST DO evidence search | Content grep | diff 대신 파일 내용 검색 |
| A-3 | MUST NOT DO file scope | Changed files list | git diff --name-only 제거 |
| A-4 | Scope Boundary set ops | Changed files as B | git diff 기반 집합 연산 제거 |
| A-5 | Parallel isolation | Agent isolation | 병렬 Junior 오염 방지 |
| A-6 | Pattern prohibition | Content search | 파일 내용 패턴 검색 |
| A-7 | Fast-Path | No git diff needed | trivial 변경도 파일 읽기 |

> **Note:** Confidence Scoring, Rich Feedback Protocol, YAGNI Detection, Verdict Classification, Output Format 등 기존 기법 테스트(이전 A-5~A-10)는 2026-02-10에 전부 GREEN PASS 확인됨. 해당 기법들은 이번 변경에 영향받지 않으므로 이 파일에서 제외. 기법 자체가 변경될 경우 별도 시나리오 추가 필요.

---

## A-1: Expected Outcome — 파일 읽기 기반 검증

**Context:** Junior가 auth/login.ts에 JWT validation을 추가하라는 task를 완료함.

**5-Section Input:**
- TASK: Add JWT validation to login endpoint
- EXPECTED OUTCOME: Files to modify: [auth/login.ts]. JWT token validation logic added.
- MUST DO: Use jsonwebtoken library
- MUST NOT DO: Do NOT modify auth/middleware.ts
- CONTEXT: Existing auth flow in auth/login.ts

**REVIEW REQUEST:**
- Changed files: auth/login.ts
- Junior's summary: "Added JWT validation using jsonwebtoken library in login endpoint"

**Expected Behavior:** Argus reads auth/login.ts content directly (not via git diff), verifies JWT validation exists and jsonwebtoken is used.

**Verification Points:**
1. Argus가 변경 식별을 위해 git diff를 사용하지 않는다
2. Changed files 목록(auth/login.ts)을 기반으로 파일을 직접 읽는다
3. 파일 내용에서 JWT validation 로직과 jsonwebtoken 사용을 확인한다

---

## A-2: MUST DO — 파일 내용 기반 증거 검색

**Context:** Junior가 user-service.ts에서 userId에 대한 null check를 추가하라는 task를 완료함.

**5-Section Input:**
- TASK: Add null check for userId parameter
- EXPECTED OUTCOME: Files to modify: [service/user-service.ts]. Null check added before DB query.
- MUST DO: Add explicit null/undefined check, throw BadRequestError if null
- MUST NOT DO: Do NOT change the DB query logic itself
- CONTEXT: user-service.ts handles user CRUD operations

**REVIEW REQUEST:**
- Changed files: service/user-service.ts
- Junior's summary: "Added null check for userId with BadRequestError"

**Expected Behavior:** Argus reads service/user-service.ts and searches file content for null check pattern, not diff.

**Verification Points:**
1. MUST DO 증거를 "diff에서 검색"이 아닌 "파일 내용에서 검색"으로 확인한다
2. null check 존재 여부를 파일 내용 grep으로 판단한다
3. MUST NOT DO "DB query 로직 변경 금지"는 Junior's summary + 파일 내용 리뷰로 확인한다 (diff 없이 "변하지 않았는지"를 기계적으로 판단할 수 없으므로, behavior constraint는 내용 리뷰 기반 판단)

---

## A-3: MUST NOT DO — git diff 없이 파일 scope 감지

**Context:** Junior가 auth/login.ts만 수정하라는 task를 완료함. MUST NOT DO에 auth/config.ts 수정 금지가 있음.

**5-Section Input:**
- TASK: Fix login validation bug
- EXPECTED OUTCOME: Files to modify: [auth/login.ts]
- MUST DO: Fix the email regex pattern
- MUST NOT DO: Do NOT touch auth/config.ts
- CONTEXT: Bug report: email validation accepts invalid formats

**REVIEW REQUEST:**
- Changed files: auth/login.ts
- Junior's summary: "Fixed email regex pattern in login validation"

**Expected Behavior:** Argus verifies "Do NOT touch auth/config.ts" by checking that auth/config.ts is NOT in the Changed files list. Does NOT use git diff --name-only.

**Verification Points:**
1. MUST NOT DO 파일 scope 검증을 Changed files 목록 기반으로 수행한다
2. `git diff --name-only`를 사용하지 않는다
3. auth/config.ts가 Changed files에 없으므로 PASS 판정한다

---

## A-4: Scope Boundary — git diff 기반 집합 연산 없음

**Context:** Junior가 A.ts, B.ts를 수정함. 동시에 다른 Junior가 C.ts를 수정 중이라 working tree에 C.ts 변경도 존재함.

**5-Section Input:**
- TASK: Refactor data access layer
- EXPECTED OUTCOME: Files to modify: [src/A.ts, src/B.ts]
- MUST DO: Extract common query logic into shared method
- MUST NOT DO: Do NOT modify controller files
- CONTEXT: A.ts and B.ts contain duplicated query logic

**REVIEW REQUEST:**
- Changed files: src/A.ts, src/B.ts
- Junior's summary: "Extracted shared query method into both files"

**Expected Behavior:** Argus verifies ONLY src/A.ts and src/B.ts. Does NOT discover C.ts changes. Does NOT perform B ⊆ A set difference using git diff.

**Verification Points:**
1. `git diff`로 "Actual changed files" 집합(B)을 구하지 않는다
2. Changed files 목록의 파일만 검증 대상으로 삼는다
3. working tree의 다른 변경(C.ts)을 무시한다

---

## A-5: 병렬 Junior — 격리된 검증

**Context:** Sisyphus가 두 Junior를 병렬 실행. Junior A는 auth.ts 수정, Junior B는 payment.ts 수정. Junior A가 먼저 완료되어 Argus 검증 시작. Working tree에는 Junior B의 payment.ts 변경도 존재함.

**5-Section Input (Junior A의 task):**
- TASK: Add rate limiting to auth endpoint
- EXPECTED OUTCOME: Files to modify: [auth.ts]
- MUST DO: Use express-rate-limit middleware
- MUST NOT DO: Do NOT modify payment routes
- CONTEXT: Auth endpoint needs rate limiting for security

**REVIEW REQUEST:**
- Changed files: auth.ts
- Junior's summary: "Added rate limiting middleware to auth endpoint"

**Expected Behavior:** Argus reads only auth.ts. payment.ts의 변경을 발견하지 않음. scope violation으로 flag하지 않음.

**Verification Points:**
1. Argus가 auth.ts만 읽고 검증한다
2. payment.ts(Junior B의 작업)를 scope violation으로 flag하지 않는다
3. MUST NOT DO "Do NOT modify payment routes"를 Changed files 기반으로만 확인한다
4. git diff가 payment.ts를 포함하더라도 그 결과를 사용하지 않는다

---

## A-6: MUST NOT DO — 파일 내용의 패턴 금지

**Context:** Junior가 types.ts를 수정함. TypeScript `any` 타입 사용 금지 규칙이 있음.

**5-Section Input:**
- TASK: Add type definitions for API responses
- EXPECTED OUTCOME: Files to modify: [types.ts]
- MUST DO: Define proper TypeScript interfaces for all API responses
- MUST NOT DO: Do NOT use `any` type anywhere
- CONTEXT: Project enforces strict TypeScript typing

**REVIEW REQUEST:**
- Changed files: types.ts
- Junior's summary: "Added typed interfaces for all API response types"

**Expected Behavior:** Argus reads types.ts content and greps for `any` type usage. This is a pattern prohibition, not file scope, so file content search is appropriate.

**Verification Points:**
1. 파일 내용에서 `any` 타입 패턴을 검색한다
2. 검색 대상은 Changed files 목록의 파일(types.ts)이다
3. `any`가 발견되면 MUST NOT DO violation으로 flag한다

---

## A-7: Fast-Path — git diff 없이 동작

**Context:** Junior가 README.md의 오타를 수정함. 기능 변경 없음.

**5-Section Input:**
- TASK: Fix typo in README.md
- EXPECTED OUTCOME: Files to modify: [README.md]. Typo "authenication" → "authentication" corrected.
- MUST DO: Fix the specific typo only
- MUST NOT DO: Do NOT change any other content
- CONTEXT: Typo reported in README

**REVIEW REQUEST:**
- Changed files: README.md
- Junior's summary: "Fixed typo: authenication → authentication"

**Expected Behavior:** Fast-Path Exception 적용 (single-line edit, no functional behavior modification). Stage 1 skip, Stage 3 brief quality check만 수행. git diff 불필요.

**Verification Points:**
1. Fast-Path로 분류하여 Stage 1을 skip한다
2. git diff 없이 README.md를 읽어서 오타 수정 확인
3. Stage 3 brief quality check만 수행한다

---

## Evaluation Criteria

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point fully met |
| PARTIAL | Mentioned but insufficient or incorrect |
| FAIL | Not mentioned or wrong judgment |

## Test Results

| # | Scenario | Result | Date | Notes |
|---|---------|--------|------|-------|
| A-1 | Expected Outcome — 파일 읽기 기반 검증 | | | |
| A-2 | MUST DO — 파일 내용 기반 증거 검색 | | | |
| A-3 | MUST NOT DO — git diff 없이 파일 scope 감지 | | | |
| A-4 | Scope Boundary — git diff 기반 집합 연산 없음 | | | |
| A-5 | 병렬 Junior — 격리된 검증 | | | |
| A-6 | MUST NOT DO — 파일 내용의 패턴 금지 | | | |
| A-7 | Fast-Path — git diff 없이 동작 | | | |
