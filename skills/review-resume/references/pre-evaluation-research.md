# Pre-Evaluation Research

Before starting the evaluation, perform these preparation steps. The research results inform ALL paragraph type selections (A, B, C, D) — not just the company connection.

## Step 1. Check other branches for context

Run `git branch -a` and inspect `_config.yml` on other branches to understand existing self-introduction and company connection patterns. This reveals the candidate's writing style and prior customizations.

## Step 2. JD Analysis

If a JD (Job Description) is provided, analyze it before evaluation:

1. **Team identification**: Which team is hiring? (payments team, display team, CRM team, platform team, etc.) The team determines which candidate traits are most relevant.
2. **Keyword extraction**: Extract key technical skills, domain terms, and soft-skill signals. Categorize into:
   - Technical requirements (Languages, Frameworks, Infrastructure)
   - Domain context (payments, recommendations, logistics, data, etc.)
   - Working culture signals (autonomy, collaboration, product engineer, ownership, etc.)
3. **Implicit problems**: What business problems does the JD hint at? "Large-scale traffic handling" implies scaling challenges. "Legacy improvement" implies tech debt. "New service" implies zero-to-one building.
4. **What is NOT in the JD**: Absence is also a signal. No mention of testing culture? No mention of data-driven decisions? These gaps help avoid misaligned self-introduction topics.

## Step 3. Company Research

When targeting a specific company, research through these channels using WebSearch and WebFetch:

**3-1. Company core values / engineering principles**

- Search: `{company name} core values` or `{company name} engineering principles`
- Look for: official career pages, culture decks, CEO/CTO interviews
- Example findings: "Focus on Impact" (Toss), "Autonomy and Responsibility" (Daangn), "Great Product Is the Best Sales" (ChannelTalk)
- **Why this matters**: The candidate's Type A identity and Type B stance should resonate with — not contradict — the company's stated values

**3-2. Tech blog**

- Search: `{company name} tech blog` or `{company name} engineering blog`
- Look for: engineering challenges the team writes about, architecture decisions, team culture posts
- **Why this matters**: Blog posts reveal ACTUAL technical challenges (not just JD keywords) and the team's engineering maturity level

**3-3. Product / Service**

- Search: `{company name}` and visit the actual product/service
- Look for: what the company builds, who the users are, what problems it solves
- **Why this matters**: Type C connection must reference specific product/domain, not generic company praise. Without understanding the product, connection paragraphs feel hollow.

**3-4. Career page / Team introduction**

- Search: `{company name} careers` or `{company name} job openings`
- Look for: how the team describes itself, what traits they emphasize, team structure
- **Why this matters**: Team self-descriptions often reveal what they value most in candidates — "product engineer", "full-stack", "self-directed" etc.

**3-5. Recent news / funding / growth signals**

- Search: `{company name} Series` or `{company name} funding` or `{company name} MAU`
- Look for: growth stage, recent milestones, market position
- **Why this matters**: A Series A startup values differently from a mature company. Growth signals inform what the company needs NOW.
- **Scale estimation**: Funding round and growth signals can be used to estimate the company's engineering scale. This estimate is combined with scale indicators from 3-6 to understand the technical scale of the target company.

**3-6. Scale & volume indicators**

- Search: `{company name} TPS` or `{company name} DAU` or `{company name} traffic` or `{company name} tech blog architecture`
- Look for: transaction volume (TPS/RPM), daily active users (DAU/MAU), data scale (TB/PB), engineering team size, infrastructure scale (server count, cluster size)
- Example findings: "1 million daily payment transactions" (Toss), "18 million MAU" (Daangn), "3 million daily orders" (Coupang)
- **Why this matters**: The gap between the candidate's experience scale and the target company's operational scale must be measured. The larger this gap, the more the candidate needs to demonstrate "judgment under scale" in their resume to build credibility. This data is directly used in resume-claim-examiner's E6 (Target-Scale Transferability) evaluation.
- **Fallback**: If specific scale indicators cannot be found, estimate using the company's growth stage (Series A/B/C, public listing status) and service category — "Exact MAU figure not found; Series C + payments domain → estimated minimum 100K+ daily transactions"

## How research feeds into each Type

| Type | Research feeds... |
| --- | --- |
| A (Identity) | Which identity to highlight — aligned with JD keywords and company values |
| B (Working Style) | Which working style to emphasize — aligned with team culture signals |
| C (Company Connection) | Company-specific domain/product/values for connection paragraph |
| D (Current Interest) | Which interest to surface — aligned with JD tech stack and company direction |
| **All Evaluations** | **Scale context — baseline for resume-claim-examiner E6 (Target-Scale Transferability) evaluation. The candidate experience scale vs. target company scale gap is passed when dispatching Phase 11 evaluator** |

If targeting a specific company and no meaningful research results are found, note this limitation. A strong A + B self-introduction without company-specific context is always better than forced connections based on guesswork.