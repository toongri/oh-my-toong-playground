---
name: tech-claim-rubric
description: Use when evaluating technical claims in high-depth content section units (예: 문제 해결 / 상세 프로젝트 / 경력 기술서). Defines the 5-axis framework (A1 Technical Credibility, A2 Causal Honesty, A3 Outcome Presence & Clarity, A4 Ownership & Scope, A5 Scanability) plus 2 critical authenticity rules (R-Phys, R-Cross) used by tech-claim-examiner agent. Verb-scope inflation (previously a separate rule) is now caught by A4 integrity_suspected sub-flag (see a4-ownership-scope.md).
---

<!-- Purpose: 면접관 5각도 follow-up hook 보장 — 평가된 모든 section block이 5개 면접관 각도(기술 판단 / 인과 정직 / 결과 존재 / 오너십 정합 / 스캔 가독성)에서 follow-up 질문을 생성할 수 있는 깊이를 갖추도록 보장한다. -->

# Overview

This document is the authoritative rubric definition used by the `tech-claim-examiner` agent to evaluate technical claims in high-depth content section units (예: 문제 해결 / 상세 프로젝트 / 경력 기술서). It does NOT perform evaluation itself — it defines the evaluation contract that the examiner follows.

The rubric consists of:

- **Five evaluation axes (A1–A5)**: The core evaluation framework. Each axis produces one of three verdicts (PASS / FAIL / P1). All five axes use an absolute standard. A5 is additionally structure-agnostic.
- **Two critical authenticity rules (R-Phys, R-Cross)**: Integrity gates evaluated separately from the axes. Both can trigger automatic REQUEST_CHANGES regardless of A1–A4 verdicts and structural_verdict. Verb-scope inflation (previously a separate rule, retired in v4) is now caught by A4 `integrity_suspected` sub-flag (see `a4-ownership-scope.md`).

**Evaluation structure:**

| Layer | Components | Verdict contribution |
|-------|------------|---------------------|
| Depth | A1, A2 | Absolute |
| Significance | A3, A4 | Absolute |
| Presentation | A5 | Absolute (structure-agnostic) |
| Integrity | R-Phys, R-Cross | Auto-fail triggers (verb-scope inflation rule retired in v4 — see A4 `integrity_suspected`) |

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
| Does this bullet reveal technical judgment? | A1 |
| Is the cause-and-effect logic and arithmetic internally consistent? | A2 |
| Is there a stated outcome that matters (tech or business)? | A3 |
| Is the ownership claim coherent with the described scope? | A4 |
| Can a recruiter extract the key message within 6–30 seconds of scanning? | A5 |

These five questions cover the full evaluation surface without sub-weighting formulas or cascading phase routing.

---

## Anti-pattern → Axis Traceability Matrix

Common resume bullet anti-patterns, the axis that catches them, and the verdict tier produced.

| Anti-pattern | Axis | Verdict |
|---|---|---|
| Name-only mention (도구 이름만 나열, 메커니즘 없음) | A1 | FAIL or P1 |
| Vanity outcome (팀 만족도 향상 등 정량 metric 없는 결과) | A3 | FAIL |
| Verb inflation (주도/총괄 + scope marker 없음) | A4 | FAIL or A4 `integrity_suspected` |
| Missing baseline (응답 시간 80% 단축 with no before/after window) | A2 | P1 (Soft) |
| Fuzzy noun outcome (성능 개선 / 처리량 향상 정량화 없음) | A3 (or A2 Rule 6) | P1 |
| Offline-as-production (load-test 수치를 production metric으로 표기) | A2 (Rule 4) | FAIL (Hard) |
| Arithmetic error (claimed delta math 일치 안 함) | A2 (Rule 1) | FAIL (Hard) |

---

## Five Axes — Quick Reference

| Axis | Standard | One-line | Reference file |
|------|----------|----------|----------------|
| **A1 Technical Credibility** | Absolute | 기술적 판단이 드러나는가 (2+ signals) | `a1-technical-credibility.md` |
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

All five axes (A1–A5) use an **Absolute** standard: the passing bar does not move with experience level. `candidate_context.years` is referenced only by A4 for scope evaluation, not by A1.

A5 is **structure-agnostic**: it does not require a specific format (e.g., "action verb + metric + outcome"). It asks only whether the core message is extractable by a scanning reader within 6–30 seconds, regardless of how the bullet is structured.

### A1 Evaluation Criteria

**Question**: Does this bullet reveal technical judgment? (이 bullet에 기술적 판단이 드러나는가?)

**PASS** — Bullet body explicitly shows **2 or more** of the following 5 signals:
1. **Constraint awareness** — technical constraint to solve (throughput bottleneck, race condition, consistency gap, legacy coupling, cost ceiling, etc.)
2. **Technology selection** — a specific system/algorithm/pattern deliberately chosen
3. **Mechanism** — how the chosen technology works (partitioning key, memoization strategy, eviction policy, cutover path, etc.)
4. **Trade-off / risk** — cost/risk accepted, or rejection-reason for a rejected alternative
5. **Rationale** — context-based "why X over Y"

**FAIL**:
- Tool/library name drop only (no rationale)
- Outcome metrics only, no selection or mechanism grounding
- Generic verbs ("도입", "구축", "개선", "활용") with no what/how/why
- Feature noun-phrases ("seamless multi-step flow") masquerading as mechanism

**P1**: Two or more signals present but at least one stays at name-level (no mechanism depth). Not vacuous enough to FAIL, but below the Absolute PASS bar — examiner returns improvement hint targeting the shallowest signal.

> **Section-wide signal mapping**: real-world에서 signal이 sub-bullets로 분산 가능 — section 전체에서 매핑 허용. 단일 bullet line에 모든 signal이 집중되지 않아도 section block 전체에서 2+ signals가 확인되면 PASS 판정 가능.

Years are not referenced for A1. Ownership signals belong to A4, not A1.

---

## Authenticity as Critical Rules

Authenticity is NOT a scored axis. It is a set of integrity gates evaluated as critical rules by the examiner. Rules are checked after all five axes are scored, and their triggered status feeds directly into `final_verdict`.

### R-Phys — Physical Impossibility

**Trigger condition**: A numeric claim is physically or mathematically impossible given the described context.

Examples of R-Phys violations:
- "Reduced latency by 50,000%" (percentage improvement cannot exceed 100% of the baseline for latency reduction)
- "Increased throughput from 10 RPS to 10,000,000 RPS with a config change" (plausible magnitude would require hardware, not config)

**Effect**: Automatic REQUEST_CHANGES regardless of A1–A4 verdicts and structural_verdict. The examiner must name the specific number and explain why it is physically incoherent.

### R-Cross — Cross-Entry Contradiction

**Trigger condition**: The claim directly contradicts another entry on the same resume, and both cannot be simultaneously true.

Example: Entry A claims "Designed and implemented the entire payment microservice from scratch." Entry B claims "Contributed to payment microservice API design alongside a team of 8 engineers." These contradict each other on ownership scope.

**Applicability**: R-Cross is only evaluated when cross-entry context is provided to the examiner. If only a single bullet is provided, R-Cross is marked N/A.

**Effect**: Automatic REQUEST_CHANGES regardless of A1–A4 verdicts and structural_verdict. The examiner must cite both entries and identify the specific contradiction.

### Verb-Scope Inflation — Retired in v4

The verb-scope inflation check (previously a standalone critical rule) is retired as a separate rule in v4. Detection is now handled by the A4 `integrity_suspected` sub-flag (see `a4-ownership-scope.md`). Detailed worked examples for R-Phys and R-Cross are in `agents/tech-claim-examiner.md`.

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

After A1–A4 are scored and A5 emits structural_verdict, the following invariant is applied before generating `final_verdict`:

```
IF r_phys.triggered == true OR r_cross.triggered == true
THEN final_verdict = REQUEST_CHANGES
(regardless of A1–A4 verdicts and structural_verdict)
```

### Final Verdict Derivation (when invariant does not apply)

| Condition | final_verdict |
|-----------|---------------|
| All of A1–A4 are PASS (P1 tolerated, count(P1) < 3) | APPROVE |
| Any of A1–A4 is FAIL | REQUEST_CHANGES |
| `count(P1 across A1-A4) ≥ 3` | REQUEST_CHANGES |

> **Note**: A5 result is emitted as `structural_verdict` and does NOT contribute to `final_verdict`. See `output-schema.md` and `a5-scanability.md`.

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
| Phase A/B/C protocol | Sequential A1→A4 + A5 (structural) + 2 critical rules |
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
- [ ] R-Phys: triggered status explicitly stated (true / false)
- [ ] R-Cross: triggered status explicitly stated (true / false — omit if no cross-entry context provided)
- [ ] Critical rule invariant applied: if r_phys or r_cross triggered, final_verdict is REQUEST_CHANGES
- [ ] interview_hints written in source bullet language, no axis identifiers in hint text
- [ ] final_verdict determined and recorded
