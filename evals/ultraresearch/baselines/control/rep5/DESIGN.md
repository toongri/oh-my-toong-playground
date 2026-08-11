# REPORT Design System

## 0. Research Log

- Embedded refs: shortlisted Notion, Mintlify, and IBM, then picked `taste-skill` + Notion for a warm, reading-first technical report.
- Lazyweb: skipped; this is a local static-document conversion, not a product-screen design task.
- Imagen drafts: skipped; the source has no visual-asset requirement and the report's tables and citations are its primary evidence.

## 1. Atmosphere & Identity

A calm, evidence-led technical brief. The signature is a blue document rail paired with warm-white reading surfaces: readers can scan decisions quickly while retaining long-form detail without dashboard-like density.

## 2. Color

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Canvas | `--surface-primary` | `#f6f5f4` | Page background |
| Paper | `--surface-elevated` | `#ffffff` | Report surface |
| Ink | `--text-primary` | `#252422` | Headings and body |
| Muted | `--text-secondary` | `#615d59` | Supporting text |
| Rule | `--border-default` | `#dedbd7` | Tables and dividers |
| Accent | `--accent-primary` | `#005bab` | Links and section marker |
| Accent hover | `--accent-hover` | `#00498b` | Link hover |
| Success | `--status-success` | `#14723d` | Covered status |

Accent is reserved for navigation and citations; semantic success is reserved for the requirements matrix.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
| --- | --- | --- | --- | --- |
| Display | `clamp(2rem, 5vw, 3.25rem)` | 700 | 1.05 | Title |
| H2 | `1.5rem` | 700 | 1.25 | Major sections |
| H3 | `1.125rem` | 700 | 1.4 | Subsections |
| Body | `1rem` | 400 | 1.72 | Reading copy |
| Small | `.8125rem` | 500 | 1.5 | Metadata and tables |

Primary stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Mono stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

## 4. Spacing & Layout

Base unit: 4px. The report is centered at 920px, with `24px` page padding on mobile and `48px` on larger screens. Sections use `48px` vertical separation; local elements use 8px, 12px, 16px, 24px, and 32px steps.

## 5. Components

### Report header

- **Structure**: document label, `h1`, concise description, source metadata.
- **States**: static; source link has hover and focus states.
- **Accessibility**: one `h1`, descriptive link text, visible focus ring.

### Evidence table

- **Structure**: semantic `table`, `thead`, `tbody`, horizontally scrollable wrapper.
- **States**: static; links remain focusable.
- **Accessibility**: headers use `scope="col"`; rows retain readable contrast.

### Citation link

- **Structure**: inline anchor with visible underline.
- **States**: default, hover, focus, visited.
- **Accessibility**: color is not the sole indicator; focus outline is visible.

### Source availability note

- **Structure**: `aside` after the report body.
- **Variants**: standard, with unavailable local source filenames in `code`.
- **Accessibility**: concise explanatory text; does not masquerade as an active link.

### Code diagram

- **Structure**: `pre > code` with preserved whitespace.
- **States**: static.
- **Accessibility**: readable contrast and horizontal overflow handling.

## 6. Motion & Interaction

This is a static report. Links use a 150ms color transition; reduced-motion users receive no transition. No decorative animation is used.

## 7. Depth & Surface

Strategy: tonal-shift plus whisper borders. The paper surface uses a restrained shadow only to distinguish it from the page canvas; tables and callouts use borders rather than elevated cards.

## 8. Accessibility Constraints & Accepted Debt

WCAG 2.2 AA target: readable contrast, semantic headings and tables, visible keyboard focus, responsive table overflow, print styles, and reduced motion respected.

| Item | Location | Why accepted | Owner / Exit |
| --- | --- | --- | --- |
| Source files named only in REPORT.md are unavailable in this directory | Source availability note | Avoids rendering broken local links while preserving their names | Resolve by supplying the cited files alongside the report |
