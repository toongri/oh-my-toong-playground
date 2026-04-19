# Task 9 (A-3) Evidence — resume-forge confirm gate SCN-8/9/10

## Changes applied

### `skills/resume-forge/tests/scenarios.md:74-116` (+44 lines)

**SCN-8 (L74-88)**: Loop 2 confirm gate "아직" response → inner loop return.
Setup describes examiner APPROVE + user "아직". Expected: bullet 수정 loop 재진입, Entry 확정 보류.

**SCN-9 (L90-105)**: Loop 2 confirm gate "다음" response → skip + pending.
Setup: examiner APPROVE + user "다음". Expected: bullet skip, state remains pending (not confirmed, not opt-out).

**SCN-10 (L107-116)**: Cross-phase mining during Loop 1.
Setup: a2 PASS but bullet enhancement requires context from another phase. Expected: reuse previously-mined context OR enter cross-phase mining sub-loop.

### Fix applied in this round
- SCN-9 L105: removed `(SCN-5 참조)` stale reference, inline definition of opt-out added

## Verification
- File contains SCN-1 through SCN-10 continuously (verified via grep `^##+ SCN-`)
- SCN-1~7 untouched (git diff confirms purely additive at SCN-8 onward)
- House format preserved (**Setup** / **Expected** / **Verification** for each new SCN)

## Scope boundary
Only `skills/resume-forge/tests/scenarios.md` modified.
