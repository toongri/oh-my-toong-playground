# Phase 0 — TypeScript DB migration research axes

## Routing decision

- **Posture:** explicit research (`/ultraresearch` equivalent): the user asks for an evidence-backed comparison and recommendation, not an implementation decision yet.
- **Tier:** explicit `/ultraresearch` (maximum-saturation floor).
- **Research boundary:** identify TypeScript-compatible migration tooling and a forward-only operating model that prevents Alembic `multihead` deployment conflicts; do not assume that a TypeScript rewrite is required.
- **Browsing gate:** **no**. Official documentation, release notes, public repositories, GitHub search, and practitioner accounts should be sufficient for the first waves. Escalate to Hermes/`insane-browsing` only if a material primary source is access-blocked or JavaScript-only.
- **Session-artifact exception:** Per the user instruction, do not create `$SESSION_DIR`; this file is the sole Phase-0 artifact. The intent-diff seed is embedded below rather than written as `intent-diff.md`.

## Axes / provisional requirement items

| id | orthogonal axis and provisional requirement | Why it is independently required | Completion evidence |
|---|---|---|---|
| A1 | **Tooling fit:** find actively maintained TypeScript migration libraries/ORMs suitable for production PostgreSQL, including migration authoring, generation, and execution. | “TS 진영에서 쓸만한 것” asks for credible candidates, not merely a migration concept. | Supported feature/version matrix from official docs and source repositories, with a shortlist tied to use cases. |
| A2 | **Concurrent-branch merge semantics:** determine how each candidate represents migration history; whether it can create divergent heads; and how it detects, serializes, or resolves concurrently added migrations. | The stated pain is Alembic `multihead` contention, which a tool list alone would leave unresolved. | Primary-source behavior plus real-world examples of concurrent migration handling and an explicit comparison with Alembic heads. |
| A3 | **Deployment execution and safety:** establish how migrations run with deployment (CI/CD job, Kubernetes job/init container, application startup, or explicit command), including single-run locking and failure behavior. | The user wants migration execution to be managed together with deployments. | Documented deployment invocation, concurrency/lock behavior, and operational trade-offs for each viable approach. |
| A4 | **Forward-only schema-change methodology:** define a Git-compatible workflow for ordered migration files, CI checks, rebase/renumber policy, and expand/contract compatibility that avoids relying on database rollback. | The user explicitly accepts no rollback; a reliable process must therefore prevent unsafe deploys and resolve ordering before production. | Recommended branching/CI/release rules, including what happens when two PRs add migrations concurrently. |
| A5 | **AlgoCare migration-boundary fit:** inspect the actual repositories and deployment paths to decide whether a TypeScript tool can own the relevant database, coexist with Django/Alembic, or whether the safer answer is to retain Alembic and change the workflow. | Migration ownership cannot be inferred from the company-wide stack; shared schemas and current pipelines determine whether a library swap is viable. | Codebase evidence for current migration owners, database access paths, CI/CD/deployment hooks, and shared-schema constraints. |
| A6 | **Adoption cost and recommendation:** rank options by operational simplicity, maintainability, compatibility with A5, and open-source availability; exclude rollback as a decision requirement. | The user asks for an easier management choice, not a catalog. | A final conditional recommendation and migration/adoption path that treats rollback as optional/not required. |

## Embedded intent-diff seed

| intent_id | expected truth | observed reality | diff | violated invariant | intent source | supporting observations | status | linked claim ids |
|---|---|---|---|---|---|---|---|---|
| I1 | A TypeScript-capable migration solution should be evaluated for production use. | Candidate libraries have not yet been researched. | Unknown candidate suitability. | Recommendations must be based on maintained, documented behavior. | User question: “db 버전관리 라이브러리 TS 진영에서 쓸만한거 있어?” | User currently uses Alembic; no codebase evidence collected. | unknown | To assign after research: tooling-fit claims |
| I2 | Concurrent migration work should not routinely cause unresolved multi-head state or deployment failure. | User reports repeated Alembic `multihead` contention and deploy failures when versions accumulate concurrently. | Current process does not consistently preserve a deployable single-history state. | Every deployable revision set must have deterministic ordering/compatibility. | User question: “multihead문제때문에 계속 경합이 발생하거나 배포 실패가 발생해.” | Direct user report; cause and repository-specific mechanics unverified. | violated | To assign after research: concurrency, workflow, and codebase-fit claims |
| I3 | Migration execution should be manageable as part of deployment. | Current invocation and serialization mechanism are unknown. | Unknown deployment integration. | Exactly one safe migration executor per target database/version. | User question: “배포될 때 함께 실행된다던지 관리가 좀 쉬운거였으면 좋겠어.” | Direct requirement; no pipeline evidence collected. | unknown | To assign after research: deployment and codebase-fit claims |
| I4 | The recommended model may be forward-only and need not provide paid rollback. | User explicitly does not plan to roll back the database. | Rollback capability must not be over-weighted. | Safe forward recovery and compatible rollout take precedence over down migrations. | User question: “롤백 기능이 유료거나 없어도돼. 어차피 db 롤백은 안한다는 마인드야.” | Direct user constraint. | true | To assign after research: workflow and adoption claims |

## Phase 1 worker assignment (planned; not dispatched)

The explicit-research tier normally floors at four codebase explorers and six web librarians. No browsing workers are assigned because the Browsing gate is `no`; this is a gate decision, not a claim that all sources have already been retrieved.

| worker | type | owned angle | required sources / outcome |
|---|---|---|---|
| E1 | explore | Current Alembic configuration, revision locations, multi-head checks, and migration ownership. | Search migration configuration and revision history with spelling/path variations; report exact paths, quoted coordinates, and Git history. |
| E2 | explore | Django/backend database entry points and schema ownership. | Determine whether Django ORM/Alembic share a production database or schema; map callers and database configuration. |
| E3 | explore | TypeScript services’ database layers and migration tooling. | Inspect Turborepo Node/Hono/tRPC/Drizzle paths, schema definitions, scripts, and current migration commands. |
| E4 | explore | Deployment/CI/Kubernetes execution topology. | Trace pipeline, Docker, Helm/Kustomize/ArgoCD, and one-off job patterns to establish where a migration command can safely run. |
| L1 | librarian | Official comparison of Drizzle Kit migrations, including generated SQL and migration execution. | Official docs, release notes, source repository, and production-use signals. |
| L2 | librarian | Official comparison of Prisma Migrate history, drift detection, deploy command, and concurrent-branch handling. | Official docs, GitHub issues/discussions, and source repository. |
| L3 | librarian | Lightweight SQL-first runners: dbmate, Umzug, Knex, Kysely migration facilities. | Official docs and repositories; distinguish ORM coupling from runner behavior. |
| L4 | librarian | PostgreSQL migration concurrency, advisory locks, and Kubernetes/CI deployment patterns. | PostgreSQL primary documentation plus official deployment/runner documentation. |
| L5 | librarian | Alembic multi-head mechanics and proven prevention/remediation workflows. | Alembic/SQLAlchemy primary docs, real-world issue reports, and code examples. |
| L6 | librarian | Practitioner workflow evidence for parallel migration PRs and forward-only expand/contract releases. | Engineering postmortems plus `site:reddit.com OR site:news.ycombinator.com` discourse, GitHub code search, and grep.app. |

## Worker protocol to use when Phase 1 is authorized

Every assigned worker is a read-only foreground gatherer. Its dispatch must state that this is an explicit exhaustive-research assignment, lift default retrieval/stop limits, require the role-specific protocol, and require an `## EXPAND` tail containing leads, dead ends, and open chains. Web workers must use at least ten distinct search queries and fetch every material result; explore workers must use at least three keyword variations, structural search, definitions/references, file globs, and `git log --all -S` plus `--grep`. Workers return claim candidates under `## CLAIMS`; only the orchestrator records artifacts or verifies claims.

## Planned report structure

1. Tooling fit
2. Concurrent-branch merge semantics
3. Deployment execution and safety
4. Forward-only schema-change methodology
5. AlgoCare migration-boundary fit
6. Adoption cost and recommendation
