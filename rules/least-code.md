# Least-Code Ladder

The best code is the code you never write. Lazy means efficient, not careless: aim for the shortest solution that actually works, and only that. You have seen over-engineered systems and been paged for them at 3am — the clever layer nobody needed is the one that wakes you.

## The ladder

Before writing code, climb this ladder and stop at the first rung that holds:

1. **Does this need to exist at all?** Speculative need — skip it, say so in one line. (YAGNI)
2. **Already in this codebase?** A helper, util, type, or pattern that already lives here — reuse it. Re-implementing what sits a few files over is the most common slop; look before you write.
3. **Standard library does it?** Use it.
4. **Native platform feature covers it?** Prefer the platform builtin over a dependency — a DB constraint over app code, a framework primitive over a hand-rolled one, a language or runtime feature over a library.
5. **Already-installed dependency solves it?** Use it. Never add a new dependency for what a few lines do.
6. **Can it be one line?** Make it one line.
7. **Only then:** write the minimum code that works.

Two rungs hold? Take the higher one and move on. The ladder is a reflex, not a research project.

## Understand before you climb

The ladder shortens the solution, never the reading. It runs *after* you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb. A small diff in the wrong place isn't lazy — it's a second bug. Laziness that skips comprehension to ship a small diff is the dangerous kind: it dresses up as efficiency and ships a confident wrong fix.

**Bug fix = root cause, not symptom.** A report names a symptom. Before editing, find every caller of the function you are about to touch and fix the shared function once — one guard there is a smaller diff than one guard per caller, and patching only the path the ticket names leaves sibling callers broken.

## What "simple" rules out

- No abstractions that weren't asked for: no interface with one implementation, no factory for one product, no config for a value that never changes.
- No flexibility or configurability for unproven scenarios. Speculative defensiveness — fallbacks, layers, options for cases that don't exist yet — is forbidden unless tied to a concrete current trigger.
- No error handling for impossible states.
- No boilerplate or scaffolding "for later" — later can scaffold for itself.
- Deletion over addition. When uncertain between adding defensive logic and removing it, remove: default to deleting speculative additions, not code with verified callers.
- The simpler form wins: between two approaches with the same outcome, take the one with fewer lines, fewer abstractions, fewer code paths. If you wrote 200 lines and it could be 50, rewrite it. Ask: "Would a senior engineer call this overcomplicated?" If yes, simplify.

## What is never simplified away

These are not bloat — keep them even as the rest shrinks: input validation at trust boundaries, error handling that prevents data loss, security, accessibility, and anything the user explicitly asked for. Between two same-size options, pick the one correct on edge cases — lazy means writing less code, not picking the flimsier algorithm. Non-trivial logic (a branch, a loop, a parser, a money or security path) leaves ONE runnable check behind: the smallest thing that fails if the logic breaks — an assert-based self-check or one small test. No frameworks, no fixtures unless asked. A bug fix always leaves this check, however small. Only a one-liner that changes no logic — a rename, a config value, a passthrough — skips it.

## Output and traceability

Code first, then at most a few lines: what you skipped, when to add it (`skipped: X, add when Y`). If the explanation runs longer than the code, delete the explanation — a paragraph defending a simplification is complexity smuggled back in as prose. Explanation the user explicitly asked for (a report, a walkthrough) is not debt; give it in full. Mark a deliberate shortcut with a `lazy:` comment that names its ceiling and the upgrade path — `// lazy: global lock; per-account locks if throughput matters`. A shortcut with no named trigger silently rots.
