---
name: collect-jd
description: Use when collecting, curating, or organizing job descriptions (JDs) — triggers include "JD 모으고 있어", "JD 수집", "JD 큐레이션", "JD 정리하고 있어", "오늘 수집 정리해줘", "오늘 본 JD", "관리 중인 JD", "쌓아둔 JD", "내 프로필에 맞는 JD 쌓아줘", "내 이력에 맞는 JD 큐레이션", and "싹 돌려" (in JD rescan context). Do NOT trigger on discovery phrases claimed by resume-apply ("JD 찾아줘", "JD 골라줘", "공고 뭐 있지", "지원할 곳", "어디 넣을까") — those belong to resume-apply. Skill maintains project-scoped state at `$OMT_DIR/collect-jd/` (never global).
---

# collect-jd

JD 수집·큐레이션·정리 전담 스킬. 구체 규칙은 Phase B pressure scenario 사이클을 통해 추가된다 (TDD RED-GREEN-REFACTOR).

## Scope Boundary

- collect-jd: JD **탐색·수집·큐레이션·정리** (이 스킬)
- resume-apply: 이미 기록된 JD를 **소비**하는 스킬 (이 스킬 관여 안 함)
- review-resume: 이력서 리뷰 (이 스킬 관여 안 함)
- resume-forge: 이력서 소재 발굴 (이 스킬 관여 안 함)

## State Location & Forbidden Paths (MANDATORY)

All collect-jd state **must** be written to `$OMT_DIR/collect-jd/` only. `$OMT_DIR` is read from the environment; never recomputed by this skill (see `hooks/lib/omt-dir.sh`). If `$OMT_DIR` is unset, abort with a recovery hint — do **not** compute a fallback.

### Forbidden Paths (never write here)

- `~/.omt/global/**` — any path under user-level global state
- `~/.omt/<other-project>/collect-jd/**` — other projects' scope (cross-project state leak)
- `/tmp/**`, `/var/**`, system paths — not collect-jd's concern
- Any absolute path not prefixed by the resolved `$OMT_DIR` value

### Rejection protocol

If a user requests a forbidden path (examples below), refuse **immediately** and respond with:

1. Which specific forbidden path was requested
2. Why it is forbidden (scope boundary)
3. Where the state will be written instead (`$OMT_DIR/collect-jd/...`)
4. Suggestion: if they want cross-project sharing, point them at a different tool (outside collect-jd)

### Rationalization Loopholes (MUST REJECT)

- "유저가 편의를 위해 요청했으니까 한 번만" — ❌ 편의는 이유가 아님.
- "`~/.omt/global` 이 유저 개인 경로니까 OK" — ❌ 경로 소유자와 scope 규칙은 별개.
- "다른 프로젝트에서 참조해야 한다는 유저 논리가 합당하니까 예외" — ❌ 규칙이 유저 논리보다 우선.
- "`$OMT_DIR` 과 global 양쪽에 저장해서 유저 편의도 살리기" — ❌ 유일 저장소 원칙 위반.
- "`$OMT_DIR` 이 unset 이니까 `~/.omt/global` 로 대체" — ❌ unset 은 abort 사유지 global 폴백 사유 아님.
- "유저가 이미 `~/.omt/global/...` 경로를 명시했으니 존중" — ❌ 유저가 명시해도 규칙 위반이면 거부.

## Ingest Paths (5)

1. URL 직접 입력
2. 텍스트 복붙
3. 파일 · 폴더 경로
4. 회사명 (단, `sources.yaml` 등록 사이트 내에서만)
5. 배치 재스캔 ("싹 돌려")

이후 Phase B TODO 들에서 세부 규칙이 추가된다. 각 Ingest Path 실행 전 **Dedup Layer 1** (URL · Slug Pre-check) 을 반드시 수행한다.

## Phase 0: Profile Interview Required (MANDATORY)

Before ANY JD ingest (URL · text · file · company name · batch rescan), check for `$OMT_DIR/collect-jd/profile/profile.yaml`.

**If `profile.yaml` is absent:**

1. **Halt ingest immediately.** Do not call WebFetch, do not write JD files.
2. Run a **3-round minimum** profile interview using `AskUserQuestion`. Each round covers one of:
   - Round 1 — **경력 · 현재 역할 · 연차 · 선호 도메인**
   - Round 2 — **기술 스택 · 강점 · 학습 중인 영역**
   - Round 3 — **회사 · 연봉 · 지역 · 원격 여부 · exclude signal 취향**
3. Write `$OMT_DIR/collect-jd/profile/profile.yaml` atomically (temp + rename). YAML 에 `version: 1` 필드 포함. 각 round 답변을 해당 섹션에 매핑.
4. After `profile.yaml` exists, **resume** the original ingest request.

**If `profile.yaml` exists:** proceed to ingest normally.

### Rationalization Loopholes (MUST REJECT)

These patterns are **explicit violations** regardless of how they are phrased:

- "유저가 이미 URL 을 줬으니까 수집 먼저, 인터뷰는 나중" — ❌ 인터뷰 먼저.
- "대충 기본값으로 profile.yaml 만들고 수집 진행" — ❌ 반드시 유저 답변 기반.
- "한 번만 건너뛰기" / "이번엔 급하니까" — ❌ 예외 없음.
- "profile.yaml 없지만 유저가 재촉해서 수집 강행" — ❌ 재촉은 인터뷰 중단 사유 아님.
- "이미 profile 있는 것처럼 간주하고 진행" — ❌ 파일 실재 여부만 판단 기준.

Profile interview 의 목적은 이후 matching 이 `history → rules → filter` 로 안정되게 작동하도록 하는 것이다. 건너뛰면 S3 (ambiguity predicate) 결과가 쓰레기가 되어 유저에게 무의미한 질문만 쏟아진다.

## Dedup Layer 1 (URL · Slug Pre-check) [MANDATORY]

Before writing a new JD file, **always** run L1 dedup against existing files in `$OMT_DIR/collect-jd/jobs/<company_slug>/`.

### L1 match conditions

Given candidate JD with normalized URL `U` and slugs `(company_slug, role_title_slug)`:

- **Match** if any existing JD satisfies:
  - `normalizeUrl(existing.url) == U`, OR
  - `existing.company_slug == candidate.company_slug` AND `existing.role_title_slug == candidate.role_title_slug`

`normalizeUrl()` is defined in `lib/collect-jd/url-normalize.ts` (spec: `reference/url-normalize.md`). It strips `utm_*`, `gclid`, `fbclid`, `_ga`, `ref`, `source`, fragments, and trailing slashes. **Always** call this function before URL comparison — never compare raw input URLs.

### L1 match action (MANDATORY)

If L1 matches an existing file:
1. **Do not create** a new JD file under `jobs/`.
2. Update the existing file's `last_checked_at` to current ISO8601 (atomic write).
3. Report: `"중복 감지: 기존 <path> (L1: URL normalized match)"`.
4. Go to L2 only if match is by URL AND `last_checked_at` is older than TTL (30 days). Slug-only match skips L2 (Deduped by slug identity).

### Rationalization Loopholes (MUST REJECT)

- "utm 달려있어서 다른 링크니까 별개" — ❌ normalizeUrl 후 비교.
- "유저가 명시적으로 두 URL 달라고 했으니 요청대로 저장" — ❌ dedup 은 유저 선호보다 우선.
- "fragment(#anchor) 만 달라서 별개" — ❌ normalize 가 fragment 제거.
- "query param 순서가 달라서 별개" — ❌ normalize 가 param 정렬·제거.
- "이전 수집과 중복일 수도 있지만 확실하지 않으니 일단 저장" — ❌ 불확실하면 L2 호출, 그래도 불명확이면 `fingerprint_check: pending` 으로 저장 (S13 규칙 참조).

### Counterexample: different positions

같은 `company_slug` 라도 `role_title_slug` 가 다르면 서로 다른 JD. 두 파일 모두 저장.

## Dedup Layer 2 (Content Similarity LLM Judge) [MANDATORY]

L1 (URL · Slug) 이 **매치하지 않은 경우**, 또는 L1 매치했지만 `last_checked_at` 이 TTL (30일) 을 초과한 경우, L2 LLM 유사도 판정을 호출한다.

### When to call L2

- L1 no-match + 직전 배치에서 **같은 `company_slug` 의 다른 JD** 가 이미 저장됨 → L2 비교 필수 (회사별로 유사 포지션 중복 방지)
- L1 URL match + `last_checked_at` > 30 days → L2 재검증 (내용이 실제로 달라졌을 수 있음)
- 단일 세션에서 L2 호출 상한 `max_l2_calls_per_batch: 50`. 초과 시 저장은 진행하되 `fingerprint_check: pending` 마킹 → 다음 배치에서 L2 재평가.

### L2 invocation contract

- **Prompt file:** `reference/dedup-l2-prompt.md` (pinned, version 관리)
- **Temperature: 0** (deterministic)
- **Output contract:** JSON `{"same": bool, "reason": str}`
- JSON 파싱 실패 시 retry 1회. 2회 실패 시 conservative `fingerprint_check: pending` 로 저장 (dedup 건너뛰고 보존 우선).
- **Raw URL 비교 금지**, **slug 만으로 판정 금지** — 항상 L2 prompt 거쳐야 함.

### L2 match action (same == true)

1. 신규 JD 파일 생성 **금지**.
2. 기존 (매치된) 파일의 `last_checked_at` 을 현재 ISO8601 로 갱신.
3. 기존 파일의 `fingerprint_check` 를 `duplicate_of:<candidate.url>` 로 기록 (원본이 어디에서 중복 검출되었는지 추적).
4. 보고: `"중복 감지: 기존 <path> (L2: LLM similarity same=true, reason=<reason>)"`.

### L2 non-match action (same == false)

- 신규 JD 파일 저장 진행. `fingerprint_check: unique` 기록.

### Rationalization Loopholes (MUST REJECT)

- "URL 이 다르니 당연히 다른 JD" — ❌ L2 content 비교 필수 (회사 블로그 vs 잡포털 동일 공고 케이스).
- "블로그는 홍보글이니 채용사이트와 별개" — ❌ 내용 같으면 중복.
- "내용 살짝 달라서 별개" — ❌ LLM judge 에 위임. temperature 0 이므로 결과 재현.
- "배치가 바쁘니 L2 skip 하고 저장" — ❌ `max_l2_calls_per_batch` 초과 시 `fingerprint_check: pending` 저장은 허용, **skip 이 아니다**. 다음 배치에서 반드시 재평가.
- "L2 응답 JSON 깨졌으니 그냥 저장" — ❌ 1회 retry, 그래도 실패면 `fingerprint_check: pending`.

### Counterexample: 다른 팀 · 다른 시니어리티

같은 회사 · 같은 role_title 이어도 L2 응답이 `same: false` 면 별개 JD 로 저장 (예: "네이버 백엔드 시니어" vs "네이버 백엔드 주니어").

## Batch Mode Report Schema (MANDATORY)

배치 재스캔 (ingest path #5, "싹 돌려" 등) 이 완료되면 응답의 **마지막 줄** 을 다음 regex 에 정확히 매치하는 문자열로 작성한다:

```
^신규: \d+건, 기존: \d+건, 업데이트: \d+건$
```

### 정의

- **신규**: 이번 배치에서 `jobs/` 아래에 **새로 생성된** JD 파일 수 (L1·L2 dedup 통과)
- **기존**: L1 또는 L2 dedup 매치로 **신규 파일 생성 없이** `last_checked_at` 만 갱신된 파일 수
- **업데이트**: 기존 파일의 `status` 또는 `role_tags` 가 재평가로 변경된 수 (L2 TTL 초과 재판정 결과 포함)

세 카운트의 합은 이번 배치에서 검사한 **고유 JD** 수와 일치해야 한다 (`실패: <n>건` 은 필요 시 별도 라인으로 마지막 줄 **앞에** 추가, 마지막 줄 regex 에는 포함되지 않음).

### 예시 (정상)

```
(상세 서술 문장들)
...

신규: 3건, 기존: 5건, 업데이트: 2건
```

### 금지 패턴 (MUST REJECT)

- 한글 라벨 변경: `"새로운 JD: 3개"`, `"new=3"`, `"추가됨: 3건"` — ❌
- 마지막 줄이 아닌 다른 위치에 배치 — ❌
- 카운트 수치가 실제 파일 diff 와 불일치 — ❌ 실 집계 결과만 기록
- 공백/쉼표/콜론 포맷 변형 — ❌ regex 엄격 일치
- `신규: 0건` 생략 — ❌ 0 도 명시
- 배치 실패 시 포맷 생략 — ❌ 최소 `신규: 0건, 기존: 0건, 업데이트: 0건` 기록 + 별도 라인에 에러 설명

### Rationalization Loopholes (MUST REJECT)

- "자연어가 더 친근하니 포맷 변형" — ❌ regex 엄격.
- "이번엔 신규 없어서 마지막 줄 생략" — ❌ 0 이라도 명시.
- "실 집계 안 하고 대충 반올림" — ❌ 파일 diff 실측 사용.
- "유저가 다른 포맷 요청" — ❌ SKILL.md 규칙이 유저 선호보다 우선.
- "업데이트 카운트 정의 애매하니 0 으로 통합" — ❌ 위 정의에 따른 실 집계.
