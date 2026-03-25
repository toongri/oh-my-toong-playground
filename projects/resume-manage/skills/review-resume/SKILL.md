---
name: review-resume
description: MUST USE this skill when the user asks to review, evaluate, check, or get feedback on their resume — even partially (e.g., just self-introduction, just problem-solving section, just career bullets). Use when ANY of these appear: (1) 이력서 리뷰, 이력서 봐줘, 이력서 검토, 이력서 피드백, resume review, review my resume; (2) requests to evaluate specific resume sections like 자기소개, 경력, 문제 해결, 프로젝트; (3) questions about resume quality, interview readiness, or achievement line strength; (4) requests to check for industry-standard items, AI tone, or section structure; (5) any mention of _config.yml combined with review/feedback/check/evaluate intent. This skill provides structured self-introduction evaluation (per-type A-D + global), D1c-D6c / D1p-D6p, and depth-based problem-solving evaluation with inline writing guidance. Do NOT use for JD-based resume tailoring (use resume-apply instead) or simple _config.yml edits.
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

## Persistent Memory System

Resume reviews are not one-off events. Across conversations, user experiences, preferences, and expression choices accumulate. To swap candidates for a JD, you need a candidate pool beyond "the 4 currently in the resume." This memory system provides cross-session persistence.

**Directory:** `~/.omt/resume-manage/review-resume/`

| Folder | Contents |
|--------|----------|
| `self-introduction/` | Type A, B, C, D paragraph candidates |
| `career/` | Career bullet candidates |
| `problem-solving/` | All problem-solving entries (unified: signature + detailed + compressed depth) |
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

**Reference:** Read `references/memory-system.md` for full file format (frontmatter schema), auto-seeding logic, and accumulation rules.

## Evaluation Protocol

Every resume review follows this sequence. No step is optional.

```mermaid
flowchart TB
    M0[Memory Load + Auto-Seeding] --> A[Resume received]
    A --> B{Self-introduction present?}
    B -->|Yes| C[Self-introduction evaluation: per-type + global]
    B -->|No| D{Target position known?}
    C --> D
    D -->|No| E[ASK target position]
    E --> E2[/HALT — wait for user reply/]
    E2 --> F2{Self-introduction was evaluated?}
    F2 -->|Yes| F[Type C conditional evaluation]
    F2 -->|No| CA[Developer Competency Assessment: C1-C5]
    F --> F3[Writing Guidance Trigger recheck]
    F3 --> CA
    D -->|Yes| CA
    CA --> G[Section-specific evaluation: D1c-D6c career / D1p-D6p problem-solving]
    G --> H[3-level pushback simulation]
    H --> I[First-Page Primacy check]
    I --> I2{JD provided?}
    I2 -->|Yes| I3[JD Keyword Matching]
    I2 -->|No| I4[Section fitness check]
    I3 --> I4
    I4 --> PS[Problem-Solving Evaluation: depth-based branching]
    PS --> O[MUST: AI Tone Audit — Skill humanizer audit mode]
    O --> MA[Memory Accumulate — candidate/preference persistence]
    MA --> N[Deliver findings + inline writing guidance]
```

## Workflow Progress Tracking

The Evaluation Protocol defines 12 phases (0-11). Resume reviews involve extensive back-and-forth — user discussion during self-introduction alone can span dozens of messages. Without explicit tracking, later phases are routinely skipped.

### Phase Map

| Phase | Node(s) | Section | Reference |
|-------|---------|---------|-----------|
| 0 | M0 | Memory Load + Auto-Seeding | `references/memory-system.md` |
| 1 | A→B | Pre-Evaluation Research | `references/pre-evaluation-research.md` |
| 2 | C | Self-Introduction Evaluation (per-type + global) | `references/self-introduction.md` |
| 3 | D→E→E2→F2→F→F3 | Target Position Gate + Type C Conditional | `references/self-introduction.md` |
| 4 | CA | Developer Competency Assessment (C1-C5) | `references/competency-assessment.md` |
| 5 | G | Section-Specific Evaluation (D1c-D6c / D1p-D6p) | `references/section-evaluation.md` |
| 6 | H | 3-Level Pushback Simulation | `references/section-evaluation.md` |
| 7 | I→I2→I3→I4 | First-Page Primacy + JD Keyword Matching | `references/section-evaluation.md` |
| 8 | PS | Problem-Solving Evaluation (depth: signature → detailed → compressed) | `references/problem-solving.md` |
| 9 | O | AI Tone Audit | (inline below) |
| 10 | MA | Memory Accumulate | `references/memory-system.md` |
| 11 | N | Deliver Findings + Inline Writing Guidance | (inline below) |

### Tracking Rules

1. After completing each phase, output a progress line: `[Phase N/11: {phase name} ✓]`
2. Before starting a new phase, verify the previous phase's progress line was output. If missing, complete the skipped phase first.
3. When user interaction interrupts the flow (e.g., extended discussion during Phase 2), resume from the next incomplete phase after the interaction concludes. Re-read this Phase Map to locate your position.
4. At the end, output the Completion Checklist (see the final section of this document).

---

## Phase 0: Memory Load

Load persistent memory before starting the review. Previous review sessions' candidate pools, user preferences, and research caches become the starting point for this review.

1. Check if `~/.omt/resume-manage/review-resume/` exists
2. If empty or missing → execute **Auto-Seeding** (parse current resume into initial candidate files)
3. If exists → scan frontmatter of all candidate files, load `preferences.md`, check `sources/` for cached research

Report memory status to user:
```
[Memory Loaded]
- Self-introduction candidates: N (preferred: X)
- Career candidates: N
- Problem-solving candidates: N (signature: X, detailed: Y, compressed: Z)
- User preferences: loaded / not found
- Research cache: {company} found / none
```

**Reference:** Read `references/memory-system.md` for full auto-seeding procedure and file format details.

`[Phase 0/11: Memory Load ✓]`

## Phase 1: Pre-Evaluation Research

Before evaluation, perform preparation: check other branches for context, analyze the JD (if provided), and research the target company.

- **Step 1**: Run `git branch -a`, inspect `_config.yml` on other branches for writing style and prior customizations
- **Step 2**: JD Analysis — extract team, keywords, implicit problems, and what is NOT in the JD
- **Step 3**: Company Research — core values, tech blog, product/service, career page, recent news

Research results feed into ALL paragraph type selections (A, B, C, D). Check `sources/` cache before doing fresh research.

**Reference:** Read `references/pre-evaluation-research.md` for the full research protocol.

`[Phase 1/11: Pre-Evaluation Research ✓]`

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

`[Phase 2/11: Self-Introduction Evaluation ✓]`

## Phase 3: Target Position Gate

If the user hasn't stated the target position/company, ASK and HALT. After receiving the target:
- If self-introduction was already evaluated → run Type C conditional evaluation
- Recheck writing guidance trigger

**Reference:** Type C conditional logic is in `references/self-introduction.md` § "Type C Conditional Evaluation".

`[Phase 3/11: Target Position Gate ✓]`

## Phase 4: Developer Competency Assessment (C1-C5)

Holistically assess the ENTIRE resume against 5 core competency axes. This answers a different question from D1c-D6c/D1p-D6p: not "is this well-written?" but **"does this resume demonstrate a competent developer?"**

| Axis | Focus |
|------|-------|
| C1 | Technical Code & Design — library internals, design alternatives, performance awareness |
| C2 | Technical Operations — failure detection, resilience, observability, hypothesis validation |
| C3 | Business-Technical Connection — business metric impact, cost awareness, user behavior |
| C4 | Collaboration & Communication — cross-functional, knowledge sharing, stakeholder management |
| C5 | Learning & Growth — depth of learning, external references, failure-driven growth |

Rate each axis as STRONG / PRESENT / ABSENT with evidence citations. Apply career-level expectations (not all axes need STRONG).

**Reference:** Read `references/competency-assessment.md` for full checklists, evidence examples, and career-level expectations table.

`[Phase 4/11: Developer Competency Assessment ✓]`

## Phase 5: Section-Specific Evaluation (D1c-D6c / D1p-D6p)

Career and problem-solving sections answer fundamentally different questions:
- **Career (D1c-D6c)**: "What did this person achieve?" — direction and impact. Career bullets are interview **hooks**.
- **Problem-solving (D1p-D6p)**: "How does this person approach problems?" — thought process and depth. Entries are engineering thinking **proof**.

### Career Dimensions (D1c-D6c)

| # | Dimension | Question |
|---|-----------|----------|
| D1c | Linear Causation | Goal → action → outcome connected in one line? |
| D2c | Metric Specificity | Verifiable numbers (before → after, absolute values)? |
| D3c | Role Clarity | Personal contribution distinguishable from team output? |
| D4c | Standard Transcendence | Beyond industry standard? |
| D5c | Hook Potential | Does this line provoke interviewer curiosity? |
| D6c | Section Fitness | Achievement statement, not problem narrative? |

### Problem-Solving Dimensions (D1p-D6p)

| # | Dimension | Question |
|---|-----------|----------|
| D1p | Diagnostic Causation | Problem detection → root cause → solution chain clear? |
| D2p | Evidence Depth | Failure data, alternative comparison, verification data present? |
| D3p | Thought Visibility | Is the reasoning process visible, not just the result? |
| D4p | Standard Transcendence | Beyond textbook solutions? |
| D5p | Hook Potential | Does this entry provoke follow-up questions? |
| D6p | Section Fitness | Problem narrative, not achievement statement? |

**Reference:** Read `references/section-evaluation.md` for full PASS/FAIL examples, output format, section fitness rules, first-page primacy check, JD keyword matching, and writing guidance triggers.

`[Phase 5/11: Section-Specific Evaluation ✓]`

## Phase 6: 3-Level Pushback Simulation

After section-specific evaluation, simulate an interviewer on **every line**, including well-written ones. Apply the **same intensity** regardless of writing quality.

| Level | Question Pattern | What It Tests |
|-------|-----------------|---------------|
| L1 | "How did you implement this?" | Implementation knowledge |
| L2 | "Why did you choose that approach?" | Technical judgment |
| L3 | "Did you consider any alternatives?" | Trade-off awareness |

If a candidate cannot answer all 3 levels, that line will hurt more than help.

**Reference:** Read `references/section-evaluation.md` § "3-Level Pushback Simulation" for the full simulation protocol.

`[Phase 6/11: 3-Level Pushback Simulation ✓]`

## Phase 7: First-Page Primacy + JD Keyword Matching

Check that the strongest content is on page 1 (the 7.4-second scan zone). If a JD is provided, perform keyword matching with ATS pass-rate estimation.

**Reference:** Read `references/section-evaluation.md` § "Section Fitness Rules" for first-page primacy rules and JD keyword matching output format.

`[Phase 7/11: First-Page Primacy + JD Keyword Matching ✓]`

## Phase 8: Problem-Solving Evaluation

All problem-solving entries — regardless of what the resume calls them (시그니처, 문제해결, 기타 프로젝트) — are evaluated under a unified framework. First classify each entry by depth, then apply depth-specific criteria.

### Depth Determination

```mermaid
flowchart TB
    A[Collect all problem-solving entries] --> B{Full P.A.R.R. narrative present?}
    B -->|Yes| C[signature depth → Full P.A.R.R. evaluation]
    B -->|No| D{5+ lines of description?}
    D -->|Yes| E[detailed depth → D1p-D6p + P1,P2,P5]
    D -->|No| F[compressed depth → D1p-D6p + Volume Guide]

    style C fill:lightyellow
    style E fill:lightgreen
    style F fill:lightblue
```

### Depth-Specific Evaluation

| Depth | Base | Additional | Key Focus |
|-------|------|-----------|-----------|
| signature | D1p-D6p | P1-P5 (all), P6-P8 (mid/senior) | Narrative depth, failure arc, why-chain, stopping judgment |
| detailed | D1p-D6p | P1, P2, P5 only | Narrative exists, at least 1 failure, why-chain present |
| compressed | D1p-D6p | Volume guide (3-5 entries, 3-5 lines each, max 25 lines) | Conciseness, problem→solution→result bullet flow |

**Memory candidate pool:** If `~/.omt/resume-manage/review-resume/problem-solving/` has candidates, suggest JD-optimal combinations from the full pool. Prioritize `rating: preferred` candidates.

**Reference:** Read `references/problem-solving.md` for full P.A.R.R. dimensions, career-level criteria, Before/After examples, writing guidance, and red flags.

`[Phase 8/11: Problem-Solving Evaluation ✓]`

## Phase 9: AI Tone Audit

After all evaluations are complete, perform an AI Tone Audit.

**MUST invoke the humanizer skill via the Skill tool.** The humanizer has a catalog of 35+ specific patterns (K1-K16, E1-E17, C1-C6) with severity classification that manual scanning cannot replicate. Reading the text yourself and judging "this sounds fine" is NOT a substitute.

Invoke exactly: `Skill(humanizer)` — request **audit mode** on every text element:

- 자기소개 (about_content)
- 경력 섹션 각 회사의 bullet lines
- 문제 해결 섹션 각 엔트리의 description
- 기술/스터디/기타 섹션

**If AI tone patterns are detected:** Include affected lines and suggested revision direction in the evaluation results.
**If no AI tone patterns are detected:** Skip this section in the output.

`[Phase 9/11: AI Tone Audit ✓]`

## Phase 10: Memory Accumulate

At review completion, accumulate insights from this session into persistent memory. Save after user confirmation.

### What to accumulate

1. **New candidates**: Experiences discussed that aren't in the pool → propose new files
2. **Candidate updates**: Improved expressions → add as variants (don't replace — other JDs may prefer the original)
3. **Usage history**: Update `used_in` for candidates used in this review
4. **Preference updates**: Explicit user preferences ("이게 더 좋다" / "이건 별로") → update `rating`
5. **preferences.md**: New tone/judgment preferences discovered during review
6. **Research cache**: Company research results → `sources/{company}-{date}.md`

### Output format

Show accumulation summary and wait for user confirmation before writing files:

```
[Memory Accumulate — Phase 10]

New candidates:
  + problem-solving/search-latency-optimization.md (compressed)

Updates:
  ~ problem-solving/payment-order-sync.md → variant C added
  ~ career/product-cache.md → rating: neutral → preferred

Preferences:
  ~ preferences.md → added "impact-first ordering preference"

Research cache:
  + sources/toss-backend-2025-03.md

Save? (y/n)
```

**Reference:** Read `references/memory-system.md` § "Memory Accumulate" for full accumulation rules.

`[Phase 10/11: Memory Accumulate ✓]`

## Phase 11: Deliver Findings

Compile all evaluation results and deliver to the user with inline writing guidance for every finding. Never leave the user with "here's the problem" without "here's how to fix it."

`[Phase 11/11: Deliver Findings ✓]`

## Completion Checklist

Before claiming the review is complete, verify every phase was executed. Output this checklist with DONE or SKIPPED status:

```
[Review Completion Checklist]
- [ ] Phase 0: Memory Load + Auto-Seeding
- [ ] Phase 1: Pre-Evaluation Research
- [ ] Phase 2: Self-Introduction Evaluation
- [ ] Phase 3: Target Position Gate
- [ ] Phase 4: Developer Competency Assessment (C1-C5)
- [ ] Phase 5: Section-Specific Evaluation (D1c-D6c / D1p-D6p)
- [ ] Phase 6: 3-Level Pushback Simulation
- [ ] Phase 7: First-Page Primacy + JD Keyword Matching
- [ ] Phase 8: Problem-Solving Evaluation (depth: signature → detailed → compressed)
- [ ] Phase 9: AI Tone Audit (MUST invoke Skill(humanizer) — manual scan ≠ DONE)
- [ ] Phase 10: Memory Accumulate (candidate/preference persistence — user confirmation required)
- [ ] Phase 11: Deliver Findings + Inline Writing Guidance
```

A phase is SKIPPED only when its precondition is not met (e.g., Phase 8 specific depth skipped because no entries at that depth exist). Phases 0, 9, 10 have NO precondition — always required. Phase 10 counts as DONE even if the user declines to save.

If any phase shows SKIPPED without a valid precondition reason, go back and complete it before finalizing.
