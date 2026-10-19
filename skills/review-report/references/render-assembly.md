## Table of Contents

- [Body Structure](#body-structure)
- [Finding Card HTML](#finding-card-html)
- [Escaping and Injection Guard](#escaping-and-injection-guard)
- [Unverified Entries](#unverified-entries)
- [SVG Figures](#svg-figures)
- [Translation](#translation)
- [Placeholder Table](#placeholder-table)
- [Write Command](#write-command)

---

The page is plain HTML with inline CSS and no script. The model writes the body as HTML and substitutes it into the template. Nothing renders at view time, so the page is complete without a network and without JavaScript.

## Body Structure

Write the body (`{{REVIEW_BODY_HTML}}`) with these top-level sections, in this order. Omit optional sections when empty per the rules below. Give every `<h2>`/`<h3>` a unique `id` made of `[a-z0-9-]`, because the table of contents links to it.

```html
<h2 id="walkthrough">Walkthrough</h2>
<h3 id="change-summary">Change Summary</h3>      <!-- 1-2 paragraphs of <p> -->
<h3 id="core-logic-analysis">Core Logic Analysis</h3>   <!-- <p> per module: narrative, data flow, design decisions -->
<h3 id="architecture-diagram">Architecture Diagram</h3> <!-- inline-SVG <figure>, or <p>No structural changes — existing architecture preserved</p> -->
<h3 id="sequence-diagram">Sequence Diagram</h3>         <!-- inline-SVG <figure>, or <p>No call flow changes</p> -->
<hr>
<h2 id="findings">Findings</h2>
<!-- Ranked by class (correctness, then requirement gap, then cleanup), CONFIRMED before PLAUSIBLE inside each.
     If nothing survived verification: <p>No findings survived verification.</p> -->
<h3 id="correctness">Correctness</h3>        <!-- omit if none -->
<h3 id="requirement-gap">Requirement Gap</h3> <!-- omit if none; each card carries its AC -->
<h3 id="cleanup">Cleanup</h3>                 <!-- omit if none -->
<h2 id="out-of-scope">Out of Scope (Pre-existing)</h2> <!-- findings on unchanged context lines; do not gate on these -->
<h2 id="unverified">Unverified (verifier unavailable)</h2> <!-- only when a verifier errored or timed out -->
<h2 id="recommendations">Recommendations</h2>  <!-- optional; from Findings only, not Out of Scope or Unverified -->
```

Wrap the cards of one class in `<div class="findings-grid">`. Use `<table>` (with `<thead>`) for tabular facts, `<ul>`/`<ol>` for lists, `<p>` for prose, `<pre><code>` for code.

Build `{{TOC_ITEMS_HTML}}` from the same headings, in document order, one item per `<h2>`/`<h3>`:

```html
<li class="lvl-2"><a href="#walkthrough">Walkthrough</a></li>
<li class="lvl-3"><a href="#change-summary">Change Summary</a></li>
```

`lvl-2` for `<h2>`, `lvl-3` for `<h3>`. Every `href` must match an `id` in the body.

## Finding Card HTML

The `code-reviewer` agent returns findings as markdown cards. Keep their content unchanged: the same verdict, title, location, field text, code, and order. Change only the markup, by writing each card as the HTML below. Do not re-judge, re-rank, drop, or reword a card.

```html
<div class="finding" data-verdict="CONFIRMED">
<p><b>[CONFIRMED] {finding title}</b><br><span class="loc"><code>{file}:{line}</code> — {section/function name}</span></p>
<ul>
<li><b>What's wrong</b>: {problem, grounded in the quoted line}</li>
<li><b>Failure scenario</b>: {concrete inputs/state → wrong output, crash, or lost effect; for cleanup, the concrete cost}</li>
<li><b>Current Code</b>:
<pre><code class="language-{lang}">{escaped 5-15 lines centered on the issue}</code></pre></li>
<li><b>Fix</b>:
<pre><code class="language-diff">{escaped concrete diff or, if structural, a design direction}</code></pre></li>
<li><b>Blast Radius</b>: {grep/reference evidence, or "This location only"}</li>
<li><b>AC</b>: {the acceptance criterion / inferred intent the finding was measured against — omit this bullet entirely when the finding carries none}</li>
<li><b>Found by</b>: {angle(s)}</li>
</ul>
</div>
```

- `data-verdict` is `CONFIRMED` or `PLAUSIBLE`, copied from the agent's card. Any other value is a malformed card: list it under Unverified instead. The literal `[CONFIRMED]` or `[PLAUSIBLE]` token also appears in the card text.
- Keep the field order the agent used. The example in `output-example.md` shows the order for each class.
- A fix that is prose, not a diff, goes in the `<li>` as text, with no `<pre>`.

## Escaping and Injection Guard

The body is written into the page as live HTML, and its text comes from code diffs, PR titles and descriptions, branch names, and the agent's findings. All of it is untrusted. Nothing sanitizes it afterward, so the escaping done while writing is the only guard.

**Rule 1 — escape every text node.** Every character run that comes from the reviewed change, the PR text, or the agent's findings is escaped with `esc` before it enters the body: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`. This covers prose, titles, `AC` text, file paths, identifiers, table cells, and figure labels. Escape `&` first, so an existing entity is not double-processed by hand.

```js
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
```

**Rule 2 — code goes in `<pre><code>` or `<code>`, escaped.** A snippet, identifier, or fragment of reviewed code or requirement text is escaped and then wrapped, so a hostile fragment (`<img src=x onerror=BOOM>`, `</script>`, `</pre>`) shows as inert text. Generics and operators are escaped too: `List&lt;Order&gt;`, `a &amp;&amp; b`, `-&gt;`. Never write a reviewed fragment bare, and never as raw HTML.

**Rule 3 — the author controls only the markup.** The model writes these elements and attributes itself, with values it chose, never copied from the change:

- elements: `h2 h3 h4 p ul ol li table thead tbody tr th td pre code b i br hr div span figure figcaption svg` and the SVG shapes in `html-report/references/diagram-recipes.md`;
- attributes: `class` (values from the template CSS, or `language-` plus `[a-z0-9+-]`), `id` (`[a-z0-9-]`, derived from the heading text by hand), `data-verdict` (`CONFIRMED` or `PLAUSIBLE`), `href="#id"` on TOC items, and the SVG presentation attributes in the recipes.

Do not write `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<foreignObject>`, any `on*` attribute, `style=` copied from the change, or an `href`/`xlink:href` that points anywhere but an in-page `#id`. A link in PR text becomes escaped plain text, not an `<a>`.

**Rule 4 — the agent's markup is not trusted.** The agent's cards may arrive with their own `<div>`/`<strong>`/`<code>` wrappers. Read the verdict, title, location, and field text out of them, then write the card from the HTML above with Rule 1 applied to the text. Do not paste the agent's raw markup into the body. Inline-code spans (backticks) in the agent's text become `<code>` with the contents escaped.

**Rule 5 — a code line that looks like markup changes nothing.** Because the code is escaped, a snippet line such as ` ``` `, `</pre>`, or `</div>` cannot close the card or the block. No fence-length workaround is needed.

**Rule 6 — SVG labels.** Labels come from the reviewed change, so Rule 1 applies to every `<text>` (`&lt;`, `&gt;`, `&amp;`), including generics and operators in method signatures. The SVG has no `<script>`, `<foreignObject>`, `on*` attribute, or `href`/`xlink:href`. Keep a label short; put long signatures in the caption inside `<code>`.

**Self-check before the write.** After building the body, confirm it has no raw markup from the change:

```bash
grep -nEi '<script|<iframe|<object|<embed|<foreignObject|[[:space:]]on[a-z]+=|javascript:' body.html
```

Any hit is a defect to fix. The only legitimate `href` is `href="#id"`. If `<` appears inside a snippet it must read `&lt;`.

## Unverified Entries

**Unverified entries — plain list, no card**: `Unverified (verifier unavailable)` entries have no verdict by design (they are coverage gaps, not findings). Do NOT wrap them in `<div class="finding" data-verdict>`. Write them as `<li>` items in a `<ul>` under `<h2 id="unverified">`, with a count in the lead `<p>`. This also covers a card whose verdict the agent left out.

## SVG Figures

The Architecture and Sequence diagrams are inline SVG `<figure>` blocks authored per `${CLAUDE_SKILL_DIR}/../html-report/SKILL.md` (section 7 diagram rules, section 12 complexity budget, section 13 fidelity) and `${CLAUDE_SKILL_DIR}/../html-report/references/diagram-recipes.md`. A finished example is in `output-example.md`. The template already defines the CSS those recipes use (`svg .box`, `.rel`, `.msg`, `.life`, `.act`, `.mask`, `.halo`, `.t-b`, `.t-s`, `.t-m`, `.fig-scroll`, `.fig-hint`, `.edge-table`) and the token names they read (`--surface`, `--ink`, `--line-strong`, `--bad`, ...) as aliases of the template's own tokens, so no literal color belongs in an SVG attribute.

- **Drawn edges.** Every relation is a `<path>`/`<line>` with a `<marker>` arrowhead and a verb label. Marker ids are unique in the document (`f1-ah`, `f2-ah`).
- **Light and dark.** Colors come from the template classes (`box new` and `box mod` mark NEW and MODIFIED elements; a second cue, the text tag inside the box, carries the same fact without color).
- **Size.** Labels render at 12px or more. A viewBox wider than about 360px goes inside `<div class="fig-scroll" tabindex="0" role="region" aria-label="...">` with `style="min-width:{viewBox width}px"` on the `<svg>` (at most 840px, so it fits the desktop reading column without scrolling), followed by `<p class="fig-hint">` and a `<div class="edge-table">` listing every edge (from, label, to; for a sequence: order, from, to, message). Both are hidden on wide screens.
- **Budget.** At most 9 nodes, 12 edges per figure; a sequence has at most 5 lifelines and 12 messages. Over budget, split into an overview and a detail figure (html-report section 12).
- **Injection guard.** See Rule 6 above.
- **Caption.** `<figcaption>` states the claim in bold, then what the figure does not show.

## Translation

**Translation**: Translate all prose written into the body to the detected session language. NEVER translate: code blocks, file paths, CLI tokens, verdict tokens (`CONFIRMED`/`PLAUSIBLE`), the literal `data-verdict="CONFIRMED"` and `data-verdict="PLAUSIBLE"` attribute values (translating these would break the CSS `[data-verdict]` selector), `file:line` references, and finding identifiers. If language detection is ambiguous, fall back to the original language.

**Fallback (verifier failed)**: If a verifier errored or timed out for a candidate, do NOT assign a verdict — list the candidate under Unverified as a plain list item with a count. Do not card it.

## Placeholder Table

Count correctness, requirement-gap, and cleanup findings (CONFIRMED + PLAUSIBLE each). The template carries 11 placeholders. Substitute every one.

| Placeholder | Value | Escaping |
|-------------|-------|----------|
| `{{LANG_CODE}}` | BCP-47 language tag of the session language (e.g. `ko`, `en`) | plain tag, not free text |
| `{{HTML_TITLE}}` | Human-readable review title, e.g. `{repo} PR #{N} Code Review` | `esc` |
| `{{REVIEW_TITLE}}` | Short kicker, e.g. `Code Review` | `esc` |
| `{{TOC_TITLE}}` | TOC nav label in session language, e.g. `목차` / `Contents` | `esc` |
| `{{CORRECTNESS_COUNT}}` | e.g. `3 correctness` | `esc` |
| `{{REQUIREMENT_GAP_COUNT}}` | e.g. `1 requirement gap` | `esc` |
| `{{CLEANUP_COUNT}}` | e.g. `2 cleanup` | `esc` |
| `{{REVIEW_FILE_PATH}}` | Absolute path to the written HTML file | `esc` |
| `{{TOC_ITEMS_HTML}}` | the `<li>` items built from the body headings (Body Structure) | authored markup; heading text already escaped |
| `{{REVIEW_BODY_HTML}}` | the assembled body HTML (Body Structure, cards, figures) | authored markup; every text node already escaped per Rules 1–6 |
| `{{FOOTER_NOTE}}` | Session language note, e.g. `This review reports; it does not gate.` | `esc` |

**Escape the plain-text placeholders.** Every placeholder tagged `esc` lands in a live HTML position (`<title>`, `<h1>`, `<span>`). An HTML-significant character flowing in from a repo/branch name, file path, or count — Git permits branch names such as `x<svg/onload=alert(1)>` — would otherwise inject live markup. Substitute all placeholders in one pass over the template (one replace with a lookup table), so a `{{...}}` token inside the body or a branch name is not substituted a second time.

## Write Command

Write the substituted HTML:

```bash
mkdir -p $OMT_DIR/reviews
# write to: $OMT_DIR/reviews/{slug}.html
```

Then confirm no template placeholder is left: `grep -nE '\{\{[A-Z_]+\}\}' $OMT_DIR/reviews/{slug}.html` prints nothing, except for text inside escaped reviewed code that literally contains such a token.
