# Examiner Output Schema (v3.0)

## Purpose

이 문서는 `tech-claim-examiner` agent의 output contract를 정의. resume-forge / review-resume 등 downstream skill이 이 schema를 참조해 examiner output을 parsing.

---

## Schema Definition

### Top-level fields

모든 필드에 PUBLIC / INTERNAL 태그 부여. INTERNAL 필드는 orchestrator(resume-forge)만 접근 가능.

```yaml
schema_version: string              # PUBLIC. ex: "v3.0"
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
  r_scope:
    triggered: bool                 # INTERNAL
    reasoning: string               # INTERNAL

final_verdict: APPROVE | REQUEST_CHANGES   # PUBLIC
interview_hints: string[]                  # PUBLIC (REQUEST_CHANGES 시 user-facing)
```

---

## Stability Contract

**Default policy**: 새 field는 default INTERNAL. PUBLIC 승격은 별도 plan + user approval 필요.

| Tag | Meaning | Consumer |
|-----|---------|----------|
| PUBLIC | Stable contract, blackbox consumer 안심 접근 | review-resume (and any future blackbox consumer) |
| INTERNAL | May change without notice, orchestrator-only | resume-forge (axis-aware orchestrator) |

**Promotion procedure**: INTERNAL → PUBLIC 승격 시:
1. 신규 plan 수립
2. User approval 획득
3. 모든 blackbox consumer 영향 분석
4. tag 변경 commit + plan 기록

---

## Critical Rule → Verdict Invariant

```
INVARIANT: critical_rule_flags.r_phys.triggered == true
           OR critical_rule_flags.r_cross.triggered == true
           ⇒ final_verdict == "REQUEST_CHANGES"
```

이 invariant 부재 시 review-resume이 blackbox로서 critical failure를 놓칠 위험. examiner 구현이 이 invariant를 statically guarantee해야 함 (예: final_verdict 결정 로직이 critical flags를 먼저 체크).

`r_scope`는 P1 flag로 final_verdict에 invariant 영향 없음 — A4 axis의 P1 verdict와 함께 처리됨.

---

## A5 Co-failure Disambiguation

A5(Scanability)는 다른 axis와의 co-failure 패턴에 따라 라우팅 의미가 다름:

| 패턴 | 의미 | 라우팅 |
|------|------|--------|
| A5 FAIL alone (A1, A2, A3 모두 PASS) | Readability-only — formatting issue | review-resume readability fix |
| A5 FAIL + (A1, A2, A3 중 하나 이상 FAIL) | 깊이 부족이 scanability에도 영향 | resume-forge source extraction |

이 분기는 resume-forge SKILL.md L193-211의 라우팅 로직 + review-resume Phase 7b/9 gate에 명시되어야 함.

---

## Migration Table (v1 → v3)

downstream skill들이 v1 examiner output 참조를 v3로 갱신할 때 사용:

| Old (v1) | New (v3) | Loop 의미 |
|----------|----------|-----------|
| `Causal Chain Depth score >= 0.7` | `verdicts.a2_causal_honesty.verdict == PASS` | Loop 1 gate (resume-forge) |
| `E3b Constraint Cascade Score >= 0.8 (CASCADING)` | `final_verdict == APPROVE && verdicts.a1-a5 모두 PASS` | Loop 2 gate (resume-forge) |
| `E1-E6 failures` | `{a1, a2, a3, a4} 중 FAIL 있음` OR `a5 FAIL AND {a1, a2, a3} 중 FAIL co-occur` | Source extraction trigger |
| `R1-R5 failures` | `a5_scanability == FAIL AND {a1, a2, a3, a4} 모두 PASS` | Readability-only fix trigger |

---

## interview_hints Constraints

1. **Language rule**: hint 언어는 source `bullet_text` 언어와 일치 (Korean bullet → Korean hints, English bullet → English hints)
2. **Vocabulary rule**: hint 본문에 axis identifier (A1-A5) 또는 axis name (Technical Credibility, Causal Honesty, Outcome Significance, Ownership, Scanability) 포함 금지. 자연스러운 서술로만 ("기술 깊이가 부족합니다" OK, "A1 Technical Credibility FAIL" 금지)

이 두 규칙은 `tech-claim-examiner.md` prompt에 명시되어야 함.

---

## Consumer Boundaries

### resume-forge (axis-aware orchestrator)

- **Allowed**: 모든 INTERNAL field (verdicts.*, critical_rule_flags.*, reasoning, evidence_quote)
- **Use case**: source extraction routing, Loop 1/2 gate decision
- **Note**: `skills/resume-forge/SKILL.md` 상단에 "axis-aware orchestrator" boundary 명시 (downstream skill 갱신 작업)

### review-resume (blackbox consumer)

- **Allowed**: `schema_version`, `final_verdict`, `interview_hints`만
- **Forbidden**: verdicts.a*, critical_rule_flags.*, evidence_quote, axis name 노출
- **Use case**: Phase 9 quality gate, HTML report user-facing hints
