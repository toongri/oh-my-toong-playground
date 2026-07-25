#!/bin/bash
# =============================================================================
# Codex PreToolUse Spawn-Depth Gate
#
# codex's own `[agents] max_depth` config key is MEASURED to be inert on the
# V2 subagent-dispatch path (probed against codex 0.145.0 under an isolated
# HOME: max_depth=1 in config did not stop a depth-2 spawn from completing;
# upstream's own doc string marks the key "Ignored by V2", and
# multi_agents_v2/spawn.rs carries no depth-comparison gate at all). This
# hook exists to fill that gap: it is the ONLY thing enforcing a spawn-depth
# cap on the V2 path today.
#
# The judgment needs no state file and no parent-child correlation tracking.
# codex itself already writes the CALLER's own spawn depth as the first line
# of that caller's OWN rollout transcript (`.payload.source.subagent.
# thread_spawn.depth`, present only on a spawned subagent's rollout, absent
# on a root session's), and the PreToolUse payload's `transcript_path` always
# points at that same caller's transcript -- so reading ONE file already
# named in the payload is sufficient. The three-line judgment:
#   cur   = rollout's .payload.source.subagent.thread_spawn.depth (else 0)
#   child = cur + 1
#   child > CAP -> deny
#
# Deliberately excluded from this hook's scope (do not add here): any
# leaf-marker check (agent_role, ~/.codex/agents/<role>.toml) -- if the
# judgment ever needs more than the depth number alone, that is a new,
# separately-scoped change, not an extension of this file.
#
# Known unclosed residual risks, by design:
#   - Fail-open is a SILENT no-op. Every read failure below (jq absent, no
#     transcript_path, missing rollout file, unparseable rollout JSON, a
#     non-numeric depth value) falls through to cur=0/child=1, which always
#     passes -- there is no diagnostic emitted anywhere on that path. This is
#     a deliberate trade favoring zero false-denies (a false deny here has no
#     bypass/ask escape hatch and would be unrecoverable for the caller) over
#     any visibility into "the cap silently stopped applying".
#   - codex is measured to respect BOTH a stdout `permissionDecision` JSON
#     (exit 0) and a nonzero-exit + stderr deny -- this hook uses the former,
#     the same OMT-wide envelope shape write-guard-core.sh's
#     _wg_core_deny_json already uses (deny JSON referenced for SHAPE only;
#     this file does not source or modify that core -- see CLAUDE.md's
#     write-guard-core.sh entry for why: it is a Claude<->Codex shared core
#     and this depth gate has no Claude-side twin, since Claude enforces the
#     same cap natively via CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH).
# =============================================================================
set -euo pipefail

# CAP: the maximum depth a spawned child is allowed to reach. Root session =
# depth 0 (unwritten in its own rollout, read as cur=0 below); a child
# spawned from the root reaches depth 1; a grandchild reaches depth 2; CAP=2
# permits that grandchild generation and blocks the next spawn beyond it.
# Matches CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2's own root=0 counting basis
# on the Claude side, so the two platforms cap at the same real generation.
CAP=2
# lazy: CAP is a hardcoded constant. If a project ever needs a different cap,
# the upgrade path is an env-var prefix on the command line this hook is
# registered under in .codex/hooks.json (e.g. `SPAWN_DEPTH_CAP=3 bash
# codex-spawn-depth-gate.sh`), read here in place of the literal. Not done
# now because no project has asked for a non-default cap yet, and who would
# make that call (this hook's own default vs. a per-project override) is
# still undecided -- there is no signal yet to decide it against.

# stdin is read unconditionally, before the jq-presence check, mirroring
# hooks/codex-write-guard.sh's own stdin posture -- there is nothing in this
# payload the jq-absent path needs, but reading stdin first (rather than only
# on the jq-present branch) keeps this shim's shape consistent with its
# sibling.
input=$(cat)

if ! command -v jq > /dev/null 2>&1; then
    exit 0
fi

# Double-check the tool name inside the script itself, independent of
# whatever matcher .codex/hooks.json is registered under (that registration
# is a later story's concern) -- so a widened or reworded matcher upstream
# can never silently hand this judgment a tool call it was not meant for.
# The real Codex tool name observed is `collaborationspawn_agent`; matched as
# a suffix (`*spawn_agent`) rather than an exact string so a future rename
# that still ends in `spawn_agent` keeps working. Lowercased first (same
# normalization posture as hooks/codex-write-guard.sh) so a differently-cased
# variant is not missed.
tool_name_raw=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || tool_name_raw=""
tool_name=$(printf '%s' "$tool_name_raw" | tr '[:upper:]' '[:lower:]')
case "$tool_name" in
    *spawn_agent) ;;
    *) exit 0 ;;
esac

transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null) || transcript_path=""
[ -n "$transcript_path" ] || exit 0
[ -f "$transcript_path" ] || exit 0

# Read only the first 3 lines, not the whole (potentially large) transcript.
# A 20-rollout manual scan found every rollout that carries thread_spawn
# carries it on line 1 (8/8), with zero occurrences on line 2 or 3 across
# rollouts with or without it -- 1 line would already suffice, 3 is kept as
# margin against an ordering variation this small sample would not surface.
#
# Per-line jq failure (a genuinely malformed line) must not abort the whole
# scan under `set -e` -- `|| depth=""` on the jq call, plus the `|| true` on
# the whole loop's input redirection, keep a bad or missing rollout file a
# silent fail-open (cur stays unset -> defaults to 0 below) rather than a
# script crash.
cur=""
# `|| [ -n "$line" ]` keeps the loop body running on a final line with no
# trailing newline (`read` returns non-zero there and would otherwise drop
# it) -- same guarded idiom as hooks/codex-write-guard.sh:333.
while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    depth=$(printf '%s' "$line" | jq -r '.payload.source.subagent.thread_spawn.depth // empty' 2>/dev/null) || depth=""
    if [ -n "$depth" ]; then
        cur="$depth"
        break
    fi
done < <(head -3 -- "$transcript_path" 2>/dev/null || true)

# A non-numeric cur (schema drift, a corrupted line that still yielded some
# non-empty jq output) must not reach the arithmetic below -- bash arithmetic
# on a non-integer aborts the script, which is a fail-CLOSED shape this hook
# must never take. Falls back to the same safe default (0) as "not found".
#
# *[!0-9]* alone is not enough: "08"/"09"/"010" are ALL-digit strings that
# pass that pattern unchanged, yet bash arithmetic reads a leading-0 operand
# as octal and $((08 + 1)) aborts the script -- the exact fail-CLOSED shape
# this guard exists to prevent. The `10#` prefix forces base-10 interpretation
# so a well-formed all-digit value never gets octal-misread.
case "$cur" in
    '' | *[!0-9]*) cur=0 ;;
    *) cur=$((10#$cur)) ;;
esac

child=$((cur + 1))

if [ "$child" -gt "$CAP" ]; then
    jq -nc --argjson child "$child" --argjson cap "$CAP" '
        {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: (
                    "Blocked: subagent spawn would reach depth "
                    + ($child | tostring)
                    + ", exceeding the cap of "
                    + ($cap | tostring)
                    + " (root session = depth 0)."
                )
            }
        }'
fi

exit 0
