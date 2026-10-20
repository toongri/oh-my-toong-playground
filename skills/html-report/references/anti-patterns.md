# Anti-patterns

This file holds the full table of [section 11 (Anti-patterns)](../SKILL.md#11-anti-patterns) of SKILL.md.

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
| Shadows; radius above 10px | Template look | 1px borders; 6 to 10px radius (pills excepted) |
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
