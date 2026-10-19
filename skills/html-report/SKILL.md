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
copies these rules. It points here and keeps only its own content rules.

**Output contract.**

- One `.html` file. All CSS and JS inline. No images except inline SVG or `data:` URIs.
- The only network request allowed is a Google Fonts stylesheet, and the page must still read
  correctly when it fails (offline, blocked). Verify with `capture.sh --offline`.
- Opens from disk (`file://`). No server, no fetch of local files.
- Works in light and dark themes, from 400px to 1280px+ wide, with no page-level sideways scroll.
- Complete at rest: everything the reader needs is visible after load, with no click, hover, or scroll
  needed to reveal it.
- Every directed graph with 3 or more nodes is inline SVG with drawn edges ([section 7.6](#76-directed-graphs-are-svg)),
  and a phone never changes what a diagram means ([section 5](#phone-strategy-for-figures)).
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
   (with `--source` when the source is on disk), look, fix, repeat. This step is not optional.
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
  [section 5](#phone-strategy-for-figures), which is hidden on wide screens.
- **Do not fragment a structure.** One structure that fits the budget of [section 12](#12-complexity-budget-and-the-split-rule)
  is one figure, not a row of 1 to 4 node figures that the reader must join in their head. Split only
  when the structure is over budget, and then as an overview plus a detail figure.

---

## 2. Page anatomy

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
2. Goal and principles (one stat tile only if a number motivates the design).
3. The main map: architecture or state machine, optionally with a scenario selector ([section 10](#10-interaction-patterns)).
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
  --bg: #0E1117; /* ... every dark value from the block above ... */
  color-scheme: dark;
}
body { background: var(--bg); color: var(--ink); }
```

Rules:

- **Every token gets its first definition on bare `:root`.** The dark blocks only redefine.
  A color that exists only inside a media or `[data-theme]` block is the classic unreadable-page bug.
- **`body` sets an explicit background** from a token. A transparent body shows whatever the viewer paints behind it.
- **No literal colors in components or in SVG.** Not in CSS rules, not in `fill="#fff"` attributes.
  A literal white box behind light-ink text is invisible in dark mode (the lint self-test plants
  exactly this defect). SVG shapes take colors from page CSS classes: `svg .box { fill: var(--surface); stroke: var(--line-strong); }`.
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

**Avoid the generated-looking defaults** unless the caller asks for one: warm cream with a serif
display and a terracotta accent; near-black with one acid-green or vermilion accent; hairline
broadsheet columns; a purple-to-blue gradient hero; Inter or Space Grotesk as the safe choice;
emoji section markers; everything centered; one large radius and one soft shadow on every block;
an accent rail on the side of rounded cards; tracked ALL-CAPS eyebrows above every heading.

---

## 4. Typography (Korean first)

- Set `<html lang="ko">` (or the page's language). The browser uses it for line breaking and font fallback.
- **Font stack.** Option A, proven in testing: IBM Plex Sans KR with IBM Plex Mono from Google Fonts.
  Option B: Noto Sans KR. Always end with the system Korean faces:

  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
  ```
  ```css
  --font: "IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif;
  ```
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
  With `break-all`, identifiers break visibly mid-word (`isBooted=fals` / `e`).
- **Headings** get `text-wrap: balance`. Digits that line up get `font-variant-numeric: tabular-nums`.
- **Mono is for technical tokens only:** identifiers, paths, ports, commands, field types. Never for
  names, UI labels, or Korean text (mono faces carry no Hangul).
- **No English UI chrome on a Korean page.** Write the legend title as "읽는 법" or "범례", lane labels
  as "보내기 / 받기", captions as "그림 1.", status as "확인됨 / 확인 못 함". Keep technical
  identifiers verbatim (`isBooted`, `HTTP 500`). No uppercase-and-tracked labels.

---

## 5. Layout

**Skeleton.**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>디스펜서 USB 고착</title>   <!-- a 2-4 word name, not a summary -->
<!-- font links -->
<style>
  /* layout comment + tokens (section 3) */
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.75 var(--font);
    padding-block: 40px 72px;
    padding-left: max(16px, env(safe-area-inset-left, 0px));
    padding-right: max(16px, env(safe-area-inset-right, 0px));
    word-break: keep-all; overflow-wrap: break-word;
  }
  .wrap { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 56px; }
  .col  { max-width: 720px; }
  section { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
  h1, h2, h3, p, ul, ol, figure, table { margin: 0; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
</style>
</head>
<body><main class="wrap"> ... </main></body>
</html>
```

**Rules.**

- **Side gutter of at least 16px at every width,** written as the two `max()` paddings above, set once
  on `body`. Give vertical padding with `padding-block`. Never a `padding` shorthand that zeroes the sides.
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

### Phone strategy for figures

**Layout never changes meaning.** A phone shows the same nodes, the same edges, and the same order as the
desktop. A reader must not see a transition on a phone that the desktop does not draw, or miss one that it does.

Never build a graph (flow, state machine, sequence, ERD, architecture) from HTML boxes that reflow. In testing,
a state diagram made of flex boxes stacked into one column at 400px. Boxes that sat side by side as unrelated
states then read as a chain of transitions that does not exist. The fix is the same at every width: a graph is
an SVG, and its geometry (positions, edges, order) does not change with the viewport.

Rendered text size is `font-size × (drawn width ÷ viewBox width)`. At a 400px viewport, a figure inside
a padded, bordered container has about 346px to draw in. A 13px label in an 840-wide viewBox renders at
about 5px there: unreadable. So every graph needs one of these strategies:

1. **Narrow-first, one geometry.** Design the figure at a viewBox width of 360 or less (13px labels then render
   at 12.5px or more on a phone). Flows run top to bottom, lanes become rows. The same SVG scales down from
   1280px to 400px. This is the default, and the only choice for the page's key figure when it fits.
2. **Scale down.** A wider drawing may shrink with `width: 100%` while every label stays at 12px or more
   (Hangul) or 11px or more (Latin) at 400px. Check the `svg-text-small` results of the 400px lint run.
3. **Scroll in its own container.** When labels would fall under that floor, set `min-width` to the value that
   keeps them at 12px (usually the viewBox width, so the drawing is 1:1). Then add all three:
   - the part the claim depends on at the *left*, which is the scroll start;
   - a visible hint ("그림은 좌우로 밀어서 볼 수 있어요");
   - an adjacent text table of every edge (columns: from, label or condition, to; for a sequence: order,
     from, to, message; for an ERD: from, multiplicity, to, verb), placed directly under the figure and
     shown at phone width only (`@media (max-width: 640px)`), so a wide screen does not repeat the figure.
4. **Two layouts of the same graph** (rare). A wide SVG and a narrow SVG swapped by width with `display: none`
   on the hidden one. Both must hold the same nodes, the same edges, the same labels and the same order, only
   re-arranged. Count nodes and edges in both. If a node or an edge exists in one only, use strategy 3.

```html
<figure>
  <div class="fig-scroll" tabindex="0" role="region" aria-label="그림 2 상태 전이, 좌우 스크롤">
    <svg viewBox="0 0 840 352" role="img" aria-label="(claim)">...</svg>
  </div>
  <p class="fig-hint">그림은 좌우로 밀어서 볼 수 있어요. 모든 전이는 아래 표에도 있어요.</p>
  <div class="edge-table table-scroll"><table>...</table></div>
  <figcaption>...</figcaption>
</figure>
```
```css
.fig-hint, .edge-table { display: none; }
@media (max-width: 640px) { .fig-hint { display: block; } .edge-table { display: block; } }
```

A key figure, the one the page's main claim rests on, uses strategy 1 or 2. In testing, a before/after figure
in a scroll container showed only its left 47% on a phone, so the changed half was off screen. `lint.sh`
reports every sideways-scrolling figure with the visible fraction (`figure-scrolls`).

HTML boxes may stay HTML only for content that is not a directed graph: cards, stat tiles, row lists, a
to-scale bar. They are never wrapped in a `<figure>` as if they were a diagram.

### Card grids without orphans

A grid of N cards must fill its rows at every breakpoint. `repeat(auto-fit, minmax(210px, 1fr))` with
five items at 1040px gives four columns and one lonely card with three empty cells beside it (seen in
testing). Pick the column count from the item count:

```css
.tiles { display: grid; gap: 12px; grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr)); }
@media (max-width: 900px) { .tiles { --cols: 2; } .tiles > :last-child:nth-child(odd) { grid-column: 1 / -1; } }
@media (max-width: 480px) { .tiles { --cols: 1; } }
```
```html
<div class="tiles" style="--cols: 4"> four tiles </div>
```

Use 2, 3, 4, or 6 items per row. Five items: show them as a vertical list (a sequence reads better as rows
anyway), or as 3 + 2 with the last two spanning. Let content set heights; nothing stretches over empty space.

---

## 6. Component vocabulary

Use card styling (border, fill, radius) by role, to set off the element that needs it, not on every
block. Radii stay at 6 to 10px. No shadows. Each component below is the minimum CSS; extend it from the tokens.

**Masthead.** A kicker line (status pill, page type, and a source date with timezone when the source gives one), the `h1` name, a lede paragraph,
and an optional stat strip.

```html
<header class="mast">
  <div class="kicker"><span class="pill bad">26대 고착 지속</span><span>사고 보고서 · 2026-10-17 (KST) 업데이트 후</span></div>
  <h1>디스펜서 USB 고착</h1>
  <p class="lede">...</p>
</header>
```

**Pills** carry state in form as well as color:

```css
.pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; line-height: 1.6; }
.pill.ok { background: var(--ok-bg); color: var(--ok); }
.pill.bad { background: var(--bad-bg); color: var(--bad); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
```

**Stat tiles.** Use them only when the numbers are the point. Each label says what the number counts and
its scope. Pick the column count from the item count (see above).

```css
.facts { display: grid; grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); border: 1px solid var(--line); border-radius: 10px; background: var(--surface); overflow: hidden; }
.fact { padding: 14px 18px; display: flex; flex-direction: column; gap: 2px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); margin: 0 -1px -1px 0; }
.fact b { font-size: 28px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.fact span { font-size: 14px; color: var(--ink-2); }
```

**To-scale bar.** For a share of a whole (41 of 1,620), draw the segments at their true widths and
label the small one beside the bar, not inside it.

```html
<div class="bar" role="img" aria-label="전체 약 1,620대 중 41대(2.6%)가 고착">
  <span class="seg ok" style="width:97.4%">나머지 정상</span><span class="seg bad" style="width:2.6%"></span>
</div>
```

**Row list** (symptom and reason, claim and evidence): a two-column grid that stacks below 640px.

```css
.row3 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr); gap: 4px 28px; padding: 16px 20px; border-top: 1px solid var(--line); }
@media (max-width: 640px) { .row3 { grid-template-columns: 1fr; } }
```

**Tables with pills.** Wrap every table in a scroll container; keep cells wrapping.

```css
.table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 15px; line-height: 1.6; }
th, td { text-align: left; vertical-align: top; padding: 12px 16px; border-top: 1px solid var(--line); }
thead th { border-top: 0; font-size: 13.5px; color: var(--ink-3); font-weight: 600; background: var(--surface-2); }
```

**Decision table** (condition to result, for gates and rules). Bold the result. Shade rows that apply
regardless of the other conditions (`tr.always td { background: var(--surface-2); }`). If the source
does not say which override wins, write that on the page ("둘의 우선순위는 문서에 없음"); do not invent an order.

**CSS timeline.** The default timeline: vertical, responsive, times in mono with tabular digits, the
timezone stated once in the section heading. A dashed connector marks elided time.

```css
.tl { list-style: none; padding: 0; display: flex; flex-direction: column; }
.tl li { display: grid; grid-template-columns: 78px 18px minmax(0, 1fr); gap: 0 14px; padding-bottom: 20px; }
.tl time { font-family: var(--mono); font-size: 14px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.tl .dot { position: relative; }
.tl .dot::before { content: ""; position: absolute; left: 50%; top: 9px; width: 12px; height: 12px; border-radius: 50%; transform: translateX(-50%); background: var(--surface); border: 2.5px solid var(--line-strong); z-index: 1; }
.tl .dot::after { content: ""; position: absolute; left: 50%; top: 21px; bottom: -20px; width: 2px; transform: translateX(-50%); background: var(--line); }
.tl li:last-child .dot::after { display: none; }
.tl li.bad .dot::before { border-color: var(--bad); background: var(--bad); }
.tl li.gap .dot::after { background: repeating-linear-gradient(to bottom, var(--line-strong) 0 4px, transparent 4px 9px); }
```

**Numbered steps** only for a real sequence. Numbering that does not encode order is decoration.
Highlight the step where things break (`li.hot::before { background: var(--bad); }`).

**Known / unknown panels.** Two panels side by side, stacking on a phone, each with a pill in its
heading ("확인됨", "확인 못 함"). List evidence on the left and inference or open questions on the right.

```css
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 16px; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 20px 22px; min-width: 0; }
```

**Callout.** At most one per section, for a rationale a reviewer would question ("관문을 서명이 아니라
「확인」에 둔 이유"). A tinted surface with a bold lead-in line. No colored side rail on a rounded card.

```css
.note { background: var(--surface-2); border-radius: 8px; padding: 16px 20px; max-width: 820px; }
.note b { display: block; margin-bottom: 4px; }
```

**Disclosure** for long evidence such as raw logs: `<details><summary>`. The summary line states the
gist, so the page is complete without opening it.

**Code block:** `<pre>` inside a scroll container, mono, 14px, no wrapping.

**Footer:** sources, in one or two lines.

---

## 7. Diagram rules

### 7.1 What to draw

- **Depict the mechanism, not its name.** A box labeled "cache" says less than the prose. The path a
  request takes through it, the two stores it sits between, and the arrow that disappears when it is
  removed say what words cannot. Draw the boundary crossed, the hop added, the data moved.
- **Draw the difference.** For before/after or option A/B, use the same layout and the same coordinates
  for every figure, and change only what differs. The reader should be able to point at the change.
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
  no literal hex in attributes. Give every drawn shape an explicit `fill` (`fill: none` for lines and paths).
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
geometry on a phone ([section 5](#phone-strategy-for-figures)); none of them becomes a numbered list or a
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
containers get `tabindex="0"`; nothing is hover-only; the default view shows everything.

---

## 11. Anti-patterns

| Anti-pattern | Why it fails | Do instead |
|---|---|---|
| Two edge labels sharing one stretch of space | They collide or read as one label | One label per route segment; offset routes 12px+ |
| Label sitting on its own arrow line | Text and stroke merge | Baseline 12px+ above the arrow; halo for near misses |
| Key figure in a sideways scroller at 400px | The changed half is off screen | Narrow-first or scale-down (section 5) |
| SVG text under 12px rendered (Hangul) or 11px (Latin) | Unreadable, muddy Hangul | Larger `min-width`, narrower viewBox, shorter labels |
| 4 + 1 card grid with empty cells | Looks broken, implies a missing item | Column count from item count; sequences as a list |
| English chrome on a Korean page ("LEGEND", "SEND / RECEIVE") | Mixed register, reads as template | "읽는 법", "보내기 / 받기" |
| Serif display face on a Korean page | Hangul falls back to a mismatched face | Korean sans, weight and size for hierarchy |
| Failure path faint, thin, or dashed | The key path disappears | Solid `--bad` at full weight with a ✗ stop |
| Literal color in SVG (`fill="#fff"`) | Breaks the other theme | Page CSS classes with tokens |
| `word-break: break-all` on code | Identifiers split mid-word | `word-break: normal; overflow-wrap: anywhere` |
| Table `min-width` wider than the phone | Columns clipped or hidden | `min-width: 0`, wrapping cells, a scroll container |
| Step badge on top of an edge label | Both unreadable | Badge at a node corner clear of labels |
| Text on a box's bottom edge | Looks clipped | 8px+ inside the edge |
| Dead band inside the viewBox | Wasted height, figure looks unbalanced | Crop the viewBox |
| Mono as the blanket "technical" font | Names and Hangul belong in sans | Mono for identifiers only |
| Identical boxes for every node | Erases hierarchy | Treatment by role: focal, store, external, screen |
| Legend floating among nodes | Collides with nodes | Bottom strip or HTML list beside the figure |
| Arrow label with no mask or halo over a line | The line runs through the text | Surface-colored mask or `paint-order: stroke` halo |
| Vertical `writing-mode` text | Unreadable | Horizontal labels beside vertical segments |
| Shadows; radius above 10px | Template look | 1px borders; 6 to 10px radius |
| Accent on every important node | No focal point | Accent on 1 to 2 elements per figure |
| Numbered markers on things that are not a sequence | Implies an order that does not exist | Numbers only for real sequences |
| Copying an automatic layout (Mermaid-style spacing) | Generic routing, no editorial choice | Lay out by hand on a grid |
| "예시" on real data, or real-looking numbers that are invented | Misleads the reader | Section 13 |
| Graph built from HTML boxes and `↓ →` glyphs (`figure-graph-nosvg`) | Boxes reflow on a phone, glyphs cannot show branches, joins, or returns | Inline SVG with drawn edges (section 7.6) |
| SVG boxes with no edges (`svg-no-edges`) | The reader cannot tell how the boxes relate | A path or line with an arrowhead for each relation |
| A phone layout that rearranges a graph's boxes | A flex state diagram stacked at 400px read as a transition that does not exist | Keep the SVG geometry; scale down or scroll in its own container, plus an edge table (section 5) |
| A source diagram replaced by a table or prose | The shape the reader came for is gone | Keep it as a figure; drop one only when the source has no structure to show (section 1) |
| ER relations written as card text ("→ `household_id`") | Cardinality and direction are invisible | Relationship lines with multiplicity at both ends (diagram-recipes.md, ERD) |
| Sequence on a phone as a numbered list | Actors and the time axis vanish | Keep lifelines; scroll in its own container with a message table |
| The same relations as a figure, a table, and cards | Three copies drift apart and bury the claim | One form per relation (section 1) |
| One structure split into several 1 to 4 node figures | The reader joins the pieces in their head | One figure within budget (section 12) |
| A fixed-width figure (`width: 960px`) | Breaks between 400px and 1280px | `width: 100%`, with `min-width` only in a scroll container |
| A writing date, "저는" or "I decided", or a mention of NOTES.md / SKILL.md on the page | The page speaks for its author, not its source | Dates, voice, and notes come from the source only (section 13) |
| A status the source never gives ("미판정", "pending review") | The page invents a verdict | Quote the source's own status (section 13.2) |
| Timestamps converted or stripped of timezone | Times mismatch their source | Keep the source timezone, state it |

---

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
- **Draw charts and bars to scale,** and check that parts sum to their whole (41 = 26 + 15).
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
looked at, and fixed, and the final round found nothing left to fix. Requirements: `agent-browser` and `jq`
on PATH. Install agent-browser with `npm i -g agent-browser && agent-browser install` if it is missing.

**Each round:**

```bash
OUT=./.visual-check/round-1
bash <skill-dir>/scripts/capture.sh report.html "$OUT"
bash <skill-dir>/scripts/lint.sh report.html --source <source-dir-or-file> > "$OUT/lint.json"
jq '.runs, .summary' "$OUT/lint.json"
jq -r '.findings[] | select(.severity != "info") | "\(.severity)\t\(.check)\t\(.viewport) \(.theme)\t\(.where)\t\(.text)\t\(.detail)"' "$OUT/lint.json"
```

For each interaction state, run both again with `--state` (one output directory per state):

```bash
bash <skill-dir>/scripts/capture.sh report.html ./.visual-check/round-1-s3 --state "window.__select('s3')"
bash <skill-dir>/scripts/lint.sh report.html --state "window.__select('s3')" > ./.visual-check/round-1-s3/lint.json
```

`--source` takes the directory (or one file) that holds the caller's source material. Leave it out when the
source is not on disk; then say so in your report. Once, before the final round, check the font fallback:

```bash
bash <skill-dir>/scripts/capture.sh report.html ./.visual-check/offline --offline
```

`capture.sh` writes, for 1280px light, 1280px dark, and 400px light: scrolled viewport frames (`-p01.png` ...),
one frame per `<figure>` (`-fig1.png` ...), and at 400px the far end of each sideways scroller (`-fig1-end.png`).
It prints `scrollWidth / innerWidth` per configuration. `lint.sh` prints one JSON document; `--strict` makes it
exit 2 when any error remains (the strict run is `bash <skill-dir>/scripts/lint.sh report.html --strict`).

**Lint receipt.** `lint.sh report.html [--source ...] --receipt <path>` also writes a JSON receipt to `<path>`
(atomic tmp + mv) when the run ends with 0 errors. The consuming skill decides the receipt path and passes it
to its submit command. Fields: `schema_version` (2), `html_sha256` (of the linted bytes, taken at lint start),
`html_path` (absolute), `errors`, `warnings`, `runs` (the three standard runs: 1280 light, 1280 dark, 400 light),
`source` (absolute `--source` path or null), `source_sha256` (sha256 of the `--source` file's bytes, taken at lint
start; null when `--source` is a directory or absent), `strict`, `lint_js_sha256`, `created_at` (UTC). With errors above 0,
or when the HTML or the source file changed during linting, no receipt is written. An old receipt at that path is never deleted;
a gate compares `html_sha256` to the submitted file and `source_sha256` to the current source file, so a receipt for
older bytes fails (a revised source needs a new lint run, because the source-aware checks ran on the old one). The receipt proves lint
ran clean on those exact bytes. It guards against mistakes (editing after lint, skipping lint); it is not
tamper-proof. Re-run lint with `--receipt` after every edit of the HTML. An example is in
`scripts/selftest/receipt.example.json`.

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

**Fix, then run the next round** into a new directory. Repeat until lint reports no errors and a full visual pass
finds nothing to fix. Run at least two rounds: in testing, the second round found a defect that the first
round's fix had introduced. Stop after the round that finds nothing; if a lint error remains by design, name it and the reason in
your report.

**Lint checks and their usual fixes:**

| Check | Meaning | Usual fix |
|---|---|---|
| `page-overflow`, `page-overflow-source` | The page scrolls sideways at 400px; the source element is named | `min-width: 0` on the flex/grid child, wrap or scroll the wide element |
| `svg-text-overlap` | Two SVG labels' glyph boxes intersect | Move one onto its own segment; shorten |
| `svg-text-outside` | SVG text extends past the `<svg>` viewport | Widen the viewBox or move the text in |
| `svg-text-on-stroke` | A line, path, or box outline passes through a label | Raise the label 12px+ above the line, or reroute |
| `svg-text-on-stroke-halo` (warn) | Same, but the label has a halo | Look at it; halos hide short crossings, not a label lying on its own arrow |
| `svg-text-small`, `svg-text-small-korean` | Rendered size under 11px, or Hangul under 12px | Larger `min-width`, narrower viewBox, shorter labels, or a narrow variant |
| `html-clipped`, `html-overflow` | Content cut by `overflow: hidden`, or spilling with no scroll container | Remove fixed heights/widths; wrap; add a scroll container |
| `figure-graph-nosvg` (error) | A `<figure>` with no `<svg>` draws a graph from HTML boxes or arrow glyphs (`↓ → ← ↑ ⇒`) | Redraw as inline SVG with drawn edges (section 7.6) |
| `svg-no-edges` (warn) | An SVG has 3 or more boxes and no path, line, or polyline edge | Draw the edges, or remove the boxes if they are not a graph |
| `number-not-in-source`, `masthead-date-not-in-source` (warn, only with `--source`) | A number or date on the page occurs in no source file | Copy it from the source, or label it as computed; drop an invented masthead date |
| `author-first-person` (warn) | "저는", "제가", "나는", or "I decided" on the page | Rewrite in the source's voice (section 13.3) |
| `authoring-notes-mention` (warn) | The page mentions NOTES.md, SKILL.md, or authoring notes | Delete the mention |
| `figure-scrolls` (warn under 60% visible) | A figure scrolls sideways at 400px | Fine for secondary figures; a key figure needs strategy 1 or 2 |
| `contrast` | Text below 4.5:1 (3:1 large) against its real background, per theme | Adjust the token for that theme; never a literal color |

Elements dimmed to under 50% opacity (unselected scenario paths) are skipped by the contrast check and counted
in the `contrast-sample` line. The self-test `bash <skill-dir>/scripts/lint_test.sh` checks that lint still
catches every planted defect and flags none of the clean fixtures; run it after changing `lint.js`.
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

---

## Background and attribution

This guide transcribes, for agents without access to them, the substance of Anthropic's design guidance for
claude.ai Artifacts (the `artifact-design`, `artifact-diagramming`, and `frontend-design` skills), with every
hosting-specific instruction removed (publishing, sandbox limits, the CDN allowlist, host metadata tags). It adds
rules from the MIT-licensed diagram-design project (anti-patterns, complexity budget, connector rules, accessible
SVG contract, Korean label rules, contrast contract, sequence-diagram grammar, the CSS-only `:has()` scenario
selector); see `NOTICE`. The defects named "seen in testing" come from a bake-off in which reports were authored
under these rules and critiqued from screenshots over three rounds, and from a blind-judged follow-up of 150
reports whose weak spots (graphs built from HTML boxes, source diagrams replaced by tables, invented statuses and
dates) produced sections 1, 5, 7.6, and 13. The finished pages are in `exemplars/`.
