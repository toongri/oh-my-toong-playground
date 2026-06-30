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
make sync               # Deploy to target projects (runs validate + tests first)
```

### Running Individual Tests

```bash
bash hooks/keyword-detector_test.sh        # Single shell test (colocated next to source)
bun test tools/                            # Sync orchestrator tests
bun test                                   # All TypeScript tests
```

### Prerequisites

`bun`, `bash` (macOS 3.2 compatible)

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

**Per-platform YAML** (`{platform}.yaml`): Colocated with `sync.yaml`, inheriting its `path`. Manages config/hooks/mcps/plugins per platform — separate from `sync.yaml` which handles component deployment only (agents, commands, skills, scripts, rules).

> **Note**: `mcps/` directory is deprecated. MCPs are now defined inline in per-platform YAML files.

**Adapters** (`tools/adapters/`): Each platform has its own adapter that handles directory layout differences.

| Platform | Target dir | Supported categories | Notes |
|----------|-----------|---------------------|-------|
| claude | `.claude/` | agents, commands, skills, scripts, rules | Full native support |
| gemini | `.gemini/` | commands, skills, scripts | Hooks/config via syncPlatformYaml |
| codex | `.codex/` | skills, scripts, hooks | Hooks/config via syncPlatformYaml |
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
- **persistent-mode/**: Prevents stopping when work remains incomplete (Stop hook, TypeScript directory)
- **pre-tool-enforcer.sh**: Tool execution gate (TaskOutput blocking)

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
