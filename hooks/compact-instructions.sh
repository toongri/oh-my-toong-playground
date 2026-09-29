#!/bin/bash
# PreCompact hook: plain stdout here is appended to Claude Code's native
# compaction summary instructions (confirmed by experiment, including for
# auto-compact); a JSON hookSpecificOutput would be ignored on this event.
# This adds no noise to the live session -- it only steers what the
# compaction summary captures. Wording below was tuned by blind-judged
# compaction replays; keep it byte-identical unless re-validated the same
# way.
set -euo pipefail

cat > /dev/null

cat <<'EOF'
Additional requirements for this summary. The reader is you after the reset, continuing autonomously from this summary alone.
- Current Work: state the situation as of the LAST tool result, not as of earlier intentions: repository/worktree path, local branch and its remote branch name, any operation still in progress (merge, rebase, uncommitted changes), the last command run and its outcome. When you quote a file's content, a rule, or an invariant, quote its latest version from the most recent read or edit.
- Next Step: give the exact command(s) to run next with every non-default argument spelled out (for example an explicit push refspec when the local and remote branch names differ). Quote the user message that authorizes it. When the user already authorized the action, say that no further confirmation is needed.
- Add a section "Operational gotchas": every environment trap found in this session, each with its fix: a command that failed and the one that worked; a state check that needs a different form here (for example, in a git worktree `.git` is a file, so check merge state with `git rev-parse --git-path MERGE_HEAD`); a hardcoded value or count that must be re-measured when its inputs change, with the command that measures it.
- Add a section "Experiment results": for every test, eval, or experiment run in this session, what was run and the observed result with its numbers and the specific failures seen.
- When the user approved a proposal that is not finished, add a section "Approved plan (APPROVED)" that reproduces it in full: every target, file, change, rule wording, and verification step.
- When the user removed a scope item or a design was rejected or superseded, name it once as "Rejected: X - because Y". Describe the surviving design only.
- Refer to code by path and symbol name; include code only when the next step edits that code. Include a file path only when the next steps read, edit, or run it. Finished work gets one line with its PR or commit.
- When a deliverable is being assembled from pieces (draft files, scratch files, partial outputs), list every piece file by its full absolute path with what it contains, and list every numbered item not yet written with its number and its meaning as stated where it was defined. Never shorten a path with "...".
- When a subagent, tool, or reviewer result arrived that the conversation has not yet checked, mark it "UNVERIFIED" in Current Work and do not judge it yourself. List each of its recommendations; under each, quote verbatim every saved acceptance criterion, design decision, and user statement on the same topic, including statements about what must be removed. Next Step: verify the result's cited code, compare each recommendation with the quoted items, and ask the user before adopting any recommendation that keeps, adds, or reintroduces something the quoted items remove or forbid. The "no further confirmation is needed" statement never covers adopting an unverified result.
EOF
