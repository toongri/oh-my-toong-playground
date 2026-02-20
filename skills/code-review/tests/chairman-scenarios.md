# Chairman Multi-Model Consensus Test Scenarios

> Phase 2 of code-review Application TDD — tests the multi-model Chairman workflow with explicit verification points.

---

## Scenarios

### CH-1: Full Consensus (3/3 Agree)

**Description**: All three models report the same issue. The Chairman should mark it as Confirmed with unanimous consensus.

**Setup/Given**: Three models (Claude, Gemini, Codex) each independently review the same chunk. All three report the same issue: "Missing null check in `processPayment()` at line 42" with severity Important.

**Expected Behavior/Then**: The Chairman synthesizes the three reports and marks the issue as Confirmed (3/3 agreement). The final verdict reflects unanimous agreement.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Issue labeled 🔴 Confirmed (3/3 consensus) |
| V2 | All three model names attributed as sources |
| V3 | No dissenting opinion noted |
| V4 | Final verdict labeled as unanimous |
| V5 | Severity preserved as-is from the agreed classification (Important) |

---

### CH-2: Partial Consensus (2/3 Agree)

**Description**: Two of three models report the same issue, but one model does not flag it. The Chairman should mark it as High Confidence and note the dissenter.

**Setup/Given**: Three models review the same chunk. Claude and Codex both report "Unbounded loop in `fetchAll()` risks OOM" as Important. Gemini does not flag this issue.

**Expected Behavior/Then**: The Chairman synthesizes the reports and marks the issue as High Confidence (2/3 agreement). The dissenting model (Gemini) is explicitly noted.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Issue labeled 🟠 High Confidence (2/3 consensus) |
| V2 | Agreeing models (Claude, Codex) attributed as sources |
| V3 | Dissenting model (Gemini) explicitly noted as not flagging |
| V4 | Severity reflects the majority classification |
| V5 | Issue included in final output (not silently dropped) |

---

### CH-3: Unique Finding (1/3)

**Description**: Only one model reports an issue that the other two do not. The Chairman should mark it as Needs Review with model attribution.

**Setup/Given**: Three models review the same chunk. Only Gemini reports "Race condition between `updateInventory()` and `processRefund()` under concurrent requests" as Important. Claude and Codex do not flag this.

**Expected Behavior/Then**: The Chairman marks the issue as Needs Review (1/3 agreement) and attributes it to the reporting model.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Issue labeled 🟡 Needs Review (1/3 consensus) |
| V2 | Reporting model (Gemini) attributed as sole source |
| V3 | Non-reporting models (Claude, Codex) noted as not flagging |
| V4 | Issue included in final output — not silently dropped |
| V5 | Issue surfaced for human judgment rather than auto-resolved |

---

### CH-4: Critical Severity Exemption

**Description**: A Critical issue reported by only one model must never be downgraded. Critical severity is exempt from consensus-based downgrading.

**Setup/Given**: Three models review the same chunk. Only Claude reports "SQL injection via unsanitized `orderId` parameter in `findOrder()`" as Critical. Gemini and Codex do not flag this issue.

**Expected Behavior/Then**: Despite 1/3 consensus (which would normally yield 🟡 Needs Review), the Critical severity is preserved. The issue remains Critical and is never downgraded.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Issue retains Critical severity — not downgraded to Important or Minor |
| V2 | Consensus label may be 🟡 Needs Review (1/3), but severity stays Critical |
| V3 | Issue prominently surfaced in output regardless of consensus level |
| V4 | Critical exemption rule applied: "Critical from ANY single model must NEVER be downgraded" |
| V5 | Issue attributed to reporting model (Claude) with non-reporters noted |

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
| V5 | Consensus classification adjusted to 2-model scale (2/2 = Confirmed, 1/2 = High Confidence) |

---

### CH-6: Degradation 1/3 — Two Models Fail

**Description**: Two of three models fail to respond. The Chairman should proceed with limited review from the single remaining model.

**Setup/Given**: Three models dispatched. Only Claude returns a valid result. Gemini and Codex both fail.

**Expected Behavior/Then**: The Chairman proceeds with 1/3 available results. A limited review warning is emitted. Consensus classification is not applicable with a single model.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Review proceeds with 1 available model result (not aborted) |
| V2 | Limited review warning emitted (e.g., "Limited review: 1/3 models responded") |
| V3 | Missing models (Gemini, Codex) explicitly identified |
| V4 | No consensus classification applied — single-model findings presented as-is |
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
| V4 | Recommendation to retry or fall back to single-model mode |
| V5 | No fabricated findings — Chairman does not generate its own review content |

---

### CH-8: Mode Toggle — Single Model

**Description**: When config.yaml sets `mode=single`, the Chairman workflow is bypassed and legacy single-model behavior is used.

**Setup/Given**: `config.yaml` contains `settings.mode: "single"`. User requests a code review.

**Expected Behavior/Then**: Only one model is dispatched. No multi-model consensus, no Chairman synthesis. The single model's output is used directly as the review.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | config.yaml `settings.mode` value read and respected |
| V2 | Single model dispatched — no parallel multi-model dispatch |
| V3 | No consensus classification labels (Confirmed, High Confidence, Needs Review) in output |
| V4 | No Chairman synthesis step — single model output used directly |
| V5 | Switching `mode` from "chairman" to "single" produces functionally identical behavior to pre-Chairman workflow |

---

### CH-9: Verdict Disagreement — Strictest Wins

**Description**: When models disagree on the merge verdict, the strictest verdict wins. Any "No" from any model means overall "No".

**Setup/Given**: Three models review the same PR. Claude verdict: "Yes, ready to merge". Gemini verdict: "Yes, with minor issues". Codex verdict: "No, Critical issues found".

**Expected Behavior/Then**: The final verdict is "No" because Codex issued a "No". The strictest verdict wins regardless of majority.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Final verdict is "No" (not majority-ruled "Yes") |
| V2 | Each model's individual verdict attributed and visible |
| V3 | Strictest-wins rule applied: any "No" = overall "No" |
| V4 | The "No" rationale from Codex included in the final assessment |
| V5 | Dissenting "Yes" verdicts from Claude and Gemini noted but do not override |

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

**Description**: The Chairman synthesizes model outputs but must not add its own review opinions. It is a synthesizer, not a reviewer.

**Setup/Given**: Three models return their reviews. The Chairman processes the results. The diff contains an obvious issue (e.g., hardcoded password) that no model flagged.

**Expected Behavior/Then**: The Chairman does not add the unflagged issue to the synthesis. It only reports what the models reported.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Chairman output contains only issues from model reports — no novel issues added |
| V2 | Chairman does not re-review the diff or source code |
| V3 | Strengths section contains only model-reported strengths — no Chairman additions |
| V4 | Recommendations section synthesizes model recommendations — no Chairman-originated recommendations |
| V5 | Chairman role is strictly synthesis/aggregation, not review |

---

### CH-12: Chunk Analysis Merge — Richest Per-File Analysis Selected

**Description**: When multiple models produce per-file Chunk Analysis, the richest (most detailed) analysis for each file is selected across models.

**Setup/Given**: Three models produce Chunk Analysis for the same 5-file chunk. For `PaymentService.java`: Claude provides 3-line analysis, Gemini provides 8-line analysis with data flow details, Codex provides 5-line analysis. For `OrderController.java`: Claude provides 7-line analysis, Gemini provides 2-line analysis, Codex provides 4-line analysis.

**Expected Behavior/Then**: The Chairman selects the richest per-file analysis across models. `PaymentService.java` uses Gemini's 8-line analysis. `OrderController.java` uses Claude's 7-line analysis.

**Verification Points**:
| ID | Expected Behavior |
|----|-------------------|
| V1 | Per-file analysis selection is file-by-file, not all-from-one-model |
| V2 | Richest (most detailed) analysis selected for each file |
| V3 | Selected analysis attributed to its source model |
| V4 | No analysis content merged/blended across models for the same file — selection is atomic per file |
| V5 | All files in the chunk have an analysis entry in the final output |
