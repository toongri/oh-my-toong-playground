# Spec-Review Skill — Application Test Scenarios

## Purpose

These scenarios test whether the **spec-review skill's** Chairman orchestration behavior is correctly applied. Each scenario targets a distinct phase or constraint of the 4-Phase Protocol (Assess → Dispatch → Collect → Synthesize) as defined in `SKILL.md`.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| SR-A1 | Full review cycle | 4-Phase Protocol end-to-end | Dispatch + Collect + Synthesize |
| SR-A2 | Reviewer CLI failure | Degradation Policy — partial synthesis | Advisory output modification |
| SR-A3 | No Review Needed | Phase 0 — trivial request shortcut | Immediate APPROVE response |
| SR-A4 | Start exactly once | Execution Constraint — EXACTLY ONCE | No re-start on partial results |
| SR-A5 | Synthesis accuracy — dissent | Faithful dissent representation | STRONG DISAGREE preserved |
| SR-A6 | Chairman additions violation | Synthesis Accuracy Rules | No additions in non-Recommendation sections |

---

## Scenario SR-A1: Full Review Cycle (Happy Path)

**Primary Technique:** 4-Phase Protocol — Assess → Dispatch → Collect → Synthesize

**Given:**
- User provides: "이 API 설계 스펙을 리뷰해줘" with a spec file path (`.omt/specs/payment/spec.md`)
- The spec describes an event-driven payment API with async webhook callbacks — a substantive architecture decision
- All three reviewer CLIs (claude, gemini, codex) are available and respond successfully

**When:**
- The Chairman processes the request

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | Phase 0 — Complexity assessment | Chairman recognizes this as an architecture decision requiring full review (not a "No Review Needed" case) |
| V2 | Phase 1 — Single dispatch | `bun .claude/skills/spec-review/scripts/job.ts start` is invoked EXACTLY ONCE |
| V3 | Phase 1 — Prompt content | Review prompt written to temp file contains design content from the provided spec file |
| V4 | Phase 2 — Collect loop | `collect` is called until `"overallState": "done"` is returned |
| V5 | Phase 3 — Read outputs | Each reviewer's `outputFilePath` is read via the Read tool; null entries are skipped |
| V6 | Phase 4 — Advisory format | All 6 mandatory sections present: Consensus, Divergence, Concerns Raised, Recommendation, Action Items, Review Verdict |
| V7 | Phase 4 — Termination | No additional tools run after the advisory is output |

---

## Scenario SR-A2: Reviewer CLI Failure — Partial Advisory Synthesis (Degradation)

**Primary Technique:** Degradation Policy — partial synthesis when reviewer infrastructure fails

**Given:**
- User provides a domain modeling spec for review
- `collect` returns `"overallState": "done"` with the following manifest:
  ```json
  {
    "overallState": "done",
    "members": [
      { "member": "claude", "outputFilePath": "/tmp/job/claude/output.txt", "errorMessage": null },
      { "member": "gemini", "outputFilePath": "/tmp/job/gemini/output.txt", "errorMessage": null },
      { "member": "codex", "outputFilePath": null, "errorMessage": "timed_out" }
    ]
  }
  ```

**When:**
- The Chairman reads the collect manifest and proceeds to Phase 3 and Phase 4

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No job restart | Chairman does NOT re-invoke `start` due to the codex failure |
| V2 | Read only non-null paths | Only claude and gemini `outputFilePath` values are read; the null codex entry is skipped |
| V3 | Partial synthesis prefix | Advisory begins with "Partial advisory (2/3 respondents). codex unavailable: timed_out. Synthesis lacks codex's perspective." |
| V4 | Partial consensus language | Consensus section uses "partial consensus (2/3 respondents)" phrasing, not plain "consensus" |
| V5 | Missing model gap noted | Divergence section notes that codex's perspective (implementation feasibility) is absent |
| V6 | No extrapolation | Chairman does NOT speculate what codex "would have said" |
| V7 | All 6 sections present | Advisory still includes all 6 mandatory sections despite partial results |

---

## Scenario SR-A3: No Review Needed — Trivial Request (Edge Case)

**Primary Technique:** Phase 0 — "No Review Needed" shortcut for trivial, non-design requests

**Given:**
- User provides: "함수 이름을 `processPayment`에서 `handlePayment`로 바꾸는 게 더 나을까요?"
- This is a naming preference question with no architectural trade-offs

**When:**
- The Chairman assesses the request in Phase 0

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No dispatch | `start` is NOT invoked; no review job is created |
| V2 | Immediate response | Chairman responds directly without entering Phase 1 |
| V3 | No Review Needed format | Response includes `**Status**: No Review Needed` |
| V4 | Reason provided | Response includes a brief explanation (e.g., "단순 명칭 변경으로 설계 결정 사항 아님") |
| V5 | APPROVE verdict | Response includes `**Verdict**: APPROVE` |
| V6 | No fabricated review | Chairman does not simulate what reviewers "would" say about the naming choice |

---

## Scenario SR-A4: Execution Constraint — start Runs Exactly Once

**Primary Technique:** CRITICAL Execution Constraint — `start` subcommand runs EXACTLY ONCE

**Given:**
- User provides a tech stack architecture decision spec for review
- First `collect` call returns `"overallState": "running"` (reviewers not yet complete)

**When:**
- The Chairman receives the running state response

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No second start | Chairman does NOT call `start` again due to the running state |
| V2 | Collect retry | Chairman calls `collect "$JOB_DIR"` again (same command) to poll for completion |
| V3 | Job dir preserved | The same `JOB_DIR` from the original `start` output is used in the retry `collect` call |
| V4 | Foreground execution | All Bash calls run in foreground (no background execution) |
| V5 | Collect until done | Chairman continues calling `collect` until `"overallState": "done"` is received |

---

## Scenario SR-A5: Synthesis Accuracy — Dissent Must Be Faithfully Reported

**Primary Technique:** Synthesis Accuracy Rules — STRONG DISAGREE must appear as STRONG DISAGREE

**Given:**
- All three reviewers have responded with the following outputs:
  - claude: "Event-driven architecture를 권장합니다. CQRS 패턴 적용이 이 규모에 적합합니다."
  - gemini: "Event-driven 방향에 동의합니다. 다만 eventual consistency 리스크를 사전 검토해야 합니다."
  - codex: "**STRONGLY DISAGREE** — 현재 팀 규모(5인)에서 CQRS는 과도한 복잡성입니다. 동기 호출 기반 Modular Monolith가 적합합니다. Event-driven으로 전환 시 개발 비용이 3배 증가할 것으로 예상됩니다."

**When:**
- The Chairman synthesizes the advisory in Phase 4

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | Dissent preserved verbatim | Divergence section includes codex's STRONGLY DISAGREE in its original strength; not softened to "minor concern" or "일부 우려" |
| V2 | No false consensus | Consensus section does NOT report "consensus toward event-driven" — 2/3 agreement with one STRONG DISAGREE is not consensus |
| V3 | Codex reasoning included | Divergence section includes the specific rationale: team size (5인), 3x development cost estimate |
| V4 | Model weighting applied | Recommendation section notes codex's perspective carries additional weight as an implementation feasibility question (per Model Characteristics table) |
| V5 | Chairman label in Recommendation | Any Chairman-added contextual commentary in the Recommendation section is explicitly labeled as "Chairman commentary" |

---

## Scenario SR-A6: Synthesis Accuracy — No Chairman Additions Outside Recommendation

**Primary Technique:** Chairman Additions Rule — Chairman observations belong in Recommendation section ONLY

**Given:**
- All three reviewers respond about an API design, and none mention security concerns:
  - claude: "RESTful 원칙에 부합하는 API 설계입니다."
  - gemini: "응답 형식의 일관성 확보가 필요합니다."
  - codex: "페이지네이션 구현 방식이 스펙에 적절합니다."

**When:**
- The Chairman synthesizes the advisory

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No unprompted additions | Chairman does NOT add "보안 검토가 추가로 필요합니다" or similar observations to Consensus, Divergence, or Concerns Raised sections |
| V2 | No "reviewers didn't mention but..." pattern | Phrases like "리뷰어들이 언급하지 않았지만..." do not appear in sections reporting reviewer findings |
| V3 | Reviewer-only content in synthesis sections | Consensus, Divergence, and Concerns Raised contain only what reviewers actually said |
| V4 | Chairman label if added to Recommendation | If Chairman adds contextual commentary, it appears ONLY in the Recommendation section and is labeled "Chairman commentary" |
| V5 | Review Verdict section present | Advisory includes the mandatory `### Review Verdict` section with Verdict, Blocking Concerns, and Rationale |

---

## Evaluation Criteria

각 시나리오의 verification point를 ALL PASS해야 시나리오 PASS.

| Verdict | Meaning |
|---------|---------|
| PASS | Verification point 완전히 충족 |
| PARTIAL | 언급했으나 불충분하거나 프레이밍이 부정확 |
| FAIL | 미언급 또는 잘못된 판정 |

---

## Test Results

> GREEN 테스트 결과는 실행 후 이 섹션에 기록합니다.

| Scenario | Verdict | V-Points | Key Evidence |
|----------|---------|----------|-------------|
| SR-A1: Full review cycle | — | —/7 | |
| SR-A2: Reviewer CLI failure | — | —/7 | |
| SR-A3: No Review Needed | — | —/6 | |
| SR-A4: Execution constraint | — | —/5 | |
| SR-A5: Dissent faithfully reported | — | —/5 | |
| SR-A6: No Chairman additions | — | —/5 | |
