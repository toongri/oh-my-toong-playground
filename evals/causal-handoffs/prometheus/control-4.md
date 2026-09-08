## Verification Strategy

Retain the approved test decision, framework, change-scoped commands, and existing happy/failure component checks. The executor runs the following API scenarios after wave 3, observing the complete API → RefundService → provider/RefundRepository flow. Component checks alone do not establish acceptance.

The following are confirmed policy expectations, not observed test results. Use independent disposable fixtures, including isolated provider state; dispose of each fixture even after failure. Record requests, responses, provider refund counts, saved refund results, and ledger/balance observations in the plan's existing evidence location.

1. Start with owner U7, paid order O17, refundable balance 700, no refunds, and request key K7. Submit a refund of 700 through the endpoint. Verify the response identifies R9 and RefundRepository saves that result. Observe exactly one provider refund and one ledger debit of 700; the remaining refundable balance is 0.
2. Retry the identical request against that same fixture. Verify the API returns R9 from the saved result. Provider refunds and ledger debits remain one each, and balance remains 0. A second effect or a different result fails acceptance.
3. Start from a separate clean copy of the original fixture, changing only U7's role to viewer; retain O17, balance 700, no refunds, and K7. Submit the same refund request. Verify denial, zero provider refunds, zero ledger debits, unchanged balance 700, and no created refund. Reusing the already-refunded owner fixture would confound authorization with exhausted balance.

## TODO Acceptance Criteria Amendments

- **TODO 1 — repository/claim, wave 1:** Preserve component checks for atomic claim and saved-result retrieval. Their evidence must identify the claim/result subsequently consumed by RefundService; API acceptance awaits TODO 3.
- **TODO 2 — service, wave 2:** Preserve component checks; verify replay consumes the saved result without another provider refund or debit, and viewer denial produces no effects.
- **TODO 3 — endpoint, wave 3:** Own execution and evidence for all three API scenarios above. Acceptance requires each stated response and effect assertion to pass independently.
