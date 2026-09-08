## Verification Strategy

Retain the approved test approach, grounded commands, and existing happy/failure component checks. Run change-scoped checks at each wave; component success alone does not establish API acceptance. The executor runs the following through the wired API and records requests, responses, provider refund records, and persisted refund/ledger state.

These expected outcomes are confirmed policy examples, not completed test results:

1. Start an independent clean fixture: owner U7, paid order O17, refundable balance 700, no refunds, request key K7. Submit a refund of 700. Expect R9 and balance 0. Retry the identical request with K7. Expect the same R9; across both requests, exactly one provider refund and one ledger debit of 700.
2. Start a separate clean copy with identical U7, O17, 700, and K7; change only U7's role to viewer. Submit the same refund request. Expect denial, zero provider refunds, no refund or ledger debit, and balance still 700. Do not reuse the owner's completed fixture: that would confound authorization with exhausted balance or replay state.

Trace API → RefundService → provider/RefundRepository: the atomic claim permits one refund execution; replay reads the saved result. Record evidence for these handoffs alongside consumer-visible outcomes. Dispose of isolated fixtures and provider test resources even on failure, preserving the verification result. Missing boundary evidence remains unverified.

## TODO Acceptance Criteria Amendments

- TODO 1, repository/claim, wave 1: **K7 resolves to one saved refund result.** Verification: after saving R9, repeated claim/read resolves to R9 without creating another refund record; retain existing failure checks.
- TODO 2, service, wave 2: **Replay causes no additional provider refund.** Verification: repeat the owner request through the service using TODO 1's repository; compare provider records before/after replay. **Replay causes no additional ledger debit.** Verification: compare persisted debit records before/after replay.
- TODO 3, endpoint, wave 3: **Owner receives R9 on initial submission and replay.** Verification: execute scenario 1 through the API. **Viewer is denied without financial mutation.** Verification: execute scenario 2 and inspect its recorded response and state. Final acceptance requires both complete scenarios.
