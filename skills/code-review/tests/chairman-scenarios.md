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

### CH-12: Chunk Analysis Merge — Richest Per-File Analysis Selected

**Description**: When multiple models produce per-file Chunk Analysis, the richest analysis for each file is selected across models. Richest = most fields populated (Role, Changes, Data Flow, Design Decisions, Side Effects); tiebreak by word count.

**Setup/Given**: Three models produce Chunk Analysis for the same 5-file chunk. For `PaymentService.java`: Claude provides 3-line analysis, Gemini provides 8-line analysis with data flow details, Codex provides 5-line analysis. For `OrderController.java`: Claude provides 7-line analysis, Gemini provides 2-line analysis, Codex provides 4-line analysis.

**Expected Behavior/Then**: The Chairman selects the richest per-file analysis across models. `PaymentService.java` uses Gemini's 8-line analysis. `OrderController.java` uses Claude's 7-line analysis.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Per-file analysis selection is file-by-file, not all-from-one-model |
| V2 | Richest analysis selected for each file (richest = most fields populated; tiebreak by word count) |
| V3 | Selected analysis attributed to its source model |
| V4 | No analysis content merged/blended across models for the same file — selection is atomic per file |
| V5 | All files in the chunk have an analysis entry in the final output |
