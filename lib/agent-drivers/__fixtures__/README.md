# Agent Driver Fixtures

Provenance for each fixture file. All content traces to PoC captures in `/tmp/poc-spike/` or production job output.

## CLI output fixtures

- `opencode-trivial.ndjson` — `/tmp/poc-spike/opencode-initial.txt` (PoC capture, 2026-05-16)
- `opencode-tooluse.ndjson` — `/tmp/poc-spike/opencode-tooluse.txt` (PoC capture, 2026-05-16)
- `opencode-multi-step.ndjson` — `/tmp/poc-spike/opencode-multi-step.txt` (PoC capture, 2026-05-16)
- `opencode-narrative-only.ndjson` — synthesized from `$OMT_DIR/jobs/chunk-review-2026-05-15-0913-88f32f/members/gpt/output.txt` (production reproduction, 2026-05-17; each narrative line wrapped as `{"type":"text","sessionID":"ses_narrative_repro","part":{"text":"..."}}` NDJSON, prepended by step_start, no step_finish — matches production unknown_pause case)
- `opencode-malformed-ndjson.txt` — synthesized (2026-05-17); 10 valid NDJSON lines from opencode event shapes, then last line truncated mid-JSON to produce an unrecoverable parse failure
- `opencode-no-session-id.ndjson` — synthesized (2026-05-17); minimal opencode NDJSON events with no `sessionID` field on any event
- `opencode-with-sentinel.ndjson` — derived from `/tmp/poc-spike/opencode-multi-step.txt` (PoC capture) with sentinel events appended: `{"type":"text",...,"part":{"text":"\n## Verdict\nAPPROVE\n"}}` + `{"type":"step_finish",...,"part":{"reason":"stop"}}`
- `claude-end-turn.json` — `/tmp/poc-spike/claude-stdin-stdout.txt` (PoC capture, 2026-05-16; single JSON object, stop_reason=end_turn)
- `claude-end-turn-with-sentinel.json` — derived from `claude-end-turn.json` shape; `result` field replaced with `"## Verdict\nAPPROVE\n"`, all other fields preserved from PoC capture
- `claude-tool-use.json` — derived from `claude-end-turn.json` shape; `stop_reason` changed to `tool_use` (no tool_use PoC capture existed in /tmp/poc-spike/; session_id and uuid preserved from claude-stdin-stdout.txt)
- `codex-trivial.ndjson` — `/tmp/poc-spike/codex-stdin-stdout.txt` (PoC capture, 2026-05-16; note: codex-130-stdout.txt was 0 bytes, codex-stdin-stdout.txt has the required thread.started/item.completed/turn.completed shape)
- `codex-turn-completed-with-sentinel.ndjson` — derived from `codex-trivial.ndjson`; `item.text` in the `agent_message` item.completed event appended with `\n\n## Verdict\nAPPROVE\n`; thread_id and turn.completed preserved
- `codex-turn-failed.ndjson` — synthesized (2026-05-17); `thread.started` + `turn.started` + `turn.failed` event with context_length_exceeded error

## Sentinel samples (`sentinel/`)

- `sentinel/orchestrate-review-sample.txt` — synthetic chunk-review deliverable (2026-05-17); contains `## Verdict\nAPPROVE` sentinel (regex: `/## Verdict\s*\n\s*(APPROVE|REQUEST_CHANGES|COMMENT)/`)
- `sentinel/agent-council-sample.txt` — synthetic council member output (2026-05-17); contains `## Position\nAPPROVE` sentinel (regex: `/## Position\s*\n\s*(APPROVE|REJECT|ABSTAIN)/`)
- `sentinel/slides-review-sample.txt` — synthetic slides review deliverable (2026-05-17); contains `## Slide Review Summary` sentinel (regex: `/## Slide Review Summary/`)
- `sentinel/diagnose-sample.txt` — synthetic diagnose deliverable (2026-05-17); contains `## Diagnosis\nROOT_CAUSE:` sentinel (regex: `/## Diagnosis\s*\n/`)
