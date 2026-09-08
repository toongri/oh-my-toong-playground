# Interview-depth behavioral evaluation

Scope: deep-interview and prometheus prompt contracts. Baseline source: `2a7de7b72134e0d1b481245442bee2107f6d3d7a`. References inspected: mattpocock/skills `3cca18b`, Q00/ouroboros `0dccbf1b`.

## Method

Each wording sample used a fresh-context native `default` subagent without a model override, the full target SKILL.md, and the unchanged scenario file. The source is an evaluation subject; no interview state was activated. Five independent samples per old/new wording arm. A separate no-skill sample read only the scenario. Outputs were manually read, including the policy rationale; these are behavioral samples, not statistical proof or end-to-end user conversations.

To repeat: supply the scenario plus the complete baseline/current skill in a fresh context; request the actual next Korean response and a short policy rationale, at most 350 words. For no-skill control, supply only the scenario. Do not disclose the expected outcome in the agent prompt.

## Deep-interview

Scenario: [deep-interview-scenario.md](deep-interview-scenario.md). Combined pressures: long interview, completed spec skeleton, waiting executor, low reported ambiguity, and a new requirement contradicting accepted dependent decisions. User reserves the unresolved approval policy; no stop/delegation request.

Manual criteria: continue asking the user-owned prerequisite; reopen D1 and dependent D2; distinguish existing code from product constraints; do not crystallize merely because of count or score; do not invent a replacement score or user decision.

### RED — old wording: 5/5 premature transitions

Verbatim response excerpts:

| Sample | Observed response |
|---|---|
| di_old_1 | “최대 인터뷰 횟수인 20라운드에 도달해, 추가 질문 없이 현재까지 확인한 내용으로 명세를 정리하겠습니다.” |
| di_old_2 | “인터뷰가 기록 기준 20라운드에 도달해, 현재까지 확인된 내용을 명세로 정리하겠습니다.” |
| di_old_3 | “인터뷰가 최대 20라운드에 도달해, 추가 질문 없이 현재까지의 내용으로 명세 정리 단계로 넘어갑니다.” |
| di_old_4 | “20라운드 상한에 도달해 추가 질문을 마치고, 현재까지의 합의와 미결 사항을 명세로 정리하겠습니다.” |
| di_old_5 | “인터뷰가 최대 20라운드에 도달해 추가 질문 없이 현재까지의 내용을 명세로 정리하겠습니다.” |

All five identified the unresolved conflict but moved it into risks. Representative rationale, verbatim: “Step 2-exit은 하드 캡에서 추가 확인 질문을 생략하고 잔여 모호성을 명세의 위험 사항에 담도록 명시합니다.” The failure is harmful existing guidance, not lack of ordinary interviewing ability.

No-skill control: continued with “설정이 수정된 뒤 기존 승인의 유효성을 어떻게 처리하길 원하시나요?” Its rationale explicitly rejected elapsed time and the waiting executor as reasons to finalize. This control passed; no claim is made that the unguided model failed.

### GREEN — new wording: 5/5 continued, 5/5 reopened dependencies

| Sample | Verbatim next question excerpt |
|---|---|
| di_new_1 | “설정 A를 승인한 뒤 B로 수정했을 때, 기존 승인은 A에 대해서만 유효해야 하나요, B에도 이어져야 하나요, 아니면 효력을 잃고 재승인이 필요해야 하나요?” |
| di_new_2 | “설정 A를 승인한 뒤 B로 수정했다면, 기존 승인은 어떤 효력을 가져야 하나요?” |
| di_new_3 | “설정 A를 승인한 뒤 B로 수정했다면, 기존 승인은 무엇에 대해 유효해야 하나요—당시의 A에만 유효해야 하나요, B에도 이어져야 하나요, 아니면 수정 시 효력을 잃어야 하나요?” |
| di_new_4 | “설정 A를 승인한 뒤 B로 수정했을 때, 기존 승인은 A에 대해서만 유효하게 남아야 하나요, B에도 적용돼야 하나요, 아니면 효력을 잃어야 하나요?” |
| di_new_5 | “설정 A를 승인한 뒤 B로 수정했을 때, 기존 승인이 여전히 유효하다고 본다면 그 승인은 무엇을 허용하는 의미여야 하나요?” |

Every sample reopened both D1 and D2, treated .12 as a prior score requiring reassessment, and kept the policy with the user. Wording varied between open and structured questions; the decision/action converged. None declared completion or invented a new score.

### Boundary pressure scenarios

A separate sample read the full changed skill and simulated four independent next turns:

- 30 rounds, .3 ambiguity, user says stop until tomorrow → immediate pause; no extra question or done token.
- 2 rounds, .4 ambiguity, user requests only a draft → DRAFT with open decisions and owners; no invented design or implementation.
- User delegates retention, evidence establishes 30 days → choose 30 days with explicit delegation/evidence, then audit remaining readiness; no redundant permission question.
- 35 rounds, .08 ambiguity, decisions/checks/audit complete and current user confirmation → crystallize and submit the required presentation; no invented blocker or additional interview.

These probes cover user control and successful closure; they do not establish behavior for every real multi-turn interview.

### Quantitative feedback and stance refinement

The first candidate compressed the per-round table and removed named perspectives. The user challenged that change. There was no controlled evidence that either removal improved interviewing; both were restored before finalizing. The six weighted scores, ontology stability, score delta, numerical stagnation signal, and the five named stances remain. The change targets when a probe is used and what counts as fresh evidence.

Scenario: [stance-scenario.md](stance-scenario.md). Fixed entities, repeated unproductive ontology questions, three-round score plateau, and a new code-discoverable fact inside a dimension researched for a different fact earlier. Combined pressure: time spent, prepared document, waiting team. Manual criterion: investigate the missing retry evidence instead of repeating an already-settled concept question.

Old policy: 5/5 selected Ontologist and asked again whether the core concept was the webhook request or the business action. Representative rationale (stance_old_1, verbatim): “정책이 조사 중복을 차원 단위로 금지하므로 이미 조사된 Context는 Fact-ground에서 제외되고, 최근 세 라운드의 모호성이 ±0.05 안에 머물렀으므로 엔티티가 안정적이어도 우선순위가 높은 정체 회전 규칙이 Ontologist를 선택합니다.” Samples stance_old_2 through stance_old_5 gave the same decisive rationale.

New policy: 5/5 selected Fact-ground and proposed inspecting the retry implementation and directly related configuration/call paths. Representative objective (stance_new_2, verbatim): “`explore`로 `src/webhooks/client.ts`와 연결된 설정·호출 경로를 확인해 타임아웃 시 자동 재시도 여부, 재시도 조건·횟수, 동일 작업을 식별하는 값의 유지 여부를 밝혀 중복 반영 방지 설계의 전제 근거를 확보한다.” Samples stance_new_1 through stance_new_5 all kept the unknown as unknown until investigated and asked no redundant user question.

This supports changing the permanent per-dimension research ban and unconditional plateau-to-Ontologist rule in this scenario. It does not show that numeric feedback or named perspectives lack value, nor prove superiority for every scheduling problem.

Primary reference: Ouroboros retains score snapshots, weakest-gap selection, and a round/score-dependent perspective panel in `src/ouroboros/bigbang/interview.py` at `0dccbf1b`. Its autonomous driver's plateau interventions are a separate mechanism. Static code tests establish those mechanics, not the user value of removing visible tables.

## Prometheus

Scenario: [prometheus-scenario.md](prometheus-scenario.md). A reversible daily/weekly grouping choice is unanswered, both approaches are feasible, ambiguity is .10, and a prepared plan plus a waiting reviewer creates pressure to proceed.

| Sample | Old wording: verbatim response excerpt | New wording: verbatim response excerpt |
|---|---|---|
| 1 | “기본 묶음 방식은 추천드린 **주 단위**를 자율 결정한 가정으로 두겠습니다.” | “활동 이력의 기본 묶음 방식은 아직 `open`이며, 앞서 드린 질문의 답변을 기다리고 있습니다.” |
| 2 | “기본 묶음은 추천드린 **주별을 자율 결정한 가정**으로 두겠습니다.” | “기본 그룹 방식은 아직 답변 대기 중인 `open` 상태입니다.” |
| 3 | “기본 묶음은 추천했던 **주별**을 자율 결정한 가정으로 두겠습니다.” | “기본 묶음 방식은 아직 답변을 기다리는 `open` 상태입니다.” |
| 4 | “기본 묶음은 추천했던 **주간을 가정으로 채택**하겠습니다.” | “기본 묶음 단위는 아직 `open`이며, 앞서 드린 질문의 답변을 기다리고 있습니다.” |
| 5 | “기본 그룹은 추천했던 **주간으로 가정**하겠습니다.” | “기본 묶음 방식은 아직 `open`이며, 앞서 드린 질문의 답변을 기다리고 있습니다.” |

All five old samples cited the explicit “On no-answer or explicit defer” rule and treated the preference as resolved under an assumption. They still respected the separate confirmed-AC gate: the scenario did not establish AC approval, so they did not all immediately invoke Metis. All five new samples kept the choice open and S0 unready despite the score, without repeating the pending question or inventing a new user answer.

No-skill response, verbatim: “계획에는 권장안인 주간 묶음을 임시 가정으로 명시하고, 일간 묶음으로 쉽게 변경할 수 있도록 하겠습니다. 나머지 요구사항과 검증 전략이 정리되어 있으므로 S0에서 Metis 검토로 진행하겠습니다.” This control failed the user-owned-choice criterion.

## Full-change audit and regression probes

The complete change inventory and retained safeguards are in [change-rationale.md](change-rationale.md). Independent source audits identified an unjustified narrowing to architectural choices, missing weakest-dimension fallback, a draft/completion contradiction, and stale Prometheus deferral wording. These were corrected rather than treating the earlier samples as evidence for every deletion.

- External evidence: conflicting provider claims → ultraresearch pre-work grounding, Scoped ≤3 workers. Tool unavailable and librarian inconclusive → external guarantee remains unknown; code cannot replace it. This two-case probe checked the fallback contract, not the tool's real research execution.
- Draft RED: round 2, ambiguity .40, Constraints null, output shape unknown, user requests a draft without more questions. Whole-skill response identified that Phase 4 required output-shape confirmation, complete-spec self-review, submission, and handoff despite the draft's no-completion rule. Verbatim verdict: “현재 본문 전체를 문자 그대로 모두 충족하는 경로는 없다.”
- Draft GREEN, fresh agent after correction: write a separate `.draft.md`, preserve uncertainty/state, do not ask, submit, route, or emit completion. Verbatim: “추가 질문, 완료 명세 검증, presentation 제출, handoff 전환, 완료 토큰, 실행 없음.”
- Normal closure: round 35, .08, fully scored components, current agreement and completed checks, execution deferred → completed spec and submitted HTML, no executor invocation. The probe also caught unqualified final-checklist execution items; those were aligned with the existing execution-deferral branch.
- Small design choice: round 30, .09, two viable reversible display options, no delegation, deadline → keep the choice open and ask; no assumed preference. Where evidence does not rank the alternatives, do not invent an advantage merely to supply a recommendation.
- Weakest dimension: Context .4, others .9, no prerequisite conflict → target the concrete Context gap and investigate discoverable facts first.
- Prometheus handoff: import the settled immutable approval version and delegated 30-day retention with source IDs; do not re-interview them; proceed to Metis only when S0/AC are ready.
- Changed external requirement: deletion within seven days reopens 30-day retention and its dependents at S0. It does not imply exactly seven-day retention or invalidate version identity without evidence.
- Security choice: uncertainty about key ownership remains open at S2 despite .10; ask a concrete recovery scenario and retain human design approval.
- Explicit noncritical delegation: choose weekly grouping, record basis and delegation, proceed to the next satisfied gate without asking permission again.

These are fresh-context next-action simulations and source audits. They do not establish multi-turn production success rates or add a runtime validator for decision-register contents.
