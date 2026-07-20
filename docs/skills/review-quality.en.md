English | [한국어](review-quality.md)

---

# Review & Quality Skills

oh-my-toong's review and quality skills systematically verify the completeness of code, design, and slides. Each skill has a clear review target and role boundary, and they can call each other or be combined.

---

## Summary Table

| Skill | One-line role | Primary input | When to use |
|-------|---------------|---------------|-------------|
| `code-review` | Correctness-bug review of PRs and diffs | PR number, branch name, or current branch | Before merging code changes |
| `orchestrate-review` | Multi-AI angle-finder orchestration | Chunk prompt (called internally by code-review) | Called by code-review internally — rarely invoke directly |
| `design-review` | Tradeoff tension analysis of designs and plans | Design question, plan doc, architectural concerns | Reviewing an architecture decision or implementation plan |
| `slides-review` | Visual design review of HTML slides | HTML file path | After create-slides, or when improving HTML slide aesthetics |
| `qa` | Implementation correctness verification guardian | QA REQUEST (Spec + Scope + verification method) | After implementation is done and needs independent QA |

---

## Skill Details

### code-review

**Purpose**: Reviews code changes for correctness bugs before merge. The unit of review is not the diff alone but the *system the diff produces*.

**What it reviews**:
- Correctness bugs — whether changed code behaves correctly end-to-end against the surrounding system
- Dependencies, callers, callees, interfaces, configurations, and runtime context across file boundaries
- Classifies each finding candidate as CONFIRMED / PLAUSIBLE / REFUTED
- At higher effort levels, may also include simplification, reuse, and efficiency findings

**Non-negotiable premises**:
1. **Working directory = post-change state**: Read the file system freely to trace dependencies.
2. **No diff-only review**: A diff is a delta. The review target is the system it produces.

**How to invoke**:
```
/code-review                      # Auto-detect current branch vs origin/main
/code-review pr 123               # By PR number
/code-review main feature/auth    # Branch comparison
```

**Flags**:
- `--comment` — Post findings as inline PR comments
- `--fix` — Apply findings to the working tree directly

**When to use**: Before merging any code change. Works without a PR via branch comparison or auto-detect mode.

---

### orchestrate-review

**Purpose**: A multi-AI review orchestrator called internally by `code-review`. It fans out AI finders in parallel — each with a distinct review lens (angle) — collects their independent candidate findings, and merges them into a single deduplicated candidate list.

**What it does**:
- Collects candidates from each angle finder independently
- Deduplicates and aggregates — does not assign verdicts (CONFIRMED/PLAUSIBLE/REFUTED)
- Returns the un-judged candidate set to the upstream `code-review` for verification

**Role boundary**:
- "Conductor, not a reviewer" — does not read code itself, assign severity, or decide whether anything should be merged.
- If all finders are unavailable (no config, CLI not installed, timeout), falls back to in-session finder mode directly.

**When to use**: In most cases, `code-review` calls this internally and you do not need to invoke it directly. It can be wired directly when building a custom multi-AI review pipeline.

---

### design-review

**Purpose**: An advisory review channel for design documents, plans, and architectural decisions. It steelmans the strongest possible antithesis and surfaces tradeoff tensions — analysis counsel, not a verdict gate.

**What it reviews**:
- Tradeoff tensions and hidden costs
- Alternatives the design may have overlooked
- Architectural considerations — boundaries, dependencies, scalability
- Builds the strongest counter-argument, then provides counterpoints to it

**Workflow**: Dispatches analysis to a configured member (another AI model) via a job. Falls back to in-session analysis if no member is available (`missing_cli`, timeout, empty config).

**When to use**: Architecture decisions, implementation plan reviews, tradeoff analysis. Trigger phrases: "design review", "plan review", "review the plan", "architectural soundness", "설계 검토", "플랜 리뷰", "아키텍처 건전성", "트레이드오프 분석".

---

### slides-review

**Purpose**: Reviews the visual design quality of HTML slide files using Gemini CLI, then applies the returned improvement directives directly to the CSS/HTML in the main session (Claude).

**What it reviews**:
- Visual design completeness — layout, typography, color, spacing
- Alignment with the stated design path (e.g., frontend-design)
- Adherence to caller-specified protection rules (items must not be modified)

**Invocation patterns**:
- **Called from another skill**: Wired as a post-processing step from `create-slides` and similar skills
- **Direct user invocation**: Provide the HTML file path and review starts immediately

**When to use**: After generating HTML slides when you want to raise visual quality. If Gemini CLI is unavailable or fails, in-session fallback provides the review. Trigger phrases: "디자인 리뷰", "slides review", "슬라이드 리뷰", "gemini review", "design review".

---

### qa

**Purpose**: Quality assurance guardian that verifies implementation correctness. This skill operates under the principle: "Nothing ships without proof."

**What it verifies**:
- Automated checks — build, typecheck, tests, lint
- Spec/AC compliance — verifies implementation against provided criteria; when a completeness directive is present, confirms every prose requirement is reflected in the deliverable
- Hands-on execution — runs caller-provided scenarios verbatim and self-authors a 6-category adversarial matrix for any user-facing change; activates when a user-facing change is present OR caller-provided scenarios are supplied

**Critical distinction**: Automated tests and hands-on QA are not substitutes. Automated tests verify "code behaves as intended." Hands-on QA verifies "the application boots and responds to real requests as in production." These are complementary.

**How it is called**: In a `sisyphus`-orchestrated pipeline, invoked with a QA REQUEST after implementation is complete. Can also be called directly by the user for standalone verification.

**When to use**: When implementation is done and you need independent quality assurance against a spec.

---

## Skill Selection Guide

```
What is the review target?
  |-- Code changes (PR/branch)      -> code-review
  |-- Design or architecture plan   -> design-review
  |-- HTML slides                   -> slides-review
  |-- Implementation done, need QA  -> qa

When you run code-review:
  orchestrate-review coordinates multi-AI finders internally.
  You rarely need to invoke orchestrate-review directly.
```

---

## References

- [README](../../README.en.md) — Project overview
- [Core Pipeline Skills](./core-pipeline.en.md) — prometheus, sisyphus, sisyphus-junior
- [Research Skills](./research.en.md) — ultraresearch, insane-browsing
- [Authoring Skills](./authoring.en.md) — Document and slide generation
- [Knowledge Graph & Pins](./knowledge-graph-pins.en.md) — Graphiti, Pin skills
- [Utilities & Personal](./utilities-personal.en.md) — Configuration, keybindings, and more
