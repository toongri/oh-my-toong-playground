#!/bin/bash
# =============================================================================
# Mermaid Render Gate Hook Tests
#
# Covers the PostToolUse Write|Edit|MultiEdit render gate: a markdown file
# whose mermaid blocks fail to render blocks (decision:"block") with the
# failing block located by FILE line number, while every fail-open path
# (non-markdown, no fence, missing file, absent renderer) exits 0 silently.
#
# `mmdc` is stubbed rather than executed. The stub replays the exact stderr
# bytes real mermaid-cli emitted for a `create`-keyword collision (captured
# from @mermaid-js/mermaid-cli 11.15.0), so the diagnostic parsing under test
# -- puppeteer stack stripping and block-relative -> file-line remapping --
# runs against ground-truth output shape without paying a Chromium launch
# per case. The stub also logs its invocations, which is how the "no fence
# means no renderer launch" claim is asserted rather than assumed.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/mermaid-render-gate.sh"

TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
    local test_name="$1"
    if "$test_name"; then
        echo "[PASS] $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "[FAIL] $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

assert_contains() {
    local haystack="$1" needle="$2" msg="${3:-}"
    if echo "$haystack" | grep -qF "$needle"; then
        return 0
    else
        echo "  ASSERTION FAILED: $msg"
        echo "  Expected to contain: $needle"
        echo "  Actual: $haystack"
        return 1
    fi
}

assert_not_contains() {
    local haystack="$1" needle="$2" msg="${3:-}"
    if echo "$haystack" | grep -qF "$needle"; then
        echo "  ASSERTION FAILED: $msg"
        echo "  Expected NOT to contain: $needle"
        echo "  Actual: $haystack"
        return 1
    else
        return 0
    fi
}

# =============================================================================
# Harness
# =============================================================================

TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

STUB_BIN="$TEST_DIR/bin"
mkdir -p "$STUB_BIN"

# Stub mmdc: fails whenever its input carries the BREAKME marker, replaying
# real mermaid-cli stderr (parse diagnostic + puppeteer stack). Records every
# invocation's input path to $TEST_DIR/mmdc-calls.
cat >"$STUB_BIN/mmdc" <<'STUB'
#!/bin/bash
IN=""
OUT=""
while [ $# -gt 0 ]; do
    case "$1" in
        -i) IN="$2"; shift 2 ;;
        -o) OUT="$2"; shift 2 ;;
        *) shift ;;
    esac
done
echo "$IN" >>"$MMDC_CALL_LOG"
if grep -q 'BREAKME' "$IN" 2>/dev/null; then
    LINE="$(grep -n 'BREAKME' "$IN" | head -1 | cut -d: -f1)"
    cat >&2 <<EOF

Error: Parse error on line ${LINE}:
...ySlots    FLOW->>+CREATE: stage 1
---------------------^
Expecting 'ACTOR', got 'create'
Parser.parseError (https://mermaid-cli-intercept.invalid/mermaid.esm/sequenceDiagram.mjs:409:21)
    at #evaluate (file:///puppeteer-core/lib/esm/puppeteer/cdp/ExecutionContext.js:388:19)
    at async CdpPage.\$eval (file:///puppeteer-core/lib/esm/puppeteer/api/Page.js:456:20)
EOF
    exit 1
fi
[ -n "$OUT" ] && : >"$OUT"
exit 0
STUB
chmod +x "$STUB_BIN/mmdc"

export MMDC_CALL_LOG="$TEST_DIR/mmdc-calls"

# run_hook <json> — feeds <json> on stdin with the mmdc stub on PATH.
run_hook() {
    : >"$MMDC_CALL_LOG"
    printf '%s' "$1" | PATH="$STUB_BIN:$PATH" bash "$HOOK" 2>/dev/null
}

# A PATH holding exactly the tools the hook needs and nothing else, so `mmdc`
# is provably unresolvable. Emptying PATH outright would also strip bash, and
# trimming to /usr/bin:/bin would still resolve a globally installed mmdc on
# machines whose npm prefix lands there -- either way the fail-open path would
# be tested against the wrong absence.
NO_MMDC_BIN="$TEST_DIR/no-mmdc-bin"
mkdir -p "$NO_MMDC_BIN"
for _tool in bash jq grep sed awk mktemp cat rm head wc; do
    _src="$(command -v "$_tool" 2>/dev/null || true)"
    [ -n "$_src" ] && ln -sf "$_src" "$NO_MMDC_BIN/$_tool"
done

# run_hook_no_mmdc <json> — same as run_hook, but with no renderer reachable.
# Returns stderr merged so the NOTICE is assertable.
run_hook_no_mmdc() {
    printf '%s' "$1" | PATH="$NO_MMDC_BIN" bash "$HOOK" 2>&1
}

payload() {
    printf '{"tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2"
}

# write_doc <name> <body> — writes a markdown fixture, returns its path.
write_doc() {
    local path="$TEST_DIR/$1"
    printf '%s\n' "$2" >"$path"
    echo "$path"
}

VALID_DOC='# doc

```mermaid
flowchart TD
    A --> B
```

tail'

# Fence on line 3, so the BREAKME marker on block-relative line 4 lands on
# file line 6 -- the exact offset arithmetic the hook must reproduce.
BROKEN_DOC='# doc

```mermaid
sequenceDiagram
    participant A as Foo
    BREAKME
```

tail'

# =============================================================================
# Routing -- only markdown writes with an actual mermaid fence reach mmdc
# =============================================================================

test_non_markdown_path_is_ignored() {
    local doc output
    doc="$(write_doc notes.txt "$BROKEN_DOC")"
    output="$(run_hook "$(payload Write "$doc")")"

    [ -z "$output" ] || { echo "  expected no output, got: $output"; return 1; }
    [ ! -s "$MMDC_CALL_LOG" ] || { echo "  renderer must not run for .txt"; return 1; }
}

test_markdown_without_fence_skips_renderer() {
    local doc output
    doc="$(write_doc prose.md '# just prose, no diagrams')"
    output="$(run_hook "$(payload Write "$doc")")"

    [ -z "$output" ] || { echo "  expected no output, got: $output"; return 1; }
    # The cheap grep gate is the whole reason ordinary doc writes stay free.
    [ ! -s "$MMDC_CALL_LOG" ] || { echo "  renderer must not launch without a mermaid fence"; return 1; }
}

test_unrelated_tool_is_ignored() {
    local doc output
    doc="$(write_doc bash.md "$BROKEN_DOC")"
    output="$(run_hook "$(printf '{"tool_name":"Bash","tool_input":{"file_path":"%s"}}' "$doc")")"

    [ -z "$output" ] || { echo "  expected no output for Bash, got: $output"; return 1; }
}

test_missing_file_is_ignored() {
    local output
    output="$(run_hook "$(payload Write "$TEST_DIR/gone.md")")"

    [ -z "$output" ] || { echo "  expected no output for missing file, got: $output"; return 1; }
}

# =============================================================================
# Verdicts
# =============================================================================

test_valid_diagram_passes_silently() {
    local doc output
    doc="$(write_doc ok.md "$VALID_DOC")"
    output="$(run_hook "$(payload Write "$doc")")"

    [ -z "$output" ] || { echo "  expected no output, got: $output"; return 1; }
    [ -s "$MMDC_CALL_LOG" ] || { echo "  renderer should have run"; return 1; }
    # Fast phase only: one whole-file run, no per-block fan-out.
    [ "$(wc -l <"$MMDC_CALL_LOG")" -eq 1 ] || { echo "  clean file must cost exactly one render"; return 1; }
}

test_broken_diagram_blocks_with_file_line() {
    local doc output
    doc="$(write_doc bad.md "$BROKEN_DOC")"
    output="$(run_hook "$(payload Write "$doc")")"

    assert_contains "$output" '"decision"' "broken diagram must emit a decision" || return 1
    assert_contains "$output" 'block' "decision must be block" || return 1
    assert_contains "$output" 'block 1 (lines 3-7)' "must locate the failing block by fence lines" || return 1
    assert_contains "$output" 'error at file line 6' "must remap block-relative line 4 onto file line 6" || return 1
    assert_contains "$output" "Expecting 'ACTOR', got 'create'" "must carry mermaid's own diagnostic" || return 1
}

test_block_reason_strips_puppeteer_stack() {
    local doc output
    doc="$(write_doc stack.md "$BROKEN_DOC")"
    output="$(run_hook "$(payload Write "$doc")")"

    # The stack is noise that would crowd out the diagnostic in the agent's
    # feedback; only mermaid's own lines should survive.
    assert_not_contains "$output" 'puppeteer-core' "puppeteer stack must be stripped" || return 1
    assert_not_contains "$output" 'at async' "stack frames must be stripped" || return 1
}

test_every_failing_block_is_reported() {
    local doc output
    doc="$(write_doc multi.md '```mermaid
flowchart TD
    A --> B
```

```mermaid
sequenceDiagram
    BREAKME
```

```mermaid
classDiagram
    BREAKME
```')"
    output="$(run_hook "$(payload Write "$doc")")"

    # mmdc'"'"'s markdown mode stops at the first bad chart -- the per-block
    # phase exists precisely so the second failure is not hidden.
    assert_contains "$output" 'block 2' "second block failure must be reported" || return 1
    assert_contains "$output" 'block 3' "third block failure must be reported" || return 1
    assert_contains "$output" '1/3 blocks OK' "must count surviving blocks" || return 1
}

test_unclosed_fence_is_still_reported() {
    local doc output
    doc="$(write_doc unclosed.md '# doc

```mermaid
sequenceDiagram
    BREAKME')"
    output="$(run_hook "$(payload Write "$doc")")"

    # An unclosed fence is broken markdown; dropping it silently would be the
    # worse failure mode.
    assert_contains "$output" 'block 1' "unclosed trailing block must still be reported" || return 1
}

test_edit_tool_validates_merged_file() {
    local doc output
    doc="$(write_doc edited.md "$BROKEN_DOC")"
    # Edit carries only a fragment in new_string; the verdict must come from
    # the file on disk, so an unrelated fragment cannot mask a broken block.
    output="$(run_hook "$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s","new_string":"tail"}}' "$doc")")"

    assert_contains "$output" 'block 1' "Edit must be judged on the merged file" || return 1
}

# =============================================================================
# Fail-open
# =============================================================================

test_absent_renderer_fails_open() {
    local doc output
    doc="$(write_doc noren.md "$BROKEN_DOC")"
    output="$(run_hook_no_mmdc "$(payload Write "$doc")")"

    assert_not_contains "$output" '"decision"' "missing renderer must never block a write" || return 1
    assert_contains "$output" 'NOTICE' "missing renderer should say how to enable the gate" || return 1
    assert_contains "$output" '@mermaid-js/mermaid-cli' "NOTICE must name the install target" || return 1
}

# =============================================================================
# Runner
# =============================================================================

echo "Running mermaid-render-gate tests..."
echo ""

run_test test_non_markdown_path_is_ignored
run_test test_markdown_without_fence_skips_renderer
run_test test_unrelated_tool_is_ignored
run_test test_missing_file_is_ignored
run_test test_valid_diagram_passes_silently
run_test test_broken_diagram_blocks_with_file_line
run_test test_block_reason_strips_puppeteer_stack
run_test test_every_failing_block_is_reported
run_test test_unclosed_fence_is_still_reported
run_test test_edit_tool_validates_merged_file
run_test test_absent_renderer_fails_open

echo ""
echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
[ "$TESTS_FAILED" -eq 0 ]
