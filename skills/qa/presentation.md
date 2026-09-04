# Presentation contract (qa)

This contract adapts explain-diff's presentation perspective to QA. explain-diff
teaches a **code change** to whoever will modify the code next; qa's report
teaches the **user-facing impact and verification** of a change to a PO/designer
with no prior context. Same spirit — first person, rich AND accessible, ELI5 but
never dumbed down, big-picture diagrams — different subject: **users and their
product experience, not functions and files.**

## Core principle — the completion condition is a person, not a document
The report is done when a **PO/designer with no context** can, from the report
alone, correctly understand: who this change affects, how those people use the
product, what happens at their boundary, whether it works, and whether each
requirement was met. If a reader who knows nothing about the codebase cannot
judge "were our requirements reflected?" from this report, it is not done.

## Purpose & perspective (the bar)
Write the report in the **first person of the QA engineer who verified this
change**, explaining — to a colleague or team-lead with no prior context on it —
**who the change affects, how each of those users uses the product (software +
hardware), the scenarios you walked at their boundary, what you observed, and
whether each requirement is met.** The bar: from this report alone, that reader
richly and correctly understands the change's user impact and whether it does
what was asked. Keep it clear and accessible — plain language, domain terms
glossed on first use, big-picture diagrams (the ELI5 spirit of "explain it
simply") — but never dumb it down or thin it out: **accessible AND rich, never a
thinned-out overview.** (This does not relax anything below — a scenario without
its evidence, or a requirement without a grounded verdict, is not done.)

## The QA lens — start from product and users, never from code
This is the one rule that makes it QA and not a changelog. **Never** open from
the diff. Always:

1. **Define every affected user.** admin users, product users, product users in a
   specific condition (a specific bundle's audience, a specific program's users),
   partners, and so on. A backend- or admin-only change still flows to users —
   name who, first.
2. **Describe how each user uses the product** (software + hardware) in scenarios
   related to this change — detailed and rich, at what they actually do and see.
3. **Verify at the user boundary** — say whether the flow behaves as intended from
   what the user observes on the screen / device / API response, **not** from unit
   tests or build logs.
4. **Tie each requirement to a verdict** the PO can trust — met / not met /
   partial, connected to the scenarios and evidence that prove it.

## Hard rule — stay at the user-observable boundary
The narrative describes **only what the user does and observes** at their
boundary — the screen they see, the device's behavior, the API response they get.
Implementation mechanism is **banned from the narrative**: no caches, no
identifiers or field names, no data types, no function names, no "compares X to
Y internally." State the problem and the fix in what the user *experiences*.

- BAD (implementation leaked): "The app re-fetches the latest Program at CTA time
  and compares it against the cache; the refetched `updatedAt` Date is a new
  instance, so the `programId` comparison misfires."
- GOOD (user boundary): "Before, pressing the dispense button popped a 'program
  change detected' notice that kept reappearing no matter how many times you
  confirmed it — so you could never actually dispense. After, when nothing about
  your program actually changed, dispensing proceeds with no notice. When your
  program genuinely did change, the notice still appears, so you never
  unknowingly dispense an outdated recipe."

The "why/problem" is stated in user-observable terms, never in how the code does it.

## What the report carries (anchored to records)
Facts — the user list, the scenario list, the requirement text, and each
scenario's pass/fail + evidence — are authoritative from `qa-state` records. The
presentation adds only **narrative and diagrams** on top, keyed to those records.

- **Feature overview (`overview`)** — what this change is and why, in product
  language (the problem and stakes), never code.
- **Affected users (`affectedUsers`, keyed by actor id)** — for each recorded
  actor: how this user normally uses the product, and how this change affects that
  use — at their boundary, per the hard rule above.
- **User scenario flows (`scenarioFlows`, keyed by story id)** — for each recorded
  story (a story *is* the user scenario; the cells beneath it are QA coverage
  axes): a **natural-language account of what was done and what was observed** at
  the user boundary — "이런 사용자가 이런 상황에서 이렇게 했더니, 화면/응답이 이렇게
  되더라." This narrative **is the reader's proof**, so it must state the observed
  outcome in plain language, not just the setup. A raw curl transcript, an
  HTTP/JSON dump, a build/test log, or a `vitest`/`jest` result is **never** shown
  to the reader — even when you drove the scenario for real with curl, you
  **convert** it to "we ran this scenario and observed X", in words a PO/designer
  reads. The renderer shows each story with this narrative, **screenshots only**
  (a rendered screen a PO can read directly — raw text evidence and baseline
  build/test logs are moved to the audit section, never the reader), and a
  plain-language coverage summary (the six axes by name). It does **not** surface
  the cell record's technical fields (`driven_at`, `attack_point`, `na_reason`,
  `cls`, the boundary code path); those live in the record-faithful audit section
  below. Write `scenarioFlows` as the clean, converted user-boundary story — the
  renderer keeps implementation and raw dumps out of the reader for you.
- **Big picture (`bigPicture`)** — a mermaid diagram of the user flows / affected
  users, baked to inline SVG at build time. The strongest way to convey flow to a
  no-context reader.
- **Requirement fulfillment (`requirementMapping`, keyed by AC index)** — for each
  recorded acceptance criterion: met (`yes`) / not met (`no`) / partial
  (`partial`) / **unverified (`unverified`)**, plus the scenarios and evidence that
  back the verdict, in prose. Use `unverified` — never `yes`/`partial` — when the
  requirement's user boundary could not be driven (unreachable environment, a
  `NOT-RUN` scenario): it renders LOUDLY as "미검증 — 유저 경계 미구동", so a PO reads
  it as *not done*, not as a mild partial. A green test suite is never grounds for
  `yes`; only a user-boundary observation is.

## Anchoring — no invention
- **Do not invent a user the roster does not have.** If an affected user is
  missing from the roster, that is a roster defect — fix it with
  `qa-state.ts add-actor` so it also enters what you verify. Adding it only in
  prose is invention; the renderer ignores prose for an actor id absent from the
  roster.
- **Draw and say only what the records decided** — no arrow, order, or concrete
  value that the verification did not establish. Do not merge two separate things
  into one cause or category.
- **The verdict matches the verification log.** A `requirementMapping` verdict
  must not contradict the recorded pass/fail of the scenarios behind it. Never
  cite a scenario that did not pass as proof that a requirement is met.

## No internal QA jargon in the reader view
The reader is a PO, not a QA engineer. Coverage classes (`cls`), source tags, and
other `qa-state` machinery are internal — the reader-facing section shows each
story's clean flow, its evidence, and the six coverage axes by their plain names
(e.g. "입력 경계·악성 입력 확인"), never "cls 1 / unspecified." The full per-cell
record (`cls`, `attack_point`, `driven_at`, evidence paths) is rendered in the
separate audit section for traceability — you do not author it here.

## Diagram discipline
`skills/qa/scenario-authoring.md` owns actor/boundary/scenario derivation — read
it before authoring. For the big-picture diagram:
- **Why → Diagram → Interpretation.** Why this picture is needed, the picture, and
  one paragraph of what it says (put the interpretation in `bigPictureCaption` or
  the overview prose).
- **Gloss code/domain nodes** so a no-context reader knows each node and arrow from
  the page alone.
- **No unlabeled arrows.** If an arrow or color means several things, add a legend.
- **A diagram is easier to invent than prose** — nodes and edges only for
  relations the verification established. Node labels are users, screens, devices,
  data — never code symbols. Avoid double quotes inside mermaid node labels.

## First-occurrence gloss (domain/code terms only)
Gloss a product/domain term or code identifier the first time it appears; leave
ordinary terms alone.
- GOOD (domain): "Dispenser (the 8-slot auto-dispensing device)", "Program (the
  AI-designed personalized daily supplement recipe)"
- Expand an acronym on first use · one name per concept · no label before its definition

## Format — self-contained HTML + `--narrative` injection
The verification log renders from `qa-state` records only. The presentation is
subjective prose + diagrams, so it is injected through the `presentation` object
of `qa-report.ts --narrative <json>` (never persisted to disk):

```json
{
  "presentation": {
    "overview": "product-level what & why prose",
    "affectedUsers": { "<actor-id>": "how this user uses the product + how the change affects them, at their boundary" },
    "scenarioFlows": { "<story-id>": "the user-boundary flow, rich" },
    "requirementMapping": { "0": { "satisfied": "yes|no|partial|unverified", "evidence": "the scenarios + evidence that back this verdict" } },
    "bigPicture": "flowchart LR\n  Owner --> StockScreen",
    "bigPictureCaption": "one-line interpretation of the diagram"
  }
}
```

Render command (at STATE, after `set-verdict`, before `complete`):
```bash
bun ${CLAUDE_SKILL_DIR}/scripts/qa-report.ts --session <id> --out <path> --narrative <presentation>.json
```

The report is a self-contained HTML page (inline `<style>`, zero runtime
`<script>`, zero external reference); mermaid is baked to inline SVG at build time
with mmdc (a missing mmdc or a failing block preserves the source and does not
abort the report). Any required slot left unwritten renders a **visible `gap`
marker** (`class="gap"`) — what was skipped shows in the report.

## Self-audit (after render, by eye)
- [ ] Does it open from **who is affected and why**, in product/user terms — not a
      code diff or test-result list?
- [ ] Are **all** affected users defined (admin / product / conditional / partner)
      — and any missing one fixed with `add-actor`, not invented in prose?
- [ ] Is each user's product (software + hardware) scenario flow rich and detailed,
      **at the user boundary** — zero implementation mechanism (cache, id, type,
      function name), zero unit-test narration?
- [ ] Is every scenario shown **with its own evidence** (before/action/after) — none
      separated from its proof?
- [ ] Does the big-picture diagram carry the user flow, with a why + interpretation
      · zero gap markers?
- [ ] Is each requirement mapped to a verdict + backing scenarios/evidence, and does
      the verdict match the recorded pass/fail · zero gap markers · any requirement
      whose user boundary was never driven marked `unverified` (never `yes`/`partial`)?
- [ ] Only domain/code terms glossed on first use · no `cls`/internal jargon in the
      reader view · zero invention/contradiction

The one pass criterion: **can a PO/designer who knows nothing about the product,
from this report alone, tell who is affected, what flows are expected, whether it
works, and therefore whether the requirements were met?**

## Rationalization table — each of these is a retreat to "code diff"
| Excuse | Reality |
|--------|---------|
| "It's a backend-only change, so showing the tests pass is enough." | A backend change still flows to users. Define who is affected and write it from how they use the product. |
| "Explaining the function/field I changed lets the reader understand." | The PO does not know the function. How that change alters the user's experience is the presentation. |
| "This detail (cache, id, data type) explains why it broke." | The reader observes it as a screen/device/API behavior. State the problem and fix in what the user experiences, not the mechanism. |
| "This user isn't in the roster, but they're affected — I'll add them in prose." | Roster defect. Fix it with `add-actor` so they enter verification. The renderer ignores prose invention. |
| "Requirement mapping duplicates the AC section." | The AC section is just the text. The met/not-met verdict tied to evidence is what the PO needs. |
| "The tests are green, so I'll show the PO the test output as proof the requirement is met." | A test-runner report proves code in isolation, never the user boundary. It is not scenario evidence and `record-cell` mechanically rejects it. Only a screen/device/API observation backs a `yes`. |
| "The UI/admin wouldn't boot, so I ran the service's test suite and marked the requirement `yes`." | That is not the user boundary — the requirement is **unverified**. Mark `satisfied: "unverified"`; it renders loudly as not done. Never `yes`/`partial` on a green suite. |
| "Prose is enough; no diagram needed." | The big picture is the strongest way to convey flow to a no-context reader — it is a required slot. |
| "The scenario list is separate; evidence can live elsewhere." | Every scenario is shown with its evidence, even if the document grows heavy. |
| "I drove it with curl, so pasting the curl/HTTP output is the evidence." | A PO cannot read `HTTP=404` or a JSON body as "it works." Convert it: "we requested another user's item and got a not-found with no data leak." Raw curl belongs in the audit. |
| "Showing the test output proves the scenario ran." | A test log is not a scenario a PO reads. State the scenario and its outcome in words; the log stays in BASELINE/audit. |

## Red flags — STOP
- The presentation opens with "what I changed (code)" → rewrite from "who is affected (users)"
- Implementation terms (cache, id, data type, function name) appear in a user narrative → rewrite at the user boundary
- A user flow slot holds unit tests or build logs → replace with user-boundary observation
- A scenario shows a raw curl/HTTP/JSON dump (`HTTP=404`, `{"error":...}`, `table row count before=6`) as its proof → convert it to a natural-language "we ran this scenario and observed X"; the raw bytes belong in the audit section, not the reader
- A requirement's user boundary was never driven but it reads `yes`/`partial` → mark `satisfied: "unverified"` (renders loud "미검증")
- A scenario appears without its evidence → attach the before/action/after
- Internal jargon (`cls`, source tags) is visible to the reader → remove it
- The narrative names more users/scenarios/requirements than the records hold → invention; fix the records
- A fulfillment verdict contradicts the recorded pass/fail → match the verification log
- A gap marker remains → fill the required slot
