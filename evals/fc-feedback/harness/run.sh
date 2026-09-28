#!/usr/bin/env bash
# fc-feedback model-comparison harness — runs ONE repetition of ONE round for
# ONE model and leaves the run-dir behind for harness/score.ts to grade.
#
# Contract: plan §13.3, §14 (all subsections), §15 — precedence §15 > §14 > §13.
# Precedent: evals/explain-diff/harness/run.sh (inject skill body, substitute
# ${CLAUDE_SKILL_DIR} — plan §15-6 corrects the earlier §14.1 note: that
# harness points at the skill path, this one injects and substitutes the body
# itself) and evals/ultraresearch/harness/run.sh (bare `codex exec ... -C <dir>
# - < prompt` invocation shape).
#
# Usage:
#   run.sh [--dry-run] <round> <model-key: luna|sol> <rep> <workdir-fixture> [--no-skill]
#   run.sh [--dry-run] --cleanup <run-dir>
#
#   round            round number (0 = writing-skills RED baseline, pass --no-skill)
#   model-key        luna -> gpt-6-luna / model_reasoning_effort=max
#                    sol  -> gpt-6-sol  / model_reasoning_effort=medium
#   rep              repetition index within the round (2 per round per plan §14.4)
#   workdir-fixture  path to a pre-built fetch/transcribe/scan work dir (copied, never mutated)
#   --no-skill       omit the SKILL.md body from the prompt (round-0 baseline only)
#   --cleanup        delete a run-dir a previous run.sh call printed (score.ts
#                    calls this once it is done reading the run-dir)
#
# SKILL.md has not merged yet, so this script reads the SOURCE skill body at
# run time (never a deployed copy) and fails clearly if it is missing — except
# under --dry-run, which never touches SKILL.md at all.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$EVAL_DIR/../.." && pwd)"
SKILL_DIR="$REPO_ROOT/projects/fc-feedback/skills/fc-feedback"
FC_TS="$SKILL_DIR/scripts/fc.ts"
SKILL_MD="$SKILL_DIR/SKILL.md"
ROSTER="$EVAL_DIR/fixtures/roster.cef.yaml"
ARCHIVE_SEED="$EVAL_DIR/fixtures/archive-seed"
BASELINES_DIR="$EVAL_DIR/baselines"
PAGES_URL="https://fc-feedback-eval.invalid/"

# ── arg parsing (Bash 3.2: no associative arrays, indexed arrays only) ─────

dry_run=0
no_skill=0
cleanup_mode=0
positional=()

for arg in "$@"; do
	case "$arg" in
		--dry-run) dry_run=1 ;;
		--no-skill) no_skill=1 ;;
		--cleanup) cleanup_mode=1 ;;
		*) positional+=("$arg") ;;
	esac
done

trace() { echo "+ $*"; }

RUN_DIR_MARKER=".fc-eval-run-dir"

if [ "$cleanup_mode" = "1" ]; then
	target="${positional[0]:?run.sh --cleanup <run-dir>: run-dir required}"
	if [ "$dry_run" = "1" ]; then
		trace "test -f \"$target/$RUN_DIR_MARKER\" && rm -rf \"$target\""
		exit 0
	fi
	# Refuse anything that isn't a run-dir this script created — rm -rf on an
	# arbitrary caller-supplied path is a data-loss hazard otherwise.
	if [ ! -d "$target" ] || [ ! -f "$target/$RUN_DIR_MARKER" ]; then
		echo "run.sh: refusing --cleanup: $target is not a run-dir created by this script (missing $RUN_DIR_MARKER)" >&2
		exit 1
	fi
	trace "rm -rf \"$target\""
	rm -rf "$target"
	echo "cleaned up: $target"
	exit 0
fi

round="${positional[0]:?round required}"
model_key="${positional[1]:?model-key required: luna|sol}"
rep="${positional[2]:?rep required}"
workdir_fixture="${positional[3]:?workdir-fixture required}"

case "$model_key" in
	luna) model="gpt-6-luna"; effort="max" ;;
	sol) model="gpt-6-sol"; effort="medium" ;;
	*) echo "run.sh: unknown model-key '$model_key' (expected luna|sol)" >&2; exit 1 ;;
esac

if [ "$dry_run" != "1" ] && [ ! -d "$workdir_fixture" ]; then
	echo "run.sh: no such workdir-fixture: $workdir_fixture" >&2
	exit 1
fi

if [ "$no_skill" != "1" ] && [ "$dry_run" != "1" ] && [ ! -f "$SKILL_MD" ]; then
	echo "run.sh: SKILL.md not found at $SKILL_MD — build the skill (plan T13) first, or pass --no-skill for a round-0 baseline" >&2
	exit 1
fi

fixture_name="$(basename "$workdir_fixture")"
case "$fixture_name" in
	work-*) video_id="${fixture_name#work-}" ;;
	*) video_id="$fixture_name" ;;
esac
video_url="https://www.youtube.com/watch?v=${video_id}"

session_label="round${round}-${model_key}-rep${rep}"

# ── run-dir + OMT/work-dir + temp archive setup ─────────────────────────────
# fc.ts's default --work dir (the skill runs without --work under codex) is
# ${OMT_DIR}/fc-feedback/${OMT_SESSION_ID} (projects/fc-feedback/skills/fc-feedback/
# scripts/fc.ts resolveWorkDir). OMT_DIR/OMT_SESSION_ID must therefore be decided
# BEFORE the fixture is copied in, so the fixture (lines.json, candidates.json, …)
# lands exactly where fc.ts will look for it with no --work flag. The session
# label is also written to run_dir/.fc-eval-session (a single line) because
# score.ts runs later, in a separate process with none of this shell's exported
# env vars, and needs the same label to reconstruct work_dir.
# Real run: fresh mktemp run-dir, work_dir under it, fixture copied into
# work_dir, temp remote-less git archive (seeded from fixtures/archive-seed/
# when present, so the similarity step has a past session to compare against —
# plan §13.3).
# Dry run: placeholder paths only, nothing is created or touched.

if [ "$dry_run" = "1" ]; then
	run_dir="<run-dir>"
else
	run_dir="$(mktemp -d "${TMPDIR:-/tmp}/fc-feedback-eval.XXXXXX")"
fi

omt_dir="$run_dir/omt"
work_dir="$omt_dir/fc-feedback/$session_label"
archive_dir="$run_dir/archive"

trace "mktemp -d  # -> $run_dir"
trace "touch \"$run_dir/$RUN_DIR_MARKER\"  # --cleanup refuses any dir without this marker"
trace "mkdir -p \"$work_dir\"  # fc.ts default --work dir = \$OMT_DIR/fc-feedback/\$OMT_SESSION_ID"
trace "cp -R \"$workdir_fixture/.\" \"$work_dir/\""
trace "echo \"$session_label\" > \"$run_dir/.fc-eval-session\"  # score.ts's only way to find work_dir afterwards"
trace "mkdir -p \"$archive_dir\""
trace "cp -R \"$ARCHIVE_SEED/.\" \"$archive_dir/\"  # if $ARCHIVE_SEED exists"
trace "git -C \"$archive_dir\" init -q  # if $archive_dir/.git is missing"
trace "git -C \"$archive_dir\" remote remove <name>  # for every configured remote (none expected)"
trace "export OMT_DIR=\"$omt_dir\""
trace "export OMT_SESSION_ID=\"$session_label\""

if [ "$dry_run" != "1" ]; then
	mkdir -p "$run_dir"
	touch "$run_dir/$RUN_DIR_MARKER"
	mkdir -p "$work_dir"
	cp -R "$workdir_fixture/." "$work_dir/"
	echo "$session_label" > "$run_dir/.fc-eval-session"
	mkdir -p "$archive_dir"
	if [ -d "$ARCHIVE_SEED" ]; then
		cp -R "$ARCHIVE_SEED/." "$archive_dir/"
	fi
	if [ ! -d "$archive_dir/.git" ]; then
		git -C "$archive_dir" init -q
	fi
	for remote_name in $(git -C "$archive_dir" remote 2>/dev/null || true); do
		git -C "$archive_dir" remote remove "$remote_name"
	done
fi

export OMT_DIR="$omt_dir"
export OMT_SESSION_ID="$session_label"

# ── configure fc-feedback for this run-dir (configured mode, plan §15-3) ──
# fc.ts derives its manifest's projectKey from the CWD's git identity (or the
# CWD path itself when there is no git repo), so config set / config status /
# codex all run with the SAME cwd: run_dir.

config_set_cmd=(bun "$FC_TS" config set --archive "$archive_dir" --roster "$ROSTER" --pages-url "$PAGES_URL")
trace "cd \"$run_dir\" && ${config_set_cmd[*]}"

if [ "$dry_run" != "1" ]; then
	(cd "$run_dir" && "${config_set_cmd[@]}")
fi

# ── build the prompt: eval-preamble + (SKILL.md body, ${CLAUDE_SKILL_DIR}
# substituted) unless --no-skill + the task line naming the video ──────────

prompt_file="$run_dir/prompt.txt"
trace "build prompt -> $prompt_file (eval-preamble.md$([ "$no_skill" = "1" ] && echo "" || echo " + SKILL.md body") + task line for $video_url)"

if [ "$dry_run" != "1" ]; then
	{
		cat "$HARNESS_DIR/prompts/eval-preamble.md"
		echo
		if [ "$no_skill" != "1" ]; then
			echo "---"
			echo
			skill_body="$(cat "$SKILL_MD")"
			skill_body="${skill_body//\$\{CLAUDE_SKILL_DIR\}/$SKILL_DIR}"
			printf '%s\n' "$skill_body"
			echo
		fi
		echo "---"
		echo
		echo "대상 영상: $video_url"
		echo "이 영상에 대한 fc-feedback 작업 폴더가 현재 디렉터리에 이미 준비되어 있다(fetch/"
		echo "transcribe/scan은 끝났다 — 그 결과를 그대로 쓰고 plan 단계부터 이어서 진행해줘)."
		echo "config는 이미 configured 모드로 맞춰져 있다(\`fc config status\`로 확인할 수 있다)."
	} > "$prompt_file"
fi

# ── run codex exec (plan §15-1) ─────────────────────────────────────────────

run_jsonl="$run_dir/run.jsonl"
codex_cmd=(codex exec --skip-git-repo-check -m "$model" -c "model_reasoning_effort=$effort" --dangerously-bypass-approvals-and-sandbox --json -C "$run_dir" -)
trace "${codex_cmd[*]} < $prompt_file > $run_jsonl"

codex_status=0
if [ "$dry_run" != "1" ]; then
	set +e
	"${codex_cmd[@]}" < "$prompt_file" > "$run_jsonl"
	codex_status=$?
	set -e
fi

# ── preserve artifacts (plan §14.7 + §15-4 + §15-5) ─────────────────────────

dest="$BASELINES_DIR/round-$round/$model_key/rep$rep"
trace "mkdir -p \"$dest\""

work_artifacts="plan.json plan.validated.json notes.json similar-choices.json similar-candidates.json refs-draft.json refs.verified.json lines.json"
for name in $work_artifacts; do
	trace "cp \"$work_dir/$name\" \"$dest/$name\"  # if present"
done
trace "cp \"$archive_dir/taxonomy.yaml\" \"$dest/taxonomy.yaml\"  # if present"
trace "cp \"$archive_dir/sessions/<session_id>/data.json\" \"$dest/data.json\"  # if present"
trace "gzip -c \"$run_jsonl\" > \"$dest/run.jsonl.gz\""

if [ "$dry_run" != "1" ]; then
	mkdir -p "$dest"
	for name in $work_artifacts; do
		if [ -f "$work_dir/$name" ]; then
			cp "$work_dir/$name" "$dest/$name"
		fi
	done
	if [ -f "$archive_dir/taxonomy.yaml" ]; then
		cp "$archive_dir/taxonomy.yaml" "$dest/taxonomy.yaml"
	fi
	session_id="$(jq -r '.session_id // empty' "$work_dir/session.json" 2>/dev/null || true)"
	if [ -n "$session_id" ] && [ -f "$archive_dir/sessions/$session_id/data.json" ]; then
		cp "$archive_dir/sessions/$session_id/data.json" "$dest/data.json"
	fi
	if [ -f "$run_jsonl" ]; then
		gzip -c "$run_jsonl" > "$dest/run.jsonl.gz"
	fi
fi

# ── delete this run's ~/.fc-feedback/<projectKey> manifest dir (plan §15-3) ─
# Asking fc.ts for its own manifestPath avoids re-deriving the projectKey hash
# algorithm here — the state dir to delete is just that path's parent. Guarded
# hard: `jq -r '.manifestPath'` prints the literal string "null" when the
# field is absent, and `dirname null` is ".", which would rm -rf the cwd — so
# this only deletes a path that is non-empty, not "null", named exactly
# manifest.yaml, and sitting under (but not equal to) "$HOME/.fc-feedback/".
# Anything else is left alone and reported to stderr instead.

trace "manifest_path=\$(cd \"$run_dir\" && bun \"$FC_TS\" config status | jq -r '.manifestPath // empty')"
trace "rm -rf \"<manifest_dir>\"  # only when manifest_path is non-empty, named manifest.yaml, and under \$HOME/.fc-feedback/*"

if [ "$dry_run" != "1" ]; then
	manifest_path="$(cd "$run_dir" && bun "$FC_TS" config status | jq -r '.manifestPath // empty')"
	if [ -z "$manifest_path" ] || [ "$manifest_path" = "null" ]; then
		echo "run.sh: fc.ts config status returned no manifestPath; skipping ~/.fc-feedback cleanup" >&2
	elif [ "$(basename "$manifest_path")" != "manifest.yaml" ]; then
		echo "run.sh: refusing to delete unexpected manifest path: $manifest_path" >&2
	else
		manifest_dir="$(dirname "$manifest_path")"
		if [ "$manifest_dir" = "$HOME/.fc-feedback" ]; then
			echo "run.sh: refusing to delete $manifest_dir (would delete the whole ~/.fc-feedback root)" >&2
		else
			case "$manifest_dir" in
				"$HOME/.fc-feedback/"*) rm -rf "$manifest_dir" ;;
				*) echo "run.sh: refusing to delete manifest dir outside \$HOME/.fc-feedback/: $manifest_dir" >&2 ;;
			esac
		fi
	fi
fi

# run.sh does NOT delete run_dir itself — score.ts reads plan.json/notes.json/
# etc. straight out of it, then calls `run.sh --cleanup <run-dir>` when done.
echo "$run_dir"

if [ "$dry_run" != "1" ]; then
	exit "$codex_status"
fi
