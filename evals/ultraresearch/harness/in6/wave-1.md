# Wave 1 — saturation findings

## Axis 1 — Alembic multi-head symptom

- Alembic is a revision DAG and can create an explicit merge revision; it does not semantically merge two competing SQL operations. Official branch and cookbook documentation: https://alembic.sqlalchemy.org/en/latest/branches.html and https://alembic.sqlalchemy.org/en/latest/cookbook.html#test-current-database-revision-is-at-head-s.
- Practitioner process evidence: DoorDash commits a per-app migration manifest so a stale branch creates a Git conflict and must be rebased before merge. https://careersatdoordash.com/blog/tips-for-building-high-quality-django-apps-at-scale/

## Axis 2 — TypeScript candidates

- Prisma Migrate 7.9.1: Apache-2.0; committed SQL history and `migrate deploy`; documented production advisory locking. It is linear history, not a graph merge. https://docs.prisma.io/docs/cli/migrate/deploy and https://docs.prisma.io/docs/orm/more/best-practices
- Kysely 0.29.2: MIT; migration history plus DB lock table; supports strict order or `allowUnorderedMigrations`, but has no dependency DAG. https://www.kysely.dev/docs/migrations
- node-pg-migrate 9.0.0: MIT, PostgreSQL-only; session advisory lock with fail/wait and strict ordering. https://salsita.github.io/node-pg-migrate/cli
- Knex 3.3.0: MIT, row lock; stale locks after a crash need `migrate:unlock`; linear timestamps. https://knexjs.org/guide/migrations
- Drizzle Kit 0.31.10/Drizzle ORM 0.45.2: generates/applies SQL and tracks a log, but stable PostgreSQL code has no verified distributed migration lock and no Alembic-style graph merge. https://orm.drizzle.team/docs/drizzle-kit-migrate and https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/pg-core/dialect.ts#L73-L112
- dbmate 2.35.0: SQL CLI usable from pnpm/npx but not TypeScript-native. No global migration lock found; strict ordering is opt-in. https://github.com/amacneil/dbmate/blob/f3e08f15e39d5b3f10ba014b470467fb484dfc54/README.md
- Atlas 1.3.0: OSS Community has versioned diff/apply/status and advisory lock; linear order is default. Lint/rebase and Kubernetes/CI integration are paid/commercial areas. https://atlasgo.io/community-edition and https://atlasgo.io/versioned/apply

## Axis 3 — deployment integration

- Prisma documents running `migrate deploy` as a CI/CD release step; advisory locking should remain enabled. https://docs.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate
- Argo CD PreSync Jobs make a migration run before resources in one Application, but do not globally serialize unrelated Applications; this is an inference from the sync-wave contract. https://argo-cd.readthedocs.io/en/release-3.1/user-guide/sync-waves/
- GitLab resource groups serialize deployments per environment. https://docs.gitlab.com/ci/environments/deployment_safety/

## Axis 4 — operating methodology

- One-shot migration runner / dedicated deployment stage avoids all application replicas competing to migrate; a DB lock is defense in depth, not a branch-conflict resolver.
- Use forward-only expand → deploy compatible application → backfill/validate → contract migrations for changes that overlap old/new application versions. Alembic's cookbook and GitLab's migration guidance describe this class of practice. https://alembic.sqlalchemy.org/en/latest/cookbook.html and https://docs.gitlab.com/development/migration_style_guide/

## Axis 5 — initial selection direction

- Strongest PostgreSQL/TypeScript-native small-team candidate: Kysely (lock built in; linear governance still needed).
- Strongest full migration delivery product: Atlas if commercial feature boundaries are acceptable.
- Strongest ORM-integrated choice: Prisma when adopting its ORM is acceptable.

## EXPAND markers (verbatim)

- LEAD: Atlas migration hash/conflict workflows — WHY: Atlas may offer another first-party implementation of CI-gated linear migration history — ANGLE: search Atlas official documentation for out-of-order migrations and CI enforcement
- LEAD: Prisma 7.9.1 release notes and migration-engine behavior — WHY: reconfirm advisory locking on examined current version — ANGLE: inspect primary Prisma docs/source
- LEAD: true Git-like migration merge model — WHY: user explicitly asks for it and the first wave finds workflow gates, not semantic automatic merges — ANGLE: compare Flyway/Liquibase and graph-oriented systems' official docs
- DEAD END: OMT repository Alembic/multi-head implementation — no actual migration service is in this workspace.
