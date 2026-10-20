# Component vocabulary

This file holds the full body of [section 6 (Component vocabulary)](../SKILL.md#6-component-vocabulary) of SKILL.md.

Use card styling (border, fill, radius) by role, to set off the element that needs it, not on every
block. Radii stay at 6 to 10px. No shadows. Each component below is the minimum CSS; extend it from the tokens.

**Masthead.** A kicker line (status pill, page type, and a source date with timezone when the source gives one), the `h1` name, a lede paragraph,
and an optional stat strip.

```html
<header class="mast">
  <div class="kicker"><span class="pill bad">26대 고착 지속</span><span>사고 보고서</span><time datetime="2026-10-17">2026-10-17 (KST)</time></div>
  <h1>디스펜서 USB 고착</h1>
  <p class="lede">...</p>
</header>
```
```css
.kicker { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; font-size: 14px; color: var(--ink-2); }
```

Each kicker part is one fact in its own element, spaced by `gap`. Add a part only when the source gives it.

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
