# Diagram type recipes

Companion to [SKILL.md section 8](../SKILL.md#8-diagram-type-recipes). Every directed graph in this file is
inline SVG with drawn edges. HTML boxes with text arrows are not allowed for any graph of 3 or more nodes
([section 7.6](../SKILL.md#76-directed-graphs-are-svg)). Colors come from page CSS classes and tokens, as in
section 7.2. Coordinates sit on the 4px grid. Labels follow the Korean label rules in section 7.3.

CSS classes used by the examples (define the ones you use):

```css
svg .box { fill: var(--surface); stroke: var(--line-strong); stroke-width: 1.5; }
svg .head { fill: var(--surface-2); stroke: var(--line-strong); stroke-width: 1.5; }
svg .rel { fill: none; stroke: var(--ink-2); stroke-width: 1.6; }
svg .mk-mut { fill: var(--ink-3); }
svg .t-b { font-weight: 700; }
svg .t-s { font-size: 12px; fill: var(--ink-2); }
svg .t-m { font-family: var(--mono); font-size: 12px; }
```

---

## Structure / architecture / dependency

Use for components and the paths between them in one snapshot.

- Columns are components, left to right in the direction of the main flow. Horizontal lanes are directions or
  channels (a "보내기" lane at y=146 and a "받기" lane at y=262 in every figure of the set).
- A boundary (process, device, network) is a container rect behind the nodes.
- Every dependency or call is a drawn edge with an arrowhead and a verb label. A node with no edge is a
  missing fact or a node that should go.
- The verdict strip at the bottom (`rect` in `--ok-bg` or `--bad-bg`, one line of text) states the outcome in words.

### Layered structure (a request passing through layers)

Draw the layers as stacked rects and the hops as vertical edges. Design it narrow-first (viewBox 340 wide), so
the one geometry works at 1280px and at 400px. Do not build this from HTML boxes and `↓` characters: a
`figure-graph-nosvg` error marks that pattern.

```svg
<svg viewBox="0 0 340 304" role="img" aria-label="요청이 게이트웨이, 서비스, 저장소 순서로 지난다. 서비스는 쓰기 전에 큐에 넣는다.">
  <defs><marker id="f1-ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" class="mk-mut"/></marker></defs>
  <!-- layers x=16 w=308 h=56; hops are 48px tall, labels beside the edge -->
  <path class="rel" d="M170 72 V120" marker-end="url(#f1-ah)"/><text class="t-s" x="182" y="100">요청 전달</text>
  <path class="rel" d="M170 176 V224" marker-end="url(#f1-ah)"/><text class="t-s" x="182" y="204">배치 쓰기</text>
  <rect class="box" x="16" y="16" width="308" height="56" rx="8"/><text class="t-b" x="32" y="40">게이트웨이</text><text class="t-s" x="32" y="60">인증 · 속도 제한</text>
  <rect class="box focal" x="16" y="120" width="308" height="56" rx="8"/><text class="t-b" x="32" y="144">서비스</text><text class="t-s" x="32" y="164">쓰기 전에 큐에 넣음</text>
  <rect class="box" x="16" y="224" width="308" height="56" rx="8"/><text class="t-b" x="32" y="256">저장소</text>
</svg>
```

---

## Sequence

Use for time-ordered messages between actors. At most 5 lifelines and 12 messages. Past that, split into the
happy path and a detail figure.

- Actors as boxes in a row at the top. A dashed lifeline descends from each. Time runs downward. No arrow
  points upward.
- **Activation bars.** While an actor handles a message, draw a narrow rect (10px wide, centered on its
  lifeline) from the message that starts the work to the message that ends it. A bar shows who is busy and for
  how long. A self-message gets a short bar that overlaps the first one.
- Message rows on a fixed pitch (40px). The label sits above its arrow on a surface-colored mask with a
  4px gap, at 12px weight 500.
- Call: solid line, filled arrowhead. Return: dashed line, filled arrowhead. Fire-and-forget event: dashed
  line, open arrowhead. The one message the claim turns on: the accent or `--bad`, solid.
- A self-message is a short U-turn on its own lifeline, label to its right.
- A failed delivery ends in a ✗ short of the target lifeline, with no arrowhead.
- A branch is a frame around only the lifelines involved, with a guard label in the page language
  (`[토큰 유효]`, `[그 외]`) and a dashed divider. At most one frame, one nesting level, two regions.
- Draw every message in the source, in the source's order. Count them against your inventory (section 13.1).

```svg
<svg viewBox="0 0 960 360" role="img" aria-label="JS 재로드 순간: 옛 시리얼 인스턴스가 같은 포트를 다시 열어, 새 인스턴스는 포트를 열지 못한다.">
  <defs>
    <marker id="f2-ah" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0 0L8 3L0 6z" class="mk-mut"/></marker>
    <marker id="f2-ah-open" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="8" markerHeight="6" orient="auto"><polyline points="0 0,8 3,0 6" class="mk-open"/></marker>
    <marker id="f2-ah-bad" viewBox="0 0 8 6" refX="7" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0 0L8 3L0 6z" class="mk-bad"/></marker>
  </defs>
  <!-- lifelines at x = 104, 292, 480, 668, 856; message rows every 40px from y=108 -->
  <line class="life" x1="104" y1="72" x2="104" y2="340"/> <!-- ...one per actor... -->
  <!-- activation bars: 10px wide, centered on the lifeline, drawn over it -->
  <rect class="act" x="475" y="108" width="10" height="144"/>
  <!-- call -->
  <path class="msg" d="M104 108 H475" marker-end="url(#f2-ah)"/>
  <rect class="mask" x="236" y="84" width="112" height="16" rx="2"/><text class="m" x="240" y="96">새 인스턴스 생성</text>
  <!-- event: dashed, open head -->
  <path class="msg ev" d="M856 148 H668" marker-end="url(#f2-ah-open)"/>
  <rect class="mask" x="650" y="124" width="224" height="16" rx="2"/><text class="m" x="654" y="136">권한 결과 방송 (옛 수신기도 받음)</text>
  <!-- the message the claim turns on -->
  <path class="msg key" d="M668 188 H856" marker-end="url(#f2-ah-bad)"/>
  <rect class="mask" x="672" y="164" width="180" height="16" rx="2"/><text class="m" x="676" y="176">같은 포트를 또 열기 → 성공</text>
  <!-- self-message -->
  <path class="msg" d="M485 228 H512 Q520 228 520 236 V244 Q520 252 512 252 H485" marker-end="url(#f2-ah)"/>
  <rect class="mask" x="528" y="232" width="100" height="16" rx="2"/><text class="m" x="532" y="244">포트 열기 실패</text>
  <!-- failed delivery: no head, a stop mark -->
  <path class="msg" d="M480 292 H824"/><path class="stop" d="M820 288 L828 296 M820 296 L828 288"/>
  <!-- actor boxes last: x = lifeline - 72, width 144 -->
  <rect class="box" x="32" y="20" width="144" height="52" rx="6"/><text class="t-b" x="104" y="42" text-anchor="middle">RN 런타임</text>
</svg>
```
```css
svg .life { stroke: var(--line-strong); stroke-dasharray: 3 3; }
svg .act { fill: var(--surface-2); stroke: var(--line-strong); stroke-width: 1.2; }
svg .msg { fill: none; stroke: var(--ink-3); stroke-width: 1.4; }
svg .msg.ev { stroke-dasharray: 5 4; }
svg .msg.key { stroke: var(--bad); stroke-width: 2; }
svg .mask { fill: var(--surface); }
svg .m { font-size: 12px; font-weight: 500; fill: var(--ink-2); }
svg .mk-mut { fill: var(--ink-3); } svg .mk-bad { fill: var(--bad); }
svg .mk-open { fill: none; stroke: var(--ink-3); stroke-width: 1.2; }
svg .stop { stroke: var(--bad); stroke-width: 1.6; fill: none; }
```

**Phone.** A sequence diagram keeps its lifelines on a phone. Do not turn it into a numbered list: a list drops
the actors and the time axis, which is the whole content. Put the figure in its own scroll container with
`min-width` equal to the viewBox width (drawn size 1:1, so labels stay at 12px), a visible hint ("그림은 좌우로
밀어서 볼 수 있어요"), and under it a message table shown at phone width only (columns: order, from, to,
message). When the claim fits 4 lifelines, a narrow variant of 352 viewBox width needs no scroll.

---

## State machine

Use for states, the transitions between them, and what moves each one.

- **Initial marker:** a filled dark circle (r=7) with one edge to the first state. **Final marker:** a bullseye
  (ring r=9, filled circle r=5) with an edge from each terminal state. A machine with no marker leaves the
  reader guessing where it starts and ends.
- **States** are rounded rects (8px radius). A **screen that is not a state** is a dashed rect on a tinted
  fill, and the legend says so.
- **Transitions** are drawn edges with a label: the event, then an optional guard (`제출 [서류 있음]`). One edge
  per transition in the source, including self-loops and the edges that return to an earlier state.
- **Gates** are diamonds that compute the route from facts. A dotted "사실 읽기" connector runs from the
  fact lane up to each gate. Put the full rule in a decision table, not in the figure.
- When some facts are stored but not shown, draw two lanes: the visible lifecycle (top) and the stored facts (bottom).
- Transitions are colored by the one meaning axis you chose (for example the acting party). A return path
  (retry) is dashed, declared in the legend.
- Up to 9 states per lane and 12 transitions per figure. A larger map is allowed only as a zoned, data-driven
  figure ([data-driven-and-interaction.md](data-driven-and-interaction.md)) with a scenario selector, up to about
  24 nodes.
- Phone: the SVG keeps its geometry. Scale down while labels stay at 12px, else scroll in its own container
  with a hint, plus a transition table shown at phone width (from, event, to).

```svg
<svg viewBox="0 0 340 240" role="img" aria-label="계약 상태: 초안에서 제출하면 검토, 승인되면 종료, 반려되면 초안으로 돌아간다.">
  <defs><marker id="f3-ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" class="mk-mut"/></marker></defs>
  <!-- initial marker -->
  <circle class="init" cx="32" cy="48" r="7"/>
  <path class="rel" d="M39 48 H72" marker-end="url(#f3-ah)"/>
  <rect class="box" x="76" y="28" width="88" height="40" rx="8"/><text class="t-b" x="120" y="53" text-anchor="middle">초안</text>
  <path class="rel" d="M164 48 H196" marker-end="url(#f3-ah)"/><text class="t-s" x="180" y="38" text-anchor="middle">제출</text>
  <rect class="box" x="200" y="28" width="88" height="40" rx="8"/><text class="t-b" x="244" y="53" text-anchor="middle">검토</text>
  <!-- reject: return edge, dashed, routed below both states -->
  <path class="rel ret" d="M244 68 V120 H120 V72" marker-end="url(#f3-ah)"/><text class="t-s" x="182" y="112" text-anchor="middle">반려</text>
  <!-- approve: edge to the final marker -->
  <path class="rel" d="M288 48 H312" marker-end="url(#f3-ah)"/><text class="t-s" x="300" y="38" text-anchor="middle">승인</text>
  <circle class="fin-ring" cx="324" cy="48" r="9"/><circle class="init" cx="324" cy="48" r="5"/>
</svg>
```
```css
svg .init { fill: var(--ink); stroke: none; }
svg .fin-ring { fill: none; stroke: var(--ink); stroke-width: 1.6; }
svg .rel.ret { stroke-dasharray: 6 5; }
```

---

## Data model (ERD)

Use for entities, their fields, and the relationships between them. Draw it as SVG. The relationships are
lines, not text.

- **Entity** = a table: a header row (entity name), then one row per field (field in mono, type, PK or FK mark).
  Draw the header as a `--surface-2` rect and each row as a text baseline on a `--surface` rect.
- **Relationship** = an orthogonal line from the FK row of one entity to the PK row of the other (or edge to
  edge when the fields are not drawn). The line ends where it meets the entity box.
- **Multiplicity at both ends**, as short labels next to the line end: `1`, `0..1`, `1..N`, `0..N`. Crow's foot
  (three short strokes) is allowed in addition, never instead of the label. Put a verb in the middle ("소속",
  "보유") when the source names the relationship.
- Draw every relationship in the source, including self-references (a line that leaves and re-enters the same
  entity) and join tables. Count them against your inventory (section 13.1).
- Never write a relationship only as text inside the card ("→ `household_id` 가구"). The text may repeat the FK
  name on its row. It does not replace the line.
- Gap between two entities that carry a line with multiplicity labels and a verb: 96px or more.
- Phone: the SVG keeps its geometry. Two entities fit a 352 viewBox with the line vertical. Three or more:
  scroll in the figure's own container with a hint, and add a relationship table shown at phone width only
  (columns: from, multiplicity, to, verb).

```svg
<svg viewBox="0 0 576 168" role="img" aria-label="가구 한 곳에 구성원이 0명 이상 속한다. 구성원은 household_id로 가구를 가리킨다.">
  <!-- entities: x=16 and x=360, w=200; header 32px, rows 24px -->
  <rect class="head" x="16" y="16" width="200" height="32" rx="6"/><text class="t-b" x="28" y="37">Household</text>
  <rect class="box" x="16" y="48" width="200" height="72"/>
  <text class="t-m" x="28" y="68">id</text><text class="t-s" x="204" y="68" text-anchor="end">PK</text>
  <text class="t-m" x="28" y="92">name</text>
  <rect class="head" x="360" y="16" width="200" height="32" rx="6"/><text class="t-b" x="372" y="37">Member</text>
  <rect class="box" x="360" y="48" width="200" height="96"/>
  <text class="t-m" x="372" y="68">id</text><text class="t-s" x="548" y="68" text-anchor="end">PK</text>
  <text class="t-m" x="372" y="92">household_id</text><text class="t-s" x="548" y="92" text-anchor="end">FK</text>
  <text class="t-m" x="372" y="116">role</text>
  <!-- relationship: PK row of Household to FK row of Member, then multiplicity labels at both ends and a verb -->
  <path class="rel" d="M216 64 H288 V88 H360"/>
  <text class="t-s" x="224" y="58">1</text>
  <text class="t-s" x="352" y="82" text-anchor="end">0..N</text>
  <text class="t-s" x="276" y="84" text-anchor="end">소속</text>
</svg>
```

---

## Timeline

Default to the CSS timeline in [SKILL.md section 6](../SKILL.md#6-component-vocabulary). Use an SVG horizontal
timeline only when the spacing between events is the point. Then draw it to scale on one axis, mark an elided
stretch with a visible axis break (two short slanted strokes and the elided duration as text), and put event
cards beside the axis, not on top of each other. Times keep the source's timezone, written once on the axis.

---

## Before / after comparison

Draw two or three figures (normal, broken, fixed) with the identical viewBox, columns, and lane y-values,
stacked vertically in the order the reader needs them. Only the elements that differ change: a box split in
two, a ✗ on an arrow, a held port block in `--warn`, a ghost dashed box for something removed. The caption of
the second figure names the difference ("그림 1과 같은 배치에서 시리얼 모듈 칸만 둘로 나뉩니다"). Side by
side only at 1100px and up, each half then designed narrow-first.

A before/after that differs only in attribute values, not in structure, is a table. A before/after whose
structure differs is these figures, even when a table could list the differences.
