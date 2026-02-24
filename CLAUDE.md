# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

oh-my-toong is a multi-AI skills and configuration management system. It defines skills, agents, hooks, and commands as source-of-truth components, then syncs them to target projects for Claude Code, Gemini CLI, and Codex CLI via a declarative `sync.yaml` format. Greek mythology naming convention.

## Development Commands

```bash
make validate           # Schema + component validation (all sync.yaml files)
make validate-schema    # YAML schema validation only
make validate-components # Referenced file/directory existence check
make test               # Run all tests (Shell + TypeScript)
make sync-dry           # Preview sync changes (no writes)
make sync               # Deploy to target projects (runs validate + tests first)
```

### Running Individual Tests

```bash
bash hooks/test/keyword_detector_test.sh   # Single shell test
bash scripts/test/sync_test.sh             # Sync orchestrator tests
cd scripts/hud && npm test                 # HUD TypeScript tests
cd scripts/lib && npm test                 # Shared library TypeScript tests
```

### Prerequisites

`yq`, `jq`, `node` (v18+), `bash` (macOS 3.2 compatible)

## Architecture

### Directory Layout

```
oh-my-toong/
├── skills/          # Skill definitions (each: skills/<name>/SKILL.md)
├── agents/          # Subagent prompt definitions (<name>.md)
├── commands/        # Slash command definitions (<name>.md)
├── hooks/           # Session lifecycle scripts (sh/js/py)
├── rules/           # Behavioral rules synced as .claude/rules/
├── scripts/         # Sync tooling, adapters, and utilities
│   ├── adapters/    # Platform adapters (claude.sh, gemini.sh, codex.sh)
│   ├── lib/         # Shared TypeScript helpers (ESM, Jest)
│   ├── hud/         # HUD TypeScript package (builds to scripts/hud.js)
│   └── persistent-mode/  # Stop-hook TypeScript package
├── projects/        # Project-specific overrides (skills, hooks per project)
├── config.yaml      # Global defaults (use-platforms, feature-platforms, backup retention)
└── sync.yaml        # Root sync definition (+ projects/*/sync.yaml per project)
```

### Sync System (Core Feature)

The sync tool (`scripts/sync.sh`) reads `sync.yaml` files and deploys components to target project directories (`.claude/`, `.gemini/`, `.codex/`).

**Processing order**: `projects/*/sync.yaml` first (project-specific), then root `sync.yaml` (skips already-processed paths).

**sync.yaml format** (object with `items` array):
```yaml
path: /path/to/target/project
agents:
  items:
    - oracle                           # String shorthand
    - component: sisyphus-junior       # Object with options
      add-skills: [testing]            # Inject skills into agent frontmatter
hooks:
  items:
    - component: keyword-detector.sh
      event: UserPromptSubmit          # Required: SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Stop|SubagentStop
      timeout: 10
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

**Adapters** (`scripts/adapters/`): Each platform (claude, gemini, codex) has its own adapter that handles directory layout differences. Claude has native support for all categories; Gemini and Codex use fallback strategies for agents/commands.

### Core Skills

| Skill | Purpose | Key Constraint |
|-------|---------|----------------|
| prometheus | Strategic planning consultant | Planner only - NEVER implements |
| sisyphus | Task orchestrator | Delegates via subagents - orchestrates, doesn't solo |
| sisyphus-junior | Focused executor | Works ALONE - no delegation, strict todo discipline |
| momus | Work plan reviewer | Ruthlessly critical - catches gaps before implementation |
| oracle | Architecture/debugging advisor | READ-ONLY consultant - diagnoses, never implements |
| explore | Codebase search | Returns actionable results with absolute paths |
| librarian | External documentation researcher | Searches external docs - NOT internal codebase |
| clarify | Requirements clarification | MANDATORY gate before implementation |
| metis | Pre-planning analysis | Catches missing questions, undefined guardrails |
| git-committer | Git commit workflow | Korean messages, 50-char limit, atomic commits |
| agent-council | Multi-AI advisory body | For trade-offs and subjective decisions |
| argus | Verification guardian | Verifies Junior's work - nothing escapes |

### Hooks

- **session-start.sh**: Restores persistent mode states (ralph-loop, incomplete todos)
- **keyword-detector.sh**: Detects keywords (ultrawork/uw, think, search, analyze) and injects mode context
- **persistent-mode.js**: Prevents stopping when work remains incomplete (Stop hook, Node.js)
- **pre-tool-enforcer.sh**: Tool execution gate (TaskOutput blocking)

### Key Workflows

**Ultrawork Mode** (`ultrawork`, `ulw`, `uw` keywords):
- Maximum precision mode with parallel agent utilization
- Activated via keyword detection (1-time context injection per message)

**Ralph Loop**:
- Iterative completion enforcement with oracle verification
- State file at `.omt/ralph-state.json`
- Cancel with `/cancel-ralph`

**Planning → Execution Flow**:
1. `/prometheus <task>` - Creates work plan in `.omt/plans/*.md`
2. `/sisyphus` - Orchestrates plan execution via subagents
3. `sisyphus-junior` - Executes individual tasks with strict todo discipline

## Coding Conventions

- **Bash**: `set -euo pipefail`, macOS Bash 3.2 compatible (no associative arrays, no `declare -A`), quote all variables
- **TypeScript**: ESM modules, Jest for testing. Rebuild generated output after changes (`npm run build` in `scripts/hud/`)
- **YAML**: 2-space indentation
- **Naming**: `skills/<greek-name>/`, `agents/<name>.md`, `hooks/<purpose>.(sh|js|py)`
- **Shell tests**: Standalone scripts using `mktemp -d` with cleanup; naming convention `*_test.sh` or `test_*.sh`

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
| Task planning | prometheus |
| Code implementation | sisyphus-junior |
| Plan review | momus |
| Code verification | argus |

### sync.yaml Paths Are Machine-Specific

`sync.yaml:path` contains absolute paths to target projects. These are local to each developer's machine — do not commit personal paths in PRs.

## Language Conventions

- **Commit messages**: Korean (한국어) with 명사형 종결
- **DisplayNames in tests**: Korean
- **Method names in tests**: English with backticks
- **Council prompts**: English (for cross-model consistency)
