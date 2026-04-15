# Orchestrate-Review Skill — Application Test Scenarios

## Purpose

These scenarios test whether the **orchestrate-review skill's** Chairman orchestration behavior is correctly applied. Each scenario targets a distinct phase or constraint of the 2-Phase Protocol (Request → Collect → Read → Report) as defined in `SKILL.md`.

## Technique Coverage Map

| # | Scenario | Primary Technique | Secondary |
|---|---------|-------------------|-----------|
| OR-A1 | Full code review aggregation | 2-Phase Protocol end-to-end | Dispatch + Collect + Aggregate |
| OR-A2 | Single reviewer failure | Degradation Policy — partial aggregation | Output format modification |
| OR-A3 | Diff command failure | Diff command failure handling — immediate return | No aggregation attempted |
| OR-A4 | Start exactly once | Execution Constraint — EXACTLY ONCE | No re-start on running state |
| OR-A5 | P-level pass-through | Chairman does NOT assign/reassign P-levels | Aggregate faithfully as reported |
| OR-A6 | No final verdict computed | Chairman lists per-model verdicts only | Orchestrator decides final verdict |

---

## Scenario OR-A1: Full Code Review Chunk Aggregation (Happy Path)

**Primary Technique:** 2-Phase Protocol — Request → Collect → Read → Report

**Given:**
- Chairman receives an interpolated prompt containing `{DIFF_COMMAND}`, a list of 8 changed files, and review requirements
- All three reviewer CLIs (claude, gemini, codex) are available and respond successfully
- Reviewers identify 2 overlapping issues and 1 unique finding each

**When:**
- The Chairman processes the chunk review request

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | Prompt passthrough only | Chairman writes the interpolated prompt to a temp file; does NOT execute the `{DIFF_COMMAND}` itself and does NOT read the file list to explore source files |
| V2 | Single dispatch | `bun .claude/skills/orchestrate-review/scripts/job.ts start --prompt-file "$PROMPT_FILE"` is invoked EXACTLY ONCE |
| V3 | Collect loop | `collect` is called until `"overallState": "done"` is returned |
| V4 | Read reviewer outputs | Each reviewer's `outputFilePath` from the manifest is read via the Read tool; null entries are skipped |
| V5 | Deduplication applied | The 2 overlapping issues (same file:line range +/-5 lines, same problem type) are merged into one entry using the richest description; "나머지 N개 모델 동일 평가." is appended |
| V6 | Unique finding listed | Each unique finding is listed with the identifying model's P-level and "Did not identify this issue." for non-reporting models |
| V7 | Termination | No additional tools (Read, Bash, etc.) run after the aggregation report is output |

---

## Scenario OR-A2: Single Reviewer Failure — Partial Aggregation (Degradation)

**Primary Technique:** Degradation Policy — partial aggregation when a reviewer infrastructure fails

**Given:**
- Chairman receives a chunk review request with 3 dispatched reviewers (N=3)
- `collect` returns `"overallState": "done"` with the following manifest:
  ```json
  {
    "overallState": "done",
    "members": [
      { "member": "claude", "outputFilePath": "/tmp/job/claude/output.txt", "errorMessage": null },
      { "member": "gemini", "outputFilePath": null, "errorMessage": "missing_cli" },
      { "member": "codex", "outputFilePath": "/tmp/job/codex/output.txt", "errorMessage": null }
    ]
  }
  ```

**When:**
- The Chairman reads the manifest and proceeds to produce the aggregation report

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No job restart | Chairman does NOT call `start` again due to the gemini failure |
| V2 | Read only non-null paths | Only claude and codex `outputFilePath` values are read; the null gemini entry is skipped |
| V3 | Partial aggregation prefix | Report begins with "Partial review (2/N respondents). gemini unavailable: missing_cli." |
| V4 | Denominator stays N=3 | Per-model lines use N=3 as denominator — e.g., "Models: 2/3" for shared findings |
| V5 | Unavailable vs did-not-identify distinct | gemini entries show "gemini: Unavailable (missing_cli)." — NOT "gemini: Did not identify this issue." |
| V6 | Missing perspective noted | Report notes that gemini's perspective (broad factual grounding, alternative solutions) is absent |
| V7 | No extrapolation | Chairman does NOT speculate what gemini "would have found" |

---

## Scenario OR-A3: Diff Command Failure Handling (Edge Case)

**Primary Technique:** Diff command failure — immediate return without aggregation

**Given:**
- Chairman receives an interpolated prompt containing a `{DIFF_COMMAND}` for a chunk
- All three reviewers have responded, but all three report that the diff command failed with an error (e.g., "fatal: bad revision 'origin/feature...pr-99'" or empty output)

**When:**
- The Chairman reads the reviewer output files and observes the diff command failure

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No aggregation attempted | Chairman does NOT attempt to aggregate findings from the failed diff outputs |
| V2 | Failure report returned | Response is: "Diff command failed for this chunk: [error details]" |
| V3 | Immediate return | Chairman stops after returning the failure report; no further tools are invoked |
| V4 | Error details included | The failure report includes the specific error message reported by the reviewers |
| V5 | No job restart | Chairman does NOT re-start the job or re-dispatch reviewers after the diff failure |

---

## Scenario OR-A4: Execution Constraint — start Runs Exactly Once

**Primary Technique:** CRITICAL Execution Constraint — `start` subcommand runs EXACTLY ONCE; `collect` may repeat

**Given:**
- Chairman receives a chunk review request
- First `collect` call returns `"overallState": "running"` (1 of 3 reviewers done, 2 still running):
  ```json
  { "overallState": "running", "counts": { "total": 3, "done": 1, "running": 2, "queued": 0 } }
  ```

**When:**
- The Chairman receives the running state response

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | No second start | Chairman does NOT invoke `start` again |
| V2 | Collect retry | Chairman calls `collect "$JOB_DIR"` again with the same JOB_DIR from the original start output |
| V3 | Foreground execution | The collect retry runs in foreground (no background execution) |
| V4 | Collect until done | Chairman continues calling `collect` until `"overallState": "done"` |
| V5 | One chunk per invocation | Chairman processes exactly ONE chunk — it does NOT combine this chunk's prompt with any other chunk's diff or file list |

---

## Scenario OR-A5: P-Level Pass-Through — No Reassignment

**Primary Technique:** Chairman Boundaries — MUST NOT assign, reassign, or interpret any model's P-level

**Given:**
- `collect` returns `"overallState": "done"` with all three reviewers responding
- Reviewer outputs contain the following P-level disagreement on the same issue (`PaymentService.kt:42`):
  - claude: P1 — "null 체크 누락으로 프로덕션 NPE 위험"
  - gemini: P2 — "잠재적 NPE이나 기존 테스트가 커버"
  - codex: P1 — "null safety 위반, 즉시 수정 필요"

**When:**
- The Chairman aggregates the findings

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | P-levels passed through as-is | Each model's P-level appears exactly as reported (claude: P1, gemini: P2, codex: P1) |
| V2 | Severity range reported | Issue entry shows "Severity Range: P1 ~ P2" |
| V3 | No P-level override | Chairman does NOT change gemini's P2 to P1 because the majority said P1 |
| V4 | Per-model entries listed separately | Because P-levels differ (P1 vs P2), each model is listed separately with its own reasoning |
| V5 | No verdict computed | Chairman does NOT assign a combined verdict or severity for this issue |

---

## Scenario OR-A6: Per-Model Verdicts Only — No Final Verdict Computed

**Primary Technique:** Verdict Handling — list each model's verdict separately; Chairman does NOT compute a combined verdict

**Given:**
- All three reviewers have responded with the following verdicts:
  - claude: LGTM ("변경 사항이 스펙 요구사항을 충족합니다")
  - gemini: REQUEST_CHANGES ("인증 미들웨어 누락 — 보안 필수 사항")
  - codex: LGTM ("코드 품질 양호, 특이 사항 없음")

**When:**
- The Chairman produces the aggregation report

**Then:**

| # | Verification Point | Expected Behavior |
|---|-------------------|-------------------|
| V1 | Per-Model Verdicts section present | Report includes a `### Per-Model Verdicts` section |
| V2 | Each model listed separately | All three models appear: claude: LGTM, gemini: REQUEST_CHANGES, codex: LGTM |
| V3 | No combined verdict | Chairman does NOT compute "2/3 LGTM therefore overall LGTM" or apply majority rule |
| V4 | Basis included | Each model's verdict entry includes its stated basis |
| V5 | Orchestrator note | Report defers final verdict decision to the orchestrator (implicitly or explicitly — no override) |

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
| OR-A1: Full aggregation cycle | — | —/7 | |
| OR-A2: Single reviewer failure | — | —/7 | |
| OR-A3: Diff command failure | — | —/5 | |
| OR-A4: Execution constraint | — | —/5 | |
| OR-A5: P-level pass-through | — | —/5 | |
| OR-A6: Per-model verdicts only | — | —/5 | |
