# Developer Competency Assessment Reference (C1-C5)

## Table of Contents

1. [Overview](#overview)
2. [C1: Technical Code & Design](#c1-technical-code--design)
3. [C2: Technical Operations](#c2-technical-operations)
3. [C3: Business-Technical Connection (Product)](#c3-business-technical-connection-product)
4. [C4: Collaboration & Communication](#c4-collaboration--communication)
5. [C5: Learning & Growth (Engineering Culture)](#c5-learning--growth-engineering-culture)
6. [Career-Level Expectations](#career-level-expectations)
7. [Rating Scale & Output Format](#rating-scale--output-format)
8. [Gap Guidance Standards](#gap-guidance-standards)
9. [Interview Trigger](#interview-trigger)
10. [Anti-Patterns](#anti-patterns)

---

## Overview

After evaluating the self-introduction and establishing the target position, assess the resume holistically against 5 core developer competency axes. This phase answers a fundamentally different question from D1c-D6c / D1p-D6p: not "is this well-written?" but **"does this resume demonstrate that this person is a competent developer?"**

Scan the ENTIRE resume — career bullets, problem-solving entries, signature project, other projects, tech/study sections — for evidence of each competency. This is a cross-resume synthesis, not a per-line evaluation.

---

## C1: Technical Code & Design

**Why this matters:**

Engineers who only use libraries at API level hit a ceiling. When a DB connection pool runs out under load, the engineer who understands WHY `maxLifetime`, `idleTimeout`, and `connectionTimeout` exist — not just what values to set — is the one who diagnoses the root cause in minutes, not days. When a Jackson `ObjectMapper` throws an unexpected exception, the engineer who has read the deserialization internals finds the misconfigured module immediately, while others blindly retry or add catch-all handlers.

Beyond internals, strong engineers constantly ask: "Is my current implementation really the best approach?" They compare their designs against external best practices — open-source reference implementations, conference talks (Nubank's architecture, Netflix's resilience patterns), and peer feedback. This is not academic exercise; it is the habit that prevents teams from calcifying around mediocre patterns.

System performance awareness — knowing where resources are wasted, understanding HA/redundancy trade-offs, questioning whether API call counts can be reduced — signals production maturity. An engineer who asks "Can we use 30% fewer resources and still meet SLOs?" thinks like someone who owns a system, not just writes code for it.

**Evaluation Checklist:**

□ **Library Internals Analysis**
- What to look for: Resume shows the candidate diagnosed problems by understanding framework/library internals — not just API-level usage
- Resume evidence examples:
  - STRONG: "DB Pool의 maxLifetime과 MySQL wait_timeout 불일치가 커넥션 리셋의 원인임을 파악, 설정값 조정으로 장애 해소"
  - PRESENT: "HikariCP 설정 최적화로 커넥션 풀 안정화"
- Absence signal: Only technology names appear ("Redis 사용", "Kafka 적용") with no indication of understanding internals

□ **Design Alternatives & Best Practice Comparison**
- What to look for: Evidence of comparing current implementation against external references, alternative architectures, or industry patterns
- Resume evidence examples:
  - STRONG: "Netflix Zuul의 스레드 모델을 분석하여 비동기 게이트웨이로 전환, 동일 인스턴스에서 처리량 3배 향상"
  - PRESENT: "3가지 캐싱 전략(로컬/분산/CDN) 비교 후 분산 캐시 선택"
- Absence signal: Only describes what was built, never what was compared against or rejected

□ **System Performance Awareness**
- What to look for: Quantified resource optimization, HA/redundancy design decisions, awareness of appropriate resource utilization levels
- Resume evidence examples:
  - STRONG: "피크 시간 EC2 리소스 사용률 분석 결과 CPU 90%/메모리 40% 불균형 확인, 인스턴스 타입 변경으로 비용 30% 절감하며 동일 SLO 유지"
  - PRESENT: "캐시 적용으로 DB 부하 50% 감소"
- Absence signal: Performance claims without targets ("성능 개선", "최적화 완료"), no resource utilization awareness

---

## C2: Technical Operations

**Why this matters:**

Code that works in development means nothing if it fails silently in production. The critical question is not "does it work?" but "when it breaks — and it will break — how fast can you detect, recover, and prevent recurrence?"

A customer reporting an outage before your monitoring system does is an engineering failure. Proactive failure detection — through alerting systems (ES Watcher, Grafana), health checks, and even fault injection testing — separates production-ready engineers from those who deploy and pray.

Recovery design matters equally: does a failure require full server restart and manual intervention, or does the system gracefully degrade with partial functionality preserved? Root cause analysis must go beyond patching symptoms — does prevention depend on people remembering to check, or on systems enforcing it automatically? If recurrence prevention depends on someone remembering to check, it will fail eventually.

Production observability — structured logging, metrics dashboards, distributed tracing — enables debugging without reproducing issues locally. The key question: "Did you actually verify your hypothesis with data?" distinguishes data-driven debugging from guesswork.

The forward-looking mindset: continuously optimizing performance and automating operations keeps the team moving forward instead of drowning in maintenance.

**Evaluation Checklist:**

□ **Proactive Failure Detection**
- What to look for: Monitoring and alerting DESIGN — not just reacting to reported issues. System-detected failures vs customer-reported ones.
- Resume evidence examples:
  - STRONG: "Grafana + PagerDuty 알림 체계 구축으로 장애를 사용자 인지 전 30초 내 자동 감지, Fault Injection 테스트로 감지 누락 시나리오 사전 검증"
  - PRESENT: "모니터링 대시보드 구축으로 장애 감지 시간 단축"
- Absence signal: No mention of monitoring, alerting, or observability design

□ **Resilience & Recovery Design**
- What to look for: Graceful degradation — does a component failure cause partial service reduction or total outage? Is recovery automatic or manual?
- Resume evidence examples:
  - STRONG: "Circuit Breaker로 외부 POS 장애를 격리, 주문 서비스 99.9% 가용성 유지. 장애 시 자동 fallback으로 수동 개입 불필요"
  - PRESENT: "장애 발생 시 자동 재시작 스크립트 구현"
- Absence signal: Only mentions "장애 해결" without explaining recovery mechanism or isolation design

□ **Recurrence Prevention**
- What to look for: Root cause analysis that leads to SYSTEMIC fixes — not workarounds. Prevention that depends on systems, not human memory.
- Resume evidence examples:
  - STRONG: "OOM 근본 원인을 eBPF 기반 메모리 할당 추적으로 특정, 메모리 누수 패턴을 CI 파이프라인에서 자동 감지하도록 시스템화"
  - PRESENT: "장애 원인 분석 후 재발 방지 로직 추가"
- Absence signal: Only "버그 수정", "핫픽스" — patching without root cause analysis or systemic prevention

□ **Production Observability**
- What to look for: Logging and metrics designed for production debugging — not just local development. Cache hit rates, business metrics in dashboards, structured logging.
- Resume evidence examples:
  - STRONG: "분산 트레이싱(Jaeger) + 구조화된 JSON 로깅으로 운영 환경 장애 원인 분석 시간 80% 단축, 캐시 히트율 메트릭으로 캐시 전략 효과 실시간 모니터링"
  - PRESENT: "로깅 개선으로 디버깅 효율화"
- Absence signal: No mention of production debugging capabilities — implies local-only debugging

□ **Hypothesis Validation**
- What to look for: Data-driven verification of assumptions BEFORE applying fixes. Distinguishing validated hypotheses from guesswork.
- Resume evidence examples:
  - STRONG: "가설: 캐시 미스가 지연 원인 → 캐시 히트율 메트릭 확인 결과 98% → 실제 원인은 N+1 쿼리로 판명, 쿼리 최적화로 해결"
  - PRESENT: "원인 분석 후 데이터 기반으로 해결 방안 선택"
- Absence signal: Jumps from problem to solution without showing diagnostic reasoning or data validation

□ **Impact Measurement**
- What to look for: Before/after comparison of deployed changes. Verification that improvements match expectations.
- Resume evidence examples:
  - STRONG: "배포 후 에러율 5%→0.1% 확인, 예상 개선폭(95% 감소)과 실제 결과(98% 감소) 비교 분석"
  - PRESENT: "성능 개선 결과를 수치로 확인"
- Absence signal: "개선 완료", "최적화 성공" without post-deployment verification numbers

□ **Continuous Optimization**
- What to look for: Ongoing performance tuning, operational automation — not just initial delivery but sustained improvement. Evidence the engineer is not stuck maintaining past work.
- Resume evidence examples:
  - STRONG: "정산 검증 자동화로 월 3일 수작업 제거 → 운영 팀이 신규 비즈니스 분석에 집중. 이후 이상 거래 자동 감지 대시보드 추가로 2차 자동화"
  - PRESENT: "배포 자동화로 배포 시간 절감"
- Absence signal: Resume shows only feature development with zero operational improvement

---

## C3: Business-Technical Connection (Product)

**Why this matters:**

Engineers exist to make the business succeed. A resume full of technical metrics (response time, TPS, cache hit rate) without a single business outcome signals someone disconnected from why their work matters.

Building products is hard. Most attempts fail. What matters is delivering results despite this reality — not just shipping, but shipping things that move business needles.

Product scope — whether deep expertise in one domain or broad ownership across multiple areas — reveals the engineer's capacity for responsibility. The ultimate signal: does the team feel your presence or absence?

**Evaluation Checklist:**

□ **Business Growth Contribution**
- What to look for: Technical work explicitly connected to business outcomes — revenue, conversion, retention, cost savings, user growth. Not just "it got faster" but "it grew the business."
- Resume evidence examples:
  - STRONG: "추천 엔진 구축으로 추천 경유 구매 비중 전체의 25% 달성, 월 거래액 N억원 증가에 기여"
  - PRESENT: "서비스 개선으로 사용자 이탈률 감소"
- Absence signal: All achievements framed purely in technical terms (response time, memory usage) with zero business context

□ **Product Scope & Ownership**
- What to look for: Depth or breadth of product ownership — covering significant product areas, or going deep enough in one area to be irreplaceable. The resume should show the candidate's unique contribution that the team would miss.
- Resume evidence examples:
  - STRONG: "결제-정산-재고 전체 도메인 오너십으로 비즈니스 로직 전반을 설계·운영, 팀 내 해당 도메인 의사결정의 중심 역할"
  - PRESENT: "주문 시스템 담당으로 주문 관련 기능 전반 개발"
- Absence signal: Only isolated feature development — no sense of domain ownership or sustained responsibility

---

## C4: Collaboration & Communication

**Why this matters:**

Significant engineering problems — system migrations, architecture redesigns, cross-team integrations — require coordination that goes beyond "let's have a meeting."

Aligning on future plans through assumptions alone makes consensus nearly impossible. Data cuts through disagreement. An engineer who presents traffic analysis, cost projections, or A/B test results transforms an opinion battle into an evidence-based decision.

Written documentation has compounding ROI: every documented decision, runbook, or architecture record saves N future explanations. Soliciting broad input through written artifacts scales communication beyond 1:1 conversations. Sometimes doing double the work exploring alternatives is more efficient than extended debate without data.

**Evaluation Checklist:**

□ **Data-Driven Coordination**
- What to look for: Cross-team alignment achieved through data and evidence — not assumption-based negotiation. Decisions proposed with supporting metrics.
- Resume evidence examples:
  - STRONG: "트래픽 분석 결과 90% 이상이 상위 5페이지에 집중된다는 데이터를 근거로, 전체가 아닌 상위 5페이지만 캐싱하는 전략을 팀에 제안해 합의 도출"
  - PRESENT: "데이터 기반으로 기술 방향 제안"
- Absence signal: Mentions "팀과 협업" or "의사소통" without any evidence of HOW alignment was achieved

□ **Context Transfer Through Documentation**
- What to look for: Written records that reduce explanation overhead — runbooks, architecture decision records, incident postmortems, onboarding docs. Evidence that knowledge is shared through artifacts, not just conversations.
- Resume evidence examples:
  - STRONG: "장애 대응 플레이북 작성으로 온콜 인수인계 시간 1시간→15분 단축, 신규 입사자 온보딩 문서로 적응 기간 2주→3일"
  - PRESENT: "기술 문서 작성으로 지식 공유"
- Absence signal: No mention of documentation, knowledge transfer, or shared written context

---

## C5: Learning & Growth (Engineering Culture)

**Why this matters:**

The depth of your technical knowledge directly determines the quality of feedback you can give to others. A developer who deeply understands distributed systems can spot a subtle race condition or a missing retry policy in a code review. One who only knows surface-level patterns will catch formatting issues at best. Precise feedback is not about being harsh — it is about being USEFUL. This signal in a resume shows the candidate can raise the engineering bar for the entire team.

The difference between ad-hoc improvement and systematic delivery: engineers who consistently produce results follow a methodology — set targets, prioritize by impact, execute sequentially, monitor for anomalies. The pattern scales: each iteration builds on the last, compounding over time.

**Evaluation Checklist:**

□ **Precise Technical Feedback**
- What to look for: Evidence of code review depth, architecture feedback, or mentoring quality that demonstrates deep technical understanding applied to team improvement
- Resume evidence examples:
  - STRONG: "코드 리뷰 가이드 작성 + 주간 아키텍처 리뷰 세션 운영으로 팀 PR 리뷰 리드타임 3일→1일, 프로덕션 버그 30% 감소"
  - PRESENT: "팀 코드 리뷰 프로세스 개선에 기여"
- Absence signal: No mention of feedback, review, mentoring, or knowledge-sharing activities

□ **Systematic Result Delivery**
- What to look for: Goal-driven improvement methodology — setting targets, prioritizing by impact, executing sequentially, setting up anomaly detection. NOT stumbling upon improvements by chance.
- Resume evidence examples:
  - STRONG: "API 응답 속도 p95 500ms 목표 설정 → async profiler로 병목 식별 → 상위 3개 엔드포인트 순차 최적화 → 이상값 자동 알림 설정으로 성능 회귀 방지 체계 구축"
  - PRESENT: "성능 목표를 설정하고 단계적으로 개선"
- Absence signal: Improvements described as one-off events with no systematic approach or ongoing monitoring

---

## Career-Level Expectations

Not all competencies are equally expected at every career level. Do NOT penalize a candidate for missing competencies that are not expected at their level.

| Axis | New Grad / Junior | Mid | Senior |
|------|-------------------|-----|--------|
| C1 Technical Design | AWARENESS — shows curiosity about internals, basic comparison | EXPECTED — demonstrates design alternatives with data | REQUIRED — drives architecture decisions with industry-level comparisons |
| C2 Operations | AWARENESS — basic monitoring/testing understanding | EXPECTED — incident response + root cause + observability | REQUIRED — designs fault-tolerant systems, continuous optimization |
| C3 Product | N/A — limited scope is normal | EXPECTED — connects tech to business metrics | REQUIRED — drives business outcomes as primary frame |
| C4 Communication | N/A — collaboration evidence is a bonus | PRESENT — data-driven team coordination | REQUIRED — shapes team decisions through data + documentation |
| C5 Culture | N/A — learning mindset is sufficient | PRESENT — gives feedback, improves processes | REQUIRED — raises team engineering bar systematically |

**N/A** means the axis is not expected at that level — its absence is NOT a gap and should not be flagged.

---

## Rating Scale & Output Format

Each competency axis is rated on a 4-point scale:

| Rating | Meaning |
|--------|---------|
| **STRONG** | Multiple concrete examples with quantified outcomes; demonstrates the competency clearly and consistently |
| **PRESENT** | At least one concrete example exists; competency is visible but not dominant |
| **WEAK** | Evidence is vague, indirect, or a single passing mention; competency is implied but not demonstrated |
| **ABSENT** | No evidence found anywhere in the resume |
| **N/A** | Not expected at this career level (see Career-Level Expectations table) |

**Output format:**

```
[Developer Competency Assessment]
Career level: {New Grad / Junior / Mid / Senior}

- C1 Technical Code & Design: STRONG / PRESENT / WEAK / ABSENT
  Evidence: {specific resume lines or sections that demonstrate this competency}
  Gap: {if WEAK or ABSENT and EXPECTED/REQUIRED for level — specific recommendation}

- C2 Technical Operations: STRONG / PRESENT / WEAK / ABSENT
  Evidence: {specific resume lines or sections}
  Gap: {specific recommendation if needed}

- C3 Product: STRONG / PRESENT / WEAK / ABSENT / N/A
  Evidence: {specific resume lines or sections}
  Gap: {specific recommendation if needed}

- C4 Communication: STRONG / PRESENT / WEAK / ABSENT / N/A
  Evidence: {specific resume lines or sections}
  Gap: {specific recommendation if needed}

- C5 Engineering Culture: STRONG / PRESENT / WEAK / ABSENT / N/A
  Evidence: {specific resume lines or sections}
  Gap: {specific recommendation if needed}

[Competency Summary]
Strengths: {axes rated STRONG}
Development areas: {axes rated WEAK/ABSENT that are EXPECTED/REQUIRED for this level}
```

---

## Gap Guidance Standards

Gap guidance must be specific and actionable — not abstract advice. The candidate should know exactly what to ADD or CHANGE in their resume.

**Bad gap guidance (too abstract):**
- "Show your operational competency"
- "Add business impact"
- "Surface your feedback experience"

**Good gap guidance (specific and actionable):**
- "C2 WEAK: 장애 감지 방식이 드러나지 않습니다. 장애를 '고객 문의로 감지 vs 시스템 알림으로 감지' 중 어떤 방식이었는지 명시하고, 재발방지 대책이 사람 의존인지 시스템 의존인지 구분하세요"
- "C3 ABSENT: 경력 bullet에 기술 지표(응답 속도, TPS)만 있고 사업 지표(매출, 전환율, 리텐션)가 없습니다. 해당 개선이 사업에 미친 영향을 수치로 추가하세요"
- "C1 WEAK: 기술 선택의 근거가 없습니다. 'Redis 캐시 적용' 대신 '왜 Redis인가? 로컬 캐시 vs 분산 캐시 비교 후 선택' 같은 설계 비교 흔적을 추가하세요"
- "C5 WEAK: 팀 기여 활동이 없습니다. 코드 리뷰, 기술 공유 세션, 온보딩 문서 작성 등 팀의 엔지니어링 수준을 높인 사례가 있다면 추가하세요"

The framing principle: gap guidance should say "if you have this experience, here is how to surface it" — prompt, don't assume absence.

---

## Interview Trigger

When C1-C5 assessment results show a WEAK or ABSENT axis that is EXPECTED or REQUIRED for the candidate's career level → refer to `Read references/experience-mining.md` Phase 4 section and conduct the Experience Mining Interview.

Interview targets only axes rated WEAK/ABSENT (not all 5 axes).

If the user opts out ("다음으로", "넘어가자"), fall back to the Gap Guidance above.

---

## Anti-Patterns

| Thought | Reality |
|---------|---------|
| "D1c-D6c already covers this — isn't this redundant?" | D1c-D6c evaluates per-line writing quality. C1-C5 evaluates cross-resume competency signals. Different dimensions. |
| "I should expect C3 Product from a junior candidate" | Check the Career-Level Expectations table. C3-C5 are N/A for New Grad/Junior. |
| "ABSENT means there's always a problem" | ABSENT ≠ problem. Only flag when the axis is EXPECTED or REQUIRED for the candidate's career level. |
| "If it's not written in the resume, they don't have the competency" | Resume writing gaps ≠ competency gaps. Gap guidance should prompt candidates to surface experiences they have, not assume those experiences don't exist. |
| "A strong resume needs all five axes rated STRONG" | Mid with C1-C2 STRONG + C3 PRESENT is already a strong resume. Not all axes need to be STRONG. |
| "This is subjective so rough evaluation is fine" | Each checklist item has concrete evidence criteria. Rate based on what is actually present in the resume, citing specific lines. |
