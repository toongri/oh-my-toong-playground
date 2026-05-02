#!/usr/bin/env bash
# resolve-flow-dir.sh
#
# Resolves the Maestro flow directory for the current project per the
# using-maestro skill's flow-location-config protocol.
#
# Output:
#   stdout: resolved flow_dir path on success (exit 0)
#           - When read from config.yaml: normalized to absolute, mkdir -p applied
#           - When MAESTRO_USING_FLOW_DIR env is set: passed through verbatim (no
#             normalization, no mkdir) — caller is responsible for path semantics
#   stderr: "REGISTER_REQUIRED:<id>:<project_root>" if config missing (exit 2)
#           "REGISTER_REQUIRED:<id>:<project_root>:COLLISION" if config belongs to
#             a different repo with the same project_id (exit 2)
#           error message on other failures (exit 1)
#
# macOS bash 3.2 compatible. No external deps beyond git, sed, grep, awk.
#
# get_yaml_value parser constraints:
#   - Top-level scalar keys only (no nesting, no flow scalars, no multi-line strings).
#   - Quoted values: '#' inside quotes is preserved; anything after the closing quote
#     is treated as inline comment.
#   - Unquoted values: '#' is stripped only when preceded by whitespace, so paths
#     like '/tmp/team#5' survive. Escaped double quotes (\") inside strings are NOT
#     supported — keep config values free of escape sequences.

set -euo pipefail

# 1. Env var override (CI escape hatch)
if [ -n "${MAESTRO_USING_FLOW_DIR:-}" ]; then
  printf '%s\n' "$MAESTRO_USING_FLOW_DIR"
  exit 0
fi

# 2. Find project root (git toplevel, fallback to $PWD)
project_root=""
if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
  project_root="$git_root"
else
  project_root="$PWD"
fi

# 3. Derive project ID from git remote, fallback to basename
project_id=""
if remote_url=$(git -C "$project_root" remote get-url origin 2>/dev/null); then
  # Strip everything before the last '/' or ':', then strip trailing '.git'
  project_id=$(printf '%s' "$remote_url" | sed -E 's#^.*[/:]##; s#\.git$##')
fi
if [ -z "$project_id" ]; then
  project_id=$(basename "$project_root")
fi

# Sanity-check ID slug (alphanumerics, hyphen, underscore, dot)
# Invalid/empty slugs route through REGISTER_REQUIRED so the caller dispatches
# the slug-override interview using the same flow as missing/colliding configs.
case "$project_id" in
  *[!A-Za-z0-9._-]*)
    printf 'REGISTER_REQUIRED:%s:%s:INVALID_SLUG\n' "$project_id" "$project_root" >&2
    exit 2
    ;;
  '')
    printf 'REGISTER_REQUIRED::%s:INVALID_SLUG\n' "$project_root" >&2
    exit 2
    ;;
esac

# Helper: parse a flat YAML value (bash 3.2 compatible, no yq dependency)
get_yaml_value() {
  local key="$1"
  local file="$2"
  local raw
  raw=$({ grep -E "^${key}:[[:space:]]" "$file" 2>/dev/null || true; } | head -1 \
    | sed -E "s/^${key}:[[:space:]]*//")
  # If value is quoted, extract content between quotes (preserving '#' inside)
  # and treat anything after the closing quote as an inline comment.
  # Unterminated quotes (no closing quote) are a hard parse error: emit to
  # stderr and return 1 so callers in set -euo pipefail context exit with 1.
  # If unquoted, strip inline comments and trailing whitespace as before.
  case "$raw" in
    '"'*)
      if ! printf '%s' "$raw" | grep -qE '^"[^"]*"'; then
        printf 'ERROR: get_yaml_value: unterminated double-quoted value for key %s in %s\n' "$key" "$file" >&2
        return 1
      fi
      printf '%s' "$raw" | sed -E 's/^"([^"]*)".*$/\1/'
      ;;
    "'"*)
      if ! printf '%s' "$raw" | grep -qE "^'[^']*'"; then
        printf 'ERROR: get_yaml_value: unterminated single-quoted value for key %s in %s\n' "$key" "$file" >&2
        return 1
      fi
      printf '%s' "$raw" | sed -E "s/^'([^']*)'.*\$/\1/"
      ;;
    *)
      printf '%s' "$raw" \
        | sed -E 's/(^|[[:space:]]+)#.*$//' \
        | sed -E 's/[[:space:]]+$//'
      ;;
  esac
}

# Helper: normalize a git remote URL for collision comparison.
# Strips trailing .git suffix, then converts SSH forms (both ssh://git@host/path
# and SCP-style git@host:path) to HTTPS form.
# bash 3.2 compatible — uses sed -E only.
normalize_remote() {
  local url="$1"
  url=$(printf '%s' "$url" \
    | sed -E -e 's/\.git$//' \
             -e 's|^ssh://git@([^/]+)/(.+)$|https://\1/\2|' \
             -e 's|^git@([^:]+):(.+)$|https://\1/\2|')
  printf '%s' "$url"
}

# 4. Look up config
config_dir="$HOME/.config/maestro/$project_id"
config_file="$config_dir/config.yaml"

if [ ! -f "$config_file" ]; then
  printf 'REGISTER_REQUIRED:%s:%s\n' "$project_id" "$project_root" >&2
  exit 2
fi

# 4a. Collision detection — verify config belongs to current repo.
# Compare git_remote (preferred) or project_root fallback from config vs current state.
# On mismatch, signal REGISTER_REQUIRED:<id>:<root>:COLLISION so caller can dispatch a slug-override interview.
config_git_remote=$(get_yaml_value "git_remote" "$config_file")
config_project_root=$(get_yaml_value "project_root" "$config_file")

# Compute current git remote for comparison
current_git_remote=""
if remote_url=$(git -C "$project_root" remote get-url origin 2>/dev/null); then
  current_git_remote="$remote_url"
fi

# Mismatch rules:
#   - If config has git_remote AND current has git_remote → both must match (after normalization)
#   - If config has git_remote AND current has none → mismatch
#   - If config has no git_remote → fall back to project_root comparison
collision=0
if [ -n "$config_git_remote" ]; then
  norm_config=$(normalize_remote "$config_git_remote")
  norm_current=$(normalize_remote "$current_git_remote")
  if [ -z "$current_git_remote" ] || [ "$norm_config" != "$norm_current" ]; then
    collision=1
  fi
elif [ -n "$config_project_root" ] && [ "$config_project_root" != "$project_root" ]; then
  collision=1
fi

if [ "$collision" = "1" ]; then
  printf 'REGISTER_REQUIRED:%s:%s:COLLISION\n' "$project_id" "$project_root" >&2
  exit 2
fi

# 5. Read flow_dir from config
flow_dir=$(get_yaml_value "flow_dir" "$config_file")

if [ -z "$flow_dir" ]; then
  printf 'ERROR: flow_dir missing or empty in %s\n' "$config_file" >&2
  exit 1
fi

# 6. Resolve path (absolute / ~ / relative)
case "$flow_dir" in
  /*)
    resolved="$flow_dir"
    ;;
  '~'/*)
    resolved="$HOME${flow_dir#\~}"
    ;;
  '~')
    resolved="$HOME"
    ;;
  *)
    resolved="$project_root/$flow_dir"
    ;;
esac

# 7. Ensure directory exists
mkdir -p "$resolved"

printf '%s\n' "$resolved"
exit 0
