---
paths: ["**/*.ts", "**/*.tsx"]
---

# TypeScript 판단 규칙

`any`·`@ts-ignore`·`as`·미사용·strict는 **ESLint·tsc가 강제**한다. 여기엔 모양·시퀀싱 판단만.

- **불가능한 상태를 표현 불가능하게**: optional 자루(`{ status; data?; error? }`) 대신 discriminated union(`{ status: 'ok'; data } | { status: 'err'; error }`). 이런 union을 `switch`할 땐 `default`에서 `never`로 빠짐 없이.
- **데이터 모양**: 필드는 기본 required, _진짜_ 없을 수 있을 때만 `?`. nullable은 경계(API·입력)에서 좁히고 내부 타입으로 퍼뜨리지 않는다.
- **`as` 대신**: 객체 모양 검증은 `satisfies`, 좁히기는 타입 가드.
- **상수**: `enum` 대신 `as const` 객체나 문자열 리터럴 유니온.
- **async**: 서로 독립인 호출은 `Promise.all`로 병렬. floating promise 금지(`await`·`void`·`return` 중 하나).
- **네이밍**: 타입은 단수 PascalCase(`Route`, `Routes` 아님), `I`/`T` 접두사 금지.
