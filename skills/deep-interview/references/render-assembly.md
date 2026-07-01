## Table of Contents

- [Injection Guard (close-tag escape)](#injection-guard-close-tag-escape)
- [Active-Placeholder HTML-Escape](#active-placeholder-html-escape)
- [Injection Guard (prose)](#injection-guard-prose)
- [Mermaid Validity](#mermaid-validity)
- [Placeholder Table](#placeholder-table)
- [Write Command](#write-command)

---

## Injection Guard (close-tag escape)

**Injection guard — close-tag escape**: The render sink is `container.innerHTML = marked.parse(md)` with no DOM sanitizer. The rendered body is USER-AUTHORED spec prose — interview transcript and ontology entity names — that routinely contains `</script>`-like and fenced fragments. Apply this escape to the assembled spec markdown before substituting it into the inert JSON container:

```js
JSON.stringify(md).replace(/<\/(script)([\s/>])/gi, '<\\/$1$2')
```

## Active-Placeholder HTML-Escape

**Active-placeholder HTML-escape**: every active placeholder (all EXCEPT `{{SPEC_MARKDOWN_JSON}}`) lands in a live HTML position (`<title>`, `<h1>`, `<span>`) and MUST be HTML-escaped:

```js
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
```

## Injection Guard (prose)

**Injection guard — prose fields too**: The render sink is `container.innerHTML = marked.parse(md)` with NO DOM sanitizer (marked removed its `sanitize` option in v8). The rendered spec BODY — the interview transcript and ontology entity names — is USER-AUTHORED and may contain fragments like `</script>` or `<img src=x onerror=BOOM>`; unlike the close-tag escape above (which only protects the inert JSON container), a fragment echoed bare in the rendered spec prose reaches innerHTML as LIVE markup. Every code-derived fragment echoed in rendered spec prose MUST be wrapped in an inline-code span (backticks) so marked escapes it as code — or HTML-escaped if an inline-code span does not fit. If the fragment itself contains a backtick, delimit the span with a longer backtick run (CommonMark matches an inline-code span on an equal-length backtick run). NEVER echo a code fragment bare in spec prose.

## Mermaid Validity

**Mermaid validity**: mermaid treats `;` as a statement separator — a raw `;` inside sequence-message text (e.g. `mkdir -p; rm`) silently splits the line and the whole diagram renders as an error SVG. mermaid source MUST be syntactically valid: keep sequence-message text free of raw `;` (rephrase to `then`, a comma, or omit). In `erDiagram` blocks, any entity name containing a space or punctuation MUST be double-quoted (e.g. `"Discount Code" ||--o{ "Free Product" : grants`) — an unquoted spaced name (common for ontology entity names) renders an error SVG; verified against mermaid@11.4.1 (the `NAME["label"]` alias form is invalid in ER diagrams — quote the name directly).

## Placeholder Table

Substitute into the template placeholders (shared verbatim with the render template `templates/spec-presentation.html`):

| Placeholder | Value |
|-------------|-------|
| `{{LANG_CODE}}` | BCP-47 language tag of the session language (e.g. `ko`, `en`) |
| `{{HTML_TITLE}}` | Human-readable spec title, e.g. `{slug} — Deep Interview Spec` |
| `{{SPEC_TITLE}}` | Short kicker, e.g. `Deep Interview Spec` |
| `{{TOC_TITLE}}` | TOC nav label in session language, e.g. `목차` / `Contents` |
| `{{AMBIGUITY_SCORE}}` | Meta pill, e.g. `Ambiguity 7%` |
| `{{ROUND_COUNT}}` | Meta pill, e.g. `12 rounds` |
| `{{SPEC_FILE_PATH}}` | Absolute path to the written HTML file |
| `{{SPEC_MARKDOWN_JSON}}` | close-tag-escaped JSON string of the assembled spec markdown (inert container) |
| `{{FOOTER_NOTE}}` | Session-language note |

## Write Command

Escape each active value, then write the substituted HTML:

```bash
mkdir -p $OMT_DIR/deep-interview
# write to the render path chosen by the caller (SKILL.md owns the path):
#   Phase 4 final render → {slug}.html   |   on-demand ontology render → ontology-preview.html
```

`{{SPEC_MARKDOWN_JSON}}` is exempt from the HTML-escape — it sits in the inert `<script type="application/json">` container and already carries the close-tag escape above.
