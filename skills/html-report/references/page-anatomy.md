# Page anatomy: section order per page kind

This file holds the full body of [section 2 (Page anatomy)](../SKILL.md#2-page-anatomy) of SKILL.md.

Every page puts the answer before the evidence: the first screen states what happened, what was
decided, or what the reader must do. Then the detail follows. The skeletons below list section
*types*, in order. Optional sections are marked. The caller fills the content.

**Incident or finding report**

1. Masthead: status pill (for example "26대 고착 지속"), page type, and the event date with timezone when the source gives one. No writing date of your own.
2. Cause and action in two short paragraphs.
3. Impact: stat tiles or a to-scale bar, each number with its scope ("전체 약 1,620대 중 41대").
4. Symptoms and why each happens: a two-column row list.
5. The normal mechanism (figure).
6. The broken mechanism, drawn on the same layout as the normal one (figure).
7. How the failure formed: numbered steps (a real sequence).
8. Timeline of one representative case, with timezone.
9. Verified versus not verified: two panels.
10. The fix, with an "after" figure on the same layout. Optional: what does not change.
11. Rollout or next steps. Optional: reproduction plan.
12. Sources footer.

**Design document**

1. Masthead and one-paragraph summary of the design.
2. Goal and principles (write a motivating number in a sentence, not a stat tile).
3. The main map: architecture or state machine, optionally with a scenario selector ([section 10](../SKILL.md#10-interaction-patterns)).
4. Decision tables, one per gate or rule.
5. Rationale callouts for choices a reviewer would question.
6. Open questions. Optional: out of scope.

**Plan**

1. Goal and success criteria (checkable).
2. Current versus target (before/after figure, only if the structure changes).
3. Work breakdown: ordered list, or a CSS timeline when dates matter.
4. Dependencies: a figure only when they are not a straight line.
5. Risks table: risk, impact, mitigation.
6. Verification: how each success criterion is checked.
7. Not in this plan.

**Diff explainer**

1. What changed, in one sentence, and why (the problem before the change).
2. Before/after mechanism figure on one layout.
3. One chapter per capability (use case): behavior, the code path it takes, the key excerpt.
4. Edge cases and risks.
5. How it was verified. The caller adds its own sections (for example a quiz).

**Research report**

1. The question and the bottom-line answer.
2. Confidence summary: what is established, what is contested, what is unknown.
3. Findings, each with claim, evidence, sources, and status.
4. Comparison table or matrix.
5. Figures only for mechanisms or structural comparisons.
6. Contradictions and open questions.
7. Method and source list.
