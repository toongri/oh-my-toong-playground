# JD Frontmatter Schema

## Overview

이 스키마는 `$OMT_DIR/collect-jd/jobs/<company_slug>/<role_title_slug>-<YYMMDD>.md` 경로의 모든 JD 파일 frontmatter에 적용된다.

파일명 예시: `$OMT_DIR/collect-jd/jobs/toss-bank/백엔드-엔지니어-260422.md`

---

## Required Fields

| Field | Type | Description |
|---|---|---|
| `version` | integer | 스키마 버전. 현재 `1`. state YAML 전용 — skill-source 파일에는 사용하지 않음 |
| `url` | string | `normalizeUrl()` 적용 후 저장한 정규화 URL |
| `company` | string | 회사명 원문 (예: `Toss Bank`) |
| `company_slug` | string | `slugify(company)` (예: `toss-bank`) |
| `role_title_verbatim` | string | JD 원문 제목 그대로 (예: `백엔드 엔지니어 (서버)`) |
| `role_title_slug` | string | `slugify(role_title_verbatim)` (예: `백엔드-엔지니어-서버`) |
| `role_tags` | array[string] | `$OMT_DIR/collect-jd/profile/taxonomy.yaml` enum 부분집합. 1개 이상 필수 |
| `status` | enum | `included \| excluded \| ambiguous \| pending` |
| `last_checked_at` | string | ISO8601 datetime (예: `2026-04-22T10:00:00+09:00`) |
| `fingerprint_check` | enum | `pending \| unique \| duplicate_of:<url>` |

---

## Conditional Fields

아래 필드는 `status` 값과 audit trail 상태에 따라 조건부 필수/허용된다.

| Field | 조건 | Description |
|---|---|---|
| `tags` | `status == excluded`일 때 필수 (≥1개) | 제외 사유 태그. `$OMT_DIR/collect-jd/tags.yaml` emergent 사전 참조. `status != excluded`에서는 빈 배열 또는 부재 (유효) |
| `reason_note` | `status == excluded`일 때 필수 (빈 문자열 금지). 그 외 status에서는 audit trail 목적으로 optional | `status == excluded`: 제외 사유 서술(유저 발화 원문 또는 auto-mismatch 시 `auto:mismatch:<sha>`). 그 외: `auto:<verdict>:<sha>` 또는 누적된 `prev: <status> @ <ISO date>` 라인들. reversal 시 최상단에 `prev: <prev status> @ <ISO date>` 라인 prepend |

---

## Optional Fields

| Field | Type | Description |
|---|---|---|
| `quote` | string | 이 JD에 대한 유저 발화 원문 (예: `"이거 별로야"`) |

---

## status Closed Enum

`status`는 다음 4개 값만 허용한다. 이 외의 값은 validation 위반이다.

| Value | 의미 |
|---|---|
| `included` | 매칭 — 수집 대상으로 확정 |
| `excluded` | 제외 확정 — `tags` + `reason_note` 필수 |
| `ambiguous` | 규칙으로 판정 불가 — 유저 응답 대기 중 |
| `pending` | 아직 평가되지 않은 상태 (dedup defer 또는 신규 ingest 직후) |

rules 재평가 또는 배치 재스캔이 **유저가 직접 편집한 status**를 덮어쓰지 않는다. 수동 편집 감지 시 해당 파일을 건너뛰고 배치 보고에 "manual skipped" 포함.

---

## Reversal Semantics

status를 반전할 때(예: `included` → `excluded`, `excluded` → `included`) `reason_note` 최상단에 아래 형식의 라인을 prepend한다.

형식: `prev: <이전 status> @ <ISO date>`

예시 1 — included → excluded:
```
prev: included @ 2026-04-22
이 회사는 서울 근무가 필수라 제외함.
```

예시 2 — excluded → included (재평가 후 번복):
```
prev: excluded @ 2026-03-10
prev: included @ 2026-02-15
최근 리모트 전환 확인 — 재포함.
```

반전이 반복될 때마다 새로운 `prev:` 라인이 상단에 누적된다. 기존 라인은 삭제하지 않는다.

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

## Validation Rules 요약

| Rule | 위반 시 동작 |
|---|---|
| `status: excluded`인데 `tags`가 빈 배열 | validation 실패 — 저장 거부 |
| `status: excluded`인데 `reason_note` 없음 | validation 실패 — 저장 거부 |
| `status` 값이 4개 enum 외 | validation 실패 — 저장 거부 |
| `role_tags`가 빈 배열 | validation 실패 — ingest 시 LLM 태깅 재시도 |
| `fingerprint_check: duplicate_of:<url>`인데 신규 파일 생성 | 생성 금지 — 기존 파일 `last_checked_at`만 갱신 |
| YAML 파싱 실패 | crash 금지 — `<file>.bak.<timestamp>` 백업 후 유저에게 복구 옵션 제안 |
| `status != excluded`이고 `reason_note`에 `auto:<verdict>:<sha>` 또는 `prev:` 라인 존재 | valid (audit trail) — 저장 허용 |
