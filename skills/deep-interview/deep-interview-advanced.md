# Deep Interview Advanced

<Advanced>
## Configuration

Optional settings in `.claude/settings.json`:

```json
{
  "omt": {
    "deepInterview": {
      "ambiguityThreshold": <resolvedThreshold>
    }
  }
}
```

## Resume

If interrupted, run `/deep-interview` again. The skill reads state by invoking:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts get
```

and resumes from the last completed round.

## Continuation Intent (cross-session adoption)

When the user's invocation expresses explicit continuation intent — e.g. "하던 거 계속", "continue what I was doing", "resume the previous interview" — run:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts list-others
```

If candidates exist, present them via AskUserQuestion with one option per candidate (labeled with the candidate's initial idea and age — purpose and idle time from the state), plus a "start fresh" option. Proceed to the next step ONLY on an explicit user selection:

- On candidate selection: run `bun ${CLAUDE_SKILL_DIR}/scripts/deep-interview-state.ts adopt --src <selected-sid>`, then resume the interview from the adopted state's last completed round (read state via `get` after adoption).
- On "start fresh": proceed to Phase 1 as a new interview.

If no candidates exist, say so and proceed fresh. The branch never renames on its own — adoption requires an explicit user selection.

## Ambiguity Weights

Single 6-dimension weighted formula — no greenfield/brownfield branch; every component is scored on all 6 dimensions, always (mirrors `SKILL.md`'s canonical formula and the `prometheus/SKILL.md` decision-checklist table):

| Dimension | Weight |
|-----------|--------|
| Intent Clarity | 27% |
| Outcome Clarity | 22% |
| Scope Clarity | 18% |
| Constraint Clarity | 14% |
| Success Criteria | 9% |
| Context Clarity | 10% |

## Ambiguity Floor (code-enforced)

The interviewer LLM's self-reported ambiguity is never trusted at face value. `deep-interview-state.ts` computes a deterministic floor at write time and clamps the reported value upward against it:

`floor = 0.10 × disputed_count + 0.05 × unscored_component_count + 0.05 × auto_answer_ratio`
`effective_ambiguity = max(reported_ambiguity, floor)`

- `disputed_count` — established facts currently disputed (raised, not yet superseded). Interview-global, not per-component: a fact is an assertion about the design, and disputing one is a user reversal that pressures the whole interview. This is deliberately unlike `unscored_component_count` below, whose active-only scope follows from it counting components.
- `unscored_component_count` — active topology components with at least one of the 6 dimensions still unscored.
- `auto_answer_ratio` — fraction of rounds answered automatically rather than by the user.

Every state write also runs `validateScoredTransition`, which fail-closed rejects (exit 1, state left unchanged) an ambiguity **decrease** while an unresolved disputed fact remains active and the interview already carries clarity scoring — the code-enforced guard against false convergence that honor-system self-scoring cannot provide on its own.

The scoring condition reads the interview's standing state, not the individual write: a later round that lowers ambiguity without re-scoring anything is refused just the same, because scoring and the drop can be split across two calls and a per-write check would be bypassed by sending them separately. This is not a wedge — raising or holding ambiguity stays allowed while a dispute is open, and superseding the disputed fact releases the block. Only lowering is refused, and only while the dispute stands.

## Challenge Agent Modes

The Step 2-head Dialectic Rhythm Guard is the sole gate that selects these stances; the "Selected by guard when" column restates the rotation conditions it owns (these are NOT independent self-firing triggers). The prompt-injection bodies are the Phase 3 templates.

| Mode | Selected by guard when | Purpose | Prompt Injection |
|------|------------------------|---------|-----------------|
| Contrarian | Round 4+, if not yet used | Challenge assumptions | "What if the opposite were true?" |
| Simplifier | Round 6+, if not yet used | Remove complexity | "What's the simplest version?" |
| Ontologist | Stall (±0.05 for 3 rounds) OR Round 8+ with ambiguity > 0.3 | Find essence | "What IS this, really?" |

Contrarian and Simplifier are used exactly once each (tracked in `challenge_modes_used`), then normal Socratic questioning resumes; Ontologist has two named rotation entry points (stall and late-stage) and may recur via either.

## Ambiguity Score Interpretation

| Score Range | Meaning | Action |
|-------------|---------|--------|
| 0.0 - 0.1 | Crystal clear | Proceed immediately |
| At or below the resolved threshold | Clear enough | Proceed |
| Above the resolved threshold with minor gaps | Some gaps | Continue interviewing |
| Moderate ambiguity | Significant gaps | Focus on weakest dimensions |
| High ambiguity | Very unclear | May need reframing (Ontologist) |
| Extreme ambiguity | Almost nothing known | Early stages, keep going |
</Advanced>
