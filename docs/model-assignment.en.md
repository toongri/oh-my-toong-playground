# Agent Model Assignment

Which model tier each agent gets, and how that tier is substituted into a
concrete per-platform model.

This document exists for a specific reason. The first two principles below were
decided on 2026-06-26 and 2026-07-21, but they lived **only in commit bodies** — and as a
result `hermes` kept its initial value through 2026-07-28 without ever being
reviewed under either one. A principle that is invisible at code-review time does
not get applied.

## Assignment principles

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

### Absence-judgment principle (2026-07-30)

**Within verification and judgment, an agent that judges absence with no mandated
evidence-anchoring procedure runs Fable; otherwise Opus.**

This separates Opus from Fable inside the verification layer the two principles
above carve out. For an agent meeting all four conditions below, the model's
reasoning lands directly on the output.

1. **What is judged is an absence** — the claim is about what is *not* in a set (a
   requirement with no corresponding AC, an unstated scope boundary, an unflagged
   assumption). This is the failure class that passes by checking whether a token
   appears, instead of counting whether the property holds across the whole set.
2. **No mandated evidence anchoring** — the contract has no clause obliging the
   agent to read the references and confirm the claim.
3. **Failures are unobservable** — a question never asked leaves no trace in the
   artifact, so there is nothing to diff.
4. **It is upstream** — its output feeds downstream artifacts, so degradation
   propagates with the trail broken.

Exactly one agent hits all four today: `metis`, and the second condition is what
actually decides the split. See the individual record below for how it was applied.

### When principles conflict, delegation structure wins

Some agents are verification by role but delegation by structure. In that cell,
**delegation structure takes precedence** — Sonnet.

Two agents sit there today: `oracle` and `daedalus`. Each routes through the
delegation engine in `lib/generic-job.ts` via the `diagnose` and `design-review`
skills respectively, and the actual analysis is done by delegated workers. Their
current Sonnet value is this clause applied.

The test: does the verdict the agent returns come from **its own model's
reasoning**, or is it carrying another process's output through? The latter is
delegation. `hermes` is the illustrative case — it looks like it produces its own
verdict, but the verdict actually comes from the `Verdict` enum in
`skills/insane-browsing/engine/validators.py`.

## Current assignment

| Agent | Tier | Rationale |
|---|---|---|
| `code-reviewer` | opus | Judges with its own model |
| `issue-reviewer` | opus | Judges with its own model |
| `metis` | fable | Absence judgment with no mandated evidence anchoring (all four absence-judgment conditions) |
| `momus` | opus | Judges with its own model |
| `tech-claim-examiner` | opus | Judges with its own model |
| `daedalus` | sonnet | Conflict cell — delegation structure wins |
| `oracle` | sonnet | Conflict cell — delegation structure wins |
| `explore` | sonnet | Search |
| `librarian` | sonnet | Search |
| `hermes` | sonnet | Search (depth peer to explore/librarian) |
| `mnemosyne` | sonnet | Generation |
| `sisyphus-junior` | sonnet | Generation |

The single source of truth for an agent's tier is the `model:` field in
`agents/<name>.md` frontmatter.

## The tier vocabulary is three values

`fable`, `opus`, and `sonnet`. It was two until `fable` was added on 2026-07-30, and
the bar for adding one is unchanged — a fourth tier needs evidence that some
assignment can only be expressed with it. "I want this agent somewhere between two
tiers" is not enough.

What cleared that bar for `fable` is the absence-judgment principle, which produces
one assignment that opus cannot express. The tier now differentiates on both deploy
surfaces — `claude-fable-5` vs Opus 5 on claude, `gpt-5.6-sol` vs `gpt-5.6-terra`
on codex (since the 2026-08-04 remap; before it codex had nothing above
`gpt-5.6-sol`, so `fable` and `opus` fell to the same model — the first platform
asymmetry the tier vocabulary had admitted).

## Substituting a tier into a concrete model

Handled by `model-map` in each `{platform}.yaml`.

### `tiers:` is the normal path

```yaml
model-map:
  tiers:
    fable:  { model: gpt-5.6-sol }
    opus:   { model: gpt-5.6-terra, effort: high }
    sonnet: { model: gpt-5.6-luna }
```

**A tier normally sets the model only.** Omitting `effort` leaves
`model_reasoning_effort` out of the emitted role TOML, so each agent runs at
whatever effort the session is configured for rather than a value frozen at sync
time.

`opus` is the one exception (2026-08-11). Every agent on that tier is a judgment
surface — review, diagnosis, plan critique — whose output nobody re-verifies.
Judgment quality must not drop just because the session happens to be running
low/medium, so the tier itself pins `effort: high`.

### `agents:` is only for what a tier cannot express

```
resolveCodexAgentModel: modelMap.agents?.[name] ?? modelMap.tiers[tier]
```

What qualifies for `agents:` is **an agent whose model or effort no tier can
spell** — for instance one needing an effort that is neither its tier's pin nor
the session value.

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

### `metis`, opus to fable (2026-07-30)

Decided by contrast with `momus`. Both were opus and both are the same verification
layer by role, but the structure that produces the judgment differs.

The `metis` contract (`agents/metis.md`) says "Operate with available context
only", with no clause corresponding to `momus`'s Reference Verification
(`skills/momus/SKILL.md`). It holds Read/Glob/Grep/Bash, yet instead of going to
confirm evidence it marks `Unknown + Verification Plan`. Meanwhile all four axes of
its blocking whitelist B1-B4 are absence judgments — a requirement with no
verifiable AC, no stated scope boundary, an AC with no observable end-state plus a
missing `| decider:` clause, and an assumption neither validated nor marked
`Unknown`. Each is a claim about an absence over a set, made with no mandated
anchor. `momus`, by contrast, has MANDATORY Reference Verification, a verdict
decided mechanically by the presence of `[CERTAIN]`, and a wrong `[CERTAIN]`
refuted by the author within one round — its accuracy comes from whether the
reading was actually done, and its errors get detected.

The counter-frame remains. **Blocking authority belongs to momus** — momus is where
a wrong APPROVE releases a defective plan into execution. But that gate's inputs are
mechanically checkable facts (does the file exist, does it contain what was
claimed), while the judgments that cannot be checked mechanically sit in metis.

The alternative of fixing the contract instead of raising the tier — making metis's
absence findings enumerate the set they inspected and state `file:line` or "no
corresponding AC" per item, turning token lookup into counting — was considered in
the same sitting, and the tier raise was chosen. The two interventions are not
mutually exclusive.

Three items left unresolved.

- **Landing unverified.** See the claude entry under "Per-platform notes" below;
  post-deploy measurement is required. The binary also carries the strings
  `fableCreditsRequired`, `fableOverageConsentV2`, and `fableConsentSessionFallback`,
  which suggests a separate credits/consent flow with a fallback path — how that gate
  behaves on subagent spawn was not checked.
- **Org data-retention setting.** Fable 5 requires 30-day retention, and in a
  zero-data-retention org every request becomes `400 invalid_request_error`. This
  org's setting was not verified.
- **Refusal classifier.** Fable 5's safety classifier can refuse a request
  (`stop_reason: "refusal"`). metis's input is plan/spec text, so it is less exposed
  than the code-review family, but its behavior when reviewing a security-shaped plan
  is unmeasured.

### `hermes`, opus to sonnet (2026-07-28)

Its creating commit `a5bc1235` (2026-06-25) predates the generation-versus-
verification decision by one day, and commit `986494ad`, which applied the
delegation-structure principle, touched only `agents/daedalus.md` and
`agents/oracle.md` — never putting `hermes` up for review. It was an initial value
that had passed neither principle, and its creating commit body records no reason
for choosing opus.

Its role is depth peer to `explore` (codebase) and `librarian` (external docs),
taking over when they hit a wall — the search family. Both peers are sonnet. Its
verdict comes from the `Verdict` enum in
`skills/insane-browsing/engine/validators.py`, not from its own model.

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

- **claude** — does not use `model-map`. The frontmatter values `fable`, `opus`, and
  `sonnet` are already valid, so no substitution is needed. The `fable` alias was
  confirmed to sit in the same alias table as `opus`/`sonnet` in the CLI 2.1.220
  binary, but whether that table is also used on the agent-frontmatter path cannot be
  settled by static inspection. The only way to confirm landing is to dispatch metis
  after deploy and observe which model ran.
- **codex** — the `model` key in a role TOML beats the model given by the session
  or CLI. The deployed value is the value at run time. The three tiers resolve to
  `gpt-5.6-sol` (`fable`), `gpt-5.6-terra` (`opus`), and `gpt-5.6-luna` (`sonnet`)
  respectively — deleting any tier from `codex.yaml` makes `assertMappedTier`
  hard-fail the codex deploy of every agent on that tier (e.g. deleting `fable`
  fails `metis`).
- **opencode** — no agents deploy here (`feature-platforms.agents` in
  `config.yaml` is `[claude, codex]`). The `model-map` stays declared anyway:
  without it the tier string survives verbatim and an unresolvable value would
  deploy silently, whereas with it `assertMappedTier` turns that into a named
  failure.
