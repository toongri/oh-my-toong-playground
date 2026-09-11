# Session ledger operations

The session ledger is a durable, append-oriented provenance record for work
that may matter after context compaction. It is operational context, not a
second instruction hierarchy: current instructions and the latest user
request win, and `source` records attribution (`user`, `agent`, or `hook`),
not authorization.

## What is and is not being restored

Native runtime context compaction is separate from OMT ledger recovery. A
native compaction event does not mean that OMT has a token or percentage
trigger, and the ledger does not summarize, delete, or rewrite conversation
history. The agent records semantic events and checkpoints through the helper;
when a supported compact-context event arrives, OMT projects current ledger
state into bounded hook context.

The Codex hook sequence verified against Codex CLI `0.153.4` for manual
compact is `PostCompact` followed by `SessionStart` with `source: compact`.
`PostCompact` has no context-bearing output contract, so it leaves a pending
token. Recovery uses the next supported context event (`SessionStart`, or the
registered `UserPromptSubmit`/`PostToolUse` bridge), and succeeds at most once
per token. A second compaction while recovery is running is retained as
`.next` for the next recovery. This is a version-qualified native-event probe,
not a claim that every host or future CLI emits these events.

If there is no valid pending marker, there is no recovery request (and bridge
events stay silent). Missing or malformed tooling/input keeps recording
static/fail-open where the hook contract permits. A valid pending marker whose
projection fails emits a diagnostic and remains retryable; it is not
acknowledged after an unsuccessful projection. Separate hook invocations and
projects have separate trust boundaries; a marker is not permission to read
another project's ledger.

## File shape and durable events

The helper bootstraps the original six-section Markdown skeleton, in this
order:

```text
## Now
## Decisions
## User Corrections (verbatim)
## Pending
## Pointers
## Learnings
```

`append <section>` appends prose, while `now` replaces only `Now`. Structured
`checkpoint` also replaces only `Now`; it does not remove durable records in
the other sections. `record` appends one immutable event to a non-`Now`
section. `resolve` and `supersede` append lifecycle status entries; they do
not rewrite the original record. A read projection therefore reports
`active`, `resolved`, or `superseded` without losing the original payload.

Legacy prose is retained verbatim. It is unstructured and is not automatically
obsolete; structured projections label it as legacy/unstructured and do not
pretend it is a validated event. Lines that resemble event markers are
escaped when newly written, so prose cannot forge a structured event.

### Checkpoint contract

Checkpoint JSON has exactly seven fields. The first six must be nonblank
strings: `goal`, `scope`, `user_updates`, `done`, `pending`, and `next`.
`refs` must be an array of strings (it may be empty). Keep the goal and scope,
the latest user correction verbatim, done/pending/next handles, and canonical
artifact or evidence references in `refs`. If validation evidence is
invalidated, checkpoint that fact and do not reuse the invalidated evidence.

## CLI

`hooks/omt-ledger.sh` resolves the session ID from nonempty `OMT_SESSION_ID`,
then `CODEX_THREAD_ID`; it refuses `default`, unsafe characters, or IDs over
200 characters. Set `OMT_DIR` when invoking it in a controlled environment.
The Codex hook itself deliberately invokes the deployed helper with
`env -u OMT_SESSION_ID "${CODEX_HOME:-$HOME/.codex}/hooks/omt-ledger.sh"`,
so a stale Claude variable cannot shadow the Codex thread identity.

| Command | Input and useful options |
| --- | --- |
| `record SECTION` | Payload on stdin; `--id ID`, `--source user\|agent\|hook`, required nonblank `--scope`, repeatable `--ref REF`. `SECTION` is any durable section except `Now`. IDs are unique, `[A-Za-z0-9_-]{1,200}`. |
| `resolve ID` | Reason on stdin; `--source` is required and the target must be active. |
| `supersede ID --by REPLACEMENT` | `--source` is required; both records must exist, and replacement must be a different active record. |
| `checkpoint` | Exactly the seven JSON fields above on stdin; replaces only `Now`. |
| `read` | Full projection, or selective `--id ID` / `--section SECTION`; `--active` filters records. |
| `recover` | Bounded current-state projection: latest checkpoint plus active records; no mutation. |

For `read` and `recover`, `--max-bytes` defaults to 7000, has a minimum of 64,
and is clamped to a maximum of 200000. Limits are UTF-8 bytes, and
`--offset` is a UTF-8 byte offset, never a line or token offset. A paged result
contains `continuation: offset=N max-bytes=M`. Continue the same query with
that offset and page size. Start a new selective query with `--offset 0`.
There is no immutable pagination snapshot: if a writer changes the ledger,
re-query from offset zero.

## Worked shell example

The following uses placeholders rather than machine-local evidence paths. The
IDs are distinct and the JSON values satisfy the actual validator.

```bash
export OMT_DIR="${OMT_DIR:-/path/to/omt-state}"
mkdir -p "$OMT_DIR"
export OMT_SESSION_ID="ledger-example-01"
export CODEX_THREAD_ID="$OMT_SESSION_ID"
LEDGER="${CODEX_HOME:-$HOME/.codex}/hooks/omt-ledger.sh"

printf '%s' 'Adopt the bounded recovery contract.' |
  env -u OMT_SESSION_ID "$LEDGER" record Decisions \
    --id decision-20260911-a --source agent --scope session-ledger \
    --ref artifact:design-v1
printf '%s' 'Fictional user instruction: "Keep the exact correction wording."' |
  env -u OMT_SESSION_ID "$LEDGER" record 'User Corrections (verbatim)' \
    --id correction-20260911-a --source user --scope session-ledger
printf '%s' 'replacement decision' |
  env -u OMT_SESSION_ID "$LEDGER" record Decisions \
    --id decision-20260911-b --source agent --scope session-ledger
env -u OMT_SESSION_ID "$LEDGER" supersede decision-20260911-a \
  --by decision-20260911-b --source agent
printf '%s' 'Fictional user withdrawal: the correction no longer applies.' |
  env -u OMT_SESSION_ID "$LEDGER" resolve correction-20260911-a --source user
printf '%s' '{"goal":"ship ledger docs","scope":"hooks and CLI","user_updates":"Keep exact correction wording","done":"records written","pending":"run scoped tests","next":"verify compact recovery","refs":["artifact:design-v1"]}' |
  env -u OMT_SESSION_ID "$LEDGER" checkpoint

env -u OMT_SESSION_ID "$LEDGER" read --section Decisions --active
env -u OMT_SESSION_ID "$LEDGER" recover --max-bytes 2000
```

The `env -u` form is safe for Codex's helper selection; `CODEX_HOME` defaults
to `$HOME/.codex` in the deployed hook. For Claude's deployed helper, use
`${CLAUDE_PROJECT_DIR:-$HOME}/.claude/hooks/omt-ledger.sh` instead.

## Hook budget and deployment

The 7000-byte cap is measured on the decoded `ledger-core.sh`
`additionalContext`, including its recording instructions and recovery
wrapper. It is not the total combined `SessionStart` context from all other
restorers. The wrapper's reserved overhead is computed first and the
remaining budget is passed to `recover`; the original ledger file is never
modified by recovery.

`hooks/lib/ledger-events.mjs` uses Node built-ins only and is the helper
invoked by `hooks/omt-ledger.sh`. Deploy that library with the shell wrapper;
do not add a package merely to run it.
The wrapper's missing-`jq` fallback emits only static recording instructions,
so it cannot inject ledger bytes without a working parser.

## Verification

Run the focused tests from the repository root:

```bash
bash hooks/omt-ledger_test.sh
bash hooks/ledger-core_test.sh
bash hooks/codex-ledger_test.sh
bash hooks/session-start_test.sh
```

For a configurable, non-private probe directory, set `EVIDENCE_DIR` to a
temporary path and drive the production hook with synthetic events:

```bash
EVIDENCE_DIR="${EVIDENCE_DIR:-/path/to/evidence}"
mkdir -p "$EVIDENCE_DIR/omt"
printf '%s' '{"goal":"probe","scope":"hook","user_updates":"none","done":"no","pending":"none","next":"inspect","refs":["probe"]}' |
  env -u OMT_SESSION_ID CODEX_THREAD_ID=probe-01 OMT_DIR="$EVIDENCE_DIR/omt" bash hooks/omt-ledger.sh checkpoint
printf '%s' '{"hook_event_name":"PostCompact","session_id":"probe-01","cwd":"'"$EVIDENCE_DIR"'"}' |
  env -u OMT_SESSION_ID CODEX_THREAD_ID=probe-01 OMT_DIR="$EVIDENCE_DIR/omt" bash hooks/codex-ledger.sh > "$EVIDENCE_DIR/postcompact.json"
printf '%s' '{"hook_event_name":"SessionStart","source":"compact","session_id":"probe-01","cwd":"'"$EVIDENCE_DIR"'"}' |
  env -u OMT_SESSION_ID CODEX_THREAD_ID=probe-01 OMT_DIR="$EVIDENCE_DIR/omt" bash hooks/codex-ledger.sh > "$EVIDENCE_DIR/recovery.json"
jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' "$EVIDENCE_DIR/recovery.json"
```

This probe checks the event envelope and recovery plumbing only. It does not
claim evaluation improvement until evaluation results are completed.
