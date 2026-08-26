# TypeScript 오류 처리 가이드

결론부터 말하면 TypeScript 커뮤니티에는 단일 오류 처리 표준이 없다. 주류 Node/TypeScript는 typed `Error`/커스텀 오류를 throw하고 Express·Nest·tRPC 같은 경계 핸들러에서 응답으로 매핑한다. FP 지향 TypeScript는 `Result`/`Either`/`Effect`를 실패 채널로 사용한다. 권장안은 의미에 따른 하이브리드다. 호출자가 예상하고 복구할 수 있는 업무 결과는 `Result<T, E>`로 반환하고, 중단·전파해야 하는 인프라 실패나 불변식 위반은 안정적인 code를 가진 typed error로 throw한다.

## 1. Kotlin sealed class와 TypeScript

Kotlin `sealed class`에 가장 가까운 기본 TypeScript 모델은 `enum` discriminant + discriminated union + `never` exhaustive switch다.

```ts
enum FailureCode { REQUIRED_FIELD = "REQUIRED_FIELD", INVALID_EMAIL = "INVALID_EMAIL" }
type Failure =
  | { code: FailureCode.REQUIRED_FIELD; field: string }
  | { code: FailureCode.INVALID_EMAIL; normalizedValue: string };

function assertNever(value: never): never {
  throw new Error(`Unhandled failure: ${String(value)}`);
}
function describe(failure: Failure): string {
  switch (failure.code) {
    case FailureCode.REQUIRED_FIELD: return `${failure.field} is required`;
    case FailureCode.INVALID_EMAIL: return `Invalid email: ${failure.normalizedValue}`;
    default: return assertNever(failure);
  }
}
```

새 변형을 추가하고 `switch`를 갱신하지 않으면 `assertNever`에서 컴파일 오류가 난다. 단, TypeScript 타입은 런타임에 지워진다. 외부 JSON·메시지·HTTP 입력을 타입으로 선언하는 것만으로는 안전하지 않으므로 경계에서 Zod 같은 런타임 validator로 검증한다. `z.discriminatedUnion("code", [...])` 같은 스키마를 파싱한 뒤에만 내부 타입으로 넘긴다.

참고: [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing), [TypeScript from scratch](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch), [Kotlin sealed classes](https://kotlinlang.org/docs/sealed-classes.html)

## 2. 먼저 실패의 의미를 분류한다

| 분류 | 예 | 기본 선택 |
| --- | --- | --- |
| 예상 가능한 업무/도메인 거절 | 잔액 부족, 중복 주문, 입력 규칙 위반 | `Result` 또는 함수 계약에 따른 typed throw |
| 애플리케이션/워크플로 실패 | 정책, 취소, deadline 때문에 조율 작업을 완료하지 못함 | 호출자 계약에 따른 `Result` 또는 typed throw |
| 인프라/외부 실패 | DB, HTTP API, 결제사, 파일 시스템, 큐 장애 | `cause`를 보존한 typed throw |
| 불변식/프로그래머 오류 | 도달하면 안 되는 상태, 버그, 잘못된 내부 사용 | 즉시 throw하고 관찰 |

업무 실패는 자동으로 예외도, 자동으로 `Result`도 아니다. 같은 `INSUFFICIENT_BALANCE`라도 다음 행동을 선택해야 하는 함수라면 데이터로 반환하고, 현재 작업을 중단하는 계약이라면 throw할 수 있다. 함수 계약과 복구 가능성으로 결정한다.

TypeScript에는 checked exception이 없고 `Promise<T>` 같은 반환 타입도 throw 가능성을 표현하지 않는다. 따라서 throw 계약은 Error 클래스, 팀 규칙, 문서, 테스트로 관리해야 한다. 반면 `Result`는 실패 채널을 함수 시그니처에 드러낸다.

선택 기준은 간단하다.

| 질문 | 선택 |
| --- | --- |
| 호출자가 예상 가능한 실패를 분기·복구·재시도해야 하는가? | `Result` |
| 현재 작업을 중단하고 상위 핸들러로 전파해야 하는가? | typed throw |
| 불변식 위반이나 프로그래머 버그인가? | 별도 invariant Error throw |

## 3. 예상 가능한 분기는 `Result<T, E>`로 표현한다

```ts
enum RegistrationFailureCode {
  REQUIRED_FIELD = "REQUIRED_FIELD",
  EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED",
  AGE_RESTRICTION = "AGE_RESTRICTION",
}
enum RegistrationField { EMAIL = "EMAIL", AGE = "AGE" }
type RegistrationFailure =
  | { code: RegistrationFailureCode.REQUIRED_FIELD; field: RegistrationField }
  | { code: RegistrationFailureCode.EMAIL_ALREADY_REGISTERED; safeEmail: string }
  | { code: RegistrationFailureCode.AGE_RESTRICTION; minimumAge: number };
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
type User = { id: string; email: string };
declare function emailAlreadyRegistered(email: string): boolean;
declare function createUser(email: string, age: number): User;

function register(email: string, age: number): Promise<Result<User, RegistrationFailure>> {
  if (email.length === 0) return Promise.resolve({ ok: false, error: { code: RegistrationFailureCode.REQUIRED_FIELD, field: RegistrationField.EMAIL } });
  if (age < 14) return Promise.resolve({ ok: false, error: { code: RegistrationFailureCode.AGE_RESTRICTION, minimumAge: 14 } });
  if (emailAlreadyRegistered(email)) return Promise.resolve({ ok: false, error: { code: RegistrationFailureCode.EMAIL_ALREADY_REGISTERED, safeEmail: "redacted" } });
  return Promise.resolve({ ok: true, value: createUser(email, age) });
}

function explain(failure: RegistrationFailure): string {
  switch (failure.code) {
    case RegistrationFailureCode.REQUIRED_FIELD: return `${failure.field} is required`;
    case RegistrationFailureCode.EMAIL_ALREADY_REGISTERED: return "Email is already registered";
    case RegistrationFailureCode.AGE_RESTRICTION: return `Minimum age is ${failure.minimumAge}`;
    default: return assertNever(failure);
  }
}
```

`Result`는 워크플로를 반드시 계속하라는 뜻이 아니다. 호출자는 렌더링·재시도를 선택하고, 경계는 실패를 transport 오류로 매핑해 즉시 반환하거나 framework 오류로 throw할 수 있다. 한 함수 계약 안에서 문서화되지 않은 임의 throw를 섞지 않는다.

`Result`가 특히 적합한 경우는 다음과 같다.

- 실패가 예상된 분기이고 호출자가 복구·재시도하거나 다른 UI를 선택할 수 있을 때
- 여러 validation 이유를 구분해 호출자에게 전달해야 할 때
- 함수 시그니처에 성공 채널과 실패 채널을 명시해야 할 때

## 4. typed throw가 맞는 경우

현재 작업을 중단해 상위 호출자나 중앙 핸들러로 전파해야 할 때 typed throw가 적합하다. 특히 인프라/외부 실패, 중앙화된 핸들러, 불변식/프로그래머 오류에 사용한다.

```ts
enum InfrastructureCode {
  DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE",
  PAYMENT_PROVIDER_TIMEOUT = "PAYMENT_PROVIDER_TIMEOUT",
}
class InfrastructureError extends Error {
  readonly code: InfrastructureCode;
  readonly details: Readonly<{ operation: string; retryable: boolean }>;
  constructor(code: InfrastructureCode, details: { operation: string; retryable: boolean }, options: ErrorOptions = {}) {
    super("Infrastructure operation failed", options);
    this.name = "InfrastructureError";
    this.code = code;
    this.details = details;
  }
}
class InvariantViolation extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "InvariantViolation"; }
}
```

오류에는 안정적인 `code`, 로그·재시도 판단에 필요한 안전한 `details`, 원인을 보존하는 native `cause`를 둔다. `Error`의 `cause`는 [MDN 문서](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)처럼 `{ cause }`로 감싼다. 입력 전문, 토큰, 결제 정보, PII, secret은 message·details에 넣지 않는다. `InvariantViolation`은 공개 업무 오류와 분리한다. 버그를 사용자 입력 오류로 포장하면 결함이 정상 분기로 숨겨진다.

## 5. transport 경계에서 한 번만 매핑한다

도메인·애플리케이션 코드에 HTTP status나 tRPC/Nest/Express 타입을 import하지 않는다. 내부의 `Result`/도메인 오류를 transport adapter가 외부 계약으로 한 번 매핑한다. Express의 error middleware, Nest의 exception filter, tRPC의 error formatting/handling은 이 경계 패턴의 예다. [Express error handling](https://expressjs.com/en/5x/guide/error-handling.html), [Nest exception filters](https://docs.nestjs.com/exception-filters), [tRPC error handling](https://trpc.io/docs/server/error-handling)

```ts
type Response =
  | { status: 201; body: { userId: string } }
  | { status: 400 | 409 | 422; body: { code: RegistrationFailureCode; message: string } };
function mapFailure(failure: RegistrationFailure): Response {
  switch (failure.code) {
    case RegistrationFailureCode.REQUIRED_FIELD: return { status: 400, body: { code: failure.code, message: "A required field is missing" } };
    case RegistrationFailureCode.EMAIL_ALREADY_REGISTERED: return { status: 409, body: { code: failure.code, message: "Email is already registered" } };
    case RegistrationFailureCode.AGE_RESTRICTION: return { status: 422, body: { code: failure.code, message: "Age requirement is not met" } };
    default: return assertNever(failure);
  }
}
```

## 6. worker/queue 오류 계약

프로세스 경계를 넘을 때 `Error` class identity에 의존하지 않는다. plain data, stable code, `retryable`, idempotency key, 안전한 message를 직렬화한다. consumer는 retryability와 handler의 idempotency를 함께 보고 재시도한다. 원문 message·stack·`cause`는 전송하지 말고 correlation ID로 내부 로그에 남긴다.

```ts
type QueueFailure = {
  code: QueueFailureCode;
  retryable: boolean;
  idempotencyKey: string;
  safeMessage: string;
};
enum QueueFailureCode {
  INFRASTRUCTURE_FAILURE = "INFRASTRUCTURE_FAILURE",
  UNKNOWN_FAILURE = "UNKNOWN_FAILURE",
}
function serializeFailure(error: unknown, idempotencyKey: string): QueueFailure {
  if (error instanceof InfrastructureError) {
    return { code: QueueFailureCode.INFRASTRUCTURE_FAILURE, retryable: error.details.retryable, idempotencyKey, safeMessage: "Temporary processing failure" };
  }
  return { code: QueueFailureCode.UNKNOWN_FAILURE, retryable: false, idempotencyKey, safeMessage: "Processing failed" };
}
```

unknown은 보수적인 fallback으로 alert/dead-letter에 보낸다. 재시도 가능한 작업은 중복 실행되어도 안전하도록 멱등성을 보장한다.

## 7. 선택지 비교

| 선택지 | 장점 | 주의점 |
| --- | --- | --- |
| Native union | 의존성 없이 명시적 계약·exhaustiveness | 조합/async helper를 직접 작성 |
| [neverthrow](https://github.com/supermacro/neverthrow) | `ResultAsync`와 fluent 조합 | 라이브러리 API를 팀 전체가 채택해야 함 |
| [fp-ts Either/TaskEither](https://gcanti.github.io/fp-ts/modules/Either.ts.html) / [TaskEither](https://gcanti.github.io/fp-ts/modules/TaskEither.ts.html) | 함수형 조합과 풍부한 추상화 | 학습 비용과 함수형 스타일 일관성 필요 |
| [Effect](https://www.effect.website/) | 오류·재시도·리소스·동시성까지 아우르는 런타임/아키텍처 | 작은 코드베이스에는 과한 선택일 수 있음 |
| [ts-pattern](https://github.com/gvergnaud/ts-pattern) | 패턴 매칭과 exhaustive 검사 | 추가 문법·의존성 |

작은 코드베이스에는 native union만으로 충분하다. `Effect`는 단순 오류 타입의 대안이라기보다 넓은 아키텍처 선택이다.

## 8. 권장 정책과 체크리스트

정책은 다음과 같다: 예상 가능한 업무 결과는 `Result`; 중단·전파할 인프라 실패는 stable-code typed throw; 불변식 위반은 별도 `InvariantViolation`; transport 매핑은 경계 한 곳; 외부 입력은 런타임 검증; 큐에는 plain data와 unknown fallback을 사용한다.

피할 anti-pattern: 모든 것을 `any`/문자열로 표현하기, 모든 업무 거절을 throw하기, 모든 예외를 `Result`로 삼키기, domain에 HTTP 타입을 넣기, Error class를 큐 payload로 보내기, PII·secret을 message에 넣기, 불변식 오류를 공개 business error로 바꾸기.

테스트 체크리스트:

- [ ] 모든 union `switch`가 `assertNever`로 exhaustive한가?
- [ ] 각 업무 code의 transport 매핑과 unknown fallback을 검증했는가?
- [ ] `cause`와 안전한 로그/correlation ID가 보존되는가?
- [ ] public message에 PII·secret이 새지 않는가?
- [ ] worker의 직렬화·재시도·dead-letter·unknown 경로가 있는가?
- [ ] 재시도 대상 작업이 멱등적인가?

## 9. 반패턴

- 업무 결과를 `new Error(...)`로만 반환해 호출자가 가능한 변형을 알 수 없게 하기
- 안정적인 `code` 대신 `message` 문자열을 분기 기준으로 사용하기
- domain 코드가 HTTP status나 transport 타입에 의존하기
- `Result`와 분류되지 않은 임의 throw를 한 함수 계약에 혼용하기
- `catch`한 오류를 기록·전파·변환하지 않고 무시하기
- 불변식 위반을 공개 업무 오류로 포장해 프로그래머 버그를 숨기기

## 참고 자료

- [TypeScript Handbook: Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing)
- [TypeScript: 새로운 프로그래머를 위한 안내](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch)
- [Kotlin: Sealed classes and interfaces](https://kotlinlang.org/docs/sealed-classes.html)
- [Express 5: 오류 처리](https://expressjs.com/en/5x/guide/error-handling.html)
- [NestJS: Exception filters](https://docs.nestjs.com/exception-filters)
- [tRPC: 오류 처리](https://trpc.io/docs/server/error-handling)
- [neverthrow](https://github.com/supermacro/neverthrow)
- [fp-ts: Either](https://gcanti.github.io/fp-ts/modules/Either.ts.html)
- [fp-ts: TaskEither](https://gcanti.github.io/fp-ts/modules/TaskEither.ts.html)
- [Effect](https://www.effect.website/)
- [ts-pattern](https://github.com/gvergnaud/ts-pattern)
- [MDN: Error.prototype.cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause)
