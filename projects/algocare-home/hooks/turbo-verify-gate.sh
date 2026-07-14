#!/bin/bash
# =============================================================================
# Turbo Verify Gate (PreToolUse hook, algocare-home only)
# Two independent guards over Bash commands in this monorepo:
#   (a) deny an UNFILTERED root `turbo`/`pnpm` test|lint invocation — running
#       the whole monorepo's test/lint at once blows up RAM. Checked per
#       shell segment (split on &&/||/|/;/newline, leading env-var prefixes
#       like `CI=1 turbo test` stripped) so a leading token can't smuggle a
#       root invocation past the guard.
#   (b) best-effort inject a concurrency/fork cap into an already-filtered
#       turbo/vitest/jest command that omits one, so parallel workers don't
#       exhaust RAM either. Only applied when the whole command is a single
#       simple command (no &&/||/|/;/newline/redirect/subshell) whose first
#       token (after stripping a leading env-var prefix) is actually the
#       turbo/vitest/jest program — never a bareword match anywhere in the
#       string, which would otherwise mis-fire on e.g. `grep -rn jest src/`
#       or tail-append the flag onto the wrong side of a compound command.
# Self-contained (no `source` of a shared lib) and fail-open: this is a
# performance gate, not a security gate, so any parse hiccup must fall
# through to passthrough (exit 0, no output) rather than block the command.
# matcher: "Bash"
# =============================================================================

input=$(cat)
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Rule 1 — only Bash commands, only non-empty commands.
if [[ "$tool_name" != "Bash" || -z "$cmd" ]]; then
    exit 0
fi

# -----------------------------------------------------------------------------
# Shared helpers
# -----------------------------------------------------------------------------
# Leading `VAR=val ` environment-variable prefix (bash `FOO=bar cmd` form).
_env_prefix_re='^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]* +'

# strip_env_prefix <str> — echoes <str> with all leading `VAR=val ` prefixes
# repeatedly removed (bash allows more than one, e.g. `A=1 B=2 turbo test`).
strip_env_prefix() {
    local s="$1"
    while [[ "$s" =~ $_env_prefix_re ]]; do
        s="${s:${#BASH_REMATCH[0]}}"
    done
    printf '%s' "$s"
}

_deny_turbo_re='^turbo([[:space:]]+run)?[[:space:]]+(test|lint)([[:space:]]|$)'
_deny_pnpm_re='^pnpm([[:space:]]+run)?[[:space:]]+(test|lint)([[:space:]]|$)'
_has_filter_re='(^|[[:space:]])(--filter|-F|--affected)([[:space:]=]|$)'

# -----------------------------------------------------------------------------
# Rule 2 — unfiltered root verify deny.
# Bare `turbo test`/`turbo lint`/`turbo run test`/`turbo run lint` (script
# name exactly "test"/"lint" — NOT "test:changed" etc., enforced by the
# ([[:space:]]|$) terminator) with none of --filter/-F/--affected present.
# Same shape for `pnpm test`/`pnpm lint`/`pnpm run test`/`pnpm run lint`.
# Split the full command into shell segments on &&/||/|/; and newlines, then
# check each segment independently (after stripping its own leading env-var
# prefix and whitespace) — this is what catches `cd x && turbo test` and
# `CI=1 pnpm test`, which a single whole-string match would miss.
# -----------------------------------------------------------------------------
_segments="${cmd//&&/$'\n'}"
_segments="${_segments//||/$'\n'}"
_segments="${_segments//|/$'\n'}"
_segments="${_segments//;/$'\n'}"

_deny_matched=0
while IFS= read -r _seg; do
    while [[ "$_seg" =~ ^[[:space:]] ]]; do
        _seg="${_seg:1}"
    done
    _seg="$(strip_env_prefix "$_seg")"
    if [[ "$_seg" =~ $_deny_turbo_re || "$_seg" =~ $_deny_pnpm_re ]] && [[ ! "$_seg" =~ $_has_filter_re ]]; then
        _deny_matched=1
        break
    fi
done <<< "$_segments"

if [[ "$_deny_matched" -eq 1 ]]; then
    reason="무필터 root 검증은 모노레포 전체를 실행해 RAM 폭증을 유발합니다. \`pnpm verify:quick\`(변경분 영향 범위) 또는 \`pnpm verify:full\`(affected 패키지), 또는 \`--filter=@algocare/<app>\` / \`--affected\` 를 사용하세요."
    jq -n --arg reason "$reason" \
        '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
    exit 0
fi

# -----------------------------------------------------------------------------
# Rule 3 — best-effort concurrency/fork cap injection.
# Only applies when the whole command is a single simple command: no shell
# control operators, redirects, subshells, or command substitution. Any of
# these markers disqualifies injection because tail-appending a flag onto a
# compound command can land it on the wrong program (or a program that
# doesn't accept it) instead of turbo/vitest/jest:
#   && || | ; <newline> > < ` $(
# When eligible, the actual invoked program is the first whitespace token
# after stripping a leading env-var prefix — not a bareword match anywhere
# in the string.
# -----------------------------------------------------------------------------
_is_compound=0
case "$cmd" in
    *'&&'*|*'||'*|*'|'*|*';'*|*$'\n'*|*'>'*|*'<'*|*'`'*|*'$('*)
        _is_compound=1
        ;;
esac

_has_concurrency_re='(^|[[:space:]])--concurrency([[:space:]=]|$)'
_has_maxforks_re='(^|[[:space:]])--maxForks([[:space:]=]|$)'
_has_pool_re='(^|[[:space:]])--pool([[:space:]=]|$)'
_has_maxworkers_re='(^|[[:space:]])--maxWorkers([[:space:]=]|$)'

new_cmd="$cmd"
injected=0

if [[ "$_is_compound" -eq 0 ]]; then
    _eff="$(strip_env_prefix "$cmd")"
    while [[ "$_eff" =~ ^[[:space:]] ]]; do
        _eff="${_eff:1}"
    done
    _first_token=""
    if [[ "$_eff" =~ ^([^[:space:]]+) ]]; then
        _first_token="${BASH_REMATCH[1]}"
    fi

    if [[ "$_first_token" == "turbo" && "$cmd" =~ $_has_filter_re && ! "$cmd" =~ $_has_concurrency_re ]]; then
        new_cmd="$new_cmd --concurrency=1"
        injected=1
    elif [[ "$_first_token" == "vitest" && ! "$cmd" =~ $_has_maxforks_re && ! "$cmd" =~ $_has_pool_re ]]; then
        new_cmd="$new_cmd --maxForks=2"
        injected=1
    elif [[ "$_first_token" == "jest" && ! "$cmd" =~ $_has_maxworkers_re ]]; then
        new_cmd="$new_cmd --maxWorkers=2"
        injected=1
    fi
fi

if [[ "$injected" -eq 1 ]]; then
    jq -n --arg cmd "$new_cmd" \
        '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:{command:$cmd}}}'
fi

exit 0
