# Wave 2 — expansion: Sqitch

Sqitch was the only unchecked candidate with explicit dependency metadata. It is dependency-aware rather than a Git-like semantic merge engine. Its plan is central and append-only; its own tutorial shows that concurrent branch additions create a `sqitch.plan` Git conflict and requires a human to check ordering after resolving it. Sources: https://sqitch.org/docs/manual/sqitch/ ; https://sqitch.org/docs/manual/sqitchtutorial/#L987-L1027.

For PostgreSQL it serializes Sqitch processes with a target lock/advisory lock, and provides hash-based divergence check (`sqitch check`) and execution-order verification (`sqitch verify`). Sources: https://sqitch.org/docs/manual/sqitch-deploy/#L85-L90 ; https://sqitch.org/docs/manual/sqitch-check/ ; https://sqitch.org/docs/manual/sqitch-verify/.

It is a Perl/SQL CLI, not a TypeScript library or Drizzle integration. It can run in a singleton CI or ArgoCD `PreSync` Job using its official container, but does not eliminate central plan conflict or need for an explicit merge policy. It is MIT licensed; current stable investigated was v1.6.1. Sources: https://sqitch.org/download/ ; https://hub.docker.com/r/sqitch/sqitch ; https://metacpan.org/module/App%3A%3ASqitch.

## Verbatim expansion markers

none — official docs, current v1.6.1 source, Docker/Argo integration, and TypeScript/Drizzle applicability were all covered; no unchecked leads remain.
