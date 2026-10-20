# Layout: page skeleton, phone strategy for figures, card grids

This file holds the page skeleton and the bodies of the two sub-sections of [section 5 (Layout)](../SKILL.md#5-layout) of SKILL.md.

## Page skeleton

The rules that govern it (gutter, two widths, `min-width: 0`, no sideways scroll) are in section 5 of SKILL.md.

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>디스펜서 USB 고착</title>   <!-- a 2-4 word name, not a summary -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
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

## Phone strategy for figures

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

## Card grids without orphans

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
