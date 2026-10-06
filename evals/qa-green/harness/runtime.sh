#!/usr/bin/env bash
# Builds an isolated runtime for one commit, so a qa skill under test never
# replaces the global ~/.agents or ~/.codex copies, and a newer build never
# changes files under a run that is still going.
#
#   runtime.sh <commit>
#
# ~/.omt/qa-green/rt/<sha>/src         the commit's source tree (git archive) with
#                                      its node_modules; hooks and scripts run from
#                                      source, ${CLAUDE_SKILL_DIR} in the qa docs
#                                      baked to an absolute path as sync bakes it.
# ~/.omt/qa-green/rt/<sha>/codex-home  a CODEX_HOME whose hooks.json points every
#                                      OMT hook at that source. auth.json and the
#                                      other shared entries are symlinks, so a
#                                      token refresh stays in the one real file.
#                                      The global qa skill is disabled there.
# ~/.omt/qa-green/current              symlink to the runtime new runs use.
set -euo pipefail

commit="${1:?usage: runtime.sh <commit>}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
sha="$(git -C "$repo" rev-parse --short=12 "$commit")"
root="$HOME/.omt/qa-green/rt/$sha"
runtime="$root/src"
codex_home="$root/codex-home"
mkdir -p "$runtime" "$codex_home"

git -C "$repo" archive "$sha" | tar -x -C "$runtime"
echo "$sha" >"$runtime/.omt-commit"
(cd "$runtime" && bun install --frozen-lockfile >/dev/null)
find "$runtime/skills/qa" -name '*.md' -exec sed -i '' "s#\${CLAUDE_SKILL_DIR}#$runtime/skills/qa#g" {} +

for entry in auth.json AGENTS.md agents rules skills plugins scripts lib; do
	if [ -e "$HOME/.codex/$entry" ]; then ln -sfn "$HOME/.codex/$entry" "$codex_home/$entry"; fi
done
cp "$HOME/.codex/config.toml" "$codex_home/config.toml"
printf '\n[[skills.config]]\npath = "%s"\nenabled = false\n' "$HOME/.agents/skills/qa/SKILL.md" >>"$codex_home/config.toml"
sed "s#$HOME/.codex/hooks/#$runtime/hooks/#g" "$HOME/.codex/hooks.json" >"$codex_home/hooks.json"

ln -sfn "$root" "$HOME/.omt/qa-green/current"
echo "runtime $sha ready"
