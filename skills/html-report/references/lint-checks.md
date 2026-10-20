# Lint checks and their usual fixes

This file holds the lint check table and its notes from [section 14 (Self-critique loop)](../SKILL.md#14-self-critique-loop-mandatory) of SKILL.md.

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
