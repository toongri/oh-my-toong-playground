#!/bin/bash
# =============================================================================
# oh-my-toong OMT_DIR Computation Library
# Shared function for deriving OMT_DIR from a project root path.
# Compatible with macOS Bash 3.2.
# =============================================================================

# compute_omt_dir <project-root>
#
# Sets OMT_DIR to "$HOME/.omt/<project-name>" and creates the directory.
# If OMT_DIR is already set, returns immediately (no-op).
#
# Project name derivation (matches session-start.sh canonical logic):
#   - Worktree: basename of the main repo directory (from --git-common-dir)
#   - Standard repo: basename of --show-toplevel
#   - No git: basename of <project-root>
#
# Arguments:
#   $1  absolute path to the project root
compute_omt_dir() {
  if [ -n "${OMT_DIR:-}" ]; then
    return 0
  fi

  local _omt_root="$1"
  local _omt_git_common
  _omt_git_common=$(git -C "$_omt_root" rev-parse --git-common-dir 2>/dev/null) || _omt_git_common=""

  local _omt_name=""
  if [ -n "$_omt_git_common" ] && [ "$_omt_git_common" != ".git" ]; then
    # Worktree: --git-common-dir may return absolute or relative path
    # Resolve relative path against _omt_root using cd && pwd (Bash 3.2 compatible)
    case "$_omt_git_common" in
      /*)
        # Already absolute
        _omt_name=$(basename "$(dirname "$_omt_git_common")")
        ;;
      *)
        # Relative: resolve against _omt_root
        _omt_name=$(basename "$(dirname "$(cd "$_omt_root/$_omt_git_common" && pwd)")")
        ;;
    esac
  elif [ "$_omt_git_common" = ".git" ]; then
    # Standard repo: use the actual toplevel directory name
    _omt_name=$(basename "$(git -C "$_omt_root" rev-parse --show-toplevel 2>/dev/null)") || _omt_name=""
  else
    # No git: fall back to the project root basename (non-canonical)
    _omt_name=$(basename "$_omt_root")
    echo "omt-dir: non-canonical project '$_omt_name' from non-git path $_omt_root" >&2
  fi

  # Final fallback if name is still empty
  if [ -z "$_omt_name" ]; then
    _omt_name=$(basename "$_omt_root")
  fi

  # Sanitize: replace spaces with hyphens
  OMT_DIR="$HOME/.omt/${_omt_name// /-}"
  mkdir -p "$OMT_DIR"
}

# resolve_omt_dir <cwd>
#
# Resolves OMT_DIR from a cwd by locating the project root, then delegating
# to compute_omt_dir. Echoes the resolved OMT_DIR to stdout; always non-empty
# for a non-empty cwd (non-git paths fall back to $HOME/.omt/<basename> with a
# "non-canonical" warning on stderr). Intended as a single-shot entry point for
# non-shell callers via child_process.
#
# Project root rules (mirrors session-start.sh / keyword-detector.sh):
#   - Strip trailing /.omt and /.claude
#   - Walk upward looking for .git, CLAUDE.md, or package.json
#   - Fallback to the (stripped) cwd
resolve_omt_dir() {
  local _r_cwd="${1:-$PWD}"
  local _r_dir="$_r_cwd"
  _r_dir="${_r_dir%/.omt}"
  _r_dir="${_r_dir%/.claude}"

  local _r_root=""
  while [ "$_r_dir" != "/" ] && [ "$_r_dir" != "." ] && [ -n "$_r_dir" ]; do
    # $HOME boundary: do not use $HOME itself as a project root (HOME/CLAUDE.md is user-global)
    if [ "$_r_dir" = "$HOME" ]; then
      break
    fi
    # Bare repo dir: has HEAD + config + objects but no .git subdir/file — valid project root
    if [ -f "$_r_dir/HEAD" ] && [ -f "$_r_dir/config" ] && [ -d "$_r_dir/objects" ] && [ ! -e "$_r_dir/.git" ]; then
      _r_root="$_r_dir"
      break
    fi
    if [ -d "$_r_dir/.git" ] || [ -f "$_r_dir/CLAUDE.md" ] || [ -f "$_r_dir/package.json" ]; then
      _r_root="$_r_dir"
      break
    fi
    _r_dir=$(dirname "$_r_dir")
  done
  if [ -z "$_r_root" ]; then
    _r_root="${_r_cwd%/.omt}"
    _r_root="${_r_root%/.claude}"
  fi

  compute_omt_dir "$_r_root"
  printf '%s' "${OMT_DIR:-}"
}
