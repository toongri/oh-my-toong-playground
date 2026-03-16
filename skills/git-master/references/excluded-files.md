# Files to Exclude from Commit

These files are workflow artifacts, not implementation deliverables.
**Never stage or commit these files:**

| File/Directory | Reason                                       |
|----------------|----------------------------------------------|
| `plan.md`      | Workflow tracking file, managed separately   |
| `research.md`  | Research artifact, not implementation code   |
| `docs/specs/*` | Input spec documents, should not be modified |

## Why Exclude?

- **plan.md**: Worker updates checkboxes separately after successful commit. Mixing with implementation commit creates confusion.
- **research.md**: Created by researcher agent. Should remain unchanged during implementation.
- **docs/specs/**: These are SOURCE documents. Implementation reads from them but never writes to them.

## If These Files Have Changes

If `git status` shows changes to these files:

1. **plan.md changes**: Likely checkbox updates - Worker handles this separately
2. **research.md changes**: Should not happen - report to user if modified
3. **docs/specs/ changes**: Should not happen - report to user if modified

## Staging Commands

```bash
# Stage all changes first
git add .

# Unstage excluded files (if they were modified)
git reset HEAD plan.md 2>/dev/null || true
git reset HEAD research.md 2>/dev/null || true
git reset HEAD docs/specs/ 2>/dev/null || true
```

## Verify Before Commit

```bash
git diff --staged --name-only
```

**Check the output:**
- ✅ Should contain: `src/`, `test/` files (implementation code)
- ❌ Should NOT contain: `plan.md`, `research.md`, `docs/specs/*`

## Report Unexpected Changes

```bash
git diff --name-only plan.md research.md docs/specs/
```

If this returns any files, report to worker:
```
⚠️ Warning: Workflow files were modified during implementation.
Modified: [list of files]
These changes were NOT committed. Please review.
```
