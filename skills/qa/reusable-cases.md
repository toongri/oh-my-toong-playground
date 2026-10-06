# QA Reusable Cases

A reusable case is one user scenario saved as an executable recipe: its
precondition, actions and expected result, plus the native script that drives
them. Cases are found by feature. They supplement the current QA cycle; they
never replace the Actor Roster, six coverage classes, real boundary evidence,
or the current story contract.

## Story contract first

Before a case is selected, create a story with an explicit contract:

- `goal`: the user outcome under test.
- `given`: non-empty preconditions.
- `when`: non-empty actor actions.
- `then`: non-empty observable outcomes.
- `acceptance-criteria`: one or more zero-based links to the session's recorded
  acceptance criteria.

Use the `qa-state.ts add-story` flags (`--goal`, `--given`, `--when`, `--then`,
and `--acceptance-criteria`) with JSON arrays for the array values. A case is
not a substitute for this story-level contract.

## Selection and exploration

At PLAN, for each feature the change touches, list its cases with
`listQaCases` (`qa-cases.ts list --feature <feature-id>`) and read them with
`getQaCase` (`qa-cases.ts get <id>`). Treat matching known cases as planning input: use their
paths, assertions, and reset details to author the complete current-cycle
story/scenario chain, including new, failed, stale, or uncovered paths and the
risk coverage of all six risks. Do not execute replay during PLAN. A case listing is not boundary
proof. A case failure remains a
failure and is recorded as such until its cause is found (see *When a replay
fails*); it is never relabeled as expected, flaky, or pass to close the cycle.

Known cases are hints about an executable path, not permission to narrow the
cycle. Keep every risk covered by a scenario or declared not applicable, and
record evidence from the actor boundary. A trace, recording, or JUnit XML may support diagnosis but is not executable proof or
real-boundary evidence.

## Persistence, on by default

Persistence must use the QA case functions. Do not create
project-local product files, hidden QA directories, caches, reports, or
`.gitignore` entries implicitly. The fixed external manifest is resolved by
`resolveQaCaseContext`; helper functions own case metadata reads/writes. Native
runner scripts are authored by the driver at the explicitly resolved,
user-authorized asset path; callers do not scan for storage or write metadata
files directly.

The store is on by default. The first lookup for a project turns a missing (or
legacy `unconfigured`) manifest into `configured` at `~/.qa-cases/<projectKey>/cases`,
outside the project. There is nothing to ask.

- `configured`: use that location, or another one the user chose. A project-local
  path is allowed only when the user explicitly opts in (`allowProjectStorage`).
- `disabled`: the user's opt-out. Ordinary QA continues without case
  persistence and does not ask again. Disable only when the user asks for it.

Use `getQaCaseStoreStatus` to inspect state (or `qa-cases status`),
`configureQaCaseStore` when the user names another location, and
`disableQaCaseStore` when the user asks to opt out.
When configured, use `saveQaCase` with the observed revision (or `null` for a
new case), then `getQaCase`/`listQaCases`; handle a `revision_mismatch` as a
conflict and re-read before reconciling. Resolver helpers keep run/output/assets
paths inside the approved store.

The CLI is the repository script:
`bun "${CLAUDE_SKILL_DIR}/scripts/qa-cases.ts"`. It supports `configure
--location ABSOLUTE_PATH`, `disable`, `list`, `get <id>`, and `save --file
JSON_PATH --expect new|SHA256`. Run
`bun "${CLAUDE_SKILL_DIR}/scripts/qa-cases.ts" help` for complete options;
saving metadata never executes a runner or copies product files.

## Replaying a saved case

After PLAN has authored the complete current-cycle chain and the QA state has
an active, `chainComplete` actor → story → scenario chain, use the replay wrapper
for a known saved case before exploratory driving of the remaining paths:

```sh
bun "${CLAUDE_SKILL_DIR}/scripts/qa-replay.ts" \
  --case CASE_ID --story STORY_ID --scenario SCENARIO_ID \
  --project /absolute/project \
  --code-ref COMMIT_OR_BUILD_REF \
  --reset-confirmed "the saved reset description"
```

When a run needs more headroom, pass `--timeout-ms <ms>` and/or
`--max-buffer <bytes>` to raise its per-run limits. The runner accepts finite,
positive numbers; when omitted, the defaults remain 120000 ms and 1048576
bytes.

`--scenario` selects one authored scenario of the story.
`--allow-project-cwd` is required when the saved `execution_cwd` is the
product project; otherwise save an absolute external cwd or `{artifacts}`.
Relative `native_files` resolve from the canonical repository root resolved for
the project; absolute references are accepted when present.
`{artifacts}` expands argv and execution cwd into the run directory, and the
runner receives `QA_ARTIFACTS_DIR` pointing there. The run output is routed to
that directory as `stdout.log`, `stderr.log`, and a new `receipt.json`; existing
artifacts are never overwritten.
Review the runner's flags/output/config first: native runners are not sandboxed.

The wrapper checks the saved case revision, actor surface, reset confirmation,
and current-cycle authored scenario. It requires the
active `chainComplete` gate. A successful runner produces a receipt with
`qa_result: "not-recorded"`; it never records a QA scenario PASS. A failed runner
returns a non-zero exit status and remains a failure. Case metadata is saved
only by the case helper; replay executes the saved native runner and writes its
receipt/artifacts, not new case metadata.

After inspecting the receipt and capturing actual boundary evidence under the
same attempt directory, bind the execution record to the scenario with the existing
state command (keeping the normal evidence arguments and visual requirements):

```sh
bun "${CLAUDE_SKILL_DIR}/scripts/qa-state.ts" record-scenario \
  --story STORY_ID --scenario SCENARIO_ID --status pass \
  --evidence-path "$ATTEMPT_DIR/boundary.json" \
  --evidence-surface bash \
  --case-run "$ATTEMPT_DIR/receipt.json"
```

`--case-run` is provenance, not PASS evidence. Binding rejects a stale or
mismatched receipt (session, story, scenario, cycle, story-contract hash,
case identity/revision, actor surface, native-file hashes, logs, receipt, or
artifact hashes), and rejects receipt/log files as substitutes for boundary
evidence. The evidence file(s) must be inside the attempt directory and their
hashes are recorded. Visual scenarios still require separate before/action/after
captures and evidence review; manual `record-scenario` without `--case-run` remains
valid when no saved case is being replayed.

`--reset-confirmed` only confirms the saved reset description; it does not run
the reset. Native runners remain unsandboxed, so inspect their flags/output and
configuration before replay.

An invalid configured manifest is an error, not an automatic reset or fallback.

## Which scenarios become cases

An `H` scenario that passed by driving its actor's boundary (its evidence
surface is not `test`) becomes a case. A scenario proven by an automated test
is already automated. `M` and `L` scenarios are not saved.

One case is one scenario, from its precondition to its expected result.
Scenarios that differ only by device profile share one case: replay it on each
profile's screen size and link each of those scenarios to the same case id.
Steps that many scenarios share (sign-in, reaching a screen) go in a shared
script under the store's `cases/shared/`. The case's runner chains it first, for
example `agent-device replay <shared>.ad --keep-session && agent-device replay
<case>.ad`, and both files go in `native_files`.

## Creating a case

1. **Name the feature.** Find the feature in the feature map (`feature-map.ts
   query`). If it is not there, add it first (`feature-map.ts save`), then put
   its id in the case's `feature_refs`.
2. **Record while you drive.** The recording is made during the scenario's own
   run, not in a separate pass. The form follows the driver:
   - `agent-device`: record with `--save-script` (example below).
   - `agent-browser`: it records video and HAR only, not a script. Write the
     commands you ran into a shell script as you go. Replace each `@eN` ref,
     which changes on every snapshot, with a `find role|text|label …` command.
   - `curl` / `bash`: the commands themselves are the script.
3. **Record the scenario** as usual with `record-scenario`.
4. **Save the case** with `qa-cases.ts save`: goal, Given/When/Then, actor
   surface, exact runner, working directory, native files, reset instructions,
   and feature refs.
5. **Replay it as the flaky-rerun check.** Reset the application and
   independently rerun the saved recipe through `qa-replay.ts`, with the
   same assertions from the real boundary. This replay is the check that the
   recording works; there is no separate rerun.
6. **Link it** to the scenario:

```sh
bun "${CLAUDE_SKILL_DIR}/scripts/qa-state.ts" record-case \
  --story STORY_ID --scenario SCENARIO_ID --case CASE_ID
```

`record-case --case` accepts only a case that replayed cleanly for that
scenario in this cycle. When a scenario that qualifies cannot become a case
(the driver cannot record that screen, for example), record why with
`record-case … --none "<reason>"`. `complete` refuses while a qualifying
scenario has neither, unless it was already proven by replaying a saved case
(`record-scenario --case-run`).

Never save a failed run as a successful case, and never turn a run artifact into
a runner.

## When a replay fails

Find the cause before recording anything. If the diff intentionally changed
the screen or element the script touches, the case is out of date: re-record
it while driving the scenario and save it with `--expect <old revision>`. That
is not a product failure. Otherwise drive the scenario by hand. Only a product
cause shown there makes it a `fail`.

Native formats remain native: `.ad` scripts for `agent-device`, shell scripts of
`agent-browser` commands for web, and Maestro YAML with
`runFlow`/`assertVisible` where that project uses Maestro. Do not install
Cucumber or invent a universal DSL. Use the installed runtime's skill/help
before operating a driver.

Example (illustrative app/selectors, verified with installed
`agent-device` 0.21.6; resolve an absolute external case path first and read
the current runtime help before operation):

```sh
: "${QA_CASE_FILE:?Set an absolute case path in the agreed store}"
agent-device open com.example.qa --relaunch --save-script="$QA_CASE_FILE"
agent-device press 'id="settings"' --settle
agent-device wait 'role="heading" label="Settings"'
agent-device is visible 'id="settings-title"' --record
agent-device session save-script "$QA_CASE_FILE"
agent-device close

# independently reset, then replay the saved script and assert again
agent-device replay "$QA_CASE_FILE"
agent-device close
```

If cleanup can fail, preserve the original command's exit status. For
`--record-as`, replace secrets with placeholders; never store credentials.
