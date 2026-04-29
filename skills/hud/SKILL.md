---
name: hud
description: Setup and manage Oh-My-Toong HUD for Claude Code statusLine
---

# HUD Setup Skill

This skill configures the Oh-My-Toong HUD to display in Claude Code's status bar. Setup, restore, and backup all self-locate via `${CLAUDE_SKILL_DIR}` substitution — no branch logic. The same skill source produces correct behavior whether deployed user-globally (`~/.claude/skills/hud/`) or project-locally (`<project>/.claude/skills/hud/`).

## Usage

```
/hud setup    # Install and configure HUD
/hud restore  # Restore previous statusLine configuration
```

## Setup Process

When user runs `/hud setup`:

1. **Check Bun availability**
   - Run `bun --version` to verify Bun is installed.
   - If not available, inform user and stop.

2. **Resolve self-located paths**

   ```bash
   !`
   set -euo pipefail
   SETTINGS_FILE="${CLAUDE_SKILL_DIR}/../../settings.local.json"
   BACKUP_FILE="${CLAUDE_SKILL_DIR}/../../statusLine.backup.json"
   SCRIPT_PATH="${CLAUDE_SKILL_DIR}/scripts/index.ts"
   echo "SETTINGS_FILE=$SETTINGS_FILE"
   echo "BACKUP_FILE=$BACKUP_FILE"
   echo "SCRIPT_PATH=$SCRIPT_PATH"
   `
   ```

3. **Verify hud script exists**
   - Confirm `$SCRIPT_PATH` (which is `${CLAUDE_SKILL_DIR}/scripts/index.ts`) exists.
   - If missing, inform user to run `make sync` first and stop.

4. **Backup existing statusLine config (first-time-only invariant)**

   - **If `${CLAUDE_SKILL_DIR}/../../statusLine.backup.json` already exists**, skip this step entirely. The original user statusLine was preserved on first setup; subsequent setups must not overwrite the backup with hud's own value.
   - **Otherwise** (no backup file yet — this is the first setup):
     - Read `${CLAUDE_SKILL_DIR}/../../settings.local.json` (treat as empty object `{}` when absent).
     - If a `statusLine` key exists, save its current value to `${CLAUDE_SKILL_DIR}/../../statusLine.backup.json`.
     - If `statusLine` key is absent, write sentinel `{}` to `${CLAUDE_SKILL_DIR}/../../statusLine.backup.json`. The sentinel marks "no prior statusLine existed" so `/hud restore` knows to remove the key on restore.
   - Log the backup file location.

5. **Update settings.local.json with hud statusLine (always executed — supports upgrades)**

   - Read `${CLAUDE_SKILL_DIR}/../../settings.local.json` (start from `{}` when the file does not exist).
   - Set the `statusLine` key:
     ```json
     {
       "statusLine": {
         "type": "command",
         "command": "bun run ${CLAUDE_SKILL_DIR}/scripts/index.ts"
       }
     }
     ```
   - Note: `${CLAUDE_SKILL_DIR}` in the command string is substituted by Claude Code at preprocessing time, so the value embedded in settings.local.json is an absolute path (e.g., `bun run /Users/toong/.claude/skills/hud/scripts/index.ts` for user-global deploy, or `bun run /Users/toong/repos/<project>/.claude/skills/hud/scripts/index.ts` for project-local).
   - Write back to `${CLAUDE_SKILL_DIR}/../../settings.local.json`.

6. **Inform user**
   - Display success message including the deployed statusLine.command value (so user can verify the absolute path).
   - Instruct user to restart Claude Code.

## Restore Process

When user runs `/hud restore`:

1. **Resolve self-located paths**

   ```bash
   !`
   set -euo pipefail
   SETTINGS_FILE="${CLAUDE_SKILL_DIR}/../../settings.local.json"
   BACKUP_FILE="${CLAUDE_SKILL_DIR}/../../statusLine.backup.json"
   echo "SETTINGS_FILE=$SETTINGS_FILE"
   echo "BACKUP_FILE=$BACKUP_FILE"
   `
   ```

2. **Check** `${CLAUDE_SKILL_DIR}/../../statusLine.backup.json` exists.

3. **Backup exists** — restore based on sentinel vs object:
   - Read backup file content.
   - Read current `${CLAUDE_SKILL_DIR}/../../settings.local.json`.
   - **If backup content is sentinel `{}`** (no prior statusLine recorded): remove the `statusLine` key from settings.local.json (returning to clean pre-setup state).
   - **Otherwise** (backup is a statusLine object): restore the `statusLine` key in settings.local.json to the backup's value.
   - Write back to `${CLAUDE_SKILL_DIR}/../../settings.local.json`.
   - Delete `${CLAUDE_SKILL_DIR}/../../statusLine.backup.json`.
   - Inform user of restoration.

4. **Backup absent** — no installation found:
   - Inform user: no backup file found, nothing to restore.

## Display Format

After setup, the HUD shows:

```
[OMC] ralph:3/10 | ultrawork | ctx:67% | agents:2 | bg:1 | todos:2/5 | skill:prometheus
```

### Elements

| Element | Description |
|---------|-------------|
| `[OMC]` | Oh-My-Toong prefix (always shown) |
| `ralph:X/Y` | Ralph loop iteration (green/yellow/red) |
| `N/M` | Verification attempt N of M (after ralph) |
| `ultrawork` | Ultrawork mode active |
| `ctx:N%` | Context window usage (green <70%, yellow 70-85%, red >85%) |
| `agents:N` | Running subagents count |
| `bg:N` | Background tasks count |
| `todos:X/Y` | Todo completion (green when done, yellow when pending) |
| `skill:name` | Active skill name (truncated to 15 chars) |

## Requirements

- Bun
- Claude Code with statusLine support
- macOS or Linux (Windows untested)
