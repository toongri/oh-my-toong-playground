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
