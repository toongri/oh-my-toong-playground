# Deep Interview Examples

## Good: Follow the consequence of an answer

User: “An approval points to the current configuration.”

Interviewer: “If that configuration changes tomorrow, should yesterday's approval authorize the new contents or only what the user originally saw?”

User: “Only what they saw, and we must reproduce it exactly.”

Interviewer: “That changes D1, the approval's target, and reopens dependent D2, which stored only the mutable reference. To reproduce the approved contents, we can retain an immutable version or store the approved payload. A version keeps edits and approvals connected but requires version lifecycle rules; a payload makes each approval self-contained but duplicates data. I recommend a version because the existing edit history already retains revisions. Which should an approval identify?”

The recommendation's code claim requires actual evidence. Without that evidence, investigate edit history first. The question follows the changed prerequisite and compares two different designs against the same requirement.

## Good: Challenge a premise when it matters

“We have treated 10,000 concurrent users as a constraint, but the supplied traffic evidence only establishes 100. What event must the larger target support?”

Ask this whenever the premise drives a decision. There is no round at which challenging assumptions becomes available or stops being useful.

## Good: Keep a low-score interview open

“Reported ambiguity is 12%, but D4 is still open: nobody has decided whether editing a configuration invalidates its approval. That changes both the state machine and acceptance tests. What should happen to the approval after an edit?”

A number summarizes an assessment; it cannot settle the user's decision. The same question remains appropriate after 20, 40, or more rounds.

## Good: Respect different user intentions

| User says | Next behavior |
|---|---|
| “Stop here; resume tomorrow.” | Save the register and pause immediately. |
| “Send what we have now.” | Export a DRAFT with unresolved decisions and owners. |
| “Choose the storage approach yourself.” | Investigate alternatives, choose with reasons, record explicit delegation. |
| “I haven't decided approval validity yet.” | Keep it open and ask a concrete scenario that helps decide it. |

A draft is not a passed design. A user's uncertainty is not permission to decide for them.

## Good: Inspect breadth after depth

“We resolved approval storage, but deletion crosses that boundary: removing a configuration might destroy the evidence its approval needs. When the configuration is deleted, what must remain available from its approval history?”

This tests an interaction between decisions rather than continuing to polish one already-understood topic.

## Bad: Reassuring scores instead of evidence

“Ambiguity is 12%, so the requirements are ready.”

The score does not show whether an approval-lifecycle contradiction remains. Run the closure audit against the register and concrete checks.

## Bad: Question quotas and scheduled personas

“We have reached the interview limit, so unresolved decisions will go under Risks.”

“It's too early to challenge the assumption; the contrarian turn comes later.”

Neither the number of questions nor the number of previous challenges determines what is understood.

## Bad: Rediscovering facts through the user

“What database do you use?”

Inspect the code first. Then ask the user's decision, citing what the code establishes and what remains a choice.

## Bad: Bundling dependent decisions

“Should approvals survive edits, should we store versions, and when should those versions be deleted?”

Approval validity changes the available persistence and retention choices. Settle the prerequisite, then ask the next question using the answer.
