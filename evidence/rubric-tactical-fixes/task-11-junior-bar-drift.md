# Task 11 (A-5) Evidence — Junior bar drift fix

## Changes applied

### `skills/tech-claim-rubric/a1-technical-credibility.md:17` Junior bar row
**Before**: `Junior | 0-2 yr | 시스템 이름 + 참여한 부분 명시. rationale은 팀/선배 결정 인용도 OK. at least one alternative or limitation 인식`
**After**: `Junior | 0-2 yr | 시스템 이름 + 참여한 부분 명시 + 본인 관점의 이유(무엇을 왜 썼는지) 간단 서술. at least one alternative or limitation 인식`

Rationale: bring a1-technical-credibility.md in line with SKILL.md:79 which does not grant the "팀/선배 결정 인용 OK" permissive clause. Per user agreement: "junior도 독립적 1인분 할 수 있어야 함" (2026 industry context, Council Q1 3/3 consensus).

### `skills/tech-claim-rubric/a1-technical-credibility.md:49-56` PASS Exemplar 3
**Before**: Bullet cited "선배 기술 리뷰 후 피드백 반영" as primary rationale; Why-PASS stated "팀/선배 결정 인용은 PASS 조건에 명시적으로 포함".
**After**: Bullet now shows own-perspective trade-off: DynamoDB conditional writes vs Redis SETNX with "영속성 보장과 operations overhead 균형으로 판단" + quantified result "주당 3건→0건". Why-PASS cites own-perspective rationale + alternative (Redis SETNX) + result.

## Flagged but NOT edited (separate scope)

### `skills/tech-claim-rubric/a1-technical-credibility.md:147` Calibration Contrast 1 — [Junior, 1yr] PASS verdict
The Junior 1yr verdict reasoning still cites "Junior bar는 '팀/선배 결정 인용도 OK'라고 명시적으로 허용하므로 충족", which is now stale under the new Junior bar. Status: **stale, intentionally not edited this task**. Reason: Calibration Contrast section edits are separate scope and require either (a) rewriting the bullet to test the new bar, or (b) swapping the contrast with a different example. Both exceed Task 11's intended minimal-edit scope.

Follow-up recommendation: post-push, create a separate task to rewrite Calibration Contrast 1 [Junior] verdict reasoning to reflect the new bar, OR swap the contrast bullet with one that legitimately passes the new Junior bar.

## Verification
- SKILL.md:79 unchanged (confirmed)
- a1-technical-credibility.md: only L17 + L49-56 changed, Calibration Contrast untouched
- Mid/Senior bar rows L18-19 unchanged
- Other PASS/FAIL/P1 exemplars unchanged

## Scope boundary
Only `skills/tech-claim-rubric/a1-technical-credibility.md` modified for content. Evidence file added at `evidence/rubric-tactical-fixes/task-11-junior-bar-drift.md`.
