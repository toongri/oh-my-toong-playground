# Exemplars

Two reports hand-authored under the rules in `../SKILL.md` and critiqued from screenshots over three rounds.
They won a bake-off against a diagram-library route and a layout-engine route. They are reference material,
not templates to fill. Read them for the patterns listed below. Both pass `../scripts/lint.sh --strict` with 0
errors at 1280px light, 1280px dark, and 400px light (report2 in every scenario state, `s1` to `s5`). The
warnings that remain are listed under each report.

Every graph in both reports is inline SVG with drawn edges, so neither trips `figure-graph-nosvg` or
`svg-no-edges`. Both were edited after the bake-off to meet the current rules: removal of a host-specific
`<meta>` tag, larger phone `min-width` so SVG labels stay at 11px or more, a visible scroll hint, and the
fixes named below.

## report1.html — incident report (디스펜서 USB 고착)

No script. Pure HTML, CSS, and inline SVG.

What it demonstrates:

- The incident anatomy from `../references/page-anatomy.md` (SKILL.md section 2): status pill masthead, cause and action first, impact as a
  to-scale bar, symptom-to-reason rows, normal / broken / fixed mechanism figures, numbered formation steps,
  a one-device timeline with timezone, verified versus not-verified panels, fix list, rollout, repro plan.
- **Before / after on one grid.** Figures 1, 2, 3 share the viewBox (`0 32 840 352`), the column x-values,
  and the two lane y-values (보내기 y=146, 받기 y=262). Only the difference changes: the split module box,
  the ✗ on the send path, the amber held-port block, the ghost box for the removed instance.
- Token system with light and dark blocks; semantic colors (`--ok`, `--bad`, `--warn`) separate from the accent;
  one color axis (path state).
- Figure captions that state the claim in bold and then a "확인됨 / 확인 못 함" line.
- Shared hidden `<svg><defs>` for arrowhead markers; label halos (`paint-order: stroke`).
- CSS timeline with a dashed connector for elided time (03:13 to 08:52).
- Korean typography: IBM Plex Sans KR with system fallbacks, `word-break: keep-all`, code with
  `overflow-wrap: anywhere`.
- Phone strategy 3 of `../references/layout.md` (SKILL.md section 5): each mechanism figure scrolls in its own container at a 900px
  `min-width` (labels stay at 11.5px or more), with a hint line. The numbered formation steps below the
  figures carry the same sequence as text.

Remaining warnings (do not copy):

- `figure-scrolls` (3): each mechanism figure shows 40% of its width at rest at 400px. SKILL.md would ask for
  narrow-first or an adjacent edge table for a key figure. This report keeps the hint and the step list.
- `svg-text-on-stroke-halo` (5): the labels "USB로 쓰기" and "USB에서 읽기" cross the USB-port outline. The halo
  keeps them readable.

## report2.html — design document (렌탈 신용심사 상태 지도)

One inline script builds the SVG from data and drives the tabs.

What it demonstrates:

- The design-document anatomy: goal and principles, one main map, decision tables per gate, a rationale callout.
- **Data-driven SVG** (`../references/data-driven-and-interaction.md`): `nodes`, `edges`, `reads`, and `scenarios`
  arrays, a `P(id, side)` port function, hand-routed orthogonal edges as point lists, labels with explicit
  coordinates, `esc()` for inserted text.
- **State machine with lanes and gates:** visible contract states above, stored credit facts below, diamond gates,
  dotted "사실 읽기" connectors from facts to gates, dashed box for a screen that is not a state, a dark pill for
  the Meta conversion event, actor (고객 / 시스템 / 운영자) as the single color axis.
- **Scenario selector:** "전체" selected at load with every path drawn; a scenario dims the rest to 13%
  opacity, thickens its path, adds numbered badges, and fills a step list. `window.__select('s3')` exposes
  each state to `capture.sh --state` and `lint.sh --state`.
- Decision tables with shaded "always" rows, and an explicit note where the source gives no precedence.
- The map is drawn at 1410 and laid out at a 1560px `min-width`, so its 12px labels render at about 13px. It
  therefore scrolls in its own container at every width, with a visible hint.

Remaining warnings (do not copy):

- `figure-scrolls` (1): 23% of the map is visible at rest at 400px. A chosen scenario's step list carries its
  path as text; the whole-map view has no text edge table.
- `svg-text-on-stroke-halo` (2): the two "사실 읽기" labels are centered on their dotted connectors.
- The step list sits below the map, so map and steps are not on screen together on a laptop. `../references/data-driven-and-interaction.md`
  (SKILL.md section 10) asks for the list beside the map at 1100px and up.
