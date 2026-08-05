# Lane A: Direction & Discovery

Lane A feeds `prometheus`. It does not replace Prometheus, write a parallel plan, or start implementation. Its job is to translate designpowers discovery, research, persona, taste, debate, and state capabilities into prompt context that lets `prometheus` produce a decision-complete work plan with design-specific acceptance criteria.

## Phase Owner

| Capability | Source boundary | owner | Mapping |
|---|---|---|---|
| Discover the human problem, constraints, audience, success criteria, and early taste signals | Authored concept preserved from excluded raw `design-discovery` | `prometheus` | Inject a compact design brief request before Prometheus drafts tasks. Prometheus still decides the plan structure and asks only unresolved owner decisions. |
| Identify research gaps and inclusion-aware research methods | `research-planning` | `prometheus` | Convert research questions into plan discovery tasks or explicit assumptions with evidence requirements. |
| Define principles, experience map, positioning, and success metrics | Authored concept preserved from excluded raw `design-strategy` | `prometheus` | Add strategy constraints and design principles to the plan's acceptance criteria. |
| Represent the full ability spectrum | `inclusive-personas` | `prometheus` | Require personas and stress cases in plan inputs, including permanent, temporary, and situational contexts. |
| Calibrate current-project taste and quality bar | Authored concept preserved from excluded raw `design-taste` | `prometheus` | Add live taste constraints for this project only; do not import cross-project memory as a design rule. |
| Surface competing directions and trade-offs | `design-debate` | `prometheus` | When direction is ambiguous, ask Prometheus to present 2-3 options with accessibility and usability trade-offs before choosing defaults. |
| Curate references and inspiration without copying | `inspiration-scouting` | `prometheus` | Add evidence-backed inspiration notes as optional plan context, with "what to take" and "what to leave." |
| Maintain shared design state | Authored concept preserved from excluded raw `design-state` | `prometheus` | Read and update `$OMT_DIR/frontend-design/state.md` as the OMT-native state ledger. |

Materialized agent references for this lane: `design-strategist`, `design-scout`, and `inspiration-scout`. They are role-reference material for OMT-native prompts, not separately installed agents.

## Prompt Injection

Prepend this lane to a `prometheus` planning prompt when the work is UI, UX, product surface, visual direction, design-system, accessibility, or user-flow shaped:

```text
Load Lane A Direction & Discovery. Use designpowers only as design-process context.
`prometheus` remains the planner and must write the final `$OMT_DIR/plans/<slug>.md`.

Before planning, extract or infer:
- problem statement, primary users, constraints, out-of-scope
- inclusive-personas ability spectrum and stress contexts
- design principles, success metrics, quality bar, and current-project taste signals
- research gaps that affect design decisions
- competing directions and trade-offs when direction is not settled
- existing `$OMT_DIR/frontend-design/state.md` decisions, debt, and open questions

Add design-specific acceptance criteria to the Prometheus plan:
- each UI task names the persona or journey it serves
- each task has accessibility and cognitive-accessibility checks where relevant
- each visual decision traces to a design principle, taste signal, or design-system token
- deferred design questions are explicit owner decisions, not hidden assumptions
```

## Evidence Requirements

Lane A passes only when the plan has inspectable design context, not vague intent. Required evidence:

- `$OMT_DIR/plans/<slug>.md` names the design brief, personas, success criteria, constraints, and owner decisions.
- `$OMT_DIR/frontend-design/state.md` contains or references the current brief summary, personas, design principles, taste signals, decisions log, open questions, and design debt register.
- The plan's verification entries include real-surface QA expectations for UI work, plus persona or ability-spectrum checks for affected flows.
- Any adopted default is named with the reason it was safe to default instead of asking the user.

## Guardrails

- `prometheus` owns the final plan. Lane A may enrich prompts, but it must not create a second planning lane or standalone design plan.
- `writing-design-plans` content is used only as task-quality guidance; Prometheus remains the source of executable TODOs.
- Cross-project memory is descriptive only and must not steer this project's direction unless the user states the preference now.
- Direction debates pause for user decision when the trade-off is product-shaping, accessibility-critical, or hard to reverse.
- No new scheduler, background automation, or project root design-state convention is introduced; state stays at `$OMT_DIR/frontend-design/state.md`.

## Pass / Fail Behavior

PASS when `prometheus` receives this lane context and produces a decision-complete plan whose tasks are design-aware, persona-aware, and evidence-bound.

FAIL when the plan skips inclusive-personas, buries accessibility as a final polish item, treats taste as generic style, writes a parallel design plan, or leaves design decisions for sisyphus workers to invent.
