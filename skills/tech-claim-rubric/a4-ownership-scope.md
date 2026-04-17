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

### P1 Exemplar 1 — Led solo project
Bullet: "Led development of personal open-source library for date parsing"

Why P1 (not FAIL): "led" + solo project. Technically overclaim but may be legitimate idiom. 고의성 불명확. Interview에서 clarify.

## Boundary Cases

### EDGE 1 — Ambiguous team size
"Led infra automation rollout" — team size 없음. 가능하면 scope 추가 권장하지만 context에 따라 PASS 가능 (junior→FAIL, senior→P1).

### EDGE 2 — Contributed but singular impact
"Contributed RFC that team unanimously adopted, authoring 90% of final spec" — contributed 동사지만 impact는 crucial. PASS (clarity에 부합).

## Evaluator Guidance
1. **Extract verb**: bullet의 action verb 식별
2. **Extract scope**: 개인/팀/조직 scope 추출
3. **Coherence check**: verb ↔ scope 매핑 검증
4. **Realism check**: bullet 단독이 아닌 candidate.years / position context와 대조
5. **Verdict**: PASS | FAIL | P1
6. **Evidence quote**

## P1 vs FAIL Decision Rule
- **FAIL**: verb-scope 불일치가 clear overclaim (led + 개인 10 line 프로젝트 같은)
- **P1**: 불일치가 명확하지만 intent 모호 (led + side project 같은 관용적 사용 가능성)

## Common Evaluation Pitfalls
- 모든 "led"를 P1 처리 (과도). 명확히 부합하면 PASS
- Team size 없음 → 즉시 FAIL (과도). 맥락으로 추론 가능하면 PASS 가능
- P1과 FAIL 혼동. P1은 interview trigger, FAIL은 verdict 자체로 REQUEST_CHANGES 유발 (단 examiner-level)
