## Table of Contents

- [Injection Guard (close-tag escape)](#injection-guard-close-tag-escape)
- [Active-Placeholder HTML-Escape](#active-placeholder-html-escape)
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

## Mermaid Validity

**Mermaid validity**: mermaid treats `;` as a statement separator — a raw `;` inside sequence-message text (e.g. `mkdir -p; rm`) silently splits the line and the whole diagram renders as an error SVG. mermaid source MUST be syntactically valid: keep sequence-message text free of raw `;` (rephrase to `then`, a comma, or omit).

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
# write to: $OMT_DIR/deep-interview/{slug}.html
```

`{{SPEC_MARKDOWN_JSON}}` is exempt from the HTML-escape — it sits in the inert `<script type="application/json">` container and already carries the close-tag escape above.
