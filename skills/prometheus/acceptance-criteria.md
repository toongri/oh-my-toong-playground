# Acceptance Criteria — Lookup

**This file is lookup-only.** All mandatory AC rules (two-line format, Granularity, Consumer Boundary, Transparency, Setup/Cleanup, Required Chaining Template, Executor-Provided Variables, Reference Integration, Anti-Patterns, Self-Check) are defined inline in `SKILL.md > ## Acceptance Criteria (Mandatory Contract)`. The contract is authoritative; this file is per-tool examples + a worked example.

Read this file when you want a concrete example for a specific tool, or want to consult a worked AC proposal.

---

## Verification Examples by Tool

When the Verification can be expressed as a runnable command, prefer one that is self-contained. For outcome-based or descriptive ACs where a literal command does not fit, plain prose is acceptable.

### Mobile app E2E (maestro)

- [ ] **Login flow on iOS Simulator reaches Home**
      **Verification**: `maestro --device "$IOS_UDID" test .maestro/auth/login_happy.yaml --format junit --output "$evidence_xml"`
      (Setup/Cleanup omitted — this flow's first step is `clearState` + `launchApp`, so the flow self-resets. If your flow does not, add explicit Cleanup. If the flow mutates backend persistence beyond app state, chain Query API verification or add API-symmetric cleanup.)

- [ ] **Login flow on Android Emulator reaches Home**
      **Verification**: `maestro --device "$ANDROID_SERIAL" test .maestro/auth/login_happy.yaml --format junit --output "$evidence_xml"`
      (Same Setup/Cleanup notes as iOS above.)

> Mobile ACs assume `$IOS_UDID` / `$ANDROID_SERIAL` are exported by Argus Stage 3.5 — see Executor-Provided Variables in SKILL.md.

### Web UI E2E (playwright)

- [ ] **Login with valid credentials lands on Home and shows username**
      **Verification**: `bunx playwright test tests/e2e/login.spec.ts --reporter=junit`
      (If the test mutates backend persistence, chain Query API verification or add API-symmetric cleanup — browser context reset alone doesn't restore backend state.)

### HTTP API (curl + jq)

- [ ] **POST /api/users (201) returns the same record on subsequent GET**
      **Setup**: `email="ac-$(uuidgen)@example.com" && id=$(curl -fsS -X POST "$API_BASE_URL/api/users" -H 'Content-Type: application/json' -d "{\"email\":\"$email\"}" | jq -r '.id') && [ -n "$id" ] && [ "$id" != "null" ]`
      **Verification**: `curl -fsS "$API_BASE_URL/api/users/$id" | jq -e --arg id "$id" --arg e "$email" '.id == $id and .email == $e'`
      **Cleanup**: `[ -n "$id" ] && curl -fsS -X DELETE "$API_BASE_URL/api/users/$id" > /dev/null || true`

### Text scan (grep) — for spec/log/output content

- [ ] **Forbidden token absent from report**
      **Verification**: `[ -f report.txt ] && ! grep -q "forbidden-token" report.txt`

### CLI exec + stdout

- [ ] **`./bin/migrate --dry-run` reports planned migrations to stdout**
      **Verification**: `./bin/migrate --dry-run | grep -qE '^[+-] migrations/[0-9]+_'`

### Implementation test runner (caveat — NOT default AC)

Unit/integration test runners (`bun test ...`, `vitest ...`) are **implementation evidence**, not default AC primitives. They can be cited as AC verification ONLY when the tested unit IS the consumer boundary.

Legitimate use (unit IS the consumer surface):

- [ ] **`splitCommand` (public library export) preserves quoted arguments as a single token**
      **Verification**: `bun test tests/splitCommand.test.ts -t "preserves quoted args"`
      Consumer: library callers (other developers/agents) invoking via `import { splitCommand } from '...'`. Consumer boundary = exported function signature.

Illegitimate use (unit is internal helper):

> ~~**`UserService.create` rejects duplicate email**~~
> ~~Verification: Unit test asserts result when repository returns existing user~~

→ instead, verify at the HTTP boundary that `POST /api/users` with duplicate email returns 409. The internal method behavior is implementation evidence.

---

## Counter-Example: Fixing a Batch AC

### Bad

```
- [ ] All 46 lint findings are resolved
      Verification: grep -c "finding" report.txt → 0
```

This is a Compound AC: it bundles 46 independent state changes into one assertion.

### Good

Decompose by concern. Each finding type becomes its own AC with its own Verification:

```
- [ ] Report contains no forbidden-token occurrence
      Verification: [ -f report.txt ] && ! grep -q "forbidden-token" report.txt && echo "PASS: forbidden-token absent"

- [ ] Report contains no missing-verdict occurrence
      Verification: [ -f report.txt ] && ! grep -q "missing-verdict" report.txt && echo "PASS: missing-verdict absent"
```

---

## Worked Example — AC Proposal

**User request:** "council과 spec-review에서 공통 로직을 추출하고, oh-my-claude-sisyphus의 프롬프트 조립 패턴을 참고해서 구조화된 프롬프트 파이프라인을 만들어줘"

## Proposed Acceptance Criteria

### 1. Shared Worker Infrastructure

**Responsibility:** council과 spec-review 워커의 공통 로직을 단일 소스로 통합하여, 이후 변경이 한 곳에서만 이루어지게 한다.

- [ ] 공통 로직(명령어 파싱, 프로세스 스폰, 재시도, 상태 기록)이 하나의 모듈에서 관리된다
      **Verification**: council-worker와 spec-worker 양쪽에서 공통 모듈을 import하며, 중복 함수가 0개
- [ ] 각 워커는 공통 모듈에 스킬별 설정(용어, 디렉토리 구조)만 주입한다
      **Verification**: 워커 파일이 config 객체를 생성하여 공통 모듈에 전달하는 패턴만 포함

**Not covered:** 공통 모듈의 API 설계 (구현자 재량), 테스트 프레임워크 변경

### 2. Structured Prompt Assembly Pipeline

**Responsibility:** 외부 모델이 구조화된 프롬프트를 수신하도록 한다. prompt injection에 취약하지 않도록.

**Required Reference — oh-my-claude-sisyphus:**
- buildPromptWithSystemContext()의 3-layer 조립 구조

- [ ] 최종 프롬프트가 3-layer 계층 구조를 가진다: (1) system instructions, (2) untrusted content with injection-safe delimiter, (3) user prompt
      **Verification**: 전송 로그에서 delimiter 패턴(`===UNTRUSTED` 등)이 확인됨
- [ ] role prompt 파일이 없는 member는 기존 동작(raw prompt)으로 graceful fallback한다
      **Verification**: role prompt 없이 실행 시 에러 없이 기존 출력과 동일

**Not covered:** role prompt 파일 내용 작성, Codex 에이전트 포맷 변환

### Out of Scope (explicitly excluded)
- Dynamic member selection, sequential cross-validation
- UI payload 구조 변경

---
**Please review:**
1. Are these criteria correct and complete?
2. Any criteria to add, modify, or remove?
3. Any priorities among these criteria?

---

## Handling User Response

| User Response | Your Action |
|---------------|-------------|
| "Looks good" / "Approved" | Proceed to Metis consultation with these criteria (see `review-pipeline.md`) |
| Modifications requested | Update criteria, re-propose if significant changes |
| "Just do it" / Skips review | Use your draft as-is, note in plan that criteria were AI-generated |

**NEVER proceed to plan generation without acceptance criteria.**
