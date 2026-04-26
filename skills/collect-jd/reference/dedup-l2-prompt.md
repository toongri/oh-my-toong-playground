# Dedup Layer 2 Prompt

## 1. Purpose

L2 dedup is the stage where the LLM judges whether two JD bodies represent the **same position**, after passing the L1 URL/slug matching step.

When to invoke:
- L1 matching failed (different URL, different slug) but the JD was re-collected after TTL expiry
- Cases where a URL structure change may have caused re-collection of an identical JD
- Cases requiring semantic body-level comparison as a simhash substitute

L1 pass (definite duplicate) skips L2. L2 is called only for cases L1 could not resolve.

---

## 2. Invocation Spec

| Item | Value |
|---|---|
| Model | Claude Sonnet or Opus (specified in SKILL.md version entry) |
| Temperature | **0** (deterministic — same input produces same output) |
| Max tokens | **512** (keep the reason field short) |
| Message structure | 1 system message + 1 user message (single-turn) |
| Stream | false |

Message structure summary:
- `system`: Role definition + strict JSON output enforcement
- `user`: Judgment request containing both JD bodies (delivered after variable substitution)

---

## 3. Input Contract

The skill code must prepare the following fields before invoking the LLM.

| Variable | Source | Processing |
|---|---|---|
| `{A_company}` | frontmatter `company` | Verbatim |
| `{A_role_title}` | frontmatter `role_title_verbatim` | Verbatim |
| `{A_body}` | JD file body (excluding frontmatter) | **Truncate to first 5000 chars if over 5000 chars** |
| `{B_company}` | Comparison target frontmatter `company` | Verbatim |
| `{B_role_title}` | Comparison target frontmatter `role_title_verbatim` | Verbatim |
| `{B_body}` | Comparison target JD file body | **Truncate to first 5000 chars if over 5000 chars** |

When truncating, append `[...본문 일부 생략]` to the end of the body to signal truncation to the LLM.

---

## 4. Pinned Prompt (v1)

> The system/user text in this section is the pinned prompt actually delivered to the LLM.
> Variables (e.g. `{A_company}`) are substituted immediately before the call.

### System

```
You are a strict JD deduplication judge.
Output ONLY a JSON object: {"same": bool, "reason": string}.
No preamble, no markdown, no explanation outside the JSON object.
The "reason" field must be written in Korean and must be concise (1-2 sentences).
```

### User

```
아래 두 JD 가 "같은 채용 포지션"인지 판정해라.

[JD A]
회사: {A_company}
직무명(원문): {A_role_title}
본문:
{A_body}

[JD B]
회사: {B_company}
직무명(원문): {B_role_title}
본문:
{B_body}

판정 기준:
- same=true: 같은 회사이고, 같은 팀·같은 롤·같은 seniority 레벨이면 중복으로 판정한다.
- same=false: 같은 회사여도 팀이 다르거나, seniority 차이가 명확하거나, 주요 업무 범위가 다르면 별도 포지션으로 판정한다.
- 회사가 다르면 항상 same=false.

본문 전체를 비교하고, 결과를 JSON 만 출력해라.
```

---

## 5. Output Contract

The LLM must output only the JSON below. Any other text included in the response is treated as a parse failure.

```json
{"same": true, "reason": "두 JD 는 동일한 회사의 동일한 백엔드 팀 공고로, 본문 내용이 실질적으로 동일하다."}
```

```json
{"same": false, "reason": "같은 회사지만 A 는 플랫폼팀, B 는 결제팀 소속으로 주요 업무가 다르다."}
```

Field specification:

| Field | Type | Description |
|---|---|---|
| `same` | boolean | `true` = duplicate, `false` = separate position |
| `reason` | string | Korean judgment rationale, 1-2 sentences |

---

## 6. Decision Rules (how the skill code interprets the response)

### Normal response

| `same` value | Skill behavior |
|---|---|
| `true` | **Prohibit** creating a new file. Update `last_checked_at` on the existing file. Record `fingerprint_check: duplicate_of:<url>`. |
| `false` | Proceed with saving the new file. Record `fingerprint_check: unique`. |

### Parse failure

1. **1 automatic retry**: Re-invoke LLM with the same input.
2. **Still failing after retry**: Conservative fallback — save the new file with `fingerprint_check: pending` status. Skip dedup and leave it for manual user review.

Parse failure criteria:
- Response is not valid JSON
- `same` field is not a boolean
- `reason` field is missing

---

## 7. Fixture Pair 1 — same: true

> Cross-posting of a company blog JD to a job portal. L1 passed due to different URLs, but bodies are identical.

| | JD A (blog original) | JD B (job portal) |
|---|---|---|
| Company | 당근마켓 | 당근마켓 |
| Role title | 백엔드 엔지니어 (플랫폼) | Backend Engineer (Platform) |
| Body summary | 플랫폼팀 / gRPC 서비스 / Go·Kotlin 3년+ | 플랫폼팀 / gRPC 서비스 / Go·Kotlin 3년+ |

**Expected output**:
```json
{"same": true, "reason": "두 JD 는 동일한 회사(당근마켓) 플랫폼팀의 동일 포지션으로, 직무명 표기만 다를 뿐 본문 내용이 실질적으로 동일하다."}
```

---

## 8. Fixture Pair 2 — same: false

> Same company, similar role title, but different team and primary responsibilities.

| | JD A | JD B |
|---|---|---|
| Company | 토스 | 토스 |
| Role title | 백엔드 엔지니어 (결제) | 백엔드 엔지니어 (인프라) |
| Team | 결제팀 — PG 연동·정산 배치 | 인프라팀 — 멀티클라우드·SRE |
| Requirements | Kotlin / 금융 도메인 | Kubernetes / Terraform |

**Expected output**:
```json
{"same": false, "reason": "같은 토스 소속이지만 A 는 결제팀(PG 연동·정산), B 는 인프라팀(클라우드·SRE)으로 팀과 주요 업무가 명확히 다르다."}
```

---

## 9. Versioning Note

This file is the `v1` prompt.

When changing the prompt content (system or user text):

1. Bump the section 4 header in this file to `## 4. Pinned Prompt (v2)` etc.
2. Record the change history in the version entry at the top of `SKILL.md` (e.g. `dedup-l2-prompt: v1 → v2, reason`).
3. Do not delete the previous version prompt — preserve it as a subsection (for reproducibility).

Version mismatch (version referenced by skill code vs. current version in this file) must be resolved before deployment.
