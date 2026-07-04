# Deep Interview Examples

Question-quality calibration examples (Good and Bad patterns).

## Table of Contents
- [Good: Targeting weakest dimension](#good-targeting-weakest-dimension)
- [Good: Gathering codebase facts before asking](#good-gathering-codebase-facts-before-asking)
- [Good: Contrarian mode activation](#good-contrarian-mode-activation)
- [Good: Early exit with warning](#good-early-exit-with-warning)
- [Good: Ontology convergence tracking](#good-ontology-convergence-tracking)
- [Good: Ontology-style question for scope-fuzzy tasks](#good-ontology-style-question-for-scope-fuzzy-tasks)
- [Bad: Batching multiple questions](#bad-batching-multiple-questions)
- [Bad: Asking about codebase facts](#bad-asking-about-codebase-facts)
- [Bad: Proceeding despite high ambiguity](#bad-proceeding-despite-high-ambiguity)

---

<Examples>

### Good: Targeting weakest dimension

Targeting weakest dimension:
```
Scores: Goal=0.9, Constraints=0.4, Criteria=0.7
Next question targets Constraints (lowest at 0.4):
"You mentioned this should 'work on mobile'. Does that mean a native app,
a responsive web app, or a PWA? And are there specific devices or OS versions
you need to support?"
```
Why good: Identifies weakest dimension, explains why it is now the bottleneck, asks a specific question to improve it, and doesn't batch multiple topics.

### Good: Gathering codebase facts before asking

Gathering codebase facts before asking:
```
[spawns explore agent: "find authentication implementation"]
[receives: "Auth is in src/auth/ using JWT with passport.js"]

Question: "I found JWT authentication with passport.js in `src/auth/` (pattern match from explore).
For this new feature, should we extend the existing auth middleware or create
a separate authentication flow?"
```
Why good: Explored first, cited the repo evidence that triggered the question, then asked an informed confirmation question. Never asks the user what the code already reveals.

### Good: Contrarian mode activation

Contrarian mode activation:
```
Round 5 | Contrarian Mode | Ambiguity: 42%

You've said this needs to support 10,000 concurrent users. What if it only
needed to handle 100? Would the architecture change fundamentally, or is
the 10K number an assumption rather than a measured requirement?
```
Why good: Challenges a specific assumption (scale requirement) that could dramatically simplify the solution.

### Good: Early exit with warning

Early exit with warning:
```
User: "That's enough, just build it"
System: "Current ambiguity is 35% (threshold: <resolvedThresholdPercent>). Areas still unclear:
  - Success Criteria: 0.5 (How do we verify the search ranking algorithm works correctly?)
  - Constraints: 0.6 (No performance targets defined yet)

Proceeding may require rework. Continue anyway?"
  [Yes, proceed] [Ask 2-3 more questions] [Cancel]
```
Why good: Respects user's desire to stop but transparently shows the risk.

### Good: Ontology convergence tracking

Ontology convergence tracking:
```
Round 3 entities: User, Task, Project (stability: N/A → 67%)
Round 4 entities: User, Task, Project, Tag (stability: 75% — 3 stable, 1 new)
Round 5 entities: User, Task, Project, Tag (stability: 100% — all 4 stable)

"Ontology has converged — the same 4 entities appeared in 2 consecutive rounds
with no changes. The domain model is stable."
```
Why good: Shows entity tracking across rounds with visible convergence. Stability ratio increases as the domain model solidifies, giving mathematical evidence that the interview is converging on a stable understanding.

### Good: Ontology-style question for scope-fuzzy tasks

Ontology-style question for scope-fuzzy tasks:
```
Round 6 | Targeting: Intent Clarity | Why now: the core entity is still unstable across rounds, so feature questions would compound ambiguity | Ambiguity: 38%

"Across the last rounds you've described this as a workflow, an inbox, and a planner. Which one is the core thing this product IS, and which ones are supporting metaphors or views?"
```
Why good: Uses ontology-style questioning to stabilize the core noun before drilling into features, which is the right move when the scope is fuzzy rather than merely incomplete.

### Bad: Batching multiple questions

Batching multiple questions:
```
"What's the target audience? And what tech stack? And how should auth work?
Also, what's the deployment target?"
```
Why bad: Four questions at once — causes shallow answers and makes scoring inaccurate.

### Bad: Asking about codebase facts

Asking about codebase facts:
```
"What database does your project use?"
```
Why bad: Should have spawned explore agent to find this. Never ask the user what the code already tells you.

### Bad: Proceeding despite high ambiguity

Proceeding despite high ambiguity:
```
"Ambiguity is at 45% but we've done 5 rounds, so let's start building."
```
Why bad: 45% ambiguity means nearly half the requirements are unclear. The mathematical gate exists to prevent exactly this.
</Examples>
