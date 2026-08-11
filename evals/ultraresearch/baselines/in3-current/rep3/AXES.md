# Ultraresearch Phase 0 — TS DB migration concurrency

## Intent route

- **Posture:** explicit research. The request explicitly places this work under the Ultraresearch orchestration contract, so the explicit-research override applies even though this phase ends before the research deliverables are produced.
- **Tier:** Architecture. The answer must compare migration execution architecture, Git-branch integration behavior, deployment/runtime coordination, and operational safety across libraries and methods.
- **Browsing:** **no**. The initial evidence plan is fully addressable through official documentation, package/source repositories, GitHub issues, and public CI/deployment examples. No decisive source is presently known to require authenticated, blocked, or JavaScript-only access. Change this gate to `yes` only if such a source becomes necessary.
- **Phase boundary:** this artifact declares Phase 1 only; no gatherer has been launched.

## Requirement items / research axes

| ID | Axis / provisional requirement | What the research must establish |
| --- | --- | --- |
| A1 | **Deploy-coupled migration execution** | Which TS-compatible tools can reliably apply migrations as a release step; migration tracking, ordering, advisory/runner locking, failure behavior, and CI/CD/Kubernetes fit. |
| A2 | **Parallel-branch integration and Alembic multihead avoidance** | How each approach represents migration history and resolves simultaneous additions: linear numbering, DAGs, generated IDs, rebase/renumber, schema-diff planning, or a merge-migration equivalent. Identify the governance method that prevents deployment-blocking heads. |
| A3 | **TS ecosystem library shortlist** | Evaluate production-suitable choices in and around TypeScript (Prisma Migrate, Drizzle Kit, Kysely migration primitives, node-pg-migrate/Umzug, Atlas/other external schema tools where TS integration is practical) with first-party documentation and evidence of real-world usage. |
| A4 | **Forward-only operational model** | Assess compatibility with the stated no-DB-rollback policy: immutable applied migrations, expand/contract changes, deploy-safe transitions, repair/baseline facilities, and what must be handled procedurally rather than by a library. |

These four rows are the provisional requirement set, the Phase 1 worker partition, and the future report table of contents. A later coverage gate may mark a row `not applicable` only if research shows that this Phase 0 decomposition overstated what the question demands.

## Phase 1 saturation-wave assignment

The Architecture floor requires 4 `explore` and 6 `librarian` workers. The Browsing gate is `no`, so no `hermes`/insane-browsing worker is assigned in this wave. Each worker must use the Ultraresearch exhaustive-retrieval and `## EXPAND` reply contract.

| Worker | Role | Owned angle | Axis coverage |
| --- | --- | --- | --- |
| E1 | explore | Inventory repository-local migration tooling, package manifests, deployment manifests, and CI hooks that constrain a deploy-coupled solution. | A1, A4 |
| E2 | explore | Search repository history for Alembic revisions, `head`/`heads`, merge migrations, migration-failure incidents, and migration policy precedent. | A2, A4 |
| E3 | explore | Locate TypeScript service/database boundaries, database clients/ORMs, runtime entry points, and Kubernetes job/command patterns relevant to integrating a runner. | A1, A3 |
| E4 | explore | Trace existing release/rollback/forward-fix conventions and schema-change safety patterns from docs, scripts, and historical commits. | A1, A2, A4 |
| L1 | librarian | First-party Prisma Migrate workflow: `migrate dev`, `migrate deploy`, migration-history semantics, branch conflicts, and production deployment. | A1, A2, A3, A4 |
| L2 | librarian | First-party Drizzle Kit migration generation/application workflow, migration metadata/order, deployment integration, and concurrent-branch behavior. | A1, A2, A3 |
| L3 | librarian | Kysely migration primitives, Umzug, and node-pg-migrate: execution state, ordering/locking, TypeScript API fit, and deployment invocation. | A1, A3, A4 |
| L4 | librarian | Atlas and comparable declarative/schema-diff tools: branch merge semantics, migration planning, CI/CD workflow, and practical TS integration. | A1, A2, A3, A4 |
| L5 | librarian | Forward-only database migration methods: expand/contract, compatibility windows, idempotency/repair policy, and deployment sequencing from authoritative sources. | A1, A4 |
| L6 | librarian | Public implementation evidence and failure cases: GitHub code search, GitHub issues, and grep.app for concurrent migrations, migration locks, Prisma/Drizzle conflict handling, and Alembic-head alternatives. | A2, A3, A4 |

## Initial assumptions and decision criteria

- The target database is provisionally PostgreSQL because the supplied project context names it as the primary transactional database; Phase 1 must verify this against the actual target codebase before treating it as an object-level fact.
- “Git-like merge” is treated as a requirement for predictable parallel-branch integration, not as a presupposition that a database history must literally be a Git DAG.
- A recommended solution must minimize human coordination cost without silently accepting divergent applied histories.
- Rollback support is non-required; production safety must still be judged on forward repair and expand/contract readiness.

## Phase 0 completion criteria

- [x] At least three orthogonal axes declared.
- [x] Requirement items are identical to the axes.
- [x] Posture, tier, and Browsing gate decided.
- [x] First-wave worker ownership declared without launching workers.
