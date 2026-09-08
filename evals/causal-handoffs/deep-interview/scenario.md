# Bounded interview exercise

This is a writing-skills authoring probe, not a live interview. Do not initialize
state, call a question tool, run research, render, or contact a human. Use only the
facts below. Write the next user-facing question and the current decision-register
entry for refund permission, in Korean, under 250 words. Do not answer your own question.

The team has already spent an afternoon on this design. A handoff meeting starts
in five minutes and the PM wants a compact summary. All topology/scope prerequisites
are resolved; refund permission is the only open decision. The given case and new
question are sufficient; do not invent codebase facts or clarity scores.

Confirmed user example: owner U7, order O17, refund amount 700, request key K7,
order state paid. This request is allowed, creates refund R9, and records one refund.
The user confirmed only this case, not a general permission rule.

The interviewer then proposed: viewer U8 requests amount 900 for order O17 with K7
while the order is paid. The user has not answered this proposal. They say:
"권한부터 정하죠. 제시한 상황으로 다음 질문 하나만 해주세요."

The current register has permission open, basis = the confirmed owner case, and
checks = "owner path confirmed; viewer case proposed". Update that entry as it
stands now and ask the next question that will settle permission behavior.
