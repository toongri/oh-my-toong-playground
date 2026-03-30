# Pre-Evaluation Research

Before starting the evaluation, perform these preparation steps. The research results inform ALL paragraph type selections (A, B, C, D) — not just the company connection.

## Step 1. Check other branches for context

Run `git branch -a` and inspect `_config.yml` on other branches to understand existing self-introduction and company connection patterns. This reveals the candidate's writing style and prior customizations.

## Step 2. JD Analysis

If a JD (Job Description) is provided, analyze it before evaluation:

1. **Team identification**: Which team is hiring? (결제팀, 전시팀, CRM팀, 플랫폼팀, etc.) The team determines which candidate traits are most relevant.
2. **Keyword extraction**: Extract key technical skills, domain terms, and soft-skill signals. Categorize into:
   - Technical requirements (Languages, Frameworks, Infrastructure)
   - Domain context (결제, 추천, 물류, 데이터, etc.)
   - Working culture signals (자율, 협업, 프로덕트 엔지니어, 오너십, etc.)
3. **Implicit problems**: What business problems does the JD hint at? "대규모 트래픽 처리" implies scaling challenges. "레거시 개선" implies tech debt. "신규 서비스" implies zero-to-one building.
4. **What is NOT in the JD**: Absence is also a signal. No mention of testing culture? No mention of data-driven decisions? These gaps help avoid misaligned self-introduction topics.

## Step 3. Company Research

When targeting a specific company, research through these channels using WebSearch and WebFetch:

**3-1. Company core values / engineering principles**

- Search: `{company name} 핵심가치` or `{company name} core values` or `{company name} engineering principles`
- Look for: official career pages, culture decks, CEO/CTO interviews
- Example findings: "Focus on Impact" (토스), "자율과 책임" (당근), "좋은 제품이 최고의 세일즈" (채널톡)
- **Why this matters**: The candidate's Type A identity and Type B stance should resonate with — not contradict — the company's stated values

**3-2. Tech blog**

- Search: `{company name} tech blog` or `{company name} 기술 블로그`
- Look for: engineering challenges the team writes about, architecture decisions, team culture posts
- **Why this matters**: Blog posts reveal ACTUAL technical challenges (not just JD keywords) and the team's engineering maturity level

**3-3. Product / Service**

- Search: `{company name}` and visit the actual product/service
- Look for: what the company builds, who the users are, what problems it solves
- **Why this matters**: Type C connection must reference specific product/domain, not generic company praise. Without understanding the product, connection paragraphs feel hollow.

**3-4. Career page / Team introduction**

- Search: `{company name} 채용` or `{company name} careers`
- Look for: how the team describes itself, what traits they emphasize, team structure
- **Why this matters**: Team self-descriptions often reveal what they value most in candidates — "프로덕트 엔지니어", "풀스택", "자기 주도적" etc.

**3-5. Recent news / funding / growth signals**

- Search: `{company name} 시리즈` or `{company name} funding` or `{company name} MAU`
- Look for: growth stage, recent milestones, market position
- **Why this matters**: A Series A startup values differently from a mature company. Growth signals inform what the company needs NOW.
- **Scale estimation**: 투자 라운드와 성장 지표로 회사의 엔지니어링 규모를 추정할 수 있다. 이 추정은 3-6의 규모 지표와 결합하여 타겟 회사의 기술적 스케일을 파악한다.

**3-6. Scale & volume indicators (규모 지표)**

- Search: `{company name} TPS` or `{company name} DAU` or `{company name} 트래픽` or `{company name} tech blog architecture`
- Look for: transaction volume (TPS/RPM), daily active users (DAU/MAU), data scale (TB/PB), engineering team size, infrastructure scale (서버 수, 클러스터 규모)
- Example findings: "일 100만 결제 처리" (토스), "MAU 1800만" (당근), "일 주문 300만건" (쿠팡)
- **Why this matters**: 후보의 경험 규모와 타겟 회사의 운영 규모 사이의 갭을 측정해야 한다. 이 갭이 클수록, 후보는 이력서에서 "규모가 커질 때의 판단"을 보여줘야 신뢰를 쌓을 수 있다. 이 데이터는 resume-claim-examiner의 E6 (Target-Scale Transferability) 평가에 직접 사용된다.
- **Fallback**: 구체적 규모 지표를 찾을 수 없으면 회사의 성장 단계(시리즈 A/B/C, 상장 여부)와 서비스 카테고리로 추정 — "MAU 정확한 수치 미확인, 시리즈 C + 결제 도메인 → 최소 일 10만건 이상 트랜잭션 추정"

## How research feeds into each Type

| Type | Research feeds... |
| --- | --- |
| A (Identity) | Which identity to highlight — aligned with JD keywords and company values |
| B (Working Style) | Which working style to emphasize — aligned with team culture signals |
| C (Company Connection) | Company-specific domain/product/values for connection paragraph |
| D (Current Interest) | Which interest to surface — aligned with JD tech stack and company direction |
| **All Evaluations** | **Scale context — resume-claim-examiner E6 (Target-Scale Transferability) 평가의 기준선. 후보의 경험 규모 vs 타겟 회사 규모 갭을 Phase 11 evaluator dispatch 시 전달** |

If targeting a specific company and no meaningful research results are found, note this limitation. A strong A + B self-introduction without company-specific context is always better than forced connections based on guesswork.