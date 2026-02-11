# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

oh-my-toong is a Claude Code skills and agents configuration repository. It provides structured methodologies, workflow automation, and specialized agent definitions that enhance AI-assisted development. The naming convention draws from Greek mythology.

## Architecture

```
oh-my-toong/
├── skills/          # Task-specific methodologies (SKILL.md files)
├── agents/          # Subagent definitions for Task tool delegation
├── commands/        # Slash command definitions (/prometheus, /sisyphus, etc.)
├── hooks/           # Session lifecycle scripts (shell scripts)
├── projects/        # Project-specific skill overrides
└── settings.json    # Hook configuration
```

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
- **persistent-mode.sh**: Prevents stopping when work remains incomplete (Stop hook)
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

## Project-Specific Skills

The `projects/` directory contains project-specific skill overrides:

- `projects/loopers-kotlin-spring-template/skills/testing/` - Classical TDD testing standards for Kotlin/Spring projects
  - State verification ONLY (no `verify()`)
  - BDD structure with Korean DisplayNames
  - Six test levels: Unit, Integration, Concurrency, Adapter, E2E, Batch

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

## Language Conventions

- **Commit messages**: Korean (한국어) with 명사형 종결
- **DisplayNames in tests**: Korean
- **Method names in tests**: English with backticks
- **Council prompts**: English (for cross-model consistency)
