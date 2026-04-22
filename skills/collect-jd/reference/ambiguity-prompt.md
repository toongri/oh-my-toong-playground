# ambiguity-prompt — JD-Profile 매칭 판정 Predicate

## 1. Purpose

history → rules → filter 매칭 루프에서 각 JD 에 대해 `match | mismatch | ambiguous` verdict 를 반환하는 LLM predicate 다.

`ambiguous` 일 때만 `AskUserQuestion` 을 호출한다. `match` 와 `mismatch` 는 자동으로 status 를 확정하며 사용자 개입이 없다.

---

## 2. Invocation Spec

| 항목 | 값 |
|---|---|
| Model | SKILL.md 에서 지정 (Claude) |
| Temperature | **0** |
| Max tokens | 1024 |
| Message structure | Single user message (system + user 인라인) |

---

## 3. Input Contract

| 변수 | 타입 | 제한 | 설명 |
|---|---|---|---|
| `{profile_summary}` | string | ≤ 2000 chars | 유저 taste / skills / career 요약 |
| `{rules_yaml}` | string | ≤ 3000 chars | 현재 `rules.yaml` 내용 raw |
| `{jd_body}` | string | ≤ 5000 chars | JD 본문 원문 |
| `{jd_company}` | string | — | 회사명 원문 |
| `{jd_role_title_verbatim}` | string | — | 직무 제목 원문 |

---

## 4. Output Contract (JSON strict)

LLM 은 아래 JSON 만 출력해야 한다. preamble, markdown, JSON 외 텍스트는 모두 파싱 실패로 처리한다.

```json
{
  "verdict": "match" | "mismatch" | "ambiguous",
  "missing_signals": ["string", "..."],
  "explanation": "짧은 한국어 1-2문장"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `verdict` | enum | `match` \| `mismatch` \| `ambiguous` |
| `missing_signals` | array[string] | JD 에서 결여된 신호 (예: `"compensation range"`, `"location"`) |
| `explanation` | string | 판정 근거 한국어 서술 |

---

## 5. Decision Rules

| verdict | 자동 동작 | 조건 |
|---|---|---|
| `match` | `status: included` 자동 확정 | rules 조건을 명확히 만족 |
| `mismatch` | `status: excluded` 자동 확정. `tags` + `reason_note` 는 위반 규칙 이름으로 자동 채움 | rules 조건을 명확히 위반 |
| `ambiguous` | **AskUserQuestion 호출 필수**. `missing_signals` 를 질문에 포함. status 는 잠정 `pending` | 판정에 필요한 신호 부재 또는 부분 정보만 존재 |

`ambiguous` 응답에서 `missing_signals` 가 비어있으면 구현 오류로 간주한다.

---

## 6. Pinned Prompt (템플릿)

```
System: You are a strict JD-profile matching judge. Output ONLY JSON:
{"verdict": "match"|"mismatch"|"ambiguous", "missing_signals": [string], "explanation": string}.
No preamble, no markdown, no text outside JSON.

User:
프로필과 규칙을 바탕으로 이 JD 가 유저에게 맞는지 판정해라.

[프로필 요약]
{profile_summary}

[현재 rules.yaml]
{rules_yaml}

[JD]
회사: {jd_company}
직무(원문): {jd_role_title_verbatim}
본문:
{jd_body}

기준:
- rules 의 조건을 명확히 만족하면 "match".
- rules 의 조건을 명확히 위반하면 "mismatch".
- 판정에 필요한 신호가 JD 에 **부재**하거나 rules 와 충돌 없이 부분 정보만 있으면 "ambiguous".
- `missing_signals` 에는 JD 본문에서 결여된 신호를 bullet 로 (예: "compensation range", "location", "seniority", "원격 가능 여부").
- `explanation` 은 한국어 1-2문장.

JSON 만 출력해라.
```

---

## 7. Fixtures

### 7-1. match fixture

**Input 요약**

- rules: `Kotlin + Spring + 5년 이상 경력 요구`
- JD: `Kotlin/Spring 기반 백엔드, 5년+ 경력자 우대`

**Expected output**

```json
{
  "verdict": "match",
  "missing_signals": [],
  "explanation": "rules 의 Kotlin/Spring 및 5년 이상 조건을 JD 가 명확히 만족한다."
}
```

---

### 7-2. mismatch fixture

**Input 요약**

- rules: `주 5일 출근 불가 — 원격/하이브리드 필수`
- JD: `Full on-site required (5 days a week)`

**Expected output**

```json
{
  "verdict": "mismatch",
  "missing_signals": [],
  "explanation": "주 5일 전일 출근 필수로 rules 의 원격/하이브리드 조건을 위반한다."
}
```

---

### 7-3. ambiguous fixture

**Input 요약**

- rules: `원격 근무 필수`
- JD: 위치 및 근무형태 미기재

**Expected output**

```json
{
  "verdict": "ambiguous",
  "missing_signals": ["location", "work_mode"],
  "explanation": "JD 에 위치와 근무형태 정보가 없어 원격 가능 여부를 판정할 수 없다."
}
```

---

## 8. Retry / Failure Policy

| 상황 | 동작 |
|---|---|
| JSON 파싱 실패 (1회차) | 동일 프롬프트로 1회 재시도 |
| JSON 파싱 실패 (2회차) | conservative fallback: `verdict: ambiguous`, `missing_signals: ["llm_parse_failure"]` |
| `verdict` 값이 enum 외 | 파싱 실패와 동일하게 처리 |
| `ambiguous` 인데 `missing_signals` 빈 배열 | 구현 경고 로그 + `missing_signals: ["unknown"]` 로 보정 |

---

## 9. Versioning Note

이 프롬프트를 수정할 때:

1. `SKILL.md` 의 버전 필드를 bump 한다.
2. 위 3개 fixture (match / mismatch / ambiguous) 를 포함한 regression 재검증을 수행한다.
3. 프롬프트 변경 이력은 git commit 메시지에 기록한다.
