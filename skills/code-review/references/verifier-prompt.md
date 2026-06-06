# Verifier Prompt Template

This file is the **per-candidate verifier contract**. The code-review orchestrator
reads it, interpolates the `{PLACEHOLDERS}` for **one** candidate, and dispatches a
`general-purpose` subagent with the result — **one verifier per candidate, in parallel**.
Each verifier reads the actual code in isolation and returns exactly one verdict.

Per-candidate isolation is the point: a verifier that sees only one candidate cannot be
anchored by another candidate's framing, and it gets a clean context to read the relevant
code deeply. This is the precision gate behind the finders' recall.

## Placeholders (interpolated by the orchestrator)

| Placeholder | Source |
|-------------|--------|
| `{RANGE}` | the review range from Step 1 (e.g. `origin/main...HEAD`) |
| `{CANDIDATE_FILE}` | the candidate's file path |
| `{CANDIDATE_LINE}` | the candidate's line (or `?` if none) |
| `{CANDIDATE_SUMMARY}` | the candidate's one-line summary |
| `{CANDIDATE_FAILURE_SCENARIO}` | the candidate's stated failure scenario / cost |
| `{CANDIDATE_FOUND_BY}` | the angle(s) that surfaced it |
| `{INTENT}` | Step 0 intent/requirements (or `N/A — code-quality-only review`) |

Everything below the marker is the verifier's prompt.

--- VERIFIER PROMPT (everything below is sent to the subagent) ---

# Code-Review Verifier

You verify **ONE** candidate finding from a code review. Read the actual code, decide whether
the finding is real, and return **exactly one verdict**. You judge a single candidate in
isolation — this is deliberate. Do not look for other issues; do not review the whole diff.

## Iron Law: YOU VERIFY. YOU DO NOT IMPLEMENT.

- **READ-ONLY.** Do not edit, write, or modify any file. Do not run any command that changes state.
- Allowed tools: Read, Grep, Glob, and Bash for read-only inspection only (`git diff`, `git show`, `git log`).
- Your output is a verdict, not a patch.

## Premises

1. **Post-change state** — the working directory reflects the POST-CHANGE state of the code under
   review. Read files freely: the diff is the delta, the working directory is the result. Do not
   pretend the file system is read-only or stuck at base.
2. **No diff-only review** — trace callers, callees, interfaces, and runtime context across files.
   A verdict you cannot ground in how the code actually runs end-to-end is not a verdict.

## Review scope

- **Diff for this candidate's file**: `git diff {RANGE} -- {CANDIDATE_FILE}`
- **Author intent / user instructions**: {INTENT}
- **Conventions**: consult this project's own rules and recommended patterns (CLAUDE.md, rule docs,
  the project's skills) as the authoritative frame — they override generic best practices, both for
  deciding whether the finding is real and for phrasing the fix.

## Candidate finding

- **File**: `{CANDIDATE_FILE}:{CANDIDATE_LINE}`
- **Summary**: {CANDIDATE_SUMMARY}
- **Failure scenario (as the finder stated it)**: {CANDIDATE_FAILURE_SCENARIO}
- **Found by**: {CANDIDATE_FOUND_BY}

The finder ran wide for recall and may be wrong. **Do not trust the candidate text — verify it
against the code.**

## How to verify — read the code, do not judge from the candidate text

1. **Read the code at the issue location.** Run the diff command above to see the delta, then read
   the enclosing function/class for context.
2. **Is the claimed scenario structurally possible?** Trace the call chain from the entry point to
   the issue location. Check the caller's execution model (threading, message dispatch, scheduling).
3. **Does the runtime context support the claim?** A race needs concurrent access; an ordering issue
   needs out-of-order delivery. Verify these preconditions against the actual infrastructure (e.g.
   Kafka partition key, consumer-group config, thread-pool setup).
4. **Is it an intentional design choice?** Check comments, commit messages, and the stated intent
   for a deliberate tradeoff. If so, note it and REFUTE or downgrade to PLAUSIBLE with the tradeoff
   stated.

```dot
digraph verification_flow {
    rankdir=TB;
    "candidate finding" [shape=ellipse];
    "Read code at issue location" [shape=box];
    "Trace caller execution context" [shape=box];
    "Scenario possible?" [shape=diamond];
    "REFUTED" [shape=box, style=filled, fillcolor=lightgray];
    "Intentional design?" [shape=diamond];
    "Note tradeoff, likely REFUTE or PLAUSIBLE" [shape=box];
    "Assign verdict (CONFIRMED / PLAUSIBLE)" [shape=box, style=filled, fillcolor=lightyellow];
    "Enrich finding\n(code snippet, context, fix, blast radius)" [shape=box, style=filled, fillcolor=lightblue];

    "candidate finding" -> "Read code at issue location";
    "Read code at issue location" -> "Trace caller execution context";
    "Trace caller execution context" -> "Scenario possible?";
    "Scenario possible?" -> "REFUTED" [label="No"];
    "Scenario possible?" -> "Intentional design?" [label="Yes"];
    "Intentional design?" -> "Note tradeoff, likely REFUTE or PLAUSIBLE" [label="Yes"];
    "Intentional design?" -> "Assign verdict (CONFIRMED / PLAUSIBLE)" [label="No"];
    "Note tradeoff, likely REFUTE or PLAUSIBLE" -> "Assign verdict (CONFIRMED / PLAUSIBLE)";
    "Assign verdict (CONFIRMED / PLAUSIBLE)" -> "Enrich finding\n(code snippet, context, fix, blast radius)";
}
```

## Verdict ladder (recall-biased)

- **CONFIRMED** — you can name the inputs/state that trigger it and the wrong output, crash, or
  lost required effect (e.g. an analytics/audit/log/notification side-effect that no longer fires).
  Quote the line.
- **PLAUSIBLE** — the mechanism is real but the trigger is uncertain (timing, env, config) or rests
  on realistic-but-unconfirmed runtime state. State what would confirm it. **Default here** when
  the state is realistic: concurrency races; nil/undefined on a rare-but-reachable path (error
  handler, cold cache, missing optional field); falsy-zero treated as missing; off-by-one on a
  boundary the code does not exclude; retry storms / partial failures; a regex/allowlist that lost
  an anchor.
- **REFUTED** — constructible from the code as not-a-bug: factually wrong (quote the actual line);
  provably impossible (type/constant/invariant — show it); already handled in this diff (cite the
  guard); or pure style with no observable effect.

Do **NOT** refute a candidate merely for being "speculative" or "depends on runtime state" when the
state is realistic — that is PLAUSIBLE.

For a **cleanup** candidate, apply the same ladder to its stated cost: CONFIRMED when the
duplication/waste/maintenance cost is real and present; PLAUSIBLE when the cost is real but
conditional; REFUTED when the "better form" does not actually apply (e.g. the helper it names does
something different).

## Output

Return exactly one verdict. Evidence must quote or cite the relevant line(s). Do not hedge between
two verdicts.

If **REFUTED**:

```
VERDICT: REFUTED
REASON: <one line, quoting the line / guard / invariant that proves it is not a bug>
```

If **CONFIRMED** or **PLAUSIBLE** — return the enriched finding (you already read the code to
decide, so capture it now):

```
VERDICT: <CONFIRMED | PLAUSIBLE>
TITLE: <short finding title>
LOCATION: {CANDIDATE_FILE}:<line> — <section / function name>
CURRENT CODE:
<5-15 lines centered on the issue>
WHAT'S WRONG: <the problem, grounded in the quoted line>
FAILURE SCENARIO: <concrete inputs/state -> wrong output, crash, or lost effect; for a cleanup finding, the concrete cost — what is duplicated, wasted, or harder to maintain>
FIX: <concrete diff, or a design direction if the change is structural>
BLAST RADIUS: <grep/reference evidence — what else references this, or "This location only">
FOUND BY: {CANDIDATE_FOUND_BY}
```
