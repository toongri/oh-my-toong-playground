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

## MANDATORY: Phase Task Creation

Skill invocation 시작 시(Session Lock 획득 직전) 아래 8개 phase 를 **개별 task로 전부 선행 생성**. 각 task 는 start 시 `in_progress`, 완료 시 즉시 `completed` 마킹. Phase skipping · silent skip 방지 목적.

**Phase 리스트 (세션 단위)**:

| # | Phase | 주요 gate / 산출물 |
|---|---|---|
| 1 | Session Setup | Session Lock acquire, Storage Backend Interview, Sources Registration(비어있으면 단일 제안), Profile Interview (부재 시) |
| 2 | Sources Load + Pagination | sources.yaml 로드 + source iterate + Listing Pagination (Tier A/B) |
| 3 | per-JD Ingest | 개별 JD URL fetch + Ingest Validation (insane-search fallback 포함) |
| 4 | Dedup Check Gate | L1 gate 실행 + L2 gate 평가 + fingerprint_check + dedup-audit.log append |
| 5 | Classify | Role tagging + Matching Loop (Phase 1→2→3) |
| 6 | Persist | JD atomic write + taxonomy/tags 업데이트 + `crawl_state` 업데이트 |
| 7 | Source HWM Update | source-level crawl_state 갱신 + sources.yaml atomic write |
| 8 | Session End | Rules Re-evaluation (해당 시) + lock release + summary 보고 |

**Batch mode**: Phase 2-7 을 source/JD 건별로 반복. Phase 1/8 은 세션 단위 (1회).

각 Phase 완료 시 응답 내 `[Phase N/8: <이름> ✓]` 마커로 명시. 누락 시 violation.

→ 상세 (rationalization loopholes, batch mode 반복 규칙): [reference/rules.md#phase-task-creation](reference/rules.md#phase-task-creation)

## State Location

All state under `$OMT_DIR/collect-jd/` only. `$OMT_DIR` 은 환경에서 읽음; 이 스킬이 직접 계산 금지. `$OMT_DIR` unset 시 abort + 복구 안내 — global fallback 금지. Forbidden Paths: `~/.omt/global/**`, `~/.omt/<other-project>/collect-jd/**`, `/tmp/**`, 그 외 `$OMT_DIR` 외부 절대 경로.

→ 상세 (rejection protocol, rationalization loopholes): [reference/rules.md#state-location--forbidden-paths](reference/rules.md#state-location--forbidden-paths)

## Session Lock (MANDATORY)

스킬 트리거 시점 (Phase 0 진입 전 최우선) 에 `$OMT_DIR/collect-jd/.lock` 을 획득한다. `.lock` 이 없으면 현재 PID 로 atomic write. `.lock` 이 있으면 `kill -0 <pid>` 로 live 여부 확인 — live 이면 abort (stderr + exit non-zero), stale 이면 현재 PID 로 overwrite 후 진행. **lock 은 세션 전체 동안 유지**: AskUserQuestion 대기 중 · 파일 편집 · LLM 호출 · 배치 재스캔 모든 단계. 정상 종료 시 PID 일치 확인 후 삭제.

- lock acquire 없이 스킬 진입 금지.
- `kill -0` 없이 PID 파일 존재만 확인하는 구현 금지 (PID 재활용 위험).
- AskUserQuestion 대기 중 lock release/re-acquire 금지.

→ 상세 [reference/rules.md#session-lock](reference/rules.md#session-lock)

## Storage Backend Interview (MANDATORY)

첫 실행 시 `$OMT_DIR/collect-jd/config.yaml` 부재/모호 확인 → **AskUserQuestion 필수**. Config schema 는 `platform` + `how` 자유서술 2필드. `platform` 값 예시: `filesystem` | `notion` | `google_drive` | `gist` | 사용자 정의 MCP 명. `how` 는 "어디에·어떻게 저장하는지" 자유서술 (Notion page ID, 테이블명, 템플릿 파일 경로 등 포함 가능).

유저 수락/변경 후 `config.yaml` atomic write (`platform`/`how`/`storage_path`(platform=filesystem일 때)). 이후 세션은 `config.yaml` 읽어 바로 사용.

**CRITICAL**: config.yaml 부재/모호인데 default platform=filesystem 으로 silent 저장 금지. "첫 실행인데 default" rationalization 불가.

- Session lock 직후, Phase 0 Profile Interview 진입 전 필수.
- `platform: filesystem` → `storage_path` 필수 ($OMT_DIR 하위).
- `platform: notion | google_drive | ...` → `how` 필드에 대상 페이지/폴더/sheet ID + 템플릿 + MCP 호출 절차 자유서술.
- 경로/백엔드 변경 요청 시 atomic overwrite. 기존 데이터 이관은 유저 명시 승인 시만.

→ 상세 (flowchart, rationalization loopholes, config.yaml schema): [reference/rules.md#storage-backend-interview](reference/rules.md#storage-backend-interview)

## Atomic Write Pattern (MANDATORY)

모든 state 파일 write 는 `writeAtomic(path, content)` 패턴 사용. Step: (1) `<path>.tmp` 에 content write → (2) fsync (권장) → (3) `rename(<path>.tmp, <path>)` (POSIX atomic). temp 경로는 반드시 대상 파일과 동일 디렉토리 (cross-filesystem rename 방지).

- `open(path, 'w')` 직접 write 금지 — SIGKILL·디스크 full 시 파일 truncated.
- `/tmp/xxx` 같은 별도 디렉토리 temp 경로 금지.
- 적용 의무: 신규 JD 저장 · `last_checked_at` 갱신 · status reversal · fingerprint 갱신 · `rules.yaml.proposed` 생성 · `rules.yaml` approve overwrite · session lock `.lock` write 전부.

→ 상세 [reference/rules.md#atomic-write-pattern](reference/rules.md#atomic-write-pattern)

## Ingest Paths (5)

1. URL 직접 입력
2. 텍스트 복붙
3. 파일 · 폴더 경로
4. 회사명 (단, `sources.yaml` 등록 사이트 내에서만)
5. 배치 재스캔 ("싹 돌려")

각 Ingest Path 실행 전 **Phase 0 profile 인터뷰 + Dedup L1/L2** 를 반드시 수행.

## Sources Registration (MANDATORY)

세션 시작 시 `$OMT_DIR/collect-jd/sources.yaml` 로드. 비어있거나 없으면 **단일 AskUserQuestion** 으로 "등록할 JD 소스 사이트가 있나요?" 제안 (skip 가능 — Profile Interview 만큼 강압적 아님). 유저 URL 제공 시 `{slug, name, careers_url, added_at, pagination, crawl_state}` 구조로 atomic append.

**반복 긁기 (Reusable Crawl)**: 유저 발화 중 `"오늘 돌려"` / `"싹 돌려"` / `"전체 재크롤"` / `"sources 돌려"` 등 트리거 phrase 감지 → **등록된 모든 source iterate** → 각 source 에서 Listing Pagination 수행 → per-JD fetch + Dedup Gate + Classify + Persist. HWM 기준으로 신규만 수집. 자동 스케줄링 없음.

**CRITICAL**: sources.yaml 비었는데 open-web 자유 크롤 금지. 유저 "싹 돌려" 발화에도 source 0건이면 "등록된 소스가 없어요" 보고 + 등록 유도.

→ 상세: [reference/rules.md#sources-registration](reference/rules.md#sources-registration)

## Listing Pagination (MANDATORY, 2-tier)

Source 의 listing 페이지에서 **전체 JD 리스트를 끝까지 확인** 의무. 2-tier 접근:

- **Tier A (Auto-detect)**: 다음 패턴 자동 시도 — query `?page=` / `?offset=` / `?after=<cursor>` / "다음"·"next" 버튼 link / infinite scroll XHR endpoint (Playwright network 감시). 성공 시 `sources.yaml.<source>.pagination = { method: auto, detected_pattern: <...> }` 기록.
- **Tier B (Interview fallback)**: Tier A 실패 시 **AskUserQuestion 필수** — "이 사이트 전체 list 를 어떻게 가져오나요? (API URL / 전용 MCP / 스크립트 / 수동 복붙)". 유저 응답을 `sources.yaml.<source>.pagination.how` 에 자유서술 저장 (실행 스크립트 경로, API 예시, MCP 호출 절차 등 모두 허용). 다음 세션부터 `how` 재사용.

**CRITICAL**: 자동 실패 시 first-page 만 저장하고 끝내는 behavior 금지. 반드시 Tier B interview 로 escalate.

→ 상세 (Tier A heuristics list, Tier B interview template, loopholes): [reference/rules.md#listing-pagination](reference/rules.md#listing-pagination)

## Crawl-State HWM Ledger (MANDATORY)

각 source 재크롤 시 "어디부터 어디까지 이미 확인했는지" 복합 ledger 를 `sources.yaml.<source>.crawl_state` 에 유지.

Schema:
```yaml
crawl_state:
  marker_type: id | url | page_number | timestamp | custom
  last_seen_marker: <value>   # 가장 마지막 확인한 marker
  range_covered:
    - from: <marker>
      to: <marker>
      run_at: <ISO8601>
      collected_count: <int>
      total_listed: <int or null>
  crawl_history:
    - run_at: <ISO8601>
      method: auto | interview_script | mcp:<name>
      new_jds: <int>
      already_seen: <int>
      pages_fetched: <int>
```

**재크롤 규칙**: 다음 run 시 `last_seen_marker` 초과 항목만 신규 후보. 단 추천순 같은 동적 정렬 site 는 전체 fetch + URL seen-set 교차 체크로 dedup 보완. `marker_type == custom` 이면 `how` 필드의 자유서술 로직 실행.

**CRITICAL**: HWM 미기록 crawl 금지. `crawl_state.last_seen_marker` 부재 상태로 저장 완료 선언 금지.

→ 상세 (marker_type 선택 규칙, dynamic listing handling, loopholes): [reference/rules.md#crawl-state-hwm-ledger](reference/rules.md#crawl-state-hwm-ledger)

## Phase 0: Profile Interview Required (MANDATORY)

`$OMT_DIR/collect-jd/profile/profile.yaml` 부재 시 JD 수집 전에 **3-round 이상** profile 인터뷰 필수 (`AskUserQuestion`). Round 1: 경력·연차·선호 도메인. Round 2: 기술 스택·강점. Round 3: 회사·연봉·지역·원격·exclude 취향. 인터뷰 후 `profile.yaml` atomic write (`version: 1` 필드 포함). Profile 존재 시 정상 수집. **rationalization 차단 (5종)** — 재촉·급함·URL 수령 어느 것도 인터뷰 생략 사유 아님.

→ 상세 (rationalization loopholes, 목적 설명): [reference/rules.md#phase-0-profile-interview-required](reference/rules.md#phase-0-profile-interview-required)

## Dedup (L1 URL/slug + L2 LLM similarity)

신규 JD 파일 작성 전 L1 → L2 순서로 dedup 실행 (MANDATORY).

**CRITICAL — Dedup Check Gate 규칙**:
- `jobs/` 비어있어도 L1 gate는 **반드시 실행** 된 것으로 기록. "jobs empty라서 skip" 금지 — trivial-pass를 silent로 처리하지 않고 "L1 gate executed: 0 candidates" 로 명시.
- L2 조건 미성립(같은 company_slug JD 0건) 시에도 "L2 gate evaluated: not applicable" 로 audit 남김.
- Dedup gate 미실행 저장 금지. `fingerprint_check` 필드가 비어있으면 저장 거부.

→ Dedup Gate Enforcement 상세: [reference/rules.md#dedup-check-gate-enforcement](reference/rules.md#dedup-check-gate-enforcement)

- **L1**: `normalizeUrl()` 후 URL 또는 `(company_slug, role_title_slug)` 매칭. 매치 시 신규 파일 금지, `last_checked_at` 만 갱신. URL match + TTL (30일) 초과 시 L2 진입.
- **L2**: L1 no-match + 같은 `company_slug` 의 다른 JD 이미 저장 시 LLM similarity 판정 (`reference/dedup-l2-prompt.md`, temperature 0). `same: true` → 신규 금지 + `fingerprint_check: duplicate_of:<url>`. `same: false` → 신규 저장 + `fingerprint_check: unique`.
- `max_l2_calls_per_batch: 50`. 초과 시 `fingerprint_check: pending` — skip 아님, 다음 배치 재평가.

→ L1 상세 (loopholes, counterexample): [reference/rules.md#dedup-layer-1](reference/rules.md#dedup-layer-1)
→ L2 상세 (invocation contract, loopholes, counterexample): [reference/rules.md#dedup-layer-2](reference/rules.md#dedup-layer-2)
→ 흐름도 (L1→L2 decision tree): [reference/rules.md#decision-flow](reference/rules.md#decision-flow)

## Matching Loop (history → rules → filter) (MANDATORY)

각 JD 저장 전 `profile/rules.yaml` 대조 3-phase 판정.

- **Phase 1**: 기존 `jobs/**/*.md` 에 동일 URL/slug pair → status 승계. 없으면 Phase 2.
- **Phase 2**: `reference/ambiguity-prompt.md` pinned prompt, temperature 0. `match` → `status: included` (자동). `mismatch` → `status: excluded` (자동, Exclude Flow 규칙 적용). **`ambiguous` → 자동 판정 금지, 반드시 Phase 3.**
- **Phase 3**: `AskUserQuestion` — `missing_signals` 기반 한국어 질문. 옵션: include / exclude / defer. **Batch mode 에서도 즉시 호출**, 대기 금지.
- Auto-decision audit trail: 자동 저장 시 `reason_note` 에 `auto:<verdict>:<rules.yaml sha256 short 8>`.

→ 상세 (rationalization loopholes, counterexample): [reference/rules.md#matching-loop](reference/rules.md#matching-loop)
→ 흐름도 (Phase 1→2→3 decision tree): [reference/rules.md#decision-flow](reference/rules.md#decision-flow)

## Exclude Flow (tags + reason_note MANDATORY)

`status: excluded` 저장 시 **동시에** 필요: `tags: [...]` (최소 1개, `tags.yaml` emergent slug) + `reason_note` (유저 발화 원문, 빈 문자열 금지). 누락 시 저장 전 Emergent tag interview 발동: (1) reason 수집 (2) tag 유도 (top-3 후보 또는 신규 slug) (3) `tags.yaml` 업데이트 (4) atomic write. `included` / `ambiguous` / `pending` 에는 이 플로우 적용 안 됨.

→ 상세 (emergent tag interview, tags.yaml schema, loopholes, counterexample): [reference/rules.md#exclude-flow](reference/rules.md#exclude-flow)

## Reversal (상태 전환 기록) (MANDATORY)

기존 파일 `status` 변경 시 `reason_note` **최상단에** `prev: <prev_status> @ <ISO8601 date>` prepend. atomic write (`.tmp` → rename). 다중 전환 누적 (prepend 반복, 가장 위 = 가장 최근). Rules 재평가 시 `(rules_reeval:<sha short 8>)` 접미. 예외 아님: 첫 저장 · L1 `last_checked_at` 갱신 · L2 `fingerprint_check` 갱신.

→ 상세 (rationalization loopholes): [reference/rules.md#reversal](reference/rules.md#reversal)

## Manual Edit Safety

배치 재스캔은 유저가 수동으로 frontmatter 를 편집한 파일을 **절대 덮어쓰지 않는다**. 감지 신호 (last_checked_at 미래 · canonical 계약 위반 [비표준 필드 OR enum 외 값]) 하나라도 매치 시 해당 파일 skip + 보고에 `수동 편집 감지: N건` 라인 추가.

→ 상세: [reference/rules.md#manual-edit-safety](reference/rules.md#manual-edit-safety)

## Ingest Validation

WebFetch · 파일 · 텍스트 ingest 전에 본문 길이 (< 200자) · 정지 신호만 포함 (login/captcha/403 등) 체크. 실패 시 저장 금지 + "유효 JD 아닌 것으로 보임" 에러 보고 + `$OMT_DIR/collect-jd/ingest-failures.log` 기록.

**WebFetch 시 `insane-search` 스킬 사용.**

→ 상세: [reference/rules.md#ingest-validation](reference/rules.md#ingest-validation)

## Batch Mode Report Schema (MANDATORY)

배치 재스캔 완료 시 응답 **마지막 줄** 이 정확히 아래 regex 매치:

```
^신규: \d+건, 기존: \d+건, 업데이트: \d+건$
```

0 생략 금지. 포맷 변형 금지. 실 집계 결과만 기록.

→ 상세 (정의, 예시, 금지 패턴, loopholes): [reference/rules.md#batch-mode-report-schema](reference/rules.md#batch-mode-report-schema)

## Role Tagging (MANDATORY)

JD 저장 시 두 필드 필수: `role_title_verbatim` (원문 제목 그대로, 수정 금지) + `role_tags: [...]` (LLM 호출, taxonomy.yaml enum 부분집합, temperature 0). 한국어 synonym (`백엔드`/`서버개발자`/`서버사이드`) 반드시 `backend` 포함. JSON 파싱 실패 시 1회 retry, 2회 실패 시 에러 보고 (빈 배열 저장 금지).

→ 상세 (taxonomy baseline, LLM invocation contract, pinned prompt, loopholes, counterexample): [reference/rules.md#role-tagging](reference/rules.md#role-tagging)

## YAML Robustness

모든 state YAML (profile/taxonomy/rules/tags/sources/config) 파싱 실패 시 crash 금지. 원본을 `<file>.bak.<ISO8601>` 로 1회 복사 → `AskUserQuestion` 2 옵션 (edit manually [기본] / reset to default [데이터 손실 경고]). 유저 자료 자동 삭제·정리 금지.

→ 상세: [reference/rules.md#yaml-robustness](reference/rules.md#yaml-robustness)

## Company-Name Ingest

Ingest path #4 (회사명만 제공) 은 `sources.yaml` 등록 사이트 내에서만 동작. 미등록 회사 → **WebFetch/open-web search 절대 금지**, `AskUserQuestion` 으로 "공식 채용 페이지 URL 을 알려주세요" 발동. 유저 URL 제공 시 `sources.yaml` append 후 정식 flow. blacklist 지원.

→ 상세: [reference/rules.md#company-name-ingest](reference/rules.md#company-name-ingest)

## Rules Re-evaluation

오늘자 수집 결과를 기반으로 `rules.yaml` 을 재도출한다. 트리거: "오늘 수집 정리해줘" / "오늘 본 JD로 규칙 업데이트" / "규칙 재평가" / "rules 다시 뽑아줘" / 세션 내 include·exclude 1건 이상 시 자동 제안. **scope**: `last_checked_at` 의 date 가 오늘인 JD 파일만 (manual-edited 제외). **workflow**: (1) scope 로드 + `rules.yaml.sha256.before` 메모리 보관 (2) LLM call (temperature 0) → proposed rules 생성 (3) `rules.yaml.proposed` atomic write (`.tmp` → rename, `version:1` + `_proposed_at` + `_based_on` 포함) (4) diff 표시 + AskUserQuestion (`approve` / `reject` / `edit manually`) (5) approve 시 **race check 필수**: `rules.yaml` sha256 재계산 → `before` 와 불일치 시 abort (6) race OK → `rules.yaml` overwrite (atomic write, `_proposed_at`/`_based_on` 제외) + `.proposed` 제거. 오늘자 JD 0건이면 즉시 중단. approve 없이 `rules.yaml` 직접 덮어쓰기 금지.

→ 상세: [reference/rules.md#rules-re-evaluation](reference/rules.md#rules-re-evaluation)

## Reference Index

- [reference/rules.md](reference/rules.md) — 모든 규칙 상세 · loopholes · 예시 (Phase B TDD 결과 총집, M3 분리)
- [reference/frontmatter-schema.md](reference/frontmatter-schema.md) — JD 파일 YAML frontmatter 계약
- [reference/slugify.md](reference/slugify.md) — slug 정규화 알고리즘 spec
- [reference/url-normalize.md](reference/url-normalize.md) — URL 정규화 spec
- [reference/dedup-l2-prompt.md](reference/dedup-l2-prompt.md) — L2 LLM similarity pinned prompt
- [reference/ambiguity-prompt.md](reference/ambiguity-prompt.md) — matching ambiguity pinned prompt

## Tests

- `skills/collect-jd/tests/pressure-scenarios.md` — 13 pressure scenarios (Phase B TDD evidence stubs)
- `skills/collect-jd/evals/trigger-eval.json` — trigger eval spec (flat shape)
