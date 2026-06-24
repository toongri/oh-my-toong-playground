#!/bin/bash
# =============================================================================
# PreCompact Producer Hook Tests (TDD)
# Covers AC-T1.1 .. AC-T1.9 from the compaction-handoff-pipeline plan (T1).
#
# Strategy: stub the summarizers (fake `codex` / `claude` on PATH) so no real
# LLM/network is touched; drive the jq extraction with a fixture transcript
# JSONL grounded on the REAL Claude Code transcript record shape:
#   - user content can be a STRING (the arc-head first turn) or an array of
#     text / tool_result blocks
#   - assistant content is an array of thinking / text / tool_use blocks
#   - machinery records (attachment, file-history-snapshot, mode) have no
#     .message and must be dropped
#   - one tool_result whose content string is > 2000 chars must be truncated
# HOME/PATH isolation + mktemp -d + cleanup trap (OMT shell-test convention).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/pre-compact.sh"

TESTS_PASSED=0
TESTS_FAILED=0

# -----------------------------------------------------------------------------
# Test environment: isolated HOME, isolated PATH with stub summarizers prepended
# (real jq / perl / coreutils still reachable via the inherited system path).
# -----------------------------------------------------------------------------
setup_test_env() {
    TEST_TMP_DIR=$(mktemp -d)

    # Isolated HOME so OMT_DIR resolves under the sandbox, not the real ~/.omt.
    ORIGINAL_HOME="$HOME"
    TEST_HOME=$(mktemp -d)
    export HOME="$TEST_HOME"

    # Project dir with a marker so the hook's project-root walk terminates here.
    TEST_PROJECT_DIR="$TEST_TMP_DIR/project"
    mkdir -p "$TEST_PROJECT_DIR/.git"

    # OMT_DIR is exported directly so compute_omt_dir is a no-op and the handoff
    # lands at a predictable path the assertions can read.
    export OMT_DIR="$TEST_TMP_DIR/omt"
    mkdir -p "$OMT_DIR"

    # Stub bin dir prepended to PATH.
    STUB_BIN="$TEST_TMP_DIR/bin"
    mkdir -p "$STUB_BIN"
    ORIGINAL_PATH="$PATH"
    export PATH="$STUB_BIN:$PATH"

    # Stub control + capture files.
    export STUB_DIR="$TEST_TMP_DIR/stub"
    mkdir -p "$STUB_DIR"
    CODEX_STDIN="$STUB_DIR/codex_stdin.txt"
    CODEX_RC_FILE="$STUB_DIR/codex_rc"
    CLAUDE_STDIN="$STUB_DIR/claude_stdin.txt"
    CLAUDE_RC_FILE="$STUB_DIR/claude_rc"
    CLAUDE_SENTINEL="$STUB_DIR/claude_invoked"
    export STUB_DIR CODEX_STDIN CODEX_RC_FILE CLAUDE_STDIN CLAUDE_RC_FILE CLAUDE_SENTINEL

    # Default return codes (each test overrides as needed).
    echo "0" > "$CODEX_RC_FILE"
    echo "0" > "$CLAUDE_RC_FILE"

    write_codex_stub
    write_claude_stub

    # A clean recursion sentinel state per test.
    unset OMT_HANDOFF_ACTIVE || true
}

teardown_test_env() {
    export HOME="$ORIGINAL_HOME"
    export PATH="$ORIGINAL_PATH"
    unset OMT_DIR || true
    unset OMT_HANDOFF_ACTIVE || true
    [ -d "$TEST_TMP_DIR" ] && rm -rf "$TEST_TMP_DIR"
    [ -d "$TEST_HOME" ] && rm -rf "$TEST_HOME"
}

# The canned 8-section summary base (matches the ^## N. AC greps).
# Stubs embed this with a run-specific marker inside section 1 so that the
# codex and claude outputs are distinguishable (see AC-T1.9 overwrite test).
CANNED_SUMMARY_BASE='## 1. User Requests
- stub user request
STUB_RUN_MARKER_PLACEHOLDER
## 2. Final Goal
- stub goal
## 3. Work Completed
- stub work
## 4. Remaining Tasks
- stub remaining
## 5. Active Working Context (For Seamless Continuation)
- stub context
## 6. Explicit Constraints (Verbatim Only)
- None
## 7. Agent Verification State (Critical for Reviewers)
- stub verification
## 8. Delegated Agent Sessions
- stub delegated'

CODEX_SUMMARY="${CANNED_SUMMARY_BASE/STUB_RUN_MARKER_PLACEHOLDER/CODEX_RUN_MARKER}"
CLAUDE_SUMMARY="${CANNED_SUMMARY_BASE/STUB_RUN_MARKER_PLACEHOLDER/CLAUDE_RUN_MARKER}"

# codex stub: captures stdin, honours `-o OUTFILE` (writes the summary there,
# as the real `codex exec -o` does), exits with the controlled rc.
# No shebang — the resolver skips files whose first two bytes are "#!", so
# this stub must NOT start with "#!" to be selected as a real binary.
# macOS falls back to /bin/sh for shebang-less executables, so the stub still runs.
write_codex_stub() {
    cat > "$STUB_BIN/codex" <<STUB
cat > "$CODEX_STDIN"
out=""
prev=""
for a in "\$@"; do
  if [ "\$prev" = "-o" ]; then out="\$a"; fi
  prev="\$a"
done
rc=\$(cat "$CODEX_RC_FILE" 2>/dev/null || echo 0)
if [ "\$rc" = "0" ] && [ -n "\$out" ]; then
  cat > "\$out" <<'SUMMARY'
$CODEX_SUMMARY
SUMMARY
fi
exit "\$rc"
STUB
    chmod +x "$STUB_BIN/codex"
}

# claude stub: captures stdin, drops a sentinel proving it was invoked, emits a
# JSON line with .result = the canned summary, exits with the controlled rc.
write_claude_stub() {
    cat > "$STUB_BIN/claude" <<STUB
#!/bin/bash
cat > "$CLAUDE_STDIN"
touch "$CLAUDE_SENTINEL"
rc=\$(cat "$CLAUDE_RC_FILE" 2>/dev/null || echo 0)
if [ "\$rc" = "0" ]; then
  result=\$(cat <<'SUMMARY'
$CLAUDE_SUMMARY
SUMMARY
)
  # Emit a single-line JSON object, matching the real
  # \`claude -p --output-format json\` output shape (one JSON line).
  jq -c -n --arg r "\$result" '{result:\$r}'
fi
exit "\$rc"
STUB
    chmod +x "$STUB_BIN/claude"
}

# -----------------------------------------------------------------------------
# Fixture transcript JSONL, grounded on the real record shapes.
# $1 = output path. Writes one record per line.
# -----------------------------------------------------------------------------
FIRST_USER_TURN="IMPLEMENT_THE_PRECOMPACT_HOOK_ARC_HEAD_MARKER"
write_fixture_transcript() {
    local path="$1"
    # A >2000-char tool_result content (3000 'X') to exercise the 2000-char cap.
    local big
    big=$(printf 'X%.0s' $(seq 1 3000))

    : > "$path"
    # 1) arc-head user turn: content is a STRING (real first-turn shape)
    jq -nc --arg t "$FIRST_USER_TURN" '{type:"user", message:{role:"user", content:$t}}' >> "$path"
    # 2) assistant thinking + text + tool_use blocks
    jq -nc '{type:"assistant", message:{role:"assistant", content:[
        {type:"thinking", thinking:"FIXTURE_THINKING_BLOCK", signature:"sig"},
        {type:"text", text:"FIXTURE_ASSISTANT_TEXT"},
        {type:"tool_use", id:"tu_1", name:"Bash", input:{command:"FIXTURE_TOOL_INPUT echo hi"}}
    ]}}' >> "$path"
    # 3) user tool_result with a SMALL string content
    jq -nc '{type:"user", message:{role:"user", content:[
        {type:"tool_result", tool_use_id:"tu_1", content:"FIXTURE_SMALL_TOOL_RESULT"}
    ]}}' >> "$path"
    # 4) user tool_result with a >2000-char string content (must be truncated)
    jq -nc --arg b "BIGRESULT_HEAD_$big" '{type:"user", message:{role:"user", content:[
        {type:"tool_result", tool_use_id:"tu_2", content:$b}
    ]}}' >> "$path"
    # 5) MACHINERY: attachment (no .message — must be dropped)
    jq -nc '{type:"attachment", content:"FIXTURE_ATTACHMENT_LEAK_SHOULD_NOT_APPEAR"}' >> "$path"
    # 6) MACHINERY: file-history-snapshot (no .message — must be dropped)
    jq -nc '{type:"file-history-snapshot", snapshot:"FIXTURE_SNAPSHOT_LEAK_SHOULD_NOT_APPEAR"}' >> "$path"
    # 7) MACHINERY: mode (no .message — must be dropped)
    jq -nc '{type:"mode", mode:"FIXTURE_MODE_LEAK_SHOULD_NOT_APPEAR"}' >> "$path"
    # 8) SKILL injection: isMeta user record whose content is an ARRAY of text
    # blocks, the first beginning with the "Base directory for this skill:" marker
    # followed by the full SKILL.md body. The body must be REPLACED by a one-line
    # name reference; the long body text must NOT reach the summarizer.
    local skill_body
    skill_body=$(printf 'PROMETHEUS_SKILL_BODY_LEAK_SHOULD_NOT_APPEAR %.0s' $(seq 1 200))
    jq -nc --arg b "Base directory for this skill: /abs/path/skills/prometheus

# Prometheus

$skill_body" '{type:"user", isMeta:true, message:{role:"user", content:[
        {type:"text", text:$b}
    ]}}' >> "$path"
    # 9) Non-skill isMeta machinery (Trap 1): isMeta:true but NOT a skill marker —
    # must be kept as ordinary user text, never collapsed to a skill reference.
    jq -nc '{type:"user", isMeta:true, message:{role:"user", content:[
        {type:"text", text:"Continue from where you left off. FIXTURE_NONSKILL_ISMETA_KEEP"}
    ]}}' >> "$path"
}

# Build a PreCompact stdin JSON payload.
# $1 = session_id, $2 = transcript_path
make_stdin() {
    jq -nc --arg sid "$1" --arg tp "$2" '{session_id:$sid, transcript_path:$tp}'
}

# -----------------------------------------------------------------------------
# run_test harness
# -----------------------------------------------------------------------------
run_test() {
    local test_name="$1"
    setup_test_env
    if "$test_name"; then
        echo "[PASS] $test_name"
        ((TESTS_PASSED++)) || true
    else
        echo "[FAIL] $test_name"
        ((TESTS_FAILED++)) || true
    fi
    teardown_test_env
}

# =============================================================================
# AC-T1.1 — the suite runs and exits 0 (implicit: every test below passes).
# Explicit smoke: invoking the hook with a valid fixture exits 0.
# =============================================================================
test_ac_t1_1_hook_exits_zero() {
    local sid="sid-smoke"
    local tp="$TEST_TMP_DIR/transcript.jsonl"
    write_fixture_transcript "$tp"

    local rc=0
    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: hook should exit 0 (got $rc)"
        return 1
    fi
    return 0
}

# =============================================================================
# AC-T1.2 — extracted text fed to the summarizer: contains the arc-head first
# user turn, contains the >2000-char tool_result truncated to <=2000 chars,
# and contains NO machinery (file-history-snapshot / attachment) content.
# =============================================================================
test_ac_t1_2_extraction_arc_truncation_no_machinery() {
    local sid="sid-extract"
    local tp="$TEST_TMP_DIR/transcript.jsonl"
    write_fixture_transcript "$tp"

    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || true

    if [ ! -f "$CODEX_STDIN" ]; then
        echo "ASSERTION FAILED: codex stub stdin was not captured"
        return 1
    fi
    local fed
    fed=$(cat "$CODEX_STDIN")

    # (a) arc head present
    if ! printf '%s' "$fed" | grep -q "$FIRST_USER_TURN"; then
        echo "ASSERTION FAILED: extracted text must contain the arc-head first user turn"
        return 1
    fi

    # (b) the >2000 tool_result is truncated: its head marker is present, but the
    # full 3000-X blob is NOT — the longest run of X must be <= 2000.
    if ! printf '%s' "$fed" | grep -q "BIGRESULT_HEAD_"; then
        echo "ASSERTION FAILED: big tool_result head marker should be present"
        return 1
    fi
    local max_x
    max_x=$(printf '%s' "$fed" | grep -oE 'X+' | awk '{ if (length>m) m=length } END { print m+0 }')
    if [ "$max_x" -gt 2000 ]; then
        echo "ASSERTION FAILED: tool_result not truncated to <=2000 chars (max X run=$max_x)"
        return 1
    fi

    # (c) no machinery content leaked
    if printf '%s' "$fed" | grep -q "FIXTURE_SNAPSHOT_LEAK_SHOULD_NOT_APPEAR"; then
        echo "ASSERTION FAILED: file-history-snapshot content leaked into extraction"
        return 1
    fi
    if printf '%s' "$fed" | grep -q "FIXTURE_ATTACHMENT_LEAK_SHOULD_NOT_APPEAR"; then
        echo "ASSERTION FAILED: attachment content leaked into extraction"
        return 1
    fi
    return 0
}

# =============================================================================
# AC-T1.3 — codex rc=0 + 8-section output → handoff written with ^## 1. .. ^## 8.;
# claude stub NOT invoked (sentinel absent).
# =============================================================================
test_ac_t1_3_codex_success_writes_8_sections_no_claude() {
    local sid="sid-codex-ok"
    local tp="$TEST_TMP_DIR/transcript.jsonl"
    write_fixture_transcript "$tp"
    echo "0" > "$CODEX_RC_FILE"

    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || true

    local handoff="$OMT_DIR/handoff-$sid.md"
    if [ ! -f "$handoff" ]; then
        echo "ASSERTION FAILED: handoff file should exist at $handoff"
        return 1
    fi
    local n
    for n in 1 2 3 4 5 6 7 8; do
        if ! grep -qE "^## $n\." "$handoff"; then
            echo "ASSERTION FAILED: handoff missing section ^## $n."
            return 1
        fi
    done
    if [ -f "$CLAUDE_SENTINEL" ]; then
        echo "ASSERTION FAILED: claude stub must NOT be invoked when codex succeeds"
        return 1
    fi
    return 0
}

# =============================================================================
# AC-T1.4 — codex rc!=0 → claude stub invoked; handoff written from its .result.
# =============================================================================
test_ac_t1_4_codex_fail_falls_back_to_claude() {
    local sid="sid-fallback"
    local tp="$TEST_TMP_DIR/transcript.jsonl"
    write_fixture_transcript "$tp"
    echo "1" > "$CODEX_RC_FILE"
    echo "0" > "$CLAUDE_RC_FILE"

    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || true

    if [ ! -f "$CLAUDE_SENTINEL" ]; then
        echo "ASSERTION FAILED: claude stub should be invoked when codex fails"
        return 1
    fi
    local handoff="$OMT_DIR/handoff-$sid.md"
    if [ ! -f "$handoff" ]; then
        echo "ASSERTION FAILED: handoff should be written from claude .result"
        return 1
    fi
    if ! grep -qE "^## 1\." "$handoff"; then
        echo "ASSERTION FAILED: claude-sourced handoff should contain 8-section content"
        return 1
    fi
    return 0
}

# =============================================================================
# AC-T1.5 — both stubs rc!=0 → no handoff-*.md; hook exits 0 (fail-open).
# =============================================================================
test_ac_t1_5_both_fail_no_file_exit_zero() {
    local sid="sid-bothfail"
    local tp="$TEST_TMP_DIR/transcript.jsonl"
    write_fixture_transcript "$tp"
    echo "1" > "$CODEX_RC_FILE"
    echo "1" > "$CLAUDE_RC_FILE"

    local rc=0
    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || rc=$?

    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: hook must exit 0 even when both summarizers fail (got $rc)"
        return 1
    fi
    local found
    found=$(ls "$OMT_DIR"/handoff-*.md 2>/dev/null | wc -l | tr -d ' ')
    if [ "$found" -ne 0 ]; then
        echo "ASSERTION FAILED: no handoff file should be written when both fail (found=$found)"
        return 1
    fi
    return 0
}

# =============================================================================
# AC-T1.6 — env OMT_HANDOFF_ACTIVE=1 → hook exits 0, neither stub invoked.
# =============================================================================
test_ac_t1_6_recursion_guard() {
    local sid="sid-recursion"
    local tp="$TEST_TMP_DIR/transcript.jsonl"
    write_fixture_transcript "$tp"

    local rc=0
    OMT_HANDOFF_ACTIVE=1 make_stdin_and_run "$sid" "$tp" || rc=$?

    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: hook must exit 0 under recursion guard (got $rc)"
        return 1
    fi
    if [ -f "$CODEX_STDIN" ]; then
        echo "ASSERTION FAILED: codex must NOT be invoked when OMT_HANDOFF_ACTIVE=1"
        return 1
    fi
    if [ -f "$CLAUDE_SENTINEL" ]; then
        echo "ASSERTION FAILED: claude must NOT be invoked when OMT_HANDOFF_ACTIVE=1"
        return 1
    fi
    return 0
}

# helper: run the hook with OMT_HANDOFF_ACTIVE exported into the hook process.
make_stdin_and_run() {
    local sid="$1" tp="$2"
    make_stdin "$sid" "$tp" | env OMT_HANDOFF_ACTIVE="${OMT_HANDOFF_ACTIVE:-1}" "$HOOK" >/dev/null 2>&1
}

# =============================================================================
# AC-T1.7 — absent/empty transcript_path → hook exits 0, no file (min-input skip).
# =============================================================================
test_ac_t1_7_absent_transcript_skips() {
    local sid="sid-notranscript"

    # (a) transcript_path points to a missing file
    local rc=0
    make_stdin "$sid" "$TEST_TMP_DIR/does-not-exist.jsonl" | "$HOOK" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: missing transcript → hook should exit 0 (got $rc)"
        return 1
    fi

    # (b) empty transcript_path
    rc=0
    make_stdin "$sid" "" | "$HOOK" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: empty transcript_path → hook should exit 0 (got $rc)"
        return 1
    fi

    local found
    found=$(ls "$OMT_DIR"/handoff-*.md 2>/dev/null | wc -l | tr -d ' ')
    if [ "$found" -ne 0 ]; then
        echo "ASSERTION FAILED: no handoff should be written for absent/empty transcript (found=$found)"
        return 1
    fi
    # Summarizers must not be spawned for a sub-threshold input.
    if [ -f "$CODEX_STDIN" ] || [ -f "$CLAUDE_SENTINEL" ]; then
        echo "ASSERTION FAILED: no summarizer should be spawned for sub-threshold input"
        return 1
    fi
    return 0
}

# =============================================================================
# AC-T1.8b — malformed stdin must fail-open (exit 0), never abort under set -e.
# =============================================================================
test_ac_t1_8b_malformed_stdin_exits_zero() {
    local rc=0
    printf 'not json{{{' | "$HOOK" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: malformed stdin must exit 0 (got $rc)"
        return 1
    fi
    # No handoff file should be written for un-parseable input.
    local found
    found=$(ls "$OMT_DIR"/handoff-*.md 2>/dev/null | wc -l | tr -d ' ')
    if [ "$found" -ne 0 ]; then
        echo "ASSERTION FAILED: no handoff for malformed stdin (found=$found)"
        return 1
    fi
    return 0
}

# =============================================================================
# AC-T1.8 — source grep: no `exit 2`, no `"block"` token anywhere.
# =============================================================================
test_ac_t1_8_never_blocks_source_grep() {
    if grep -qE 'exit[[:space:]]+2' "$HOOK"; then
        echo "ASSERTION FAILED: pre-compact.sh must never 'exit 2'"
        grep -nE 'exit[[:space:]]+2' "$HOOK"
        return 1
    fi
    # The hazard is the JSON block-decision token (e.g. {"decision":"block"} or
    # {"continue":false}), NOT the English words "blockers"/"blocks" that appear
    # verbatim in the embedded 8-section prompt body. Match the quoted decision
    # token and the deny decision, per AC phrasing ('no "block" token').
    if grep -qE '"block"|"decision"[[:space:]]*:[[:space:]]*"block"|"continue"[[:space:]]*:[[:space:]]*false' "$HOOK"; then
        echo "ASSERTION FAILED: pre-compact.sh must not contain a block decision token"
        grep -nE '"block"|"decision"[[:space:]]*:[[:space:]]*"block"|"continue"[[:space:]]*:[[:space:]]*false' "$HOOK"
        return 1
    fi
    return 0
}

# =============================================================================
# AC-T1.9 — a second run overwrites (replace semantics): exactly 1 file for the
# sid, content equals the latest run's output.
# =============================================================================
test_ac_t1_9_second_run_overwrites() {
    local sid="sid-overwrite"
    local tp="$TEST_TMP_DIR/transcript.jsonl"
    write_fixture_transcript "$tp"
    local handoff="$OMT_DIR/handoff-$sid.md"

    # First run via codex.
    echo "0" > "$CODEX_RC_FILE"
    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || true
    if [ ! -f "$handoff" ]; then
        echo "ASSERTION FAILED: first run should write a handoff"
        return 1
    fi

    # Second run via the claude fallback (codex fails) so the source differs,
    # proving overwrite rather than append/duplicate.
    rm -f "$CLAUDE_SENTINEL"
    echo "1" > "$CODEX_RC_FILE"
    echo "0" > "$CLAUDE_RC_FILE"
    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || true

    local count
    count=$(ls "$OMT_DIR"/handoff-"$sid".md 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" -ne 1 ]; then
        echo "ASSERTION FAILED: exactly 1 handoff file expected for sid (found=$count)"
        return 1
    fi

    # The file content must equal the latest (claude-sourced) summary, with no
    # duplicated/stacked sections from the first run.
    local sec1
    sec1=$(grep -cE '^## 1\.' "$handoff")
    if [ "$sec1" -ne 1 ]; then
        echo "ASSERTION FAILED: handoff should contain exactly one '## 1.' (overwrite, not append) — got $sec1"
        return 1
    fi

    # The handoff must contain the claude marker (latest run's output was written)
    # and must NOT contain the codex marker (first run's output was overwritten).
    # Without distinct markers, a retain-first regression (no-op second run) would
    # still satisfy count==1 and sec1==1 — these assertions catch that.
    if ! grep -q 'CLAUDE_RUN_MARKER' "$handoff"; then
        echo "ASSERTION FAILED: handoff must contain CLAUDE_RUN_MARKER (latest run's output)"
        return 1
    fi
    if grep -q 'CODEX_RUN_MARKER' "$handoff"; then
        echo "ASSERTION FAILED: handoff must NOT contain CODEX_RUN_MARKER (first run overwritten)"
        return 1
    fi
    return 0
}

# =============================================================================
# C3 regression — user STRING content must survive whole (no 2000-char cap).
# A fixture turn with 2500 'x' chars followed by TAILMARKER_ARCHEAD must appear
# in full in the codex stdin (the marker must survive past char 2000).
# =============================================================================
test_c3_prose_string_not_truncated() {
    local sid="sid-c3"
    local tp="$TEST_TMP_DIR/transcript_c3.jsonl"

    # Build: 2500 'x' chars then the unique marker — marker sits after char 2000.
    local long_prefix
    long_prefix=$(printf 'x%.0s' $(seq 1 2500))
    local long_content="${long_prefix}TAILMARKER_ARCHEAD"

    # Minimal transcript: just this one user STRING turn (enough to exceed min-input).
    jq -nc --arg t "$long_content" '{type:"user", message:{role:"user", content:$t}}' > "$tp"
    # Add a second short turn so the total exceeds HANDOFF_MIN_INPUT_CHARS=200.
    jq -nc '{type:"assistant", message:{role:"assistant", content:[{type:"text", text:"ok"}]}}' >> "$tp"

    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || true

    if [ ! -f "$CODEX_STDIN" ]; then
        echo "ASSERTION FAILED: codex stub stdin was not captured"
        return 1
    fi
    local fed
    fed=$(cat "$CODEX_STDIN")

    if ! printf '%s' "$fed" | grep -q "TAILMARKER_ARCHEAD"; then
        echo "ASSERTION FAILED: prose tail (TAILMARKER_ARCHEAD) was truncated — string branch must NOT cap user prose"
        return 1
    fi
    return 0
}

# =============================================================================
# SKILL-1 — an injected skill body (isMeta user record beginning with the
# "Base directory for this skill:" marker) is replaced in the EXTRACT by a
# one-line name reference: "[skill invoked: <name>]" appears, the full SKILL.md
# body does NOT. A non-skill isMeta record (Trap 1) is kept as ordinary text.
# =============================================================================
test_skill_1_body_replaced_with_name_reference() {
    local sid="sid-skill"
    local tp="$TEST_TMP_DIR/transcript.jsonl"
    write_fixture_transcript "$tp"

    make_stdin "$sid" "$tp" | "$HOOK" >/dev/null 2>&1 || true

    if [ ! -f "$CODEX_STDIN" ]; then
        echo "ASSERTION FAILED: codex stub stdin was not captured"
        return 1
    fi
    local fed
    fed=$(cat "$CODEX_STDIN")

    # (a) the skill name reference is present (name = last path segment).
    if ! printf '%s' "$fed" | grep -q '\[skill invoked: prometheus\]'; then
        echo "ASSERTION FAILED: extract must contain '[skill invoked: prometheus]'"
        return 1
    fi

    # (b) the full SKILL.md body must NOT reach the summarizer.
    if printf '%s' "$fed" | grep -q "PROMETHEUS_SKILL_BODY_LEAK_SHOULD_NOT_APPEAR"; then
        echo "ASSERTION FAILED: SKILL.md body leaked into extraction"
        return 1
    fi

    # (c) Trap 1: a non-skill isMeta record stays as ordinary user text.
    if ! printf '%s' "$fed" | grep -q "FIXTURE_NONSKILL_ISMETA_KEEP"; then
        echo "ASSERTION FAILED: non-skill isMeta text must be kept, not collapsed"
        return 1
    fi
    return 0
}

# Helper: run the resolver block from the hook in a subprocess and print the
# resulting CODEX_BIN.
# $1 = PATH string for the subprocess (must include system coreutils if needed)
# $2 = OMT_CODEX_BIN value (pass "" to leave empty)
_run_resolver() {
    local test_path="$1"
    local codex_bin_override="$2"

    # Extract the resolver block: lines from "# Resolve the real codex binary"
    # through (and including) the closing `fi` that ends the outer if block.
    local resolver_block
    resolver_block=$(awk '
      /^# Resolve the real codex binary/ { capture=1 }
      capture { print }
      capture && /^fi$/ { capture=0 }
    ' "$HOOK")

    if [ -z "$resolver_block" ]; then
        printf ''
        return 0
    fi

    PATH="$test_path" OMT_CODEX_BIN="$codex_bin_override" /bin/bash -c "$resolver_block
printf '%s' \"\$CODEX_BIN\""
}

# Return the directory containing system coreutils needed by the resolver
# (specifically `head`), excluding any directory that also contains `codex`.
# This lets resolver tests that need "no real codex on PATH" still have `head`.
_system_coreutils_path() {
    local head_dir
    head_dir=$(dirname "$(command -v head 2>/dev/null || echo /usr/bin/head)")
    # If this dir also contains `codex`, walk up to find one that doesn't —
    # but in practice head lives in /usr/bin which never ships a codex binary.
    printf '%s' "$head_dir"
}

# =============================================================================
# RESOLVER-1 — When a shell-script codex (#!/bin/bash shim) appears before a
# real (non-shebang) codex on PATH, the resolver picks the real one.
# =============================================================================
test_resolver_skips_shim_picks_real() {
    # Build two separate directories: shim first, real second.
    local shim_dir="$TEST_TMP_DIR/shim"
    local real_dir="$TEST_TMP_DIR/real"
    mkdir -p "$shim_dir" "$real_dir"

    # Shim: a shell-script (first 2 bytes = "#!")
    printf '#!/bin/bash\nexit 0\n' > "$shim_dir/codex"
    chmod +x "$shim_dir/codex"

    # Real: a non-shebang file (first byte = NUL; not a script shebang).
    printf '\x00FAKE_BINARY\n' > "$real_dir/codex"
    chmod +x "$real_dir/codex"

    unset OMT_CODEX_BIN || true

    local sysutils
    sysutils=$(_system_coreutils_path)
    local resolved
    resolved=$(_run_resolver "$shim_dir:$real_dir:$sysutils" "" 2>/dev/null) || resolved=""

    if [ "$resolved" != "$real_dir/codex" ]; then
        echo "ASSERTION FAILED: resolver should pick $real_dir/codex, got '$resolved'"
        return 1
    fi
    return 0
}

# =============================================================================
# RESOLVER-2 — OMT_CODEX_BIN takes precedence over PATH scanning.
# =============================================================================
test_resolver_env_override_takes_precedence() {
    local override_path="$TEST_TMP_DIR/explicit/codex"
    mkdir -p "$(dirname "$override_path")"
    printf '\x00OVERRIDE_BINARY\n' > "$override_path"
    chmod +x "$override_path"

    # Also place a real (non-shebang) codex on PATH to confirm it is NOT chosen.
    local real_dir="$TEST_TMP_DIR/real2"
    mkdir -p "$real_dir"
    printf '\x00REAL_ON_PATH\n' > "$real_dir/codex"
    chmod +x "$real_dir/codex"

    local sysutils
    sysutils=$(_system_coreutils_path)
    local resolved
    resolved=$(_run_resolver "$real_dir:$sysutils" "$override_path" 2>/dev/null) || resolved=""

    if [ "$resolved" != "$override_path" ]; then
        echo "ASSERTION FAILED: OMT_CODEX_BIN override should yield $override_path, got '$resolved'"
        return 1
    fi
    return 0
}

# =============================================================================
# RESOLVER-3 — When no codex is resolvable (only a shim on PATH, no real binary),
# the resolver yields empty CODEX_BIN and the hook still exits 0 (fail-open),
# falling through to the claude fallback.
# =============================================================================
test_resolver_no_codex_yields_empty_and_failopen() {
    # Only a shim codex on PATH — should be skipped, yielding empty CODEX_BIN.
    local shim_dir="$TEST_TMP_DIR/shim2"
    mkdir -p "$shim_dir"
    printf '#!/bin/bash\nexit 0\n' > "$shim_dir/codex"
    chmod +x "$shim_dir/codex"

    unset OMT_CODEX_BIN || true

    # Verify the resolver yields empty.
    # PATH: only the shim dir + system coreutils dir (for `head`).
    # The coreutils dir must not itself contain a real `codex` binary.
    local sysutils
    sysutils=$(_system_coreutils_path)
    local resolved
    resolved=$(_run_resolver "$shim_dir:$sysutils" "" 2>/dev/null) || resolved=""

    if [ -n "$resolved" ]; then
        echo "ASSERTION FAILED: resolver should yield empty when only a shim exists, got '$resolved'"
        return 1
    fi

    # Verify the full hook still exits 0 (fail-open) with no resolvable codex.
    # Build a PATH that:
    #   - has the shim codex (resolver skips it — first 2 bytes are "#!")
    #   - has the claude stub (for the fallback)
    #   - has system coreutils dirs that are known to contain no `codex` binary
    #     (/usr/bin, /bin — jq, perl, head, mktemp, mv, cat all live there)
    # STUB_BIN is excluded so its non-shebang codex stub is not reachable.
    local sid="sid-noresolve"
    local tp="$TEST_TMP_DIR/transcript_noresolve.jsonl"
    write_fixture_transcript "$tp"

    # Create a claude-only stub dir (no codex in it).
    local claude_only_dir="$TEST_TMP_DIR/claude_only"
    mkdir -p "$claude_only_dir"
    cp "$STUB_BIN/claude" "$claude_only_dir/claude"

    # Minimal system PATH: /usr/bin and /bin are stable macOS dirs with no codex.
    local min_sys_path="/usr/bin:/bin"
    local rc=0
    make_stdin "$sid" "$tp" | env PATH="$shim_dir:$claude_only_dir:$min_sys_path" OMT_CODEX_BIN="" "$HOOK" >/dev/null 2>&1 || rc=$?

    if [ "$rc" -ne 0 ]; then
        echo "ASSERTION FAILED: hook must exit 0 when codex is not resolvable (got $rc)"
        return 1
    fi
    # Claude fallback should be invoked (codex primary was skipped).
    if [ ! -f "$CLAUDE_SENTINEL" ]; then
        echo "ASSERTION FAILED: claude fallback should be invoked when CODEX_BIN is empty"
        return 1
    fi
    return 0
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo "=========================================="
    echo "PreCompact Producer Hook Tests"
    echo "=========================================="

    run_test test_ac_t1_1_hook_exits_zero
    run_test test_ac_t1_2_extraction_arc_truncation_no_machinery
    run_test test_ac_t1_3_codex_success_writes_8_sections_no_claude
    run_test test_ac_t1_4_codex_fail_falls_back_to_claude
    run_test test_ac_t1_5_both_fail_no_file_exit_zero
    run_test test_ac_t1_6_recursion_guard
    run_test test_ac_t1_7_absent_transcript_skips
    run_test test_ac_t1_8b_malformed_stdin_exits_zero
    run_test test_ac_t1_8_never_blocks_source_grep
    run_test test_ac_t1_9_second_run_overwrites
    run_test test_c3_prose_string_not_truncated
    run_test test_skill_1_body_replaced_with_name_reference
    run_test test_resolver_skips_shim_picks_real
    run_test test_resolver_env_override_takes_precedence
    run_test test_resolver_no_codex_yields_empty_and_failopen

    echo "=========================================="
    echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
    echo "=========================================="

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
