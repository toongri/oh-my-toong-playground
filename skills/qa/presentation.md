# Presentation contract (qa)

This contract adapts explain-diff's presentation perspective to QA. explain-diff
teaches a **code change** to whoever will modify the code next; qa's report
teaches the **user-facing impact and verification** of a change to a PO/designer
with no prior context. Same spirit — first person, rich AND accessible, ELI5 but
never dumbed down, big-picture diagrams — different subject: **users and their
product experience, not functions and files.**

## Core principle — the completion condition is a person, not a document
For a screen scenario, the required scenario-card structure is **before image → actor action and observed explanation → after image**. Both images are captures from that scenario's actual software/device run. An authored observation accompanies them; it does not replace either image. API/CLI and test scenarios instead carry an observation grounded in the received response, output, or the test's assertions. A screenshot of a log is not UI proof. A `blocked` screen scenario is the exception: it shows the recorded before/after images if any exist (not required, since it may never reach the screen), and its `observed` is required.

The final `qa-report.ts` CLI validates visual images and observations before writing. Missing, unreadable, oversized, or cumulatively unembeddable images block the final report; a path-only placeholder does not satisfy visual proof. Optimize captures, update their recorded paths, and re-render. Before completion, open the HTML and check that each card carries the images and observation recorded for its scenario. Capture failure leaves an evidence gap, not an invented pass/fail or an `na` excuse.

The report is done when a **PO/designer with no context** can, from the report
alone, correctly understand: who this change affects, how those people use the
product, what happens at their boundary, whether it works, and whether each
requirement was met. If a reader who knows nothing about the codebase cannot
judge "were our requirements reflected?" from this report, it is not done.

## Claim review record

After `record-scenario`, inspect the raw images at readable size and the action
record. List each asserted outcome as a separate claim, including intermediate
error/recovery states. Record what the source actually shows before comparing it
to the assertion. Existing capture guidance above still governs sufficiency.

`review-evidence --story <id> --scenario <id> --json-file <file>` accepts
a nonempty JSON array. Each row requires `claim`, `verdict` (`supported` or
`insufficient`), `observation`, `gap`, and nonempty `sources` with `path` and
`location` (visible region in Korean, or timestamp/log line; the CLI refuses a
label with neither, such as an English heading copied from your notes). `gap` is
empty for supported claims; otherwise it names the missing proof and next capture. For example:

```json
[
  {
    "claim": "저장 실패 안내가 표시됐다",
    "verdict": "insufficient",
    "observation": "편집 폼 상단만 보이며 실패 안내는 보이지 않는다",
    "gap": "실패 안내가 표시된 순간을 읽을 수 있게 다시 캡처한다",
    "sources": [{ "path": "evidence/save-after.png", "location": "전체 캡처" }]
  }
]
```

A scenario on a device profile also needs one layout claim. It records that the
after capture was checked for each breakage a person would hit at that size, and
what the capture shows for each. The CLI refuses the review without it:

```json
{
  "kind": "layout",
  "checked": ["clipping", "overlap", "horizontal-scroll", "text-wrap"],
  "claim": "노트북(1536×864)에서 바뀐 표를 읽고 쓸 수 있다",
  "verdict": "supported",
  "observation": "카테고리 열이 잘리지 않고 다른 열과 겹치지 않는다. 가로 스크롤이 없다. 한글 이름이 단어 중간에서 끊기지 않는다",
  "gap": "",
  "sources": [{ "path": "evidence/laptop-after.png", "location": "자가섭취 보유분 표" }]
}
```

A broken layout is still a `supported` claim of what the capture shows; the
scenario itself is recorded `fail`.

A `fail` scenario that the CLI counts as a product failure needs one cause claim. It shows the
change broke the product, not who wrote the wrong line: finding that line is
DIAGNOSIS's work. Record it in one of two forms. `base-run`: the same steps under
the same setup end as expected on the base commit; the setup is the same on both
sides, so it cannot be the cause. When the base commit cannot run those steps (the
screen or endpoint is new), use `product-path` and `base-commit`: `product-path`
cites the product's own log line or code location that took the wrong path, not
setup such as signing, keys or debug mode, and `base-commit` cites the diff hunk
that touches the code that breaks. The CLI computes REQUEST_CHANGES from the failure only once this
claim is `supported`. A failure whose cause you could not show may be reviewed
without it, or with a cause claim marked `insufficient` and the gap named. It then
has no verdict: the CLI computes none until it is attributed.

```json
{
  "kind": "cause",
  "checked": ["base-run"],
  "claim": "앱이 새 연결 링크를 기기 연결 화면으로 보내지 않는다",
  "verdict": "supported",
  "observation": "같은 기기·같은 계정으로 base 커밋 빌드에서 같은 단계를 밟으면 기기 연결 화면이 열린다. 이번 빌드에서는 '찾을 수 없음' 화면이 열린다",
  "gap": "",
  "sources": [{ "path": "evidence/installed-link-after.png", "location": "링크를 연 뒤의 화면" }]
}
```

When you cannot show either form, the cause is not established. Fix the setup and drive the
scenario again. Record it `blocked` with those attempts only when absent hardware, an
off-network third party, or a person stops the rerun (`--obstacle-kind`).

The CLI persists the review and hashes the scenario's evidence plus every cited
source. Re-recording the scenario, changing its scenario fields, actor assignment,
actor boundary/driver, or evidence bytes invalidates the receipt. Review the new evidence and resubmit. These checks
prove a review record exists and matches the files; they do not perform image
understanding or prove that the reviewer told the truth.

Cited text sources must also fit the final report's per-file and total embed
budgets. For a large action log, save a bounded, faithful excerpt with the
relevant timestamps and source location, then cite and review that excerpt.
File validity is separate from embeddability: an oversized source is not a
missing file, but the final report cannot omit the cited proof and complete.

The reader card renders reviewed claims, observations, source locations, and
images together. Missing/insufficient/stale reviews show **근거 미검증**; raw
execution status remains in the audit. A timer claim needs a timed action trace
and the resulting visible state; a persistence claim needs the relevant value
before/after reopening. A still image of the form cannot establish either.
Do not add outcomes in presentation prose that are absent from the claim review.
Open the final HTML: every claimed result must remain legible in its embedded
capture. If not, repair the presentation/capture, render again and check the
card again; a capture whose bytes changed needs a new `review-evidence`.
The renderer records a receipt for the generated HTML. After checking the
final HTML, run `qa-state.ts review-report --path <html>` before `complete`.
Changing the HTML or recorded facts requires re-rendering and another check.
A clipped diagram or unreadable claim is unfinished: repair, re-render, and
check again before `review-report`.

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
3. **Say what was proven, in the user's terms** — whether the flow behaves as
   intended, and through what: the screen, the API response the app receives, or a
   named test that asserts it. Never a bare "tests passed".
4. **Tie each requirement to a verdict** the PO can trust — met / not met /
   partial, connected to the scenarios and evidence that prove it.

## Hard rule — speak in what the user experiences
The narrative describes **only what the user does and observes** — the screen they see, the device's behavior, the API response they get.
Implementation mechanism is **banned from the narrative**: no caches, no
identifiers or field names, no data types, no function names, no "compares X to
Y internally." State the problem and the fix in what the user *experiences*.

- BAD (implementation leaked): "The app re-fetches the latest Program at CTA time
  and compares it against the cache; the refetched `updatedAt` Date is a new
  instance, so the `programId` comparison misfires."
- GOOD (user experience): "Before, pressing the dispense button popped a 'program
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

The report reads top-down in this order — **what was asked, then what we saw**:
a one-line verdict summary (the verdict and the scenario counts behind it, drawn
from the records) → ① 기능 개요 (overview) → ② **요구사항(AC) 충족 현황** (each AC + its
met/not-met verdict — the PO's at-a-glance answer) → ③ 큰 그림 (the user-flow
diagram) → ④ **액터 · 영향받는 유저** → ⑤ 유저 시나리오 · 근거 (per-scenario
cards) → then the record-faithful **감사** sections (시나리오 상세 기록 — carrying
each scenario's technical boundary + driver — failures, verdict, evidence files;
there is no separate actor-roster table).

- **Feature overview (`overview`)** — the change itself, in product language,
  never code. Write two to four sentences, one fact each, in this order: who uses
  which part of the product; what this change makes different for them; the
  problem it fixes. Add one sentence on what is on or off in production only when
  the change ships behind a flag or a staged rollout. The QA result has its own
  places: the summary line (verdict and counts), the banner (blocked scenarios)
  and the AC board (each requirement). The final render refuses an overview that
  carries a verdict, "QA", "검증 불가", "미검증" or a confidence score. What this
  cycle did not check goes in the AC board and the unverified list, not here.
- **Affected users (`affectedUsers`, keyed by actor id)** — the roster and the
  affected-users narrative are the **same actors** (same ids), merged into ONE
  block per actor: **there is no separate actor-roster table.** For each recorded
  actor write how this user normally uses the product and how this change affects
  that use — at their boundary, per the hard rule above. The reader block shows the
  actor's name, this impact narrative, how far the change reaches their client
  (the recorded client impact and its reason, plus the device profiles for a
  screen change), and whether the boundary was reachable (a blocked boundary shows only a "도달 막힘" badge, a still-`unknown` one a neutral "도달 미확인" badge; the `reach_obstacle` text is audit-only); the
  concrete per-scenario boundary + driver live in the 시나리오 상세 기록 audit, not
  here — do not restate them in prose.
- **Scenario overview (`scenarioFlows`, keyed by story id)** — for each recorded
  story (a story is what one actor wants; the user scenarios beneath it are the
  concrete things that actor does): a **short intro** — who this actor is and which
  scenarios you checked for them — 1–3 sentences. It is the lead-in, **not** the
  place the evidence lives; each scenario's own observation lives on its card
  (next bullet).
- **Per-scenario observation (`scenarios`, keyed by `<story>:<scenario>`, the
  scenario key; story and scenario ids must not contain ":", and the CLI rejects them — write it under the top-level `scenarios` object, field `observed`)** —
  this is the reader's proof, **one per scenario**. For each verified scenario,
  state in plain language what you did in that scenario and what
  the real software rendered — "이 시나리오에서 이렇게 했더니 화면/응답이 이렇게
  되더라." The renderer draws ONE card per scenario, and every verified
  (pass/fail) scenario must carry a reader-visible real-software record:
  **an authored observation AND before/after screenshots for visual boundaries; an authored observation backed by received output for API/text-CLI boundaries** — a scenario with neither renders a
  loud gap, never a silent hole. This is what lets a PO judge, per scenario, whether
  the software drew the UX right and whether the change had side effects. A raw
  curl transcript, an HTTP/JSON dump, a build/test log, or a `vitest`/`jest`
  result is **never** shown to the reader — even when you drove the scenario for
  real with curl, you **convert** it to a per-scenario observation ("we ran this
  scenario and observed X"), in words a PO/designer reads; the raw bytes stay in
  the audit. A scenario driven at a visual boundary shows **screenshots** on its
  card (a rendered screen a PO reads directly), labeled with its device profile. The card does **not** surface the
  record's technical fields (`driven_at`, `why_needed`, the boundary code path);
  those live in the record-faithful audit section below.
  A `blocked` card shows the fixed "검증 불가" status line, `observed` (required), and the
  recorded before/after images if any. Write `observed` in product terms: what was
  confirmed and what could not be proven. The raw obstacle, attempts, deepest point
  reached and attempt log are audit-only; they never appear in a card or the banner.
  Risks declared not applicable are not cards: the renderer folds them under one
  "펼쳐 보기" toggle with their reasons, so they never crowd the scenarios.
- **Big picture (`bigPictureSvg`)** — a hand-authored inline `<svg>` of the user
  flows / affected users, with drawn edges. The strongest way to convey flow to a
  no-context reader. The renderer sanitizes it and refuses the render on any
  disallowed construct (see "Diagram discipline").
- **Requirement fulfillment (`requirementMapping`, keyed by AC index)** — this is
  merged with the acceptance-criteria text into the single **요구사항(AC) 충족
  현황** board near the top of the report (the AC text alone is no longer a
  separate section). Each entry must include a non-empty `scenarioRefs` array of
  `{story, scenario}` selectors. The renderer validates every ref against
  exactly one recorded current-cycle scenario, requires the ref's story to link that
  AC, and checks its recorded status (`pass`, `fail`, or `blocked`). **The
  satisfaction is derived, never written**: the renderer computes it from those
  recorded statuses. All referenced scenarios `pass` → 충족; all `fail` → 미충족; any
  `blocked` → 미검증; otherwise (a mix of `pass` and `fail`) → 부분 충족. A
  narrative that still carries a `satisfied` field is refused with an error: delete
  the field. Missing/legacy/malformed/duplicate/stale/unknown mappings, and a ref to
  a scenario with no recorded result yet, cannot be derived and fail closed to a
  visible neutral gap (`미판정`) rather than a green
  verdict. Prose evidence explains a verdict but cannot establish it, so it names
  only what the referenced scenarios show, in reader words: a test is named by what
  it checks ("보유분 표 화면 테스트"), never by its file name. The final render
  refuses a code name in the overview, AC evidence, actor and story prose, and card
  observations; `author-scenario` refuses one in a scenario title or expected
  result, because the card shows both. The check catches only identifier shapes;
  after rendering, `qa-report.ts` lists every English word left in reader prose
  so you can replace the rest.
  An English infrastructure word ("scheduler", "worker", "parity", "stale") or a
  key name ("daily-billing") passes it but is still code to a PO: write what the
  actor sees in Korean ("정기 결제 예약", "대조 결과") and keep the technical name
  in `driven-at`. The same holds for a translated API structure ("응답 맵", "조회
  결과의 필드"): name what appears on the screen ("카테고리 이름"). A test that proves part of the
  criterion is a scenario recorded with `--evidence-surface test` and listed in
  `scenarioRefs`. Use
  **unverified (`unverified`)** — never `yes`/`partial` — when the requirement could
  not be proven (a `blocked` scenario): it renders LOUDLY, so a PO reads it as
  *not done*, not as a mild partial. A green suite alone is never grounds for
  `yes`; a scenario run or a named test that asserts the requirement is.

## Anchoring — no invention
- **Do not invent a user the roster does not have.** If an affected user is
  missing from the roster, that is a roster defect — fix it with
  `qa-state.ts add-actor` so it also enters what you verify. Adding it only in
  prose is invention; the renderer ignores prose for an actor id absent from the
  roster.
- **Draw and say only what the records decided** — no arrow, order, or concrete
  value that the verification did not establish. Do not merge two separate things
  into one cause or category.
- **The evidence prose matches the verification log.** The verdict of a
  `requirementMapping` entry is derived from the recorded status of its scenarios,
  so the prose must not argue against it. Never cite a scenario that did not pass
  as proof that a requirement is met.

## No internal QA jargon in the reader view
The reader is a PO, not a QA engineer. Risk numbers, source tags, and
other `qa-state` machinery are internal — the reader-facing section shows each
story's clean flow, its evidence, and the risks by their plain names
(e.g. "입력 경계·잘못된 입력"), never "risk 2". Every reader-facing label is in
the report's language; English status words ("yes", "reachable") are the
renderer's job to translate, and your prose follows the same rule. The full
per-scenario record (risks, `driven_at`, evidence paths) is rendered in the
separate audit section for traceability — you do not author it here.

## Diagram discipline
`skills/qa/scenario-authoring.md` owns actor/boundary/scenario derivation — read
it before authoring. Author `bigPictureSvg` by the diagram rules of
`${CLAUDE_SKILL_DIR}/../html-report/SKILL.md` (§7 diagram rules, §7.6 directed
graphs are SVG, §12 complexity budget, §13 fidelity rules) and the recipe for your
diagram type in `${CLAUDE_SKILL_DIR}/../html-report/references/diagram-recipes.md`.
The page itself stays renderer-owned; only this one slot is yours.
- **Why → Diagram → Interpretation.** Why this picture is needed, the picture, and
  one paragraph of what it says (put the interpretation in `bigPictureCaption` or
  the overview prose).
- **Source-diagram inventory first.** Before drawing, list every flow step,
  transition, decision and actor the plan/spec/ticket shows. Every one appears in
  the SVG, or the caption/overview names what was left out and why. Draw only
  relations the verification established; never invent a node, edge or status.
- **Draw every edge** as a `<path>`/`<line>` with a `marker-end` arrowhead and a
  short verb label; no arrow glyphs, no HTML boxes. Orthogonal routes, labels
  clear of strokes, at most 9 nodes and 12 edges (over budget: split the flow).
- **Labels at least 12px rendered at 1280px width.** Design narrow-first
  (`viewBox` width 360 or less keeps 13px labels legible on a phone). A wider
  `viewBox` is allowed: the renderer keeps it 1:1 and scrolls it in its own frame.
- **Gloss code/domain nodes** so a no-context reader knows each node and arrow from
  the page alone. Node labels are users, screens, devices, data — never code symbols.
- **No unlabeled arrows.** If an arrow or color means several things, add a legend.
- **Theming is the renderer's.** The SVG carries no colors: shapes take a `class`
  from this fixed vocabulary, which the page maps to its light and dark tokens:
  `box`, `box-focal` (at most 1-2 per diagram), `zone` (a boundary rect behind
  nodes), `edge`, `edge-pass`, `edge-fail`, `edge-dash`, `mk` / `mk-pass` /
  `mk-fail` (marker shapes), `t-b` (bold text), `t-s` (small muted text), `lbl`
  (text halo for a label near a line), `stop` (a ✗ mark). Text uses the default
  page color. Failure paths use `edge-fail` solid, never dashed.
- **Required shape.** Exactly one root `<svg viewBox="0 0 W H" aria-label="...">`
  (the `aria-label` is one sentence stating what the diagram shows; no `width`/`height`
  on the root). Allowed elements: `svg g defs marker path line polyline polygon rect
  circle ellipse text tspan title desc`. Arrowheads are `<marker>` elements in
  `<defs>` referenced as `url(#id)`. `fill`/`stroke` may only be `none`,
  `currentColor` or `var(--token)`.
- **Refused, with the construct named in the error:** `<script>`, `<foreignObject>`,
  `<style>`, `style=`, any `on*` attribute, `href`/`xlink:href`, any `url(...)` other
  than a `#id` defined inside the SVG, `<image>`, `<a>`, `<use>`, animation,
  comments/CDATA, unknown elements, attributes or classes. The renderer exits
  non-zero and writes no report; fix the SVG and render again. Escape `&` as `&amp;`.
- **After rendering,** run `${CLAUDE_SKILL_DIR}/../html-report/scripts/capture.sh <report> <dir>`
  and `${CLAUDE_SKILL_DIR}/../html-report/scripts/lint.sh <report> --strict`, look at the
  big-picture frames in light and dark, and fix the `bigPictureSvg` until lint
  reports 0 errors for the figure. A finding outside the big picture (the rest of
  the page is renderer-owned) is a renderer limitation: note it, never fix it by
  editing `qa-report.ts` during a cycle. The report's `<title>` carries qa's target name, which follows qa's own naming rule and is often longer than 6 words or contains " — ", so a `title-name` warning on the QA report is an expected renderer limitation to note, not to fix.

## 쓰기 전에 소개 (introduce before you use) — first-occurrence gloss
The reader is a PO/designer with no prior context, so **every product/domain entity the report leans
on earns a plain-language introduction at its first appearance** — a term, an acronym, a status label,
a coverage-axis name, a device/screen the flow names. A name the reader cannot decode from the page is
a hole in the report. Introduce it in **product/user language**, never in implementation terms — code
symbols (function/module/type names) are removed from the reader view entirely (see "No internal QA
jargon"), so they are never what gets glossed here.

| 첫 등장하는 것 | 소개 깊이 |
|---|---|
| 제품·도메인 용어 / 약어 / 상태 라벨 | 한 줄 뜻 — "Dispenser (the 8-slot auto-dispensing device)", "Program (the AI-designed personalized daily supplement recipe)" |
| 위험·판정 이름 | 평이한 이름으로 (e.g. "입력 경계·잘못된 입력") — never "risk 2" |
| 다이어그램 노드 (사용자·화면·기기·데이터) | element gloss below the diagram (see Diagram discipline) — one plain line each |

- Expand an acronym on first use · one name per concept · no label before its definition

## Format — self-contained HTML + `--narrative` injection
The verification log renders from `qa-state` records only. The presentation is
subjective prose + diagrams, so it is injected through the `presentation` object
of `qa-report.ts --narrative <json-file>` (never persisted to qa-state):

```json
{
  "presentation": {
    "overview": "product-level what & why prose",
    "affectedUsers": { "<actor-id>": "how this user uses the product + how the change affects them, at their boundary" },
    "scenarioFlows": { "<story-id>": "short intro: who this actor is + which scenarios were checked" },
    "requirementMapping": { "0": { "scenarioRefs": [{ "story": "<story-id>", "scenario": "<scenario-id>" }], "evidence": "the prose explains what the referenced scenarios showed; the verdict itself is derived" } },
    "bigPictureSvg": "<svg viewBox=\"0 0 340 200\" aria-label=\"one sentence: what the diagram shows\">...</svg>",
    "bigPictureCaption": "one-line interpretation of the diagram"
  },
  "scenarios": {
    "<story-id>:<scenario-id>": { "observed": "what you did at this scenario's boundary and what the real software rendered, in plain language (the per-scenario reader proof; convert any curl/API transcript here — raw bytes stay in the audit)" }
  }
}
```

Check the narrative before rendering. `validate-narrative` runs every content
check without writing a report and lists every problem at once (it reads the
current session's recorded state):
```bash
bun ${CLAUDE_SKILL_DIR}/scripts/qa-state.ts validate-narrative --narrative <presentation>.json
```
`error:` lines (a retired field such as `bigPicture` or `satisfied`, a rejected
`bigPictureSvg`, QA-result words or a code name in reader prose, a missing
observation or screenshot) refuse the final render and make the command exit 1.
`gap:` lines (an empty slot, a requirement with no resolvable mapping) only render
a visible gap marker; the command still exits 0. Fix every `error:` and read every
`gap:` before rendering.

Render command (at STATE, once `qa-state.ts get` shows the computed verdict, before `complete`; it runs the same checks):
```bash
bun ${CLAUDE_SKILL_DIR}/scripts/qa-report.ts --session <id> --out <path> --narrative <presentation>.json
```

The report is a self-contained HTML page (inline `<style>`, zero runtime
`<script>`, zero external reference); `bigPictureSvg` is sanitized and inlined
(a disallowed construct, or the retired `bigPicture` field, aborts the render with
an error naming it). Any required slot left unwritten renders a **visible `gap`
marker** (`class="gap"`) — what was skipped shows in the report.

## Self-audit (after render, by eye)
- [ ] Does it open from **who is affected and why**, in product/user terms — not a
      code diff or test-result list?
- [ ] Are **all** affected users defined (admin / product / conditional / partner)
      — and any missing one fixed with `add-actor`, not invented in prose?
- [ ] Is each user's product (software + hardware) scenario flow rich and detailed,
      in what the user experiences — zero implementation mechanism (cache, id, type,
      function name), zero unit-test narration?
- [ ] Does **every verified scenario** carry its own reader-visible record — an
      observation plus before/after images for visual boundaries, or a grounded observation for text boundaries — with none separated from
      its proof and none left a silent hole (a card with neither is a loud gap)?
- [ ] Does **every scenario's** observation name its medium — a screen capture,
      an API/CLI response, or a named test — and claim only what that medium
      proves ("the app receives 3 days", not "the user saw 3 days" without a screen)?
- [ ] Does the big-picture diagram carry the user flow, with a why + interpretation
      · zero gap markers?
- [ ] Is each requirement mapped to a grounded verdict with a non-empty `scenarioRefs`
      array, exactly one current-cycle recorded scenario per ref, and status invariants
      that match pass/fail/blocked · do invalid mappings fail closed to a visible neutral
      gap · does prose explain a verdict without establishing it · any requirement
      never proven marked `unverified` (never `yes`/`partial`)?
- [ ] 쓰기 전에 소개 — every product/domain entity the reader meets (term/acronym/status
      label/risk name/diagram node) introduced in product language at first use ·
      no risk numbers/internal jargon or code symbols in the reader view · zero invention/contradiction
- [ ] Does every actor whose screen changed show a scenario card per device
      profile, each with before/after captures at that size that a person can read
      and use — and does the diagram stay legible in dark mode?

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
| "The tests are green, so the requirement is met." | Name the test that asserts it and say, in user terms, what it proves. A suite count proves nothing specific. |
| "Prose is enough; no diagram needed." | The big picture is the strongest way to convey flow to a no-context reader — it is a required slot. |
| "The scenario list is separate; evidence can live elsewhere." | Every scenario is shown with its evidence, even if the document grows heavy. |
| "I drove it with curl, so pasting the curl/HTTP output is the evidence." | A PO cannot read `HTTP=404` or a JSON body as "it works." Convert it, **naming the medium**: "via the API we requested another user's item and got a not-found with no data leak." Raw curl belongs in the audit. |
| "Showing the test output proves the scenario ran." | A test log is not something a PO reads. State the scenario and what the test asserts in words; the log stays in the audit. |

## Red flags — STOP
- The presentation opens with "what I changed (code)" → rewrite from "who is affected (users)"
- Implementation terms (cache, id, data type, function name) appear in a user narrative → rewrite in user terms
- A user flow slot holds raw test or build logs → replace with what was proven, in words
- A scenario shows a raw curl/HTTP/JSON dump (`HTTP=404`, `{"error":...}`, `table row count before=6`) as its proof → convert it to a natural-language "we ran this scenario and observed X"; the raw bytes belong in the audit section, not the reader
- A requirement was never proven but its prose reads as met → the verdict is derived, so fix the `scenarioRefs` (a requirement backed by a `blocked` scenario renders loud "미검증"); never add a `satisfied` field, the render refuses it
- A visual scenario lacks either an observation or before/after images → capture the missing asserted state, record its path, and render again. Text-boundary scenarios need a grounded `observed` explanation of the received output. `qa-report.ts` refuses a nonvisual or test-surface pass/fail scenario without `observed`.
- An observation says "the user saw" but no screen was captured → name the real medium (API response, test)
- Internal jargon (risk numbers, source tags) is visible to the reader → remove it
- The narrative names more users/scenarios/requirements than the records hold → invention; fix the records
- A fulfillment verdict contradicts the recorded pass/fail → match the verification log
- A gap marker remains → fill the required slot
