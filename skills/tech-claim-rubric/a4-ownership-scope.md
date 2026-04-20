# A4. Ownership & Scope

## Standard
Absolute — verb와 scope의 coherence는 모든 level에서 검증. Junior가 "led org-wide initiative"라고 쓰면 FAIL. Senior가 모든 bullet에 "led"만 쓰면 FAIL.

## Verb-Scope Taxonomy

### Ownership Verbs (강→약 ordering)
- **led/drove**: Full leadership — decision authority + direct reports or matrix team
- **architected/designed**: Design ownership — blueprint authorship
- **built/implemented**: Execution ownership — code/feature delivery
- **contributed**: Partial ownership — component/patch level
- **supported/assisted**: Peripheral participation
- **inherited/maintained**: Post-hoc ownership (did not originate)

### Scope Dimensions
- **Individual**: solo work or well-defined component
- **Team**: cross-functional team (4-10명 정도)
- **Organization**: multi-team, 20+ people or cross-org

### Korean Verb Taxonomy (한국어 동사 소유권 분류)

아래 분류는 영어 taxonomy와 동일한 강→약 ordering을 한국어 동사에 적용한다.

| 분류 | 동사 예시 | 평가 기준 |
|------|-----------|-----------|
| **solo** | 도입함, 구축함, 주도함, 총괄함 | scope marker 필수 — 없으면 A4 P1 또는 FAIL 에스컬레이션 |
| **shared** | 기여함, 참여함 | 기본적으로 shared로 인정 가능 |
| **supported** | 지원함, 협력함 | 보조 참여 — scope 과장 risk 낮음 |
| **observed** | 관찰함, 분석함 | 직접 기여 없음 — ownership claim 불가 |

**solo 동사 사용 시 필수 scope marker 예시**: "팀 내", "개인 기여", "담당 모듈", "컴포넌트 범위 내"
- scope marker 없이 solo 동사만 사용 → **A4 P1** (intent 모호)
- solo 동사 + cross-functional 조직 전체 claim + scope marker 없음 → **A4 FAIL** (`integrity_suspected: true`)

## Coherence Rules
- **led + 개인 project** → P1 flag (often inflation)
- **led + team size 명시** → PASS if team size realistic
- **built + team output으로 묘사** → P1 flag (overclaiming)
- **contributed + partial 설명** → PASS (clarity)
- **inherited + preservation 동사(maintained)** → PASS

## PASS Exemplars

### PASS Exemplar 1 — Led with realistic scope
Bullet: "Led 5-engineer platform team to migrate legacy monolith to modular services over 9 months, owning architecture decisions and mentoring 2 mid-level engineers"

Why PASS: led + team size (5-engineer) + owning decisions + mentoring responsibility. Leadership signal coherent.

### PASS Exemplar 2 — Built with clear scope boundary
Bullet: "Built payment retry queue with exponential backoff as solo owner of billing-service retry module (team of 6)"

Why PASS: Built + solo owner + module-level scope clearly stated. Team context 명시해 solo scope 정당화.

### PASS Exemplar 3 — Contributed with partial boundary
Bullet: "Contributed checkout latency optimization work-group proposal (my portion: API layer profiling + recommendations) that team adopted"

Why PASS: Contributed + 자기 portion 명시 + 팀 결과와의 관계 명확.

## FAIL Exemplars

### FAIL Exemplar 1 — Led inflation, no team context
Bullet: "Led cross-functional initiative to improve company engineering culture"

Why FAIL: "led" + vague "cross-functional" + company-wide. Junior에게 비현실적. Team size, decision authority 근거 없음.

### FAIL Exemplar 2 — Solo-everything claim
Bullet: "Single-handedly designed, built, deployed, monitored, and optimized the entire e-commerce platform serving 10M users"

Why FAIL: "single-handedly" + 전체 platform + 10M scale. 5+ years senior라도 solo 불가능. Inflation 명확.

### FAIL Exemplar 3 — Scope missing
Bullet: "Improved system performance across all services"

Why FAIL: 동사(improved)는 낮지만 scope("all services")는 과대. 어떤 서비스, 어느 범위, 본인 기여도 없음.

## P1 Flag Exemplars

### P1 Exemplar 1 — PASS boundary: Solo open-source project with 'led' idiom
Bullet: "Led development of personal open-source library for date parsing"

Why P1 (not FAIL): "led" + solo project. Technically overclaim but may be legitimate idiom. 고의성 불명확. Interview에서 clarify. → PASS boundary P1.

### P1 Exemplar 2 — PASS boundary: Led cross-team initiative with explicit contribution bounds
- Candidate context: Mid-level engineer, 4 years.
- Bullet: "Led cross-team initiative with 3 engineers from 2 teams to standardize API versioning; my contribution was architecture + migration script; team members owned their service-specific refactors"
- Reasoning: "led cross-team"은 solo 동사 + cross-functional scope 조합으로 A4 내 integrity 검토 대상이다. 그러나 "my contribution was architecture + migration script; team members owned their service-specific refactors"라는 명시적 scope narrowing이 개인 기여 범위를 한정하므로, 동사-scope 불일치가 구조적 overclaim 수준에 이르지 않는다. `integrity_suspected: false`. → PASS boundary P1.
- `integrity_suspected`: false — scope narrowing으로 개인 기여가 명확히 경계 지어짐.

### P1 Exemplar 3 — FAIL boundary: Stand-up facilitation framed as 'led team'
- Candidate context: Junior engineer, 2 years.
- Bullet: "Led daily stand-ups for 5-person team during sprint planning cycles"
- Reasoning: 'Led' + '5-person team' lexical trigger. Context narrowing은 "daily stand-ups"로 관용적 사용이지만 이력서 독자가 "team lead" 오해 risk. Scope 좁힘 없이 팀 리더십으로 오독될 여지 → FAIL boundary P1.

### P1 Exemplar 4 — FAIL boundary: 'Owned' entire product without scope qualification
- Candidate context: Junior engineer, 1.5 years.
- Bullet: "Owned end-to-end product strategy and roadmap for the checkout feature"
- Reasoning: 'Owned' + 'end-to-end' + 'product strategy/roadmap'은 PM/lead-level 어휘. Junior 1.5년 context와 심각한 mismatch. Scope narrowing 없음, 고의적 inflation signal 강함 → FAIL boundary P1.

## Boundary Cases

### EDGE 1 — Ambiguous team size
"Led infra automation rollout" — team size 없음. 가능하면 scope 추가 권장하지만 context에 따라 PASS 가능 (junior→FAIL, senior→P1).

### EDGE 2 — Contributed but singular impact
"Contributed RFC that team unanimously adopted, authoring 90% of final spec" — contributed 동사지만 impact는 crucial. PASS (clarity에 부합).

## Verdict Output Schema

A4 평가 결과는 아래 필드를 포함한다:

```yaml
axis: A4
verdict: PASS | FAIL | P1
evidence_quote: "<원문 인용>"
integrity_suspected: bool  # verb scope가 실제 개인 기여를 명백히 초과할 때 true
integrity_note: "<선택적 설명>"  # integrity_suspected: true인 경우 작성
```

`integrity_suspected: bool` — 동사가 나타내는 소유권 범위가 후보자의 실제 개인 기여를 입증 가능하게 초과할 때 `true`로 설정한다. 단순한 scope 모호성(P1 수준)이 아니라, 동사와 scope의 조합이 구조적으로 개인 기여와 일치하지 않는 경우에만 사용한다. `integrity_suspected: true`이면서 PASS는 불가능하다.

## Evaluator Guidance
1. **Extract verb**: bullet의 action verb 식별
2. **Extract scope**: 개인/팀/조직 scope 추출
3. **Coherence check**: verb ↔ scope 매핑 검증
4. **Realism check**: bullet 단독이 아닌 candidate.years / position context와 대조
5. **Verdict**: PASS | FAIL | P1
6. **Evidence quote**
7. **integrity_suspected**: verb-scope 불일치가 구조적 overclaim 수준이면 `true` 설정

## P1 vs FAIL Decision Rule
- **FAIL**: verb-scope 불일치가 clear overclaim (led + 개인 10 line 프로젝트 같은)
- **P1**: 불일치가 명확하지만 intent 모호 (led + side project 같은 관용적 사용 가능성)

## Common Evaluation Pitfalls
- 모든 "led"를 P1 처리 (과도). 명확히 부합하면 PASS
- Team size 없음 → 즉시 FAIL (과도). 맥락으로 추론 가능하면 PASS 가능
- P1과 FAIL 혼동. P1은 interview trigger, FAIL은 verdict 자체로 REQUEST_CHANGES 유발 (단 examiner-level)

## Block D: A4 Isolated Exemplars

아래 exemplar들은 A4 위반만을 격리하여 검증한다. A1(5개 sub-marker 모두), A2, A3, A5는 PASS 조건을 충족하도록 작성되었으며, A4 단독 위반만 존재한다.

### D-1 — FAIL: Verb inflation without scope marker

**Candidate context**: Junior backend engineer, 2 years. 팀 내 인증 모듈 개발 참여 경험 보유.

**Resume bullet**:
"신규 사용자 인증 시스템을 주도하고 총괄하여, JWT 기반 토큰 만료 정책(7일 기본, 환경별 오버라이드)을 도입함. OAuth2 제약 조건과 레거시 세션 방식의 마이그레이션 요구사항을 분석하여 stateless 방식을 선택·채택함. HMAC-SHA256 서명 메커니즘과 refresh token rotation 동작 원리를 직접 구현하였으며, 세션 DB 유지 대비 토큰 무효화 복잡도 증가라는 트레이드오프를 검토하고 stateless 전환 근거를 문서화함. 도입 후 인증 레이턴시가 평균 340ms에서 85ms로 감소하였고, 세션 관련 장애가 3개월간 0건을 기록함."

**A4 Evaluation**:
- 위반: "주도하고 총괄하여" — solo 동사 2개 중첩. scope marker("팀 내", "담당 모듈", "컴포넌트 범위") 없음. Junior 2년 context에서 전체 인증 시스템을 단독 주도·총괄했다는 주장은 명백한 verb inflation.
- A4 PASS marker 없음: scope qualifier 부재, bounded-scope verb 부재.
- `integrity_suspected`: true — solo 동사 중첩 + Junior context + scope qualifier 없음으로 구조적 overclaim.

```yaml
axis: A4
verdict: FAIL
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
- 위반: "결제 플로우 개선 프로젝트에 기여하여" — "기여함"은 shared 동사로 적절하나, 본인의 역할 경계가 불명확함. 어댑터 구현이 본인 단독 작업인지, 팀 협업인지, 설계는 누가 했는지 불분명. scope가 결제 플로우 전체인지 어댑터 모듈인지 모호.
- A4 PASS marker: scope qualifier 없음, bounded-scope verb 없음 — P1 수준의 모호성.
- `integrity_suspected`: false — 동사 자체는 overclaim이 아니나 scope 불명확으로 clarification 필요.

```yaml
axis: A4
verdict: P1
evidence_quote: "결제 플로우 개선 프로젝트에 기여하여"
integrity_suspected: false
integrity_note: "역할 경계 불명확 — 어댑터 구현이 solo인지 팀 협업인지, scope가 모듈 수준인지 플로우 전체인지 clarify 필요"
```

---

### D-3 — FAIL: Solo-everything claim across cross-functional boundaries (`integrity_suspected: true`)

**Candidate context**: Junior engineer, 1.5 years. 단일 서비스 팀 소속.

**Resume bullet**:
"전사 마이크로서비스 전환 이니셔티브를 주도하여, 레거시 모놀리스의 기술 부채 제약 조건과 각 팀별 서비스 분리 요구사항을 분석함. 서비스 메시 방식을 선택·채택하고, Istio 사이드카 프록시의 트래픽 라우팅 메커니즘과 mTLS 동작 원리를 설계함. 서비스 메시 도입 대비 운영 복잡도 증가라는 트레이드오프를 검토하고 전환 근거를 아키텍처 문서로 정리함. 전환 완료 후 배포 빈도가 월 2회에서 주 3회로 증가하였고, 서비스 간 레이턴시가 평균 120ms에서 45ms로 감소함."

**A4 Evaluation**:
- 위반: "전사 마이크로서비스 전환 이니셔티브를 주도하여" — "주도함"(solo 동사) + "전사"(org-wide scope) + scope qualifier 없음. Junior 1.5년이 전사 이니셔티브를 단독 주도했다는 주장은 구조적으로 개인 기여와 일치하지 않음. 이는 단순한 모호성이 아니라 verb-scope 조합의 구조적 overclaim.
- A4 PASS marker: scope qualifier 없음, bounded-scope verb 없음.
- `integrity_suspected`: true — solo 동사 + org-wide claim + Junior context + scope qualifier 없음 = 에스컬레이션 케이스.

```yaml
axis: A4
verdict: FAIL
evidence_quote: "전사 마이크로서비스 전환 이니셔티브를 주도하여"
integrity_suspected: true
integrity_note: "solo 동사(주도) + 전사 org-wide scope + scope qualifier 없음 + Junior 1.5년 context — 구조적 overclaim 에스컬레이션"
```
