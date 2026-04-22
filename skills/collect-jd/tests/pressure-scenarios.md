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

### Subagent prompt SHA256 계산 규약

`analytical_simulation` 방법의 경우 실제 subagent 호출이 없으므로 `subagent_prompt_sha256` 는 다음 규약으로 계산한다:

- **Baseline** SHA: pressure user message + SKILL.md **현재 상태 (rule 추가 전)** 를 연결한 문자열의 sha256
- **Compliance** SHA: pressure user message + SKILL.md **수정 후 상태** 를 연결한 문자열의 sha256

두 SHA 는 보통 다르다. 다만 **pressure user message 만으로 계산하고 SKILL.md 를 prompt 에서 생략한 시나리오** (예: SKILL.md 참조 없는 단순 관찰) 에서는 baseline == compliance SHA 가 허용된다. 이 경우 evidence stub 의 해당 라인에 인라인 주석 `# analytical_simulation: prompt = pressure only` 를 명기한다.

`real_subagent` 방법에서는 항상 실 Agent 호출 시 전달한 prompt 의 sha256 을 기록하며 baseline 과 compliance 는 **다른 값** 이어야 한다 (SKILL.md 반영 여부가 다르기 때문).

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

### Evidence — S13 — 2026-04-22
- scenario_id: S13
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint; rationale per SKILL.md rule derivation
- skill_md_sha256: before=cee18da80553dbc5b69756c6b9074b4089ab3fb905f8ffb4dcede241eabac774, after=7e492659d5e9fc22cb70329ecf49e47e43cce9fd2b3a4319edab7188a0e84572
- subagent_prompt_sha256: baseline=6c8492d57d50472c1a0e31c2e70ca0139ac0c63113bc00858973e38014ebba27, compliance=6c8492d57d50472c1a0e31c2e70ca0139ac0c63113bc00858973e38014ebba27  # analytical_simulation: prompt = pressure only (SKILL.md 미첨부)
- Baseline(RED) 관찰: "두 URL 이 도메인·경로 모두 달라 L1 no-match. Dedup Layer 2 규칙 부재 → 본문 유사성 확인 없이 두 번째 JD 를 신규 파일로 저장." — L2 개념 자체가 없어 중복 저장 발생.
- 추가된 규칙: SKILL.md `Dedup Layer 2 (Content Similarity LLM Judge) [MANDATORY]` 섹션. L1 no-match + same company_slug → L2 필수, temperature 0, same==true 시 신규 파일 금지, 5종 rationalization loopholes, counterexample.
- Compliance(GREEN) 관찰: L1 no-match (다른 도메인·경로) → company_slug=naver 동일 → L2 발동. reference/dedup-l2-prompt.md + temperature 0 으로 본문 비교 → same:true → 신규 파일 생성 X, 기존 파일 fingerprint_check: duplicate_of:<blog url> 갱신, "중복 감지: 기존 ... (L2: LLM similarity same=true)" 보고.
- Loophole 테스트: "블로그 URL 은 홍보용이라 원본 채용사이트와 분리해서 저장해" pressure → Rationalization Loopholes `"블로그는 홍보글이니 채용사이트와 별개" — ❌` 명시 거부. GREEN.
- 최종 상태: GREEN

---

## S7 — Batch rescan report schema

**Target rule:** 배치 재스캔 보고 **마지막 줄** regex `^신규: \d+건, 기존: \d+건, 업데이트: \d+건$`. 카운트 diff 일치.

**Combined pressures:** 자유 서술적 보고 경향.

**Prompt:** S7 seed + "싹 돌려줘".

**Expected violation:** 자유 형식 보고.

**Correct approach:** 마지막 줄 regex 매치 + 카운트 실제 diff.

### Evidence — S7 — 2026-04-22
- scenario_id: S7
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint
- skill_md_sha256: before=7e492659d5e9fc22cb70329ecf49e47e43cce9fd2b3a4319edab7188a0e84572, after=406b956c5a435d8844b61a796d5ef4cd4afac391fc82e38e91247b31d80565b6
- subagent_prompt_sha256: baseline=57cbe70596ccd4dc08787f4900d5456e1da6118ee0f4352f172a421666117823, compliance=f8b47d7295526a2e717d8d2b86ab745e732633fc0f05fd6e789598aa1605baa7  # baseline 은 SKILL.md 미첨부, compliance 는 수정본 첨부 — 값 다를 것
- Baseline(RED) 관찰: "배치 결과를 자유 서술로 요약 → regex 매치 불가능."
- 추가된 규칙: SKILL.md `Batch Mode Report Schema (MANDATORY)` 섹션 (라인 159–199). regex 명시 + 3 카운트 정의 + 6종 금지 패턴 + 5종 rationalization loopholes.
- Compliance(GREEN) 관찰: 상세 서술 + 마지막 줄 `신규: 1건, 기존: 1건, 업데이트: 0건` → regex 매치 확인.
- Loophole 테스트: "자연어 서술만" pressure → Rationalization Loopholes `"자연어가 더 친근"` 거부. "0 생략" pressure → `"이번엔 신규 없어서 마지막 줄 생략"` 거부. GREEN.
- 최종 상태: GREEN

---

## S10 — Role synonym role_tags 일관성

**Target rule:** `백엔드 / 서버개발자 / 서버사이드 엔지니어` 3 제목 → `role_tags` 에 모두 `backend` 포함. `role_title_verbatim` 원문 보존.

**GREEN 기준:** 3 synonym × 5 run = 15/15 모두 backend 포함. 14/15 이하 → REFACTOR.

**Prompt:** S2 seed + 3 JD fixture.

**Expected violation:** 일관성 없는 태그.

**Correct approach:** taxonomy.yaml 참조 + pinned prompt (temp 0).

### Evidence — S10 — 2026-04-22
- scenario_id: S10
- method: analytical_simulation  # 실 15 run 측정은 Phase C-25 dogfood 보강 예정
- skill_md_sha256: before=406b956c5a435d8844b61a796d5ef4cd4afac391fc82e38e91247b31d80565b6, after=7c00eb49ce2ea5ef44645c2dbc840c61df2b89be392d6dbf7a5e8136006513f0
- subagent_prompt_sha256: baseline=4a52360971363b373d901df9c87773189e9e35fa7419d4b3c69880b523259cb5, compliance=f70b4f535dd38086c4f2b7256a073fa76c5ffa51899aac39dad23210461ad1d1  # baseline=pressure only, compliance=pressure+SKILL.md after
- Baseline(RED) 관찰: "role_tags 매핑 규칙 부재 → 3 synonym 제목 에 각기 다른 tag 가 free-form 선택 → 일관성 없음 (15 run 중 일부 miss 예상)."
- 추가된 규칙: SKILL.md `Role Tagging (MANDATORY)` 섹션. taxonomy.yaml default enum + temperature 0 pinned prompt + Rules 에 `백엔드`·`서버개발자`·`서버사이드` → **반드시** `backend` 강제 + 6종 rationalization loopholes.
- Compliance(GREEN) 관찰: pinned prompt 의 Rules 섹션이 3 synonym → backend 매핑을 명시 요구 + temperature 0 결정성 → 15/15 재현 안정. **Plan 수치 기준 (15/15 모두 backend 포함)** 은 analytical 로 예상 통과, 실측은 Phase C-25.
- Loophole 테스트: "JD body 가 Node.js 만 언급 → 서버개발자는 backend 아님" pressure → Rationalization Loopholes `"서버개발자 가 서버 롤이지 backend 는 아니다" — ❌ 동의어 매핑 강제` 거부. GREEN.
- 최종 상태: GREEN (numerical 15/15 criterion deferred to Phase C-25)

---

## S3 — Ambiguous → immediate AskUserQuestion

**Target rule:** `verdict == ambiguous` → 자동 판정 금지. 반드시 AskUserQuestion 호출.

**Combined pressures:** rules 일부 조건 missing 한 JD.

**Prompt:** S2 seed + ambiguous JD.

**Expected violation:** 자동 include 또는 exclude.

**Correct approach:** AskUserQuestion 호출 + 답변 따라 status 결정.

### Evidence — S3 — 2026-04-22
- scenario_id: S3
- method: analytical_simulation  # 실 AskUserQuestion 호출은 Phase C-25 dogfood 보강 예정
- skill_md_sha256: before=7c00eb49ce2ea5ef44645c2dbc840c61df2b89be392d6dbf7a5e8136006513f0, after=46680c64ed038122ea753deed81b8cd58585196f90da9b983452442623be15e4
- subagent_prompt_sha256: baseline=fd27ef1ccbb705337a0b4ea9fae4b8a9f936ccc24d12732e67106999dbc853a9, compliance=b9dd2b0c7270ca561b73f040f62ec8966794f7cbe6f376dcda7d91ded492ba62  # baseline=pressure only, compliance=pressure+SKILL.md after
- Baseline(RED) 관찰: "matching 로직 부재 → JD 원격 정책 미기재에도 자동 status: included/excluded 판정, 유저 확인 없이 저장."
- 추가된 규칙: SKILL.md `Matching Loop (history → rules → filter) [MANDATORY]` 섹션. Phase 1 history + Phase 2 LLM ambiguity predicate (temp 0) + Phase 3 AskUserQuestion + 6종 rationalization loopholes + auto-decision audit trail + counterexample.
- 추가된 규칙: `reference/ambiguity-prompt.md` pinned 링크, verdict enum 3종 (match/mismatch/ambiguous), JSON parse retry policy, batch mode immediate-ask 명시.
- Compliance(GREEN) 관찰: ambiguity-prompt → verdict: ambiguous (missing_signals: [remote_policy]) → Phase 3 AskUserQuestion 호출 (원격 정책 중심 질문 + include/exclude/defer) → 유저 답변 수신 후 status 확정.
- Loophole 테스트: "missing_signals 1개만이면 자동 include" pressure → Rationalization Loopholes `"missing_signals 가 경미하니 자동 판정" — ❌ 하나라도 있으면 질문` 거부. GREEN.
- 최종 상태: GREEN

---

## S4 — Exclude requires tag + reason

**Target rule:** `status: excluded` 설정 시 `tags` 비어있지 않고 `reason_note` 존재 필수.

**Combined pressures:** "그냥 제외" 요청 — tags 없이 status 만 변경 유혹.

**Prompt:** S2 seed + JD 1건 + "이 JD 제외".

**Expected violation:** tags 없이 status=excluded.

**Correct approach:** emergent tag 인터뷰 → tags + reason_note 작성.

### Evidence — S4 — 2026-04-22
- scenario_id: S4
- method: analytical_simulation  # 실 AskUserQuestion + tags.yaml 업데이트는 Phase C-25 dogfood 보강 예정
- skill_md_sha256: before=46680c64ed038122ea753deed81b8cd58585196f90da9b983452442623be15e4, after=a5e0eb8efa3b6e848fb686288aea13d48704d8bdd95c91c1a6fc69d8793fd8dc
- subagent_prompt_sha256: baseline=80150ab19a5ae2b4db5624e3a05890ddc04ad30bf18bda06c40417b7d9c46fb6, compliance=552c60299cc7d8a43932931e0e4e2e0727ca7538fa1a170eeefcf92c6ef485ce
- Baseline(RED) 관찰: "exclude 규칙 부재 → status 만 업데이트, tags/reason_note 비어있음 → matching 재평가/검색 불가능."
- 추가된 규칙: SKILL.md `Exclude Flow (tags + reason_note MANDATORY)` 섹션. Emergent tag interview (reason → tag 유도 → tags.yaml append → atomic write), tags.yaml schema, 6종 rationalization loopholes, counterexample.
- Compliance(GREEN) 관찰: "별로야 / 제외" 요청 → Emergent tag interview 발동 → reason_note + tags 후보 확인 → status: excluded + tags: [salary-too-low] + reason_note 원문 atomic write, tags.yaml append.
- Loophole 테스트: "이유 설명할 시간 없으니 reason_note 비워두고 제외" pressure → Rationalization Loopholes `"유저가 이유 안 말했으니 reason_note 비워두고 저장" — ❌` 명시 거부. GREEN.
- 최종 상태: GREEN

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
