#!/bin/bash
# Shared QA E2E-driver recognition and session helpers.
#
# This file deliberately owns command recognition only.  The arming predicate
# is computed by TypeScript and persisted as derived.driver_gate_armed; the
# shims below read that boolean rather than reproducing phase or chain math.

qa_driver_session_id() {
    local payload_sid="$1" candidate="" value=""
    for value in "${OMT_SESSION_ID:-}" "${CODEX_THREAD_ID:-}" "$payload_sid"; do
        [ -n "$value" ] || continue
        case "$value" in
            *[!A-Za-z0-9_-]*|?*)
                if ! printf '%s' "$value" | grep -qE '^[A-Za-z0-9_-]{1,200}$'; then
                    return 1
                fi
                ;;
        esac
        if [ -n "$candidate" ] && [ "$candidate" != "$value" ]; then
            return 1
        fi
        candidate="$value"
    done
    [ -n "$candidate" ] || return 1
    printf '%s\n' "$candidate"
}

# Return success when a shell command's executable is one of the declared QA
# drivers.  Commands are split at shell separators and common runner wrappers
# are skipped, so an argument/prose mention is not enough to arm the gate.
qa_driver_command_is_e2e() {
    printf '%s\n' "$1" | awk '
        function basename(word) {
            gsub(/^["\047`]+|["\047`]+$/, "", word)
            sub(/^.*\//, "", word)
            return word
        }
        function skip_runner(words, i, n, tool, subcommand) {
            while (i <= n) {
                tool=basename(words[i])
                subcommand=words[i+1]
                if (tool ~ /^(npx|bunx|pnpx)$/) {
                    i++
                    while (i <= n && words[i] ~ /^-/) {
                        if (words[i] ~ /^(-p|--package)$/) i += 2
                        else i++
                    }
                    continue
                }
                if (tool ~ /^(pnpm|npm|yarn|bun)$/ && subcommand ~ /^(exec|x|dlx)$/) {
                    i += 2
                    while (i <= n && words[i] ~ /^-/) i++
                    continue
                }
                break
            }
            return i
        }
        {
            # Evaluate each command segment independently so `git diff &&
            # agent-device ...` is still recognized, without treating a later
            # argument such as `printf %s agent-device` as a command.
            nsegments=split($0, segments, /[;&|()<>]+/)
            for (segment=1; segment<=nsegments; segment++) {
                line=segments[segment]
                n=split(line, words, /[[:space:]]+/)
                i=1
                while (i <= n && (words[i] == "" || words[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=/)) i++
                if (i > n) continue
                if (basename(words[i]) == "env") {
                    i++
                    while (i <= n && (words[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=/ || words[i] ~ /^-/)) i++
                }
                if (i > n) continue
                i=skip_runner(words, i, n)
                if (i <= n && basename(words[i]) ~ /^(agent-(browser|device)|curl|bash)$/) found=1
            }
        }
        END { exit(found ? 0 : 1) }
    '
}

qa_driver_deny_reason() {
    printf '%s\n' 'QA driver gate: author the actor roster and scenario cells before running agent-device, agent-browser, curl, or bash commands.'
}
