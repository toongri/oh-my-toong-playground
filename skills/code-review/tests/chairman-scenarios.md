# Chairman Multi-Model Aggregation Test Scenarios

> Phase 2 of code-review Application TDD — tests the multi-model Chairman workflow with explicit verification points.

---

## Scenarios

### CH-1: Full Agreement (3/3 Agree)

**Description**: All three models report the same issue. The Chairman should aggregate them as a 3/3 finding.

**Setup/Given**: Three models (Claude, Gemini, Codex) each independently review the same chunk. All three report the same issue: "Missing null check in `processPayment()` at line 42" with severity P1.

**Expected Behavior/Then**: The Chairman aggregates the three reports. The issue is identified by 3/3 models. The richest entry is preserved with a note that all 3 models concur.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Issue identified by 3/3 models |
| V2 | All three model names attributed as sources |
| V3 | No dissenting opinion noted |
| V4 | Richest model entry preserved + note that remaining 2 models concur |
| V5 | Severity preserved as-is (P1) — Chairman does not reassign P-levels |

---

### CH-2: Partial Agreement (2/3 Agree)

**Description**: Two of three models report the same issue, but one model does not flag it. The Chairman should aggregate them as a 2/3 finding with per-model listing.

**Setup/Given**: Three models review the same chunk. Claude and Codex both report "Unbounded loop in `fetchAll()` risks OOM" as P1. Gemini does not flag this issue.

**Expected Behavior/Then**: The Chairman aggregates the reports. The issue is identified by 2/3 models. Per-model attribution lists each model's finding separately.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Issue identified by 2/3 models |
| V2 | Agreeing models (Claude, Codex) attributed as sources with per-model listing |
| V3 | Dissenting model (Gemini) noted as "did not identify" |
| V4 | Severity reflects the P-level as reported by agreeing models — Chairman does not reassign |
| V5 | Issue included in final output (not silently dropped) |

---

### CH-3: Unique Finding (1/3)

**Description**: Only one model reports an issue that the other two do not. The Chairman should aggregate it as a 1/3 finding with model attribution.

**Setup/Given**: Three models review the same chunk. Only Gemini reports "Race condition between `updateInventory()` and `processRefund()` under concurrent requests" as P1. Claude and Codex do not flag this.

**Expected Behavior/Then**: The Chairman aggregates the issue as identified by 1/3 models and attributes it to the reporting model.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Issue identified by 1/3 models |
| V2 | Reporting model (Gemini) attributed as sole source |
| V3 | Non-reporting models (Claude, Codex) noted as "did not identify" |
| V4 | Issue included in final output — not silently dropped |
| V5 | Issue surfaced for human judgment rather than auto-resolved |

---

### CH-4: P0 Severity Pass-through

**Description**: A P0 issue reported by a model is passed through by the Chairman without evaluation. The Chairman does not assign, reassign, or interpret P-levels.

**Setup/Given**: Three models review the same chunk. Only Claude reports "SQL injection via unsanitized `orderId` parameter in `findOrder()`" as P0. Gemini and Codex do not flag this issue.

**Expected Behavior/Then**: The Chairman passes through the P0 as reported by the model. Model count is 1/3. P-level pass-through applies without Chairman judgment.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Chairman passes through P0 as reported by model — does not assign, reassign, or evaluate the P-level |
| V2 | Model count is 1/3. P-level (P0) is passed through without Chairman judgment. |
| V3 | Issue prominently surfaced in output regardless of model count |
| V4 | Chairman aggregation-only rule applied: P-level pass-through without interpretation. P0 protection evaluation deferred to SKILL.md Final Adjudication. |
| V5 | Issue attributed to reporting model (Claude) with non-reporters noted as "did not identify" |

---

### CH-5: Degradation 2/3 — One Model Fails

**Description**: One of three models fails to respond. The Chairman should proceed with a partial review using the two available results and warn about the missing model's gap.

**Setup/Given**: Three models dispatched for review. Claude and Gemini return valid results. Codex fails (timeout, error, or empty response).

**Expected Behavior/Then**: The Chairman proceeds with 2/3 available results. A partial review warning is emitted. The gap from the missing model is noted.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Review proceeds with 2 available model results (not aborted) |
| V2 | Partial review warning emitted (e.g., "Partial review: 2/3 models responded") |
| V3 | Missing model (Codex) explicitly identified in the warning |
| V4 | Gap noted: areas that the missing model might have uniquely covered |
| V5 | Model count denominator remains 3 (total dispatched). 2-model agreement = 2/3, 1-model = 1/3. "Unavailable" distinct from "did not identify". |

---

### CH-6: Degradation 1/3 — Two Models Fail

**Description**: Two of three models fail to respond. The Chairman should proceed with limited review from the single remaining model.

**Setup/Given**: Three models dispatched. Only Claude returns a valid result. Gemini and Codex both fail.

**Expected Behavior/Then**: The Chairman proceeds with 1/3 available results. A limited review warning is emitted. Model count denominator remains 3, with findings reported as 1/3.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Review proceeds with 1 available model result (not aborted) |
| V2 | Limited review warning emitted (e.g., "Limited review: 1/3 models responded") |
| V3 | Missing models (Gemini, Codex) explicitly identified as "unavailable" (distinct from "did not identify") |
| V4 | Model count denominator remains 3. Single-model findings reported as 1/3. |
| V5 | Recommendation to re-run review noted given limited coverage |

---

### CH-7: Degradation 0/3 — All Models Fail

**Description**: All three models fail to respond. The Chairman should emit a failure report without producing a review.

**Setup/Given**: Three models dispatched. All three (Claude, Gemini, Codex) fail to return valid results.

**Expected Behavior/Then**: The Chairman does not produce a review. A failure report is emitted with details of the failures.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | No review output produced — no Strengths, Issues, Recommendations, or Assessment sections |
| V2 | Failure report emitted with all three models identified as failed |
| V3 | Failure reasons included if available (timeout, error message, etc.) |
| V4 | Recommendation to retry the review dispatch |
| V5 | No fabricated findings — Chairman does not generate its own review content |

---

### CH-8: Reviewer Count Independence

**Description**: The Chairman workflow operates identically regardless of how many reviewers are configured. There is no separate "single mode" branch.

**Setup/Given**: `config.yaml` sets `reviewers` list with only 1 model (e.g., Claude only). User requests a code review.

**Expected Behavior/Then**: The Chairman workflow runs the same aggregation pipeline with 1 reviewer. Model count is 1/1. No special-case branching for single-reviewer configurations.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Chairman aggregation workflow executes — no bypass or short-circuit for single reviewer |
| V2 | Single model dispatched, result processed through the same aggregation pipeline |
| V3 | Model count reported as 1/1 (denominator = total dispatched) |
| V4 | Output format identical to multi-reviewer output (same sections, same structure) |
| V5 | No "single-model mode" or "chairman mode" branching logic — workflow is reviewer-count-agnostic |

---

### CH-9: Verdict Disagreement — Per-Model Verdict Pass-through

**Description**: When models disagree on the merge verdict, the Chairman passes through each model's verdict individually. The Chairman does not compute a final verdict.

**Setup/Given**: Three models review the same PR. Claude verdict: "Yes, ready to merge". Gemini verdict: "Yes, with low-severity issues". Codex verdict: "No, P0 issues found".

**Expected Behavior/Then**: The Chairman lists each model's verdict individually without computing a combined verdict. Verdict aggregation is deferred to downstream processing.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Per-model verdicts listed individually (Claude: Yes, Gemini: Yes, Codex: No) |
| V2 | Each model's individual verdict attributed and visible |
| V3 | Chairman does not compute a combined/final verdict — passes through per-model verdicts only |
| V4 | The "No" rationale from Codex included alongside its verdict |
| V5 | All per-model verdicts preserved without suppression or override |

---

### CH-10: Large Chunk Prompt Size — Context Window Safety

**Description**: A large chunk (15 files) is dispatched to multiple models without exceeding context window limits.

**Setup/Given**: A 15-file chunk with substantial diff content dispatched to three models. The combined prompt (template + diff + context) approaches model context window limits.

**Expected Behavior/Then**: All three models receive the prompt without context window overflow. The dispatch does not truncate or silently drop files.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | 15-file chunk dispatched as a single unit to each model |
| V2 | No files silently dropped or truncated from the diff |
| V3 | Template placeholders fully interpolated without overflow |
| V4 | If prompt exceeds safe threshold, chunk is split rather than truncated |
| V5 | Each model receives identical prompt content for fair comparison |

---

### CH-11: Chairman Boundaries — No Own Opinions

**Description**: The Chairman aggregates model outputs but must not add its own review opinions. It is an aggregator, not a reviewer. Specifically: no P-level assignment, no verdict computation, no reinterpretation of model agreement levels.

**Setup/Given**: Three models return their reviews. The Chairman processes the results. The diff contains an obvious issue (e.g., hardcoded password) that no model flagged.

**Expected Behavior/Then**: The Chairman does not add the unflagged issue to the aggregation. It only reports what the models reported.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Chairman output contains only issues from model reports — no novel issues added |
| V2 | Chairman does not re-review the diff or source code |
| V3 | Strengths section contains only model-reported strengths — no Chairman additions |
| V4 | Recommendations section aggregates model recommendations — no Chairman-originated recommendations |
| V5 | Chairman role is strictly aggregation — no P-level assignment, no verdict computation, no reinterpretation of model agreement levels |

---

### CH-12: Chunk Analysis Merge — Most Detailed Entry Selected by Word Count

**Description**: When multiple models produce change-unit-scoped Chunk Analysis (What Changed entries), the most detailed entry for each change-unit is selected across models. Selection criterion = highest word count in the What Changed field.

**Setup/Given**: Three models produce Chunk Analysis for the same 5-file chunk. For `PaymentService#processPayment`: Claude provides a 15-word What Changed entry, Gemini provides a 40-word entry with behavioral detail, Codex provides a 25-word entry. For `OrderController#createOrder`: Claude provides a 35-word entry, Gemini provides a 10-word entry, Codex provides a 20-word entry.

**Expected Behavior/Then**: The Chairman selects the most detailed What Changed entry per change-unit across models. `PaymentService#processPayment` uses Gemini's 40-word entry. `OrderController#createOrder` uses Claude's 35-word entry.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Per-entry selection is entry-by-entry (per change-unit), not all-from-one-model |
| V2 | Most detailed entry selected for each change-unit (criterion = highest word count in What Changed field) |
| V3 | Selected entry attributed to its source model |
| V4 | No entry content merged/blended across models for the same change-unit — selection is atomic per entry |
| V5 | All change-units in the chunk have an entry in the final output |

---

## Manifest Workflow Scenarios

> Phase 3 of code-review Application TDD — tests the manifest data acquisition mechanism (start→poll→results manifest→Read outputFile→aggregate).
>
> The CH-1~CH-12 scenarios above test **aggregation logic** (what to do with results). The MA scenarios below test the **data acquisition mechanism** (multi-step subcommand workflow that keeps each Bash call under the 120-second default timeout).

### MA-1: Full Success — Multi-Step Workflow + Read (3/3)

**Description**: All three reviewers complete successfully. The Chairman must start the job, poll until done, get the manifest JSON, read each reviewer's `outputFilePath`, and proceed to aggregation.

**Setup/Given**: `chunk-review.sh start` creates a job. After 2-3 polling cycles via `wait`, `overallState` becomes `"done"`. `results --manifest` returns manifest JSON with 3 reviewers, all with non-null `outputFilePath` paths pointing to job directory `output.txt` files.

**Manifest JSON (Bash stdout)**:
```json
{
  "id": "job-test-ma1",
  "reviewers": [
    { "reviewer": "claude", "outputFilePath": ".omt/jobs/job-test-ma1/reviewers/claude-0/output.txt", "errorMessage": null },
    { "reviewer": "codex", "outputFilePath": ".omt/jobs/job-test-ma1/reviewers/codex-0/output.txt", "errorMessage": null },
    { "reviewer": "gemini", "outputFilePath": ".omt/jobs/job-test-ma1/reviewers/gemini-0/output.txt", "errorMessage": null }
  ]
}
```

**Expected Behavior/Then**: Chairman uses start→poll→results multi-step workflow, then issues 3 Read tool calls for each outputFilePath, collects all review content, and proceeds to standard aggregation (CH-1~CH-12 logic).

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `start` 서브커맨드 1회 실행 → JOB_DIR 경로 추출 |
| V2 | `wait --timeout-ms 100000` 반복 호출 → `overallState: "done"` 확인 후 진행 |
| V3 | `results --manifest` 1회 실행 → manifest JSON에서 `id` + `reviewers` 배열 추출 |
| V4 | 3개 reviewer 각각의 `outputFilePath` 추출, Read tool 3회 호출 (Bash로 cat하지 않음) |
| V5 | `outputFilePath` null 여부 확인, non-null만 Read 시도 |
| V6 | 3개 reviewer 내용 수집 후 표준 aggregation (CH-1~CH-12) 진입 |
| V7 | `start` 서브커맨드는 정확히 1회 (exactly-once job start 준수) |

---

### MA-2: Partial Success — Mixed States (2/3 Available)

**Description**: Two reviewers succeed, one fails with `non_retryable`. The Chairman must complete the multi-step workflow, read only the two available outputFiles, skip the null outputFile, and apply Degradation Policy (partial aggregation).

**Setup/Given**: Job completes via start→poll→results. Manifest JSON has 3 reviewers: claude and codex with non-null outputFilePath, gemini with `outputFilePath: null` + errorMessage.

**Manifest JSON (Bash stdout)**:
```json
{
  "id": "job-test-ma2",
  "reviewers": [
    { "reviewer": "claude", "outputFilePath": ".omt/jobs/job-test-ma2/reviewers/claude-0/output.txt", "errorMessage": null },
    { "reviewer": "codex", "outputFilePath": ".omt/jobs/job-test-ma2/reviewers/codex-0/output.txt", "errorMessage": null },
    { "reviewer": "gemini", "outputFilePath": null, "errorMessage": "NON_RETRYABLE: TerminalQuotaError" }
  ]
}
```

**Expected Behavior/Then**: Chairman reads 2 outputFilePaths (claude, codex), skips gemini (outputFilePath null, errorMessage explains why), applies partial aggregation with degradation notice.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Manifest에서 `outputFilePath: null`인 gemini를 식별 — Read 시도하지 않음 |
| V2 | `outputFilePath`이 non-null인 claude, codex에 대해서만 Read tool 호출 (2회) |
| V3 | Degradation Policy 적용: "Partial review (2/3 respondents)" 접두 |
| V4 | gemini를 "Unavailable (NON_RETRYABLE: TerminalQuotaError)"로 표기 — errorMessage를 직접 사용 |
| V5 | 분모(denominator)가 3 (총 dispatched) — 응답 수가 아님 |
| V6 | start 서브커맨드 재실행하지 않음 (degradation이어도 exactly-once job start 준수) |

---

### MA-3: Total Failure — All outputFiles Null (0/3)

**Description**: All three reviewers fail. All outputFilePaths are null. The Chairman must recognize that no review content is available and return a failure report without attempting any Read calls.

**Setup/Given**: Job completes via start→poll→results. Manifest JSON has 3 reviewers, all with `outputFilePath: null` and errorMessage present.

**Manifest JSON (Bash stdout)**:
```json
{
  "id": "job-test-ma3",
  "reviewers": [
    { "reviewer": "claude", "outputFilePath": null, "errorMessage": "Process exited with code 1" },
    { "reviewer": "codex", "outputFilePath": null, "errorMessage": "Timed out after 480s" },
    { "reviewer": "gemini", "outputFilePath": null, "errorMessage": "NON_RETRYABLE: TerminalQuotaError" }
  ]
}
```

**Expected Behavior/Then**: Chairman does NOT attempt any Read tool calls. Returns failure report immediately.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Read tool 호출 0회 — 모든 outputFilePath가 null이므로 읽을 파일 없음 |
| V2 | 즉시 failure report 반환: "Review unavailable. All models failed: [errorMessages]." |
| V3 | 각 model의 errorMessage 포함 (claude: "Process exited with code 1", codex: "Timed out after 480s", gemini: "NON_RETRYABLE: TerminalQuotaError") |
| V4 | Aggregation 섹션(Chunk Analysis, Strengths, Issues 등) 없음 — failure report만 반환 |
| V5 | start 서브커맨드 재실행하지 않음 (exactly-once job start) |
| V6 | Chairman이 자체 리뷰 의견을 생성하지 않음 (CH-11 Boundaries 준수) |

---

### MA-4: Manifest Stdout Size Safety + Timeout Safety

**Description**: Verifies the manifest mode's two design invariants: (1) `results --manifest` stdout contains only the lightweight manifest JSON (~500B for 3 reviewers), not the full review content (which can be 50-100KB); (2) each individual Bash call (start, wait, results) completes well under the 120-second default Bash tool timeout.

**Setup/Given**: Three reviewers each produce 30KB+ of review output. Workers take ~3 minutes total. The multi-step workflow (start→poll→results) ensures no single Bash call blocks for the full duration.

**Expected Behavior/Then**: Each Bash call completes under 105 seconds. The `results --manifest` output is well under 2KB. Each outputFile contains the full review content retrievable via Read tool.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | `start` 호출 < 5초, 각 `wait` 호출 ≤ 100초, `results` 호출 < 2초 — 120초 기본 timeout 미도달 |
| V2 | `results --manifest` stdout가 2KB 미만 — 30KB output limit에 도달하지 않음 |
| V3 | Manifest JSON이 truncation 없이 완전한 상태로 agent에 도달 |
| V4 | JSON에 `output` 필드 없음 — review content가 inline되지 않음 (`--json` 모드와의 핵심 차이) |
| V5 | 각 outputFilePath를 Read tool로 읽으면 완전한 review content 획득 (30KB+도 손실 없음) |
| V6 | manifest JSON의 reviewer 순서가 알파벳순 (결정적 순서) |

---

### MA-5: Tool Allowlist Enforcement — Read + Bash Only

**Description**: The chunk-reviewer agent is constrained to `tools: Bash, Read` in frontmatter. This scenario verifies the agent uses ONLY these two tools during the multi-step manifest workflow — no Grep, Glob, WebSearch, or other tools.

**Setup/Given**: Normal multi-step manifest workflow with 3/3 success. Agent executes start→poll→results→Read→aggregate.

**Expected Behavior/Then**: Agent's tool usage follows exactly: (1) Bash for start, wait (polling), results, (2) Read for each outputFile. No other tools used.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Bash 사용: start 1회 + wait N회 + results 1회 (mktemp+write는 start와 결합 가능) |
| V2 | Read 사용 횟수: outputFile 개수와 동일 (3/3 성공 시 3회) |
| V3 | Glob, Grep, WebSearch 등 다른 tool 호출 없음 |
| V4 | git 명령어 실행 없음 (Bash 내에서도 금지) |
| V5 | 소스 코드 파일 Read 없음 — outputFilePath 경로만 Read |
| V6 | 총 turn 수가 maxTurns(12) 이내: start+init(1) + poll(2-3) + results(1) + Read×3(1) + aggregate(1) = ~7턴 |
