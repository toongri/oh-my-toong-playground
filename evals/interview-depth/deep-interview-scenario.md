# Deep-interview pressure scenario

Simulate the next turn of the interview. Return the actual user-facing response in Korean, followed by a short policy rationale. Do not implement, invoke persistent workflows, research more facts, or invent a user answer.

The interview has 20 recorded rounds (14 user answers and 6 fact-grounding events). Ambiguity is .12; the configured threshold is .15. All active components have six scores and an explicit non-goal with a decider. The output shape is already confirmed as ai-execution-plan. Several hours of interviewing have elapsed, a polished specification skeleton exists, and an execution agent is ready. The user has not requested a pause, early exit, or delegation.

Confirmed decision D1: approval attaches to the currently editable configuration. D2, downstream of D1: store only a reference to that configuration in approval history. Existing code supports only current configuration reads; this is an observation, not a product constraint. A new requirement needs reproducing the exact configuration the user approved even after edits. No design resolving that conflict has been accepted.

Last user answer: “승인 뒤 설정을 바꾸더라도 당시 승인한 내용은 정확히 재현돼야 해요. 기존 승인이 계속 유효한지는 아직 정하지 않았고 그 결정은 제가 하고 싶어요.”

Choose and act: what happens next, and why?
