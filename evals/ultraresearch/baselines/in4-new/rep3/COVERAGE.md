# Coverage gate

| 요구 항목 | workers | Status |
| --- | --- | --- |
| Alembic multi-head를 대체하거나 줄이는 병합 모델 | Wave 1: 4 codebase + 6 external tool lanes (집계 기록; 축별 개별 배정 미기록); Wave 2: Sqitch dependency-plan expansion | covered |
| TypeScript 진영의 쓸 만한 라이브러리/도구 비교 | Wave 1: 4 codebase + 6 external tool lanes (집계 기록; 축별 개별 배정 미기록) | covered |
| 배포와 함께 안전하게 실행하는 방법 | Wave 1: 4 codebase + 6 external tool lanes (집계 기록; 축별 개별 배정 미기록) | covered |
| 롤백 없이 forward-only로 운영하는 방법 | Wave 1: 4 codebase + 6 external tool lanes (집계 기록; 축별 개별 배정 미기록) | covered |
| 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성 | Wave 1: 4 codebase + 6 external tool lanes (집계 기록; 축별 개별 배정 미기록) | covered |

- Alembic multi-head를 대체하거나 줄이는 병합 모델: Wave 1의 `migration-graph semantics` 축과 Wave 2 Sqitch 확장 조사가 배정되었고, REPORT §1이 선형 history·수동 의미 충돌 조정·Flyway 권고를 다룬다.
- TypeScript 진영의 쓸 만한 라이브러리/도구 비교: Wave 1의 `TypeScript tools` 축에 대해 REPORT §2가 Flyway, Kysely, Drizzle, Atlas, Prisma, Sqitch 등 후보와 한계를 비교한다.
- 배포와 함께 안전하게 실행하는 방법: Wave 1의 `deployment execution` 축에 대해 REPORT §4가 singleton migration job, DB lock, 성공 후 rollout과 DDL 예외를 제시한다.
- 롤백 없이 forward-only로 운영하는 방법: Wave 1의 `operational governance` 축에 대해 REPORT §4가 immutable migration, 새 forward migration, `outOfOrder=false`, expand/contract 절차를 제시한다.
- 현재 Acme의 Python + Drizzle + 배포 제약과의 적합성: Wave 1의 `current-repository fit` 축에 대해 REPORT §3이 Alembic authority, Drizzle 상태, 배포 순서와 SSOT 결정을 다룬다.

워커 표기는 `expansion-log.md`의 실제 기록 범위만 사용했다. Wave 1은 5개 축과 `4 codebase + 6 external tool lanes`만 집계로 기록되어 있어 축별 개별 워커 식별자는 복원할 수 없다.
