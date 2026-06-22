## Table of Contents

- [Card Format](#card-format)
- [Injection Guard (card-body)](#injection-guard-card-body)
- [Injection Guard (prose)](#injection-guard-prose)
- [Unverified Entries](#unverified-entries)
- [Mermaid Validity](#mermaid-validity)
- [Translation](#translation)
- [Placeholder Table](#placeholder-table)
- [Write Command](#write-command)

---

## Card Format

Assemble the report markdown with these top-level sections (omit optional sections when empty per the rules below):

```
## Walkthrough

### Change Summary
[Phase 1 prose — 1-2 paragraphs]

### Core Logic Analysis
[Phase 1 prose — module narrative, data flow, design decisions]

### Architecture Diagram
[Phase 1 — ```mermaid class/component diagram, or "No structural changes — existing architecture preserved"]

### Sequence Diagram
[Phase 1 — ```mermaid sequence diagram, or "No call flow changes"]

---

## Findings
[Ranked: correctness CONFIRMED → correctness PLAUSIBLE → cleanup CONFIRMED → cleanup PLAUSIBLE.
If nothing survived verification: "No findings survived verification."]

### Correctness
[Omit if none.]

### Cleanup
[Omit if none.]

## Out of Scope (Pre-existing)
[Findings on unchanged context lines — verdict-labeled cards. Do not gate on these.]

## Unverified (verifier unavailable)
[Only when one or more verifiers errored or timed out — plain markdown, NO data-verdict, explicit count. Omit entirely when every candidate was verified.]

## Recommendations
[Optional — from the Findings section only (not Out of Scope or Unverified); omit if none.]
```

**Verdict-bearing findings as literal card HTML** (Findings + Out of Scope Pre-existing): every finding that carries a verdict is authored in the render-time markdown as a literal `<div class="finding" data-verdict="CONFIRMED">…</div>` (or `data-verdict="PLAUSIBLE"`). The literal `[CONFIRMED]` or `[PLAUSIBLE]` token also appears in the card text. Card format:

```
<div class="finding" data-verdict="CONFIRMED">

**[CONFIRMED] {finding title}**
<span class="loc">`{file}:{line}` — {section/function name}</span>

- **What's wrong**: {problem, grounded in the quoted line}
- **Failure scenario**: {concrete inputs/state → wrong output, crash, or lost effect; for cleanup, the concrete cost}
- **Current Code**:
  ```{lang}
  [5-15 lines centered on the issue]
  ```
- **Fix**:
  ```diff
  [concrete diff or, if structural, a design direction]
  ```
- **Blast Radius**: {grep/reference evidence, or "This location only"}
- **Found by**: {angle(s)}

</div>
```

Use `data-verdict="PLAUSIBLE"` for plausible findings.

## Injection Guard (card-body)

**Injection guard — card-body code must stay fenced**: The render sink is `container.innerHTML = marked.parse(md)` with no DOM sanitizer. Only the card chrome (the `<div data-verdict>`, title, verdict badge) is raw HTML. Every reviewed-code snippet inside a card (Current Code / Fix) MUST be a fenced ` ```{lang} ` block so marked.js HTML-escapes it. Fencing — not a DOM sanitizer — is what neutralizes hostile reviewed code (e.g. `<img src=x onerror=BOOM>`, `</script>`): the fenced path goes through marked's escape pipeline while raw HTML inside marked.parse is treated as live HTML and passed through to innerHTML unchanged. NEVER author reviewed code snippets as raw HTML inside a card body. If the reviewed snippet itself contains a line that is a code fence (` ``` ` or `~~~`), the card's Current Code / Fix fence MUST use a fence the inner fence cannot terminate — a strictly longer fence of the same character (e.g. 4+ backticks) or the other fence type (`~~~`). CommonMark closes a fence only with the same character and an equal-or-greater run length, so a `~~~`-delimited card body is immune to inner backtick fences and vice-versa.

## Injection Guard (prose)

**Injection guard — prose fields too**: The same `innerHTML = marked.parse(md)` sink treats raw HTML in *prose* as live, not only in card bodies. The card's prose fields — the finding title, `What's wrong`, and `Failure scenario` — are not fenced, so a reviewed-code fragment quoted bare there (e.g. `<img src=x onerror=BOOM>`, `</script>`) reaches innerHTML as live HTML exactly as an unfenced card body would. Every code-derived fragment echoed in a prose field MUST be wrapped in an inline-code span (backticks) so marked.js escapes it as code — or HTML-escaped if an inline-code span does not fit. If the fragment itself contains a backtick, delimit the span with a longer backtick run (CommonMark matches an inline-code span on an equal-length backtick run). NEVER quote a reviewed-code fragment bare in prose.

## Unverified Entries

**Unverified entries — plain markdown, no card**: `Unverified (verifier unavailable)` entries have no verdict by design (they are coverage gaps, not findings). Do NOT wrap them in `<div class="finding" data-verdict>`. Leave them as plain markdown list items.

## Mermaid Validity

**Mermaid validity**: The Architecture and Sequence diagrams derive from the reviewed change. mermaid treats `;` as a statement separator — a raw `;` inside sequence-message text (common in code, e.g. `mkdir -p; rm`) silently splits the line and the whole diagram renders as an error SVG. mermaid source MUST be syntactically valid: keep sequence-message text free of raw `;` (rephrase to `then`, a comma, or omit the problematic fragment), and avoid unescaped mermaid control tokens throughout all mermaid fences.

## Translation

**Translation**: Translate all render-time prose to the detected session language. NEVER translate: code blocks, file paths, CLI tokens, verdict tokens (`CONFIRMED`/`PLAUSIBLE`), the literal `data-verdict="CONFIRMED"` and `data-verdict="PLAUSIBLE"` attribute values (translating these would break the CSS `[data-verdict]` selector), `file:line` references, and finding identifiers. If language detection is ambiguous, fall back to the original language.

**Fallback (verifier failed)**: If a verifier errored or timed out for a candidate, do NOT assign a verdict — list the candidate under `## Unverified (verifier unavailable)` as plain markdown with a count. Do not card it.

## Placeholder Table

Count correctness and cleanup findings (CONFIRMED + PLAUSIBLE each). Apply the close-tag escape to the assembled markdown:

```js
JSON.stringify(reviewMarkdown).replace(/<\/(script)([\s/>])/gi, '<\\/$1$2')
```

Substitute into the template placeholders:

| Placeholder | Value |
|-------------|-------|
| `{{LANG_CODE}}` | BCP-47 language tag of the session language (e.g. `ko`, `en`) |
| `{{HTML_TITLE}}` | Human-readable review title, e.g. `{repo} PR #{N} Code Review` |
| `{{REVIEW_TITLE}}` | Short kicker, e.g. `Code Review` |
| `{{TOC_TITLE}}` | TOC nav label in session language, e.g. `목차` / `Contents` |
| `{{CORRECTNESS_COUNT}}` | e.g. `3 correctness` |
| `{{CLEANUP_COUNT}}` | e.g. `2 cleanup` |
| `{{REVIEW_FILE_PATH}}` | Absolute path to the written HTML file |
| `{{REVIEW_MARKDOWN_JSON}}` | close-tag-escaped JSON string of the assembled review markdown |
| `{{FOOTER_NOTE}}` | Session language note, e.g. `This review reports; it does not gate.` |

**Active-HTML placeholders MUST be HTML-escaped.** Every placeholder above EXCEPT `{{REVIEW_MARKDOWN_JSON}}` lands in a live HTML position (`<title>`, `<h1>`, `<span>`). An HTML-significant character flowing in from a repo/branch name, file path, or count — Git permits branch names such as `x<svg/onload=alert(1)>` — would otherwise inject live markup.

## Write Command

Escape each value before substitution:

```js
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
```

`{{REVIEW_MARKDOWN_JSON}}` is exempt — it sits in the inert `<script type="application/json">` container and already carries the close-tag escape above. `{{LANG_CODE}}` must be a plain BCP-47 tag (e.g. `ko`, `en`), not free text.

Then write the substituted HTML:

```bash
mkdir -p $OMT_DIR/reviews
# write to: $OMT_DIR/reviews/{slug}.html
```
