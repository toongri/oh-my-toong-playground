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
| `svg-foreignobject` (error) | An SVG embeds HTML through `<foreignObject>` | Draw the content with `<text>` and `<tspan>` (section 7.2) |
| `svg-literal-color` (warn) | An SVG element holds a literal color in `fill`, `stroke`, `stop-color`, or `color` (attribute or inline style) | A page CSS class that reads a token, or `currentColor` (section 3) |
| `html-lang` (warn) | `<html>` has no `lang` attribute | `<html lang="ko">` or the page's language (section 4) |
| `word-break-korean` (warn) | Sampled Korean paragraphs, list items, cells, or captions lack `word-break: keep-all` | `word-break: keep-all` on `body`; remove the override (section 4) |
| `hidden-at-rest` (warn) | Text sits at an effective opacity under 0.1 or `visibility: hidden` after load (closed `<details>` and `aria-hidden` excluded) | Give it a visible resting state; animate from there, never from `opacity: 0` (output contract) |
| `body-bg-transparent` (warn) | `<body>` has no background color | `body { background: var(--bg); }` (section 3) |
| `theme-state-mismatch` (warn) | An explicit `data-theme` choice does not switch the palette: no `:root[data-theme="dark"]` block, or a dark media block without the `:not([data-theme="light"])` guard | The three-state token shape of section 3 |
| `title-name` (warn) | `<title>` is missing, empty, a category label alone, or carries an explainer after a colon or a dash | A 2 to 4 word name for the thing; the explanation goes in the lede (section 4) |
| `duplicate-id` (warn) | Two elements share one `id` (marker and gradient ids collide when a figure is copied) | Prefix ids with the figure slug (section 7.2) |
| `theme-token-scope` (warn) | A color token is first defined only inside a media or `[data-theme]` block, or a component rule uses a literal color | Define every token on bare `:root` first; components read `var(--token)` (section 3) |
| `svg-no-label` (warn) | An `<svg>` has no `role="img"` with `aria-label`, and is not `aria-hidden` | Add `role="img"` and an `aria-label` that carries the caption's claim, or `aria-hidden="true"` for decoration (section 7.2) |
| `svg-embedded-code` (warn) | An `<svg>` holds a `<style>` or `<script>` element | Move the rules to page CSS classes; remove the script (section 7.2) |

Elements dimmed to under 50% opacity (unselected scenario paths) are skipped by the contrast check and counted
in the `contrast-sample` line. Lint never measures dimmed text, so dim only what a selector deselects. The self-test `bash <skill-dir>/scripts/lint_test.sh` checks that lint still
catches every planted defect and flags none of the clean fixtures; run it after changing `lint.js`.
Lint cannot see everything. It cannot count a source's transitions, judge a verdict, or see a reflowed
graph inside a `<div>` that is not a `<figure>`. Sections 13.1 and 13.2 and the frame checklist above are the checks for those.

## Lint receipt

`lint.sh report.html [--source ...] --strict --receipt <path>` writes a JSON receipt to `<path>` (atomic tmp + mv)
when the run ends with 0 errors. The consuming skill decides the receipt path and passes it to its submit command.

| Field | Meaning | Checked by a gate |
|---|---|---|
| `schema_version` | 2 | yes |
| `html_sha256` | sha256 of the linted bytes, taken at lint start | yes |
| `html_path` | absolute path of the linted file | yes |
| `errors` | error count, always 0 in a written receipt | yes |
| `runs` | the three standard runs: 1280 light, 1280 dark, 400 light | yes |
| `source` | absolute `--source` path, or null | yes |
| `source_sha256` | sha256 of the `--source` file's bytes, taken at lint start; null when `--source` is a directory or absent | yes |
| `warnings` | warning count | no, audit only |
| `lint_js_sha256` | sha256 of the `lint.js` that ran | no, audit only |
| `created_at` | UTC time of the run | no, audit only |

With errors above 0, or when the HTML or the source file changed during linting, no receipt is written. An old
receipt at that path is never deleted. A gate compares `html_sha256` to the submitted file and `source_sha256` to
the current source file, so a receipt for older bytes fails. A revised source needs a new lint run, because the
source-aware checks ran on the old one. The receipt proves lint ran clean on those exact bytes. It guards
against mistakes (editing after lint, skipping lint); it is not tamper-proof. An example is in
`scripts/selftest/receipt.example.json`.
