---
name: read-db
description: Use when a task needs real rows, counts, or column facts from a PostgreSQL database — checking data before a migration, debugging one user's stored values, answering "how many / which / is there any" about live data — triggers include "DB 조회", "운영 데이터 확인", "prd에서 확인", "psql", "SELECT", "row count", "NULL 있는지", "query the database". Not for writes, migrations, or schema changes.
---

# Read DB

## Overview

Every lookup goes through one wrapper, `read-db.ts`, addressed by a **named read-only service**. The wrapper owns the safety settings, so a lookup is one short command and the connection string never appears anywhere.

**Core principle:** the command names its target. `app-prd-ro` in the command line says which database was read; `"$DATABASE_URI"` says nothing and puts the password in the process list.

## The Lookup

1. **Schema from code first.** Column names, types, and nullability come from the repo's schema files (Drizzle, Django models, migrations). Query the database for data, not for structure you can read.
2. **Pick the service.** `bun ${CLAUDE_SKILL_DIR}/scripts/read-db.ts --list` prints the services available on this machine. The name states environment and access (`…-prd-ro`, `…-stg-ro`). State in your reply which one you read.
3. **Run one statement.**

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/read-db.ts app-prd-ro \
  "select count(*) filter (where supplement_code is null) as nulls, count(*) as total from bottles"
```

Output is CSV on stdout. Aggregate in SQL and select only the columns you need; the wrapper caps output at 200 rows and says so on stderr when it cuts.

## What the Wrapper Already Does

Do not re-add these by hand, and do not call `psql` directly to get around them.

| Guarantee | How |
|---|---|
| No secret in argv, env, or output | Connects by `service=<name>`; libpq reads host and user from `~/.pg_service.conf` and the password from `~/.pgpass` |
| Read-only | Accepts only services ending in `-ro`; session runs with `default_transaction_read_only=on`; one statement per call, so nothing can switch it off |
| Bounded load | `statement_timeout` 15 s, `lock_timeout` 3 s, row cap 200 (`READ_DB_TIMEOUT_MS`, `READ_DB_MAX_ROWS` to change) |
| Non-interactive | `-X`, pager off, `ON_ERROR_STOP` |

## When It Refuses

| Message | Meaning | Do |
|---|---|---|
| `service not in …` / `--list` is empty | This machine has no such read-only service | Tell the user; they add a `[name-ro]` section to `~/.pg_service.conf` and a matching `~/.pgpass` line (`--help` prints the exact format). Never build a connection string yourself |
| `one statement per call` | SQL contains `;` | Split into separate calls |
| `not a read-only statement` | Statement is not SELECT/WITH/EXPLAIN/SHOW/TABLE/VALUES | This skill does not write. Stop and tell the user |
| `psql not found` | Client missing | `brew install libpq` (`make sync` provisions it) |
| `canceling statement due to statement timeout` | Query too heavy | Do not raise the timeout and retry. Check the plan with `EXPLAIN` (never `EXPLAIN ANALYZE` on a large table), narrow the query, or report |

## Reporting

Report aggregates and the facts that answer the question. Do not paste personal or health rows into chat, tickets, commits, or PRs.
