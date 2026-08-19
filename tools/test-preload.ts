/**
 * bun:test preload — registered from bunfig.toml's `[test] preload`, so it
 * applies to EVERY invocation in this repo: `make test`, `bun test`, and a
 * single-file run alike. One place, no per-file duplication.
 *
 * Why: bun's 5000ms default per-test timeout assumes in-process work. Many
 * tests here drive a CLI for real, spawning a fresh `bun` or `node` process
 * per command -- skills/qa/scripts/qa-state.test.ts's heaviest test issues 27
 * spawns. Measured on this machine one spawn costs ~27ms idle (10-run
 * average), so that test costs ~730ms alone; during a full-suite run, where
 * parallel test workers contend for the same cores, it was observed at
 * 5045ms and failed on the timeout rather than on any assertion. Standalone
 * it passed every time -- the classic load-dependent flake.
 *
 * The ceiling is derived from that measurement, not picked: 60s is ~12x the
 * worst per-test duration ever observed here and ~80x the heaviest test's
 * idle cost, so contention has to get an order of magnitude worse than
 * measured before it bites again. It relaxes no assertion -- a genuinely
 * hung test still fails, just later, and still well inside the suite's own
 * runtime (~135s for the bun half).
 *
 * `[test] timeout` in bunfig.toml is NOT an alternative: measured on bun
 * 1.3.13 it is silently ignored (a 6s test still died at 5000ms), which is
 * why this goes through a preload instead.
 */
import { setDefaultTimeout } from "bun:test";

setDefaultTimeout(60_000);
