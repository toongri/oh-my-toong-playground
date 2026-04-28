---
name: collect-jd
description: Use when collecting, curating, or organizing job descriptions (JDs) — triggers include "JD 모으고 있어", "JD 수집", "JD 큐레이션", "JD 정리하고 있어", "오늘 수집 정리해줘", "오늘 본 JD", "관리 중인 JD", "쌓아둔 JD", "내 프로필에 맞는 JD 쌓아줘", "내 이력에 맞는 JD 큐레이션", and "싹 돌려" (in JD rescan context). Do NOT trigger on discovery phrases claimed by resume-apply ("JD 찾아줘", "JD 골라줘", "공고 뭐 있지", "지원할 곳", "어디 넣을까") — those belong to resume-apply. Skill maintains project-scoped state at `$OMT_DIR/collect-jd/` (never global).
---

# collect-jd

> **Canonical principle**: Verification stage MUST be on the canonical path. No bypass routes. Every discovered URL goes through the same flow; "fast paths" that skip verification are forbidden.

Dedicated skill for JD collection, curation, and organization. Specific rules are added through Phase B pressure scenario cycles (TDD RED-GREEN-REFACTOR).

## Scope Boundary

- collect-jd: JD **discovery · collection · curation · organization** (this skill)
- resume-apply: skill that **consumes** already-recorded JDs (this skill does not participate)
- review-resume: resume review (this skill does not participate)
- resume-forge: resume material mining (this skill does not participate)

## MANDATORY: Gate Task Creation

**Gate Task Creation (MANDATORY)** — at skill invocation start, pre-create 8 named gate tasks via `TaskCreate`. Each task is the source of truth for gate completion; the per-source ledger is the source of truth for per-item progress.

→ Details: [reference/bootstrap.md](reference/bootstrap.md#gate-task-creation)

## State Location

All state under `$OMT_DIR/collect-jd/` only. `$OMT_DIR` is read from the environment; this skill must not compute it directly. If `$OMT_DIR` is unset, abort + recovery guidance — global fallback forbidden. Forbidden Paths: `~/.omt/global/**`, `~/.omt/<other-project>/collect-jd/**`, `/tmp/**`, and any absolute path outside `$OMT_DIR`.

→ Details (rejection protocol, rationalization loopholes): [reference/bootstrap.md#state-location--forbidden-paths](reference/bootstrap.md#state-location--forbidden-paths)

## Session Lock (MANDATORY)

**Session Lock (MANDATORY)** — atomic `.lock` file with PID + liveness check (`kill -0`); single-writer per session. Acquire at Gate 1, release at Gate 8 (after Coverage Gate passes).

→ Details: [reference/bootstrap.md](reference/bootstrap.md#session-lock)

## Storage Backend Interview (MANDATORY)

**Storage Backend Interview (MANDATORY)** — on first run, AskUserQuestion is mandatory to collect platform + how. Silent default to filesystem is forbidden.

→ Details: [reference/bootstrap.md](reference/bootstrap.md#storage-backend-interview)

## Atomic Write Pattern (MANDATORY)

**Atomic Write Pattern (MANDATORY)** — `.tmp → fsync → rename` for all single-file writes; never partial overwrites. Mandatory at JD file persist, sources.yaml updates, and seen.jsonl appends.

→ Details: [reference/bootstrap.md](reference/bootstrap.md#atomic-write-pattern)

## Ingest Paths (5)

1. Direct URL input
2. Text paste
3. File or folder path
4. Company name (only within sites registered in `sources.yaml`)
5. Batch rescan ("싹 돌려")

Before each Ingest Path execution, **Phase 0 profile interview + Dedup L1/L2** must be performed without exception.

## Sources Registration (MANDATORY)

At session start, load `$OMT_DIR/collect-jd/sources.yaml`. If empty or absent, propose via a **single AskUserQuestion**: "Do you have JD source sites to register?" (skippable — not as mandatory as Profile Interview). When user provides a URL, atomic append with `{slug, name, careers_url, added_at, pagination, crawl_state, ingest}` structure.

**Source-level Ingest Config (`ingest`)**: schema = `{detail_required_before_persist: bool}`. Default `false`. When `true`, the source's Full Coverage Ingest Protocol MUST run Tier 2 (detail body fetch) for every JD before persist — Tier 1 immediate persist is FORBIDDEN. See [Full Coverage Ingest Protocol](#full-coverage-ingest-protocol-mandatory-3-tier).

**Reusable Crawl**: When user utterance contains trigger phrases `"오늘 돌려"` / `"싹 돌려"` / `"전체 재크롤"` / `"sources 돌려"` etc. → **iterate all registered sources** → perform Listing Pagination per source → per-JD L1 evaluation (Algorithm B) + Dedup Gate + Classify + Persist. No automatic scheduling.

**CRITICAL**: Open-web free crawl when sources.yaml is empty is forbidden. Even on user "싹 돌려" utterance, if source count is 0, report "등록된 소스가 없어요" and prompt registration.

→ Details: [reference/dedup-and-discovery.md#sources-registration](reference/dedup-and-discovery.md#sources-registration)

## Listing Pagination (MANDATORY, single-path)

**Single source of truth: `pagination.how`**. All listing discovery — first-time auto-detect, user-interview fallback, cached re-execution, invalidation re-interview — collapses into one algorithm `discover_listing(source)`.

**Algorithm**:
1. If `pagination.how` absent → try Tier A 9-pattern catalog → success: serialize as `how={origin: auto, pattern, params}`. fail: AskUserQuestion → `how={origin: interview, pattern, params, prose}`.
2. Execute `pagination.how`.
3. On execution failure → invalidate per trigger table (transient: 1-retry; structural: immediate). Push current `how` to `previous_how` 3-slot ring → AskUserQuestion 3-option (new method / Tier A retry / skip). On retry-fail → **raise** (silent empty forbidden).

**Schema**: `pagination.how = { origin: auto|interview, pattern: <13-enum>, params: {}, prose: <free-form> }`. `previous_how: []` inline ring (LRU, max 3). `invalidated_at: null` ISO timestamp.

**CRITICAL**:
- First-run discovery skipping Tier A 9-pattern catalog → AskUserQuestion shortcut **forbidden**.
- discover_listing returning empty `[]` on execution failure **forbidden** — must raise; caller skip-with-audit, no Per-Site Memory false-clean.
- Coverage Verification fires after `was_invalidated: false` (success path) only. raise → skip Coverage + Per-Site Memory update.

→ Details (γ schema, 13-pattern catalog, invalidation trigger table, previous_how ring, raise-on-failure contract, 2 new loopholes): [reference/dedup-and-discovery.md#listing-pagination](reference/dedup-and-discovery.md#listing-pagination)

## Listing Pagination Coverage Verification (MANDATORY, 3-check)

**Coverage Verification (MANDATORY, 3-check)** — declared-total match, scroll stability, infinite-scroll absence. Without `coverage_proof`, `batch_run_completed=true` is forbidden.

→ Details: [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md#listing-pagination-coverage-verification)

## Per-Site Crawl Memory (MANDATORY)

Maintain per-source crawl memory in `sources.yaml.<source>.crawl_state` (3 sub-groups) and `$OMT_DIR/collect-jd/crawl_state/<source>/seen.jsonl` (append-only file).

**Storage layout**:
- `$OMT_DIR/collect-jd/crawl_state/<source>/seen.jsonl` — one JSON object per line, each < 1 KB. Append via POSIX `open(path, 'a')`. Session-lock guarantees single-writer.
- Line schema: `{"id": "...", "url": "...", "processed_at": "<ISO8601>", "verdict": "included|excluded|ambiguous", "role_title": "..."}`
- The `id` field is a **deterministic key** derived from the per-site `identifier_kind` strategy — NOT an auto-generated UUID.

Per-Site Crawl Memory schema (sources.yaml `<source>.crawl_state` sub-keys + `seen.jsonl` line schema): see [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md#per-site-crawl-memory) — do not restate inline.

Each source records its id extraction strategy in `sources.yaml.<source>.crawl_state.seen` via two fields: `identifier_kind` (strategy enum) + `identifier_extractor` (param name for `id_query`, `null` for `url`, hash spec for `fingerprint`).

**Re-crawl algorithm (Algorithm B canonical)**: every discovered URL → L1 → 1 of 4 terminal states (`new_ingest|touch_only|ttl_recheck|manual_skip`). seen.jsonl is audit/lookup index, NOT a pre-L1 exclusion gate. Drift detection (`seen_hit + L1_miss` / `L1_hit + seen_miss`) is mandatory.

→ Details: [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md#per-site-crawl-memory)

## Per-Source Ledger (MANDATORY)

One ledger file per source per session, used by Coverage Gate (Gate 8). Without it, Gate 8 cannot pass. The row schema, lifecycle (Gates 4-7), and Coverage Gate algorithm are defined canonically in dedup-and-discovery.md.

→ Details: [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md#per-source-ledger)

## Detail Split Auto Fan-out (MANDATORY)

**Detail Split Auto Fan-out** — when a posting page advertises N positions in a single anchor, split into N separate JD files with `parent_url` + `sub_position` (presence-coupled).

→ Details: [reference/ingest-and-curation.md](reference/ingest-and-curation.md#detail-split-auto-fan-out)

## Identifier Kind Heuristic (MANDATORY)

**Identifier Kind Heuristic (MANDATORY on first source registration)** — choose `id_query` / `url` / `fingerprint` based on URL pattern; silent default forbidden.

→ Details: [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md#identifier-kind-heuristic)

## Phase 0: Profile Interview Required (MANDATORY)

When `$OMT_DIR/collect-jd/profile/profile.yaml` is absent, a **minimum 3-round** profile interview (`AskUserQuestion`) is required before JD collection. Round 1: career history, years of experience, preferred domains. Round 2: tech stack, strengths. Round 3: company, salary, location, remote work, exclude preferences. After the interview, atomic write `profile.yaml` (includes `version: 1` field). If profile exists, proceed to normal collection. **5 rationalization patterns blocked** — urgency, being in a hurry, or having received a URL are none of them valid reasons to skip the interview.

→ Details (rationalization loopholes, purpose explanation): [reference/bootstrap.md#phase-0-profile-interview-required](reference/bootstrap.md#phase-0-profile-interview-required)

## Dedup (L1 URL-only + L2 LLM similarity)

Run dedup in L1 → L2 order before writing a new JD file (MANDATORY).

**CRITICAL — Dedup Check Gate rules**:
- Even if `jobs/` is empty, the L1 gate **must be recorded as executed**. "Skip because jobs is empty" is forbidden — trivial-pass must not be silently processed; must be explicitly logged as "L1 gate executed: 0 candidates".
- Even when L2 conditions are not met (0 JDs for the same company_slug), record "L2 gate evaluated: not applicable" in audit.
- Saving without running the dedup gate is forbidden. If `fingerprint_check` field is empty, reject the save.

→ Dedup Gate Enforcement details: [reference/dedup-and-discovery.md#dedup-check-gate-enforcement](reference/dedup-and-discovery.md#dedup-check-gate-enforcement)

**L1 / L2 Dedup (MANDATORY)** — L1 = URL-only normalize match (single-key gate). L2 = LLM similarity check on L1 miss with same `company_slug` OR L1 hit + TTL exceeded. L2 outcomes (`same:true|false`) and persist actions are spec'd canonically in dedup-and-discovery.md.

→ Details: [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md#dedup-layer-1) + [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md#dedup-layer-2)
→ Flow diagram (L1→L2 decision tree): [reference/dedup-and-discovery.md#decision-flow](reference/dedup-and-discovery.md#decision-flow)

## Matching Loop (history → rules → filter) (MANDATORY)

3-phase verdict against `profile/rules.yaml` before saving each JD.

- **Phase 1**: If same URL/slug pair exists in `jobs/**/*.md` → inherit status. Otherwise proceed to Phase 2.
- **Phase 2**: Pinned prompt `reference/ambiguity-prompt.md`, temperature 0. `match` → `status: included` (auto). `mismatch` → `status: excluded` (auto, Exclude Flow rules apply). **`ambiguous` → auto-verdict forbidden; must proceed to Phase 3.**
- **Phase 3**: `AskUserQuestion` — Korean question based on `missing_signals`. Options: include / exclude / defer. **Call immediately even in Batch mode**, no queuing.
- Auto-decision audit trail: on auto-save, record `auto:<verdict>:<rules.yaml sha256 short 8>` in `reason_note`.

> Note: Matching Loop is the verdict algorithm invoked inside each Full Coverage tier.

→ Details (rationalization loopholes, counterexample): [reference/ingest-and-curation.md#matching-loop](reference/ingest-and-curation.md#matching-loop)
→ Flow diagram (Phase 1→2→3 decision tree): [reference/dedup-and-discovery.md#decision-flow](reference/dedup-and-discovery.md#decision-flow)

## Full Coverage Ingest Protocol (MANDATORY, 3-tier)

> Note: Full Coverage is the input-depth escalation ladder; Matching Loop runs inside each tier.

Process all JDs discovered from listing scrape without omission. Escalate in order from information exposed on the discovery screen.

- **Tier 1 — Listing Metadata Resolution**: Extract role_tags from anchor.innerText in full (title + stack label + subsidiary badge, etc.) → immediately persist when a single rules.yaml rule triggers. **Reading only the title is forbidden**.

**Tier 1 Eligibility (MANDATORY)**: Tier 1 immediate persist is allowed ONLY when `sources.yaml.<source>.ingest.detail_required_before_persist: false` (or absent — default false). When `true`, Tier 1 is FORBIDDEN: every JD MUST escalate to Tier 2 detail fetch before persist, and Detail Split Auto Fan-out check MUST run on the body. This eliminates the operational gap where multi-subsidiary or multi-position JDs would be silently saved as a single record without fan-out detection.

> **Why source-level (not per-JD heuristic)**: Listing-level signals (e.g., "외 N개 계열사" suffix) cannot reliably detect body-only fan-out signals. The per-source declarative config is the canonical decision point — uniform within a source, no runtime branching per JD.

- **Tier 2 — Detail Fetch Verification**: MANDATORY escalation when Tier 1 is ambiguous. Playwright `browser_navigate` → extract body → re-judge. Persist when judgment is clear.
- **Tier 3 — User Interview**: MANDATORY `AskUserQuestion` when ambiguity persists after Tier 2 (Korean question based on missing_signals, options: include/exclude/defer).

**CRITICAL**:
- Obligation to obtain full anchor.innerText. Parsing only the title and ignoring stack labels is forbidden.
- Silent skip at tier boundaries is forbidden: pending dump when Tier 1 is ambiguous is forbidden; pending dump when Tier 2 is ambiguous is forbidden.
- Declaring `batch_run_completed=true` when `processed_count < discovered_count` is forbidden. Record `batch_run_completed=false` + `pending_count=<N>`.
- T11 real violation: Toss Server Developer #197 — listing innerText contained "Kotlin · Java · Spring · Backend" → should have been an immediate match rule trigger for rules.yaml match rule #1, but was missed due to title-only parsing.

→ Details (Tier 1/2/3 spec, decision flow chart, rationalization loopholes, counterexample): [reference/ingest-and-curation.md#full-coverage-ingest-protocol](reference/ingest-and-curation.md#full-coverage-ingest-protocol)

## Exclude Flow (tags + reason_note MANDATORY)

When saving with `status: excluded`, **simultaneously** required: `tags: [...]` (minimum 1, `tags.yaml` emergent slug) + `reason_note` (verbatim user utterance, empty string forbidden). If missing, trigger Emergent tag interview before save: (1) collect reason (2) derive tag (top-3 candidates or new slug) (3) update `tags.yaml` (4) atomic write. This flow does NOT apply to `included` / `ambiguous` / `pending`.

→ Details (emergent tag interview, tags.yaml schema, loopholes, counterexample): [reference/ingest-and-curation.md#exclude-flow](reference/ingest-and-curation.md#exclude-flow)

## Reversal (status change record) (MANDATORY)

When changing an existing file's `status`, **prepend** `prev: <prev_status> @ <ISO8601 date>` at the **top** of `reason_note`. Atomic write (`.tmp` → rename). Multiple reversals accumulate (prepend repeatedly; topmost = most recent). On rules re-evaluation: append `(rules_reeval:<sha short 8>)` suffix. No exceptions: first save · L1 `last_checked_at` update · L2 `fingerprint_check` update.

→ Details (rationalization loopholes): [reference/ingest-and-curation.md#reversal](reference/ingest-and-curation.md#reversal)

## Manual Edit Safety

Batch rescan will **never overwrite** files whose frontmatter the user has manually edited. If any of the detection signals match (future `last_checked_at` · canonical contract violation [non-standard field OR value outside enum]), skip that file + add `수동 편집 감지: N건` line to the report.

→ Details: [reference/ingest-and-curation.md#manual-edit-safety](reference/ingest-and-curation.md#manual-edit-safety)

## Ingest Validation

Before WebFetch · file · text ingest, check body length (< 200 chars) and stop signals only (login/captcha/403, etc.). On failure: save forbidden + report "유효 JD 아닌 것으로 보임" error + record to `$OMT_DIR/collect-jd/ingest-failures.log`.

**Use the `insane-search` skill for WebFetch.**

→ Details: [reference/ingest-and-curation.md#ingest-validation](reference/ingest-and-curation.md#ingest-validation)

## Batch Mode Report Schema (MANDATORY)

On batch rescan completion, the **last line** of the response must exactly match this regex:

```
^신규: \d+건, 기존: \d+건, 업데이트: \d+건$
```

Zero counts must not be omitted. Format variations are forbidden. Record only actual aggregate results.

→ Details (definitions, examples, forbidden patterns, loopholes): [reference/ingest-and-curation.md#batch-mode-report-schema](reference/ingest-and-curation.md#batch-mode-report-schema)

## Role Tagging (MANDATORY)

Two fields required when saving a JD: `role_title_verbatim` (verbatim original title, no modification) + `role_tags: [...]` (LLM call, subset of taxonomy.yaml enum, temperature 0). Korean synonyms (`백엔드`/`서버개발자`/`서버사이드`) must include `backend`. On JSON parse failure: retry once; on 2nd failure, report error (saving empty array is forbidden).

→ Details (taxonomy baseline, LLM invocation contract, pinned prompt, loopholes, counterexample): [reference/ingest-and-curation.md#role-tagging](reference/ingest-and-curation.md#role-tagging)

## YAML Robustness

On parse failure for any state YAML (profile/taxonomy/rules/tags/sources/config): no crash. Copy original to `<file>.bak.<ISO8601>` once → `AskUserQuestion` with 2 options (edit manually [default] / reset to default [data loss warning]). Automatic deletion or cleanup of user data is forbidden.

→ Details: [reference/ingest-and-curation.md#yaml-robustness](reference/ingest-and-curation.md#yaml-robustness)

## Company-Name Ingest

Ingest path #4 (company name only) operates **only within sites registered in `sources.yaml`**. For unregistered companies → **WebFetch/open-web search is absolutely forbidden**; trigger `AskUserQuestion` with "공식 채용 페이지 URL 을 알려주세요". When user provides a URL, append to `sources.yaml` then proceed with standard flow. Blacklist supported.

→ Details: [reference/dedup-and-discovery.md#company-name-ingest](reference/dedup-and-discovery.md#company-name-ingest)

## Rules Re-evaluation

Re-derive `rules.yaml` based on today's collection results. Trigger phrases: "오늘 수집 정리해줘" / "오늘 본 JD로 규칙 업데이트" / "규칙 재평가" / "rules 다시 뽑아줘" / auto-propose when 1 or more include·exclude occur within a session. **Scope**: only JD files where the date portion of `last_checked_at` is today (excluding manual-edited files). **Workflow**: (1) load scope + store `rules.yaml.sha256.before` in memory (2) LLM call (temperature 0) → generate proposed rules (3) atomic write `rules.yaml.proposed` (`.tmp` → rename, includes `version:1` + `_proposed_at` + `_based_on`) (4) display diff + AskUserQuestion (`approve` / `reject` / `edit manually`) (5) on approve, **race check required**: recompute sha256 of `rules.yaml` → if mismatch with `before`, abort (6) race OK → overwrite `rules.yaml` (atomic write, excluding `_proposed_at`/`_based_on`) + remove `.proposed`. If 0 JDs today, stop immediately. Overwriting `rules.yaml` directly without approve is forbidden.

→ Details: [reference/ingest-and-curation.md#rules-re-evaluation](reference/ingest-and-curation.md#rules-re-evaluation)

## Reference Index

- [reference/bootstrap.md](reference/bootstrap.md) — Session-init rules (Gate tasks, Session Lock, Storage Backend, Atomic Write, State Location, Profile Interview)
- [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md) — Source/listing rules (Sources Registration, Pagination, Coverage Verification, Per-Site Crawl Memory, Per-Source Ledger, Identifier Kind, Dedup L1/L2, Company-Name Ingest, Decision Flow)
- [reference/ingest-and-curation.md](reference/ingest-and-curation.md) — Per-JD rules (Detail Split, Matching Loop, Full Coverage Ingest, Exclude Flow, Reversal, Manual Edit Safety, Ingest Validation, Batch Report, Role Tagging, YAML Robustness, Rules Re-evaluation)
- [reference/frontmatter-schema.md](reference/frontmatter-schema.md) — JD file YAML frontmatter contract
- [reference/slugify.md](reference/slugify.md) — Slug normalization algorithm spec
- [reference/url-normalize.md](reference/url-normalize.md) — URL normalization spec
- [reference/dedup-l2-prompt.md](reference/dedup-l2-prompt.md) — L2 LLM similarity pinned prompt
- [reference/ambiguity-prompt.md](reference/ambiguity-prompt.md) — Matching ambiguity pinned prompt

## Tests

- `skills/collect-jd/tests/pressure-scenarios.md` — 13 pressure scenarios (Phase B TDD evidence stubs)
- `skills/collect-jd/evals/trigger-eval.json` — trigger eval spec (flat shape)
