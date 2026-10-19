# QA report design contract

## 1. Atmosphere & identity

An offline evidence document for a PO/designer. Preserve the existing quiet
reader-first layout; this change adds evidence judgment, not a visual redesign.

## 2. Color

Use the html-report design tokens in `qa-report.ts` STYLE (`skills/html-report/SKILL.md`
section 3): `--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3`, `--line`,
`--line-strong`, `--accent`, and the `--ok`, `--warn`, `--bad` semantic pairs with their
`-bg` tints, in light and dark. Supported outcomes use ok; evidence gaps use the
existing unverified/gap state, never a green badge.

## 3. Typography

Korean-first sans stack (IBM Plex Sans KR, then system Korean faces; no font link, so the
page has zero external reference), body 16px/1.75, monospace for audit paths only.
H1/H2/H3 follow the html-report scale (clamp 30-46px, 24px, 17px). Claim and observation use body text, not tiny
path captions. Korean claim phrases must remain readable when wrapped.

## 4. Spacing & layout

One 1040px column with 16px minimum side gutters, 720px prose measure, vertical story
and scenario stacks, and evidence-slot spacing; works from 400px to 1280px. Claim evidence is a vertical
stack: claim, observation/location, image. This gives each asserted result room
to be read instead of squeezing several images into a contact sheet.

## 5. Components

Reuse `scenario-card`, `sc-head`, `sc-observed`, `evidence-slot`, `gap`, badges,
and native details/summary for audit material. Required states: supported,
insufficient, missing review, stale review. Each claim names its result and the
visible location; no new color or card primitive. Original state remains in the
audit; reader-facing unverified status must not imply NOT-RUN or product FAIL.

## 6. Motion & interaction

No scripted motion. Native document scrolling and details/summary retain keyboard
behavior. Zero runtime scripts and no external resources.
Evidence images use a native details toggle to switch from fit-width preview to
scrollable original size; the same image bytes remain visible, without duplication.

## 7. Depth & surface

Existing borders-only strategy; no new shadows or decorative surfaces.

## 8. Accessibility constraints & accepted debt

Text labels accompany status colors. Images use descriptive claim/location
labels. Primary content must fit 375/768/1280px; audit tables may scroll locally.
No new accepted debt; this extraction does not claim an existing full WCAG audit.
