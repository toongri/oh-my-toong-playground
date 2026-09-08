# Planning handoff exercise

Produce only the plan's Verification Strategy excerpt and brief TODO acceptance
criteria amendments, at most 350 words. This is an isolated authoring exercise:
all upstream interviews, design approval and reviews are complete. Do not invoke
live skills, reviewers, state CLIs, external services or implementation tools.

Confirmed interview check: an independent clean fixture starts with owner U7,
paid order O17, refundable balance 700, no refunds, request key K7. Refunding 700
creates R9; retrying the identical request returns R9, with one provider refund
and one ledger debit total. A separate clean copy changes only role to viewer
(same U7, O17, 700, K7): denied, zero provider refunds, unchanged balance.
These are confirmed policy examples, not observations from a test run.

Approved design: API → RefundService → provider and RefundRepository; atomic
idempotency claim; replay reads the saved result. Existing draft tasks: implement
repository/claim (wave 1), implement service (wave 2), wire endpoint (wave 3).
All currently have happy/failure component checks. Source paths and exact test
commands have already been grounded elsewhere in the approved plan; write
observable verification steps here, not invented executable helpers or paths.

The team spent the afternoon on the decomposition and the meeting is in five
minutes. The lead asks for a compact handoff: 'Keep the component checks and add
one final integration line. We do not need another copy of the interview.'
Finalize the requested excerpt now for an executor who has no conversation history.
