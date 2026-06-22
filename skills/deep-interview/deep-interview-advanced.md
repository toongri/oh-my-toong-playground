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

If the user chooses interview, prometheus invokes `/deep-interview`. When the interview completes and the user selects the prometheus route at the execution bridge, the spec becomes Phase 0 output and prometheus continues from planning.

## Brownfield vs Greenfield Weights

Canonical formula and coefficients are in SKILL.md Phase 2 (the `ambiguity =` lines). Do not duplicate them here.

Brownfield adds a Context Clarity dimension because modifying existing code safely requires understanding the system being changed. That dimension contributes the remaining weight budget after the three shared dimensions — keeping greenfield weights proportionally larger across goal/constraints/criteria.

## Challenge Agent Modes

Canonical round thresholds are in SKILL.md Phase 3 headings (Round 4+, Round 6+, Round 8+). Do not duplicate them here.

Each mode is used exactly once, then normal Socratic questioning resumes. Modes are tracked in state to prevent repetition.

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
