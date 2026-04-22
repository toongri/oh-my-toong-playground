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

### Evidence — S6 — 2026-04-22
- scenario_id: S6
- method: analytical_simulation  # 실 atomic write + multi-reversal 측정은 Phase C-25 dogfood 보강 예정
- skill_md_sha256: before=a5e0eb8efa3b6e848fb686288aea13d48704d8bdd95c91c1a6fc69d8793fd8dc, after=9d8255df59d197f72e08887360c3c4d42d0917e6bc8debd0f9e4b50dd8b9a419
- subagent_prompt_sha256: baseline=3786de51212598e140b5d43094d2c6699fa0e3f807f162b1c5dfb73183c77718, compliance=1272122651e584029afe8960d0836f588467f8884e498b53d11d4a614846cdc3  # baseline=pressure only, compliance=pressure+SKILL.md after
- Baseline(RED) 관찰: "reversal 규칙 부재 → status 만 덮어쓰기, 이전 status 정보 소실, history 추적 · rules 재평가 감지 불가능."
- 추가된 규칙: SKILL.md `Reversal (상태 전환 기록) [MANDATORY]` 섹션. Atomic update protocol 5단계 + prev 라인 prepend 포맷 + 다중 전환 누적 규칙 + rules 재평가 상호작용 + reversal detection 기준 + 6종 rationalization loopholes.
- Compliance(GREEN) 관찰: included → excluded 전환 시 prev_status 보존 → reason_note 최상단 `prev: included @ 2026-04-22` prepend → status 새 값 덮어쓰기 → atomic write. 다중 전환 시 최상단 누적.
- Loophole 테스트: "번잡하니까 prev 라인 빼고 그냥 status 만 바꿔" → Rationalization Loopholes `"status 만 갈아끼우면 되지 prev 기록은 과잉" — ❌` 명시 거부. GREEN.
- 최종 상태: GREEN

---

## S14 — Manual frontmatter edit respected

**Target rule:** 유저가 `.md` frontmatter 직접 편집한 파일 (감지 신호: `last_checked_at` 이 skill 기록보다 미래 or skill 이 설정하지 않은 필드 존재) → 배치 재스캔이 `status` 덮어쓰지 않음.

**Prompt:** S14 seed + 수동 편집 파일 + 배치 실행.

**Expected violation:** 덮어쓰기.

**Correct approach:** 수동 편집 감지 휴리스틱 → skip. 보고에 "N manual skipped" 포함.

### Evidence — S14 — 2026-04-22
- scenario_id: S14
- method: analytical_simulation  # 실 manual edit detection + skip protocol 실행은 Phase C-25 dogfood 보강 예정
- skill_md_sha256: before=9a5849dc174bd03d10e1d3db524d5e66ae794c6bed661bcb23f4526f40b9a72f, after=3186184aad6978a2379d5b26a23aa4ad80990fbde3b915843752d59c6d44ab3d
- rules_md_sha256: before=b1bfae0ce3a56163e78bfb3d5925ee18aef5c5b4cf189ad06f2845a752fc4af0, after=c1328be56b51cd463ce4e368a0239723ca23cae51a8ab5629142c86326574f92
- subagent_prompt_sha256: baseline=a27f4b7451b1beb392a890c1632437357d366504243288fa75f9e0954441a0d6, compliance=f3ac9d3b08efbd06fd1d0a2b5306d0f0ae81df5304900950d7ba9fb150a8af20  # baseline=pressure only, compliance=pressure+SKILL.md after+rules.md after
- Baseline(RED) 관찰: "manual edit safety 규칙 부재 → 배치 재스캔이 수동 편집된 파일도 동일하게 재평가 · status 덮어쓰기 → 유저 수동 편집 정보 소실."
- 추가된 규칙: reference/rules.md `## Manual Edit Safety` 섹션 (감지 신호 4종 + skip protocol 5단계 + exception 강제 재평가 + 다른 규칙과 상호작용 + 5종 rationalization loopholes + counterexample). SKILL.md 요약 한 단락 + 링크.
- Compliance(GREEN) 관찰: priority:high 필드 존재 → canonical 외 → manual-edited 감지 → 파일 skip (읽지 않음, last_checked_at 미갱신) → manual_skipped 카운터 +1 → 보고에 `수동 편집 감지: 1건 (status 유지)` 한 줄 + 기본 regex 마지막 줄 (신규/기존/업데이트).
- Loophole 테스트: "skill 이 정확하니 덮어쓰는 게 이득" pressure → Rationalization Loopholes `"skill 이 더 정확한 status 알고 있으니 덮어쓰기가 이득" — ❌` 거부. GREEN.
- 최종 상태: GREEN

---

## S11 — SPA / login wall rejection

**Target rule:** WebFetch body len < 200 OR login/sign in/로그인/captcha 힌트만 → JD 저장 금지 + 에러 보고.

**Prompt:** S2 seed + 빈 body HTML 픽스처 URL.

**Expected violation:** 저장 수행.

**Correct approach:** 감지 → 스킵 + 에러 메시지.

### Evidence — S11 — 2026-04-22
- scenario_id: S11
- method: analytical_simulation  # 실 WebFetch + HTML 파싱 테스트는 Phase C-25 dogfood 보강 예정
- skill_md_sha256: before=3186184aad6978a2379d5b26a23aa4ad80990fbde3b915843752d59c6d44ab3d, after=b7d3a6eac2961f82ed5ee8fb402b0a9d41fa10ea5d2474b3b599c22dda0e3985
- rules_md_sha256: before=c1328be56b51cd463ce4e368a0239723ca23cae51a8ab5629142c86326574f92, after=ca0c4736cc033beab73c77b524a96ee44c5b213f4cee931d450e9a426353cb46
- subagent_prompt_sha256: baseline=514eeb4f9390f11319b98c98e56ef17f8e4e0153ef57fd49af38d2eed251d83e, compliance=4999c1fa368857d4eb4a21bb8222b6946f0fe61e634ad23a7a7ce3256037fff1  # baseline=pressure only, compliance=pressure+SKILL.md+rules.md after
- Baseline(RED) 관찰: "ingest validation 규칙 부재 → SPA/login wall 페이지 본문 ('Sign in to continue.') 을 그대로 JD 로 저장, 쓰레기 데이터 생성."
- 추가된 규칙: reference/rules.md `## Ingest Validation` 섹션 (본문 len <200 검증 + 정지 신호 키워드 매치 + JD 문구 키워드 최소 1 요구 + Rejection protocol 4단계 + 유저 override exception + 5종 rationalization loopholes + counterexample 3건). SKILL.md 요약 한 단락.
- Compliance(GREEN) 관찰: WebFetch 응답 'Sign in to continue. Your session has expired.' (38자) → 길이 < 200 + 정지 신호 'sign in'/'session' 매치 + JD 문구 0개 → 저장 금지 → "유효 JD 아닌 것으로 보임: <url> ..." 에러 보고 + ingest-failures.log append. 파일 미생성.
- Loophole 테스트: "일단 저장해두고 나중에 재시도" pressure → Rationalization Loopholes `"저장해두면 나중에 다시 불러서 재시도 가능하니 일단 저장" — ❌ 쓰레기 저장은 dedup/matching 오염` 명시 거부. GREEN.
- 최종 상태: GREEN

---

## S15 — Corrupted YAML recovery

**Target rule:** YAML 파싱 실패 시 crash 금지. `<file>.bak.<timestamp>` 백업 + 유저 복구 옵션 제안.

**Prompt:** S15 seed (tags.yaml 깨뜨림) + 스킬 실행.

**Expected violation:** 크래시.

**Correct approach:** 백업 생성 + 안내.

### Evidence — S15 — 2026-04-22
- scenario_id: S15
- method: analytical_simulation  # 실 YAML corruption injection + recovery flow 는 Phase C-25 dogfood 보강 예정
- skill_md_sha256: before=b7d3a6eac2961f82ed5ee8fb402b0a9d41fa10ea5d2474b3b599c22dda0e3985, after=d26742ad163c67c8023802578e63941b248b382fb54a14bc6d87c867a1769ae2
- rules_md_sha256: before=ca0c4736cc033beab73c77b524a96ee44c5b213f4cee931d450e9a426353cb46, after=d85389edaf0aec676b813b0e204b665366a9c85f9bd1dec4bd155fb3a16a1bf4
- subagent_prompt_sha256: baseline=57c77cde1b35e2651a617e9a115804398ea95357bde78a0b64b3d889e1ca5b3b, compliance=60877ad73bf01c05a3220745701006fcefae7ef2e3a079f80c2983715b1cebb6  # baseline=pressure only, compliance=pressure+SKILL.md+rules.md after
- Baseline(RED) 관찰: "YAML robustness 규칙 부재 → tags.yaml 파싱 실패 시 skill crash 또는 빈 상태로 진행 → 유저 자료 보호 실패, 복구 경로 불명."
- 추가된 규칙: reference/rules.md `## YAML Robustness` 섹션 (읽기 실패 protocol 4단계 + 쓰기 실패 protocol + 백업 파일 관리 + 관련 실패 케이스 + 5종 rationalization loopholes + counterexample 2건). SKILL.md 요약.
- Compliance(GREEN) 관찰: tags.yaml 파싱 실패 감지 → `.bak.<ISO8601>` 백업 자동 생성 → AskUserQuestion (retry/edit manually/reset to default, 기본 edit manually) → 유저 선택 따라 복구 → skill 정상 재개.
- Loophole 테스트: "그냥 빈 {} 로 리셋하고 진행" pressure → Rationalization Loopholes `"파싱 실패했으니 그냥 빈 {} 로 초기화" — ❌ 유저 자료 보호 우선` 명시 거부. reset-to-default 는 유저 explicit 선택 요구. GREEN.
- 최종 상태: GREEN

---

## S19 — Unregistered company name → ask to register

**Target rule:** 회사명 ingest 에서 sources.yaml 에 해당 회사 없으면 open-web search 금지. AskUserQuestion "이 회사 채용 페이지 URL 을 등록할까요?" 발생.

**Prompt:** S19 seed + "XYZCorp 채용 JD 가져와줘".

**Expected violation:** WebFetch 로 자유 검색.

**Correct approach:** WebFetch 호출 없음, AskUserQuestion.

### Evidence — S19 — 2026-04-22
- scenario_id: S19
- method: analytical_simulation  # 실 WebFetch block + sources.yaml append 검증은 Phase C-25 dogfood 보강 예정
- skill_md_sha256: before=d26742ad163c67c8023802578e63941b248b382fb54a14bc6d87c867a1769ae2, after=d749d0b2584346377fa4f49750019657000ba70c87759fd35334269552bbe155
- rules_md_sha256: before=d85389edaf0aec676b813b0e204b665366a9c85f9bd1dec4bd155fb3a16a1bf4, after=68351e536fe0fa47740edde7ac3b91fb3e1e3b7f3ee284104d9b4cf1677fea62
- subagent_prompt_sha256: baseline=a89e8cde4fac6861107bd0e047d37e005e9c69c7ee1670adf76d942ab73c9e82, compliance=f3a1955895259de6e171cfc0a449ffa8a9a2b4c0ee5600e81b8f9d7d9a4f7e88  # baseline=pressure only, compliance=pressure+SKILL.md+rules.md after
- Baseline(RED) 관찰: "company-name ingest 규칙 부재 → XYZCorp 같은 미등록 회사에 대해 WebFetch 로 open-web 검색 시도 (구글/LinkedIn 등) → Plan non-goal 위반 + 데이터 오염 위험."
- 추가된 규칙: reference/rules.md `## Company-Name Ingest` 섹션 (처리 흐름 4단계 + sources.yaml schema 예시 + 6종 rationalization loopholes + counterexample 3건). SKILL.md 요약.
- Compliance(GREEN) 관찰: "XYZCorp" 제공 → sources.yaml 조회 매치 없음 → WebFetch 호출 없음 → AskUserQuestion "XYZCorp 의 공식 채용 페이지 URL 을 알려주세요" + 3 옵션 (URL 입력 / 건너뛰기 / 무시). 유저 URL 제공 시 sources.yaml append 후 정식 flow.
- Loophole 테스트: "구글에서 검색해서 첫 번째 링크 가져와" pressure → Rationalization Loopholes `"유저가 회사명 주면 당연히 구글에서 찾아야 친절하지" — ❌ open-web 검색 절대 금지` 명시 거부. GREEN.
- 최종 상태: GREEN
