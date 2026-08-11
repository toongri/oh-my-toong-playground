# Wave 1 — saturation findings

## Target-repository reality

- `acme-home/stage` is Node 22 / pnpm / TypeScript with `drizzle-orm` 0.44.5 and `drizzle-kit` 0.31.5, but its policy says Python/Alembic is the only migration authority and Drizzle is schema synchronization only: `/Users/toong/repos/acme-home/stage/apps/backend/docs/orm-sync-policy.md:7-30`.
- Deploy order is already migration → backend deploy → verification; Argo serializes backend deploys per environment and retries migration dispatch once. A replacement must therefore be idempotent and use a database-level lock. Evidence: `/Users/toong/repos/acme-home/stage/.github/workflows/deploy-env-backend.reusable.yaml:48-76`; `/Users/toong/repos/acme-gitops/main/infra/argo-workflows/base/templates/deploy-env.yaml:346-363`; `/Users/toong/repos/acme-gitops/main/infra/argo-workflows/base/templates/deploy-pipeline.yaml:511-527`.
- The immediate Alembic problem is material: the inspected tree has 296 revisions, 56 merge revisions and two heads; recent merge files explicitly record no-op merges for split heads. Evidence: `/Users/toong/repos/acme-home/stage/.github/workflows/ci.yml:476-525`; `/Users/toong/repos/acme-home/stage/apps/python-backend/migrations/versions/mrg_placeholder_0000.py:1-28`.

## Tool findings

- **Prisma Migrate**: TS-native `migrate deploy` is a CI/CD command and uses a PostgreSQL advisory lock, but migrations are lexically ordered files and branch history conflicts require manual rebase/squash. Sources: https://www.prisma.io/docs/cli/migrate/deploy ; https://docs.prisma.io/docs/v6/orm/prisma-migrate/workflows/squashing-migrations ; https://github.com/prisma/prisma-engines/blob/561d7b42579a2459cc8edf3788918b626c640023/schema-engine/connectors/sql-schema-connector/src/flavour/postgres.rs#L363-L384.
- **Drizzle Kit**: TS-native and operationally easy, but published PostgreSQL migrator source has a transaction and no advisory lock. Parallel migration generation also has documented journal/index collision hazards; current advice is regenerate on the parent baseline. Sources: https://orm.drizzle.team/docs/drizzle-kit-migrate ; https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/pg-core/dialect.ts#L2320-L2391 ; https://github.com/drizzle-team/drizzle-orm/issues/5774#L160-L170.
- **Kysely Migrator**: TypeScript-native; PostgreSQL adapter uses advisory lock and runs transactionally by default. `allowUnorderedMigrations` avoids default prefix-order rejection but cannot resolve conflicting DDL. Source: https://github.com/kysely-org/kysely/blob/f24018c789c3cf7ad03ccc672ada63a1ded87f88/src/dialect/postgres/postgres-adapter.ts#L6-L39 ; docs: https://www.kysely.dev/docs/migrations.
- **Knex**: TS-friendly, linear filename ledger with built-in DB lock; no branch DAG merge. Source: https://knexjs.org/guide/migrations#notes-about-locks.
- **TypeORM / Umzug / dbmate**: none provides a PostgreSQL distributed migration lock by default in the investigated paths; they need a dedicated migration job plus an external lock. dbmate is timestamp-linear and no-lock in v2.34.1. Sources: https://github.com/typeorm/typeorm/issues/4588 ; https://github.com/amacneil/dbmate/blob/ddd00ff09d2034168072bc7870f815f9e6f1594d/pkg/dbmate/db.go#L351-L424.
- **Flyway Community**: language-independent (not TS-native) immutable linear SQL migration history, database lock, Docker/CI fit; forward-only use needs no paid edition. `outOfOrder` does not semantically merge branches. Sources: https://documentation.red-gate.com/flyway/flyway-concepts/migrations/versioned-migrations ; https://documentation.red-gate.com/flyway/reference/usage/frequently-asked-questions.
- **Liquibase**: language-independent changelog ordering plus `DATABASECHANGELOGLOCK`; flexible but not Git DAG merge. Source: https://docs.liquibase.com/secure/user-guide-5-1-1/what-is-the-database-changelog-lock-table.
- **Atlas**: Drizzle-compatible external schema and PostgreSQL advisory lock. `atlas.sum` deliberately makes divergent migration-directory changes merge-conflict, so teams rebase/rehash to retain linear history. `migrate rebase` is unavailable in the OSS/community build; paid official/Pro is required. Sources: https://atlasgo.io/concepts/migration-directory-integrity ; https://atlasgo.io/versioned/apply ; https://github.com/ariga/atlas/blob/9a6bc601212130aaaefcbc8dd36c710baf9716ff/cmd/atlas/internal/cmdapi/cmdapi.go#L639-L655.

## Verbatim expansion markers (deduplicated)

- LEAD: Compare DAG-aware schema tools (Atlas/Liquibase/Sqitch/Flyway) for true branch merge semantics — WHY: current candidates are linear — ANGLE: official dependency-graph/conflict docs.
- DEAD END: Drizzle's v1 RC documentation does not establish a production-ready automatic merge or lock for the inspected published source.
- DEAD END: Neither Flyway nor Liquibase provides Git-style semantic automatic merge.
- DEAD END: Atlas Community does not expose `migrate rebase`; source confirms the command is unsupported.
- DEAD END: No target-repository TS migration directory is active; Drizzle config is latent.
