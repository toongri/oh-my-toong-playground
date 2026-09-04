English | [한국어](review-quality.md)

---

# Review & Quality Skills

oh-my-toong's review and quality skills systematically verify the completeness of code, design, and slides. Each skill has a clear review target and role boundary, and they can call each other or be combined.

---

## Summary Table

| Skill | One-line role | Primary input | When to use |
|-------|---------------|---------------|-------------|
| `code-review` | Correctness-bug review of PRs and diffs. Directly dispatches its own multi-AI angle-finder job | PR number, branch name, or current branch | Before merging code changes |
| `design-review` | Tradeoff tension analysis of designs and plans | Design question, plan doc, architectural concerns | Reviewing an architecture decision or implementation plan |
| `slides-review` | Visual design review of HTML slides | HTML file path | After create-slides, or when improving HTML slide aesthetics |
| `qa` | Implementation correctness verification guardian | QA REQUEST (Spec + Scope + verification method) | After implementation is done and needs independent QA |
| `explain-diff` | Turns a diff into teaching material and measures the reader with a quiz | A git range (e.g. `main..HEAD`) | Understanding an unfamiliar PR, or handing a large agent-authored diff to a human |

---

## Skill Details

### code-review

**Purpose**: Reviews code changes for correctness bugs before merge. The unit of review is not the diff alone but the *system the diff produces*. Candidate findings are sourced directly by code-review's own multi-AI angle-finder engine (`skills/code-review/scripts/`), with no separate orchestration skill in between.

**What it reviews**:
- Correctness bugs — whether changed code behaves correctly end-to-end against the surrounding system
- Dependencies, callers, callees, interfaces, configurations, and runtime context across file boundaries
- Classifies each finding candidate as CONFIRMED / PLAUSIBLE / REFUTED
- Assigns each verified finding a class (`correctness`/`regression`/`cleanup`/`requirement-gap`, 1:1 with the angles) and an impact (`HIGH`/`MEDIUM`/`LOW`, by case lists + angle defaults) — verdict measures confidence, impact measures harm
- Persists the full 7-field cards to `$OMT_DIR/code-review/<sid>/findings.md` — the basis for later re-adjudication
- At higher effort levels, may also include simplification, reuse, and efficiency findings

**Non-negotiable premises**:
1. **Working directory = post-change state**: Read the file system freely to trace dependencies.
2. **No diff-only review**: A diff is a delta. The review target is the system it produces.

**Multi-AI angle-finder job**: code-review dispatches a **single finder job** scoped to the entire reviewable diff. Previously a large diff was split into chunks that a separate orchestration skill (`orchestrate-review`, now retired) coordinated as conductor; now the whole reviewable file set always goes into one job, with no chunking and no separate conductor step, regardless of diff size.

- **Split across 4 angles** — `correctness` (correctness + exploitability; absorbed former line-scan + cross-file + security) · `regression` · `cleanup` (cleanup plus a light-touch Test value lens) · `requirement` (AC mapping or intent inference; absorbed former coverage). Each angle is a separate CLI invocation fanned out in parallel inside the one finder job, and each collects candidates independently — none assigns a verdict (CONFIRMED/PLAUSIBLE/REFUTED); that is left to code-review's own verification step.
- **Oversized diffs get a single pass plus a notice, not chunking** — when `reviewableInsertionLines ≥ 2000` or `reviewableFileCount ≥ 30`, the report gets exactly one prepended line: "this change was reviewed in a single pass; coverage may be incomplete for a change this size — consider splitting it into smaller reviews." This is a plain notice, not a finding, a class, or a gate — it does not affect ranking, verdicts, or completion.
- **Static review only**: finders and the in-session fallback do not run tests, builds, linters, installers/installs, or project code. Candidates are grounded with the diff, source reads, and searches only; when static evidence cannot resolve something, the review surfaces uncertainty or a coverage limitation instead of executing it. The job's lifecycle commands (`job.ts` `start`, `collect`, `resume-member`, `results`, `stop`, `clean`, plus `usage-summary.ts`) remain available.
- **If all finders are unavailable** (no config, CLI not installed, timeout), code-review itself falls back to in-session finder mode directly. The static-review restriction still applies to the fallback.
- `requirement` only maps supplied acceptance criteria (ACs), or infers intent from the diff when ACs are absent.
- `cleanup` owns a light-touch Test value lens: false confidence or fake coverage, verification value versus feedback-loop cost, and implementation-coupled or unstable tests. It is not a scoring rubric.

**How the execution restriction is applied**:
- A prompt contract and dedicated Claude/Codex PreToolUse guard twins (`review-exec-guard.sh` / `codex-review-exec-guard.sh`) work together. Both guards use one shared shell invariant to judge the same high-cost commands.
- At the JVM boundary, only calls whose basenames are `gradle`, `gradlew`, `mvn`, or `mvnw` are covered, and only enumerated high-cost Gradle tasks and Maven phases are blocked. Gradle blocks `test` (including qualified/suffixed forms), `build`, `check`, `assemble*`, `compile*`, `classes`, `lint*`, `ktlint*`, and `detekt*`; Maven blocks `compile`, `test-compile`, `test`, `integration-test`, `package`, `verify`, `install`, `ktlint:check`, and `detekt:check`.
- Direct lint/compiler execution through `ktlint`, `detekt`, `kotlinc`, and `javac`, plus project-code runtime execution through `java` and `kotlin`, is also blocked. Conversely, unenumerated Gradle/Maven calls default to allow; only pure help/metadata queries and version queries receive special query-exception treatment. A call that mixes a query with execution is not an exception.
- This query exception does not mean zero-cost or purely static work. Gradle/Maven queries may still configure projects or resolve and access plugins and dependencies, so they are deliberately narrow usability exceptions within static review.
- Workers receive `OMT_REVIEW_ROLE=member` to mark the member review context (set at spawn, gone at exit). A conductor session is gated only while its `conductorSessionId` in job metadata matches the current session AND that chunk-review job is still active — a live finder member, judged by the shared `findActiveMembers` predicate. A stale job left awaiting GC after the review no longer gates the conductor, so the conductor's legitimate execution after the review is not falsely blocked.
- The restriction activates only in review context. The same high-cost command remains unblocked by these guards in a normal development session.

**Process cleanup**: Each finder runs as its own worker process, reaped through three independent paths — the worker's own exit path, job cleanup (`clean`), and reclamation when a new session starts. The latter two only signal when they can confirm the process group is still this job's own, so a conductor that never reaches its own cleanup step isn't always backed up by the other paths. Which MCP servers a worker can start is also restricted by an allowlist (`mcps.allow`) in the job config; leaving it unset blocks every server this engine enumerates (opt-in, fail-closed). Its sibling setting under the same `settings:` block, `deny.skills` (which blocks specific skills a review worker can invoke), defaults the opposite way: leaving it unset blocks nothing (a no-op). A worker's ability to spawn subagents is switched off by `deny.subagents: true` in the same block — all four job-dispatching skills (code-review, design-review, diagnose, agent-council) declare it, and it is translated per member CLI (codex: `agents.enabled=false`, claude: a permission deny on the spawn tool, opencode: `permission.task: deny`). Declaring either axis while a member runs a CLI with no enforcement lever (gemini, unrecognized) makes `start` exit 1 before any job directory is created.

**How to invoke**:
```
/code-review                      # Auto-detect current branch vs origin/main
/code-review pr 123               # By PR number
/code-review main feature/auth    # Branch comparison
```

**Flags**:
- `--comment` — Post findings as inline PR comments
- `--fix` — Apply findings to the working tree directly

**When to use**: Before merging any code change. Works without a PR via branch comparison or auto-detect mode.

---

### design-review

**Purpose**: An advisory review channel for design documents, plans, and architectural decisions. It steelmans the strongest possible antithesis and surfaces tradeoff tensions — analysis counsel, not a verdict gate.

**What it reviews**:
- Tradeoff tensions and hidden costs
- Alternatives the design may have overlooked
- Architectural considerations — boundaries, dependencies, scalability
- Builds the strongest counter-argument, then provides counterpoints to it

**Workflow**: By default, dispatches analysis to a Codex `gpt-5.6-sol` member with `high` reasoning via a job. `generic-job` enforces both `settings.deny` and `settings.mcps.allow` when running the member. The MCP allowlist is opt-in and fail-closed; the current `design-review.config.yaml` allows only `codegraph`. Falls back to in-session analysis if no member is available (`missing_cli`, timeout, empty config).

**When to use**: Architecture decisions, implementation plan reviews, tradeoff analysis. Trigger phrases: "design review", "plan review", "review the plan", "architectural soundness", "설계 검토", "플랜 리뷰", "아키텍처 건전성", "트레이드오프 분석".

---

### slides-review

**Purpose**: Reviews the visual design quality of HTML slide files using Gemini CLI, then applies the returned improvement directives directly to the CSS/HTML in the main session (Claude).

**What it reviews**:
- Visual design completeness — layout, typography, color, spacing
- Alignment with the stated design path (e.g., frontend-design)
- Adherence to caller-specified protection rules (items must not be modified)

**Invocation patterns**:
- **Called from another skill**: Wired as a post-processing step from `create-slides` and similar skills
- **Direct user invocation**: Provide the HTML file path and review starts immediately

**When to use**: After generating HTML slides when you want to raise visual quality. If Gemini CLI is unavailable or fails, in-session fallback provides the review. Trigger phrases: "디자인 리뷰", "slides review", "슬라이드 리뷰", "gemini review", "design review".

---

### qa

**Purpose**: Quality assurance guardian that verifies implementation correctness. This skill operates under the principle: "Nothing ships without proof."

**The cycle**: PRE-FLIGHT (contract gate) → PLAN (actor roster + scenario derivation) → BASELINE (build/test/lint) → ADVERSARIAL E2E (drive it for real + 6 coverage axes) → CHECK → on failure, a DIAGNOSIS→FIX→RE-VERIFY loop (≤5 cycles) → EXIT → CLEANUP → ROLLBACK → STATE. One invocation owns everything from detection through fix and re-verification, and the fixer (`sisyphus-junior`) never certifies its own fix. Rows 7–9 are per-run checks — stale-state, dirty-worktree, and flaky-rerun — recorded separately from the coverage axes.

**Enforced record chain**: PLAN first pins the actor roster, then adds stories per actor and derives the six coverage-axis cells plus the `hang-timeout` (axis 1) and `flaky-green` (axis 5) sub-items for each story. Attack points, priorities, baseline/cell outcomes, and per-run checks must be recorded through the state CLI before the cycle can advance. `set-acceptance` accepts only a JSON array of non-empty strings. Chain completeness, referential integrity, current-cycle evidence, and the phase funnel are checked by the Claude/Codex runtime gates; drivers are blocked while the roster is missing or once BASELINE+ has an incomplete chain (PLAN reachability probing remains available).

**Completion and exceptions**: `APPROVE`/`COMMENT` require every required record and evidence predicate to pass, while `REQUEST_CHANGES` remains open for an honestly recorded failure or a genuine pre-execution fail-fast. Cell waivers require a reason and are user-only; the AI path is denied. Direct writes to `qa-state-*.json` are denied, and the close order is `set-verdict` → HTML report → `complete`. Codex obtains the same state and runtime gates through its seed hook.

**Actor-boundary principle**: the **Actor Roster** is pinned before any scenario is written — actor · the boundary that actor actually touches (screen, endpoint, CLI command) · the driver that reaches it · whether it is reachable. A function, class, or internal module is never a boundary. Every **self-authored** scenario is entered at its actor's boundary; when the boundary is unreachable, **only the last unreachable hop is faked** so every layer above it still executes. When even that is impossible the scenario is `NOT-RUN`, not PASS — and an `H`-priority scenario left `NOT-RUN` blocks APPROVE. A **caller-provided** scenario is exempt from this relocation and runs verbatim at whatever layer the caller chose, but not from disclosure: its `driven-at` records the layer it actually entered, and it supports no claim above that layer.

**Product use-case breadth**: scenarios are not derived from the risk axis alone. The verifier builds a product-context map itself — reading the navigation, deeplink/push handlers, and data writers around the changed surface — then walks three axes: arrival paths (including deeplink/push entry), adjacent state transitions (flows elsewhere that mutate what this surface shows, like a dispense decrementing stock), and lifecycle stances (freshly onboarded, daily use, just after maintenance), deriving realistic multi-step scenarios and naming all three axes' coverage in the coverage delta.

**Precondition bootstrap**: a boundary may be declared unreachable only after the bootstrap ladder is exhausted. For a source change not yet deployed, **stand up an isolated local stack you own** (its own ports, data directory, containers) and run QA against it — for maximum freedom to seed, mutate, interrupt, and reset any account/data state. Stand up whatever the scenario needs to run and to give you that control, never a fixed checklist: a component comes up because a scenario depends on it, not because it was the thing that changed (a server-logic change still brings its database up locally), while a change whose actor boundary is a command or job trigger may have no service, database, or bundler to stand up at all. Read the project's environment-setup commands and docs (boot command, required env vars, local config) and apply them; a local process that fails to start on a missing or misconfigured env is a config to supply, not a reason to stop, and a shared or fragile local environment is neither a blocker (bring up your own) nor something to corrupt (a stack another session or developer is using) — except when the QA target is the deployed artifact itself, where the deployed environment is the boundary and a local stack proves nothing about it. When the block is an account, authentication, or a data state, **the documented QA provisioning protocol comes first** — the project's documented protocol, when it has one, lists a set of pre-provisioned test accounts and the data state each carries (already has a Program vs. a bare household), the admin/operator QA seeding tool, the auth method, and the command that stands the local stack up with its env prerequisites; read it and pick the account/tool it prescribes for each scenario's data state before touching a driver, and when no such protocol is documented, record that and fall through to the ladder. Hand-rolling signup/onboarding or injecting dummy credentials before trying the pre-provisioned account or seeder the project documents is a wrong detour, not a bootstrap — the improvise options are the fallback for when the documented path is absent or, once tried, unusable. Then the ladder — an undeployed environment is answered by standing up locally whatever the scenario needs to run, and (only when no documented path exists, or the documented path was tried and proved unusable) missing data by creating seed data, a missing account by running the signup flow or injecting a test token, and a precondition satisfiable only on another platform by launching that platform too and satisfying it for real. Only a genuinely external dependency outside your control is faked. When the QA target is the deployment itself (a release, deploy config, routing, migration, or packaged artifact), the deployed environment IS the boundary: its 404 is the failure under test, not a precondition to bootstrap around, and a local stack proves nothing about the deployed artifact. QA is never confined to the platform where the change landed — every platform where an actor observes the change, and every platform holding a precondition, enters the roster.

**Evidence**: every executed scenario carries actor-perspective `before` / `action` / `after` evidence — the state that actor actually observes. A launch, splash, or landing capture is not scenario evidence. Internal signals (server logs, DB rows) are supporting evidence, never a replacement.

**HTML report fidelity**: The STATE report renders the `qa-state` record as-is. The reader-facing `유저 시나리오 · 근거` section is story-level and clean — per story it shows a **natural-language scenario narrative** (what was done and observed, `scenarioFlows`) and **screenshots only**, alongside a plain-language coverage summary (the six adversarial axes by name, never the `cls` number). Raw text evidence (curl/HTTP/JSON dumps, terminal output) and baseline build/test logs are **never shown in the reader** — a PO/designer cannot read `HTTP=404` as "it works" — but moved to a collapsible `원본 관찰 로그` (`<details>`) inside the audit section, preserving self-containment and traceability only. Screenshots stay inline in the reader because a rendered screen is directly readable by a PO. The cell record's implementation-flavored fields (`cls`, `attack_point`, `driven_at`, `na_reason`, the actor's `boundary` code path) are likewise kept out of the reader and rendered in the record-faithful `시나리오 상세 기록 (감사)` section below (one row per cell, with its evidence paths), so a context-free reader meets no implementation leakage while full traceability is preserved; a story whose verified scenarios carry no **recorded** evidence renders a loud gap (a text-only API scenario is not gapped — its evidence lives in the audit). Evidence that is unreadable or exceeds the embed budget remains represented by its recorded path without aborting report generation. A fresh `start` clears `acceptance_criteria` so a new report cannot inherit the previous cycle's criteria, and the current view excludes prior-cycle baseline and run-check records while raw state/history retains them. Its `Failures & Mismatches` section includes failed cells plus failed baselines and stale-state, dirty-worktree, and flaky-rerun per-run checks with their recorded notes; waiver targets identify `story/cls/sub`. Evidence embeds are capped at 2 MiB per file and 16 MiB cumulatively; files beyond either cap remain represented by path. Browser-tool installation prefers an ephemeral directory outside the checked worktree, and any target manifest, lockfile, or `node_modules` changes are restored and re-checked before CHECK.

**Presentation layer (context-free PO readability)**: Above the verification log, the report leads with a reader-facing presentation layer for a PO/designer with no prior context. It is product/user-centric, not a code-diff summary — it defines every user this change affects (admin / product / conditional / partner …), each user's software+hardware scenario flows, a big-picture diagram (mermaid baked to inline SVG at build time), and each acceptance criterion's satisfaction verdict (yes/no/partial/unverified) with its evidence. A requirement whose user boundary could not be driven (unreachable environment, a NOT-RUN scenario) is marked `unverified` only — it renders LOUDLY as "미검증 — 유저 경계 미구동", and a green test suite is never grounds for `yes`. A cell's evidence must be a user-boundary observation (screen/device state, the client-received API response, the CLI terminal); `record-cell` mechanically rejects a unit/integration test-runner report (`vitest`/`jest`/`pytest`/`go test` output) as evidence — a test log's sole home is BASELINE via `record-baseline`. This narrative is supplied through the `--narrative` `presentation` object but anchored to recorded facts — `affectedUsers` keyed by actor id, `scenarioFlows` by story id, and `requirementMapping` keyed by AC index, with each entry carrying structured `cellRefs` to recorded current-cycle story/coverage cells. The report validates each ref's identity and the cell's `pass`/`fail`/`na` status, so `yes`/`no`/`partial`/`unverified` are grounded claims about those cells. Missing, legacy, malformed, stale-cycle, unknown-story, or status-ineligible mappings fail closed to a visible neutral gap; prose `evidence` is explanatory only. Prose for an actor absent from the roster is ignored and the layer cannot invent or drift (an affected user missing from the roster is fixed with `add-actor`, not invented in prose). Any required slot left unwritten renders a visible gap marker, and `skills/qa/presentation.md` owns the authoring contract, the JSON shape, and the self-audit.

**Critical distinction**: Automated tests and hands-on QA are not substitutes. Automated tests verify "code behaves as intended." Hands-on QA verifies "the actor's path works as in production." Evidence sets collected at different depths never merge into a deeper claim.

**How it is called**: In a `sisyphus`-orchestrated pipeline, invoked with a QA REQUEST after implementation is complete. Can also be called directly by the user for standalone verification.

**When to use**: When implementation is done and you need independent quality assurance against a spec.

---

### explain-diff

**Purpose**: Makes a code change *understood*. Where code-review asks "does this diff have bugs", explain-diff asks "did the person reading this diff actually understand it". The completion condition is a person, not a document — writing the explanation does not finish the job; the reader passing a written quiz does.

**Nine steps**: `evidence` (classify changed files as signal or noise) → `background` (two tiers — deep and narrow — with a skip marker for readers who already know it) → `architecture` (system/component/domain structure in mermaid — each level carries a diagram or a reasoned waiver). If there are no diagrams and all three levels have reasoned waivers, R12 can pass only with a judge quote containing all three waiver sentences; if any diagram is present, it still needs diff identifiers and a changed-marker proof → `intuition` (toy-value examples with sanctioned components) → `commits` (the narrative of how the commits accumulated — every hash is checked against Commit Journey headings) → `code` (walkthrough by Change Group) → `render` (self-contained HTML with mermaid pre-rendered to inline SVG from the current Markdown, plus a technical-writing report ending with `REVIEW: APPLIED` and a final checklist whose last non-whitespace line is exactly `CHECKLIST: ALL PASS`) → `quiz` (written questions, graded). The document's visual language is owned by the template (`references/markdown-template.md`) and render.ts; the structural check (R11) rejects actual-document `<style>` blocks, inline `style=` attributes, and unsanctioned classes, while excluding fenced and inline code examples.

**Architecture structural checks**: In the `architecture` step, the structural-check script verifies all three levels — system, component, and domain — and requires each level to have either a diagram or a reasoned waiver. The system-level slice must include the three system-contract axes — `server API`, `DB schema`, and `client dependency` — and a real rendered standing-interface Markdown table. Separately, the `Architecture` section must also include the `boundary/dependency/use-case` change map in the distinct sub-block checked by R15. The standing-interface table must be an actual table with the header `| 경계 | 인터페이스 | 오가는 것 |`, separator `|---|---|---|`, and at least one data row; prose describing it, a fenced-only example, or a header/separator-only table is not sufficient. At the component level, the script accepts a reasoned component-level waiver; otherwise it checks every authored `arch-entity` card independently for its `package`, `responsibility`, `interface`, and `change-point` (`변경점`) fields plus `data-change`, so one complete card cannot mask an incomplete or invalid card. Only `new`, `mod`, and `del` are valid `data-change` values; prose-only mentions or invalid values do not satisfy the entity checks. At the domain level, the script accepts a reasoned domain-level waiver; otherwise it checks every authored `arch-entity` card independently for its `responsibility`, `core-members` (`핵심 멤버`), `change-point` (`변경점`), and `data-change` fields, and a `classDiagram` must fill each class box with members and methods (R21). It also checks rendered Architecture prose for methodology names or leaked `horizontal`/`vertical` axis labels.

**Document format contract**: Each step is checked only against the slots that step is responsible for filling. `evidence` checks that every signal file appears somewhere in the document and that `## Evidence` contains a `### 원천` subsection with a real table whose exact four-column header is `종류 | 식별자/경로 | 확보 | 내용 요약`, followed by a separator and at least one data row; headings or tables that exist only inside a fenced block do not count. `background` checks the deep/narrow tiers plus the skip marker; `goal` checks the `## 목표` section's three slots — `### 무엇을·왜`, `### 핵심`, and `### 출처` (state purpose + one-line core before any code, plus the source slot, R16); `code` checks the Change Group's title/preview/ordering-rationale slots, every "why is this needed" block's provenance (`[근거: "…"]` quote / `[추론: …]` inference / `Unknown / not supplied`), the required `base:`/`head:` anchor for each file side that has lines, and that each signal file appears at least once in a Change Group block (`evidence` only checks that a file appears; `code` requires at least one citation in a change block's location anchors). A script decides all of this (`lib/explain-diff-structure.ts`). A judge is only involved for three items: the architecture R12 gate (diagram-to-diff correspondence when a diagram is present, or all three reasoned waivers when none is present), the concrete example at `intuition` (R6), and the Change Group order coherence at `code` (R7); the other six steps have no required judge item and pass with an empty array. R12 requires a judge quote containing the relevant proof: real system identifiers plus a changed marker (the 시스템 레벨 must be actual cross-process/service boundaries, not an in-process call chain; unchanged context nodes are allowed), or all three waiver sentences. A judge that passes an item without a quote — or whose quote is not a literal substring of the document — fails automatically. The `render` step replaces this structural check with an artifact check — the HTML exists and is non-empty, was regenerated from the current Markdown (so stale HTML from an older Markdown is rejected), every authored mermaid fence was pre-rendered to an inline SVG (mmdc), the technical-writing report ends on its verdict line (`REVIEW: APPLIED`), and the final checklist's last non-whitespace line is exactly (`CHECKLIST: ALL PASS`). Visual layout is not checked per document — render.ts owns it deterministically (wide-diagram legibility is sealed by `normalizeSvgWidth` keeping the SVG at its natural viewBox width and the figure scrolling, regression-guarded by `render.test.ts`), so there is no per-document visual-qa gate.

**Architecture/R5 checks in the document contract**: The `architecture` slots are script-checked for all three levels, all three system-contract axes (`server API`, `DB schema`, `client dependency`), a real standing-interface Markdown table with the `경계`/`인터페이스`/`오가는 것` header and separator plus at least one data row, the `boundary/dependency/use-case` change map, and component-level `arch-entity` cards or a reasoned component-level waiver. A header/separator-only table, prose description, or fenced-only standing-interface example cannot replace the real table. Only `new`, `mod`, and `del` are valid `data-change` values; every authored component card is checked independently for `package`/`responsibility`/`interface`/`change-point`/change kind, so a complete card cannot mask another card's omission or invalid value. The domain level likewise requires `arch-entity` cards or a reasoned domain-level waiver; each card is checked independently for `responsibility`/`core-members` (`핵심 멤버`)/`change-point` (`변경점`)/`data-change`, and every `classDiagram` box must contain members and methods (R21). Rendered Architecture prose is also checked for methodology-name and `horizontal`/`vertical` axis leakage. R5 is checked in the `code` step, not `architecture`: `start` passes the original range unchanged to `git diff`, preserving `A...B` merge-base semantics; only `git rev-list` commit enumeration normalizes `A...B` to `A..B`. `submit-step` validates textual hunk ranges and numeric `base:`/`head:` anchors per file. A changed file with no textual hunk while another file has hunks uses the legacy per-file anchor-presence/placeholder fallback instead of being rejected as globally missing. Numeric anchors parse the final `:<number>` suffix and match the enclosing file-block path, including paths with spaces. A genuine first-line hunk may use line 1 on both sides; when metadata is absent or a file has no textual hunk, a modified file's `:1 → :1` placeholder is rejected. Added files use only the `head` side with file lines, deleted files only the `base` side, and a zero-count side has no file lines and needs no anchor.

**Three-layer enforcement**: (1) the state CLI (`explain-diff-state.ts`) is the only writer of the state file, (2) a PreToolUse artifact guard gates writes under `$OMT_DIR/explain-diff/`, and (3) a Stop gate refuses to let the session end before the quiz passes. If the state is absent, recover it first with `explain-diff-state.ts start --range "<git range>" --slug "<slug>"`. The active-state idle TTL is 6 hours, and the terminal-state TTL is 30 minutes. Unlike every other OMT guard, the artifact guard is **fail-closed**: absent, expired, or unreadable state (no `jq`) all deny. That inversion is scoped to that one directory; every other path stays fail-open.

**No quiz exemption**: No reason — time pressure, a user request, exhausted retries, "we only need the document" — reaches a completed state without the quiz being solved. A state with zero required concepts does not count as complete either (the empty set is not vacuously satisfied). Failing the same item twice with an unchanged document marks the session `stalled`, a deadlock only the user can clear.

**How it is called**: The user explicitly invokes `$explain-diff` (`disable-model-invocation: true` — the model never triggers it on its own). Claude SessionStart restores only a genuinely progressed, non-pristine session; the initial pristine `evidence` seed is not treated as a session to restore or continue. On Codex, the `UserPromptSubmit` hook resolves each explicit `$skill` mention to the nearest project-local protected skill first, then the global protected skill, and injects the full `SKILL.md` as trusted `additionalContext`. The generic invocation marker is only an invocation audit/integrity record, never authorization. The PreToolUse gate always rejects a literal direct read of a model-disabled `SKILL.md`, regardless of whether a marker exists or has been forged. The current-session `codex-skill-invocation-marker-<sid>-*` marker namespace also receives the write guard's best-effort literal-path protection. The dedicated explain-diff seed handles prompt mentions only; opening the skill file no longer seeds state.

**When to use**: Before reviewing an unfamiliar PR, when onboarding onto a subsystem through its history, or when handing a large agent-authored diff to a human.

---

## Skill Selection Guide

```
What is the review target?
  |-- Code changes (PR/branch)      -> code-review
  |-- Design or architecture plan   -> design-review
  |-- HTML slides                   -> slides-review
  |-- Implementation done, need QA  -> qa

Need to understand it first?
  |-- A human must understand the change -> explain-diff (then code-review)

When you run code-review:
  It dispatches its own multi-AI angle-finder job directly (single job, no chunking).
  There is no separate orchestration skill to invoke first.
```

---

## References

- [README](../../README.en.md) — Project overview
- [Core Pipeline Skills](./core-pipeline.en.md) — prometheus, sisyphus, sisyphus-junior
- [Research Skills](./research.en.md) — ultraresearch, insane-browsing
- [Authoring Skills](./authoring.en.md) — Document and slide generation
- [Knowledge Graph & Pins](./knowledge-graph-pins.en.md) — Graphiti, Pin skills
- [Utilities & Personal](./utilities-personal.en.md) — Configuration, keybindings, and more
