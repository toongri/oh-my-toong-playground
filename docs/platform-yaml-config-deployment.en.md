# Per-platform YAML config deployment — where do config/hooks/mcps go?

Unlike components (agents/skills/…), `config`, `hooks`, and `mcps` in
`claude.yaml` (and its `claude.local.yaml` overlay) are not copied as files.
`config` and `hooks` are **merged into the target project's settings file**,
but `mcps` is **assigned per entry into a different file (`~/.claude.json`)** —
see "What is deployed where" below. The safe home for personal absolute paths
(for example, `TURBO_CACHE_DIR`) follows from this deployment path and the
**two distinct gitignore layers**.

## What is deployed where

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

**Omitting** a declaration preserves existing state. To remove a previously
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
| Codex | Omits only the named entry from the managed MCP block. |
| OpenCode | Removes only `mcp.<name>` from the target's `.opencode/opencode.json`. |
| Gemini | **Not supported.** Validation rejects `mcps.<name>: null`. When Gemini receives an `mcps` section, it replaces all `mcpServers` in `.gemini/settings.json`, so it is outside this removal-tombstone contract. |

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

## The two gitignore layers (the key point)

The distinction between `claude.yaml` and `claude.local.yaml` is **not**
whether content leaks to the team. They pass through different gitignore axes.

| Layer | What is ignored | Which axis it represents |
|------|-----------------|--------------------------|
| **Layer 1 — OMT source repository** | `/*.local.yaml` + `/projects/*/*.local.yaml` (OMT `.gitignore`) → only `claude.local.yaml` is ignored; `claude.yaml` is tracked by git | **"Whether it is version-controlled in the OMT repository"** |
| **Layer 2 — target team repository** | `.claude/settings.local.json` (the target repository's `.gitignore`, for example algocare-home) → the deployed artifact itself is ignored | **"Whether it is committed to the target team repository"** |

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
six core hooks (`keyword-detector.sh`, `pre-tool-enforcer.sh`,
`review-exec-guard.sh`, `session-start.sh`, `orphan-reaper.sh`, and
`persistent-mode`) have no device-specific elements, so they must be placed in
the tracked root `claude.yaml`. `review-exec-guard.sh` is registered globally,
but internally activates only in review context. Putting the hooks in
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

`make sync-dry` previews the `config`/`hooks` that will be merged into each
target's `settings.local.json`. For actual deployment results, inspect
`.claude/settings.local.json` directly in the target worktree.
