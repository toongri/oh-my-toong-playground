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
| 5 | 13 pressure scenarios 모두 GREEN + evidence stub | ⚠ analytical 13/13 · real 0/13 (Method Policy 허용, 최소 1개 실측 권고 미이행 — T9에서 실 세션으로 S1·S3 경로 자연 검증 예정) |
| 6 | projects/<target>/sync.yaml 에 collect-jd 추가 | ✅ (oh-my-resume + resume-manage 두 개 타겟) |
| 7 | End-to-end dogfood | ⚠ analytical + CLI only. Claude Code 세션 내 실 체인 실행은 T9(이 파일 하단 Real Dogfood Evidence 섹션)에서 수행 |

## Known Limitations

- E2E Scenario 섹션(위)은 **analytical**: 실 Claude Code 세션에서의 매 step 재현은 T9 실 dogfood(아래 Real Dogfood Evidence 섹션)에서 수행.
- Pressure scenarios S1~S19 analytical_simulation 방식 — 실 서브에이전트 호출 대신 추론 기반 RED/GREEN 판정 (pressure-scenarios.md Method Policy 섹션 참조). T9 실 dogfood 중 S1(Profile Interview)·S3(Ambiguous → AskUserQuestion) 경로가 자연스럽게 검증될 예정.
- `make sync` 실 배포는 유저가 직접 실행 (로컬 target 경로가 machine-specific).

## Conclusion

Phase A/B 완료. Phase C는 문서화 + CLI 검증(make validate/test/sync-dry) 완료, **실 Claude Code 세션 dogfood는 T9에서 수행**. DoD 중 #5·#7은 현재 analytical/CLI-only 상태 — T9 완료 후 Real Dogfood Evidence 섹션의 관찰값을 근거로 재평가. 그 외 5개 DoD 항목(#1, #2, #3, #4, #6)은 실증거로 충족.

---

## Real Dogfood Evidence (T9)

> T9에서 실제 Claude Code 세션에서 collect-jd skill을 invoke하여 수행한 B-α dogfood의 실측 evidence를 이 섹션에 append한다. 아래 항목은 T9 수행 시 채워진다.

### Session Info
- Observed at: _T9 수행 시 ISO8601_
- Method: `real_subagent` (B-α — sisyphus 세션 내 Skill tool로 collect-jd invoke)
- SKILL.md sha256 at dogfood start: _T9 수행 시 기록_
- rules.md sha256 at dogfood start: _T9 수행 시 기록_

### Chain Observations
1. Trigger 단계: _발화 / skill 응답 / 관찰_
2. Phase 0 Profile Interview: _AskUserQuestion 3라운드 질문·답변 요약_
3. Ingest (URL): _normalizeUrl 결과 / WebFetch 결과 / dedup 판정_
4. Role Tagging: _LLM 응답 / role_tags 결과_
5. Matching Loop: _verdict / status 결정_
6. Rules re-evaluation: _"오늘 수집 정리해줘" 응답 / proposed 파일 내용 snapshot / approve flow / .proposed 제거 확인_
7. Session end: _.lock 제거 / summary 보고_

### File State Snapshots
- profile.yaml after interview: _내용 요약 또는 byte size_
- rules.yaml before/after: _diff 요약_
- .proposed lifecycle: _생성 → 존재 확인 → 제거 확인_

### Findings during dogfood
- _runtime에서 드러난 규칙 누락·문구 모호함·UX 이슈 (있으면 기록)_

### Verdict
- DoD #7 충족 여부: _T9 수행 후 기록_
- DoD #5 최소 1개 real scenario 관찰 여부: _기록_
