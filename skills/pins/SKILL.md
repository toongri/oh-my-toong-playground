---
name: pins
description: Use when the user mentions pins or when context lookup or knowledge pinning is needed — entry point for the on-discovery pinning system.
---

# pins

**A pin is indexing, not a wiki.** The SSOT lives in another system; a pin is just a pointer + surrounding context + cross-link.

## Four axioms

| Slug | Proposition |
|---|---|
| `indexing-not-wiki` | A pin indexes the SSOT — do not restate SSOT content. |
| `ssot-no-copy` | Do not copy the SSOT body into the pin. Recording `source_url` and authority is sufficient. |
| `5-elements-only` | Capture exactly five things: location, authority, one-line summary, surrounding context, cross-link. |
| `long-body-wrong-ssot` | A long pin body signals the SSOT is in the wrong place — move the SSOT and shrink the pin. |

## Sub-skills

- **`select-pin`** — read existing pins. Invoke first when context is needed.
- **`write-pin`** — emit a new pin on discovery or update.

The **pin-session-start hook** auto-surfaces the `$OMT_DIR/pins/` index at SessionStart.

## Emit timing

Emit immediately on discovery. Do not defer based on "might change later" — emit now and let a future discovery overwrite if needed. For Scenario F (no external SSOT exists), the "immediate" emit is step ③ of: ① propose external registration → ② register together → ③ emit pin. See `write-pin/reference/use-cases.md`.

## Scope

Cross-cutting infrastructure. Does not place responsibilities on prometheus / sisyphus / spec / sisyphus-junior.
