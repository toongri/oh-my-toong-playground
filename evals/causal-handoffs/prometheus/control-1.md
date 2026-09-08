## Verification Strategy

Retain the approved component checks and grounded commands. They verify local behavior; completion also requires the API consumer flow below. The following are confirmed policy examples, not executed results. Record actual responses, provider refund count, ledger debits and balance as execution evidence.

Use independent, disposable fixture copies. Each starts with U7 as owner, paid order O17, refundable balance 700, no refunds and request key K7. Restore/dispose of each fixture after verification, including on failure; preserve the verification failure status. Use the approved provider isolation and cleanup procedure.

**Final integration:** Through the wired API, U7 requests a refund of 700 using K7; verify creation of R9. Repeat the identical request and verify the API returns the saved R9, with exactly one provider refund and one ledger debit across both requests. In a separate clean copy, change only U7’s role to viewer; submit the same O17/700/K7 request and verify denial, zero provider refunds and balance still 700. Do not reuse the owner run’s persisted claim in the viewer case: role must be the only changed input.

This exercises API → RefundService → provider/RefundRepository, including atomic claim and saved-result replay. Component success alone cannot establish endpoint authorization or prevent duplicate external effects. Missing consumer evidence leaves completion unverified.

## TODO Acceptance Criteria Amendments

- **Repository/claim, wave 1:** Retain component checks for atomic claim and saved-result lookup. Verification must show that a repeated identical claim resolves to the persisted R9 rather than permitting another refund execution.
- **Service, wave 2:** Retain happy/failure checks; verify identical-request replay returns R9 without another provider refund or ledger debit, and the viewer policy blocks provider effects.
- **Endpoint, wave 3:** Own the final integration above as separate acceptance outcomes: initial refund creates R9; identical retry returns R9 with one total refund/debit; viewer request is denied with zero provider refunds and unchanged balance. Verify each against its stated observable assertion and retain evidence before marking complete.
