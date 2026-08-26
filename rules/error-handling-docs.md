# TypeScript Error Handling Reference

When designing or reviewing how TypeScript code represents and propagates failures, open the doc below for the methodology.

- `~/docs/components/typescript-error-handling.md` — **TypeScript error handling**: failure-semantics classification (business/infrastructure/invariant), Result<T,E> vs typed throw choice, discriminated-union exhaustiveness (assertNever), boundary runtime validation (Zod), transport-boundary error mapping, worker/queue failure serialization (retryable, idempotency key), error-handling library selection (neverthrow, fp-ts, Effect, ts-pattern), error-handling anti-patterns
