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

1. **Check Node.js availability**
   - Run `node --version` to verify Node.js is installed
   - Require v18+ for ESM support
   - If not available, inform user and stop

2. **Check synced script exists**
   - Verify `.claude/scripts/hud.js` exists
   - If not exists, inform user to run sync first

3. **Backup existing statusLine config**
   - Read `.claude/settings.json`
   - If `statusLine` key exists, save to `.claude/statusLine.backup.json`
   - Log backup location for user

4. **Update settings.json**
   - Read existing `.claude/settings.json` (or create empty object if not exists)
   - Set `statusLine` configuration:
   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "node .claude/scripts/hud.js"
     }
   }
   ```
   - Write back to `.claude/settings.json`

5. **Inform user**
   - Display success message
   - Instruct user to restart Claude Code

## Restore Process

When user runs `/hud restore`:

1. Check if `.claude/statusLine.backup.json` exists
2. If exists:
   - Read backup
   - Read current `.claude/settings.json`
   - Restore `statusLine` from backup (or remove if backup was empty)
   - Write back to `.claude/settings.json`
   - Delete backup file
   - Inform user of restoration
3. If not exists:
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

- Node.js v18+
- Claude Code with statusLine support
- macOS or Linux (Windows untested)
