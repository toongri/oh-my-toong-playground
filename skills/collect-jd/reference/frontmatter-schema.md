# JD Frontmatter Schema

## Overview

This schema applies to the frontmatter of all JD files at path `$OMT_DIR/collect-jd/jobs/<company_slug>/<role_title_slug>-<YYMMDD>.md`.

File name example: `$OMT_DIR/collect-jd/jobs/toss-bank/백엔드-엔지니어-260422.md`

---

## Required Fields

| Field | Type | Description |
|---|---|---|
| `version` | integer | Schema version. Currently `1`. State YAML only — do not use in skill-source files |
| `url` | string | Normalized URL stored after applying `normalizeUrl()` |
| `company` | string | Company name verbatim (e.g., `Toss Bank`) |
| `company_slug` | string | `slugify(company)` (e.g., `toss-bank`) |
| `role_title_verbatim` | string | JD title exactly as written in source (e.g., `백엔드 엔지니어 (서버)`) |
| `role_title_slug` | string | `slugify(role_title_verbatim)` (e.g., `백엔드-엔지니어-서버`) |
| `role_tags` | array[string] | Subset of `$OMT_DIR/collect-jd/profile/taxonomy.yaml` enum. At least 1 required |
| `status` | enum | `included \| excluded \| ambiguous \| pending` |
| `last_checked_at` | string | ISO8601 datetime (e.g., `2026-04-22T10:00:00+09:00`) |
| `fingerprint_check` | enum | `pending \| unique \| duplicate_of:<url>` |

---

## Conditional Fields

The fields below are conditionally required or allowed depending on the `status` value and audit trail state.

| Field | Condition | Description |
|---|---|---|
| `tags` | Required when `status == excluded` (≥1 tag) | Exclusion reason tags. Refer to the `$OMT_DIR/collect-jd/tags.yaml` emergent dictionary. Empty array or absent when `status != excluded` (valid) |
| `reason_note` | Required when `status == excluded` (empty string forbidden). Optional as audit trail for other statuses | `status == excluded`: prose description of exclusion reason (verbatim user speech or `auto:mismatch:<sha>` for auto-mismatch). Others: `auto:<verdict>:<sha>` or accumulated `prev: <status> @ <ISO date>` lines. On reversal, prepend `prev: <prev status> @ <ISO date>` at the top |

---

## Optional Fields

| Field | Type | Description |
|---|---|---|
| `quote` | string | Verbatim user speech about this JD (e.g., `"이거 별로야"`) |

---

## status Closed Enum

`status` accepts only the following 4 values. Any other value is a validation violation.

| Value | Meaning |
|---|---|
| `included` | Match — confirmed as a collection target |
| `excluded` | Exclusion confirmed — `tags` + `reason_note` required |
| `ambiguous` | Cannot be determined by rules — awaiting user response |
| `pending` | Not yet evaluated (dedup deferred or immediately after new ingest) |

Rules re-evaluation or batch re-scan does **NOT overwrite a status that the user edited directly**. When manual edits are detected, skip that file and include "manual skipped" in the batch report.

---

## Reversal Semantics

When reversing a status (e.g., `included` → `excluded`, `excluded` → `included`), prepend the following line at the top of `reason_note`.

Format: `prev: <previous status> @ <ISO date>`

Example 1 — included → excluded:
```
prev: included @ 2026-04-22
이 회사는 서울 근무가 필수라 제외함.
```

Example 2 — excluded → included (reversed after re-evaluation):
```
prev: excluded @ 2026-03-10
prev: included @ 2026-02-15
최근 리모트 전환 확인 — 재포함.
```

Each additional reversal prepends a new `prev:` line at the top. Existing lines are never deleted.

---

## Examples

### Example 1 — status: included

```yaml
---
version: 1
url: https://toss.im/jobs/backend-engineer
company: 토스
company_slug: 토스
role_title_verbatim: 백엔드 엔지니어
role_title_slug: 백엔드-엔지니어
role_tags:
  - backend
status: included
last_checked_at: "2026-04-22T10:30:00+09:00"
fingerprint_check: unique
reason_note: "auto:match:abc12345"
quote: "토스 백엔드 포지션 확인해봐"
---

JD 본문...
```

### Example 2 — status: excluded (with tags + reason_note)

```yaml
---
version: 1
url: https://wanted.co.kr/wd/99999
company: XYZ Corp
company_slug: xyz-corp
role_title_verbatim: Senior Frontend Engineer
role_title_slug: senior-frontend-engineer
role_tags:
  - frontend
status: excluded
last_checked_at: "2026-04-22T11:00:00+09:00"
fingerprint_check: unique
tags:
  - level_mismatch
  - frontend_only
reason_note: |
  prev: included @ 2026-04-10
  시니어 레벨 요구 + 프론트엔드 전담 포지션. 현재 경력 미달 및 백엔드 집중 방향성과 불일치.
---

JD 본문...
```

---

## Validation Rules Summary

| Rule | Action on Violation |
|---|---|
| `status: excluded` but `tags` is empty array | Validation failure — write rejected |
| `status: excluded` but `reason_note` absent | Validation failure — write rejected |
| `status` value outside the 4-value enum | Validation failure — write rejected |
| `role_tags` is empty array | Validation failure — retry LLM tagging on ingest |
| `fingerprint_check: duplicate_of:<url>` but new file creation attempted | Creation blocked — update only `last_checked_at` on existing file |
| YAML parse failure | No crash — back up as `<file>.bak.<timestamp>` and present recovery options to user |
| `status != excluded` and `reason_note` contains `auto:<verdict>:<sha>` or `prev:` lines | Valid (audit trail) — write allowed |
