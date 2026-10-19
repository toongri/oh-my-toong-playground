# Data-driven SVG and interaction patterns

Companion to [SKILL.md sections 9 and 10](../SKILL.md#9-data-driven-svg-with-a-small-script). Use it for a
map with more than about 12 nodes, or for a page with a scenario selector. A data-driven map is still a
directed graph: every edge in the data array draws a path with an arrowhead, and the figure obeys
[section 7.6](../SKILL.md#76-directed-graphs-are-svg).

## Data-driven SVG with a small script

For a map with more than about 12 nodes, or with interaction, generate the SVG from data with a small inline
script. No library. The page must still be complete at rest: render synchronously at load, open in the full
view (every path visible), and never wait for a click to draw anything.

```html
<div id="map"></div>
<script>
(function () {
  var nodes = [ { id: 'draft', x: 64, y: 140, w: 88, h: 48, t: '작성 중' } /* ... */ ];
  var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
  function port(id, side) { var n = byId[id];
    return side === 'r' ? [n.x + n.w / 2, n.y] : side === 'l' ? [n.x - n.w / 2, n.y] : side === 't' ? [n.x, n.y - n.h / 2] : [n.x, n.y + n.h / 2]; }
  // an edge: actor (colour axis), from/to ports, optional elbow points, a label placed by hand
  var edges = [ { id: 'e1', a: 'cust', p: [port('draft', 'r'), port('submit', 'l')], l: { x: 137, y: 132, lines: ['제출'] } } ];
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function d(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' '); }
  var s = '<svg viewBox="0 0 1410 620" role="img" aria-label="(the claim)"><defs>...</defs>';
  edges.forEach(function (e) {                      // edges before nodes
    s += '<g class="el edge a-' + e.a + '" id="' + e.id + '"><path d="' + d(e.p) + '" marker-end="url(#m-' + e.a + ')"/>';
    s += '<text class="elbl" x="' + e.l.x + '" y="' + e.l.y + '" text-anchor="middle">' +
         e.l.lines.map(function (t, i) { return '<tspan x="' + e.l.x + '" dy="' + (i ? 15 : 0) + '">' + esc(t) + '</tspan>'; }).join('') + '</text></g>';
  });
  nodes.forEach(function (n) { /* rect + text per node, class "el node" */ });
  document.getElementById('map').innerHTML = s + '</svg>';
})();
</script>
```

- Keep coordinates on the 4px grid and route edges by hand as point lists. Adding a node means re-routing by
  hand; budget for it.
- Escape every string you insert into markup.
- Put the script at the end of `body`. Expose a function for each interaction state (for example
  `window.__select('s3')`) so `capture.sh --state` and `lint.sh --state` can check each state.
- A drawing this large usually renders below 1:1 on a laptop. Check the rendered label size in the lint output;
  in testing a 1410-wide map rendered at 0.86 scale and its 12px edge labels came out at 10.3px.

---

## Interaction patterns

**Scenario selector over one map.** A row of tab buttons ("전체" first and selected at load), one per
scenario. Selecting a scenario dims every element off its path to about 15% opacity, thickens the path, and
fills a numbered step list whose numbers also appear as badges on the map nodes.

- Markup: `role="tablist"` on the row, `<button role="tab" aria-selected="true|false">` for each, a description
  line with `aria-live="polite"`.
- Put the step list beside the map at 1100px and up, or directly under it with the description above the map,
  so the reader sees map and steps together. A list far below the map was a weakness in testing.
- Badges go at a node corner clear of every edge label; check each scenario's screenshot for badge collisions.
- The default "전체" view must read on its own: every path drawn at full strength, the legend visible.

**CSS-only alternative** with radio inputs and `:has()`, when the page should run no script:

```html
<div class="sm">
  <input class="sr" type="radio" name="sc" id="sc-all" checked>
  <input class="sr" type="radio" name="sc" id="sc-1">
  <div class="tabs"><label for="sc-all">전체</label><label for="sc-1">650점 이상</label></div>
  <svg ...><g class="el node" data-sc="1 2">...</g></svg>
</div>
```
```css
.sr { position: absolute; opacity: 0; pointer-events: none; }
@supports selector(:has(*)) {
  .sm:has(#sc-1:checked) .el:not([data-sc~="1"]) { opacity: .16; }
  .sm:has(#sc-1:checked) .el.edge[data-sc~="1"] path { stroke-width: 3; }
  .sm:has(#sc-1:checked) label[for="sc-1"] { background: var(--surface-2); border-color: var(--accent); }
  .sm:has(#sc-1:focus-visible) label[for="sc-1"] { outline: 2px solid var(--accent); }
}
```
Radios give keyboard support (arrow keys) for free. Without `:has()` support, `@supports` leaves the full map
and every step list visible. The cost is one rule set per scenario.

**Disclosure.** `<details>` for secondary evidence. Its `<summary>` states the conclusion.

**Keyboard and focus.** Every control is a real `<button>`, `<label>` for a radio, or link. Focus is visible
(`:focus-visible` outline in the accent). Scroll containers get `tabindex="0"`. Nothing is hover-only.

**Motion.** Transitions only to show what changed after an action (150 to 200ms opacity). Under
`prefers-reduced-motion: reduce`, turn them off.

---

