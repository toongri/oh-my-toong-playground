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

and resumes from the last completed round, recovering the latest `decision_register` from round history. Reopen decisions only when new evidence changes their premises; a resumed session does not reset questioning depth.

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

## Long Interviews

Question count does not limit the interview. Preserve the latest `decision_register` in the round history, including reopened dependents and provenance, when summarizing or adopting state. Prompt sizes and individual research calls remain bounded operationally; hitting such a bound preserves progress rather than declaring the design ready.

`stance_history` records the ordered questioning perspectives; `challenge_modes_used` remains readable for older sessions. Inspect this history together with per-round scores to identify neglected perspectives and repeated questions. A stored stance name alone is not evidence that its underlying assumption was actually tested.

## Quantitative Feedback and Stances

Display the component's six scores, weights, weighted contributions, and gaps after each round, plus the previous/current ambiguity and ontology stability. These are model assessments backed by explanations, not calibrated probabilities that the design is correct. A plateau (±0.05 for three rounds) prompts inspection of why understanding has not advanced; it does not select Ontologist regardless of the gap.

The five stances remain explicit: Clarify, Fact-ground, Contrarian, Simplifier, Ontologist. Choose by the current decision's missing evidence, premise, complexity, or meaning. Re-investigate a dimension when it contains a new unresolved fact, and revisit a perspective when new evidence warrants it.

## Ambiguity Score Interpretation

| Score Range | Meaning | Action |
|-------------|---------|--------|
| 0.0 - 0.1 | Few reported gaps | Run the Closure Audit; inspect evidence and open decisions |
| At or below the resolved threshold | Candidate for closure | Run the Closure Audit |
| Above the resolved threshold with minor gaps | Some gaps | Continue interviewing |
| Moderate ambiguity | Significant gaps | Focus on weakest dimensions |
| High ambiguity | Very unclear | May need reframing (Ontologist) |
| Extreme ambiguity | Almost nothing known | Early stages, keep going |
</Advanced>
