# Predeclared manual scoring

Score each case independently. Read the entire output; keyword counts do not
establish success. Author-only answers are not part of the reader's explanation.

| ID | Pass criterion |
|---|---|
| C1 | Intuition holds an input fixed across before/after, names both results and the predicate/responsibility accounting for the difference or preserved result. |
| C2 | Code explicitly carries that Intuition input through the actual named symbol/predicate to its result. A generic reference to “the example” or a repeated identifier alone is insufficient. |
| C3 | At least one quiz question changes one input/condition from the worked example, asks for the predicted result AND the reason, and has separate result/reason rubric items. The answer is derivable from the taught rule, but that exact case/result is not already worked in the reader's explanation. |
| C4 | Case B preserves observable label decisions; it explains responsibility extraction without inventing an access change. |

Do not interpret C4 as requiring the public API surface to stay identical: canRead
is newly exported. For C3, count changed inputs only when the student is explicitly
asked to predict and explain; a question asking only “why extract?” is not transfer.

The current-skill arm is the five-sample no-new-guidance control for wording
comparison. A separate naive sample removes the entire skill. Candidate samples
receive the same task and fixture, with the revised full skill and template.
These are bounded authoring probes, not a full lifecycle or human learning study.
