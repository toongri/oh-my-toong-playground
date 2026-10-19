# Final self-review checklist — after render, before quiz

After producing the Markdown and HTML, grade yourself on the ten axes below before
handing the document to the reader. Grade each axis **PASS / N.A / FAIL**; for PASS and N.A,
write one line of evidence (a document line/section quote or the reason it does not apply).
If any axis is FAIL, fix the document, run render again, and regrade from the beginning —
there is no path to the quiz while a FAIL remains.

Save the result beside the document as `<slug>-final-checklist.md`. The last line must be
`CHECKLIST: ALL PASS` (N.A is allowed; this line cannot be written while any FAIL remains).

| # | Axis | PASS criteria |
|---|---|---|
| 1 | System decomposition | The system-level diagram separates involved systems with container boundaries (`group` rects) and names each system's relevant core resources (modules, tables, keys) inside its container. Show at least two resources when two or more are relevant; a container with exactly one is allowed only when the document explains why there is only one. Edges between systems are labeled with the contract (protocol + what flows). |
| 2 | Both-sides coverage | If the diff spans two or more processes (such as client + server), component, domain, and logic explanations cover both sides in their respective architecture vocabulary. N.A if the diff changes only one process. |
| 3 | Goal→diagram→interpretation | Every diagram figure has one sentence before it stating a concrete goal the picture lets the reader verify, and structural observations after it grounded in the edges/nodes actually drawn. Generic statements such as "이 그림은 흐름을 보여준다" are FAIL. |
| 4 | State diagram | If a touched concept has a lifecycle (3+ states or named transitions such as lock, expire, or confirm), a `data-kind="state"` figure is present with transition triggers labeled. N.A only if there truly is no lifecycle (state the reason). |
| 5 | Logic flow figure | Changed logic with 3+ branches (including error and edge paths) is shown as a `data-kind="flow"` figure. N.A if no such logic exists. |
| 6 | Real identifiers + change markers | Nodes, participants, and labels are real codebase identifiers, and elements changed by this diff carry the class `focal` (and a `←변경` label where a quote needs it), and the caption says what the marker means. Generic nodes ("service→DB") are FAIL. |
| 7 | Sequence completeness | Every `data-kind="sequence"` figure draws activation bars for the actors that are busy, a dashed return for each synchronous call, and shows messages without returns as dashed open-head events. |
| 8 | User journey | If the diff touches a user-facing surface (screen, input, display, notification, entry point), the relevant `## 기능 단위` capability chapter carries a journey flow figure from the user's first action through actual branches to what they finally see (alongside or in place of its sequence flow). If there is no user-facing surface, quote the reasoned waiver sentence (the chapter's or the section-level `구조 변화 없음`) and mark N.A. |
| 9 | HTML render | render.ts exited with 0, the HTML was regenerated from the current Markdown (rerender after Markdown edits), and the html-report `lint.sh` run on that HTML reports 0 errors. |
| 10 | 쓰기 전에 소개 (introduce before you use) | Every first-class entity the document leans on is introduced at first use, sized to its kind — a coined term/status label (한 줄 뜻), a function/repository symbol (한 줄 역할), a module/domain (경계+소유), a feature (기능 단위 챕터). Each diagram's code-name node/message is decoded either by an `arch-entity` card (R18/R21) or by a `<ul class="gloss">` "이 그림의 요소" footnote directly under it; a node already labeled in plain language (`catalog`) needs none. Quote one such introduced entity; FAIL if any leaned-on entity is used with no introduction before that use. |

Axis 8 can be N.A only when the waiver sentence actually exists in the document — a reason
written only in the checklist, with no waiver in the document, is FAIL. Axis 10 has no N.A —
a document always leans on at least one entity a no-context reader must have introduced.

<!-- lazy: Instruction-level checklist. If an axis repeatedly slips through, the upgrade path is
     promotion to an R-item in rubric.md plus validation in the structure-check script. -->
