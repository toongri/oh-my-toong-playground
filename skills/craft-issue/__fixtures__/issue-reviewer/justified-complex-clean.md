# E11 — justified-complex-clean

**Expected verdict:** PASS (no findings, no `**Rule:**` line at all)
**Rule source:** n/a — this is the negative control for the escalated Parent-Issue Body Shape

**Known highest-risk fixture (per plan §5.E "E11 알려진 취약점"):** every heavy section below
carries an explicit, individually-checkable trigger, unlike `over-scaffolding.md` (E8) where the
same kind of sections appear with NO trigger. The initiative is deliberately chosen to decompose
into **exactly two genuinely independent children with no shared mutable data model** — adding the
Spanish locale and adding the German locale are parallel, self-contained, and neither depends on a
field the other must persist — so the set has no hidden coverage gap of the kind a data-coupled
initiative (e.g. multi-currency, which needs a distinct currency-persistence slice) would smuggle
in. Read each annotation before treating this as a template — the point is that the trigger, not the
section's mere presence, is what makes each heavy section legal:

- **Parent-Issue Body Shape applies** (not Standard Body Shape) because Stage 5 slicing actually
  fired and created two real children below — Background, Pre-Context, and References are *Required*
  rows for a parent, not an escalation choice.
- **Core Concept is Conditional, triggered**: both children rely on the same "localize UI chrome
  strings only, not user-generated content or transactional email" boundary; if that boundary drifts
  between the two children, one locale would translate things the other leaves in English. That is
  exactly the trigger ("children share a term or model that must not drift").
- **Decisions Needed is Conditional, triggered**: there is a real open product decision (the
  fallback locale for an untranslated string) that shapes both children, and the entry names the
  decision and its owner without stating any option as chosen — matching `- **No pre-solving**`.
- **Post-Release Observation is Conditional, triggered**: the initiative moves a shared outcome
  (share of sessions in a non-English locale — Form 1), declared once at the parent (Tier A) with
  children referencing it rather than re-declaring.
- **Affected Areas is stated as a hedged parent-level forecast** ("Expected to touch …; exact scope
  confirmed per child"), per the code-touching-parent rule — not as flat confirmed child scope.
- **No Evidence, User Value, User Flow, Scope of Application, or Notes sections appear** — none of
  their triggers hold (non-bug, no user-facing value beyond Background, not a transition genre, no
  provenance to record), so per Lean by Default they are correctly omitted.
- Both children are lean Standard Body Shape issues with concrete, single-outcome, non-weasel ACs
  and are each independently complete; together they fully cover the request (no Request-Coverage
  gap, no missing third slice).

---

## Dispatch payload

**Original request (verbatim):**
Localize the app into Spanish and German so non-English users can use it in their own language. This
is a bigger initiative — split it into separate issues if needed, and flag any open questions for
product.

**parent:app-localization-es-de**
## Background
The app ships English-only UI chrome today. Non-English users have asked to use it in their own
language, and product has prioritized Spanish and German for this quarter as the first two locales
of the internationalization initiative.

## Core Concept
This initiative localizes **UI chrome strings** (labels, buttons, menu items, and other
app-authored interface text) only. **User-generated content** (names, comments, uploaded text) and
**transactional email** are explicitly outside the boundary and stay as authored. Every child holds
this same boundary — a child must never localize content outside UI chrome.

## Pre-Context
- **Affected Areas**:
  - Expected to touch the i18n string catalog `i18n/strings.en.json` (the app's UI-string source of
    truth) and per-locale catalogs registered beside it; exact scope confirmed per child (Stage 3
    investigation).
- **Premises**:
  - The app already runs on an i18n framework with an active `en` locale, and adding a locale is a
    matter of supplying a translated catalog and registering it (confirmed by Stage 3 investigation).
  - The app already has a locale switcher that lists every registered locale, so a newly registered
    locale appears in it automatically (confirmed by Stage 3 investigation).
- **Blockers & Risks**:
  - The translated-string source (professional translation vs. in-house) is `TBD — needs validation
    via a conversation with the localization vendor`.

## Post-Release Observation
- **Outcome metric** — share of sessions using a non-English locale (Spanish or German).
- **Target / direction** — increases versus the pre-release 4-week baseline (no fixed figure set
  yet).
- **Observation method + window** — Amplitude cohort comparison against the prior 4 weeks, read 4
  weeks post-rollout. Children reference this parent-level observation rather than re-declaring it.

## Decisions Needed
- Which locale a string falls back to when it has no translation yet (English vs. the user's
  next-preferred locale) — delegated to product for a decision.

## References
- N/A — no prior art gathered for this initiative.

**child:add-spanish-locale**
## Problem
The app has no Spanish UI; Spanish-speaking users see English chrome throughout.

## Pre-Context
- `i18n/strings.en.json` (the English UI-string catalog a Spanish catalog is translated from;
  confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: A user who selects "Español" in the locale switcher sees the app's UI chrome
      rendered in Spanish
      **Verification**: In a test account, select "Español" in the locale switcher and confirm the
      main navigation labels render in Spanish (e.g. the "Settings" item reads "Ajustes")

## Non-Goals
- This issue does not translate user-generated content or transactional email into Spanish.

## References
- See the parent issue for the UI-chrome-only localization boundary this child relies on.

**child:add-german-locale**
## Problem
The app has no German UI; German-speaking users see English chrome throughout.

## Pre-Context
- `i18n/strings.en.json` (the English UI-string catalog a German catalog is translated from;
  confirmed by Stage 3 investigation).

## AC
- [ ] **[Outcome]**: A user who selects "Deutsch" in the locale switcher sees the app's UI chrome
      rendered in German
      **Verification**: In a test account, select "Deutsch" in the locale switcher and confirm the
      main navigation labels render in German (e.g. the "Settings" item reads "Einstellungen")

## Non-Goals
- This issue does not translate user-generated content or transactional email into German.

## References
- See the parent issue for the UI-chrome-only localization boundary this child relies on.
