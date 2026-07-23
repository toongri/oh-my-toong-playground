# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

oh-my-toong is a multi-AI skills and configuration management system. It defines skills, agents, hooks, and commands as source-of-truth components, then syncs them to target projects for Claude Code, Gemini CLI, and Codex CLI via a declarative `sync.yaml` format. Greek mythology naming convention.

## Development Commands

```bash
make validate           # Schema + components + TypeScript typecheck
make validate-schema    # YAML schema validation only
make validate-components # Referenced file/directory existence check
make typecheck          # TypeScript strict type-check (tsc --noEmit)
make test               # Run all tests (Shell + TypeScript)
make sync-dry           # Preview sync changes (no writes)
make sync               # Deploy to target projects (requires default branch + clean tree; runs validate + tests first)
```

`make sync` refuses to run unless the current branch is this repo's default branch and the working tree is clean (no staged, unstaged, or untracked changes) — commit first, then sync. There is no supported env var or CLI flag to bypass this gate, and it should not be worked around. `make sync-dry` is exempt from this gate since it only previews and writes nothing. See `docs/sync-deploy-targets.md` for the full gate mechanics and known scope.

### Running Individual Tests

```bash
bash hooks/keyword-detector_test.sh        # Single shell test (colocated next to source)
bun test tools/                            # Sync orchestrator tests
bun test                                   # All TypeScript tests
```

### Prerequisites

`bun`, `bash` (macOS 3.2 compatible), `jq`

`jq` is a runtime prerequisite, not just a dev tool: the shipped hooks parse their
payloads with it and **fail open (no guard) when it is absent** — including the
session-ledger write guard and the code-review artifact identity guard below. macOS
15+ ships it in the base system at `/usr/bin/jq`; older macOS needs it installed.

## Architecture

### Directory Layout

```
oh-my-toong/
├── skills/          # Skill definitions (each: skills/<name>/SKILL.md)
├── agents/          # Subagent prompt definitions (<name>.md)
├── commands/        # Slash command definitions (<name>.md)
├── hooks/           # Session lifecycle scripts (sh/js/py)
├── rules/           # Behavioral rules synced as .claude/rules/
├── lib/             # Shared TypeScript helpers (ESM, bun:test)
├── scripts/         # Deployed script packages (hud, chunk-review)
├── tools/           # Internal sync/validation tooling (not deployed)
│   ├── adapters/    # Platform adapters (claude.ts, gemini.ts, codex.ts, opencode.ts)
│   └── lib/         # Shared TypeScript modules for sync tools
├── projects/        # Project-specific overrides (skills, hooks per project)
├── config.yaml      # Global defaults (use-platforms, feature-platforms, backup retention)
├── claude.yaml      # Per-platform config (config/hooks/mcps/plugins)
├── gemini.yaml      # Per-platform config (config/hooks/mcps)
├── codex.yaml       # Per-platform config (config/mcps/model-map)
├── opencode.yaml    # Per-platform config (config/mcps/model-map)
└── sync.yaml        # Root sync definition (+ projects/*/sync.yaml per project)
```

### Sync System (Core Feature)

The sync tool (`tools/sync.ts`) reads `sync.yaml` files and deploys components to target project directories (`.claude/`, `.gemini/`, `.codex/`).

**Processing order**: `projects/*/sync.yaml` first (project-specific), then root `sync.yaml` (skips already-processed paths).

**sync.yaml format** (object with `items` array):
```yaml
path: /path/to/target/project
format: "pnpm exec prettier --write"   # Optional: post-deploy format pass (see below)
agents:
  items:
    - oracle                           # String shorthand
    - component: sisyphus-junior       # Object with options
      add-skills: [testing]            # Inject skills into agent frontmatter
skills:
  items:
    - prometheus
    - component: my-project:testing    # Scoped: projects/my-project/skills/testing/
      platforms: [claude]              # Per-item platform override
```

**Platform resolution priority**: item-level > section-level > sync.yaml top-level > `config.yaml` feature-platforms > `config.yaml` use-platforms > hardcoded `[claude]`

**Component resolution** (scoped, upward search):
- Root `sync.yaml`: global paths only (`skills/`, `agents/`, etc.)
- Project `sync.yaml`: own project first (`projects/<name>/skills/`), then global fallback. Cross-project references are blocked.

**Post-deploy format** (top-level `format: "<command>"` or `format: ["<arg>", …]`): Optional. Accepts either a string (whitespace-tokenized — the simple case, no shell quoting) or an argument array used verbatim as argv (for arguments that contain spaces, e.g. a config path). When declared, each worktree's deploy runs the command once at the target cwd (`deployRoot`) after all components land, so deployed `.md` (notably CJK tables) arrives already in the target's own formatter normal form — eliminating the ping-pong churn (fake diff) that otherwise appears every sync when the target's prettier reformats OMT-raw bytes on commit/CI. Only OMT-managed roots are passed to the formatter (existing platform dirs + per-name codex skill dirs under `.agents/skills/` + deployed docs leaf files) — never `.`/the whole repo; the target's own `.prettierignore`/`.prettierrc` decides the actual targets within those roots. A format failure (non-zero exit or missing binary/ENOENT) routes that worktree to `failedTargets` for a non-zero exit (same best-effort fan-out as a deploy failure); `--dry-run` skips the format pass. See `docs/sync-deploy-targets.md`.

**Per-platform YAML** (`{platform}.yaml`): Colocated with `sync.yaml`, inheriting its `path`. Manages config/hooks/mcps/plugins per platform — separate from `sync.yaml` which handles component deployment only (agents, commands, skills, scripts, rules). Config/hooks/mcps deep-merge into the target's gitignored `.claude/settings.local.json` (global sync uses `settings.json`); see `docs/platform-yaml-config-deployment.md` for the deployment target and the two-layer gitignore mechanism (why a personal absolute path is safe in `claude.yaml`, not just `claude.local.yaml`).

> **Note**: `mcps/` directory is deprecated. MCPs are now defined inline in per-platform YAML files.

**Adapters** (`tools/adapters/`): Each platform has its own adapter that handles directory layout differences.

| Platform | Target dir | Supported categories | Notes |
|----------|-----------|---------------------|-------|
| claude | `.claude/` | agents, commands, skills, scripts, rules | Full native support |
| gemini | `.gemini/` | commands, skills, scripts | Hooks/config via syncPlatformYaml |
| codex | `.codex/` | agents, skills, scripts, hooks | Agents: md→toml translate (leaf-guard injected); Hooks/config via syncPlatformYaml |
| opencode | `.opencode/` | agents, commands, skills, scripts, rules | Hooks not supported |

### Core Skills

| Skill | Purpose | Key Constraint |
|-------|---------|----------------|
| prometheus | Strategic planning consultant | Planner only - NEVER implements |
| sisyphus | Task orchestrator | Delegates via subagents - orchestrates, doesn't solo |
| sisyphus-junior | Focused executor | Works ALONE - no delegation, strict todo discipline |
| momus | Work plan reviewer | Ruthlessly critical - catches gaps before implementation |
| diagnose | Architecture/debugging advisor | READ-ONLY consultant - diagnoses, never implements |
| clarify | Requirements clarification | MANDATORY gate before implementation |
| git-master | Git conventions (commits + branch naming) | Korean messages, 50-char limit, atomic commits |
| agent-council | Multi-AI advisory body | For trade-offs and subjective decisions |
| qa | Quality Assurance verification | Comprehensive quality verification - nothing escapes |

### Hooks

- **session-start.sh**: Restores persistent mode states (goal, incomplete todos)
- **keyword-detector.sh**: Detects keywords (ultrawork/uw, think, search, analyze) and injects mode context
- **persistent-mode/**: Claude Stop-hook adapter — prevents stopping when work remains incomplete. Decision logic (`makeDecision`) lives in `lib/persistent-mode-core/`, shared with the Codex adapter below.
- **codex-persistent-mode/**: Codex Stop/PostToolUse adapter over the same shared `makeDecision` core.
- **pre-tool-enforcer.sh**: Claude PreToolUse gate — TaskOutput blocking, the session-ledger write guard, skill-state single-creation-point seeding, and (new) the code-review artifact identity guard below. Wired via root `claude.yaml`'s `PreToolUse` (already global; no registration work needed).
- **codex-write-guard.sh**: Codex PreToolUse twin of `pre-tool-enforcer.sh` — mirrors its ledger write guard and code-review artifact identity guard over the Codex tool-call payload shape. Wired via root `codex.yaml`'s `PreToolUse` (already global; no registration work needed).
- **write-guard-core.sh**: Shared judgment core both adapters call into — `write_guard_core_run` (session-ledger write guard) and `codereview_guard_core_run` (code-review artifact identity guard, below). Single source of the deny-reason wording for both platforms; the adapters extract payload fields and forward, they never re-derive a verdict.

**Code-review artifact identity guard** (`codereview_guard_core_run` in `write-guard-core.sh`, wired into both adapters above): ultragoal's and goal's completion gates read a code-review artifact (`$OMT_DIR/ultragoal-codereview-{sid}.json`, `$OMT_DIR/goal-codereview-{sid}.json`) and let it unblock completion, but never verified who wrote it — the orchestrator could write that JSON directly with a Write tool call instead of actually dispatching an independent `code-reviewer` subagent, at the cost of one forged tool call. The guard closes this with a positive whitelist:

```
guarded-path write/delete attempt AND agent_type == "code-reviewer"  → allow (no intervention)
guarded-path write/delete attempt AND anything else (absent or "")   → deny
not a guarded path                                                   → no intervention
```

**Guarded set and negative controls.** The guarded set is exactly two paths: `$OMT_DIR/ultragoal-codereview-{sid}.json` and `$OMT_DIR/goal-codereview-{sid}.json`. Two other paths are deliberately NOT guarded, as fixed negative controls: `$OMT_DIR/ultragoal-verdict-{sid}.json` (the per-story verdict artifact, self-attested by the orchestrator by design — guarding it would block its own normal write path) and `$OMT_DIR/code-review/{sid}/candidates.json` (the review pipeline's own normal output). Both adapters were already globally registered via root `claude.yaml` / `codex.yaml` `PreToolUse` before this change, so no new registration was needed.

**Codex reachability.** Both `goal` and `ultragoal` deploy `platforms: [claude]` in every `sync.yaml` that references them (root `sync.yaml` references both; `projects/oh-my-toong/sync.yaml` references `goal` only), so today NEITHER arm of the Codex branch has a reachable producer — the Codex wiring was prepared ahead of any Codex-side producer, for parity.

**Why `agent_type`, and what carries it.** `agent_type` is the harness's own subagent-dispatch payload field — never agent-controlled `tool_input` — but it is not a subagent-only signal: Claude Code's hook input schema carries it in two shapes, (a) from inside a subagent, alongside `agent_id`, and (b) from the main thread of a session started with `--agent <name>`, without `agent_id`. `agent_id` is the field the schema itself says to use to tell subagent calls from main-thread calls apart — it is present only inside a subagent and absent even on a `--agent` main thread. This guard keys on `agent_type`, not `agent_id`, because Codex's payload carries no subagent-identity field at all: `agent_type` is the only field name both platforms can share for one identical judgment formula. Absence still denies — not because a main-thread call "never carries `agent_type`" (per above, it can), but because treating absence as allow would let an ordinary orchestrator forge the artifact directly at zero extra cost (fail-closed).

**Known unclosed residual risks, by design:**
- **Prompt content is not checked.** The guard verifies *who* wrote the artifact, not *on what basis* — an orchestrator that dispatches a real `code-reviewer` subagent with a prompt telling it to skip the review and just write the artifact still passes `agent_type` and is allowed through, with no structural check on prompt content.
- **The candidate extractor is a fixed whitelist.** The Claude adapter recognizes only the file tools' `file_path` and a fixed whitelist of shell write-vectors in a Bash command (redirect targets, `tee`/`rm`/`truncate`, `dd of=`, `sed -i`, `cp`/`mv`); the Codex adapter's extractor covers a broader set of its own command shapes but is likewise a fixed, finite whitelist, not an open-ended parser. Either way, any command shape neither recognizes is invisible to it even when the guarded path appears as a literal argv string. Bash variable indirection (e.g. `p=goal-codereview; ... > "$OMT_DIR/$p-$SID.json"`) is one instance, where the guarded path never appears as a literal string at all; routing that same literal path through an interpreter the whitelist doesn't recognize (`bun -e '...'`, `python3 -c '...'`) is a more direct instance — the path is present verbatim in argv, but the extractor still yields zero candidates. No finite static rule closes this without false-denying ordinary commands, like `verify-entrypoint-gate` below.
- **A `--agent code-reviewer` main-thread session bypasses the guard.** Per the trust-channel paragraph above, such a session's orchestrator carries `agent_type: "code-reviewer"` on its own main-thread tool calls too, with no `agent_id` present to tell the two apart — so it passes the guard on every guarded-path write without ever dispatching an independent reviewer. Tightening the check to also require `agent_id` was considered and rejected: this guard has no bypass or `ask` escape hatch, so a false deny would be unrecoverable for the user, and that risk was not taken without observing a real code-reviewer dispatch's own payload.
- **scripts/verify-entrypoint-gate/**: PreToolUse Bash gate engine — deny-or-no-intervention only; no path ever issues `permissionDecision: "allow"` (memory-cap injection was removed entirely as dead code — the target repo's own inline caps already overrode anything injected). Allowed entrypoints are the runtime intersection of the policy YAML and the target repo's root `package.json` scripts, so a dead policy name auto-drops and a new risky repo script stays blocked until whitelisted. Only one command shape passes: `pnpm <entrypoint> [<app>] [<allowed_turbo_opts>] [-- <runner selector>]` — pre-script flags (`-r`, `--filter`, `-F`) are rejected since pnpm would intercept them and bypass the repo's `verify.sh`, while post-`--` flags pass only through the `allowed_turbo_opts` whitelist. Fail-closed on workspace-root resolution (walks up from `cwd` for `pnpm-workspace.yaml`; denies if not found or `cwd` isn't the root) and denies any compound command (`&&`/`||`/`|`/`;`/newline/backtick/`$()`). Policy is two-layer: base loads next to the script itself (`import.meta.url`), project overlay loads from the **target workspace root**'s `.claude/scripts/verify-entrypoint-gate/verify-entrypoint-gate.local.yaml`. Lives under `scripts/` (not `hooks/`): deployed globally as a single script package (`$HOME/.claude/scripts/verify-entrypoint-gate/`, no registration) via the root `sync.yaml` scripts section, then registered as a hook **only in algocare-home** through a raw `command:` in `projects/algocare-home/claude.yaml` that references that global path. Known unclosed residual risk, by design: shell variable/parameter expansion (e.g. `pnpm${IFS}test --all`) is invisible to this file since it only ever sees literal argv text, and no finite static rule can close it without false-denying ordinary commands (e.g. `$EDITOR notes.md`) — with no bypass/`ask` escape hatch in this gate, such a false deny would be unrecoverable for the user.

### Key Workflows

**Ultrawork Mode** (`ultrawork`, `ulw`, `uw` keywords):
- Maximum precision mode with parallel agent utilization
- Activated via keyword detection (1-time context injection per message)

## Coding Conventions

- **Bash**: `set -euo pipefail`, macOS Bash 3.2 compatible (no associative arrays, no `declare -A`), quote all variables
- **TypeScript**: ESM modules, bun:test for testing. No build step required.
- **YAML**: 2-space indentation
- **Naming**: `skills/<greek-name>/`, `agents/<name>.md`, `hooks/<purpose>.(sh|js|py)`
- **Shell tests**: Colocated next to source files with `_test.sh` suffix (e.g., `hooks/keyword-detector_test.sh`); use `mktemp -d` with cleanup
- **TypeScript tests**: Colocated next to source files with `.test.ts` suffix (e.g., `tools/sync.test.ts`); use bun:test

## Critical Patterns

### Skill Invocation
Skills are invoked via the Skill tool, not by reading files directly:
```
Skill(skill: "prometheus")  // Correct
Read("skills/prometheus/SKILL.md")  // Wrong
```

### Subagent Selection

| Need | Agent |
|------|-------|
| Architecture/debugging analysis | oracle |
| Codebase search | explore |
| External documentation | librarian |
| Code implementation | sisyphus-junior |
| Pre-planning analysis | metis |
| Plan review | momus |
| Quality Assurance | qa skill |

### sync.yaml Paths Are Machine-Specific

`sync.yaml:path` contains absolute paths to target projects. These are local to each developer's machine — do not commit personal paths in PRs.

### Cache-Safe Context Injection

Hook and skill authors who emit injected context (SessionStart stdout, keyword-detector payloads, skill `` !`command` `` macro output) MUST follow these constraints. The goal: bytes that land in the PREFIX segment of the conversation must be session-invariant so the KV cache is not evicted on every new session. A single varying byte anywhere in the prefix evicts the entire downstream cache.

- **No per-request volatile values in PREFIX-position injected context.** Timestamps, PIDs, ephemeral counters, or any value that changes between requests must not appear in context injected into the conversation prefix.

- **Sort collections (deterministic ordering) before emitting.** Any list, set, or map serialized into injected context must be sorted before output. Insertion-order or filesystem-order enumerations are non-deterministic across sessions and defeat caching.

- **Session-varying values: coarsen OR use a static state-file pointer.** If a value legitimately varies by session but must appear in injected context, either coarsen it to a stable category (e.g., a count bucket rather than an exact count), or emit a static shell read command — `cat "$OMT_DIR/<state>-$OMT_SESSION_ID.json"` — with a run-now imperative. The pointer string itself is static; the actual read happens in TAIL position, not PREFIX.

- **SessionStart stdout = static; route dynamic/volatile data to stderr or on-demand reads.** The SessionStart hook's stdout is injected directly into the conversation prefix. Keep it fully static. Emit diagnostic or session-varying information to stderr (logged, not injected) or defer it to an on-demand read instruction executed later in the conversation body.

- **Skill-body `` !`command` `` macro output must be deterministic + session-invariant.** Command substitutions embedded in SKILL.md via the `` !`...` `` macro are evaluated at skill-load time and injected into the prefix. Their output must be bit-for-bit identical across sessions; any path, timestamp, or environment-specific value disqualifies a command from macro use.

#### Accepted unavoidable

These items deviate from the constraints above but are retained because fixing them would break correctness or routing:

- **(i) Small-handoff payload** — Compaction already cold-starts the prefix, so marginal cache loss at the handoff boundary is zero. The size threshold governing this payload is a capacity axis (the `additionalContext` field cap), not a cache axis. Accepted as-is.

- **(ii) rules-injector `targetRelativePath` / post-compact paths** — Codex resolves tool paths per-tool and per-compact; the path values are data-driven and must reflect the actual runtime location. Static-izing them would break routing. Accepted as session-specific by necessity.

- **(iii) Pin count/location** — Pin data is determined by actual filesystem state at session start. The values are data-driven and deterministic given identical pin state, not per-request volatile. Accepted as data-driven deterministic.

- **(iv) `decision.ts` Stop-reason numbers** — These values appear in TAIL-position (the Stop hook output), not in the conversation prefix. Tail-position content has zero cache impact. Retained for behavioral signal.

#### Harness assumption

`CLAUDE_ENV_FILE` exports (`OMT_DIR`, `OMT_SESSION_ID`) reach the agent's Bash-tool environment at runtime. Hook round-trip acceptance criteria verify hook write/emit consistency only — the "Claude Code sources the env file so agent Bash tools see these variables" leg is a documented assumption, not something the OMT test suite verifies.

## Language Conventions

- **Commit messages**: Korean (한국어) with 명사형 종결
- **DisplayNames in tests**: Korean
- **Method names in tests**: English with backticks
- **Council prompts**: English (for cross-model consistency)

## Dependency Management

OMT minimizes external dependencies to stay auditable and portable across the runtimes it targets (bun, node). Reach for the simplest option first.

### Dependency Ladder

1. **Builtin first** — use a bun/node builtin with no added dependency. See Tier-0 allowlist below.
2. **Declared package** — add the package to `package.json` (`dependencies` or `devDependencies`) and write a plain bare `import 'pkg'` in source. `make sync` handles the rest at sync-time (see below).

There is no installable npm package — OMT is not published to a registry.

### Tier-0 Builtin Allowlist

These are pre-approved — use them without reaching for a dep:

- `Bun.YAML` — YAML parse/serialize (requires bun ≥ 1.2.21)
- `fetch` — HTTP requests
- `crypto.randomUUID` — UUID generation
- `util.parseArgs` — CLI argument parsing
- `fs.glob` — file globbing
- `module.builtinModules` — querying available builtins

### Sync-Time Auto-Vendoring

No vendor artifacts are committed to this repository. Instead, `make sync` bundles each declared bare dependency at sync-time:

1. For every bare `import 'pkg'` found in a deployed script, the sync tool checks that `pkg` is declared in the root `package.json`.
2. At sync-time, it runs `bun build --target=node` to produce `lib/vendor/<pkg>.js` inside each deploy target and rewrites that copy's import to a relative path. OMT source files are never mutated.
3. Integrity rests on the committed `bun.lock` (version pins + sha512 checksums) enforced by `bun install --frozen-lockfile` — no separate byte-drift manifest is needed.

### Guards

Enforcement is wired into the make targets — do not reimplement inline:

- **Bare-import guard** (`make validate`): scans the deployed surface — `lib/` and the component dirs (`hooks/`, `skills/`, `scripts/`, `agents/`, `commands/`, `rules/`), plus `projects/*/` equivalents — and rejects a bare `import 'pkg'` for a package NOT declared in `package.json`. `tools/` is exempt (npm imports are legal there, where `node_modules` exists), and `*.test.ts` / `*.d.ts` files are skipped. A declared package passes; a sub-path import of a declared package is still rejected.
- **`bun.lock` integrity**: version pins and sha512 checksums are committed; `bun install --frozen-lockfile` enforces them.

### Cross-Runtime Caveat

Scripts reachable by codex or gemini must restrict themselves to cross-runtime builtins (i.e., Node.js built-in modules that also run under bun). Packages bundled at sync-time use `--target=node` so they execute under both runtimes.

### Non-Goals

- No committed vendor bundles in source — bundles are generated at sync-time into deploy targets only.
- No committed `node_modules` — builtins first, declared packages second.
- No install-at-runtime in production — `bun install --frozen-lockfile` runs at build/CI time, not at agent invocation time.
