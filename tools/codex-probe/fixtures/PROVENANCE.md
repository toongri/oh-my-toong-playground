# Fixture provenance

Every `.jsonl` file in this directory is byte-exact output copied from a real
`codex exec` invocation — not hand-written. JSONL has no comment syntax, so
provenance is recorded here instead of inline in the fixture files.

Environment: `codex-cli 0.144.5` at `/Users/toong/.superset/bin/codex`
(inside the root `config.yaml`'s `codex-versions` allowlist — see that file
for the exact set, so this note can't drift from it).
Captured 2026-07-23 in a scratch working directory
(`--skip-git-repo-check -s read-only`, stdin closed).

## pong-stdout.jsonl / pong-rollout.jsonl

```
codex exec --json --skip-git-repo-check -s read-only -C . \
  "Say exactly the word PONG and nothing else." < /dev/null > pong-stdout.jsonl
```

- `pong-stdout.jsonl`: the command's stdout, unmodified.
- `pong-rollout.jsonl`: copied from
  `~/.codex/sessions/2026/07/23/rollout-2026-07-23T15-13-17-019f8d9b-5c62-71d1-a116-90d367ff4213.jsonl`,
  correlated via the `thread.started` event's `thread_id` in the stdout
  fixture matching this rollout file's `session_meta.payload.session_id` /
  filename suffix.
- No tool calls in this turn (trivial text-only response) — covers the plain
  `agent_message`-only shape.

## toolcall-stdout.jsonl / toolcall-rollout.jsonl

```
echo "hello world" > sample.txt
codex exec --json --skip-git-repo-check -s read-only -C . \
  "Read the file sample.txt using your file-reading tool and tell me its \
  exact contents." < /dev/null > toolcall-stdout.jsonl
```

- `toolcall-stdout.jsonl`: the command's stdout, unmodified. Contains an
  `item.completed` event with `item.type: "command_execution"` — covers the
  tool-call shape.
- `toolcall-rollout.jsonl`: copied from
  `~/.codex/sessions/2026/07/23/rollout-2026-07-23T15-13-36-019f8d9b-a877-7ac1-b727-936d3f9aa3ed.jsonl`,
  correlated the same way as above.
