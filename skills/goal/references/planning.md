## Six Slots

The Entry Gate's falsifiable objective is captured as six slots. **Four are captured from the request (or the crystallized spec); two are minted by this orchestrator.** All six are written through `set --phase planning` at seed time.

Four content slots (from capture):

1. **outcome** (`--outcome`) — what is true when the objective is reached (the desired end state).
2. **verification-surface** (`--verification-surface`) — the concrete evidence that proves success (test, benchmark, artifact, observable behavior). This is the load-bearing slot: it is the only one that makes the objective machine-decidable.
3. **constraints** (`--constraints`) — what must NOT regress while pursuing (correctness suites stay green, contracts preserved).
4. **boundaries** (`--boundaries`) — the allowed files, tools, and resources the pursuit may touch.

Two minted slots (not in the request — this orchestrator supplies them):

5. **iteration-policy** → `max_iterations` (`--max-iterations <n>`) — the finite cap on pursuit blocks. Default **10** when not overridden at invocation; invocation-overridable. This is the SOLE soft-stop bound: when pursuit hits `max_iterations` the loop soft-stops (state preserved), it does NOT hard-kill.
6. **blocked-stop** (`--blocked-stop <text>`) — the objective-specific predicate that means "no valid path forward". A decidable, point-in-time condition (no cross-iteration memory); when met, pursuit stops and reports the blocker, non-complete.

Seed example (run at the first `planning` transition):

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set --phase planning \
  --outcome "<desired end state>" \
  --verification-surface "<concrete evidence that proves success>" \
  --constraints "<what must not regress>" \
  --boundaries "<allowed files/tools/resources>" \
  --max-iterations 10 \
  --blocked-stop "<objective-specific no-path-forward predicate>"
```

<!-- story-layer:start -->

## Story Definition (Planning Phase)

After capturing the six slots and before dispatching to sisyphus, define the WHAT-slices of the objective with the user, story by story. Each story is an independently verifiable chunk of the objective — not a task (HOW) but a stated outcome (WHAT).

**When to slice vs. use single-derivation.** If the objective is a single WHAT — one deliverable, one verification surface, no meaningful sub-goals — run:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set-stories --single
```

This derives one story directly from the current `outcome` and marks it `confirmed` immediately (no separate `confirm-story` call needed). Use `--single` for objectives where slicing into multiple stories would introduce ceremony without value.

For objectives with multiple distinct WHAT-slices, define them one at a time with the user. For each story, establish:

1. A **WHAT statement** — the desired outcome for this slice, stated concretely.
2. At least one **acceptance criterion** — a falsifiable check that, when met, confirms the slice is done.
3. A **verification surface** — the concrete evidence that proves the AC is met (a test, an artifact, a command output, an observable behavior).

Once you have agreed on the full story set with the user, ingest it:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts set-stories --json '<array-of-stories>'
```

`set-stories --json` refuses an empty array, any story missing acceptance criteria or a verification surface, duplicate ids, an empty `outcome`, or a `phase` other than `planning`. Every ingested story starts `unconfirmed`.

**Per-story confirmation.** After the user approves each story in the planning dialogue, confirm it:

```
bun ${CLAUDE_SKILL_DIR}/scripts/goal-state.ts confirm-story <id>
```

`confirm-story` is the sole path from `unconfirmed` to `confirmed`. No other subcommand (`set`, `set-verdict`, `set-stories --json` re-ingestion) can produce `confirmed`. The pursuing phase is refused while any story remains `unconfirmed` — `set --phase pursuing` names the offending ids on stderr. Once all stories are `confirmed` (or `retired`), the pursuing transition is allowed.

<!-- story-layer:end -->

---

<!-- story-layer:start -->

### Mid-flight Story Mutations

Stories can be discovered, corrected, or retired during pursuit. Use the per-story mutation subcommands when the situation changes mid-flight:

- **`add-story --json '<story>'`** — appends one new story with status `unconfirmed`. Requires `--evidence '<what was observed>'` and `--rationale '<why this is the right response>'` in addition to `--json`; both are mandatory with no default — an omitted or whitespace-only value is refused. Allowed in both `planning` and `pursuing`. A newly added story must be confirmed via `confirm-story <id>` before completion is allowed (an `unconfirmed` story blocks `request-complete`).
- **`revise-story <id> --json '<patch>' --evidence '<what was observed>' --rationale '<why this is the right response>'`** — patches an existing story's text, acceptance criteria, or verification surface. `--evidence` and `--rationale` are both mandatory with no default — an omitted or whitespace-only value is refused. Revision ALWAYS resets the story's status to `unconfirmed` — a story whose definition changed requires fresh user approval. Refused on retired stories and unknown ids.
- **`retire-story <id> --evidence '<what was observed>' --rationale '<why this is the right response>'`** — marks a story `retired`. `--evidence` and `--rationale` are both mandatory with no default — an omitted or whitespace-only value is refused. An `unconfirmed` story is retirable in any phase. A `confirmed` story is retirable ONLY while `phase=planning` — retiring a confirmed story mid-pursuit is refused (run `set --phase planning` first to re-enter planning, then retire). This fence prevents retiring a confirmed WHAT mid-pursuit as a way to remove it from the completion gate.

Re-plan (`set --phase planning`) preserves `stories[]` including per-story statuses, while resetting `objective_verdict` and `completion_evidence_paths` exactly as today. Stories survive re-planning; only verdict state is cleared.

<!-- story-layer:end -->
