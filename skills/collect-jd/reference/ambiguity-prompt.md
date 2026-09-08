# ambiguity-prompt — JD-Profile Matching Judgment Predicate

## 1. Purpose

An LLM predicate that returns a `match | mismatch | ambiguous` verdict for each JD in the history → rules → filter matching loop.

`AskUserQuestion` is called only when the verdict is `ambiguous`. `match` and `mismatch` finalize the status automatically with no user intervention.

---

## 2. Invocation Spec

| Item | Value |
|---|---|
| Model | Specified in SKILL.md (Claude) |
| Temperature | **0** |
| Max tokens | 1024 |
| Message structure | Single user message (system + user inlined) |

---

## 3. Input Contract

| Variable | Type | Limit | Description |
|---|---|---|---|
| `{profile_summary}` | string | ≤ 2000 chars | User taste / skills / career summary |
| `{rules_yaml}` | string | ≤ 3000 chars | Current `rules.yaml` content, raw |
| `{jd_body}` | string | ≤ 5000 chars | JD body verbatim |
| `{jd_company}` | string | — | Company name verbatim |
| `{jd_role_title_verbatim}` | string | — | Role title verbatim |

---

## 4. Output Contract (JSON strict)

The LLM must output only the JSON below. Any preamble, markdown, or text outside the JSON is treated as a parse failure.

```json
{
  "verdict": "match" | "mismatch" | "ambiguous",
  "missing_signals": ["string", "..."],
  "violated_rules": ["string", "..."],
  "explanation": "짧은 한국어 1-2문장"
}
```

| Field | Type | Description |
|---|---|---|
| `verdict` | enum | `match` \| `mismatch` \| `ambiguous` |
| `missing_signals` | array[string] | Signals absent from the JD (e.g. `"compensation range"`, `"location"`) |
| `violated_rules` | array[string] | `rules.yaml` key names that are violated (populated when `verdict` is `mismatch`; empty array otherwise) |
| `explanation` | string | Korean prose stating the judgment rationale |

---

## 5. Decision Rules

| verdict | Automatic behavior | Condition |
|---|---|---|
| `match` | `status: included` finalized automatically | Rules conditions clearly satisfied |
| `mismatch` | `status: excluded` finalized automatically. `tags`: derived from `violated_rules` — each entry is slugified and appended per the Exclude Flow tags.yaml protocol. `reason_note`: `auto:mismatch:<rules.yaml sha256 short 8>` (follows the Matching Loop Auto-decision audit trail rule). **Verbatim user utterance must NOT be substituted — user utterance is only used in the manual exclude path** | Rules conditions clearly violated |
| `ambiguous` | **AskUserQuestion call is MANDATORY**. Include `missing_signals` in the question. Status remains tentatively `pending` | Required signals absent or only partial information exists |

If `missing_signals` is empty on an `ambiguous` response, treat it as an implementation error.

---

## 6. Pinned Prompt (Template)

```
System: You are a strict JD-profile matching judge. Output ONLY JSON:
{"verdict": "match"|"mismatch"|"ambiguous", "missing_signals": [string], "violated_rules": [string], "explanation": string}.
No preamble, no markdown, no text outside JSON.

User:
Judge whether this JD suits the user based on the profile and rules.

[Profile summary]
{profile_summary}

[Current rules.yaml]
{rules_yaml}

[JD]
Company: {jd_company}
Role (verbatim): {jd_role_title_verbatim}
Body:
{jd_body}

Criteria:
- "match" if the rules' conditions are clearly satisfied.
- "mismatch" if the rules' conditions are clearly violated.
- "ambiguous" if signals needed for judgment are **absent** from the JD or only partial information exists without conflicting with the rules.
- List signals missing from the JD body as bullets in `missing_signals` (e.g., "compensation range", "location", "seniority", "원격 가능 여부").
- If verdict is `mismatch`, fill the `violated_rules` array with the violated rules.yaml key names (e.g., ["min_yoe", "stack_must_have"]). If `match` or `ambiguous`, output an empty array [].
- Write `explanation` in Korean, 1-2 sentences.

Output JSON only.
```

---

## 7. Fixtures

### 7-1. match fixture

**Input summary**

- rules: `Kotlin + Spring + 5년 이상 경력 요구`
- JD: `Kotlin/Spring 기반 백엔드, 5년+ 경력자 우대`

**Expected output**

```json
{
  "verdict": "match",
  "missing_signals": [],
  "violated_rules": [],
  "explanation": "rules 의 Kotlin/Spring 및 5년 이상 조건을 JD 가 명확히 만족한다."
}
```

---

### 7-2. mismatch fixture

**Input summary**

- rules: `주 5일 출근 불가 — 원격/하이브리드 필수`
- JD: `Full on-site required (5 days a week)`

**Expected output**

```json
{
  "verdict": "mismatch",
  "missing_signals": [],
  "violated_rules": ["work_mode_required"],
  "explanation": "주 5일 전일 출근 필수로 rules 의 원격/하이브리드 조건을 위반한다."
}
```

---

### 7-3. ambiguous fixture

**Input summary**

- rules: `원격 근무 필수`
- JD: location and work mode not specified

**Expected output**

```json
{
  "verdict": "ambiguous",
  "missing_signals": ["location", "work_mode"],
  "violated_rules": [],
  "explanation": "JD 에 위치와 근무형태 정보가 없어 원격 가능 여부를 판정할 수 없다."
}
```

---

## 8. Retry / Failure Policy

| Situation | Behavior |
|---|---|
| JSON parse failure (1st attempt) | Retry once with the same prompt |
| JSON parse failure (2nd attempt) | Conservative fallback: `verdict: ambiguous`, `missing_signals: ["llm_parse_failure"]`, `violated_rules: []` |
| `verdict` value outside the enum | Treat the same as a parse failure |
| `ambiguous` with empty `missing_signals` array | Implementation warning log + correct to `missing_signals: ["unknown"]` |

---

## 9. Versioning Note

When modifying this prompt:

1. Bump the version comment at the top of this prompt file (`v1`, `v2`, etc.). (There is no version field in SKILL.md frontmatter, and repo convention is not to add a version field to skill-source YAML — per Plan DoD H2.)
2. Run regression re-validation including the 3 fixtures above (match / mismatch / ambiguous).
3. Record the prompt change history in the git commit message.
