#!/usr/bin/env bash
# resolve-flow-dir.sh
#
# Resolves the Maestro flow directory for the current project per the
# using-maestro skill's flow-location-config protocol.
#
# Output:
#   stdout: absolute flow_dir path (exit 0)
#   stderr: "REGISTER_REQUIRED:<id>:<project_root>" if config missing (exit 2)
#           error message on other failures (exit 1)
#
# macOS bash 3.2 compatible. No external deps beyond git, sed, grep, awk.

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
case "$project_id" in
  *[!A-Za-z0-9._-]*)
    printf 'ERROR: derived project_id %q contains unsupported characters\n' "$project_id" >&2
    exit 1
    ;;
  '')
    printf 'ERROR: empty project_id\n' >&2
    exit 1
    ;;
esac

# 4. Look up config
config_dir="$HOME/.config/maestro/$project_id"
config_file="$config_dir/config.yaml"

if [ ! -f "$config_file" ]; then
  printf 'REGISTER_REQUIRED:%s:%s\n' "$project_id" "$project_root" >&2
  exit 2
fi

# 5. Parse flow_dir from flat YAML (bash 3.2 compatible, no yq dependency)
get_yaml_value() {
  local key="$1"
  local file="$2"
  { grep -E "^${key}:[[:space:]]" "$file" 2>/dev/null || true; } | head -1 \
    | sed -E "s/^${key}:[[:space:]]*//" \
    | sed -E 's/^"(.*)"$/\1/' \
    | sed -E "s/^'(.*)'\$/\1/" \
    | sed -E 's/[[:space:]]*#.*$//' \
    | sed -E 's/[[:space:]]+$//'
}

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
