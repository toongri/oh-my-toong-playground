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
| R21 | script | architecture |
| R22 | script | code |

The `intuition` step has no slot of its own — only R6 (judge) and the common R11 decide it. `render` and `quiz` score none of this table's items: `render` looks at the artifact check (HTML present and non-empty, mermaid→SVG parity, technical-writing `REVIEW: APPLIED`, final checklist ending with `CHECKLIST: ALL PASS`), and `quiz` runs a separate grading path (`grade`). Visual layout is not scored per document — it is a deterministic property render.ts owns (wide-diagram legibility is sealed by `normalizeSvgWidth` + the figure scroll container, regression-guarded by `render.test.ts`), so there is no visual-qa gate.

---

## A. Script decides — absence check

Absence is machine-countable, and handing a countable thing to a person or a model makes it wobble.

### R1. Every signal file appears

Not one file classified as signal is dropped. The required form differs at the two points where the document accumulates.

- **Listing form (evidence step)** — Change Groups are not written yet, so the file path merely needs to
  appear somewhere in the document.
- **Source sweep (evidence step)** — `## Evidence` must contain a **real rendered Markdown table** under
  the real `### 원천` heading. Its header has exactly four columns — `종류 | 식별자/경로 | 확보 | 내용 요약` —
  followed by the four-column separator `|---|---|---|---|` and at least one non-empty, non-separator data row. A fenced or
  comment-hidden heading/table/row, a header/separator-only table, or a malformed header/separator/data row
  does not count; fenced content is masked before the structure check scans it.
- **Coverage form (code step)** — the unit is the change, not the file, so each signal file must be
  **cited by at least one change block's `바뀐 위치` (cf-loc) anchors**. Zero citations means the
  walkthrough silently dropped that file — fail. A file cited by several changes is fine (one file
  often participates in several responsibilities), so there is no exactly-once rule.

Decided by comparing the `git diff --name-only` list against the anchor paths cited in the document.

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

At `start`, the CLI passes the original range unchanged to `git diff` when it captures unified-diff
hunk metadata, preserving `A...B` merge-base semantics. Only `git rev-list` commit enumeration
normalizes `A...B` to `A..B`. At the `code` submission, R5 gathers every `base:path:line` /
`head:path:line` anchor across all change blocks, keys them by their own cited path, and checks **per
signal file** that its before and after are cited and land in real hunks. If a signal file has no
textual hunk while another does, it uses the legacy presence/placeholder fallback rather than being
rejected as globally missing. Numeric anchors parse the final `:<number>` suffix against their own
cited path, including paths with spaces. A legitimate first-line hunk may therefore use
`base:…:1 → head:…:1`. If hunk metadata is unavailable,
or unavailable for that file, the legacy fallback still rejects a modified file whose numeric anchors
are the `:1 → :1` placeholder. With metadata, an added file needs only `head:`, a deleted file only
`base:`, and a zero-count side has no file lines and needs no anchor. New-ness comes from `A` in
`git diff --name-status`, not from the document's narrative; a zero-count side comes from the hunk
header, not from a prose claim.

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

The code section is organized with the commit as its spine, and its unit is the change (`#### 변경 N: <한 일>`), not the file. Each Change Group has at least one commit subsection (`### \`hash\``) carrying a valid range hash, and each change block has one core-logic code fence — a mermaid-only or empty fence does not count (the template reserves mermaid for diagrams and requires real code/pseudocode per change). The gate forces this coarse spine — a commit subsection per group and a code fence per change block; how the responsibilities nest inside a change and which cf fields each carries is the author's to fill from the template, not machine-forced. Hash validity is compared against the list `start` pinned — if enumeration failed and the list is empty, the validity check is skipped ("git failed" is not "every hash is fake").

> **RED — v3 artifact.** In the `b2c-6106` document, `## Commit Journey` (21 commits) and `## Change Group`
> (per file) were fully separated, so commits were listed unrelated to the code explanation. File blocks
> pointed only at location anchors and showed not one line of the actual logic. Making the commit the group's
> spine and requiring code per file joins the two.

> **RED — real artifact (`pr-3621`, user review).** A change block's content was numbered role labels stating
> only the post-state — "책임 1 — 가구 참여 발급 … `reserveCode()`에 넘기고 `householdInviteCodeOfKey()`를
> 만들지 않는다". The reader could not tell whether the responsibility itself changed or what the symbol did
> before — "그럼 이전엔 어떻다는거지". The authoring contract (SKILL.md step 7 + template) now anchors each
> entry on the symbol and tells it before→after: **기존**/**변경** (or **신설**/**삭제**). Not machine-forced;
> the checklist and this note hold the judge to it.

### R14. Three system-level change-contract axes

`### 시스템 레벨`, beyond the diagram (or waiver marker), enumerates the contracts this diff changes across three axes — `서버 API`, `DB 스키마`, `클라이언트 의존`. All three axis labels must be present. The table must be **real rendered content**: fenced code is masked before the axes are scanned, so a contract table that appears only inside a fenced example (the template ships one) does not satisfy R14. What each axis says about its contract is the author's to fill.

> **RED — v3 artifact.** The `b2c-6106` system level ended with one box-and-arrow flowchart. How the API
> surface of the three server contracts (cost, program doses, intake history) changes, how the join changes,
> and what the chat client must match were not enumerated in a table, so the "system-unit" explanation was
> thin.

### R15. Boundary / dependency / use-case change map

The Architecture section closes with a `### 경계·의존·유스케이스` block that is a **use-case change map**, not a static layer-classification table. Its unit of account is the **execution unit**: one card = one thing that is invoked and runs end to end (a service method, an HTTP endpoint, a batch script, a hook). A cross-cutting property — a transaction boundary, idempotency, consistency — is never its own card; it is described inside the `한 일` of the execution unit that owns it. Each card's `한 일` opens by stating the unit's identity (what kind of thing it is and which module owns it), so a bare identifier never reaches the reader unexplained. Because a feature/use case mostly carries an orchestration responsibility, the block must **show the flow as a mermaid diagram** (a `sequenceDiagram` is the recommended type) — who calls whom in what order, with the changed step marked — or a reasoned `구조 변화 없음: <사유>` waiver when the diff changes no use-case flow. Beyond the diagram, the block must contain a renderer-recognized `arch-entity` opening tag whose `data-change` is one of `new`, `mod`, or `del`, plus the `영향 인터페이스` and `의존 방향` slots. Prose-only mentions of `data-change`, or unsupported values, do not count. The orchestration-diagram check reads the raw sub-slice (a mermaid fence is masked away, so it is looked for before masking); the slot checks read the fence-masked sub-slice. What each slot says is the author's to fill. The vocabulary follows the `architecture-boundaries` rule but the output speaks the codebase's own terms (enforced by R19).

> **RED — the v4 static table.** The earlier R15 forced a `파트/레이어/협력자/영향·수정` classification table
> with a binary `수직 도메인 / 수평 유스케이스` layer choice. On an FSD codebase this miscategorised parts that
> are neither a clean vertical domain nor a horizontal use-case: a `resolver` (an `entities/lib` module) and a
> `census` (a standalone backend CLI) were both forced into "수평 유스케이스", and the table answered "what
> exists" rather than "what this diff did to the boundary". The rewrite drops the static classification: each
> behaviour unit is an `arch-entity` carrying its change kind and affected interface, closed by the direction
> verdict — the same "change contract, not inventory" shape that made R14 work.
>
> **RED — real artifact (`pr-3619`, user review).** The block mixed cards of unstated identity: a card
> named `온보딩 승인 트랜잭션` (a transaction property posing as a unit — the reader asked "얘의 정체는
> 뭐야?") and a card named `update_onboarding_status` with no statement of what kind of thing it is or
> which module owns it. The execution-unit account and the identity-first `한 일` sentence close this.

### R17. System-level standing-interface table

The 시스템 레벨, beyond the R14 change-contract table, carries a **real rendered Markdown table**
naming which boundary communicates over which endpoint/query/screen-URL and what flows. Its header
and separator row must have exactly these three columns, followed by at least one data row:

| 경계 | 인터페이스 | 오가는 것 |
|---|---|---|

Prose-only labels, a fenced example, and a header/separator-only table are not the table R17
requires. Read on the 시스템 레벨 slice with fences masked; the executable checker requires this
exact three-column header/separator shape plus a non-separator data row. This is distinct from R14 in
layer — R14 enumerates what this diff *changes*, R17 the *standing* interface the diagram's
short-protocol edges leave implicit. What each row says is the author's to fill — but the
`인터페이스`/`오가는 것` cells must carry the actual signature and request/response payload (fields
with types), not a naming-convention note; the checker enforces the table shape, and the signature
content is a documented authoring requirement the judge and RED/GREEN comparison hold to.

> **RED — real artifact (`pr-3412`, luna max).** The standing-interface `오가는 것` cell said
> "camelCase `generationRequest`, `proposalType`" — a naming convention, not a message. A reader could
> not tell what value crossed the boundary. The requirement is the signature and payload shape
> (`{ generationRequest: { userRequest: string, intakeTimeCodes: string[] }, proposalType: enum } → { asyncTaskId }`).

> **RED — real artifact (`b2c-6105`).** The system diagram was `browser --> backend --> db` with every edge
> unlabelled, and it *omitted* the Python health-profile API and the census→DB boundary that the prose itself
> named — so "which entrance do they talk through" was answerable only by hunting the prose. Putting the
> interface on the edge as a label was rejected in the interview (long endpoint/query strings blow the 12-node
> layout); the table carries it instead, and the diagram keeps short-protocol edges.

### R18. Component-level node cards

The 컴포넌트 레벨 may use a reasoned `구조 변화 없음: <사유>` waiver when there is no component
structure change. The diagram's **nodes must be module/concept names** (a feature, use case, hook,
service, schema module), **never source file paths** — the checker rejects a component diagram whose
nodes are file paths (a path with a code extension), and this ban holds even under the waiver. Where a
component lives is stated in the card's `패키지` slot at package granularity, not as a node
label (the slot holds a directory path, so it is named 패키지 — calling it a "layer" misleads).
Otherwise, every authored `arch-entity` card in the slice is checked independently for the
`패키지`, `책임`, `인터페이스`, and `변경점` fields and an allowed `data-change` value: `new`, `mod`,
or `del`. The `변경점` field carries WHAT this diff changed in the component (before→after in one
line) — `data-change` alone only names the kind. One complete card cannot mask an incomplete or
invalid card. Prose-only card descriptions and invalid `data-change` values do not count. Pure
data/contract-only content cannot simply omit cards; it needs the reasoned waiver if no valid card
is present.

> **RED — real artifact (`b2c-6105`).** The component level was a bare chain of class/function names —
> `CurrentBoostPackInfoCard`, `useBoostPackSupplementCatalogResolvers` — with no responsibility, interface, or
> layer anywhere, so a reader could not tell what any node *does*. The system level had gained a companion
> table (R14); the component level had no counterpart, an asymmetry R18 closes.
>
> **RED — real artifact (`pr-3412`, luna max).** The component diagram's nodes were full source file paths
> (`apps/backend/src/domains/health-profiles/routers/health-v2.router.ts`) that truncated mid-path in the
> render (`health-`, `proposal-`), telling the reader a location instead of a module. A component is a module
> unit; its location belongs in the card's `패키지`, not in the node label.
>
> **RED — real artifact (`pr-3619`, user review).** The card's locating slot was labeled `레이어` while
> holding `apps/backend/src/domains/health-profiles/services` — a package path, not a layer — and the
> cards stated responsibility and interface but never WHAT this diff changed in the node. The slot was
> renamed `패키지` and the `변경점` field was made required.

### R21. Domain-level entity cards

The `### 도메인 레벨` may use a reasoned `구조 변화 없음: <사유>` waiver when the diff changes no
domain object. Otherwise, above the entity/relation diagram, every touched domain object gets an
`arch-entity` card checked independently for the `책임` field (the object's duty, invariants, and the
business logic it already owns — prose, without enumerating member variables), the `핵심 멤버` field
(member variables/keys/core methods as structured code chips — `<p class="ae-members">` with
`<code class="chg">` on members this diff touched; a member-less value concept writes
`핵심 멤버 없음 — <사유>`), the `변경점` field (which of those responsibilities this diff
added/changed/removed, before→after) and an
allowed `data-change` value (`new`, `mod`, `del`). One complete card cannot mask an incomplete or
invalid card. Nodes and cards must name **real business concepts** — the things the domain models
(a Program, an intake-time slot, an onboarding vs regular request kind) — in the codebase's own terms;
a bare schema-encoding name with no business meaning is not a domain object (reality judged by R12).
Two structural bans hold even under the waiver: diagram nodes must not be file paths, and a
`classDiagram`, if drawn, must fill each box with **members and methods** — an empty class box (name
only) fails. This is the domain-level counterpart to R18.

> **RED — real artifact (`pr-3412`, luna max).** The domain `classDiagram` drew boxes with class names
> only and no members — `GenerationIntakeTimeCodesSchema`, `ProgramGenerationRequestV2Schema` — so a
> reader could not tell what each object holds or does, nor whether these encoding names were real
> business concepts. An object diagram must show member variables and methods; the domain level names
> business concepts, not schema encodings without their meaning.

> **RED — real artifacts (`pr-3557`, `pr-3556`).** The domain level was the thinnest of the three:
> `pr-3557` drew a `classDiagram` whose nodes included narrative concepts (`ModelAlias`,
> `LegacyProductKey`) with no responsibility or change kind, and `pr-3556` closed the level with a bare
> `erDiagram` and one prose paragraph. A reader could not tell which domain object this diff added or
> modified, or what invariant it now holds — the component level had cards (R18) but the domain level
> had no counterpart, the same asymmetry R21 closes.

> **RED — real artifact (`pr-3619`, user review).** The domain cards carried one-line responsibilities
> (`has_completed_tutorial 로 온보딩 완료 이력을 보유한다`) with no member variables, no owned business
> logic, and no statement of what this diff changed in the object — on the level the reader called the
> most important one. The `책임` contract was widened to the object's full picture and `변경점` was made
> a required field. A follow-up review found member variables enumerated inside the `책임` prose
> unscannable ("멤버변수를 글로 서술하는 건 좀 애매한 느낌") — members moved to the structured
> `핵심 멤버` chip slot, with changed members highlighted and `←변경` marking in the classDiagram.

### R19. No methodology name or axis label in Architecture prose

The Architecture section's **rendered prose** speaks the codebase's own domain terms — no methodology
proper name and no bare layer-axis label leaks in. The checker masks fenced blocks and removes
inline-code examples before scanning, then requires standalone token matches (methodology matching
is case-insensitive). None of these standalone tokens may appear: methodology names `FSD`,
`Feature-Sliced`, `Clean Architecture`, `Clean-arch`, `DDD`, `Domain-Driven`, `bounded context`; or
axis labels `수평`, `수직`. The plain words `유스케이스`/`도메인` are legitimate (the block heading
uses them); only framework names and the horizontal/vertical axis labels are banned. The boundary
block names what this diff touched in the codebase's own terms, not by sorting parts into a
`수평`/`수직` grid — the boundary vocabulary still follows the `architecture-boundaries` rule
internally, but the *output* forbids naming the methodology or its axes.

> **RED — interview requirement.** The user asked that the boundary block think in the two axes but never surface
> the framework names in the output ("이게 프롬프트에 굳이 드러나진 않았으면 좋겠어"). A literal token scan is
> the precise, cheap enforcement — the names are proper nouns, so a grep catches them without judge discretion.

### R16. Goal / core-message beat

Between Background and Architecture the document carries a `## 목표` section with three sub-slots — `### 무엇을·왜` (what the change achieves + why it was needed), `### 핵심` (the one-line core the reader should hold before any code), and `### 출처` (where the purpose/context understanding came from — a Linear issue, Notion doc, Slack thread, PR description, commit body, wiki path, or `코드 추론`). Read on the fence-masked text so a `###` inside a code example does not stand in for the real slot. What each slot says is the author's to fill; the gate forces the three slots present. The `출처` slot applies R3's provenance discipline to the document's whole purpose — the reader can trace and trust the WHY.

> **RED — real artifact (`pr-3412`, luna max).** The 목표 section was rated clear and understandable, but nothing said where the understanding came from — a reader could not tell whether the stated purpose was grounded in a Linear/Notion/PR source or invented. The `출처` slot closes that: name the source, or say `코드 추론`, never blank.

> **RED — real artifact (`pr-3621`, user review).** The `출처` slot existed but held only generic bullets
> ("PR 본문", "실제 구현") — no sweep of the issue key the PR title itself carried (B2C-6542), the related
> PRs its body linked, the wiki doc the diff changed, or the external tracker behind the issue key. The
> Background read as code-derived while collectable sources sat unread. The authoring contract (SKILL.md
> step 1 source sweep + the `### 원천` table in Evidence) now forces the sweep to be recorded row by row —
> 종류/식별자/확보(열람·접근 불가)/요약 — and `출처` to name what each row contributed.

> **RED — real artifact (`boostpack-tool-helper-restore`).** The document ran Evidence → Background →
> Architecture with no statement anywhere of what the change was for or its one-line takeaway. The "왜"
> existed only as per-file fields at the bottom of the code section, after all the mechanism, so a reader hit
> the architecture (and a mislabeled one — see R12) before ever learning the point. The original explain-diff
> talk lists "커밋 목표 및 핵심 전달" — state the goal before the code, like a math teacher — as a first-class
> document component; the pre-R16 skill had dropped it. Same pattern as R2/R9/R14: a beat requested in prose
> does not land, so it is forced as a slot.

### R22. 근거 quote source fidelity

Every `근거` provenance quote in the code section must be a **real substring of the range's own source** — the concatenation of every in-range commit body with the range's net diff text. The check compares both sides after removing whitespace and markdown emphasis markers (`` ` `` `*` `_` `~`), so a commit body's hard-wrapped, `**emphasized**` sentence still matches the document's unwrapped, plain quote, while a paraphrase or a sentence taken from the PR description — which appears nowhere in the source — does not. Undefined corpus (a Git failure at capture) fail-opens, the same "git failed ≠ everything fabricated" degradation R13 uses for hashes. R22 is deliberately narrow: it proves the quote is *real*, not that it belongs to the *specific commit* the block attributes it to — wrong-commit attribution, code-fence fidelity, and per-commit-vs-net-diff reality stay with the author and the fact-check pass (discipline.md Remainder 5).

> **RED — real artifacts (`pr-3776 household-lock`, `pr-3766 radar`).** A green-test declared PASS on documents whose `근거` badges quoted paraphrases and PR-body prose that sat in no commit body — invention wearing a ground-truth badge, caught only by an external verifier, never by the skill. Measuring the confirmed outputs after normalization: 67 hand-verified `근거` quotes across five documents all matched their source (0 false positives), while a synthetic paraphrase was caught every time. The check is a structure item, not a judge item, because substring-against-source is exactly what a machine can decide.

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

Each question requires two or more rubric items, at least one of which is a concrete value unknowable without reading the document (identifier, coordinate, condition, order). Within the same concept, questions do not overlap in required rubric. **Questions test comprehension of the change — its purpose, mechanism, or consequence — not document metadata.** The git range, the signal/noise file counts, the commit count, and other bookkeeping prove nothing about whether the reader understood the change; such questions are banned. At least one required concept must be a why/purpose question whose answer must state the reason, not just the mechanic.

> **Note — the controls' quiz form.** The gist control makes multiple-choice questions that show the options
> (`<div class="q" data-answer="1">` form). The moment options are visible, what is measured drops from recall
> to recognition. That is why this skill uses open-ended answers, and R8 looks at whether that open-ended form
> actually discriminates.

> **RED — real artifact (`pr-3412`, luna max).** The quiz led with "이 문서가 설명하는 git range와 signal 파일 수·noise 파일 수는 무엇인가?" — pure metadata a reader could answer by skimming the header, testing bookkeeping instead of whether they grasped the change's purpose and why it was needed.
