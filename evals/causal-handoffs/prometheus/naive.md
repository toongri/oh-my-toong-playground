## Verification Strategy

Keep the existing happy-path and failure component checks in all three waves. Verify the repository’s atomic idempotency claim before building service orchestration; verify service behavior before wiring the endpoint. Record actual results against the expectations below; these expectations come from approved policy examples and have not yet been observed in a test run.

Repository checks must demonstrate that repeated or concurrent claims for the same request key cannot authorize multiple executions, and that the saved result can be retrieved for replay. Service checks must demonstrate that authorization precedes refund side effects and that replay returns the saved refund without another provider call or ledger debit. Endpoint checks must preserve the authenticated role and request identity through the service boundary and expose its success, replay, and denial outcomes.

Final integration check: Through the API → RefundService → provider and RefundRepository path, start a clean fixture with owner U7, paid order O17, refundable balance 700, no refunds, and request key K7; refund 700 and retry the identical request, expecting R9 both times, exactly one provider refund, one ledger debit, and remaining balance 0. In an independent clean copy of the initial fixture, change only the role to viewer, retaining U7, O17, amount 700, and K7; expect denial, zero provider refunds, no ledger debit, and balance still 700. Capture responses and provider/repository evidence; neither scenario passes on component results alone.

## TODO acceptance criteria amendments

- Wave 1 — repository/claim: retain component checks; demonstrate exclusive claim ownership and retrieval of the persisted refund result for replay.
- Wave 2 — service: retain component checks; demonstrate authorized execution, saved-result replay without duplicate side effects, and viewer denial before side effects.
- Wave 3 — endpoint: retain component checks; run both independent API scenarios above and attach observed response, provider-refund count, ledger-debit count, and balance evidence. Any mismatch blocks completion.
