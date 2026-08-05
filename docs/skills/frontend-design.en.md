English | [한국어](frontend-design.md)

---

# Frontend Design Skills

The frontend design skills provide a path for designing and building web UI, then independently verifying the rendered result. `frontend` routes the design principles and reference rulesets that fit the request, while `visual-qa` decides whether the actual surface is complete.

---

## Summary Table

| Skill | One-line role | Primary input | When to use |
|-------|---------------|---------------|-------------|
| `frontend` | Design-principle router that selectively connects four rulesets | UI/UX request, visual reference, project `DESIGN.md` | When building, changing, or auditing a frontend surface |
| `visual-qa` | Visual verification gate where two independent oracles judge rendered evidence | Actual captures, reference images, interaction states, TUI captures | When verifying completion after a UI change |

---

## Skill Details

### frontend

**Purpose**: `frontend` is a router rather than a single rulebook that restates every directive. It selects and loads the smallest relevant set of design-principle rulesets for the request, then carries those principles into the `DESIGN.md` contract and the implementation and verification flow.

**Four rulesets**:
- `design`: Routes visual taste, brand references, the design system, and the `DESIGN.md` contract.
- `perfection`: Applies real-browser performance, SEO, and accessibility quality standards.
- `ui-ux-db`: Searches palettes, fonts, layout patterns, and domain UX guidance for concrete choices.
- `designpowers`: Connects personas, cognitive and accessibility constraints, critique, design debt, and handoff to the design operating context.

**Completion gate**: Every visual task owned by `frontend` is complete only after it passes the `/visual-qa` dual-oracle verification gate. A builder's visual glance or static checks alone cannot establish completion.

**When to use**: Use for any visual surface work such as web UI/UX implementation, redesign, styling, layout, motion, accessibility, performance audits, or mockup generation. Do not use it for pure backend, CLI, or logic work with no visual output.

### visual-qa

**Purpose**: `visual-qa` is a dual-oracle verification gate. It captures objectively rendered evidence, then has two independent read-only oracles review design-system and functional integrity on one pass and visual fidelity and CJK precision on the other.

**What it verifies**: It checks web pages and components, responsive viewports, reference-image fidelity, hover/focus/active and motion states, CJK text clipping, and TUI width, borders, and alignment through real execution. When applicable, it captures every page, state, and breakpoint instead of sampling.

**Verdict principle**: Diff and width-check scripts provide evidence for the oracles; they are not the verdict by themselves. The gate synthesizes both independent reviews with fresh captures into PASS, REVISE, or FAIL. A failing surface is edited, recaptured, and reviewed again.

**When to use**: Use after creating or changing UI, or whenever you need to confirm that a page matches its reference, design intent, responsive behavior, and interaction states. Skip it for pure logic changes with no rendered surface.

---

## Skill Selection Guide

```
What are you doing?
  |-- Designing, building, or auditing web UI/UX or visual work -> frontend
  |-- Verifying a UI change through the actual rendered surface -> visual-qa

After using frontend:
  Always run /visual-qa and pass its dual-oracle completion gate.
  Recapture fresh evidence whenever captures are stale or the surface changes.
```

---

## References

- [Core Pipeline Skills](./core-pipeline.en.md) — prometheus, sisyphus, sisyphus-junior
- [Review & Quality Skills](./review-quality.en.md) — code-review, design-review, qa
- [Authoring Skills](./authoring.en.md) — document and slide generation
- [README](../../README.en.md) — Project overview
