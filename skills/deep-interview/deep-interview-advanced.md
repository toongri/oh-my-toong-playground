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

## Integration with Prometheus

When prometheus receives a vague input (no file paths, function names, or concrete anchors), it can redirect to deep-interview:

```
User: "prometheus build me a thing"
Prometheus: "Your request is quite open-ended. Would you like to run a deep interview first to clarify requirements?"
  [Yes, interview first] [No, expand directly]
```

If the user chooses interview, prometheus invokes `/deep-interview`. When the interview completes, the crystallized spec routes planning/execution through `goal` at the Phase 5 execution bridge (the bridge offers no direct prometheus/sisyphus option); `goal` then pursues the objective and may involve prometheus for decomposition when the work warrants it. Prometheus treats the delivered spec as ground-truth input it does not re-derive: it reviews the spec once via its Clearance and fills or fixes only genuine gaps.

## Brownfield vs Greenfield Weights

| Dimension | Greenfield | Brownfield |
|-----------|-----------|------------|
| Intent Clarity | 30% | 27% |
| Outcome Clarity | 25% | 22% |
| Scope Clarity | 20% | 18% |
| Constraint Clarity | 15% | 14% |
| Success Criteria | 10% | 9% |
| Context Clarity | N/A | 10% |

Brownfield adds Context Clarity because modifying existing code safely requires understanding the system being changed.

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
