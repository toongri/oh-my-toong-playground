# Per-platform YAML config deployment — where do config/hooks/mcps go?

Unlike components (agents/skills/…), `config`, `hooks`, and `mcps` in
`claude.yaml` (and its `claude.local.yaml` overlay) are not copied as files.
`config` and `hooks` are **merged into the target project's settings file**,
but `mcps` is **assigned per entry into a different file (`~/.claude.json`)** —
see "What is deployed where" below. The safe home for personal absolute paths
(for example, `TURBO_CACHE_DIR`) follows from this deployment path and the
**two distinct gitignore layers**.

## What is deployed where

The following merge rules and settings column apply to Claude. Codex `config`
updates `.codex/config.toml` under the separate ownership rules below.

- `config`, `hooks`, and `statusLine` are **deep-merged** into the target's
  **`.claude/settings.local.json`**. **Only global sync uses
  `.claude/settings.json`** — the `isGlobalSync(targetPath) ? "settings.json" :
  "settings.local.json"` branch in `tools/adapters/claude.ts`.
- Deep merge does not replace the entire existing settings file; it is
  fundamentally **additive** (only matching keys are updated).
- There is one **key-level exception**: a key with the value `null` is
  **removed** from the target file (RFC 7386 JSON Merge Patch semantics;
  `tools/lib/deep-merge.ts`). Simply deleting a key from the source YAML leaves
  its old value in the deployed file because additive merging carries it
  forward. To delete it, explicitly set that key to `null`.

**`mcps` sits on a different axis** — it follows platform-specific MCP
destinations and removal contracts:

| | `config`/`hooks`/`statusLine` | `mcps` |
|---|---|---|
| Destination | the target's `.claude/settings.local.json` (global sync uses `settings.json`) | a platform-specific MCP settings store |
| Merge behavior | `deepMerge` — additive, existing values preserved | handled by name by each platform adapter |
| Key-level `null` | deletes the key (RFC 7386, `tools/lib/deep-merge.ts`) | a named MCP removal tombstone on supported platforms |
| Removal path | explicitly set that key to `null` | explicitly set `mcps.<name>: null` |

### Named MCP removal

**Omitting** a declaration preserves existing state on Claude, Codex, and OpenCode. To remove a previously
deployed MCP, retain an explicit tombstone as a desired-state migration:

```yaml
mcps:
  obsolete-server: null
```

This syntax is supported by Claude, Codex, and OpenCode. It removes only the
named MCP, preserving sibling MCPs and other contents of the settings file; it
is also idempotent when the named MCP is already absent.

| Platform | Scope and destination of `mcps.<name>: null` |
|---|---|
| Claude | Root `claude.yaml` removes top-level `mcpServers.<name>` at user scope in `~/.claude.json`. Project `claude.yaml` removes only the local MCP at `projects.<derived-project-key>.mcpServers.<name>` in that same user config file. `CLAUDE_USER_CONFIG` can override the file location. |
| Codex | Removes only that server via `codex mcp remove <name>`. OMT-managed MCP names are tracked in the target's `.omt/sync-manifest.json` under the `codex/mcps` pair, so sibling and user-added servers are left untouched. |
| OpenCode | Removes only `mcp.<name>` from the target's `.opencode/opencode.json`. |
| Gemini | **Not supported.** Validation rejects `mcps.<name>: null`. When Gemini receives an `mcps` section, it replaces all `mcpServers` in `.gemini/settings.json`, so it is outside this removal-tombstone contract. |

Claude root and project MCP settings live in a user file outside `deployRoot`,
so they are outside that worktree's `DeployTransaction`. MCP changes may remain
if deployment later fails. Retry sync, declare a tombstone, or remove the MCP
manually with the Claude CLI as needed.

Codex includes native `codex mcp add/remove` changes to the target's
`.codex/config.toml` and updates to the `codex/mcps` names manifest in the same
deployment transaction. Failures roll back config and manifest changes, but
not external effects such as OAuth authentication state. OpenCode also handles
its target settings inside `deployRoot`.

For manual CLI removal, use `claude mcp remove <name> --scope user` for a root
global MCP and `claude mcp remove <name> --scope local` for a project-local MCP.
When scope is omitted, the Claude CLI finds the MCP's existing location. This
manual path remains available, but is not the only declarative-sync removal
path. Simply deleting a declaration from the source configuration does not
remove an existing MCP on Claude, Codex, or OpenCode.

Section-level `null` — `config: null` / `hooks: null` / `mcps: null` — is
different from an individual removal. The adapter's `syncPlatformYaml` guard
skips deploying that entire section for the current run; it does not remove
existing state.

### Codex configuration ownership and deletion

Codex uses the default `.codex/config.toml`. OMT records owned leaf paths and
last-applied values in the target's `.omt/codex-config-state.json`. Each
`entries` item has a string-array `path` and a `valueToml` containing the last
value as `value = ...` TOML. Tables group paths; arrays are atomic values.

- New keys are added and owned. Existing unowned keys require explicit
  adoption even when they equal the declared value. Comments do not prove ownership.
- Omitted keys and their ownership records are preserved. Declare a key as
  `null` to delete an owned key. If that owned key is already absent, `null`
  only removes its ownership record.
- A current value matching the last-applied or newly declared value can be
  reconciled. A value matching neither, or a missing owned key, causes a
  conflict (except for the explicit deletion above). Conflicts do not overwrite
  user values or partially apply other keys.
- Untouched TOML bytes are preserved. Unsupported edits inside inline tables
  or arrays of tables, array-of-tables replacements, and leaf/table transitions
  fail before writing. Successful adoption does not guarantee every edit to that syntax.

For example, this declaration deletes only the owned `features.example` key.
Omitting other `features` keys preserves them. `config: null` instead skips the
entire config deployment.

```yaml
config:
  features:
    example: null
```

### Adopting existing Codex configuration

From the OMT repository, preview adoption of existing leaves with this command.
`--target` is the actual deployment root and is required. Each `--key` is a
nonempty JSON array of string path segments; repeat it for each leaf. Replace
the example target and keys with those present in your config.

```bash
bun tools/codex-config-migrate.ts --target /path/to/target --key '["model"]' --key '["features","example"]'
```

The default is a preview with no writes. Add `--apply` to the same command to
adopt the reviewed keys.

```bash
bun tools/codex-config-migrate.ts --target /path/to/target --key '["model"]' --key '["features","example"]' --apply
```

Applying records current values in ownership state without rewriting config
bytes or comments. Before the first adoption apply, it creates
`.omt/codex-config-before-adoption.toml` with mode `0600`; later adoptions do
not overwrite it. The complete contents are written and fsynced to a temporary
file before exclusive hard-link publication at the backup path. An existing
regular backup is preserved, but its content integrity is not verified. State,
pending, and lock files are also created with mode `0600`. A newly created
backup contains the original before adoption, not the latest sync state.

If TOML is valid, the same procedure works when `omt:config` comments are
missing, one-sided, or reversed. No range is inferred from comments and no
closing marker needs to be added. Resolve missing config, invalid TOML, or
invalid ownership state first. Bulk table adoption is rejected; select leaves
individually. An already-owned key matching its last-applied value is a no-op;
a differing value is rejected. This CLI cannot forcibly take over user drift.

### Codex preview and recovery

`make sync-dry` reads the real target config and state, checking TOML parsing,
ownership conflicts, required adoption, and supported edits. It creates no
files, directories, or locks. A remaining `.omt/codex-config-pending.json`
causes a `recovery-required` failure; the adoption CLI also refuses to proceed
until recovery. Neither preview nor adoption performs recovery. Even with
`config` omitted or `config: null`, real MCP-only deployment recovers pending
config before native listing, CLI mutations, or manifest updates. Dry-run on
this MCP path also fails if a pending journal exists.

An ordinary exception during config storage releases the lock; the next real
sync attempts recovery of any remaining journal. A hard kill can leave
`.omt/codex-config.lock`. An existing lock always blocks config storage and
recovery; there is no automatic removal or PID-liveness reclamation. Only an
operator who confirms no sync is active for that target and prevents another
sync from starting may manually remove that lock file alone and retry. PID
metadata does not prove exclusive access. Never delete a live lock, and never
remove the pending journal or ownership state to recover.

Real sync completes both files to their after state and removes the journal
only when config/state bytes match `(before, before)`, `(after, before)`, or
`(after, after)` in that journal. Other bytes introduced by external edits
cause a conflict and are preserved. Invalid journals, or conflicts and
unsupported edits in the planned post-recovery config, must be resolved before
real sync can proceed. Config, state, and pending files are included in the
deployment transaction snapshots. Files are rechecked immediately before
replacement, but native MCP writes do not share the config-store lock. These
checks are bounded; external programs do not share a universal compare-and-swap
protocol, so not every concurrent write is prevented. Overlapping syncs to the
same target are not supported. See the
[sync deployment operations document](sync-deploy-targets.md) (Korean) for
execution conditions and per-worktree failure handling.

### Claude plugin removal

Claude `plugins.items` accepts string or object items. A string,
`{ name: <name> }`, and `{ name: <name>, state: present }` retain the existing
installation behavior (`present` is the default state). To remove one plugin,
declare:

```yaml
plugins:
  items:
    - name: obsolete-plugin@marketplace
      state: absent
```

`state: absent` runs `claude plugin uninstall` only for that name: at user scope
from a root YAML and at project scope from a project YAML. Sibling plugins are
preserved, and repeating the declaration for an already-absent plugin is safe.

### Claude plugin transactions and external commands

Plugin `check` and `pre-commands` entries run through `bash -c` in the target
worktree. Arbitrary shell commands, including Claude CLI calls, can change
user, project, or external state outside `deployRoot`. Plugin installation,
removal, and these command effects are outside the file deployment
`DeployTransaction` and cannot be rolled back by it. Changes already made may
remain even if a later target deployment fails.

For recovery, first retry sync with the same configuration. Reconcile plugin
state with Claude CLI `plugin uninstall` or `plugin install` at the appropriate
scope. Undo files, settings, and other external changes from `check` and
`pre-commands` according to those commands' behavior. These recovery steps are
outside the declarative file deployment transaction guarantee.

## The two gitignore layers (the key point)

The distinction between `claude.yaml` and `claude.local.yaml` is **not**
whether content leaks to the team. They pass through different gitignore axes.

| Layer | What is ignored | Which axis it represents |
|------|-----------------|--------------------------|
| **Layer 1 — OMT source repository** | `/*.local.yaml` + `/projects/*/*.local.yaml` (OMT `.gitignore`) → only `claude.local.yaml` is ignored; `claude.yaml` is tracked by git | **"Whether it is version-controlled in the OMT repository"** |
| **Layer 2 — target team repository** | `.claude/settings.local.json` (the target repository's `.gitignore`, for example acme-home) → the deployed artifact itself is ignored | **"Whether it is committed to the target team repository"** |

`parseAndMergePlatformYaml` in `tools/lib/parse-platform-yaml.ts` deep-merges
`claude.yaml` (base) and `claude.local.yaml` (local), with local taking
precedence.

Layer 2 is the crucial implication: because the deployment destination
(`settings.local.json`) is gitignored in the target repository, **its content
never enters the target team's commit tree, whether it originated in
`claude.yaml` or `claude.local.yaml`.** Layer 2 prevents team leakage at the
source; choosing between `claude.yaml` and `claude.local.yaml` does not.

## Where personal absolute paths belong

- **Use `claude.yaml` by default.** Layer 2 prevents team leakage (the target's
  `settings.local.json` is gitignored); meanwhile the setting is versioned in
  the OMT repository, remains consistent across your machines, and **survives
  a lost worktree** (because it lives in the OMT repository).
- **Use `claude.local.yaml` only when you do not want it retained even in OMT
  git** — for genuinely secret values, or values that differ by machine and
  must not be version-controlled. This file is gitignored in OMT and therefore
  excluded from commits (and PRs); putting wiring that must reach a PR here
  creates a blind spot where it works only on your machine.
- Example: put `TURBO_CACHE_DIR` (a personal absolute path to the Turbo cache)
  in `claude.yaml` — it does not reach the target team repository (Layer 2),
  and it remains versioned in OMT (Layer 1).

### The blind spot created by putting `hooks:` in `claude.local.yaml`

The default rule above applies especially strongly to the `hooks:` block. The
five core hooks (`keyword-detector.sh`, `pre-tool-enforcer.sh`,
`session-start.sh`, `orphan-reaper.sh`, and
`persistent-mode`) have no device-specific elements, so they must be placed in
the tracked root `claude.yaml`. Putting the hooks in
`claude.local.yaml` breaks two things in practice:

- **A fresh clone has no hooks.** The overlay file is gitignored, so the entire
  global hook registration is absent on another machine.
- **An audit that reads only tracked files misreads them as unregistered.**
  Because the root `claude.yaml` appears to have no `hooks:` block, a person or
  tool auditing the repository concludes that no hooks are registered — even
  when they remain correctly registered in `~/.claude/settings.json`.

Conversely, **do not put the same hook in both the root `claude.yaml` and
`projects/*/claude.yaml`.** Global registration lands in
`~/.claude/settings.json`; project registration lands in the target's
`.claude/settings.local.json`. Claude Code merges both, so the hook **fires
twice** (`session-start.sh`, for example, injects stdout into the conversation
prefix twice). Leave only truly machine-specific entries in `claude.local.yaml`
— such as the `preserve` rule for Superset hooks, which matters only where that
tool is installed.

This global registration does not mean registering the hooks again per
project. They must instead be registered exactly once at the root. The two
invariants are statically enforced for all six core hooks by
`test_core_claude_hooks_registered_in_tracked_root_yaml` and
`test_core_claude_hooks_not_duplicated_per_project` in
`hooks/hook-registration_test.sh`.

## Verification

For Claude, `make sync-dry` previews the `config`/`hooks` to merge into each
target's `settings.local.json`. For actual deployment results, inspect
`.claude/settings.local.json` directly in the target worktree.
