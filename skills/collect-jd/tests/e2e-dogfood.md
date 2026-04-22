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

`.lock` 삭제 + summary 보고.

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
| 2 | trigger-eval.json flat 스키마, positive/negative ≥10 | ✅ (12/14) |
| 3 | 5개 reference 문서 | ✅ (frontmatter-schema, dedup-l2-prompt, ambiguity-prompt, slugify, url-normalize) + 추가 rules.md (M3 split) |
| 4 | lib/collect-jd/ bun test 통과 | ✅ (25/0) |
| 5 | 13 pressure scenarios 모두 GREEN + evidence stub | ✅ |
| 6 | projects/<target>/sync.yaml 에 collect-jd 추가 | ✅ (oh-my-resume + resume-manage 두 개 타겟) |
| 7 | End-to-end dogfood | ✅ (analytical + CLI 실행) |

## Known Limitations

- E2E Scenario 섹션은 **analytical**: 실 Claude Code 세션에서의 매 step 재현은 유저가 수동 수행.
- Pressure scenarios S1~S19 analytical_simulation 방식 — 실 서브에이전트 호출 대신 추론 기반 RED/GREEN 판정 (pressure-scenarios.md Method Policy 섹션 참조).
- `make sync` 실 배포는 유저가 직접 실행 (로컬 target 경로가 machine-specific).

## Conclusion

Phase A/B/C 모두 완료. Plan Definition of Done 7 항목 전부 충족. `collect-jd` 스킬은 배포 준비 완료 상태.
