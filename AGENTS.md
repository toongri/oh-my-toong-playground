# Repository Guidelines

## Project Structure & Module Organization

- `skills/`: Skill definitions (each in its own folder, typically `skills/<name>/SKILL.md`; some include `tests/` docs).
- `agents/`: Sub-agent prompt definitions used for delegation (e.g., `agents/oracle.md`).
- `commands/`: Slash-command docs (e.g., `commands/hud.md`).
- `hooks/`: Claude Code lifecycle hooks (`*.sh`) with colocated shell tests (`*_test.sh`).
- `lib/`: Shared TypeScript helpers used by scripts/hooks.
- `scripts/`: Deployed script packages (hud, chunk-review, spec-reviewer).
- `tools/`: Internal sync/validation tooling (not deployed).
- `projects/`: Project-specific overrides (e.g., `projects/<project>/skills/<skill>/SKILL.md`).
- Local/runtime artifacts: `~/.omt/{OMT_PROJECT}/` (state, in home directory) and `.claude/` are ignored by git.

## Build, Test, and Development Commands

- `make validate`: Validate `sync.yaml` (schema + component existence).
- `make sync-dry`: Preview sync changes without writing to the target project.
- `make sync`: Apply sync to the target project configured in `sync.yaml:path`.
- `bash tools/sync_test.sh`: Run the sync orchestrator’s bash test suite.
- `bash hooks/keyword-detector_test.sh`: Run hook-specific shell tests (colocated next to source).
- `bun test`: Run all TypeScript tests (HUD + shared library).

Prereqs commonly needed: `bash` (macOS bash 3.2 compatible), `yq`, `jq`, `bun`, `python3`.

## Coding Style & Naming Conventions

- Bash: use `set -euo pipefail`, quote variables, avoid non-portable bash features, and keep scripts deterministic.
- TypeScript: ESM modules; prefer small, testable functions. No build step required — bun runs `.ts` natively.
- YAML: 2-space indentation; keep examples readable.
- Naming: `skills/<greek-name>/`, `agents/<name>.md`, `hooks/<event-or-purpose>.(sh|js|py)`.

## Testing Guidelines

- Shell tests (`*_test.sh`) are colocated next to their source files; use `mktemp -d` and clean up to avoid leaking artifacts.
- TypeScript tests use bun:test (`*.test.ts`) under `scripts/hud/` and `lib/`.

## Commit & Pull Request Guidelines

- Match existing history: imperative subject with an optional prefix like `add:`, `fix:`, `refactor:`, `update:` (sometimes scoped like `spec-review:`).
- Keep the subject short (≈50 chars) and commits atomic (one logical change).
- PRs: explain intent, list affected components (skills/agents/hooks/scripts), and include screenshots or sample output for HUD/statusLine changes.

## Security & Configuration Tips

- `sync.yaml:path` is machine-specific; don’t commit personal absolute paths in PRs.
- Hooks execute locally in your Claude Code environment—review changes carefully before enabling them via sync.
