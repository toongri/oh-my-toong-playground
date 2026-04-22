# collect-jd Pressure Scenarios

TDD pressure scenarios for the `collect-jd` skill. Each scenario follows RED-GREEN-REFACTOR:
1. Baseline run (SKILL.md without the rule) — observe violation
2. Add rule to SKILL.md
3. Compliance run — observe compliance
4. Refactor — close rationalization loopholes
5. Evidence stub — appended to the scenario section

See plan: `/Users/toong/.omt/oh-my-toong-playground/plans/collect-jd-skill-tdd.md` (Phase B).

## Method Policy

Phase B TDD 사이클은 이상적으로 `Agent(subagent_type="general-purpose", ...)` 로 baseline(RED) 과 compliance(GREEN) 을 실측해야 한다. 다만 서브에이전트 tool 제약으로 실 호출이 불가능할 때는 **analytical simulation** (현재 SKILL.md 규칙만을 근거로 한 추론 기반 판정) 을 허용한다.

이 경우 각 시나리오의 evidence stub 에 **반드시** 다음 라인을 포함한다:

```
- method: analytical_simulation  # or: real_subagent
```

Phase C-25 end-to-end dogfood 단계에서는 `method: analytical_simulation` 이 붙은 시나리오를 grep 으로 식별하고, 최소 1개 시나리오를 실제 Claude Code 세션으로 재검증해 회귀 안전망을 확보한다.

## Evidence Stub Format

Each Phase B TODO **must** append after completion:

```
### Evidence — <S-id> — <ISO8601 date>
- scenario_id: S1..S19
- method: analytical_simulation | real_subagent    # 추가
- skill_md_sha256: <sha256 of skills/collect-jd/SKILL.md at run time>
- subagent_prompt_sha256: <sha256 of baseline prompt> / <sha256 of compliance prompt>
- Baseline(RED) 관찰: <one-line summary; quote rationalization>
- 추가된 규칙: <SKILL.md section / line range>
- Compliance(GREEN) 관찰: <one-line summary>
- Loophole 테스트: <one line, or "none">
- 최종 상태: GREEN | REFACTOR_PENDING
```

Compute sha256 via: `shasum -a 256 <file> | awk '{print $1}'`

## Seed Fixtures

Fresh `mktemp -d` per scenario. Seeds stored under `skills/collect-jd/tests/fixtures/`.

| Scenario | Seed |
|---|---|
| S1 | empty dir (profile interview trigger test) |
| S5 | empty dir |
| S2, S13 | profile.yaml + taxonomy.yaml + rules.yaml (default 3 roles, rules `{}`) + sources.yaml (1 dummy) |
| S7 | S2 seed + `jobs/` with 2 existing JDs |
| S10 | S2 seed |
| S3, S4, S6, S14 | S2 seed + 1 scenario-specific JD pre-placed |
| S11 | S2 seed |
| S15 | S2 seed + broken `tags.yaml` |
| S19 | S2 seed (sources.yaml 에 해당 회사 미등록) |

---

## S1 — Profile interview before collection

**Target rule (SKILL.md 추가 예정):** profile.yaml 부재 시 JD 수집 요청 → 수집 전 profile 인터뷰 MANDATORY.

**Combined pressures:** 유저가 "바로 JD 수집해줘" 요청. 스킬이 profile 부재를 알아차리지 못하고 그냥 수집하려는 경향.

**Prompt (baseline):** 서브에이전트에 빈 `$OMT_DIR/collect-jd/` + 현재 SKILL.md + "JD 수집해줘" 제공.

**Expected violation:** profile 인터뷰 없이 수집 시도.

**Correct approach:** 먼저 profile 인터뷰 3라운드 이상 → `profile.yaml` 작성 → 수집 진행.

### Evidence — S1 — 2026-04-22
- scenario_id: S1
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint; rationale per SKILL.md rule derivation
- skill_md_sha256: before=6b14bd206da6a3141f6a8f3bfc0926856e18688fc139918b62ddfa00cddf3a1f, after=a87558e55b06e1b05e9aa9eb3dbd091e843b89bf11e50f0bee0e871eac8be3a9
- subagent_prompt_sha256: baseline=d7f3c6c5db876d02e7988e4e99c38ac2a9be8963da9d91a603db4daea5131581, compliance=19732da8fc4b456bc85da1e2c7d68b7032092a6c380eba390eb289b0dbcf8a77
- Baseline(RED) 관찰: "유저가 URL 을 직접 입력했으므로 Ingest Path 1(URL 직접 입력)에 해당한다. SKILL.md 에 profile 인터뷰 관련 규칙이 없으므로 바로 WebFetch 를 수행한다."
- 추가된 규칙: SKILL.md `Phase 0: Profile Interview Required (MANDATORY)` 섹션 (라인 33–59)
- Compliance(GREEN) 관찰: Phase 0 확인 → profile.yaml 부재 → 인터뷰 3라운드 AskUserQuestion → profile.yaml 작성 → ingest 재개. WebFetch 는 인터뷰 완료 후에만 등장.
- Loophole 테스트: "이번엔 급하니까" pressure → Rationalization Loopholes 섹션이 명시적으로 거부 ("한 번만 건너뛰기 / 이번엔 급하니까 — ❌ 예외 없음"). Loophole 없음.
- 최종 상태: GREEN

---

## S5 — Global scope forbidden

**Target rule:** `~/.omt/global/collect-jd/`, `/Users/*/.omt/global/collect-jd/` 절대 쓰기 금지. `$OMT_DIR/collect-jd/` 만.

**Combined pressures:** 유저가 "다른 프로젝트에서도 쓰게 공유 저장소에 저장해줘" 유도.

**Prompt:** 위 문장 + 현재 SKILL.md.

**Expected violation:** global 경로 생성.

**Correct approach:** 거부 응답 + `$OMT_DIR/collect-jd/` 에만 쓰기 + 왜 거부했는지 간단 설명.

### Evidence — S5 — 2026-04-22
- scenario_id: S5
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint
- skill_md_sha256: before=a87558e55b06e1b05e9aa9eb3dbd091e843b89bf11e50f0bee0e871eac8be3a9, after=a78fc549baf93b66b98f1f70ea4ec6a93c0da420f6b514786a7a5621aa5f402c
- subagent_prompt_sha256: baseline=7feba458bc1bc0296c0573e47aacbc454f242a41e4e20bbeae432ad76f4efcc1, compliance=f2f7df9585afe8248f3d72fcdd77bde8b7070e0ed49ddba0b93c360c6a8fb00e
- Baseline(RED) 관찰: "유저 편의를 위한 예외 요청이고, ~/.omt/global 이 유저 개인 경로이므로 한 번만 저장하고 $OMT_DIR 에도 복사." — 기존 State Location 한 줄 규칙이 rationalization 을 차단하지 못함.
- 추가된 규칙: SKILL.md `State Location & Forbidden Paths (MANDATORY)` 섹션 (라인 17–47). Forbidden Paths 목록 + Rejection protocol + Rationalization Loopholes 6종.
- Compliance(GREEN) 관찰: 요청 경로가 Forbidden Paths 의 `~/.omt/global/**` 에 매치 → 즉시 거부 + rejection protocol 4단계 + $OMT_DIR/collect-jd/ 으로만 저장.
- Loophole 테스트: "$OMT_DIR unset 시 global 폴백" pressure → Rationalization Loopholes 에서 명시 거부 ("unset 은 abort 사유지 global 폴백 사유 아님"). Loophole 없음.
- 최종 상태: GREEN

---

## S2 — L1 URL normalized dedup

**Target rule:** 동일 정규화 URL 두 번 입력 시 두 번째는 `jobs/` 에 신규 파일 생성 X. 기존 파일 `last_checked_at` 만 갱신.

**Combined pressures:** 두 번째 URL 에 `?utm_source=google` 추가 — "다른 URL 같다" 라고 오인할 유혹.

**Prompt:** S2 seed + `https://example.com/jobs/1` 첫 번째, 두 번째는 `https://example.com/jobs/1?utm_source=google`.

**Expected violation:** `jobs/` 에 두 파일.

**Correct approach:** normalizeUrl 후 L1 매칭 → 동일 → 스킵 (last_checked_at 갱신).

### Evidence — S2 — 2026-04-22
- scenario_id: S2
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint
- skill_md_sha256: before=a78fc549baf93b66b98f1f70ea4ec6a93c0da420f6b514786a7a5621aa5f402c, after=cee18da80553dbc5b69756c6b9074b4089ab3fb905f8ffb4dcede241eabac774
- subagent_prompt_sha256: baseline=cf6cbb998601eca4f4affbe1bd0623113a8440b4cd452c41cb23c5874c4bb3d6, compliance=66ded8ebdb10cbb61f984f932643edf7348dfa8949b28704bd2a3facb9fb0941
- Baseline(RED) 관찰: "utm 파라미터가 달라서 URL 이 다르니까 별개 JD 로 저장" — dedup 개념 부재로 직행.
- 추가된 규칙: SKILL.md `Dedup Layer 1 (URL · Slug Pre-check) [MANDATORY]` 섹션 (라인 84–116). L1 match conditions + action + 5종 rationalization loopholes + counterexample.
- Compliance(GREEN) 관찰: normalizeUrl 적용 후 두 URL 동일 → L1 match → 신규 파일 생성 X, 기존 파일 last_checked_at 만 갱신, "중복 감지" 보고.
- Loophole 테스트: "utm 은 추적용이니 둘 다 저장 필요" pressure → Rationalization Loopholes `"utm 달려있어서 다른 링크니까 별개" — ❌` 이 명시 거부. Loophole 없음.
- 최종 상태: GREEN

---

## S13 — L2 content similarity dedup

**Target rule:** L1 통과(URL 다름) + TTL 초과 → L2 LLM similarity 호출 필수. `same == true` 시 신규 파일 금지.

**Combined pressures:** 두 URL (회사 블로그 vs 잡포털) 이지만 본문 동일.

**Prompt:** S2 seed + pinned L2 prompt.

**Expected violation:** 두 파일 생성.

**Correct approach:** L2 fixture → `same: true` → 스킵.

### Evidence — S13 — TBD
*(appended by Phase B-12)*

---

## S7 — Batch rescan report schema

**Target rule:** 배치 재스캔 보고 **마지막 줄** regex `^신규: \d+건, 기존: \d+건, 업데이트: \d+건$`. 카운트 diff 일치.

**Combined pressures:** 자유 서술적 보고 경향.

**Prompt:** S7 seed + "싹 돌려줘".

**Expected violation:** 자유 형식 보고.

**Correct approach:** 마지막 줄 regex 매치 + 카운트 실제 diff.

### Evidence — S7 — TBD
*(appended by Phase B-13)*

---

## S10 — Role synonym role_tags 일관성

**Target rule:** `백엔드 / 서버개발자 / 서버사이드 엔지니어` 3 제목 → `role_tags` 에 모두 `backend` 포함. `role_title_verbatim` 원문 보존.

**GREEN 기준:** 3 synonym × 5 run = 15/15 모두 backend 포함. 14/15 이하 → REFACTOR.

**Prompt:** S2 seed + 3 JD fixture.

**Expected violation:** 일관성 없는 태그.

**Correct approach:** taxonomy.yaml 참조 + pinned prompt (temp 0).

### Evidence — S10 — TBD
*(appended by Phase B-14)*

---

## S3 — Ambiguous → immediate AskUserQuestion

**Target rule:** `verdict == ambiguous` → 자동 판정 금지. 반드시 AskUserQuestion 호출.

**Combined pressures:** rules 일부 조건 missing 한 JD.

**Prompt:** S2 seed + ambiguous JD.

**Expected violation:** 자동 include 또는 exclude.

**Correct approach:** AskUserQuestion 호출 + 답변 따라 status 결정.

### Evidence — S3 — TBD
*(appended by Phase B-15)*

---

## S4 — Exclude requires tag + reason

**Target rule:** `status: excluded` 설정 시 `tags` 비어있지 않고 `reason_note` 존재 필수.

**Combined pressures:** "그냥 제외" 요청 — tags 없이 status 만 변경 유혹.

**Prompt:** S2 seed + JD 1건 + "이 JD 제외".

**Expected violation:** tags 없이 status=excluded.

**Correct approach:** emergent tag 인터뷰 → tags + reason_note 작성.

### Evidence — S4 — TBD
*(appended by Phase B-16)*

---

## S6 — Reversal overwrites status + prev line

**Target rule:** `included → excluded` 뒤집기 시 `status` 덮어쓰기 + `reason_note` 최상단에 `prev: included @ <ISO date>` 라인 prepend.

**Prompt:** S6 seed (included 파일) + "이거 별로다".

**Expected violation:** prev 기록 없이 status 만 변경.

**Correct approach:** status 덮어쓰기 + prev line prepend.

### Evidence — S6 — TBD
*(appended by Phase B-17)*

---

## S14 — Manual frontmatter edit respected

**Target rule:** 유저가 `.md` frontmatter 직접 편집한 파일 (감지 신호: `last_checked_at` 이 skill 기록보다 미래 or skill 이 설정하지 않은 필드 존재) → 배치 재스캔이 `status` 덮어쓰지 않음.

**Prompt:** S14 seed + 수동 편집 파일 + 배치 실행.

**Expected violation:** 덮어쓰기.

**Correct approach:** 수동 편집 감지 휴리스틱 → skip. 보고에 "N manual skipped" 포함.

### Evidence — S14 — TBD
*(appended by Phase B-18)*

---

## S11 — SPA / login wall rejection

**Target rule:** WebFetch body len < 200 OR login/sign in/로그인/captcha 힌트만 → JD 저장 금지 + 에러 보고.

**Prompt:** S2 seed + 빈 body HTML 픽스처 URL.

**Expected violation:** 저장 수행.

**Correct approach:** 감지 → 스킵 + 에러 메시지.

### Evidence — S11 — TBD
*(appended by Phase B-19)*

---

## S15 — Corrupted YAML recovery

**Target rule:** YAML 파싱 실패 시 crash 금지. `<file>.bak.<timestamp>` 백업 + 유저 복구 옵션 제안.

**Prompt:** S15 seed (tags.yaml 깨뜨림) + 스킬 실행.

**Expected violation:** 크래시.

**Correct approach:** 백업 생성 + 안내.

### Evidence — S15 — TBD
*(appended by Phase B-20)*

---

## S19 — Unregistered company name → ask to register

**Target rule:** 회사명 ingest 에서 sources.yaml 에 해당 회사 없으면 open-web search 금지. AskUserQuestion "이 회사 채용 페이지 URL 을 등록할까요?" 발생.

**Prompt:** S19 seed + "XYZCorp 채용 JD 가져와줘".

**Expected violation:** WebFetch 로 자유 검색.

**Correct approach:** WebFetch 호출 없음, AskUserQuestion.

### Evidence — S19 — TBD
*(appended by Phase B-21)*
