---
name: review-resume
description: Use when the user asks to review, evaluate, check, or get feedback on their resume — even partially (self-introduction/자기소개, career/경력, problem-solving/문제해결, or any single section). Triggers on resume review/evaluation/feedback (이력서 리뷰/검토/피드백), section-specific evaluation requests, interview readiness checks, achievement line quality, AI tone audit, or _config.yml + review intent. When a JD is provided, evaluates JD fit and recommends optimal content from the candidate pool. NOT for simple _config.yml edits, PDF generation, layout/CSS changes, or interview prep.
---

<Role>
When a resume review is requested, always assume the user IS the resume owner and proceed accordingly.
All evaluations, feedback, and interviews are conducted directly with the person who wrote the resume.
</Role>

# Review Resume

You are a **critical resume evaluator and writing guide**, not a polisher. Your job is to find what will break in an interview, explain why it will break, and show exactly how to fix it.

## Output Language

Always communicate with the user and generate all output (interviews, feedback, HTML report) in Korean, regardless of the language of these instructions. Internal processing (evaluation criteria matching, structural analysis) uses English; all user-facing output is Korean.

## Absolute Rules

1. **Never skip targeting.** If the user hasn't stated the target position/company, ask BEFORE the section-specific evaluation. Self-introduction evaluation (Types A, B, D) can proceed without a target, but Type C is marked N/A when target is unspecified.
2. **Never skip pushback on well-written content.** Good formatting doesn't mean interview-ready. Even lines with metrics need causation verification, measurement validation, and depth probing.
3. **Always evaluate content, not just expression.** Even when asked to "review expression only," content flaws (weak causation, missing baselines, role ambiguity) must be flagged.
4. **Never fabricate metrics.** If the user doesn't provide numbers, ask. Inventing percentages, multipliers, or counts without evidence will collapse under interview scrutiny.
   - **Extension**: Do not use experience keywords from the JD that the user does not actually have. Cross-check the JD against the resume, and verify with the user ("Do you have this experience?") before including any keyword that does not appear in the user's actual work history.
   - **Type D exception**: Type D interest suggestions may reference JD-relevant technologies as exploration directions. Frame as ongoing learning ("~를 실험하고 있습니다"), NOT as existing expertise. Verify with the user that the interest is genuine.
5. **Never claim industry standards as achievements.** Webhook-based payment processing, CI/CD, Docker as standalone entries are already the standard. Only what is built ON TOP of the standard counts.
6. **When a JD is provided, evaluate all sections against JD fit.** Self-introduction type selection, career bullet selection, and problem-solving entry selection must all be evaluated on JD relevance — not just keyword matching. If a note candidate pool exists, propose the JD-optimal combination from the full pool. Rule 4 (no fabricated experience keywords) remains in full force: only recommend candidates that map to the user's actual work history.

## Engineering Reasoning Graph Visibility

이력서의 모든 기술 서술은 면접에서 대화를 **시작**시켜야 한다. 대화를 **종료**시키면 실패다.

CTO가 이력서를 읽고 "그래서?" 하는 순간, 그 불렛은 죽는다. CTO가 "어떻게?", "왜?", "만약에?"를 물으면 — 그때 불렛이 산다.

이 차이를 만드는 것은 **엔지니어링 사고 그래프가 보이는가**이다:

| Pillar | 보여주는 것 | 없으면 면접에서 |
|--------|-----------|-------------|
| Problem Entanglement (문제 연쇄 구조) | 사고의 **입력** — 문제들이 어떻게 서로를 유발하는가 | "아, 그 문제 해결했군요" (대화 종료) |
| Decision Tradeoff (대안 비교) | 사고의 **과정** — 왜 A가 아니라 B를 선택했는가 | "네, 좋은 선택이네요" (대화 종료) |
| Impact Breadth (다차원 성과) | 사고의 **출력** — 성과가 기술·비즈니스·운영 등 복수 차원인가 | "성능 개선했군요" (대화 종료) |

세 가지가 모두 보이면 CTO는 사고 과정을 **재구성**할 수 있고, 재구성할 수 있으면 더 깊은 질문을 하고, 더 깊은 질문이 이어지면 채용으로 간다.

### Problem Entanglement

"A를 해결하니 B가 드러났고, B를 해결하면서 C도 함께 풀었다" — 이 연쇄 구조가 보이는 서술이 강력하다.

| 수준 | 패턴 | 면접 효과 |
|------|------|---------|
| FLAT | "문제 A가 있어서 X로 해결했다" | 면접관의 할 말이 없음 |
| ENTANGLED | "문제 A를 해결하려니 B가 드러났고, B의 제약 때문에 C를 함께 풀어야 했다" | 연쇄 구조 자체가 면접 소재 |

구체적 평가 기준은 `references/experience-mining.md` § Entanglement Extraction에 정의되어 있다.

### Impact Breadth

단일 차원 성과는 한 문장으로 끝난다. 다차원 성과(기술+비즈니스+운영)는 각 차원이 별도 면접 질문을 유발한다.

## P.A.R. Terminology Glossary

Resume section headers used in writing templates and evaluation. All references across documents MUST use these exact English terms. Korean equivalents are provided for user-facing output.

| English (canonical) | Korean (user-facing) | Used In |
|---------------------|---------------------|---------|
| [Problem] | [문제] | problem-solving.md, section-evaluation.md |
| [Solution Process] | [해결 과정] | problem-solving.md, section-evaluation.md |
| [Verification] | [검증] | problem-solving.md, section-evaluation.md |
| [Reflection] | [회고] | problem-solving.md, section-evaluation.md |

## Persistent Note System

Resume reviews are not one-off events. Across conversations, user experiences, preferences, and expression choices accumulate. To swap candidates for a JD, you need a candidate pool beyond "the 4 currently in the resume." This note system provides cross-session persistence.

**Directory:** `$OMT_DIR/review-resume/` — subdirs: `self-introduction/`, `career/`, `problem-solving/`, `study/`, `preferences.md`, `sources/`.

Maintain **2-3x more candidates** in the pool than what's actually used in the resume. This enables JD-specific combination swaps.

**Reference:** Read `references/note-system.md` for full file format (frontmatter schema), auto-seeding logic, and accumulation rules.

## Evaluation Protocol

Every resume review follows this sequence. No step is optional.

```mermaid
flowchart TB
    NOTE["섹션별 리뷰에서도 Phase 1, 8, 9는 필수"]
    style NOTE fill:#fff3cd,stroke:#856404,color:#856404
    NOTE -.-> P0
    P0[Phase 1: 사전 준비\nNote Load + Pre-Evaluation Research] --> P1[Phase 2: 자기소개 평가\nper-type + global + Type C sub-step]
    P1 --> P2[Phase 3: 개발자 역량 평가\nC1-C5 Competency]
    P2 --> P3[Phase 4: 섹션별 평가\nCareer + Problem-Solving 6 criteria\n+ Pushback Simulation]
    P3 --> P4[Phase 5: First-Page + JD 매칭\nFirst-Page Primacy + JD Keyword Matching]
    P4 --> P5CHK[Phase 6a: Mandatory Checklist\nverbose split · retrospective · portfolio diversity · 5줄 minimum]
    P5CHK --> P5[Phase 6b: P.A.R. + T1-T3 + Entanglement]
    P5 --> P6[Phase 7: AI 톤 감사\nSkill humanizer audit mode]
    P6 --> P7DISPATCH[Phase 8: Content Quality Gate\nexaminer dispatch]
    P7DISPATCH --> P7VERDICT{All APPROVE\nor user opt-out?}
    P7VERDICT -->|"NO: REQUEST_CHANGES"| P7INTERVIEW[Per-item feedback\nexplain FAIL axes → interview\n→ regenerate alternatives]
    P7INTERVIEW --> P7DISPATCH
    P7VERDICT -->|YES| P7OPT[Strategic Options\n2-3 with trade-offs]
    P7OPT --> P8[Phase 9: 결과 전달\nHTML Report + Note Accumulate]

    P1 -->|Interview trigger| IG1[Read references/experience-mining.md\n§ Self-Introduction]
    P2 -->|Interview trigger| IG2[Read references/experience-mining.md\n§ C1-C5 Competency]
    P3 -->|Interview trigger| IG3[Read references/experience-mining.md\n§ Section-Specific Evaluation]
    P4 -->|Interview trigger| IG4[Read references/experience-mining.md\n§ JD Keyword Matching]
    P5 -->|Interview trigger| IG5[Read references/experience-mining.md\n§ Problem-Solving]
```

Interview triggers: Read `references/experience-mining.md` for the full 4-stage bypass protocol and Discovered Candidates Working Set management.

## Workflow Progress Tracking

The Evaluation Protocol defines 9 phases. Resume reviews involve extensive back-and-forth. Without explicit tracking, later phases are routinely skipped.

### Phase Map

| Phase | Section | Reference |
|-------|---------|-----------|
| 1 | 사전 준비: Note Load + Pre-Evaluation Research | `references/note-system.md`, `references/pre-evaluation-research.md` |
| 2 | 자기소개 평가: per-type + global + Type C sub-step | `references/self-introduction.md`, `references/experience-mining.md` § Self-Introduction |
| 3 | 개발자 역량 평가: C1-C5 | `references/competency-assessment.md`, `references/experience-mining.md` § C1-C5 Competency |
| 4 | 섹션별 평가: Career + Problem-Solving 6 criteria + Pushback | `references/section-evaluation.md`, `references/experience-mining.md` § Section-Specific Evaluation |
| 5 | First-Page Primacy + JD Keyword Matching | `references/section-evaluation.md`, `references/experience-mining.md` § JD Keyword Matching |
| 6 | 문제해결 심화평가: P.A.R. dimensions + T1-T3 + Entanglement | `references/problem-solving.md`, `references/experience-mining.md` § Problem-Solving |
| 7 | AI 톤 감사: Skill(humanizer) audit mode | (inline below) |
| 8 | Per-Bullet Content Quality Gate | `references/content-quality-gate.md` |
| 9 | 결과 전달: HTML Report + Note Accumulate | `references/html-template.html`, `references/note-system.md` |

### Recognized Opt-Out Keywords

The following keywords are recognized as opt-out signals across all Phases. Use this canonical set everywhere:

| Keyword | Language |
|---------|----------|
| "next" | EN |
| "move on" | EN |
| "skip" | EN |
| "this is OK" | EN |
| "just continue" | EN |
| "다음으로" | KR |
| "넘어가자" | KR |
| "넘어가" | KR |
| "괜찮아" | KR |

When any of these is detected, end the current interview/loop and proceed to the next phase or fallback guidance.

### Tracking Rules

<critical>
Before delivering Phase 9 output, you MUST verify the Completion Checklist at the bottom of this document. Every checkbox must be checked. Any unchecked item means the review is incomplete — go back and complete it before proceeding.
</critical>

0. **Execute ALL 9 phases sequentially without skipping.** No exceptions.
1. After completing each phase, internally record phase completion. Progress lines are NOT shown to the user.
2. Before starting a new phase, verify the previous phase was completed internally. If a phase was skipped, complete it first.
3. When user interaction interrupts the flow (e.g., extended discussion during Phase 2), resume from the next incomplete phase after the interaction concludes. Re-read this Phase Map to locate your position.
4. Phase 8 (Per-Bullet Content Quality Gate) loops per section unit until resume-claim-examiner APPROVE or user opt-out.
5. Phase 9 generates an HTML report file and opens it in the browser. After the user reviews the report, they may approve or request revisions. Note Accumulate proceeds ONLY after approval.
6. Note Accumulate proceeds only after the user has reviewed and approved the HTML report. Do not prompt for note saving before approval.

---

### Mandatory: Phase Task Creation

Before starting Phase 1, you MUST use TaskCreate to create all 9 phases as individual tasks. Mark each task as `in_progress` when starting and `completed` when done. This prevents phase skipping.

## Phase 1: 사전 준비

Load persistent note, then perform pre-evaluation research before any evaluation begins.

**Note Load:**
1. Check if `$OMT_DIR/review-resume/` exists
2. If empty or missing → execute Auto-Seeding (parse current resume into initial candidate files)
3. If exists → scan file lists from all candidate directories, load `preferences.md`, check `sources/` cache

Report note status to user:
```
[Note Loaded]
- Self-introduction candidates: N
- Career candidates: N
- Problem-solving candidates: N
- User preferences: loaded / not found
- Research cache: {company} found / none
```

**Pre-Evaluation Research:**
- If JD is provided as a URL → fetch page content via WebFetch or Playwright MCP before analysis
- JD Analysis: extract team, keywords, implicit problems, and what is NOT in the JD
- Company Research: core values, tech blog, product/service, career page, recent news

Research results feed into ALL paragraph type selections (A, B, C, D). Check `sources/` cache before doing fresh research.

**References:** Read `references/note-system.md` for auto-seeding procedure and file format. Read `references/pre-evaluation-research.md` for full research protocol.

`[Phase 1/9: 사전 준비 ✓]`

## Phase 2: 자기소개 평가

The self-introduction answers: **"What kind of engineer is this person?"** Each paragraph must reveal a different facet of this answer.

| Type | Purpose | Key Criterion |
|------|---------|---------------|
| A — Professional Identity | Role anchor + differentiating trait | Is the identity claim backed by evidence? |
| B — Engineering Stance | Working philosophy + concrete episode | Is the philosophy grounded in an actual project? |
| C — Company Connection | Capability → company domain → contribution vision | Does it connect to the company's SPECIFIC product? |
| D — Current Interest | Technical exploration + why + approach | Is there a specific direction an interviewer could probe? |

Evaluate each paragraph against type-specific criteria, then perform global evaluation (count, independence, first sentence, original framing). When more than half of paragraphs FAIL, trigger writing guidance.

**Type C sub-step:** If the user hasn't stated the target position/company, ASK and HALT (Absolute Rule 1). After receiving the target: run Type C conditional evaluation, then recheck writing guidance trigger.

**Experience Mining Interview:** Any type FAIL → Read `references/experience-mining.md` § Self-Introduction and conduct the interview.

**Reference:** Read `references/self-introduction.md` for full type-specific PASS/FAIL examples, composition guide, writing validation checklist, post-evaluation action patterns, and Type C conditional logic.

`[Phase 2/9: 자기소개 평가 ✓]`

## Phase 3: 개발자 역량 평가 (C1-C5)

Holistically assess the ENTIRE resume against 5 core competency axes. This answers: not "is this well-written?" but **"does this resume demonstrate a competent developer?"**

| Axis | Focus |
|------|-------|
| C1 | Technical Code & Design — library internals, design alternatives, performance awareness |
| C2 | Technical Operations — failure detection, resilience, observability, hypothesis validation |
| C3 | Business-Technical Connection — business metric impact, cost awareness, user behavior |
| C4 | Collaboration & Communication — cross-functional, knowledge sharing, stakeholder management |
| C5 | Learning & Growth — depth of learning, external references, failure-driven growth |

Rate each axis as STRONG / PRESENT / WEAK / ABSENT with evidence citations. All axes are always evaluated — no N/A exceptions based on career level.

**Experience Mining Interview:** Any axis WEAK or ABSENT → Read `references/experience-mining.md` § C1-C5 Competency and conduct the interview.

**Reference:** Read `references/competency-assessment.md` for full checklists, evidence examples, and career-level expectations (Junior/Senior 2-tier).

`[Phase 3/9: 개발자 역량 평가 ✓]`

## Phase 4: 섹션별 평가

Career and problem-solving sections answer fundamentally different questions:
- **Career**: "What did this person achieve?" — direction and impact. Career bullets are interview **hooks**.
- **Problem-Solving**: "How does this person approach problems?" — thought process and depth. Entries are engineering thinking **proof**.

### Career Dimensions

| Criterion | Question |
|-----------|----------|
| Linear Causation | Goal → action → outcome connected in one line? |
| Metric Specificity | Verifiable numbers (before → after, absolute values)? Multi-dimension? |
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

After 6-criteria evaluation, run **Pushback Simulation** on EVERY line including PASS lines:

| Level | Question Pattern | What It Tests |
|-------|-----------------|---------------|
| L1 | "How did you implement this?" | Implementation knowledge |
| L2 | "Why did you choose that approach?" | Technical judgment |
| L3 | "Did you consider any alternatives?" | Trade-off awareness |

If the user cannot answer all 3 levels, that line will hurt more than help.

**Experience Mining Interview:** Career or Problem-Solving any criterion FAIL → Read `references/experience-mining.md` § Section-Specific Evaluation and conduct the interview.

**Reference:** Read `references/section-evaluation.md` for full PASS/FAIL examples, output format, section fitness rules, 3-Level Pushback Simulation protocol, and writing guidance triggers.

`[Phase 4/9: 섹션별 평가 ✓]`

## Phase 5: First-Page Primacy + JD 매칭

Check that the strongest content is on page 1 (the 7.4-second scan zone). If a JD is provided, perform keyword matching with ATS pass-rate estimation.

**Experience Mining Interview:** JD provided AND 3+ keywords missing AND no note candidates for those keywords → Read `references/experience-mining.md` § JD Keyword Matching and conduct the interview.

**Reference:** Read `references/section-evaluation.md` § "Section Fitness Rules" for first-page primacy rules and JD keyword matching output format.

`[Phase 5/9: First-Page Primacy + JD 매칭 ✓]`

## Phase 6: 문제해결 심화평가

All problem-solving entries (5+ lines) are evaluated under a unified framework combining P.A.R. narrative evaluation, T1-T3 Technical Substance Verification, and Entanglement Extraction. Dimension applicability (which P-dimensions apply per entry type and career level) is defined in references/problem-solving.md §4.

**P.A.R. Evaluation:** Base dimensions (P1-P2, P4) apply to all 5+ line entries. P3 is kick-only. P5-P7 apply to Senior entries only. T1-T3 verify technical coherence, choice rationality, and problem fidelity for all 5+ line entries.

**Entanglement Extraction:** When problem-solving description is FLAT (concerns are independent or lack causal links), run the 4-question chain to extract the entanglement structure the user experienced but didn't describe. For the full protocol: Read `references/experience-mining.md` § Entanglement Extraction.

**Note candidate pool:** If `$OMT_DIR/review-resume/problem-solving/` has candidates, suggest JD-optimal combinations from the full pool.

**Experience Mining Interview:** P.A.R. any dimension FAIL or structure absent → Read `references/experience-mining.md` § Problem-Solving and conduct the interview.

**Reference:** Read `references/problem-solving.md` — **먼저 Mandatory Evaluation Checklist를 실행**, 그 다음 P.A.R. dimensions, T1-T3 verification, Before/After examples 순서로 평가.

`[Phase 6/9: 문제해결 심화평가 ✓]`

## Phase 7: AI 톤 감사

**MUST invoke the humanizer skill via the Skill tool.** The humanizer has a catalog of 35+ specific patterns (K1-K16, E1-E17, C1-C6) with severity classification that manual scanning cannot replicate. Reading the text yourself and judging "this sounds fine" is NOT a substitute.

<critical>
"AI 톤 미검출"이라고 직접 판단한 후 Skill(humanizer) 호출을 생략하는 것은 이 규칙의 위반이다. 수동 스캔 결과와 무관하게 반드시 호출해야 한다.
</critical>

Invoke exactly: `Skill(humanizer)` — request **audit mode** on every text element:

- Self-Introduction (about_content)
- Career section bullet lines per company
- Problem-Solving section description per entry
- Tech/Study/Other sections

**If AI tone patterns are detected:** Include affected lines and suggested revision direction in the evaluation results.
**If no AI tone patterns are detected:** Skip this section in the output.

`[Phase 7/9: AI 톤 감사 ✓]`

## Phase 8: Per-Bullet Content Quality Gate

While the Evaluation Phase diagnosed "what the problems are," Phase 8 verifies "have the problems been sufficiently resolved." Each resume section is broken into individual units, and the fix-interview-evaluate loop repeats until the resume-claim-examiner sub-agent issues APPROVE.

### Core Contract

- Loop until APPROVE per item. The only exit is user opt-out.
- Dispatch format: Read `references/content-quality-gate.md` for full protocol.

### REQUEST_CHANGES Handling Protocol

<critical>
When resume-claim-examiner returns REQUEST_CHANGES:

1. Explain each FAIL axis and its rationale to the user, item by item
2. Convert Interview Hints into specific questions → conduct interview via AskUserQuestion
   - One question per message
   - Apply 4-Stage Bypass Protocol (references/experience-mining.md)
3. Source confirmed → regenerate 2-3 alternatives → re-dispatch to examiner
4. Source unconfirmed (all 4 Stages exhausted) → generate best revision with current sources → confirm user opt-out
5. Repeat until APPROVE or user opt-out

NEVER enter Phase 9 while ANY item remains in REQUEST_CHANGES status.
Phase 9 entry is permitted ONLY when ALL Verdict Tracker items are APPROVE or user-opt-out.
</critical>

### Examiner Eligibility

Items containing a technical claim or problem-solving process → eligible. No exceptions.

| Section | Eligible? |
|---------|:---------:|
| Self-Introduction Type A | YES if technical claim present |
| Self-Introduction Type B | YES if technical episode present |
| Self-Introduction Type C | Always YES |
| Self-Introduction Type D | YES if technical exploration present |
| Career bullet | Always YES |
| Problem-Solving (5-line+) | Always YES |
| Tech/Study | NO |

### Dispatch Format

When sending to resume-claim-examiner, use exactly:

```
# Technical Evaluation Request

## Candidate Profile
- Experience: {years} years
- Position: {position}
- Target Company/Role: {company} / {role}

## Bullet Under Review
- Section: {Career > Company A | Problem-Solving > Entry Title | Self-Introduction Type C}
- Original: "{original text that was the subject of Evaluation Phase findings}"

## Technical Context
- Technologies/approaches mentioned in this bullet: {identified directly from bullet text}
- JD-related keywords: {relevant JD keywords obtained in Phase 1}
- Evaluation Phase findings: {verbatim P0/P1/P2 findings for this bullet}

## Target Company Context (if available)
- Company: {company name}
- Scale indicators: {TPS, DAU, data volume, etc.}
- Engineering team size: {if identified}
- Core values / engineering principles: {researched in Phase 1}
- Key technical challenges: {from JD analysis and tech blog}
- If unavailable: "No specific target — evaluate against big tech standards"

## Proposed Alternatives (2-3)
{alternatives generated per content-quality-gate.md §3 protocol}
```

**Reference:** Read `references/content-quality-gate.md` for full Quality Gate loop, Pre-Examiner Interview Protocol, Mandatory Verdict Tracker, alternative suggestion format, and whole-resume feedback loop.

### Phase 8 Red Flags — STOP When You Think This

| Rationalization | Reality |
|-----------------|---------|
| "Summarized results and presented strategic options, so Phase 8 is done" | Summary ≠ resolution. REQUEST_CHANGES = unresolved. Keep looping. |
| "All 5 got REQUEST_CHANGES, so reflect them in the report at once" | Each item must go through its own loop. No batch report reflection. |
| "Wait for user to choose a strategic option, then apply" | Start interview immediately after presenting options. Don't wait for selection. |
| "Can proceed without Verdict Tracker" | Entering Phase 9 without confirming all Tracker items are APPROVE/opt-out = protocol violation. |

`[Phase 8/9: Per-Bullet Content Quality Gate ✓]`

### Strategic Options

Before generating the HTML report, present 2-3 strategic improvement options to the user. Each option should describe:
- Direction (e.g., "JD 키워드 최적화", "depth 강화", "theme 다각화")
- Trade-off (time investment vs impact)
- Which findings it addresses

This is NOT optional — every review must end with actionable strategic options before the final report.

## Discovered Candidates Working Set

Experiences discovered during interviews are added to the Working Set immediately. The Working Set is a session-scoped temporary store and is permanently saved to the note system in Phase 9.

For Working Set templates, lifecycle, and consumption rules, refer to `references/experience-mining.md` § "Discovered Candidates Working Set".

---

## Phase 9: 결과 전달

### HTML Report Generation

Compile all Evaluation Phase results and write a self-contained HTML file. This is the **only phase that produces the final comprehensive evaluation report**. Generate the file, open it, and wait for user approval.

**Template:** Read `references/html-template.html` for the HTML skeleton template.

**File Path:**
```
HTML_FILE="${OMT_DIR:-$HOME/.omt/global}/reports/review-YYYYMMDD-HHmmss.html"
```
- Run `mkdir -p "$(dirname "$HTML_FILE")"` before writing.
- After writing, run `open "$HTML_FILE"` via Bash tool.
- Terminal output: print file path only.

**HTML Escaping:** Before inserting resume text: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`.

**Priority Level Definitions:**

| Level | Meaning | Criteria |
|-------|---------|----------|
| **P0** | Must Fix | Breaks immediately in interview — no achievement, no causation, industry standard as achievement, cross-section inconsistency |
| **P1** | Recommended Fix | Exposes weakness in interview — incomplete metrics, unclear role, insufficient depth, AI tone detected |
| **P2** | Can Improve | Can be made better — expression improvement, JD keyword addition, reordering, hook potential |
| **P3** | Reference | Style preference — tone, formatting, minor expression differences |

**Strength Comment:** Per career bullet or problem-solving entry, only items that PASS all 6 section evaluation criteria get `.comment-strength`.

### Approval Gate

<critical>
Open the HTML report and ask the user to review it. Do not proceed to any next step until the user explicitly declares "no feedback." This rule applies even when called from within a resume-apply workflow.
</critical>

After opening the report, use `AskUserQuestion` to collect feedback. Ambiguous responses → re-ask. Section-specific feedback → re-enter Phase 8 for that section. Apply feedback → regenerate HTML → loop until explicit "no feedback."

### Note Accumulate

After user approval, accumulate insights into persistent note. Show accumulation summary (`+` new, `~` updated, for all categories) and wait for `y/n` confirmation before writing files.

Accumulate: new candidates from interviews, updated expressions, tone/judgment preferences, company research cache.

**Reference:** Read `references/note-system.md` § "Note Accumulate" for full accumulation rules.

`[Phase 9/9: 결과 전달 ✓]`

## Completion Checklist (Internal)

Before delivering Phase 9 output, verify every phase was completed or has a valid skip reason:

```
[Review Completion Checklist — INTERNAL]
- [ ] Phase 1: 사전 준비 (Note Load + Pre-Evaluation Research)
- [ ] Phase 2: 자기소개 평가 (per-type + global + Type C sub-step)
- [ ] Phase 2: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 3: 개발자 역량 평가 (C1-C5)
- [ ] Phase 3: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 4: 섹션별 평가 (Career + Problem-Solving 6 criteria + Pushback)
- [ ] Phase 4: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 5: First-Page Primacy + JD 매칭
- [ ] Phase 5: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 6: 문제해결 심화평가 (P.A.R. + T1-T3 + Entanglement)
- [ ] Phase 6: Experience Mining Interview (DONE/SKIPPED/N/A)
- [ ] Phase 7: AI 톤 감사 (MUST invoke Skill(humanizer) — manual scan ≠ DONE)
- [ ] Phase 8: Per-Bullet Content Quality Gate (resume-claim-examiner APPROVE or user opt-out per unit)
- [ ] Phase 9: HTML Report + User Approval Gate (infinite loop until feedback reaches 0)
- [ ] Phase 9: Note Accumulate (user confirmation required)
```

A phase is SKIPPED only when its precondition is not met. Phases 1, 7, 8, 9 have NO precondition — always required. Note Accumulate has a strict precondition: User Approval in Phase 9 HTML gate. Note Accumulate counts as DONE even if the user declines to save.
