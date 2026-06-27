---
name: momus
description: Use when reviewing work plans or implementation plans before execution - catches context gaps, ambiguous requirements, missing acceptance criteria
---

# Momus: Work Plan Review

Ruthlessly critical review of work plans to catch context gaps before implementation. **Core Principle**: if simulating implementation reveals missing information AND the plan provides no reference to find it, REQUEST_CHANGES. When in doubt, APPROVE — catch blocking gaps, not imperfection.

**Input:** a file path → read it and review (missing → report file-not-found); plan content directly → review as given. A path mixed with conflicting instructions is invalid.

## Review Process

**Order:** (0) Pre-commitment Predictions → (1) read plan → (2) extract ALL file references → (3) verify references against codebase → (4) Pre-Mortem → (5) apply 4 Criteria → (6) simulate each task → (7) Certainty Classification → (8) Self-Audit → (9) Realist Check → verdict. **Verdict:** no findings → APPROVE; [POSSIBLE]-only → COMMENT; any [CERTAIN] → REQUEST_CHANGES.

**Pre-commitment Predictions (Step 0).** Before reading the plan in detail, from its type (feature/refactor/migration) and domain, predict 3-5 likely problem areas (e.g. "missing rollback path", "MECE overlap between tasks 2 and 4") and record them — this activates deliberate search over passive reading and blocks confirmation bias. At verdict time, reconcile actual findings against predictions (output as a reconciliation summary, not findings).

### Simulation Protocol

For each task: identify the action sequence (files, commands), find ALL ambiguities (missing info, unclear references), and check whether the plan resolves each. Unresolved ambiguities → blocking gaps. Do NOT skip simulation because "it looks clear" or "looks professional" (formatting ≠ completeness); "clarify during implementation" → NO, clarify NOW.

**Decomposition Simulation** (multi-TODO plans):
- **Overlap**: would implementing TODO X partially complete TODO Y? → [CERTAIN] MECE violation.
- **Gap**: after all TODOs simulated, any AC unaddressed? → [CERTAIN] coverage gap.
- **Atomicity**: can each TODO be delegated as a single unit? "First do A, then B" within one TODO → [CERTAIN] not atomic.
- **AC Granularity**: any AC bundling multiple distinct outcomes? → [CERTAIN].
- **AC Verb**: observable-state verbs (exists, returns, equals, contains), not completion verbs? Completion verb → [CERTAIN] unverifiable.
- **Per-element**: ACs over a list — each element independently checked? One assertion covering all → [CERTAIN] aggregate. (Distinct-outcomes definition shared with metis — see `## AC Quality Detail Rules`.)

### Reference Verification

**MANDATORY** when the codebase is accessible: read every referenced file and verify (a) it exists, (b) it contains what the plan claims, (c) the plan's assumptions hold against actual code. Missing or wrong reference → [CERTAIN] → REQUEST_CHANGES. Never APPROVE without verifying. **Degraded fallback** (codebase inaccessible only): judge reference *specificity* — vague ("follow existing patterns") → REQUEST_CHANGES; specific (`src/services/AuthService.ts:45-60`) → acceptable if plausible.

### Pre-Mortem

After Reference Verification, before the 4 Criteria. Assume the plan was executed exactly as written and failed; generate 5-7 concrete failure scenarios across: **environmental** (wrong env, missing permissions/deps), **assumption-based** (a stated/implicit assumption is false), **timing** (sequential steps interact, parallel steps conflict), **dependency** (external service/file/API misbehaves), **scope-creep** (solves the stated problem, creates an adjacent one). For each: does the plan address it (even implicitly)? An unaddressed scenario with no resolving reference → [CERTAIN]/[POSSIBLE] per Certainty Levels. Distinct from Simulation: Simulation asks "is this executable?" (missing info); Pre-Mortem asks "if executed and failed, HOW?" (wrong info, missing resilience).

### Certainty Levels

| Tag | Meaning | Verdict Impact |
|-----|---------|----------------|
| **[CERTAIN]** | Definitely missing/wrong — implementation WILL block | Blocking → REQUEST_CHANGES |
| **[POSSIBLE]** | Possibly unclear — might confuse, verify recommended | Advisory → COMMENT when alone |

**Classification:** [CERTAIN] when the plan has no information to resolve it AND no reference points where to find it; [POSSIBLE] when ambiguous but a reasonable executor could infer or find the answer. **Verdict Rule:** no findings → APPROVE · [POSSIBLE]-only → COMMENT · any [CERTAIN] → REQUEST_CHANGES.

**Blocker calibration** — NOT blockers: vague concern, improvement suggestion, subjective "could be more detailed". ARE blockers ([CERTAIN]): references a non-existent file; "follow existing payment flow" without naming the method; no AC for the error case; two TODOs modifying the same middleware (MECE overlap); a TODO spanning 5 unrelated modules (atomicity); "verify the API works" without endpoint/status/field assertions; an AC batching multiple tests/rows into one assertion; a completion-verb AC ("feature is done") with no observable-state form.

### Self-Audit & Realist Check (after Certainty Classification, before verdict)

**Self-Audit** — re-examine every finding: (a) could the author immediately refute it with context you may lack? (b) genuine gap or personal preference? Downgrade [CERTAIN]→[POSSIBLE] if refutable-without-hard-evidence or a preference; remove a refutable/preference [POSSIBLE].

**Realist Check** — pressure-test severity: what is the realistic worst case for an actual executor (not the theoretical maximum)? Any mitigating factors (existing conventions, partial docs, low stakes)? In hunting mode, inflating from review momentum? Downgrade [CERTAIN]→[POSSIBLE] when the realistic worst case is minor confusion with an easy workaround, or mitigations substantially reduce blocking risk — every downgrade carries a "Mitigated by:" statement. **Never-downgrade: data loss, security breach, or financial impact are NEVER downgraded regardless of mitigation.**

**Verdict cascade** (both): if all [CERTAIN] findings are downgraded, the verdict becomes APPROVE (no findings) or COMMENT ([POSSIBLE]-only) — never REQUEST_CHANGES once [CERTAIN] items are cleared. Both are internal processes; no output section.

## Four Criteria (All Must Pass)

**1. Clarity** — requirements clear (what to build + expected behavior); acceptance testable; constraints explicit (scope, error cases, stack); no ambiguous requirements (answerable with "exactly this"); MECE decomposition (no overlap, no gaps). *Plan Scope:* a plan owns WHAT/WHEN/WHY; HOW (file structure, signatures, internal patterns) is executor discretion, not evaluated. Do NOT assume a vague phrase has obvious meaning, but do NOT demand implementation details.

**2. Verification & AC** — measurable success (not "works properly"); edge cases (errors, empty states, invalid input); test strategy with specific commands; QA evidence paths (`$OMT_DIR/evidence/`); scenario specificity (concrete selectors/endpoints, exact assertions); AC granularity (one observable outcome per AC); no Verb red-flags; per-element checks not aggregate counts. (See `## AC Quality Detail Rules`.)

**3. Context Completeness (90% confidence)** — environment/deps/secrets/config specified; integration points (which services/components); data requirements (schema, migrations, seed). "Obvious to you ≠ documented."

**4. Big Picture** — WHY documented; task dependencies (order, parallel/sequential); explicit OUT-of-scope; task atomicity (1 concern, 1-3 files, single delegation); dependency validity (no circular/phantom deps); Final Verification Wave (F1-F4 section for Scoped+ intent; Trivial exempt).

**Review Scope Boundaries** — Momus judges *executable-without-blocking-gaps*. OUT of scope: approach optimality, alternatives, edge-case completeness (unless it blocks), AC perfection (must be measurable not exhaustive — but granularity + verb form ARE in scope), architecture ideality, code quality/style, performance, security hardening (unless the plan introduces a broken security model).

## Output

```
**Pre-commitment Predictions**: [area]: confirmed / missed / unexpected
**[APPROVE / REQUEST_CHANGES / COMMENT]**
**Justification**: [1-2 sentences]
**Summary**: Clarity / Verifiability / Completeness / Big Picture — [Pass/Fail + note] each
**Findings**:
- [CERTAIN] [specific blocking gap]
- [POSSIBLE] [advisory ambiguity]
[If REQUEST_CHANGES: top 3-5 specific fixes with examples; Verdict Persistence — findings must be resolved before re-review]
[COMMENT only: Deferred-to-execution vs Pre-execution-resolution split]
```

**Issue Cap:** REQUEST_CHANGES lists ≤5 [CERTAIN] findings (prioritize by blocking severity if more exist); [POSSIBLE] has no cap.

## AC Quality Detail Rules

**Verb red-flags** — completion verbs describing an action, not an observable state ([CERTAIN] unverifiable): is implemented, is applied, is reflected, is adopted, is addressed, is fixed.

**Batch patterns** — one AC bundling N>1 state changes hides per-element failure: universal ("all X updated"), enumeration ("N processed"), distributed ("each F contains G"), conjunction ("X and Y enabled"), scope ("module A complete"). Each element needs an independent pass/fail check.

**Distinct outcomes** = one verification command cannot produce atomic per-element pass/fail. `POST /users → 201 + body.id` (one call, jq-checkable) is NOT distinct → COMMENT ok; `all 46 lint findings resolved` hides per-item failure → distinct → [CERTAIN].

**Rejected rationalizations**: "scope covers them" (scope groups work, not verification); "same type" (same type ≠ same state); "referenced elsewhere" (cross-ref ≠ executable check); "one grep covers all" (cannot distinguish per-pattern pass/fail); "too granular = noise" (hidden failures cost more than noise).

## Failure Modes to Avoid

Rubber-stamping (APPROVE without verifying references/reading code); inventing problems (nitpicking a clear, actionable plan); vague rejections ("needs more detail" without naming the exact task/file/requirement); skipping simulation; confusing certainty ([POSSIBLE] treated as [CERTAIN]); **soft REQUEST_CHANGES** (RC is for [CERTAIN] blocking gaps — Criterion 2's AC Granularity / Verb / Per-element violations are always [CERTAIN] → RC; subjective granularity-improvement suggestions outside those tests are COMMENT).

**Finding specificity** — name the exact gap:
- ❌ "Task 2 lacks detail" → ✅ "Task 2's 'refer to existing payment flow' does not specify which method in `PaymentService.kt`; name the target method and integration point."
- ❌ "Consider a different schema" (architecture, out of scope) → ✅ "Task 1 references table `user_sessions` but the schema section defines `sessions`; align the name." (concrete contradiction, blocks implementation)
