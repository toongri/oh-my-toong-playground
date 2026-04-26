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
| 3 | per-JD Ingest | Individual JD URL fetch + Ingest Validation (including insane-search fallback) (Full Coverage Ingest Protocol 3-tier applied). **Phase 3 cannot be marked complete until every discovered item has a Tier 1/2/3 verdict — partial completion is forbidden.** |
| 4 | Dedup Check Gate | Run L1 gate + evaluate L2 gate + fingerprint_check + dedup-audit.log append |
| 5 | Classify | Role tagging + Matching Loop (Phase 1→2→3) |
| 6 | Persist | JD atomic write + taxonomy/tags update + `crawl_state` update |
| 7 | Source Crawl Memory Update | Update source-level crawl_state + sources.yaml atomic write |
| 8 | Session End | Rules Re-evaluation (if applicable) + **Coverage Gate (`processed_count == discovered_count` per source; if not, refuse lock release until remaining items are processed or user explicitly approves stop)** + lock release + summary report |

**Batch mode**: Repeat Phases 2-7 per source/JD. Phases 1/8 are session-scoped (once each).

Mark each Phase completion in response with `[Phase N/8: <name> ✓ (M/N)]` marker — where **M is the count of items actually processed in this phase, N is the count of items in scope for this phase**. Missing marker = violation. Marker missing the `(M/N)` segment = violation. **Marker with `M < N` = violation: the next phase cannot be entered until M == N or the user explicitly approves stopping.**

Per-phase `(M/N)` semantics:

| Phase | M (numerator) | N (denominator) |
|---|---|---|
| 1 Session Setup | 1 if lock + config + profile all done, else 0 | 1 (session-scoped) |
| 2 Sources Load + Pagination | sources whose `discover_listing` succeeded + Coverage Verification passed | total sources iterated |
| 3 per-JD Ingest | discovered JDs with a Tier 1/2/3 verdict assigned | total JDs discovered (= `discovered_count` from Phase 2) |
| 4 Dedup Check Gate | JDs with L1+L2 evaluated and `fingerprint_check` set | JDs from Phase 3 with non-duplicate verdicts |
| 5 Classify | JDs with `role_tags` + Matching Loop verdict | JDs from Phase 4 not blocked by dedup |
| 6 Persist | JDs atomically written | JDs from Phase 5 with verdict ∈ {included, excluded, ambiguous} |
| 7 Source Crawl Memory Update | sources with `crawl_state` + `seen.jsonl` updated | sources iterated in Phase 2 |
| 8 Session End | 1 if Coverage Gate passes + lock released, else 0 | 1 (session-scoped) |

Rationalization loopholes (forbidden):

- "Marker is informational, real work was done" — ❌ Marker is the gate, not a label. Wrong M/N or missing (M/N) blocks phase transition.
- "I'll write `(3/234)` and add the rest later" — ❌ Phase advance with M < N is forbidden. Stop is itself a violation (see Full Coverage Ingest Protocol).
- "Phases 1/8 don't really have items so (M/N) is optional" — ❌ Always written, even when N=1.
- "I'll batch the markers at the end with final counts" — ❌ Each phase's marker must appear at the moment that phase completes.

→ Details (rationalization loopholes, batch mode iteration rules): [reference/bootstrap.md#phase-task-creation](reference/bootstrap.md#phase-task-creation)

## State Location

All state under `$OMT_DIR/collect-jd/` only. `$OMT_DIR` is read from the environment; this skill must not compute it directly. If `$OMT_DIR` is unset, abort + recovery guidance — global fallback forbidden. Forbidden Paths: `~/.omt/global/**`, `~/.omt/<other-project>/collect-jd/**`, `/tmp/**`, and any absolute path outside `$OMT_DIR`.

→ Details (rejection protocol, rationalization loopholes): [reference/bootstrap.md#state-location--forbidden-paths](reference/bootstrap.md#state-location--forbidden-paths)

## Session Lock (MANDATORY)

At skill trigger time (top priority, before Phase 0 entry), acquire `$OMT_DIR/collect-jd/.lock`. If `.lock` is absent, atomic write with current PID. If `.lock` exists, check liveness via `kill -0 <pid>` — if live, abort (stderr + exit non-zero); if stale, overwrite with current PID and proceed. **Lock is held for the entire session**: during AskUserQuestion wait, file editing, LLM calls, and batch rescan — all phases. On normal exit, verify PID match then delete.

- Entering the skill without lock acquire is forbidden.
- Implementing only existence check of PID file without `kill -0` is forbidden (PID reuse risk).
- Releasing/re-acquiring the lock during AskUserQuestion wait is forbidden.

→ Details: [reference/bootstrap.md#session-lock](reference/bootstrap.md#session-lock)

## Storage Backend Interview (MANDATORY)

On first run, check for absent/ambiguous `$OMT_DIR/collect-jd/config.yaml` → **AskUserQuestion is mandatory**. Config schema has 2 fields: `platform` + `how` (free-form description). `platform` example values: `filesystem` | `notion` | `google_drive` | `gist` | user-defined MCP name. `how` is a free-form description of "where and how to store" (may include Notion page ID, table name, template file path, etc.).

After user acceptance/change, atomic write `config.yaml` (`platform`/`how`/`storage_path` when platform=filesystem). Subsequent sessions read `config.yaml` directly.

**CRITICAL**: When config.yaml is absent/ambiguous, silent default save as platform=filesystem is forbidden. "It's the first run so default" rationalization is not allowed.

- Required immediately after Session lock, before Phase 0 Profile Interview entry.
- `platform: filesystem` → `storage_path` required (must be under `$OMT_DIR`).
- `platform: notion | google_drive | ...` → `how` field must contain target page/folder/sheet ID + template + MCP call procedure as free-form description.
- On path/backend change request: atomic overwrite. Data migration only with explicit user approval.

→ Details (flowchart, rationalization loopholes, config.yaml schema): [reference/bootstrap.md#storage-backend-interview](reference/bootstrap.md#storage-backend-interview)

## Atomic Write Pattern (MANDATORY)

All state file writes use the `writeAtomic(path, content)` pattern. Steps: (1) write content to `<path>.tmp` → (2) fsync (recommended) → (3) `rename(<path>.tmp, <path>)` (POSIX atomic). Temp path must always be in the same directory as the target file (prevents cross-filesystem rename).

- Direct `open(path, 'w')` write is forbidden — file may be truncated on SIGKILL or disk full.
- Temp paths in separate directories like `/tmp/xxx` are forbidden.
- Mandatory for: new JD save · `last_checked_at` update · status reversal · fingerprint update · `rules.yaml.proposed` creation · `rules.yaml` approve overwrite · session lock `.lock` write — all of them.

→ Details: [reference/bootstrap.md#atomic-write-pattern](reference/bootstrap.md#atomic-write-pattern)

## Ingest Paths (5)

1. Direct URL input
2. Text paste
3. File or folder path
4. Company name (only within sites registered in `sources.yaml`)
5. Batch rescan ("싹 돌려")

Before each Ingest Path execution, **Phase 0 profile interview + Dedup L1/L2** must be performed without exception.

## Sources Registration (MANDATORY)

At session start, load `$OMT_DIR/collect-jd/sources.yaml`. If empty or absent, propose via a **single AskUserQuestion**: "Do you have JD source sites to register?" (skippable — not as mandatory as Profile Interview). When user provides a URL, atomic append with `{slug, name, careers_url, added_at, pagination, crawl_state}` structure.

**Reusable Crawl**: When user utterance contains trigger phrases `"오늘 돌려"` / `"싹 돌려"` / `"전체 재크롤"` / `"sources 돌려"` etc. → **iterate all registered sources** → perform Listing Pagination per source → per-JD fetch + Dedup Gate + Classify + Persist. Collect only new entries by Per-Site Crawl Memory set difference (`discovered − seen`). No automatic scheduling.

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

fires after `discover_listing` returns `was_invalidated: false` (or `true` after retry success). raise 시 skip. Discovery-side proof that the listing was scraped exhaustively. After pagination collects the anchor set, three checks MUST pass before Full Coverage Tier 1 ingest begins:

1. **Declared total match** — regex-extract page total count (e.g., "236개의 포지션") → must equal DOM unique-anchor count
2. **Scroll stability** — `window.scrollTo(0, document.documentElement.scrollHeight)` × ≥3 iterations → anchor count unchanged
3. **Infinite-scroll absence** — `scrollHeight` delta across iterations == 0 → no lazy fetch triggered

Persist results to `sources.yaml.<source>.crawl_state.coverage_proof` with fields:
- `verified_at` (ISO8601)
- `method` (e.g., `playwright_scroll_to_bottom_N_iterations`)
- `page_declared_total`, `dom_unique_anchor_count`
- `matches_declared` (bool)
- `infinite_scroll_detected` (bool)
- `conclusion` (string)

**CRITICAL**:
- Without `coverage_proof` field set, `batch_run_completed=true` declaration is forbidden.
- Sites without a visible total count (rare) may record `page_declared_total: null` plus a note "no declared total" in Tier B `how`.
- T11 violation case: initial run reported "236 unique URLs collected" with only 1 `browser_evaluate` call, no scroll test, no declared-total match → Coverage Verification Protocol was not performed; the claim was unverified.

→ Details: [reference/dedup-and-discovery.md#listing-pagination-coverage-verification](reference/dedup-and-discovery.md#listing-pagination-coverage-verification)

## Per-Site Crawl Memory (MANDATORY)

Maintain per-source crawl memory in `sources.yaml.<source>.crawl_state` (3 sub-groups) and `$OMT_DIR/collect-jd/crawl_state/<source>/seen.jsonl` (append-only file).

**Storage layout**:
- `$OMT_DIR/collect-jd/crawl_state/<source>/seen.jsonl` — one JSON object per line, each < 1 KB. Append via POSIX `open(path, 'a')`. Session-lock guarantees single-writer.
- Line schema: `{"id": "...", "url": "...", "processed_at": "<ISO8601>", "verdict": "included|excluded|ambiguous", "role_title": "..."}`
- The `id` field is a **deterministic key** derived from the per-site `identifier_kind` strategy — NOT an auto-generated UUID.

**sources.yaml schema** (`crawl_state` sub-keys):
```yaml
crawl_state:
  seen:
    identifier_kind: id_query | url | fingerprint
    identifier_extractor: <param-name> | null | <hash-spec>
    items_path: "crawl_state/<source>/seen.jsonl"
    items_count: <int>
  audit_trail:
    total_discovered: <int>
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
  coverage_proof:
    verified_at: <ISO8601>
    page_declared_total: <int or null>
    dom_unique_anchor_count: <int>
    infinite_scroll_detected: <bool>
    conclusion: <string>
```

Each source records its id extraction strategy in `sources.yaml.<source>.crawl_state.seen` via two fields: `identifier_kind` (strategy enum) + `identifier_extractor` (param name for `id_query`, `null` for `url`, hash spec for `fingerprint`).

**Re-crawl algorithm**: `discovered − seen = new` set difference. Read all lines from `seen.jsonl` → JSON.parse per line → `Set(rows.map(r => r.id))` → subtract from discovered id set → remaining are new candidates. After processing, atomic append new entries to `seen.jsonl` (single-line per entry, < 1 KB). Crash recovery: skip invalid JSON lines + warn.

**CRITICAL**:
- `last_seen_marker` / cursor-based rescan is forbidden — dynamic listings have no guaranteed ordering.
- `identifier_kind` silent default is forbidden — on first source registration, run the Identifier Kind Heuristic and confirm with user before writing.
- Declaring save complete without appending new entries to `seen.jsonl` is forbidden.

→ Details (schema field meanings, set-difference pseudocode, atomic append safety, crash recovery, migration mapping, rationalization loopholes): [reference/dedup-and-discovery.md#per-site-crawl-memory](reference/dedup-and-discovery.md#per-site-crawl-memory)

## Detail Split Auto Fan-out (MANDATORY)

When a single listing anchor leads to a detail page that contains multiple distinct positions, detect split signals and fan-out into N child JDs.

**Strong signals** (fan-out MANDATORY):
- (a) Explicit subsidiary or team headers present in the body (e.g., "토스뱅크", "Tech Team" as section headings)
- (b) Separate sub-position sections each with distinct requirements
- (c) Multiple distinct apply CTAs within the same page

**Weak signals** (keep as single combined JD):
- Simple "외 N개 계열사" text mention without separate content blocks

**Fan-out procedure**: Produce one child JD per distinct position. Each child JD frontmatter must include:
- `parent_url`: the original anchor URL (shared by all siblings)
- `sub_position`: the subsidiary/team name for this child

`role_title_verbatim` = `"<original_title> — <sub_position>"`. `role_title_slug` includes `sub_position`.

**Presence-coupling rule**: `parent_url` and `sub_position` are presence-coupled — both present or both absent. A record with only one of the two is invalid.

**Dedup impact**: L1 dedup key is `(company_slug, role_title_slug)` — siblings with different `sub_position` values are naturally distinct. `parent_url` field is used for sibling relationship awareness only.

**CRITICAL**:
- Ignoring strong signals and saving as a single JD is forbidden.
- Saving with `parent_url` present but `sub_position` absent (or vice versa) is forbidden.

→ Details (strong/weak signal classification, fan-out procedure, presence-coupling, rationalization loopholes, counterexample): [reference/ingest-and-curation.md#detail-split-auto-fan-out](reference/ingest-and-curation.md#detail-split-auto-fan-out)

## Identifier Kind Heuristic (MANDATORY)

On first registration of a source, automatically infer the `identifier_kind` by sampling anchor URLs from the listing page.

**Heuristic algorithm**:
1. Collect all anchor URLs from the listing page.
2. Count how many match a monotonic-looking ID query pattern: `?<param>=\d+` (e.g., `?job_id=123`, `?posting_id=456`).
3. If ≥ 80% of anchors match a single such param → `identifier_kind: id_query`, `identifier_extractor: <param_name>`.
4. Else if anchor URLs remain stable across runs (no query drift) → `identifier_kind: url`, `identifier_extractor: null`.
5. Else (URLs vary per run — query params added, reordered) → `identifier_kind: fingerprint`, `identifier_extractor: <hash spec, e.g., "role_title_verbatim + first_200_chars_of_body">`.

**After heuristic**: Report result to user with match statistics. Example: "Detected `identifier_kind: id_query` with extractor `job_id` (218/236 anchors match `?job_id=\d+` pattern). Confirm or override?" Wait for user confirmation before writing to `sources.yaml`. User may override by editing `sources.yaml` directly.

**CRITICAL**: Silent default (`url`) without running the heuristic is forbidden.

→ Details (heuristic pseudocode, user report format, override procedure, rationalization loopholes, counterexample): [reference/dedup-and-discovery.md#identifier-kind-heuristic](reference/dedup-and-discovery.md#identifier-kind-heuristic)

## Phase 0: Profile Interview Required (MANDATORY)

When `$OMT_DIR/collect-jd/profile/profile.yaml` is absent, a **minimum 3-round** profile interview (`AskUserQuestion`) is required before JD collection. Round 1: career history, years of experience, preferred domains. Round 2: tech stack, strengths. Round 3: company, salary, location, remote work, exclude preferences. After the interview, atomic write `profile.yaml` (includes `version: 1` field). If profile exists, proceed to normal collection. **5 rationalization patterns blocked** — urgency, being in a hurry, or having received a URL are none of them valid reasons to skip the interview.

→ Details (rationalization loopholes, purpose explanation): [reference/bootstrap.md#phase-0-profile-interview-required](reference/bootstrap.md#phase-0-profile-interview-required)

## Dedup (L1 URL/slug + L2 LLM similarity)

Run dedup in L1 → L2 order before writing a new JD file (MANDATORY).

**CRITICAL — Dedup Check Gate rules**:
- Even if `jobs/` is empty, the L1 gate **must be recorded as executed**. "Skip because jobs is empty" is forbidden — trivial-pass must not be silently processed; must be explicitly logged as "L1 gate executed: 0 candidates".
- Even when L2 conditions are not met (0 JDs for the same company_slug), record "L2 gate evaluated: not applicable" in audit.
- Saving without running the dedup gate is forbidden. If `fingerprint_check` field is empty, reject the save.

→ Dedup Gate Enforcement details: [reference/dedup-and-discovery.md#dedup-check-gate-enforcement](reference/dedup-and-discovery.md#dedup-check-gate-enforcement)

- **L1**: After `normalizeUrl()`, match by URL or `(company_slug, role_title_slug)`. On match, new file creation is forbidden; only `last_checked_at` is updated. URL match + TTL (30 days) exceeded → enter L2.
- **L2**: L1 no-match + another JD for the same `company_slug` already saved → LLM similarity judgment (`reference/dedup-l2-prompt.md`, temperature 0). `same: true` → new file forbidden + `fingerprint_check: duplicate_of:<url>`. `same: false` → save new + `fingerprint_check: unique`.
- `max_l2_calls_per_batch: 50`. If exceeded, `fingerprint_check: pending` — not a skip; re-evaluate in next batch.

→ L1 details (loopholes, counterexample): [reference/dedup-and-discovery.md#dedup-layer-1](reference/dedup-and-discovery.md#dedup-layer-1)
→ L2 details (invocation contract, loopholes, counterexample): [reference/dedup-and-discovery.md#dedup-layer-2](reference/dedup-and-discovery.md#dedup-layer-2)
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

- [reference/bootstrap.md](reference/bootstrap.md) — Session-init rules (Phase tasks, Session Lock, Storage Backend, Atomic Write, State Location, Profile Interview)
- [reference/dedup-and-discovery.md](reference/dedup-and-discovery.md) — Source/listing rules (Sources Registration, Pagination, Coverage Verification, Per-Site Crawl Memory, Identifier Kind, Dedup L1/L2, Company-Name Ingest, Decision Flow)
- [reference/ingest-and-curation.md](reference/ingest-and-curation.md) — Per-JD rules (Detail Split, Matching Loop, Full Coverage Ingest, Exclude Flow, Reversal, Manual Edit Safety, Ingest Validation, Batch Report, Role Tagging, YAML Robustness, Rules Re-evaluation)
- [reference/frontmatter-schema.md](reference/frontmatter-schema.md) — JD file YAML frontmatter contract
- [reference/slugify.md](reference/slugify.md) — Slug normalization algorithm spec
- [reference/url-normalize.md](reference/url-normalize.md) — URL normalization spec
- [reference/dedup-l2-prompt.md](reference/dedup-l2-prompt.md) — L2 LLM similarity pinned prompt
- [reference/ambiguity-prompt.md](reference/ambiguity-prompt.md) — Matching ambiguity pinned prompt

## Tests

- `skills/collect-jd/tests/pressure-scenarios.md` — 13 pressure scenarios (Phase B TDD evidence stubs)
- `skills/collect-jd/evals/trigger-eval.json` — trigger eval spec (flat shape)
