# Agent Model Assignment

Which model tier each agent gets, and how that tier is substituted into a
concrete per-platform model.

This document exists for a specific reason. The two principles below were decided
on 2026-06-26 and 2026-07-21, but they lived **only in commit bodies** — and as a
result `hermes` kept its initial value through 2026-07-28 without ever being
reviewed under either one. A principle that is invisible at code-review time does
not get applied.

## The two assignment principles

### Generation-versus-verification split (2026-06-26)

**Generation and search run Sonnet; verification and judgment run Opus.**

The reasoning is an asymmetry in where errors get caught. A generation-stage error
is caught by downstream verification, but if verification is weak there is no net
below it. Given equal budget, spend it on verification.

### Delegation structure (2026-07-21, commit `986494ad`)

**An agent that delegates to external workers and polls for results runs Sonnet;
an agent that judges or synthesizes with its own model runs Opus.**

Look at execution structure, not the role name. An agent named "reviewer" whose
actual verdict is produced by another process — with the agent itself only
dispatching and collecting — contributes almost nothing to output quality through
its own model tier.

### When the two conflict, delegation structure wins

Some agents are verification by role but delegation by structure. In that cell,
**delegation structure takes precedence** — Sonnet.

Two agents sit there today: `oracle` and `daedalus`. Each routes through the
delegation engine in `lib/generic-job.ts` via the `diagnose` and `design-review`
skills respectively, and the actual analysis is done by delegated workers. Their
current Sonnet value is this clause applied.

The test: does the verdict the agent returns come from **its own model's
reasoning**, or is it carrying another process's output through? The latter is
delegation. `hermes` is the illustrative case — it looks like it produces its own
verdict, but the verdict actually comes from the `ValidationVerdict` enum in
`engine/validators.py`.

## Current assignment

| Agent | Tier | Rationale |
|---|---|---|
| `code-reviewer` | opus | Judges with its own model |
| `issue-reviewer` | opus | Judges with its own model |
| `metis` | opus | Judges with its own model |
| `momus` | opus | Judges with its own model |
| `tech-claim-examiner` | opus | Judges with its own model |
| `chunk-reviewer` | sonnet | Delegation structure (`orchestrate-review`) |
| `daedalus` | sonnet | Conflict cell — delegation structure wins |
| `oracle` | sonnet | Conflict cell — delegation structure wins |
| `explore` | sonnet | Search |
| `librarian` | sonnet | Search |
| `hermes` | sonnet | Search (depth peer to explore/librarian) |
| `mnemosyne` | sonnet | Generation |
| `sisyphus-junior` | sonnet | Generation |

The single source of truth for an agent's tier is the `model:` field in
`agents/<name>.md` frontmatter.

## The tier vocabulary is two values

`opus` and `sonnet`, nothing else. Adding a third requires evidence that some
assignment can only be expressed with it — "I want this agent somewhere between
opus and sonnet" is not enough.

## Substituting a tier into a concrete model

Handled by `model-map` in each `{platform}.yaml`.

### `tiers:` is the normal path

```yaml
model-map:
  tiers:
    opus:   { model: gpt-5.6-sol }
    sonnet: { model: gpt-5.6-terra }
```

**A tier sets the model only.** Omitting `effort` leaves `model_reasoning_effort`
out of the emitted role TOML, so each agent runs at whatever effort the session is
configured for rather than a value frozen at sync time.

### `agents:` is only for what a tier cannot express

```
resolveCodexAgentModel: modelMap.agents?.[name] ?? modelMap.tiers[tier]
```

Since a tier fixes the model alone, the one thing that qualifies for `agents:` is
**an agent that must pin an effort instead of following the session**. With the
tier vocabulary fixed at two, that is effectively its only use.

Pure model differentiation belongs in a tier, not here. A new entry must state
**why it could not be expressed as a tier**.

On 2026-07-28 the four `agents:` entries in `codex.yaml` (`code-reviewer`,
`metis`, `momus`, `tech-claim-examiner`) were removed. All four matched
`tiers.opus` exactly, so the emitted TOML was byte-identical either way — entries
that occupied the slot without changing any deployed output.

Allowed `effort` values are `low` / `medium` / `high` / `xhigh` / `max` / `ultra`,
enforced by `make validate`. That list is the **union** of every model's
`supported_reasoning_levels` as probed from `~/.codex/models_cache.json`, so a
pairing a specific model does not support (say `ultra` on `gpt-5.5`) still passes.
What it catches is the typo.

## Records for individual assignments

### `hermes`, opus to sonnet (2026-07-28)

Its creating commit `a5bc1235` (2026-06-25) predates the generation-versus-
verification decision by one day, and commit `986494ad`, which applied the
delegation-structure principle, touched only `agents/daedalus.md` and
`agents/oracle.md` — never putting `hermes` up for review. It was an initial value
that had passed neither principle, and its creating commit body records no reason
for choosing opus.

Its role is depth peer to `explore` (codebase) and `librarian` (external docs),
taking over when they hit a wall — the search family. Both peers are sonnet. Its
verdict comes from the `ValidationVerdict` enum in `engine/validators.py`, not
from its own model.

### `explore` and `librarian` stay sonnet (2026-07-28)

The two reference implementations point in opposite directions, so neither is a
precedent. In `oh-my-codex`, explore's low value is a mechanical translation of a
Claude-era `model: haiku` frontmatter (`0d2115ce`) left unadjusted since, and the
high effort on its researcher counterpart is not a research judgment but a blanket
rule — "standard class and not an executor implies high" — locked in by a test.
In `lazycodex`, the low values came from `github-actions[bot]` marketplace sync
commit `f39306f`, which lowered the whole fleet together with no human-recorded
reason. That repo's own `model-routing.md` still says exploration should go to a
strong reasoning model, contradicting its current values.

Internal measurement points the other way. By deployed instruction size, `explore`
(10,245 chars) and `librarian` (8,450) carry the heaviest contracts in the sonnet
tier — 1.88x and 1.55x `sisyphus-junior` (5,449). Three structural facts matter
more than the size:

- **No automatic verification surface.** `sisyphus-junior` is caught by build,
  typecheck, and tests; `mnemosyne` by a commit hash. Nothing re-checks these two.
- **Under-searching is indistinguishable from exhaustion.** `ultraresearch`
  decides convergence from the count of expansion leads workers return, so
  shallower search terminates early and silently.
- **They are upstream.** They feed interview questions and design, so degradation
  propagates downstream with the trail broken.

That said, no measurement exists anywhere of what actually degrades, and by how
much, when effort is lowered on `gpt-5.6-terra`. So this decision rests on "there
is no basis to lower them", not on "medium is correct" — and it reopens if
measurement appears.

## Per-platform notes

- **claude** — does not use `model-map`. The frontmatter values `opus` and
  `sonnet` are already valid, so no substitution is needed.
- **codex** — the `model` key in a role TOML beats the model given by the session
  or CLI. The deployed value is the value at run time.
- **opencode** — no agents deploy here (`feature-platforms.agents` in
  `config.yaml` is `[claude, codex]`). The `model-map` stays declared anyway:
  without it the tier string survives verbatim and an unresolvable value would
  deploy silently, whereas with it `assertMappedTier` turns that into a named
  failure.
