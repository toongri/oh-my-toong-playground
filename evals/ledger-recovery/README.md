# Ledger recovery behavior evaluation

This harness runs exactly one isolated cell per process. `control` has no
recovery context; `current` and `improved` receive the exact output of the
materialized `ledger-core.sh` fixture. This is simulated developer guidance,
not native model compaction.

The frozen arm materializes `ledger-core.sh`, `omt-ledger.sh`, and
`lib/omt-dir.sh` from git ref `c85d70e7`. The improved arm materializes those
files plus the current `lib/ledger-events.mjs`. Each cell
records SHA-256 source receipts and saves guidance for every non-control arm.
The fixture wrapper lives under the isolated `CODEX_HOME` and invokes the
actual sibling helper; a disposable helper smoke runs before any model call.

Run one cell with a portable evidence root:

```bash
OMT_EVAL_ROOT="<evidence-directory>" \
  bun evals/ledger-recovery/run.ts --arm improved --rep 1
```

`--arm` and `--rep` are mandatory and reps are `1..5`. Use `--help` for the
syntax or `--smoke` alone for the no-model fixture check. Each cell writes its
own `summary.tsv`; there is no shared summary file, so concurrent cells cannot
overwrite one another. Command-based whole-ledger reads are retained as a
manual-review flag: completed event status and command text alone do not prove
that the model actually consumed the output, and bounded/read-piped commands
are excluded as false-positive candidates.

Inspect `events.jsonl`, `events.stderr.txt`, `infrastructure.json`,
`ledger-before.md`, `ledger-after.md`, `report-after.md`, `guidance.txt`, and
`source-bytes.txt` in each cell directory. CLI/receipt failures are kept in
the infrastructure receipt rather than mixed into the event stream.
