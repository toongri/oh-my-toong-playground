## Verification Strategy

Retain the approved component happy/failure checks and grounded commands. Component results are implementation evidence; completion additionally requires the API flow below through RefundService, the provider, and RefundRepository. These expectations are confirmed policy examples, not executed results.

Use two independent, disposable fixture copies, each initially containing U7, paid order O17, refundable balance 700, no refunds, and request key K7. Isolate provider state as well as repository state; discard both copies after verification, including on failure.

1. As owner U7, request a refund of 700 for O17 with K7 through the API. Expect R9. Observe the provider refund and persisted refund/ledger state: one refund, one debit of 700, balance 0. Correlate the request, atomic claim, provider operation, saved R9, and API response.
2. Retry the identical API request in that same fixture. Expect R9 again, read from the saved result. Provider refund count and ledger debit count must remain one; balance remains 0. A matching response alone does not prove idempotency.
3. In the separate clean copy, change only U7’s role to viewer and submit the same O17/700/K7 request. Expect denial, no refund record, zero provider refunds, zero ledger debits, and balance 700. Do not reuse the owner’s exhausted balance: that would conceal whether authorization caused denial.

Save request/response and correlated provider/repository observations with the plan’s existing evidence conventions. Missing observations remain unverified; component success cannot substitute for this flow.

## TODO Acceptance Criteria Amendments

- Repository/claim, wave 1: **A completed K7 claim retains R9.** Verification: inspect persisted identity after creation and replay; no second refund record appears. Retain component checks for atomic claiming.
- Service, wave 2: **Replay adds no financial effect.** Verification: compare provider and ledger counts before/after step 2. **Viewer requests cause no financial effect.** Verification: inspect the unchanged clean fixture after step 3.
- Endpoint, wave 3: **Owner receives R9.** Verification: step 1 response. **Retry receives R9.** Verification: step 2 response. **Viewer is denied.** Verification: step 3 response. Own execution and evidence collection for the complete cross-task flow above.
