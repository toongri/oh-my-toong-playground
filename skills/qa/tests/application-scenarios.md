# Application Scenarios for the QA Skill

QA 스킬의 핵심 기법(Composable Verification Layers, Spec Compliance, Scope Boundary)을 파일 읽기 기반 검증으로 테스트하는 Application 시나리오.

## 변경 배경

검증자가 unscoped `git diff`로 변경사항을 식별하면 두 가지 문제가 발생:
1. **누적 diff**: `git diff main`이 이전 커밋의 변경까지 포함
2. **병렬 오염**: 여러 Junior가 동시 작업 시 unscoped git diff가 모든 Junior의 변경을 섞어서 표시

해결: Changed files 목록을 기반으로 파일을 직접 읽어서 검증. 특정 파일의 변경 여부 확인이 필요한 경우 file-scoped `git diff -- <path>`를 사용.

---

## Technique Coverage Map

| # | Scenario | Primary Technique | What it isolates |
|---|---------|-------------------|------------------|
| A-1 | Expected Outcome verification | File reading | git diff 제거 확인 |
| A-2 | MUST DO evidence search | Content grep | diff 대신 파일 내용 검색 |
| A-3 | MUST NOT DO file scope | File-scoped git diff | `git diff -- <path>`로 forbidden file 검증 |
| A-4 | Scope Boundary set ops | Changed files as B | unscoped git diff 기반 집합 연산 제거 |
| A-5 | Parallel isolation | Agent isolation | 병렬 Junior 오염 시 file-scoped 검증 |
| A-6 | Pattern prohibition | Content search | 파일 내용 패턴 검색 |
| A-7 | Fast-Path | No git diff needed | trivial 변경도 파일 읽기 |
| A-8 | API endpoint → curl 검증 | Applicability detection (API) | API 신호 인식 + curl 시도 |
| A-9 | Internal refactoring → Hands-on execution 스킵 | Skip logic | 내부 변경 스킵 + 문서화 |
| A-10 | CLI command → interactive_bash | Applicability detection (CLI) | CLI 신호 인식 + bash 시도 |
| A-11 | API + Frontend → 복합 검증 | Multi-type handling | 복합 변경 각각 독립 검증 |
| A-12 | Server start 실패 → REQUEST_CHANGES | Lifecycle failure | 서버 기동 실패 처리 |
| A-15 | Composable trigger activation | Trigger selection logic | 트리거 조합 결정 |
| A-16 | Self-discovery | Command discovery protocol | 검증 방법 자동 발견 |
| A-17 | Mixed request | Plan + code combined | 복합 요청 처리 |
| A-18 | Anti-Evasion — automated test ALL PASS + hands-on trigger | Trigger Independence enforcement | 자동화 테스트 통과가 hands-on 면제 근거가 되지 않음 검증 |
| A-19 | Trigger Activation Trace — output compliance | Output format compliance | Active Triggers 테이블 출력 검증 |
| A-20 | Scenario Verification Principle | Consumer-boundary declaration | Cross-entry consistency with prometheus |

> **Note:** Confidence Scoring, YAGNI Detection, Verdict Classification, Output Format 등 기존 기법 테스트(이전 A-5~A-10)는 2026-02-10에 전부 GREEN PASS 확인됨. 해당 기법들은 이번 변경에 영향받지 않으므로 이 파일에서 제외. 기법 자체가 변경될 경우 별도 시나리오 추가 필요.
>
> **Note (2026-05-12):** "Rich Feedback Protocol" was removed in this PR (oracle now owns diagnosis). Related scenarios have been archived.

---

## A-1: Expected Outcome — 파일 읽기 기반 검증

**Context:** Junior가 auth/login.ts에 JWT validation을 추가하라는 task를 완료함.

**QA REQUEST Spec:**
- TASK: Add JWT validation to login endpoint
- EXPECTED OUTCOME: Files to modify: [auth/login.ts]. JWT token validation logic added.
- REQUIRED TOOLS: Grep (auth/login.ts의 login 함수 탐색)
- MUST DO: Use jsonwebtoken library
- MUST NOT DO: Do NOT modify auth/middleware.ts
- CONTEXT: Existing auth flow in auth/login.ts

**QA REQUEST Scope:**
- Changed files: auth/login.ts
- Junior's summary: "Added JWT validation using jsonwebtoken library in login endpoint"

**Expected Behavior:** The verifier reads auth/login.ts content directly (not via git diff), verifies JWT validation exists and jsonwebtoken is used.

**Verification Points:**
1. 검증자가 변경 식별을 위해 git diff를 사용하지 않는다
2. Changed files 목록(auth/login.ts)을 기반으로 파일을 직접 읽는다
3. 파일 내용에서 JWT validation 로직과 jsonwebtoken 사용을 확인한다

---

## A-2: MUST DO — 파일 내용 기반 증거 검색

**Context:** Junior가 user-service.ts에서 userId에 대한 null check를 추가하라는 task를 완료함.

**QA REQUEST Spec:**
- TASK: Add null check for userId parameter
- EXPECTED OUTCOME: Files to modify: [service/user-service.ts]. Null check added before DB query.
- REQUIRED TOOLS: Grep (user-service.ts의 userId 파라미터 사용 위치 탐색)
- MUST DO: Add explicit null/undefined check, throw BadRequestError if null
- MUST NOT DO: Do NOT change the DB query logic itself
- CONTEXT: user-service.ts handles user CRUD operations

**QA REQUEST Scope:**
- Changed files: service/user-service.ts
- Junior's summary: "Added null check for userId with BadRequestError"

**Expected Behavior:** The verifier reads service/user-service.ts and searches file content for null check pattern, not diff.

**Verification Points:**
1. MUST DO 증거를 "diff에서 검색"이 아닌 "파일 내용에서 검색"으로 확인한다
2. null check 존재 여부를 파일 내용 grep으로 판단한다
3. MUST NOT DO "DB query 로직 변경 금지"는 Junior's summary + 파일 내용 리뷰로 확인한다 (diff 없이 "변하지 않았는지"를 기계적으로 판단할 수 없으므로, behavior constraint는 내용 리뷰 기반 판단)

---

## A-3: MUST NOT DO — file-scoped git diff로 파일 scope 검증

**Context:** Junior가 auth/login.ts만 수정하라는 task를 완료함. MUST NOT DO에 auth/config.ts 수정 금지가 있음. 병렬로 실행 중인 다른 Junior가 utils/helper.ts를 수정 중이라 working tree에 오염 존재.

**QA REQUEST Spec:**
- TASK: Fix login validation bug
- EXPECTED OUTCOME: Files to modify: [auth/login.ts]
- REQUIRED TOOLS: Grep (auth/login.ts의 validation 로직 탐색)
- MUST DO: Fix the email regex pattern
- MUST NOT DO: Do NOT touch auth/config.ts
- CONTEXT: Bug report: email validation accepts invalid formats

**QA REQUEST Scope:**
- Changed files: auth/login.ts
- Junior's summary: "Fixed email regex pattern in login validation"

**Expected Behavior:** 검증자가 "Do NOT touch auth/config.ts" 검증 시 Changed files 확인 또는 `git diff -- auth/config.ts`로 검증. unscoped `git diff`로 다른 Junior의 오염(utils/helper.ts)을 발견하여 scope violation으로 오판하지 않음.

**Verification Points:**
1. MUST NOT DO 파일 scope 검증을 Changed files 또는 `git diff -- auth/config.ts`로 수행한다
2. unscoped `git diff`나 `git diff --name-only`로 전체 변경 목록을 구하지 않는다
3. 병렬 오염(utils/helper.ts)을 scope violation으로 flag하지 않는다
4. auth/config.ts에 변경이 없으므로 PASS 판정한다

---

## A-4: Scope Boundary — git diff 기반 집합 연산 없음

**Context:** Junior가 A.ts, B.ts를 수정함. 동시에 다른 Junior가 C.ts를 수정 중이라 working tree에 C.ts 변경도 존재함.

**QA REQUEST Spec:**
- TASK: Refactor data access layer
- EXPECTED OUTCOME: Files to modify: [src/A.ts, src/B.ts]
- REQUIRED TOOLS: Grep (A.ts, B.ts의 query 로직 탐색)
- MUST DO: Extract common query logic into shared method
- MUST NOT DO: Do NOT modify controller files
- CONTEXT: A.ts and B.ts contain duplicated query logic

**QA REQUEST Scope:**
- Changed files: src/A.ts, src/B.ts
- Junior's summary: "Extracted shared query method into both files"

**Expected Behavior:** The verifier verifies ONLY src/A.ts and src/B.ts. Does NOT discover C.ts changes via unscoped git diff. Scope Boundary Check의 B 집합을 Changed files 목록에서 가져오며, unscoped `git diff`로 구성하지 않는다.

**Verification Points:**
1. unscoped `git diff`로 "Actual changed files" 집합(B)을 구하지 않는다
2. Changed files 목록의 파일만 검증 대상으로 삼는다
3. working tree의 다른 변경(C.ts)을 scope violation으로 flag하지 않는다

---

## A-5: 병렬 Junior — 격리된 검증

**Context:** Sisyphus가 두 Junior를 병렬 실행. Junior A는 auth.ts 수정, Junior B는 payment.ts 수정. Junior A가 먼저 완료되어 QA 검증 시작. Working tree에는 Junior B의 payment.ts 변경도 존재함.

**QA REQUEST Spec (Junior A의 task):**
- TASK: Add rate limiting to auth endpoint
- EXPECTED OUTCOME: Files to modify: [auth.ts]
- REQUIRED TOOLS: Grep (auth.ts의 endpoint 구조 탐색)
- MUST DO: Use express-rate-limit middleware
- MUST NOT DO: Do NOT modify payment routes
- CONTEXT: Auth endpoint needs rate limiting for security

**QA REQUEST Scope:**
- Changed files: auth.ts
- Junior's summary: "Added rate limiting middleware to auth endpoint"

**Expected Behavior:** The verifier reads only auth.ts. payment.ts의 병렬 오염을 scope violation으로 flag하지 않음. MUST NOT DO 검증 시 Changed files 확인 또는 file-scoped `git diff -- payment.ts`를 사용하며, unscoped `git diff`로 전체 변경을 조회하지 않음.

**Verification Points:**
1. 검증자가 auth.ts만 읽고 검증한다
2. payment.ts(Junior B의 작업)를 scope violation으로 flag하지 않는다
3. MUST NOT DO "Do NOT modify payment routes"를 Changed files 또는 file-scoped git diff로 확인한다
4. unscoped `git diff`가 payment.ts를 포함하더라도 그 결과를 scope 판단에 사용하지 않는다

---

## A-6: MUST NOT DO — 파일 내용의 패턴 금지

**Context:** Junior가 types.ts를 수정함. TypeScript `any` 타입 사용 금지 규칙이 있음.

**QA REQUEST Spec:**
- TASK: Add type definitions for API responses
- EXPECTED OUTCOME: Files to modify: [types.ts]
- REQUIRED TOOLS: ast-grep (types.ts의 기존 타입 구조 파악)
- MUST DO: Define proper TypeScript interfaces for all API responses
- MUST NOT DO: Do NOT use `any` type anywhere
- CONTEXT: Project enforces strict TypeScript typing

**QA REQUEST Scope:**
- Changed files: types.ts
- Junior's summary: "Added typed interfaces for all API response types"

**Expected Behavior:** The verifier reads types.ts content and greps for `any` type usage. This is a pattern prohibition, not file scope, so file content search is appropriate.

**Verification Points:**
1. 파일 내용에서 `any` 타입 패턴을 검색한다
2. 검색 대상은 Changed files 목록의 파일(types.ts)이다
3. `any`가 발견되면 MUST NOT DO violation으로 flag한다

---

## A-7: Fast-Path — git diff 없이 동작

**Context:** Junior가 README.md의 오타를 수정함. 기능 변경 없음.

**QA REQUEST Spec:**
- TASK: Fix typo in README.md
- EXPECTED OUTCOME: Files to modify: [README.md]. Typo "authenication" → "authentication" corrected.
- REQUIRED TOOLS: None (단순 오타 수정)
- MUST DO: Fix the specific typo only
- MUST NOT DO: Do NOT change any other content
- CONTEXT: Typo reported in README

**QA REQUEST Scope:**
- Changed files: README.md
- Junior's summary: "Fixed typo: authenication → authentication"

**Expected Behavior:** Fast-Path Exception 적용 (single-line edit, no functional behavior modification). Automated checks와 Hands-on execution skip, code quality brief check만 수행. git diff 불필요.

**Verification Points:**
1. Fast-Path로 분류하여 Automated checks와 Hands-on execution를 skip한다
2. git diff 없이 README.md를 읽어서 오타 수정 확인
3. code quality brief check만 수행한다

---

## A-8: API endpoint → curl 검증

**Context:** Junior가 user-api.ts에 GET /api/users/:id 엔드포인트를 추가함.

**QA REQUEST Spec:**
- TASK: Add user detail API endpoint
- EXPECTED OUTCOME: Files to modify: [src/routes/user-api.ts]. GET /api/users/:id returns user object with 200.
- REQUIRED TOOLS: Grep (user-api.ts의 route handler 탐색)
- MUST DO: Return 404 for non-existent user
- MUST NOT DO: Do NOT modify existing user list endpoint
- CONTEXT: User detail endpoint needed for profile page

**QA REQUEST Scope:**
- Changed files: src/routes/user-api.ts
- Junior's summary: "Added GET /api/users/:id endpoint"

**Expected Behavior:** Hands-on execution 트리거에서 "API endpoint" 신호 감지 → curl 검증 선택. 서버 기동 → curl로 200 응답 확인 + 404 케이스 확인 → 서버 종료. Hands-on execution 출력 포맷에 맞게 결과 기록.

**Verification Points:**
1. QA REQUEST Spec의 TASK/EXPECTED OUTCOME에서 API 신호를 감지한다
2. curl을 사용한 검증을 시도한다
3. 서버 라이프사이클(start→test→stop)을 따른다
4. Hands-on execution 출력 포맷이 stage3-handson.md의 형식과 일치한다

---

## A-9: Internal refactoring → Hands-on execution 스킵

**Context:** Junior가 utils/formatter.ts의 내부 유틸리티 함수를 리팩토링함. 외부 API나 UI 영향 없음.

**QA REQUEST Spec:**
- TASK: Refactor date formatting utility
- EXPECTED OUTCOME: Files to modify: [utils/formatter.ts]. Simplify date formatting logic.
- REQUIRED TOOLS: Grep (formatter.ts의 기존 함수 구조 탐색)
- MUST DO: Maintain existing function signatures
- MUST NOT DO: Do NOT change return types
- CONTEXT: Date formatting utility has complex nested logic

**QA REQUEST Scope:**
- Changed files: utils/formatter.ts
- Junior's summary: "Simplified date formatting logic while keeping signatures"

**Expected Behavior:** Hands-on execution 트리거 적용 조건에서 "refactoring, internal logic, utility" 신호 감지 → Hands-on execution SKIP. 출력에 "Stage 3 Result: SKIPPED (internal logic only)" 기록. code quality check로 직접 진행.

**Verification Points:**
1. "Refactor" + "utility" 신호에서 internal 유형으로 분류한다
2. Hands-on execution를 스킵한다
3. 스킵 사유를 출력에 문서화한다
4. code quality check로 직접 진행한다

---

## A-10: CLI command → interactive_bash

**Context:** Junior가 cli/export.ts에 `--format json` 옵션을 추가함.

**QA REQUEST Spec:**
- TASK: Add JSON format option to export CLI command
- EXPECTED OUTCOME: Files to modify: [cli/export.ts]. `export --format json` outputs JSON instead of CSV.
- REQUIRED TOOLS: Grep (export.ts의 옵션 파싱 로직 탐색)
- MUST DO: Default format remains CSV
- MUST NOT DO: Do NOT break existing CSV output
- CONTEXT: Users need JSON export for automation

**QA REQUEST Scope:**
- Changed files: cli/export.ts
- Junior's summary: "Added --format json option to export command"

**Expected Behavior:** Hands-on execution 트리거 적용 조건에서 "CLI command, terminal output" 신호 감지 → interactive_bash 검증 선택. `export --format json` 실행 → JSON 출력 확인 + 기본 CSV 출력 확인.

**Verification Points:**
1. "CLI command" + "terminal output" 신호에서 CLI 유형으로 분류한다
2. interactive_bash를 사용한 검증을 시도한다
3. 양성(JSON) 및 기본(CSV) 케이스 모두 확인한다
4. 서버 기동이 불필요한 경우 라이프사이클을 스킵한다

---

## A-11: API + Frontend → 복합 검증

**Context:** Junior가 API 엔드포인트와 이를 사용하는 프론트엔드 컴포넌트를 함께 추가함.

**QA REQUEST Spec:**
- TASK: Add user profile page with API
- EXPECTED OUTCOME: Files to modify: [src/api/profile.ts, src/pages/ProfilePage.tsx]. GET /api/profile returns user profile. ProfilePage renders user profile data.
- REQUIRED TOOLS: Grep (profile.ts, ProfilePage.tsx 구조 탐색)
- MUST DO: Handle loading and error states in UI
- MUST NOT DO: Do NOT modify existing navigation
- CONTEXT: Profile page needed for user dashboard

**QA REQUEST Scope:**
- Changed files: src/api/profile.ts, src/pages/ProfilePage.tsx
- Junior's summary: "Added profile API and profile page"

**Expected Behavior:** Hands-on execution 트리거 적용 조건에서 API + Frontend 복합 신호 감지 → curl과 agent-browser 모두 사용. 서버 기동 → curl로 API 확인 → agent-browser로 UI 확인 (실패 또는 표현 불가 시 playwright 폴백) → 서버 종료. 각각 독립적으로 결과 기록.

**Verification Points:**
1. API와 Frontend 신호를 모두 감지한다
2. curl과 agent-browser(또는 폴백 playwright) 두 가지 검증을 모두 수행한다
3. 각 검증 결과를 독립적으로 기록한다
4. 하나라도 실패하면 REQUEST_CHANGES

---

## A-12: Server start 실패 → REQUEST_CHANGES

**Context:** Junior가 API 엔드포인트를 추가했지만, 서버 기동 시 포트 충돌로 실패함.

**QA REQUEST Spec:**
- TASK: Add health check endpoint
- EXPECTED OUTCOME: Files to modify: [src/routes/health.ts]. GET /health returns 200 OK.
- REQUIRED TOOLS: Grep (health.ts의 route handler 탐색)
- MUST DO: Return { status: 'ok' } JSON body
- MUST NOT DO: Do NOT modify server configuration
- CONTEXT: Health check needed for load balancer

**QA REQUEST Scope:**
- Changed files: src/routes/health.ts
- Junior's summary: "Added health check endpoint"

**Expected Behavior:** Hands-on execution 트리거 적용 조건에서 API 신호 감지 → curl 검증 선택 → 서버 기동 시도 → 기동 실패 → 즉시 REQUEST_CHANGES. code quality check로 진행하지 않음.

**Verification Points:**
1. 서버 기동 실패를 Hands-on execution FAIL로 판정한다
2. code quality check로 진행하지 않는다
3. REQUEST_CHANGES 판정을 내린다
4. 실패 원인을 출력에 포함한다

---

## A-15: Composable Trigger Activation — 트리거 조합 결정

**Context:** QA REQUEST 내용에 따라 올바른 트리거 조합이 활성화되는지 검증.

**Scenario 15a: Task spec + changed files (기본 조합)**
- QA REQUEST에 task spec과 changed files가 포함
- Active triggers: Automated checks → Spec/AC compliance → Hands-on execution
- Hands-on execution은 user-facing 변경이 있으므로 활성 (caller-provided scenario 없이 user-facing-no-scenarios arm으로 진입)

**Scenario 15b: Plan TODO with QA Scenarios (시나리오 기반 조합)**
- QA REQUEST에 plan TODO의 AC, QA Scenarios, changed files가 포함
- Active triggers: Automated checks → Spec/AC compliance → Hands-on execution
- Hands-on execution은 caller-provided scenario arm으로 활성 (제공된 시나리오를 verbatim 실행하며, self-authored adversarial matrix를 그 위에 추가)

**Scenario 15c: Targeted verification spec (검증 spec 직접 전달)**
- orchestrator가 Final Verification Wave의 F1-F4 항목에서 "What to verify" spec을 QA REQUEST Spec으로 직접 전달 (plan file 전체가 아닌 targeted spec)
- 예: "What to verify: Read plan end-to-end, verify Must Have items are all implemented"
- Active triggers: Automated checks → Spec/AC compliance
- Hands-on execution 미활성 (F1-F4 항목의 "What to verify"는 검증 지시이지 caller-provided scenario(Tool/Steps/Expected 구조)가 아니며, 검증 spec은 user-facing 변경 기술도 아니므로 두 arm 모두 미충족)

**Scenario 15d: AC only, no QA methods (자율 QA)**
- QA REQUEST에 AC만 제공, QA scenarios 없음, user-facing 변경 있음
- Active triggers: Automated checks → Spec/AC compliance → Hands-on execution
- Hands-on execution은 user-facing-no-scenarios arm으로 활성 (scenarios 미제공이므로 자율 hands-on QA)

**Verification Points:**
1. QA REQUEST 내용을 파싱하여 올바른 트리거를 선택한다
2. 불필요한 트리거를 활성화하지 않는다
3. Hands-on execution의 두 activation arm(caller-provided scenarios / user-facing-no-scenarios) 중 어느 쪽으로 진입하는지, 또는 어느 arm도 충족되지 않아 미활성인지를 올바르게 판정한다

---

## A-16: Self-Discovery — 검증 방법 자동 발견

**Context:** QA REQUEST에 검증 방법이 명시되지 않았을 때, 검증자가 프로젝트 파일에서 검증 명령을 자동으로 발견하는지 검증.

**QA REQUEST Spec:**
- Task: Add user profile endpoint
- AC: GET /api/profile returns user data

**QA REQUEST Scope:**
- Changed files: src/routes/profile.ts
- Summary: "Added profile endpoint"

**Expected Behavior:** 검증자가 Self-Discovery Protocol을 따라 `~/.omt/{project}/project-commands.md` → `CLAUDE.md` → `package.json` 순서로 검증 명령을 발견하고 Automated checks를 실행한다.

**Verification Points:**
1. 검증 방법이 명시되지 않았을 때 Self-Discovery Protocol을 따른다
2. `~/.omt/{project}/project-commands.md` 캐시를 먼저 확인한다
3. 캐시 미스 시 프로젝트 문서에서 명령을 발견한다
4. 발견된 명령으로 Automated checks를 정상 실행한다

---

## A-17: Mixed Request — 계획 경로 + 코드 변경 복합

**Context:** QA REQUEST에 계획 파일 경로와 코드 변경이 모두 포함된 복합 요청의 처리를 검증.

**QA REQUEST Spec:**
- Plan file: `.omt/plans/feature-search.md`
- Verify TODO 3 AC specifically
- QA Scenarios from plan TODO 3

**QA REQUEST Scope:**
- Changed files: src/search/indexer.ts, src/search/query.ts, tests/search/
- Summary: "Search indexer and query implementation complete"

**Expected Behavior:** 검증자가 계획 파일에서 TODO 3의 AC와 QA Scenarios를 추출하여 검증하고, 코드 변경에 대해 Automated checks(build/typecheck/test/lint + code quality)도 실행한다. Active triggers: Automated checks → Spec/AC compliance → Hands-on execution (caller-provided scenario arm).

**Verification Points:**
1. 계획 파일에서 특정 TODO의 AC와 QA Scenarios를 추출한다
2. 코드 변경이 있으므로 Automated checks(build/typecheck/test/lint와 code quality)를 실행한다
3. QA Scenarios가 제공되므로 Hands-on execution을 caller-provided scenario arm으로 실행한다 (user-facing-no-scenarios arm이 아닌)
4. 개별 TODO 검증과 코드 품질 검증을 모두 수행한다

---

## A-18: Anti-Evasion — 자동화 테스트 ALL PASS 시에도 hands-on QA 필수

**Context:** Junior가 Spring Boot API 엔드포인트 구현을 완료함. JUnit/Mockito/MockMvc/Testcontainers 자동화 테스트 127개 전부 통과 (127/127). 프로젝트는 WireMock + Testcontainers 기반 통합 테스트를 사용. QA REQUEST에 QA 시나리오는 제공되지 않음.

**QA REQUEST Spec:**
- TASK: Implement POST /api/v1/orders and GET /api/v1/orders/:id endpoints
- EXPECTED OUTCOME: Files to modify: [src/main/java/com/example/OrderController.java, src/main/java/com/example/OrderService.java]. POST creates order and returns 201. GET returns order by ID with 200 or 404 if not found.
- REQUIRED TOOLS: (not specified)
- MUST DO: Validate request body, return proper HTTP status codes
- MUST NOT DO: Do NOT modify existing OrderRepository interface
- CONTEXT: Order management feature. All automated tests (127/127) pass including WireMock + Testcontainers integration tests.

**QA REQUEST Scope:**
- Changed files: src/main/java/com/example/OrderController.java, src/main/java/com/example/OrderService.java
- Junior's summary: "API endpoint implementation complete, all tests pass (127/127 including Testcontainers integration tests)"

**Expected Behavior:** 자동화 테스트가 전부 통과하더라도 검증자는 Hands-on execution 트리거를 활성화해야 함 (user-facing 변경이 있으므로 user-facing-no-scenarios arm으로 진입). "automated tests pass"를 hands-on QA 면제 근거로 사용하지 않음. 서버 기동 → curl 검증 시도 → 결과 기록.

**Verification Points:**
1. 검증자가 "automated tests pass"를 hands-on 면제 근거로 사용하지 않는다
2. Active Triggers 테이블에서 Hands-on execution 트리거가 ACTIVE로 표시된다
3. 검증자가 서버 기동 + curl 검증을 시도한다 (또는 라이프사이클 실패를 문서화한다)
4. Trigger Independence Rule이 결정에 반영된다 (자동화 검증 ≠ hands-on 면제)

---

## A-19: Trigger Activation Trace — 출력 포맷 준수

**Context:** API 엔드포인트 변경에 대한 표준 QA REQUEST. task spec과 changed files가 포함되어 있으며 QA 시나리오는 제공되지 않음.

**QA REQUEST Spec:**
- TASK: Modify GET /api/v1/products to support pagination
- EXPECTED OUTCOME: Files to modify: [src/main/java/com/example/ProductController.java]. GET /api/v1/products accepts `page` and `size` query parameters. Returns paginated result with total count.
- REQUIRED TOOLS: (not specified)
- MUST DO: Default page size is 20, max page size is 100
- MUST NOT DO: Do NOT break existing non-paginated response structure
- CONTEXT: Product list API needs pagination for performance

**QA REQUEST Scope:**
- Changed files: src/main/java/com/example/ProductController.java
- Summary: "Added pagination support to product list endpoint"

**Expected Behavior:** 검증자 출력에 Active Triggers 테이블이 포함되어야 함. qa/SKILL.md §Output Format에 정의된 모든 trigger 각각에 대해 Status(ACTIVE/INACTIVE)와 Reason이 명시됨. 테이블은 Verdict 섹션 이전에 출력됨.

**Verification Points:**
1. Active Triggers 테이블이 검증자 출력에 포함된다
2. qa/SKILL.md §Output Format에 정의된 모든 trigger가 명시적인 ACTIVE/INACTIVE 상태와 함께 나열된다
3. 각 트리거에 활성화/비활성화 사유를 설명하는 Reason 항목이 있다
4. 테이블이 Verdict 섹션 이전에 출력된다

---

## A-20: Scenario Verification Principle Declaration

**Context:** the verifier receives a QA REQUEST for a new user-facing API endpoint (POST /api/orders) without explicit QA scenarios. Automated tests pass (build green, unit tests pass). The verifier must decide whether hands-on verification is required.

**QA REQUEST Spec:**
- TASK: Add POST /api/orders endpoint to create a new order
- EXPECTED OUTCOME: Files to modify: [src/main/java/com/example/OrderController.java, src/main/java/com/example/OrderService.java]. POST /api/orders accepts JSON body, creates order, returns 201 with order ID.
- REQUIRED TOOLS: (not specified)
- MUST DO: Validate request body fields (userId, productId, quantity)
- MUST NOT DO: Do NOT modify existing GET /api/orders endpoint
- CONTEXT: Order management feature. All automated tests pass.

**QA REQUEST Scope:**
- Changed files: src/main/java/com/example/OrderController.java, src/main/java/com/example/OrderService.java
- Summary: "POST /api/orders endpoint added; all automated tests pass"

**Expected Behavior:** the verifier activates the Hands-on execution trigger (user-facing change with no caller-provided scenarios → user-facing-no-scenarios arm). The consumer-boundary principle declared in qa/SKILL.md § Overview drives the decision: automated test passage is not sufficient because it does not verify the product at the layer the user observes. the verifier attempts server startup and curl verification (POST /api/orders with a valid JSON body), records the result, and does not issue APPROVED on automated-test evidence alone.

**Verification Points:**
1. qa/SKILL.md § Overview contains a prose paragraph declaring the Scenario Verification Principle with the anchor `consumer boundary`
2. The declaration includes the anchor `consumer boundary` verbatim
3. The core expression and anchor in this declaration match the equivalent declaration in prometheus/plan-template.md § QA Scenarios (cross-entry consistency: both entry-points point to the same essential claim)

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
| A-3 | MUST NOT DO — file-scoped git diff로 파일 scope 검증 | PASS | 2026-03-11 | 4VP 충족. Changed files 기반 판정. 병렬 오염(checklists.md)에 현혹 안 됨. |
| A-4 | Scope Boundary — git diff 기반 집합 연산 없음 | PASS | 2026-03-11 | 3VP 충족. Changed files 목록만으로 B 집합 구성. 오염 파일 미 flag. |
| A-5 | 병렬 Junior — 격리된 검증 | PASS | 2026-03-11 | 4VP 충족. git diff로 오염 발견했으나 "noted, not treated as scope violations"로 처리. REFACTOR 2회 (git status 우회 → 상위 원칙 전환). |
| A-6 | MUST NOT DO — 파일 내용의 패턴 금지 | | | |
| A-7 | Fast-Path — git diff 없이 동작 | | | |
| A-8 | API endpoint → curl 검증 | PASS | 2026-02-23 | 4VP 전부 충족. API 신호 감지, curl 절차, 서버 라이프사이클, 출력 포맷 모두 정확. |
| A-9 | Internal refactoring → "user-facing changes, no scenarios" 스킵 | PASS | 2026-02-23 | 4VP 전부 충족. internal 분류, "user-facing changes, no scenarios" 스킵, "SKIPPED (internal logic only)" 문서화, code quality check 진행 확인. |
| A-10 | CLI command → interactive_bash | | | A-8과 동일 패턴 (적용 조건 분기). 미테스트. |
| A-11 | API + Frontend → 복합 검증 | PASS | 2026-02-23 | 4VP 전부 충족. API+Frontend 양 타입 감지, curl+agent-browser(폴백 playwright) 독립 검증, 공유 라이프사이클. |
| A-12 | Server start 실패 → REQUEST_CHANGES | | | 실제 서버 환경 필요. 미테스트. |
| A-15 | Composable Trigger Activation — 트리거 조합 결정 | | | |
| A-16 | Self-Discovery — 검증 방법 자동 발견 | | | |
| A-17 | Mixed Request — 계획 경로 + 코드 변경 복합 | | | |
| A-18 | Anti-Evasion — 자동화 테스트 ALL PASS 시에도 hands-on QA 필수 | PASS | 2026-06-18 | 4VP 전부 충족. 127/127 통과를 면제 근거로 쓰지 않음, Active Triggers에 Hands-on execution ACTIVE, 서버 기동+curl 시도, Trigger Independence Rule 반영. |
| A-19 | Trigger Activation Trace — 출력 포맷 준수 | | | |
