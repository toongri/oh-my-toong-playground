# TypeScript Error Handling Guide

The concrete conclusion is that TypeScript has no single error-handling standard accepted across the whole community. Mainstream Node/TypeScript code commonly throws typed `Error`/custom errors and maps them to responses at the HTTP/RPC boundary. Functional-programming-oriented TypeScript code uses `Result`/`Either`/`Effect` typed failure channels. A practical recommendation is a hybrid: represent expected, recoverable business outcomes with `Result<T, E>`, throw stable-code typed errors for infrastructure failures or invariant violations that must abort and propagate, and map them once at the transport boundary.

## 1. The TypeScript model closest to Kotlin sealed classes

The closest native TypeScript model to Kotlin's sealed class—where the compiler knows the variants and catches missing `when` branches—combines the following:

- Use an enum as the discriminant.
- Put variant-specific fields on each member of a discriminated union.
- Put a `never`-returning `assertNever` in the default branch of a `switch`.

```ts
enum ValidationFailureCode {
  REQUIRED_FIELD = "REQUIRED_FIELD",
  INVALID_EMAIL = "INVALID_EMAIL",
}
interface RequiredFieldFailure {
  kind: ValidationFailureCode.REQUIRED_FIELD;
  field: string;
}
interface InvalidEmailFailure {
  kind: ValidationFailureCode.INVALID_EMAIL;
  normalizedValue: string;
}
type ValidationFailure = RequiredFieldFailure | InvalidEmailFailure;
function assertNever(value: never): never {
  throw new Error(`Unhandled validation failure: ${String(value)}`);
}
function describeFailure(failure: ValidationFailure): string {
  switch (failure.kind) {
    case ValidationFailureCode.REQUIRED_FIELD:
      return `${failure.field} is required`;
    case ValidationFailureCode.INVALID_EMAIL:
      return `Invalid email: ${failure.normalizedValue}`;
    default:
      return assertNever(failure);
  }
}
```

If a new variant is added to `ValidationFailure` but not handled in the `switch`, `assertNever` produces a compile-time error. TypeScript types are erased at runtime, however, so declaring external JSON, message, or HTTP input as `ValidationFailure` does not validate it. Use a runtime validator such as Zod at the boundary.

```ts
import { z } from "zod";
const validationFailureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(ValidationFailureCode.REQUIRED_FIELD), field: z.string() }),
  z.object({ kind: z.literal(ValidationFailureCode.INVALID_EMAIL), normalizedValue: z.string() }),
]);
function parseFailure(input: unknown): ValidationFailure {
  return validationFailureSchema.parse(input);
}
```

## 2. Classifying errors into four categories

Classify the failure before choosing its representation. The representations below are defaults, not mandatory rules.

| Category | Meaning | Common representation |
| --- | --- | --- |
| Expected domain/business rejection | A normal branch such as insufficient balance, duplicate order, or an input rule violation | `Result` or typed throw |
| Application/workflow failure | A coordinated operation cannot complete because of policy, cancellation, or a deadline | `Result` or typed throw according to the caller contract |
| Infrastructure/external failure | A DB, HTTP API, payment provider, filesystem, or queue fails or is temporarily unavailable | Typed throw with `cause` wrapped |
| Invariant/programmer error | An impossible state, bug, or invalid internal use | Throw immediately and observe it |

A business failure is neither automatically an exception nor automatically a `Result`. The same `INSUFFICIENT_BALANCE` outcome can be returned as data when a CLI needs to choose its next action, or thrown as a typed error when the current HTTP request must abort. Decide from the caller contract and recoverability.

TypeScript has no checked exceptions, and a return type such as `Promise<T>` does not express whether a function may throw. Manage throw contracts with Error classes, team rules, documentation, and tests. A `Result`, in contrast, exposes the failure channel in the function signature.

Use this simple decision table:

| Question | Choice |
| --- | --- |
| Must the caller branch on, recover from, or retry an expected failure? | `Result` |
| Must the current operation abort and propagate to an upper handler? | typed throw |
| Is it an invariant violation or programmer bug? | throw a separate invariant Error |

## 3. Representing expected branches with `Result<T, E>`

`Result` represents success and expected failure together as return values. Keep failure codes in stable enums and put structured details on the relevant variants.

```ts
enum RegistrationField { EMAIL = "EMAIL", AGE = "AGE" }
enum RegistrationFailureCode {
  REQUIRED_FIELD = "REQUIRED_FIELD",
  EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED",
  AGE_RESTRICTION = "AGE_RESTRICTION",
}
type RegistrationInput = { email: string; age: number };
type User = { id: string; email: string };
interface RequiredFieldFailure {
  code: RegistrationFailureCode.REQUIRED_FIELD;
  field: RegistrationField;
}
interface ExistingEmailFailure {
  code: RegistrationFailureCode.EMAIL_ALREADY_REGISTERED;
}
interface AgeRestrictionFailure {
  code: RegistrationFailureCode.AGE_RESTRICTION;
  minimumAge: number;
}
type RegistrationFailure = RequiredFieldFailure | ExistingEmailFailure | AgeRestrictionFailure;
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
declare function emailAlreadyRegistered(email: string): boolean;
declare function createUser(input: RegistrationInput): User;
function register(input: RegistrationInput): Result<User, RegistrationFailure> {
  if (input.email.length === 0) return { ok: false, error: { code: RegistrationFailureCode.REQUIRED_FIELD, field: RegistrationField.EMAIL } };
  if (input.age < 14) return { ok: false, error: { code: RegistrationFailureCode.AGE_RESTRICTION, minimumAge: 14 } };
  if (emailAlreadyRegistered(input.email)) return { ok: false, error: { code: RegistrationFailureCode.EMAIL_ALREADY_REGISTERED } };
  return { ok: true, value: createUser(input) };
}
function explainRegistrationFailure(failure: RegistrationFailure): string {
  switch (failure.code) {
    case RegistrationFailureCode.REQUIRED_FIELD: return `${failure.field} is required`;
    case RegistrationFailureCode.EMAIL_ALREADY_REGISTERED: return "Email is already registered";
    case RegistrationFailureCode.AGE_RESTRICTION: return `Minimum age is ${failure.minimumAge}`;
    default: return assertNever(failure);
  }
}
```

Returning a `Result` does not mean the whole workflow must continue. The caller may render the failure or retry, while a boundary may map `Err` to an HTTP/RPC error and return immediately, or throw a framework error. Make this choice visible in the function contract; do not mix business `Result` failures with undocumented arbitrary throws in the same contract.

`Result` is appropriate when:

- The failure is an expected branch and the caller may recover, retry, or choose different UI.
- Multiple validation reasons must be distinguished.
- The function signature should declare its success and failure channels.

## 4. Representing abort-and-propagate failures with typed throws

Typed throws are natural when the current operation must abort and propagate to an upper caller or centralized handler. Typical cases are infrastructure/external failures, a centralized framework handler, and invariant/programmer errors.

```ts
enum InfrastructureFailureCode {
  DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE",
  PAYMENT_PROVIDER_TIMEOUT = "PAYMENT_PROVIDER_TIMEOUT",
}
interface InfrastructureDetails { operation: string; retryable: boolean }
class InfrastructureError extends Error {
  readonly code: InfrastructureFailureCode;
  readonly details: Readonly<InfrastructureDetails>;
  constructor(code: InfrastructureFailureCode, details: InfrastructureDetails, options: { cause?: unknown } = {}) {
    super("Infrastructure operation failed", options);
    this.name = "InfrastructureError";
    this.code = code;
    this.details = details;
  }
}
class InvariantViolation extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "InvariantViolation"; }
}
interface Account { id: string }
declare const accountRepository: { load(accountId: string): Account };
function loadAccount(accountId: string): Account {
  try { return accountRepository.load(accountId); }
  catch (cause) {
    throw new InfrastructureError(InfrastructureFailureCode.DATABASE_UNAVAILABLE, { operation: "loadAccount", retryable: true }, { cause });
  }
}
```

An error class should carry a stable `code`, safe `details` needed for logging or retry decisions, and the native `cause` that preserves the underlying failure. Do not put full input, tokens, payment data, PII, or secrets into `message`, `details`, or `cause`; use `cause` only for internal logs and tracing.

Distinguish a public business error such as `BusinessRuleError` from an internal error such as `InvariantViolation`. The former may be converted to a stable business code. The latter is a bug signal: relabeling it as a user-input error hides a defect as a normal business branch.

## 5. Mapping once at the transport boundary

The domain and application layers must not import HTTP status values or tRPC/Nest/Express types. They know `Result` and domain errors; the transport adapter maps them once into the public contract.

```ts
type HttpResponse =
  | { status: 201; body: { userId: string } }
  | { status: 400 | 409 | 422; body: { code: RegistrationFailureCode; message: string } };
function mapRegistrationFailure(failure: RegistrationFailure): HttpResponse {
  switch (failure.code) {
    case RegistrationFailureCode.REQUIRED_FIELD:
      return { status: 400, body: { code: failure.code, message: "A required field is missing" } };
    case RegistrationFailureCode.EMAIL_ALREADY_REGISTERED:
      return { status: 409, body: { code: failure.code, message: "Email is already registered" } };
    case RegistrationFailureCode.AGE_RESTRICTION:
      return { status: 422, body: { code: failure.code, message: "Age requirement is not met" } };
    default: return assertNever(failure);
  }
}
function handleRegistration(input: RegistrationInput): HttpResponse {
  const result = register(input);
  if (result.ok) return { status: 201, body: { userId: result.value.id } };
  return mapRegistrationFailure(result.error);
}
```

Express error middleware, Nest exception filters, and tRPC error formatting/mapping are mainstream examples of this boundary, not a universal TypeScript standard. If another transport is added, each adapter should map the same domain error once.

## 6. Error contracts for async workers and queues

Across process, language, or deployment-version boundaries, do not serialize an `Error` instance or rely on class identity. Prototypes, stacks, and `cause` chains are not stable message contracts; send plain data with a stable code instead.

```ts
enum JobFailureCode {
  INFRASTRUCTURE_FAILURE = "INFRASTRUCTURE_FAILURE",
  UNKNOWN_FAILURE = "UNKNOWN_FAILURE",
}
interface SerializedJobFailure {
  code: JobFailureCode;
  retryable: boolean;
  idempotencyKey: string;
  publicMessage: string;
  details: Readonly<Record<string, string | number | boolean>>;
}
function toJobFailure(error: unknown, idempotencyKey: string): SerializedJobFailure {
  if (error instanceof InfrastructureError) return {
    code: JobFailureCode.INFRASTRUCTURE_FAILURE,
    retryable: error.details.retryable,
    idempotencyKey,
    publicMessage: "Temporary processing failure",
    details: { operation: error.details.operation },
  };
  return { code: JobFailureCode.UNKNOWN_FAILURE, retryable: false, idempotencyKey, publicMessage: "Processing failed", details: {} };
}
```

The message should carry a stable failure code, retryability, idempotency, a safe public message, and limited structured payload. A consumer should consider retryability and handler idempotency together. Treat an unknown error as a conservative fallback: do not expose its raw message, route it to an alert/dead-letter flow, and keep its stack and `cause` in server logs under a correlation ID.

## 7. Comparing the options

| Option | Strength | Caution |
| --- | --- | --- |
| Native discriminated union | Explicit contracts and exhaustive checking without a dependency | Write composition and async helpers yourself |
| `neverthrow` | Adds `Result` composition, `ResultAsync`, and a fluent API | Adopt its API and team style broadly |
| `fp-ts` `Either`/`TaskEither` | Functional combinators and typed async flows | Abstraction and learning cost |
| `Effect` | Handles typed errors, resources, concurrency, and runtime together | An architecture/runtime choice, not a small utility |
| `ts-pattern` | Helps with union matching and exhaustive checks | A matching tool, not an error channel |

For a small codebase, native unions and `assertNever` are enough. Consider `neverthrow`/`fp-ts` when `Result` composition is repeated. Consider `Effect` when its execution model, resource handling, and concurrency model are adopted together; it changes function signatures and runtime boundaries, so it is an architectural decision.

## 8. Recommended policy and test checklist

Keep the policy short:

1. Classify failures as business rejection, application flow, infrastructure/external failure, or invariant error.
2. Use `Result<T, E>` for expected/recoverable branches; use stable-code typed `Error` for infrastructure/invariant failures that must abort and propagate.
3. Keep codes in enums, details safe and structured, and native `cause` for internal tracing.
4. Keep transport types out of domain code and map public errors once in the adapter.
5. Send validated plain data across queues, including retryability and idempotency.

Test these points:

- Exhaustive union checks and boundary mapping for every public code
- No PII, secrets, or raw `cause` leakage; searchable cause chain and correlation-ID logging
- Unknown-error fallback, retry/backoff behavior, and idempotency
- Both `Result` branches and typed-throw type, code, and boundary response

## 9. Anti-patterns

- Throwing raw `new Error("...")` throughout the codebase for business outcomes.
- Treating the `message` string as a stable code.
- Having domain code directly reference HTTP status or Express/Nest/tRPC types.
- Mixing `Result` business failures with uncategorized throws in one contract.
- Catching an error, logging it, and then ignoring it without returning or rethrowing.
- Forcing invariant failures into user-input errors or normal business exceptions.

## References

- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing)
- [TypeScript for the New Programmer](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch)
- [Kotlin: Sealed classes and interfaces](https://kotlinlang.org/docs/sealed-classes.html)
- [Express 5: Error handling](https://expressjs.com/en/5x/guide/error-handling.html)
- [NestJS: Exception filters](https://docs.nestjs.com/exception-filters)
- [tRPC: Error handling](https://trpc.io/docs/server/error-handling)
- [neverthrow](https://github.com/supermacro/neverthrow)
- [fp-ts: Either](https://gcanti.github.io/fp-ts/modules/Either.ts.html)
- [fp-ts: TaskEither](https://gcanti.github.io/fp-ts/modules/TaskEither.ts.html)
- [Effect](https://www.effect.website/)
- [ts-pattern](https://github.com/gvergnaud/ts-pattern)
- [MDN: Error.prototype.cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
