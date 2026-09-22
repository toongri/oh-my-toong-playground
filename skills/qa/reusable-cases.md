# QA Reusable Cases

Reusable cases are optional, executable QA recipes. They supplement the current
QA cycle; they never replace the Actor Roster, six coverage classes, real
boundary evidence, or the current story contract.

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

At PLAN, use `listQaCases` and `getQaCase` through the QA case functions (or
the repository `qa-cases.ts list` / `qa-cases.ts get <id>` commands) when the
store is configured. Replay matching known cases first, then use the
current feature map and code/spec discovery to author new paths. Always add
new, failed, stale, or uncovered paths to the six-axis scenario plan; a case
listing or a green replay is not boundary proof. A case failure remains a
failure and is recorded as such; do not relabel it as expected, flaky, or pass.

Known cases are hints about an executable path, not permission to narrow the
cycle. Preserve the six classes plus `cls1/hang-timeout` and
`cls5/flaky-green`, and record evidence from the actor boundary. A trace, recording, or JUnit XML may support diagnosis but is not executable proof or
real-boundary evidence.

## Optional persistence and three states

Persistence is optional and must use the QA case functions. Do not create
project-local product files, hidden QA directories, caches, reports, or
`.gitignore` entries implicitly. The fixed external manifest is resolved by
`resolveQaCaseContext`; helper functions own case metadata reads/writes. Native
runner scripts are authored by the driver at the explicitly resolved,
user-authorized asset path; callers do not scan for storage or write metadata
files directly.

When the manifest is `unconfigured`, ask once and offer exactly these choices:
an external absolute location, a project-local location only with explicit
opt-in, or `disabled`. Keep a draft in the current QA report/state until the
user chooses; do not choose a default.

- `configured`: use the approved external location. A project-local path is
  allowed only when the user explicitly opts in (`allowProjectStorage`).
- `disabled`: remember the opt-out. Ordinary QA continues without case
  persistence and does not ask again.

Use `getQaCaseStoreStatus` to inspect state (or `qa-cases status`),
`configureQaCaseStore` after an
explicit location decision, and `disableQaCaseStore` after an explicit opt-out.
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

After the current QA state has an active, complete actor → story → cell chain,
use the replay wrapper for a known saved case:

```sh
bun "${CLAUDE_SKILL_DIR}/scripts/qa-replay.ts" \
  --case CASE_ID --story STORY_ID --cls 1 \
  --project /absolute/project \
  --code-ref COMMIT_OR_BUILD_REF \
  --reset-confirmed "the saved reset description"
```

Use `--sub hang-timeout|flaky-green` when selecting one of those authored
cells. `--allow-project-cwd` is required when the saved `execution_cwd` is the
product project; otherwise save an absolute external cwd or `{artifacts}`.
Relative `native_files` resolve from the canonical repository root resolved for
the project; absolute references are accepted when present.
`{artifacts}` expands argv and execution cwd into the run directory, and the
runner receives `QA_ARTIFACTS_DIR` pointing there. The run output is routed to
that directory as `stdout.log`, `stderr.log`, and a new `receipt.json`; existing
artifacts are never overwritten.
Review the runner's flags/output/config first: native runners are not sandboxed.

The wrapper checks the saved case revision, actor surface, linked acceptance
criteria, reset confirmation, and current-cycle authored cell. It requires the
active `chainComplete` gate. A successful runner produces a receipt with
`qa_result: "not-recorded"`; it never records a QA cell PASS. A failed runner
returns a non-zero exit status and remains a failure. Case metadata is saved
only by the case helper; replay executes the saved native runner and writes its
receipt/artifacts, not new case metadata.

After inspecting the receipt and capturing actual boundary evidence under the
same attempt directory, bind the execution record to the cell with the existing
state command (keeping the normal evidence arguments and visual requirements):

```sh
bun "${CLAUDE_SKILL_DIR}/scripts/qa-state.ts" record-cell \
  --story STORY_ID --cls 1 --status pass \
  --evidence-path "$ATTEMPT_DIR/boundary.json" \
  --evidence-surface bash \
  --case-run "$ATTEMPT_DIR/receipt.json"
```

`--case-run` is provenance, not PASS evidence. Binding rejects a stale or
mismatched receipt (session, story, cell/sub, cycle, story-contract hash,
case identity/revision, actor surface, native-file hashes, logs, receipt, or
artifact hashes), and rejects receipt/log files as substitutes for boundary
evidence. The evidence file(s) must be inside the attempt directory and their
hashes are recorded. Visual cells still require separate before/action/after
captures and evidence review; manual `record-cell` without `--case-run` remains
valid when no saved case is being replayed.

`--reset-confirmed` only confirms the saved reset description; it does not run
the reset. Native runners remain unsandboxed, so inspect their flags/output and
configuration before replay.

If the manifest is awaiting a storage decision, ask once and remember the
approved external or explicitly opted-in project location, or remember
`disabled`; an invalid configured manifest is an error, not an automatic reset
or fallback.

## Curating a case

For first curation, author the native draft and independently rerun it with
assertions from the real boundary **before** registering metadata with
`saveQaCase`. For known saved cases, use the replay wrapper above. Curate only
a useful, reproducible case: retain its
goal, GWT, AC links, actor surface, exact runner, working directory, native
files, reset instructions, and feature refs. Reset the application and
independently rerun the saved recipe with the same assertions from the real
boundary. Save it as reusable only after that fresh rerun passes. Never save a
failed run as a successful case, and never turn a run artifact into a runner.

Native formats remain native: `.ad` scripts for `agent-device`, existing
agent-browser/Playwright shell or CLI templates for web, and Maestro YAML
with `runFlow`/`assertVisible` where that project uses Maestro. Do not install
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
