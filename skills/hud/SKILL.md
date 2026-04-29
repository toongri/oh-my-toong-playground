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

1. **Check dependencies**
   - Run `bun --version` to verify Bun is installed.
   - Run `jq --version` to verify jq is installed.
   - If either is unavailable, inform user and stop.

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

   ```bash
   !`
   set -euo pipefail
   SETTINGS_FILE="${CLAUDE_SKILL_DIR}/../../settings.local.json"
   BACKUP_FILE="${CLAUDE_SKILL_DIR}/../../statusLine.backup.json"

   if [ -e "$BACKUP_FILE" ]; then
     echo "backup exists — skipping (first-time-only invariant preserved)"
     echo "BACKUP_FILE=$BACKUP_FILE"
     exit 0
   fi

   SETTINGS_CONTENT="{}"
   if [ -f "$SETTINGS_FILE" ]; then
     SETTINGS_CONTENT="$(cat "$SETTINGS_FILE")"
   fi

   if echo "$SETTINGS_CONTENT" | jq -e 'has("statusLine")' > /dev/null 2>&1; then
     echo "$SETTINGS_CONTENT" | jq '.statusLine' > "${BACKUP_FILE}.tmp"
     mv "${BACKUP_FILE}.tmp" "$BACKUP_FILE"
     echo "backed up existing statusLine to $BACKUP_FILE"
   else
     echo '{}' > "${BACKUP_FILE}.tmp"
     mv "${BACKUP_FILE}.tmp" "$BACKUP_FILE"
     echo "wrote sentinel {} to $BACKUP_FILE (no prior statusLine)"
   fi
   `
   ```

   The first-time-only invariant ensures the original user statusLine is preserved on first setup; subsequent setups must not overwrite the backup with hud's own value. The sentinel `{}` represents "no prior statusLine existed" so `/hud restore` knows to remove the key on restore.

5. **Update settings.local.json with hud statusLine (always executed — supports upgrades)**

   ```bash
   !`
   set -euo pipefail
   SETTINGS_FILE="${CLAUDE_SKILL_DIR}/../../settings.local.json"
   SCRIPT_PATH="${CLAUDE_SKILL_DIR}/scripts/index.ts"

   if [ ! -f "$SETTINGS_FILE" ]; then
     echo '{}' > "$SETTINGS_FILE"
   fi

   jq --arg cmd "bun run $SCRIPT_PATH" \
      '.statusLine = {"type":"command","command":$cmd}' \
      "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp"
   mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"

   echo "Updated statusLine.command to: bun run $SCRIPT_PATH"
   `
   ```

   `${CLAUDE_SKILL_DIR}` is substituted by Claude Code at preprocessing time, so `$SCRIPT_PATH` resolves to an absolute path (e.g., `/Users/toong/.claude/skills/hud/scripts/index.ts` for user-global, or `/Users/toong/repos/<project>/.claude/skills/hud/scripts/index.ts` for project-local). The jq invocation preserves all other keys in settings.local.json — only `.statusLine` is updated.

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

3. **Restore based on backup content**

   ```bash
   !`
   set -euo pipefail
   SETTINGS_FILE="${CLAUDE_SKILL_DIR}/../../settings.local.json"
   BACKUP_FILE="${CLAUDE_SKILL_DIR}/../../statusLine.backup.json"

   if [ ! -e "$BACKUP_FILE" ]; then
     echo "no backup found — nothing to restore"
     exit 0
   fi

   BACKUP_CONTENT="$(cat "$BACKUP_FILE")"

   if [ ! -f "$SETTINGS_FILE" ]; then
     echo '{}' > "$SETTINGS_FILE"
   fi

   if [ "$(echo "$BACKUP_CONTENT" | jq -c '.')" = "{}" ]; then
     jq 'del(.statusLine)' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp"
     echo "removed statusLine key (sentinel — pre-setup state restored)"
   else
     jq --argjson sl "$BACKUP_CONTENT" '.statusLine = $sl' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp"
     echo "restored statusLine from backup"
   fi

   mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
   rm -f "$BACKUP_FILE"
   echo "removed backup file"
   `
   ```

   The sentinel `{}` distinguishes "no prior statusLine existed" (remove key) from "user had a custom statusLine" (restore object).

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
