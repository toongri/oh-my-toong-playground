# A5. Scanability

> **Role**: A5는 `structural_verdict` lane을 담당한다. A5 FAIL은 `final_verdict = REQUEST_CHANGES`를 트리거하지만, consumer는 source-extraction이 아닌 **readability-fix** routing으로 처리한다 (review-resume/resume-forge가 `structural_verdict == FAIL AND {a1-a4} 모두 PASS` 패턴을 감지해 분기). 즉 final_verdict 관점에서는 blocking이나, 수정 경로 관점에서는 경량 (문서 재구성만).

## Standard
Absolute — **structure-agnostic**. 구조 형식이 아닌 signal density + 핵심 포착 가능성으로 평가.

## P1 Decision Rule

**A5 P1 rule**: "Key signal scannable but surrounding context insufficient for full comprehension."

핵심 signal(숫자·결과·결정 동사)은 6-30초 scan에 포착되나 surrounding context(시스템명·기간·범위·mechanism) 중 하나 이상이 부재해 "무엇을 해서 어떻게 이 결과가 나왔는지" 완전 파악이 불가능한 경계. FAIL(signal 자체 부재 또는 detail spill)과 달리 key signal은 살아 있으므로 완전 공허는 아니며, PASS(signal + context 모두)에 미치지 못하는 중간.

## Structure Agnosticism
A5는 의도적으로 structure-neutral. 다음 구조 모두 PASS 가능:
- **Impact-first one-liner**: "Reduced incident MTTR 4h→15min by automated rollback (5M DAU marketplace)"
- **Problem-Strategy-Result**: 명시적 PSR 구조
- **Chronological**: 시간 흐름으로 문제→해결→결과
- **Compressed case study**: 길지만 signal density 충분한 multi-line

**v1 deprecation**: Problem/Strategy/Result 구조 강제, metric-in-Result 강제, Additional Sections distinct role 룰은 **적용 안 함**. v3는 "format → free, signal density → strict". <!-- allow-forbidden -->

> **v4 consistency note**: A1 5/5 strict는 Constraint+Mechanism+Rationale을 jointly 강제 — PSR(Problem+Strategy+Result)의 동등 기준을 A1 depth layer에서 흡수. A5는 readability layer로 demote됨.

## What We Evaluate
- **Scan time**: 6-30초 내에 "무엇을 해결? 핵심 결정? 결과?" 세 답변 획득 가능한가
- **Signal density**: 단어당 정보량. filler words (successfully, efficiently, collaboratively) 많으면 density 낮음
- **Burial check**: 핵심 메시지가 detail에 파묻혀 있는가
- **Detail spill**: rationale 없는 config 값, 메서드 시그니처 등이 scan을 방해하는가

## PASS Exemplars

### PASS Exemplar 1 — Impact-first one-liner
Bullet: "Reduced incident MTTR 4h→15min by automated rollback pipeline (5M DAU marketplace)"

Why PASS: 한 줄로 outcome + mechanism + context 모두 scan 가능. Signal density 극대.

### PASS Exemplar 2 — Chronological compressed
Bullet: "Profiled checkout API, found N+1 on inventory lookup, introduced batched cache + 5-minute TTL, cut p99 from 2.1s to 320ms peak season"

Why PASS: 시간 흐름(profiled → found → introduced → cut). 각 단계가 scan에 포착. 4 steps 10초 내 읽음.

### PASS Exemplar 3 — Problem-Strategy-Result (explicit structure, still OK)
Bullet:
> **Problem**: Authentication service 수평 확장 시 session cache thrashing (2k RPS에서 40% miss rate)
> **Strategy**: Consistent hashing + per-pod local L1 cache (60s TTL) + shared L2 (Redis)
> **Result**: Miss rate 40%→4%, p99 latency 280ms→45ms, pod 1 → 6 scale-out 지원

Why PASS: PSR 구조가 과거 v1에서 강제됐지만 v3에서도 허용. 각 섹션 scan 가능. <!-- allow-forbidden -->

### PASS Exemplar 4 — Compressed case study (long but high-signal)

- Candidate context: Senior infra engineer, 8 years.
- Bullet (multi-line compressed case study):
  > "Led incident recovery for production Postgres outage: identified runaway autovacuum worker
  > consuming CPU by correlating pg_stat_activity query durations with pg_stat_bgwriter buffer_alloc
  > spikes. Tuned autovacuum_work_mem + scale_factor per table, verified via query-time histograms
  > over 72h post-change. Outage window cut from 38min to 7min mean for subsequent incidents
  > (n=4 over 2 quarters)."
- Reasoning: 5줄 multi-line이지만 high-signal density — problem statement + diagnostic method + mechanism + verification + quantified outcome 포함. see "Structure Agnosticism" section above (this file), 4번째 valid 구조 시연.

Why PASS: Length 자체는 disqualifier 아님. 각 line이 signal dense하고 scan 30초 내에 "Postgres outage / autovacuum 진단 + tuning / outage 38→7min" 파악 가능.

### PASS Exemplar 5 — Multi-bullet concise list

- Candidate context: Backend engineer, 5 years.
- Bullets:
  - "Migrated monolith auth module to dedicated service: JWT + refresh token rotation, 0 session leaks in 6-month prod window"
  - "Replaced cron-based report pipeline with event-driven Kafka consumer: delivery latency 45min→90s, eliminated 3 weekly on-call pages"
  - "Introduced circuit breaker on 3rd-party payment gateway calls: 5xx error rate 8%→0.3% during partner outages"

Why PASS: 3-bullet list, 각 bullet이 독립적으로 problem + approach + outcome scan 가능. multi-bullet 구조도 structure-agnostic PASS의 valid 형태.

## FAIL Exemplars

### FAIL Exemplar 1 — Detail spill (rationale 없는 config)
Bullet: "Set Redis maxmemory=8GB, maxmemory-policy=allkeys-lru, timeout=300, tcp-keepalive=60, hz=50, stop-writes-on-bgsave-error=no, replica-priority=100 for improved caching"

Why FAIL: config values 나열만. 어떤 문제, 왜 이 값, 결과 없음. scan으로는 spam.

### FAIL Exemplar 2 — Key message burial
Bullet: "As part of the quarterly resilience initiative spearheaded by the platform reliability working group comprising 8 cross-functional contributors from infrastructure, SRE, backend, and platform teams, I participated in implementing circuit breakers that reduced 5xx by 70%"

Why FAIL: 핵심(circuit breakers → 5xx 70% 감소)이 organizational preamble에 파묻힘. 30초 scan에 놓침.

### FAIL Exemplar 3 — Exhaustive listing
Bullet: "Used AWS, GCP, Azure, Kubernetes, Docker, Terraform, Ansible, Jenkins, GitLab CI, GitHub Actions, Prometheus, Grafana, Datadog, New Relic, Sentry, ELK, Splunk for operational maturity"

Why FAIL: Tool parade. 어떤 문제에 무엇을 적용, outcome 없음. signal density 제로.

### FAIL Exemplar 4 — Wall-of-text with buried lede

Bullet: "Over the course of the two-year platform migration program I was deeply involved in, working alongside a distributed team spanning three time zones and coordinating with product, QA, and infrastructure stakeholders on a weekly basis, I contributed to various aspects of the Kubernetes adoption effort including writing some Helm charts and participating in the migration of several services, which ultimately resulted in improved deployment consistency and some reduction in manual toil for the operations team."

Why FAIL: wall-of-text 1문장. 핵심 행동(Helm chart 작성, 서비스 마이그레이션)과 결과(deployment consistency, toil reduction)가 organizational context와 qualifier에 파묻혀 30초 scan으로 파악 불가. "some reduction", "various aspects", "deeply involved" 등 filler density 극대.

## P1 Exemplars

### P1 Exemplar 1 — PASS boundary: Quantified metrics present but baseline and period absent
- Candidate context: Senior Backend, 6 years.
- Bullet: "Maintained p99 under 200ms and 99.99% uptime on production APIs."
- Reasoning: A5 P1 rule is "Key signal scannable but surrounding context insufficient for full comprehension." Key signals (p99 200ms, 99.99% uptime) are numeric and popped from scan. However, surrounding context is absent: no system name, no measurement period, no baseline (was this 5000ms before?), no mechanism behind the achievement. Scan yields "good numbers" but not "what was done and how this was achieved" — context gap prevents full comprehension. Signal is alive (not buried, not spill), placing this on the PASS side of the P1 boundary.

### P1 Exemplar 2 — FAIL boundary: Thin key signal with scope and period both absent
- Candidate context: Mid Backend, 4 years.
- Bullet: "안정화 작업을 완료하여 운영 서비스 장애를 완전히 없앰"
- Reasoning: A5 P1 rule is "Key signal scannable but surrounding context insufficient for full comprehension." An outcome signal ("장애 없음") is technically present but thin — "완전히 없앰" is an absolute claim with no number, no timeframe, and no identified service scope. Surrounding context (which services, what period, what stabilization actions) is entirely absent, making scan yield near-zero comprehension of what was done or what the result means in practice. The signal is too thin to anchor any reading, and the dual absence of scope and period makes the gap wide enough to push this to the FAIL side of the P1 boundary.

## Boundary Cases

### EDGE 1 — Long but high-signal
10 lines이지만 각 line이 signal dense — A5 PASS 가능. Length 자체는 disqualifier 아님. (상세 시연: PASS Exemplar 4 참조)

### EDGE 2 — Short but vague
"Improved performance" — 1 line이라도 scan으로 얻는 정보 없음. FAIL.

### EDGE 3 — Structure-agnostic test
동일 내용 one-liner와 PSR 구조 비교:
- "Reduced p99 from 2s to 200ms via read-replica for list endpoints (8M daily queries)"
- PSR version: same content
둘 다 PASS. 구조가 중요하지 않고 signal density가 중요.

## Evaluator Guidance
1. **Mental scan**: bullet을 실제 6-30초 안에 읽어 "문제 / 핵심 결정 / 결과" 파악 시도
2. **Signal density estimate**: filler words 비율, tech-noun density
3. **Burial check**: 핵심 메시지 위치 (앞? 중간? 마지막?)
4. **Detail spill**: rationale 없는 값, 메서드 시그니처, tool parade
5. **Verdict**: PASS | FAIL | P1 (signal scannable 하나 context 부족 시)
6. **Evidence quote**: burial 또는 detail spill 발생 시 해당 문구 인용

## Common Evaluation Pitfalls
- v1 Problem-Strategy-Result 구조 없으면 FAIL (deprecated — A5는 structure-agnostic)
- One-liner 단순 짧다고 FAIL (signal density 충분하면 PASS)
- Length 기반 rule (over-enforcement)
- Detail-rich bullet이 무조건 FAIL (signal dense하면 PASS)
