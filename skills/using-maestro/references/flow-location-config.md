# Flow Location Config — Per-Project Resolution

This file defines how the `using-maestro` skill resolves the flow directory for each project. The mechanism replaces "always `.maestro/` at repo root" with a per-project decision recorded once and reused everywhere.

## Why This Exists

The right flow location depends on context:

- **Team-shared, PR-reviewed apps** → `.maestro/` committed at repo root
- **Worktree-heavy individual workflow** → external directory shared across all worktrees of the same repo
- **Multi-app shared subflows** → external directory referenced by multiple projects

A skill that hardcodes one answer wins one context and loses the others. Instead, the skill records the choice once per project and resolves it before every Maestro operation.

## Layout

The design splits config (XDG-compliant) from data (Maestro-convention):

```
~/.config/maestro/                # config — we are the only consumer
  <id>/
    config.yaml                   # per-project skill config (flat YAML)

~/.maestro/                       # data — Maestro CLI also lives here
  projects/                       # ← namespace fence against future CLI dirs
    <id>/
      flows/                      # = resolved flow_dir (external mode default)
        common/
        auth/
        sleep/
        screenshots/              # assertScreenshot baselines (requires separate backup)
  tests/                          # ← Maestro CLI's own debug bundles, untouched
  …                               # ← future CLI-owned directories
```

The asymmetry is intentional: `~/.config/maestro/` is uncontested so we flatten; `~/.maestro/` is shared with Maestro CLI so we fence with `projects/`.

## Resolution Algorithm

Run before every Maestro operation:

1. **Env var override.** If `MAESTRO_USING_FLOW_DIR` is set, use it verbatim. (CI escape hatch — no interview, no config write, no resolution.)
2. **Find project root.** `git rev-parse --show-toplevel`; fall back to `$PWD` if not in a git repo.
3. **Derive project ID.**
   - Try `git -C "$root" remote get-url origin`.
   - Slug = last `/`- or `:`-separated segment, with `.git` stripped.
   - No git remote → `basename "$root"`.
4. **Read config.** Look up `~/.config/maestro/<id>/config.yaml`.
5. **Found** → read `flow_dir` value:
   - Absolute path (`/...`) → use as-is.
   - `~/`-prefixed → expand `$HOME`.
   - Relative → resolve against `project_root`.
6. **Not found** → trigger interview (see below). Write config. Use chosen `flow_dir`.
7. **`mkdir -p` the resolved `flow_dir`** if it does not exist.

The env var is named `MAESTRO_USING_FLOW_DIR` rather than `MAESTRO_FLOW_DIR` because Maestro CLI auto-injects every `MAESTRO_*` env var into flows as a `${...}` placeholder. The shorter name would surface as `${FLOW_DIR}`, which is plausibly something a real flow would use; `${USING_FLOW_DIR}` is virtually never a flow placeholder.

## Project ID Rules

| Source | Example | Resulting ID |
|---|---|---|
| Git SSH remote | `git@github.com:toong/mighty-family.git` | `mighty-family` |
| Git HTTPS remote | `https://github.com/toong/mighty-family.git` | `mighty-family` |
| Git remote no `.git` | `https://github.com/toong/mighty-family` | `mighty-family` |
| No git remote | project root `/Users/toong/repos/loopers-template` | `loopers-template` |
| Two repos with same basename | resolved in interview | user-typed override, e.g. `org-mighty-family` |

ID slug is allowed to contain alphanumerics, hyphens, underscores, dots. Anything else triggers a re-prompt for a clean slug during interview.

## config.yaml Schema (v1)

Flat key-value, shell-friendly. No nesting:

```yaml
# ~/.config/maestro/mighty-family/config.yaml
version: 1
project_id: mighty-family
git_remote: git@github.com:toong/mighty-family.git
project_root: /Users/toong/repos/oh-my-toong-playground/mighty-family
flow_dir: ~/.maestro/projects/mighty-family/flows
output_dir: ./maestro-output
launch_args_isE2E: "true"
created_at: 2026-04-30T15:40:00+09:00
```

| Key | Required | Notes |
|---|---|---|
| `version` | yes | Schema version. Currently `1`. |
| `project_id` | yes | Slug used in directory paths. |
| `git_remote` | no | Identification fallback / debugging aid. |
| `project_root` | yes | Absolute path used to resolve relative `flow_dir`. |
| `flow_dir` | yes | Absolute / `~/` / relative. Relative resolves against `project_root`. |
| `output_dir` | no | Default `--test-output-dir`. Relative to cwd at run time. Defaults to `./maestro-output`. |
| `launch_args_isE2E` | no | Default boolean for `arguments.isE2E`. Other flow args are not stored here. |
| `created_at` | yes | ISO 8601 timestamp. |

Flat keys make `grep -E "^flow_dir:[[:space:]]"`-style parsing trivial in pure bash 3.2 — no `yq` dependency.

## Interview Script

Triggered when `~/.config/maestro/<id>/config.yaml` is missing. The skill instructs the agent (Claude/Codex/Gemini) to ask the user in chat.

Pre-check: detect existing `.maestro/` content to offer migration.

```bash
existing_count=$(find "$project_root/.maestro" -name '*.yaml' -type f 2>/dev/null | wc -l | tr -d ' ')
```

If `existing_count > 0`, prepend Option 0 to the interview.

Interview text (Korean):

```
이 프로젝트의 Maestro flow 디렉토리가 등록되지 않았습니다.

  프로젝트 ID:    <id>
  프로젝트 루트:  <project_root>
  Git remote:     <git_remote 또는 (없음)>

flow 파일을 어디에 둘까요?

  [기존 .maestro/ 감지된 경우만]
  0) 기존 <project_root>/.maestro/ 그대로 사용 (감지: <N>개 .yaml)
     - flow_dir = ".maestro" (상대경로)로 기록

  1) <project_root>/.maestro/  (internal mode)
     - 앱 코드와 함께 git 커밋, PR 리뷰, CI 동봉
     - 브랜치별로 다른 flow 가능 (worktree마다 별도 사본)

  2) ~/.maestro/projects/<id>/flows/  (external mode, 디폴트)
     - per-user, gitignored, 같은 repo의 모든 worktree에서 공유
     - 1인 작업, 실험적 flow, worktree 헤비 환경

  3) 직접 입력 (절대 경로)

선택 [0/1/2/3]:
```

After the user answers, the agent:

1. Resolves the chosen `flow_dir` literal (`.maestro`, `<root>/.maestro`, `~/.maestro/projects/<id>/flows`, or user-supplied path).
2. `mkdir -p ~/.config/maestro/<id>/`.
3. Writes `config.yaml` with the schema above.
4. `mkdir -p` the resolved `flow_dir`.
5. Proceeds with the original Maestro task.

## CI / Non-Interactive Mode

In CI, no user is available. Set `MAESTRO_USING_FLOW_DIR` explicitly to bypass config lookup and interview entirely:

```yaml
# GitHub Actions
- name: Run Maestro
  env:
    MAESTRO_USING_FLOW_DIR: .maestro          # relative to repo checkout
  run: |
    maestro test --test-output-dir=./maestro-output "$MAESTRO_USING_FLOW_DIR"
```

For CI runs, also pass `--test-output-dir` explicitly — `output_dir` from `config.yaml` is not consulted when the env var override is in effect.

## Migration: Existing `.maestro/`

When the interview detects existing flow files in `<project_root>/.maestro/`, choosing Option 0 records `flow_dir: .maestro` in the config and proceeds without moving any files. The skill then operates on the existing tree as the source of truth.

If the user later wants to move external (Option 1 → Option 2):

```bash
mkdir -p ~/.maestro/projects/<id>/
mv <project_root>/.maestro <HOME>/.maestro/projects/<id>/flows
# Then edit ~/.config/maestro/<id>/config.yaml: flow_dir → new path
```

The skill makes no automatic move. Migration is an explicit human decision.

## Changing flow_dir Later

Edit `~/.config/maestro/<id>/config.yaml` directly — the skill re-reads on every invocation. To re-trigger the interview from scratch:

```bash
rm ~/.config/maestro/<id>/config.yaml
```

## Cross-Worktree Behavior

| Setup | Behavior |
|---|---|
| 1 repo, 5 worktrees, all in external mode (Option 2) | All five worktrees share `~/.maestro/projects/<id>/flows/`. Single source of truth — author once, run anywhere. |
| 1 repo, 5 worktrees, all in internal mode (Option 1) | Each worktree has its own `.maestro/` snapshot per branch. Branch-divergent flows possible via git. |
| Mixed across worktrees | Not supported — config is keyed by project ID, which is identical across worktrees of the same repo. Pick one mode per project. |
| Multiple repos with identical IDs | Interview detects collision (existing `~/.config/maestro/<id>/config.yaml` with different `git_remote`) and asks for slug override. |

## `output_dir` Across Worktrees

`output_dir` defaults to `./maestro-output` (relative to cwd). When five worktrees run tests, each writes into its own worktree's `maestro-output/` — automatic isolation. Pin to an absolute path only if you need to consolidate (e.g., for shared CI artifact upload).

## Edge Cases

| Case | Behavior |
|---|---|
| `git rev-parse` fails (not in a git repo) | Use `$PWD` as project root, `basename` as ID. |
| `git remote get-url origin` fails (no origin remote) | Skip `git_remote` field. ID = `basename "$project_root"`. |
| Two repos with the same basename and no git remote | Both end up with same ID. Interview detects existing entry and asks for slug override. |
| `~/.config/maestro/` does not exist | Created on first config write with `mkdir -p`. |
| `version` field (currently v1) | Reserved for future schema evolution. Not currently validated by the resolver — only `flow_dir` is read. |
| `flow_dir` directory does not exist | Skill creates with `mkdir -p` on first use. |
| User deletes `flow_dir` content | Skill cannot recover; restore from backup or rewrite. |
| `MAESTRO_USING_FLOW_DIR` set to empty string | Treated as unset (env var override engages only on non-empty). |
| Flow uses `${USING_FLOW_DIR}` placeholder | The env var (when set) auto-injects via Maestro's `MAESTRO_*` rule. Name your flow placeholders to avoid this collision — practically nobody does. |

## What This Replaces

The previous "Where to Store Flow Files" recommendation was: "always `.maestro/` at repo root". That is now Option 1 of the interview — a valid choice, no longer the only choice.

The fourth pillar in `SKILL.md` previously stated `.maestro/` location as a non-negotiable absolute. The fourth pillar is now: **flow location is per-project, recorded in `~/.config/maestro/<id>/config.yaml` (or overridden by `MAESTRO_USING_FLOW_DIR`), resolved before every Maestro operation.**

The structure inside the resolved `flow_dir` (`common/`, `<feature>/`, `screenshots/`) is unchanged — see `flow-organization.md`.
