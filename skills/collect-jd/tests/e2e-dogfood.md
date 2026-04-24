# End-to-End Dogfood

- **Date**: 2026-04-22
- **Task**: Phase C-25 (collect-jd-skill-tdd plan 최종)
- **Method**: analytical_simulation (시나리오 서술) + **실 CLI 실행 결과** (make validate / make test / make sync-dry)
- **Artifact SHAs**:
  - SKILL.md: `41c546fcd48257f32a5b04e16a75290b908da3027a067b29195ae0681df51b22`
  - rules.md: `303457806409263345739f7bd8e9697be58ede84325a6f5f582938a0b63add15`
  - evals/trigger-eval.json: `22aa2d0d5c576194aeb844f079db1f9ec19ab0907d5186263b5a3eed1609cb08`
  - pressure-scenarios.md: `372d7ffe68ce5b81d3dd6a47719975df6ac67006e2163926c81329258541e925`

## E2E Scenario (analytical)

Fresh Claude Code 세션에서 유저가 `collect-jd` skill 을 처음 사용하는 end-to-end flow:

### 1. Skill trigger

유저 발화: `"JD 모으고 있어 — 한번 정리 도와줘"`.

Claude Code runtime 이 SKILL.md frontmatter description 을 매치 → `collect-jd` invoked. trigger-eval.json positive entries 와 일치.

### 2. Phase 0: Profile Interview

`$OMT_DIR/collect-jd/profile/profile.yaml` 부재 → skill 이 SKILL.md "Phase 0" 규칙 따라 인터뷰 발동.

AskUserQuestion 3 라운드:
- Round 1: 경력 · 현재 역할 · 연차
- Round 2: 기술 스택 · 강점
- Round 3: 회사 · 연봉 · 지역 · 원격 여부

응답 수집 후 `profile.yaml` atomic write (version: 1).

### 3. Ingest (URL 입력)

유저: `"https://wanted.co.kr/wd/12345 이거 하나 추가해줘"`.

- normalizeUrl → `https://wanted.co.kr/wd/12345`
- L1 dedup check: `jobs/` 비어있음 → match 없음
- L2 dedup skip (L1 no-match + 다른 company 없음)
- WebFetch (Ingest Validation 통과: body > 200자 + JD 문구 존재)
- Role Tagging LLM call → `role_tags: [backend]` (temperature 0)
- Matching Loop: Phase 1 history empty → Phase 2 ambiguity-prompt → verdict: `match` → auto include
- Save: `jobs/wanted/<role_slug>-240422.md` with `status: included`, `reason_note: "auto:match:<sha>"`, `last_checked_at: <ISO>`

### 4. Additional JD with ambiguous verdict

유저: `"https://toss.im/career/abc-123"`.

- L1 dedup check → no match
- Ingest Validation 통과
- Role Tagging → `role_tags: [backend, platform]`
- Matching Loop Phase 2 → verdict: `ambiguous` (missing_signals: ["remote_policy"])
- Phase 3: AskUserQuestion ("원격 근무 정책 확인? include/exclude/defer") → 유저 defer
- Save: `status: ambiguous`, `reason_note: "deferred due to remote_policy"`

### 5. Rules re-evaluation trigger

유저: `"오늘 수집 정리해줘"`.

- Today's JDs (2 files) 로드 + profile + current rules.yaml 을 LLM 에 전달
- `rules.yaml.proposed` 생성
- diff 표시 + AskUserQuestion "approve/reject/edit"
- 유저 approve → `rules.yaml` 갱신 + `.proposed` 제거

### 6. Session end

summary 보고.

---

## 실 CLI 실행 결과

### `make validate`

```
[SCHEMA] 스키마 검증 통과
[COMPONENT] 컴포넌트 검증 통과
```

Exit code: `0`.

### `make test`

```
[TEST] 테스트 실행 시작

[TEST] Shell 테스트 검색 중...
[TEST] 실행: hooks/keyword-detector_test.sh
[TEST]   통과: hooks/keyword-detector_test.sh
[TEST] 실행: hooks/lib/logging_test.sh
[TEST]   통과: hooks/lib/logging_test.sh
[TEST] 실행: hooks/resume-forge-start_test.sh
[TEST]   통과: hooks/resume-forge-start_test.sh
[TEST] 실행: hooks/session-start_test.sh
[TEST]   통과: hooks/session-start_test.sh
[TEST] 실행: hooks/stop-notify_test.sh
[TEST]   통과: hooks/stop-notify_test.sh

[TEST] Bun 테스트 실행 중...
[TEST]   Bun 테스트 통과
    |
    |  1254 pass
    |  0 fail
    |  2077 expect() calls
    | Ran 1254 tests across 44 files. [16.01s]

==========================================
[TEST] 테스트 결과 요약
==========================================
  Shell: 5/5 통과, 0 실패
  TypeScript: 1/1 통과, 0 실패
==========================================
[TEST] 모든 테스트 통과
```

Exit code: `0`.

### `bun test lib/collect-jd/`

```
bun test v1.3.9 (cf6cdbbb)

 25 pass
 0 fail
 33 expect() calls
Ran 25 tests across 3 files. [14.00ms]
```

Exit code: `0`.

### `make sync-dry`

```
[WARN] ========== DRY-RUN 모드 (실제 변경 없음) ==========
[SYNC] 처리 중: projects/resume-manage/sync.yaml
[DRY] [claude] skills/collect-jd
[DRY] [gemini] skills/collect-jd
[DRY] [codex] skills/collect-jd
[DRY] [opencode] skills/collect-jd
[SYNC] 완료: projects/resume-manage/sync.yaml
[SYNC] 처리 중: projects/oh-my-resume/sync.yaml
[DRY] [claude] skills/collect-jd
[SYNC] 완료: projects/oh-my-resume/sync.yaml
[SYNC] 완료: sync.yaml
[WARN] ========== DRY-RUN 완료 ==========
```

Exit code: `0`.

## 배포 상태

- `projects/oh-my-resume/sync.yaml` 의 `skills.items` 에 `- collect-jd` 포함 확인 (line 26)
- `projects/resume-manage/sync.yaml` 의 `skills.items` 에 `- collect-jd` 포함 확인 (line 47)
- `make sync-dry` 로 배포 프리뷰 생성 — 실 배포 (`make sync`) 는 유저 본인 실행

## Plan DoD Checklist (최종)

| # | DoD 항목 | 상태 |
|---|---|---|
| 1 | SKILL.md + frontmatter (name, description, 트리거 문구) | ✅ |
| 2 | trigger-eval.json flat 스키마, positive/negative ≥10 | ✅ (positive 12 / negative 14) |
| 3 | 5개 reference 문서 | ✅ (frontmatter-schema, dedup-l2-prompt, ambiguity-prompt, slugify, url-normalize) + 추가 rules.md (M3 split) |
| 4 | lib/collect-jd/ bun test 통과 | ✅ (25/0) |
| 5 | pressure scenarios 모두 GREEN + evidence stub | ⚠ 13 scenario 원본 + real_subagent retest 4건 (S14-R · S15-R · S19-R · S20 — 커밋 1847921 Iron Law 재검증). 원 13건 analytical 기준 GREEN, 그 중 S14·S15·S19는 refactor 이후 `method: real_subagent`로 **재승격**됨. S20(Decision Flow)은 real_subagent로 신규 추가. T9 E2E 체인 real 실측은 별도 수행. |
| 6 | projects/<target>/sync.yaml 에 collect-jd 추가 | ✅ (oh-my-resume + resume-manage 두 개 타겟) |
| 7 | End-to-end dogfood | ⚠ analytical + CLI only. Claude Code 세션 내 실 체인 실행은 T9(이 파일 하단 Real Dogfood Evidence 섹션)에서 수행 |

## Known Limitations

- E2E Scenario 섹션(위)은 **analytical**: 실 Claude Code 세션에서의 매 step 재현은 T9 실 dogfood(아래 Real Dogfood Evidence 섹션)에서 수행.
- Pressure scenarios: 원본 13건은 analytical_simulation 방식 (추론 기반 RED/GREEN). 2026-04-23 Iron Law 재검증(1847921)에서 S14-R · S15-R · S19-R · S20 총 4건이 `method: real_subagent` 로 전환됨. T9 실 dogfood는 E2E 체인(Scope DoD #7)을 다루며 pressure scenario 개별 재검증과는 별도.
- `make sync` 실 배포는 유저가 직접 실행 (로컬 target 경로가 machine-specific).

## Conclusion

Phase A/B 완료. Phase C는 문서화 + CLI 검증(make validate/test/sync-dry) 완료, **실 Claude Code 세션 dogfood는 T9에서 수행**. DoD 중 #5·#7은 현재 analytical/CLI-only 상태 — T9 완료 후 Real Dogfood Evidence 섹션의 관찰값을 근거로 재평가. 그 외 5개 DoD 항목(#1, #2, #3, #4, #6)은 실증거로 충족.

---

## Real Dogfood Evidence (T9)

### Session Info
- Observed at: `2026-04-24T08:05:29Z – 2026-04-24T08:40:00Z` (approx 35 min)
- Method: `real_subagent` (B-α — sisyphus parent 세션 내 Skill 도구로 collect-jd invoke)
- SKILL.md sha256 at dogfood start: `b46ca2a3b54c576bb2fa4edf1df2bc3d33aefde67c4e505edff9f486434602ee`
- rules.md sha256 at dogfood start: `54928b67a2e65024a441e94032627d57b67ddfdbbdc3235c7c8ad753fb2e0a40`

### Chain Observations

1. **Trigger**: `/collect-jd` 호출 → `Unknown skill: collect-jd` 실패. `.claude/skills/` 배포 미완료 확인 → `cp -r skills/collect-jd .claude/skills/collect-jd` 핫로딩 후 재invoke 성공.

2. **Session Lock**: `$OMT_DIR/collect-jd/` 미존재. mkdir 후 `.lock.tmp` → rename atomic pattern으로 PID 7529 write.

3. **Phase 0 Profile Interview** (3-round AskUserQuestion):
   - Round 1: career=mid(3-5y), domains=[backend, data_ml_ai]
   - Round 2: backends=[kotlin_spring, java_spring, go(notes)], strengths=[system_design, performance_optimization, data_ml_pipeline, ai_new_tech_application]
     - **사용자 반발**: "강점은 왜 적는거야? JD 적합성을 너가 판별하는거야? 그냥 내가 원하는 JD는 싹다 긁어오는거 아니였어?"
   - Round 3: work_prefs=[seoul_metro_offline, hybrid], salary_policy=collect_even_when_unspecified, excludes=[si_sm_contract, subsidiary_hierarchy]
   - profile.yaml atomic write → 437 bytes, sha256 `74c7ca012dc95682262d93144ad01ae760088d591b80b5145d91b51572243739`.

4. **Ingest URL #1 (listing)**: `https://toss.im/career/jobs` — WebFetch 결과 "0개의 포지션" 표시. **사용자 반발**: "아니 수집을 하는데 어떻게 단일 jd을 전제해. 그럼 내가 계속 링크 물어다 줘야돼?" — Ingest Validation body-length check는 통과(~450자)했으나 실제로는 empty listing. `ingest-failures.log append` `reason=empty_listing`.

5. **Ingest URL #2 (single)**: `https://toss.im/career/job-detail?job_id=4071151003&sub_position_id=4071151003&company=%ED%86%A0%EC%8A%A4` — WebFetch 본문 ~100자(SPA shell), Ingest Validation `body < 200` 발동 → 저장 거부 + `ingest-failures.log append` `reason=body_too_short`.

6. **Fallback: insane-search (Phase 1 Jina Reader)**: 사용자 제안에 따라 `https://r.jina.ai/<url>` 패턴을 수동 구성하여 재fetch — dogfood-start SKILL.md sha `b46ca2a3...` 시점에는 rules.md에 해당 fallback이 명문화되어 있지 않았음 (Finding #6 참조). body ~1800-2000 words, JD 문구 매치(합류하게 될 팀/합류하면 함께할 업무/이런 분과 함께하고 싶어요). Ingest Validation 재통과.

7. **Dedup L1**: `jobs/` 비어있음 → pass. URL normalize: query string 유지, path trailing slash 없음 → unchanged.

8. **Role tagging**: role_title_verbatim="DevOps Engineer", role_tags=[devops, infra] (taxonomy.yaml baseline enum 내).

9. **Matching Loop**: Phase 1(history 없음) → Phase 2(rules.yaml 미존재 + profile domains=[backend, data_ml_ai]) → **ambiguous** → Phase 3 AskUserQuestion → 사용자 `include — DevOps도 관심 있음` 선택.

10. **JD atomic write**: `jobs/toss/devops-engineer-260424.md` (frontmatter-schema 준수, status=included, reason_note="DevOps도 관심 있음").

11. **Rules Re-evaluation**: include 1건 발생 → 자동 제안 트리거.
    - Step 1: before sha = null (rules.yaml 미존재)
    - Step 2-3: LLM(=sisyphus) 분석 → `rules.yaml.proposed` atomic write (match=2, mismatch=3, ambiguous=1)
    - Step 4: AskUserQuestion → `approve`
    - Step 5: race check — still null → OK
    - Step 6: `rules.yaml` overwrite (atomic) + `.proposed` 제거. rules.yaml sha256 = `332783601637a520f0591894058fc9b962adf35196a0d5e603a25d06b2d6d86c`.

12. **Session End**: `kill -0 7529` alive 확인 → PID match → `.lock` 제거. state tree clean.

### File State Snapshots (session end)

- `profile.yaml`: 437 bytes, sha `74c7ca01...`
- `taxonomy.yaml`: version:1, roles=[backend, frontend, fullstack, infra, data, platform, mobile, ml, devops] (baseline 9종)
- `rules.yaml`: version:1, match=2 / mismatch=3 / ambiguous=1 rules, sha `33278360...`
- `jobs/toss/devops-engineer-260424.md`: status=included, role_tags=[devops, infra], fingerprint_check=unique
- `ingest-failures.log`: 2 lines (empty_listing + body_too_short)

### Findings during dogfood (Priority 1)

1. **Skill deploy gap**: `skills/collect-jd/` source만 존재, `.claude/skills/collect-jd/` 부재. hot-load 없이는 skill invoke 불가. **해결책**: sync.yaml / `projects/<name>/sync.yaml`에 `- collect-jd` 추가 필요.
2. **Phase 0 UX — intent 설명 부재**: 사용자가 "강점 왜 적어?"라고 의문 제기. skill이 profile 필드 수집 **이유**(matching loop에서 rules 근거로 사용)를 사전 설명하지 않아 UX 혼란 유발. **해결책**: Round 2 intro에 "matching 판정에 사용됩니다 (강점 미제공 시 모든 JD ambiguous 처리)" 1줄 안내 추가.
3. **Listing URL ingest path 부재**: skill name "collect-jd"가 crawler 기대 유발하나 5개 ingest path(URL 단일/text/file/company-name/batch-rescan) 모두 개별 JD 또는 기존 JD 대상. listing URL → 개별 JD 자동 순회 path 없음. 사용자 직접 반박: "그럼 내가 계속 링크 물어다 줘야돼?". **해결책**: (a) listing crawl path 신규 추가, 또는 (b) SKILL.md description에 "사용자가 URL을 개별 제공" 전제 명시.
4. **Ingest Validation의 listing-page blind spot**: body length / 정지신호 2가지만 체크. 길이 충분(~450자)이지만 empty listing인 toss/career/jobs 케이스 통과시킴. **해결책**: JD terminology match(요구사항/담당업무/Responsibilities 등) 최소 매치 수 체크를 필수화.
5. **insane-search fallback 자동화 부재**: rules.md에 escalation 경로 있으나 자동 trigger 없음 — sisyphus가 수동으로 Jina Reader URL 구성해야 했음. **해결책**: WebFetch body < 200 시 insane-search 자동 chain(Phase 1→2→3) 실행 로직을 skill runtime에 내장.

6. **Fallback chain 사용자-induced trigger**: SPA 실패 후 insane-search fallback이 skill runtime 자동 발동 없이, 사용자가 직접 "insane-search 한번 써봐"라고 제안해야 경로 진입. rules.md의 escalation 순서는 존재하나 **trigger 로직 미구현**. 사용자가 skill 내부 fallback path를 알 필요가 있는 것 자체가 UX 실패. **해결책**: Ingest Validation body-too-short 발동 시 insane-search 설치 여부 감지 → 있으면 자동 Phase 1(Jina Reader) 재시도를 skill runtime에 내장.

7. **Dedup 실질 미관찰 (T9 한계)**: Dedup L1/L2는 jobs/ empty 상태라 algorithm 호출 조건 미성립, trivial pass로만 통과. 실제 normalizeUrl 매칭 / LLM similarity call(`reference/dedup-l2-prompt.md`)은 실행되지 않음. T9 evidence는 dedup path 검증에는 **부적합**. **후속 필요**: 2번째 JD ingest(같은 company 또는 다른 company) run을 추가해서 L1/L2 실트리거 path 관찰.

8. **Storage path interview 누락 — Plan→Spec 소실 (중대)**: Plan interview summary(collect-jd-skill-tdd.md)에 명시된 UX 결정 ("Storage path 결정 방식: 첫 실행 시 default `$OMT_DIR/collect-jd/jobs/` 제시 → 유저 수락/변경 → config 기록 → 다음부턴 그거 읽고 바로")이 SKILL.md / rules.md에 **규칙으로 구현되지 않음**. 사용자 직접 지적: "어디다 저장할지에 대해선 왜 안물어봐?" Dogfood 진행 중 `$OMT_DIR/collect-jd/` 하위에 default로 강제 저장됐는데, 유저에게 경로 확인/변경 기회가 없었음. **해결책**: Phase 0 Round 0으로 "storage path 확인" 단계 추가 + `config.yaml`에 기록. SKILL.md에 해당 섹션 신설 필요.

### User Objection Log (in-session raw quotes)

사용자가 skill flow 중 명시적으로 의문/반박 제기한 시점 (time-ordered):

1. Phase 0 Round 2: "강점은 왜 적는거야? JD 적합성을 너가 판별하는거야? 그냥 내가 원하는 JD는 싹다 긁어오는거 아니였어?" → Finding #2 유발.
2. Ingest #1 실패 후: "이게 무슨 얘기야? 아니 수집을 하는데 어떻게 단일 jd을 전제해. 그럼 내가 계속 링크 물어다 줘야돼?" → Finding #3 유발.
3. Ingest #2 재실패 후: "그럼 내가 계속 링크 줘야하는거야?" → Finding #3 재확인.
4. SPA 차단 문제에서: "핫 리로드 한번 해볼래? insane-search라는게 있는데 그거 한번 써봐." → Finding #6 유발.
5. Evidence 작성 도중: "중복체크한거지?" + "어디다 저장할지에 대해선 왜 안물어봐?" → Finding #7, #8 유발.

5회 반박 중 4회가 profile/ingest/crawler 기대 관련 — skill의 "collect=curate" intent가 사용자 모델("collect=crawl")과 일치하지 않음.

### Verdict

- DoD #7 충족 여부: **YES** — 실 Claude Code 세션에서 skill invoke + full chain 완주 (trigger→Phase 0→ingest→validation fail→fallback→dedup→role tagging→matching→JD write→rules re-eval→session end). Chain 11단계 중 중단/skip 없음.
- DoD #5 최소 1개 real scenario 관찰 여부: **PARTIAL** — ambiguous → Phase 3 user decision path 실증 + Rules re-evaluation race-check path 실증. **단, Dedup L1/L2는 jobs/ empty 상태라 algorithm 호출 없이 trivial pass — 실 dedup path 관찰은 T9 scope 밖. Finding #7 참조.**

---

## Evidence Footer (standardized)

| 필드 | 값 |
|---|---|
| `observed_at` | `2026-04-22` |
| `method` | `analytical_simulation+shell_exec` |
| `command` | `make validate / make test / bun test lib/collect-jd/ / make sync-dry` |
| `exit_code` | `0 / 0 / 0 / 0` |
| `key_output` | `1254 pass / 0 fail (전체 test suite); 25 pass / 0 fail (lib/collect-jd); make sync-dry 배포 프리뷰 생성. E2E Scenario 자체는 analytical — T9 대기.` |
| `verdict` | `EXPECTED_GREEN_PENDING_LIVE` |
