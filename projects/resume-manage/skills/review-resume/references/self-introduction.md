# Self-Introduction Evaluation Reference

## Table of Contents

1. [Overview](#overview)
2. [Paragraph Types](#paragraph-types)
   - [Type A — Professional Identity](#type-a--professional-identity-정체성)
   - [Type B — Engineering Stance](#type-b--engineering-stance-일하는-방식)
   - [Type C — Company Connection](#type-c--company-connection-회사-연결)
   - [Type D — Current Interest](#type-d--current-interest-지금의-관심)
3. [Composition Guide](#composition-guide)
4. [Global Evaluation](#global-evaluation)
5. [Evaluation Output Format](#evaluation-output-format)
6. [Type C Conditional Evaluation](#type-c-conditional-evaluation)
7. [Anti-Patterns](#anti-patterns)
8. [Writing Guidance Trigger](#writing-guidance-trigger)
9. [Post-Evaluation Action](#post-evaluation-action)
10. [Writing Validation Checklist](#writing-validation-checklist)

---

## Mandatory Evaluation Checklist

아래 항목은 자기소개 평가 시 반드시 체크하고, 결과를 Phase 11 출력에 포함해야 한다.

### Type A (행동 원칙)
- [ ] Bridge 3박자 구조: bold 오프너 → 이유(브릿지) → 에피소드. 셋 중 하나라도 빠지면 FLAG
- [ ] 차별화 실패 점검: 오프너가 "개발자 10명이 써도 어색하지 않은" 범용 문장이면 FLAG
- [ ] 자기 주장형 종결 점검: "~편입니다", "~타입입니다", "~사람입니다" 종결이면 FLAG → 행동 기반 오프너+bridge+episode로 전환 권장

### Type B (일하는 방식)
- [ ] 구체적 행동 원칙이 에피소드로 뒷받침되는지 확인

### Type C (회사 연결)
- [ ] 마무리 동사 점검: "~하고 싶다"(소망) → FLAG. "~에 기여할 수 있다"(기여 비전)으로 전환 권장
- [ ] 회사 연결이 역량/경험 기반인지, 추상적 비전인지 구분

### Type D (현재 관심)
- [ ] 구체적 관심사가 근거와 함께 제시되는지 확인
- [ ] 수치 없어도 FAIL 아님 (Type D 특성)

### Global
- [ ] 문단별 독립성: 각 문단이 독립적으로 읽혔을 때 가치가 있는가?
- [ ] 첫 문장 독립 가치: 첫 문장만 읽어도 인상이 남는가?
- [ ] 원본 프레이밍: 경력 bullet과 동일한 표현을 피하고 있는가?
- [ ] 문단 수 적정성: 3-4개 권장 (2개 이하 → 부족, 5개 이상 → 산만)

---

## Overview

The self-introduction answers one question: **"어떤 엔지니어인가?"** Every paragraph must reveal a different facet of this answer.

Unlike career bullets (which prove achievements) or problem-solving entries (which prove thinking), the self-introduction establishes **identity and direction**. Metrics support claims but are not required in every paragraph.

---

## Paragraph Types

A self-introduction consists of 2-4 paragraphs. Each paragraph belongs to one of four types. Identify each paragraph's type, then evaluate it against the type-specific criteria below.

### Type A — Professional Identity (정체성)

**Why**: In a 7.4-second scan, the first thing a hiring manager tries to determine is "what role and level is this person?" The identity paragraph must answer this instantly. Without a clear identity anchor, the self-introduction reads as a generic essay that could belong to anyone.

**What**: Role anchor (what kind of developer) + differentiating trait (what makes you distinctive) + supporting evidence from the resume.

**How**: Open with a single sentence that combines your role with your distinguishing characteristic. Immediately follow with a concrete project or achievement that proves the claim. The evidence is not the point — the identity framing is. The evidence exists to make the identity credible.

**Bridge pattern**: When the bold opener states an action principle, connect it to the episode with a bridge sentence that explains **why** you work this way. Structure: **[행동 원칙]. [이유 — 브릿지]. [에피소드].** This three-beat structure turns a bare claim into a reasoned stance. The bridge can use any natural phrasing ("~때문입니다", "~라고 생각합니다", "~라는 판단에서") — the key is that the reason exists between the principle and the evidence.

**Evaluation criteria:**
- Is there a role anchor visible in the first sentence? (백엔드, 프론트엔드, 데이터 등)
- Is the identity claim backed by at least one project or achievement from the resume?
- Is the trait differentiating? (Would this sentence still work if another engineer wrote it?)

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|---------|---------|--------|
| PASS | "**비즈니스 임팩트로 증명하는 백엔드 개발자입니다.** 상품 검수 병목을 숙련도 의존성으로 재정의하고, LLM 기반 자동화로 월 1,500만원 운영비를 절감했습니다." | JD '비즈니스 성과', '임팩트 중심' 강조 → 기술력보다 비즈니스 임팩트를 정체성으로 내세움. 역할 앵커("백엔드") + 차별화("임팩트로 증명") + 증거(병목 재정의 → 1,500만원) |
| PASS | "**당연해 보이는 원인일수록 다시 확인합니다.** 같은 비용이라도 어떤 문제를 해결하느냐에 따라 만들 수 있는 임팩트가 달라지기 때문입니다. 상품 검수 인력이 부족하다는 판단에 인력충원을 준비하던 중 현장 라인을 방문해 병목을 확인하고, 검수 자동화를 통해 1인당 처리량을 5배로 끌어올리고 월 1,500만원 운영비를 절감했습니다." | JD '자기 주도적', '문제 해결' 강조 → 행동 원칙("다시 확인") + 브릿지("때문입니다") + 에피소드(현장 병목 → 5배 → 1,500만원). 성격 주장이 아닌 행동으로 정체성 표현 |
| PASS | "**완벽한 시스템보다 문제를 빠르게 감지하고 복구할 수 있는 시스템을 만듭니다.** 모든 장애를 막으려면 비용이 기하급수적으로 늘어나지만, 감지와 복구 속도를 높이는 것은 설계로 해결할 수 있다고 생각합니다. 배포 후 이상 징후를 사람이 모니터링하던 구조를 자동 헬스체크와 자동 롤백으로 바꿔, 배포 실패 대응 시간을 30분에서 3분으로 줄였습니다." | JD '안정성', '장애 대응', 'SRE' 강조 → 예방보다 감지/복구 속도를 설계 철학으로 제시. 정체성("감지/복구 시스템") + 철학("예방 비용 vs 복구 설계") + 증거(30분→3분) |
| PASS | "**가설을 세우고 사용자 행동으로 검증하며 일하는 백엔드 개발자입니다.** 신규 가입자의 상품 탐색률이 낮았을 때, 리스트 조회 속도를 개선하면 상품 상세 진입률이 오를 것이고, 결국 첫 주문까지의 경험으로 이어질 것이라고 가설을 세웠습니다. p99을 10초에서 500ms로 줄인 결과, 상세 진입률이 10%에서 22%로 오르며 가설이 맞았음을 확인했습니다." | JD '데이터 기반', '사용자 중심', '프로덕트' 강조 → 기술 지표가 아닌 사용자 행동 변화로 검증하는 정체성 선택. 가설 기반("탐색률 → 진입률 → 첫 주문") + 증거(p99 10s→500ms, 진입률 10%→22%) |
| FAIL | "저는 항상 새로운 기술을 배우며 성장하는 개발자입니다. 다양한 프로젝트 경험을 통해 역량을 키워왔습니다." | 역할 앵커 없음(무슨 개발자?), 차별화 없음("성장하는 개발자"는 모든 개발자), 증거 없음 |
| FAIL | "3년차 백엔드 개발자 홍길동입니다. 주요 기술 스택은 Java, Spring Boot, MySQL입니다." | 역할 앵커는 있으나 차별화 없음 — 기술 스택 나열은 정체성이 아님 |

---

### Type B — Engineering Stance (일하는 방식)

**Why**: Technical skills alone don't distinguish mid-level+ engineers. How someone approaches work — their engineering philosophy, collaboration style, problem-solving temperament — is what hiring managers remember after the 40-second scan. This paragraph answers "what would it be like to work with this person?"

**What**: A working philosophy or approach + a concrete episode that demonstrates it. The episode is not a full project description — it's a snapshot that makes the philosophy tangible.

**How**: State your stance in one sentence, then immediately show it in action with a specific situation. Keep the episode brief — the self-introduction is not the place for a full problem-solving narrative.

**Evaluation criteria:**
- Is the philosophy grounded in an actual project/situation, not abstract values?
- Would a hiring manager learn something about your working style from this paragraph?

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|---------|---------|--------|
| PASS | "**팀원의 문제에 귀 기울이고, 제가 풀 수 있는 부분을 찾아 해결합니다.** 공정 조건 변경이 매번 배포를 기다려야 했던 현장 팀원들의 병목을 파악하고, Rule Engine 기반 PoC를 배포해 리드타임을 2주에서 즉시로 단축했습니다." | JD '협업', '크로스펑셔널', '팀 문화' 강조 → 개인 성과보다 팀 임팩트를 일하는 방식으로 제시. 철학("팀원의 문제 → 내가 풀 수 있는 부분") + 사례(Rule Engine → 2주→즉시) |
| PASS | "**코드를 작성하기 전에 문제의 경계를 먼저 정의합니다.** 결제-주문 상태 불일치를 단순 버그가 아닌 시스템 간 동기화 문제로 재정의한 후, 보상 트랜잭션 스케줄러를 설계하여 불일치를 0건으로 만들었습니다." | JD '설계', '아키텍처', '시스템 사고' 강조 → 코딩 전 문제 정의를 우선하는 접근. 철학("문제 경계 먼저") + 에피소드(결제-주문 불일치 재정의 → 0건) |
| PASS | "**의사결정은 수치로 근거를 남겨야 한다고 생각합니다.** 감에 의존하면 성과를 객관적으로 평가하기 어렵고, 팀원들과 판단 근거를 공유할 수 없기 때문입니다. 트래픽 분석 결과 90% 이상이 상위 5페이지에 집중된다는 데이터를 근거로, 전체가 아닌 상위 5페이지만 캐싱하는 전략을 팀에 제안해 메모리 비용을 절감하면서 체감 성능을 확보했습니다." | JD '데이터 기반 의사결정', '정량적 판단' 강조 → 감 아닌 수치 근거로 팀과 판단을 공유하는 방식. 철학("수치로 근거") + 이유("평가 불가 + 공유 불가") + 사례(90% → 상위 5페이지 캐싱) |
| PASS | "**문제와 요구사항을 함께 정의하며 일합니다.** 프로덕트 엔지니어로서 기술적 컨텍스트를 기반으로 ROI를 함께 고민하여, 커뮤니케이션 비용을 줄이고 요구사항을 명확하게 만듭니다. 전체 주문 이력 실시간 조회 요구사항을 받았을 때, 실제 데이터를 분석하니 고객의 98%가 최근 3개월 이내 주문만 조회하고 있었습니다. '3개월 이내는 p95 200ms, 이전은 p95 3s'로 SLA를 제안해 개발 기간을 3주에서 1주로 줄이면서 사용자 체감을 유지했습니다." | JD '프로덕트 엔지니어', 'PM 협업', '자율성' 강조 → 시킨 것만 구현하지 않고 ROI 기반으로 요구사항을 함께 정의. 철학("요구사항 함께 정의") + 사례(98% 데이터 → SLA 분리 → 3주→1주) |
| FAIL | "클린 코드를 지향하며 테스트 주도 개발을 실천합니다. 코드 리뷰를 통해 팀의 코드 품질을 높이는 데 기여합니다." | 추상적 가치 나열("클린 코드", "TDD", "코드 리뷰"), 구체 사례 없음 — 아무나 쓸 수 있는 문장 |
| FAIL | "효율적인 커뮤니케이션을 중시하며, 항상 문서화를 통해 지식을 공유합니다." | "효율적인 커뮤니케이션"은 모든 직장인의 기본 — 차별화 없음, 사례 없음 |

---

### Type C — Company Connection (회사 연결)

**Why**: In Korean tech hiring, a generic self-introduction that could be sent to any company is the most common rejection signal. When targeting a specific company, the connection paragraph is the signal that this candidate did their homework. It answers "why HERE, and what can you GIVE?"

**What**: Your experience/capability → the company's specific domain/product/challenge → your contribution vision. The paragraph starts from YOU (not the company), connects to THEM (specifically), and ends with what you will BUILD.

**How**: Lead with a concrete capability or experience claim. Back it with specific evidence (metrics, project outcomes). Close with a contribution vision that connects your capability to the target company's domain, values, or philosophy. The subject is always "I" — never "your company is impressive."

**When to include**: Only when targeting a specific company. In a general-purpose resume, this paragraph is absent — that is normal, not a gap.

**Evaluation criteria:**
- Does the paragraph connect to the company's **specific** product/technology/domain? (Would swapping in another company name break the paragraph?)
- Does it frame as "what I can give" rather than "what I want to get"?
- Is the subject "I" throughout, not "귀사는..."?

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|---------|---------|--------|
| PASS | "데이터 불일치가 곧 비즈니스 손실인 환경에서, 정합성을 구조로 보장해 왔습니다. 선착순 쿠폰의 race condition을 원자적으로 처리하여 초과 발급 0건을 달성하고, 결제-주문 상태 동기화로 불일치를 0건으로 만든 경험이 있습니다. **토스증권의 주식 매매와 결제 영역에서**, 한 건의 오차도 없는 금융 트랜잭션의 신뢰성을 만들고 싶습니다." | JD '데이터 정합성', '결제 시스템' 키워드 → 정합성 경험(race condition 0건 + 불일치 0건) → 토스증권 금융 트랜잭션 신뢰성 기여 |
| PASS | "**불안정한 외부 시스템과의 연동에서 장애가 전파되지 않는 복원력 아키텍처를 설계해 왔습니다.** 비동기 메시지큐와 Circuit Breaker로 외부 POS 서버 장애를 격리해, 피크타임에도 주문 승낙 API p95 200ms 이내를 유지하고 결제-주문 상태 불일치를 주 5건에서 0건으로 줄였습니다. '좋은 제품이 최고의 세일즈'라는 철학에 공감하며, {회사명}의 사용자가 장애를 체감하지 않는 안정적인 제품 경험을 만들고 싶습니다." | JD '결제 안정성', '장애 대응' 키워드 + 회사 제품 철학 '좋은 제품 = 최고의 세일즈' 연결 → 복원력 경험(p95 + 정합성) → 안정적 제품 경험 기여 |
| PASS | "**사용자가 검색하지 않아도 취향에 맞는 상품을 만나는 탐색형 쇼핑 경험을 설계한 경험이 있습니다.** 구매 이력과 탐색 패턴을 결합한 개인화 추천 엔진을 구축해 홈 피드 클릭률을 8%에서 15%로 끌어올리고, 추천 경유 구매 비중을 전체의 25%까지 높였습니다. {회사명}이 지향하는 발견형 쇼핑 경험에서, 사용자가 의도하지 않았던 상품과의 만남을 더 정확하고 자연스럽게 만드는 데 기여하고 싶습니다." | JD '전시팀', '추천' 키워드 + 회사 비전 '발견형 쇼핑(Discovery Commerce)' 연결 → 개인화 추천 경험(CTR 8%→15%, 추천 구매 25%) → 발견형 쇼핑 고도화 기여 |
| PASS | "**고객 행동 신호를 실시간으로 분류하고 자동 캠페인으로 연결하는 파이프라인을 구축한 경험이 있습니다.** 주문·방문·이탈 신호 기반으로 고객을 12개 세그먼트로 자동 분류하고, 세그먼트별 맞춤 캠페인을 트리거해 재구매율을 18%에서 27%로 끌어올렸습니다. 월 300만 MAU가 만들어내는 {회사명}의 행동 데이터에서, 세그먼트별 리텐션 전략과 고객 생애 가치 극대화에 이 경험을 적용하고 싶습니다." | JD 'CRM', '고객 데이터' 키워드 + MAU 규모 맥락 → 세그멘테이션/캠페인 자동화 경험(재구매율 18%→27%) → 리텐션/LTV 기여 |
| PASS | "**수작업 운영 프로세스를 자동화하고 이상 감지 시스템을 구축한 경험이 있습니다.** 정산 담당자가 매월 3일씩 처리하던 정산 검증을 자동화하고, 이상 거래 실시간 감지 대시보드를 구축해 정산 오류를 월 15건에서 0건으로 줄였습니다. 'Focus on Impact'의 가치에 깊게 공감하며, 운영 팀이 반복 업무에서 벗어나 임팩트 있는 의사결정에 집중할 수 있는 환경을 만들고 싶습니다." | JD '백오피스', '운영 효율화' 키워드 + 회사 핵심가치 'Focus on Impact' 연결 → 자동화/대시보드 경험(정산 오류 15→0건) → 운영팀 임팩트 집중 환경 기여 |
| FAIL | "귀사의 혁신적인 문화에 감탄했으며, 성장할 수 있는 환경에서 배우고 싶습니다." | 어느 회사에나 통하는 범용 + "내가 원하는 것" 프레이밍 + 주어가 "귀사" |
| FAIL | "토스에서 일하고 싶습니다. 토스의 개발 문화가 인상적이었고, 좋은 동료들과 함께 성장하고 싶습니다." | 회사 이름은 있지만 구체적 도메인/제품 연결 없음 + "성장하고 싶다" = 내가 원하는 것 |

**Closing verb guidance**: Type C의 마지막 문장은 "이 회사의 비즈니스에 내가 어떤 기여를 할 수 있는지"를 보여주는 자리. 소망이 아닌 기여 비전이어야 한다.
- "만들겠습니다" (commitment) — 강함: 확신과 주도성
- "기여할 수 있습니다" (capability) — 강함: 검증된 역량
- "하고 싶습니다" (desire) — 약함: 소망에 그치면 기여가 아니라 바람

핵심: 주어가 "나"이고, 동사가 회사의 비즈니스 도메인에 연결된 기여 행위여야 한다.

---

### Type D — Current Interest (지금의 관심)

**Why**: Past achievements show what you've done, but not where you're headed. What you're currently exploring signals growth trajectory, technical curiosity, and engineering taste. Hiring managers — especially at companies that value autonomy — read this as "will this person keep growing after they join?"

**What**: A current technical exploration + why you started it + your specific approach or direction. Results are NOT required — direction and specificity are. This is not a hobby section — the interest must be work-adjacent.

**How**: Start with what you're exploring and why. Show enough specificity that an interviewer could ask follow-up questions about your approach. End with a direction, not "시도 중에 있습니다."

**Evaluation criteria:**
- Is the interest work-adjacent? (Non-work hobbies belong in interviews, not resumes)
- Is there a specific approach or direction? ("AI에 관심 있습니다" alone is too vague)
- Could an interviewer ask a meaningful technical follow-up about this?

**PASS / FAIL Examples:**

| Verdict | Example | Reason |
|---------|---------|--------|
| PASS | "최근에는 AI 에이전트를 활용한 코드 리뷰 자동화를 설계하고 있습니다. 리뷰 시간을 줄이면 전체 개발 사이클이 빨라진다고 판단했고, 여러 모델에게 청크 단위로 리뷰를 맡긴 뒤 오케스트레이터가 합의를 도출하는 구조로 커버리지와 신뢰도를 높이고 있습니다." | JD 'AI', '개발 생산성', '자동화' 키워드 → AI 에이전트 관심사가 JD와 직접 연결. 관심사(AI 코드 리뷰) + 왜(리뷰 시간→개발 사이클) + 구체적 접근(청크 리뷰 + 오케스트레이터) |
| PASS | "오픈소스 컨트리뷰션을 통해 분산 시스템의 실전 패턴을 학습하고 있습니다. 최근 Apache Kafka의 consumer rebalance 로직에 패치를 제출했고, 이 과정에서 파티션 할당 전략의 trade-off를 체감했습니다." | JD '분산 시스템', 'Kafka', '대규모 트래픽' → 오픈소스 컨트리뷰션이 JD 기술스택과 직결. 활동(Kafka 패치) + 방향(분산 시스템 실전 패턴) + 면접 질문 가능한 깊이 |
| PASS | "**배운 것을 글로 정리해야 진짜 내 것이 된다고 생각합니다.** 최근 POS 연동에서 Circuit Breaker 설정값을 튜닝한 경험을 기술 블로그에 정리했습니다. failure rate 임계값을 어떻게 정했는지를 중심으로 썼는데, 같은 고민을 하는 개발자들의 피드백을 받으며 제 이해도 더 깊어졌습니다." | JD '장애 대응', '복원력' + 회사 '기술 공유 문화' → 실무 경험 블로그가 JD 기술 요구와 팀 문화 모두 연결. 철학("글로 정리 = 내 것") + 사례(CB 설정값 블로그) + 결과(피드백 → 이해 심화) |
| PASS | "**반복되는 운영 작업을 자동화하는 데 관심이 많습니다.** 최근 배포 후 헬스체크 → 로그 확인 → 롤백 판단까지의 수동 프로세스를 스크립트로 묶어, 배포 실패 시 3분 내 자동 롤백되는 파이프라인을 구성했습니다." | JD 'DevOps', '운영 효율', 'CI/CD' → 배포 자동화 관심사가 JD 운영 역량과 연결. 관심사(운영 자동화) + 접근(수동 프로세스 → 스크립트 → 3분 자동 롤백) + 면접 질문("어떤 기준으로 롤백?") |
| FAIL | "새로운 기술에 관심이 많으며, 최근 AI와 클라우드 분야를 공부하고 있습니다." | "AI와 클라우드"는 너무 넓음, 구체적 접근 없음 — 면접관이 물어볼 게 없음 |
| FAIL | "주말마다 알고리즘 문제를 풀며 실력을 키우고 있습니다." | 코딩 테스트 준비는 일적 관심사가 아닌 취업 준비 — 엔지니어링 방향을 보여주지 않음 |

---

## Composition Guide

There is no mandatory combination. Choose 2-4 paragraphs that best answer "어떤 엔지니어인가?" for your situation:

| Situation | Recommended Composition | Paragraphs |
|-----------|------------------------|------------|
| General-purpose resume (no target) | A + B | 2 |
| General-purpose + showing direction | A + B + D | 3 |
| Targeting a specific company | A + B + C | 3 |
| Targeting + showing direction | A + B + D + C | 4 |

**Rules:**
- **A is always first** — the identity paragraph is what the 7.4-second scan hits
- **C appears only when targeting** — its absence in a general resume is normal, not a gap
- **Two paragraphs of the same type are allowed** if they show genuinely different facets (e.g., two B paragraphs — one about individual problem-solving, one about team collaboration)
- Paragraphs can blend types (e.g., A+B in one paragraph) — the type system is a guide, not a constraint

---

## Global Evaluation

After evaluating each paragraph against its type, check these cross-cutting criteria:

| Criterion | Question | PASS | FAIL |
|-----------|----------|------|------|
| Paragraph count | 2-4개인가? | 2-4 paragraphs | 1 (too thin) or 5+ (unfocused) |
| Independence | 각 문단이 "어떤 엔지니어인가"의 다른 면을 보여주는가? | Each paragraph reveals new information | Two paragraphs say the same thing differently |
| First sentence | 첫 문장만 읽어도 이 사람이 어떤 엔지니어인지 감이 오는가? | "비즈니스 임팩트로 증명하는 백엔드 개발자" — standalone value | "안녕하세요. 3년차 개발자 홍길동입니다" — zero signal |
| Original framing | 자기소개만의 프레이밍이 있는가, 경력 bullet을 문장화한 것인가? | "검수 병목을 숙련도 의존성으로 재정의" — this framing exists only in the intro | "LLM 기반 시스템 개발로 월 1,500만원 절감" — identical to career bullet |

---

## Evaluation Output Format

```
[Self-Introduction Evaluation]

Per-paragraph:
- P1 [Type A/B/C/D]: PASS / FAIL (reason against type-specific criteria)
- P2 [Type A/B/C/D]: PASS / FAIL (reason)
- P3 [Type A/B/C/D]: PASS / FAIL (reason)

Global:
- Paragraph count: PASS / FAIL (N paragraphs)
- Independence: PASS / FAIL (reason)
- First sentence: PASS / FAIL (reason)
- Original framing: PASS / FAIL (reason)
```

---

## Type C Conditional Evaluation

When the target position is obtained **after** the initial self-introduction evaluation:

- **Trigger**: No Type C paragraph exists, but the user has now provided target company/position
- **Action**: Note that a Type C paragraph is recommended for this target. Provide connection guidance using the examples above.
- **Not a FAIL**: Absence of Type C in a general resume is normal. It becomes a recommendation only when a target is specified.

---

## Anti-Patterns

| Thought | Reality |
|---------|---------|
| "Listing good traits should be impressive" | Unsupported trait claims ("집요한 문제 해결자", "열정적인 개발자") are indistinguishable from AI boilerplate. Every identity claim needs a project reference — this is the Type A evaluation criterion. |
| "Praising the company shows enthusiasm" | Generic company praise ("귀사의 혁신적인 문화에 감탄") is the most common rejection signal in Korean hiring. Type C requires specific product/domain connection, not praise. |
| "Self-introduction can be casual, it's just an intro" | The self-introduction is the first section read in the 7.4-second scan. It determines whether the rest gets read. |
| "Saying I want to grow shows passion" | "What I want" has zero value from the company's perspective. Type C requires "what I can give" framing. |
| "One self-introduction works for all companies" | Without Type C, only identity (A), stance (B), and interest (D) are evaluable. Per-company customization lives in Type C. |
| "JD 키워드를 따옴표로 인용하면 열정을 보여줄 수 있다" | JD 문구를 그대로 되돌리면 아부 또는 앵무새로 읽힌다. 자기소개의 주어는 항상 "나"여야 하며, 회사 도메인은 참조하되 반드시 나의 언어로 표현할 것. |
| "Recent interests without results are filler" | Type D does not require metrics. A specific direction and approach are sufficient — this shows growth trajectory, not past achievement. |
| "차별화 실패 오프너: 오프너가 범용 문장이면 충분하다" | 기준: "이 문장을 다른 개발자 10명이 자기소개에 써도 어색하지 않은가?" → Yes면 FLAG. "문제에 집중합니다", "꼼꼼합니다", "항상 사용자 관점에서 생각합니다"는 범용 문장. 대비 구조("해결보다 문제 선정에 더 집요한") 또는 특정 행동("당연해 보이는 원인일수록 다시 확인합니다")으로 전환할 것. |
| "자기 주장형 종결: '~편입니다'는 겸손한 표현이다" | "~편입니다", "~타입입니다", "~사람입니다" 종결은 3가지 구조적 문제를 가진다: (1) 헤징 — 자기도 확신 없는 주장, (2) bridge+episode가 붙기 어려운 구조, (3) 면접관 후속 질문 유도력 제로. "저는 집요한 편입니다", "꼼꼼한 타입입니다" 대신 행동 기반 오프너로 전환 후 bridge+episode를 연결할 것. |

---

## Writing Guidance Trigger

After evaluating all paragraphs, check this condition:

- **Condition**: More than half of paragraphs FAIL their type-specific evaluation
- **Message**: "자기소개의 N개 문단 중 X개가 유형별 평가에서 FAIL입니다. 위의 문단 유형별 가이드(Type A-D)와 PASS/FAIL 예시를 참고하여 재구성해 보세요."

This trigger is not optional. If the condition is met, deliver the guidance message before proceeding to the section-specific evaluation.

---

## Post-Evaluation Action

After completing the self-introduction evaluation, do not simply list problems — always present concrete options for the user to choose from. The user should never be left with "여기가 문제입니다" without "이렇게 해결할 수 있습니다."

**Pattern:**
1. State the finding clearly (which paragraph, which criterion, why it fails)
2. Explain **why** this matters (what a hiring manager would think)
3. Present 2-3 actionable options with trade-offs

**Example — Type C absent when targeting a company:**

> 위펀의 구체적 제품/서비스를 모르는 상태에서 진정성 있는 회사 연결 문단을 작성하는 건 불가능합니다. JD 문구를 앵무새처럼 되돌려주는 문단은 없는 것보다 나쁩니다.
>
> 선택지:
> 1. **위펀 제품을 조사한 뒤 진짜 연결점을 찾아 작성** — 위펀 서비스를 직접 써보거나, 기술 블로그가 있다면 참고. 조사를 원하면 제가 회사 정보를 검색해 드릴 수 있습니다.
> 2. **Type C 없이 제출** — 현재 자기소개(Type A + B PASS)만으로도 충분히 강합니다.

**Example — Type D fails due to vague direction:**

> P3의 "AI 에이전트를 활용한 개발 생산성 개선"은 방향은 있지만 구체적 접근이 약합니다.
>
> 선택지:
> 1. **구체적 접근 추가** — "청크 단위 리뷰 + 오케스트레이터 합의 도출"처럼 현재 시도하고 있는 구조를 명시
> 2. **이 문단 제거하고 A + B 2문단 구성** — 간결해지며, 면접에서 구두로 관심사를 언급하는 전략
> 3. **초기 결과 추가** — 아직 없다면, 측정 가능한 결과가 나온 후 추가

This pattern applies to ALL evaluation findings, not just self-introduction. It is a behavioral rule for the evaluator.

---

## Writing Validation Checklist

Before writing or suggesting ANY self-introduction content, verify ALL three checks. If any check fails, rewrite before presenting to the user. This is not optional — skipping this checklist produces logically broken paragraphs.

### Check 1 — Capability-Evidence-Contribution Chain

Can you articulate the cause-effect chain in one sentence? If the chain has a "???" gap, the pairing is forced and must be rewritten.

| | Chain | Verdict |
|---|-------|---------|
| GOOD | "Automated repetitive ops → team freed from toil → focus on impactful decisions → 'Focus on Impact'" | Clear causal link at every step |
| BAD | "Resilience architecture → ??? → 'Focus on Impact'" | No causal link — fault isolation and impact focus are unrelated concepts |
| GOOD | "Fault isolation → users don't experience outages → stable product experience → 'Great product = best sales'" | Clear causal link |
| BAD | "Fault isolation → ??? → 'Focus on Impact'" | Fault isolation and impact focus are different topics |

### Check 2 — JD Scope Alignment

Does the contribution vision describe work that the JD **explicitly states** as part of the role? Writing about work not mentioned in the JD signals "this person didn't read the JD."

| | JD Role | Contribution Vision | Verdict |
|---|---------|---------------------|---------|
| GOOD | "Build and operate data pipelines" | "Design pipeline reliability" | Matches JD-stated responsibility |
| BAD | Backend API development JD | "Build AI infrastructure" | JD never mentions AI infrastructure — role mismatch |
| GOOD | "Design AI agent APIs and integrate with systems" | "Build reliable AI agent delivery" | Matches JD-stated responsibility |
| BAD | "Develop and operate web crawlers" | "Guarantee LLM reliability" | JD is about crawlers, not LLM reliability — different role |

### Check 3 — Candidate-First, Not Company-Guess

Does the paragraph start from the candidate's actual capability? Or does it start from a guess about what the company needs?

| | Starting Point | Verdict |
|---|----------------|---------|
| GOOD | "I achieved 90% accuracy in an LLM pipeline" → "I want to apply this to CODIT's data pipeline" | Starts from candidate capability → connects to JD role |
| BAD | "CODIT needs accurate answers" → "I will guarantee LLM reliability" | Starts from company-need guess — candidate capability is absent |
| GOOD | "I have designed fault-isolation architectures for unstable external systems" → "I want to build a stable product experience for {company}'s users" | Starts from candidate experience → connects to company domain |
| BAD | "This company is a small elite team" → "I will boost productivity with AI" | Starts from company situation analysis — no candidate capability anchoring the claim |

### Validation Flow

```
1. Write the capability/experience claim
2. Check 3: Does this claim start from the candidate's actual capability?
3. Write evidence (metrics, project outcomes)
4. Check 1: Can the capability → evidence → contribution chain be explained in one sentence?
5. Write the contribution vision
6. Check 2: Is this contribution vision within the JD's stated role scope?
7. All checks pass → present to user
8. Any check fails → fix the failing point and re-validate
```
