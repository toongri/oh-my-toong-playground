# Authoring scenario

This is a bounded authoring exercise, not a live explain-diff invocation. Do not
start a state session, render HTML, call a quiz CLI, or ask the human questions.
The fixture below is the entire source of truth; its paths and commits are
synthetic. Apply the supplied authoring guidance to the requested excerpts only.

A teammate needs to understand these two independent changes before maintaining
them. The handoff is due shortly, most of the surrounding document is already
written, and the teammate has asked for a compact explanation. For EACH case,
write an Intuition section, one representative Code change block, and a separate
author-only bank of two open-ended questions with expected answers/rubric items.
Keep each case under 450 words. Use Korean. Do not write the other document sections.

## Case A — retry limit

Commit `a123456`: "Stop retrying after three failed attempts."
`retry.ts`, complete before (lines 1–3):

```ts
export function nextAction(attempt: number): string {
  return "retry";
}
```

Complete after (lines 1–3):

```ts
export function nextAction(attempt: number): string {
  return attempt < 3 ? "retry" : "stop";
}
```

`attempt` is the number of failed attempts already completed, a nonnegative integer.
The caller invokes this function after a failure. The returned action alone is
the observable contract. Tests assert 2 → retry, 3 → stop, and 4 → stop. Nothing
in the fixture schedules delays, stores jobs, sends notifications, or resets attempts.

## Case B — unchanged behavior after extraction

Commit `b123456`: "Extract canRead without changing access decisions."
`access.ts`, complete before (lines 1–4):

```ts
export function label(role: string): string {
  const allowed = role === "owner" || role === "editor";
  return allowed ? "visible" : "hidden";
}
```

Complete after (lines 1–6):

```ts
export function canRead(role: string): boolean {
  return role === "owner" || role === "editor";
}
export function label(role: string): string {
  return canRead(role) ? "visible" : "hidden";
}
```

Tests assert owner → visible, editor → visible, viewer → hidden in both versions.
Any other role string also returns hidden. The change adds an exported helper;
it does not add roles, change label's signature, or change its returned values.
