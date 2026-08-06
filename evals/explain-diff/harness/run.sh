#!/usr/bin/env bash
# explain-diff eval runner.
#
#   run.sh <arm> <control> <fixture> [<platform>]
#
#   arm       red | green      -- which output tree to write into
#   control   naive | gist     -- which prompt body to prepend (red only)
#   fixture   id from fixtures/manifest.json
#   platform  claude | codex   -- default claude
#
# Every arm writes to $EVAL/<arm>/<platform>/<control>/<fixture>/, which sits OUTSIDE
# $OMT_DIR/explain-diff/ so the skill's artifact guard (directory-boundary match) never
# sees these runs.
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Worktrees and transcripts live outside the repo; override to point elsewhere.
EVAL="${OMT_EVAL_ROOT:-$HOME/.omt/oh-my-toong-playground/explain-diff-eval}"

arm="${1:?arm required: red|green}"
control="${2:?control required: naive|gist}"
fixture="${3:?fixture required}"
platform="${4:-claude}"

wt="$EVAL/fixtures/$fixture"
[ -d "$wt" ] || { echo "no such fixture worktree: $wt" >&2; exit 1; }

range="$(bun -e '
  const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const f = m.fixtures.find((x) => x.id === process.argv[2]);
  if (!f) { process.exit(1); }
  process.stdout.write(f.range);
' "$HARNESS/manifest.json" "$fixture")"

outdir="$EVAL/$arm/$platform/$control/$fixture"
mkdir -p "$outdir"

body="$HARNESS/prompts/$control.md"
[ -f "$body" ] || { echo "no such prompt: $body" >&2; exit 1; }

prompt="$(cat "$body")

---

대상 변경: 현재 작업 디렉터리의 git range \`$range\`
결과물 저장 위치: \`$outdir/\` 아래에 저장해줘. 파일 이름과 형식은 네가 정하면 된다."

log="$outdir/run.log"
: > "$log"

case "$platform" in
  claude)
    cd "$wt"
    CLAUDECODE="" CLAUDE_CODE_EFFORT_LEVEL=high \
      claude -p "$prompt" \
        --permission-mode bypassPermissions \
        --add-dir "$outdir" \
        >>"$log" 2>&1
    ;;
  codex)
    codex exec \
      -C "$wt" \
      -c model_reasoning_effort=high \
      -s workspace-write \
      -c "sandbox_workspace_write.writable_roots=[\"$EVAL\"]" \
      "$prompt" \
      >>"$log" 2>&1 < /dev/null
    ;;
  *) echo "unknown platform: $platform" >&2; exit 1 ;;
esac

echo "done: $outdir"
ls -la "$outdir"
