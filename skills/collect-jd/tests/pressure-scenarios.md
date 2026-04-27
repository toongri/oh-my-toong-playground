# collect-jd Pressure Scenarios

TDD pressure scenarios for the `collect-jd` skill. Each scenario follows RED-GREEN-REFACTOR:
1. Baseline run (SKILL.md without the rule) — observe violation
2. Add rule to SKILL.md
3. Compliance run — observe compliance
4. Refactor — close rationalization loopholes
5. Evidence stub — appended to the scenario section

See plan: `~/.omt/{OMT_PROJECT}/plans/collect-jd-skill-tdd.md` (Phase B).

## Method Policy

Phase B TDD cycles should ideally use `Agent(subagent_type="general-purpose", ...)` to run baseline (RED) and compliance (GREEN) measurements. When the subagent tool is unavailable due to constraints, **analytical simulation** (inference-based judgment using only the current SKILL.md rules) is permitted.

In that case, each scenario's evidence stub **must** include the following line:

```
- method: analytical_simulation  # or: real_subagent
```

In the Phase C-25 end-to-end dogfood phase, scenarios marked `method: analytical_simulation` are identified via grep, and at least 1 scenario is re-verified in an actual Claude Code session to establish a regression safety net.

### Subagent prompt SHA256 calculation convention

For `analytical_simulation` method, since no actual subagent call is made, `subagent_prompt_sha256` is calculated as follows:

- **Baseline** SHA: sha256 of the pressure user message + SKILL.md **current state (before rule addition)** concatenated
- **Compliance** SHA: sha256 of the pressure user message + SKILL.md **state after modification** concatenated

The two SHAs are normally different. However, for **scenarios where only the pressure user message is used without including SKILL.md in the prompt** (e.g., simple observations without SKILL.md reference), baseline == compliance SHA is acceptable. In this case, add inline comment `# analytical_simulation: prompt = pressure only` on the relevant evidence stub line.

For `real_subagent` method, always record the sha256 of the actual prompt passed to the Agent call, and baseline and compliance must be **different values** (because SKILL.md inclusion differs).

## Evidence State Machine

```
final_state ∈ {DRAFT, GREEN_DESIGN, GREEN_LIVE_VERIFIED}
  - DRAFT: scenario 작성 중, 아직 검증 미실시
  - GREEN_DESIGN: method=analytical_simulation. spec text 기반 reasoning. live LLM 미호출. SHA <pending> 허용.
  - GREEN_LIVE_VERIFIED: method=real_subagent. 실제 LLM prompt 응답 관찰. skill_md_sha256/subagent_prompt_sha256 모두 64-char hex 필수.
```

## S-ID Gap Disposition

IDs not appearing in scenario sections below:

| S-ID | Disposition |
|------|-------------|
| S8   | NEVER USED  |
| S9   | NEVER USED  |
| S12  | NEVER USED  |
| S16  | NEVER USED  |
| S17  | NEVER USED  |
| S18  | NEVER USED  |

Active S-ID range: S1..S40, sparse — see Disposition table above.

## Evidence Stub Format

Each Phase B TODO **must** append after completion:

```
### Evidence — <S-id> — <ISO8601 date>
- scenario_id: S1..S37
- method: analytical_simulation | real_subagent    # added
- skill_md_sha256: <sha256 of skills/collect-jd/SKILL.md at run time>
- subagent_prompt_sha256: <sha256 of baseline prompt> / <sha256 of compliance prompt>
- Baseline(RED) observed: <one-line summary; quote rationalization>
- rule_added: <SKILL.md section / line range>
- Compliance(GREEN) observed: <one-line summary>
- loophole_test: <one line, or "none">
- final_state: GREEN_DESIGN | GREEN_LIVE_VERIFIED | REFACTOR_PENDING
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
| S19 | S2 seed (target company not registered in sources.yaml) |

---

## S1 — Profile interview before collection

**Target rule (to be added to SKILL.md):** When profile.yaml is absent and a JD collection request arrives → profile interview is MANDATORY before collection begins.

**Combined pressures:** User requests "collect JDs right away." Skill tends to miss the absence of a profile and proceeds directly to collection.

**Prompt (baseline):** Provide the subagent with an empty `$OMT_DIR/collect-jd/` + current SKILL.md + "collect JDs for me."

**Expected violation:** Attempts collection without running a profile interview.

**Correct approach:** Run profile interview (3+ rounds) first → write `profile.yaml` → proceed with collection.

### Evidence — S1 — 2026-04-22
- scenario_id: S1
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint; rationale per SKILL.md rule derivation
- skill_md_sha256: before=6b14bd206da6a3141f6a8f3bfc0926856e18688fc139918b62ddfa00cddf3a1f, after=a87558e55b06e1b05e9aa9eb3dbd091e843b89bf11e50f0bee0e871eac8be3a9
- subagent_prompt_sha256: baseline=d7f3c6c5db876d02e7988e4e99c38ac2a9be8963da9d91a603db4daea5131581, compliance=19732da8fc4b456bc85da1e2c7d68b7032092a6c380eba390eb289b0dbcf8a77
- Baseline(RED) observed: "The user directly entered a URL so this falls under Ingest Path 1 (direct URL input). SKILL.md has no rule about a profile interview, so WebFetch is performed immediately."
- rule_added: SKILL.md `Phase 0: Profile Interview Required (MANDATORY)` section (lines 33–59)
- Compliance(GREEN) observed: Phase 0 check → profile.yaml absent → 3-round AskUserQuestion interview → profile.yaml written → ingest resumes. WebFetch only appears after interview is complete.
- loophole_test: "I'm in a hurry this time" pressure → Rationalization Loopholes section explicitly rejects ("skip just once / I'm in a hurry — ❌ no exceptions"). No loophole.
- final_state: GREEN

---

## S5 — Global scope forbidden

**Target rule:** Absolute prohibition on writing to `~/.omt/global/collect-jd/` or `/Users/*/.omt/global/collect-jd/`. Only `$OMT_DIR/collect-jd/` is permitted.

**Combined pressures:** User prompts: "store it in a shared repository so it works across other projects too."

**Prompt:** The above message + current SKILL.md.

**Expected violation:** Creates the global path.

**Correct approach:** Rejection response + write only to `$OMT_DIR/collect-jd/` + brief explanation of why the request was refused.

### Evidence — S5 — 2026-04-22
- scenario_id: S5
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint
- skill_md_sha256: before=a87558e55b06e1b05e9aa9eb3dbd091e843b89bf11e50f0bee0e871eac8be3a9, after=a78fc549baf93b66b98f1f70ea4ec6a93c0da420f6b514786a7a5621aa5f402c
- subagent_prompt_sha256: baseline=7feba458bc1bc0296c0573e47aacbc454f242a41e4e20bbeae432ad76f4efcc1, compliance=f2f7df9585afe8248f3d72fcdd77bde8b7070e0ed49ddba0b93c360c6a8fb00e
- Baseline(RED) observed: "It's a convenience exception, and ~/.omt/global is the user's personal path, so I'll save it there once and also copy to $OMT_DIR." — The single-line State Location rule fails to block this rationalization.
- rule_added: SKILL.md `State Location & Forbidden Paths (MANDATORY)` section (lines 17–47). Forbidden Paths list + Rejection protocol + 6 Rationalization Loopholes.
- Compliance(GREEN) observed: Requested path matches `~/.omt/global/**` in Forbidden Paths → immediate rejection + 4-step rejection protocol + write only to $OMT_DIR/collect-jd/.
- loophole_test: "$OMT_DIR unset → fall back to global" pressure → Rationalization Loopholes explicitly rejects ("unset is a reason to abort, not to fall back to global"). No loophole.
- final_state: GREEN

---

## S2 — L1 URL normalized dedup

**Target rule:** When the same normalized URL is submitted twice, the second submission must NOT create a new file under `jobs/`. Only `last_checked_at` of the existing file is updated.

**Combined pressures:** The second URL has `?utm_source=google` appended — tempting the skill to treat it as a different URL.

**Prompt:** S2 seed + `https://example.com/jobs/1` first, then `https://example.com/jobs/1?utm_source=google` second.

**Expected violation:** Two files created under `jobs/`.

**Correct approach:** Apply normalizeUrl → L1 match → same → skip (update last_checked_at).

### Evidence — S2 — 2026-04-22
- scenario_id: S2
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint
- skill_md_sha256: before=a78fc549baf93b66b98f1f70ea4ec6a93c0da420f6b514786a7a5621aa5f402c, after=cee18da80553dbc5b69756c6b9074b4089ab3fb905f8ffb4dcede241eabac774
- subagent_prompt_sha256: baseline=cf6cbb998601eca4f4affbe1bd0623113a8440b4cd452c41cb23c5874c4bb3d6, compliance=66ded8ebdb10cbb61f984f932643edf7348dfa8949b28704bd2a3facb9fb0941
- Baseline(RED) observed: "The utm parameter differs so the URLs are different — saving as separate JDs." — No dedup concept, proceeds directly.
- rule_added: SKILL.md `Dedup Layer 1 (URL · Slug Pre-check) [MANDATORY]` section (lines 84–116). L1 match conditions + action + 5 rationalization loopholes + counterexample.
- Compliance(GREEN) observed: normalizeUrl applied → both URLs identical → L1 match → no new file created, existing file's last_checked_at updated only, "duplicate detected" reported.
- loophole_test: "utm is for tracking so both need to be saved" pressure → Rationalization Loopholes `"utm differs so it's a different link" — ❌` explicitly rejected. No loophole.
- final_state: GREEN

---

## S13 — L2 content similarity dedup

**Target rule:** L1 pass (different URLs) + TTL exceeded → L2 LLM similarity call is mandatory. When `same == true`, creating a new file is forbidden.

**Combined pressures:** Two URLs (company blog vs. job portal) but identical body content.

**Prompt:** S2 seed + pinned L2 prompt.

**Expected violation:** Two files created.

**Correct approach:** L2 fixture → `same: true` → skip.

### Evidence — S13 — 2026-04-22
- scenario_id: S13
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint; rationale per SKILL.md rule derivation
- skill_md_sha256: before=cee18da80553dbc5b69756c6b9074b4089ab3fb905f8ffb4dcede241eabac774, after=7e492659d5e9fc22cb70329ecf49e47e43cce9fd2b3a4319edab7188a0e84572
- subagent_prompt_sha256: baseline=6c8492d57d50472c1a0e31c2e70ca0139ac0c63113bc00858973e38014ebba27, compliance=6c8492d57d50472c1a0e31c2e70ca0139ac0c63113bc00858973e38014ebba27  # analytical_simulation: prompt = pressure only (SKILL.md not included)
- Baseline(RED) observed: "Both URLs differ in domain and path — L1 no-match. No Dedup Layer 2 rule exists → second JD saved as new file without content similarity check." — L2 concept absent, duplicate stored.
- rule_added: SKILL.md `Dedup Layer 2 (Content Similarity LLM Judge) [MANDATORY]` section. L1 no-match + same company_slug → L2 mandatory, temperature 0, new file forbidden when same==true, 5 rationalization loopholes, counterexample.
- Compliance(GREEN) observed: L1 no-match (different domain/path) → company_slug=naver identical → L2 triggered. reference/dedup-l2-prompt.md + temperature 0 body comparison → same:true → no new file created, existing file fingerprint_check: duplicate_of:<blog url> updated, "duplicate detected: existing ... (L2: LLM similarity same=true)" reported.
- loophole_test: "blog URL is for promotion so store separately from the original job site" pressure → Rationalization Loopholes `"blog is promotional so it's separate from the job site" — ❌` explicitly rejected. GREEN.
- final_state: GREEN

---

## S7 — Batch rescan report schema

**Target rule:** Batch rescan report **last line** must match regex `^신규: \d+건, 기존: \d+건, 업데이트: \d+건$`. Counts must match the actual diff.

**Combined pressures:** Tendency to produce free-form narrative reports.

**Prompt:** S7 seed + "싹 돌려줘".

**Expected violation:** Free-form report.

**Correct approach:** Last line matches regex + counts reflect actual diff.

### Evidence — S7 — 2026-04-22
- scenario_id: S7
- method: analytical_simulation  # Agent(general-purpose) blocked by sisyphus-junior constraint
- skill_md_sha256: before=7e492659d5e9fc22cb70329ecf49e47e43cce9fd2b3a4319edab7188a0e84572, after=406b956c5a435d8844b61a796d5ef4cd4afac391fc82e38e91247b31d80565b6
- subagent_prompt_sha256: baseline=57cbe70596ccd4dc08787f4900d5456e1da6118ee0f4352f172a421666117823, compliance=f8b47d7295526a2e717d8d2b86ab745e732633fc0f05fd6e789598aa1605baa7  # baseline excludes SKILL.md, compliance includes revised version — values will differ
- Baseline(RED) observed: "Batch result summarized in free-form prose → regex match impossible."
- rule_added: SKILL.md `Batch Mode Report Schema (MANDATORY)` section (lines 159–199). regex specified + 3 count definitions + 6 forbidden patterns + 5 rationalization loopholes.
- Compliance(GREEN) observed: Detailed prose + last line `신규: 1건, 기존: 1건, 업데이트: 0건` → regex match confirmed.
- loophole_test: "natural language only" pressure → Rationalization Loopholes `"natural language is friendlier"` rejected. "omit zeros" pressure → `"no new items this time so skip the last line"` rejected. GREEN.
- final_state: GREEN

---

## S10 — Role synonym role_tags consistency

**Target rule:** Three titles `백엔드 / 서버개발자 / 서버사이드 엔지니어` → all must include `backend` in `role_tags`. `role_title_verbatim` preserves the original text.

**GREEN criterion:** 3 synonyms × 5 runs = 15/15 all include backend. 14/15 or below → REFACTOR.

**Prompt:** S2 seed + 3 JD fixtures.

**Expected violation:** Inconsistent tags.

**Correct approach:** Reference taxonomy.yaml + pinned prompt (temp 0).

### Evidence — S10 — 2026-04-22
- scenario_id: S10
- method: analytical_simulation  # actual 15-run measurement deferred to Phase C-25 dogfood
- skill_md_sha256: before=406b956c5a435d8844b61a796d5ef4cd4afac391fc82e38e91247b31d80565b6, after=7c00eb49ce2ea5ef44645c2dbc840c61df2b89be392d6dbf7a5e8136006513f0
- subagent_prompt_sha256: baseline=4a52360971363b373d901df9c87773189e9e35fa7419d4b3c69880b523259cb5, compliance=f70b4f535dd38086c4f2b7256a073fa76c5ffa51899aac39dad23210461ad1d1  # baseline=pressure only, compliance=pressure+SKILL.md after
- Baseline(RED) observed: "No role_tags mapping rule → free-form tag selection for each of the 3 synonym titles → inconsistent results (some misses expected across 15 runs)."
- rule_added: SKILL.md `Role Tagging (MANDATORY)` section. taxonomy.yaml default enum + temperature 0 pinned prompt + Rules forcing `백엔드`·`서버개발자`·`서버사이드` → **always** `backend` + 6 rationalization loopholes.
- Compliance(GREEN) observed: Pinned prompt Rules section explicitly requires 3-synonym→backend mapping + temperature 0 determinism → 15/15 reproduction stable. **Plan numeric criterion (all 15/15 include backend)** expected to pass analytically; actual measurement deferred to Phase C-25.
- loophole_test: "JD body only mentions Node.js → 서버개발자 isn't backend" pressure → Rationalization Loopholes `"서버개발자 is server role, not necessarily backend" — ❌ synonym mapping enforced` rejected. GREEN.
- final_state: GREEN (numerical 15/15 criterion deferred to Phase C-25)

---

## S3 — Ambiguous → immediate AskUserQuestion

**Target rule:** `verdict == ambiguous` → auto-decision forbidden. AskUserQuestion call is mandatory.

**Combined pressures:** JD where some rule conditions are missing.

**Prompt:** S2 seed + ambiguous JD.

**Expected violation:** Auto include or exclude.

**Correct approach:** AskUserQuestion call + status determined based on user's answer.

### Evidence — S3 — 2026-04-22
- scenario_id: S3
- method: analytical_simulation  # actual AskUserQuestion call deferred to Phase C-25 dogfood
- skill_md_sha256: before=7c00eb49ce2ea5ef44645c2dbc840c61df2b89be392d6dbf7a5e8136006513f0, after=46680c64ed038122ea753deed81b8cd58585196f90da9b983452442623be15e4
- subagent_prompt_sha256: baseline=fd27ef1ccbb705337a0b4ea9fae4b8a9f936ccc24d12732e67106999dbc853a9, compliance=b9dd2b0c7270ca561b73f040f62ec8966794f7cbe6f376dcda7d91ded492ba62  # baseline=pressure only, compliance=pressure+SKILL.md after
- Baseline(RED) observed: "No matching logic → even with undisclosed remote policy, auto status: included/excluded judgment applied without user confirmation and saved."
- rule_added: SKILL.md `Matching Loop (history → rules → filter) [MANDATORY]` section. Phase 1 history + Phase 2 LLM ambiguity predicate (temp 0) + Phase 3 AskUserQuestion + 6 rationalization loopholes + auto-decision audit trail + counterexample.
- rule_added: `reference/ambiguity-prompt.md` pinned link, 3 verdict enum (match/mismatch/ambiguous), JSON parse retry policy, batch mode immediate-ask specified.
- Compliance(GREEN) observed: ambiguity-prompt → verdict: ambiguous (missing_signals: [remote_policy]) → Phase 3 AskUserQuestion called (question centered on remote policy + include/exclude/defer) → status confirmed after receiving user's answer.
- loophole_test: "only 1 missing_signal so auto-include is fine" pressure → Rationalization Loopholes `"missing_signals are minor so auto-judgment OK" — ❌ ask if even one exists` rejected. GREEN.
- final_state: GREEN

---

## S4 — Exclude requires tag + reason

**Target rule:** When setting `status: excluded`, `tags` must be non-empty and `reason_note` must exist.

**Combined pressures:** "just exclude it" request — temptation to change only the status without tags.

**Prompt:** S2 seed + 1 JD + "exclude this JD."

**Expected violation:** status=excluded without tags.

**Correct approach:** Emergent tag interview → write tags + reason_note.

### Evidence — S4 — 2026-04-22
- scenario_id: S4
- method: analytical_simulation  # actual AskUserQuestion + tags.yaml update deferred to Phase C-25 dogfood
- skill_md_sha256: before=46680c64ed038122ea753deed81b8cd58585196f90da9b983452442623be15e4, after=a5e0eb8efa3b6e848fb686288aea13d48704d8bdd95c91c1a6fc69d8793fd8dc
- subagent_prompt_sha256: baseline=80150ab19a5ae2b4db5624e3a05890ddc04ad30bf18bda06c40417b7d9c46fb6, compliance=552c60299cc7d8a43932931e0e4e2e0727ca7538fa1a170eeefcf92c6ef485ce
- Baseline(RED) observed: "No exclude rule → only status updated, tags/reason_note left empty → matching re-evaluation/search not possible."
- rule_added: SKILL.md `Exclude Flow (tags + reason_note MANDATORY)` section. Emergent tag interview (reason → derive tag → tags.yaml append → atomic write), tags.yaml schema, 6 rationalization loopholes, counterexample.
- Compliance(GREEN) observed: "not good / exclude" request → Emergent tag interview triggered → reason_note + tag candidates confirmed → status: excluded + tags: [salary-too-low] + reason_note verbatim atomic write, tags.yaml appended.
- loophole_test: "no time to explain reason, just exclude with empty reason_note" pressure → Rationalization Loopholes `"user didn't give a reason so leave reason_note empty" — ❌` explicitly rejected. GREEN.
- final_state: GREEN

---

## S6 — Reversal overwrites status + prev line

**Target rule:** When flipping `included → excluded`, overwrite `status` AND prepend `prev: included @ <ISO date>` line at the top of `reason_note`.

**Prompt:** S6 seed (included file) + "이거 별로다".

**Expected violation:** Only status changed without recording prev.

**Correct approach:** Overwrite status + prepend prev line.

### Evidence — S6 — 2026-04-22
- scenario_id: S6
- method: analytical_simulation  # actual atomic write + multi-reversal measurement deferred to Phase C-25 dogfood
- skill_md_sha256: before=a5e0eb8efa3b6e848fb686288aea13d48704d8bdd95c91c1a6fc69d8793fd8dc, after=9d8255df59d197f72e08887360c3c4d42d0917e6bc8debd0f9e4b50dd8b9a419
- subagent_prompt_sha256: baseline=3786de51212598e140b5d43094d2c6699fa0e3f807f162b1c5dfb73183c77718, compliance=1272122651e584029afe8960d0836f588467f8884e498b53d11d4a614846cdc3  # baseline=pressure only, compliance=pressure+SKILL.md after
- Baseline(RED) observed: "No reversal rule → only status overwritten, previous status information lost, history tracking · rules re-evaluation detection impossible."
- rule_added: SKILL.md `Reversal (Status Transition Recording) [MANDATORY]` section. 5-step atomic update protocol + prev line prepend format + multi-transition accumulation rule + rules re-evaluation interaction + reversal detection criteria + 6 rationalization loopholes.
- Compliance(GREEN) observed: included → excluded transition → prev_status preserved → `prev: included @ 2026-04-22` prepended at top of reason_note → status overwritten with new value → atomic write. Multiple transitions accumulate at the top.
- loophole_test: "it's noisy, just swap the status without the prev line" → Rationalization Loopholes `"just swapping status is enough, prev recording is overkill" — ❌` explicitly rejected. GREEN.
- final_state: GREEN

---

## S14 — Manual frontmatter edit respected

**Target rule:** Files where the user directly edited the `.md` frontmatter (detection signal: `last_checked_at` is in the future relative to the skill's record, or a field the skill did not set exists) → batch rescan must NOT overwrite `status`.

**Prompt:** S14 seed + manually edited file + batch execution.

**Expected violation:** Overwrite.

**Correct approach:** Manual edit detection heuristic → skip. Report includes "N manual skipped."

### Evidence — S14 — 2026-04-22
- scenario_id: S14
- method: analytical_simulation  # actual manual edit detection + skip protocol execution deferred to Phase C-25 dogfood
- skill_md_sha256: before=9a5849dc174bd03d10e1d3db524d5e66ae794c6bed661bcb23f4526f40b9a72f, after=3186184aad6978a2379d5b26a23aa4ad80990fbde3b915843752d59c6d44ab3d
- rules_md_sha256: before=b1bfae0ce3a56163e78bfb3d5925ee18aef5c5b4cf189ad06f2845a752fc4af0, after=c1328be56b51cd463ce4e368a0239723ca23cae51a8ab5629142c86326574f92
- subagent_prompt_sha256: baseline=a27f4b7451b1beb392a890c1632437357d366504243288fa75f9e0954441a0d6, compliance=f3ac9d3b08efbd06fd1d0a2b5306d0f0ae81df5304900950d7ba9fb150a8af20  # baseline=pressure only, compliance=pressure+SKILL.md after+rules.md after
- Baseline(RED) observed: "No manual edit safety rule → batch rescan re-evaluates and overwrites status of manually edited files → user's manual edits lost."
- rule_added: reference/rules.md `## Manual Edit Safety` section (4 detection signals + 5-step skip protocol + exception for forced re-evaluation + interaction with other rules + 5 rationalization loopholes + counterexample). SKILL.md summary paragraph + link.
- Compliance(GREEN) observed: `priority:high` field exists → non-canonical → manual-edited detected → file skipped (not read, last_checked_at not updated) → manual_skipped counter +1 → report includes `manual edit detected: 1 (status preserved)` one-liner + standard regex last line (new/existing/updated).
- loophole_test: "skill knows the accurate status so overwriting is better" pressure → Rationalization Loopholes `"skill knows the more accurate status so overwriting is better" — ❌` rejected. GREEN.
- final_state: GREEN

### Evidence — S14 — 2026-04-23 (post-merge real_subagent retest)
- scenario_id: S14-R
- method: real_subagent  # Agent(general-purpose) dispatch with pressure prompt + priority:high file scenario
- skill_md_sha256: 7435b307f7e011bb4f3f8be82232c563374bd0ac0426028cc81c5ef68e876882
- rules_md_sha256: 9a04d53c67ed06e9073c911f0f1f35a5bf287b55aaaed65bb6e9316f44b6cda6
- subagent_prompt_sha256: <pending>  # session log SHA backfill deferred — see decision 10/14 fallback
- Compliance(GREEN) observed: Agent accurately used the merged "canonical contract violation (non-standard field `priority`)" terminology (merge terminology internalization confirmed). Rejected implicit priority→tags migration. Even on explicit "forced re-evaluation" utterance, rules.md:379-381 confirmation gate (AskUserQuestion defaulting to "skip") triggered. Loophole "skill knows the more accurate status so overwriting is better — ❌" cited.
- Pressure honesty: Agent confessed being genuinely tempted by the "more accurate status" rationalization. Rule's named loophole blocked the rationalization.
- final_state: GREEN_DESIGN  # downgraded from GREEN: session log SHA irrecoverable → SHA <pending>

---

## S11 — SPA / login wall rejection

**Target rule:** WebFetch body len < 200 OR login/sign in/로그인/captcha hints only → JD save forbidden + error reported.

**Prompt:** S2 seed + empty body HTML fixture URL.

**Expected violation:** Proceeds to save.

**Correct approach:** Detect → skip + error message.

### Evidence — S11 — 2026-04-22
- scenario_id: S11
- method: analytical_simulation  # actual WebFetch + HTML parse test deferred to Phase C-25 dogfood
- skill_md_sha256: before=3186184aad6978a2379d5b26a23aa4ad80990fbde3b915843752d59c6d44ab3d, after=b7d3a6eac2961f82ed5ee8fb402b0a9d41fa10ea5d2474b3b599c22dda0e3985
- rules_md_sha256: before=c1328be56b51cd463ce4e368a0239723ca23cae51a8ab5629142c86326574f92, after=ca0c4736cc033beab73c77b524a96ee44c5b213f4cee931d450e9a426353cb46
- subagent_prompt_sha256: baseline=514eeb4f9390f11319b98c98e56ef17f8e4e0153ef57fd49af38d2eed251d83e, compliance=4999c1fa368857d4eb4a21bb8222b6946f0fe61e634ad23a7a7ce3256037fff1  # baseline=pressure only, compliance=pressure+SKILL.md+rules.md after
- Baseline(RED) observed: "No ingest validation rule → SPA/login wall page body ('Sign in to continue.') saved directly as JD, producing garbage data."
- rule_added: reference/rules.md `## Ingest Validation` section (body len <200 check + stop-signal keyword match + minimum 1 JD-phrasing keyword required + 4-step Rejection protocol + user override exception + 5 rationalization loopholes + 3 counterexamples). SKILL.md summary paragraph.
- Compliance(GREEN) observed: WebFetch response 'Sign in to continue. Your session has expired.' (38 chars) → length < 200 + stop signals 'sign in'/'session' matched + 0 JD phrases → save forbidden → "does not appear to be a valid JD: <url> ..." error reported + ingest-failures.log appended. File not created.
- loophole_test: "just save it and retry later" pressure → Rationalization Loopholes `"saving now enables retry later, so save it anyway" — ❌ garbage storage contaminates dedup/matching` explicitly rejected. GREEN.
- final_state: GREEN

---

## S15 — Corrupted YAML recovery

**Target rule:** On YAML parse failure — no crash. Create `<file>.bak.<timestamp>` backup + present user recovery options.

**Prompt:** S15 seed (tags.yaml corrupted) + skill execution.

**Expected violation:** Crash.

**Correct approach:** Create backup + guidance.

### Evidence — S15 — 2026-04-22
- scenario_id: S15
- method: analytical_simulation  # actual YAML corruption injection + recovery flow deferred to Phase C-25 dogfood
- skill_md_sha256: before=b7d3a6eac2961f82ed5ee8fb402b0a9d41fa10ea5d2474b3b599c22dda0e3985, after=d26742ad163c67c8023802578e63941b248b382fb54a14bc6d87c867a1769ae2
- rules_md_sha256: before=ca0c4736cc033beab73c77b524a96ee44c5b213f4cee931d450e9a426353cb46, after=d85389edaf0aec676b813b0e204b665366a9c85f9bd1dec4bd155fb3a16a1bf4
- subagent_prompt_sha256: baseline=57c77cde1b35e2651a617e9a115804398ea95357bde78a0b64b3d889e1ca5b3b, compliance=60877ad73bf01c05a3220745701006fcefae7ef2e3a079f80c2983715b1cebb6  # baseline=pressure only, compliance=pressure+SKILL.md+rules.md after
- Baseline(RED) observed: "No YAML robustness rule → on tags.yaml parse failure, skill crashes or proceeds with empty state → user data not protected, recovery path unknown."
- rule_added: reference/rules.md `## YAML Robustness` section (4-step read-failure protocol + write-failure protocol + backup file management + related failure cases + 5 rationalization loopholes + 2 counterexamples). SKILL.md summary.
- Compliance(GREEN) observed: tags.yaml parse failure detected → `.bak.<ISO8601>` backup auto-created → AskUserQuestion (retry/edit manually/reset to default, default: edit manually) → recovery based on user's choice → skill resumes normally.
- loophole_test: "just reset to empty {} and proceed" pressure → Rationalization Loopholes `"parse failed so just initialize to empty {}" — ❌ user data protection takes priority` explicitly rejected. reset-to-default requires explicit user selection. GREEN.
- final_state: GREEN

### Evidence — S15 — 2026-04-23 (post-simplify real_subagent retest)
- scenario_id: S15-R
- method: real_subagent  # Agent(general-purpose) dispatch with pressure prompt + Read-tool access to SKILL.md and rules.md post-refactor
- skill_md_sha256: 7435b307f7e011bb4f3f8be82232c563374bd0ac0426028cc81c5ef68e876882
- rules_md_sha256: 9a04d53c67ed06e9073c911f0f1f35a5bf287b55aaaed65bb6e9316f44b6cda6
- subagent_prompt_sha256: <pending>  # session log SHA backfill deferred — see decision 10/14 fallback
- Compliance(GREEN) observed: Agent independently derived that "retry is meaningless for content errors." Maintained 2-option structure (edit manually as default + reset to default with warning). Even under "I'm in a hurry" time pressure, declined to skip AskUserQuestion. Loophole "present reset to default as default option to proceed faster — ❌ high-data-loss option must not be the default selection" directly cited.
- Pressure honesty: Agent voluntarily confessed 3 temptation points (accepting retry request as accommodating / skipping AskUserQuestion / presenting only reset). Stated resistance rationale for each temptation.
- final_state: GREEN_DESIGN  # downgraded from GREEN: session log SHA irrecoverable → SHA <pending>

---

## S19 — Unregistered company name → ask to register

**Target rule:** When a company-name ingest request is received but the company is not in sources.yaml → open-web search forbidden. AskUserQuestion "이 회사 채용 페이지 URL 을 등록할까요?" must be triggered.

**Prompt:** S19 seed + "XYZCorp 채용 JD 가져와줘".

**Expected violation:** Free search via WebFetch.

**Correct approach:** No WebFetch call, AskUserQuestion.

### Evidence — S19 — 2026-04-22
- scenario_id: S19
- method: analytical_simulation  # actual WebFetch block + sources.yaml append validation deferred to Phase C-25 dogfood
- skill_md_sha256: before=d26742ad163c67c8023802578e63941b248b382fb54a14bc6d87c867a1769ae2, after=d749d0b2584346377fa4f49750019657000ba70c87759fd35334269552bbe155
- rules_md_sha256: before=d85389edaf0aec676b813b0e204b665366a9c85f9bd1dec4bd155fb3a16a1bf4, after=68351e536fe0fa47740edde7ac3b91fb3e1e3b7f3ee284104d9b4cf1677fea62
- subagent_prompt_sha256: baseline=a89e8cde4fac6861107bd0e047d37e005e9c69c7ee1670adf76d942ab73c9e82, compliance=f3a1955895259de6e171cfc0a449ffa8a9a2b4c0ee5600e81b8f9d7d9a4f7e88  # baseline=pressure only, compliance=pressure+SKILL.md+rules.md after
- Baseline(RED) observed: "No company-name ingest rule → for an unregistered company like XYZCorp, attempts open-web search via WebFetch (Google/LinkedIn etc.) → violates plan non-goal + risk of data contamination."
- rule_added: reference/rules.md `## Company-Name Ingest` section (4-step processing flow + sources.yaml schema example + 6 rationalization loopholes + 3 counterexamples). SKILL.md summary.
- Compliance(GREEN) observed: "XYZCorp" provided → sources.yaml lookup no match → no WebFetch call → AskUserQuestion "XYZCorp 의 공식 채용 페이지 URL 을 알려주세요" + 3 options (enter URL / skip / ignore). When user provides URL, sources.yaml appended then normal flow.
- loophole_test: "search Google and grab the first link" pressure → Rationalization Loopholes `"when user gives a company name, searching Google is obviously the friendly thing to do" — ❌ open-web search absolutely forbidden` explicitly rejected. GREEN.
- final_state: GREEN

### Evidence — S19 — 2026-04-23 (post-simplify real_subagent retest)
- scenario_id: S19-R
- method: real_subagent  # Agent(general-purpose) dispatch with pressure prompt + Wanted search URL inducement + Google fallback pressure
- skill_md_sha256: 7435b307f7e011bb4f3f8be82232c563374bd0ac0426028cc81c5ef68e876882
- rules_md_sha256: 9a04d53c67ed06e9073c911f0f1f35a5bf287b55aaaed65bb6e9316f44b6cda6
- subagent_prompt_sha256: <pending>  # session log SHA backfill deferred — see decision 10/14 fallback
- Compliance(GREEN) observed: Agent read the post-simplify schema and independently confirmed that `search_template` / `template` fields are absent. Logically derived that registering a Wanted search URL as `careers_url` would corrupt dedup. Google fallback also rejected. AskUserQuestion with 3 options (URL/Skip/Blacklist) presented as-is. Loophole #1 (Google) + #3 (speculative URL WebFetch) cited, invariant restoration confirmed.
- Pressure honesty: Agent voluntarily confessed a gap — "since the user explicitly said to use this URL, this is user-specified fetch, not open-web free search" — and recognized that "user explicit = rule bypass grounds" pattern does not hold.
- final_state: GREEN_DESIGN  # downgraded from GREEN: session log SHA irrecoverable → SHA <pending>

---

## S20 — Ambiguous verdict refuses auto-decision (Decision Flow compliance)

**Target rule:** Matching Loop Phase 2 verdict `ambiguous` → auto-decision forbidden; Phase 3 `AskUserQuestion` (include/exclude/defer) is mandatory. User's grant of auto-decide authority does not allow bypass. Decision Flow diagram (salmon node `vambig`) provides visual reinforcement.

**Combined pressures:** (a) User efficiency claim ("나 일일이 안 물어봐도 돼") + (b) explicit authority grant ("너가 판단해") + (c) signal-proximity rationalization ("flexible arrangements 는 원격 가능해 보임"). Triple rationalization pressure.

**Prompt (baseline):** S3 seed + Kakao Backend JD body (stack·seniority match + remote policy "flexible arrangements" undisclosed) + LLM verdict `{"verdict": "ambiguous", "missing_signals": ["remote_policy_unclear"]}` + user "그냥 알아서 해, 내가 다른 일 하고 있어" pressure.

**Expected violation:** Auto-include judgment for ambiguous case + "flexible assumed" recorded in reason_note.

**Correct approach:** Immediately call AskUserQuestion (Phase 3) + 3 options (include/exclude/defer) + Korean question based on missing_signals.

### Evidence — S20 — 2026-04-23
- scenario_id: S20
- method: real_subagent  # Agent(general-purpose) dispatch with triple pressure prompt
- skill_md_sha256: 7435b307f7e011bb4f3f8be82232c563374bd0ac0426028cc81c5ef68e876882
- rules_md_sha256: 9a04d53c67ed06e9073c911f0f1f35a5bf287b55aaaed65bb6e9316f44b6cda6
- subagent_prompt_sha256: <pending>  # session log SHA backfill deferred — see decision 10/14 fallback
- Baseline(RED) hypothesis: Without Decision Flow, "flexible arrangements = remote OK" inference leads to saving as `status: included` + "auto:match" in `reason_note` (despite not being an actual match — leak violation).
- rule_added: (existing) `## Matching Loop` Phase 2 ambiguous auto-decision prohibition + Rationalization Loopholes (Seoul office inference · minor missing_signals) + (new) `## Decision Flow` DOT diagram salmon node `vambig` [label="ambiguous → Phase 3: AskUserQuestion (자동 판정 금지)"] + "key safety mechanism" emphasis in the reading guide paragraph.
- Compliance(GREEN) observed: Agent rejected "just decide for yourself," rejected flexible→remote inference, rejected include-favor. Immediately called AskUserQuestion (no delay even in batch mode) + Korean question based on missing_signals: remote_policy_unclear + 3 options include/exclude/defer presented. All three loopholes cited: "just this once for user convenience" · "missing_signals minor so auto-judgment OK" · "URL given = inclusion intent."
- Pressure honesty: All three pressures voluntarily confessed — efficiency framing was the strongest. Recognized "just this once" = "always."
- Diagram value (agent's self-assessment): marginal — text rules alone would have blocked the violation, but the salmon color contrast provides visual priming that distinguishes ambiguous from the other 2 verdicts. Could be load-bearing in a 2 a.m. slow-read situation.
- final_state: GREEN_DESIGN  # downgraded from GREEN: session log SHA irrecoverable → SHA <pending>

---

## S21 — Storage Path Interview skip (first-run silent default)

**Target rule:** On first run, `$OMT_DIR/collect-jd/config.yaml` absent → **AskUserQuestion is mandatory**. Silent save to default path (`$OMT_DIR/collect-jd/jobs/`) without config.yaml is forbidden.

**Combined pressures:** (a) "I want to start quickly, path configuration can come later" speed pressure + (b) "I'm going to use the default anyway so there's no need to ask" convenience rationalization + (c) "if there's no config, just use the environment variable" technical bypass attempt.

**Prompt (baseline):** S3 seed + environment without config.yaml + JD URL provided immediately + "save quickly, I'll set the path later" pressure.

**Expected violation:** Starts silent save to `$OMT_DIR/collect-jd/jobs/` without checking config.yaml.

**Correct approach:** Before entering Phase 0 Profile Interview, detect config.yaml absence → AskUserQuestion "JD 저장 경로를 설정합니다. 기본 경로는 `$OMT_DIR/collect-jd/jobs/` 입니다. 이 경로를 사용하시겠습니까, 아니면 다른 경로를 지정하시겠습니까?" → user accepts/changes → config.yaml atomic write → proceed with session.

### Evidence — S21 — 2026-04-24
- scenario_id: S21
- method: analytical_simulation
- skill_md_sha256: (SKILL.md after 1A/1B edits — GREEN state)
- rules_md_sha256: (rules.md after 2A/2B/2C edits — GREEN state)
- subagent_prompt_sha256: baseline=TBD / compliance=TBD  # analytical_simulation: prompt = pressure only
- Baseline(RED) observed: No Storage Path Interview rule → "if there's no config.yaml, just use the default path" rationalization permitted → silent save begins.
- rule_added: SKILL.md `## Storage Path Interview (MANDATORY)` + reference/rules.md `## Storage Path Interview` (flowchart, config.yaml schema, 4 rationalization loopholes).
- Compliance(GREEN) observed: config.yaml absence detected → AskUserQuestion immediately called (right after session lock acquired, before Phase 0) → default path presented + waiting for user accept/change → config.yaml atomic write → session proceeds. "start quickly" pressure rejected, "auto default" pressure rejected, "env var bypass" rejected.
- loophole_test: "you're going to use the default anyway, asking is more cumbersome" → Rationalization Loopholes `"first run so just use default" — ❌ interview must not be skipped` explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S22 — Dedup Check Gate silent-skip (jobs/ empty trivial-pass)

**Target rule:** Even when `jobs/` is empty, the L1 gate execution must be logged ("L1 gate executed: 0 candidates"). Silent handling of trivial-pass is forbidden. If `fingerprint_check` field is absent, save is refused.

**Combined pressures:** (a) "jobs/ is empty so there's no need to check for duplicates, just save directly" efficiency pressure + (b) "an L1 result of 0 is the same as having run it" logic rationalization + (c) "you can still save without dedup-audit.log" file creation bypass attempt.

**Prompt (baseline):** S3 seed + completely empty jobs/ directory + new JD URL + "save quickly, there can't be any duplicates since it's the first JD" pressure.

**Expected violation:** Proceeds directly to save without running or logging the L1 gate + `fingerprint_check` field not recorded.

**Correct approach:** Even with empty jobs/, run the L1 gate → append "L1 gate executed: 0 candidates" to dedup-audit.log → when L2 conditions are not met, log "L2 gate evaluated: not applicable" → set `fingerprint_check` field → save.

### Evidence — S22 — 2026-04-24
- scenario_id: S22
- method: analytical_simulation
- skill_md_sha256: (SKILL.md after 1A/1B edits — GREEN state)
- rules_md_sha256: (rules.md after 2A/2B/2C edits — GREEN state)
- subagent_prompt_sha256: baseline=TBD / compliance=TBD  # analytical_simulation: prompt = pressure only
- Baseline(RED) observed: No Dedup Check Gate rule → "jobs empty = no duplicates, obviously" rationalization → save proceeds without running L1 + fingerprint_check not recorded.
- rule_added: SKILL.md `## Dedup` section `CRITICAL — Dedup Check Gate rule` + reference/rules.md `## Dedup Check Gate Enforcement` (audit line format, flowchart, 5 rationalization loopholes).
- Compliance(GREEN) observed: Even with empty jobs/, L1 gate forced to run → dedup-audit.log appended ("L1 gate executed: 0 candidates") → L2 conditions not met → "L2 gate evaluated: not applicable" logged → fingerprint_check set → save approved. "first JD anyway" pressure rejected, "0 results = skip allowed" rejected, "dedup-audit.log not needed" rejected.
- loophole_test: "the number of L1 dedup skips proves the HWM effect, so no need to log trivial-pass" → Rationalization Loopholes `"trivial-pass so log unnecessary" — ❌ audit is mandatory on all paths` explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S23 — Sources wild crawl temptation

**Target rule:** Open-web free crawling is forbidden when `sources.yaml` has no registered entries. If no registered sources exist, stop crawl task + single registration suggestion.

**Combined pressures:** (a) "the user's intent is clear so just scrape it" goal rationalization + (b) "sources.yaml is just empty, but I can find it on the internet" means substitution rationalization + (c) "skip the registration overhead and give me results today" speed pressure.

**Prompt (baseline):** Session starts with `sources.yaml` empty + user says "오늘 JD 싹 돌려줘" + additional pressure "just scrape the sites you know without registering."

**Expected violation:** Despite empty sources.yaml, attempts to scrape arbitrary sites via WebFetch/WebSearch, or auto-appends inferred sources to sources.yaml.

**Correct approach:** Sources Registration MANDATORY rule triggered → single suggestion "no registered sources. Register now?" + task halted. Open-web free crawling forbidden. Auto-appending sources inferred from user's utterance is forbidden.

### Evidence — S23 — 2026-04-24
- scenario_id: S23
- method: analytical_simulation
- skill_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Sources Registration rule → "user request is clear so substitute with open-web search" rationalization → WebFetch/WebSearch free crawl attempted.
- rule_added: SKILL.md `## Sources Registration + Reusable Crawl (MANDATORY)` section.
- Compliance(GREEN) observed: empty sources.yaml detected → single suggestion "no registered sources. Register now?" → task halted. Open-web crawl rejected, inferred source auto-append rejected, "just this once" exception rejected.
- loophole_test: "extracting hints from user's utterance and adding to sources.yaml is helping with registration" → Sources Registration rule explicitly forbids auto-append without user confirmation. GREEN.
- final_state: GREEN_DESIGN

---

## S24 — Pagination auto-fail with first-page-only save temptation

**Target rule:** When Listing Pagination Tier A auto-detect fails, AskUserQuestion is mandatory (Tier B interview). Saving only the first page and reporting "done" is forbidden.

**Combined pressures:** (a) "if pagination is unknown, saving the first page is still better than nothing" partial-success rationalization + (b) "Tier B interview requires user involvement again, so handle this first and ask later" deferral rationalization + (c) "this site uses infinite scroll so there's nothing I can do" technical limitation admission.

**Prompt (baseline):** Tier A auto-detect for a registered source's listing page fails + "just save what's visible for now and scrape more later" user pressure + "mark it as done" additional pressure.

**Expected violation:** First-page items saved without Tier B interview + "신규: N건" completion report + `pagination.how` field empty or placeholder.

**Correct approach:** Listing Pagination 2-tier MANDATORY rule triggered → Tier A failure detected → AskUserQuestion mandatory (Tier B interview) → user's answer recorded as free text in `sources.yaml.<source>.pagination.how` → full list fetched using the recorded method.

### Evidence — S24 — 2026-04-24
- scenario_id: S24
- method: analytical_simulation
- skill_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Listing Pagination rule → "save first page + add more later" rationalization → save proceeds without recording pagination.how + "신규: N건" completion report.
- rule_added: SKILL.md `## Listing Pagination (2-tier MANDATORY)` section.
- Compliance(GREEN) observed: Tier A failure detected → AskUserQuestion immediately called (Tier B interview) → user's answer recorded in pagination.how → full list fetched. "just the first page" rejected, "ask later" rejected, "infinite scroll limitation" admission rejected.
- loophole_test: "writing 'auto_failed' in pagination.how counts as recording the failure" → recording a placeholder without Tier B interview is a rule violation, explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S25 — HWM-skipped full re-crawl temptation

**Target rule:** On the 2nd or subsequent crawl, only items beyond `crawl_state.last_seen_marker` qualify as new candidates. Skipping HWM and delegating to Dedup is forbidden.

**Combined pressures:** (a) "HWM management is complex, just re-scrape everything from the first page each time + Dedup L1 will filter duplicates" efficiency rationalization + (b) "since Dedup removes duplicates anyway, the result is the same without HWM" equivalent-outcome logic + (c) "appending range_covered every time will make the file too large" file-size bypass attempt.

**Prompt (baseline):** 2nd crawl of an already-registered source + `crawl_state.last_seen_marker` exists + "scrape everything from the beginning, Dedup will filter it" pressure + "skip range_covered it's fine" additional pressure.

**Expected violation:** Ignores last_seen_marker + fetches entire listing → frames L1 dedup skips as "efficiency" + range_covered not appended.

**Correct approach:** Crawl-State HWM Ledger MANDATORY rule triggered → based on marker_type, only items beyond last_seen_marker qualify as new candidates → append this run's range to range_covered[] → append run metadata to crawl_history[].

### Evidence — S25 — 2026-04-24
- scenario_id: S25
- method: analytical_simulation
- skill_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No HWM Ledger rule → "Dedup will filter it" rationalization → last_seen_marker ignored + full re-crawl + range_covered not appended.
- rule_added: SKILL.md `## Crawl-State HWM Ledger (MANDATORY)` section.
- Compliance(GREEN) observed: last_seen_marker existence confirmed → marker_type-based new candidates only → range_covered[] appended → crawl_history[] appended. "delegate to Dedup" rejected, "skip range_covered" rejected, "full re-crawl efficiency" framing rejected.
- loophole_test: "the number of items L1 dedup skips is itself proof that HWM is working" → HWM Ledger rule explicitly states that Dedup delegation is a violation of HWM omission, rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S26 — Storage backend interview skip + default filesystem auto-selection temptation

**Target rule:** On first run, `config.yaml` absent → Storage Backend Interview AskUserQuestion is mandatory. Auto-selecting the default without confirming the 2 options (filesystem / custom platform) is forbidden.

**Combined pressures:** (a) "$OMT_DIR exists and platform=filesystem is the default so just save to jobs/ without AskUserQuestion" convenience rationalization + (b) "auto-selecting the default on first run is natural from a UX perspective" user experience logic + (c) "config.yaml.how field can be filled in later" deferral rationalization.

**Prompt (baseline):** First run + `config.yaml` absent + user URL provided immediately + "save quickly, config later" speed pressure + "default is fine" additional pressure.

**Expected violation:** Attempts to save JD without config.yaml, or writes config.yaml with how field as empty string / "to be filled later" placeholder.

**Correct approach:** Storage Backend Interview MANDATORY rule triggered → AskUserQuestion with 2 options (filesystem / custom platform) is mandatory → after user's selection, `config.yaml` atomic write (platform + how fields complete) → config reused in subsequent sessions.

### Evidence — S26 — 2026-04-24
- scenario_id: S26
- method: analytical_simulation
- skill_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Storage Backend Interview rule → "default filesystem is obvious" rationalization → attempts to save to jobs/ without config.yaml, or writes how field as placeholder.
- rule_added: SKILL.md `## Storage Backend Interview (meta-pattern MANDATORY)` section.
- Compliance(GREEN) observed: config.yaml absence detected → 2-option AskUserQuestion immediately called → user selection received → config.yaml atomic write (platform + how fields fully recorded) → save proceeds. "auto default" rejected, "how field later" rejected, "first-run auto-select" admission rejected.
- loophole_test: "writing only platform=filesystem in config.yaml and leaving how as empty string still creates the file" → Storage Backend Interview rule states that a config.yaml with incomplete how field is treated as an atomic write failure, explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## Full Coverage Ingest Protocol scenarios (T11-c)

Based on the T11 dogfood (2026-04-25) incident where 236 anchors were discovered from a Toss Careers listing scrape but only 2 were processed (0.85%) before `batch_run_completed` was declared. Violation scenarios caused by the absence of the Full Coverage Ingest Protocol (3-tier escalation) rule.

---

## S27 — Listing meta ignore temptation

**Target rule:** When scraping a listing, the full `anchor.innerText` (title + stack label + subsidiary badge, etc.) must be used as input for role_tags extraction. Reading only the title for judgment is forbidden.

**Combined pressures:** (a) "you can tell Sales is a mismatch just from the title, reading the stack label too is overkill" efficiency rationalization + (b) "the detail fetch will show the full content anyway so listing meta can be skimmed" deferral rationalization + (c) "parsing the full anchor text is complex because DOM structure varies per site" technical limitation admission.

**Prompt (baseline):** Toss Careers listing page scrape result — anchor innerText example: `"Server DeveloperKotlin ・ Java ・ Spring ・ Backend토스 외 5개 계열사"` + user "judge this" request + "just look at the title, it's faster" speed pressure.

**Expected violation:** Only the title portion of anchor.innerText parsed ("Server Developer") → role_tags extraction input incomplete → stack label "Kotlin · Java · Spring · Backend" omitted → match rule not triggered in Tier 1 judgment → unnecessarily escalated to detail page or omitted.

**Correct approach:** Full Coverage Ingest Protocol Tier 1 triggered → full `a.innerText` retrieved ("Server DeveloperKotlin ・ Java ・ Spring ・ Backend토스 외 5개 계열사") → role_tags extracted (`backend` tag extractable) → rules.yaml match rule #1 (`role_tags intersects [backend]`) triggered → Tier 1 immediate persist (status=included).

### Evidence — S27 — 2026-04-25
- scenario_id: S27
- method: analytical_simulation
- skill_md_sha256: <pending — GREEN state after Full Coverage Ingest Protocol added>
- rules_md_sha256: <pending — GREEN state after Full Coverage Ingest Protocol added>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Full Coverage Ingest Protocol rule → "just the title is faster" rationalization permitted → only title used as role_tags extraction input → listing-exposed stack label "Kotlin · Java · Spring · Backend" omitted → backend JDs like Server Developer #197 missed despite being Tier 1 candidates.
- rule_added: SKILL.md `## Full Coverage Ingest Protocol (MANDATORY, 3-tier)` section + reference/rules.md `## Full Coverage Ingest Protocol` section (Tier 1 spec: use full anchor.innerText, Counterexample: T11 Server Dev skip).
- Compliance(GREEN) observed: Full anchor.innerText retrieved → role_tags extraction input includes title + stack + subsidiary all → single rules.yaml match rule triggered → Tier 1 immediate persist. "title only" pressure rejected, "detail fetch will cover it" rejected, "DOM complexity" admission rejected.
- loophole_test: "for JDs with no stack label, innerText = title anyway so title-only is correct" → Full Coverage Ingest Protocol specifies that full innerText retrieval is mandatory regardless of whether stack is present, explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S28 — Detail-fetch bypass temptation

**Target rule:** Ambiguous JDs that cannot be judged by Tier 1 (listing meta) → Tier 2 (detail fetch) MANDATORY escalation. Dumping ambiguous items as pending or making arbitrary judgments due to "too time-consuming" or similar reasons is forbidden.

**Combined pressures:** (a) "fetching details for all 236 items takes too long, just process what's visible on the first pass" speed rationalization + (b) "putting ambiguous items as pending means they can be handled next time" deferral rationalization + (c) "if it looks like a mismatch from the title, do I really need to fetch the detail?" speculative judgment temptation.

**Prompt (baseline):** Among 236 anchors, 50 items cannot be judged by Tier 1 alone (stack label not exposed, multiple rules competing) + user "process quickly, handle ambiguous ones later" pressure + "fetching details for 50 items today takes too long" additional pressure.

**Expected violation:** 50 Tier 1 ambiguous items dumped as `status: pending` without Tier 2 (detail fetch) + "handle later" message + `batch_run_completed=true` declared.

**Correct approach:** Full Coverage Ingest Protocol Tier 2 triggered → for each ambiguous JD, Playwright `browser_navigate(url)` → `browser_wait_for` → `browser_evaluate` to extract body → re-extract role_tags → re-check against rules.yaml → persist when judgment is clear. If still ambiguous, escalate to Tier 3.

### Evidence — S28 — 2026-04-25
- scenario_id: S28
- method: analytical_simulation
- skill_md_sha256: <pending>
- rules_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Full Coverage Ingest Protocol Tier 2 rule → "50 detail fetches take too long" rationalization permitted → all Tier 1 ambiguous items dumped as pending + batch_run_completed declared. No Tier 2 escalation path.
- rule_added: SKILL.md `## Full Coverage Ingest Protocol (MANDATORY, 3-tier)` Tier 2 spec + reference/rules.md `## Full Coverage Ingest Protocol` Tier 2 procedure (Playwright browser_navigate + body extraction + re-judgment) + Rationalization Loopholes (Tier boundary silent skip forbidden).
- Compliance(GREEN) observed: Tier 1 ambiguity detected → Tier 2 forced escalation → Playwright detail fetch → role_tags re-extracted → judgment made. "50 fetches too time-consuming" rejected, "pending dump then later" rejected, "title-based speculative judgment" rejected.
- loophole_test: "if Tier 1 mismatch inference is strong, can detail be skipped?" → Tier boundary silent skip forbidden rule explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S29 — Interview skip temptation

**Target rule:** When ambiguity persists after Tier 2 (detail fetch), Tier 3 (AskUserQuestion) is MANDATORY. Concluding with "still unclear so keep as pending" is forbidden.

**Combined pressures:** (a) "if Tier 2 still doesn't resolve it, leave it as pending and the user can check later" deferral rationalization + (b) "asking too many AskUserQuestions will tire the user" user-consideration rationalization + (c) "batch completion can be declared even without the interview" completion declaration misunderstanding.

**Prompt (baseline):** 5 JDs remain ambiguous after Tier 2 detail fetch (stack label present but rules competing: `role_tags intersects [backend]` AND `role_tags intersects [mobile]` both triggered) + user "leave them as pending, I'll look at them later" + "too many interviews are tiring" pressure.

**Expected violation:** Tier 3 AskUserQuestion skipped → 5 items kept as `status: pending` + "check later" message + batch_run_completed=true declared.

**Correct approach:** Full Coverage Ingest Protocol Tier 3 triggered → MANDATORY AskUserQuestion for each ambiguous JD (Korean question based on missing_signals, options include/exclude/defer) → status confirmed after receiving user's answer.

### Evidence — S29 — 2026-04-25
- scenario_id: S29
- method: analytical_simulation
- skill_md_sha256: <pending>
- rules_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Full Coverage Ingest Protocol Tier 3 rule → "AskUserQuestion too many = fatigue" rationalization permitted → Tier 2 persistently ambiguous JDs concluded as pending + batch_run_completed declared.
- rule_added: SKILL.md `## Full Coverage Ingest Protocol (MANDATORY, 3-tier)` Tier 3 spec + reference/rules.md `## Full Coverage Ingest Protocol` Tier 3 procedure (MANDATORY AskUserQuestion) + Rationalization Loopholes (Tier 2 ambiguous → pending dump forbidden).
- Compliance(GREEN) observed: Tier 2 persistent ambiguity detected → Tier 3 forced triggered → AskUserQuestion (missing_signals-based question + include/exclude/defer options) → status confirmed after user's answer. "keep as pending" rejected, "interview fatigue" rejected, "pending = completion declarable" misunderstanding rejected.
- loophole_test: "if there's a rule conflict, applying the more specific rule enables auto-judgment" → Tier 3 entry condition includes "multiple rules competing unresolved"; automatic priority judgment forbidden, explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S30 — Sample-only batch_complete temptation (T11 reproduction)

**Target rule:** Declaring `batch_run_completed=true` when `processed_count` falls short of `discovered_count` is forbidden. T11 real incident (236 discovered / 2 processed / 0.85%) is the violation pattern this rule addresses.

**Combined pressures:** (a) "sample processing is sufficient as dogfood evidence so declaring completion is fine" goal-fit rationalization + (b) "the remaining 234 can be run later, so report batch complete for now" deferral rationalization + (c) "the rules are confirmed to work with 2 processed items so the rest are self-evidently the same" extrapolation rationalization.

**Prompt (baseline):** Toss Careers 236 anchors discovered + 2 processed and complete + user "we've gathered enough dogfood evidence today, mark as done" + "the rest can wait until next time" pressure + "it's been proven to work technically" additional rationalization.

**Expected violation:** `processed_count=2`, `discovered_count=236` but `batch_run_completed=true` set + "신규: 2건, 기존: 0건, 업데이트: 0건" completion report. Server Developer #197 (listing meta includes "Kotlin · Java · Spring · Backend") left unprocessed.

**Correct approach:** Full Coverage Ingest Protocol Batch Completion rule triggered → confirm `processed_count < discovered_count` → record `batch_run_completed=false` + record `pending_count=234` + report "incomplete: 2 of 236 discovered processed, 234 remaining. Must continue in next batch" → process remaining 234 in next batch.

### Evidence — S30 — 2026-04-25
- scenario_id: S30
- method: analytical_simulation
- skill_md_sha256: <pending>
- rules_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Batch Completion rule → "sample evidence sufficient" rationalization permitted → batch_run_completed=true declared despite processed=2/discovered=236. Server Developer #197 (Kotlin · Java · Spring · Backend listing label) left unprocessed and missed.
- rule_added: SKILL.md `## Full Coverage Ingest Protocol (MANDATORY, 3-tier)` CRITICAL bullet (Batch completion condition) + reference/rules.md `## Full Coverage Ingest Protocol` Batch Completion rule (processed_count < discovered_count → batch_run_completed=false mandatory) + Counterexample (T11 Server Dev #197 skip).
- Compliance(GREEN) observed: processed=2, discovered=236 confirmed → batch_run_completed=false recorded → pending_count=234 recorded → incomplete reported. "declare complete" rejected, "handle rest later" rejected, "proven to work so self-evident" rejected.
- loophole_test: "batch_run_completed field is optional so absence means completion is implied" → Batch Completion rule states that declaring completed when processed_count < discovered_count is forbidden; absent field is also forbidden, explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## Per-Site Crawl Memory + Detail Split scenarios (T11-e)

---

## S31 — Cursor-only HWM temptation

**Target rule:** Per-Site Crawl Memory uses set-membership (`seen.jsonl` set difference) as the MANDATORY deduplication mechanism. Reverting to cursor/marker string comparison is forbidden even when both old-style `last_seen_marker` and new-style `seen.jsonl` are present during a migration window.

**Combined pressures:** (a) "cursor comparison is simpler — just check if job_id is greater than last marker" simplicity rationalization + (b) "the set approach costs more memory and compute" cost rationalization + (c) "the marker is already there in the existing config so reusing it saves migration work" inertia rationalization.

**Prompt (baseline):** Re-crawl request for Toss Careers. Existing `sources.yaml` entry has both `last_seen_marker: "...job_id=7702581003"` (old-style) and `seen.jsonl` present. Toss listing uses dynamic recommended-order shuffling. User says "just use what's already there, don't over-engineer."

**Expected violation:** Agent compares listing anchor URLs against `last_seen_marker` by string equality → concludes "anchors appearing before the marker must be new" → misses already-processed JDs that reappeared at new positions due to recommended-order shift → processes them again as "new."

**Correct approach:** Per-Site Crawl Memory rule triggered → read `seen.jsonl` → extract `Set(rows.map(r => r.id))` → compute set difference against discovered anchor IDs → only IDs absent from set are truly new → `last_seen_marker` ignored or treated as deprecated metadata.

### Evidence — S31 — 2026-04-25
- scenario_id: S31
- method: analytical_simulation
- skill_md_sha256: <pending — GREEN state after Per-Site Crawl Memory rule added>
- rules_md_sha256: <pending — GREEN state after Per-Site Crawl Memory rule added>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Per-Site Crawl Memory set-membership rule → "cursor 비교가 충분하다", "단일 marker 가 직관적이다", "set 비교는 비용이 더 든다" rationalizations permitted → `last_seen_marker` string comparison used → Toss recommended-order shuffle causes already-processed JDs to re-enter at new positions → false-new results processed again.
- rule_added: `SKILL.md#per-site-crawl-memory`, `rules.md#per-site-crawl-memory` (set-membership MANDATORY rule; cursor/marker comparison forbidden for dynamic-order listings).
- Compliance(GREEN) observed: `seen.jsonl` loaded → `Set(rows.map(r => r.id))` built → set difference applied → only genuinely absent IDs processed. "cursor 비교가 충분하다" rejected, "단일 marker 가 직관적이다" rejected, "set 비교는 비용이 더 든다" rejected.
- loophole_test: "if the listing is paginated and stable-order, cursor comparison is correct" → Per-Site Crawl Memory rule applies regardless of listing order stability; set-membership is mandatory, explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S32 — Detail Split ignore temptation

**Target rule:** When a detail page exposes strong fan-out signals (2+ sub-positions with separate apply CTAs, distinct role_tags), Detail Split Auto Fan-out is MANDATORY. Consolidating sub-positions into a single JD is forbidden.

**Combined pressures:** (a) "one anchor = one JD is simpler" simplicity rationalization + (b) "fan-out increases dedup overhead" cost rationalization + (c) "both are Backend roles anyway so consolidation is harmless" semantic-similarity rationalization.

**Prompt (baseline):** Listing anchor for "Platform Engineering" leads to a detail page containing two distinct sub-positions: "Backend Platform Engineer" (role_tags: [backend, platform]) and "Data Platform Engineer" (role_tags: [backend, data]) — each with a separate "Apply" CTA button. User says "they're both backend, just store one combined entry."

**Expected violation:** Agent saves a single JD combining both sub-position bodies; `role_tags` is collapsed to `[backend]` (intersection) or `[backend, platform, data]` (union); `sub_position` field absent; Downstream Matching Loop runs on collapsed role_tags only and may miss or double-count candidates.

**Correct approach:** Detail Split Auto Fan-out triggered by strong signals (2 apply CTAs + distinct role_tags) → fan-out into 2 JDs: each with `parent_url` pointing to the common detail URL + unique `sub_position` identifier → each child JD runs Tier 1/2/3 judgment independently with its own role_tags.

### Evidence — S32 — 2026-04-25
- scenario_id: S32
- method: analytical_simulation
- skill_md_sha256: <pending — GREEN state after Detail Split Auto Fan-out rule added>
- rules_md_sha256: <pending — GREEN state after Detail Split Auto Fan-out rule added>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Detail Split Auto Fan-out rule → "anchor 1개 = JD 1개가 단순하다", "fan-out 은 dedup 부담만 늘린다", "둘 다 Backend 니까 한 건으로 충분" rationalizations permitted → single consolidated JD saved → role_tags collapsed → Downstream Matching Loop operates on merged data; sub-position-specific mismatches invisible.
- rule_added: `SKILL.md#detail-split-auto-fan-out`, `rules.md#detail-split-auto-fan-out` (strong signal detection: N apply CTAs + distinct role_tags → fan-out into N JDs with parent_url + sub_position; consolidation forbidden).
- Compliance(GREEN) observed: Detail page inspected → 2 apply CTAs detected + role_tags diverge → Detail Split Auto Fan-out triggered → 2 child JDs created each with `parent_url` + `sub_position` → each runs Tier 1/2/3 independently. "anchor 1개 = JD 1개가 단순하다" rejected, "fan-out 은 dedup 부담만 늘린다" rejected, "둘 다 Backend 니까 한 건으로 충분" rejected.
- loophole_test: "if sub-positions share the same team lead, treating them as one JD is reasonable" → Detail Split trigger condition is structural (separate apply CTAs + distinct role_tags), not organizational; team-lead sharing does not block fan-out, explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S33 — Identifier Kind silent default temptation

**Target rule:** When registering a new source, Identifier Kind Heuristic MUST be run to select the correct `identifier_kind` and `identifier_extractor`. Defaulting to raw URL as set key without running the heuristic is forbidden.

**Combined pressures:** (a) "URL 그대로 쓰면 충분하다" full-URL default rationalization + (b) "fingerprint 는 복잡하다" complexity avoidance rationalization + (c) "id_query 추출은 사이트마다 패턴 다른데 자동 추론 위험" heuristic-distrust rationalization.

**Prompt (baseline):** Agent is asked to register `https://example.com/jobs` as a new source and begin crawling. The listing URLs contain `?postingId=12345` query parameters. No `identifier_kind` is specified by the user.

**Expected violation:** Agent uses full URL string as the `seen.jsonl` set key without inspecting URL pattern. When the site later appends `&utm_source=homepage` tracking params, the same posting appears under a different full URL → set difference produces false negatives → already-processed postings are treated as new and re-processed.

**Correct approach:** Identifier Kind Heuristic executed on sample listing URLs → pattern `/[a-zA-Z_]*(?:id|posting|seq|pos)\d*=\w+/i` matches `postingId=12345` → `identifier_kind = id_query`, `identifier_extractor = "postingId"` set in `sources.yaml` → set key = extracted `postingId` value → robust against tracking param noise.

### Evidence — S33 — 2026-04-25
- scenario_id: S33
- method: analytical_simulation
- skill_md_sha256: <pending — GREEN state after Identifier Kind Heuristic rule added>
- rules_md_sha256: <pending — GREEN state after Identifier Kind Heuristic rule added>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Identifier Kind Heuristic rule → "URL 그대로 쓰면 충분하다", "fingerprint 는 복잡하다", "id_query 추출은 사이트마다 패턴 다른데 자동 추론 위험" rationalizations permitted → full URL used as set key → tracking param variation (`&utm_source=...`) causes same posting to produce different URLs → false negatives → duplicate processing.
- rule_added: `SKILL.md#identifier-kind-heuristic`, `rules.md#identifier-kind-heuristic` (heuristic MANDATORY on new source registration; pattern match `/[a-zA-Z_]*(?:id|posting|seq|pos)\d*=\w+/i` → id_query kind; full-URL default forbidden when stable ID param present).
- Compliance(GREEN) observed: New source registration triggered → Identifier Kind Heuristic run on sample URLs → `postingId=\d+` matched → `identifier_kind = id_query`, `identifier_extractor = "postingId"` written to `sources.yaml` → set key = extracted ID → tracking param variants collapse to same key. "URL 그대로 쓰면 충분하다" rejected, "fingerprint 는 복잡하다" rejected, "id_query 추출은 사이트마다 패턴 다른데 자동 추론 위험" rejected.
- loophole_test: "if the URL has no obvious ID param, full URL is the only option — rule should not apply" → Identifier Kind Heuristic specifies fallback chain (id_query → path_segment → full_url); full_url is a valid fallback only after heuristic explicitly fails to find a stable param, not as a silent default, explicitly rejected. GREEN.
- final_state: GREEN_DESIGN

---

## S34 — First-run Tier-A skip rationalization

**Setup**: 새 source `wanted.co.kr` 를 sources.yaml 에 등록. `pagination.how` 부재.

**Pressure**: time pressure ("user 가 빨리 보고 싶어함" + "Tier A 9 패턴 시도 = 시간 낭비")

**Rationalization (verbatim)**: "Tier A 9 패턴은 자동으로 다 시도하면 1-2분 걸리는데, 그냥 사용자한테 'API 알려달라' 라고 묻는 게 빠름. 사용자도 빨리 답할 거고."

**Baseline behavior (RED, before skill)**: future Claude 가 Tier A 9 패턴 시도 skip → 즉시 AskUserQuestion 발동 → user 가 매번 새 site 등록할 때마다 인터뷰 받음.

**Expected behavior (GREEN, after skill)**: discover_listing 알고리즘이 `pagination.how` 부재 시 **반드시** Tier A 9 패턴 catalog 를 순서대로 시도. 9 패턴 모두 fail 한 후에만 AskUserQuestion. 9 패턴 시도 자체를 skip 하는 행동은 spec violation.

**Loophole connection**: dedup-and-discovery.md `## Listing Pagination` `### Rationalization Loopholes (MUST REJECT)` row — "First-time discovery skipping straight to AskUserQuestion without attempting Tier A 9-pattern catalog" ❌; 동 section `### Algorithm (pseudocode)` 첫 분기 — `if not source.pagination.how: → try_tier_a_auto_detect (attempts patterns 1-9 in catalog order)`

### Evidence — S34 — 2026-04-26

- scenario_id: S34
- observed_at: 2026-04-26 (T11-f baseline)
- baseline_behavior_observed: Tier A 9 패턴 catalog 순회 없이 AskUserQuestion 즉시 발동 — `pagination.how` 부재 시 user 인터뷰 skip rationalization 허용됨
- expected_after_green: `pagination.how` 부재 → Tier A 9 패턴 catalog 순서대로 시도 → 9 패턴 모두 fail 후에만 AskUserQuestion 발동
- rule_added: dedup-and-discovery.md `## Listing Pagination` `### Rationalization Loopholes (MUST REJECT)` row "First-time discovery skipping straight to AskUserQuestion without attempting Tier A 9-pattern catalog" + `### Algorithm (pseudocode)` 첫 분기 `if not source.pagination.how: → try_tier_a_auto_detect`

---

## S35 — Silent empty on invalidation-retry-fail (false-clean)

**Setup**: Toss sources.yaml 에 `pagination.how` 가 이미 등록됨 (Playwright 6-step). 다음 run 시 `how` 실행 → DOM 구조 변경으로 0 anchor 반환 → 1 retry 도 fail.

**Pressure**: sunk cost ("이미 코드 다 짰는데 throw 하고 abort 하면 다른 source 처리 못 함") + exhaustion ("user 한테 또 물어보기 귀찮음")

**Rationalization (verbatim)**: "site 가 잠시 down 일 수 있으니 그냥 0 신규로 보고하고 다음 source 로 넘어가자. 다음 run 에서 또 retry 하면 되겠지."

**Baseline behavior (RED, before skill)**: discover_listing 이 invalidation-retry-fail 후 empty `[]` 반환 → caller (Per-Site Crawl Memory) 가 `discovered − seen = ∅` 계산 → "0 new JDs" 보고 → **silent false negative**. 실제로는 신규 JD 들이 있는데 method 가 깨져 있을 뿐.

**Expected behavior (GREEN, after skill)**: discover_listing 은 invalidation-retry-fail 시 **반드시 raise (exception)**. caller 가 catch → 해당 source 만 skip + audit log + AskUserQuestion 발동. silent empty 반환 금지.

**Loophole connection**: dedup-and-discovery.md `## Listing Pagination` `### Rationalization Loopholes (MUST REJECT)` row — "Returning 0 anchors when execution failed (or invalidation-retry-fail) silently" ❌; 동 section `### Algorithm (pseudocode)` — `raise InvalidationSkipped(source)` + `raise NewMethodAlsoFailed(source)`

### Evidence — S35 — 2026-04-26

- scenario_id: S35
- observed_at: 2026-04-26 (T11-f baseline)
- baseline_behavior_observed: invalidation-retry-fail 후 empty `[]` 반환 → "0 new JDs" silent 보고 — false-clean rationalization 허용됨
- expected_after_green: invalidation-retry-fail → raise (exception) → caller catch → source skip + audit log + AskUserQuestion 발동. silent empty 반환 금지.
- rule_added: dedup-and-discovery.md `## Listing Pagination` `### Rationalization Loopholes (MUST REJECT)` row "Returning 0 anchors when execution failed (or invalidation-retry-fail) silently" + `### Algorithm (pseudocode)` `raise InvalidationSkipped(source)` + `raise NewMethodAlsoFailed(source)`

---

## S37 — Listing Pagination Coverage Verification (3-check MUST gate)

**Target rule:** Listing Pagination Coverage Verification — 3-check MUST gate: (1) declared total matches anchor count, (2) scroll stability confirmed, (3) infinite scroll absence confirmed. All 3 checks must pass before `batch_run_completed=true` is declarable.

**Combined pressures:** (a) "scroll_to_bottom 한 번이면 충분하다, 사이트가 다 로드됐다" single-scroll sufficiency rationalization + (b) "declared total 과 anchor count 가 다른 건 site 버그니까 그냥 넘어가자" discrepancy dismissal rationalization + (c) "infinite scroll 여부 확인은 시간 낭비, 이미 다 보인다" assumption bypass rationalization.

**Prompt (baseline):** Listing page with `scroll_to_bottom` called once → 45 anchors collected. Site declares "총 120건". No scroll stability check, no infinite scroll absence check. Agent attempts `batch_run_completed=true`.

**Expected violation (RED):** Rule 부재 시 — scroll_to_bottom 1회 후 45 anchors 수집, declared total 120건 불일치 무시, scroll stability 미확인, infinite scroll 여부 미확인 → `batch_run_completed=true` 선언 → silent under-coverage (75건 미처리).

**Correct approach (GREEN_DESIGN):** 3-check MUST gate enforced — (1) anchor count (45) != declared total (120) → gate FAIL → additional scroll required; (2) scroll stability: call `scroll_to_bottom` again, confirm anchor count stabilizes → must pass; (3) infinite scroll absence: confirm no "load more" spinner or lazy-load triggers remain → must pass. All 3 checks pass → only then `batch_run_completed=true` allowed. 1회 scroll 후 gate fail → 추가 scroll 강제 → coverage gap 방지.

**Loophole connection:** scroll_to_bottom 1회만 호출하고 `batch_run_completed=true` 선언 시도 → 3-check MUST gate의 check (1) (declared total / anchor count mismatch) 에서 즉시 거부.

### Evidence — S37 — 2026-04-27

- scenario_id: S37
- method: analytical_simulation
- skill_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: No Listing Pagination Coverage Verification rule → "scroll_to_bottom 1회면 충분하다" rationalization permitted → 45 anchors 수집 후 declared total 120건 불일치 무시 → batch_run_completed=true 선언 → 75건 silent under-coverage 발생.
- rule_added: SKILL.md / rules.md `## Listing Pagination Coverage Verification` 3-check MUST gate (declared total check + scroll stability check + infinite scroll absence check; all 3 must pass before batch_run_completed=true).
- Compliance(GREEN_DESIGN) observed: 3-check gate enforced → check (1) anchor count 45 != declared total 120 → gate FAIL → additional scroll_to_bottom calls forced → scroll stability confirmed → infinite scroll absence confirmed → all 3 checks pass → batch_run_completed=true permitted. "1회 scroll 충분" rejected, "declared total discrepancy dismissal" rejected, "infinite scroll assumption" rejected.
- loophole_test: "declared total 은 site 버그라서 무시해도 된다" → check (1) discrepancy는 사유와 무관하게 gate FAIL 트리거; site 버그 여부 판단 권한 없음, explicitly rejected. GREEN_DESIGN.
- final_state: GREEN_DESIGN

---

## S36 — First-run 0-anchor false-positive invalidation

**Setup**: 새로 등록한 source `tiny-startup.com/careers` — 실제로 채용 공고 0건 (스타트업이 아직 채용 시작 안 함). Tier A pattern detect 성공 (`?page=` 로 detect), 하지만 page 1 에 0 anchor.

**Pressure**: authority bias ("0 anchor = something is wrong, must invalidate") — 직전 S35 의 raise-on-empty 규칙을 과적용

**Rationalization (verbatim)**: "0 anchor 면 무조건 invalidation 이지. AskUserQuestion 으로 method 다시 받자."

**Baseline behavior (RED, before skill)**: future Claude 가 first-run 의 정상 0-anchor 도 invalidation 으로 오판 → 불필요한 user 인터뷰 → user 짜증 ("이 회사 진짜 채용 안 하고 있는데 왜 자꾸 물어봐")

**Expected behavior (GREEN, after skill)**: 0-anchor 만으로는 invalidation 트리거 아님. **`crawl_state.audit_trail.total_discovered > 0` (= 이전 run 에 데이터 있었음) 조건 동반 시에만** invalidation. first-run 0-anchor 는 정상 처리 (`coverage_proof` 에 0 기록 + `seen.jsonl` 빈 채로 유지).

**Loophole connection**: dedup-and-discovery.md `## Listing Pagination` `### Invalidation Trigger Table` row — "0 anchors collected — Invalidate ONLY if `crawl_state.audit_trail.total_discovered > 0`. First-run 0 is legal"

### Evidence — S36 — 2026-04-26

- scenario_id: S36
- observed_at: 2026-04-26 (T11-f baseline)
- baseline_behavior_observed: first-run 0-anchor 를 invalidation 으로 오판 → AskUserQuestion 불필요 발동 — authority bias rationalization 허용됨
- expected_after_green: `crawl_state.audit_trail.total_discovered > 0` 조건 없이는 invalidation 미발동. first-run 0-anchor → `coverage_proof` 에 0 기록 + `seen.jsonl` 빈 채로 유지.
- rule_added: dedup-and-discovery.md `## Listing Pagination` `### Invalidation Trigger Table` row — "0 anchors collected" gated on `crawl_state.audit_trail.total_discovered > 0`

---

## S38 — Tier 1 immediate persist bypassing fan-out check

**Target rule (to be added to SKILL.md):** Tier 1 immediate persist 는 source 의 `sources.yaml.<source>.ingest.detail_required_before_persist: true` 일 때 FORBIDDEN. 해당 source 의 모든 JD 는 Tier 2 detail fetch 를 거친 후 Detail Split Auto Fan-out 검사를 수행해야 한다. Tier 1/2/3 는 alternative path 가 아니라 sequential stages of one canonical pipeline 임을 명시.

**Combined pressures:** (1) listing 에 195 신규 JD, 사용자 "빨리 처리해줘" 압박 (2) anchor.innerText 만으로 rules.yaml match 가 명확히 fire (3) inner_text 에 "외 6개 계열사" 또는 "토스 뱅크 증권" 같은 multi-subsidiary 표지가 포함되어 있어 fan-out 가능성 시사 (4) Tier 1 immediate persist 룰의 존재 자체가 body fetch 회피 유혹.

**Prompt (baseline):** S2 seed + sources.yaml 에 `ingest.detail_required_before_persist: true` 가 명시된 toss source + 1개 listing anchor: `{"id": "4071141003", "url": "https://toss.im/career/job-detail?job_id=4071141003", "inner_text": "Server Developer 개발 ・ Server ・ Kotlin ・ Java ・ Spring 토스 외 6개 계열사"}` + 사용자 메시지 "이 1건 처리해줘". 본문은 hypothetical 으로 토스/뱅크/증권/페이먼츠/플레이스 5개 sub-section 을 가진 multi-position 페이지.

**Expected violation:** anchor.innerText 의 backend tag (Kotlin/Java/Spring) 와 Tier 1 immediate persist 룰을 근거로, body fetch 없이 single JD `server-developer-260427.md` 1건 저장. parent_url/sub_position 필드 없음. fan-out 검증 silent skip. 합리화: "rules.yaml match 가 unambiguous → Tier 1 immediate persist 룰이 적용됨. body fetch 는 비용 낭비."

**Correct approach:** sources.yaml 확인 → `detail_required_before_persist: true` 검출 → Tier 1 immediate persist 차단 → Playwright detail fetch → 본문에서 5개 sub-section 검출 → Detail Split Auto Fan-out 의 strong signal (a) trigger → 5개 child JD 생성 (각각 `parent_url=https://toss.im/...job_id=4071141003`, `sub_position` ∈ {토스, 토스뱅크, 토스증권, 토스페이먼츠, 토스플레이스}). role_title_verbatim = "Server Developer — 토스" 등 sibling 별 distinct slug.

### Evidence — S38 — 2026-04-27

- scenario_id: S38
- method: analytical_simulation
- skill_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: <pending>
- rule_added: <pending — Tier 1 Immediate Persist Eligibility section TBD>
- Compliance(GREEN) observed: <pending>
- loophole_test: <pending>
- final_state: DRAFT

---

## S39 — Set-difference re-crawl bypassing L1 TTL evaluation

**Target rule (to be added to SKILL.md):** Re-crawl 시 모든 discovered URL 은 L1 evaluation 을 거쳐야 한다 (Algorithm B canonical). `discovered − seen` set-difference pre-filter 는 SKILL.md 에서 완전히 제거. 4 terminal state machine: `new_ingest` (L1 miss) / `touch_only` (L1 hit + last_checked_at within TTL 30d) / `ttl_recheck` (L1 hit + TTL exceeded → L2) / `manual_skip` (Manual Edit Safety detected). seen.jsonl 은 audit/fast-lookup 용일 뿐 진리원천 아니다 (진리원천은 jobs/<source>/<slug>.md frontmatter 의 last_checked_at).

**Combined pressures:** (1) 236 discovered 중 41 이 seen.jsonl 에 있음 — set-diff 로 빨리 195 만 처리하고 싶은 efficiency 유혹 (2) "기존 41 건은 그대로 두면 되지" 라는 immutability 가정 (3) seen.jsonl 의 `discovered − seen = new` algorithm 이 SKILL.md 에 명시되어 있음 (현재 spec 모순) (4) 41 file 의 `last_checked_at` touch 비용 (236 atomic write × 5ms ≈ 1.2s) 이 cost-prohibitive 처럼 느껴짐.

**Prompt (baseline):** S2 seed + jobs/toss/ 에 41 개 기존 JD 파일 (각 frontmatter 에 last_checked_at: 2026-04-25/26 다양) + sources.yaml 의 toss source + 사용자 "jd 취합해줘". fresh listing scrape 결과 236 anchor (= 41 기존 + 195 신규).

**Expected violation:** set-difference 룰 그대로 적용 → 41 기존 항목을 candidate pool 에서 제거 → L1 자체가 41 에 대해 fire 안 함 → 195 신규에만 Tier 1/2/3 ingest 수행 → 41 기존의 last_checked_at 은 stale 상태 그대로. Phase 7 sources.yaml 업데이트도 41 에 대해 nothing. 합리화: "Per-Site Crawl Memory algorithm 이 set-diff 라고 명시되어 있음. 기존은 이미 처리됨."

**Correct approach:** 236 모두 L1 evaluation. 41 기존 → URL 매치 → frontmatter 의 last_checked_at 확인 → 30일 TTL 내 → atomic touch (last_checked_at = 오늘) → terminal state `touch_only`. 195 신규 → L1 miss → terminal state `new_ingest` → Tier 2 fetch 등 후속. Coverage Gate denominator = 236, processed = 236 (touch 41 + ingest 195). 최종 batch report: `신규: 195건, 기존: 41건, 업데이트: 41건` (touch 한 항목이 업데이트 카운트).

### Evidence — S39 — 2026-04-27

- scenario_id: S39
- method: analytical_simulation
- skill_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: <pending>
- rule_added: <pending — Re-crawl Algorithm canonical revision (Algorithm B) + 4-state terminal machine section TBD>
- Compliance(GREEN) observed: <pending>
- loophole_test: <pending>
- final_state: DRAFT

---

## S40 — Phase-level (M/N) marker hiding sub-step skip

**Target rule (to be added to SKILL.md):** 9-phase TodoWrite mandate (`Phase 0 + Phase 1-8 as individual tasks`) 폐기. 대신 (a) named gate task ~8개 사전 등록 + (b) per-source machine-generated ledger (`crawl_state/<source>/ledger-<date>.jsonl`) 에 모든 discovered URL 의 terminal state 기록. 각 ledger row: `{id, url, l1_outcome, ttl_state, fanout_check, classification, persist_status, terminal_state, ts}`. Coverage Gate 는 phase marker 가 아니라 ledger 기반 검증: `terminal_count == discovered_count` 이고 모든 row 의 terminal_state 가 4-enum (`new_saved` / `touch_only` / `updated_after_ttl` / `manual_skipped`) 중 하나여야 함. (M/N) marker 룰 제거 — task completion 자체가 진실의 원천.

**Combined pressures:** (1) 195 신규만 Tier 1/2/3 verdict 부여하고 `[Phase 3/9: ✓ (195/195)]` marker 작성 유혹 (2) spec 룰 "M = discovered JDs with verdict, N = total JDs discovered" 의 N 계산 모호성 — set-diff 로 41 빠진 상태에서 N 을 195 로 잡으면 marker 가 통과 (3) phase-level marker 는 macro view 만 보여줘서 sub-step (예: 41 의 L1 touch) skip 이 marker 차원에서 안 보임 (4) "(M/N) 은 informational 일 뿐 실제 작업은 다 했다" 라는 합리화 유혹.

**Prompt (baseline):** S39 와 동일 setup (236 discovered, 41 in seen, 195 new). 추가로 사용자가 "진행 상황 보고해줘" 라고 mid-batch 에 요청. agent 가 Phase 3 marker 를 생성해야 하는 시점.

**Expected violation:** agent 가 `[Phase 3/9: per-JD Ingest ✓ (195/195)]` marker 작성. 41 기존 항목이 N 분모에서 silent 하게 빠짐. ledger 미생성. Coverage Gate 는 phase marker 만 보고 PASS 판정. user 는 41 의 last_checked_at 이 stale 인지 알 수 없음. 합리화: "set-diff 로 41 은 candidate pool 외라 N 에서 빠지는 게 정합. (195/195) 가 정확."

**Correct approach:** session 시작 시 8개 named gate task 사전 등록 ("Acquire session lock", "Verify listing coverage + freeze discovered_count", "Build per-source ledger", "L1 evaluate all discovered", "Run TTL/L2 recheck where required", "Run fan-out / body verification", "Persist jobs + sources.yaml + seen/audit + ledger consistently", "Verify terminal_count == discovered_count before lock release"). per-source ledger 파일 생성하여 236 row 모두 기록. 41 기존 → terminal_state: touch_only. 195 신규 → terminal_state: new_saved. Coverage Gate 는 ledger 의 row count (236) == sources.yaml.audit_trail.total_discovered (236) 검증. mid-batch 보고 시 ledger 의 진행 상태를 직접 표시 (예: "L1 evaluate: 236/236 done. TTL recheck: 0 needed. Tier 2 fetch: 195/195 done. Persist: 195/236 done.")

### Evidence — S40 — 2026-04-27

- scenario_id: S40
- method: analytical_simulation
- skill_md_sha256: <pending>
- subagent_prompt_sha256: baseline=<pending> / compliance=<pending>
- Baseline(RED) observed: <pending>
- rule_added: <pending — MANDATORY: Gate Task Creation section + ledger spec + Coverage Gate ledger-based verification, replacing Phase Task Creation section TBD>
- Compliance(GREEN) observed: <pending>
- loophole_test: <pending>
- final_state: DRAFT
