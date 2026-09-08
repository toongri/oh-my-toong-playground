## Verification Strategy

Keep the existing happy/failure component checks and the approved change-scoped commands. These support diagnosis; release acceptance requires the API flow below through RefundService, the provider, and RefundRepository. The following expected outcomes come from confirmed policy examples, not an executed test result.

Use two independent clean fixtures, each starting with U7, paid order O17, refundable balance 700, no refunds, and request key K7. Dispose of both fixtures and their isolated provider state after verification, including on failure. Retain request/response and provider/ledger evidence using the approved evidence location.

1. **Owner refund:** In the owner fixture, submit a refund of 700 through the endpoint. Observe R9 in the response and saved refund, one provider refund, one ledger debit of 700, and remaining refundable balance 0. Follow the request through API → RefundService → atomic claim → provider and repository result persistence; correlate the effects with O17 and K7.
2. **Identical retry:** Without resetting that fixture, repeat the identical request. Observe R9 again, obtained from the saved result. Provider refunds and ledger debits must remain one each, and balance must remain 0. A second effect fails verification even if the response repeats R9.
3. **Viewer denial:** In the other clean fixture, change only U7's role to viewer; retain O17, amount 700, and K7. Submit the same request through the endpoint. Observe denial, no saved refund, zero provider refunds or ledger debits, and balance 700. Never reuse the already-refunded owner fixture for this comparison.

## TODO acceptance criteria amendments

- **TODO 1 — repository/claim:** Saved R9 is retrievable for an identical claimed request. **Verification:** Inspect persisted K7/result linkage during the owner/retry flow; retain existing atomic-claim component checks.
- **TODO 2 — service:** Identical replay produces no additional financial effect. **Verification:** Compare provider and ledger counts before and after step 2; both remain one. Viewer denial preserves the clean fixture state in step 3.
- **TODO 3 — endpoint:** Own execution and evidence for all three API scenarios above. **Verification:** Record each expected response and state assertion separately; component passes alone cannot complete this TODO.
