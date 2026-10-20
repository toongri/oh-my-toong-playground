---
name: html-report
description: Shared guide for hand-authoring a single-file HTML report with inline SVG diagrams (flow, state, sequence, ERD, architecture) that reads well in light and dark themes, on a 400px phone and a 1280px desktop, in Korean or English, opened straight from disk. It also owns the mandatory screenshot-and-lint self-critique loop (scripts/capture.sh, scripts/lint.sh). Use when a skill or task must produce an HTML report, design doc, plan, diff explainer, or research report with figures. Report skills load it for form and checks; callers keep their own content rules (reader, required content, section order, evidence gates, output path).
---

# html-report: HTML reports with inline SVG

This guide teaches you to write one self-contained `.html` file by hand: prose, tables,
and inline SVG diagrams, with no diagram library and no build step. Any agent that has a
shell and file access can follow it. The only external tools are the `agent-browser` CLI
(a headless Chrome driver) and `jq`, both used by the scripts in `scripts/`.

**Division of labour.** A calling skill (an incident skill, a planner, a QA report, a diff
explainer, a research skill) decides *what* the page says: its sections, its claims, its
evidence. This guide decides *how* the page is built and checked. When the two conflict,
the caller's content rule wins and this guide's form rules adapt around it. A caller never
copies these rules. It points here and keeps only its own content rules. For form, the order is: the
user's own words, then the caller skill's form rules, then the target project's existing design system
(its tokens, theme file, component styles), then this guide's defaults. A project system supplies values
such as colors and faces. The theme structure of section 3 and the checks of section 14 still apply.

**Output contract.**

- One `.html` file. All CSS and JS inline. No images except inline SVG or `data:` URIs.
- The only network request allowed is a Google Fonts stylesheet, and the page must still read
  correctly when it fails (offline, blocked). Verify with `capture.sh --offline`.
- Opens from disk (`file://`). No server, no fetch of local files.
- Works in light and dark themes, from 400px to 1280px+ wide, with no page-level sideways scroll.
- Complete at rest: everything the reader needs is visible after load, with no click, hover, or scroll
  needed to reveal it. Nothing waits at `opacity: 0` for a scroll observer or an animation (lint: `hidden-at-rest`),
  and the masthead is as tall as its content, never `100vh`, so the first frame already shows the answer.
- Every directed graph with 3 or more nodes is inline SVG with drawn edges ([section 7.6](#76-directed-graphs-are-svg)),
  and a phone never changes what a diagram means ([section 5](references/layout.md#phone-strategy-for-figures)).
- Faithful to the source: no invented status, owner, date, number, or definition ([section 13](#13-fidelity-rules)).
- Passes the self-critique loop in [section 14](#14-self-critique-loop-mandatory) before you report it done.

`<skill-dir>` below means the directory that holds this file. The scripts are at `<skill-dir>/scripts/`.
Long reference material lives in `<skill-dir>/references/`:
[diagram-recipes.md](references/diagram-recipes.md) (per-type SVG recipes) and
[data-driven-and-interaction.md](references/data-driven-and-interaction.md) (generated maps, scenario selectors).
[diagram-classes.css](references/diagram-classes.css) (theme tokens and the `figure.diagram` SVG class palette, light and dark;
paste it into the page `<style>` as the starting point for diagrams that use the shared class names).
Two finished reports are in `<skill-dir>/exemplars/` (read `exemplars/README.md` first).

---

## 0. Workflow

0. **Check that each part earns its place.** The caller has chosen a page. Where a sentence says a thing
   faster than a figure, a table, or a card, write the sentence ([section 1](#1-draw-or-write)).
1. **Name the reader and the job.** One sentence: who reads this, and what they must be able to
   decide or explain after reading. Pick the page anatomy from [section 2](#2-page-anatomy).
2. **Inventory the source's diagrams.** Before you write, list every state, transition, message,
   relationship, and decision the source shows, as a table in your notes ([section 13.1](#131-source-diagram-inventory)).
   A source with no diagram and no structure gets an empty inventory.
3. **List the figures.** For each figure, write its claim as one sentence. Apply
   [section 1](#1-draw-or-write): one figure per claim, and the source's structure stays a figure.
4. **Write the token block** ([section 3](#3-design-tokens)) with a one-line layout comment above it.
5. **Build** the page from the components in [section 6](#6-component-vocabulary) and the
   diagrams in [sections 7 to 10](#7-diagram-rules).
6. **Reconcile with the inventory.** Map every inventory row to a figure, a table, or "omitted", and
   compare the counts ([section 13.1](#131-source-diagram-inventory)). Any omission is stated on the page with its reason.
7. **Run the self-critique loop** ([section 14](#14-self-critique-loop-mandatory)): capture, lint
   (with `--source` when the source is on disk), look, fix. Capture again only after a fix that changed
   layout, style, or an SVG; a text-only fix needs lint only. This step is not optional.
8. **Report** the file path, the rounds you ran, the final lint summary, the reconciliation counts,
   and what you could not verify ([section 15](#15-what-to-report)).

---

## 1. Draw or write

Draw when a cold reader must *see* a mechanism that prose makes them assemble in their head:

- where data or a request flows, and which boundary it crosses;
- which component talks to which, in which direction;
- what changes between two options or between before and after;
- which states a thing moves through, and what moves it;
- how messages between actors are ordered in time;
- how entities relate, and with what multiplicity;
- how events are spaced in time, when the gaps matter.

**A source diagram stays a diagram.** When the source already shows a structure (a flow, a state machine, a
sequence, an ER model, an architecture or dependency graph), the page keeps that structure as a figure. Never
replace it with a table or with prose. A table of transitions or a paragraph loses the shape the reader came
to see. Drop a source figure only when the source has no structure to show: a decorative image, or a plain
list of items that was drawn as boxes. State the omission on the page ([section 13.1](#131-source-diagram-inventory)).

For a figure you add yourself (the source has no diagram of it), write a sentence, a list, or a table instead when:

- the "diagram" would have one or two shapes (write the sentence);
- the content is a list of things or attributes (write a list or a table);
- a before/after differs only in attribute values, not in structure (write a table).

**The test for an added figure:** would the reader learn more from it than from a well-written paragraph?
If not, do not draw it. The test never applies to a diagram the source already has.

**Match complexity to the stakes.** A one-hop question is a three-box figure. A migration that
reroutes writes through a queue needs the writer, the queue, the reader, and the ordering arrow.
Draw what the decision turns on. Do not inventory the whole system.

**One figure, one claim.** If you cannot write the figure's claim as one sentence, you have not
decided what the figure is for. Two more rules follow:

- **Say each relation once.** Do not show the same relations as a figure, then a table, then cards. Pick the
  form that carries them best and refer to it. The one allowed repeat is the phone fallback table of
  [section 5](references/layout.md#phone-strategy-for-figures), which is hidden on wide screens.
- **Do not fragment a structure.** One structure that fits the budget of [section 12](#12-complexity-budget-and-the-split-rule)
  is one figure, not a row of 1 to 4 node figures that the reader must join in their head. Split only
  when the structure is over budget, and then as an overview plus a detail figure.

---

## 2. Page anatomy

Every page puts the answer before the evidence: the first screen states what happened, what was
decided, or what the reader must do. Then the detail follows. The skeletons list section
*types*, in order. The caller fills the content. Section order per anatomy kind:

- **Incident or finding report**: masthead, cause and action, impact, symptoms and reasons, normal mechanism (figure), broken mechanism (figure), how the failure formed, timeline, verified versus not verified, the fix (figure), rollout or next steps, sources footer.
- **Design document**: masthead and summary, goal and principles, the main map, decision tables, rationale callouts, open questions.
- **Plan**: goal and success criteria, current versus target, work breakdown, dependencies, risks table, verification, not in this plan.
- **Diff explainer**: what changed and why, before/after mechanism figure, one chapter per capability (use case), edge cases and risks, how it was verified.
- **Research report**: the question and the bottom-line answer, confidence summary, findings (claim, evidence, sources, status), comparison table or matrix, figures only for mechanisms or structural comparisons, contradictions and open questions, method and source list.

The numbered skeletons, with the content of each section, are in [references/page-anatomy.md](references/page-anatomy.md).

**Treatment.** Every page here is a working document. Give it a real type hierarchy, even spacing, and a
deliberate palette, and keep flourishes few. No viewport-tall hero, no decorative opener. Stat tiles open a
section only when the numbers are what the reader came for (an incident's impact). In a design document or a
plan, write a motivating number in a sentence.

**Subject detail.** Carry at least one detail that only this subject has: its units and scales, its document
conventions, its terms of art. Take it from the source; section 13.4 forbids inventing one.

---

## 3. Design tokens

Define every color as a CSS custom property. Use this exact shape so the page follows the
viewer's OS theme and also an explicit `data-theme` attribute on `<html>` if a host or a toggle sets one:

```css
/* Layout: one reading column; mechanism figures break out wider and scroll on their own at phone width. */
:root {
  --bg: #F3F4F8; --surface: #FFFFFF; --surface-2: #E9ECF3;
  --ink: #141821; --ink-2: #444C5C; --ink-3: #5B6477;
  --line: #D3D8E2; --line-strong: #98A0B3;
  --accent: #3340C9;
  --ok: #0B7A57;  --ok-bg: #DCF2E8;
  --bad: #C0301F; --bad-bg: #FBE3DF;
  --warn: #8F5400; --warn-bg: #FAEAC8;
  --font: "IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0E1117; --surface: #161A22; --surface-2: #1F242E;
    --ink: #E8EBF1; --ink-2: #B4BBC9; --ink-3: #8F98AA;
    --line: #2B313D; --line-strong: #566074;
    --accent: #9DAAFF;
    --ok: #4FD6A4;  --ok-bg: #11302A;
    --bad: #FF8A7E; --bad-bg: #3B1B18;
    --warn: #F3BC5C; --warn-bg: #392B10;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] { /* the same dark values again, so an explicit choice wins both ways */
  --bg: #0E1117; --surface: #161A22; --surface-2: #1F242E;
  --ink: #E8EBF1; --ink-2: #B4BBC9; --ink-3: #8F98AA;
  --line: #2B313D; --line-strong: #566074;
  --accent: #9DAAFF;
  --ok: #4FD6A4;  --ok-bg: #11302A;
  --bad: #FF8A7E; --bad-bg: #3B1B18;
  --warn: #F3BC5C; --warn-bg: #392B10;
  color-scheme: dark;
}
body { background: var(--bg); color: var(--ink); }
```

Rules:

- **Every token gets its first definition on bare `:root`.** The dark blocks only redefine.
  A color that exists only inside a media or `[data-theme]` block is the classic unreadable-page bug.
  Lint warns with `theme-state-mismatch` when an explicit `data-theme` choice does not switch the palette.
- **`body` sets an explicit background** from a token. A transparent body shows whatever the viewer paints
  behind it (lint: `body-bg-transparent`).
- **No literal colors in components or in SVG.** Not in CSS rules, not in `fill="#fff"` attributes.
  A literal white box behind light-ink text is invisible in dark mode (the lint self-test plants
  exactly this defect). SVG shapes take colors from page CSS classes: `svg .box { fill: var(--surface); stroke: var(--line-strong); }`.
  Lint flags a literal color on an SVG element (`svg-literal-color`).
- **Choose neutrals deliberately.** A grey with a slight hue bias toward the accent reads as chosen;
  pure mid-grey reads as a default.
- **Semantic colors are separate from the accent.** `--ok`, `--warn`, `--bad` (each with a tinted
  background) mean good, caution, broken. The accent marks links, focus, the selected control,
  and at most one or two focal elements per figure. It is not a status color.
- **One color, one meaning axis per page.** Pick the one dimension color encodes (path state, or
  acting party, or option) and keep it for the whole page. Encode a second dimension with shape,
  dash, or position, and say what each encoding means once, in the caption or a legend.
- **Design the dark theme; do not invert.** Lighten the semantic hues until they read on the dark
  surface, darken their tinted backgrounds, and keep the accent legible on both grounds.
- **Write the plan into the file:** 4 to 6 named color tokens, font roles, and a one-line layout
  concept as a comment above `:root`.

**Contrast contract** (WCAG 2.x, measured against the surface the element actually sits on, in both themes):

| Use | Minimum |
|---|---|
| Regular text, including muted, link, accent, or semantic colors used as text | 4.5:1 |
| Large text (24px+, or 18.7px+ at weight 700) | 3:1 |
| Essential non-text marks: lines, arrows, borders, focus outlines, data points | 3:1 against the adjacent color |
| Decorative rules and translucent tints | no minimum, but never the only carrier of meaning |

- A token used in several roles must pass each one. A semantic color that is a stroke in one place
  and a label in another is held to 4.5:1.
- Composite translucent colors over their real background before measuring.
- Text on a tinted surface (`--bad-bg`, `--surface-2`) is measured against that surface, not the page.
- `lint.sh` measures text contrast in both themes and reports every failure.
- Do not dim text the reader must read. Lint skips elements under 50% opacity, so a label drawn at
  `opacity: 0.4` is never measured. Dim only what a scenario selector deselects.

**Avoid the looks that read as machine-made** unless the user or the caller asks for one. A cream page
with a serif display face and a rust accent. A near-black page with one neon green or orange-red highlight.
Newspaper hairlines over dense columns. A hero that fades from purple to blue. Inter or Space Grotesk,
picked because it is safe. Emoji as section markers. Every block centered. One big radius and one soft
shadow on every block. A colored rail down one side of rounded cards. Tracked ALL-CAPS eyebrows over every
heading. Big-number tiles opening each section, 01 / 02 / 03 markers on content with no order, and a
middle-dot kicker of mood words (section 6).

---

## 4. Typography (Korean first)

- Set `<html lang="ko">` (or the page's language). The browser uses it for line breaking and font fallback
  (lint: `html-lang`).
- **Font stack.** Option A, proven in testing: IBM Plex Sans KR with IBM Plex Mono from Google Fonts (the
  `<link>` tags are in the [page skeleton](references/layout.md#page-skeleton)). Option B: Noto Sans KR. Always
  end with the system Korean faces, as the `--font` token in section 3 does.
- **No serif display face on a Korean page.** Latin serifs carry no Hangul, so the Korean half of a
  heading falls back to the platform's serif (or sans) and the two halves of one line disagree.
  Give headings their weight through size, weight (600 to 700), and tight letter-spacing (-0.01 to -0.02em).
- **Type scale.** Keep to it.

  | Role | Size / line-height / weight |
  |---|---|
  | h1 | `clamp(30px, 6vw, 46px)` / 1.2 / 700 |
  | h2 | 24px / 1.35 / 700 |
  | h3 | 17px / 1.4 / 600 |
  | body | 16px / 1.75 / 400 (15.5px below 640px) |
  | lede | 19px / 1.7 (17px below 640px) |
  | caption, table, small | 14 to 15px / 1.6 to 1.7 |
  | SVG label | 13px drawn, never below 12px rendered for Hangul or 11px for Latin |

- **Line length.** Keep running text at most 720px wide at 16px (about 45 Hangul syllables or 65
  Latin characters). Captions may run to 760px.
- **Korean line breaking.** On `body`: `word-break: keep-all; overflow-wrap: break-word;` so words
  are not split mid-syllable-group. On `code`: `word-break: normal; overflow-wrap: anywhere;`.
  With `break-all`, identifiers break visibly mid-word (`isBooted=fals` / `e`). Lint samples Korean blocks
  and warns when they lack `keep-all` (`word-break-korean`).
- **Headings** get `text-wrap: balance`. Digits that line up get `font-variant-numeric: tabular-nums`.
- **Mono is for technical tokens only:** identifiers, paths, ports, commands, field types. Never for
  names, UI labels, or Korean text (mono faces carry no Hangul).
- **No English UI chrome on a Korean page.** Write the legend title as "읽는 법" or "범례", lane labels
  as "보내기 / 받기", captions as "그림 1.", status as "확인됨 / 확인 못 함". Keep technical
  identifiers verbatim (`isBooted`, `HTTP 500`). No uppercase-and-tracked labels.
- **Title.** The `<title>` names the thing in 2 to 4 words, the way a document is named. Use the name the
  source or the caller already gives it (an incident name, a feature name). No category label alone
  ("보고서"), and no explainer after a colon or a dash ("결제 재시도: 설계 설명"). The explanation goes in the lede.
- **Page copy.** These rules cover the words the page adds: headings, labels, captions, hints, legends. They
  never license rewording text that the caller passes as source or requires verbatim.
  - Name things the way the reader knows them: a heading says "결제 알림 재시도" and keeps internal module
    names out. Identifiers that the source uses stay verbatim.
  - Use the active voice. A control says what it does ("표 펼치기"). A hint says how to proceed.
  - Write plainly, in short sentences. Avoid mannered devices: em-dash asides, "X가 아니라 Y다" framed for effect,
    a colon that sets up a reveal, scare quotes around a coined label, and stock openers such as
    "참고로", "주목할 점은", "솔직히 말하면" (in English, "worth noting", "honest caveat").

---

## 5. Layout

**Skeleton.** Start from the page skeleton in [references/layout.md](references/layout.md#page-skeleton). It holds
`lang`, the viewport meta with `viewport-fit=cover`, the `<title>`, the token block, the body gutter, the
`.wrap` stage and `.col` reading column, the flex sections with `gap`, the visible focus ring, and the
reduced-motion rule.

**Rules.**

- **Side gutter of at least 16px at every width,** written as `padding-left: max(16px, env(safe-area-inset-left, 0px))`
  and the matching `padding-right`, set once on `body`. Give vertical padding with `padding-block`. A `padding` shorthand would reset the side gutter, so do not use one.
- **Two widths.** A reading column (720px) for prose, and a wider stage (up to 1040 to 1240px) for
  figures and tables. Sections are flex columns with `gap`; do not space siblings with margins.
- **`min-width: 0`** on every flex or grid child that holds running text, code, or a table, so long
  content wraps or scrolls inside it instead of widening the page.
- **The page body never scrolls sideways.** At 400px, `document.documentElement.scrollWidth` must equal
  `innerWidth`. Only tables, diagrams, and code blocks may be wider than the screen, each inside its own
  scroll container:

  ```html
  <div class="fig-scroll" tabindex="0" role="region" aria-label="그림 2 고착 구조, 좌우 스크롤">
    <svg viewBox="0 0 840 352" ...>...</svg>
  </div>
  ```
  ```css
  .fig-scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  .fig-scroll svg { display: block; width: 100%; min-width: 760px; height: auto; }
  ```
  `tabindex="0"` lets keyboard users scroll it. Set `min-width` so the drawn text stays at or above 12px.
- **No table `min-width` wider than the phone** unless the table sits in a scroll container and the
  reader can tell it scrolls. A gate table with `min-width: 400px` clipped its result column at 400px
  in testing. Prefer `min-width: 0` and wrapping cells.
- **Give nothing a `min-width` wider than the screen** outside a scroll container. Images and
  `aspect-ratio` boxes get `max-width: 100%`.

- **No fixed-width figures.** A figure's CSS width is `100%` of its container. A `width: 960px` figure breaks
  the layout between 400px and 1280px. Only a figure that scrolls in its own container gets a `min-width`.
- **Repeated elements match.** Siblings of one kind (cards in a row, label and value pairs, pills on items)
  share edges, baselines, and inner padding, and a part that recurs keeps one position on each. Content
  decides a container's height. Long text gets room: it wraps, or it scrolls inside a container of its own.
  Cut-off text is a defect (lint: `html-clipped`).
- **Build cleanly.** Keep the skeleton's focus ring and reduced-motion rule. Close every non-void element and
  double-quote attributes. Give each spacing one owner, preferably the parent's `gap`: when two classes on
  one element both set padding or margin, the more specific one silently undoes the other.

### Phone strategy for figures

**Layout never changes meaning.** A phone shows the same nodes, the same edges, and the same order as the
desktop. A reader must not see a transition on a phone that the desktop does not draw, or miss one that it does.

Every graph needs one of four strategies: (1) narrow-first, one geometry (the default); (2) scale down; (3) scroll in its own container, with a hint and an edge table; (4) two layouts of the same graph (rare).
A key figure, the one the page's main claim rests on, uses strategy 1 or 2.
The strategy details and code are in [references/layout.md](references/layout.md#phone-strategy-for-figures).

### Card grids without orphans

A grid of N cards must fill its rows at every breakpoint. Pick the column count from the item count.
Use 2, 3, 4, or 6 items per row. The CSS and the five-item rule are in [references/layout.md](references/layout.md#card-grids-without-orphans).

---

## 6. Component vocabulary

Use card styling (border, fill, radius) by role, to set off the element that needs it, not on every
block. Radii stay at 6 to 10px. No shadows. Each component is the minimum CSS; extend it from the tokens.

Components: masthead, pills, stat tiles (only when the numbers are the point), to-scale bar, row list, tables with pills, decision table, CSS timeline, numbered steps (only for a real sequence), known / unknown panels, callout (at most one per section), disclosure, code block, footer.

The HTML and CSS for each are in [references/components.md](references/components.md).

**Structure is information.** A number, an eyebrow, a divider, or a part of the kicker states a fact about the
content. Numbered markers mark a real order. A kicker joins real facts only (page type, a source date with
its timezone), each in its own element; it is never a middle-dot string of mood words.

---

## 7. Diagram rules

### 7.1 What to draw

- **Depict the mechanism, not its name.** A box with the word "캐시" in it adds nothing to the prose. Draw
  what it does: the route a request follows through it, the store on each side of it, and the edge that
  vanishes once it is gone. Draw the boundary crossed, the hop added, the data moved.
- **Draw the difference.** For before/after or option A/B, use the same layout and the same coordinates
  for every figure, and change only what differs, down to the one edge an option adds or removes. The
  reader can then put a finger on the change.
  Separate boxes per option with nothing connecting them to the system are a restated list, not a comparison.
- **Label every arrow with a verb or a fact:** `쓰기`, `읽기`, `500ms마다 재시도`, `코드 13 거절`.
  An unlabeled arrow means only "related somehow".
- **Failure paths are first-class.** Draw the failing path at full weight in `--bad`, solid, ending in a
  clear stop mark (✗). A faint or dashed failure path makes the key path disappear (seen in testing).
  Dashed means one declared thing only (async, return, optional), stated in the legend.
- **Every node is a distinct idea.** Two nodes that always travel together are one node. A connection
  that layout already makes obvious can go. This applies to nodes you add. A node or an edge that the source
  draws stays (section 13.1).
- **Every edge is drawn.** A relation between two nodes is a line with an arrowhead (or a multiplicity mark),
  never a word, an arrow glyph, or the absence of a line. Boxes with no edges say only that the things exist.

### 7.2 Inline SVG mechanics

```html
<figure>
  <div class="fig-scroll" tabindex="0" role="region" aria-label="그림 1 정상 구조, 좌우 스크롤">
    <svg viewBox="0 0 840 320" role="img" aria-label="정상 구조: 보내기와 받기가 같은 시리얼 인스턴스를 지나 USB로 메인보드와 연결된다.">
      <defs>
        <marker id="f1-ah-ok" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0L10 5L0 10z" class="mk-ok"/>
        </marker>
      </defs>
      <!-- edges first, so nodes paint over line ends -->
      <line class="ln-ok" x1="168" y1="120" x2="344" y2="120" marker-end="url(#f1-ah-ok)"/>
      <text class="lbl" x="256" y="104" text-anchor="middle">부팅 확인 보내기</text>
      <!-- nodes -->
      <rect class="box" x="16" y="24" width="152" height="272" rx="10"/>
      <text class="t-b" x="92" y="52" text-anchor="middle">태블릿 앱 (JS)</text>
    </svg>
  </div>
  <figcaption><b>그림 1. 정상 구조에서는 보내기와 받기가 같은 인스턴스 하나를 지납니다.</b>
    <span class="vf">확인됨: 업데이트 전 4주의 로그가 이 모양입니다.</span></figcaption>
</figure>
```
```css
svg text { font-family: var(--font); font-size: 13px; fill: var(--ink); }
svg .t-b { font-weight: 700; }
svg .t-s { font-size: 12px; }
svg .box { fill: var(--surface); stroke: var(--line-strong); stroke-width: 1.5; }
svg .ln-ok { stroke: var(--ok); stroke-width: 2.5; fill: none; }
svg .mk-ok { fill: var(--ok); }
svg .lbl { paint-order: stroke; stroke: var(--surface); stroke-width: 5px; stroke-linejoin: round; } /* halo */
figcaption { max-width: 760px; font-size: 14.5px; color: var(--ink-2); }
figcaption .vf { display: block; margin-top: 6px; color: var(--ink-3); }
```

- **Size by `viewBox`.** Choose W and H for the content. Crop dead bands: a 56px empty strip above the
  drawing wasted space in testing; tighten the viewBox (`0 32 840 352`) instead of moving every shape.
  CSS scales it: `width: 100%; height: auto`. Never give a figure a fixed pixel width (no `width: 960px`).
- **Color through page CSS classes and tokens,** or `currentColor`. No `<style>` or `<script>` inside the SVG,
  no literal hex in attributes (lint: `svg-literal-color`). Give every drawn shape an explicit `fill` (`fill: none` for lines and paths).
- **Arrowheads are `<marker>` elements** (or small polygons), one marker per stroke color, with ids
  unique in the whole document. Prefix them with the figure slug (`f1-ah-ok`) so two figures never
  collide when one is copied. A single hidden `<svg width="0" height="0" style="position:absolute" aria-hidden="true">`
  holding shared `<defs>` also works.
- **Grid.** Put coordinates, widths, heights, and gaps on a 4px grid (8px for major spacing). Columns and
  lane y-values are shared constants, written in a comment at the top of the SVG. Shared baselines and
  even gaps are most of what makes a hand diagram look deliberate.
- **Text.** 13px labels and 12px secondary labels at a 1:1 drawn scale. At a 1280px viewport every label
  renders at 12px or more, so a drawing wider than its container needs larger source type or a `min-width`
  (a 1410-wide map drawn into 1040px renders 12px labels at about 9px). `text-anchor` for alignment. Short labels
  (a word to three). Sentences go in the caption. Place text by baseline `y`, not `dominant-baseline`,
  which renders inconsistently. Keep text at least 8px inside a box edge: a line at y=188 inside a box
  ending at y=190 sat on the border in testing.
- **Label halo.** `paint-order: stroke` with a `--surface` stroke lets a label sit near a line and stay
  readable. It does not license a label sitting *on* its own arrow: keep the last baseline of a label 12px
  or more above its arrow.
- **Accessibility.** `<svg role="img" aria-label="...">` carries the same claim as the caption. Or use
  `aria-labelledby` pointing at a `<title>` (first child) and `<desc>` with figure-prefixed ids
  (`f2-title`, `f2-desc`), never bare `title` / `desc`. Decorative SVG gets `aria-hidden="true"`.
- **No `<foreignObject>`.** HTML inside SVG does not scale or wrap predictably. Use `<text>` and `<tspan>`.
  Lint reports it as an error (`svg-foreignobject`). A shape that needs long hand-traced path data is
  decoration: simplify it to native shapes or drop it.
- **Caption = claim + epistemic status.** "그림 N." then the claim in bold, then one line saying what is
  verified and what is not: "확인됨: 고착 기기 10대의 Sentry 이벤트. 확인 못 함: 두 인스턴스의 생성
  순서는 로그로 재구성했으며 실기기에서 재현하지 않았습니다." A figure of a design that is not built yet says so.

### 7.3 Korean labels

- **Width budget.** Measure per character: every wide or full-width character (Hangul, CJK, full-width
  punctuation such as 「」) costs 1em; every other character costs about 0.6em (sans) or 0.62em (mono).
  Sum, multiply by the font size, add 12px padding on each side, and round the box up to a multiple of 4.
  `주문 v2.1` at 13px: 2 × 13 + 5 × 7.8 = 65px of text, so a 92px box. Count every character; a formula that
  counts only Hangul and Latin letters drops `2`, `.`, `1`.
- **12px floor, rendered.** Hangul goes muddy below 12px. If a Korean label does not fit at 12px rendered,
  shorten the label; do not shrink the type. `lint.sh` reports Korean SVG text below 12px and any SVG
  text below 11px.
- **Horizontal arrow labels need room.** A four-syllable Korean label at 12px is about 48px wide, so the
  gap between two nodes that carries it must be at least 56px, and 84px is comfortable. When the gap is
  smaller, cut the label to two or three syllables, move it beside a vertical segment, or move the detail
  to the caption or the step list.
- **Two-line labels.** Line pitch 16px for 12 to 13px text; the second line's baseline 12px or more above
  the arrow it describes.
- **Edge labels that share space collide.** Two labels for two edges that leave the same node in the
  same direction overlapped in testing. Give each its own segment: offset parallel routes by 12px or
  more, and place each label on the part of its own route that no other route uses.

### 7.4 Connector rules

1. **Orthogonal routes.** Connectors between nodes that are not aligned use right-angle elbows (optionally
   rounded at r=8). A straight line only when both ends share an x or a y. No diagonals.
2. **Label gap.** Each arrow label sits clear of its stroke, 6 to 10px away, beside vertical segments
   and above horizontal ones, never on the line.
3. **No overlaps.** No shared or stacked strokes. Offset parallel routes by 12px or more. At a single
   unavoidable crossing, draw a small bridge or gap.
4. **Separate attach points.** Connectors on one box edge each get their own point at `L × k / (N + 1)`,
   12px or more apart.
5. **No route behind a box that is not its endpoint.** Reroute. When it is geometrically unavoidable,
   dash the hidden part and put the label at the visible end.
6. **Label masks and badges do not cover other nodes.** A step badge or a label background must not sit
   on another node or another label (a step badge on a "650 미만" label was a defect in testing).

### 7.5 Legends

Add a legend only when an encoding (color, dash, shape) repeats. Otherwise put the meaning on the mark.
Title it in the page's language ("읽는 법"). Place it as a strip under the drawing or as an HTML list
beside the figure, never floating between nodes. Cover every encoding used and nothing else.


### 7.6 Directed graphs are SVG

Any directed graph with 3 or more nodes is inline SVG with drawn edges. This covers flows, state machines,
sequences, ER models, and architecture or dependency graphs. HTML cannot carry it, for three reasons: boxes
reflow on a phone and change which box is next to which; an arrow glyph (`↓ → ← ↑ ⇒`) between boxes cannot
show branches, joins, or returns; and a table or card list drops the shape the reader came to see.

- No graph from `<div>` boxes, CSS grid or flex layouts, `<ul>` chains, or text with arrow glyphs.
- Every edge is a `<path>`, `<line>`, or `<polyline>` with an arrowhead (or multiplicity ends for an ERD).
- A `<figure>` holds a diagram or a chart. Cards, stat tiles, tables, and code go outside a `<figure>`.
- Two nodes joined by one edge may be written as a sentence. That is the only case where HTML is enough.
- `lint.sh` enforces this. `figure-graph-nosvg` (error): a `<figure>` with no `<svg>` that has 3 or more sibling
  boxes laid out as nodes, or arrow glyphs between sibling boxes. `svg-no-edges` (warn): an `<svg>` with 3 or
  more box shapes and no path, line, or polyline edge.

---

## 8. Diagram type recipes

The full recipes, with SVG and CSS you can copy, are in [references/diagram-recipes.md](references/diagram-recipes.md).
A shared class palette (`box`, `head`, `focal`, `rel`, `msg`, `t-b`, ... with light/dark tokens) is in
[references/diagram-classes.css](references/diagram-classes.css); consumers that keep SVG class names in a source document
(explain-diff) start the page `<style>` from it.

Read the recipe for each type you draw. Every type is SVG with drawn edges. The musts per type:

| Type | Draw it as | Must include |
|---|---|---|
| Structure, architecture, dependency, flow | Boxes in columns or lanes, a container rect per boundary, orthogonal arrows | A verb label on every arrow, a verdict strip, every dependency the source shows |
| Sequence | Actor boxes, dashed lifelines, message rows on a 40px pitch | Lifelines, activation bars, call / return / event arrow styles, every message in source order |
| State machine | Rounded-rect states, labeled transition edges, gate diamonds when facts route the path | An initial marker and a final marker, one edge per transition, the event (and guard) on each edge |
| Data model (ERD) | Entity tables (header plus field rows) in SVG | A line per relationship, multiplicity at both ends, a verb when the source names it |
| Timeline | The CSS timeline of section 6, or a to-scale SVG axis when spacing is the point | The source's timezone, stated once; an axis break for elided time |
| Before / after | Identical layout and coordinates, only the difference changes | The same viewBox and lane y-values in every figure |

Read the recipe's phone paragraph for each type. A sequence, a state machine, and an ERD keep their SVG
geometry on a phone ([section 5](references/layout.md#phone-strategy-for-figures)); none of them becomes a numbered list or a
column of cards.

---

## 9. Data-driven SVG with a small script

For a map with more than about 12 nodes, generate the SVG from data with a small inline script, no library.
The page stays complete at rest: the script renders synchronously at load and draws the full view. Expose each
interaction state as a function (`window.__select('s3')`) so `capture.sh --state` and `lint.sh --state` can
check it. The code pattern is in
[references/data-driven-and-interaction.md](references/data-driven-and-interaction.md#data-driven-svg-with-a-small-script).
A generated map is still a directed graph: every edge in the data draws a path with an arrowhead
([section 7.6](#76-directed-graphs-are-svg)).

---

## 10. Interaction patterns

A scenario selector over one map, a CSS-only variant with radio inputs and `:has()`, disclosure, keyboard and
focus, and motion rules are in
[references/data-driven-and-interaction.md](references/data-driven-and-interaction.md#interaction-patterns).
The rules that always apply: every control is a real `<button>`, `<label>`, or link; focus is visible; scroll
containers get `tabindex="0"`; nothing is hover-only; the default view shows everything. A script that keeps a
view choice in `localStorage` wraps every read and write in `try/catch`, because a `file://` page may be denied
storage, and the page renders the same without it.

---

## 11. Anti-patterns

Top-line rules (full table with reasons: [references/anti-patterns.md](references/anti-patterns.md)):

- One label per route segment; offset routes 12px+.
- Narrow-first or scale-down for a key figure (section 5).
- Larger `min-width`, narrower viewBox, shorter labels for SVG text under 12px rendered (Hangul) or 11px (Latin).
- Solid `--bad` at full weight with a ✗ stop for a failure path.
- Page CSS classes with tokens, never a literal color in SVG.
- Inline SVG with drawn edges for every graph (section 7.6); keep the SVG geometry on a phone.
- Keep a source diagram as a figure (section 1); one form per relation (section 1).
- Dates, voice, and notes come from the source only (section 13).

---

## 12. Complexity budget and the split rule

Per figure:

| Limit | Value |
|---|---|
| Nodes | 9 |
| Arrows / transitions | 12 |
| Accent (focal) elements | 2 |
| Annotation callouts inside the figure | 2 |
| Sequence lifelines / messages | 5 / 12 |
| Sequence branch frames / regions / nesting | 1 / 2 / 1 |

**Over budget, split** into an overview (the happy path or the whole at low detail) and a detail figure (the
failure path, one subsystem). The one exception is a zoned, data-driven map with lanes and a scenario selector
(sections 9 and 10), up to about 24 nodes, where the selector does the splitting for the reader.

Before shipping each figure, run the remove test: can a node go, can two merge, can an arrow go because
layout already says it, can a label go because shape or color already says it? The test applies to nodes and
edges you added. It never removes a node or an edge that the source draws; over budget, you split the figure
(overview plus detail) and keep every source node and edge in one of the two.

---

## 13. Fidelity rules

The page is evidence. Form never changes content.

### 13.1 Source diagram inventory

Before you write, read the whole source and list every diagram element it shows, in prose, tables, or
drawings: each **state**, **transition**, **message**, **relationship**, **decision**, and **node**. Write the list
as a table in your notes (not on the page), one row per element:

| Kind | Element as the source names it | Where it goes |
|---|---|---|
| state | 검토 | figure 1 |
| transition | 검토 → 초안 (반려) | figure 1 |
| message | 토큰 갱신 요청 | figure 2 |
| relationship | 가구 1 : N 구성원 | figure 3 |
| decision | 서류 부족이면 반려 | decision table |

After you write, fill "Where it goes" for every row with a figure, a table, or "omitted", then **compare counts**.
For each kind, count the rows in the source and the elements on the page:

- Count what each figure draws. Every directed edge is one `marker-end` (or one path with a multiplicity
  mark), so `grep -c 'marker-end'` over the figure's SVG gives its edge count. Count nodes by their boxes.
- Source 7 states and 11 transitions must read as 7 and 11 across the figures that carry them. A state
  machine figure with 6 states against a source with 7 is a defect, not a rounding choice.
- Keep the source's direction, order, and labels. A message that goes from A to B stays A to B.
- **Show every omission on the page.** If an element is left out (over budget, no room, not relevant to the
  reader), write a visible line near the figure: "원문의 전이 3개(반려, 재제출, 취소)는 이 그림에 없습니다.
  이유: 이 보고서는 정상 경로만 다룹니다." A silent omission is a fidelity defect.

If the source has no diagram, no state, no transition, no message, and no relationship, the inventory is
empty and you skip the counts. You still follow the rest of this section.

### 13.2 Verdicts, owners, and certainty

- **Keep verdicts exactly as the source states them.** A source "충족" stays "충족". A source "미확인" stays
  "미확인". Do not soften, harden, or translate a verdict into another word.
- **Never invent a status.** The page uses the statuses the source uses, and only those. Turning a source
  "satisfied" into "미판정", "partially met", or "pending review" is an invented status. If the source gives
  none, the page gives none.
- **Keep the decision owner.** Who decided, who approved, who must act: copy it. Do not assign an owner the
  source does not name, and do not drop one it does.
- **Keep the certainty.** "확인됨", "추정", "미확인" and their equivalents keep their strength. Do not turn a
  guess into a fact, or a fact into a guess.
- **Do not settle what the source leaves open.** When the source does not say which of two rules wins, why a
  choice was made, or what happens next, write that it is open ("원문에 없음"). Do not pick, and do not
  explain the gap away.

### 13.3 The page has no author

- No author first person: no "저는", "제가", "나는", "I decided", "I chose". The page speaks as its source.
- No mention of authoring tools or notes on the page: NOTES.md, SKILL.md, this guide, the critique loop.
  A footer lists the source's own sources, not how the page was made.
- No writing date. The masthead carries only a date the source gives, with the source's timezone.
- No glossary or definition the source does not give. Do not define a term from your own knowledge, and do
  not add a "용어" box. If the reader needs a term explained and the source has no definition, say nothing.

### 13.4 Numbers, units, and examples

- **Never invent data.** Every number, name, time, and quote comes from the caller's sources. A figure shows
  only what the text supports. If a value is missing, the page says it is missing. A number you computed
  (a percentage, a sum) says it is computed and shows its inputs.
- **Keep source units and timezones.** If the logs are in KST, the page shows KST and says so once
  ("2026-10-17 (KST)"). If sources mix timezones, show each with its zone; convert only when asked, and then
  show the original too.
- **Label examples correctly.** "예시" or "예:" marks illustrative values only. Real figures never carry it,
  and illustrative values never appear without it. A sample row in a design doc is labeled as a sample.
- **Draw charts and bars to scale,** and check that parts sum to their whole (41 = 26 + 15). Marks, ticks, and
  labels share one scale, every tick label names a value the chart reaches, and the viewBox leaves room for
  the outermost labels.
- **Captions state epistemic status:** verified (with the source), inferred, or not verified. A figure of
  an unbuilt design says it is a design.
- **Gaps in the source stay visible.** When the source does not settle a question, write that on the page
  instead of choosing.
- **Numbers in a figure match the text exactly,** including rounding.
- When the source is on disk, run `lint.sh --source <dir>`. It warns on every number or date on the page that
  no file under the source contains (`number-not-in-source`, `masthead-date-not-in-source`). Each warning is
  either a copy error to fix or a computed value to label as computed.

---

## 14. Self-critique loop (MANDATORY)

You are not done when the HTML is written. You are done when the rendered page has been captured, linted,
looked at, and fixed, the last look found nothing that needs a layout or style fix, and the last lint run
ended with no errors. Requirements: `agent-browser` and `jq`
on PATH. Install agent-browser with `npm i -g agent-browser && agent-browser install` if it is missing.

**A full round** (capture, lint, look):

```bash
OUT=./.visual-check/round-1
bash <skill-dir>/scripts/capture.sh report.html "$OUT"
bash <skill-dir>/scripts/lint.sh report.html --source <source-dir-or-file> --strict > "$OUT/lint.json"
jq '.runs, .summary' "$OUT/lint.json"
jq -r '.findings[] | select(.severity != "info") | "\(.severity)\t\(.check)\t\(.viewport) \(.theme)\t\(.where)\t\(.text)\t\(.detail)"' "$OUT/lint.json"
```

For each interaction state, run both again with `--state` (one output directory per state):

```bash
bash <skill-dir>/scripts/capture.sh report.html ./.visual-check/round-1-s3 --state "window.__select('s3')"
bash <skill-dir>/scripts/lint.sh report.html --state "window.__select('s3')" --strict > ./.visual-check/round-1-s3/lint.json
```

`--source` takes the directory (or one file) that holds the caller's source material. Leave it out when the
source is not on disk; then say so in your report. Once, after the last layout or style fix, check the font fallback:

```bash
bash <skill-dir>/scripts/capture.sh report.html ./.visual-check/offline --offline
```

`capture.sh` writes, for 1280px light, 1280px dark, and 400px light: scrolled viewport frames (`-p01.png` ...),
one frame per `<figure>` (`-fig1.png` ...), and at 400px the far end of each sideways scroller (`-fig1-end.png`).
It prints `scrollWidth / innerWidth` per configuration. `lint.sh` prints one JSON document. Pass `--strict` on
every lint call: the JSON stays the same, and the exit code is 2 while an error remains. When the caller asks for
a receipt, add `--receipt <path>` to that same call; there is no separate strict run.

**Lint receipt.** With `--receipt <path>`, a run that ends with 0 errors also writes a JSON receipt bound to
the exact HTML bytes (and the `--source` file's bytes). The consuming skill chooses the path and its gate checks
`schema_version`, `errors`, `html_sha256`, `html_path`, `runs`, `source`, and `source_sha256`; the fields
`warnings`, `lint_js_sha256`, and `created_at` are audit-only. Re-run lint with `--receipt` after every edit of
the HTML. Field meanings and the write rules are in [references/lint-checks.md](references/lint-checks.md#lint-receipt).

**Look at every frame.** Open each PNG with your environment's image viewer or file reader that renders images.
If you cannot view images, say so in your report and rely on lint alone; never claim a visual check you did not do.
Check each frame for:

1. Overlapping or touching labels; labels on lines; badges on labels.
2. Text on or outside a box edge; text cut at the figure edge.
3. A figure's key difference visible at 400px without scrolling (see `-fig*.png` at 400).
4. Grids with empty cells; cards of uneven height in one row.
5. Dark theme: any box, text, or line that disappeared or turned into a bright block.
6. English chrome or ALL CAPS on a Korean page; fallback-font glyph mismatch (offline frames).
7. The failure path at least as visible as the success path.
8. Every number, time, and timezone matches the source.
9. The first frame (`-p01`) states the page's answer.
10. Each graph at 400px (`-fig*.png` and `-fig*-end.png`) has the same nodes, edges, and order as at 1280px.
    No box moved next to another box that it is not related to.
11. Every figure against the inventory of section 13.1: count its states, transitions, messages, and
    relationships in the screenshot, and compare with the source counts. Each omission is stated on the page.
12. Verdicts, owners, and certainty words match the source. No new status word, no first person, no
    writing date, no definition the source lacks.

**Fix, then choose the next check by what the fix touched.**

- **Layout, CSS or tokens, an SVG (its text included), or a figure's geometry:** run a full round into a new
  directory. In testing, a geometry fix introduced a defect that only the next capture showed.
- **Only HTML text outside any SVG** (wording, a caption, a number copied from the source): re-run lint, which
  is cheap. A new capture of unchanged geometry finds nothing new, so skip it.
- **Stop** when the last look found nothing that needs a layout or style fix and the last lint run has no errors.
  If a lint error remains by design, name it and the reason in your report.

**Lint checks and their usual fixes:** the check table (check, meaning, usual fix) is in
[references/lint-checks.md](references/lint-checks.md). The checks that matter most: `page-overflow`, `svg-text-overlap`,
`svg-text-small-korean`, `figure-graph-nosvg` and `svg-foreignobject` (errors), `figure-scrolls`, `contrast`.

Lint cannot see everything. It cannot count a source's transitions, judge a verdict, or see a reflowed
graph inside a `<div>` that is not a `<figure>`. Sections 13.1 and 13.2 and the frame checklist above are the checks for those.

---

## 15. What to report

Return to the caller: the absolute path of the HTML file; the number of critique rounds and what each fixed; the
final `summary` from `lint.sh` with any remaining errors and why they remain; the reconciliation of section 13.1
(per kind: source count, count on the page, and each omission with its reason); whether `--source` was used; the
receipt path when the caller required one (`--receipt`, section 14); which
states and the offline view you captured; and anything you could not verify (for example, "contrast inside the
map was not measured for the hover state").
