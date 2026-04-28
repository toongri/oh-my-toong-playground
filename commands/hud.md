---
name: hud
description: Setup and manage Oh-My-Toong HUD for Claude Code statusLine
---

# HUD Setup Command

This command configures the Oh-My-Toong HUD to display in Claude Code's status bar.

## Usage

```
/hud setup    # Install and configure HUD
/hud restore  # Restore previous statusLine configuration
```

## Setup Process

When user runs `/hud setup`:

1. **Check Bun availability**
   - Run `bun --version` to verify Bun is installed
   - If not available, inform user and stop

2. **Determine install scope and script path using `${CLAUDE_SKILL_DIR}`**

   Execute the following to resolve paths:

   ```bash
   !`
   if [[ "${CLAUDE_SKILL_DIR}" == "$HOME"* ]]; then
     SCOPE="user-global"
     SCRIPT_CMD="bun run $HOME/.claude/scripts/hud/index.ts"
   else
     SCOPE="project-local"
     SCRIPT_CMD="bun run $CLAUDE_PROJECT_DIR/.claude/scripts/hud/index.ts"
   fi
   SETTINGS_FILE="${CLAUDE_SKILL_DIR}/../settings.local.json"
   BACKUP_FILE="${CLAUDE_SKILL_DIR}/../statusLine.backup.json"
   echo "SCOPE=$SCOPE"
   echo "SCRIPT_CMD=$SCRIPT_CMD"
   echo "SETTINGS_FILE=$SETTINGS_FILE"
   echo "BACKUP_FILE=$BACKUP_FILE"
   `
   ```

3. **Check synced script exists**
   - For user-global scope: verify `$HOME/.claude/scripts/hud/index.ts` exists
   - For project-local scope: verify `$CLAUDE_PROJECT_DIR/.claude/scripts/hud/index.ts` exists
   - If not exists, inform user to run sync first

4. **Backup existing statusLine config**
   - Read `${CLAUDE_SKILL_DIR}/../settings.local.json`
   - If `statusLine` key exists, save current value to `${CLAUDE_SKILL_DIR}/../statusLine.backup.json`
   - Log backup location for user

5. **Update settings.local.json**
   - Read existing `${CLAUDE_SKILL_DIR}/../settings.local.json` (or start from empty object if not exists)
   - Set `statusLine` using the resolved `$SCRIPT_CMD`:
     - user-global scope: `"command": "bun run $HOME/.claude/scripts/hud/index.ts"`
     - project-local scope: `"command": "bun run $CLAUDE_PROJECT_DIR/.claude/scripts/hud/index.ts"`
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "<resolved SCRIPT_CMD>"
     }
   }
   ```
   - Write back to `${CLAUDE_SKILL_DIR}/../settings.local.json`

6. **Inform user**
   - Display success message including detected scope (user-global or project-local)
   - Instruct user to restart Claude Code

## Restore Process

When user runs `/hud restore`:

1. **Resolve paths via `${CLAUDE_SKILL_DIR}`**

   ```bash
   !`
   if [[ "${CLAUDE_SKILL_DIR}" == "$HOME"* ]]; then
     SCOPE="user-global"
   else
     SCOPE="project-local"
   fi
   SETTINGS_FILE="${CLAUDE_SKILL_DIR}/../settings.local.json"
   BACKUP_FILE="${CLAUDE_SKILL_DIR}/../statusLine.backup.json"
   echo "SCOPE=$SCOPE"
   echo "SETTINGS_FILE=$SETTINGS_FILE"
   echo "BACKUP_FILE=$BACKUP_FILE"
   `
   ```

2. Check if `${CLAUDE_SKILL_DIR}/../statusLine.backup.json` exists
3. If exists:
   - Read backup from `${CLAUDE_SKILL_DIR}/../statusLine.backup.json`
   - Read current `${CLAUDE_SKILL_DIR}/../settings.local.json`
   - Restore `statusLine` from backup (or remove key if backup recorded no value)
   - Write back to `${CLAUDE_SKILL_DIR}/../settings.local.json`
   - Delete `${CLAUDE_SKILL_DIR}/../statusLine.backup.json`
   - Inform user of restoration and scope
4. If not exists:
   - Inform user no backup found

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
