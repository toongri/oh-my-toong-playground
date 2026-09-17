---
name: technical-copywriting
description: Use when reviewing teaser/promotion text for sharing technical blog posts. Triggers include "티저 리뷰", "포스트 공유", "copywriting review", "teaser review", "promotion text", "LinkedIn post review"
---

# Technical Copywriting Review

Reviews teaser/promotion text that accompanies technical blog post shares. 3-phase sequential review: Type Classification → Structure Review → Voice & Authenticity.

## The Iron Law

- Perform all 3 Review Areas in order. Do not skip any Area.
- After completing each Area, present review results to the user and get approval.
- All principles are recommendations. Apply flexibly based on context.

## Non-Negotiable Rules

| Rule | Description |
|------|-------------|
| Sequential Execution | Type → Structure → Voice order |
| Per-Area Approval | User confirmation after each Area |
| Before/After | All improvement suggestions in Before/After format |
| Cite Principle | Each suggestion must cite its principle ID (CP1~CP15) |

## Review Areas

```dot
digraph review_flow {
    rankdir=LR;
    node [shape=box];

    "Input Text" -> "Area 1:\nType Classification";
    "Area 1:\nType Classification" -> "Area 2:\nStructure Review";
    "Area 2:\nStructure Review" -> "Area 3:\nVoice & Authenticity";
    "Area 3:\nVoice & Authenticity" -> "Review Complete";
}
```

### Area 1: Type Classification

- **Reviews**: Teaser type classification, required elements verification per type, platform constraint compliance
- **Enter when**: Review target text exists
- **Skip when**: User already specified type and requested no type verification
- **Reference**: `references/type.md`

### Area 2: Structure Review

- **Reviews**: Type-specific opening, value delivery mode, closing pattern, proportion balance
- **Enter when**: Area 1 completed
- **Skip when**: Only voice-level review requested
- **Reference**: `references/structure.md`

### Area 3: Voice & Authenticity Review

- **Reviews**: Developer authenticity, anti-marketing-speak, platform tone, reader connection, Korean naturalness
- **Enter when**: Area 2 completed (or Area 1 if Area 2 skipped)
- **Skip when**: Only structure-level review requested
- **Reference**: `references/voice.md`

## Review Output Format

Each Area's review results use this format:

```markdown
## Area N: {Area Name} Review

### Summary
- 총 {N}건의 개선 제안
- 심각도: Critical {N} / Suggestion {N}

### Findings

#### Finding 1: {Title}
- **원칙**: {Principle ID} - {Principle name}
- **심각도**: Critical / Suggestion
- **Before**:
  > {Original text}
- **After**:
  > {Improved text}
- **근거**: {Why this change is needed}
```

**Severity criteria:**
- **Critical**: Type mismatch (e.g. Learning Journey structure applied to Announcement), missing required elements for the identified type, platform constraint violations
- **Suggestion**: Tone adjustment, proportion optimization, minor structural improvement

## Area Completion Protocol

After completing each Area:
1. Present review results in Review Output Format
2. Ask user: "Area N 리뷰 결과를 확인해주세요. 다음 Area로 진행할까요?"
3. Proceed to next Area after user approval

## Review Completion

After all 3 Areas are complete:
1. Present overall review summary (finding count per Area, Critical/Suggestion ratio)
2. Priority-ordered improvement list (Critical → Suggestion)
3. Generate improved full teaser text upon user request

## Completion gate — required deliverable

Do NOT report this work as done until the deliverable below exists. If it is missing or incomplete, you MUST, in order:

1. **Study the guideline** — read the reference that governs the deliverable before producing it.
2. **Produce** the deliverable exactly per that guideline.
3. **Deliver** it to its stated path.

| Deliverable | Guideline to study | Delivered to |
|---|---|---|
| The completed 3-Area review (Before/After findings cited to a principle ID, per Review Output Format), and the improved full teaser text when the user requests it | SKILL.md's 3-area protocol (Iron Law + Non-Negotiable Rules) and each Area's own reference (`references/type.md`, `references/structure.md`, `references/voice.md`) | Presented to the user in the conversation, in Korean |

A "done" claim with an Area skipped, a finding missing its Before/After or principle citation, or (when requested) no improved teaser text produced is a failed completion, not a shortcut: study the guideline, produce the deliverable, then finish.

## Language

- Review results are written in Korean
- Principle IDs remain in English codes (CP1, CP2, etc.)
- Before/After examples maintain the original language
