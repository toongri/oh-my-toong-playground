# QA report design contract

## 1. Atmosphere & identity

An offline evidence document for a PO/designer. Preserve the existing quiet
reader-first layout; this change adds evidence judgment, not a visual redesign.

## 2. Color

Use the existing `qa-report.ts` STYLE variables: `--bg`, `--fg`, `--muted`,
`--rule`, `--code-bg`, `--accent`, `--pass`, `--fail`, `--na`. Existing light/dark
values remain authoritative. Supported outcomes use pass; evidence gaps use the
existing unverified/gap state, never a green badge.

## 3. Typography

Existing system/Pretendard body at 16px/1.7; monospace for audit paths only.
H1/H2/H3 remain 1.75/1.3/1.05rem. Claim and observation use body text, not tiny
path captions. Korean claim phrases must remain readable when wrapped.

## 4. Spacing & layout

Keep the existing 52rem main column, 1.25rem horizontal padding, vertical story
and scenario stacks, and evidence-slot spacing. Claim evidence is a vertical
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
