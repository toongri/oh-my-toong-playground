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
    # No git: fall back to the project root basename
    _omt_name=$(basename "$_omt_root")
  fi

  # Final fallback if name is still empty
  if [ -z "$_omt_name" ]; then
    _omt_name=$(basename "$_omt_root")
  fi

  # Sanitize: replace spaces with hyphens
  OMT_DIR="$HOME/.omt/${_omt_name// /-}"
  mkdir -p "$OMT_DIR"
}
