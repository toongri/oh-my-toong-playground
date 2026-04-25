---
name: collect-jd
description: Use when collecting, curating, or organizing job descriptions (JDs) — triggers include "JD 모으고 있어", "JD 수집", "JD 큐레이션", "JD 정리하고 있어", "오늘 수집 정리해줘", "오늘 본 JD", "관리 중인 JD", "쌓아둔 JD", "내 프로필에 맞는 JD 쌓아줘", "내 이력에 맞는 JD 큐레이션", and "싹 돌려" (in JD rescan context). Do NOT trigger on discovery phrases claimed by resume-apply ("JD 찾아줘", "JD 골라줘", "공고 뭐 있지", "지원할 곳", "어디 넣을까") — those belong to resume-apply. Skill maintains project-scoped state at `$OMT_DIR/collect-jd/` (never global).
---

# collect-jd

Dedicated skill for JD collection, curation, and organization. Specific rules are added through Phase B pressure scenario cycles (TDD RED-GREEN-REFACTOR).

## Scope Boundary

- collect-jd: JD **discovery · collection · curation · organization** (this skill)
- resume-apply: skill that **consumes** already-recorded JDs (this skill does not participate)
- review-resume: resume review (this skill does not participate)
- resume-forge: resume material mining (this skill does not participate)

## MANDATORY: Phase Task Creation

At skill invocation start (immediately before Session Lock acquire), **pre-create all 8 phases as individual tasks**. Each task is marked `in_progress` on start, `completed` immediately on finish. Purpose: prevent phase skipping and silent skips.

**Phase list (per session)**:

| # | Phase | Key gate / output |
|---|---|---|
| 1 | Session Setup | Session Lock acquire, Storage Backend Interview, Sources Registration (propose if empty), Profile Interview (if absent) |
| 2 | Sources Load + Pagination | Load sources.yaml + iterate sources + Listing Pagination (Tier A/B) |
| 3 | per-JD Ingest | Individual JD URL fetch + Ingest Validation (including insane-search fallback) (Full Coverage Ingest Protocol 3-tier applied) |
| 4 | Dedup Check Gate | Run L1 gate + evaluate L2 gate + fingerprint_check + dedup-audit.log append |
| 5 | Classify | Role tagging + Matching Loop (Phase 1→2→3) |
| 6 | Persist | JD atomic write + taxonomy/tags update + `crawl_state` update |
| 7 | Source HWM Update | Update source-level crawl_state + sources.yaml atomic write |
| 8 | Session End | Rules Re-evaluation (if applicable) + lock release + summary report |

**Batch mode**: Repeat Phases 2-7 per source/JD. Phases 1/8 are session-scoped (once each).

Mark each Phase completion in response with `[Phase N/8: <name> ✓]` marker. Missing = violation.

→ Details (rationalization loopholes, batch mode iteration rules): [reference/rules.md#phase-task-creation](reference/rules.md#phase-task-creation)

## State Location

All state under `$OMT_DIR/collect-jd/` only. `$OMT_DIR` is read from the environment; this skill must not compute it directly. If `$OMT_DIR` is unset, abort + recovery guidance — global fallback forbidden. Forbidden Paths: `~/.omt/global/**`, `~/.omt/<other-project>/collect-jd/**`, `/tmp/**`, and any absolute path outside `$OMT_DIR`.

→ Details (rejection protocol, rationalization loopholes): [reference/rules.md#state-location--forbidden-paths](reference/rules.md#state-location--forbidden-paths)

## Session Lock (MANDATORY)

At skill trigger time (top priority, before Phase 0 entry), acquire `$OMT_DIR/collect-jd/.lock`. If `.lock` is absent, atomic write with current PID. If `.lock` exists, check liveness via `kill -0 <pid>` — if live, abort (stderr + exit non-zero); if stale, overwrite with current PID and proceed. **Lock is held for the entire session**: during AskUserQuestion wait, file editing, LLM calls, and batch rescan — all phases. On normal exit, verify PID match then delete.

- Entering the skill without lock acquire is forbidden.
- Implementing only existence check of PID file without `kill -0` is forbidden (PID reuse risk).
- Releasing/re-acquiring the lock during AskUserQuestion wait is forbidden.

→ Details: [reference/rules.md#session-lock](reference/rules.md#session-lock)

## Storage Backend Interview (MANDATORY)

On first run, check for absent/ambiguous `$OMT_DIR/collect-jd/config.yaml` → **AskUserQuestion is mandatory**. Config schema has 2 fields: `platform` + `how` (free-form description). `platform` example values: `filesystem` | `notion` | `google_drive` | `gist` | user-defined MCP name. `how` is a free-form description of "where and how to store" (may include Notion page ID, table name, template file path, etc.).

After user acceptance/change, atomic write `config.yaml` (`platform`/`how`/`storage_path` when platform=filesystem). Subsequent sessions read `config.yaml` directly.

**CRITICAL**: When config.yaml is absent/ambiguous, silent default save as platform=filesystem is forbidden. "It's the first run so default" rationalization is not allowed.

- Required immediately after Session lock, before Phase 0 Profile Interview entry.
- `platform: filesystem` → `storage_path` required (must be under `$OMT_DIR`).
- `platform: notion | google_drive | ...` → `how` field must contain target page/folder/sheet ID + template + MCP call procedure as free-form description.
- On path/backend change request: atomic overwrite. Data migration only with explicit user approval.

→ Details (flowchart, rationalization loopholes, config.yaml schema): [reference/rules.md#storage-backend-interview](reference/rules.md#storage-backend-interview)

## Atomic Write Pattern (MANDATORY)

All state file writes use the `writeAtomic(path, content)` pattern. Steps: (1) write content to `<path>.tmp` → (2) fsync (recommended) → (3) `rename(<path>.tmp, <path>)` (POSIX atomic). Temp path must always be in the same directory as the target file (prevents cross-filesystem rename).

- Direct `open(path, 'w')` write is forbidden — file may be truncated on SIGKILL or disk full.
- Temp paths in separate directories like `/tmp/xxx` are forbidden.
- Mandatory for: new JD save · `last_checked_at` update · status reversal · fingerprint update · `rules.yaml.proposed` creation · `rules.yaml` approve overwrite · session lock `.lock` write — all of them.

→ Details: [reference/rules.md#atomic-write-pattern](reference/rules.md#atomic-write-pattern)

## Ingest Paths (5)

1. Direct URL input
2. Text paste
3. File or folder path
4. Company name (only within sites registered in `sources.yaml`)
5. Batch rescan ("싹 돌려")

Before each Ingest Path execution, **Phase 0 profile interview + Dedup L1/L2** must be performed without exception.

## Sources Registration (MANDATORY)

At session start, load `$OMT_DIR/collect-jd/sources.yaml`. If empty or absent, propose via a **single AskUserQuestion**: "Do you have JD source sites to register?" (skippable — not as mandatory as Profile Interview). When user provides a URL, atomic append with `{slug, name, careers_url, added_at, pagination, crawl_state}` structure.

**Reusable Crawl**: When user utterance contains trigger phrases `"오늘 돌려"` / `"싹 돌려"` / `"전체 재크롤"` / `"sources 돌려"` etc. → **iterate all registered sources** → perform Listing Pagination per source → per-JD fetch + Dedup Gate + Classify + Persist. Collect only new entries by HWM. No automatic scheduling.

**CRITICAL**: Open-web free crawl when sources.yaml is empty is forbidden. Even on user "싹 돌려" utterance, if source count is 0, report "등록된 소스가 없어요" and prompt registration.

→ Details: [reference/rules.md#sources-registration](reference/rules.md#sources-registration)

## Listing Pagination (MANDATORY, 2-tier)

**Obligation to check the entire JD list to the end** from a source's listing page. 2-tier approach:

- **Tier A (Auto-detect)**: Automatically attempt these patterns — query `?page=` / `?offset=` / `?after=<cursor>` / "다음"·"next" button link / infinite scroll XHR endpoint (Playwright network monitoring). On success, record `sources.yaml.<source>.pagination = { method: auto, detected_pattern: <...> }`.
- **Tier B (Interview fallback)**: On Tier A failure, **AskUserQuestion is mandatory** — "이 사이트 전체 list 를 어떻게 가져오나요? (API URL / 전용 MCP / 스크립트 / 수동 복붙)". Store user response as free-form text in `sources.yaml.<source>.pagination.how` (execution script paths, API examples, MCP call procedures all allowed). Reuse `how` in subsequent sessions.

**CRITICAL**: When auto-detection fails, storing only the first page and stopping is forbidden. Must escalate to Tier B interview.

→ Details (Tier A heuristics list, Tier B interview template, loopholes): [reference/rules.md#listing-pagination](reference/rules.md#listing-pagination)

## Listing Pagination Coverage Verification (MANDATORY, 3-check)

Discovery-side proof that the listing was scraped exhaustively. After Tier A/B pagination collects the anchor set, three checks MUST pass before Full Coverage Tier 1 ingest begins:

1. **Declared total match** — regex-extract page total count (e.g., "236개의 포지션") → must equal DOM unique-anchor count
2. **Scroll stability** — `window.scrollTo(0, document.documentElement.scrollHeight)` × ≥3 iterations → anchor count unchanged
3. **Infinite-scroll absence** — `scrollHeight` delta across iterations == 0 → no lazy fetch triggered

Persist results to `sources.yaml.<source>.crawl_state.coverage_verification` with fields:
- `verified_at` (ISO8601)
- `method` (e.g., `playwright_scroll_to_bottom_N_iterations`)
- `page_declared_total`, `dom_unique_anchor_count`
- `matches_declared` (bool)
- `infinite_scroll_detected` (bool)
- `conclusion` (string)

**CRITICAL**:
- Without `coverage_verification` field set, `batch_run_completed=true` declaration is forbidden.
- Sites without a visible total count (rare) may record `page_declared_total: null` plus a note "no declared total" in Tier B `how`.
- T11 violation case: initial run reported "236 unique URLs collected" with only 1 `browser_evaluate` call, no scroll test, no declared-total match → Coverage Verification Protocol was not performed; the claim was unverified.

→ Details: [reference/rules.md#listing-pagination-coverage-verification](reference/rules.md#listing-pagination-coverage-verification)

## Crawl-State HWM Ledger (MANDATORY)

Maintain a composite ledger in `sources.yaml.<source>.crawl_state` tracking "which range has already been checked" per source rescan.

Schema:
```yaml
crawl_state:
  marker_type: id | url | page_number | timestamp | custom
  last_seen_marker: <value>   # most recently confirmed marker
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

**Rescan rules**: On next run, treat only items exceeding `last_seen_marker` as new candidates. However, for dynamically sorted sites (e.g., recommendation-based), do full fetch + URL seen-set cross-check for dedup. If `marker_type == custom`, execute the free-form logic in the `how` field.

**CRITICAL**: Crawl without recording HWM is forbidden. Declaring save complete without `crawl_state.last_seen_marker` set is forbidden.

→ Details (marker_type selection rules, dynamic listing handling, loopholes): [reference/rules.md#crawl-state-hwm-ledger](reference/rules.md#crawl-state-hwm-ledger)

## Phase 0: Profile Interview Required (MANDATORY)

When `$OMT_DIR/collect-jd/profile/profile.yaml` is absent, a **minimum 3-round** profile interview (`AskUserQuestion`) is required before JD collection. Round 1: career history, years of experience, preferred domains. Round 2: tech stack, strengths. Round 3: company, salary, location, remote work, exclude preferences. After the interview, atomic write `profile.yaml` (includes `version: 1` field). If profile exists, proceed to normal collection. **5 rationalization patterns blocked** — urgency, being in a hurry, or having received a URL are none of them valid reasons to skip the interview.

→ Details (rationalization loopholes, purpose explanation): [reference/rules.md#phase-0-profile-interview-required](reference/rules.md#phase-0-profile-interview-required)

## Dedup (L1 URL/slug + L2 LLM similarity)

Run dedup in L1 → L2 order before writing a new JD file (MANDATORY).

**CRITICAL — Dedup Check Gate rules**:
- Even if `jobs/` is empty, the L1 gate **must be recorded as executed**. "Skip because jobs is empty" is forbidden — trivial-pass must not be silently processed; must be explicitly logged as "L1 gate executed: 0 candidates".
- Even when L2 conditions are not met (0 JDs for the same company_slug), record "L2 gate evaluated: not applicable" in audit.
- Saving without running the dedup gate is forbidden. If `fingerprint_check` field is empty, reject the save.

→ Dedup Gate Enforcement details: [reference/rules.md#dedup-check-gate-enforcement](reference/rules.md#dedup-check-gate-enforcement)

- **L1**: After `normalizeUrl()`, match by URL or `(company_slug, role_title_slug)`. On match, new file creation is forbidden; only `last_checked_at` is updated. URL match + TTL (30 days) exceeded → enter L2.
- **L2**: L1 no-match + another JD for the same `company_slug` already saved → LLM similarity judgment (`reference/dedup-l2-prompt.md`, temperature 0). `same: true` → new file forbidden + `fingerprint_check: duplicate_of:<url>`. `same: false` → save new + `fingerprint_check: unique`.
- `max_l2_calls_per_batch: 50`. If exceeded, `fingerprint_check: pending` — not a skip; re-evaluate in next batch.

→ L1 details (loopholes, counterexample): [reference/rules.md#dedup-layer-1](reference/rules.md#dedup-layer-1)
→ L2 details (invocation contract, loopholes, counterexample): [reference/rules.md#dedup-layer-2](reference/rules.md#dedup-layer-2)
→ Flow diagram (L1→L2 decision tree): [reference/rules.md#decision-flow](reference/rules.md#decision-flow)

## Matching Loop (history → rules → filter) (MANDATORY)

3-phase verdict against `profile/rules.yaml` before saving each JD.

- **Phase 1**: If same URL/slug pair exists in `jobs/**/*.md` → inherit status. Otherwise proceed to Phase 2.
- **Phase 2**: Pinned prompt `reference/ambiguity-prompt.md`, temperature 0. `match` → `status: included` (auto). `mismatch` → `status: excluded` (auto, Exclude Flow rules apply). **`ambiguous` → auto-verdict forbidden; must proceed to Phase 3.**
- **Phase 3**: `AskUserQuestion` — Korean question based on `missing_signals`. Options: include / exclude / defer. **Call immediately even in Batch mode**, no queuing.
- Auto-decision audit trail: on auto-save, record `auto:<verdict>:<rules.yaml sha256 short 8>` in `reason_note`.

> Note: Matching Loop is the verdict algorithm invoked inside each Full Coverage tier.

→ Details (rationalization loopholes, counterexample): [reference/rules.md#matching-loop](reference/rules.md#matching-loop)
→ Flow diagram (Phase 1→2→3 decision tree): [reference/rules.md#decision-flow](reference/rules.md#decision-flow)

## Full Coverage Ingest Protocol (MANDATORY, 3-tier)

> Note: Full Coverage is the input-depth escalation ladder; Matching Loop runs inside each tier.

Process all JDs discovered from listing scrape without omission. Escalate in order from information exposed on the discovery screen.

- **Tier 1 — Listing Metadata Resolution**: Extract role_tags from anchor.innerText in full (title + stack label + subsidiary badge, etc.) → immediately persist when a single rules.yaml rule triggers. **Reading only the title is forbidden**.
- **Tier 2 — Detail Fetch Verification**: MANDATORY escalation when Tier 1 is ambiguous. Playwright `browser_navigate` → extract body → re-judge. Persist when judgment is clear.
- **Tier 3 — User Interview**: MANDATORY `AskUserQuestion` when ambiguity persists after Tier 2 (Korean question based on missing_signals, options: include/exclude/defer).

**CRITICAL**:
- Obligation to obtain full anchor.innerText. Parsing only the title and ignoring stack labels is forbidden.
- Silent skip at tier boundaries is forbidden: pending dump when Tier 1 is ambiguous is forbidden; pending dump when Tier 2 is ambiguous is forbidden.
- Declaring `batch_run_completed=true` when `processed_count < discovered_count` is forbidden. Record `batch_run_completed=false` + `pending_count=<N>`.
- T11 real violation: Toss Server Developer #197 — listing innerText contained "Kotlin · Java · Spring · Backend" → should have been an immediate match rule trigger for rules.yaml match rule #1, but was missed due to title-only parsing.

→ Details (Tier 1/2/3 spec, decision flow chart, rationalization loopholes, counterexample): [reference/rules.md#full-coverage-ingest-protocol](reference/rules.md#full-coverage-ingest-protocol)

## Exclude Flow (tags + reason_note MANDATORY)

When saving with `status: excluded`, **simultaneously** required: `tags: [...]` (minimum 1, `tags.yaml` emergent slug) + `reason_note` (verbatim user utterance, empty string forbidden). If missing, trigger Emergent tag interview before save: (1) collect reason (2) derive tag (top-3 candidates or new slug) (3) update `tags.yaml` (4) atomic write. This flow does NOT apply to `included` / `ambiguous` / `pending`.

→ Details (emergent tag interview, tags.yaml schema, loopholes, counterexample): [reference/rules.md#exclude-flow](reference/rules.md#exclude-flow)

## Reversal (status change record) (MANDATORY)

When changing an existing file's `status`, **prepend** `prev: <prev_status> @ <ISO8601 date>` at the **top** of `reason_note`. Atomic write (`.tmp` → rename). Multiple reversals accumulate (prepend repeatedly; topmost = most recent). On rules re-evaluation: append `(rules_reeval:<sha short 8>)` suffix. No exceptions: first save · L1 `last_checked_at` update · L2 `fingerprint_check` update.

→ Details (rationalization loopholes): [reference/rules.md#reversal](reference/rules.md#reversal)

## Manual Edit Safety

Batch rescan will **never overwrite** files whose frontmatter the user has manually edited. If any of the detection signals match (future `last_checked_at` · canonical contract violation [non-standard field OR value outside enum]), skip that file + add `수동 편집 감지: N건` line to the report.

→ Details: [reference/rules.md#manual-edit-safety](reference/rules.md#manual-edit-safety)

## Ingest Validation

Before WebFetch · file · text ingest, check body length (< 200 chars) and stop signals only (login/captcha/403, etc.). On failure: save forbidden + report "유효 JD 아닌 것으로 보임" error + record to `$OMT_DIR/collect-jd/ingest-failures.log`.

**Use the `insane-search` skill for WebFetch.**

→ Details: [reference/rules.md#ingest-validation](reference/rules.md#ingest-validation)

## Batch Mode Report Schema (MANDATORY)

On batch rescan completion, the **last line** of the response must exactly match this regex:

```
^신규: \d+건, 기존: \d+건, 업데이트: \d+건$
```

Zero counts must not be omitted. Format variations are forbidden. Record only actual aggregate results.

→ Details (definitions, examples, forbidden patterns, loopholes): [reference/rules.md#batch-mode-report-schema](reference/rules.md#batch-mode-report-schema)

## Role Tagging (MANDATORY)

Two fields required when saving a JD: `role_title_verbatim` (verbatim original title, no modification) + `role_tags: [...]` (LLM call, subset of taxonomy.yaml enum, temperature 0). Korean synonyms (`백엔드`/`서버개발자`/`서버사이드`) must include `backend`. On JSON parse failure: retry once; on 2nd failure, report error (saving empty array is forbidden).

→ Details (taxonomy baseline, LLM invocation contract, pinned prompt, loopholes, counterexample): [reference/rules.md#role-tagging](reference/rules.md#role-tagging)

## YAML Robustness

On parse failure for any state YAML (profile/taxonomy/rules/tags/sources/config): no crash. Copy original to `<file>.bak.<ISO8601>` once → `AskUserQuestion` with 2 options (edit manually [default] / reset to default [data loss warning]). Automatic deletion or cleanup of user data is forbidden.

→ Details: [reference/rules.md#yaml-robustness](reference/rules.md#yaml-robustness)

## Company-Name Ingest

Ingest path #4 (company name only) operates **only within sites registered in `sources.yaml`**. For unregistered companies → **WebFetch/open-web search is absolutely forbidden**; trigger `AskUserQuestion` with "공식 채용 페이지 URL 을 알려주세요". When user provides a URL, append to `sources.yaml` then proceed with standard flow. Blacklist supported.

→ Details: [reference/rules.md#company-name-ingest](reference/rules.md#company-name-ingest)

## Rules Re-evaluation

Re-derive `rules.yaml` based on today's collection results. Trigger phrases: "오늘 수집 정리해줘" / "오늘 본 JD로 규칙 업데이트" / "규칙 재평가" / "rules 다시 뽑아줘" / auto-propose when 1 or more include·exclude occur within a session. **Scope**: only JD files where the date portion of `last_checked_at` is today (excluding manual-edited files). **Workflow**: (1) load scope + store `rules.yaml.sha256.before` in memory (2) LLM call (temperature 0) → generate proposed rules (3) atomic write `rules.yaml.proposed` (`.tmp` → rename, includes `version:1` + `_proposed_at` + `_based_on`) (4) display diff + AskUserQuestion (`approve` / `reject` / `edit manually`) (5) on approve, **race check required**: recompute sha256 of `rules.yaml` → if mismatch with `before`, abort (6) race OK → overwrite `rules.yaml` (atomic write, excluding `_proposed_at`/`_based_on`) + remove `.proposed`. If 0 JDs today, stop immediately. Overwriting `rules.yaml` directly without approve is forbidden.

→ Details: [reference/rules.md#rules-re-evaluation](reference/rules.md#rules-re-evaluation)

## Reference Index

- [reference/rules.md](reference/rules.md) — All rule details · loopholes · examples (Phase B TDD results archive, M3 separated)
- [reference/frontmatter-schema.md](reference/frontmatter-schema.md) — JD file YAML frontmatter contract
- [reference/slugify.md](reference/slugify.md) — Slug normalization algorithm spec
- [reference/url-normalize.md](reference/url-normalize.md) — URL normalization spec
- [reference/dedup-l2-prompt.md](reference/dedup-l2-prompt.md) — L2 LLM similarity pinned prompt
- [reference/ambiguity-prompt.md](reference/ambiguity-prompt.md) — Matching ambiguity pinned prompt

## Tests

- `skills/collect-jd/tests/pressure-scenarios.md` — 13 pressure scenarios (Phase B TDD evidence stubs)
- `skills/collect-jd/evals/trigger-eval.json` — trigger eval spec (flat shape)
