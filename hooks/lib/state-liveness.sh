#!/bin/bash
# =============================================================================
# oh-my-toong State Liveness Predicate
# Shared bash helper for both GC callers (session-start.sh, omt-cleanup.sh).
# Compatible with macOS Bash 3.2.
# =============================================================================
#
# TTL constants — the ONLY definition site for bash; TS definition site is
# lib/state-core.ts. Tests assert pairwise equality between both files.
ACTIVE_IDLE_TTL=21600   # 6 hours — active session idle window
TERMINAL_TTL=1800       # 30 minutes — terminal (active:false) grace period
PRETOOL_TRACE_RETENTION_TTL=604800 # 7 days — strict mtime retention boundary

# STATE_PREFIXES — the 6 managed state-file prefixes. This is the single
# definition site for bash; the out-of-scope *seeding* point is
# hooks/pre-tool-enforcer.sh. No GC caller keeps its own copy of this list.
# Every prefix expansion below is anchored to `*.json`, never bare `*` — that
# anchor is what keeps `list_live_session_ids` and `reap_dead_state_files`
# from treating a `...-<sid>.json.closed.bak` backup as a state file (it does
# not end in `.json`, so it is invisible to `<prefix>*.json`).
STATE_PREFIXES="goal-state- ultragoal-state- prometheus-state- deep-interview-active-state- qa-state- explain-diff-state-"

# SESSION_ARTIFACT_PREFIXES — the 6 whitelisted session-artifact families
# reap_session_artifacts is allowed to reap. An enumerated whitelist (over a
# session-id-shaped pattern sweep) trades "a missed future family goes
# unreaped" against a pattern sweep's power to delete any session-id-shaped
# file, including forms nobody has classified yet — a miss here is
# non-destructive, so it is the safer failure direction for an irreversible
# delete path. reap_session_artifacts is deliberately NOT `.json`-anchored:
# state/block-count-* files carry no extension at all.
SESSION_ARTIFACT_PREFIXES="codex-todo- state/block-count- goal-verdict- goal-codereview- ultragoal-verdict- ultragoal-codereview-"

# _pretool_trace_stale <file> <now_epoch>
#
# Returns success only when a regular, non-symlink file has a readable mtime
# strictly older than seven days.  A missing/unreadable mtime is preserved.
_pretool_trace_stale() {
  local file="$1"
  local now_epoch="$2"
  [ -f "$file" ] || [ -d "$file" ] || return 1
  [ -L "$file" ] && return 1
  local touched
  touched=$(_state_liveness_stat_mtime "$file" 2>/dev/null || true)
  case "$touched" in ''|*[!0-9]*) return 1 ;; esac
  local age=$((now_epoch - touched))
  [ "$age" -gt "$PRETOOL_TRACE_RETENTION_TTL" ]
}

_pretool_trace_safe_name() {
  local name="$1"
  printf '%s\n' "$name" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$'
}

_pretool_trace_hex_key() {
  local name="$1"
  printf '%s\n' "$name" | grep -Eq '^[0-9a-f]{64}\.key$'
}

_pretool_trace_lease_lock_recover() {
  local lock="$1" now_epoch="$2" entries owner pid probe entry count
  [ -d "$lock" ] && [ ! -L "$lock" ] || return 1
  count=0; owner=""
  for entry in "$lock"/* "$lock"/.[!.]* "$lock"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    count=$((count + 1)); owner="$entry"
  done
  [ "$count" -eq 1 ] || {
    [ "$count" -eq 0 ] && _pretool_trace_stale "$lock" "$now_epoch" && rmdir "$lock" 2>/dev/null
    return $?
  }
  owner="${owner##*/}"
  printf '%s\n' "$owner" | grep -Eq '^owner-[0-9]+-[0-9a-f]+$' || return 1
  [ -f "$lock/$owner" ] && [ ! -L "$lock/$owner" ] || return 1
  pid="${owner#owner-}"; pid="${pid%%-*}"
  [ ! -s "$lock/$owner" ] || return 1
  probe=$(kill -0 "$pid" 2>&1) && return 1
  printf '%s\n' "$probe" | grep -qi 'operation not permitted' && return 1
  rm -f "$lock/$owner" 2>/dev/null && rmdir "$lock" 2>/dev/null
}

_pretool_trace_valid_lease_lock() {
  local lock="$1" owner pid entry count
  [ -d "$lock" ] && [ ! -L "$lock" ] || return 1
  count=0; owner=""
  for entry in "$lock"/* "$lock"/.[!.]* "$lock"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    count=$((count + 1)); owner="$entry"
  done
  [ "$count" -eq 1 ] || return 1
  [ -f "$owner" ] && [ ! -L "$owner" ] || return 1
  [ ! -s "$owner" ] || return 1
  owner="${owner##*/}"; printf '%s\n' "$owner" | grep -Eq '^owner-[0-9]+-[0-9a-f]+$' || return 1
  pid="${owner#owner-}"; pid="${pid%%-*}"
  [ ! -s "$lock/$owner" ] || return 1
  return 0
}

# --- Append-lock coordination (pretool-trace/.append.lock) -----------------
#
# This is a SEPARATE protocol from the key lease-lock helpers above: the
# append lock is acquired/held by scripts/pretool-trace/storage.ts's
# acquireAppendLock/inspectAndRecoverLock (a live writer's non-blocking
# appendEvent()), and its owner marker carries NON-EMPTY JSON metadata
# (`{"pid":<pid>,"nonce":"<nonce>"}`), unlike the lease-lock's empty-file
# marker. reap_pretool_trace_artifacts's generation-cleanup loop must
# interoperate with exactly this protocol before deleting events.jsonl[.1-3],
# so a live writer's in-flight append is never raced.
#
# _PRETOOL_APPEND_LOCK_GRACE — mirrors storage.ts's LOCK_INIT_GRACE_MS
# (1000ms): an empty lock dir is only recoverable once older than this many
# seconds, giving a writer that just mkdir'd the lock time to create its
# owner file before cleanup treats the brief empty window as abandoned.
_PRETOOL_APPEND_LOCK_GRACE=1

# _pretool_append_lock_recover <lock> <now_epoch>
#
# Mirrors inspectAndRecoverLock exactly: recovers (unlinks the owner, rmdirs
# the lock) ONLY when the lock is a real non-symlink directory containing
# EXACTLY ONE entry that is a regular non-symlink file named
# "owner-<pid>-<nonce>" whose content is byte-exactly
# {"pid":<pid>,"nonce":"<nonce>"} (matching name) AND that pid is dead (not
# EPERM). An empty lock dir recovers only once older than the init grace.
# Every other shape (live owner, malformed/mismatched JSON, >1 entry,
# unreadable owner, symlinked lock) is left untouched — return 1, unsafe.
_pretool_append_lock_recover() {
  local lock="$1" now_epoch="$2"
  local entry count owner name content pid nonce name_pid name_nonce probe mtime age
  [ -d "$lock" ] && [ ! -L "$lock" ] || return 1
  count=0; owner=""
  for entry in "$lock"/* "$lock"/.[!.]* "$lock"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    count=$((count + 1)); owner="$entry"
  done
  if [ "$count" -eq 0 ]; then
    mtime=$(_state_liveness_stat_mtime "$lock" 2>/dev/null || true)
    case "$mtime" in ''|*[!0-9]*) return 1 ;; esac
    age=$((now_epoch - mtime))
    [ "$age" -gt "$_PRETOOL_APPEND_LOCK_GRACE" ] || return 1
    rmdir "$lock" 2>/dev/null
    return $?
  fi
  [ "$count" -eq 1 ] || return 1
  name="${owner##*/}"
  printf '%s\n' "$name" | grep -Eq '^owner-[0-9]+-[0-9a-f]+$' || return 1
  [ -f "$owner" ] && [ ! -L "$owner" ] || return 1
  content=$(cat "$owner" 2>/dev/null) || return 1
  case "$content" in
    '{"pid":'[0-9][0-9]*',"nonce":"'[0-9a-f][0-9a-f]*'"}') ;;
    *) return 1 ;;
  esac
  pid="${content#*:}"; pid="${pid%%,*}"
  nonce="${content#*,}"; nonce="${nonce#*:}"; nonce="${nonce#\"}"; nonce="${nonce%\"\}}"
  name_pid="${name#owner-}"; name_pid="${name_pid%%-*}"
  name_nonce="${name#owner-*-}"
  [ "$pid" = "$name_pid" ] && [ "$nonce" = "$name_nonce" ] || return 1
  probe=$(kill -0 "$pid" 2>&1) && return 1
  printf '%s\n' "$probe" | grep -qi 'operation not permitted' && return 1
  rm -f "$owner" 2>/dev/null && rmdir "$lock" 2>/dev/null
}

# _pretool_append_lock_acquire <lock> <now_epoch>
#
# Mirrors acquireAppendLock: `mkdir` is the atomic acquisition primitive. On
# EEXIST, attempts recovery exactly once and retries; any other outcome is
# acquisition failure. On success echoes the created owner path (caller
# captures it via command substitution) and returns 0; on failure prints
# nothing and returns 1.
_pretool_append_lock_acquire() {
  local lock="$1" now_epoch="$2" attempt nonce owner
  for attempt in 0 1; do
    if mkdir "$lock" 2>/dev/null; then
      chmod 700 "$lock" 2>/dev/null || true
      nonce=$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
      case "$nonce" in [0-9a-f][0-9a-f]*) ;; *) rmdir "$lock" 2>/dev/null; return 1 ;; esac
      owner="$lock/owner-$$-$nonce"
      if (umask 077; printf '{"pid":%s,"nonce":"%s"}' "$$" "$nonce" > "$owner") 2>/dev/null; then
        chmod 600 "$owner" 2>/dev/null || true
        printf '%s\n' "$owner"
        return 0
      fi
      rm -f "$owner" 2>/dev/null
      rmdir "$lock" 2>/dev/null
      return 1
    fi
    if [ "$attempt" -eq 0 ] && _pretool_append_lock_recover "$lock" "$now_epoch"; then
      continue
    fi
    return 1
  done
  return 1
}

# _pretool_append_lock_release <owner> <lock>
#
# Releases only the caller's own owner + lock — never evicts a lock this
# call did not itself create in _pretool_append_lock_acquire.
_pretool_append_lock_release() {
  local owner="$1" lock="$2"
  rm -f "$owner" 2>/dev/null
  rmdir "$lock" 2>/dev/null
  return 0
}

# reap_pretool_trace_artifacts <root> <now_epoch> <dry_run>
#
# Scans only the explicit trace/key/evidence allowlist.  It emits stale paths
# (including the exact lock directory) and never follows a symlink or enters
# an unknown directory.  The empty real lock is removed with rmdir only.
reap_pretool_trace_artifacts() {
  local root="$1" now_epoch="$2" dry_run="$3"
  local path name work child nonempty had_failure=0
  local append_lock append_lock_owner append_lock_acquired
  local trace="$root/pretool-trace"
  local keys="$trace/keys"
  local evidence="$root/evidence"
  local evidence_trace="$evidence/pretool-trace"

  # Trace generations and keys.
  if [ -d "$trace" ] && [ ! -L "$trace" ]; then
    # Coordinate with a live writer's append lock (see the
    # _pretool_append_lock_* helpers above) before deleting any generation.
    # dry_run stays fully read-only: never create/acquire/mutate the lock.
    # In execute mode, acquisition failure (busy or any ambiguous/unsafe
    # lock state) skips deletion of ALL FOUR generations this pass, per the
    # fail-toward-preservation invariant — the rest of cleanup below is
    # unaffected.
    append_lock="$trace/.append.lock"
    append_lock_owner=""
    append_lock_acquired=0
    if [ "$dry_run" != "1" ]; then
      if append_lock_owner=$(_pretool_append_lock_acquire "$append_lock" "$now_epoch"); then
        append_lock_acquired=1
      fi
    fi
    if [ "$dry_run" = "1" ] || [ "$append_lock_acquired" -eq 1 ]; then
      for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
        path="$trace/$name"
        if _pretool_trace_stale "$path" "$now_epoch"; then
          if [ "$dry_run" = "1" ]; then printf '%s\n' "$path"
          elif rm -f "$path" 2>/dev/null; then printf '%s\n' "$path"
          else echo "reap: failed to delete $path" >&2; had_failure=1; fi
        fi
      done
    fi
    if [ "$append_lock_acquired" -eq 1 ]; then
      _pretool_append_lock_release "$append_lock_owner" "$append_lock"
    fi
    if [ -d "$keys" ] && [ ! -L "$keys" ]; then
      for path in "$keys"/*; do
        [ -f "$path" ] || continue
        [ -L "$path" ] && continue
        name="${path##*/}"
        _pretool_trace_hex_key "$name" || continue
        # Coordinate with getSessionKey's lease renewal.  mkdir is the
        # atomic lock acquisition; stale is re-checked while held so a
        # reader cannot be deleted between stat and unlink.
        local lease_lock="${path}.lease-lock"
        if [ "$dry_run" = "1" ]; then
          _pretool_trace_stale "$path" "$now_epoch" && printf '%s\n' "$path"
        elif mkdir "$lease_lock" 2>/dev/null; then
          local lease_owner="owner-$$-$(printf '%x' $$)"
          if ! (umask 077; : > "$lease_lock/$lease_owner"); then
            rmdir "$lease_lock" 2>/dev/null || true
            continue
          fi
          if _pretool_trace_stale "$path" "$now_epoch"; then
            if [ "$dry_run" = "1" ]; then printf '%s\n' "$path"
            elif rm -f "$path" 2>/dev/null; then printf '%s\n' "$path"
            else echo "reap: failed to delete $path" >&2; had_failure=1; fi
          fi
          rm -f "$lease_lock/$lease_owner" 2>/dev/null || true
          rmdir "$lease_lock" 2>/dev/null || true
        else
          _pretool_trace_lease_lock_recover "$lease_lock" "$now_epoch" >/dev/null 2>&1 || true
        fi
      done
    fi
    # Only the exact empty real lock is eligible for rmdir.
    path="$trace/.append.lock"
    if [ -d "$path" ] && [ ! -L "$path" ] && _pretool_trace_stale "$path" "$now_epoch"; then
      nonempty=0
      for child in "$path"/* "$path"/.[!.]* "$path"/..?*; do
        [ -e "$child" ] || [ -L "$child" ] || continue
        nonempty=1
        break
      done
      if [ "$nonempty" -eq 0 ]; then
        if [ "$dry_run" = "1" ]; then printf '%s\n' "$path"
        elif rmdir "$path" 2>/dev/null; then printf '%s\n' "$path"
        else echo "reap: failed to remove $path" >&2; had_failure=1; fi
      fi
    fi
  fi

  # Evidence work-item directories are an explicit finite allowlist.
  if [ -d "$evidence" ] && [ ! -L "$evidence" ] && [ -d "$evidence_trace" ] && [ ! -L "$evidence_trace" ]; then
    for work in wi-1 wi-2 wi-3 wi-4 wi-5 wi-6 wi-7 wi-8 wi-9 wi-10 final; do
      path="$evidence_trace/$work"
      [ -d "$path" ] && [ ! -L "$path" ] || continue
      for child in "$path"/*; do
        [ -f "$child" ] || continue
        [ -L "$child" ] && continue
        name="${child##*/}"
        _pretool_trace_safe_name "$name" || continue
        if _pretool_trace_stale "$child" "$now_epoch"; then
          if [ "$dry_run" = "1" ]; then printf '%s\n' "$child"
          elif rm -f "$child" 2>/dev/null; then printf '%s\n' "$child"
          else echo "reap: failed to delete $child" >&2; had_failure=1; fi
        fi
      done
    done
  fi
  [ "$had_failure" -eq 0 ]
}

# list_pretool_trace_symlinks <root>
# Report symlinked allowed ancestors/leaves without traversing them.
list_pretool_trace_symlinks() {
  local root="$1" path work name
  local trace="$root/pretool-trace" evidence="$root/evidence" evidence_trace="$root/evidence/pretool-trace"
  for path in "$trace" "$trace/keys" "$trace/.append.lock" "$evidence" "$evidence_trace"; do
    [ -L "$path" ] && printf '%s\n' "$path"
  done
  if [ -d "$evidence_trace" ] && [ ! -L "$evidence_trace" ]; then
    for work in wi-1 wi-2 wi-3 wi-4 wi-5 wi-6 wi-7 wi-8 wi-9 wi-10 final; do
      path="$evidence_trace/$work"
      [ -L "$path" ] && printf '%s\n' "$path"
      if [ -d "$path" ] && [ ! -L "$path" ]; then
        for name in "$path"/* "$path"/.[!.]* "$path"/..?*; do
          [ -L "$name" ] && printf '%s\n' "$name"
        done
      fi
    done
  fi
  if [ -d "$trace" ] && [ ! -L "$trace" ]; then
    for name in events.jsonl events.jsonl.1 events.jsonl.2 events.jsonl.3; do
      path="$trace/$name"
      [ -L "$path" ] && printf '%s\n' "$path"
    done
    if [ -d "$trace/keys" ] && [ ! -L "$trace/keys" ]; then
      for path in "$trace/keys"/*; do [ -L "$path" ] && printf '%s\n' "$path"; done
    fi
  fi
  return 0
}

# pretool_trace_find_ancestor_symlink <path>
# Walk the lexical path from the managed root toward `/` without resolving it.
# This catches an intermediate alias (for example holder/alias/root) before
# any glob can follow it, while leaving ordinary ancestors such as /tmp alone.
pretool_trace_find_ancestor_symlink() {
  local current="$1" parent
  case "$current" in /*) ;; *) return 1 ;; esac
  while :; do
    # macOS commonly exposes /var (and temporary roots beneath it) as a
    # system alias. These OS-owned ancestors are outside the managed OMT
    # boundary; do not reject them while still checking every project-local
    # component below the boundary.
    case "$current" in /tmp|/var|/private/var|/Users|/private/Users) return 1 ;; esac
    if [ -L "$current" ]; then
      printf '%s\n' "$current"
      return 0
    fi
    [ "$current" = "/" ] && break
    parent="${current%/*}"
    [ -n "$parent" ] || parent="/"
    [ "$parent" = "$current" ] && break
    current="$parent"
  done
  return 1
}

# list_pretool_trace_unclassified <root>
# Report immediate entries beneath managed trace/evidence directories that are
# outside the allowlist. Unknown directories are reported but never entered.
list_pretool_trace_unclassified() {
  local root="$1" path name work child base
  local trace="$root/pretool-trace" keys="$root/pretool-trace/keys"
  local evidence_trace="$root/evidence/pretool-trace"
  if [ -d "$trace" ] && [ ! -L "$trace" ]; then
    for child in "$trace"/* "$trace"/.[!.]* "$trace"/..?*; do
      [ -e "$child" ] || [ -L "$child" ] || continue
      name="${child##*/}"
      case "$name" in events.jsonl|events.jsonl.1|events.jsonl.2|events.jsonl.3|.append.lock|keys) ;; *) printf '%s\n' "$child" ;; esac
    done
    if [ -d "$keys" ] && [ ! -L "$keys" ]; then
      for child in "$keys"/* "$keys"/.[!.]* "$keys"/..?*; do
        [ -e "$child" ] || [ -L "$child" ] || continue
        name="${child##*/}"
        if _pretool_trace_hex_key "$name"; then
          continue
        fi
        case "$name" in
          *.key.lease-lock)
            base="${name%.lease-lock}"
            _pretool_trace_hex_key "$base" && _pretool_trace_valid_lease_lock "$child" && continue
            ;;
        esac
        printf '%s\n' "$child"
      done
    fi
  fi
  if [ -d "$evidence_trace" ] && [ ! -L "$evidence_trace" ]; then
    for child in "$evidence_trace"/* "$evidence_trace"/.[!.]* "$evidence_trace"/..?*; do
      [ -e "$child" ] || [ -L "$child" ] || continue
      name="${child##*/}"
      case "$name" in wi-1|wi-2|wi-3|wi-4|wi-5|wi-6|wi-7|wi-8|wi-9|wi-10|final) ;; *) printf '%s\n' "$child" ;; esac
    done
    for work in wi-1 wi-2 wi-3 wi-4 wi-5 wi-6 wi-7 wi-8 wi-9 wi-10 final; do
      path="$evidence_trace/$work"
      [ -d "$path" ] && [ ! -L "$path" ] || continue
      for child in "$path"/* "$path"/.[!.]* "$path"/..?*; do
        [ -e "$child" ] || [ -L "$child" ] || continue
        name="${child##*/}"
        _pretool_trace_safe_name "$name" || printf '%s\n' "$child"
      done
    done
  fi
  return 0
}

# is_state_live <file> <now_epoch>
#
# Returns:
#   exit 0  — state is live (keep)
#   exit 1  — state is dead (reap)
#
# Single liveness rule (from plan line 30):
#   live iff (active && age < ACTIVE_IDLE_TTL) or (!active && age < TERMINAL_TTL)
#   where age = now - last_touched_at
#   Fallback chain for touched: last_touched_at -> started_at -> file mtime
#   Clock skew (touched > now): clamp age to 0 (treat as live), never error.
is_state_live() {
  local file="$1"
  local now_epoch="$2"

  if [ ! -f "$file" ]; then
    return 1
  fi

  # ---------------------------------------------------------------------------
  # Parse .active field
  # Dual-path: jq (preferred) → grep fallback (for environments without jq)
  # ---------------------------------------------------------------------------
  local active_val
  active_val=$(jq -r '.active // "absent"' "$file" 2>/dev/null) || active_val="absent"

  if [ "$active_val" = "absent" ] || [ "$active_val" = "null" ] || [ -z "$active_val" ]; then
    # jq absent or failed — grep fallback
    if grep -q '"active"[[:space:]]*:[[:space:]]*true' "$file" 2>/dev/null; then
      active_val="true"
    elif grep -q '"active"[[:space:]]*:[[:space:]]*false' "$file" 2>/dev/null; then
      active_val="false"
    else
      active_val="true"   # default: treat missing active as active (safer)
    fi
  fi

  # ---------------------------------------------------------------------------
  # Parse touched timestamp: last_touched_at -> started_at -> file mtime
  # Reuses the exact parse idiom from session-start.sh:80-101
  # ---------------------------------------------------------------------------
  local touched_epoch=""

  # Try last_touched_at first
  local ts
  ts=$(jq -r '.last_touched_at // ""' "$file" 2>/dev/null) || ts=""
  if [ -z "$ts" ] || [ "$ts" = "null" ]; then
    ts=""
  fi

  # Fallback to started_at
  if [ -z "$ts" ]; then
    ts=$(jq -r '.started_at // ""' "$file" 2>/dev/null) || ts=""
    if [ -z "$ts" ] || [ "$ts" = "null" ]; then
      ts=""
    fi
  fi

  if [ -n "$ts" ]; then
    # Parse ISO 8601. An explicit Z/offset suffix, when present, must be
    # honored — not stripped and reparsed as local wall-clock, which would
    # misread a genuinely UTC-stamped timestamp by this host's own UTC
    # offset. BSD date (macOS) is the deploy target; GNU date -d is the
    # Linux/CI fallback. No-suffix case mirrors session-start.sh:84-85
    # unchanged.
    local time_part suffix offset_hhmm
    suffix=$(printf '%s' "$ts" | sed -nE 's/.*(Z|[+-][0-9]{2}:[0-9]{2})$/\1/p')
    time_part=$(printf '%s' "$ts" | sed -E 's/(Z|[+-][0-9]{2}:[0-9]{2})$//')
    if [ -n "$suffix" ]; then
      if [ "$suffix" = "Z" ]; then
        offset_hhmm="+0000"
      else
        offset_hhmm=$(printf '%s' "$suffix" | tr -d ':')
      fi
      touched_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "${time_part}${offset_hhmm}" "+%s" 2>/dev/null \
        || date -d "$ts" "+%s" 2>/dev/null \
        || date -d "$time_part" "+%s" 2>/dev/null \
        || true)
    else
      touched_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$time_part" "+%s" 2>/dev/null \
        || date -d "$time_part" "+%s" 2>/dev/null \
        || true)
    fi
  fi

  if [ -z "$touched_epoch" ]; then
    # No parseable timestamp — fall back to file mtime.
    # GNU form (-c %Y) first: GNU `stat -f` means --file-system and prints a
    # non-numeric block to stdout for the file operand, which would defeat the
    # fail-safe below by leaving touched_epoch as non-empty garbage; BSD `stat -c`
    # fails cleanly with no stdout. GNU-first is portable; BSD-first breaks on Linux.
    touched_epoch=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || true)
  fi

  if [ -z "$touched_epoch" ]; then
    # Cannot determine age; treat as live (fail-safe)
    return 0
  fi

  # ---------------------------------------------------------------------------
  # Compute age — clamp negative (clock skew) to 0
  # ---------------------------------------------------------------------------
  local age=$(( now_epoch - touched_epoch ))
  if [ "$age" -lt 0 ]; then
    age=0
  fi

  # ---------------------------------------------------------------------------
  # Apply the Single liveness rule
  # ---------------------------------------------------------------------------
  if [ "$active_val" = "true" ]; then
    if [ "$age" -lt "$ACTIVE_IDLE_TTL" ]; then
      return 0
    else
      return 1
    fi
  else
    # active:false — terminal state
    if [ "$age" -lt "$TERMINAL_TTL" ]; then
      return 0
    else
      return 1
    fi
  fi
}

# is_current_session <file> <current_sid>
#
# Returns:
#   exit 0 — <file>'s basename belongs to <current_sid>
#   exit 1 — it does not
#
# Generalized sid-suffix match (replaces the old 5-prefix `case`, which only
# recognized state files and silently misclassified every session-artifact
# form — e.g. goal-codereview-<sid>.json — as belonging to "another session").
# A basename belongs to <current_sid> iff it is exactly "<anything>-<sid>" or
# starts with "<anything>-<sid>.". Two case patterns cover every form on disk:
#   *-"$current_sid")    the extensionless form, e.g. state/block-count-<sid>
#   *-"$current_sid".*)  the .json and double-extension forms, e.g.
#                        goal-state-<sid>.json,
#                        deep-interview-active-state-<sid>.json.closed.bak
# This is deliberately NOT "strip the extension, then compare": stripping one
# extension from a double-extension name leaves "...-<sid>.json.closed", which
# no longer ends in the sid and would misclassify the running session's own
# backup as belonging to another session.
is_current_session() {
  local file="$1"
  local current_sid="$2"

  # Preserve the old `*)` branch's accidental fail-safe: an empty current_sid
  # used to make file_sid="" equal current_sid="", so everything was kept.
  # Keep that explicitly rather than let the case patterns re-derive it.
  if [ -z "$current_sid" ]; then
    return 0
  fi

  # ${file##*/} (pure Bash expansion, no fork) instead of `basename "$file"`:
  # identical output for every shape this file handles (goal-state-<sid>.json,
  # the .closed.bak double-extension form, the extensionless
  # state/block-count-<sid> form) — the only case where the two diverge is a
  # path with a trailing slash (basename "foo/" -> "foo", ${file##*/} ->
  # ""), which never occurs here since every $file is a glob match against
  # an actual file, never a directory path.
  local basename_val
  basename_val="${file##*/}"

  case "$basename_val" in
    *-"$current_sid")
      return 0 ;;
    *-"$current_sid".*)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

# _state_liveness_stat_mtime <file> — echoes mtime epoch, or nothing on failure
# _state_liveness_stat_batch <path...> — echoes "<mtime> <path>" per resolved
#   path, one stat invocation covering every argument (never re-probed per call)
#
# One-time (source-time, not per-call) detection of which stat flavor this
# host has, cached as directly-callable functions — the single-file form so
# is_artifact_live's per-file callers pay exactly one fork per call instead of
# two, and the batched form so a whole directory's mtimes can be fetched in
# ONE fork regardless of file count (see is_artifact_live's doc comment and
# list_live_session_ids / reap_session_artifacts below for why the per-file
# form is still not enough on its own).
#
# is_state_live's own probe (:106 above, byte-identical to base d215e9ce and
# NOT touched by this change) is GNU-first, BSD-fallback:
#   stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || true
# macOS — this file's deploy target — always fails the GNU form (`stat -c`:
# "illegal option -- c"), so that probe pays a guaranteed-failing fork on
# every single is_state_live call on macOS. is_artifact_live is the call site
# free to fix this (is_state_live's body must stay byte-identical to base).
#
# Detecting the working form once against this very file (BASH_SOURCE[0],
# guaranteed to exist — it is the file currently being sourced) and caching
# direct single-form calls removes the wasted fork for every later
# is_artifact_live call, AND supplies the batched form from the exact same
# single detection — there is deliberately no second probe here: both forms
# are defined together, branch-for-branch, off the one gnu/bsd/unknown
# decision below, per the plan's "reuse detection, do not add a second
# mechanism" constraint. Detection order deliberately still tries GNU first:
# on a GNU/Linux host, `stat -f <file>` runs in --file-system mode and prints
# a non-numeric block to stdout instead of failing, so probing BSD-first here
# would misdetect "BSD works" on a GNU host. GNU-first has no equivalent trap
# in the other direction — BSD `stat -c` fails cleanly with no stdout.
#
# Batched format strings put mtime FIRST on every line ("%Y %n" / "%m %N"),
# deliberately — a filename may itself contain spaces, but a Unix mtime never
# does, so `${line%% *}` (longest match from the end of a " *" pattern, i.e.
# up to the FIRST space) reliably isolates the mtime and `${line#* }`
# (shortest match from the start) reliably isolates everything after that
# first space — the full path, spaces and all. Newline-bearing filenames are
# explicitly out of scope for CORRECT parsing: no producer in this codebase
# emits one (session ids and the fixed prefixes above never contain a
# literal newline), and `read -r line` inherently cannot distinguish an
# embedded newline from a line boundary, so this helper does not attempt to
# parse such a record correctly — it relies on every caller to reject the
# resulting record's tail half instead (see the caller-guard obligation
# below); the record's other, still-anchored head half passes that guard
# too and is left to each caller's own witness/no-op handling. That guard
# cannot move into this helper: rejecting the tail half needs the caller's
# own <dir> and <prefix> to anchor the path against, and neither is
# available here.
if stat -c %Y "${BASH_SOURCE[0]}" >/dev/null 2>&1; then
  _state_liveness_stat_mtime() { stat -c %Y "$1" 2>/dev/null; }
  _state_liveness_stat_batch() { stat -c '%Y %n' "$@" 2>/dev/null; }
elif stat -f %m "${BASH_SOURCE[0]}" >/dev/null 2>&1; then
  _state_liveness_stat_mtime() { stat -f %m "$1" 2>/dev/null; }
  _state_liveness_stat_batch() { stat -f '%m %N' "$@" 2>/dev/null; }
else
  # Neither form works against a file known to exist — an unrecognized stat
  # flavor. Fall back to the original two-attempt probe rather than silently
  # returning nothing on every call; batched form mirrors the same fallback.
  _state_liveness_stat_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || true; }
  _state_liveness_stat_batch() { stat -c '%Y %n' "$@" 2>/dev/null || stat -f '%m %N' "$@" 2>/dev/null || true; }
fi

# _STATE_LIVENESS_STAT_CHUNK — max paths passed to one underlying
# _state_liveness_stat_batch call. ARG_MAX on this file's macOS deploy target
# measures 1048576 bytes (`getconf ARG_MAX`); POSIX guarantees at least 4096
# as the argument-COUNT floor via {ARG_MAX} on older/other hosts. 500 paths at
# a generous ~200 bytes/path (long absolute $OMT_DIR paths included) is ~100KB
# — far under either bound — while still cutting a 10,000-file directory to
# 20 stat calls instead of one per file. This is the directory-growth
# headroom the plan calls for, without hardcoding today's ~465-file size as a
# ceiling.
_STATE_LIVENESS_STAT_CHUNK=500

# _state_liveness_stat_batch_lines <path...>
#
# Runs the batched stat form over <path...>, split into
# _STATE_LIVENESS_STAT_CHUNK-sized groups so one call never risks ARG_MAX (see
# above). Echoes "<mtime> <path>" one line per input path stat could resolve.
#
# Silent omission is the explicit contract, not an oversight: a path stat
# could not resolve (deleted/unreadable in the race between glob expansion
# and this call) simply produces no line. Every caller below must therefore
# treat "this path never appeared in the output" as "cannot determine,
# preserve" — the same fail-open direction as is_artifact_live's own -z guard
# — never as "reap it". Both call sites achieve this for free: a candidate
# with no output line gets no loop iteration at all, so nothing happens to it
# (the file survives untouched), which is exactly the fail-open outcome.
#
# Every caller must ALSO guard the lines it does get, immediately after
# splitting mtime/path: reject a non-numeric mtime, and reject a path not
# anchored to that caller's own "$dir/$prefix". A newline embedded in a
# filename (out of scope for this helper's own parsing, per the doc comment
# above) splits one batched-stat line into two — this pair of guards
# reliably rejects the SECOND (tail) half, a bare filename fragment that
# can never contain '/'. The FIRST (head) half is a truncated-but-still-
# anchored path and passes both guards; it is kept harmless by each call
# site's own downstream logic (the live-id witness pass / a no-op `rm -f`
# on a path that turns out not to exist), not by this guard pair — see each
# call site's own comment below. Both call sites apply this pair of guards
# right after the split, before the value reaches any arithmetic or `rm`.
_state_liveness_stat_batch_lines() {
  local -a chunk
  local p
  chunk=()
  for p in "$@"; do
    chunk+=("$p")
    if [ "${#chunk[@]}" -ge "$_STATE_LIVENESS_STAT_CHUNK" ]; then
      _state_liveness_stat_batch "${chunk[@]}"
      chunk=()
    fi
  done
  if [ "${#chunk[@]}" -gt 0 ]; then
    _state_liveness_stat_batch "${chunk[@]}"
  fi
  return 0
}

# _artifact_age_live <mtime_epoch> <now_epoch>
#
# Pure age judgment, split out of the mtime FETCH (is_artifact_live below,
# and the batched loops in list_live_session_ids / reap_session_artifacts)
# specifically so a caller that already knows a file's mtime — from a single
# _state_liveness_stat_mtime call OR from one line of a batched
# _state_liveness_stat_batch_lines pass — can judge liveness without paying a
# second per-file stat fork. Same rule and boundary as is_artifact_live's
# original inline check: age < ACTIVE_IDLE_TTL -> live.
_artifact_age_live() {
  local mtime_epoch="$1"
  local now_epoch="$2"

  local age=$(( now_epoch - mtime_epoch ))
  if [ "$age" -lt 0 ]; then
    age=0
  fi

  [ "$age" -lt "$ACTIVE_IDLE_TTL" ]
}

# is_artifact_live <file> <now_epoch>
#
# Returns:
#   exit 0 — artifact is live (keep)
#   exit 1 — artifact is dead (reap)
#
# Session artifacts (codex-todo, goal-verdict, goal-codereview, ...) carry no
# `active` field, so is_state_live's two-branch rule cannot apply to them.
# Liveness here is mtime-only against ACTIVE_IDLE_TTL — the same rule and the
# same reason as the session-ledger mtime loop in hooks/session-start.sh.
#
# Thin wrapper: fetch (this function's own job) then judge (_artifact_age_live
# above). Signature and behavior here are byte-for-byte what they were before
# the split.
#
# Test-only now, not a production judgment: the two hot loops that used to
# call this (list_live_session_ids below and reap_session_artifacts) were
# rewritten to call _artifact_age_live directly against a batch-fetched mtime,
# so this wrapper has zero production callers — only this file's colocated
# test exercises it. Adding a preservation condition
# here changes nothing about what the reaper actually keeps or deletes; that
# behavior is governed by _artifact_age_live, which the hot loops call
# directly.
is_artifact_live() {
  local file="$1"
  local now_epoch="$2"

  # Single fork via the cached, detected-once form above (was a GNU-first,
  # BSD-fallback double stat call — see _state_liveness_stat_mtime's own doc
  # comment for why that cost two forks per call on this file's macOS deploy
  # target). `|| true` preserves the original's fail-safe: a nonexistent or
  # unreadable file leaves touched_epoch empty without tripping a `set -e`
  # caller (omt-cleanup.sh sources this file under `set -e`).
  local touched_epoch
  touched_epoch=$(_state_liveness_stat_mtime "$file") || true

  if [ -z "$touched_epoch" ]; then
    # Cannot determine mtime (missing file, unreadable, race) — treat as live
    # (fail-safe), matching is_state_live's own "cannot determine age; treat
    # as live" fallback-mtime branch.
    # This -z check is load-bearing: `$(( now_epoch - touched_epoch ))` with an
    # empty (but set) touched_epoch evaluates to `now_epoch` in bash, not an
    # error — silently flipping the fail direction to "delete" without this guard.
    return 0
  fi

  _artifact_age_live "$touched_epoch" "$now_epoch"
}

# list_live_session_ids <dir> <now_epoch>
#
# Echoes the bare session id of every currently-live session witness in
# <dir>, one per line, deduplicated. This is what lets reap_session_artifacts
# protect a live session's artifacts without knowing its session id — a
# caller that never had a session id to begin with (omt-cleanup) can still
# ask "is any witness for this id live right now?".
#
# Two independent witness sources are walked, not one:
#   1. STATE_PREFIXES entries, judged by is_state_live (the `.active` +
#      last_touched_at/started_at rule) — the original source.
#   2. SESSION_ARTIFACT_PREFIXES entries, judged by is_artifact_live
#      (mtime-only against ACTIVE_IDLE_TTL) — added so a plain session with
#      no STATE_PREFIXES file of its own (e.g. a Codex session that has
#      called `update_plan` but owns no goal/ultragoal/prometheus/
#      deep-interview/qa state) still gets a liveness witness whenever ANY
#      whitelisted artifact carrying its sid is being refreshed. Concretely:
#      a Codex Stop that blocks on incomplete todos writes
#      `state/block-count-<sid>` on every single blocking Stop, so that file
#      now witnesses the sid as live even after its sibling
#      `codex-todo-<sid>.json` mirror goes stale from 6h of no `update_plan`
#      call (see reap_session_artifacts's own doc comment for the mechanism
#      this closes).
# Adding this second source can only ever ADD preserved sids, never remove
# one the first source already reported — it is a pure union of two
# independently-computed live-id sets.
#
# Limitation, left open: a namespaced counter (e.g.
# state/block-count-prometheus-<sid>) strips down to the tail
# "prometheus-<sid>", not the bare sid, so it witnesses only that namespaced
# tail, never the bare sid — reap_session_artifacts's own suffix-anchor
# matching is what lets a bare live id also cover a namespaced counter, not
# this function de-namespacing anything. There is no de-namespacing logic
# here and none should be added for this reason alone.
#
# Residual left open: a session that calls neither `update_plan` (which
# refreshes codex-todo-<sid>.json) nor triggers a blocking Stop (which
# refreshes state/block-count-<sid>) for a full ACTIVE_IDLE_TTL window still
# has no live witness at all and loses its mirror to reap_session_artifacts.
# Closing that requires the reader or writer side (out of scope here — see
# the plan's Must-NOT on touching hooks/codex-persistent-mode/ and on
# reducing codex-todo write frequency).
#
# <now_epoch> is required — the caller's own clock reading, not a value this
# function fetches for itself. reap_session_artifacts always supplies its own
# <now_epoch> explicitly (see that function below): a single GC pass must
# judge state liveness and artifact liveness against one shared clock
# reading, not two independently-fetched wall-clock values that can drift a
# session across the TTL boundary between the two calls.
list_live_session_ids() {
  local dir="$1"
  local now_epoch="$2"

  local prefix f sid seen
  local -a candidates
  local line mtime
  seen=""
  for prefix in $STATE_PREFIXES; do
    for f in "$dir"/${prefix}*.json; do
      [ -f "$f" ] || continue
      if is_state_live "$f" "$now_epoch"; then
        # $dir/$prefix MUST be quoted here: unquoted, the right-hand side of
        # `#` is a glob pattern, not a literal string (SC2295). A directory
        # name containing a glob metacharacter (e.g. "proj[1]") then fails to
        # match as a prefix at all, so the strip is a no-op and "sid" becomes
        # the entire file path — corrupting every downstream live-id
        # comparison in reap_session_artifacts.
        sid="${f#"$dir/$prefix"}"
        sid="${sid%.json}"
        case " $seen " in
          *" $sid "*) continue ;;
        esac
        seen="$seen $sid"
        echo "$sid"
      fi
    done
  done
  # SESSION_ARTIFACT_PREFIXES witness pass: batched over one stat call per
  # prefix (chunked, see _state_liveness_stat_batch_lines) instead of one
  # is_artifact_live fork per candidate file — this is the loop the plan
  # names as one of the two hot loops to restructure. Each output line
  # already carries both the mtime and the path, so liveness is judged
  # directly off that line; no path->mtime lookup table is ever built (the
  # O(n^2) trap a Bash-3.2 associative-array-free lookup would fall into).
  # A candidate whose line is silently omitted (see
  # _state_liveness_stat_batch_lines's doc comment) simply never enters the
  # while-loop body below, so it contributes no witness this pass — the same
  # "under-witness, never destroy" residual already documented above for a
  # session with no witness at all (this function's own doc comment).
  for prefix in $SESSION_ARTIFACT_PREFIXES; do
    candidates=()
    for f in "$dir"/${prefix}*; do
      [ -f "$f" ] || continue
      candidates+=("$f")
    done
    [ "${#candidates[@]}" -gt 0 ] || continue

    while IFS= read -r line; do
      [ -n "$line" ] || continue
      mtime="${line%% *}"
      f="${line#* }"
      # A filename containing a literal newline splits one batched-stat
      # record into two lines, and the forged second (tail) line's first
      # token lands in $mtime. The tail line's $f is always a suffix of a
      # filename, and a filename cannot contain '/' — so it can never match
      # the anchor pattern below, whose "$dir/$prefix" always contains a
      # literal '/'. That anchor alone rejects the tail line structurally;
      # this numeric check is SUBSUMED by it for that half, and kept as a
      # second guard directly on the path to _artifact_age_live's
      # arithmetic context.
      #
      # The FIRST (head) line of the same split is not caught by either
      # guard: its $f is the real filename truncated AT the embedded
      # newline, which is still a "$dir/$prefix"-anchored path (the case
      # pattern below matches on a prefix, not full equality), so the head
      # line passes both this numeric check and the anchor. It is harmless
      # in THIS loop only because the loop's job is to ADD live ids, never
      # remove one: a stale head line simply fails _artifact_age_live and
      # echoes nothing here, while the real file at that same path (if one
      # exists) contributes its own genuine, correctly-formed line
      # elsewhere in this same batch output.
      case "$mtime" in ''|*[!0-9]*) continue ;; esac
      # Rejects the tail line (see above); the head line passes this too.
      case "$f" in "$dir/$prefix"*) ;; *) continue ;; esac
      if _artifact_age_live "$mtime" "$now_epoch"; then
        # Same SC2295 hazard as the STATE_PREFIXES pass above — quote the
        # prefix strip. Extension stripping mirrors reap_session_artifacts's
        # own tail derivation (everything from the first '.'), since this
        # glob is not `.json`-anchored (state/block-count-* has none).
        sid="${f#"$dir/$prefix"}"
        sid="${sid%%.*}"
        case " $seen " in
          *" $sid "*) continue ;;
        esac
        seen="$seen $sid"
        echo "$sid"
      fi
    done <<STAT_LINES
$(_state_liveness_stat_batch_lines "${candidates[@]}")
STAT_LINES
  done
  return 0
}

# reap_dead_state_files <dir> <current_sid> <now_epoch> <dry_run>
#
# Relocation of the inline 5-glob state-GC loop (formerly duplicated in both
# hooks/session-start.sh and scripts/omt-cleanup/omt-cleanup.sh): for each
# STATE_PREFIXES entry, walk <dir>/<prefix>*.json, skip the current session's
# own file, and reap (or, under dry_run=1, only report) every file is_state_live
# reports dead. This reproduces the pre-relocation deletion decisions exactly —
# see hooks/lib/state-liveness_test.sh's relocation-equivalence test.
#
# <dry_run>: 1 = report only, 0 = delete. Both modes echo the affected path,
# one per line — dry_run=1 echoes what WOULD be deleted; dry_run=0 echoes a
# path only once rm -f has actually succeeded on it, so stdout never claims a
# deletion that didn't happen. A caller whose own stdout must stay
# byte-static (session-start.sh) redirects this call; the report lane is
# stderr instead.
#
# Returns 0 unless a real rm failure occurred (e.g. an unwritable directory)
# — an empty dir, no candidates, or an unreadable dir are all harmless and
# still return 0, since this file is sourced by both a `set -e` caller
# (omt-cleanup.sh) and a non-`set -e` caller (session-start.sh). A failed
# delete is reported on stderr ("reap: failed to delete <path>") and is never
# echoed to stdout as a completed deletion.
reap_dead_state_files() {
  local dir="$1"
  local current_sid="$2"
  local now_epoch="$3"
  local dry_run="$4"

  local prefix f had_failure
  had_failure=0
  for prefix in $STATE_PREFIXES; do
    for f in "$dir"/${prefix}*.json; do
      [ -f "$f" ] || continue
      if is_current_session "$f" "$current_sid"; then
        continue
      fi
      if ! is_state_live "$f" "$now_epoch"; then
        if [ "$dry_run" = "1" ]; then
          echo "$f"
        elif rm -f "$f" 2>/dev/null; then
          echo "$f"
        else
          echo "reap: failed to delete $f" >&2
          had_failure=1
        fi
      fi
    done
  done
  [ "$had_failure" = "0" ]
}

# _state_liveness_prefix_dir_contained <dir> <prefix>
#
# Returns:
#   exit 0 — the directory <prefix>'s glob will expand inside is physically
#            beneath <dir> (or <prefix> is flat, or that directory does not
#            exist) — safe to walk
#   exit 1 — that directory resolves outside <dir> — refuse to walk it
#
# SESSION_ARTIFACT_PREFIXES carries NESTED prefixes ("state/block-count-"), so
# "$dir"/${prefix}* is a two-component glob. Path expansion follows a symlink
# in an intermediate component: with <dir>/state symlinked elsewhere, the glob
# yields <dir>/state/block-count-<sid> — a path that is still string-anchored
# to "$dir/$prefix" (so reap_session_artifacts's own anchor check below passes
# it) while the file it names lives in the symlink target. `rm -f` on that
# path then deletes a file outside <dir>. Measured: an external
# block-count-<sid> is destroyed by both callers.
#
# Scoped to the DIRECTORY component on purpose. A candidate FILE that is
# itself a symlink needs no guard: `rm -f` unlinks the symlink and leaves the
# target intact (measured — and measured only after backdating the symlink's
# own mtime, since BSD `stat -f %m` reads the symlink rather than its target,
# so a freshly-created symlink is judged live and never reaches `rm -f` at
# all, which looks like the same "target survived" outcome for an entirely
# different reason).
#
# Physical containment (`pwd -P`) rather than a `[ -L "$dir/${prefix%/*}" ]`
# test: `[ -L ]` inspects only the LAST component, so it would silently pass a
# deeper prefix whose earlier component is the symlink. `${prefix%/*}` is the
# full directory portion at any depth, and resolving it physically catches the
# escape wherever in that portion it occurs. Two forks per nested prefix, and
# only "state/block-count-" is nested today.
#
# <dir> itself being a symlink is deliberately fine: <base> resolves to its
# physical target, an unescaped subdirectory still sits beneath that, and a
# deliberately-relocated OMT dir is the intended scope, not an escape.
_state_liveness_prefix_dir_contained() {
  local dir="$1"
  local prefix="$2"

  case "$prefix" in
    */*) ;;
    *) return 0 ;;
  esac

  local sub="$dir/${prefix%/*}"
  # Nonexistent subdirectory — the glob matches nothing, so there is nothing
  # to refuse. Reported as contained so the caller's normal empty-candidate
  # path handles it, not as an escape.
  [ -d "$sub" ] || return 0

  local phys base
  phys=$(cd "$sub" 2>/dev/null && pwd -P) || return 1
  base=$(cd "$dir" 2>/dev/null && pwd -P) || return 1

  # "$base" is quoted inside the pattern so a directory name containing a glob
  # metacharacter is matched literally (same SC2295-class hazard the prefix
  # strips elsewhere in this file guard against).
  case "$phys" in
    "$base"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# reap_session_artifacts <dir> <current_sid> <now_epoch> <dry_run>
#
# For each SESSION_ARTIFACT_PREFIXES entry, walk <dir>/<prefix>*, and reap (or
# report) each candidate unless one of three independent protections applies:
#   1. it belongs to the current session (is_current_session)
#   2. its own mtime is still within ACTIVE_IDLE_TTL (is_artifact_live)
#   3. its embedded session id is live right now, per list_live_session_ids —
#      this is what protects a live session's artifacts from a caller that
#      supplies no session id at all (omt-cleanup passes the __none__ sentinel).
#      list_live_session_ids itself now unions two independent witness
#      sources (STATE_PREFIXES via is_state_live, AND SESSION_ARTIFACT_PREFIXES
#      via is_artifact_live) — not STATE_PREFIXES alone — so a session with no
#      state file of its own can still be witnessed live by one of its own
#      whitelisted artifacts. See that function's doc comment for the
#      mechanism and its residual limitation.
#
# Live-id membership rule: strip the candidate's whitelist prefix, then its
# extension (everything from the first '.'). Accept if what remains equals a
# live id, OR ends with "-<live id>". Both clauses carry weight: extension
# stripping is what makes the check work at all for the 5 .json-suffixed
# families (list_live_session_ids emits bare ids, so an un-stripped
# "<sid>.json" tail matches nothing); the "-<live id>" suffix anchor is what
# lets a bare live id cover a namespaced counter (state/block-count-prometheus-<sid>,
# state/block-count-skill-chain-<sid> — see lib/persistent-mode-core/decision.ts's
# per-family block-count keys) without this file knowing those namespace names,
# while anchoring on the preceding '-' (not an arbitrary substring) keeps a
# short live id like "abc" from falsely preserving an unrelated
# "codex-todo-xyzabc.json".
#
# list_live_session_ids is computed once per directory, not once per
# candidate — a per-candidate recompute would mean ~3000 extra liveness checks
# on the measured 581-file baseline directory.
#
# <dry_run>: same polarity as reap_dead_state_files (1 = report only, 0 =
# delete); both modes echo the affected path, and (as of the rm-failure fix
# below) dry_run=0 only once rm -f has actually succeeded.
#
# Return-value contract identical to reap_dead_state_files: 0 unless a real
# rm failure occurred; harmless conditions (empty dir, no candidates) always
# return 0. A failed delete is reported on stderr and never echoed to stdout.
reap_session_artifacts() {
  local dir="$1"
  local current_sid="$2"
  local now_epoch="$3"
  local dry_run="$4"

  local live_ids
  live_ids=$(list_live_session_ids "$dir" "$now_epoch")

  local prefix f tail live_id keep had_failure
  local -a candidates
  local line mtime
  had_failure=0
  # Restructured (per the plan) to batch the mtime fetch: one stat call per
  # prefix (chunked, see _state_liveness_stat_batch_lines) instead of one
  # is_artifact_live fork per candidate file, this loop's own hot fork. The
  # loop iterates directly over the batched output's "<mtime> <path>" lines —
  # each line already carries both pieces this loop needs, so no
  # path->mtime lookup table is ever built (the O(n^2) trap a Bash-3.2
  # associative-array-free lookup would fall into).
  for prefix in $SESSION_ARTIFACT_PREFIXES; do
    # Refuse to descend through a symlinked directory component of a nested
    # prefix — otherwise `rm -f` below reaches files outside "$dir". The
    # string anchor at the bottom of this loop cannot catch it: such a path
    # IS anchored to "$dir/$prefix", it just does not physically live there.
    # See _state_liveness_prefix_dir_contained's own doc comment.
    #
    # Deliberately NOT applied to list_live_session_ids's matching loop: that
    # pass only reads mtimes and ADDS live ids, so reading through the symlink
    # can only preserve more, never destroy. Guarding it there would instead
    # strip witnesses and make this reaper delete MORE — the wrong direction
    # for a safety fix.
    _state_liveness_prefix_dir_contained "$dir" "$prefix" || continue
    candidates=()
    for f in "$dir"/${prefix}*; do
      [ -f "$f" ] || continue
      candidates+=("$f")
    done
    [ "${#candidates[@]}" -gt 0 ] || continue

    while IFS= read -r line; do
      [ -n "$line" ] || continue
      mtime="${line%% *}"
      f="${line#* }"
      # A filename containing a literal newline splits one batched-stat
      # record into two lines, and the forged second (tail) line's first
      # token lands in $mtime. The tail line's $f is always a suffix of a
      # filename, and a filename cannot contain '/' — so it can never match
      # the anchor pattern below, whose "$dir/$prefix" always contains a
      # literal '/'. That anchor alone rejects the tail line structurally;
      # this numeric check is SUBSUMED by it for that half, and kept as a
      # second guard on the path to `rm -f` below.
      #
      # The FIRST (head) line of the same split is not caught by either
      # guard: its $f is the real filename truncated AT the embedded
      # newline, which is still a "$dir/$prefix"-anchored path (the case
      # pattern below matches on a prefix, not full equality), so the head
      # line passes both this numeric check and the anchor, reaching
      # `rm -f` below same as any ordinary candidate. What actually keeps it
      # harmless is NOT this guard pair: if a real file sits at that
      # (possibly stale-mtime-mislabeled) path, list_live_session_ids's own
      # witness pass sees that file's own genuine line and reports the sid
      # live, so the keep-check below preserves it; if no real file sits
      # there, `rm -f` on the nonexistent path is a no-op.
      case "$mtime" in ''|*[!0-9]*) continue ;; esac
      # Rejects the tail line (see above); the head line passes this too,
      # since it is what reaches `rm -f` below.
      case "$f" in "$dir/$prefix"*) ;; *) continue ;; esac

      if is_current_session "$f" "$current_sid"; then
        continue
      fi
      # This per-candidate mtime check is now SUBSUMED by the live-id witness
      # pass above (list_live_session_ids's second loop walks this same
      # directory, these same prefixes, this same mtime-age predicate, and
      # derives the tail the same way) for every ORDINARY candidate: a fresh
      # candidate necessarily witnesses its own sid into live_ids and is then
      # preserved by the exact-match arm below. It stays load-bearing for
      # exactly one residual shape: a candidate whose derived tail is the
      # EMPTY STRING (e.g. a file named exactly "codex-todo-.json"). The
      # witness pass would push an empty sid for such a file too, but the
      # live-id membership loop below explicitly skips empty ids
      # (`[ -n "$live_id" ] || continue`), so the live-id path can never save
      # an empty-tail candidate — only this mtime check can.
      #
      # This shape is NOT producer-emitted: isSafeSessionId (lib/state-core.ts:90)
      # requires id.length >= 1, and every writer that could name one of these
      # artifacts checks it first — hooks/codex-persistent-mode/cli.ts:88 and
      # :217 (the codex-todo mirror), lib/state-core.ts:824 (touchSessionStates),
      # :612/:615 (adopt). No OMT code path can produce an empty-sid artifact,
      # so this guard is not covering any live production path. Its residual
      # value is against a manually-placed file or a foreign writer sharing
      # this directory. Do not remove this guard believing the witness pass
      # alone now covers it: a fresh foreign/hand-placed file of this shape
      # would otherwise be deleted, which is still the data-destruction
      # direction regardless of who wrote it.
      #
      # This is also the empty-tail fail-safe's per-file path the plan
      # requires be kept: the age judgment below runs against THIS
      # candidate's own batched-mtime line, not a shared/looked-up value, so
      # it still decides each file on its own mtime exactly as the pre-batch
      # per-file is_artifact_live call did.
      if _artifact_age_live "$mtime" "$now_epoch"; then
        continue
      fi

      # $dir/$prefix MUST be quoted here — see list_live_session_ids above
      # for why an unquoted glob-pattern strip corrupts the sid on a
      # directory name containing a glob metacharacter (SC2295).
      tail="${f#"$dir/$prefix"}"
      tail="${tail%%.*}"

      keep=0
      if [ -n "$live_ids" ]; then
        while IFS= read -r live_id; do
          [ -n "$live_id" ] || continue
          if [ "$tail" = "$live_id" ]; then
            keep=1
            break
          fi
          case "$tail" in
            *-"$live_id")
              keep=1
              break
              ;;
          esac
        done <<LIVE_IDS
$live_ids
LIVE_IDS
      fi

      if [ "$keep" = "1" ]; then
        continue
      fi

      if [ "$dry_run" = "1" ]; then
        echo "$f"
      elif rm -f "$f" 2>/dev/null; then
        echo "$f"
      else
        echo "reap: failed to delete $f" >&2
        had_failure=1
      fi
    done <<STAT_LINES
$(_state_liveness_stat_batch_lines "${candidates[@]}")
STAT_LINES
  done
  [ "$had_failure" = "0" ]
}

# list_unclassified_session_files <dir>
#
# Echoes every file in <dir> (including its state/ subdirectory) whose
# basename carries a UUID-shaped session id but matches neither
# STATE_PREFIXES nor SESSION_ARTIFACT_PREFIXES — the drift signal this
# harness otherwise has none of. Read-only: never deletes, never judges
# whether a listed file should eventually be whitelisted.
#
# state/ is swept alongside the top level (not just the top level) because
# SESSION_ARTIFACT_PREFIXES itself has a subdirectory-based entry
# (state/block-count-) — an unclassified file living under state/ would
# otherwise go unreported forever.
#
# Classification here is deliberately broader than the two reap whitelists
# it consults — recognizing a file is a different question from being
# allowed to delete it (nothing below touches STATE_PREFIXES or
# SESSION_ARTIFACT_PREFIXES, so no reap decision changes):
#   - a `.closed.bak` backup (e.g. `<prefix>*.json.closed.bak`, the backup
#     form STATE_PREFIXES's own `*.json` anchor above, :16-19, exists to
#     preserve from deletion) is never matched against STATE_PREFIXES here —
#     it falls through to the UUID-shaped-session-id check below and
#     SURFACES as drift. Neither reap function ever touches this family, so
#     the reporter is the only place its growth becomes visible; silently
#     recognizing it here as "belonging to its state family" (the pre-fix
#     behavior) would defeat that — see the plan's decision record naming
#     these four forms as reporter-only, never reap-whitelisted.
#   - `session-ledger-*.md` is recognized as a known-managed family even
#     though it is intentionally absent from SESSION_ARTIFACT_PREFIXES:
#     hooks/session-start.sh reaps it through its own dedicated ledger lane
#     (a `.md`-only glob, see that file), not through reap_session_artifacts,
#     so adding it to that whitelist would make this file's own reap
#     function delete it too. The exception is anchored to `.md` to match
#     that lane exactly — a non-`.md` session-ledger-* form (e.g. an
#     interrupted append's `.tmp`) is reaped by no lane and must surface as
#     drift, not go silently unclassified.
list_unclassified_session_files() {
  local dir="$1"
  local f base relpath prefix classified

  for f in "$dir"/* "$dir"/state/*; do
    [ -f "$f" ] || continue
    # ${f##*/} (pure Bash expansion, no fork) instead of `basename "$f"` — see
    # is_current_session's identical substitution above for the equivalence
    # argument (matches every shape this walk sees; diverges only on a
    # trailing-slash path, which a glob match against an actual file never is).
    base="${f##*/}"

    # relpath is what STATE_PREFIXES/SESSION_ARTIFACT_PREFIXES entries are
    # compared against: "state/<base>" for a file under the state/
    # subdirectory (matching the literal "state/block-count-" whitelist
    # entry verbatim), or plain <base> for a top-level file. One whitelist
    # classifies both namespaces this way, with no second copy of it.
    case "$f" in
      "$dir"/state/*) relpath="state/$base" ;;
      *) relpath="$base" ;;
    esac

    # STATE_PREFIXES comparison is against relpath directly, with no backup-
    # tail stripping — a `.closed.bak` file never ends in `.json`, so it
    # never satisfies `${prefix}*.json` and falls through to the
    # UUID-shaped-session-id check below, surfacing as drift. See the doc
    # comment above for why: it is reaped by no lane (the *.json anchor at
    # :16-19 exists to preserve it from deletion), so the reporter is the
    # only place this family's growth becomes visible.
    classified=0
    for prefix in $STATE_PREFIXES; do
      case "$relpath" in
        ${prefix}*.json) classified=1; break ;;
      esac
    done

    if [ "$classified" = "0" ]; then
      for prefix in $SESSION_ARTIFACT_PREFIXES; do
        case "$relpath" in
          ${prefix}*) classified=1; break ;;
        esac
      done
    fi

    if [ "$classified" = "0" ]; then
      case "$relpath" in
        session-ledger-*.md) classified=1 ;;
      esac
    fi

    if [ "$classified" = "1" ]; then
      continue
    fi

    # UUID-shaped session id, Bash 3.2 case-glob (no grep -P — the deploy
    # target's BSD grep has no PCRE support).
    case "$base" in
      *-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]*)
        echo "$f"
        ;;
    esac
  done
  return 0
}
