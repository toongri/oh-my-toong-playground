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
├── scripts/         # Deployed script packages (hud, chunk-review, spec-reviewer)
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
| codex | `.codex/` | skills, scripts | Hooks/config via syncPlatformYaml |
| opencode | `.opencode/` | agents, commands, skills, scripts, rules | Hooks not supported |

### Core Skills

| Skill | Purpose | Key Constraint |
|-------|---------|----------------|
| prometheus | Strategic planning consultant | Planner only - NEVER implements |
| sisyphus | Task orchestrator | Delegates via subagents - orchestrates, doesn't solo |
| sisyphus-junior | Focused executor | Works ALONE - no delegation, strict todo discipline |
| momus | Work plan reviewer | Ruthlessly critical - catches gaps before implementation |
| oracle | Architecture/debugging advisor | READ-ONLY consultant - diagnoses, never implements |
| clarify | Requirements clarification | MANDATORY gate before implementation |
| git-master | Git conventions (commits + branch naming) | Korean messages, 50-char limit, atomic commits |
| agent-council | Multi-AI advisory body | For trade-offs and subjective decisions |
| argus | Quality Assurance guardian | Comprehensive quality verification - nothing escapes |

### Hooks

- **session-start.sh**: Restores persistent mode states (ralph-loop, incomplete todos)
- **keyword-detector.sh**: Detects keywords (ultrawork/uw, think, search, analyze) and injects mode context
- **persistent-mode/**: Prevents stopping when work remains incomplete (Stop hook, TypeScript directory)
- **pre-tool-enforcer.sh**: Tool execution gate (TaskOutput blocking)

### Key Workflows

**Ultrawork Mode** (`ultrawork`, `ulw`, `uw` keywords):
- Maximum precision mode with parallel agent utilization
- Activated via keyword detection (1-time context injection per message)

**Ralph Loop**:
- Iterative completion enforcement with oracle verification
- State file at `~/.omt/{OMT_PROJECT}/ralph-state.json` (resolved via `$OMT_DIR` env var)
- Cancel with `/cancel-ralph`

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
| Quality Assurance | argus |

### sync.yaml Paths Are Machine-Specific

`sync.yaml:path` contains absolute paths to target projects. These are local to each developer's machine — do not commit personal paths in PRs.

## Language Conventions

- **Commit messages**: Korean (한국어) with 명사형 종결
- **DisplayNames in tests**: Korean
- **Method names in tests**: English with backticks
- **Council prompts**: English (for cross-model consistency)

## Pending Actions — Next Session (collect-jd)

다음 Claude Code 세션 재시작 시 아래 순서로 수행 필요:

1. **`.claude/skills/collect-jd/` 갱신**: `skills/collect-jd/` 의 최신 내용을 `.claude/skills/collect-jd/` 로 overwrite deploy.
   ```bash
   cp -r skills/collect-jd/* .claude/skills/collect-jd/
   ```
2. **Hot reload**: `Skill(skill: "collect-jd")` invoke 하여 새 SKILL.md (4개 MANDATORY 섹션 + 8-phase) 적용 확인.
3. **Dogfood REFACTOR 검증**: live run 수행
   - 8-phase Phase Task Creation (TaskCreate 8건) 선행
   - Sources Registration (sources.yaml 로드 → 비었으면 등록 제안)
   - Listing Pagination 2-tier (auto-detect → Tier B interview)
   - Crawl-State HWM Ledger (crawl_state atomic 갱신)
   - Storage Backend Interview (config.yaml 존재 시 skip)
   - S23-S26 pressure scenarios 실측 GREEN 전환
4. REFACTOR 결과를 `skills/collect-jd/tests/e2e-dogfood.md` Real Dogfood Evidence 섹션에 append.

**근거 커밋**: `80fdfc3` (S23-S26) + `1922bbe` (4 MANDATORY) + `3c9a502` (Storage Path/Dedup Gate/Phase Task).

완료 시 이 섹션 제거 또는 archive 처리.
