# Examiner Output Schema (v4.0)

<!-- schema_version: "v4.0" -->
<!-- v4.0 changes:
  - structural_verdict (PUBLIC) 필드 추가: A5 scanability 축의 PASS/P1/FAIL을 PUBLIC으로 노출.
    review-resume readability-fix routing trigger 및 resume-forge Loop 2 gate에서 사용.
  - final_verdict 도출 기준: A1-A4 모두 PASS AND structural_verdict ∈ {PASS, P1} → APPROVE.
    (v3까지는 A1-A5 모두 PASS 조건)
  - ownership-scope critical_rule_flag 제거: A4 ownership-scope axis의 P1 verdict로 대체됨.
    (see a4-ownership-scope.md integrity_suspected)
-->

## Purpose

이 문서는 `tech-claim-examiner` agent의 output contract를 정의. resume-forge / review-resume 등 downstream skill이 이 schema를 참조해 examiner output을 parsing.

---

## Schema Definition

### Top-level fields

모든 필드에 PUBLIC / INTERNAL 태그 부여. INTERNAL 필드는 orchestrator(resume-forge)만 접근 가능.

```yaml
schema_version: string              # PUBLIC. ex: "v4.0"
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
structural_verdict: PASS | P1 | FAIL       # PUBLIC. A5 scanability axis의 verdict를 직접 노출.
                                           # consumer contract:
                                           #   - review-resume: readability-fix routing trigger
                                           #     (structural_verdict == FAIL AND {a1,a2,a3,a4} 모두 PASS)
                                           #   - resume-forge: Loop 2 gate readability-fix path
                                           #     (verdicts.a1-a4 모두 PASS AND structural_verdict ∈ {PASS, P1} → APPROVE)
interview_hints: string[]                  # PUBLIC (REQUEST_CHANGES 시 user-facing)
                                           # language constraint: source bullet의 언어 = hint 언어.
                                           # 한국어 bullet → 한국어 hint; English bullet → English hint. (bidirectional)
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

ownership-scope flag는 v4에서 제거됨 — retired in v4, see `a4-ownership-scope.md` integrity_suspected. A4 axis의 P1 verdict로 대체 처리.

---

## A5 Co-failure Disambiguation

A5(Scanability)는 다른 axis와의 co-failure 패턴에 따라 라우팅 의미가 다름:

| 패턴 | 의미 | 라우팅 |
|------|------|--------|
| A5 FAIL alone (A1, A2, A3 모두 PASS) | Readability-only — formatting issue | review-resume readability fix |
| A5 FAIL + (A1, A2, A3 중 하나 이상 FAIL) | 깊이 부족이 scanability에도 영향 | resume-forge source extraction |

이 분기는 resume-forge SKILL.md L193-211의 라우팅 로직 + review-resume Phase 7b/9 gate에 명시되어야 함.

---

## Migration Table (v1 → v4)

downstream skill들이 v1 examiner output 참조를 v4로 갱신할 때 사용:

| Old (v1) | New (v4) | Loop 의미 |
|----------|----------|-----------|
| `Causal Chain Depth score >= 0.7` | `verdicts.a2_causal_honesty.verdict == PASS` | Loop 1 gate (resume-forge) |
| `E3b Constraint Cascade Score >= 0.8 (CASCADING)` | `final_verdict == APPROVE && verdicts.a1-a4 모두 PASS AND structural_verdict ∈ {PASS, P1}` | Loop 2 gate (resume-forge) |
| `E1-E6 failures` | `{a1, a2, a3, a4} 중 FAIL 있음` OR `a5 FAIL AND {a1, a2, a3} 중 FAIL co-occur` | Source extraction trigger |
| `R1-R5 failures` | `structural_verdict == FAIL AND {a1, a2, a3, a4} 모두 PASS` | Readability-only fix trigger |

---

## interview_hints Constraints

1. **Vocabulary rule**: hint 본문에 axis identifier (A1-A5) 또는 axis name (Technical Credibility, Causal Honesty, Outcome Presence & Clarity, Ownership & Scope, Scanability) 포함 금지. 자연스러운 서술로만.
   - OK: "사용한 시스템과 선택 이유를 추가하면 기술 깊이가 더 잘 드러납니다"
   - 금지: "A1 Technical Credibility FAIL — 시스템 명시 필요"
2. **Actionability rule**: 각 hint는 구체적이고 실행 가능해야 함. "add more technical detail"처럼 generic한 hint 금지.
3. **P1 coverage**: P1 verdict는 final_verdict가 APPROVE여도 interview_hints에 improvement suggestion으로 포함.

이 규칙들은 `agents/tech-claim-examiner.md` prompt에서 본문 복제 없이 참조된다.

---

## Consumer Boundaries

### resume-forge (axis-aware orchestrator)

- **Allowed**: 모든 INTERNAL field (verdicts.*, critical_rule_flags.*, reasoning, evidence_quote)
- **Use case**: source extraction routing, Loop 1/2 gate decision
- **Note**: `skills/resume-forge/SKILL.md` 상단에 "axis-aware orchestrator" boundary 명시 (downstream skill 갱신 작업)

### review-resume (blackbox consumer)

- **Allowed**: `schema_version`, `final_verdict`, `structural_verdict`, `interview_hints`만
- **Forbidden**: verdicts.a*, critical_rule_flags.*, evidence_quote, axis name 노출
- **Use case**: Phase 9 quality gate, HTML report user-facing hints

### Prohibited Token Patterns for review-resume

review-resume가 생성하는 HTML report의 user-facing surface에 examiner internal tokens이 누출되지 않도록, 다음 정규식 3개를 canonical로 관리한다. `tests/phase9-loop-scenarios.md` SCN-6은 이 패턴 목록을 참조한다.

| Category | Pattern (ripgrep / PCRE) | What it forbids |
|----------|--------------------------|-----------------|
| Axis identifier | `\bA[1-5]\b` | `A1`~`A5` 단독 토큰. CSS class `.badge-p1` 등은 `P[0-3]`이라 false positive 없음 |
| Axis name | `Technical Credibility\|Causal Honesty\|Outcome Presence & Clarity\|Ownership & Scope\|Scanability` | 5축 정식 이름 누출. `Ownership & Scope`는 일반 `Ownership`과 구분하기 위해 정확 매치 |
| Internal struct | `verdicts\.\|critical_rule_flags\.\|evidence_quote\|reasoning:` | examiner output schema의 field key 누출 |

**Verification usage**: `grep -E '<pattern>' <rendered-html>`을 3개 pattern 각각에 대해 실행. 모두 0 matches이면 noleak 통과.

**Canonical regex** (shell에서 직접 사용, escape 없이):
```
# Axis identifier
\bA[1-5]\b

# Axis name
Technical Credibility|Causal Honesty|Outcome Presence & Clarity|Ownership & Scope|Scanability

# Internal struct
verdicts\.|critical_rule_flags\.|evidence_quote|reasoning:
```

> **Note**: 위 table 내 `\|`는 markdown table cell pipe 이스케이프로서 rendered 출력에서는 `|`로 표시된다. shell에서는 위 코드블럭 form을 사용할 것.

**축 이름 변경 시**: A1-A5 이름이 변경되면 두 위치를 동시에 갱신한다 — 본 §Prohibited Token Patterns + §interview_hints Constraints Vocabulary rule. 갱신 누락 시 SCN-6은 stale pattern으로 false pass를 낸다.
