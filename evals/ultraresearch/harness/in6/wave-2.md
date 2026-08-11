# Wave 2 — expansion findings

## Git-like merge premise

No examined source describes a tool that can safely synthesize a semantic merge of two independently authored, possibly conflicting schema/data migrations. This is a scoped research result, not a universal impossibility theorem. Alembic creates an explicit merge revision; its body can contain human-authored reconciliation. Atlas rebases only unapplied filenames/checksums. Flyway, Liquibase, Prisma, and Sqitch use ordering, integrity checks, or manual reconciliation.

Sources: https://alembic.sqlalchemy.org/en/latest/branches.html, https://atlasgo.io/faq/out-of-order-migrations, https://documentation.red-gate.com/flyway/reference/migrations/flyway-schema-history-table, https://docs.liquibase.com/community/implementation-guide-5-0/connect-your-changelogs-using-include-or-includeall, https://www.prisma.io/docs/orm/prisma-migrate/workflows/troubleshooting, https://sqitch.org/docs/manual/sqitchtutorial/

## Atlas conflict workflow

- `atlas migrate rebase` only renames selected **unapplied** files and updates `atlas.sum`; it does not execute or merge SQL operations. https://atlasgo.io/faq/out-of-order-migrations
- Default execution is linear; non-linear execution is discouraged for production. https://atlasgo.io/versioned/apply
- Community Edition includes core versioned migration commands but excludes rebase, linting and CI integration. https://atlasgo.io/community-edition

## Prisma current-lock verification

- Prisma's engine calls `acquire_lock()` before reading/applying migrations, then determines pending entries by migration name and applies them sequentially. https://github.com/prisma/prisma-engines/blob/561d7b42579a2459cc8edf3788918b626c640023/schema-engine/commands/src/commands/apply_migrations.rs#L17-L100
- PostgreSQL locking is `pg_advisory_lock(72707369)` with the documented ten-second timeout; CockroachDB is an exception. https://github.com/prisma/prisma-engines/blob/561d7b42579a2459cc8edf3788918b626c640023/schema-engine/connectors/sql-schema-connector/src/flavour/postgres.rs#L363-L385
- Feature-branch conflict resolution is manual/reset/replay, not graph merging. https://www.prisma.io/docs/orm/prisma-migrate/workflows/troubleshooting

## Verification outcome

The independent verification pass confirmed the direct Prisma, Kysely and Atlas claims. It marked two broad negative claims partial: Alembic merge files may contain manually written reconciliation, and the examined Drizzle PostgreSQL migrator contains no advisory lock in its implementation range but that alone cannot prove package-wide absence.

## EXPAND markers (verbatim)

none — second-wave leads were exhausted; the remaining Drizzle lead was already covered in Wave 1 and independently scoped by verification.
