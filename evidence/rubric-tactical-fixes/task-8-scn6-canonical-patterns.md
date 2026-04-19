# Task 8 (A-2) Evidence — SCN-6 canonical patterns

## Changes applied

### `skills/tech-claim-rubric/output-schema.md` Consumer Boundaries
Added subsection `### Prohibited Token Patterns for review-resume` (line 145-157, +13 lines) with 3-pattern table + verification usage note + axis-rename guidance. Subsection inserted inside Consumer Boundaries, immediately after the `### review-resume (blackbox consumer)` bullet list.

### `skills/review-resume/tests/phase9-loop-scenarios.md:128-140` SCN-6
**Before**: Placeholder strings (`INTERNAL_AXIS_NAME`, `INTERNAL_FIELD_PREFIX`, `INTERNAL_STRUCT_NAME`) that would trivially pass grep.
**After**: Explicit grep-able regex references in Verification section, pattern bodies canonical at output-schema.md.

## Verification (pre-mnemosyne)
- Grep `INTERNAL_AXIS_NAME` in phase9-loop-scenarios.md → 0 hits
- Grep `Prohibited Token Patterns` in output-schema.md → 1+ hits (new subsection at L145, L157)
- Axis name alternation uses current A3 name `Outcome Presence & Clarity`

## Scope boundary
Only the two specified files modified.
