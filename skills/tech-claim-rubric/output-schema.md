# Role Vocabulary — Definitions Local to This Document

- **orchestrator**: a downstream consumer that reads this schema's INTERNAL fields and performs verdict and routing logic. It can access all internal fields and implementation details.
- **blackbox consumer**: a downstream consumer that reads only this schema's PUBLIC fields to use a stable contract. It does not access INTERNAL fields or implementation details.

# Examiner Output Schema (v4.1)

<!-- schema_version: "v4.1" -->
<!-- v4.0 changes:
  - Added structural_verdict (PUBLIC): exposes the A5 scanability axis's PASS/P1/FAIL as PUBLIC.
    Used by the blackbox consumer readability-fix routing trigger and orchestrator Loop 2 gate.
  - final_verdict derivation criterion: A1-A4 no FAIL AND count(P1 across A1-A4) < 3 AND structural_verdict ∈ {PASS, P1} → APPROVE.
    (through v3, A1-A5 all had to PASS; v4 uses a permissive criterion allowing up to two P1 verdicts)
  - Removed ownership-scope critical_rule_flag: replaced by the A4 ownership-scope axis's P1 verdict.
    (see a4-ownership-scope.md integrity_suspected)
-->
<!-- v4.1 changes:
  - interview_hints content upgraded to a four-element anchored scaffold (인용/문제/이유/제안, newline-delimited).
    The type remains string[]; final_verdict/structural_verdict fields and derivation logic are unchanged.
    Expanded Vocabulary rule: A[1-5] codes and English axis names (including Scanability) are forbidden in 문제/이유/제안 lines. The 인용: line is exempt.
-->

## Purpose

This document defines the `tech-claim-examiner` agent's output contract. Downstream skills such as blackbox consumers / orchestrators refer to this schema when parsing examiner output.

---

## Schema Definition

### Top-level fields

Every field is tagged PUBLIC / INTERNAL. Only the orchestrator can access INTERNAL fields.

```yaml
schema_version: string              # PUBLIC. ex: "v4.1"
bullet_text: string                 # INTERNAL (debugging context)
candidate_context:                  # INTERNAL
  years: int
  position: string
  target_company: string

verdicts:                           # INTERNAL (orchestrator-only)
  a1_technical_credibility:
    verdict: PASS | FAIL | P1       # INTERNAL
    reasoning: string               # INTERNAL
    evidence_quote: string          # INTERNAL
  a2_causal_honesty:
    verdict: PASS | FAIL | P1       # INTERNAL
    reasoning: string               # INTERNAL
    evidence_quote: string          # INTERNAL
  a3_outcome_significance:
    verdict: PASS | FAIL | P1       # INTERNAL
    reasoning: string               # INTERNAL
    evidence_quote: string          # INTERNAL
  a4_ownership_scope:
    verdict: PASS | FAIL | P1       # INTERNAL
    reasoning: string               # INTERNAL
    evidence_quote: string          # INTERNAL
    integrity_suspected: bool       # INTERNAL. default: false.
                                    # true if verb-scope inflation detected — v4 A4 sub-flag. See a4-ownership-scope.md
    integrity_note: string          # INTERNAL (optional, present when integrity_suspected == true)
  a5_scanability:
    verdict: PASS | FAIL | P1       # INTERNAL
    reasoning: string               # INTERNAL
    evidence_quote: string          # INTERNAL

critical_rule_flags:                # INTERNAL (orchestrator-only)
  r_phys:
    triggered: bool                 # INTERNAL
    reasoning: string               # INTERNAL
  r_cross:
    triggered: bool                 # INTERNAL
    reasoning: string               # INTERNAL

final_verdict: APPROVE | REQUEST_CHANGES   # PUBLIC
structural_verdict: PASS | P1 | FAIL       # PUBLIC. Directly exposes the A5 scanability axis verdict.
                                           # consumer contract:
                                           #   - blackbox consumer: readability-fix routing trigger
                                           #     (structural_verdict == FAIL AND {a1,a2,a3,a4} all PASS/P1 AND count(P1 across A1-A4) < 3)
                                           #   - orchestrator: Loop 2 gate readability-fix path
                                           #     (A1-A4 no FAIL AND count(P1 across A1-A4) < 3 AND structural_verdict ∈ {PASS, P1} → APPROVE)
interview_hints: string[]                  # PUBLIC (both APPROVE/REQUEST_CHANGES are user-facing — always surface P1 hints)
                                           # language constraint: source bullet language = hint language — both the four labels and hint body.
                                           # Korean bullet → Korean labels (인용/문제/이유/제안)+hint; English bullet → English labels (Quote/Problem/Why/Suggestion)+hint. (bidirectional)
```

---

## Stability Contract

**Default policy**: new fields default to INTERNAL. Promotion to PUBLIC requires a separate plan + user approval.

| Tag | Meaning | Consumer |
|-----|---------|----------|
| PUBLIC | Stable contract, safe access for blackbox consumers | blackbox consumer (and any future blackbox consumer) |
| INTERNAL | May change without notice, orchestrator-only | orchestrator (axis-aware role) |

**Promotion procedure**: when promoting INTERNAL → PUBLIC:
1. Create a new plan
2. Obtain user approval
3. Analyze the impact on all blackbox consumers
4. Commit the tag change + record the plan

---

## Critical Rule → Verdict Invariant

```
INVARIANT: critical_rule_flags.r_phys.triggered == true
           OR critical_rule_flags.r_cross.triggered == true
           ⇒ final_verdict == "REQUEST_CHANGES"
```

Without this invariant, review-resume risks missing a critical failure as a blackbox consumer. The examiner implementation must statically guarantee this invariant (e.g., final_verdict decision logic checks critical flags first).

The ownership-scope flag was removed in v4 — retired in v4, see `a4-ownership-scope.md` integrity_suspected. It is handled through the A4 axis verdict (FAIL or P1) instead: structural overclaim is FAIL; mere scope ambiguity is P1.

---

## A5 Co-failure Disambiguation — Full Routing Matrix

This matrix is the Single Source of Truth, corresponding 1:1 with the examiner Decision Sequence (`agents/tech-claim-examiner.md` §final_verdict Decision Sequence). `resume-forge/SKILL.md` §Step 1 Classify Feedback refers to this table.

The evaluation order reflects early-return priority: critical flags → cumulative P1 → axis FAIL → structural FAIL → APPROVE.

| Priority | Condition | `final_verdict` | Consumer routing lane |
|---------|------|----------------|----------------------|
| 1 | `r_phys.triggered == true` | `REQUEST_CHANGES` | Source extraction — explain the physically impossible number to the user and request correction |
| 2 | `r_cross.triggered == true` | `REQUEST_CHANGES` | Source extraction — explain the cross-entry contradiction to the user and request correction |
| 3 | `count(P1 across A1-A4) >= 3` | `REQUEST_CHANGES` | Source extraction — strengthen P1 axes in order, starting with the weakest |
| 4 | At least one of A1-A4 is `FAIL` (regardless of structural) | `REQUEST_CHANGES` | Source extraction — strengthen depth using interview hints for FAIL axes |
| 5 | A1-A4 all PASS/P1 (count < 3) + `structural_verdict == FAIL` | `REQUEST_CHANGES` | Readability-only fix — sufficient depth, failed scan. Resolve through restructuring/compression alone (no additional interview needed) |
| 6 | A1-A4 all PASS/P1 (count < 3) + `structural_verdict ∈ {PASS, P1}` | `APPROVE` | Approve lane |

**Priority 4 sub-branches** (when A1-A4 contains FAIL, meaning by structural_verdict pattern):

| structural_verdict | A1-A4 FAIL status | Meaning | Routing |
|-------------------|----------------|------|--------|
| FAIL | At least one FAIL in A1-A4 | Insufficient depth also affects scanability | Source extraction |
| PASS or P1 | At least one FAIL in A1-A4 | Insufficient content depth (scan is OK) | Source extraction |

**Priority 5 caveat**: even with mixed P1 verdicts in A1-A4, route to priority 5 (readability-only) when count < 3 and no FAIL is present. The presence of P1 itself does not require source extraction.

---

## Migration Table (v1 → v4)

Used when downstream skills update v1 examiner output references to v4:

| Old (v1) | New (v4) | Loop meaning |
|----------|----------|-----------|
| `Causal Chain Depth score >= 0.7` | `verdicts.a2_causal_honesty.verdict == PASS` | Loop 1 gate (resume-forge) |
| `E3b Constraint Cascade Score >= 0.8 (CASCADING)` | `final_verdict == APPROVE && A1-A4 no FAIL AND count(P1 across A1-A4) < 3 AND structural_verdict ∈ {PASS, P1}` | Loop 2 gate (resume-forge) |
| `E1-E6 failures` | `At least one FAIL in {a1, a2, a3, a4}` | Source extraction trigger |
| `R1-R5 failures` | `structural_verdict == FAIL AND {a1, a2, a3, a4} all PASS/P1 AND count(P1 across A1-A4) < 3` | Readability-only fix trigger |

---

## interview_hints Constraints

1. **Scaffold format rule**: each `interview_hints` element is one string, with each of the four labels on a separate line (newline-delimited, not `/`-delimited). The labels themselves follow the source bullet's language — for a Korean bullet:
   ```
   인용: «verbatim substring of the original bullet»
   문제: <specific defect in that quoted span>
   이유: <why it is a problem — plain source-language wording, no axis names>
   제안: <concrete, actionable revision>
   ```
   English bullets use the same structure with English labels: `Quote:` / `Problem:` / `Why:` / `Suggestion:` (one space after the colon). Label mapping: 인용=Quote, 문제=Problem, 이유=Why, 제안=Suggestion.
   - The text inside `«»` on the `인용:`/`Quote:` line must be a verbatim substring of the original bullet (no paraphrasing); always wrap it in «» regardless of language. For noleak verification, exclude only this verbatim «»-wrapped line, as a whole line.
   - This scaffold applies to every surfaced hint — REQUEST_CHANGES hints, P1 improvement hints on APPROVE, and structural (A5) P1 readability hints (`resume-forge/SKILL.md:210` — structural_verdict is surfaced uniformly, just like A1-A4).
   - Exception: a completely clean APPROVE still uses `interview_hints: []` (do not force-fill the scaffold).
2. **Vocabulary rule**: the three `문제:`/`이유:`/`제안:` lines (`Problem:`/`Why:`/`Suggestion:` for English bullets — same rule) must not include axis identifiers (`A[1-5]`, i.e., A1-A5) or English axis names (Technical Credibility, Causal Honesty, Outcome Presence & Clarity, Ownership & Scope, Scanability) — use natural prose only. Explain "이유:"/"Why:" in plain source-language wording. The `인용:`/`Quote:` line is exempt because it is a verbatim substring of the original bullet (a candidate's technology name may happen to contain A1, etc.).
   - OK: "사용한 시스템과 선택 이유를 추가하면 기술 깊이가 더 잘 드러납니다"
   - Forbidden: "A1 Technical Credibility FAIL — 시스템 명시 필요"
3. **Actionability rule**: each hint must be specific and actionable. Generic hints such as "add more technical detail" are forbidden.
4. **P1 coverage**: include P1 verdicts in interview_hints as improvement suggestions even when final_verdict is APPROVE.

The `agents/tech-claim-examiner.md` prompt references these rules without duplicating their body text.

---

## Consumer Boundaries

### resume-forge (axis-aware orchestrator)

- **Allowed**: all INTERNAL fields (verdicts.*, critical_rule_flags.*, reasoning, evidence_quote)
- **Use case**: source extraction routing, Loop 1/2 gate decision
- **Note**: state the "axis-aware orchestrator" boundary at the top of `skills/resume-forge/SKILL.md` (downstream skill update work)

### review-resume (blackbox consumer)

- **Allowed**: only `schema_version`, `final_verdict`, `structural_verdict`, `interview_hints`
- **Forbidden**: exposing verdicts.a*, critical_rule_flags.*, evidence_quote, axis names
- **Use case**: Phase 9 quality gate, HTML report user-facing hints

### Prohibited Token Patterns for review-resume

Maintain the following three regular expressions as canonical to prevent examiner internal tokens from leaking onto user-facing surfaces of the HTML report generated by review-resume. `tests/phase9-loop-scenarios.md` SCN-6 refers to this pattern list.

| Category | Pattern (ripgrep / PCRE) | What it forbids |
|----------|--------------------------|-----------------|
| Axis identifier | `\bA[1-5]\b` | Standalone `A1`–`A5` tokens. CSS classes such as `.badge-p1` use `P[0-3]`, so they do not produce false positives |
| Axis name | `Technical Credibility\|Causal Honesty\|Outcome Presence & Clarity\|Ownership & Scope\|Scanability` | Leaked official names of the five axes. Match `Ownership & Scope` exactly to distinguish it from ordinary `Ownership` |
| Internal struct | `verdicts\.\|critical_rule_flags\.\|evidence_quote\|reasoning:` | Leaked field keys from the examiner output schema |

**Verification usage**: when rendered content includes the four-element scaffold hints from §interview_hints Constraints (Korean: `인용:`/`문제:`/`이유:`/`제안:`, English: `Quote:`/`Problem:`/`Why:`/`Suggestion:`), first exclude the verbatim «»-wrapped lines as whole lines (the `인용:`/`Quote:` label lines — verbatim substrings of the original bullet that may legitimately contain `A[1-5]`-shaped tokens in candidate technology names such as "AWS A1 instances"). Because «» appears only on quote lines, these lines can be identified regardless of label language (Korean/English). Then run `grep -E '<pattern>' <rendered-html>` for each of the three patterns against the remaining lines; noleak passes if all return 0 matches. Naively running against whole HTML without preprocessing out «» lines produces false positives from candidate tokens in quote lines (see `tests/phase9-loop-scenarios.md` SCN-13 `FX-TECH-ECHO`). Terse output without «»-wrapped quote lines (the pre-scaffold form) does not need this preprocessing; the existing whole-content grep remains valid in that case.

**Canonical regex** (use directly in the shell, without escaping):
```
# Axis identifier
\bA[1-5]\b

# Axis name
Technical Credibility|Causal Honesty|Outcome Presence & Clarity|Ownership & Scope|Scanability

# Internal struct
verdicts\.|critical_rule_flags\.|evidence_quote|reasoning:
```

> **Note**: `\|` in the table above escapes a pipe within a Markdown table cell and appears as `|` in rendered output. Use the code-block form above in the shell.

**When axis names change**: if A1-A5 names change, update both locations together — this §Prohibited Token Patterns + the §interview_hints Constraints Vocabulary rule. A missed update causes SCN-6 to falsely pass using stale patterns.
