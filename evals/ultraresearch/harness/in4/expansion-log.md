# Expansion log

## Wave 1

- Status: collected
- Requirement axes: migration-graph semantics; TypeScript tools; deployment execution; operational governance; current-repository fit
- Browsing gate: no — official docs and public repositories are expected to be sufficient for this technology-selection research.
- Workers: 4 codebase + 6 external tool lanes.
- Leads opened: Sqitch DAG/dependency semantics (uninvestigated).
- Leads closed: target repository ownership/deploy/no-regress; Prisma version behavior; Drizzle v1 source discrepancy; Atlas Community rebase license gate; dbmate lock behavior; Flyway transactional-DDL caveat; Liquibase container execution.

## Wave 2

- Status: collected
- Worker: Sqitch dependency-plan expansion.
- Leads opened: none.
- Leads closed: Sqitch provides dependency ordering and locking, but its central plan still has Git merge conflicts; no candidate with automatic semantic schema merge was evidenced.
- Convergence reason: two-wave minimum reached and zero unchecked leads remain.
