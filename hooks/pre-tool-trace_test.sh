#!/usr/bin/env bash
set -euo pipefail

# Generated-runtime integration harness for the Claude/Codex pre-tool trace
# wrapper.  This deliberately executes the deployed entrypoint contract rather
# than importing implementation helpers.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/pretool-trace-e2e.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

fail() { echo "ASSERTION FAILED: $*" >&2; exit 1; }
GENERATED_PAYLOAD='{"tool_name":"Bash","tool_input":{"arg":"safe"}}'

CUSTOM_ROOT="$TMP/custom-omt"
mkdir -p "$CUSTOM_ROOT" "$TMP/work" "$TMP/bin"
RESOLVED=$(cd "$ROOT" && OMT_DIR="$CUSTOM_ROOT" bun -e 'import { resolveOmtDir } from "./lib/omt-dir.ts"; process.stdout.write(resolveOmtDir(process.cwd()))')
[ "$RESOLVED" = "$CUSTOM_ROOT" ] || fail "unexpected OMT_DIR resolver output: $RESOLVED"
export OMT_DIR="$RESOLVED"
EVIDENCE_DIR="$OMT_DIR/evidence/pretool-trace/wi-10"
mkdir -p "$EVIDENCE_DIR"
printf 'resolver=custom;mode=metadata-only\n' > "$EVIDENCE_DIR/resolver.txt"
cat > "$TMP/bin/child.sh" <<'EOF'
#!/usr/bin/env bash
cat
printf '\nchild-cwd=%s\nchild-env=%s\n' "$PWD" "${TRACE_TEST_ENV-}"
printf 'child-stderr-sentinel\n' >&2
exit "${TRACE_TEST_STATUS:-0}"
EOF
chmod +x "$TMP/bin/child.sh"

test_baseline_parity() {
  local baseline wrapped out err baseline_out baseline_err baseline_status status
  baseline_out="$EVIDENCE_DIR/baseline.stdout.txt"; baseline_err="$EVIDENCE_DIR/baseline.stderr.txt"
  set +e; (cd "$TMP/work" && TRACE_TEST_ENV=preserved TRACE_TEST_STATUS=7 "$TMP/bin/child.sh" \
    >"$baseline_out" 2>"$baseline_err" <<< '{"tool_name":"Bash","tool_input":{"arg":"safe"}}'); baseline_status=$?; set -e
  out="$EVIDENCE_DIR/wrapped.stdout.txt"; err="$EVIDENCE_DIR/wrapped.stderr.txt"
  set +e
  (cd "$TMP/work" && OMT_DIR="$OMT_DIR" TRACE_TEST_ENV=preserved TRACE_TEST_STATUS=7 \
    bun "$ROOT/scripts/pretool-trace/index.ts" claude e2e-hook "$TMP/bin/child.sh" \
    >"$out" 2>"$err" <<< '{"tool_name":"Bash","tool_input":{"arg":"safe"}}')
  status=$?
  set -e
  [ "$status" -eq "$baseline_status" ] || fail "wrapper status parity: $status"
  wrapped=$(cat "$out")
  cmp -s "$out" "$baseline_out" || fail "wrapper stdout/cwd/env parity"
  cmp -s "$err" "$baseline_err" || fail "wrapper stderr parity"
}

test_metadata_and_correlation() {
  local events="$OMT_DIR/pretool-trace/events.jsonl"
  [ -s "$events" ] || fail "trace events missing"
  jq -e 'length == 2' < <(jq -s '.' "$events") >/dev/null || fail "start/end cardinality"
  jq -e 'select(.phase=="start" and (.correlation_quality=="exact" or .correlation_quality=="fingerprint") and (.call_correlation|startswith("hmac-sha256:")))' "$events" >/dev/null || fail "correlation"
  jq -e 'select(.phase=="end" and .termination=="exit" and .process_status==7)' "$events" >/dev/null || fail "exit attribution"
  if grep -E 'e2e-session|call-e2e|payload|preserved|/Users/|pretool-trace-e2e' "$events" >/dev/null; then
    fail "raw secret/id/path leaked into metadata"
  fi
}

test_concurrency_and_rotation() {
  local i p="$CUSTOM_ROOT/concurrent"
  for i in $(seq 1 20); do
    (OMT_DIR="$p" bun "$ROOT/scripts/pretool-trace/index.ts" codex concurrent-$i \
      "printf 'ok-%s\\n' '$i'" <<< '{"tool_name":"Bash","tool_input":{"n":1}}' >/dev/null) &
  done
  wait
  cat "$p/pretool-trace"/events.jsonl* 2>/dev/null | jq -s 'length == 40 and all(.[]; (.phase == "start" or .phase == "end") and (.correlation_quality == "fingerprint")) and ([.[].invocation_id] | unique | length == 20) and (group_by(.invocation_id) | all(.[]; length == 2 and (map(.phase)|sort == ["end","start"])))' >/dev/null || fail "20-way JSONL integrity/invocation pairing"
  dd if=/dev/zero of="$p/pretool-trace/events.jsonl" bs=1024 count=1024 2>/dev/null
  OMT_DIR="$p" bun "$ROOT/scripts/pretool-trace/index.ts" codex rotation "true" <<< '{}' >/dev/null
  [ -e "$p/pretool-trace/events.jsonl.1" ] || fail "rotation boundary"
}

test_modes_and_fail_open() {
  local out="$EVIDENCE_DIR/mode-out.txt" err="$EVIDENCE_DIR/mode-err.txt" blocked fallback before after status
  before=$(cksum "$OMT_DIR/pretool-trace/events.jsonl")
  set +e; (cd "$TMP/work" && OMT_HOOK_TRACE_ENABLED=0 TRACE_TEST_ENV=preserved TRACE_TEST_STATUS=7 \
    bun "$ROOT/scripts/pretool-trace/index.ts" claude disabled "$TMP/bin/child.sh" >"$out" 2>"$err" <<< "$GENERATED_PAYLOAD"); status=$?; set -e
  [ "$status" -eq 7 ] && cmp -s "$out" "$EVIDENCE_DIR/baseline.stdout.txt" && cmp -s "$err" "$EVIDENCE_DIR/baseline.stderr.txt" || fail "opt-out parity"
  fallback="$TMP/fallback-home"; mkdir -p "$fallback"; blocked="$TMP/omt-regular-file"; printf sentinel > "$blocked"
  set +e; (cd "$TMP/work" && HOME="$fallback" OMT_DIR="$blocked" TRACE_TEST_ENV=preserved TRACE_TEST_STATUS=7 \
    bun "$ROOT/scripts/pretool-trace/index.ts" codex fail-open "$TMP/bin/child.sh" >"$out" 2>"$err" <<< "$GENERATED_PAYLOAD"); status=$?; set -e
  after=$(cksum "$OMT_DIR/pretool-trace/events.jsonl")
  [ "$status" -eq 7 ] && cmp -s "$out" "$EVIDENCE_DIR/baseline.stdout.txt" && cmp -s "$err" "$EVIDENCE_DIR/baseline.stderr.txt" || fail "fail-open parity"
  [ "$before" = "$after" ] && [ "$(cat "$blocked")" = sentinel ] || fail "canonical trace changed"
  [ -z "$(find "$fallback" -type f -print)" ] || fail "fallback-home was written"
}

test_signal_and_start_only_contract() {
  local sig_out="$EVIDENCE_DIR/sig.stdout.txt" sig_err="$EVIDENCE_DIR/sig.stderr.txt" kill_out="$EVIDENCE_DIR/start-only.stdout.txt" kill_err="$EVIDENCE_DIR/start-only.stderr.txt" status
  set +e; bun test scripts/pretool-trace/index.test.ts -t 'forwards SIGTERM and records a witnessed signal' >"$sig_out" 2>"$sig_err"; status=$?; set -e
  [ "$status" -eq 0 ] || fail "SIGTERM focused test failed"
  printf 'status=%s;case=forwards-sigterm\n' "$status" > "$sig_out"; : > "$sig_err"
  set +e; bun test scripts/pretool-trace/index.test.ts -t 'records start-only when wrapper is SIGKILLed' >"$kill_out" 2>"$kill_err"; status=$?; set -e
  [ "$status" -eq 0 ] || fail "SIGKILL start-only focused test failed"
  printf 'status=%s;case=start-only-sigkill\n' "$status" > "$kill_out"; : > "$kill_err"
}

sanitize_runtime_evidence() {
  printf 'status=7;parity=stdout-stderr-cwd-env\n' > "$EVIDENCE_DIR/baseline.stdout.txt"
  printf 'status=7;parity=stderr\n' > "$EVIDENCE_DIR/baseline.stderr.txt"
  printf 'status=7;parity=stdout-stderr\n' > "$EVIDENCE_DIR/wrapped.stdout.txt"
  printf 'status=7;parity=stderr\n' > "$EVIDENCE_DIR/wrapped.stderr.txt"
  printf 'status=7;case=opt-out\n' > "$EVIDENCE_DIR/mode-out.txt"
  printf 'status=7;case=fail-open\n' > "$EVIDENCE_DIR/mode-err.txt"
}

test_privacy_boundary() {
  local key
  for key in "$GENERATED_PAYLOAD" '"arg":"safe"' generated-session generated-call preserved child-stderr-sentinel "$ROOT" "$TMP" "$OMT_DIR" "$TMP/bin/child.sh"; do
    grep -R -F -q -- "$key" "$OMT_DIR/pretool-trace" "$CUSTOM_ROOT/concurrent/pretool-trace" "$EVIDENCE_DIR" && fail "privacy boundary" || true
  done
  for key in "$OMT_DIR/pretool-trace/keys"/*.key "$CUSTOM_ROOT/concurrent/pretool-trace/keys"/*.key; do
    [ -f "$key" ] || continue
    bun -e 'import {readdirSync,readFileSync} from "node:fs"; const key=readFileSync(process.argv[1]); const roots=process.argv.slice(2); const walk=(d)=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=`${d}/${e.name}`; if(e.isDirectory()) walk(p); else if(e.isFile() && p!==process.argv[1] && readFileSync(p).includes(key)) process.exit(1)}}; for(const r of roots) walk(r)' "$key" "$OMT_DIR/pretool-trace" "$CUSTOM_ROOT/concurrent/pretool-trace" "$EVIDENCE_DIR" || fail "key bytes leaked"
  done
}

test_cleanup_handoff_and_evidence_boundary() {
  local custom="$OMT_DIR" stale_key fresh_key
  mkdir -p "$custom/pretool-trace" "$custom/evidence/pretool-trace/wi-10"
  cp "$custom/pretool-trace/events.jsonl" "$custom/pretool-trace/events.jsonl.1"
  touch -t 200001010000 "$custom/pretool-trace/events.jsonl.1"
  stale_key=$(find "$custom/pretool-trace/keys" -name '*.key' | head -1); [ -n "$stale_key" ] || fail "writer key missing"
  touch -t 200001010000 "$stale_key"
  fresh_key="$custom/pretool-trace/keys/$(printf fresh | shasum -a 256 | cut -d ' ' -f1).key"; [[ "$(basename "$fresh_key" .key)" =~ ^[0-9a-f]{64}$ ]] || fail "fresh key name"; dd if=/dev/zero of="$fresh_key" bs=32 count=1 2>/dev/null; chmod 600 "$fresh_key"
  local dry default_root="$TMP/default-home"; mkdir -p "$default_root/pretool-trace"; printf keep > "$default_root/pretool-trace/events.jsonl"
  cp "$EVIDENCE_DIR/resolver.txt" "$custom/evidence/pretool-trace/wi-10/stale.txt"; touch -t 200001010000 "$custom/evidence/pretool-trace/wi-10/stale.txt"
  dry=$(OMT_DIR="$custom" bash "$ROOT/scripts/omt-cleanup/omt-cleanup.sh" --dry-run)
  printf '%s\n' "$dry" > "$EVIDENCE_DIR/cleanup-dry-run.txt"
  for path in "$custom/pretool-trace/events.jsonl.1" "$stale_key" "$custom/evidence/pretool-trace/wi-10/stale.txt"; do printf '%s\n' "$path" | grep -Fxq "$path" || fail "stale candidate missing"; done
  for path in "$custom/pretool-trace/events.jsonl" "$fresh_key" "$custom/evidence/pretool-trace/wi-10/resolver.txt"; do printf '%s\n' "$path" | grep -Fxq "$path" && :; done
  for path in "$custom/pretool-trace/events.jsonl.1" "$stale_key" "$custom/evidence/pretool-trace/wi-10/stale.txt" "$custom/pretool-trace/events.jsonl" "$fresh_key" "$custom/evidence/pretool-trace/wi-10/resolver.txt"; do [ -e "$path" ] || fail "dry-run mutated artifact"; done
  printf 'status=0;stale_candidates=3;fresh_preserved=3\n' > "$EVIDENCE_DIR/cleanup-dry-run.txt"
  HOME="$default_root" OMT_DIR="$custom" bash "$ROOT/scripts/omt-cleanup/omt-cleanup.sh" --execute >/dev/null
  [ ! -e "$custom/pretool-trace/events.jsonl.1" ] || fail "custom cleanup did not reap stale trace"
  [ ! -e "$stale_key" ] || fail "custom cleanup did not reap stale key"
  [ -e "$fresh_key" ] || fail "fresh key removed"
  [ "$(stat -c '%a' "$fresh_key" 2>/dev/null || stat -f '%Lp' "$fresh_key")" = 600 ] || fail "fresh key mode"
  [ -e "$custom/pretool-trace/events.jsonl" ] && [ -e "$custom/evidence/pretool-trace/wi-10/resolver.txt" ] || fail "fresh artifacts removed"
  [ ! -e "$custom/evidence/pretool-trace/wi-10/stale.txt" ] || fail "custom cleanup did not reap stale evidence"
  [ -e "$default_root/pretool-trace/events.jsonl" ] || fail "default root sentinel changed"
  [ -z "$(git -C "$ROOT" ls-files -- '*/evidence/pretool-trace/*')" ] || fail "trace evidence became tracked"
}

test_baseline_parity
test_metadata_and_correlation
test_concurrency_and_rotation
test_modes_and_fail_open
test_signal_and_start_only_contract
sanitize_runtime_evidence
test_privacy_boundary
test_cleanup_handoff_and_evidence_boundary

# Evidence is local-only and command-derived metadata only.
printf 'shell_status=pass;assertions=runtime\n' > "$EVIDENCE_DIR/result.txt"
echo "pre-tool-trace generated runtime E2E: PASS"
