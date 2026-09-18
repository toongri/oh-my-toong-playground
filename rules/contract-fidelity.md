# Contract Fidelity

A name is a contract. A variable, field, parameter, config key, DB column,
enum member, or JSON/state key holds only values of the meaning its name and
declared contract state. Never store a value with a different meaning in it.
This is absolute — no size, deadline, or convenience exception.

## Store values explicitly

Always store and pass a value explicitly, under a name that states its
meaning. No implicit carriers:

- No sentinel or magic value that changes a field's meaning — an empty
  string, `0`, `-1`, a special prefix standing in for "not really this".
- No smuggling a second meaning into an existing field.
- No reusing a parameter position for a different concept.
- No deriving meaning from "which field happens to be filled".

## Migration and refactoring — the most common trigger

Backward compatibility is never a reason to put a differently-meaning value
into an existing variable or key. When the meaning changes, or a new meaning
appears, add a new, explicitly named field or key, migrate every reader and
writer to it, then remove the old one. The next section covers readers you
cannot migrate this way. If old and new must coexist for a period, each
keeps its own name and its own meaning; convert between them at one
explicit, named boundary (an adapter or mapping function), never by
overloading the old key.

When the contract itself must change, change it openly: rename it, retype
it, or version it, and update every reader and writer. Do not let the
meaning drift while the name stays the same.

- BAD: during a migration, writing the new `householdId` into the existing
  `userId` column so old readers keep working unchanged.
- BAD: filling `expiresAt` with the creation timestamp as a placeholder
  until a real expiry is computed.
- GOOD: add `householdId` alongside `userId`, dual-write each with its own
  meaning, migrate readers to `householdId`, then drop `userId`.

## When client updates are not guaranteed

Some clients cannot be forced to update (installed mobile apps, embedded or
IoT device firmware, third-party API consumers, already-persisted messages).
They keep sending and expecting the old contract indefinitely.

Keep the old contract alive with its original meaning. Accept and return
each field exactly as its contract defines it. Convert to and from the
current internal model at the one explicit, named boundary this file
already requires (an adapter or mapping function). The old contract's
meaning stays frozen. Only the internal model moves.

Never reinterpret an old field to carry the new meaning. Never make an old
client's field double as the new one. Never let the internal model leak
back out through an old field with a changed meaning. A new meaning reaches
clients only through a new, explicitly named field, or a new contract
version that updated clients opt into.

When the old contract cannot express something the new model needs, state
the default or derivation explicitly in the conversion function's code. Do
not hide it behind a sentinel.

- BAD: the server starts reading old clients' `userId` field as a household
  id, because "new clients send households now".
- GOOD: the v1 endpoint keeps accepting `userId` as a user id. A named
  mapping function resolves the household internally. v2 adds an explicit
  `householdId` field.

The test: a reader who sees only the name must be able to state what every
value stored there means, with no knowledge of the code's history.

If a requirement cannot be met without overloading a name this way, stop and
surface it to the user instead of writing the overload.
