# Repository Guidelines

## Project Structure & Module Organization

- `skills/`: Skill definitions (each in its own folder, typically `skills/<name>/SKILL.md`; some include `tests/` docs).
- `agents/`: Sub-agent prompt definitions used for delegation (e.g., `agents/oracle.md`).
- `commands/`: Slash-command docs (e.g., `commands/hud.md`).
- `hooks/`: Claude Code lifecycle hooks (`*.sh`) plus `hooks/test/` for shell-based tests.
- `scripts/`: Sync/validation tooling and utilities.
- `src/`: TypeScript source packages:
  - `src/hooks/persistent-mode/`: Stop-hook TypeScript package.
  - `src/hooks/skill-catalog/`: Skill catalog hook.
  - `src/lib/`: Shared TypeScript helpers used by scripts/hooks.
  - `src/scripts/hud/`: TypeScript HUD package (deployed as directory via sync).
- `projects/`: Project-specific overrides (e.g., `projects/<project>/skills/<skill>/SKILL.md`).
- Local/runtime artifacts: `.omt/` (state) and `.claude/` are ignored by git.

## Build, Test, and Development Commands

- `make validate`: Validate `sync.yaml` (schema + component existence).
- `make sync-dry`: Preview sync changes without writing to the target project.
- `make sync`: Apply sync to the target project configured in `sync.yaml:path`.
- `bash scripts/test/sync_test.sh`: Run the sync orchestrator’s bash test suite.
- `bash hooks/keyword-detector_test.sh`: Run hook-specific shell tests (see `hooks/test/` for more).
- `bun test`: Run all TypeScript tests (HUD + shared library).

Prereqs commonly needed: `bash` (macOS bash 3.2 compatible), `yq`, `jq`, `bun`, `python3`.

## Coding Style & Naming Conventions

- Bash: use `set -euo pipefail`, quote variables, avoid non-portable bash features, and keep scripts deterministic.
- TypeScript: ESM modules; prefer small, testable functions. No build step required — bun runs `.ts` natively.
- YAML: 2-space indentation; keep examples readable.
- Naming: `skills/<greek-name>/`, `agents/<name>.md`, `hooks/<event-or-purpose>.(sh|js|py)`.

## Testing Guidelines

- Shell tests are standalone scripts; use `mktemp -d` and clean up to avoid leaking artifacts.
- TypeScript tests use bun:test (`*.test.ts`) under `src/scripts/hud/` and `src/lib/`.

## Commit & Pull Request Guidelines

- Match existing history: imperative subject with an optional prefix like `add:`, `fix:`, `refactor:`, `update:` (sometimes scoped like `spec-review:`).
- Keep the subject short (≈50 chars) and commits atomic (one logical change).
- PRs: explain intent, list affected components (skills/agents/hooks/scripts), and include screenshots or sample output for HUD/statusLine changes.

## Security & Configuration Tips

- `sync.yaml:path` is machine-specific; don’t commit personal absolute paths in PRs.
- Hooks execute locally in your Claude Code environment—review changes carefully before enabling them via sync.
