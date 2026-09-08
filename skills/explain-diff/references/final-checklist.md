# Final self-review checklist — after render, before quiz

After producing the Markdown and HTML, grade yourself on the nine axes below before
handing the document to the reader. Grade each axis **PASS / N.A / FAIL**; for PASS and N.A,
write one line of evidence (a document line/section quote or the reason it does not apply).
If any axis is FAIL, fix the document, run render again, and regrade from the beginning —
there is no path to the quiz while a FAIL remains.

Save the result beside the document as `<slug>-final-checklist.md`. The last line must be
`CHECKLIST: ALL PASS` (N.A is allowed; this line cannot be written while any FAIL remains).

| # | Axis | PASS criteria |
|---|---|---|
| 1 | System decomposition | The system-level diagram separates involved systems with subgraph boundaries and names each system's relevant core resources (modules, tables, keys) inside its subgraph. Show at least two resources when two or more are relevant; a subgraph with exactly one is allowed only when the document explains why there is only one. Edges between systems are labeled with the contract (protocol + what flows). |
| 2 | Both-sides coverage | If the diff spans two or more processes (such as client + server), component, domain, and logic explanations cover both sides in their respective architecture vocabulary. N.A if the diff changes only one process. |
| 3 | Goal→diagram→interpretation | Every mermaid diagram has one sentence before it stating a concrete goal the picture lets the reader verify, and structural observations after it grounded in the edges/nodes actually drawn. Generic statements such as "이 그림은 흐름을 보여준다" are FAIL. |
| 4 | State diagram | If a touched concept has a lifecycle (3+ states or named transitions such as lock, expire, or confirm), a stateDiagram-v2 is present with transition triggers labeled. N.A only if there truly is no lifecycle (state the reason). |
| 5 | Logic flowchart | Changed logic with 3+ branches (including error and edge paths) is shown as a flowchart. N.A if no such logic exists. |
| 6 | Real identifiers + change markers | Nodes, participants, and labels are real codebase identifiers, and elements changed by this diff have markers appropriate to the diagram type (`:::changed`/`classDef changed`, or a `Note` identifying the changed step in `sequenceDiagram`). Generic nodes ("service→DB") are FAIL. |
| 7 | Sequence completeness | Synchronous calls in sequenceDiagram have balanced activation (+)/return (−) pairs, and messages without returns are explicitly async (`-)`). |
| 8 | User journey | If the diff touches a user-facing surface (screen, input, display, notification, entry point), the boundary block has a journey flowchart from the user's first action through actual branches to what they finally see. If there is no user-facing surface, quote the reasoned waiver sentence in the boundary block and mark N.A. |
| 9 | HTML render | render.ts exited with 0, and the HTML was regenerated from the current Markdown (rerender after Markdown edits). |

Axis 8 can be N.A only when the waiver sentence actually exists in the document — a reason
written only in the checklist, with no waiver in the document, is FAIL.

<!-- lazy: Instruction-level checklist. If an axis repeatedly slips through, the upgrade path is
     promotion to an R-item in rubric.md plus validation in the structure-check script. -->
