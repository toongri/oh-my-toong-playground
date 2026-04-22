# Dedup Layer 2 Prompt

## 1. Purpose

L2 dedup 은 L1 URL/slug 매칭 통과 후 LLM 이 두 JD 본문이 **같은 포지션**인지 판정하는 단계다.

호출 시점:
- L1 매칭 실패 (다른 URL, 다른 slug) 이지만 TTL 초과로 재수집된 케이스
- URL 구조 변경 후 동일 JD 재수집 가능성이 있는 케이스
- simhash 대체 목적으로 본문 기반 의미론적 비교가 필요한 케이스

L1 통과(확실한 중복)는 L2 를 건너뛴다. L2 는 L1 이 결론 내리지 못한 케이스에만 호출한다.

---

## 2. Invocation Spec

| 항목 | 값 |
|---|---|
| Model | Claude Sonnet 또는 Opus (SKILL.md 버전 항목에서 지정) |
| Temperature | **0** (결정론적 — 동일 입력에 동일 출력) |
| Max tokens | **512** (reason 필드는 짧게) |
| 메시지 구조 | system 1개 + user 1개 (single-turn) |
| Stream | false |

메시지 구조 요약:
- `system`: 역할 정의 + JSON strict 출력 강제
- `user`: 두 JD 본문을 포함한 판정 요청 (변수 치환 후 전달)

---

## 3. Input Contract

스킬 코드는 LLM 을 호출하기 전에 아래 필드를 준비해야 한다.

| 변수 | 소스 | 처리 |
|---|---|---|
| `{A_company}` | frontmatter `company` | 원문 그대로 |
| `{A_role_title}` | frontmatter `role_title_verbatim` | 원문 그대로 |
| `{A_body}` | JD 파일 본문 (frontmatter 제외) | **5000자 초과 시 앞에서 5000자 truncate** |
| `{B_company}` | 비교 대상 frontmatter `company` | 원문 그대로 |
| `{B_role_title}` | 비교 대상 frontmatter `role_title_verbatim` | 원문 그대로 |
| `{B_body}` | 비교 대상 JD 파일 본문 | **5000자 초과 시 앞에서 5000자 truncate** |

truncate 시 본문 끝에 `[...본문 일부 생략]` 을 append 해서 LLM 에게 잘렸음을 알린다.

---

## 4. Pinned Prompt (v1)

> 이 섹션의 system/user 텍스트가 실제로 LLM 에 전달되는 pinned prompt 다.
> 변수(`{A_company}` 등)는 호출 직전에 치환한다.

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

LLM 은 아래 JSON 만 출력해야 한다. 다른 텍스트가 포함되면 파싱 실패로 처리한다.

```json
{"same": true, "reason": "두 JD 는 동일한 회사의 동일한 백엔드 팀 공고로, 본문 내용이 실질적으로 동일하다."}
```

```json
{"same": false, "reason": "같은 회사지만 A 는 플랫폼팀, B 는 결제팀 소속으로 주요 업무가 다르다."}
```

필드 명세:

| 필드 | 타입 | 설명 |
|---|---|---|
| `same` | boolean | `true` = 중복, `false` = 별도 포지션 |
| `reason` | string | 한국어 판정 근거, 1-2문장 |

---

## 6. Decision Rules (스킬 코드가 응답을 해석하는 방법)

### 정상 응답

| `same` 값 | 스킬 동작 |
|---|---|
| `true` | 신규 파일 생성 **금지**. 기존 파일의 `last_checked_at` 갱신. `fingerprint_check: duplicate_of:<url>` 기록. |
| `false` | 신규 파일 저장 진행. `fingerprint_check: unique` 기록. |

### 파싱 실패

1. **1회 자동 retry**: 동일 입력으로 LLM 재호출.
2. **retry 후에도 실패**: conservative fallback — 신규 파일을 `fingerprint_check: pending` 상태로 저장. dedup 을 skip 하고 유저가 수동 검토할 수 있도록 남긴다.

파싱 실패 판단 기준:
- 응답이 유효한 JSON 이 아님
- `same` 필드가 boolean 이 아님
- `reason` 필드 누락

---

## 7. Fixture Pair 1 — same: true

> 회사 블로그 공고와 잡포털 크로스포스팅. URL 달라 L1 통과했지만 본문 동일한 케이스.

| | JD A (블로그 원본) | JD B (잡포털) |
|---|---|---|
| 회사 | 당근마켓 | 당근마켓 |
| 직무명 | 백엔드 엔지니어 (플랫폼) | Backend Engineer (Platform) |
| 본문 요약 | 플랫폼팀 / gRPC 서비스 / Go·Kotlin 3년+ | 플랫폼팀 / gRPC 서비스 / Go·Kotlin 3년+ |

**기대 출력**:
```json
{"same": true, "reason": "두 JD 는 동일한 회사(당근마켓) 플랫폼팀의 동일 포지션으로, 직무명 표기만 다를 뿐 본문 내용이 실질적으로 동일하다."}
```

---

## 8. Fixture Pair 2 — same: false

> 같은 회사, 유사한 직무명이지만 팀과 주요 업무가 다른 케이스.

| | JD A | JD B |
|---|---|---|
| 회사 | 토스 | 토스 |
| 직무명 | 백엔드 엔지니어 (결제) | 백엔드 엔지니어 (인프라) |
| 팀 | 결제팀 — PG 연동·정산 배치 | 인프라팀 — 멀티클라우드·SRE |
| 자격 요건 | Kotlin / 금융 도메인 | Kubernetes / Terraform |

**기대 출력**:
```json
{"same": false, "reason": "같은 토스 소속이지만 A 는 결제팀(PG 연동·정산), B 는 인프라팀(클라우드·SRE)으로 팀과 주요 업무가 명확히 다르다."}
```

---

## 9. Versioning Note

이 파일은 `v1` 프롬프트다.

프롬프트 내용(system 또는 user 텍스트)을 변경할 때는:

1. 이 파일의 섹션 4 헤더를 `## 4. Pinned Prompt (v2)` 등으로 bump 한다.
2. `SKILL.md` 상단 버전 항목에 변경 이력을 기록한다 (예: `dedup-l2-prompt: v1 → v2, 이유`).
3. 이전 버전 프롬프트는 삭제하지 않고 하위 섹션으로 보존한다 (재현 가능성).

버전 불일치(스킬 코드가 참조하는 버전 vs 이 파일의 현재 버전)는 배포 전에 반드시 해소해야 한다.
