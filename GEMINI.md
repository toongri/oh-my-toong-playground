# Oh My Toong

**Repository for Claude Code Skills and Agent Configurations**

## Project Overview

`oh-my-toong` is a framework for **Agentic Development**, designed to enhance AI-assisted software engineering. It provides specialized skills, agents, commands, and hooks that enforce a structured workflow where different "agents" handle distinct phases of development: design, planning, and execution.

### Core Philosophy

- **Separation of Concerns**: specialized agents collaborate to ensure quality and prevent hasty implementation.
- **Agent Roles**:
    - **Spec**: Handles software specifications and requirements.
    - **Prometheus**: Strategic planning consultant. **Never writes code.**
    - **Sisyphus**: Task orchestrator. Delegates execution to sub-agents.
    - **Oracle**: Architecture and debugging advisor. Read-only access.
    - **Sisyphus-Junior**: The "hands-on" implementer who writes the code.

## Directory Structure

- **`skills/`**: Contains `SKILL.md` files defining methodologies for specific tasks (e.g., `prometheus`, `sisyphus`, `git-master`).
- **`agents/`**: Defines sub-agents and their personalities/constraints.
- **`commands/`**: Custom slash commands (e.g., `/hud`, `/ralph`).
- **`hooks/`**: Scripts triggering on session events (e.g., `session-start.sh`, `keyword-detector.sh`).
- **`projects/`**: Project-specific skill overrides and configurations.
- **`scripts/`**: Utility scripts for validation and synchronization.

## Usage & Management

This project uses `make` to validate and sync configurations to your local environment.

### Key Commands

- **Sync Configuration**:
  Applies the configurations defined in `sync.yaml` to the target project.
  ```bash
  make sync
  ```

- **Dry Run**:
  Previews the changes that would be made during a sync.
  ```bash
  make sync-dry
  ```

- **Validation**:
  Validates the schema and ensures all referenced components exist.
  ```bash
  make validate
  ```
  *(Includes `make validate-schema` and `make validate-components`)*

### Configuration

- **`sync.yaml`**: The main entry point. Defines the target project path and which skills/agents/hooks to install.
- **`config.yaml`**: Global settings.

## Development Conventions

### Naming & Style
- **Agents/Skills**: Named after Greek mythology to reflect their roles (e.g., Metis for analysis, Momus for critique).
- **Commits**: Messages should be in **Korean**, end with a noun, and be atomic.
- **Testing**: Test display names in Korean; method names in English.

### Workflow Principles
1.  **Plan First**: Use `Prometheus` to generate a plan (`.omt/plans/*.md`) before any code is written.
2.  **Orchestrate**: Use `Sisyphus` to execute the plan. Sisyphus delegates the actual coding to `Sisyphus-Junior`.
3.  **Verify**: Use `Oracle` or `Code-Reviewer` to validate changes.
4.  **Ralph Loop**: A mechanism (`/ralph`) to enforce iterative work until a strict definition of done is met.

### Modifying the Framework
- **New Skills**: Add a new directory in `skills/` with a `SKILL.md`.
- **New Agents**: Add a Markdown definition in `agents/`.
- **Project Overrides**: Place custom skills in `projects/<project-name>/skills/` to override defaults without changing the core framework.
