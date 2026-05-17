---
name: select-pin
description: Use when context is needed and pins might already index it. Read-only lookup; do NOT use to write or emit new pins (that is write-pin's job).
---

# select-pin

Look up SSOT pointers in `$OMT_DIR/pins/`. Read-only.

## Procedure

1. `ls $OMT_DIR/pins/` to enumerate slugs. If `$OMT_DIR` is unset, log WARN and skip (fail-open).
2. Read **frontmatter only** for candidates to filter by `source_url`, `authority`, `tier`, `tags`, and `supersedes`.
3. For matches, read the body to dereference `source_url`.
4. Follow `related` slugs to traverse the cross-link graph. Default depth 1; use a visited set to guard cycles.

## Output

Return the matched slug, `source_url` (or `person:name`), and one-line summary to the caller. Report "no match" on miss.
