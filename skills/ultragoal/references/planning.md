## Seven Slots

The Entry Gate's falsifiable objective is captured as seven slots. **Five are captured from the request (or the crystallized spec); two are minted by this orchestrator.** All seven are written through `set --phase planning` at seed time.

Five content slots (from capture):

1. **outcome** (`--outcome`) — what is true when the objective is reached (the desired end state).
2. **verification-surface** (`--verification-surface`) — the concrete evidence that proves success (test, benchmark, artifact, observable behavior). This is the load-bearing slot: it is the only one that makes the objective machine-decidable.
3. **constraints** (`--constraints`) — what must NOT regress while pursuing (correctness suites stay green, contracts preserved).
4. **boundaries** (`--boundaries`) — the allowed files, tools, and resources the pursuit may touch.
5. **non-goals** (`--non-goals`) — what this pursuit deliberately will NOT do, each with its own decider. Distinct from `boundaries` (which surface may be touched) and `constraints` (what must not regress): a non-goal is safe to touch AND safe to leave alone, just excluded by choice. Declare each as `- {what this pursuit will NOT do} | decider: {how to tell a finding belongs to this non-goal}` — a decider-less non-goal has no edge to any finding and does nothing. `set --non-goals` refuses any non-empty line that doesn't match that shape (existence check only, not a quality check).

Two minted slots (not in the request — this orchestrator supplies them):

6. **iteration-policy** → `max_iterations` (`--max-iterations <n>`) — the finite cap on pursuit blocks. Default **10** when not overridden at invocation; invocation-overridable. This is the SOLE soft-stop bound: when pursuit hits `max_iterations` the loop soft-stops (state preserved), it does NOT hard-kill.
7. **blocked-stop** (`--blocked-stop <text>`) — the objective-specific predicate that means "no valid path forward". A decidable, point-in-time condition (no cross-iteration memory); when met, pursuit stops and reports the blocker, non-complete.

Seed example (run at the first `planning` transition):

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set --phase planning \
  --outcome "<desired end state>" \
  --verification-surface "<concrete evidence that proves success>" \
  --constraints "<what must not regress>" \
  --boundaries "<allowed files/tools/resources>" \
  --non-goals "<what this pursuit will NOT do, each with a decider>" \
  --max-iterations 10 \
  --blocked-stop "<objective-specific no-path-forward predicate>"
```

<!-- story-layer:start -->

## Story Definition (Planning Phase)

After capturing the seven slots and before dispatching to sisyphus, **auto-generate** the WHAT-slices of the objective from the `outcome` and `verification-surface` slots — not a task (HOW) but a stated outcome (WHAT) per slice. Story order is definition (insertion) order: place foundational/dependency-bearing stories first, since ultragoal dispatches stories to sisyphus sequentially in that order.

**When to auto-derive a single story vs. auto-generate a set.** If the objective is a single WHAT — one deliverable, one verification surface, no meaningful sub-goals — run:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set-stories --single
```

This derives one story directly from the current `outcome` and marks it `confirmed` immediately (no separate approval call needed) — this is the single-story degrade path (see the Role section of SKILL.md). Use `--single` for objectives where slicing into multiple stories would introduce ceremony without value.

For objectives with multiple distinct WHAT-slices, auto-generate the full set. For each story, derive:

1. A **WHAT statement** — the desired outcome for this slice, stated concretely.
2. At least one **acceptance criterion** — a falsifiable check that, when met, confirms the slice is done.
3. A **verification surface** — the concrete evidence that proves the AC is met (a test, an artifact, a command output, an observable behavior).

Ingest the generated set:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts set-stories --json '<array-of-stories>'
```

`set-stories --json` refuses an empty array, any story missing acceptance criteria or a verification surface, duplicate ids, an empty `outcome`, or a `phase` other than `planning`. Every ingested story starts `unconfirmed`.

**Bulk approval.** Present the full auto-generated set to the user for review in ONE pass — the user may request edits (via `revise-story`/`add-story`/`retire-story`/`split-story`/`reorder-stories`) before approving. Once the user is satisfied, approve the whole set in a single call:

```
bun ${CLAUDE_SKILL_DIR}/scripts/ultragoal-state.ts confirm-all-stories
```

`confirm-all-stories` bulk-confirms every currently-unconfirmed story in one call — the same `unconfirmed`→`confirmed` transition `confirm-story` performs, just batched over the whole set; it is ultragoal's decomposition-ownership affordance, replacing a per-story `confirm-story` dialogue. A `retired` story is left untouched (it was never reachable); an already-`confirmed` story is left untouched (idempotent). No other subcommand (`set`, `set-verdict`, `set-stories --json` re-ingestion) can produce `confirmed`. The pursuing phase is refused while any story remains `unconfirmed` — `set --phase pursuing` names the offending ids on stderr. Once all stories are `confirmed` (or `retired`), the pursuing transition is allowed.

<!-- story-layer:end -->

---

<!-- story-layer:start -->

### Mid-flight Story Mutations

Stories can be discovered, corrected, retired, split, or reordered during planning; all but reordering are also allowed mid-pursuit. Use the per-story mutation subcommands when the situation changes mid-flight:

- **`add-story --json '<story>'`** — appends one new story with status `unconfirmed`. Full command: **`add-story --json '<story>' --evidence '<what was observed>' --rationale '<why this is the right response>'`** — `--evidence` and `--rationale` are required in addition to `--json`; both are mandatory with no default — an omitted or whitespace-only value is refused. Allowed in both `planning` and `pursuing`. A newly added story must be confirmed via `confirm-story <id>` (or a follow-up `confirm-all-stories`) before completion is allowed (an `unconfirmed` story blocks `request-complete`).
- **`revise-story <id> --json '<patch>' --evidence '<what was observed>' --rationale '<why this is the right response>'`** — patches an existing story's text, acceptance criteria, or verification surface. `--evidence` and `--rationale` are both mandatory with no default — an omitted or whitespace-only value is refused. Revision ALWAYS resets the story's status to `unconfirmed` — a story whose definition changed requires fresh user approval. Refused on retired stories and unknown ids.
- **`retire-story <id> --evidence '<what was observed>' --rationale '<why this is the right response>'`** — marks a story `retired`. `--evidence` and `--rationale` are both mandatory with no default — an omitted or whitespace-only value is refused. An `unconfirmed` story is retirable in any phase. A `confirmed` story is retirable ONLY while `phase=planning` — retiring a confirmed story mid-pursuit is refused (run `set --phase planning` first to re-enter planning, then retire). This fence prevents retiring a confirmed WHAT mid-pursuit as a way to remove it from the completion gate.
- **`split-story <id> --json '<array of stories>' --evidence '<what was observed>' --rationale '<why this is the right response>'`** — for when one story turns out to be two or more: retires the parent IN PLACE and inserts the replacements (minimum 2 — for a 1:1 change use `revise-story`) directly after it, preserving sequential dispatch order. The split is recorded machine-readably — the retired parent gets `split_into` (the replacement ids), each replacement gets `split_from` (the parent id) — so a split is distinguishable in state from an unrelated retire + adds. `--evidence` and `--rationale` are both mandatory with no default — an omitted or whitespace-only value is refused. Replacements are validated like `add-story` (schema, unique ids, forced `unconfirmed` — they need fresh approval before completion). Parent fences mirror `retire-story`: an `unconfirmed` parent is splittable in any phase; a `confirmed` parent ONLY while `phase=planning`.
- **`reorder-stories --order <id1,id2,...>`** — planning-only; reorders the stored story array to an EXACT permutation of the current story ids (same set, same length, no duplicates — a partial or padded list is refused). Because story order IS the sequential dispatch order, use this to steer which story runs next before pursuit begins. Once `phase=pursuing`, the dispatch order is frozen — re-plan (`set --phase planning`) first to reorder.

Re-plan (`set --phase planning`) preserves `stories[]` including per-story statuses, while resetting `objective_verdict` and `completion_evidence_paths` exactly as today. Stories survive re-planning; only verdict state is cleared.

<!-- story-layer:end -->
