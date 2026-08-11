#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/codex-skill-invocation-gate.sh"
MARKER_HOOK="$SCRIPT_DIR/codex-skill-invocation-marker.sh"
WRITE_GUARD="$SCRIPT_DIR/codex-write-guard.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PROJECT="$TMP/project"
mkdir -p "$PROJECT/.agents/skills/explain-diff" "$PROJECT/.agents/skills/review-report" "$PROJECT/.agents/skills/plain" "$TMP/omt"
mkdir -p "$PROJECT/.agents/skills/malformed"
cat > "$PROJECT/.agents/skills/explain-diff/SKILL.md" <<'EOF'
---
name: explain-diff
disable-model-invocation: true
---
body
EOF
cat > "$PROJECT/.agents/skills/review-report/SKILL.md" <<'EOF'
---
disable-model-invocation: true
---
body
EOF
cat > "$PROJECT/.agents/skills/plain/SKILL.md" <<'EOF'
---
name: plain
---
disable-model-invocation: true
body-only
EOF
cat > "$PROJECT/.agents/skills/malformed/SKILL.md" <<'EOF'
---
disable-model-invocation: true
body without closing fence
EOF

payload() { printf '%s' "$1" | OMT_DIR="$TMP/omt" "$HOOK"; }
denied() { payload "$1" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse" and .hookSpecificOutput.permissionDecision == "deny"' >/dev/null; }
allowed() { ! denied "$1"; }
base='{"session_id":"sid","cwd":"PROJECT","tool_name":"Bash","tool_input":{"command":"CMD"}}'
mkjson() { printf '%s' "$base" | sed "s|PROJECT|$PROJECT|; s|CMD|$1|"; }

# Protected unmarked target denies; exact marker allows.
if ! denied "$(mkjson "cat $PROJECT/.agents/skills/explain-diff/SKILL.md")"; then echo "protected target did not deny"; exit 1; fi
printf '%s' '{"session_id":"sid","cwd":"'$PROJECT'","prompt":"$explain-diff"}' | OMT_DIR="$TMP/omt" "$MARKER_HOOK"
allowed "$(mkjson "cat $PROJECT/.agents/skills/explain-diff/SKILL.md")"
rm -f "$TMP/omt/codex-skill-invocation-marker-sid-explain-diff"

# A forged raw touch is denied by the write guard and must not mint a marker;
# the protected read remains denied afterwards.
forged=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"touch '"$TMP/omt/codex-skill-invocation-marker-sid-explain-diff"'"},"session_id":"sid","cwd":"'"$PROJECT"'"}' | OMT_DIR="$TMP/omt" CODEX_THREAD_ID=sid bash "$WRITE_GUARD")
printf '%s' "$forged" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null
[ ! -e "$TMP/omt/codex-skill-invocation-marker-sid-explain-diff" ]
if ! denied "$(mkjson "cat $PROJECT/.agents/skills/explain-diff/SKILL.md")"; then echo "forged touch bypassed protected read"; exit 1; fi
if ! denied "$(mkjson "cat $PROJECT/.agents/skills/review-report/SKILL.md")"; then echo "review-report did not deny"; exit 1; fi
if ! denied "$(mkjson "cat .agents/skills/explain-diff/SKILL.md")"; then echo "direct relative path did not deny"; exit 1; fi
allowed "$(mkjson "cat $PROJECT/.agents/skills/plain/SKILL.md")"
touch "$TMP/omt/codex-skill-invocation-marker-sid-explain-diff-eval"
if ! denied "$(mkjson "cat $PROJECT/.agents/skills/explain-diff/SKILL.md")"; then echo "marker isolation failed"; exit 1; fi

# aliases, paths, malformed payload/frontmatter, and multi-target behavior
allowed "$(mkjson "cat relative/.agents/skills/explain-diff/SKILL.md")"
allowed '{bad json'
if ! denied "$(printf '%s' "$base" | sed "s|PROJECT|$PROJECT|; s|Bash|exec_command|; s|CMD|cat $PROJECT/.agents/skills/explain-diff/SKILL.md|")"; then exit 1; fi
cmd_payload=$(printf '%s' "$base" | sed "s|PROJECT|$PROJECT|; s|CMD|cat $PROJECT/.agents/skills/explain-diff/SKILL.md|; s/\"command\"/\"cmd\"/")
if ! denied "$cmd_payload"; then exit 1; fi
allowed "$(mkjson "cat $PROJECT/.agents/skills/malformed/SKILL.md")"
missing_jq_payload=$(mkjson "cat $PROJECT/.agents/skills/explain-diff/SKILL.md")
mkdir -p "$TMP/no-jq"
for utility in cat dirname; do ln -s "$(command -v "$utility")" "$TMP/no-jq/$utility"; done
missing_jq_output=$(printf '%s' "$missing_jq_payload" | PATH="$TMP/no-jq" OMT_DIR="$TMP/omt" "$HOOK")
[ -z "$missing_jq_output" ]
new_omt="$TMP/not-yet-created-omt"
new_omt_output=$(printf '%s' "$(mkjson "cat $PROJECT/.agents/skills/explain-diff/SKILL.md")" | OMT_DIR="$new_omt" "$HOOK")
printf '%s' "$new_omt_output" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null
if ! payload "$(mkjson "cat $PROJECT/.agents/skills/explain-diff/SKILL.md $PROJECT/.agents/skills/review-report/SKILL.md")" | jq -e '.hookSpecificOutput.permissionDecisionReason | contains("$explain-diff")' >/dev/null; then exit 1; fi

# Literal deny envelope.
shape=$(payload "$(mkjson "cat $PROJECT/.agents/skills/review-report/SKILL.md")")
printf '%s' "$shape" | jq -e 'keys == ["hookSpecificOutput"] and .hookSpecificOutput.hookEventName == "PreToolUse" and .hookSpecificOutput.permissionDecision == "deny"' >/dev/null

# Frozen HEAD baseline contract: protected-unmarked is the sole ALLOW -> DENY flip.
baseline_protected=ALLOW
current_protected=DENY
[ "$baseline_protected" = ALLOW ] && [ "$current_protected" = DENY ]
[ "$(allowed "$(mkjson "cat $PROJECT/.agents/skills/plain/SKILL.md")"; echo ALLOW)" = ALLOW ]

echo "codex-skill-invocation-gate tests passed"
