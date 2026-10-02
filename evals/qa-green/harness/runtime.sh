#!/usr/bin/env bash
# Builds the isolated runtime the GREEN runs use, so a qa skill under test never
# replaces the global ~/.agents or ~/.codex copies.
#
#   runtime.sh <commit>
#
# - ~/.omt/qa-green/runtime     the commit's source tree (git archive) with its
#                               node_modules; hooks and scripts run from source,
#                               ${CLAUDE_SKILL_DIR} in the qa docs baked to an
#                               absolute path the way sync bakes it.
# - ~/.omt/qa-green/codex-home  a CODEX_HOME whose hooks.json points every OMT
#                               hook at the runtime. auth.json and the other
#                               shared entries are symlinks, so a token refresh
#                               stays in the one real file. The global qa skill
#                               is disabled there; run.sh links the runtime's
#                               qa into each eval worktree as a project skill.
#
# Re-running with a newer commit overwrites the runtime in place; files the new
# commit deleted stay behind.
set -euo pipefail

commit="${1:?usage: runtime.sh <commit>}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
runtime="$HOME/.omt/qa-green/runtime"
codex_home="$HOME/.omt/qa-green/codex-home"
mkdir -p "$runtime" "$codex_home"

git -C "$repo" archive "$commit" | tar -x -C "$runtime"
git -C "$repo" rev-parse "$commit" >"$runtime/.omt-commit"
(cd "$runtime" && bun install --frozen-lockfile >/dev/null)
find "$runtime/skills/qa" -name '*.md' -exec sed -i '' "s#\${CLAUDE_SKILL_DIR}#$runtime/skills/qa#g" {} +

for entry in auth.json AGENTS.md agents rules skills plugins scripts lib; do
	if [ -e "$HOME/.codex/$entry" ]; then ln -sfn "$HOME/.codex/$entry" "$codex_home/$entry"; fi
done
cp "$HOME/.codex/config.toml" "$codex_home/config.toml"
printf '\n[[skills.config]]\npath = "%s"\nenabled = false\n' "$HOME/.agents/skills/qa/SKILL.md" >>"$codex_home/config.toml"
sed "s#$HOME/.codex/hooks/#$runtime/hooks/#g" "$HOME/.codex/hooks.json" >"$codex_home/hooks.json"

echo "runtime $(cat "$runtime/.omt-commit") ready"
