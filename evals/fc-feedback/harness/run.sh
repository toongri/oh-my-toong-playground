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
# Isolation. Every real (non-dry-run) invocation runs codex with cwd=<run-dir>
# and treats <run-dir> as everything the agent needs:
#   - the skill body it reads is materialized into <run-dir>/.agents/skills/
#     (see materialize-skill.ts) instead of the source repo, and
#     ${CLAUDE_SKILL_DIR} substitutes to that materialized path, never a repo
#     path;
#   - the manifest fc.ts reads/writes lives under <run-dir>/fc-manifests
#     (FC_FEEDBACK_MANIFEST_ROOT), never the real $HOME/.fc-feedback;
#   - prompt.txt is asserted, after it is built, to contain no repo-root path,
#     no "evals/fc-feedback", and no "plan §" text;
#   - a codex custom permission profile denies reads of every worktree of this
#     repo (not just this one), the real $HOME/.omt, the real
#     $HOME/.fc-feedback, $HOME/.claude, $HOME/.pins, and codex's own
#     transcript/history paths under $HOME/.codex (OS-level seatbelt
#     enforcement — see the sandbox-isolation block below), verified by a
#     mandatory pre-run smoke that aborts the run on failure. Pass
#     --no-sandbox-isolation to fall back to
#     --dangerously-bypass-approvals-and-sandbox (no OS-level enforcement).
#   - parallel same-round runs still see each other's sibling run-dirs at the
#     OS level (the permission profile can't glob-deny "every OTHER
#     fc-feedback-eval.* dir"); score.ts's existing contamination detection
#     (otherRunDirTargets) already flags any command that touches a sibling
#     run-dir, so this is a scoring-time catch, not an OS-level prevention.
#
# Usage:
#   run.sh [--dry-run] <round> <model-key: luna|sol> <rep> <workdir-fixture> [--no-skill] [--no-sandbox-isolation]
#   run.sh [--dry-run] --cleanup <run-dir>
#
#   round                   round number (0 = writing-skills RED baseline, pass --no-skill)
#   model-key               luna -> gpt-6-luna / model_reasoning_effort=max
#                           sol  -> gpt-6-sol  / model_reasoning_effort=medium
#   rep                     repetition index within the round (2 per round per plan §14.4)
#   workdir-fixture         path to a pre-built fetch/transcribe/scan work dir (copied, never mutated)
#   --no-skill              omit the SKILL.md body from the prompt (round-0 baseline only);
#                           the skill is also NOT materialized into the run-dir for round 0
#   --no-sandbox-isolation  skip the codex permission-profile isolation (and its pre-run
#                           smoke), falling back to --dangerously-bypass-approvals-and-sandbox
#   --cleanup               delete a run-dir a previous run.sh call printed (score.ts
#                           calls this once it is done reading the run-dir)
#
# SKILL.md has not merged yet, so this script reads the SOURCE skill body at
# run time (never a deployed copy) and fails clearly if it is missing — except
# under --dry-run, which never touches SKILL.md at all. The skill body itself
# is read from source, but everything ${CLAUDE_SKILL_DIR} in that body points
# at is the materialized run-dir copy (see materialize-skill.ts), never the
# source repo.
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$EVAL_DIR/../.." && pwd)"
SKILL_DIR="$REPO_ROOT/projects/fc-feedback/skills/fc-feedback"
FC_TS="$SKILL_DIR/scripts/fc.ts"
SKILL_MD="$SKILL_DIR/SKILL.md"
MATERIALIZE_TS="$HARNESS_DIR/materialize-skill.ts"
SKILL_NAME="fc-feedback"
ROSTER="$EVAL_DIR/fixtures/roster.cef.yaml"
ARCHIVE_SEED="$EVAL_DIR/fixtures/archive-seed"
BASELINES_DIR="$EVAL_DIR/baselines"
PAGES_URL="https://fc-feedback-eval.invalid/"
REAL_OMT_DIR="$HOME/.omt"
REAL_FC_FEEDBACK_HOME="$HOME/.fc-feedback"
REAL_CLAUDE_DIR="$HOME/.claude"
REAL_PINS_DIR="$HOME/.pins"
PERM_PROFILE="fc-eval-isolate"

# This repo is checked out as a git worktree sharing one bare repo with other
# worktrees (`git worktree list`) under a common parent directory — every
# sibling worktree (main, other feature worktrees) can itself contain
# evals/fc-feedback, plans, DESIGN.md, etc., so the deny list below denies
# that WHOLE parent, not just this worktree's own root. Resolved via
# `--git-common-dir` (never hardcoded) so it tracks wherever this worktree
# actually lives: for the standard bare-repo-plus-worktrees layout that
# resolves to `<bare-repo>/..` — e.g. `.bare`'s parent — one level up from the
# git-common-dir itself. Falls back to this worktree's own root if git-common-dir
# can't be resolved (e.g. not a worktree checkout).
worktrees_parent_dir() {
	local common_dir
	common_dir="$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
	if [ -z "$common_dir" ]; then
		echo "$REPO_ROOT"
		return
	fi
	case "$common_dir" in
		/*) : ;;
		*) common_dir="$REPO_ROOT/$common_dir" ;;
	esac
	if common_dir="$(cd "$common_dir" 2>/dev/null && pwd)"; then
		dirname "$common_dir"
	else
		echo "$REPO_ROOT"
	fi
}
WORKTREES_PARENT="$(worktrees_parent_dir)"

# ── arg parsing (Bash 3.2: no associative arrays, indexed arrays only) ─────

dry_run=0
no_skill=0
cleanup_mode=0
isolate_reads=1
positional=()

for arg in "$@"; do
	case "$arg" in
		--dry-run) dry_run=1 ;;
		--no-skill) no_skill=1 ;;
		--no-sandbox-isolation) isolate_reads=0 ;;
		--cleanup) cleanup_mode=1 ;;
		*) positional+=("$arg") ;;
	esac
done

trace() { echo "+ $*"; }

# codex custom permission profile (extends the built-in `:workspace` profile —
# same read-everywhere/write-in-cwd/no-network baseline as `codex exec -s
# workspace-write`) that additionally denies reads (and writes) of: every
# worktree of this repo (the common parent dir, not just this one — see
# worktrees_parent_dir above), the real $HOME/.omt, the real
# $HOME/.fc-feedback, $HOME/.claude (Claude Code project transcripts),
# $HOME/.pins, and the codex transcript/history paths under $HOME/.codex that
# could otherwise leak prior eval runs or this orchestrating session (the
# profile keeps $HOME/.codex/auth.json and its own runtime state — e.g. queue/
# memory/goal sqlite files — readable, since codex needs those for the run
# itself; see the "격리" section of README.md for the scoping rationale). It
# also turns network on (`:workspace`'s network defaults to Restricted).
# Verified empirically against codex-cli 0.157.1's `codex sandbox` debug
# runner — see the "격리" section of README.md for the evidence transcript.
# `-c permissions.<name>=<inline TOML table>` and `-c
# default_permissions=<name>` are both plain ConfigToml overrides
# (config/src/config_toml.rs), so the same two flags apply to `codex sandbox`
# (used by the smoke check below) and `codex exec` (the real run) alike —
# `codex exec` has no `-P` flag of its own.
deny_paths=(
	"$WORKTREES_PARENT"
	"$REAL_OMT_DIR"
	"$REAL_FC_FEEDBACK_HOME"
	"$REAL_CLAUDE_DIR"
	"$REAL_PINS_DIR"
	"$HOME/.codex/sessions"
	"$HOME/.codex/archived_sessions"
	"$HOME/.codex/history.jsonl"
	"$HOME/.codex/session_index.jsonl"
	"$HOME/.codex/rollout-migrations"
	"$HOME/.codex/shell_snapshots"
	"$HOME/.codex/transcription-history.jsonl"
	"$HOME/.codex/dictation-history"
)
deny_fs_entries=""
for deny_path in "${deny_paths[@]}"; do
	if [ -n "$deny_fs_entries" ]; then
		deny_fs_entries="${deny_fs_entries},"
	fi
	deny_fs_entries="${deny_fs_entries}\"${deny_path}\"=\"deny\""
done
PERM_PROFILE_OVERRIDE="permissions.${PERM_PROFILE}={extends=\":workspace\",network={enabled=true},filesystem={${deny_fs_entries}}}"

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

# Committed work-dir fixtures never hold audio/video — session.json's
# files.audio/video/wav stay relative ("media/audio/<id>.webm", …, already
# written that way by fc.ts fetch/transcribe) and this cache dir supplies the
# "media/" subtree fc.ts still opens directly during later steps (e.g.
# cmdFrames re-reads video.files.video with ffmpeg — plan step 2/§15-2).
media_cache_dir="${FC_EVAL_MEDIA_DIR:-$HOME/.cache/fc-feedback-eval}/$video_id"

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
run_dir_roster="$run_dir/roster.cef.yaml"
manifest_root="$run_dir/fc-manifests"

trace "mktemp -d  # -> $run_dir"
trace "touch \"$run_dir/$RUN_DIR_MARKER\"  # --cleanup refuses any dir without this marker"
trace "mkdir -p \"$work_dir\"  # fc.ts default --work dir = \$OMT_DIR/fc-feedback/\$OMT_SESSION_ID"
trace "cp -R \"$workdir_fixture/.\" \"$work_dir/\""
trace "ln -s \"$media_cache_dir\" \"$work_dir/media\"  # not committed; see FC_EVAL_MEDIA_DIR in fixtures README"
trace "echo \"$session_label\" > \"$run_dir/.fc-eval-session\"  # score.ts's only way to find work_dir afterwards"
trace "mkdir -p \"$archive_dir\""
trace "cp -R \"$ARCHIVE_SEED/.\" \"$archive_dir/\"  # if $ARCHIVE_SEED exists"
trace "git -C \"$archive_dir\" init -q  # if $archive_dir/.git is missing"
trace "git -C \"$archive_dir\" remote remove <name>  # for every configured remote (none expected)"
trace "cp \"$ROSTER\" \"$run_dir_roster\"  # run-dir-local copy: config set's --roster value must never be a repo path"
trace "export OMT_DIR=\"$omt_dir\""
trace "export OMT_SESSION_ID=\"$session_label\""
trace "export FC_FEEDBACK_MANIFEST_ROOT=\"$manifest_root\"  # replaces \$HOME/.fc-feedback entirely; manifests live and die with the run-dir"

if [ "$dry_run" != "1" ]; then
	mkdir -p "$run_dir"
	touch "$run_dir/$RUN_DIR_MARKER"
	mkdir -p "$work_dir"
	cp -R "$workdir_fixture/." "$work_dir/"
	if [ ! -d "$media_cache_dir" ]; then
		echo "run.sh: media cache dir missing for $video_id: $media_cache_dir (set FC_EVAL_MEDIA_DIR, or populate \$HOME/.cache/fc-feedback-eval/$video_id -- see evals/fc-feedback/README.md)" >&2
		exit 1
	fi
	ln -s "$media_cache_dir" "$work_dir/media"
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
	cp "$ROSTER" "$run_dir_roster"
fi

export OMT_DIR="$omt_dir"
export OMT_SESSION_ID="$session_label"
export FC_FEEDBACK_MANIFEST_ROOT="$manifest_root"

# ── configure fc-feedback for this run-dir (configured mode, plan §15-3) ──
# fc.ts derives its manifest's projectKey from the CWD's git identity (or the
# CWD path itself when there is no git repo), so config set / config status /
# codex all run with the SAME cwd: run_dir. --roster points at the run-dir
# copy (run_dir_roster), never $ROSTER's repo path: config set writes
# whatever path it's given straight into manifest.yaml, and `fc config
# status` (which codex runs) echoes that field back verbatim — a repo path
# there would leak the repo location to the agent same as a $CLAUDE_SKILL_DIR
# substitution would.

config_set_cmd=(bun "$FC_TS" config set --archive "$archive_dir" --roster "$run_dir_roster" --pages-url "$PAGES_URL")
trace "cd \"$run_dir\" && ${config_set_cmd[*]}"

if [ "$dry_run" != "1" ]; then
	(cd "$run_dir" && "${config_set_cmd[@]}")
fi

# ── materialize the skill into the run-dir (deployed codex layout) ─────────
# Round 0 (--no-skill) deliberately gets none of this: the whole point of the
# baseline is that the skill is absent, so nothing is materialized and
# ${CLAUDE_SKILL_DIR} is never substituted (no SKILL.md body is injected for
# --no-skill either — see the prompt-build step below).

skill_dir_for_prompt="$SKILL_DIR"
if [ "$no_skill" != "1" ]; then
	skill_dir_for_prompt="$run_dir/.agents/skills/$SKILL_NAME"
	trace "bun \"$MATERIALIZE_TS\" \"$run_dir\" \"$REPO_ROOT\" \"$SKILL_DIR\" \"$SKILL_NAME\"  # -> $skill_dir_for_prompt (codex .agents/skills + sibling .agents/lib layout)"
	if [ "$dry_run" != "1" ]; then
		bun "$MATERIALIZE_TS" "$run_dir" "$REPO_ROOT" "$SKILL_DIR" "$SKILL_NAME" > /dev/null
	fi
fi

# ── build the prompt: eval-preamble + (SKILL.md body, ${CLAUDE_SKILL_DIR}
# substituted to the MATERIALIZED skill dir, never the repo path) unless
# --no-skill + the task line naming the video ──────────────────────────────

prompt_file="$run_dir/prompt.txt"
trace "build prompt -> $prompt_file (eval-preamble.md$([ "$no_skill" = "1" ] && echo "" || echo " + SKILL.md body, \${CLAUDE_SKILL_DIR} -> $skill_dir_for_prompt") + task line for $video_url)"

if [ "$dry_run" != "1" ]; then
	{
		cat "$HARNESS_DIR/prompts/eval-preamble.md"
		echo
		if [ "$no_skill" != "1" ]; then
			echo "---"
			echo
			skill_body="$(cat "$SKILL_MD")"
			skill_body="${skill_body//\$\{CLAUDE_SKILL_DIR\}/$skill_dir_for_prompt}"
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

# prompt.txt leak guard: fail the run rather than ship a prompt that names the
# repo root, the eval directory, or a plan section to the agent.
trace "grep -qF \"$REPO_ROOT\" \"$prompt_file\" || grep -qF 'evals/fc-feedback' \"$prompt_file\" || grep -qF 'plan §' \"$prompt_file\"  # any match -> abort"

if [ "$dry_run" != "1" ]; then
	if grep -qF "$REPO_ROOT" "$prompt_file" || grep -qF "evals/fc-feedback" "$prompt_file" || grep -qF "plan §" "$prompt_file"; then
		echo "run.sh: prompt.txt leaks the repo root, 'evals/fc-feedback', or 'plan §' — aborting" >&2
		grep -nF -e "$REPO_ROOT" -e "evals/fc-feedback" -e "plan §" "$prompt_file" >&2 || true
		exit 1
	fi
fi

# ── sandbox isolation: mandatory pre-run smoke (skipped with
# --no-sandbox-isolation) ──────────────────────────────────────────────────
# Runs the SAME permission profile the real codex exec call below will use,
# through `codex sandbox` (no model call — a local seatbelt-policy debug
# runner), and aborts the whole run if the policy doesn't behave as expected.

if [ "$isolate_reads" = "1" ]; then
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- cat \"$REPO_ROOT/CLAUDE.md\"  # must FAIL (Operation not permitted)"
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- ls \"$WORKTREES_PARENT\"  # must FAIL — denies every sibling worktree, not just this one"
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- ls \"$REAL_OMT_DIR\"  # must FAIL, if $REAL_OMT_DIR exists"
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- ls \"$HOME/.codex/sessions\"  # must FAIL, if that dir exists"
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- ls \"$REAL_CLAUDE_DIR\"  # must FAIL, if $REAL_CLAUDE_DIR exists"
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- ls \"$REAL_PINS_DIR\"  # must FAIL, if $REAL_PINS_DIR exists"
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- cat \"$run_dir/$RUN_DIR_MARKER\"  # must SUCCEED"
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- ls \"$media_cache_dir\"  # must SUCCEED — media cache stays readable"
	trace "codex sandbox -c \"$PERM_PROFILE_OVERRIDE\" -P \"$PERM_PROFILE\" -C \"$run_dir\" -- curl -sI --max-time 5 https://example.com  # must SUCCEED (network reachable)"

	if [ "$dry_run" != "1" ]; then
		smoke_failed=0

		if smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- cat "$REPO_ROOT/CLAUDE.md" 2>&1); then
			echo "run.sh: sandbox smoke FAILED — the repo root was readable inside the sandbox: $smoke_out" >&2
			smoke_failed=1
		fi

		if smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- ls "$WORKTREES_PARENT" 2>&1); then
			echo "run.sh: sandbox smoke FAILED — the worktrees-parent dir was readable inside the sandbox: $smoke_out" >&2
			smoke_failed=1
		fi

		if [ -d "$REAL_OMT_DIR" ]; then
			if smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- ls "$REAL_OMT_DIR" 2>&1); then
				echo "run.sh: sandbox smoke FAILED — \$HOME/.omt was readable inside the sandbox: $smoke_out" >&2
				smoke_failed=1
			fi
		fi

		if [ -d "$HOME/.codex/sessions" ]; then
			if smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- ls "$HOME/.codex/sessions" 2>&1); then
				echo "run.sh: sandbox smoke FAILED — \$HOME/.codex/sessions was readable inside the sandbox: $smoke_out" >&2
				smoke_failed=1
			fi
		fi

		if [ -d "$REAL_CLAUDE_DIR" ]; then
			if smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- ls "$REAL_CLAUDE_DIR" 2>&1); then
				echo "run.sh: sandbox smoke FAILED — \$HOME/.claude was readable inside the sandbox: $smoke_out" >&2
				smoke_failed=1
			fi
		fi

		if [ -d "$REAL_PINS_DIR" ]; then
			if smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- ls "$REAL_PINS_DIR" 2>&1); then
				echo "run.sh: sandbox smoke FAILED — \$HOME/.pins was readable inside the sandbox: $smoke_out" >&2
				smoke_failed=1
			fi
		fi

		if ! smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- cat "$run_dir/$RUN_DIR_MARKER" 2>&1); then
			echo "run.sh: sandbox smoke FAILED — the run-dir was NOT readable inside the sandbox: $smoke_out" >&2
			smoke_failed=1
		fi

		if ! smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- ls "$media_cache_dir" 2>&1); then
			echo "run.sh: sandbox smoke FAILED — the media cache was NOT readable inside the sandbox: $smoke_out" >&2
			smoke_failed=1
		fi

		if ! smoke_out=$(codex sandbox -c "$PERM_PROFILE_OVERRIDE" -P "$PERM_PROFILE" -C "$run_dir" -- curl -sI --max-time 5 https://example.com 2>&1); then
			echo "run.sh: sandbox smoke FAILED — network was NOT reachable inside the sandbox: $smoke_out" >&2
			smoke_failed=1
		fi

		if [ "$smoke_failed" = "1" ]; then
			echo "run.sh: aborting — sandbox isolation smoke check failed (pass --no-sandbox-isolation to fall back to --dangerously-bypass-approvals-and-sandbox, with no OS-level read isolation)" >&2
			exit 1
		fi
	fi
fi

# ── run codex exec (plan §15-1) ─────────────────────────────────────────────

# --ephemeral: denying $HOME/.codex/sessions above (deny blocks writes too, not
# just reads) would otherwise fight codex's own rollout/session persistence
# for THIS run; --ephemeral turns that persistence off (history_mode=None) so
# there is nothing for codex to write there in the first place. See the
# "격리" section of README.md for the residual-uncertainty note on this flag.
run_jsonl="$run_dir/run.jsonl"
if [ "$isolate_reads" = "1" ]; then
	codex_cmd=(codex exec --skip-git-repo-check --ephemeral -m "$model" -c "model_reasoning_effort=$effort" -c "$PERM_PROFILE_OVERRIDE" -c "default_permissions=$PERM_PROFILE" --json -C "$run_dir" -)
else
	codex_cmd=(codex exec --skip-git-repo-check -m "$model" -c "model_reasoning_effort=$effort" --dangerously-bypass-approvals-and-sandbox --json -C "$run_dir" -)
fi
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

# No ~/.fc-feedback cleanup needed: FC_FEEDBACK_MANIFEST_ROOT (exported above)
# already redirected the manifest under $run_dir/fc-manifests, so it lives and
# dies with the run-dir — `run.sh --cleanup` removes it along with everything
# else once score.ts is done reading the run-dir.

# run.sh does NOT delete run_dir itself — score.ts reads plan.json/notes.json/
# etc. straight out of it, then calls `run.sh --cleanup <run-dir>` when done.
echo "$run_dir"

if [ "$dry_run" != "1" ]; then
	exit "$codex_status"
fi
