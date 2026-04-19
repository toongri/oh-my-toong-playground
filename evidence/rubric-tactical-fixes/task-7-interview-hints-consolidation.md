# Task 7 (A-1) Evidence — interview_hints consolidation

## Changes applied

### `skills/tech-claim-rubric/output-schema.md` §interview_hints Constraints (L119-127)
**Before**: 2 rules (Language, Vocabulary)
**After**: 3 rules (Vocabulary, Actionability, P1 coverage)
- Language rule deleted (council consensus: no empirical basis, LLM naturally follows bullet language)
- Actionability and P1 coverage migrated from examiner.md
- Vocabulary rule axis-name list corrected: "Ownership" → "Ownership & Scope", A3 name synced with current SKILL.md ("Outcome Presence & Clarity")

### `agents/tech-claim-examiner.md:282-284`
**Before**: Full 4-rule body block with examples
**After**: One-line reference paragraph pointing to `output-schema.md §interview_hints Constraints`

### `agents/tech-claim-examiner.md:303-305` Completion Checklist
**Before**: Item "interview_hints 언어가 source bullet 언어와 일치"
**After**: Removed. Items now cover Vocabulary / Actionability / P1 coverage with rule labels.

## Verification (before mnemosyne)
- Grep `"Language rule"` in output-schema.md §interview_hints → 0 hits
- Grep each of 4 rule bodies in examiner.md → 0 hits (only reference paragraph remains)
- Axis-name list in Vocabulary rule matches SKILL.md's 5 axis names exactly

## Scope boundary
No other sections of these two files changed.
