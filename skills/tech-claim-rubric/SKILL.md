---
name: tech-claim-rubric
description: Use when evaluating technical claims in resume bullets. Defines the 5-axis framework (A1 Technical Credibility, A2 Causal Honesty, A3 Outcome Presence & Clarity, A4 Ownership & Scope, A5 Scanability) plus 3 critical authenticity rules (R-Phys, R-Cross, R-Scope) used by tech-claim-examiner agent.
---

# Overview

This document is the authoritative rubric definition used by the `tech-claim-examiner` agent to evaluate technical claims in resume bullets. It does NOT perform evaluation itself — it defines the evaluation contract that the examiner follows.

The rubric consists of:

- **Five evaluation axes (A1–A5)**: The core evaluation framework. Each axis produces one of three verdicts (PASS / FAIL / P1). A1 is calibrated by experience level; A2–A5 use an absolute standard. A5 is additionally structure-agnostic.
- **Three critical authenticity rules (R-Phys, R-Cross, R-Scope)**: Integrity gates evaluated separately from the axes. Two of the three can trigger automatic REQUEST_CHANGES regardless of axis verdicts.

**Evaluation structure:**

| Layer | Components | Verdict contribution |
|-------|------------|---------------------|
| Depth | A1, A2 | Absolute / Calibrated |
| Significance | A3, A4 | Absolute |
| Presentation | A5 | Absolute (structure-agnostic) |
| Integrity | R-Phys, R-Cross, R-Scope | Auto-fail triggers / P1 flag |

Downstream consumers: `resume-forge` and `review-resume` skills consume the examiner's output schema (see `output-schema.md`).

---

## Why 5 Axes (Rationale)

The previous 11-axis system (v1) was retired by agent-council unanimous vote. The core problems with v1:

1. **Over-engineered**: Sub-axes (E3a, E3b, sub-dimensions with weighted formulas) added evaluation overhead without improving signal quality. Evaluators spent more time computing scores than assessing claims.
2. **Backend-biased**: The v1 depth criteria implicitly favored distributed systems and infrastructure work. Frontend, data, and product-engineering bullets systematically underscored due to structural mismatch.
3. **Structurally rigid**: Phase A/B/C routing imposed a fixed evaluation order that created decision-tree overhead. Simple bullets required the same ceremonial path as complex ones.
4. **Catch-22 default-FAIL**: The "FAIL unless proven" stance combined with the prohibition on inference created a rubric where legitimately strong bullets failed due to formatting choices rather than substance gaps.

The 5-axis redesign compresses the evaluation into five clear questions:

| Question | Axis |
|----------|------|
| Is the technical depth appropriate for this experience level? | A1 |
| Is the cause-and-effect logic and arithmetic internally consistent? | A2 |
| Is there a stated outcome that matters (tech or business)? | A3 |
| Is the ownership claim coherent with the described scope? | A4 |
| Can a recruiter extract the key message within 6–30 seconds of scanning? | A5 |

These five questions cover the full evaluation surface without sub-weighting formulas or cascading phase routing.

---

## Five Axes — Quick Reference

| Axis | Standard | One-line | Reference file |
|------|----------|----------|----------------|
| **A1 Technical Credibility** | Calibrated | 경력 레벨에 부합하는 기술 이해 깊이 | `a1-technical-credibility.md` |
| **A2 Causal Honesty** | Absolute | 원인→결과 logic + arithmetic 일관성 | `a2-causal-honesty.md` |
| **A3 Outcome Presence & Clarity** | Absolute | tech OR business 결과 명시 (so what?) | `a3-outcome-significance.md` |
| **A4 Ownership & Scope** | Absolute | 동사-scope coherence (led/built/contributed) | `a4-ownership-scope.md` |
| **A5 Scanability** | Absolute (structure-agnostic) | 6-30s scan에 핵심 파악 가능 | `a5-scanability.md` |

### Axis Verdicts

Each axis (A1–A5) produces one of three verdicts:

| Verdict | Meaning |
|---------|---------|
| **PASS** | The claim satisfies the axis criterion with evidence present in the bullet text |
| **FAIL** | The claim clearly violates the axis criterion; revision required |
| **P1** | The claim partially satisfies the criterion; improvement recommended but not blocking |

A1 uses a **Calibrated** standard: passing bar scales with stated years of experience (junior / mid / senior). A2, A3, A4, and A5 use an **Absolute** standard: the bar does not move with experience level.

A5 is **structure-agnostic**: it does not require a specific format (e.g., "action verb + metric + outcome"). It asks only whether the core message is extractable by a scanning reader within 6–30 seconds, regardless of how the bullet is structured.

### Career-Level Calibration for A1

| Level | Years | A1 Passing Bar |
|-------|-------|----------------|
| Junior | 0-2 yr | Demonstrates basic understanding of what was used and why — awareness of at least one alternative or limitation |
| Mid | 3-5 yr | Demonstrates deliberate selection — constraint-based reasoning, independent judgment visible |
| Senior | 6+ yr | Demonstrates systemic evaluation — constraint-driven architectural decisions, multi-system consequences, or long-term maintenance implications visible |

A senior bullet evaluated at junior bar automatically fails A1 — upward calibration is not available to candidates.

---

## Authenticity as Critical Rules

Authenticity is NOT a scored axis. It is a set of integrity gates evaluated as critical rules by the examiner. Rules are checked after all five axes are scored, and their triggered status feeds directly into `final_verdict`.

### R-Phys — Physical Impossibility

**Trigger condition**: A numeric claim is physically or mathematically impossible given the described context.

Examples of R-Phys violations:
- "Reduced latency by 50,000%" (percentage improvement cannot exceed 100% of the baseline for latency reduction)
- "Increased throughput from 10 RPS to 10,000,000 RPS with a config change" (plausible magnitude would require hardware, not config)

**Effect**: Automatic REQUEST_CHANGES regardless of A1–A5 verdicts. The examiner must name the specific number and explain why it is physically incoherent.

### R-Cross — Cross-Entry Contradiction

**Trigger condition**: The claim directly contradicts another entry on the same resume, and both cannot be simultaneously true.

Example: Entry A claims "Designed and implemented the entire payment microservice from scratch." Entry B claims "Contributed to payment microservice API design alongside a team of 8 engineers." These contradict each other on ownership scope.

**Applicability**: R-Cross is only evaluated when cross-entry context is provided to the examiner. If only a single bullet is provided, R-Cross is marked N/A.

**Effect**: Automatic REQUEST_CHANGES regardless of A1–A5 verdicts. The examiner must cite both entries and identify the specific contradiction.

### R-Scope — Verb-Scope Inflation

**Trigger condition**: The ownership verb (led, designed, built, contributed) is mismatched with the described scope of work — specifically, the verb implies more individual ownership than the scope evidence supports.

Example: "Led migration of monolith to microservices" + description of a personal side project with no team context. "Led" implies team leadership; the scope implies solo work.

**Effect**: P1 flag only — NOT an automatic REQUEST_CHANGES. The examiner raises the flag and notes the specific verb-scope mismatch. The bullet is not automatically rejected.

Note: R-Scope overlaps with A4 Ownership & Scope but is tracked separately as an integrity signal rather than a scored verdict. Detailed worked examples for all three rules are in `agents/tech-claim-examiner.md`.

---

## Evaluation Protocol

The examiner evaluates axes sequentially: A1 → A2 → A3 → A4 → A5. After all five axes, critical rules are checked.

### Reasoning-Before-Verdict

For each axis, the examiner MUST:
1. Write technical reasoning first — what evidence is present, what is absent, what questions the claim raises
2. Provide an `evidence_quote` — a direct excerpt from the bullet text supporting the verdict
3. Assign the verdict last — PASS / FAIL / P1 derived from the reasoning, not assumed upfront

If the reasoning does not support the verdict, the verdict is wrong. Verdict-first reasoning is prohibited.

### Critical Rule Invariant

After A1–A5 are scored, the following invariant is applied before generating `final_verdict`:

```
IF r_phys.triggered == true OR r_cross.triggered == true
THEN final_verdict = REQUEST_CHANGES
(regardless of A1–A5 verdicts)
```

R-Scope does not trigger this invariant — it contributes a P1 flag but does not force REQUEST_CHANGES.

### Final Verdict Derivation (when invariant does not apply)

| Condition | final_verdict |
|-----------|---------------|
| All of A1–A5 are PASS (P1 tolerated) | APPROVE |
| Any of A1–A5 is FAIL | REQUEST_CHANGES |

P1 verdicts do not block APPROVE but are surfaced in `interview_hints` as improvement recommendations.

Output schema details (field names, types, required/optional) are in `output-schema.md`.

---

## Output Format

The examiner's full output schema is defined in `output-schema.md`. Key fields:

**INTERNAL fields** (reasoning trace, not shown to candidates):

| Field | Description |
|-------|-------------|
| `verdicts.a1_*` through `verdicts.a5_*` | Per-axis reasoning, evidence_quote, verdict |
| `critical_rule_flags.r_phys` | triggered (bool), explanation |
| `critical_rule_flags.r_cross` | triggered (bool), contradiction description, cited entries |
| `critical_rule_flags.r_scope` | triggered (bool), verb-scope mismatch description |

**PUBLIC fields** (returned to downstream caller):

| Field | Description |
|-------|-------------|
| `final_verdict` | `APPROVE` or `REQUEST_CHANGES` |
| `interview_hints` | `string[]` — actionable improvement suggestions |

### interview_hints Rules

- Written in the same language as the source bullet (Korean bullet → Korean hints)
- Do NOT include axis identifiers (A1, A2, etc.) in the hint text — hints are candidate-facing
- Each hint is actionable and specific, not generic ("add more technical detail" is prohibited)
- P1 verdicts from any axis generate a hint even when `final_verdict` is APPROVE

---

## Migration from v1 (11-axis)

| v1 concept | v3 equivalent |
|------------|---------------|
| E1–E6 (depth axes) | A1 + A2 (depth + causal) |
| R1–R5 (readability axes) | A5 alone (structure-agnostic) |
| Phase A/B/C protocol | Sequential A1→A5 + 3 critical rules |
| Constraint Cascade Score | A2 causal_honesty + A3 outcome_significance |

All v1 axis tokens (E1–E6, R1–R5, E3b, Constraint Cascade, CASCADING, LISTED, FLAT, Narrative Necessity, Layer 2, Phase A/B/C) are retired. They must not appear in examiner output or downstream skill prompts outside of this migration reference.

---

## Completion Checklist

The examiner verifies all of the following before delivering output:

- [ ] A1 Technical Credibility: reasoning written, evidence_quote included, verdict assigned
- [ ] A2 Causal Honesty: reasoning written, evidence_quote included, verdict assigned
- [ ] A3 Outcome Presence & Clarity: reasoning written, evidence_quote included, verdict assigned
- [ ] A4 Ownership & Scope: reasoning written, evidence_quote included, verdict assigned
- [ ] A5 Scanability: reasoning written, evidence_quote included, verdict assigned
- [ ] R-Phys: triggered status explicitly stated (true / false / N/A)
- [ ] R-Cross: triggered status explicitly stated (true / false / N/A — N/A if no cross-entry context)
- [ ] R-Scope: triggered status explicitly stated (true / false)
- [ ] Critical rule invariant applied: if r_phys or r_cross triggered, final_verdict is REQUEST_CHANGES
- [ ] interview_hints written in source bullet language, no axis identifiers in hint text
- [ ] final_verdict determined and recorded
