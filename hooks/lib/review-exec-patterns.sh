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

# Resolves the deployed location of the code-review job CLI relative to this
# shared lib file's own path, since the lib deploys to a different directory
# per platform: hooks_dir is this file's parent's parent (the hooks root),
# so this works whether hooks_dir is the source tree's hooks/, Claude's
# .claude/hooks/, or Codex's .codex/hooks/.
review_exec_job_cli() {
    local hooks_dir candidate
    hooks_dir="$(dirname "$(dirname "${BASH_SOURCE[0]}")")"
    for candidate in \
        "$hooks_dir/../skills/code-review/scripts/job.ts" \
        "$hooks_dir/../../.agents/skills/code-review/scripts/job.ts"; do
        if [ -f "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

# Judges whether a session identified as a matching chunk-review job's
# conductor should be gated: "active" (a matching job has an active member,
# deny), "allow" (no matching job, or all matching jobs are inactive), or
# "indeterminate" (activity could not be established, fail closed). Echoes
# exactly one of those three tokens.
review_exec_should_gate_conductor() {
    local omt_dir="$1" session_id="$2"
    local job_file job_dir conductor
    local -a matched_jobs
    matched_jobs=()

    for job_file in "$omt_dir"/jobs/chunk-review-*/job.json; do
        [ -f "$job_file" ] && [ ! -L "$job_file" ] || continue
        job_dir=$(dirname "$job_file")
        conductor=$(jq -er '.conductorSessionId | strings' "$job_file" 2>/dev/null) || continue
        [ "$conductor" = "$session_id" ] || continue
        matched_jobs[${#matched_jobs[@]}]="$job_dir"
    done

    if [ "${#matched_jobs[@]}" -eq 0 ]; then
        echo "allow"
        return 0
    fi

    local cli
    cli=$(review_exec_job_cli) || { echo "indeterminate"; return 0; }

    local out rc=0
    out=$(bun "$cli" active-members "${matched_jobs[@]}" 2>/dev/null) || rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "indeterminate"
        return 0
    fi

    local activity
    activity=$(printf '%s' "$out" | jq -er '.activity' 2>/dev/null) || { echo "indeterminate"; return 0; }
    [ -n "$activity" ] || { echo "indeterminate"; return 0; }

    case "$activity" in
        inactive) echo "allow" ;;
        active) echo "active" ;;
        *) echo "indeterminate" ;;
    esac
}

# Spawn-time role marker on the worker process, deliberately independent of
# session identity: a Claude conductor spawns the default Codex finders with its
# own OMT_SESSION_ID inherited through the environment while the nested Codex
# session supplies its own CODEX_THREAD_ID, so those two identities disagree and
# review_exec_session_id refuses to resolve. Callers must consult this BEFORE
# reconciling identities, or the guard falls open on that very path.
review_exec_is_member() {
    [ "${OMT_REVIEW_ROLE:-}" = "member" ]
}

# Preserve executable text while masking shell syntax that is inert. Live
# command substitutions become their own segments for static classification.
review_exec_normalize_command() {
    printf '%s' "$1" | awk '
        BEGIN { sq=sprintf("%c",39); dq=sprintf("%c",34); bs=sprintf("%c",92); dl=sprintf("%c",36); lp=sprintf("%c",40); rp=sprintf("%c",41); bt=sprintf("%c",96) }
        {
            out=""; insq=0; indq=0; n=length($0)
            for (i=1; i<=n; i++) {
                c=substr($0,i,1); prev=(i == 1 ? "" : substr($0,i-1,1))
                if (insq) {
                    if (c == sq) insq=0
                    else out=out ((c == dl || c == lp || c == rp || c == bt) ? " " : c)
                    continue
                }
                if (c == bs && i < n) { out=out "  "; i++; continue }
                if (c == sq && !indq) { insq=1; continue }
                if (c == dq) { indq=!indq; continue }
                # Double-quoted text is kept on the same terms as single-quoted
                # text: dropping it entirely let a quoted command name ("yarn"
                # build) reach the classifier as a bare argument list. Live
                # substitutions inside the quotes are already split out above,
                # so what remains here is either literal or an unexpandable
                # variable reference, which is blanked like the single-quoted case.
                if ((c == dl || c == "<" || c == ">") && i < n && substr($0,i+1,1) == lp) {
                    depth=1; body=""; body_sq=0; body_dq=0; i+=2
                    for (; i<=n && depth>0; i++) {
                        c=substr($0,i,1)
                        if (body_sq) { if (c == sq) body_sq=0; body=body c; continue }
                        if (c == bs && i < n) { body=body c substr($0,i+1,1); i++; continue }
                        if (c == sq && !body_dq) { body_sq=1; body=body c; continue }
                        if (c == dq) { body_dq=!body_dq; body=body c; continue }
                        if (!body_dq && c == lp) depth++
                        if (!body_dq && c == rp) { depth--; if (depth == 0) break }
                        body=body c
                    }
                    out=out ";" body ";"
                    continue
                }
                if (c == bt) {
                    body=""; i++
                    for (; i<=n; i++) {
                        c=substr($0,i,1)
                        if (c == bs && i < n) { body=body c substr($0,i+1,1); i++; continue }
                        if (c == bt) break
                        body=body c
                    }
                    out=out ";" body ";"
                    continue
                }
                if (!insq && !indq && c == "#" && (i == 1 || prev ~ /[ \t]/)) break
                if (indq) { out=out ((c == dl || c == lp || c == rp || c == bt) ? " " : c); continue }
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
        # Runners and interpreter module invocations (npx, pnpm exec, bun x,
        # yarn dlx, python -m, uv run, ...) are transparent wrappers: the
        # high-cost binary is the wrapper argument, not the wrapper. Advance past
        # the wrapper and its own flags so the real target reaches high_cost.
        # start strictly increases each round, so this terminates.
        function strip_runner(words, start, count, tool, subcommand) {
            while (start < count) {
                tool=words[start]
                sub(/^.*\//, "", tool)
                subcommand=words[start + 1]
                if (tool ~ /^(npx|bunx|pnpx)$/) {
                    start++
                    while (start <= count && words[start] ~ /^-/) {
                        if (words[start] == "--") { start++; break }
                        if (words[start] ~ /^(-p|--package|-c|--call)$/) start += 2
                        else start++
                    }
                    continue
                }
                if (tool ~ /^(pnpm|npm|yarn|bun)$/ && subcommand ~ /^(exec|x|dlx)$/) {
                    start += 2
                    while (start <= count && words[start] ~ /^-/) {
                        if (words[start] == "--") { start++; break }
                        start++
                    }
                    continue
                }
                # `python -m mod` runs the named module as a script, so the
                # module is the executable under judgment, not the interpreter.
                if (tool ~ /^python[0-9.]*$/ && subcommand == "-m") { start += 2; continue }
                if (tool ~ /^(uv|poetry|pipenv)$/ && subcommand == "run") {
                    start += 2
                    while (start <= count && words[start] ~ /^-/) {
                        if (words[start] == "--") { start++; break }
                        start++
                    }
                    continue
                }
                break
            }
            return start
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
            if (tool ~ /^(pytest|py\.test|unittest|jest|vitest|mocha|ava|tsc|mypy|eslint|biome|ruff)$/) return 1
            if (tool == "cargo") return subcommand ~ /^(test|build|check)$/
            if (tool == "go") return subcommand ~ /^(test|build)$/
            if (tool == "make") return subcommand ~ /^(test|build|lint)$/
            if (tool ~ /^(gradle|gradlew)$/) return gradle_denied(words, start, count)
            if (tool ~ /^(mvn|mvnw)$/) return maven_denied(words, start, count)
            if (tool ~ /^(ktlint|detekt|kotlinc|javac)$/) return 1
            if (tool ~ /^(java|kotlin)$/) return !(count == start + 1 && subcommand ~ /^--?version$/)
            return 0
        }
        {
            gsub(/^[ \t]+|[ \t]+$/, "")
            if ($0 == "") next
            seen=1
            count=split($0, words, /[ \t]+/)
            start=1
            while (start <= count && words[start] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) start++
            if (words[start] == "env") {
                start++
                while (start <= count) {
                    argument=words[start]
                    if (argument == "--") { start++; break }
                    if (argument ~ /^[A-Za-z_][A-Za-z0-9_]*=/ || argument ~ /^-[i0]$/ || argument ~ /^--(ignore-environment|null)$/ || argument ~ /^--(unset|chdir)=/) { start++; continue }
                    if (argument == "-u" || argument == "--unset" || argument == "-C" || argument == "--chdir") { start += 2; continue }
                    if (argument ~ /^-/) { start++; continue }
                    break
                }
            }
            if (start > count) next
            start=strip_runner(words, start, count)
            if (start > count) next
            classified=1
            if (high_cost(words, start, count)) exit 0
            exit 1
        }
        END { if (!classified) exit 1 }'
}

review_exec_shell_body() {
    local segment="$1"
    printf '%s\n' "$segment" | awk '
        {
            count=split($0, words, /[ \t]+/)
            start=1
            while (start <= count && words[start] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) start++
            if (words[start] == "env") {
                start++
                while (start <= count) {
                    argument=words[start]
                    if (argument == "--") { start++; break }
                    if (argument ~ /^[A-Za-z_][A-Za-z0-9_]*=/ || argument ~ /^-[i0]$/ || argument ~ /^--(ignore-environment|null)$/ || argument ~ /^--(unset|chdir)=/) { start++; continue }
                    if (argument == "-u" || argument == "--unset" || argument == "-C" || argument == "--chdir") { start += 2; continue }
                    if (argument ~ /^-/) { start++; continue }
                    break
                }
            }
            if (start > count || words[start] !~ /(^|\/)(sh|bash|zsh)$/) next
            for (i=start + 1; i<=count; i++) {
                argument=words[i]
                if (argument == "--") continue
                if (argument == "-c" || argument ~ /^-[A-Za-z]*c[A-Za-z]*$/) {
                    if (i + 1 > count) next
                    body=""
                    for (j=i + 1; j<=count; j++) body=body (j == i + 1 ? "" : " ") words[j]
                    if (body ~ /^\047.*\047$/ || body ~ /^\042.*\042$/) {
                        body=substr(body, 2, length(body) - 2)
                    }
                    print body
                    next
                }
            }
        }'
}

review_exec_enqueue_shorter_unseen() {
    local candidate="$1" current="$2" known
    [ -n "$candidate" ] || return 0
    [ "$candidate" != "$current" ] || return 0
    [ "${#candidate}" -lt "${#current}" ] || return 0
    for known in "${review_exec_seen[@]}"; do
        [ "$known" = "$candidate" ] && return 0
    done
    review_exec_seen[${#review_exec_seen[@]}]="$candidate"
    review_exec_worklist[${#review_exec_worklist[@]}]="$candidate"
}

review_exec_command_denied_walk() {
    local command="$1" current normalized segment shell_body
    local work_index=0
    local -a review_exec_worklist review_exec_seen
    review_exec_worklist[0]="$command"
    review_exec_seen[0]="$command"

    while [ "$work_index" -lt "${#review_exec_worklist[@]}" ]; do
        current="${review_exec_worklist[$work_index]}"
        work_index=$((work_index + 1))

        review_exec_segment_denied "$current" && return 0
        shell_body=$(review_exec_shell_body "$current")
        review_exec_enqueue_shorter_unseen "$shell_body" "$current"

        normalized=$(review_exec_normalize_command "$current") || continue
        while IFS= read -r segment; do
            review_exec_segment_denied "$segment" && return 0
            shell_body=$(review_exec_shell_body "$segment")
            review_exec_enqueue_shorter_unseen "$shell_body" "$current"
            review_exec_enqueue_shorter_unseen "$segment" "$current"
        done <<EOF
$(printf '%s' "$normalized" | tr ';|&' '\n')
EOF
    done
    return 1
}

review_exec_command_denied() {
    review_exec_command_denied_walk "$1"
}
