# explain-diff unified rubric

These 19 items are used as **one and the same set** in three places — per-step section judgment, the basis for generating quiz questions, and the RED/GREEN artifact comparison. If the three places hold different standards, "passed the gate" and "is a good document" split apart, and from then on the gate is a pass-through ritual.

The items are **split three ways by who decides**. Absence is counted by the script, existence is proven by the judge with a quote, and pure judgment is kept minimal. Reducing the very surface on which the judge can exercise discretion is the purpose of the split.

## Grounds

The `RED` values for R1–R8 are 16 measured runs: no-guidance and gist-source, two controls × 4 fixtures × Claude/Codex (`$OMT_DIR/explain-diff-eval/probe.ts`). The `RED` values for R9–R12 are measured on 13 documents actually produced by the pre-v3 skill (10 fixtures + 2 real + 1 codex terra). No item is written from a guess. v3 GREEN: the revised skill × codex (gpt-5.6-terra, high) × 4 fixtures passed the full-step structure check + mermaid render parity 4/4 — including a full hash comparison of a 23-commit merge PR.

The `RED` for R13 and R14 is measured on a v3 artifact (the document for the real 21-commit PR `b2c-6106`): the code section was separated from the commit narrative so files sat stranded, the file fields clumped into a single paragraph, and the system level ended with one box-and-arrow diagram, never enumerating which API, schema, or client contracts change.

## When each is evaluated

The document is written one step at a time, accumulating. So an item is evaluated only in the step that fills its slot — an earlier step does not demand the slot of a step not yet written.

| Item | Decider | Step evaluated |
|---|---|---|
| R1 (listing form) | script | evidence |
| R1 (coverage form) | script | code |
| R2 | script | code |
| R3 | script | code |
| R4 | script | background |
| R5 | script | code |
| R6 | judge | intuition |
| R7 | judge | code |
| R8 | pure judgment | quiz (when composing the question bank) |
| R9 | script | architecture |
| R10 | script | commits |
| R11 | script | every authoring step (whole accumulated document) |
| R12 | judge | architecture |
| R13 | script | code |
| R14 | script | architecture |
| R15 | script | architecture |
| R16 | script | goal |
| R17 | script | architecture |
| R18 | script | architecture |
| R19 | script | architecture |

The `intuition` step has no slot of its own — only R6 (judge) and the common R11 decide it. `render` and `quiz` score none of this table's items: `render` looks at the artifact check (HTML present and non-empty, mermaid→SVG parity, visual-qa `VERDICT: PASS`, technical-writing `REVIEW: APPLIED`), and `quiz` runs a separate grading path (`grade`).

---

## A. Script decides — absence check

Absence is machine-countable, and handing a countable thing to a person or a model makes it wobble.

### R1. Every signal file appears

Not one file classified as signal is dropped. The required form differs at the two points where the document accumulates.

- **Listing form (evidence step)** — Change Groups are not written yet, so the file path merely needs to
  appear somewhere in the document.
- **Coverage form (code step)** — each signal file must have **exactly one** file block (`#### \`path\``).
  Zero means it never entered a group; two or more means the same file appears in multiple groups —
  both fail. (A file block is h4 — an h3 `### \`hash\`` is a commit subsection.)

Decided by comparing the `git diff --name-only` list against the document.

> **RED 10/16.** Mostly upheld in small fixtures, but **all 4 runs failed** on a giant PR
> (18 / 19 / 11 / 7 of 29). This is exactly where files silently vanish.

### R2. Change Group structure

Each Change Group fills all three slots — ① title ② one sentence of advance herald ③ one line of order rationale. Only slot presence is checked — content quality is judged in R7.

> **RED 0/16.** No control produced a named change group. Even though the gist demanded "Group/order the
> changes in an understandable way", it failed 8/8. It means an arrangement requested in prose does not
> land as structure, which is why this item is forced by slots.

### R3. Provenance on the "왜"

Each file block's 왜 field (`<p><strong>왜</strong>…`) carries a `cf-src` provenance tag — the badge text is one of three: `근거` (followed by a verbatim quote), `추론` (followed by the inference's ground), or `Unknown / not supplied`. Because the 왜 field is read only after stripping the code fence, a `[근거:]` inside a code comment cannot stand in for it. If none of the three is present, it is judged fabricated and failed.

> **RED 1/16 (`Unknown` class), 0/16 (`[추론:]` label).** The reality matters more than the number.
> `claude/naive/coordinate-render` wrote, in bold assertion, **"the issue where there was vertical scroll
> but no horizontal scroll is #5830".** The worktree has no body for #5830 (two commits reference only the
> number). The inference itself is reasonable, but it was presented as fact with neither a ground marker
> nor an unknown marker.
>
> The opposite direction was also measured. The "왜" claim of `codex/naive/giant-pr` had a real ground in a
> diff comment (`Detached workers can still be in their queued startup window after stop`). So this item is
> not "don't explain why" but **"mark the provenance".**

### R4. Two-tier Background + skip marker

Both a deep background and a narrow background are present, and the deep background carries a skip marker.

> **RED 8/16 — gist 8/8, no-guidance 0/8.** The gist's guidance here **works completely**. This item is not
> newly created; it fixes something that already works as a structure slot to prevent regression.

### R5. Traceability

Each file block points at the before-location and after-location in the `cf-loc` slot in the form `base:file:line` → `head:file:line` — the location anchors are pulled out of the prose. The gate asks only that both `base:` and `head:` anchors be present (an added file needs only `head:`); the exact `path:line` precision and the deletion/new-file wording are the author's to fill.
But a file the diff **newly added** has no prior location to point at, so only the `head:` anchor is required. New-ness comes from `A` in `git diff --name-status`, not from the document's narrative — deciding by sentence would let an author be exempted from the base anchor merely by writing "new file".

> **RED 10/16.** 6 have not a single `file:line`. In particular 3 codex no-guidance and 2 claude gist are at
> zero — independent of document length (even a 50KB document has zeros).
>
> **Corrected by the 8-GREEN observation.** The first edition required both base+head on every file. The two
> GREEN runs caught by the structure check were both this item, and among the failing files the newly added
> ones were a demand no honest author could satisfy. The remaining failures of those same two runs (a missing
> base anchor on a modified file) still catch after the correction — a real omission the gate should catch.

### R9. Three architecture levels

Under `## Architecture`, `### 시스템 레벨`, `### 컴포넌트 레벨`, and `### 도메인 레벨` are all present, and each level has a mermaid diagram or a reasoned waiver marker (`구조 변화 없음: <사유>`). The question each level answers and the recommended diagram type are defined by `markdown-template.md`.

> **RED 0/12.** None of the 12 documents produced by the pre-v3 skill (10 fixtures + 2 real) has an
> architecture-level view anywhere. Structural facts ("Node/Python read the same PostgreSQL") existed only as
> sentences in Background prose — the same pattern as R2, that a prose request does not land as structure.

### R10. Commit Journey overview

If the range has two or more commits, the `## Commit Journey` overview body has each commit's hash (7 chars). This clause is a one-line map showing which group each commit is sent to, and the deep per-commit code is written inside the Change Group (R13). A single-commit range may be replaced by the `단일 커밋 범위 — Commit Journey 생략` marker. The hash list uses what `start` pinned into the state — the source is `git rev-list`, not the document's claim.

> **RED 0/12 (as a guarantee).** One real v1 document made a Commit Journey **on its own** and readers rated
> it well, but the skill did not require it, so it was demoted to a subsection in v2 and is absent entirely
> from the 10 fixtures. What was good was accidental — it reproduces only when fixed as a slot.

### R11. No style invention

Nowhere in the document is there a `<style>` block or an inline `style=` attribute, and `class=` uses only the sanctioned list (the components in `markdown-template.md`). The whole accumulated document is checked at every authoring step — a violation is rejected immediately in the step that created it.

> **RED 11/12.** Each document invented 3–78 inline style attributes of its own, and the 2 real documents
> hand-wrote different `<style>` blocks (27 lines / 30 lines). This is exactly why two artifacts of the same
> skill look like they were made with different tools. The visual language is owned by render.ts alone, and
> the author is left only components.

### R13. Commit spine + core-logic code

The code section is organized with the commit as its spine. Each Change Group has at least one commit subsection (`### \`hash\``) carrying a valid range hash, and each file block has one core-logic code fence — a mermaid-only or empty fence does not count (the template reserves mermaid for diagrams and requires real code/pseudocode per file). The gate forces this coarse spine — a commit subsection per group and a code fence per file; how the file blocks nest under commits and which cf fields each carries is the author's to fill from the template, not machine-forced. Hash validity is compared against the list `start` pinned — if enumeration failed and the list is empty, the validity check is skipped ("git failed" is not "every hash is fake").

> **RED — v3 artifact.** In the `b2c-6106` document, `## Commit Journey` (21 commits) and `## Change Group`
> (per file) were fully separated, so commits were listed unrelated to the code explanation. File blocks
> pointed only at location anchors and showed not one line of the actual logic. Making the commit the group's
> spine and requiring code per file joins the two.

### R14. Three system-level change-contract axes

`### 시스템 레벨`, beyond the diagram (or waiver marker), enumerates the contracts this diff changes across three axes — `서버 API`, `DB 스키마`, `클라이언트 의존`. All three axis labels must be present. The table must be **real rendered content**: fenced code is masked before the axes are scanned, so a contract table that appears only inside a fenced example (the template ships one) does not satisfy R14. What each axis says about its contract is the author's to fill.

> **RED — v3 artifact.** The `b2c-6106` system level ended with one box-and-arrow flowchart. How the API
> surface of the three server contracts (cost, program doses, intake history) changes, how the join changes,
> and what the chat client must match were not enumerated in a table, so the "system-unit" explanation was
> thin.

### R15. Boundary / dependency / use-case change map

The Architecture section closes with a `### 경계·의존·유스케이스` block that is a **change map**, not a static layer-classification table. Read on the `### 경계·의존·유스케이스` sub-slice with fences masked, three markers must be present: `영향 인터페이스` (each behaviour unit names the interface it affected), `의존 방향` (the unidirectional-dependency verdict), and a unit-level `data-change` (the change kind on the `arch-entity` units). What each says is the author's to fill; the gate forces the slots present. The vocabulary follows the `architecture-boundaries` rule but the output speaks the codebase's own terms (enforced by R19).

> **RED — the v4 static table.** The earlier R15 forced a `파트/레이어/협력자/영향·수정` classification table
> with a binary `수직 도메인 / 수평 유스케이스` layer choice. On an FSD codebase this miscategorised parts that
> are neither a clean vertical domain nor a horizontal use-case: a `resolver` (an `entities/lib` module) and a
> `census` (a standalone backend CLI) were both forced into "수평 유스케이스", and the table answered "what
> exists" rather than "what this diff did to the boundary". The rewrite drops the static classification: each
> behaviour unit is an `arch-entity` carrying its change kind and affected interface, closed by the direction
> verdict — the same "change contract, not inventory" shape that made R14 work.

### R17. System-level standing-interface table

The 시스템 레벨, beyond the R14 change-contract table, carries a standing-interface table naming which boundary communicates over which endpoint/query/screen-URL and what flows. Read on the 시스템 레벨 slice with fences masked, three column labels must be present: `경계`, `인터페이스`, `오가는 것`. This is distinct from R14 in layer — R14 enumerates what this diff *changes*, R17 the *standing* interface the diagram's short-protocol edges leave implicit. What each row says is the author's to fill.

> **RED — real artifact (`b2c-6105`).** The system diagram was `browser --> backend --> db` with every edge
> unlabelled, and it *omitted* the Python health-profile API and the census→DB boundary that the prose itself
> named — so "which entrance do they talk through" was answerable only by hunting the prose. Putting the
> interface on the edge as a label was rejected in the interview (long endpoint/query strings blow the 12-node
> layout); the table carries it instead, and the diagram keeps short-protocol edges.

### R18. Component-level node cards

The 컴포넌트 레벨, beyond the dependency graph, decodes each changed behaviour node with an `arch-entity` card. Read on the 컴포넌트 레벨 slice with fences masked, the labels `레이어`, `책임`, `인터페이스` plus `arch-entity` and `data-change` must be present. Pure data/contract-type nodes stay diagram-only; only behaviour-bearing nodes get a card.

> **RED — real artifact (`b2c-6105`).** The component level was a bare chain of class/function names —
> `CurrentBoostPackInfoCard`, `useBoostPackSupplementCatalogResolvers` — with no responsibility, interface, or
> layer anywhere, so a reader could not tell what any node *does*. The system level had gained a companion
> table (R14); the component level had no counterpart, an asymmetry R18 closes.

### R19. No methodology name in Architecture prose

The Architecture section's prose speaks the codebase's own domain terms — no methodology proper name leaks in. Read on the fence-masked `## Architecture` section, none of these tokens may appear (case-insensitive): `FSD`, `Feature-Sliced`, `Clean Architecture`, `Clean-arch`, `DDD`, `Domain-Driven`, `bounded context`. The plain words `유스케이스`/`도메인` are legitimate (the block heading uses them); only framework names are banned. The boundary vocabulary still follows the `architecture-boundaries` rule — this forbids naming the *methodology*, not thinking in its axes.

> **RED — interview requirement.** The user asked that the boundary block think in the two axes but never surface
> the framework names in the output ("이게 프롬프트에 굳이 드러나진 않았으면 좋겠어"). A literal token scan is
> the precise, cheap enforcement — the names are proper nouns, so a grep catches them without judge discretion.

### R16. Goal / core-message beat

Between Background and Architecture the document carries a `## 목표` section with both sub-slots — `### 무엇을·왜` (what the change achieves + why it was needed) and `### 핵심` (the one-line core the reader should hold before any code). Read on the fence-masked text so a `###` inside a code example does not stand in for the real slot. What each slot says is the author's to fill; the gate forces the two slots present.

> **RED — real artifact (`boostpack-tool-helper-restore`).** The document ran Evidence → Background →
> Architecture with no statement anywhere of what the change was for or its one-line takeaway. The "왜"
> existed only as per-file fields at the bottom of the code section, after all the mechanism, so a reader hit
> the architecture (and a mislabeled one — see R12) before ever learning the point. The original explain-diff
> talk lists "커밋 목표 및 핵심 전달" — state the goal before the code, like a math teacher — as a first-class
> document component; the pre-R16 skill had dropped it. Same pattern as R2/R9/R14: a beat requested in prose
> does not land, so it is forced as a slot.

---

## B. Judge decides — existence check + quote required

Here the judge does not ask "is it good". It asks **"is it in the document"**, and if it is, must produce an excerpt copied verbatim from the document. A pass without a quote is auto-failed, and a quote that does not exist as a string in the document is auto-failed too. Those two checks close the room for the judge to fabricate.

### R6. Intuition's concrete example

A toy data value actually appears, and that value is reused in the explaining prose.
The judge quotes both the literal value that appeared and the sentence that uses it.

### R7. Coherence of group order

Group N's advance herald presupposes group N-1. The judge quotes the passage where that premise shows. If it cannot be quoted, the order has no ground, and an order with no ground is a list.

### R12. The architecture diagram's correspondence to the diff

The Architecture diagram's node/edge labels are real identifiers of the actual system (service, module, command, entity names) — not invented generic nouns, though context nodes the diff does not change are allowed — and at least one level has a change marker (`:::changed` or Before/After contrast) pointing at what this diff changed. For the 시스템 레벨 specifically, its nodes must be **distinct processes/services/deployables/stores**: an in-process call chain (functions or modules within one runtime) drawn as the system level is mislabeled and fails, because it presents component/domain structure as a system boundary. The 시스템 레벨 must also be **complete** — every distinct process/service/store the Evidence or Background prose names as involved must appear as a node; a process the prose names but the diagram omits (a separate API, a CLI) is a fail. The judge quotes both the diagram's labels and the body/Evidence sentence where those identifiers appear, plus the change marker. R9 counts "is there a picture", and R12 looks at "is that picture this diff's picture, at the right level" — the structure check can only count the presence of a mermaid fence, so correspondence and leveling are left to the quote-based judgment.

> **RED — real artifact (`boostpack-tool-helper-restore`).** A 14-line test-only diff whose R14 contract table
> declared all three axes "변경 없음" still drew a 시스템 레벨 diagram of `test → helper → tool → api → server` —
> an in-process call chain (only the mocked, unchanged `server` is a real other process) presented as the
> system level. The picture had a change marker, so pre-R12-tightening it passed; the leveling error — an
> in-process chain labeled 시스템 — is what the sharpened R12 catches.

---

## C. Pure judgment — minimal

Only what cannot be narrowed by machine or by quote is left. When the items grow, convert them into a manipulable form.

### R8. Quiz question discrimination

Each question requires two or more rubric items, at least one of which is a concrete value unknowable without reading the document (identifier, coordinate, condition, order). Within the same concept, questions do not overlap in required rubric.

> **Note — the controls' quiz form.** The gist control makes multiple-choice questions that show the options
> (`<div class="q" data-answer="1">` form). The moment options are visible, what is measured drops from recall
> to recognition. That is why this skill uses open-ended answers, and R8 looks at whether that open-ended form
> actually discriminates.
