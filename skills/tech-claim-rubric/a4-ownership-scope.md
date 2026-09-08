# A4. Ownership & Scope

## Standard
Absolute — verify verb-scope coherence at every level. A Junior claiming "led org-wide initiative" receives FAIL. "led" + no scope qualifier in a single bullet → P1/FAIL.

## Verb-Scope Taxonomy

### Ownership Verbs (strong→weak ordering)
- **led/drove**: Full leadership — decision authority + direct reports or matrix team
- **architected/designed**: Design ownership — blueprint authorship
- **built/implemented**: Execution ownership — code/feature delivery
- **contributed**: Partial ownership — component/patch level
- **supported/assisted**: Peripheral participation
- **inherited/maintained**: Post-hoc ownership (did not originate)

### Scope Dimensions
- **Individual**: solo work or well-defined component
- **Team**: cross-functional team (roughly 4–10 people)
- **Organization**: multi-team, 20+ people or cross-org

### Korean Verb Taxonomy (Korean verb ownership classification)

The classification below applies the same strong→weak ordering as the English taxonomy to Korean verbs.

| Category | Example verbs | Evaluation criterion |
|------|-----------|-----------|
| **solo** | 도입함, 구축함, 주도함, 총괄함 | Scope marker required — escalate to A4 P1 or FAIL if absent |
| **shared** | 기여함, 참여함 | Can be accepted as shared by default |
| **supported** | 지원함, 협력함 | Supporting participation — low risk of scope inflation |
| **observed** | 관찰함, 분석함 | No direct contribution — cannot claim ownership |

**Examples of scope markers required when using solo verbs**: "팀 내", "개인 기여", "담당 모듈", "컴포넌트 범위 내"
- Solo verb without a scope marker → **A4 P1** (ambiguous intent)
- Solo verb + cross-functional organization-wide claim + no scope marker → **A4 FAIL** (`integrity_suspected: true`)

## Coherence Rules
- **led + personal project** → P1 flag (often inflation)
- **led + explicit team size** → PASS if team size realistic
- **built + described as team output** → P1 flag (overclaiming)
- **contributed + partial contribution described** → PASS (clarity)
- **inherited + preservation verb (maintained)** → PASS

## PASS Exemplars

### PASS Exemplar 1 — Led with realistic scope
Bullet: "Led 5-engineer platform team to migrate legacy monolith to modular services over 9 months, owning architecture decisions and mentoring 2 mid-level engineers"

Why PASS: led + team size (5-engineer) + owning decisions + mentoring responsibility. Leadership signal coherent.

### PASS Exemplar 2 — Built with clear scope boundary
Bullet: "Built payment retry queue with exponential backoff as solo owner of billing-service retry module (team of 6)"

Why PASS: Built + solo owner + module-level scope clearly stated. Explicit team context justifies the solo scope.

### PASS Exemplar 3 — Contributed with partial boundary
Bullet: "Contributed checkout latency optimization work-group proposal (my portion: API layer profiling + recommendations) that team adopted"

Why PASS: Contributed + explicit personal portion + clear relationship to the team outcome.

## FAIL Exemplars

### FAIL Exemplar 1 — Led inflation, no team context
Bullet: "Led cross-functional initiative to improve company engineering culture"

Why FAIL: "led" + vague "cross-functional" + company-wide. Unrealistic for a Junior. No evidence of team size or decision authority.

### FAIL Exemplar 2 — Solo-everything claim
Bullet: "Single-handedly designed, built, deployed, monitored, and optimized the entire e-commerce platform serving 10M users"

Why FAIL: "single-handedly" + entire platform + 10M scale. Impossible solo even for a senior with 5+ years. Clear inflation.

### FAIL Exemplar 3 — Scope missing
Bullet: "Improved system performance across all services"

Why FAIL: The verb (improved) is weak but the scope ("all services") is excessive. No service identification, scope boundary, or personal contribution.

## P1 Flag Exemplars

### P1 Exemplar 1 — PASS boundary: Solo open-source project with 'led' idiom
Bullet: "Led development of personal open-source library for date parsing"

Why P1 (not FAIL): "led" + solo project. Technically overclaim but may be legitimate idiom. Intent is unclear. Clarify in the interview. → PASS boundary P1.

### P1 Exemplar 2 — PASS boundary: Led cross-team initiative with explicit contribution bounds
- Candidate context: Mid-level engineer, 4 years.
- Bullet: "Led cross-team initiative with 3 engineers from 2 teams to standardize API versioning; my contribution was architecture + migration script; team members owned their service-specific refactors"
- Reasoning: "led cross-team" combines a solo verb + cross-functional scope, warranting an A4 integrity review. However, the explicit scope narrowing in "my contribution was architecture + migration script; team members owned their service-specific refactors" bounds the individual contribution, so the verb-scope mismatch does not amount to structural overclaim. `integrity_suspected: false`. → PASS boundary P1.
- `integrity_suspected`: false — scope narrowing clearly bounds the individual contribution.

### P1 Exemplar 3 — FAIL boundary: Stand-up facilitation framed as 'led team'
- Candidate context: Junior engineer, 2 years.
- Bullet: "Led daily stand-ups for 5-person team during sprint planning cycles"
- Reasoning: 'Led' + '5-person team' lexical trigger. Context narrows to "daily stand-ups", making the usage idiomatic, but resume readers risk interpreting it as "team lead". Without scope narrowing, it can be misread as team leadership → FAIL boundary P1.

### P1 Exemplar 4 — FAIL boundary: 'Owned' entire product without scope qualification
- Candidate context: Junior engineer, 1.5 years.
- Bullet: "Owned end-to-end product strategy and roadmap for the checkout feature"
- Reasoning: 'Owned' + 'end-to-end' + 'product strategy/roadmap' is PM/lead-level vocabulary. Severe mismatch with Junior, 1.5 years context. No scope narrowing; strong signal of deliberate inflation → FAIL boundary P1.

## Boundary Cases

### EDGE 1 — Ambiguous team size
"Led infra automation rollout" — no team size. Adding scope is recommended when possible, but PASS is possible depending on context (junior→FAIL, senior→P1).

### EDGE 2 — Contributed but singular impact
"Contributed RFC that team unanimously adopted, authoring 90% of final spec" — the verb is contributed, but the impact is crucial. PASS (meets clarity).

## Verdict Output Schema

The A4 evaluation result includes the following fields:

```yaml
verdict: PASS | FAIL | P1
reasoning: "<reasoning paragraph>"
evidence_quote: "<원문 인용>"
integrity_suspected: bool  # true when verb scope clearly exceeds the actual individual contribution
integrity_note: "<선택적 설명>"  # fill in when integrity_suspected: true
```

`integrity_suspected: bool` — set to `true` when the ownership scope expressed by the verb demonstrably exceeds the candidate's actual individual contribution. Use only when the verb-scope combination structurally conflicts with the individual contribution, not for mere scope ambiguity (P1 level). PASS with `integrity_suspected: true` is impossible.

## Evaluator Guidance
1. **Extract verb**: identify the bullet's action verb
2. **Extract scope**: extract individual/team/organization scope
3. **Coherence check**: verify the verb ↔ scope mapping
4. **Realism check**: compare against candidate.years / position context, not the bullet alone
5. **Verdict**: PASS | FAIL | P1
6. **Evidence quote**
7. **integrity_suspected**: set `true` when the verb-scope mismatch amounts to structural overclaim

## P1 vs FAIL Decision Rule
- **FAIL**: a verb-scope mismatch is a clear overclaim (such as led + a personal 10-line project)
- **P1**: the mismatch is clear but intent is ambiguous (possible idiomatic usage such as led + side project)

## Common Evaluation Pitfalls
- Treating every "led" as P1 (excessive). PASS when clearly coherent
- Missing team size → immediate FAIL (excessive). PASS is possible when inferable from context
- Confusing P1 and FAIL. P1 is an interview trigger; a FAIL verdict itself triggers REQUEST_CHANGES (at examiner level only)

## Block D: A4 Isolated Exemplars

The exemplars below isolate and verify A4 violations only. They are written to meet the PASS conditions for A1 (all five sub-markers), A2, A3, and A5, leaving only an A4 violation.

### D-1 — FAIL: Verb inflation without scope marker

**Candidate context**: Junior backend engineer, 2 years. 팀 내 인증 모듈 개발 참여 경험 보유.

**Resume bullet**:
"신규 사용자 인증 시스템을 주도하고 총괄하여, JWT 기반 토큰 만료 정책(7일 기본, 환경별 오버라이드)을 도입함. OAuth2 제약 조건과 레거시 세션 방식의 마이그레이션 요구사항을 분석하여 stateless 방식을 선택·채택함. HMAC-SHA256 서명 메커니즘과 refresh token rotation 동작 원리를 직접 구현하였으며, 세션 DB 유지 대비 토큰 무효화 복잡도 증가라는 트레이드오프를 검토하고 stateless 전환 근거를 문서화함. 도입 후 인증 레이턴시가 평균 340ms에서 85ms로 감소하였고, 세션 관련 장애가 3개월간 0건을 기록함."

**A4 Evaluation**:
- Violation: "주도하고 총괄하여" — two stacked solo verbs. No scope marker ("팀 내", "담당 모듈", "컴포넌트 범위"). In a Junior, 2 years context, claiming sole leadership and oversight of the entire authentication system is clear verb inflation.
- No A4 PASS marker: absent scope qualifier and bounded-scope verb.
- `integrity_suspected`: true — stacked solo verbs + Junior context + absent scope qualifier constitute structural overclaim.

```yaml
verdict: FAIL
reasoning: "<reasoning paragraph>"
evidence_quote: "신규 사용자 인증 시스템을 주도하고 총괄하여"
integrity_suspected: true
integrity_note: "solo 동사(주도, 총괄) 중첩 사용, scope marker 없음, Junior 2년 context와 불일치"
```

---

### D-2 — P1: Scope vagueness, role boundary unclear

**Candidate context**: Mid-level engineer, 3 years. 여러 팀과 협업하는 플랫폼 팀 소속.

**Resume bullet**:
"결제 플로우 개선 프로젝트에 기여하여, PCI-DSS 제약 조건과 레거시 카드사 API 요구사항을 분석하고 새로운 결제 게이트웨이 어댑터를 선택·채택함. 어댑터 내부의 재시도 메커니즘과 멱등성 보장 동작 원리를 구현하였으며, 직접 연동 대비 어댑터 패턴의 트레이드오프(추가 레이어 오버헤드 vs 벤더 교체 용이성)를 검토하고 도입 근거를 남김. 어댑터 전환 후 결제 성공률이 94.2%에서 99.1%로 개선되었고, 장애 복구 시간이 평균 12분에서 2분으로 단축됨."

**A4 Evaluation**:
- Violation: "결제 플로우 개선 프로젝트에 기여하여" — "기여함" is appropriate as a shared verb, but the personal role boundary is unclear. It is unclear whether adapter implementation was solo or collaborative, and who designed it. Scope could mean the whole payment flow or the adapter module. Clarification must establish whether implementation was solo or team work, and whether scope is module-level or the entire flow.
- A4 PASS marker: no scope qualifier or bounded-scope verb — P1-level ambiguity.
- `integrity_suspected`: false — the verb itself is not an overclaim, but unclear role boundaries require clarification.

```yaml
verdict: P1
reasoning: "<reasoning paragraph>"
evidence_quote: "결제 플로우 개선 프로젝트에 기여하여"
integrity_suspected: false
```

---

### D-3 — FAIL: Solo-everything claim across cross-functional boundaries (`integrity_suspected: true`)

**Candidate context**: Junior engineer, 1.5 years. 단일 서비스 팀 소속.

**Resume bullet**:
"전사 마이크로서비스 전환 이니셔티브를 주도하여, 레거시 모놀리스의 기술 부채 제약 조건과 각 팀별 서비스 분리 요구사항을 분석함. 서비스 메시 방식을 선택·채택하고, Istio 사이드카 프록시의 트래픽 라우팅 메커니즘과 mTLS 동작 원리를 설계함. 서비스 메시 도입 대비 운영 복잡도 증가라는 트레이드오프를 검토하고 전환 근거를 아키텍처 문서로 정리함. 전환 완료 후 배포 빈도가 월 2회에서 주 3회로 증가하였고, 서비스 간 레이턴시가 평균 120ms에서 45ms로 감소함."

**A4 Evaluation**:
- Violation: "전사 마이크로서비스 전환 이니셔티브를 주도하여" — "주도함" (solo verb) + "전사" (org-wide scope) + no scope qualifier. A Junior with 1.5 years claiming sole leadership of an organization-wide initiative is structurally inconsistent with individual contribution. This is structural overclaim in the verb-scope combination, not mere ambiguity.
- A4 PASS marker: no scope qualifier or bounded-scope verb.
- `integrity_suspected`: true — solo verb + org-wide claim + Junior context + absent scope qualifier = escalation case.

```yaml
verdict: FAIL
reasoning: "<reasoning paragraph>"
evidence_quote: "전사 마이크로서비스 전환 이니셔티브를 주도하여"
integrity_suspected: true
integrity_note: "solo 동사(주도) + 전사 org-wide scope + scope qualifier 없음 + Junior 1.5년 context — 구조적 overclaim 에스컬레이션"
```
