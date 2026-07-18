English | [한국어](methodology.md)

---

# Development Methodology Skills

oh-my-toong's development methodology skills are a set vendored from the [superpowers](https://github.com/obra/superpowers) plugin. They apply the discipline of TDD (test-driven development) to three separate processes: code implementation, review acceptance, and skill authoring.

---

## Summary Table

| Skill | One-line role | When to use |
|-------|---------------|-------------|
| `test-driven-development` | RED-GREEN-REFACTOR methodology — write a failing test first, then make it pass | Before writing implementation code for any feature or bugfix |
| `receiving-code-review` | Discipline for technically verifying code review feedback before accepting it | Before implementing review feedback — especially when the feedback seems unclear or technically questionable |
| `writing-skills` | Methodology for writing, editing, and verifying skills (TDD applied to process documentation) | When creating a new skill or editing/verifying an existing skill before deployment |

---

## Skill Details

### test-driven-development

**Purpose**: Disciplines the RED-GREEN-REFACTOR cycle — write the test first, watch it fail, then write the minimal code needed to pass.

**Core principle**: "If you didn't watch the test fail, you don't know if it tests the right thing."

**When to use**: Before writing implementation code for any new feature or bugfix. Always invoked ahead of implementation code.

---

### receiving-code-review

**Purpose**: Disciplines the acceptance of code review feedback through technical verification rather than emotional reaction or blind implementation.

**Core principle**: "Verify before implementing. Ask before assuming. Technical correctness over social comfort." Rejects performative agreement — expressing agreement before understanding.

**When to use**: Before implementing code review feedback. Especially useful when the feedback seems unclear or technically questionable.

---

### writing-skills

**Purpose**: Treats skill authoring itself as TDD applied to process documentation — write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).

**Core principle**: "If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing."

**When to use**: When creating a new skill, editing an existing skill, or verifying a skill actually works before deployment.

---

## Provenance

`receiving-code-review` and `test-driven-development` were vendored verbatim from [obra/superpowers](https://github.com/obra/superpowers) v6.1.1; `writing-skills` is identical to the original except for the rewiring below. Licensed under MIT (Copyright (c) 2025 Jesse Vincent).

**Rewiring**: The original `writing-skills` pointed at several sibling superpowers skills via plugin-namespaced references. To leave no dangling reference after superpowers is removed, all of them were rewired to OMT-local skills when vendoring — 8 lines in total; the rest of the body is identical to the original:

- `superpowers:test-driven-development` → `test-driven-development` (3 in SKILL.md + 1 in testing-skills-with-subagents.md)
- `superpowers:systematic-debugging` → `diagnose` (1 example in SKILL.md)
- `verification-before-completion`, `designing-before-coding` → `qa`, `prometheus` (1 example line in SKILL.md)
- `../subagent-driven-development` → `../test-driven-development` (2 help-text lines in render-graphs.js)

**Where provenance is recorded**: The vendored skill files themselves (`skills/test-driven-development/`, `skills/receiving-code-review/`, `skills/writing-skills/`) carry no provenance markers. Provenance tracking lives exclusively in this document.

---

## References

- [README](../../README.en.md) — Project overview
- [Core Pipeline Skills](./core-pipeline.en.md) — prometheus, sisyphus, sisyphus-junior
- [Review & Quality Skills](./review-quality.en.md) — code-review, qa, and more
- [Authoring Skills](./authoring.en.md) — Document and slide generation
