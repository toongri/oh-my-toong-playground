# Code-Review Test Results

> **Superseded (2026-06-03).** The earlier RED/GREEN/REFACTOR results in this file
> tested the previous design — a P0–P3 severity Chairman that aggregated per-model
> reviews and computed merge verdicts. That design has been reshaped:
>
> - `orchestrate-review` is now a **Finder Conductor** that fans out one finder per
>   review **angle** (line-scan / regression / cross-file / cleanup, all on
>   codex today) and merges **un-judged candidates** — no severity, no verdict.
> - `code-review` now **verifies** each candidate via a **verifier fan-out** — one
>   subagent per candidate reads the code and returns a **verdict**
>   (CONFIRMED / PLAUSIBLE / REFUTED); REFUTED is dropped. It then **synthesizes** a
>   **report-only** output ranked correctness-before-cleanup, CONFIRMED-before-PLAUSIBLE.
>   There is no P0–P3 grade and no merge gate.
>
> The prior P0–P3 / Chairman / per-model-verdict results below no longer describe
> current behavior and are kept only as history.

## Current behavior — what to (re-)run

Scenario specs for the reshaped skills:

- `worker-prompt-scenarios.md` — each angle loads its lens by member name; finders emit candidates, never severity/verdict.
- `application-scenarios.md` — conductor fan-out, merge, degradation, no-judgment.
- `conductor-scenarios.md` — cross-angle corroboration/dedup, degradation (4/3/1/0 → in-session fallback), manifest workflow, Bash+Read allowlist.
- `skills/code-review/evals/evals.json` — verify-step discipline: REFUTE false-positive races (Kafka/`fixedDelay`), surface the real HTTP-endpoint race as CONFIRMED.

## Executable contracts (green)

These run in CI and pin the doc↔CLI invariants the reshape had to preserve:

- `skills/orchestrate-review/scripts/template-consistency.test.ts` — `code-review` SKILL Step 5 placeholders ↔ `chunk-reviewer-prompt.md` Field Reference.
- `lib/review-skill-consistency.test.ts` — `resume-member` `--job` flag form ↔ handler; "Allowed Bash Usage" whitelist covers every subcommand the body uses.
- `skills/orchestrate-review/scripts/job.test.ts` + `lib/*.test.ts` — the shared job framework (config parse, spawn, collect, manifest, codex driver).

---

# History (previous design — superseded)

The sections that followed here recorded the P0–P3 Chairman TDD cycle (RED baseline,
GREEN per-scenario verification, REFACTOR loophole fixes, Severity Rubric tests,
Worker Prompt tests). They are removed to avoid implying the old behavior is current.
See git history for the prior contents.
