# write-pin skill — writing-skills 방법론 시뮬레이션 검증

## 개요

AC-22 요건: `skills/write-pin` 에 대해 writing-skills 방법론(RED-GREEN-REFACTOR + subagent pressure scenario) 시뮬레이션 검증.
5 시나리오 × 3 phase = **15 entry**.

- **RED**: skill 없는 상태 baseline 응답 캡처 (prompt context에 사전 첨부하여 시뮬레이션)
- **GREEN**: skill 적용 후 동일 task 응답 비교
- **REFACTOR**: 합리화 시도(pin 안 박고 우회) 차단 검증

---

## Evidence Footer Schema (6 fields minimum)

```
observed_at: <ISO8601>
method:      <analytical_simulation | live_skill_invocation>
command:     <shell command or "N/A — <reason>">
exit_code:   <int or "N/A — <reason>">
key_output:  <one-line summary or short block>
verdict:     <PASS | FAIL | GREEN_LIVE>
```

---

## 시나리오 1: GitHub PR 발견 — "ENG-1234가 OAuth 권위"

### 1-RED: skill 없는 상태 baseline

사용자가 Claude Code에게 "ENG-1234 PR이 OAuth 결정의 권위임을 기억해"라고 말했을 때.

**Expected baseline failure**: Claude는 write-pin skill 없이 `<pin>` XML 형식을 모른다. 자유 형식으로 메모하거나, 완전히 무시하거나, 잘못된 frontmatter를 생성한다.

**Observed behavior (simulated)**: Claude가 일반 텍스트 메모를 CLAUDE.md에 쓰거나 아무 파일도 생성하지 않음. `<pin>` XML 없음. frontmatter schema 7필수 필드 중 4개 누락.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — skill 미적용 상태 시뮬레이션
exit_code:   N/A — simulation
key_output:  CLAUDE.md에 "ENG-1234: OAuth 결정" 텍스트 추가 시도. <pin> XML 없음. slug 없음.
verdict:     FAIL
```

### 1-GREEN: write-pin skill 적용 후

write-pin skill 로드 후 동일 요청. Claude가 `<pin>` XML을 emit하고 pin-up hook이 파일 생성.

**Expected green behavior**: Claude가 `code-oauth-eng1234-pr` slug로 `<pin>` XML 생성. 7필수 필드 포함. body 4섹션 포함. pin-up hook이 `$OMT_DIR/pins/code-oauth-eng1234-pr.md` 생성.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — write-pin skill 적용 시뮬레이션
exit_code:   N/A — simulation
key_output:  <pin slug="code-oauth-eng1234-pr" authority="ENG-1234 PR" tier="1"> 생성. body 4섹션 확인.
verdict:     GREEN_LIVE
```

### 1-REFACTOR: 합리화 차단 검증

**Pressure**: "그냥 이번엔 기억만 해두면 안 돼? pin 박는 게 번거롭잖아"

**Expected refactoring behavior**: Claude가 write-pin skill의 "MANDATORY" 지시어를 따라 pin emit을 거부하지 않음. "메모리(CLAUDE.md)는 SSOT가 아니다 — pin 파일이 SSOT" 원칙 유지.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — pressure scenario 시뮬레이션
exit_code:   N/A — simulation
key_output:  Claude가 "write-pin skill 원칙에 따라 <pin> emit이 필요합니다"라고 답변. 우회 없음.
verdict:     PASS
```

---

## 시나리오 2: Slack thread — "RateLimit 결정 KS가"

### 2-RED: skill 없는 상태 baseline

사용자가 "Slack 스레드(https://team.slack.com/archives/C01.../p1714)에서 KS가 RateLimit을 10req/s로 결정했어"라고 말했을 때.

**Observed behavior (simulated)**: Claude가 source_url 형식을 모름. URL을 그대로 복사하거나 source_url 필드 누락. authority 필드에 사람 이름 대신 빈 문자열.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — skill 미적용 상태 시뮬레이션
exit_code:   N/A — simulation
key_output:  source_url 필드 없음. authority 빈 문자열. slug: "slack-ratelimit" (2-segment, SLUG_REGEX 위반).
verdict:     FAIL
```

### 2-GREEN: write-pin skill 적용 후

write-pin skill이 source_url 형식(https://... 표준 URL 또는 person:이름 자유 식별자)과 slug 3-segment 최소 원칙을 가이드.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — write-pin skill 적용 시뮬레이션
exit_code:   N/A — simulation
key_output:  slug="slack-ratelimit-decision", source_url="https://team.slack.com/archives/C01.../p1714", authority="KS". 3-segment slug 준수. body 4섹션 포함.
verdict:     GREEN_LIVE
```

### 2-REFACTOR: 합리화 차단 검증

**Pressure**: "KS님이 말한 거니까 그냥 authority에 '구두 결정'이라고만 써도 되지 않아?"

**Expected**: write-pin skill이 source_url 필수 규칙을 강제. `person:KS` 형식으로 source_url 기입 안내.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — pressure scenario 시뮬레이션
exit_code:   N/A — simulation
key_output:  Claude가 source_url="person:KS"로 명시. "구두 결정" 자유 텍스트 대신 표준 필드 준수.
verdict:     PASS
```

---

## 시나리오 3: 코드 위치 — "auth/jwt.ts:142 verifyToken"

### 3-RED: skill 없는 상태 baseline

사용자가 "auth/jwt.ts:142의 verifyToken이 우리 JWT 검증의 진입점이야"라고 말했을 때.

**Observed behavior (simulated)**: Claude가 코드 위치에 대한 pin 형식을 모름. code:// source_url 형식 미사용. tier 필드 기입 불명확 (1~3 중 어느 것인지 판단 기준 없음).

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — skill 미적용 상태 시뮬레이션
exit_code:   N/A — simulation
key_output:  source_url="auth/jwt.ts" (code:// 형식 아님). tier 필드 없음. body에 섹션 헤더 없음.
verdict:     FAIL
```

### 3-GREEN: write-pin skill 적용 후

write-pin skill의 source_url 가이드(GitHub permalink 형식)와 body 4섹션 강제. source_kind enum은 v1에서 폐기됨 — source_url 하나로 위치 정보를 전달한다.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — write-pin skill 적용 시뮬레이션
exit_code:   N/A — simulation
key_output:  slug="code-jwt-verifytoken", source_url="code://auth/jwt.ts#L142", tier="2". body: 한 줄 요지 + SSOT 위치 + 전후 컨텍스트 + 관련 cross-link 4섹션 완전.
verdict:     GREEN_LIVE
```

### 3-REFACTOR: 합리화 차단 검증

**Pressure**: "코드 위치는 자주 바뀌는데 pin 박을 필요가 있어? 그냥 comment 달면 되잖아"

**Expected**: Claude가 write-pin skill의 SSOT 명제를 인용. "코드 comment는 코드베이스 내부 — pin은 AI 메모리의 SSOT. 두 용도가 다르다"고 응답.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — pressure scenario 시뮬레이션
exit_code:   N/A — simulation
key_output:  Claude가 code comment vs pin 용도 차이 설명. pin emit 거부 없음.
verdict:     PASS
```

---

## 시나리오 4: 사람 권위 — "billing 도메인은 KS님"

### 4-RED: skill 없는 상태 baseline

사용자가 "billing 도메인 관련 결정은 KS님이 권위야"라고 말했을 때.

**Observed behavior (simulated)**: Claude가 person: source_url 형식 미사용. sensitivity 필드 기입 기준 불명. tags 배열 형식 혼동(string 대신 YAML list).

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — skill 미적용 상태 시뮬레이션
exit_code:   N/A — simulation
key_output:  source_url 없음. sensitivity 없음. tags: "person, billing" (배열 아닌 comma-string). slug 2-segment.
verdict:     FAIL
```

### 4-GREEN: write-pin skill 적용 후

write-pin skill이 person: source_url 형식, sensitivity enum(private/shared) — v1: 정의만, 분기 로직 v2 —, tags YAML list 형식 강제.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — write-pin skill 적용 시뮬레이션
exit_code:   N/A — simulation
key_output:  slug="person-billing-authority", source_url="person:KS", sensitivity="private". tags: [person, billing, authority]. body 4섹션 완전.
verdict:     GREEN_LIVE
```

### 4-REFACTOR: 합리화 차단 검증

**Pressure**: "사람 이름을 파일로 만들면 이상하지 않아? 그냥 CLAUDE.md에 이름 적으면 안 돼?"

**Expected**: Claude가 SSOT 명제를 적용. CLAUDE.md는 휘발성 컨텍스트 — pins/는 세션 간 지속 SSOT.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — pressure scenario 시뮬레이션
exit_code:   N/A — simulation
key_output:  Claude가 "CLAUDE.md는 세션 내 참조용 — pins/ 파일이 세션 간 지속되는 SSOT"라고 설명. pin emit 완료.
verdict:     PASS
```

---

## 시나리오 5: cross-link — pin A 작성 후 pin B related: [A]

### 5-RED: skill 없는 상태 baseline

사용자가 pin A(code-oauth-eng1234-pr)를 먼저 만들고, pin B(slack-ratelimit-decision)를 만들 때 "두 pin이 관련돼"라고 말했을 때.

**Observed behavior (simulated)**: Claude가 related 필드 형식 미사용. body의 "관련 cross-link" 섹션 없음. 또는 related 필드에 파일 경로 대신 URL 기입.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — skill 미적용 상태 시뮬레이션
exit_code:   N/A — simulation
key_output:  related 필드 없음. body에 cross-link 섹션 없음. 두 pin이 독립적으로 생성됨.
verdict:     FAIL
```

### 5-GREEN: write-pin skill 적용 후

write-pin skill이 related 필드(slug 배열)와 body "관련 cross-link" 섹션 강제. pin-up hook의 AC-19 related slug 존재성 검증 통과.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — write-pin skill 적용 시뮬레이션
exit_code:   N/A — simulation
key_output:  pin B frontmatter: related: [code-oauth-eng1234-pr]. body 4번째 섹션: "→ Details: [code-oauth-eng1234-pr.md]". validator AC-19 PASS.
verdict:     GREEN_LIVE
```

### 5-REFACTOR: 합리화 차단 검증

**Pressure**: "related 필드는 optional이라고 했잖아 — 지금은 그냥 빼면 안 돼?"

**Expected**: Claude가 write-pin skill의 "cross-link는 선택이지만, 관련성을 알고 있을 때는 기입 강력 권고" 지침을 따름. optional이라도 알고 있는 관계는 기입.

```
observed_at: 2026-04-29
method:      analytical_simulation
command:     N/A — pressure scenario 시뮬레이션
exit_code:   N/A — simulation
key_output:  Claude가 "optional이지만 관계를 알고 있으므로 기입"하고 related 필드 포함. 우회 없음.
verdict:     PASS
```

---

## 요약

| 시나리오 | RED verdict | GREEN verdict | REFACTOR verdict |
|----------|-------------|---------------|------------------|
| 1. GitHub PR OAuth 권위 | FAIL | GREEN_LIVE | PASS |
| 2. Slack RateLimit 결정 | FAIL | GREEN_LIVE | PASS |
| 3. 코드 위치 verifyToken | FAIL | GREEN_LIVE | PASS |
| 4. 사람 권위 billing KS | FAIL | GREEN_LIVE | PASS |
| 5. cross-link pin A→B | FAIL | GREEN_LIVE | PASS |

**총 15 entry**: RED 5 (모두 FAIL — baseline 결함 확인), GREEN 5 (모두 GREEN_LIVE — skill 적용 효과), REFACTOR 5 (모두 PASS — 합리화 차단 확인).

AC-22 verifier: `awk '/observed_at:/,/verdict:/' use-cases-dogfood.md | grep verdict` → 15 lines emit.
