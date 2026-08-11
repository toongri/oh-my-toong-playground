#!/bin/bash
# Shared skill metadata parsing and project-local lookup helpers.

# Returns success only for a closed YAML frontmatter block containing the
# exact scalar `disable-model-invocation: true` (matching the PreToolUse gate).
skill_core_is_model_disabled() {
    local target="$1"
    awk 'NR==1 { if ($0 != "---") exit 2; next } !closed { if ($0 == "---") { closed=1; next } if ($0 ~ /^[[:space:]]*disable-model-invocation:[[:space:]]*true[[:space:]]*$/) found=1 } END { if (!closed) exit 2; if (found) exit 0; exit 1 }' "$target"
}

# Prints the nearest project-local skill path, then falls back to HOME.
skill_core_find_skill() {
    local cwd="$1" name="$2" dir candidate home_dir
    dir="$cwd"
    while [ -n "$dir" ]; do
        candidate="$dir/.agents/skills/$name/SKILL.md"
        if [ -f "$candidate" ] && [ -r "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
        [ "$dir" = "/" ] && break
        dir="${dir%/*}"
        [ -n "$dir" ] || dir="/"
    done
    home_dir="${HOME:-}"
    [ -n "$home_dir" ] || return 1
    candidate="$home_dir/.agents/skills/$name/SKILL.md"
    [ -f "$candidate" ] && [ -r "$candidate" ] || return 1
    printf '%s\n' "$candidate"
}
