# Diagnose Root Cause — Symptom-Report Diagnosis Sub-Pipeline

This file is the complete operational procedure for **Stage 3 when the intake is a symptom report or a
bug/regression/incident** — i.e., the cause is not yet established and the issue cannot be written
until it is. The spine (SKILL.md) defers here at that point. Read every section in order.

For a code-touching *feature* requirement (the cause-is-known case), the lighter Stage 3 in SKILL.md
(explore for facts, oracle for cross-module judgment) is sufficient — do not run this heavier
sub-pipeline. This file is for the case where **"what is the cause?" is the open question.**

---

## 0. Why this exists (the failure it prevents)

A symptom report tempts a fast, shallow answer: read a few files, find a plausible mechanism, write it
down. Three specific failures recur, and each is countered by a section below:

- **Prior-issue short-circuit** — a related issue already exists, so the diagnosis becomes
  *corroboration of a stated answer* instead of independent diagnosis. The stated cause is inherited,
  not verified. (Countered by §1.)
- **Code-reasoning without runtime proof** — the mechanism is inferred from reading code and never
  checked against what actually happened in production. A plausible mechanism that never fired is not
  the cause. (Countered by §4.)
- **Single-hypothesis lock-in** — the first plausible cause is accepted; competing explanations are
  never enumerated, so a wrong-but-plausible cause survives. (Countered by §3.)

The orchestration in §2 is what makes the depth affordable: you delegate breadth and judgment, and
spend your own turns on the runtime evidence and the synthesis only a context-holder can do.

---

## 1. Independent-Diagnosis Mandate (prior issues are hypotheses)

Diagnose the cause from the symptom and the evidence, **independently of any answer already on record.**

When a prior issue, a prior incident write-up, a teammate's Slack guess, or a code comment already
asserts a root cause:

- Treat that assertion as a **candidate hypothesis to be tested**, not as the answer. Record it as one
  entry in the hypothesis ledger (§3), with the same disproof burden as every other candidate.
- Do **not** stop diagnosis because a prior issue "already says" the cause. Reach the cause through
  your own evidence chain (symptom → runtime evidence → code), then check whether it converges with the
  prior assertion.
- The **duplicate decision is made *after* the cause is independently established**, not before. Once
  you hold an evidence-backed cause, apply the SKILL.md Duplicate Policy: an exact duplicate means
  surface the existing issue (and propose enrichments your independent diagnosis surfaced); a
  near-duplicate means file and link. Diagnosis-first, duplicate-decision-second — never the reverse.

**Why:** an inherited cause carries an inherited error. The cheapest place to catch a wrong prior
diagnosis is the second independent look — but only if the second look is actually independent. A
diagnosis that begins "the issue says X, let me confirm X" confirms X whether or not X is true.

---

## 2. Orchestration Model (delegate breadth and judgment; own the runtime and the synthesis)

Stage 3 runs as an **orchestration**, not as a solo read-through. The shape below is what the work looks
like — match it. You are the synthesizer; the workers supply the tracks you triangulate.

| Track | Who runs it | What it produces |
|---|---|---|
| **Code-path facts** | `explore` — one dispatch **per implementation** (see §5) | Where the flow lives, what each step reads/writes, the exact FILE:LINE of the suspected mechanism, current behavior. |
| **Causal judgment & cross-module reasoning** | `oracle` | Whether the proposed mechanism actually produces the symptom, change propagation, and **active disproof of competing hypotheses** (§3). Fire oracle whenever the mechanism crosses module boundaries or stays unclear after `explore` returns — for symptom diagnosis that is the default, not the exception. |
| **External / library / protocol behavior** | `librarian` | How an external dependency actually behaves when the mechanism touches one — PG/payment semantics, third-party API error contracts, framework/ORM edge behavior, library defaults. Use it instead of guessing what a dependency does. |
| **Runtime evidence** | **you, directly** (observability / log tools) | The production trace that proves the mechanism fired: timelines, error signatures, the entity's actual history. `explore` cannot reach logs/observability — this track is yours (§4). |
| **Non-code context** | **you, directly** (PM / messenger / docs tools) | The witness account, the originating thread, related decisions. Inline per gather-crosslink.md. |

Dispatch the independent tracks **concurrently** (one message, multiple agents) — they have no shared
state. Then synthesize: convergence across tracks is the signal (§6 gate).

**Delegate-first self-check (red flag):** if you find yourself hand-reading the 5th+ source file to map
the flow, or hand-tracing call chains across modules, stop — that is an `explore`/`oracle` dispatch you
skipped. Your own turns are best spent on the runtime evidence and the cross-track synthesis, which no
worker can do for you. Delegating is not offloading effort; it is buying parallel breadth and an
independent second mind for the triangulation.

**Do not over-delegate the synthesis.** The convergence judgment, the hypothesis ledger, and the
confidence call are yours — a worker sees one track and cannot weigh them against each other.

---

## 3. Competing-Hypothesis Disproof (required artifact: the hypothesis ledger)

Before any cause may be recorded as the Root Cause, produce a **hypothesis ledger** — and keep it; it
feeds the Evidence/Notes of the issue. The ledger is the artifact that proves you tested alternatives
rather than locking onto the first plausible story.

The ledger must contain **at least two candidate causes**, and for each a verdict backed by evidence:

```
Hypothesis ledger:
- H1 (candidate): {mechanism}
    verdict: CONFIRMED — {the runtime + code evidence that establishes it}
- H2 (competing): {a different mechanism that would produce the same symptom}
    verdict: REFUTED — {the specific evidence that rules it out}
- H3 (competing): {another plausible cause — including any prior-issue assertion per §1}
    verdict: REFUTED — {evidence} | or NOT-DISTINGUISHED — {what evidence would separate it from H1}
```

This is a **working artifact**, not an issue-body section — the example above uses a plain label, not
a `##` heading, on purpose. Never render `## Hypothesis ledger` (or a translated equivalent) as its own
top-level section in the issue; per §7, fold it compactly into Evidence or Notes instead.

Rules:

- The competing hypotheses must be **genuine alternatives** that would produce the *same observed
  symptom* — not strawmen. Draw them from how the symptom could arise by a different mechanism (a
  different code path, a retry/reconciliation loop, an external-system fault, a data/state artifact, a
  config/flag difference). `oracle` is well-suited to generating and refuting these — ask it to.
- **REFUTED requires evidence**, not assertion — a code path that is not reached, a log line that is
  absent, a state that is rebuilt rather than stale. "Probably not H2" is not a refutation.
- If two hypotheses cannot be separated by available evidence, mark **NOT-DISTINGUISHED** and name the
  query/test that would separate them. An un-separated alternative caps confidence (§6) — it does not
  silently disappear.
- The prior-issue cause (§1) is **always** a ledger entry, never an exemption.

**Why:** a cause that merely *fits* the evidence is weak; a cause that fits while named alternatives are
*ruled out by evidence* is strong. The disproof is where "plausible" becomes "established."

---

## 4. Runtime Evidence Over Code Reasoning (conditional gate)

Code tells you the *mechanism*; runtime evidence proves the mechanism *actually fired* and is what the
user is hitting. You need both.

**Gate:** if an observability/log tool is wired in the runtime, a **runtime-evidence trace is required**
before the Root Cause may be marked Confirmed (§6). If no such tool is reachable, the Root Cause is
capped at hypothesis-grade and is written as `TBD — needs validation via {runtime method}` until a trace
is obtained.

How to run the runtime track (this is **targeted depth**, the opposite of the gather logs cap):

- The gather-crosslink.md logs cap (5 items / 14 days) bounds *breadth* gathering for the References
  section. It does **not** bound diagnosis querying. Here you query **deep and iteratively**: by the
  specific entity (user/household/order id), by the error signature, by the component/job name, across
  the window the symptom actually spans.
- Build a **timeline**, not a sample. Pull the sequence of events for the affected entity and look for
  the decisive shape: when it started, the cadence, and — most valuable — an **asymmetry or absence**
  (an event that should be present and is not, two related jobs that disagree). Asymmetries are often
  the empirical proof that two code paths diverge, which code-reading alone only suggests.
- If field names/indices are unknown, discover them from an actual document's keys, then narrow. Don't
  abandon the track because the first query shape was wrong.

**Why:** every baseline failure mode shares one tell — a confident Root Cause written without anyone
having looked at what production actually did. The trace is what separates "this code could cause it"
from "this is what is happening to this user."

---

## 5. Multi-Path Coverage (required body field: per-path status)

Before diagnosing, **enumerate every implementation of the affected flow.** Many flows have more than
one live implementation — a migration in progress (two backends behind a flag), a job and its
reconciliation counterpart, a client mirror of a server rule, language-parallel services sharing a
table. Diagnosing only the first one found understates the blast radius.

- Identify the implementations (a flag split, a Strangler migration, parallel services). `explore` per
  implementation (§2).
- Diagnose the mechanism in **each** path — do not assume parity; verify it. Parallel implementations
  drift, and the bug may be present in one, both, or differ between them.
- The issue body carries a **per-path status** statement: which paths exhibit the defect and which do
  not, each backed by its own evidence. A fix scoped to one path when the defect lives in two is a
  half-fix that silently leaves half the users broken.

**Why:** "I found the bug" answers *a* path; "I found every path the bug lives in" answers the issue.
The second is what bounds the fix correctly.

---

## 6. Diagnosis Confidence Gate (Confirmed vs Hypothesis → Root Cause vs TBD)

A Root Cause may be written as **Confirmed** (and the issue filed with it) only when all hold:

1. **Triangulation** — at least two *independent, heterogeneous* tracks converge on the same mechanism
   (e.g., runtime evidence + code, not two code reads). Homogeneous corroboration (two reads of the same
   code) is one track, not two.
2. **Runtime evidence** — the §4 gate is satisfied (or hypothesis-grade if no observability is wired).
3. **Disproof** — the §3 ledger holds ≥2 candidates and every competing hypothesis is REFUTED (or any
   NOT-DISTINGUISHED alternative is named with the query that would resolve it).
4. **Multi-path** — §5 coverage is complete; per-path status is known.

When all four hold → write the Root Cause as established, with its evidence, into the issue
(issue-craft.md Bug-Genre / RCA shape).

When any fail → the cause is **hypothesis-grade**. Write `TBD — needs validation via {method}` in the
Root Cause field and name the specific missing element (the absent runtime trace, the un-separated
alternative, the unexamined path). This connects to the SKILL.md refuse-to-file gate: a
runtime-evidence-free root-cause claim does not get filed as a Root Cause — it gets filed as an open
question with the validation method named.

**Confidence is graded, not binary.** State it honestly in the issue: what is established, by which
converging evidence, and what residual uncertainty remains (and whether that uncertainty changes the
fix scope — often it does not).

---

## 7. Output → Stage 4 wiring

The sub-pipeline feeds the issue body (issue-craft.md) as follows:

- **Root Cause / Symptom / Fix direction** ← the Confirmed mechanism (§6), in the RCA Bug-Report shape.
- **Reproduction** ← the trigger sequence established during diagnosis.
- **Evidence** ← the runtime trace (§4) quoted directly (log lines, timeline, the decisive asymmetry),
  plus the FILE:LINE code citations from the `explore` tracks.
- **Pre-Context / per-path status** ← §5 coverage: which implementations carry the defect. Rendered as
  a sub-bullet within Pre-Context (사전 확인), localized as 경로별 상태 — never a standalone top-level
  section.
- **Hypothesis ledger** ← record the refuted alternatives, compactly, under Evidence or Notes. They tell
  the next reader which plausible causes were already ruled out, so the investigation is not re-run.
  Never rendered as its own top-level section (see §3).
- **Confidence** ← the §6 grade and residual uncertainty. Folds into the Root Cause / Evidence
  confidence statement, localized as 확신도 — never rendered as its own top-level section.

The labels named above (`Root Cause`, `Symptom`, `Fix direction`, `Reproduction`, `Evidence`,
`Pre-Context`) are canonical English pointers into the issue-craft.md contract — they render in the
issue body via that file's Render Contract and Working-Language Localization table (§1) and its RCA
Bug-Report shape (§3), never as raw English.

Then apply the Duplicate Policy (§1: after the cause is established) and proceed to the write tail.

---

## 8. Worked example (one, compressed)

Symptom report: "member cancelled all smart subscriptions but still gets a daily card-limit-exceeded
payment-failure alert." A prior issue already asserted a cause.

- **§1 independence**: the prior issue's cause was entered as ledger hypothesis H1, not inherited.
  Diagnosis proceeded from the symptom independently; the duplicate decision was deferred to the end.
- **§2 orchestration**: `explore` dispatched per backend (Node + Python) for the cancel path and the
  payment-batch selection query; `oracle` for cross-module causal judgment and to refute competitors;
  the originating support thread and the production logs were pulled directly (not via `explore`).
- **§4 runtime**: production logs for the specific household showed the daily 21:00 failure cadence over
  three days **and the decisive asymmetry** — the cart-creation event appeared on day 1 only, while the
  charge attempts continued every day. That absence empirically proved the cancel-time job and the
  charge-time job use *different* active checks — a fact code-reading only suggested.
- **§3 ledger**: H1 (cancel sets `deleted_at` but the charge selects on residual `cart.quantity>0`) —
  CONFIRMED by logs+code. H2 (reconciliation/orphan-recovery loop) — REFUTED: that row is rebuilt fresh
  each run, not stale. H3 (Node↔Python split-brain) — REFUTED: both backends share the identical
  selection predicate. H4 (external PG quirk) — REFUTED: the PG correctly returned limit-exceeded; the
  fault was upstream selection.
- **§5 multi-path**: both backends (flag-split migration) carried the identical defect; per-path status
  recorded; fix scope = both.
- **§6 gate**: triangulation (logs + code + oracle) ✓, runtime ✓, disproof ✓, multi-path ✓ → Root Cause
  written as Confirmed; residual uncertainty (which flag path the member was on) noted as not affecting
  fix scope.

The example shows the doctrines composing — it is not a template to pattern-match. A different symptom
will have different paths, different competitors, and a different decisive trace; the procedure is the
same.
