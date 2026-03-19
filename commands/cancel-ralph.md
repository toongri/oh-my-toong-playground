---
description: Cancel active Ralph Loop
---

[RALPH LOOP CANCELLED]

The Ralph Loop has been cancelled. You MUST now execute the full cleanup procedure.

## MANDATORY ACTION

Execute these commands to fully cancel the Ralph Loop and clean up all associated state (for all sessions):

```bash
# Remove all session-specific ralph state files
rm -f "$OMT_DIR"/ralph-state-*.json 2>/dev/null || true

# Check if ultrawork is linked to ralph and clean up if so
if [ -f "$OMT_DIR/ultrawork-state.json" ]; then
  is_linked=$(jq -r '.linked_to_ralph // false' "$OMT_DIR/ultrawork-state.json" 2>/dev/null)
  if [ "$is_linked" = "true" ]; then
    rm -f "$OMT_DIR/ultrawork-state.json"
    rm -f ~/.claude/ultrawork-state.json
  fi
fi
```

## VERIFICATION

After running the cleanup commands, verify the cancellation was successful:

```bash
# Should return no files
ls "$OMT_DIR"/ralph-state-*.json 2>/dev/null || echo "ralph-state files removed"
```

## POST-CANCELLATION

After executing the cleanup:
- You are free to stop working
- The persistent mode hook will no longer force continuation
- All ralph state has been cleared

If you want to start a new loop later, use `/ralph "task description"`.
