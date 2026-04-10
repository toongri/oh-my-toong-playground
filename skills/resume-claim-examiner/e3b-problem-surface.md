# E3b. Problem Surface — Scoring Guide

Reference for E3b Problem Surface evaluation, including constraint cascade scoring formula, anchor rubrics, and scored examples.

---

#### E3b. Problem Surface

Does the bullet reflect the actual surface area of the problem that was solved?

Real engineering problems are never one-dimensional. Fixing a concurrency bug touches atomically coupled models, SLO boundaries, collision testing, root cause analysis, observability instrumentation, and alternative evaluation. A bullet that ignores all of this and presents "one decision, one reason, done" compresses a complex reality into a flat description.

**Dimensions of a problem's surface area:**
- **Root cause**: Why did this problem exist in the first place?
- **Blast radius**: What other systems/models were affected?
- **Alternatives evaluated**: What other approaches were considered and why rejected?
- **Verification**: How was the solution validated? (metrics, testing, monitoring)
- **Operational impact**: SLO changes, failure modes, runtime behavior
- **Accepted costs**: What was consciously given up, and based on what evidence?

**Evaluation method:**
1. Identify the core engineering problem described in the bullet
2. Estimate the problem's inherent surface area — what cascading concerns would a practitioner actually face? (using the dimensions above)
3. Check how many of these the bullet surfaces (even briefly)
4. If the problem inherently has 3+ concerns but the bullet surfaces only 1 → FLAT → FAIL

**Constraint Cascade Grading:**

E3b는 concern이 얼마나 surface 되었는지뿐 아니라, concern들이 어떻게 연결되는지도 평가한다. 3단계 grade:

| Grade | Label | Signal | E3b Effect |
|-------|-------|--------|------------|
| FLAT | Isolated | 단일 결정, 연쇄 효과 없음 | FAIL (score < 0.5) |
| LISTED | Enumerated | 복수 concern이 나열되었지만, concern 간 인과 화살표 없음 | WEAK PASS — P1 finding ("interview-fragile") (score 0.5-0.8) |
| CASCADING | Interlocked | concern 간 관계가 명시적 — cascade(A→B→C), collision(X∧Y→C), 또는 inversion(기대↔실제, 표면→구조 포함) 패턴이 보여 읽는 사람이 '왜 이 해결책인지' 이해 가능 | PASS — interview-generating (score ≥ 0.8) |

**Constraint Cascade Score Formula (reasoning aid — not shown in output):**

grade를 부여하기 전에, 다음 3개 sub-dimension을 먼저 평가한다:

| Sub-dimension | Weight | Question |
|---------------|--------|----------|
| Causal chain depth | 0.30 | How many causally linked steps exist? |
| Constraint narrowing | 0.35 | Does each step narrow the solution space? (Eliminated alternatives visible?) |
| Resolution mutation | 0.35 | Did the solution change shape because of the cascade? (vs. initial approach executed as-is) |

`Constraint Cascade Score = Σ(sub-dimensionᵢ × weightᵢ)` where each sub-dimension is scored 0.0-1.0.

Resolution mutation is weighted equal to constraint narrowing because it is the hardest dimension to fabricate — it requires genuine experience of solution evolution under discovered or analyzed constraints, not just narrative structure.

**Score Anchor Rubric:**

Each sub-dimension is scored 0.0-1.0. Use these anchors to calibrate scoring — identify the observable signal FIRST, then assign the score range.

**Causal chain depth:**

| Level | Score Range | Observable Signal |
|-------|------------|-------------------|
| LOW | 0.0-0.39 | Single decision or parallel concerns listed independently. No "A caused B" or "A revealed B" relationship visible between any two concerns in the text. |
| MID | 0.4-0.69 | 2-3 concerns with some causal linking, but connections are implicit — the reader must infer WHY one concern led to another. Phrases like "also", "additionally", "we handled" connect concerns without explaining the causal mechanism. |
| HIGH | 0.7-1.0 | 3+ concerns with explicit causal chain — each step names what the previous step's outcome forced or revealed. Phrases like "this constraint forced", "which revealed", "because of A, B was no longer viable" appear. Additionally, analytical reasoning chains count as HIGH: when simultaneous constraint analysis produces a sequential reasoning flow (e.g., "constraint X requires A → constraint Y requires B → A and B conflict → novel approach C"), the REASONING steps form the causal chain even if the events did not occur sequentially. The unit is "ordered steps of reasoning or discovery," not "events in chronological order." |

**Constraint narrowing:**

| Level | Score Range | Observable Signal |
|-------|------------|-------------------|
| LOW | 0.0-0.39 | No alternatives mentioned, or alternatives listed without explaining why they were rejected. The solution appears as the only option considered. |
| MID | 0.4-0.69 | Alternatives are mentioned and some are rejected, but rejection reasons are generic ("not suitable", "too complex") or context-free. The constraint that eliminated each alternative is not tied to a specific prior decision or discovery. |
| HIGH | 0.7-1.0 | Each eliminated alternative is rejected by a specific constraint that emerged from an earlier step in the cascade. The narrowing is progressive — the solution space visibly shrinks as each new constraint is discovered, OR reframes to a fundamentally different problem space (e.g., from system-level binary choice to feature-level classification). Both "shrinks" (cascade) and "shifts" (reframing) count as HIGH narrowing — what matters is that the constraints explicitly rule out the standard approaches, not that the solution space closes in a single direction. Phrases like "X was eliminated because [prior discovery] made it unviable" or "standard approaches failed both constraints → reframed as [new problem]" appear. |

**Resolution mutation:**

Resolution mutation measures whether the text reveals an engineer who can compare solutions under multiple constraints, adapt their approach when discoveries or constraint analysis invalidate assumptions, and arrive at a solution whose shape was forged by encountered reality. The core question is: "Does this text show a thinking flow where the approach evolved because of what the engineer learned or analyzed — not just the final answer they arrived at?"

**Timing-neutral principle:** The mutation can occur during pre-implementation analysis ("evaluated X → discovered constraint → switched to Y"), prototype/PoC phase, or production execution. When the discovery happened is irrelevant — what matters is whether the text shows the approach changing shape because of a discovered or analyzed constraint. A pre-implementation analysis journey counts identically to a production-incident-driven pivot.

**Path-neutral principle:** The mutation can occur through multiple distinct patterns. Sequential discovery (cascade) is one path, but simultaneous constraint analysis (collision) and expectation inversion (including scope expansion) are equally valid paths to HIGH. The anchor evaluates "did the approach fundamentally change shape?" not "did it change shape through a specific narrative structure?"

**Process vs. conclusion:** "X was possible but we chose Y" is a conclusion (LOW). "We evaluated X → discovered [specific constraint] → switched to Y" OR "Constraints A and B were simultaneously incompatible → standard approaches failed both → creative synthesis C" are processes (MID-HIGH) — they show the constraint-driven reshape arc. Only process generates interview follow-up questions; conclusions terminate the conversation.

| Level | Score Range | Observable Signal |
|-------|------------|-------------------|
| LOW | 0.0-0.39 | The final approach matches what appears to be the initial approach. No visible evidence that the approach changed shape due to discovered or analyzed constraints. The text reads as "we chose X and executed X," or mentions alternative transitions as conclusions without showing the discovery/analysis process that drove them. Well-known patterns applied without visible adaptation. |
| MID | 0.4-0.69 | The approach expanded or adjusted beyond its initial shape, but the evolution path is partially visible. The text shows some constraint-driven adjustments but cannot trace a full reshape arc — whether through sequential discovery, constraint collision, expectation inversion, or scope expansion. Connections exist but are implicit. Partial visibility by pattern: (A) constraints discovered but reshape not traced — reader sees adjustments without the discovery that triggered them; (B) two constraints mentioned but collision not explicitly recognized — reader infers tension without seeing it stated; (C) conventional approach questioned but non-obvious root cause not named — or deeper structural issue hinted at but connection to surface problem implicit — reader senses something was wrong or suspects more without the underlying cause or structural link being shown. |
| HIGH | 0.7-1.0 | The final approach is a fundamentally different shape from what a reasonable engineer would initially attempt. The text shows at least ONE of these evolution patterns: (A) **Cascade Discovery** — A discovered constraint made the initial approach unviable, forcing a reshape. The reader traces: initial approach → constraint discovered → approach reimagined. (B) **Constraint Collision** — Two or more constraints were simultaneously incompatible with standard approaches. The solution required creative synthesis that neither constraint alone would have produced. The reader sees: constraint X requires A, constraint Y requires B, A and B conflict → novel approach C. (C) **Expectation Inversion** — The conventional/expected approach was evaluated and found ineffective for a non-obvious reason. The solution addressed the actual root cause rather than the assumed one. The reader's initial assumption is violated. This includes cases where investigation revealed the surface problem was a symptom of a deeper structural issue — the solution addressed the root cause rather than the symptom, and the reader discovers the true problem alongside the engineer. Common signal across all three patterns: the reader can identify (1) what the expected/initial approach was, (2) what made it insufficient — whether discovered sequentially, known simultaneously, or revealed through investigation, and (3) how the approach was fundamentally reshaped. Whether this occurred during analysis, prototyping, or production is irrelevant — the visible reshape arc is what matters. |

Threshold: score ≥ 0.8 = CASCADING(PASS), 0.5-0.8 = LISTED(P1 — 권장 수정), < 0.5 = FLAT(FAIL).

**CRITICAL: Score the sub-dimensions FIRST, then derive the grade. Do not assign a grade and then rationalize scores to match. This is the reasoning-before-score rule.**

---

**Constraint Cascade Example A — Real-Time Notification System (3-tier 전체):**

FLAT (score < 0.5):
"Built real-time notification system using WebSocket + Redis Pub/Sub, delivering notifications within 500ms."

→ FLAT: One decision (WebSocket + Redis), one metric (500ms). No cascading effects. Why WebSocket over SSE? Why Redis Pub/Sub over Kafka? What happens when connections exceed single-node capacity? The problem is presented as one-dimensional when it inherently isn't.
  Causal chain depth: 0.1 (single decision, no chain)
  Constraint narrowing: 0.1 (no alternatives eliminated)
  Resolution mutation: 0.0 (no evidence the approach changed shape — no discovery process visible)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "You used WebSocket and Redis. Okay." — Nothing to discuss.

LISTED (score 0.5-0.8):
"Real-time notification system — evaluated WebSocket vs SSE vs long polling. Chose WebSocket for bidirectional communication. Used Redis Pub/Sub for cross-instance message distribution. Handled connection drops with exponential backoff reconnection. Achieved 500ms delivery latency."

→ LISTED: Multiple concerns surfaced (protocol selection, cross-instance distribution, connection resilience) with some causal connection — WebSocket choice implies need for cross-instance distribution, and distribution implies connection management. But the connections are implicit rather than explicit: no explanation of WHY WebSocket forces Redis Pub/Sub, or HOW cross-instance distribution creates the specific reconnection challenge.
  Causal chain depth: 0.7 (concerns mentioned with some causal linking between protocol choice and distribution)
  Constraint narrowing: 0.5 (alternatives mentioned, some eliminated by context)
  Resolution mutation: 0.4 (solution partially evolved from initial approach)
  Score: 0.7×0.30 + 0.5×0.35 + 0.4×0.35 = 0.525 → LISTED
  → CTO reaction: "You evaluated options and chose WebSocket. Tell me more about the reconnection." — One follow-up, then done.

CASCADING (score ≥ 0.8):
"Real-time notification for 50K concurrent connections — SSE evaluated first (simpler, unidirectional sufficient for notifications), but connection-per-browser-tab limit (6 per domain) meant power users with 3+ tabs would miss notifications. WebSocket removed this constraint but introduced state management: each connection needs heartbeat tracking, and reconnecting clients need message replay. Redis Pub/Sub for cross-instance fan-out — but Pub/Sub is fire-and-forget, no persistence. Missed messages during reconnection are unrecoverable. Added per-user message buffer (Redis Sorted Set, 5-min TTL) for replay window. Tradeoff accepted: 2x Redis memory vs SSE baseline, buffer expiry means messages older than 5 min are lost (acceptable for notifications, not for chat)."

→ CASCADING: SSE constraint (tab limit) → forces WebSocket → introduces state management → reconnection requires message replay → Pub/Sub's fire-and-forget property blocks replay → forces message buffer → creates memory tradeoff. Each decision is caused by the previous constraint.
  Causal chain depth: 0.9 (5-step chain, each caused by previous)
  Constraint narrowing: 0.8 (SSE eliminated by tab limit, Pub/Sub alone eliminated by replay need)
  Resolution mutation: 0.75 (initial approach was SSE; constraint discovery during evaluation (tab limit) reshaped the approach to WebSocket + buffer with replay window — fundamentally different architecture. Two distinct constraint-driven reshapes visible: SSE → tab-limit discovery → WebSocket, then Pub/Sub fire-and-forget limitation → message buffer addition)
  Score: 0.9×0.30 + 0.8×0.35 + 0.75×0.35 = 0.8125 → CASCADING
  Result: 500ms p99 delivery latency maintained at 50K connections, reconnection message loss rate <0.1%.
  → CTO asks: "How did you handle buffer overflow during notification storms? What's the reconnection window behavior for mobile clients? Did you measure the actual tab-limit impact before switching from SSE?"

**Constraint Cascade Example B — Cache Stampede / Hot Key (Pattern A: Cascade Discovery):**

FLAT (score < 0.5):
"Redis 캐시 적용으로 상품 조회 API 응답 시간 3.2s → 400ms, DB 부하 80% 절감."

→ FLAT: 단일 결정(캐시 적용), 단일 결과(응답 시간). 왜 3.2초였는지, 어떤 캐시 패턴인지, 어떤 문제가 발생했는지 보이지 않음.
  Causal chain depth: 0.1 (단일 결정, 인과 체인 없음)
  Constraint narrowing: 0.1 (대안 언급 없음)
  Resolution mutation: 0.0 (접근 변형 증거 없음 — "캐시 적용"이 초기 접근이자 최종 접근)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "캐시 넣었군요. 그래서요?" — 논의할 내용 없음.

LISTED (score 0.5-0.8):
"상품 조회 API p99 3.2s — cache-aside 패턴 도입(TTL 5분). Cache stampede 발생하여 singleflight로 중복 요청 병합. Hot key 문제(상위 100개 상품이 캐시 요청 60% 점유)는 local cache 추가로 해결. 응답 시간 400ms, DB 부하 80% 절감."

→ LISTED: 복수 concern(stampede, hot key, singleflight, local cache) 나열되어 있고 일부 인과 연결(stampede → singleflight). 그러나 singleflight가 hot key를 왜 해결하지 못하는지, local cache의 일관성 트레이드오프가 무엇인지 명시되지 않음. 각 concern이 이전 concern에서 왜 발생했는지 독자가 추론해야 함.
  Causal chain depth: 0.6 (stampede → singleflight → hot key 별도 발견 → local cache, 4단계이나 연결이 암묵적)
  Constraint narrowing: 0.5 (singleflight가 stampede를 해결했다고 서술하지만, hot key에 왜 불충분한지 불명확)
  Resolution mutation: 0.4 (cache-aside에서 singleflight, local cache로 확장되었으나, 확장이 강제된 이유가 암묵적 — 발견 과정이 아닌 결과만 나열)
  Score: 0.6×0.30 + 0.5×0.35 + 0.4×0.35 = 0.495 → FLAT (경계)
  → CTO reaction: "Stampede랑 hot key를 해결했군요. singleflight로 왜 부족했죠?" — 질문 가능하지만 답이 bullet에 없음.

CASCADING (score ≥ 0.8) via Cascade Discovery:
"상품 조회 API p99 3.2s — cache-aside 패턴 도입 후 TTL 5분 설정. 인기 상품 TTL 동시 만료 시 cache stampede 발생, DB 순간 부하 기존 대비 3배. singleflight로 인스턴스 내 중복 요청 병합했으나, hot key 문제는 별개 차원 — 상위 100개 상품이 전체 캐시 요청의 60%를 점유하여 단일 Redis 샤드에 부하 집중. singleflight는 인스턴스 내 중복만 해소, 크로스 인스턴스 동시 요청은 여전히 Redis 단일 샤드 직격. 대안 평가: consistent hashing으로 hot key 분산 → 캐시 무효화 복잡도 증가, 운영 부담; hot key 복제(read replica) → 일관성 윈도우 + 메모리 2배. 선택: L1 local cache(Caffeine, 2초 TTL) + L2 Redis 2-tier 구조 — hot key는 L1에서 흡수, L2 미스 시에만 DB. 트레이드오프 수용: L1-L2 일관성 최대 2초 stale(상품 정보 갱신 주기 대비 허용), hot key 감지 자동화(접근 빈도 기반 L1 승격 로직) 필요, 인스턴스당 힙 200MB 증가. 결과: p99 400ms, DB 부하 80% 절감, stampede 시 DB 부하 스파이크 제거."

→ CASCADING via Cascade Discovery: cache-aside 도입 → stampede 발견 → singleflight 적용 → hot key라는 별개 차원 문제 발견 → singleflight의 한계(인스턴스 내만 해소) 확인 → L1/L2 2-tier로 근본 전환. 각 단계가 이전 해결의 한계에서 발생.
  Causal chain depth: 0.9 (cache-aside → stampede → singleflight → hot key 발견 → singleflight 한계 확인 → 대안 평가 → L1/L2 2-tier, 6단계 명시적 인과 체인)
  Constraint narrowing: 0.8 (consistent hashing: 무효화 복잡도로 기각, read replica: 일관성+메모리로 기각 — 각 기각이 hot key라는 선행 발견에 의해 구체적으로 연결)
  Resolution mutation: 0.8 (초기 접근은 "cache-aside + TTL"(FLAT 버전). stampede로 singleflight 추가, 그러나 hot key로 인해 단일 캐시 레이어 접근 자체가 무효화 → 2-tier 아키텍처로 근본 전환. 단순 캐시 설정에서 다층 캐시 아키텍처로 변형. Pattern A — Cascade Discovery에 해당)
  Score: 0.9×0.30 + 0.8×0.35 + 0.8×0.35 = 0.83 → CASCADING
  → CTO asks: "Hot key 감지 기준은? L1 승격/강등 로직은 어떻게 동작하나? Stampede 재현 테스트는 어떻게 했나? 2초 stale 윈도우에서 가격 정보 불일치 리스크는?"

**Constraint Cascade Example C — Feature Serving Latency-Consistency (Pattern B: Constraint Collision):**

FLAT (score < 0.5):
"실시간 추천 서비스에서 Redis 캐시와 크로스 리전 데이터 동기화를 구현하여 sub-10ms 응답과 데이터 일관성을 달성."

→ FLAT: 두 기술(캐시, 동기화)을 적용했다는 서술뿐. sub-10ms와 일관성이 동시에 달성되었다고 하지만, 이 두 요구가 왜 어려운지, 어떤 충돌이 있었는지, 무엇을 포기했는지 보이지 않음.
  Causal chain depth: 0.1 (두 기술 병렬 나열, 인과 관계 없음)
  Constraint narrowing: 0.1 (대안 언급 없음)
  Resolution mutation: 0.0 (접근 변형 증거 없음)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "캐시랑 동기화를 했군요." — 논의할 내용 없음.

LISTED (score 0.5-0.8):
"실시간 추천 서비스에서 sub-10ms 응답 SLA와 크로스 리전 일관성을 동시에 요구. 로컬 캐시는 빠르지만 리전 간 30초 불일치 발생, 강한 일관성은 RTT 50ms 추가로 SLA 위반. 피처별 일관성 수준을 분류하여 해결. 가격은 강한 일관성, 추천 스코어는 eventual consistency 적용."

→ LISTED: 두 제약(SLA vs 일관성)과 충돌이 명시되고, 해결 방향(피처별 분류)이 보임. 그러나 분류 기준이 무엇인지(왜 가격은 강한 일관성?), 표준 접근이 왜 양립 불가능한지의 분석 과정, 트레이드오프가 구체적으로 서술되지 않음. 충돌은 인식되었지만 합성 과정이 암묵적.
  Causal chain depth: 0.55 (SLA 제약 + 일관성 제약 → 충돌 인식 → 피처별 분류, 3단계이나 분석 과정이 압축됨)
  Constraint narrowing: 0.5 (로컬 캐시: 일관성 실패, 강한 일관성: SLA 위반으로 각각 기각되었지만, 기각 근거가 간략)
  Resolution mutation: 0.55 (캐시 vs 일관성 이진 선택에서 피처별 분류로 전환되었으나, 이 전환이 어떤 분석에서 비롯되었는지 과정이 보이지 않음 — 결론만 제시)
  Score: 0.55×0.30 + 0.5×0.35 + 0.55×0.35 = 0.5325 → LISTED
  → CTO reaction: "피처별 일관성 분류를 했군요. 분류 기준은 어떻게 정했나요?" — 한 단계 후속 질문, 그러나 분류 로직이 bullet에 없음.

CASCADING (score ≥ 0.8) via Constraint Collision:
"실시간 추천 서비스에서 sub-10ms 응답 SLA와 크로스 리전 데이터 일관성을 동시에 달성해야 했다. 로컬 캐시로 지연시간을 충족하면 리전 간 데이터 불일치(최대 30초) — 가격 불일치 시 CS 인입 직결. 강한 일관성을 적용하면 크로스 리전 RTT 50ms 추가로 SLA 위반. 두 제약이 표준 접근(캐시 단독 or 일관성 단독)에서는 양립 불가. 피처의 비즈니스 임팩트를 기준으로 일관성 분류를 도입 — 가격·재고(부정확 시 CS 인입)는 강한 일관성(응답의 일부 항목이므로 전체 p95 영향 미미), 추천 스코어·카테고리 랭킹은 eventual consistency(2초 stale 허용). 분류 기준은 'CS 인입 확률'이라는 비즈니스 메트릭으로 정량화. 트레이드오프: 피처 추가 시 일관성 분류 의무화(관리 복잡도), 분류 오류 시 가격 불일치 노출 리스크를 A/B 모니터링으로 완화. 결과: 전체 p95 응답 9ms 유지, 가격 불일치 CS 인입 0건, eventual consistency 피처의 stale 영향 추천 CTR 변화 <0.1%."

→ CASCADING via Constraint Collision: 두 제약(sub-10ms SLA, 크로스 리전 일관성)이 표준 접근에서는 양립 불가 → 문제를 시스템 레벨에서 피처 레벨로 재프레이밍 → 비즈니스 임팩트 기반 분류라는 이전 프레이밍에는 없던 새로운 차원을 도입. Cascade가 아닌 동시 제약 분석에서 접근 자체가 근본적으로 변형됨.
  Causal chain depth: 0.8 (제약 충돌 → 표준 접근 양립 불가 → 문제 재프레이밍 → 피처별 분류 → 비즈니스 메트릭 기반 정량화, 4+ 단계의 분석적 추론 체인)
  Constraint narrowing: 0.8 (캐시 단독: 일관성 실패로 기각, 강한 일관성 단독: SLA 위반으로 기각 — 각 기각이 구체적 제약에 연결되어 표준 접근 양립 불가를 명시적으로 보여줌)
  Resolution mutation: 0.85 (초기 프레이밍은 "캐시 vs 일관성" 이진 선택. 최종 접근은 "피처별 일관성 분류"로 문제 자체를 재정의 — 시스템 레벨 → 피처 레벨 전환. 두 제약의 동시 분석이 이진 프레이밍을 깨뜨림. Pattern B — Constraint Collision에 해당)
  Score: 0.8×0.30 + 0.8×0.35 + 0.85×0.35 = 0.8175 → CASCADING
  → CTO asks: "피처 분류 기준은 어떻게 정했나? 새로운 피처 유형이 추가되면 분류 프로세스는? eventual consistency 2초 윈도우에서 추천 품질 저하는 측정했나?"

**Constraint Cascade Example D — Event-Driven Order Zombie (Pattern B: Constraint Collision):**

FLAT (score < 0.5):
"Kafka 기반 비동기 주문 처리 파이프라인 구축, saga 패턴으로 분산 트랜잭션 관리. 주문 처리 실패율 0.01% 이하 달성."

→ FLAT: saga 도입과 결과만 서술. 왜 saga가 필요했는지, 어떤 유형의 실패가 발생했는지, 어떤 트레이드오프를 수용했는지 보이지 않음.
  Causal chain depth: 0.1 (단일 결정, 인과 체인 없음)
  Constraint narrowing: 0.1 (대안 언급 없음)
  Resolution mutation: 0.0 (접근 변형 증거 없음 — "saga 도입"이 초기이자 최종 접근)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "Saga 넣었군요. 그래서요?" — 논의할 내용 없음.

LISTED (score 0.5-0.8):
"주문-결제-재고 이벤트 파이프라인에서 좀비 주문 일 5건 발생. PG 콜백 지연(p99 8초)이 saga timeout(5초) 초과하여 보상 트랜잭션 발동 후 지연 콜백 충돌. orchestration saga로 전환하고 step-level timeout을 분리하여 해결. 좀비 주문 일 5건 → 월 2건."

→ LISTED: 문제(좀비 주문)와 기술 과제(PG 콜백 지연 vs saga timeout)가 보이고, 해결 방향(orchestration + step-level timeout)이 명시. 그러나 두 제약(빠른 checkout UX vs PG 지연 허용)의 충돌이 명시적이지 않음. 왜 timeout을 단순 연장하지 않았는지, 지연 콜백 충돌을 어떻게 방어하는지(idempotency), 좀비 감지 메커니즘이 없음. 문제 인식은 있지만 제약 충돌의 합성 과정이 불완전.
  Causal chain depth: 0.6 (PG 지연 → timeout 초과 → 좀비 발생 → orchestration 전환, 4단계이나 UX 제약과의 충돌이 암묵적)
  Constraint narrowing: 0.5 (orchestration을 선택했다고 서술하지만, choreography나 timeout 연장이 왜 기각되었는지 불명확)
  Resolution mutation: 0.5 (choreography에서 orchestration + step-level timeout으로 전환되었으나, 이 전환을 강제한 두 제약의 충돌 분석이 보이지 않음 — 결과적 전환만 서술)
  Score: 0.6×0.30 + 0.5×0.35 + 0.5×0.35 = 0.53 → LISTED
  → CTO reaction: "Orchestration으로 전환했군요. 왜 timeout을 그냥 늘리지 않았나요?" — 질문 가능하지만 답이 bullet에 없음.

CASCADING (score ≥ 0.8) via Constraint Collision:
"주문-결제-재고-배송 4단계 이벤트 파이프라인에서 일 평균 5건 주문이 '결제 완료-재고 미차감' 좀비 상태로 잔류 — CS 인입 직결. 프로파일링: 80% PG 콜백 지연(p99 8초)으로 saga timeout(5초) 초과 → 보상 트랜잭션 발동 → 직후 지연 콜백 도착 → 이미 취소된 주문에 결제 성공 이벤트 충돌. 두 제약이 충돌: 빠른 checkout UX(saga timeout 5초 이내) vs PG 콜백 지연 허용(최소 15초 필요). timeout 단순 연장은 checkout 체감 지연 — 비즈니스 거부. 대안 평가: choreography saga → step-level 가시성 부재로 좀비 감지 불가, 운영 부담; saga timeout 15초 연장 → checkout UX 악화, 비즈니스 거부; PG 콜백을 동기 polling 전환 → PG rate limit + polling 비용. 선택: orchestration saga + step-level timeout 분리 — 결제 step만 15초(PG p99 커버), 나머지 step 3초 유지로 전체 saga 체감 지연 최소화. 지연 콜백 충돌은 idempotency key(주문번호+이벤트 시퀀스) + 상태 머신으로 방어 — COMPENSATED 상태에서 SUCCESS 이벤트 무시. 좀비 감지: step별 SLA 기반 미완료 saga 15분 주기 스캔 + Slack 알림, 일 1회 reconciliation batch로 최종 정합성 검증. 트레이드오프 수용: step-level timeout 관리 복잡도(PG 변경 시 재조정 필요), orchestrator 단일 장애점(active-passive failover), reconciliation 윈도우 최대 24시간 불일치. 결과: 좀비 주문 일 5건 → 월 2건 미만, 감지-복구 평균 4시간 → 15분."

→ CASCADING via Constraint Collision: 두 제약(빠른 checkout UX 5초 vs PG 콜백 지연 15초)이 표준 접근(단일 timeout)에서 양립 불가 → step-level timeout 분리라는 문제 재프레이밍 + 지연 콜백 방어(idempotency 상태 머신) + 좀비 감지(주기적 스캔 + reconciliation)의 3중 해결. 단일 timeout 접근에서 step-level 분화 + 상태 머신 + 모니터링 복합 접근으로 근본 전환.
  Causal chain depth: 0.85 (PG 지연 프로파일링 → timeout 충돌 발견 → 두 제약(UX vs PG) 양립 불가 → 대안 3개 평가 기각 → step-level timeout 분리 + idempotency 상태 머신 + 좀비 스캔, 5+ 단계 분석적 추론 체인)
  Constraint narrowing: 0.8 (choreography: 가시성 부재로 기각, timeout 연장: UX 악화로 기각, polling: rate limit + 비용으로 기각 — 각 기각이 두 제약 충돌의 맥락에서 구체적)
  Resolution mutation: 0.85 (초기 접근은 "단일 saga timeout 설정"(FLAT 버전). 두 제약 충돌로 단일 timeout이 불가능 → step-level 분리라는 새로운 차원 도입 + idempotency 상태 머신 + reconciliation으로 3중 방어. 단일 설정에서 복합 아키텍처로 문제 자체가 재프레이밍됨. Pattern B — Constraint Collision에 해당)
  Score: 0.85×0.30 + 0.8×0.35 + 0.85×0.35 = 0.8325 → CASCADING
  → CTO asks: "Step-level timeout 값은 어떻게 결정했나? PG 변경 시 timeout 재조정 프로세스는? COMPENSATED 상태에서 SUCCESS 무시 시 결제 금액은 어떻게 환불하나? Reconciliation에서 발견된 불일치의 자동 복구 범위는?"

**Constraint Cascade Example E — Subscription Renewal Failures (Expectation Inversion pattern):**

FLAT (score < 0.5):
"Reduced subscription renewal failure from 15% to 4% with exponential backoff retry with jitter and adding fallback payment methods."

→ FLAT: Standard retry pattern applied without analysis. No root cause, no failure type breakdown, no measurement methodology. Any engineer could propose this.
  Causal chain depth: 0.1 (single decision, no chain)
  Constraint narrowing: 0.1 (no alternatives mentioned)
  Resolution mutation: 0.0 (no evidence the approach changed shape — "retry improvement" is the obvious first approach executed as-is)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "Retry with jitter and fallback. That's what I'd expect anyone to do." — Nothing to discuss.

LISTED (score 0.5-0.8):
"Subscription renewal failure at 15% — analyzed failure types: 60% soft declines (insufficient funds), 25% expired cards, 15% hard declines. Noticed soft declines clustered on 1st of month. Adjusted retry timing to avoid peak decline periods. Added account updater API for expired cards. Reduced to 4%."

→ LISTED: Multiple concerns surfaced (failure type breakdown, timing pattern, expired card handling) with some causal connection — failure analysis leads to timing insight, which informs retry adjustment. But the key inversion ("retry logic itself was fine") is not explicitly stated. The reader must infer that the solution changed from "fix retry logic" to "fix retry timing." The conventional assumption (retry mechanism is broken) is implicitly questioned but never named.
  Causal chain depth: 0.6 (failure breakdown → timing pattern → retry adjustment, 3 steps with some implicit links)
  Constraint narrowing: 0.5 (alternatives not explicitly evaluated and rejected — the reader sees the chosen solution but not why other approaches were eliminated)
  Resolution mutation: 0.5 (approach shifted from generic retry to timing-based retry, but the expectation inversion is implicit — text does not state "retry logic was functioning correctly" or explicitly name the conventional assumption that was overturned. The reader senses something changed but cannot trace the inversion arc)
  Score: 0.6×0.30 + 0.5×0.35 + 0.5×0.35 = 0.53 → LISTED
  → CTO reaction: "You analyzed failure types and adjusted timing. What made you look at timing specifically?" — One follow-up, but the inversion story is not self-evident.

CASCADING (score ≥ 0.8) via Expectation Inversion:
"Subscription renewal failure at 15% — failure type breakdown: 60% soft declines (insufficient funds) clustered on 1st of month (rent/mortgage day), 25% expired cards, 15% hard declines. Retry logic was functioning correctly; retry TIMING was the problem. Alternatives evaluated: aggressive retry → increases PSP decline-rate penalties on same empty accounts; pre-charge 3 days early → billing cycle mismatch, legal review required; grace period + dunning → 5-7 day cash flow delay per cohort. Selected: regional payday-pattern-based retry scheduling + account updater API for expired card pre-refresh. Tradeoff accepted: retry window extended 3→7 days (delayed revenue recognition for subset), regional payday mapping requires quarterly maintenance. Result: 15% → 4% without changing retry logic itself."

→ CASCADING via Expectation Inversion: 기대한 원인(retry logic 결함)이 틀렸고, 비자명한 근본 원인(retry timing — 사용자 급여일 패턴)이 드러남. "Retry logic was functioning correctly"가 핵심 반전점. 최종 문장 "without changing retry logic itself"가 초기 기대와 최종 접근의 정반대를 명시 선언.
  Causal chain depth: 0.85 (15% 분석 → failure type breakdown → 1일 클러스터링 발견 → "retry logic 정상, timing이 문제" 핵심 반전 → aggressive retry의 PSP penalty 제약 도출 → scheduling + updater API 이원 해결, 5단계)
  Constraint narrowing: 0.85 (aggressive retry: PSP penalty로 기각 — timing 분석 결과와 직접 연결, pre-charge: billing cycle + legal로 기각, grace period: cash flow delay로 기각 — 세 대안 모두 구체적 제약으로 제거)
  Resolution mutation: 0.9 (초기 기대 접근은 "retry logic 수정"(FLAT 버전 그 자체). 반전: logic이 아니라 timing이 문제. 최종 접근: regional payday-pattern scheduling — 기술 문제에서 행동 패턴 문제로 재정의. "without changing retry logic itself"가 초기 접근과의 정반대를 확인. Pattern C — Expectation Inversion에 해당)
  Score: 0.85×0.30 + 0.85×0.35 + 0.9×0.35 = 0.8675 → CASCADING
  → CTO asks: "Payday 가설을 어떻게 검증했나? 비표준 급여 주기(주급, 격주급)는 어떻게 처리하나? Regional payday mapping의 quarterly maintenance 프로세스는?"

Note: This example achieves CASCADING through Expectation Inversion — the "obvious" answer (fix retry logic) was wrong. The mutation comes from the discovery that the mechanism was correct but the timing was wrong, shifting the problem from a technical domain (retry algorithm) to a behavioral domain (user payment patterns). The final sentence ("without changing retry logic itself") explicitly confirms the inversion.

**Constraint Cascade Example F — Search Performance Degradation (Scope Expansion pattern):**

FLAT (score < 0.5):
"Optimized e-commerce search from 2s to 120ms with Elasticsearch caching and index mapping optimization."

→ FLAT: Standard ES optimization. No root cause for why performance degraded, no degradation pattern analysis, no mechanism to prevent recurrence. Fixes the symptom today, allows the same degradation to repeat tomorrow.
  Causal chain depth: 0.1 (single decision, no chain)
  Constraint narrowing: 0.1 (no alternatives mentioned)
  Resolution mutation: 0.0 (no evidence the approach changed shape — "ES optimization" is the obvious first approach executed as-is)
  Score: 0.1×0.30 + 0.1×0.35 + 0.0×0.35 = 0.065 → FLAT
  → CTO reaction: "You optimized Elasticsearch. What else?" — Nothing to discuss.

LISTED (score 0.5-0.8):
"Search response degraded 200ms → 2s over 6 months. Root cause: merchandising team adding 340 custom product attributes, most rarely queried but all indexed identically. Evaluated vertical scaling ($8K/month, degradation resumes) and index partitioning (scatter-gather latency). Implemented attribute tiering — hot attributes in primary index, cold attributes via async enrichment. Result: 120ms p99."

→ LISTED: Multiple concerns surfaced (root cause identification, alternatives evaluated, tiering solution) with causal connection — attribute growth causes degradation, vertical scaling doesn't address root cause. But the scope expansion is incomplete: the text identifies the organizational cause (merchandising team behavior) but does not address it. The reader sees a technical fix for an organizational problem — the deeper structural issue (no feedback loop to merchandising team) is hinted at but not resolved.
  Causal chain depth: 0.65 (degradation → attribute growth → merchandising team behavior identified → alternatives evaluated → tiering chosen, 4 steps but the organizational dimension is mentioned without being causally linked to the solution)
  Constraint narrowing: 0.6 (vertical scaling rejected by cost + recurrence, partitioning rejected by latency — but attribute count limit rejection by stakeholder not mentioned, so the constraint that forces organizational solution is absent)
  Resolution mutation: 0.45 (approach expanded from "optimize ES" to "tier attributes by frequency" — a meaningful shift in framing. However, the deeper expansion from "technical problem" to "organizational behavior problem" is only hinted at, not traced. The solution remains purely technical; the scope expansion arc is incomplete)
  Score: 0.65×0.30 + 0.6×0.35 + 0.45×0.35 = 0.5625 → LISTED
  → CTO reaction: "You tiered attributes by frequency. But won't the same degradation happen again as more attributes accumulate?" — The prevention mechanism is missing.

CASCADING (score ≥ 0.8) via Scope Expansion:
"Search response degraded 200ms → 2s over 6 months — correlated with merchandising team adding 340 custom product attributes (290 queried by <0.1% of searches but indexed identically to high-traffic attributes). Alternatives evaluated: vertical scaling → $8K/month increase, degradation resumes as attributes continue growing; index-per-category partitioning → 15+ indices, scatter-gather adds latency for cross-category search; attribute count limit → merchandising rejected, attributes drive A/B testing. Selected: attribute tiering by query frequency — hot (top 50) in primary index, cold (290) via async enrichment path. Added self-service dashboard showing per-attribute query frequency to merchandising team. Tradeoff accepted: cold-attribute queries add 50-200ms enrichment delay (<0.3% of searches), dashboard maintenance cost, attribute creation friction. Result: 120ms p99 for 99.7% of queries; attribute creation rate dropped 40% organically — informed decisions, not enforcement."

→ CASCADING via Scope Expansion: 표면 문제(검색 성능 저하) → 1차 발견(290개 저빈도 attribute 동일 인덱싱) → 2차 발견(merchandising 팀의 무제약 추가 행동이 근본 원인) → attribute count limit 비즈니스 거부 → 기술적 제한 불가, 조직적 해결 필요 → tiering(기술) + dashboard(조직 피드백 루프) 이원 해결. "informed decisions, not enforcement"가 scope expansion의 본질 — 기술 수정이 아닌 행동 변화가 진정한 해결.
  Causal chain depth: 0.9 (점진적 저하 분석 → 290개 저빈도 attribute 발견 → merchandising 팀 무제약 추가 행동이 원인 → vertical scaling이 "attribute 계속 증가"로 근본 해결 불가 → attribute count limit 비즈니스 거부 → tiering + dashboard 이원 해결, 6단계)
  Constraint narrowing: 0.85 (vertical scaling: $8K/mo + 재발로 기각 — 근본 원인 분석과 직접 연결, partitioning: scatter-gather latency로 기각, count limit: 비즈니스 거부로 기각 — 이 기각이 기술적 해결 불가 → 조직적 해결 필요라는 문제 공간 전환을 강제)
  Resolution mutation: 0.9 (초기 기대 접근은 "ES 최적화"(FLAT 버전 그 자체). Scope 확장: 검색 문제 → 인덱스 문제 → attribute 문제 → 조직 행동 문제. 최종 해결의 절반이 코드가 아닌 조직 개입(dashboard). "informed decisions, not enforcement"가 기술 → 조직 전환의 완성. Pattern D — Scope Expansion에 해당)
  Score: 0.9×0.30 + 0.85×0.35 + 0.9×0.35 = 0.8825 → CASCADING
  → CTO asks: "Merchandising 팀이 실제로 dashboard 보고 행동을 바꿨나? Attribute promotion/demotion (cold→hot 전환) 기준은? Dashboard 유지보수 비용 대비 효과 측정은?"

Note: This example achieves CASCADING through Scope Expansion — the surface problem (search is slow) was a symptom of a deeper structural issue (no feedback loop for attribute creation impact). The mutation comes from the problem itself being redefined: from "how to optimize search" to "how to change organizational behavior that causes search degradation." The solution's most impactful component (dashboard) is not code — it's an organizational intervention. The LISTED version demonstrates what happens when scope expansion is incomplete: the organizational cause is identified but not addressed, leaving the CTO's obvious follow-up ("won't this happen again?") unanswered.

---

**Exception:** If the problem is genuinely one-dimensional (single decision with no cascading effects, no measurement needs, no contested alternatives), E3b PASSES automatically. The evaluator must justify WHY the problem is one-dimensional before applying this exception.

**Critical guardrail:** E3b does NOT reward word count. A 15-word clause that surfaces 3 cascading concerns passes. A 200-word paragraph that belabors a single tradeoff fails. The unit of measurement is "distinct engineering concerns surfaced," not characters or sentences.
