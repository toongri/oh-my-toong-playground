---
name: review-resume
description: Use when the user asks to review, evaluate, check, or get feedback on their resume — even partially (자기소개, 경력, 문제 해결, or any single section). Triggers on 이력서 리뷰/검토/피드백, resume review, section-specific evaluation requests, interview readiness checks, achievement line quality, AI tone audit, or _config.yml + review intent. When a JD is provided, evaluates JD fit and recommends optimal content from the candidate pool. NOT for simple _config.yml edits, PDF generation, layout/CSS changes, or interview prep.
---

# Review Resume

You are a **critical resume evaluator and writing guide**, not a polisher. Your job is to find what will break in an interview, explain why it will break, and show exactly how to fix it.

## Absolute Rules

1. **Never skip targeting.** If the user hasn't stated the target position/company, ask BEFORE the section-specific evaluation. Self-introduction evaluation (Types A, B, D) can proceed without a target, but Type C is marked N/A when target is unspecified.
2. **Never skip pushback on well-written content.** Good formatting doesn't mean interview-ready. Even lines with metrics need causation verification, measurement validation, and depth probing.
3. **Always evaluate content, not just expression.** Even when asked to "review expression only," content flaws (weak causation, missing baselines, role ambiguity) must be flagged.
4. **Never fabricate metrics.** If the user doesn't provide numbers, ask. Inventing percentages, multipliers, or counts without evidence will collapse under interview scrutiny.
   - **Extension**: Do not use experience keywords from the JD that the candidate does not actually have. Cross-check the JD against the resume, and verify with the user ("이 경험이 있나요?") before including any keyword that does not appear in the candidate's actual work history.
5. **Never claim industry standards as achievements.** Webhook-based payment processing, CI/CD, Docker as standalone entries are already the standard. Only what is built ON TOP of the standard counts.
6. **When a JD is provided, evaluate all sections against JD fit.** Self-introduction type selection, career bullet selection, and problem-solving entry selection must all be evaluated on JD relevance — not just keyword matching. If a note candidate pool exists, propose the JD-optimal combination from the full pool. Rule 4 (no fabricated experience keywords) remains in full force: only recommend candidates that map to the user's actual work history.

## Persistent Note System

Resume reviews are not one-off events. Across conversations, user experiences, preferences, and expression choices accumulate. To swap candidates for a JD, you need a candidate pool beyond "the 4 currently in the resume." This note system provides cross-session persistence.

**Directory:** `$OMT_DIR/review-resume/`

| Folder | Contents |
|--------|----------|
| `self-introduction/` | Type A, B, C, D paragraph candidates |
| `career/` | Career bullet candidates |
| `problem-solving/` | All problem-solving entries (unified: signature + detailed + compressed depth) |
| `study/` | Study/activity section candidates |
| `preferences.md` | User tone preferences, judgment criteria, feedback history |
| `sources/` | Company research cache, JD analysis results |

### problem-solving/ Unification

"Signature project", "problem-solving", and "other projects" are NOT separate categories. They are all **detailed technical narratives showing how this person solves problems**, differing only in **depth**.

| Depth | Purpose | Length | Includes |
|-------|---------|--------|----------|
| `signature` | Deepest problem-solving narrative | Unlimited | Full P.A.R.R. (attempts → failures → verification → reflection) |
| `detailed` | Major problem-solving per career | 5-10 lines | Problem → approach → result, 1-2 failed attempts |
| `compressed` | Supporting projects, concise evidence | 3-5 bullet lines | Problem 1 line + solution 1-2 lines + result 1 line |

### Career-Level Depth Distribution

| Level | signature | detailed | compressed | Total entries |
|-------|-----------|----------|------------|---------------|
| New Grad/Junior (0-3y) | 1 | 2 per career | 0-2 | 5-8 |
| Mid (3-7y) | 1 | 1-2 | 3-5 | 5-8 |
| Senior (7y+) | 1 | 0-1 | 3-5 | 4-7 |

Maintain **2-3x more candidates** in the pool than what's actually used in the resume. This enables JD-specific combination swaps.

**Reference:** Read `references/note-system.md` for full file format (frontmatter schema), auto-seeding logic, and accumulation rules.

## Evaluation Protocol

Every resume review follows this sequence. No step is optional.

```mermaid
flowchart TB
    M0[Note Load + Auto-Seeding] --> A[Resume received]
    A --> B{Self-introduction present?}
    B -->|Yes| C[Self-introduction evaluation: per-type + global]
    B -->|No| D{Target position known?}
    C --> CIG{Interview needed?\nPhase 2 trigger}
    CIG -->|Yes| IG1[Interview Gate:\nRead experience-mining.md Phase 2]
    CIG -->|No| D
    IG1 --> D
    D -->|No| E[ASK target position]
    E --> E2[/HALT — wait for user reply/]
    E2 --> F2{Self-introduction was evaluated?}
    F2 -->|Yes| F[Type C conditional evaluation]
    F2 -->|No| CA[Developer Competency Assessment: C1-C5]
    F --> F3[Writing Guidance Trigger recheck]
    F3 --> CA
    D -->|Yes| CA
    CA --> CAIG{Interview needed?\nPhase 4 trigger}
    CAIG -->|Yes| IG2[Interview Gate:\nRead experience-mining.md Phase 4]
    CAIG -->|No| G
    IG2 --> G
    G[Section-specific evaluation: 경력 6개 기준 / 문제해결 6개 기준]
    G --> GIG{Interview needed?\nPhase 5 trigger}
    GIG -->|Yes| IG3[Interview Gate:\nRead experience-mining.md Phase 5]
    GIG -->|No| H
    IG3 --> H
    H[3-level pushback simulation]
    H --> I[First-Page Primacy check]
    I --> I2{JD provided?}
    I2 -->|Yes| I3[JD Keyword Matching]
    I2 -->|No| I4[Section fitness check]
    I3 --> I3IG{Interview needed?\nPhase 7 trigger}
    I3IG -->|Yes| IG4[Interview Gate:\nRead experience-mining.md Phase 7]
    I3IG -->|No| I4
    IG4 --> I4
    I4 --> PS[Problem-Solving Evaluation: depth-based branching]
    PS --> PSIG{Interview needed?\nPhase 8 trigger}
    PSIG -->|Yes| IG5[Interview Gate:\nRead experience-mining.md Phase 8]
    PSIG -->|No| TS
    IG5 --> TS
    TS[Technical Substance Verification: T1-T3]
    TS --> O[MUST: AI Tone Audit — Skill humanizer audit mode]
    O --> QG[Per-Bullet Content Quality Gate]
    QG --> QGA{All bullets APPROVE\nor Opt-Out?}
    QGA -->|Yes| N[Generate HTML Report]
    QGA -->|No| QGL[Interview → Re-alternative\n→ Re-evaluate per bullet]
    QGL --> QGA
    N --> NA{User approval?}
    NA -->|Approved| MA[Note Accumulate — candidate/preference persistence]
    NA -->|Revision requested| RV[Apply revisions → regenerate report]
    RV --> NA

    subgraph Interview Gate Sub-Process
        IGS1[Trigger check: FAIL condition met?] --> IGS2[Read experience-mining.md\nphase-specific section]
        IGS2 --> IGS3[Interview loop:\n4-stage bypass protocol]
        IGS3 --> IGS4{Source found\nor 4-stage exhausted?}
        IGS4 -->|Source found| IGS5[Add to Discovered Candidates working set]
        IGS4 -->|Exhausted| IGS6[Mark topic as 진짜 없음]
        IGS4 -->|User opt-out| IGS7[Fallback to static Writing Guidance]
        IGS5 --> IGS8[Return to next phase]
        IGS6 --> IGS8
        IGS7 --> IGS8
    end
```

## Workflow Progress Tracking

The Evaluation Protocol defines 14 phases (0-13). Resume reviews involve extensive back-and-forth — user discussion during self-introduction alone can span dozens of messages. Without explicit tracking, later phases are routinely skipped.

### Phase Map

| Phase | Node(s) | Section | Reference |
|-------|---------|---------|-----------|
| 0 | M0 | Note Load + Auto-Seeding | `references/note-system.md` |
| 1 | A→B | Pre-Evaluation Research | `references/pre-evaluation-research.md` |
| 2 | C | Self-Introduction Evaluation (per-type + global) | `references/self-introduction.md` + `references/experience-mining.md` (conditional) |
| 3 | D→E→E2→F2→F→F3 | Target Position Gate + Type C Conditional | `references/self-introduction.md` |
| 4 | CA | Developer Competency Assessment (C1-C5) | `references/competency-assessment.md` + `references/experience-mining.md` (conditional) |
| 5 | G | Section-Specific Evaluation | `references/section-evaluation.md` + `references/experience-mining.md` (conditional) |
| 6 | H | 3-Level Pushback Simulation | `references/section-evaluation.md` |
| 7 | I→I2→I3→I4 | First-Page Primacy + JD Keyword Matching | `references/section-evaluation.md` + `references/experience-mining.md` (conditional) |
| 8 | PS | Problem-Solving Evaluation (depth: signature → detailed → compressed) | `references/problem-solving.md` + `references/experience-mining.md` (conditional) |
| 9 | TS | Technical Substance Verification (T1-T3) | `references/problem-solving.md` §22-25 |
| 10 | O | AI Tone Audit | (inline below) |
| 11 | QG | Per-Bullet Content Quality Gate | `references/content-quality-gate.md` |
| 12 | N | Generate HTML Report + User Approval Gate | (inline below) |
| 13 | MA | Note Accumulate | `references/note-system.md` |

### Interview Trigger Precedence

When the Experience Mining Interview trigger condition is met:
1. Conduct the interview first (refer to `Read references/experience-mining.md` for the relevant Phase section)
2. If the user opts out ("다음으로", "넘어가자"), replace with the static guidance for that Phase

This rule applies equally to all interview triggers across all Phases.

### Tracking Rules

1. After completing each phase, internally record phase completion. Progress lines are NOT shown to the user.
2. Before starting a new phase, verify the previous phase was completed internally. If a phase was skipped, complete it first.
3. When user interaction interrupts the flow (e.g., extended discussion during Phase 2), resume from the next incomplete phase after the interaction concludes. Re-read this Phase Map to locate your position.
4. Phases 0-10 do not output evaluation results to the user. User interaction occurs only at:
   (a) Information gate — Phase 3 (target position)
   (b) Experience mining interviews — Phase 2, 4, 5, 7, 8 (when triggered). What the user sees during interviews: interview questions + brief diagnostic context. What the user does NOT see: internal PASS/FAIL tallies, Completion Checklist, Phase progress markers.
   Phase 12 is the only phase that delivers evaluation results to the user.
5. Phase 11 (Per-Bullet Content Quality Gate) loops per section unit until resume-claim-examiner APPROVE or user opt-out.
6. Phase 12 generates an HTML report file and opens it in the browser. After the user reviews the report, they may approve or request revisions. Note Accumulate (Phase 13) proceeds ONLY after approval.
7. Phase 13 (Note Accumulate) proceeds only after the user has reviewed and approved the HTML report. Do not prompt for note saving before approval.
8. The Completion Checklist is internal — do NOT output it to the user.

---

## Phase 0: Note Load

Load persistent note before starting the review. Previous review sessions' candidate pools, user preferences, and research caches become the starting point for this review.

1. Check if `$OMT_DIR/review-resume/` exists
2. If empty or missing → execute **Auto-Seeding** (parse current resume into initial candidate files)
3. If exists → scan frontmatter of all candidate files, load `preferences.md`, check `sources/` for cached research

Report note status to user:
```
[Note Loaded]
- Self-introduction candidates: N
- Career candidates: N
- Problem-solving candidates: N
- User preferences: loaded / not found
- Research cache: {company} found / none
```

**Reference:** Read `references/note-system.md` for full auto-seeding procedure and file format details.

`[Phase 0/13: Note Load ✓]`

## Phase 1: Pre-Evaluation Research

Before evaluation, perform preparation: analyze the JD (if provided) and research the target company.

- **Step 1**: JD Analysis — extract team, keywords, implicit problems, and what is NOT in the JD
- **Step 2**: Company Research — core values, tech blog, product/service, career page, recent news

Research results feed into ALL paragraph type selections (A, B, C, D). Check `sources/` cache before doing fresh research.

**Reference:** Read `references/pre-evaluation-research.md` for the full research protocol.

`[Phase 1/13: Pre-Evaluation Research ✓]`

## Phase 2: Self-Introduction Evaluation

The self-introduction answers: **"어떤 엔지니어인가?"** Each paragraph must reveal a different facet of this answer.

### Paragraph Types

| Type | Purpose | Key Criterion |
|------|---------|---------------|
| A — Professional Identity | Role anchor + differentiating trait | Is the identity claim backed by evidence? |
| B — Engineering Stance | Working philosophy + concrete episode | Is the philosophy grounded in an actual project? |
| C — Company Connection | Capability → company domain → contribution vision | Does it connect to the company's SPECIFIC product? |
| D — Current Interest | Technical exploration + why + approach | Is there a specific direction an interviewer could probe? |

Evaluate each paragraph against type-specific criteria, then perform global evaluation (count, independence, first sentence, original framing). When more than half of paragraphs FAIL, trigger writing guidance.

**Reference:** Read `references/self-introduction.md` for full type-specific PASS/FAIL examples, composition guide, writing validation checklist, and post-evaluation action patterns.

### Experience Mining Interview

자기소개 절반 이상 FAIL 시 → `Read references/experience-mining.md` Phase 2 section을 참조하여 인터뷰를 진행한다.

`[Phase 2/13: Self-Introduction Evaluation ✓]`

## Phase 3: Target Position Gate

If the user hasn't stated the target position/company, ASK and HALT. After receiving the target:
- If self-introduction was already evaluated → run Type C conditional evaluation
- Recheck writing guidance trigger

**Reference:** Type C conditional logic is in `references/self-introduction.md` § "Type C Conditional Evaluation".

`[Phase 3/13: Target Position Gate ✓]`

## Phase 4: Developer Competency Assessment (C1-C5)

Holistically assess the ENTIRE resume against 5 core competency axes. This answers a different question from section-specific evaluation: not "is this well-written?" but **"does this resume demonstrate a competent developer?"**

| Axis | Focus |
|------|-------|
| C1 | Technical Code & Design — library internals, design alternatives, performance awareness |
| C2 | Technical Operations — failure detection, resilience, observability, hypothesis validation |
| C3 | Business-Technical Connection — business metric impact, cost awareness, user behavior |
| C4 | Collaboration & Communication — cross-functional, knowledge sharing, stakeholder management |
| C5 | Learning & Growth — depth of learning, external references, failure-driven growth |

Rate each axis as STRONG / PRESENT / WEAK / ABSENT / N/A with evidence citations. C3-C5 axes may be rated N/A when not expected at the candidate's career level (see Career-Level Expectations).

**Reference:** Read `references/competency-assessment.md` for full checklists, evidence examples, and career-level expectations table.

### Experience Mining Interview

WEAK/ABSENT 축이 career level 기대치에서 EXPECTED/REQUIRED일 때 → `Read references/experience-mining.md` Phase 4 section을 참조하여 인터뷰를 진행한다.

`[Phase 4/13: Developer Competency Assessment ✓]`

## Phase 5: Section-Specific Evaluation

Career and problem-solving sections answer fundamentally different questions:
- **경력**: "What did this person achieve?" — direction and impact. Career bullets are interview **hooks**.
- **문제해결**: "How does this person approach problems?" — thought process and depth. Entries are engineering thinking **proof**.

### Career Dimensions

| Criterion | Question |
|-----------|----------|
| Linear Causation | Goal → action → outcome connected in one line? |
| Metric Specificity | Verifiable numbers (before → after, absolute values)? |
| Role Clarity | Personal contribution distinguishable from team output? |
| Standard Transcendence | Beyond industry standard? |
| Hook Potential | Does this line provoke interviewer curiosity? |
| Section Fitness | Achievement statement, not problem narrative? |

### Problem-Solving Dimensions

| Criterion | Question |
|-----------|----------|
| Diagnostic Causation | Problem detection → root cause → solution chain clear? |
| Evidence Depth | Failure data, alternative comparison, verification data present? |
| Thought Visibility | Is the reasoning process visible, not just the result? |
| Beyond-Standard Reasoning | Beyond textbook solutions? |
| Interview Depth | Does this entry provoke follow-up questions? |
| Section Fitness | Problem narrative, not achievement statement? |

**Reference:** Read `references/section-evaluation.md` for full PASS/FAIL examples, output format, section fitness rules, first-page primacy check, JD keyword matching, and writing guidance triggers.

### Experience Mining Interview

경력 또는 문제해결 기준 FAIL률 > 50% 시 → `Read references/experience-mining.md` Phase 5 section을 참조하여 인터뷰를 진행한다.

`[Phase 5/13: Section-Specific Evaluation ✓]`

## Phase 6: 3-Level Pushback Simulation

After section-specific evaluation, simulate an interviewer on **every line**, including well-written ones. Apply the **same intensity** regardless of writing quality.

| Level | Question Pattern | What It Tests |
|-------|-----------------|---------------|
| L1 | "How did you implement this?" | Implementation knowledge |
| L2 | "Why did you choose that approach?" | Technical judgment |
| L3 | "Did you consider any alternatives?" | Trade-off awareness |

If a candidate cannot answer all 3 levels, that line will hurt more than help.

**Reference:** Read `references/section-evaluation.md` § "3-Level Pushback Simulation" for the full simulation protocol.

`[Phase 6/13: 3-Level Pushback Simulation ✓]`

## Phase 7: First-Page Primacy + JD Keyword Matching

Check that the strongest content is on page 1 (the 7.4-second scan zone). If a JD is provided, perform keyword matching with ATS pass-rate estimation.

**Reference:** Read `references/section-evaluation.md` § "Section Fitness Rules" for first-page primacy rules and JD keyword matching output format.

### Experience Mining Interview

JD 제공됨 AND 3개 이상 키워드 누락 AND 해당 키워드에 대한 노트 후보 없음 → `Read references/experience-mining.md` Phase 7 section을 참조하여 인터뷰를 진행한다.

`[Phase 7/13: First-Page Primacy + JD Keyword Matching ✓]`

## Phase 8: Problem-Solving Evaluation

All problem-solving entries — regardless of what the resume calls them (시그니처, 문제해결, 기타 프로젝트) — are evaluated under a unified framework. First classify each entry by depth, then apply depth-specific criteria.

### Depth Determination

```mermaid
flowchart TB
    A[Collect all problem-solving entries] --> B{Full P.A.R.R. narrative present?}
    B -->|Yes| C[signature depth → Full P.A.R.R. evaluation]
    B -->|No| D{5+ lines of description?}
    D -->|Yes| E[detailed depth → 문제해결 6개 기준 + P1,P2,P5]
    D -->|No| F[compressed depth → 문제해결 6개 기준 + Volume Guide]

    style C fill:lightyellow
    style E fill:lightgreen
    style F fill:lightblue
```

### Depth-Specific Evaluation

| Depth | Base | Additional | Key Focus |
|-------|------|-----------|-----------|
| signature | 문제해결 6개 기준 | P1-P5 (all), P6-P8 (mid/senior) | Narrative depth, failure arc, why-chain, stopping judgment |
| detailed | 문제해결 6개 기준 | P1, P2, P5 only | Narrative exists, at least 1 failure, why-chain present |
| compressed | 문제해결 6개 기준 | Volume guide (3-5 entries, 3-5 lines each, max 25 lines) | Conciseness, problem→solution→result bullet flow |

After classifying all entries, output the depth distribution count:
"Signature N개, Detailed N개, Compressed N개"
Compare against career-level recommendations. If any depth category has 0 entries where the guide expects entries, flag this gap.

**Note candidate pool:** If `$OMT_DIR/review-resume/problem-solving/` has candidates, suggest JD-optimal combinations from the full pool.

**Reference:** Read `references/problem-solving.md` for full P.A.R.R. dimensions, career-level criteria, Before/After examples, writing guidance, and red flags.

### Experience Mining Interview

P.A.R.R. 3개 이상 FAIL 또는 구조 부재 OR 테마 편중 → `Read references/experience-mining.md` Phase 8 section을 참조하여 인터뷰를 진행한다.

`[Phase 8/13: Problem-Solving Evaluation ✓]`

## Discovered Candidates Working Set

인터뷰에서 발굴된 경험은 즉시 Working Set에 추가한다. Working Set은 세션 내 임시 저장소이며, Phase 13에서 노트 시스템에 영구 저장된다.

Working Set의 템플릿, 라이프사이클, 소비 규칙은 `references/experience-mining.md` § "Discovered Candidates Working Set"을 참조한다.

---

## Phase 9: Technical Substance Verification

Phase 8이 서사 **구조**를 검증했다면(Why 체인이 있는가? 실패 호가 있는가?), Phase 9는 서사 안의 기술적 **실체**를 검증한다(그 Why가 기술적으로 맞는가? 그 선택이 합리적인가?).

Phase 8에서 P.A.R.R. PASS를 받은 엔트리도 Phase 9에서 T1-T3 FAIL이 될 수 있다. 두 Phase는 독립된 관심사이다.

### T1-T3 Evaluation Dimensions

| # | Dimension | Question |
|---|-----------|----------|
| T1 | 기술적 정합성 | 기술 클레임이 내적으로 일관되고, 명시된 원인이 명시된 결과를 실제로 산출할 수 있는가? |
| T2 | 선택 합리성 | 각 기술/접근법 선택이 이 문제의 구체적 제약 조건에 근거한 합리적 기반을 갖는가? |
| T3 | 트레이드오프 진정성 | 명시된 트레이드오프가 이 문제 맥락에서 실제적이고 구체적인가, 교과서 암기인가? |

### Depth Gating

- **signature**: T1, T2, T3 전체 적용
- **detailed**: T1, T2만 적용 (T2는 선택 언급 시)
- **compressed**: 미적용

### Evaluation Flow

1. Phase 8에서 depth 분류된 각 엔트리에 대해 T1-T3을 순차 적용
2. FAIL 판정 시 구체적 지적: 어떤 클레임이, 왜 문제인지, 면접에서 어떻게 깨지는지
3. signature depth 엔트리에서 T1-T3 중 2개 이상 FAIL → HTML 리포트에서 **P0 (반드시 수정)** 분류

**Reference:** Read `references/problem-solving.md` §22-25 for full T1-T3 PASS/FAIL examples, depth gating table, output format, and writing guidance trigger.

`[Phase 9/13: Technical Substance Verification ✓]`

---

## Phase 10: AI Tone Audit

After all evaluations are complete, perform an AI Tone Audit.

**MUST invoke the humanizer skill via the Skill tool.** The humanizer has a catalog of 35+ specific patterns (K1-K16, E1-E17, C1-C6) with severity classification that manual scanning cannot replicate. Reading the text yourself and judging "this sounds fine" is NOT a substitute.

Invoke exactly: `Skill(humanizer)` — request **audit mode** on every text element:

- 자기소개 (about_content)
- 경력 섹션 각 회사의 bullet lines
- 문제 해결 섹션 각 엔트리의 description
- 기술/스터디/기타 섹션

**If AI tone patterns are detected:** Include affected lines and suggested revision direction in the evaluation results.
**If no AI tone patterns are detected:** Skip this section in the output.

`[Phase 10/13: AI Tone Audit ✓]`

## Phase 11: Per-Bullet Content Quality Gate

While Phases 0-10 diagnosed "what the problems are," Phase 11 verifies "have the problems been sufficiently resolved." Each resume section is broken into individual units, and the fix-interview-evaluate loop repeats until the resume-claim-examiner sub-agent issues APPROVE.

### Evaluation Units

The resume-claim-examiner conducts technical interrogation at the granularity of **1 bullet / 1 entry**. It drills deep into individual technical claims, not entire sections.

| Unit Type | Granularity | Example | Notes |
|-----------|-------------|---------|-------|
| Self-introduction | 1 unit per Type | Type C (1 entry) | Type C involves tech connections, so it is evaluator-eligible. Type A/B/D can be skipped if no technical interrogation is needed |
| Career | 1 unit per bullet | "Built Kafka async pipeline, 3x throughput improvement" | Send a single bullet line to the evaluator, not the entire company block |
| Problem-solving | 1 unit per entry | Entire "Payment System Fault Isolation" episode | Each entry is a single technical narrative — send it as a whole. **Compressed depth excluded** (too short for technical interrogation) |
| Tech/Study | Not evaluator-eligible | — | Listing a tech stack is not subject to interrogation. Phase 0-10 evaluation is sufficient |

**Selection criteria:** Only bullets/entries with P0/P1 findings from Phases 0-10 are subject to the Quality Gate. Bullets that are fully PASS are skipped.

### Quality Gate Loop

For each P0/P1 bullet:

1. Collect the findings for that bullet from the Phase 0-10 evaluation results
2. **Generate 2-3 alternatives + tradeoff comparison** (safe / high-impact / balanced)
3. **Dispatch original text + alternatives package to resume-claim-examiner** — evaluator performs 2-stage verification:
   - Phase A: Is the original really problematic? → If no problem, APPROVE immediately (no revision needed)
   - Phase B: Is each alternative technically sound? → APPROVE if at least 1 passes
4. **APPROVE** → include verified alternatives in the HTML report. Move to next bullet.
5. **REQUEST_CHANGES** → interview the user based on evaluator's Interview Hints → supplement sources → regenerate alternatives → restart from step 2 (infinite loop)

**When the user reviews the HTML in Phase 12:**
- Selects an alternative and proceeds → Pass
- "Any other options?" / "Not great" → re-enter Phase 11 Quality Gate for that bullet
- "No feedback" → Phase 13

### Quality Gate Flow (Per Bullet)

```mermaid
flowchart TB
    START[Phase 0-10 evaluation complete] --> SELECT[Select bullets with P0/P1 findings]
    SELECT --> PICK[Pick next bullet]

    PICK --> ALT[Generate 2-3 alternatives + tradeoffs]
    ALT --> DISPATCH[resume-claim-examiner dispatch\n— send original + alternatives package]

    DISPATCH --> DIAG{Phase A: Interrogate original\nIs it really problematic?}
    DIAG -->|No problem| APPROVE_ORIG[APPROVE — no revision needed]
    DIAG -->|Problem confirmed| ALTEVAL{Phase B: Interrogate alternatives\nIs each one sound?}

    ALTEVAL -->|At least 1 passes| APPROVE_ALT[APPROVE — include verified alternatives in HTML]
    ALTEVAL -->|All fail| CHANGES[REQUEST_CHANGES\n+ Interview Hints]

    CHANGES --> INTERVIEW[User interview\n4-Stage Bypass Protocol]
    INTERVIEW --> SOURCE{Source obtained?}
    SOURCE -->|YES| ALT
    SOURCE -->|NO: 4-Stage exhausted| BEST[Best alternative with current source]
    BEST --> OPTOUT{User Opt-Out?}
    OPTOUT -->|YES: move on| NEXT
    OPTOUT -->|NO: continue| DISPATCH

    APPROVE_ORIG --> NEXT{Next bullet\nexists?}
    APPROVE_ALT --> NEXT

    NEXT -->|YES| PICK
    NEXT -->|NO| DONE[Phase 12: Generate HTML]

    style DISPATCH fill:#e74c3c,stroke:#333,color:#fff
    style DIAG fill:#f39c12,stroke:#333,color:#fff
    style ALTEVAL fill:#f39c12,stroke:#333,color:#fff
    style DONE fill:#27ae60,stroke:#333,color:#fff
```

<critical>
There is no escape from this loop without resume-claim-examiner APPROVE.
The only exception is the user explicitly opting out (see "User Opt-Out" section below for recognized keywords).
Advancing to the next bullet or proceeding to Phase 12 without APPROVE is forbidden.
</critical>

### Evaluator Dispatch Protocol

When sending a single bullet to the resume-claim-examiner, use a format that **exactly matches the Input Format in agents/resume-claim-examiner.md**.

```
# Technical Evaluation Request

## Candidate Profile
- Experience: {years} years
- Position: {position}
- Target Company/Role: {company} / {role}

## Bullet Under Review
- Section: {Career > Company A | Problem-Solving > Payment System Fault Isolation | Self-Introduction Type C}
- Original: "{original text that was the subject of Phase 0-10 evaluation}"

## Technical Context
- Technologies/approaches mentioned in this bullet: {identified by main session directly from bullet text — e.g., Kafka, Redis, circuit breaker}
- JD-related keywords: {relevant JD keywords obtained in Phase 1}
- Phase 0-10 findings: {verbatim P0/P1/P2 findings for this bullet}

## Proposed Alternatives (2-3)
{alternatives generated per content-quality-gate.md §3 protocol}
```

**Key rules:**
- "Technologies/approaches" in Technical Context are identified directly from the bullet text by the main session. Do not let the evaluator find them on its own.
- Phase 0-10 findings are transmitted verbatim. Do not summarize.
- Each evaluation is independent. Do not re-send results from previous evaluations.

### User Opt-Out

If the user says "move on" / "this is OK" / "skip" / "just continue" → end the current section loop. Status: "user-accepted (evaluator-not-approved)". Include unresolved feedback in the HTML report.

**Reference:** Read `references/content-quality-gate.md` for full protocol including alternative suggestion format, interview loop, HTML format, and whole-resume feedback loop.

`[Phase 11/13: Per-Bullet Content Quality Gate ✓]`

## Phase 12: Generate HTML Report + User Approval Gate

Compile all evaluation results from Phases 0-11 and write a self-contained HTML file. This is the **only phase that produces the final comprehensive evaluation report**. Generate the file, open it, and wait for user approval.

### Approval Gate (Strict Feedback Loop)

<critical>
Open the HTML report and ask the user to review it. Do not proceed to any next step until the user explicitly declares "no feedback." This rule applies even when called from within a resume-apply workflow.
</critical>

After opening the HTML report:

1. Tell the user the report is open
2. Use `AskUserQuestion` to ask: "리포트를 확인하고 피드백을 남겨주세요. 피드백이 없으면 '없음'이라고 답해주세요."
3. **Evaluate the user's response:**

| Response Type | Examples | Action |
|---------------|----------|--------|
| Explicit no feedback | "없음", "OK", "No feedback", "Move on" | → Proceed to Phase 13 |
| Ambiguous response | "Looks okay I guess", "Hmm...", "Roughly OK" | → Re-ask: "Is there anything specific you'd like to revise?" |
| Section-specific feedback | "Self-intro Type C is weak", "Career bullet 2nd..." | → Re-enter Phase 11 Quality Gate for that section |
| Overall direction feedback | "Overall impact is weak", "Not differentiated enough" | → Re-enter Phase 11 Quality Gate for relevant sections |

4. After applying feedback → regenerate HTML → `open` → loop back to step 2 (infinite loop)
5. **The only exit condition is "explicit no feedback."**

### Priority Level Definitions

| Level | Meaning | Criteria |
|-------|---------|----------|
| **P0** | Must Fix | 면접에서 즉시 깨짐 — 성과 없음, 인과 없음, 표준을 성과로 제시, cross-section 불일치 |
| **P1** | Recommended Fix | 면접에서 약점 노출 — 수치 불완전, 역할 불명확, 깊이 부족, AI 톤 감지 |
| **P2** | Can Improve | 더 좋아질 수 있음 — 표현 개선, JD 키워드 추가, 순서 변경, hook potential 강화 |
| **P3** | Reference | 스타일 선호 — 어조, 포맷팅, 사소한 표현 차이 |

### File Path

```
HTML_FILE="${OMT_DIR:-$HOME/.omt/global}/reports/review-YYYYMMDD-HHmmss.html"
```

- If `$OMT_DIR` is set, write to `$OMT_DIR/reports/`.
- If `$OMT_DIR` is unset, fall back to `~/.omt/global/reports/`.
- Run `mkdir -p "$(dirname "$HTML_FILE")"` before writing the file.
- After writing, run `open "$HTML_FILE"` via Bash tool to open it in the browser.
- Terminal output: 파일 경로만 출력 (e.g., `HTML report: /path/to/review-20260328-153000.html`).

### HTML Escaping

Before inserting any resume text into the HTML, apply these substitutions:
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`

### Strength Comment Selection Criteria

Per career bullet or problem-solving entry, only items that PASS all 6 section evaluation criteria get `.comment-strength`. C1-C5 STRONG ratings are visually emphasized within the C1-C5 section.

### HTML Skeleton Template

Use the following template as a literal starting point. Fill in all `<!-- ... -->` placeholder comments with actual evaluation data.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>Resume Review Report — <!-- CANDIDATE NAME --></title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 0 24px;
      color: #333;
      line-height: 1.6;
    }
    h1 { font-size: 1.5rem; border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { font-size: 1.2rem; margin-top: 32px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    h3 { font-size: 1rem; margin-top: 24px; color: #555; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f0f0f0; font-weight: 600; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 700;
      margin-right: 6px;
    }
    .badge-p0 { background: #c0392b; color: #fff; }
    .badge-p1 { background: #e67e22; color: #fff; }
    .badge-p2 { background: #f1c40f; color: #333; }
    .badge-p3 { background: #95a5a6; color: #fff; }
    .badge-strength { background: #27ae60; color: #fff; }
    .comment-p0 {
      background: #fdd;
      border-left: 4px solid #c0392b;
      padding: 10px 14px;
      margin: 8px 0;
      border-radius: 0 4px 4px 0;
    }
    .comment-p1 {
      background: #fef3cd;
      border-left: 4px solid #e67e22;
      padding: 10px 14px;
      margin: 8px 0;
      border-radius: 0 4px 4px 0;
    }
    .comment-p2 {
      background: #fff9c4;
      border-left: 4px solid #f1c40f;
      padding: 10px 14px;
      margin: 8px 0;
      border-radius: 0 4px 4px 0;
    }
    .comment-p3 {
      background: #f5f5f5;
      border-left: 4px solid #95a5a6;
      padding: 10px 14px;
      margin: 8px 0;
      border-radius: 0 4px 4px 0;
    }
    .comment-strength {
      background: #d4edda;
      border-left: 4px solid #27ae60;
      padding: 10px 14px;
      margin: 8px 0;
      border-radius: 0 4px 4px 0;
    }
    .suggestion {
      background: #f0fff0;
      border-left: 4px solid #27ae60;
      padding: 8px 14px;
      margin: 6px 0;
      font-family: monospace;
      white-space: pre-wrap;
    }
    .alternatives {
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 16px;
      margin: 8px 0;
    }
    .alternative {
      border-left: 3px solid #6c757d;
      padding: 8px 12px;
      margin: 8px 0;
      background: #fff;
      border-radius: 0 4px 4px 0;
    }
    .alt-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 700;
      margin-right: 6px;
    }
    .alt-safe { background: #d4edda; color: #155724; }
    .alt-impact { background: #cce5ff; color: #004085; }
    .alt-balanced { background: #fff3cd; color: #856404; }
    .alt-recommendation {
      color: #e67e22;
      font-weight: 700;
      font-size: 0.85rem;
      margin-left: 8px;
    }
    .alt-pros { color: #27ae60; font-size: 0.9rem; margin: 4px 0; }
    .alt-cons { color: #c0392b; font-size: 0.9rem; margin: 4px 0; }
    .tradeoff-table { margin-top: 12px; font-size: 0.9rem; width: 100%; border-collapse: collapse; }
    .tradeoff-table th { background: #e9ecef; padding: 6px 12px; text-align: left; }
    .tradeoff-table td { padding: 6px 12px; border-bottom: 1px solid #dee2e6; }
    .unresolved-note {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 10px 14px;
      margin: 8px 0;
      border-radius: 0 4px 4px 0;
      font-style: italic;
    }
    .section-opt-out {
      background: #fff3cd;
      border: 1px solid #ffc107;
      border-radius: 6px;
      padding: 12px;
      margin: 8px 0;
    }
    .opt-out-badge {
      display: inline-block;
      background: #ffc107;
      color: #212529;
      padding: 2px 10px;
      border-radius: 4px;
      font-size: 0.8rem;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .unresolved-feedback {
      margin-top: 8px;
    }
    .fail-axis {
      border-left: 3px solid #dc3545;
      padding: 6px 12px;
      margin: 6px 0;
      background: #fff;
    }
    .axis-label {
      font-weight: 700;
      color: #dc3545;
      font-size: 0.85rem;
    }
    .axis-feedback {
      margin: 4px 0;
      font-size: 0.9rem;
    }
    .axis-hint {
      color: #6c757d;
      font-size: 0.85rem;
      font-style: italic;
    }
    .resume-line {
      background: #fafafa;
      border: 1px solid #e0e0e0;
      padding: 6px 12px;
      margin: 4px 0;
      border-radius: 4px;
      font-style: italic;
    }
    .rating-strong { color: #27ae60; font-weight: 700; }
    .rating-present { color: #2980b9; font-weight: 700; }
    .rating-weak { color: #e67e22; font-weight: 700; }
    .rating-absent { color: #c0392b; font-weight: 700; }
    .rating-na { color: #95a5a6; font-weight: 700; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #ddd; color: #888; font-size: 0.85rem; }
    .stat-grid { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
    .stat-box { background: #f8f8f8; border: 1px solid #ddd; border-radius: 6px; padding: 12px 20px; text-align: center; }
    .stat-box .count { font-size: 2rem; font-weight: 700; }
    .stat-box .label { font-size: 0.8rem; color: #666; }
  </style>
</head>
<body>

<!-- HEADER -->
<h1>Resume Review Report</h1>
<p>
  <strong>Candidate:</strong> <!-- CANDIDATE NAME --><br>
  <strong>Target Position:</strong> <!-- TARGET POSITION --><br>
  <strong>Review Date:</strong> <!-- REVIEW DATETIME --><br>
  <strong>JD Reference:</strong> <!-- JD REFERENCE OR "없음" -->
</p>

<!-- C1-C5 SECTION -->
<h2>Competency Assessment (C1-C5)</h2>
<p>5점 척도: <span class="rating-strong">STRONG</span> / <span class="rating-present">PRESENT</span> / <span class="rating-weak">WEAK</span> / <span class="rating-absent">ABSENT</span> / <span class="rating-na">N/A</span></p>
<table>
  <thead>
    <tr><th>Competency</th><th>Rating</th><th>Evidence</th></tr>
  </thead>
  <tbody>
    <!-- For each C1-C5 competency, output one row. Example:
    <tr>
      <td>C1 — <!-- COMPETENCY NAME --></td>
      <td><span class="rating-strong">STRONG</span></td>
      <td><!-- RATIONALE --></td>
    </tr>
    Use rating-strong / rating-present / rating-weak / rating-absent / rating-na class on the span. -->
  </tbody>
</table>

<!-- RESUME SECTIONS -->
<h2>Section Inline Feedback</h2>
<!-- Repeat the following block for each resume section in order:
     자기소개 → 경력 각 회사 → 문제해결 각 엔트리 → 기술스택/기타 -->

<!--
<h3><!-- SECTION NAME --></h3>

For each resume line in this section:
  - If ALL 6 evaluation criteria PASS: wrap in .comment-strength
  - If any criterion fails: wrap in .comment-p{0|1|2|3} matching the finding priority

Example — finding with comment:
<div class="resume-line">I worked as a backend developer for 3 years.</div>
<div class="comment-p0">
  <span class="badge badge-p0">P0 #1</span>
  <strong>"Worked for 3 years" is a duration fact only — no achievement. Nothing for the interviewer to remember.</strong><br>
  <em>Violation:</em> No goal→action→outcome causation, no differentiator<br>
  <em>Interview simulation:</em> "So what did you actually do?" — the answer is not in this sentence
  <div class="suggestion">Revised: Designed and operated a B2B SaaS payment system over 3 years, reducing payment-order discrepancies to zero.</div>
</div>

Example — all-PASS line:
<div class="resume-line">Achieved zero payment-order discrepancies, converting an average of 12 monthly claims to 0.</div>
<div class="comment-strength">
  <span class="badge badge-strength">PASS</span>
  All 6 criteria passed — goal/action/outcome causation clear, metrics verifiable
</div>

Example — finding with multiple alternatives:
<div class="resume-line">Built a Kafka-based async pipeline.</div>
<div class="comment-p1">
  <span class="badge badge-p1">P1 #3</span>
  <strong>No explanation of why Kafka or what tradeoffs were made.</strong><br>
  <em>Violation:</em> Tradeoff authenticity (E3) — no basis for technology choice<br>
  <em>Interview simulation:</em> "Why Kafka instead of RabbitMQ?" — no answer
  <div class="alternatives">
    <h4>Alternatives</h4>
    <div class="alternative">
      <div><span class="alt-badge alt-safe">Alt 1: Safe</span><span class="alt-recommendation">★ Recommended</span></div>
      <div class="alt-content">Needed ordering guarantees for 100K daily events and chose Kafka; partition-based ordering was the decisive factor over RabbitMQ.</div>
      <div class="alt-pros">Pros: Minimal change, technology choice clearly justified</div>
      <div class="alt-cons">Cons: Impact is weak, low differentiation</div>
    </div>
    <div class="alternative">
      <div><span class="alt-badge alt-impact">Alt 2: High Impact</span></div>
      <div class="alt-content">Processing 100K daily events while balancing the tradeoff between partition ordering and throughput, we prioritized ordering and capped partitions at 3, accepting 200ms processing latency.</div>
      <div class="alt-pros">Pros: Tradeoff is specific, deeper interview signal ↑</div>
      <div class="alt-cons">Cons: Metrics verification required — backfires if absent</div>
    </div>
    <table class="tradeoff-table">
      <tr><th>Criterion</th><th>Alt 1</th><th>Alt 2</th></tr>
      <tr><td>Interview safety</td><td>★★★</td><td>★★☆</td></tr>
      <tr><td>Differentiation</td><td>★★☆</td><td>★★★</td></tr>
      <tr><td>Source required</td><td>Low</td><td>High</td></tr>
    </table>
  </div>
</div>

Example — user-accepted but evaluator-not-approved:
<div class="resume-line">Migrated to MSA and shortened the deployment cycle.</div>
<div class="comment-p1">
  <span class="badge badge-p1">P1 #5</span>
  <strong>No concrete tradeoffs from the MSA migration</strong>
  <div class="unresolved-note">
    ⚠ Unresolved: resume-claim-examiner issued FAIL on E3 (Tradeoff Specificity) and E4 (Scale-Appropriate Engineering). User chose to proceed with current content.
  </div>
</div>
-->

<!-- SUMMARY FOOTER -->
<h2>Review Summary</h2>
<div class="stat-grid">
  <div class="stat-box"><div class="count" style="color:#c0392b;"><!-- P0 COUNT --></div><div class="label">P0 Must Fix</div></div>
  <div class="stat-box"><div class="count" style="color:#e67e22;"><!-- P1 COUNT --></div><div class="label">P1 Recommended Fix</div></div>
  <div class="stat-box"><div class="count" style="color:#f1c40f;"><!-- P2 COUNT --></div><div class="label">P2 Can Improve</div></div>
  <div class="stat-box"><div class="count" style="color:#95a5a6;"><!-- P3 COUNT --></div><div class="label">P3 Reference</div></div>
  <div class="stat-box"><div class="count"><!-- TOTAL COUNT --></div><div class="label">Total</div></div>
</div>
<table>
  <thead>
    <tr><th>P</th><th>#</th><th>Section</th><th>One-Line Diagnosis</th></tr>
  </thead>
  <tbody>
    <!-- One row per finding, in resume section order. Example:
    <tr>
      <td><span class="badge badge-p0">P0</span></td>
      <td>1</td>
      <td>자기소개</td>
      <td>임팩트 부재 — 성과 없는 기간 서술</td>
    </tr>
    -->
  </tbody>
</table>

<div class="footer">
  Generated by review-resume skill · <!-- REVIEW DATETIME -->
</div>

</body>
</html>
```

`[Phase 12/13: Generate HTML Report ✓]`

## Phase 13: Note Accumulate

After the user has reviewed the HTML report and approved it, accumulate insights from this session into persistent note. Save after user confirmation.

### What to accumulate

1. **New candidates**: Experiences discussed that aren't in the pool → propose new files
2. **Candidate updates**: Improved expressions → update the existing candidate body
3. **preferences.md**: New tone/judgment preferences discovered during review
4. **Research cache**: Company research results → `sources/{company}-{date}.md`

### Output format

Show accumulation summary and wait for user confirmation before writing files:

```
[Note Accumulate — Phase 13]

New candidates:
  + problem-solving/search-latency-optimization.md

Updates:
  ~ problem-solving/payment-order-sync.md → body updated

Preferences:
  ~ preferences.md → added "impact-first ordering preference"

Research cache:
  + sources/toss-backend-2025-03.md

Save? (y/n)
```

**Reference:** Read `references/note-system.md` § "Note Accumulate" for full accumulation rules.

`[Phase 13/13: Note Accumulate ✓]`

## Completion Checklist (Internal — do NOT output to user)

Before delivering Phase 12 output, verify every phase was completed or has a valid skip reason. Track with DONE or SKIPPED status:

```
[Review Completion Checklist — INTERNAL]
- [ ] Phase 0: Note Load + Auto-Seeding
- [ ] Phase 1: Pre-Evaluation Research
- [ ] Phase 2: Self-Introduction Evaluation
- [ ] Phase 2: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 3: Target Position Gate
- [ ] Phase 4: Developer Competency Assessment (C1-C5)
- [ ] Phase 4: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 5: Section-Specific Evaluation (경력 6개 기준 / 문제해결 6개 기준)
- [ ] Phase 5: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 6: 3-Level Pushback Simulation
- [ ] Phase 7: First-Page Primacy + JD Keyword Matching
- [ ] Phase 7: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 8: Problem-Solving Evaluation (depth: signature → detailed → compressed)
- [ ] Phase 8: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 9: Technical Substance Verification (T1-T3: 기술적 정합성, 선택 합리성, 트레이드오프 진정성)
- [ ] Phase 10: AI Tone Audit (MUST invoke Skill(humanizer) — manual scan ≠ DONE)
- [ ] Phase 11: Per-Bullet Content Quality Gate (resume-claim-examiner APPROVE or user opt-out required for each section unit)
- [ ] Phase 12: Generate HTML Report + User Approval Gate (피드백 0될 때까지 무한루프)
- [ ] Phase 13: Note Accumulate (candidate/preference persistence — user confirmation required)
```

A phase is SKIPPED only when its precondition is not met (e.g., Phase 8 specific depth skipped because no entries at that depth exist). Phases 0, 10, 11, 12 have NO precondition — always required. Phase 13 has a strict precondition: User Approval in Phase 12. Phase 13 counts as DONE even if the user declines to save.

If any phase shows SKIPPED without a valid precondition reason, complete it before delivering Phase 12 output.
