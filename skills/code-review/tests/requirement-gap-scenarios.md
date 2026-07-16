# code-review — Requirement-Gap (Absent-Change) Verification-Point Scenarios

> Records the verification points for the `code-review` skill's absent-change capability
> (grounded sin-of-omission: flagging a required-but-unwritten change — present analogs,
> absent wiring — as a `requirement-gap` finding). This is a **written checklist**, walked
> by dispatching the real `code-reviewer` subagent (`subagent_type: "code-reviewer"`,
> `agents/code-reviewer.md`) against the fixtures below — there is no runner and no
> assertion code here. Follows the Given/Then + `Vn` convention of
> `skills/orchestrate-review/tests/conductor-scenarios.md`.

---

## Fixture-Isolation Precondition (read first)

Both fixtures under `skills/code-review/tests/fixtures/{omission,clean}/` ship an identical
`requirements.txt`:

```
A new handler module handlers/health.ts is added.
handlers/health.ts exports a function named health.
The health function returns an object literal of the shape { status: number; body: string }.
```

None of the three lines names registration or wiring, and all three are already satisfied by
the diff in every scenario below. Consequently, **each fixture's written `requirements.txt` yields zero
`requirement-gap` findings on its own** — no scenario's `requirement-gap` count can come from
the caller-supplied text itself. Because of this isolation, the **total** `requirement-gap`
count observed in a dispatch equals the **derivation-origin** count (findings produced by the
skill's own codebase-analog derivation). "Derivation-origin" is not itself a machine-observable
attribute — the design deliberately adds no new finding class or field to distinguish a
derived `requirement-gap` from a written-requirement one — so this isolation is the only way
any of the counts below are executable/checkable at all.

---

## How to Run

Each verification point below is walked the same way:

1. **Realize the fixture as a throwaway git repo**, per the fixture's own `README.md` recipe
   (`skills/code-review/tests/fixtures/{omission,clean}/README.md`):
   ```bash
   cd before && git init -q && git add -A && git commit -q -m before
   cp -R ../change/. .
   git add -A
   git diff --cached   # this is the diff under review
   ```
   For dispatch, commit the staged change too (e.g. `git commit -q -m change`, or on a
   `fixture-change` branch cut from the `before` commit) so an **explicit baseline→change
   range** is available to pass to the reviewer, rather than relying on an uncommitted staged
   diff — this matches `code-review/SKILL.md`'s Step 1 ("Input Parsing") branch-comparison
   input mode, `<base> <target>`.

2. **Dispatch `code-reviewer`** (`subagent_type: "code-reviewer"`, per `agents/code-reviewer.md`)
   with:
   - **cwd** = the realized fixture repo
   - **range** = the explicit baseline→change range from step 1
   - **intent** = the fixture's `requirements.txt` content, passed as **caller-supplied
     confirmed intent** (`agents/code-reviewer.md`'s Input: "plus any intent/requirements
     context provided by the caller") — this lands `SKILL.md`'s Step 0 ("Intent and Context
     Acquisition") Intent Block Gate directly on "Intent confirmed," skipping interview
   - **exception — CD-4 (hybrid-field)**: instead of passing `requirements.txt` as intent,
     dispatch with an explicit **code-quality-only deferral** (e.g. "code quality only,
     skip intent") so Step 0 itself lands on the "User explicit deferral" branch and sets
     the `{REQUIREMENTS}` sentinel

3. **Capture the findings text** the subagent returns from `SKILL.md` Step 6
   ("Verification + Synthesis"), Phase 3 ("Findings Synthesis"), and count findings classed
   `requirement-gap` (class 2 of 3: correctness / cleanup / requirement-gap).

Which skill state is under test (pre-edit HEAD vs. post-Step-0-edit) must be **synced to the
deployed skill location** before dispatch — the subagent runs the deployed copy, not the repo
source directly.

---

## Scenarios (CD-*)

### CD-1 — RED: unedited skill, omission fixture

**Given**: `skills/code-review/SKILL.md` at its **pre-edit HEAD** state (no absent-change
derivation sub-step yet), synced to the deployed skill location; the `omission` fixture
(`skills/code-review/tests/fixtures/omission/`) realized per the recipe above — 3 registered
handlers (`ping`/`echo`/`time`) in `before/`, a 4th handler `handlers/health.ts` added in
`change/` without a matching entry added to `registry.ts` (`registry.ts` is byte-identical
between `before/` and `change/` — still only `ping`, `echo`, `time`); dispatched to
`code-reviewer` with the fixture's `requirements.txt` as caller-supplied confirmed intent.

**Then**:

| ID | Expected Behavior |
|----|-------------------|
| V1 | Dispatching `code-reviewer` yields **0** `requirement-gap` findings — the unedited skill has no mechanism to generalize the 3-instance registration pattern against the diff, so the missing `health` entry in `registry.ts` goes unflagged |

**Dispatch**: `code-reviewer` / omission fixture / pre-edit HEAD / requirements.txt as intent
**Expected `requirement-gap` count**: **0**

---

### CD-2 — GREEN: edited skill, omission fixture

**Given**: `skills/code-review/SKILL.md` **post-Step-0-edit** (the absent-change derivation
sub-step landed), synced to the deployed skill location; the same `omission` fixture, realized
and dispatched identically to CD-1 (fixture's `requirements.txt` as caller-supplied confirmed
intent).

**Then**:

| ID | Expected Behavior |
|----|-------------------|
| V1 | Dispatching `code-reviewer` yields **exactly 1** `requirement-gap` finding |
| V2 | The finding names the absent change — the missing `registry.ts` entry that would wire the new `health` handler into dispatch (generalized from the `ping`/`echo`/`time` analog pattern at `registry.ts:7-11`) |
| V3 | The finding cites a `file:line` location (e.g. `registry.ts:7-11` for the analog pattern, and/or `handlers/health.ts:1` for the ungrounded handler) |
| V4 | The finding carries a **CONFIRMED** or **PLAUSIBLE** verdict (the verdict ladder from `SKILL.md` Step 6's Phase 2, "Candidate Verification") — not REFUTED, not unlabeled |

**Dispatch**: `code-reviewer` / omission fixture / post-edit / requirements.txt as intent
**Expected `requirement-gap` count**: **1**

---

### CD-3 — False-positive guard: edited skill, clean fixture

**Given**: the same **post-Step-0-edit** skill as CD-2, synced to deployed; the `clean` fixture
(`skills/code-review/tests/fixtures/clean/`) realized per the recipe above — the same 3
registered handlers, plus the 4th `health` handler added **with** its matching `registry.ts`
entry (the pairing is complete, no citable absence); dispatched with the fixture's
`requirements.txt` as caller-supplied confirmed intent.

**Then**:

| ID | Expected Behavior |
|----|-------------------|
| V1 | Dispatching `code-reviewer` yields **0** `requirement-gap` findings |
| V2 | No phantom absent-change finding is invented — the derivation step finds no analog whose implied wiring is missing, because none is missing |

**Dispatch**: `code-reviewer` / clean fixture / post-edit / requirements.txt as intent
**Expected `requirement-gap` count**: **0**

---

### CD-4 — Hybrid-field: edited skill, omission fixture, code-quality-only deferral mode

**Given**: the same **post-Step-0-edit** skill as CD-2/CD-3, synced to deployed; the same
`omission` fixture as CD-1/CD-2, realized identically — but dispatched with an explicit
**code-quality-only deferral** as the intent (e.g. "code quality only," "skip," or an
unambiguous equivalent per `SKILL.md`'s Intent Block Gate) **instead of** the
`requirements.txt` content, so Step 0 itself sets the `{REQUIREMENTS}` sentinel
(`"N/A — code-quality-only review (user deferred)"`) via its own "User explicit deferral"
branch — the derivation runs unconditionally, regardless of how intent was reached.

**Then**:

| ID | Expected Behavior |
|----|-------------------|
| V1 | The absent-change derivation step's "Derived Expected Items" sub-block **replaces** the sentinel — no self-contradictory "N/A + Derived Items" field reaches the coverage checker |
| V2 | `orchestrate-review/scripts/prompts/coverage.md` maps the derived item exactly as it would any other `{REQUIREMENTS}` entry (no special-case coverage path for a derived item) |
| V3 | Dispatching `code-reviewer` yields **exactly 1** `requirement-gap` finding — the same absent `registry.ts` entry for `health` as CD-2 |

**Dispatch**: `code-reviewer` / omission fixture / post-edit / explicit code-quality-only deferral (no requirements.txt passed as intent)
**Expected `requirement-gap` count**: **1**

---

## Summary

| Point | Skill state | Fixture | Intent mode | Expected `requirement-gap` |
|-------|------------|---------|--------------|------------------------------|
| CD-1 (RED) | pre-edit HEAD | omission | requirements.txt as caller intent | 0 |
| CD-2 (GREEN) | post-Step-0-edit | omission | requirements.txt as caller intent | 1 (cited, verdict-carrying) |
| CD-3 (false-positive) | post-Step-0-edit | clean | requirements.txt as caller intent | 0 |
| CD-4 (hybrid-field) | post-Step-0-edit | omission | explicit code-quality-only deferral | 1 |

Downstream stories walk this file as their assertion checklist: CD-1 is captured before the Step
0 edit lands; CD-2, CD-3, CD-4 are captured after.
