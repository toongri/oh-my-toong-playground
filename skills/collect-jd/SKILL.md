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

## State Location

All state under `$OMT_DIR/collect-jd/` only. `$OMT_DIR` 은 환경에서 읽음; 이 스킬이 직접 계산 금지. `$OMT_DIR` unset 시 abort + 복구 안내 — global fallback 금지. Forbidden Paths: `~/.omt/global/**`, `~/.omt/<other-project>/collect-jd/**`, `/tmp/**`, 그 외 `$OMT_DIR` 외부 절대 경로.

→ 상세 (rejection protocol, rationalization loopholes): [reference/rules.md#state-location--forbidden-paths](reference/rules.md#state-location--forbidden-paths)

## Session Lock (MANDATORY)

스킬 트리거 시점 (Phase 0 진입 전 최우선) 에 `$OMT_DIR/collect-jd/.lock` 을 획득한다. `.lock` 이 없으면 현재 PID 로 atomic write. `.lock` 이 있으면 `kill -0 <pid>` 로 live 여부 확인 — live 이면 abort (stderr + exit non-zero), stale 이면 현재 PID 로 overwrite 후 진행. **lock 은 세션 전체 동안 유지**: AskUserQuestion 대기 중 · 파일 편집 · LLM 호출 · 배치 재스캔 모든 단계. 정상 종료 시 PID 일치 확인 후 삭제.

- lock acquire 없이 스킬 진입 금지.
- `kill -0` 없이 PID 파일 존재만 확인하는 구현 금지 (PID 재활용 위험).
- AskUserQuestion 대기 중 lock release/re-acquire 금지.

→ 상세 [reference/rules.md#session-lock](reference/rules.md#session-lock)

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

## Phase 0: Profile Interview Required (MANDATORY)

`$OMT_DIR/collect-jd/profile/profile.yaml` 부재 시 JD 수집 전에 **3-round 이상** profile 인터뷰 필수 (`AskUserQuestion`). Round 1: 경력·연차·선호 도메인. Round 2: 기술 스택·강점. Round 3: 회사·연봉·지역·원격·exclude 취향. 인터뷰 후 `profile.yaml` atomic write (`version: 1` 필드 포함). Profile 존재 시 정상 수집. **rationalization 차단 (5종)** — 재촉·급함·URL 수령 어느 것도 인터뷰 생략 사유 아님.

→ 상세 (rationalization loopholes, 목적 설명): [reference/rules.md#phase-0-profile-interview-required](reference/rules.md#phase-0-profile-interview-required)

## Dedup (L1 URL/slug + L2 LLM similarity)

신규 JD 파일 작성 전 L1 → L2 순서로 dedup 실행 (MANDATORY).

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
