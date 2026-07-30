English | [한국어](utilities-personal.md)

---

# Utility and Personal Workflow Skills

This page covers two categories of skills. **Utility skills** support the development environment and testing infrastructure, designed for general use. **Personal workflow skills** belong to the owner's job-search pipeline — version-controlled here alongside the rest of the system, but not intended for general distribution.

---

## Utilities

### hud

The HUD displays Oh-My-Toong operational state in real time inside Claude Code's statusLine. Running `/hud setup` checks for Bun and jq, then updates the `statusLine` key in `settings.local.json` to point at the HUD script. Displayed elements include context window usage, running subagent count, Todo completion status, and the active skill name. `/hud restore` recovers the original statusLine configuration that was backed up on first setup. Because all paths are resolved via `${CLAUDE_SKILL_DIR}` self-location, the skill behaves identically whether deployed user-globally or project-locally.

### E2E Drivers

Choose the driver and skill together based on the surface under test. Use `agent-browser` for web pages, browser pages, and Electron desktop apps; use `agent-device` for iOS, Android, mobile, TV, and native desktop apps. Always load the matching skill before invoking either CLI. This document does not duplicate `agent-device` CLI syntax: after loading the skill, consult the installed version's runtime help. `dogfood` is the workflow for exploratory mobile QA performed with `agent-device`.

---

## Personal Workflow Skills

The skills below form the owner's job-search pipeline. Each entry is intentionally summary-only.

| Skill | Description |
|-------|-------------|
| `resume-apply` | End-to-end JD-based application workflow — acquire JD → branch → tailor resume → commit → generate PDF |
| `resume-forge` | Resume problem-solving material creation — compound scenario design, problem definition, solution strategy, iterative entry refinement |
| `review-resume` | Resume review and feedback — section-by-section evaluation, JD fit analysis, AI-tone audit, interview readiness check |
| `collect-jd` | JD collection and curation — profile-based relevance scoring, state managed at `$OMT_DIR/collect-jd/` per project scope |
| `mock-interview` | Interviewer-side mock question generation from a resume — multi-level depth including drill-down follow-ups |
| `tech-claim-rubric` | 5-axis technical-claim evaluation framework — A1 Credibility, A2 Causal Honesty, A3 Outcome Clarity, A4 Ownership & Scope, A5 Scanability, plus 2 authenticity rules (R-Phys, R-Cross) |

---

## See Also

- [README](../../README.en.md) — Project overview
- [Core Pipeline Skills](./core-pipeline.en.md) — deep-interview, prometheus, sisyphus
- [Review Quality Skills](./review-quality.en.md) — code-review, orchestrate-review, qa
- [Research Skills](./research.en.md) — ultraresearch, insane-browsing
- [Authoring Skills](./authoring.en.md) — Document and content authoring + shared utils
- [Knowledge Graph & Pins](./knowledge-graph-pins.en.md) — pin skill series
