#!/bin/bash
# Shared static-review execution invariant. Claude and Codex adapters supply
# their platform payload extraction, then use these functions for identity,
# review-context, and command judgment.

review_exec_session_id() {
    local payload_sid="$1" candidate="" value=""
    for value in "${OMT_SESSION_ID:-}" "${CODEX_THREAD_ID:-}" "$payload_sid"; do
        [ -n "$value" ] || continue
        case "$value" in
            *[!A-Za-z0-9_-]*|?*)
                if ! printf '%s' "$value" | grep -qE '^[A-Za-z0-9_-]{1,200}$'; then
                    echo "review-exec-guard: unsafe session identity; allowing command" >&2
                    return 1
                fi
                ;;
        esac
        if [ -n "$candidate" ] && [ "$candidate" != "$value" ]; then
            echo "review-exec-guard: session identities disagree; allowing command" >&2
            return 1
        fi
        candidate="$value"
    done
    [ -n "$candidate" ] || return 1
    printf '%s\n' "$candidate"
}

review_exec_is_conductor() {
    local omt_dir="$1" session_id="$2" job_file job_dir conductor
    [ -d "$omt_dir/jobs" ] || return 1
    for job_file in "$omt_dir"/jobs/chunk-review-*/job.json; do
        [ -f "$job_file" ] && [ ! -L "$job_file" ] || continue
        job_dir=$(dirname "$job_file")
        [ -d "$job_dir" ] || continue
        conductor=$(jq -er '.conductorSessionId | strings' "$job_file" 2>/dev/null) || continue
        [ "$conductor" = "$session_id" ] && return 0
    done
    return 1
}

review_exec_is_active() {
    local omt_dir="$1" session_id="$2"
    [ "${OMT_REVIEW_ROLE:-}" = "member" ] && return 0
    review_exec_is_conductor "$omt_dir" "$session_id"
}

# Preserve text while masking shell metacharacters that are inert inside
# quotes or escaped. The remaining live chain separators make each executable
# command start visible to the classifier without substring matching.
review_exec_normalize_command() {
    printf '%s' "$1" | awk '
        BEGIN { sq=sprintf("%c",39); dq=sprintf("%c",34); bs=sprintf("%c",92) }
        {
            out=""; insq=0; indq=0; escaped=0; n=length($0)
            for (i=1; i<=n; i++) {
                c=substr($0,i,1); prev=(i == 1 ? "" : substr($0,i-1,1))
                if (escaped) { out=out ((c ~ /[;|&<>]/) ? " " : c); escaped=0; continue }
                if (!insq && c == bs) { escaped=1; continue }
                if (!indq && c == sq) { insq=!insq; continue }
                if (!insq && c == dq) { indq=!indq; continue }
                if (!insq && !indq && c == "#" && (i == 1 || prev ~ /[ \t]/)) break
                if ((insq || indq) && c ~ /[;|&<>]/) { out=out " "; continue }
                out=out c
            }
            printf "%s;", out
        }'
}

review_exec_segment_denied() {
    local segment="$1"
    printf '%s\n' "$segment" | awk '
        function gradle_task_denied(argument, task) {
            task=argument
            sub(/^.*:/, "", task)
            return task ~ /^(test([A-Z].*)?|build|check|assemble.*|compile.*|classes|lint.*|ktlint.*|detekt.*)$/
        }
        function gradle_denied(words, start, count, i, argument, first_task, task_query_index) {
            for (i=start + 1; i<=count; i++) {
                argument=words[i]
                if (argument == "--task") task_query_index=i
                if (argument ~ /^-/) continue
                if (first_task == "") first_task=argument
            }
            for (i=start + 1; i<=count; i++) {
                argument=words[i]
                if (argument ~ /^-/) continue
                if (first_task == "help" && i == task_query_index + 1) continue
                if (gradle_task_denied(argument)) return 1
            }
            return 0
        }
        function maven_denied(words, start, count, i, argument) {
            for (i=start + 1; i<=count; i++) {
                argument=words[i]
                if (argument ~ /^(compile|test-compile|test|integration-test|package|verify|install|ktlint:check|detekt:check)$/) return 1
            }
            return 0
        }
        function high_cost(words, start, count, tool, subcommand, third) {
            tool=words[start]
            sub(/^.*\//, "", tool)
            subcommand=words[start + 1]
            third=words[start + 2]
            if (tool ~ /^(pnpm|npm|yarn)$/)
                return subcommand ~ /^(test|build|install|lint)$/ || (subcommand == "run" && third ~ /^(test|build|lint)$/)
            if (tool == "bun")
                return subcommand ~ /^(test|build|install|lint)$/ || (subcommand == "run" && third ~ /^(test|build|lint)$/)
            if (tool ~ /^(pytest|py\.test|jest|vitest|mocha|ava|tsc|eslint|biome|ruff)$/) return 1
            if (tool == "cargo") return subcommand ~ /^(test|build|check)$/
            if (tool == "go") return subcommand ~ /^(test|build)$/
            if (tool == "make") return subcommand ~ /^(test|build|lint)$/
            if (tool ~ /^(gradle|gradlew)$/) return gradle_denied(words, start, count)
            if (tool ~ /^(mvn|mvnw)$/) return maven_denied(words, start, count)
            if (tool ~ /^(ktlint|detekt|kotlinc|javac)$/) return 1
            if (tool ~ /^(java|kotlin)$/) return subcommand !~ /^--?version$/
            return 0
        }
        {
            gsub(/^[ \t]+|[ \t]+$/, "")
            if ($0 == "") next
            count=split($0, words, /[ \t]+/)
            start=1
            while (start <= count && words[start] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) start++
            if (start > count) next
            if (high_cost(words, start, count)) exit 0
            if (words[start] ~ /(^|\/)(sh|bash|zsh)$/) {
                for (i=start + 1; i<=count; i++) if (words[i] == "-c" && i + 1 <= count && high_cost(words, i + 1, count)) exit 0
            }
            exit 1
        }
        END { if (NR == 0) exit 1 }'
}

review_exec_command_denied() {
    local command="$1" normalized segment
    normalized=$(review_exec_normalize_command "$command") || return 1
    while IFS= read -r segment; do
        review_exec_segment_denied "$segment" && return 0
    done <<EOF
$(printf '%s' "$normalized" | tr ';|&' '\n')
EOF
    return 1
}
