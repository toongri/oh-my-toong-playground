---
description: Cancel active Ralph Loop
---

[RALPH LOOP CANCELLED]

The Ralph Loop has been cancelled. You MUST now execute the full cleanup procedure.

## MANDATORY ACTION

Execute these commands to fully cancel the Ralph Loop and clean up all associated state:

```bash
# Navigate to state directory
cd .claude/sisyphus

# Remove ralph state files
rm -f ralph-state.json
rm -f ralph-verification.json

# Check if ultrawork is linked to ralph and clean up if so
if [ -f ultrawork-state.json ]; then
  is_linked=$(jq -r '.linked_to_ralph // false' ultrawork-state.json 2>/dev/null)
  if [ "$is_linked" = "true" ]; then
    rm -f ultrawork-state.json
    rm -f ~/.claude/ultrawork-state.json
  fi
fi

# Clean temp files used for todo attempt tracking
rm -f /tmp/oh-my-toong-todo-attempts-*
rm -f /tmp/oh-my-toong-todo-count-*
```

## VERIFICATION

After running the cleanup commands, verify the cancellation was successful:

```bash
# Should return "file not found" or empty for all of these
ls -la .claude/sisyphus/ralph-state.json 2>/dev/null || echo "ralph-state.json removed"
ls -la .claude/sisyphus/ralph-verification.json 2>/dev/null || echo "ralph-verification.json removed"
```

## POST-CANCELLATION

After executing the cleanup:
- You are free to stop working
- The persistent mode hook will no longer force continuation
- All verification states have been cleared
- Todo attempt counters have been reset

If you want to start a new loop later, use `/ralph "task description"`.
